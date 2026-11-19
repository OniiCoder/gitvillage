import type { CommitData } from '@/types/village';

export type ArchetypeId =
  | 'friday_deployer'
  | 'demolitionist'
  | 'night_owl'
  | 'one_line_sniper'
  | 'mega_titan'
  | 'bridge_architect'
  | 'code_sculptor'
  | 'lorekeeper'
  | 'island_builder';

export type ArchetypePropKind =
  | 'flame_cape'
  | 'wrecking_hammer'
  | 'night_lantern'
  | 'sniper_visor'
  | 'titan_crown'
  | 'none';

export interface CommitArchetype {
  id: ArchetypeId;
  emoji: string;
  title: string;
  roast: string;
  accentCss: string;
  bgCss: string;
  propKind: ArchetypePropKind;
}

function parseCommitLocalDateParts(iso: string): { dayOfWeek: number; hour: number } {
  // Respect explicit timezone offset in ISO 8601 commit timestamps when present (e.g. 2026-11-13T17:42:00-05:00)
  const offsetMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)$/.exec(
    iso.trim(),
  );
  if (offsetMatch) {
    const year = Number.parseInt(offsetMatch[1], 10);
    const month = Number.parseInt(offsetMatch[2], 10) - 1;
    const day = Number.parseInt(offsetMatch[3], 10);
    const hour = Number.parseInt(offsetMatch[4], 10);
    // Construct UTC date at the author's local wall-clock calendar date to read accurate weekday
    const wallUtc = new Date(Date.UTC(year, month, day, hour, 0, 0));
    return { dayOfWeek: wallUtc.getUTCDay(), hour };
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return { dayOfWeek: 2, hour: 14 };
  }
  return { dayOfWeek: parsed.getDay(), hour: parsed.getHours() };
}

export function computeCommitArchetype(commit: CommitData): CommitArchetype {
  const add = commit.stats?.additions ?? 0;
  const del = commit.stats?.deletions ?? 0;
  const totalLines = add + del;
  const filesCount = commit.files?.length ?? commit.filesCount ?? 0;
  const { dayOfWeek, hour } = parseCommitLocalDateParts(commit.timestamp);

  // 1. The Demolitionist — glorious negative-LOC code deletion!
  if ((del >= 120 && del > add * 1.35) || (del >= 45 && add <= 10)) {
    return {
      id: 'demolitionist',
      emoji: '🔨',
      title: 'The Demolitionist',
      roast: `vaporized ${del.toLocaleString()} lines of legacy weight — negative LOC legend.`,
      accentCss: '#fbbf24',
      bgCss: 'rgba(251, 191, 36, 0.16)',
      propKind: 'wrecking_hammer',
    };
  }

  // 2. Friday Deployer — Friday >= 4:00 PM!
  if (dayOfWeek === 5 && hour >= 16) {
    return {
      id: 'friday_deployer',
      emoji: '🔥',
      title: 'Friday Deployer',
      roast: 'shipped after 4 PM on a Friday and walked away without looking at the explosion.',
      accentCss: '#ff6b35',
      bgCss: 'rgba(255, 107, 53, 0.18)',
      propKind: 'flame_cape',
    };
  }

  // 3. 3 AM Night Owl — 12:00 AM to 4:59 AM!
  if (hour >= 0 && hour < 5) {
    return {
      id: 'night_owl',
      emoji: '🦉',
      title: '3 AM Night Owl',
      roast: `committed at ${hour === 0 ? '12' : hour} AM fueled purely by espresso and flow state.`,
      accentCss: '#a5b4fc',
      bgCss: 'rgba(129, 140, 248, 0.18)',
      propKind: 'night_lantern',
    };
  }

  // 4. One-Line Sniper — tiny surgical patch (1-4 lines changed)
  if (totalLines > 0 && totalLines <= 4 && filesCount <= 2 && commit.kind === 'fix') {
    return {
      id: 'one_line_sniper',
      emoji: '🎯',
      title: 'One-Line Sniper',
      roast: `neutralized the bug in +${add}/−${del} lines with surgical precision.`,
      accentCss: '#38bdf8',
      bgCss: 'rgba(56, 189, 248, 0.16)',
      propKind: 'sniper_visor',
    };
  }

  // 5. Mega-Drop Titan — massive PR / commit drop
  if (totalLines >= 450 || filesCount >= 14) {
    return {
      id: 'mega_titan',
      emoji: '👑',
      title: 'Mega-Drop Titan',
      roast: `hauled ${filesCount || 'dozens of'} files (+${add.toLocaleString()}/−${del.toLocaleString()}) in one seismic drop.`,
      accentCss: '#ffd60a',
      bgCss: 'rgba(255, 214, 10, 0.16)',
      propKind: 'titan_crown',
    };
  }

  // 6. Bridge Architect — merge commits
  if (commit.kind === 'merge' || commit.parents.length > 1) {
    return {
      id: 'bridge_architect',
      emoji: '🌉',
      title: 'Bridge Architect',
      roast: 'stitched diverging timelines safely back onto the main street.',
      accentCss: '#d8b4fe',
      bgCss: 'rgba(192, 132, 252, 0.16)',
      propKind: 'none',
    };
  }

  // 7. Code Sculptor — refactors
  if (commit.kind === 'refactor') {
    return {
      id: 'code_sculptor',
      emoji: '🧹',
      title: 'Boy Scout Sculptor',
      roast: 'left the neighborhood cleaner and sharper than they found it.',
      accentCss: '#4ade80',
      bgCss: 'rgba(74, 222, 128, 0.15)',
      propKind: 'none',
    };
  }

  // 8. Lorekeeper — docs
  if (commit.kind === 'docs') {
    return {
      id: 'lorekeeper',
      emoji: '📜',
      title: 'Island Lorekeeper',
      roast: 'wrote down how it actually works so future travelers survive.',
      accentCss: '#67e8f9',
      bgCss: 'rgba(103, 232, 249, 0.15)',
      propKind: 'none',
    };
  }

  return {
    id: 'island_builder',
    emoji: '⚒️',
    title: 'Steady Craftsperson',
    roast: 'laid fresh timber and stone along the branch promenade.',
    accentCss: '#93c5fd',
    bgCss: 'rgba(147, 197, 253, 0.14)',
    propKind: 'none',
  };
}
