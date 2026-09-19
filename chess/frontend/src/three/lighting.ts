import * as THREE from 'three';
import { IS_SMALL_SCREEN } from '../config';

export function addLighting(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0x453a6b, 0x07060c, 0.38);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xf4efe0, 1.9);
  moon.position.set(-6, 12, 5);
  moon.castShadow = !IS_SMALL_SCREEN;
  if (moon.castShadow) {
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 4;
    moon.shadow.camera.far = 26;
    moon.shadow.camera.left = -7;
    moon.shadow.camera.right = 7;
    moon.shadow.camera.top = 7;
    moon.shadow.camera.bottom = -7;
    moon.shadow.bias = -0.0018;
    moon.shadow.radius = 3;
  }
  scene.add(moon);

  const auroraFill = new THREE.PointLight(0xc9a24b, 2.4, 12, 2);
  auroraFill.position.set(0, 2.4, 5.2);
  scene.add(auroraFill);

  const obsidianFill = new THREE.PointLight(0x9a6bff, 2.2, 12, 2);
  obsidianFill.position.set(0, 2.4, -5.2);
  scene.add(obsidianFill);

  const rim = new THREE.DirectionalLight(0x8ab4ff, 0.35);
  rim.position.set(4, 3, -8);
  scene.add(rim);
}
