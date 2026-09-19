import * as THREE from 'three';
import { IS_SMALL_SCREEN } from '../config';
import { THEME } from '../config';

export function addLighting(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(THEME.skyTop, THEME.groundColor, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff6e3, 2.6);
  sun.position.set(-6, 13, 6);
  sun.castShadow = !IS_SMALL_SCREEN;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 26;
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    sun.shadow.bias = -0.0015;
    sun.shadow.radius = 2.5;
  }
  scene.add(sun);

  const skyFill = new THREE.DirectionalLight(0xcfe6ff, 0.55);
  skyFill.position.set(5, 6, -6);
  scene.add(skyFill);

  // A whisper of each army's own colour on its own side, just enough to give the
  // gems an inner glow without fighting the daylight.
  const auroraFill = new THREE.PointLight(0xf3cd85, 1.1, 10, 2);
  auroraFill.position.set(0, 2, 5.2);
  scene.add(auroraFill);

  const obsidianFill = new THREE.PointLight(0xac8bff, 1.1, 10, 2);
  obsidianFill.position.set(0, 2, -5.2);
  scene.add(obsidianFill);
}
