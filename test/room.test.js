// The multiplayer lobby's state: ready marks and games won (docs/spec.md R7,
// docs/decisions.md D50).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, setReady, setChoice, setDice, toggleSpice, bothReady, started, newGuest, tally, checkRoom } from '../src/net/room.js';

const CHOICE = { diceSet: 'classic', spices: ['vanilla'] };

test('a match starts only once both are ready, and something is chosen', () => {
  let room = newRoom(CHOICE);
  assert.equal(bothReady(room), false);
  room = setReady(room, 'host', true);
  assert.equal(bothReady(room), false);
  room = setReady(room, 'guest', true);
  assert.equal(bothReady(room), true);
  assert.equal(bothReady(setChoice(room, null)), false);
});

test('a player can take their Ready back', () => {
  const room = setReady(setReady(newRoom(CHOICE), 'host', true), 'guest', true);
  assert.equal(bothReady(setReady(room, 'guest', false)), false);
});

test('changing the dice or Spice leaves both Ready marks as they are (Q5)', () => {
  const room = setReady(setReady(newRoom(CHOICE), 'host', true), 'guest', true);
  const changed = setChoice(room, { diceSet: 'greatsword', spices: ['underdog', 'cat-paw'] });
  assert.deepEqual(changed.ready, { host: true, guest: true });
  assert.equal(bothReady(changed), true);
});

test('both start the next match unready', () => {
  const room = started(setReady(setReady(newRoom(CHOICE), 'host', true), 'guest', true));
  assert.deepEqual(room.ready, { host: false, guest: false });
});

test('a game won on the table or by walkover counts; a draw or out of sync does not (Q6)', () => {
  let room = newRoom(CHOICE);
  room = tally(room, { winner: 'host', reason: 'played' });
  room = tally(room, { winner: 'guest', reason: 'stalled' });
  room = tally(room, { winner: 'guest', reason: 'gone' });
  room = tally(room, { winner: null, reason: 'played' });
  room = tally(room, { winner: null, reason: 'desync' });
  room = tally(room, { winner: 'host', reason: 'desync' });
  room = tally(room, undefined);
  assert.deepEqual(room.wins, { host: 1, guest: 2 });
});

test('a new guest starts the count from 0-0, unready; the host stays ready', () => {
  const room = newGuest(tally(setReady(setReady(newRoom(CHOICE), 'host', true), 'guest', true), { winner: 'host', reason: 'played' }));
  assert.deepEqual(room.wins, { host: 0, guest: 0 });
  assert.deepEqual(room.ready, { host: true, guest: false });
});

test('a room received is checked', () => {
  assert.deepEqual(checkRoom(null), newRoom());
  assert.deepEqual(checkRoom({ choice: { diceSet: 1 }, ready: { host: 'yes', guest: true }, wins: { host: -1, guest: 2.5 } }),
    { choice: null, pool: [], ready: { host: false, guest: true }, wins: { host: 0, guest: 0 } });
  const room = tally(setReady(newRoom(CHOICE), 'guest', true), { winner: 'guest', reason: 'played' });
  assert.deepEqual(checkRoom(JSON.parse(JSON.stringify(room))), room);
});

test('the host switches Spice of the last stack off and on again: the same order, none at all Vanilla', () => {
  let room = setReady(setChoice(newRoom(), { diceSet: 'classic', spices: ['marathon', 'cat-paw', 'gusty-table'] }), 'guest', true);
  room = toggleSpice(room, 'cat-paw');
  assert.deepEqual(room.choice.spices, ['marathon', 'gusty-table']);
  assert.deepEqual(room.pool, ['marathon', 'cat-paw', 'gusty-table']);
  assert.equal(room.ready.guest, true);
  room = toggleSpice(toggleSpice(room, 'marathon'), 'gusty-table');
  assert.deepEqual(room.choice.spices, ['vanilla']);
  room = toggleSpice(room, 'cat-paw');
  assert.deepEqual(room.choice.spices, ['cat-paw']);
  assert.equal(toggleSpice(room, 'lowball'), room, 'only Spice of the stack last chosen');
});

test('the host changes just the dice: the Spice stay, bar those the new dice don\'t allow, and so do the Ready marks', () => {
  let room = setReady(setChoice(newRoom(), { diceSet: 'classic', spices: ['marathon', 'critical-hit', 'cat-paw'] }), 'guest', true);
  room = toggleSpice(room, 'cat-paw');
  const d20Only = (ids) => !ids.includes('critical-hit');
  room = setDice(room, 'fireball', d20Only);
  assert.deepEqual(room.choice, { diceSet: 'fireball', spices: ['marathon'] });
  assert.deepEqual(room.pool, ['marathon', 'cat-paw'], 'cat-paw still there, still off');
  assert.equal(room.ready.guest, true);
  assert.deepEqual(setDice(toggleSpice(room, 'marathon'), 'greatsword', () => true).choice.spices, ['vanilla']);
});
