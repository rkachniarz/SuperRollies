// @ts-check
// The Quick Game draft (docs/spec.md R1.1-R1.3, R1.6): two dice-set cards, then
// two Spice offers for the set picked, each a stack of Spice that don't clash
// (docs/decisions.md D51). What's offered follows from the match seed alone,
// so the same seed deals the same cards on any client.

import { createRng, deriveSeed } from '../rng.js';
import { DICE_SETS, diceSetOf } from './dice-sets.js';
import { SPICE } from './spice.js';
import { isEligible } from './engine.js';
import { clashOf, largestStack } from './stacking.js';

/** Cards offered at each step. */
export const OFFERS = 2;

/**
 * `count` different entries of `list`, picked at random from `rng`'s stream.
 * @template T
 * @param {T[]} list
 * @param {number} count
 * @param {import('../rng.js').Rng} rng
 */
function deal(list, count, rng) {
  const deck = [...list];
  const hand = [];
  while (hand.length < count && deck.length) hand.push(deck.splice(rng.int(deck.length), 1)[0]);
  return hand;
}

/**
 * Every Spice that can be played with this dice set (R3.2), in catalogue order.
 * @param {string} diceSet  An id.
 */
export function eligibleSpice(diceSet) {
  return Object.values(SPICE).filter((spice) => isEligible(spice, diceSetOf(diceSet)));
}

/**
 * Every Spice the test bench offers with this dice set (docs/decisions.md D39):
 * all it allows, those made for particular dice sets first, each group in
 * catalogue order.
 * @param {string} diceSet  An id.
 */
export function testBenchSpice(diceSet) {
  const eligible = eligibleSpice(diceSet);
  const specific = (/** @type {import('./types.js').Spice} */ spice) => Boolean(spice.eligibility.diceSets);
  return [...eligible.filter(specific), ...eligible.filter((spice) => !specific(spice))];
}

/**
 * The dice-set cards a match seeded with `seed` offers: ids.
 * @param {number} seed
 */
export function dealDice(seed) {
  return deal(Object.keys(DICE_SETS), OFFERS, createRng(deriveSeed(seed, 'draft-dice')));
}

/**
 * How many Spice an offer stacks, and how often (DEV_PLAN Q8). The last is 5
 * or more: from 5 up to the most the dice set takes, evenly.
 */
export const STACK_SIZES = [[1, 0.15], [2, 0.35], [3, 0.35], [4, 0.1], [5, 0.05]];

// Tries at a stack of the size drawn: picked at random, one that clashes with
// any already picked is passed over, so a try can fall short.
const STACK_TRIES = 8;

/**
 * One Spice stack for `diceSet`, drawn from `rng`: ids, in catalogue order.
 * Vanilla comes up on its own, as often as one Spice card in all those the
 * set allows (Q9). `without` are never in it (No Man's Land in
 * multiplayer).
 * @param {string} diceSet  An id.
 * @param {import('../rng.js').Rng} rng
 * @param {{ without?: string[] }} [options]
 * @returns {string[]}
 */
export function dealStack(diceSet, rng, { without = [] } = {}) {
  const eligible = eligibleSpice(diceSet).filter((s) => !without.includes(s.id));
  if (rng.next() < 1 / eligible.length) return ['vanilla'];
  const ids = eligible.map((s) => s.id).filter((id) => id !== 'vanilla');
  const most = largestStack(diceSet, { without }).length;
  let size = STACK_SIZES.at(-1)[0];
  for (let r = rng.next(), i = 0; i < STACK_SIZES.length; r -= STACK_SIZES[i][1], i++) {
    if (r < STACK_SIZES[i][1]) { size = STACK_SIZES[i][0]; break; }
  }
  if (size === STACK_SIZES.at(-1)[0]) size += rng.int(Math.max(1, most - size + 1));
  size = Math.min(size, most);
  /** @type {string[]} */
  let best = [];
  for (let t = 0; t < STACK_TRIES && best.length < size; t++) {
    const deck = [...ids];
    const stack = [];
    while (stack.length < size && deck.length) {
      const next = deck.splice(rng.int(deck.length), 1)[0];
      if (stack.every((id) => !clashOf(id, next, diceSet))) stack.push(next);
    }
    if (stack.length > best.length) best = stack;
  }
  return ids.filter((id) => best.includes(id));
}

/**
 * The Spice offers once `diceSet` has been picked: each a stack (dealStack),
 * no two the same. A stream of its own, so the dice offered never depend on
 * how many Spice there are.
 * @param {number} seed
 * @param {string} diceSet
 * @returns {string[][]}
 */
export function dealSpice(seed, diceSet) {
  const rng = createRng(deriveSeed(seed, 'draft-spice'));
  /** @type {string[][]} */
  const offers = [];
  for (let t = 0; offers.length < OFFERS && t < 50; t++) {
    const stack = dealStack(diceSet, rng);
    if (!offers.some((o) => o.join() === stack.join())) offers.push(stack);
  }
  return offers;
}
