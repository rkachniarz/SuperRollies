// @ts-check
// The dice sets a match can be played with (DEV_PLAN.md §5), and the scorers
// that total them.

import { TRAY_HALF_WIDTH, TRAY_DEPTH } from '../config.js';

/** @typedef {import('./types.js').DiceSet} DiceSet */
/** @typedef {import('./types.js').Scorer} Scorer */

/**
 * A scorer that adds up the dice `kept` picks out. `suffix` goes on the end of
 * the dice notation, in the usual dice-roller shorthand (`2d20kh1`).
 * @param {string} id
 * @param {string} suffix
 * @param {(faces: number[]) => boolean[]} kept
 * @returns {Scorer}
 */
function summing(id, suffix, kept) {
  const scorer = (/** @type {number[]} */ faces) => {
    const keep = kept(faces);
    return faces.reduce((total, face, i) => (keep[i] ? total + face : total), 0);
  };
  return Object.assign(scorer, { id, suffix, kept });
}

/**
 * The indices of `faces` from highest to lowest. Equal faces keep their order,
 * so which of two equal dice counts is always the same, on every client.
 * @param {number[]} faces
 */
const byHighest = (faces) => faces.map((_, i) => i).sort((a, b) => faces[b] - faces[a] || a - b);

/** Every die counts. */
export const sum = summing('sum', '', (faces) => faces.map(() => true));

/**
 * Only the `n` highest dice count: 2d20 keep highest 1 is advantage.
 * @param {number} n
 */
export function keepHighest(n) {
  return summing(`keepHighest(${n})`, `kh${n}`, (faces) => {
    const keep = new Set(byHighest(faces).slice(0, n));
    return faces.map((_, i) => keep.has(i));
  });
}

/**
 * All but the `n` lowest dice count: 4d6 drop lowest 1 is the standard way to
 * roll a character's ability score.
 * @param {number} n
 */
export function dropLowest(n) {
  return summing(`dropLowest(${n})`, `dl${n}`, (faces) => {
    const keep = new Set(byHighest(faces).slice(0, Math.max(0, faces.length - n)));
    return faces.map((_, i) => keep.has(i));
  });
}

/**
 * The Classic's tray scaled up by `k`. Bigger handfuls need a bigger table:
 * room for the handful in each half with some left to move it about, and on a
 * phone held upright too (DEV_PLAN.md 2.6). The camera pulls back by the same
 * factor (fitCamera in arena.js), so the tray fills the screen as before.
 * @param {number} k
 */
const trayOf = (k) => ({ halfWidth: TRAY_HALF_WIDTH * k, depth: TRAY_DEPTH * k });

/**
 * @param {string} id
 * @param {string} name
 * @param {DiceSet['dice']} dice
 * @param {{ scorer?: Scorer, dieScale?: number, tray?: number }} [options]
 * @returns {DiceSet}
 */
function diceSet(id, name, dice, { scorer = sum, dieScale = 1, tray = 1 } = {}) {
  const notation = dice.map(({ type, count }) => `${count}${type}`).join(' + ') + scorer.suffix;
  return { id, name, notation, dice, scorer, dieScale, tray: trayOf(tray) };
}

export const THE_CLASSIC = diceSet('classic', 'The Classic', [{ type: 'd20', count: 1 }]);

/** Every dice set, in the order they're offered. */
export const DICE_SETS = Object.fromEntries([
  THE_CLASSIC,
  diceSet('advantage', 'Advantage', [{ type: 'd20', count: 2 }], { scorer: keepHighest(1) }),
  diceSet('greatsword', 'Greatsword', [{ type: 'd6', count: 2 }]),
  diceSet('ability-score', 'Ability Score', [{ type: 'd6', count: 3 }], { tray: 1.15 }),
  diceSet('heroic-stats', 'Heroic Stats', [{ type: 'd6', count: 4 }], { scorer: dropLowest(1), tray: 1.2 }),
  diceSet('guiding-bolt', 'Guiding Bolt', [{ type: 'd6', count: 4 }], { tray: 1.2 }),
  // Scored as a sum until poker hands arrive (DEV_PLAN.md 6.1).
  diceSet('dice-poker', 'Dice Poker', [{ type: 'd6', count: 5 }], { tray: 1.25 }),
  diceSet('fireball', 'Fireball', [{ type: 'd6', count: 8 }], { dieScale: 0.9, tray: 1.45 }),
].map((set) => [set.id, set]));

/**
 * One side's dice, one entry per die, in the order their faces are scored.
 * @param {DiceSet} diceSet
 * @returns {string[]}
 */
export function dieTypes(diceSet) {
  return diceSet.dice.flatMap(({ type, count }) => Array(count).fill(type));
}
