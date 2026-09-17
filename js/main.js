import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SUN, PLANETS, COMETS, KEYBOARD_ORDER, AU_KM, C_KM_S } from './data.js';
import { planetPosition, cometPosition, orbitPath, cometPath, dateToJD, jdToDate, J2000_JD } from './orbits.js';
import { Soundtrack } from './audio.js';
import * as SH from './shaders.js';

// ------------------------------------------------------------------ constants
const AU_SCALE = 100;                 // scene units per AU (true scale)
const DIST_POW = 0.55;                // radial compression in "visual" mode
const RADIUS_AU = km => km / AU_KM;   // km -> AU
const TEX = 'assets/textures/';
const clock = new THREE.Clock();

// ------------------------------------------------------------------ state
const state = {
  jd: dateToJD(new Date()),
  speedExp: 6,               // slider value; seconds of sim time per real second = 10^(0.85*exp)
  paused: false,
  sizeSlider: 30,            // 1..60 -> planet exaggeration
  trueScale: false,
  scaleMix: 0,               // 0 = visual, 1 = true scale (animated)
  showOrbits: true, showLabels: true, showBelts: true, showMoons: true, bloom: true,
  selected: null,            // body record
  follow: null,
  hover: null,
};
const bodies = [];           // all selectable bodies
const byId = new Map();

function sizeFactor() { return state.trueScale ? 1 : 20 * Math.pow(30, (state.sizeSlider - 1) / 59); }
function speedSeconds() { return Math.pow(10, 0.85 * state.speedExp); }

// Map a heliocentric position (AU) to scene coordinates, honouring the scale mix.
const _v = new THREE.Vector3();
function toScene(p, out = new THREE.Vector3()) {
  const r = Math.hypot(p.x, p.y, p.z) || 1e-9;
  const rVis = AU_SCALE * Math.pow(r, DIST_POW), rTrue = AU_SCALE * r;
  const rs = rVis + (rTrue - rVis) * state.scaleMix;
  return out.set(p.x, p.z, -p.y).multiplyScalar(rs / r);
}
function bodyRadiusScene(km, isSun = false) {
  const f = isSun ? Math.max(1, sizeFactor() / 6) : sizeFactor();
  const fv = 1 + (f - 1) * (1 - state.scaleMix);
  return RADIUS_AU(km) * AU_SCALE * fv;
}
function moonDistanceScene(sat, planet) {
  const pr = bodyRadiusScene(planet.radiusKm);
  const ratio = sat.distanceKm / planet.radiusKm;
  const visual = pr * (1.6 + Math.pow(ratio, 0.7) * 0.55);
  const real = RADIUS_AU(sat.distanceKm) * AU_SCALE;
  return visual + (real - visual) * state.scaleMix;
}

// ------------------------------------------------------------------ renderer
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.getElementById('labels').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.0005, 200000);
camera.position.set(0, 420, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.minDistance = 0.002; controls.maxDistance = 60000;
controls.enablePan = false;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.6, 1.0);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

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
manager.onLoad = () => { loadbar.style.width = '100%'; loadtext.textContent = 'Ready'; const b = document.getElementById('launch'); b.disabled = false; b.textContent = 'Launch'; };

// ------------------------------------------------------------------ sky (Milky Way)
const skyGroup = new THREE.Group();
{
  const maxTex = renderer.capabilities.maxTextureSize;
  const skyTex = tex(maxTex >= 8192 ? 'stars_8k.jpg' : 'stars_4k.jpg');
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90000, 64, 32), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, color: new THREE.Color(1.5, 1.5, 1.5), depthWrite: false, fog: false }));
  sky.rotation.x = THREE.MathUtils.degToRad(-23.44); // equatorial map -> ecliptic frame
  sky.rotation.y = Math.PI;
  skyGroup.add(sky);
  // extra sparkle: a few thousand point stars with colour temperature variation
  const n = 4000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random(), v = Math.random(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), R = 80000;
    pos.set([R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph), R * Math.sin(ph) * Math.sin(th)], i * 3);
    const t = Math.random(); const c = t < 0.15 ? [0.7, 0.8, 1.0] : t < 0.7 ? [1, 1, 1] : t < 0.9 ? [1, 0.9, 0.75] : [1, 0.75, 0.6];
    col.set(c, i * 3); size[i] = 0.8 + Math.pow(Math.random(), 4) * 4.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({ vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG, uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  skyGroup.add(new THREE.Points(g, m));
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
    uRingInner: { value: 1 }, uRingOuter: { value: 2 }, uCamPos: { value: new THREE.Vector3() }, uLightScale: { value: 1.15 },
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
  const mat = planetMaterial({ map, night: p.nightTexture ? tex(p.nightTexture) : null, ocean: p.id === 'earth', ringShadow: !!p.rings && !p.rings.faint, atmoColor: p.atmosphere?.color, atmo: p.atmosphere ? p.atmosphere.intensity * 0.6 : 0.08 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
  if (p.oblateness) mesh.scale.y = 1 - p.oblateness;
  tilt.add(mesh);
  const body = { id: p.id, data: p, group, tilt, mesh, mat, radius: 1, pos: new THREE.Vector3(), moons: [], parent: null };
  if (p.cloudsTexture) {
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tex(p.cloudsTexture, false), transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
    body.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 64), cm); tilt.add(body.clouds);
  }
  if (p.atmosphere) { body.atmo = makeAtmosphere(1.045, p.atmosphere.color, p.atmosphere.intensity); tilt.add(body.atmo); }
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
  body.orbit = new THREE.Line(og, new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.28 }));
  body.orbitPathAU = orbitPath(p.elements, state.jd, 360);
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
      const g = new THREE.IcosahedronGeometry(1, 3); const pa = g.attributes.position;
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
  const orbit = new THREE.Line(og, new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: 0.2 })); orbitGroup.add(orbit);
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
  const m = new THREE.ShaderMaterial({ vertexShader: SH.BELT_VERT, fragmentShader: SH.BELT_FRAG, uniforms: { uDays: { value: 0 }, uMix: { value: 0 }, uAuScale: { value: AU_SCALE }, uPixelRatio: { value: renderer.getPixelRatio() }, uColor: { value: new THREE.Color(color) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); belts.push(pts); return pts;
}
makeBelt(9000, 2.1, 3.35, 12, 0xc9b79a, 1.0);   // main asteroid belt
makeBelt(12000, 30, 50, 10, 0x8fb4d9, 0.8);     // Kuiper belt
makeBelt(600, 5.05, 5.35, 8, 0xd4c2a3, 0.9);    // Jupiter trojans (approximate: spread along the orbit)

// ------------------------------------------------------------------ helpers
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function jdHoursSinceJ2000(jd) { return (jd - J2000_JD) * 24; }

function updateOrbitLine(body) {
  const arr = body.orbit.geometry.attributes.position.array;
  for (let k = 0; k < body.orbitPathAU.length; k++) { toScene(body.orbitPathAU[k], tmpV); arr[k * 3] = tmpV.x; arr[k * 3 + 1] = tmpV.y; arr[k * 3 + 2] = tmpV.z; }
  body.orbit.geometry.attributes.position.needsUpdate = true;
  body.orbit.geometry.computeBoundingSphere();
}
let lastMix = -1;

function updateWorld(dtSim) {
  const jd = state.jd;
  const hours = jdHoursSinceJ2000(jd);
  const mixChanged = Math.abs(state.scaleMix - lastMix) > 1e-6 || state._sizeDirty;
  // sun
  const sunR = bodyRadiusScene(SUN.radiusKm, true);
  sunBody.radius = sunR; sunMesh.scale.setScalar(sunR); corona.scale.setScalar(sunR * 4.2);
  sunMesh.rotation.y = 2 * Math.PI * hours / SUN.rotationHours;
  corona.quaternion.copy(camera.quaternion);
  // planets
  for (const p of PLANETS) {
    const b = byId.get(p.id);
    const posAU = planetPosition(p.elements, jd);
    toScene(posAU, b.group.position);
    b.pos.copy(b.group.position); b.posAU = posAU;
    const r = bodyRadiusScene(p.radiusKm); b.radius = r;
    b.mesh.scale.set(r, r * (1 - (p.oblateness || 0)), r);
    if (b.clouds) { b.clouds.scale.setScalar(r * 1.008); b.clouds.rotation.y = 2 * Math.PI * hours / (p.rotationHours * 0.96); }
    if (b.atmo) b.atmo.scale.setScalar(r * 1.04);
    // spin (Earth is aligned so the sub-solar longitude matches UTC time)
    if (p.id === 'earth') {
      const sunDir = tmpV.copy(b.pos).negate().normalize();
      const alpha = Math.atan2(-sunDir.z, sunDir.x);
      const date = jdToDate(jd); const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      const subsolar = THREE.MathUtils.degToRad((12 - utcH) * 15);
      b.mesh.rotation.y = alpha - subsolar;
    } else b.mesh.rotation.y = 2 * Math.PI * hours / p.rotationHours;
    // ring
    if (b.ring) {
      const ri = r * b.ringInnerRatio, ro = r * b.ringOuterRatio;
      b.ring.scale.set(ro, ro, 1);
      const u = b.ring.material.uniforms; u.uCenter.value.copy(b.pos); u.uPlanetRadius.value = r;
      b.tilt.getWorldQuaternion(tmpQ); u.uPoleAxis.value.set(0, 1, 0).applyQuaternion(tmpQ);
      const pu = b.mat.uniforms; pu.uCenter.value.copy(b.pos); pu.uPoleAxis.value.copy(u.uPoleAxis.value); pu.uRingInner.value = ri; pu.uRingOuter.value = ro;
    }
    if (mixChanged) updateOrbitLine(b);
    // moons
    for (const m of b.moons) {
      const s = m.data; const d = moonDistanceScene(s, p); const mr = bodyRadiusScene(s.radiusKm); m.radius = mr;
      const ang = m.phase + 2 * Math.PI * (jd - J2000_JD) / s.periodDays;
      m.holder.position.set(Math.cos(ang) * d, 0, -Math.sin(ang) * d);
      m.mesh.scale.setScalar(mr); if (m.atmo) m.atmo.scale.setScalar(1.05);
      m.mesh.rotation.y = s.tidallyLocked !== false ? ang + Math.PI : 2 * Math.PI * hours / 24;
      m.orbit.scale.setScalar(d);
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
    const u = c.tail.material.uniforms; u.uHead.value.copy(c.pos); u.uDir.value.copy(c.pos).normalize(); u.uLength.value = (0.4 + 0.6 * state.scaleMix + 0.0) * AU_SCALE * 0.6 * activity * (1 - 0.45 * state.scaleMix) + 0.3; u.uWidth.value = 0.12 * u.uLength.value; u.uTime.value = clock.elapsedTime;
    c.tail.visible = activity > 0.02;
    if (mixChanged) updateOrbitLine(c);
  }
  for (const b of belts) { b.material.uniforms.uDays.value = jd - J2000_JD; b.material.uniforms.uMix.value = state.scaleMix; }
  lastMix = state.scaleMix; state._sizeDirty = false;
  // shader uniforms shared
  for (const b of bodies) {
    if (b.mat) { b.mat.uniforms.uSunPos.value.set(0, 0, 0); b.mat.uniforms.uCamPos.value.copy(camera.position); }
    if (b.atmo) b.atmo.material.uniforms.uSunPos.value.set(0, 0, 0);
    if (b.ring) b.ring.material.uniforms.uCamPos.value.copy(camera.position);
  }
  sunMat.uniforms.uTime.value = clock.elapsedTime; coronaMat.uniforms.uTime.value = clock.elapsedTime;
}

// ------------------------------------------------------------------ camera / selection
const fly = { active: false, t: 0, dur: 1.8, fromOff: new THREE.Vector3(), toOff: new THREE.Vector3(), fromTarget: new THREE.Vector3(), body: null };
const followOffset = new THREE.Vector3();
function worldPos(body) { if (body.isMoon) { body.holder.getWorldPosition(tmpV2); return tmpV2; } return tmpV2.copy(body.pos); }
function viewDistance(body) { return Math.max(body.radius * (body.isSun ? 3.2 : body.ring ? 5.5 : 4.2), 0.004); }

function selectBody(body, { fly: doFly = true } = {}) {
  state.selected = body; state.follow = body;
  document.querySelectorAll('#planetnav button').forEach(b => b.classList.toggle('active', b.dataset.id === body.id || (body.isMoon && b.dataset.id === body.parent.id)));
  showPanel(body);
  soundtrack.chime(body.isSun ? 220 : body.isMoon ? 1320 : 660 + (PLANETS.findIndex(p => p.id === body.id)) * 55);
  location.hash = body.id;
  if (doFly) {
    const target = worldPos(body).clone();
    fly.body = body; fly.active = true; fly.t = 0;
    fly.fromOff.copy(camera.position).sub(controls.target); fly.fromTarget.copy(controls.target);
    const dir = camera.position.clone().sub(target); if (dir.lengthSq() < 1e-8) dir.set(1, 0.4, 1);
    dir.normalize(); dir.y = Math.max(dir.y, 0.18); dir.normalize();
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
  camera.near = Math.max(0.0002, d * 0.001); camera.far = 400000; camera.updateProjectionMatrix();
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
  let rows = `<div class="row"><span>Your weight here (${fmt(weight)} kg on Earth)</span><b>${fmt(weight * g / 9.807, 1)} kg</b></div>`;
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
document.getElementById('t-now').addEventListener('click', () => { state.jd = dateToJD(new Date()); toast('Jumped to the present moment'); });
refreshSpeedUI();

const settings = document.getElementById('settings');
document.getElementById('btn-settings').addEventListener('click', e => { settings.classList.toggle('open'); e.currentTarget.classList.toggle('active', settings.classList.contains('open')); });
document.getElementById('btn-full').addEventListener('click', () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); });
const bind = (id, fn) => document.getElementById(id).addEventListener('change', e => fn(e.target.checked ?? e.target.value, e));
bind('opt-orbits', v => { state.showOrbits = v; orbitGroup.visible = v; });
bind('opt-labels', v => { state.showLabels = v; labelRenderer.domElement.style.display = v ? '' : 'none'; });
bind('opt-belts', v => { state.showBelts = v; belts.forEach(b => b.visible = v); });
bind('opt-moons', v => { state.showMoons = v; for (const b of bodies) if (b.isMoon) b.pivot.visible = v; });
bind('opt-bloom', v => { state.bloom = v; bloomPass.enabled = v; });
bind('opt-truescale', v => { setTrueScale(v); });
document.getElementById('opt-size').addEventListener('input', e => { state.sizeSlider = parseFloat(e.target.value); state._sizeDirty = true; });
document.getElementById('opt-volume').addEventListener('input', e => soundtrack.setVolume(parseFloat(e.target.value)));
function setTrueScale(v) {
  state.trueScale = v; document.getElementById('opt-truescale').checked = v;
  toast(v ? 'True scale: every distance and size is real. Earth is now a speck. Use the navigation to find it.' : 'Visual scale: distances compressed and planets enlarged so you can see them.');
  if (state.follow) { const b = state.follow; setTimeout(() => selectBody(b), 1200); }
}

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
  else if (k.toLowerCase() === 't') setTrueScale(!state.trueScale);
  else if (k.toLowerCase() === 'h') selectBody(byId.get('halley'));
  else if (k.toLowerCase() === 'n') document.getElementById('t-now').click();
});

// splash / launch
document.getElementById('launch').addEventListener('click', () => {
  document.getElementById('splash').classList.add('fade');
  setMusic(true);
  // intro: sweep in from far away
  fly.body = sunBody; fly.active = true; fly.t = 0; fly.dur = 4.5;
  fly.fromOff.set(0, 900, 1800); fly.fromTarget.set(0, 0, 0); fly.toOff.set(0, 190, 520);
  setTimeout(() => { fly.dur = 1.8; const h = location.hash.slice(1); if (h && byId.has(h)) selectBody(byId.get(h)); else toast('Tip: press 3 for Earth, T for true scale, H for Halley\'s Comet'); }, 4700);
});

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
  renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ label visibility
function updateLabels() {
  const camPos = camera.position;
  for (const b of bodies) {
    const el = b.label.element;
    if (b.isMoon) {
      const parentDist = camPos.distanceTo(b.parent.pos); const show = state.showMoons && parentDist < b.parent.radius * 60 && state.scaleMix < 0.5;
      el.classList.toggle('hidden', !show);
    } else if (b.isComet) {
      el.classList.toggle('hidden', false);
    } else {
      // hide when the camera is very close to the body (label would overlap the surface)
      const dist = camPos.distanceTo(b.pos); el.classList.toggle('hidden', dist < b.radius * 2.2);
    }
    el.classList.toggle('sel', state.selected === b);
  }
}

// ------------------------------------------------------------------ main loop
let acc = 0;
function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta(); const dt = Math.min(rawDt, 0.1);
  if (!state.paused) state.jd += dt * speedSeconds() / 86400;
  // animate scale mix
  const targetMix = state.trueScale ? 1 : 0; state.scaleMix += (targetMix - state.scaleMix) * Math.min(1, dt * 2.2); if (Math.abs(state.scaleMix - targetMix) < 0.0005) state.scaleMix = targetMix;
  updateWorld(dt);
  updateCamera(rawDt);
  updateLabels();
  acc += dt; if (acc > 0.5) { acc = 0; refreshClock(); if (state.selected) updateLiveStats(state.selected); }
  composer.render();
  labelRenderer.render(scene, camera);
}
window.__ss = { state, bodies, byId, camera, controls, renderer, scene, fly, selectBody };
updateWorld(0); refreshClock(); animate();
