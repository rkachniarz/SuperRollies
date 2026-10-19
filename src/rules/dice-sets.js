// @ts-check
// The dice sets a match can be played with (DEV_PLAN.md §5), and the scorers
// that total them.

import { TRAY_HALF_WIDTH, TRAY_DEPTH } from '../config.js';
import { poker } from './poker.js';

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
 * Only the dice showing `face` count, one each: a total of how many there
 * are, written `2 sixes` (Count the Sixes). The rest are greyed out.
 * @param {number} face
 * @param {string} one  What one is called: `six`.
 * @param {string} many  And more than one: `sixes`.
 * @returns {Scorer}
 */
export function countOf(face, one, many) {
  const kept = (/** @type {number[]} */ faces) => faces.map((f) => f === face);
  const scorer = (/** @type {number[]} */ faces) => kept(faces).filter(Boolean).length;
  return Object.assign(scorer, {
    id: `countOf(${face})`,
    suffix: '',
    kept,
    describe: (/** @type {number[]} */ faces) => {
      const n = scorer(faces);
      return `${n} ${n === 1 ? one : many}`;
    },
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
 * @param {{ summary: string, range: string, rules?: string, scorer?: Scorer, dieScale?: number, tray?: number, notation?: string }} options
 * @returns {DiceSet}
 */
function diceSet(id, name, dice, { summary, range, rules, scorer = sum, dieScale = 1, tray = 1, notation }) {
  notation ??= dice.map(({ type, count }) => `${count}${type}`).join(' + ') + scorer.suffix;
  return { id, name, notation, summary, range, ...(rules ? { rules } : {}), dice, scorer, dieScale, tray: trayOf(tray) };
}

export const THE_CLASSIC = diceSet('classic', 'The Classic', [{ type: 'd20', count: 1 }],
  { summary: 'One d20, the roll that settles everything.', range: '1–20' });

/** Every dice set, in the order they're offered. */
export const DICE_SETS = Object.fromEntries([
  THE_CLASSIC,
  diceSet('advantage', 'Advantage', [{ type: 'd20', count: 2 }],
    { scorer: keepHighest(1), summary: 'Two d20s; only the higher counts.', range: '1–20' }),
  diceSet('greatsword', 'Greatsword', [{ type: 'd6', count: 2 }],
    { summary: 'Two d6s, added up.', range: '2–12' }),
  diceSet('greataxe', 'Greataxe', [{ type: 'd12', count: 1 }],
    { summary: 'One big d12.', range: '1–12' }),
  diceSet('ability-score', 'Ability Score', [{ type: 'd6', count: 3 }],
    { tray: 1.15, summary: 'Three d6s, added up, old-school style.', range: '3–18' }),
  diceSet('heroic-stats', 'Heroic Stats', [{ type: 'd6', count: 4 }],
    { scorer: dropLowest(1), tray: 1.2, summary: 'Four d6s; the lowest is dropped.', range: '3–18' }),
  diceSet('magic-missile', 'Magic Missile', [{ type: 'd4', count: 3 }],
    { tray: 1.15, summary: 'Three d4s: it never misses, it never hits hard.', range: '3–12' }),
  diceSet('swarm-of-daggers', 'Swarm of Daggers', [{ type: 'd4', count: 4 }],
    { tray: 1.2, summary: 'Four d4s, added up.', range: '4–16' }),
  diceSet('guiding-bolt', 'Guiding Bolt', [{ type: 'd6', count: 4 }],
    { tray: 1.2, summary: 'Four d6s, added up.', range: '4–24' }),
  diceSet('divine-smite', 'Divine Smite', [{ type: 'd8', count: 3 }],
    { tray: 1.15, summary: 'Three d8s, added up.', range: '3–24' }),
  diceSet('fireball', 'Fireball', [{ type: 'd6', count: 8 }],
    { dieScale: 0.9, tray: 1.45, summary: 'Eight d6s. Everything burns.', range: '8–48' }),
  diceSet('percentile', 'Percentile', [{ type: 'd%', count: 1 }, { type: 'd10', count: 1 }],
    { scorer: percentile, notation: 'd% + d10', summary: 'Tens and units: anything from 1 to 100.', range: '1–100' }),
  diceSet('sneak-attack', 'Sneak Attack', [{ type: 'd20', count: 1 }, { type: 'd6', count: 3 }],
    { tray: 1.2, summary: 'A d20 to hit and three d6s of sneak attack, all added up.', range: '4–38' }),
  diceSet('the-whole-bag', 'The Whole Bag', ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].map((type) => ({ type, count: 1 })),
    { tray: 1.3, summary: 'One of every die, all added up.', range: '6–60' }),
  diceSet('dice-poker', 'Dice Poker', [{ type: 'd6', count: 5 }], {
    scorer: poker,
    tray: 1.25,
    summary: 'Five d6s, scored as a poker hand.',
    range: 'nothing to five of a kind',
    rules: 'Five d6s, scored as a poker hand, best first: five of a kind, four of a kind, a full house, a straight (2 to 6 beats 1 to 5), three of a kind, two pair, a pair, nothing. The better hand wins; between equal hands, the higher dice in it, then the higher dice left over.',
  }),
].map((set) => [set.id, set]));

/**
 * The highest face of each die type, as it counts: a d10's "0" is 10, a
 * percentile die's "00" is 100 (DEV_PLAN.md D25). What Exploding Dice and
 * Cursed Number need to know about a die without its shape.
 * @type {Record<string, number>}
 */
export const DIE_MAX = { d4: 4, d6: 6, d8: 8, d10: 10, 'd%': 100, d12: 12, d20: 20 };

/**
 * Every face of a die type, as it counts: 1 up to its highest, a percentile
 * die's in tens.
 * @param {string} type
 */
export function dieFaces(type) {
  const step = type === 'd%' ? 10 : 1;
  return Array.from({ length: DIE_MAX[type] / step }, (_, i) => (i + 1) * step);
}

const statsCache = new Map();

/**
 * What a dice set's totals look like: the average total, and how far apart
 * two sides' totals are on average. Worked out exactly, from every way the
 * dice can land - a sum by adding up each die's spread of faces in turn, any
 * other scorer by trying every combination (at most a few thousand). What
 * the win conditions that count points scale to (Hit Points, Race to N, Tug
 * of War), so a match with eight d6s lasts about as long as one with a d20.
 * @param {DiceSet} diceSet
 * @returns {{ mean: number, meanGap: number }}
 */
export function scoreStats(diceSet) {
  if (statsCache.has(diceSet.id)) return statsCache.get(diceSet.id);
  const types = dieTypes(diceSet);
  /** @type {Map<number, number>} total -> probability */
  let totals = new Map([[0, 1]]);
  if (diceSet.scorer === sum) {
    for (const type of types) {
      const faces = dieFaces(type);
      const next = new Map();
      for (const [total, p] of totals) {
        for (const face of faces) next.set(total + face, (next.get(total + face) ?? 0) + p / faces.length);
      }
      totals = next;
    }
  } else {
    totals = new Map();
    const lists = types.map(dieFaces);
    const weight = 1 / lists.reduce((n, list) => n * list.length, 1);
    const walk = (/** @type {number[]} */ faces) => {
      if (faces.length === lists.length) {
        const total = diceSet.scorer(faces);
        totals.set(total, (totals.get(total) ?? 0) + weight);
        return;
      }
      for (const face of lists[faces.length]) walk([...faces, face]);
    };
    walk([]);
  }
  let mean = 0;
  for (const [total, p] of totals) mean += total * p;
  let meanGap = 0;
  for (const [a, p] of totals) for (const [b, q] of totals) meanGap += Math.abs(a - b) * p * q;
  const stats = { mean, meanGap };
  statsCache.set(diceSet.id, stats);
  return stats;
}

/**
 * The die a Spice adds when it gives a side one more (Underdog): the set's
 * commonest type, the smallest of those on a tie. Sneak Attack gets another
 * d6, The Whole Bag a d4, The Classic a d20.
 * @param {DiceSet} diceSet
 */
export function extraDieType(diceSet) {
  const order = Object.keys(DIE_MAX);
  return [...diceSet.dice]
    .sort((a, b) => b.count - a.count || order.indexOf(a.type) - order.indexOf(b.type))[0].type;
}

/**
 * One side's dice, one entry per die, in the order their faces are scored.
 * @param {DiceSet} diceSet
 * @returns {string[]}
 */
export function dieTypes(diceSet) {
  return diceSet.dice.flatMap(({ type, count }) => Array(count).fill(type));
}
