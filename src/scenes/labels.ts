import {
  CanvasTexture,
  Group,
  LinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  mix,
  normalize,
  smoothstep,
  texture,
  time,
  uniform,
  vec4,
} from 'three/tsl';

/** One landmark, as public/data/moon/landmarks.json gives it (tools/data/landmarks.ts). */
export interface Landmark {
  readonly name: string;
  readonly label: string;
  readonly kind: 'crater' | 'mare' | 'mountains' | 'valley' | 'landing';
  readonly lonDeg: number;
  readonly latDeg: number;
  readonly diameterKm: number;
}

/** Seconds a label takes to fade when the Labels button is pressed. */
const TOGGLE_FADE_S = 1.5;
/** Label text height on screen, CSS pixels. */
const TEXT_PX = 15;
/** Canvas pixels per CSS pixel the text is drawn at, so it stays sharp on a phone. */
const TEXT_SCALE = 3;
/** Landing sites are points; they are shown as if this wide, so they appear from orbit. */
const LANDING_SITE_KM = 60;

/**
 * The label typeface, shipped with the site (public/fonts/, Inter 5.3.0 via @fontsource/inter,
 * SIL OFL 1.1) so labels are drawn the same on every machine: a system font differs between
 * phones, desktops and the CI runner, and with it every capture that shows labels.
 */
const FONT_FAMILY = 'SolarLabel';
const FONT_FILES = [
  ['fonts/inter-latin-600-normal.woff2', 'normal'],
  ['fonts/inter-latin-600-italic.woff2', 'italic'],
] as const;

/** Load the label typeface; call before createLabels. `url` resolves a site-root path. */
export async function loadLabelFont(url: (path: string) => string): Promise<void> {
  await Promise.all(
    FONT_FILES.map(async ([path, style]) => {
      const face = new FontFace(FONT_FAMILY, `url(${url(path)})`, { style, weight: '600' });
      document.fonts.add(await face.load());
    }),
  );
}

const KIND_COLOUR: Record<Landmark['kind'], string> = {
  mare: '#cfd8e8',
  crater: '#ffffff',
  mountains: '#e8e1cf',
  valley: '#e8e1cf',
  landing: '#f5c451',
};

export interface Labels {
  readonly group: Group;
  /**
   * Show or hide the labels, fading over TOGGLE_FADE_S from `nowSeconds` on three's node clock
   * (the TSL `time`). `nowSeconds` null shows or hides them at once, as captures need.
   */
  set(on: boolean, nowSeconds: number | null): void;
  /** Keep the text TEXT_PX CSS pixels tall for this canvas height and vertical field of view. */
  setViewport(heightCssPx: number, fovDeg: number): void;
}

/**
 * Landmark labels over the Moon (docs/stories/SS-15.md). Each is a sprite of fixed on-screen size
 * whose opacity the shader works out every frame from where it is, so the frame loop does no
 * work for them:
 * - it fades in as its landmark rises over the horizon and out as it sets;
 * - it dims on the night side, and brightens as the Sun rises there;
 * - small features wait until the camera is close enough for them to matter;
 * - pressing Labels fades them all in or out.
 * `bodyToScene` is the row-major 3x3 rotation from the body-fixed frame (core/moon.ts).
 */
export function createLabels(
  landmarks: readonly Landmark[],
  bodyToScene: readonly number[],
  radiusKm: number,
  sunScene: readonly [number, number, number],
): Labels {
  const group = new Group();
  group.name = 'labels';
  const on = uniform(0);
  const changedAt = uniform(-1e9);
  const sun = uniform(new Vector3(...sunScene));
  const toggle = mix(
    float(1).sub(clamp(time.sub(changedAt).div(TOGGLE_FADE_S), 0, 1)),
    clamp(time.sub(changedAt).div(TOGGLE_FADE_S), 0, 1),
    on,
  );
  const sprites: { sprite: Sprite; aspect: number }[] = [];

  for (const landmark of landmarks) {
    const { canvas, aspect, anchorY } = drawLabel(landmark);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.minFilter = LinearFilter;
    map.generateMipmaps = false;

    const lon = (landmark.lonDeg * Math.PI) / 180;
    const lat = (landmark.latDeg * Math.PI) / 180;
    const body = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const m = bodyToScene;
    const dir = new Vector3(
      (m[0] ?? 0) * (body[0] ?? 0) + (m[1] ?? 0) * (body[1] ?? 0) + (m[2] ?? 0) * (body[2] ?? 0),
      (m[3] ?? 0) * (body[0] ?? 0) + (m[4] ?? 0) * (body[1] ?? 0) + (m[5] ?? 0) * (body[2] ?? 0),
      (m[6] ?? 0) * (body[0] ?? 0) + (m[7] ?? 0) * (body[1] ?? 0) + (m[8] ?? 0) * (body[2] ?? 0),
    );
    const anchor = uniform(dir.clone().multiplyScalar(radiusKm));
    const sizeKm = landmark.kind === 'landing' ? LANDING_SITE_KM : landmark.diameterKm;

    const material = new SpriteNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    material.sizeAttenuation = false;
    const sample = texture(map);
    const normal = normalize(anchor);
    const toCamera = cameraPosition.sub(anchor);
    const distance = length(toCamera);
    // Above the horizon: 0 at the limb, 1 once well clear of it, so labels rise and set slowly.
    const horizon = smoothstep(0.0, 0.18, dot(normal, toCamera.div(distance)));
    // Sunlight: dim at night, full once the Sun is a few degrees up.
    const daylight = mix(0.3, 1, smoothstep(-0.03, 0.1, dot(normal, sun)));
    // Prominence: a feature fades in as it grows from about 2 to 3.5 degrees across, as seen
    // from the camera. From far out only the maria are named; in orbit, craters and landing
    // sites appear as they come near.
    const prominence = smoothstep(0.035, 0.06, float(sizeKm).div(distance));
    material.colorNode = vec4(sample.rgb, 1);
    material.opacityNode = sample.a.mul(horizon).mul(daylight).mul(prominence).mul(toggle);

    const sprite = new Sprite(material);
    sprite.name = `label ${landmark.name}`;
    sprite.position.copy(dir).multiplyScalar(radiusKm);
    // The dot at the bottom of the texture sits on the landmark.
    sprite.center.set(0.5, anchorY);
    sprite.renderOrder = 10;
    sprite.frustumCulled = false;
    group.add(sprite);
    sprites.push({ sprite, aspect });
  }

  return {
    group,
    set(visible, nowSeconds) {
      on.value = visible ? 1 : 0;
      changedAt.value = nowSeconds ?? -1e9;
    },
    setViewport(heightCssPx, fovDeg) {
      // With size attenuation off, three multiplies the scale by the view depth, so the scale is
      // the label's size at unit distance: its share of the screen times the view's full height.
      const perPx = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightCssPx);
      for (const { sprite, aspect } of sprites) {
        const h = LABEL_HEIGHT_PX * perPx;
        sprite.scale.set(h * aspect, h, 1);
      }
    },
  };
}

/** Height of the whole label texture (text plus the dot beneath it), CSS pixels. */
const LABEL_HEIGHT_PX = TEXT_PX * 2;

function drawLabel(landmark: Landmark): {
  canvas: HTMLCanvasElement;
  aspect: number;
  anchorY: number;
} {
  const font = `${landmark.kind === 'mare' ? 'italic ' : ''}600 ${TEXT_PX * TEXT_SCALE}px ${FONT_FAMILY}`;
  const probe = document.createElement('canvas').getContext('2d');
  if (probe === null) throw new Error('no 2D context for labels');
  probe.font = font;
  const textWidth = Math.ceil(probe.measureText(landmark.label).width);
  const pad = TEXT_PX * TEXT_SCALE * 0.4;
  const height = LABEL_HEIGHT_PX * TEXT_SCALE;
  const width = textWidth + 2 * pad;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2D context for labels');
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const textY = height * 0.32;
  // A soft dark halo keeps the text legible over bright highlands.
  context.lineJoin = 'round';
  context.lineWidth = TEXT_SCALE * 3.5;
  context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  context.strokeText(landmark.label, width / 2, textY);
  context.fillStyle = KIND_COLOUR[landmark.kind];
  context.fillText(landmark.label, width / 2, textY);
  // The dot that marks the spot.
  const dotY = height * 0.8;
  context.beginPath();
  context.arc(width / 2, dotY, TEXT_SCALE * 2.2, 0, 2 * Math.PI);
  context.fillStyle = 'rgba(0, 0, 0, 0.75)';
  context.fill();
  context.beginPath();
  context.arc(width / 2, dotY, TEXT_SCALE * 1.4, 0, 2 * Math.PI);
  context.fillStyle = KIND_COLOUR[landmark.kind];
  context.fill();
  return { canvas, aspect: width / height, anchorY: 1 - dotY / height };
}
