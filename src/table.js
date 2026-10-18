// The dice on the table: what each side throws this match, and where they wait
// between throws. Rebuilt for every match, since the dice set decides how many
// dice there are, of which types, and how big the tray is. Between rounds a
// side can gain a die or lose one again, when a Spice changes its hand
// (Underdog's extra die, Inspiration's advantage).

import * as THREE from 'three';
import { THEMES } from './config.js';
import { createDie } from './dice.js';
import { SHAPES } from './die-shapes.js';
import { handLayout } from './handful.js';

// How far a die may overlap a wall before it counts as past it: contacts give
// a little, and a die resting against a wall must never be moved.
const WALL_GIVE = 0.02;
const corner = new THREE.Vector3();

/**
 * How far a die reaches to its left and to its right from its centre, as it
 * is turned right now. Each side separately: a d4 lying against a wall on a
 * face reaches only a third as far towards it as its top corner reaches the
 * other way, and taking the larger for both slid every d4 resting against a
 * side wall half a die inwards, often into its neighbour.
 */
function sideReach(die) {
  let left = 0;
  let right = 0;
  for (const v of SHAPES[die.type].verts) {
    const x = corner.fromArray(v).applyQuaternion(die.mesh.quaternion).x;
    left = Math.max(left, -x);
    right = Math.max(right, x);
  }
  return { left: left * die.scale, right: right * die.scale };
}

export function createTable(arena) {
  /** @type {{ player: ReturnType<typeof createDie>[], opponent: ReturnType<typeof createDie>[] }} */
  const sides = { player: [], opponent: [] };
  const byId = new Map();
  // How each side's dice sit together while held, and how far that reaches.
  const hands = { player: handLayout(1, 1), opponent: handLayout(1, 1) };
  // This match's die scale, for dice added between rounds.
  let scale = 1;

  function addDie(side, type, i) {
    const die = createDie({ type, theme: THEMES[side], scale, scene: arena.scene });
    const id = `${side}-${i}`;
    byId.set(id, die.mesh);
    return { ...die, id };
  }

  // Mixed sets (a d20 with d6s) are spaced for the biggest die.
  function measureHand(side) {
    const dice = sides[side];
    if (dice.length) hands[side] = handLayout(dice.length, Math.max(...dice.map((d) => d.radius)));
  }

  /**
   * Lays the table out for a match: `types` is one side's dice (dieTypes in
   * rules/dice-sets.js), at the dice set's `scale`, in its `tray`. Without an
   * `opponent` there's no opponent's dice and no divider (Zen).
   */
  function setup({ types, scale: dieScale, tray, opponent }) {
    for (const die of [...sides.player, ...sides.opponent]) die.remove();
    byId.clear();
    scale = dieScale;
    arena.setTray(tray);
    arena.setDivider(opponent);
    for (const side of /** @type {const} */ (['player', 'opponent'])) {
      sides[side] = side === 'opponent' && !opponent ? [] : types.map((type, i) => addDie(side, type, i));
      measureHand(side);
    }
    const hand = hands.player;
    const radius = Math.max(...sides.player.map((d) => d.radius));

    // Waiting on the table, the dice are spaced out a little more than in
    // the hand, unless that wouldn't fit.
    let rest = handLayout(types.length, radius, 1.3);
    if (rest.reach.x > arena.xLimit(0) || rest.reach.z * 2 > tray.depth * 0.9) rest = hand;
    // In the middle of each side's half, as far as the handful fits.
    const centre = arena.clampToTray(0, tray.depth / 2, rest.reach);
    for (const [side, mirror] of [['player', 1], ['opponent', -1]]) {
      sides[side].forEach((die, i) => {
        const [ox, oz] = rest.offsets[i];
        // A different turn for each die, so a row of them doesn't look stamped
        // out. Cosmetic: where the dice wait never enters a throw, which
        // starts from where they're held.
        die.placeAt(centre.x + ox, mirror * (centre.z + oz), i * 0.9);
      });
    }
  }

  /**
   * Gives `side` the dice in `types` for the coming round. The ones it already
   * has stay where they lie; any it no longer throws (always the last, as a
   * Spice only ever adds dice at the end) are taken away, and any new ones are
   * put down in the clearest spot in that side's half.
   * @param {'player' | 'opponent'} side
   * @param {string[]} types
   */
  function setHand(side, types) {
    const dice = sides[side];
    let keep = 0;
    while (keep < dice.length && keep < types.length && dice[keep].type === types[keep]) keep++;
    for (const die of dice.splice(keep)) {
      die.remove();
      byId.delete(die.id);
    }
    for (let i = keep; i < types.length; i++) {
      const die = addDie(side, types[i], i);
      const { x, z } = clearestSpot(side, die.radius);
      die.placeAt(x, z, i * 0.9);
      dice.push(die);
    }
    measureHand(side);
  }

  // The spot in `side`'s half furthest from any of its dice, for a die of
  // circumradius `radius` to be put down on. A coarse grid is plenty: it only
  // decides where a die waits, never how a throw goes.
  function clearestSpot(side, radius) {
    const mirror = side === 'player' ? 1 : -1;
    const reach = { x: radius, z: radius };
    const far = arena.clampToTray(0, Infinity, reach).z;
    const near = arena.clampToTray(0, 0, reach).z;
    const wide = arena.clampToTray(Infinity, 0, reach).x;
    let best = { x: 0, z: mirror * near, clear: -Infinity };
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 6; j++) {
        const x = -wide + (2 * wide * i) / 8;
        const z = mirror * (near + ((far - near) * j) / 6);
        const clear = Math.min(...sides[side].map((d) => Math.hypot(d.mesh.position.x - x, d.mesh.position.z - z)));
        if (clear > best.clear) best = { x, z, clear };
      }
    }
    return best;
  }

  // The on-screen strip narrows when the window does (a phone turned upright),
  // and a die already at rest past its new edge couldn't be tapped, stranding
  // the match. Between throws, such a die is slid back in.
  //
  // By how far the die actually reaches sideways, turned as it is - not its
  // circumradius. A d6 lying against a wall sits half its side from it, much
  // closer than its circumradius, and holding it to that made every die that
  // came to rest against a side wall jump inwards as the throw ended.
  function keepOnScreen() {
    const wall = arena.xLimit(0);
    for (const die of [...sides.player, ...sides.opponent]) {
      const { left, right } = sideReach(die);
      const x = die.mesh.position.x;
      die.mesh.position.x = Math.max(-(wall - left + WALL_GIVE), Math.min(wall - right + WALL_GIVE, x));
    }
  }

  return {
    setup,
    setHand,
    keepOnScreen,
    sides,
    /** The mesh of the die with this id (as in a throw record), e.g. 'player-0'. */
    meshFor: (id) => byId.get(id),
    /** How the player's dice sit in the hand. */
    get hand() { return hands.player; },
    hands,
  };
}
