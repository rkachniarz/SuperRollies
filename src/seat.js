// Seeing a multiplayer match from the other chair.
//
// Both clients evaluate the rules engine from the host's seat (docs/decisions.md
// D27): its random draws for each side go player first, so the host must be
// `player` on both screens or the two would draw in different orders. The
// guest's screen still has the guest as `player`, near the camera. So the
// guest runs every engine call through guestSeat: the state and everything
// handed in are turned round to the host's seat, the engine runs, and what
// comes back is turned round again. The rest of the game never knows.
//
// Throws are the same story in space (D48): each is simulated in its
// thrower's frame, their dice in the near half, and the other client draws it
// turned 180° about the vertical, onto the far half. Turning a pose round is
// a negation and a swap of components, so it's exact, and a record turned
// round once on each client comes out bit-identical on both.

/** @typedef {import('./rules/types.js').Side} Side */

/** The other side: `player` for `opponent` and back. Anything else as it is. */
export const swapSide = (side) => (side === 'player' ? 'opponent' : side === 'opponent' ? 'player' : side);

/**
 * `value` seen from the other side: every `{ player, opponent }` pair
 * swapped, and every 'player' or 'opponent' string the other one, all the
 * way down. Plain data only (the match state, a round's outcome).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function swapSides(value) {
  if (typeof value === 'string') return /** @type {T} */ (swapSide(value));
  if (Array.isArray(value)) return /** @type {T} */ (value.map(swapSides));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const pair = 'player' in value && 'opponent' in value;
  return /** @type {T} */ (Object.fromEntries(Object.entries(value).map(([k, v]) => [pair ? swapSide(k) : k, swapSides(v)])));
}

// The breeze's arrows (Gusty Table), each turned round.
const ARROWS = { '↑': '↓', '↓': '↑', '←': '→', '→': '←', '↗': '↙', '↙': '↗', '↖': '↘', '↘': '↖' };
const turnArrows = (text) => text?.replace(/[↑↓←→↗↙↖↘]/gu, (a) => ARROWS[a]);

/**
 * The table seen from the other end: holes, breeze and rope flag turned
 * round. The divider and the rope are symmetric already.
 * @param {import('./rules/types.js').TableEffects} table
 */
export function turnTable(table) {
  return {
    ...table,
    holes: table.holes.map((h) => ({ ...h, x: -h.x, z: -h.z })),
    wind: table.wind && [-table.wind[0], -table.wind[1]],
    rope: table.rope && { ...table.rope, pull: -table.rope.pull },
  };
}

/**
 * The rules engine as the guest sees it: the same functions, taking and
 * giving everything from the guest's seat, evaluated from the host's.
 * @param {typeof import('./rules/engine.js')} engine
 */
export function guestSeat(engine) {
  const S = swapSides;
  return {
    ...engine,
    startMatch: (rules) => S(engine.startMatch(rules)),
    beginRound(rules, state) {
      const { state: next, announce } = engine.beginRound(rules, S(state));
      return { state: S(next), announce: turnArrows(announce) };
    },
    handOf: (rules, state, side) => engine.handOf(rules, S(state), swapSide(side)),
    edgeOf: (rules, state) => S(engine.edgeOf(rules, S(state))),
    tableOf: (rules, state) => turnTable(engine.tableOf(rules, S(state))),
    afterSettle: (rules, state, dice) => S(engine.afterSettle(rules, S(state), S(dice))),
    throwsAgain: (rules, state, side, throws) => engine.throwsAgain(rules, S(state), swapSide(side), throws),
    canRethrow: (rules, state, side) => engine.canRethrow(rules, S(state), swapSide(side)),
    spendRethrow: (rules, state, side) => S(engine.spendRethrow(rules, S(state), swapSide(side))),
    playRound(rules, state, faces, table = {}) {
      const { outcome, state: next } = engine.playRound(rules, S(state), S(faces), S(table));
      // What the Spice says about it (`you lose a die`) is said again from
      // this seat: explain only reads the round, so it reads it turned round.
      const { note, ...round } = S(outcome);
      const mine = rules.spice.explain?.(round, { rules, state });
      return { outcome: mine ? { ...round, note: mine } : round, state: S(next) };
    },
  };
}

/** A die's id (as in a throw record) seen from the other side: `player-2` is `opponent-2`. */
export const swapId = (id) => id.replace(/^(player|opponent)-/, (_, side) => `${swapSide(side)}-`);

/** A position turned 180° about the vertical. */
export const turnP = ([x, y, z]) => [-x, y, -z];

/**
 * An orientation turned 180° about the vertical: the 180° turn about y
 * (0, 1, 0, 0), times q. Only signs and places change, so it's exact.
 */
export const turnQ = ([x, y, z, w]) => [z, w, -x, -y];

/** A die in a throw record or result, seen from the other end: id, pose and motion turned round. */
export function turnDie(d) {
  const out = { ...d, id: swapId(d.id) };
  if (d.p) out.p = turnP(d.p);
  if (d.q) out.q = turnQ(d.q);
  if (d.v) out.v = turnP(d.v);
  // Angular velocity is an axis: turned round like a position.
  if (d.w) out.w = turnP(d.w);
  return out;
}

/**
 * A short digest of plain data, for two clients to compare without sending
 * it all: FNV-1a over its JSON, keys sorted.
 */
export function digestOf(value) {
  const text = JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
