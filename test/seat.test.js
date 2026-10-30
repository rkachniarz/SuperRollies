import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/rules/engine.js';
import { DICE_SETS, DIE_MAX } from '../src/rules/dice-sets.js';
import { SPICE } from '../src/rules/spice.js';
import { createRng } from '../src/rng.js';
import { clashOf, largestStack } from '../src/rules/stacking.js';
import { guestSeat, swapSides, turnTable, turnQ, turnP, turnDie, swapId, digestOf } from '../src/seat.js';

const guest = guestSeat(engine);
const SIDES = ['player', 'opponent'];

/**
 * Plays a match on the host's engine and, alongside it, on the guest's
 * (guestSeat), feeding the guest everything turned round, and checks that
 * every answer the guest gets is the host's turned round. Faces are random,
 * from `seed`. `spice` is one id, or a stack of them (D51). Returns the
 * notes each side was given.
 */
function playBoth(diceSet, spice, seed) {
  const rules = engine.resolveRules(engine.matchConfig({ seed, diceSet, spices: [spice].flat() }));
  const rng = createRng(seed ^ 0x5eed);
  const roll = (types) => types.map((t) => 1 + rng.int(DIE_MAX[t]));
  let host = engine.startMatch(rules);
  let seen = guest.startMatch(rules);
  assert.deepEqual(seen, swapSides(host), 'startMatch');
  const notes = [];
  for (let n = 0; n < 40 && !host.winner; n++) {
    const begun = engine.beginRound(rules, host);
    const begunG = guest.beginRound(rules, seen);
    assert.deepEqual(begunG.state, swapSides(begun.state), 'beginRound');
    host = begun.state;
    seen = begunG.state;
    assert.deepEqual(guest.edgeOf(rules, seen), swapSides(engine.edgeOf(rules, host)), 'edgeOf');
    assert.deepEqual(guest.tableOf(rules, seen), turnTable(engine.tableOf(rules, host)), 'tableOf');
    const hands = Object.fromEntries(SIDES.map((side) => [side, engine.handOf(rules, host, side)]));
    for (const side of SIDES) {
      assert.deepEqual(guest.handOf(rules, seen, swapSides(side)).types, hands[side].types, `handOf ${side}`);
    }
    const counts = { player: hands.player.types.length, opponent: hands.opponent.types.length };
    const settled = engine.afterSettle(rules, host, counts);
    const settledG = guest.afterSettle(rules, seen, swapSides(counts));
    assert.deepEqual(settledG, swapSides(settled), 'afterSettle');
    host = settled.state;
    seen = settledG.state;
    const faces = { player: roll(hands.player.types), opponent: roll(hands.opponent.types) };
    const fallen = { player: faces.player.map(() => rng.next() < 0.1), opponent: faces.opponent.map(() => rng.next() < 0.1) };
    const again = { player: [], opponent: [] };
    for (const side of SIDES) {
      assert.equal(guest.throwsAgain(rules, seen, swapSides(side), [faces[side]]),
        engine.throwsAgain(rules, host, side, [faces[side]]), 'throwsAgain');
    }
    const played = engine.playRound(rules, host, faces, { fallen, again });
    const playedG = guest.playRound(rules, seen, swapSides(faces), swapSides({ fallen, again }));
    const { note, ...outcome } = played.outcome;
    const { note: noteG, ...outcomeG } = playedG.outcome;
    assert.deepEqual(outcomeG, swapSides(outcome), 'playRound outcome');
    assert.deepEqual(playedG.state, swapSides(played.state), 'playRound state');
    assert.equal(Boolean(noteG), Boolean(note), 'a note on one screen is a note on the other');
    notes.push({ host: note, guest: noteG, outcome });
    // The loser's re-throw (Second Wind, Mercy), where there is one.
    const loser = outcome.winner && swapSides(outcome.winner);
    if (loser && engine.canRethrow(rules, host, loser)) {
      assert.equal(guest.canRethrow(rules, seen, swapSides(loser)), true, 'canRethrow');
      assert.deepEqual(guest.spendRethrow(rules, seen, swapSides(loser)),
        swapSides(engine.spendRethrow(rules, host, loser)), 'spendRethrow');
    }
    host = played.state;
    seen = playedG.state;
  }
  return notes;
}

describe('the guest\'s seat (D27)', () => {
  test('swapping sides swaps every pair and side name, and twice is no change', () => {
    const state = { win: { player: 3, opponent: 1 }, spice: { used: { player: true, opponent: false }, hole: [0.5, 0.2] },
      previous: { winner: 'player' }, note: 'player' };
    assert.deepEqual(swapSides(state), {
      win: { opponent: 3, player: 1 }, spice: { used: { opponent: true, player: false }, hole: [0.5, 0.2] },
      previous: { winner: 'opponent' }, note: 'opponent',
    });
    assert.deepEqual(swapSides(swapSides(state)), state);
    assert.equal(swapSides(null), null);
    assert.equal(swapSides('draw'), 'draw');
  });

  test('every Spice with every dice set it allows: the guest is told what the host is, turned round', () => {
    let seed = 1;
    for (const diceSet of Object.values(DICE_SETS)) {
      for (const spice of Object.values(SPICE)) {
        if (!engine.isEligible(spice, diceSet)) continue;
        for (let k = 0; k < 3; k++) playBoth(diceSet.id, spice.id, seed++);
      }
    }
  });

  test('every pair of Spice that stacks, with every dice set both allow, and each set\'s largest stack (D51)', () => {
    let seed = 1;
    for (const diceSet of Object.values(DICE_SETS)) {
      const ids = Object.values(SPICE).filter((s) => s.id !== 'vanilla' && engine.isEligible(s, diceSet)).map((s) => s.id);
      for (const [i, a] of ids.entries()) {
        for (const b of ids.slice(i + 1)) if (!clashOf(a, b)) playBoth(diceSet.id, [a, b], seed++);
      }
      for (let k = 0; k < 3; k++) playBoth(diceSet.id, largestStack(diceSet.id), seed++);
    }
  });

  test('what the Spice says is said from the guest\'s seat: "you" is the guest', () => {
    // Burnout: a side whose die shows a 1 loses it.
    let checked = 0;
    for (let seed = 1; seed < 200 && checked < 5; seed++) {
      for (const { host, guest: theirs, outcome } of playBoth('classic', 'burnout', seed)) {
        // A 1 down a hole doesn't burn (D51).
        const burns = (side) => outcome.faces[side].some((f, i) => f === 1 && !outcome.fallen[side][i]);
        const hostLost = burns('player');
        const guestLost = burns('opponent');
        if (hostLost === guestLost) continue;
        assert.match(host, hostLost ? /you lose/ : /they lose/);
        assert.match(theirs, hostLost ? /they lose/ : /you lose/);
        assert.doesNotMatch(theirs, hostLost ? /you lose/ : /they lose/);
        checked++;
      }
    }
    assert.ok(checked >= 5, `only ${checked} rounds with one side losing a die`);
  });

  test('the breeze blows the other way, and its arrow points it', () => {
    const rules = engine.resolveRules(engine.matchConfig({ seed: 7, diceSet: 'classic', spice: 'gusty-table' }));
    const host = engine.beginRound(rules, engine.startMatch(rules));
    const seen = guest.beginRound(rules, guest.startMatch(rules));
    const wind = engine.tableOf(rules, host.state).wind;
    assert.deepEqual(guest.tableOf(rules, seen.state).wind, [-wind[0], -wind[1]]);
    const arrow = host.announce.at(-1);
    const turned = { '↑': '↓', '↓': '↑', '←': '→', '→': '←', '↗': '↙', '↙': '↗', '↖': '↘', '↘': '↖' }[arrow];
    assert.equal(seen.announce, host.announce.slice(0, -1) + turned);
  });
});

describe('a throw turned round (D48)', () => {
  test('a pose turned twice is the same pose (the orientation may change sign)', () => {
    const p = [1.25, 0.5, -2.75];
    const q = [0.1, 0.7, -0.3, 0.6403124];
    assert.deepEqual(turnP(turnP(p)), p);
    assert.deepEqual(turnQ(turnQ(q)), q.map((c) => -c));
  });

  test('turnQ is a 180° turn about the vertical: it carries x to -x and leaves y alone', () => {
    // Rotate a vector by a quaternion: v' = q v q*.
    const rotate = ([x, y, z, w], [vx, vy, vz]) => {
      const tx = 2 * (y * vz - z * vy);
      const ty = 2 * (z * vx - x * vz);
      const tz = 2 * (x * vy - y * vx);
      return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
    };
    const identity = [0, 0, 0, 1];
    const close = (a, b) => a.every((c, i) => Math.abs(c - b[i]) < 1e-12);
    assert.ok(close(rotate(turnQ(identity), [1, 0, 0]), [-1, 0, 0]));
    assert.ok(close(rotate(turnQ(identity), [0, 1, 0]), [0, 1, 0]));
    assert.ok(close(rotate(turnQ(identity), [0, 0, 1]), [0, 0, -1]));
    // Any orientation, then turned: the same as turning what it points at.
    const q = [0.1, 0.7, -0.3, 0.6403124];
    const n = Math.hypot(...q);
    const unit = q.map((c) => c / n);
    for (const v of [[1, 0, 0], [0, 1, 0], [0.3, -0.2, 0.9]]) {
      assert.ok(close(rotate(turnQ(unit), v), turnP(rotate(unit, v))));
    }
  });

  test('a die in a record: its id goes to the other side, its pose and motion turn round', () => {
    const d = { id: 'player-3', type: 'd6', s: 1, p: [1, 2, 3], q: [0, 0, 0, 1], v: [4, 5, 6], w: [7, 8, 9], fixed: true };
    assert.deepEqual(turnDie(d), {
      id: 'opponent-3', type: 'd6', s: 1, p: [-1, 2, -3], q: [0, 1, -0, -0], v: [-4, 5, -6], w: [-7, 8, -9], fixed: true,
    });
    assert.equal(swapId('opponent-0'), 'player-0');
    assert.equal(swapId('pop-player-1'), 'pop-player-1');
  });

  test('a digest of plain data ignores the order of its keys', () => {
    assert.equal(digestOf({ a: 1, b: [1, { c: 2, d: 3 }] }), digestOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
    assert.notEqual(digestOf({ a: 1 }), digestOf({ a: 2 }));
  });
});
