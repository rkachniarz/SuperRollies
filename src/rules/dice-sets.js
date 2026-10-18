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
 * A d100 roll from a percentile die and a d10, in that order: the tens and
 * the units, "00" and "0" together making 100. Their faces count as 100 and 10
 * (their full value, as when either is thrown alone), so the tens are the
 * percentile die's face mod 100 and the units the d10's mod 10.
 * @type {Scorer}
 */
export const percentile = Object.assign(
  (/** @type {number[]} */ [tens, units]) => (tens % 100) + (units % 10) || 100,
  {
    id: 'percentile',
    suffix: '',
    labels: (/** @type {number[]} */ [tens, units]) => [String(tens % 100).padStart(2, '0'), String(units % 10)],
  }
);

/**
 * @param {string} id
 * @param {string} name
 * @param {DiceSet['dice']} dice
 * @param {{ scorer?: Scorer, dieScale?: number, tray?: number, notation?: string }} [options]
 * @returns {DiceSet}
 */
function diceSet(id, name, dice, { scorer = sum, dieScale = 1, tray = 1, notation } = {}) {
  notation ??= dice.map(({ type, count }) => `${count}${type}`).join(' + ') + scorer.suffix;
  return { id, name, notation, dice, scorer, dieScale, tray: trayOf(tray) };
}

export const THE_CLASSIC = diceSet('classic', 'The Classic', [{ type: 'd20', count: 1 }]);

/** Every dice set, in the order they're offered. */
export const DICE_SETS = Object.fromEntries([
  THE_CLASSIC,
  diceSet('advantage', 'Advantage', [{ type: 'd20', count: 2 }], { scorer: keepHighest(1) }),
  diceSet('greatsword', 'Greatsword', [{ type: 'd6', count: 2 }]),
  diceSet('greataxe', 'Greataxe', [{ type: 'd12', count: 1 }]),
  diceSet('ability-score', 'Ability Score', [{ type: 'd6', count: 3 }], { tray: 1.15 }),
  diceSet('heroic-stats', 'Heroic Stats', [{ type: 'd6', count: 4 }], { scorer: dropLowest(1), tray: 1.2 }),
  diceSet('magic-missile', 'Magic Missile', [{ type: 'd4', count: 3 }], { tray: 1.15 }),
  diceSet('swarm-of-daggers', 'Swarm of Daggers', [{ type: 'd4', count: 4 }], { tray: 1.2 }),
  diceSet('guiding-bolt', 'Guiding Bolt', [{ type: 'd6', count: 4 }], { tray: 1.2 }),
  diceSet('divine-smite', 'Divine Smite', [{ type: 'd8', count: 3 }], { tray: 1.15 }),
  diceSet('fireball', 'Fireball', [{ type: 'd6', count: 8 }], { dieScale: 0.9, tray: 1.45 }),
  diceSet('percentile', 'Percentile', [{ type: 'd%', count: 1 }, { type: 'd10', count: 1 }],
    { scorer: percentile, notation: 'd% + d10' }),
  diceSet('sneak-attack', 'Sneak Attack', [{ type: 'd20', count: 1 }, { type: 'd6', count: 3 }], { tray: 1.2 }),
  diceSet('the-whole-bag', 'The Whole Bag', ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].map((type) => ({ type, count: 1 })),
    { tray: 1.3 }),
  // Scored as a sum until poker hands arrive (DEV_PLAN.md 6.1).
  diceSet('dice-poker', 'Dice Poker', [{ type: 'd6', count: 5 }], { tray: 1.25 }),
].map((set) => [set.id, set]));

/**
 * One side's dice, one entry per die, in the order their faces are scored.
 * @param {DiceSet} diceSet
 * @returns {string[]}
 */
export function dieTypes(diceSet) {
  return diceSet.dice.flatMap(({ type, count }) => Array(count).fill(type));
}
