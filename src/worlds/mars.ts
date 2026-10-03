// Mars's page (docs/stories/SS-14.md, W7): its scene, from SPICE, OMEGA, HRSC, TES and MOLA, and
// its own controls. Loaded only on /mars/; src/main.ts runs it.
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { MoonEpochId } from '../capture/viewpoints';
import {
  marsEpoch,
  marsEpochAt,
  type MarsEphemeris,
  type MarsEpoch,
  type MarsTimelineManifest,
} from '../core/mars';
import { bodyFixedToSceneMatrix, j2000ToScene, moonViewPose } from '../core/moon';
import type { TileRange } from '../core/terrain';
import { createLabels, loadLabelFont, type Landmark } from '../scenes/labels';
import {
  createMarsMesh,
  createMarsTerrain,
  loadMarsPhotometry,
  loadMarsTextures,
  MARS_TERRAIN_SITE,
  MARS_TILE_SPHERE_KM,
  marsHapke,
} from '../scenes/mars';
import { createStarMesh, loadStarField } from '../scenes/stars';
import { siteUrl } from '../site';
import { createDateLinks } from '../ui/toggle';
import { loadJson, placedAt, type Stage, type StageContext, type WorldUi } from './stage';

/**
 * The highest ground above the 3396 km sphere the tiles are heights above, km: 21.291 at
 * Olympus Mons, 17.35°N 133.45°W, measured 2026-10-03 in the W4 composite (areoid + height,
 * pipeline/mars_terrain.py). Where no terrain is under the camera yet, it is kept above this.
 */
const HIGHEST_POINT_KM = 21.291;

/** `?epoch=quarter` and `?epoch=full`: the Moon's two fixed instants, which Mars's W2 shares. */
function epochParam(params: URLSearchParams): MoonEpochId | null {
  const choice = params.get('epoch');
  return choice === 'full'
    ? 'full-2026-01'
    : choice === 'quarter'
      ? 'first-quarter-2026-01'
      : null;
}

/** Mars at the moment the page opened, from its SPICE timeline; null outside its span. */
async function epochNow(): Promise<MarsEpoch | null> {
  const [manifest, bin] = await Promise.all([
    loadJson<MarsTimelineManifest>('data/mars/timeline.json'),
    fetch(siteUrl('data/mars/timeline.bin')),
  ]);
  if (!bin.ok) throw new Error(`timeline.bin failed to load: HTTP ${bin.status}`);
  return marsEpochAt(manifest, new Float32Array(await bin.arrayBuffer()), Date.now());
}

interface TerrainLayer {
  readonly base: string;
  readonly name: string;
  readonly available: TileRange[][];
}

/**
 * Mars's terrain: `npm run local`'s, everything measured (W5), where this page is served by it;
 * otherwise the website's, from Mars's own data site (W4).
 */
async function loadTerrainLayer(): Promise<TerrainLayer> {
  type Layer = { name: string; available: TileRange[][] };
  try {
    const layer = await loadJson<Layer>('mars-terrain/layer.json');
    return { ...layer, base: siteUrl('mars-terrain/') };
  } catch {
    // Not local mode: GitHub Pages has no /mars-terrain/.
  }
  const response = await fetch(`${MARS_TERRAIN_SITE}layer.json`);
  if (!response.ok) throw new Error(`Mars's layer.json failed to load: HTTP ${response.status}`);
  return { ...((await response.json()) as Layer), base: MARS_TERRAIN_SITE };
}

export async function createMarsStage(context: StageContext): Promise<Stage> {
  const { reversedDepth, maxAnisotropy, captureId, params } = context;
  const fixedEpoch = epochParam(params);
  // `?at=` changes only where the camera is, so what to load is the listed setup's.
  const listed = context.viewpoint.body;
  if (listed === null) throw new Error(`${context.viewpoint.id} is a Mars scene without a setup`);
  const [ephemeris, field, photometry, layer, landmarkFile] = await Promise.all([
    loadJson<MarsEphemeris>('data/mars/ephemeris.json'),
    loadStarField(),
    loadMarsPhotometry(),
    listed.relief ? loadTerrainLayer() : null,
    loadJson<{ landmarks: Landmark[] }>('data/mars/landmarks.json'),
    loadLabelFont(siteUrl),
  ]);
  const textures = listed.albedo === 'map' ? await loadMarsTextures(maxAnisotropy, photometry) : null;
  const radiiKm = ephemeris.body.radiiKm;
  const radiusKm = radiiKm[0];
  const setup = placedAt(context.viewpoint, params, radiusKm).body ?? listed;
  // Now, unless a fixed instant was asked for; outside the timeline's span, the viewpoint's.
  const now = captureId === null && fixedEpoch === null ? await epochNow() : null;
  const epoch =
    now ?? marsEpoch(ephemeris, (captureId === null ? fixedEpoch : null) ?? setup.epoch);
  const nowOutOfSpan = captureId === null && fixedEpoch === null && now === null;

  const scene = new Scene();
  const surface = {
    epoch,
    radiiKm,
    albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
    hapke: marsHapke(photometry),
    shading: setup.shading,
    mirrored: setup.mirrored,
  };
  // With relief Mars is its measured shape, streamed as polygons (W4); without, the smooth
  // ellipsoid the photometry checks are written for.
  const terrain = layer === null ? null : createMarsTerrain(surface, layer.base);
  scene.add(terrain === null ? createMarsMesh(surface) : terrain.group);
  const starExposure = uniform(0);
  scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));
  // Landmark labels, hidden until asked for (docs/stories/SS-15.md).
  const bodyToScene = bodyFixedToSceneMatrix(epoch);
  // Labels sit on the tiles' sphere, the ground's mean.
  const labels = createLabels(
    landmarkFile.landmarks,
    bodyToScene,
    MARS_TILE_SPHERE_KM,
    j2000ToScene(epoch.sunDirectionJ2000),
  );
  labels.group.visible = setup.labels;
  if (setup.labels) labels.set(true, null);
  scene.add(labels.group);

  // Near 10 m over terrain; 1 km over the ellipsoid, as for the Moon.
  const camera = new PerspectiveCamera(setup.fovDeg, 1, terrain === null ? 1 : 0.01, 1e8);
  const pose = moonViewPose(epoch, setup.vantage, setup.distanceKm);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(0, 0, 0);
  camera.rotateX((setup.tiltDeg * Math.PI) / 180);

  const when = epoch.utc.replace('T', ' ').slice(0, 16);
  const caption =
    `Mars from Earth · ${epoch.id === 'now' ? 'now, ' : ''}${when} UTC · phase angle ${epoch.phaseAngleDeg.toFixed(1)}° · season Ls ${epoch.solarLongitudeLsDeg.toFixed(0)}°` +
    (nowOutOfSpan ? ' · today is outside the 2026-2030 timeline, so a fixed date is shown' : '') +
    (layer?.name.startsWith('mars-local') === true
      ? ' · full measured detail, streamed locally'
      : '');
  return {
    scene,
    camera,
    radiusKm,
    highestPointKm: HIGHEST_POINT_KM + (MARS_TILE_SPHERE_KM - radiusKm),
    starExposure,
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
      // Earth is a point of light in Mars's sky until W8: no earthrise tilt.
      earth: null,
    },
    ui: marsUi(caption, fixedEpoch),
  };
}

const ABOUT = [
  'Surface brightness: the near-infrared brightness Mars Express’s OMEGA spectrometer measured from 2004 to 2010 (Ody and others, 2012), the gaps filled from Mars Global Surveyor’s TES, carried to visible light and coloured by the colour Mars Express’s HRSC camera measured (Michael and others, 2025; ESA/DLR/FU Berlin, CC BY-SA 3.0 IGO). It is Mars as it usually looks, averaged over years, clear of dust storms and clouds: not Mars on this date.',
  'How bright: each colour is scaled so the whole planet is exactly as bright as astronomers measure Mars to be in that colour (Mallama and others, 2017). How brightness changes with the Sun’s angle is fitted to Mars’s measured brightness from full to 50° phase (Mallama and Hilton, 2018). Those measurements include Mars’s thin dusty air, so its average effect on brightness is in the light, but the air itself is not drawn yet: no haze at the edge of the disc, no blue sunsets.',
  'Shape: the surface is polygons, every corner on a height measured by Mars Global Surveyor’s laser altimeter (MOLA) or Mars Express’s stereo camera (HRSC), registered to the laser. Vertices are about 1.3 km apart everywhere on this site; `npm run local` streams HRSC’s and HiRISE’s full detail. Heights are true scale: Olympus Mons is 21 km high, Hellas 8 km deep.',
  'Stars: physical is a real exposure. Next to sunlit Mars, stars are far too faint to show. Boosted makes them 100,000 times brighter.',
  'Orbit: flies from wherever you are looking, at the real circular speed for that height around Mars, never below the height the terrain stays sharp from.',
  'Labels: names and places from the IAU Gazetteer of Planetary Nomenclature. Gale, Jezero and Gusev are the craters Curiosity, Perseverance and Spirit landed in; the Gazetteer itself names no landing sites on Mars, so the labels give the craters’ names only.',
  'Moving: drag to fly over the surface, pinch or scroll to change height, and drag two fingers up (with a mouse, right-drag or shift-drag) to tilt towards the horizon.',
];

/** Shown while the page is open: what is not drawn (owner, 2026-10-03). */
const ATMOSPHERE_NOTE =
  'Mars’s thin dusty air is not drawn yet: no haze at the edge of the disc, no blue sunsets.';

function marsUi(caption: string, fixedEpoch: MoonEpochId | null): WorldUi {
  const current =
    fixedEpoch === 'first-quarter-2026-01' ? 'quarter' : fixedEpoch === 'full-2026-01' ? 'full' : null;
  return {
    caption,
    leading: (row, notes) => {
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
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = ATMOSPHERE_NOTE;
      notes.append(note);
    },
    trailing: () => {},
    about: ABOUT,
    summaryPrefix: [],
  };
}
