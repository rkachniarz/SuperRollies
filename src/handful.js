// A side's dice as a handful: how they sit together while held (or waiting on
// the table), and how they scatter when let go. Pure arithmetic on numbers and
// a seeded random stream - no DOM, no physics.
//
// Every die in a handful is at least its circumradius plus HAND_GAP from its
// neighbours, so they clear each other in every orientation: a throw never
// starts with two colliders inside each other, which Rapier would resolve by
// flinging them apart before the throw had begun.

import * as THREE from 'three';
import { DIE_RADIUS } from './config.js';

const HAND_GAP = 0.06;

// How many dice go in each row, front to back, for each handful size (up to the
// 8-dice cap, D6). Neighbouring rows that differ by one die nest into each
// other's gaps, like oranges in a crate.
const ROWS = {
  1: [1], 2: [2], 3: [2, 1], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [2, 3, 2], 8: [3, 2, 3],
};

/**
 * Where each of `count` dice of circumradius `radius` sits relative to the
 * handful's centre, and how far the handful reaches from its centre (to the
 * outside of its outermost dice) along x and z. `spread` > 1 spaces them out,
 * for dice lying on the table rather than held.
 * @returns {{ offsets: number[][], reach: { x: number, z: number } }}
 */
export function handLayout(count, radius, spread = 1) {
  const s = (2 * radius + HAND_GAP) * spread;
  const rows = ROWS[count];
  if (!rows) throw new Error(`No layout for ${count} dice`);
  const points = [];
  let z = 0;
  rows.forEach((n, r) => {
    if (r > 0) z += Math.abs(n - rows[r - 1]) === 1 ? s * Math.sqrt(3) / 2 : s;
    for (let i = 0; i < n; i++) points.push([(i - (n - 1) / 2) * s, z]);
  });
  const zMid = z / 2;
  const offsets = points.map(([x, pz]) => [x, pz - zMid]);
  const maxX = Math.max(...offsets.map(([x]) => Math.abs(x)));
  const maxZ = Math.max(...offsets.map(([, oz]) => Math.abs(oz)));
  return { offsets, reach: { x: maxX + radius, z: maxZ + radius } };
}

/**
 * Turns one throw - the hand's velocity `v` and spin `w` - into one per die,
 * each a little different, so a handful breaks up in the air instead of
 * flying as one rigid block (R2.3). A single die keeps the throw exactly.
 * @param {number[]} v
 * @param {number[]} w
 * @param {number[][]} offsets  From handLayout.
 * @param {() => number} rand  A seeded stream (rng.js).
 * @returns {{ v: number[], w: number[] }[]}
 */
export function scatter(v, w, offsets, rand) {
  if (offsets.length === 1) return [{ v, w }];
  return offsets.map(([ox, oz]) => {
    const speed = 1 + (rand() - 0.5) * 0.25;
    const turn = (rand() - 0.5) * 0.3;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    // Fanned out a little from the middle of the hand, as fingers open.
    return {
      v: [
        (v[0] * cos - v[2] * sin) * speed + ox * 0.8,
        v[1] * (1 + (rand() - 0.5) * 0.3),
        (v[0] * sin + v[2] * cos) * speed + oz * 0.8,
      ],
      w: w.map((c) => c + (rand() - 0.5) * 8),
    };
  });
}

/**
 * The opponent's throw: a handful let go from a random spot in `zone` (see
 * opponentZone in arena.js), each die at a random orientation. `zone` bounds
 * the handful's centre. Draws from `rand` in a fixed order, so the same seed
 * throws the same way.
 * @param {{ halfWidth: number, zNear: number, zFar: number }} zone
 * @param {number[][]} offsets  From handLayout.
 * @param {() => number} rand
 * @returns {{ p: number[], q: number[], v: number[], w: number[] }[]}
 */
export function randomHandful({ halfWidth, zNear, zFar }, offsets, rand) {
  const x = (rand() * 2 - 1) * halfWidth;
  const z = zNear + rand() * (zFar - zNear);
  const placed = offsets.map(([ox, oz]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      rand() * Math.PI,
      rand() * Math.PI,
      rand() * Math.PI
    ));
    return { p: [x + ox, DIE_RADIUS + 1.4 + rand() * 0.6, z + oz], q: q.toArray() };
  });
  const v = [(rand() - 0.5) * 5, 0, (rand() - 0.5) * 5];
  const w = [(rand() - 0.5) * 18, (rand() - 0.5) * 18, (rand() - 0.5) * 18];
  const motion = scatter(v, w, offsets, rand);
  return placed.map((d, i) => ({ ...d, ...motion[i] }));
}

// An aimed throw (aimHandful): how fast it's sent at its target (units/s), and
// how much of each die's own scatter it keeps. Measured with check-table.mjs:
// it makes the two handfuls collide about four times as often with one die a
// side, twice as often with eight. Eight a side still stack up now and then:
// 1.9% of Fireball's throws wait out the timeout (0.75% unaimed). Thrown
// harder (5-7.5), or lobbed (with extra lift), they landed on each other's
// far more, and up to 1 throw in 20 did.
const AIM_SPEED = [3, 4.5];
const AIM_SPREAD = 0.3;

/**
 * A handful thrown at `target` ([x, z]) rather than anywhere: the same
 * releases, sent towards it hard enough to get there (No Man's Land, where
 * the opponent throws at the player's dice so they collide). Each die keeps a
 * little of its own scatter, so they don't fly as one.
 * @param {{ p: number[], q: number[], v: number[], w: number[] }[]} releases
 * @param {number[]} target
 * @param {() => number} rand
 */
export function aimHandful(releases, [tx, tz], rand) {
  const mean = (k, of) => releases.reduce((s, r) => s + r[of][k], 0) / releases.length;
  const dx = tx - mean(0, 'p');
  const dz = tz - mean(2, 'p');
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  const speed = AIM_SPEED[0] + rand() * (AIM_SPEED[1] - AIM_SPEED[0]);
  const [vx, vz] = [mean(0, 'v'), mean(2, 'v')];
  return releases.map((r) => ({
    ...r,
    v: [
      (dx / length) * speed + (r.v[0] - vx) * AIM_SPREAD,
      r.v[1],
      (dz / length) * speed + (r.v[2] - vz) * AIM_SPREAD,
    ],
  }));
}

/**
 * A handful's releases lifted, all together, clear of dice lying under where
 * it's let go (Draw Poker's kept dice, held where they lie): each die at
 * least the two circumradii above any it's over, so the throw never starts
 * inside one. All by the same amount, so the handful's own dice stay as far
 * apart as they were.
 * @param {{ p: number[] }[]} releases
 * @param {number[]} radii  Each released die's circumradius.
 * @param {{ p: number[], r: number }[]} lying  Where each die lying there is, and its circumradius.
 */
export function liftClear(releases, radii, lying) {
  let lift = 0;
  releases.forEach(({ p: [x, y, z] }, i) => {
    for (const { p: [ox, oy, oz], r } of lying) {
      const reach = r + radii[i];
      if ((x - ox) ** 2 + (z - oz) ** 2 < reach * reach) lift = Math.max(lift, oy + reach - y);
    }
  });
  return releases.map((release) => ({ ...release, p: [release.p[0], release.p[1] + lift, release.p[2]] }));
}
