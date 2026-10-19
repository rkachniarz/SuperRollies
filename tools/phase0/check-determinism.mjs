// Check D (DEV_PLAN 0.7): recorded throws replay bit-identically everywhere.
//
//   node tools/phase0/check-determinism.mjs
//
// Replays tools/phase0/throws.json and table-throws.json (real throws, with
// the result the game reached in Chromium when they were recorded) in Node, then in headless
// Chromium via determinism.html, and compares every final position and
// orientation bit for bit. Needs the dev server running (npm run dev).
//
// Real devices are checked by opening the same page on them:
//   http://<this machine's address>:8000/tools/phase0/determinism.html
// Per DEV_PLAN D14, that means Android Chrome for now; Firefox, Safari and iOS
// are post-MVP.

import { readFile } from 'node:fs/promises';
import { initPhysics } from '../../src/physics.js';
import { replayThrow } from '../../src/replay.js';
import { openGame } from './driver.mjs';

const load = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
// Plain throws, and throws onto the tables Spice change (holes, a breeze, no
// divider, a cat's knock): record-throws.mjs --table.
const { throws: plain, recordedIn } = await load('./throws.json');
const { throws: table } = await load('./table-throws.json');
const throws = [...plain, ...table];
let failures = 0;

// ---------- Node ----------
await initPhysics();
const nodeMismatches = throws.filter(({ record, digest }) => replayThrow(record).digest !== digest).length;
// Replaying twice in one process must agree too: nothing may leak between worlds.
const again = throws.filter(({ record, digest }) => replayThrow(record).digest !== digest).length;
console.log(`${nodeMismatches || again ? 'FAIL' : 'PASS'}  Node ${process.version}: ` +
  `${throws.length - nodeMismatches} of ${throws.length} identical to ${recordedIn} (second pass: ${throws.length - again})`);
if (nodeMismatches || again) failures++;

// ---------- Chromium ----------
const { browser, page, errors } = await openGame('chromium', undefined, 'tools/phase0/determinism.html');
await page.waitForFunction(() => window.determinismResult, null, { timeout: 60000 });
const result = await page.evaluate(() => window.determinismResult);
await browser.close();
console.log(`${result.pass ? 'PASS' : 'FAIL'}  Chromium ${browser.version()}: ` +
  (result.error ?? `${result.total - result.mismatches.length} of ${result.total} identical`));
if (!result.pass || errors.length) failures++;
if (errors.length) console.log(errors.join('\n'));

process.exit(failures ? 1 : 0);
