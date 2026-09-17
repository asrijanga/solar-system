import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SUN, PLANETS, COMETS, KEYBOARD_ORDER, AU_KM, C_KM_S } from './data.js';
import { planetPosition, cometPosition, orbitPath, cometPath, dateToJD, jdToDate, J2000_JD } from './orbits.js';
import { Soundtrack, CHIME_SCALE } from './audio.js';
import { Cinematic } from './tour.js';
import { playCrawl } from './crawl.js';
import * as SH from './shaders.js';

// ------------------------------------------------------------------ constants
const AU_SCALE = 100;                 // scene units per AU (true scale)
const RADIUS_AU = km => km / AU_KM;   // km -> AU
const TEX = 'assets/textures/';
const clock = new THREE.Clock();

// ------------------------------------------------------------------ state
const state = {
  jd: dateToJD(new Date()),
  speedExp: 5.4,             // slider value; seconds of sim time per real second = 10^(0.85*exp)
  paused: false,
  calmRotation: true,        // spin on a compressed clock instead of the simulation clock
  spinClock: 0,              // seconds of real time since the spin clock started
  spinEpochJD: 0,            // date the calm spin was last synchronised to
  orbitIntro: 1,             // orbit lines stay dark through the opening shots
  showOrbits: false, showLabels: true, showBelts: true, showMoons: true, bloom: true,
  selected: null,            // body record
  follow: null,
  hover: null,
};
const bodies = [];           // all selectable bodies
const byId = new Map();

function speedSeconds() { return Math.pow(10, 0.85 * state.speedExp); }

// Everything below is one straight linear map from kilometres to scene units.
// There is deliberately no size exaggeration and no distance compression: a world
// that is a speck is drawn as a speck, and the space between them is the space
// that is actually there. The marker sprites are what keep it navigable.
const _v = new THREE.Vector3();
function toScene(p, out = new THREE.Vector3()) {
  return out.set(p.x, p.z, -p.y).multiplyScalar(AU_SCALE);
}
function bodyRadiusScene(km) { return RADIUS_AU(km) * AU_SCALE; }
function moonDistanceScene(sat) { return RADIUS_AU(sat.distanceKm) * AU_SCALE; }

// ------------------------------------------------------------------ renderer
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.id = 'labelroot';
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.getElementById('labels').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.0005, 200000);
camera.position.set(0, 420, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06;
// a true-scale Phobos is 7e-6 units across, so the near limit has to be tiny
controls.minDistance = 2e-6; controls.maxDistance = 80000;
controls.enablePan = false;

const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.7, 1.0);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const vignettePass = new ShaderPass(SH.VIGNETTE_SHADER);
composer.addPass(vignettePass);

// ------------------------------------------------------------------ loading
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function tex(name, srgb = true) {
  const t = loader.load(TEX + name);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  return t;
}
const loadbar = document.querySelector('#loadbar > div'), loadtext = document.getElementById('loadtext');
manager.onProgress = (url, loaded, total) => { loadbar.style.width = `${Math.round(100 * loaded / total)}%`; loadtext.textContent = `Loading NASA imagery ${loaded}/${total}`; };
manager.onLoad = () => {
  loadbar.style.width = '100%'; loadtext.textContent = 'Ready';
  const b = document.getElementById('launch'); b.disabled = false; b.textContent = 'Begin';
  document.getElementById('launch-skip').disabled = false;
};

// ------------------------------------------------------------------ sky (Milky Way)
const skyGroup = new THREE.Group();
let starMat = null, constellations = null;
{
  const maxTex = renderer.capabilities.maxTextureSize;
  const skyTex = tex(maxTex >= 8192 ? 'stars_8k.jpg' : 'stars_4k.jpg');
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90000, 64, 32), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, color: new THREE.Color(0.8, 0.82, 0.9), depthWrite: false, fog: false }));
  sky.rotation.x = THREE.MathUtils.degToRad(-23.44); // equatorial map -> ecliptic frame
  sky.rotation.y = Math.PI;
  skyGroup.add(sky);
  // extra sparkle: a few thousand point stars with colour temperature variation
  const n = 4000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random(), v = Math.random(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), R = 80000;
    pos.set([R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph), R * Math.sin(ph) * Math.sin(th)], i * 3);
    const t = Math.random(); const c = t < 0.15 ? [0.7, 0.8, 1.0] : t < 0.7 ? [1, 1, 1] : t < 0.9 ? [1, 0.9, 0.75] : [1, 0.75, 0.6];
    col.set(c, i * 3); size[i] = 0.9 + Math.pow(Math.random(), 4) * 5.5; phase[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  starMat = new THREE.ShaderMaterial({ vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG, uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  skyGroup.add(new THREE.Points(g, starMat));
  // NASA constellation figures, drawn on the same celestial sphere. Off by default.
  constellations = new THREE.Mesh(new THREE.SphereGeometry(89000, 64, 32), new THREE.MeshBasicMaterial({ map: tex('constellations.jpg'), side: THREE.BackSide, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0.40, 0.60, 1.0) }));
  constellations.rotation.copy(sky.rotation); constellations.visible = false;
  skyGroup.add(constellations);
}
scene.add(skyGroup);

// ------------------------------------------------------------------ lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.02));
const sunLight = new THREE.PointLight(0xfff4e0, 2.2, 0, 0);
scene.add(sunLight);

// ------------------------------------------------------------------ sun
const sunGroup = new THREE.Group();
const sunMat = new THREE.ShaderMaterial({ vertexShader: SH.SUN_VERT, fragmentShader: SH.SUN_FRAG, uniforms: { uTime: { value: 0 } } });
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), sunMat);
sunGroup.add(sunMesh);
const coronaMat = new THREE.ShaderMaterial({ vertexShader: SH.SPRITE_VERT, fragmentShader: SH.CORONA_FRAG, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.72, 0.35) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), coronaMat);
sunGroup.add(corona);
const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({ vertexShader: SH.ATMO_VERT, fragmentShader: SH.GLOW_FRAG, uniforms: { uColor: { value: new THREE.Color(1.0, 0.55, 0.15) }, uPower: { value: 2.2 }, uIntensity: { value: 1.4 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
sunGroup.add(sunGlow);
function flareTexture(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad; g.fillRect(0, 0, size, size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Lens flare drawn as DOM layers (works with the multisampled composer): a soft glow on the Sun
// plus ghosts mirrored through the screen centre, fading with angle, edge distance and occlusion.
const flareLayer = document.createElement('div'); flareLayer.id = 'flare'; document.getElementById('labels').appendChild(flareLayer);
const flareElems = [
  { k: 1.0, size: 900, css: 'radial-gradient(circle, rgba(255,240,215,0.95) 0%, rgba(255,205,140,0.35) 12%, rgba(255,150,70,0.08) 32%, rgba(255,120,50,0) 62%)' },
  { k: 1.0, size: 260, css: 'radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,230,200,0.25) 30%, rgba(255,230,200,0) 70%)' },
  { k: -0.35, size: 70, css: 'radial-gradient(circle, rgba(170,205,255,0) 60%, rgba(170,205,255,0.35) 78%, rgba(170,205,255,0) 92%)' },
  { k: -0.62, size: 34, css: 'radial-gradient(circle, rgba(255,215,170,0.4) 0%, rgba(255,215,170,0.1) 45%, rgba(255,215,170,0) 70%)' },
  { k: 0.45, size: 120, css: 'radial-gradient(circle, rgba(170,205,255,0) 62%, rgba(170,205,255,0.22) 80%, rgba(170,205,255,0) 92%)' },
  { k: 1.55, size: 200, css: 'radial-gradient(circle, rgba(255,190,120,0) 55%, rgba(255,190,120,0.16) 78%, rgba(255,190,120,0) 92%)' },
  { k: 2.1, size: 60, css: 'radial-gradient(circle, rgba(255,240,220,0.35) 0%, rgba(255,240,220,0.08) 50%, rgba(255,240,220,0) 70%)' },
].map(e => { const d = document.createElement('div'); d.className = 'flare-el'; d.style.width = d.style.height = e.size + 'px'; d.style.background = e.css; flareLayer.appendChild(d); return { ...e, el: d }; });
let flareScale = 1;
function updateFlare() {
  const w = window.innerWidth, h = window.innerHeight;
  const v = tmpV.set(0, 0, 0).project(camera);
  let vis = v.z < 1 ? 1 : 0;
  const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
  if (vis) {
    const edge = Math.min(sx / w, 1 - sx / w, sy / h, 1 - sy / h);
    vis *= THREE.MathUtils.clamp(edge / 0.18 + 0.15, 0, 1);
    // occlusion by a planet in front of the Sun
    const dSun = camera.position.length();
    for (const p of PLANETS) {
      const b = byId.get(p.id); const pv = tmpV2.copy(b.pos).project(camera); if (pv.z > 1) continue;
      const px = (pv.x + 1) / 2 * w, py = (1 - pv.y) / 2 * h; const dist = camera.position.distanceTo(b.pos);
      const pr = b.radius / (dist * _fovTan()) * (h / 2);
      if (dist < dSun && Math.hypot(px - sx, py - sy) < pr) { vis = 0; break; }
    }
    // dim a little when very close to the Sun (the shader glow takes over)
    vis *= THREE.MathUtils.clamp(dSun / (sunBody.radius * 3) - 0.2, 0, 1);
    // and shrink with the disc, so from Neptune it is a brilliant star rather than a blob
    flareScale = THREE.MathUtils.clamp(0.30 + apparentPx(sunBody.radius, dSun) * 0.014, 0.30, 1.5);
  }
  flareLayer.style.opacity = (vis * 0.9).toFixed(3);
  if (!vis) return;
  const cx = w / 2, cy = h / 2;
  for (const e of flareElems) {
    const x = cx + (sx - cx) * e.k, y = cy + (sy - cy) * e.k;
    e.el.style.transform = `translate(${(x - e.size / 2).toFixed(1)}px, ${(y - e.size / 2).toFixed(1)}px) scale(${flareScale.toFixed(3)})`;
  }
}
// Marker sprite for bodies too small to resolve: a bright core, a soft bloom and
// four faint diffraction spikes, so a planet at true scale reads as a jewel rather
// than a dot. Drawn once and tinted per planet.
const haloTexture = (() => {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  const bloom = g.createRadialGradient(m, m, 0, m, m, m);
  bloom.addColorStop(0, 'rgba(255,255,255,1)');
  bloom.addColorStop(0.06, 'rgba(255,255,255,0.85)');
  bloom.addColorStop(0.16, 'rgba(255,255,255,0.32)');
  bloom.addColorStop(0.40, 'rgba(255,255,255,0.07)');
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = bloom; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (const angle of [0, Math.PI / 2]) {
    g.save(); g.translate(m, m); g.rotate(angle);
    const spike = g.createLinearGradient(-m, 0, m, 0);
    spike.addColorStop(0, 'rgba(255,255,255,0)');
    spike.addColorStop(0.42, 'rgba(255,255,255,0.20)');
    spike.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    spike.addColorStop(0.58, 'rgba(255,255,255,0.20)');
    spike.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spike; g.fillRect(-m, -1.5, S, 3);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
scene.add(sunGroup);
const sunBody = { id: 'sun', data: SUN, group: sunGroup, mesh: sunMesh, isSun: true, radius: 1, pos: new THREE.Vector3() };
bodies.push(sunBody); byId.set('sun', sunBody);
sunBody.label = makeLabel('Sun', 'sun', sunGroup, sunBody);

// ------------------------------------------------------------------ ring texture (Saturn) from real ring radii
function makeSaturnRingTexture() {
  const W = 2048, data = new Uint8Array(W * 4);
  const inner = 74500, outer = 140220;
  // [start km, end km, brightness, alpha, colour tint]
  const zones = [
    [74500, 74658, 0.18, 0.08, [0.75, 0.7, 0.62]],   // inner edge / D remnants
    [74658, 92000, 0.55, 0.28, [0.72, 0.68, 0.62]],  // C ring (dim, translucent)
    [92000, 117580, 1.0, 0.92, [0.93, 0.87, 0.74]],  // B ring (bright, dense)
    [117580, 122170, 0.35, 0.12, [0.7, 0.66, 0.6]],  // Cassini Division
    [122170, 136775, 0.8, 0.62, [0.9, 0.85, 0.73]],  // A ring
    [136775, 139380, 0.0, 0.0, [0, 0, 0]],           // gap before F
    [139380, 140220, 0.6, 0.35, [0.85, 0.85, 0.9]],  // F ring (narrow)
  ];
  const gaps = [[133589 - 162, 133589 + 162, 0.1], [136530 - 18, 136530 + 18, 0.2], [117830, 118280, 0.4], [88000, 88300, 0.5], [90200, 90500, 0.5]]; // Encke, Keeler, Huygens gap, C ring gaps
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = new Float32Array(W); let v = 0.5; for (let i = 0; i < W; i++) { v += (rnd() - 0.5) * 0.35; v = Math.min(1, Math.max(0, v * 0.92 + 0.04)); noise[i] = v; }
  for (let i = 0; i < W; i++) {
    const km = inner + (outer - inner) * (i / (W - 1));
    let b = 0, a = 0, tint = [1, 1, 1];
    for (const z of zones) if (km >= z[0] && km < z[1]) { b = z[2]; a = z[3]; tint = z[4]; const edge = Math.min(km - z[0], z[1] - km) / (z[1] - z[0]); a *= Math.min(1, 0.6 + edge * 6); }
    for (const g of gaps) if (km >= g[0] && km < g[1]) { a *= g[2]; b *= g[2] + 0.4; }
    const fine = 0.75 + 0.5 * noise[i] + 0.12 * Math.sin(km * 0.021) + 0.08 * Math.sin(km * 0.0053);
    a = Math.min(1, a * (0.7 + 0.5 * noise[i]));
    data[i * 4] = Math.min(255, b * fine * tint[0] * 255); data[i * 4 + 1] = Math.min(255, b * fine * tint[1] * 255); data[i * 4 + 2] = Math.min(255, b * fine * tint[2] * 255); data[i * 4 + 3] = a * 255;
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; return t;
}
function makeUranusRingTexture() {
  const W = 1024, data = new Uint8Array(W * 4); const inner = 41837, outer = 51149;
  const rings = [41837, 42234, 42570, 44718, 45661, 47175, 47627, 48300, 50023, 51149]; // 6,5,4,α,β,η,γ,δ,λ,ε
  for (let i = 0; i < W; i++) { const km = inner + (outer - inner) * (i / (W - 1)); let a = 0; for (const r of rings) { const w = r === 51149 ? 60 : 25; if (Math.abs(km - r) < w) a = r === 51149 ? 0.55 : 0.25; } data.set([120, 125, 135, a * 255], i * 4); }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat); t.needsUpdate = true; return t;
}
function makeUranusTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#b9e6ee'); grad.addColorStop(0.3, '#a7dbe6'); grad.addColorStop(0.5, '#9cd3e0'); grad.addColorStop(0.7, '#a5dae6'); grad.addColorStop(1, '#bfe9f0');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  for (let y = 0; y < 512; y += 2) { const a = 0.05 + 0.05 * Math.sin(y * 0.09) * Math.sin(y * 0.021); g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(0, y, 1024, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeRockTexture(base) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 400; i++) { const r = Math.random() * 6 + 1; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 128, r, 0, Math.PI * 2); g.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`; g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const saturnRingTex = makeSaturnRingTexture();

// ------------------------------------------------------------------ planet material factory
function planetMaterial(opts) {
  const u = {
    uMap: { value: opts.map }, uNight: { value: opts.night || opts.map }, uRingMap: { value: opts.ringMap || saturnRingTex },
    uHasNight: { value: opts.night ? 1 : 0 }, uOcean: { value: opts.ocean ? 1 : 0 }, uHasRingShadow: { value: opts.ringShadow ? 1 : 0 },
    uSunPos: { value: new THREE.Vector3() }, uAtmoColor: { value: new THREE.Color(opts.atmoColor ?? 0xffffff) }, uAtmo: { value: opts.atmo ?? 0 },
    uAmbient: { value: 0.035 }, uCenter: { value: new THREE.Vector3() }, uPoleAxis: { value: new THREE.Vector3(0, 1, 0) },
    uRingInner: { value: 1 }, uRingOuter: { value: 2 }, uCamPos: { value: new THREE.Vector3() }, uLightScale: { value: 1.25 },
    uWrap: { value: opts.wrap ?? 0.05 }, uSaturation: { value: opts.saturation ?? 1.12 }, uSpecular: { value: opts.specular ?? 0.12 }, uShininess: { value: opts.shininess ?? 24 },
  };
  return new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG, uniforms: u });
}
function makeAtmosphere(radius, color, intensity) {
  const m = new THREE.ShaderMaterial({ vertexShader: SH.ATMO_VERT, fragmentShader: SH.ATMO_FRAG, uniforms: { uColor: { value: new THREE.Color(color) }, uSunPos: { value: new THREE.Vector3() }, uIntensity: { value: intensity } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), m);
}

// ------------------------------------------------------------------ labels
function makeLabel(text, cls, parent, body) {
  const el = document.createElement('div'); el.className = `label ${cls}`; el.textContent = text; el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer';
  el.addEventListener('click', e => { e.stopPropagation(); selectBody(body); });
  const obj = new CSS2DObject(el); parent.add(obj); return obj;
}

// ------------------------------------------------------------------ build planets
const orbitGroup = new THREE.Group(); scene.add(orbitGroup);
const Y_UP = new THREE.Vector3(0, 1, 0);
function tiltQuaternion(tiltDeg, towardLonDeg) {
  const lon = THREE.MathUtils.degToRad(towardLonDeg);
  const d = new THREE.Vector3(Math.cos(lon), 0, -Math.sin(lon));
  const axis = new THREE.Vector3().crossVectors(Y_UP, d).normalize();
  return new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(tiltDeg));
}

for (const p of PLANETS) {
  const group = new THREE.Group();                       // heliocentric position
  const tilt = new THREE.Group(); group.add(tilt);       // axial tilt
  tilt.quaternion.copy(tiltQuaternion(p.axialTilt, p.id === 'uranus' ? 258 : 90));
  const map = p.procedural === 'uranus' ? makeUranusTexture() : tex(p.texture);
  const mat = planetMaterial({ map, night: p.nightTexture ? tex(p.nightTexture) : null, ocean: p.id === 'earth', ringShadow: !!p.rings && !p.rings.faint, atmoColor: p.atmosphere?.color, atmo: p.atmosphere ? p.atmosphere.intensity * 0.6 : 0.08, wrap: p.atmosphere ? 0.12 : 0.03, specular: p.type === 'terrestrial' ? 0.08 : 0.2, shininess: p.type === 'terrestrial' ? 16 : 40, saturation: ({ saturn: 0.88, earth: 1.12, mars: 1.15, jupiter: 1.08 })[p.id] ?? 1.04 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
  if (p.oblateness) mesh.scale.y = 1 - p.oblateness;
  tilt.add(mesh);
  const body = { id: p.id, data: p, group, tilt, mesh, mat, radius: 1, pos: new THREE.Vector3(), moons: [], parent: null };
  if (p.cloudsTexture) {
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tex(p.cloudsTexture, false), transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
    body.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 64), cm); tilt.add(body.clouds);
  }
  if (p.atmosphere) { body.atmo = makeAtmosphere(1.06, p.atmosphere.color, p.atmosphere.intensity * 0.9); tilt.add(body.atmo); }
  if (p.rings) {
    const ringTex = p.rings.faint ? makeUranusRingTexture() : saturnRingTex;
    const rm = new THREE.ShaderMaterial({ vertexShader: SH.RING_VERT, fragmentShader: SH.RING_FRAG, uniforms: { uRingMap: { value: ringTex }, uSunPos: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uPlanetRadius: { value: 1 }, uPoleAxis: { value: new THREE.Vector3(0, 1, 0) }, uInner: { value: 1 }, uOuter: { value: 2 }, uLightScale: { value: 1.2 }, uCamPos: { value: new THREE.Vector3() } }, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    body.ringInnerRatio = p.rings.innerKm / p.radiusKm; body.ringOuterRatio = p.rings.outerKm / p.radiusKm;
    const geo = new THREE.RingGeometry(body.ringInnerRatio / body.ringOuterRatio, 1, 256, 8);
    rm.uniforms.uInner.value = body.ringInnerRatio / body.ringOuterRatio; rm.uniforms.uOuter.value = 1;
    body.ring = new THREE.Mesh(geo, rm); body.ring.rotation.x = -Math.PI / 2; tilt.add(body.ring);
  }
  // orbit line
  const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(361 * 3), 3));
  const tArr = new Float32Array(361); for (let k = 0; k <= 360; k++) tArr[k] = k / 360; og.setAttribute('aT', new THREE.BufferAttribute(tArr, 1));
  body.orbit = new THREE.Line(og, new THREE.ShaderMaterial({ vertexShader: SH.TRAIL_VERT, fragmentShader: SH.TRAIL_FRAG, uniforms: { uColor: { value: new THREE.Color(p.color) }, uHead: { value: 0 }, uBase: { value: 0.14 }, uTrail: { value: 0.75 }, uFade: { value: 1 } }, transparent: true, depthWrite: false }));
  body.orbitPathAU = orbitPath(p.elements, state.jd, 360);
  body.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color: p.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false }));
  // bigger worlds get a slightly brighter marker, the way brighter stars look larger
  body.haloScale = 0.026 + 0.020 * Math.pow(p.radiusKm / 69911, 0.35);
  body.halo.scale.setScalar(body.haloScale); group.add(body.halo);
  orbitGroup.add(body.orbit);
  body.label = makeLabel(p.name, 'planet', group, body);
  scene.add(group); bodies.push(body); byId.set(p.id, body);
  // moons
  for (const s of (p.satellites || [])) {
    const pivot = new THREE.Group(); tilt.add(pivot);
    pivot.rotation.x = THREE.MathUtils.degToRad(s.inclination > 90 ? 180 - s.inclination : s.inclination) * (s.inclination > 90 ? -1 : 1);
    const holder = new THREE.Group(); pivot.add(holder);
    let mmesh;
    if (s.texture) {
      const mm = planetMaterial({ map: tex(s.texture), atmoColor: s.atmosphere?.color, atmo: s.atmosphere ? s.atmosphere.intensity * 0.6 : 0.05 });
      mmesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mm);
    } else {
      const g = new THREE.IcosahedronGeometry(1, 5); const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); const k = 1 + 0.18 * Math.sin(v.x * 5.1) * Math.cos(v.y * 4.3) + 0.12 * Math.sin(v.z * 7.7 + 1.3); v.multiplyScalar(k); pa.setXYZ(i, v.x, v.y, v.z); }
      g.computeVertexNormals();
      mmesh = new THREE.Mesh(g, planetMaterial({ map: makeRockTexture('#' + (s.color || 0x888888).toString(16).padStart(6, '0')), atmo: 0.02 }));
    }
    holder.add(mmesh);
    const orbitG = new THREE.BufferGeometry(); const pts = []; for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2; pts.push(Math.cos(a), 0, Math.sin(a)); }
    orbitG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const morbit = new THREE.Line(orbitG, new THREE.LineBasicMaterial({ color: 0x9aa7c7, transparent: true, opacity: 0.16 })); pivot.add(morbit);
    const moon = { id: s.id, data: s, parent: body, pivot, holder, mesh: mmesh, mat: mmesh.material, orbit: morbit, isMoon: true, radius: 1, pos: new THREE.Vector3(), phase: Math.random() * Math.PI * 2 };
    if (s.atmosphere) { moon.atmo = makeAtmosphere(1.05, s.atmosphere.color, s.atmosphere.intensity); mmesh.add(moon.atmo); }
    moon.label = makeLabel(s.name, 'moon', holder, moon);
    body.moons.push(moon); bodies.push(moon); byId.set(s.id, moon);
  }
}

// ------------------------------------------------------------------ comets
const comets = [];
for (const c of COMETS) {
  const group = new THREE.Group();
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfefff }));
  group.add(nucleus);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0xbfe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(glow);
  const n = 900, t = new Float32Array(n), spread = new Float32Array(n), seed = new Float32Array(n), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { t[i] = Math.pow(Math.random(), 1.4); spread[i] = Math.random(); seed[i] = Math.random(); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('aT', new THREE.BufferAttribute(t, 1)); tg.setAttribute('aSpread', new THREE.BufferAttribute(spread, 1)); tg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const tm = new THREE.ShaderMaterial({ vertexShader: SH.TAIL_VERT, fragmentShader: SH.TAIL_FRAG, uniforms: { uHead: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(1, 0, 0) }, uLength: { value: 10 }, uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() }, uWidth: { value: 1 }, uColor: { value: new THREE.Color(0x9fd0ff) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const tail = new THREE.Points(tg, tm); tail.frustumCulled = false; scene.add(tail);
  const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(721 * 3), 3));
  const tArr = new Float32Array(721); for (let k = 0; k <= 720; k++) tArr[k] = k / 720; og.setAttribute('aT', new THREE.BufferAttribute(tArr, 1));
  const orbit = new THREE.Line(og, new THREE.ShaderMaterial({ vertexShader: SH.TRAIL_VERT, fragmentShader: SH.TRAIL_FRAG, uniforms: { uColor: { value: new THREE.Color(c.color) }, uHead: { value: 0 }, uBase: { value: 0.1 }, uTrail: { value: 0.7 }, uFade: { value: 1 } }, transparent: true, depthWrite: false })); orbitGroup.add(orbit);
  const body = { id: c.id, data: c, group, mesh: nucleus, glow, tail, orbit, orbitPathAU: cometPath(c, 720), isComet: true, radius: 1, pos: new THREE.Vector3() };
  body.label = makeLabel(c.name, 'comet', group, body);
  scene.add(group); comets.push(body); bodies.push(body); byId.set(c.id, body);
}
function makeGlowSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(200,225,255,0.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ belts
const belts = [];
function makeBelt(count, aMin, aMax, inclDeg, color, sizeMul) {
  const a = new Float32Array(count), ph = new Float32Array(count), inc = new Float32Array(count), node = new Float32Array(count), sz = new Float32Array(count), ecc = new Float32Array(count), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    a[i] = aMin + (aMax - aMin) * (0.5 + 0.5 * (Math.random() + Math.random() - 1)) ; ph[i] = Math.random() * Math.PI * 2;
    inc[i] = (Math.random() + Math.random() - 1) * THREE.MathUtils.degToRad(inclDeg); node[i] = Math.random() * Math.PI * 2; sz[i] = (0.3 + Math.pow(Math.random(), 3) * 1.2) * sizeMul; ecc[i] = Math.random() * 0.15;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(a, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1)); g.setAttribute('aIncl', new THREE.BufferAttribute(inc, 1)); g.setAttribute('aNode', new THREE.BufferAttribute(node, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aEcc', new THREE.BufferAttribute(ecc, 1));
  const m = new THREE.ShaderMaterial({ vertexShader: SH.BELT_VERT, fragmentShader: SH.BELT_FRAG, uniforms: { uDays: { value: 0 }, uAuScale: { value: AU_SCALE }, uPixelRatio: { value: renderer.getPixelRatio() }, uColor: { value: new THREE.Color(color) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); belts.push(pts); return pts;
}
makeBelt(9000, 2.1, 3.35, 12, 0xc9b79a, 0.7);   // main asteroid belt
makeBelt(12000, 30, 50, 10, 0x8fb4d9, 0.5);     // Kuiper belt
makeBelt(600, 5.05, 5.35, 8, 0xd4c2a3, 0.6);    // Jupiter trojans (approximate: spread along the orbit)

// ------------------------------------------------------------------ helpers
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function jdHoursSinceJ2000(jd) { return (jd - J2000_JD) * 24; }

// ---------------------------------------------------------------- calm rotation
//
// Rotation periods in this model span 762x, from Phobos at 7.6 hours to Venus at
// 5832. Tie spin to the simulation clock and no single rate works: run it fast
// enough for Venus to move and Jupiter becomes a blur; slow enough for Jupiter and
// everything else is frozen. At the old default the Earth turned 1.5 times a
// second, which read as a glitch rather than a planet.
//
// So spin is decoupled from the simulation clock and every period is compressed
// into a narrow, calm band by a fourth-power-ish root. Ordering is preserved
// (Jupiter still visibly outruns Venus) and the band is anchored on the SLOWEST
// body: Venus completes a turn in about seven minutes instead of forty-six hours,
// so even it reads as turning. Orbital positions of the planets are untouched and
// stay truthful; the panels keep reporting real day lengths.
const SPIN_SLOWEST_TURN = 415;   // seconds for the slowest body to turn once
const SPIN_FASTEST_TURN = 110;   // seconds for the fastest body to turn once
const SPIN_PERIODS = (() => {
  const all = [Math.abs(SUN.rotationHours)];
  for (const p of PLANETS) {
    all.push(Math.abs(p.rotationHours));
    for (const sat of (p.satellites || [])) all.push(Math.abs(sat.periodDays) * 24);
  }
  return { min: Math.min(...all), max: Math.max(...all) };
})();
// exponent that maps the real period range onto the chosen visual range
const SPIN_EXP = Math.log(SPIN_SLOWEST_TURN / SPIN_FASTEST_TURN) / Math.log(SPIN_PERIODS.max / SPIN_PERIODS.min);

/** Seconds of real time for one visible turn of a body whose true period is `hours`. */
function visualTurnSeconds(hours) {
  return SPIN_FASTEST_TURN * Math.pow(Math.abs(hours) / SPIN_PERIODS.min, SPIN_EXP);
}
/** Current spin angle for a body, signed so retrograde worlds still turn backwards. */
function calmSpin(hours) {
  return Math.sign(hours || 1) * 2 * Math.PI * state.spinClock / visualTurnSeconds(hours);
}
function syncSpinEpoch() { state.spinEpochJD = state.jd; state.spinClock = 0; }

function updateOrbitLine(body) {
  const arr = body.orbit.geometry.attributes.position.array;
  for (let k = 0; k < body.orbitPathAU.length; k++) { toScene(body.orbitPathAU[k], tmpV); arr[k * 3] = tmpV.x; arr[k * 3 + 1] = tmpV.y; arr[k * 3 + 2] = tmpV.z; }
  body.orbit.geometry.attributes.position.needsUpdate = true;
  body.orbit.geometry.computeBoundingSphere();
}
const _fovTan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
function apparentPx(radius, dist) { return radius / (dist * _fovTan()) * (window.innerHeight / 2); }
function updateHalo(b) {
  // Glowing marker that keeps a world visible when it is only a pixel or two wide.
  // It fades AND shrinks as the disc grows, so the handover feels like focusing.
  const dist = camera.position.distanceTo(b.pos);
  const px = apparentPx(b.radius, dist);
  const o = THREE.MathUtils.clamp((16 - px) / 11, 0, 1);
  b.halo.material.opacity = o * 0.95;
  b.halo.scale.setScalar(b.haloScale * (0.55 + 0.45 * o));
  b.halo.visible = o > 0.01;
}

function updateWorld(dtSim) {
  const jd = state.jd;
  const hours = jdHoursSinceJ2000(jd);
  // orbit lines fade away while the camera is close to a world
  let orbitFade = state.orbitIntro;
  if (state.follow && !state.follow.isSun) { const f = state.follow.isMoon ? state.follow.parent : state.follow; const d = camera.position.distanceTo(f.pos); orbitFade *= THREE.MathUtils.clamp((d / (f.radius * 10) - 0.6), 0.12, 1); }
  // sun
  const sunR = bodyRadiusScene(SUN.radiusKm);
  sunBody.radius = sunR; sunMesh.scale.setScalar(sunR); corona.scale.setScalar(sunR * 5.0); sunGlow.scale.setScalar(sunR * 1.22);
  sunMesh.rotation.y = state.calmRotation ? calmSpin(SUN.rotationHours) : 2 * Math.PI * hours / SUN.rotationHours;
  corona.quaternion.copy(camera.quaternion);
  // planets
  for (const p of PLANETS) {
    const b = byId.get(p.id);
    const posAU = planetPosition(p.elements, jd);
    toScene(posAU, b.group.position);
    b.pos.copy(b.group.position); b.posAU = posAU;
    const r = bodyRadiusScene(p.radiusKm); b.radius = r;
    b.mesh.scale.set(r, r * (1 - (p.oblateness || 0)), r);
    // clouds run slightly ahead of the surface so the weather visibly drifts
    if (b.clouds) { b.clouds.scale.setScalar(r * 1.008); b.clouds.rotation.y = state.calmRotation ? calmSpin(p.rotationHours) * 1.07 : 2 * Math.PI * hours / (p.rotationHours * 0.96); }
    if (b.atmo) b.atmo.scale.setScalar(r * 1.06);
    // spin (Earth is aligned so the sub-solar longitude matches UTC time)
    if (p.id === 'earth') {
      const sunDir = tmpV.copy(b.pos).negate().normalize();
      const alpha = Math.atan2(-sunDir.z, sunDir.x);
      // The terminator is set from real UTC, so the daylit face is correct on arrival.
      // Under calm rotation it then drifts on the compressed clock rather than the
      // simulation clock, which is what used to spin it into a blur.
      const anchor = state.calmRotation ? jdToDate(state.spinEpochJD) : jdToDate(jd);
      const utcH = anchor.getUTCHours() + anchor.getUTCMinutes() / 60 + anchor.getUTCSeconds() / 3600;
      const subsolar = THREE.MathUtils.degToRad((12 - utcH) * 15);
      b.mesh.rotation.y = alpha - subsolar + (state.calmRotation ? calmSpin(p.rotationHours) : 0);
    } else b.mesh.rotation.y = state.calmRotation ? calmSpin(p.rotationHours) : 2 * Math.PI * hours / p.rotationHours;
    // ring
    if (b.ring) {
      const ri = r * b.ringInnerRatio, ro = r * b.ringOuterRatio;
      b.ring.scale.set(ro, ro, 1);
      const u = b.ring.material.uniforms; u.uCenter.value.copy(b.pos); u.uPlanetRadius.value = r;
      b.tilt.getWorldQuaternion(tmpQ); u.uPoleAxis.value.set(0, 1, 0).applyQuaternion(tmpQ);
      const pu = b.mat.uniforms; pu.uCenter.value.copy(b.pos); pu.uPoleAxis.value.copy(u.uPoleAxis.value); pu.uRingInner.value = ri; pu.uRingOuter.value = ro;
    }
    b.orbit.material.uniforms.uHead.value = posAU.phase;
    b.orbit.material.uniforms.uFade.value = orbitFade;
    updateHalo(b);
    // moons
    for (const m of b.moons) {
      const s = m.data; const d = moonDistanceScene(s); const mr = bodyRadiusScene(s.radiusKm); m.radius = mr;
      const ang = m.phase + (state.calmRotation ? calmSpin(s.periodDays * 24) : 2 * Math.PI * (jd - J2000_JD) / s.periodDays);
      m.holder.position.set(Math.cos(ang) * d, 0, -Math.sin(ang) * d);
      m.mesh.scale.setScalar(mr); if (m.atmo) m.atmo.scale.setScalar(1.05);
      m.mesh.rotation.y = s.tidallyLocked !== false ? ang + Math.PI : (state.calmRotation ? calmSpin(24) : 2 * Math.PI * hours / 24);
      m.orbit.scale.setScalar(d); m.orbitRadius = d;
      m.holder.getWorldPosition(m.pos);
    }
  }
  // comets
  for (const c of comets) {
    const posAU = cometPosition(c.data, jd); toScene(posAU, c.group.position); c.pos.copy(c.group.position); c.posAU = posAU;
    const rAU = Math.hypot(posAU.x, posAU.y, posAU.z);
    const nr = Math.max(bodyRadiusScene(8), 0.02); c.radius = nr * 3; c.mesh.scale.setScalar(nr);
    const activity = THREE.MathUtils.clamp(1.6 / (rAU * rAU), 0, 1);
    c.glow.scale.setScalar(nr * (6 + 40 * activity)); c.glow.material.opacity = 0.35 + 0.65 * activity;
    const u = c.tail.material.uniforms; u.uHead.value.copy(c.pos); u.uDir.value.copy(c.pos).normalize(); u.uLength.value = AU_SCALE * 0.33 * activity + 0.3; u.uWidth.value = 0.12 * u.uLength.value; u.uTime.value = clock.elapsedTime;
    c.tail.visible = activity > 0.02;
    c.orbit.material.uniforms.uHead.value = posAU.phase; c.orbit.material.uniforms.uFade.value = orbitFade;
  }
  for (const b of belts) b.material.uniforms.uDays.value = jd - J2000_JD;
  // shader uniforms shared
  for (const b of bodies) {
    if (b.mat) { b.mat.uniforms.uSunPos.value.set(0, 0, 0); b.mat.uniforms.uCamPos.value.copy(camera.position); }
    if (b.atmo) b.atmo.material.uniforms.uSunPos.value.set(0, 0, 0);
    if (b.ring) b.ring.material.uniforms.uCamPos.value.copy(camera.position);
  }
  sunMat.uniforms.uTime.value = clock.elapsedTime; coronaMat.uniforms.uTime.value = clock.elapsedTime; vignettePass.uniforms.uTime.value = clock.elapsedTime % 100;
}

// ------------------------------------------------------------------ camera / selection
const fly = { active: false, t: 0, dur: 1.8, fromOff: new THREE.Vector3(), toOff: new THREE.Vector3(), fromTarget: new THREE.Vector3(), body: null };
const followOffset = new THREE.Vector3();
function worldPos(body) { if (body.isMoon) { body.holder.getWorldPosition(tmpV2); return tmpV2; } return tmpV2.copy(body.pos); }
function viewDistance(body) { return Math.max(body.radius * (body.isSun ? 3.2 : body.ring ? 5.5 : 4.2), 4e-6); }

function selectBody(body, { fly: doFly = true } = {}) {
  state.selected = body; state.follow = body;
  document.querySelectorAll('#planetnav button').forEach(b => b.classList.toggle('active', b.dataset.id === body.id || (body.isMoon && b.dataset.id === body.parent.id)));
  showPanel(body);
  const degree = body.isSun ? 0 : body.isMoon ? 6 : Math.max(0, PLANETS.findIndex(p => p.id === body.id)) % CHIME_SCALE.length;
  soundtrack.chime(CHIME_SCALE[degree] * (body.isSun ? 0.5 : 1));
  location.hash = body.id;
  if (doFly) {
    const target = worldPos(body).clone();
    fly.body = body; fly.active = true; fly.t = 0;
    fly.fromOff.copy(camera.position).sub(controls.target); fly.fromTarget.copy(controls.target);
    const dir = camera.position.clone().sub(target); if (dir.lengthSq() < 1e-8) dir.set(1, 0.4, 1);
    dir.normalize();
    if (!body.isSun) { // approach from the sunlit side so the world is never seen as a dark disc
      const sunward = target.clone().negate().normalize();
      dir.multiplyScalar(0.35).addScaledVector(sunward, 0.75).normalize();
    }
    dir.y = Math.max(dir.y, 0.18); dir.normalize();
    fly.toOff.copy(dir.multiplyScalar(viewDistance(body)));
  }
}
function deselect() {
  state.selected = null; hidePanel();
  document.querySelectorAll('#planetnav button').forEach(b => b.classList.remove('active'));
  history.replaceState(null, '', location.pathname + location.search);
}
function updateCamera(dt) {
  if (fly.active) {
    fly.t = Math.min(1, fly.t + dt / fly.dur);
    const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;
    const target = worldPos(fly.body).clone();
    const t = fly.fromTarget.clone().lerp(target, e);
    // interpolate offsets logarithmically in length for smooth zooms across scales
    const l0 = fly.fromOff.length(), l1 = fly.toOff.length(); const len = Math.exp(THREE.MathUtils.lerp(Math.log(l0), Math.log(l1), e));
    const off = fly.fromOff.clone().normalize().lerp(fly.toOff.clone().normalize(), e).normalize().multiplyScalar(len);
    controls.target.copy(t); camera.position.copy(t).add(off);
    if (fly.t >= 1) { fly.active = false; followOffset.copy(camera.position).sub(controls.target); }
  } else if (state.follow) {
    const target = worldPos(state.follow);
    const delta = target.clone().sub(controls.target);
    camera.position.add(delta); controls.target.copy(target);
  }
  controls.update();
  // near plane tuning by distance to target
  const d = camera.position.distanceTo(controls.target);
  camera.near = Math.max(1e-9, d * 0.0015); camera.far = 400000; camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ picking (screen-space, robust for tiny bodies)
const ndc = new THREE.Vector2();
function pickAt(clientX, clientY) {
  const w = window.innerWidth, h = window.innerHeight; let best = null, bestD = 1e9;
  for (const b of bodies) {
    if (b.isMoon && !state.showMoons) continue;
    if (b.isMoon && b.label.element.classList.contains('hidden')) continue;
    const wp = worldPos(b).clone(); const v = wp.project(camera); if (v.z > 1) continue;
    const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
    const dist = camera.position.distanceTo(wp); const pr = b.radius / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (h / 2);
    const tol = Math.max(16, pr); const d = Math.hypot(sx - clientX, sy - clientY);
    if (d < tol && d - pr * 0.5 < bestD) { best = b; bestD = d - pr * 0.5; }
  }
  return best;
}
let downPos = null;
renderer.domElement.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downPos) return; const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]); downPos = null; if (moved > 6) return;
  const b = pickAt(e.clientX, e.clientY); if (b) selectBody(b);
});
const tip = document.getElementById('tip');
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const b = pickAt(e.clientX, e.clientY); state.hover = b;
  renderer.domElement.style.cursor = b ? 'pointer' : 'grab';
  if (b) { tip.textContent = b.data.name; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.style.opacity = 1; } else tip.style.opacity = 0;
});

// ------------------------------------------------------------------ info panel
const panel = document.getElementById('panel'), pBody = document.getElementById('p-body');
const fmt = (n, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });
function lightTime(km) { const s = km / C_KM_S; if (s < 90) return `${fmt(s, 1)} s`; if (s < 5400) return `${fmt(s / 60, 1)} min`; return `${fmt(s / 3600, 2)} h`; }
function stat(k, v, cls = '') { return `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`; }
function yearDays(body) { if (body.isSun) return null; if (body.isMoon) return null; if (body.isComet) return body.data.periodYears * 365.25; return 365.25 * Math.pow(body.data.elements.a, 1.5); }
function showPanel(body) {
  const d = body.data; const type = body.isSun ? 'Star · G2V' : body.isMoon ? `Moon of ${body.parent.data.name}` : body.isComet ? 'Periodic comet' : d.type;
  document.getElementById('p-type').textContent = type; document.getElementById('p-name').textContent = d.name;
  let html = `<p class="desc">${d.description}</p>`;
  if (d.liveImage) html += `<div class="live"><img id="live-sun" src="${d.liveImage}?t=${Date.now()}" alt="Live image of the Sun from NASA SDO" onerror="this.parentElement.style.display='none'"/><div class="cap">Live: the Sun as NASA's Solar Dynamics Observatory sees it right now (extreme ultraviolet, 304 Å)</div></div>`;
  html += `<div class="stats" id="p-stats"></div>`;
  if (d.facts && d.facts.length) html += `<h3>Did you know</h3><ul class="facts">${d.facts.map(f => `<li>${f}</li>`).join('')}</ul>`;
  if (!body.isSun && !body.isComet) {
    html += `<h3>You, on ${d.name}</h3><div class="you" id="you"></div>`;
  }
  if (body.moons && body.moons.length) html += `<h3>Moons in this model</h3><div class="moonlist">${body.moons.map(m => `<button data-id="${m.id}">${m.data.name}</button>`).join('')}</div>`;
  if (body.isMoon) html += `<h3>Orbits</h3><div class="moonlist"><button data-id="${body.parent.id}">← ${body.parent.data.name}</button></div>`;
  if (d.credit) html += `<div class="credit">Imagery: ${d.credit.text}${d.credit.url ? ` · <a href="${d.credit.url}" target="_blank" rel="noopener">source</a>` : ''}</div>`;
  pBody.innerHTML = html; pBody.scrollTop = 0;
  pBody.querySelectorAll('.moonlist button').forEach(b => b.addEventListener('click', () => selectBody(byId.get(b.dataset.id))));
  panel.classList.add('open');
  renderYou(body); updateLiveStats(body);
}
function hidePanel() { panel.classList.remove('open'); }
document.getElementById('p-close').addEventListener('click', () => { deselect(); });

function renderYou(body) {
  const el = document.getElementById('you'); if (!el) return; const d = body.data;
  const weight = parseFloat(localStorage.getItem('ss_weight') || '70'); const bday = localStorage.getItem('ss_bday') || '';
  const g = d.gravity; const yd = body.isMoon ? null : yearDays(body);
  const here = weight * g / 9.807;
  // Phobos pulls at 0.0057 m/s2, so one decimal place would just read "0 kg"
  let rows = `<div class="row"><span>Your weight here (${fmt(weight)} kg on Earth)</span><b>${fmt(here, here < 1 ? 3 : here < 10 ? 2 : 1)} kg</b></div>`;
  if (yd) {
    let ageTxt = '—', nextTxt = '';
    if (bday) { const ms = Date.now() - new Date(bday).getTime(); const days = ms / 86400000; ageTxt = fmt(days / yd, 2) + ` ${d.name} years`; const next = Math.ceil(days / yd) * yd; const nd = new Date(new Date(bday).getTime() + next * 86400000); nextTxt = `Next ${d.name} birthday: ${nd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`; }
    rows += `<div class="row"><span>Your age here</span><b>${ageTxt}</b></div>`;
    if (nextTxt) rows += `<div class="note">${nextTxt}</div>`;
  }
  rows += `<div class="row" style="gap:8px;margin-top:6px"><input type="date" id="you-bday" value="${bday}" title="Your birthday"/><input type="number" id="you-weight" value="${weight}" min="1" max="500" style="width:70px" title="Your weight in kg"/><span style="font-size:11px;color:var(--muted)">kg</span></div>`;
  const dayH = body.isMoon ? Math.abs(d.periodDays) * 24 : Math.abs(d.dayLengthHours || d.rotationHours || 24);
  rows += `<div class="note">A day here lasts ${fmt(dayH, 1)} h${yd ? `, a year ${fmt(yd, 1)} Earth days` : ''}. Stored only in your browser.</div>`;
  el.innerHTML = rows;
  el.querySelector('#you-bday').addEventListener('change', e => { localStorage.setItem('ss_bday', e.target.value); renderYou(body); });
  el.querySelector('#you-weight').addEventListener('change', e => { localStorage.setItem('ss_weight', e.target.value); renderYou(body); });
}
let statsTimer = 0;
function updateLiveStats(body) {
  const el = document.getElementById('p-stats'); if (!el) return; const d = body.data;
  const earth = byId.get('earth'); let html = '';
  if (body.isSun) {
    const de = Math.hypot(earth.posAU.x, earth.posAU.y, earth.posAU.z) * AU_KM;
    html += stat('Distance from Earth now', `${fmt(de / 1e6, 2)}<small>million km</small>`, 'live') + stat('Light travel time to you', lightTime(de), 'live');
    html += stat('Radius', `${fmt(d.radiusKm)}<small>km</small>`) + stat('Surface gravity', `${fmt(d.gravity, 1)}<small>m/s²</small>`) + stat('Surface temperature', `${fmt(d.tempK - 273)}<small>°C</small>`) + stat('Rotation (equator)', `${fmt(d.rotationHours / 24, 1)}<small>days</small>`) + stat('Mass', `1.989 × 10³⁰<small>kg</small>`) + stat('Age', `4.6<small>billion yrs</small>`);
  } else {
    const p = body.isMoon ? body.parent : body; const pa = p.posAU; const rs = Math.hypot(pa.x, pa.y, pa.z);
    const ea = earth.posAU; const de = Math.hypot(pa.x - ea.x, pa.y - ea.y, pa.z - ea.z);
    if (body.id !== 'earth') { html += stat('Distance from Sun now', `${fmt(rs, 3)}<small>AU</small>`, 'live') + stat('Distance from Earth now', `${fmt(de * AU_KM / 1e6, 1)}<small>million km</small>`, 'live') + stat('Light travel time from Sun', lightTime(rs * AU_KM), 'live') + stat('Radio signal to Earth', lightTime(de * AU_KM), 'live'); }
    else { html += stat('Distance from Sun now', `${fmt(rs * AU_KM / 1e6, 2)}<small>million km</small>`, 'live') + stat('Sunlight is', `${lightTime(rs * AU_KM)}<small>old</small>`, 'live'); }
    if (body.isMoon) html += stat('Distance from ' + p.data.name, `${fmt(d.distanceKm)}<small>km</small>`) + stat('Orbital period', `${fmt(Math.abs(d.periodDays), 2)}<small>days</small>`);
    html += stat('Radius', `${fmt(d.radiusKm)}<small>km</small>`);
    if (d.gravity) html += stat('Gravity', `${fmt(d.gravity, 2)}<small>m/s²</small>`);
    if (d.dayLengthHours) html += stat('Day length', `${fmt(d.dayLengthHours, 1)}<small>hours</small>`);
    const yd = yearDays(body); if (yd) html += stat('Year length', yd > 800 ? `${fmt(yd / 365.25, 1)}<small>Earth years</small>` : `${fmt(yd, 1)}<small>Earth days</small>`);
    if (d.tempK) html += stat('Mean temperature', `${fmt(d.tempK - 273)}<small>°C</small>`);
    if (d.moons !== undefined) html += stat('Known moons', `${d.moons}`);
    if (d.axialTilt !== undefined) html += stat('Axial tilt', `${fmt(d.axialTilt, 1)}<small>°</small>`);
    if (body.isComet) html += stat('Orbital period', `${fmt(d.periodYears, 1)}<small>years</small>`) + stat('Next perihelion', `28 Jul 2061`);
  }
  el.innerHTML = html;
}

// ------------------------------------------------------------------ UI wiring
const nav = document.getElementById('planetnav');
for (const id of KEYBOARD_ORDER) {
  const b = byId.get(id); const btn = document.createElement('button'); btn.dataset.id = id;
  btn.innerHTML = `<span class="dot" style="color:#${(id === 'sun' ? 0xffb347 : b.data.color).toString(16).padStart(6, '0')};background:currentColor"></span><span class="txt">${b.data.name}</span>`;
  btn.addEventListener('click', () => selectBody(b)); nav.appendChild(btn);
}
{ const b = byId.get('halley'); const btn = document.createElement('button'); btn.dataset.id = 'halley'; btn.innerHTML = `<span class="dot" style="color:#cfe8ff;background:currentColor"></span><span class="txt">Halley</span>`; btn.addEventListener('click', () => selectBody(b)); nav.appendChild(btn); }

const speedLabel = document.getElementById('t-label'), speedSlider = document.getElementById('t-speed'), pauseBtn = document.getElementById('t-pause');
function speedText() {
  if (state.paused) return 'Paused';
  const s = speedSeconds(); if (s < 1.5) return 'Real time'; if (s < 90) return `${fmt(s)} s / s`; if (s < 5400) return `${fmt(s / 60)} min / s`; if (s < 129600) return `${fmt(s / 3600, 1)} h / s`; if (s < 86400 * 60) return `${fmt(s / 86400, 1)} days / s`; if (s < 86400 * 365.25 * 1.5) return `${fmt(s / 86400 / 30.44, 1)} months / s`; return `${fmt(s / 86400 / 365.25, 1)} years / s`;
}
function refreshSpeedUI() { speedLabel.textContent = speedText(); speedSlider.value = state.speedExp; pauseBtn.textContent = state.paused ? '▶' : '❚❚'; }
speedSlider.addEventListener('input', e => { state.speedExp = parseFloat(e.target.value); state.paused = false; refreshSpeedUI(); });
pauseBtn.addEventListener('click', () => { state.paused = !state.paused; refreshSpeedUI(); });
document.getElementById('t-back').addEventListener('click', () => { state.speedExp = Math.max(0, state.speedExp - 1); state.paused = false; refreshSpeedUI(); });
document.getElementById('t-fwd').addEventListener('click', () => { state.speedExp = Math.min(10, state.speedExp + 1); state.paused = false; refreshSpeedUI(); });
document.getElementById('t-now').addEventListener('click', () => { state.jd = dateToJD(new Date()); syncSpinEpoch(); toast('Jumped to the present moment'); });
refreshSpeedUI();

const settings = document.getElementById('settings');
document.getElementById('btn-settings').addEventListener('click', e => { settings.classList.toggle('open'); e.currentTarget.classList.toggle('active', settings.classList.contains('open')); });
document.getElementById('btn-full').addEventListener('click', () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); });
const bind = (id, fn) => document.getElementById(id).addEventListener('change', e => fn(e.target.checked ?? e.target.value, e));
bind('opt-orbits', v => { state.showOrbits = v; orbitGroup.visible = v; });
orbitGroup.visible = state.showOrbits;
bind('opt-labels', v => { state.showLabels = v; labelRenderer.domElement.style.display = v ? '' : 'none'; });
bind('opt-belts', v => { state.showBelts = v; belts.forEach(b => b.visible = v); });
bind('opt-moons', v => { state.showMoons = v; for (const b of bodies) if (b.isMoon) b.pivot.visible = v; });
bind('opt-bloom', v => { state.bloom = v; bloomPass.enabled = v; });
bind('opt-constellations', v => { if (constellations) constellations.visible = v; });
bind('opt-calm', v => {
  state.calmRotation = v;
  if (v) syncSpinEpoch();
  toast(v ? 'Calm rotation: every world turns on a slow, even clock.' : 'True rotation: spin follows the simulation clock, so fast worlds blur at high speed.');
});
document.getElementById('opt-volume').addEventListener('input', e => soundtrack.setVolume(parseFloat(e.target.value)));
// music
const soundtrack = new Soundtrack();
const musicBtn = document.getElementById('btn-music');
function setMusic(on) { if (on) soundtrack.start(); else soundtrack.stop(); musicBtn.classList.toggle('active', on); musicBtn.title = on ? 'Music on (M)' : 'Music off (M)'; }
musicBtn.addEventListener('click', () => setMusic(!soundtrack.playing));

// toast
let toastTimer; function toast(msg, ms = 3800) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

// keyboard
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key;
  if (k >= '0' && k <= '9') { const id = KEYBOARD_ORDER[parseInt(k)]; if (id) selectBody(byId.get(id)); }
  else if (k === ' ') { e.preventDefault(); state.paused = !state.paused; refreshSpeedUI(); }
  else if (k === 'Escape') { deselect(); state.follow = null; }
  else if (k.toLowerCase() === 'm') setMusic(!soundtrack.playing);
  else if (k.toLowerCase() === 'f') document.getElementById('btn-full').click();
  else if (k === '[') document.getElementById('t-back').click();
  else if (k === ']') document.getElementById('t-fwd').click();
  else if (k.toLowerCase() === 'h') selectBody(byId.get('halley'));
  else if (k.toLowerCase() === 'n') document.getElementById('t-now').click();
  else if (k.toLowerCase() === 'r') { runIntro(); }
  else if (k.toLowerCase() === 'c') { const cb = document.getElementById('opt-constellations'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  else if (k.toLowerCase() === 'o') { const cb = document.getElementById('opt-orbits'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  else if (k === '?') toast('0-9 worlds · H Halley · R replay the opening · O orbit lines · C constellations · Space pause · [ ] speed · N now · M music · F fullscreen', 7000);
});

// ------------------------------------------------------------------ cinematic
const cinematic = new Cinematic({
  camera, controls, byId, sunBody, AU_SCALE, soundtrack,
  onEnd: (skipped) => {
    document.body.classList.remove('cinematic');
    followOffset.copy(camera.position).sub(controls.target);
    if (!skipped) toast('Click any world. Press H for Halley\'s Comet, O for orbit lines, ? for the keys.', 6000);
  },
});
function runCinematic() {
  state.follow = null; fly.active = false; state.orbitIntro = 0;
  document.body.classList.add('cinematic');
  // start the camera at the Sun so the first frame is already inside the glow
  camera.position.set(0, sunBody.radius * 0.8, sunBody.radius * 2.6);
  controls.target.set(0, 0, 0);
  cinematic.start();
}

/** A sensible wide view of the inner system: where the opening leaves you. */
function restingView() {
  const dir = new THREE.Vector3(0.18, 0.46, 1).normalize();
  controls.target.set(0, 0, 0);
  camera.position.copy(dir).multiplyScalar(AU_SCALE * 11);
  controls.update();
  followOffset.copy(camera.position).sub(controls.target);
}

/** Hand control to the viewer, from wherever the intro was interrupted. */
function endIntro({ reposition = false } = {}) {
  document.body.classList.remove('cinematic');
  document.getElementById('skip').classList.remove('show');
  state.orbitIntro = 1;
  soundtrack.setIntensity(0.58, 6);
  if (reposition) restingView();
}

// The crawl, then the flight. Either can be cut short with Esc or the skip button.
async function runIntro() {
  deselect();
  state.follow = null; fly.active = false; state.orbitIntro = 0;
  document.body.classList.add('cinematic');
  // Park on the galaxy for the crawl. The Sun would wash the text out.
  camera.position.set(-AU_SCALE * 42, AU_SCALE * 26, AU_SCALE * 58);
  controls.target.set(0, 0, 0);
  controls.update();
  const skipped = await playCrawl({ root: document.getElementById('crawl'), skipBtn: document.getElementById('skip') });
  if (skipped) { endIntro({ reposition: true }); return; }
  runCinematic();
}

// splash / launch
const startHash = () => { const h = location.hash.slice(1); return h && byId.has(h) ? h : null; };
document.getElementById('launch').addEventListener('click', () => {
  document.body.classList.remove('pre-launch');
  document.getElementById('splash').classList.add('fade');
  setMusic(true);
  const h = startHash();
  if (h) { soundtrack.setIntensity(0.58, 8); selectBody(byId.get(h)); }
  else runIntro();
});
document.getElementById('launch-skip').addEventListener('click', () => {
  document.body.classList.remove('pre-launch');
  document.getElementById('splash').classList.add('fade');
  setMusic(true);
  soundtrack.setIntensity(0.58, 8);
  const h = startHash();
  if (h) selectBody(byId.get(h));
  else { restingView(); toast('Click any world. Press R for the opening, O for orbit lines, ? for the keys.', 6500); }
});
document.getElementById('btn-replay').addEventListener('click', () => { runIntro(); });

// clock display
const clockDate = document.querySelector('#clock .date'), clockSpeed = document.querySelector('#clock .speed');
function refreshClock() {
  const d = jdToDate(state.jd);
  clockDate.textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  clockSpeed.textContent = speedText();
}

// ------------------------------------------------------------------ resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); bloomPass.setSize(window.innerWidth, window.innerHeight); labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ label visibility
function updateLabels() {
  const camPos = camera.position, w = window.innerWidth, h = window.innerHeight;
  const candidates = [];
  for (const b of bodies) {
    const el = b.label.element;
    let show = true, priority = 0;
    if (b.isMoon) {
      // show once the moon's orbit fills a useful part of the frame (works at any scale)
      const parentDist = camPos.distanceTo(b.parent.pos);
      show = state.showMoons && parentDist < (b.orbitRadius || b.parent.radius * 4) * 9;
      priority = 10;
    } else if (b.isComet) {
      priority = 30;
    } else if (b.isSun) {
      priority = 80;
    } else {
      // hide when the camera is very close to the body (label would overlap the surface)
      show = camPos.distanceTo(b.pos) >= b.radius * 2.2;
      priority = 40 + Math.min(20, (b.data.radiusKm || 1) / 4000);
    }
    if (state.selected === b) priority = 200;
    el.classList.toggle('sel', state.selected === b);
    if (!show) { el.classList.add('hidden'); continue; }
    // project to the screen so overlapping labels can be thinned out
    const wp = worldPos(b).clone().project(camera);
    if (wp.z > 1) { el.classList.add('hidden'); continue; }
    const x = (wp.x + 1) / 2 * w, y = (1 - wp.y) / 2 * h;
    if (x < -120 || x > w + 120 || y < -60 || y > h + 60) { el.classList.add('hidden'); continue; }
    const tw = el.offsetWidth || (el.textContent.length * 7 + 10);
    const th = el.offsetHeight || 14;
    candidates.push({ el, priority, x, y: y - th * 1.6, hw: tw / 2 + 5, hh: th / 2 + 4 });
  }
  // Greedy declutter: keep the most important label in any cluster, drop the rest.
  // Without this the inner planets stack into an unreadable pile at system scale.
  candidates.sort((a, b) => b.priority - a.priority);
  const placed = [];
  for (const c of candidates) {
    let clash = false;
    for (const p of placed) {
      if (Math.abs(c.x - p.x) < c.hw + p.hw && Math.abs(c.y - p.y) < c.hh + p.hh) { clash = true; break; }
    }
    c.el.classList.toggle('hidden', clash);
    if (!clash) placed.push(c);
  }
}

// ------------------------------------------------------------------ main loop
let acc = 0;
function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta(); const dt = Math.min(rawDt, 0.1);
  // The spin clock uses its own, more generous clamp: the simulation delta is held
  // to 0.1s to stop a backgrounded tab jumping the date, but that would also stall
  // rotation on a device dropping frames. 0.25s keeps spin smooth under load while
  // still absorbing a tab switch.
  if (!state.paused) { state.jd += dt * speedSeconds() / 86400; state.spinClock += Math.min(rawDt, 0.25); }
  // orbit lines are held back while the camera is still inside the Sun's glow
  const orbitTarget = (cinematic.active && cinematic.step <= 1) ? 0.0 : 1;
  state.orbitIntro += (orbitTarget - state.orbitIntro) * Math.min(1, rawDt * 1.1);
  updateWorld(dt);
  if (!cinematic.update(rawDt)) updateCamera(rawDt);
  else { const d = camera.position.distanceTo(controls.target); camera.near = Math.max(1e-9, d * 0.0015); camera.far = 400000; camera.updateProjectionMatrix(); controls.update(); }
  if (starMat) starMat.uniforms.uTime.value = clock.elapsedTime;
  updateLabels(); updateFlare();
  acc += dt; if (acc > 0.5) { acc = 0; refreshClock(); if (state.selected) updateLiveStats(state.selected); }
  composer.render();
  labelRenderer.render(scene, camera);
}
window.__ss = { state, bodies, byId, camera, controls, renderer, scene, fly, selectBody, cinematic, runCinematic, runIntro, soundtrack };
syncSpinEpoch();
updateWorld(0); refreshClock(); animate();
