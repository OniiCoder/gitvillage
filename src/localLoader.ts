import { classifyCommitKind } from './demoRepo';
import type {
  BranchIslandData,
  CommitData,
  CommitFileChange,
  GateVisitorFile,
  RepoVillageGraph,
} from './types';

const BRANCH_PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c'];

export interface DiscoveredLocalRepo {
  name: string;
  path: string;
  displayPath?: string;
  branch: string;
  changedFilesCount: number;
}

export interface BrowseDirsResponse {
  currentPath: string;
  displayPath: string;
  parentPath: string | null;
  currentGitRepo: DiscoveredLocalRepo | null;
  breadcrumbs: Array<{ label: string; path: string }>;
  roots: Array<{ label: string; path: string }>;
  folders: Array<{ name: string; path: string; isGitRepo: boolean }>;
  error?: string;
}

export function isLocalPathInput(raw: string): boolean {
  const t = raw.trim();
  return (
    t === '.' ||
    t === '~' ||
    t.startsWith('/') ||
    t.startsWith('~/') ||
    t.startsWith('./') ||
    t.startsWith('../') ||
    t.startsWith('local:')
  );
}

export async function discoverLocalRepos(): Promise<DiscoveredLocalRepo[]> {
  try {
    const res = await fetch('/api/local-repos', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { repos?: DiscoveredLocalRepo[] };
    return data.repos ?? [];
  } catch {
    return [];
  }
}

export async function browseLocalDirectory(
  targetPath?: string,
  showHidden = false,
): Promise<BrowseDirsResponse> {
  const url = new URL('/api/browse-dirs', window.location.origin);
  if (targetPath) url.searchParams.set('path', targetPath);
  if (showHidden) url.searchParams.set('hidden', '1');
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const data = (await res.json()) as BrowseDirsResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Could not read directory.');
  }
  return data;
}

export async function pickNativeMacFolder(): Promise<{ path?: string; cancelled?: boolean }> {
  const res = await fetch('/api/pick-native-folder', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json()) as { path?: string; cancelled?: boolean; error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Native folder picker unavailable.');
  }
  return data;
}

interface LocalRepoApiResponse {
  owner: string;
  repo: string;
  localPath: string;
  currentBranch: string;
  branches: Array<{
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
      filesCount?: number;
      stats?: { additions: number; deletions: number; total: number };
      files?: CommitFileChange[];
    }>;
  }>;
  gateVisitors: GateVisitorFile[];
  totalChangedFiles: number;
  error?: string;
}

export async function loadLocalRepoVillage(
  rawPath: string,
  userSignal?: AbortSignal,
): Promise<RepoVillageGraph> {
  const cleanPath = rawPath.trim().replace(/^local:/i, '') || '.';
  const signal = userSignal
    ? AbortSignal.any([userSignal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);

  const res = await fetch(`/api/local-repo?path=${encodeURIComponent(cleanPath)}`, { signal });
  const payload = (await res.json()) as LocalRepoApiResponse;

  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Could not open local git repo at ${cleanPath}`);
  }

  const commitsBySha = new Map<string, CommitData>();
  const branches: BranchIslandData[] = [];
  const defaultBranch = payload.currentBranch || payload.branches[0]?.name || 'main';

  // Sort so currentBranch is processed first
  const orderedRawBranches = payload.branches.toSorted((a, b) =>
    a.isCurrent ? -1 : b.isCurrent ? 1 : 0,
  );

  let colorIdx = 0;
  for (const bRaw of orderedRawBranches) {
    const uniqueCommits: CommitData[] = [];
    let forkFromSha: string | undefined;

    for (const item of bRaw.commits) {
      if (commitsBySha.has(item.sha)) {
        if (!forkFromSha) forkFromSha = item.sha;
        break;
      }
      const login =
        item.authorEmail.split('@')[0] ||
        item.authorName.toLowerCase().replace(/\s+/g, '-');
      const c: CommitData = {
        sha: item.sha,
        shortSha: item.sha.slice(0, 7),
        subject: item.subject,
        body: item.body,
        authorName: item.authorName,
        authorLogin: login,
        timestamp: item.timestamp,
        branch: bRaw.name,
        parents: item.parents,
        children: [],
        kind: classifyCommitKind(item.subject, item.parents.length),
        filesCount: item.filesCount ?? item.files?.length,
        stats: item.stats,
        files: item.files,
      };
      commitsBySha.set(c.sha, c);
      uniqueCommits.push(c);
    }

    if (bRaw.isCurrent || uniqueCommits.length > 0) {
      const chronological = uniqueCommits.toReversed();
      if (!bRaw.isCurrent && !forkFromSha && chronological.length > 0) {
        forkFromSha = chronological[0].parents.find((p) => commitsBySha.has(p));
      }
      branches.push({
        name: bRaw.name,
        isDefault: bRaw.isCurrent || branches.length === 0,
        color: BRANCH_PALETTE[colorIdx % BRANCH_PALETTE.length],
        commits: chronological,
        forkFromSha,
      });
      colorIdx++;
    }
  }

  // Handle brand-new `git init` repo with 0 commits yet so island + gate still materialize!
  if (branches.length === 0 || (branches.length === 1 && branches[0].commits.length === 0)) {
    const placeholderSha = '0000000initialvillagefoundation0000000000';
    const placeholder: CommitData = {
      sha: placeholderSha,
      shortSha: 'root',
      subject: 'Empty repository — waiting for first commit at the village gate!',
      body: 'Stage and commit your waiting gate visitors to welcome the very first citizens onto the island.',
      authorName: 'Village Founder',
      authorLogin: 'founder',
      timestamp: new Date().toISOString(),
      branch: defaultBranch,
      parents: [],
      children: [],
      kind: 'feat',
    };
    commitsBySha.set(placeholderSha, placeholder);
    branches.splice(0, branches.length, {
      name: defaultBranch,
      isDefault: true,
      color: BRANCH_PALETTE[0],
      commits: [placeholder],
    });
  }

  // Wire children & mergeIntoSha pointers
  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parents) {
      const parent = commitsBySha.get(parentSha);
      if (parent && !parent.children.includes(commit.sha)) {
        parent.children.push(commit.sha);
      }
    }
  }

  for (const b of branches) {
    if (!b.isDefault && b.commits.length > 0) {
      const last = b.commits.at(-1)!;
      b.mergeIntoSha = last.children.find(
        (ch) => commitsBySha.get(ch)?.branch === defaultBranch,
      );
    }
  }

  // Sort gate visitors so Staged (`git add`) visitors stand right at the front of the gate!
  const sortedVisitors = (payload.gateVisitors ?? []).toSorted((a, b) => {
    if (a.staged !== b.staged) return a.staged ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });

  return {
    owner: payload.owner,
    repo: payload.repo,
    description: `Local repository at ${payload.localPath}`,
    defaultBranch,
    currentBranch: payload.currentBranch,
    stars: 0,
    isDemo: false,
    isLocal: true,
    localPath: payload.localPath,
    gateVisitors: sortedVisitors,
    branches,
    commitsBySha,
  };
}

export async function hydrateLocalCommitDetail(
  localPath: string,
  commit: CommitData,
): Promise<void> {
  if (commit.files && commit.stats) return;
  const res = await fetch(
    `/api/local-commit-detail?path=${encodeURIComponent(localPath)}&sha=${encodeURIComponent(commit.sha)}`,
    { signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) return;
  const data = (await res.json()) as {
    stats: CommitData['stats'];
    files: CommitFileChange[];
  };
  commit.stats = data.stats;
  commit.files = data.files;
}
