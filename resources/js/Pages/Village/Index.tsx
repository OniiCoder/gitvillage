import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BisectBar } from '@/Components/BisectBar';
import { BottomFilterDock } from '@/Components/BottomFilterDock';
import { CensusPopover } from '@/Components/CensusPopover';
import { DiffViewerDialog, type DiffModalPayload } from '@/Components/DiffViewerDialog';
import { FieldGuideDialog } from '@/Components/FieldGuideDialog';
import { InspectorSheet } from '@/Components/InspectorSheet';
import { extractDroppedRepoSource, LocalRepoDialog } from '@/Components/LocalRepoDialog';
import { PresetsPopover } from '@/Components/PresetsPopover';
import { SfIcon, SfIconSprite } from '@/Components/SfIconSprite';
import { ShareStudioDialog } from '@/Components/ShareStudioDialog';
import { SpatialTopbar } from '@/Components/SpatialTopbar';
import { TimeLapseBar } from '@/Components/TimeLapseBar';
import { XRayPopover } from '@/Components/XRayPopover';
import { describeRepoForAnalytics, trackEvent } from '@/lib/analytics';
import { capturePostcardPng, recordVillageVideoClip } from '@/lib/captureStudio';
import { createDemoRepoGraph } from '@/lib/demoRepo';
import { closeTopLayerDialog } from '@/lib/topLayer';
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
    xRayLens: 'none',
    bisect: {
      active: false,
      orderedShas: [],
      lowIdx: 0,
      highIdx: 0,
      midIdx: 0,
      step: 0,
      maxSteps: 0,
      resolvedCulpritSha: null,
    },
    rebaseAnim: {
      active: false,
      mode: 'merge',
      branchName: '',
      progress: 0,
    },
    timeOfDay: 'day',
    cameraMode: 'orbit',
    muted: false,
    followingSelected: false,
    isLoading: false,
    selection: null,
    timeLapse: {
      active: false,
      paused: false,
      currentIndex: 0,
      totalCommits: [...demo.commitsBySha.values()].length,
      currentCommit: null,
    },
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
  const shareDialogRef = useRef<HTMLDialogElement | null>(null);
  const recordingAbortRef = useRef<AbortController | null>(null);
  const githubTokenRef = useRef('');
  const toastTimerRef = useRef<number | undefined>(undefined);

  const [snapshot, setSnapshot] = useState<VillageEngineSnapshot>(createInitialSnapshot);
  const [repoInput, setRepoInput] = useState<string>(initialRepo ?? initialLocal ?? '');
  const [githubToken, setGithubToken] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [diffSelectedFilename, setDiffSelectedFilename] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<{
    active: boolean;
    progress: number;
    label: string;
  }>({ active: false, progress: 0, label: '' });
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
    trackEvent('local_modal_opened', { local_server_enabled: localServerEnabled });
    const dialog = localDialogRef.current as
      | (HTMLDialogElement & { __refreshPicker?: (p?: string) => void })
      | null;
    dialog?.showModal();
    dialog?.__refreshPicker?.(snapshot.graph.localPath);
  }, [localServerEnabled, snapshot.graph.localPath]);

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

    const initialConflictParam = new URLSearchParams(window.location.search).get('conflict');
    if (initialConflictParam === '1' || initialConflictParam === 'true') {
      engine.loadConflictDemo(false);
    } else if (localServerEnabled && initialLocal) {
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

  const openShareStudio = () => {
    sound.playPop(587.33);
    shareDialogRef.current?.showModal();
  };

  const handleSnapPostcard = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const filename = await capturePostcardPng(engine.getCanvasElement(), snapshot.graph);
      sound.playPop(680);
      trackEvent('postcard_captured', describeRepoForAnalytics(snapshot.graph));
      showToast(`Saved ${filename}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Postcard capture failed', true);
    }
  };

  const runVideoCapture = async (mode: 'turntable' | 'timelapse') => {
    const engine = engineRef.current;
    if (!engine || recordingState.active) return;

    recordingAbortRef.current?.abort();
    const controller = new AbortController();
    recordingAbortRef.current = controller;

    const durationMs = mode === 'turntable' ? 6000 : engine.getTimeLapseDurationMs();
    const label =
      mode === 'turntable'
        ? 'Recording 6s 3D Turntable…'
        : 'Recording Time-Lapse Growth…';

    setRecordingState({ active: true, progress: 0, label });

    if (mode === 'turntable') {
      engine.startTurntableOrbit(6.0);
    } else {
      engine.startTimeLapse();
    }

    try {
      const result = await recordVillageVideoClip(engine.getCanvasElement(), snapshot.graph, {
        durationMs,
        labelSuffix: mode,
        signal: controller.signal,
        onProgress: (progress) => {
          setRecordingState((prev) => (prev.active ? { ...prev, progress } : prev));
        },
      });
      sound.playRepoLoaded();
      trackEvent('video_clip_recorded', {
        mode,
        format: result.ext,
        ...describeRepoForAnalytics(snapshot.graph),
      });
      showToast(`Saved ${result.filename}`);
      await closeTopLayerDialog(shareDialogRef.current);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        showToast(err instanceof Error ? err.message : 'Video capture failed', true);
      }
    } finally {
      engine.stopTurntableOrbit();
      setRecordingState({ active: false, progress: 0, label: '' });
    }
  };

  const handleCancelRecording = () => {
    recordingAbortRef.current?.abort();
    engineRef.current?.stopTurntableOrbit();
    engineRef.current?.stopTimeLapse();
    setRecordingState({ active: false, progress: 0, label: '' });
    showToast('Recording cancelled');
  };

  const handleToggleCiStorm = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = snapshot.timeOfDay === 'storm' ? 'day' : 'storm';
    engine.applyAtmosphere(next);
    sound.playPop(next === 'storm' ? 415.3 : 587.33);
    trackEvent('atmosphere_changed', { time_of_day: next });
    showToast(
      next === 'storm'
        ? '⛈️ Previewing CI Failing storm clouds over HEAD'
        : '☀️ Cleared storm clouds — sunny village sky restored',
    );
  };

  const openDiffModal = useCallback(
    (filename?: string) => {
      sound.playPop(587.33);
      const sel = snapshot.selection;
      if (sel) {
        trackEvent('full_diff_modal_opened', {
          ...describeRepoForAnalytics(snapshot.graph),
          mode:
            sel.kind === 'visitor'
              ? 'gate_visitor'
              : filename === '__all__'
                ? 'all_files'
                : 'single_file',
          files_count: sel.kind === 'commit' ? (sel.commit.files?.length ?? 0) : 1,
        });
      }
      setDiffSelectedFilename(filename ?? null);
      diffDialogRef.current?.showModal();
    },
    [snapshot.graph, snapshot.selection],
  );

  const diffModalPayload: DiffModalPayload | null = (() => {
    const sel = snapshot.selection;
    if (!sel || sel.kind === 'stash' || sel.kind === 'landmark') return null;
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
    const isConflicted = v.status === 'conflicted';
    return {
      title: v.filename.split('/').pop() || v.filename,
      subtitle: isConflicted
        ? `${v.filename} · Merge Conflict (${v.conflict?.oursLabel ?? 'HEAD'} ⚡ ${v.conflict?.theirsLabel ?? 'incoming'})`
        : `${v.filename} · ${v.staged ? 'Staged at Gate' : 'Working-tree change'}`,
      badge: isConflicted
        ? `${v.conflict?.oursLabel ?? snapshot.graph.defaultBranch} ⚡ ${v.conflict?.theirsLabel ?? 'incoming'}`
        : snapshot.graph.defaultBranch,
      canResolveConflict: Boolean(snapshot.graph.mergeConflict?.active),
      files: [
        {
          filename: v.filename,
          status:
            v.status === 'conflicted'
              ? 'conflicted'
              : v.status === 'added' || v.status === 'untracked'
                ? 'added'
                : v.status === 'deleted'
                  ? 'removed'
                  : v.status === 'renamed'
                    ? 'renamed'
                    : 'modified',
          additions: v.additions,
          deletions: v.deletions,
          patch: v.diffPreview,
          conflict: v.conflict,
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
        onToggleCiStorm={handleToggleCiStorm}
        onFocusConflict={() => engineRef.current?.flyToConflictZone(true)}
        onToggleMute={() => engineRef.current?.toggleMute()}
        onShare={openShareStudio}
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
        onLoadConflictDemo={() => engineRef.current?.loadConflictDemo(true)}
      />

      <CensusPopover
        graph={snapshot.graph}
        clanMap={snapshot.clanMap}
        onSelectCommit={(sha) => engineRef.current?.focusVillagerBySha(sha)}
        onSelectVisitor={(idx) => engineRef.current?.focusVisitorByIndex(idx)}
      />

      <XRayPopover
        graph={snapshot.graph}
        xRayLens={snapshot.xRayLens}
        bisectActive={snapshot.bisect.active}
        rebaseAnim={snapshot.rebaseAnim}
        onToggleLens={(lens) => engineRef.current?.setXRayLens(lens)}
        onStartBisect={() => engineRef.current?.startBisect()}
        onStopBisect={() => engineRef.current?.stopBisect()}
        onTriggerRebaseMode={(mode) => engineRef.current?.triggerRebaseVsMergeDemo(mode)}
        onSelectStash={(idx) => engineRef.current?.focusStashByIndex(idx)}
        onSelectCommit={(sha) => engineRef.current?.focusVillagerBySha(sha)}
      />

      <BisectBar
        bisect={snapshot.bisect}
        graph={snapshot.graph}
        onMarkGood={() => engineRef.current?.stepBisectVerdict('good')}
        onMarkBad={() => engineRef.current?.stepBisectVerdict('bad')}
        onStop={() => engineRef.current?.stopBisect()}
      />

      <TimeLapseBar
        timeLapse={snapshot.timeLapse}
        onTogglePause={() => engineRef.current?.togglePauseTimeLapse()}
        onRestart={() => engineRef.current?.startTimeLapse()}
        onStop={() => engineRef.current?.stopTimeLapse()}
      />

      <BottomFilterDock
        activeFilter={snapshot.activeFilter}
        isLocal={Boolean(snapshot.graph.isLocal)}
        hasConflict={Boolean(snapshot.graph.mergeConflict?.active)}
        gateVisitorsCount={snapshot.gateVisitorsCount}
        timeLapseActive={snapshot.timeLapse.active}
        onSelectFilter={(f) => engineRef.current?.setFilter(f)}
        onFlyToGate={() =>
          snapshot.graph.mergeConflict?.active
            ? engineRef.current?.flyToConflictZone(true)
            : engineRef.current?.flyToGate(true)
        }
        onStartTimeLapse={() => {
          if (snapshot.timeLapse.active) {
            engineRef.current?.stopTimeLapse();
          } else {
            engineRef.current?.startTimeLapse();
          }
        }}
        onRandomVillager={() => engineRef.current?.focusRandomVillager()}
        onResetOverview={() => engineRef.current?.flyToOverview()}
      />

      {!directorMode && (
        <footer className="creator-badge">
          <a
            href="https://oniicode.com"
            target="_blank"
            rel="noopener noreferrer"
            className="creator-link"
            onClick={() => trackEvent('creator_link_clicked', { location: 'hud_footer' })}
          >
            <span className="creator-muted">Created by</span>
            <strong className="creator-handle">@oniicode</strong>
            <SfIcon name="sf-arrow-up-right" size={11} />
          </a>
        </footer>
      )}

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
        onJumpCherryPickTwin={() => engineRef.current?.jumpToCherryPickTwin()}
      />

      <DiffViewerDialog
        dialogRef={diffDialogRef}
        payload={diffModalPayload}
        selectedFilename={diffSelectedFilename}
        onSelectFilename={setDiffSelectedFilename}
        onResolveConflict={() => engineRef.current?.resolveSimulatedConflict()}
      />

      <LocalRepoDialog
        dialogRef={localDialogRef}
        localServerEnabled={localServerEnabled}
        nativeFinderSupported={nativeFinderSupported}
        onSelectLocalServerPath={(p) => void engineRef.current?.loadLocalRepo(p, true)}
        onSelectBrowserSource={(src) => void engineRef.current?.loadBrowserRepoSource(src)}
        onToast={showToast}
      />

      <ShareStudioDialog
        dialogRef={shareDialogRef}
        graph={snapshot.graph}
        isRecording={recordingState.active}
        recordingProgress={recordingState.progress}
        recordingLabel={recordingState.label}
        onSnapPostcard={() => void handleSnapPostcard()}
        onRecordTurntable={() => void runVideoCapture('turntable')}
        onRecordTimeLapse={() => void runVideoCapture('timelapse')}
        onCancelRecording={handleCancelRecording}
        onToast={showToast}
      />

      <FieldGuideDialog />
    </>
  );
}
