// @ts-check
// Spice: what is special about a match (DEV_PLAN.md §6). One per match (D9).
//
// Every Spice here changes only the rules: what the dice count for, who wins a
// round, what it costs, and what each side throws. Physical ones (Pothole,
// Cat Paw) come in Phase 5. Anything random - an exploding die's extra roll, a
// cursed number - is drawn from the hook context's rng, the match's shared
// rules stream (R5.2), never thrown on the table.

import { hearts } from './win-conditions.js';
import { DIE_MAX, extraDieType, keepHighest } from './dice-sets.js';

/** @typedef {import('./types.js').Spice} Spice */
/** @typedef {import('./types.js').Side} Side */
/** @typedef {import('./types.js').Round} Round */
/** @typedef {import('./types.js').PerSide<number>} Damage */

/** @param {Side} side */
const other = (side) => (side === 'player' ? 'opponent' : 'player');

/**
 * The d20 that counted for `side`: the higher of two under advantage.
 * @param {Pick<Round, 'faces' | 'kept'>} round
 * @param {Side} side
 */
const naturalOf = (round, side) => Math.max(...round.faces[side].filter((_, i) => round.kept[side][i]));

/**
 * The round's damage with the loser's multiplied by `k`.
 * @param {Round} round
 * @param {Damage} damage
 * @param {number} k
 * @returns {Damage}
 */
function multiplyLoser({ winner }, damage, k) {
  if (!winner) return damage;
  const loser = other(winner);
  return { ...damage, [loser]: damage[loser] * k };
}

// Rerolls an exploding die gets at most. A d4 chains once in 4, so this is
// never reached in practice; it only keeps the loop finite.
const MAX_EXPLOSIONS = 10;

// The two d20 sets: a "natural 20" is the d20 that counts, so under Advantage
// it's the higher of the two (DEV_PLAN.md D26).
const D20_SETS = ['classic', 'advantage'];

/** @type {Spice} */
export const VANILLA = {
  id: 'vanilla',
  name: 'Vanilla',
  icon: '🍦',
  kind: 'rule',
  summary: 'No changes: the higher total wins.',
  rules: 'Nothing special. The higher total wins the round and the loser loses a heart; a tie costs nobody anything. Lose all three hearts and the match is over.',
  eligibility: {},
};

/** @type {Spice} */
const SUDDEN_DEATH = {
  id: 'sudden-death',
  name: 'Sudden Death',
  icon: '💀',
  kind: 'win',
  summary: 'One heart each. Lose a round, lose the match.',
  rules: 'Each side has a single heart. The first round anyone loses ends the match. Ties cost nothing, so the dice are thrown again.',
  eligibility: {},
  winCondition: hearts(1),
};

/** @type {Spice} */
const MARATHON = {
  id: 'marathon',
  name: 'Marathon',
  icon: '🏃',
  kind: 'win',
  summary: 'Six hearts each, for the long haul.',
  rules: 'Each side starts with six hearts instead of three. Otherwise as usual: the round\'s loser loses one, and whoever runs out first loses the match.',
  eligibility: {},
  winCondition: hearts(6),
};

/** @type {Spice} */
const MUTUAL_DESTRUCTION = {
  id: 'mutual-destruction',
  name: 'Mutual Destruction',
  icon: '💥',
  kind: 'rule',
  summary: 'A tie costs both of you a heart.',
  rules: 'Ties hurt: when the totals are equal, both sides lose a heart. If you both run out in the same round, the match is a draw.',
  eligibility: {},
  applyDamage: (round, damage) => (round.winner ? damage : { player: damage.player + 1, opponent: damage.opponent + 1 }),
  explain: ({ winner }) => (winner ? undefined : 'Mutual destruction: a heart each.'),
};

/** @type {Spice} */
const LOWBALL = {
  id: 'lowball',
  name: 'Lowball',
  icon: '🔻',
  kind: 'rule',
  summary: 'The lowest total wins.',
  rules: 'Everything is upside down: the lower total wins the round. Which dice count doesn\'t change, so under Advantage the higher d20 still counts, and that now works against you.',
  eligibility: {},
  compare: ({ scores }) => {
    if (scores.player < scores.opponent) return 'player';
    if (scores.opponent < scores.player) return 'opponent';
    return null;
  },
};

/** @type {Spice} */
const EXPLODING_DICE = {
  id: 'exploding-dice',
  name: 'Exploding Dice',
  icon: '🧨',
  kind: 'rule',
  summary: 'A die showing its highest number rolls again and adds it. It can chain.',
  rules: 'Whenever a die lands on its highest number (a 6 on a d6, a 20 on a d20), it explodes: it is rolled again and the new roll is added to it. If that roll is the highest number too, it explodes again, and so on. The extra rolls are made by the game, the same on both screens.',
  // Percentile's tens and units aren't a total that can grow.
  eligibility: { excludeDiceSets: ['percentile'] },
  values: (faces, { hand, rng }) => faces.map((face, i) => {
    const max = DIE_MAX[hand.types[i]];
    if (face !== max) return { value: face };
    const rolls = [face];
    for (let roll = max; roll === max && rolls.length <= MAX_EXPLOSIONS;) {
      roll = 1 + rng.int(max);
      rolls.push(roll);
    }
    return { value: rolls.reduce((a, b) => a + b, 0), text: `(${rolls.join('+')})`, tag: 'exploded' };
  }),
};

/** @type {Spice} */
const RAISING_THE_STAKES = {
  id: 'raising-the-stakes',
  name: 'Raising the Stakes',
  icon: '📈',
  kind: 'rule',
  summary: 'Ties carry over: the next round costs 2 hearts, then 3...',
  rules: 'A tie costs nothing, but it raises the stakes: the next round costs its loser two hearts. Another tie makes it three, and so on. Once a round has a winner, the stakes go back to one heart.',
  eligibility: {},
  setup: () => ({ stake: 1 }),
  beforeThrow: ({ state }) => {
    const { stake } = /** @type {{ stake: number }} */ (state.spice);
    const next = state.previous && state.previous.winner === null ? stake + 1 : 1;
    return { spice: { stake: next }, announce: next > 1 ? `This round costs ${next} hearts` : undefined };
  },
  applyDamage: (round, damage, { state }) =>
    multiplyLoser(round, damage, /** @type {{ stake: number }} */ (state.spice).stake),
  explain: ({ winner }, { state }) => {
    const { stake } = /** @type {{ stake: number }} */ (state.spice);
    if (winner) return stake > 1 ? `That cost ${stake} hearts.` : undefined;
    return `The stakes go up: the next round costs ${stake + 1} hearts.`;
  },
};

/** @type {Spice} */
const CURSED_NUMBER = {
  id: 'cursed-number',
  name: 'Cursed Number',
  icon: '👻',
  kind: 'rule',
  summary: 'Each round a number is cursed: dice showing it count as 0.',
  rules: 'Before each round a number is announced. Any die that lands on it counts as 0. It is drawn from the numbers every one of your dice can show, so with The Whole Bag it is 1 to 4.',
  eligibility: { excludeDiceSets: ['percentile'] },
  beforeThrow: ({ rules, rng }) => {
    const highest = Math.min(...rules.diceSet.dice.map(({ type }) => DIE_MAX[type]));
    const cursed = 1 + rng.int(highest);
    return { spice: { cursed }, announce: `Cursed number: ${cursed}` };
  },
  values: (faces, { state }) => {
    const { cursed } = /** @type {{ cursed: number }} */ (state.spice);
    return faces.map((face) => (face === cursed ? { value: 0, text: String(face), tag: 'cursed' } : { value: face }));
  },
};

/** @type {Spice} */
const UNDERDOG = {
  id: 'underdog',
  name: 'Underdog',
  icon: '🐶',
  kind: 'comeback',
  summary: 'Whoever is behind throws one extra die.',
  rules: 'Whoever has fewer hearts left throws one more die than usual, until they catch up: the commonest die in the set (another d6 with Sneak Attack, a d4 with The Whole Bag). Never more than eight dice.',
  // At eight dice there's no room for another (D6); percentile is two digits.
  eligibility: { maxDice: 7, excludeDiceSets: ['percentile'] },
  hand: (side, base, { rules, state }) => {
    if (rules.winCondition.behind(state.win) !== side || base.types.length >= 8) return base;
    return { ...base, types: [...base.types, extraDieType(rules.diceSet)] };
  },
  edge: ({ rules, state }) => {
    const side = rules.winCondition.behind(state.win);
    return side ? { side, label: '+1 die' } : null;
  },
};

/** @type {Spice} */
const REVENGE = {
  id: 'revenge',
  name: 'Revenge',
  icon: '😤',
  kind: 'comeback',
  summary: 'Win straight after losing, and it costs them double.',
  rules: 'If you lost the last round, winning this one costs your opponent two hearts instead of one.',
  eligibility: {},
  applyDamage: (round, damage, { state }) =>
    (round.winner && state.previous?.winner === other(round.winner) ? multiplyLoser(round, damage, 2) : damage),
  edge: ({ state }) => {
    const last = state.previous?.winner;
    return last ? { side: other(last), label: 'Revenge: a win costs double' } : null;
  },
  explain: ({ winner }, { state }) =>
    (winner && state.previous?.winner === other(winner) ? 'Revenge! Double damage.' : undefined),
};

/** @type {Spice} */
const CRITICAL_HIT = {
  id: 'critical-hit',
  name: 'Critical Hit',
  icon: '🎯',
  kind: 'dice',
  summary: 'Win with a natural 20 and it costs them double.',
  rules: 'If the d20 that counts shows 20 and you win the round, your opponent loses two hearts instead of one. Under Advantage, that is the higher of your two d20s.',
  eligibility: { diceSets: D20_SETS },
  applyDamage: (round, damage) =>
    (round.winner && naturalOf(round, round.winner) === 20 ? multiplyLoser(round, damage, 2) : damage),
  explain: (round) =>
    (round.winner && naturalOf(round, round.winner) === 20 ? 'Critical hit! Double damage.' : undefined),
};

/** @type {Spice} */
const CRITICAL_FUMBLE = {
  id: 'critical-fumble',
  name: 'Critical Fumble',
  icon: '🍌',
  kind: 'dice',
  summary: 'A natural 1 costs you an extra heart.',
  rules: 'If the d20 that counts shows 1, you lose a heart on top of whatever the round costs: two if you lost it, one even on a tie. Under Advantage, only both d20s showing 1 counts.',
  eligibility: { diceSets: D20_SETS },
  applyDamage: (round, damage) => ({
    player: damage.player + (naturalOf(round, 'player') === 1 ? 1 : 0),
    opponent: damage.opponent + (naturalOf(round, 'opponent') === 1 ? 1 : 0),
  }),
  explain: (round) => {
    const fumbles = ['player', 'opponent'].filter((side) => naturalOf(round, /** @type {Side} */ (side)) === 1).length;
    return ['', 'Critical fumble!', 'Two critical fumbles!'][fumbles] || undefined;
  },
};

/** @type {Spice} */
const INSPIRATION = {
  id: 'inspiration',
  name: 'Inspiration',
  icon: '✨',
  kind: 'dice',
  summary: 'Lose a round and you throw the next with advantage.',
  rules: 'Whoever lost the last round is inspired: next round they throw one more d20 and only the highest counts. With Advantage that makes three d20s.',
  eligibility: { diceSets: D20_SETS },
  hand: (side, base, { state }) =>
    (state.previous?.winner === other(side) ? { types: [...base.types, 'd20'], scorer: keepHighest(1) } : base),
  edge: ({ state }) => {
    const last = state.previous?.winner;
    return last ? { side: other(last), label: 'Inspired: advantage' } : null;
  },
};

/** @type {Spice} */
const BRUTAL_CRITICAL = {
  id: 'brutal-critical',
  name: 'Brutal Critical',
  icon: '🪓',
  kind: 'dice',
  summary: 'A 12 rolls another d12 and adds it.',
  rules: 'A d12 showing 12 earns one extra d12, rolled by the game and added to it. Unlike Exploding Dice, it doesn\'t chain.',
  eligibility: { diceSets: ['greataxe'] },
  values: (faces, { rng }) => faces.map((face) => {
    if (face !== 12) return { value: face };
    const extra = 1 + rng.int(12);
    return { value: face + extra, text: `(12+${extra})`, tag: 'exploded' };
  }),
};

/**
 * Snake eyes (1-1) loses whatever else happens, boxcars (6-6) wins.
 * @param {number[]} faces
 */
const pairRank = (faces) => (faces.every((f) => f === 6) ? 2 : faces.every((f) => f === 1) ? 0 : 1);

/** @type {Spice} */
const SNAKE_EYES = {
  id: 'snake-eyes',
  name: 'Snake Eyes / Boxcars',
  icon: '🐍',
  kind: 'dice',
  summary: 'Double 1 loses the round outright; double 6 wins it.',
  rules: 'Throw two 1s (snake eyes) and you lose the round, whatever your opponent threw. Throw two 6s (boxcars) and you win it. Both of you on the same: a tie.',
  eligibility: { diceSets: ['greatsword'] },
  compare: ({ faces, scores }) => {
    const p = pairRank(faces.player);
    const o = pairRank(faces.opponent);
    if (p !== o) return p > o ? 'player' : 'opponent';
    return scores.player > scores.opponent ? 'player' : scores.opponent > scores.player ? 'opponent' : null;
  },
  explain: ({ faces }) => {
    const ranks = [pairRank(faces.player), pairRank(faces.opponent)];
    if (ranks.includes(2)) return 'Boxcars!';
    if (ranks.includes(0)) return 'Snake eyes!';
    return undefined;
  },
};

/**
 * Whether three or more dice show the same number.
 * @param {number[]} faces
 */
const hasTriple = (faces) => faces.some((f) => faces.filter((g) => g === f).length >= 3);

/** @type {Spice} */
const TRIPLES = {
  id: 'triples',
  name: 'Triples',
  icon: '🎰',
  kind: 'dice',
  summary: 'Three of a kind wins the round outright.',
  rules: 'Throw three dice showing the same number and you win the round, whatever the totals. If you both do, the higher total wins as usual. With Heroic Stats the dropped die still counts towards a triple.',
  eligibility: { diceSets: ['ability-score', 'heroic-stats', 'guiding-bolt'] },
  compare: ({ faces, scores }) => {
    const p = hasTriple(faces.player);
    const o = hasTriple(faces.opponent);
    if (p !== o) return p ? 'player' : 'opponent';
    return scores.player > scores.opponent ? 'player' : scores.opponent > scores.player ? 'opponent' : null;
  },
  explain: ({ faces }) => (hasTriple(faces.player) || hasTriple(faces.opponent) ? 'Three of a kind!' : undefined),
};

/** @type {Spice} */
const CALTROPS = {
  id: 'caltrops',
  name: 'Caltrops',
  icon: '📌',
  kind: 'dice',
  summary: 'Every 1 you roll takes 1 off your opponent\'s total.',
  rules: 'Each of your dice that lands on 1 still counts for you, and also takes 1 off your opponent\'s total.',
  eligibility: { diceSets: ['magic-missile', 'swarm-of-daggers'] },
  adjust: ({ faces }, { side }) => {
    const ones = faces[other(side)].filter((f) => f === 1).length;
    return ones ? [{ label: 'caltrops', value: -ones }] : [];
  },
};

/** Every Spice, in the order the catalogue lists them. */
/** @type {Record<string, Spice>} */
export const SPICE = Object.fromEntries([
  VANILLA, SUDDEN_DEATH, MARATHON, MUTUAL_DESTRUCTION, LOWBALL, EXPLODING_DICE, RAISING_THE_STAKES, CURSED_NUMBER,
  UNDERDOG, REVENGE,
  CRITICAL_HIT, CRITICAL_FUMBLE, INSPIRATION, BRUTAL_CRITICAL, SNAKE_EYES, TRIPLES, CALTROPS,
].map((spice) => [spice.id, spice]));

/** What each kind of Spice is called on its card. */
export const SPICE_KINDS = {
  rule: 'Rule change',
  win: 'How to win',
  comeback: 'Comeback',
  dice: 'For these dice',
};
