// A multiplayer session: the host's room and the guest in it, from first
// hello to one leaving, across any number of matches.
//
// Messages, all JSON, in order:
//   hello  {v, token, profile, match}  each side, on every new link
//   room   {room}                      host: the lobby (room.js): the dice and
//                                      Spice, who's ready, games won
//   ready  {on}                        guest: ready, or not any more
//   start  {n, config}                 host: both ready, match n begins
//   in     {n, key, data}              one input of match n (see below)
//   sync   {n, log}                    every input of match n so far, after a reconnect
//   end    {n, result}                 match n is over off the table (a walkover)
//   profile {profile}                  either side: their profile, changed in the room
//   bye    {}                          leaving, on purpose
//   ping   {}                          still here
//
// A match's inputs are what each player did at each step that waited on
// them: a throw's release record, a redraw, a re-throw taken or not
// (docs/decisions.md D48). Each is logged under `seat:step` ('host:3/throw'),
// on both clients and in the tab's sessionStorage, and never changes once
// made. That log is the match: replayed through the rules and the physics it
// reaches the same table again, which is how a player who reloads gets back
// in (D49), and two logs that disagree on an entry mean the clients have
// come apart.

import { NET_PING_MS, NET_LOST_MS, NET_FOLLOW_MS } from '../config.js';
import { checkProfile } from '../profile.js';
import { digestOf } from '../seat.js';
import { newCode, NetError } from './transport.js';

const PROTOCOL = 3;
const STORE_KEY = 'superRollies.net';
// A saved session older than this isn't picked up again: the other player
// will have been given the match by now.
const STALE_MS = NET_FOLLOW_MS + 15000;
// How often a guest tries to reach the room again once the link is lost.
const REDIAL_MS = 2500;

const otherSeat = (seat) => (seat === 'host' ? 'guest' : 'host');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The session saved in this tab, if there's one recent enough to pick up again. */
export function savedSession(storage = globalThis.sessionStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null');
    if (saved && Date.now() - saved.at < STALE_MS && saved.match && !saved.match.ended) return saved;
  } catch { /* nothing usable */ }
  return null;
}

/** Forgets the session saved in this tab. */
export function forgetSession(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(STORE_KEY); } catch { /* blocked: nothing saved either */ }
}

/**
 * @param {import('./transport.js').Transport} transport
 * @param {import('../profile.js').Profile} profile  this player's
 */
export function createSession(transport, profile, storage = globalThis.sessionStorage) {
  /** @type {'host' | 'guest'} */
  let seat = 'host';
  let code = null;
  const token = randomToken();
  let myToken = token;
  // The other player, once they've said hello: their token and profile.
  let them = null;
  let room = null;
  let link = null;
  // 'idle' | 'waiting' (a room, nobody in it) | 'open' | 'lost' | 'closed'
  let status = 'idle';
  let lastHeard = 0;
  let lostAt = 0;
  let redialing = false;
  let watch = null;
  /**
   * The match under way, or last played: its number, config, the log of
   * inputs, and how it ended, once it has.
   */
  let match = null;
  // The host's lobby (room.js), kept with the match so a reload keeps the
  // games won.
  let lobby = null;
  // Waiting for an input of the other player's, by log key.
  const takers = new Map();
  const listeners = {};

  const emit = (type, payload) => { for (const fn of listeners[type] ?? []) fn(payload); };

  function save() {
    if (!match) return;
    try {
      storage?.setItem(STORE_KEY, JSON.stringify({
        seat, code, token: myToken, them, at: Date.now(), lobby,
        match: { n: match.n, config: match.config, log: [...match.log], ended: match.ended },
      }));
    } catch { /* storage full or blocked: only a reload can't be recovered from */ }
  }

  const send = (msg) => link?.send(msg);

  function setStatus(next) {
    if (status === next) return;
    status = next;
    if (next === 'lost') lostAt = Date.now();
    emit('status', next);
  }

  // ---------- Links ----------

  function attach(l) {
    // The new link first: the old one, closed, mustn't count as the link lost.
    const old = link;
    link = l;
    if (old && old !== l) old.close();
    lastHeard = Date.now();
    l.onMessage((msg) => { if (link === l) receive(msg); });
    l.onClose(() => {
      if (link !== l) return;
      link = null;
      if (status === 'open') setStatus('lost');
    });
    l.send({ type: 'hello', v: PROTOCOL, token: myToken, profile, match: match?.n ?? null });
  }

  // A link into the host's room, before it has said who it is.
  function knock(l) {
    l.onMessage((msg) => {
      if (msg?.type !== 'hello' || link === l) return;
      const known = them && msg.token === them.token;
      const busy = match && !match.ended && them;
      if (!known && busy) {
        // Somebody else, mid-match: the room's taken.
        l.send({ type: 'bye', reason: 'full' });
        l.close();
        return;
      }
      attach(l);
      receive(msg);
    });
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    lastHeard = Date.now();
    switch (msg.type) {
      case 'hello': {
        if (msg.v !== PROTOCOL) {
          emit('failed', new NetError('version', 'The other player has a different version of the game. Both reload the page and try again.'));
          return;
        }
        const fresh = !them || them.token !== msg.token;
        them = { token: msg.token, profile: checkProfile(msg.profile) };
        setStatus('open');
        if (fresh) emit('joined', them.profile);
        if (match && msg.match === match.n) {
          if (match.ended) send({ type: 'end', n: match.n, result: match.ended });
          else send({ type: 'sync', n: match.n, log: [...match.log] });
        }
        emit('back');
        break;
      }
      case 'room':
        if (seat === 'guest') emit('room', msg.room);
        break;
      case 'profile':
        if (them) {
          them.profile = checkProfile(msg.profile);
          emit('profile', them.profile);
        }
        break;
      case 'ready':
        if (seat === 'host') emit('ready', msg.on === true);
        break;
      case 'start':
        if (seat === 'guest') emit('start', { n: msg.n, config: msg.config });
        break;
      case 'in':
        if (match && msg.n === match.n) merge([[msg.key, msg.data]]);
        break;
      case 'sync':
        if (match && msg.n === match.n) {
          merge(msg.log);
          emit('synced', match.n);
        }
        break;
      case 'end':
        if (match && msg.n === match.n && !match.ended) {
          finish(msg.result);
          emit('over', msg.result);
        }
        break;
      case 'bye':
        them = msg.reason === 'full' ? them : null;
        link?.close();
        link = null;
        setStatus(seat === 'host' ? 'waiting' : 'closed');
        emit('left', msg.reason ?? 'left');
        break;
      default:
        break;
    }
  }

  // Match over, here or over there: `result` as matchView's end says.
  function finish(result) {
    match.ended = result;
    save();
    emit('ended', { n: match.n, result });
  }

  /**
   * Takes in log entries, from the other player or their copy of the log.
   * One already here must say the same, or the two have come apart.
   */
  function merge(entries) {
    for (const [key, data] of entries ?? []) {
      if (typeof key !== 'string') continue;
      if (match.log.has(key)) {
        if (digestOf(match.log.get(key)) !== digestOf(data)) emit('desync', `the two logs disagree on ${key}`);
        continue;
      }
      match.log.set(key, data);
      for (const resolve of takers.get(key) ?? []) resolve(data);
      takers.delete(key);
    }
    save();
  }

  // Pings, and the watch for a link gone quiet: a vanished browser often
  // never says goodbye.
  function startWatch() {
    clearInterval(watch);
    watch = setInterval(() => {
      if (link) {
        send({ type: 'ping' });
        if (Date.now() - lastHeard > NET_LOST_MS) {
          const l = link;
          link = null;
          l.close();
          if (status === 'open') setStatus('lost');
        }
      }
      if (status === 'lost' && seat === 'guest' && !link) redial();
      if (match && !match.ended) save();
    }, NET_PING_MS);
  }

  async function redial() {
    if (redialing || !code) return;
    redialing = true;
    try {
      attach(await transport.dial(code));
    } catch { /* not back yet: the watch tries again */ }
    setTimeout(() => { redialing = false; }, REDIAL_MS);
  }

  // Opens the room under `code`, or a fresh one. A host back after a reload
  // reclaims its own code, which the server may still hold for a moment.
  async function openRoom(wanted) {
    for (let tries = 0; ; tries++) {
      const tryCode = wanted ?? newCode();
      try {
        room = await transport.open(tryCode);
        code = tryCode;
        room.onLink(knock);
        return;
      } catch (err) {
        if (err.kind !== 'taken' || tries > (wanted ? 12 : 5)) throw err;
        if (wanted) await new Promise((r) => { setTimeout(r, REDIAL_MS); });
      }
    }
  }

  // ---------- The match's inputs ----------

  /**
   * The view of match `n` the game plays through: this player's inputs go
   * in with `put`, the other's come out of `take`, both by step.
   */
  function matchView() {
    const m = match;
    const mineKey = (step) => `${seat}:${step}`;
    const theirKey = (step) => `${otherSeat(seat)}:${step}`;
    return {
      n: m.n,
      seat,
      config: m.config,
      profiles: { player: checkProfile(profile), opponent: them?.profile ?? checkProfile({}) },
      /** This player's input at `step`, if it's already in the log (a match being caught up on). */
      mine: (step) => m.log.get(mineKey(step)),
      /** Logs this player's input at `step` and sends it. Made once: making it again must say the same. */
      put(step, data) {
        const key = mineKey(step);
        if (m.log.has(key)) {
          if (digestOf(m.log.get(key)) !== digestOf(data)) emit('desync', `this player's ${step} came out differently`);
          return;
        }
        m.log.set(key, data);
        save();
        send({ type: 'in', n: m.n, key, data });
      },
      /** Resolves with the other player's input at `step`, once it's in. */
      take(step) {
        const key = theirKey(step);
        if (m.log.has(key)) return Promise.resolve(m.log.get(key));
        return new Promise((resolve) => { takers.set(key, [...(takers.get(key) ?? []), resolve]); });
      },
      /** Whether the other player's input at `step` is in. */
      has: (step) => m.log.has(theirKey(step)),
      /**
       * The match is over: `result` is `{ winner: 'host' | 'guest' | null,
       * reason }`. A walkover is told to the other player, who may not
       * have seen it happen.
       */
      end(result) {
        if (m.ended || m !== match) return;
        finish(result);
        if (result.reason !== 'played') send({ type: 'end', n: m.n, result });
      },
      get ended() { return m.ended; },
    };
  }

  return {
    get seat() { return seat; },
    get code() { return code; },
    get status() { return status; },
    /** When the link was lost, while it is. */
    get lostAt() { return lostAt; },
    /** The other player's profile, once they've said hello. */
    get them() { return them?.profile ?? null; },
    /** This player changed their profile (in the room): the next match is played with it, and the other player told. */
    setProfile(next) {
      profile = next;
      if (link) send({ type: 'profile', profile });
    },
    /** Whether this browser can still reach the server: if not, it's this side that dropped. */
    online: () => transport.online(),
    on(type, fn) { (listeners[type] ??= []).push(fn); },

    /** Opens a room as host. Resolves with its code. */
    async host() {
      seat = 'host';
      await openRoom(null);
      setStatus('waiting');
      startWatch();
      return code;
    },

    /** Joins the room `roomCode` as guest. Resolves once the host has said hello. */
    async join(roomCode) {
      seat = 'guest';
      code = roomCode;
      const l = await transport.dial(roomCode);
      const hello = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new NetError('network', 'The room didn\'t answer')), 10000);
        (listeners.joined ??= []).push(() => { clearTimeout(timer); resolve(); });
      });
      attach(l);
      startWatch();
      await hello;
    },

    /**
     * Picks up the session saved in this tab after a reload (savedSession):
     * reopens the room or redials it, and resolves once the other player's
     * log has come in (`synced`), or with how the match ended without us.
     * Rejects if they can't be reached in time.
     */
    async resume(saved) {
      seat = saved.seat;
      code = saved.code;
      myToken = saved.token;
      them = saved.them;
      lobby = saved.lobby ?? null;
      match = { n: saved.match.n, config: saved.match.config, log: new Map(saved.match.log), ended: saved.match.ended };
      const deadline = Date.now() + NET_FOLLOW_MS;
      const back = new Promise((resolve) => {
        (listeners.synced ??= []).push(() => resolve({ ended: null }));
        (listeners.over ??= []).push((result) => resolve({ ended: result }));
      });
      if (seat === 'host') {
        await openRoom(code);
        setStatus('waiting');
      } else {
        setStatus('lost');
        await redial();
      }
      startWatch();
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new NetError('gone', 'The other player didn\'t come back')), Math.max(0, deadline - Date.now()));
      });
      return Promise.race([back, timeout]);
    },

    /** Starts match `n` on `config` (fresh log), and hands back its view. */
    startMatch(n, config) {
      match = { n, config, log: new Map(), ended: null };
      takers.clear();
      save();
      return matchView();
    },
    /** The view of the match picked up by resume. */
    resumedMatch: () => matchView(),
    get matchNumber() { return match?.n ?? 0; },

    /** The host's lobby, sent to the guest and kept with the match (room.js). */
    get lobby() { return lobby; },
    set lobby(room) {
      lobby = room;
      save();
      if (seat === 'host') send({ type: 'room', room });
    },
    /** The guest is ready, or not any more. */
    ready(on) { send({ type: 'ready', on }); },
    /** The host starts match `n`, both being ready. */
    start(n, config) { send({ type: 'start', n, config }); },

    /** Leaves for good: says so, and closes everything. */
    leave() {
      send({ type: 'bye' });
      clearInterval(watch);
      forgetSession(storage);
      link?.close();
      link = null;
      room?.close();
      room = null;
      transport.close();
      match = null;
      for (const key of Object.keys(listeners)) delete listeners[key];
      setStatus('closed');
    },
  };
}
