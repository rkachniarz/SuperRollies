import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, handOf, edgeOf, isEligible, scoreDice,
} from '../src/rules/engine.js';
import { DICE_SETS, DIE_MAX, extraDieType, sum, percentile } from '../src/rules/dice-sets.js';
import { SPICE, SPICE_KINDS } from '../src/rules/spice.js';
import { dealDice, dealSpice, eligibleSpice, OFFERS } from '../src/rules/draft.js';

const rulesFor = (diceSet, spice, seed = 1) => resolveRules(matchConfig({ seed, diceSet, spice }));

/**
 * Plays one round the way the game does: beginRound, then playRound. Returns
 * the outcome, the state after it, and what beginRound announced.
 */
function round(rules, state, player, opponent) {
  let announce;
  ({ state, announce } = beginRound(rules, state));
  const { outcome, state: next } = playRound(rules, state, { player, opponent });
  return { outcome, state: next, announce, before: state };
}

/** Plays rounds from a fresh match; each entry is [playerFaces, opponentFaces]. */
function playRounds(rules, rolls) {
  let state = startMatch(rules);
  const outcomes = [];
  for (const [p, o] of rolls) {
    let outcome;
    ({ outcome, state } = round(rules, state, p, o));
    outcomes.push(outcome);
    if (outcome.matchWinner) break;
  }
  return { outcomes, state, last: outcomes.at(-1) };
}

describe('the Spice catalogue', () => {
  test('every Spice has a card: name, icon, kind, summary and full rules', () => {
    for (const spice of Object.values(SPICE)) {
      assert.ok(spice.name && spice.icon && spice.summary && spice.rules, spice.id);
      assert.ok(SPICE_KINDS[spice.kind], spice.id);
      assert.equal(SPICE[spice.id], spice);
    }
  });

  test('Phase 4 brings these Spice', () => {
    assert.deepEqual(Object.keys(SPICE), [
      'vanilla', 'sudden-death', 'marathon', 'mutual-destruction', 'lowball', 'exploding-dice',
      'raising-the-stakes', 'cursed-number', 'underdog', 'revenge',
      'critical-hit', 'critical-fumble', 'inspiration', 'brutal-critical', 'snake-eyes', 'triples', 'caltrops',
    ]);
  });

  test('every dice set has at least two Spice to offer', () => {
    for (const id of Object.keys(DICE_SETS)) assert.ok(eligibleSpice(id).length >= OFFERS, id);
  });

  test('eligibility (R3.2): set-specific Spice only with their sets', () => {
    const offered = (spice) => Object.keys(DICE_SETS).filter((id) => isEligible(SPICE[spice], DICE_SETS[id]));
    assert.deepEqual(offered('critical-hit'), ['classic', 'advantage']);
    assert.deepEqual(offered('inspiration'), ['classic', 'advantage']);
    assert.deepEqual(offered('brutal-critical'), ['greataxe']);
    assert.deepEqual(offered('snake-eyes'), ['greatsword']);
    assert.deepEqual(offered('triples'), ['ability-score', 'heroic-stats', 'guiding-bolt']);
    assert.deepEqual(offered('caltrops'), ['magic-missile', 'swarm-of-daggers']);
    // At the 8-dice cap there is no room for an extra die; percentile is two digits.
    assert.ok(!offered('underdog').includes('fireball'));
    for (const spice of ['underdog', 'exploding-dice', 'cursed-number']) {
      assert.ok(!offered(spice).includes('percentile'), spice);
    }
    assert.equal(offered('vanilla').length, Object.keys(DICE_SETS).length);
  });

  test('isEligible reads every eligibility field', () => {
    const fireball = DICE_SETS.fireball;
    const spice = (eligibility) => ({ ...SPICE.vanilla, eligibility });
    assert.equal(isEligible(spice({ minDice: 9 }), fireball), false);
    assert.equal(isEligible(spice({ minDice: 8, maxDice: 8 }), fireball), true);
    assert.equal(isEligible(spice({ dieTypes: ['d20'] }), fireball), false);
    assert.equal(isEligible(spice({ dieTypes: ['d6'] }), fireball), true);
    assert.equal(isEligible(spice({ excludeDiceSets: ['fireball'] }), fireball), false);
  });
});

describe('the draft (R1.2, R1.6)', () => {
  test('two different dice sets, the same for the same seed', () => {
    for (let seed = 0; seed < 50; seed++) {
      const offer = dealDice(seed);
      assert.equal(offer.length, OFFERS);
      assert.notEqual(offer[0], offer[1]);
      assert.ok(offer.every((id) => DICE_SETS[id]));
      assert.deepEqual(dealDice(seed), offer);
    }
  });

  test('two different eligible Spice, the same for the same seed and set', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const set of Object.keys(DICE_SETS)) {
        const offer = dealSpice(seed, set);
        assert.equal(offer.length, OFFERS);
        assert.notEqual(offer[0], offer[1]);
        assert.ok(offer.every((id) => isEligible(SPICE[id], DICE_SETS[set])), `${seed} ${set}`);
        assert.deepEqual(dealSpice(seed, set), offer);
      }
    }
  });

  test('every dice set and every Spice turns up, given enough seeds', () => {
    const sets = new Set();
    const spice = new Set();
    for (let seed = 0; seed < 2000; seed++) {
      const offer = dealDice(seed);
      offer.forEach((id) => sets.add(id));
      dealSpice(seed, offer[0]).forEach((id) => spice.add(id));
    }
    assert.equal(sets.size, Object.keys(DICE_SETS).length);
    assert.equal(spice.size, Object.keys(SPICE).length);
  });
});

describe('the engine, Phase 4', () => {
  test('a round needs as many faces as the hand has dice', () => {
    const rules = rulesFor('greatsword', 'vanilla');
    assert.throws(() => playRound(rules, startMatch(rules), { player: [3], opponent: [4, 5] }), /expected 2/);
  });

  test('remembers how the last round went', () => {
    const rules = rulesFor('classic', 'vanilla');
    const { state } = playRounds(rules, [[[3], [9]]]);
    assert.deepEqual(state.previous, { winner: 'opponent' });
    assert.equal(startMatch(rules).previous, null);
  });

  test('the breakdown names every die, with a scorer\'s labels', () => {
    const rules = rulesFor('percentile', 'vanilla');
    const { outcome } = playRound(rules, startMatch(rules), { player: [100, 10], opponent: [40, 7] });
    assert.deepEqual(outcome.dice.player.map((d) => d.text), ['00', '0']);
    assert.deepEqual(outcome.scores, { player: 100, opponent: 47 });
    assert.deepEqual(outcome.adjustments, { player: [], opponent: [] });
    assert.deepEqual(scoreDice(sum, [2, 5]).dice, [{ text: '2', kept: true }, { text: '5', kept: true }]);
    assert.equal(scoreDice(percentile, [30, 4]).score, 34);
  });

  test('without a hand hook, each side throws the dice set', () => {
    const rules = rulesFor('sneak-attack', 'vanilla');
    assert.deepEqual(handOf(rules, startMatch(rules), 'player').types, ['d20', 'd6', 'd6', 'd6']);
    assert.equal(edgeOf(rules, startMatch(rules)), null);
  });

  test('every Spice keeps the engine pure: the state it is given is left untouched', () => {
    for (const spice of Object.keys(SPICE)) {
      const set = Object.keys(DICE_SETS).find((id) => isEligible(SPICE[spice], DICE_SETS[id]));
      const rules = rulesFor(set, spice);
      let state = startMatch(rules);
      ({ state } = beginRound(rules, state));
      const before = structuredClone(state);
      const faces = (side) => handOf(rules, state, side).types.map((t) => DIE_MAX[t]);
      playRound(rules, state, { player: faces('player'), opponent: faces('opponent') });
      beginRound(rules, state);
      assert.deepEqual(state, before, spice);
    }
  });

  test('every Spice plays a whole match to the end, the same way twice', () => {
    for (const spice of Object.keys(SPICE)) {
      for (const set of Object.keys(DICE_SETS).filter((id) => isEligible(SPICE[spice], DICE_SETS[id]))) {
        const play = () => {
          const rules = rulesFor(set, spice, 77);
          let state = startMatch(rules);
          let rolls = 1;
          const outcomes = [];
          // Faces from a fixed sequence, so a match always ends.
          for (let r = 0; r < 200 && !state.winner; r++) {
            ({ state } = beginRound(rules, state));
            const faces = (side) => handOf(rules, state, side).types.map((t) => {
              rolls = (rolls * 48271) % 2147483647;
              const n = 1 + (rolls % DIE_MAX[t]);
              return t === 'd%' ? Math.ceil(n / 10) * 10 : n;
            });
            let outcome;
            ({ outcome, state } = playRound(rules, state, { player: faces('player'), opponent: faces('opponent') }));
            outcomes.push(outcome);
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

describe('Sudden Death and Marathon', () => {
  test('Sudden Death: one heart each, the first lost round ends it', () => {
    const rules = rulesFor('classic', 'sudden-death');
    assert.deepEqual(startMatch(rules).win, { player: 1, opponent: 1 });
    const { outcomes, last } = playRounds(rules, [[[5], [5]], [[5], [6]]]);
    assert.equal(outcomes.length, 2);
    assert.equal(last.matchWinner, 'opponent');
  });

  test('Marathon: six hearts each, so six lost rounds', () => {
    const rules = rulesFor('classic', 'marathon');
    assert.deepEqual(startMatch(rules).win, { player: 6, opponent: 6 });
    const { outcomes, last } = playRounds(rules, Array(10).fill([[20], [1]]).map(([p, o]) => [p, o]));
    assert.equal(outcomes.length, 6);
    assert.equal(last.matchWinner, 'player');
    assert.deepEqual(rules.winCondition.view({ player: 6, opponent: 2 }).sides.opponent, { left: 2, max: 6 });
  });
});

describe('Mutual Destruction', () => {
  test('a tie costs both a heart; a decided round as usual', () => {
    const rules = rulesFor('classic', 'mutual-destruction');
    const { outcomes, state } = playRounds(rules, [[[7], [7]], [[9], [3]]]);
    assert.deepEqual(outcomes[0].damage, { player: 1, opponent: 1 });
    assert.equal(outcomes[0].note, 'Mutual destruction: a heart each.');
    assert.deepEqual(outcomes[1].damage, { player: 0, opponent: 1 });
    assert.deepEqual(state.win, { player: 2, opponent: 1 });
  });

  test('both running out together is a draw', () => {
    const rules = rulesFor('classic', 'mutual-destruction');
    const { last } = playRounds(rules, [[[4], [4]], [[4], [4]], [[4], [4]]]);
    assert.equal(last.matchWinner, 'draw');
  });
});

describe('Lowball', () => {
  test('the lower total wins; equal still ties', () => {
    const rules = rulesFor('greatsword', 'lowball');
    assert.equal(playRounds(rules, [[[1, 2], [6, 6]]]).last.winner, 'player');
    assert.equal(playRounds(rules, [[[5, 6], [2, 2]]]).last.winner, 'opponent');
    assert.equal(playRounds(rules, [[[3, 4], [5, 2]]]).last.winner, null);
  });

  test('Advantage still keeps the higher d20, which now hurts', () => {
    const rules = rulesFor('advantage', 'lowball');
    const { last } = playRounds(rules, [[[2, 19], [10, 11]]]);
    assert.deepEqual(last.scores, { player: 19, opponent: 11 });
    assert.equal(last.winner, 'opponent');
  });
});

describe('Exploding Dice', () => {
  test('a die on its maximum rolls again and adds it; others are left alone', () => {
    const rules = rulesFor('greatsword', 'exploding-dice');
    const { last } = playRounds(rules, [[[6, 3], [2, 5]]]);
    const [exploded, plain] = last.dice.player;
    assert.equal(exploded.tag, 'exploded');
    assert.match(exploded.text, /^\(6(\+\d+)+\)$/);
    const rolls = exploded.text.slice(1, -1).split('+').map(Number);
    assert.equal(rolls[0], 6);
    assert.ok(rolls.length >= 2);
    // Every roll but the last was a 6; the last wasn't.
    assert.ok(rolls.slice(0, -1).every((r) => r === 6) && rolls.at(-1) >= 1 && rolls.at(-1) <= 6);
    assert.ok(rolls.length > 10 || rolls.at(-1) !== 6);
    assert.equal(last.values.player[0], rolls.reduce((a, b) => a + b));
    assert.deepEqual(plain, { text: '3', kept: true });
    assert.equal(last.scores.player, last.values.player[0] + 3);
    assert.equal(last.scores.opponent, 7);
  });

  test('the extra rolls come from the rules stream: the same seed explodes the same way', () => {
    const go = (seed) => playRounds(rulesFor('fireball', 'exploding-dice', seed), [[Array(8).fill(6), Array(8).fill(6)]]).last;
    assert.deepEqual(go(5), go(5));
    assert.notDeepEqual(go(5).values, go(6).values);
  });

  test('chains are possible and finite, on a d4 most of all', () => {
    let longest = 0;
    for (let seed = 0; seed < 300; seed++) {
      const { last } = playRounds(rulesFor('swarm-of-daggers', 'exploding-dice', seed), [[[4, 4, 4, 4], [1, 1, 1, 1]]]);
      for (const die of last.dice.player) longest = Math.max(longest, die.text.split('+').length);
    }
    assert.ok(longest >= 3 && longest <= 11, `longest chain ${longest}`);
  });

  test('a d10 explodes on its "0", which counts as 10', () => {
    const { last } = playRounds(rulesFor('the-whole-bag', 'exploding-dice'), [[[1, 1, 1, 10, 1, 1], [1, 1, 1, 1, 1, 1]]]);
    assert.equal(last.dice.player[3].tag, 'exploded');
    assert.ok(last.values.player[3] > 10);
  });

  test('exploded values go through the scorer: Heroic Stats still drops the lowest', () => {
    const { last } = playRounds(rulesFor('heroic-stats', 'exploding-dice'), [[[6, 2, 3, 4], [1, 1, 1, 1]]]);
    assert.deepEqual(last.kept.player, [true, false, true, true]);
    assert.equal(last.scores.player, last.values.player[0] + 3 + 4);
  });
});

describe('Raising the Stakes', () => {
  /** Each round's announcement, damage and note. */
  function stakes(rolls) {
    const rules = rulesFor('classic', 'raising-the-stakes');
    let state = startMatch(rules);
    const steps = rolls.map(([p, o]) => {
      const r = round(rules, state, [p], [o]);
      state = r.state;
      return { announce: r.announce, damage: r.outcome.damage, note: r.outcome.note };
    });
    return { steps, state };
  }

  test('each tie raises the next round\'s cost by a heart', () => {
    const { steps, state } = stakes([[5, 5], [8, 8], [9, 2]]);
    assert.deepEqual(steps[0], { announce: undefined, damage: { player: 0, opponent: 0 }, note: 'The stakes go up: the next round costs 2 hearts.' });
    assert.deepEqual(steps[1], { announce: 'This round costs 2 hearts', damage: { player: 0, opponent: 0 }, note: 'The stakes go up: the next round costs 3 hearts.' });
    assert.deepEqual(steps[2], { announce: 'This round costs 3 hearts', damage: { player: 0, opponent: 3 }, note: 'That cost 3 hearts.' });
    // Three hearts at once ends the match.
    assert.equal(state.winner, 'player');
  });

  test('a decided round puts the stakes back to one heart', () => {
    const { steps, state } = stakes([[5, 5], [9, 2], [4, 6]]);
    assert.deepEqual(steps[1].damage, { player: 0, opponent: 2 });
    assert.deepEqual(steps[2], { announce: undefined, damage: { player: 1, opponent: 0 }, note: undefined });
    assert.deepEqual(state.win, { player: 2, opponent: 1 });
  });
});

describe('Cursed Number', () => {
  test('announced each round, from the numbers every die can show', () => {
    const seen = new Set();
    let state = startMatch(rulesFor('the-whole-bag', 'cursed-number'));
    const rules = rulesFor('the-whole-bag', 'cursed-number');
    for (let i = 0; i < 100; i++) {
      let announce;
      ({ state, announce } = beginRound(rules, state));
      assert.equal(announce, `Cursed number: ${state.spice.cursed}`);
      seen.add(state.spice.cursed);
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
  });

  test('a die showing it counts as 0, struck through on the card', () => {
    const rules = rulesFor('ability-score', 'cursed-number');
    let { state } = beginRound(rules, startMatch(rules));
    const c = state.spice.cursed;
    const n = c === 6 ? 5 : 6;
    const { outcome } = playRound(rules, state, { player: [c, n, c], opponent: [n, n, n] });
    assert.deepEqual(outcome.values.player, [0, n, 0]);
    assert.equal(outcome.scores.player, n);
    assert.deepEqual(outcome.dice.player[0], { text: String(c), kept: true, tag: 'cursed' });
  });

  test('under Advantage a cursed die is the lower, so the other counts', () => {
    const rules = rulesFor('advantage', 'cursed-number');
    const { state } = beginRound(rules, startMatch(rules));
    const c = state.spice.cursed;
    const { outcome } = playRound(rules, state, { player: [c, 1], opponent: [1, 1] });
    assert.equal(outcome.scores.player, c === 1 ? 0 : 1);
  });
});

describe('Critical Hit and Critical Fumble', () => {
  test('a winning natural 20 deals double damage', () => {
    const rules = rulesFor('classic', 'critical-hit');
    const { last } = playRounds(rules, [[[20], [4]]]);
    assert.deepEqual(last.damage, { player: 0, opponent: 2 });
    assert.equal(last.note, 'Critical hit! Double damage.');
    assert.deepEqual(playRounds(rules, [[[19], [4]]]).last.damage, { player: 0, opponent: 1 });
    // A 20 that only ties does nothing.
    assert.deepEqual(playRounds(rules, [[[20], [20]]]).last.damage, { player: 0, opponent: 0 });
  });

  test('under Advantage, the d20 that counts', () => {
    const rules = rulesFor('advantage', 'critical-hit');
    assert.deepEqual(playRounds(rules, [[[3, 20], [4, 9]]]).last.damage, { player: 0, opponent: 2 });
  });

  test('a natural 1 costs an extra heart, even on a tie', () => {
    const rules = rulesFor('classic', 'critical-fumble');
    assert.deepEqual(playRounds(rules, [[[1], [12]]]).last.damage, { player: 2, opponent: 0 });
    const tie = playRounds(rules, [[[1], [1]]]).last;
    assert.deepEqual(tie.damage, { player: 1, opponent: 1 });
    assert.equal(tie.note, 'Two critical fumbles!');
    assert.equal(playRounds(rules, [[[2], [12]]]).last.note, undefined);
  });

  test('under Advantage, only both d20s on 1 is a fumble', () => {
    const rules = rulesFor('advantage', 'critical-fumble');
    assert.deepEqual(playRounds(rules, [[[1, 5], [9, 12]]]).last.damage, { player: 1, opponent: 0 });
    assert.deepEqual(playRounds(rules, [[[1, 1], [9, 12]]]).last.damage, { player: 2, opponent: 0 });
  });
});

describe('Inspiration', () => {
  test('the last round\'s loser throws an extra d20 and keeps the highest', () => {
    const rules = rulesFor('classic', 'inspiration');
    let { state } = playRounds(rules, [[[3], [15]]]);
    ({ state } = beginRound(rules, state));
    assert.deepEqual(handOf(rules, state, 'player').types, ['d20', 'd20']);
    assert.deepEqual(handOf(rules, state, 'opponent').types, ['d20']);
    assert.deepEqual(edgeOf(rules, state), { side: 'player', label: 'Inspired: advantage' });
    const { outcome } = playRound(rules, state, { player: [4, 18], opponent: [12] });
    assert.deepEqual(outcome.kept.player, [false, true]);
    assert.equal(outcome.winner, 'player');
  });

  test('nobody is inspired before the first round or after a tie', () => {
    const rules = rulesFor('classic', 'inspiration');
    assert.equal(edgeOf(rules, startMatch(rules)), null);
    const { state } = playRounds(rules, [[[7], [7]]]);
    assert.equal(edgeOf(rules, state), null);
    assert.equal(handOf(rules, state, 'player').types.length, 1);
  });

  test('with Advantage it makes three d20s', () => {
    const rules = rulesFor('advantage', 'inspiration');
    const { state } = playRounds(rules, [[[9, 3], [2, 4]]]);
    assert.deepEqual(handOf(rules, state, 'opponent').types, ['d20', 'd20', 'd20']);
    const { outcome } = playRound(rules, state, { player: [5, 6], opponent: [1, 19, 7] });
    assert.equal(outcome.scores.opponent, 19);
  });
});

describe('Brutal Critical', () => {
  test('a 12 rolls one more d12 and adds it, without chaining', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { last } = playRounds(rulesFor('greataxe', 'brutal-critical', seed), [[[12], [7]]]);
      const [die] = last.dice.player;
      const extra = Number(die.text.slice(1, -1).split('+')[1]);
      assert.equal(die.text, `(12+${extra})`);
      assert.ok(extra >= 1 && extra <= 12);
      assert.equal(last.scores.player, 12 + extra);
      assert.deepEqual(last.dice.opponent, [{ text: '7', kept: true }]);
    }
  });
});

describe('Snake Eyes / Boxcars', () => {
  const rules = rulesFor('greatsword', 'snake-eyes');
  test('boxcars win and snake eyes lose, whatever the totals', () => {
    assert.equal(playRounds(rules, [[[6, 6], [5, 6]]]).last.winner, 'player');
    assert.equal(playRounds(rules, [[[1, 1], [1, 2]]]).last.winner, 'opponent');
    assert.equal(playRounds(rules, [[[1, 1], [6, 6]]]).last.note, 'Boxcars!');
    assert.equal(playRounds(rules, [[[1, 1], [2, 1]]]).last.note, 'Snake eyes!');
  });

  test('both the same is a tie; otherwise the higher total', () => {
    assert.equal(playRounds(rules, [[[6, 6], [6, 6]]]).last.winner, null);
    assert.equal(playRounds(rules, [[[1, 1], [1, 1]]]).last.winner, null);
    assert.equal(playRounds(rules, [[[4, 5], [3, 5]]]).last.winner, 'player');
    assert.equal(playRounds(rules, [[[4, 5], [3, 5]]]).last.note, undefined);
  });
});

describe('Triples', () => {
  test('three of a kind wins outright', () => {
    const rules = rulesFor('ability-score', 'triples');
    const { last } = playRounds(rules, [[[1, 1, 1], [6, 6, 5]]]);
    assert.equal(last.winner, 'player');
    assert.equal(last.note, 'Three of a kind!');
  });

  test('both with triples: the higher total', () => {
    const rules = rulesFor('guiding-bolt', 'triples');
    assert.equal(playRounds(rules, [[[2, 2, 2, 6], [5, 5, 5, 1]]]).last.winner, 'opponent');
  });

  test('a dropped die still makes a triple', () => {
    const rules = rulesFor('heroic-stats', 'triples');
    const { last } = playRounds(rules, [[[2, 2, 2, 3], [6, 6, 5, 4]]]);
    assert.deepEqual(last.kept.player, [true, true, false, true]);
    assert.equal(last.winner, 'player');
  });
});

describe('Caltrops', () => {
  test('each 1 a side rolls takes 1 off the other\'s total, and still counts for its own', () => {
    const rules = rulesFor('swarm-of-daggers', 'caltrops');
    const { last } = playRounds(rules, [[[1, 1, 4, 3], [2, 2, 3, 4]]]);
    assert.deepEqual(last.adjustments, { player: [], opponent: [{ label: 'caltrops', value: -2 }] });
    assert.deepEqual(last.scores, { player: 9, opponent: 9 });
    assert.equal(last.winner, null);
  });

  test('can\'t take a total below zero: the most 1s cost is the fewest a side can roll', () => {
    const rules = rulesFor('magic-missile', 'caltrops');
    const { last } = playRounds(rules, [[[1, 1, 1], [1, 1, 1]]]);
    assert.deepEqual(last.scores, { player: 0, opponent: 0 });
  });
});

describe('Underdog', () => {
  test('whoever has fewer hearts throws one extra die, until they catch up', () => {
    const rules = rulesFor('greatsword', 'underdog');
    let state = startMatch(rules);
    assert.equal(edgeOf(rules, state), null);
    let outcome;
    ({ outcome, state } = round(rules, state, [1, 2], [5, 5]));
    assert.deepEqual(handOf(rules, state, 'player').types, ['d6', 'd6', 'd6']);
    assert.deepEqual(handOf(rules, state, 'opponent').types, ['d6', 'd6']);
    assert.deepEqual(edgeOf(rules, state), { side: 'player', label: '+1 die' });
    ({ outcome, state } = round(rules, state, [6, 6, 6], [1, 1]));
    assert.equal(outcome.scores.player, 18);
    assert.equal(edgeOf(rules, state), null);
    assert.equal(handOf(rules, state, 'player').types.length, 2);
  });

  test('the extra die is the set\'s commonest, smallest on a tie', () => {
    assert.equal(extraDieType(DICE_SETS.classic), 'd20');
    assert.equal(extraDieType(DICE_SETS['sneak-attack']), 'd6');
    assert.equal(extraDieType(DICE_SETS['the-whole-bag']), 'd4');
    assert.equal(extraDieType(DICE_SETS['magic-missile']), 'd4');
  });

  test('never above the 8-dice cap (D6)', () => {
    const rules = { ...rulesFor('the-whole-bag', 'underdog'), diceSet: { ...DICE_SETS.fireball } };
    const state = { ...startMatch(rules), win: { player: 1, opponent: 3 } };
    assert.equal(handOf(rules, state, 'player').types.length, 8);
  });

  test('the extra die is scored by the set\'s own scorer', () => {
    const rules = rulesFor('heroic-stats', 'underdog');
    const state = { ...startMatch(rules), win: { player: 3, opponent: 2 } };
    const { outcome } = playRound(rules, state, { player: [6, 6, 6, 6], opponent: [5, 5, 5, 5, 1] });
    assert.deepEqual(outcome.kept.opponent, [true, true, true, true, false]);
    assert.equal(outcome.scores.opponent, 20);
  });
});

describe('Revenge', () => {
  test('winning straight after losing costs the loser double', () => {
    const rules = rulesFor('classic', 'revenge');
    const { outcomes } = playRounds(rules, [[[3], [9]], [[15], [2]], [[15], [2]]]);
    assert.deepEqual(outcomes[0].damage, { player: 1, opponent: 0 });
    assert.deepEqual(outcomes[1].damage, { player: 0, opponent: 2 });
    assert.equal(outcomes[1].note, 'Revenge! Double damage.');
    // Winning twice in a row is no revenge.
    assert.deepEqual(outcomes[2].damage, { player: 0, opponent: 1 });
  });

  test('a tie in between breaks it', () => {
    const rules = rulesFor('classic', 'revenge');
    const { outcomes } = playRounds(rules, [[[3], [9]], [[5], [5]], [[15], [2]]]);
    assert.deepEqual(outcomes[2].damage, { player: 0, opponent: 1 });
  });

  test('the edge shows who could take revenge', () => {
    const rules = rulesFor('classic', 'revenge');
    const { state } = playRounds(rules, [[[18], [9]]]);
    assert.deepEqual(edgeOf(rules, state), { side: 'opponent', label: 'Revenge: a win costs double' });
  });
});
