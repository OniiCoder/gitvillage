import { classifyCommitKind } from './demoRepo';
import { enrichVillageGraphInsights } from './gitInsights';
import type {
  BranchIslandData,
  CiWeatherInfo,
  CommitData,
  CommitFileChange,
  RepoVillageGraph,
  TagMonumentData,
} from '@/types/village';

const BRANCH_PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c'];

export function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    } catch {
      return null;
    }
  }

  const parts = trimmed.replace(/^github\.com\//i, '').split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

async function ghFetch<T>(path: string, token?: string, userSignal?: AbortSignal): Promise<T> {
  const signal = userSignal
    ? AbortSignal.any([userSignal, AbortSignal.timeout(12_000)])
    : AbortSignal.timeout(12_000);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const res = await fetch(`https://api.github.com${path}`, { headers, signal });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          throw new Error(
            'GitHub API rate limit reached (60 req/hr unauthenticated). Add a free GitHub token in Presets → Token or explore the Demo Repo!',
          );
        }
      }
      if (res.status === 404) {
        throw new Error('Repository not found (make sure it is a public GitHub repo).');
      }
      throw new Error(`GitHub API error (${res.status})`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('GitHub API request timed out after 12s.', { cause: err });
    }
    throw err;
  }
}

interface GhRepoResponse {
  name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  stargazers_count: number;
}

interface GhBranchItem {
  name: string;
  commit: { sha: string };
}

interface GhTagItem {
  name: string;
  commit: { sha: string };
}

interface GhCommitItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
  parents: Array<{ sha: string }>;
}

interface GhCommitDetailResponse {
  stats?: { total: number; additions: number; deletions: number };
  files?: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

function toCommitData(item: GhCommitItem, branchName: string): CommitData {
  const rawMsg = item.commit.message ?? '';
  const [firstLine, ...rest] = rawMsg.split('\n');
  const subject = firstLine.trim() || 'Commit';
  const body = rest.join('\n').trim();
  const parents = (item.parents ?? []).map((p) => p.sha);
  const authorName = item.commit.author?.name || item.author?.login || 'Contributor';
  const authorLogin = item.author?.login || authorName.toLowerCase().replace(/\s+/g, '-');

  return {
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    subject,
    body,
    authorName,
    authorLogin,
    authorAvatar: item.author?.avatar_url,
    timestamp: item.commit.author?.date || new Date().toISOString(),
    branch: branchName,
    parents,
    children: [],
    kind: classifyCommitKind(subject, parents.length),
    htmlUrl: item.html_url,
  };
}

function rankBranchCandidate(name: string, defaultBranch: string): number {
  if (name === defaultBranch) return 2000;
  const lower = name.toLowerCase();
  if (/^(split-|copilot\/|dependabot\/|renovate\/)/.test(lower)) return -500;
  if (lower === 'master' || lower === 'main' || lower === 'next' || lower === 'develop' || lower === 'canary') {
    return 1000;
  }
  const relMatch = /^v?(\d+)\.(x|\d+)$/i.exec(name);
  if (relMatch) {
    const major = Number.parseInt(relMatch[1], 10);
    // Prioritize modern major release branches (e.g. 13.x, 12.x, 11.x) over decade-old 4.0/5.0 branches
    return major >= 10 ? 700 + major : 100 + major;
  }
  return 650;
}

export async function loadGitHubRepoVillage(
  owner: string,
  repo: string,
  token?: string,
  userSignal?: AbortSignal,
  targetBranch?: string,
): Promise<RepoVillageGraph> {
  const repoMeta = await ghFetch<GhRepoResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
    userSignal,
  );

  const defaultBranch = repoMeta.default_branch || 'main';
  const activeBranch = targetBranch?.trim() || defaultBranch;

  const [defaultCommitsRaw, branchListRaw, tagsRaw] = await Promise.all([
    ghFetch<GhCommitItem[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(activeBranch)}&per_page=24`,
      token,
      userSignal,
    ),
    ghFetch<GhBranchItem[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
      token,
      userSignal,
    ).catch(() => [] as GhBranchItem[]),
    ghFetch<GhTagItem[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=35`,
      token,
      userSignal,
    ).catch(() => [] as GhTagItem[]),
  ]);

  const commitsBySha = new Map<string, CommitData>();
  const defaultCommits: CommitData[] = [];

  for (const item of defaultCommitsRaw) {
    const c = toCommitData(item, activeBranch);
    commitsBySha.set(c.sha, c);
    defaultCommits.push(c);
  }

  // Pick up to 4 high-signal non-active branches whose tip SHA isn't already on activeBranch
  const sortedBranchCandidates = branchListRaw.toSorted(
    (a, b) => rankBranchCandidate(b.name, defaultBranch) - rankBranchCandidate(a.name, defaultBranch),
  );
  const extraBranches = sortedBranchCandidates
    .filter((b) => b.name !== activeBranch && !commitsBySha.has(b.commit.sha))
    .slice(0, 4);

  const branchResults = await Promise.all(
    extraBranches.map(async (b) => {
      try {
        const items = await ghFetch<GhCommitItem[]>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(b.name)}&per_page=10`,
          token,
          userSignal,
        );
        return { branchName: b.name, items };
      } catch {
        return { branchName: b.name, items: [] as GhCommitItem[] };
      }
    }),
  );

  const branches: BranchIslandData[] = [
    {
      name: activeBranch,
      isDefault: true,
      color: BRANCH_PALETTE[0],
      commits: defaultCommits.toReversed(), // oldest -> newest
    },
  ];

  let colorIdx = 1;
  for (const { branchName, items } of branchResults) {
    const uniqueCommits: CommitData[] = [];
    let forkFromSha: string | undefined;

    for (const item of items) {
      if (commitsBySha.has(item.sha)) {
        if (!forkFromSha) forkFromSha = item.sha;
        break;
      }
      const c = toCommitData(item, branchName);
      commitsBySha.set(c.sha, c);
      uniqueCommits.push(c);
    }

    if (uniqueCommits.length > 0) {
      const chronological = uniqueCommits.toReversed();
      if (!forkFromSha) {
        const oldestParent = chronological[0].parents.find((p) => commitsBySha.has(p));
        forkFromSha = oldestParent ?? defaultCommits.at(Math.floor(defaultCommits.length / 2))?.sha;
      }
      branches.push({
        name: branchName,
        isDefault: false,
        color: BRANCH_PALETTE[colorIdx % BRANCH_PALETTE.length],
        commits: chronological,
        forkFromSha,
      });
      colorIdx++;
    }
  }

  // If the repo only had 1 active branch (common in squash-merge repos), carve out
  // side-district islands for merge PRs or topic scopes so bridges & islands still shine!
  if (branches.length === 1 && defaultCommits.length >= 10) {
    const chronologicalAll = branches[0].commits;
    const sideBuckets = new Map<string, CommitData[]>();

    for (let i = 1; i < chronologicalAll.length - 1; i++) {
      const c = chronologicalAll[i];
      if (c.kind === 'fix' && (sideBuckets.get('hotfix-outpost')?.length ?? 0) < 5) {
        const arr = sideBuckets.get('hotfix-outpost') ?? [];
        arr.push(c);
        sideBuckets.set('hotfix-outpost', arr);
      } else if (
        (c.kind === 'docs' || c.kind === 'refactor') &&
        (sideBuckets.get('scribes-terrace')?.length ?? 0) < 5
      ) {
        const arr = sideBuckets.get('scribes-terrace') ?? [];
        arr.push(c);
        sideBuckets.set('scribes-terrace', arr);
      }
    }

    const movedShas = new Set<string>();
    for (const [districtName, list] of sideBuckets.entries()) {
      if (list.length >= 2) {
        for (const item of list) {
          item.branch = districtName;
          movedShas.add(item.sha);
        }
        const forkCandidate = list[0].parents.find((p) => !movedShas.has(p));
        const mergeCandidate = chronologicalAll.find(
          (mc) => !movedShas.has(mc.sha) && mc.parents.includes(list.at(-1)!.sha),
        )?.sha;

        branches.push({
          name: districtName,
          isDefault: false,
          color: BRANCH_PALETTE[colorIdx % BRANCH_PALETTE.length],
          commits: list,
          forkFromSha: forkCandidate,
          mergeIntoSha: mergeCandidate,
        });
        colorIdx++;
      }
    }

    if (movedShas.size > 0) {
      branches[0].commits = chronologicalAll.filter((c) => !movedShas.has(c.sha));
    }
  }

  // Wire children pointers across all loaded commits
  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parents) {
      const parent = commitsBySha.get(parentSha);
      if (parent && !parent.children.includes(commit.sha)) {
        parent.children.push(commit.sha);
      }
    }
  }

  const allBranches = Array.from(
    new Set([
      defaultBranch,
      activeBranch,
      ...sortedBranchCandidates.map((b) => b.name),
      ...branches.map((b) => b.name),
    ]),
  );

  const matchedTags: TagMonumentData[] = tagsRaw
    .filter((t) => commitsBySha.has(t.commit.sha))
    .slice(0, 6)
    .map((t) => ({ name: t.name, sha: t.commit.sha }));

  return enrichVillageGraphInsights({
    owner: repoMeta.owner.login,
    repo: repoMeta.name,
    description: repoMeta.description || `Floating 3D commit village for ${repoMeta.owner.login}/${repoMeta.name}`,
    defaultBranch,
    currentBranch: activeBranch,
    allBranches,
    stars: repoMeta.stargazers_count ?? 0,
    isDemo: false,
    tags: matchedTags,
    branches,
    commitsBySha,
  });
}

const detailCache = new Map<
  string,
  { filesCount: number; stats: CommitData['stats']; files: CommitFileChange[] }
>();

export async function hydrateCommitDetail(
  owner: string,
  repo: string,
  commit: CommitData,
  token?: string,
): Promise<void> {
  if (commit.patchesHydrated) return;
  const key = `${owner}/${repo}/${commit.sha}`;
  const cached = detailCache.get(key);
  if (cached) {
    commit.filesCount = cached.filesCount;
    commit.stats = cached.stats;
    commit.files = cached.files;
    commit.patchesHydrated = true;
    return;
  }

  const detail = await ghFetch<GhCommitDetailResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commit.sha)}`,
    token,
  );

  const rawFiles = detail.files ?? [];
  const filesCount = rawFiles.length;
  const stats = detail.stats ?? { additions: 0, deletions: 0, total: 0 };
  const files: CommitFileChange[] = rawFiles.slice(0, 40).map((f) => ({
    filename: f.filename,
    previousFilename: f.previous_filename,
    status:
      f.status === 'added' || f.status === 'removed' || f.status === 'renamed'
        ? f.status
        : 'modified',
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  detailCache.set(key, { filesCount, stats, files });
  commit.filesCount = filesCount;
  commit.stats = stats;
  commit.files = files;
  commit.patchesHydrated = true;
}

interface GhCheckRunsResponse {
  total_count: number;
  check_runs?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    html_url?: string;
  }>;
}

interface GhCombinedStatusResponse {
  state: string;
  total_count: number;
  statuses?: Array<{
    state: string;
    context?: string;
    target_url?: string;
  }>;
}

export async function fetchRepoCiWeather(
  owner: string,
  repo: string,
  headSha: string,
  token?: string,
  userSignal?: AbortSignal,
): Promise<CiWeatherInfo> {
  const encOwner = encodeURIComponent(owner);
  const encRepo = encodeURIComponent(repo);
  const encSha = encodeURIComponent(headSha);

  try {
    const checks = await ghFetch<GhCheckRunsResponse>(
      `/repos/${encOwner}/${encRepo}/commits/${encSha}/check-runs?per_page=30`,
      token,
      userSignal,
    );

    const runs = checks.check_runs ?? [];
    if (runs.length > 0) {
      let failing = 0;
      let pending = 0;
      let passing = 0;

      for (const r of runs) {
        if (r.status !== 'completed') {
          pending++;
        } else if (
          r.conclusion === 'failure' ||
          r.conclusion === 'timed_out' ||
          r.conclusion === 'action_required' ||
          r.conclusion === 'startup_failure'
        ) {
          failing++;
        } else if (r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped') {
          passing++;
        }
      }

      const htmlUrl = runs[0]?.html_url || `https://github.com/${owner}/${repo}/commit/${headSha}`;

      if (failing > 0) {
        return {
          status: 'failing',
          summary: `${failing} CI check${failing === 1 ? '' : 's'} failing`,
          sha: headSha,
          htmlUrl,
        };
      }
      if (pending > 0) {
        return {
          status: 'pending',
          summary: `${pending} CI check${pending === 1 ? '' : 's'} running`,
          sha: headSha,
          htmlUrl,
        };
      }
      return {
        status: 'passing',
        summary: `${passing} CI check${passing === 1 ? '' : 's'} passing`,
        sha: headSha,
        htmlUrl,
      };
    }

    // Fallback to combined commit status endpoint (CircleCI, Vercel, Buildkite, etc.)
    const combined = await ghFetch<GhCombinedStatusResponse>(
      `/repos/${encOwner}/${encRepo}/commits/${encSha}/status`,
      token,
      userSignal,
    );
    if ((combined.total_count ?? 0) > 0) {
      const targetUrl =
        combined.statuses?.[0]?.target_url || `https://github.com/${owner}/${repo}/commit/${headSha}`;
      if (combined.state === 'failure' || combined.state === 'error') {
        return { status: 'failing', summary: 'Commit status failing', sha: headSha, htmlUrl: targetUrl };
      }
      if (combined.state === 'pending') {
        return { status: 'pending', summary: 'Commit checks pending', sha: headSha, htmlUrl: targetUrl };
      }
      if (combined.state === 'success') {
        return { status: 'passing', summary: `${combined.total_count} status checks passing`, sha: headSha, htmlUrl: targetUrl };
      }
    }
  } catch {
    // Non-fatal: rate-limited or checks unavailable
  }

  return {
    status: 'unknown',
    summary: 'No CI checks reported',
    sha: headSha,
  };
}
