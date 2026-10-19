// Things on the table that are drawn but never simulated: streaks on the
// breeze (Gusty Table) and the cat's paw (Cat Paw). Neither touches a die -
// the breeze's push and the paw's knock are in the throw's record (physics.js)
// - so they're free to use Math.random: nothing here decides a result.

import * as THREE from 'three';
import { TRAY_HALF_WIDTH } from './config.js';

const STREAKS = 22;
const STREAK_SPEED = 3.2; // units/s, at the strongest breeze
const FADE_RATE = 3; // per second

// The paw's timing, in seconds: reaching in to the die, following through
// past it, and pulling back out.
const PAW_IN = 0.32;
const PAW_FOLLOW = 0.12;
const PAW_OUT = 0.45;
const FUR = 0x9a8f86;
const TOES = 0xd8cfc7;

const easeIn = (t) => t * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

export function createEffects(arena) {
  const group = new THREE.Group();
  arena.scene.add(group);

  // ---------- The breeze ----------
  const streaks = Array.from({ length: STREAKS }, () => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.035),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.order = 'YXZ';
    group.add(mesh);
    return { mesh, along: 0, across: 0, y: 0, length: 1, alpha: 0 };
  });
  let wind = null;
  let shown = 0;

  // The breeze's direction and how far it is from where a streak starts,
  // upwind of the tray, to where it leaves it downwind.
  function frameOfWind() {
    const { halfWidth, depth } = arena.tray;
    const [wx, wz] = wind;
    const strength = Math.hypot(wx, wz);
    const dx = wx / strength;
    const dz = wz / strength;
    // Half the tray's extent along the breeze, plus a margin.
    const reach = Math.abs(dx) * halfWidth + Math.abs(dz) * depth + 0.5;
    return { dx, dz, strength, reach };
  }

  function respawn(streak, anywhere) {
    const { halfWidth, depth } = arena.tray;
    const { reach } = frameOfWind();
    streak.along = anywhere ? (Math.random() * 2 - 1) * reach : -reach;
    streak.across = (Math.random() * 2 - 1) * Math.max(halfWidth, depth);
    streak.y = 0.15 + Math.random() * 1.1;
    streak.length = 0.4 + Math.random() * 0.9;
    streak.alpha = 0.12 + Math.random() * 0.22;
  }

  /** The breeze for the coming throw, [x, z] in units/s², or none. */
  function setWind(next) {
    wind = next;
    if (wind) for (const streak of streaks) respawn(streak, true);
  }

  function frameWind(dt, rolling) {
    const target = wind && rolling ? 1 : 0;
    shown += Math.sign(target - shown) * Math.min(Math.abs(target - shown), FADE_RATE * dt);
    for (const { mesh } of streaks) mesh.visible = shown > 0;
    if (!wind || shown <= 0) return;
    const { dx, dz, strength, reach } = frameOfWind();
    const speed = STREAK_SPEED * (strength / 5);
    for (const streak of streaks) {
      streak.along += speed * dt * (1.5 + streak.y);
      if (streak.along > reach) respawn(streak, false);
      const { mesh } = streak;
      mesh.position.set(dx * streak.along - dz * streak.across, streak.y, dz * streak.along + dx * streak.across);
      mesh.rotation.y = Math.atan2(-dz, dx);
      mesh.scale.x = streak.length;
      // Faded in at the start of its run and out at the end.
      const edge = Math.min(1, (reach - Math.abs(streak.along)) / 1.2);
      mesh.material.opacity = streak.alpha * shown * Math.max(0, edge);
    }
  }

  // ---------- The paw ----------
  const furMaterial = new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.9 });
  const toeMaterial = new THREE.MeshStandardMaterial({ color: TOES, roughness: 0.9 });

  // A paw at the end of a long arm, reaching along its local +x. Built at
  // The Classic's size; scaled with the tray.
  function makePaw() {
    const paw = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 5, 14), furMaterial);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = -2.7;
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 12), furMaterial);
    pad.scale.set(1.05, 0.55, 0.95);
    paw.add(arm, pad);
    for (const [x, z] of [[0.3, -0.27], [0.4, -0.09], [0.4, 0.09], [0.3, 0.27]]) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), toeMaterial);
      toe.scale.set(1, 0.7, 1);
      toe.position.set(x, 0.05, z);
      paw.add(toe);
    }
    paw.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return paw;
  }

  /** @type {{ paw: THREE.Group, from: THREE.Vector3, hit: THREE.Vector3, past: THREE.Vector3, t: number }[]} */
  let swipes = [];
  let onContact = null;

  /**
   * Swipes a paw at each of `targets` at once, each in from beyond the side
   * wall `from` (+1 or -1 along x) and heading `dir` ([x, z], unit length),
   * stopping its pad `reach` short of the die's centre. Resolves when the
   * paws touch the dice; they then follow through and pull back on their own.
   * @param {{ x: number, y: number, z: number, from: number, dir: number[], reach: number }[]} targets
   */
  function swipe(targets) {
    const k = arena.tray.halfWidth / TRAY_HALF_WIDTH;
    swipes = targets.map(({ x, y, z, dir, reach }) => {
      const paw = makePaw();
      paw.scale.setScalar(k);
      paw.rotation.y = Math.atan2(-dir[1], dir[0]);
      group.add(paw);
      const hit = new THREE.Vector3(x - dir[0] * reach, Math.max(y, 0.3 * k), z - dir[1] * reach);
      // From beyond the tray's side wall, along the same line.
      const run = Math.abs(hit.x - (-Math.sign(dir[0]) * (arena.tray.halfWidth + 1.2 * k))) / Math.max(0.3, Math.abs(dir[0]));
      const from = hit.clone().addScaledVector(new THREE.Vector3(dir[0], 0, dir[1]), -run);
      const past = hit.clone().addScaledVector(new THREE.Vector3(dir[0], 0, dir[1]), 0.35 * k);
      paw.position.copy(from);
      return { paw, from, hit, past, t: 0 };
    });
    return new Promise((resolve) => { onContact = resolve; });
  }

  function framePaws(dt) {
    if (!swipes.length) return;
    for (const s of swipes) {
      s.t += dt;
      const { paw, from, hit, past } = s;
      if (s.t < PAW_IN) paw.position.lerpVectors(from, hit, easeIn(s.t / PAW_IN));
      else if (s.t < PAW_IN + PAW_FOLLOW) paw.position.lerpVectors(hit, past, easeOut((s.t - PAW_IN) / PAW_FOLLOW));
      else paw.position.lerpVectors(past, from, easeIn(Math.min(1, (s.t - PAW_IN - PAW_FOLLOW) / PAW_OUT)));
    }
    if (onContact && swipes[0].t >= PAW_IN) {
      const resolve = onContact;
      onContact = null;
      resolve();
    }
    if (swipes.every((s) => s.t >= PAW_IN + PAW_FOLLOW + PAW_OUT)) clear();
  }

  /** Takes any paw away at once (a match left mid-swipe). */
  function clear() {
    for (const { paw } of swipes) {
      group.remove(paw);
      paw.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    swipes = [];
    onContact = null;
  }

  return {
    setWind,
    swipe,
    clear,
    /** Called once per frame; `rolling` while dice are in motion. */
    frame(dt, rolling) {
      frameWind(dt, rolling);
      framePaws(dt);
    },
  };
}
