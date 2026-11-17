import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Plugin, defineConfig } from 'vite';

const execFileAsync = promisify(execFile);

function resolveUserPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === '.') {
    return process.cwd();
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

interface DiscoveredLocalRepo {
  name: string;
  path: string;
  branch: string;
  changedFilesCount: number;
}

async function inspectQuickRepo(dirPath: string): Promise<DiscoveredLocalRepo | null> {
  try {
    const stat = await fs.stat(path.join(dirPath, '.git'));
    if (!stat) return null;
    const [branchOut, statusOut] = await Promise.all([
      runGit(dirPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main'),
      runGit(dirPath, ['status', '--porcelain=v1', '-uall']).catch(() => ''),
    ]);
    const changedFilesCount = statusOut
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean).length;
    return {
      name: path.basename(dirPath),
      path: dirPath,
      branch: branchOut.trim() || 'main',
      changedFilesCount,
    };
  } catch {
    return null;
  }
}

function localGitVillagePlugin(): Plugin {
  return {
    name: 'local-git-village-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/local-')) {
          return next();
        }

        const reqUrl = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        try {
          if (reqUrl.pathname === '/api/local-repos') {
            const cwd = process.cwd();
            const parentDir = path.dirname(cwd);
            const candidates = new Set<string>([cwd]);

            try {
              const entries = await fs.readdir(parentDir, { withFileTypes: true });
              for (const ent of entries) {
                if (ent.isDirectory() && !ent.name.startsWith('.')) {
                  candidates.add(path.join(parentDir, ent.name));
                }
              }
            } catch {
              // ignore parent scan errors
            }

            const inspected = await Promise.all([...candidates].map(inspectQuickRepo));
            const repos = inspected.filter((r): r is DiscoveredLocalRepo => r !== null);
            res.statusCode = 200;
            res.end(JSON.stringify({ repos }));
            return;
          }

          if (reqUrl.pathname === '/api/local-repo') {
            const rawTarget = reqUrl.searchParams.get('path') ?? '.';
            const resolved = resolveUserPath(rawTarget);
            const topLevel = (
              await runGit(resolved, ['rev-parse', '--show-toplevel'])
            ).trim();

            const repoName = path.basename(topLevel);
            const parentName = path.basename(path.dirname(topLevel)) || 'local';

            const currentBranchRaw = (
              await runGit(topLevel, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')
            ).trim();
            const currentBranch = currentBranchRaw === 'HEAD' ? 'detached-head' : currentBranchRaw;

            // Gather local branches (up to 6)
            const branchesOut = await runGit(topLevel, [
              'for-each-ref',
              '--sort=-committerdate',
              '--format=%(refname:short)|%(objectname)',
              'refs/heads/',
            ]).catch(() => '');

            const branchEntries = branchesOut
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line) => {
                const [name, sha] = line.split('|');
                return { name, sha };
              })
              .slice(0, 5);

            if (branchEntries.length === 0) {
              branchEntries.push({ name: currentBranch, sha: '' });
            }

            // Ensure currentBranch is first
            branchEntries.sort((a, b) =>
              a.name === currentBranch ? -1 : b.name === currentBranch ? 1 : 0,
            );

            // Parse commits per branch using NUL/record separators
            const REC_SEP = '\x1e';
            const FLD_SEP = '\x1f';
            const logFormat = `%H${FLD_SEP}%P${FLD_SEP}%an${FLD_SEP}%ae${FLD_SEP}%aI${FLD_SEP}%s${FLD_SEP}%b${REC_SEP}`;

            const branchesPayload: Array<{
              name: string;
              isCurrent: boolean;
              commits: Array<{
                sha: string;
                parents: string[];
                authorName: string;
                authorEmail: string;
                timestamp: string;
                subject: string;
                body: string;
              }>;
            }> = [];

            for (const b of branchEntries) {
              const limit = b.name === currentBranch ? '26' : '12';
              const rawLog = await runGit(topLevel, [
                'log',
                b.name,
                `-n`,
                limit,
                `--format=${logFormat}`,
              ]).catch(() => '');

              const commits = rawLog
                .split(REC_SEP)
                .map((chunk) => chunk.trim())
                .filter(Boolean)
                .map((chunk) => {
                  const [sha, parentsStr, authorName, authorEmail, timestamp, subject, body] =
                    chunk.split(FLD_SEP);
                  return {
                    sha: sha.trim(),
                    parents: (parentsStr ?? '').trim().split(/\s+/).filter(Boolean),
                    authorName: (authorName ?? 'Developer').trim(),
                    authorEmail: (authorEmail ?? '').trim(),
                    timestamp: (timestamp ?? new Date().toISOString()).trim(),
                    subject: (subject ?? 'Commit').trim(),
                    body: (body ?? '').trim(),
                  };
                });

              branchesPayload.push({
                name: b.name,
                isCurrent: b.name === currentBranch,
                commits,
              });
            }

            // Working-tree status -> Gate Visitors!
            const [porcelainOut, unstagedNumstat, stagedNumstat] = await Promise.all([
              runGit(topLevel, ['status', '--porcelain=v1', '-uall']).catch(() => ''),
              runGit(topLevel, ['diff', '--numstat']).catch(() => ''),
              runGit(topLevel, ['diff', '--cached', '--numstat']).catch(() => ''),
            ]);

            const numstatMap = new Map<string, { additions: number; deletions: number }>();
            for (const block of [unstagedNumstat, stagedNumstat]) {
              for (const line of block.split('\n')) {
                if (!line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 3) {
                  const add = Number.parseInt(parts[0], 10) || 0;
                  const del = Number.parseInt(parts[1], 10) || 0;
                  const file = parts.slice(2).join('\t').trim();
                  const prev = numstatMap.get(file) ?? { additions: 0, deletions: 0 };
                  numstatMap.set(file, {
                    additions: prev.additions + add,
                    deletions: prev.deletions + del,
                  });
                }
              }
            }

            const statusLines = porcelainOut
              .split('\n')
              .filter((line) => line.length >= 4);

            const gateVisitors = await Promise.all(
              statusLines.slice(0, 60).map(async (line) => {
                const indexCode = line[0];
                const workCode = line[1];
                let filename = line.slice(3).trim();
                if (filename.includes(' -> ')) {
                  filename = filename.split(' -> ').pop()!.trim();
                }
                // Strip surrounding quotes if git quoted special characters
                if (filename.startsWith('"') && filename.endsWith('"')) {
                  filename = filename.slice(1, -1);
                }

                const isUntracked = indexCode === '?' && workCode === '?';
                const staged = !isUntracked && indexCode !== ' ';

                let status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' = 'modified';
                if (isUntracked) status = 'untracked';
                else if (indexCode === 'A' || workCode === 'A') status = 'added';
                else if (indexCode === 'D' || workCode === 'D') status = 'deleted';
                else if (indexCode === 'R' || workCode === 'R') status = 'renamed';

                let stats = numstatMap.get(filename) ?? { additions: 0, deletions: 0 };
                let diffPreview = '';

                if (isUntracked) {
                  try {
                    const content = await fs.readFile(path.join(topLevel, filename), 'utf-8');
                    const lines = content.split('\n');
                    stats = { additions: lines.length, deletions: 0 };
                    diffPreview = lines
                      .slice(0, 14)
                      .map((l) => `+ ${l}`)
                      .join('\n');
                  } catch {
                    stats = { additions: 1, deletions: 0 };
                  }
                } else {
                  try {
                    const diffArgs = staged
                      ? ['diff', '--cached', '--unified=2', '--', filename]
                      : ['diff', '--unified=2', '--', filename];
                    const rawDiff = await runGit(topLevel, diffArgs);
                    const relevantLines = rawDiff
                      .split('\n')
                      .filter(
                        (dl) =>
                          dl.startsWith('@@') ||
                          (dl.startsWith('+') && !dl.startsWith('+++')) ||
                          (dl.startsWith('-') && !dl.startsWith('---')),
                      )
                      .slice(0, 16);
                    diffPreview = relevantLines.join('\n');
                  } catch {
                    // ignore diff snippet error
                  }
                }

                return {
                  filename,
                  status,
                  staged,
                  additions: stats.additions,
                  deletions: stats.deletions,
                  diffPreview,
                };
              }),
            );

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                owner: parentName,
                repo: repoName,
                localPath: topLevel,
                currentBranch,
                branches: branchesPayload,
                gateVisitors,
                totalChangedFiles: statusLines.length,
              }),
            );
            return;
          }

          if (reqUrl.pathname === '/api/local-commit-detail') {
            const rawTarget = reqUrl.searchParams.get('path') ?? '.';
            const sha = (reqUrl.searchParams.get('sha') ?? '').trim();
            if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
              throw new Error('Invalid commit SHA');
            }
            const resolved = resolveUserPath(rawTarget);
            const topLevel = (
              await runGit(resolved, ['rev-parse', '--show-toplevel'])
            ).trim();

            const rawShow = await runGit(topLevel, [
              'show',
              '--numstat',
              '--diff-filter=ACDMRTUXB',
              '--format=',
              sha,
            ]);

            let totalAdd = 0;
            let totalDel = 0;
            const files: Array<{
              filename: string;
              status: 'added' | 'modified' | 'removed' | 'renamed';
              additions: number;
              deletions: number;
            }> = [];

            for (const line of rawShow.split('\n')) {
              if (!line.trim()) continue;
              const parts = line.split('\t');
              if (parts.length >= 3) {
                const additions = Number.parseInt(parts[0], 10) || 0;
                const deletions = Number.parseInt(parts[1], 10) || 0;
                const filename = parts.slice(2).join('\t').trim();
                totalAdd += additions;
                totalDel += deletions;
                files.push({
                  filename,
                  status: filename.includes('=>')
                    ? 'renamed'
                    : deletions === 0 && additions > 0
                      ? 'added'
                      : additions === 0 && deletions > 0
                        ? 'removed'
                        : 'modified',
                  additions,
                  deletions,
                });
              }
            }

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                stats: {
                  additions: totalAdd,
                  deletions: totalDel,
                  total: totalAdd + totalDel,
                },
                files: files.slice(0, 40),
              }),
            );
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Unknown endpoint' }));
        } catch (err) {
          res.statusCode = 400;
          const message =
            err instanceof Error ? err.message : 'Failed to inspect local git repository';
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [localGitVillagePlugin()],
  build: {
    target: 'esnext',
  },
  server: {
    host: true,
  },
});
