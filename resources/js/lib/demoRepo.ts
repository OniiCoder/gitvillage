import type { BranchIslandData, CommitData, CommitFileChange, CommitKind, RepoVillageGraph } from '@/types/village';

export function classifyCommitKind(subject: string, parentCount: number): CommitKind {
  const lower = subject.trim().toLowerCase();
  if (parentCount > 1 || lower.startsWith('merge ')) return 'merge';
  if (/^(feat|feature|add|implement|introduce)(\b|\(|:)/.test(lower) || lower.includes('new ')) return 'feat';
  if (/^(fix|bug|hotfix|patch|resolve)(\b|\(|:)/.test(lower) || lower.includes('fix ')) return 'fix';
  if (/^(docs|doc|readme|guide|comment)(\b|\(|:)/.test(lower)) return 'docs';
  if (/^(refactor|perf|clean|optimize|style|polish)(\b|\(|:)/.test(lower)) return 'refactor';
  return 'chore';
}

interface SeedCommit {
  id: string;
  sha: string;
  branch: string;
  parents: string[];
  authorLogin: string;
  authorName: string;
  minutesAgo: number;
  subject: string;
  body: string;
  files: CommitFileChange[];
  archetypeWallClock?: 'friday_deploy' | 'night_owl';
}

const BRANCH_PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c'];

const DEMO_FILE_PATCHES: Record<string, string> = {
  'm1:src/world/bedrock.ts': `@@ -0,0 +1,14 @@
+import * as THREE from 'three';
+
+export function createFloatingBedrock(length: number, width: number): THREE.Group {
+  const group = new THREE.Group();
+  const turf = new THREE.Mesh(
+    new THREE.BoxGeometry(length, 1.2, width),
+    new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.78 }),
+  );
+  const cliffCone = new THREE.Mesh(
+    new THREE.ConeGeometry(width * 0.62, 6.4, 7),
+    new THREE.MeshStandardMaterial({ color: 0x1e293b, flatShading: true }),
+  );
+  cliffCone.rotation.x = Math.PI;
+  group.add(turf, cliffCone);
+  return group;
+}`,
  'm1:src/world/skybox.ts': `@@ -0,0 +1,10 @@
+export const SKY_PRESETS = {
+  day: { zenith: '#1d4ed8', horizon: '#38bdf8', mist: '#e0f2fe' },
+  sunset: { zenith: '#311042', horizon: '#db2777', mist: '#fdba74' },
+  night: { zenith: '#020617', horizon: '#0f172a', mist: '#1e1b4b' },
+} as const;
+
+export function createCloudDome(radius = 240) {
+  return { radius, puffClusters: 18, driftSpeed: 0.42 };
+}`,
  'm1:package.json': `@@ -0,0 +1,11 @@
+{
+  "name": "@gitvillage/sky-village",
+  "version": "0.1.0",
+  "type": "module",
+  "scripts": {
+    "dev": "vite",
+    "build": "tsc --noEmit && vite build"
+  },
+  "dependencies": {
+    "three": "^0.175.0"
+  }
+}`,
  'm3:src/entities/villager.ts': `@@ -41,9 +41,12 @@ export function stepVillagerPhysics(v: VillagerEntity, dt: number): void {
   const surfaceY = sampleIslandElevation(v.island, v.pathT);
-  if (v.nearbyHighFive) {
-    v.jumpVelocity += 14.5;
-  }
+  if (v.nearbyHighFive && v.jumpY <= 0.02) {
+    v.jumpVelocity = Math.min(8.4, v.jumpVelocity + 6.2);
+  }
+  v.jumpVelocity = Math.max(-18, Math.min(9.5, v.jumpVelocity - 22.0 * dt));
   v.jumpY = Math.max(0, v.jumpY + v.jumpVelocity * dt);
   v.root.position.y = surfaceY + v.jumpY;
 }`,
  'b1:src/world/bridges.ts': `@@ -64,8 +64,11 @@ export function sampleSuspensionSway(t: number, loadCount: number, elapsed: numb
   const arch = Math.sin(t * Math.PI);
-  const harmonic = Math.sin(elapsed * 6.2) * loadCount * 0.19;
-  return arch * harmonic;
+  const crossBracing = 1 / (1 + loadCount * 0.65);
+  const dampedWave = Math.sin(elapsed * 3.1 + t * 2.4) * 0.045 * crossBracing;
+  return arch * dampedWave;
 }`,
  'm10:src/ui/inspector.ts': `@@ -88,7 +88,11 @@ export function stepCommitLineage(commit: CommitData, dir: 'parent' | 'child') {
-  const candidates = dir === 'parent' ? commit.parents.slice(0, 1) : commit.children;
-  return candidates[0] ?? null;
+  const candidates = dir === 'parent' ? commit.parents : commit.children;
+  const reachable = candidates.find((sha) => villagerRegistry.has(sha));
+  if (reachable) {
+    arcCameraAcrossBridge(commit.sha, reachable);
+  }
+  return reachable ?? null;
 }`,
  'm11:src/githubLoader.ts': `@@ -0,0 +1,14 @@
+export async function loadGitHubRepoVillage(owner: string, repo: string) {
+  const meta = await ghFetch(\`/repos/\${owner}/\${repo}\`);
+  const commits = await ghFetch(
+    \`/repos/\${owner}/\${repo}/commits?sha=\${meta.default_branch}&per_page=24\`,
+  );
+  return buildFloatingIslandsGraph(meta, commits);
+}
+
+export async function hydrateCommitDetail(owner: string, repo: string, sha: string) {
+  return ghFetch(\`/repos/\${owner}/\${repo}/commits/\${sha}\`);
+}`,
  'm11:src/localLoader.ts': `@@ -0,0 +1,11 @@
+export async function loadLocalRepoVillage(localPath: string) {
+  const res = await fetch(\`/api/local-repo?path=\${encodeURIComponent(localPath)}\`);
+  if (!res.ok) throw new Error('Could not inspect local repository');
+  return res.json();
+}
+
+export async function hydrateLocalCommitDetail(localPath: string, sha: string) {
+  const res = await fetch(\`/api/local-commit-detail?path=\${encodeURIComponent(localPath)}&sha=\${sha}\`);
+  return res.json();
+}`,
};

function buildDemoFilePatch(seedId: string, subject: string, file: CommitFileChange): string {
  const explicit = DEMO_FILE_PATCHES[`${seedId}:${file.filename}`];
  if (explicit) return explicit;

  const baseName = file.filename.split('/').pop() ?? file.filename;
  const stem = baseName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
  const fnName = stem ? `update${stem[0].toUpperCase()}${stem.slice(1)}` : 'applyChange';

  if (file.filename.endsWith('.md')) {
    if (file.status === 'added') {
      return [
        `@@ -0,0 +1,8 @@`,
        `+# ${baseName.replace(/\.md$/, '')}`,
        `+`,
        `+> ${subject}`,
        `+`,
        `+- Floating branch islands linked at exact fork & merge commits`,
        `+- Contributor clans with shared palettes, crests, and silhouettes`,
        `+- Click any changed file in the Inspector to review unified diffs`,
      ].join('\n');
    }
    return [
      `@@ -18,5 +18,8 @@ ## GitVillage Architecture`,
      ` Every branch materializes as its own floating island in the cloud sea.`,
      `-See docs for basic controls.`,
      `+Paste any \`owner/repo\` URL or open a local repository folder directly.`,
      `+Use \`?repo=owner/repo\` or \`/gh/owner/repo\` for instant shareable deep links.`,
      `+Click any changed file in the Commit Inspector to inspect line-by-line diffs.`,
      ` `,
    ].join('\n');
  }

  if (file.filename.endsWith('.css')) {
    return [
      `@@ -42,6 +42,10 @@ .spatial-hud {`,
      `   backdrop-filter: blur(24px) saturate(180%);`,
      `-  border-radius: 12px;`,
      `+  border-radius: var(--radius-sheet);`,
      `+  box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.22), 0 18px 42px rgba(2, 6, 23, 0.45);`,
      `+}`,
      `+`,
      `+.file-diff-item[open] {`,
      `+  background: rgba(255, 255, 255, 0.04);`,
      ` }`,
    ].join('\n');
  }

  if (file.filename.endsWith('.html')) {
    return [
      `@@ -9,6 +9,8 @@`,
      `   <head>`,
      `     <meta charset="utf-8" />`,
      `-    <title>Commit Viewer</title>`,
      `+    <title>GitVillage — Living 3D Git Repository</title>`,
      `+    <meta name="theme-color" content="#0f172a" />`,
      `   </head>`,
      `   <body>`,
    ].join('\n');
  }

  if (file.status === 'added') {
    return [
      `@@ -0,0 +1,11 @@`,
      `+// ${subject}`,
      `+export interface ${fnName[0].toUpperCase()}${fnName.slice(1)}Options {`,
      `+  readonly intensity: number;`,
      `+  readonly smoothFactor?: number;`,
      `+}`,
      `+`,
      `+export function ${fnName}(options: ${fnName[0].toUpperCase()}${fnName.slice(1)}Options) {`,
      `+  const damping = options.smoothFactor ?? 0.92;`,
      `+  return { active: true, gain: options.intensity * damping };`,
      `+}`,
    ].join('\n');
  }

  return [
    `@@ -24,7 +24,10 @@ export function ${fnName}(dt: number) {`,
    `   const clampedDt = Math.min(dt, 0.05);`,
    `-  const step = clampedDt * 0.5;`,
    `-  return applyStep(step);`,
    `+  // ${subject}`,
    `+  const easedStep = 1 - Math.exp(-8.5 * clampedDt);`,
    `+  const stabilized = Math.min(1, easedStep);`,
    `+  return applyStep(stabilized);`,
    ` }`,
  ].join('\n');
}

export function createDemoRepoGraph(): RepoVillageGraph {
  const now = Date.now();
  const seeds: SeedCommit[] = [
    // MAIN ISLAND (oldest -> newest)
    {
      id: 'm1',
      sha: '8a10f01c92b41d3e9f8472615293847561029384',
      branch: 'main',
      parents: [],
      authorLogin: 'mira-architect',
      authorName: 'Mira Lin',
      minutesAgo: 60 * 96,
      subject: 'feat: raise the primordial floating bedrock from the cloud sea',
      body: 'Initializes terrain heightfields, buoyant crystal anchors underneath the main island, and the village town square hearth.',
      files: [
        { filename: 'src/world/bedrock.ts', status: 'added', additions: 184, deletions: 0 },
        { filename: 'src/world/skybox.ts', status: 'added', additions: 92, deletions: 0 },
        { filename: 'package.json', status: 'added', additions: 34, deletions: 0 },
      ],
    },
    {
      id: 'm2',
      sha: '9b21e12d83c52e4fa09583726304958672130495',
      branch: 'main',
      parents: ['8a10f01c92b41d3e9f8472615293847561029384'],
      authorLogin: 'kael-voxel',
      authorName: 'Kael Vance',
      minutesAgo: 60 * 88,
      subject: 'feat(villagers): teach commit citizens how to stroll and hop',
      body: 'Adds spring-damped hopping physics, friendly arm waves when passing neighbors, and deterministic outfit palettes per git author.',
      files: [
        { filename: 'src/entities/villager.ts', status: 'added', additions: 245, deletions: 0 },
        { filename: 'src/entities/outfits.ts', status: 'added', additions: 78, deletions: 0 },
      ],
    },
    {
      id: 'm3',
      sha: 'ac32f23e94d63f50b1a694837415069783241506',
      branch: 'main',
      parents: ['9b21e12d83c52e4fa09583726304958672130495'],
      authorLogin: 'soren-rust',
      authorName: 'Soren Lindqvist',
      minutesAgo: 60 * 79,
      subject: 'fix(gravity): stop excited villagers from hopping clean into orbit',
      body: 'Clamps upward impulse when two feat commits high-five simultaneously near the cliff edge.',
      files: [
        { filename: 'src/entities/villager.ts', status: 'modified', additions: 19, deletions: 11 },
        { filename: 'tests/gravity.test.ts', status: 'added', additions: 42, deletions: 0 },
      ],
    },
    {
      id: 'm4',
      sha: 'bd43034fa5e74061c2b7a5948526170894352617',
      branch: 'main',
      parents: ['ac32f23e94d63f50b1a694837415069783241506'],
      authorLogin: 'tali-scribes',
      authorName: 'Tali Okafor',
      minutesAgo: 60 * 70,
      subject: 'docs: carve island signpost runes and newcomer map legend',
      body: 'Documents branch bridge topology, commit hat meanings, and keyboard shortcuts for walking around GitVillage.',
      files: [
        { filename: 'README.md', status: 'added', additions: 128, deletions: 0 },
        { filename: 'docs/gitvillage-lore.md', status: 'added', additions: 64, deletions: 0 },
      ],
    },
    // Branch 1: feat/cloud-windmills forks from m3 and merges into m6
    {
      id: 'w1',
      sha: 'c111a450b6f85172d3c8b60596372819a5463728',
      branch: 'feat/cloud-windmills',
      parents: ['ac32f23e94d63f50b1a694837415069783241506'],
      authorLogin: 'kael-voxel',
      authorName: 'Kael Vance',
      minutesAgo: 60 * 74,
      subject: 'feat(windmill): frame timber windmill tower and canvas sails',
      body: 'Constructs a kinetic windmill on the eastern ridge powered by trade winds blowing across open pull requests.',
      files: [
        { filename: 'src/props/windmill.ts', status: 'added', additions: 162, deletions: 0 },
      ],
    },
    {
      id: 'w2',
      sha: 'c222b561c7096283e4d9c716a748392ab6574839',
      branch: 'feat/cloud-windmills',
      parents: ['c111a450b6f85172d3c8b60596372819a5463728'],
      authorLogin: 'kael-voxel',
      authorName: 'Kael Vance',
      minutesAgo: 60 * 66,
      subject: 'refactor(windmill): gear-link sail RPM to commit velocity',
      body: 'Smooths angular velocity with critically damped interpolation so gusts look dreamy rather than frantic.',
      files: [
        { filename: 'src/props/windmill.ts', status: 'modified', additions: 48, deletions: 29 },
        { filename: 'src/math/spring.ts', status: 'added', additions: 35, deletions: 0 },
      ],
    },
    {
      id: 'w3',
      sha: 'c333c672d81a7394f5ead827b8594a3bc768594a',
      branch: 'feat/cloud-windmills',
      parents: ['c222b561c7096283e4d9c716a748392ab6574839'],
      authorLogin: 'jun-audio',
      authorName: 'Jun Takahashi',
      minutesAgo: 60 * 59,
      subject: 'feat(windmill): add gentle creaking woodblock harmonics on breeze',
      body: 'Synthesizes soft pentatonic chimes whenever the windmill sails catch a sunset updraft.',
      files: [
        { filename: 'src/audio/breezeSynth.ts', status: 'added', additions: 89, deletions: 0 },
      ],
    },
    {
      id: 'm5',
      sha: 'ce541450b6f85172d3c8b60596372819a5463729',
      branch: 'main',
      parents: ['bd43034fa5e74061c2b7a5948526170894352617'],
      authorLogin: 'mira-architect',
      authorName: 'Mira Lin',
      minutesAgo: 60 * 56,
      subject: 'feat(bridges): weave rope suspension bridges between branch islands',
      body: 'Generates catenary wooden plank bridges with warm swaying lanterns connecting every feature branch to its fork commit.',
      files: [
        { filename: 'src/world/bridges.ts', status: 'added', additions: 210, deletions: 0 },
        { filename: 'src/world/islandLayout.ts', status: 'modified', additions: 65, deletions: 18 },
      ],
    },
    {
      id: 'm6',
      sha: 'df652561c7096283e4d9c716a748392ab6574830',
      branch: 'main',
      parents: [
        'ce541450b6f85172d3c8b60596372819a5463729',
        'c333c672d81a7394f5ead827b8594a3bc768594a',
      ],
      authorLogin: 'mira-architect',
      authorName: 'Mira Lin',
      minutesAgo: 60 * 49,
      subject: 'Merge pull request #12 from feat/cloud-windmills',
      body: 'Welcomes the Cloud Windmill guild back onto main island! Celebratory confetti enabled at the eastern plaza.',
      files: [
        { filename: 'src/props/windmill.ts', status: 'added', additions: 181, deletions: 0 },
        { filename: 'src/audio/breezeSynth.ts', status: 'added', additions: 89, deletions: 0 },
      ],
    },
    // Branch 2: fix/bridge-wobble forks from m5, merges into m8
    {
      id: 'b1',
      sha: 'd444d783e92b84a506fbe938c96a5b4cd8796a5b',
      branch: 'fix/bridge-wobble',
      parents: ['ce541450b6f85172d3c8b60596372819a5463729'],
      authorLogin: 'soren-rust',
      authorName: 'Soren Lindqvist',
      minutesAgo: 60 * 46,
      subject: 'fix(bridges): clamp cable damping coefficient with one-line guard',
      body: 'Three commits marching in lockstep across a bridge caused dramatic plank bounce. One-line damping clamp solved it.',
      files: [
        { filename: 'src/world/bridges.ts', status: 'modified', additions: 2, deletions: 1 },
      ],
    },
    {
      id: 'b2',
      sha: 'd555e894fa3c95b6170cf049da7b6c5de98a7b6c',
      branch: 'fix/bridge-wobble',
      parents: ['d444d783e92b84a506fbe938c96a5b4cd8796a5b'],
      authorLogin: 'soren-rust',
      authorName: 'Soren Lindqvist',
      minutesAgo: 60 * 39,
      subject: 'fix(pathfinding): prevent villagers from stopping mid-plank for gossip',
      body: 'Villagers now finish crossing narrow rope bridges before pausing to exchange emojis.',
      files: [
        { filename: 'src/entities/navigation.ts', status: 'modified', additions: 28, deletions: 9 },
        { filename: 'tests/bridgeCrossing.test.ts', status: 'added', additions: 53, deletions: 0 },
      ],
    },
    {
      id: 'm7',
      sha: 'e0763672d81a7394f5ead827b8594a3bc7685941',
      branch: 'main',
      parents: ['df652561c7096283e4d9c716a748392ab6574830'],
      authorLogin: 'jun-audio',
      authorName: 'Jun Takahashi',
      minutesAgo: 60 * 35,
      subject: 'feat(sky): paint golden-hour sunset & twinkling night fireflies',
      body: 'Adds three atmospheric lighting presets with smooth hemisphere color transitions and glowing cottage windows.',
      files: [
        { filename: 'src/world/atmosphere.ts', status: 'added', additions: 156, deletions: 0 },
        { filename: 'src/world/cottages.ts', status: 'modified', additions: 41, deletions: 8 },
      ],
    },
    {
      id: 'm8',
      sha: 'f1874783e92b84a506fbe938c96a5b4cd8796a52',
      branch: 'main',
      parents: [
        'e0763672d81a7394f5ead827b8594a3bc7685941',
        'd555e894fa3c95b6170cf049da7b6c5de98a7b6c',
      ],
      authorLogin: 'soren-rust',
      authorName: 'Soren Lindqvist',
      minutesAgo: 60 * 28,
      subject: 'Merge pull request #19 from fix/bridge-wobble',
      body: 'All inter-branch bridges certified wobble-free under heavy release-day traffic.',
      files: [
        { filename: 'src/world/bridges.ts', status: 'modified', additions: 37, deletions: 14 },
        { filename: 'src/entities/navigation.ts', status: 'modified', additions: 28, deletions: 9 },
      ],
    },
    // Branch 3: docs/field-guide (active unmerged island!) forks from m7
    {
      id: 'd1',
      sha: 'a666f9a50b4da6c7281df15aeb8c7d6efa9b8c7d',
      branch: 'docs/field-guide',
      parents: ['e0763672d81a7394f5ead827b8594a3bc7685941'],
      authorLogin: 'tali-scribes',
      authorName: 'Tali Okafor',
      minutesAgo: 60 * 24,
      subject: 'docs(taxonomy): illustrate field guide to Builders, Bug-Hunters & Mayors',
      body: 'Catalogs every hat, tool, and celebratory jump pattern exhibited by different conventional commit prefixes.',
      files: [
        { filename: 'docs/villager-taxonomy.md', status: 'added', additions: 142, deletions: 0 },
      ],
    },
    {
      id: 'd2',
      sha: 'a7770ab61c5eb7d8392ef26bfc9d8e7f0bac9d8e',
      branch: 'docs/field-guide',
      parents: ['a666f9a50b4da6c7281df15aeb8c7d6efa9b8c7d'],
      authorLogin: 'tali-scribes',
      authorName: 'Tali Okafor',
      minutesAgo: 60 * 14,
      subject: 'docs(api): add GitHub rate-limit tips and shareable ?repo= URL examples',
      body: 'Explains how public repositories stream straight into WebGL without a backend server.',
      files: [
        { filename: 'docs/github-loader.md', status: 'added', additions: 88, deletions: 0 },
        { filename: 'README.md', status: 'modified', additions: 24, deletions: 6 },
      ],
    },
    // Branch 4: feat/firefly-lanterns (active hot feature branch!) forks from m8
    {
      id: 'f1',
      sha: 'b8881bc72d6fc8e94a3f037c0dae9f801cbdae9f',
      branch: 'feat/firefly-lanterns',
      parents: ['f1874783e92b84a506fbe938c96a5b4cd8796a52'],
      authorLogin: 'kael-voxel',
      authorName: 'Kael Vance',
      minutesAgo: 60 * 19,
      archetypeWallClock: 'night_owl',
      subject: 'feat(lanterns): hang warm paper lanterns along every branch trail',
      body: 'Places emissive amber lanterns at fork junctions so nocturnal commits never lose their parent pointer.',
      files: [
        { filename: 'src/props/lanterns.ts', status: 'added', additions: 119, deletions: 0 },
      ],
    },
    {
      id: 'f2',
      sha: 'b9992cd83e70d9fa5b40148d1ebf0a912dcebf0a',
      branch: 'feat/firefly-lanterns',
      parents: ['b8881bc72d6fc8e94a3f037c0dae9f801cbdae9f'],
      authorLogin: 'jun-audio',
      authorName: 'Jun Takahashi',
      minutesAgo: 60 * 9,
      subject: 'refactor(shaders): delete legacy foliage pass & batch instanced petals',
      body: 'Deletes 248 lines of legacy multi-pass shader boilerplate and cuts draw calls by 68%.',
      files: [
        { filename: 'src/world/foliage.ts', status: 'modified', additions: 24, deletions: 248 },
      ],
    },
    {
      id: 'f3',
      sha: 'baaa3de94f81ea0b6c51259e2fc01ba23edfc01b',
      branch: 'feat/firefly-lanterns',
      parents: ['b9992cd83e70d9fa5b40148d1ebf0a912dcebf0a'],
      authorLogin: 'kael-voxel',
      authorName: 'Kael Vance',
      minutesAgo: 85,
      archetypeWallClock: 'friday_deploy',
      subject: 'feat(walk-mode): drop a playable Explorer avatar onto the islands',
      body: 'Press Walk Mode (WASD / Arrows) to stroll across islands and bridges in third-person and greet commits face-to-face!',
      files: [
        { filename: 'src/player/explorerController.ts', status: 'added', additions: 204, deletions: 0 },
      ],
    },
    // Recent commits on main up to HEAD
    {
      id: 'm9',
      sha: '02985894fa3c95b6170cf049da7b6c5de98a7b63',
      branch: 'main',
      parents: ['f1874783e92b84a506fbe938c96a5b4cd8796a52'],
      authorLogin: 'mira-architect',
      authorName: 'Mira Lin',
      minutesAgo: 60 * 11,
      subject: 'chore(release): polish stone fountain & crystal beacon at HEAD plaza',
      body: 'Marks the latest commit on the default branch with a levitating cyan obelisk so visitors can always spot HEAD.',
      files: [
        { filename: 'src/props/headBeacon.ts', status: 'added', additions: 108, deletions: 0 },
      ],
    },
    {
      id: 'm10',
      sha: '13a969a50b4da6c7281df15aeb8c7d6efa9b8c74',
      branch: 'main',
      parents: ['02985894fa3c95b6170cf049da7b6c5de98a7b63'],
      authorLogin: 'soren-rust',
      authorName: 'Soren Lindqvist',
      minutesAgo: 60 * 4,
      subject: 'fix(inspector): preserve parent/child lineage hops across merged islands',
      body: 'Ensures clicking Parent or Child smoothly arcs the camera over suspension bridges to the target villager.',
      files: [
        { filename: 'src/ui/inspector.ts', status: 'modified', additions: 44, deletions: 12 },
      ],
    },
    {
      id: 'm11',
      sha: '24ba7ab61c5eb7d8392ef26bfc9d8e7f0bac9d85',
      branch: 'main',
      parents: ['13a969a50b4da6c7281df15aeb8c7d6efa9b8c74'],
      authorLogin: 'mira-architect',
      authorName: 'Mira Lin',
      minutesAgo: 22,
      subject: 'feat(welcome): open village gates to any public GitHub repository!',
      body: 'Paste any owner/repo in the top bar (or pick a preset) to watch its branches and commits materialize as living sky islands.',
      files: [
        { filename: 'src/githubLoader.ts', status: 'added', additions: 265, deletions: 0 },
        { filename: 'src/localLoader.ts', status: 'added', additions: 194, deletions: 0 },
        { filename: 'src/main.ts', status: 'modified', additions: 72, deletions: 15 },
        { filename: 'src/style.css', status: 'modified', additions: 118, deletions: 24 },
        { filename: 'index.html', status: 'modified', additions: 64, deletions: 12 },
      ],
    },
  ];

  const commitsBySha = new Map<string, CommitData>();

  for (const s of seeds) {
    const hydratedFiles: CommitFileChange[] = s.files.map((f) => ({
      ...f,
      patch: f.patch ?? buildDemoFilePatch(s.id, s.subject, f),
    }));
    const additions = hydratedFiles.reduce((sum, f) => sum + f.additions, 0);
    const deletions = hydratedFiles.reduce((sum, f) => sum + f.deletions, 0);
    const rawEpoch = now - s.minutesAgo * 60_000;
    const timestamp =
      s.id === 'f1'
        ? '2026-11-13T03:14:00-05:00'
        : s.id === 'f2'
          ? '2026-11-13T12:20:00-05:00'
          : s.id === 'f3'
            ? '2026-11-13T17:42:00-05:00'
            : new Date(rawEpoch).toISOString();

    const commit: CommitData = {
      sha: s.sha,
      shortSha: s.sha.slice(0, 7),
      subject: s.subject,
      body: s.body,
      authorName: s.authorName,
      authorLogin: s.authorLogin,
      timestamp,
      branch: s.branch,
      parents: [...s.parents],
      children: [],
      kind: classifyCommitKind(s.subject, s.parents.length),
      filesCount: hydratedFiles.length,
      stats: {
        additions,
        deletions,
        total: additions + deletions,
      },
      files: hydratedFiles,
      patchesHydrated: true,
    };
    commitsBySha.set(commit.sha, commit);
  }

  // Wire children pointers
  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parents) {
      const parent = commitsBySha.get(parentSha);
      if (parent && !parent.children.includes(commit.sha)) {
        parent.children.push(commit.sha);
      }
    }
  }

  // Group commits by branch using Object.groupBy
  const grouped = Object.groupBy(commitsBySha.values(), (c) => c.branch);
  const branchOrder = [
    'main',
    'feat/cloud-windmills',
    'fix/bridge-wobble',
    'docs/field-guide',
    'feat/firefly-lanterns',
  ];

  const branches: BranchIslandData[] = branchOrder.map((branchName, idx) => {
    const rawCommits = grouped[branchName] ?? [];
    const sorted = rawCommits.toSorted(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    let forkFromSha: string | undefined;
    let mergeIntoSha: string | undefined;

    if (branchName !== 'main' && sorted.length > 0) {
      const first = sorted[0];
      forkFromSha = first.parents.find((p) => commitsBySha.get(p)?.branch === 'main');
      const last = sorted.at(-1)!;
      mergeIntoSha = last.children.find((ch) => commitsBySha.get(ch)?.branch === 'main');
    }

    return {
      name: branchName,
      isDefault: branchName === 'main',
      color: BRANCH_PALETTE[idx % BRANCH_PALETTE.length],
      commits: sorted,
      forkFromSha,
      mergeIntoSha,
    };
  });

  return {
    owner: 'gitvillage',
    repo: 'sky-village',
    description: 'Built-in interactive demo repo — click any commit villager or paste any public GitHub repo above!',
    defaultBranch: 'main',
    currentBranch: 'main',
    allBranches: [...branchOrder],
    stars: 1420,
    isDemo: true,
    ciWeather: {
      status: 'passing',
      summary: '14 checks passing',
    },
    branches,
    commitsBySha,
  };
}
