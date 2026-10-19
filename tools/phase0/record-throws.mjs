// Records real throws from the game for Check D (DEV_PLAN 0.7): plays matches
// in Chromium with a spread of different drags, and saves each round's release
// record alongside the exact result the game itself reached.
//
//   node tools/phase0/record-throws.mjs [count=20]           ->   tools/phase0/throws.json
//   node tools/phase0/record-throws.mjs [count=30] --table   ->   tools/phase0/table-throws.json
//
// --table records throws onto the tables Spice change instead (DEV_PLAN.md
// Phase 5): holes in the floor, a breeze, no divider, a cat's paw knocking
// dice at rest, and a rope down the middle, a fifth of the count each. Their records carry what the
// table was like, so they replay the same anywhere too.
//
// Needs the dev server running (npm run dev).

import { writeFile } from 'node:fs/promises';
import { openGame, startQuickGame, throwAndWait, waitForDiceAtRest } from './driver.mjs';
import { mulberry32 } from './rng.mjs';

const TABLE = process.argv.includes('--table');
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? (TABLE ? 30 : 20));
const SPICE = TABLE ? ['pothole', 'gusty-table', 'no-mans-land', 'cat-paw', 'tug-of-war'] : ['vanilla'];
const rand = mulberry32(20);
const { browser, page, errors } = await openGame('chromium');

const throws = [];
await startQuickGame(page);
for (const spice of SPICE) {
  const wanted = throws.length + COUNT / SPICE.length;
  // Handfuls with three d6s, so dice meet; The Classic for the plain throws.
  const diceSet = TABLE ? 'ability-score' : 'classic';
  const start = async () => {
    await page.evaluate(([diceSet, spice]) => window.superRollies.game.start('quick', { diceSet, spice }), [diceSet, spice]);
    await waitForDiceAtRest(page);
  };
  await start();
  while (throws.length < wanted) {
    if (await page.locator('#result.game-over').count()) await start();
    // Soft to hard, straight to sharply angled.
    const length = 120 + rand() * 300;
    const angle = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    const round = await throwAndWait(page, Math.cos(angle) * length, Math.sin(angle) * length);
    // Every throw the round took: a cat's knock is one of its own.
    for (const { record, result } of TABLE ? round.throws : [round]) {
      // Of Cat Paw's, only the knocks: a die lying on the table set moving.
      const knock = record.dice.some((d) => d.p[1] < 1 && d.v.some((v) => v !== 0));
      if (spice === 'cat-paw' && !knock) continue;
      throws.push({ spice: TABLE ? spice : undefined, record, digest: result.digest, faces: result.dice.map((d) => d.face) });
    }
  }
}
const browserVersion = browser.version();
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));

const file = TABLE ? './table-throws.json' : './throws.json';
await writeFile(new URL(file, import.meta.url), JSON.stringify({
  note: `Real throws recorded by tools/phase0/record-throws.mjs${TABLE ? ' --table' : ''}, with the result the game reached.`,
  recordedIn: `Chromium ${browserVersion}`,
  throws,
}, null, 1) + '\n');
console.log(`Recorded ${throws.length} throws in ${file}.`);
