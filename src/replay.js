// Replaying a recorded throw: run its simulation to rest and report where every
// die ended up and what it shows.
//
// The live game rolls through exactly this path too (via roll.js), so a record
// saved from a real round and replayed here reaches the same result - the basis
// for the Phase 0 checks in tools/phase0/, and later for multiplayer, where the
// other player receives a throw's record and simulates it themselves.

import { createRoundSim } from './physics.js';
import { SHAPES } from './die-shapes.js';

/** The number showing on top of a die of `type` resting at orientation `q`. */
export function readFace(type, q) {
  return SHAPES[type].faceUp(q);
}

/**
 * Summarises a finished simulation: final pose and face for every die, and a
 * digest of the exact bits of every final position and orientation.
 */
export function summarise(sim) {
  const dice = sim.dice.map((d) => ({
    id: d.id,
    p: d.curr.p,
    q: d.curr.q,
    face: readFace(d.type, d.curr.q),
    // Down a hole (Pothole): its centre below the table's surface. A die
    // cocked over the rim, its centre still above it, is read as it lies.
    fallen: d.curr.p[1] < 0,
  }));
  return { steps: sim.steps, timedOut: sim.timedOut, dice, digest: digest(dice) };
}

/**
 * Runs a recorded throw to rest. Same options as createRoundSim.
 * @param {import('./physics.js').ThrowRecord} record
 */
export function replayThrow(record, options) {
  const sim = createRoundSim(record, options);
  while (!sim.done) sim.step();
  const result = summarise(sim);
  sim.free();
  return result;
}

// Rapier works in 32-bit floats, so every value it hands back is exactly
// representable as one: its float32 bit pattern is the value, exactly. Two
// simulations agree bit-for-bit precisely when these strings are equal.
const scratch = new DataView(new ArrayBuffer(4));
function bitsOf(x) {
  scratch.setFloat32(0, x);
  return scratch.getUint32(0).toString(16).padStart(8, '0');
}

/** Hex string of the float32 bits of every die's final position and orientation. */
export function digest(dice) {
  return dice.map((d) => [...d.p, ...d.q].map(bitsOf).join('')).join('.');
}
