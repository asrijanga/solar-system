// The Moon's page (docs/stories/SS-13.md): its scene, from SPICE, LRO and Kaguya, and its own
// controls. Loaded only on /moon/; src/main.ts runs it.
import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { MoonEpochId } from '../capture/viewpoints';
import {
  bodyFixedToSceneMatrix,
  findEpoch,
  j2000ToScene,
  moonViewPose,
  type MoonEphemeris,
  type MoonEpoch,
} from '../core/moon';
import { EARTHSHINE_BOOST_STOPS, earthshineFactor } from '../core/photometry';
import { epochAt, type TimelineManifest } from '../core/timeline';
import type { TileRange } from '../core/terrain';
import { createEarth, loadEarthFace } from '../scenes/earth';
import { createLabels, loadLabelFont, type Landmark } from '../scenes/labels';
import { createMoonMesh, createMoonTerrain, loadHapke, loadMoonTextures } from '../scenes/moon';
import { createStarMesh, loadStarField } from '../scenes/stars';
import { siteUrl } from '../site';
import { createDateLinks, createToggle } from '../ui/toggle';
import { loadJson, placedAt, type Stage, type StageContext, type WorldUi } from './stage';

/**
 * The highest point on the Moon above the 1737.4 km sphere, km: LOLA +10.757 km at 5.441°N,
 * 158.656°W (docs/stories/SS-8.md). Where no terrain is under the camera yet, it is kept
 * above this.
 */
const HIGHEST_POINT_KM = 10.757;

const APPROXIMATION_NOTE =
  'Approximation: below what was measured (about 10 m), small craters and roughness are generated from the Moon’s statistics (NASA DSNE crater counts, NASA LRO stereo models). They are not the real craters here.';

/**
 * The page opens at the current moment (owner, 2026-10-02, docs/stories/SS-13f.md). `?epoch=quarter`
 * and `?epoch=full` show the two fixed instants instead: first quarter, when Earth's real face was
 * measured, and the full Moon. Captures always use their viewpoint's own fixed instant.
 */
function epochParam(params: URLSearchParams): MoonEpochId | null {
  const choice = params.get('epoch');
  return choice === 'full' ? 'full-2026-01' : choice === 'quarter' ? 'first-quarter-2026-01' : null;
}

/** The Moon at the moment the page opened, from the SPICE timeline; null outside its span. */
async function epochNow(): Promise<MoonEpoch | null> {
  const [manifest, bin] = await Promise.all([
    loadJson<TimelineManifest>('data/moon/timeline.json'),
    fetch(siteUrl('data/moon/timeline.bin')),
  ]);
  if (!bin.ok) throw new Error(`timeline.bin failed to load: HTTP ${bin.status}`);
  return epochAt(manifest, new Float32Array(await bin.arrayBuffer()), Date.now());
}

interface TerrainLayer {
  readonly path: string;
  readonly name: string;
  readonly available: TileRange[][];
  readonly approximated: boolean;
}

/** The measured terrain, or with `?detail=approx` the approximation layer where it is served. */
async function loadTerrainLayer(detailApprox: boolean): Promise<TerrainLayer> {
  type Layer = { name: string; available: TileRange[][] };
  if (detailApprox) {
    try {
      const layer = await loadJson<Layer>('terrain-approx/layer.json');
      return { ...layer, path: 'terrain-approx/', approximated: true };
    } catch {
      console.warn('[terrain] no approximation layer here (only `npm run local` serves it)');
    }
  }
  const layer = await loadJson<Layer>('terrain/layer.json');
  return { ...layer, path: 'terrain/', approximated: false };
}

export async function createMoonStage(context: StageContext): Promise<Stage> {
  const { reversedDepth, maxAnisotropy, captureId, params } = context;
  // `?detail=approx`: below the finest measurement, the labelled approximation
  // (docs/stories/SS-10b.md), served only by `npm run local`. Off unless asked for; never in a check.
  const detailApprox = params.get('detail') === 'approx';
  const fixedEpoch = epochParam(params);
  // `?at=` changes only where the camera is, so what to load is the listed setup's.
  const listed = context.viewpoint.body;
  if (listed === null)
    throw new Error(`${context.viewpoint.id} is a Moon scene without a Moon setup`);
  const [ephemeris, field, textures, hapke, layer, landmarkFile] = await Promise.all([
    loadJson<MoonEphemeris>('data/moon/ephemeris.json'),
    loadStarField(),
    listed.albedo === 'map' ? loadMoonTextures(maxAnisotropy) : null,
    loadHapke(),
    listed.relief ? loadTerrainLayer(detailApprox) : null,
    loadJson<{ landmarks: Landmark[] }>('data/moon/landmarks.json'),
    loadLabelFont(siteUrl),
  ]);
  const radiusKm = ephemeris.body.radiiKm[0];
  const setup = placedAt(context.viewpoint, params, radiusKm).body ?? listed;
  // Now, unless a fixed instant was asked for; outside the timeline's span, the viewpoint's.
  const now = captureId === null && fixedEpoch === null ? await epochNow() : null;
  const epoch =
    now ?? findEpoch(ephemeris, (captureId === null ? fixedEpoch : null) ?? setup.epoch);
  const nowOutOfSpan = captureId === null && fixedEpoch === null && now === null;
  const evenLight = uniform(setup.lighting === 'even' ? 1 : 0);
  const earthshineBoost = uniform(setup.earthshine === 'boosted' ? 2 ** EARTHSHINE_BOOST_STOPS : 1);
  // Earth's face as the satellites measured it at this epoch, where built (SS-13c), and the
  // earthshine it puts on the Moon (SS-13e).
  const face = await loadEarthFace(epoch.id, siteUrl, maxAnisotropy);
  const earthRadiusKm = ephemeris.earth.radiiKm[0];
  const scene = new Scene();
  const moon = {
    epoch,
    radiusKm,
    albedo: textures ?? { uniform: setup.albedo === 'map' ? 0 : setup.albedo.uniform },
    hapke,
    shading: setup.shading,
    mirrored: setup.mirrored,
    seamFix: setup.seamFix,
    evenLight,
    reliefFlipped: setup.reliefFlipped,
    earthshineBoost,
    earthshine:
      face === null
        ? null
        : {
            direction: j2000ToScene(epoch.earthDirectionJ2000),
            angularRadius: Math.asin(earthRadiusKm / epoch.earthDistanceKm),
            factor: face.discIOverF.map((f) =>
              earthshineFactor(f, earthRadiusKm, epoch.earthDistanceKm),
            ) as [number, number, number],
          },
  };
  // With relief the Moon is its measured shape, streamed as polygons (SS-10); without,
  // the smooth sphere the photometry checks are written for.
  const terrain = layer === null ? null : createMoonTerrain(moon, siteUrl(layer.path));
  scene.add(terrain === null ? createMoonMesh(moon) : terrain.group);
  const starExposure = uniform(0);
  scene.add(createStarMesh(field, { reversedDepth, exposure: starExposure }));
  // Earth in the sky (docs/stories/SS-13b.md, SS-13c.md).
  const earth = createEarth(epoch, ephemeris.earth, face);
  scene.add(earth);
  // Landmark labels, hidden until asked for (docs/stories/SS-15.md).
  const bodyToScene = bodyFixedToSceneMatrix(epoch);
  const labels = createLabels(
    landmarkFile.landmarks,
    bodyToScene,
    radiusKm,
    j2000ToScene(epoch.sunDirectionJ2000),
  );
  labels.group.visible = setup.labels;
  if (setup.labels) labels.set(true, null);
  scene.add(labels.group);

  // Near 10 m over terrain, where the camera comes down to a couple of kilometres; 1 km
  // over the sphere, whose surface is never closer than 870 km. Reversed-Z float depth
  // keeps full precision to any far plane (docs/stories/SS-3.md).
  const camera = new PerspectiveCamera(setup.fovDeg, 1, terrain === null ? 1 : 0.01, 1e7);
  const pose = moonViewPose(epoch, setup.vantage, setup.distanceKm);
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(0, 0, 0);
  camera.rotateX((setup.tiltDeg * Math.PI) / 180);
  if (setup.lookAtEarth) camera.lookAt(new Vector3().setFromMatrixPosition(earth.matrix));
  const when = epoch.utc.replace('T', ' ').slice(0, 16);
  const caption =
    `The Moon from Earth · ${epoch.id === 'now' ? 'now, ' : ''}${when} UTC · phase angle ${epoch.phaseAngleDeg.toFixed(1)}°` +
    (nowOutOfSpan ? ' · today is outside the 2026-2030 timeline, so a fixed date is shown' : '') +
    // `npm run local` serves the whole Moon at full measured detail (tools/local/server.ts).
    (layer?.name.startsWith('moon-local') === true
      ? ' · full measured detail, streamed locally'
      : '') +
    (layer?.approximated === true ? ' · APPROXIMATED below 10 m' : '');
  return {
    scene,
    camera,
    radiusKm,
    highestPointKm: HIGHEST_POINT_KM,
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
      earth: j2000ToScene(epoch.earthDirectionJ2000).map((c) => c * epoch.earthDistanceKm) as [
        number,
        number,
        number,
      ],
    },
    frame: null,
    ui: moonUi({
      caption,
      fixedEpoch,
      terrainLayer: layer?.name ?? null,
      approximated: layer?.approximated ?? false,
      albedoGaps: (textures?.gaps ?? null) !== null,
      onEvenLight: (even) => {
        evenLight.value = even ? 1 : 0;
      },
      onEarthshineBoost: (on) => {
        earthshineBoost.value = on ? 2 ** EARTHSHINE_BOOST_STOPS : 1;
      },
    }),
  };
}

const ABOUT = [
  'Lighting: sun is real sunlight at this date, plus earthshine: sunlight reflected by Earth onto the side of the Moon that faces it, coloured by Earth as the weather satellites measured it. At first quarter it is about 50,000 times fainter than sunlight, so at a sunlit exposure the night side is black, as in every photograph of the sunlit Moon. The far side never sees Earth.',
  'Earthshine: boosted draws Earth’s light 8,192 times (13 stops) brighter, only where the Sun is down, so the night side shows beside the sunlit side as in a two-exposure photograph; the sunlit Moon, Earth and the stars are unchanged. At the full-Moon date Earth’s measured face is not built yet, so no earthshine is drawn there; it falls on the day side then anyway.',
  'Lighting: even shows every point at full-Moon brightness, as if lit from behind you everywhere at once. Not physical, but it shows the whole surface.',
  'Stars: physical is a real exposure. Next to the sunlit Moon, stars are far too faint to show, as in every Apollo photograph. Boosted makes them 100,000 times brighter.',
  'Surface brightness and colour come from the Lunar Reconnaissance Orbiter (LRO). Its Wide Angle Camera photographed the Moon about 124,000 times from 2010 to 2013, from 70°N to 70°S; each point is the median of years of pictures, corrected to one lighting angle, so no shadows are baked in. Colour is measured too: red, green and blue are its 643, 566 and 415 nm bands, which is why the maria look faintly brown or blue. Near the poles the Sun is always low, so there the map is LOLA, LRO’s laser, which measured brightness with its own light, blended in between 62° and 70°. No colour was measured there: the poles take the Moon’s average colour. The few small places the camera missed are filled from LOLA’s global laser map, matched to the camera around each one.',
  'How brightness changes with the Sun’s angle comes from LRO’s Wide Angle Camera, which watched every square degree of the Moon from 70°N to 70°S under many angles of light (Sato and others, 2014). So the Moon brightens sharply towards full, as the real one does, and the quarter Moon is about a tenth as bright as the full Moon, not half. Nearer the poles than 70° the Moon’s typical behaviour is used.',
  "Shape: the surface is polygons, every corner on a height measured by LOLA, the Lunar Reconnaissance Orbiter's laser altimeter. Zoom in and finer polygons stream in: vertices about 670 m apart everywhere, 41 m around the crater Albategnius from LOLA's finest data, and 10 m on its floor and central peak from the stereo cameras of Japan's Kaguya orbiter. Slopes catch the Sun and shade away from it; at full Moon the relief nearly vanishes, as it does in reality. Heights are true scale. Shadows cast across the ground are not drawn yet.",
  'Orbit: flies from wherever you are looking. Turn the Moon to any spot and pinch or scroll to choose the height first; Orbit starts over the point below you and flies towards the top of your screen, at the real circular speed for that height, and never below the height the terrain stays sharp from. Start over the far side flying towards the near side to watch Earth rise ahead.',
  'Labels: names and places from the IAU Gazetteer of Planetary Nomenclature. Each label rises and sets with its landmark, dims on the night side, and small features wait until you are close enough for them to matter.',
  'Earth: where it really is at this date, at its measured size, turned as it really was. On 26 January 2026 at 05:00 UTC it is Earth as the Himawari-9 (JMA) and GOES-18 (NOAA) weather satellites measured it at that moment: the real clouds, oceans, land and blue air, in colour, cross-calibrated and blended. They saw it from other directions than the Moon does, so cloud tops are approximate and the glint of the Sun on the sea that the Moon would see is missing. At any other moment, now included, it is a plain sphere of its measured brightness (geometric albedo 0.434, NASA): no satellite image of that moment is built into the site yet.',
  'Moving: drag to fly over the surface, pinch or scroll to change height, and drag two fingers up (with a mouse, right-drag or shift-drag) to tilt towards the horizon. How low you can go depends on how finely the ground beneath was measured.',
  'Detail (local mode only): measured shows only measurements. + approximation adds, below about 10 m, small craters and roughness generated from the Moon’s statistics: crater numbers and shapes from NASA’s lunar environment specification, roughness from NASA’s 2 m stereo terrain models. The surface still passes through every measurement, but these are not the real craters there, and the screen says so while it is on.',
];
const GAP_NOTE =
  'Magenta marks the places no mission measured. They are shown as missing, not filled in.';

/** The Moon's own controls: the instants, the lighting and earthshine switches, the detail link. */
function moonUi(options: {
  readonly caption: string;
  readonly fixedEpoch: MoonEpochId | null;
  readonly terrainLayer: string | null;
  readonly approximated: boolean;
  readonly albedoGaps: boolean;
  readonly onEvenLight: (even: boolean) => void;
  readonly onEarthshineBoost: (on: boolean) => void;
}): WorldUi {
  const { approximated, terrainLayer, albedoGaps } = options;
  const current =
    options.fixedEpoch === 'first-quarter-2026-01'
      ? 'quarter'
      : options.fixedEpoch === 'full-2026-01'
        ? 'full'
        : null;
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  return {
    caption: options.caption,
    leading: (row, notes) => {
      // Now, or one of the two fixed instants (SS-13f).
      const dates = createDateLinks(
        [
          [null, 'Now'],
          ['quarter', 'First quarter (26 Jan 2026)'],
          ['full', 'Full Moon (3 Jan 2026)'],
        ],
        current,
      );
      const lighting = createToggle(
        { off: 'Lighting: sun', on: 'Lighting: even' },
        'Even lighting is not physical: every point at full-Moon brightness, so the night and far sides show.',
        notes,
        options.onEvenLight,
      );
      const earthshine = createToggle(
        { off: 'Earthshine: physical', on: 'Earthshine: boosted' },
        `Earthshine ×${(2 ** EARTHSHINE_BOOST_STOPS).toLocaleString('en')} (${EARTHSHINE_BOOST_STOPS} stops) brighter than physics, only where the Sun is down, so the night side shows beside the sunlit side, as in a two-exposure photograph.`,
        notes,
        options.onEarthshineBoost,
      );
      row.append(dates, lighting, earthshine);
    },
    trailing: (row, notes) => {
      // The approximation exists only where `npm run local` serves it.
      if (terrainLayer?.startsWith('moon-local') === true) {
        const detail = document.createElement('a');
        const toggled = new URLSearchParams(location.search);
        if (approximated) toggled.delete('detail');
        else toggled.set('detail', 'approx');
        const q = toggled.toString();
        detail.href = q === '' ? location.pathname : `?${q}`;
        detail.textContent = approximated ? 'Detail: + approximation' : 'Detail: measured';
        row.append(detail);
      }
      if (approximated) {
        // Shown for as long as the approximation is (docs/stories/SS-10b.md).
        const note = document.createElement('p');
        note.className = 'note warning';
        note.textContent = APPROXIMATION_NOTE;
        notes.append(note);
      }
    },
    about: albedoGaps ? [...ABOUT, GAP_NOTE] : ABOUT,
    summaryPrefix: albedoGaps ? [swatch, 'Magenta: never measured · '] : [],
  };
}
