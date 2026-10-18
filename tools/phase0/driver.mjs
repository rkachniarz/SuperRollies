// Drives the game in a real browser through Playwright: start a match, find the
// die on screen, drag it, wait for the round. Shared by the Phase 0 scripts.
//
// Expects the dev server (npm run dev) on BASE_URL.

import { chromium, firefox, webkit } from 'playwright';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8000/';
export const ENGINES = { chromium, firefox, webkit };

export async function openGame(engine = 'chromium', viewport = { width: 1280, height: 800 }, path = '') {
  const browser = await ENGINES[engine].launch();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE_URL + path);
  return { browser, page, errors };
}

/** Waits for the physics engine to load and starts a Quick Game with `diceSet` (an id) and `spice`. */
export function startQuickGame(page, diceSet = 'classic', spice = 'vanilla') {
  return startMode(page, '#quickGameBtn', { pick: diceSet, spice });
}

/**
 * Waits for the physics engine to load and starts the mode behind `button`.
 * Zen: picks `pick` from its catalogue, a dice set's id or `die:<type>` for
 * one die alone. Quick Game: opens the draft, which deals two random dice
 * sets, so the match is then started with `pick` and `spice` directly (the
 * draft itself has a check of its own). The default is The Classic, Vanilla.
 */
export async function startMode(page, button, { pick, spice = 'vanilla', pickAfter = false, waitForRest = true } = {}) {
  await page.waitForSelector(`${button}:not([disabled])`, { timeout: 30000 });
  await page.click(button);
  // `pickAfter` leaves the picker open, for a check that looks at it first.
  if (pickAfter) return;
  if (button === '#quickGameBtn') {
    await page.evaluate(([diceSet, spice]) => window.superRollies.game.start('quick', { diceSet, spice }),
      [pick ?? 'classic', spice]);
  } else {
    await page.click(`#pickerOptions [data-pick="${pick ?? 'classic'}"]`);
  }
  if (waitForRest) await waitForDiceAtRest(page);
}

/** Waits until no throw (or fumbled drop) is still being simulated. */
export async function waitForDiceAtRest(page) {
  await page.waitForFunction(() => !window.superRollies.roller.busy, null, { timeout: 15000 });
}

/** Where a die is on screen, in CSS pixels: a side's first die, or its die `index`. */
export function dieScreenPos(page, side = 'player', index = 0) {
  return page.evaluate(([side, index]) => {
    const { arena, dice } = window.superRollies;
    const v = dice[side][index].mesh.position.clone().project(arena.camera);
    const r = arena.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, [side, index]);
}

/**
 * Grabs the player's dice and drags them by (dx, dy) pixels over `steps` pointer
 * moves, then lets go. Returns the result card's headline straight after.
 */
export async function drag(page, dx, dy, steps = 8, from = null) {
  const start = from ?? await dieScreenPos(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  return page.textContent('#resultHeadline');
}

/** Throws and waits for the round to finish. Resolves with that round's entry. */
export async function throwAndWait(page, dx = 0, dy = -260) {
  const before = await page.evaluate(() => window.superRollies.rounds.length);
  await drag(page, dx, dy);
  await page.waitForFunction((n) => window.superRollies.rounds.length > n, before, { timeout: 15000 });
  return page.evaluate(() => JSON.parse(JSON.stringify(window.superRollies.rounds.at(-1))));
}
