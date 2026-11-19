import { useEffect, useRef, useState } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { sound } from '@/lib/sound';
import type { RepoVillageGraph } from '@/types/village';

interface BranchSwitcherProps {
  graph: RepoVillageGraph;
  localServerEnabled: boolean;
  isLoading: boolean;
  onSelectBranch: (branchName: string, options?: { checkoutGitHead?: boolean }) => void;
}

export function BranchSwitcher({
  graph,
  localServerEnabled,
  isLoading,
  onSelectBranch,
}: BranchSwitcherProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const [filterText, setFilterText] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;

    const onToggle = (e: Event) => {
      const open = (e as ToggleEvent).newState === 'open';
      setIsOpen(open);
      if (open) {
        sound.playPop(540);
        setFilterText('');
      }
    };
    pop.addEventListener('toggle', onToggle);
    return () => pop.removeEventListener('toggle', onToggle);
  }, []);

  const activeBranch = graph.currentBranch || graph.defaultBranch || 'main';
  const branchColorMap = new Map(graph.branches.map((b) => [b.name, b.color]));
  const branchCommitCountMap = new Map(graph.branches.map((b) => [b.name, b.commits.length]));
  const activeColor = branchColorMap.get(activeBranch) ?? '#34d399';

  const rawList =
    graph.allBranches && graph.allBranches.length > 0
      ? graph.allBranches
      : graph.branches.map((b) => b.name);

  const uniqueBranches = Array.from(new Set([activeBranch, ...rawList]));
  const needle = filterText.trim().toLowerCase();
  const filteredBranches = needle
    ? uniqueBranches.filter((name) => name.toLowerCase().includes(needle))
    : uniqueBranches;

  const canCheckoutOnDisk =
    !graph.isAcademy &&
    Boolean(graph.isLocal && localServerEnabled && graph.localPath) &&
    Boolean(graph.headBranch && graph.headBranch !== 'detached-HEAD');

  const closePopover = () => {
    popoverRef.current?.hidePopover?.();
  };

  return (
    <>
      <button
        type="button"
        id="branch-switcher-btn"
        className="branch-pill-btn"
        aria-expanded={isOpen}
        title={`Current branch: ${activeBranch} — click to switch branch`}
        disabled={isLoading}
        {...({
          commandfor: 'branch-popover',
          command: 'toggle-popover',
        } as Record<string, string>)}
      >
        <span
          className="branch-color-dot"
          style={{ background: activeColor }}
          aria-hidden="true"
        />
        <SfIcon name="sf-branch" size={13} className="branch-pill-icon" />
        <span id="active-branch-label" className="branch-pill-name">
          {activeBranch}
        </span>
        <SfIcon name="sf-chevron-down" size={11} className="branch-pill-caret" />
      </button>

      <div
        ref={popoverRef}
        id="branch-popover"
        className="apple-sheet branch-popover"
        aria-label="Switch branch"
        {...({ popover: 'auto' } as Record<string, string>)}
      >
        <div className="branch-popover-head">
          <div>
            <h3>Branches ({uniqueBranches.length})</h3>
            <span className="section-caption">
              {graph.isAcademy
                ? 'Switch between 3D sandbox branch islands'
                : graph.isDemo
                  ? 'Fly between floating branch islands'
                  : canCheckoutOnDisk
                    ? `HEAD on disk: ${graph.headBranch}`
                    : `Default branch: ${graph.defaultBranch}`}
            </span>
          </div>
        </div>

        {uniqueBranches.length > 3 && (
          <div className="branch-search-wrap">
            <SfIcon name="sf-search" size={13} className="search-lead-icon" />
            <input
              ref={filterInputRef}
              id="branch-filter-input"
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter branches…"
              aria-label="Filter branches"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div id="branch-options-list" className="branch-options-list">
          {filteredBranches.length === 0 ? (
            <p className="branch-empty-msg">No branches matching “{filterText}”.</p>
          ) : (
            filteredBranches.map((branchName) => {
              const isCurrent = branchName === activeBranch;
              const isDefault = branchName === graph.defaultBranch;
              const isGitHead = Boolean(graph.isLocal && graph.headBranch === branchName);
              const dotColor = branchColorMap.get(branchName);
              const loadedCount = branchCommitCountMap.get(branchName);

              return (
                <div
                  key={branchName}
                  className={`branch-option-row${isCurrent ? ' is-current' : ''}`}
                >
                  <button
                    type="button"
                    className="branch-option-btn"
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => {
                      closePopover();
                      onSelectBranch(branchName);
                    }}
                  >
                    <span className="branch-check-slot" aria-hidden="true">
                      {isCurrent && <SfIcon name="sf-check" size={13} />}
                    </span>
                    <span
                      className="branch-color-dot"
                      style={{ background: dotColor ?? 'rgba(148, 163, 184, 0.5)' }}
                      aria-hidden="true"
                    />
                    <span className="branch-option-name" title={branchName}>
                      {branchName}
                    </span>
                    <span className="branch-option-badges">
                      {isGitHead && <span className="branch-tag branch-tag-head">HEAD</span>}
                      {!isGitHead && isDefault && (
                        <span className="branch-tag">default</span>
                      )}
                      {loadedCount !== undefined && (
                        <span className="branch-commit-count">{loadedCount}c</span>
                      )}
                    </span>
                  </button>

                  {canCheckoutOnDisk && !isGitHead && (
                    <button
                      type="button"
                      className="branch-checkout-btn"
                      title={`Run git checkout ${branchName} on local repository`}
                      onClick={() => {
                        closePopover();
                        onSelectBranch(branchName, { checkoutGitHead: true });
                      }}
                    >
                      Checkout
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
