import { useRef, useState } from 'react';
import {
  type ContributorClanProfile,
  getCommitCargoMetrics,
  getRoleMeta,
  getVisitorStatusMeta,
  normalizeAuthorKey,
} from '@/lib/villagerMesh';
import type { CommitData, RepoVillageGraph } from '@/types/village';

interface CensusPopoverProps {
  graph: RepoVillageGraph;
  clanMap: Map<string, ContributorClanProfile>;
  onSelectCommit: (sha: string) => void;
  onSelectVisitor: (idx: number) => void;
}

export function CensusPopover({
  graph,
  clanMap,
  onSelectCommit,
  onSelectVisitor,
}: CensusPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [groupMode, setGroupMode] = useState<'branch' | 'author'>('branch');

  const allCommits = graph.branches.flatMap((b) => b.commits);
  const grouped: Partial<Record<string, CommitData[]>> = Object.groupBy(
    allCommits,
    (c): string => {
      if (groupMode === 'branch') return c.branch;
      const clan = clanMap.get(normalizeAuthorKey(c));
      return clan
        ? `${clan.emblem} ${clan.authorName} · ${clan.earLabel}`
        : `${c.authorName} (@${c.authorLogin})`;
    },
  );

  const gateVisitors = graph.gateVisitors ?? [];

  return (
    <div
      ref={popoverRef}
      id="roster-popover"
      className="apple-sheet hud-popover roster-popover"
      aria-label="Village Census"
      {...({ popover: '' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h3>Village Census</h3>
          <span className="section-caption">Select any citizen or waiting file to focus</span>
        </div>
        <div className="segmented-control" role="group" aria-label="Group citizens by">
          <button
            type="button"
            id="group-branch-btn"
            className="seg-btn"
            aria-pressed={groupMode === 'branch'}
            onClick={() => setGroupMode('branch')}
          >
            Island
          </button>
          <button
            type="button"
            id="group-author-btn"
            className="seg-btn"
            aria-pressed={groupMode === 'author'}
            onClick={() => setGroupMode('author')}
          >
            Author
          </button>
        </div>
      </div>

      <div id="roster-list" className="roster-list">
        {graph.isLocal && gateVisitors.length > 0 && (
          <div>
            <div className="roster-group-title">Waiting at Gate ({gateVisitors.length})</div>
            <div className="roster-group-box">
              {gateVisitors.map((gv, idx) => (
                <button
                  key={`${gv.filename}-${idx}`}
                  type="button"
                  className="roster-row"
                  onClick={() => {
                    popoverRef.current?.hidePopover?.();
                    onSelectVisitor(idx);
                  }}
                >
                  <span className="roster-row-subj">
                    <span
                      className={`status-dot ${getVisitorStatusMeta(gv.status).dotClass}`}
                      aria-hidden="true"
                    />
                    <span>{gv.filename}</span>
                  </span>
                  <span className="roster-row-sha">{gv.staged ? 'Staged' : gv.status}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([groupTitle, commits]) => {
          if (!commits || commits.length === 0) return null;
          const ordered = commits.toReversed();
          return (
            <div key={groupTitle}>
              <div className="roster-group-title">
                {groupTitle} ({ordered.length})
              </div>
              <div className="roster-group-box">
                {ordered.map((c) => {
                  const cargo = getCommitCargoMetrics(c);
                  const clan = clanMap.get(normalizeAuthorKey(c));
                  return (
                    <button
                      key={c.sha}
                      type="button"
                      className="roster-row"
                      onClick={() => {
                        popoverRef.current?.hidePopover?.();
                        onSelectCommit(c.sha);
                      }}
                    >
                      <span className="roster-row-subj">
                        <span
                          className={`status-dot ${getRoleMeta(c.kind).dotClass}`}
                          aria-hidden="true"
                        />
                        {clan && (
                          <span
                            className="roster-clan-chip"
                            style={{ background: clan.colorCss }}
                          >
                            {clan.initials}
                          </span>
                        )}
                        <span>{c.subject}</span>
                      </span>
                      <span className="roster-row-sha">
                        {cargo.filesCount}f · {c.shortSha}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
