// Picking the die up and throwing it.
//
// Pointer Events (not separate mouse/touch handlers) so the exact same code
// drives a mouse drag on desktop and a finger drag on a phone.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  HELD_HEIGHT, HISTORY_MS, THROW_POWER, MIN_DRAG_DISTANCE,
  MAX_THROW_SPEED, MAX_LIFT_SPEED, LIFT_FACTOR, SPIN_POWER,
} from './config.js';

export function createThrowControls({
  canvas, camera, die, clampToTray,
  canGrab, onGrab, onFumble, onThrow, onBoardTap,
}) {
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const heldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HELD_HEIGHT);

  let dragState = null; // { pointerId, startX, startZ, samples: [{t,x,z}] }

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

  function beginGrab(evt) {
    if (!canGrab() || dragState) return;
    setPointerNDC(evt);
    raycaster.setFromCamera(pointerNDC, camera);
    if (raycaster.intersectObject(die.mesh, false).length === 0) return;

    evt.preventDefault();
    canvas.setPointerCapture(evt.pointerId);
    canvas.classList.add('dragging');

    const body = die.body;
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);

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
    };

    onGrab();
  }

  function updateGrab(evt) {
    if (!dragState || evt.pointerId !== dragState.pointerId) return;
    evt.preventDefault();
    const p = pointOnHeldPlane(evt);
    const { x, z } = clampToTray(p.x, p.z);
    die.body.position.set(x, HELD_HEIGHT, z);

    const now = performance.now();
    dragState.samples.push({ t: now, x, z });
    while (dragState.samples.length > 2 && now - dragState.samples[0].t > HISTORY_MS) {
      dragState.samples.shift();
    }
  }

  function endGrab(evt) {
    if (!dragState || evt.pointerId !== dragState.pointerId) return;
    const { samples, startX, startZ } = dragState;
    dragState = null;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* already released */ }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = Math.max((last.t - first.t) / 1000, 1 / 60);
    let vx = ((last.x - first.x) / dt) * THROW_POWER;
    let vz = ((last.z - first.z) / dt) * THROW_POWER;

    const body = die.body;

    // A real toss needs the die to actually have gone somewhere. This is checked
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
      body.type = CANNON.Body.DYNAMIC;
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.wakeUp();
      onFumble();
      return;
    }

    const speed = Math.hypot(vx, vz);
    if (speed > MAX_THROW_SPEED) {
      const s = MAX_THROW_SPEED / speed;
      vx *= s;
      vz *= s;
    }
    const vy = Math.min(speed * LIFT_FACTOR, MAX_LIFT_SPEED);

    body.type = CANNON.Body.DYNAMIC;
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set(
      -vz * SPIN_POWER + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      vx * SPIN_POWER + (Math.random() - 0.5) * 6
    );
    body.wakeUp();

    onThrow();
  }

  canvas.addEventListener('pointerdown', beginGrab);
  canvas.addEventListener('pointermove', updateGrab);
  canvas.addEventListener('pointerup', endGrab);
  canvas.addEventListener('pointercancel', endGrab);

  // Runs after beginGrab (registered first), so if the tap actually picked up
  // the die, dragState is already set and its "Let go to throw" prompt is left
  // alone. A tap anywhere else just clears a lingering card - which is what
  // makes tapping the card itself work even though it doesn't take pointer
  // events (see the note on #result in styles.css).
  canvas.addEventListener('pointerdown', () => {
    if (!dragState) onBoardTap();
  });
}
