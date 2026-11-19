export interface ParsedDiffLine {
  type:
    | 'hunk'
    | 'add'
    | 'del'
    | 'context'
    | 'meta'
    | 'conflict-ours'
    | 'conflict-base'
    | 'conflict-sep'
    | 'conflict-theirs';
  oldNumber: number | null;
  newNumber: number | null;
  sigil: string;
  content: string;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedPatch(patch: string): ParsedDiffLine[] {
  const rawLines = patch.replace(/\r\n/g, '\n').split('\n');
  const parsed: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of rawLines) {
    const hunkMatch = HUNK_HEADER_RE.exec(raw);
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[2], 10);
      inHunk = true;
      parsed.push({
        type: 'hunk',
        oldNumber: null,
        newNumber: null,
        sigil: '@@',
        content: raw,
      });
      continue;
    }

    if (raw.startsWith('<<<<<<<')) {
      inHunk = true;
      parsed.push({
        type: 'conflict-ours',
        oldNumber: null,
        newNumber: null,
        sigil: '≪',
        content: `${raw}  (Ours / Current)`,
      });
      continue;
    }

    if (raw.startsWith('|||||||')) {
      inHunk = true;
      parsed.push({
        type: 'conflict-base',
        oldNumber: null,
        newNumber: null,
        sigil: '‖',
        content: `${raw}  (Common Ancestor)`,
      });
      continue;
    }

    if (raw.startsWith('=======')) {
      inHunk = true;
      parsed.push({
        type: 'conflict-sep',
        oldNumber: null,
        newNumber: null,
        sigil: '⚔',
        content: '=======  vs Incoming Branch',
      });
      continue;
    }

    if (raw.startsWith('>>>>>>>')) {
      inHunk = true;
      parsed.push({
        type: 'conflict-theirs',
        oldNumber: null,
        newNumber: null,
        sigil: '≫',
        content: `${raw}  (Theirs / Incoming)`,
      });
      continue;
    }

    if (!inHunk) {
      parsed.push({
        type: 'meta',
        oldNumber: null,
        newNumber: null,
        sigil: '',
        content: raw,
      });
      continue;
    }

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      parsed.push({
        type: 'add',
        oldNumber: null,
        newNumber: newLine++,
        sigil: '+',
        content: raw.slice(1),
      });
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      parsed.push({
        type: 'del',
        oldNumber: oldLine++,
        newNumber: null,
        sigil: '−',
        content: raw.slice(1),
      });
    } else if (raw.startsWith('\\')) {
      parsed.push({
        type: 'meta',
        oldNumber: null,
        newNumber: null,
        sigil: '',
        content: raw,
      });
    } else {
      const clean = raw.startsWith(' ') ? raw.slice(1) : raw;
      parsed.push({
        type: 'context',
        oldNumber: oldLine++,
        newNumber: newLine++,
        sigil: ' ',
        content: clean,
      });
    }
  }

  return parsed;
}

interface DiffCodeBlockProps {
  id?: string;
  patch?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  maxHeight?: string;
}

export function DiffCodeBlock({
  id,
  patch,
  isLoading = false,
  emptyMessage = 'Binary file or diff omitted',
  maxHeight,
}: DiffCodeBlockProps) {
  if (isLoading) {
    return (
      <div id={id} className="diff-empty-notice" role="status">
        Loading unified diff…
      </div>
    );
  }

  const trimmed = patch?.trim() ?? '';
  if (!trimmed) {
    return (
      <div id={id} className="diff-empty-notice">
        {emptyMessage}
      </div>
    );
  }

  const lines = parseUnifiedPatch(trimmed);
  const hasStructuredHunk = lines.some(
    (l) =>
      l.type === 'hunk' ||
      l.type === 'add' ||
      l.type === 'del' ||
      l.type === 'conflict-ours',
  );

  if (!hasStructuredHunk) {
    return (
      <div id={id} className="diff-empty-notice">
        {trimmed}
      </div>
    );
  }

  return (
    <div
      id={id}
      className="diff-code-scroll"
      style={maxHeight ? { maxBlockSize: maxHeight } : undefined}
    >
      <div className="diff-code-lines">
        {lines.map((line, idx) => {
          if (
            line.type === 'hunk' ||
            line.type === 'meta' ||
            line.type.startsWith('conflict-')
          ) {
            return (
              <div
                key={idx}
                className={`diff-row diff-row-span diff-row-${line.type}`}
              >
                <span className="diff-gutter diff-gutter-span" aria-hidden="true">
                  {line.sigil || '·'}
                </span>
                <code className="diff-code-text">{line.content}</code>
              </div>
            );
          }

          return (
            <div key={idx} className={`diff-row diff-row-${line.type}`}>
              <span className="diff-gutter" aria-hidden="true">
                {line.oldNumber ?? '\u00a0'}
              </span>
              <span className="diff-gutter" aria-hidden="true">
                {line.newNumber ?? '\u00a0'}
              </span>
              <span className="diff-sigil" aria-hidden="true">
                {line.sigil}
              </span>
              <code className="diff-code-text">{line.content || '\u00a0'}</code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
