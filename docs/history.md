# Super Rollies — development history

Phases 0 to 6b of the Dice & Spice expansion as they were done: what each
task turned into, and what playtesting and measurement found on the way. It's
kept because code, tests and tools cite task numbers (`0.5`, `4.6a`, `5.1`)
and `§8`, and because the measurements behind a fix are here. None of it is
current work (that's [DEV_PLAN.md](../DEV_PLAN.md)), and the traps that still
matter are in `CLAUDE.md`.

## Milestones

**Starting point (2026-10-16):** one die type (d20), one die per side, an
AI opponent that throws at random, and rules hard-coded in `game.js` `runRound()`
(higher roll wins, ties cost nothing, 3 hearts). No multiplayer code.
Since Phase 0 (2026-10-17): physics on Rapier, and a Zen mode (D15).
Since Phase 1 (2026-10-17): a seeded RNG, and the rules in a pure engine
(`src/rules/`) with Vanilla, Hearts and The Classic as its only entries.
Since Phase 2 (2026-10-17): the d6, handfuls of up to 8 dice a side, and eight
dice sets, picked from a list for now (D19); Zen offers all of them, and each
die type alone (D18).
Since Phase 3 (2026-10-18): every die type, d4 to d20 and percentile.
Since Phase 4 (2026-10-18): the two-card draft (dice, then Spice), sixteen
rules-only Spice, the in-match Dice/Spice label with its rules, and Zen's
catalogue of cards.
Since Phase 5 (2026-10-19): Spice on the table (Pothole, Cat Paw, Gusty Table,
No Man's Land), re-throws (Second Wind, Mercy), three more ways to win (Hit
Points, Race to N, Tug of War), Doubles Again and Death Saves: 28 Spice.
Since Phase 6 (2026-10-19): Dice Poker scored as poker hands, and Draw Poker's
redraw of chosen dice; Count the Sixes, Burnout, Crown and Wild Magic: 33 Spice.
Since Phase 6b (2026-10-21): a player profile (name, card, tray and dice
colours, saved on the device), each side shown as a card, and the editor.

---

## 7. Phases

### Phase 0 — Physics trial: Rapier

Answers Q3 and settles D10. Do this before Phase 1: physics code runs through
`dice.js`, `arena.js`, `input.js`, `game.js` (sleep events) and `main.js`, so
porting is cheapest while there is only one die type. Keep the trial separate
from the working game until it passes.

Trial lives on branch `phase-0-rapier`. Check scripts are in `tools/phase0/`:
`npm run verify` (the five browser checks) and `npm run phase0` (Checks B, C
and D); both need `npm run dev` running.

- [x] **0.1** Port the current 1d20 game to Rapier
  (`@dimforge/rapier3d-compat`, deterministic build, pinned in the import map).
  Add a loading step while the WebAssembly initialises.
  - Package is `@dimforge/rapier3d-deterministic-compat@0.21.0` (the
    deterministic build of the compat package, WebAssembly inlined).
  - Physics is in `src/physics.js`, free of the DOM so it also runs in Node.
    A **fresh world is built for every throw** from its release record, rather
    than one long-lived world: the engine's internal state between steps
    (contact caches, warm-starting) can't be captured in a record, so this is
    what makes a replay exact. The held die is no longer a physics body; it
    just follows the pointer.
  - Quick Game is disabled and reads "Loading…" until the WebAssembly is ready.
- [x] **0.2** Fixed-step physics loop decoupled from frame rate, with render
  interpolation (R5.4). `src/roll.js`; 60 Hz, at most 5 steps per frame.
- [x] **0.3** Throw-recording harness: capture a throw's release state, replay
  it, and output final positions and orientations. Reused by the checks below,
  by Playwright tests, and by multiplayer later. `src/replay.js`. The game keeps
  every round's record and result (`window.superRollies.rounds`). The record
  includes the thrower's on-screen sideways limit (`arenaHalfWidth`), which
  depends on screen size. That keeps a replay on a different-sized screen
  exact.
- [x] **0.4 Check A — feel.** Throws, bounces and settling feel at least as good
  as on cannon-es. Judged by playing it on desktop and on a phone. *Passed.*
  Two things came out of playing it, both fixed and measured against the old
  cannon-es setup run in Node on the same throws:
  - **Dice felt heavy:** they bounced about 25% lower and 40% less often.
    Die-floor restitution raised to 0.375, which matches cannon-es's bounce
    height. Travel is still ~10% shorter, a difference in how the engines
    solve contacts that friction and damping don't change.
  - **Slow to stop against a side wall.** This was `clampToArena` holding dice
    to the on-screen limit by moving them, 0.13 in front of the real wall.
    Dice leaning on it crawled for seconds (1 throw in 80 hit the 4 s
    timeout). The on-screen limit is now made of **real side-wall colliders**
    (`sideWallFace` in `physics.js`): on desktop the tray's own walls, on a
    narrow screen invisible walls at its edges. `clampToArena` remains only
    as the tunnelling safety net, at the real walls. Worst settle time went
    from 4.0 s to 2.6 s.
  - Dice cocked against a wall: about 3.5% of throws, fewer than under
    cannon-es (5.8%, some leaning on its invisible clamp wall).
- [x] **0.5 Check B — d10 collider.** A convex-hull collider for the
  pentagonal trapezohedron (kite faces) settles flat on a face and never on an
  edge or point. *Passed: 10,000 throws, none off flat in the open, none timed
  out.* Getting there found two problems with how a throw ends, both fixed and
  both affecting the d20 too:
  - Rapier's own auto-sleep froze dice still slowly toppling off an edge
    (around 1 throw in 100 for the d10). It is now off; the game's settle
    check is the only thing that puts a die to sleep.
  - "Slow for a moment" isn't "at rest": a die can pause at the tipping point.
    Settling now also requires the die's contact points to span an area, not
    a line (`restsOnFace` in `physics.js`). Contact-point *counts* don't work:
    Rapier can report several along a single edge.
  - About 1.3% of d10 throws come to rest **cocked** against a wall, as real
    dice do. Phase 3 (3.4) needs a rule for this: re-throw, or read the
    most-upward face. *Read as it lies (D24).*
  - `clampToArena` holds a die by moving it, which makes it an invisible,
    frictionless wall that a d10 can rest leaning against. On desktop it sits
    0.13 inside the real wall, on phones further in. Pre-existing (cannon-es
    had the same). *Fixed under 0.4: the on-screen limit is now real
    side-wall colliders.*
- [x] **0.6 Check C — no tunnelling.** With `clampToArena` disabled, 200 throws
  at maximum speed: zero dice leave the tray or cross the divider. *Passed: also
  run with 5,000 throws (10,000 dice), a third aimed straight at walls,
  corners and the divider, checked at every step. None escaped.*
- [x] **0.7 Check D — determinism.** 20 recorded throws replayed in desktop
  Chrome, Firefox and Safari, iOS Safari and Android Chrome produce
  bit-identical final positions and orientations. *(Per D14: Node, desktop
  Chromium and Android Chrome for now; Firefox, Safari and iOS post-MVP.)*
  - [x] 20 real throws recorded from the game (`tools/phase0/throws.json`)
    replay bit-identically in Node and headless Chromium, and both match what
    the live game reached.
  - [x] Android Chrome (Pixel 9 Pro): `/tools/phase0/determinism.html` from
    the dev server passes.
- [x] **0.8** Bundle check: `npm run build` still produces a working artifact
  with Rapier loaded from the CDN.
  - [x] The built file plays a full round in Chromium, with Rapier loaded from
    jsdelivr.
  - [x] Works on claude.ai: published as a separate, private trial artifact
    (https://claude.ai/artifact/6fibqTnv6n2rVWrSMgF9nL), so the main artifact
    stays on cannon-es until 0.9. Its sandbox has to allow WebAssembly.
- [x] **0.8a** Zen mode and a back-to-menu button *(D15)*, checked by
  `npm run verify`.
  - Dice now start each match **placed** flat on a face, not dropped. Dropped
    from rest in their default orientation, they landed exactly on a level
    edge and stayed balanced there (deterministic, so nothing tips them).
    That held the opening "settle" for the full 4 s timeout, and the die
    couldn't be picked up in that time.
  - Known issue for later: the layout on a real phone (Pixel 9 Pro) needs
    work.
- [x] **0.9 Decision.** All checks pass: adopt Rapier, update D10 and Q3, and
  delete R4.3b and task 7.5b. *Done: Rapier adopted (D10).*
- [x] **0.10** Docs refresh. If Rapier is adopted: `CLAUDE.md`, `README.md`
  and code comments stop referring to cannon-es, and the `clampToArena` entry
  is re-evaluated (it may stay as a cheap safety net). *Done. It stays, as a
  safety net only; the on-screen limit is now colliders. `CLAUDE.md` also
  gains the Phase 0 traps (fresh world per throw, Rapier sleep off,
  rest-on-face settling, no `Math.hypot`, dice placed not dropped).*

### Phase 1 — Core refactor

Behaviour is unchanged: 1d20 vs. AI plays exactly as it does today.

- [x] **1.0** Test tooling: `npm test` runs `node:test` suites; Playwright
  added as a dev dependency, with the current five checks from `CLAUDE.md`
  scripted (R5.5, R5.6). *Playwright and the scripted checks came with
  Phase 0 (`npm run verify`); `npm test` runs `test/**/*.test.js`.*
- [x] **1.1** Seeded RNG module; route all game randomness through it (R5.2).
  *`src/rng.js` (mulberry32, the generator the Phase 0 tools already used,
  which now import it from there). No `Math.random()` left in `src/`: the
  opponent's throw and the player's spin jitter each have a stream derived
  from the match seed (D16). The seed comes from `crypto.getRandomValues`;
  `game.start(mode, seed)` takes one explicitly, for tests.*
- [x] **1.2** Match config object: `{ seed, diceSet, spice }`. *`matchConfig()`
  in `src/rules/engine.js`; ids, not objects (D16).*
- [x] **1.3** Pure rules engine, extracted from `game.js` `runRound()`: takes
  the config, the match state and both sides' face values; returns the round
  outcome and the new match state. *`startMatch`, `beginRound`, `playRound`.
  The rules stream's state lives in the match state, so the engine stays
  pure even when a Spice draws random numbers.*
- [x] **1.4** Spice hook interface (R3.1) with Vanilla as the only
  implementation. *`src/rules/spice.js`; `setup`, `beforeThrow`, `score`,
  `compare` and `applyDamage` are called by the engine and covered by a test
  Spice; `afterSettle` is typed only (D16).*
- [x] **1.5** `winCondition` hook with Hearts (3) as the default; `hud.js`
  renders from it instead of assuming hearts (R3.4). *A win condition has
  `init`, `damage`, `apply`, `matchWinner` and `view`; `hud.showMatch` draws
  the view.*
- [x] **1.6** Dice-set definition format (die types, count, scorer, scale, tray
  size), with The Classic (1d20) as the only entry. *`src/rules/dice-sets.js`.
  Scale and tray size are declared but not yet read; Phase 2 (2.5) uses
  them.*
- [x] **1.6a** `// @ts-check` and JSDoc types for the match config, dice-set
  and Spice definitions, and the rules engine. *`src/rules/types.js`. Clean
  under `tsc --strict --checkJs` (run once via `npx`, not a dependency).*
- [x] **1.6b** Unit tests for the rules engine, Hearts and Vanilla. *30 tests
  in `test/`.*
- [x] **1.7** Verification checklist passes; artifact republished. *All
  `npm run verify` checks pass, plus a new one: the same seed throws the
  opponent's die the same way. `npm run phase0` passes. Republished as
  version 14.*
  - **Open:** one run in six of `npm run verify` failed "Zen (390x844)" with
    a 15 s `waitForFunction` timeout (a throw that never produced a round);
    the next four runs passed. Not yet diagnosed, and it isn't known whether
    it predates Phase 1.
- [x] **1.8** Docs refresh. *`README.md` file map and checks; `CLAUDE.md`
  commands, three new entries (pure rules engine, one RNG stream per
  consumer, HUD draws the win condition's view) and check 8. `index.html`
  and `package.json` copy unchanged: the game plays as before.*

### Phase 2 — Multiple dice and the d6

- [x] **2.1** d6: geometry, numbering (opposite faces sum to 7), decals, physics
  shape, face-up reader. *`src/d6.js`: a cube with its corners cut off a
  little, pips rather than numerals (D20).*
- [x] **2.2** Generalise `dice.js` so die type is a parameter; d20 behaviour
  unchanged. *`src/die-shapes.js` derives normals, rest pose, face reader and
  hull from any die's vertices and numbered faces. The d20's vertices,
  numbering and hull are bit-identical to before: the 20 recorded throws still
  replay exactly.*
- [x] **2.3** Multi-die sides: spawn layout, handful grab/throw with per-die
  scatter (R2.3). *`src/handful.js` (layout, scatter, the opponent's throw)
  and `src/table.js` (each side's dice per match). Grabbing any die picks up
  the whole handful; the dice glide into place round the pointer and are
  released from where they were headed. A single die is thrown exactly as
  before, with no scatter and the same random draws.*
  - *Fixed after playtesting: Fireball dice that came to rest against a side
    wall jumped ~0.2 inwards as the throw ended. Keeping dice on screen
    between throws held them a circumradius from the wall, but a d6 lying
    against one sits only half its side away. It now goes by each die's
    actual sideways reach. `npm run verify` checks dice stay put, and that
    narrowing the window still slides them back on screen.*
- [x] **2.3b** A held handful jiggles: dice bunch up close, tumble, and
  knock into each other while held (D22), lying in a palm as real dice do
  (D23). *New requirement, added after playtesting, then reworked after a
  second round of it. Tuning is in `config.js` (`HOLD_*`).
  `check-handfuls.mjs` holds every set for up to 10 s with the hand jumping
  about the tray, harsher than any real drag, then lets go: overlap at
  release at most ~4 cm, shove at most 0.05 units/s, and a die put back in
  the palm by the safety net in at most 1 hold in 100 (Fireball, the worst:
  1 in 300). Held still, a d6 turns over about once every 10 s, and a
  Fireball handful has a die resting partly on the others about half the
  time. `npm run verify` checks the handful is lifted and bunched (Fireball:
  spread 2.15 → ~1.1).*
- [x] **2.4** Wait for N dice to settle, with the existing settle timeout per die.
  *All dice are released together, so the one 4 s timeout covers each of
  them. Two bugs only handfuls could hit, both fixed in `physics.js`:*
  - *A settled die put to sleep while another, still moving, touched it sank
    through the floor (Rapier keeps applying gravity to it with no contact).
    It happened in roughly 1 Fireball throw in 3. Now such a die stays awake
    and counts as settled while it stays quiet (`touchesAnotherDie`).*
  - *Dice leaning on each other never counted as resting on a face: Rapier
    holds two moving bodies 1–2 cm apart, beyond the 1 cm "touching"
    threshold. Die-to-die contacts now use 3 cm (`TOUCHING_DIE`).*
  - *New physics check, `tools/phase0/check-handfuls.mjs` (in `npm run
    phase0`): every multi-die set, both sides at once, up to full speed;
    nothing sinks or escapes. **Known:** ~0.3% of throws (1.3% for 8d6) end on
    the timeout with a die still creeping slowly, typically down another die
    pinned against a wall. It is read where it lies, like a cocked die; see
    3.4.*
- [x] **2.5** Per-dice-set scale and tray size; camera fitting; confine-to-screen
  bounds follow the tray (R2.2). *`arena.setTray`: the tray is rebuilt, the
  camera pulled back by the tray's scale (D21), near/far recomputed tightly
  around it (≈9–15 for The Classic, ≈14.5–21.5 for Fireball's), and the
  on-screen limit re-measured. `clampToTray` and `opponentZone` take the
  handful's reach.*
  - Camera near/far is **recomputed tightly** around each tray, never widened
    to a range that covers them all. The depth-precision invariant in
    `CLAUDE.md` still applies; only the fixed 8–20 values go.
  - `arenaHalfWidth` and `clampToTray` in `arena.js` are currently computed
    once at module scope from `TRAY_HALF_WIDTH`, `TRAY_DEPTH` and
    `DIE_RADIUS`. They must be recomputed whenever the dice set changes, not
    just on resize.
- [x] **2.6** Measure whether 8d6 fits and stays reachable on 390×844; enlarge
  the tray if not. *It didn't fit The Classic's tray: a held 8d6 handful is
  ~3.3 deep, leaving no room to move it in a 3.1-deep half. Fireball plays on
  a tray 1.45× The Classic's with dice at 0.9 scale; 3d6 to 5d6 at 1.15–1.25×.
  On 390×844 every Fireball die stays on screen and grabbable at both
  sideways limits (verify check 4).*
- [x] **2.7** Scorers: `sum`, `keepHighest`, `dropLowest`, with unit tests.
  *Each says which dice it `kept`; of equal dice, the later is dropped, so
  it's the same on every client. Notation gains the usual suffix
  (`2d20kh1`, `4d6dl1`).*
- [x] **2.8** Result breakdown on the result card (R2.5). *One line per side,
  `You: 6 + 4 + 1 + 5 = 16`, dropped dice greyed and struck through; one die
  a side keeps the old "You rolled 17 · Opponent rolled 9". The round outcome
  carries `kept`.*
- [x] **2.9** AI opponent throws a handful the same way. *`randomHandful`.*
- [x] **2.10** Dice sets enabled: Greatsword, Ability Score, Heroic Stats,
  Guiding Bolt, Fireball, Dice Poker (scored as a sum until Phase 6), Advantage
  (needs only d20). *Played from an interim list (D19).*
- [x] **2.10a** Zen offers every dice set and every die type alone, and
  every new one joins it (D18). A handful in Zen is totalled with its set's
  scorer, the breakdown under it.
- [x] **2.11** Verification checklist passes for 1, 2, 5 and 8 dice; artifact
  republished. *`npm run verify`: check 1 for the d20, the d6 and 16 dice at
  once, including that the face read is the one on top (§8, 6); check 4 for
  1 and 8 dice on 390×844; handful checks for 2, 4, 5 and 8 dice; the Zen
  picker. `npm test` (51) and `npm run phase0` pass. Republished as version
  17.*
- [x] **2.12** Docs refresh. In `CLAUDE.md`: check 1 ("20 decals per die")
  becomes per die type, matching §8; the camera near/far entry describes the
  per-tray computation. *Also: the two physics traps above, the wall
  clearance entry generalised to handfuls, Zen's die list (D18), and checks
  1, 4, 7–9. `README.md` file map, `index.html` copy and `package.json`
  description no longer describe a d20-only game.*

### Phase 3 — Remaining die types

- [x] **3.1** d4 (read from the top vertex). Its three numerals per face sit
  near the corners, not one centred decal, so the `inradius × √2` decal-size
  rule does not apply; it needs its own bound (and its own `CLAUDE.md` entry)
  to keep numerals off neighbouring faces. *`src/d4.js`. The game reads the
  face it lies on (`reads: 'down'`), numbered with the corner it doesn't
  touch. Numerals sit halfway to their corner, 0.68× the face's inradius
  (the bound is 0.73×), and fill their decal: at first they were specks from
  the game's camera, the faces sloping 70° away. Fair over 40,000 throws.*
- [x] **3.2** d8. *`src/d8.js`: opposite faces sum to 9.*
- [x] **3.3** d12. *`src/d12.js`: opposite faces sum to 13. It came to rest
  cocked against a wall, perfectly still, yet never counted as settled (1
  throw in 700 waited out the timeout): Rapier held one floor corner 1–2 cm
  up, beyond what counts as touching. Fixed by D24's "dead still" rule, not
  by loosening "touching", which froze d20s still toppling off a wall.*
- [x] **3.4** d10 (pentagonal trapezohedron, 0–9). *`src/d10.js`: Check B's
  shape to the bit. "0" counts as 10 (D25); opposite faces sum to 11, evens
  round one point. A cocked die is read as it lies (D24).*
- [x] **3.5** Percentile d10 (00–90) and the percentile scorer. *Same shape,
  `d%`; `percentile` in `dice-sets.js` (D25).*
- [x] **3.6** Decal sizing per face shape, keeping the decal inside its face.
  The `inradius × √2` bound holds for any face with an incircle (including the
  d10's kites), provided the inradius is measured per die type. *Decal layout
  moved from `dice.js` into `die-shapes.js` as plain data, so
  `test/dice.test.js` checks every decal's corners lie inside its face, and
  no two on a face overlap, for every die type (and fails when either is
  broken on purpose). Lone 6s and 9s are underlined; "00" is shrunk to fit.*
- [x] **3.7** Dice sets enabled: Greataxe, Magic Missile, Swarm of Daggers,
  Divine Smite, Percentile, Sneak Attack, The Whole Bag. *In the catalogue's
  order. Notation `d% + d10` for Percentile.*
- [x] **3.8** Verification checklist passes for every die type; artifact
  republished. *`npm test` (107). `npm run phase0`: `check-d10.mjs` became
  `check-dice.mjs`, 2,000 throws of every die type (fails on any die settled
  off flat in the open, or over 1 in 1,000 timeouts; the d6 can balance on a
  cut corner for a while, ~1 in 5,000); every new set in `check-handfuls`; the
  20 recorded throws still replay bit-identically. `npm run verify`: check 1
  for every die type (via The Whole Bag and Percentile), check 4 for The
  Whole Bag, handfuls for Percentile, Magic Missile and The Whole Bag, each
  die alone in Zen. The built file plays The Whole Bag in Chromium.
  Republished as version 22.*
  - *Fixed after playtesting: d4s at rest by a side wall jumped up to 0.45
    inwards, often into their neighbours (which looked like dice sinking
    into each other). Keeping dice on screen took a die's sideways reach as
    the same both ways, true of every die but the d4: against a wall on a
    face, its top corner reaches three times as far the other way. Now each
    side is measured separately. Measured first: at rest, d4s overlap each
    other by at most 3 cm, the same as d6s; mid-flight no deep overlap lasts
    over 5 steps. The "stay put" check now runs Swarm of Daggers too, and
    failed on the old code (6 dice moved). Check 1 no longer demands a cocked
    die face the camera (D24), and allows a d4 0.4, which turned 60° from a
    face is all it can manage. Republished as version 23.*
- [x] **3.9** Docs refresh. `README.md` file map no longer describes dice as
  d20-only. *Also `CLAUDE.md`: the decal entries now point at
  `die-shapes.js`, a d4 entry, the settle rule, checks 1, 4, 7 and 9.*

### Phase 4 — Setup screen and rules-only Spice

- [x] **4.1** Card component (name, notation, summary, icon) (R1.4).
  *`src/cards.js`: one renderer for dice sets, Spice and single dice. Dice
  cards are orange, with each die type drawn as an outline (The Whole Bag
  shows all six, smaller); Spice cards are purple, with an emoji and what kind
  of Spice it is ("Rule change", "How to win", "Comeback", "For these dice").
  Dice sets gain a `summary` and `range`; Spice an `icon`, `kind`, and full
  `rules`.*
- [x] **4.2** Two-step draft screen: 2 random dice cards, then 2 eligible Spice
  cards (R1.1–R1.3). *`src/rules/draft.js` deals them from the match seed
  (R1.6); back from the Spice step returns to the same two dice cards. D29.*
- [x] **4.3** Catalogue screen (full list, used by the multiplayer host in
  Phase 7) sharing the card component. *Compact cards in a scrolling list;
  Zen's picker for now (D29). The menu overlay scrolls (`touch-action:
  pan-y` on it alone, so a drag on the table is still only ever a throw).*
- [x] **4.4** In-match Dice/Spice label with a full-rules popup (R1.5).
  *Top-right, mirroring the back button: the set's and the Spice's names,
  one line each. Tapped, it shows both cards with their full rules (Escape,
  a tap outside, or "Back to the table" closes it). Not shown in Zen.*
- [x] **4.5** Eligibility filtering (R3.2). *`isEligible` in `engine.js`,
  reading every field, plus `excludeDiceSets` (D28). Every set has at least
  two Spice to offer.*
- [x] **4.6** State-based advantage indicator (R3.5). *A Spice's `edge`
  names who holds it; the HUD shows it as a badge by that side's name ("+1
  die", "Inspired: advantage", "Revenge: a win costs double"). What a Spice
  announces for the round (a cursed number, the stakes) is a pill under the
  opponent's hearts, and a line on the result card.*
- [x] **4.6a** Tappable board UI placement. The `#result` card is
  `pointer-events: none` because it sits where the die rests against the
  divider. Extend that principle to all new on-board UI (the Dice/Spice label
  here; the Second Wind button and Dice Poker reroll selection later): nothing
  tappable may sit where dice come to rest. Record the rule in `CLAUDE.md`.
  *The label is checked like the back button: ~40 px clear of the nearest
  resting die on 390×844. It is two lines, names only, each cut short with
  an ellipsis rather than wrapping: with the dice notation in it, it wrapped
  to three lines and came within 11 px, and Marathon's six hearts ran into it. The announcement pill and
  edge badges take no pointer events. Marathon's six hearts go two rows of
  three on a phone, clear of both corners.*
- [x] **4.7** Spice: Sudden Death, Marathon, Mutual Destruction, Lowball,
  Exploding Dice, Raising the Stakes, Cursed Number. *An exploded die is
  written `(6+6+2)` on the card, a cursed one struck through (D28).*
- [x] **4.8** Spice: Critical Hit, Critical Fumble, Inspiration, Brutal
  Critical, Snake Eyes / Boxcars, Triples, Caltrops. *D26 for the d20 ones.
  Caltrops shows on the card as `− 2 caltrops`.*
- [x] **4.9** Spice: Underdog, Revenge. *Underdog's and Inspiration's extra
  die is put down between rounds in the clearest spot of that side's half
  (`table.setHand`), and taken away again when the edge goes.
  `check-handfuls.mjs` now also holds and throws each set with the die either
  would add, in the set's own tray. That found 4d8 (Divine Smite plus an
  extra d8) losing a die from the palm in 6% of holds, against a limit of 1%:
  d8s wedged on the bowl's slope and the hold's stiff contacts fired them out
  at 10-16 units/s. Held dice are now speed-limited relative to the palm
  (`HOLD_MAX_DIE_SPEED`, 3 units/s; a hop is 1.3): 0 in 400 holds. A bigger
  tray made no difference.*
- [x] **4.9a** Unit tests for every Spice above, including interactions with
  limits (e.g. Underdog at the 8-dice cap, Exploding Dice under Lowball). The
  same applies to every Spice and scorer added in Phases 5 and 6.
  *`test/spice.test.js`. Exploding Dice under Lowball can't happen with one
  Spice a match (D9); the limits tested instead: Underdog at the cap and with
  a dropped die, exploding chains (finite, on a d4 most of all) and the d10's
  "0", Exploding through Heroic Stats' drop, Cursed Number under Advantage,
  Caltrops at its floor, Mutual Destruction ending in a draw, Raising the
  Stakes ending a match with three hearts at once, a tie breaking Revenge.
  Also: every Spice plays a whole match with every set it suits, the same way
  twice, and leaves the state it's given untouched.*
- [x] **4.10** Verification checklist passes; artifact republished.
  *`npm test` (159), `npm run phase0` and `npm run verify` all pass. New
  verify checks: the draft and its seed (§8, 7), the match label (names,
  popup, clearance on desktop and 390×844, Marathon's hearts), Underdog's
  extra die and edge badge, Cursed Number's announcement. Republished as
  version 24.*
- [x] **4.11** Docs refresh. `CLAUDE.md` check 5 ("drains hearts to 0")
  becomes "runs its win condition to the end", matching §8.

### Phase 5 — Physical Spice and win conditions

- [x] **5.1** Pothole: hole geometry and physics in each half; fallen dice count 0.
  - The floor needs a real opening (or a trigger volume), not a single plane.
  - A fallen die must be removed from the settle check. Otherwise it never
    sleeps and every round waits out the full settle timeout.
  - `clampToArena` clamps x and z only, so it does not fight a falling die;
    keep it that way.
  *D32. A real opening over a pit with a bottom, so a die settles down there
  anyway; it's still taken out of the wait, as heaps in a pit shuffle about.
  The new `tools/phase0/check-table.mjs` found what the mesh floor broke:
  no solver contacts against it, so no die ever "rested on a face" there,
  and FIX_INTERNAL_EDGES leaving dice spinning; both fixed and measured.
  The card writes a fallen die `hole`.*
- [x] **5.2** Cat Paw: paw animation, impulse on chosen dice, re-settle.
  *D34. `afterSettle` is wired up (D16): the rules pick the dice, the game
  knocks them. The paw is a long grey arm reaching in over a side wall
  (`effects.js`).*
- [x] **5.3** Gusty Table: wind force while dice are moving. *D33. The
  announcement pill gives its direction as an arrow.*
- [x] **5.4** Second Wind: charge UI and re-throw flow (single-player).
  *D31. Each side's unspent Second Wind is an edge badge; the player's
  gives way to the button while it's offered.*
- [x] **5.5** Mercy. *D30, D31.*
- [x] **5.6** No Man's Land: divider removed, both sides throw together
  (single-player). Without the divider, dice can come to rest in the centre
  where the `#result` card sits; re-check the card's pointer-events reasoning
  for this mode. *D38. Re-checked: the card still takes no pointer events
  bar the match-over card, and `npm run verify` picks up a die across the
  middle or under the card.*
- [x] **5.7** Win conditions: Hit Points, Race to N, Tug of War, each with its
  own HUD. *D37. A bar per side: red HP, a green race, a striped rope
  showing how far the marker is from each side's edge.*
- [x] **5.8** Spice: Doubles Again, Death Saves. *D35, D36.*
- [x] **5.9** Verification checklist passes; artifact republished.
  *`npm test` (192), `npm run phase0` (now with `check-table.mjs`, and
  determinism over 44 fixtures: 20 plain, 24 onto changed tables) and
  `npm run verify` (71 checks) all pass. Republished as version 25.*
- [x] **5.10** Docs refresh.
- [x] **5.11** Playtest feedback (D40): exploded dice pop out extra dice that
  land on their rolls; a cursed die shows a red 0; Hit Points' card says who
  lost how many HP. *Scripted in `npm run verify`.*
- [x] **5.12** Playtest feedback, round two (D41): the test bench plays the
  same again after a match; No Man's Land's opponent throws at your dice;
  the re-throw button sits under the result card, clear of the dice; Tug of
  War's rope lies down the table with its flag. *Scripted in `npm run
  verify`; the rope and the aimed throws in `check-table.mjs`.*

### Phase 6 — Alternative scoring

- [x] **6.1** Dice Poker: hand ranking, reroll selection UI. *D42. The hands
  are the set's scorer (`src/rules/poker.js`); the reroll is Draw Poker,
  tap to pick dice out and drag to throw them, the rest held where they
  lie. `check-table.mjs` now throws redraws too, which found dice propped
  against a held die never settling (D46).*
- [x] **6.2** Count the Sixes. *D43.*
- [x] **6.3** Burnout (dice pool shrinks across rounds). *D44.*
- [x] **6.4** Crown. *D43.*
- [x] **6.5** Wild Magic surge table. *D45. Six surges.*
- [x] **6.6** Verification checklist passes; artifact republished.
  *`npm test` (235), `npm run phase0` (now with redraws in
  `check-table.mjs`; determinism unchanged, 51 of 51) and `npm run verify`
  all pass. Republished as version 27.*
- [x] **6.7** Docs refresh.

### Phase 6b — Player customisation *(D47, R6)*

- [x] **6b.1** Profile module: the defaults, the three registries, load and save
  (wrapped), name check by grapheme count, unknown ids falling back (R6.1–6.3).
  Unit-tested. *`src/profile.js`; the colours are in `config.js`
  (`CARD_COLORS`, `TRAY_COLORS`, `DICE_COLORS`); `test/profile.test.js` (12).*
- [x] **6b.2** Themes from the profile: `THEMES` and the floor colours become
  per side and per match, set from each side's choices (dice body, edge,
  numerals; tray half). Zen's whole tray in the player's colour (R6.9).
  *`table.setup` takes `dice` and `trays`; `arena.setTrayColors`.*
- [x] **6b.3** The opponent's choices, drawn from their own seeded stream, never
  the player's dice colour (R6.6). *`opponentProfile`, from
  `deriveSeed(seed, 'looks')`.*
- [x] **6b.4** The player card: replaces the HUD block for both sides; name,
  badge, match state; compact on a phone; Zen's name-only card (R6.4, R6.5).
  *The top card sits level with the corners. Measured against real dice at
  the far wall (not spheres round them, which overstate their reach by 30 px
  and more): ~9 px clear for The Classic on desktop, 5-30 px on a phone.
  Found on the way: after a Marathon match on a phone, the hidden two-row
  grid of hearts still took room (`display:grid` beat `[hidden]`), and a bar
  card grew 50 px.*
- [x] **6b.5** Menu card with the edit button (R6.7).
- [x] **6b.6** The player editor, with the live card and the scene preview
  (R6.8). *A d20 and a d6 turning slowly in the far half; the editor at the
  bottom on a phone, on the left on a wider screen.*
- [x] **6b.7** Readability: every dice colour's numerals on every tray, and
  every card background with its text, checked by eye in a real browser.
  *All 16 pairings readable; ivory brightened (it read grey under the
  lights). Ivory on light grey is the weakest, and still clear.*
- [x] **6b.8** Verification checklist passes (with §8 item 8); `npm run phase0`
  unchanged (R6.10); artifact republished. *`npm test` (247), `npm run
  verify` (104, with 16 new profile checks), `npm run phase0` all pass;
  determinism 51 of 51. Republished as version 28.*
- [x] **6b.9** Docs refresh.

---

## 8. Verification checklist

*Superseded by the checklist in `CLAUDE.md` and `npm run verify`; kept because
`verify.mjs` cites its items (`§8, 5`).*

1. Each die type shows its full set of numerals, and at rest at least one
   squarely faces the camera (the top vertex for a d4).
2. A micro-nudge is refused ("Make a proper throw!"); a genuine drag throws.
3. The dice are grabbable on the first tap, even when the result card overlaps
   them.
4. On a 390×844 viewport every die is reachable at its sideways limit, for the
   largest dice set (8 dice).
5. A full match runs its win condition to the end, announces the result, and
   returns to the menu.
6. The face values read by the game match what is visible on screen, for every
   die type.
7. The same seed produces the same offers and the same Spice events.
8. Each side's card shows its name, badge and match state, clear of the top
   corners and every resting spot on desktop and 390×844; a 16-character and
   an emoji name fit. The editor's changes show on the card, the tray and the
   dice, and survive a reload; the opponent's dice never take the player's
   colour; Zen's tray is all the player's colour.
