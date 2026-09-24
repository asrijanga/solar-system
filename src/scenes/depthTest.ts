import { Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import { DEPTH_TEST_BACK, DEPTH_TEST_FRONT } from '../capture/viewpoints';
import { KM } from '../core/units';

function quad(size: number, [r, g, b]: readonly number[]): Mesh {
  // Unlit, so the colour on screen depends on which quad won the depth test and nothing else.
  const material = new MeshBasicNodeMaterial({ color: new Color(`rgb(${r}, ${g}, ${b})`) });
  return new Mesh(new PlaneGeometry(size, size), material);
}

/**
 * Two face-on quads, the front one `separation` km nearer the camera (see the depth-*
 * viewpoints, seen from 10,000 km).
 *
 * Designed so that depth-buffer precision is the only thing deciding the result:
 * - Face-on, so every fragment of a quad has the same depth. Tilted quads thousands of km
 *   across add float32 rounding in depth interpolation, which is a different effect and made
 *   an earlier tilted version of this test unreadable (docs/stories/SS-3.md).
 * - The front quad draws first. Depth compares pass on equality (greater-equal when
 *   reversed), so a true tie goes to the back quad, drawn later. The front quad therefore wins
 *   only where the depth buffer resolves it as strictly nearer; depth-tie proves the tie rule.
 */
export function createDepthTestScene(separation: number): Scene {
  const scene = new Scene();
  const back = quad(5_000 * KM, DEPTH_TEST_BACK);
  const front = quad(3_000 * KM, DEPTH_TEST_FRONT);
  front.position.z = separation;
  front.renderOrder = 0;
  back.renderOrder = 1;
  scene.add(back, front);
  return scene;
}
