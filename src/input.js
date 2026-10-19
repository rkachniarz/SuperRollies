// Picking the dice up and throwing them.
//
// Pointer Events (not separate mouse/touch handlers) so the exact same code
// drives a mouse drag on desktop and a finger drag on a phone.
//
// Grabbing any one of your dice picks up the whole handful (R2.3). A single
// die is held still under the pointer. Several are simulated while held
// (createHoldSim in physics.js): lying in a cupped palm that follows the
// pointer, gently shaken, so they roll about and knock into each other.
// Either way they're thrown together, each with a little variation of its own.

import * as THREE from 'three';
import {
  HELD_HEIGHT, HISTORY_MS, THROW_POWER, MIN_DRAG_DISTANCE,
  MAX_THROW_SPEED, MAX_LIFT_SPEED, LIFT_FACTOR, SPIN_POWER,
  PHYSICS_STEP, MAX_STEPS_PER_FRAME,
} from './config.js';
import { scatter } from './handful.js';
import { createHoldSim, palmFor } from './physics.js';

// How quickly held dice catch up with the hand, per second. Fast enough that
// they are in place well before any real throw ends.
const GATHER_RATE = 30;
const inPalm = new THREE.Vector3();
const turnInPalm = new THREE.Quaternion();

export function createThrowControls({
  canvas, camera, table, arena,
  canGrab, onGrab, onFumble, onThrow, onBoardTap,
  // The seeded source for the random part of a throw's spin (see rng.js).
  random,
}) {
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const heldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HELD_HEIGHT);

  // { pointerId, startX, startZ, samples: [{t,x,z}], dice, hand, targets }, and
  // for a handful its hold simulation (holdHandful).
  let dragState = null;

  function setPointerNDC(evt) {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pointOnHeldPlane(evt) {
    setPointerNDC(evt);
    raycaster.setFromCamera(pointerNDC, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(heldPlane, hit);
    return hit;
  }

  // Where the held dice are headed: centred on (x, z), as far as the handful
  // fits in the player's zone. A single die goes straight there; a simulated
  // handful is drawn toward it.
  function aimHand(x, z) {
    const { hand, targets, hold } = dragState;
    const c = arena.clampToTray(x, z, hold ? hold.reach : hand.reach);
    if (hold) hold.centre = [c.x, c.z];
    else hand.offsets.forEach(([ox, oz], i) => targets[i].set(c.x + ox, HELD_HEIGHT, c.z + oz));
  }

  // A handful is held in a palm (createHoldSim in physics.js) with room for
  // all its dice, kept far enough from the walls that the palm never passes
  // through one.
  function holdHandful(dice, p) {
    const reach = palmFor(dice.length, Math.max(...dice.map((d) => d.radius))).reach;
    const c = arena.clampToTray(p.x, p.z, reach);
    return {
      sim: createHoldSim({
        arenaHalfWidth: arena.arenaHalfWidth,
        // In the player's own half whenever the tray is split, even with no
        // divider (No Man's Land), as clampToTray keeps the hand.
        divider: arena.split,
        tray: arena.tray,
        dice: dice.map((d) => ({ type: d.type, s: d.scale, q: d.mesh.quaternion.toArray() })),
        centre: [c.x, c.z],
      }, random),
      reach,
      centre: [c.x, c.z],
      accumulator: 0,
      // Where the dice were on the table, and for how long they've been
      // gathering up from there into the palm.
      from: dice.map((d) => ({ p: d.mesh.position.clone(), q: d.mesh.quaternion.clone() })),
      gathering: 0,
    };
  }

  function beginGrab(evt) {
    if (!canGrab() || dragState) return;
    setPointerNDC(evt);
    raycaster.setFromCamera(pointerNDC, camera);
    const dice = table.sides.player;
    if (raycaster.intersectObjects(dice.map((d) => d.mesh), false).length === 0) return;

    evt.preventDefault();
    canvas.setPointerCapture(evt.pointerId);
    canvas.classList.add('dragging');

    const p = pointOnHeldPlane(evt);
    // startX/startZ are the grab point itself and never get trimmed away
    // (unlike samples, pruned to a recent window below) - they're what the
    // fumble check needs: total movement across the whole hold, not just its
    // last moment.
    dragState = {
      pointerId: evt.pointerId,
      startX: p.x,
      startZ: p.z,
      samples: [{ t: performance.now(), x: p.x, z: p.z }],
      dice,
      hand: table.hand,
      targets: dice.map(() => new THREE.Vector3()),
      hold: dice.length > 1 ? holdHandful(dice, p) : null,
    };
    aimHand(p.x, p.z);

    onGrab();
  }

  function updateGrab(evt) {
    if (!dragState || evt.pointerId !== dragState.pointerId) return;
    evt.preventDefault();
    const p = pointOnHeldPlane(evt);
    aimHand(p.x, p.z);

    // The samples follow the hand, not the dice: dice pinned against the
    // divider or an edge still get thrown as hard as the hand moved - into
    // that wall, to bounce off it - rather than being judged by the clamped
    // dice, which barely moved, and refused as a fumble.
    const now = performance.now();
    dragState.samples.push({ t: now, x: p.x, z: p.z });
    while (dragState.samples.length > 2 && now - dragState.samples[0].t > HISTORY_MS) {
      dragState.samples.shift();
    }
  }

  /**
   * Where each die is let go from: for a handful, wherever the hold
   * simulation has it, which can't overlap another die or a wall. A single
   * die goes from where it was headed, not where it's drawn: still catching
   * up, it could be anywhere, even inside a wall.
   */
  function poses({ dice, targets, hold }) {
    if (hold) {
      // Once, at the moment of letting go: pushes apart any dice the
      // jostling left overlapping (see settle in physics.js).
      if (!hold.settled) { hold.sim.settle(); hold.settled = true; }
      return hold.sim.poses();
    }
    return dice.map((die, i) => ({ p: targets[i].toArray(), q: die.mesh.quaternion.toArray() }));
  }

  /** Each die as it's let go - the simulation picks them up from here. */
  function release(held, motion) {
    return poses(held).map(({ p, q }, i) => ({ p, q, v: motion[i].v, w: motion[i].w }));
  }

  // Each die's place relative to the middle of the handful, as scatter fans
  // them out from it.
  function offsetsOf(held) {
    const ps = poses(held).map(({ p }) => p);
    const cx = ps.reduce((sum, p) => sum + p[0], 0) / ps.length;
    const cz = ps.reduce((sum, p) => sum + p[2], 0) / ps.length;
    return ps.map((p) => [p[0] - cx, p[2] - cz]);
  }

  const still = (held) => held.dice.map(() => ({ v: [0, 0, 0], w: [0, 0, 0] }));

  /** Lets go of the die. Returns the finished drag, or null if this pointer wasn't holding it. */
  function letGo(evt) {
    if (!dragState || evt.pointerId !== dragState.pointerId) return null;
    const held = dragState;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* already released */ }
    dragState = null;
    return held;
  }

  /** Done with a drag: its hold simulation, if any, is freed. */
  function finish(held) {
    held.hold?.sim.free();
  }

  function endGrab(evt) {
    if (!dragState || evt.pointerId !== dragState.pointerId) return;
    // A sample at the moment of release, not just at the last pointermove: a
    // pointer held still sends no moves, so without it a fast drag that then
    // paused would still be thrown at the speed it had before the pause.
    updateGrab(evt);
    const held = letGo(evt);
    const { samples, startX, startZ } = held;

    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = Math.max((last.t - first.t) / 1000, 1 / 60);
    let vx = ((last.x - first.x) / dt) * THROW_POWER;
    let vz = ((last.z - first.z) / dt) * THROW_POWER;

    // A real toss needs the hand to actually have gone somewhere. This is checked
    // by total distance travelled (grab point to release point), not by how fast
    // that happened: an earlier version gated on velocity instead, computed from
    // timestamps a couple of pointermove events apart, and that turned out to be
    // unreliable - the moment the browser is even briefly busy (a slow frame, a
    // loaded device), the same physical drag gets timed very differently and a
    // perfectly genuine, unhurried throw could be measured as "too slow".
    // Distance from the original grab point doesn't care how long it took, so it
    // isn't sensitive to that jitter, while it still refuses a barely-there
    // nudge (grab the die a hair, let go) that would otherwise let it drop back
    // with next to no tumble and settle on whatever face it was already showing
    // - a free reroll of a result you like rather than a genuine throw.
    const dragDistance = Math.hypot(last.x - startX, last.z - startZ);
    if (dragDistance < MIN_DRAG_DISTANCE) {
      onFumble(release(held, still(held)));
      finish(held);
      return;
    }

    const speed = Math.hypot(vx, vz);
    if (speed > MAX_THROW_SPEED) {
      const s = MAX_THROW_SPEED / speed;
      vx *= s;
      vz *= s;
    }
    const vy = Math.min(speed * LIFT_FACTOR, MAX_LIFT_SPEED);

    const spin = [
      -vz * SPIN_POWER + (random() - 0.5) * 6,
      (random() - 0.5) * 6,
      vx * SPIN_POWER + (random() - 0.5) * 6,
    ];
    onThrow(release(held, scatter([vx, vy, vz], spin, offsetsOf(held), random)));
    finish(held);
  }

  // The browser took the gesture away mid-drag (a system gesture, an incoming
  // call): the die just drops back where it is. Not a throw - the player never
  // let go - and not a fumble to scold them for either.
  function cancelGrab(evt) {
    const held = letGo(evt);
    if (!held) return;
    onFumble(release(held, still(held)), { cancelled: true });
    finish(held);
  }

  canvas.addEventListener('pointerdown', beginGrab);
  canvas.addEventListener('pointermove', updateGrab);
  canvas.addEventListener('pointerup', endGrab);
  canvas.addEventListener('pointercancel', cancelGrab);

  // Runs after beginGrab (registered first), so if the tap actually picked up
  // the die, dragState is already set and its "Let go to throw" prompt is left
  // alone. A tap anywhere else just clears a lingering card - which is what
  // makes tapping the card itself work even though it doesn't take pointer
  // events (see the note on #result in styles.css).
  canvas.addEventListener('pointerdown', () => {
    if (!dragState) onBoardTap();
  });

  return {
    /** Moves held dice toward the hand. Called once per frame. */
    frame(dt) {
      if (!dragState) return;
      const { dice, targets, hold } = dragState;
      if (!hold) {
        const t = 1 - Math.exp(-GATHER_RATE * dt);
        dice.forEach((die, i) => die.mesh.position.lerp(targets[i], t));
        return;
      }
      // Fixed steps, like a throw: the simulation stays steady whatever the
      // frame rate.
      hold.accumulator = Math.min(hold.accumulator + dt, MAX_STEPS_PER_FRAME * PHYSICS_STEP);
      while (hold.accumulator >= PHYSICS_STEP) {
        hold.sim.step(hold.centre);
        hold.accumulator -= PHYSICS_STEP;
      }
      // Drawn gliding up from the table into the palm, where the simulation
      // starts them, rather than jumping there.
      hold.gathering += dt;
      const t = 1 - Math.exp(-GATHER_RATE * hold.gathering);
      hold.sim.poses().forEach(({ p, q }, i) => {
        const { mesh } = dice[i];
        mesh.position.lerpVectors(hold.from[i].p, inPalm.fromArray(p), t);
        mesh.quaternion.slerpQuaternions(hold.from[i].q, turnInPalm.fromArray(q), t);
      });
    },
  };
}
