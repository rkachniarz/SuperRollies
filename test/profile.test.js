import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICE_SETS } from '../src/rules/dice-sets.js';
import { CARD_COLORS, TRAY_COLORS, DICE_COLORS } from '../src/config.js';
import { createRng, deriveSeed } from '../src/rng.js';
import {
  DEFAULT_PROFILE, NAME_MAX, nameLength, limitName, cleanName, checkProfile, looksOf, opponentProfile, createProfileStore, OPPONENT_NAMES,
} from '../src/profile.js';

/** A Storage stand-in, keeping what's set in a Map. */
function memoryStorage() {
  const items = new Map();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    items,
  };
}

test('every choice list has four, with unique ids', () => {
  for (const list of [CARD_COLORS, TRAY_COLORS, DICE_COLORS]) {
    assert.equal(list.length, 4);
    assert.equal(new Set(list.map((c) => c.id)).size, list.length);
  }
});

test('a name counts characters as seen: a family emoji is one', () => {
  assert.equal(nameLength('Rafał'), 5);
  assert.equal(nameLength('👨‍👩‍👧'), 1);
  assert.equal(nameLength('🇵🇱🎲'), 2);
});

test('a name is cut to 16 characters, never mid-emoji', () => {
  assert.equal(nameLength(limitName('x'.repeat(30))), NAME_MAX);
  const emoji = '👨‍👩‍👧'.repeat(20);
  assert.equal(limitName(emoji), '👨‍👩‍👧'.repeat(NAME_MAX));
});

test('letters, numbers, symbols and emoji are kept; control characters are not', () => {
  assert.equal(cleanName('Dice#1 ✨ ü'), 'Dice#1 ✨ ü');
  assert.equal(cleanName('two\nlines'), 'twolines');
});

test('an empty or blank name, or none, falls back to the default', () => {
  for (const name of ['', '   ', undefined, 42, null]) assert.equal(cleanName(name), 'Player');
  assert.equal(cleanName('  Ada  '), 'Ada');
});

test('an unknown or missing choice falls back to the default', () => {
  assert.deepEqual(checkProfile({ name: 'Ada', card: 'gold', tray: 'satin', dice: 7 }),
    { name: 'Ada', card: CARD_COLORS[0].id, tray: 'satin', dice: DICE_COLORS[0].id });
  assert.deepEqual(checkProfile(null), { ...DEFAULT_PROFILE });
  assert.deepEqual(checkProfile('nonsense'), { ...DEFAULT_PROFILE });
});

test('looksOf gives the colours a profile picks', () => {
  const looks = looksOf({ name: 'Ada', card: 'sky', tray: 'deep-blue', dice: 'charcoal' });
  assert.equal(looks.card, CARD_COLORS.find((c) => c.id === 'sky').color);
  assert.equal(looks.tray, TRAY_COLORS.find((c) => c.id === 'deep-blue').color);
  assert.equal(looks.dice.id, 'charcoal');
  assert.ok('body' in looks.dice && 'edge' in looks.dice && 'number' in looks.dice);
});

test("the opponent is 'Opponent' with any dice, never in the player's dice colour, and every other colour turns up", () => {
  for (const dice of DICE_COLORS.map((c) => c.id)) {
    const seen = { card: new Set(), tray: new Set(), dice: new Set() };
    for (let seed = 0; seed < 300; seed++) {
      const them = opponentProfile(createRng(deriveSeed(seed, 'looks')), { ...DEFAULT_PROFILE, dice });
      assert.equal(them.name, 'Opponent');
      assert.notEqual(them.dice, dice);
      for (const k of /** @type {const} */ (['card', 'tray', 'dice'])) seen[k].add(them[k]);
    }
    assert.equal(seen.card.size, 4);
    assert.equal(seen.tray.size, 4);
    assert.equal(seen.dice.size, 3);
  }
});

test("the same seed gives the opponent the same look", () => {
  const draw = () => opponentProfile(createRng(deriveSeed(99, 'looks')), DEFAULT_PROFILE);
  assert.deepEqual(draw(), draw());
});

test('a saved profile is loaded again, checked', () => {
  const storage = memoryStorage();
  createProfileStore(() => storage).save({ name: '  Ada  ', card: 'mint', tray: 'satin', dice: 'ivory' });
  assert.deepEqual(createProfileStore(() => storage).get(), { name: 'Ada', card: 'mint', tray: 'satin', dice: 'ivory' });
});

test('with no storage, or storage that throws, the profile lasts the session', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  for (const storage of [() => undefined, () => broken, () => { throw new Error('no access'); }]) {
    const store = createProfileStore(storage);
    assert.deepEqual(store.get(), { ...DEFAULT_PROFILE });
    store.save({ ...DEFAULT_PROFILE, name: 'Ada' });
    assert.equal(store.get().name, 'Ada');
  }
});

test('a corrupt save is ignored', () => {
  const storage = memoryStorage();
  storage.setItem('superRollies.profile', '{not json');
  assert.deepEqual(createProfileStore(() => storage).get(), { ...DEFAULT_PROFILE });
});

test('the AI has a name for its dice set (D57): every set two or three, each fitting a card, the colours as before', () => {
  for (const id of Object.keys(DICE_SETS)) {
    const names = OPPONENT_NAMES[id];
    assert.ok(names && names.length >= 2 && names.length <= 3, id);
    for (const name of names) assert.ok(nameLength(name) <= NAME_MAX && cleanName(name) === name, `${id}: ${name}`);
  }
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const named = opponentProfile(createRng(deriveSeed(seed, 'looks')), DEFAULT_PROFILE, 'fireball');
    const plain = opponentProfile(createRng(deriveSeed(seed, 'looks')), DEFAULT_PROFILE);
    assert.deepEqual({ ...named, name: 'Opponent' }, plain);
    seen.add(named.name);
  }
  assert.deepEqual([...seen].sort(), [...OPPONENT_NAMES.fireball].sort());
});
