// The shape of a twenty-sided die, and which number goes on which face.
//
// Nothing here touches the DOM or the physics engine - it is pure geometry, so
// it can be reasoned about (and tested) on its own. die-shapes.js derives the
// rest (normals, rest pose, face reader) from it, as for every die type.

import { DIE_RADIUS } from './config.js';
import { numberOpposites, range } from './polyhedra.js';

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

// ---------- Standard d20 numbering (not spindown) ----------
// A "standard" d20's defining, checkable property is that opposite faces sum to
// 21 - unlike a spindown die, which deliberately runs 1-20 sequentially around
// the die so it's easy to count down during play. Standard dice also avoid
// placing consecutive numbers on faces that touch. numberOpposites works both
// out from this die's own faces (see polyhedra.js).
const FACE_NUMBERS = numberOpposites(VERTS, FACES, range(1, 20));

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D20 = {
  type: 'd20',
  verts: VERTS,
  faces: FACES,
  numbers: FACE_NUMBERS,
  label: 'numeral',
  decalSize: 1.0,
};
