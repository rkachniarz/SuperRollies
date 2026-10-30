// The lobby between multiplayer matches (docs/spec.md R7): what's chosen,
// who's ready, and the games each player has won in this room. The host
// keeps it and sends it to the guest whenever it changes (session.js,
// `room`); the guest only asks to be ready, or not.
//
// A player's Ready is theirs alone: they take it back, or the match starts
// and both start again unready. The host changing the dice or Spice leaves
// both as they are (docs/decisions.md D50).

/**
 * @typedef {Object} Room
 * @property {{ diceSet: string, spices: string[] } | null} choice  The dice and a Spice stack (D51).
 * @property {string[]} pool  The Spice stack the host last chose; the choice's
 *   Spice are those of it switched on (a rematch without one of its rules).
 * @property {{ host: boolean, guest: boolean }} ready
 * @property {{ host: number, guest: number }} wins
 */

/** @returns {Room} A new room: nothing ready, 0-0. */
export const newRoom = (choice = null) => ({
  choice, pool: choice?.spices.filter((id) => id !== 'vanilla') ?? [], ready: { host: false, guest: false }, wins: { host: 0, guest: 0 },
});

/** `room` with `seat` ready (`on`) or not. */
export const setReady = (room, seat, on) => ({ ...room, ready: { ...room.ready, [seat]: on } });

/** `room` with the dice and Spice changed: the Ready marks stay as they are. */
export const setChoice = (room, choice) => ({ ...room, choice, pool: choice?.spices.filter((id) => id !== 'vanilla') ?? [] });

/**
 * `room` with Spice `id` of its pool switched on or off: the same dice, the
 * Spice switched on in the pool's order, none at all being Vanilla. The
 * Ready marks stay, as for any change (D50).
 */
export function toggleSpice(room, id) {
  if (!room.choice || !room.pool.includes(id)) return room;
  const on = room.choice.spices.includes(id);
  const spices = room.pool.filter((s) => (s === id ? !on : room.choice.spices.includes(s)));
  return { ...room, choice: { ...room.choice, spices: spices.length ? spices : ['vanilla'] } };
}

/** Whether a match can start: something chosen, and both ready. */
export const bothReady = (room) => Boolean(room.choice && room.ready.host && room.ready.guest);

/** `room` once its match has started: both unready again. */
export const started = (room) => ({ ...room, ready: { host: false, guest: false } });

/** `room` with a new guest in it: their slate clean, the count from 0-0 again. */
export const newGuest = (room) => ({ ...room, ready: { ...room.ready, guest: false }, wins: { host: 0, guest: 0 } });

/**
 * `room` after a match that ended with `result` (`{ winner: 'host' |
 * 'guest' | null, reason }`). A match won on the table or by walkover is a
 * game won; a draw, or one ended out of sync, counts for nobody.
 */
export function tally(room, result) {
  const winner = result?.reason === 'desync' ? null : result?.winner;
  if (winner !== 'host' && winner !== 'guest') return room;
  return { ...room, wins: { ...room.wins, [winner]: room.wins[winner] + 1 } };
}

/**
 * A room received from the other player, checked: anything missing or of
 * the wrong kind is taken as nothing ready, nothing won.
 * @returns {Room}
 */
export function checkRoom(room) {
  const flag = (v) => v === true;
  const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const choice = room?.choice;
  return {
    choice: choice && typeof choice.diceSet === 'string' && Array.isArray(choice.spices)
      && choice.spices.length && choice.spices.every((id) => typeof id === 'string')
      ? { diceSet: choice.diceSet, spices: [...choice.spices] } : null,
    pool: Array.isArray(room?.pool) ? room.pool.filter((id) => typeof id === 'string') : [],
    ready: { host: flag(room?.ready?.host), guest: flag(room?.ready?.guest) },
    wins: { host: count(room?.wins?.host), guest: count(room?.wins?.guest) },
  };
}
