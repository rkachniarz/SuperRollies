// The shape of a four-sided die, and which number goes where.
//
// Pure geometry, like d20.js; die-shapes.js derives the rest.
//
// A d4 has no face on top to read: it rests on a face with a corner pointing
// up, and that corner's number is the roll. Each corner carries a number, and
// every face shows the numbers of its three corners, each printed near its own
// corner (the corner it points to is "up" for that numeral). So whichever way
// it lands, the three faces you can see all show the same number at the top.
//
// The game still reads a face, just the one it lies on (`reads: 'down'`): the
// number of the corner opposite it, which is the one pointing up.

import { hullFaces, scaled } from './polyhedra.js';

// Corner to centre. A real d4 is spiky: this makes it a little taller than a
// d6 (four thirds of this) and wider across its base.
const R = 0.72;

// Alternate corners of a cube: a regular tetrahedron.
const CORNERS = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
const VERTS = scaled(CORNERS, R / Math.sqrt(3));
const FACES = hullFaces(VERTS);
// Each corner's number: 1 to 4.
const VERTEX_NUMBERS = [1, 2, 3, 4];

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D4 = {
  type: 'd4',
  verts: VERTS,
  faces: FACES,
  // A face's number is the one it reads as when lying on it: the corner it
  // doesn't touch.
  numbers: FACES.map((face) => VERTEX_NUMBERS.find((_, i) => !face.includes(i))),
  reads: 'down',
  label: 'numeral',
  vertexNumbers: VERTEX_NUMBERS,
  // Each corner's numeral sits halfway from the face's centre to the corner,
  // its square 0.68 the face's inradius across. That keeps it inside the face
  // (its outer corners reach 0.93 of the way to the edges either side of
  // it) and clear of the other two numerals on the face. test/dice.test.js
  // checks both for every decal.
  decalOffset: 0.5,
  decalSize: 0.68,
  // The decals can't be any bigger, and the faces slope away steeply, so the
  // numerals fill their decals rather than sitting in a margin.
  numeralFill: 0.98,
};
