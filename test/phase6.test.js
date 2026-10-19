// Phase 6's rules: poker hands (the Dice Poker set) and Draw Poker's redraw,
// Count the Sixes, Burnout, Crown and Wild Magic. What the table does with a
// redraw (the kept dice held where they lie) is checked in
// tools/phase0/check-table.mjs, and in the browser by npm run verify.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, handOf, isEligible, redrawsOf, scoreDice,
} from '../src/rules/engine.js';
import { DICE_SETS } from '../src/rules/dice-sets.js';
import { SPICE } from '../src/rules/spice.js';
import { poker, handName, pokerHold } from '../src/rules/poker.js';

const rulesFor = (diceSet, spice, seed = 1) => resolveRules(matchConfig({ seed, diceSet, spice }));
const offered = (spice) => Object.keys(DICE_SETS).filter((id) => isEligible(SPICE[spice], DICE_SETS[id]));

/** One round from `state` (default a fresh match): beginRound, then playRound with these faces. */
function round(rules, player, opponent, state = startMatch(rules)) {
  ({ state } = beginRound(rules, state));
  return playRound(rules, state, { player, opponent });
}

describe('Phase 6 in the catalogue', () => {
  test('each Spice with the dice it was made for', () => {
    assert.deepEqual(offered('draw-poker'), ['dice-poker']);
    assert.deepEqual(offered('count-the-sixes'), ['fireball']);
    assert.deepEqual(offered('burnout'), ['fireball']);
    assert.deepEqual(offered('crown'), ['the-whole-bag']);
    assert.deepEqual(offered('wild-magic'), ['percentile']);
  });

  test('Dice Poker sits out what needs a total, or a die worth more than its face', () => {
    for (const spice of ['hit-points', 'race-to-n', 'tug-of-war', 'exploding-dice', 'underdog']) {
      assert.ok(!offered(spice).includes('dice-poker'), spice);
    }
    // A die that counts 0 is just a dead die in a hand.
    for (const spice of ['cursed-number', 'pothole', 'lowball', 'second-wind']) {
      assert.ok(offered(spice).includes('dice-poker'), spice);
    }
  });

  test('only Draw Poker gives a redraw', () => {
    for (const spice of Object.keys(SPICE)) {
      const rules = rulesFor(offered(spice)[0], spice);
      assert.equal(redrawsOf(rules), spice === 'draw-poker' ? 1 : 0, spice);
    }
  });
});

describe('poker hands (the Dice Poker set)', () => {
  // Best first, so each beats every one after it.
  const LADDER = [
    [[6, 6, 6, 6, 6], 'Five 6s'],
    [[1, 1, 1, 1, 1], 'Five 1s'],
    [[5, 5, 5, 5, 6], 'Four 5s'],
    [[5, 5, 5, 5, 1], 'Four 5s'],
    [[2, 2, 2, 6, 6], 'Full house (2s, 6s)'],
    [[1, 1, 1, 6, 6], 'Full house (1s, 6s)'],
    [[2, 3, 4, 5, 6], 'High straight'],
    [[5, 4, 3, 2, 1], 'Low straight'],
    [[4, 4, 4, 6, 5], 'Three 4s'],
    [[4, 4, 4, 6, 1], 'Three 4s'],
    [[6, 6, 2, 2, 1], 'Two pair (6s, 2s)'],
    [[5, 5, 3, 3, 6], 'Two pair (5s, 3s)'],
    [[6, 6, 1, 2, 3], 'Pair of 6s'],
    [[2, 2, 6, 5, 4], 'Pair of 2s'],
    [[6, 5, 4, 3, 1], 'Nothing (6 high)'],
    [[6, 5, 4, 2, 1], 'Nothing (6 high)'],
  ];

  test('each hand beats every one below it, and is named on the card', () => {
    LADDER.forEach(([faces, name], i) => {
      assert.equal(handName(faces), name, faces.join());
      for (const [worse] of LADDER.slice(i + 1)) assert.ok(poker(faces) > poker(worse), `${faces} over ${worse}`);
    });
  });

  test('the order the dice lie in makes no difference; the same dice tie', () => {
    assert.equal(poker([6, 2, 6, 2, 6]), poker([2, 2, 6, 6, 6]));
    assert.equal(poker([3, 1, 4, 5, 2]), poker([1, 2, 3, 4, 5]));
  });

  test('a die that counts 0 is dead: no part of any hand', () => {
    assert.equal(handName([0, 2, 3, 4, 5]), 'Nothing (5 high)');
    assert.equal(handName([6, 6, 0, 6, 0]), 'Three 6s');
    assert.equal(handName([0, 0, 0, 0, 0]), 'Nothing');
    assert.ok(poker([6, 6, 6, 1, 0]) < poker([6, 6, 6, 1, 1]));
  });

  test('a round: the better hand wins, every die counts, and the card names both hands', () => {
    const rules = rulesFor('dice-poker', 'vanilla');
    const { outcome } = round(rules, [3, 3, 5, 5, 1], [6, 6, 2, 4, 1]);
    assert.equal(outcome.winner, 'player');
    assert.deepEqual(outcome.named, { player: 'Two pair (5s, 3s)', opponent: 'Pair of 6s' });
    assert.ok(outcome.kept.player.every(Boolean) && outcome.kept.opponent.every(Boolean));
    assert.deepEqual(outcome.damage, { player: 0, opponent: 1 });
    // Between the same pair, the higher dice left over.
    assert.equal(round(rules, [6, 6, 5, 2, 1], [6, 6, 4, 3, 2]).outcome.winner, 'player');
    assert.equal(round(rules, [6, 6, 5, 2, 1], [1, 6, 2, 5, 6]).outcome.winner, null);
  });

  test('with Lowball the worse hand wins; a cursed die or one down a hole is dead', () => {
    assert.equal(round(rulesFor('dice-poker', 'lowball'), [6, 6, 6, 1, 2], [6, 6, 1, 2, 3]).outcome.winner, 'opponent');
    const rules = rulesFor('dice-poker', 'pothole');
    let state = startMatch(rules);
    ({ state } = beginRound(rules, state));
    const fallen = { player: [false, false, true, false, false], opponent: [false, false, false, false, false] };
    const { outcome } = playRound(rules, state, { player: [6, 6, 6, 2, 2], opponent: [5, 5, 5, 3, 1] }, { fallen });
    assert.equal(outcome.named.player, 'Two pair (6s, 2s)');
    assert.equal(outcome.winner, 'opponent');
  });

  test('scored alone (Zen), a hand is named rather than totalled', () => {
    assert.equal(scoreDice(poker, [4, 4, 4, 4, 2]).named, 'Four 4s');
  });
});

describe('Draw Poker: which dice the opponent keeps', () => {
  test('the dice that make the hand; a straight or full house whole', () => {
    assert.deepEqual(pokerHold([6, 6, 2, 4, 1]), [true, true, false, false, false]);
    assert.deepEqual(pokerHold([3, 5, 3, 5, 1]), [true, true, true, true, false]);
    assert.deepEqual(pokerHold([4, 2, 4, 4, 6]), [true, false, true, true, false]);
    assert.deepEqual(pokerHold([2, 2, 2, 2, 5]), [true, true, true, true, false]);
    assert.deepEqual(pokerHold([2, 3, 4, 5, 6]), [true, true, true, true, true]);
    assert.deepEqual(pokerHold([1, 1, 6, 6, 6]), [true, true, true, true, true]);
    assert.deepEqual(pokerHold([5, 5, 5, 5, 5]), [true, true, true, true, true]);
  });

  test('with nothing, the lowest goes, leaving four towards a straight', () => {
    assert.deepEqual(pokerHold([6, 1, 3, 4, 2]), [true, false, true, true, true]);
  });

  test('a dead die is always thrown', () => {
    assert.deepEqual(pokerHold([6, 6, 0, 3, 2]), [true, true, false, false, false]);
  });

  test("it's the Dice Poker scorer's hold", () => {
    assert.equal(DICE_SETS['dice-poker'].scorer.hold, pokerHold);
  });
});

describe('Count the Sixes', () => {
  const rules = rulesFor('fireball', 'count-the-sixes');

  test('only the number of 6s counts; the rest are greyed out', () => {
    const { outcome } = round(rules, [6, 6, 1, 1, 1, 1, 1, 1], [5, 5, 5, 5, 5, 5, 5, 6]);
    assert.deepEqual(outcome.scores, { player: 2, opponent: 1 });
    assert.equal(outcome.winner, 'player');
    assert.deepEqual(outcome.kept.player, [true, true, false, false, false, false, false, false]);
    assert.deepEqual(outcome.named, { player: '2 sixes', opponent: '1 six' });
  });

  test('the same number of 6s is a tie, whatever the totals', () => {
    const { outcome } = round(rules, [6, 1, 1, 1, 1, 1, 1, 1], [6, 5, 5, 5, 5, 5, 5, 5]);
    assert.equal(outcome.winner, null);
    assert.equal(round(rules, [1, 1, 1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2]).outcome.winner, null);
  });
});

describe('Burnout', () => {
  const rules = rulesFor('fireball', 'burnout');
  const eight = (face) => Array(8).fill(face);

  test('each 1 still counts this round, then that die is gone for the match', () => {
    const start = startMatch(rules);
    assert.deepEqual(start.win.dice, { player: 8, opponent: 8 });
    const { outcome, state } = round(rules, [1, 1, 6, 6, 6, 6, 6, 6], eight(4));
    assert.equal(outcome.scores.player, 38);
    assert.deepEqual(outcome.dice.player.slice(0, 3).map((d) => d.tag), ['burnt', 'burnt', undefined]);
    assert.deepEqual(state.win.dice, { player: 6, opponent: 8 });
    assert.deepEqual(state.win.hearts, { player: 3, opponent: 2 });
    assert.equal(handOf(rules, state, 'player').types.length, 6);
    assert.equal(handOf(rules, state, 'opponent').types.length, 8);
    assert.equal(outcome.note, '🔥 Burnt out: you lose 2 dice.');
  });

  test('running out of dice loses the match, hearts or not', () => {
    const { outcome, state } = round(rules, eight(1), eight(2));
    assert.equal(state.win.hearts.player, 2);
    assert.equal(outcome.matchWinner, 'opponent');
    assert.equal(outcome.note, '🔥 Burnt out: you lose 8 dice.');
  });

  test('both out together is a draw', () => {
    assert.equal(round(rules, eight(1), eight(1)).outcome.matchWinner, 'draw');
  });

  test('a shrinking hand plays on: three dice against eight', () => {
    let { state } = round(rules, [1, 1, 1, 1, 1, 6, 6, 6], eight(3));
    assert.equal(handOf(rules, state, 'player').types.length, 3);
    let outcome;
    ({ outcome, state } = round(rules, [6, 6, 1], eight(3), state));
    assert.equal(outcome.winner, 'opponent');
    assert.deepEqual(state.win.dice, { player: 2, opponent: 8 });
  });

  test('burnt dice are marked by the hearts, and the side with fewer dice is behind', () => {
    const { state } = round(rules, [1, 6, 6, 6, 6, 6, 6, 6], [1, 1, 1, 6, 6, 6, 6, 6]);
    // 43 against 33: the player won the round, so the hearts say who's behind.
    assert.equal(rules.winCondition.behind(state.win), 'opponent');
    const view = rules.winCondition.view(state.win);
    assert.deepEqual(view.marks.player, { count: 1, max: 8, label: 'dice burnt out', icon: '🔥' });
    assert.equal(view.marks.opponent.count, 3);
    const level = { ...state.win, hearts: { player: 3, opponent: 3 } };
    assert.equal(rules.winCondition.behind(level), 'opponent');
  });
});

describe('Crown', () => {
  const rules = rulesFor('the-whole-bag', 'crown');

  test('only the highest die counts, plus 5 for every die on its maximum', () => {
    // d4 d6 d8 d10 d12 d20: the d4 and d8 are on their maximum.
    const { outcome } = round(rules, [4, 2, 8, 3, 5, 11], [1, 1, 1, 1, 1, 15]);
    assert.deepEqual(outcome.kept.player, [false, false, false, false, false, true]);
    assert.deepEqual(outcome.adjustments.player, [{ label: '👑', value: 5 }, { label: '👑', value: 5 }]);
    assert.deepEqual(outcome.scores, { player: 21, opponent: 15 });
    assert.equal(outcome.winner, 'player');
  });

  test('the counted die is crowned too; a d10 "0" is its maximum', () => {
    const { outcome } = round(rules, [1, 1, 1, 10, 1, 7], [1, 1, 1, 1, 1, 20]);
    assert.equal(outcome.scores.player, 15);
    assert.equal(outcome.scores.opponent, 25);
  });
});

describe('Wild Magic', () => {
  const rules = rulesFor('percentile', 'wild-magic', 5);
  const SURGE = { swap: 0, double: 1, heal: 2, backfire: 3, fizzle: 4, triumph: 5 };

  /** A round with each side's surge set, from `state` (default fresh). */
  function surging(surge, player, opponent, state = startMatch(rules)) {
    ({ state } = beginRound(rules, state));
    state = { ...state, spice: { surge: { ...state.spice.surge, ...surge } } };
    return playRound(rules, state, { player, opponent });
  }

  test('a surge is drawn before every throw from the rules stream: the same seed, the same surges', () => {
    const draws = (seed) => {
      const r = rulesFor('percentile', 'wild-magic', seed);
      let state = startMatch(r);
      const seen = [];
      for (let i = 0; i < 6; i++) {
        ({ state } = beginRound(r, state));
        seen.push(state.spice.surge);
        ({ state } = playRound(r, state, { player: [40, 7], opponent: [40, 7] }));
      }
      return seen;
    };
    assert.deepEqual(draws(9), draws(9));
    assert.notDeepEqual(draws(9), draws(10));
  });

  test('only matching digits set one off: 11 to 99, and 00 + 0', () => {
    const plain = surging({ player: SURGE.fizzle }, [40, 7], [30, 2]).outcome;
    assert.equal(plain.winner, 'player');
    assert.equal(plain.note, undefined);
    for (const faces of [[10, 1], [90, 9], [100, 10]]) {
      const { outcome } = surging({ player: SURGE.fizzle, opponent: SURGE.double }, faces, [30, 2]);
      assert.equal(outcome.winner, null, faces.join());
      assert.match(outcome.note, /^🌀 Your wild magic surges: it fizzles/);
    }
  });

  test('swap: the totals swap, so the lower wins', () => {
    assert.equal(surging({ player: SURGE.swap }, [40, 4], [70, 1]).outcome.winner, 'player');
  });

  test('double: the round costs twice as much', () => {
    assert.deepEqual(surging({ opponent: SURGE.double }, [90, 7], [30, 3]).outcome.damage, { player: 0, opponent: 2 });
  });

  test('heal: a heart back, never past three; losing the round, it cancels the cost', () => {
    let { state } = surging({}, [10, 2], [90, 1]);
    assert.equal(state.win.player, 2);
    ({ state } = surging({ player: SURGE.heal }, [50, 5], [10, 2], state));
    assert.deepEqual(state.win, { player: 3, opponent: 2 });
    ({ state } = surging({ player: SURGE.heal }, [50, 5], [10, 2], state));
    assert.deepEqual(state.win, { player: 3, opponent: 1 });
    const lost = surging({ player: SURGE.heal }, [20, 2], [90, 1]);
    assert.deepEqual(lost.state.win, { player: 3, opponent: 3 });
  });

  test('backfire: the surger loses a heart on top', () => {
    assert.deepEqual(surging({ player: SURGE.backfire }, [70, 7], [10, 2]).outcome.damage, { player: 1, opponent: 1 });
  });

  test('triumph: the surger wins outright', () => {
    const { outcome } = surging({ opponent: SURGE.triumph }, [90, 1], [10, 1]);
    assert.equal(outcome.winner, 'opponent');
    assert.match(outcome.note, /^🌀 Their wild magic surges: they win the round/);
  });

  test('both can surge at once, player first: two swaps swap back', () => {
    const { outcome } = surging({ player: SURGE.swap, opponent: SURGE.swap }, [30, 3], [60, 6]);
    assert.equal(outcome.winner, 'opponent');
    assert.equal(outcome.note.match(/🌀/g).length, 2);
  });
});
