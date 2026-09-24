import { BoxGeometry, DirectionalLight, Mesh, MeshStandardNodeMaterial, Scene } from 'three/webgpu';
import { KM } from '../core/units';

/**
 * Scaffolding from SS-3 until SS-6 deletes it: a reference object, so an empty scene can
 * never be mistaken for a broken camera. One directional light and no ambient term, because
 * nothing in this project gets light it did not come by honestly. The light direction gives
 * the three faces visible from the default pose three distinct brightnesses.
 */
export function createCubeScene(): Scene {
  const scene = new Scene();
  const cube = new Mesh(
    new BoxGeometry(1 * KM, 1 * KM, 1 * KM),
    new MeshStandardNodeMaterial({ color: 0xb0b0b0, roughness: 1, metalness: 0 }),
  );
  scene.add(cube);

  const sun = new DirectionalLight(0xffffff, 2.5);
  sun.position.set(3, 5, 4); // Direction only; the target is the origin.
  scene.add(sun);
  return scene;
}
