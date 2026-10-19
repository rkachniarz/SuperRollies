// @ts-check
// Poker hands from dice (DEV_PLAN.md 6.1, D42): the Dice Poker set's scorer,
// and which dice are worth keeping when some can be thrown again (Draw Poker).
//
// The hands, best first: five of a kind, four of a kind, a full house, a
// straight (2-6 beats 1-5), three of a kind, two pair, a pair, nothing. Equal
// hands are decided by their dice, highest group first: a pair of 6s beats a
// pair of 5s, and with the same pair, the higher dice left over win.
//
// A die that counts 0 (cursed, or down a hole) is dead: it makes no part of
// any hand.

/** @typedef {import('./types.js').Scorer} Scorer */

const NOTHING = 0;
const PAIR = 1;
const TWO_PAIR = 2;
const THREE = 3;
const STRAIGHT = 4;
const FULL_HOUSE = 5;
const FOUR = 6;
const FIVE = 7;

// Larger than any face, so a hand's dice can be packed into one number as
// digits (see rank), each group's face outranking every face after it.
const BASE = 7;

/**
 * A hand's shape: its live faces grouped, biggest group first, then highest
 * face first (6 6 6 2 2 is [[6, 3], [2, 2]]), and which kind of hand that is.
 * @param {number[]} faces
 */
function shapeOf(faces) {
  const counts = new Map();
  for (const face of faces) if (face > 0) counts.set(face, (counts.get(face) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sizes = groups.map(([, n]) => n);
  const straight = groups.length === 5 && groups[0][0] - groups[4][0] === 4;
  const kind =
    sizes[0] >= 5 ? FIVE
      : sizes[0] === 4 ? FOUR
        : sizes[0] === 3 && sizes[1] >= 2 ? FULL_HOUSE
          : straight ? STRAIGHT
            : sizes[0] === 3 ? THREE
              : sizes[0] === 2 && sizes[1] === 2 ? TWO_PAIR
                : sizes[0] === 2 ? PAIR
                  : NOTHING;
  return { groups, kind };
}

/**
 * A number for how good a hand is, so the higher hand has the higher number
 * and equal hands equal ones: its kind, then each of its dice as a digit,
 * biggest group first. Never shown; the card names the hand instead (`name`).
 * @param {number[]} faces
 */
function rank(faces) {
  const { groups, kind } = shapeOf(faces);
  const digits = groups.flatMap(([face, n]) => Array(n).fill(face));
  while (digits.length < faces.length) digits.push(0);
  return digits.reduce((total, face) => total * BASE + face, kind);
}

/**
 * What the hand is called on the result card: `Full house (6s, 2s)`.
 * @param {number[]} faces
 */
export function handName(faces) {
  const { groups, kind } = shapeOf(faces);
  const [a, b] = groups.map(([face]) => `${face}s`);
  switch (kind) {
    case FIVE: return `Five ${a}`;
    case FOUR: return `Four ${a}`;
    case FULL_HOUSE: return `Full house (${a}, ${b})`;
    case STRAIGHT: return groups[0][0] === 6 ? 'High straight' : 'Low straight';
    case THREE: return `Three ${a}`;
    case TWO_PAIR: return `Two pair (${a}, ${b})`;
    case PAIR: return `Pair of ${a}`;
    default: return groups.length ? `Nothing (${groups[0][0]} high)` : 'Nothing';
  }
}

/**
 * Which dice to keep when the others can be thrown again: the dice that make
 * the hand, the usual way to play it. A straight or full house is kept
 * whole; four or three of a kind, or two pair, keep their groups and throw
 * the rest; with nothing, the lowest die goes, as four towards a straight.
 * Dead dice are always thrown. Pure, so the opponent decides the same way
 * whoever asks.
 * @param {number[]} faces
 * @returns {boolean[]}
 */
export function pokerHold(faces) {
  const { groups, kind } = shapeOf(faces);
  if (kind === STRAIGHT || kind === FULL_HOUSE || kind === FIVE) return faces.map((face) => face > 0);
  if (kind === NOTHING) {
    const lowest = faces.indexOf(Math.min(...faces.filter((face) => face > 0)));
    return faces.map((face, i) => face > 0 && i !== lowest);
  }
  const keep = new Set(groups.filter(([, n]) => n >= 2).map(([face]) => face));
  return faces.map((face) => keep.has(face));
}

/**
 * The Dice Poker set's scorer: a hand's rank, named on the card. Every die
 * counts, as a hand's leftover dice decide a tie.
 * @type {Scorer}
 */
export const poker = Object.assign(rank, {
  id: 'poker',
  suffix: '',
  describe: handName,
  hold: pokerHold,
});
