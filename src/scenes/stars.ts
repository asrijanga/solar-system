import {
  AdditiveBlending,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  Fn,
  float,
  instancedBufferAttribute,
  positionGeometry,
  screenDPR,
  screenSize,
  varying,
  vec4,
} from 'three/tsl';
import { decodeStars, type StarField } from '../core/stars';

/**
 * Point-spread function width in CSS pixels. Fixed on screen: a star is a point at any zoom,
 * and never grows or shrinks as the camera moves.
 */
const PSF_SIGMA_CSS = 0.7;
/** Quads extend to 3σ, where the Gaussian is down to about 1%. */
const QUAD_RADIUS_SIGMAS = 3;

/**
 * Integrated brightness of a magnitude-0 star, in linear display units times CSS pixels².
 * With σ = 0.7 px this peaks near 3 (a saturated core, as in a photograph) and leaves the
 * naked-eye limit around magnitude 6.5 just visible on black. An authored nominal exposure
 * for a sky with nothing sunlit in it, used only by the star-only viewpoints. Wherever the
 * Moon is in the scene, stars use physical exposure (core/photometry.ts) and an optional,
 * labelled boost: the owner's decision in docs/stories/SS-4.md.
 */
export const NOMINAL_STAR_EXPOSURE = 9.2;

/**
 * The labelled star boost: 10^5, exactly 12.5 magnitudes. At a 40° field on a phone-sized
 * screen it brings physical exposure to about the nominal one, so the sky reads again.
 */
export const STAR_BOOST = 100_000;
export const STAR_BOOST_MAGNITUDES = 12.5;

export async function loadStarField(): Promise<StarField> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/stars/bsc5.bin`);
  if (!response.ok) throw new Error(`star catalogue failed to load: HTTP ${response.status}`);
  return decodeStars(await response.arrayBuffer());
}

export interface StarMeshOptions {
  /** Must match the renderer: stars are placed exactly on the far plane. */
  readonly reversedDepth: boolean;
  /**
   * Negative control only: mirror the sky through the scene's YZ plane, the error a
   * determinant −1 axis mapping would make. Never used outside the orion-mirrored viewpoint.
   */
  readonly mirrored?: boolean;
  /**
   * Integrated display value of a magnitude-0 star. A uniform when it changes with the view
   * (physical exposure depends on pixel solid angle); a number when fixed.
   */
  readonly exposure: number | UniformNode<'float', number>;
}

/** Every star in one draw call: one instanced quad per star. */
export function createStarMesh(field: StarField, options: StarMeshOptions): Mesh {
  const directions = field.directions.slice();
  if (options.mirrored === true) {
    for (let i = 0; i < field.count; i++) directions[i * 3] = -(directions[i * 3] ?? 0);
  }

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = field.count;

  // Per-star attributes. The node type is passed explicitly so TSL (and TypeScript) know it.
  const direction = instancedBufferAttribute<'vec3'>(
    new InstancedBufferAttribute(directions, 3),
    'vec3',
  );
  const flux = instancedBufferAttribute<'float'>(
    new InstancedBufferAttribute(field.flux, 1),
    'float',
  );
  const colour = instancedBufferAttribute<'vec3'>(
    new InstancedBufferAttribute(field.colours, 3),
    'vec3',
  );

  const sigmaDevice = float(PSF_SIGMA_CSS).mul(screenDPR);
  const corner = varying(positionGeometry.xy, 'vStarCorner');

  const material = new MeshBasicNodeMaterial();
  material.vertexNode = Fn(() => {
    // w = 0: a direction, so only the camera's rotation applies. Stars are at infinity.
    const viewDirection = cameraViewMatrix.mul(vec4(direction, 0)).xyz;
    const clip = cameraProjectionMatrix.mul(vec4(viewDirection, 0));
    // Expand the quad in screen space by a fixed number of device pixels.
    const radius = sigmaDevice.mul(QUAD_RADIUS_SIGMAS);
    const offset = positionGeometry.xy.mul(radius).mul(2).div(screenSize).mul(clip.w);
    // Exactly on the far plane: depth 0 under reversed-Z, 1 (z = w) otherwise. Anything
    // nearer draws over the stars; stars never draw over anything.
    const z = options.reversedDepth ? float(0) : clip.w;
    return vec4(clip.xy.add(offset), z, clip.w);
  })();

  // Gaussian spot carrying the star's whole flux: peak = exposure · flux / (2πσ²), with σ in
  // CSS pixels. Radiance is per unit of screen area, so on a 2x display the spot covers four
  // times the device pixels at the same peak, and the star looks equally bright everywhere.
  const r2 = dot(corner, corner).mul(QUAD_RADIUS_SIGMAS * QUAD_RADIUS_SIGMAS);
  const psf = exp(r2.mul(-0.5));
  const exposure =
    typeof options.exposure === 'number' ? float(options.exposure) : options.exposure;
  const peak = flux.mul(exposure).mul(1 / (2 * Math.PI * PSF_SIGMA_CSS * PSF_SIGMA_CSS));
  material.colorNode = vec4(colour.mul(peak).mul(psf), 1);

  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.depthTest = true;

  const mesh = new Mesh(geometry, material);
  mesh.name = 'stars';
  // The quad geometry sits at the origin; the stars are everywhere. Never cull.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
