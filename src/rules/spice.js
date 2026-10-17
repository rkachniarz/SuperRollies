// @ts-check
// Spice: what is special about a match (DEV_PLAN.md §6). One per match (D9).
// Vanilla is the only one until Phase 4.

/** @typedef {import('./types.js').Spice} Spice */

/**
 * No changes: the dice set's score, higher wins, and Hearts (D4).
 * @type {Spice}
 */
export const VANILLA = {
  id: 'vanilla',
  name: 'Vanilla',
  summary: 'No changes.',
  eligibility: {},
};

/** @type {Record<string, Spice>} */
export const SPICE = {
  [VANILLA.id]: VANILLA,
};
