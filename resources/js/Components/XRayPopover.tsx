import { useRef } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { sound } from '@/lib/sound';
import type { RebaseAnimState, RepoVillageGraph, XRayLens } from '@/types/village';

interface XRayPopoverProps {
  graph: RepoVillageGraph;
  xRayLens: XRayLens;
  bisectActive: boolean;
  rebaseAnim: RebaseAnimState;
  onToggleLens: (lens: XRayLens) => void;
  onStartBisect: () => void;
  onStopBisect: () => void;
  onTriggerRebaseMode: (mode: 'rebase' | 'merge') => void;
  onSelectStash: (idx: number) => void;
  onSelectCommit: (sha: string) => void;
}

export function XRayPopover({
  graph,
  xRayLens,
  bisectActive,
  rebaseAnim,
  onToggleLens,
  onStartBisect,
  onStopBisect,
  onTriggerRebaseMode,
  onSelectStash,
  onSelectCommit,
}: XRayPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const hidePopover = () => {
    popoverRef.current?.hidePopover?.();
  };

  const ghostCount = graph.ghostCommits?.length ?? 0;
  const stashes = graph.stashes ?? [];
  const tags = graph.tags ?? [];
  const cherryPairs = graph.cherryPickPairs ?? [];
  const coAuthoredCommits = [...graph.commitsBySha.values()].filter(
    (c) => (c.coAuthors?.length ?? 0) > 0,
  );
  const soloBranches = graph.branches.filter((b) => b.soloOwnerName);
  const seasonalBranches = graph.branches.filter(
    (b) => b.season === 'autumn' || b.season === 'winter',
  );

  return (
    <div
      ref={popoverRef}
      id="xray-popover"
      className="apple-sheet hud-popover xray-popover"
      aria-label="Git X-Ray and Interactive Labs"
      {...({ popover: '' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h3>🔬 Git History X-Ray</h3>
          <span className="section-caption">
            Hidden Git mechanics flattened by 2D commit lists — brought to life in 3D
          </span>
        </div>
      </div>

      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>Interactive Git Labs</h3>
          <span className="section-caption">Step through algorithms &amp; history rewrites</span>
        </div>

        <div className="xray-lab-grid">
          <div className="inset-group xray-lab-card">
            <div className="xray-lab-head">
              <strong>🕵️ 3D git bisect Hunt</strong>
              <span className="meta-pill">O(log₂ N)</span>
            </div>
            <p className="xray-lab-desc">
              Binary-search history with a live 3D searchlight, halving suspects until the single
              culprit commit is caught.
            </p>
            <button
              type="button"
              id="xray-start-bisect-btn"
              className="apple-primary-btn xray-action-btn"
              onClick={() => {
                hidePopover();
                if (bisectActive) {
                  onStopBisect();
                } else {
                  onStartBisect();
                }
              }}
            >
              <span>{bisectActive ? 'Stop Bisect Hunt' : 'Start Bug-Hunt Spotlight'}</span>
            </button>
          </div>

          <div className="inset-group xray-lab-card">
            <div className="xray-lab-head">
              <strong>🧬 Rebase vs. Merge</strong>
              <span className="meta-pill">DAG Rewrite</span>
            </div>
            <p className="xray-lab-desc">
              Watch how <code>git rebase</code> clones new SHAs onto <code>{graph.defaultBranch}</code>{' '}
              while leaving the originals behind as Reflog Ghosts.
            </p>
            <div
              className="segmented-control xray-rebase-switch"
              role="group"
              aria-label="Topology comparison mode"
            >
              <button
                type="button"
                id="xray-mode-merge-btn"
                className="seg-btn"
                aria-pressed={rebaseAnim.mode === 'merge'}
                onClick={() => {
                  hidePopover();
                  onTriggerRebaseMode('merge');
                }}
              >
                🌉 Merge Bridge
              </button>
              <button
                type="button"
                id="xray-mode-rebase-btn"
                className="seg-btn"
                aria-pressed={rebaseAnim.mode === 'rebase'}
                onClick={() => {
                  hidePopover();
                  onTriggerRebaseMode('rebase');
                }}
              >
                🧬 Rebase Clones
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>Spatial 3D Lenses</h3>
          <span className="section-caption">Toggle village-wide X-ray beams &amp; landmarks</span>
        </div>

        <div className="preset-grid">
          <button
            type="button"
            id="xray-lens-bus-btn"
            className="preset-card xray-lens-btn"
            aria-pressed={xRayLens === 'bus_factor'}
            onClick={() => {
              hidePopover();
              onToggleLens('bus_factor');
            }}
          >
            <div className="preset-card-head">
              <strong>🛡️ Bus Factor · {graph.repoBusFactor ?? 1}</strong>
              <span
                className={`status-dot ${(graph.repoBusFactor ?? 1) <= 1 ? 'dot-red' : 'dot-green'}`}
                aria-hidden="true"
              />
            </div>
            <span>
              {soloBranches.length > 0
                ? `${soloBranches.length} solo-caretaker silo${soloBranches.length === 1 ? '' : 's'} with watchtowers`
                : 'Multi-contributor shared ownership across branches'}
            </span>
          </button>

          <button
            type="button"
            id="xray-lens-hotspots-btn"
            className="preset-card xray-lens-btn"
            aria-pressed={xRayLens === 'hotspots'}
            onClick={() => {
              hidePopover();
              onToggleLens('hotspots');
            }}
          >
            <div className="preset-card-head">
              <strong>🔥 Hotspot Forge &amp; Monument</strong>
              <span className="status-dot dot-amber" aria-hidden="true" />
            </div>
            <span>
              {graph.hotspots?.[0]
                ? `Top churn: ${graph.hotspots[0].filename.split('/').pop()} (${graph.hotspots[0].touches}x)`
                : 'Volcanic high-churn forge vs ancient mossy monument'}
            </span>
          </button>

          <button
            type="button"
            id="xray-lens-ghosts-btn"
            className="preset-card xray-lens-btn"
            aria-pressed={xRayLens === 'ghosts'}
            onClick={() => {
              hidePopover();
              onToggleLens('ghosts');
            }}
          >
            <div className="preset-card-head">
              <strong>👻 Reflog Ghost Ruins ({ghostCount})</strong>
              <span className="status-dot dot-purple" aria-hidden="true" />
            </div>
            <span>
              {ghostCount > 0
                ? `${ghostCount} amended/reset ghost commit${ghostCount === 1 ? '' : 's'} drifting below the clouds`
                : 'Available on local .git repos & Sky Village demo'}
            </span>
          </button>
        </div>
      </div>

      <details className="apple-disclosure xray-artifacts-details" open>
        <summary>
          <SfIcon name="sf-chevron-right" size={13} className="disclosure-chevron" />
          <span>
            Hidden Landmarks in Current Village ({tags.length} tags · {stashes.length} stashes ·{' '}
            {cherryPairs.length} portals · {coAuthoredCommits.length} pairs)
          </span>
        </summary>

        <div className="xray-chip-sections">
          {stashes.length > 0 && (
            <div className="xray-chip-row">
              <span className="xray-chip-label">📦 Stash Chests:</span>
              {stashes.map((st, idx) => (
                <button
                  key={st.selector}
                  type="button"
                  className="sha-pill"
                  onClick={() => {
                    sound.playPop(600);
                    hidePopover();
                    onSelectStash(idx);
                  }}
                >
                  <span>{st.selector}</span>
                </button>
              ))}
            </div>
          )}

          {tags.length > 0 && (
            <div className="xray-chip-row">
              <span className="xray-chip-label">🏷️ Tag Archways:</span>
              {tags.map((tg) => (
                <button
                  key={tg.name}
                  type="button"
                  className="sha-pill"
                  onClick={() => {
                    sound.playPop(620);
                    hidePopover();
                    onSelectCommit(tg.sha);
                  }}
                >
                  <span>{tg.name}</span>
                </button>
              ))}
            </div>
          )}

          {cherryPairs.length > 0 && (
            <div className="xray-chip-row">
              <span className="xray-chip-label">🌀 Cherry-Pick Portals:</span>
              {cherryPairs.map((cp) => (
                <button
                  key={`${cp.fromSha}-${cp.toSha}`}
                  type="button"
                  className="sha-pill"
                  onClick={() => {
                    sound.playPop(640);
                    hidePopover();
                    onSelectCommit(cp.toSha);
                  }}
                >
                  <span>
                    {cp.fromSha.slice(0, 6)} ⇄ {cp.toSha.slice(0, 6)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {coAuthoredCommits.length > 0 && (
            <div className="xray-chip-row">
              <span className="xray-chip-label">🤝 Co-Authored Pairs:</span>
              {coAuthoredCommits.slice(0, 4).map((c) => (
                <button
                  key={c.sha}
                  type="button"
                  className="sha-pill"
                  onClick={() => {
                    sound.playPop(580);
                    hidePopover();
                    onSelectCommit(c.sha);
                  }}
                >
                  <span>
                    {c.shortSha} (+{c.coAuthors?.[0]?.name.split(' ')[0]})
                  </span>
                </button>
              ))}
            </div>
          )}

          {seasonalBranches.length > 0 && (
            <div className="xray-chip-row">
              <span className="xray-chip-label">🍂 Seasonal Outposts:</span>
              {seasonalBranches.map((b) => (
                <span key={b.name} className="meta-pill">
                  {b.season === 'winter' ? '❄️' : '🍂'} {b.name} ({b.ageDays}d)
                </span>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
