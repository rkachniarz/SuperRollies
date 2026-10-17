// The shape of a six-sided die, and which number goes on which face.
//
// Pure geometry, like d20.js; die-shapes.js derives the rest.
//
// A cube with its eight corners slightly cut off: the convex-hull stand-in for
// the rounded corners real dice have, which help them roll over rather than
// tip once and stop. The cuts are small enough that the six faces are still
// nearly the whole die (octagons with short diagonal sides), and a die can't
// rest on a corner: its centre is far outside that small triangle.

// Half the side. A real d6 is about 0.8 the size of a d20 across its faces,
// and the d20's centre-to-face distance is ~0.49 (DIE_RADIUS 0.62 x 0.795).
const H = 0.4;
// How far back from each corner the cut is made, along each edge.
const CUT = 0.06;

// ---------- Standard numbering ----------
// Opposite faces sum to 7, and 1, 2, 3 run counter-clockwise round the corner
// they share (seen from outside), as on Western dice. +Y, +Z, +X is that order
// round the (+,+,+) corner: an even permutation of X, Y, Z.
const AXES = [
  { axis: [0, 1, 0], number: 1 },
  { axis: [0, 0, 1], number: 2 },
  { axis: [1, 0, 0], number: 3 },
  { axis: [-1, 0, 0], number: 4 },
  { axis: [0, 0, -1], number: 5 },
  { axis: [0, -1, 0], number: 6 },
];

// ---------- Vertices: three per corner ----------
// Each corner (sx H, sy H, sz H) is replaced by three points, one pulled back
// along each of the edges meeting there.
const VERTS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  for (let pulled = 0; pulled < 3; pulled++) {
    const p = [sx * H, sy * H, sz * H];
    p[pulled] = [sx, sy, sz][pulled] * (H - CUT);
    VERTS.push(p);
  }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The vertices lying on the plane facing `normal` at distance `d`, in
 * counter-clockwise order seen from outside.
 */
function polygon(normal, d) {
  const on = VERTS.map((p, i) => i).filter((i) => Math.abs(dot(VERTS[i], normal) - d) < 1e-9);
  const centre = [0, 1, 2].map((k) => on.reduce((s, i) => s + VERTS[i][k], 0) / on.length);
  // Any two directions in the plane, right-handed with the normal.
  const u = cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const w = cross(normal, u);
  const angle = (i) => {
    const r = VERTS[i].map((x, k) => x - centre[k]);
    return Math.atan2(dot(r, w), dot(r, u));
  };
  return on.sort((a, b) => angle(a) - angle(b));
}

const FACES = AXES.map(({ axis }) => polygon(axis, H));

// The cut corners: each a small triangle facing out along a diagonal.
const CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  const n = [sx, sy, sz].map((x) => x / Math.sqrt(3));
  CORNERS.push(polygon(n, dot(n, [sx * H, sy * H, sz * (H - CUT)])));
}

/** @type {import('./die-shapes.js').ShapeSpec} */
export const D6 = {
  type: 'd6',
  verts: VERTS,
  faces: FACES,
  numbers: AXES.map((a) => a.number),
  plainFaces: CORNERS,
  label: 'pips',
  // Each face's "up" (see dice.js) runs along one of its edges on a cube, so
  // the decal's square lines up with the face's own, but the general sqrt(2)
  // bound is kept anyway: 1.3 x the inradius is already a die-sized pip area.
  decalSize: 1.3,
};
