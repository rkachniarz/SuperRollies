// Plays a throw's simulation on screen.
//
// The simulation advances in fixed PHYSICS_STEP increments, decoupled from the
// frame rate: each frame runs however many whole steps the elapsed time pays
// for, and the dice are drawn part-way between the last two steps so motion
// stays smooth on a 120 Hz screen and on a 30 Hz one alike. Only whole steps
// ever run, so what the dice do depends on the record, not on the display.

import * as THREE from 'three';
import { PHYSICS_STEP, MAX_STEPS_PER_FRAME } from './config.js';
import { createRoundSim } from './physics.js';
import { summarise } from './replay.js';

export function createRoller(meshesById) {
  let sim = null;
  let finish = null;
  let accumulator = 0;

  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  function draw(alpha) {
    for (const d of sim.dice) {
      const mesh = meshesById[d.id];
      pa.fromArray(d.prev.p);
      pb.fromArray(d.curr.p);
      qa.fromArray(d.prev.q);
      qb.fromArray(d.curr.q);
      mesh.position.lerpVectors(pa, pb, alpha);
      mesh.quaternion.slerpQuaternions(qa, qb, alpha);
    }
  }

  /** Stops the running simulation, if any, leaving its dice where they are drawn. */
  function cancel() {
    if (!sim) return;
    sim.free();
    sim = null;
    finish = null;
  }

  /**
   * Simulates `record` on screen. Resolves with the replay summary (see
   * replay.js) once every die has settled.
   * @param {import('./physics.js').ThrowRecord} record
   */
  function start(record) {
    cancel();
    sim = createRoundSim(record);
    accumulator = 0;
    return new Promise((resolve) => { finish = resolve; });
  }

  /** Advances by `dt` seconds of real time. Called once per frame. */
  function frame(dt) {
    if (!sim) return;
    accumulator = Math.min(accumulator + dt, MAX_STEPS_PER_FRAME * PHYSICS_STEP);
    while (accumulator >= PHYSICS_STEP && !sim.done) {
      sim.step();
      accumulator -= PHYSICS_STEP;
    }
    if (!sim.done) {
      draw(accumulator / PHYSICS_STEP);
      return;
    }
    draw(1);
    const result = summarise(sim);
    const resolve = finish;
    cancel();
    resolve(result);
  }

  return {
    start, cancel, frame,
    get busy() { return sim !== null; },
  };
}
