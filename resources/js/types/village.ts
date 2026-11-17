import type * as THREE from 'three';

export type CommitKind = 'feat' | 'fix' | 'merge' | 'docs' | 'refactor' | 'chore';

export interface CommitFileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
}

export type WorkingTreeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface GateVisitorFile {
  filename: string;
  status: WorkingTreeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  diffPreview?: string;
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
}

export interface BranchIslandData {
  name: string;
  isDefault: boolean;
  color: string;
  commits: CommitData[]; // chronological oldest -> newest along island
  forkFromSha?: string;
  mergeIntoSha?: string;
}

export interface RepoVillageGraph {
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  currentBranch?: string;
  stars: number;
  isDemo?: boolean;
  isLocal?: boolean;
  localPath?: string;
  gateVisitors?: GateVisitorFile[];
  branches: BranchIslandData[];
  commitsBySha: Map<string, CommitData>;
}

export interface IslandLayout {
  branch: BranchIslandData;
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

export interface BridgeLayout {
  fromBranch: string;
  toBranch: string;
  curve: THREE.CatmullRomCurve3;
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
  burden: number;
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

export type TimeOfDay = 'day' | 'sunset' | 'night';
export type CameraMode = 'orbit' | 'walk';

export interface ShowcaseRepo {
  slug: string;
  title: string;
  subtitle: string;
}

export interface VillagePageProps {
  initialRepo: string | null;
  initialLocal: string | null;
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
  | null;

