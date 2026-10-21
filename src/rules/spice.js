// @ts-check
// Spice: what is special about a match (docs/spec.md §6). One per match (D9).
//
// Most Spice change only the rules: what the dice count for, who wins a round,
// what it costs, and what each side throws. Some change the table (a hole, a
// breeze, no divider, a cat's paw) or let a side throw again; even those only
// say what happens, as plain data, and the game carries it out (docs/spec.md
// R4.4). Anything random - an exploding die's extra roll, a cursed number,
// where the hole is - is drawn from the hook context's rng, the match's shared
// rules stream (R5.2). Extra rolls are drawn, not thrown; extra throws
// (Doubles Again, Second Wind) are thrown.

import {
  hearts, hitPoints, raceTo, tugOfWar, burnout, burntOut, DEATH_SAVES, DEATH_SAVE_DC, DEATH_SAVE_FAILS, failsFor, naturalOf,
} from './win-conditions.js';
import { DIE_MAX, extraDieType, keepHighest, countOf } from './dice-sets.js';
import {
  TRAY_HALF_WIDTH, DIVIDER_T, POTHOLE_RADIUS, POTHOLE_DEPTH, CAT_PAW_CHANCE, WIND_MIN, WIND_MAX,
} from '../config.js';

/** @typedef {import('./types.js').Spice} Spice */
/** @typedef {import('./types.js').Side} Side */
/** @typedef {import('./types.js').Round} Round */
/** @typedef {import('./types.js').PerSide<number>} Damage */

/** @param {Side} side */
const other = (side) => (side === 'player' ? 'opponent' : 'player');

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
// it's the higher of the two (docs/decisions.md D26).
const D20_SETS = ['classic', 'advantage'];

// A poker hand's score is its rank, not a total (docs/decisions.md D42), so Spice
// that count totals up, or make a die count for more than its face, sit Dice
// Poker out.
const NOT_POKER = ['dice-poker'];

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
  // Percentile's tens and units aren't a total that can grow, nor is a
  // poker hand.
  eligibility: { excludeDiceSets: ['percentile', ...NOT_POKER] },
  values: (faces, { hand, rng }) => faces.map((face, i) => {
    const max = DIE_MAX[hand.types[i]];
    if (face !== max) return { value: face };
    const rolls = [face];
    for (let roll = max; roll === max && rolls.length <= MAX_EXPLOSIONS;) {
      roll = 1 + rng.int(max);
      rolls.push(roll);
    }
    return { value: rolls.reduce((a, b) => a + b, 0), text: `(${rolls.join('+')})`, tag: 'exploded', extra: rolls.slice(1) };
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
  // At eight dice there's no room for another (D6); percentile is two
  // digits, and a poker hand is five dice.
  eligibility: { maxDice: 7, excludeDiceSets: ['percentile', ...NOT_POKER] },
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
    return { value: face + extra, text: `(12+${extra})`, tag: 'exploded', extra: [extra] };
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

// ---------- Phase 5: win conditions that count points ----------

/** @type {Spice} */
const HIT_POINTS = {
  id: 'hit-points',
  name: 'Hit Points',
  icon: '🩸',
  kind: 'win',
  summary: 'Lose a round and you lose the difference in HP.',
  rules: 'Instead of hearts, each side has hit points, more with dice that roll bigger totals (30 with The Classic). The round\'s loser loses as many as the totals differ by: 17 against 9 costs 8 HP. Run out and you lose the match.',
  eligibility: { excludeDiceSets: NOT_POKER },
  winCondition: hitPoints,
};

/** @type {Spice} */
const RACE_TO_N = {
  id: 'race-to-n',
  name: 'Race to N',
  icon: '🏁',
  kind: 'win',
  summary: 'Every total adds up. First to the target wins.',
  rules: 'Every round, each side\'s total is added to its score, win or lose. The first to reach the target wins the match; the target is about five average throws (55 with The Classic). If you both get there in the same round, the higher score wins.',
  eligibility: { excludeDiceSets: NOT_POKER },
  winCondition: raceTo,
};

/** @type {Spice} */
const TUG_OF_WAR = {
  id: 'tug-of-war',
  name: 'Tug of War',
  icon: '💪',
  kind: 'win',
  summary: 'A rope down the table. Each round its flag is pulled towards the loser: pull it to their end.',
  rules: 'A rope lies down the middle of the table, from your end to your opponent\'s, and the dice bounce off it or roll over it. A flag tied to it starts halfway. Each round it is pulled towards the loser by the difference between the totals; pull it to their end and they lose the match. The rope is longer with dice that roll bigger totals.',
  eligibility: { excludeDiceSets: NOT_POKER },
  winCondition: tugOfWar,
  table: ({ rules, state }) => ({ rope: { pull: rules.winCondition.pull?.(state.win) ?? 0 } }),
};

// ---------- Phase 5: re-throws ----------

/** @typedef {{ used: import('./types.js').PerSide<boolean> }} RethrowState */

/** @param {import('./types.js').StateContext} ctx */
const usedOf = ({ state }) => /** @type {RethrowState} */ (state.spice).used;

/**
 * A re-throw each side may spend once a match, while `can` allows it.
 * @param {(side: Side, ctx: import('./types.js').StateContext) => boolean} can
 */
const oncePerMatch = (can) => ({
  can: (/** @type {Side} */ side, /** @type {import('./types.js').StateContext} */ ctx) =>
    !usedOf(ctx)[side] && can(side, ctx),
  spend: (/** @type {Side} */ side, /** @type {import('./types.js').StateContext} */ ctx) =>
    ({ used: { ...usedOf(ctx), [side]: true } }),
});

/** @type {Spice} */
const SECOND_WIND = {
  id: 'second-wind',
  name: 'Second Wind',
  icon: '🌬️',
  kind: 'rule',
  summary: 'Once a match, throw all your dice again after seeing the result.',
  rules: 'Each of you can call on a second wind once per match. When you lose a round, you can throw all your dice again once both results are shown, and the round is played out with your new throw. If that turns it around, your opponent can use theirs.',
  eligibility: {},
  setup: () => ({ used: { player: false, opponent: false } }),
  rethrow: oncePerMatch(() => true),
  edge: (ctx) => /** @type {Side[]} */ (['player', 'opponent'])
    .filter((side) => !usedOf(ctx)[side])
    .map((side) => ({ side, label: 'Second Wind ready' })),
};

/** How many hearts behind a side must be for Mercy (docs/decisions.md D30). */
const MERCY_BEHIND = 2;

/**
 * How many hearts `side` is behind by.
 * @param {Side} side
 * @param {import('./types.js').StateContext} ctx
 */
const heartsBehind = (side, { state }) => {
  const hearts = /** @type {import('./types.js').PerSide<number>} */ (state.win);
  return hearts[other(side)] - hearts[side];
};

/** @type {Spice} */
const MERCY = {
  id: 'mercy',
  name: 'Mercy',
  icon: '🕊️',
  kind: 'comeback',
  summary: 'Fall two hearts behind and you get one free re-throw.',
  rules: `Once you are ${MERCY_BEHIND} hearts behind, you are shown mercy: once in the match, after losing a round, you can throw all your dice again and have the round played out with your new throw.`,
  eligibility: {},
  setup: () => ({ used: { player: false, opponent: false } }),
  rethrow: oncePerMatch((side, ctx) => heartsBehind(side, ctx) >= MERCY_BEHIND),
  edge: (ctx) => /** @type {Side[]} */ (['player', 'opponent'])
    .filter((side) => MERCY.rethrow.can(side, ctx))
    .map((side) => ({ side, label: 'Mercy: a free re-throw' })),
};

// ---------- Phase 5: on the table ----------

/**
 * Pothole's hole, from where on the table it was drawn: a fraction across
 * the middle of the tray (-1 to 1) and one along a half (0 to 1).
 * @typedef {{ hole: number[] }} PotholeState
 */

/** @type {Spice} */
const POTHOLE = {
  id: 'pothole',
  name: 'Pothole',
  icon: '🕳️',
  kind: 'table',
  summary: 'A hole in each half of the table. A die that falls in counts as 0.',
  rules: 'There is a hole in each half of the table, in the same place from where each of you sits. A die that falls in counts as 0. It stays down there until you pick your dice up again.',
  eligibility: {},
  setup: ({ rng }) => ({ hole: [rng.next() * 2 - 1, rng.next()] }),
  // Arithmetic only, from the rules stream: every client puts the hole in
  // exactly the same place (its record is the throw's, see physics.js). Near
  // the middle across, so it's on screen on a phone held upright too; along
  // the half, clear of the divider and the near wall.
  table: ({ rules, state }) => {
    const [u, v] = /** @type {PotholeState} */ (state.spice).hole;
    const { halfWidth, depth: half } = rules.diceSet.tray;
    const k = halfWidth / TRAY_HALF_WIDTH;
    const r = POTHOLE_RADIUS * k;
    const near = DIVIDER_T + r + 0.2 * k;
    const far = half - r - 0.2 * k;
    const x = u * 0.3 * halfWidth;
    const z = near + v * (far - near);
    const depth = POTHOLE_DEPTH * k;
    return { holes: [{ x, z, r, depth }, { x: -x, z: -z, r, depth }] };
  },
  values: (faces, { fallen }) => faces.map((face, i) => (fallen[i] ? { value: 0, text: 'hole', tag: 'fallen' } : { value: face })),
  explain: ({ fallen }) => {
    const down = fallen.player.filter(Boolean).length + fallen.opponent.filter(Boolean).length;
    return ['', 'Down the hole!', 'Two down the hole!'][down] ?? `${down} down the hole!`;
  },
};

/** @type {Spice} */
const CAT_PAW = {
  id: 'cat-paw',
  name: 'Cat Paw',
  icon: '🐾',
  kind: 'table',
  summary: 'Once the dice settle, a paw might swipe in and knock one or two.',
  rules: 'There is a cat under the table. After each throw, once the dice have settled, there is a good chance a paw swipes in and knocks one or two of the dice, from either side, and they roll again. What they land on counts.',
  eligibility: {},
  afterSettle: ({ dice, rng }) => {
    if (rng.next() >= CAT_PAW_CHANCE) return { spice: { swiped: 0 } };
    /** @type {{ side: Side, index: number }[]} */
    const all = [];
    for (const side of /** @type {Side[]} */ (['player', 'opponent'])) {
      for (let index = 0; index < dice[side]; index++) all.push({ side, index });
    }
    const count = Math.min(all.length, rng.next() < 0.5 ? 1 : 2);
    const swipes = [];
    for (let i = 0; i < count; i++) {
      const die = all.splice(rng.int(all.length), 1)[0];
      swipes.push({ ...die, power: 0.5 + 0.5 * rng.next(), turn: rng.next() * 2 - 1 });
    }
    return { swipes, spice: { swiped: count } };
  },
  explain: (_round, { state }) => {
    const swiped = /** @type {{ swiped?: number }} */ (state.spice ?? {}).swiped;
    return swiped ? `🐾 The cat knocked ${swiped === 1 ? 'a die' : 'two dice'}!` : undefined;
  },
};

// The breeze's directions, as the player sees the table: x to the right, z
// towards them. Written out rather than from Math.cos, whose last bit may
// differ between JavaScript engines, and the wind is part of a throw's
// record (determinism, docs/decisions.md D10).
const D = 0.7071067811865476;
/** @type {[number, number, string][]} */
const WINDS = [
  [1, 0, '→'], [D, -D, '↗'], [0, -1, '↑'], [-D, -D, '↖'],
  [-1, 0, '←'], [-D, D, '↙'], [0, 1, '↓'], [D, D, '↘'],
];

/** @type {Spice} */
const GUSTY_TABLE = {
  id: 'gusty-table',
  name: 'Gusty Table',
  icon: '💨',
  kind: 'table',
  summary: 'A breeze blows across the table, pushing the dice as they roll.',
  rules: 'Each round a breeze blows across the table from a new direction, sometimes gently, sometimes hard. It pushes every die that is still rolling, yours and your opponent\'s alike, but can\'t shift one lying still. Its direction is shown before you throw.',
  eligibility: {},
  beforeThrow: ({ rng }) => {
    const [dx, dz, arrow] = WINDS[rng.int(WINDS.length)];
    const strength = WIND_MIN + rng.next() * (WIND_MAX - WIND_MIN);
    const gale = strength > (WIND_MIN + WIND_MAX) / 2;
    return { spice: { wind: [dx * strength, dz * strength] }, announce: `${gale ? 'Strong wind' : 'A breeze'} blowing ${arrow}` };
  },
  table: ({ state }) => ({ wind: /** @type {{ wind?: number[] }} */ (state.spice ?? {}).wind ?? null }),
};

/** @type {Spice} */
const NO_MANS_LAND = {
  id: 'no-mans-land',
  name: 'No Man\'s Land',
  icon: '⚔️',
  kind: 'table',
  summary: 'No divider: both sides throw into the same tray, and dice collide.',
  rules: 'The wall down the middle of the table is gone. You both still throw from your own half, at the same time, but the dice can roll anywhere and knock into each other\'s.',
  eligibility: {},
  table: () => ({ divider: false }),
};

// ---------- Phase 5: for particular dice ----------

/** Throws a side makes in a round at most under Doubles Again: two more. */
const MAX_THROWS = 3;

/**
 * Whether two or more of `faces` are the same.
 * @param {number[]} faces
 */
const hasDoubles = (faces) => new Set(faces).size < faces.length;

/** @type {Spice} */
const DOUBLES_AGAIN = {
  id: 'doubles-again',
  name: 'Doubles Again',
  icon: '🎲',
  kind: 'dice',
  summary: 'Throw doubles and you throw again, adding it to your total.',
  rules: `If two of your dice show the same number, you throw all your dice again and add the new throw to your total. Doubles again, and you throw once more, up to ${MAX_THROWS} throws a round.`,
  eligibility: { diceSets: ['greatsword', 'ability-score'] },
  again: (throws) => throws.length < MAX_THROWS && hasDoubles(throws.at(-1)),
  adjust: ({ again }, { side }) => again[side].map((faces) => ({ label: 'again', value: faces.reduce((a, b) => a + b, 0) })),
  explain: ({ again }) => (again.player.length || again.opponent.length ? 'Doubles! Thrown again.' : undefined),
};

/** @type {Spice} */
const DEATH_SAVES_SPICE = {
  id: 'death-saves',
  name: 'Death Saves',
  icon: '⚰️',
  kind: 'dice',
  summary: 'Roll under 10 and you fail a death save. Three fails and you\'re out.',
  rules: `Hearts as usual, and every throw is also a death save, whatever your opponent threw: under ${DEATH_SAVE_DC} is a fail, a natural 1 is two, and a natural 20 wipes them all. ${DEATH_SAVE_FAILS} fails and you lose the match, hearts or not. Under Advantage, the higher d20 counts.`,
  eligibility: { diceSets: D20_SETS },
  winCondition: DEATH_SAVES,
  explain: (round) => {
    const said = /** @type {Side[]} */ (['player', 'opponent']).map((side) => {
      const [who, whose] = side === 'player' ? ['you', 'yours'] : ['they', 'theirs'];
      const fails = failsFor(naturalOf(round, side));
      if (fails === null) return `${who} wipe ${whose} with a 20`;
      return fails ? `${who} fail ${fails === 1 ? 'one' : 'two'}` : '';
    }).filter(Boolean);
    return said.length ? `Death saves: ${said.join('; ')}.` : undefined;
  },
};

// ---------- Phase 6: other ways to score ----------

/** @type {Spice} */
const DRAW_POKER = {
  id: 'draw-poker',
  name: 'Draw Poker',
  icon: '🃏',
  kind: 'dice',
  summary: 'Once a round, throw any of your dice again before the hands are shown.',
  rules: 'Once you have both thrown, each of you may throw any of your dice again, once: tap the ones to throw, then pick them up and throw them, or keep them all. The dice you keep stay where they lie. Then the hands are shown. Your opponent keeps the dice that make its hand.',
  eligibility: { diceSets: ['dice-poker'] },
  redraws: 1,
};

const SIXES = countOf(6, 'six', 'sixes');

/** @type {Spice} */
const COUNT_THE_SIXES = {
  id: 'count-the-sixes',
  name: 'Count the Sixes',
  icon: '🎲',
  kind: 'dice',
  summary: 'Only the number of 6s counts.',
  rules: 'Forget the total: whoever has more dice showing 6 wins the round. The same number of 6s is a tie.',
  eligibility: { diceSets: ['fireball'] },
  hand: (_side, base) => ({ ...base, scorer: SIXES }),
};

/** @type {Spice} */
const BURNOUT = {
  id: 'burnout',
  name: 'Burnout',
  icon: '🔥',
  kind: 'dice',
  summary: 'Every die that lands on a 1 is lost for the rest of the match.',
  rules: 'Hearts as usual, but each of your dice that lands on a 1 burns out: it still counts this round, then it is gone for the rest of the match, and you throw one fewer. Run out of dice and you lose the match, hearts or not.',
  eligibility: { diceSets: ['fireball'] },
  winCondition: burnout,
  // How many dice each side has left is the win condition's, so this
  // depends on the match state only.
  hand: (side, base, { state }) =>
    ({ ...base, types: base.types.slice(0, /** @type {import('./win-conditions.js').BurnoutState} */ (state.win).dice[side]) }),
  values: (faces) => faces.map((face) => (face === 1 ? { value: face, text: '1', tag: 'burnt' } : { value: face })),
  explain: ({ faces }) => {
    const lost = /** @type {Side[]} */ (['player', 'opponent']).map((side) => {
      const n = burntOut(faces[side]);
      return n ? `${side === 'player' ? 'you lose' : 'they lose'} ${n === 1 ? 'a die' : `${n} dice`}` : '';
    }).filter(Boolean);
    return lost.length ? `🔥 Burnt out: ${lost.join(', ')}.` : undefined;
  },
};

/** What Crown adds for each die showing its highest number. */
const CROWN_BONUS = 5;

/** @type {Spice} */
const CROWN = {
  id: 'crown',
  name: 'Crown',
  icon: '👑',
  kind: 'dice',
  summary: `Only your highest die counts, but every die on its maximum adds ${CROWN_BONUS}.`,
  rules: `Only your single highest die counts towards your total. But every die showing its highest number (a 4 on the d4, a 20 on the d20) is crowned, and adds ${CROWN_BONUS}, the one that counts too.`,
  eligibility: { diceSets: ['the-whole-bag'] },
  hand: (_side, base) => ({ ...base, scorer: keepHighest(1) }),
  adjust: ({ values }, { side, hand }) => values[side]
    .filter((value, i) => value === DIE_MAX[hand.types[i]])
    .map(() => ({ label: '👑', value: CROWN_BONUS })),
};

/**
 * Wild Magic's surges, by what they do to the round, and how the card says
 * so. `who` is the side that surged: `you` or `they`.
 * @type {{ id: string, text: (who: string) => string }[]}
 */
const SURGES = [
  { id: 'swap', text: () => 'the totals swap, so the lower wins.' },
  { id: 'double', text: () => 'this round costs double.' },
  { id: 'heal', text: (who) => `${who} regain a heart.` },
  { id: 'backfire', text: (who) => `it backfires, and ${who} lose a heart.` },
  { id: 'fizzle', text: () => 'it fizzles, and nobody wins the round.' },
  { id: 'triumph', text: (who) => `${who} win the round, whatever the totals.` },
];

/** @typedef {{ surge: import('./types.js').PerSide<number> }} WildMagicState */

/**
 * Whether a percentile result's two digits match: 11, 22 ... 99, and 100
 * (`00 + 0`).
 * @param {number} score
 */
const matchingDigits = (score) => score === 100 || score % 11 === 0;

/**
 * The sides whose result set off a surge, player first, each with the surge
 * drawn for it.
 * @param {Pick<Round, 'scores'>} round
 * @param {import('./types.js').StateContext} ctx
 */
function surgesOf({ scores }, { state }) {
  const { surge } = /** @type {WildMagicState} */ (state.spice);
  return /** @type {Side[]} */ (['player', 'opponent'])
    .filter((side) => matchingDigits(scores[side]))
    .map((side) => ({ side, ...SURGES[surge[side]] }));
}

/** @type {Spice} */
const WILD_MAGIC = {
  id: 'wild-magic',
  name: 'Wild Magic',
  icon: '🌀',
  kind: 'dice',
  summary: 'Roll matching digits (11, 22...) and you set off a wild magic surge.',
  rules: 'A result whose two digits match (11, 22 and so on up to 99, and 00 + 0, which makes 100) sets off a surge of wild magic, picked by the game: the totals swap, the round costs double, you regain a heart, it backfires and you lose one, it fizzles and nobody wins, or you win the round outright. You can both surge at once.',
  eligibility: { diceSets: ['percentile'] },
  // Drawn before every throw, whether it's set off or not: so each side's is
  // the same whichever hook reads it, and the rules stream moves on the same
  // way every round.
  beforeThrow: ({ rng }) => ({ spice: { surge: { player: rng.int(SURGES.length), opponent: rng.int(SURGES.length) } } }),
  compare: (round, ctx) => {
    const { player, opponent } = round.scores;
    /** @type {Side | null} */
    let winner = player > opponent ? 'player' : opponent > player ? 'opponent' : null;
    for (const { side, id } of surgesOf(round, ctx)) {
      if (id === 'swap') winner = winner && other(winner);
      else if (id === 'fizzle') winner = null;
      else if (id === 'triumph') winner = side;
    }
    return winner;
  },
  applyDamage: (round, damage, ctx) => {
    let cost = damage;
    for (const { side, id } of surgesOf(round, ctx)) {
      if (id === 'double') cost = { player: cost.player * 2, opponent: cost.opponent * 2 };
      // A cost below nothing is a heart back (never past three: Hearts' apply).
      else if (id === 'heal') cost = { ...cost, [side]: cost[side] - 1 };
      else if (id === 'backfire') cost = { ...cost, [side]: cost[side] + 1 };
    }
    return cost;
  },
  explain: (round, ctx) => {
    const said = surgesOf(round, ctx).map(({ side, text }) =>
      `🌀 ${side === 'player' ? 'Your' : 'Their'} wild magic surges: ${text(side === 'player' ? 'you' : 'they')}`);
    return said.length ? said.join(' ') : undefined;
  },
};

/** Every Spice, in the order the catalogue lists them. */
/** @type {Record<string, Spice>} */
export const SPICE = Object.fromEntries([
  VANILLA, SUDDEN_DEATH, MARATHON, MUTUAL_DESTRUCTION, LOWBALL, EXPLODING_DICE, RAISING_THE_STAKES, CURSED_NUMBER,
  SECOND_WIND,
  HIT_POINTS, RACE_TO_N, TUG_OF_WAR,
  UNDERDOG, REVENGE, MERCY,
  POTHOLE, CAT_PAW, GUSTY_TABLE, NO_MANS_LAND,
  CRITICAL_HIT, CRITICAL_FUMBLE, INSPIRATION, BRUTAL_CRITICAL, SNAKE_EYES, TRIPLES, CALTROPS,
  DOUBLES_AGAIN, DEATH_SAVES_SPICE,
  DRAW_POKER, COUNT_THE_SIXES, BURNOUT, CROWN, WILD_MAGIC,
].map((spice) => [spice.id, spice]));

/** What each kind of Spice is called on its card. */
export const SPICE_KINDS = {
  rule: 'Rule change',
  win: 'How to win',
  comeback: 'Comeback',
  table: 'On the table',
  dice: 'For these dice',
};
