# Super Rollies — design and requirements

What the game is meant to be: the vision, the requirements (R1–R6) and the
catalogue of dice sets and Spice. Code cites these by number (`R6.4`, `§5`).
The section numbers are the ones from the original development plan, kept so
that those citations still resolve.

The reasons behind them are in [decisions.md](decisions.md); work still to do
is in [DEV_PLAN.md](../DEV_PLAN.md). A requirement changes by recording a
decision first, then editing it here.

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
