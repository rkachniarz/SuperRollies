// Check B (DEV_PLAN 0.5): a convex-hull collider for the d10 - a pentagonal
// trapezohedron, ten kite-shaped faces - settles flat on a face, never on an
// edge or a point.
//
//   node tools/phase0/check-d10.mjs [throws=500]
//
// The geometry is built here only for the check; the real d10 (numbering,
// decals, face reader) is Phase 3, task 3.4.

import { initPhysics, createRoundSim, HULLS } from '../../src/physics.js';
import {
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, DIE_RADIUS, MAX_THROW_SPEED, MAX_LIFT_SPEED, PHYSICS_STEP,
} from '../../src/config.js';
import { mulberry32, randomQuaternion } from './rng.mjs';

const THROWS = Number(process.argv[2] ?? 500);

// ---------- Geometry ----------
// Ten ring vertices zig-zag up and down around the equator; two apexes. For
// each kite to be flat, its apex must lie on the plane through its three ring
// vertices, so the apex height is solved for rather than chosen.
const R = DIE_RADIUS * 0.95; // ring radius
const ZIG = DIE_RADIUS * 0.1; // how far ring vertices sit above / below the equator
const ring = Array.from({ length: 10 }, (_, i) => {
  const a = (i * Math.PI) / 5;
  return [R * Math.cos(a), i % 2 ? -ZIG : ZIG, R * Math.sin(a)];
});
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.sqrt(dot(a, a)); return a.map((x) => x / l); };

// Plane through ring[0], ring[1], ring[2] (an upper kite's three ring vertices),
// where it crosses the y axis.
const n0 = cross(sub(ring[1], ring[0]), sub(ring[2], ring[0]));
const APEX = dot(n0, ring[0]) / n0[1];
const top = [0, Math.abs(APEX), 0];
const bottom = [0, -Math.abs(APEX), 0];

// Kites: the top apex with ring vertices (2k, 2k+1, 2k+2), the bottom apex
// with (2k+1, 2k+2, 2k+3).
const faces = [];
for (let k = 0; k < 5; k++) {
  faces.push([top, ring[2 * k], ring[(2 * k + 1) % 10], ring[(2 * k + 2) % 10]]);
  faces.push([bottom, ring[(2 * k + 1) % 10], ring[(2 * k + 2) % 10], ring[(2 * k + 3) % 10]]);
}
// Outward normals, and how far each kite is from flat (should be ~0).
let worstNonPlanar = 0;
const normals = faces.map((f) => {
  let n = norm(cross(sub(f[1], f[0]), sub(f[3], f[0])));
  const c = f.reduce((s, v) => s.map((x, i) => x + v[i] / 4), [0, 0, 0]);
  if (dot(n, c) < 0) n = n.map((x) => -x);
  worstNonPlanar = Math.max(worstNonPlanar, Math.abs(dot(n, sub(f[2], f[0]))));
  return n;
});
console.log(`d10: apex height ${top[1].toFixed(3)}, ring radius ${R.toFixed(3)}, ` +
  `worst kite non-planarity ${worstNonPlanar.toExponential(1)}`);

HULLS.d10 = Float32Array.from([top, bottom, ...ring].flat());

// ---------- Throws ----------
// clampToArena is off: it holds a die in place by moving it, which makes it an
// invisible, frictionless wall a die can come to rest leaning against. That is
// a property of the clamp, not of this collider, so it is kept out of this
// check (see the notes on DEV_PLAN 0.5).
//
// A die can also come to rest leaning against a real wall - a "cocked" die,
// just as with real dice in a real tray. Those are counted separately: they
// say nothing about whether the collider can balance on an edge in the open.
await initPhysics();
const rand = mulberry32(0xD10);

function rotate(q, v) {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  return v.map((c, i) => c + w * t[i] + cross(u, t)[i]);
}

// Flat on a face: the face's normal points straight down within this many degrees.
const FLAT_DEGREES = 1;
const flatCos = Math.cos((FLAT_DEGREES * Math.PI) / 180);
// Close enough to a wall that the die can be touching it.
const REACH = Math.hypot(R, top[1]);

let notFlat = 0;
let cocked = 0;
let timeouts = 0;
let totalSteps = 0;
const faceCounts = new Array(10).fill(0);
for (let i = 0; i < THROWS; i++) {
  // Half are gentle drops from low down (the likeliest way to stay on an
  // edge), half are hard throws.
  const hard = i % 2 === 0;
  const speed = hard ? MAX_THROW_SPEED * (0.5 + rand() * 0.5) : rand() * 1.5;
  const angle = rand() * Math.PI * 2;
  const record = {
    v: 1,
    arenaHalfWidth: TRAY_HALF_WIDTH,
    dice: [{
      id: 'd10', type: 'd10',
      p: [(rand() * 2 - 1) * 1.5, DIE_RADIUS + (hard ? 0.5 : rand() * 0.3), TRAY_DEPTH / 2],
      q: randomQuaternion(rand),
      v: [Math.cos(angle) * speed, hard ? MAX_LIFT_SPEED : 0, Math.sin(angle) * speed],
      w: [(rand() - 0.5) * (hard ? 30 : 4), (rand() - 0.5) * (hard ? 30 : 4), (rand() - 0.5) * (hard ? 30 : 4)],
    }],
  };
  const sim = createRoundSim(record, { clamp: false });
  while (!sim.done) sim.step();
  const { p, q } = sim.dice[0].curr;
  if (sim.timedOut) timeouts++;
  totalSteps += sim.steps;
  sim.free();

  // The face lying on the table is the one whose normal points most nearly down.
  let best = -Infinity;
  let bestFace = -1;
  normals.forEach((n, f) => {
    const down = -rotate(q, n)[1];
    if (down > best) { best = down; bestFace = f; }
  });
  faceCounts[bestFace]++;
  if (best >= flatCos && !sim.timedOut) continue;

  const byWall = TRAY_HALF_WIDTH - Math.abs(p[0]) < REACH || TRAY_DEPTH - Math.abs(p[2]) < REACH ||
    Math.abs(p[2]) - WALL_T * 1.4 < REACH;
  if (byWall && !sim.timedOut) { cocked++; continue; }
  notFlat++;
  const tilt = (Math.acos(Math.min(1, best)) * 180) / Math.PI;
  console.log(`throw ${i}: ${sim.timedOut ? 'never settled, ' : ''}resting ${tilt.toFixed(2)}° off flat ` +
    `at [${p.map((n) => n.toFixed(2))}]\n  ${JSON.stringify(record)}`);
}

console.log(`${THROWS} throws: ${notFlat} not flat on a face in the open, ${cocked} cocked against a wall, ` +
  `${timeouts} timed out. Mean time to settle ${((totalSteps / THROWS) * PHYSICS_STEP).toFixed(2)} s.`);
console.log(`Landed on each face: ${faceCounts.join(' ')}`);
console.log(notFlat ? 'FAIL' : 'PASS');
process.exit(notFlat ? 1 : 0);
