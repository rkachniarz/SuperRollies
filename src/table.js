// The dice on the table: what each side throws this match, and where they wait
// between throws. Rebuilt for every match, since the dice set decides how many
// dice there are, of which types, and how big the tray is.

import * as THREE from 'three';
import { THEMES } from './config.js';
import { createDie } from './dice.js';
import { SHAPES } from './die-shapes.js';
import { handLayout } from './handful.js';

// How far a die may overlap a wall before it counts as past it: contacts give
// a little, and a die resting against a wall must never be moved.
const WALL_GIVE = 0.02;
const corner = new THREE.Vector3();

/** How far a die reaches sideways from its centre, as it is turned right now. */
function sideReach(die) {
  let reach = 0;
  for (const v of SHAPES[die.type].verts) {
    reach = Math.max(reach, Math.abs(corner.fromArray(v).applyQuaternion(die.mesh.quaternion).x));
  }
  return reach * die.scale;
}

export function createTable(arena) {
  /** @type {{ player: ReturnType<typeof createDie>[], opponent: ReturnType<typeof createDie>[] }} */
  const sides = { player: [], opponent: [] };
  const byId = new Map();
  // How a side's dice sit together while held, and how far that reaches.
  let hand = handLayout(1, 1);

  /**
   * Lays the table out for a match: `types` is one side's dice (dieTypes in
   * rules/dice-sets.js), at the dice set's `scale`, in its `tray`. Without an
   * `opponent` there's no opponent's dice and no divider (Zen).
   */
  function setup({ types, scale, tray, opponent }) {
    for (const die of [...sides.player, ...sides.opponent]) die.remove();
    byId.clear();
    arena.setTray(tray);
    arena.setDivider(opponent);
    for (const side of /** @type {const} */ (['player', 'opponent'])) {
      sides[side] = side === 'opponent' && !opponent ? [] : types.map((type, i) => {
        const die = createDie({ type, theme: THEMES[side], scale, scene: arena.scene });
        const id = `${side}-${i}`;
        byId.set(id, die.mesh);
        return { ...die, id };
      });
    }
    // Mixed sets (a d20 with d6s) are spaced for the biggest die.
    const radius = Math.max(...sides.player.map((d) => d.radius));
    hand = handLayout(types.length, radius);

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
      const limit = wall - sideReach(die) + WALL_GIVE;
      die.mesh.position.x = Math.max(-limit, Math.min(limit, die.mesh.position.x));
    }
  }

  return {
    setup,
    keepOnScreen,
    sides,
    /** The mesh of the die with this id (as in a throw record), e.g. 'player-0'. */
    meshFor: (id) => byId.get(id),
    get hand() { return hand; },
  };
}
