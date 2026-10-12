// Mercury's page (docs/stories/SS-16.md, W7): its scene, from SPICE and MESSENGER's MDIS maps,
// and its own controls. Loaded only on /mercury/; src/main.ts runs it. Its terrain (W4) streams
// from Mercury's own data site.
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { MoonEpochId } from '../capture/viewpoints';
import {
  mercuryEpoch,
  mercuryEpochAt,
  type MercuryEphemeris,
  type MercuryEpoch,
  type MercuryTimelineManifest,
} from '../core/mercury';
import { bodyFixedToSceneMatrix, j2000ToScene, moonViewPose, type Vec3 } from '../core/moon';
import { EXPOSURE, MERCURY_EXPOSURE } from '../core/photometry';
import { createLabels, loadLabelFont, type Landmark } from '../scenes/labels';
import {
  createMercuryMesh,
  createMercuryTerrain,
  MERCURY_TERRAIN_SITE,
  loadMercuryPhotometry,
  loadMercuryTextures,
  MERCURY_DATUM_KM,
  mercuryHapke,
} from '../scenes/mercury';
import { createStarMesh, loadStarField } from '../scenes/stars';
import {
  mercuryNeighboursAt,
  neighbourPoints,
  type MercuryNeighboursManifest,
} from '../core/mercuryNeighbours';
import { fluxOfMagnitude, type StarField } from '../core/stars';
import type { TileRange } from '../core/terrain';
import { siteUrl } from '../site';
import { createDateLinks } from '../ui/toggle';
import { loadJson, placedAt, type Stage, type StageContext, type WorldUi } from './stage';

/**
 * The highest ground above the 2439.4 km sphere, km: 4.474 in the USGS DEM v2 (sampled every
 * 16th pixel, SS-16 W4). The globe is smooth until the terrain arrives; this keeps the orbit's
 * floor where the ground will be.
 */
const HIGHEST_POINT_KM = 4.474;

function epochParam(params: URLSearchParams): MoonEpochId | null {
  const choice = params.get('epoch');
  return choice === 'full' ? 'full-2026-01' : choice === 'quarter' ? 'first-quarter-2026-01' : null;
}

/** Mercury at `utcMs`, from its SPICE timeline; null outside its span. */
async function epochFromTimeline(utcMs: number): Promise<MercuryEpoch | null> {
  const [manifest, bin] = await Promise.all([
    loadJson<MercuryTimelineManifest>('data/mercury/timeline.json'),
    fetch(siteUrl('data/mercury/timeline.bin')),
  ]);
  if (!bin.ok) throw new Error(`timeline.bin failed to load: HTTP ${bin.status}`);
  return mercuryEpochAt(manifest, new Float32Array(await bin.arrayBuffer()), utcMs);
}

/** Mercury's website terrain (W4), from its own data site. */
async function loadTerrainLayer(): Promise<{
  readonly base: string;
  readonly name: string;
  readonly available: TileRange[][];
}> {
  const response = await fetch(`${MERCURY_TERRAIN_SITE}layer.json`);
  if (!response.ok) throw new Error(`Mercury's layer.json failed to load: HTTP ${response.status}`);
  const layer = (await response.json()) as { name: string; available: TileRange[][] };
  return { ...layer, base: MERCURY_TERRAIN_SITE };
}

/**
 * Venus, Earth and the Moon as Mercury sees them at `epoch` (W8), as points of light: a star field
 * of three with their V magnitudes, and where to label them. Null outside the 2026-2030 span.
 */
async function loadNeighbours(epoch: MercuryEpoch): Promise<{
  readonly sky: StarField;
  readonly labelled: readonly { readonly name: string; readonly position: Vec3 }[];
} | null> {
  const [manifest, bin] = await Promise.all([
    loadJson<MercuryNeighboursManifest>('data/mercury/neighbours.json'),
    fetch(siteUrl('data/mercury/neighbours.bin')),
  ]);
  if (!bin.ok) throw new Error(`neighbours.bin failed to load: HTTP ${bin.status}`);
  const utcMs = Date.parse(epoch.utc.endsWith('Z') ? epoch.utc : `${epoch.utc}Z`);
  const at = mercuryNeighboursAt(manifest, new Float32Array(await bin.arrayBuffer()), utcMs);
  if (at === null) return null;
  const points = neighbourPoints(epoch, at);
  const scene = points.map((p) => j2000ToScene(p.directionJ2000));
  // Far enough to sit behind everything near Mercury, near enough for the depth buffer (as Mars).
  const FAR_LABEL_KM = 5e6;
  return {
    sky: {
      count: points.length,
      directions: new Float32Array(scene.flat()),
      flux: new Float32Array(points.map((p) => fluxOfMagnitude(p.v))),
      // No colour is drawn: white, of unit luminance (as Mars's Earth and Moon).
      colours: new Float32Array(points.length * 3).fill(1),
      vmag: new Float32Array(points.map((p) => p.v)),
      hr: new Float32Array(points.length),
    },
    labelled: points.map((p, i) => {
      const d = scene[i] ?? [0, 0, 0];
      return {
        name: p.name,
        position: [d[0] * FAR_LABEL_KM, d[1] * FAR_LABEL_KM, d[2] * FAR_LABEL_KM] as Vec3,
      };
    }),
  };
}

export async function createMercuryStage(context: StageContext): Promise<Stage> {
  const { reversedDepth, maxAnisotropy, captureId, params } = context;
  const fixedEpoch = epochParam(params);
  const listed = context.viewpoint.body;
  if (listed === null)
    throw new Error(`${context.viewpoint.id} is a Mercury scene without a setup`);
  const [ephemeris, field, photometry, layer, landmarkFile] = await Promise.all([
    loadJson<MercuryEphemeris>('data/mercury/ephemeris.json'),
    loadStarField(),
    loadMercuryPhotometry(),
    listed.relief ? loadTerrainLayer() : null,
    loadJson<{ landmarks: Landmark[] }>('data/mercury/landmarks.json'),
    loadLabelFont(siteUrl),
  ]);
  const textures =
    listed.albedo === 'map' ? await loadMercuryTextures(maxAnisotropy, photometry) : null;
  const radiiKm = ephemeris.body.radiiKm;
  const radiusKm = radiiKm[0];
  const setup = placedAt(context.viewpoint, params, radiusKm).body ?? listed;
  const now =
    captureId === null && fixedEpoch === null ? await epochFromTimeline(Date.now()) : null;
  const epoch =
    now ?? mercuryEpoch(ephemeris, (captureId === null ? fixedEpoch : null) ?? setup.epoch);
  const nowOutOfSpan = captureId === null && fixedEpoch === null && now === null;

  const scene = new Scene();
  const surface = {
    epoch,
    radiiKm,
    albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
    hapke: mercuryHapke(photometry),
    shading: setup.shading,
    mirrored: setup.mirrored,
  };
  // With relief Mercury is its measured shape, streamed as polygons from its data site (W4);
  // without, the smooth ellipsoid the photometry checks are written for.
  const terrain = layer === null ? null : createMercuryTerrain(surface, layer.base);
  scene.add(terrain === null ? createMercuryMesh(surface) : terrain.group);
  const starExposure = uniform(0);
  scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));
  // Venus, Earth and the Moon where they are at this instant (W8): points with the stars' exposure.
  const neighbours = await loadNeighbours(epoch);
  if (neighbours !== null) {
    scene.add(createStarMesh(neighbours.sky, { reversedDepth, exposure: starExposure }));
  }
  const bodyToScene = bodyFixedToSceneMatrix(epoch);
  const labels = createLabels(
    landmarkFile.landmarks,
    bodyToScene,
    MERCURY_DATUM_KM,
    j2000ToScene(epoch.sunDirectionJ2000),
    neighbours?.labelled ?? [],
  );
  labels.group.visible = setup.labels;
  if (setup.labels) labels.set(true, null);
  scene.add(labels.group);

  // Near 10 m over terrain; 1 km over the ellipsoid, as for Mars.
  const camera = new PerspectiveCamera(setup.fovDeg, 1, terrain === null ? 1 : 0.01, 1e8);
  const pose = moonViewPose(epoch, setup.vantage, setup.distanceKm);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(0, 0, 0);
  camera.rotateX((setup.tiltDeg * Math.PI) / 180);

  const when = epoch.utc.replace('T', ' ').slice(0, 16);
  const au = epoch.sunDistanceKm / 149_597_870.7;
  const caption =
    `Mercury from Earth · ${epoch.id === 'now' ? 'now, ' : ''}${when} UTC · phase angle ${epoch.phaseAngleDeg.toFixed(1)}° · ${au.toFixed(2)} AU from the Sun` +
    (nowOutOfSpan ? ' · today is outside the 2026-2030 timeline, so a fixed date is shown' : '');
  return {
    scene,
    camera,
    radiusKm,
    highestPointKm: HIGHEST_POINT_KM + (MERCURY_DATUM_KM - radiusKm),
    starExposure,
    exposureScale: MERCURY_EXPOSURE / EXPOSURE,
    labels,
    landmarks: landmarkFile.landmarks,
    bodyToScene,
    albedoDecodedMean: textures?.decodedMean ?? null,
    terrain,
    terrainAvailable: layer?.available ?? null,
    orbitInputs: {
      gmKm3PerS2: ephemeris.body.gmKm3PerS2,
      sun: j2000ToScene(epoch.sunDirectionJ2000),
      albedoTexelKm:
        textures === null ? null : (2 * Math.PI * radiusKm) / textures.albedo.image.width,
      earth: null,
    },
    ui: mercuryUi(caption, fixedEpoch),
  };
}

const ABOUT = [
  'Surface brightness and colour: MESSENGER’s MDIS camera, the three-colour map (430, 750 and 1000 nm) made from its lowest-Sun images, averaged over many (USGS / MESSENGER team, PDS MSGRMDS_6001). Where that map has no data, mostly south of 20°S, its eight-colour map (MSGRMDS_5001) fills in, scaled to agree with it to under 1%. The two polar caps neither map measured are shown black. Crater rims near the poles stay bright: the only pictures there were taken with the Sun low.',
  'How bright: the light scattering is fitted to Mercury’s measured brightness at every phase from 5° to 125° (Mallama and Hilton, 2018), and each colour scaled to Mercury’s measured colours (Mallama and others, 2017). Thinner crescents than that are drawn too faint: no one law matches Mercury’s brightness all the way round.',
  'Exposure: sunlight at Mercury is 4.5 to 10 times as strong as at Earth. This page is exposed for sunlight at Mercury’s average distance, so it is not too bright to see; stars use the same exposure.',
  'Shape: the surface is polygons, every corner on a height measured by MESSENGER: its stereo camera’s global model (USGS), and north of 70°N its laser altimeter (MLA), moved half a kilometre into the camera’s frame to line up with it. Vertices are about 940 m apart. Heights are true scale: Mercury’s relief spans about 10 km.',
  'Venus, Earth and the Moon: points of light where they are in Mercury\u2019s sky, as bright as they really are: Venus and Earth by their measured brightness at their phase (Mallama and Hilton, 2018), the Moon by its own page\u2019s measured map and light scattering, summed over the face Mercury sees. Venus reaches about magnitude \u22128, the brightest thing in Mercury\u2019s night sky. Like the stars, they are far too faint to show next to sunlit Mercury at a real exposure; Stars \u00d7100,000 shows them. Their colour is not drawn.',
  'Labels: names and places from the IAU Gazetteer of Planetary Nomenclature. Hun Kal is the small crater that defines Mercury’s longitudes.',
  'Orbit: flies from wherever you are looking, at the real circular speed for that height around Mercury, never below the height the terrain stays sharp from.',
  'Moving: drag to fly over the surface, pinch or scroll to change height, and drag two fingers up (with a mouse, right-drag or shift-drag) to tilt towards the horizon.',
];

function mercuryUi(caption: string, fixedEpoch: MoonEpochId | null): WorldUi {
  const current =
    fixedEpoch === 'first-quarter-2026-01'
      ? 'quarter'
      : fixedEpoch === 'full-2026-01'
        ? 'full'
        : null;
  return {
    caption,
    leading: (row) => {
      row.append(
        createDateLinks(
          [
            [null, 'Now'],
            ['quarter', '26 Jan 2026'],
            ['full', '3 Jan 2026'],
          ],
          current,
        ),
      );
    },
    trailing: () => {},
    about: ABOUT,
    summaryPrefix: [],
  };
}
