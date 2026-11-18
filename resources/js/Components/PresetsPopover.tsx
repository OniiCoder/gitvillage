import { useEffect, useRef, useState } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { discoverLocalRepos, type DiscoveredLocalRepo } from '@/lib/localLoader';
import type { ShowcaseRepo } from '@/types/village';

interface PresetsPopoverProps {
  localServerEnabled: boolean;
  showcaseRepos: ShowcaseRepo[];
  githubToken: string;
  onGithubTokenChange: (val: string) => void;
  onSelectRepo: (slug: string) => void;
  onSelectLocalPath: (path: string) => void;
  onOpenLocalModal: () => void;
}

export function PresetsPopover({
  localServerEnabled,
  showcaseRepos,
  githubToken,
  onGithubTokenChange,
  onSelectRepo,
  onSelectLocalPath,
  onOpenLocalModal,
}: PresetsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredLocalRepo[]>([]);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el || !localServerEnabled) return;

    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        void discoverLocalRepos().then(setDiscoveredRepos);
      }
    };
    el.addEventListener('beforetoggle', onBeforeToggle);
    return () => el.removeEventListener('beforetoggle', onBeforeToggle);
  }, [localServerEnabled]);

  const hidePopover = () => {
    popoverRef.current?.hidePopover?.();
  };

  return (
    <div
      ref={popoverRef}
      id="presets-popover"
      className="apple-sheet hud-popover"
      aria-label="Repositories"
      {...({ popover: '' } as Record<string, string>)}
    >
      <div id="presets-local-section" className="sheet-section">
        <div className="section-heading-row">
          <h3>Local Repositories</h3>
          <span className="section-caption">Uncommitted files queue at the Village Gate</span>
        </div>
        <div id="local-repos-grid" className="preset-grid">
          {localServerEnabled &&
            discoveredRepos.slice(0, 5).map((r) => (
              <button
                key={r.path}
                type="button"
                className="preset-card"
                onClick={() => {
                  hidePopover();
                  onSelectLocalPath(r.path);
                }}
              >
                <div className="preset-card-head">
                  <strong>{r.name}</strong>
                  <span
                    className={`status-dot ${r.changedFilesCount > 0 ? 'dot-amber' : 'dot-green'}`}
                    aria-hidden="true"
                  />
                </div>
                <span>
                  {r.changedFilesCount > 0
                    ? `${r.branch} · ${r.changedFilesCount} at Gate`
                    : `${r.branch} · Clean tree`}
                </span>
              </button>
            ))}

          <button
            type="button"
            id="presets-browser-folder-btn"
            className="preset-card"
            onClick={() => {
              hidePopover();
              onOpenLocalModal();
            }}
          >
            <strong>
              {localServerEnabled ? 'Choose Another Folder…' : 'Choose Repository Folder…'}
            </strong>
            <span>
              {localServerEnabled
                ? 'Browse directories or select any Git folder'
                : 'Inspect any Git folder on your device · private in browser'}
            </span>
          </button>
        </div>
      </div>

      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>GitHub Showcases</h3>
          <span className="section-caption">Stream any public repository directly in WebGL</span>
        </div>
        <div className="preset-grid">
          {showcaseRepos.map((repo) => (
            <button
              key={repo.slug}
              type="button"
              className="preset-card"
              onClick={() => {
                hidePopover();
                onSelectRepo(repo.slug);
              }}
            >
              <strong>{repo.title}</strong>
              <span>{repo.subtitle}</span>
            </button>
          ))}
        </div>
      </div>

      <details className="apple-disclosure token-details">
        <summary>
          <SfIcon name="sf-chevron-right" size={13} className="disclosure-chevron" />
          <span>GitHub Personal Access Token (optional, 5,000 req/hr)</span>
        </summary>
        <div className="disclosure-body">
          <input
            id="gh-token-input"
            className="ph-no-capture"
            type="password"
            value={githubToken}
            onChange={(e) => onGithubTokenChange(e.target.value)}
            placeholder="ghp_… (kept in browser memory only)"
            autoComplete="off"
          />
        </div>
      </details>
    </div>
  );
}
