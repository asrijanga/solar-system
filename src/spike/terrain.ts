// SS-10 spike, not shipped: can 3DTilesRendererJS stream LOLA quantized-mesh terrain inside
// our WebGPURenderer, under our TSL photometry? `?software` for SwiftShader.
import {
  Color,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Vector3,
} from 'three/webgpu';
import {
  cameraPosition,
  dot,
  float,
  max,
  normalize,
  normalWorld,
  pass,
  positionWorld,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { TilesRenderer } from '3d-tiles-renderer';
import { QuantizedMeshPlugin } from '3d-tiles-renderer/plugins';
import {
  bodyFixedToJ2000,
  bodyFixedToSceneMatrix,
  findEpoch,
  j2000ToScene,
  lonLatToBodyFixed,
  type MoonEphemeris,
} from '../core/moon';
import { displayValue, lommelSeeligerAlbedoFor, MOON_GEOMETRIC_ALBEDO } from '../core/photometry';
import { probeAdapter, requestDevice } from '../gpu/adapter';
import { createRenderer } from '../gpu/renderer';

declare global {
  interface Window {
    __spike?: { ready: boolean; tiles: number; log: string[] };
  }
}
const state = { ready: false, tiles: 0, log: [] as string[] };
window.__spike = state;

const params = new URLSearchParams(location.search);
const R_KM = 1737.4;

async function main(): Promise<void> {
  const probe = await probeAdapter(params.has('software'));
  if (probe.adapter === null) throw new Error('no adapter');
  const device = await requestDevice(probe.adapter);
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const renderer = await createRenderer({
    canvas,
    device,
    antialias: true,
    reversedDepthBuffer: true,
    trackTimestamp: false,
  });
  renderer.setClearColor(new Color('#000000'), 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const ephemeris = (await (
    await fetch(`${import.meta.env.BASE_URL}data/moon/ephemeris.json`)
  ).json()) as MoonEphemeris;
  const epoch = findEpoch(ephemeris, 'first-quarter-2026-01');
  const m = bodyFixedToSceneMatrix(epoch);
  const bodyToScene = new Matrix4().set(
    m[0] ?? 0,
    m[1] ?? 0,
    m[2] ?? 0,
    0,
    m[3] ?? 0,
    m[4] ?? 0,
    m[5] ?? 0,
    0,
    m[6] ?? 0,
    m[7] ?? 0,
    m[8] ?? 0,
    0,
    0,
    0,
    0,
    1,
  );

  const scene = new Scene();
  const tiles = new TilesRenderer(`${import.meta.env.BASE_URL}spike-tiles/`);
  tiles.ellipsoid.radius.set(R_KM * 1000, R_KM * 1000, R_KM * 1000);
  tiles.registerPlugin(new QuantizedMeshPlugin({ useRecommendedSettings: true }));
  // Tiles are body-fixed metres; the scene is km in ICRF-aligned axes.
  tiles.group.matrixAutoUpdate = false;
  tiles.group.matrix.copy(bodyToScene).multiply(new Matrix4().makeScale(0.001, 0.001, 0.001));
  tiles.group.matrixWorldNeedsUpdate = true;
  scene.add(tiles.group);

  // Lommel–Seeliger from the terrain's own geometry normals, uniform albedo (core/photometry.ts).
  const sun = uniform(new Vector3(...j2000ToScene(epoch.sunDirectionJ2000)));
  const albedo = lommelSeeligerAlbedoFor(MOON_GEOMETRIC_ALBEDO);
  const scale = displayValue(1, epoch.sunDistanceKm);
  const material = new MeshBasicNodeMaterial();
  const n = normalize(normalWorld);
  const mu0 = max(dot(n, sun), 0);
  const mu = max(dot(n, normalize(cameraPosition.sub(positionWorld))), 0);
  material.colorNode = vec4(
    vec3(
      float(albedo / 4)
        .mul(mu0)
        .div(max(mu0.add(mu), 1e-6))
        .mul(scale),
    ),
    1,
  );
  tiles.addEventListener('load-model', ({ scene: model }: { scene: Scene }) => {
    model.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).material = material;
    });
    state.tiles++;
  });

  // Camera: over Albategnius, looking obliquely across it towards the low sun.
  const place = (lonDeg: number, latDeg: number, altitudeKm: number): Vector3 => {
    const d = j2000ToScene(bodyFixedToJ2000(epoch, lonLatToBodyFixed(lonDeg, latDeg)));
    return new Vector3(...d).multiplyScalar(R_KM + altitudeKm);
  };
  const altitude = Number(params.get('alt') ?? 60);
  const camera = new PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.05, 1e6);
  camera.position.copy(place(4.0092 - 1.2, -11.24 - 1.6, altitude));
  camera.up.copy(camera.position).normalize();
  camera.lookAt(place(4.0092, -11.24, 0));
  camera.updateMatrixWorld();

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer as never);

  const pipeline = new RenderPipeline(renderer, pass(scene, camera));
  let frames = 0;
  const frame = (): void => {
    camera.updateMatrixWorld();
    tiles.update();
    pipeline.render();
    frames++;
    if (!state.ready && frames > 30 && tiles.loadProgress === 1) {
      state.ready = true;
      state.log.push(`ready after ${frames} frames, ${state.tiles} models`);
    }
  };
  await renderer.setAnimationLoop(frame);
}

main().catch((e: unknown) => {
  state.log.push(String(e instanceof Error ? e.stack : e));
  console.error(e);
});
