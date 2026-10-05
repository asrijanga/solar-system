// Mars's neighbours in its sky (docs/stories/SS-14.md, W8): Phobos and Deimos as their measured
// shapes, lit by the Sun with their own measured scattering laws and darkened in Mars's shadow;
// each also as a point of light carrying its whole brightness when it is too small to draw; and
// Earth and the Moon as points of light at their true brightness (core/marsMoons.ts).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  RedFormat,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
  type UniformNode,
} from 'three/webgpu';
import {
  acos,
  asin,
  atan,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  Fn,
  length,
  max,
  min,
  mix,
  normalize,
  normalWorld,
  positionGeometry,
  positionWorld,
  screenDPR,
  screenSize,
  sin,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { MarsEpoch } from '../core/mars';
import {
  DEIMOS_LAW,
  decodeShape,
  discTable,
  earthMagnitudeV,
  facetBins,
  magnitudeFromSum,
  monthFor,
  moonsAt,
  PHOBOS_LAW,
  SUN_RADIUS_KM,
  sunlitFraction,
  type DiscTable,
  type MoonLaw,
  type MoonsAt,
  type MoonShape,
  type MoonsManifest,
} from '../core/marsMoons';
import { j2000ToScene, type Mat3Rows, type Vec3 } from '../core/moon';
import { AU_KM, EXPOSURE, physicalStarExposure } from '../core/photometry';
import { fluxOfMagnitude, type StarField } from '../core/stars';
import { siteUrl } from '../site';
import { hapkeNode } from './hapkeNode';

/** Point-spread width of a moon too small to draw, CSS pixels: the stars' (scenes/stars.ts). */
const PSF_SIGMA_CSS = 0.7;
const QUAD_RADIUS_SIGMAS = 3;
/**
 * A moon's point of light takes over as its drawn shape shrinks from 3 to 1 CSS pixels across:
 * below about a pixel, triangles fall between the samples the GPU takes and the shape vanishes.
 */
const POINT_FROM_PX = 3;
const POINT_FULL_PX = 1;
/** physicalStarExposure(Ω) · Ω: the stars' physical exposure for a pixel of one steradian. */
const PHYSICAL_STAR_EXPOSURE_SR = physicalStarExposure(1);

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(siteUrl(path));
  if (!response.ok) throw new Error(`${path} failed to load: HTTP ${response.status}`);
  return response;
}

async function loadShape(file: string): Promise<MoonShape> {
  const bytes = new Uint8Array(await (await fetchOk(`data/mars/moons/${file}`)).arrayBuffer());
  // Some servers send a .gz file with Content-Encoding: gzip, and the browser has inflated it
  // already (Vite's preview does); others send the gzip bytes. Inflate only what is still gzip,
  // as scenes/tileFetch.ts does.
  const raw =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer()
      : bytes.buffer;
  return decodeShape(raw);
}

export interface MoonsData {
  readonly at: MoonsAt;
  readonly phobos: MoonShape;
  readonly deimos: MoonShape;
}

/** Everything the neighbours need at the epoch, or null outside the positions' span. */
export async function loadMoons(epoch: MarsEpoch): Promise<MoonsData | null> {
  const manifest = (await (await fetchOk('data/mars/moons.json')).json()) as MoonsManifest;
  const month = monthFor(manifest, epoch.utc);
  if (month === null) return null;
  const [bytes, phobos, deimos] = await Promise.all([
    fetchOk(`data/mars/moons/${month.file}`).then((r) => r.arrayBuffer()),
    loadShape(manifest.shapes.phobos.file),
    loadShape(manifest.shapes.deimos.file),
  ]);
  const at = moonsAt(manifest, month, new Float32Array(bytes), epoch.tdbSecondsPastJ2000);
  return { at, phobos, deimos };
}

export interface MarsShape {
  readonly radiiKm: Vec3;
  /** Mars's north pole, scene. */
  readonly poleScene: Vec3;
}

/** Row-major J2000 → body as a body → scene Matrix4 (scene = j2000ToScene ∘ transpose). */
function bodyToScene(j2000ToBody: Mat3Rows, positionScene: Vec3): Matrix4 {
  const column = (k: 0 | 1 | 2): Vec3 =>
    j2000ToScene([j2000ToBody[k][0], j2000ToBody[k][1], j2000ToBody[k][2]]);
  const x = column(0);
  const y = column(1);
  const z = column(2);
  return new Matrix4().set(
    x[0], y[0], z[0], positionScene[0],
    x[1], y[1], z[1], positionScene[1],
    x[2], y[2], z[2], positionScene[2],
    0, 0, 0, 1,
  ); // prettier-ignore
}

/**
 * A moon lit by the Sun, its law per fragment, darkened by the share of the Sun's disc Mars hides
 * (core/marsMoons.ts sunlitFraction, evaluated here branch-free: Mars is always far larger on the
 * sky than the Sun from either moon, so where the discs overlap the share is the lens, and where
 * the Sun is wholly behind Mars it is all).
 */
function moonMaterial(
  law: MoonLaw,
  epoch: MarsEpoch,
  mars: MarsShape,
  sunScene: Vec3,
): MeshBasicNodeMaterial {
  const sun = uniform(new Vector3(...sunScene));
  const pole = uniform(new Vector3(...mars.poleScene));
  const r = epoch.sunDistanceKm / AU_KM;
  const scale = EXPOSURE / (r * r);
  const [a, , c] = mars.radiiKm;
  const stretch = a / c - 1;
  const sunRadius = Math.asin(SUN_RADIUS_KM / epoch.sunDistanceKm);
  const p = law.parameters;
  const params = {
    w: float(p.w),
    b: float(p.b),
    c: float(p.c),
    bs0: float(p.bs0),
    hs: float(p.hs),
  };

  const material = new MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const normal = normalize(normalWorld);
    const view = normalize(cameraPosition.sub(positionWorld));
    const mu0 = dot(normal, sun);
    const mu = dot(normal, view);
    const iOverF = hapkeNode(mu0, mu, dot(sun, view), params, law.thetaBarDeg, law.porosityK)
      .mul(step(1e-6, mu0))
      .mul(step(1e-6, mu));

    // Mars's shadow: stretch along the pole so Mars is a sphere of its equatorial radius.
    const q = positionWorld.add(pole.mul(dot(positionWorld, pole).mul(stretch)));
    const s = normalize(sun.add(pole.mul(dot(sun, pole).mul(stretch))));
    const qLength = length(q);
    const marsRadius = asin(min(float(a).div(qLength), 1));
    const separation = acos(clamp(dot(q, s).div(qLength).negate(), -1, 1));
    const sa = float(sunRadius);
    // The lens where the two discs overlap, as a share of the Sun's (hiddenFraction).
    const d = max(separation, 1e-9);
    const alpha = acos(
      clamp(d.mul(d).add(sa.mul(sa)).sub(marsRadius.mul(marsRadius)).div(d.mul(sa).mul(2)), -1, 1),
    );
    const beta = acos(
      clamp(
        d.mul(d).add(marsRadius.mul(marsRadius)).sub(sa.mul(sa)).div(d.mul(marsRadius).mul(2)),
        -1,
        1,
      ),
    );
    const lens = sa
      .mul(sa)
      .mul(alpha.sub(sin(alpha.mul(2)).div(2)))
      .add(marsRadius.mul(marsRadius).mul(beta.sub(sin(beta.mul(2)).div(2))))
      .div(sa.mul(sa).mul(Math.PI));
    const apart = step(sa.add(marsRadius), separation); // 1: no overlap
    const inside = step(separation, marsRadius.sub(sa)); // 1: the Sun wholly behind Mars
    const hidden = mix(mix(clamp(lens, 0, 1), float(1), inside), float(0), apart);
    const value = iOverF.mul(scale).mul(float(1).sub(hidden));
    return vec4(vec3(value), 1);
  })();
  return material;
}

/** East-west mirrored: y negated, and each triangle's winding reversed so it still faces out. */
function mirror(shape: MoonShape): MoonShape {
  const positions = shape.positions.slice();
  for (let i = 1; i < positions.length; i += 3) positions[i] = -(positions[i] ?? 0);
  const indices = shape.indices.slice();
  for (let k = 0; k < indices.length; k += 3) {
    const b = indices[k + 1] ?? 0;
    indices[k + 1] = indices[k + 2] ?? 0;
    indices[k + 2] = b;
  }
  return { positions, indices };
}

function moonMesh(shape: MoonShape, material: MeshBasicNodeMaterial, matrix: Matrix4): Mesh {
  // Each triangle lit by its own normal: the shape as measured, nothing smoothed between its
  // vertices (Deimos's are 5° apart). Three vertices per triangle, so none shares a normal.
  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new BufferAttribute(shape.positions, 3));
  indexed.setIndex(new BufferAttribute(shape.indices, 1));
  const geometry = indexed.toNonIndexed();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}

/** What a moon's point of light needs: where it is, how big, and its brightness table. */
interface PointSource {
  readonly positionScene: Vec3;
  readonly meanRadiusKm: number;
  readonly table: DiscTable;
  /** Scene to the moon's frame. */
  readonly sceneToBody: Matrix3;
  /** EXPOSURE / r² times the share of the Sun the moon's centre sees. */
  readonly scale: number;
  /**
   * The stars' exposure (scenes/stars.ts): its ratio to the physical one for this pixel is the
   * labelled Stars boost, which the point takes too (owner, 2026-10-04).
   */
  readonly starExposure: UniformNode<'float', number>;
}

/**
 * A moon as a point of light, spread as the stars are, carrying its whole brightness from where
 * the camera is. Everything is worked out in the vertex shader, so the frame loop does nothing
 * for it: the moon's summed law for the camera's direction from its table (core/marsMoons.ts,
 * bilinear like lookupDisc, half floats over the table's maximum), divided by the distance
 * squared and a CSS pixel's solid angle, faded in as the drawn shape falls from POINT_FROM_PX to
 * POINT_FULL_PX across, and lifted by the labelled Stars boost when it is on. Behind Mars it is hidden by the depth test.
 */
function pointMesh(source: PointSource): Mesh {
  const { table } = source;
  let peakValue = 0;
  for (const v of table.values) peakValue = Math.max(peakValue, v);
  const halves = new Uint16Array(table.values.length);
  for (let i = 0; i < halves.length; i++) {
    halves[i] = DataUtils.toHalfFloat((table.values[i] ?? 0) / Math.max(peakValue, 1e-30));
  }
  const map = new DataTexture(halves, table.cols, table.rows, RedFormat, HalfFloatType);
  map.magFilter = LinearFilter;
  map.minFilter = LinearFilter;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.needsUpdate = true;

  const centre = uniform(new Vector3(...source.positionScene));
  const sceneToBody = uniform(source.sceneToBody);
  const corner = varying(positionGeometry.xy, 'vMoonPoint');
  const integrated = varying(float(0), 'vMoonPointFlux');
  const material = new MeshBasicNodeMaterial();
  const sigma = float(PSF_SIGMA_CSS).mul(screenDPR);
  material.vertexNode = Fn(() => {
    const toCamera = cameraPosition.sub(centre);
    const dist = length(toCamera);
    const d = sceneToBody.mul(toCamera.div(dist));
    const lat = asin(clamp(d.z, -1, 1)).mul(180 / Math.PI);
    const lon = atan(d.y, d.x).mul(180 / Math.PI);
    // Grid node k sits at the centre of texel k.
    const u = lon.add(180).div(table.stepDeg).add(0.5).div(table.cols);
    const v = lat.add(90).div(table.stepDeg).add(0.5).div(table.rows);
    const sum = texture(map, vec2(u, v), 0).r.mul(peakValue).toVar();
    // A CSS pixel's side, radians: 2 tan(fov / 2) over the height. The projection's [1][1],
    // 1 / tan(fov / 2), is what it makes of a view-space direction one up and one ahead.
    const heightCss = screenSize.y.div(screenDPR);
    const cotHalf = cameraProjectionMatrix.mul(vec4(0, 1, -1, 0)).y;
    const perPx = float(2).div(cotHalf.mul(heightCss));
    const acrossPx = float(2 * source.meanRadiusKm)
      .div(dist)
      .div(perPx);
    const weight = clamp(
      float(POINT_FROM_PX)
        .sub(acrossPx)
        .div(POINT_FROM_PX - POINT_FULL_PX),
      0,
      1,
    );
    // The Stars boost: the stars' exposure over the physical one for this pixel's solid angle
    // (core/photometry.ts physicalStarExposure), 1 unless the labelled boost is on.
    const boost = source.starExposure.mul(perPx.mul(perPx)).div(PHYSICAL_STAR_EXPOSURE_SR);
    integrated.assign(
      weight.mul(source.scale).mul(boost).mul(sum).div(dist.mul(dist)).div(perPx.mul(perPx)),
    );
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1));
    const offset = positionGeometry.xy
      .mul(sigma.mul(QUAD_RADIUS_SIGMAS * 2))
      .div(screenSize)
      .mul(clip.w);
    return vec4(clip.xy.add(offset), clip.z, clip.w);
  })();
  const r2 = dot(corner, corner).mul(QUAD_RADIUS_SIGMAS * QUAD_RADIUS_SIGMAS);
  const peak = integrated.mul(1 / (2 * Math.PI * PSF_SIGMA_CSS * PSF_SIGMA_CSS));
  material.colorNode = vec4(vec3(peak.mul(exp(r2.mul(-0.5)))), 1);
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  return mesh;
}

export interface MarsMoons {
  readonly group: Group;
  /** Earth and the Moon, as stars are drawn: points at infinity, with the stars' exposure. */
  readonly sky: StarField;
  /** Scene positions and directions for labels: the moons where they are, Earth and the Moon far. */
  readonly labelled: readonly { readonly name: string; readonly position: Vec3 }[];
  /** Phobos's and Deimos's magnitudes as seen from Mars's centre, for the caption and checks. */
  readonly describe: () => string;
}

const MEAN_RADIUS = (shape: MoonShape): number => {
  let volume = 0;
  const p = shape.positions;
  const t = shape.indices;
  for (let k = 0; k < t.length; k += 3) {
    const a = (t[k] ?? 0) * 3;
    const b = (t[k + 1] ?? 0) * 3;
    const c = (t[k + 2] ?? 0) * 3;
    volume +=
      ((p[a] ?? 0) * ((p[b + 1] ?? 0) * (p[c + 2] ?? 0) - (p[b + 2] ?? 0) * (p[c + 1] ?? 0)) -
        (p[a + 1] ?? 0) * ((p[b] ?? 0) * (p[c + 2] ?? 0) - (p[b + 2] ?? 0) * (p[c] ?? 0)) +
        (p[a + 2] ?? 0) * ((p[b] ?? 0) * (p[c + 1] ?? 0) - (p[b + 1] ?? 0) * (p[c] ?? 0))) /
      6;
  }
  return Math.cbrt((3 * volume) / (4 * Math.PI));
};

export function createMarsMoons(
  epoch: MarsEpoch,
  mars: MarsShape,
  data: MoonsData,
  /** The stars' exposure: far moons' points take its labelled boost. */
  starExposure: UniformNode<'float', number>,
  /** Negative control only: this moon's shape mirrored east-west. */
  mirrored: 'phobos' | 'deimos' | null = null,
): MarsMoons {
  const group = new Group();
  group.name = 'neighbours';
  const sunJ2000 = epoch.sunDirectionJ2000;
  const sunScene = j2000ToScene(sunJ2000);
  const [a, , c] = mars.radiiKm;
  const r = epoch.sunDistanceKm / AU_KM;

  for (const [name, shape, law, positionJ2000, j2000ToBody] of [
    ['Phobos', data.phobos, PHOBOS_LAW, data.at.phobosJ2000Km, data.at.j2000ToPhobos],
    ['Deimos', data.deimos, DEIMOS_LAW, data.at.deimosJ2000Km, data.at.j2000ToDeimos],
  ] as const) {
    const positionScene = j2000ToScene(positionJ2000);
    const matrix = bodyToScene(j2000ToBody, positionScene);
    const drawn = mirrored === name.toLowerCase() ? mirror(shape) : shape;
    const mesh = moonMesh(drawn, moonMaterial(law, epoch, mars, sunScene), matrix);
    mesh.name = name;
    group.add(mesh);
    // The Sun in the moon's own frame, for its brightness table.
    const m = j2000ToBody;
    const sunBody: Vec3 = [
      m[0][0] * sunJ2000[0] + m[0][1] * sunJ2000[1] + m[0][2] * sunJ2000[2],
      m[1][0] * sunJ2000[0] + m[1][1] * sunJ2000[1] + m[1][2] * sunJ2000[2],
      m[2][0] * sunJ2000[0] + m[2][1] * sunJ2000[1] + m[2][2] * sunJ2000[2],
    ];
    const sceneToBody = new Matrix3().setFromMatrix4(matrix).transpose();
    const lit = sunlitFraction(
      positionScene,
      mars.poleScene,
      c / a,
      a,
      sunScene,
      epoch.sunDistanceKm,
    );
    group.add(
      pointMesh({
        positionScene,
        meanRadiusKm: MEAN_RADIUS(shape),
        table: discTable(facetBins(shape), law, sunBody),
        sceneToBody,
        scale: (EXPOSURE / (r * r)) * lit,
        starExposure,
      }),
    );
  }

  // Earth and the Moon from Mars (core/marsMoons.ts).
  const sunKm: Vec3 = [
    sunJ2000[0] * epoch.sunDistanceKm,
    sunJ2000[1] * epoch.sunDistanceKm,
    sunJ2000[2] * epoch.sunDistanceKm,
  ];
  const e = epoch.earthDirectionJ2000;
  const earthKm: Vec3 = [
    e[0] * epoch.earthDistanceKm,
    e[1] * epoch.earthDistanceKm,
    e[2] * epoch.earthDistanceKm,
  ];
  const o = data.at.moonOffsetJ2000Km;
  const moonKm: Vec3 = [earthKm[0] + o[0], earthKm[1] + o[1], earthKm[2] + o[2]];
  const length3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
  const minus = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const angleDeg = (u: Vec3, v: Vec3): number =>
    (Math.acos(
      Math.max(
        -1,
        Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length3(u) * length3(v))),
      ),
    ) *
      180) /
    Math.PI;
  const earthToSun = minus(sunKm, earthKm);
  const earthV = earthMagnitudeV(
    length3(earthToSun) / AU_KM,
    epoch.earthDistanceKm / AU_KM,
    angleDeg(earthToSun, [-earthKm[0], -earthKm[1], -earthKm[2]]),
  );
  const moonV = magnitudeFromSum(
    data.at.moonDiscKm2,
    length3(moonKm),
    length3(minus(sunKm, moonKm)) / AU_KM,
  );
  const earthScene = j2000ToScene([
    earthKm[0] / epoch.earthDistanceKm,
    earthKm[1] / epoch.earthDistanceKm,
    earthKm[2] / epoch.earthDistanceKm,
  ]);
  const d = length3(moonKm);
  const moonScene = j2000ToScene([moonKm[0] / d, moonKm[1] / d, moonKm[2] / d]);
  const sky: StarField = {
    count: 2,
    directions: new Float32Array([...earthScene, ...moonScene]),
    flux: new Float32Array([fluxOfMagnitude(earthV), fluxOfMagnitude(moonV)]),
    // No colour is drawn for either: white, of unit luminance.
    colours: new Float32Array([1, 1, 1, 1, 1, 1]),
    vmag: new Float32Array([earthV, moonV]),
    hr: new Float32Array([0, 0]),
  };

  // Far enough to sit behind everything near Mars, near enough for the depth buffer.
  const FAR_LABEL_KM = 5e6;
  const labelled = [
    { name: 'Phobos', position: j2000ToScene(data.at.phobosJ2000Km) },
    { name: 'Deimos', position: j2000ToScene(data.at.deimosJ2000Km) },
    {
      name: 'Earth',
      position: [
        earthScene[0] * FAR_LABEL_KM,
        earthScene[1] * FAR_LABEL_KM,
        earthScene[2] * FAR_LABEL_KM,
      ],
    },
    {
      name: 'Moon',
      position: [
        moonScene[0] * FAR_LABEL_KM,
        moonScene[1] * FAR_LABEL_KM,
        moonScene[2] * FAR_LABEL_KM,
      ],
    },
  ] as const;

  return {
    group,
    sky,
    labelled,
    describe: () => `Earth V ${earthV.toFixed(2)}, Moon V ${moonV.toFixed(2)}`,
  };
}
