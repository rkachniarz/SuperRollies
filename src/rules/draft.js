// @ts-check
// The Quick Game draft (DEV_PLAN.md R1.1-R1.3, R1.6): two dice-set cards, then
// two Spice cards eligible for the set picked. What's offered follows from the
// match seed alone, so the same seed deals the same cards on any client.

import { createRng, deriveSeed } from '../rng.js';
import { DICE_SETS } from './dice-sets.js';
import { SPICE } from './spice.js';
import { isEligible } from './engine.js';

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
  return Object.values(SPICE).filter((spice) => isEligible(spice, DICE_SETS[diceSet]));
}

/**
 * Every Spice the test bench offers with this dice set (DEV_PLAN.md D39):
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
 * The Spice cards offered once `diceSet` has been picked: ids. A stream of its
 * own, so the dice offered never depend on how many Spice there are.
 * @param {number} seed
 * @param {string} diceSet
 */
export function dealSpice(seed, diceSet) {
  return deal(eligibleSpice(diceSet).map((s) => s.id), OFFERS, createRng(deriveSeed(seed, 'draft-spice')));
}
