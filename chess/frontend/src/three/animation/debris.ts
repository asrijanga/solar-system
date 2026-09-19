import * as THREE from 'three';
import { Easing, tween } from './tween';

export interface DebrisOptions {
  count: number;
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  spread: number;
  riseHeight: number;
  fallHeight: number;
  size: number;
  durationMs: number;
  additive?: boolean;
}

/** Spawns small fragments at `origin` that fly outward and fade — reused with
 * different parameters to give bishop shatters, rook rubble and queen bursts each
 * their own character without duplicating the particle plumbing. */
export function burstDebris(scene: THREE.Scene, origin: THREE.Vector3, opts: DebrisOptions): Promise<void> {
  const group = new THREE.Group();
  group.position.copy(origin);
  scene.add(group);

  const geometry = new THREE.IcosahedronGeometry(opts.size, 0);
  const meshes: { mesh: THREE.Mesh; dir: THREE.Vector3; spin: THREE.Vector3 }[] = [];

  for (let i = 0; i < opts.count; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: opts.color,
      emissive: opts.emissive ?? opts.color,
      emissiveIntensity: opts.additive ? 1.4 : 0.3,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 1,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const angle = Math.random() * Math.PI * 2;
    const radial = 0.3 + Math.random() * 0.7;
    mesh.position.set(0, opts.size, 0);
    mesh.scale.setScalar(0.5 + Math.random() * 0.8);
    group.add(mesh);
    meshes.push({
      mesh,
      dir: new THREE.Vector3(Math.cos(angle) * radial, 0, Math.sin(angle) * radial),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3),
    });
  }

  return tween(opts.durationMs, (t) => {
    const rise = Math.sin(Math.min(t, 0.5) * Math.PI) * opts.riseHeight;
    const fall = t > 0.5 ? Math.pow((t - 0.5) * 2, 2) * opts.fallHeight : 0;
    for (const { mesh, dir, spin } of meshes) {
      mesh.position.set(
        dir.x * opts.spread * t,
        opts.size + rise - fall,
        dir.z * opts.spread * t,
      );
      mesh.rotation.x += spin.x;
      mesh.rotation.y += spin.y;
      mesh.rotation.z += spin.z;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 1 - Easing.easeInQuad(t);
    }
  }, Easing.linear).then(() => {
    scene.remove(group);
    geometry.dispose();
    for (const { mesh } of meshes) (mesh.material as THREE.Material).dispose();
  });
}
