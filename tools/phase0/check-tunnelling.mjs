// Check C (DEV_PLAN 0.6): with clampToArena switched off, throws at maximum
// speed never leave the tray or cross the divider - the colliders and Rapier's
// continuous collision detection hold every die on their own.
//
//   node tools/phase0/check-tunnelling.mjs [throws=200]
//
// Each throw releases BOTH dice at the hardest speed the gesture allows
// (MAX_THROW_SPEED, MAX_LIFT_SPEED, full spin), from anywhere a die can be held
// - including right up against the divider - in a random direction, a third of
// them aimed straight at a wall, corner or the divider. Every step of every
// throw is checked, not just where the dice end up.

import { initPhysics, createRoundSim } from '../../src/physics.js';
import {
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, DIE_RADIUS, HELD_HEIGHT,
  MAX_THROW_SPEED, MAX_LIFT_SPEED, SPIN_POWER,
} from '../../src/config.js';
import { mulberry32, randomQuaternion } from './rng.mjs';

const THROWS = Number(process.argv[2] ?? 200);
await initPhysics();
const rand = mulberry32(0xC0FFEE);

// Where a held die may be: the same limits as clampToTray in arena.js, at the
// widest the screen ever allows (the full tray).
const HOLD_X = TRAY_HALF_WIDTH - DIE_RADIUS;
const HOLD_Z_MIN = WALL_T * 1.4 + DIE_RADIUS * 0.6;
const HOLD_Z_MAX = TRAY_DEPTH - DIE_RADIUS;

function maxSpeedRelease(id, side, aimed) {
  const x = (rand() * 2 - 1) * HOLD_X;
  const z = side * (HOLD_Z_MIN + rand() * (HOLD_Z_MAX - HOLD_Z_MIN));
  let angle;
  if (aimed) {
    // Straight at one of: left wall, right wall, back wall, the divider, a corner.
    const targets = [[-TRAY_HALF_WIDTH, z], [TRAY_HALF_WIDTH, z], [x, side * TRAY_DEPTH], [x, 0],
      [Math.sign(rand() - 0.5) * TRAY_HALF_WIDTH, side * TRAY_DEPTH], [Math.sign(rand() - 0.5) * TRAY_HALF_WIDTH, 0]];
    const [tx, tz] = targets[Math.floor(rand() * targets.length)];
    angle = Math.atan2(tz - z, tx - x);
  } else {
    angle = rand() * Math.PI * 2;
  }
  const vx = Math.cos(angle) * MAX_THROW_SPEED;
  const vz = Math.sin(angle) * MAX_THROW_SPEED;
  return {
    id, type: 'd20',
    p: [x, HELD_HEIGHT, z],
    q: randomQuaternion(rand),
    v: [vx, MAX_LIFT_SPEED, vz],
    w: [-vz * SPIN_POWER + (rand() - 0.5) * 6, (rand() - 0.5) * 6, vx * SPIN_POWER + (rand() - 0.5) * 6],
  };
}

// A die's centre is inside its half when it is clear of the walls by less than
// its own size - it can touch them, never pass them.
function escaped(p, side) {
  const [x, y, z] = p;
  if (Math.abs(x) > TRAY_HALF_WIDTH || Math.abs(z) > TRAY_DEPTH) return 'left the tray';
  if (y < 0) return 'fell through the floor';
  if (Math.sign(z) !== side) return 'crossed the divider';
  return null;
}

let failures = 0;
let worstX = 0;
let worstZ = Infinity;
let timeouts = 0;
for (let i = 0; i < THROWS; i++) {
  const aimed = i % 3 === 0;
  const record = {
    v: 1,
    arenaHalfWidth: TRAY_HALF_WIDTH, // unused with clamp off
    dice: [maxSpeedRelease('opponent', -1, aimed), maxSpeedRelease('player', 1, aimed)],
  };
  const sim = createRoundSim(record, { clamp: false });
  let problem = null;
  while (!sim.done && !problem) {
    sim.step();
    for (const d of sim.dice) {
      const side = d.id === 'player' ? 1 : -1;
      worstX = Math.max(worstX, Math.abs(d.curr.p[0]));
      worstZ = Math.min(worstZ, Math.abs(d.curr.p[2]));
      const why = escaped(d.curr.p, side);
      if (why) { problem = `${d.id} ${why} at step ${sim.steps}: [${d.curr.p.map((n) => n.toFixed(2))}]`; break; }
    }
  }
  if (sim.timedOut) timeouts++;
  sim.free();
  if (problem) {
    failures++;
    console.log(`throw ${i}: ${problem}\n  ${JSON.stringify(record)}`);
  }
}

console.log(`${THROWS} throws, ${THROWS * 2} dice: ${failures} escaped.`);
console.log(`Closest approach: |x| ${worstX.toFixed(3)} (wall face at ${TRAY_HALF_WIDTH}), ` +
  `|z| ${worstZ.toFixed(3)} (divider face at ${(WALL_T * 1.4).toFixed(2)}). ${timeouts} throw(s) hit the settle timeout.`);
console.log(failures ? 'FAIL' : 'PASS');
process.exit(failures ? 1 : 0);
