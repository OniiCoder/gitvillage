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
  if (trimmed === '~') {
    return os.homedir();
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
  displayPath: string;
  branch: string;
  changedFilesCount: number;
}

function formatDisplayPath(fullPath: string): string {
  const home = os.homedir();
  if (fullPath === home) return '~';
  if (fullPath.startsWith(`${home}/`)) {
    return `~/${fullPath.slice(home.length + 1)}`;
  }
  return fullPath;
}

async function hasGitEntry(dirPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function inspectQuickRepo(dirPath: string): Promise<DiscoveredLocalRepo | null> {
  try {
    if (!(await hasGitEntry(dirPath))) return null;
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
      displayPath: formatDisplayPath(dirPath),
      branch: branchOut.trim() || 'main',
      changedFilesCount,
    };
  } catch {
    return null;
  }
}

// Avoid macOS TCC-protected folders during automatic background scan; user can still click into them manually!
const SKIP_AUTO_SCAN_DIRS = new Set([
  'Library',
  'Applications',
  'Desktop',
  'Documents',
  'Downloads',
  'Pictures',
  'Music',
  'Movies',
  'Public',
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.Trash',
  '.npm',
  '.cache',
  '.git',
]);

async function collectRepoCandidates(): Promise<string[]> {
  const home = os.homedir();
  const cwd = process.cwd();
  const scratchDir = path.dirname(cwd);

  const found = new Set<string>([cwd]);

  const scanOneLevel = async (rootDir: string, depthLeft: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch {
      return;
    }

    const subDirs: string[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.')) continue;
      if (SKIP_AUTO_SCAN_DIRS.has(ent.name)) continue;
      const full = path.join(rootDir, ent.name);
      if (await hasGitEntry(full)) {
        found.add(full);
      } else if (depthLeft > 0) {
        subDirs.push(full);
      }
    }

    if (depthLeft > 0 && subDirs.length > 0) {
      await Promise.all(subDirs.slice(0, 24).map((d) => scanOneLevel(d, depthLeft - 1)));
    }
  };

  await Promise.all([
    scanOneLevel(scratchDir, 1),
    scanOneLevel(home, 1),
  ]);

  return [...found];
}

function localGitVillagePlugin(): Plugin {
  return {
    name: 'local-git-village-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        const reqUrl = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        try {
          // 1. Auto-discover local git repositories
          if (reqUrl.pathname === '/api/local-repos') {
            const candidatePaths = await collectRepoCandidates();
            const inspected = await Promise.all(candidatePaths.map(inspectQuickRepo));
            const repos = inspected
              .filter((r): r is DiscoveredLocalRepo => r !== null)
              .sort((a, b) => {
                if (a.path === process.cwd()) return -1;
                if (b.path === process.cwd()) return 1;
                return b.changedFilesCount - a.changedFilesCount || a.name.localeCompare(b.name);
              });
            res.statusCode = 200;
            res.end(JSON.stringify({ repos }));
            return;
          }

          // 2. Interactive visual folder browser
          if (reqUrl.pathname === '/api/browse-dirs') {
            const rawTarget = reqUrl.searchParams.get('path') ?? path.dirname(process.cwd());
            const showHidden = reqUrl.searchParams.get('hidden') === '1';
            const dirPath = resolveUserPath(rawTarget);

            const stat = await fs.stat(dirPath);
            if (!stat.isDirectory()) {
              throw new Error('Selected path is not a directory.');
            }

            // Check if dirPath itself is inside a git repo
            let currentGitRepo: DiscoveredLocalRepo | null = null;
            try {
              const gitTop = (await runGit(dirPath, ['rev-parse', '--show-toplevel'])).trim();
              if (gitTop) {
                currentGitRepo = await inspectQuickRepo(gitTop);
              }
            } catch {
              currentGitRepo = null;
            }

            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const dirNames = entries
              .filter((e) => e.isDirectory() && (showHidden || !e.name.startsWith('.')))
              .filter((e) => e.name !== 'node_modules' && e.name !== '.git')
              .map((e) => e.name)
              .sort((a, b) => a.localeCompare(b));

            const folders = await Promise.all(
              dirNames.slice(0, 120).map(async (name) => {
                const full = path.join(dirPath, name);
                const isGit = await hasGitEntry(full);
                return {
                  name,
                  path: full,
                  isGitRepo: isGit,
                };
              }),
            );

            // Put Git repo folders at the top for easy picking!
            folders.sort((a, b) => {
              if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

            // Quick-jump roots
            const home = os.homedir();
            const scratch = path.dirname(process.cwd());
            const potentialRoots = [
              { label: 'Scratch', path: scratch },
              { label: 'Home', path: home },
              { label: 'Projects', path: path.join(home, 'Projects') },
              { label: 'Developer', path: path.join(home, 'Developer') },
              { label: 'Code', path: path.join(home, 'Code') },
              { label: 'Desktop', path: path.join(home, 'Desktop') },
              { label: 'Documents', path: path.join(home, 'Documents') },
            ];
            const roots: Array<{ label: string; path: string }> = [];
            for (const r of potentialRoots) {
              try {
                const st = await fs.stat(r.path);
                if (st.isDirectory()) roots.push(r);
              } catch {
                // skip nonexistent root
              }
            }

            // Build ancestor segments for Breadcrumbs
            const parsed = path.parse(dirPath);
            const rel = dirPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
            const breadcrumbs: Array<{ label: string; path: string }> = [
              { label: parsed.root, path: parsed.root },
            ];
            let accum = parsed.root;
            for (const seg of rel) {
              accum = path.join(accum, seg);
              breadcrumbs.push({ label: seg, path: accum });
            }

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                currentPath: dirPath,
                displayPath: formatDisplayPath(dirPath),
                parentPath: path.dirname(dirPath) !== dirPath ? path.dirname(dirPath) : null,
                currentGitRepo,
                breadcrumbs,
                roots,
                folders,
              }),
            );
            return;
          }

          // 3. Native OS Folder Picker Dialog (macOS Finder via osascript)
          if (reqUrl.pathname === '/api/pick-native-folder' && req.method === 'POST') {
            if (process.platform !== 'darwin') {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: 'Native Finder picker is only supported on macOS; use the folder browser below.',
                }),
              );
              return;
            }
            try {
              const { stdout } = await execFileAsync('osascript', [
                '-e',
                'POSIX path of (choose folder with prompt "Choose a local Git repository:")',
              ]);
              const chosen = stdout.trim().replace(/\/+$/, '') || '/';
              res.statusCode = 200;
              res.end(JSON.stringify({ path: chosen }));
            } catch (err) {
              const msg = err instanceof Error ? err.message : '';
              if (msg.includes('-128') || msg.toLowerCase().includes('canceled')) {
                res.statusCode = 200;
                res.end(JSON.stringify({ cancelled: true }));
                return;
              }
              throw new Error('Could not open macOS Finder dialog; pick a folder from the browser below.');
            }
            return;
          }

          // 4. Full Local Git Repo Graph + Working-Tree Gate Visitors
          if (reqUrl.pathname === '/api/local-repo') {
            const rawTarget = reqUrl.searchParams.get('path') ?? '.';
            const resolved = resolveUserPath(rawTarget);
            let topLevel: string;
            try {
              topLevel = (await runGit(resolved, ['rev-parse', '--show-toplevel'])).trim();
            } catch {
              throw new Error(
                `"${formatDisplayPath(resolved)}" is not a Git repository (no .git folder found).`,
              );
            }

            const repoName = path.basename(topLevel);
            const parentName = path.basename(path.dirname(topLevel)) || 'local';

            const currentBranchRaw = (
              await runGit(topLevel, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')
            ).trim();
            const currentBranch = currentBranchRaw === 'HEAD' ? 'detached-head' : currentBranchRaw;

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

            branchEntries.sort((a, b) =>
              a.name === currentBranch ? -1 : b.name === currentBranch ? 1 : 0,
            );

            const REC_SEP = '\x1e';
            const FLD_SEP = '\x1f';
            const STAT_SEP = '\x1d';
            const logFormat = `${REC_SEP}%H${FLD_SEP}%P${FLD_SEP}%an${FLD_SEP}%ae${FLD_SEP}%aI${FLD_SEP}%s${FLD_SEP}%b${STAT_SEP}`;

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
                filesCount: number;
                stats: { additions: number; deletions: number; total: number };
                files: Array<{
                  filename: string;
                  status: 'added' | 'modified' | 'removed' | 'renamed';
                  additions: number;
                  deletions: number;
                }>;
              }>;
            }> = [];

            for (const b of branchEntries) {
              const limit = b.name === currentBranch ? '26' : '12';
              const rawLog = await runGit(topLevel, [
                'log',
                b.name,
                `-n`,
                limit,
                '--numstat',
                `--format=${logFormat}`,
              ]).catch(() => '');

              const rawChunks = rawLog
                .split(REC_SEP)
                .map((chunk) => chunk.trim())
                .filter(Boolean);

              const commits = await Promise.all(
                rawChunks.map(async (chunk) => {
                  const [headerPart, statPart = ''] = chunk.split(STAT_SEP);
                  const [sha, parentsStr, authorName, authorEmail, timestamp, subject, body] =
                    headerPart.split(FLD_SEP);
                  const cleanSha = sha.trim();
                  const parents = (parentsStr ?? '').trim().split(/\s+/).filter(Boolean);

                  let numstatBlock = statPart;
                  // For merge commits, git log --numstat omits file lines by default; diff against first parent
                  if (!numstatBlock.trim() && parents.length > 1) {
                    numstatBlock = await runGit(topLevel, [
                      'diff',
                      '--numstat',
                      `${parents[0]}..${cleanSha}`,
                    ]).catch(() => '');
                  }

                  let totalAdd = 0;
                  let totalDel = 0;
                  const parsedFiles: Array<{
                    filename: string;
                    status: 'added' | 'modified' | 'removed' | 'renamed';
                    additions: number;
                    deletions: number;
                  }> = [];

                  for (const sLine of numstatBlock.split('\n')) {
                    if (!sLine.trim()) continue;
                    const parts = sLine.split('\t');
                    if (parts.length >= 3) {
                      const additions = Number.parseInt(parts[0], 10) || 0;
                      const deletions = Number.parseInt(parts[1], 10) || 0;
                      const filename = parts.slice(2).join('\t').trim();
                      totalAdd += additions;
                      totalDel += deletions;
                      parsedFiles.push({
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

                  return {
                    sha: cleanSha,
                    parents,
                    authorName: (authorName ?? 'Developer').trim(),
                    authorEmail: (authorEmail ?? '').trim(),
                    timestamp: (timestamp ?? new Date().toISOString()).trim(),
                    subject: (subject ?? 'Commit').trim(),
                    body: (body ?? '').trim(),
                    filesCount: parsedFiles.length,
                    stats: {
                      additions: totalAdd,
                      deletions: totalDel,
                      total: totalAdd + totalDel,
                    },
                    files: parsedFiles.slice(0, 40),
                  };
                }),
              );

              branchesPayload.push({
                name: b.name,
                isCurrent: b.name === currentBranch,
                commits,
              });
            }

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

          // 5. Commit detail hydration for local repos
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
