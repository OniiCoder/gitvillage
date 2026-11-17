import { useEffect, useRef, type FormEvent } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import type { ContributorClanProfile } from '@/lib/villagerMesh';
import type { CameraMode, RepoVillageGraph, TimeOfDay } from '@/types/village';

interface SpatialTopbarProps {
  graph: RepoVillageGraph;
  villagerCount: number;
  gateVisitorsCount: number;
  clans: ContributorClanProfile[];
  activeAuthorKey: string | null;
  repoInput: string;
  onRepoInputChange: (val: string) => void;
  onSubmitRepo: (e: FormEvent) => void;
  isLoading: boolean;
  localServerEnabled: boolean;
  cameraMode: CameraMode;
  timeOfDay: TimeOfDay;
  muted: boolean;
  onOpenLocalModal: () => void;
  onToggleAuthor: (authorKey: string) => void;
  onToggleWalkMode: () => void;
  onCycleSky: () => void;
  onToggleMute: () => void;
  onShare: () => void;
}

export function SpatialTopbar({
  graph,
  villagerCount,
  gateVisitorsCount,
  clans,
  activeAuthorKey,
  repoInput,
  onRepoInputChange,
  onSubmitRepo,
  isLoading,
  localServerEnabled,
  cameraMode,
  timeOfDay,
  muted,
  onOpenLocalModal,
  onToggleAuthor,
  onToggleWalkMode,
  onCycleSky,
  onToggleMute,
  onShare,
}: SpatialTopbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Roving tabindex fallback only when native focusgroup is unsupported
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar || 'focusGroup' in HTMLElement.prototype) return;

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.hidden);
    const initial = getItems();
    initial.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
    });

    const onFocusIn = ({ target }: FocusEvent) => {
      const items = getItems();
      if (target instanceof HTMLButtonElement && items.includes(target)) {
        items.forEach((b) => {
          b.tabIndex = b === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const items = getItems();
      const active = document.activeElement;
      if (!(active instanceof HTMLButtonElement)) return;
      const idx = items.indexOf(active);
      if (idx < 0) return;

      const rtl = getComputedStyle(bar).direction === 'rtl';
      let nextIdx: number | null = null;
      if (e.key === 'ArrowRight') {
        nextIdx = (idx + (rtl ? -1 : 1) + items.length) % items.length;
      } else if (e.key === 'ArrowLeft') {
        nextIdx = (idx + (rtl ? 1 : -1) + items.length) % items.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = items.length - 1;
      }

      if (nextIdx !== null) {
        e.preventDefault();
        items[nextIdx].focus();
      }
    };

    bar.addEventListener('focusin', onFocusIn);
    bar.addEventListener('keydown', onKeyDown);
    return () => {
      bar.removeEventListener('focusin', onFocusIn);
      bar.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const statsLabel = graph.isLocal
    ? `${graph.repo} · ${villagerCount} commits · ${gateVisitorsCount} at gate`
    : `${graph.repo} · ${villagerCount} commits · ${graph.branches.length} island${graph.branches.length === 1 ? '' : 's'}`;

  const skySymbol =
    timeOfDay === 'day' ? 'sf-sun' : timeOfDay === 'sunset' ? 'sf-sunset' : 'sf-moon';

  return (
    <header className="spatial-topbar">
      <div className="brand-cluster">
        <span className="brand-glyph" aria-hidden="true">
          <SfIcon name="sf-archipelago" size={16} />
        </span>
        <div className="brand-meta">
          <span className="brand-name">Archipelago</span>
          <span id="repo-stats-pill" className="stats-pill">
            {statsLabel}
          </span>
          <div
            id="contributor-stack"
            className="contributor-stack"
            role="group"
            aria-label="Spotlight contributor clan"
          >
            {clans.slice(0, 6).map((clan) => {
              const avatarSrc =
                clan.authorAvatar &&
                clan.authorAvatar.includes('githubusercontent.com') &&
                !clan.authorAvatar.includes('s=')
                  ? `${clan.authorAvatar}${clan.authorAvatar.includes('?') ? '&' : '?'}s=64`
                  : clan.authorAvatar;

              return (
                <button
                  key={clan.authorKey}
                  type="button"
                  className="clan-avatar-btn"
                  style={{ background: clan.colorCss }}
                  aria-pressed={activeAuthorKey === clan.authorKey}
                  aria-label={`Spotlight contributor ${clan.authorName} (${clan.commitCount} commits)`}
                  title={`${clan.emblem} ${clan.authorName} (@${clan.authorLogin}) · ${clan.earLabel} · ${clan.commitCount} commit${clan.commitCount === 1 ? '' : 's'}`}
                  onClick={() => onToggleAuthor(clan.authorKey)}
                >
                  {avatarSrc ? (
                    <img src={avatarSrc} width={26} height={26} decoding="async" alt="" />
                  ) : (
                    clan.initials
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <span className="ornament-divider" aria-hidden="true" />

      <form id="repo-form" className="repo-form" autoComplete="off" onSubmit={onSubmitRepo}>
        <label htmlFor="repo-input" className="sr-only">
          GitHub repository or local folder path
        </label>
        <SfIcon name="sf-search" size={15} className="search-lead-icon" />
        <input
          id="repo-input"
          name="repo"
          type="text"
          value={repoInput}
          onChange={(e) => onRepoInputChange(e.target.value)}
          placeholder={
            localServerEnabled
              ? 'GitHub owner/repo or local path…'
              : 'GitHub owner/repo or URL…'
          }
          spellCheck={false}
        />
        <button
          type="submit"
          id="load-btn"
          className="search-submit-btn"
          aria-label="Open repository"
          title="Open repository"
          disabled={isLoading}
        >
          <SfIcon name="sf-arrow-right" size={14} />
        </button>
      </form>

      <span className="ornament-divider" aria-hidden="true" />

      <div
        ref={toolbarRef}
        id="main-toolbar"
        className="toolbar-actions"
        role="toolbar"
        aria-label="Village controls"
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
      >
        <div className="toolbar-group" role="group" aria-label="Repositories and Census">
          <button
            type="button"
            id="local-quick-btn"
            className="tb-btn"
            title="Choose a local Git repository"
            onClick={onOpenLocalModal}
          >
            <SfIcon name="sf-folder" size={15} />
            <span>Local…</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Browse showcase and local repositories"
            {...({
              commandfor: 'presets-popover',
              command: 'toggle-popover',
            } as Record<string, string>)}
          >
            <SfIcon name="sf-grid" size={15} />
            <span>Presets</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            title="View commit census"
            {...({
              commandfor: 'roster-popover',
              command: 'toggle-popover',
            } as Record<string, string>)}
          >
            <SfIcon name="sf-people" size={15} />
            <span>Census</span>
          </button>
        </div>

        <span className="toolbar-sep" role="separator" aria-orientation="vertical" />

        <div className="toolbar-group" role="group" aria-label="Experience controls">
          <button
            type="button"
            id="mode-btn"
            className="tb-btn"
            aria-pressed={cameraMode === 'walk'}
            title="Toggle third-person Walk Mode (WASD)"
            onClick={onToggleWalkMode}
          >
            <SfIcon name="sf-walk" size={15} />
            <span>Walk</span>
          </button>
          <button
            type="button"
            id="sky-btn"
            className="tb-btn tb-icon-only"
            aria-label="Cycle time of day"
            title="Cycle time of day"
            onClick={onCycleSky}
          >
            <SfIcon name={skySymbol} size={15} />
          </button>
          <button
            type="button"
            id="sound-btn"
            className="tb-btn tb-icon-only"
            aria-pressed={!muted}
            aria-label="Cozy audio"
            title="Toggle cozy audio"
            onClick={onToggleMute}
          >
            <SfIcon name={muted ? 'sf-speaker-mute' : 'sf-speaker'} size={15} />
          </button>
          <button
            type="button"
            id="share-btn"
            className="tb-btn tb-icon-only"
            aria-label="Copy shareable link"
            title="Copy shareable link"
            onClick={onShare}
          >
            <SfIcon name="sf-share" size={15} />
          </button>
          <button
            type="button"
            id="help-btn"
            className="tb-btn tb-icon-only"
            aria-label="Open Village Field Guide"
            title="Village Field Guide"
            {...({
              commandfor: 'help-dialog',
              command: 'show-modal',
            } as Record<string, string>)}
          >
            <SfIcon name="sf-question" size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
