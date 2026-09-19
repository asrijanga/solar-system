import * as THREE from 'three';
import { IS_SMALL_SCREEN } from '../config';

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

export function addVoidBackdrop(scene: THREE.Scene): { update: (dt: number) => void } {
  const starCount = IS_SMALL_SCREEN ? 1400 : 3200;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const radius = 30 + Math.random() * 55;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2) * 0.5 - 0.15);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) * 0.6 + 2;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    sizes[i] = Math.random() * 1.6 + 0.3;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xdce6ff,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const auroraGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(201,162,75,0.35)', 'rgba(124,58,237,0.12)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  auroraGlow.rotation.x = -Math.PI / 2;
  auroraGlow.position.y = -1.15;
  scene.add(auroraGlow);

  let t = 0;
  return {
    update(dt: number) {
      t += dt;
      stars.rotation.y = t * 0.004;
      auroraGlow.material.opacity = 0.85 + Math.sin(t * 0.4) * 0.08;
    },
  };
}
