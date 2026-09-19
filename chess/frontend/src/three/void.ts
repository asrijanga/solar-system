import * as THREE from 'three';
import { IS_SMALL_SCREEN, THEME } from '../config';

function makeSkyTexture(): THREE.CanvasTexture {
  const width = 8;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#8ec3ea');
  gradient.addColorStop(0.45, '#bfdcf1');
  gradient.addColorStop(0.78, '#f3e6cf');
  gradient.addColorStop(1, '#fbf3e3');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const blobs: [number, number, number][] = [
    [128, 150, 70], [80, 160, 50], [176, 160, 52],
    [110, 120, 46], [150, 120, 46], [128, 100, 40],
  ];
  for (const [x, y, r] of blobs) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.55, outer);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(46, 48),
    new THREE.MeshStandardMaterial({
      color: THEME.groundColor,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.85;
  ground.receiveShadow = true;
  scene.add(ground);
}

function addClouds(scene: THREE.Scene): { update: (dt: number) => void } {
  const texture = makeCloudTexture();
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.8,
  });
  const count = IS_SMALL_SCREEN ? 5 : 8;
  const sprites: { sprite: THREE.Sprite; baseY: number; speed: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(material.clone());
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const radius = 24 + Math.random() * 14;
    const y = 6 + Math.random() * 10;
    sprite.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    const scale = 10 + Math.random() * 14;
    sprite.scale.set(scale * 1.6, scale, 1);
    (sprite.material as THREE.SpriteMaterial).opacity = 0.35 + Math.random() * 0.35;
    scene.add(sprite);
    sprites.push({ sprite, baseY: y, speed: 0.05 + Math.random() * 0.05, phase: Math.random() * Math.PI * 2 });
  }

  return {
    update(dt: number) {
      for (const { sprite, baseY, speed, phase } of sprites) {
        sprite.position.y = baseY + Math.sin(performance.now() * 0.0002 + phase) * 0.6;
        sprite.position.x += dt * speed;
        sprite.position.z += dt * speed * 0.3;
      }
    },
  };
}

function addDustMotes(scene: THREE.Scene): { update: (dt: number) => void } {
  const count = IS_SMALL_SCREEN ? 220 : 420;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 3 + Math.random() * 9;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * 6 + 0.2;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xfff3d6,
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let t = 0;
  return {
    update(dt: number) {
      t += dt;
      points.rotation.y = t * 0.015;
      points.position.y = Math.sin(t * 0.3) * 0.08;
    },
  };
}

export function addVoidBackdrop(scene: THREE.Scene): { update: (dt: number) => void } {
  scene.background = makeSkyTexture();

  addGround(scene);
  const clouds = addClouds(scene);
  const dust = addDustMotes(scene);

  const sunGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(255,244,214,0.55)', 'rgba(255,224,150,0.12)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  sunGlow.rotation.x = -Math.PI / 2;
  sunGlow.position.y = -0.83;
  scene.add(sunGlow);

  let t = 0;
  return {
    update(dt: number) {
      t += dt;
      clouds.update(dt);
      dust.update(dt);
      const mat = sunGlow.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.85 + Math.sin(t * 0.4) * 0.08;
    },
  };
}
