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
| D18 | 2026-10-17 | **Zen is the testbed: its picker offers everything.** Every dice set Quick Game offers, plus every die type on its own (as "One d6" where no set is just that die), so each die and each handful can be tried without an opponent in the way. A new dice set or die type joins it as it is implemented, automatically: the picker is built from `DICE_SETS` and `DIE_TYPES`. `npm run verify` checks it offers them all. |
| D19 | 2026-10-17 | **Interim dice-set picker.** Until the Phase 4 draft (R1.1, R1.2), Quick Game opens a list of every enabled dice set, so each can be played and tested as it lands. Phase 4 replaces it with the two-card draft and reuses it for the multiplayer host's catalogue (4.3). |
| D20 | 2026-10-17 | **The d6 has pips, not numerals,** as real ones do, and slightly cut corners, as real ones have rounded ones. Its face numbering is standard (opposite faces sum to 7; 1-2-3 counter-clockwise round their corner). |
| D21 | 2026-10-17 | **Trays scale uniformly.** A dice set's tray is The Classic's times a factor, and the camera pulls back by the same factor along the same line, so every tray fills the screen the same way and the on-screen limit logic carries over unchanged. Handfuls are laid out with each die at least two circumradii (plus a gap) from the next, so they never start a throw overlapping. The throw record gains optional `tray` and per-die `s` (scale); records without them are The Classic's, so the Phase 0 fixtures still replay. |
| D22 | 2026-10-17 | **A held handful jiggles.** Several dice held at once are simulated while held (`createHoldSim`): drawn into a loose, restless bunch round the pointer, tumbling, jolted and knocking into each other, as if shaken in a hand. The throw is released from wherever they are, so the bunch can be tighter than `handLayout` spaces dice and the throw still never starts with them overlapping. The hold isn't deterministic (it follows the pointer and frame rate) and doesn't need to be: like the pointer, it only decides the release, which the record captures. Its jolts draw from the player's `throw` stream. One die alone is still held steady. *How it moves is superseded by D23.* |
| D23 | 2026-10-17 | **A held handful lies in a palm.** Playtesting said D22's floating, jolted bunch looked strange next to real dice, which lie in one layer on the hand; some roll back and forth as it's shaken, the outer ones most, and some just hop a little without turning over. So the hold is now a cupped palm under gravity: a shallow bowl, a steep lip, and fingers standing up round it with their tips curled in, all unseen. It follows the pointer (a critically damped spring, its acceleration capped) and is gently shaken side to side and rocked, less the faster the hand moves; now and then a die is bumped into a small hop. The dice start packed flat in the bowl, any that don't fit one layer up in the dips between the others. Still not deterministic, still released from wherever the dice are, still using the player's `throw` stream. |
| D24 | 2026-10-18 | **A cocked die is read as it lies**, not re-thrown: its most upward face (a d4: its most downward). It is what a glance at the table says, it needs no extra throw (which multiplayer would have to agree on), and the reading is deterministic like everything else. About 1–4% of throws end cocked against a wall, depending on the die. A die that is **dead still for 0.5 s** counts as settled even if it doesn't quite rest on a face, so a cocked die doesn't keep the round waiting for the 4 s timeout. |
| D25 | 2026-10-18 | **A d10's "0" counts as 10, a percentile die's "00" as 100**, as when either is rolled alone in D&D, so The Whole Bag sums to 6–60. Together, as Percentile, they read as tens plus units, with "00" and "0" making 100: `(tens % 100 + units % 10) \|\| 100`, written on the card as `00 + 0 = 100`. A scorer may say how each die is written on the card (`labels`). |
| D26 | 2026-10-18 | **d20 Spice read "the d20 that counts", and also play with Advantage.** Critical Hit, Critical Fumble and Inspiration are offered with The Classic and Advantage (§6.5 says 1d20; Advantage is a 1d20 roll made with advantage). A natural 20 or 1 is the kept d20, so under Advantage a fumble needs both dice on 1. **Critical Fumble costs an extra heart** on top of the round (two if you lost it, one even on a tie): read literally, "costs you a heart" only ever mattered on a 1–1 tie, since a 1 can't win. |
| D27 | 2026-10-18 | **Random draws for each side happen player first.** Exploding Dice and Brutal Critical roll their extra dice from the rules stream, the player's side before the opponent's. So in multiplayer **both clients evaluate the engine from the same seat** (the host as `player`) and the guest mirrors the outcome for display, rather than each evaluating from its own side as `types.js` used to suggest. Settles part of Phase 7's protocol early (7.6). |
| D28 | 2026-10-18 | **Phase 4's Spice hooks.** Beyond R3.1: `hand` (what a side throws this round: Underdog's extra die, Inspiration's advantage; it depends on the match state only, so the game asks it before the throw and the engine after), `values` (what each die counts for: exploded, cursed), `adjust` (named additions to a total: Caltrops), `edge` (who holds a state-based advantage, R3.5) and `explain` (a line for the result card). `score` is replaced by `values`; `compare` gets the whole round, faces included (Snake Eyes, Triples). The engine records the previous round's winner (`state.previous`) for Revenge, Inspiration and Raising the Stakes. Extra rolls (Exploding Dice, Brutal Critical) are **drawn, not thrown**: rules-only, as Phase 4 is; a thrown version would be Phase 5 `afterSettle` work. **Underdog's extra die** is the set's commonest die type, the smallest on a tie (a d4 for The Whole Bag, a d6 for Sneak Attack). **Cursed Number** is drawn from 1 to the smallest die's highest face, so it can land on any die. Eligibility gains `excludeDiceSets`; Exploding Dice, Cursed Number and Underdog exclude Percentile, whose two dice are digits rather than a total. |
| D29 | 2026-10-18 | **The draft is the only way into a Quick Game; Zen's picker is the catalogue.** D19's interim list is gone. Quick Game always deals two dice cards, then two Spice cards (R1.2), with no "see all"; the catalogue screen (4.3) is the same cards as a list, used by Zen now and the multiplayer host in Phase 7. The draft deals from its own streams (`draft-dice`, `draft-spice`) of the match seed, and the match is played with that seed. |
| D30 | 2026-10-19 | **Mercy is two hearts behind, not three.** With three hearts a side, three behind means you have already lost, so §6.3's rule could never apply. Two behind (one heart against three) is the furthest a side can fall and play on. One free re-throw a match, while two behind, after losing a round. |
| D31 | 2026-10-19 | **Re-throws (Second Wind, Mercy) replay the round from where it started.** The engine stays pure, so taking one is going back to the state the round began in (`spendRethrow`) and playing it out again (`playRound`) with the re-thrower's new faces; the other side's dice stay as they lay. Only the round's loser is offered one, once its result is shown: the player by a button (bottom-right, below the tray's near wall, 4.6a), which stays up until they pick their dice up for the next round; if the round ended the match, until they tap the table to accept it. If the re-throw turns the round, the other side may then use theirs. The opponent (AI) uses its re-throw only when the loss would cost it the match. Single-player only until Q1. |
| D32 | 2026-10-19 | **Pothole's holes are real openings.** The floor becomes one triangle mesh with the holes cut out, each over a pit with a bottom, so a die drops in, lies there visibly, and is counted as fallen when its centre is below the table (one cocked over the rim is read as it lies, D24). Built only when there are holes: every other table keeps the slab, so recorded throws replay unchanged. Without Rapier's `FIX_INTERNAL_EDGES`: measured, it left a die spinning for 3 s where triangles meet (Fireball timed out 1 throw in 6), where without it dice settle as on the slab, at the cost of a slightly bumpier floor. Against the mesh Rapier gives no solver contacts, so `restsOnFace` reads its raw contacts. A fallen die stops being waited for (a heap in a pit shuffles for seconds). The holes mirror each other, are placed from the rules stream (arithmetic only, so every client agrees), near the middle across so they are on screen on a phone, and no die is put down over one. |
| D33 | 2026-10-19 | **Gusty Table's breeze is a gust in the record.** Drawn each round from eight directions written out as numbers (not `Math.cos`, whose last bit can differ between engines) at 2.5-5 units/s², always under what floor friction holds, so it never moves a die lying still. It pushes only dice moving faster than the settle speed, at full strength for 1.5 s then fading out by 2.5 s: pushed on into a wall, a die jittered and never settled. Drawn with streaks while the dice roll. |
| D34 | 2026-10-19 | **Cat Paw is the first `afterSettle`.** Once the round's main throw has settled, the rules (from their stream) say whether a paw swipes (40%) and at which one or two dice, of either side, how hard and at what angle; the game knocks them from the nearer side wall towards the middle (arithmetic only) and simulates every die again from where it lay. A knock is an ordinary throw record. The paw is drawn but not simulated. |
| D35 | 2026-10-19 | **Doubles Again is thrown, not drawn.** Unlike Phase 4's extra rolls (D28), the extra throw is the side's own dice thrown again, the player by hand and the opponent on its own, both together if both threw doubles; each is added to the total as `+ 9 again`. "Doubles" with three d6s is any two the same (44% of throws), so it's capped at three throws a round. A new engine input carries each side's extra throws (`again`), alongside which dice fell in a hole (`fallen`). |
| D36 | 2026-10-19 | **Death Saves is Hearts plus fails.** Every round each side's d20 that counts (D26) is also a save, whatever the other side threw: under 10 is one fail, a natural 1 two, a natural 20 wipes them. Three fails loses the match; both out together is a draw. The fails are marks beside the hearts. |
| D37 | 2026-10-19 | **The point-counting win conditions scale to the dice.** From each set's exact distribution of totals (`scoreStats`): Hit Points start at 4.5 times the average gap between two totals, Race to N's target is five average totals, Tug of War's rope reaches 3 average gaps each way. Simulated, every set then lasts about the same: Hit Points ~7 rounds, Race ~5, Tug of War ~9 (long-tailed: a random walk). The Classic: 30 HP, race to 55, 20 each way. A win condition may now be made for its dice set (`winCondition` as a function), and draws a bar per side (`kind: 'bar'`). |
| D38 | 2026-10-19 | **No Man's Land keeps the halves, not the wall.** Each side still throws from its own half (the hand is held to it as if the divider were there), the floor stays two colours, and the dice go anywhere. Dice can now rest under the result card in the middle; it takes no pointer events, so they're still picked up through it (checked). A new kind of Spice, "On the table", covers it, Pothole, Cat Paw and Gusty Table. |
| D39 | 2026-10-19 | **A test bench, for development only, behind `?dev`.** For live-testing every Spice without the draft's luck: a third menu button, shown only with `?dev` in the address, opens the catalogue (4.3) of every dice set, then every Spice that set allows, those made for particular sets first (`testBenchSpice`), and starts a Quick Game with them. Its seed is logged to the console, and `?seed=` in the address replays it. Not part of the finished game; the flag keeps it out of players' way, and it can be removed outright before release. |
| D40 | 2026-10-19 | **What the rules did to the dice is shown on the dice** (playtest feedback). An exploded die's extra rolls (Exploding Dice, Brutal Critical) **pop out of it as dice of their own**, with a burst, towards the most open part of that side's half, and land on the rolls drawn; a chain pops out of the pop. They glow, so they're told apart from the dice thrown, and go at the next throw. The rolls are still **drawn, not thrown** (D28): each pop's tumble is simulated with every die already on the table held fixed, so nothing the rules read is moved, and once it's known which face it lands on, its die is turned onto itself by one of its symmetries (`turnShowing`) so the face it lands on shows the drawn roll. The outline is the same, so nothing looks off, and the rules never depend on physics. A pop is for show only and is in no throw record. A **cursed die shows a red 0** in place of its number until the next throw. **Hit Points' card says who lost how many HP** (`You lose 8 HP.`): a win condition can name its unit (`unit`), and the game writes the line from the player's seat, so a multiplayer guest can mirror it. |
| D41 | 2026-10-19 | **Second playtest round.** (1) **Test bench rematch:** a bench match over starts another on the same dice and Spice, from a new seed (logged), instead of returning to the menu. (2) **No Man's Land: the opponent throws at the player's dice** (`aimHandful`), at where they were let go, 3–4.5 units/s with no extra lift: the handfuls collide ~4× as often with one die a side, ~2× with eight. Eight a side do stack up now and then: 1.9% of Fireball's throws time out (0.75% unaimed; the limit is 2%). Harder or lobbed, they heaped up and up to 1 throw in 20 timed out. This is the only aimed throw; the opponent AI proper is for later. (3) **The re-throw button sits right under the result card**, where the eye already is, amending D31 and 4.6a: it may now sit over the tray, so it's placed clear of every die on the table (`placeRethrow`): centred under the card, else under its left or right edge, a row lower, or above it; with none of those clear, its old corner. (4) **Tug of War is on the table:** a rope lies down the middle from end to end, through the divider (which stays), and the dice collide with it; a red flag tied to it shows the marker, sliding towards the loser. Only the rope is in a throw's record (`rope: true`); the flag is drawn. A die propped on one corner against the rope rocks in place indefinitely, its speed peaking over the settle threshold every swing (Fireball timed out 1 throw in 6), so with a rope down, a die that stays within 2 cm and 3° of one pose for half a second has settled (`rocking`). Also found on the way: Rapier occasionally moves a die it says is asleep with nothing holding it up; a d4 fell 2.7 cm into the floor that way (~1 throw in 500). One that sinks more than 1 cm is now woken and pushed back out. Smaller dips (3.5 mm, once) are routine and left alone: waking those would change 12 of the 24 recorded table throws. |
| D42 | 2026-10-19 | **Dice Poker: the hands are the set's, the redraw is a Spice.** Poker hands are the Dice Poker set's scorer (§5), so the set always plays poker: best first, five of a kind, four, a full house, a straight (2-6 over 1-5), three, two pair, a pair, nothing; equal hands go to the higher dice in them, then the higher left over. The score is a rank no one sees; the card names the hand (`Full house (6s, 2s)`) and lists the dice with `·`, not `+`, as a named score isn't a sum (a scorer's `describe`). A die that counts 0 (cursed, down a hole) is dead, part of no hand. Spice that need a total or a die worth more than its face sit Dice Poker out: Hit Points, Race to N, Tug of War, Exploding Dice, Underdog. §6.5's "one reroll of chosen dice" is a Spice of its own, **Draw Poker**, only with that set, so the match label doesn't read "Dice Poker · Dice Poker": once both have thrown, each side may throw any of its dice again, once (a Spice's `redraws`). The player taps dice to pick them out (they glow), drags to throw them, or keeps them all with a button placed as the re-throw button is (D41); the opponent keeps what the scorer's `hold` says is worth keeping (the dice making its hand; with nothing, all but the lowest), and its dice to throw glow too. Both throw together. The dice kept are **held where they lie**, `fixed` in the record, so a redraw replays like any throw; a handful let go over one is lifted clear of it, all together (`liftClear`). A die picked up and fumbled goes straight back where it lay rather than dropping, since a drop could turn it over. Single-player until Q1. |
| D43 | 2026-10-19 | **Count the Sixes and Crown change the scorer for the match** (the `hand` hook): Count the Sixes counts 6s (`countOf`), the other dice greyed out and the total written `2 sixes`; Crown keeps the highest die and adds 5 for every die on its maximum, the counted one too, each written `+ 5 👑`. A d10's "0" is its maximum (D25). |
| D44 | 2026-10-19 | **Burnout is Hearts plus dice left**, a win condition like Death Saves (D36), so what a side throws still depends on the match state only (CLAUDE.md, `handOf`). Each die showing a 1 still counts that round, tagged `burnt` (`1🔥` on the card), then it's lost; 0 dice loses the match, both at once a draw. On the table the very dice that showed 1 burn up where they lie, a beat after landing, and the rest are numbered afresh (`removeDice`), so ids stay `player-0` onwards. Dice burnt are marks by the hearts (🔥, eight to a side: they fit on a phone). |
| D45 | 2026-10-19 | **Wild Magic's surge is drawn before every throw and set off by matching digits** (11 to 99, and `00 + 0` = 100: 10% a side). One surge per side is drawn from the rules stream every round, set off or not, so every hook reads the same one and the stream moves on the same way. Six surges: the totals swap (the lower wins), the round costs double, the surger regains a heart (capped at the start: Hearts now never go above it), it backfires and the surger loses one, it fizzles and nobody wins, or the surger wins outright. Both can surge, applied player first (D27): two swaps swap back. "The totals swap" only ever decides who wins, so it's the same as Lowball for a round; with hearts, swapping the numbers themselves would change nothing more. |
| D46 | 2026-10-19 | **A die thrown onto dice held where they lie settles near one pose** (`HELD_ROCK_MOVE`). Measured with `check-table.mjs`: 1 redraw in 36 waited out the timeout, a die propped between a held die and a wall jittering there or creeping down it a few cm a second (ordinary 5d6 throws: none in 400). The rope's rocking rule (D41) at 2 cm and 3 degrees made no difference, nor did more friction on held dice (worse), nor counting a second of being slow; within 5 cm and 6 degrees of one pose for half a second took it to 3 in 500. Only for records with a die held fixed (redraws, and an explosion's pops, which are only for show), so every recorded throw replays unchanged. |
| D47 | 2026-10-21 | **Player customisation comes before multiplayer** (Phase 6b, R6). The player has a profile (name, card background, tray colour, dice colour), saved on the device; each side is shown as a card in place of today's HUD block, after the owner's sketch: the name large across the top, the advantage badge bottom left, the match state bottom right. Four choices each, ids in registries so unlockable ones (a later progression system) slot in. **Dice:** orange, purple, ivory, charcoal, each with its own edge and numeral colours, readable on all four trays; no red, which would vanish on the satin red tray. **Tray:** billiard green, satin red, deep blue, light grey. **Card:** four light colours. The AI is "Opponent" for now (names later), its colours drawn at random from the same choices, **never the player's dice colour**, from a stream of its own so nothing else shifts. **The editor previews on the real scene:** a die in the chosen colours on the chosen tray, behind the editor. **No first-run prompt:** a new player is "Player" with the defaults, and the menu card's edit button invites a change. **On a phone both cards are compact** (name shrinks, then an ellipsis; hearts below it), as the opponent's has only ~130 px between the top corners. **Zen shows the player's card, name only,** and the whole tray takes the player's colour. Colours are cosmetic and never reach the rules engine or a throw record. |

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

### R6 — Player profile and customisation *(D47)*

- **R6.1** The player has a **profile**: name, card background, tray colour
  and dice colour. It is saved on the device in `localStorage`, every read and
  write wrapped so that where storage is missing or throws (a private window,
  the claude.ai artifact) the game plays on with the defaults for that session.
- **R6.2** **Name:** 1 to 16 characters; letters, numbers, symbols and emoji
  all allowed. Characters are counted as seen (grapheme clusters, so 👨‍👩‍👧 is
  one). Leading and trailing spaces are trimmed; an empty name falls back to
  the default, **"Player"**. The name is only ever shown as text, never as
  HTML.
- **R6.3** **Four choices each**, held in registries by id (the profile stores
  ids, not colours), so choices unlocked later join by being added there. A
  stored id that no longer exists falls back to the default.
  - **Card background** (light): parchment, mint, sky, blush.
  - **Tray:** billiard green, satin red, deep blue, light grey.
  - **Dice:** orange (default), purple, ivory, charcoal. Each is a body, edge
    and numeral colour together, and every one is readable on every tray.
- **R6.4** In a match **each side is a card** in place of today's HUD block,
  the opponent's at the top and the player's at the bottom, in its card
  background: the **name** large across the top, the **advantage badge**
  (R3.5) bottom left, the **match state** bottom right: hearts, a bar, marks,
  whatever the win condition's `view` draws (R3.4).
- **R6.5** The cards keep **clear of the top corners and of every resting
  spot** (4.6a), on desktop and on 390×844, and take no pointer events. On a
  phone both are **compact**: the name smaller, cut with an ellipsis if it
  still doesn't fit, the match state below it.
- **R6.6** The **opponent** is "Opponent" (AI names come later). Its card
  background, tray colour and dice colour are drawn at random from the same
  choices, never the player's dice colour, from a stream of its own derived
  from the match seed (`deriveSeed`), so a replayed match looks the same and
  no other stream moves.
- **R6.7** The **main menu** shows the player's card with a clear **edit**
  button beside it.
- **R6.8** The edit button opens the **player editor**: a name field and a row
  of swatches each for card, tray and dice. A copy of the card updates as
  things are picked, and the **real scene behind the editor** shows the
  player's tray and a die in the chosen colours. Save keeps the changes; Back
  drops them.
- **R6.9** **On the table** each half of the tray is its side's tray colour and
  each side's dice are its dice colour. In **Zen** the whole tray is the
  player's colour, and the player's card is shown with the name only.
- **R6.10** Colours are **cosmetic only**: they never reach the rules engine or
  a throw record, so every recorded throw replays unchanged.
- **R6.11** *(Phase 7)* In multiplayer each side sends its profile when the
  match is set up, and each client shows the other's card and colours on its
  half. A received profile is checked as a stored one is (R6.2, R6.3).

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
| Dice Poker | 5d6 | poker hand (D42) | — | nothing to five of a kind |

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
| Tug of War | A rope lies down the table, the dice colliding with it; a flag on it starts mid-table and moves toward the round loser by the difference in totals. Pull it to their end to win. |

### 6.3 Universal: comeback (state-based asymmetry) *(D8)*

| Spice | Rule |
|---|---|
| Underdog | Whoever is behind on the win condition throws one extra die (never above the 8-dice cap). |
| Revenge | Winning a round straight after losing one deals double damage. |
| Mercy | A player who falls two hearts behind gets one free re-throw. *(D30)* |

### 6.4 Universal: physical and interactive

| Spice | Rule | Note |
|---|---|---|
| Cat Paw 🐾 | Each round there is a chance a paw swipes in after the dice settle, knocking 1–2 random dice, which roll again. | |
| Second Wind | Once per match, re-throw all your dice after both results are shown. | Timing depends on Q1 in multiplayer |
| Pothole | A hole in each half of the table; a die that falls in counts as 0. | |
| Gusty Table | A random breeze pushes the dice while they roll. | |
| No Man's Land | The divider is removed and both sides throw at once; dice can knock into each other. | Multiplayer depends on Q1 |
| Difficult terrain | The board is covered in bumps and strange geometry, influencing the rolls | Not yet scheduled |

### 6.5 Specific to particular dice

| Dice | Spice | Rule |
|---|---|---|
| 1d20 | Critical Hit | A natural 20 that wins the round deals double damage. |
| 1d20 | Critical Fumble | A natural 1 costs you an extra heart, on top of whatever the round costs (D26). |
| 1d20 | Death Saves | Roll 10 or more or record a fail. Three fails ends the match, regardless of the opponent's roll. |
| 1d20 | Inspiration | The loser of the previous round rolls with advantage. |
| 2d6 | Snake Eyes / Boxcars | 1-1 loses the round automatically; 6-6 wins it. |
| 2d6, 3d6 | Doubles Again | Rolling doubles grants another throw, added to the total. |
| 3d6, 4d6 | Triples | Three of a kind wins the round outright. |
| 5d6 | Draw Poker | Once a round, before the hands are shown, throw any of your dice again; the rest stay where they lie (D42). Timing depends on Q1 in multiplayer. |
| 8d6 | Count the Sixes | Only the number of 6s counts. |
| 8d6 | Burnout | Each die showing a 1 is lost for the rest of the match. Running out of dice loses the match. |
| 3d4, 4d4 | Caltrops | Every 1 you roll is subtracted from your opponent's total. |
| Percentile | Wild Magic | A result with matching digits (11, 22, …, and 00 + 0) triggers a random surge, e.g. the two totals swap (D45). |
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

### Phase 7 — Multiplayer

Blocked on **Q1** for the protocol; 7.1–7.3 can start before Q1 is settled.

- [ ] **7.1** PeerJS connection: host creates a room, code and `?join=` link,
  guest joins (R4.1).
- [ ] **7.1a** TURN server configured (provider per Q4); verified by connecting
  a phone on mobile data to a desktop on home broadband (R4.7).
- [ ] **7.2** Host catalogue selection; guest sees the choice and rules (R4.2).
- [ ] **7.3** Shared seed and config handshake, with each side's profile
  (R6.11).
- [ ] **7.4** Throw protocol (simultaneous or turn-based, per Q1).
- [ ] **7.5** Send the release record; the other client simulates the throw
  with the Phase 0 harness (`replayThrow`); both sides check the face values
  match (R4.3).
- [ ] **7.6** Both clients evaluate the rules engine; mismatch detection (R4.4).
- [ ] **7.7** Disconnect handling and rejoin window (R4.5, Q2).
- [ ] **7.8** Interactive Spice in multiplayer: Second Wind, Draw Poker's redraw,
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
8. Each side's card shows its name, badge and match state, clear of the top
   corners and every resting spot on desktop and 390×844; a 16-character and
   an emoji name fit. The editor's changes show on the card, the tray and the
   dice, and survive a reload; the opponent's dice never take the player's
   colour; Zen's tray is all the player's colour.
