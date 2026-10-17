// @ts-check
// The rules engine: what a round's dice mean for the match. Pure functions of
// the match config, the match state and both sides' face values - no DOM, no
// physics, no clock - so both players in a multiplayer match can each work out
// every round themselves and reach the same outcome (DEV_PLAN.md R4.4), and the
// whole of it runs under `npm test`.
//
// A match: startMatch, then for each round beginRound before anyone throws and
// playRound once the dice have settled, until the outcome has a matchWinner.

import { createRng, deriveSeed } from '../rng.js';
import { DICE_SETS } from './dice-sets.js';
import { SPICE } from './spice.js';
import { HEARTS } from './win-conditions.js';

/** @typedef {import('./types.js').MatchConfig} MatchConfig */
/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').Rules} Rules */
/** @typedef {import('./types.js').HookContext} HookContext */
/** @typedef {import('./types.js').PerSide<number[]>} Faces */

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
 * Plays out one round from both sides' settled face values (each in the dice
 * set's order).
 * @param {Rules} rules
 * @param {MatchState} state
 * @param {Faces} faces
 * @returns {{ outcome: import('./types.js').RoundOutcome, state: MatchState }}
 */
export function playRound(rules, state, faces) {
  if (state.winner) throw new Error('The match is already over');
  const { diceSet, spice, winCondition } = rules;

  const { value: outcome, rng } = withContext(rules, state, (ctx) => {
    const scoreOf = (/** @type {number[]} */ sideFaces) => {
      const base = diceSet.scorer(sideFaces);
      return spice.score ? spice.score(sideFaces, base, ctx) : base;
    };
    const scores = { player: scoreOf(faces.player), opponent: scoreOf(faces.opponent) };
    const winner = spice.compare ? spice.compare(scores, ctx) : higherWins(scores);
    const round = { faces, scores, winner };
    const base = winCondition.damage(round);
    const damage = spice.applyDamage ? spice.applyDamage(round, base, ctx) : base;
    return { ...round, damage };
  });

  const win = winCondition.apply(state.win, outcome, outcome.damage);
  const matchWinner = winCondition.matchWinner(win);
  return {
    outcome: { ...outcome, matchWinner },
    state: { ...state, round: state.round + 1, rng, win, winner: matchWinner },
  };
}

/**
 * The default comparison: the higher score wins, equal scores tie.
 * @param {import('./types.js').PerSide<number>} scores
 * @returns {import('./types.js').Side | null}
 */
export function higherWins({ player, opponent }) {
  if (player > opponent) return 'player';
  if (opponent > player) return 'opponent';
  return null;
}
