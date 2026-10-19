// @ts-check
// How a match is won (DEV_PLAN.md D7). Hearts is the default; Sudden Death and
// Marathon are Hearts with one and six. The rest count points, scaled to the
// dice set (scoreStats in dice-sets.js) so a match lasts about as long with
// eight d6s as with one d20: Hit Points, Race to N and Tug of War. Death Saves
// is Hearts with a second way to lose.

import { HEARTS_PER_SIDE } from '../config.js';
import { scoreStats } from './dice-sets.js';

/** @typedef {import('./types.js').PerSide<number>} HeartsState */
/** @typedef {import('./types.js').Side} Side */
/** @typedef {import('./types.js').Round} Round */
/** @typedef {import('./types.js').DiceSet} DiceSet */

/** @type {Side[]} */
const SIDES = ['player', 'opponent'];

/**
 * Who won, if anyone, given which sides are out: a draw if both are.
 * @param {boolean} playerOut
 * @param {boolean} opponentOut
 * @returns {import('./types.js').MatchResult | null}
 */
function whoIsOut(playerOut, opponentOut) {
  if (playerOut && opponentOut) return 'draw';
  if (playerOut) return 'opponent';
  if (opponentOut) return 'player';
  return null;
}

/**
 * Whichever side has less of `state`'s count, if they differ.
 * @param {import('./types.js').PerSide<number>} state
 * @returns {Side | null}
 */
function fewer(state) {
  if (state.player < state.opponent) return 'player';
  if (state.opponent < state.player) return 'opponent';
  return null;
}

/**
 * A round number, for a total players will read: whole under 20, else to the
 * nearest five.
 * @param {number} x
 */
const nice = (x) => (x < 20 ? Math.max(1, Math.round(x)) : Math.round(x / 5) * 5);

/**
 * Each side starts with `count` hearts. The round's loser loses one; a tie
 * costs nobody anything. Whoever runs out first loses the match.
 * @param {number} count
 * @returns {import('./types.js').WinCondition<HeartsState>}
 */
export function hearts(count) {
  return {
    id: `hearts-${count}`,
    init: () => ({ player: count, opponent: count }),
    damage: ({ winner }) => ({
      player: winner === 'opponent' ? 1 : 0,
      opponent: winner === 'player' ? 1 : 0,
    }),
    apply: (state, _round, damage) => ({
      player: Math.max(0, state.player - damage.player),
      opponent: Math.max(0, state.opponent - damage.opponent),
    }),
    // Both sides can only run out together if a Spice costs both a heart in
    // the same round (Mutual Destruction); that ends the match as a draw.
    matchWinner: (state) => whoIsOut(state.player <= 0, state.opponent <= 0),
    behind: fewer,
    view: (state) => ({
      kind: 'hearts',
      sides: {
        player: { left: state.player, max: count },
        opponent: { left: state.opponent, max: count },
      },
    }),
  };
}

export const HEARTS = hearts(HEARTS_PER_SIDE);

/**
 * How far apart the two totals were: what the round costs its loser in Hit
 * Points, and how far it pulls the rope in Tug of War.
 * @param {Round} round
 */
const gap = ({ scores }) => Math.abs(scores.player - scores.opponent);

/**
 * What a round costs each side when its loser pays the gap between totals.
 * @param {Round} round
 */
const loserPaysGap = (round) => ({
  player: round.winner === 'opponent' ? gap(round) : 0,
  opponent: round.winner === 'player' ? gap(round) : 0,
});

/**
 * Hit Points: each side starts with the same HP, and the round's loser loses
 * the difference between the totals. 4.5 times the average difference, so a
 * side runs out after about five lost rounds, whatever the dice.
 * @param {DiceSet} diceSet
 * @returns {import('./types.js').WinCondition<import('./types.js').PerSide<number>>}
 */
export function hitPoints(diceSet) {
  const max = nice(4.5 * scoreStats(diceSet).meanGap);
  const side = (/** @type {number} */ hp) => ({ value: hp, max, text: `${hp} HP` });
  return {
    id: 'hit-points',
    unit: 'HP',
    init: () => ({ player: max, opponent: max }),
    damage: loserPaysGap,
    apply: (state, _round, damage) => ({
      player: Math.max(0, state.player - damage.player),
      opponent: Math.max(0, state.opponent - damage.opponent),
    }),
    matchWinner: (state) => whoIsOut(state.player <= 0, state.opponent <= 0),
    behind: fewer,
    view: (state) => ({ kind: 'bar', style: 'hp', sides: { player: side(state.player), opponent: side(state.opponent) } }),
  };
}

/**
 * Race to N: every round's total is added to that side's, win or lose; the
 * first to reach N wins. N is five average totals. Both past it in the same
 * round: the higher wins, and level is a draw.
 * @param {DiceSet} diceSet
 * @returns {import('./types.js').WinCondition<import('./types.js').PerSide<number>>}
 */
export function raceTo(diceSet) {
  const target = nice(5 * scoreStats(diceSet).mean);
  const side = (/** @type {number} */ total) => ({ value: Math.min(total, target), max: target, text: `${total} / ${target}` });
  return {
    id: 'race',
    init: () => ({ player: 0, opponent: 0 }),
    // Nothing is lost: each round's totals are banked instead (see apply).
    damage: () => ({ player: 0, opponent: 0 }),
    apply: (state, round) => ({
      player: state.player + Math.max(0, round.scores.player),
      opponent: state.opponent + Math.max(0, round.scores.opponent),
    }),
    matchWinner: (state) => {
      if (state.player < target && state.opponent < target) return null;
      return state.player > state.opponent ? 'player' : state.opponent > state.player ? 'opponent' : 'draw';
    },
    behind: fewer,
    view: (state) => ({ kind: 'bar', style: 'race', sides: { player: side(state.player), opponent: side(state.opponent) } }),
  };
}

/**
 * Tug of War: a marker starts in the middle, and each round it's pulled
 * towards the loser by the difference in totals. Pulled to their edge, they
 * lose. The state is where it is, from -limit (the player's edge) to +limit
 * (the opponent's); each side's HUD shows how far it is from their own edge.
 * @param {DiceSet} diceSet
 * @returns {import('./types.js').WinCondition<number>}
 */
export function tugOfWar(diceSet) {
  const limit = nice(3 * scoreStats(diceSet).meanGap);
  const side = (/** @type {number} */ room, /** @type {string} */ whose) =>
    ({ value: room, max: 2 * limit, text: `${room} to ${whose} edge` });
  return {
    id: 'tug-of-war',
    init: () => 0,
    damage: loserPaysGap,
    apply: (marker, _round, damage) => Math.max(-limit, Math.min(limit, marker + damage.opponent - damage.player)),
    matchWinner: (marker) => (marker >= limit ? 'player' : marker <= -limit ? 'opponent' : null),
    behind: (marker) => (marker < 0 ? 'player' : marker > 0 ? 'opponent' : null),
    view: (marker) => ({
      kind: 'bar',
      style: 'tug',
      sides: { player: side(limit + marker, 'your'), opponent: side(limit - marker, 'their') },
    }),
  };
}

/** Failed death saves that end the match. */
export const DEATH_SAVE_FAILS = 3;
/** A d20 under this fails a death save. */
export const DEATH_SAVE_DC = 10;

/**
 * The d20 that counted for `side`: the higher of two under advantage.
 * @param {Pick<Round, 'faces' | 'kept'>} round
 * @param {Side} side
 */
export const naturalOf = (round, side) => Math.max(...round.faces[side].filter((_, i) => round.kept[side][i]));

/**
 * How many death saves a natural d20 fails, as in D&D: under 10 one, a 1 two.
 * A 20 wipes the slate clean, returned as null.
 * @param {number} natural
 */
export function failsFor(natural) {
  if (natural === 20) return null;
  if (natural === 1) return 2;
  return natural < DEATH_SAVE_DC ? 1 : 0;
}

/**
 * @typedef {{ hearts: import('./types.js').PerSide<number>, fails: import('./types.js').PerSide<number> }} DeathSavesState
 */

/**
 * Death Saves: Hearts as usual, and every round each side's d20 is also a
 * death save, whatever the other side threw: under 10 is a fail, a 1 two
 * fails, a 20 wipes them all. Three fails loses the match, hearts or not.
 * @type {import('./types.js').WinCondition<DeathSavesState>}
 */
export const DEATH_SAVES = {
  id: 'death-saves',
  init: () => ({ hearts: HEARTS.init(), fails: { player: 0, opponent: 0 } }),
  damage: HEARTS.damage,
  apply: (state, round, damage) => {
    const failed = (/** @type {Side} */ side) => {
      const fails = failsFor(naturalOf(round, side));
      return fails === null ? 0 : Math.min(DEATH_SAVE_FAILS, state.fails[side] + fails);
    };
    return {
      hearts: HEARTS.apply(state.hearts, round, damage),
      fails: { player: failed('player'), opponent: failed('opponent') },
    };
  },
  matchWinner: ({ hearts: h, fails }) =>
    whoIsOut(h.player <= 0 || fails.player >= DEATH_SAVE_FAILS, h.opponent <= 0 || fails.opponent >= DEATH_SAVE_FAILS),
  behind: (state) => HEARTS.behind(state.hearts) ?? fewer({ player: -state.fails.player, opponent: -state.fails.opponent }),
  view: (state) => ({
    ...HEARTS.view(state.hearts),
    marks: {
      player: { count: state.fails.player, max: DEATH_SAVE_FAILS, label: 'failed death saves' },
      opponent: { count: state.fails.opponent, max: DEATH_SAVE_FAILS, label: 'failed death saves' },
    },
  }),
};
