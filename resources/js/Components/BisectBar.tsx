import { SfIcon } from '@/Components/SfIconSprite';
import type { BisectState, RepoVillageGraph } from '@/types/village';

interface BisectBarProps {
  bisect: BisectState;
  graph: RepoVillageGraph;
  onMarkGood: () => void;
  onMarkBad: () => void;
  onStop: () => void;
}

export function BisectBar({
  bisect,
  graph,
  onMarkGood,
  onMarkBad,
  onStop,
}: BisectBarProps) {
  if (!bisect.active) {
    return null;
  }

  const currentSha = bisect.resolvedCulpritSha ?? bisect.orderedShas[bisect.midIdx];
  const currentCommit = currentSha ? graph.commitsBySha.get(currentSha) : undefined;
  const remaining = Math.max(0, bisect.highIdx - bisect.lowIdx);

  return (
    <div id="bisect-hud" className="apple-sheet bisect-hud" role="region" aria-label="Interactive git bisect controls">
      <div className="bisect-hud-copy">
        <div className="bisect-hud-top">
          <span className={`bisect-badge${bisect.resolvedCulpritSha ? ' is-culprit' : ''}`}>
            {bisect.resolvedCulpritSha
              ? `🚨 Culprit Found in ${bisect.step} step${bisect.step === 1 ? '' : 's'}!`
              : `🕵️ git bisect · Step ${bisect.step} of ~${bisect.maxSteps}`}
          </span>
          {!bisect.resolvedCulpritSha && (
            <span className="bisect-remaining">{remaining} commits in window</span>
          )}
        </div>
        <strong className="bisect-subject">
          {currentCommit
            ? `${currentCommit.shortSha} · ${currentCommit.subject}`
            : 'Testing midpoint commit…'}
        </strong>
      </div>

      <div className="bisect-hud-actions">
        {!bisect.resolvedCulpritSha ? (
          <>
            <button
              type="button"
              id="bisect-good-btn"
              className="bisect-verdict-btn is-good"
              onClick={onMarkGood}
            >
              <span aria-hidden="true">🟢</span>
              <span>Good</span>
            </button>
            <button
              type="button"
              id="bisect-bad-btn"
              className="bisect-verdict-btn is-bad"
              onClick={onMarkBad}
            >
              <span aria-hidden="true">🔴</span>
              <span>Bad</span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          id="bisect-close-btn"
          className="circle-close-btn"
          aria-label="Exit git bisect mode"
          onClick={onStop}
        >
          <SfIcon name="sf-close" size={11} />
        </button>
      </div>
    </div>
  );
}
