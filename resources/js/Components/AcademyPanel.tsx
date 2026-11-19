import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { ACADEMY_CHAPTERS, type AcademyProgressSnapshot } from '@/lib/gitAcademy';

interface AcademyPanelProps {
  academy: AcademyProgressSnapshot;
  onSelectChapter: (chapterNumber: number) => void;
  onRunGuidedStep: () => void;
  onSubmitCli: (cmd: string) => void;
  onResetChapter: () => void;
  onExitAcademy: () => void;
}

export function AcademyPanel({
  academy,
  onSelectChapter,
  onRunGuidedStep,
  onSubmitCli,
  onResetChapter,
  onExitAcademy,
}: AcademyPanelProps) {
  const [cliInput, setCliInput] = useState('');
  const [minimized, setMinimized] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const lastCompositionEndRef = useRef<number | null>(null);

  useEffect(() => {
    if (!academy.active) return;
    const strip = stripRef.current;
    const activeBtn = strip?.querySelector<HTMLButtonElement>('[data-active="true"]');
    activeBtn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [academy.active, academy.chapterNumber]);

  if (!academy.active) {
    return null;
  }

  const chapter =
    ACADEMY_CHAPTERS.find((c) => c.number === academy.chapterNumber) ?? ACADEMY_CHAPTERS[0];
  const currentStep = chapter.steps[academy.stepIndex] ?? null;
  const nextChapter = ACADEMY_CHAPTERS.find((c) => c.number === chapter.number + 1) ?? null;
  const completedCount = academy.completedChapters.length;

  const handleCliSubmit = (e: FormEvent) => {
    e.preventDefault();
    const val = cliInput.trim();
    if (!val) {
      if (currentStep) {
        onRunGuidedStep();
      }
      return;
    }
    onSubmitCli(val);
    setCliInput('');
  };

  // IME-safe Enter handling per modern-web-guidance `ime-safe-enter-submit`
  const handleCliKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (
        e.nativeEvent.isComposing ||
        e.keyCode === 229 ||
        (lastCompositionEndRef.current !== null &&
          Math.abs(e.timeStamp - lastCompositionEndRef.current) < 50)
      ) {
        e.preventDefault();
      }
    }
  };

  return (
    <aside
      id="academy-panel"
      className={`apple-sheet academy-panel${minimized ? ' is-minimized' : ''}`}
      aria-label="Interactive 3D Git Academy"
    >
      <div className="academy-header">
        <div className="academy-title-group">
          <div className="academy-badge-row">
            <span className="academy-tier-pill">{chapter.tier}</span>
            <span id="academy-progress-label" className="academy-mastery-text">
              {completedCount}/{ACADEMY_CHAPTERS.length} mastered
            </span>
          </div>
          <h2 className="academy-heading">
            {chapter.emoji} {String(chapter.number).padStart(2, '0')} · {chapter.title}
          </h2>
        </div>

        <div className="academy-header-btns">
          <button
            type="button"
            id="academy-minimize-btn"
            className="sheet-btn academy-mini-btn"
            aria-expanded={!minimized}
            aria-label={minimized ? 'Expand lesson card' : 'Minimize lesson card to inspect 3D scene'}
            onClick={() => setMinimized((m) => !m)}
          >
            <span>{minimized ? 'Expand' : 'Hide'}</span>
          </button>
          <button
            type="button"
            id="academy-exit-btn"
            className="circle-close-btn"
            aria-label="Exit Git Academy"
            title="Exit Git Academy back to Village Explorer"
            onClick={onExitAcademy}
          >
            <SfIcon name="sf-close" size={12} />
          </button>
        </div>
      </div>

      <progress
        className="gv-progress academy-progress"
        aria-labelledby="academy-progress-label"
        value={completedCount}
        max={ACADEMY_CHAPTERS.length}
      />

      {!minimized && (
        <>
          <div
            ref={stripRef}
            className="academy-chapter-strip"
            role="group"
            aria-label="Git Academy chapters"
          >
            {ACADEMY_CHAPTERS.map((ch) => {
              const isDone = academy.completedChapters.includes(ch.number);
              const isCurrent = ch.number === chapter.number;
              return (
                <button
                  key={ch.id}
                  type="button"
                  data-active={isCurrent ? 'true' : undefined}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`academy-ch-chip${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`}
                  onClick={() => onSelectChapter(ch.number)}
                >
                  <span>
                    {isDone ? '✓ ' : ''}
                    {String(ch.number).padStart(2, '0')} {ch.emoji}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="academy-concept-copy">{chapter.conceptSummary}</p>

          {currentStep ? (
            <div className="inset-group academy-step-box">
              <div className="academy-step-top">
                <span className="meta-pill">
                  Step {academy.stepIndex + 1} of {chapter.steps.length}
                </span>
                <button
                  type="button"
                  className="diff-mini-btn"
                  onClick={onResetChapter}
                  title="Reset this chapter's 3D sandbox"
                >
                  Reset
                </button>
              </div>
              <p className="academy-step-instruction">{currentStep.instruction}</p>
              <div className="academy-visual-cue">
                <span aria-hidden="true">👀</span>
                <span>{currentStep.visualCue}</span>
              </div>
              <code className="academy-cmd-preview">$ {currentStep.command}</code>
              <button
                type="button"
                id="academy-run-step-btn"
                className="apple-primary-btn academy-primary-cta"
                onClick={onRunGuidedStep}
              >
                <SfIcon name="sf-play" size={12} />
                <span>{currentStep.actionLabel}</span>
              </button>
            </div>
          ) : (
            <div className="inset-group academy-step-box is-complete">
              <div className="academy-step-top">
                <span className="meta-pill">🎉 Chapter {chapter.number} Complete!</span>
                <button type="button" className="diff-mini-btn" onClick={onResetChapter}>
                  Replay Chapter
                </button>
              </div>
              <p className="academy-step-instruction">
                {nextChapter
                  ? `You nailed ${chapter.title}! Ready for Chapter ${nextChapter.number} (${nextChapter.emoji} ${nextChapter.title}) — or experiment freely in the terminal below!`
                  : '🏆 You mastered all 10 3D Git chapters — from git init to rebase, cherry-pick, reflog rescue, and bisect! Keep experimenting freely below.'}
              </p>
              {nextChapter ? (
                <button
                  type="button"
                  id="academy-next-chapter-btn"
                  className="apple-primary-btn academy-primary-cta"
                  onClick={() => onSelectChapter(nextChapter.number)}
                >
                  <span>
                    Next: {String(nextChapter.number).padStart(2, '0')} ·{' '}
                    {nextChapter.title.split('—')[0].trim()}
                  </span>
                  <SfIcon name="sf-arrow-right" size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  className="apple-primary-btn academy-primary-cta"
                  onClick={onExitAcademy}
                >
                  <span>Explore Real GitHub Repos in 3D</span>
                  <SfIcon name="sf-arrow-right" size={13} />
                </button>
              )}
            </div>
          )}

          {/* Live Interactive Sandbox Mini-Terminal */}
          <div className="academy-terminal-box">
            {academy.terminal.length > 0 && (
              <div className="academy-terminal-log" role="log" aria-label="Git terminal output">
                {academy.terminal.slice(-2).map((entry) => (
                  <div
                    key={entry.id}
                    className={`academy-log-item${entry.isError ? ' is-error' : ''}`}
                  >
                    <div className="academy-log-cmd">$ {entry.cmd}</div>
                    <div className="academy-log-out">{entry.output}</div>
                  </div>
                ))}
              </div>
            )}

            <form className="academy-cli-form" onSubmit={handleCliSubmit}>
              <label htmlFor="academy-cli-input" className="sr-only">
                Type a Git command to run in the 3D sandbox
              </label>
              <span className="academy-cli-prompt" aria-hidden="true">
                ({academy.currentBranch}) $
              </span>
              <input
                id="academy-cli-input"
                name="git_command"
                type="text"
                value={cliInput}
                onChange={(e) => setCliInput(e.target.value)}
                onCompositionEnd={(e) => {
                  lastCompositionEndRef.current = e.timeStamp;
                }}
                onKeyDown={handleCliKeyDown}
                placeholder={currentStep ? currentStep.command : 'git commit -m "try anything!"'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="send"
                className="academy-cli-input"
              />
              <button type="submit" id="academy-cli-submit" className="diff-mini-btn diff-mini-btn-accent">
                Run
              </button>
            </form>
            <div className="academy-sandbox-note">
              <span aria-hidden="true">🔒</span> 100% in-browser sandbox — nothing is saved to disk or pushed anywhere.
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
