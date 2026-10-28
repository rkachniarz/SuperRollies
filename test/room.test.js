// The multiplayer lobby's state: ready marks and games won (docs/spec.md R7,
// docs/decisions.md D50).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, setReady, setChoice, bothReady, started, newGuest, tally, checkRoom } from '../src/net/room.js';

const CHOICE = { diceSet: 'classic', spice: 'vanilla' };

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
  const changed = setChoice(room, { diceSet: 'greatsword', spice: 'underdog' });
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
    { choice: null, ready: { host: false, guest: true }, wins: { host: 0, guest: 0 } });
  const room = tally(setReady(newRoom(CHOICE), 'guest', true), { winner: 'guest', reason: 'played' });
  assert.deepEqual(checkRoom(JSON.parse(JSON.stringify(room))), room);
});
