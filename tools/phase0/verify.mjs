// The checks from CLAUDE.md, run against the real game in a browser.
//
//   node tools/phase0/verify.mjs
//
// Chromium only for now (docs/decisions.md, D14). An engine name as the argument
// (firefox, webkit) runs it elsewhere, for the post-MVP compatibility work.
// A second argument runs only the checks whose label contains it:
//
//   node tools/phase0/verify.mjs chromium "second wind"
//
// Needs the dev server running (npm run dev). Each check gets a fresh match, so
// one that happens to end early can't leave the next on the game-over card.

import { TRAY_DEPTH, TRAY_HALF_WIDTH, DIE_RADIUS, TRAY_COLORS, DICE_COLORS } from '../../src/config.js';
import { DICE_SETS } from '../../src/rules/dice-sets.js';
import { SPICE } from '../../src/rules/spice.js';
import { isEligible, matchConfig, resolveRules, startMatch, beginRound, afterSettle } from '../../src/rules/engine.js';
import { dealDice, dealSpice, testBenchSpice } from '../../src/rules/draft.js';
import { openGame, startQuickGame, startMode, waitForDiceAtRest, dieScreenPos, drag, throwAndWait } from './driver.mjs';

const engine = process.argv[2] ?? 'chromium';
const ONLY = process.argv[3];
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

let failures = 0;
function report(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}

/**
 * Runs `fn` on a fresh page with a match started. `options.pick` is the dice
 * set (Quick Game) or die type (Zen) to choose; see startMode in driver.mjs.
 */
async function withMatch(viewport, label, fn, button = '#quickGameBtn', options) {
  if (ONLY && !label.includes(ONLY)) return;
  const { browser, page, errors } = await openGame(engine, viewport);
  try {
    await startMode(page, button, options);
    await fn(page);
  } catch (e) {
    report(label, false, e.message.split('\n')[0]);
  }
  if (errors.length) report(`${label}: no page errors`, false, errors.join(' | '));
  await browser.close();
}

/** Presses on (x, y) and reports what the card says while held. */
async function pressAt(page, { x, y }) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  const said = await page.textContent('#resultHeadline');
  await page.mouse.up();
  await waitForDiceAtRest(page);
  return said;
}

// A fresh match's die can be picked up straight away, and a fumbled die can
// be caught again while it is still dropping.
await withMatch(DESKTOP, 'grab', async (page) => {
  const said = await pressAt(page, await dieScreenPos(page));
  report('Fresh match: die grabbable on the very first press', said === 'Let go to throw', `card said "${said}"`);

  // Lift it and fumble it (a hold with barely any movement), then grab it
  // again before it lands.
  const p = await dieScreenPos(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y - 2);
  await page.mouse.up();
  const falling = await page.evaluate(() => window.superRollies.roller.busy);
  const caught = await pressAt(page, await dieScreenPos(page));
  report('Fumbled die can be caught mid-fall', falling && caught === 'Let go to throw',
    `${falling ? 'still falling' : 'had already landed'}; card said "${caught}"`);
}, '#quickGameBtn', { waitForRest: false });

// 1. Each die shows its full set of numerals (or pips), and at rest at least
// one squarely faces the camera. And (§8, 6) the face the game read is the one
// whose decal points up - or on a d4, read from its top corner, the number on
// the three numerals round that corner, the highest ones on the die.
const DECALS = { d4: 12, d6: 6, d8: 8, d10: 10, 'd%': 10, d12: 12, d20: 20 };
// How squarely the best decal faces the camera. A d4 has no face on top: the
// three faces you see slope away at 19.5 degrees off upright, and turned with
// the camera between two of them, the better one manages ~0.47.
const FACING = { d4: 0.4 };
const CHECK_1 = [
  ['classic', '#quickGameBtn'], ['fireball', '#quickGameBtn'],
  ['the-whole-bag', '#quickGameBtn'], ['percentile', '#quickGameBtn'], ['die:d6', '#zenBtn'],
];
for (const [set, button] of CHECK_1) {
  await withMatch(DESKTOP, `1 (${set})`, async (page) => {
    const round = await throwAndWait(page);
    const dice = await page.evaluate(() => {
      const { arena, dice } = window.superRollies;
      const view = arena.camera.getWorldDirection(arena.camera.position.clone());
      return [...dice.player, ...dice.opponent].map(({ id, type, mesh }) => {
        const decals = mesh.children.filter((c) => c.type === 'Mesh');
        // A decal faces along its local +Z; facing the camera means pointing
        // against the view direction.
        const facing = decals.map((p) => -p.getWorldDirection(view.clone()).dot(view));
        let top;
        // Cocked against a wall or another die (docs/decisions.md D24): nothing need
        // face the camera squarely, but it must still be read as it lies.
        let cocked = false;
        if (type === 'd4') {
          const height = (p) => p.getWorldPosition(view.clone()).y;
          const highest = [...decals].sort((a, b) => height(b) - height(a)).slice(0, 3).map((p) => p.userData.number);
          top = highest.every((n) => n === highest[0]) ? highest[0] : highest.join('/');
        } else {
          const up = decals.map((p) => p.getWorldDirection(view.clone()).y);
          top = decals[up.indexOf(Math.max(...up))].userData.number;
          cocked = Math.max(...up) < Math.cos(Math.PI / 180);
        }
        return { id, type, count: decals.length, best: Math.max(...facing), top, cocked };
      });
    });
    const read = Object.fromEntries(round.result.dice.map((d) => [d.id, d.face]));
    const bad = dice.filter((d) => d.count !== DECALS[d.type] || (!d.cocked && d.best <= (FACING[d.type] ?? 0.8)) || d.top !== read[d.id]);
    report(`1. ${set}: every die shows all its faces, one squarely facing the camera, and the face read is the one on top`,
      bad.length === 0,
      bad.map((d) => `${d.id}: ${d.count} decals, best facing ${d.best.toFixed(3)}, top ${d.top} read ${read[d.id]}`).join('; ') ||
      `${dice.length} dice${dice.some((d) => d.cocked) ? `, ${dice.filter((d) => d.cocked).length} cocked` : ''}`);
  }, button, { pick: set });
}

// 2. A micro-nudge is refused; a genuine drag throws.
await withMatch(DESKTOP, '2', async (page) => {
  const nudged = await drag(page, 3, -3, 2);
  report('2. micro-nudge refused', nudged === 'Make a proper throw!', `card said "${nudged}"`);
  await waitForDiceAtRest(page);
  const round = await throwAndWait(page, 40, -240);
  report('2. genuine drag throws', !!round?.result, `rolled ${round.result.dice.map((d) => d.face).join(' vs ')}`);
});

// 3. The die is grabbable on the first tap, even when the result card overlaps it.
await withMatch(DESKTOP, '3', async (page) => {
  // Toss the die gently toward the divider, which is where the card sits,
  // until it comes to rest partly under the card announcing the round.
  let tap = null;
  let overlaps = false;
  for (let i = 0; i < 12 && !overlaps; i++) {
    if (await page.locator('#result.game-over').count()) {
      await page.waitForSelector('#menu:not([hidden])');
      await startQuickGame(page);
    }
    // Slow and short: a throw is as hard as the hand moved, so a fast drag
    // would bounce the die off the divider and back towards you.
    const from = await dieScreenPos(page);
    const before = await page.evaluate(() => window.superRollies.rounds.length);
    await drag(page, page.viewportSize().width / 2 - from.x, -90 - (i % 3) * 40, 30);
    await page.waitForFunction((n) => window.superRollies.rounds.length > n, before, { timeout: 15000 });
    const card = await page.locator('#result').boundingBox();
    const die = await dieScreenPos(page);
    // A point that is on the die AND inside the card's box.
    tap = { x: die.x, y: Math.min(die.y, card.y + card.height - 4) };
    // The die is ~45px across its inradius at this size, so 30px from its
    // centre is still squarely on it (and the press itself confirms a hit).
    overlaps = tap.x > card.x && tap.x < card.x + card.width && die.y - tap.y < 30 &&
      !(await page.locator('#result.game-over').count());
  }
  const said = await pressAt(page, tap);
  report('3. grabbable on first tap under the card', overlaps && said === 'Let go to throw',
    `${overlaps ? 'pressed the die through the card' : 'die did NOT end up under the card'}; card said "${said}"`);
});

// 4. On a 390x844 viewport every die is still reachable at its sideways
// limit - for one die, for the largest dice set (8 dice), and for the
// biggest dice (one of each).
for (const set of ['classic', 'fireball', 'the-whole-bag']) {
  await withMatch(PHONE, `4 (${set})`, async (page) => {
    for (const side of [1, -1]) {
      // A hard sideways throw ends up at the sideways limit.
      await throwAndWait(page, side * 400, -40);
      const all = await page.evaluate(() => window.superRollies.dice.player.length);
      const spots = [];
      for (let i = 0; i < all; i++) spots.push(await dieScreenPos(page, 'player', i));
      const offScreen = spots.filter((p) => !(p.x > 0 && p.x < PHONE.width && p.y > 0 && p.y < PHONE.height));
      // The outermost die, pressed: it's the one most likely to be out of reach.
      const outer = spots.reduce((a, b) => (side * b.x > side * a.x ? b : a));
      const said = await pressAt(page, outer);
      report(`4. ${set}: every die reachable at the ${side > 0 ? 'right' : 'left'} limit on 390x844`,
        offScreen.length === 0 && said === 'Let go to throw',
        `${all} dice, ${offScreen.length} off screen; outermost at x=${outer.x.toFixed(0)}px; card said "${said}"`);
      if (await page.locator('#result.game-over').count()) break;
    }
  }, '#quickGameBtn', { pick: set });
}

// 5. A full match runs its win condition to the end (Hearts: a side drained to
// 0), announces the result, and returns to the menu.
await withMatch(DESKTOP, '5', async (page) => {
  let announced = null;
  for (let i = 0; i < 40 && !announced; i++) {
    // Always forward, even when the die rests against the divider: a flick
    // into the wall is still a throw.
    await throwAndWait(page, (i % 5 - 2) * 30, -260);
    if (await page.locator('#result.game-over').count()) announced = await page.textContent('#resultHeadline');
  }
  // A lost heart is .losing while it animates, then .empty.
  const outOfHearts = await page.evaluate(() => ['#youHearts', '#opponentHearts'].some(
    (row) => document.querySelectorAll(`${row} .heart-full.losing, ${row} .heart-full.empty`).length === 3
  ));
  await page.waitForSelector('#menu:not([hidden])', { timeout: 6000 }).catch(() => null);
  const backAtMenu = await page.locator('#menu:not([hidden])').count() === 1;
  report('5. full match runs its win condition to the end and returns to the menu', !!announced && outOfHearts && backAtMenu,
    `"${announced}", ${outOfHearts ? 'a side out of hearts' : 'NO side out of hearts'}, ` +
    `${backAtMenu ? 'back at menu' : 'NOT back at menu'}`);
});

// The match seed decides every random event (R5.2): the same seed throws the
// opponent's die the same way, a different one doesn't.
await withMatch(DESKTOP, 'seed', async (page) => {
  const opponentThrow = async (seed) => {
    await page.evaluate((seed) => window.superRollies.game.start('quick', { seed }), seed);
    await waitForDiceAtRest(page);
    const round = await throwAndWait(page);
    return JSON.stringify(round.record.dice.filter((d) => d.id.startsWith('opponent')));
  };
  const first = await opponentThrow(1234);
  const again = await opponentThrow(1234);
  const other = await opponentThrow(4321);
  report('Same seed, same opponent throw; another seed, another throw', first === again && first !== other);
});

// Handfuls (R2.3-R2.5): every die is picked up in one grab, thrown together,
// and the result card adds each side up, greying out the dice that don't count.
const HANDFULS = [
  ['greatsword', 2, 0], ['advantage', 2, 1], ['percentile', 2, 0], ['magic-missile', 3, 0], ['dice-poker', 5, 0],
  ['the-whole-bag', 6, 0], ['fireball', 8, 0], ['heroic-stats', 4, 1],
];
for (const [set, count, dropped] of HANDFULS) {
  await withMatch(DESKTOP, `handful (${set})`, async (page) => {
    // Grab one die and hold: the whole handful comes up off the table, and
    // bunches up closer than it lay there.
    const spread = () => page.evaluate(() => {
      const ds = window.superRollies.dice.player.map((d) => d.mesh.position);
      const cx = ds.reduce((s, d) => s + d.x, 0) / ds.length;
      const cz = ds.reduce((s, d) => s + d.z, 0) / ds.length;
      return Math.max(...ds.map((d) => Math.hypot(d.x - cx, d.z - cz)));
    });
    const resting = await page.evaluate(() => window.superRollies.dice.player.map((d) => d.mesh.position.y));
    const restSpread = await spread();
    const p = await dieScreenPos(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y - 20, { steps: 3 });
    await page.waitForTimeout(400);
    const held = await page.evaluate(() => window.superRollies.dice.player.map((d) => d.mesh.position.y));
    const heldSpread = await spread();
    await page.mouse.up();
    await waitForDiceAtRest(page);
    const lifted = held.filter((y, i) => y > resting[i] + 0.1).length;
    const allHeld = held.length === count && lifted === count && heldSpread < restSpread;

    const round = await throwAndWait(page);
    const { faces, kept, scores, named } = round.outcome;
    const lines = await page.$$eval('#result .breakdown', (els) => els.map((el) => ({
      text: el.textContent, dropped: el.querySelectorAll('.dropped').length,
    })));
    // A named score (a poker hand) lists its dice, and is written by name.
    const expected = ['player', 'opponent'].map((side, i) => (named[side]
      ? `${['You', 'Opponent'][i]}: ${faces[side].join(' · ')} = ${named[side]}`
      : `${['You', 'Opponent'][i]}: ${(DICE_SETS[set].scorer.labels?.(faces[side]) ?? faces[side]).join(' + ')} = ${scores[side]}`));
    const ok = allHeld && faces.player.length === count && faces.opponent.length === count &&
      lines.length === 2 && lines.every((l, i) => l.text === expected[i] && l.dropped === dropped) &&
      kept.player.filter((k) => !k).length === dropped;
    report(`Handful: ${set} (${count} dice) picked up together, thrown, added up (or named) on the card`, ok,
      `${lifted}/${count} lifted, bunched to ${heldSpread.toFixed(2)} from ${restSpread.toFixed(2)}; card: ${lines.map((l) => `"${l.text}" (${l.dropped} greyed)`).join(', ')}`);
  }, '#quickGameBtn', { pick: set });
}

// Dice that come to rest stay exactly where the simulation left them - in
// particular against a side wall, where keeping dice on screen once pulled
// every d6 inwards by a fifth of a unit as the throw ended. And when the
// window narrows, dice past its new edge are still slid back on screen.
// Fireball for the most dice; Swarm of Daggers because a d4 reaches much
// further one way than the other (a face towards the wall, a corner away),
// and judging it by its longer reach slid it half a die off the wall.
for (const [set, name] of [['fireball', 'Fireball'], ['swarm-of-daggers', 'Swarm of Daggers']]) {
await withMatch(DESKTOP, `stay put (${set})`, async (page) => {
  let moved = [];
  let atWall = 0;
  for (let i = 0; i < 6; i++) {
    const round = await throwAndWait(page, (i % 2 ? 1 : -1) * 300, -200);
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => Object.fromEntries([...window.superRollies.dice.player, ...window.superRollies.dice.opponent]
      .map((d) => [d.id, d.mesh.position.x])));
    const wall = await page.evaluate(() => window.superRollies.arena.xLimit(0));
    for (const d of round.result.dice) {
      if (now[d.id] !== d.p[0]) moved.push(`${d.id} ${d.p[0].toFixed(2)} -> ${now[d.id].toFixed(2)}`);
      if (wall - Math.abs(d.p[0]) < 0.45) atWall++;
    }
    if (await page.locator('#result.game-over').count()) break;
  }
  report(`${name}: dice at rest stay where they landed, against the side walls too`, moved.length === 0 && atWall > 0,
    `${atWall} came to rest by a side wall; ${moved.length} moved${moved.length ? ': ' + moved.slice(0, 3).join(', ') : ''}`);

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
  const all = await page.evaluate(() => window.superRollies.dice.player.length + window.superRollies.dice.opponent.length);
  const off = [];
  for (const side of ['player', 'opponent']) {
    for (let i = 0; i < all / 2; i++) {
      const p = await dieScreenPos(page, side, i);
      if (!(p.x > 0 && p.x < PHONE.width)) off.push(`${side}-${i} at x=${p.x.toFixed(0)}px`);
    }
  }
  report(`${name}: after narrowing to 390x844, every die is slid back on screen`, off.length === 0, off.join(', ') || `${all} dice`);
}, '#quickGameBtn', { pick: set });
}

// Zen is the testbed (D18): it offers every dice set Quick Game does, plus
// every die type on its own, and throws whatever is picked.
await withMatch(DESKTOP, 'Zen picker', async (page) => {
  const offered = await page.$$eval('#pickerOptions [data-pick]', (els) => els.map((el) => el.dataset.pick));
  // Every dice set by id, with its dice; and every die type.
  const { sets, types } = await page.evaluate(async () => {
    const { DICE_SETS, dieTypes } = await import('./src/rules/dice-sets.js');
    return {
      sets: Object.values(DICE_SETS).map((set) => ({ id: set.id, dice: dieTypes(set).join() })),
      types: (await import('./src/die-shapes.js')).DIE_TYPES,
    };
  });
  // A die type alone is on offer as its own entry, or as a set of just that die.
  const alone = (type) => offered.includes(`die:${type}`) ||
    sets.some((set) => set.dice === type && offered.includes(set.id));
  report('Zen offers every dice set and every die type alone',
    sets.every((set) => offered.includes(set.id)) && types.every(alone), offered.join(', '));
}, '#zenBtn', { pickAfter: true });

for (const type of ['d4', 'd6', 'd8', 'd10', 'd%']) {
  await withMatch(DESKTOP, `Zen ${type}`, async (page) => {
    const round = await throwAndWait(page, 30, -300);
    const said = await page.textContent('#resultHeadline');
    report(`Zen, one ${type}: one ${type} thrown, and the card names the face read`,
      round.record.dice.length === 1 && round.record.dice[0].type === type && said === `You rolled ${round.result.dice[0].face}`,
      `card said "${said}"`);
  }, '#zenBtn', { pick: `die:${type}` });
}

for (const [set, count, dropped] of [['fireball', 8, 0], ['heroic-stats', 4, 1]]) {
  await withMatch(DESKTOP, `Zen ${set}`, async (page) => {
    const round = await throwAndWait(page, 30, -300);
    const faces = round.result.dice.map((d) => d.face);
    const headline = await page.textContent('#resultHeadline');
    const line = await page.$eval('#result .breakdown', (el) => ({ text: el.textContent, dropped: el.querySelectorAll('.dropped').length }));
    const ok = round.record.dice.length === count && round.record.dice.every((d) => d.id.startsWith('player')) &&
      headline.startsWith('You rolled ') && line.text === `You: ${faces.join(' + ')} = ${headline.slice(11)}` &&
      line.dropped === dropped;
    report(`Zen ${set}: ${count} dice, no opponent, the card adds them up`, ok, `"${headline}", "${line.text}" (${line.dropped} greyed)`);
  }, '#zenBtn', { pick: set });
}

// Zen: one die, the whole tray, no score, and a way back to the menu.
for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  await withMatch(viewport, `Zen (${name})`, async (page) => {
    // The player's card shows their name and nothing to keep score of.
    const layout = await page.evaluate(() => {
      const shown = (id) => document.getElementById(id).offsetParent !== null;
      return {
        opponentShown: window.superRollies.dice.opponent.length > 0,
        opponentCard: !document.getElementById('opponentHud').hidden,
        name: shown('youName') ? document.getElementById('youName').textContent : null,
        state: ['youHearts', 'youMeter', 'youMarks', 'youEdge'].some(shown),
      };
    });
    report(`Zen (${name}): no opponent die, the player's card by name only, no hearts`,
      !layout.opponentShown && !layout.opponentCard && layout.name === 'Player' && !layout.state, JSON.stringify(layout));

    // Several throws, hard and away from you: with no divider the die should
    // reach the far half, and the card must name the face the game read.
    let farHalf = false;
    let namesFace = true;
    for (let i = 0; i < 5; i++) {
      const round = await throwAndWait(page, (i - 2) * 40, -viewport.height * 0.45);
      const said = await page.textContent('#resultHeadline');
      namesFace &&= said === `You rolled ${round.result.dice[0].face}` && round.result.dice.length === 1;
      farHalf ||= round.result.dice[0].p[2] < 0;
    }
    report(`Zen (${name}): die reaches the far half; card shows the face read`, farHalf && namesFace);

    // The back button is clear of anywhere a die can rest: the far corner of
    // the tray on its side is the nearest such spot.
    const clearance = await page.evaluate(({ TRAY_DEPTH, TRAY_HALF_WIDTH, DIE_RADIUS }) => {
      const { arena, dice } = window.superRollies;
      // Furthest out a die's centre can rest: against the side wall (see
      // sideWallFace in physics.js), lying on a face, ~0.49 from it.
      const xMax = Math.min(TRAY_HALF_WIDTH, arena.arenaHalfWidth + DIE_RADIUS) - 0.45;
      const btn = document.getElementById('backBtn').getBoundingClientRect();
      const r = arena.renderer.domElement.getBoundingClientRect();
      const toScreen = (v) => { v.project(arena.camera); return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height }; };
      const p = dice.player[0].mesh.position.clone().set(-xMax, DIE_RADIUS, -TRAY_DEPTH + 0.45);
      const centre = toScreen(p.clone());
      // The die's on-screen radius, from its circumradius.
      const edge = toScreen(p.clone().setX(p.x + DIE_RADIUS));
      const radius = Math.abs(edge.x - centre.x);
      const dx = Math.max(btn.left - centre.x, 0, centre.x - btn.right);
      const dy = Math.max(btn.top - centre.y, 0, centre.y - btn.bottom);
      return Math.hypot(dx, dy) - radius;
    }, { TRAY_DEPTH, TRAY_HALF_WIDTH, DIE_RADIUS });
    report(`Zen (${name}): back button clear of the nearest resting die`, clearance > 0, `${clearance.toFixed(0)}px clear`);

    await page.click('#backBtn');
    const atMenu = await page.locator('#menu:not([hidden])').count() === 1;
    // And Quick Game afterwards puts the opponent and the divider back.
    await startQuickGame(page);
    const restored = await page.evaluate(() => ({
      opponent: window.superRollies.dice.opponent.length > 0,
      divider: window.superRollies.arena.divider,
      playerZ: window.superRollies.dice.player[0].mesh.position.z,
    }));
    report(`Zen (${name}): back to menu, then Quick Game restores the table`,
      atMenu && restored.opponent && restored.divider && restored.playerZ > 0);
  }, '#zenBtn');
}

// The Quick Game draft (R1.1-R1.3): two dice cards, then two Spice cards that
// suit the set picked, and picking the second starts that match.
await withMatch(DESKTOP, 'draft', async (page) => {
  const cards = () => page.$$eval('#draftCards [data-pick]', (els) => els.map((el) => el.dataset.pick));
  const step = () => page.textContent('#draftStep');
  const dice = await cards();
  const firstStep = await step();
  await page.click(`#draftCards [data-pick="${dice[1]}"]`);
  const spice = await cards();
  const secondStep = await step();
  const eligible = spice.every((id) => isEligible(SPICE[id], DICE_SETS[dice[1]]));
  // Back goes to the dice again, the same two; then on to the match.
  await page.click('#draftBack');
  const again = await cards();
  await page.click(`#draftCards [data-pick="${dice[1]}"]`);
  await page.click(`#draftCards [data-pick="${spice[0]}"]`);
  await waitForDiceAtRest(page);
  const config = await page.evaluate(() => ({ ...window.superRollies.game.config, draftSeed: window.superRollies.game.draftSeed }));
  report('Draft: two dice sets, then two Spice eligible for the one picked, then that match',
    dice.length === 2 && dice.every((id) => DICE_SETS[id]) && spice.length === 2 && eligible &&
      firstStep === 'Step 1 of 2' && secondStep === 'Step 2 of 2' && again.join() === dice.join() &&
      config.diceSet === dice[1] && config.spice === spice[0] && config.seed === config.draftSeed,
    `dice ${dice.join(', ')}; Spice ${spice.join(', ')}; played ${config.diceSet} + ${config.spice}`);
}, '#quickGameBtn', { pickAfter: true });

// §8, 7: the same seed deals the same cards, on screen as in the rules.
await withMatch(DESKTOP, 'draft seed', async (page) => {
  const deal = async (seed) => {
    await page.evaluate((seed) => window.superRollies.game.openDraft(seed), seed);
    const dice = await page.$$eval('#draftCards [data-pick]', (els) => els.map((el) => el.dataset.pick));
    await page.click(`#draftCards [data-pick="${dice[0]}"]`);
    const spice = await page.$$eval('#draftCards [data-pick]', (els) => els.map((el) => el.dataset.pick));
    return `${dice.join()} / ${spice.join()}`;
  };
  // Two seeds whose offers differ, found from the rules themselves.
  let other = 2;
  while (dealDice(other).join() === dealDice(1).join()) other++;
  const first = await deal(1);
  const same = await deal(1);
  const different = await deal(other);
  const expected = `${dealDice(1).join()} / ${dealSpice(1, dealDice(1)[0]).join()}`;
  report('7. Same seed, same offers (on screen and in the rules); another seed, others',
    first === same && first === expected && different !== first, `${first} | ${different}`);
}, '#quickGameBtn', { pickAfter: true });

// The match label (R1.5): names the dice and the Spice; tapped, shows both
// cards with their full rules; and (4.6a) sits clear of every spot a die can
// rest, as the back button does, with Marathon's six hearts clear of both.
for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  await withMatch(viewport, `label (${name})`, async (page) => {
    const label = await page.textContent('#matchInfo');
    await page.click('#matchInfo');
    const popup = await page.$$eval('#rulesCards .card', (els) => els.map((el) => ({
      name: el.querySelector('.card-name').textContent,
      text: el.querySelector('.card-summary').textContent,
    })));
    await page.click('#rulesClose');
    const closed = await page.locator('#rulesPopup[hidden]').count() === 1;
    report(`Label (${name}): names the dice and Spice; its popup shows both in full, and closes`,
      label.includes('Swarm of Daggers') && label.includes('Raising the Stakes') && closed &&
        popup.length === 2 && popup[1].name === 'Raising the Stakes' && popup[1].text === SPICE['raising-the-stakes'].rules,
      `"${label.trim().replace(/\s+/g, ' ')}"`);

    // As for the back button (see Zen below), mirrored: the far corner of the
    // tray on the label's side, scaled with the tray, is the nearest resting spot.
    const clearance = await page.evaluate(({ TRAY_HALF_WIDTH, DIE_RADIUS }) => {
      const { arena, dice } = window.superRollies;
      const k = arena.tray.halfWidth / TRAY_HALF_WIDTH;
      const xMax = Math.min(arena.tray.halfWidth, arena.arenaHalfWidth + DIE_RADIUS) - 0.45 * k;
      const r = arena.renderer.domElement.getBoundingClientRect();
      const toScreen = (v) => { v.project(arena.camera); return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height }; };
      const p = dice.player[0].mesh.position.clone().set(xMax, DIE_RADIUS * k, -arena.tray.depth + 0.45 * k);
      const centre = toScreen(p.clone());
      const radius = Math.abs(toScreen(p.clone().setX(p.x - DIE_RADIUS * k)).x - centre.x);
      const box = document.getElementById('matchInfo').getBoundingClientRect();
      const dx = Math.max(box.left - centre.x, 0, centre.x - box.right);
      const dy = Math.max(box.top - centre.y, 0, centre.y - box.bottom);
      return Math.hypot(dx, dy) - radius;
    }, { TRAY_HALF_WIDTH, DIE_RADIUS });
    report(`Label (${name}): clear of the nearest resting die`, clearance > 0, `${clearance.toFixed(0)}px clear`);

    await page.evaluate(() => window.superRollies.game.start('quick', { diceSet: 'classic', spice: 'marathon' }));
    const overlaps = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const hearts = box('opponentHearts');
      return {
        count: document.querySelectorAll('#opponentHearts .heart').length,
        hit: hit(hearts, box('matchInfo')) || hit(hearts, box('backBtn')),
      };
    });
    report(`Label (${name}): Marathon's six hearts clear of the label and the back button`,
      overlaps.count === 6 && !overlaps.hit, `${overlaps.count} hearts${overlaps.hit ? ', OVERLAPPING' : ''}`);
  }, '#quickGameBtn', { pick: 'swarm-of-daggers', spice: 'raising-the-stakes' });
}

// Underdog (4.9, R3.5): whoever falls behind gets an extra die on the table,
// throws it, and has it scored; the HUD marks their edge; and it goes again
// once they catch up.
await withMatch(DESKTOP, 'underdog', async (page) => {
  let behind = null;
  for (let i = 0; i < 10 && !behind; i++) {
    const round = await throwAndWait(page);
    if (round.outcome.winner) behind = round.outcome.winner === 'player' ? 'opponent' : 'player';
  }
  if (!behind) throw new Error('ten ties in a row');
  const table = await page.evaluate(() => ({
    player: window.superRollies.dice.player.length,
    opponent: window.superRollies.dice.opponent.length,
    edges: [...document.querySelectorAll('.edge:not([hidden])')].map((el) => el.id + ':' + el.textContent),
  }));
  const edgeId = behind === 'player' ? 'youEdge' : 'opponentEdge';
  // Its extra die is thrown and counted: grab whatever the player has.
  const round = await throwAndWait(page);
  const thrown = round.record.dice.filter((d) => d.id.startsWith(behind)).length;
  const scored = round.outcome.dice[behind].length;
  report('Underdog: the side behind gets a third die, thrown and scored, and the HUD marks its edge',
    table[behind] === 3 && table[behind === 'player' ? 'opponent' : 'player'] === 2 &&
      table.edges.join() === `${edgeId}:+1 die` && thrown === 3 && scored === 3,
    `${behind} behind: ${table.player} v ${table.opponent} dice on the table, edge "${table.edges.join()}", ` +
      `${thrown} thrown, ${scored} scored`);
}, '#quickGameBtn', { pick: 'greatsword', spice: 'underdog' });

// Cursed Number: the coming round's number is announced, and stays up while
// the dice are thrown.
await withMatch(PHONE, 'cursed', async (page) => {
  const shown = async () => ({
    text: await page.textContent('#announce'),
    visible: await page.locator('#announce:not([hidden])').count() === 1,
    cursed: await page.evaluate(() => window.superRollies.game.match.spice.cursed),
  });
  const before = await shown();
  const round = await throwAndWait(page);
  const after = await shown();
  const ok = [before, after].every((s) => s.visible && s.text === `Cursed number: ${s.cursed}`);
  // A die showing the cursed number counted for nothing.
  const cursedFaces = round.outcome.faces.player.filter((f) => f === before.cursed).length;
  report('Cursed Number: announced before every round, and a die showing it counts as 0',
    ok && round.outcome.values.player.filter((v, i) => round.outcome.faces.player[i] === before.cursed).every((v) => v === 0),
    `"${before.text}", then "${after.text}"; ${cursedFaces} of the player's dice cursed`);
}, '#quickGameBtn', { pick: 'classic', spice: 'cursed-number' });

// Cursed Number on the table: a die showing the cursed number shows a red 0
// in its place (every place it's printed: three times on a d4), until the
// next throw.
await withMatch(DESKTOP, 'cursed red 0', async (page) => {
  const marked = () => page.evaluate(() => {
    const { dice } = window.superRollies;
    return Object.fromEntries([...dice.player, ...dice.opponent].map((d) => [d.id, d.mesh.children
      .filter((c) => c.userData.printed && c.material.map !== c.userData.printed).map((c) => c.userData.number)]));
  });
  let round;
  for (let i = 0; i < 6; i++) {
    round = await throwAndWait(page);
    if (Object.values(round.outcome.dice).flat().some((d) => d.tag === 'cursed')) break;
  }
  const shown = await marked();
  const wrong = ['player', 'opponent'].flatMap((side) => round.outcome.dice[side].map((d, i) => {
    const want = d.tag === 'cursed' ? [round.outcome.faces[side][i]] : [];
    return shown[`${side}-${i}`].join() === want.join() ? null : `${side}-${i} shows ${shown[`${side}-${i}`]} for ${want}`;
  })).filter(Boolean);
  const cursed = Object.values(round.outcome.dice).flat().filter((d) => d.tag === 'cursed').length;
  await drag(page, 0, -260);
  const cleared = Object.values(await marked()).every((list) => !list.length);
  await waitForDiceAtRest(page);
  report('Cursed Number: a cursed die shows a red 0 for its number until the next throw',
    cursed > 0 && !wrong.length && cleared, wrong.join('; ') || `${cursed} dice cursed${cleared ? ', cleared on the throw' : ', still marked after it'}`);
}, '#quickGameBtn', { pick: 'fireball', spice: 'cursed-number' });

// Exploding Dice on the table: each extra roll pops out of its die as a die
// of its own, lands on that roll, and bumps none of the dice already read;
// the card waits for it, and the next throw takes the pops away.
await withMatch(DESKTOP, 'exploding pops', async (page) => {
  let round;
  let pops = [];
  for (let i = 0; i < 6 && !pops.length; i++) {
    round = await throwAndWait(page);
    pops = await page.evaluate(async () => {
      const { table } = window.superRollies;
      const { SHAPES } = await import('./src/die-shapes.js');
      return table.pops.map((p) => SHAPES[p.type].faceUp(p.mesh.quaternion.clone().multiply(p.face.mesh.quaternion).toArray()));
    });
  }
  const extra = ['player', 'opponent'].flatMap((side) => round.outcome.dice[side].flatMap((d) => d.extra ?? []));
  const moved = await page.evaluate((dice) => dice.filter((d) => {
    const mesh = window.superRollies.table.meshFor(d.id);
    return mesh.position.distanceTo({ x: d.p[0], y: d.p[1], z: d.p[2] }) > 1e-4;
  }).map((d) => d.id), round.throws.at(-1).result.dice);
  await drag(page, 0, -260);
  const left = await page.evaluate(() => window.superRollies.table.pops.length);
  await waitForDiceAtRest(page);
  report('Exploding Dice: every extra roll pops out as a die showing it, the dice read stay put, and the next throw clears them',
    pops.length > 0 && [...pops].sort().join() === [...extra].sort().join() && !moved.length && left === 0,
    `pops show ${pops.join(', ')} for rolls ${extra.join(', ')}${moved.length ? `; moved: ${moved.join(', ')}` : ''}${left ? `; ${left} left after the throw` : ''}`);
}, '#quickGameBtn', { pick: 'fireball', spice: 'exploding-dice' });

// The test bench (D39): only with ?dev; every dice set, then every Spice that
// set allows, set-specific first; back goes to the dice; picking one starts it.
const BENCH = 'Test bench: only with ?dev; every dice set, then every Spice for it (set-specific first), and that match';
if (!ONLY || BENCH.includes(ONLY)) {
  let hiddenWithoutFlag = false;
  const plain = await openGame(engine, DESKTOP);
  try {
    await plain.page.waitForSelector('#quickGameBtn:not([disabled])', { timeout: 30000 });
    hiddenWithoutFlag = await plain.page.locator('#testBenchBtn').isHidden();
  } catch (e) {
    report(`${BENCH} (without ?dev)`, false, e.message.split('\n')[0]);
  }
  if (plain.errors.length) report(`${BENCH}: no page errors without ?dev`, false, plain.errors.join(' | '));
  await plain.browser.close();

  const { browser, page, errors } = await openGame(engine, DESKTOP, '?dev');
  try {
    await page.waitForSelector('#testBenchBtn:not([disabled])', { timeout: 30000 });
    await page.click('#testBenchBtn');
    const picks = () => page.$$eval('#pickerOptions [data-pick]', (els) => els.map((el) => el.dataset.pick));
    const sets = await picks();
    await page.click('#pickerOptions [data-pick="greatsword"]');
    const spice = await picks();
    await page.click('#pickerBack');
    const backToDice = (await picks()).join() === sets.join();
    await page.click('#pickerOptions [data-pick="greatsword"]');
    await page.click('#pickerOptions [data-pick="snake-eyes"]');
    await waitForDiceAtRest(page);
    const config = await page.evaluate(() => window.superRollies.game.config);
    const expected = testBenchSpice('greatsword').map((s) => s.id);
    report(BENCH,
      hiddenWithoutFlag && sets.join() === Object.keys(DICE_SETS).join() && spice.join() === expected.join() &&
        expected.slice(0, 2).join() === 'snake-eyes,doubles-again' && backToDice &&
        config.diceSet === 'greatsword' && config.spice === 'snake-eyes',
      `${sets.length} sets; Greatsword offers ${spice.join(', ')}`);
  } catch (e) {
    report(BENCH, false, e.message.split('\n')[0]);
  }
  if (errors.length) report(`${BENCH}: no page errors`, false, errors.join(' | '));
  await browser.close();
}

// The test bench again: once a match is over, another starts on the same
// dice and Spice, from a new seed, rather than going back to the menu.
const REMATCH = 'Test bench: a match over starts another on the same dice and Spice';
if (!ONLY || REMATCH.includes(ONLY)) {
  const { browser, page, errors } = await openGame(engine, DESKTOP, '?dev');
  try {
    await page.waitForSelector('#testBenchBtn:not([disabled])', { timeout: 30000 });
    await page.click('#testBenchBtn');
    await page.click('#pickerOptions [data-pick="classic"]');
    await page.click('#pickerOptions [data-pick="sudden-death"]');
    await waitForDiceAtRest(page);
    const first = await page.evaluate(() => window.superRollies.game.config);
    for (let i = 0; i < 20 && !(await page.locator('#result.game-over').count()); i++) await playARound(page);
    const note = await page.textContent('#resultDetail');
    await page.waitForFunction((seed) => {
      const { game } = window.superRollies;
      return game.state === 'playing' && game.config.seed !== seed;
    }, first.seed, { timeout: 8000 });
    const next = await page.evaluate(() => ({
      config: window.superRollies.game.config,
      menu: !document.getElementById('menu').hidden,
    }));
    report(REMATCH,
      next.config.diceSet === 'classic' && next.config.spice === 'sudden-death' && !next.menu && /the same again/.test(note),
      `seed ${first.seed}, then ${next.config.seed}`);
  } catch (e) {
    report(REMATCH, false, e.message.split('\n')[0]);
  }
  if (errors.length) report(`${REMATCH}: no page errors`, false, errors.join(' | '));
  await browser.close();
}

// ---------- Phase 5: Spice on the table, re-throws, other ways to win ----------

/**
 * Throws and waits for the round to finish, throwing again whenever the round
 * asks the player to (doubles). Resolves with the round's entry, and what the
 * card said each time the player was asked.
 */
async function playARound(page, dx = 0, dy = -260) {
  const before = await page.evaluate(() => window.superRollies.rounds.length);
  const asked = [];
  await drag(page, dx, dy);
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => ({
      n: window.superRollies.rounds.length,
      awaiting: window.superRollies.game.awaiting,
      busy: window.superRollies.roller.busy,
    }));
    if (s.n > before) break;
    if (s.awaiting && !s.busy) {
      asked.push(await page.textContent('#resultHeadline'));
      await drag(page, dx, dy);
    }
    await page.waitForTimeout(250);
  }
  await waitForDiceAtRest(page);
  const round = await page.evaluate(() => JSON.parse(JSON.stringify(window.superRollies.rounds.at(-1))));
  return { ...round, asked };
}

// Pothole (5.1): a die that falls in lies in the pit and counts 0, written
// "hole"; no die waits over a hole; and on a phone held upright both holes
// are on screen.
await withMatch(DESKTOP, 'pothole', async (page) => {
  const overHole = await page.evaluate(() => {
    const { arena, dice } = window.superRollies;
    return [...dice.player, ...dice.opponent].filter((d) =>
      arena.holes.some((h) => Math.hypot(d.mesh.position.x - h.x, d.mesh.position.z - h.z) < h.r)).length;
  });
  let round = null;
  for (let i = 0; i < 10 && !round; i++) {
    const r = await playARound(page, (i % 5 - 2) * 60, -200);
    if (r.result.dice.some((d) => d.fallen)) round = r;
    if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'fireball', 'pothole');
  }
  if (!round) throw new Error('no die fell in a hole in ten rounds');
  const { outcome, result } = round;
  const fallen = result.dice.filter((d) => d.fallen);
  const inPits = await page.evaluate((ids) => {
    const { arena, table } = window.superRollies;
    return ids.every((id) => {
      const { x, y, z } = table.meshFor(id).position;
      return y < 0 && arena.holes.some((h) => Math.hypot(x - h.x, z - h.z) < h.r);
    });
  }, fallen.map((d) => d.id));
  const counted = ['player', 'opponent'].every((side) => outcome.fallen[side].every((f, i) => !f || outcome.values[side][i] === 0));
  const written = await page.$$eval('#result .fallen', (els) => els.map((el) => el.textContent));
  report('Pothole: a die that falls in lies in the pit, counts 0 and is written "hole"; none waits over a hole',
    overHole === 0 && inPits && counted && written.length === fallen.length && written.every((t) => t === 'hole'),
    `${fallen.length} fell in; ${written.length} written "hole"; ${overHole} waited over a hole`);

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
  const onScreen = await page.evaluate(({ width, height }) => {
    const { arena } = window.superRollies;
    const r = arena.renderer.domElement.getBoundingClientRect();
    return arena.holes.every((h) => [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dz]) => {
      const v = window.superRollies.dice.player[0].mesh.position.clone().set(h.x + dx * h.r, 0, h.z + dz * h.r).project(arena.camera);
      const x = (v.x + 1) / 2 * r.width;
      const y = (1 - v.y) / 2 * r.height;
      return x > 0 && x < width && y > 0 && y < height;
    }));
  }, PHONE);
  report('Pothole: on 390x844 both holes are wholly on screen', onScreen);
}, '#quickGameBtn', { pick: 'fireball', spice: 'pothole' });

// Cat Paw (5.2): with a seed whose first round has a swipe, the paw knocks
// the dice it names from where they lay, they roll again, and what they land
// on is what counts.
await withMatch(DESKTOP, 'cat paw', async (page) => {
  let seed = 1;
  const swipesFor = (s) => {
    const rules = resolveRules(matchConfig({ seed: s, diceSet: 'ability-score', spice: 'cat-paw' }));
    const { state } = beginRound(rules, startMatch(rules));
    return afterSettle(rules, state, { player: 3, opponent: 3 }).swipes;
  };
  while (!swipesFor(seed).length) seed++;
  const swipes = swipesFor(seed);
  await page.evaluate((seed) => window.superRollies.game.start('quick', { seed, diceSet: 'ability-score', spice: 'cat-paw' }), seed);
  await waitForDiceAtRest(page);
  const { throws, outcome } = await playARound(page);
  const [first, knock] = throws;
  const lay = Object.fromEntries((first?.result.dice ?? []).map((d) => [d.id, d.p.join()]));
  const fromRest = knock?.record.dice.every((d) => lay[d.id] === d.p.join());
  const knocked = knock?.record.dice.filter((d) => d.v.some((v) => v !== 0)).map((d) => d.id).sort().join();
  const named = swipes.map((s) => `${s.side}-${s.index}`).sort().join();
  const faces = ['player', 'opponent'].every((side) =>
    outcome.faces[side].join() === knock?.result.dice.filter((d) => d.id.startsWith(side)).map((d) => d.face).join());
  const note = await page.textContent('#resultDetail');
  report('Cat Paw: the paw knocks the dice the rules name, from where they lay, and their new faces count',
    throws.length === 2 && fromRest && knocked === named && faces && /The cat knocked/.test(note),
    `seed ${seed}: knocked ${knocked} (named ${named}); ${throws.length} throws; "${note.match(/🐾[^.!]*!/)?.[0] ?? 'no note'}"`);
}, '#quickGameBtn', { pick: 'ability-score', spice: 'cat-paw' });

// Gusty Table (5.3): the breeze announced is the one in the throw's record.
await withMatch(PHONE, 'gusty', async (page) => {
  const before = await page.evaluate(() => ({
    wind: window.superRollies.game.match.spice.wind,
    announce: document.getElementById('announce').textContent,
  }));
  const { record } = await playARound(page);
  const [wx, wz] = before.wind;
  const arrow = { '1,0': '→', '1,-1': '↗', '0,-1': '↑', '-1,-1': '↖', '-1,0': '←', '-1,1': '↙', '0,1': '↓', '1,1': '↘' }[
    `${Math.sign(Math.round(wx * 10))},${Math.sign(Math.round(wz * 10))}`];
  report('Gusty Table: the breeze is announced with its direction, and blows in the throw\'s record',
    JSON.stringify(record.wind) === JSON.stringify(before.wind) && before.announce.endsWith(arrow),
    `"${before.announce}", record wind ${record.wind?.map((n) => n.toFixed(2)).join(', ')}`);
}, '#quickGameBtn', { pick: 'ability-score', spice: 'gusty-table' });

// No Man's Land (5.6): no divider, the hand still kept to its own half, and a
// die of yours that ends up in the opponent's half - or under the result card
// in the middle, which takes no pointer events - can still be picked up.
await withMatch(DESKTOP, "no man's land", async (page) => {
  const table = await page.evaluate(() => ({ divider: window.superRollies.arena.divider, split: window.superRollies.arena.split }));
  let found = null;
  let record = null;
  for (let i = 0; i < 10 && !found; i++) {
    ({ record } = await playARound(page, (i % 3 - 1) * 40, -320));
    found = await page.evaluate(() => {
      const card = document.getElementById('result').getBoundingClientRect();
      const { arena, dice } = window.superRollies;
      const r = arena.renderer.domElement.getBoundingClientRect();
      for (const d of dice.player) {
        const v = d.mesh.position.clone().project(arena.camera);
        const p = { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height };
        const underCard = p.x > card.left && p.x < card.right && p.y > card.top && p.y < card.bottom;
        if (d.mesh.position.z < 0 || underCard) return { ...p, far: d.mesh.position.z < 0, underCard };
      }
      return null;
    });
    if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'ability-score', 'no-mans-land');
  }
  if (!found) throw new Error('no die of the player\'s ended up across the middle or under the card in ten rounds');
  const said = await pressAt(page, found);
  report("No Man's Land: no divider; a die of yours across the middle or under the card is still picked up",
    !table.divider && table.split && record.divider === false && said === 'Let go to throw',
    `${found.far ? "in the opponent's half" : 'by the middle'}${found.underCard ? ', under the card' : ''}; card said "${said}"`);
  // The opponent throws at where the player's dice were let go: each of its
  // dice heads that way faster than an unaimed throw ever goes (2.5 at most).
  const sideOf = (side) => record.dice.filter((d) => d.id.startsWith(side));
  const centre = (list) => [0, 2].map((k) => list.reduce((s, d) => s + d.p[k], 0) / list.length);
  const [px, pz] = centre(sideOf('player'));
  const [ox, oz] = centre(sideOf('opponent'));
  const towards = sideOf('opponent').map((d) => (d.v[0] * (px - ox) + d.v[2] * (pz - oz)) / Math.hypot(px - ox, pz - oz));
  report("No Man's Land: the opponent throws its dice at yours", towards.every((v) => v > 2.5),
    `opponent's dice heading ${towards.map((v) => v.toFixed(1)).join(', ')} towards yours`);
}, '#quickGameBtn', { pick: 'ability-score', spice: 'no-mans-land' });

// Second Wind (5.4): lose a round and the button offers a re-throw. It sits
// right under the result card, clear of every die on the table (4.6a), or in
// its corner if nothing by the card is clear; taking it puts the round back,
// your re-throw replaces your dice, the round is played out again, and it's
// spent.
for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  await withMatch(viewport, `second wind (${name})`, async (page) => {
    let lost = null;
    for (let i = 0; i < 12 && !lost; i++) {
      const before = await page.evaluate(() => window.superRollies.game.match.win);
      const round = await playARound(page);
      if (await page.evaluate(() => window.superRollies.game.offered)) lost = { round, before };
      else if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'ability-score', 'second-wind');
    }
    if (!lost) throw new Error('never lost a round in twelve');
    const shown = await page.locator('#rethrowBtn:not([hidden])').count() === 1;
    const placed = await page.evaluate(() => {
      const btn = document.getElementById('rethrowBtn').getBoundingClientRect();
      const card = document.getElementById('result').getBoundingClientRect();
      const clear = Math.min(...window.superRollies.table.onScreen().map((d) => {
        const dx = Math.max(btn.left - d.x, 0, d.x - btn.right);
        const dy = Math.max(btn.top - d.y, 0, d.y - btn.bottom);
        return Math.hypot(dx, dy) - d.r;
      }));
      const underCard = btn.top >= card.bottom && btn.top - card.bottom < 2 * btn.height &&
        btn.left >= card.left - 1 && btn.right <= card.right + 1;
      const corner = btn.right > window.innerWidth - 40 && btn.bottom > window.innerHeight - 40;
      return { clear, where: underCard ? 'under the card' : corner ? 'in its corner' : `elsewhere (${btn.left},${btn.top})` };
    });
    report(`Second Wind (${name}): the re-throw button is offered under the card (or in its corner), clear of every die`,
      shown && placed.clear > 0 && placed.where !== 'elsewhere', `${placed.where}, ${placed.clear.toFixed(0)}px clear of the nearest die`);

    const count = await page.evaluate(() => window.superRollies.rounds.length);
    await page.click('#rethrowBtn');
    const undone = await page.evaluate(() => ({
      win: window.superRollies.game.match.win,
      said: document.getElementById('resultHeadline').textContent,
      awaiting: window.superRollies.game.awaiting,
    }));
    const again = await playARound(page);
    const after = await page.evaluate(() => ({
      count: window.superRollies.rounds.length,
      button: !document.getElementById('rethrowBtn').hidden,
      badge: document.getElementById('youEdge').hidden ? '' : document.getElementById('youEdge').textContent,
    }));
    const thrown = again.throws.at(-1).result.dice.filter((d) => d.id.startsWith('player')).map((d) => d.face).join();
    const replays = again.throws.length > lost.round.throws.length && after.count === count;
    report(`Second Wind (${name}): taking it puts the round back, and your new throw replaces the old`,
      JSON.stringify(undone.win) === JSON.stringify(lost.before) && undone.said === 'Second Wind!' && undone.awaiting === 'throw' &&
        replays && (again.outcome.faces.player.join() === thrown || again.throws.at(-1).record.dice.every((d) => d.id.startsWith('opponent'))) &&
        !after.button && after.badge === '',
      `"${undone.said}", ${again.throws.length} throws in the round, ${after.count} rounds; ` +
        `${again.outcome.winner ?? 'tie'} this time`);
  }, '#quickGameBtn', { pick: 'ability-score', spice: 'second-wind' });
}

// Hit Points, Race to N, Tug of War (5.7): each draws its own bar per side,
// not hearts, matching the win condition; on a phone they stay clear of the
// corner controls.
for (const spice of ['hit-points', 'race-to-n', 'tug-of-war']) {
  await withMatch(PHONE, spice, async (page) => {
    await playARound(page);
    const hud = await page.evaluate(() => {
      const { game } = window.superRollies;
      const view = game.rules.winCondition.view(game.match.win);
      const box = (el) => el.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const meters = [...document.querySelectorAll('.meter:not([hidden])')];
      return {
        texts: meters.map((m) => m.querySelector('.meter-text').textContent),
        want: [view.sides.opponent.text, view.sides.player.text],
        hearts: document.querySelectorAll('.hearts:not([hidden])').length,
        overlaps: meters.some((m) => ['backBtn', 'matchInfo'].some((id) => hit(box(m), box(document.getElementById(id))))),
      };
    });
    report(`${SPICE[spice].name}: a bar per side, as the win condition says, clear of the corners on 390x844`,
      hud.texts.join() === hud.want.join() && hud.hearts === 0 && !hud.overlaps, hud.texts.join(' | '));
    if (spice !== 'hit-points') return;
    // The card says who lost how many HP.
    const { damage } = await page.evaluate(() => window.superRollies.rounds.at(-1).outcome);
    const notes = await page.$$eval('#resultDetail .note', (els) => els.map((el) => el.textContent));
    const want = damage.player ? `You lose ${damage.player} HP.` : damage.opponent ? `Your opponent loses ${damage.opponent} HP.` : null;
    report('Hit Points: the card says who lost how many HP',
      want ? notes.includes(want) : !notes.some((n) => n.includes('HP')), notes.join(' | ') || 'no notes (a tie)');
  }, '#quickGameBtn', { pick: 'ability-score', spice });
}

// Tug of War's rope (D41): it lies down the middle, in every throw's record,
// and its flag is as far along it as the marker.
await withMatch(DESKTOP, 'tug of war rope', async (page) => {
  const { record } = await playARound(page);
  await page.waitForTimeout(1000);
  const seen = await page.evaluate(() => {
    const { arena, game } = window.superRollies;
    const pull = game.rules.winCondition.pull(game.match.win);
    const flag = arena.scene.getObjectByName('tug-of-war flag')?.position.z ?? null;
    return { rope: arena.rope, pull, flag, want: -pull * (arena.tray.depth - 0.3 * arena.tray.halfWidth / 3.1) };
  });
  report("Tug of War: a rope down the middle, in the throw's record, its flag as far along as the marker",
    record.rope === true && record.divider !== false && seen.rope > 0 && seen.flag !== null && Math.abs(seen.flag - seen.want) < 0.05,
    `pull ${seen.pull.toFixed(2)}: flag at z=${seen.flag?.toFixed(2)}, wanted ${seen.want.toFixed(2)}`);
}, '#quickGameBtn', { pick: 'classic', spice: 'tug-of-war' });

// A whole Hit Points match, to the end and back to the menu (§8, 5).
await withMatch(DESKTOP, 'hit points match', async (page) => {
  let announced = null;
  for (let i = 0; i < 40 && !announced; i++) {
    await playARound(page, (i % 5 - 2) * 30, -260);
    if (await page.locator('#result.game-over').count()) announced = await page.textContent('#resultHeadline');
  }
  const drained = await page.evaluate(() => {
    const { win } = window.superRollies.game.match;
    return win.player === 0 || win.opponent === 0;
  });
  await page.waitForSelector('#menu:not([hidden])', { timeout: 6000 }).catch(() => null);
  const backAtMenu = await page.locator('#menu:not([hidden])').count() === 1;
  report('Hit Points: a full match drains a side to 0 HP, announces it and returns to the menu',
    !!announced && drained && backAtMenu, `"${announced}"`);
}, '#quickGameBtn', { pick: 'greataxe', spice: 'hit-points' });

// Doubles Again (5.8): doubles throw again - the player is asked to, the
// opponent just does - and the extra throw is added on the card.
await withMatch(DESKTOP, 'doubles', async (page) => {
  let seen = null;
  for (let i = 0; i < 20 && !seen; i++) {
    const round = await playARound(page);
    const { again } = round.outcome;
    if (again.player.length || again.opponent.length) seen = round;
    // A new match only if this round wasn't the one: its card is read below.
    else if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'greatsword', 'doubles-again');
  }
  if (!seen) throw new Error('no doubles in twenty rounds');
  const { again, adjustments } = seen.outcome;
  const card = await page.$$eval('#result .adjustment', (els) => els.map((el) => el.textContent.trim()));
  const extra = again.player.length + again.opponent.length;
  report('Doubles Again: doubles throw again, the player asked to, and each extra throw is added on the card',
    (again.player.length === 0 || seen.asked.every((a) => a === 'Doubles! Throw again') && seen.asked.length === again.player.length) &&
      card.length === extra && card.every((t) => /^\+ \d+ again$/.test(t)) &&
      adjustments.player.length === again.player.length,
    `player threw again ${again.player.length}x, opponent ${again.opponent.length}x; card: ${card.join(', ')}`);
}, '#quickGameBtn', { pick: 'greatsword', spice: 'doubles-again' });

// Death Saves (5.8): each side's failed saves are marked by its hearts.
await withMatch(PHONE, 'death saves', async (page) => {
  await playARound(page);
  const marks = await page.evaluate(() => ({
    fails: window.superRollies.game.match.win.fails,
    shown: {
      player: document.querySelectorAll('#youMarks .mark.struck').length,
      opponent: document.querySelectorAll('#opponentMarks .mark.struck').length,
    },
  }));
  report('Death Saves: failed saves are marked by each side\'s hearts',
    JSON.stringify(marks.fails) === JSON.stringify(marks.shown), JSON.stringify(marks.shown));
}, '#quickGameBtn', { pick: 'classic', spice: 'death-saves' });

// ---------- Phase 6 ----------

/** Waits until the round asks the player to pick dice out (Draw Poker), with nothing moving. */
async function waitForPick(page) {
  await page.waitForFunction(() => window.superRollies.game.awaiting === 'pick' && !window.superRollies.roller.busy,
    null, { timeout: 15000 });
}

/** Which of a side's dice glow, picked out to be thrown again. */
const glowing = (page, side) => page.evaluate((side) =>
  window.superRollies.dice[side].map((d) => d.mesh.material.emissive.getHex() !== 0), side);

// Draw Poker (6.1): once both have thrown, the player taps dice to pick them
// out (and again to put one back), and the opponent's to throw glow; the
// button to keep them all sits clear of every die; a drag throws only the
// dice picked out, the rest held where they lie, and their faces still
// count. Or the player keeps them all.
for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  await withMatch(viewport, `draw poker (${name})`, async (page) => {
    const before = await page.evaluate(() => window.superRollies.rounds.length);
    await drag(page, 0, -260);
    await waitForPick(page);
    const asked = await page.textContent('#resultHeadline');
    const shown = await page.evaluate(() => {
      const { table } = window.superRollies;
      const btn = document.getElementById('rethrowBtn');
      const box = btn.getBoundingClientRect();
      const clear = Math.min(...table.onScreen().map((d) => {
        const dx = Math.max(box.left - d.x, 0, d.x - box.right);
        const dy = Math.max(box.top - d.y, 0, d.y - box.bottom);
        return Math.hypot(dx, dy) - d.r;
      }));
      return { button: !btn.hidden ? btn.textContent : null, clear };
    });
    // Tap two dice, then the second again: only the first stays picked out.
    for (const i of [0, 1, 1]) {
      const p = await dieScreenPos(page, 'player', i);
      await page.mouse.click(p.x, p.y);
    }
    const picked = await glowing(page, 'player');
    const theirs = await glowing(page, 'opponent');
    const lay = await page.evaluate(() => window.superRollies.dice.player.map((d) => d.mesh.position.toArray().join()));
    // Drag die 0: it alone goes.
    await drag(page, 10, -200, 8, await dieScreenPos(page, 'player', 0));
    await page.waitForFunction((n) => window.superRollies.rounds.length > n, before, { timeout: 15000 });
    await waitForDiceAtRest(page);
    const round = await page.evaluate(() => JSON.parse(JSON.stringify(window.superRollies.rounds.at(-1))));
    const [first, redraw] = round.throws;
    const thrown = (side) => redraw.record.dice.filter((d) => d.id.startsWith(side) && !d.fixed).map((d) => d.id);
    const stayed = await page.evaluate((lay) => window.superRollies.dice.player.slice(1)
      .every((d, i) => d.mesh.position.toArray().join() === lay[i + 1]), lay);
    const firstFaces = first.result.dice.filter((d) => d.id.startsWith('player')).map((d) => d.face);
    const newFace = redraw.result.dice.find((d) => d.id === 'player-0').face;
    const counted = round.outcome.faces.player.join() === [newFace, ...firstFaces.slice(1)].join();
    const firstTheirs = first.result.dice.filter((d) => d.id.startsWith('opponent')).map((d) => d.face);
    const hold = (await import('../../src/rules/poker.js')).pokerHold(firstTheirs);
    const wantTheirs = hold.flatMap((k, i) => (k ? [] : [`opponent-${i}`]));
    report(`Draw Poker (${name}): tap picks dice out, the keep button is clear of every die, the opponent's to throw glow`,
      asked === 'Throw any again?' && shown.button?.includes('Keep them') && shown.clear > 0 &&
        picked.join() === [true, false, false, false, false].join() &&
        theirs.join() === hold.map((k) => !k).join(),
      `asked "${asked}"; button ${shown.clear.toFixed(0)}px clear; picked ${picked.map(Number).join('')}, theirs glowing ${theirs.map(Number).join('')}`);
    report(`Draw Poker (${name}): only the dice picked out are thrown, the rest stay where they lay and still count`,
      thrown('player').join() === 'player-0' && thrown('opponent').join() === wantTheirs.join() && stayed && counted,
      `threw ${[...thrown('player'), ...thrown('opponent')].join(', ') || 'nothing'}; kept dice ${stayed ? 'unmoved' : 'MOVED'}; ` +
        `faces ${round.outcome.faces.player.join(' ')}`);

    // Next round: keep them all. No die of the player's is thrown again.
    if (await page.locator('#result.game-over').count()) return;
    const n = await page.evaluate(() => window.superRollies.rounds.length);
    await drag(page, 0, -260);
    await waitForPick(page);
    await page.click('#rethrowBtn');
    await page.waitForFunction((n) => window.superRollies.rounds.length > n, n, { timeout: 15000 });
    const kept = await page.evaluate(() => JSON.parse(JSON.stringify(window.superRollies.rounds.at(-1))));
    const again = kept.throws[1];
    const unthrown = !again || again.record.dice.filter((d) => d.id.startsWith('player')).every((d) => d.fixed);
    const named = await page.$$eval('#result .breakdown strong', (els) => els.map((el) => el.textContent));
    report(`Draw Poker (${name}): keeping them all throws none of yours again, and the card names both hands`,
      unthrown && named.join() === [kept.outcome.named.player, kept.outcome.named.opponent].join(),
      `${kept.throws.length} throws; card: ${named.join(' vs ')}`);
  }, '#quickGameBtn', { pick: 'dice-poker', spice: 'draw-poker' });
}

// Count the Sixes (6.2): the card counts each side's 6s, the rest greyed out.
await withMatch(DESKTOP, 'count the sixes', async (page) => {
  const { outcome } = await playARound(page);
  const lines = await page.$$eval('#result .breakdown', (els) => els.map((el) => ({
    total: el.querySelector('strong').textContent, dropped: el.querySelectorAll('.dropped').length,
  })));
  const want = ['player', 'opponent'].map((side) => {
    const n = outcome.faces[side].filter((f) => f === 6).length;
    return { total: `${n} ${n === 1 ? 'six' : 'sixes'}`, dropped: 8 - n };
  });
  report('Count the Sixes: the card counts each side\'s 6s, the rest greyed out',
    JSON.stringify(lines) === JSON.stringify(want), lines.map((l) => `${l.total} (${l.dropped} greyed)`).join(' vs '));
}, '#quickGameBtn', { pick: 'fireball', spice: 'count-the-sixes' });

// Burnout (6.3): each die that lands on a 1 goes from the table, the hand
// shrinks with it, and the dice burnt are marked by the hearts, clear of the
// corners on a phone.
await withMatch(PHONE, 'burnout', async (page) => {
  let seen = null;
  for (let i = 0; i < 10 && !seen; i++) {
    const round = await playARound(page);
    if (round.outcome.faces.player.includes(1) || round.outcome.faces.opponent.includes(1)) seen = round;
    if (await page.locator('#result.game-over').count()) break;
  }
  if (!seen) throw new Error('no 1 in ten rounds');
  await waitForDiceAtRest(page);
  const after = await page.evaluate(() => {
    const { game, dice } = window.superRollies;
    const box = (el) => el.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const rows = [...document.querySelectorAll('.marks:not([hidden])')];
    return {
      left: game.match.win.dice,
      onTable: { player: dice.player.length, opponent: dice.opponent.length },
      ids: dice.player.map((d) => d.id).join(),
      marks: {
        player: document.querySelectorAll('#youMarks .mark.struck').length,
        opponent: document.querySelectorAll('#opponentMarks .mark.struck').length,
      },
      overlaps: rows.some((m) => ['backBtn', 'matchInfo'].some((id) => hit(box(m), box(document.getElementById(id))))),
      offScreen: rows.some((m) => box(m).left < 0 || box(m).right > window.innerWidth),
    };
  });
  const ones = (side) => seen.outcome.faces[side].filter((f) => f === 1).length;
  const before = seen.outcome.faces;
  const ok = ['player', 'opponent'].every((side) =>
    after.left[side] === before[side].length - ones(side) && after.onTable[side] === after.left[side] &&
    after.marks[side] === 8 - after.left[side]) &&
    after.ids === Array.from({ length: after.onTable.player }, (_, i) => `player-${i}`).join() &&
    !after.overlaps && !after.offScreen;
  report('Burnout: dice showing 1 go from the table, the hand shrinks, and the burnt are marked by the hearts, clear of the corners',
    ok, `1s: ${ones('player')} vs ${ones('opponent')}; left ${after.left.player} vs ${after.left.opponent}; ` +
      `on the table ${after.onTable.player} vs ${after.onTable.opponent}; marked ${after.marks.player} vs ${after.marks.opponent}`);
}, '#quickGameBtn', { pick: 'fireball', spice: 'burnout' });

// Crown (6.4): only the highest die counts, and each die on its maximum is
// written `+ 5 👑` on the card.
await withMatch(DESKTOP, 'crown', async (page) => {
  let seen = null;
  for (let i = 0; i < 10 && !seen; i++) {
    const round = await playARound(page);
    if (round.outcome.adjustments.player.length || round.outcome.adjustments.opponent.length) seen = round;
    if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'the-whole-bag', 'crown');
  }
  if (!seen) throw new Error('no die on its maximum in ten rounds');
  const card = await page.$$eval('#result .adjustment', (els) => els.map((el) => el.textContent.trim()));
  const { adjustments, kept } = seen.outcome;
  const crowns = adjustments.player.length + adjustments.opponent.length;
  report('Crown: one die counts a side, and each die on its maximum is + 5 👑 on the card',
    card.length === crowns && card.every((t) => t === '+ 5 👑') &&
      kept.player.filter(Boolean).length === 1 && kept.opponent.filter(Boolean).length === 1,
    `${crowns} crowned: ${card.join(', ')}`);
}, '#quickGameBtn', { pick: 'the-whole-bag', spice: 'crown' });

// Wild Magic (6.5): matching digits set off a surge, said on the card.
await withMatch(DESKTOP, 'wild magic', async (page) => {
  let seen = null;
  for (let i = 0; i < 30 && !seen; i++) {
    const round = await playARound(page, (i % 5 - 2) * 30, -260);
    const { scores } = round.outcome;
    if (['player', 'opponent'].some((side) => scores[side] === 100 || scores[side] % 11 === 0)) seen = round;
    else if (await page.locator('#result.game-over').count()) await startQuickGame(page, 'percentile', 'wild-magic');
  }
  if (!seen) throw new Error('no matching digits in thirty rounds');
  const notes = await page.$$eval('#resultDetail .note', (els) => els.map((el) => el.textContent));
  report('Wild Magic: matching digits set off a surge, said on the card',
    seen.outcome.note?.startsWith('🌀') && notes.includes(seen.outcome.note),
    `${seen.outcome.scores.player} vs ${seen.outcome.scores.opponent}: "${seen.outcome.note}"`);
}, '#quickGameBtn', { pick: 'percentile', spice: 'wild-magic' });

// Player cards and the editor (6b, R6): each side's card shows its name and
// match state, clear of the corners and of every resting spot, on desktop and
// 390x844, a 16-character or emoji name inside it; the editor's picks show on
// its card, the tray and the dice as they're made, Back drops them, Save keeps
// them past a reload; in a match they're the player's half and dice, the
// opponent's dice never in the player's colour, the same seed the same look;
// Zen's tray is all the player's.
const colorOf = (list, id) => list.find((c) => c.id === id);
const SAVED = { name: 'Sir Rolls-a-Lot!', card: 'sky', tray: 'satin', dice: 'charcoal' };

/** What's drawn: each half of the floor, and each side's first die (by its edges' colour). */
const drawn = (page) => page.evaluate(() => {
  const { arena, dice } = window.superRollies;
  const edge = (d) => d?.mesh.children.find((c) => c.isLineSegments).material.color.getHex();
  return { floors: arena.floorColors, player: edge(dice.player[0]), opponent: edge(dice.opponent[0]) };
});

/**
 * How far each card is from the nearest corner control and from the nearest
 * die resting against the wall on its side, in px (negative: overlapping),
 * and whether its name stays inside it. Each of the side's dice is tried
 * against that wall, at its middle and both ends, turned twelve ways about
 * the vertical, as it lies now: its real corners, not a sphere round it,
 * which overstates how high a die reaches on screen by 30 px and more.
 */
const cardLayout = (page) => page.evaluate(() => {
  const { arena, dice } = window.superRollies;
  const r = arena.renderer.domElement.getBoundingClientRect();
  const apart = (a, b) => Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
  const corners = ['backBtn', 'matchInfo'].map((id) => document.getElementById(id))
    .filter((el) => !el.hidden).map((el) => el.getBoundingClientRect());
  // The highest (far wall) or lowest (near wall) a die of `side` reaches on screen.
  function reachOnScreen(side, toward) {
    let most = toward < 0 ? Infinity : -Infinity;
    for (const die of dice[side]) {
      const { mesh } = die;
      const saved = mesh.quaternion.clone();
      const pos = mesh.geometry.attributes.position;
      const V = mesh.position.constructor;
      for (let turn = 0; turn < 12; turn++) {
        mesh.rotateY(Math.PI / 6);
        mesh.updateMatrixWorld(true);
        const pts = [];
        let reach = 0;
        let low = Infinity;
        for (let i = 0; i < pos.count; i++) {
          const w = new V().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(mesh.position);
          pts.push(w);
          reach = Math.max(reach, toward * w.z);
          low = Math.min(low, w.y);
        }
        const xMax = arena.xLimit(die.radius);
        for (const x of [-xMax, 0, xMax]) {
          const c = new V(x, -low, toward * (arena.tray.depth - reach));
          for (const w of pts) {
            const y = (1 - c.clone().add(w).project(arena.camera).y) / 2 * r.height;
            most = toward < 0 ? Math.min(most, y) : Math.max(most, y);
          }
        }
      }
      mesh.quaternion.copy(saved);
      mesh.updateMatrixWorld(true);
    }
    return most;
  }
  const out = {};
  for (const [side, toward] of [['opponent', -1], ['player', 1]]) {
    const card = document.getElementById(side === 'player' ? 'youCard' : 'opponentCard');
    const box = card.getBoundingClientRect();
    const name = document.getElementById(side === 'player' ? 'youName' : 'opponentName').getBoundingClientRect();
    const reach = reachOnScreen(side, toward);
    const dice = toward < 0 ? reach - box.bottom : box.top - reach;
    out[side] = {
      dice: Math.round(dice),
      corners: Math.round(Math.min(Infinity, ...corners.map((c) => apart(box, c)))),
      nameInside: name.left >= box.left && name.right <= box.right && name.bottom <= box.bottom,
      text: card.querySelector('.pc-name').textContent,
    };
  }
  return out;
});

for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  if (ONLY && !`profile (${name})`.includes(ONLY)) continue;
  const { browser, page, errors } = await openGame(engine, viewport);
  try {
    await page.waitForSelector('#quickGameBtn:not([disabled])', { timeout: 30000 });

    // The editor: picks show on its card, the tray and the dice straight away.
    await page.click('#editBtn');
    await page.fill('#editorName', SAVED.name + ' and more');
    for (const [row, key] of [['#editorCards', 'card'], ['#editorTrays', 'tray'], ['#editorDice', 'dice']]) {
      await page.click(`${row} [data-choice="${SAVED[key]}"]`);
    }
    const preview = { ...await drawn(page), name: await page.textContent('#editorCardName'), typed: await page.inputValue('#editorName') };
    const tray = colorOf(TRAY_COLORS, SAVED.tray).color;
    const dice = colorOf(DICE_COLORS, SAVED.dice).edge;
    report(`Profile (${name}): the editor shows its picks on its card, the tray and the dice; a name stops at 16`,
      preview.floors.player === tray && preview.floors.opponent === tray && preview.player === dice &&
        preview.name === SAVED.name && preview.typed === SAVED.name, JSON.stringify(preview));

    // Back drops them; Save keeps them, past a reload.
    await page.click('#editorBack');
    const dropped = await page.evaluate(() => window.superRollies.profiles.get().name);
    await page.click('#editBtn');
    await page.fill('#editorName', SAVED.name);
    for (const [row, key] of [['#editorCards', 'card'], ['#editorTrays', 'tray'], ['#editorDice', 'dice']]) {
      await page.click(`${row} [data-choice="${SAVED[key]}"]`);
    }
    await page.click('#editorSave');
    await page.reload();
    await page.waitForSelector('#quickGameBtn:not([disabled])', { timeout: 30000 });
    const kept = await page.evaluate(() => ({ profile: window.superRollies.profiles.get(), menu: document.getElementById('menuName').textContent }));
    report(`Profile (${name}): Back drops the changes, Save keeps them past a reload, on the menu's card`,
      dropped === 'Player' && JSON.stringify(kept.profile) === JSON.stringify(SAVED) && kept.menu === SAVED.name,
      JSON.stringify(kept));

    // In a match: the cards, clear of the corners and the dice, for small and
    // big trays and six hearts.
    for (const [set, spice] of [['classic', 'vanilla'], ['the-whole-bag', 'marathon'], ['fireball', 'hit-points']]) {
      await page.evaluate(([diceSet, spice]) => window.superRollies.game.start('quick', { diceSet, spice }), [set, spice]);
      await waitForDiceAtRest(page);
      const cards = await cardLayout(page);
      const ok = Object.values(cards).every((c) => c.dice > 0 && c.corners > 0 && c.nameInside) &&
        cards.player.text === SAVED.name && cards.opponent.text === 'Opponent';
      report(`Profile (${name}): ${set} with ${spice}: both cards named, clear of the corners and the dice`, ok,
        Object.entries(cards).map(([s, c]) => `${s} ${c.dice}px from dice, ${c.corners}px from corners${c.nameInside ? '' : ', NAME OUTSIDE'}`).join('; '));
    }

    // The player's colours on their side; the opponent's never their dice
    // colour, and the same seed the same look.
    const looks = [];
    for (let seed = 1; seed <= 12; seed++) {
      await page.evaluate((seed) => window.superRollies.game.start('quick', { diceSet: 'classic', spice: 'vanilla', seed }), seed);
      looks.push({ ...await drawn(page), opponentProfile: await page.evaluate(() => window.superRollies.game.players.opponent) });
    }
    await page.evaluate(() => window.superRollies.game.start('quick', { diceSet: 'classic', spice: 'vanilla', seed: 1 }));
    const again = await page.evaluate(() => window.superRollies.game.players.opponent);
    report(`Profile (${name}): the player's half and dice in their colours; the opponent's dice never, and the same seed looks the same`,
      looks.every((l) => l.floors.player === tray && l.player === dice && l.opponent !== dice) &&
        new Set(looks.map((l) => l.opponent)).size > 1 && JSON.stringify(again) === JSON.stringify(looks[0].opponentProfile),
      `opponent dice edges: ${[...new Set(looks.map((l) => l.opponent.toString(16)))].join(', ')}`);

    // An emoji name, as long as it gets, stays inside the card.
    await page.evaluate(() => window.superRollies.profiles.save({ ...window.superRollies.profiles.get(), name: '👨‍👩‍👧🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲🎲' }));
    await page.evaluate(() => window.superRollies.game.start('quick', { diceSet: 'classic', spice: 'vanilla' }));
    const emoji = await cardLayout(page);
    report(`Profile (${name}): a 16-emoji name stays inside its card`, emoji.player.nameInside && emoji.player.text.startsWith('👨‍👩‍👧'));

    // Zen: the whole tray the player's colour.
    await page.click('#backBtn');
    await page.click('#zenBtn');
    await page.click('#pickerOptions [data-pick="classic"]');
    const zen = await drawn(page);
    report(`Profile (${name}): Zen's whole tray is the player's colour`, zen.floors.player === tray && zen.floors.opponent === tray);
  } catch (e) {
    report(`Profile (${name})`, false, e.message.split('\n')[0]);
  }
  if (errors.length) report(`Profile (${name}): no page errors`, false, errors.join(' | '));
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed (${engine})` : `\nAll checks passed (${engine})`);
process.exit(failures ? 1 : 0);
