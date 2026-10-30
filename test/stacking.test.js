import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SPICE } from '../src/rules/spice.js';
import { DICE_SETS } from '../src/rules/dice-sets.js';
import { SLOTS, CLASHES, clashOf, canStack, largestStack } from '../src/rules/stacking.js';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, tableOf, canRethrow,
} from '../src/rules/engine.js';
import { ROPE_RADIUS } from '../src/config.js';

const ids = Object.keys(SPICE);

describe('stacking Spice (D51)', () => {
  test('every Spice the slots and clashes name exists', () => {
    const named = [
      ...Object.values(SLOTS).flatMap((s) => s.spice),
      ...CLASHES.flatMap((c) => [...c.a, ...c.b]),
    ];
    for (const id of named) assert.ok(SPICE[id], `unknown Spice "${id}"`);
  });

  test('no clash restates a slot', () => {
    for (const { a, b } of CLASHES) {
      for (const x of a) {
        for (const y of b) {
          const shared = Object.keys(SLOTS).filter((s) => SLOTS[s].spice.includes(x) && SLOTS[s].spice.includes(y));
          assert.deepEqual(shared, [], `${x} and ${y} already share a slot`);
        }
      }
    }
  });

  test('a clash goes both ways', () => {
    for (const a of ids) for (const b of ids) assert.equal(Boolean(clashOf(a, b)), Boolean(clashOf(b, a)), `${a} / ${b}`);
  });

  test('two Spice in one slot clash, and Vanilla stacks with nothing', () => {
    assert.equal(clashOf('hit-points', 'race-to-n')?.slot, 'win');
    assert.equal(clashOf('second-wind', 'mercy')?.slot, 'rethrow');
    for (const id of ids) assert.ok(clashOf('vanilla', id));
  });

  test('the table Spice stack with each other and with a win condition', () => {
    assert.ok(canStack(['hit-points', 'pothole', 'cat-paw', 'gusty-table', 'no-mans-land'], 'classic'));
    assert.ok(canStack(['tug-of-war', 'exploding-dice', 'cat-paw', 'gusty-table'], 'the-whole-bag'));
  });

  test('a clash measured only with eight dice a side holds only there', () => {
    assert.equal(canStack(['tug-of-war', 'gusty-table'], 'fireball'), false);
    assert.ok(canStack(['tug-of-war', 'gusty-table'], 'the-whole-bag'));
    assert.equal(clashOf('no-mans-land', 'gusty-table', 'classic'), null);
    assert.equal(clashOf('no-mans-land', 'gusty-table')?.minDice, 8);
  });

  test('each Spice must still be eligible for the dice set', () => {
    assert.equal(canStack(['critical-hit', 'cat-paw'], 'fireball'), false);
    assert.ok(canStack(['critical-hit', 'cat-paw'], 'classic'));
  });

  test('every dice set\'s largest stack can be played', () => {
    for (const diceSet of Object.keys(DICE_SETS)) {
      const stack = largestStack(diceSet);
      assert.ok(stack.length >= 2, `${diceSet}: ${stack}`);
      assert.ok(canStack(stack, diceSet), `${diceSet}: ${stack}`);
    }
  });
});

const stack = (diceSet, spices, seed = 1) => resolveRules(matchConfig({ seed, diceSet, spices }));

describe('a Spice stack played (D51)', () => {
  test('one Spice is that Spice, untouched; a stack keeps catalogue order', () => {
    assert.equal(stack('classic', ['revenge']).spice, SPICE.revenge);
    assert.deepEqual(matchConfig({ seed: 1, spices: ['revenge', 'marathon'] }).spices, ['marathon', 'revenge']);
    assert.deepEqual(matchConfig({ seed: 1, spices: [] }).spices, ['vanilla']);
  });

  test('a stack that clashes is refused', () => {
    assert.throws(() => matchConfig({ seed: 1, spices: ['hit-points', 'race-to-n'] }), /don't stack/);
    assert.throws(() => matchConfig({ seed: 1, diceSet: 'fireball', spices: ['critical-hit', 'cat-paw'] }), /don't stack/);
  });

  test('each Spice keeps its own state, and both announce', () => {
    const rules = stack('classic', ['cursed-number', 'gusty-table']);
    const { state, announce } = beginRound(rules, startMatch(rules));
    assert.ok(state.spice['cursed-number'].cursed >= 1);
    assert.equal(state.spice['gusty-table'].wind.length, 2);
    assert.match(announce, /^Cursed number: \d+\n.*blowing/);
    assert.ok(tableOf(rules, state).wind);
  });

  test('a win condition from one Spice, the damage from another: Revenge and Critical Hit make four', () => {
    const rules = stack('classic', ['marathon', 'revenge', 'critical-hit']);
    let state = startMatch(rules);
    ({ state } = beginRound(rules, state));
    ({ state } = playRound(rules, state, { player: [3], opponent: [12] }));
    ({ state } = beginRound(rules, state));
    const { outcome } = playRound(rules, state, { player: [20], opponent: [12] });
    assert.equal(outcome.damage.opponent, 4);
    assert.match(outcome.note, /Revenge/);
    assert.match(outcome.note, /Critical hit/);
  });

  test('a cursed maximum counts 0 and doesn\'t explode; a die down a hole counts 0 whatever it shows', () => {
    const rules = stack('greatsword', ['exploding-dice', 'cursed-number', 'pothole']);
    let state = startMatch(rules);
    ({ state } = beginRound(rules, state));
    state = { ...state, spice: { ...state.spice, 'cursed-number': { cursed: 6 } } };
    const { outcome } = playRound(rules, state, { player: [6, 2], opponent: [3, 6] },
      { fallen: { player: [false, false], opponent: [false, false] } });
    assert.deepEqual(outcome.values.player, [0, 2]);
    const down = playRound(rules, state, { player: [5, 2], opponent: [3, 4] },
      { fallen: { player: [true, false], opponent: [false, false] } }).outcome;
    assert.deepEqual(down.values.player, [0, 2]);
    assert.equal(down.dice.player[0].tag, 'fallen');
  });

  test('Mercy reads hearts through the win condition: it works with Death Saves', () => {
    const rules = stack('classic', ['death-saves', 'mercy']);
    let state = startMatch(rules);
    state = { ...state, win: { ...state.win, hearts: { player: 1, opponent: 3 } } };
    assert.equal(canRethrow(rules, state, 'player'), true);
    assert.equal(canRethrow(rules, state, 'opponent'), false);
  });

  test('Raising the Stakes counts in the win condition\'s units', () => {
    const rules = stack('classic', ['hit-points', 'raising-the-stakes']);
    let state = startMatch(rules);
    ({ state } = beginRound(rules, state));
    ({ state } = playRound(rules, state, { player: [7], opponent: [7] }));
    const { announce } = beginRound(rules, state);
    assert.equal(announce, 'This round costs 2 times as much');
  });

  test('with Tug of War\'s rope down, the holes keep clear of it', () => {
    for (let seed = 1; seed < 60; seed++) {
      const rules = stack('classic', ['tug-of-war', 'pothole'], seed);
      const { holes, rope } = tableOf(rules, startMatch(rules));
      assert.ok(rope);
      for (const h of holes) assert.ok(Math.abs(h.x) >= h.r + ROPE_RADIUS, `seed ${seed}: hole at x ${h.x}`);
    }
  });
});

describe('Exploding Dice both ways (D58)', () => {
  test('a 1 explodes downwards: each roll taken off, chaining on the highest number', () => {
    const seen = new Set();
    for (let seed = 1; seed < 400; seed++) {
      const r = stack('greatsword', ['exploding-dice'], seed);
      let state = startMatch(r);
      ({ state } = beginRound(r, state));
      const { outcome } = playRound(r, state, { player: [1, 3], opponent: [6, 2] });
      const [down] = outcome.dice.player;
      assert.equal(down.tag, 'imploded');
      assert.equal(outcome.values.player[0], 1 - down.extra.reduce((a, b) => a + b, 0));
      assert.ok(down.extra.slice(0, -1).every((roll) => roll === 6), 'chains only on a 6');
      assert.equal(outcome.dice.opponent[0].tag, 'exploded');
      seen.add(down.extra.length);
    }
    assert.ok(seen.has(2), 'a chain downwards turns up');
  });

  test('so it stacks with Lowball now; Brutal Critical, upwards only, still does not', () => {
    assert.equal(clashOf('lowball', 'exploding-dice'), null);
    assert.ok(clashOf('lowball', 'brutal-critical'));
  });
});
