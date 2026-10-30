// Multiplayer's menus: hosting a room and choosing what's played in it,
// joining one, and what each player sees between matches.
//
// The host picks the dice and a Spice stack from the full catalogue
// (docs/spec.md R4.2, docs/decisions.md D3, D51), bar what can't be played
// over the network. The stack starts dealt as Quick Game deals one, so
// the host needn't think about it (DEV_PLAN Q10).
// Between matches both players see the room (R7): both cards, `[Card] vs
// [Card]`, each with its Ready mark and games won, and the choice with its
// full rules, which the host can change. A match starts once both are ready
// (room.js), and after it both are back in the room. A page reloaded
// mid-match picks its match back up (D49).
//
// Left out of the artifact build (tools/build-artifact.mjs), where there's
// no multiplayer (R4.6, D2).

import { createTransport, cleanCode } from './transport.js';
import { createSession, savedSession, forgetSession } from './session.js';
import { newRoom, setReady, setChoice, toggleSpice, bothReady, started, newGuest, tally, checkRoom } from './room.js';
import { DICE_SETS } from '../rules/dice-sets.js';
import { testBenchSpice, dealStack } from '../rules/draft.js';
import { canStack, clashWith } from '../rules/stacking.js';
import { diceSetCard, spiceCard, renderCard } from '../cards.js';
import { looksOf } from '../profile.js';
import { randomSeed, createRng } from '../rng.js';

// Not offered in multiplayer: No Man's Land needs both handfuls in one
// simulation, thrown at once, and throws here are independent (D48).
const SOLO_ONLY = new Set(['no-mans-land']);

/** The Spice the host may choose for `diceSet`: its own first, as on the test bench. */
const spiceFor = (diceSet) => testBenchSpice(diceSet).filter((spice) => !SOLO_ONLY.has(spice.id));

export function createLobby({ hud, game, profiles }) {
  const $ = (id) => document.getElementById(id);
  const netBtn = $('netBtn');
  const menuCard = $('netMenu');
  const menuStatus = $('netMenuStatus');
  const codeInput = /** @type {HTMLInputElement} */ ($('netCodeInput'));
  const roomCard = $('netRoom');
  const roomStep = $('netRoomStep');
  const hostOnly = $('netHostOnly');
  const roomCode = $('netRoomCode');
  const roomLink = /** @type {HTMLInputElement} */ ($('netRoomLink'));
  const roomStatus = $('netRoomStatus');
  const roomCards = $('netRoomCards');
  const backBtn = $('netRoomBack');
  const changeBtn = $('netChangeBtn');
  const readyBtn = /** @type {HTMLButtonElement} */ ($('netReadyBtn'));
  const seats = {
    me: { el: $('netMe'), ready: $('netMeReady'), wins: $('netMeWins') },
    them: { el: $('netThem'), name: $('netThemName'), ready: $('netThemReady'), wins: $('netThemWins') },
  };

  /** @type {ReturnType<typeof createSession> | null} */
  let session = null;
  // The room (room.js): the host's own, or the guest's copy of it, once
  // one has come (`heard`).
  let room = newRoom();
  let heard = false;
  // The host's matches, counted, and the last whose result is in the count.
  let matches = 0;
  let counted = 0;
  let playing = false;
  // The host is choosing new dice or Spice: no match starts meanwhile.
  let choosing = false;
  // What the room says above the cards, when it's more than who's ready.
  let note = '';

  const nameOf = () => session?.them?.name ?? 'Your friend';
  const isHost = () => session?.seat === 'host';
  const mySeat = () => session?.seat ?? 'host';
  const theirSeat = () => (mySeat() === 'host' ? 'guest' : 'host');
  /** The choice's dice set and Spice stack, if this version of the game has them all and they stack. */
  const known = (choice) => {
    const diceSet = choice && DICE_SETS[choice.diceSet];
    if (!diceSet) return null;
    const allowed = spiceFor(choice.diceSet);
    const spices = choice.spices.map((id) => allowed.find((sp) => sp.id === id));
    if (!spices.length || !spices.every(Boolean)) return null;
    if (spices.length > 1 && !canStack(choice.spices, choice.diceSet)) return null;
    return { diceSet, spices };
  };

  function showMenu(status) {
    menuStatus.textContent = status ?? '';
    menuStatus.hidden = !status;
    hud.showMenuCard(menuCard, () => hud.showMenu());
  }

  function leave(status) {
    session?.leave();
    session = null;
    room = newRoom();
    heard = false;
    playing = false;
    choosing = false;
    note = '';
    if (status === undefined) hud.showMenu();
    else showMenu(status);
  }

  /** A new session, listening for what happens outside a match. */
  function newSession() {
    const s = createSession(createTransport(), profiles.get());
    const mine = (fn) => (payload) => { if (s === session) fn(payload); };
    // A new guest starts from 0-0 (D50); one coming back keeps the count.
    s.on('joined', mine(() => {
      if (s.seat === 'host') room = newGuest(room);
      note = '';
      render();
    }));
    // The room goes to the guest on every hello, so one back after a
    // dropped link or a reload has it too.
    s.on('back', mine(() => { if (s.seat === 'host') update(room); }));
    s.on('room', mine((r) => {
      room = checkRoom(r);
      heard = true;
      render();
    }));
    s.on('ready', mine((on) => { if (!playing) update(setReady(room, 'guest', on)); }));
    s.on('profile', mine(() => render()));
    s.on('start', mine((start) => { if (!playing) begin(start); }));
    // A game won (R7.3), counted by the host as the match ends, so the
    // guest's room has the new count by the time its card has gone.
    s.on('ended', mine(({ n, result }) => {
      if (s.seat !== 'host' || n <= counted) return;
      counted = n;
      update(tally(room, result));
    }));
    s.on('left', mine((reason) => {
      if (playing) return;
      if (s.seat === 'host') {
        note = `${reason === 'full' ? 'Somebody' : nameOf()} left.`;
        update(setReady(room, 'guest', false));
      } else {
        leave(reason === 'full' ? 'That room already has two players in it.' : 'The host closed the room.');
      }
    }));
    s.on('failed', mine((err) => leave(err.message)));
    s.on('status', mine((status) => {
      if (playing) return;
      if (status === 'lost') note = 'Connection lost. Trying to reconnect…';
      if (status === 'open') note = '';
      render();
      maybeStart();
    }));
    return s;
  }

  // ---------- The room ----------

  /** The host's room changed: the guest is told, and a match starts if both are ready. */
  function update(next) {
    room = next;
    if (isHost()) session.lobby = room;
    render();
    maybeStart();
  }

  function maybeStart() {
    if (!isHost() || playing || choosing || !session.them || session.status !== 'open' || !bothReady(room)) return;
    matches = Math.max(matches, session.matchNumber) + 1;
    // Mid-edit, what the host had is kept, and the guest told before the match.
    if (game.saveEdits()) session.setProfile(profiles.get());
    const start = { n: matches, config: { seed: randomSeed(), ...room.choice } };
    room = started(room);
    session.lobby = room;
    session.start(start.n, start.config);
    begin(start);
  }

  /** Brings the room's card in line with the room (`show` puts it on screen). */
  function render() {
    if (!session) return;
    const host = isHost();
    const them = session.them;
    const code = session.code;
    roomStep.textContent = host ? 'Your room' : `Room ${code ?? ''}`;
    hostOnly.hidden = !host;
    roomCode.textContent = code ?? '·····';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    if (code) url.searchParams.set('join', code);
    // Two tabs on one machine, for testing, stay on the local transport.
    if (new URLSearchParams(window.location.search).get('net') === 'local') url.searchParams.set('net', 'local');
    roomLink.value = code ? url.href : '';

    // Both cards (R7.1), each with its Ready mark (R7.2) and games won (R7.3).
    hud.showRoomPlayer('me', looksOf(profiles.get()));
    seats.them.el.classList.toggle('empty', !them);
    if (them) hud.showRoomPlayer('them', looksOf(them));
    else seats.them.name.textContent = host ? 'Waiting for a friend to join…' : 'Waiting for the host…';
    const showSeat = ({ ready, wins }, seat) => {
      const on = room.ready[seat];
      ready.textContent = on ? 'Ready' : 'Not ready';
      ready.classList.toggle('on', on);
      const n = room.wins[seat];
      wins.textContent = `${n} ${n === 1 ? 'game' : 'games'} won`;
    };
    showSeat(seats.me, mySeat());
    showSeat(seats.them, theirSeat());
    seats.them.wins.hidden = !them;

    // The dice, then every Spice the host last chose, those switched off
    // greyed out: the host taps one to switch it off or on again.
    const chosen = known(room.choice);
    const pool = chosen ? spiceFor(room.choice.diceSet).filter((sp) => room.pool.includes(sp.id)) : [];
    const shown = chosen ? [...new Set([...pool, ...chosen.spices.filter((sp) => sp.id !== 'vanilla' || !pool.length)])] : [];
    roomCards.replaceChildren(...(chosen ? [renderCard(diceSetCard(chosen.diceSet), { full: true })] : []),
      ...shown.map((sp) => {
        const toggles = host && room.pool.includes(sp.id);
        const el = renderCard(spiceCard(sp), { full: true, onPick: toggles ? (id) => update(toggleSpice(room, id)) : undefined });
        el.classList.toggle('off', !room.choice.spices.includes(sp.id));
        if (toggles) el.title = room.choice.spices.includes(sp.id) ? 'Tap to switch it off' : 'Tap to switch it on again';
        return el;
      }));

    const mineOn = room.ready[mySeat()];
    const theirsOn = room.ready[theirSeat()];
    let status = note;
    if (!status) {
      if (!host && !heard) status = them ? `Waiting for ${nameOf()} to choose the dice…` : 'Joining…';
      else if (room.choice && !chosen) status = 'The host chose something this version of the game doesn\'t have. Both reload the page and try again.';
      else if (!them) status = 'Send a friend the link, or the code.';
      else if (mineOn && theirsOn) status = 'Starting…';
      else if (mineOn) status = `Waiting for ${nameOf()} to be ready…`;
      else if (theirsOn) status = `${nameOf()} is ready. Are you?`;
      else status = host ? `Press Ready when you are. You can still change the dice and Spice${room.pool.length > 1 ? ', or tap a Spice to switch it off or on' : ''}.` : 'Read the rules, then press Ready.';
    }
    roomStatus.textContent = status;

    backBtn.textContent = host ? '← Close the room' : '← Leave';
    changeBtn.hidden = !host;
    readyBtn.disabled = !chosen || (!host && !heard);
    readyBtn.textContent = mineOn ? 'Not ready' : 'Ready';
    readyBtn.setAttribute('aria-pressed', String(mineOn));
    readyBtn.classList.toggle('secondary', mineOn);
    mirrorButtons();
  }

  // The room's buttons again at its top, so they're at hand on a phone
  // without scrolling past the cards: each a copy of one at the bottom,
  // kept in step with it, a tap on it a tap on that one.
  const bottomRow = backBtn.parentElement;
  const topRow = bottomRow.cloneNode(true);
  topRow.classList.add('net-buttons-top');
  for (const copy of topRow.querySelectorAll('[id]')) copy.id += 'Top';
  roomStep.after(topRow);
  const mirrors = [...bottomRow.children].map((btn, i) => {
    const copy = topRow.children[i];
    copy.addEventListener('click', () => btn.click());
    return [btn, copy];
  });
  function mirrorButtons() {
    for (const [btn, copy] of mirrors) {
      copy.textContent = btn.textContent;
      copy.hidden = btn.hidden;
      copy.disabled = btn.disabled;
      copy.className = btn.className;
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed !== null) copy.setAttribute('aria-pressed', pressed);
    }
    topRow.classList.add('net-buttons-top');
  }

  // Tapping your own card edits your profile, without leaving the room.
  const myCard = seats.me.el.querySelector('.player-card');
  function editMe() {
    if (!session || playing) return;
    game.openEditor({ onDone: () => {
      session?.setProfile(profiles.get());
      if (session && !playing) show();
    } });
  }
  myCard.addEventListener('click', editMe);
  myCard.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editMe(); } });

  function show() {
    render();
    hud.showMenuCard(roomCard, () => leave());
  }

  // ---------- Hosting ----------

  /**
   * The host picks the dice, then a Spice stack (D51): dealt to start with,
   * as Quick Game deals one, or the one already chosen for the same dice;
   * "Deal again" for another. `then` goes on from there with the choice.
   */
  function choose(then, onBack) {
    const rng = createRng(randomSeed());
    const deal = (diceSet) => dealStack(diceSet, rng, { without: [...SOLO_ONLY] }).filter((id) => id !== 'vanilla');
    const pickDice = () => hud.showPicker('Play a friend: choose the dice',
      Object.values(DICE_SETS).map(diceSetCard), pickSpice, onBack);
    const pickSpice = (diceSet) => hud.showStackPicker({
      title: `Play a friend: Spice for ${DICE_SETS[diceSet].name}`,
      cards: spiceFor(diceSet).filter((sp) => sp.id !== 'vanilla').map(spiceCard),
      picked: room.choice?.diceSet === diceSet ? room.choice.spices.filter((id) => id !== 'vanilla') : deal(diceSet),
      clash: (picked, id) => clashWith(picked, id, diceSet),
      start: 'Choose',
      deal: () => deal(diceSet),
      onStart: (spices) => then({ diceSet, spices: spices.length ? spices : ['vanilla'] }),
      onBack: pickDice,
    });
    pickDice();
  }

  async function host(choice) {
    session = newSession();
    const s = session;
    room = newRoom(choice);
    matches = 0;
    counted = 0;
    note = 'Opening your room…';
    show();
    try {
      await s.host();
    } catch (err) {
      if (s === session) leave(err.message);
      return;
    }
    if (s !== session) return;
    note = '';
    render();
  }

  // ---------- Joining ----------

  async function join(code) {
    session = newSession();
    const s = session;
    room = newRoom();
    heard = false;
    show();
    roomStep.textContent = `Room ${code}`;
    try {
      await s.join(code);
    } catch (err) {
      if (s === session) leave(err.kind === 'missing' ? `No game with the code ${code}. Check it and try again.` : err.message);
      return;
    }
    if (s === session) render();
  }

  // ---------- Playing ----------

  /** Starts match `n` on `config`, on this screen. */
  function begin({ n, config }) {
    // Mid-edit, what this player had is kept (the host's, already, in maybeStart).
    if (game.saveEdits()) session.setProfile(profiles.get());
    playing = true;
    note = '';
    if (!isHost()) room = started(room);
    game.startNet(session.startMatch(n, config), session, { onOver: over });
  }

  function over({ left }) {
    playing = false;
    if (left || !session || session.status === 'closed') {
      leave(left ? undefined : 'The room has closed.');
      return;
    }
    show();
  }

  /** Back into the match this tab was playing before it reloaded (D49). */
  async function resume(saved) {
    session = newSession();
    const s = session;
    const { diceSet, spice, spices = [spice] } = saved.match.config;
    if (saved.seat === 'host') {
      room = saved.lobby ? checkRoom(saved.lobby) : newRoom({ diceSet, spices });
      matches = saved.match.n;
      counted = saved.match.n - 1;
    } else {
      room = newRoom({ diceSet, spices });
      heard = true;
    }
    note = 'Getting back into your match…';
    show();
    roomStep.textContent = `Room ${saved.code}`;
    try {
      const { ended } = await s.resume(saved);
      if (s !== session) return;
      if (ended) {
        forgetSession();
        const won = ended.winner === saved.seat;
        leave(won ? 'The match was over by the time you got back: you won it.' : 'You were away too long: the match was given away.');
        return;
      }
      playing = true;
      note = '';
      game.startNet(s.resumedMatch(), s, { restore: true, onOver: over });
    } catch (err) {
      if (s === session) {
        forgetSession();
        leave(`Couldn't get back into the match. ${err.message}.`);
      }
    }
  }

  // ---------- Wiring ----------

  netBtn.hidden = false;
  hud.onLoaded(() => {
    netBtn.disabled = false;
    const saved = savedSession();
    const code = cleanCode(new URLSearchParams(window.location.search).get('join'));
    if (saved) resume(saved);
    else if (code) join(code);
  });
  netBtn.addEventListener('click', () => showMenu());
  $('netMenuBack').addEventListener('click', () => hud.showMenu());
  $('netHostBtn').addEventListener('click', () => choose(host, () => showMenu()));
  $('netJoinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = cleanCode(codeInput.value);
    if (!code) {
      showMenu('A room code is five letters and numbers, like K7QXM.');
      return;
    }
    join(code);
  });
  backBtn.addEventListener('click', () => leave());
  // The Ready marks stay as they are (D50): a ready guest plays whatever
  // the host settles on, and sees it change meanwhile.
  changeBtn.addEventListener('click', () => {
    choosing = true;
    const done = () => {
      choosing = false;
      if (!session) return;
      show();
      maybeStart();
    };
    choose((choice) => {
      room = setChoice(room, choice);
      if (session) session.lobby = room;
      done();
    }, done);
  });
  readyBtn.addEventListener('click', () => {
    if (!session || playing || readyBtn.disabled) return;
    const on = !room.ready[mySeat()];
    if (isHost()) {
      update(setReady(room, 'host', on));
    } else {
      // Shown at once; the host's room, when it comes, has the last word.
      room = setReady(room, 'guest', on);
      session.ready(on);
      render();
    }
  });
  $('netCopyBtn').addEventListener('click', async () => {
    const btn = $('netCopyBtn');
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Super Rollies', text: 'Roll me for it!', url: roomLink.value });
        return;
      }
      await navigator.clipboard.writeText(roomLink.value);
      btn.textContent = 'Copied!';
    } catch {
      roomLink.select();
      btn.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
  });

  return {
    /** The session, for tests. */
    get session() { return session; },
    get choice() { return room.choice; },
    /** The room as this screen has it: the choice, Ready marks and games won. */
    get room() { return room; },
  };
}
