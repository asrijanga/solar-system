import * as THREE from 'three';
import type { Color, PieceType } from '../../types';
import { Easing, tween } from './tween';
import { burstDebris } from './debris';
import { THEME } from '../../config';

type DeathFn = (scene: THREE.Scene, piece: THREE.Group, color: Color) => Promise<void>;

function pieceGlow(color: Color): number {
  return color === 'w' ? THEME.aurora.accent : THEME.obsidian.accent;
}

function pieceBase(color: Color): number {
  return color === 'w' ? THEME.aurora.base : THEME.obsidian.base;
}

function fadeMaterial(piece: THREE.Group, t: number): void {
  const material = piece.userData.material as THREE.MeshPhysicalMaterial | undefined;
  if (material) material.opacity = 1 - t;
}

/** Pawn: the lightest piece simply sinks into the board and dissolves — quick and quiet. */
const sinkAndFade: DeathFn = async (scene, piece, color) => {
  const origin = piece.position.clone();
  origin.y += 0.3;
  void burstDebris(scene, origin, {
    count: 6,
    color: pieceBase(color),
    spread: 0.4,
    riseHeight: 0.12,
    fallHeight: 0.3,
    size: 0.045,
    durationMs: 380,
  });
  await tween(420, (t) => {
    const e = Easing.easeInQuad(t);
    piece.position.y = -e * 0.55;
    piece.scale.setScalar(1 - e * 0.85);
    fadeMaterial(piece, e);
  });
};

/** Knight: rears back on its haunches, then topples sideways off the square. */
const rearAndTopple: DeathFn = async (scene, piece) => {
  await tween(180, (t) => {
    piece.rotation.x = -Easing.easeOutQuad(t) * 0.35;
  });
  const fallSign = Math.random() > 0.5 ? 1 : -1;
  await tween(520, (t) => {
    const e = Easing.easeInCubic(t);
    piece.rotation.x = -0.35 + e * 0.35;
    piece.rotation.z = fallSign * e * 1.4;
    piece.position.x += 0; // keep footprint; slide handled via z offset below
    piece.position.y = -e * 0.35;
    fadeMaterial(piece, Math.max(0, t - 0.35) / 0.65);
  }, Easing.linear);
};

/** Bishop: shatters into angular shards that radiate outward — no sinking, a clean break. */
const shatterShards: DeathFn = async (scene, piece, color) => {
  const origin = piece.position.clone();
  origin.y += 0.5;
  const burst = burstDebris(scene, origin, {
    count: 14,
    color: pieceBase(color),
    emissive: pieceGlow(color),
    spread: 0.95,
    riseHeight: 0.3,
    fallHeight: 0.9,
    size: 0.075,
    durationMs: 620,
  });
  const shrink = tween(320, (t) => {
    const e = Easing.easeInCubic(t);
    piece.scale.setScalar(1 - e);
    fadeMaterial(piece, e);
  });
  await Promise.all([burst, shrink]);
};

/** Rook: the heaviest piece — crumbles into rubble and sinks straight down like a collapsing tower. */
const crumbleAndSink: DeathFn = async (scene, piece, color) => {
  const origin = piece.position.clone();
  origin.y += 0.2;
  const rubble = burstDebris(scene, origin, {
    count: 8,
    color: pieceBase(color),
    spread: 0.5,
    riseHeight: 0.15,
    fallHeight: 1.1,
    size: 0.11,
    durationMs: 700,
  });
  const sink = tween(700, (t) => {
    const e = Easing.easeInCubic(t);
    piece.position.y = -e * 0.9;
    piece.rotation.y += 0.03;
    piece.scale.y = 1 - e * 0.4;
    fadeMaterial(piece, Math.max(0, t - 0.3) / 0.7);
  });
  await Promise.all([rubble, sink]);
};

/** Queen: the most dramatic capture — a bright particle explosion, gone in a flash. */
const explodeParticles: DeathFn = async (scene, piece, color) => {
  const origin = piece.position.clone();
  origin.y += 0.6;
  const burst = burstDebris(scene, origin, {
    count: 24,
    color: pieceGlow(color),
    emissive: pieceGlow(color),
    spread: 1.3,
    riseHeight: 0.5,
    fallHeight: 0.4,
    size: 0.05,
    durationMs: 680,
    additive: true,
  });
  const flash = tween(680, (t) => {
    const e = Easing.easeOutQuad(t);
    const pulse = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    piece.scale.setScalar(1 + pulse * 0.25 - e * 0.3);
    const material = piece.userData.material as THREE.MeshPhysicalMaterial | undefined;
    if (material) {
      material.emissiveIntensity = 0.1 + pulse * 2.2;
      material.opacity = 1 - Easing.easeInQuad(t);
    }
  });
  await Promise.all([burst, flash]);
};

/** King: only reachable in edge-case rule sets, since real chess ends at checkmate —
 * but implemented anyway: a slow, solemn topple with a flash of light. */
const solemnTopple: DeathFn = async (scene, piece, color) => {
  const flashGeo = new THREE.SphereGeometry(0.9, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({
    color: pieceGlow(color),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(piece.position);
  flash.position.y += 0.6;
  scene.add(flash);
  const flashTween = tween(500, (t) => {
    flash.scale.setScalar(0.3 + t * 1.8);
    flashMat.opacity = 0.55 * (1 - t);
  }).then(() => {
    scene.remove(flash);
    flashGeo.dispose();
    flashMat.dispose();
  });

  const fallSign = Math.random() > 0.5 ? 1 : -1;
  const topple = tween(900, (t) => {
    const e = Easing.easeInBack(t);
    piece.rotation.z = fallSign * Math.min(e, 1) * 1.55;
    piece.position.y = -Math.min(e, 1) * 0.2;
    fadeMaterial(piece, Math.max(0, t - 0.55) / 0.45);
  }, Easing.linear);

  await Promise.all([flashTween, topple]);
};

const DEATHS: Record<PieceType, DeathFn> = {
  p: sinkAndFade,
  n: rearAndTopple,
  b: shatterShards,
  r: crumbleAndSink,
  q: explodeParticles,
  k: solemnTopple,
};

export function playDefenderDeath(
  scene: THREE.Scene,
  piece: THREE.Group,
  type: PieceType,
  color: Color,
): Promise<void> {
  return DEATHS[type](scene, piece, color);
}
