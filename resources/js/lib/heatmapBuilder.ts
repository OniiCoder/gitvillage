import * as THREE from 'three';
import type { GitHubHeatmapData, HeatmapDayCell, HeatmapTheme } from '@/types/village';

export interface BuiltHeatmapTower {
  day: HeatmapDayCell;
  columnMesh: THREE.Mesh;
  capMesh: THREE.Mesh;
  hitBox: THREE.Mesh;
  targetHeight: number;
  weekIndex: number;
  isPeak: boolean;
  worldPos: THREE.Vector3;
}

export interface BuiltHeatmapWorld {
  worldGroup: THREE.Group;
  towers: BuiltHeatmapTower[];
  islandLength: number;
  islandWidth: number;
  peakBeacon?: THREE.Object3D;
  mascotArm?: THREE.Object3D;
  clouds: Array<{ mesh: THREE.Object3D; speed: number; baseZ: number }>;
  floatingCrystals: Array<{ mesh: THREE.Object3D; baseY: number; phase: number }>;
}

interface ThemeSpec {
  deckTop: number;
  deckRim: number;
  rockUpper: number;
  rockLower: number;
  emptyTile: number;
  levels: [number, number, number, number]; // levels 1..4 body colors
  caps: [number, number, number, number]; // levels 1..4 rooftop glow colors
  emissive: [number, number, number, number];
  crystalColor: number;
  treeFoliage: number;
  accentHex: string;
}

export const HEATMAP_THEMES: Record<HeatmapTheme, ThemeSpec> = {
  emerald: {
    deckTop: 0x18382c,
    deckRim: 0x112920,
    rockUpper: 0x1e293b,
    rockLower: 0x0f172a,
    emptyTile: 0x224438,
    levels: [0x0e6b3a, 0x199b4f, 0x2fd068, 0x5ef38c],
    caps: [0x168045, 0x24b862, 0x4ade80, 0xa7f3d0],
    emissive: [0x052e16, 0x064e3b, 0x059669, 0x34d399],
    crystalColor: 0x34d399,
    treeFoliage: 0x22c55e,
    accentHex: '#39d353',
  },
  cyber: {
    deckTop: 0x13162b,
    deckRim: 0x0b0e1d,
    rockUpper: 0x1e1b4b,
    rockLower: 0x090d16,
    emptyTile: 0x1e2442,
    levels: [0x1d4ed8, 0x06b6d4, 0x8b5cf6, 0xf43f5e],
    caps: [0x38bdf8, 0x67e8f9, 0xc4b5fd, 0xfda4af],
    emissive: [0x1e3a8a, 0x0e7490, 0x5b21b6, 0xbe123c],
    crystalColor: 0x22d3ee,
    treeFoliage: 0x6366f1,
    accentHex: '#22d3ee',
  },
  forge: {
    deckTop: 0x291a16,
    deckRim: 0x1c120f,
    rockUpper: 0x292524,
    rockLower: 0x141210,
    emptyTile: 0x3b2620,
    levels: [0x9a3412, 0xea580c, 0xf59e0b, 0xfacc15],
    caps: [0xc2410c, 0xfb923c, 0xfbbf24, 0xfef08a],
    emissive: [0x431407, 0x7c2d12, 0xb45309, 0xca8a04],
    crystalColor: 0xf97316,
    treeFoliage: 0xd97706,
    accentHex: '#fb923c',
  },
  sakura: {
    deckTop: 0x2d1b2e,
    deckRim: 0x1f1220,
    rockUpper: 0x312e43,
    rockLower: 0x191624,
    emptyTile: 0x3f2741,
    levels: [0x9d174d, 0xdb2777, 0xf472b6, 0xfbcfe8],
    caps: [0xbe185d, 0xec4899, 0xf9a8d4, 0xffffff],
    emissive: [0x500724, 0x831843, 0xbe185d, 0xf472b6],
    crystalColor: 0xf472b6,
    treeFoliage: 0xf9a8d4,
    accentHex: '#f472b6',
  },
};

export function normalizeHeatmapTheme(raw?: string | null): HeatmapTheme {
  if (raw === 'cyber' || raw === 'forge' || raw === 'sakura' || raw === 'emerald') {
    return raw;
  }
  return 'emerald';
}

export async function fetchGitHubHeatmapData(
  username: string,
  year?: number | null,
  signal?: AbortSignal,
): Promise<GitHubHeatmapData> {
  const cleanUser = username.trim().replace(/^@/, '');
  const url = new URL(`/api/github-heatmap/${encodeURIComponent(cleanUser)}`, window.location.origin);
  if (year && year >= 2008) {
    url.searchParams.set('year', String(year));
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errJson?.message || `Could not load GitHub contributions for @${cleanUser}.`);
  }

  return (await res.json()) as GitHubHeatmapData;
}

function makePlaqueTexture(
  title: string,
  subtitle: string,
  accentHex: string,
  widthPx = 640,
  heightPx = 150,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090f1d';
  ctx.beginPath();
  ctx.roundRect(4, 4, widthPx - 8, heightPx - 8, 22);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.beginPath();
  ctx.arc(38, 54, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.fillText(title, 62, 65);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 22px "SF Mono", ui-monospace, Menlo, monospace';
  ctx.fillText(subtitle, 30, 114);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeMiniLabelTexture(label: string, colorHex = '#cbd5e1'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 56;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(9, 15, 29, 0.82)';
  ctx.beginPath();
  ctx.roundRect(4, 6, 120, 44, 12);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = colorHex;
  ctx.font = '700 24px "SF Mono", ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 29);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCelebrationMascot(accentHex: number): { root: THREE.Group; rightArm: THREE.Group } {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6c99d, roughness: 0.72, flatShading: true });
  const tunicMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.62, flatShading: true });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, flatShading: true });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xb45309,
    emissiveIntensity: 0.45,
    roughness: 0.35,
    metalness: 0.55,
  });

  // Legs
  const legGeo = new THREE.BoxGeometry(0.14, 0.24, 0.14);
  const leftLeg = new THREE.Mesh(legGeo, bootMat);
  leftLeg.position.set(-0.1, 0.12, 0);
  const rightLeg = new THREE.Mesh(legGeo, bootMat);
  rightLeg.position.set(0.1, 0.12, 0);
  root.add(leftLeg, rightLeg);

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.28), tunicMat);
  torso.position.y = 0.41;
  torso.castShadow = true;
  root.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.34), skinMat);
  head.position.y = 0.78;
  head.castShadow = true;
  root.add(head);

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const eyeGeo = new THREE.BoxGeometry(0.05, 0.06, 0.03);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.08, 0.79, 0.175);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.08, 0.79, 0.175);
  root.add(eyeL, eyeR);

  // Golden Champion Crown on Mascot
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.12, 6), goldMat);
  crown.position.y = 1.0;
  root.add(crown);

  // Left arm
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.11), tunicMat);
  leftArm.position.set(-0.27, 0.42, 0);
  root.add(leftArm);

  // Right waving arm holding a tiny golden pennant
  const rightArm = new THREE.Group();
  rightArm.position.set(0.27, 0.54, 0);
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.11), tunicMat);
  armMesh.position.y = 0.1;
  rightArm.add(armMesh);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.68, 6), goldMat);
  pole.position.set(0, 0.38, 0);
  rightArm.add(pole);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.03),
    new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: accentHex,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    }),
  );
  flag.position.set(0.17, 0.6, 0);
  rightArm.add(flag);

  rightArm.rotation.z = -0.35;
  root.add(rightArm);

  return { root, rightArm };
}

export function buildHeatmapSkylineWorld(
  data: GitHubHeatmapData,
  themeName: HeatmapTheme,
): BuiltHeatmapWorld {
  const spec = HEATMAP_THEMES[themeName] ?? HEATMAP_THEMES.emerald;
  const worldGroup = new THREE.Group();
  const towers: BuiltHeatmapTower[] = [];
  const clouds: Array<{ mesh: THREE.Object3D; speed: number; baseZ: number }> = [];
  const floatingCrystals: Array<{ mesh: THREE.Object3D; baseY: number; phase: number }> = [];

  const numWeeks = Math.max(1, data.weeks.length);
  const cellStepX = 0.58;
  const cellStepZ = 0.62;
  const cellSize = 0.45;

  const gridSpanX = (numWeeks - 1) * cellStepX;
  const gridSpanZ = 6 * cellStepZ;
  const islandLength = Math.max(24, gridSpanX + 5.8);
  const islandWidth = gridSpanZ + 5.2;

  // 1. Floating Low-Poly Island Deck + Tapered Rock Cliff Underside
  const deckGroup = new THREE.Group();

  const topDeck = new THREE.Mesh(
    new THREE.BoxGeometry(islandLength, 0.55, islandWidth),
    new THREE.MeshStandardMaterial({ color: spec.deckTop, roughness: 0.85, flatShading: true }),
  );
  topDeck.position.y = -0.275;
  topDeck.receiveShadow = true;
  deckGroup.add(topDeck);

  const rimDeck = new THREE.Mesh(
    new THREE.BoxGeometry(islandLength + 0.36, 0.22, islandWidth + 0.36),
    new THREE.MeshStandardMaterial({ color: spec.deckRim, roughness: 0.9, flatShading: true }),
  );
  rimDeck.position.y = -0.14;
  deckGroup.add(rimDeck);

  // Faceted inverted rock cone chunks underneath
  const rockUpperMat = new THREE.MeshStandardMaterial({
    color: spec.rockUpper,
    roughness: 0.94,
    flatShading: true,
  });
  const rockLowerMat = new THREE.MeshStandardMaterial({
    color: spec.rockLower,
    roughness: 0.96,
    flatShading: true,
  });

  const mainBelly = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.36, 4.6, 9), rockUpperMat);
  mainBelly.scale.set(islandLength * 0.46, 1, islandWidth * 0.46);
  mainBelly.position.y = -2.8;
  deckGroup.add(mainBelly);

  for (const [ox, oz, sy] of [
    [-islandLength * 0.28, 0.4, 3.6],
    [islandLength * 0.27, -0.35, 3.9],
    [0, 0.15, 5.4],
  ] as const) {
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.6, sy, 7), rockLowerMat);
    spire.rotation.x = Math.PI;
    spire.scale.set(1.4, 1, 0.95);
    spire.position.set(ox, -2.5 - sy * 0.35, oz);
    deckGroup.add(spire);
  }

  // Decorative low-poly trees on island corners
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({
    color: spec.treeFoliage,
    roughness: 0.72,
    flatShading: true,
  });
  for (const [tx, tz, sc] of [
    [-islandLength * 0.45, -islandWidth * 0.39, 1.05],
    [islandLength * 0.45, -islandWidth * 0.38, 0.95],
    [-islandLength * 0.45, islandWidth * 0.38, 0.9],
    [islandLength * 0.45, islandWidth * 0.39, 1.0],
  ] as const) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.48, 6), trunkMat);
    trunk.position.y = 0.24;
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.95, 6), leafMat);
    c1.position.y = 0.85;
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.75, 6), leafMat);
    c2.position.y = 1.32;
    tree.add(trunk, c1, c2);
    tree.position.set(tx, 0, tz);
    tree.scale.setScalar(sc);
    deckGroup.add(tree);
  }

  worldGroup.add(deckGroup);

  // 2. Shared Geometries & Materials for the 371 Day Towers
  const bodyGeo = new THREE.BoxGeometry(cellSize, 1, cellSize);
  bodyGeo.translate(0, 0.5, 0); // Anchor at y = 0 so scale.y grows cleanly upward!
  const capGeo = new THREE.BoxGeometry(cellSize + 0.025, 0.07, cellSize + 0.025);
  const hitGeo = new THREE.BoxGeometry(cellStepX * 0.94, 1, cellStepZ * 0.94);
  hitGeo.translate(0, 0.5, 0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  const emptyBodyMat = new THREE.MeshStandardMaterial({
    color: spec.emptyTile,
    roughness: 0.88,
    flatShading: true,
  });
  const emptyCapMat = new THREE.MeshStandardMaterial({
    color: spec.emptyTile,
    roughness: 0.82,
  });

  const levelBodyMats = spec.levels.map(
    (col, i) =>
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: spec.emissive[i],
        emissiveIntensity: 0.22 + i * 0.09,
        roughness: 0.45,
        metalness: 0.08,
        flatShading: true,
      }),
  );

  const levelCapMats = spec.caps.map(
    (col, i) =>
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.28 + i * 0.14,
        roughness: 0.3,
        metalness: 0.12,
      }),
  );

  const maxCount = Math.max(1, data.maxDailyCount);
  const peakDate = data.peakDay?.date ?? null;
  let peakBeacon: THREE.Object3D | undefined;
  let mascotArm: THREE.Object3D | undefined;
  let peakPlaced = false;

  const startX = -gridSpanX * 0.5;
  const startZ = -gridSpanZ * 0.5;

  for (const week of data.weeks) {
    const x = startX + week.weekIndex * cellStepX;

    // Month signboard along the North boardwalk (`z = startZ - 1.05`)
    if (week.monthLabel) {
      const mTex = makeMiniLabelTexture(week.monthLabel, '#e2e8f0');
      const mSign = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.4, 0.06),
        new THREE.MeshBasicMaterial({ map: mTex }),
      );
      mSign.position.set(x + 0.2, 0.32, startZ - 0.98);
      worldGroup.add(mSign);
    }

    for (const day of week.days) {
      const z = startZ + day.weekday * cellStepZ;
      const lv = Math.max(0, Math.min(4, day.level));
      const isPeak = !peakPlaced && peakDate !== null && day.date === peakDate && day.count > 0;
      if (isPeak) peakPlaced = true;

      const targetHeight =
        day.count <= 0 || lv === 0
          ? 0.08
          : 0.38 + lv * 0.46 + Math.pow(day.count / maxCount, 0.72) * 3.25;

      const bMat = lv === 0 ? emptyBodyMat : levelBodyMats[lv - 1];
      const cMat = lv === 0 ? emptyCapMat : levelCapMats[lv - 1];

      const columnMesh = new THREE.Mesh(bodyGeo, bMat);
      columnMesh.position.set(x, 0, z);
      columnMesh.scale.y = 0.05;
      columnMesh.castShadow = lv > 0;
      columnMesh.receiveShadow = true;
      worldGroup.add(columnMesh);

      const capMesh = new THREE.Mesh(capGeo, cMat);
      capMesh.position.set(x, 0.06, z);
      worldGroup.add(capMesh);

      const hitBox = new THREE.Mesh(hitGeo, hitMat);
      hitBox.position.set(x, 0, z);
      hitBox.scale.y = Math.max(0.55, targetHeight + 0.2);
      worldGroup.add(hitBox);

      const tower: BuiltHeatmapTower = {
        day,
        columnMesh,
        capMesh,
        hitBox,
        targetHeight,
        weekIndex: week.weekIndex,
        isPeak,
        worldPos: new THREE.Vector3(x, targetHeight, z),
      };
      hitBox.userData.heatmapTower = tower;
      columnMesh.userData.heatmapTower = tower;
      capMesh.userData.heatmapTower = tower;
      towers.push(tower);

      if (isPeak) {
        const topperGroup = new THREE.Group();
        topperGroup.position.set(x, targetHeight + 0.08, z);

        const mascot = buildCelebrationMascot(spec.levels[3]);
        mascot.root.scale.setScalar(0.82);
        topperGroup.add(mascot.root);
        mascotArm = mascot.rightArm;

        // Floating golden diamond beacon above the mascot
        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.24, 0),
          new THREE.MeshStandardMaterial({
            color: 0xfef08a,
            emissive: 0xf59e0b,
            emissiveIntensity: 0.75,
            roughness: 0.2,
            metalness: 0.4,
          }),
        );
        gem.position.y = 1.48;
        topperGroup.add(gem);

        worldGroup.add(topperGroup);
        peakBeacon = topperGroup;
      }
    }
  }

  // 3. Weekday Labels (`Mon`, `Wed`, `Fri`) along West edge
  for (const [wdIdx, label] of [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ] as const) {
    const wTex = makeMiniLabelTexture(label, '#94a3b8');
    const wMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.34, 0.05),
      new THREE.MeshBasicMaterial({ map: wTex }),
    );
    wMesh.position.set(startX - 0.95, 0.24, startZ + wdIdx * cellStepZ);
    worldGroup.add(wMesh);
  }

  // 4. Front Monument Plaque (`@username · N contributions · streak · peak`)
  const monumentTex = makePlaqueTexture(
    `@${data.username} · ${data.totalContributions.toLocaleString()} contributions`,
    `${data.periodLabel}  ·  Streak ${data.longestStreak}d  ·  Peak ${data.maxDailyCount}/day`,
    spec.accentHex,
  );
  const plaqueGroup = new THREE.Group();
  const plaqueBoard = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 1.55, 0.14),
    new THREE.MeshBasicMaterial({ map: monumentTex }),
  );
  plaqueBoard.position.y = 0.92;
  plaqueGroup.add(plaqueBoard);

  const postGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.9, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  const pLeft = new THREE.Mesh(postGeo, postMat);
  pLeft.position.set(-2.6, 0.35, -0.05);
  const pRight = new THREE.Mesh(postGeo, postMat);
  pRight.position.set(2.6, 0.35, -0.05);
  plaqueGroup.add(pLeft, pRight);

  plaqueGroup.position.set(0, 0, startZ + gridSpanZ + 1.45);
  plaqueGroup.rotation.x = -0.18;
  worldGroup.add(plaqueGroup);

  // 5. Drifting Clouds & Floating Sky Crystals around the Skyline Island
  const crystalMat = new THREE.MeshStandardMaterial({
    color: spec.crystalColor,
    emissive: spec.crystalColor,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    flatShading: true,
  });
  for (const [cx, cy, cz, ph] of [
    [-islandLength * 0.54, 1.8, -2.5, 0.3],
    [islandLength * 0.54, 2.2, 2.1, 1.9],
    [-islandLength * 0.35, -1.6, islandWidth * 0.62, 3.1],
    [islandLength * 0.38, -1.2, -islandWidth * 0.62, 4.4],
  ] as const) {
    const crys = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), crystalMat);
    crys.scale.y = 1.65;
    crys.position.set(cx, cy, cz);
    worldGroup.add(crys);
    floatingCrystals.push({ mesh: crys, baseY: cy, phase: ph });
  }

  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.92,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
  });
  for (const [clX, clY, clZ, spd] of [
    [-14, 6.2, -9.5, 0.35],
    [11, 7.0, -10.5, 0.28],
    [-18, -3.2, 9.2, 0.42],
    [16, -2.8, 8.6, 0.31],
  ] as const) {
    const cg = new THREE.Group();
    for (const [bx, by, bz, r] of [
      [0, 0, 0, 1.35],
      [-1.1, -0.15, 0.2, 0.95],
      [1.15, -0.1, -0.15, 1.05],
    ] as const) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), cloudMat);
      puff.scale.y = 0.58;
      puff.position.set(bx, by, bz);
      cg.add(puff);
    }
    cg.position.set(clX, clY, clZ);
    worldGroup.add(cg);
    clouds.push({ mesh: cg, speed: spd, baseZ: clZ });
  }

  return {
    worldGroup,
    towers,
    islandLength,
    islandWidth,
    peakBeacon,
    mascotArm,
    clouds,
    floatingCrystals,
  };
}
