import * as THREE from 'three';
import { THEME } from '../config';
import { isLightSquare, squareName, squareToWorld, SQUARE_SIZE } from './coords';
import type { Color } from '../types';

const SQUARE_HEIGHT = 0.14;

function makeSquareMaterial(color: number, dark: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: dark ? 0.35 : 0.5,
    metalness: dark ? 0.25 : 0.05,
    emissive: dark ? new THREE.Color(THEME.obsidian.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: dark ? 0.05 : 0,
  });
}

function buildSquares(group: THREE.Group): void {
  const geometry = new THREE.BoxGeometry(SQUARE_SIZE * 0.985, SQUARE_HEIGHT, SQUARE_SIZE * 0.985);
  const lightMat = makeSquareMaterial(THEME.boardLight, false);
  const darkMat = makeSquareMaterial(THEME.boardDark, true);

  let lightCount = 0;
  let darkCount = 0;
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      if (isLightSquare(f, r)) lightCount++;
      else darkCount++;
    }
  }

  const lightMesh = new THREE.InstancedMesh(geometry, lightMat, lightCount);
  const darkMesh = new THREE.InstancedMesh(geometry, darkMat, darkCount);
  lightMesh.receiveShadow = true;
  darkMesh.receiveShadow = true;

  let li = 0;
  let di = 0;
  const m = new THREE.Matrix4();
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const { x, z } = squareToWorld(squareName(f, r));
      m.makeTranslation(x, -SQUARE_HEIGHT / 2, z);
      if (isLightSquare(f, r)) lightMesh.setMatrixAt(li++, m);
      else darkMesh.setMatrixAt(di++, m);
    }
  }
  lightMesh.instanceMatrix.needsUpdate = true;
  darkMesh.instanceMatrix.needsUpdate = true;
  group.add(lightMesh, darkMesh);
}

function buildPlinth(group: THREE.Group): void {
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(9.2, 0.42, 9.2),
    new THREE.MeshPhysicalMaterial({
      color: 0x0c0e1a,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.55,
      thickness: 1.2,
      ior: 1.4,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
    }),
  );
  glass.position.y = -SQUARE_HEIGHT - 0.21;
  glass.receiveShadow = true;
  group.add(glass);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xd8b46a,
    metalness: 0.85,
    roughness: 0.3,
    emissive: new THREE.Color(0x3a2a08),
    emissiveIntensity: 0.4,
  });
  const frameThickness = 0.12;
  const frameHeight = 0.16;
  const frameLen = 9.2;
  const offsets: [number, number, number, number][] = [
    [0, frameLen / 2 - frameThickness / 2, frameLen, frameThickness],
    [0, -frameLen / 2 + frameThickness / 2, frameLen, frameThickness],
    [frameLen / 2 - frameThickness / 2, 0, frameThickness, frameLen],
    [-frameLen / 2 + frameThickness / 2, 0, frameThickness, frameLen],
  ];
  for (const [x, z, w, d] of offsets) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, frameHeight, d), frameMat);
    bar.position.set(x, -SQUARE_HEIGHT / 2 + 0.01, z);
    bar.castShadow = true;
    bar.receiveShadow = true;
    group.add(bar);
  }
}

type GlowMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface MarkerPool {
  root: THREE.Group;
  moveDots: GlowMesh[];
  captureRings: GlowMesh[];
  selection: GlowMesh;
  checkGlow: GlowMesh;
}

function buildMarkers(): MarkerPool {
  const root = new THREE.Group();

  const dotGeo = new THREE.CircleGeometry(0.16, 24);
  const dotMat = new THREE.MeshBasicMaterial({
    color: THEME.moveDot,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const moveDots: GlowMesh[] = [];
  for (let i = 0; i < 28; i++) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.visible = false;
    dot.renderOrder = 5;
    root.add(dot);
    moveDots.push(dot);
  }

  const ringGeo = new THREE.RingGeometry(0.38, 0.47, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: THEME.captureRing,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const captureRings: GlowMesh[] = [];
  for (let i = 0; i < 16; i++) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 5;
    root.add(ring);
    captureRings.push(ring);
  }

  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.52, 32),
    new THREE.MeshBasicMaterial({
      color: THEME.selectGlow,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  selection.renderOrder = 6;
  root.add(selection);

  const checkGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.56, 32),
    new THREE.MeshBasicMaterial({
      color: THEME.checkGlow,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  checkGlow.rotation.x = -Math.PI / 2;
  checkGlow.visible = false;
  checkGlow.renderOrder = 4;
  root.add(checkGlow);

  return { root, moveDots, captureRings, selection, checkGlow };
}

export class Board {
  readonly group = new THREE.Group();
  readonly pieceLayer = new THREE.Group();
  private readonly markers: MarkerPool;
  private readonly plane: THREE.Mesh;
  private pulseT = 0;

  constructor() {
    buildSquares(this.group);
    buildPlinth(this.group);
    this.markers = buildMarkers();
    this.group.add(this.markers.root);
    this.group.add(this.pieceLayer);

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.name = 'board-plane';
    this.group.add(this.plane);
  }

  get pickTarget(): THREE.Mesh {
    return this.plane;
  }

  setOrientation(playerColor: Color): void {
    this.group.rotation.y = playerColor === 'b' ? Math.PI : 0;
  }

  squareFromWorldPoint(worldPoint: THREE.Vector3): string | null {
    const local = this.group.worldToLocal(worldPoint.clone());
    const f = Math.round(local.x / SQUARE_SIZE + 3.5);
    const r = Math.round(3.5 - local.z / SQUARE_SIZE);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return squareName(f, r);
  }

  showSelection(square: string | null): void {
    if (!square) {
      this.markers.selection.visible = false;
      return;
    }
    const { x, z } = squareToWorld(square);
    this.markers.selection.position.set(x, 0.02, z);
    this.markers.selection.visible = true;
  }

  showLegalTargets(quiet: string[], captures: string[]): void {
    this.markers.moveDots.forEach((dot, i) => {
      if (i < quiet.length) {
        const { x, z } = squareToWorld(quiet[i]);
        dot.position.set(x, 0.03, z);
        dot.visible = true;
      } else {
        dot.visible = false;
      }
    });
    this.markers.captureRings.forEach((ring, i) => {
      if (i < captures.length) {
        const { x, z } = squareToWorld(captures[i]);
        ring.position.set(x, 0.03, z);
        ring.visible = true;
      } else {
        ring.visible = false;
      }
    });
  }

  showCheck(square: string | null): void {
    if (!square) {
      this.markers.checkGlow.visible = false;
      return;
    }
    const { x, z } = squareToWorld(square);
    this.markers.checkGlow.position.set(x, 0.015, z);
    this.markers.checkGlow.visible = true;
  }

  update(dt: number): void {
    this.pulseT += dt;
    const pulse = 0.75 + Math.sin(this.pulseT * 3.2) * 0.2;
    this.markers.selection.material.opacity = pulse;
    this.markers.captureRings.forEach((r) => (r.material.opacity = pulse));
    if (this.markers.checkGlow.visible) {
      this.markers.checkGlow.material.opacity = 0.35 + Math.sin(this.pulseT * 5) * 0.25;
    }
  }
}
