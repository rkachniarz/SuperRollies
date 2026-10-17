// Building a die: the faceted body and its etched numbers. (Its collision
// shape is built from the same vertices, in physics.js.)

import * as THREE from 'three';
import { DIE_RADIUS } from './config.js';
import { FACES, VERTS, FACE_LOCAL } from './d20.js';

function buildDieGeometry(themeColor) {
  const positions = [];
  const normals = [];
  const colors = [];
  const base = new THREE.Color(themeColor);
  FACES.forEach(([a, b, c], i) => {
    positions.push(...VERTS[a], ...VERTS[b], ...VERTS[c]);
    const n = FACE_LOCAL[i].normal;
    for (let k = 0; k < 3; k++) normals.push(n.x, n.y, n.z);
    // Light-from-upper-left facet shading, baked into vertex colours - makes
    // the faceted surface read clearly under the real lights.
    const shade = 1 + n.y * 0.22 - n.x * 0.08;
    const shaded = base.clone().multiplyScalar(shade);
    for (let k = 0; k < 3; k++) colors.push(shaded.r, shaded.g, shaded.b);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

// ---------- Etched face numbers ----------
// Each number is a small flat decal (a plane with a canvas-drawn numeral,
// transparent everywhere else) sitting just off the face's surface, oriented to
// that face's own normal. Flat/unlit on purpose: a version of this that used a
// lit material (to "catch the light" like the body does) backfired badly - on
// faces angled away from the key light the numeral darkened along with the
// facet under it, and a dark numeral colour (the player die's near-black
// digits) over an already-darkened facet became nearly unreadable. An unlit
// numeral renders at the same full contrast on every face, which is what
// "printed on" actually needs.
const numberTextureCache = new Map();

function numberTexture(value, colorHex) {
  const key = value + '|' + colorHex;
  let tex = numberTextureCache.get(key);
  if (tex) return tex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colorHex;
  ctx.font = '700 ' + Math.round(size * 0.68) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size / 2 + size * 0.02);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTextureCache.set(key, tex);
  return tex;
}

function addFaceNumbers(mesh, numberColor) {
  const colorHex = '#' + new THREE.Color(numberColor).getHexString();
  FACES.forEach(([a, b, c], i) => {
    const va = new THREE.Vector3(...VERTS[a]);
    const vb = new THREE.Vector3(...VERTS[b]);
    const vc = new THREE.Vector3(...VERTS[c]);
    const centroid = va.clone().add(vb).add(vc).multiplyScalar(1 / 3);
    const normal = FACE_LOCAL[i].normal;

    // No single "upright" direction is possible for every face on a shape like
    // this (same reason real dice have numbers at no shared consistent
    // rotation), but leaning each face's "up" toward the die's own vertical
    // axis - rather than an arbitrary mesh-authoring choice like "toward this
    // face's first vertex" - keeps every numeral close to upright instead of
    // landing at random-looking angles. Falls back to the Z axis for any face
    // whose normal is nearly parallel to Y (up projects to ~zero there).
    const axisUp = new THREE.Vector3(0, 1, 0);
    let up = axisUp.clone().sub(normal.clone().multiplyScalar(normal.dot(axisUp)));
    if (up.lengthSq() < 1e-4) {
      const axisFallback = new THREE.Vector3(0, 0, 1);
      up = axisFallback.clone().sub(normal.clone().multiplyScalar(normal.dot(axisFallback)));
    }
    up.normalize();

    // right x up must equal normal for this to be a proper rotation (det +1).
    // crossVectors(normal, up) gives normal x up = -(up x normal), which is the
    // MIRROR of that - a left-handed basis. Quaternion.setFromRotationMatrix
    // can't represent a reflection (quaternions only encode proper rotations),
    // so it silently produced a wrong, unrelated orientation for every single
    // face - the actual root cause behind numbers looking jumbled, rotated
    // oddly, or simply missing (a decal facing the wrong way is backface-culled,
    // i.e. invisible, even on a face pointed straight at the camera). Building
    // right = up x normal keeps the basis right-handed.
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    up = new THREE.Vector3().crossVectors(normal, right).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, normal)
    );

    const distToEdge = (p1, p2) => {
      const line = new THREE.Vector3().subVectors(p2, p1);
      const toC = new THREE.Vector3().subVectors(centroid, p1);
      return new THREE.Vector3().crossVectors(toC, line).length() / line.length();
    };
    const inradius = Math.min(distToEdge(va, vb), distToEdge(vb, vc), distToEdge(vc, va));

    // A SQUARE decal's own corner sits size/2 * sqrt(2) from its centre. Since
    // each face's "up" leans toward the die's vertical axis (see above) rather
    // than toward one of the triangle's own vertices, that corner can point in
    // ANY direction relative to the triangle - including straight at the
    // nearest edge, whose closest point is only `inradius` away. So for the
    // corner never to cross the face's own boundary, size/2*sqrt(2) must stay
    // under inradius, i.e. size under inradius*sqrt(2) (~1.414). An earlier
    // 1.55 multiplier overshot that, which is exactly why numerals used to
    // bleed past their face's edges onto neighbouring faces. 1.0 keeps a
    // comfortable ~29% margin below the hard cap.
    const size = inradius * 1.0;

    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: numberTexture(FACE_LOCAL[i].number, colorHex),
        transparent: true,
        depthWrite: false,
      })
    );
    // Offset well clear of the face itself (not just a hair off it) - paired
    // with the tight camera near/far, this keeps the decal and its own face far
    // enough apart in the depth buffer that which one wins a z-fight isn't a
    // coin flip per GPU.
    decal.position.copy(centroid).addScaledVector(normal, 0.02);
    decal.quaternion.copy(quaternion);
    decal.renderOrder = 1;
    mesh.add(decal);
  });
}

// Where every die starts: lying flat with its 20 on top, already at rest.
// Placed, never dropped - a die released from rest in its default orientation
// lands exactly on a level edge and, with nothing to tip it either way in a
// deterministic simulation, stays balanced there.
const TOP_FACE = FACE_LOCAL.findIndex((f) => f.number === 20);
const REST_QUATERNION = new THREE.Quaternion().setFromUnitVectors(
  FACE_LOCAL[TOP_FACE].normal, new THREE.Vector3(0, 1, 0)
);
// Centre to face: how high the centre sits when lying on one.
const REST_HEIGHT = FACE_LOCAL[TOP_FACE].normal.dot(new THREE.Vector3(...VERTS[FACES[TOP_FACE][0]]));

/**
 * Creates one die's mesh and adds it to the scene, resting at the centre of
 * its own half of the tray.
 */
export function createDie({ theme, spawnZ, scene }) {
  const geometry = buildDieGeometry(theme.body);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 1),
    new THREE.LineBasicMaterial({ color: theme.edge, transparent: true, opacity: 0.85 })
  );
  mesh.add(edges);
  addFaceNumbers(mesh, theme.number);
  const die = {
    mesh,
    /** Puts it back where it starts, at the start of each match. */
    goHome() {
      mesh.position.set(0, REST_HEIGHT, spawnZ);
      mesh.quaternion.copy(REST_QUATERNION);
    },
  };
  die.goHome();
  scene.add(mesh);
  return die;
}

/**
 * A release from a random spot in a die's own half of the tray - the
 * opponent's throw.
 * @returns {Omit<import('./physics.js').DieRelease, 'id' | 'type'>}
 */
export function randomThrow(zoneZ, zoneSign, { trayHalfWidth, trayDepth }) {
  const x = (Math.random() - 0.5) * (trayHalfWidth * 1.1);
  const z = zoneZ + zoneSign * (Math.random() - 0.5) * (trayDepth * 0.5);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI
  ));
  return {
    p: [x, DIE_RADIUS + 1.4 + Math.random() * 0.6, z],
    q: q.toArray(),
    v: [(Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5],
    w: [
      (Math.random() - 0.5) * 18,
      (Math.random() - 0.5) * 18,
      (Math.random() - 0.5) * 18,
    ],
  };
}
