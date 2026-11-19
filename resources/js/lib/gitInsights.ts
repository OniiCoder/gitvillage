import type {
  BranchSeason,
  CoAuthorInfo,
  CommitData,
  HotspotLandmarkData,
  RepoVillageGraph,
} from '@/types/village';

const CO_AUTHOR_RE = /^co-authored-by:\s*([^<\n]+?)(?:\s*<([^>\n]+)>)?\s*$/gim;
const CHERRY_PICK_SHA_RE = /\(cherry picked from commit ([0-9a-f]{7,40})\)/i;

export function parseCoAuthorsFromBody(body: string): CoAuthorInfo[] {
  if (!body || !body.toLowerCase().includes('co-authored-by:')) {
    return [];
  }
  const seen = new Set<string>();
  const out: CoAuthorInfo[] = [];

  for (const match of body.matchAll(CO_AUTHOR_RE)) {
    const name = (match[1] ?? '').trim();
    const email = (match[2] ?? '').trim();
    if (!name) continue;
    const rawLogin = email
      ? email.split('@')[0].replace(/^\d+\+/, '')
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const login = rawLogin.replace(/\[bot\]$/i, '') || name.toLowerCase();
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, login, email: email || undefined });
  }
  return out.slice(0, 3);
}

function normalizeSubjectForCherryPick(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/\(#\d+\)/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferFallbackModuleFromCommit(c: CommitData): string {
  const scopeMatch = /^[a-z]+\(([^)]+)\):/i.exec(c.subject.trim());
  if (scopeMatch?.[1]) {
    return `${scopeMatch[1].trim()}/`;
  }
  const fileMatch = /\b([\w./-]+\.(?:ts|tsx|js|php|py|rs|go|vue|svelte|css|md))\b/i.exec(c.subject);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }
  if (c.kind === 'docs') return 'docs/README.md';
  if (c.kind === 'fix') return 'src/core/runtime';
  if (c.kind === 'refactor') return 'src/engine/pipeline';
  return 'src/app/main';
}

/**
 * Enriches any RepoVillageGraph (GitHub, Local Server, Browser .git, or Demo)
 * with Hidden Git History signals:
 * - Co-authored-by pair programming metadata
 * - Cross-branch Cherry-Pick twin links
 * - True-time seasonal branch aging (lush / autumn / winter)
 * - Bus Factor & Single-Caretaker knowledge silos
 * - Code Hotspot Forge & Ancient Stable Monument landmarks
 */
export function enrichVillageGraphInsights(graph: RepoVillageGraph): RepoVillageGraph {
  const now = Date.now();
  const allCommits = [...graph.commitsBySha.values()];

  // 1. Parse Co-Authored-By trailers on all live & ghost commits
  for (const c of [...allCommits, ...(graph.ghostCommits ?? [])]) {
    if (!c.coAuthors || c.coAuthors.length === 0) {
      const parsed = parseCoAuthorsFromBody(c.body);
      if (parsed.length > 0) {
        c.coAuthors = parsed.filter(
          (co) => co.login.toLowerCase() !== c.authorLogin.toLowerCase(),
        );
      }
    }
  }

  // 2. Detect Cross-Branch Cherry-Pick Twins
  const cherryPickPairs: Array<{ fromSha: string; toSha: string }> = [];
  const pairedShas = new Set<string>();

  // 2a. Explicit `(cherry picked from commit <sha>)` trailer
  for (const c of allCommits) {
    const m = CHERRY_PICK_SHA_RE.exec(c.body);
    if (m?.[1]) {
      const prefix = m[1].toLowerCase();
      const origin = allCommits.find(
        (other) => other.sha !== c.sha && other.sha.toLowerCase().startsWith(prefix),
      );
      if (origin && !pairedShas.has(c.sha) && !pairedShas.has(origin.sha)) {
        c.cherryPickTwinSha = origin.sha;
        origin.cherryPickTwinSha = c.sha;
        pairedShas.add(c.sha);
        pairedShas.add(origin.sha);
        cherryPickPairs.push({ fromSha: origin.sha, toSha: c.sha });
      }
    }
  }

  // 2b. Identical normalized commit subjects across distinct branches
  const byNormalizedSubject = new Map<string, CommitData[]>();
  for (const c of allCommits) {
    if (c.kind === 'merge') continue;
    const norm = normalizeSubjectForCherryPick(c.subject);
    if (norm.length < 10) continue;
    const bucket = byNormalizedSubject.get(norm) ?? [];
    bucket.push(c);
    byNormalizedSubject.set(norm, bucket);
  }
  for (const group of byNormalizedSubject.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const cross = group.find((other) => other.branch !== first.branch);
    if (cross && !pairedShas.has(first.sha) && !pairedShas.has(cross.sha)) {
      first.cherryPickTwinSha = cross.sha;
      cross.cherryPickTwinSha = first.sha;
      pairedShas.add(first.sha);
      pairedShas.add(cross.sha);
      cherryPickPairs.push({ fromSha: first.sha, toSha: cross.sha });
      if (cherryPickPairs.length >= 4) break;
    }
  }

  // 3. True-Time Branch Aging (`lush` / `autumn` / `winter`) + Per-Branch Bus Factor Silos
  const repoAuthorCounts = new Map<string, number>();

  for (const branch of graph.branches) {
    const newest = branch.commits.at(-1);
    const newestMs = newest ? Date.parse(newest.timestamp) : now;
    const ageDays = Number.isFinite(newestMs)
      ? Math.max(0, Math.round((now - newestMs) / 86_400_000))
      : 0;

    let season: BranchSeason = 'lush';
    if (!branch.isDefault) {
      if (ageDays >= 180) season = 'winter';
      else if (ageDays >= 42) season = 'autumn';
    }
    branch.ageDays = ageDays;
    branch.season = branch.season ?? season;

    const branchAuthors = new Map<string, { name: string; count: number }>();
    for (const c of branch.commits) {
      const key = (c.authorLogin || c.authorName).toLowerCase();
      repoAuthorCounts.set(key, (repoAuthorCounts.get(key) ?? 0) + 1);
      const prev = branchAuthors.get(key);
      branchAuthors.set(key, {
        name: c.authorName,
        count: (prev?.count ?? 0) + 1,
      });
    }

    branch.busFactor = Math.max(1, branchAuthors.size);
    if (branchAuthors.size === 1 && branch.commits.length >= 2) {
      const [soloKey, soloMeta] = [...branchAuthors.entries()][0];
      branch.soloOwnerKey = soloKey;
      branch.soloOwnerName = soloMeta.name;
    } else {
      branch.soloOwnerKey = undefined;
      branch.soloOwnerName = undefined;
    }
  }

  // Compute overall repository Bus Factor (minimum authors accounting for >= 60% of commits)
  const sortedCounts = [...repoAuthorCounts.values()].toSorted((a, b) => b - a);
  const totalCommits = Math.max(1, allCommits.length);
  let cumulative = 0;
  let repoBusFactor = 0;
  for (const cnt of sortedCounts) {
    cumulative += cnt;
    repoBusFactor++;
    if (cumulative / totalCommits >= 0.6) break;
  }
  repoBusFactor = Math.max(1, repoBusFactor);

  // 4. Code Hotspot Forge vs. Ancient Stable Monument
  const fileStats = new Map<
    string,
    {
      touches: number;
      fixCount: number;
      churnLines: number;
      authors: Set<string>;
      firstMs: number;
      lastMs: number;
      lastIso: string;
    }
  >();

  for (const c of allCommits) {
    const tsMs = Date.parse(c.timestamp) || now;
    const authorKey = (c.authorLogin || c.authorName).toLowerCase();
    const files = c.files && c.files.length > 0
      ? c.files.map((f) => ({
          name: f.filename,
          lines: f.additions + f.deletions,
        }))
      : [
          {
            name: inferFallbackModuleFromCommit(c),
            lines: c.stats?.total ?? 24,
          },
        ];

    for (const f of files) {
      const cur = fileStats.get(f.name);
      if (!cur) {
        fileStats.set(f.name, {
          touches: 1,
          fixCount: c.kind === 'fix' ? 1 : 0,
          churnLines: Math.max(1, f.lines),
          authors: new Set([authorKey]),
          firstMs: tsMs,
          lastMs: tsMs,
          lastIso: c.timestamp,
        });
      } else {
        cur.touches += 1;
        if (c.kind === 'fix') cur.fixCount += 1;
        cur.churnLines += Math.max(1, f.lines);
        cur.authors.add(authorKey);
        if (tsMs < cur.firstMs) cur.firstMs = tsMs;
        if (tsMs >= cur.lastMs) {
          cur.lastMs = tsMs;
          cur.lastIso = c.timestamp;
        }
      }
    }
  }

  const entries = [...fileStats.entries()];
  const hotspots: HotspotLandmarkData[] = [];

  if (entries.length > 0) {
    const sortedHot = entries.toSorted(([, a], [, b]) => {
      const scoreA = a.touches * 18 + a.fixCount * 28 + Math.min(120, a.churnLines * 0.35);
      const scoreB = b.touches * 18 + b.fixCount * 28 + Math.min(120, b.churnLines * 0.35);
      return scoreB - scoreA;
    });
    const [hotName, hot] = sortedHot[0];
    hotspots.push({
      kind: 'hotspot',
      filename: hotName,
      touches: hot.touches,
      fixCount: hot.fixCount,
      churnLines: hot.churnLines,
      authorsCount: hot.authors.size,
      lastTouchedIso: hot.lastIso,
    });

    const stableCandidates = entries
      .filter(([name]) => name !== hotName)
      .toSorted(([, a], [, b]) => {
        if (a.touches !== b.touches) return a.touches - b.touches;
        return a.firstMs - b.firstMs;
      });
    const pickMonument = stableCandidates[0];
    if (pickMonument) {
      const [monName, mon] = pickMonument;
      hotspots.push({
        kind: 'monument',
        filename: monName,
        touches: mon.touches,
        fixCount: mon.fixCount,
        churnLines: mon.churnLines,
        authorsCount: mon.authors.size,
        lastTouchedIso: mon.lastIso,
      });
    }
  }

  graph.cherryPickPairs = cherryPickPairs;
  graph.hotspots = hotspots;
  graph.repoBusFactor = repoBusFactor;
  return graph;
}
