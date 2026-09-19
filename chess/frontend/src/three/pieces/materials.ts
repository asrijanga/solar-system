import * as THREE from 'three';
import { THEME } from '../../config';
import type { Color } from '../../types';

const templates = new Map<Color, THREE.MeshPhysicalMaterial>();

function template(color: Color): THREE.MeshPhysicalMaterial {
  const cached = templates.get(color);
  if (cached) return cached;

  const palette = color === 'w' ? THEME.aurora : THEME.obsidian;
  const material = new THREE.MeshPhysicalMaterial({
    color: palette.base,
    emissive: new THREE.Color(palette.emissive),
    emissiveIntensity: color === 'w' ? 0.08 : 0.1,
    roughness: color === 'w' ? 0.45 : 0.32,
    metalness: color === 'w' ? 0.08 : 0.18,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    flatShading: true,
  });
  templates.set(color, material);
  return material;
}

/** Every piece gets its own material instance (a clone) so capture animations can
 * mutate opacity/emissive per-piece without affecting the rest of that color's army. */
export function pieceMaterial(color: Color): THREE.MeshPhysicalMaterial {
  const material = template(color).clone();
  material.transparent = true;
  return material;
}

export function accentMaterial(color: Color): THREE.MeshBasicMaterial {
  const palette = color === 'w' ? THEME.aurora : THEME.obsidian;
  return new THREE.MeshBasicMaterial({ color: palette.accent });
}
