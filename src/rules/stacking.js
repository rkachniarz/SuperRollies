// @ts-check
// Which Spice can be played together (docs/decisions.md D51, docs/stacking.md).
//
// Two Spice can't stack if they take the same slot: a part of the match only
// one Spice can have its way with (how it's won, who wins a round, how a hand
// is totalled...). Beyond slots, a few pairs clash: each would make the other
// meaningless, turn it against its own point, or meet in the game in a way it
// doesn't handle yet (`fixable`). Everything else stacks: the table Spice with
// anything, rule changes with win conditions, and so on.
//
// Each Spice must still be eligible for the dice set on its own (R3.2).
// Vanilla is no Spice at all, so it never stacks.

import { diceSetOf, dieTypes } from './dice-sets.js';
import { SPICE } from './spice.js';
import { isEligible } from './engine.js';

/** @typedef {import('./types.js').Spice} Spice */

/**
 * What each slot is, and the Spice that take it. At most one Spice a slot.
 * @type {Record<string, { what: string, spice: string[] }>}
 */
export const SLOTS = {
  win: {
    what: 'How the match is won',
    spice: ['sudden-death', 'marathon', 'hit-points', 'race-to-n', 'tug-of-war', 'death-saves', 'burnout'],
  },
  verdict: {
    what: 'Who wins a round',
    spice: ['lowball', 'snake-eyes', 'triples', 'wild-magic'],
  },
  scorer: {
    what: 'How a hand is totalled',
    spice: ['inspiration', 'count-the-sixes', 'crown'],
  },
  'extra-die': {
    what: 'An extra die for a side in a given state',
    spice: ['underdog', 'inspiration'],
  },
  'extra-roll': {
    what: 'Extra rolls added to a die',
    spice: ['exploding-dice', 'brutal-critical'],
  },
  rethrow: {
    what: 'A re-throw once the result is shown',
    spice: ['second-wind', 'mercy'],
  },
};

/** Spice that change what a round costs, in the win condition's own units. */
const DAMAGE = ['mutual-destruction', 'raising-the-stakes', 'revenge', 'critical-hit', 'critical-fumble'];

/**
 * Pairs that can't stack though they take no slot in common: every Spice in
 * `a` with every one in `b`. `fixable` marks a clash that is only the game not
 * handling it yet, rather than the rules not making sense together; one with
 * `minDice` holds only for dice sets with at least that many dice a side
 * (measured to stall there, and nowhere else).
 * @type {{ a: string[], b: string[], why: string, fixable?: boolean, minDice?: number }[]}
 */
export const CLASHES = [
  {
    a: ['race-to-n'],
    b: [...DAMAGE, 'lowball', 'snake-eyes', 'triples', 'wild-magic'],
    why: 'Race to N banks every total, win or lose: who wins a round, and what it costs, count for nothing.',
  },
  {
    a: ['hit-points', 'tug-of-war'],
    b: ['mutual-destruction', 'critical-fumble', 'wild-magic'],
    why: 'They add or take a heart\'s worth: 1 HP is nothing, and in Tug of War a point off each side cancels out.',
  },
  {
    a: ['count-the-sixes', 'crown'],
    b: ['hit-points', 'race-to-n', 'tug-of-war'],
    why: 'Points are scaled to the dice set\'s totals; counting sixes, or the highest die, makes totals far smaller.',
  },
  {
    a: ['exploding-dice', 'brutal-critical'],
    b: ['count-the-sixes', 'crown'],
    why: 'An exploded 6 counts as 6 plus its rolls, so it is no longer a six, nor a die on its maximum.',
  },
  {
    a: ['mercy'],
    b: ['sudden-death', 'hit-points', 'race-to-n', 'tug-of-war'],
    why: 'Mercy needs a side two hearts behind: with one heart, or no hearts, that never happens.',
  },
  {
    a: ['sudden-death'],
    b: ['underdog', 'revenge', 'raising-the-stakes', 'critical-hit', 'inspiration'],
    why: 'The first round lost ends the match, so nobody is ever behind, or has lost the last round, and double of one heart is one.',
  },
  {
    a: ['lowball'],
    b: ['underdog', 'inspiration', 'caltrops', 'doubles-again', 'crown', 'exploding-dice', 'brutal-critical', 'critical-hit'],
    why: 'Under Lowball a Spice meant to help a side would hurt it: an extra die, a bonus or an explosion raises the total, and Caltrops would lower the other side\'s.',
  },
  {
    a: ['doubles-again'],
    b: ['second-wind', 'mercy'],
    why: 'A re-throw replays the round\'s first throw but not the doubles thrown after it.',
    fixable: true,
  },
  {
    a: ['no-mans-land'],
    b: ['second-wind', 'mercy', 'doubles-again'],
    why: 'Only one side throws again, and the other side\'s dice, which may lie anywhere without the divider, are not in that throw. (Fixable as Draw Poker does it: hold them where they lie.)',
    fixable: true,
  },
  {
    a: ['doubles-again'],
    b: ['pothole'],
    why: 'A throw made again for doubles doesn\'t say which of its dice went down a hole.',
    fixable: true,
  },
  {
    a: ['no-mans-land'],
    b: ['tug-of-war', 'gusty-table', 'pothole'],
    why: 'With eight dice a side and no divider, dice heap up against the rope, are blown into a heap, or pile round a hole: measured, 1 throw in 20 to 45 waited out the timeout. Fine with fewer dice.',
    fixable: true,
    minDice: 8,
  },
  {
    a: ['tug-of-war'],
    b: ['gusty-table'],
    why: 'With eight dice a side the breeze blows dice into the rope, where they rock: measured, up to 1 throw in 40 waited out the timeout. Fine with fewer dice.',
    fixable: true,
    minDice: 8,
  },
  {
    a: ['draw-poker'],
    b: ['pothole'],
    why: 'A redraw picks dice up from where they lie, and lifting one out of a pit has never been tried.',
    fixable: true,
  },
];

/** The slots `id` takes. */
const slotsOf = (/** @type {string} */ id) => Object.keys(SLOTS).filter((slot) => SLOTS[slot].spice.includes(id));

/**
 * Why Spice `a` and `b` can't stack, or null if they can, with `diceSet`
 * (an id) if given; without one, a clash for only some dice sets counts
 * (and says `minDice`). Says nothing about eligibility (see canStack).
 * @param {string} a  An id.
 * @param {string} b  An id.
 * @param {string} [diceSet]
 * @returns {{ slot?: string, why: string, fixable?: boolean, minDice?: number } | null}
 */
export function clashOf(a, b, diceSet) {
  if (a === b) return { why: 'The same Spice.' };
  if (a === 'vanilla' || b === 'vanilla') return { why: 'Vanilla is no Spice at all.' };
  const slot = slotsOf(a).find((s) => slotsOf(b).includes(s));
  if (slot) return { slot, why: `Both take the same slot: ${SLOTS[slot].what.toLowerCase()}.` };
  const dice = diceSet && dieTypes(diceSetOf(diceSet)).length;
  const clash = CLASHES.find((c) => ((c.a.includes(a) && c.b.includes(b)) || (c.a.includes(b) && c.b.includes(a)))
    && !(dice && c.minDice && dice < c.minDice));
  if (!clash) return null;
  return { why: clash.why, ...(clash.fixable ? { fixable: true } : {}), ...(clash.minDice ? { minDice: clash.minDice } : {}) };
}

/**
 * Whether the Spice `ids` can all be played together with `diceSet`: each
 * eligible for it on its own (R3.2), and no two clashing.
 * @param {string[]} ids
 * @param {string} diceSet  An id.
 */
export function canStack(ids, diceSet) {
  if (!ids.every((id) => isEligible(SPICE[id], diceSetOf(diceSet)))) return false;
  return ids.every((a, i) => ids.slice(i + 1).every((b) => !clashOf(a, b, diceSet)));
}

/**
 * The most Spice that can be played together with `diceSet`, and one such
 * stack (ids, in catalogue order), leaving out any `without`. A small
 * search: about 20 Spice are eligible for any one set.
 * @param {string} diceSet  An id.
 * @param {{ without?: string[] }} [options]
 * @returns {string[]}
 */
export function largestStack(diceSet, { without = [] } = {}) {
  const ids = Object.keys(SPICE)
    .filter((id) => id !== 'vanilla' && !without.includes(id) && isEligible(SPICE[id], diceSetOf(diceSet)));
  /** @type {string[]} */
  let best = [];
  /** @param {string[]} chosen @param {string[]} left */
  const grow = (chosen, left) => {
    if (chosen.length + left.length <= best.length) return;
    if (!left.length) { best = chosen; return; }
    const [next, ...rest] = left;
    grow([...chosen, next], rest.filter((id) => !clashOf(next, id, diceSet)));
    grow(chosen, rest);
  };
  grow([], ids);
  return best;
}

/**
 * Why Spice `id` can't join the stack `picked` with `diceSet`, as a picker
 * card says it (`Clashes with Hit Points: ...`), or null if it can.
 * @param {string[]} picked  Ids.
 * @param {string} id
 * @param {string} diceSet  An id.
 */
export function clashWith(picked, id, diceSet) {
  for (const other of picked) {
    const clash = clashOf(other, id, diceSet);
    if (clash) return `Clashes with ${SPICE[other].name}: ${clash.why}`;
  }
  return null;
}
