// The shape of a twelve-sided die, and which number goes on which face.
//
// Pure geometry, like d20.js; die-shapes.js derives the rest.

import { hullFaces, numberOpposites, range, scaled } from './polyhedra.js';

// Corner to centre: a touch bigger than the d20, as real ones are.
const R = 0.64;

// A regular dodecahedron: the corners of a cube, plus three golden rectangles.
const PHI = (1 + Math.sqrt(5)) / 2;
const RAW = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) RAW.push([x, y, z]);
for (const a of [-1, 1]) for (const b of [-1, 1]) {
  RAW.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
}
const VERTS = scaled(RAW, R / Math.sqrt(3));
const FACES = hullFaces(VERTS);

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D12 = {
  type: 'd12',
  verts: VERTS,
  faces: FACES,
  // Opposite faces add up to 13.
  numbers: numberOpposites(VERTS, FACES, range(1, 12)),
  label: 'numeral',
  decalSize: 1.1,
};
