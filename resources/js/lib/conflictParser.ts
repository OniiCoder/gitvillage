import type { ConflictDiffSides } from '@/types/village';

export interface ParsedConflictResult {
  conflict: ConflictDiffSides;
  diffPreview: string;
  additions: number;
  deletions: number;
}

/**
 * Extracts Git merge conflict hunks (`<<<<<<<`, optional `|||||||`, `=======`, `>>>>>>>`)
 * from a conflicted working-tree file so GitVillage can render both inline conflict markers
 * and a clean Side-by-Side Ours vs Theirs view.
 */
export function parseConflictMarkersFromText(
  rawText: string,
  fallbackOursLabel = 'HEAD',
  fallbackTheirsLabel = 'incoming',
): ParsedConflictResult | null {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const hunks: Array<{
    startLine: number;
    oursLabel: string;
    theirsLabel: string;
    contextBefore: string[];
    oursLines: string[];
    theirsLines: string[];
    contextAfter: string[];
  }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('<<<<<<<')) {
      i++;
      continue;
    }

    const startLine = i + 1;
    const rawOursLabel = line.slice(7).trim() || fallbackOursLabel;
    const contextBefore = lines.slice(Math.max(0, i - 2), i);
    const oursLines: string[] = [];
    const theirsLines: string[] = [];
    let state: 'ours' | 'base' | 'theirs' = 'ours';
    let rawTheirsLabel = fallbackTheirsLabel;
    let foundEnd = false;

    i++;
    while (i < lines.length) {
      const cur = lines[i];
      if (state === 'ours' && cur.startsWith('|||||||')) {
        state = 'base';
      } else if ((state === 'ours' || state === 'base') && cur.startsWith('=======')) {
        state = 'theirs';
      } else if (state === 'theirs' && cur.startsWith('>>>>>>>')) {
        rawTheirsLabel = cur.slice(7).trim() || fallbackTheirsLabel;
        foundEnd = true;
        i++;
        break;
      } else if (state === 'ours') {
        oursLines.push(cur);
      } else if (state === 'theirs') {
        theirsLines.push(cur);
      }
      i++;
    }

    if (foundEnd) {
      const contextAfter = lines.slice(i, Math.min(lines.length, i + 2));
      hunks.push({
        startLine,
        oursLabel: rawOursLabel,
        theirsLabel: rawTheirsLabel,
        contextBefore,
        oursLines,
        theirsLines,
        contextAfter,
      });
    }
  }

  if (hunks.length === 0) {
    return null;
  }

  const oursLabel = hunks[0].oursLabel || fallbackOursLabel;
  const theirsLabel = hunks[0].theirsLabel || fallbackTheirsLabel;

  const oursBlocks: string[] = [];
  const theirsBlocks: string[] = [];
  const previewLines: string[] = [];
  let totalOurs = 0;
  let totalTheirs = 0;

  hunks.slice(0, 6).forEach((h, idx) => {
    totalOurs += h.oursLines.length;
    totalTheirs += h.theirsLines.length;

    const header =
      hunks.length > 1
        ? `// Conflict #${idx + 1} (line ${h.startLine})`
        : `// Line ${h.startLine}`;

    oursBlocks.push(
      [header, ...h.contextBefore, ...h.oursLines, ...h.contextAfter].join('\n'),
    );
    theirsBlocks.push(
      [header, ...h.contextBefore, ...h.theirsLines, ...h.contextAfter].join('\n'),
    );

    const oldSpan = h.contextBefore.length + h.oursLines.length + h.contextAfter.length;
    const newSpan = h.contextBefore.length + h.theirsLines.length + h.contextAfter.length;
    previewLines.push(`@@ -${h.startLine},${oldSpan} +${h.startLine},${newSpan} @@ Conflict #${idx + 1}`);
    for (const ctx of h.contextBefore) previewLines.push(` ${ctx}`);
    previewLines.push(`<<<<<<< ${h.oursLabel}`);
    for (const ol of h.oursLines) previewLines.push(`-${ol}`);
    previewLines.push('=======');
    for (const tl of h.theirsLines) previewLines.push(`+${tl}`);
    previewLines.push(`>>>>>>> ${h.theirsLabel}`);
    for (const ctx of h.contextAfter) previewLines.push(` ${ctx}`);
  });

  return {
    conflict: {
      oursLabel,
      theirsLabel,
      oursContent: oursBlocks.join('\n\n').slice(0, 8000),
      theirsContent: theirsBlocks.join('\n\n').slice(0, 8000),
      conflictMarkersCount: hunks.length,
    },
    diffPreview: previewLines.join('\n').slice(0, 10000),
    additions: Math.max(1, totalTheirs),
    deletions: Math.max(1, totalOurs),
  };
}
