// Small geometry helpers for defining die shapes: plain arrays, no three.js,
// so each die type's file can work out its own faces and numbering from its
// vertices. die-shapes.js derives everything else.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (a) => { const l = Math.sqrt(dot(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Scales every vertex by `k`. */
export const scaled = (verts, k) => verts.map((p) => p.map((x) => x * k));

/**
 * The vertices of `verts` lying on the plane facing `normal` at distance `d`,
 * in counter-clockwise order seen from outside.
 */
export function polygon(verts, normal, d, tolerance = 1e-9) {
  const on = verts.map((p, i) => i).filter((i) => Math.abs(dot(verts[i], normal) - d) < tolerance);
  const centre = [0, 1, 2].map((k) => on.reduce((s, i) => s + verts[i][k], 0) / on.length);
  // Any two directions in the plane, right-handed with the normal.
  const u = cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const w = cross(normal, u);
  const angle = (i) => {
    const r = sub(verts[i], centre);
    return Math.atan2(dot(r, w), dot(r, u));
  };
  return on.sort((a, b) => angle(a) - angle(b));
}

/**
 * Every face of the convex hull of `verts`, as vertex indices counter-clockwise
 * seen from outside, in the order they're first found. For a die whose
 * vertices are all corners of its own hull, these are its faces.
 */
export function hullFaces(verts, tolerance = 1e-6) {
  const faces = [];
  const seen = new Set();
  const n = verts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const raw = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (dot(raw, raw) < 1e-12) continue;
    let normal = normalize(raw);
    let d = dot(normal, verts[i]);
    if (d < 0) { normal = normal.map((x) => -x); d = -d; }
    // A face of the hull only if no vertex lies beyond it.
    if (verts.some((p) => dot(normal, p) > d + tolerance)) continue;
    const face = polygon(verts, normal, d, tolerance);
    const key = [...face].sort((a, b) => a - b).join();
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(face);
  }
  return faces;
}

/**
 * Standard numbering for a die whose faces come in opposite pairs: `values`
 * (ascending, one per face) are paired lowest with highest, so opposite faces
 * always add up to the same total (21 on a d20, 9 on a d8), as on real dice.
 * Real dice also keep consecutive numbers off faces that touch, so of each
 * pair's two ways round, a small greedy pass takes whichever puts fewer
 * consecutive numbers side by side.
 *
 * Worked out from the die's own faces and vertices rather than a hard-coded
 * table, so it can never silently disagree with the geometry: opposite faces
 * are the ones with antiparallel normals, neighbours the ones sharing an edge.
 * @returns {number[]} The number on each of `faces`.
 */
export function numberOpposites(verts, faces, values) {
  const n = faces.length;
  const normals = faces.map(([a, b, c]) => normalize(cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]))));

  const oppositeOf = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (oppositeOf[i] !== -1) continue;
    let best = -1;
    let bestDot = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = dot(normals[i], normals[j]);
      if (d < bestDot) { bestDot = d; best = j; }
    }
    oppositeOf[i] = best;
    oppositeOf[best] = i;
  }

  const neighborsOf = faces.map((face, i) => {
    const set = new Set(face);
    const result = [];
    faces.forEach((other, j) => {
      if (j === i) return;
      if (other.filter((v) => set.has(v)).length === 2) result.push(j);
    });
    return result;
  });

  // Ranks, not values, decide what "consecutive" means: 30 and 40 are
  // neighbours on a percentile die.
  const rank = new Map(values.map((v, i) => [v, i + 1]));
  const ranks = new Array(n).fill(0);
  const numbers = new Array(n).fill(0);
  const seen = new Array(n).fill(false);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    seen[oppositeOf[i]] = true;
    pairs.push([i, oppositeOf[i]]);
  }

  const badness = (face, r) =>
    neighborsOf[face].reduce((sum, nb) => sum + (ranks[nb] && Math.abs(ranks[nb] - r) === 1 ? 1 : 0), 0);

  pairs.forEach(([a, b], k) => {
    const low = values[k];
    const high = values[n - 1 - k];
    const [rl, rh] = [rank.get(low), rank.get(high)];
    const optionA = badness(a, rl) + badness(b, rh);
    const optionB = badness(a, rh) + badness(b, rl);
    if (optionA <= optionB) { numbers[a] = low; numbers[b] = high; ranks[a] = rl; ranks[b] = rh; }
    else { numbers[a] = high; numbers[b] = low; ranks[a] = rh; ranks[b] = rl; }
  });

  return numbers;
}

/** `from`, `from + step`, ... up to `to`. */
export const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
