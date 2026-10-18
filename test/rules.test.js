import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchConfig, resolveRules, startMatch, beginRound, playRound, higherWins } from '../src/rules/engine.js';
import { THE_CLASSIC, DICE_SETS, sum, keepHighest, dropLowest, percentile, dieTypes } from '../src/rules/dice-sets.js';
import { VANILLA, SPICE } from '../src/rules/spice.js';
import { HEARTS, hearts } from '../src/rules/win-conditions.js';

const classic = () => resolveRules(matchConfig({ seed: 1 }));
const roll = (player, opponent) => ({ player: [player], opponent: [opponent] });

/** Plays rounds until the match ends; returns the last outcome and state. */
function playOut(rules, rolls) {
  let state = startMatch(rules);
  let outcome;
  for (const [p, o] of rolls) {
    ({ state } = beginRound(rules, state));
    ({ outcome, state } = playRound(rules, state, roll(p, o)));
    if (outcome.matchWinner) break;
  }
  return { outcome, state };
}

describe('match config', () => {
  test('defaults to The Classic with Vanilla', () => {
    assert.deepEqual(matchConfig({ seed: 7 }), { seed: 7, diceSet: 'classic', spice: 'vanilla' });
  });

  test('rejects an unknown dice set, Spice or a bad seed', () => {
    assert.throws(() => matchConfig({ seed: 1, diceSet: 'nope' }), /dice set/);
    assert.throws(() => matchConfig({ seed: 1, spice: 'nope' }), /Spice/);
    assert.throws(() => matchConfig({ seed: -1 }), /uint32/);
    assert.throws(() => matchConfig({ seed: 1.5 }), /uint32/);
  });

  test('is plain data that survives JSON, for sending to another player', () => {
    const config = matchConfig({ seed: 99 });
    assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  });

  test('resolves to Hearts when the Spice brings no win condition', () => {
    const rules = classic();
    assert.equal(rules.diceSet, THE_CLASSIC);
    assert.equal(rules.spice, VANILLA);
    assert.equal(rules.winCondition, HEARTS);
  });
});

describe('dice sets', () => {
  test('The Classic is one d20, summed', () => {
    assert.deepEqual(dieTypes(THE_CLASSIC), ['d20']);
    assert.equal(THE_CLASSIC.scorer([17]), 17);
    assert.equal(DICE_SETS.classic, THE_CLASSIC);
  });

  test('sum adds every face, and keeps them all', () => {
    assert.equal(sum([6, 4, 1, 5]), 16);
    assert.equal(sum([]), 0);
    assert.deepEqual(sum.kept([6, 4, 1]), [true, true, true]);
  });

  test('keepHighest counts only the highest n', () => {
    const kh1 = keepHighest(1);
    assert.equal(kh1([4, 17]), 17);
    assert.deepEqual(kh1.kept([4, 17]), [false, true]);
    assert.equal(keepHighest(2)([3, 6, 1, 5]), 11);
    assert.deepEqual(keepHighest(2).kept([3, 6, 1, 5]), [false, true, false, true]);
    // More than there are: every die counts.
    assert.equal(keepHighest(3)([2, 9]), 11);
  });

  test('dropLowest counts all but the lowest n', () => {
    const dl1 = dropLowest(1);
    assert.equal(dl1([5, 6, 1, 4]), 15);
    assert.deepEqual(dl1.kept([5, 6, 1, 4]), [true, true, false, true]);
    assert.equal(dropLowest(2)([5, 6, 1, 4]), 11);
    assert.equal(dropLowest(5)([5, 6]), 0);
  });

  test('of equal dice, the same one is always dropped: the later', () => {
    assert.deepEqual(dropLowest(1).kept([3, 3, 3, 3]), [true, true, true, false]);
    assert.deepEqual(keepHighest(1).kept([20, 20]), [true, false]);
    assert.deepEqual(dropLowest(1).kept([2, 6, 2]), [true, true, false]);
  });

  test('notation follows the dice and the scorer', () => {
    const notation = Object.fromEntries(Object.values(DICE_SETS).map((set) => [set.id, set.notation]));
    assert.deepEqual(notation, {
      classic: '1d20',
      advantage: '2d20kh1',
      greatsword: '2d6',
      greataxe: '1d12',
      'ability-score': '3d6',
      'heroic-stats': '4d6dl1',
      'magic-missile': '3d4',
      'swarm-of-daggers': '4d4',
      'guiding-bolt': '4d6',
      'divine-smite': '3d8',
      fireball: '8d6',
      percentile: 'd% + d10',
      'sneak-attack': '1d20 + 3d6',
      'the-whole-bag': '1d4 + 1d6 + 1d8 + 1d10 + 1d12 + 1d20',
      'dice-poker': '5d6',
    });
  });

  test('percentile reads tens and units, 00 and 0 making 100', () => {
    // The percentile die's faces are worth 10-100, the d10's 1-10 ("00" and "0").
    assert.equal(percentile([40, 7]), 47);
    assert.equal(percentile([100, 7]), 7);
    assert.equal(percentile([40, 10]), 40);
    assert.equal(percentile([100, 10]), 100);
    assert.equal(percentile([90, 9]), 99);
    assert.deepEqual(percentile.labels([100, 10]), ['00', '0']);
    assert.deepEqual(percentile.labels([30, 4]), ['30', '4']);
    // Every result from 1 to 100, once each.
    const all = [];
    for (let t = 10; t <= 100; t += 10) for (let u = 1; u <= 10; u++) all.push(percentile([t, u]));
    assert.deepEqual(all.sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 1));
  });

  test('a die thrown alone counts its 0 as its full value', () => {
    assert.equal(DICE_SETS['the-whole-bag'].scorer([4, 6, 8, 10, 12, 20]), 60);
  });

  test("every set has 1 to 8 dice a side (D6), of known types, and a tray at least The Classic's", async () => {
    const { SHAPES } = await import('../src/die-shapes.js');
    for (const set of Object.values(DICE_SETS)) {
      const types = dieTypes(set);
      assert.ok(types.length >= 1 && types.length <= 8, set.id);
      assert.ok(types.every((t) => SHAPES[t]), set.id);
      assert.ok(set.tray.halfWidth >= THE_CLASSIC.tray.halfWidth && set.tray.depth >= THE_CLASSIC.tray.depth, set.id);
      assert.equal(DICE_SETS[set.id], set);
    }
  });

  test("a round's outcome says which dice counted", () => {
    const rules = resolveRules(matchConfig({ seed: 1, diceSet: 'heroic-stats' }));
    const { outcome } = playRound(rules, startMatch(rules), { player: [5, 6, 1, 4], opponent: [2, 2, 2, 2] });
    assert.deepEqual(outcome.scores, { player: 15, opponent: 6 });
    assert.deepEqual(outcome.kept, { player: [true, true, false, true], opponent: [true, true, true, false] });
    assert.equal(outcome.winner, 'player');
  });

  test('advantage: the higher of two d20s', () => {
    const rules = resolveRules(matchConfig({ seed: 1, diceSet: 'advantage' }));
    const { outcome } = playRound(rules, startMatch(rules), { player: [3, 18], opponent: [17, 17] });
    assert.deepEqual(outcome.scores, { player: 18, opponent: 17 });
  });
});

describe('Hearts (3)', () => {
  test('both sides start on 3', () => {
    assert.deepEqual(startMatch(classic()).win, { player: 3, opponent: 3 });
  });

  test('the round loser loses one heart, the winner none', () => {
    const rules = classic();
    const { outcome, state } = playRound(rules, startMatch(rules), roll(15, 4));
    assert.equal(outcome.winner, 'player');
    assert.deepEqual(outcome.damage, { player: 0, opponent: 1 });
    assert.deepEqual(state.win, { player: 3, opponent: 2 });
    assert.equal(outcome.matchWinner, null);
  });

  test('a tie costs nobody a heart', () => {
    const rules = classic();
    const { outcome, state } = playRound(rules, startMatch(rules), roll(11, 11));
    assert.equal(outcome.winner, null);
    assert.deepEqual(state.win, { player: 3, opponent: 3 });
  });

  test('losing three rounds loses the match, ties in between or not', () => {
    const { outcome, state } = playOut(classic(), [[2, 9], [5, 5], [20, 1], [3, 4], [1, 20], [18, 2]]);
    assert.equal(outcome.matchWinner, 'opponent');
    assert.equal(state.winner, 'opponent');
    assert.deepEqual(state.win, { player: 0, opponent: 2 });
    assert.equal(state.round, 5);
  });

  test('no round can be played once the match is over', () => {
    const rules = classic();
    const { state } = playOut(rules, [[20, 1], [20, 1], [20, 1]]);
    assert.equal(state.winner, 'player');
    assert.throws(() => playRound(rules, state, roll(1, 20)), /over/);
  });

  test('hearts never go below zero', () => {
    const wc = hearts(1);
    assert.deepEqual(wc.apply({ player: 1, opponent: 1 }, null, { player: 3, opponent: 0 }), { player: 0, opponent: 1 });
  });

  test('both running out together is a draw', () => {
    assert.equal(HEARTS.matchWinner({ player: 0, opponent: 0 }), 'draw');
  });

  test('its view is a row of hearts per side', () => {
    assert.deepEqual(HEARTS.view({ player: 1, opponent: 3 }), {
      kind: 'hearts',
      sides: { player: { left: 1, max: 3 }, opponent: { left: 3, max: 3 } },
    });
  });
});

describe('Vanilla', () => {
  test('changes nothing: higher wins, by the plain total', () => {
    const rules = classic();
    for (const [p, o, winner] of [[20, 19, 'player'], [1, 2, 'opponent'], [7, 7, null]]) {
      const { outcome } = playRound(rules, startMatch(rules), roll(p, o));
      assert.equal(outcome.winner, winner);
      assert.deepEqual(outcome.scores, { player: p, opponent: o });
    }
  });

  test('is eligible for every dice set and declares no hooks', () => {
    assert.deepEqual(VANILLA.eligibility, {});
    assert.equal(SPICE.vanilla, VANILLA);
    const hooks = ['winCondition', 'setup', 'beforeThrow', 'afterSettle', 'hand', 'edge', 'values', 'adjust', 'compare', 'applyDamage', 'explain'];
    assert.deepEqual(hooks.filter((h) => h in VANILLA), []);
  });
});

describe('rules engine', () => {
  test('higherWins', () => {
    assert.equal(higherWins({ player: 3, opponent: 2 }), 'player');
    assert.equal(higherWins({ player: 2, opponent: 3 }), 'opponent');
    assert.equal(higherWins({ player: 2, opponent: 2 }), null);
  });

  test('is pure: the state it is given is left untouched', () => {
    const rules = classic();
    const state = startMatch(rules);
    const before = structuredClone(state);
    playRound(rules, state, roll(20, 1));
    beginRound(rules, state);
    assert.deepEqual(state, before);
  });

  test('the same config and the same rolls reach the same state', () => {
    const rolls = [[4, 9], [12, 3], [8, 8], [17, 16], [2, 19], [11, 10]];
    assert.deepEqual(playOut(classic(), rolls), playOut(classic(), rolls));
  });

  test('the rules stream is derived from the seed', () => {
    const a = startMatch(resolveRules(matchConfig({ seed: 1 })));
    const b = startMatch(resolveRules(matchConfig({ seed: 2 })));
    assert.notEqual(a.rng, b.rng);
  });

  // A stand-in Spice using every rules-side hook, to check each is called at
  // its point in the round and that what it returns is used.
  const LOWBALL_DOUBLE = {
    id: 'test',
    name: 'Test',
    summary: '',
    eligibility: {},
    setup: ({ rng }) => ({ cursed: 1 + rng.int(20) }),
    beforeThrow: ({ state, rng }) => ({ spice: { ...state.spice, cursed: 1 + rng.int(20) }, announce: 'cursed' }),
    values: (faces, { state }) => faces.map((f) => ({ value: f === state.spice.cursed ? 0 : f })),
    compare: ({ scores }) => higherWins({ player: scores.opponent, opponent: scores.player }),
    applyDamage: (_round, damage) => ({ player: damage.player * 2, opponent: damage.opponent * 2 }),
  };
  const testRules = () => ({ ...classic(), spice: LOWBALL_DOUBLE });

  test('Spice hooks: setup, beforeThrow, values, compare and applyDamage all take effect', () => {
    const rules = testRules();
    let state = startMatch(rules);
    assert.ok(state.spice.cursed >= 1 && state.spice.cursed <= 20);
    const rngAfterSetup = state.rng;
    assert.notEqual(rngAfterSetup, startMatch(classic()).rng);

    let announce;
    ({ state, announce } = beginRound(rules, state));
    assert.equal(announce, 'cursed');
    assert.notEqual(state.rng, rngAfterSetup);
    const { cursed } = state.spice;

    // Lowest wins, and the loser (the higher roll) loses two hearts.
    const other = cursed === 20 ? 19 : 20;
    const low = cursed === 2 ? 3 : 2;
    let outcome;
    ({ outcome, state } = playRound(rules, state, roll(low, other)));
    assert.equal(outcome.winner, 'player');
    assert.deepEqual(outcome.damage, { player: 0, opponent: 2 });
    assert.deepEqual(state.win, { player: 3, opponent: 1 });

    // A cursed number scores 0, which under this Spice wins.
    ({ state } = beginRound(rules, state));
    const c = state.spice.cursed;
    ({ outcome } = playRound(rules, state, roll(c === 20 ? 19 : 20, c)));
    assert.equal(outcome.scores.opponent, 0);
    assert.equal(outcome.winner, 'opponent');
  });

  test('a Spice win condition replaces Hearts', () => {
    const rules = resolveRules(matchConfig({ seed: 1 }));
    const sudden = hearts(1);
    const withOwn = { ...rules, winCondition: sudden };
    const { outcome } = playRound(withOwn, startMatch(withOwn), roll(1, 2));
    assert.equal(outcome.matchWinner, 'opponent');
  });
});
