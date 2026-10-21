// Every die type's collider settles flat on a face, never on an edge or a
// point. Began as Check B (docs/history.md 0.5), for the d10 alone; since Phase 3 it
// throws every die type there is.
//
//   node tools/phase0/check-dice.mjs [throws=2000] [type ...]
//
// Fails if a die is ever taken as settled off flat in the open, or if more
// than 1 throw in 1000 waits out the settle timeout. (A d6 can balance a while
// on one of its cut corners before toppling: ~1 in 5000.)
//
// Also prints how often each number came up, as a rough fairness check: a
// shape or numbering bug that favours some faces shows up there.

import { initPhysics, createRoundSim } from '../../src/physics.js';
import { SHAPES, DIE_TYPES } from '../../src/die-shapes.js';
import {
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, MAX_THROW_SPEED, MAX_LIFT_SPEED, PHYSICS_STEP,
} from '../../src/config.js';
import { mulberry32, randomQuaternion } from './rng.mjs';

const THROWS = Number(process.argv[2] ?? 2000);
const MAX_TIMEOUT_RATE = 1 / 1000;
const TYPES = process.argv.length > 3 ? process.argv.slice(3) : DIE_TYPES;

// clampToArena is off: it holds a die in place by moving it, which makes it an
// invisible, frictionless wall a die can come to rest leaning against. That is
// a property of the clamp, not of any collider, so it is kept out of this
// check (see the notes on docs/history.md 0.5).
//
// A die can also come to rest leaning against a real wall - a "cocked" die,
// just as with real dice in a real tray. Those are counted separately: they
// say nothing about whether the collider can balance on an edge in the open.
// The game reads them as they lie (D24).
await initPhysics();

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotate(q, v) {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  return v.map((c, i) => c + w * t[i] + cross(u, t)[i]);
}

// Flat on a face: the face's normal points straight down within this many degrees.
const FLAT_DEGREES = 1;
const flatCos = Math.cos((FLAT_DEGREES * Math.PI) / 180);

let failed = false;
for (const type of TYPES) {
  const shape = SHAPES[type];
  const faces = [...shape.faces, ...shape.plainFaces].map((f) => ({ normal: f.normal.toArray(), number: f.number }));
  // Close enough to a wall that the die can be touching it.
  const reach = shape.circumradius;
  const rand = mulberry32(0xD10);

  let notFlat = 0;
  let cocked = 0;
  let timeouts = 0;
  let totalSteps = 0;
  const counts = new Map(shape.faces.map((f) => [f.number, 0]));
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
        id: type, type,
        p: [(rand() * 2 - 1) * 1.5, reach + (hard ? 0.5 : rand() * 0.3), TRAY_DEPTH / 2],
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

    const read = shape.faceUp(q);
    counts.set(read, (counts.get(read) ?? 0) + 1);

    // The face lying on the table is the one whose normal points most nearly down.
    const best = Math.max(...faces.map((f) => -rotate(q, f.normal)[1]));
    const tilt = (Math.acos(Math.min(1, best)) * 180) / Math.PI;
    const where = `at [${p.map((n) => n.toFixed(2))}]\n  ${JSON.stringify(record)}`;
    if (sim.timedOut) {
      console.log(`${type} throw ${i}: never settled, ${tilt.toFixed(2)}° off flat ${where}`);
      continue;
    }
    if (best >= flatCos) continue;

    const byWall = TRAY_HALF_WIDTH - Math.abs(p[0]) < reach || TRAY_DEPTH - Math.abs(p[2]) < reach ||
      Math.abs(p[2]) - WALL_T * 1.4 < reach;
    if (byWall) { cocked++; continue; }
    notFlat++;
    console.log(`${type} throw ${i}: settled ${tilt.toFixed(2)}° off flat ${where}`);
  }

  const ok = notFlat === 0 && timeouts <= THROWS * MAX_TIMEOUT_RATE;
  if (!ok) failed = true;
  const tally = [...counts].sort(([a], [b]) => a - b).map(([n, c]) => `${n}:${c}`).join(' ');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${type}: ${THROWS} throws, ${notFlat} settled off flat in the open, ` +
    `${cocked} cocked against a wall, ${timeouts} timed out; mean settle ` +
    `${((totalSteps / THROWS) * PHYSICS_STEP).toFixed(2)} s\n      came up ${tally}`);
}
process.exit(failed ? 1 : 0);
