// Two players in one browser: a host and a guest, each its own page, linked
// by the local transport (?net=local, a BroadcastChannel), play matches
// against each other (docs/decisions.md D48, D49).
//
//   node tools/phase0/check-multiplayer.mjs [label]
//
// Needs the dev server (npm run dev). The checks are also run by verify.mjs;
// this file is where they live, so they can be run on their own while
// working on multiplayer.

import { chromium } from 'playwright';
import { BASE_URL, dieScreenPos, drag } from './driver.mjs';

export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 844 };

/**
 * A host and a guest, in one browser so the local transport reaches between
 * them, each with a name of its own. Resolves once both are in the room.
 */
export async function openRoom({ viewport = DESKTOP, guestViewport = viewport, hostName = 'Hosty', guestName = 'Guesty' } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  const open = async (name, size) => {
    const page = await context.newPage();
    await page.setViewportSize(size);
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    return page;
  };
  const host = await open('host', viewport);
  const guest = await open('guest', guestViewport);
  // Each its own profile, so their cards tell them apart.
  for (const [page, name] of [[host, hostName], [guest, guestName]]) {
    await page.goto(`${BASE_URL}?net=local`);
    await page.evaluate((n) => window.superRollies.profiles.save({ ...window.superRollies.profiles.get(), name: n }), name);
  }
  return { browser, context, host, guest, errors };
}

/** The host opens a room for `diceSet` with `spice`; resolves with its code. */
export async function hostRoom(host, diceSet = 'classic', spice = 'vanilla') {
  await host.waitForSelector('#netBtn:not([disabled])', { timeout: 30000 });
  await host.click('#netBtn');
  await host.click('#netHostBtn');
  await host.click(`#pickerOptions [data-pick="${diceSet}"]`);
  await host.click(`#pickerOptions [data-pick="${spice}"]`);
  await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.getElementById('netRoomCode').textContent));
  return host.textContent('#netRoomCode');
}

/** The guest joins room `code` by its link and accepts what's offered. */
export async function joinRoom(guest, code) {
  await guest.goto(`${BASE_URL}?net=local&join=${code}`);
  await guest.waitForSelector('#netAcceptBtn:not([hidden])', { timeout: 30000 });
  await guest.click('#netAcceptBtn');
}

/** Waits for a page's match to be under way and its dice to be grabbable. */
export async function waitToThrow(page, timeout = 15000) {
  await page.waitForFunction(() => window.superRollies.game.canGrab(), null, { timeout });
}

/** Throws the page's dice once they can be picked up. */
export async function throwNow(page) {
  await waitToThrow(page);
  return drag(page, 0, -260, 8, await dieScreenPos(page));
}

const roundsOf = (page) => page.evaluate(() => window.superRollies.rounds.length);
const stateOf = (page) => page.evaluate(() => window.superRollies.game.state);

/**
 * Both throw, in the order given (or together), until `rounds` rounds have
 * been played or the match is over. Resolves with each page's rounds.
 */
export async function playRounds(host, guest, rounds = 99, order = 'together') {
  for (let r = 0; r < rounds; r++) {
    const before = await roundsOf(host);
    if (await stateOf(host) !== 'playing') break;
    if (order === 'host-first') {
      await throwNow(host);
      await throwNow(guest);
    } else if (order === 'guest-first') {
      await throwNow(guest);
      await throwNow(host);
    } else {
      await Promise.all([throwNow(host), throwNow(guest)]);
    }
    await Promise.all([host, guest].map((page) => page.waitForFunction(
      (n) => window.superRollies.rounds.length > n || window.superRollies.game.state !== 'playing', before, { timeout: 20000 })));
  }
  const read = (page) => page.evaluate(() => window.superRollies.rounds.map((r) => ({
    winner: r.outcome.winner, matchWinner: r.outcome.matchWinner, scores: r.outcome.scores, faces: r.outcome.faces,
  })));
  return { host: await read(host), guest: await read(guest) };
}

/**
 * Plays one page's side of a match on its own, answering whatever its
 * screen waits on: a throw (thrown with a drag `dx` across), dice to pick
 * for a redraw (`pick`: 'keep' them all, or throw 'one'), a re-throw on offer
 * (`rethrow`: take it or not). Resolves once the match is over there.
 */
export async function bot(page, { dx = 0, pick = 'keep', rethrow = false, timeout = 120000 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = await page.evaluate(() => {
      const { game } = window.superRollies;
      return { state: game.state, awaiting: game.awaiting, offered: game.offered, canGrab: game.canGrab() };
    });
    if (s.state !== 'playing') return s.state;
    if (s.offered) {
      if (rethrow) await page.click('#rethrowBtn');
      else await page.evaluate(() => window.superRollies.game.onBoardTap());
    } else if (s.awaiting === 'pick' && s.canGrab) {
      if (pick === 'keep') await page.click('#rethrowBtn');
      else await drag(page, dx, -200, 8, await dieScreenPos(page, 'player', 0));
    } else if (s.canGrab) {
      await drag(page, dx, -260, 8, await dieScreenPos(page));
    }
    await page.waitForTimeout(150);
  }
  throw new Error('the match never ended');
}

/** Each page's rounds, as the outcome says. */
export async function roundsSeen(host, guest) {
  const read = (page) => page.evaluate(() => window.superRollies.rounds.map((r) => ({
    winner: r.outcome.winner, matchWinner: r.outcome.matchWinner, scores: r.outcome.scores, faces: r.outcome.faces,
    // Throws after the first (a paw, a redraw, doubles, a re-throw).
    extra: r.throws.length - 1,
  })));
  return { host: await read(host), guest: await read(guest) };
}

/** What the card says, headline and detail, on one line. */
export const cardText = (page) => page.evaluate(() => ['resultHeadline', 'resultDetail']
  .map((id) => document.getElementById(id).textContent.trim()).filter(Boolean).join(' '));

const swap = (side) => ({ player: 'opponent', opponent: 'player' }[side] ?? side);

/** Whether the guest saw every round as the host did, turned round. */
export function agree(rounds) {
  if (rounds.host.length !== rounds.guest.length) return `host played ${rounds.host.length} rounds, guest ${rounds.guest.length}`;
  for (let i = 0; i < rounds.host.length; i++) {
    const h = rounds.host[i];
    const g = rounds.guest[i];
    if (swap(h.winner) !== g.winner || swap(h.matchWinner) !== g.matchWinner
      || h.scores.player !== g.scores.opponent || h.scores.opponent !== g.scores.player
      || h.faces.player.join() !== g.faces.opponent.join()) {
      return `round ${i + 1}: host ${JSON.stringify(h)}, guest ${JSON.stringify(g)}`;
    }
  }
  return null;
}

/** Runs `fn` with a fresh room, unless `label` is filtered out by `only`; closes it after. */
async function withRoom(label, only, report, fn, options = {}) {
  if (only && !label.includes(only)) return;
  const room = await openRoom(options);
  try {
    await fn(room);
  } catch (e) {
    report(label, false, e.message.split('\n')[0]);
  }
  if (room.errors.length) report(`${label}: no page errors`, false, room.errors.slice(0, 3).join(' | '));
  await room.browser.close();
}

/** The multiplayer checks; `report(name, ok, detail)` as in verify.mjs. */
export async function multiplayerChecks(report, only) {
  await withRoom('multiplayer: a match', only, report, async ({ host, guest }) => {
    const code = await hostRoom(host);
    await joinRoom(guest, code);
    const rounds = await playRounds(host, guest);
    const problem = agree(rounds);
    report('Multiplayer: a match plays to the end, both screens agreeing on every round',
      !problem && Boolean(rounds.host.at(-1)?.matchWinner), problem ?? `${rounds.host.length} rounds`);
  });

  // Each side's throw is shown on the other screen turned round (D48): the
  // other player's dice lie in the far half, and each shows on top the face
  // the round was decided by. On a phone too, the guest's screen narrower.
  await withRoom('multiplayer: far half', only, report, async ({ host, guest }) => {
    await joinRoom(guest, await hostRoom(host, 'greatsword'));
    await Promise.all([throwNow(host), throwNow(guest)]);
    await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.superRollies.rounds.length > 0)));
    for (const [name, page] of [['host', host], ['guest', guest]]) {
      const seen = await page.evaluate(async () => {
        const { readFace } = await import('/src/replay.js');
        const { dice, rounds } = window.superRollies;
        const { faces } = rounds.at(-1).outcome;
        return ['player', 'opponent'].map((side) => ({
          side,
          far: dice[side].every((d) => (side === 'player' ? d.mesh.position.z > 0 : d.mesh.position.z < 0)),
          shown: dice[side].map((d) => readFace(d.type, d.mesh.quaternion.toArray())).join(),
          read: faces[side].join(),
        }));
      });
      const bad = seen.filter((s) => !s.far || s.shown !== s.read);
      report(`Multiplayer (${name}): each side's dice in its own half, showing the faces the round was decided by`,
        !bad.length, JSON.stringify(bad.length ? bad : seen));
    }
  }, { guestViewport: PHONE });

  // Once one has thrown, the other has 30 s, or loses by walkover (D48).
  await withRoom('multiplayer: walkover', only, report, async ({ host, guest }) => {
    await joinRoom(guest, await hostRoom(host));
    await throwNow(host);
    await guest.waitForFunction(() => /Your throw · \d+ s/.test(document.getElementById('netStatus').textContent));
    // The host's dice settle, then the card says who's awaited.
    const waiting = await host.waitForFunction(() => /^Waiting/.test(document.getElementById('resultHeadline').textContent),
      null, { timeout: 8000 }).then(() => cardText(host), () => cardText(host));
    await host.waitForFunction(() => /walkover/.test(document.getElementById('resultHeadline').textContent), null, { timeout: 45000 });
    const said = { host: await cardText(host), guest: await cardText(guest) };
    report('Multiplayer: a player who doesn\'t throw within 30 s of the other loses by walkover',
      /^Waiting for Guesty… \d+ s left to throw\.$/.test(waiting) && /You win by walkover.*Guesty didn't throw in time/.test(said.host)
        && /You lose by walkover.*You didn't throw in time/.test(said.guest),
      `waiting card "${waiting}"; host "${said.host}"; guest "${said.guest}"`);
  });

  // Leaving mid-match gives it away at once.
  await withRoom('multiplayer: leaving', only, report, async ({ host, guest }) => {
    await joinRoom(guest, await hostRoom(host));
    await Promise.all([throwNow(host), throwNow(guest)]);
    await guest.waitForFunction(() => window.superRollies.rounds.length > 0);
    await guest.click('#backBtn');
    await host.waitForFunction(() => /walkover/.test(document.getElementById('resultHeadline').textContent), null, { timeout: 15000 });
    const said = await cardText(host);
    report('Multiplayer: leaving a match gives the other player a walkover', /You win by walkover.*left the match/.test(said), said);
  });

  // A page reloaded mid-match catches up from the log and carries on (D49):
  // the guest after the host has thrown its next round, then the host.
  for (const who of ['guest', 'host']) {
    await withRoom(`multiplayer: ${who} reloads`, only, report, async (room) => {
      const { host, guest } = room;
      await joinRoom(guest, await hostRoom(host, 'greatsword'));
      await Promise.all([throwNow(host), throwNow(guest)]);
      await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.superRollies.rounds.length > 0
        || window.superRollies.game.state !== 'playing')));
      const reloading = room[who];
      const staying = who === 'guest' ? host : guest;
      // Whoever stays throws the next round; then the other reloads.
      await bot(staying, { timeout: 3000 }).catch(() => {});
      await reloading.reload();
      await reloading.waitForFunction(() => window.superRollies.game.net?.n === 1 && !window.superRollies.game.net.restoring,
        null, { timeout: 30000 });
      const caughtUp = await reloading.evaluate(() => window.superRollies.rounds.length);
      const ends = await Promise.all([bot(host, { dx: -40 }), bot(guest, { dx: 50 })]);
      const rounds = await roundsSeen(host, guest);
      // The reloaded page only has the rounds since it caught up: compare those.
      const offset = rounds[who === 'guest' ? 'host' : 'guest'].length - rounds[who].length;
      const trimmed = who === 'guest' ? { host: rounds.host.slice(offset), guest: rounds.guest } : { host: rounds.host, guest: rounds.guest.slice(offset) };
      const problem = offset !== 0 ? `${offset} rounds missing after the reload` : agree(trimmed);
      report(`Multiplayer: the ${who} reloads mid-match, catches up and plays on to the end, both agreeing`,
        !problem && Boolean(rounds.host.at(-1)?.matchWinner),
        problem ?? `caught up on ${caughtUp} round(s), ${rounds.host.length} in all, ended ${ends.join('/')}`);
    });
  }

  // A player who closes the tab and doesn't come back: 30 s after the link
  // goes quiet, the one still there wins (D49).
  await withRoom('multiplayer: gone', only, report, async ({ host, guest }) => {
    await joinRoom(guest, await hostRoom(host));
    await Promise.all([throwNow(host), throwNow(guest)]);
    await host.waitForFunction(() => window.superRollies.rounds.length > 0);
    await guest.close();
    await host.waitForFunction(() => document.getElementById('resultHeadline').textContent === 'Connection lost', null, { timeout: 15000 });
    await host.waitForFunction(() => /walkover/.test(document.getElementById('resultHeadline').textContent), null, { timeout: 45000 });
    const said = await cardText(host);
    report('Multiplayer: a player who drops and doesn\'t come back within 30 s loses by walkover',
      /You win by walkover.*didn't come back/.test(said), said);
  });

  // After a match, the host's room offers the guest the same again.
  await withRoom('multiplayer: rematch', only, report, async ({ host, guest }) => {
    await joinRoom(guest, await hostRoom(host));
    await Promise.all([bot(host, { dx: -40 }), bot(guest, { dx: 50 })]);
    await guest.waitForSelector('#netAcceptBtn:not([hidden])', { timeout: 20000 });
    const title = await guest.textContent('#netInviteTitle');
    await guest.click('#netAcceptBtn');
    await host.waitForFunction(() => window.superRollies.game.net?.n === 2 && window.superRollies.game.state === 'playing', null, { timeout: 15000 });
    await Promise.all([bot(host, { dx: -40 }), bot(guest, { dx: 50 })]);
    const problem = agree(await roundsSeen(host, guest));
    report('Multiplayer: after a match the guest is offered another, and it plays out agreeing too',
      title === 'Hosty wants another game' && !problem, problem ?? `invite said "${title}"`);
  });

  // Every Spice that waits on a player, or simulates or draws on the table
  // differently from each end, played out by two bots (D48): the two screens
  // must agree on every round, and every throw must land the same on both
  // (a disagreement ends the match "out of sync").
  // Those marked `fires` are played again (up to 4 matches) until the Spice
  // has made at least one throw beyond the round's first, so the check
  // always covers it: a paw's swipe, a re-throw taken, a redraw, doubles.
  const SPICED = [
    ['cat-paw', 'classic', { fires: true }], ['pothole', 'classic'], ['gusty-table', 'classic'], ['tug-of-war', 'classic'],
    ['exploding-dice', 'classic'], ['underdog', 'classic'], ['burnout', 'fireball'], ['wild-magic', 'percentile'],
    ['doubles-again', 'greatsword', { fires: true }],
    ['second-wind', 'classic', { fires: true, rethrow: true }], ['mercy', 'classic', { rethrow: true }],
    ['draw-poker', 'dice-poker', { fires: true, pick: 'one' }, { pick: 'keep' }],
  ];
  for (const [spice, diceSet, { fires = false, ...hostPlay } = {}, guestPlay = hostPlay] of SPICED) {
    await withRoom(`multiplayer: ${spice}`, only, report, async ({ host, guest }) => {
      await joinRoom(guest, await hostRoom(host, diceSet, spice));
      let detail;
      for (let n = 1; ; n++) {
        const ends = await Promise.all([bot(host, { dx: -40, ...hostPlay }), bot(guest, { dx: 50, ...guestPlay })]);
        const rounds = await roundsSeen(host, guest);
        const problem = agree(rounds);
        const said = await host.textContent('#resultHeadline');
        const extra = rounds.host.reduce((sum, r) => sum + r.extra, 0);
        const ok = !problem && Boolean(rounds.host.at(-1)?.matchWinner) && !/sync/i.test(said);
        detail = problem ?? `match ${n}: ${rounds.host.length} rounds, ${extra} extra throws, ended ${ends.join('/')}, "${said}"`;
        if (!ok || !fires || extra > 0 || n === 4) {
          report(`Multiplayer, ${spice} (${diceSet}): played to the end, both screens agreeing${fires ? ', the Spice having acted' : ''}`,
            ok && (!fires || extra > 0), detail);
          return;
        }
        // The same again: the host's room offers it once the card's gone.
        await guest.waitForSelector('#netAcceptBtn:not([hidden])', { timeout: 20000 });
        await guest.click('#netAcceptBtn');
        await host.waitForFunction((m) => window.superRollies.game.net?.n === m && window.superRollies.game.state === 'playing',
          n + 1, { timeout: 15000 });
      }
    });
  }
}

// Run on its own.
if (process.argv[1]?.endsWith('check-multiplayer.mjs')) {
  let failures = 0;
  await multiplayerChecks((name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
  }, process.argv[2]);
  process.exit(failures ? 1 : 0);
}
