import * as THREE from 'three';
import type {
  BranchIslandData,
  BridgeLayout,
  BrokenBridgePlank,
  GateLayout,
  IslandLayout,
  RepoVillageGraph,
} from '@/types/village';
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
    conflictRifts: THREE.Object3D[];
    conflictGateBarrier?: THREE.Object3D;
    gateRoofMat?: THREE.MeshStandardMaterial;
    headBeacon?: THREE.Object3D;
    fireflies?: THREE.Points;
    stormGroup?: THREE.Group;
    rainLines?: THREE.LineSegments;
    lightningBolt?: THREE.Mesh;
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
  conflictMeta?: { oursBranch: string; theirsBranch: string },
  conflictRifts?: THREE.Object3D[],
): {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  conflictRiftGroup?: THREE.Group;
  brokenPlanks?: BrokenBridgePlank[];
} {
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
  const charredPlankMat = new THREE.MeshStandardMaterial({
    color: 0x7f1d1d,
    emissive: 0x991b1b,
    emissiveIntensity: 0.28,
    roughness: 0.85,
  });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.85 });

  const leftRailPts: THREE.Vector3[] = [];
  const rightRailPts: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const brokenPlanks: BrokenBridgePlank[] = [];

  for (let i = 0; i <= plankCount; i++) {
    const t = i / plankCount;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(up, tangent).normalize();

    if (i > 0 && i < plankCount) {
      const inChasm = Boolean(conflictMeta && t > 0.37 && t < 0.63);
      const nearFracture = Boolean(
        conflictMeta && !inChasm && ((t >= 0.23 && t <= 0.37) || (t >= 0.63 && t <= 0.77)),
      );

      const plank = new THREE.Mesh(plankGeo, nearFracture ? charredPlankMat : plankMat);
      plank.position.copy(pt);
      plank.position.y += 0.04;
      const lookTarget = pt.clone().add(tangent);
      lookTarget.y = pt.y + 0.04;
      plank.lookAt(lookTarget);
      plank.castShadow = true;
      plank.receiveShadow = true;

      if (conflictMeta && (inChasm || nearFracture)) {
        const healedPos = plank.position.clone();
        const healedRot = plank.rotation.clone();

        if (inChasm) {
          const brokenPos = healedPos.clone().add(new THREE.Vector3(0, -1.4, 0));
          const brokenRot = new THREE.Euler(
            healedRot.x + 0.6,
            healedRot.y + 0.3,
            healedRot.z - 0.5,
          );
          plank.position.copy(brokenPos);
          plank.rotation.copy(brokenRot);
          plank.scale.setScalar(0.001);
          brokenPlanks.push({
            mesh: plank,
            brokenPos,
            brokenRot,
            healedPos,
            healedRot,
            hiddenWhenBroken: true,
          });
        } else {
          const sideDir = t < 0.5 ? -1 : 1;
          const proximity =
            t < 0.5 ? (t - 0.23) / 0.14 : (0.77 - t) / 0.14;
          const lift = Math.max(0, proximity) * 0.62;
          const brokenPos = healedPos
            .clone()
            .add(new THREE.Vector3(0, lift, ((i % 2) - 0.5) * 0.26 * proximity));
          const brokenRot = new THREE.Euler(
            healedRot.x - sideDir * proximity * 0.42,
            healedRot.y + ((i % 2 === 0 ? 1 : -1) * proximity * 0.28),
            healedRot.z + ((i % 2 === 0 ? -1 : 1) * proximity * 0.34),
          );
          plank.position.copy(brokenPos);
          plank.rotation.copy(brokenRot);
          brokenPlanks.push({
            mesh: plank,
            brokenPos,
            brokenRot,
            healedPos,
            healedRot,
          });
        }
      }

      group.add(plank);
    }

    const railHeight = i === 0 || i === plankCount ? 0.92 : 0.68;
    const lPt = pt.clone().addScaledVector(side, 0.6).add(new THREE.Vector3(0, railHeight, 0));
    const rPt = pt.clone().addScaledVector(side, -0.6).add(new THREE.Vector3(0, railHeight, 0));
    leftRailPts.push(lPt);
    rightRailPts.push(rPt);

    // End posts or periodic vertical hangers (skip center chasm when conflicted)
    const skipHanger = Boolean(conflictMeta && t > 0.34 && t < 0.66);
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
    } else if (i % 4 === 0 && !skipHanger) {
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

  let conflictRiftGroup: THREE.Group | undefined;

  if (conflictMeta) {
    // Split handrails on either side of the fracture + hidden center rail that heals on resolution
    const cutA = Math.max(2, Math.floor(leftRailPts.length * 0.36));
    const cutB = Math.min(leftRailPts.length - 3, Math.ceil(leftRailPts.length * 0.64));
    for (const pts of [leftRailPts, rightRailPts]) {
      const seg1 = new THREE.CatmullRomCurve3(pts.slice(0, cutA + 1));
      const seg2 = new THREE.CatmullRomCurve3(pts.slice(cutB));
      group.add(new THREE.Mesh(new THREE.TubeGeometry(seg1, cutA * 2, 0.032, 5, false), ropeMat));
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(seg2, (pts.length - cutB) * 2, 0.032, 5, false),
          ropeMat,
        ),
      );

      // Center span hidden while broken, restored smoothly on resolution!
      const midSpanPts = pts.slice(Math.max(0, cutA - 1), Math.min(pts.length, cutB + 2));
      if (midSpanPts.length >= 2) {
        const midCurve = new THREE.CatmullRomCurve3(midSpanPts);
        const midRailMesh = new THREE.Mesh(
          new THREE.TubeGeometry(midCurve, 12, 0.032, 5, false),
          ropeMat,
        );
        midRailMesh.scale.setScalar(0.001);
        group.add(midRailMesh);
        brokenPlanks.push({
          mesh: midRailMesh,
          brokenPos: new THREE.Vector3(0, -0.5, 0),
          brokenRot: new THREE.Euler(0, 0, 0),
          healedPos: new THREE.Vector3(0, 0, 0),
          healedRot: new THREE.Euler(0, 0, 0),
          hiddenWhenBroken: true,
        });
      }
    }

    // Glowing Crimson-Amber Lightning Rift & Hazard Barricades in the fractured bridge chasm!
    conflictRiftGroup = new THREE.Group();
    const midPt = curve.getPointAt(0.5);
    conflictRiftGroup.position.copy(midPt);

    const riftCoreMat = new THREE.MeshStandardMaterial({
      color: 0xff453a,
      emissive: 0xef4444,
      emissiveIntensity: 1.55,
      roughness: 0.18,
      flatShading: true,
    });
    const amberBoltMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
    });

    const coreCluster = new THREE.Group();
    coreCluster.position.y = 0.72;
    const mainShard = new THREE.Mesh(new THREE.OctahedronGeometry(0.54, 0), riftCoreMat);
    mainShard.scale.set(0.85, 1.65, 0.85);
    coreCluster.add(mainShard);

    // Orbiting jagged crimson/gold lightning rings & shards
    const ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.045, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0xf97316 }),
    );
    ringMesh.rotation.x = Math.PI / 2.6;
    coreCluster.add(ringMesh);

    const ringMesh2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.76, 0.035, 6, 16),
      amberBoltMat,
    );
    ringMesh2.rotation.y = Math.PI / 3;
    ringMesh2.rotation.x = -Math.PI / 3.2;
    coreCluster.add(ringMesh2);

    // Crossed lightning swords/bolts inside the rift
    for (const sgn of [-1, 1]) {
      const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), amberBoltMat);
      bolt.scale.set(0.45, 3.6, 0.45);
      bolt.rotation.z = sgn * 0.68;
      coreCluster.add(bolt);
    }

    conflictRiftGroup.add(coreCluster);
    conflictRifts?.push(coreCluster);

    // Floating Conflict Warning Plaque above the fractured bridge
    const conflictSignTex = makeSignTexture(
      'MERGE CONFLICT',
      '#ff453a',
      `${conflictMeta.theirsBranch} ⚡ ${conflictMeta.oursBranch}`,
    );
    const conflictPlaque = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.86, 0.1),
      new THREE.MeshBasicMaterial({ map: conflictSignTex }),
    );
    conflictPlaque.position.set(0, 2.35, 0);
    const conflictPlaqueBack = conflictPlaque.clone();
    conflictPlaqueBack.rotation.y = Math.PI;
    conflictRiftGroup.add(conflictPlaque, conflictPlaqueBack);

    group.add(conflictRiftGroup);
  } else {
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
  }

  return {
    group,
    curve,
    conflictRiftGroup,
    brokenPlanks: brokenPlanks.length > 0 ? brokenPlanks : undefined,
  };
}

function addBridgeApproachSpur(
  islandMesh: THREE.Group,
  islandCenter: THREE.Vector3,
  spineCurve: THREE.CatmullRomCurve3,
  anchorWorldX: number,
  edgeWorldZ: number,
  stoneGeo: THREE.BufferGeometry,
  stoneMat: THREE.Material,
): { spinePt: THREE.Vector3; spineT: number } {
  // Find closest point along the island's main cobblestone spine to connect cleanly
  let bestPt = spineCurve.getPointAt(0.5);
  let bestT = 0.5;
  let bestDx = Infinity;
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    const tSample = i / samples;
    const pt = spineCurve.getPointAt(tSample);
    const dx = Math.abs(pt.x - anchorWorldX);
    if (dx < bestDx) {
      bestDx = dx;
      bestPt = pt;
      bestT = tSample;
    }
  }

  const startLocalX = bestPt.x - islandCenter.x;
  const startLocalZ = bestPt.z - islandCenter.z;
  const endLocalX = anchorWorldX - islandCenter.x;
  const endLocalZ = edgeWorldZ - islandCenter.z;

  const dist = Math.hypot(endLocalX - startLocalX, endLocalZ - startLocalZ);
  const steps = Math.max(3, Math.ceil(dist / 0.56));

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const lx = startLocalX + (endLocalX - startLocalX) * t;
    const lz = startLocalZ + (endLocalZ - startLocalZ) * t;
    const st = new THREE.Mesh(stoneGeo, stoneMat);
    st.position.set(lx, 0.024, lz);
    st.scale.set(1.06, 1, 0.92);
    st.rotation.y = s * 0.55;
    st.receiveShadow = true;
    islandMesh.add(st);
  }

  // Hewn stone bridge abutment / threshold pad + twin flanking stone bollards outside walkway
  const thresholdPad = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.09, 0.92),
    stoneMat,
  );
  thresholdPad.position.set(endLocalX, 0.03, endLocalZ);
  thresholdPad.receiveShadow = true;
  islandMesh.add(thresholdPad);

  const bollardGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.42, 6);
  for (const sgn of [-1, 1]) {
    const bollard = new THREE.Mesh(bollardGeo, stoneMat);
    bollard.position.set(endLocalX + sgn * 0.86, 0.23, endLocalZ);
    bollard.castShadow = true;
    islandMesh.add(bollard);
  }

  return { spinePt: bestPt.clone(), spineT: bestT };
}

function buildBridgeTraversalCurve(
  entrySpinePt: THREE.Vector3,
  bridgeCurve: THREE.CatmullRomCurve3,
  exitSpinePt: THREE.Vector3,
): THREE.CatmullRomCurve3 {
  const bStart = bridgeCurve.getPointAt(0);
  const bEnd = bridgeCurve.getPointAt(1);
  const entryMid = entrySpinePt.clone().lerp(bStart, 0.52);
  const exitMid = bEnd.clone().lerp(exitSpinePt, 0.48);
  return new THREE.CatmullRomCurve3([
    entrySpinePt.clone(),
    entryMid,
    ...bridgeCurve.points.map((p) => p.clone()),
    exitMid,
    exitSpinePt.clone(),
  ]);
}

interface PlannedSideBranch {
  branch: BranchIslandData;
  bIdx: number;
  zSide: -1 | 1;
  bLength: number;
  bWidth: number;
  forkRatio: number;
  mergeRatio: number | null;
  isConflictedMerge: boolean;
  centerX: number;
  centerY: number;
  centerZ: number;
  mainForkX: number;
  branchForkX: number;
  mainMergeX: number | null;
  branchMergeX: number | null;
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
    conflictRifts: [],
  };

  const mainBranch = graph.branches.find((b) => b.isDefault) ?? graph.branches[0];
  const sideBranches = graph.branches.filter((b) => b !== mainBranch);
  const activeConflict = graph.mergeConflict?.active ? graph.mergeConflict : undefined;
  const conflictTargetBranch = activeConflict
    ? (sideBranches.find((b) => b.name === activeConflict.theirsBranch)?.name ??
      sideBranches.find((b) => !b.mergeIntoSha)?.name ??
      sideBranches[0]?.name)
    : undefined;

  const mainCommitCount = Math.max(2, mainBranch.commits.length);
  const mainIndexBySha = new Map<string, number>();
  mainBranch.commits.forEach((c, idx) => {
    mainIndexBySha.set(c.sha, idx);
  });

  const commitRatioOnMain = (sha: string | undefined, fallbackRatio: number): number => {
    if (!sha) return fallbackRatio;
    const idx = mainIndexBySha.get(sha);
    if (idx === undefined) return fallbackRatio;
    return mainBranch.commits.length <= 1
      ? 0.5
      : 0.08 + (idx / (mainBranch.commits.length - 1)) * 0.8;
  };

  // Pre-plan North (zSide = -1) and South (zSide = +1) branch corridors so ZERO bridges or islands can overlap!
  const rawSidePlans: PlannedSideBranch[] = sideBranches.map((branch, bIdx) => {
    const cCount = Math.max(2, branch.commits.length);
    const bLength = Math.max(10.2, cCount * 2.65 + 4.8);
    const bWidth = 6.4;
    const isConflictedMerge = Boolean(activeConflict && branch.name === conflictTargetBranch);
    // Keep conflicted merge island on +Z (front camera side) when it is the sole side branch so the cracked bridge shines front-and-center!
    const zSide: -1 | 1 =
      isConflictedMerge && sideBranches.length === 1 ? 1 : bIdx % 2 === 0 ? -1 : 1;
    const fallbackRatio =
      0.16 + ((bIdx + 0.5) / Math.max(1, sideBranches.length)) * 0.62;
    const forkRatio = commitRatioOnMain(branch.forkFromSha, fallbackRatio);
    const mergeIdx = branch.mergeIntoSha ? mainIndexBySha.get(branch.mergeIntoSha) : undefined;
    const mergeRatio = isConflictedMerge
      ? Math.max(forkRatio + 0.16, 0.88)
      : mergeIdx !== undefined
        ? Math.max(forkRatio + 0.14, commitRatioOnMain(branch.mergeIntoSha, forkRatio + 0.2))
        : null;

    return {
      branch,
      bIdx,
      zSide,
      bLength,
      bWidth,
      forkRatio,
      mergeRatio,
      isConflictedMerge,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      mainForkX: 0,
      branchForkX: 0,
      mainMergeX: null,
      branchMergeX: null,
    };
  });

  const northPlans = rawSidePlans
    .filter((p) => p.zSide === -1)
    .toSorted((a, b) => a.forkRatio - b.forkRatio);
  const southPlans = rawSidePlans
    .filter((p) => p.zSide === 1)
    .toSorted((a, b) => a.forkRatio - b.forkRatio);

  const ISLAND_GAP_X = 4.8;
  const computeSideSpan = (plans: PlannedSideBranch[]): number =>
    plans.reduce((sum, p) => sum + p.bLength, 0) +
    Math.max(0, plans.length - 1) * ISLAND_GAP_X;

  const mainWidth = 9.6;
  const mainLength = Math.max(
    24,
    mainCommitCount * 2.6 + 8,
    computeSideSpan(northPlans) + 9,
    computeSideSpan(southPlans) + 9,
  );
  const mainCenter = new THREE.Vector3(0, 0, 0);

  // Assign strictly disjoint horizontal island slots + strictly monotonic bridge anchors per side
  for (const sideGroup of [northPlans, southPlans]) {
    if (sideGroup.length === 0) continue;

    // 1. Place islands in chronological order along X with guaranteed ISLAND_GAP_X open sky between them
    const minIslandBound = -mainLength * 0.45;
    const maxIslandBound = mainLength * 0.45;

    sideGroup.forEach((p, idx) => {
      const desiredForkX = -mainLength * 0.38 + p.forkRatio * (mainLength * 0.72);
      const idealCenter = desiredForkX + p.bLength * 0.2;
      const minLeft =
        idx === 0
          ? minIslandBound
          : sideGroup[idx - 1].centerX + sideGroup[idx - 1].bLength * 0.5 + ISLAND_GAP_X;
      p.centerX = Math.max(idealCenter, minLeft + p.bLength * 0.5);
      p.centerY = (p.zSide === -1 ? 2.25 : 1.7) + (idx % 2) * 0.55;
      p.centerZ = p.zSide * (mainWidth * 0.5 + p.bWidth * 0.5 + 6.4 + (idx % 2) * 0.9);
    });

    // Right-to-left pass so rightmost island stays framed alongside mainLength
    const last = sideGroup[sideGroup.length - 1];
    const overflowRight = last.centerX + last.bLength * 0.5 - maxIslandBound;
    if (overflowRight > 0) {
      last.centerX -= overflowRight;
      for (let idx = sideGroup.length - 2; idx >= 0; idx--) {
        const cur = sideGroup[idx];
        const next = sideGroup[idx + 1];
        const maxAllowedRight = next.centerX - next.bLength * 0.5 - ISLAND_GAP_X;
        if (cur.centerX + cur.bLength * 0.5 > maxAllowedRight) {
          cur.centerX = maxAllowedRight - cur.bLength * 0.5;
        }
      }
    }

    // 2. Compute strictly monotonic bridge anchor X coordinates on BOTH branch islands and main island!
    const anchors: Array<{
      plan: PlannedSideBranch;
      kind: 'fork' | 'merge';
      desiredMainX: number;
      branchX: number;
      mainX: number;
    }> = [];

    for (const p of sideGroup) {
      const desiredForkMainX = -mainLength * 0.38 + p.forkRatio * (mainLength * 0.72);
      if (p.mergeRatio !== null) {
        p.branchForkX = p.centerX - p.bLength * 0.32;
        p.branchMergeX = p.centerX + p.bLength * 0.32;
        anchors.push({
          plan: p,
          kind: 'fork',
          desiredMainX: desiredForkMainX * 0.45 + p.branchForkX * 0.55,
          branchX: p.branchForkX,
          mainX: 0,
        });
        const desiredMergeMainX = -mainLength * 0.38 + p.mergeRatio * (mainLength * 0.72);
        anchors.push({
          plan: p,
          kind: 'merge',
          desiredMainX: desiredMergeMainX * 0.45 + p.branchMergeX * 0.55,
          branchX: p.branchMergeX,
          mainX: 0,
        });
      } else {
        p.branchForkX = p.centerX - p.bLength * 0.24;
        p.branchMergeX = null;
        anchors.push({
          plan: p,
          kind: 'fork',
          desiredMainX: desiredForkMainX * 0.45 + p.branchForkX * 0.55,
          branchX: p.branchForkX,
          mainX: 0,
        });
      }
    }

    const MIN_MAIN_ANCHOR_GAP = 4.6;
    const minMainX = -mainLength * 0.38;
    const maxMainX = mainLength * 0.36; // keep eastern tip clear for HEAD beacon

    anchors.forEach((a, idx) => {
      const floorX = idx === 0 ? minMainX : anchors[idx - 1].mainX + MIN_MAIN_ANCHOR_GAP;
      a.mainX = Math.max(floorX, Math.min(maxMainX, a.desiredMainX));
    });

    for (let idx = anchors.length - 1; idx >= 0; idx--) {
      const ceilX = idx === anchors.length - 1 ? maxMainX : anchors[idx + 1].mainX - MIN_MAIN_ANCHOR_GAP;
      if (anchors[idx].mainX > ceilX) {
        anchors[idx].mainX = ceilX;
      }
    }

    for (const a of anchors) {
      if (a.kind === 'fork') a.plan.mainForkX = a.mainX;
      else a.plan.mainMergeX = a.mainX;
    }
  }

  // Collect all main-island bridge landing corridors so props & trees NEVER block bridge entrances/exits
  const mainBridgeCorridors: Array<{ x: number; zSide: -1 | 1 }> = [];
  for (const p of [...northPlans, ...southPlans]) {
    mainBridgeCorridors.push({ x: p.mainForkX, zSide: p.zSide });
    if (p.mainMergeX !== null) {
      mainBridgeCorridors.push({ x: p.mainMergeX, zSide: p.zSide });
    }
  }

  const isMainSpotBlockedByBridge = (x: number, zSide: -1 | 1, clearance = 2.85): boolean =>
    mainBridgeCorridors.some((c) => c.zSide === zSide && Math.abs(c.x - x) < clearance);

  // 1. Build Main Island along X axis
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
    const z = Math.sin(t * Math.PI * 2.5) * 0.95;
    mainPathPts.push(new THREE.Vector3(x, 0.02, z));
  }
  const mainCurve = new THREE.CatmullRomCurve3(mainPathPts);

  // Stepping stones along main spine path
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

  // Main island signpost (placed at western tip away from any bridge landing)
  const signSide: -1 | 1 = isMainSpotBlockedByBridge(-mainLength * 0.43, -1, 3.0) ? 1 : -1;
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
  mainSignGroup.position.set(-mainLength * 0.43, 0, signSide * 2.65);
  mainSignGroup.rotation.y = signSide === -1 ? 0.35 : -0.35;
  mainMesh.add(mainSignGroup);

  // HEAD Crystal Beacon at the newest end of Main Island
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

  // Place Windmill & Cottages on Main Island strictly outside all bridge entrance/exit corridors!
  const placedMainBuildings: Array<{ x: number; zSide: -1 | 1 }> = [
    { x: -mainLength * 0.43, zSide: signSide },
  ];

  const pickClearMainSpot = (
    preferredX: number,
    preferredSide: -1 | 1,
    clearance = 3.05,
  ): { x: number; zSide: -1 | 1 } | null => {
    const offsets = [0, 2.2, -2.2, 4.4, -4.4, 6.6, -6.6, 8.8, -8.8];
    for (const zSide of [preferredSide, (preferredSide * -1) as -1 | 1]) {
      for (const dx of offsets) {
        const candX = preferredX + dx;
        if (candX < -mainLength * 0.37 || candX > mainLength * 0.34) continue;
        if (isMainSpotBlockedByBridge(candX, zSide, clearance)) continue;
        if (placedMainBuildings.some((b) => b.zSide === zSide && Math.abs(b.x - candX) < 3.8)) {
          continue;
        }
        placedMainBuildings.push({ x: candX, zSide });
        return { x: candX, zSide };
      }
    }
    return null;
  };

  const millSpot = pickClearMainSpot(1.5, -1, 3.2);
  if (millSpot) {
    addWindmill(mainMesh, millSpot.x, millSpot.zSide * 2.85, animatedProps.windmillBlades);
  }
  const cot1Spot = pickClearMainSpot(-mainLength * 0.2, -1, 3.0);
  if (cot1Spot) {
    addCottage(
      mainMesh,
      cot1Spot.x,
      cot1Spot.zSide * 2.8,
      cot1Spot.zSide === -1 ? 0.2 : Math.PI - 0.2,
      mainBranch.color,
      animatedProps.windowGlows,
    );
  }
  const cot2Spot = pickClearMainSpot(mainLength * 0.2, 1, 3.0);
  if (cot2Spot) {
    addCottage(
      mainMesh,
      cot2Spot.x,
      cot2Spot.zSide * 2.8,
      cot2Spot.zSide === 1 ? Math.PI - 0.25 : 0.25,
      '#fbbf24',
      animatedProps.windowGlows,
    );
  }

  const treeSlots = Math.max(6, Math.floor(mainLength / 3.4));
  for (let i = 0; i < treeSlots; i++) {
    const tx = -mainLength * 0.4 + (i / Math.max(1, treeSlots - 1)) * (mainLength * 0.76);
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    if (isMainSpotBlockedByBridge(tx, side, 2.5)) continue;
    if (placedMainBuildings.some((b) => b.zSide === side && Math.abs(b.x - tx) < 2.7)) continue;
    addTree(mainMesh, tx, side * (2.85 + (i % 3) * 0.4), i * 17 + 3, mainBranch.color);
    if (i % 2 === 0 && !isMainSpotBlockedByBridge(tx + 0.6, side, 2.3)) {
      addLanternPost(mainMesh, tx + 0.6, side * 1.75, animatedProps.lanternGlows);
    }
  }

  islands.push({
    branch: mainBranch,
    meshGroup: mainMesh,
    center: mainCenter,
    length: mainLength,
    width: mainWidth,
    pathCurve: mainCurve,
    commitWaypoints: mainWaypoints,
    signMesh: signBoard,
  });

  // 2. Build Floating Feature / Topic Branch Islands + Non-Overlapping Bridges + Paved Entrance/Exit Spurs!
  const orderedPlans = rawSidePlans.toSorted((a, b) => a.bIdx - b.bIdx);

  for (const plan of orderedPlans) {
    const { branch, bIdx, zSide, bLength, bWidth } = plan;
    const bCenter = new THREE.Vector3(plan.centerX, plan.centerY, plan.centerZ);

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
      const lz = Math.sin(t * Math.PI * 1.5) * 0.48;
      bPathPts.push(new THREE.Vector3(bCenter.x + lx, bCenter.y + 0.02, bCenter.z + lz));
    }
    const bCurve = new THREE.CatmullRomCurve3(bPathPts);

    // Stepping stones along branch spine
    const bStones = Math.floor(bLength * 1.2);
    for (let s = 0; s <= bStones; s++) {
      const pt = bCurve.getPointAt(s / bStones);
      const st = new THREE.Mesh(stoneGeo, stoneMat);
      st.position.set(pt.x - bCenter.x, 0.02, pt.z - bCenter.z);
      st.scale.set(0.95, 1, 0.78);
      bMesh.add(st);
    }

    // Place Branch Signpost, Cottage & Trees strictly on the OUTER scenic half (`+zSide`),
    // keeping the entire bridge-facing inner half (`-zSide`) 100% unobstructed!
    const bSign = new THREE.Group();
    const bTex = makeSignTexture(
      branch.name,
      plan.isConflictedMerge ? '#ff453a' : branch.color,
      plan.isConflictedMerge
        ? `${branch.commits.length} commit${branch.commits.length === 1 ? '' : 's'} · ⚡ merge conflict`
        : `${branch.commits.length} commit${branch.commits.length === 1 ? '' : 's'}${branch.mergeIntoSha ? ' · merged' : ' · active'}`,
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
    bSign.position.set(-bLength * 0.27, 0, zSide * 1.85);
    // Always face toward the front (+Z) camera so branch labels are crisp & legible!
    bSign.rotation.y = 0.18;
    bMesh.add(bSign);

    addCottage(
      bMesh,
      bLength * 0.14,
      zSide * 1.75,
      zSide > 0 ? Math.PI : 0,
      branch.color,
      animatedProps.windowGlows,
    );
    addTree(bMesh, -bLength * 0.41, zSide * 1.9, bIdx * 31 + 7, branch.color);
    addTree(bMesh, bLength * 0.37, zSide * 1.85, bIdx * 19 + 4, branch.color);
    addLanternPost(bMesh, -0.3, zSide * 1.25, animatedProps.lanternGlows);

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
      meshGroup: bMesh,
      center: bCenter,
      length: bLength,
      width: bWidth,
      pathCurve: bCurve,
      commitWaypoints: bWaypoints,
      signMesh: bBoard,
    });

    const mainEdgeZ = zSide * (mainWidth * 0.45);
    const branchInnerEdgeZ = bCenter.z - zSide * (bWidth * 0.44);

    // Fork Suspension Bridge (UP: Main -> Branch) + Paved Entrance & Exit Spurs
    const mainEdgeStart = new THREE.Vector3(plan.mainForkX, 0.04, mainEdgeZ);
    const branchEdgeStart = new THREE.Vector3(plan.branchForkX, bCenter.y + 0.04, branchInnerEdgeZ);

    const forkEntrySpur = addBridgeApproachSpur(
      mainMesh,
      mainCenter,
      mainCurve,
      plan.mainForkX,
      mainEdgeZ,
      stoneGeo,
      stoneMat,
    );
    const forkExitSpur = addBridgeApproachSpur(
      bMesh,
      bCenter,
      bCurve,
      plan.branchForkX,
      branchInnerEdgeZ,
      stoneGeo,
      stoneMat,
    );

    const forkBridge = buildSuspensionBridge(
      mainEdgeStart,
      branchEdgeStart,
      animatedProps.lanternGlows,
    );
    worldGroup.add(forkBridge.group);
    bridges.push({
      kind: 'fork',
      fromBranch: mainBranch.name,
      toBranch: branch.name,
      meshGroup: forkBridge.group,
      curve: forkBridge.curve,
      traversalCurve: buildBridgeTraversalCurve(
        forkEntrySpur.spinePt,
        forkBridge.curve,
        forkExitSpur.spinePt,
      ),
      entryPathT: forkEntrySpur.spineT,
      exitPathT: forkExitSpur.spineT,
    });

    // Merge Return Suspension Bridge (DOWN: Branch -> Main) + Paved Entrance & Exit Spurs
    if (plan.mainMergeX !== null && plan.branchMergeX !== null) {
      const branchEdgeEnd = new THREE.Vector3(
        plan.branchMergeX,
        bCenter.y + 0.04,
        branchInnerEdgeZ,
      );
      const mainEdgeEnd = new THREE.Vector3(plan.mainMergeX, 0.04, mainEdgeZ);

      const mergeEntrySpur = addBridgeApproachSpur(
        bMesh,
        bCenter,
        bCurve,
        plan.branchMergeX,
        branchInnerEdgeZ,
        stoneGeo,
        stoneMat,
      );
      const mergeExitSpur = addBridgeApproachSpur(
        mainMesh,
        mainCenter,
        mainCurve,
        plan.mainMergeX,
        mainEdgeZ,
        stoneGeo,
        stoneMat,
      );

      const mergeBridge = buildSuspensionBridge(
        branchEdgeEnd,
        mainEdgeEnd,
        animatedProps.lanternGlows,
        plan.isConflictedMerge
          ? {
              oursBranch: activeConflict?.oursBranch ?? mainBranch.name,
              theirsBranch: activeConflict?.theirsBranch ?? branch.name,
            }
          : undefined,
        animatedProps.conflictRifts,
      );
      worldGroup.add(mergeBridge.group);
      bridges.push({
        kind: 'merge',
        fromBranch: branch.name,
        toBranch: mainBranch.name,
        meshGroup: mergeBridge.group,
        curve: mergeBridge.curve,
        traversalCurve: buildBridgeTraversalCurve(
          mergeEntrySpur.spinePt,
          mergeBridge.curve,
          mergeExitSpur.spinePt,
        ),
        entryPathT: mergeEntrySpur.spineT,
        exitPathT: mergeExitSpur.spineT,
        isConflicted: plan.isConflictedMerge,
        conflictRiftGroup: mergeBridge.conflictRiftGroup,
        brokenPlanks: mergeBridge.brokenPlanks,
      });
    }
  }

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

  // 4b. CI Weather Storm System (Dark Thundercloud over HEAD + Falling Rain Streaks!)
  const stormGroup = new THREE.Group();
  stormGroup.visible = false;

  const headX = mainLength * 0.4;
  const stormCloudMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0x0f172a,
    emissiveIntensity: 0.35,
    roughness: 0.92,
    flatShading: true,
  });
  const headThunderCloud = new THREE.Group();
  const stormPuffs: Array<[number, number, number, number]> = [
    [0, 0, 0, 2.1],
    [-1.8, -0.25, 0.35, 1.55],
    [1.75, -0.2, -0.25, 1.65],
    [-0.75, 0.55, -0.4, 1.45],
    [0.85, 0.48, 0.35, 1.5],
  ];
  for (const [px, py, pz, pr] of stormPuffs) {
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(pr, 0), stormCloudMat);
    puff.position.set(px, py, pz);
    puff.scale.set(1.25, 0.68, 1.05);
    headThunderCloud.add(puff);
  }
  headThunderCloud.position.set(headX, 6.8, 0);
  stormGroup.add(headThunderCloud);

  // Jagged glowing lightning bolt beneath HEAD thundercloud (flashes intermittently)
  const boltShape = new THREE.Shape();
  boltShape.moveTo(0.15, 0);
  boltShape.lineTo(-0.38, -1.65);
  boltShape.lineTo(0.08, -1.65);
  boltShape.lineTo(-0.28, -3.4);
  boltShape.lineTo(0.48, -1.45);
  boltShape.lineTo(0.02, -1.45);
  boltShape.closePath();
  const lightningBolt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(boltShape, { depth: 0.12, bevelEnabled: false }),
    new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0,
    }),
  );
  lightningBolt.position.set(headX, 5.8, 0);
  stormGroup.add(lightningBolt);

  // Slanted 3D rain streaks across the entire village
  const rainCount = 340;
  const rainVerts = new Float32Array(rainCount * 6);
  const rainSpanX = mainLength + 28;
  for (let i = 0; i < rainCount; i++) {
    const rx = (Math.random() - 0.5) * rainSpanX;
    const ry = Math.random() * 20 - 2;
    const rz = (Math.random() - 0.5) * 42;
    const base = i * 6;
    rainVerts[base] = rx;
    rainVerts[base + 1] = ry;
    rainVerts[base + 2] = rz;
    rainVerts[base + 3] = rx - 0.22;
    rainVerts[base + 4] = ry - 1.15;
    rainVerts[base + 5] = rz;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainVerts, 3));
  const rainLines = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.52,
    }),
  );
  stormGroup.add(rainLines);
  worldGroup.add(stormGroup);

  animatedProps.stormGroup = stormGroup;
  animatedProps.rainLines = rainLines;
  animatedProps.lightningBolt = lightningBolt;

  // 5. If this is a Local Repo (or has active Gate Visitors / Merge Conflict), build the Working-Tree Village Gate & Sky-Dock Arrival Pier!
  let gate: GateLayout | undefined;
  if (graph.isLocal || (graph.gateVisitors?.length ?? 0) > 0 || Boolean(activeConflict)) {
    const visitorCount = graph.gateVisitors?.length ?? 0;
    const isGateConflicted = Boolean(activeConflict);
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
        color: isGateConflicted ? 0xfca5a5 : 0xfef08a,
        emissive: isGateConflicted ? 0xef4444 : visitorCount > 0 ? 0xf97316 : 0x10b981,
        emissiveIntensity: isGateConflicted ? 1.55 : 1.1,
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
      color: isGateConflicted ? 0xb91c1c : visitorCount > 0 ? 0xd97706 : 0x059669,
      roughness: 0.72,
      flatShading: true,
    });
    animatedProps.gateRoofMat = roofMat;
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
      isGateConflicted
        ? `CONFLICT AT GATE · ${activeConflict?.conflictedCount ?? visitorCount}`
        : visitorCount > 0
          ? `VILLAGE GATE · ${visitorCount}`
          : 'VILLAGE GATE · OPEN',
      isGateConflicted ? '#ff453a' : visitorCount > 0 ? '#fbbf24' : '#34d399',
      isGateConflicted
        ? `${activeConflict?.oursBranch} ⚡ ${activeConflict?.theirsBranch} — resolve conflicts!`
        : visitorCount > 0
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

    // Glowing Crimson Crossed-Beam Energy Barricade across closed Gate Doors during Merge Conflicts!
    if (isGateConflicted) {
      const barrierGroup = new THREE.Group();
      barrierGroup.position.set(archX + 0.26, 1.15, 0);
      const barrierMat = new THREE.MeshStandardMaterial({
        color: 0xff453a,
        emissive: 0xef4444,
        emissiveIntensity: 1.35,
        roughness: 0.25,
      });
      for (const sgn of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 3.3), barrierMat);
        bar.rotation.x = sgn * 0.42;
        barrierGroup.add(bar);
      }
      const seal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), barrierMat);
      barrierGroup.add(seal);
      gateGroup.add(barrierGroup);
      animatedProps.conflictGateBarrier = barrierGroup;
    }

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
