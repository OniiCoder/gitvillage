import { SfIcon } from '@/Components/SfIconSprite';
import { computeCommitArchetype } from '@/lib/archetypes';
import type { TimeLapseState } from '@/types/village';

interface TimeLapseBarProps {
  timeLapse: TimeLapseState;
  onTogglePause: () => void;
  onRestart: () => void;
  onStop: () => void;
}

export function TimeLapseBar({
  timeLapse,
  onTogglePause,
  onRestart,
  onStop,
}: TimeLapseBarProps) {
  if (!timeLapse.active) return null;

  const commit = timeLapse.currentCommit;
  const arch = commit ? computeCommitArchetype(commit) : null;

  return (
    <aside className="timelapse-hud" aria-label="Time-lapse history replay">
      <div className="timelapse-top-row">
        <div className="timelapse-meta">
          <span className="timelapse-counter">
            Commit {timeLapse.currentIndex} / {timeLapse.totalCommits}
          </span>
          {commit && arch && (
            <span className="timelapse-commit-line" title={commit.subject}>
              <strong>
                {arch.emoji} {commit.authorName}
              </strong>{' '}
              · {commit.subject}
            </span>
          )}
        </div>

        <div className="timelapse-controls">
          <button
            type="button"
            className="tb-btn tb-icon-only"
            aria-label={timeLapse.paused ? 'Resume time-lapse' : 'Pause time-lapse'}
            title={timeLapse.paused ? 'Resume' : 'Pause'}
            onClick={onTogglePause}
          >
            <SfIcon name={timeLapse.paused ? 'sf-play' : 'sf-pause'} size={13} />
          </button>
          <button
            type="button"
            className="tb-btn tb-icon-only"
            aria-label="Restart time-lapse from commit 1"
            title="Restart"
            onClick={onRestart}
          >
            <SfIcon name="sf-refresh" size={13} />
          </button>
          <button
            type="button"
            className="circle-close-btn"
            aria-label="Exit time-lapse replay"
            title="Exit replay"
            onClick={onStop}
          >
            <SfIcon name="sf-close" size={11} />
          </button>
        </div>
      </div>

      <progress
        className="gv-progress timelapse-progress"
        aria-label="Time-lapse replay completion"
        value={timeLapse.currentIndex}
        max={Math.max(1, timeLapse.totalCommits)}
      />
    </aside>
  );
}
