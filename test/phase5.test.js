// Phase 5's rules: the win conditions that count points, Death Saves, the
// re-throws (Second Wind, Mercy), the Spice that change the table (Pothole,
// Cat Paw, Gusty Table, No Man's Land) and Doubles Again. What the table does
// with them physically is checked in tools/phase0/check-table.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, handOf, edgeOf, isEligible,
  tableOf, afterSettle, throwsAgain, canRethrow, spendRethrow,
} from '../src/rules/engine.js';
import { DICE_SETS, DIE_MAX, dieFaces, scoreStats } from '../src/rules/dice-sets.js';
import { SPICE } from '../src/rules/spice.js';
import { failsFor } from '../src/rules/win-conditions.js';
import { eligibleSpice, testBenchSpice, OFFERS } from '../src/rules/draft.js';
import {
  TRAY_HALF_WIDTH, DIVIDER_T, POTHOLE_RADIUS, CAT_PAW_CHANCE, WIND_MIN, WIND_MAX,
} from '../src/config.js';

const rulesFor = (diceSet, spice, seed = 1) => resolveRules(matchConfig({ seed, diceSet, spice }));
const offered = (spice) => Object.keys(DICE_SETS).filter((id) => isEligible(SPICE[spice], DICE_SETS[id]));

/** Plays rounds from `state` (default a fresh match); each entry is [playerFaces, opponentFaces]. */
function playRounds(rules, rolls, state = startMatch(rules)) {
  const outcomes = [];
  for (const [player, opponent] of rolls) {
    let outcome;
    ({ state } = beginRound(rules, state));
    ({ outcome, state } = playRound(rules, state, { player, opponent }));
    outcomes.push(outcome);
    if (outcome.matchWinner) break;
  }
  return { outcomes, state, last: outcomes.at(-1) };
}

describe('Phase 5 in the catalogue', () => {
  test('eligibility: Doubles Again with 2d6 and 3d6, Death Saves with the d20 sets, the rest with any', () => {
    assert.deepEqual(offered('doubles-again'), ['greatsword', 'ability-score']);
    assert.deepEqual(offered('death-saves'), ['classic', 'advantage']);
    for (const spice of ['second-wind', 'mercy', 'pothole', 'cat-paw', 'gusty-table', 'no-mans-land']) {
      assert.equal(offered(spice).length, Object.keys(DICE_SETS).length, spice);
    }
    // A poker hand's score is a rank, not a total to lose or bank (D42).
    for (const spice of ['hit-points', 'race-to-n', 'tug-of-war']) {
      assert.deepEqual(offered(spice), Object.keys(DICE_SETS).filter((id) => id !== 'dice-poker'), spice);
    }
  });

  test('every dice set still has at least two Spice to offer', () => {
    for (const id of Object.keys(DICE_SETS)) assert.ok(eligibleSpice(id).length >= OFFERS, id);
  });

  test('every hook is pure: the state it is given is left untouched', () => {
    for (const spice of Object.keys(SPICE)) {
      const set = offered(spice)[0];
      const rules = rulesFor(set, spice);
      let state = startMatch(rules);
      ({ state } = beginRound(rules, state));
      const before = structuredClone(state);
      const n = handOf(rules, state, 'player').types.length;
      tableOf(rules, state);
      afterSettle(rules, state, { player: n, opponent: n });
      throwsAgain(rules, state, 'player', [handOf(rules, state, 'player').types.map(() => 1)]);
      if (canRethrow(rules, state, 'player')) spendRethrow(rules, state, 'player');
      edgeOf(rules, state);
      assert.deepEqual(state, before, spice);
    }
  });

  test('without a Spice that changes it, the table is plain and a round has no fallen dice or extra throws', () => {
    const rules = rulesFor('greatsword', 'vanilla');
    const state = startMatch(rules);
    assert.deepEqual(tableOf(rules, state), { holes: [], wind: null, divider: true, rope: null });
    assert.deepEqual(afterSettle(rules, state, { player: 2, opponent: 2 }), { state, swipes: [] });
    assert.equal(throwsAgain(rules, state, 'player', [[3, 3]]), false);
    assert.equal(canRethrow(rules, state, 'player'), false);
    assert.throws(() => spendRethrow(rules, state, 'player'), /no re-throw/);
    const { outcome } = playRound(rules, state, { player: [3, 3], opponent: [1, 2] });
    assert.deepEqual(outcome.fallen, { player: [false, false], opponent: [false, false] });
    assert.deepEqual(outcome.again, { player: [], opponent: [] });
  });
});

describe('the test bench (D39)', () => {
  test('offers every Spice a set allows, those made for particular sets first', () => {
    for (const id of Object.keys(DICE_SETS)) {
      const offered = testBenchSpice(id);
      assert.deepEqual(new Set(offered), new Set(eligibleSpice(id)), id);
      // Once a general Spice appears, no set-specific one follows it.
      const general = offered.map((s) => !s.eligibility.diceSets);
      assert.ok(general.every((g, i) => g || !general.slice(0, i).includes(true)), id);
    }
    assert.deepEqual(testBenchSpice('greatsword').slice(0, 2).map((s) => s.id), ['snake-eyes', 'doubles-again']);
    assert.deepEqual(testBenchSpice('fireball').slice(0, 3).map((s) => s.id), ['count-the-sixes', 'burnout', 'vanilla']);
  });
});

describe('score statistics (what the point-counting win conditions scale to)', () => {
  test('every face of each die, as it counts', () => {
    assert.deepEqual(dieFaces('d4'), [1, 2, 3, 4]);
    assert.deepEqual(dieFaces('d10'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(dieFaces('d%'), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  test('exact, worked out from every way the dice land', () => {
    // A d20: mean 10.5, and two d20s are (n² - 1) / 3n = 6.65 apart on average.
    const classic = scoreStats(DICE_SETS.classic);
    assert.ok(Math.abs(classic.mean - 10.5) < 1e-9);
    assert.ok(Math.abs(classic.meanGap - 399 / 60) < 1e-9);
    // 8d6 sums to 28 on average; percentile is 1-100 evenly, 50.5.
    assert.ok(Math.abs(scoreStats(DICE_SETS.fireball).mean - 28) < 1e-9);
    assert.ok(Math.abs(scoreStats(DICE_SETS.percentile).mean - 50.5) < 1e-9);
    // Advantage keeps the higher of two: 13.825.
    assert.ok(Math.abs(scoreStats(DICE_SETS.advantage).mean - 13.825) < 1e-9);
  });
});

describe('Hit Points', () => {
  test('HP scaled to the dice: 30 with The Classic, more with bigger gaps', () => {
    const hp = (set) => startMatch(rulesFor(set, 'hit-points')).win.player;
    assert.equal(hp('classic'), 30);
    assert.ok(hp('percentile') > hp('the-whole-bag') && hp('the-whole-bag') > hp('greatsword'));
  });

  test('the loser loses the difference; a tie costs nothing', () => {
    const rules = rulesFor('classic', 'hit-points');
    const { outcomes, state } = playRounds(rules, [[[17], [9]], [[5], [5]], [[2], [20]]]);
    assert.deepEqual(outcomes.map((o) => o.damage), [
      { player: 0, opponent: 8 }, { player: 0, opponent: 0 }, { player: 18, opponent: 0 },
    ]);
    assert.deepEqual(state.win, { player: 12, opponent: 22 });
  });

  test('running out loses the match; HP never goes below 0', () => {
    const rules = rulesFor('classic', 'hit-points');
    const { last, state } = playRounds(rules, [[[1], [20]], [[1], [20]]]);
    assert.equal(last.matchWinner, 'opponent');
    assert.equal(state.win.player, 0);
  });

  test('drawn as a bar per side', () => {
    const rules = rulesFor('classic', 'hit-points');
    assert.deepEqual(rules.winCondition.view({ player: 12, opponent: 30 }), {
      kind: 'bar', style: 'hp',
      sides: { player: { value: 12, max: 30, text: '12 HP' }, opponent: { value: 30, max: 30, text: '30 HP' } },
    });
  });
});

describe('Race to N', () => {
  test('every total is banked, win or lose; the first to N wins', () => {
    const rules = rulesFor('classic', 'race-to-n');
    const target = rules.winCondition.view(startMatch(rules).win).sides.player.max;
    assert.equal(target, 55);
    const { outcomes, state, last } = playRounds(rules, [[[20], [19]], [[20], [1]], [[14], [20]], [[2], [2]]]);
    assert.deepEqual(state.win, { player: 56, opponent: 42 });
    assert.equal(last.matchWinner, 'player');
    assert.equal(outcomes.length, 4);
  });

  test('both past N in the same round: the higher wins, level is a draw', () => {
    const rules = rulesFor('classic', 'race-to-n');
    const start = { ...startMatch(rules), win: { player: 50, opponent: 48 } };
    assert.equal(playRounds(rules, [[[6], [9]]], start).last.matchWinner, 'opponent');
    assert.equal(playRounds(rules, [[[9], [11]]], start).last.matchWinner, 'draw');
  });
});

describe('Tug of War', () => {
  test('the marker is pulled towards the loser by the difference; at their edge, they lose', () => {
    const rules = rulesFor('classic', 'tug-of-war');
    const { view } = rules.winCondition;
    // A rope of 20 each way with The Classic: 3 times the average gap.
    assert.deepEqual(view(0).sides.player, { value: 20, max: 40, text: '20 to your edge' });
    assert.equal(view(0).sides.opponent.text, '20 to their edge');
    const { state, outcomes, last } = playRounds(rules, [[[18], [4]], [[3], [8]], [[20], [9]]]);
    assert.deepEqual(outcomes.slice(0, 2).map((o) => o.matchWinner), [null, null]);
    assert.equal(state.win, 20);
    assert.equal(last.matchWinner, 'player');
  });

  test('each side sees how far the marker is from its own edge; the two add up to the rope', () => {
    const { view } = rulesFor('classic', 'tug-of-war').winCondition;
    const { sides } = view(-7);
    assert.equal(sides.player.value, 13);
    assert.equal(sides.opponent.value, 27);
  });

  test('puts a rope down the table, its flag as far along as the marker', () => {
    const rules = rulesFor('classic', 'tug-of-war');
    const at = (marker) => tableOf(rules, { ...startMatch(rules), win: marker }).rope;
    assert.deepEqual([at(0), at(-20), at(10)], [{ pull: 0 }, { pull: -1 }, { pull: 0.5 }]);
    // The divider stays, and no other Spice puts a rope down.
    assert.equal(tableOf(rules, startMatch(rules)).divider, true);
    const vanilla = rulesFor('classic', 'vanilla');
    assert.equal(tableOf(vanilla, startMatch(vanilla)).rope, null);
  });
});

describe('Death Saves', () => {
  test('under 10 fails one, a natural 1 two, a 20 wipes them', () => {
    assert.deepEqual([1, 2, 9, 10, 19, 20].map(failsFor), [2, 1, 1, 0, 0, null]);
  });

  test('three fails ends the match whatever the hearts and the other roll', () => {
    const rules = rulesFor('classic', 'death-saves');
    // The player wins every round on hearts, but keeps failing saves.
    const { state, last, outcomes } = playRounds(rules, [[[8], [1]], [[9], [2]]]);
    assert.equal(outcomes.length, 2);
    assert.deepEqual(state.win.hearts, { player: 3, opponent: 1 });
    // The opponent failed two (a natural 1) then one more: three. The player
    // failed two as well, and lost no heart, but that's not three.
    assert.equal(last.matchWinner, 'player');
    assert.deepEqual(state.win.fails, { player: 2, opponent: 3 });
  });

  test('a 20 wipes the fails; both out together is a draw', () => {
    const rules = rulesFor('classic', 'death-saves');
    let { state } = playRounds(rules, [[[5], [5]], [[20], [6]]]);
    assert.deepEqual(state.win.fails, { player: 0, opponent: 2 });
    const { last } = playRounds(rules, [[[1], [5]], [[1], [1]]]);
    assert.equal(last.matchWinner, 'draw');
  });

  test('under Advantage, the higher d20 is the save', () => {
    const rules = rulesFor('advantage', 'death-saves');
    const { state } = playRounds(rules, [[[1, 12], [1, 1]]]);
    assert.deepEqual(state.win.fails, { player: 0, opponent: 2 });
  });

  test('its hearts carry marks for the fails, and the card says who failed', () => {
    const rules = rulesFor('classic', 'death-saves');
    const { state, last } = playRounds(rules, [[[4], [20]]]);
    const view = rules.winCondition.view(state.win);
    assert.equal(view.kind, 'hearts');
    assert.deepEqual(view.marks.player, { count: 1, max: 3, label: 'failed death saves' });
    assert.equal(last.note, 'Death saves: you fail one; they wipe theirs with a 20.');
  });
});

describe('Second Wind', () => {
  test('each side may re-throw once a match; replayed from where the round began', () => {
    const rules = rulesFor('classic', 'second-wind');
    let state = startMatch(rules);
    ({ state } = beginRound(rules, state));
    const lost = playRound(rules, state, { player: [3], opponent: [15] });
    assert.equal(lost.outcome.winner, 'opponent');
    assert.ok(canRethrow(rules, state, 'player'));
    const spent = spendRethrow(rules, state, 'player');
    assert.equal(canRethrow(rules, spent, 'player'), false);
    assert.equal(canRethrow(rules, spent, 'opponent'), true);
    // Played out again with the new throw: the old outcome is gone.
    const again = playRound(rules, spent, { player: [19], opponent: [15] });
    assert.equal(again.outcome.winner, 'player');
    assert.deepEqual(again.state.win, { player: 3, opponent: 2 });
    // Still spent in the rounds that follow.
    assert.equal(canRethrow(rules, again.state, 'player'), false);
  });

  test('both sides show it as an edge until it is used', () => {
    const rules = rulesFor('classic', 'second-wind');
    const state = startMatch(rules);
    assert.deepEqual(edgeOf(rules, state).map((e) => e.side), ['player', 'opponent']);
    const both = spendRethrow(rules, spendRethrow(rules, state, 'player'), 'opponent');
    assert.equal(edgeOf(rules, both), null);
  });
});

describe('Mercy (docs/decisions.md D30)', () => {
  test('only two hearts behind, and only once', () => {
    const rules = rulesFor('classic', 'mercy');
    const { state: oneBehind } = playRounds(rules, [[[2], [9]]]);
    assert.equal(canRethrow(rules, oneBehind, 'player'), false);
    const { state: twoBehind } = playRounds(rules, [[[2], [9]], [[2], [9]]]);
    assert.ok(canRethrow(rules, twoBehind, 'player'));
    assert.equal(canRethrow(rules, twoBehind, 'opponent'), false);
    assert.deepEqual(edgeOf(rules, twoBehind), [{ side: 'player', label: 'Mercy: a free re-throw' }]);
    const spent = spendRethrow(rules, twoBehind, 'player');
    assert.equal(canRethrow(rules, spent, 'player'), false);
    assert.equal(edgeOf(rules, spent), null);
  });
});

describe('Pothole', () => {
  test('a hole in each half, in the same place from where each side sits', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const set of ['classic', 'fireball', 'the-whole-bag']) {
        const rules = rulesFor(set, 'pothole', seed);
        const { holes } = tableOf(rules, startMatch(rules));
        const { halfWidth, depth } = DICE_SETS[set].tray;
        const k = halfWidth / TRAY_HALF_WIDTH;
        assert.equal(holes.length, 2);
        const [mine, theirs] = holes;
        assert.deepEqual(theirs, { ...mine, x: -mine.x, z: -mine.z });
        assert.equal(mine.r, POTHOLE_RADIUS * k);
        // Clear of the divider and the near wall; near the middle across, so
        // it's on screen on a phone held upright.
        assert.ok(mine.z - mine.r > DIVIDER_T && mine.z + mine.r < depth, `${set} ${seed}`);
        assert.ok(Math.abs(mine.x) <= 0.3 * halfWidth, `${set} ${seed}`);
      }
    }
  });

  test('where the hole is follows from the seed', () => {
    const where = (seed) => tableOf(rulesFor('classic', 'pothole', seed), startMatch(rulesFor('classic', 'pothole', seed))).holes;
    assert.deepEqual(where(5), where(5));
    assert.notDeepEqual(where(5), where(6));
  });

  test('a die that fell in counts as 0, written "hole"', () => {
    const rules = rulesFor('ability-score', 'pothole');
    const { outcome } = playRound(rules, startMatch(rules), { player: [6, 6, 2], opponent: [3, 3, 3] }, {
      fallen: { player: [true, false, false], opponent: [false, false, false] },
    });
    assert.deepEqual(outcome.scores, { player: 8, opponent: 9 });
    assert.deepEqual(outcome.dice.player[0], { text: 'hole', kept: true, tag: 'fallen' });
    assert.equal(outcome.note, 'Down the hole!');
  });
});

describe('Cat Paw', () => {
  test('swipes after about the chance it should, at one or two different dice', () => {
    const rules = rulesFor('ability-score', 'cat-paw');
    let swiped = 0;
    let state = startMatch(rules);
    const N = 2000;
    for (let i = 0; i < N; i++) {
      let swipes;
      ({ state, swipes } = afterSettle(rules, state, { player: 3, opponent: 3 }));
      if (!swipes.length) continue;
      swiped++;
      assert.ok(swipes.length <= 2);
      assert.equal(new Set(swipes.map((s) => `${s.side}-${s.index}`)).size, swipes.length);
      for (const { side, index, power, turn } of swipes) {
        assert.ok(['player', 'opponent'].includes(side) && index >= 0 && index < 3);
        assert.ok(power >= 0.5 && power <= 1 && turn >= -1 && turn <= 1);
      }
    }
    assert.ok(Math.abs(swiped / N - CAT_PAW_CHANCE) < 0.04, `${swiped} of ${N}`);
  });

  test('drawn from the rules stream: the same seed, the same swipes', () => {
    const swipes = (seed) => {
      const rules = rulesFor('classic', 'cat-paw', seed);
      let state = startMatch(rules);
      return Array.from({ length: 10 }, () => {
        let s;
        ({ state, swipes: s } = afterSettle(rules, state, { player: 1, opponent: 1 }));
        return s;
      });
    };
    assert.deepEqual(swipes(9), swipes(9));
    assert.notDeepEqual(swipes(9), swipes(10));
  });

  test('the card says when the cat struck', () => {
    const rules = rulesFor('classic', 'cat-paw');
    let state = startMatch(rules);
    let swipes = [];
    while (!swipes.length) ({ state, swipes } = afterSettle(rules, state, { player: 1, opponent: 1 }));
    const { outcome } = playRound(rules, state, { player: [4], opponent: [5] });
    assert.match(outcome.note, /The cat knocked (a die|two dice)!/);
  });
});

describe('Gusty Table', () => {
  test('a breeze each round: one of eight directions, as strong as allowed, announced', () => {
    const rules = rulesFor('classic', 'gusty-table');
    let state = startMatch(rules);
    const arrows = new Set();
    for (let i = 0; i < 300; i++) {
      let announce;
      ({ state, announce } = beginRound(rules, state));
      const { wind } = tableOf(rules, state);
      const strength = Math.sqrt(wind[0] ** 2 + wind[1] ** 2);
      assert.ok(strength >= WIND_MIN - 1e-9 && strength <= WIND_MAX + 1e-9, String(strength));
      assert.match(announce, /^(A breeze|Strong wind) blowing [→↗↑↖←↙↓↘]$/);
      arrows.add(announce.at(-1));
    }
    assert.equal(arrows.size, 8);
  });
});

describe("No Man's Land", () => {
  test('takes the divider away', () => {
    const rules = rulesFor('fireball', 'no-mans-land');
    assert.equal(tableOf(rules, startMatch(rules)).divider, false);
  });
});

describe('Doubles Again', () => {
  test('doubles throw again, up to three throws a round', () => {
    const rules = rulesFor('greatsword', 'doubles-again');
    const state = startMatch(rules);
    assert.equal(throwsAgain(rules, state, 'player', [[3, 3]]), true);
    assert.equal(throwsAgain(rules, state, 'player', [[3, 4]]), false);
    assert.equal(throwsAgain(rules, state, 'player', [[3, 3], [5, 5]]), true);
    assert.equal(throwsAgain(rules, state, 'player', [[3, 3], [5, 5], [6, 6]]), false);
    // With three dice, any two the same.
    const three = rulesFor('ability-score', 'doubles-again');
    assert.equal(throwsAgain(three, startMatch(three), 'opponent', [[1, 4, 1]]), true);
    assert.equal(throwsAgain(three, startMatch(three), 'opponent', [[1, 4, 2]]), false);
  });

  test('each extra throw is added to the total, and named on the card', () => {
    const rules = rulesFor('greatsword', 'doubles-again');
    const { outcome } = playRound(rules, startMatch(rules), { player: [2, 2], opponent: [6, 5] }, {
      again: { player: [[4, 4], [1, 3]], opponent: [] },
    });
    assert.deepEqual(outcome.adjustments.player, [{ label: 'again', value: 8 }, { label: 'again', value: 4 }]);
    assert.deepEqual(outcome.scores, { player: 16, opponent: 11 });
    assert.equal(outcome.winner, 'player');
    assert.equal(outcome.note, 'Doubles! Thrown again.');
  });
});

describe('every Phase 5 Spice plays out with what the table does', () => {
  test('re-throws, extra throws, swipes and fallen dice all reach the same end twice', () => {
    for (const spice of ['second-wind', 'mercy', 'pothole', 'cat-paw', 'doubles-again', 'gusty-table']) {
      for (const set of offered(spice)) {
        const play = () => {
          const rules = rulesFor(set, spice, 3);
          let state = startMatch(rules);
          let rolls = 7;
          const next = () => { rolls = (rolls * 48271) % 2147483647; return rolls; };
          const faces = (side) => handOf(rules, state, side).types.map((t) => dieFaces(t)[next() % dieFaces(t).length]);
          const outcomes = [];
          for (let r = 0; r < 300 && !state.winner; r++) {
            let swipes;
            ({ state } = beginRound(rules, state));
            const n = { player: handOf(rules, state, 'player').types.length, opponent: handOf(rules, state, 'opponent').types.length };
            ({ state, swipes } = afterSettle(rules, state, n));
            const round = {
              faces: { player: faces('player'), opponent: faces('opponent') },
              fallen: { player: n.player ? Array.from({ length: n.player }, () => next() % 9 === 0) : [], opponent: Array.from({ length: n.opponent }, () => next() % 9 === 0) },
              again: { player: [], opponent: [] },
            };
            for (const side of ['player', 'opponent']) {
              while (throwsAgain(rules, state, side, [round.faces[side], ...round.again[side]])) round.again[side].push(faces(side));
            }
            let { outcome, state: after } = playRound(rules, state, round.faces, round);
            const loser = outcome.winner === 'player' ? 'opponent' : outcome.winner ? 'player' : null;
            if (loser && canRethrow(rules, state, loser)) {
              const spent = spendRethrow(rules, state, loser);
              round.faces[loser] = faces(loser);
              ({ outcome, state: after } = playRound(rules, spent, round.faces, round));
            }
            outcomes.push({ outcome, swipes });
            state = after;
          }
          return { outcomes, state };
        };
        const first = play();
        assert.ok(first.state.winner, `${spice} with ${set} never ended`);
        assert.deepEqual(play(), first, `${spice} with ${set}`);
      }
    }
  });
});
