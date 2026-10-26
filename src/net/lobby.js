// Multiplayer's menus: hosting a room and choosing what's played in it,
// joining one, and what each player sees between matches.
//
// The host picks the dice and Spice from the full catalogue (docs/spec.md
// R4.2, docs/decisions.md D3), bar what can't be played over the network;
// the guest sees the choice with its full rules and accepts it, and the
// match starts on both screens. After it, the host's room invites the guest
// to the same again, or the host changes the choice. A page reloaded
// mid-match picks its match back up (D49).
//
// Left out of the artifact build (tools/build-artifact.mjs), where there's
// no multiplayer (R4.6, D2).

import { createTransport, cleanCode } from './transport.js';
import { createSession, savedSession, forgetSession } from './session.js';
import { DICE_SETS } from '../rules/dice-sets.js';
import { testBenchSpice } from '../rules/draft.js';
import { diceSetCard, spiceCard, renderCard } from '../cards.js';
import { randomSeed } from '../rng.js';

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
  const roomCode = $('netRoomCode');
  const roomLink = /** @type {HTMLInputElement} */ ($('netRoomLink'));
  const roomStatus = $('netRoomStatus');
  const roomCards = $('netRoomCards');
  const inviteCard = $('netInvite');
  const inviteStep = $('netInviteStep');
  const inviteTitle = $('netInviteTitle');
  const inviteCards = $('netInviteCards');
  const inviteStatus = $('netInviteStatus');
  const acceptBtn = $('netAcceptBtn');

  /** @type {ReturnType<typeof createSession> | null} */
  let session = null;
  // The host's choice ({ diceSet, spice }), and its matches, counted.
  let choice = null;
  let matches = 0;
  // The match offered and not yet accepted: the host's sent, or the guest's received.
  let offered = null;
  let playing = false;

  const nameOf = () => session?.them?.name ?? 'Your friend';

  function showMenu(status) {
    menuStatus.textContent = status ?? '';
    menuStatus.hidden = !status;
    hud.showMenuCard(menuCard, () => hud.showMenu());
  }

  function leave(status) {
    session?.leave();
    session = null;
    choice = null;
    offered = null;
    playing = false;
    if (status === undefined) hud.showMenu();
    else showMenu(status);
  }

  /** A new session, listening for what happens outside a match. */
  function newSession() {
    const s = createSession(createTransport(), profiles.get());
    s.on('joined', () => { if (s === session && s.seat === 'host' && !playing) welcome(); });
    // An invite that comes while the last match's card is still up waits for it.
    s.on('invite', (invite) => {
      if (s !== session) return;
      offered = invite;
      if (!playing) showInvite(invite);
    });
    s.on('accept', ({ n }) => { if (s === session && offered?.n === n) begin(offered); });
    s.on('left', (reason) => {
      if (s !== session || playing) return;
      if (s.seat === 'host') {
        offered = null;
        showRoom(`${reason === 'full' ? 'Somebody' : nameOf()} left. Waiting for a friend to join…`);
      } else {
        leave(reason === 'full' ? 'That room already has two players in it.' : 'The host closed the room.');
      }
    });
    s.on('failed', (err) => { if (s === session) leave(err.message); });
    s.on('status', (status) => {
      if (s !== session || playing) return;
      if (status === 'lost') setStatus('Connection lost. Trying to reconnect…');
      if (status === 'open') setStatus(s.seat === 'host' ? `${nameOf()} is back.` : `Back. Waiting for ${nameOf()}…`);
    });
    return s;
  }

  const setStatus = (text) => { (session?.seat === 'guest' ? inviteStatus : roomStatus).textContent = text; };

  // ---------- Hosting ----------

  /** The host picks the dice, then the Spice; `then` goes on from there. */
  function choose(then, onBack) {
    const pickDice = () => hud.showPicker('Play a friend: choose the dice',
      Object.values(DICE_SETS).map(diceSetCard), pickSpice, onBack);
    const pickSpice = (diceSet) => hud.showPicker(`Play a friend: Spice for ${DICE_SETS[diceSet].name}`,
      spiceFor(diceSet).map(spiceCard), (spice) => { choice = { diceSet, spice }; then(); }, pickDice);
    pickDice();
  }

  async function host() {
    session = newSession();
    const s = session;
    showRoom('Opening your room…');
    try {
      await s.host();
    } catch (err) {
      if (s === session) leave(err.message);
      return;
    }
    if (s !== session) return;
    showRoom('Waiting for a friend to join…');
  }

  function showRoom(status) {
    const code = session?.code;
    roomCode.textContent = code ?? '·····';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    if (code) url.searchParams.set('join', code);
    // Two tabs on one machine, for testing, stay on the local transport.
    if (new URLSearchParams(window.location.search).get('net') === 'local') url.searchParams.set('net', 'local');
    roomLink.value = code ? url.href : '';
    roomCards.replaceChildren(...(choice
      ? [diceSetCard(DICE_SETS[choice.diceSet]), spiceCard(spiceFor(choice.diceSet).find((sp) => sp.id === choice.spice))]
        .map((card) => renderCard(card, { full: true }))
      : []));
    if (status !== undefined) roomStatus.textContent = status;
    hud.showMenuCard(roomCard, () => leave());
  }

  // A guest has said hello: they're offered the match.
  function welcome() {
    showRoom(`${nameOf()} joined.`);
    invite();
  }

  function invite() {
    if (!session?.them || !choice) return;
    matches = Math.max(matches, session.matchNumber) + 1;
    offered = { n: matches, config: { seed: randomSeed(), ...choice } };
    session.invite(offered.n, offered.config);
    showRoom(`${nameOf()} is reading the rules…`);
  }

  // ---------- Joining ----------

  async function join(code) {
    session = newSession();
    const s = session;
    showInviteCard({ step: `Room ${code}`, title: 'Joining…', status: '' });
    try {
      await s.join(code);
    } catch (err) {
      if (s === session) leave(err.kind === 'missing' ? `No game with the code ${code}. Check it and try again.` : err.message);
      return;
    }
    if (s !== session) return;
    if (!offered) showInviteCard({ step: `Room ${code}`, title: `${nameOf()}'s room`, status: `Waiting for ${nameOf()} to choose the dice…` });
  }

  function showInviteCard({ step, title, cards = [], status, accept = false }) {
    inviteStep.textContent = step;
    inviteTitle.textContent = title;
    inviteCards.replaceChildren(...cards.map((card) => renderCard(card, { full: true })));
    inviteStatus.textContent = status;
    acceptBtn.hidden = !accept;
    hud.showMenuCard(inviteCard, () => leave());
    if (accept) acceptBtn.focus();
  }

  function showInvite({ n, config }) {
    const diceSet = DICE_SETS[config.diceSet];
    const spice = spiceFor(config.diceSet).find((sp) => sp.id === config.spice);
    if (!diceSet || !spice) {
      leave('The host chose something this version of the game doesn\'t have. Both reload the page and try again.');
      return;
    }
    offered = { n, config };
    showInviteCard({
      step: `Room ${session.code}`,
      title: n > 1 ? `${nameOf()} wants another game` : `${nameOf()} invites you to play`,
      cards: [diceSetCard(diceSet), spiceCard(spice)],
      status: '',
      accept: true,
    });
  }

  // ---------- Playing ----------

  /** Starts the match `offered`, on both screens. */
  function begin({ n, config }) {
    offered = null;
    playing = true;
    game.startNet(session.startMatch(n, config), session, { onOver: over });
  }

  function over({ left }) {
    playing = false;
    if (left || !session || session.status === 'closed') {
      leave(left ? undefined : 'The room has closed.');
      return;
    }
    if (session.seat === 'host') {
      showRoom(session.them ? '' : 'Waiting for a friend to join…');
      invite();
    } else if (offered) {
      showInvite(offered);
    } else {
      showInviteCard({ step: `Room ${session.code}`, title: `${nameOf()}'s room`, status: `Waiting for ${nameOf()}…` });
    }
  }

  /** Back into the match this tab was playing before it reloaded (D49). */
  async function resume(saved) {
    session = newSession();
    const s = session;
    if (saved.seat === 'host') {
      choice = { diceSet: saved.match.config.diceSet, spice: saved.match.config.spice };
      matches = saved.match.n;
    }
    showInviteCard({ step: `Room ${saved.code}`, title: 'Getting back into your match…', status: 'Reconnecting…' });
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
  $('netRoomBack').addEventListener('click', () => leave());
  $('netInviteBack').addEventListener('click', () => leave());
  $('netChangeBtn').addEventListener('click', () => choose(() => {
    showRoom();
    invite();
  }, () => showRoom()));
  acceptBtn.addEventListener('click', () => {
    if (!offered || !session) return;
    session.accept(offered.n);
    begin(offered);
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
    get choice() { return choice; },
  };
}
