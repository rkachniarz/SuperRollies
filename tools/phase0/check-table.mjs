// The Spice that change the table (docs/history.md 5.1-5.3, 5.6): throws onto a
// floor with holes in it (Pothole), in a breeze (Gusty Table), with no
// divider (No Man's Land, the opponent throwing at the player's dice), the
// knock a cat's paw gives dice at rest (Cat Paw), and over a rope down the
// middle (Tug of War), and a redraw: some dice thrown again onto the rest,
// held where they lie (Draw Poker). Every step of every throw is checked: no die sinks into the floor or
// through a pit's bottom, none leaves the tray, and with the divider up none
// crosses it. At rest, a die counted as fallen is down a pit and one not
// counted is on the floor. And the throws settle, bar a few timeouts.
//
//   node tools/phase0/check-table.mjs [throws per case=100] [only ids containing this]
//
// Throws are made the way check-handfuls.mjs makes them, from anywhere a held
// handful can be, at anything up to the hardest the gesture allows. Holes and
// breezes are the rules' own (tableOf), from a different seed each throw.

import { initPhysics, createRoundSim, TIMEOUT_STEPS } from '../../src/physics.js';
import { SHAPES } from '../../src/die-shapes.js';
import { handLayout, scatter, randomHandful, aimHandful, liftClear } from '../../src/handful.js';
import { DICE_SETS, dieTypes } from '../../src/rules/dice-sets.js';
import { matchConfig, resolveRules, startMatch, beginRound, tableOf } from '../../src/rules/engine.js';
import { DIVIDER_T, DIE_RADIUS, HELD_HEIGHT, MAX_THROW_SPEED, MAX_LIFT_SPEED, SPIN_POWER, PHYSICS_STEP } from '../../src/config.js';
import { replayThrow } from '../../src/replay.js';
import { mulberry32, randomQuaternion } from './rng.mjs';

const THROWS = Number(process.argv[2] ?? 100);
const ONLY = process.argv[3];
const MAX_TIMEOUT_RATE = 0.02;
await initPhysics();
const rand = mulberry32(0x7AB1E);

// One die and the most dice, the biggest dice and the d4's corners.
const SETS = ['classic', 'fireball', 'the-whole-bag', 'swarm-of-daggers'];
const SPICE = ['pothole', 'gusty-table', 'no-mans-land', 'cat-paw', 'tug-of-war', 'draw-poker'];
// The sets a Spice is checked with, where it's only played with some.
const SETS_FOR = { 'draw-poker': ['dice-poker'] };

/** A throw like the game's: both sides' handfuls on the table the rules lay out for `seed`. */
function throwFor(set, spice, seed) {
  const rules = resolveRules(matchConfig({ seed, diceSet: set.id, spice }));
  const { state } = beginRound(rules, startMatch(rules));
  const { holes, wind, divider, rope } = tableOf(rules, state);
  const types = dieTypes(set);
  const { tray, dieScale } = set;
  const radius = Math.max(...types.map((t) => SHAPES[t].circumradius * dieScale));
  const { offsets, reach } = handLayout(types.length, radius);
  const xMax = tray.halfWidth - reach.x;
  const zMin = DIVIDER_T + reach.z;
  const zMax = tray.depth - reach.z;
  const cx = (rand() * 2 - 1) * xMax;
  const cz = zMin + rand() * (zMax - zMin);
  const angle = rand() * Math.PI * 2;
  const speed = MAX_THROW_SPEED * (0.3 + rand() * 0.7);
  const vx = Math.cos(angle) * speed;
  const vz = Math.sin(angle) * speed;
  const spin = [-vz * SPIN_POWER + (rand() - 0.5) * 6, (rand() - 0.5) * 6, vx * SPIN_POWER + (rand() - 0.5) * 6];
  const motion = scatter([vx, MAX_LIFT_SPEED * rand(), vz], spin, offsets, rand);
  const player = offsets.map(([ox, oz], k) => ({ p: [cx + ox, HELD_HEIGHT, cz + oz], q: randomQuaternion(rand), ...motion[k] }));
  const thrown = randomHandful({
    halfWidth: Math.min(tray.halfWidth * 0.55, xMax), zNear: -(DIVIDER_T + reach.z), zFar: Math.max(-tray.depth * 0.75, -zMax),
  }, offsets, rand);
  // With no divider, at the player's dice, as the game throws it.
  const opponent = divider ? thrown : aimHandful(thrown, [cx, cz], rand);
  return {
    v: 1, arenaHalfWidth: tray.halfWidth - DIE_RADIUS, divider, tray,
    ...(holes.length ? { holes } : {}), ...(wind ? { wind } : {}), ...(rope ? { rope: true } : {}),
    dice: [
      ...opponent.map((r, k) => ({ id: `opponent-${k}`, type: types[k], s: dieScale, ...r })),
      ...player.map((r, k) => ({ id: `player-${k}`, type: types[k], s: dieScale, ...r })),
    ],
  };
}

/**
 * The knock a cat's paw gives (catPaw in game.js), to a random die or two of
 * a throw at rest: each from the side wall nearer it, towards the middle.
 */
function knockFor(record, result) {
  const knocked = new Map();
  const count = rand() < 0.5 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const { id, p } = result.dice[Math.floor(rand() * result.dice.length)];
    const from = p[0] >= 0 ? 1 : -1;
    const power = 0.5 + 0.5 * rand();
    const turn = rand() * 2 - 1;
    const v = [-from * (2.5 + 3 * power), 1 + 1.5 * power, turn * (1 + power)];
    knocked.set(id, { v, w: [v[2] * 3, turn * 4, -v[0] * 3] });
  }
  const at = Object.fromEntries(result.dice.map((d) => [d.id, d]));
  return {
    ...record,
    dice: record.dice.map(({ id, type, s }) => ({
      id, type, s, p: at[id].p, q: at[id].q, ...(knocked.get(id) ?? { v: [0, 0, 0], w: [0, 0, 0] }),
    })),
  };
}

/**
 * A redraw (Draw Poker, redraw in game.js), from a throw at rest: each die
 * thrown again or not at random, at least one of the player's; those that
 * aren't held where they lie, and each side's handful let go as a fresh
 * throw's is, lifted clear of them.
 */
function redrawFor(record, result, fresh) {
  const at = Object.fromEntries(result.dice.map((d) => [d.id, d]));
  const again = new Set(record.dice.filter((d) => rand() < 0.5).map((d) => d.id));
  again.add('player-0');
  const radius = (d) => SHAPES[d.type].circumradius * (d.s ?? 1);
  const lying = record.dice.filter((d) => !again.has(d.id)).map((d) => ({ p: at[d.id].p, r: radius(d) }));
  const released = new Map();
  for (const side of ['player', 'opponent']) {
    const dice = fresh.dice.filter((d) => d.id.startsWith(side) && again.has(d.id));
    liftClear(dice, dice.map(radius), lying).forEach((release) => released.set(release.id, release));
  }
  return {
    ...record,
    dice: record.dice.map((d) => released.get(d.id) ??
      { id: d.id, type: d.type, s: d.s, p: at[d.id].p, q: at[d.id].q, v: [0, 0, 0], w: [0, 0, 0], fixed: true }),
  };
}

let failures = 0;
for (const spice of SPICE) {
  for (const setId of SETS_FOR[spice] ?? SETS) {
    const id = `${spice}/${setId}`;
    if (ONLY && !id.includes(ONLY)) continue;
    const set = DICE_SETS[setId];
    const { tray } = set;
    const restOf = (type) => SHAPES[type].restHeight * set.dieScale;
    let problems = 0;
    let timeouts = 0;
    let fallen = 0;
    let dice = 0;
    let steps = 0;
    for (let i = 0; i < THROWS; i++) {
      let record = throwFor(set, spice, i);
      // Cat Paw: the knock is what's checked, from where a throw came to rest.
      if (spice === 'cat-paw') record = knockFor(record, replayThrow(record));
      // Draw Poker: the redraw is what's checked, onto a throw at rest.
      if (spice === 'draw-poker') record = redrawFor(record, replayThrow(record), throwFor(set, spice, i + THROWS));
      const holes = record.holes ?? [];
      const pitOf = (x, z) => holes.find((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r);
      // Near enough a hole to be tipped over its rim, a die can sit lower
      // than on the floor while its centre is still outside the hole.
      const rimOf = (x, z, type) => holes.find((h) => Math.hypot(x - h.x, z - h.z) < h.r + SHAPES[type].circumradius * set.dieScale);
      const sim = createRoundSim(record, { clamp: false });
      let problem = null;
      while (!sim.done && !problem) {
        sim.step();
        for (const d of sim.dice) {
          const [x, y, z] = d.curr.p;
          const pit = rimOf(x, z, d.type);
          // Over a pit or tipping into one, a die may go down as far as
          // lying on its bottom.
          const floor = pit ? -pit.depth : 0;
          if (y < floor + restOf(d.type) * 0.6) problem = `${d.id} sank to y=${y.toFixed(3)}${pit ? ' in a pit' : ''}`;
          else if (Math.abs(x) > tray.halfWidth || Math.abs(z) > tray.depth) problem = `${d.id} left the tray`;
          else if (record.divider !== false && Math.sign(z) !== (d.id.startsWith('player') ? 1 : -1)) problem = `${d.id} crossed the divider`;
          if (problem) { problem += ` at step ${sim.steps}`; break; }
        }
      }
      for (const d of sim.dice) {
        if (problem) break;
        const [x, y, z] = d.curr.p;
        const pit = pitOf(x, z);
        dice++;
        if (y < 0) {
          fallen++;
          if (!rimOf(x, z, d.type)) problem = `${d.id} counted as fallen but isn't in a pit, at [${d.curr.p.map((n) => n.toFixed(2))}]`;
        } else if (!rimOf(x, z, d.type) && y < restOf(d.type) * 0.9) problem = `${d.id} came to rest sunk, at y=${y.toFixed(3)}`;
      }
      if (sim.timedOut) timeouts++;
      steps += sim.steps;
      sim.free();
      if (problem) {
        problems++;
        if (problems <= 3) console.log(`  ${id} throw ${i}: ${problem}\n  ${JSON.stringify(record)}`);
      }
    }
    const ok = problems === 0 && timeouts <= THROWS * MAX_TIMEOUT_RATE;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: ${THROWS} throws, ${problems} with a die sunk, escaped or misread, ` +
      `${timeouts} timed out (${(TIMEOUT_STEPS * PHYSICS_STEP).toFixed(0)} s)` +
      `${spice === 'pothole' ? `, ${fallen} of ${dice} dice down a hole` : ''}. ` +
      `Mean time to settle ${((steps / THROWS) * PHYSICS_STEP).toFixed(2)} s.`);
  }
}

process.exit(failures ? 1 : 0);
