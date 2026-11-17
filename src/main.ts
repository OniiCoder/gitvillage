import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDemoRepoGraph } from './demoRepo';
import { hydrateCommitDetail, loadGitHubRepoVillage, parseRepoInput } from './githubLoader';
import {
  type DiscoveredLocalRepo,
  browseLocalDirectory,
  discoverLocalRepos,
  hydrateLocalCommitDetail,
  isLocalPathInput,
  loadLocalRepoVillage,
  pickNativeMacFolder,
} from './localLoader';
import { sound } from './sound';
import type {
  BridgeLayout,
  CameraMode,
  CommitData,
  GateVisitorEntity,
  IslandLayout,
  RepoVillageGraph,
  TimeOfDay,
  VillagerEntity,
} from './types';
import {
  createExplorerAvatar,
  createGateVisitorEntity,
  createVillagerEntity,
  getAuthorColorHex,
  getRoleMeta,
  getVisitorStatusMeta,
} from './villagerMesh';
import { type BuiltWorld, buildArchipelagoWorld } from './worldBuilder';

// 1. Progressive enhancement polyfill for Popover per modern-web-guidance
if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
  import('@oddbird/popover-polyfill');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function makeSfIcon(symbolId: string, size = 14, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', extraClass ? `sf-icon ${extraClass}` : 'sf-icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

// 2. Top-layer exit transition detection & dialog light-dismiss fallback
let supportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

async function closeTopLayerDialog(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

// DOM Elements
const canvas = document.getElementById('village-canvas') as HTMLCanvasElement;
const overlayLayer = document.getElementById('overlay-layer') as HTMLDivElement;
const hoverPill = document.getElementById('hover-pill') as HTMLDivElement;
const walkHint = document.getElementById('walk-hint') as HTMLDivElement;
const statsPill = document.getElementById('repo-stats-pill') as HTMLSpanElement;
const repoForm = document.getElementById('repo-form') as HTMLFormElement;
const repoInput = document.getElementById('repo-input') as HTMLInputElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const mainToolbar = document.getElementById('main-toolbar') as HTMLDivElement;
const localQuickBtn = document.getElementById('local-quick-btn') as HTMLButtonElement;
const localReposGrid = document.getElementById('local-repos-grid') as HTMLDivElement;
const tokenInput = document.getElementById('gh-token-input') as HTMLInputElement;
const toastBanner = document.getElementById('toast-banner') as HTMLDivElement;

const presetsPopover = document.getElementById('presets-popover') as HTMLElement;
const rosterPopover = document.getElementById('roster-popover') as HTMLElement;
const rosterList = document.getElementById('roster-list') as HTMLDivElement;
const groupBranchBtn = document.getElementById('group-branch-btn') as HTMLButtonElement;
const groupAuthorBtn = document.getElementById('group-author-btn') as HTMLButtonElement;

const modeBtn = document.getElementById('mode-btn') as HTMLButtonElement;
const skyBtn = document.getElementById('sky-btn') as HTMLButtonElement;
const skyIconUse = document.getElementById('sky-icon-use') as unknown as SVGUseElement;
const soundBtn = document.getElementById('sound-btn') as HTMLButtonElement;
const soundIconUse = document.getElementById('sound-icon-use') as unknown as SVGUseElement;
const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
const helpDialog = document.getElementById('help-dialog') as HTMLDialogElement;
const helpCloseBtn = document.getElementById('help-close-btn') as HTMLButtonElement;
const helpGotItBtn = document.getElementById('help-gotit-btn') as HTMLButtonElement;

// Local Repository Picker Dialog DOM
const localPickerDialog = document.getElementById('local-picker-dialog') as HTMLDialogElement;
const localPickerCloseBtn = document.getElementById('local-picker-close-btn') as HTMLButtonElement;
const nativeFinderBtn = document.getElementById('native-finder-btn') as HTMLButtonElement;
const pickerPathForm = document.getElementById('picker-path-form') as HTMLFormElement;
const pickerPathInput = document.getElementById('picker-path-input') as HTMLInputElement;
const discoveredCountLabel = document.getElementById('discovered-count-label') as HTMLSpanElement;
const pickerDiscoveredGrid = document.getElementById('picker-discovered-grid') as HTMLDivElement;
const pickerHiddenCheckbox = document.getElementById('picker-hidden-checkbox') as HTMLInputElement;
const pickerRoots = document.getElementById('picker-roots') as HTMLDivElement;
const pickerBreadcrumbs = document.getElementById('picker-breadcrumbs') as HTMLOListElement;
const pickerCurrentGitBanner = document.getElementById('picker-current-git-banner') as HTMLDivElement;
const pickerCurrentGitTitle = document.getElementById('picker-current-git-title') as HTMLElement;
const pickerCurrentGitSub = document.getElementById('picker-current-git-sub') as HTMLSpanElement;
const pickerLoadCurrentBtn = document.getElementById('picker-load-current-btn') as HTMLButtonElement;
const pickerFolderList = document.getElementById('picker-folder-list') as HTMLDivElement;

const gateDockBtn = document.getElementById('gate-dock-btn') as HTMLButtonElement;
const gateStatusDot = document.getElementById('gate-status-dot') as HTMLSpanElement;
const gateDockLabel = document.getElementById('gate-dock-label') as HTMLSpanElement;
const randomBtn = document.getElementById('random-btn') as HTMLButtonElement;
const resetCamBtn = document.getElementById('reset-cam-btn') as HTMLButtonElement;

// Inspector DOM
const inspectorCard = document.getElementById('inspector-card') as HTMLElement;
const insCloseBtn = document.getElementById('ins-close-btn') as HTMLButtonElement;
const insRoleBadge = document.getElementById('ins-role-badge') as HTMLSpanElement;
const insBranchBadge = document.getElementById('ins-branch-badge') as HTMLSpanElement;
const insSubject = document.getElementById('ins-subject') as HTMLHeadingElement;
const insQuirk = document.getElementById('ins-quirk') as HTMLParagraphElement;
const insAvatar = document.getElementById('ins-avatar') as HTMLDivElement;
const insAuthorName = document.getElementById('ins-author-name') as HTMLElement;
const insTimestamp = document.getElementById('ins-timestamp') as HTMLSpanElement;
const insShaCopy = document.getElementById('ins-sha-copy') as HTMLButtonElement;
const insShaText = document.getElementById('ins-sha-text') as HTMLSpanElement;
const insGhLink = document.getElementById('ins-gh-link') as HTMLAnchorElement;
const insBody = document.getElementById('ins-body') as HTMLParagraphElement;
const insPrevBtn = document.getElementById('ins-prev-btn') as HTMLButtonElement;
const insFollowBtn = document.getElementById('ins-follow-btn') as HTMLButtonElement;
const insCheerBtn = document.getElementById('ins-cheer-btn') as HTMLButtonElement;
const insNextBtn = document.getElementById('ins-next-btn') as HTMLButtonElement;
const insDiffText = document.getElementById('ins-diff-text') as HTMLSpanElement;
const insDiffAddBar = document.getElementById('ins-diff-add-bar') as HTMLDivElement;
const insDiffDelBar = document.getElementById('ins-diff-del-bar') as HTMLDivElement;
const insFilesDetails = document.getElementById('ins-files-details') as HTMLDetailsElement;
const insFilesSummary = document.getElementById('ins-files-summary') as HTMLElement;
const insFilesList = document.getElementById('ins-files-list') as HTMLUListElement;
const insDiffPreview = document.getElementById('ins-diff-preview') as HTMLPreElement;

// 3. Single-tab-stop roving tabindex fallback for role="toolbar" when native focusgroup is absent
if (!('focusGroup' in HTMLElement.prototype)) {
  const toolbarItems = Array.from(mainToolbar.querySelectorAll<HTMLButtonElement>('button'));
  toolbarItems.forEach((b, i) => {
    b.tabIndex = i === 0 ? 0 : -1;
  });
  mainToolbar.addEventListener('focusin', ({ target }) => {
    if (target instanceof HTMLButtonElement && toolbarItems.includes(target)) {
      toolbarItems.forEach((b) => {
        b.tabIndex = b === target ? 0 : -1;
      });
    }
  });
  mainToolbar.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) return;
    const idx = toolbarItems.indexOf(active);
    if (idx < 0) return;

    const rtl = getComputedStyle(mainToolbar).direction === 'rtl';
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIdx = (idx + (rtl ? -1 : 1) + toolbarItems.length) % toolbarItems.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx + (rtl ? 1 : -1) + toolbarItems.length) % toolbarItems.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = toolbarItems.length - 1;
    }

    if (nextIdx !== null) {
      e.preventDefault();
      toolbarItems[nextIdx].focus();
    }
  });
}

// Setup Dialog fallbacks & listeners
function wireLightDismissDialog(dialog: HTMLDialogElement): void {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        closeTopLayerDialog(dialog);
      }
    });
  }
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeTopLayerDialog(dialog);
  });
}

wireLightDismissDialog(helpDialog);
wireLightDismissDialog(localPickerDialog);

helpBtn.addEventListener('click', () => helpDialog.showModal());
helpCloseBtn.addEventListener('click', () => closeTopLayerDialog(helpDialog));
helpGotItBtn.addEventListener('click', () => closeTopLayerDialog(helpDialog));
localPickerCloseBtn.addEventListener('click', () => closeTopLayerDialog(localPickerDialog));

// Toast helper
let toastTimer: number | undefined;
function showToast(msg: string, isError = false, durationMs = 4200): void {
  window.clearTimeout(toastTimer);
  toastBanner.textContent = msg;
  toastBanner.classList.toggle('is-error', isError);
  toastBanner.hidden = false;
  if (durationMs > 0) {
    toastTimer = window.setTimeout(() => {
      toastBanner.hidden = true;
    }, durationMs);
  }
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
  return rtf.format(Math.round(diffSec / 31536000), 'year');
}

function computeLocalGraphFingerprint(graph: RepoVillageGraph): string {
  const headSha = graph.branches[0]?.commits.at(-1)?.sha ?? '';
  const visitorsKey = (graph.gateVisitors ?? [])
    .map((v) => `${v.filename}:${v.status}:${v.staged ? 1 : 0}:${v.additions}:${v.deletions}`)
    .join('|');
  return `${headSha}::${visitorsKey}`;
}

// 4. Three.js Scene, Sky Gradient Shader, Lights & Controls
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();

const skyUniforms = {
  uTopColor: { value: new THREE.Color('#1d4ed8') },
  uMidColor: { value: new THREE.Color('#38bdf8') },
  uBottomColor: { value: new THREE.Color('#e0f2fe') },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(240, 32, 20),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
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
scene.add(skyDome);
scene.fog = new THREE.FogExp2('#bae6fd', 0.0055);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.3, 400);
camera.position.set(-8, 17, 28);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.maxDistance = 105;
controls.minDistance = 4;
controls.maxPolarAngle = Math.PI * 0.56;

const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.15);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
dirLight.position.set(24, 38, 22);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 2;
dirLight.shadow.camera.far = 130;
const dCam = 48;
dirLight.shadow.camera.left = -dCam;
dirLight.shadow.camera.right = dCam;
dirLight.shadow.camera.top = dCam;
dirLight.shadow.camera.bottom = -dCam;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const explorer = createExplorerAvatar();
scene.add(explorer.root);
const explorerVelocity = { y: 0, grounded: true };
const keysPressed = new Set<string>();

// State
let activeGraph: RepoVillageGraph = createDemoRepoGraph();
let lastLocalFingerprint = '';
let builtWorld: BuiltWorld | null = null;
let villagers: VillagerEntity[] = [];
const villagerBySha = new Map<string, VillagerEntity>();

let gateVisitors: GateVisitorEntity[] = [];
let gatePreviewOpenTimer = 0;

const emoteElements = new Map<string, HTMLDivElement>();

let hoveredVillager: VillagerEntity | null = null;
let hoveredGateVisitor: GateVisitorEntity | null = null;
let selectedVillager: VillagerEntity | null = null;
let selectedGateVisitor: GateVisitorEntity | null = null;

let followVillager = false;
let activeFilter = 'all';
let rosterGroupMode: 'branch' | 'author' = 'branch';
let timeOfDay: TimeOfDay = 'day';
let cameraMode: CameraMode = 'orbit';
let currentLoadController: AbortController | null = null;

let cameraFlight: {
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  active: boolean;
} = {
  targetPos: new THREE.Vector3(),
  targetLook: new THREE.Vector3(),
  active: false,
};

controls.addEventListener('start', () => {
  cameraFlight.active = false;
});

function applyAtmosphere(mode: TimeOfDay): void {
  timeOfDay = mode;
  if (mode === 'day') {
    skyIconUse.setAttribute('href', '#sf-sun');
    skyUniforms.uTopColor.value.set('#1d4ed8');
    skyUniforms.uMidColor.value.set('#38bdf8');
    skyUniforms.uBottomColor.value.set('#e0f2fe');
    (scene.fog as THREE.FogExp2).color.set('#bae6fd');
    hemiLight.color.set('#e0f2fe');
    hemiLight.groundColor.set('#334155');
    hemiLight.intensity = 1.15;
    dirLight.color.set('#fffbeb');
    dirLight.intensity = 1.85;
    dirLight.position.set(24, 38, 22);
  } else if (mode === 'sunset') {
    skyIconUse.setAttribute('href', '#sf-sunset');
    skyUniforms.uTopColor.value.set('#311042');
    skyUniforms.uMidColor.value.set('#db2777');
    skyUniforms.uBottomColor.value.set('#fdba74');
    (scene.fog as THREE.FogExp2).color.set('#f472b6');
    hemiLight.color.set('#fed7aa');
    hemiLight.groundColor.set('#3b0764');
    hemiLight.intensity = 0.95;
    dirLight.color.set('#fb923c');
    dirLight.intensity = 1.65;
    dirLight.position.set(-34, 15, 24);
  } else {
    skyIconUse.setAttribute('href', '#sf-moon');
    skyUniforms.uTopColor.value.set('#020617');
    skyUniforms.uMidColor.value.set('#0f172a');
    skyUniforms.uBottomColor.value.set('#1e1b4b');
    (scene.fog as THREE.FogExp2).color.set('#0f172a');
    hemiLight.color.set('#6366f1');
    hemiLight.groundColor.set('#090d16');
    hemiLight.intensity = 0.68;
    dirLight.color.set('#93c5fd');
    dirLight.intensity = 0.72;
    dirLight.position.set(16, 30, -20);
  }

  if (builtWorld) {
    const lampBoost = mode === 'night' ? 2.2 : mode === 'sunset' ? 1.4 : 0.45;
    for (const mat of builtWorld.animatedProps.lanternGlows) {
      mat.emissiveIntensity = lampBoost;
    }
    for (const mat of builtWorld.animatedProps.windowGlows) {
      mat.emissiveIntensity = mode === 'day' ? 0.25 : 1.6;
    }
    if (builtWorld.animatedProps.fireflies) {
      const pMat = builtWorld.animatedProps.fireflies.material as THREE.PointsMaterial;
      pMat.opacity = mode === 'night' ? 0.95 : mode === 'sunset' ? 0.7 : 0.35;
    }
  }
}

// Spawn World + Commit Villagers + Local Working-Tree Gate Visitors
function rebuildVillageFromGraph(
  graph: RepoVillageGraph,
  options: { preserveCamera?: boolean; focusGateOnLoad?: boolean } = {},
): void {
  activeGraph = graph;
  lastLocalFingerprint = graph.isLocal ? computeLocalGraphFingerprint(graph) : '';

  hoveredVillager = null;
  hoveredGateVisitor = null;
  if (!options.preserveCamera) {
    selectedVillager = null;
    selectedGateVisitor = null;
    followVillager = false;
    inspectorCard.hidden = true;
  }
  hoverPill.hidden = true;
  gatePreviewOpenTimer = 0;

  if (builtWorld) {
    scene.remove(builtWorld.worldGroup);
  }
  villagers = [];
  villagerBySha.clear();
  gateVisitors = [];
  overlayLayer.replaceChildren();
  emoteElements.clear();

  builtWorld = buildArchipelagoWorld(graph);
  scene.add(builtWorld.worldGroup);

  const islandByBranch = new Map<string, IslandLayout>();
  for (const isl of builtWorld.islands) {
    islandByBranch.set(isl.branch.name, isl);
  }

  for (const branch of graph.branches) {
    const isl = islandByBranch.get(branch.name);
    if (!isl) continue;
    branch.commits.forEach((commit, idx) => {
      const entity = createVillagerEntity(commit, isl, idx, branch.commits.length);
      builtWorld!.worldGroup.add(entity.root);
      villagers.push(entity);
      villagerBySha.set(commit.sha, entity);

      const emoteEl = document.createElement('div');
      emoteEl.className = 'emote-bubble';
      emoteEl.hidden = true;
      overlayLayer.appendChild(emoteEl);
      emoteElements.set(`c:${commit.sha}`, emoteEl);
    });
  }

  if (graph.isLocal && builtWorld.gate) {
    const gate = builtWorld.gate;
    const files = graph.gateVisitors ?? [];
    files.forEach((file, idx) => {
      const slot = gate.visitorSlots[idx] ?? gate.visitorSlots.at(-1)!;
      const rushSpot = gate.targetIslandPos
        .clone()
        .add(new THREE.Vector3(-((idx % 4) * 0.9), 0, ((idx % 3) - 1) * 0.95));
      const gv = createGateVisitorEntity(file, idx, slot, rushSpot);
      builtWorld!.worldGroup.add(gv.root);
      gateVisitors.push(gv);

      const emoteEl = document.createElement('div');
      emoteEl.className = 'emote-bubble';
      emoteEl.hidden = true;
      overlayLayer.appendChild(emoteEl);
      emoteElements.set(`v:${idx}`, emoteEl);
    });

    gateDockBtn.hidden = false;
    gateDockLabel.textContent = `Gate · ${files.length}`;
    gateStatusDot.className = `status-dot ${files.length > 0 ? 'dot-amber' : 'dot-green'}`;
  } else {
    gateDockBtn.hidden = true;
  }

  applyAtmosphere(timeOfDay);
  applyVillagerFilter(activeFilter);
  renderRosterPopover();

  const totalCommits = villagers.length;
  const totalIslands = graph.branches.length;
  if (graph.isLocal) {
    const waitingCount = gateVisitors.length;
    statsPill.textContent = `${graph.repo} · ${totalCommits} commits · ${waitingCount} at gate`;
  } else {
    statsPill.textContent = `${graph.repo} · ${totalCommits} commits · ${totalIslands} island${totalIslands === 1 ? '' : 's'}`;
  }

  if (!options.preserveCamera) {
    if (cameraMode === 'walk') {
      const startIsl = builtWorld.islands[0];
      const p = startIsl.pathCurve.getPointAt(0.5);
      explorer.root.position.set(p.x, p.y, p.z + 0.8);
    } else if (options.focusGateOnLoad && builtWorld.gate) {
      flyToGate(false);
    } else {
      flyToOverview();
    }
  }
}

function flyToOverview(): void {
  if (!builtWorld) return;
  followVillager = false;
  insFollowBtn.classList.remove('is-active');
  const mainLen = builtWorld.islands[0]?.length ?? 28;
  const extraGate = builtWorld.gate ? builtWorld.gate.dockLength * 0.5 : 0;
  const dist = Math.max(24, (mainLen + extraGate) * 0.72);
  cameraFlight = {
    targetLook: new THREE.Vector3(extraGate * 0.35, 1.2, 0),
    targetPos: new THREE.Vector3(-dist * 0.24, dist * 0.56, dist * 0.86),
    active: true,
  };
}

function flyToGate(selectFirst = true): void {
  if (!builtWorld?.gate) return;
  followVillager = false;
  insFollowBtn.classList.remove('is-active');
  const arch = builtWorld.gate.archPosition;
  cameraFlight = {
    targetLook: new THREE.Vector3(arch.x + 2.2, 1.4, 0),
    targetPos: new THREE.Vector3(arch.x + 6.5, 6.2, 11.5),
    active: true,
  };
  if (selectFirst && gateVisitors.length > 0) {
    focusOnGateVisitor(gateVisitors[0], true, false);
  }
}

function focusOnVillager(v: VillagerEntity, playChime = true): void {
  selectedVillager = v;
  selectedGateVisitor = null;
  if (playChime) {
    sound.playSelectVillager(v.commit.kind);
  }

  v.behavior = 'jump_joy';
  v.behaviorTimer = 3.2;
  v.jumpVelocity = 6.2;
  triggerEmote(`c:${v.commit.sha}`, v, '👋', 2.2);

  if (cameraMode === 'orbit') {
    const pos = v.root.position;
    const offset = new THREE.Vector3(2.4, 3.6, 7.2);
    cameraFlight = {
      targetLook: new THREE.Vector3(pos.x + 1.1, pos.y + 1.0, pos.z),
      targetPos: pos.clone().add(offset),
      active: true,
    };
  }

  populateCommitInspector(v.commit);
}

function focusOnGateVisitor(
  gv: GateVisitorEntity,
  playChime = true,
  moveCamera = true,
): void {
  selectedGateVisitor = gv;
  selectedVillager = null;
  followVillager = false;
  insFollowBtn.classList.remove('is-active');

  if (playChime) {
    sound.playSelectVillager(gv.file.staged ? 'feat' : 'fix');
  }

  gv.jumpVelocity = 7.0;
  triggerVisitorEmote(gv, gv.file.staged ? '🎫' : '🙋', 2.4);

  if (moveCamera && cameraMode === 'orbit') {
    const pos = gv.root.position;
    cameraFlight = {
      targetLook: new THREE.Vector3(pos.x + 0.8, pos.y + 1.1, pos.z),
      targetPos: new THREE.Vector3(pos.x + 4.2, pos.y + 4.2, pos.z + 8.0),
      active: true,
    };
  }

  populateVisitorInspector(gv);
}

function triggerEmote(key: string, v: VillagerEntity, emoji: string, duration = 2.0): void {
  v.emoteEmoji = emoji;
  v.emoteTimer = duration;
  const el = emoteElements.get(key);
  if (el) {
    el.textContent = emoji;
    el.hidden = false;
  }
}

function triggerVisitorEmote(gv: GateVisitorEntity, emoji: string, duration = 2.0): void {
  gv.emoteEmoji = emoji;
  gv.emoteTimer = duration;
  const el = emoteElements.get(`v:${gv.index}`);
  if (el) {
    el.textContent = emoji;
    el.hidden = false;
  }
}

function triggerGatePreviewOpen(): void {
  if (!builtWorld?.gate || gateVisitors.length === 0) return;
  gatePreviewOpenTimer = 4.2;
  sound.playRepoLoaded();
  for (const gv of gateVisitors) {
    gv.jumpVelocity = 7.5 + Math.random() * 2.0;
    triggerVisitorEmote(gv, '🎉', 3.2);
  }
  showToast(
    `Previewing Gate Open — ${gateVisitors.length} file visitor${gateVisitors.length === 1 ? '' : 's'} entering the island. Run git commit to welcome them permanently.`,
  );
}

function setButtonWithIcon(btn: HTMLButtonElement, label: string, iconId?: string, trailing = false): void {
  btn.replaceChildren();
  const textSpan = document.createElement('span');
  textSpan.textContent = label;
  if (iconId) {
    const icon = makeSfIcon(iconId, 13);
    if (trailing) btn.append(textSpan, icon);
    else btn.append(icon, textSpan);
  } else {
    btn.appendChild(textSpan);
  }
}

// Populate Inspector for a Gate Visitor (Uncommitted File Change)
function populateVisitorInspector(gv: GateVisitorEntity): void {
  inspectorCard.hidden = false;
  const f = gv.file;
  const meta = getVisitorStatusMeta(f.status);

  insRoleBadge.textContent = meta.label;
  insBranchBadge.textContent = f.staged ? 'Staged · git add' : 'Unstaged';

  const baseName = f.filename.split('/').pop() || f.filename;
  insSubject.textContent = baseName;
  insQuirk.textContent = `${f.filename} · Visitor ${gv.index + 1} of ${gateVisitors.length} outside ${activeGraph.defaultBranch}`;

  insAvatar.replaceChildren(makeSfIcon('sf-gate', 16));
  insAvatar.style.background = `#${meta.color.toString(16).padStart(6, '0')}`;

  insAuthorName.textContent = f.staged
    ? 'Ready at front of Gate'
    : 'Queued on Sky-Dock Pier';
  insTimestamp.textContent = f.staged
    ? 'Enters village on next git commit'
    : 'Stage with git add and commit to admit';

  insShaText.textContent = 'Copy path';
  insShaCopy.onclick = () => {
    navigator.clipboard?.writeText(f.filename).catch(() => {});
    insShaText.textContent = 'Copied';
    sound.playPop(660);
    setTimeout(() => {
      if (selectedGateVisitor === gv) insShaText.textContent = 'Copy path';
    }, 1000);
  };
  insGhLink.hidden = true;
  insBody.hidden = true;

  setButtonWithIcon(insPrevBtn, 'Prev', 'sf-arrow-left');
  setButtonWithIcon(insNextBtn, 'Next', 'sf-arrow-right', true);
  insPrevBtn.disabled = gv.index <= 0;
  insNextBtn.disabled = gv.index >= gateVisitors.length - 1;
  insPrevBtn.onclick = () => {
    const prev = gateVisitors[gv.index - 1];
    if (prev) focusOnGateVisitor(prev);
  };
  insNextBtn.onclick = () => {
    const next = gateVisitors[gv.index + 1];
    if (next) focusOnGateVisitor(next);
  };

  setButtonWithIcon(insFollowBtn, 'Let In', 'sf-gate');
  insFollowBtn.classList.remove('is-active');
  insFollowBtn.onclick = () => triggerGatePreviewOpen();

  setButtonWithIcon(insCheerBtn, 'Sync', 'sf-refresh');
  insCheerBtn.onclick = () => {
    if (activeGraph.localPath) {
      pollLocalRepoNow(true);
    }
  };

  const add = f.additions;
  const del = f.deletions;
  const total = Math.max(1, add + del);
  insDiffText.textContent = `+${add} / −${del}`;
  insDiffAddBar.style.width = `${Math.round((add / total) * 100)}%`;
  insDiffDelBar.style.width = `${Math.round((del / total) * 100)}%`;

  insFilesList.replaceChildren();
  if (f.diffPreview) {
    insFilesSummary.textContent = 'Working-tree diff preview';
    insDiffPreview.textContent = f.diffPreview;
    insDiffPreview.hidden = false;
    insFilesDetails.open = true;
  } else {
    insFilesSummary.textContent = 'Working-tree file change';
    insDiffPreview.hidden = true;
  }
}

// Populate Inspector for a Settled Commit Citizen
async function populateCommitInspector(commit: CommitData): Promise<void> {
  inspectorCard.hidden = false;
  const role = getRoleMeta(commit.kind);
  insRoleBadge.textContent = role.badge;
  insBranchBadge.textContent = commit.branch;
  insSubject.textContent = commit.subject;

  const authorCount = villagers.filter((v) => v.commit.authorLogin === commit.authorLogin).length;
  insQuirk.textContent = `${role.title} · ${authorCount} commit${authorCount === 1 ? '' : 's'} by @${commit.authorLogin}`;

  insAvatar.replaceChildren();
  const bgHex = `#${getAuthorColorHex(commit.authorLogin).toString(16).padStart(6, '0')}`;
  insAvatar.style.background = bgHex;
  if (commit.authorAvatar) {
    const img = document.createElement('img');
    img.src = commit.authorAvatar;
    img.alt = commit.authorName;
    insAvatar.appendChild(img);
  } else {
    insAvatar.textContent = commit.authorName.slice(0, 1).toUpperCase();
  }

  insAuthorName.textContent = commit.authorName;
  insTimestamp.textContent = `${formatRelativeTime(commit.timestamp)} · ${new Date(commit.timestamp).toLocaleDateString()}`;
  insShaText.textContent = commit.shortSha;
  insShaCopy.onclick = () => {
    navigator.clipboard?.writeText(commit.sha).catch(() => {});
    insShaText.textContent = 'Copied';
    sound.playPop(660);
    setTimeout(() => {
      if (selectedVillager?.commit.sha === commit.sha) {
        insShaText.textContent = commit.shortSha;
      }
    }, 1100);
  };

  if (commit.htmlUrl) {
    insGhLink.href = commit.htmlUrl;
    insGhLink.hidden = false;
  } else {
    insGhLink.hidden = true;
  }

  if (commit.body) {
    insBody.textContent = commit.body;
    insBody.hidden = false;
  } else {
    insBody.hidden = true;
  }

  setButtonWithIcon(insPrevBtn, 'Parent', 'sf-arrow-left');
  setButtonWithIcon(insNextBtn, 'Child', 'sf-arrow-right', true);
  setButtonWithIcon(insFollowBtn, 'Follow', 'sf-viewfinder');
  insFollowBtn.classList.toggle('is-active', followVillager);
  insFollowBtn.onclick = () => {
    followVillager = !followVillager;
    insFollowBtn.classList.toggle('is-active', followVillager);
    sound.playPop(followVillager ? 587.33 : 440);
    if (followVillager && cameraMode === 'walk') {
      setCameraMode('orbit');
    }
  };

  setButtonWithIcon(insCheerBtn, 'Celebrate', 'sf-sparkles');
  insCheerBtn.onclick = () => {
    if (!selectedVillager) return;
    sound.playSelectVillager('merge');
    selectedVillager.behavior = 'spin';
    selectedVillager.behaviorTimer = 2.6;
    selectedVillager.jumpVelocity = 8.4;
    triggerEmote(`c:${selectedVillager.commit.sha}`, selectedVillager, '🎉', 2.5);

    for (const other of villagers) {
      if (
        other !== selectedVillager &&
        other.root.position.distanceTo(selectedVillager.root.position) < 6.5
      ) {
        other.jumpVelocity = 6.5 + Math.random() * 2;
        other.behavior = 'jump_joy';
        other.behaviorTimer = 2.4;
        triggerEmote(`c:${other.commit.sha}`, other, '🙌', 2.2);
      }
    }
  };

  const loadedParent = commit.parents.find((p) => villagerBySha.has(p));
  const loadedChild = commit.children.find((c) => villagerBySha.has(c));
  insPrevBtn.disabled = !loadedParent;
  insNextBtn.disabled = !loadedChild;
  insPrevBtn.onclick = () => {
    if (loadedParent) {
      const pv = villagerBySha.get(loadedParent);
      if (pv) focusOnVillager(pv);
    }
  };
  insNextBtn.onclick = () => {
    if (loadedChild) {
      const cv = villagerBySha.get(loadedChild);
      if (cv) focusOnVillager(cv);
    }
  };

  insDiffPreview.hidden = true;
  renderCommitFiles(commit);

  if (!commit.files) {
    insDiffText.textContent = 'Loading…';
    try {
      if (activeGraph.isLocal && activeGraph.localPath) {
        await hydrateLocalCommitDetail(activeGraph.localPath, commit);
      } else if (!activeGraph.isDemo) {
        await hydrateCommitDetail(activeGraph.owner, activeGraph.repo, commit, tokenInput.value);
      }
      if (selectedVillager?.commit.sha === commit.sha) {
        renderCommitFiles(commit);
      }
    } catch {
      if (selectedVillager?.commit.sha === commit.sha) {
        insDiffText.textContent = 'Unavailable';
      }
    }
  }
}

function renderCommitFiles(commit: CommitData): void {
  const add = commit.stats?.additions ?? 0;
  const del = commit.stats?.deletions ?? 0;
  const total = Math.max(1, add + del);
  insDiffText.textContent = `+${add} / −${del}`;
  insDiffAddBar.style.width = `${Math.round((add / total) * 100)}%`;
  insDiffDelBar.style.width = `${Math.round((del / total) * 100)}%`;

  const files = commit.files ?? [];
  insFilesSummary.textContent = `Changed files (${files.length})`;
  const items = files.map((f) => {
    const li = document.createElement('li');
    const pathSpan = document.createElement('span');
    pathSpan.className = 'file-path';
    pathSpan.textContent = f.filename;
    pathSpan.title = f.filename;

    const deltaSpan = document.createElement('span');
    deltaSpan.className = 'file-delta';
    const aSpan = document.createElement('span');
    aSpan.className = 'delta-add';
    aSpan.textContent = `+${f.additions} `;
    const dSpan = document.createElement('span');
    dSpan.className = 'delta-del';
    dSpan.textContent = `−${f.deletions}`;
    deltaSpan.append(aSpan, dSpan);

    li.append(pathSpan, deltaSpan);
    return li;
  });
  insFilesList.replaceChildren(...items);
}

insCloseBtn.addEventListener('click', () => {
  selectedVillager = null;
  selectedGateVisitor = null;
  followVillager = false;
  insFollowBtn.classList.remove('is-active');
  inspectorCard.hidden = true;
});

// Filter Dock
function applyVillagerFilter(filter: string): void {
  activeFilter = filter;
  document.querySelectorAll<HTMLButtonElement>('.filter-pill[data-filter]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.filter === filter);
  });

  for (const v of villagers) {
    const match = filter === 'all' || v.commit.kind === filter;
    v.filterBeam.visible = filter !== 'all' && match;
    (v.filterBeam.material as THREE.MeshBasicMaterial).opacity = match ? 0.24 : 0;
    v.bodyGroup.visible = true;
  }
}

document.querySelectorAll<HTMLButtonElement>('.filter-pill[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    sound.playPop(520);
    applyVillagerFilter(btn.dataset.filter ?? 'all');
  });
});

gateDockBtn.addEventListener('click', () => {
  sound.playPop(587.33);
  flyToGate(true);
});

randomBtn.addEventListener('click', () => {
  if (villagers.length === 0) return;
  const pick = villagers[Math.floor(Math.random() * villagers.length)];
  focusOnVillager(pick);
});

resetCamBtn.addEventListener('click', () => {
  sound.playPop(440);
  flyToOverview();
});

// Citizens Roster Popover using Object.groupBy + Apple Inset Grouped Lists
function renderRosterPopover(): void {
  const sections: HTMLElement[] = [];

  if (activeGraph.isLocal && gateVisitors.length > 0) {
    const gateWrap = document.createElement('div');
    const gateTitle = document.createElement('div');
    gateTitle.className = 'roster-group-title';
    gateTitle.textContent = `Waiting at Gate (${gateVisitors.length})`;
    gateWrap.appendChild(gateTitle);

    const gateBox = document.createElement('div');
    gateBox.className = 'roster-group-box';

    for (const gv of gateVisitors) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roster-row';

      const subj = document.createElement('span');
      subj.className = 'roster-row-subj';
      const dot = document.createElement('span');
      dot.className = `status-dot ${getVisitorStatusMeta(gv.file.status).dotClass}`;
      const nameTxt = document.createElement('span');
      nameTxt.textContent = gv.file.filename;
      subj.append(dot, nameTxt);

      const delta = document.createElement('span');
      delta.className = 'roster-row-sha';
      delta.textContent = `${gv.file.staged ? 'Staged · ' : ''}+${gv.file.additions} −${gv.file.deletions}`;

      btn.append(subj, delta);
      btn.addEventListener('click', () => {
        rosterPopover.hidePopover?.();
        focusOnGateVisitor(gv);
      });
      gateBox.appendChild(btn);
    }
    gateWrap.appendChild(gateBox);
    sections.push(gateWrap);
  }

  const commits = villagers.map((v) => v.commit);
  const grouped: Partial<Record<string, CommitData[]>> =
    rosterGroupMode === 'branch'
      ? Object.groupBy(commits, (c): string => c.branch)
      : Object.groupBy(commits, (c): string => `@${c.authorLogin}`);

  for (const key of Object.keys(grouped)) {
    const list = grouped[key] ?? [];
    const wrapper = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'roster-group-title';
    title.textContent = `${key} (${list.length})`;
    wrapper.appendChild(title);

    const groupBox = document.createElement('div');
    groupBox.className = 'roster-group-box';

    for (const c of list.toReversed()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roster-row';
      const role = getRoleMeta(c.kind);

      const subj = document.createElement('span');
      subj.className = 'roster-row-subj';
      const dot = document.createElement('span');
      dot.className = `status-dot ${role.dotClass}`;
      const msgTxt = document.createElement('span');
      msgTxt.textContent = c.subject;
      subj.append(dot, msgTxt);

      const sha = document.createElement('span');
      sha.className = 'roster-row-sha';
      sha.textContent = c.shortSha;

      btn.append(subj, sha);
      btn.addEventListener('click', () => {
        rosterPopover.hidePopover?.();
        const ent = villagerBySha.get(c.sha);
        if (ent) focusOnVillager(ent);
      });
      groupBox.appendChild(btn);
    }
    wrapper.appendChild(groupBox);
    sections.push(wrapper);
  }
  rosterList.replaceChildren(...sections);
}

groupBranchBtn.addEventListener('click', () => {
  rosterGroupMode = 'branch';
  groupBranchBtn.setAttribute('aria-pressed', 'true');
  groupAuthorBtn.setAttribute('aria-pressed', 'false');
  renderRosterPopover();
});

groupAuthorBtn.addEventListener('click', () => {
  rosterGroupMode = 'author';
  groupAuthorBtn.setAttribute('aria-pressed', 'true');
  groupBranchBtn.setAttribute('aria-pressed', 'false');
  renderRosterPopover();
});

// Discovered Local Git Repositories & Folder Browser
let cachedDiscoveredRepos: DiscoveredLocalRepo[] = [];
let activeBrowseDirPath: string | undefined;

function buildRepoPresetCard(r: DiscoveredLocalRepo, onSelect: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset-card';
  const title = document.createElement('strong');
  title.textContent = r.name;
  const sub = document.createElement('span');
  sub.textContent = `${r.displayPath ?? r.path} · ${r.branch}`;
  const gateInfo = document.createElement('span');
  gateInfo.className = r.changedFilesCount > 0 ? 'local-badge' : 'local-badge is-clean';
  gateInfo.textContent =
    r.changedFilesCount > 0
      ? `${r.changedFilesCount} visitor${r.changedFilesCount === 1 ? '' : 's'} waiting at Gate`
      : 'Clean working tree';
  btn.append(title, sub, gateInfo);
  btn.addEventListener('click', onSelect);
  return btn;
}

function renderFilteredDiscoveredGrid(filterText = ''): void {
  const q = filterText.trim().toLowerCase();
  const filtered =
    !q || isLocalPathInput(q)
      ? cachedDiscoveredRepos
      : cachedDiscoveredRepos.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.displayPath ?? r.path).toLowerCase().includes(q) ||
            r.branch.toLowerCase().includes(q),
        );

  discoveredCountLabel.textContent = `${filtered.length} found`;
  const cards = filtered.map((r) =>
    buildRepoPresetCard(r, () => {
      closeTopLayerDialog(localPickerDialog);
      loadLocalRepo(r.path, true);
    }),
  );
  pickerDiscoveredGrid.replaceChildren(...cards);
}

async function refreshDiscoveredLocalRepos(): Promise<void> {
  const repos = await discoverLocalRepos();
  cachedDiscoveredRepos = repos;
  renderFilteredDiscoveredGrid(pickerPathInput.value);

  const cards = repos.slice(0, 5).map((r) =>
    buildRepoPresetCard(r, () => {
      presetsPopover.hidePopover?.();
      loadLocalRepo(r.path, true);
    }),
  );

  const browseMoreBtn = document.createElement('button');
  browseMoreBtn.type = 'button';
  browseMoreBtn.className = 'preset-card';
  const bTitle = document.createElement('strong');
  bTitle.textContent = 'Choose Another Folder…';
  const bSub = document.createElement('span');
  bSub.textContent = 'Browse directories on this Mac or open with Finder';
  browseMoreBtn.append(bTitle, bSub);
  browseMoreBtn.addEventListener('click', () => {
    presetsPopover.hidePopover?.();
    openLocalPickerModal();
  });

  localReposGrid.replaceChildren(...cards, browseMoreBtn);
}

async function loadPickerDirectory(targetPath?: string): Promise<void> {
  try {
    const data = await browseLocalDirectory(targetPath, pickerHiddenCheckbox.checked);
    activeBrowseDirPath = data.currentPath;

    const rootBtns = data.roots.map((rt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'root-chip';
      b.textContent = rt.label;
      b.addEventListener('click', () => loadPickerDirectory(rt.path));
      return b;
    });
    pickerRoots.replaceChildren(...rootBtns);

    const crumbItems = data.breadcrumbs.map((bc, idx) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = bc.label;
      if (idx === data.breadcrumbs.length - 1) {
        a.setAttribute('aria-current', 'page');
      }
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        loadPickerDirectory(bc.path);
      });
      li.appendChild(a);
      return li;
    });
    pickerBreadcrumbs.replaceChildren(...crumbItems);

    if (data.currentGitRepo) {
      const repo = data.currentGitRepo;
      pickerCurrentGitTitle.textContent = `${repo.name}`;
      pickerCurrentGitSub.textContent =
        repo.changedFilesCount > 0
          ? `Branch: ${repo.branch} · ${repo.changedFilesCount} changed file${repo.changedFilesCount === 1 ? '' : 's'} at Gate`
          : `Branch: ${repo.branch} · Clean working tree`;
      pickerLoadCurrentBtn.onclick = () => {
        closeTopLayerDialog(localPickerDialog);
        loadLocalRepo(repo.path, true);
      };
      pickerCurrentGitBanner.hidden = false;
    } else {
      pickerCurrentGitBanner.hidden = true;
    }

    const rows: HTMLElement[] = [];
    if (data.parentPath) {
      const upRow = document.createElement('div');
      upRow.className = 'folder-row';
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'folder-nav-btn';
      const arrowIcon = makeSfIcon('sf-arrow-left', 13, 'folder-icon-glyph');
      const upTxt = document.createElement('span');
      upTxt.className = 'folder-name-txt';
      upTxt.textContent = 'Enclosing Folder';
      upBtn.append(arrowIcon, upTxt);
      upBtn.addEventListener('click', () => loadPickerDirectory(data.parentPath!));
      upRow.appendChild(upBtn);
      rows.push(upRow);
    }

    for (const f of data.folders) {
      const row = document.createElement('div');
      row.className = f.isGitRepo ? 'folder-row is-git' : 'folder-row';

      const navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.className = 'folder-nav-btn';
      const iconSvg = makeSfIcon(f.isGitRepo ? 'sf-branch' : 'sf-folder', 14, 'folder-icon-glyph');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'folder-name-txt';
      nameSpan.textContent = f.name;
      navBtn.append(iconSvg, nameSpan);

      if (f.isGitRepo) {
        const tag = document.createElement('span');
        tag.className = 'git-folder-tag';
        tag.textContent = 'Git';
        navBtn.appendChild(tag);
      }

      navBtn.addEventListener('click', () => {
        loadPickerDirectory(f.path);
      });
      row.appendChild(navBtn);

      if (f.isGitRepo) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'sheet-btn sheet-btn-tinted';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          closeTopLayerDialog(localPickerDialog);
          loadLocalRepo(f.path, true);
        });
        row.appendChild(openBtn);
      }

      rows.push(row);
    }

    pickerFolderList.replaceChildren(...rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to read folder.';
    showToast(msg, true);
  }
}

function openLocalPickerModal(): void {
  sound.playPop(523.25);
  localPickerDialog.showModal();
  refreshDiscoveredLocalRepos();
  loadPickerDirectory(activeBrowseDirPath ?? activeGraph.localPath);
}

pickerHiddenCheckbox.addEventListener('change', () => {
  loadPickerDirectory(activeBrowseDirPath);
});

pickerPathInput.addEventListener('input', () => {
  renderFilteredDiscoveredGrid(pickerPathInput.value);
});

pickerPathForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = pickerPathInput.value.trim();
  if (!raw) return;

  try {
    const dirInfo = await browseLocalDirectory(raw, pickerHiddenCheckbox.checked);
    if (dirInfo.currentGitRepo) {
      closeTopLayerDialog(localPickerDialog);
      await loadLocalRepo(dirInfo.currentGitRepo.path, true);
    } else {
      await loadPickerDirectory(dirInfo.currentPath);
      showToast('Showing subfolders — select a Git repository below.');
    }
  } catch {
    closeTopLayerDialog(localPickerDialog);
    await loadLocalRepo(raw, true);
  }
});

nativeFinderBtn.addEventListener('click', async () => {
  nativeFinderBtn.disabled = true;
  try {
    const result = await pickNativeMacFolder();
    if (result.path && !result.cancelled) {
      closeTopLayerDialog(localPickerDialog);
      await loadLocalRepo(result.path, true);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Finder picker unavailable';
    showToast(msg, true);
  } finally {
    nativeFinderBtn.disabled = false;
  }
});

presetsPopover.addEventListener('beforetoggle', (e) => {
  if ((e as ToggleEvent).newState === 'open') {
    refreshDiscoveredLocalRepos();
  }
});

// Load a Local Git Repository
async function loadLocalRepo(pathSpec: string, updateUrl = true): Promise<void> {
  currentLoadController?.abort();
  const controller = new AbortController();
  currentLoadController = controller;
  loadBtn.disabled = true;
  showToast('Opening local repository…', false, 0);

  try {
    const graph = await loadLocalRepoVillage(pathSpec, controller.signal);
    const waitingCount = graph.gateVisitors?.length ?? 0;
    rebuildVillageFromGraph(graph, { focusGateOnLoad: waitingCount > 0 });
    repoInput.value = graph.localPath ?? pathSpec;
    sound.playRepoLoaded();

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete('repo');
      url.searchParams.set('local', graph.localPath ?? pathSpec);
      window.history.replaceState({}, '', url);
    }

    if (waitingCount > 0) {
      showToast(
        `${graph.repo} — ${waitingCount} uncommitted file${waitingCount === 1 ? '' : 's'} waiting at the Village Gate`,
      );
      if (gateVisitors.length > 0) {
        focusOnGateVisitor(gateVisitors[0], false, false);
      }
    } else {
      showToast(`${graph.repo} — Working tree clean, Village Gate open`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : 'Could not load local git repository.';
    showToast(message, true, 6000);
  } finally {
    loadBtn.disabled = false;
  }
}

// Live Polling for Local Git Working-Tree Changes
let isPollingLocal = false;
async function pollLocalRepoNow(manualFeedback = false): Promise<void> {
  if (!activeGraph.isLocal || !activeGraph.localPath || isPollingLocal) return;
  isPollingLocal = true;
  try {
    const freshGraph = await loadLocalRepoVillage(activeGraph.localPath);
    const freshFp = computeLocalGraphFingerprint(freshGraph);

    if (freshFp !== lastLocalFingerprint) {
      const prevHead = activeGraph.branches[0]?.commits.at(-1)?.sha;
      const nextHead = freshGraph.branches[0]?.commits.at(-1)?.sha;
      const prevCount = gateVisitors.length;
      const nextCount = freshGraph.gateVisitors?.length ?? 0;

      rebuildVillageFromGraph(freshGraph, { preserveCamera: true });
      sound.playPop(nextHead !== prevHead ? 659.25 : 523.25);

      if (nextHead !== prevHead) {
        showToast(
          `Gate opened — "${freshGraph.branches[0]?.commits.at(-1)?.subject ?? 'New commit'}" welcomed into the village`,
        );
      } else if (nextCount > prevCount) {
        showToast(
          `${nextCount - prevCount} new file visitor${nextCount - prevCount === 1 ? '' : 's'} arrived at the Gate (${nextCount} waiting)`,
        );
      } else {
        showToast(`Working tree updated — ${nextCount} visitor${nextCount === 1 ? '' : 's'} at the Gate`);
      }
    } else if (manualFeedback) {
      showToast(`Working tree synced — ${gateVisitors.length} file${gateVisitors.length === 1 ? '' : 's'} at Gate`);
    }
  } catch {
    // ignore background poll glitches
  } finally {
    isPollingLocal = false;
  }
}

window.setInterval(() => {
  if (document.visibilityState === 'visible' && activeGraph.isLocal) {
    pollLocalRepoNow(false);
  }
}, 3500);

// Repo Loading Flow
async function loadRepoBySpec(spec: string, updateUrl = true): Promise<void> {
  if (isLocalPathInput(spec)) {
    await loadLocalRepo(spec, updateUrl);
    return;
  }

  currentLoadController?.abort();
  if (spec === 'demo' || spec === 'git-archipelago/sky-village') {
    const demo = createDemoRepoGraph();
    rebuildVillageFromGraph(demo);
    repoInput.value = '';
    sound.playRepoLoaded();
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete('repo');
      url.searchParams.delete('local');
      window.history.replaceState({}, '', url);
    }
    showToast('Showcase Village — git-archipelago/sky-village');
    return;
  }

  const parsed = parseRepoInput(spec);
  if (!parsed) {
    showToast(
      'Enter a GitHub owner/repo or a local folder path (such as ~/Projects/app).',
      true,
    );
    return;
  }

  const controller = new AbortController();
  currentLoadController = controller;
  loadBtn.disabled = true;
  showToast(`Loading ${parsed.owner}/${parsed.repo}…`, false, 0);

  try {
    const graph = await loadGitHubRepoVillage(
      parsed.owner,
      parsed.repo,
      tokenInput.value,
      controller.signal,
    );
    rebuildVillageFromGraph(graph);
    repoInput.value = `${graph.owner}/${graph.repo}`;
    sound.playRepoLoaded();

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete('local');
      url.searchParams.set('repo', `${graph.owner}/${graph.repo}`);
      window.history.replaceState({}, '', url);
    }

    showToast(
      `${graph.owner}/${graph.repo} — ${villagers.length} commits across ${graph.branches.length} islands`,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : 'Could not load repository.';
    showToast(message, true, 6000);
  } finally {
    loadBtn.disabled = false;
  }
}

repoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = repoInput.value.trim();
  if (!val) {
    presetsPopover.showPopover?.();
    return;
  }
  loadRepoBySpec(val);
});

localQuickBtn.addEventListener('click', () => {
  openLocalPickerModal();
});

document.querySelectorAll<HTMLButtonElement>('.preset-card[data-repo]').forEach((card) => {
  card.addEventListener('click', () => {
    presetsPopover.hidePopover?.();
    const repo = card.dataset.repo ?? 'demo';
    loadRepoBySpec(repo);
  });
});

document.querySelectorAll<HTMLButtonElement>('.preset-card[data-local]').forEach((card) => {
  card.addEventListener('click', () => {
    presetsPopover.hidePopover?.();
    loadLocalRepo(card.dataset.local ?? '.', true);
  });
});

// Toolbar Toggles: Sky, Sound, Walk Mode (ARIA-driven state)
skyBtn.addEventListener('click', () => {
  const order: TimeOfDay[] = ['day', 'sunset', 'night'];
  const next = order[(order.indexOf(timeOfDay) + 1) % order.length];
  applyAtmosphere(next);
  sound.playPop(523.25);
});

soundBtn.addEventListener('click', () => {
  const muted = sound.toggleMute();
  soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
  soundIconUse.setAttribute('href', muted ? '#sf-speaker-mute' : '#sf-speaker');
});

function setCameraMode(mode: CameraMode): void {
  cameraMode = mode;
  const isWalk = mode === 'walk';
  modeBtn.setAttribute('aria-pressed', isWalk ? 'true' : 'false');
  explorer.root.visible = isWalk;
  walkHint.hidden = !isWalk;

  if (isWalk && builtWorld) {
    followVillager = false;
    insFollowBtn.classList.remove('is-active');
    const spawnBase = selectedGateVisitor
      ? selectedGateVisitor.root.position.clone().add(new THREE.Vector3(-1.2, 0, 0))
      : selectedVillager
        ? selectedVillager.root.position.clone().add(new THREE.Vector3(0.9, 0, 0.9))
        : builtWorld.islands[0].pathCurve.getPointAt(0.5);
    const surfaceY = sampleWalkableSurfaceY(spawnBase.x, spawnBase.z, spawnBase.y);
    explorer.root.position.set(spawnBase.x, surfaceY ?? spawnBase.y, spawnBase.z);
    explorerVelocity.y = 0;
    explorerVelocity.grounded = true;
    camera.position.set(
      explorer.root.position.x,
      explorer.root.position.y + 4.8,
      explorer.root.position.z + 8.5,
    );
    controls.target.copy(explorer.root.position).add(new THREE.Vector3(0, 1.0, 0));
    sound.playPop(620);
  } else {
    sound.playPop(440);
  }
}

modeBtn.addEventListener('click', () => {
  setCameraMode(cameraMode === 'orbit' ? 'walk' : 'orbit');
});

// Walkable Surface Evaluator
function sampleWalkableSurfaceY(x: number, z: number, currentY: number): number | null {
  if (!builtWorld) return null;
  let bestY: number | null = null;
  let bestDiff = Infinity;

  for (const isl of builtWorld.islands) {
    const dx = Math.abs(x - isl.center.x);
    const dz = Math.abs(z - isl.center.z);
    if (dx <= isl.length * 0.48 && dz <= isl.width * 0.46) {
      const deckY = isl.center.y + 0.03;
      const diff = Math.abs(deckY - currentY);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestY = deckY;
      }
    }
  }

  if (builtWorld.gate) {
    const g = builtWorld.gate;
    const dx = Math.abs(x - g.dockCenter.x);
    const dz = Math.abs(z - g.dockCenter.z);
    if (dx <= g.dockLength * 0.54 && dz <= g.dockWidth * 0.46) {
      const diff = Math.abs(0.05 - currentY);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestY = 0.05;
      }
    }
  }

  for (const br of builtWorld.bridges) {
    const samples = 22;
    for (let i = 0; i <= samples; i++) {
      const pt = br.curve.getPointAt(i / samples);
      const distXZ = Math.hypot(x - pt.x, z - pt.z);
      if (distXZ <= 0.88) {
        const diff = Math.abs(pt.y - currentY);
        if (diff < bestDiff + 0.8) {
          bestDiff = diff;
          bestY = pt.y + 0.05;
        }
      }
    }
  }

  return bestY;
}

window.addEventListener('keydown', (e) => {
  if (
    helpDialog.open ||
    localPickerDialog.open ||
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement
  ) {
    return;
  }
  const code = e.code;
  keysPressed.add(code);

  if (cameraMode === 'walk') {
    if (code === 'Space' && explorerVelocity.grounded) {
      e.preventDefault();
      explorerVelocity.y = 7.2;
      explorerVelocity.grounded = false;
      sound.playPop(540);
    } else if (code === 'KeyE') {
      let minDist = 3.4;
      let closestVillager: VillagerEntity | null = null;
      let closestVisitor: GateVisitorEntity | null = null;

      for (const v of villagers) {
        const d = v.root.position.distanceTo(explorer.root.position);
        if (d < minDist) {
          minDist = d;
          closestVillager = v;
          closestVisitor = null;
        }
      }
      for (const gv of gateVisitors) {
        const d = gv.root.position.distanceTo(explorer.root.position);
        if (d < minDist) {
          minDist = d;
          closestVisitor = gv;
          closestVillager = null;
        }
      }

      if (closestVisitor) focusOnGateVisitor(closestVisitor);
      else if (closestVillager) focusOnVillager(closestVillager);
    }
  }
});

window.addEventListener('keyup', (e) => {
  keysPressed.delete(e.code);
});

// Pointer Raycasting
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };

function getAllHitBoxes(): THREE.Object3D[] {
  const boxes: THREE.Object3D[] = [];
  for (const v of villagers) boxes.push(v.hitBox);
  for (const gv of gateVisitors) boxes.push(gv.hitBox);
  return boxes;
}

canvas.addEventListener('pointermove', (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(getAllHitBoxes(), false);

  if (hits.length > 0) {
    const ud = hits[0].object.userData;
    if (typeof ud.visitorIndex === 'number') {
      const gv = gateVisitors[ud.visitorIndex] ?? null;
      if (gv !== hoveredGateVisitor) {
        hoveredGateVisitor = gv;
        hoveredVillager = null;
        if (gv) sound.playHover();
      }
      if (gv) {
        canvas.style.cursor = 'pointer';
        hoverPill.textContent = `${gv.file.staged ? 'Staged' : 'Gate'} · ${gv.file.filename} (+${gv.file.additions} / −${gv.file.deletions})`;
        hoverPill.style.left = `${e.clientX}px`;
        hoverPill.style.top = `${e.clientY}px`;
        hoverPill.hidden = false;
      }
      return;
    }

    const sha = ud.commitSha as string;
    const ent = villagerBySha.get(sha) ?? null;
    if (ent !== hoveredVillager) {
      hoveredVillager = ent;
      hoveredGateVisitor = null;
      if (ent) sound.playHover();
    }
    if (ent) {
      canvas.style.cursor = 'pointer';
      hoverPill.textContent = `${ent.commit.shortSha} · ${ent.commit.subject}`;
      hoverPill.style.left = `${e.clientX}px`;
      hoverPill.style.top = `${e.clientY}px`;
      hoverPill.hidden = false;
    }
  } else {
    hoveredVillager = null;
    hoveredGateVisitor = null;
    canvas.style.cursor = '';
    hoverPill.hidden = true;
  }
});

canvas.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  if (moved > 6) return;

  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(getAllHitBoxes(), false);
  if (hits.length > 0) {
    const ud = hits[0].object.userData;
    if (typeof ud.visitorIndex === 'number') {
      const gv = gateVisitors[ud.visitorIndex];
      if (gv) focusOnGateVisitor(gv);
      return;
    }
    const sha = ud.commitSha as string;
    const ent = villagerBySha.get(sha);
    if (ent) focusOnVillager(ent);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 5. Simulation & Animation Loop
const clock = new THREE.Clock();
const projVec = new THREE.Vector3();
const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();

function findConnectedBridge(branchName: string): { bridge: BridgeLayout; dir: 1 | -1 } | null {
  if (!builtWorld) return null;
  const candidates: Array<{ bridge: BridgeLayout; dir: 1 | -1 }> = [];
  for (const b of builtWorld.bridges) {
    if (b.fromBranch === branchName) candidates.push({ bridge: b, dir: 1 });
    else if (b.toBranch === branchName) candidates.push({ bridge: b, dir: -1 });
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function updateGateAndVisitors(dt: number, elapsed: number): void {
  if (!builtWorld?.gate) return;
  const gate = builtWorld.gate;

  if (gatePreviewOpenTimer > 0) {
    gatePreviewOpenTimer = Math.max(0, gatePreviewOpenTimer - dt);
  }

  const shouldOpenDoors = gateVisitors.length === 0 || gatePreviewOpenTimer > 0.8;
  const targetLeftRot = shouldOpenDoors ? 1.38 : 0;
  const targetRightRot = shouldOpenDoors ? -1.38 : 0;
  gate.leftDoorPivot.rotation.y +=
    (targetLeftRot - gate.leftDoorPivot.rotation.y) * Math.min(1, dt * 7);
  gate.rightDoorPivot.rotation.y +=
    (targetRightRot - gate.rightDoorPivot.rotation.y) * Math.min(1, dt * 7);

  for (const gv of gateVisitors) {
    const isHovered = gv === hoveredGateVisitor;
    const isSelected = gv === selectedGateVisitor;

    const auraMat = gv.auraRing.material as THREE.MeshBasicMaterial;
    const baseOpacity = gv.file.staged ? 0.58 : 0.25;
    const targetOp = isSelected ? 0.95 : isHovered ? 0.78 : baseOpacity;
    auraMat.opacity += (targetOp - auraMat.opacity) * Math.min(1, dt * 10);

    if (gv.ticketMesh) {
      gv.ticketMesh.rotation.y += dt * 2.4;
      gv.ticketMesh.position.y = 1.56 + Math.sin(elapsed * 3.5 + gv.phaseOffset) * 0.08;
    }

    const dest = gatePreviewOpenTimer > 0.9 ? gv.rushTarget : gv.queueSlot;
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
      const dx = camera.position.x - gv.root.position.x;
      const dz = camera.position.z - gv.root.position.z;
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
      gv.jumpVelocity = 4.6 + (gv.file.staged ? 1.4 : 0.4);
      gv.hopTimer = 1.1 + ((gv.index % 5) * 0.45) + Math.random() * 1.2;
      if (gv.emoteTimer <= 0 && Math.random() < 0.36) {
        const emotes = getVisitorStatusMeta(gv.file.status).emotes;
        triggerVisitorEmote(gv, emotes[Math.floor(Math.random() * emotes.length)], 1.8);
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

    if (gv.emoteTimer > 0) {
      gv.emoteTimer -= dt;
      const el = emoteElements.get(`v:${gv.index}`);
      if (el) {
        if (gv.emoteTimer <= 0) {
          el.hidden = true;
        } else {
          projVec.copy(gv.root.position);
          projVec.y += 1.9 + gv.jumpY;
          projVec.project(camera);
          if (projVec.z < 1) {
            el.style.left = `${(projVec.x * 0.5 + 0.5) * window.innerWidth}px`;
            el.style.top = `${(-projVec.y * 0.5 + 0.5) * window.innerHeight}px`;
            el.hidden = false;
          } else {
            el.hidden = true;
          }
        }
      }
    }
  }
}

function updateVillagers(dt: number, elapsed: number): void {
  const count = villagers.length;

  for (let i = 0; i < count; i++) {
    const v = villagers[i];
    const isHovered = v === hoveredVillager;
    const isSelected = v === selectedVillager;

    const auraMat = v.auraRing.material as THREE.MeshBasicMaterial;
    const targetOpacity = isSelected ? 0.92 : isHovered ? 0.65 : 0.0;
    auraMat.opacity += (targetOpacity - auraMat.opacity) * Math.min(1, dt * 10);
    if (isSelected) {
      const pulse = 1 + Math.sin(elapsed * 5) * 0.1;
      v.auraRing.scale.setScalar(pulse);
    } else {
      v.auraRing.scale.setScalar(1);
    }

    if (v.emoteTimer > 0) {
      v.emoteTimer -= dt;
      const el = emoteElements.get(`c:${v.commit.sha}`);
      if (el) {
        if (v.emoteTimer <= 0) {
          el.hidden = true;
        } else {
          projVec.copy(v.root.position);
          projVec.y += 1.85 + v.jumpY;
          projVec.project(camera);
          if (projVec.z < 1) {
            const sx = (projVec.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-projVec.y * 0.5 + 0.5) * window.innerHeight;
            el.style.left = `${sx}px`;
            el.style.top = `${sy}px`;
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
      const roll = Math.random();
      if (roll < 0.44) {
        v.behavior = 'stroll';
        v.behaviorTimer = 3.0 + Math.random() * 4.0;
      } else if (roll < 0.72) {
        v.behavior = 'jump_joy';
        v.behaviorTimer = 2.0 + Math.random() * 2.2;
        const emotes = getRoleMeta(v.commit.kind).defaultEmotes;
        if (Math.random() < 0.45) {
          triggerEmote(
            `c:${v.commit.sha}`,
            v,
            emotes[Math.floor(Math.random() * emotes.length)],
            1.8,
          );
        }
      } else if (roll < 0.87) {
        v.behavior = 'tinker';
        v.behaviorTimer = 2.2 + Math.random() * 2.0;
      } else if (roll < 0.94) {
        v.behavior = 'spin';
        v.behaviorTimer = 1.4;
        v.jumpVelocity = 6.2;
      } else {
        const conn = findConnectedBridge(v.island.branch.name);
        if (conn) {
          v.behavior = 'bridge_walk';
          v.activeBridge = {
            curve: conn.bridge.curve,
            t: conn.dir === 1 ? 0 : 1,
            dir: conn.dir,
          };
          v.behaviorTimer = 8.0;
        } else {
          v.behavior = 'stroll';
          v.behaviorTimer = 3.0;
        }
      }
    }

    if (isHovered) {
      const dx = camera.position.x - v.root.position.x;
      const dz = camera.position.z - v.root.position.z;
      v.bodyGroup.rotation.y = Math.atan2(dx, dz);
      v.rightArm.rotation.x = -2.2 + Math.sin(elapsed * 12) * 0.45;
      v.leftArm.rotation.x = Math.sin(elapsed * 5) * 0.15;
      if (v.jumpY === 0 && Math.random() < dt * 2.2) {
        v.jumpVelocity = 4.6;
      }
    } else if (v.behavior === 'bridge_walk' && v.activeBridge) {
      const br = v.activeBridge;
      br.t += br.dir * dt * 0.22;
      if (br.t >= 1 || br.t <= 0) {
        if (Math.random() < 0.5) {
          br.dir = (br.dir * -1) as 1 | -1;
          br.t = Math.max(0, Math.min(1, br.t));
        } else {
          v.activeBridge = undefined;
          v.behavior = 'stroll';
          v.behaviorTimer = 3.0;
          const pt = v.island.pathCurve.getPointAt(v.pathT);
          v.root.position.copy(pt);
        }
      } else {
        const pt = br.curve.getPointAt(br.t);
        const nextT = Math.max(0, Math.min(1, br.t + br.dir * 0.03));
        const nextPt = br.curve.getPointAt(nextT);
        v.root.position.copy(pt);
        if (nextPt.distanceToSquared(pt) > 0.0001) {
          v.bodyGroup.rotation.y = Math.atan2(nextPt.x - pt.x, nextPt.z - pt.z);
        }
        const walkCycle = elapsed * 10 + v.phaseOffset;
        v.leftLeg.rotation.x = Math.sin(walkCycle) * 0.65;
        v.rightLeg.rotation.x = -Math.sin(walkCycle) * 0.65;
        v.leftArm.rotation.x = -Math.sin(walkCycle) * 0.5;
        v.rightArm.rotation.x = Math.sin(walkCycle) * 0.5;
        v.jumpY = Math.abs(Math.sin(walkCycle)) * 0.09;
      }
    } else if (v.behavior === 'stroll') {
      v.pathT += v.pathDir * v.speed * dt;
      if (v.pathT > 0.95) {
        v.pathT = 0.95;
        v.pathDir = -1;
      } else if (v.pathT < 0.05) {
        v.pathT = 0.05;
        v.pathDir = 1;
      }

      const pt = v.island.pathCurve.getPointAt(v.pathT);
      const aheadT = Math.max(0, Math.min(1, v.pathT + v.pathDir * 0.02));
      const aheadPt = v.island.pathCurve.getPointAt(aheadT);

      const laneOffset = ((i % 3) - 1) * 0.52;
      v.root.position.set(pt.x, pt.y, pt.z + laneOffset);

      if (aheadPt.distanceToSquared(pt) > 0.00005) {
        const yaw = Math.atan2(aheadPt.x - pt.x, aheadPt.z - pt.z);
        v.bodyGroup.rotation.y = yaw;
      }

      const cycle = elapsed * 8.5 + v.phaseOffset;
      v.leftLeg.rotation.x = Math.sin(cycle) * 0.6;
      v.rightLeg.rotation.x = -Math.sin(cycle) * 0.6;
      v.leftArm.rotation.x = -Math.sin(cycle) * 0.45;
      v.rightArm.rotation.x = Math.sin(cycle) * 0.45;
      if (v.jumpY === 0) {
        v.bodyGroup.position.y = Math.abs(Math.sin(cycle)) * 0.11;
      }
    } else if (v.behavior === 'jump_joy') {
      if (v.jumpY === 0) {
        v.jumpVelocity = 5.4 + (v.commit.kind === 'feat' ? 1.4 : 0);
      }
      v.leftLeg.rotation.x = v.jumpY > 0.1 ? -0.35 : 0;
      v.rightLeg.rotation.x = v.jumpY > 0.1 ? 0.35 : 0;
      v.leftArm.rotation.x = -2.3 + Math.sin(elapsed * 14 + v.phaseOffset) * 0.35;
      v.rightArm.rotation.x = -2.3 - Math.sin(elapsed * 14 + v.phaseOffset) * 0.35;
    } else if (v.behavior === 'tinker') {
      const swing = Math.sin(elapsed * 11 + v.phaseOffset);
      v.rightArm.rotation.x = -0.9 + swing * 0.75;
      v.leftArm.rotation.x = -0.3 - swing * 0.2;
      v.leftLeg.rotation.x = 0;
      v.rightLeg.rotation.x = 0;
      v.headGroup.rotation.x = Math.sin(elapsed * 5.5) * 0.14;
    } else if (v.behavior === 'spin') {
      v.bodyGroup.rotation.y += dt * 9.5;
      v.leftArm.rotation.x = -2.5;
      v.rightArm.rotation.x = -2.5;
    }

    if (v.jumpY > 0) {
      v.bodyGroup.position.y = v.jumpY;
    }

    if (v.emoteTimer <= 0 && (i + Math.floor(elapsed * 60)) % 45 === 0) {
      const other = villagers[(i + 1) % count];
      if (other && other !== v && other.root.position.distanceToSquared(v.root.position) < 4.5) {
        triggerEmote(`c:${v.commit.sha}`, v, '👋', 1.5);
      }
    }
  }
}

function updateExplorerWalk(dt: number, elapsed: number): void {
  if (cameraMode !== 'walk') return;

  camera.getWorldDirection(forwardVec);
  forwardVec.y = 0;
  if (forwardVec.lengthSq() > 0.0001) forwardVec.normalize();
  rightVec.crossVectors(forwardVec, new THREE.Vector3(0, 1, 0)).normalize();

  let moveX = 0;
  let moveZ = 0;
  if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) {
    moveX += forwardVec.x;
    moveZ += forwardVec.z;
  }
  if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) {
    moveX -= forwardVec.x;
    moveZ -= forwardVec.z;
  }
  if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) {
    moveX += rightVec.x;
    moveZ += rightVec.z;
  }
  if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) {
    moveX -= rightVec.x;
    moveZ -= rightVec.z;
  }

  const len = Math.hypot(moveX, moveZ);
  const walkSpeed = 6.8;
  const movedDelta = new THREE.Vector3();

  if (len > 0.01) {
    moveX = (moveX / len) * walkSpeed * dt;
    moveZ = (moveZ / len) * walkSpeed * dt;
    const candX = explorer.root.position.x + moveX;
    const candZ = explorer.root.position.z + moveZ;
    const surfaceY = sampleWalkableSurfaceY(candX, candZ, explorer.root.position.y);

    if (surfaceY !== null) {
      movedDelta.set(candX - explorer.root.position.x, 0, candZ - explorer.root.position.z);
      explorer.root.position.x = candX;
      explorer.root.position.z = candZ;
      if (explorerVelocity.grounded) {
        const prevY = explorer.root.position.y;
        explorer.root.position.y += (surfaceY - prevY) * Math.min(1, dt * 16);
        movedDelta.y = explorer.root.position.y - prevY;
      }
    }

    explorer.bodyGroup.rotation.y = Math.atan2(moveX, moveZ);
    const cyc = elapsed * 12;
    explorer.leftLeg.rotation.x = Math.sin(cyc) * 0.7;
    explorer.rightLeg.rotation.x = -Math.sin(cyc) * 0.7;
    explorer.leftArm.rotation.x = -Math.sin(cyc) * 0.55;
    explorer.rightArm.rotation.x = Math.sin(cyc) * 0.55;
  } else {
    explorer.leftLeg.rotation.x = 0;
    explorer.rightLeg.rotation.x = 0;
    explorer.leftArm.rotation.x = 0;
    explorer.rightArm.rotation.x = 0;
  }

  if (!explorerVelocity.grounded) {
    const prevY = explorer.root.position.y;
    explorer.root.position.y += explorerVelocity.y * dt;
    explorerVelocity.y -= 20.0 * dt;
    const floorY =
      sampleWalkableSurfaceY(
        explorer.root.position.x,
        explorer.root.position.z,
        explorer.root.position.y,
      ) ?? 0;
    if (explorer.root.position.y <= floorY) {
      explorer.root.position.y = floorY;
      explorerVelocity.y = 0;
      explorerVelocity.grounded = true;
    }
    movedDelta.y = explorer.root.position.y - prevY;
  }

  camera.position.add(movedDelta);
  controls.target.set(
    explorer.root.position.x,
    explorer.root.position.y + 1.05,
    explorer.root.position.z,
  );
}

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const elapsed = clock.elapsedTime;

  if (builtWorld) {
    for (const blade of builtWorld.animatedProps.windmillBlades) {
      blade.rotation.z -= dt * 0.85;
    }
    for (const cr of builtWorld.animatedProps.floatingCrystals) {
      cr.mesh.position.y = cr.baseY + Math.sin(elapsed * 1.8 + cr.phase) * 0.22;
      cr.mesh.rotation.y += dt * 0.7;
    }
    for (const cl of builtWorld.animatedProps.clouds) {
      cl.mesh.position.x += cl.speed * dt;
      if (cl.mesh.position.x > 55) cl.mesh.position.x = -55;
    }
    if (builtWorld.animatedProps.headBeacon) {
      builtWorld.animatedProps.headBeacon.rotation.y += dt * 1.4;
      builtWorld.animatedProps.headBeacon.position.y = 1.55 + Math.sin(elapsed * 2.6) * 0.16;
    }
    if (builtWorld.animatedProps.fireflies) {
      builtWorld.animatedProps.fireflies.rotation.y = Math.sin(elapsed * 0.12) * 0.15;
    }
  }

  updateVillagers(dt, elapsed);
  updateGateAndVisitors(dt, elapsed);
  updateExplorerWalk(dt, elapsed);

  if (followVillager && selectedVillager && cameraMode === 'orbit') {
    const targetLook = selectedVillager.root.position.clone().add(new THREE.Vector3(0.8, 1.0, 0));
    const delta = targetLook.clone().sub(controls.target);
    controls.target.addScaledVector(delta, Math.min(1, dt * 6));
    camera.position.addScaledVector(delta, Math.min(1, dt * 6));
  } else if (cameraFlight.active && cameraMode === 'orbit') {
    controls.target.lerp(cameraFlight.targetLook, Math.min(1, dt * 5.2));
    camera.position.lerp(cameraFlight.targetPos, Math.min(1, dt * 4.5));
    if (
      camera.position.distanceTo(cameraFlight.targetPos) < 0.15 &&
      controls.target.distanceTo(cameraFlight.targetLook) < 0.1
    ) {
      cameraFlight.active = false;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// 6. Boot!
const initialParams = new URL(window.location.href).searchParams;
const initialLocal = initialParams.get('local');
const initialRepo = initialParams.get('repo');

rebuildVillageFromGraph(activeGraph);
animate();

if (initialLocal) {
  loadLocalRepo(initialLocal, false);
} else if (initialRepo) {
  repoInput.value = initialRepo;
  loadRepoBySpec(initialRepo, false);
}
