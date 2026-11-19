import * as THREE from 'three';
import { computeCommitArchetype } from '@/lib/archetypes';
import type {
  CommitData,
  CommitKind,
  GateVisitorEntity,
  GateVisitorFile,
  IslandLayout,
  VillagerEntity,
  WorkingTreeStatus,
} from '@/types/village';

const SKIN_TONES = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffcba4];
export const CLAN_PALETTE = [
  0x0a84ff, // Cobalt Blue
  0xff453a, // Coral Red
  0x30d158, // Jade Emerald
  0xbf5af2, // Royal Violet
  0xff9f0a, // Sunset Amber
  0x64d2ff, // Ice Cyan
  0xff375f, // Berry Rose
  0xffd60a, // Sunburst Gold
  0x5e5ce6, // Deep Indigo
  0xac8e68, // Warm Bronze
];

const CLAN_EMBLEMS = ['●', '◆', '▲', '★', '⬢', '✦', '◉', '❖', '▼', '⬟'];
export type ClanEarStyle = 'fox' | 'bear' | 'antler' | 'lynx' | 'wing' | 'antenna';
const CLAN_EAR_STYLES: ClanEarStyle[] = ['fox', 'bear', 'antler', 'lynx', 'wing', 'antenna'];

export interface ContributorClanProfile {
  authorKey: string;
  authorLogin: string;
  authorName: string;
  authorAvatar?: string;
  commitCount: number;
  clanIndex: number;
  colorHex: number;
  colorCss: string;
  skinColor: number;
  earStyle: ClanEarStyle;
  earLabel: string;
  emblem: string;
  initials: string;
  crestSpriteMat: THREE.SpriteMaterial;
}

export function normalizeAuthorKey(commit: Pick<CommitData, 'authorLogin' | 'authorName'>): string {
  return (commit.authorLogin || commit.authorName || 'contributor').trim().toLowerCase();
}

function computeInitials(name: string, login: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  const clean = (parts[0] || login || 'C').replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 2).toUpperCase() || 'C';
}

function getEarStyleLabel(style: ClanEarStyle): string {
  switch (style) {
    case 'fox':
      return 'Fox-Eared Kin';
    case 'bear':
      return 'Bear-Crest Kin';
    case 'antler':
      return 'Stag-Horn Kin';
    case 'lynx':
      return 'Lynx-Tuft Kin';
    case 'wing':
      return 'Sky-Wing Kin';
    case 'antenna':
      return 'Automaton Kin';
  }
}

function makeClanCrestSpriteMaterial(
  emblem: string,
  initials: string,
  colorCss: string,
): THREE.SpriteMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 76;
  const ctx = canvas.getContext('2d')!;

  // Crisp Apple Spatial Pill Badge in contributor's clan color
  ctx.fillStyle = colorCss;
  ctx.beginPath();
  ctx.roundRect(6, 6, 148, 64, 32);
  ctx.fill();

  // White specular pill border
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.stroke();

  // Emblem + Initials
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
  ctx.fillText(`${emblem} ${initials}`, 80, 39);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
  });
}

export function buildContributorClanMap(
  commits: Iterable<CommitData>,
): Map<string, ContributorClanProfile> {
  const buckets = new Map<
    string,
    { login: string; name: string; avatar?: string; count: number }
  >();

  for (const c of commits) {
    const key = normalizeAuthorKey(c);
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      if (!existing.avatar && c.authorAvatar) existing.avatar = c.authorAvatar;
      if (
        c.authorName &&
        ((c.authorName.includes(' ') && !existing.name.includes(' ')) ||
          (c.authorName[0] !== c.authorName[0]?.toLowerCase() &&
            existing.name[0] === existing.name[0]?.toLowerCase()))
      ) {
        existing.name = c.authorName;
      }
    } else {
      buckets.set(key, {
        login: c.authorLogin,
        name: c.authorName,
        avatar: c.authorAvatar,
        count: 1,
      });
    }
  }

  // Rank contributors by commit count descending so each gets a guaranteed unique visual slot!
  const sorted = [...buckets.entries()].toSorted(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );

  const clanMap = new Map<string, ContributorClanProfile>();
  sorted.forEach(([key, info], idx) => {
    const colorHex = CLAN_PALETTE[idx % CLAN_PALETTE.length];
    const colorCss = `#${colorHex.toString(16).padStart(6, '0')}`;
    const skinColor = SKIN_TONES[idx % SKIN_TONES.length];
    const earStyle = CLAN_EAR_STYLES[idx % CLAN_EAR_STYLES.length];
    const emblem = CLAN_EMBLEMS[idx % CLAN_EMBLEMS.length];
    const initials = computeInitials(info.name, info.login);

    clanMap.set(key, {
      authorKey: key,
      authorLogin: info.login,
      authorName: info.name,
      authorAvatar: info.avatar,
      commitCount: info.count,
      clanIndex: idx,
      colorHex,
      colorCss,
      skinColor,
      earStyle,
      earLabel: getEarStyleLabel(earStyle),
      emblem,
      initials,
      crestSpriteMat: makeClanCrestSpriteMaterial(emblem, initials, colorCss),
    });
  });

  return clanMap;
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getAuthorColorHex(login: string): number {
  return CLAN_PALETTE[hashString(login.toLowerCase()) % CLAN_PALETTE.length];
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

export function populateArchetypeGear(entity: VillagerEntity): void {
  entity.archetypeGroup.clear();
  const arch = computeCommitArchetype(entity.commit);

  if (arch.propKind === 'flame_cape') {
    // Flowing Crimson-Amber Friday Deployer Cape!
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0xff5722,
      emissive: 0xd9460f,
      emissiveIntensity: 0.35,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.03), capeMat);
    cape.position.set(0, 0.44, -0.26);
    cape.rotation.x = 0.22;
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.07, 0.036),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.4 }),
    );
    trim.position.set(0, -0.24, 0);
    cape.add(trim);
    entity.archetypeGroup.add(cape);
  } else if (arch.propKind === 'wrecking_hammer') {
    // Gleaming Golden Demolitionist Wrecking Hammer strapped across the top/side!
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.32,
      metalness: 0.65,
      roughness: 0.25,
    });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.026, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.7 }),
    );
    shaft.position.set(0.28, 0.88, -0.14);
    shaft.rotation.z = -0.35;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.3), goldMat);
    head.position.set(0, 0.28, 0);
    shaft.add(head);
    entity.archetypeGroup.add(shaft);
  } else if (arch.propKind === 'night_lantern') {
    // Warm Glowing 3 AM Night Owl Lantern + Espresso Cup!
    const lanternRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.34, 6),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 }),
    );
    lanternRod.position.set(0.28, 1.18, 0.14);
    lanternRod.rotation.z = -0.5;
    const lanternOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.095, 0),
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfbbf24,
        emissiveIntensity: 1.3,
      }),
    );
    lanternOrb.position.set(0.37, 1.24, 0.14);
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.045, 0.09, 8),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 }),
    );
    mug.position.set(-0.31, 0.44, 0.16);
    entity.archetypeGroup.add(lanternRod, lanternOrb, mug);
  } else if (arch.propKind === 'titan_crown') {
    // Floating Golden Crown above headgear for Mega-Drop Titans!
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.13, 0.11, 6, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xffd60a,
        emissive: 0xd97706,
        emissiveIntensity: 0.45,
        metalness: 0.7,
        roughness: 0.25,
        side: THREE.DoubleSide,
      }),
    );
    crown.position.set(0, 1.38, 0);
    entity.archetypeGroup.add(crown);
  } else if (arch.propKind === 'sniper_visor') {
    // Precision Glowing Cyan Visor for One-Line Snipers!
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.075, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.85,
      }),
    );
    visor.position.set(0, 0.97, 0.235);
    entity.archetypeGroup.add(visor);
  }
}

export function refreshVillagerCargo(entity: VillagerEntity): void {
  const seed = hashString(entity.commit.sha);
  const metrics = getCommitCargoMetrics(entity.commit);
  populateCargoRig(entity.cargoGroup, metrics, seed, entity.commit.files);
  populateArchetypeGear(entity);
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

function attachClanHeadTraits(
  earStyle: ClanEarStyle,
  clanColorHex: number,
  headGroup: THREE.Group,
  skinMat: THREE.MeshStandardMaterial,
): void {
  const clanAccentMat = new THREE.MeshStandardMaterial({
    color: clanColorHex,
    roughness: 0.45,
    flatShading: true,
  });

  if (earStyle === 'fox') {
    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 4), skinMat);
      ear.position.set(sgn * 0.27, 0.14, 0);
      ear.rotation.z = -sgn * 0.48;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.13, 4), clanAccentMat);
      tip.position.y = 0.08;
      ear.add(tip);
      headGroup.add(ear);
    }
  } else if (earStyle === 'bear') {
    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.115, 8, 8), skinMat);
      ear.scale.set(0.85, 1, 0.55);
      ear.position.set(sgn * 0.27, 0.16, 0);
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 6), clanAccentMat);
      inner.position.set(0, 0, 0.045);
      ear.add(inner);
      headGroup.add(ear);
    }
  } else if (earStyle === 'antler') {
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.6 });
    for (const sgn of [-1, 1]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.036, 0.28, 5), hornMat);
      stem.position.set(sgn * 0.27, 0.16, -0.02);
      stem.rotation.z = -sgn * 0.55;
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.14, 5), clanAccentMat);
      tine.position.set(sgn * 0.05, 0.06, 0);
      tine.rotation.z = -sgn * 0.7;
      stem.add(tine);
      headGroup.add(stem);
    }
  } else if (earStyle === 'lynx') {
    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.08), skinMat);
      ear.position.set(sgn * 0.27, 0.13, 0);
      ear.rotation.z = -sgn * 0.38;
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.14, 4), clanAccentMat);
      tuft.position.y = 0.15;
      ear.add(tuft);
      headGroup.add(ear);
    }
  } else if (earStyle === 'wing') {
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.05), clanAccentMat);
      wing.position.set(sgn * 0.3, 0.1, -0.03);
      wing.rotation.z = sgn * 0.32;
      wing.rotation.y = -sgn * 0.28;
      headGroup.add(wing);
    }
  } else {
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.3 });
    for (const sgn of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), brassMat);
      rod.position.set(sgn * 0.27, 0.12, 0);
      rod.rotation.z = -sgn * 0.65;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.052, 8, 8),
        new THREE.MeshStandardMaterial({
          color: clanColorHex,
          emissive: clanColorHex,
          emissiveIntensity: 0.45,
        }),
      );
      bulb.position.y = 0.12;
      rod.add(bulb);
      headGroup.add(rod);
    }
  }
}

function attachHatAndTool(
  kind: CommitKind,
  clanColorHex: number,
  headGroup: THREE.Group,
  rightArm: THREE.Group,
  bodyGroup: THREE.Group,
): void {
  const clanTrimMat = new THREE.MeshStandardMaterial({ color: clanColorHex, roughness: 0.45 });

  if (kind === 'feat') {
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    dome.position.y = 0.18;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.18, 0.56), clanTrimMat);
    stripe.position.set(0, 0.29, 0.02);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.05, 0.58), hatMat);
    brim.position.set(0, 0.19, 0.04);
    headGroup.add(dome, stripe, brim);

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
    const pithMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.7 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.05, 12), pithMat);
    brim.position.y = 0.21;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), pithMat);
    top.position.y = 0.21;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.07, 12), clanTrimMat);
    band.position.y = 0.24;
    headGroup.add(brim, top, band);

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
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.55,
      roughness: 0.25,
      emissive: 0xca8a04,
      emissiveIntensity: 0.25,
    });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.18, 6), goldMat);
    crown.position.y = 0.29;
    const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.215, 0.055, 10), clanTrimMat);
    crownBand.position.y = 0.22;
    headGroup.add(crown, crownBand);

    for (const sgn of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), goldMat);
      pauldron.position.set(sgn * 0.26, 0.68, 0);
      bodyGroup.add(pauldron);
    }

    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 6), goldMat);
    staff.position.set(0, -0.15, 0.14);
    staff.rotation.x = Math.PI / 6;
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshStandardMaterial({
        color: clanColorHex,
        emissive: clanColorHex,
        emissiveIntensity: 0.65,
      }),
    );
    orb.position.y = 0.35;
    staff.add(orb);
    rightArm.add(staff);
  } else if (kind === 'docs') {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.04, 0.54), capMat);
    board.position.y = 0.25;
    board.rotation.y = Math.PI / 4;
    const tassel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.08), clanTrimMat);
    tassel.position.set(0.24, 0.19, 0.16);
    headGroup.add(board, tassel);

    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.06, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7 }),
    );
    book.position.set(0, -0.22, 0.12);
    rightArm.add(book);
  } else if (kind === 'refactor') {
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xfcd34d, roughness: 0.85 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.03, 14), strawMat);
    brim.position.y = 0.21;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.14, 12), strawMat);
    dome.position.y = 0.27;
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.055, 12), clanTrimMat);
    ribbon.position.y = 0.235;
    headGroup.add(brim, dome, ribbon);

    const broom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.54, 6),
      new THREE.MeshStandardMaterial({ color: 0x92400e }),
    );
    broom.position.set(0, -0.2, 0.12);
    broom.rotation.x = Math.PI / 4;
    const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 8), strawMat);
    bristles.position.y = -0.3;
    broom.add(bristles);
    rightArm.add(broom);
  } else {
    const beret = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), clanTrimMat);
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
  clan?: ContributorClanProfile,
): VillagerEntity {
  const seed = hashString(commit.sha);
  const authorKey = clan?.authorKey ?? normalizeAuthorKey(commit);
  const tunicColor = clan?.colorHex ?? getAuthorColorHex(commit.authorLogin);
  // Shared skin tone & ear silhouette across ALL commits by the same contributor!
  const skinColor = clan?.skinColor ?? SKIN_TONES[hashString(authorKey) % SKIN_TONES.length];
  const earStyle = clan?.earStyle ?? CLAN_EAR_STYLES[hashString(authorKey) % CLAN_EAR_STYLES.length];

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const scaleBoost = commit.kind === 'merge' ? 1.16 : 0.96 + ((seed % 10) / 100);
  bodyGroup.scale.setScalar(scaleBoost);

  // Legs
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

  // Torso in Contributor Clan Color
  const torsoMat = new THREE.MeshStandardMaterial({ color: tunicColor, roughness: 0.58 });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.48;
  torso.castShadow = true;
  bodyGroup.add(torso);

  // Signature Contributor Clan Scarf + Front Scarf Tail!
  const scarfMat = new THREE.MeshStandardMaterial({
    color: tunicColor,
    emissive: tunicColor,
    emissiveIntensity: 0.14,
    roughness: 0.5,
  });
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.052, 6, 14), scarfMat);
  scarfRing.rotation.x = Math.PI / 2;
  scarfRing.position.y = 0.71;
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 0.04), scarfMat);
  scarfTail.position.set(0.08, 0.57, 0.22);
  scarfTail.rotation.z = -0.15;
  bodyGroup.add(scarfRing, scarfTail);

  // Carried Cargo Rig (stacked parcels = changed files, bulk = line changes!)
  const cargoMetrics = getCommitCargoMetrics(commit);
  const burden = cargoMetrics.burden;
  const cargoGroup = new THREE.Group();
  cargoGroup.position.set(0, 0.36, -0.22);
  populateCargoRig(cargoGroup, cargoMetrics, seed, commit.files);
  bodyGroup.add(cargoGroup);

  // Contributor Clan Standard (Sashimono Mast + Camera-Facing Crest Badge!)
  if (clan) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5, roughness: 0.35 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.92, 6), poleMat);
    mast.position.set(-0.26, 1.12, -0.14);
    bodyGroup.add(mast);

    const crestSprite = new THREE.Sprite(clan.crestSpriteMat);
    crestSprite.scale.set(0.58, 0.275, 1);
    crestSprite.position.set(-0.26, 1.66, -0.14);
    bodyGroup.add(crestSprite);
  }

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

  // Head + Shared Contributor Clan Ears/Horns/Winglets
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.94, 0);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  attachClanHeadTraits(earStyle, tunicColor, headGroup, skinMat);

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

  attachHatAndTool(commit.kind, tunicColor, headGroup, rightArm, bodyGroup);
  bodyGroup.add(headGroup);

  const archetypeGroup = new THREE.Group();
  bodyGroup.add(archetypeGroup);

  // Persistent Contributor Clan Ring on ground
  const auraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tunicColor),
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraRing = new THREE.Mesh(auraGeo, auraMat);
  auraRing.position.y = 0.04;
  root.add(auraRing);

  // Filter highlight beam in Contributor Clan Color
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tunicColor),
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
  const baseLane = ((indexOnIsland % 3) - 1) * 0.54;
  const homePos = island.pathCurve.getPointAt(Math.min(1, Math.max(0, pathT)));
  root.position.set(homePos.x, homePos.y, homePos.z + baseLane);

  const entity: VillagerEntity = {
    commit,
    authorKey,
    clanColor: tunicColor,
    island,
    root,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    cargoGroup,
    archetypeGroup,
    burden,
    spawnScale: 1,
    auraRing,
    filterBeam,
    hitBox,
    homePos: homePos.clone(),
    pathT,
    pathDir: seed % 2 === 0 ? 1 : -1,
    speed: (0.028 + ((seed % 16) / 1000)) * (1 - burden * 0.42),
    collisionRadius: 0.45 + burden * 0.09,
    baseLane,
    lateralOffset: baseLane,
    bumpVelX: 0,
    bumpVelZ: 0,
    bumpTiltX: 0,
    bumpTiltZ: 0,
    bumpCooldown: 0,
    yieldTimer: 0,
    behavior: seed % 3 === 0 ? 'jump_joy' : 'stroll',
    behaviorTimer: 1.5 + ((seed % 40) / 10),
    jumpPhase: (seed % 100) / 15,
    jumpVelocity: 0,
    jumpY: 0,
    phaseOffset: (seed % 628) / 100,
    emoteEmoji: '',
    emoteTimer: 0,
  };

  populateArchetypeGear(entity);
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
    case 'conflicted':
      return {
        label: 'Merge Conflict',
        dotClass: 'dot-red',
        color: 0xff453a,
        emotes: ['⚔️', '⚡', '💥'],
      };
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

  // Ground ring (crimson pulse for conflicted, gold for staged, sky-cyan/amber for unstaged)
  const isConflicted = file.status === 'conflicted';
  const auraMat = new THREE.MeshBasicMaterial({
    color: isConflicted ? 0xff453a : file.staged ? 0xfacc15 : meta.color,
    transparent: true,
    opacity: isConflicted ? 0.72 : file.staged ? 0.55 : 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraRing = new THREE.Mesh(auraGeo, auraMat);
  auraRing.position.y = 0.04;
  if (isConflicted) {
    auraRing.scale.setScalar(1.38);
  }
  root.add(auraRing);

  // Dueling Ours vs Theirs Rig when file has an unresolved Merge Conflict!
  let duelRig: GateVisitorEntity['duelRig'];
  if (isConflicted) {
    bodyGroup.scale.setScalar(0.84);
    bodyGroup.position.set(-0.28, 0, 0);
    // Tint primary traveler ("Ours") in bright cyan-cobalt with glowing cyan clash blade
    coatMat.color.setHex(0x0ea5e9);
    const oursBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.44, 0.09),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.95,
      }),
    );
    oursBlade.position.set(0, -0.28, 0.18);
    oursBlade.rotation.x = Math.PI / 2.6;
    rightArm.add(oursBlade);

    // Build rival "Theirs" traveler facing "Ours" on the same pier slot!
    const rivalBody = new THREE.Group();
    rivalBody.scale.setScalar(0.84);
    rivalBody.position.set(0.28, 0, 0);
    rivalBody.rotation.y = -Math.PI / 2;

    const rivalCoatMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.52 });
    const rivalSkinMat = new THREE.MeshStandardMaterial({
      color: SKIN_TONES[(seed + 2) % SKIN_TONES.length],
      roughness: 0.7,
    });
    const rTorso = new THREE.Mesh(torsoGeo, rivalCoatMat);
    rTorso.position.y = 0.48;
    rTorso.castShadow = true;
    rivalBody.add(rTorso);

    for (const sgn of [-1, 1]) {
      const rLeg = new THREE.Mesh(limbGeo, pantsMat);
      rLeg.position.set(sgn * 0.11, 0.14, 0);
      rivalBody.add(rLeg);
    }

    const rLeftArm = new THREE.Group();
    rLeftArm.position.set(-0.28, 0.64, 0);
    const rLaMesh = new THREE.Mesh(limbGeo, rivalSkinMat);
    rLaMesh.position.y = -0.12;
    rLeftArm.add(rLaMesh);

    const rRightArm = new THREE.Group();
    rRightArm.position.set(0.28, 0.64, 0);
    const rRaMesh = new THREE.Mesh(limbGeo, rivalSkinMat);
    rRaMesh.position.y = -0.12;
    rRightArm.add(rRaMesh);

    const theirsBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.44, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xef4444,
        emissiveIntensity: 0.95,
      }),
    );
    theirsBlade.position.set(0, -0.28, 0.18);
    theirsBlade.rotation.x = Math.PI / 2.6;
    rRightArm.add(theirsBlade);
    rivalBody.add(rLeftArm, rRightArm);

    const rHead = new THREE.Group();
    rHead.position.set(0, 0.94, 0);
    const rHeadMesh = new THREE.Mesh(headGeo, rivalSkinMat);
    rHeadMesh.castShadow = true;
    const rlEye = new THREE.Mesh(eyeGeo, eyeMat);
    rlEye.position.set(-0.1, 0.03, 0.225);
    const rrEye = new THREE.Mesh(eyeGeo, eyeMat);
    rrEye.position.set(0.1, 0.03, 0.225);
    const rCap = new THREE.Mesh(
      new THREE.ConeGeometry(0.27, 0.26, 6),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }),
    );
    rCap.position.y = 0.28;
    rHead.add(rHeadMesh, rlEye, rrEye, rCap);
    rivalBody.add(rHead);
    root.add(rivalBody);

    // Spinning crimson-gold clash spark between the two arguing file versions!
    const clashSpark = new THREE.Group();
    clashSpark.position.set(0, 0.88, 0);
    const sparkCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
    );
    const sparkHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.025, 5, 12),
      new THREE.MeshBasicMaterial({ color: 0xff453a }),
    );
    clashSpark.add(sparkCore, sparkHalo);
    root.add(clashSpark);

    bodyGroup.rotation.y = Math.PI / 2;
    duelRig = {
      oursBody: bodyGroup,
      theirsBody: rivalBody,
      oursArm: rightArm,
      theirsArm: rRightArm,
      clashSpark,
    };
  }

  const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
  if (isConflicted) {
    hitBox.scale.set(1.5, 1.1, 1.5);
  }
  hitBox.userData.visitorIndex = index;
  root.add(hitBox);

  root.position.copy(queueSlot);
  if (!isConflicted) {
    // Face -X toward the Village Gate!
    bodyGroup.rotation.y = -Math.PI / 2;
  }

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
    duelRig,
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
