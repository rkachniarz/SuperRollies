// Records real throws from the game for Check D (DEV_PLAN 0.7): plays matches
// in Chromium with a spread of different drags, and saves each round's release
// record alongside the exact result the game itself reached.
//
//   node tools/phase0/record-throws.mjs [count=20]   ->   tools/phase0/throws.json
//
// Needs the dev server running (npm run dev).

import { writeFile } from 'node:fs/promises';
import { openGame, startQuickGame, throwAndWait } from './driver.mjs';
import { mulberry32 } from './rng.mjs';

const COUNT = Number(process.argv[2] ?? 20);
const rand = mulberry32(20);
const { browser, page, errors } = await openGame('chromium');
await startQuickGame(page);

const throws = [];
while (throws.length < COUNT) {
  if (await page.locator('#result.game-over').count()) {
    await page.waitForSelector('#menu:not([hidden])');
    await startQuickGame(page);
  }
  // Soft to hard, straight to sharply angled.
  const length = 120 + rand() * 300;
  const angle = -Math.PI / 2 + (rand() - 0.5) * 2.4;
  const { record, result } = await throwAndWait(page, Math.cos(angle) * length, Math.sin(angle) * length);
  throws.push({ record, digest: result.digest, faces: result.dice.map((d) => d.face) });
}
const browserVersion = browser.version();
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));

await writeFile(new URL('./throws.json', import.meta.url), JSON.stringify({
  note: 'Real throws recorded by tools/phase0/record-throws.mjs, with the result the game reached.',
  recordedIn: `Chromium ${browserVersion}`,
  throws,
}, null, 1) + '\n');
console.log(`Recorded ${throws.length} throws.`);
