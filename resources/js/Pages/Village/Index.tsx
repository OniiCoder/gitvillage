import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BottomFilterDock } from '@/Components/BottomFilterDock';
import { CensusPopover } from '@/Components/CensusPopover';
import { DiffViewerDialog, type DiffModalPayload } from '@/Components/DiffViewerDialog';
import { FieldGuideDialog } from '@/Components/FieldGuideDialog';
import { InspectorSheet } from '@/Components/InspectorSheet';
import { extractDroppedRepoSource, LocalRepoDialog } from '@/Components/LocalRepoDialog';
import { PresetsPopover } from '@/Components/PresetsPopover';
import { SfIconSprite } from '@/Components/SfIconSprite';
import { SpatialTopbar } from '@/Components/SpatialTopbar';
import { createDemoRepoGraph } from '@/lib/demoRepo';
import { sound } from '@/lib/sound';
import { VillageEngine, type VillageEngineSnapshot } from '@/lib/villageEngine';
import { buildContributorClanMap } from '@/lib/villagerMesh';
import type { VillagePageProps } from '@/types/village';

function createInitialSnapshot(): VillageEngineSnapshot {
  const demo = createDemoRepoGraph();
  const clanMap = buildContributorClanMap(demo.commitsBySha.values());
  return {
    graph: demo,
    clans: [...clanMap.values()],
    clanMap,
    villagerCount: [...demo.commitsBySha.values()].length,
    gateVisitorsCount: 0,
    activeFilter: 'all',
    activeAuthorKey: null,
    timeOfDay: 'day',
    cameraMode: 'orbit',
    muted: false,
    followingSelected: false,
    isLoading: false,
    selection: null,
  };
}

export default function VillageIndex({
  initialRepo,
  initialLocal,
  initialBranch,
  directorMode,
  localServerEnabled,
  nativeFinderSupported,
  showcaseRepos,
}: VillagePageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hoverPillRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<VillageEngine | null>(null);
  const localDialogRef = useRef<HTMLDialogElement | null>(null);
  const diffDialogRef = useRef<HTMLDialogElement | null>(null);
  const githubTokenRef = useRef('');
  const toastTimerRef = useRef<number | undefined>(undefined);

  const [snapshot, setSnapshot] = useState<VillageEngineSnapshot>(createInitialSnapshot);
  const [repoInput, setRepoInput] = useState<string>(initialRepo ?? initialLocal ?? '');
  const [githubToken, setGithubToken] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [diffSelectedFilename, setDiffSelectedFilename] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean; visible: boolean }>({
    msg: '',
    isError: false,
    visible: false,
  });

  githubTokenRef.current = githubToken;

  const showToast = useCallback((msg: string, isError = false, durationMs = 4200) => {
    window.clearTimeout(toastTimerRef.current);
    setStatusMessage(msg);
    setToast({ msg, isError, visible: true });
    if (durationMs > 0) {
      toastTimerRef.current = window.setTimeout(() => {
        setToast((prev) => ({ ...prev, visible: false }));
      }, durationMs);
    }
  }, []);

  const openLocalModal = useCallback(() => {
    sound.playPop(523.25);
    const dialog = localDialogRef.current as
      | (HTMLDialogElement & { __refreshPicker?: (p?: string) => void })
      | null;
    dialog?.showModal();
    dialog?.__refreshPicker?.(snapshot.graph.localPath);
  }, [snapshot.graph.localPath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const hoverPill = hoverPillRef.current;
    if (!canvas || !overlay || !hoverPill) return;

    const engine = new VillageEngine(canvas, overlay, hoverPill, {
      localServerEnabled,
      directorMode,
      getGithubToken: () => githubTokenRef.current,
      onStateChange: (next) => {
        setSnapshot(next);
        if (next.graph.isDemo) {
          setRepoInput('');
        } else if (next.graph.isLocal) {
          setRepoInput(next.graph.localPath ?? next.graph.repo);
        } else {
          setRepoInput(`${next.graph.owner}/${next.graph.repo}`);
        }
      },
      onToast: showToast,
      onSyncUrl: ({ repo, local, branch }) => {
        const url = new URL(window.location.href);
        if (repo) {
          url.pathname = `/gh/${repo}`;
          url.searchParams.delete('repo');
          url.searchParams.delete('local');
        } else {
          url.pathname = '/';
          url.searchParams.delete('repo');
          if (local) {
            url.searchParams.set('local', local);
          } else {
            url.searchParams.delete('local');
          }
        }
        if (branch) {
          url.searchParams.set('branch', branch);
        } else {
          url.searchParams.delete('branch');
        }
        window.history.replaceState({}, '', url);
      },
      onRequestLocalModal: openLocalModal,
    });

    engineRef.current = engine;

    if (localServerEnabled && initialLocal) {
      void engine.loadLocalRepo(initialLocal, false, initialBranch ?? undefined);
    } else if (initialRepo) {
      void engine.loadRepoBySpec(initialRepo, false, initialBranch ?? undefined);
    } else if (initialBranch) {
      void engine.switchBranch(initialBranch);
    }

    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    const onWindowDrop = async (e: DragEvent) => {
      if (e.defaultPrevented) return;
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        const source = await extractDroppedRepoSource(e.dataTransfer);
        if (source) {
          void engine.loadBrowserRepoSource(source);
        }
      }
    };
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);

    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
      engine.dispose();
      engineRef.current = null;
    };
    // Run once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitRepo = (e: FormEvent) => {
    e.preventDefault();
    const val = repoInput.trim();
    if (!val) {
      document.getElementById('presets-popover')?.showPopover?.();
      return;
    }
    void engineRef.current?.loadRepoBySpec(val, true);
  };

  const handleShare = async () => {
    const shareUrl = new URL(window.location.origin);
    const g = snapshot.graph;
    if (!g.isDemo && !g.isLocal && g.owner && g.repo) {
      shareUrl.pathname = `/gh/${g.owner}/${g.repo}`;
    }
    if (!g.isLocal && g.currentBranch && g.currentBranch !== g.defaultBranch) {
      shareUrl.searchParams.set('branch', g.currentBranch);
    }

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      sound.playPop(660);
      showToast(
        g.isLocal
          ? 'Shareable village link copied (loads showcase for friends)'
          : 'Shareable village link copied to clipboard',
      );
    } catch {
      showToast('Copy failed — clipboard access unavailable', true);
    }
  };

  const openDiffModal = useCallback((filename?: string) => {
    sound.playPop(587.33);
    setDiffSelectedFilename(filename ?? null);
    diffDialogRef.current?.showModal();
  }, []);

  const diffModalPayload: DiffModalPayload | null = (() => {
    const sel = snapshot.selection;
    if (!sel) return null;
    if (sel.kind === 'commit') {
      const c = sel.commit;
      return {
        title: c.subject,
        subtitle: `${c.authorName} · ${c.shortSha}`,
        badge: c.branch,
        files: c.files ?? [],
        isHydrating: sel.isHydratingDiff,
      };
    }
    const v = sel.visitor;
    return {
      title: v.filename.split('/').pop() || v.filename,
      subtitle: `${v.filename} · ${v.staged ? 'Staged at Gate' : 'Working-tree change'}`,
      badge: snapshot.graph.defaultBranch,
      files: [
        {
          filename: v.filename,
          status:
            v.status === 'added' || v.status === 'untracked'
              ? 'added'
              : v.status === 'deleted'
                ? 'removed'
                : v.status === 'renamed'
                  ? 'renamed'
                  : 'modified',
          additions: v.additions,
          deletions: v.deletions,
          patch: v.diffPreview,
        },
      ],
    };
  })();

  const pageTitle = snapshot.graph.isDemo
    ? 'Sky Village'
    : snapshot.graph.isLocal
      ? `${snapshot.graph.repo} (Local)`
      : `${snapshot.graph.owner}/${snapshot.graph.repo}`;

  return (
    <>
      <Head title={pageTitle} />
      <SfIconSprite />

      <div id="canvas-wrap" aria-label="3D Git Commit Village">
        <canvas ref={canvasRef} id="village-canvas" />
        <div ref={overlayRef} id="overlay-layer" aria-hidden="true" />
        <div ref={hoverPillRef} id="hover-pill" className="hover-pill" hidden />
        <div id="walk-hint" className="walk-hint" hidden={snapshot.cameraMode !== 'walk'}>
          <span>
            <kbd>WASD</kbd> Walk
          </span>
          <span className="hint-dot" aria-hidden="true" />
          <span>
            <kbd>Space</kbd> Jump
          </span>
          <span className="hint-dot" aria-hidden="true" />
          <span>
            <kbd>E</kbd> Inspect
          </span>
          <span className="hint-dot" aria-hidden="true" />
          <span>Drag to Orbit</span>
        </div>
      </div>

      <SpatialTopbar
        graph={snapshot.graph}
        villagerCount={snapshot.villagerCount}
        gateVisitorsCount={snapshot.gateVisitorsCount}
        clans={snapshot.clans}
        activeAuthorKey={snapshot.activeAuthorKey}
        repoInput={repoInput}
        onRepoInputChange={setRepoInput}
        onSubmitRepo={handleSubmitRepo}
        isLoading={snapshot.isLoading}
        localServerEnabled={localServerEnabled}
        cameraMode={snapshot.cameraMode}
        timeOfDay={snapshot.timeOfDay}
        muted={snapshot.muted}
        onOpenLocalModal={openLocalModal}
        onSelectBranch={(branch, opts) => void engineRef.current?.switchBranch(branch, opts)}
        onToggleAuthor={(key) => engineRef.current?.toggleAuthorSpotlight(key)}
        onToggleWalkMode={() => engineRef.current?.toggleWalkMode()}
        onCycleSky={() => engineRef.current?.cycleAtmosphere()}
        onToggleMute={() => engineRef.current?.toggleMute()}
        onShare={handleShare}
      />

      <p id="toolbar-status" className="sr-only" role="status">
        {statusMessage}
      </p>

      <div
        id="toast-banner"
        className={`toast-banner${toast.isError ? ' is-error' : ''}`}
        aria-hidden="true"
        hidden={!toast.visible}
      >
        {toast.msg}
      </div>

      <PresetsPopover
        localServerEnabled={localServerEnabled}
        showcaseRepos={showcaseRepos}
        githubToken={githubToken}
        onGithubTokenChange={setGithubToken}
        onSelectRepo={(slug) => void engineRef.current?.loadRepoBySpec(slug, true)}
        onSelectLocalPath={(p) => void engineRef.current?.loadLocalRepo(p, true)}
        onOpenLocalModal={openLocalModal}
      />

      <CensusPopover
        graph={snapshot.graph}
        clanMap={snapshot.clanMap}
        onSelectCommit={(sha) => engineRef.current?.focusVillagerBySha(sha)}
        onSelectVisitor={(idx) => engineRef.current?.focusVisitorByIndex(idx)}
      />

      <BottomFilterDock
        activeFilter={snapshot.activeFilter}
        isLocal={Boolean(snapshot.graph.isLocal)}
        gateVisitorsCount={snapshot.gateVisitorsCount}
        onSelectFilter={(f) => engineRef.current?.setFilter(f)}
        onFlyToGate={() => engineRef.current?.flyToGate(true)}
        onRandomVillager={() => engineRef.current?.focusRandomVillager()}
        onResetOverview={() => engineRef.current?.flyToOverview()}
      />

      <InspectorSheet
        selection={snapshot.selection}
        graph={snapshot.graph}
        clanMap={snapshot.clanMap}
        followingSelected={snapshot.followingSelected}
        onClose={() => engineRef.current?.closeInspector()}
        onStepCommit={(dir) => engineRef.current?.stepRelativeCommit(dir)}
        onStepVisitor={(delta) => engineRef.current?.stepVisitor(delta)}
        onToggleFollow={() => engineRef.current?.toggleFollowSelected()}
        onCelebrate={() => engineRef.current?.celebrateSelected()}
        onLetVisitorsIn={() => engineRef.current?.triggerGatePreviewOpen()}
        onSyncLocal={() => void engineRef.current?.pollLocalRepoNow(true)}
        onOpenDiffModal={openDiffModal}
      />

      <DiffViewerDialog
        dialogRef={diffDialogRef}
        payload={diffModalPayload}
        selectedFilename={diffSelectedFilename}
        onSelectFilename={setDiffSelectedFilename}
      />

      <LocalRepoDialog
        dialogRef={localDialogRef}
        localServerEnabled={localServerEnabled}
        nativeFinderSupported={nativeFinderSupported}
        onSelectLocalServerPath={(p) => void engineRef.current?.loadLocalRepo(p, true)}
        onSelectBrowserSource={(src) => void engineRef.current?.loadBrowserRepoSource(src)}
        onToast={showToast}
      />

      <FieldGuideDialog />
    </>
  );
}
