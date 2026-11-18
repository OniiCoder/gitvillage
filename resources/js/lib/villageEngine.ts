import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  type BrowserRepoSource,
  loadBrowserGitRepoVillage,
} from '@/lib/browserGitReader';
import { createDemoRepoGraph } from '@/lib/demoRepo';
import { hydrateCommitDetail, loadGitHubRepoVillage, parseRepoInput } from '@/lib/githubLoader';
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
import { type BuiltWorld, buildVillageWorld } from '@/lib/worldBuilder';
import type {
  BridgeLayout,
  CameraMode,
  CommitData,
  GateVisitorEntity,
  InspectorSelection,
  IslandLayout,
  RepoVillageGraph,
  TimeOfDay,
  VillagerEntity,
} from '@/types/village';

export interface VillageEngineSnapshot {
  graph: RepoVillageGraph;
  clans: ContributorClanProfile[];
  clanMap: Map<string, ContributorClanProfile>;
  villagerCount: number;
  gateVisitorsCount: number;
  activeFilter: string;
  activeAuthorKey: string | null;
  timeOfDay: TimeOfDay;
  cameraMode: CameraMode;
  muted: boolean;
  followingSelected: boolean;
  isLoading: boolean;
  selection: InspectorSelection;
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
  }) => void;
  onRequestLocalModal: () => void;
}

function computeLocalGraphFingerprint(graph: RepoVillageGraph): string {
  const headSha = graph.branches[0]?.commits.at(-1)?.sha ?? '';
  const visitorsKey = (graph.gateVisitors ?? [])
    .map((v) => `${v.filename}:${v.status}:${v.staged ? 1 : 0}:${v.additions}:${v.deletions}`)
    .join('|');
  return `${headSha}::${visitorsKey}`;
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

  private followVillager = false;
  private activeFilter = 'all';
  private activeAuthorKey: string | null = null;
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
    }

    this.cb.onStateChange({
      graph: this.activeGraph,
      clans: [...this.clanMap.values()],
      clanMap: this.clanMap,
      villagerCount: this.villagers.length,
      gateVisitorsCount: this.gateVisitors.length,
      activeFilter: this.activeFilter,
      activeAuthorKey: this.activeAuthorKey,
      timeOfDay: this.timeOfDay,
      cameraMode: this.cameraMode,
      muted: sound.muted,
      followingSelected: this.followVillager,
      isLoading: this.isLoading,
      selection,
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
      const lampBoost = mode === 'night' ? 2.2 : mode === 'sunset' ? 1.4 : 0.45;
      for (const mat of this.builtWorld.animatedProps.lanternGlows) {
        mat.emissiveIntensity = lampBoost;
      }
      for (const mat of this.builtWorld.animatedProps.windowGlows) {
        mat.emissiveIntensity = mode === 'day' ? 0.25 : 1.6;
      }
      if (this.builtWorld.animatedProps.fireflies) {
        const pMat = this.builtWorld.animatedProps.fireflies.material as THREE.PointsMaterial;
        pMat.opacity = mode === 'night' ? 0.95 : mode === 'sunset' ? 0.7 : 0.35;
      }
    }
    sound.setMood(mode);
    this.emit();
  }

  public cycleAtmosphere(): void {
    const order: TimeOfDay[] = ['day', 'sunset', 'night'];
    const next = order[(order.indexOf(this.timeOfDay) + 1) % order.length];
    this.applyAtmosphere(next);
    sound.playPop(523.25);
  }

  public toggleMute(): void {
    sound.toggleMute();
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
    this.setCameraMode(this.cameraMode === 'orbit' ? 'walk' : 'orbit');
  }

  public setFilter(filter: string): void {
    this.activeFilter = filter;
    this.applyVillagerFilterBeams();
    this.emit();
  }

  public toggleAuthorSpotlight(authorKey: string): void {
    const clan = this.clanMap.get(authorKey);
    this.activeAuthorKey = this.activeAuthorKey === authorKey ? null : authorKey;
    sound.playPop(this.activeAuthorKey ? 587.33 : 440);
    this.applyVillagerFilterBeams();
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

    for (const v of this.villagers) {
      const roleMatch = !hasRoleFilter || v.commit.kind === this.activeFilter;
      const authorMatch = !hasAuthorFilter || v.authorKey === this.activeAuthorKey;
      const showBeam = (hasRoleFilter || hasAuthorFilter) && roleMatch && authorMatch;
      v.filterBeam.visible = showBeam;
      (v.filterBeam.material as THREE.MeshBasicMaterial).opacity = showBeam ? 0.28 : 0;
      v.bodyGroup.visible = true;
    }
  }

  public closeInspector(): void {
    this.selectedVillager = null;
    this.selectedGateVisitor = null;
    this.followVillager = false;
    this.emit();
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
    if (!this.builtWorld) return;
    this.followVillager = false;
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

  public triggerGatePreviewOpen(): void {
    if (!this.builtWorld?.gate || this.gateVisitors.length === 0) return;
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
    if (playChime) {
      sound.playSelectVillager(v.commit.kind);
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
    if (commit.patchesHydrated || this.activeGraph.isDemo) return;
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
    this.followVillager = false;

    if (playChime) {
      sound.playSelectVillager(gv.file.staged ? 'feat' : 'fix');
    }

    gv.jumpVelocity = 7.0;
    this.triggerVisitorEmote(gv, gv.file.staged ? '🎫' : '🙋', 2.4);

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
    this.activeGraph = graph;
    this.lastLocalFingerprint = graph.isLocal ? computeLocalGraphFingerprint(graph) : '';

    this.hoveredVillager = null;
    this.hoveredGateVisitor = null;
    if (!options.preserveCamera) {
      this.selectedVillager = null;
      this.selectedGateVisitor = null;
      this.activeAuthorKey = null;
      this.followVillager = false;
    }
    this.hoverPill.hidden = true;
    this.gatePreviewOpenTimer = 0;

    if (this.builtWorld) {
      this.scene.remove(this.builtWorld.worldGroup);
    }
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

    if (graph.isLocal && this.builtWorld.gate) {
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
      this.cb.onToast(message, true, 6000);
    } finally {
      this.isLoading = false;
      this.emit();
    }
  }

  public async pollLocalRepoNow(manualFeedback = false): Promise<void> {
    if (!this.activeGraph.isLocal || this.isPollingLocal) return;
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

    this.currentLoadController?.abort();
    this.activeBrowserSource = null;

    if (spec === 'demo' || spec === 'gitvillage/sky-village') {
      const demo = createDemoRepoGraph();
      this.rebuildVillageFromGraph(demo);
      if (targetBranch && demo.allBranches?.includes(targetBranch)) {
        this.flyToBranchIsland(targetBranch);
      }
      sound.playRepoLoaded();
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
      for (const v of this.villagers) boxes.push(v.hitBox);
      for (const gv of this.gateVisitors) boxes.push(gv.hitBox);
      return boxes;
    };

    const onPointerMove = (e: PointerEvent) => {
      this.pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const hits = this.raycaster.intersectObjects(getAllHitBoxes(), false);

      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (typeof ud.visitorIndex === 'number') {
          const gv = this.gateVisitors[ud.visitorIndex] ?? null;
          if (gv !== this.hoveredGateVisitor) {
            this.hoveredGateVisitor = gv;
            this.hoveredVillager = null;
            if (gv) sound.playHover();
          }
          if (gv) {
            this.canvas.style.cursor = 'pointer';
            this.hoverPill.textContent = `${gv.file.staged ? 'Staged' : 'Gate'} · ${gv.file.filename} (+${gv.file.additions} / −${gv.file.deletions})`;
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
          const clan = this.clanMap.get(ent.authorKey);
          const clanTag = clan ? `${clan.emblem} ${clan.initials} · ` : '';
          this.hoverPill.textContent = `${clanTag}${ent.commit.shortSha} · ${cargo.filesCount} file${cargo.filesCount === 1 ? '' : 's'} · ${ent.commit.subject}`;
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

    const shouldOpenDoors = this.gateVisitors.length === 0 || this.gatePreviewOpenTimer > 0.8;
    const targetLeftRot = shouldOpenDoors ? 1.38 : 0;
    const targetRightRot = shouldOpenDoors ? -1.38 : 0;
    gate.leftDoorPivot.rotation.y +=
      (targetLeftRot - gate.leftDoorPivot.rotation.y) * Math.min(1, dt * 7);
    gate.rightDoorPivot.rotation.y +=
      (targetRightRot - gate.rightDoorPivot.rotation.y) * Math.min(1, dt * 7);

    for (const gv of this.gateVisitors) {
      const isHovered = gv === this.hoveredGateVisitor;
      const isSelected = gv === this.selectedGateVisitor;

      const auraMat = gv.auraRing.material as THREE.MeshBasicMaterial;
      const baseOpacity = gv.file.staged ? 0.58 : 0.25;
      const targetOp = isSelected ? 0.95 : isHovered ? 0.78 : baseOpacity;
      auraMat.opacity += (targetOp - auraMat.opacity) * Math.min(1, dt * 10);

      if (gv.ticketMesh) {
        gv.ticketMesh.rotation.y += dt * 2.4;
        gv.ticketMesh.position.y = 1.56 + Math.sin(elapsed * 3.5 + gv.phaseOffset) * 0.08;
      }

      const dest = this.gatePreviewOpenTimer > 0.9 ? gv.rushTarget : gv.queueSlot;
      const distToDest = gv.root.position.distanceTo(dest);

      if (distToDest > 0.08) {
        const dirX = dest.x - gv.root.position.x;
        const dirZ = dest.z - gv.root.position.z;
        gv.root.position.lerp(dest, Math.min(1, dt * 3.4));
        gv.bodyGroup.rotation.y = Math.atan2(dirX, dirZ);

        const runCycle = elapsed * 14 + gv.phaseOffset;
        gv.leftLeg.rotation.x = Math.sin(runCycle) * 0.75;
        gv.rightLeg.rotation.x = -Math.sin(runCycle) * 0.75;
        gv.leftArm.rotation.x = -2.2 + Math.sin(runCycle) * 0.35;
        gv.rightArm.rotation.x = -2.2 - Math.sin(runCycle) * 0.35;
      } else if (isHovered) {
        const dx = this.camera.position.x - gv.root.position.x;
        const dz = this.camera.position.z - gv.root.position.z;
        gv.bodyGroup.rotation.y = Math.atan2(dx, dz);
        gv.rightArm.rotation.x = -2.35 + Math.sin(elapsed * 14) * 0.45;
        gv.leftArm.rotation.x = -0.4;
      } else {
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
            this.projVec.y += 1.85 + v.jumpY;
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
        for (let j = i + 1; j < count; j++) {
          const b = this.villagers[j];
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
    const dt = Math.min(0.05, this.clock.getDelta());
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
      if (this.builtWorld.animatedProps.fireflies) {
        this.builtWorld.animatedProps.fireflies.rotation.y = Math.sin(elapsed * 0.12) * 0.15;
      }
    }

    this.updateVillagers(dt, elapsed);
    this.updateGateAndVisitors(dt, elapsed);
    this.updateExplorerWalk(dt, elapsed);
    this.resolveCharacterCollisions(dt, false);

    if (this.followVillager && this.selectedVillager && this.cameraMode === 'orbit') {
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
      keysPressed: this.keysPressed,
      explorer: this.explorer,
      focusOnVillager: (v: VillagerEntity, play = true) => self.focusOnVillager(v, play),
      focusOnGateVisitor: (gv: GateVisitorEntity, play = true, move = true) =>
        self.focusOnGateVisitor(gv, play, move),
      flyToOverview: () => self.flyToOverview(),
      flyToGate: (sel = true) => self.flyToGate(sel),
      applyAtmosphere: (m: TimeOfDay) => self.applyAtmosphere(m),
      setCameraMode: (m: CameraMode) => self.setCameraMode(m),
      triggerGatePreviewOpen: () => self.triggerGatePreviewOpen(),
      loadLocalRepo: (p: string, u = true) => self.loadLocalRepo(p, u),
      loadRepoBySpec: (s: string, u = true) => self.loadRepoBySpec(s, u),
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
