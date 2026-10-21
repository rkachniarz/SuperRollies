// The shape of a ten-sided die, and the two ways it's numbered: 0-9 (the d10)
// and 00-90 (the percentile die, d%).
//
// Pure geometry, like d20.js; die-shapes.js derives the rest.
//
// A pentagonal trapezohedron: ten kite-shaped faces, five round each of two
// points. Its collider passed the Phase 0 check that it settles flat on a
// face, never on an edge or point (docs/history.md 0.5): this is the same shape,
// to the bit.

import { DIE_RADIUS } from './config.js';
import { cross, dot, hullFaces, numberOpposites, range } from './polyhedra.js';

// Ten ring vertices zig-zag up and down round the middle; two points, top and
// bottom. For each kite to be flat, its point must lie on the plane through
// its three ring vertices, so how tall the die is gets solved for, not chosen.
const R = DIE_RADIUS * 0.95; // ring radius
const ZIG = DIE_RADIUS * 0.1; // how far ring vertices sit above / below the middle
const RING = Array.from({ length: 10 }, (_, i) => {
  const a = (i * Math.PI) / 5;
  return [R * Math.cos(a), i % 2 ? -ZIG : ZIG, R * Math.sin(a)];
});
const sub = (a, b) => a.map((x, i) => x - b[i]);
// The plane through an upper kite's three ring vertices, where it crosses the
// vertical axis.
const n0 = cross(sub(RING[1], RING[0]), sub(RING[2], RING[0]));
const APEX = Math.abs(dot(n0, RING[0]) / n0[1]);

const VERTS = [[0, APEX, 0], [0, -APEX, 0], ...RING];
const FACES = hullFaces(VERTS);

// Standard numbering: the "0" counts as 10, and opposite faces add up to 11
// ("0" opposite "1"), with odd numbers round one point and even round the
// other on real dice. The percentile die is the same with every number ten
// times bigger: "00" (100) opposite "10".
const NUMBERS = numberOpposites(VERTS, FACES, range(1, 10));
// Each opposite pair is one odd and one even number; turn over any pair with
// its odd number round the top point.
FACES.forEach((face, i) => {
  const up = face.includes(0);
  if (up && NUMBERS[i] % 2) {
    const j = NUMBERS.indexOf(11 - NUMBERS[i]);
    [NUMBERS[i], NUMBERS[j]] = [NUMBERS[j], NUMBERS[i]];
  }
});

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D10 = {
  type: 'd10',
  verts: VERTS,
  faces: FACES,
  numbers: NUMBERS,
  label: 'numeral',
  numeral: (n) => (n === 10 ? '0' : String(n)),
  decalSize: 1.15,
};

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D_PERCENT = {
  type: 'd%',
  verts: VERTS,
  faces: FACES,
  numbers: NUMBERS.map((n) => n * 10),
  label: 'numeral',
  numeral: (n) => (n === 100 ? '00' : String(n)),
  decalSize: 1.15,
};
