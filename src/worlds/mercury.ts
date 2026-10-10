// Mercury's page (docs/stories/SS-16.md, W7): its scene, from SPICE and MESSENGER's MDIS maps,
// and its own controls. Loaded only on /mercury/; src/main.ts runs it. The smooth globe first; its
// terrain (W4) follows once Mercury's data site is live (owner, 2026-10-10).
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
import { bodyFixedToSceneMatrix, j2000ToScene, moonViewPose } from '../core/moon';
import { EXPOSURE, MERCURY_EXPOSURE } from '../core/photometry';
import { createLabels, loadLabelFont, type Landmark } from '../scenes/labels';
import {
  createMercuryMesh,
  loadMercuryPhotometry,
  loadMercuryTextures,
  MERCURY_DATUM_KM,
  mercuryHapke,
} from '../scenes/mercury';
import { createStarMesh, loadStarField } from '../scenes/stars';
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

export async function createMercuryStage(context: StageContext): Promise<Stage> {
  const { reversedDepth, maxAnisotropy, captureId, params } = context;
  const fixedEpoch = epochParam(params);
  const listed = context.viewpoint.body;
  if (listed === null)
    throw new Error(`${context.viewpoint.id} is a Mercury scene without a setup`);
  const [ephemeris, field, photometry, landmarkFile] = await Promise.all([
    loadJson<MercuryEphemeris>('data/mercury/ephemeris.json'),
    loadStarField(),
    loadMercuryPhotometry(),
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
  scene.add(
    createMercuryMesh({
      epoch,
      radiiKm,
      albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
      hapke: mercuryHapke(photometry),
      shading: setup.shading,
      mirrored: setup.mirrored,
    }),
  );
  const starExposure = uniform(0);
  scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));
  const bodyToScene = bodyFixedToSceneMatrix(epoch);
  const labels = createLabels(
    landmarkFile.landmarks,
    bodyToScene,
    MERCURY_DATUM_KM,
    j2000ToScene(epoch.sunDirectionJ2000),
    [],
  );
  labels.group.visible = setup.labels;
  if (setup.labels) labels.set(true, null);
  scene.add(labels.group);

  const camera = new PerspectiveCamera(setup.fovDeg, 1, 1, 1e8);
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
    terrain: null,
    terrainAvailable: null,
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
  'Shape: a smooth globe for now. Heights measured by MESSENGER’s stereo camera and laser altimeter come next.',
  'Labels: names and places from the IAU Gazetteer of Planetary Nomenclature. Hun Kal is the small crater that defines Mercury’s longitudes.',
  'Moving: drag to turn the globe, pinch or scroll to change height.',
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
