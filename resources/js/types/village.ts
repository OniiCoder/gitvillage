import type * as THREE from 'three';

export type CommitKind = 'feat' | 'fix' | 'merge' | 'docs' | 'refactor' | 'chore';

export interface ConflictDiffSides {
  oursLabel: string;
  theirsLabel: string;
  oursContent: string;
  theirsContent: string;
  conflictMarkersCount: number;
}

export interface CommitFileChange {
  filename: string;
  previousFilename?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'conflicted';
  additions: number;
  deletions: number;
  patch?: string;
  conflict?: ConflictDiffSides;
}

export type WorkingTreeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GateVisitorFile {
  filename: string;
  status: WorkingTreeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  diffPreview?: string;
  conflict?: ConflictDiffSides;
}

export interface MergeConflictInfo {
  active: boolean;
  oursBranch: string;
  theirsBranch: string;
  conflictedCount: number;
  mergeHeadSha?: string;
  isSimulated?: boolean;
}

export interface CoAuthorInfo {
  name: string;
  login: string;
  email?: string;
}

export interface TagMonumentData {
  name: string;
  sha: string;
}

export interface StashEntryData {
  index: number;
  selector: string;
  message: string;
  sha: string;
  timestamp: string;
  branch?: string;
  filesCount?: number;
}

export type BranchSeason = 'lush' | 'autumn' | 'winter';

export interface HotspotLandmarkData {
  kind: 'hotspot' | 'monument';
  filename: string;
  touches: number;
  fixCount: number;
  churnLines: number;
  authorsCount: number;
  lastTouchedIso: string;
}

export type XRayLens = 'none' | 'bus_factor' | 'hotspots' | 'ghosts';

export interface BisectState {
  active: boolean;
  orderedShas: string[];
  lowIdx: number;
  highIdx: number;
  midIdx: number;
  step: number;
  maxSteps: number;
  resolvedCulpritSha: string | null;
}

export interface RebaseAnimState {
  active: boolean;
  mode: 'merge' | 'rebase';
  branchName: string;
  progress: number;
}

export interface CommitData {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  authorName: string;
  authorLogin: string;
  authorAvatar?: string;
  timestamp: string; // ISO 8601
  branch: string;
  parents: string[];
  children: string[];
  kind: CommitKind;
  htmlUrl?: string;
  filesCount?: number;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: CommitFileChange[];
  patchesHydrated?: boolean;
  coAuthors?: CoAuthorInfo[];
  cherryPickTwinSha?: string;
  isGhost?: boolean;
  reflogAction?: string;
  isRebasedClone?: boolean;
  rebasedFromSha?: string;
}

export interface BranchIslandData {
  name: string;
  isDefault: boolean;
  color: string;
  commits: CommitData[]; // chronological oldest -> newest along island
  forkFromSha?: string;
  mergeIntoSha?: string;
  season?: BranchSeason;
  ageDays?: number;
  busFactor?: number;
  soloOwnerKey?: string;
  soloOwnerName?: string;
}

export type CiWeatherStatus = 'passing' | 'failing' | 'pending' | 'unknown';

export interface CiWeatherInfo {
  status: CiWeatherStatus;
  summary: string;
  sha?: string;
  htmlUrl?: string;
}

export interface RepoVillageGraph {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  currentBranch?: string;
  headBranch?: string;
  allBranches?: string[];
  stars: number;
  isDemo?: boolean;
  isLocal?: boolean;
  localPath?: string;
  gateVisitors?: GateVisitorFile[];
  ciWeather?: CiWeatherInfo;
  mergeConflict?: MergeConflictInfo;
  tags?: TagMonumentData[];
  stashes?: StashEntryData[];
  ghostCommits?: CommitData[];
  cherryPickPairs?: Array<{ fromSha: string; toSha: string }>;
  hotspots?: HotspotLandmarkData[];
  repoBusFactor?: number;
  branches: BranchIslandData[];
  commitsBySha: Map<string, CommitData>;
}

export interface IslandLayout {
  branch: BranchIslandData;
  meshGroup: THREE.Group;
  center: THREE.Vector3;
  length: number;
  width: number;
  pathCurve: THREE.CatmullRomCurve3;
  commitWaypoints: Map<string, THREE.Vector3>;
  signMesh?: THREE.Object3D;
}

export interface GateLayout {
  archPosition: THREE.Vector3;
  dockCenter: THREE.Vector3;
  dockLength: number;
  dockWidth: number;
  leftDoorPivot: THREE.Object3D;
  rightDoorPivot: THREE.Object3D;
  targetIslandPos: THREE.Vector3;
  visitorSlots: THREE.Vector3[];
}

export interface BrokenBridgePlank {
  mesh: THREE.Object3D;
  brokenPos: THREE.Vector3;
  brokenRot: THREE.Euler;
  healedPos: THREE.Vector3;
  healedRot: THREE.Euler;
  hiddenWhenBroken?: boolean;
}

export interface BridgeLayout {
  kind: 'fork' | 'merge';
  fromBranch: string;
  toBranch: string;
  meshGroup: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  traversalCurve: THREE.CatmullRomCurve3;
  entryPathT: number;
  exitPathT: number;
  isConflicted?: boolean;
  conflictRiftGroup?: THREE.Group;
  brokenPlanks?: BrokenBridgePlank[];
}

export type VillagerBehavior =
  | 'stroll'
  | 'jump_joy'
  | 'tinker'
  | 'chat'
  | 'spin'
  | 'bridge_walk';

export interface VillagerEntity {
  commit: CommitData;
  authorKey: string;
  clanColor: number;
  island: IslandLayout;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  cargoGroup: THREE.Group;
  archetypeGroup: THREE.Group;
  coAuthorGroup?: THREE.Group;
  portalRing?: THREE.Object3D;
  burden: number;
  spawnScale: number;
  auraRing: THREE.Mesh;
  filterBeam: THREE.Mesh;
  hitBox: THREE.Mesh;
  homePos: THREE.Vector3;
  pathT: number;
  pathDir: 1 | -1;
  speed: number;
  collisionRadius: number;
  baseLane: number;
  lateralOffset: number;
  bumpVelX: number;
  bumpVelZ: number;
  bumpTiltX: number;
  bumpTiltZ: number;
  bumpCooldown: number;
  yieldTimer: number;
  behavior: VillagerBehavior;
  behaviorTimer: number;
  jumpPhase: number;
  jumpVelocity: number;
  jumpY: number;
  phaseOffset: number;
  emoteEmoji: string;
  emoteTimer: number;
  activeBridge?: {
    bridge: BridgeLayout;
    toIsland: IslandLayout;
    curve: THREE.CatmullRomCurve3;
    t: number;
    dir: 1 | -1;
  };
}

export interface GateVisitorEntity {
  file: GateVisitorFile;
  index: number;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  cargoGroup: THREE.Group;
  burden: number;
  ticketMesh?: THREE.Object3D;
  duelRig?: {
    oursBody: THREE.Group;
    theirsBody: THREE.Group;
    oursArm: THREE.Object3D;
    theirsArm: THREE.Object3D;
    clashSpark: THREE.Object3D;
  };
  auraRing: THREE.Mesh;
  hitBox: THREE.Mesh;
  queueSlot: THREE.Vector3;
  rushTarget: THREE.Vector3;
  jumpY: number;
  jumpVelocity: number;
  phaseOffset: number;
  hopTimer: number;
  emoteEmoji: string;
  emoteTimer: number;
}

export type TimeOfDay = 'day' | 'sunset' | 'night' | 'storm';
export type CameraMode = 'orbit' | 'walk';

export interface TimeLapseState {
  active: boolean;
  paused: boolean;
  currentIndex: number;
  totalCommits: number;
  currentCommit: CommitData | null;
}

export interface ShowcaseRepo {
  slug: string;
  title: string;
  subtitle: string;
}

export interface VillagePageProps {
  initialRepo: string | null;
  initialLocal: string | null;
  initialBranch?: string | null;
  directorMode: boolean;
  localServerEnabled: boolean;
  nativeFinderSupported: boolean;
  showcaseRepos: ShowcaseRepo[];
}

export type InspectorSelection =
  | {
      kind: 'commit';
      commit: CommitData;
      hasParent: boolean;
      hasChild: boolean;
      isHydratingDiff?: boolean;
    }
  | {
      kind: 'visitor';
      visitor: GateVisitorFile;
      index: number;
      totalVisitors: number;
    }
  | {
      kind: 'stash';
      stash: StashEntryData;
      totalStashes: number;
    }
  | {
      kind: 'landmark';
      landmark: HotspotLandmarkData;
    }
  | null;

