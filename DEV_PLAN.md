# Super Rollies — Development Plan: Dice & Spice

Living plan for expanding Quick Game and adding 1v1 multiplayer. Tick boxes as
work lands; record decisions in the log rather than silently changing
requirements.

**Scope:** Quick Game (vs. AI) and host/join 1v1 multiplayer. The campaign is out
of scope.

**Starting point (as of 2026-10-16):** one die type (d20), one die per side, an
AI opponent that throws at random, and rules hard-coded in `game.js` `runRound()`
(higher roll wins, ties cost nothing, 3 hearts). No multiplayer code exists.
Since Phase 0 (2026-10-17): physics on Rapier, and a Zen mode (D15).
Since Phase 1 (2026-10-17): a seeded RNG, and the rules in a pure engine
(`src/rules/`) with Vanilla, Hearts and The Classic as its only entries.

---

## Contents

1. [Vision](#1-vision)
2. [Decision log](#2-decision-log)
3. [Open questions](#3-open-questions)
4. [Requirements](#4-requirements)
5. [Catalogue: dice sets](#5-catalogue-dice-sets)
6. [Catalogue: Spice](#6-catalogue-spice)
7. [Phases](#7-phases)
8. [Verification checklist](#8-verification-checklist)

---

## 1. Vision

Rolling a d20 is fun; variety makes it last. Every match is shaped by two choices
made before it starts:

1. **Dice** — what you throw: 1d20, 2d6, 8d6 (Fireball), and so on, drawn from
   recognisable Dungeons & Dragons 5e rolls.
2. **Spice** — what is special about this match: a rule change, a table hazard,
   a different way to score or to win.

Some Spice works with any dice; some only makes sense with particular dice
(e.g. dice poker with 5d6, critical hits with 1d20).

---

## 2. Decision log

| # | Date | Decision |
|---|---|---|
| D1 | 2026-10-16 | Scope is Quick Game and 1v1 multiplayer only. Campaign dropped for now. |
| D2 | 2026-10-16 | Multiplayer targets **GitHub Pages only**, using WebRTC via PeerJS and its public signalling server. The claude.ai artifact stays single-player and hides Host/Join. |
| D3 | 2026-10-16 | In multiplayer the **host chooses both Dice and Spice from the full catalogue**. The random two-card draft is for Quick Game vs. AI. |
| D4 | 2026-10-16 | A **Vanilla** ("No Spice") card is part of the Spice pool, compatible with every dice set. |
| D5 | 2026-10-16 | **2d20 means advantage** (keep highest). No summed 2d20 set. |
| D6 | 2026-10-16 | **Maximum 8 dice per side.** The tray may grow per dice set to fit them. |
| D7 | 2026-10-16 | **Win conditions are Spice.** Hearts are the default; Spice may replace them (Hit Points, Race to N, Tug of War, ...). |
| D8 | 2026-10-16 | **State-based asymmetry is allowed.** Rules are identical for both players but may favour whoever is in a given situation (behind, just lost). A rule never favours a player by identity (e.g. host). |
| D9 | 2026-10-16 | Exactly **one Spice per match**. Stacking is a possible later extension; eligibility metadata includes incompatibilities to allow for it. |
| D10 | 2026-10-16 | Replace cannon-es with **Rapier** (`@dimforge/rapier3d-compat`, deterministic build). Rapier is maintained, has continuous collision detection, and can produce identical simulations on every client, which lets multiplayer send throw inputs instead of trajectories. **Adopted 2026-10-17 after Phase 0:** all four checks passed (A feel, B d10 collider, C tunnelling, D determinism; D within the D14 scope). Package: `@dimforge/rapier3d-deterministic-compat@0.21.0`. The trajectory-replay fallback (R4.3b, 7.5b) is dropped. |
| D11 | 2026-10-16 | Rest of the stack stays: three.js, no framework, no build step to run, esbuild only for the artifact. |
| D12 | 2026-10-16 | Multiplayer uses a **TURN server** alongside PeerJS's public signalling server, so players behind strict NATs and some mobile networks can still connect. |
| D13 | 2026-10-16 | The rules engine gets **unit tests with `node:test`** (no new dependency). The verification checklist becomes a **Playwright script**. Spice and dice-set definitions use **`// @ts-check` with JSDoc types** for editor checking without a build step. |
| D14 | 2026-10-17 | **Browser checks run in Chromium only until after the MVP.** The checks run after every change, and three engines make each run take far longer. Firefox and WebKit (Safari, and every browser on iOS) compatibility is a post-MVP step (see §7, *Post-MVP*). For Check D (0.7) this means Node, desktop Chromium and Android Chrome for now. Cross-engine determinism, which an iPhone vs. desktop multiplayer match depends on, is verified in that post-MVP step. |
| D15 | 2026-10-17 | **Zen mode** added to the main menu during Phase 0, as a way to test physics without a match getting in the way: one die, no opponent, no divider, no score; each throw's result is shown. A **back-to-menu button** (top-left) is shown in Zen and Quick Game; leaving Quick Game abandons the match. Its placement is checked to be clear of every spot a die can rest (the principle in 4.6a). |
| D16 | 2026-10-17 | **Rules engine shape (Phase 1).** The match config is plain data naming its dice set and Spice **by id**, so it can be sent to the other player as-is. Each random consumer draws from **its own stream derived from the match seed** (`deriveSeed`: `rules`, `opponent`, `throw`), so extra draws in one never shift another; only `rules` is shared in multiplayer. The **win condition owns the default damage** of a round, and `score` / `applyDamage` hooks **transform the default** they are given rather than computing from scratch. A win condition may end a match as a **draw** (both sides out together, e.g. Hearts under Mutual Destruction). `afterSettle` is part of the Spice type but is physical, so the game calls it, not the engine; it is wired up with the first Spice that needs it (Phase 5). |
| D17 | 2026-10-17 | **A throw is as hard as the hand moved, not the held die.** The held die is clamped to its own zone, so a die pinned against the divider or an edge used to barely move however hard the player swiped, and a forward flick from the divider was refused as a fumble. Release speed and the fumble check now follow the pointer: a hard flick into a wall throws the die into it, and it bounces off. A die is also released at least its circumradius from any wall, so a throw never starts inside a collider. |

---

## 3. Open questions

- [ ] **Q1 — Simultaneous or turn-based throws in multiplayer?**
  - Simultaneous: faster, more chaotic, required for No Man's Land.
  - Turn-based: tenser reveals, and rerolls are easier to reason about because
    the opponent's result is known.
  - **Blocks:** Second Wind and Dice Poker reroll timing, No Man's Land in
    multiplayer, and the Phase 7 message protocol. Does **not** block Phases 1–4.
    Single-player keeps today's behaviour (both sides throw together) until
    this is settled.
- [ ] **Q2 — Rejoin window after a multiplayer disconnect.** How long before the
  remaining player is awarded the match?
- [x] **Q3 — Physics engine: Rapier or cannon-es?** Rapier (D10), settled by
  Phase 0.
- [ ] **Q4 — Which TURN provider?** Needs a free or cheap tier and credentials
  that are safe to ship in a static site (short-lived credentials are better if
  the provider supports them).

---

## 4. Requirements

### R1 — Match setup

- **R1.1** Starting a Quick Game opens a setup screen before the board, with two
  steps in order: **Dice**, then **Spice**.
- **R1.2** *(Quick Game vs. AI)* Each step offers **2 cards** drawn at random
  from the eligible pool. Picking a card advances to the next step.
- **R1.3** The Spice pool is filtered by the chosen dice set: a Spice appears
  only if it is eligible for that set (see R3.2).
- **R1.4** Each card shows a name, the dice notation (e.g. `8d6`), a one-line
  rule summary, and an icon.
- **R1.5** During the match, the chosen Dice and Spice are shown in a small
  label; tapping it opens the full rules.
- **R1.6** Offers are drawn from a **seeded RNG**, so the same seed yields the
  same offers on any client.
- **R1.7** Rules are the same for both players. A rule may favour whoever is in a
  particular game state (behind, just lost a round) but never a player by
  identity. *(D8)*

### R2 — Dice

- **R2.1** Supported die types: **d4, d6, d8, d10, d12, d20, and percentile d10
  (00–90)**. Each type needs geometry, standard face numbering, numeral decals,
  a physics shape, and a face-up reader. The d4 is read from its top vertex, not
  a face.
- **R2.2** At most **8 dice per side**. *(D6)* Each dice set declares a die
  scale and a tray size. The camera fits the tray in use, and the
  confine-to-screen logic in `arena.js` adapts to it, so every die stays
  reachable on a 390×844 screen.
- **R2.3** All of a side's dice are picked up together in one gesture. On
  release they scatter with per-die variation in velocity and spin, rather than
  moving as one rigid block.
- **R2.4** Each dice set declares a scorer: `sum`, `keepHighest(n)`,
  `dropLowest(n)`, or a custom scorer (e.g. a poker hand).
- **R2.5** The result card shows the breakdown, e.g. `6 + 4 + 1 + 5 … = 31`.
  Dropped dice are shown greyed out.

### R3 — Spice

- **R3.1** A Spice is a data-driven module that hooks into the match at defined
  points:

  | Hook | Purpose |
  |---|---|
  | `setup` | Table changes (holes, obstacles), starting resources |
  | `winCondition` | Owns the match-state HUD (hearts, HP, score, marker), how a round result changes it, and when the match ends |
  | `beforeThrow` | Per-round setup (announce a cursed number, grant advantage) |
  | `afterSettle` | Act on settled dice: nudge, remove, or re-throw them |
  | `score` | Transform or replace the dice set's scorer |
  | `compare` | Decide the round winner from two scores |
  | `applyDamage` | Decide what the round result costs |

- **R3.2** Each Spice declares eligibility: minimum and maximum dice count,
  required die types, allowed dice sets, and incompatible Spice.
- **R3.3** Exactly one Spice per match. *(D9)*
- **R3.4** The default win condition is **3 hearts per side**. `hud.js` must not
  assume hearts; it renders whatever the active win condition provides. *(D7)*
- **R3.5** When a state-based advantage is active (R1.7), the HUD shows who holds
  it, e.g. by highlighting that side's dice.

### R4 — Multiplayer (host/join 1v1)

- **R4.1** The host creates a room and gets a short code and a `?join=CODE`
  link. The guest joins with either. Transport: WebRTC via PeerJS. *(D2)*
- **R4.2** The host picks Dice and Spice from the **full catalogue**: all dice
  sets, then every Spice eligible for that set. The guest sees the choice and
  the full rule text before the first round. *(D3)*
- **R4.3** Each client is authoritative for **its own throw**. The thrower
  sends the release record (`ThrowRecord` in `src/physics.js`: position,
  orientation, linear and angular velocity of each die, plus the table layout).
  The other client simulates the same throw with `replayThrow` and arrives at
  the same result, and both sides check the face values match. *(D10)*
- **R4.4** All rules logic is a **pure function** of the match config (seed,
  dice set, Spice) and both sides' results. Both clients evaluate it and reach
  the same outcome.
- **R4.5** If a player disconnects, the remaining player wins after a timeout.
  The rejoin window is open question Q2.
- **R4.6** The claude.ai artifact build hides Host/Join. *(D2)*
- **R4.7** Connections use a TURN server as well as PeerJS signalling, so that
  players behind strict NATs and some mobile networks can connect. *(D12)*

### R5 — Non-functional

- **R5.1** The game stays a static site with no build step needed to run it.
  `npm run build` keeps producing the single-file artifact.
- **R5.2** Every random event that affects the outcome (offers, Cat Paw, cursed
  number, surges) comes from the seeded RNG, never from `Math.random()`.
- **R5.3** The invariants listed in `CLAUDE.md` (decal handedness, decal size,
  unlit numerals, tight camera near/far, distance-based throw detection, dice
  confined to the visible area, `clampToArena`, result-card pointer events)
  hold for **every die type and dice count**.
- **R5.4** Physics runs a **fixed number of steps per simulated second**,
  independent of frame rate; rendering interpolates between steps. Required for
  determinism (R4.3) and harmless otherwise.
- **R5.5** The rules engine and every Spice and scorer have unit tests
  (`node:test`), runnable with `npm test`. *(D13)*
- **R5.6** The verification checklist (§8) is a Playwright script, runnable with
  one npm command. *(D13)*

---

## 5. Catalogue: dice sets

| Name | Dice | Scorer | D&D source | Range |
|---|---|---|---|---|
| The Classic | 1d20 | sum | attack roll / ability check | 1–20 |
| Advantage | 2d20 | keep highest 1 | advantage | 1–20 |
| Greatsword | 2d6 | sum | greatsword | 2–12 |
| Greataxe | 1d12 | sum | greataxe | 1–12 |
| Ability Score | 3d6 | sum | old-school stat roll | 3–18 |
| Heroic Stats | 4d6 | drop lowest 1 | standard stat generation | 3–18 |
| Magic Missile | 3d4 | sum | magic missile | 3–12 |
| Swarm of Daggers | 4d4 | sum | — | 4–16 |
| Guiding Bolt | 4d6 | sum | guiding bolt | 4–24 |
| Divine Smite | 3d8 | sum | smite vs. undead | 3–24 |
| Fireball | 8d6 | sum | fireball | 8–48 |
| Percentile | d10 + d% | percentile | wild magic / d100 | 1–100 |
| Sneak Attack | 1d20 + 3d6 | sum | rogue's hit and sneak attack | 4–38 |
| The Whole Bag | d4 + d6 + d8 + d10 + d12 + d20 | sum | one of each | 6–60 |
| Dice Poker | 5d6 | poker hand | — | hand ranking |

---

## 6. Catalogue: Spice

### 6.1 Universal: rules

| Spice | Rule |
|---|---|
| Vanilla | No changes. *(D4)* |
| Mutual Destruction | A tie costs both players a heart. |
| Exploding Dice | A die showing its maximum rolls again and adds the result; it can chain. |
| Lowball | The lowest total wins. |
| Cursed Number | Each round a number is announced; any die showing it counts as 0. |
| Raising the Stakes | Ties carry over: the next round costs 2 hearts, then 3, and so on. |

### 6.2 Universal: win conditions *(D7)*

| Spice | How the match is won |
|---|---|
| Sudden Death | One heart each. |
| Marathon | Six hearts each. |
| Hit Points | Each player has HP scaled to the dice range; the round loser loses the difference between totals. |
| Race to N | Totals accumulate across rounds; first to N wins. N scales with the dice range. |
| Tug of War | A marker starts mid-table and moves toward the round loser by the difference in totals. Push it off their edge to win. |

### 6.3 Universal: comeback (state-based asymmetry) *(D8)*

| Spice | Rule |
|---|---|
| Underdog | Whoever is behind on the win condition throws one extra die (never above the 8-dice cap). |
| Revenge | Winning a round straight after losing one deals double damage. |
| Mercy | A player who falls three hearts behind gets one free re-throw. |

### 6.4 Universal: physical and interactive

| Spice | Rule | Note |
|---|---|---|
| Cat Paw 🐾 | Each round there is a chance a paw swipes in after the dice settle, knocking 1–2 random dice, which roll again. | |
| Second Wind | Once per match, re-throw all your dice after both results are shown. | Timing depends on Q1 in multiplayer |
| Pothole | A hole in each half of the table; a die that falls in counts as 0. | |
| Gusty Table | A random breeze pushes the dice while they roll. | |
| No Man's Land | The divider is removed and both sides throw at once; dice can knock into each other. | Multiplayer depends on Q1 |
| Difficult terrain | The board is covered in bumps and strange geometry, influencing the rolls |

### 6.5 Specific to particular dice

| Dice | Spice | Rule |
|---|---|---|
| 1d20 | Critical Hit | A natural 20 that wins the round deals double damage. |
| 1d20 | Critical Fumble | A natural 1 costs you a heart, even if you won the round. |
| 1d20 | Death Saves | Roll 10 or more or record a fail. Three fails ends the match, regardless of the opponent's roll. |
| 1d20 | Inspiration | The loser of the previous round rolls with advantage. |
| 2d6 | Snake Eyes / Boxcars | 1-1 loses the round automatically; 6-6 wins it. |
| 2d6, 3d6 | Doubles Again | Rolling doubles grants another throw, added to the total. |
| 3d6, 4d6 | Triples | Three of a kind wins the round outright. |
| 5d6 | Dice Poker | Poker hands replace the total; one reroll of chosen dice before the reveal. Reroll timing depends on Q1 in multiplayer. |
| 8d6 | Count the Sixes | Only the number of 6s counts. |
| 8d6 | Burnout | Each die showing a 1 is lost for the rest of the match. Running out of dice loses the match. |
| 3d4, 4d4 | Caltrops | Every 1 you roll is subtracted from your opponent's total. |
| Percentile | Wild Magic | A result with matching digits (11, 22, …) triggers a random surge, e.g. the two totals swap. |
| The Whole Bag | Crown | Only your single highest die counts, but each die showing its maximum adds +5. |
| 1d12 | Brutal Critical | A 12 grants an extra d12, added to the total. |

---

## 7. Phases

Each phase ends with the [verification checklist](#8-verification-checklist)
run in a real browser (headless Chromium via Playwright), followed by `npm run
build` and a republish of the artifact to the URL in `CLAUDE.md`.

Each phase also ends with a **docs refresh**: bring `CLAUDE.md`, `README.md`,
`package.json` and the copy in `index.html` (menu subtitle, meta description) in
line with what the game now does. These currently describe a d20-only game with
3 hearts.

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
    most-upward face.
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

- [ ] **2.1** d6: geometry, numbering (opposite faces sum to 7), decals, physics
  shape, face-up reader.
- [ ] **2.2** Generalise `dice.js` so die type is a parameter; d20 behaviour
  unchanged.
- [ ] **2.3** Multi-die sides: spawn layout, handful grab/throw with per-die
  scatter (R2.3).
- [ ] **2.4** Wait for N dice to settle, with the existing settle timeout per die.
- [ ] **2.5** Per-dice-set scale and tray size; camera fitting; confine-to-screen
  bounds follow the tray (R2.2).
  - Camera near/far is **recomputed tightly** around each tray, never widened
    to a range that covers them all. The depth-precision invariant in
    `CLAUDE.md` still applies; only the fixed 8–20 values go.
  - `arenaHalfWidth` and `clampToTray` in `arena.js` are currently computed
    once at module scope from `TRAY_HALF_WIDTH`, `TRAY_DEPTH` and
    `DIE_RADIUS`. They must be recomputed whenever the dice set changes, not
    just on resize.
- [ ] **2.6** Measure whether 8d6 fits and stays reachable on 390×844; enlarge
  the tray if not.
- [ ] **2.7** Scorers: `sum`, `keepHighest`, `dropLowest`, with unit tests.
- [ ] **2.8** Result breakdown on the result card (R2.5).
- [ ] **2.9** AI opponent throws a handful the same way.
- [ ] **2.10** Dice sets enabled: Greatsword, Ability Score, Heroic Stats,
  Guiding Bolt, Fireball, Dice Poker (scored as a sum until Phase 6), Advantage
  (needs only d20).
- [ ] **2.11** Verification checklist passes for 1, 2, 5 and 8 dice; artifact
  republished.
- [ ] **2.12** Docs refresh. In `CLAUDE.md`: check 1 ("20 decals per die")
  becomes per die type, matching §8; the camera near/far entry describes the
  per-tray computation.

### Phase 3 — Remaining die types

- [ ] **3.1** d4 (read from the top vertex). Its three numerals per face sit
  near the corners, not one centred decal, so the `inradius × √2` decal-size
  rule does not apply; it needs its own bound (and its own `CLAUDE.md` entry)
  to keep numerals off neighbouring faces.
- [ ] **3.2** d8.
- [ ] **3.3** d12.
- [ ] **3.4** d10 (pentagonal trapezohedron, 0–9).
- [ ] **3.5** Percentile d10 (00–90) and the percentile scorer.
- [ ] **3.6** Decal sizing per face shape, keeping the decal inside its face.
  The `inradius × √2` bound holds for any face with an incircle (including the
  d10's kites), provided the inradius is measured per die type.
- [ ] **3.7** Dice sets enabled: Greataxe, Magic Missile, Swarm of Daggers,
  Divine Smite, Percentile, Sneak Attack, The Whole Bag.
- [ ] **3.8** Verification checklist passes for every die type; artifact
  republished.
- [ ] **3.9** Docs refresh. `README.md` file map no longer describes dice as
  d20-only.

### Phase 4 — Setup screen and rules-only Spice

- [ ] **4.1** Card component (name, notation, summary, icon) (R1.4).
- [ ] **4.2** Two-step draft screen: 2 random dice cards, then 2 eligible Spice
  cards (R1.1–R1.3).
- [ ] **4.3** Catalogue screen (full list, used by the multiplayer host in
  Phase 7) sharing the card component.
- [ ] **4.4** In-match Dice/Spice label with a full-rules popup (R1.5).
- [ ] **4.5** Eligibility filtering (R3.2).
- [ ] **4.6** State-based advantage indicator (R3.5).
- [ ] **4.6a** Tappable board UI placement. The `#result` card is
  `pointer-events: none` because it sits where the die rests against the
  divider. Extend that principle to all new on-board UI (the Dice/Spice label
  here; the Second Wind button and Dice Poker reroll selection later): nothing
  tappable may sit where dice come to rest. Record the rule in `CLAUDE.md`.
- [ ] **4.7** Spice: Sudden Death, Marathon, Mutual Destruction, Lowball,
  Exploding Dice, Raising the Stakes, Cursed Number.
- [ ] **4.8** Spice: Critical Hit, Critical Fumble, Inspiration, Brutal
  Critical, Snake Eyes / Boxcars, Triples, Caltrops.
- [ ] **4.9** Spice: Underdog, Revenge.
- [ ] **4.9a** Unit tests for every Spice above, including interactions with
  limits (e.g. Underdog at the 8-dice cap, Exploding Dice under Lowball). The
  same applies to every Spice and scorer added in Phases 5 and 6.
- [ ] **4.10** Verification checklist passes; artifact republished.
- [ ] **4.11** Docs refresh. `CLAUDE.md` check 5 ("drains hearts to 0")
  becomes "runs its win condition to the end", matching §8.

### Phase 5 — Physical Spice and win conditions

- [ ] **5.1** Pothole: hole geometry and physics in each half; fallen dice count 0.
  - The floor needs a real opening (or a trigger volume), not a single plane.
  - A fallen die must be removed from the settle check. Otherwise it never
    sleeps and every round waits out the full settle timeout.
  - `clampToArena` clamps x and z only, so it does not fight a falling die;
    keep it that way.
- [ ] **5.2** Cat Paw: paw animation, impulse on chosen dice, re-settle.
- [ ] **5.3** Gusty Table: wind force while dice are moving.
- [ ] **5.4** Second Wind: charge UI and re-throw flow (single-player).
- [ ] **5.5** Mercy.
- [ ] **5.6** No Man's Land: divider removed, both sides throw together
  (single-player). Without the divider, dice can come to rest in the centre
  where the `#result` card sits; re-check the card's pointer-events reasoning
  for this mode.
- [ ] **5.7** Win conditions: Hit Points, Race to N, Tug of War, each with its
  own HUD.
- [ ] **5.8** Spice: Doubles Again, Death Saves.
- [ ] **5.9** Verification checklist passes; artifact republished.
- [ ] **5.10** Docs refresh.

### Phase 6 — Alternative scoring

- [ ] **6.1** Dice Poker: hand ranking, reroll selection UI.
- [ ] **6.2** Count the Sixes.
- [ ] **6.3** Burnout (dice pool shrinks across rounds).
- [ ] **6.4** Crown.
- [ ] **6.5** Wild Magic surge table.
- [ ] **6.6** Verification checklist passes; artifact republished.
- [ ] **6.7** Docs refresh.

### Phase 7 — Multiplayer

Blocked on **Q1** for the protocol; 7.1–7.3 can start before Q1 is settled.

- [ ] **7.1** PeerJS connection: host creates a room, code and `?join=` link,
  guest joins (R4.1).
- [ ] **7.1a** TURN server configured (provider per Q4); verified by connecting
  a phone on mobile data to a desktop on home broadband (R4.7).
- [ ] **7.2** Host catalogue selection; guest sees the choice and rules (R4.2).
- [ ] **7.3** Shared seed and config handshake.
- [ ] **7.4** Throw protocol (simultaneous or turn-based, per Q1).
- [ ] **7.5** Send the release record; the other client simulates the throw
  with the Phase 0 harness (`replayThrow`); both sides check the face values
  match (R4.3).
- [ ] **7.6** Both clients evaluate the rules engine; mismatch detection (R4.4).
- [ ] **7.7** Disconnect handling and rejoin window (R4.5, Q2).
- [ ] **7.8** Interactive Spice in multiplayer: Second Wind, Dice Poker reroll,
  No Man's Land.
- [ ] **7.9** Host/Join hidden in the artifact build (R4.6).
- [ ] **7.9a** Keep multiplayer code out of the artifact bundle.
  `tools/build-artifact.mjs` treats every import-map entry as a CDN external,
  so adding PeerJS to the import map would make the artifact load it too. Add
  a build flag or a separate entry point that excludes the multiplayer modules.
- [ ] **7.10** Tested with two real browsers across two machines.
- [ ] **7.11** Docs refresh. `README.md` "Publishing" notes the runtime
  dependency on PeerJS's public signalling server, a third party that can be
  unavailable.

### Post-MVP — Browser compatibility *(D14)*

- [ ] **P.1** Run the verification checklist in Firefox and WebKit as well as
  Chromium. Unexamined so far: during Phase 0, one early run in Firefox timed
  out on check 4 and one in WebKit failed check 3, the second probably the
  same test flakiness that was fixed for Chromium.
- [ ] **P.2** Check D (0.7) in desktop Firefox and Safari, and iOS Safari.
  Required before multiplayer is offered to players on iOS.

---

## 8. Verification checklist

Run after any change to dice, camera, input or match flow (extends the list in
`CLAUDE.md`). Chromium only until the post-MVP compatibility step *(D14)*. From Phase 1 these are scripted in Playwright (R5.6); each item is
added to the script as the feature it checks lands. Run `npm test` alongside.

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
