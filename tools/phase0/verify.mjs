// The checks from CLAUDE.md, run against the real game in a browser.
//
//   node tools/phase0/verify.mjs
//
// Chromium only for now (DEV_PLAN.md, D14). An engine name as the argument
// (firefox, webkit) runs it elsewhere, for the post-MVP compatibility work.
//
// Needs the dev server running (npm run dev). Each check gets a fresh match, so
// one that happens to end early can't leave the next on the game-over card.

import { TRAY_DEPTH, TRAY_HALF_WIDTH, DIE_RADIUS } from '../../src/config.js';
import { DICE_SETS } from '../../src/rules/dice-sets.js';
import { openGame, startQuickGame, startMode, waitForDiceAtRest, dieScreenPos, drag, throwAndWait } from './driver.mjs';

const engine = process.argv[2] ?? 'chromium';
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
        // Cocked against a wall or another die (DEV_PLAN.md D24): nothing need
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

// 5. A full match drains hearts to 0, announces the result, returns to the menu.
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
  report('5. full match ends and returns to the menu', !!announced && outOfHearts && backAtMenu,
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
    const { faces, kept, scores } = round.outcome;
    const lines = await page.$$eval('#result .breakdown', (els) => els.map((el) => ({
      text: el.textContent, dropped: el.querySelectorAll('.dropped').length,
    })));
    const expected = ['player', 'opponent'].map((side, i) =>
      `${['You', 'Opponent'][i]}: ${(DICE_SETS[set].scorer.labels?.(faces[side]) ?? faces[side]).join(' + ')} = ${scores[side]}`);
    const ok = allHeld && faces.player.length === count && faces.opponent.length === count &&
      lines.length === 2 && lines.every((l, i) => l.text === expected[i] && l.dropped === dropped) &&
      kept.player.filter((k) => !k).length === dropped;
    report(`Handful: ${set} (${count} dice) picked up together, thrown, added up on the card`, ok,
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
    const layout = await page.evaluate(() => ({
      opponentShown: window.superRollies.dice.opponent.length > 0,
      hearts: !document.getElementById('youHud').hidden || !document.getElementById('opponentHud').hidden,
    }));
    report(`Zen (${name}): no opponent die, no hearts`, !layout.opponentShown && !layout.hearts);

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

console.log(failures ? `\n${failures} check(s) failed (${engine})` : `\nAll checks passed (${engine})`);
process.exit(failures ? 1 : 0);
