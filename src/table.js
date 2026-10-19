// The dice on the table: what each side throws this match, and where they wait
// between throws. Rebuilt for every match, since the dice set decides how many
// dice there are, of which types, and how big the tray is. Between rounds a
// side can gain a die or lose one again, when a Spice changes its hand
// (Underdog's extra die, Inspiration's advantage), or lose one for good
// (Burnout). After a round, a die the rules exploded has its extra rolls pop
// out of it as dice of their own, and a cursed one shows a red 0: both only
// for show, until the next throw.

import * as THREE from 'three';
import { THEMES, DIVIDER_T } from './config.js';
import { createDie } from './dice.js';
import { SHAPES } from './die-shapes.js';
import { handLayout } from './handful.js';

// How far a die may overlap a wall before it counts as past it: contacts give
// a little, and a die resting against a wall must never be moved.
const WALL_GIVE = 0.02;
const corner = new THREE.Vector3();

// How many ways a popped die is tried in, looking for the most room.
const POP_DIRECTIONS = 24;
// How it's sent off (units/s): up, and away faster the more room it has.
const POP_UP = 2.6;
const POP_AWAY = [2, 6];
const POP_SPIN = 9;
const POP_GLOW = 0xff8a1f;

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
  // Dice popped out of exploded ones this round (popOut).
  const pops = [];

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
   * `opponent` there's no opponent's dice and no divider (Zen). A Spice may
   * take the divider away anyway (No Man's Land), put `holes` in the floor
   * (Pothole) or a `rope` down the middle (Tug of War); no die is put down
   * over a hole or on the rope.
   */
  function setup({ types, scale: dieScale, tray, opponent, divider = opponent, holes = [], rope = false }) {
    tidy();
    for (const die of [...sides.player, ...sides.opponent]) die.remove();
    byId.clear();
    scale = dieScale;
    arena.setTray(tray);
    arena.setHoles(holes);
    arena.setRope(rope);
    arena.setDivider(divider, opponent);
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
      // Any that would sit over a hole or on the rope are put down elsewhere.
      sides[side].forEach((die, i) => {
        const { x, z } = die.mesh.position;
        if (clearance(x, z) >= die.radius) return;
        const spot = clearestSpot(side, die.radius, die);
        die.placeAt(spot.x, spot.z, i * 0.9);
      });
    }
  }

  // How far (x, z) is from the edge of the nearest hole, or from the rope;
  // Infinity with neither.
  function clearance(x, z) {
    const rope = arena.rope ? Math.abs(x) - arena.rope : Infinity;
    return Math.min(rope, ...arena.holes.map((h) => Math.hypot(h.x - x, h.z - z) - h.r));
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

  /**
   * Takes `side`'s dice at `indices` off the table for good, from where they
   * lie (Burnout's burnt dice). The rest stay put, numbered afresh, so a
   * side's dice are always `player-0` onwards in order, as throw records and
   * the rules expect.
   * @param {'player' | 'opponent'} side
   * @param {number[]} indices
   */
  function removeDice(side, indices) {
    const dice = sides[side];
    for (const die of dice) byId.delete(die.id);
    for (const i of [...new Set(indices)].sort((a, b) => b - a)) dice.splice(i, 1)[0].remove();
    dice.forEach((die, i) => {
      die.id = `${side}-${i}`;
      byId.set(die.id, die.mesh);
    });
    measureHand(side);
  }

  // The spot in `side`'s half furthest from any of its dice (bar `except`),
  // for a die of circumradius `radius` to be put down on, and never over a
  // hole or on the rope. A coarse grid is plenty: it only decides where a die waits, never
  // how a throw goes.
  function clearestSpot(side, radius, except = null) {
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
        const free = clearance(x, z);
        if (free < radius) continue;
        const clear = Math.min(free, ...sides[side].filter((d) => d !== except)
          .map((d) => Math.hypot(d.mesh.position.x - x, d.mesh.position.z - z)));
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

  /**
   * A die popped out of `source` (an exploded die, or a die popped out of
   * one) for `side`, of the same type: put down just above it, and the
   * release that sends it off - up, and away towards wherever in that side's
   * half has most room, rolling as it goes. Its pose is the physics' to set
   * (it's a body in the throw record); `face` is its die, inside it, which
   * the game turns so it lands on the roll the rules drew (turnShowing in
   * die-shapes.js). Shown, never thrown: tidy() takes it away.
   */
  function popOut(side, source) {
    const face = createDie({ type: source.type, theme: THEMES[side], scale: source.scale, scene: arena.scene });
    // Aglow, so it's told apart from the dice thrown.
    face.mesh.material.emissive.set(POP_GLOW);
    face.mesh.material.emissiveIntensity = 0.45;
    const mesh = new THREE.Group();
    mesh.add(face.mesh);
    arena.scene.add(mesh);
    const id = `pop-${side}-${pops.length}`;
    const pop = { id, type: source.type, scale: source.scale, radius: face.radius, mesh, face };
    const { x, z, dx, dz, room } = openest(side, source, pop.radius);
    mesh.position.set(x, source.mesh.position.y + source.radius + pop.radius + 0.05, z);
    mesh.quaternion.copy(source.mesh.quaternion);
    byId.set(id, mesh);
    pops.push(pop);
    const away = Math.min(POP_AWAY[1], Math.max(POP_AWAY[0], POP_AWAY[0] + room));
    return {
      pop,
      release: {
        id, type: pop.type, s: pop.scale, p: mesh.position.toArray(), q: mesh.quaternion.toArray(),
        v: [dx * away, POP_UP, dz * away],
        // Tumbling forwards, about the axis across its path, with a twist.
        w: [dz * POP_SPIN, POP_SPIN / 3, -dx * POP_SPIN],
      },
    };
  }

  /**
   * Where a die of circumradius `radius` popping out of `source` starts (over
   * it, but clear of the walls), and the way out of there with most room
   * before it would hit a wall or another die (bar `source`, which it flies
   * over): its direction and how far that is.
   */
  function openest(side, source, radius) {
    const { depth } = arena.tray;
    const xMax = arena.xLimit(radius);
    const [zMin, zMax] = !arena.divider ? [-depth, depth] : side === 'player' ? [DIVIDER_T, depth] : [-depth, -DIVIDER_T];
    const x = Math.max(-xMax, Math.min(xMax, source.mesh.position.x));
    const z = Math.max(zMin + radius, Math.min(zMax - radius, source.mesh.position.z));
    const others = [...sides.player, ...sides.opponent, ...pops].filter((d) => d !== source);
    let best = { x, z, dx: 0, dz: side === 'player' ? 1 : -1, room: -Infinity };
    for (let k = 0; k < POP_DIRECTIONS; k++) {
      const dx = Math.cos((2 * Math.PI * k) / POP_DIRECTIONS);
      const dz = Math.sin((2 * Math.PI * k) / POP_DIRECTIONS);
      // To the walls...
      let room = Math.min(
        dx > 0 ? (xMax - x) / dx : dx < 0 ? (-xMax - x) / dx : Infinity,
        dz > 0 ? (zMax - radius - z) / dz : dz < 0 ? (zMin + radius - z) / dz : Infinity,
      );
      // ...and to the first die in the way.
      for (const die of others) {
        const ox = die.mesh.position.x - x;
        const oz = die.mesh.position.z - z;
        const along = ox * dx + oz * dz;
        const reach = die.radius + radius;
        const across = ox * ox + oz * oz - along * along;
        if (along > 0 && across < reach * reach) room = Math.min(room, along - Math.sqrt(reach * reach - across));
      }
      if (room > best.room) best = { x, z, dx, dz, room: Math.max(0, room) };
    }
    return best;
  }

  /**
   * Where each die on the table is on screen (popped ones too): a circle
   * round it, in CSS pixels, for keeping controls clear of them (DEV_PLAN.md
   * 4.6a).
   * @returns {{ x: number, y: number, r: number }[]}
   */
  function onScreen() {
    const { camera, renderer } = arena;
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = (v) => {
      v.project(camera);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };
    return [...sides.player, ...sides.opponent, ...pops].map((die) => {
      const at = die.mesh.getWorldPosition(new THREE.Vector3());
      const centre = toScreen(at.clone());
      const edge = toScreen(at.clone().setX(at.x + die.radius));
      return { ...centre, r: Math.abs(edge.x - centre.x) };
    });
  }

  /** Clears what the last round left on the table: popped dice, cursed numbers. */
  function tidy() {
    for (const pop of pops.splice(0)) {
      arena.scene.remove(pop.mesh);
      pop.face.remove();
      byId.delete(pop.id);
    }
    for (const die of [...sides.player, ...sides.opponent]) die.showCursed(null);
  }

  return {
    setup,
    setHand,
    removeDice,
    popOut,
    tidy,
    onScreen,
    /** Dice popped out of exploded ones this round. */
    pops,
    keepOnScreen,
    sides,
    /** The mesh of the die with this id (as in a throw record), e.g. 'player-0'. */
    meshFor: (id) => byId.get(id),
    /** How the player's dice sit in the hand. */
    get hand() { return hands.player; },
    hands,
  };
}
