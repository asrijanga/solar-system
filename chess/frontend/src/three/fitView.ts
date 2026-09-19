import * as THREE from 'three';

/** Half-extents of the board scene that must stay on screen: the plinth footprint
 * plus headroom for the tallest pieces (king/queen crown) and hover markers. */
const SCENE_HALF_X = 4.85;
const SCENE_HALF_Z = 4.85;
const SCENE_MAX_Y = 1.55;

function boundingCorners(target: THREE.Vector3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0, SCENE_MAX_Y]) {
        corners.push(
          new THREE.Vector3(target.x + sx * SCENE_HALF_X, y, target.z + sz * SCENE_HALF_Z),
        );
      }
    }
  }
  return corners;
}

/**
 * Finds the smallest camera distance (along a fixed viewing direction) at which the
 * whole board bounding box stays within the frustum, for the camera's *current*
 * aspect ratio. Keeps the bird's-eye framing tight and consistent across any screen
 * shape, from a narrow phone to a wide desktop monitor.
 */
export function fitDistance(
  camera: THREE.PerspectiveCamera,
  direction: THREE.Vector3,
  target: THREE.Vector3,
  margin = 0.9,
): number {
  const corners = boundingCorners(target);
  const savedPosition = camera.position.clone();
  const savedQuaternion = camera.quaternion.clone();

  let lo = 1;
  let hi = 60;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    camera.position.copy(target).addScaledVector(direction, mid);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    let fits = true;
    for (const corner of corners) {
      const ndc = corner.clone().project(camera);
      if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin || ndc.z > 1 || ndc.z < -1) {
        fits = false;
        break;
      }
    }
    if (fits) hi = mid;
    else lo = mid;
  }

  camera.position.copy(savedPosition);
  camera.quaternion.copy(savedQuaternion);
  return hi;
}
