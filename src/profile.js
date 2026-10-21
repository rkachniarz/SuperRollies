// @ts-check
// Who's playing, and how they look (DEV_PLAN.md R6): a name, and a pick of
// card background, tray colour and dice colour from the choices in config.js.
// Saved on the device. Cosmetic only: none of it reaches the rules engine or a
// throw record (R6.10).

import { CARD_COLORS, TRAY_COLORS, DICE_COLORS } from './config.js';

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {string} card  An id in CARD_COLORS.
 * @property {string} tray  An id in TRAY_COLORS.
 * @property {string} dice  An id in DICE_COLORS.
 */

export const NAME_MAX = 16;
export const DEFAULT_NAME = 'Player';
const STORAGE_KEY = 'superRollies.profile';

/** @type {Profile} */
export const DEFAULT_PROFILE = Object.freeze({
  name: DEFAULT_NAME,
  card: CARD_COLORS[0].id,
  tray: TRAY_COLORS[0].id,
  dice: DICE_COLORS[0].id,
});

// Characters as the eye sees them, so an emoji built of several code points
// (a family, a flag, a skin tone) counts as one.
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** @param {string} text */
function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** How many characters `text` has, as the eye counts them. */
export function nameLength(text) {
  return graphemes(text).length;
}

/**
 * `text` as a name can be: no control characters (a pasted line break), at
 * most NAME_MAX characters. Spaces at the ends are kept, as the player may
 * still be typing; cleanName trims them.
 * @param {string} text
 */
export function limitName(text) {
  return graphemes(String(text).replace(/\p{Cc}/gu, '')).slice(0, NAME_MAX).join('');
}

/**
 * A name fit to keep and show: limited, trimmed, and the default if nothing
 * is left.
 * @param {unknown} text
 */
export function cleanName(text) {
  return limitName(typeof text === 'string' ? text : '').trim() || DEFAULT_NAME;
}

/** The choice called `id` in `list`, or the list's first (the default) if there's none. */
function choice(list, id) {
  return list.find((c) => c.id === id) ?? list[0];
}

/**
 * A profile as it may be kept: anything missing or unknown (a choice since
 * removed, a hand-edited save, a profile sent by another player) replaced by
 * the default.
 * @param {unknown} raw
 * @returns {Profile}
 */
export function checkProfile(raw) {
  const p = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    name: cleanName(p.name),
    card: choice(CARD_COLORS, p.card).id,
    tray: choice(TRAY_COLORS, p.tray).id,
    dice: choice(DICE_COLORS, p.dice).id,
  };
}

/**
 * The colours a profile picks, ready to draw with.
 * @param {Profile} profile
 */
export function looksOf(profile) {
  return {
    name: profile.name,
    card: choice(CARD_COLORS, profile.card).color,
    tray: choice(TRAY_COLORS, profile.tray).color,
    dice: choice(DICE_COLORS, profile.dice),
  };
}

/**
 * The AI opponent's profile for a match: "Opponent" for now, its colours
 * drawn from the same choices as the player's (R6.6), but never the player's
 * dice colour, so the two sides' dice are always told apart.
 * @param {import('./rng.js').Rng} rng  A stream of its own (`deriveSeed(seed, 'looks')`).
 * @param {Profile} player
 * @returns {Profile}
 */
export function opponentProfile(rng, player) {
  const dice = DICE_COLORS.filter((c) => c.id !== player.dice);
  return {
    name: 'Opponent',
    card: CARD_COLORS[rng.int(CARD_COLORS.length)].id,
    tray: TRAY_COLORS[rng.int(TRAY_COLORS.length)].id,
    dice: dice[rng.int(dice.length)].id,
  };
}

/**
 * The player's profile, loaded from `storage` and saved back to it. Storage
 * may be missing or refuse (a private window, the claude.ai artifact), so
 * every touch of it is wrapped: without it the profile lasts the session.
 * @param {() => Storage | undefined} [storage]  Where it's kept; localStorage by default.
 */
export function createProfileStore(storage = () => globalThis.localStorage) {
  /** @type {Profile} */
  let profile = { ...DEFAULT_PROFILE };
  try {
    const saved = storage()?.getItem(STORAGE_KEY);
    if (saved) profile = checkProfile(JSON.parse(saved));
  } catch {
    // Unreadable or unparseable: the defaults it is.
  }
  return {
    /** @returns {Profile} */
    get() {
      return { ...profile };
    },
    /**
     * Keeps `next` (checked first), and returns what was kept.
     * @param {Partial<Profile>} next
     */
    save(next) {
      profile = checkProfile(next);
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(profile));
      } catch {
        // Not kept past this session, but the game plays on.
      }
      return { ...profile };
    },
  };
}
