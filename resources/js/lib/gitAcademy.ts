import { enrichVillageGraphInsights } from '@/lib/gitInsights';
import type {
  BranchIslandData,
  CommitData,
  CommitKind,
  GateVisitorFile,
  MergeConflictInfo,
  RepoVillageGraph,
  StashEntryData,
  TagMonumentData,
} from '@/types/village';

export type AcademyTier = 'Beginner' | 'Intermediate' | 'Advanced';

export type AcademyFocusHint =
  | 'overview'
  | 'gate'
  | 'head'
  | 'conflict'
  | 'stash'
  | 'ghosts'
  | 'bisect';

export interface AcademyStepSpec {
  id: string;
  instruction: string;
  visualCue: string;
  command: string;
  actionLabel: string;
  focusAfter: AcademyFocusHint;
  run: (state: AcademySandboxState) => { next: AcademySandboxState; output: string };
  matchesCli?: (normalizedCmd: string) => boolean;
}

export interface AcademyChapterSpec {
  number: number;
  id: string;
  tier: AcademyTier;
  emoji: string;
  title: string;
  conceptSummary: string;
  focusOnEnter: AcademyFocusHint;
  createInitialState: () => AcademySandboxState;
  steps: AcademyStepSpec[];
}

export interface TerminalEntry {
  id: number;
  cmd: string;
  output: string;
  isError?: boolean;
}

export interface AcademySandboxState {
  initialized: boolean;
  currentBranch: string;
  branchOrder: string[];
  branchColors: Record<string, string>;
  branchHeads: Record<string, string | null>;
  branchForkBase: Record<string, string | null>;
  branchMergedInto: Record<string, string | null>;
  commits: CommitData[];
  gateFiles: GateVisitorFile[];
  tags: TagMonumentData[];
  stashes: StashEntryData[];
  ghostCommits: CommitData[];
  cherryPickPairs: Array<{ fromSha: string; toSha: string }>;
  mergeConflict?: MergeConflictInfo;
  bisectRequested?: boolean;
  seq: number;
  terminal: TerminalEntry[];
}

export interface AcademyProgressSnapshot {
  active: boolean;
  chapterNumber: number;
  stepIndex: number;
  completedChapters: number[];
  chapterDone: boolean;
  initialized: boolean;
  currentBranch: string;
  terminal: TerminalEntry[];
}

const BRANCH_PALETTE = ['#34d399', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#2dd4bf'];

const LEARNERS = [
  { name: 'Alex Apprentice', login: 'you-dev' },
  { name: 'Mira Lin', login: 'mira-lin' },
  { name: 'Kael Vance', login: 'kael-voxel' },
];

function makeSha(seed: string, seq: number): string {
  let h1 = 0x811c9dc5;
  const input = `${seed}::${seq}`;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const base = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${base}${seq.toString(16).padStart(4, '0')}a7b3c9d1e5f2048613579bdf0246`.slice(0, 40);
}

function inferKind(subject: string, isMerge = false): CommitKind {
  if (isMerge || /^merge\b/i.test(subject)) return 'merge';
  if (/^fix\b|bug|clamp|patch|hotfix/i.test(subject)) return 'fix';
  if (/^docs?\b|readme|guide/i.test(subject)) return 'docs';
  if (/^refactor\b|clean/i.test(subject)) return 'refactor';
  return 'feat';
}

function cloneState(s: AcademySandboxState): AcademySandboxState {
  return {
    ...s,
    branchOrder: [...s.branchOrder],
    branchColors: { ...s.branchColors },
    branchHeads: { ...s.branchHeads },
    branchForkBase: { ...s.branchForkBase },
    branchMergedInto: { ...s.branchMergedInto },
    commits: s.commits.map((c) => ({
      ...c,
      parents: [...c.parents],
      children: [...c.children],
      files: c.files ? c.files.map((f) => ({ ...f })) : undefined,
    })),
    gateFiles: s.gateFiles.map((g) => ({ ...g })),
    tags: s.tags.map((t) => ({ ...t })),
    stashes: s.stashes.map((st) => ({ ...st })),
    ghostCommits: s.ghostCommits.map((g) => ({ ...g, parents: [...g.parents], children: [] })),
    cherryPickPairs: s.cherryPickPairs.map((p) => ({ ...p })),
    mergeConflict: s.mergeConflict ? { ...s.mergeConflict } : undefined,
    terminal: s.terminal.slice(-8),
  };
}

function appendLog(
  s: AcademySandboxState,
  cmd: string,
  output: string,
  isError = false,
): AcademySandboxState {
  const id = s.seq + 1000 + s.terminal.length;
  s.terminal = [...s.terminal.slice(-6), { id, cmd, output, isError }];
  return s;
}

function createBaseEmptyState(initialized = true): AcademySandboxState {
  return {
    initialized,
    currentBranch: 'main',
    branchOrder: ['main'],
    branchColors: { main: '#34d399' },
    branchHeads: { main: null },
    branchForkBase: { main: null },
    branchMergedInto: {},
    commits: [],
    gateFiles: [],
    tags: [],
    stashes: [],
    ghostCommits: [],
    cherryPickPairs: [],
    seq: 1,
    terminal: [],
  };
}

function addCommitToState(
  s: AcademySandboxState,
  opts: {
    branch?: string;
    subject: string;
    body?: string;
    authorIdx?: number;
    extraParentSha?: string | null;
    files?: Array<{ filename: string; additions: number; deletions: number; patch?: string }>;
    isRebasedClone?: boolean;
    rebasedFromSha?: string;
    cherryPickTwinSha?: string;
  },
): CommitData {
  const branch = opts.branch ?? s.currentBranch;
  if (!s.branchOrder.includes(branch)) {
    s.branchOrder.push(branch);
    s.branchColors[branch] = BRANCH_PALETTE[(s.branchOrder.length - 1) % BRANCH_PALETTE.length];
    s.branchHeads[branch] = s.branchHeads[s.currentBranch] ?? null;
    s.branchForkBase[branch] = s.branchHeads[s.currentBranch] ?? null;
  }

  const seq = s.seq++;
  const sha = makeSha(`${branch}:${opts.subject}`, seq);
  const parentSha = s.branchHeads[branch] ?? null;
  const parents: string[] = [];
  if (parentSha) parents.push(parentSha);
  if (opts.extraParentSha && !parents.includes(opts.extraParentSha)) {
    parents.push(opts.extraParentSha);
  }

  const author = LEARNERS[(opts.authorIdx ?? 0) % LEARNERS.length];
  const filesList = (opts.files ?? [{ filename: 'src/village.ts', additions: 24, deletions: 2 }]).map(
    (f) => ({
      filename: f.filename,
      status: 'modified' as const,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? `@@ -1,3 +1,${Math.max(3, f.additions)} @@\n+// ${opts.subject}\n+export const step = ${seq};`,
    }),
  );
  const additions = filesList.reduce((acc, f) => acc + f.additions, 0);
  const deletions = filesList.reduce((acc, f) => acc + f.deletions, 0);

  const commit: CommitData = {
    sha,
    shortSha: sha.slice(0, 7),
    subject: opts.subject,
    body: opts.body ?? '',
    authorName: author.name,
    authorLogin: author.login,
    timestamp: new Date(Date.now() - Math.max(0, 30 - seq) * 60_000).toISOString(),
    branch,
    parents,
    children: [],
    kind: inferKind(opts.subject, parents.length > 1),
    filesCount: filesList.length,
    stats: { additions, deletions, total: additions + deletions },
    files: filesList,
    patchesHydrated: true,
    isRebasedClone: opts.isRebasedClone,
    rebasedFromSha: opts.rebasedFromSha,
    cherryPickTwinSha: opts.cherryPickTwinSha,
  };

  for (const pSha of parents) {
    const p = s.commits.find((c) => c.sha === pSha);
    if (p && !p.children.includes(sha)) {
      p.children.push(sha);
    }
  }

  s.commits.push(commit);
  s.branchHeads[branch] = sha;
  return commit;
}

function seedStarterMainCommits(count = 2): AcademySandboxState {
  const s = createBaseEmptyState(true);
  addCommitToState(s, {
    subject: 'feat: lay cobblestone plaza & town hall',
    authorIdx: 0,
    files: [{ filename: 'src/plaza.ts', additions: 42, deletions: 0 }],
  });
  if (count >= 2) {
    addCommitToState(s, {
      subject: 'feat: build wooden windmill on western hill',
      authorIdx: 1,
      files: [{ filename: 'src/windmill.ts', additions: 58, deletions: 4 }],
    });
  }
  if (count >= 3) {
    addCommitToState(s, {
      subject: 'fix: balance windmill sail rotation speed',
      authorIdx: 2,
      files: [{ filename: 'src/windmill.ts', additions: 9, deletions: 6 }],
    });
  }
  return s;
}

/**
 * Compile an `AcademySandboxState` into a full `RepoVillageGraph` ready for 3D WebGL rendering!
 */
export function compileAcademyGraph(state: AcademySandboxState): RepoVillageGraph {
  const commitsBySha = new Map<string, CommitData>();
  for (const c of state.commits) {
    commitsBySha.set(c.sha, { ...c, children: [...c.children] });
  }

  // Filter reachable commits per branch so `git reset --hard` genuinely removes orphaned commits from active islands!
  const reachableOnMain = new Set<string>();
  const walkAncestors = (startSha: string | null | undefined, bucket: Set<string>) => {
    const stack = startSha ? [startSha] : [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (bucket.has(cur)) continue;
      bucket.add(cur);
      const node = commitsBySha.get(cur);
      if (node) {
        for (const p of node.parents) stack.push(p);
      }
    }
  };
  walkAncestors(state.branchHeads.main, reachableOnMain);

  const branches: BranchIslandData[] = [];
  for (const brName of state.branchOrder) {
    const isDefault = brName === 'main';
    let brCommits: CommitData[];

    if (isDefault) {
      brCommits = state.commits
        .filter((c) => c.branch === 'main' && reachableOnMain.has(c.sha))
        .map((c) => commitsBySha.get(c.sha)!);
    } else {
      const reachableBr = new Set<string>();
      walkAncestors(state.branchHeads[brName], reachableBr);
      brCommits = state.commits
        .filter((c) => c.branch === brName && reachableBr.has(c.sha))
        .map((c) => commitsBySha.get(c.sha)!);
    }

    branches.push({
      name: brName,
      isDefault,
      color: state.branchColors[brName] ?? '#60a5fa',
      commits: brCommits,
      forkFromSha: isDefault ? undefined : (state.branchForkBase[brName] ?? undefined),
      mergeIntoSha: isDefault ? undefined : (state.branchMergedInto[brName] ?? undefined),
    });
  }

  // Keep only reachable commits in `commitsBySha`
  const activeShas = new Set<string>();
  for (const b of branches) {
    for (const c of b.commits) activeShas.add(c.sha);
  }
  for (const k of [...commitsBySha.keys()]) {
    if (!activeShas.has(k)) commitsBySha.delete(k);
  }

  // Ensure currentBranch is first or highlighted properly via headBranch/currentBranch
  const graph: RepoVillageGraph = {
    owner: 'academy',
    repo: 'git-dojo',
    description: 'Interactive 3D Git Academy Sandbox',
    defaultBranch: 'main',
    currentBranch: state.currentBranch,
    headBranch: state.currentBranch,
    allBranches: [...state.branchOrder],
    stars: 100,
    isDemo: false,
    isLocal: true, // Always build the 3D Village Gate + Staging Queue in Academy Mode!
    isAcademy: true,
    gateVisitors: state.gateFiles,
    mergeConflict: state.mergeConflict,
    tags: state.tags,
    stashes: state.stashes,
    ghostCommits: state.ghostCommits,
    cherryPickPairs: state.cherryPickPairs,
    branches,
    commitsBySha,
  };

  return enrichVillageGraphInsights(graph);
}

/**
 * All 10 Progressive Hands-On 3D Git Chapters (Simple -> Complex)
 */
export const ACADEMY_CHAPTERS: AcademyChapterSpec[] = [
  // CHAPTER 1 — git init
  {
    number: 1,
    id: 'init',
    tier: 'Beginner',
    emoji: '🌱',
    title: 'git init — Birth of a Repository',
    conceptSummary:
      'Before Git tracks a folder, your project is just loose files in the clouds. Running `git init` creates the hidden `.git` vault — raising your floating `main` island and Village Gate.',
    focusOnEnter: 'overview',
    createInitialState: () => {
      const s = createBaseEmptyState(false);
      appendLog(s, 'pwd', '~/my-sky-app (not a git repository yet)');
      return s;
    },
    steps: [
      {
        id: 'c1-s1',
        instruction:
          'Notice the empty sky — there is no island yet! Run `git init` to initialize `.git/` and raise your `main` branch island + Village Gate.',
        visualCue: 'Watch a brand-new Floating Island and Village Gate materialize out of the mist!',
        command: 'git init',
        actionLabel: 'Run: git init',
        focusAfter: 'gate',
        matchesCli: (cmd) => /^git\s+init\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.initialized = true;
          const out = 'Initialized empty Git repository in ~/my-sky-app/.git/ (branch: main)';
          appendLog(next, 'git init', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 2 — Working Directory -> Staging Area -> git commit
  {
    number: 2,
    id: 'staging-commit',
    tier: 'Beginner',
    emoji: '🚪',
    title: 'The 3 Trees — Working, Stage & Commit',
    conceptSummary:
      'Git has 3 zones: the Working Directory (edited files waiting outside the Village Gate), the Staging Index (`git add` gives files a Golden Ticket), and History (`git commit` opens the Gate!).',
    focusOnEnter: 'gate',
    createInitialState: () => {
      const s = createBaseEmptyState(true);
      s.gateFiles = [
        {
          filename: 'index.html',
          status: 'added',
          staged: false,
          additions: 28,
          deletions: 0,
          diffPreview: '@@ -0,0 +1,4 @@\n+<h1>Welcome to Sky Village</h1>',
        },
        {
          filename: 'styles.css',
          status: 'added',
          staged: false,
          additions: 19,
          deletions: 0,
          diffPreview: '@@ -0,0 +1,4 @@\n+body { background: skyblue; }',
        },
      ];
      appendLog(s, 'git status -s', '?? index.html\n?? styles.css  (2 untracked files waiting outside Gate)');
      return s;
    },
    steps: [
      {
        id: 'c2-s1',
        instruction:
          'Look at the 2 file visitors (`index.html` & `styles.css`) waiting outside the closed Village Gate. Run `git add .` to hand them Golden Staging Tickets!',
        visualCue: 'Watch both Gate visitors step forward and raise glowing Golden Tickets.',
        command: 'git add .',
        actionLabel: 'Run: git add .',
        focusAfter: 'gate',
        matchesCli: (cmd) => /^git\s+add\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.gateFiles = next.gateFiles.map((f) => ({ ...f, staged: true }));
          const out = 'Staged 2 files (index.html, styles.css) into .git/index — ready at the Gate!';
          appendLog(next, 'git add .', out);
          return { next, output: out };
        },
      },
      {
        id: 'c2-s2',
        instruction:
          'Now snapshot the staged files permanently into Git history! Run `git commit -m "feat: launch sky village"` to swing open the Village Gate.',
        visualCue: 'The Gate doors open and your staged files become a permanent 3D Commit Citizen on `main`!',
        command: 'git commit -m "feat: launch sky village"',
        actionLabel: 'Run: git commit',
        focusAfter: 'head',
        matchesCli: (cmd) => /^git\s+commit\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.gateFiles = [];
          const c = addCommitToState(next, {
            subject: 'feat: launch sky village',
            files: [
              { filename: 'index.html', additions: 28, deletions: 0 },
              { filename: 'styles.css', additions: 19, deletions: 0 },
            ],
          });
          const out = `[main (root-commit) ${c.shortSha}] feat: launch sky village (2 files, +47)`;
          appendLog(next, 'git commit -m "feat: launch sky village"', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 3 — Commits, Parent Chains & Release Tags
  {
    number: 3,
    id: 'commits-tags',
    tier: 'Beginner',
    emoji: '🏷️',
    title: 'Commits, HEAD & Release Tags',
    conceptSummary:
      'Every new commit stores a cryptographic pointer to its parent commit, forming a chain along the road. `HEAD` is the glowing cyan crystal marking where you stand, and `git tag` builds a permanent milestone archway.',
    focusOnEnter: 'overview',
    createInitialState: () => seedStarterMainCommits(2),
    steps: [
      {
        id: 'c3-s1',
        instruction:
          'Add one more commit onto `main` so `HEAD` advances forward along the stone promenade.',
        visualCue: 'A 3rd citizen spawns at the East end of `main` and the glowing cyan `HEAD` crystal moves to it.',
        command: 'git commit -am "feat: light village lanterns"',
        actionLabel: 'Run: git commit -am "…"',
        focusAfter: 'head',
        matchesCli: (cmd) => /^git\s+commit\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const c = addCommitToState(next, {
            subject: 'feat: light village lanterns',
            authorIdx: 2,
            files: [{ filename: 'src/lanterns.ts', additions: 34, deletions: 2 }],
          });
          const out = `[main ${c.shortSha}] feat: light village lanterns (parent -> ${c.parents[0]?.slice(0, 7)})`;
          appendLog(next, 'git commit -am "feat: light village lanterns"', out);
          return { next, output: out };
        },
      },
      {
        id: 'c3-s2',
        instruction:
          'Freeze this milestone with a release tag! Run `git tag v1.0.0` to erect a Golden Torii Archway over `HEAD`.',
        visualCue: 'A Golden Release Archway (`v1.0.0`) rises right over your latest commit on `main`!',
        command: 'git tag v1.0.0',
        actionLabel: 'Run: git tag v1.0.0',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+tag\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const headSha = next.branchHeads[next.currentBranch];
          if (headSha) {
            next.tags.push({ name: 'v1.0.0', sha: headSha });
          }
          const out = `Tagged commit ${headSha?.slice(0, 7)} as release milestone v1.0.0`;
          appendLog(next, 'git tag v1.0.0', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 4 — git branch & git switch
  {
    number: 4,
    id: 'branching',
    tier: 'Intermediate',
    emoji: '🌿',
    title: 'Branches — Parallel Floating Islands',
    conceptSummary:
      'In Git, a branch is just a lightweight movable pointer — not a slow folder copy! Creating a branch sprouts a parallel floating island linked by a Wooden Fork Bridge so you can experiment safely.',
    focusOnEnter: 'overview',
    createInitialState: () => seedStarterMainCommits(2),
    steps: [
      {
        id: 'c4-s1',
        instruction:
          'Create and switch to a feature branch in one command: `git switch -c feat/glider`!',
        visualCue: 'A new floating island (`feat/glider`) + Fork Bridge sprout beside `main`!',
        command: 'git switch -c feat/glider',
        actionLabel: 'Run: git switch -c feat/glider',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+(switch\s+-c|checkout\s+-b|branch)\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const baseSha = next.branchHeads.main;
          next.branchOrder.push('feat/glider');
          next.branchColors['feat/glider'] = '#60a5fa';
          next.branchHeads['feat/glider'] = baseSha;
          next.branchForkBase['feat/glider'] = baseSha;
          next.currentBranch = 'feat/glider';
          // Add initial feature commit so the island springs into 3D life immediately
          const c = addCommitToState(next, {
            branch: 'feat/glider',
            subject: 'feat(glider): craft balsa wood wing frame',
            authorIdx: 0,
            files: [{ filename: 'src/glider.ts', additions: 64, deletions: 0 }],
          });
          const out = `Switched to a new branch 'feat/glider' ([${c.shortSha}] craft balsa wood wing frame)`;
          appendLog(next, 'git switch -c feat/glider', out);
          return { next, output: out };
        },
      },
      {
        id: 'c4-s2',
        instruction:
          'Ship a second commit onto `feat/glider` — notice how `main` stays untouched while your feature island grows independently!',
        visualCue: 'A second builder citizen joins the `feat/glider` island across the Fork Bridge.',
        command: 'git commit -am "feat(glider): add updraft boost physics"',
        actionLabel: 'Run: git commit on feat/glider',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+commit\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const c = addCommitToState(next, {
            branch: 'feat/glider',
            subject: 'feat(glider): add updraft boost physics',
            authorIdx: 2,
            files: [{ filename: 'src/glider.ts', additions: 41, deletions: 5 }],
          });
          const out = `[feat/glider ${c.shortSha}] feat(glider): add updraft boost physics`;
          appendLog(next, 'git commit -am "feat(glider): add updraft boost physics"', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 5 — git merge (3-Way Merge Bridge)
  {
    number: 5,
    id: 'merging',
    tier: 'Intermediate',
    emoji: '🌉',
    title: 'git merge — Uniting Diverged Timelines',
    conceptSummary:
      'When both `main` and a feature branch have new commits, `git merge` performs a 3-way merge: creating a special Merge Commit with TWO parents and building a Suspension Bridge back onto `main`.',
    focusOnEnter: 'overview',
    createInitialState: () => {
      const s = seedStarterMainCommits(2);
      const baseSha = s.branchHeads.main;
      s.branchOrder.push('feat/bakery');
      s.branchColors['feat/bakery'] = '#c084fc';
      s.branchHeads['feat/bakery'] = baseSha;
      s.branchForkBase['feat/bakery'] = baseSha;
      addCommitToState(s, {
        branch: 'feat/bakery',
        subject: 'feat(bakery): build stone sourdough oven',
        authorIdx: 1,
      });
      // Advance main too so timelines genuinely diverge!
      addCommitToState(s, {
        branch: 'main',
        subject: 'docs: add village map signboard on main',
        authorIdx: 2,
      });
      s.currentBranch = 'main';
      return s;
    },
    steps: [
      {
        id: 'c5-s1',
        instruction:
          '`main` and `feat/bakery` have diverged! Run `git merge feat/bakery` on `main` to weave both histories together.',
        visualCue: 'Watch a Wooden Merge Bridge connect `feat/bakery` back to `main` at a new Merge Mayor villager!',
        command: 'git merge feat/bakery',
        actionLabel: 'Run: git merge feat/bakery',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+merge\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.currentBranch = 'main';
          const featTip = next.branchHeads['feat/bakery'];
          const mergeCommit = addCommitToState(next, {
            branch: 'main',
            subject: "Merge branch 'feat/bakery' into main",
            authorIdx: 0,
            extraParentSha: featTip,
            files: [{ filename: 'src/bakery.ts', additions: 52, deletions: 0 }],
          });
          next.branchMergedInto['feat/bakery'] = mergeCommit.sha;
          const out = `Merge made by the 'ort' strategy -> [${mergeCommit.shortSha}] (2 parents united!)`;
          appendLog(next, 'git merge feat/bakery', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 6 — Merge Conflicts (OURS vs THEIRS)
  {
    number: 6,
    id: 'conflicts',
    tier: 'Intermediate',
    emoji: '⚔️',
    title: 'Merge Conflicts — Resolving Clashing Edits',
    conceptSummary:
      'Conflicts aren\'t errors — they happen when two branches edit the exact same lines of the same file. Git pauses mid-merge (`<<<<<<< HEAD` vs `>>>>>>> branch`) and asks YOU to pick the winning code.',
    focusOnEnter: 'overview',
    createInitialState: () => {
      const s = seedStarterMainCommits(2);
      const baseSha = s.branchHeads.main;
      s.branchOrder.push('feat/eu-tax');
      s.branchColors['feat/eu-tax'] = '#fb923c';
      s.branchHeads['feat/eu-tax'] = baseSha;
      s.branchForkBase['feat/eu-tax'] = baseSha;
      addCommitToState(s, {
        branch: 'feat/eu-tax',
        subject: 'feat(tax): set taxRate = 0.21 for EU VAT',
        authorIdx: 1,
        files: [{ filename: 'src/taxConfig.ts', additions: 4, deletions: 1 }],
      });
      addCommitToState(s, {
        branch: 'main',
        subject: 'fix(tax): set taxRate = 0.0825 for US sales tax',
        authorIdx: 0,
        files: [{ filename: 'src/taxConfig.ts', additions: 4, deletions: 1 }],
      });
      s.currentBranch = 'main';
      return s;
    },
    steps: [
      {
        id: 'c6-s1',
        instruction:
          'Both `main` and `feat/eu-tax` modified `taxRate` in `src/taxConfig.ts`! Run `git merge feat/eu-tax` to see what happens in 3D.',
        visualCue: 'Storm clouds gather, the Merge Bridge fractures mid-air, and dueling Blue vs Orange twins clash at the Gate!',
        command: 'git merge feat/eu-tax',
        actionLabel: 'Run: git merge feat/eu-tax',
        focusAfter: 'conflict',
        matchesCli: (cmd) => /^git\s+merge\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const featTip = next.branchHeads['feat/eu-tax'] ?? undefined;
          next.mergeConflict = {
            active: true,
            oursBranch: 'main',
            theirsBranch: 'feat/eu-tax',
            conflictedCount: 1,
            mergeHeadSha: featTip,
            isSimulated: true,
          };
          next.gateFiles = [
            {
              filename: 'src/taxConfig.ts',
              status: 'conflicted',
              staged: false,
              additions: 6,
              deletions: 2,
              diffPreview:
                '@@ -1,4 +1,8 @@\n+<<<<<<< HEAD (main)\n+export const taxRate = 0.0825;\n+=======\n+export const taxRate = 0.21;\n+>>>>>>> feat/eu-tax',
              conflict: {
                oursLabel: 'main (HEAD)',
                theirsLabel: 'feat/eu-tax',
                oursContent: 'export const taxRate = 0.0825;\nexport const region = "US";',
                theirsContent: 'export const taxRate = 0.21;\nexport const region = "EU";',
                conflictMarkersCount: 1,
              },
            },
          ];
          const out = 'CONFLICT (content): Merge conflict in src/taxConfig.ts — fix conflicts and commit!';
          appendLog(next, 'git merge feat/eu-tax', out, true);
          return { next, output: out };
        },
      },
      {
        id: 'c6-s2',
        instruction:
          'Edit `src/taxConfig.ts` to support regional rates, then stage & commit the resolution (`git add src/taxConfig.ts && git commit`)!',
        visualCue: 'The fractured bridge planks heal in mid-air, storm clouds clear, and the Merge Citizen enters `main`!',
        command: 'git add src/taxConfig.ts && git commit -m "fix: unify US & EU tax rates"',
        actionLabel: 'Resolve Conflict & Commit',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+(add|commit)\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.mergeConflict = undefined;
          next.gateFiles = [];
          const featTip = next.branchHeads['feat/eu-tax'];
          const mc = addCommitToState(next, {
            branch: 'main',
            subject: 'fix: unify US & EU regional tax rates',
            authorIdx: 0,
            extraParentSha: featTip,
            files: [{ filename: 'src/taxConfig.ts', additions: 8, deletions: 2 }],
          });
          next.branchMergedInto['feat/eu-tax'] = mc.sha;
          const out = `[main ${mc.shortSha}] Conflict resolved! Bridge healed & sunny sky restored.`;
          appendLog(next, 'git add src/taxConfig.ts && git commit', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 7 — git stash & git stash pop
  {
    number: 7,
    id: 'stash',
    tier: 'Advanced',
    emoji: '📦',
    title: 'git stash — Secret Pocket Treasure Chests',
    conceptSummary:
      'Halfway through messy edits when an urgent bug strikes? `git stash` tucks your uncommitted Gate files into a hidden `.git/refs/stash` chest so your working tree is spotless, then `git stash pop` unpacks them!',
    focusOnEnter: 'gate',
    createInitialState: () => {
      const s = seedStarterMainCommits(2);
      s.gateFiles = [
        {
          filename: 'src/rainbowShader.glsl',
          status: 'modified',
          staged: false,
          additions: 45,
          deletions: 3,
          diffPreview: '@@ -1,3 +1,8 @@\n+// Half-finished rainbow shader WIP',
        },
      ];
      return s;
    },
    steps: [
      {
        id: 'c7-s1',
        instruction:
          '`rainbowShader.glsl` is half-finished at the Gate, and you need a clean working tree! Run `git stash push -m "wip: rainbow shader"` to pack it into a chest.',
        visualCue: 'The Gate clears instantly and a Wood-and-Brass Treasure Chest (`stash@{0}`) appears on `main`!',
        command: 'git stash push -m "wip: rainbow shader"',
        actionLabel: 'Run: git stash',
        focusAfter: 'stash',
        matchesCli: (cmd) => /^git\s+stash(\s+push|\s+save|\s*$)/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.gateFiles = [];
          next.stashes = [
            {
              index: 0,
              selector: 'stash@{0}',
              message: 'wip: rainbow shader',
              sha: makeSha('stash0', next.seq++),
              timestamp: new Date().toISOString(),
              branch: 'main',
              filesCount: 1,
            },
          ];
          const out = 'Saved working directory and index state On main: wip: rainbow shader (stash@{0})';
          appendLog(next, 'git stash push -m "wip: rainbow shader"', out);
          return { next, output: out };
        },
      },
      {
        id: 'c7-s2',
        instruction:
          'Ready to resume your shader? Run `git stash pop` to pop open the chest and restore your work back to the Village Gate!',
        visualCue: 'The chest disappears from `.git/refs/stash` and `rainbowShader.glsl` returns to the Gate!',
        command: 'git stash pop',
        actionLabel: 'Run: git stash pop',
        focusAfter: 'gate',
        matchesCli: (cmd) => /^git\s+stash\s+(pop|apply)\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.stashes = [];
          next.gateFiles = [
            {
              filename: 'src/rainbowShader.glsl',
              status: 'modified',
              staged: false,
              additions: 45,
              deletions: 3,
              diffPreview: '@@ -1,3 +1,8 @@\n+// Restored from stash@{0}!',
            },
          ];
          const out = 'Dropped refs/stash@{0} — restored src/rainbowShader.glsl to Working Tree!';
          appendLog(next, 'git stash pop', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 8 — git rebase (Linear History & SHA Cloning)
  {
    number: 8,
    id: 'rebase',
    tier: 'Advanced',
    emoji: '🧬',
    title: 'git rebase — Replaying Commits Linearly',
    conceptSummary:
      'Unlike `git merge` (which builds a bridge), `git rebase main` lifts your branch\'s commits and replays them one-by-one on top of `main` with BRAND-NEW commit SHAs — leaving the old SHAs behind in the Reflog Ghost Ruins!',
    focusOnEnter: 'overview',
    createInitialState: () => {
      const s = seedStarterMainCommits(2);
      const oldBase = s.commits[0].sha;
      s.branchOrder.push('feat/compass');
      s.branchColors['feat/compass'] = '#2dd4bf';
      s.branchHeads['feat/compass'] = oldBase;
      s.branchForkBase['feat/compass'] = oldBase;
      addCommitToState(s, {
        branch: 'feat/compass',
        subject: 'feat(compass): add magnetic north needle',
        authorIdx: 1,
      });
      addCommitToState(s, {
        branch: 'feat/compass',
        subject: 'feat(compass): add Brass bezel ring',
        authorIdx: 1,
      });
      // Advance main further ahead!
      addCommitToState(s, {
        branch: 'main',
        subject: 'feat(harbor): build sky-dock pier on main',
        authorIdx: 2,
      });
      s.currentBranch = 'feat/compass';
      return s;
    },
    steps: [
      {
        id: 'c8-s1',
        instruction:
          '`feat/compass` forked from an old commit while `main` moved ahead. Run `git rebase main` to replay those 2 commits cleanly onto the tip of `main`!',
        visualCue: '2 cloned commits appear linearly at the tip of `main` while the original 2 drift down to the Purple Reflog Ghost Ruins!',
        command: 'git rebase main',
        actionLabel: 'Run: git rebase main',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+rebase\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const origBranchCommits = next.commits.filter((c) => c.branch === 'feat/compass');
          // Remove feat/compass island and replay onto main tip as new SHAs!
          next.branchOrder = next.branchOrder.filter((b) => b !== 'feat/compass');
          next.commits = next.commits.filter((c) => c.branch !== 'feat/compass');
          next.currentBranch = 'main';

          for (const orig of origBranchCommits) {
            next.ghostCommits.push({
              ...orig,
              branch: 'ghost-ruins',
              isGhost: true,
              reflogAction: 'git rebase',
            });
            addCommitToState(next, {
              branch: 'main',
              subject: orig.subject,
              authorIdx: 1,
              isRebasedClone: true,
              rebasedFromSha: orig.sha,
            });
          }
          const out = `Successfully rebased and updated refs/heads/feat/compass -> 2 new SHAs cloned linearly; 2 originals in reflog!`;
          appendLog(next, 'git rebase main', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 9 — git cherry-pick (Cross-Branch Sky Portal)
  {
    number: 9,
    id: 'cherry-pick',
    tier: 'Advanced',
    emoji: '🍒',
    title: 'git cherry-pick — Surgical Commit Teleportation',
    conceptSummary:
      'What if an experimental branch has 1 urgent bugfix you need on `main` right now, without merging the unfinished experiments? `git cherry-pick <sha>` copies just that single commit across islands via a Sky Portal!',
    focusOnEnter: 'overview',
    createInitialState: () => {
      const s = seedStarterMainCommits(2);
      const base = s.branchHeads.main;
      s.branchOrder.push('feat/lab-v2');
      s.branchColors['feat/lab-v2'] = '#f472b6';
      s.branchHeads['feat/lab-v2'] = base;
      s.branchForkBase['feat/lab-v2'] = base;
      addCommitToState(s, {
        branch: 'feat/lab-v2',
        subject: 'wip: unstable antigravity reactor',
        authorIdx: 2,
      });
      addCommitToState(s, {
        branch: 'feat/lab-v2',
        subject: 'fix(bridge): clamp rope tension overflow',
        authorIdx: 1,
      });
      s.currentBranch = 'main';
      return s;
    },
    steps: [
      {
        id: 'c9-s1',
        instruction:
          'Pluck ONLY the critical `fix(bridge)` commit from `feat/lab-v2` onto `main` — leaving `wip: unstable reactor` behind!',
        visualCue: 'A luminous Cyan-Magenta Sky Portal Arc connects the original bugfix on `feat/lab-v2` to its twin on `main`!',
        command: 'git cherry-pick feat/lab-v2',
        actionLabel: 'Run: git cherry-pick',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+cherry-pick\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const sourceFix = next.commits.find((c) => c.branch === 'feat/lab-v2' && c.kind === 'fix');
          const twin = addCommitToState(next, {
            branch: 'main',
            subject: sourceFix?.subject ?? 'fix(bridge): clamp rope tension overflow',
            body: sourceFix ? `(cherry picked from commit ${sourceFix.sha})` : '',
            authorIdx: 1,
            cherryPickTwinSha: sourceFix?.sha,
          });
          if (sourceFix) {
            sourceFix.cherryPickTwinSha = twin.sha;
            next.cherryPickPairs.push({ fromSha: sourceFix.sha, toSha: twin.sha });
          }
          const out = `[main ${twin.shortSha}] ${twin.subject} (cherry-picked from ${sourceFix?.shortSha})`;
          appendLog(next, 'git cherry-pick feat/lab-v2', out);
          return { next, output: out };
        },
      },
    ],
  },

  // CHAPTER 10 — git reset --hard, git reflog & git bisect
  {
    number: 10,
    id: 'reflog-bisect',
    tier: 'Advanced',
    emoji: '👻',
    title: 'Reflog Time-Travel & git bisect Bug-Hunt',
    conceptSummary:
      'Secret superpower: even `git reset --hard` doesn\'t immediately destroy committed work! Git\'s `.git/logs/HEAD` (Reflog) remembers every past `HEAD` so you can rescue orphaned Ghost Commits — and `git bisect` binary-searches bugs in O(log₂ N).',
    focusOnEnter: 'overview',
    createInitialState: () => seedStarterMainCommits(3),
    steps: [
      {
        id: 'c10-s1',
        instruction:
          'Simulate a scary mistake: run `git reset --hard HEAD~1` to rewind `main` and watch the newest commit vanish from the island!',
        visualCue: 'The tip commit disappears from `main` — and materializes down on the Sunken Purple Reflog Ruins!',
        command: 'git reset --hard HEAD~1',
        actionLabel: 'Run: git reset --hard HEAD~1',
        focusAfter: 'ghosts',
        matchesCli: (cmd) => /^git\s+reset\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const mainTipSha = next.branchHeads.main;
          const tipCommit = next.commits.find((c) => c.sha === mainTipSha);
          if (tipCommit && tipCommit.parents[0]) {
            next.branchHeads.main = tipCommit.parents[0];
            next.ghostCommits.unshift({
              ...tipCommit,
              branch: 'ghost-ruins',
              isGhost: true,
              reflogAction: 'git reset',
            });
          }
          const out = `HEAD is now at ${next.branchHeads.main?.slice(0, 7)} (orphaned ${tipCommit?.shortSha} is still safe in .git/logs/HEAD!)`;
          appendLog(next, 'git reset --hard HEAD~1', out);
          return { next, output: out };
        },
      },
      {
        id: 'c10-s2',
        instruction:
          'Now rescue that "lost" commit using the Reflog! Run `git reset --hard HEAD@{1}` to bring it back onto `main`!',
        visualCue: 'The Ghost Commit ascends from the sunken ruins right back onto `main`!',
        command: 'git reset --hard HEAD@{1}',
        actionLabel: 'Rescue via git reflog!',
        focusAfter: 'overview',
        matchesCli: (cmd) => /^git\s+(reset|checkout|branch)\b/.test(cmd) || /^git\s+reflog\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          const rescued = next.ghostCommits.shift();
          if (rescued) {
            next.branchHeads.main = rescued.sha;
          }
          // Add two extra commits so bisect has a rich timeline to spotlight!
          addCommitToState(next, {
            branch: 'main',
            subject: 'feat(clocktower): install brass chimes',
            authorIdx: 0,
          });
          addCommitToState(next, {
            branch: 'main',
            subject: 'fix(clocktower): align pendulum tick',
            authorIdx: 2,
          });
          const out = `HEAD restored to ${rescued?.shortSha ?? 'tip'} from Reflog — zero work lost!`;
          appendLog(next, 'git reset --hard HEAD@{1}', out);
          return { next, output: out };
        },
      },
      {
        id: 'c10-s3',
        instruction:
          'Finally, launch `git bisect start` to test binary-searching your 3D commit timeline with the live Bug-Hunt Spotlight!',
        visualCue: 'A 3D Searchlight locks onto the midpoint commit so you can halve suspects in O(log₂ N)!',
        command: 'git bisect start',
        actionLabel: 'Launch 3D git bisect Spotlight',
        focusAfter: 'bisect',
        matchesCli: (cmd) => /^git\s+bisect\b/.test(cmd),
        run: (prev) => {
          const next = cloneState(prev);
          next.bisectRequested = true;
          const out = 'git bisect started! Use the Good / Bad buttons at the bottom to catch the culprit.';
          appendLog(next, 'git bisect start', out);
          return { next, output: out };
        },
      },
    ],
  },
];

/**
 * Execute free-form Git CLI commands typed by the learner in the Academy mini-terminal!
 */
export function executeFreeformGitCommand(
  prev: AcademySandboxState,
  rawCmd: string,
): { next: AcademySandboxState; output: string; isError?: boolean; focusHint?: AcademyFocusHint } {
  const cmd = rawCmd.trim().replace(/^\$\s*/, '');
  const next = cloneState(prev);

  if (!cmd) {
    return { next, output: '' };
  }

  if (/^help$/i.test(cmd) || /^git\s+--help$/i.test(cmd)) {
    const out =
      'Try: git init, touch file.ts, git add ., git commit -m "msg", git switch -c feat/x, git switch main, git merge feat/x, git tag v1.0, git stash, git stash pop, git reset --hard HEAD~1, git reflog';
    appendLog(next, cmd, out);
    return { next, output: out };
  }

  if (/^git\s+init\b/i.test(cmd)) {
    next.initialized = true;
    const out = 'Initialized Git repository in ~/gitvillage-academy/.git/';
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'gate' };
  }

  if (!next.initialized) {
    const out = 'fatal: not a git repository — run `git init` first!';
    appendLog(next, cmd, out, true);
    return { next, output: out, isError: true };
  }

  // `touch <file>` or `edit <file>` -> create uncommitted Gate visitor!
  const touchMatch = cmd.match(/^(?:touch|edit)\s+([^\s]+)$/i);
  if (touchMatch) {
    const fname = touchMatch[1];
    next.gateFiles.push({
      filename: fname,
      status: 'added',
      staged: false,
      additions: 18,
      deletions: 0,
      diffPreview: `@@ -0,0 +1,3 @@\n+// Created ${fname}`,
    });
    const out = `Modified ${fname} — 1 new visitor arrived outside the Village Gate!`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'gate' };
  }

  if (/^git\s+status\b/i.test(cmd)) {
    const unstaged = next.gateFiles.filter((f) => !f.staged).length;
    const staged = next.gateFiles.filter((f) => f.staged).length;
    const out = `On branch ${next.currentBranch} · ${staged} staged, ${unstaged} unstaged at Gate`;
    appendLog(next, cmd, out);
    return { next, output: out };
  }

  if (/^git\s+add\b/i.test(cmd)) {
    if (next.gateFiles.length === 0) {
      next.gateFiles.push({
        filename: `src/module-${next.seq}.ts`,
        status: 'modified',
        staged: true,
        additions: 22,
        deletions: 2,
      });
    } else {
      next.gateFiles = next.gateFiles.map((f) => ({
        ...f,
        staged: true,
        status: f.status === 'conflicted' ? 'modified' : f.status,
      }));
    }
    next.mergeConflict = undefined;
    const out = `Staged ${next.gateFiles.length} file(s) with Golden Gate Tickets.`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'gate' };
  }

  const commitMatch = cmd.match(/^git\s+commit(?:\s+-[am]+)?(?:\s+["']([^"']+)["'])?/i);
  if (commitMatch) {
    const msg = commitMatch[1] || `feat: update ${next.currentBranch} (#${next.seq})`;
    next.gateFiles = [];
    next.mergeConflict = undefined;
    const c = addCommitToState(next, { branch: next.currentBranch, subject: msg });
    const out = `[${next.currentBranch} ${c.shortSha}] ${c.subject}`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'head' };
  }

  const switchNewMatch = cmd.match(/^git\s+(?:switch\s+-c|checkout\s+-b)\s+([A-Za-z0-9/_.-]+)/i);
  if (switchNewMatch) {
    const br = switchNewMatch[1];
    if (!next.branchOrder.includes(br)) {
      const base = next.branchHeads[next.currentBranch] ?? null;
      next.branchOrder.push(br);
      next.branchColors[br] = BRANCH_PALETTE[(next.branchOrder.length - 1) % BRANCH_PALETTE.length];
      next.branchHeads[br] = base;
      next.branchForkBase[br] = base;
    }
    next.currentBranch = br;
    const c = addCommitToState(next, {
      branch: br,
      subject: `feat(${br}): start branch island`,
    });
    const out = `Switched to new branch '${br}' ([${c.shortSha}])`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'overview' };
  }

  const switchExistingMatch = cmd.match(/^git\s+(?:switch|checkout)\s+([A-Za-z0-9/_.-]+)/i);
  if (switchExistingMatch) {
    const target = switchExistingMatch[1];
    if (!next.branchOrder.includes(target)) {
      const out = `error: pathspec '${target}' did not match any branch (use -c to create)`;
      appendLog(next, cmd, out, true);
      return { next, output: out, isError: true };
    }
    next.currentBranch = target;
    const out = `Switched to branch '${target}'`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'overview' };
  }

  const mergeMatch = cmd.match(/^git\s+merge\s+([A-Za-z0-9/_.-]+)/i);
  if (mergeMatch) {
    const srcBr = mergeMatch[1];
    const srcTip = next.branchHeads[srcBr];
    if (!srcTip) {
      const out = `merge: ${srcBr} - not something we can merge`;
      appendLog(next, cmd, out, true);
      return { next, output: out, isError: true };
    }
    const mc = addCommitToState(next, {
      branch: next.currentBranch,
      subject: `Merge branch '${srcBr}' into ${next.currentBranch}`,
      extraParentSha: srcTip,
    });
    next.branchMergedInto[srcBr] = mc.sha;
    const out = `Merged '${srcBr}' into '${next.currentBranch}' -> [${mc.shortSha}]`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'overview' };
  }

  const tagMatch = cmd.match(/^git\s+tag\s+([A-Za-z0-9._-]+)/i);
  if (tagMatch) {
    const tName = tagMatch[1];
    const head = next.branchHeads[next.currentBranch];
    if (head) next.tags.push({ name: tName, sha: head });
    const out = `Created tag '${tName}' at ${head?.slice(0, 7) ?? 'HEAD'}`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'overview' };
  }

  if (/^git\s+stash\s+(?:pop|apply)\b/i.test(cmd)) {
    const popped = next.stashes.shift();
    if (!popped) {
      const out = 'No stash entries found.';
      appendLog(next, cmd, out, true);
      return { next, output: out, isError: true };
    }
    next.gateFiles.push({
      filename: 'src/stashedWork.ts',
      status: 'modified',
      staged: false,
      additions: 24,
      deletions: 2,
    });
    const out = `Popped ${popped.selector} ("${popped.message}") back to Gate!`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'gate' };
  }

  if (/^git\s+stash\b/i.test(cmd)) {
    const idx = next.stashes.length;
    next.stashes.unshift({
      index: idx,
      selector: `stash@{0}`,
      message: `WIP on ${next.currentBranch}`,
      sha: makeSha('stash-free', next.seq++),
      timestamp: new Date().toISOString(),
      branch: next.currentBranch,
      filesCount: Math.max(1, next.gateFiles.length),
    });
    next.gateFiles = [];
    const out = `Saved working directory to stash@{0}`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'stash' };
  }

  if (/^git\s+reflog\b/i.test(cmd)) {
    const ghostSummary =
      next.ghostCommits.length > 0
        ? next.ghostCommits.map((g, i) => `HEAD@{${i + 1}}: ${g.shortSha} ${g.subject}`).join(' | ')
        : 'No orphaned reflog commits yet.';
    appendLog(next, cmd, ghostSummary);
    return { next, output: ghostSummary, focusHint: next.ghostCommits.length > 0 ? 'ghosts' : 'overview' };
  }

  if (/^git\s+bisect\b/i.test(cmd)) {
    next.bisectRequested = true;
    const out = 'Launched interactive 3D git bisect spotlight!';
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'bisect' };
  }

  if (/^git\s+reset\s+--hard(?:\s+HEAD~1)?\b/i.test(cmd)) {
    const curBr = next.currentBranch;
    const headSha = next.branchHeads[curBr];
    const headCommit = headSha ? next.commits.find((c) => c.sha === headSha) : undefined;
    if (!headCommit || headCommit.parents.length === 0) {
      const out = 'Already at initial commit — add another commit before testing git reset --hard.';
      appendLog(next, cmd, out, true);
      return { next, output: out, isError: true };
    }
    next.branchHeads[curBr] = headCommit.parents[0];
    next.ghostCommits.unshift({
      ...headCommit,
      branch: 'ghost-ruins',
      isGhost: true,
      reflogAction: 'reset --hard HEAD~1',
    });
    next.gateFiles = [];
    const out = `HEAD is now at ${headCommit.parents[0].slice(0, 7)} (${headCommit.shortSha} moved to in-memory Reflog Ghost Ruins)`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'ghosts' };
  }

  if (/^git\s+(?:push|pull|fetch|remote|clone)\b/i.test(cmd)) {
    const out = `Sandbox simulated '${cmd}' on '${next.currentBranch}' — 100% in-browser RAM (nothing is ever pushed or written to disk).`;
    appendLog(next, cmd, out);
    return { next, output: out, focusHint: 'overview' };
  }

  const out = `Executed '${cmd}' in memory — try 'help' to see all supported 3D Git commands.`;
  appendLog(next, cmd, out);
  return { next, output: out };
}
