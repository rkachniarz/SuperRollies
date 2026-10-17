// The shape of a twenty-sided die, and which number goes on which face.
//
// Nothing here touches the DOM or the physics engine - it is pure geometry, so
// it can be reasoned about (and tested) on its own. die-shapes.js derives the
// rest (normals, rest pose, face reader) from it, as for every die type.

import * as THREE from 'three';
import { DIE_RADIUS } from './config.js';

// ---------- 12 vertices, 20 triangular faces ----------
// The standard golden-ratio construction. Both the visual mesh and the physics
// collision shape are built from this SAME data, so they can never disagree
// about which triangle is "face 7".
const PHI = (1 + Math.sqrt(5)) / 2;

const RAW_VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

// Pushed out onto a sphere of DIE_RADIUS so the die is a regular icosahedron.
const VERTS = RAW_VERTS.map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return [(x / len) * DIE_RADIUS, (y / len) * DIE_RADIUS, (z / len) * DIE_RADIUS];
});

// Per-face outward normal, for working out the numbering below.
const NORMALS = FACES.map(([a, b, c]) => {
  const va = new THREE.Vector3(...VERTS[a]);
  const vb = new THREE.Vector3(...VERTS[b]);
  const vc = new THREE.Vector3(...VERTS[c]);
  return new THREE.Vector3()
    .subVectors(vb, va)
    .cross(new THREE.Vector3().subVectors(vc, va))
    .normalize();
});

// ---------- Standard d20 numbering (not spindown) ----------
// A "standard" d20's defining, checkable property is that opposite faces sum to
// 21 - unlike a spindown die, which deliberately runs 1-20 sequentially around
// the die so it's easy to count down during play. Standard dice also avoid
// placing consecutive numbers on faces that touch.
//
// Rather than hard-code a lookup table that assumes a particular vertex/face
// ordering (risking a silent mismatch with the geometry above - exactly the
// kind of bug this project has been bitten by before), both properties are
// computed from this die's own FACES/VERTS: opposite-face pairs come from
// antiparallel normals, edge adjacency comes from shared vertex pairs, and a
// small greedy pass assigns each pair's {low, 21-low} to whichever face keeps
// consecutive numbers apart from its neighbours.
const FACE_NUMBERS = (() => {
  const n = FACES.length;
  const normals = NORMALS;

  const oppositeOf = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (oppositeOf[i] !== -1) continue;
    let best = -1;
    let bestDot = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = normals[i].dot(normals[j]);
      if (d < bestDot) { bestDot = d; best = j; }
    }
    oppositeOf[i] = best;
    oppositeOf[best] = i;
  }

  const neighborsOf = FACES.map((face, i) => {
    const set = new Set(face);
    const result = [];
    FACES.forEach((other, j) => {
      if (j === i) return;
      if (other.filter((v) => set.has(v)).length === 2) result.push(j);
    });
    return result;
  });

  const numbers = new Array(n).fill(0);
  const seen = new Array(n).fill(false);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    seen[oppositeOf[i]] = true;
    pairs.push([i, oppositeOf[i]]);
  }

  const badness = (face, value) =>
    neighborsOf[face].reduce(
      (sum, nb) => sum + (numbers[nb] && Math.abs(numbers[nb] - value) === 1 ? 1 : 0),
      0
    );

  pairs.forEach(([a, b], k) => {
    const low = k + 1;
    const high = 21 - low;
    const optionA = badness(a, low) + badness(b, high);
    const optionB = badness(a, high) + badness(b, low);
    if (optionA <= optionB) { numbers[a] = low; numbers[b] = high; }
    else { numbers[a] = high; numbers[b] = low; }
  });

  return numbers;
})();

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D20 = {
  type: 'd20',
  verts: VERTS,
  faces: FACES,
  numbers: FACE_NUMBERS,
  label: 'numeral',
  decalSize: 1.0,
};
