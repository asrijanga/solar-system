import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IS_SMALL_SCREEN, THEME } from '../config';
import { fitDistance } from './fitView';

// Fixed bird's-eye viewing direction: steep but not top-down, so the board reads as
// unmistakably 3D. The camera always sits along this ray from the target; only the
// distance changes (per-aspect autofit, and the player's own zoom on top of it).
const VIEW_DIRECTION = new THREE.Vector3(0, 16.5, 8.5).normalize();
const TARGET = new THREE.Vector3(0, 0.1, 0);

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  clock: THREE.Clock;
  resize: () => void;
  dispose: () => void;
}

export function createSceneRig(mount: HTMLElement): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.bg);
  scene.fog = new THREE.FogExp2(THEME.fogColor, 0.011);

  const camera = new THREE.PerspectiveCamera(32, mount.clientWidth / mount.clientHeight, 0.1, 100);
  const initialDistance = fitDistance(camera, VIEW_DIRECTION, TARGET);
  camera.position.copy(TARGET).addScaledVector(VIEW_DIRECTION, initialDistance);
  camera.lookAt(TARGET);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_SMALL_SCREEN ? 2 : 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = !IS_SMALL_SCREEN;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = initialDistance * 0.7;
  controls.maxDistance = initialDistance * 1.9;
  controls.minPolarAngle = THREE.MathUtils.degToRad(18);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(58);
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.update();

  const clock = new THREE.Clock();

  function resize() {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    camera.aspect = width / height;

    // Re-fit along the camera's *current* direction so the board always stays fully
    // on screen after an orientation change or window resize, without discarding
    // any manual orbit rotation the player already applied.
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = fitDistance(camera, direction, controls.target);
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.minDistance = distance * 0.7;
    controls.maxDistance = distance * 1.9;

    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    controls.update();
  }

  function dispose() {
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === mount) {
      mount.removeChild(renderer.domElement);
    }
  }

  return { renderer, scene, camera, controls, clock, resize, dispose };
}
