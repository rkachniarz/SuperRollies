// The five checks from CLAUDE.md, run against the real game in a browser.
//
//   node tools/phase0/verify.mjs
//
// Chromium only for now (DEV_PLAN.md, D14). An engine name as the argument
// (firefox, webkit) runs it elsewhere, for the post-MVP compatibility work.
//
// Needs the dev server running (npm run dev). Each check gets a fresh match, so
// one that happens to end early can't leave the next on the game-over card.

import { TRAY_DEPTH, TRAY_HALF_WIDTH, DIE_RADIUS } from '../../src/config.js';
import { openGame, startQuickGame, startMode, waitForDiceAtRest, dieScreenPos, drag, throwAndWait } from './driver.mjs';

const engine = process.argv[2] ?? 'chromium';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

let failures = 0;
function report(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}

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

// 1. 20 decals per die, and at rest at least one squarely faces the camera.
await withMatch(DESKTOP, '1', async (page) => {
  await throwAndWait(page);
  const decals = await page.evaluate(() => {
    const { arena, dice } = window.superRollies;
    const view = arena.camera.getWorldDirection(arena.camera.position.clone());
    return Object.fromEntries(Object.entries(dice).map(([id, { mesh }]) => {
      const planes = mesh.children.filter((c) => c.type === 'Mesh');
      // A decal faces along its local +Z; facing the camera means pointing
      // against the view direction.
      const best = Math.max(...planes.map((p) => -p.getWorldDirection(view.clone()).dot(view)));
      return [id, { count: planes.length, best }];
    }));
  });
  for (const [id, { count, best }] of Object.entries(decals)) {
    report(`1. ${id} die: 20 decals, one squarely facing the camera`, count === 20 && best > 0.8,
      `${count} decals, best facing ${best.toFixed(3)}`);
  }
});

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
    const from = await dieScreenPos(page);
    await throwAndWait(page, page.viewportSize().width / 2 - from.x, -160 - (i % 3) * 60);
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

// 4. On a 390x844 viewport the die is still reachable at its sideways limit.
await withMatch(PHONE, '4', async (page) => {
  for (const side of [1, -1]) {
    // A hard sideways throw ends up at the sideways limit.
    await throwAndWait(page, side * 400, -40);
    const p = await dieScreenPos(page);
    const onScreen = p.x > 0 && p.x < PHONE.width && p.y > 0 && p.y < PHONE.height;
    const said = await pressAt(page, p);
    report(`4. die reachable at its ${side > 0 ? 'right' : 'left'} limit on 390x844`,
      onScreen && said === 'Let go to throw', `rests at x=${p.x.toFixed(0)}px; card said "${said}"`);
    if (await page.locator('#result.game-over').count()) break;
  }
});

// 5. A full match drains hearts to 0, announces the result, returns to the menu.
await withMatch(DESKTOP, '5', async (page) => {
  let announced = null;
  for (let i = 0; i < 40 && !announced; i++) {
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

// Zen: one die, the whole tray, no score, and a way back to the menu.
for (const [name, viewport] of [['desktop', DESKTOP], ['390x844', PHONE]]) {
  await withMatch(viewport, `Zen (${name})`, async (page) => {
    const layout = await page.evaluate(() => ({
      opponentShown: window.superRollies.dice.opponent.mesh.visible,
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
      const p = dice.player.mesh.position.clone().set(-xMax, DIE_RADIUS, -TRAY_DEPTH + 0.45);
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
      opponent: window.superRollies.dice.opponent.mesh.visible,
      divider: window.superRollies.arena.divider,
      playerZ: window.superRollies.dice.player.mesh.position.z,
    }));
    report(`Zen (${name}): back to menu, then Quick Game restores the table`,
      atMenu && restored.opponent && restored.divider && restored.playerZ > 0);
  }, '#zenBtn');
}

console.log(failures ? `\n${failures} check(s) failed (${engine})` : `\nAll checks passed (${engine})`);
process.exit(failures ? 1 : 0);
