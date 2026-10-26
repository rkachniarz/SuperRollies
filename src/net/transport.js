// How two browsers reach each other: a room the host opens under a short
// code, and a link the guest dials into it, carrying JSON messages both ways,
// in order.
//
// Over the internet that's WebRTC through PeerJS (docs/decisions.md D2): its
// public signalling server introduces the two, then they talk directly, or
// through a TURN server where a network won't allow that (D12, R4.7). For
// tests, and two tabs on one machine, `?net=local` uses a BroadcastChannel
// instead: the same rooms and links, no server.
//
// A link here only says it closed when it knows. A browser that vanished
// (a phone locked, a tab closed mid-match) often says nothing, so the session
// keeps its own watch with pings (session.js).

import { ICE_SERVERS } from '../config.js';

// Codes are short and read aloud: no 0/O, 1/I/L.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
// PeerJS ids are global on its public server, so ours carry a prefix.
const PEER_PREFIX = 'super-rollies-';

/** A fresh room code. */
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

/** `text` as a room code, if it can be one (case and spaces don't matter). */
export function cleanCode(text) {
  const code = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_LETTERS.includes(c)) ? code : null;
}

/**
 * Why a room couldn't be opened or reached: `taken` (the code is in use; for
 * a host reclaiming its room after a reload, still for a moment), `missing`
 * (no room with that code), `network` (no server, no connection).
 */
export class NetError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * @typedef {{
 *   send: (msg: object) => void,
 *   onMessage: (fn: (msg: any) => void) => void,
 *   onClose: (fn: () => void) => void,
 *   close: () => void,
 * }} Link
 * @typedef {{
 *   onLink: (fn: (link: Link) => void) => void,
 *   online: () => boolean,
 *   close: () => void,
 * }} Room
 * @typedef {{
 *   open: (code: string) => Promise<Room>,
 *   dial: (code: string) => Promise<Link>,
 *   online: () => boolean,
 *   close: () => void,
 * }} Transport
 */

/** The transport the address asks for: `?net=local`, or PeerJS. */
export function createTransport(search = window.location.search) {
  return new URLSearchParams(search).get('net') === 'local' ? localTransport() : peerTransport();
}

// ---------- PeerJS ----------

let peerLibrary = null;
const loadPeer = () => (peerLibrary ??= import('peerjs').then((m) => m.Peer ?? m.default));

/** @returns {Transport} */
function peerTransport() {
  let peer = null;

  function wrap(conn) {
    const closers = [];
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      for (const fn of closers) fn();
    };
    conn.on('close', closeOnce);
    conn.on('error', closeOnce);
    return {
      send: (msg) => { if (conn.open) conn.send(msg); },
      onMessage: (fn) => conn.on('data', fn),
      onClose: (fn) => closers.push(fn),
      close: () => conn.close(),
    };
  }

  // A peer on the signalling server, under `id` (or one it picks), once
  // it's registered there.
  async function register(id) {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const p = id ? new Peer(id, { config: { iceServers: ICE_SERVERS } }) : new Peer({ config: { iceServers: ICE_SERVERS } });
      const fail = (err) => {
        p.destroy();
        reject(err.type === 'unavailable-id' ? new NetError('taken', 'That room code is in use')
          : new NetError('network', `Couldn't reach the game server (${err.type ?? err.message})`));
      };
      p.once('error', fail);
      p.once('open', () => {
        p.off('error', fail);
        // Dropped by the signalling server (a network blip): back on, so a
        // guest coming back can still find the room. Links already made don't
        // need it.
        p.on('disconnected', () => { if (!p.destroyed) setTimeout(() => { if (!p.destroyed && p.disconnected) p.reconnect(); }, 1000); });
        resolve(p);
      });
    });
  }

  return {
    async open(code) {
      peer?.destroy();
      peer = await register(PEER_PREFIX + code);
      const host = peer;
      const linkers = [];
      host.on('connection', (conn) => {
        conn.on('open', () => { const link = wrap(conn); for (const fn of linkers) fn(link); });
      });
      // Errors after opening (a guest's connection failing) are the link's.
      host.on('error', (err) => console.warn('Room:', err.type ?? err));
      return {
        onLink: (fn) => linkers.push(fn),
        online: () => !host.disconnected && !host.destroyed,
        close: () => host.destroy(),
      };
    },
    async dial(code) {
      if (!peer || peer.destroyed) peer = await register(null);
      const guest = peer;
      if (guest.disconnected) guest.reconnect();
      return new Promise((resolve, reject) => {
        const conn = guest.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        const timer = setTimeout(() => { done(); conn.close(); reject(new NetError('network', "Couldn't connect to the room")); }, 15000);
        const missing = (err) => {
          if (err.type !== 'peer-unavailable') return;
          done();
          reject(new NetError('missing', 'No game with that code'));
        };
        const done = () => { clearTimeout(timer); guest.off('error', missing); };
        guest.on('error', missing);
        conn.on('open', () => { done(); resolve(wrap(conn)); });
      });
    },
    online: () => Boolean(peer && !peer.disconnected && !peer.destroyed) && navigator.onLine !== false,
    close() { peer?.destroy(); peer = null; },
  };
}

// ---------- Local: a BroadcastChannel, for tests and two tabs ----------

/** @returns {Transport} */
function localTransport() {
  const me = newCode() + newCode();
  const channels = [];

  // Messages on the room's channel: `dial` (a guest knocking), `accept`,
  // `msg` and `close`, each addressed `to` a peer by its id.
  function channelFor(code) {
    const channel = new BroadcastChannel(`super-rollies-${code}`);
    channels.push(channel);
    return channel;
  }

  function link(channel, them) {
    const listeners = [];
    const closers = [];
    let closed = false;
    const handler = (e) => {
      const m = e.data;
      if (m.to !== me || m.from !== them || closed) return;
      if (m.type === 'msg') for (const fn of listeners) fn(m.data);
      if (m.type === 'close') shut();
    };
    const shut = () => {
      if (closed) return;
      closed = true;
      channel.removeEventListener('message', handler);
      for (const fn of closers) fn();
    };
    channel.addEventListener('message', handler);
    return {
      send: (data) => { if (!closed) channel.postMessage({ type: 'msg', to: them, from: me, data }); },
      onMessage: (fn) => listeners.push(fn),
      onClose: (fn) => closers.push(fn),
      close() {
        if (!closed) channel.postMessage({ type: 'close', to: them, from: me });
        shut();
      },
    };
  }

  return {
    async open(code) {
      const channel = channelFor(code);
      const linkers = [];
      channel.addEventListener('message', (e) => {
        const m = e.data;
        if (m.type !== 'dial' || m.room !== code) return;
        channel.postMessage({ type: 'accept', to: m.from, from: me });
        const l = link(channel, m.from);
        for (const fn of linkers) fn(l);
      });
      return {
        onLink: (fn) => linkers.push(fn),
        online: () => true,
        close: () => channel.close(),
      };
    },
    dial(code) {
      const channel = channelFor(code);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { channel.removeEventListener('message', accepted); reject(new NetError('missing', 'No game with that code')); }, 3000);
        const accepted = (e) => {
          const m = e.data;
          if (m.type !== 'accept' || m.to !== me) return;
          clearTimeout(timer);
          channel.removeEventListener('message', accepted);
          resolve(link(channel, m.from));
        };
        channel.addEventListener('message', accepted);
        channel.postMessage({ type: 'dial', room: code, from: me });
      });
    },
    online: () => true,
    close() { for (const c of channels.splice(0)) c.close(); },
  };
}
