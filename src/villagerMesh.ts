import * as THREE from 'three';
import type {
  CommitData,
  CommitKind,
  GateVisitorEntity,
  GateVisitorFile,
  IslandLayout,
  VillagerEntity,
  WorkingTreeStatus,
} from './types';

const SKIN_TONES = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffcba4];
const AUTHOR_HUES = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899, 0x06b6d4, 0x84cc16, 0xf97316,
  0x6366f1,
];

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getAuthorColorHex(login: string): number {
  return AUTHOR_HUES[hashString(login) % AUTHOR_HUES.length];
}

export function getRoleMeta(kind: CommitKind): {
  title: string;
  badge: string;
  dotClass: string;
  defaultEmotes: string[];
} {
  switch (kind) {
    case 'feat':
      return {
        title: 'Master Builder',
        badge: 'Feature',
        dotClass: 'dot-amber',
        defaultEmotes: ['✨', '🔨', '🚀', '💡'],
      };
    case 'fix':
      return {
        title: 'Bug Catcher',
        badge: 'Bugfix',
        dotClass: 'dot-red',
        defaultEmotes: ['🔧', '🎯', '🩹', '✨'],
      };
    case 'merge':
      return {
        title: 'Bridge Mayor',
        badge: 'Merge',
        dotClass: 'dot-purple',
        defaultEmotes: ['🎉', '🤝', '👑', '✨'],
      };
    case 'docs':
      return {
        title: 'Lore Scribe',
        badge: 'Documentation',
        dotClass: 'dot-cyan',
        defaultEmotes: ['📖', '✒️', '✨'],
      };
    case 'refactor':
      return {
        title: 'Bonsai Gardener',
        badge: 'Refactor',
        dotClass: 'dot-green',
        defaultEmotes: ['🌿', '💎', '✂️'],
      };
    default:
      return {
        title: 'Clockwork Keeper',
        badge: 'Maintenance',
        dotClass: 'dot-cyan',
        defaultEmotes: ['⚙️', '📦', '👋'],
      };
  }
}

const strapMat = new THREE.MeshStandardMaterial({ color: 0x5c2d16, roughness: 0.85 });
const frameWoodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.88 });
const crateOakMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.78, flatShading: true });
const cratePineMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.8, flatShading: true });
const parchmentPackMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.72, flatShading: true });
const canvasSackMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85, flatShading: true });
const bandAddMat = new THREE.MeshStandardMaterial({ color: 0x30d158, roughness: 0.5 });
const bandDelMat = new THREE.MeshStandardMaterial({ color: 0xff453a, roughness: 0.5 });
const bandModMat = new THREE.MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.5 });

export interface CargoMetrics {
  filesCount: number;
  additions: number;
  deletions: number;
  totalLines: number;
  burden: number; // 0.08 (featherlight) -> 1.0 (colossal)
  isProvisional: boolean;
}

export function getCommitCargoMetrics(commit: CommitData): CargoMetrics {
  const hasRealStats = Boolean(commit.stats || commit.files || commit.filesCount !== undefined);
  if (hasRealStats) {
    const filesCount = Math.max(1, commit.filesCount ?? commit.files?.length ?? 1);
    const additions = commit.stats?.additions ?? 0;
    const deletions = commit.stats?.deletions ?? 0;
    const totalLines = Math.max(1, additions + deletions);
    const fileFactor = Math.min(1, (filesCount - 1) / 7);
    const lineFactor = Math.min(1, Math.log10(totalLines + 1) / 3.3);
    const burden = Math.min(1, Math.max(0.08, fileFactor * 0.55 + lineFactor * 0.45));
    return { filesCount, additions, deletions, totalLines, burden, isProvisional: false };
  }

  // Provisional deterministic estimate before remote GitHub commit diff hydrates
  const seed = hashString(commit.sha);
  const filesCount =
    commit.kind === 'merge'
      ? 4 + (seed % 4)
      : commit.kind === 'feat'
        ? 2 + (seed % 4)
        : 1 + (seed % 2);
  const additions =
    commit.kind === 'merge'
      ? 140 + (seed % 220)
      : commit.kind === 'feat'
        ? 60 + (seed % 140)
        : 12 + (seed % 45);
  const deletions = Math.round(additions * 0.25);
  const totalLines = additions + deletions;
  const fileFactor = Math.min(1, (filesCount - 1) / 7);
  const lineFactor = Math.min(1, Math.log10(totalLines + 1) / 3.3);
  const burden = Math.min(1, Math.max(0.1, fileFactor * 0.55 + lineFactor * 0.45));
  return { filesCount, additions, deletions, totalLines, burden, isProvisional: true };
}

export function describeCarriedLoad(filesCount: number, totalLines: number): string {
  const fLabel = `${filesCount} file${filesCount === 1 ? '' : 's'}`;
  const lLabel = `${totalLines.toLocaleString()} line${totalLines === 1 ? '' : 's'}`;
  if (filesCount >= 6 || totalLines >= 800) {
    return `Colossal Expedition Rig · ${fLabel} · ${lLabel}`;
  }
  if (filesCount >= 4 || totalLines >= 220) {
    return `Heavy Courier Stack · ${fLabel} · ${lLabel}`;
  }
  if (filesCount >= 2 || totalLines >= 45) {
    return `Sturdy Field Pack · ${fLabel} · ${lLabel}`;
  }
  return `Light Parcel · ${fLabel} · ${lLabel}`;
}

function populateCargoRig(
  cargoGroup: THREE.Group,
  metrics: CargoMetrics,
  seed: number,
  commitFiles?: CommitData['files'],
): void {
  cargoGroup.clear();

  const { filesCount, additions, deletions, totalLines } = metrics;
  const bulk = Math.min(1.58, Math.max(0.72, 0.66 + Math.log10(totalLines + 3) * 0.28));
  const tierCount = Math.min(8, Math.max(1, filesCount));

  // 1. Twin shoulder harness straps (in cargoGroup local space; cargoGroup sits at y=0.36, z=-0.22)
  for (const sgn of [-1, 1]) {
    const frontStrap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.34, 0.26), strapMat);
    frontStrap.position.set(sgn * 0.13, 0.18, 0.14);
    cargoGroup.add(frontStrap);
  }

  // 2. L-shaped wooden porter pack-frame
  const baseW = 0.34 * bulk;
  const baseD = 0.24 * bulk;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(baseW + 0.08, 0.045, baseD + 0.08), frameWoodMat);
  shelf.position.set(0, 0, -baseD * 0.45);
  shelf.castShadow = true;
  cargoGroup.add(shelf);

  // 3. Stacked Cargo Tiers — 1 tier per changed file (up to 8 high!)
  let cursorY = 0.025;
  for (let t = 0; t < tierCount; t++) {
    const fileInfo = commitFiles?.[t];
    const fileLines = fileInfo
      ? fileInfo.additions + fileInfo.deletions
      : Math.max(4, Math.round(totalLines / tierCount));

    const tierBulk = Math.min(
      1.55,
      Math.max(0.68, 0.62 + Math.log10(fileLines + 3) * 0.27) * (1 - t * 0.035),
    );
    const w = 0.34 * tierBulk;
    const h = (fileLines < 15 ? 0.11 : fileLines < 90 ? 0.17 : 0.22) * Math.min(1.25, bulk * 0.92);
    const d = 0.23 * tierBulk;

    const parcelGroup = new THREE.Group();
    const shapeStyle = (seed + t * 7) % 3;
    const mat =
      shapeStyle === 0 ? crateOakMat : shapeStyle === 1 ? parchmentPackMat : cratePineMat;

    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    box.castShadow = true;
    box.receiveShadow = true;
    parcelGroup.add(box);

    // Status accent shipping band (+additions green, -deletions red, balanced blue)
    const isAddHeavy = fileInfo
      ? fileInfo.status === 'added' || fileInfo.additions > fileInfo.deletions * 2
      : additions >= deletions;
    const isDelHeavy = fileInfo
      ? fileInfo.status === 'removed' || fileInfo.deletions > fileInfo.additions
      : deletions > additions;
    const bandMat = isDelHeavy ? bandDelMat : isAddHeavy ? bandAddMat : bandModMat;

    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h + 0.012, d + 0.014), bandMat);
    parcelGroup.add(band);

    const zCenter = -baseD * 0.46;
    const jitterX = (((seed >> (t % 8)) & 3) - 1.5) * 0.018;
    const yawTwist = (((seed + t * 13) % 9) - 4) * 0.035;
    parcelGroup.position.set(jitterX, cursorY + h * 0.5, zCenter);
    parcelGroup.rotation.y = yawTwist;

    cargoGroup.add(parcelGroup);
    cursorY += h + 0.012;
  }

  // 4. Vertical frame rails & cinch straps securing multi-file stacks
  const frameHeight = Math.max(0.32, cursorY);
  for (const sgn of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, frameHeight, 6),
      frameWoodMat,
    );
    rail.position.set(sgn * (baseW * 0.42), frameHeight * 0.5, -0.02);
    cargoGroup.add(rail);
  }

  if (tierCount >= 3 || totalLines >= 140) {
    const cinch = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, frameHeight + 0.03, baseD * 0.96),
      strapMat,
    );
    cinch.position.set(0, frameHeight * 0.5, -baseD * 0.46);
    cargoGroup.add(cinch);
  }

  // 5. Overflow side saddle-rolls & summit pennant for heavy / multi-file commits!
  if (filesCount >= 5 || totalLines >= 350) {
    for (const sgn of [-1, 1]) {
      const sideRoll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.34, 8),
        canvasSackMat,
      );
      sideRoll.position.set(sgn * (baseW * 0.58 + 0.07), 0.24, -baseD * 0.45);
      sideRoll.castShadow = true;
      cargoGroup.add(sideRoll);
    }
  }

  if (filesCount >= 6 || totalLines >= 650) {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.32, 5),
      frameWoodMat,
    );
    mast.position.set(0.08, cursorY + 0.15, -baseD * 0.46);
    const pennant = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, 0.22, 4),
      new THREE.MeshStandardMaterial({
        color: 0xff9f0a,
        emissive: 0xd97706,
        emissiveIntensity: 0.35,
        flatShading: true,
      }),
    );
    pennant.rotation.z = -Math.PI / 2;
    pennant.position.set(0.11, 0.1, 0);
    mast.add(pennant);
    cargoGroup.add(mast);
  }
}

export function refreshVillagerCargo(entity: VillagerEntity): void {
  const seed = hashString(entity.commit.sha);
  const metrics = getCommitCargoMetrics(entity.commit);
  populateCargoRig(entity.cargoGroup, metrics, seed, entity.commit.files);
  entity.burden = metrics.burden;
  entity.speed = (0.028 + ((seed % 16) / 1000)) * (1 - metrics.burden * 0.42);
}
const headGeo = new THREE.BoxGeometry(0.46, 0.44, 0.44);
const torsoGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.48, 8);
const limbGeo = new THREE.CapsuleGeometry(0.068, 0.2, 4, 6);
const eyeGeo = new THREE.BoxGeometry(0.06, 0.08, 0.04);
const cheekGeo = new THREE.BoxGeometry(0.07, 0.04, 0.03);
const auraGeo = new THREE.RingGeometry(0.38, 0.5, 24);
auraGeo.rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(0.32, 0.45, 5.5, 16, 1, true);
beamGeo.translate(0, 2.75, 0);
const hitBoxGeo = new THREE.CylinderGeometry(0.48, 0.48, 1.55, 8);
hitBoxGeo.translate(0, 0.75, 0);

const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1e1b2e });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff8da1 });
const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });

function attachHatAndTool(
  kind: CommitKind,
  headGroup: THREE.Group,
  rightArm: THREE.Group,
  bodyGroup: THREE.Group,
): void {
  if (kind === 'feat') {
    // Builder yellow hard-hat + glowing crystal hammer
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    dome.position.y = 0.18;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.05, 0.58), hatMat);
    brim.position.set(0, 0.19, 0.04);
    headGroup.add(dome, brim);

    // Hammer
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x78350f }),
    );
    handle.position.set(0, -0.22, 0.14);
    handle.rotation.x = Math.PI / 3;
    const gemHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.12, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.5,
      }),
    );
    gemHead.position.set(0, 0.18, 0);
    handle.add(gemHead);
    rightArm.add(handle);
  } else if (kind === 'fix') {
    // Bug-catcher safari pith hat + net!
    const pithMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.7 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.05, 12), pithMat);
    brim.position.y = 0.21;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), pithMat);
    top.position.y = 0.21;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0xef4444 }),
    );
    band.position.y = 0.24;
    headGroup.add(brim, top, band);

    // Bug net
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.56, 6),
      new THREE.MeshStandardMaterial({ color: 0x92400e }),
    );
    pole.position.set(0, -0.22, 0.18);
    pole.rotation.x = Math.PI / 2.6;
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.02, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0 }),
    );
    hoop.position.y = 0.34;
    const meshBag = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.24, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xa7f3d0,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    );
    meshBag.position.set(0, 0.34, -0.11);
    meshBag.rotation.x = -Math.PI / 2;
    pole.add(hoop, meshBag);
    rightArm.add(pole);
  } else if (kind === 'merge') {
    // Golden crown + royal cape + star scepter
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.55,
      roughness: 0.25,
      emissive: 0xca8a04,
      emissiveIntensity: 0.25,
    });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.18, 6), goldMat);
    crown.position.y = 0.29;
    headGroup.add(crown);

    const cape = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.5, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.6 }),
    );
    cape.position.set(0, 0.44, -0.22);
    cape.rotation.x = 0.18;
    bodyGroup.add(cape);

    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 6), goldMat);
    staff.position.set(0, -0.15, 0.14);
    staff.rotation.x = Math.PI / 6;
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshStandardMaterial({
        color: 0xf472b6,
        emissive: 0xec4899,
        emissiveIntensity: 0.7,
      }),
    );
    orb.position.y = 0.35;
    staff.add(orb);
    rightArm.add(staff);
  } else if (kind === 'docs') {
    // Scholar mortarboard + open scroll book
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.04, 0.54), capMat);
    board.position.y = 0.25;
    board.rotation.y = Math.PI / 4;
    headGroup.add(board);

    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.06, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7 }),
    );
    book.position.set(0, -0.22, 0.12);
    rightArm.add(book);
  } else if (kind === 'refactor') {
    // Gardener straw sun-hat + broom
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xfcd34d, roughness: 0.85 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.03, 14), strawMat);
    brim.position.y = 0.21;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.14, 12), strawMat);
    dome.position.y = 0.27;
    headGroup.add(brim, dome);

    const broom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.54, 6),
      new THREE.MeshStandardMaterial({ color: 0x92400e }),
    );
    broom.position.set(0, -0.2, 0.12);
    broom.rotation.x = Math.PI / 4;
    const bristles = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.2, 8),
      strawMat,
    );
    bristles.position.y = -0.3;
    broom.add(bristles);
    rightArm.add(broom);
  } else {
    // Tinkerer beret + warm lantern
    const beret = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }),
    );
    beret.scale.set(1.05, 0.5, 1.05);
    beret.position.set(0.03, 0.23, 0);
    headGroup.add(beret);

    const lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.16, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0xfdba74,
        emissive: 0xf97316,
        emissiveIntensity: 0.8,
      }),
    );
    lantern.position.set(0, -0.26, 0.1);
    rightArm.add(lantern);
  }
}

export function createVillagerEntity(
  commit: CommitData,
  island: IslandLayout,
  indexOnIsland: number,
  totalOnIsland: number,
): VillagerEntity {
  const seed = hashString(commit.sha);
  const skinColor = SKIN_TONES[seed % SKIN_TONES.length];
  const tunicColor = getAuthorColorHex(commit.authorLogin);

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const scaleBoost = commit.kind === 'merge' ? 1.18 : 0.94 + ((seed % 15) / 100);
  bodyGroup.scale.setScalar(scaleBoost);

  // Legs
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.11, 0.24, 0);
  const leftLegMesh = new THREE.Mesh(limbGeo, pantsMat);
  leftLegMesh.position.y = -0.1;
  leftLegMesh.castShadow = true;
  leftLeg.add(leftLegMesh);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.11, 0.24, 0);
  const rightLegMesh = new THREE.Mesh(limbGeo, pantsMat);
  rightLegMesh.position.y = -0.1;
  rightLegMesh.castShadow = true;
  rightLeg.add(rightLegMesh);

  bodyGroup.add(leftLeg, rightLeg);

  // Torso
  const torsoMat = new THREE.MeshStandardMaterial({ color: tunicColor, roughness: 0.65 });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.48;
  torso.castShadow = true;
  bodyGroup.add(torso);

  // Carried Cargo Rig (stacked parcels = changed files, bulk = line changes!)
  const cargoMetrics = getCommitCargoMetrics(commit);
  const burden = cargoMetrics.burden;
  const cargoGroup = new THREE.Group();
  cargoGroup.position.set(0, 0.36, -0.22);
  populateCargoRig(cargoGroup, cargoMetrics, seed, commit.files);
  bodyGroup.add(cargoGroup);

  // Arms
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.28, 0.64, 0);
  const leftArmMesh = new THREE.Mesh(limbGeo, skinMat);
  leftArmMesh.position.y = -0.12;
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.28, 0.64, 0);
  const rightArmMesh = new THREE.Mesh(limbGeo, skinMat);
  rightArmMesh.position.y = -0.12;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  bodyGroup.add(leftArm, rightArm);

  // Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.94, 0);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Cute face on +Z
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.1, 0.03, 0.225);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.1, 0.03, 0.225);
  const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
  leftCheek.position.set(-0.15, -0.06, 0.222);
  const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
  rightCheek.position.set(0.15, -0.06, 0.222);
  headGroup.add(leftEye, rightEye, leftCheek, rightCheek);

  attachHatAndTool(commit.kind, headGroup, rightArm, bodyGroup);
  bodyGroup.add(headGroup);

  // Selection/hover ring on ground
  const auraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(island.branch.color),
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraRing = new THREE.Mesh(auraGeo, auraMat);
  auraRing.position.y = 0.04;
  root.add(auraRing);

  // Filter highlight beam
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(island.branch.color),
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const filterBeam = new THREE.Mesh(beamGeo, beamMat);
  filterBeam.visible = false;
  root.add(filterBeam);

  const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
  hitBox.userData.commitSha = commit.sha;
  root.add(hitBox);

  const pathT = totalOnIsland <= 1 ? 0.5 : 0.08 + (indexOnIsland / (totalOnIsland - 1)) * 0.84;
  const homePos = island.pathCurve.getPointAt(Math.min(1, Math.max(0, pathT)));
  root.position.copy(homePos);

  const entity: VillagerEntity = {
    commit,
    island,
    root,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    cargoGroup,
    burden,
    auraRing,
    filterBeam,
    hitBox,
    homePos: homePos.clone(),
    pathT,
    pathDir: seed % 2 === 0 ? 1 : -1,
    speed: (0.028 + ((seed % 16) / 1000)) * (1 - burden * 0.42),
    behavior: seed % 3 === 0 ? 'jump_joy' : 'stroll',
    behaviorTimer: 1.5 + ((seed % 40) / 10),
    jumpPhase: (seed % 100) / 15,
    jumpVelocity: 0,
    jumpY: 0,
    phaseOffset: (seed % 628) / 100,
    emoteEmoji: '',
    emoteTimer: 0,
  };

  return entity;
}

export function createExplorerAvatar(): {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
} {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  bodyGroup.scale.setScalar(1.08);
  root.add(bodyGroup);

  const bootsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.11, 0.24, 0);
  const ll = new THREE.Mesh(limbGeo, bootsMat);
  ll.position.y = -0.1;
  leftLeg.add(ll);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.11, 0.24, 0);
  const rl = new THREE.Mesh(limbGeo, bootsMat);
  rl.position.y = -0.1;
  rightLeg.add(rl);

  const coat = new THREE.Mesh(
    torsoGeo,
    new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.5 }),
  );
  coat.position.y = 0.48;
  coat.castShadow = true;

  // Adventurer scarf
  const scarf = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.055, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.6 }),
  );
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.71;

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.65 });
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.28, 0.64, 0);
  const la = new THREE.Mesh(limbGeo, skinMat);
  la.position.y = -0.12;
  leftArm.add(la);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.28, 0.64, 0);
  const ra = new THREE.Mesh(limbGeo, skinMat);
  ra.position.y = -0.12;
  rightArm.add(ra);

  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 0.96;
  head.castShadow = true;

  const lEye = new THREE.Mesh(eyeGeo, eyeMat);
  lEye.position.set(-0.1, 0.99, 0.225);
  const rEye = new THREE.Mesh(eyeGeo, eyeMat);
  rEye.position.set(0.1, 0.99, 0.225);

  // Explorer hood/feather hat
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.6 });
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.36, 10), hatMat);
  hat.position.set(0, 1.32, -0.02);
  hat.rotation.x = -0.18;

  const ring = new THREE.Mesh(
    auraGeo,
    new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  ring.position.y = 0.05;
  root.add(ring);

  bodyGroup.add(leftLeg, rightLeg, coat, scarf, leftArm, rightArm, head, lEye, rEye, hat);
  root.visible = false;

  return { root, bodyGroup, leftLeg, rightLeg, leftArm, rightArm };
}

export function getVisitorStatusMeta(status: WorkingTreeStatus): {
  label: string;
  dotClass: string;
  color: number;
  emotes: string[];
} {
  switch (status) {
    case 'untracked':
      return { label: 'Untracked File', dotClass: 'dot-green', color: 0x30d158, emotes: ['🌱', '🙋', '🔔'] };
    case 'added':
      return { label: 'Added File', dotClass: 'dot-green', color: 0x30d158, emotes: ['✨', '🎫', '🙌'] };
    case 'deleted':
      return { label: 'Deleted File', dotClass: 'dot-red', color: 0xff453a, emotes: ['📦', '👋'] };
    case 'renamed':
      return { label: 'Renamed File', dotClass: 'dot-purple', color: 0xbf5af2, emotes: ['🏷️', '🙋'] };
    default:
      return { label: 'Modified File', dotClass: 'dot-amber', color: 0xff9f0a, emotes: ['✏️', '🔔', '🙋'] };
  }
}

export function createGateVisitorEntity(
  file: GateVisitorFile,
  index: number,
  queueSlot: THREE.Vector3,
  rushTarget: THREE.Vector3,
): GateVisitorEntity {
  const seed = hashString(file.filename + index);
  const skinColor = SKIN_TONES[seed % SKIN_TONES.length];
  const meta = getVisitorStatusMeta(file.status);

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // Traveler legs
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.11, 0.24, 0);
  const leftLegMesh = new THREE.Mesh(limbGeo, pantsMat);
  leftLegMesh.position.y = -0.1;
  leftLegMesh.castShadow = true;
  leftLeg.add(leftLegMesh);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.11, 0.24, 0);
  const rightLegMesh = new THREE.Mesh(limbGeo, pantsMat);
  rightLegMesh.position.y = -0.1;
  rightLegMesh.castShadow = true;
  rightLeg.add(rightLegMesh);
  bodyGroup.add(leftLeg, rightLeg);

  // Traveler poncho / coat colored by working-tree status
  const coatMat = new THREE.MeshStandardMaterial({ color: meta.color, roughness: 0.58 });
  const torso = new THREE.Mesh(torsoGeo, coatMat);
  torso.position.y = 0.48;
  torso.castShadow = true;
  bodyGroup.add(torso);

  // Carried Cargo Rig on back for this uncommitted file, scaled by its line changes!
  const lineTotal = Math.max(1, file.additions + file.deletions);
  const visitorBurden = Math.min(1, Math.max(0.12, Math.log10(lineTotal + 2) / 3.0));
  const visitorMetrics: CargoMetrics = {
    filesCount: lineTotal > 180 ? 3 : lineTotal > 45 ? 2 : 1,
    additions: file.additions,
    deletions: file.deletions,
    totalLines: lineTotal,
    burden: visitorBurden,
    isProvisional: false,
  };
  const cargoGroup = new THREE.Group();
  cargoGroup.position.set(0, 0.36, -0.22);
  populateCargoRig(cargoGroup, visitorMetrics, seed);
  bodyGroup.add(cargoGroup);

  // Arms
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.28, 0.64, 0);
  const la = new THREE.Mesh(limbGeo, skinMat);
  la.position.y = -0.12;
  leftArm.add(la);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.28, 0.64, 0);
  const ra = new THREE.Mesh(limbGeo, skinMat);
  ra.position.y = -0.12;
  rightArm.add(ra);

  // Rolled file scroll held eagerly in right hand!
  const scroll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.32, 8),
    new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.6 }),
  );
  scroll.rotation.z = Math.PI / 2;
  scroll.position.set(0.05, -0.22, 0.14);
  rightArm.add(scroll);

  bodyGroup.add(leftArm, rightArm);

  // Head + Eager Face
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.94, 0);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.1, 0.03, 0.225);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.1, 0.03, 0.225);
  const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
  leftCheek.position.set(-0.15, -0.06, 0.222);
  const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
  rightCheek.position.set(0.15, -0.06, 0.222);
  headGroup.add(leftEye, rightEye, leftCheek, rightCheek);

  // Traveler cap / sprout
  if (file.status === 'untracked' || file.status === 'added') {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5),
      new THREE.MeshStandardMaterial({ color: 0x16a34a }),
    );
    stem.position.y = 0.29;
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x4ade80 }),
    );
    leaf.scale.set(1.4, 0.45, 0.8);
    leaf.position.set(0.08, 0.37, 0);
    leaf.rotation.z = -0.35;
    headGroup.add(stem, leaf);
  } else {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      coatMat,
    );
    cap.position.y = 0.18;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.22), coatMat);
    visor.position.set(0, 0.2, 0.2);
    headGroup.add(cap, visor);
  }

  bodyGroup.add(headGroup);

  // Floating Golden Gate Ticket above Staged (`git add`) visitors!
  let ticketMesh: THREE.Object3D | undefined;
  if (file.staged) {
    const ticket = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.16, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.9,
        metalness: 0.4,
        roughness: 0.2,
      }),
    );
    ticket.position.y = 1.58;
    bodyGroup.add(ticket);
    ticketMesh = ticket;
  }

  // Ground ring (gold for staged, sky-cyan/amber for unstaged)
  const auraMat = new THREE.MeshBasicMaterial({
    color: file.staged ? 0xfacc15 : meta.color,
    transparent: true,
    opacity: file.staged ? 0.55 : 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraRing = new THREE.Mesh(auraGeo, auraMat);
  auraRing.position.y = 0.04;
  root.add(auraRing);

  const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
  hitBox.userData.visitorIndex = index;
  root.add(hitBox);

  root.position.copy(queueSlot);
  // Face -X toward the Village Gate!
  bodyGroup.rotation.y = -Math.PI / 2;

  return {
    file,
    index,
    root,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    cargoGroup,
    burden: visitorBurden,
    ticketMesh,
    auraRing,
    hitBox,
    queueSlot: queueSlot.clone(),
    rushTarget: rushTarget.clone(),
    jumpY: 0,
    jumpVelocity: 0,
    phaseOffset: (seed % 628) / 100,
    hopTimer: 0.4 + ((seed % 25) / 10),
    emoteEmoji: '',
    emoteTimer: 0,
  };
}
