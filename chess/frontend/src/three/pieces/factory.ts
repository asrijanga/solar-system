import * as THREE from 'three';
import type { Color, PieceType } from '../../types';
import { LATHE_SEGMENTS, latheProfile, pieceHeight } from './profiles';
import { accentMaterial, pieceMaterial } from './materials';

function bodyMesh(type: PieceType, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(latheProfile(type), LATHE_SEGMENTS);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function knightHeadShape(): THREE.Shape {
  const pts: [number, number][] = [
    [0.05, 0.0], [0.22, 0.05], [0.24, 0.14], [0.18, 0.2], [0.2, 0.26],
    [0.14, 0.34], [0.2, 0.4], [0.16, 0.52], [0.08, 0.46], [0.14, 0.42],
    [0.02, 0.4], [-0.1, 0.34], [-0.2, 0.22], [-0.26, 0.08], [-0.2, 0.0],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return shape;
}

function buildKnightHead(material: THREE.Material): THREE.Group {
  const depth = 0.24;
  const geometry = new THREE.ExtrudeGeometry(knightHeadShape(), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.y = 0.4;
  group.scale.setScalar(1.05);
  return group;
}

function buildRookCrown(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const merlonGeo = new THREE.BoxGeometry(0.11, 0.16, 0.09);
  const count = 8;
  const radius = 0.25;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const merlon = new THREE.Mesh(merlonGeo, material);
    merlon.position.set(Math.cos(angle) * radius, 0.82, Math.sin(angle) * radius);
    merlon.lookAt(0, 0.82, 0);
    merlon.castShadow = true;
    group.add(merlon);
  }
  return group;
}

function buildBishopMitre(material: THREE.Material, accent: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.035), accent);
  slit.position.y = 0.87;
  slit.rotation.z = Math.PI / 5;
  group.add(slit);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), material);
  finial.position.y = 1.0;
  finial.castShadow = true;
  group.add(finial);
  return group;
}

function buildQueenCrown(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const spikeGeo = new THREE.ConeGeometry(0.045, 0.18, 6);
  const count = 8;
  const radius = 0.26;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const spike = new THREE.Mesh(spikeGeo, material);
    spike.position.set(Math.cos(angle) * radius, 0.94, Math.sin(angle) * radius);
    spike.castShadow = true;
    group.add(spike);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), material);
  ball.position.y = 1.13;
  ball.castShadow = true;
  group.add(ball);
  return group;
}

function buildKingCross(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16), material);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.1;
  group.add(band);
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.24, 0.055), material);
  vertical.position.y = 1.26;
  vertical.castShadow = true;
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.055, 0.055), material);
  horizontal.position.y = 1.21;
  horizontal.castShadow = true;
  group.add(vertical, horizontal);
  return group;
}

/** Builds one fully-formed, uniquely shaped chess piece as a Group standing on y=0. */
export function buildPiece(type: PieceType, color: Color): THREE.Group {
  const group = new THREE.Group();
  const material = pieceMaterial(color);
  group.add(bodyMesh(type, material));

  switch (type) {
    case 'n':
      group.add(buildKnightHead(material));
      break;
    case 'r':
      group.add(buildRookCrown(material));
      break;
    case 'b':
      group.add(buildBishopMitre(material, accentMaterial(color)));
      break;
    case 'q':
      group.add(buildQueenCrown(material));
      break;
    case 'k':
      group.add(buildKingCross(material));
      break;
    case 'p':
    default:
      break;
  }

  group.userData.pieceType = type;
  group.userData.pieceColor = color;
  group.userData.material = material;
  group.userData.silhouetteHeight = pieceHeight(type);
  return group;
}
