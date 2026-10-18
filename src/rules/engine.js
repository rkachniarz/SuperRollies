// @ts-check
// The rules engine: what a round's dice mean for the match. Pure functions of
// the match config, the match state and both sides' face values - no DOM, no
// physics, no clock - so both players in a multiplayer match can each work out
// every round themselves and reach the same outcome (DEV_PLAN.md R4.4), and the
// whole of it runs under `npm test`.
//
// A match: startMatch, then for each round beginRound before anyone throws and
// playRound once the dice have settled, until the outcome has a matchWinner.
// Between the two, handOf says what each side throws this round.

import { createRng, deriveSeed } from '../rng.js';
import { DICE_SETS, dieTypes } from './dice-sets.js';
import { SPICE } from './spice.js';
import { HEARTS } from './win-conditions.js';

/** @typedef {import('./types.js').MatchConfig} MatchConfig */
/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').Rules} Rules */
/** @typedef {import('./types.js').HookContext} HookContext */
/** @typedef {import('./types.js').Hand} Hand */
/** @typedef {import('./types.js').Side} Side */
/** @typedef {import('./types.js').Scorer} Scorer */
/** @typedef {import('./types.js').PerSide<number[]>} Faces */

/** @type {Side[]} */
const SIDES = ['player', 'opponent'];

/**
 * A match config, checked. Defaults to The Classic with Vanilla.
 * @param {{ seed: number, diceSet?: string, spice?: string }} options
 * @returns {MatchConfig}
 */
export function matchConfig({ seed, diceSet = 'classic', spice = 'vanilla' }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Seed must be a uint32, got ${seed}`);
  if (!DICE_SETS[diceSet]) throw new Error(`Unknown dice set "${diceSet}"`);
  if (!SPICE[spice]) throw new Error(`Unknown Spice "${spice}"`);
  return { seed, diceSet, spice };
}

/**
 * Looks up the dice set, Spice and win condition a config names.
 * @param {MatchConfig} config
 * @returns {Rules}
 */
export function resolveRules(config) {
  const spice = SPICE[config.spice];
  return {
    config,
    diceSet: DICE_SETS[config.diceSet],
    spice,
    winCondition: spice.winCondition ?? HEARTS,
  };
}

/**
 * Runs `fn` with a hook context whose rng starts from `state.rng`, and returns
 * what it returned along with the rng's state afterwards.
 * @template T
 * @param {Rules} rules
 * @param {MatchState} state
 * @param {(ctx: HookContext) => T} fn
 */
function withContext(rules, state, fn) {
  const rng = createRng(state.rng);
  const value = fn({ rules, state, rng });
  return { value, rng: rng.state };
}

/**
 * The state a match starts in.
 * @param {Rules} rules
 * @returns {MatchState}
 */
export function startMatch(rules) {
  /** @type {MatchState} */
  const state = {
    round: 0,
    rng: deriveSeed(rules.config.seed, 'rules'),
    win: rules.winCondition.init(),
    spice: undefined,
    previous: null,
    winner: null,
  };
  if (!rules.spice.setup) return state;
  const { value, rng } = withContext(rules, state, rules.spice.setup);
  return { ...state, spice: value, rng };
}

/**
 * Per-round setup, before anyone throws. Returns the new state and anything
 * the Spice wants announced (e.g. this round's cursed number).
 * @param {Rules} rules
 * @param {MatchState} state
 * @returns {{ state: MatchState, announce?: string }}
 */
export function beginRound(rules, state) {
  if (!rules.spice.beforeThrow) return { state };
  const { value, rng } = withContext(rules, state, rules.spice.beforeThrow);
  const next = { ...state, rng };
  if (value && 'spice' in value) next.spice = value.spice;
  return { state: next, announce: value?.announce };
}

/**
 * What `side` throws this round, and how it's totalled: the dice set's, unless
 * the Spice changes it (an extra die, advantage). Depends on the match state
 * only, so the game can ask before the throw and get what the engine will
 * score after it.
 * @param {Rules} rules
 * @param {MatchState} state
 * @param {Side} side
 * @returns {Hand}
 */
export function handOf(rules, state, side) {
  const base = { types: dieTypes(rules.diceSet), scorer: rules.diceSet.scorer };
  return rules.spice.hand ? rules.spice.hand(side, base, { rules, state }) : base;
}

/**
 * Who holds a state-based advantage this round, if anyone (R3.5).
 * @param {Rules} rules
 * @param {MatchState} state
 * @returns {import('./types.js').Edge | null}
 */
export function edgeOf(rules, state) {
  return rules.spice.edge?.({ rules, state }) ?? null;
}

/**
 * How one side's dice add up under `scorer`, with nothing else changed: each
 * die's term for the result card, which counted, and the total. Zen uses this
 * alone; a match's round adds the Spice's say on top (see playRound).
 * @param {Scorer} scorer
 * @param {number[]} faces
 * @param {import('./types.js').DieValue[]} [values]  What each die counts for,
 *   where a Spice says it isn't its face.
 */
export function scoreDice(scorer, faces, values) {
  const counted = values ? values.map((v) => v.value) : faces;
  const kept = scorer.kept?.(counted) ?? counted.map(() => true);
  const labels = scorer.labels?.(faces);
  /** @type {import('./types.js').DieTerm[]} */
  const dice = faces.map((face, i) => {
    const term = { text: values?.[i]?.text ?? labels?.[i] ?? String(counted[i]), kept: kept[i] };
    const tag = values?.[i]?.tag;
    return tag ? { ...term, tag } : term;
  });
  return { values: counted, kept, dice, score: scorer(counted) };
}

/**
 * Plays out one round from both sides' settled face values (each in the order
 * of that side's hand, handOf).
 * @param {Rules} rules
 * @param {MatchState} state
 * @param {Faces} faces
 * @returns {{ outcome: import('./types.js').RoundOutcome, state: MatchState }}
 */
export function playRound(rules, state, faces) {
  if (state.winner) throw new Error('The match is already over');
  const { spice, winCondition } = rules;
  const hands = { player: handOf(rules, state, 'player'), opponent: handOf(rules, state, 'opponent') };
  for (const side of SIDES) {
    if (faces[side].length !== hands[side].types.length) {
      throw new Error(`${side} threw ${faces[side].length} dice, expected ${hands[side].types.length}`);
    }
  }

  const { value: round, rng } = withContext(rules, state, (ctx) => {
    // Each side in turn, the player's first: a Spice drawing random numbers
    // for each side's dice draws them in that order (see Side in types.js).
    const sides = Object.fromEntries(SIDES.map((side) => {
      const sideCtx = { ...ctx, side, hand: hands[side] };
      const values = spice.values?.(faces[side], sideCtx);
      return [side, { sideCtx, ...scoreDice(hands[side].scorer, faces[side], values) }];
    }));
    const values = { player: sides.player.values, opponent: sides.opponent.values };
    const adjustments = {
      player: spice.adjust?.({ faces, values }, sides.player.sideCtx) ?? [],
      opponent: spice.adjust?.({ faces, values }, sides.opponent.sideCtx) ?? [],
    };
    const total = (/** @type {Side} */ side) =>
      adjustments[side].reduce((sum, { value }) => sum + value, sides[side].score);
    const scored = {
      faces,
      values,
      kept: { player: sides.player.kept, opponent: sides.opponent.kept },
      dice: { player: sides.player.dice, opponent: sides.opponent.dice },
      adjustments,
      scores: { player: total('player'), opponent: total('opponent') },
    };
    const winner = spice.compare ? spice.compare(scored, ctx) : higherWins(scored.scores);
    const round = { ...scored, winner };
    const base = winCondition.damage(round);
    const damage = spice.applyDamage ? spice.applyDamage(round, base, ctx) : base;
    return { ...round, damage };
  });

  const win = winCondition.apply(state.win, round, round.damage);
  const matchWinner = winCondition.matchWinner(win);
  const note = spice.explain?.(round, { rules, state });
  /** @type {import('./types.js').RoundOutcome} */
  const outcome = { ...round, matchWinner };
  if (note) outcome.note = note;
  return {
    outcome,
    state: {
      ...state, round: state.round + 1, rng, win, previous: { winner: round.winner }, winner: matchWinner,
    },
  };
}

/**
 * The default comparison: the higher score wins, equal scores tie.
 * @param {import('./types.js').PerSide<number>} scores
 * @returns {Side | null}
 */
export function higherWins({ player, opponent }) {
  if (player > opponent) return 'player';
  if (opponent > player) return 'opponent';
  return null;
}

/**
 * Whether `spice` can be played with `diceSet` (R3.2).
 * @param {import('./types.js').Spice} spice
 * @param {import('./types.js').DiceSet} diceSet
 */
export function isEligible(spice, diceSet) {
  const { minDice, maxDice, dieTypes: needs, diceSets, excludeDiceSets } = spice.eligibility;
  const types = dieTypes(diceSet);
  if (minDice !== undefined && types.length < minDice) return false;
  if (maxDice !== undefined && types.length > maxDice) return false;
  if (needs && !needs.every((t) => types.includes(t))) return false;
  if (diceSets && !diceSets.includes(diceSet.id)) return false;
  if (excludeDiceSets?.includes(diceSet.id)) return false;
  return true;
}
