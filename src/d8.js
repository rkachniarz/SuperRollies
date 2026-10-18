// The shape of an eight-sided die, and which number goes on which face.
//
// Pure geometry, like d20.js; die-shapes.js derives the rest.

import { hullFaces, numberOpposites, range } from './polyhedra.js';

// Corner to centre: a regular octahedron with its corners on the axes. Lying
// on a face it stands about as tall as a d6.
const R = 0.64;

const VERTS = [[R, 0, 0], [-R, 0, 0], [0, R, 0], [0, -R, 0], [0, 0, R], [0, 0, -R]];
const FACES = hullFaces(VERTS);

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D8 = {
  type: 'd8',
  verts: VERTS,
  faces: FACES,
  // Opposite faces add up to 9.
  numbers: numberOpposites(VERTS, FACES, range(1, 8)),
  label: 'numeral',
  decalSize: 1.1,
};
