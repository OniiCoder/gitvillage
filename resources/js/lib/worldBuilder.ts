import * as THREE from 'three';
import type { BridgeLayout, GateLayout, IslandLayout, RepoVillageGraph } from '@/types/village';
import { hashString } from './villagerMesh';

export interface BuiltWorld {
  worldGroup: THREE.Group;
  islands: IslandLayout[];
  bridges: BridgeLayout[];
  gate?: GateLayout;
  animatedProps: {
    windmillBlades: THREE.Object3D[];
    floatingCrystals: Array<{ mesh: THREE.Object3D; baseY: number; phase: number }>;
    clouds: Array<{ mesh: THREE.Object3D; speed: number; baseZ: number }>;
    lanternGlows: THREE.MeshStandardMaterial[];
    windowGlows: THREE.MeshStandardMaterial[];
    headBeacon?: THREE.Object3D;
    fireflies?: THREE.Points;
  };
}

function makeSignTexture(text: string, accentHex: string, subtitle: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // Apple Dark Graphite Spatial Plaque
  ctx.fillStyle = '#1c1c1e';
  ctx.beginPath();
  ctx.roundRect(10, 10, 492, 172, 34);
  ctx.fill();

  // Subtle specular hairline border
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.stroke();

  // Luminous semantic status dot
  ctx.fillStyle = accentHex;
  ctx.beginPath();
  ctx.arc(48, 74, 10, 0, Math.PI * 2);
  ctx.fill();

  // Branch / Gate title in crisp SF Pro / SF Mono
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 35px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
  const truncated = text.length > 22 ? `${text.slice(0, 21)}…` : text;
  ctx.fillText(truncated, 72, 85);

  // Muted secondary caption
  ctx.fillStyle = 'rgba(235, 235, 245, 0.68)';
  ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  ctx.fillText(subtitle, 40, 136);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createIslandMesh(
  length: number,
  width: number,
  seed: number,
  accentColor: string,
  floatingCrystals: BuiltWorld['animatedProps']['floatingCrystals'],
): THREE.Group {
  const group = new THREE.Group();

  // Grassy top deck — stretched octagonal prism with gently beveled vertices
  const topSegsX = Math.max(8, Math.round(length / 2.2));
  const topGeo = new THREE.BoxGeometry(length, 0.9, width, topSegsX, 1, 5);
  const pos = topGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Round off corners in XZ plane so island has an organic pill/oval silhouette
    const nx = x / (length * 0.5);
    const nz = z / (width * 0.5);
    const radial = Math.hypot(nx * 0.72, nz);
    const taper = radial > 0.75 ? Math.max(0.58, 1 - (radial - 0.75) * 0.65) : 1;

    const wobble =
      Math.sin(x * 0.45 + seed) * 0.22 + Math.cos(z * 0.65 + seed * 0.5) * 0.18;

    pos.setX(i, x * (Math.abs(nx) > 0.85 ? 0.96 : 1));
    pos.setZ(i, z * taper + wobble * 0.35);
    if (y > 0) {
      // Keep center footpath flat (y ~ 0), raise edges slightly into cozy grassy berms
      const edgeLift = Math.max(0, Math.abs(nz) - 0.42) * 0.42;
      pos.setY(i, 0 + edgeLift * 0.35);
    } else {
      pos.setY(i, -0.85);
    }
  }
  topGeo.computeVertexNormals();

  const grassColor = new THREE.Color('#4ade80').lerp(new THREE.Color(accentColor), 0.16);
  const grassMat = new THREE.MeshStandardMaterial({
    color: grassColor,
    roughness: 0.85,
    flatShading: true,
  });
  const grassMesh = new THREE.Mesh(topGeo, grassMat);
  grassMesh.receiveShadow = true;
  grassMesh.castShadow = true;
  group.add(grassMesh);

  // Rocky cliff underbelly tapering downward into floating island spires
  const rockDepth = 3.4 + (width * 0.28);
  const rockGeo = new THREE.CylinderGeometry(width * 0.48, width * 0.1, rockDepth, 11, 4);
  rockGeo.scale(length / width, 1, 1);
  const rPos = rockGeo.attributes.position;
  for (let i = 0; i < rPos.count; i++) {
    const rx = rPos.getX(i);
    const ry = rPos.getY(i);
    const rz = rPos.getZ(i);
    const crag =
      Math.sin(rx * 0.7 + ry * 1.1 + seed) * 0.38 +
      Math.cos(rz * 0.9 - ry * 0.8 + seed) * 0.34;
    const depthFactor = (rockDepth * 0.5 - ry) / rockDepth; // 0 at top, 1 at tip
    rPos.setX(i, rx + crag * (0.4 + depthFactor * 0.5));
    rPos.setZ(i, rz + crag * 0.4);
  }
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.92,
    flatShading: true,
  });
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.position.y = -0.82 - rockDepth * 0.5;
  rockMesh.castShadow = true;
  group.add(rockMesh);

  // Secondary hanging stalactite spires + glowing levitation crystal underneath
  const crystalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentColor),
    emissive: new THREE.Color(accentColor),
    emissiveIntensity: 0.65,
    roughness: 0.2,
    flatShading: true,
  });
  const crystalCount = Math.max(2, Math.floor(length / 10));
  for (let c = 0; c < crystalCount; c++) {
    const cx = -length * 0.32 + (c / Math.max(1, crystalCount - 1)) * (length * 0.64);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), crystalMat);
    crystal.scale.set(0.75, 1.8, 0.75);
    const baseY = -rockDepth - 1.1 - (c % 2) * 0.45;
    crystal.position.set(cx, baseY, ((c % 2) - 0.5) * 0.9);
    group.add(crystal);
    floatingCrystals.push({ mesh: crystal, baseY, phase: c * 1.7 + seed });
  }

  return group;
}

function addTree(parent: THREE.Group, x: number, z: number, seed: number, tintHex: string): void {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.17, 0.85, 6),
    new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9, flatShading: true }),
  );
  trunk.position.y = 0.42;
  trunk.castShadow = true;
  tree.add(trunk);

  const isBlossom = seed % 4 === 0;
  const baseLeaf = isBlossom
    ? new THREE.Color('#f9a8d4').lerp(new THREE.Color(tintHex), 0.25)
    : new THREE.Color('#22c55e').lerp(new THREE.Color('#15803d'), (seed % 5) / 8);

  const leafMat = new THREE.MeshStandardMaterial({
    color: baseLeaf,
    roughness: 0.78,
    flatShading: true,
  });

  if (isBlossom) {
    const puff1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62), leafMat);
    puff1.position.set(0, 1.15, 0);
    puff1.castShadow = true;
    const puff2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.44), leafMat);
    puff2.position.set(0.32, 1.0, 0.2);
    tree.add(puff1, puff2);
  } else {
    for (let tier = 0; tier < 3; tier++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.68 - tier * 0.16, 0.78, 7),
        leafMat,
      );
      cone.position.y = 0.95 + tier * 0.45;
      cone.castShadow = true;
      tree.add(cone);
    }
  }

  const s = 0.82 + ((seed % 35) / 100);
  tree.scale.setScalar(s);
  tree.rotation.y = (seed % 628) / 100;
  parent.add(tree);
}

function addCottage(
  parent: THREE.Group,
  x: number,
  z: number,
  rotY: number,
  roofColor: string,
  windowGlows: THREE.MeshStandardMaterial[],
): void {
  const cottage = new THREE.Group();
  cottage.position.set(x, 0, z);
  cottage.rotation.y = rotY;

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 1.1, 1.35),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.85, flatShading: true }),
  );
  walls.position.y = 0.55;
  walls.castShadow = true;
  walls.receiveShadow = true;
  cottage.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.38, 0.95, 4),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b45309').lerp(new THREE.Color(roofColor), 0.35),
      roughness: 0.75,
      flatShading: true,
    }),
  );
  roof.position.y = 1.55;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  cottage.add(roof);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.62, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x78350f }),
  );
  door.position.set(0, 0.31, 0.68);
  cottage.add(door);

  const winMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.45,
  });
  windowGlows.push(winMat);

  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.06), winMat);
  win1.position.set(-0.44, 0.62, 0.68);
  const win2 = win1.clone();
  win2.position.x = 0.44;
  cottage.add(win1, win2);

  parent.add(cottage);
}

function addLanternPost(
  parent: THREE.Group,
  x: number,
  z: number,
  lanternGlows: THREE.MeshStandardMaterial[],
): void {
  const post = new THREE.Group();
  post.position.set(x, 0, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 1.35, 6),
    new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 }),
  );
  pole.position.y = 0.67;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x451a03 }),
  );
  arm.position.set(0.12, 1.32, 0);

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfde68a,
    emissive: 0xf97316,
    emissiveIntensity: 0.7,
  });
  lanternGlows.push(glowMat);

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), glowMat);
  lamp.position.set(0.24, 1.16, 0);

  post.add(pole, arm, lamp);
  parent.add(post);
}

function addWindmill(
  parent: THREE.Group,
  x: number,
  z: number,
  windmillBlades: THREE.Object3D[],
): void {
  const mill = new THREE.Group();
  mill.position.set(x, 0, z);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.98, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0xfafaf9, roughness: 0.85, flatShading: true }),
  );
  tower.position.y = 1.3;
  tower.castShadow = true;
  mill.add(tower);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 0.75, 8),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.65, flatShading: true }),
  );
  cap.position.y = 2.95;
  mill.add(cap);

  const hub = new THREE.Group();
  hub.position.set(0, 2.25, 0.72);
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xfef9c3,
    side: THREE.DoubleSide,
    roughness: 0.7,
  });
  const sparMat = new THREE.MeshStandardMaterial({ color: 0x78350f });

  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.65, 0.05), sparMat);
    spar.position.y = 0.82;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.25, 0.02), sailMat);
    sail.position.set(0.2, 0.95, 0.02);
    arm.add(spar, sail);
    hub.add(arm);
  }

  mill.add(hub);
  windmillBlades.push(hub);
  parent.add(mill);
}

function buildSuspensionBridge(
  start: THREE.Vector3,
  end: THREE.Vector3,
  lanternGlows: THREE.MeshStandardMaterial[],
): { group: THREE.Group; curve: THREE.CatmullRomCurve3 } {
  const group = new THREE.Group();
  const dist = start.distanceTo(end);
  const mid = start.clone().lerp(end, 0.5);
  // Gentle catenary sag in the middle
  mid.y -= Math.min(1.1, dist * 0.06);

  const q1 = start.clone().lerp(mid, 0.5);
  q1.y -= Math.min(0.25, dist * 0.015);
  const q3 = mid.clone().lerp(end, 0.5);
  q3.y -= Math.min(0.25, dist * 0.015);

  const curve = new THREE.CatmullRomCurve3([start.clone(), q1, mid, q3, end.clone()]);

  const plankCount = Math.max(8, Math.floor(dist / 0.58));
  const plankGeo = new THREE.BoxGeometry(1.15, 0.08, 0.36);
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.88 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.85 });

  const leftRailPts: THREE.Vector3[] = [];
  const rightRailPts: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= plankCount; i++) {
    const t = i / plankCount;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(up, tangent).normalize();

    if (i > 0 && i < plankCount) {
      const plank = new THREE.Mesh(plankGeo, plankMat);
      plank.position.copy(pt);
      plank.position.y += 0.04;
      const lookTarget = pt.clone().add(tangent);
      lookTarget.y = pt.y + 0.04;
      plank.lookAt(lookTarget);
      plank.castShadow = true;
      plank.receiveShadow = true;
      group.add(plank);
    }

    const railHeight = i === 0 || i === plankCount ? 0.92 : 0.68;
    const lPt = pt.clone().addScaledVector(side, 0.6).add(new THREE.Vector3(0, railHeight, 0));
    const rPt = pt.clone().addScaledVector(side, -0.6).add(new THREE.Vector3(0, railHeight, 0));
    leftRailPts.push(lPt);
    rightRailPts.push(rPt);

    // End posts or periodic vertical hangers
    if (i === 0 || i === plankCount) {
      for (const sgn of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.09, 1.1, 6),
          plankMat,
        );
        post.position.copy(pt).addScaledVector(side, 0.6 * sgn);
        post.position.y += 0.52;
        group.add(post);
      }
    } else if (i % 4 === 0) {
      for (const [sgn, rTop] of [
        [1, lPt],
        [-1, rPt],
      ] as const) {
        const base = pt.clone().addScaledVector(side, 0.58 * sgn);
        const h = rTop.y - base.y;
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, h, 4), ropeMat);
        hanger.position.copy(base);
        hanger.position.y += h * 0.5;
        group.add(hanger);
      }
    }
  }

  // Handrail ropes
  for (const pts of [leftRailPts, rightRailPts]) {
    const railCurve = new THREE.CatmullRomCurve3(pts);
    const railGeo = new THREE.TubeGeometry(railCurve, plankCount * 2, 0.032, 5, false);
    group.add(new THREE.Mesh(railGeo, ropeMat));
  }

  // Mid-bridge glowing lantern
  const midRail = leftRailPts[Math.floor(leftRailPts.length / 2)];
  if (midRail) {
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf97316,
      emissiveIntensity: 0.85,
    });
    lanternGlows.push(glowMat);
    const midLamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), glowMat);
    midLamp.position.copy(midRail).add(new THREE.Vector3(0, 0.14, 0));
    group.add(midLamp);
  }

  return { group, curve };
}

export function buildVillageWorld(graph: RepoVillageGraph): BuiltWorld {
  const worldGroup = new THREE.Group();
  const islands: IslandLayout[] = [];
  const bridges: BridgeLayout[] = [];
  const animatedProps: BuiltWorld['animatedProps'] = {
    windmillBlades: [],
    floatingCrystals: [],
    clouds: [],
    lanternGlows: [],
    windowGlows: [],
  };

  const mainBranch = graph.branches.find((b) => b.isDefault) ?? graph.branches[0];
  const sideBranches = graph.branches.filter((b) => b !== mainBranch);

  // 1. Build Main Island along X axis
  const mainCommitCount = Math.max(2, mainBranch.commits.length);
  const mainLength = Math.max(22, mainCommitCount * 2.55 + 7);
  const mainWidth = 9.4;
  const mainCenter = new THREE.Vector3(0, 0, 0);

  const mainMesh = createIslandMesh(
    mainLength,
    mainWidth,
    hashString(mainBranch.name),
    mainBranch.color,
    animatedProps.floatingCrystals,
  );
  worldGroup.add(mainMesh);

  // Winding cobblestone path along main island
  const mainPathPts: THREE.Vector3[] = [];
  const mainSteps = Math.max(8, mainCommitCount);
  for (let i = 0; i <= mainSteps; i++) {
    const t = i / mainSteps;
    const x = -mainLength * 0.42 + t * (mainLength * 0.84);
    const z = Math.sin(t * Math.PI * 2.5) * 1.15;
    mainPathPts.push(new THREE.Vector3(x, 0.02, z));
  }
  const mainCurve = new THREE.CatmullRomCurve3(mainPathPts);

  // Stepping stones along path
  const stoneGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.06, 7);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 });
  const stoneTotal = Math.floor(mainLength * 1.3);
  for (let s = 0; s <= stoneTotal; s++) {
    const pt = mainCurve.getPointAt(s / stoneTotal);
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    stone.position.set(pt.x, 0.02, pt.z);
    stone.scale.set(1.1, 1, 0.82);
    stone.rotation.y = s * 0.7;
    stone.receiveShadow = true;
    mainMesh.add(stone);
  }

  const mainWaypoints = new Map<string, THREE.Vector3>();
  mainBranch.commits.forEach((c, idx) => {
    const t =
      mainBranch.commits.length <= 1
        ? 0.5
        : 0.06 + (idx / (mainBranch.commits.length - 1)) * 0.88;
    mainWaypoints.set(c.sha, mainCurve.getPointAt(t));
  });

  // Main island signpost
  const mainSignGroup = new THREE.Group();
  const signTex = makeSignTexture(
    mainBranch.name,
    mainBranch.color,
    `${mainBranch.commits.length} commits · default island`,
  );
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.98, 0.12),
    new THREE.MeshBasicMaterial({ map: signTex }),
  );
  signBoard.position.y = 1.65;
  const postL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 1.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c3a21 }),
  );
  postL.position.set(-0.9, 0.85, 0);
  const postR = postL.clone();
  postR.position.x = 0.9;
  mainSignGroup.add(postL, postR, signBoard);
  mainSignGroup.position.set(-mainLength * 0.43, 0, -2.6);
  mainSignGroup.rotation.y = 0.35;
  mainMesh.add(mainSignGroup);

  //HEAD Crystal Beacon at the newest end of Main Island
  const headPos = mainCurve.getPointAt(0.96);
  const beaconPedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.95, 0.45, 8),
    stoneMat,
  );
  beaconPedestal.position.set(headPos.x + 1.4, 0.22, headPos.z);
  mainMesh.add(beaconPedestal);

  const headCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.9,
      roughness: 0.15,
      flatShading: true,
    }),
  );
  headCrystal.scale.set(0.85, 1.6, 0.85);
  headCrystal.position.set(headPos.x + 1.4, 1.55, headPos.z);
  mainMesh.add(headCrystal);
  animatedProps.headBeacon = headCrystal;

  // Decorate Main Island with cottages, windmill, trees & lanterns
  addWindmill(mainMesh, 1.5, -2.9, animatedProps.windmillBlades);
  addCottage(mainMesh, -mainLength * 0.22, -2.85, 0.2, mainBranch.color, animatedProps.windowGlows);
  addCottage(mainMesh, mainLength * 0.2, 2.9, Math.PI - 0.25, '#fbbf24', animatedProps.windowGlows);

  const treeSlots = Math.max(6, Math.floor(mainLength / 3.4));
  for (let i = 0; i < treeSlots; i++) {
    const tx = -mainLength * 0.41 + (i / (treeSlots - 1)) * (mainLength * 0.82);
    const side = i % 2 === 0 ? 1 : -1;
    if (Math.abs(tx - 1.5) < 2.6 && side === -1) continue;
    if (Math.abs(tx + mainLength * 0.22) < 2.4 && side === -1) continue;
    if (Math.abs(tx - mainLength * 0.2) < 2.4 && side === 1) continue;
    addTree(mainMesh, tx, side * (2.8 + (i % 3) * 0.45), i * 17 + 3, mainBranch.color);
    if (i % 2 === 0) {
      addLanternPost(mainMesh, tx + 0.6, side * 1.75, animatedProps.lanternGlows);
    }
  }

  islands.push({
    branch: mainBranch,
    center: mainCenter,
    length: mainLength,
    width: mainWidth,
    pathCurve: mainCurve,
    commitWaypoints: mainWaypoints,
    signMesh: signBoard,
  });

  // 2. Build Floating Feature / Topic Branch Islands + Suspension Bridges!
  sideBranches.forEach((branch, bIdx) => {
    const cCount = Math.max(2, branch.commits.length);
    const bLength = Math.max(9.5, cCount * 2.65 + 4.5);
    const bWidth = 6.2;

    const zSide = bIdx % 2 === 0 ? -1 : 1;
    const tierOffset = Math.floor(bIdx / 2);

    // Anchor X near fork commit on main if known
    const forkPt =
      (branch.forkFromSha ? mainWaypoints.get(branch.forkFromSha) : undefined) ??
      new THREE.Vector3(
        -mainLength * 0.25 + ((bIdx + 0.5) / Math.max(1, sideBranches.length)) * (mainLength * 0.55),
        0,
        0,
      );

    const islandX = forkPt.x + bLength * 0.34 + tierOffset * 3.0;
    const islandY = (bIdx % 2 === 0 ? 2.35 : 1.65) + tierOffset * 1.4;
    const islandZ = zSide * (mainWidth * 0.5 + bWidth * 0.5 + 5.6 + tierOffset * 3.5);
    const bCenter = new THREE.Vector3(islandX, islandY, islandZ);

    const bMesh = createIslandMesh(
      bLength,
      bWidth,
      hashString(branch.name),
      branch.color,
      animatedProps.floatingCrystals,
    );
    bMesh.position.copy(bCenter);
    worldGroup.add(bMesh);

    // Path curve in world space for this branch island
    const bPathPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const lx = -bLength * 0.39 + t * (bLength * 0.78);
      const lz = Math.sin(t * Math.PI * 1.5) * 0.65;
      bPathPts.push(new THREE.Vector3(bCenter.x + lx, bCenter.y + 0.02, bCenter.z + lz));
    }
    const bCurve = new THREE.CatmullRomCurve3(bPathPts);

    // Stepping stones
    const bStones = Math.floor(bLength * 1.2);
    for (let s = 0; s <= bStones; s++) {
      const pt = bCurve.getPointAt(s / bStones);
      const st = new THREE.Mesh(stoneGeo, stoneMat);
      st.position.set(pt.x - bCenter.x, 0.02, pt.z - bCenter.z);
      st.scale.set(0.95, 1, 0.78);
      bMesh.add(st);
    }

    // Branch Signpost
    const bSign = new THREE.Group();
    const bTex = makeSignTexture(
      branch.name,
      branch.color,
      `${branch.commits.length} commit${branch.commits.length === 1 ? '' : 's'}${branch.mergeIntoSha ? ' · merged' : ' · active'}`,
    );
    const bBoard = new THREE.Mesh(
      new THREE.BoxGeometry(2.35, 0.88, 0.1),
      new THREE.MeshBasicMaterial({ map: bTex }),
    );
    bBoard.position.y = 1.45;
    const p1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x5c3a21 }),
    );
    p1.position.set(-0.8, 0.75, 0);
    const p2 = p1.clone();
    p2.position.x = 0.8;
    bSign.add(p1, p2, bBoard);
    bSign.position.set(-bLength * 0.38, 0, -zSide * 1.6);
    bSign.rotation.y = zSide > 0 ? Math.PI - 0.3 : 0.3;
    bMesh.add(bSign);

    // Cozy cottage + trees on branch island
    addCottage(
      bMesh,
      0.4,
      zSide * 1.65,
      zSide > 0 ? Math.PI : 0,
      branch.color,
      animatedProps.windowGlows,
    );
    addTree(bMesh, -bLength * 0.25, zSide * 1.85, bIdx * 31 + 7, branch.color);
    addTree(bMesh, bLength * 0.28, -zSide * 1.65, bIdx * 19 + 4, branch.color);
    addLanternPost(bMesh, 0, -zSide * 1.35, animatedProps.lanternGlows);

    const bWaypoints = new Map<string, THREE.Vector3>();
    branch.commits.forEach((c, idx) => {
      const t =
        branch.commits.length <= 1
          ? 0.5
          : 0.1 + (idx / (branch.commits.length - 1)) * 0.8;
      bWaypoints.set(c.sha, bCurve.getPointAt(t));
    });

    islands.push({
      branch,
      center: bCenter,
      length: bLength,
      width: bWidth,
      pathCurve: bCurve,
      commitWaypoints: bWaypoints,
      signMesh: bBoard,
    });

    // Fork Suspension Bridge (Main -> Branch Island start)
    const mainEdgeStart = new THREE.Vector3(
      forkPt.x,
      0.04,
      zSide * (mainWidth * 0.44),
    );
    const branchEdgeStart = new THREE.Vector3(
      bCenter.x - bLength * 0.36,
      bCenter.y + 0.04,
      bCenter.z - zSide * (bWidth * 0.43),
    );
    const forkBridge = buildSuspensionBridge(
      mainEdgeStart,
      branchEdgeStart,
      animatedProps.lanternGlows,
    );
    worldGroup.add(forkBridge.group);
    bridges.push({
      fromBranch: mainBranch.name,
      toBranch: branch.name,
      curve: forkBridge.curve,
    });

    // Merge Return Suspension Bridge (Branch Island end -> Main merge commit!)
    if (branch.mergeIntoSha) {
      const mergePt = mainWaypoints.get(branch.mergeIntoSha);
      if (mergePt) {
        const branchEdgeEnd = new THREE.Vector3(
          bCenter.x + bLength * 0.36,
          bCenter.y + 0.04,
          bCenter.z - zSide * (bWidth * 0.43),
        );
        const mainEdgeEnd = new THREE.Vector3(
          mergePt.x,
          0.04,
          zSide * (mainWidth * 0.44),
        );
        const mergeBridge = buildSuspensionBridge(
          branchEdgeEnd,
          mainEdgeEnd,
          animatedProps.lanternGlows,
        );
        worldGroup.add(mergeBridge.group);
        bridges.push({
          fromBranch: branch.name,
          toBranch: mainBranch.name,
          curve: mergeBridge.curve,
        });
      }
    }
  });

  // 3. Drifting Low-Poly Cloud Sea around and beneath the floating islands
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
  });
  for (let c = 0; c < 18; c++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (c % 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.4 + (p % 2) * 0.65, 0),
        cloudMat,
      );
      puff.position.set((p - 1) * 1.45, (p % 2) * 0.35, ((p * 7) % 3 - 1) * 0.4);
      puff.scale.set(1.25, 0.65, 1.0);
      cloud.add(puff);
    }
    const cx = -45 + (c * 13) % 90;
    const cy = -5.5 - (c % 5) * 2.4 + (c > 12 ? 12.5 : 0);
    const cz = -32 + ((c * 19) % 64);
    cloud.position.set(cx, cy, cz);
    worldGroup.add(cloud);
    animatedProps.clouds.push({
      mesh: cloud,
      speed: 0.35 + (c % 5) * 0.14,
      baseZ: cz,
    });
  }

  // 4. Ambient twinkling fireflies / sky motes
  const moteCount = 140;
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePositions[i * 3] = (Math.random() - 0.5) * (mainLength + 24);
    motePositions[i * 3 + 1] = -1 + Math.random() * 11;
    motePositions[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xfef08a,
    size: 0.22,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fireflies = new THREE.Points(moteGeo, moteMat);
  worldGroup.add(fireflies);
  animatedProps.fireflies = fireflies;

  // 5. If this is a Local Repo, build the Working-Tree Village Gate & Sky-Dock Arrival Pier!
  let gate: GateLayout | undefined;
  if (graph.isLocal) {
    const visitorCount = graph.gateVisitors?.length ?? 0;
    const archX = mainLength * 0.47;
    const archPosition = new THREE.Vector3(archX, 0, 0);

    const rowsNeeded = Math.max(2, Math.ceil(visitorCount / 2));
    const dockLength = Math.max(7.5, rowsNeeded * 1.45 + 3.8);
    const dockWidth = 5.4;
    const dockCenter = new THREE.Vector3(archX + dockLength * 0.5 + 0.3, 0, 0);

    const gateGroup = new THREE.Group();

    // Wooden Sky-Dock Arrival Pier jutting into the clouds outside the gate
    const pierDeck = new THREE.Mesh(
      new THREE.BoxGeometry(dockLength, 0.28, dockWidth),
      new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.88, flatShading: true }),
    );
    pierDeck.position.set(dockCenter.x, -0.11, 0);
    pierDeck.receiveShadow = true;
    pierDeck.castShadow = true;
    gateGroup.add(pierDeck);

    // Individual cross-planks texture feel on pier
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.85 });
    const plankCount = Math.floor(dockLength / 0.65);
    for (let p = 0; p < plankCount; p++) {
      const px = archX + 0.65 + p * 0.65;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.05, dockWidth - 0.3),
        plankMat,
      );
      strip.position.set(px, 0.03, 0);
      strip.receiveShadow = true;
      gateGroup.add(strip);

      // Pier side bollards & rope posts
      if (p % 3 === 0) {
        for (const sgn of [-1, 1]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.09, 0.85, 6),
            plankMat,
          );
          post.position.set(px, 0.42, sgn * (dockWidth * 0.46));
          gateGroup.add(post);
        }
      }
    }

    // Buoyant crystal underneath the Sky-Dock
    const dockCrystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.52, 0),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.75,
        flatShading: true,
      }),
    );
    dockCrystal.scale.set(0.8, 1.7, 0.8);
    dockCrystal.position.set(dockCenter.x, -2.1, 0);
    gateGroup.add(dockCrystal);
    animatedProps.floatingCrystals.push({
      mesh: dockCrystal,
      baseY: -2.1,
      phase: 2.4,
    });

    // Grand Stone & Timber Gatehouse Archway at archX
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.88,
      flatShading: true,
    });
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x451a03,
      roughness: 0.85,
      flatShading: true,
    });

    const gateSpanZ = 1.95; // half-span of archway
    for (const sgn of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 3.7, 0.75), pillarMat);
      pillar.position.set(archX, 1.85, sgn * gateSpanZ);
      pillar.castShadow = true;
      gateGroup.add(pillar);

      // Gatehouse fence wings flanking the gate
      const fence = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 2.1), beamMat);
      fence.position.set(archX, 0.58, sgn * (gateSpanZ + 1.4));
      fence.castShadow = true;
      gateGroup.add(fence);

      // Hanging Gate Lanterns
      const glowMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: visitorCount > 0 ? 0xf97316 : 0x10b981,
        emissiveIntensity: 1.1,
      });
      animatedProps.lanternGlows.push(glowMat);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.24), glowMat);
      lamp.position.set(archX + 0.42, 2.5, sgn * gateSpanZ);
      gateGroup.add(lamp);
    }

    // Overhead Gate Roof & Crossbeams
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.4, gateSpanZ * 2 + 1.5),
      beamMat,
    );
    lintel.position.set(archX, 3.85, 0);
    lintel.castShadow = true;
    gateGroup.add(lintel);

    const roofMat = new THREE.MeshStandardMaterial({
      color: visitorCount > 0 ? 0xd97706 : 0x059669,
      roughness: 0.72,
      flatShading: true,
    });
    const gableRoof = new THREE.Mesh(
      new THREE.BoxGeometry(1.22, 0.26, gateSpanZ * 2 + 1.95),
      roofMat,
    );
    gableRoof.position.set(archX, 4.18, 0);
    const roofRidge = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.22, gateSpanZ * 2 + 2.25),
      roofMat,
    );
    roofRidge.position.set(archX, 4.42, 0);
    gateGroup.add(gableRoof, roofRidge);

    // Gate Overhead Sign Plaque (readable from both outside pier & inside island)
    const gateSignTex = makeSignTexture(
      visitorCount > 0
        ? `VILLAGE GATE · ${visitorCount}`
        : 'VILLAGE GATE · OPEN',
      visitorCount > 0 ? '#fbbf24' : '#34d399',
      visitorCount > 0
        ? `${visitorCount} changed file${visitorCount === 1 ? '' : 's'} waiting outside!`
        : 'Clean working tree · 0 waiting',
    );
    const gatePlaque = new THREE.Mesh(
      new THREE.BoxGeometry(2.85, 0.92, 0.12),
      new THREE.MeshBasicMaterial({ map: gateSignTex }),
    );
    gatePlaque.rotation.y = Math.PI / 2;
    gatePlaque.position.set(archX + 0.48, 3.22, 0);
    const gatePlaqueInner = gatePlaque.clone();
    gatePlaqueInner.rotation.y = -Math.PI / 2;
    gatePlaqueInner.position.set(archX - 0.48, 3.22, 0);
    gateGroup.add(gatePlaque, gatePlaqueInner);

    // Hinged Double Wooden Gate Doors (slatted portcullis/picket doors so visitors can peek in!)
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.6,
      roughness: 0.4,
    });
    const singleDoorWidth = gateSpanZ - 0.36;

    const makeDoorWing = (zDir: 1 | -1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(archX, 0, zDir * (gateSpanZ - 0.35));

      // Horizontal iron rails
      for (const ry of [0.45, 1.65]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.1, singleDoorWidth),
          ironMat,
        );
        rail.position.set(0, ry, -zDir * (singleDoorWidth * 0.5));
        pivot.add(rail);
      }

      // Vertical wooden pickets with gaps so waiting visitors can peek through!
      const slats = 5;
      for (let s = 0; s < slats; s++) {
        const sz = -zDir * (0.18 + (s / (slats - 1)) * (singleDoorWidth - 0.32));
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.15, 0.18), doorMat);
        slat.position.set(0, 1.12, sz);
        slat.castShadow = true;
        pivot.add(slat);
      }
      return pivot;
    };

    const leftDoorPivot = makeDoorWing(-1);
    const rightDoorPivot = makeDoorWing(1);

    // Keep gate closed when uncommitted visitors are waiting; open wide when clean!
    if (visitorCount === 0) {
      leftDoorPivot.rotation.y = 1.35;
      rightDoorPivot.rotation.y = -1.35;
    }

    gateGroup.add(leftDoorPivot, rightDoorPivot);
    worldGroup.add(gateGroup);

    // Compute 1-to-1 Waiting Queue Slots on the Sky-Dock right outside the gate!
    const visitorSlots: THREE.Vector3[] = [];
    for (let i = 0; i < Math.max(visitorCount, 1); i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const jitterZ = ((i * 37) % 10 - 5) * 0.04;
      const vx = archX + 1.25 + row * 1.32 + (col === 1 ? 0.28 : 0);
      const vz = (col === 0 ? -0.78 : 0.78) + jitterZ;
      visitorSlots.push(new THREE.Vector3(vx, 0.05, vz));
    }

    gate = {
      archPosition,
      dockCenter,
      dockLength,
      dockWidth,
      leftDoorPivot,
      rightDoorPivot,
      targetIslandPos: new THREE.Vector3(headPos.x - 1.5, 0.04, 0),
      visitorSlots,
    };
  }

  return { worldGroup, islands, bridges, gate, animatedProps };
}
