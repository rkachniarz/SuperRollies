// Plays a throw's simulation on screen.
//
// The simulation advances in fixed PHYSICS_STEP increments, decoupled from the
// frame rate: each frame runs however many whole steps the elapsed time pays
// for, and the dice are drawn part-way between the last two steps so motion
// stays smooth on a 120 Hz screen and on a 30 Hz one alike. Only whole steps
// ever run, so what the dice do depends on the record, not on the display.
//
// More than one can play at once, each on a track of its own: in multiplayer
// the other player's throw can arrive while yours is still rolling
// (docs/decisions.md D48). A throw made in the other player's frame is drawn
// turned round (`turned`), onto the far half.

import * as THREE from 'three';
import { PHYSICS_STEP, MAX_STEPS_PER_FRAME } from './config.js';
import { createRoundSim } from './physics.js';
import { summarise } from './replay.js';
import { swapId, turnP, turnQ } from './seat.js';

/** `meshFor(id)` is the mesh to draw the die with that id (as in the record). */
export function createRoller(meshFor) {
  /** @type {Map<string, { sim: any, finish: (r: any) => void, accumulator: number, turned: boolean }>} */
  const runs = new Map();

  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  function draw({ sim, turned }, alpha) {
    for (const d of sim.dice) {
      const mesh = meshFor(turned ? swapId(d.id) : d.id);
      if (!mesh) continue;
      pa.fromArray(turned ? turnP(d.prev.p) : d.prev.p);
      pb.fromArray(turned ? turnP(d.curr.p) : d.curr.p);
      qa.fromArray(turned ? turnQ(d.prev.q) : d.prev.q);
      qb.fromArray(turned ? turnQ(d.curr.q) : d.curr.q);
      mesh.position.lerpVectors(pa, pb, alpha);
      mesh.quaternion.slerpQuaternions(qa, qb, alpha);
    }
  }

  /**
   * Stops the simulation running on `track`, or every one without a track,
   * leaving its dice where they are drawn.
   */
  function cancel(track) {
    for (const [name, run] of runs) {
      if (track !== undefined && name !== track) continue;
      run.sim.free();
      runs.delete(name);
    }
  }

  /**
   * Simulates `record` on screen. Resolves with the replay summary (see
   * replay.js) once every die has settled. `track` is where it plays (one
   * throw per track: a new one there stops the last); `turned` draws it from
   * the other end of the table, each die on its counterpart on the other
   * side; `instant` runs it to rest at once and draws only where it ends up
   * (a match being caught up on, D49).
   * @param {import('./physics.js').ThrowRecord} record
   * @param {{ track?: string, turned?: boolean, instant?: boolean }} [options]
   */
  function start(record, { track = 'player', turned = false, instant = false } = {}) {
    cancel(track);
    const sim = createRoundSim(record);
    if (instant) {
      while (!sim.done) sim.step();
      draw({ sim, turned }, 1);
      const result = summarise(sim);
      sim.free();
      return Promise.resolve(result);
    }
    return new Promise((resolve) => { runs.set(track, { sim, finish: resolve, accumulator: 0, turned }); });
  }

  /** Advances by `dt` seconds of real time. Called once per frame. */
  function frame(dt) {
    for (const [name, run] of runs) {
      const { sim } = run;
      run.accumulator = Math.min(run.accumulator + dt, MAX_STEPS_PER_FRAME * PHYSICS_STEP);
      while (run.accumulator >= PHYSICS_STEP && !sim.done) {
        sim.step();
        run.accumulator -= PHYSICS_STEP;
      }
      if (!sim.done) {
        draw(run, run.accumulator / PHYSICS_STEP);
        continue;
      }
      draw(run, 1);
      const result = summarise(sim);
      sim.free();
      runs.delete(name);
      run.finish(result);
    }
  }

  return {
    start, cancel, frame,
    get busy() { return runs.size > 0; },
    /** Whether a throw is playing on `track`. */
    playing: (track) => runs.has(track),
  };
}
