import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describeRepoForAnalytics, trackEvent } from '@/lib/analytics';
import { computeCommitArchetype } from '@/lib/archetypes';
import {
  type BrowserRepoSource,
  loadBrowserGitRepoVillage,
} from '@/lib/browserGitReader';
import { createConflictDemoRepoGraph, createDemoRepoGraph } from '@/lib/demoRepo';
import {
  ACADEMY_CHAPTERS,
  type AcademyFocusHint,
  type AcademyProgressSnapshot,
  type AcademySandboxState,
  compileAcademyGraph,
  executeFreeformGitCommand,
} from '@/lib/gitAcademy';
import {
  fetchRepoCiWeather,
  hydrateCommitDetail,
  loadGitHubRepoVillage,
  parseRepoInput,
} from '@/lib/githubLoader';
import {
  checkoutLocalBranch,
  hydrateLocalCommitDetail,
  isLocalPathInput,
  loadLocalRepoVillage,
} from '@/lib/localLoader';
import { sound } from '@/lib/sound';
import {
  type ContributorClanProfile,
  buildContributorClanMap,
  createExplorerAvatar,
  createGateVisitorEntity,
  createVillagerEntity,
  getCommitCargoMetrics,
  getRoleMeta,
  getVisitorStatusMeta,
  normalizeAuthorKey,
  refreshVillagerCargo,
} from '@/lib/villagerMesh';
import {
  type BuiltHeatmapTower,
  type BuiltHeatmapWorld,
  buildHeatmapSkylineWorld,
  fetchGitHubHeatmapData,
  normalizeHeatmapTheme,
} from '@/lib/heatmapBuilder';
import { type BuiltWorld, buildVillageWorld } from '@/lib/worldBuilder';
import type {
  BisectState,
  BridgeLayout,
  CameraMode,
  CommitData,
  GateVisitorEntity,
  GitHubHeatmapData,
  HeatmapDayCell,
  HeatmapTheme,
  HotspotLandmarkData,
  InspectorSelection,
  IslandLayout,
  RebaseAnimState,
  RepoVillageGraph,
  StashEntryData,
  TimeLapseState,
  TimeOfDay,
  VillagerEntity,
  XRayLens,
} from '@/types/village';

export interface VillageEngineSnapshot {
  graph: RepoVillageGraph;
  heatmap: GitHubHeatmapData | null;
  heatmapTheme: HeatmapTheme;
  academy: AcademyProgressSnapshot;
  clans: ContributorClanProfile[];
  clanMap: Map<string, ContributorClanProfile>;
  villagerCount: number;
  gateVisitorsCount: number;
  activeFilter: string;
  activeAuthorKey: string | null;
  xRayLens: XRayLens;
  bisect: BisectState;
  rebaseAnim: RebaseAnimState;
  timeOfDay: TimeOfDay;
  cameraMode: CameraMode;
  muted: boolean;
  followingSelected: boolean;
  isLoading: boolean;
  selection: InspectorSelection;
  timeLapse: TimeLapseState;
}

export interface VillageEngineCallbacks {
  localServerEnabled: boolean;
  directorMode?: boolean;
  getGithubToken: () => string;
  onStateChange: (snapshot: VillageEngineSnapshot) => void;
  onToast: (message: string, isError?: boolean, durationMs?: number) => void;
  onSyncUrl: (params: {
    repo?: string | null;
    local?: string | null;
    branch?: string | null;
    heatmapUser?: string | null;
    heatmapYear?: number | null;
    heatmapTheme?: HeatmapTheme | null;
    learn?: boolean;
    chapter?: number | null;
  }) => void;
  onRequestLocalModal: () => void;
}

function computeLocalGraphFingerprint(graph: RepoVillageGraph): string {
  const headSha = graph.branches[0]?.commits.at(-1)?.sha ?? '';
  const conflictFlag = graph.mergeConflict?.active ? 'conflict' : 'clean';
  const visitorsKey = (graph.gateVisitors ?? [])
    .map((v) => `${v.filename}:${v.status}:${v.staged ? 1 : 0}:${v.additions}:${v.deletions}`)
    .join('|');
  return `${headSha}::${conflictFlag}::${visitorsKey}`;
}

export class VillageEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hemiLight: THREE.HemisphereLight;
  private dirLight: THREE.DirectionalLight;
  private skyUniforms: {
    uTopColor: { value: THREE.Color };
    uMidColor: { value: THREE.Color };
    uBottomColor: { value: THREE.Color };
  };
  private explorer = createExplorerAvatar();
  private explorerVelocity = { y: 0, grounded: true };
  private keysPressed = new Set<string>();

  private activeGraph: RepoVillageGraph = createDemoRepoGraph();
  private activeBrowserSource: BrowserRepoSource | null = null;
  private lastLocalFingerprint = '';
  private builtWorld: BuiltWorld | null = null;
  private islandByBranch = new Map<string, IslandLayout>();
  private bridgeFreeAt = new Map<BridgeLayout, number>();
  private villagers: VillagerEntity[] = [];
  private villagerBySha = new Map<string, VillagerEntity>();
  private gateVisitors: GateVisitorEntity[] = [];
  private gatePreviewOpenTimer = 0;
  private emoteElements = new Map<string, HTMLDivElement>();

  private hoveredVillager: VillagerEntity | null = null;
  private hoveredGateVisitor: GateVisitorEntity | null = null;
  private selectedVillager: VillagerEntity | null = null;
  private selectedGateVisitor: GateVisitorEntity | null = null;
  private selectedStash: StashEntryData | null = null;
  private selectedLandmark: HotspotLandmarkData | null = null;
  private selectedHeatmapDay: HeatmapDayCell | null = null;
  private openedStashIndices = new Set<number>();

  private activeHeatmap: GitHubHeatmapData | null = null;
  private heatmapTheme: HeatmapTheme = 'emerald';
  private builtHeatmapWorld: BuiltHeatmapWorld | null = null;
  private heatmapWave = {
    active: false,
    elapsed: 0,
    duration: 1.75,
  };

  private academyActive = false;
  private academyChapter = 1;
  private academyStepIndex = 0;
  private academyCompleted = new Set<number>();
  private academySandbox: AcademySandboxState | null = null;
  private preAcademyGraph: RepoVillageGraph | null = null;

  private followVillager = false;
  private activeFilter = 'all';
  private activeAuthorKey: string | null = null;
  private xRayLens: XRayLens = 'none';
  private bisectState: BisectState = {
    active: false,
    orderedShas: [],
    lowIdx: 0,
    highIdx: 0,
    midIdx: 0,
    step: 0,
    maxSteps: 0,
    resolvedCulpritSha: null,
  };
  private rebaseState: RebaseAnimState = {
    active: false,
    mode: 'merge',
    branchName: '',
    progress: 0,
  };
  private preRebaseGraph: RepoVillageGraph | null = null;
  private clanMap = new Map<string, ContributorClanProfile>();
  private timeOfDay: TimeOfDay = 'day';
  private cameraMode: CameraMode = 'orbit';
  private isLoading = false;
  private isHydratingDiff = false;
  private currentLoadController: AbortController | null = null;
  private isPollingLocal = false;

  private cameraFlight = {
    targetPos: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    active: false,
  };

  private turntableOrbit = {
    active: false,
    elapsed: 0,
    duration: 6.0,
    radius: 28,
    height: 15,
    lookAt: new THREE.Vector3(0, 1.2, 0),
  };

  private timeLapse = {
    active: false,
    paused: false,
    queue: [] as VillagerEntity[],
    currentIndex: 0,
    stepTimer: 0,
    stepInterval: 0.25,
    revealedBranches: new Set<string>(),
  };

  private lightningTimer = 4.2;
  private lightningFlash = 0;
  private conflictRepairProgress = 0;

  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private clock = new THREE.Clock();
  private projVec = new THREE.Vector3();
  private forwardVec = new THREE.Vector3();
  private rightVec = new THREE.Vector3();

  private rafId = 0;
  private pollIntervalId = 0;
  private disposed = false;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private overlayLayer: HTMLDivElement,
    private hoverPill: HTMLDivElement,
    private cb: VillageEngineCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color('#1d4ed8') },
      uMidColor: { value: new THREE.Color('#38bdf8') },
      uBottomColor: { value: new THREE.Color('#e0f2fe') },
    };

    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(240, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform vec3 uTopColor;
          uniform vec3 uMidColor;
          uniform vec3 uBottomColor;
          varying vec3 vWorldPos;
          void main() {
            float h = normalize(vWorldPos).y;
            vec3 col = mix(uBottomColor, uMidColor, smoothstep(-0.25, 0.18, h));
            col = mix(col, uTopColor, smoothstep(0.18, 0.78, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    this.scene.add(skyDome);
    this.scene.fog = new THREE.FogExp2('#bae6fd', 0.0055);

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.3,
      400,
    );
    this.camera.position.set(-8, 17, 28);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.maxDistance = 105;
    this.controls.minDistance = 4;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.addEventListener('start', () => {
      this.cameraFlight.active = false;
    });

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.15);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
    this.dirLight.position.set(24, 38, 22);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 130;
    const dCam = 48;
    this.dirLight.shadow.camera.left = -dCam;
    this.dirLight.shadow.camera.right = dCam;
    this.dirLight.shadow.camera.top = dCam;
    this.dirLight.shadow.camera.bottom = -dCam;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    this.scene.add(this.explorer.root);

    this.bindEvents();
    sound.initAmbientMusic();
    this.rebuildVillageFromGraph(this.activeGraph);

    if (cb.directorMode) {
      this.exposeDirectorHooks();
    }

    this.pollIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && this.activeGraph.isLocal) {
        void this.pollLocalRepoNow(false);
      }
    }, 3500);

    this.animate();
  }

  public dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.rafId);
    window.clearInterval(this.pollIntervalId);
    this.currentLoadController?.abort();
    sound.stopAmbientMusic();
    for (const fn of this.cleanupFns) fn();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private emit(): void {
    if (this.disposed) return;
    let selection: InspectorSelection = null;
    if (this.selectedVillager) {
      const c = this.selectedVillager.commit;
      const parentSha = c.parents.find((p) => this.villagerBySha.has(p));
      const childSha = c.children.find((ch) => this.villagerBySha.has(ch));
      selection = {
        kind: 'commit',
        commit: c,
        hasParent: Boolean(parentSha),
        hasChild: Boolean(childSha),
        isHydratingDiff: this.isHydratingDiff,
      };
    } else if (this.selectedGateVisitor) {
      selection = {
        kind: 'visitor',
        visitor: this.selectedGateVisitor.file,
        index: this.selectedGateVisitor.index,
        totalVisitors: this.gateVisitors.length,
      };
    } else if (this.selectedStash) {
      selection = {
        kind: 'stash',
        stash: this.selectedStash,
        totalStashes: this.activeGraph.stashes?.length ?? 1,
      };
    } else if (this.selectedLandmark) {
      selection = {
        kind: 'landmark',
        landmark: this.selectedLandmark,
      };
    } else if (this.selectedHeatmapDay && this.activeHeatmap) {
      selection = {
        kind: 'heatmap_day',
        day: this.selectedHeatmapDay,
        heatmap: this.activeHeatmap,
      };
    }

    const activeSpec =
      ACADEMY_CHAPTERS.find((ch) => ch.number === this.academyChapter) ?? ACADEMY_CHAPTERS[0];
    const chapterDone = this.academyStepIndex >= activeSpec.steps.length;

    this.cb.onStateChange({
      graph: this.activeGraph,
      heatmap: this.activeHeatmap,
      heatmapTheme: this.heatmapTheme,
      academy: {
        active: this.academyActive,
        chapterNumber: this.academyChapter,
        stepIndex: this.academyStepIndex,
        completedChapters: [...this.academyCompleted].toSorted((a, b) => a - b),
        chapterDone,
        initialized: this.academySandbox?.initialized ?? true,
        currentBranch: this.academySandbox?.currentBranch ?? 'main',
        terminal: this.academySandbox?.terminal ?? [],
      },
      clans: [...this.clanMap.values()],
      clanMap: this.clanMap,
      villagerCount: this.villagers.filter((v) => !v.commit.isGhost).length,
      gateVisitorsCount: this.gateVisitors.length,
      activeFilter: this.activeFilter,
      activeAuthorKey: this.activeAuthorKey,
      xRayLens: this.xRayLens,
      bisect: { ...this.bisectState },
      rebaseAnim: { ...this.rebaseState },
      timeOfDay: this.timeOfDay,
      cameraMode: this.cameraMode,
      muted: sound.muted,
      followingSelected: this.followVillager,
      isLoading: this.isLoading,
      selection,
      timeLapse: {
        active: this.timeLapse.active,
        paused: this.timeLapse.paused,
        currentIndex: this.timeLapse.currentIndex,
        totalCommits: this.timeLapse.active ? this.timeLapse.queue.length : this.villagers.length,
        currentCommit:
          this.timeLapse.active && this.timeLapse.currentIndex > 0
            ? (this.timeLapse.queue[this.timeLapse.currentIndex - 1]?.commit ?? null)
            : null,
      },
    });
  }

  public applyAtmosphere(mode: TimeOfDay): void {
    this.timeOfDay = mode;
    if (mode === 'day') {
      this.skyUniforms.uTopColor.value.set('#1d4ed8');
      this.skyUniforms.uMidColor.value.set('#38bdf8');
      this.skyUniforms.uBottomColor.value.set('#e0f2fe');
      (this.scene.fog as THREE.FogExp2).color.set('#bae6fd');
      this.hemiLight.color.set('#e0f2fe');
      this.hemiLight.groundColor.set('#334155');
      this.hemiLight.intensity = 1.15;
      this.dirLight.color.set('#fffbeb');
      this.dirLight.intensity = 1.85;
      this.dirLight.position.set(24, 38, 22);
    } else if (mode === 'sunset') {
      this.skyUniforms.uTopColor.value.set('#311042');
      this.skyUniforms.uMidColor.value.set('#db2777');
      this.skyUniforms.uBottomColor.value.set('#fdba74');
      (this.scene.fog as THREE.FogExp2).color.set('#f472b6');
      this.hemiLight.color.set('#fed7aa');
      this.hemiLight.groundColor.set('#3b0764');
      this.hemiLight.intensity = 0.95;
      this.dirLight.color.set('#fb923c');
      this.dirLight.intensity = 1.65;
      this.dirLight.position.set(-34, 15, 24);
    } else if (mode === 'storm') {
      this.skyUniforms.uTopColor.value.set('#090d16');
      this.skyUniforms.uMidColor.value.set('#1e293b');
      this.skyUniforms.uBottomColor.value.set('#334155');
      (this.scene.fog as THREE.FogExp2).color.set('#1e293b');
      this.hemiLight.color.set('#64748b');
      this.hemiLight.groundColor.set('#0f172a');
      this.hemiLight.intensity = 0.78;
      this.dirLight.color.set('#cbd5e1');
      this.dirLight.intensity = 0.85;
      this.dirLight.position.set(18, 32, 16);
    } else {
      this.skyUniforms.uTopColor.value.set('#020617');
      this.skyUniforms.uMidColor.value.set('#0f172a');
      this.skyUniforms.uBottomColor.value.set('#1e1b4b');
      (this.scene.fog as THREE.FogExp2).color.set('#0f172a');
      this.hemiLight.color.set('#6366f1');
      this.hemiLight.groundColor.set('#090d16');
      this.hemiLight.intensity = 0.68;
      this.dirLight.color.set('#93c5fd');
      this.dirLight.intensity = 0.72;
      this.dirLight.position.set(16, 30, -20);
    }

    if (this.builtWorld) {
      const lampBoost =
        mode === 'night' ? 2.2 : mode === 'storm' ? 1.85 : mode === 'sunset' ? 1.4 : 0.45;
      for (const mat of this.builtWorld.animatedProps.lanternGlows) {
        mat.emissiveIntensity = lampBoost;
      }
      for (const mat of this.builtWorld.animatedProps.windowGlows) {
        mat.emissiveIntensity = mode === 'day' ? 0.25 : 1.6;
      }
      if (this.builtWorld.animatedProps.fireflies) {
        const pMat = this.builtWorld.animatedProps.fireflies.material as THREE.PointsMaterial;
        pMat.opacity =
          mode === 'night' ? 0.95 : mode === 'sunset' ? 0.7 : mode === 'storm' ? 0.1 : 0.35;
      }
      if (this.builtWorld.animatedProps.stormGroup) {
        this.builtWorld.animatedProps.stormGroup.visible = mode === 'storm';
      }
    }
    sound.setMood(mode);
    this.emit();
  }

  public cycleAtmosphere(): void {
    const order: TimeOfDay[] = ['day', 'sunset', 'night', 'storm'];
    const next = order[(order.indexOf(this.timeOfDay) + 1) % order.length];
    this.applyAtmosphere(next);
    sound.playPop(523.25);
    trackEvent('atmosphere_changed', { time_of_day: next });
  }

  public toggleMute(): void {
    sound.toggleMute();
    trackEvent('audio_mute_toggled', { muted: sound.muted });
    this.emit();
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    const isWalk = mode === 'walk';
    this.explorer.root.visible = isWalk;

    if (isWalk && this.builtWorld) {
      this.followVillager = false;
      const spawnBase = this.selectedGateVisitor
        ? this.selectedGateVisitor.root.position.clone().add(new THREE.Vector3(-1.2, 0, 0))
        : this.selectedVillager
          ? this.selectedVillager.root.position.clone().add(new THREE.Vector3(0.9, 0, 0.9))
          : this.builtWorld.islands[0].pathCurve.getPointAt(0.5);
      const surfaceY = this.sampleWalkableSurfaceY(spawnBase.x, spawnBase.z, spawnBase.y);
      this.explorer.root.position.set(spawnBase.x, surfaceY ?? spawnBase.y, spawnBase.z);
      this.explorerVelocity.y = 0;
      this.explorerVelocity.grounded = true;
      this.camera.position.set(
        this.explorer.root.position.x,
        this.explorer.root.position.y + 4.8,
        this.explorer.root.position.z + 8.5,
      );
      this.controls.target.copy(this.explorer.root.position).add(new THREE.Vector3(0, 1.0, 0));
      sound.playPop(620);
    } else {
      sound.playPop(440);
    }
    this.emit();
  }

  public toggleWalkMode(): void {
    const nextMode = this.cameraMode === 'orbit' ? 'walk' : 'orbit';
    this.setCameraMode(nextMode);
    trackEvent('camera_mode_changed', {
      mode: nextMode,
      ...describeRepoForAnalytics(this.activeGraph),
    });
  }

  public setFilter(filter: string): void {
    this.activeFilter = filter;
    this.applyVillagerFilterBeams();
    trackEvent('filter_changed', { filter });
    this.emit();
  }

  public toggleAuthorSpotlight(authorKey: string): void {
    const clan = this.clanMap.get(authorKey);
    this.activeAuthorKey = this.activeAuthorKey === authorKey ? null : authorKey;
    sound.playPop(this.activeAuthorKey ? 587.33 : 440);
    this.applyVillagerFilterBeams();
    trackEvent('author_spotlight_toggled', {
      active: this.activeAuthorKey !== null,
      ...describeRepoForAnalytics(this.activeGraph),
    });
    if (this.activeAuthorKey && clan) {
      this.cb.onToast(
        `${clan.emblem} ${clan.authorName} — ${clan.earLabel} · ${clan.commitCount} commit${clan.commitCount === 1 ? '' : 's'} highlighted`,
      );
    }
    this.emit();
  }

  private applyVillagerFilterBeams(): void {
    const hasRoleFilter = this.activeFilter !== 'all';
    const hasAuthorFilter = this.activeAuthorKey !== null;
    const isBusLens = this.xRayLens === 'bus_factor';
    const isBisect = this.bisectState.active;

    for (const v of this.villagers) {
      const beamMat = v.filterBeam.material as THREE.MeshBasicMaterial;

      if (isBisect && !v.commit.isGhost) {
        const idx = this.bisectState.orderedShas.indexOf(v.commit.sha);
        const { lowIdx, highIdx, midIdx, resolvedCulpritSha } = this.bisectState;

        if (resolvedCulpritSha) {
          const isCulprit = v.commit.sha === resolvedCulpritSha;
          v.filterBeam.visible = isCulprit;
          beamMat.color.setHex(0xff453a);
          beamMat.opacity = isCulprit ? 0.65 : 0;
          v.root.scale.setScalar(isCulprit ? 1.22 : 0.78);
        } else if (idx === midIdx) {
          v.filterBeam.visible = true;
          beamMat.color.setHex(0xfacc15);
          beamMat.opacity = 0.62;
          v.root.scale.setScalar(1.18);
        } else if (idx === lowIdx) {
          v.filterBeam.visible = true;
          beamMat.color.setHex(0x30d158);
          beamMat.opacity = 0.42;
          v.root.scale.setScalar(1.0);
        } else if (idx === highIdx) {
          v.filterBeam.visible = true;
          beamMat.color.setHex(0xff453a);
          beamMat.opacity = 0.42;
          v.root.scale.setScalar(1.0);
        } else {
          v.filterBeam.visible = false;
          beamMat.opacity = 0;
          const inWindow = idx > lowIdx && idx < highIdx;
          v.root.scale.setScalar(inWindow ? 0.96 : 0.72);
        }
        continue;
      }

      v.root.scale.setScalar(v.spawnScale);

      if (isBusLens && !v.commit.isGhost) {
        const isSoloSilo = Boolean(v.island.branch.soloOwnerName);
        v.filterBeam.visible = true;
        beamMat.color.setHex(isSoloSilo ? 0xff453a : 0x30d158);
        beamMat.opacity = isSoloSilo ? 0.48 : 0.24;
        continue;
      }

      beamMat.color.setHex(v.commit.isGhost ? 0xa78bfa : v.clanColor);
      const roleMatch = !hasRoleFilter || v.commit.kind === this.activeFilter;
      const authorMatch = !hasAuthorFilter || v.authorKey === this.activeAuthorKey;
      const showBeam =
        (this.xRayLens === 'ghosts' && Boolean(v.commit.isGhost)) ||
        ((hasRoleFilter || hasAuthorFilter) && roleMatch && authorMatch);
      v.filterBeam.visible = showBeam;
      beamMat.opacity = showBeam ? 0.34 : 0;
      v.bodyGroup.visible = true;
    }
  }

  public closeInspector(): void {
    this.selectedVillager = null;
    this.selectedGateVisitor = null;
    this.selectedStash = null;
    this.selectedLandmark = null;
    this.selectedHeatmapDay = null;
    this.followVillager = false;
    this.emit();
  }

  public setXRayLens(lens: XRayLens): void {
    const next = this.xRayLens === lens ? 'none' : lens;
    this.xRayLens = next;
    sound.playPop(next === 'none' ? 440 : 587.33);
    trackEvent('xray_lens_toggled', {
      lens: next,
      repo_slug: `${this.activeGraph.owner}/${this.activeGraph.repo}`,
    });
    this.applyVillagerFilterBeams();

    if (next === 'bus_factor') {
      const bf = this.activeGraph.repoBusFactor ?? 1;
      const soloBranches = this.activeGraph.branches.filter((b) => b.soloOwnerName);
      this.flyToOverview();
      this.cb.onToast(
        `🛡️ Bus Factor X-Ray: Repo Bus Factor = ${bf} · ${soloBranches.length} solo-owned branch silo${soloBranches.length === 1 ? '' : 's'} highlighted in red`,
        false,
        5200,
      );
    } else if (next === 'hotspots') {
      this.focusLandmarkByIndex(0);
    } else if (next === 'ghosts') {
      this.flyToGhostRuins();
    } else {
      this.emit();
    }
  }

  public flyToGhostRuins(): void {
    if (!this.builtWorld?.ghostIsland) {
      this.cb.onToast('No orphaned reflog ghost commits in this repository.');
      this.emit();
      return;
    }
    this.followVillager = false;
    const c = this.builtWorld.ghostIsland.center;
    this.cameraFlight = {
      targetLook: new THREE.Vector3(c.x + 0.8, c.y + 1.1, c.z),
      targetPos: new THREE.Vector3(c.x - 4.2, c.y + 4.5, c.z + 10.4),
      active: true,
    };
    const firstGhost = this.villagers.find((v) => v.commit.isGhost);
    if (firstGhost) {
      this.selectedVillager = firstGhost;
      this.selectedGateVisitor = null;
      this.selectedStash = null;
      this.selectedLandmark = null;
      this.triggerEmote(`c:${firstGhost.commit.sha}`, firstGhost, '👻', 2.8);
    }
    this.cb.onToast(
      `👻 Sunken Reflog Ruins — ${this.activeGraph.ghostCommits?.length ?? 0} orphaned commits still living in .git/objects!`,
    );
    this.emit();
  }

  public focusStashByIndex(idx: number): void {
    const chest = this.builtWorld?.stashChests[idx];
    if (!chest) return;
    this.selectedVillager = null;
    this.selectedGateVisitor = null;
    this.selectedLandmark = null;
    this.selectedStash = chest.stash;
    this.followVillager = false;
    this.openedStashIndices.add(idx);
    chest.glowMesh.visible = true;
    sound.playSelectVillager('merge');

    const p = chest.worldPos;
    this.cameraFlight = {
      targetLook: new THREE.Vector3(p.x, p.y + 0.85, p.z),
      targetPos: new THREE.Vector3(p.x + 2.6, p.y + 3.4, p.z + 6.4),
      active: true,
    };
    this.cb.onToast(`📦 Opened ${chest.stash.selector}: "${chest.stash.message}"`);
    this.emit();
  }

  public focusLandmarkByIndex(idx: number): void {
    const lm = this.builtWorld?.landmarks[idx];
    if (!lm) return;
    this.selectedVillager = null;
    this.selectedGateVisitor = null;
    this.selectedStash = null;
    this.selectedLandmark = lm.data;
    this.followVillager = false;
    sound.playPop(540);

    const p = lm.worldPos;
    const zSign = p.z >= 0 ? 1 : -1;
    this.cameraFlight = {
      targetLook: new THREE.Vector3(p.x, p.y + 1.25, p.z),
      targetPos: new THREE.Vector3(p.x + 2.8, p.y + 4.1, p.z + zSign * 7.4),
      active: true,
    };
    this.cb.onToast(
      lm.data.kind === 'hotspot'
        ? `🔥 Code Hotspot Forge: ${lm.data.filename} (${lm.data.touches} commits, ${lm.data.fixCount} fixes)`
        : `🗿 Ancient Stable Monument: ${lm.data.filename} (untouched foundation)`,
    );
    this.emit();
  }

  public jumpToCherryPickTwin(): void {
    const twinSha = this.selectedVillager?.commit.cherryPickTwinSha;
    if (!twinSha) return;
    const twin = this.villagerBySha.get(twinSha);
    if (!twin) return;
    this.focusOnVillager(twin, true);
    this.triggerEmote(`c:${twin.commit.sha}`, twin, '🌀', 2.6);
    this.cb.onToast(`🌀 Warped across Sky Portal to cherry-pick twin (${twin.commit.branch})`);
  }

  // ---------- Interactive 3D `git bisect` Murder-Mystery Hunt ----------
  public startBisect(): void {
    const liveVillagers = this.villagers
      .filter((v) => !v.commit.isGhost)
      .toSorted((a, b) => (Date.parse(a.commit.timestamp) || 0) - (Date.parse(b.commit.timestamp) || 0));

    if (liveVillagers.length < 3) {
      this.cb.onToast('Need at least 3 commits to run interactive git bisect.', true);
      return;
    }

    this.stopTimeLapse(false);
    this.xRayLens = 'none';
    const orderedShas = liveVillagers.map((v) => v.commit.sha);
    const lowIdx = 0;
    const highIdx = orderedShas.length - 1;
    const midIdx = Math.floor((lowIdx + highIdx) / 2);
    const maxSteps = Math.max(1, Math.ceil(Math.log2(orderedShas.length)));

    this.bisectState = {
      active: true,
      orderedShas,
      lowIdx,
      highIdx,
      midIdx,
      step: 1,
      maxSteps,
      resolvedCulpritSha: null,
    };

    trackEvent('bisect_started', {
      commit_count: orderedShas.length,
      repo_slug: `${this.activeGraph.owner}/${this.activeGraph.repo}`,
    });

    this.applyVillagerFilterBeams();
    const suspect = this.villagerBySha.get(orderedShas[midIdx]);
    if (suspect) {
      this.focusOnVillager(suspect, true);
      this.triggerEmote(`c:${suspect.commit.sha}`, suspect, '🔍', 3.0);
    }
    this.cb.onToast(
      `🕵️ git bisect started! Testing midpoint commit (${midIdx + 1}/${orderedShas.length}) — ~${maxSteps} steps to catch the bug!`,
      false,
      5200,
    );
    this.emit();
  }

  public stepBisectVerdict(verdict: 'good' | 'bad'): void {
    if (!this.bisectState.active || this.bisectState.resolvedCulpritSha) return;
    let { lowIdx, highIdx, midIdx, step } = this.bisectState;
    const { orderedShas, maxSteps } = this.bisectState;

    if (verdict === 'good') {
      lowIdx = midIdx;
    } else {
      highIdx = midIdx;
    }

    if (highIdx - lowIdx <= 1) {
      const culpritSha = orderedShas[highIdx];
      this.bisectState = {
        active: true,
        orderedShas,
        lowIdx,
        highIdx,
        midIdx: highIdx,
        step,
        maxSteps,
        resolvedCulpritSha: culpritSha,
      };
      this.applyVillagerFilterBeams();
      const culprit = this.villagerBySha.get(culpritSha);
      if (culprit) {
        this.focusOnVillager(culprit, false);
        culprit.behavior = 'spin';
        culprit.behaviorTimer = 2.6;
        culprit.jumpVelocity = 8.0;
        this.triggerEmote(`c:${culprit.commit.sha}`, culprit, '🚨', 4.0);
      }
      sound.playRepoLoaded();
      trackEvent('bisect_resolved', {
        steps_taken: step,
        repo_slug: `${this.activeGraph.owner}/${this.activeGraph.repo}`,
      });
      this.cb.onToast(
        `🚨 Culprit caught in ${step} step${step === 1 ? '' : 's'}! ${culprit?.commit.shortSha} is the first bad commit!`,
        false,
        5800,
      );
      this.emit();
      return;
    }

    midIdx = Math.floor((lowIdx + highIdx) / 2);
    step += 1;
    this.bisectState = {
      active: true,
      orderedShas,
      lowIdx,
      highIdx,
      midIdx,
      step,
      maxSteps,
      resolvedCulpritSha: null,
    };
    this.applyVillagerFilterBeams();
    const nextSuspect = this.villagerBySha.get(orderedShas[midIdx]);
    if (nextSuspect) {
      this.focusOnVillager(nextSuspect, true);
      this.triggerEmote(`c:${nextSuspect.commit.sha}`, nextSuspect, '🔍', 2.8);
    }
    this.emit();
  }

  public stopBisect(): void {
    if (!this.bisectState.active) return;
    this.bisectState = {
      active: false,
      orderedShas: [],
      lowIdx: 0,
      highIdx: 0,
      midIdx: 0,
      step: 0,
      maxSteps: 0,
      resolvedCulpritSha: null,
    };
    this.applyVillagerFilterBeams();
    sound.playPop(440);
    this.emit();
  }

  // ---------- Interactive 3D Rebase vs. Merge Animator ----------
  public triggerRebaseVsMergeDemo(targetMode: 'rebase' | 'merge'): void {
    if (targetMode === 'merge' && this.preRebaseGraph) {
      const restored = this.preRebaseGraph;
      this.preRebaseGraph = null;
      this.rebaseState = {
        active: false,
        mode: 'merge',
        branchName: '',
        progress: 0,
      };
      this.rebuildVillageFromGraph(restored);
      sound.playPop(523.25);
      trackEvent('rebase_vs_merge_toggled', {
        mode: 'merge',
        branch: restored.defaultBranch,
      });
      this.cb.onToast('🌉 Restored Merge topology — original branch SHAs & fork/merge bridges preserved!');
      return;
    }

    if (targetMode === 'rebase') {
      const baseGraph = this.preRebaseGraph ?? this.activeGraph;
      const mainBr = baseGraph.branches.find((b) => b.isDefault) ?? baseGraph.branches[0];
      const candidateSide =
        baseGraph.branches.find((b) => !b.isDefault && !b.mergeIntoSha && b.commits.length > 0) ??
        baseGraph.branches.find((b) => !b.isDefault && b.commits.length > 0);

      if (!mainBr || !candidateSide) {
        this.cb.onToast('Need at least one feature branch to animate git rebase vs merge.', true);
        return;
      }

      if (!this.preRebaseGraph) {
        this.preRebaseGraph = baseGraph;
      }

      // Clone commits onto tip of main with brand-new SHAs while turning originals into Reflog Ghosts!
      const headTip = mainBr.commits.at(-1);
      let prevSha = headTip?.sha ?? '';
      const rebasedClones: CommitData[] = [];
      const newGhosts: CommitData[] = [...(baseGraph.ghostCommits ?? [])];

      candidateSide.commits.forEach((orig, idx) => {
        const newSha = `reb${idx + 1}f9${orig.sha.slice(6)}`;
        rebasedClones.push({
          ...orig,
          sha: newSha,
          shortSha: newSha.slice(0, 7),
          branch: mainBr.name,
          parents: prevSha ? [prevSha] : [],
          children: [],
          timestamp: new Date(Date.now() + idx * 1000).toISOString(),
          body: `${orig.body}\n\n[Rebased onto ${mainBr.name} — new SHA ${newSha.slice(0, 7)}, original ${orig.shortSha} became a reflog ghost]`.trim(),
          isRebasedClone: true,
          rebasedFromSha: orig.sha,
        });
        prevSha = newSha;

        if (!newGhosts.some((g) => g.sha === orig.sha)) {
          newGhosts.unshift({
            ...orig,
            branch: 'ghost-ruins',
            isGhost: true,
            reflogAction: `rebased ${candidateSide.name}`,
            body: `Original pre-rebase commit (${orig.shortSha}) left behind in reflog when ${candidateSide.name} was replayed onto ${mainBr.name}!`,
          });
        }
      });

      const nextCommitsBySha = new Map<string, CommitData>();
      const nextBranches = baseGraph.branches
        .filter((b) => b.name !== candidateSide.name)
        .map((b) => {
          if (b.name !== mainBr.name) {
            b.commits.forEach((c) => nextCommitsBySha.set(c.sha, { ...c, children: [...c.children] }));
            return b;
          }
          const combined = [...b.commits.map((c) => ({ ...c, children: [...c.children] })), ...rebasedClones];
          combined.forEach((c) => nextCommitsBySha.set(c.sha, c));
          return {
            ...b,
            commits: combined,
          };
        });

      for (const c of nextCommitsBySha.values()) {
        for (const p of c.parents) {
          const par = nextCommitsBySha.get(p);
          if (par && !par.children.includes(c.sha)) par.children.push(c.sha);
        }
      }

      const rebasedGraph: RepoVillageGraph = {
        ...baseGraph,
        branches: nextBranches,
        commitsBySha: nextCommitsBySha,
        ghostCommits: newGhosts.slice(0, 7),
      };

      this.rebaseState = {
        active: true,
        mode: 'rebase',
        branchName: candidateSide.name,
        progress: 1,
      };
      this.rebuildVillageFromGraph(rebasedGraph);

      // Animate newly rebased clones popping in at HEAD with ✨ emotes!
      for (const rc of rebasedClones) {
        const ent = this.villagerBySha.get(rc.sha);
        if (ent) {
          ent.spawnScale = 0.08;
          ent.root.scale.setScalar(0.08);
          ent.jumpVelocity = 8.5;
          this.triggerEmote(`c:${rc.sha}`, ent, '🧬', 3.6);
        }
      }

      sound.playRepoLoaded();
      trackEvent('rebase_vs_merge_toggled', {
        mode: 'rebase',
        branch: candidateSide.name,
      });
      this.cb.onToast(
        `🧬 Rebased "${candidateSide.name}" onto ${mainBr.name}! ${rebasedClones.length} commits cloned with new SHAs — originals moved to Reflog Ghost Ruins 👻`,
        false,
        6200,
      );
      this.emit();
    }
  }

  public toggleFollowSelected(): void {
    if (!this.selectedVillager) return;
    this.followVillager = !this.followVillager;
    sound.playPop(this.followVillager ? 587.33 : 440);
    this.emit();
  }

  public celebrateSelected(): void {
    if (!this.selectedVillager) return;
    this.selectedVillager.behavior = 'spin';
    this.selectedVillager.behaviorTimer = 2.0;
    this.selectedVillager.jumpVelocity = 7.4;
    this.triggerEmote(`c:${this.selectedVillager.commit.sha}`, this.selectedVillager, '🎉', 2.4);
    sound.playSelectVillager('merge');
  }

  public stepRelativeCommit(direction: 'parent' | 'child'): void {
    if (!this.selectedVillager) return;
    const c = this.selectedVillager.commit;
    const targetSha =
      direction === 'parent'
        ? c.parents.find((p) => this.villagerBySha.has(p))
        : c.children.find((ch) => this.villagerBySha.has(ch));
    if (!targetSha) return;
    const entity = this.villagerBySha.get(targetSha);
    if (entity) this.focusOnVillager(entity);
  }

  public stepVisitor(delta: -1 | 1): void {
    if (!this.selectedGateVisitor) return;
    const next = this.gateVisitors[this.selectedGateVisitor.index + delta];
    if (next) this.focusOnGateVisitor(next);
  }

  public focusVillagerBySha(sha: string): void {
    const v = this.villagerBySha.get(sha);
    if (v) this.focusOnVillager(v);
  }

  public focusVisitorByIndex(idx: number): void {
    const gv = this.gateVisitors[idx];
    if (gv) this.focusOnGateVisitor(gv);
  }

  public focusRandomVillager(): void {
    if (this.villagers.length === 0) return;
    const pick = this.villagers[Math.floor(Math.random() * this.villagers.length)];
    this.focusOnVillager(pick);
  }

  public flyToOverview(): void {
    this.followVillager = false;
    if (this.builtHeatmapWorld) {
      const dist = Math.max(24, this.builtHeatmapWorld.islandLength * 0.72);
      this.cameraFlight = {
        targetLook: new THREE.Vector3(0, 1.35, 0),
        targetPos: new THREE.Vector3(-dist * 0.22, dist * 0.54, dist * 0.86),
        active: true,
      };
      this.emit();
      return;
    }
    if (!this.builtWorld) return;
    const mainLen = this.builtWorld.islands[0]?.length ?? 28;
    const extraGate = this.builtWorld.gate ? this.builtWorld.gate.dockLength * 0.5 : 0;
    const dist = Math.max(24, (mainLen + extraGate) * 0.72);
    this.cameraFlight = {
      targetLook: new THREE.Vector3(extraGate * 0.35, 1.2, 0),
      targetPos: new THREE.Vector3(-dist * 0.24, dist * 0.56, dist * 0.86),
      active: true,
    };
    this.emit();
  }

  public async loadUserHeatmap(
    username: string,
    options: {
      year?: number | null;
      theme?: string | null;
      updateUrl?: boolean;
    } = {},
  ): Promise<void> {
    const cleanUser = username.trim().replace(/^@/, '');
    if (!cleanUser) return;

    this.academyActive = false;
    this.academySandbox = null;
    this.currentLoadController?.abort();
    const controller = new AbortController();
    this.currentLoadController = controller;

    if (options.theme) {
      this.heatmapTheme = normalizeHeatmapTheme(options.theme);
    }

    this.isLoading = true;
    this.emit();

    try {
      const data = await fetchGitHubHeatmapData(cleanUser, options.year ?? null, controller.signal);
      if (controller.signal.aborted) return;

      this.stopTimeLapse(false);
      this.turntableOrbit.active = false;
      this.bisectState.active = false;
      this.bisectState.resolvedCulpritSha = null;
      this.xRayLens = 'none';
      this.selectedVillager = null;
      this.selectedGateVisitor = null;
      this.selectedStash = null;
      this.selectedLandmark = null;
      this.selectedHeatmapDay = null;
      this.followVillager = false;
      this.hoverPill.hidden = true;

      if (this.builtWorld) {
        this.scene.remove(this.builtWorld.worldGroup);
        this.builtWorld = null;
      }
      if (this.builtHeatmapWorld) {
        this.scene.remove(this.builtHeatmapWorld.worldGroup);
        this.builtHeatmapWorld = null;
      }
      this.villagers = [];
      this.villagerBySha.clear();
      this.islandByBranch.clear();
      this.bridgeFreeAt.clear();
      this.gateVisitors = [];
      this.overlayLayer.replaceChildren();
      this.emoteElements.clear();

      this.activeHeatmap = data;
      this.builtHeatmapWorld = buildHeatmapSkylineWorld(data, this.heatmapTheme);
      this.scene.add(this.builtHeatmapWorld.worldGroup);
      this.heatmapWave = {
        active: true,
        elapsed: 0,
        duration: 1.85,
      };

      if (this.cameraMode !== 'orbit') {
        this.setCameraMode('orbit');
      }
      this.flyToOverview();
      sound.playPop(659.25);

      trackEvent('heatmap_loaded', {
        theme: this.heatmapTheme,
        year: data.year ? String(data.year) : 'rolling',
        total_contributions: data.totalContributions,
        longest_streak: data.longestStreak,
      });

      if (options.updateUrl !== false) {
        this.cb.onSyncUrl({
          repo: null,
          local: null,
          branch: null,
          heatmapUser: data.username,
          heatmapYear: data.year,
          heatmapTheme: this.heatmapTheme !== 'emerald' ? this.heatmapTheme : null,
        });
      }

      this.cb.onToast(
        `🟩 @${data.username} — ${data.totalContributions.toLocaleString()} contributions (${data.longestStreak}d longest streak)`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : `Could not load heatmap for @${cleanUser}.`;
      this.cb.onToast(msg, true, 5200);
    } finally {
      this.isLoading = false;
      this.emit();
    }
  }

  public setHeatmapTheme(theme: HeatmapTheme): void {
    this.heatmapTheme = theme;
    if (!this.activeHeatmap) {
      this.emit();
      return;
    }
    if (this.builtHeatmapWorld) {
      this.scene.remove(this.builtHeatmapWorld.worldGroup);
    }
    this.builtHeatmapWorld = buildHeatmapSkylineWorld(this.activeHeatmap, theme);
    this.scene.add(this.builtHeatmapWorld.worldGroup);
    this.heatmapWave = {
      active: true,
      elapsed: 0,
      duration: 1.15,
    };
    sound.playPop(620);
    trackEvent('heatmap_theme_changed', { theme });
    this.cb.onSyncUrl({
      repo: null,
      local: null,
      branch: null,
      heatmapUser: this.activeHeatmap.username,
      heatmapYear: this.activeHeatmap.year,
      heatmapTheme: theme !== 'emerald' ? theme : null,
    });
    this.emit();
  }

  public replayHeatmapWave(durationSec = 1.95): void {
    if (!this.builtHeatmapWorld) return;
    for (const t of this.builtHeatmapWorld.towers) {
      t.columnMesh.scale.y = 0.05;
      t.capMesh.position.y = 0.06;
    }
    this.heatmapWave = {
      active: true,
      elapsed: 0,
      duration: durationSec,
    };
    sound.playPop(587.33);
  }

  public exitHeatmapMode(): void {
    if (!this.activeHeatmap && !this.builtHeatmapWorld) return;
    if (this.builtHeatmapWorld) {
      this.scene.remove(this.builtHeatmapWorld.worldGroup);
      this.builtHeatmapWorld = null;
    }
    this.activeHeatmap = null;
    this.selectedHeatmapDay = null;
    this.heatmapWave.active = false;
    this.rebuildVillageFromGraph(this.activeGraph);
    this.flyToOverview();
    const g = this.activeGraph;
    this.cb.onSyncUrl({
      repo: !g.isDemo && !g.isLocal ? `${g.owner}/${g.repo}` : null,
      local: g.isLocal ? (g.localPath ?? null) : null,
      branch: g.currentBranch && g.currentBranch !== g.defaultBranch ? g.currentBranch : null,
      heatmapUser: null,
      heatmapYear: null,
      heatmapTheme: null,
    });
    this.emit();
  }

  // ---------- Interactive 3D Git Academy (`/learn`) ----------
  public startAcademy(
    chapterNumber = 1,
    source: 'cta' | 'presets' | 'url' = 'cta',
    updateUrl = true,
  ): void {
    this.currentLoadController?.abort();
    if (!this.academyActive) {
      this.preAcademyGraph = this.activeGraph;
    }

    const spec =
      ACADEMY_CHAPTERS.find((c) => c.number === chapterNumber) ?? ACADEMY_CHAPTERS[0];
    this.academyActive = true;
    this.academyChapter = spec.number;
    this.academyStepIndex = 0;
    this.academySandbox = spec.createInitialState();

    this.applyAcademyStateToWorld(spec.focusOnEnter);
    sound.playPop(587.33);
    trackEvent('academy_entered', {
      chapter: spec.number,
      source,
    });

    if (updateUrl) {
      this.cb.onSyncUrl({
        repo: null,
        local: null,
        branch: null,
        heatmapUser: null,
        heatmapYear: null,
        heatmapTheme: null,
        learn: true,
        chapter: spec.number > 1 ? spec.number : null,
      });
    }
    this.emit();
  }

  public resetAcademyChapter(): void {
    if (!this.academyActive) return;
    const spec =
      ACADEMY_CHAPTERS.find((c) => c.number === this.academyChapter) ?? ACADEMY_CHAPTERS[0];
    this.academyStepIndex = 0;
    this.academySandbox = spec.createInitialState();
    this.applyAcademyStateToWorld(spec.focusOnEnter);
    sound.playPop(493.88);
    this.emit();
  }

  public runAcademyGuidedStep(): void {
    if (!this.academyActive || !this.academySandbox) return;
    const spec =
      ACADEMY_CHAPTERS.find((c) => c.number === this.academyChapter) ?? ACADEMY_CHAPTERS[0];
    const step = spec.steps[this.academyStepIndex];
    if (!step) return;

    const { next, output } = step.run(this.academySandbox);
    this.academySandbox = next;
    const completedIdx = this.academyStepIndex;
    this.academyStepIndex++;

    if (this.academyStepIndex >= spec.steps.length) {
      this.academyCompleted.add(spec.number);
      sound.playRepoLoaded();
      trackEvent('academy_chapter_completed', { chapter: spec.number });
    } else {
      sound.playPop(659.25);
    }

    trackEvent('academy_step_completed', {
      chapter: spec.number,
      step_index: completedIdx,
      via: 'button',
    });

    this.applyAcademyStateToWorld(step.focusAfter);
    if (output) {
      this.cb.onToast(`$ ${step.command} → ${output}`, false, 4400);
    }
    this.emit();
  }

  public submitAcademyCliCommand(rawCmd: string): void {
    if (!this.academyActive || !this.academySandbox) return;
    const clean = rawCmd.trim().replace(/^\$\s*/, '');
    if (!clean) return;

    const spec =
      ACADEMY_CHAPTERS.find((c) => c.number === this.academyChapter) ?? ACADEMY_CHAPTERS[0];
    const currentStep = spec.steps[this.academyStepIndex];

    // If the learner typed the command matching the current guided step, execute that step!
    if (currentStep?.matchesCli?.(clean)) {
      const { next, output } = currentStep.run(this.academySandbox);
      this.academySandbox = next;
      const completedIdx = this.academyStepIndex;
      this.academyStepIndex++;
      if (this.academyStepIndex >= spec.steps.length) {
        this.academyCompleted.add(spec.number);
        sound.playRepoLoaded();
        trackEvent('academy_chapter_completed', { chapter: spec.number });
      } else {
        sound.playPop(659.25);
      }
      trackEvent('academy_step_completed', {
        chapter: spec.number,
        step_index: completedIdx,
        via: 'cli',
      });
      this.applyAcademyStateToWorld(currentStep.focusAfter);
      if (output) {
        this.cb.onToast(output, false, 4200);
      }
      this.emit();
      return;
    }

    // Otherwise execute as free-play sandbox command!
    const res = executeFreeformGitCommand(this.academySandbox, clean);
    this.academySandbox = res.next;
    this.applyAcademyStateToWorld(res.focusHint ?? 'overview');
    sound.playPop(res.isError ? 330 : 587.33);
    if (res.output) {
      this.cb.onToast(res.output, Boolean(res.isError), 4200);
    }
    this.emit();
  }

  public exitAcademy(): void {
    if (!this.academyActive) return;
    this.academyActive = false;
    this.academySandbox = null;
    const restoreGraph = this.preAcademyGraph ?? createDemoRepoGraph();
    this.preAcademyGraph = null;
    this.rebuildVillageFromGraph(restoreGraph);
    this.flyToOverview();
    sound.playPop(523.25);

    this.cb.onSyncUrl({
      repo:
        !restoreGraph.isDemo && !restoreGraph.isLocal
          ? `${restoreGraph.owner}/${restoreGraph.repo}`
          : null,
      local: restoreGraph.isLocal ? (restoreGraph.localPath ?? null) : null,
      branch:
        restoreGraph.currentBranch && restoreGraph.currentBranch !== restoreGraph.defaultBranch
          ? restoreGraph.currentBranch
          : null,
      heatmapUser: null,
      heatmapYear: null,
      heatmapTheme: null,
      learn: false,
      chapter: null,
    });
    this.emit();
  }

  private applyAcademyStateToWorld(focusHint: AcademyFocusHint): void {
    if (!this.academySandbox) return;
    const graph = compileAcademyGraph(this.academySandbox);
    this.rebuildVillageFromGraph(graph);

    // Before `git init` in Chapter 1, hide islands & Gate so only mist clouds float in the void!
    if (!this.academySandbox.initialized && this.builtWorld) {
      const cloudSet = new Set(this.builtWorld.animatedProps.clouds.map((c) => c.mesh));
      const crystalSet = new Set(
        this.builtWorld.animatedProps.floatingCrystals.map((c) => c.mesh),
      );
      for (const ch of this.builtWorld.worldGroup.children) {
        ch.visible = cloudSet.has(ch) || crystalSet.has(ch);
      }
      this.flyToOverview();
      return;
    }

    if (this.academySandbox.bisectRequested) {
      this.academySandbox.bisectRequested = false;
      this.startBisect();
      return;
    }

    if (focusHint === 'gate') {
      this.flyToGate(false);
    } else if (focusHint === 'conflict') {
      this.flyToConflictZone(false);
    } else if (focusHint === 'stash') {
      if (this.builtWorld && this.builtWorld.stashChests.length > 0) {
        this.focusStashByIndex(0);
      } else {
        this.flyToOverview();
      }
    } else if (focusHint === 'ghosts') {
      this.flyToGhostRuins();
    } else if (focusHint === 'bisect') {
      this.startBisect();
    } else if (focusHint === 'head') {
      const curBr = this.academySandbox.currentBranch;
      const headSha = this.academySandbox.branchHeads[curBr];
      const v = headSha ? this.villagerBySha.get(headSha) : undefined;
      if (v) {
        this.focusOnVillager(v, false);
      } else {
        this.flyToOverview();
      }
    } else {
      this.flyToOverview();
    }
  }

  public focusHeatmapTower(tower: BuiltHeatmapTower): void {
    this.selectedVillager = null;
    this.selectedGateVisitor = null;
    this.selectedStash = null;
    this.selectedLandmark = null;
    this.selectedHeatmapDay = tower.day;
    sound.playPop(tower.day.count > 0 ? 640 : 440);
    if (this.cameraMode === 'orbit') {
      const p = tower.worldPos;
      this.cameraFlight = {
        targetLook: new THREE.Vector3(p.x, Math.max(0.8, p.y * 0.65), p.z),
        targetPos: new THREE.Vector3(p.x + 1.8, Math.max(4.6, p.y + 3.6), p.z + 9.2),
        active: true,
      };
    }
    this.emit();
  }

  public getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  public getTimeLapseDurationMs(): number {
    if (this.builtHeatmapWorld) {
      return 6000;
    }
    const liveCount = Math.max(1, this.villagers.filter((v) => !v.commit.isGhost).length);
    const interval = Math.max(0.22, Math.min(0.46, 10.5 / liveCount));
    return Math.round((liveCount * interval + 2.35) * 1000);
  }

  public startTurntableOrbit(durationSec = 6.0): void {
    if (this.builtHeatmapWorld) {
      if (this.cameraMode !== 'orbit') {
        this.setCameraMode('orbit');
      }
      this.followVillager = false;
      this.cameraFlight.active = false;
      const dist = Math.max(24, this.builtHeatmapWorld.islandLength * 0.72);
      this.turntableOrbit = {
        active: true,
        elapsed: 0,
        duration: durationSec,
        radius: dist * 0.88,
        height: dist * 0.52,
        lookAt: new THREE.Vector3(0, 1.35, 0),
      };
      return;
    }
    if (!this.builtWorld) return;
    if (this.cameraMode !== 'orbit') {
      this.setCameraMode('orbit');
    }
    this.followVillager = false;
    this.cameraFlight.active = false;
    const mainLen = this.builtWorld.islands[0]?.length ?? 28;
    const extraGate = this.builtWorld.gate ? this.builtWorld.gate.dockLength * 0.5 : 0;
    const dist = Math.max(24, (mainLen + extraGate) * 0.72);
    this.turntableOrbit = {
      active: true,
      elapsed: 0,
      duration: durationSec,
      radius: dist * 0.9,
      height: dist * 0.54,
      lookAt: new THREE.Vector3(extraGate * 0.3, 1.25, 0),
    };
  }

  public stopTurntableOrbit(): void {
    this.turntableOrbit.active = false;
  }

  public startTimeLapse(): void {
    if (this.builtHeatmapWorld) {
      this.closeInspector();
      this.replayHeatmapWave(4.6);
      this.startTurntableOrbit(6.0);
      return;
    }
    if (!this.builtWorld || this.villagers.length === 0) return;
    if (this.cameraMode !== 'orbit') {
      this.setCameraMode('orbit');
    }
    this.closeInspector();
    this.turntableOrbit.active = false;

    const ordered = this.villagers
      .filter((v) => !v.commit.isGhost)
      .toSorted((a, b) => {
        const ta = Date.parse(a.commit.timestamp) || 0;
        const tb = Date.parse(b.commit.timestamp) || 0;
        if (ta !== tb) return ta - tb;
        if (b.commit.parents.includes(a.commit.sha)) return -1;
        if (a.commit.parents.includes(b.commit.sha)) return 1;
        return 0;
      });

    const stepInterval = Math.max(0.22, Math.min(0.46, 10.5 / Math.max(1, ordered.length)));
    this.timeLapse = {
      active: true,
      paused: false,
      queue: ordered,
      currentIndex: 0,
      stepTimer: 0.08,
      stepInterval,
      revealedBranches: new Set([this.builtWorld.islands[0]?.branch.name ?? 'main']),
    };

    // Hide all live branch villagers and side branch islands/bridges at t = 0
    for (const v of this.villagers) {
      if (v.commit.isGhost) continue;
      v.root.visible = false;
      v.spawnScale = 1;
      v.root.scale.setScalar(1);
      v.parachuteY = 0;
      v.parachuteSpeed = 0;
      v.parachuteFurl = 0;
      v.parachuteGroup.visible = false;
      v.landingRing.visible = false;
      v.activeBridge = undefined;
      v.behavior = 'stroll';
      const el = this.emoteElements.get(`c:${v.commit.sha}`);
      if (el) el.hidden = true;
    }

    this.builtWorld.islands.forEach((isl, idx) => {
      isl.meshGroup.visible = idx === 0;
    });
    for (const br of this.builtWorld.bridges) {
      br.meshGroup.visible = false;
    }

    this.flyToOverview();
    sound.playPop(587.33);
    trackEvent('timelapse_started', {
      ...describeRepoForAnalytics(this.activeGraph),
      commit_count: ordered.length,
    });
    this.emit();
  }

  public togglePauseTimeLapse(): void {
    if (!this.timeLapse.active) return;
    this.timeLapse.paused = !this.timeLapse.paused;
    sound.playPop(this.timeLapse.paused ? 440 : 554.37);
    this.emit();
  }

  public stopTimeLapse(emitUpdate = true): void {
    const wasActive = this.timeLapse.active;
    this.timeLapse.active = false;
    this.timeLapse.paused = false;
    this.timeLapse.queue = [];
    this.timeLapse.currentIndex = 0;

    if (wasActive && this.builtWorld) {
      for (const isl of this.builtWorld.islands) {
        isl.meshGroup.visible = true;
      }
      for (const br of this.builtWorld.bridges) {
        br.meshGroup.visible = true;
      }
      for (const v of this.villagers) {
        v.root.visible = true;
        v.spawnScale = 1;
        v.root.scale.setScalar(1);
        v.parachuteY = 0;
        v.parachuteSpeed = 0;
        v.parachuteFurl = 0;
        v.parachuteGroup.visible = false;
        v.parachuteGroup.position.set(0, 0, 0);
        v.parachuteGroup.scale.setScalar(1);
        v.landingRing.visible = false;
        v.bodyGroup.position.y = 0;
      }
    }
    if (emitUpdate) {
      this.emit();
    }
  }

  private stepTimeLapse(dt: number): void {
    if (!this.timeLapse.active || this.timeLapse.paused || !this.builtWorld) return;

    this.timeLapse.stepTimer -= dt;
    if (this.timeLapse.stepTimer > 0) return;

    const idx = this.timeLapse.currentIndex;
    if (idx >= this.timeLapse.queue.length) {
      // Wait until the final parachuting villager touches down & furls before concluding replay
      if (this.timeLapse.queue.some((qv) => qv.parachuteY > 0.02)) {
        this.timeLapse.stepTimer = 0.12;
        return;
      }
      const landedCount = this.timeLapse.queue.length;
      this.timeLapse.active = false;
      sound.playRepoLoaded();
      this.cb.onToast(
        `🪂 Replay complete — ${landedCount} commits parachuted across ${this.builtWorld.islands.length} islands!`,
      );
      this.emit();
      return;
    }

    const v = this.timeLapse.queue[idx];
    const branchName = v.island.branch.name;

    // Reveal side branch island + its uphill fork bridge as soon as its first commit parachutes in!
    if (!this.timeLapse.revealedBranches.has(branchName)) {
      this.timeLapse.revealedBranches.add(branchName);
      v.island.meshGroup.visible = true;
      for (const br of this.builtWorld.bridges) {
        if (br.kind === 'fork' && br.toBranch === branchName) {
          br.meshGroup.visible = true;
        }
      }
    }

    // If this commit is a merge commit on main, reveal the downhill merge bridge(s) feeding into it!
    if (v.commit.kind === 'merge' || v.commit.parents.length > 1) {
      for (const isl of this.builtWorld.islands) {
        if (isl.branch.mergeIntoSha === v.commit.sha) {
          for (const br of this.builtWorld.bridges) {
            if (br.kind === 'merge' && br.fromBranch === isl.branch.name) {
              br.meshGroup.visible = true;
            }
          }
        }
      }
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    v.root.visible = true;
    v.spawnScale = 1;
    v.root.scale.setScalar(1);
    this.syncVillagerWorldPosition(v);

    if (reducedMotion) {
      v.parachuteY = 0;
      v.parachuteSpeed = 0;
      v.parachuteFurl = 0;
      v.parachuteGroup.visible = false;
      v.behavior = 'stroll';
      v.behaviorTimer = 2.4;
      const arch = computeCommitArchetype(v.commit);
      this.triggerEmote(`c:${v.commit.sha}`, v, arch.emoji, 1.6);
      sound.playCelebrationChime(idx, v.commit.kind);
    } else {
      const startAlt = 8.4 + (idx % 3) * 1.1;
      v.parachuteY = startAlt;
      v.parachuteSpeed = 6.5;
      v.parachuteFurl = 0;
      v.parachuteGroup.visible = true;
      v.parachuteGroup.position.set(0, 0, 0);
      v.parachuteGroup.scale.setScalar(0.2);
      v.landingRing.visible = false;
      v.jumpY = 0;
      v.jumpVelocity = 0;
      v.bodyGroup.position.y = startAlt;
      this.triggerEmote(`c:${v.commit.sha}`, v, '🪂', 1.45);
      sound.playParachuteDeploy(idx);
    }

    this.timeLapse.currentIndex = idx + 1;
    this.timeLapse.stepTimer =
      this.timeLapse.currentIndex >= this.timeLapse.queue.length
        ? 0.45
        : this.timeLapse.stepInterval;
    this.emit();
  }

  public flyToBranchIsland(branchName: string): boolean {
    if (!this.builtWorld) return false;
    const isl = this.builtWorld.islands.find((item) => item.branch.name === branchName);
    if (!isl) return false;

    this.followVillager = false;
    this.activeGraph.currentBranch = branchName;

    if (this.cameraMode === 'walk') {
      const p = isl.pathCurve.getPointAt(0.5);
      this.explorer.root.position.set(p.x, p.y, p.z + 0.5);
      this.explorerVelocity.y = 0;
      this.explorerVelocity.grounded = true;
      this.camera.position.set(p.x, p.y + 4.8, p.z + 8.5);
      this.controls.target.set(p.x, p.y + 1.0, p.z);
    } else if (isl.branch.isDefault) {
      this.flyToOverview();
    } else {
      const dist = Math.max(13, isl.length * 0.72);
      this.cameraFlight = {
        targetLook: new THREE.Vector3(isl.center.x, isl.center.y + 1.0, isl.center.z),
        targetPos: new THREE.Vector3(
          isl.center.x - dist * 0.22,
          isl.center.y + dist * 0.52,
          isl.center.z + dist * 0.86,
        ),
        active: true,
      };
    }

    for (const v of this.villagers) {
      if (v.island === isl && v.jumpY === 0) {
        v.jumpVelocity = 5.4;
        if (Math.random() < 0.6) {
          this.triggerEmote(`c:${v.commit.sha}`, v, '👋', 1.8);
        }
      }
    }

    sound.playPop(587.33);
    this.emit();
    return true;
  }

  public async switchBranch(
    branchName: string,
    options: { checkoutGitHead?: boolean } = {},
  ): Promise<void> {
    const target = branchName.trim();
    if (!target) return;

    trackEvent('branch_switched', {
      ...describeRepoForAnalytics(this.activeGraph),
      branch: this.activeGraph.isLocal ? 'local_branch' : target,
      checkout_git_head: Boolean(options.checkoutGitHead),
    });

    if (this.academyActive || this.activeGraph.isAcademy) {
      if (this.academySandbox && this.academySandbox.branchOrder.includes(target)) {
        this.academySandbox = {
          ...this.academySandbox,
          currentBranch: target,
        };
        this.applyAcademyStateToWorld('overview');
      }
      const flew = this.flyToBranchIsland(target);
      if (flew) {
        const count =
          this.activeGraph.branches.find((b) => b.name === target)?.commits.length ?? 0;
        this.cb.onToast(
          `Sandbox branch "${target}" — ${count} commit${count === 1 ? '' : 's'} on island`,
        );
      }
      return;
    }

    if (this.activeGraph.isDemo) {
      const flew = this.flyToBranchIsland(target);
      if (flew) {
        const count =
          this.activeGraph.branches.find((b) => b.name === target)?.commits.length ?? 0;
        this.cb.onSyncUrl({
          repo: null,
          local: null,
          branch: target === this.activeGraph.defaultBranch ? null : target,
        });
        this.cb.onToast(
          `Branch "${target}" — ${count} commit${count === 1 ? '' : 's'} on island`,
        );
      }
      return;
    }

    if (this.activeGraph.isLocal) {
      if (this.activeBrowserSource) {
        await this.loadBrowserRepoSource(this.activeBrowserSource, target);
        return;
      }

      if (this.cb.localServerEnabled && this.activeGraph.localPath) {
        const localPath = this.activeGraph.localPath;
        if (options.checkoutGitHead) {
          this.isLoading = true;
          this.emit();
          try {
            await checkoutLocalBranch(localPath, target);
            await this.loadLocalRepo(localPath, true, target);
            this.cb.onToast(`Checked out "${target}" in local Git repository`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : `Could not checkout "${target}".`;
            this.cb.onToast(msg, true, 6000);
          } finally {
            this.isLoading = false;
            this.emit();
          }
          return;
        }

        await this.loadLocalRepo(localPath, true, target);
        return;
      }
    }

    await this.loadRepoBySpec(
      `${this.activeGraph.owner}/${this.activeGraph.repo}`,
      true,
      target,
    );
  }

  public flyToGate(selectFirst = true): void {
    if (!this.builtWorld?.gate) return;
    this.followVillager = false;
    const arch = this.builtWorld.gate.archPosition;
    this.cameraFlight = {
      targetLook: new THREE.Vector3(arch.x + 2.2, 1.4, 0),
      targetPos: new THREE.Vector3(arch.x + 6.5, 6.2, 11.5),
      active: true,
    };
    if (selectFirst && this.gateVisitors.length > 0) {
      this.focusOnGateVisitor(this.gateVisitors[0], true, false);
    } else {
      this.emit();
    }
  }

  public flyToConflictZone(selectFirstConflict = true): void {
    if (!this.builtWorld) return;
    this.followVillager = false;
    const conflictBridge = this.builtWorld.bridges.find((b) => b.isConflicted);
    const gate = this.builtWorld.gate;

    if (conflictBridge && gate) {
      const mid = conflictBridge.curve.getPointAt(0.5);
      const arch = gate.archPosition;
      const focusX = mid.x * 0.45 + (arch.x + 1.4) * 0.55;
      const focusZ = mid.z * 0.42;
      const camZSign = mid.z >= 0 ? 1 : -1;
      this.cameraFlight = {
        targetLook: new THREE.Vector3(focusX, 1.35, focusZ),
        targetPos: new THREE.Vector3(focusX + 4.8, 8.2, focusZ + camZSign * 15.5),
        active: true,
      };
    } else if (conflictBridge) {
      const mid = conflictBridge.curve.getPointAt(0.5);
      const camZSign = mid.z >= 0 ? 1 : -1;
      this.cameraFlight = {
        targetLook: mid.clone().add(new THREE.Vector3(0, 0.8, 0)),
        targetPos: mid.clone().add(new THREE.Vector3(4.2, 6.4, camZSign * 12.5)),
        active: true,
      };
    } else if (gate) {
      this.flyToGate(selectFirstConflict);
      return;
    }

    const firstConflicted =
      this.gateVisitors.find((gv) => gv.file.status === 'conflicted') ?? this.gateVisitors[0];
    if (selectFirstConflict && firstConflicted) {
      this.focusOnGateVisitor(firstConflicted, true, false);
    } else {
      this.emit();
    }
  }

  public loadConflictDemo(updateUrl = true): void {
    this.academyActive = false;
    this.academySandbox = null;
    this.currentLoadController?.abort();
    this.activeBrowserSource = null;
    const conflictGraph = createConflictDemoRepoGraph();
    this.rebuildVillageFromGraph(conflictGraph, { focusGateOnLoad: true });
    this.flyToConflictZone(true);
    sound.playPop(415.3);
    trackEvent('merge_conflict_demo_loaded', {
      conflicted_files: conflictGraph.mergeConflict?.conflictedCount ?? 0,
    });
    if (updateUrl) {
      this.cb.onSyncUrl({ repo: null, local: null, branch: null });
    }
    this.cb.onToast(
      `⚔️ Merge Conflict Storm — ${conflictGraph.mergeConflict?.theirsBranch} clashes with ${conflictGraph.mergeConflict?.oursBranch} across 3 files!`,
      false,
      5400,
    );
  }

  public resolveSimulatedConflict(): void {
    if (!this.builtWorld) return;
    this.conflictRepairProgress = 0.001;
    this.gatePreviewOpenTimer = 4.8;
    for (const br of this.builtWorld.bridges) {
      if (br.isConflicted) {
        br.isConflicted = false;
      }
    }
    if (this.activeGraph.mergeConflict) {
      this.activeGraph = {
        ...this.activeGraph,
        mergeConflict: {
          ...this.activeGraph.mergeConflict,
          active: false,
        },
        ciWeather: {
          status: 'passing',
          summary: 'Conflicts resolved — merge bridge repaired!',
        },
        gateVisitors: (this.activeGraph.gateVisitors ?? []).map((f) =>
          f.status === 'conflicted' ? { ...f, status: 'modified', staged: true } : f,
        ),
      };
    }

    for (const gv of this.gateVisitors) {
      if (gv.file.status === 'conflicted') {
        gv.file = { ...gv.file, status: 'modified', staged: true };
        const auraMat = gv.auraRing.material as THREE.MeshBasicMaterial;
        auraMat.color.setHex(0x30d158);
      }
      gv.jumpVelocity = 8.2 + Math.random() * 1.6;
      this.triggerVisitorEmote(gv, gv.index % 2 === 0 ? '🤝' : '🎉', 3.8);
    }

    if (this.selectedGateVisitor) {
      const updated = this.gateVisitors[this.selectedGateVisitor.index];
      if (updated) this.selectedGateVisitor = updated;
    }

    if (this.builtWorld.animatedProps.gateRoofMat) {
      this.builtWorld.animatedProps.gateRoofMat.color.setHex(0x059669);
    }
    this.applyAtmosphere('day');
    sound.playRepoLoaded();
    trackEvent('merge_conflict_resolved_preview', describeRepoForAnalytics(this.activeGraph));
    this.cb.onToast(
      '🤝 Conflicts resolved! Merge bridge repaired, storm cleared & Gate opened!',
      false,
      5200,
    );
    this.emit();
  }

  public triggerGatePreviewOpen(): void {
    if (!this.builtWorld?.gate || this.gateVisitors.length === 0) return;
    if (this.activeGraph.mergeConflict?.active) {
      this.resolveSimulatedConflict();
      return;
    }
    this.gatePreviewOpenTimer = 4.2;
    sound.playRepoLoaded();
    for (const gv of this.gateVisitors) {
      gv.jumpVelocity = 7.5 + Math.random() * 2.0;
      this.triggerVisitorEmote(gv, '🎉', 3.2);
    }
    this.cb.onToast(
      `Previewing Gate Open — ${this.gateVisitors.length} file visitor${this.gateVisitors.length === 1 ? '' : 's'} entering the island. Run git commit to welcome them permanently.`,
    );
  }

  public focusOnVillager(v: VillagerEntity, playChime = true): void {
    this.selectedVillager = v;
    this.selectedGateVisitor = null;
    this.selectedStash = null;
    this.selectedLandmark = null;
    if (playChime) {
      sound.playSelectVillager(v.commit.kind);
      trackEvent('commit_inspected', {
        ...describeRepoForAnalytics(this.activeGraph),
        commit_kind: v.commit.kind,
        branch: this.activeGraph.isLocal ? 'local_branch' : v.commit.branch,
        files_count: v.commit.files?.length ?? 0,
      });
    }

    v.behavior = 'jump_joy';
    v.behaviorTimer = 3.2;
    v.jumpVelocity = 6.2;
    this.triggerEmote(`c:${v.commit.sha}`, v, '👋', 2.2);

    if (this.cameraMode === 'orbit') {
      const pos = v.root.position;
      const offset = new THREE.Vector3(2.4, 3.6, 7.2);
      this.cameraFlight = {
        targetLook: new THREE.Vector3(pos.x + 1.1, pos.y + 1.0, pos.z),
        targetPos: pos.clone().add(offset),
        active: true,
      };
    }

    this.emit();
    void this.hydrateSelectedCommitIfNeeded(v);
  }

  private async hydrateSelectedCommitIfNeeded(v: VillagerEntity): Promise<void> {
    const commit = v.commit;
    if (
      commit.patchesHydrated ||
      this.activeGraph.isDemo ||
      this.academyActive ||
      this.activeGraph.isAcademy
    ) {
      return;
    }
    if (this.activeGraph.isLocal && (!this.cb.localServerEnabled || !this.activeGraph.localPath)) {
      return;
    }

    this.isHydratingDiff = true;
    this.emit();
    try {
      if (this.activeGraph.isLocal && this.cb.localServerEnabled && this.activeGraph.localPath) {
        await hydrateLocalCommitDetail(this.activeGraph.localPath, commit);
      } else if (!this.activeGraph.isDemo && !this.activeGraph.isLocal) {
        await hydrateCommitDetail(
          this.activeGraph.owner,
          this.activeGraph.repo,
          commit,
          this.cb.getGithubToken(),
        );
      }
      refreshVillagerCargo(v);
    } catch {
      // ignore hydration glitches
    } finally {
      this.isHydratingDiff = false;
      this.emit();
    }
  }

  public focusOnGateVisitor(gv: GateVisitorEntity, playChime = true, moveCamera = true): void {
    this.selectedGateVisitor = gv;
    this.selectedVillager = null;
    this.selectedStash = null;
    this.selectedLandmark = null;
    this.followVillager = false;

    if (playChime) {
      sound.playSelectVillager(gv.file.staged ? 'feat' : 'fix');
      trackEvent('gate_visitor_inspected', {
        status: gv.file.status,
        staged: gv.file.staged,
      });
    }

    gv.jumpVelocity = 7.0;
    this.triggerVisitorEmote(
      gv,
      gv.file.status === 'conflicted' ? '⚔️' : gv.file.staged ? '🎫' : '🙋',
      2.4,
    );

    if (moveCamera && this.cameraMode === 'orbit') {
      const pos = gv.root.position;
      this.cameraFlight = {
        targetLook: new THREE.Vector3(pos.x + 0.8, pos.y + 1.1, pos.z),
        targetPos: new THREE.Vector3(pos.x + 4.2, pos.y + 4.2, pos.z + 8.0),
        active: true,
      };
    }

    this.emit();
  }

  public rebuildVillageFromGraph(
    graph: RepoVillageGraph,
    options: { preserveCamera?: boolean; focusGateOnLoad?: boolean } = {},
  ): void {
    this.stopTimeLapse(false);
    this.turntableOrbit.active = false;
    this.activeGraph = graph;
    this.lastLocalFingerprint = graph.isLocal ? computeLocalGraphFingerprint(graph) : '';

    this.hoveredVillager = null;
    this.hoveredGateVisitor = null;
    if (!options.preserveCamera) {
      this.selectedVillager = null;
      this.selectedGateVisitor = null;
      this.selectedStash = null;
      this.selectedLandmark = null;
      this.activeAuthorKey = null;
      this.followVillager = false;
      this.bisectState.active = false;
      this.bisectState.resolvedCulpritSha = null;
    }
    this.openedStashIndices.clear();
    this.hoverPill.hidden = true;
    this.gatePreviewOpenTimer = 0;
    this.conflictRepairProgress = 0;

    if (this.builtWorld) {
      this.scene.remove(this.builtWorld.worldGroup);
    }
    if (this.builtHeatmapWorld) {
      this.scene.remove(this.builtHeatmapWorld.worldGroup);
      this.builtHeatmapWorld = null;
    }
    this.activeHeatmap = null;
    this.selectedHeatmapDay = null;
    this.heatmapWave.active = false;
    this.villagers = [];
    this.villagerBySha.clear();
    this.islandByBranch.clear();
    this.bridgeFreeAt.clear();
    this.gateVisitors = [];
    this.overlayLayer.replaceChildren();
    this.emoteElements.clear();

    this.clanMap = buildContributorClanMap(graph.commitsBySha.values());
    this.builtWorld = buildVillageWorld(graph);
    this.scene.add(this.builtWorld.worldGroup);

    for (const isl of this.builtWorld.islands) {
      this.islandByBranch.set(isl.branch.name, isl);
    }

    for (const branch of graph.branches) {
      const isl = this.islandByBranch.get(branch.name);
      if (!isl) continue;
      branch.commits.forEach((commit, idx) => {
        const clan = this.clanMap.get(normalizeAuthorKey(commit));
        const entity = createVillagerEntity(commit, isl, idx, branch.commits.length, clan);
        this.builtWorld!.worldGroup.add(entity.root);
        this.villagers.push(entity);
        this.villagerBySha.set(commit.sha, entity);

        const emoteEl = document.createElement('div');
        emoteEl.className = 'emote-bubble';
        emoteEl.hidden = true;
        this.overlayLayer.appendChild(emoteEl);
        this.emoteElements.set(`c:${commit.sha}`, emoteEl);
      });
    }

    // Spawn Translucent Spirit Villagers on the Sunken Reflog Ghost Ruin Island!
    if (this.builtWorld.ghostIsland) {
      const gIsl = this.builtWorld.ghostIsland;
      const ghosts = graph.ghostCommits ?? [];
      ghosts.forEach((ghostCommit, idx) => {
        const clan = this.clanMap.get(normalizeAuthorKey(ghostCommit));
        const entity = createVillagerEntity(ghostCommit, gIsl, idx, ghosts.length, clan);
        this.builtWorld!.worldGroup.add(entity.root);
        this.villagers.push(entity);
        this.villagerBySha.set(ghostCommit.sha, entity);

        const emoteEl = document.createElement('div');
        emoteEl.className = 'emote-bubble';
        emoteEl.hidden = true;
        this.overlayLayer.appendChild(emoteEl);
        this.emoteElements.set(`c:${ghostCommit.sha}`, emoteEl);
      });
    }

    if (this.builtWorld.gate) {
      const gate = this.builtWorld.gate;
      const files = graph.gateVisitors ?? [];
      files.forEach((file, idx) => {
        const slot = gate.visitorSlots[idx] ?? gate.visitorSlots.at(-1)!;
        const rushSpot = gate.targetIslandPos
          .clone()
          .add(new THREE.Vector3(-((idx % 4) * 0.9), 0, ((idx % 3) - 1) * 0.95));
        const gv = createGateVisitorEntity(file, idx, slot, rushSpot);
        this.builtWorld!.worldGroup.add(gv.root);
        this.gateVisitors.push(gv);

        const emoteEl = document.createElement('div');
        emoteEl.className = 'emote-bubble';
        emoteEl.hidden = true;
        this.overlayLayer.appendChild(emoteEl);
        this.emoteElements.set(`v:${idx}`, emoteEl);
      });
    }

    if (graph.mergeConflict?.active) {
      this.timeOfDay = 'storm';
    } else if (this.timeOfDay === 'storm' && graph.ciWeather?.status !== 'failing') {
      this.timeOfDay = 'day';
    }
    this.applyAtmosphere(this.timeOfDay);
    this.applyVillagerFilterBeams();

    // Relax initial spawn positions so zero villagers start overlapping on dense islands
    for (let pass = 0; pass < 6; pass++) {
      this.resolveCharacterCollisions(0, true);
    }

    if (!options.preserveCamera) {
      if (this.cameraMode === 'walk') {
        const startIsl = this.builtWorld.islands[0];
        const p = startIsl.pathCurve.getPointAt(0.5);
        this.explorer.root.position.set(p.x, p.y, p.z + 0.8);
      } else if (graph.mergeConflict?.active) {
        this.flyToConflictZone(false);
      } else if (options.focusGateOnLoad && this.builtWorld.gate) {
        this.flyToGate(false);
      } else {
        this.flyToOverview();
      }
    }

    this.emit();
  }

  public async loadBrowserRepoSource(
    source: BrowserRepoSource,
    targetBranch?: string,
  ): Promise<void> {
    this.academyActive = false;
    this.academySandbox = null;
    this.currentLoadController?.abort();
    this.isLoading = true;
    this.emit();
    this.cb.onToast(
      targetBranch
        ? `Switching "${source.rootName}" to branch ${targetBranch}…`
        : `Reading local Git repository "${source.rootName}"…`,
      false,
      0,
    );

    try {
      const graph = await loadBrowserGitRepoVillage(source, targetBranch);
      this.activeBrowserSource = source;
      const waitingCount = graph.gateVisitors?.length ?? 0;
      this.rebuildVillageFromGraph(graph, {
        focusGateOnLoad: !targetBranch && waitingCount > 0,
      });
      sound.playRepoLoaded();
      this.cb.onSyncUrl({ repo: null, local: null, branch: null });
      trackEvent('repo_loaded', {
        source: 'local_browser',
        repo_type: 'local',
        repo_slug: 'local_repo',
        branch: 'local_branch',
        commit_count: this.villagers.length,
        branch_count: graph.branches.length,
        gate_visitors_count: waitingCount,
      });

      if (targetBranch) {
        this.cb.onToast(
          `${graph.repo} (${graph.currentBranch}) — ${this.villagers.length} commits loaded`,
        );
      } else if (waitingCount > 0) {
        this.cb.onToast(
          `${graph.repo} — ${waitingCount} uncommitted file${waitingCount === 1 ? '' : 's'} waiting at the Village Gate`,
        );
        if (this.gateVisitors.length > 0) {
          this.focusOnGateVisitor(this.gateVisitors[0], false, false);
        }
      } else {
        this.cb.onToast(`${graph.repo} — ${this.villagers.length} commits loaded privately in browser`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not parse local Git repository folder.';
      trackEvent('repo_load_failed', {
        source: 'local_browser',
        error_type: message.slice(0, 80),
      });
      this.cb.onToast(message, true, 6500);
    } finally {
      this.isLoading = false;
      this.emit();
    }
  }

  public async loadLocalRepo(
    pathSpec: string,
    updateUrl = true,
    targetBranch?: string,
  ): Promise<void> {
    if (!this.cb.localServerEnabled) {
      this.cb.onRequestLocalModal();
      return;
    }

    this.academyActive = false;
    this.academySandbox = null;
    this.activeBrowserSource = null;
    this.currentLoadController?.abort();
    const controller = new AbortController();
    this.currentLoadController = controller;
    this.isLoading = true;
    this.emit();
    this.cb.onToast(
      targetBranch ? `Switching to branch "${targetBranch}"…` : 'Opening local repository…',
      false,
      0,
    );

    try {
      const graph = await loadLocalRepoVillage(pathSpec, controller.signal, targetBranch);
      const waitingCount = graph.gateVisitors?.length ?? 0;
      this.rebuildVillageFromGraph(graph, {
        focusGateOnLoad: !targetBranch && waitingCount > 0,
      });
      sound.playRepoLoaded();
      trackEvent('repo_loaded', {
        source: 'local_server',
        repo_type: 'local',
        repo_slug: 'local_repo',
        branch: 'local_branch',
        commit_count: this.villagers.length,
        branch_count: graph.branches.length,
        gate_visitors_count: waitingCount,
      });

      if (updateUrl) {
        const customBranch =
          graph.currentBranch && graph.currentBranch !== graph.headBranch
            ? graph.currentBranch
            : null;
        this.cb.onSyncUrl({
          repo: null,
          local: graph.localPath ?? pathSpec,
          branch: customBranch,
        });
      }

      if (targetBranch) {
        this.cb.onToast(
          `${graph.repo} · branch "${graph.currentBranch}" (${this.villagers.length} commits)`,
        );
      } else if (waitingCount > 0) {
        this.cb.onToast(
          `${graph.repo} — ${waitingCount} uncommitted file${waitingCount === 1 ? '' : 's'} waiting at the Village Gate`,
        );
        if (this.gateVisitors.length > 0) {
          this.focusOnGateVisitor(this.gateVisitors[0], false, false);
        }
      } else {
        this.cb.onToast(`${graph.repo} — Working tree clean, Village Gate open`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Could not load local git repository.';
      trackEvent('repo_load_failed', {
        source: 'local_server',
        error_type: message.slice(0, 80),
      });
      this.cb.onToast(message, true, 6000);
    } finally {
      this.isLoading = false;
      this.emit();
    }
  }

  public async pollLocalRepoNow(manualFeedback = false): Promise<void> {
    if (
      this.academyActive ||
      this.activeGraph.isDemo ||
      !this.activeGraph.isLocal ||
      this.isPollingLocal
    ) {
      return;
    }
    if (
      !this.activeBrowserSource?.dirHandle &&
      (!this.cb.localServerEnabled || !this.activeGraph.localPath)
    ) {
      return;
    }

    this.isPollingLocal = true;
    try {
      const pinnedBranch =
        this.activeGraph.currentBranch &&
        this.activeGraph.headBranch &&
        this.activeGraph.currentBranch !== this.activeGraph.headBranch
          ? this.activeGraph.currentBranch
          : undefined;
      const freshGraph = this.activeBrowserSource?.dirHandle
        ? await loadBrowserGitRepoVillage(this.activeBrowserSource, pinnedBranch)
        : await loadLocalRepoVillage(this.activeGraph.localPath!, undefined, pinnedBranch);
      const freshFp = computeLocalGraphFingerprint(freshGraph);

      if (freshFp !== this.lastLocalFingerprint) {
        const prevHead = this.activeGraph.branches[0]?.commits.at(-1)?.sha;
        const nextHead = freshGraph.branches[0]?.commits.at(-1)?.sha;
        const prevCount = this.gateVisitors.length;
        const nextCount = freshGraph.gateVisitors?.length ?? 0;

        this.rebuildVillageFromGraph(freshGraph, { preserveCamera: true });
        sound.playPop(nextHead !== prevHead ? 659.25 : 523.25);

        if (nextHead !== prevHead) {
          this.cb.onToast(
            `Gate opened — "${freshGraph.branches[0]?.commits.at(-1)?.subject ?? 'New commit'}" welcomed into the village`,
          );
        } else if (nextCount > prevCount) {
          this.cb.onToast(
            `${nextCount - prevCount} new file visitor${nextCount - prevCount === 1 ? '' : 's'} arrived at the Gate (${nextCount} waiting)`,
          );
        } else {
          this.cb.onToast(
            `Working tree updated — ${nextCount} visitor${nextCount === 1 ? '' : 's'} at the Gate`,
          );
        }
      } else if (manualFeedback) {
        this.cb.onToast(
          `Working tree synced — ${this.gateVisitors.length} file${this.gateVisitors.length === 1 ? '' : 's'} at Gate`,
        );
      }
    } catch {
      // ignore background poll glitches
    } finally {
      this.isPollingLocal = false;
    }
  }

  public async loadRepoBySpec(
    spec: string,
    updateUrl = true,
    targetBranch?: string,
  ): Promise<void> {
    if (isLocalPathInput(spec)) {
      await this.loadLocalRepo(spec, updateUrl, targetBranch);
      return;
    }

    this.academyActive = false;
    this.academySandbox = null;
    this.currentLoadController?.abort();
    this.activeBrowserSource = null;

    if (spec === 'demo' || spec === 'gitvillage/sky-village') {
      const demo = createDemoRepoGraph();
      this.rebuildVillageFromGraph(demo);
      if (targetBranch && demo.allBranches?.includes(targetBranch)) {
        this.flyToBranchIsland(targetBranch);
      }
      sound.playRepoLoaded();
      trackEvent('repo_loaded', {
        source: 'showcase',
        repo_type: 'demo',
        repo_slug: 'gitvillage/sky-village',
        branch: targetBranch ?? demo.defaultBranch,
        commit_count: this.villagers.length,
        branch_count: demo.branches.length,
        gate_visitors_count: 0,
      });
      if (updateUrl) {
        this.cb.onSyncUrl({
          repo: null,
          local: null,
          branch:
            targetBranch && targetBranch !== demo.defaultBranch ? targetBranch : null,
        });
      }
      this.cb.onToast('Showcase Village — gitvillage/sky-village');
      return;
    }

    const parsed = parseRepoInput(spec);
    if (!parsed) {
      this.cb.onToast(
        'Enter a GitHub owner/repo or choose a local repository folder.',
        true,
      );
      return;
    }

    const controller = new AbortController();
    this.currentLoadController = controller;
    this.isLoading = true;
    this.emit();
    this.cb.onToast(
      targetBranch
        ? `Loading ${parsed.owner}/${parsed.repo} (${targetBranch})…`
        : `Loading ${parsed.owner}/${parsed.repo}…`,
      false,
      0,
    );

    try {
      const graph = await loadGitHubRepoVillage(
        parsed.owner,
        parsed.repo,
        this.cb.getGithubToken(),
        controller.signal,
        targetBranch,
      );
      this.rebuildVillageFromGraph(graph);
      sound.playRepoLoaded();
      trackEvent('repo_loaded', {
        source: 'github',
        repo_type: 'github',
        repo_slug: `${graph.owner}/${graph.repo}`,
        branch: graph.currentBranch ?? graph.defaultBranch,
        commit_count: this.villagers.length,
        branch_count: graph.branches.length,
        gate_visitors_count: 0,
      });

      if (updateUrl) {
        this.cb.onSyncUrl({
          repo: `${graph.owner}/${graph.repo}`,
          local: null,
          branch:
            graph.currentBranch && graph.currentBranch !== graph.defaultBranch
              ? graph.currentBranch
              : null,
        });
      }

      this.cb.onToast(
        `${graph.owner}/${graph.repo} (${graph.currentBranch}) — ${this.villagers.length} commits across ${graph.branches.length} islands`,
      );

      // Fetch live GitHub Actions / Commit Status CI weather for the active branch HEAD
      const headCommit = graph.branches[0]?.commits.at(-1);
      if (headCommit) {
        void fetchRepoCiWeather(
          graph.owner,
          graph.repo,
          headCommit.sha,
          this.cb.getGithubToken(),
          controller.signal,
        ).then((weather) => {
          if (this.activeGraph !== graph || this.disposed) return;
          graph.ciWeather = weather;
          if (weather.status === 'failing' && this.timeOfDay !== 'storm') {
            this.applyAtmosphere('storm');
            this.cb.onToast(`⛈️ ${weather.summary} — storm clouds rolled in over HEAD!`);
          } else {
            this.emit();
          }
        });
      }

      const recentToHydrate = this.villagers.slice(-8);
      void Promise.allSettled(
        recentToHydrate.map(async (v) => {
          await hydrateCommitDetail(
            graph.owner,
            graph.repo,
            v.commit,
            this.cb.getGithubToken(),
          );
          if (this.activeGraph === graph) {
            refreshVillagerCargo(v);
          }
        }),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Could not load repository.';
      trackEvent('repo_load_failed', {
        source: 'github',
        repo_slug: `${parsed.owner}/${parsed.repo}`,
        error_type: message.slice(0, 80),
      });
      this.cb.onToast(message, true, 6000);
    } finally {
      this.isLoading = false;
      this.emit();
    }
  }

  private triggerEmote(key: string, v: VillagerEntity, emoji: string, duration = 2.0): void {
    v.emoteEmoji = emoji;
    v.emoteTimer = duration;
    const el = this.emoteElements.get(key);
    if (el) {
      el.textContent = emoji;
      el.hidden = false;
    }
  }

  private triggerVisitorEmote(gv: GateVisitorEntity, emoji: string, duration = 2.0): void {
    gv.emoteEmoji = emoji;
    gv.emoteTimer = duration;
    const el = this.emoteElements.get(`v:${gv.index}`);
    if (el) {
      el.textContent = emoji;
      el.hidden = false;
    }
  }

  private sampleWalkableSurfaceY(x: number, z: number, currentY: number): number | null {
    if (!this.builtWorld) return null;
    let bestY: number | null = null;
    let bestDiff = Infinity;

    for (const isl of this.builtWorld.islands) {
      const dx = Math.abs(x - isl.center.x);
      const dz = Math.abs(z - isl.center.z);
      if (dx <= isl.length * 0.49 && dz <= isl.width * 0.48) {
        const deckY = isl.center.y + 0.03;
        const diff = Math.abs(deckY - currentY);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestY = deckY;
        }
      }
    }

    if (this.builtWorld.gate) {
      const g = this.builtWorld.gate;
      const dx = Math.abs(x - g.dockCenter.x);
      const dz = Math.abs(z - g.dockCenter.z);
      if (dx <= g.dockLength * 0.54 && dz <= g.dockWidth * 0.48) {
        const diff = Math.abs(0.05 - currentY);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestY = 0.05;
        }
      }
    }

    for (const br of this.builtWorld.bridges) {
      const samples = 26;
      for (let i = 0; i <= samples; i++) {
        const pt = br.curve.getPointAt(i / samples);
        const distXZ = Math.hypot(x - pt.x, z - pt.z);
        if (distXZ <= 0.96) {
          const diff = Math.abs(pt.y - currentY);
          if (diff < bestDiff + 0.85) {
            bestDiff = diff;
            bestY = pt.y + 0.05;
          }
        }
      }
    }

    return bestY;
  }

  private isNearAnyBridgeLanding(pos: THREE.Vector3): boolean {
    if (!this.builtWorld) return false;
    for (const br of this.builtWorld.bridges) {
      const startPt = br.curve.getPointAt(0);
      const endPt = br.curve.getPointAt(1);
      const entryJunc = br.traversalCurve.getPointAt(0);
      const exitJunc = br.traversalCurve.getPointAt(1);
      if (
        Math.hypot(pos.x - startPt.x, pos.z - startPt.z) < 1.85 ||
        Math.hypot(pos.x - endPt.x, pos.z - endPt.z) < 1.85 ||
        Math.hypot(pos.x - entryJunc.x, pos.z - entryJunc.z) < 1.35 ||
        Math.hypot(pos.x - exitJunc.x, pos.z - exitJunc.z) < 1.35
      ) {
        return true;
      }
    }
    return false;
  }

  private countIslandOccupancy(isl: IslandLayout): number {
    let total = 0;
    for (const v of this.villagers) {
      if (v.activeBridge) {
        if (v.activeBridge.toIsland === isl) total++;
      } else if (v.island === isl) {
        total++;
      }
    }
    return total;
  }

  private tryEnterOneWayBridge(
    v: VillagerEntity,
    prevT: number,
    nextT: number,
    elapsed: number,
  ): boolean {
    if (!this.builtWorld || v === this.selectedVillager || v === this.hoveredVillager) {
      return false;
    }

    const fromBranch = v.island.branch.name;
    for (const br of this.builtWorld.bridges) {
      // Strict Git directional rule:
      // - Fork bridges (`main` -> `branch`) ONLY climb UP (`fromBranch === main`)
      // - Merge bridges (`branch` -> `main`) ONLY descend DOWN (`fromBranch === branch`)
      if (br.fromBranch !== fromBranch) continue;

      const crossedEntry =
        (prevT <= br.entryPathT && nextT >= br.entryPathT) ||
        (prevT >= br.entryPathT && nextT <= br.entryPathT);
      if (!crossedEntry) continue;

      // Merge Conflict Barrier: fractured bridges cannot be crossed until conflicts are resolved!
      if (br.isConflicted) {
        if (v.jumpY === 0 && v.emoteTimer <= 0 && Math.random() < 0.65) {
          v.jumpVelocity = 4.8;
          v.pathDir = (v.pathDir * -1) as 1 | -1;
          this.triggerEmote(`c:${v.commit.sha}`, v, '⚡', 1.8);
        }
        continue;
      }

      // Strict Zero-Traffic Rule 1: Cooldown & single-occupant reservation
      if (elapsed < (this.bridgeFreeAt.get(br) ?? 0)) continue;
      if (this.villagers.some((other) => other.activeBridge?.bridge === br)) continue;

      const toIsland = this.islandByBranch.get(br.toBranch);
      if (!toIsland) continue;

      // Strict Zero-Traffic Rule 2: Balanced island populations (never empty or overcrowd an island)
      const fromPop = this.countIslandOccupancy(v.island);
      const minFromPop = v.island.branch.isDefault
        ? Math.max(3, Math.floor(v.island.branch.commits.length * 0.45))
        : Math.max(1, v.island.branch.commits.length - 1);
      if (fromPop <= minFromPop) continue;

      const toPop = this.countIslandOccupancy(toIsland);
      const hasReturnMergeBridge = this.builtWorld.bridges.some(
        (m) => m.kind === 'merge' && m.fromBranch === toIsland.branch.name,
      );
      const maxToPop = toIsland.branch.isDefault
        ? Math.max(8, toIsland.branch.commits.length + 4)
        : toIsland.branch.commits.length + (hasReturnMergeBridge ? 2 : 1);
      if (toPop >= maxToPop) continue;

      // Strict Zero-Traffic Rule 3: Exit junction must be clear & Walk-Mode player not on bridge
      const exitPt = br.traversalCurve.getPointAt(1);
      const exitBlocked = this.villagers.some(
        (other) =>
          other !== v &&
          !other.activeBridge &&
          other.island === toIsland &&
          Math.hypot(other.root.position.x - exitPt.x, other.root.position.z - exitPt.z) < 1.35,
      );
      if (exitBlocked) continue;

      if (this.cameraMode === 'walk') {
        const ex = this.explorer.root.position;
        const mid = br.curve.getPointAt(0.5);
        if (Math.hypot(ex.x - mid.x, ex.z - mid.z) < 4.2) continue;
      }

      // Prefer commits affiliated with the branch/author, with organic probability
      const isBranchAffiliate =
        v.commit.branch === br.toBranch ||
        (br.kind === 'merge' && v.commit.branch === br.fromBranch);
      const chance = isBranchAffiliate ? 0.82 : 0.52;
      if (Math.random() > chance) continue;

      // Seamless C0 world-position projection onto the spur + bridge traversal curve!
      const prevWorldX = v.root.position.x;
      const prevWorldZ = v.root.position.z;
      v.behavior = 'bridge_walk';
      v.behaviorTimer = 30;
      v.yieldTimer = 0;
      v.activeBridge = {
        bridge: br,
        toIsland,
        curve: br.traversalCurve,
        t: 0.002,
        dir: 1,
      };
      const newFrame = this.getVillagerCurveFrame(v);
      v.lateralOffset = Math.max(
        -newFrame.maxLat,
        Math.min(
          newFrame.maxLat,
          (prevWorldX - newFrame.pt.x) * newFrame.nx +
            (prevWorldZ - newFrame.pt.z) * newFrame.nz,
        ),
      );
      this.syncVillagerWorldPosition(v);
      return true;
    }

    return false;
  }

  private bindEvents(): void {
    const getAllHitBoxes = (): THREE.Object3D[] => {
      const boxes: THREE.Object3D[] = [];
      for (const v of this.villagers) {
        if (v.root.visible) boxes.push(v.hitBox);
      }
      for (const gv of this.gateVisitors) boxes.push(gv.hitBox);
      if (this.builtWorld) {
        for (const sc of this.builtWorld.stashChests) boxes.push(sc.hitBox);
        for (const lm of this.builtWorld.landmarks) boxes.push(lm.hitBox);
      }
      if (this.builtHeatmapWorld) {
        for (const tw of this.builtHeatmapWorld.towers) boxes.push(tw.hitBox);
      }
      return boxes;
    };

    const onPointerMove = (e: PointerEvent) => {
      this.pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const hits = this.raycaster.intersectObjects(getAllHitBoxes(), false);

      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.heatmapTower) {
          const tw = ud.heatmapTower as BuiltHeatmapTower;
          this.hoveredVillager = null;
          this.hoveredGateVisitor = null;
          this.canvas.style.cursor = 'pointer';
          const dtLabel = new Date(`${tw.day.date}T12:00:00Z`).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          const countLabel =
            tw.day.count === 0
              ? 'No contributions'
              : `${tw.day.count} contribution${tw.day.count === 1 ? '' : 's'}`;
          this.hoverPill.textContent = `${tw.isPeak ? '🏆 Peak Day · ' : '🟩 '}${countLabel} · ${dtLabel}`;
          this.hoverPill.style.left = `${e.clientX}px`;
          this.hoverPill.style.top = `${e.clientY}px`;
          this.hoverPill.hidden = false;
          return;
        }
        if (typeof ud.stashIndex === 'number') {
          const sc = this.builtWorld?.stashChests[ud.stashIndex];
          this.hoveredVillager = null;
          this.hoveredGateVisitor = null;
          if (sc) {
            this.canvas.style.cursor = 'pointer';
            this.hoverPill.textContent = `📦 ${sc.stash.selector} · ${sc.stash.message}`;
            this.hoverPill.style.left = `${e.clientX}px`;
            this.hoverPill.style.top = `${e.clientY}px`;
            this.hoverPill.hidden = false;
          }
          return;
        }
        if (typeof ud.landmarkIndex === 'number') {
          const lm = this.builtWorld?.landmarks[ud.landmarkIndex];
          this.hoveredVillager = null;
          this.hoveredGateVisitor = null;
          if (lm) {
            this.canvas.style.cursor = 'pointer';
            this.hoverPill.textContent =
              lm.data.kind === 'hotspot'
                ? `🔥 Hotspot Forge · ${lm.data.filename} (${lm.data.touches} commits, ${lm.data.fixCount} fixes)`
                : `🗿 Ancient Monument · ${lm.data.filename} (stable foundation)`;
            this.hoverPill.style.left = `${e.clientX}px`;
            this.hoverPill.style.top = `${e.clientY}px`;
            this.hoverPill.hidden = false;
          }
          return;
        }
        if (typeof ud.visitorIndex === 'number') {
          const gv = this.gateVisitors[ud.visitorIndex] ?? null;
          if (gv !== this.hoveredGateVisitor) {
            this.hoveredGateVisitor = gv;
            this.hoveredVillager = null;
            if (gv) sound.playHover();
          }
          if (gv) {
            this.canvas.style.cursor = 'pointer';
            const prefix =
              gv.file.status === 'conflicted'
                ? '⚔️ Merge Conflict'
                : gv.file.staged
                  ? 'Staged'
                  : 'Gate';
            this.hoverPill.textContent = `${prefix} · ${gv.file.filename} (+${gv.file.additions} / −${gv.file.deletions})`;
            this.hoverPill.style.left = `${e.clientX}px`;
            this.hoverPill.style.top = `${e.clientY}px`;
            this.hoverPill.hidden = false;
          }
          return;
        }

        const sha = ud.commitSha as string;
        const ent = this.villagerBySha.get(sha) ?? null;
        if (ent !== this.hoveredVillager) {
          this.hoveredVillager = ent;
          this.hoveredGateVisitor = null;
          if (ent) sound.playHover();
        }
        if (ent) {
          this.canvas.style.cursor = 'pointer';
          const cargo = getCommitCargoMetrics(ent.commit);
          const arch = computeCommitArchetype(ent.commit);
          const clan = this.clanMap.get(ent.authorKey);
          const clanTag = clan ? `${clan.emblem} ${clan.initials} · ` : '';
          const prefix = ent.commit.isGhost
            ? `👻 Reflog Ghost (${ent.commit.reflogAction ?? 'orphan'}) · `
            : ent.commit.coAuthors?.length
              ? `🤝 Pair (${ent.commit.authorName} + ${ent.commit.coAuthors[0].name}) · `
              : `${arch.emoji} ${arch.title} · `;
          this.hoverPill.textContent = `${prefix}${clanTag}${ent.commit.shortSha} · ${cargo.filesCount}f · ${ent.commit.subject}`;
          this.hoverPill.style.left = `${e.clientX}px`;
          this.hoverPill.style.top = `${e.clientY}px`;
          this.hoverPill.hidden = false;
        }
      } else {
        this.hoveredVillager = null;
        this.hoveredGateVisitor = null;
        this.canvas.style.cursor = 'grab';
        this.hoverPill.hidden = true;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y,
      );
      if (dist > 6) return;

      this.pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const hits = this.raycaster.intersectObjects(getAllHitBoxes(), false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.heatmapTower) {
          this.focusHeatmapTower(ud.heatmapTower as BuiltHeatmapTower);
          return;
        }
        if (typeof ud.stashIndex === 'number') {
          this.focusStashByIndex(ud.stashIndex);
          return;
        }
        if (typeof ud.landmarkIndex === 'number') {
          this.focusLandmarkByIndex(ud.landmarkIndex);
          return;
        }
        if (typeof ud.visitorIndex === 'number') {
          const gv = this.gateVisitors[ud.visitorIndex];
          if (gv) this.focusOnGateVisitor(gv);
          return;
        }
        const sha = ud.commitSha as string;
        const ent = this.villagerBySha.get(sha);
        if (ent) this.focusOnVillager(ent);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const code = e.code;
      this.keysPressed.add(code);

      if (this.cameraMode === 'walk') {
        if (code === 'Space' && this.explorerVelocity.grounded) {
          e.preventDefault();
          this.explorerVelocity.y = 7.2;
          this.explorerVelocity.grounded = false;
          sound.playPop(540);
        } else if (code === 'KeyE') {
          let minDist = 3.4;
          let closestVillager: VillagerEntity | null = null;
          let closestVisitor: GateVisitorEntity | null = null;

          for (const v of this.villagers) {
            const d = v.root.position.distanceTo(this.explorer.root.position);
            if (d < minDist) {
              minDist = d;
              closestVillager = v;
              closestVisitor = null;
            }
          }
          for (const gv of this.gateVisitors) {
            const d = gv.root.position.distanceTo(this.explorer.root.position);
            if (d < minDist) {
              minDist = d;
              closestVisitor = gv;
              closestVillager = null;
            }
          }

          if (closestVisitor) this.focusOnGateVisitor(closestVisitor);
          else if (closestVillager) this.focusOnVillager(closestVillager);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };

    const onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    this.cleanupFns.push(() => {
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      this.canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
    });
  }

  private updateGateAndVisitors(dt: number, elapsed: number): void {
    const gate = this.builtWorld?.gate;
    if (!gate) return;

    if (this.gatePreviewOpenTimer > 0) {
      this.gatePreviewOpenTimer = Math.max(0, this.gatePreviewOpenTimer - dt);
    }

    const conflictBlockingGate =
      Boolean(this.activeGraph.mergeConflict?.active) && this.gatePreviewOpenTimer <= 0.8;
    const shouldOpenDoors =
      !conflictBlockingGate && (this.gateVisitors.length === 0 || this.gatePreviewOpenTimer > 0.8);
    const targetLeftRot = shouldOpenDoors ? 1.38 : 0;
    const targetRightRot = shouldOpenDoors ? -1.38 : 0;
    gate.leftDoorPivot.rotation.y +=
      (targetLeftRot - gate.leftDoorPivot.rotation.y) * Math.min(1, dt * 7);
    gate.rightDoorPivot.rotation.y +=
      (targetRightRot - gate.rightDoorPivot.rotation.y) * Math.min(1, dt * 7);

    for (const gv of this.gateVisitors) {
      const isHovered = gv === this.hoveredGateVisitor;
      const isSelected = gv === this.selectedGateVisitor;
      const isActivelyConflicted =
        gv.file.status === 'conflicted' &&
        this.gatePreviewOpenTimer <= 0.8 &&
        this.conflictRepairProgress === 0;

      const auraMat = gv.auraRing.material as THREE.MeshBasicMaterial;
      const baseOpacity = isActivelyConflicted ? 0.76 : gv.file.staged ? 0.58 : 0.25;
      const targetOp = isSelected ? 0.98 : isHovered ? 0.84 : baseOpacity;
      auraMat.opacity += (targetOp - auraMat.opacity) * Math.min(1, dt * 10);

      if (gv.ticketMesh) {
        gv.ticketMesh.rotation.y += dt * 2.4;
        gv.ticketMesh.position.y = 1.56 + Math.sin(elapsed * 3.5 + gv.phaseOffset) * 0.08;
      }

      const dest = this.gatePreviewOpenTimer > 0.9 ? gv.rushTarget : gv.queueSlot;
      const distToDest = gv.root.position.distanceTo(dest);

      if (gv.duelRig) {
        if (isActivelyConflicted) {
          gv.duelRig.clashSpark.visible = true;
          gv.duelRig.clashSpark.rotation.y += dt * 5.2;
          gv.duelRig.clashSpark.rotation.z -= dt * 3.4;
          const lunge = Math.sin(elapsed * 9.5 + gv.phaseOffset);
          const sep = 0.27 - Math.max(0, lunge) * 0.09;
          gv.duelRig.oursBody.position.x = -sep;
          gv.duelRig.theirsBody.position.x = sep;
          gv.duelRig.oursBody.rotation.y = Math.PI / 2;
          gv.duelRig.theirsBody.rotation.y = -Math.PI / 2;
          gv.duelRig.oursArm.rotation.x = -1.6 + lunge * 0.85;
          gv.duelRig.theirsArm.rotation.x = -1.6 + lunge * 0.85;
          gv.duelRig.clashSpark.scale.setScalar(0.85 + Math.max(0, lunge) * 0.48);
        } else {
          gv.duelRig.clashSpark.visible = false;
          gv.duelRig.oursBody.position.x = -0.22;
          gv.duelRig.theirsBody.position.x = 0.22;
          gv.duelRig.theirsBody.rotation.y = gv.duelRig.oursBody.rotation.y;
          gv.duelRig.theirsArm.rotation.x = gv.rightArm.rotation.x;
          gv.duelRig.theirsBody.position.y = gv.jumpY;
        }
      }

      if (distToDest > 0.08) {
        const dirX = dest.x - gv.root.position.x;
        const dirZ = dest.z - gv.root.position.z;
        gv.root.position.lerp(dest, Math.min(1, dt * 3.4));
        gv.bodyGroup.rotation.y = Math.atan2(dirX, dirZ);
        if (gv.duelRig) {
          gv.duelRig.theirsBody.rotation.y = gv.bodyGroup.rotation.y;
        }

        const runCycle = elapsed * 14 + gv.phaseOffset;
        gv.leftLeg.rotation.x = Math.sin(runCycle) * 0.75;
        gv.rightLeg.rotation.x = -Math.sin(runCycle) * 0.75;
        gv.leftArm.rotation.x = -2.2 + Math.sin(runCycle) * 0.35;
        gv.rightArm.rotation.x = -2.2 - Math.sin(runCycle) * 0.35;
      } else if (!isActivelyConflicted && isHovered) {
        const dx = this.camera.position.x - gv.root.position.x;
        const dz = this.camera.position.z - gv.root.position.z;
        gv.bodyGroup.rotation.y = Math.atan2(dx, dz);
        gv.rightArm.rotation.x = -2.35 + Math.sin(elapsed * 14) * 0.45;
        gv.leftArm.rotation.x = -0.4;
      } else if (!isActivelyConflicted) {
        const peekSway = Math.sin(elapsed * 2.1 + gv.phaseOffset) * 0.22;
        gv.bodyGroup.rotation.y = -Math.PI / 2 + peekSway;
        gv.rightArm.rotation.x = -1.9 + Math.sin(elapsed * 8 + gv.phaseOffset) * 0.55;
        gv.leftArm.rotation.x = Math.sin(elapsed * 4 + gv.phaseOffset) * 0.25;
        gv.leftLeg.rotation.x = 0;
        gv.rightLeg.rotation.x = 0;
      }

      gv.hopTimer -= dt;
      if (gv.hopTimer <= 0 && gv.jumpY === 0) {
        gv.jumpVelocity = (4.8 + (gv.file.staged ? 1.2 : 0.3)) * (1 - gv.burden * 0.25);
        gv.hopTimer = 1.1 + (gv.index % 5) * 0.45 + Math.random() * 1.2;
        if (gv.emoteTimer <= 0 && Math.random() < 0.36) {
          const emotes = getVisitorStatusMeta(gv.file.status).emotes;
          this.triggerVisitorEmote(gv, emotes[Math.floor(Math.random() * emotes.length)], 1.8);
        }
      }

      if (gv.jumpY > 0 || gv.jumpVelocity !== 0) {
        gv.jumpY += gv.jumpVelocity * dt;
        gv.jumpVelocity -= 20.0 * dt;
        if (gv.jumpY <= 0) {
          gv.jumpY = 0;
          gv.jumpVelocity = 0;
        }
      }
      gv.bodyGroup.position.y = gv.jumpY;
      gv.bodyGroup.rotation.x = gv.burden * 0.16;
      gv.headGroup.rotation.x = -gv.burden * 0.1;
      gv.cargoGroup.rotation.z =
        Math.sin(elapsed * 4.5 + gv.phaseOffset) * (0.02 + gv.burden * 0.08);
      gv.cargoGroup.position.y = 0.36 + Math.min(0.08, gv.jumpY * 0.1);

      if (gv.emoteTimer > 0) {
        gv.emoteTimer -= dt;
        const el = this.emoteElements.get(`v:${gv.index}`);
        if (el) {
          if (gv.emoteTimer <= 0) {
            el.hidden = true;
          } else {
            this.projVec.copy(gv.root.position);
            this.projVec.y += 1.9 + gv.jumpY;
            this.projVec.project(this.camera);
            if (this.projVec.z < 1) {
              el.style.left = `${(this.projVec.x * 0.5 + 0.5) * window.innerWidth}px`;
              el.style.top = `${(-this.projVec.y * 0.5 + 0.5) * window.innerHeight}px`;
              el.hidden = false;
            } else {
              el.hidden = true;
            }
          }
        }
      }
    }
  }

  private getVillagerCurveFrame(v: VillagerEntity): {
    pt: THREE.Vector3;
    tx: number;
    tz: number;
    nx: number;
    nz: number;
    maxLat: number;
    curveLen: number;
  } {
    if (v.behavior === 'bridge_walk' && v.activeBridge) {
      const t = Math.max(0, Math.min(1, v.activeBridge.t));
      const pt = v.activeBridge.curve.getPointAt(t);
      const tan = v.activeBridge.curve.getTangentAt(t);
      const len = Math.hypot(tan.x, tan.z) || 1;
      const tx = tan.x / len;
      const tz = tan.z / len;
      return {
        pt,
        tx,
        tz,
        nx: -tz,
        nz: tx,
        maxLat: 0.4,
        curveLen: Math.max(4, v.activeBridge.curve.getLength()),
      };
    }

    const t = Math.max(0.03, Math.min(0.97, v.pathT));
    const pt = v.island.pathCurve.getPointAt(t);
    const tan = v.island.pathCurve.getTangentAt(t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / len;
    const tz = tan.z / len;
    return {
      pt,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      maxLat: v.island.branch.isDefault ? 1.06 : 0.84,
      curveLen: Math.max(6, v.island.length * 0.82),
    };
  }

  private syncVillagerWorldPosition(v: VillagerEntity): void {
    const f = this.getVillagerCurveFrame(v);
    v.lateralOffset = Math.max(-f.maxLat, Math.min(f.maxLat, v.lateralOffset));
    v.root.position.set(
      f.pt.x + f.nx * v.lateralOffset,
      f.pt.y,
      f.pt.z + f.nz * v.lateralOffset,
    );
  }

  private displaceVillagerOnSurface(v: VillagerEntity, dx: number, dz: number): void {
    const f = this.getVillagerCurveFrame(v);
    const dAlong = dx * f.tx + dz * f.tz;
    const dLat = dx * f.nx + dz * f.nz;

    if (v.behavior === 'bridge_walk' && v.activeBridge) {
      v.activeBridge.t = Math.max(
        0.01,
        Math.min(0.99, v.activeBridge.t + dAlong / f.curveLen),
      );
    } else {
      v.pathT = Math.max(0.04, Math.min(0.96, v.pathT + dAlong / f.curveLen));
    }

    v.lateralOffset = Math.max(-f.maxLat, Math.min(f.maxLat, v.lateralOffset + dLat));
    this.syncVillagerWorldPosition(v);
  }

  private rotateYawSmoothly(currentYaw: number, targetYaw: number, maxStep: number): number {
    let diff = targetYaw - currentYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) <= maxStep) return targetYaw;
    return currentYaw + Math.sign(diff) * maxStep;
  }

  private updateVillagers(dt: number, elapsed: number): void {
    const count = this.villagers.length;
    const focusKinKey =
      (this.hoveredVillager ?? this.selectedVillager)?.authorKey ?? this.activeAuthorKey;

    for (let i = 0; i < count; i++) {
      const v = this.villagers[i];
      if (!v.root.visible) continue;

      if (v.spawnScale < 0.999) {
        v.spawnScale += (1 - v.spawnScale) * Math.min(1, dt * 11.5);
        if (v.spawnScale > 0.995) v.spawnScale = 1;
        v.root.scale.setScalar(v.spawnScale);
      }

      const isHovered = v === this.hoveredVillager;
      const isSelected = v === this.selectedVillager;
      const isKinHighlighted = Boolean(focusKinKey && v.authorKey === focusKinKey);

      if (v.bumpCooldown > 0) v.bumpCooldown = Math.max(0, v.bumpCooldown - dt);
      if (v.yieldTimer > 0) v.yieldTimer = Math.max(0, v.yieldTimer - dt);

      const auraMat = v.auraRing.material as THREE.MeshBasicMaterial;
      const targetOpacity = isSelected
        ? 0.95
        : isHovered
          ? 0.85
          : isKinHighlighted
            ? 0.72
            : 0.28;
      auraMat.opacity += (targetOpacity - auraMat.opacity) * Math.min(1, dt * 10);
      if (isSelected || isKinHighlighted) {
        const pulse = 1 + Math.sin(elapsed * 5) * 0.11;
        v.auraRing.scale.setScalar(pulse);
      } else if (v.parachuteY > 0) {
        // Drop-zone ground target ring grows as the parachutist nears the island!
        const altFrac = Math.min(1, v.parachuteY / 9.5);
        v.auraRing.scale.setScalar(0.42 + (1 - altFrac) * 0.65);
      } else {
        v.auraRing.scale.setScalar(1);
      }

      if (v.emoteTimer > 0) {
        v.emoteTimer -= dt;
        const el = this.emoteElements.get(`c:${v.commit.sha}`);
        if (el) {
          if (v.emoteTimer <= 0) {
            el.hidden = true;
          } else {
            this.projVec.copy(v.root.position);
            this.projVec.y +=
              1.85 + v.jumpY + v.parachuteY + (v.parachuteY > 0 ? 1.05 : 0);
            this.projVec.project(this.camera);
            if (this.projVec.z < 1) {
              el.style.left = `${(this.projVec.x * 0.5 + 0.5) * window.innerWidth}px`;
              el.style.top = `${(-this.projVec.y * 0.5 + 0.5) * window.innerHeight}px`;
              el.hidden = false;
            } else {
              el.hidden = true;
            }
          }
        }
      }

      // Animate post-touchdown canopy furl + expanding celebration landing ring!
      if (v.parachuteFurl > 0) {
        v.parachuteFurl += dt / 0.42;
        const ringMat = v.landingRing.material as THREE.MeshBasicMaterial;
        if (v.parachuteFurl >= 1) {
          v.parachuteFurl = 0;
          v.parachuteGroup.visible = false;
          v.parachuteGroup.position.set(0, 0, 0);
          v.parachuteGroup.scale.setScalar(1);
          v.landingRing.visible = false;
          ringMat.opacity = 0;
        } else {
          const p = v.parachuteFurl;
          const ease = 1 - (1 - p) * (1 - p);
          v.parachuteGroup.scale.set(
            Math.max(0.05, 1 - ease * 0.88),
            1 + ease * 0.28,
            Math.max(0.05, 1 - ease * 0.88),
          );
          v.parachuteGroup.position.y = ease * 0.72;
          v.landingRing.visible = true;
          v.landingRing.scale.setScalar(0.55 + ease * 1.75);
          ringMat.opacity = (1 - p) * 0.88;
        }
      }

      // Airborne Parachute Sky-Drop Descent!
      if (v.parachuteY > 0) {
        this.syncVillagerWorldPosition(v);
        v.parachuteY -= v.parachuteSpeed * dt;

        if (v.parachuteY <= 0) {
          // Touchdown on the floating island! Furl canopy, ripple ring, bounce & chime!
          v.parachuteY = 0;
          v.parachuteSpeed = 0;
          v.parachuteFurl = 0.001;
          v.jumpY = 0;
          v.jumpVelocity = 5.6 * (1 - v.burden * 0.25);
          v.behavior = 'jump_joy';
          v.behaviorTimer = 2.1;
          v.bodyGroup.position.y = 0;
          v.bodyGroup.rotation.z = 0;
          v.parachuteGroup.rotation.z = 0;

          const celebrationEmotes =
            v.commit.kind === 'merge'
              ? ['🎊', '👑', '🎉']
              : ['🎉', '🥳', computeCommitArchetype(v.commit).emoji];
          const pick = celebrationEmotes[i % celebrationEmotes.length];
          this.triggerEmote(`c:${v.commit.sha}`, v, pick, 2.1);
          sound.playCelebrationChime(i, v.commit.kind);
        } else {
          const openScale = Math.min(1, 0.25 + Math.max(0, 9.6 - v.parachuteY) * 0.65);
          v.parachuteGroup.visible = true;
          v.parachuteGroup.scale.setScalar(openScale);

          const pendulum = Math.sin(elapsed * 4.4 + v.phaseOffset) * 0.16;
          const kick = Math.sin(elapsed * 11.5 + v.phaseOffset);
          v.bodyGroup.position.y = v.parachuteY;
          v.bodyGroup.rotation.z = pendulum;
          v.bodyGroup.rotation.x = 0.06;
          v.bodyGroup.rotation.y = Math.sin(elapsed * 1.8 + v.phaseOffset) * 0.35;
          v.parachuteGroup.rotation.z = -pendulum * 0.35;
          v.headGroup.rotation.x = -0.18; // peeking cheerfully down at the island!
          v.leftArm.rotation.x = -2.85;
          v.rightArm.rotation.x = -2.85;
          v.leftLeg.rotation.x = kick * 0.38;
          v.rightLeg.rotation.x = -kick * 0.38;
          v.cargoGroup.position.y = 0.36;
          continue;
        }
      }

      if (v.jumpY > 0 || v.jumpVelocity !== 0) {
        v.jumpY += v.jumpVelocity * dt;
        v.jumpVelocity -= 20.0 * dt;
        if (v.jumpY <= 0) {
          v.jumpY = 0;
          v.jumpVelocity = 0;
        }
      }

      v.behaviorTimer -= dt;
      if (v.behaviorTimer <= 0 && v.behavior !== 'bridge_walk') {
        v.activeBridge = undefined;
        const nearBridgeHead = this.isNearAnyBridgeLanding(v.root.position);
        const roll = Math.random();
        if (nearBridgeHead || roll < 0.56) {
          v.behavior = 'stroll';
          v.behaviorTimer = 3.2 + Math.random() * 4.0;
        } else if (roll < 0.8) {
          v.behavior = 'jump_joy';
          v.behaviorTimer = 2.0 + Math.random() * 2.2;
          const emotes = getRoleMeta(v.commit.kind).defaultEmotes;
          if (Math.random() < 0.45) {
            this.triggerEmote(
              `c:${v.commit.sha}`,
              v,
              emotes[Math.floor(Math.random() * emotes.length)],
              1.8,
            );
          }
        } else if (roll < 0.93) {
          v.behavior = 'tinker';
          v.behaviorTimer = 2.2 + Math.random() * 2.0;
        } else {
          v.behavior = 'spin';
          v.behaviorTimer = 1.4;
          v.jumpVelocity = 6.2;
        }
      }

      // Proactive Social Steering ("Make Way"): anticipate oncoming & stopped neighbors
      const frame = this.getVillagerCurveFrame(v);
      const travelDir = v.behavior === 'bridge_walk' && v.activeBridge ? 1 : v.pathDir;
      const fwdX = frame.tx * travelDir;
      const fwdZ = frame.tz * travelDir;
      let desiredLateral = v.behavior === 'bridge_walk' ? 0 : v.baseLane;
      let speedScale = v.behavior === 'bridge_walk' ? 1.0 : v.yieldTimer > 0 ? 0.18 : 1.0;
      let politeLookPos: THREE.Vector3 | null = null;

      if (!isHovered && v.behavior === 'stroll') {
        for (let j = 0; j < count; j++) {
          if (j === i) continue;
          const other = this.villagers[j];
          if (!other.root.visible) continue;
          if (Math.abs(other.root.position.y - v.root.position.y) > 1.3) continue;

          const toX = other.root.position.x - v.root.position.x;
          const toZ = other.root.position.z - v.root.position.z;
          const distSq = toX * toX + toZ * toZ;
          if (distSq > 6.76 || distSq < 0.0001) continue; // within 2.6 units

          const dist = Math.sqrt(distSq);
          const aheadCos = (toX * fwdX + toZ * fwdZ) / dist;
          if (aheadCos < 0.02) continue;

          const otherLat =
            (other.root.position.x - frame.pt.x) * frame.nx +
            (other.root.position.z - frame.pt.z) * frame.nz;
          const latGap = Math.abs(otherLat - v.lateralOffset);

          if (!other.activeBridge && other.island === v.island) {
            const passClearance = v.collisionRadius + other.collisionRadius + 0.22;
            if (latGap < passClearance) {
              const otherMovingOpposite =
                other.behavior === 'stroll' && other.pathDir !== v.pathDir;

              if (otherMovingOpposite) {
                // Keep-to-own-right passing lane!
                desiredLateral = Math.max(
                  -frame.maxLat,
                  Math.min(frame.maxLat, v.pathDir * Math.max(0.68, passClearance * 0.65)),
                );
              } else {
                // Overtake / step around stationary or slower neighbor on whichever side has deck room
                const plusCand = otherLat + passClearance;
                const minusCand = otherLat - passClearance;
                const plusValid = plusCand <= frame.maxLat + 0.05;
                const minusValid = minusCand >= -frame.maxLat - 0.05;

                if (plusValid && minusValid) {
                  desiredLateral =
                    Math.abs(plusCand - v.lateralOffset) <= Math.abs(minusCand - v.lateralOffset)
                      ? plusCand
                      : minusCand;
                } else if (plusValid) {
                  desiredLateral = plusCand;
                } else if (minusValid) {
                  desiredLateral = minusCand;
                } else {
                  desiredLateral = otherLat >= 0 ? -frame.maxLat : frame.maxLat;
                }
                desiredLateral = Math.max(-frame.maxLat, Math.min(frame.maxLat, desiredLateral));
              }

              if (dist < 1.35 && latGap < passClearance * 0.72) {
                const shouldYield =
                  other !== this.hoveredVillager &&
                  other.behavior === 'stroll' &&
                  (v.burden < other.burden - 0.02 ||
                    (Math.abs(v.burden - other.burden) <= 0.02 && i > j));
                speedScale = Math.min(speedScale, shouldYield ? 0.22 : 0.58);
                if (shouldYield) politeLookPos = other.root.position;
              }
            }
          }
        }

        // Also politely step aside for the player's Explorer avatar in Walk mode!
        if (this.cameraMode === 'walk') {
          const exPos = this.explorer.root.position;
          if (Math.abs(exPos.y - v.root.position.y) < 1.3) {
            const toExX = exPos.x - v.root.position.x;
            const toExZ = exPos.z - v.root.position.z;
            const dEx = Math.hypot(toExX, toExZ);
            if (dEx < 2.2) {
              const exLat =
                (exPos.x - frame.pt.x) * frame.nx + (exPos.z - frame.pt.z) * frame.nz;
              const side = exLat >= v.lateralOffset ? -1 : 1;
              desiredLateral = Math.max(
                -frame.maxLat,
                Math.min(frame.maxLat, exLat + side * (v.collisionRadius + 0.68)),
              );
              if (dEx < 1.35) {
                speedScale = Math.min(speedScale, 0.2);
                politeLookPos = exPos;
              }
            }
          }
        }
      }

      const prevX = v.root.position.x;
      const prevZ = v.root.position.z;

      // Smoothly steer lateralOffset toward desired passing lane (or centerline on stairs)
      const steerRate = v.behavior === 'bridge_walk' ? 7.2 : v.behavior === 'stroll' ? 5.4 : 2.6;
      v.lateralOffset += (desiredLateral - v.lateralOffset) * Math.min(1, dt * steerRate);

      if (v.behavior === 'bridge_walk' && v.activeBridge) {
        const br = v.activeBridge;
        const curveLen = Math.max(5, br.curve.getLength());
        const linearSpeed = 1.85 * (1 - v.burden * 0.16);
        br.t += (linearSpeed / curveLen) * dt;

        if (br.t >= 1) {
          const prevEndWorldX = v.root.position.x;
          const prevEndWorldZ = v.root.position.z;
          v.island = br.toIsland;
          v.pathT = Math.max(0.05, Math.min(0.95, br.bridge.exitPathT));
          // Continue walking forward along chronological commit flow after climbing/merging!
          v.pathDir = v.pathT > 0.84 ? -1 : 1;
          this.bridgeFreeAt.set(br.bridge, elapsed + 5.2);
          v.activeBridge = undefined;
          v.behavior = 'stroll';
          v.behaviorTimer = 3.8 + Math.random() * 3.0;

          const destFrame = this.getVillagerCurveFrame(v);
          v.lateralOffset = Math.max(
            -destFrame.maxLat,
            Math.min(
              destFrame.maxLat,
              (prevEndWorldX - destFrame.pt.x) * destFrame.nx +
                (prevEndWorldZ - destFrame.pt.z) * destFrame.nz,
            ),
          );
          this.syncVillagerWorldPosition(v);
        } else {
          this.syncVillagerWorldPosition(v);
          const moveDx = v.root.position.x - prevX;
          const moveDz = v.root.position.z - prevZ;
          const moveDist = Math.hypot(moveDx, moveDz);

          if (moveDist > 0.001) {
            v.bodyGroup.rotation.y = this.rotateYawSmoothly(
              v.bodyGroup.rotation.y,
              Math.atan2(moveDx, moveDz),
              dt * 10,
            );
          }

          const slopeY = br.curve.getTangentAt(Math.min(1, br.t)).y;
          const isClimbingUp = slopeY > 0.04;
          const walkCycle = elapsed * (isClimbingUp ? 10.8 : 9.6) + v.phaseOffset;
          const kneeAmp = isClimbingUp ? 0.74 : 0.58;
          v.leftLeg.rotation.x = Math.sin(walkCycle) * kneeAmp;
          v.rightLeg.rotation.x = -Math.sin(walkCycle) * kneeAmp;
          v.leftArm.rotation.x = -Math.sin(walkCycle) * 0.52;
          v.rightArm.rotation.x = isHovered
            ? -2.2 + Math.sin(elapsed * 12) * 0.45
            : Math.sin(walkCycle) * 0.52;
          v.jumpY = Math.abs(Math.sin(walkCycle)) * (isClimbingUp ? 0.12 : 0.075);
        }
      } else if (isHovered) {
        this.syncVillagerWorldPosition(v);
        const dx = this.camera.position.x - v.root.position.x;
        const dz = this.camera.position.z - v.root.position.z;
        v.bodyGroup.rotation.y = this.rotateYawSmoothly(
          v.bodyGroup.rotation.y,
          Math.atan2(dx, dz),
          dt * 10,
        );
        v.rightArm.rotation.x = -2.2 + Math.sin(elapsed * 12) * 0.45;
        v.leftArm.rotation.x = Math.sin(elapsed * 5) * 0.15;
        if (v.jumpY === 0 && Math.random() < dt * 2.2) {
          v.jumpVelocity = 4.6;
        }
      } else if (v.behavior === 'stroll') {
        const prevPathT = v.pathT;
        v.pathT += v.pathDir * v.speed * speedScale * dt;
        if (v.pathT > 0.95) {
          v.pathT = 0.95;
          v.pathDir = -1;
        } else if (v.pathT < 0.05) {
          v.pathT = 0.05;
          v.pathDir = 1;
        }

        if (!this.tryEnterOneWayBridge(v, prevPathT, v.pathT, elapsed)) {
          this.syncVillagerWorldPosition(v);
          const moveDx = v.root.position.x - prevX;
          const moveDz = v.root.position.z - prevZ;
          const moveDist = Math.hypot(moveDx, moveDz);

          if (moveDist > 0.0025) {
            v.bodyGroup.rotation.y = this.rotateYawSmoothly(
              v.bodyGroup.rotation.y,
              Math.atan2(moveDx, moveDz),
              dt * 8.5,
            );
          } else if (politeLookPos) {
            v.bodyGroup.rotation.y = this.rotateYawSmoothly(
              v.bodyGroup.rotation.y,
              Math.atan2(politeLookPos.x - v.root.position.x, politeLookPos.z - v.root.position.z),
              dt * 7,
            );
          }

          const strideAmp = Math.min(1, 0.18 + speedScale * 0.82);
          const cycle = elapsed * 8.5 + v.phaseOffset;
          v.leftLeg.rotation.x = Math.sin(cycle) * 0.6 * strideAmp;
          v.rightLeg.rotation.x = -Math.sin(cycle) * 0.6 * strideAmp;
          v.leftArm.rotation.x = -Math.sin(cycle) * 0.45 * strideAmp;
          v.rightArm.rotation.x = Math.sin(cycle) * 0.45 * strideAmp;
          if (v.jumpY === 0) {
            v.bodyGroup.position.y = Math.abs(Math.sin(cycle)) * 0.11 * strideAmp;
          }
        }
      } else if (v.behavior === 'jump_joy') {
        this.syncVillagerWorldPosition(v);
        if (v.jumpY === 0) {
          v.jumpVelocity = (5.6 + (v.commit.kind === 'feat' ? 1.2 : 0)) * (1 - v.burden * 0.34);
        }
        v.leftLeg.rotation.x = v.jumpY > 0.1 ? -0.35 : 0;
        v.rightLeg.rotation.x = v.jumpY > 0.1 ? 0.35 : 0;
        v.leftArm.rotation.x = -2.3 + Math.sin(elapsed * 14 + v.phaseOffset) * 0.35;
        v.rightArm.rotation.x = -2.3 - Math.sin(elapsed * 14 + v.phaseOffset) * 0.35;
      } else if (v.behavior === 'tinker') {
        this.syncVillagerWorldPosition(v);
        const swing = Math.sin(elapsed * 11 + v.phaseOffset);
        v.rightArm.rotation.x = -0.9 + swing * 0.75;
        v.leftArm.rotation.x = -0.3 - swing * 0.2;
        v.leftLeg.rotation.x = 0;
        v.rightLeg.rotation.x = 0;
      } else if (v.behavior === 'spin') {
        this.syncVillagerWorldPosition(v);
        v.bodyGroup.rotation.y += dt * 9.5;
        v.leftArm.rotation.x = -2.5;
        v.rightArm.rotation.x = -2.5;
      }

      // Apply & decay soft-body bump knockback velocity along walkable surface
      if (Math.abs(v.bumpVelX) > 0.005 || Math.abs(v.bumpVelZ) > 0.005) {
        this.displaceVillagerOnSurface(v, v.bumpVelX * dt, v.bumpVelZ * dt);
        const damp = Math.exp(-8.5 * dt);
        v.bumpVelX *= damp;
        v.bumpVelZ *= damp;
      } else {
        v.bumpVelX = 0;
        v.bumpVelZ = 0;
      }

      // Decay upper-body bump tilt spring
      const tiltDamp = Math.exp(-9.5 * dt);
      v.bumpTiltX *= tiltDamp;
      v.bumpTiltZ *= tiltDamp;

      if (v.jumpY > 0) {
        v.bodyGroup.position.y = v.jumpY;
      }

      const swayCycle = elapsed * (7.8 - v.burden * 2.2) + v.phaseOffset;
      const carrierLean = isHovered ? v.burden * 0.08 : v.burden * 0.24;
      const politeNod = v.yieldTimer > 0 ? 0.12 * Math.sin(v.yieldTimer * Math.PI * 2.2) : 0;
      v.bodyGroup.rotation.x = carrierLean + v.bumpTiltX;
      v.bodyGroup.rotation.z = v.bumpTiltZ;
      v.headGroup.rotation.x =
        v.behavior === 'tinker'
          ? Math.sin(elapsed * 5.5) * 0.14 - carrierLean * 0.5 + politeNod
          : -carrierLean * 0.55 + politeNod;
      v.cargoGroup.rotation.z =
        Math.sin(swayCycle) * (0.03 + v.burden * 0.13) - v.bumpTiltZ * 0.85;
      v.cargoGroup.rotation.x = Math.abs(Math.cos(swayCycle)) * (v.burden * 0.055);
      v.cargoGroup.position.y = 0.36 + Math.min(0.1, v.jumpY * 0.12);
    }
  }

  private resolveCharacterCollisions(dt: number, silent = false): void {
    const count = this.villagers.length;
    const passes = silent ? 2 : 3;

    for (let pass = 0; pass < passes; pass++) {
      // 1. Villager <-> Villager solid body separation + bump & sidestep response
      for (let i = 0; i < count; i++) {
        const a = this.villagers[i];
        if (!a.root.visible || a.parachuteY > 0) continue;
        for (let j = i + 1; j < count; j++) {
          const b = this.villagers[j];
          if (!b.root.visible || b.parachuteY > 0) continue;
          if (Math.abs(a.root.position.y - b.root.position.y) > 1.25) continue;

          const bothOnBridge =
            a.behavior === 'bridge_walk' &&
            b.behavior === 'bridge_walk' &&
            a.activeBridge?.curve === b.activeBridge?.curve;
          const rA = bothOnBridge ? 0.35 : a.collisionRadius;
          const rB = bothOnBridge ? 0.35 : b.collisionRadius;
          const minSep = rA + rB;

          const dx = b.root.position.x - a.root.position.x;
          const dz = b.root.position.z - a.root.position.z;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minSep * minSep) continue;

          const dist = Math.sqrt(distSq);
          let ux: number;
          let uz: number;
          if (dist > 0.0001) {
            ux = dx / dist;
            uz = dz / dist;
          } else {
            const fallbackAngle = ((i * 7 + j * 13) % 12) * ((Math.PI * 2) / 12);
            ux = Math.cos(fallbackAngle);
            uz = Math.sin(fallbackAngle);
          }

          const overlap = minSep - dist;

          // Weight separation by inverse mass (bridge crossers, heavy-cargo & hovered villagers hold right-of-way!)
          const massA =
            a === this.hoveredVillager
              ? 4.5
              : a.behavior === 'bridge_walk'
                ? 4.0
                : 1 + a.burden * 1.35;
          const massB =
            b === this.hoveredVillager
              ? 4.5
              : b.behavior === 'bridge_walk'
                ? 4.0
                : 1 + b.burden * 1.35;
          const invA = 1 / massA;
          const invB = 1 / massB;
          const invSum = invA + invB;
          const shareA = (overlap * (invA / invSum)) + 0.002;
          const shareB = (overlap * (invB / invSum)) + 0.002;

          // Tactile shoulder bump + tangential sidestep ("bump and make way") on initial contact
          if (!silent && pass === 0 && dt > 0 && overlap > 0.012 && a.bumpCooldown <= 0 && b.bumpCooldown <= 0) {
            // Tangential sidestep perpendicular to collision normal so head-on bumps step around each other!
            const sideX = -uz;
            const sideZ = ux;
            const bumpStrength = 1.45;

            a.bumpVelX -= (ux * 0.72 - sideX * 0.68) * bumpStrength * (invA / invSum) * 2;
            a.bumpVelZ -= (uz * 0.72 - sideZ * 0.68) * bumpStrength * (invA / invSum) * 2;
            b.bumpVelX += (ux * 0.72 - sideX * 0.68) * bumpStrength * (invB / invSum) * 2;
            b.bumpVelZ += (uz * 0.72 - sideZ * 0.68) * bumpStrength * (invB / invSum) * 2;

            // Expressive torso & cargo jolt away from contact
            a.bumpTiltZ = Math.max(-0.24, Math.min(0.24, ux * 0.2));
            a.bumpTiltX = Math.max(-0.2, Math.min(0.2, -uz * 0.16));
            b.bumpTiltZ = Math.max(-0.24, Math.min(0.24, -ux * 0.2));
            b.bumpTiltX = Math.max(-0.2, Math.min(0.2, uz * 0.16));

            if (a.jumpY === 0 && a !== this.hoveredVillager) a.jumpVelocity = 2.4;
            if (b.jumpY === 0 && b !== this.hoveredVillager) b.jumpVelocity = 2.4;

            a.bumpCooldown = 0.9;
            b.bumpCooldown = 0.9;

            // Lighter-burden citizen politely pauses to make way for the heavier carrier
            if (massA <= massB) {
              a.yieldTimer = 0.48;
            } else {
              b.yieldTimer = 0.48;
            }

            if (a.root.position.distanceToSquared(this.camera.position) < 484) {
              sound.playBump();
            }
            if (a.emoteTimer <= 0 && b.emoteTimer <= 0 && Math.random() < 0.22) {
              const politeTarget = massA <= massB ? a : b;
              this.triggerEmote(`c:${politeTarget.commit.sha}`, politeTarget, '👋', 1.3);
            }
          }

          this.displaceVillagerOnSurface(a, -ux * shareA, -uz * shareA);
          this.displaceVillagerOnSurface(b, ux * shareB, uz * shareB);
        }
      }

      // 2. GateVisitor <-> GateVisitor & GateVisitor <-> Villager separation (e.g. during Gate Open rush)
      const gvCount = this.gateVisitors.length;
      for (let i = 0; i < gvCount; i++) {
        const ga = this.gateVisitors[i];
        for (let j = i + 1; j < gvCount; j++) {
          const gb = this.gateVisitors[j];
          const dx = gb.root.position.x - ga.root.position.x;
          const dz = gb.root.position.z - ga.root.position.z;
          const minSep = 0.82;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minSep * minSep || distSq < 0.00001) continue;
          const dist = Math.sqrt(distSq);
          const push = (minSep - dist) * 0.5;
          const ux = dx / dist;
          const uz = dz / dist;
          ga.root.position.x -= ux * push;
          ga.root.position.z -= uz * push;
          gb.root.position.x += ux * push;
          gb.root.position.z += uz * push;
        }

        for (let k = 0; k < count; k++) {
          const v = this.villagers[k];
          if (Math.abs(v.root.position.y - ga.root.position.y) > 1.25) continue;
          const dx = v.root.position.x - ga.root.position.x;
          const dz = v.root.position.z - ga.root.position.z;
          const minSep = 0.44 + v.collisionRadius;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minSep * minSep || distSq < 0.00001) continue;
          const dist = Math.sqrt(distSq);
          const overlap = minSep - dist;
          const ux = dx / dist;
          const uz = dz / dist;
          ga.root.position.x -= ux * overlap * 0.4;
          ga.root.position.z -= uz * overlap * 0.4;
          this.displaceVillagerOnSurface(v, ux * overlap * 0.6, uz * overlap * 0.6);
        }
      }

      // 3. Walk-Mode Explorer <-> Villagers & GateVisitors (villagers bump & step aside for you!)
      if (!silent && this.cameraMode === 'walk') {
        const exPos = this.explorer.root.position;
        const exRadius = 0.46;

        for (let i = 0; i < count; i++) {
          const v = this.villagers[i];
          if (Math.abs(v.root.position.y - exPos.y) > 1.25) continue;
          const minSep = exRadius + v.collisionRadius;
          const dx = v.root.position.x - exPos.x;
          const dz = v.root.position.z - exPos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minSep * minSep || distSq < 0.00001) continue;

          const dist = Math.sqrt(distSq);
          const ux = dx / dist;
          const uz = dz / dist;
          const overlap = minSep - dist;

          // Villager yields 70%, Explorer yields 30%
          this.displaceVillagerOnSurface(v, ux * overlap * 0.72, uz * overlap * 0.72);
          const candX = exPos.x - ux * overlap * 0.28;
          const candZ = exPos.z - uz * overlap * 0.28;
          if (this.sampleWalkableSurfaceY(candX, candZ, exPos.y) !== null) {
            const dExX = candX - exPos.x;
            const dExZ = candZ - exPos.z;
            exPos.x = candX;
            exPos.z = candZ;
            this.camera.position.x += dExX;
            this.camera.position.z += dExZ;
            this.controls.target.x += dExX;
            this.controls.target.z += dExZ;
          }

          if (pass === 0 && v.bumpCooldown <= 0) {
            v.bumpVelX += (ux * 0.8 - uz * 0.6) * 1.4;
            v.bumpVelZ += (uz * 0.8 + ux * 0.6) * 1.4;
            v.bumpTiltZ = Math.max(-0.24, Math.min(0.24, -ux * 0.2));
            v.bumpTiltX = Math.max(-0.2, Math.min(0.2, uz * 0.16));
            if (v.jumpY === 0) v.jumpVelocity = 2.6;
            v.bumpCooldown = 0.85;
            v.yieldTimer = 0.65;
            sound.playBump();
            if (v.emoteTimer <= 0) {
              this.triggerEmote(`c:${v.commit.sha}`, v, '👋', 1.4);
            }
          }
        }
      }
    }
  }

  private updateExplorerWalk(dt: number, elapsed: number): void {
    if (this.cameraMode !== 'walk') return;

    this.camera.getWorldDirection(this.forwardVec);
    this.forwardVec.y = 0;
    if (this.forwardVec.lengthSq() > 0.0001) this.forwardVec.normalize();
    this.rightVec.crossVectors(this.forwardVec, new THREE.Vector3(0, 1, 0)).normalize();

    let moveX = 0;
    let moveZ = 0;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
      moveX += this.forwardVec.x;
      moveZ += this.forwardVec.z;
    }
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
      moveX -= this.forwardVec.x;
      moveZ -= this.forwardVec.z;
    }
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
      moveX += this.rightVec.x;
      moveZ += this.rightVec.z;
    }
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
      moveX -= this.rightVec.x;
      moveZ -= this.rightVec.z;
    }

    const len = Math.hypot(moveX, moveZ);
    const walkSpeed = 6.8;
    const movedDelta = new THREE.Vector3();

    if (len > 0.01) {
      moveX = (moveX / len) * walkSpeed * dt;
      moveZ = (moveZ / len) * walkSpeed * dt;
      const candX = this.explorer.root.position.x + moveX;
      const candZ = this.explorer.root.position.z + moveZ;
      const surfaceY = this.sampleWalkableSurfaceY(candX, candZ, this.explorer.root.position.y);

      if (surfaceY !== null) {
        movedDelta.set(
          candX - this.explorer.root.position.x,
          0,
          candZ - this.explorer.root.position.z,
        );
        this.explorer.root.position.x = candX;
        this.explorer.root.position.z = candZ;
        if (this.explorerVelocity.grounded) {
          const prevY = this.explorer.root.position.y;
          this.explorer.root.position.y += (surfaceY - prevY) * Math.min(1, dt * 16);
          movedDelta.y = this.explorer.root.position.y - prevY;
        }
      }

      this.explorer.bodyGroup.rotation.y = Math.atan2(moveX, moveZ);
      const cyc = elapsed * 12;
      this.explorer.leftLeg.rotation.x = Math.sin(cyc) * 0.7;
      this.explorer.rightLeg.rotation.x = -Math.sin(cyc) * 0.7;
      this.explorer.leftArm.rotation.x = -Math.sin(cyc) * 0.55;
      this.explorer.rightArm.rotation.x = Math.sin(cyc) * 0.55;
    } else {
      this.explorer.leftLeg.rotation.x = 0;
      this.explorer.rightLeg.rotation.x = 0;
      this.explorer.leftArm.rotation.x = 0;
      this.explorer.rightArm.rotation.x = 0;
    }

    if (!this.explorerVelocity.grounded) {
      const prevY = this.explorer.root.position.y;
      this.explorer.root.position.y += this.explorerVelocity.y * dt;
      this.explorerVelocity.y -= 20.0 * dt;
      const floorY =
        this.sampleWalkableSurfaceY(
          this.explorer.root.position.x,
          this.explorer.root.position.z,
          this.explorer.root.position.y,
        ) ?? 0;
      if (this.explorer.root.position.y <= floorY) {
        this.explorer.root.position.y = floorY;
        this.explorerVelocity.y = 0;
        this.explorerVelocity.grounded = true;
      }
      movedDelta.y = this.explorer.root.position.y - prevY;
    }

    this.camera.position.add(movedDelta);
    this.controls.target.set(
      this.explorer.root.position.x,
      this.explorer.root.position.y + 1.05,
      this.explorer.root.position.z,
    );
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = window.requestAnimationFrame(this.animate);
    const dt = Math.max(0, Math.min(0.05, this.clock.getDelta()));
    const elapsed = this.clock.elapsedTime;

    if (this.builtWorld) {
      for (const blade of this.builtWorld.animatedProps.windmillBlades) {
        blade.rotation.z -= dt * 0.85;
      }
      for (const cr of this.builtWorld.animatedProps.floatingCrystals) {
        cr.mesh.position.y = cr.baseY + Math.sin(elapsed * 1.8 + cr.phase) * 0.22;
        cr.mesh.rotation.y += dt * 0.7;
      }
      for (const cl of this.builtWorld.animatedProps.clouds) {
        cl.mesh.position.x += cl.speed * dt;
        if (cl.mesh.position.x > 55) cl.mesh.position.x = -55;
      }
      if (this.builtWorld.animatedProps.headBeacon) {
        this.builtWorld.animatedProps.headBeacon.rotation.y += dt * 1.4;
        this.builtWorld.animatedProps.headBeacon.position.y =
          1.55 + Math.sin(elapsed * 2.6) * 0.16;
      }
      for (const rift of this.builtWorld.animatedProps.conflictRifts) {
        rift.rotation.y += dt * 2.8;
        rift.position.y = 0.72 + Math.sin(elapsed * 4.2) * 0.14;
      }
      if (this.builtWorld.animatedProps.conflictGateBarrier && this.conflictRepairProgress === 0) {
        const pulse = 1 + Math.sin(elapsed * 6.0) * 0.05;
        this.builtWorld.animatedProps.conflictGateBarrier.scale.setScalar(pulse);
      }
      if (this.conflictRepairProgress > 0 && this.conflictRepairProgress < 1) {
        this.conflictRepairProgress = Math.min(1, this.conflictRepairProgress + dt * 1.15);
        const t = this.conflictRepairProgress;
        const ease = 1 - Math.pow(1 - t, 3);

        for (const br of this.builtWorld.bridges) {
          if (br.conflictRiftGroup) {
            const shrink = Math.max(0.001, 1 - ease);
            br.conflictRiftGroup.scale.setScalar(shrink);
            if (t >= 1) br.conflictRiftGroup.visible = false;
          }
          if (br.brokenPlanks) {
            for (const bp of br.brokenPlanks) {
              bp.mesh.position.lerpVectors(bp.brokenPos, bp.healedPos, ease);
              bp.mesh.rotation.set(
                bp.brokenRot.x + (bp.healedRot.x - bp.brokenRot.x) * ease,
                bp.brokenRot.y + (bp.healedRot.y - bp.brokenRot.y) * ease,
                bp.brokenRot.z + (bp.healedRot.z - bp.brokenRot.z) * ease,
              );
              if (bp.hiddenWhenBroken) {
                bp.mesh.scale.setScalar(Math.max(0.001, ease));
              }
            }
          }
        }
        if (this.builtWorld.animatedProps.conflictGateBarrier) {
          const shrink = Math.max(0.001, 1 - ease);
          this.builtWorld.animatedProps.conflictGateBarrier.scale.setScalar(shrink);
          if (t >= 1) this.builtWorld.animatedProps.conflictGateBarrier.visible = false;
        }
      }
      if (this.builtWorld.animatedProps.fireflies) {
        this.builtWorld.animatedProps.fireflies.rotation.y = Math.sin(elapsed * 0.12) * 0.15;
      }
      if (this.builtWorld.animatedProps.forgeEmbers) {
        const eAttr = this.builtWorld.animatedProps.forgeEmbers.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute;
        const eArr = eAttr.array as Float32Array;
        for (let i = 0; i < eArr.length; i += 3) {
          eArr[i + 1] += dt * 1.45;
          if (eArr[i + 1] > 3.6) {
            eArr[i + 1] = 0.78;
          }
        }
        eAttr.needsUpdate = true;
      }
      for (const [sIdx, chest] of this.builtWorld.stashChests.entries()) {
        const isOpen = this.openedStashIndices.has(sIdx) || this.selectedStash?.index === sIdx;
        const targetLid = isOpen ? -1.18 : 0;
        chest.lidPivot.rotation.x += (targetLid - chest.lidPivot.rotation.x) * Math.min(1, dt * 8);
        if (chest.glowMesh.visible) {
          chest.glowMesh.rotation.y += dt * 3.2;
          chest.glowMesh.position.y = 0.56 + Math.sin(elapsed * 4.5 + sIdx) * 0.08;
        }
      }
      const activeTwinSha = (this.hoveredVillager ?? this.selectedVillager)?.commit.sha;
      for (const arc of this.builtWorld.cherryPickArcs) {
        const mat = arc.mesh.material as THREE.MeshBasicMaterial;
        const highlighted = activeTwinSha === arc.fromSha || activeTwinSha === arc.toSha;
        mat.opacity = highlighted ? 0.88 : 0.34 + Math.sin(elapsed * 3.2) * 0.08;
      }
      for (const v of this.villagers) {
        if (v.portalRing) {
          v.portalRing.rotation.z += dt * 2.2;
        }
        if (v.commit.isGhost && v.jumpY === 0) {
          v.bodyGroup.position.y = 0.18 + Math.sin(elapsed * 2.8 + v.phaseOffset) * 0.12;
        }
      }
      if (this.timeOfDay === 'storm' && this.builtWorld.animatedProps.stormGroup) {
        const rain = this.builtWorld.animatedProps.rainLines;
        if (rain) {
          const attr = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
          const arr = attr.array as Float32Array;
          const fall = dt * 26.0;
          const windX = dt * 4.8;
          for (let i = 0; i < arr.length; i += 6) {
            arr[i] -= windX;
            arr[i + 1] -= fall;
            arr[i + 3] -= windX;
            arr[i + 4] -= fall;
            if (arr[i + 1] < -5) {
              const resetY = 18 + Math.random() * 4;
              arr[i + 1] = resetY;
              arr[i + 4] = resetY - 1.15;
              if (arr[i] < -40) {
                arr[i] += 80;
                arr[i + 3] += 80;
              }
            }
          }
          attr.needsUpdate = true;
        }

        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.lightningFlash = 1.0;
          this.lightningTimer = 4.2 + Math.random() * 4.8;
        }
        if (this.lightningFlash > 0) {
          this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5.2);
          this.dirLight.intensity = 0.85 + this.lightningFlash * 2.6;
          if (this.builtWorld.animatedProps.lightningBolt) {
            const boltMat = this.builtWorld.animatedProps.lightningBolt
              .material as THREE.MeshBasicMaterial;
            boltMat.opacity = this.lightningFlash * 0.95;
          }
        }
      }
    }

    this.stepTimeLapse(dt);
    this.updateVillagers(dt, elapsed);
    this.updateGateAndVisitors(dt, elapsed);
    this.updateExplorerWalk(dt, elapsed);
    this.resolveCharacterCollisions(dt, false);

    if (this.builtHeatmapWorld) {
      const hw = this.builtHeatmapWorld;
      if (this.heatmapWave.active) {
        this.heatmapWave.elapsed += dt;
        const dur = Math.max(0.6, this.heatmapWave.duration);
        const spread = dur * 0.68;
        const riseWindow = dur * 0.32;
        const maxWeek = Math.max(1, (this.activeHeatmap?.weeks.length ?? 53) - 1);

        for (const tw of hw.towers) {
          const delay = (tw.weekIndex / maxWeek) * spread;
          const rawT = (this.heatmapWave.elapsed - delay) / riseWindow;
          const clamped = Math.max(0, Math.min(1, rawT));
          // Elastic-feeling easeOutBack spring!
          const c1 = 1.55;
          const c3 = c1 + 1;
          const eased =
            clamped <= 0
              ? 0.05
              : clamped >= 1
                ? 1
                : Math.max(0.05, 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2));
          const h = Math.max(0.05, tw.targetHeight * eased);
          tw.columnMesh.scale.y = h;
          tw.capMesh.position.y = h + 0.035;
          if (tw.isPeak && hw.peakBeacon) {
            hw.peakBeacon.position.y = h + 0.08;
          }
        }
        if (this.heatmapWave.elapsed >= dur + 0.15) {
          this.heatmapWave.active = false;
        }
      }

      for (const cr of hw.floatingCrystals) {
        cr.mesh.position.y = cr.baseY + Math.sin(elapsed * 1.9 + cr.phase) * 0.32;
        cr.mesh.rotation.y += dt * 0.85;
      }
      for (const cl of hw.clouds) {
        cl.mesh.position.x += cl.speed * dt;
        if (cl.mesh.position.x > 26) cl.mesh.position.x = -26;
      }
      if (hw.mascotArm) {
        hw.mascotArm.rotation.z = -0.35 + Math.sin(elapsed * 5.2) * 0.28;
      }
      if (hw.peakBeacon) {
        const gem = hw.peakBeacon.children[1];
        if (gem) {
          gem.rotation.y += dt * 1.6;
          gem.position.y = 1.48 + Math.sin(elapsed * 3.1) * 0.1;
        }
      }
    }

    if (this.turntableOrbit.active && this.cameraMode === 'orbit') {
      this.turntableOrbit.elapsed += dt;
      const t = Math.min(1, this.turntableOrbit.elapsed / Math.max(0.5, this.turntableOrbit.duration));
      // Smooth front-side sweeping hero arc (-0.72 rad -> +0.86 rad) so signs & villagers stay camera-facing!
      const angle = -0.72 + t * 1.58;
      const elevWave = Math.sin(t * Math.PI) * 1.6;
      this.controls.target.lerp(this.turntableOrbit.lookAt, Math.min(1, dt * 8));
      this.camera.position.set(
        this.turntableOrbit.lookAt.x + Math.sin(angle) * this.turntableOrbit.radius,
        this.turntableOrbit.height + elevWave,
        this.turntableOrbit.lookAt.z + Math.cos(angle) * this.turntableOrbit.radius,
      );
      if (t >= 1) {
        this.turntableOrbit.active = false;
      }
    } else if (this.followVillager && this.selectedVillager && this.cameraMode === 'orbit') {
      const targetLook = this.selectedVillager.root.position
        .clone()
        .add(new THREE.Vector3(0.8, 1.0, 0));
      const delta = targetLook.clone().sub(this.controls.target);
      this.controls.target.addScaledVector(delta, Math.min(1, dt * 6));
      this.camera.position.addScaledVector(delta, Math.min(1, dt * 6));
    } else if (this.cameraFlight.active && this.cameraMode === 'orbit') {
      this.controls.target.lerp(this.cameraFlight.targetLook, Math.min(1, dt * 5.2));
      this.camera.position.lerp(this.cameraFlight.targetPos, Math.min(1, dt * 4.5));
      if (
        this.camera.position.distanceTo(this.cameraFlight.targetPos) < 0.15 &&
        this.controls.target.distanceTo(this.cameraFlight.targetLook) < 0.1
      ) {
        this.cameraFlight.active = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private exposeDirectorHooks(): void {
    const self = this;
    (window as unknown as { __village: unknown }).__village = {
      THREE,
      camera: this.camera,
      controls: this.controls,
      get villagers() {
        return self.villagers;
      },
      get gateVisitors() {
        return self.gateVisitors;
      },
      get clanMap() {
        return self.clanMap;
      },
      get builtWorld() {
        return self.builtWorld;
      },
      get activeGraph() {
        return self.activeGraph;
      },
      get activeHeatmap() {
        return self.activeHeatmap;
      },
      get builtHeatmapWorld() {
        return self.builtHeatmapWorld;
      },
      get bisectState() {
        return self.bisectState;
      },
      keysPressed: this.keysPressed,
      explorer: this.explorer,
      loadUserHeatmap: (
        u: string,
        opts?: { year?: number | null; theme?: string | null; updateUrl?: boolean },
      ) => self.loadUserHeatmap(u, opts),
      setHeatmapTheme: (t: HeatmapTheme) => self.setHeatmapTheme(t),
      replayHeatmapWave: (d?: number) => self.replayHeatmapWave(d),
      exitHeatmapMode: () => self.exitHeatmapMode(),
      focusHeatmapTower: (tw: BuiltHeatmapTower) => self.focusHeatmapTower(tw),
      startAcademy: (ch = 1) => self.startAcademy(ch, 'cta', true),
      runAcademyGuidedStep: () => self.runAcademyGuidedStep(),
      submitAcademyCliCommand: (cmd: string) => self.submitAcademyCliCommand(cmd),
      resetAcademyChapter: () => self.resetAcademyChapter(),
      exitAcademy: () => self.exitAcademy(),
      focusOnVillager: (v: VillagerEntity, play = true) => self.focusOnVillager(v, play),
      focusVillagerBySha: (s: string) => self.focusVillagerBySha(s),
      focusOnGateVisitor: (gv: GateVisitorEntity, play = true, move = true) =>
        self.focusOnGateVisitor(gv, play, move),
      flyToOverview: () => self.flyToOverview(),
      flyToGate: (sel = true) => self.flyToGate(sel),
      flyToConflictZone: (sel = true) => self.flyToConflictZone(sel),
      loadConflictDemo: (u = false) => self.loadConflictDemo(u),
      resolveSimulatedConflict: () => self.resolveSimulatedConflict(),
      setXRayLens: (l: XRayLens) => self.setXRayLens(l),
      flyToGhostRuins: () => self.flyToGhostRuins(),
      focusStashByIndex: (i: number) => self.focusStashByIndex(i),
      focusLandmarkByIndex: (i: number) => self.focusLandmarkByIndex(i),
      startBisect: () => self.startBisect(),
      stepBisectVerdict: (v: 'good' | 'bad') => self.stepBisectVerdict(v),
      stopBisect: () => self.stopBisect(),
      triggerRebaseVsMergeDemo: (m: 'rebase' | 'merge') => self.triggerRebaseVsMergeDemo(m),
      applyAtmosphere: (m: TimeOfDay) => self.applyAtmosphere(m),
      setCameraMode: (m: CameraMode) => self.setCameraMode(m),
      triggerGatePreviewOpen: () => self.triggerGatePreviewOpen(),
      loadLocalRepo: (p: string, u = true, b?: string) => self.loadLocalRepo(p, u, b),
      loadRepoBySpec: (s: string, u = true, b?: string) => self.loadRepoBySpec(s, u, b),
      switchBranch: (b: string) => self.switchBranch(b),
      getCargo: (v: VillagerEntity | CommitData) =>
        getCommitCargoMetrics('commit' in v ? v.commit : v),
      setActiveAuthor(key: string | null) {
        self.activeAuthorKey = key;
        self.applyVillagerFilterBeams();
        self.emit();
      },
      stopFlight() {
        self.cameraFlight.active = false;
        self.followVillager = false;
      },
      closeInspector: () => self.closeInspector(),
    };
  }
}
