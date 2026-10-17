// @ts-check
// The dice sets a match can be played with (DEV_PLAN.md §5), and the scorers
// that total them. Only The Classic until Phase 2 brings multiple dice.

import { TRAY_HALF_WIDTH, TRAY_DEPTH } from '../config.js';

/** @typedef {import('./types.js').DiceSet} DiceSet */

/** @type {import('./types.js').Scorer} */
export const sum = (faces) => faces.reduce((total, face) => total + face, 0);

/** @type {DiceSet} */
export const THE_CLASSIC = {
  id: 'classic',
  name: 'The Classic',
  notation: '1d20',
  dice: [{ type: 'd20', count: 1 }],
  scorer: sum,
  dieScale: 1,
  tray: { halfWidth: TRAY_HALF_WIDTH, depth: TRAY_DEPTH },
};

/** @type {Record<string, DiceSet>} */
export const DICE_SETS = {
  [THE_CLASSIC.id]: THE_CLASSIC,
};

/**
 * One side's dice, one entry per die, in the order their faces are scored.
 * @param {DiceSet} diceSet
 * @returns {string[]}
 */
export function dieTypes(diceSet) {
  return diceSet.dice.flatMap(({ type, count }) => Array(count).fill(type));
}
