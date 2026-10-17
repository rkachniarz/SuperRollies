// Handfuls (DEV_PLAN 2.3, 2.4): many dice a side, thrown together, all come to
// rest inside their own half, flat on a face or cocked against a wall or
// another die - never sunk into the floor, never through a wall, and in time.
//
//   node tools/phase0/check-handfuls.mjs [throws per dice set=100]
//
// Each throw releases both sides' handfuls at once, laid out and scattered the
// way the game does it (handful.js), from anywhere a held handful can be, at
// anything up to the hardest speed the gesture allows. Every step of every
// throw is checked. The settle check put a die to sleep while another, still
// moving, was touching it; Rapier then let it fall through the floor (see
// touchesAnotherDie in physics.js). That is what the floor check is for.
//
// Held handfuls are simulated too (createHoldSim): they lie in a palm and roll
// about in it, so the second half checks that none falls out, and that
// wherever they are when let go is a fair start - nothing overlapping enough
// to be shoved apart once the throw begins.
//
// A few throws hit the settle timeout with a die still creeping - sliding
// slowly down another die pinned against a wall - and are read where they
// lie, as the game does. That's tolerated up to MAX_TIMEOUT_RATE per set.

import * as THREE from 'three';
import { initPhysics, createRoundSim, createHoldSim, palmFor, TIMEOUT_STEPS } from '../../src/physics.js';
import { SHAPES } from '../../src/die-shapes.js';
import { handLayout, scatter, randomHandful } from '../../src/handful.js';
import { DICE_SETS, dieTypes } from '../../src/rules/dice-sets.js';
import {
  DIVIDER_T, DIE_RADIUS, HELD_HEIGHT, MAX_THROW_SPEED, MAX_LIFT_SPEED, SPIN_POWER, PHYSICS_STEP,
} from '../../src/config.js';
import { mulberry32, randomQuaternion } from './rng.mjs';

const THROWS = Number(process.argv[2] ?? 100);
const MAX_TIMEOUT_RATE = 0.02;
await initPhysics();
const rand = mulberry32(0x8D6);

let failures = 0;
for (const set of Object.values(DICE_SETS)) {
  const types = dieTypes(set);
  if (types.length < 2) continue;
  const { tray, dieScale } = set;
  const radius = Math.max(...types.map((t) => SHAPES[t].circumradius * dieScale));
  const { offsets, reach } = handLayout(types.length, radius);
  // The widest the screen ever allows: the tray's own walls.
  const arenaHalfWidth = tray.halfWidth - DIE_RADIUS;
  const xMax = tray.halfWidth - reach.x;
  const zMin = DIVIDER_T + reach.z;
  const zMax = tray.depth - reach.z;
  const opponentZone = {
    halfWidth: Math.min(tray.halfWidth * 0.55, xMax),
    zNear: -(DIVIDER_T + reach.z),
    zFar: Math.max(-tray.depth * 0.75, -zMax),
  };
  // A die's centre never gets lower than lying flat on a face, bar the give
  // of a hard landing while in flight, and none at all once at rest.
  const restOf = (type) => SHAPES[type].restHeight * dieScale;

  let problems = 0;
  let timeouts = 0;
  let steps = 0;
  for (let i = 0; i < THROWS; i++) {
    const cx = (rand() * 2 - 1) * xMax;
    const cz = zMin + rand() * (zMax - zMin);
    const angle = rand() * Math.PI * 2;
    const speed = MAX_THROW_SPEED * (0.3 + rand() * 0.7);
    const vx = Math.cos(angle) * speed;
    const vz = Math.sin(angle) * speed;
    const spin = [-vz * SPIN_POWER + (rand() - 0.5) * 6, (rand() - 0.5) * 6, vx * SPIN_POWER + (rand() - 0.5) * 6];
    const motion = scatter([vx, MAX_LIFT_SPEED * rand(), vz], spin, offsets, rand);
    const player = offsets.map(([ox, oz], k) => ({
      p: [cx + ox, HELD_HEIGHT, cz + oz], q: randomQuaternion(rand), ...motion[k],
    }));
    const opponent = randomHandful(opponentZone, offsets, rand);
    const record = {
      v: 1, arenaHalfWidth, tray,
      dice: [
        ...opponent.map((r, k) => ({ id: `opponent-${k}`, type: types[k], s: dieScale, ...r })),
        ...player.map((r, k) => ({ id: `player-${k}`, type: types[k], s: dieScale, ...r })),
      ],
    };
    const sim = createRoundSim(record, { clamp: false });
    let problem = null;
    while (!sim.done && !problem) {
      sim.step();
      for (const d of sim.dice) {
        const [x, y, z] = d.curr.p;
        const side = d.id.startsWith('player') ? 1 : -1;
        if (y < restOf(d.type) * 0.6) problem = `${d.id} sank to y=${y.toFixed(3)}`;
        else if (Math.abs(x) > tray.halfWidth || Math.abs(z) > tray.depth) problem = `${d.id} left the tray`;
        else if (Math.sign(z) !== side) problem = `${d.id} crossed the divider`;
        if (problem) { problem += ` at step ${sim.steps}`; break; }
      }
    }
    for (const d of sim.dice) {
      if (!problem && d.curr.p[1] < restOf(d.type) * 0.9) problem = `${d.id} came to rest sunk, at y=${d.curr.p[1].toFixed(3)}`;
    }
    if (sim.timedOut) {
      timeouts++;
      const stuck = sim.dice.filter((d) => !d.settled).map((d) => {
        const v = d.body.linvel(); const w = d.body.angvel();
        return `${d.id} at [${d.curr.p.map((n) => n.toFixed(2))}] v ${Math.hypot(v.x, v.y, v.z).toFixed(2)} w ${Math.hypot(w.x, w.y, w.z).toFixed(2)}`;
      });
      console.log(`  ${set.id} throw ${i} timed out, not settled: ${stuck.join('; ')}`);
    }
    steps += sim.steps;
    sim.free();
    if (problem) {
      problems++;
      if (problems <= 3) console.log(`  ${set.id} throw ${i}: ${problem}\n  ${JSON.stringify(record)}`);
    }
  }
  const ok = problems === 0 && timeouts <= THROWS * MAX_TIMEOUT_RATE;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${set.id} (${set.notation}): ${THROWS} throws, ${problems} with a die ` +
    `sunk or escaped, ${timeouts} timed out (${(TIMEOUT_STEPS * PHYSICS_STEP).toFixed(0)} s). ` +
    `Mean time to settle ${((steps / THROWS) * PHYSICS_STEP).toFixed(2)} s.`);
}
// ---------- Held, then let go ----------
// The hand wanders and jumps about - harsher than any real drag, right up to
// the walls - for anything up to 10 s, then lets go with no throw at all, so
// any shove at the start of the throw can only come from dice overlapping.
// Gravity has had a single step: falling onto each other can't explain it.
// The shove is what matters: the rule against releasing a die inside a
// collider is there because Rapier flings it out. Settling (settle in
// physics.js) gets overlaps down to a few cm and stalls there; Rapier then
// separates them at a fraction of a unit per second, against throws of up to
// 9. The overlap limit is about how far a hard landing compresses a die.
// A die can leave the palm, flung out when the hand jumps about this hard;
// the hold's safety net puts it back, and counts. In 1 hold in 100 at most.
const MAX_OVERLAP = 0.06;
const MAX_RESCUE_RATE = 0.01;
const MAX_SHOVE = 0.3; // sideways speed after one step
const UP = new THREE.Vector3(0, 1, 0);
for (const set of Object.values(DICE_SETS)) {
  const types = dieTypes(set);
  if (types.length < 2) continue;
  const { tray, dieScale } = set;
  const radius = Math.max(...types.map((t) => SHAPES[t].circumradius * dieScale));
  const { reach } = palmFor(types.length, radius);
  const arenaHalfWidth = tray.halfWidth - DIE_RADIUS;
  // Anywhere clampToTray (arena.js) lets the palm's centre go.
  const xMax = Math.max(0, tray.halfWidth - reach.x);
  const zMin = DIVIDER_T + reach.z;
  const zMax = Math.max(zMin, tray.depth - reach.z);
  const anywhere = () => [(rand() * 2 - 1) * xMax, zMin + rand() * (zMax - zMin)];
  let worstOverlap = 0;
  let worstShove = 0;
  let rescued = 0;
  for (let i = 0; i < THROWS / 2; i++) {
    let hand = anywhere();
    const hold = createHoldSim({
      arenaHalfWidth, divider: true, tray, centre: hand,
      // Picked up as dice lie between throws: flat on a face, turned any way.
      dice: types.map((type) => ({
        type, s: dieScale,
        q: new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2).multiply(SHAPES[type].restQuaternion).toArray(),
      })),
    }, rand);
    const steps = 30 + Math.floor(rand() * 570);
    for (let s = 0; s < steps; s++) {
      if (s % 30 === 0) hand = anywhere();
      hold.step(hand);
    }
    worstOverlap = Math.max(worstOverlap, hold.settle());
    rescued += hold.rescued;
    const poses = hold.poses();
    hold.free();
    const sim = createRoundSim({
      v: 1, arenaHalfWidth, tray,
      dice: poses.map(({ p, q }, k) => ({ id: `player-${k}`, type: types[k], s: dieScale, p, q, v: [0, 0, 0], w: [0, 0, 0] })),
    });
    sim.step();
    for (const d of sim.dice) {
      const v = d.body.linvel();
      worstShove = Math.max(worstShove, Math.sqrt(v.x * v.x + v.z * v.z));
    }
    sim.free();
  }
  const ok = worstOverlap <= MAX_OVERLAP && worstShove <= MAX_SHOVE && rescued <= (THROWS / 2) * MAX_RESCUE_RATE;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${set.id} held and let go: ${THROWS / 2} holds, deepest overlap at release ` +
    `${worstOverlap.toFixed(3)} (max ${MAX_OVERLAP}), fastest shove ${worstShove.toFixed(2)} (max ${MAX_SHOVE}), ` +
    `${rescued} dice put back in the palm.`);
}

process.exit(failures ? 1 : 0);
