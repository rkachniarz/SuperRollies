# Super Rollies — Development Plan

What's left to do on the Dice & Spice expansion. Tick boxes as work lands;
record decisions in [docs/decisions.md](docs/decisions.md) rather than
silently changing requirements.

**Scope:** Quick Game (vs. AI) and host/join 1v1 multiplayer. The campaign is
out of scope (D1).

**Where things stand (2026-10-28):** Phases 0 to 6b are done: Rapier physics,
every die type from d4 to d20 plus percentile, 16 dice sets, 34 Spice, the
two-card draft, Zen, the `?dev` test bench, and player profiles with each side
shown as a card. Phase 7, multiplayer, is played over PeerJS, bar a TURN
server (7.1a). Phase 8 has given the room both players' cards, a ready check
and games won; it's still to be tried by two real players. Phase 9 stacks
Spice (D51): any that don't clash, dealt as stacks in Quick Game, picked
on the bench and by the multiplayer host; playtest pending (9.11).

## Where things are

| Cited as | What | Where |
|---|---|---|
| `D1`–`D58` | Decisions and their reasons | [docs/decisions.md](docs/decisions.md) |
| `R1.1`–`R7.3`, `§1`, `§4`–`§6` | Vision, requirements, catalogue of dice sets and Spice | [docs/spec.md](docs/spec.md) |
| `0.1`–`6b.9`, `§8` | Finished phases, task by task, with what was measured | [docs/history.md](docs/history.md) |
| `Q1`–`Q10`, `7.x`–`10.x`, `P.x` | Open questions, work still to do | here |

---

## Open questions

- [x] **Q1 — Simultaneous or turn-based throws in multiplayer?** Neither:
  independent throws, each shown live on the other screen, the round played
  out once both are in, and 30 s to follow the other's lead or lose by
  walkover (D48). No Man's Land is single-player only.
- [x] **Q2 — Rejoin window after a multiplayer disconnect.** 30 s, even
  across a reload: the match is rebuilt from the logged inputs (D49).
- [ ] **Q4 — Which TURN provider?** Needs a free or cheap tier and credentials
  that are safe to ship in a static site (short-lived credentials are better if
  the provider supports them).

(Q3, Rapier or cannon-es, was settled by Phase 0: D10.)

---

## Phase 7 — Multiplayer

Requirements: R4 and R6.11 in [docs/spec.md](docs/spec.md). Decisions already
made for it: D2 (GitHub Pages only, PeerJS), D3 (host picks from the
catalogue), D10 (send release records, not trajectories), D12 (TURN), D27
(both clients evaluate the engine from the host's seat), D48 (independent
throws, 30 s or walkover), D49 (rejoin from the input log).

- [x] **7.1** PeerJS connection: host creates a room, code and `?join=` link,
  guest joins (R4.1). `src/net/transport.js`; `?net=local` links two tabs
  of one browser instead, for tests.
- [ ] **7.1a** TURN server configured (provider per Q4); verified by connecting
  a phone on mobile data to a desktop on home broadband (R4.7).
- [x] **7.2** Host catalogue selection; guest sees the choice and rules (R4.2).
- [x] **7.3** Shared seed and config handshake, with each side's profile
  (R6.11).
- [x] **7.4** Throw protocol: independent throws, shown live, 30 s to
  follow or lose by walkover (D48).
- [x] **7.5** Send the release record; the other client plays the same record
  turned round, and both check where it landed (a digest of every die's
  final pose, R4.3).
- [x] **7.6** Both clients evaluate the rules engine (the guest through
  `guestSeat`), and compare a digest of the match state after every round
  (R4.4). Out of sync ends the match with no winner.
- [x] **7.7** Disconnect handling and a 30 s rejoin window, across a reload
  (R4.5, D49).
- [x] **7.8** Interactive Spice in multiplayer: Second Wind, Mercy, Draw
  Poker's redraw, Doubles Again (D48). No Man's Land left out of the host's
  catalogue.
- [x] **7.9** Host/Join hidden in the artifact build (R4.6).
- [x] **7.9a** Keep multiplayer code out of the artifact bundle: the build
  swaps `src/net/lobby.js` for a module that offers none, so nothing imports
  PeerJS there.
- [x] **7.10** Tested with two real browsers across two machines: the first
  real matches played on GitHub Pages, 2026-10-26.
- [x] **7.10a** Two players with the same dice colour tell their dice apart
  by half only. Not an issue (owner, 2026-10-26): each keeps the colour
  they picked.
- [x] **7.11** Docs refresh. `README.md` "Publishing" notes the runtime
  dependency on PeerJS's public signalling server, a third party that can be
  unavailable, and `?net=local` for two tabs without it.

## Phase 8 — Multiplayer polish

Requirements: R7 in [docs/spec.md](docs/spec.md). More to come.

Open questions:

- [x] **Q5 — What un-readies a player?** Only the player: they can take
  their Ready back until the match starts. The host changing the dice or
  Spice leaves both marks as they are (D50).
- [x] **Q6 — What counts as a game won?** A match won on the table, or by
  walkover. A draw, or a match ended out of sync, counts for nobody (D50).
- [x] **Q7 — How long does the count last?** As long as the room: a new room
  starts from 0-0 (D50). Lifetime scores between players: see *Ideas*.

- [x] **8.1** The lobby shows both players' cards at the top, `[Card] vs
  [Card]`, colours and all; an empty slot until a guest joins (R7.1). One
  room card for both seats now (`#netRoom`), this player's card first; the
  guest's invite card and its "Let's play" are gone.
- [x] **8.2** Ready check: a Ready button for each player, shown on their
  card; a match starts once both are ready (R7.2, Q5). The host keeps the
  room (`src/net/room.js`) and sends it to the guest (`room`), who only asks
  (`ready`); the host starts the match (`start`, replacing `invite` and
  `accept`; protocol 2).
- [x] **8.3** Games won in this room, under each player's card (R7.3, Q6,
  Q7), counted by the host as the match ends and kept with the saved
  session, so a host who reloads mid-match keeps the count.
- [x] **8.4** Checks in `check-multiplayer.mjs` for each of the above, and
  the phase-end runs (`npm test`, `npm run verify`, `npm run phase0`).

## Phase 9 — Spice stack *(D51)*

Several Spice in one match, wherever they don't clash: a win condition with
a rule change, the table Spice with anything. Supersedes D9. The cross-list,
[docs/stacking.md](docs/stacking.md), is generated from
`src/rules/stacking.js`; the code and the draft both go by that file.

Open questions:

- [x] **Q8 — How many Spice does a Quick Game offer stack?** Anything from 1
  to the most that can stack (13 on The Classic). Uniform over that range
  means half the offers are 7 or more Spice at once. Proposed: weighted
  towards few, e.g. 1: 35%, 2: 30%, 3: 20%, 4: 10%, 5 or more: 5%, so a big
  stack is a rare event. Could be tuned after playtesting. **Settled
  (owner, 2026-10-30): 1: 15%, 2: 35%, 3: 35%, 4: 10%, 5 or more: 5%.**
- [x] **Q9 — Is Vanilla still offered?** Proposed: yes, as an offer on its
  own, as often as today's one card in 33; never part of a stack. Agreed.
- [x] **Q10 — The multiplayer default.** Proposed: the host's room opens on
  a stack dealt as Quick Game deals one (Q8), dealt again when the dice set
  changes, with a "Deal again" button; the host can still pick and unpick
  Spice by hand. Agreed.

Tasks, in order: each leaves the game working, with a single Spice playing
exactly as before.

- [x] **9.0** The cross-list: slots and clashes in `src/rules/stacking.js`
  (`clashOf`, `canStack`, `largestStack`), `docs/stacking.md` generated by
  `node tools/stacking-table.mjs`, `test/stacking.test.js`.
- [x] **9.1** Engine: a config names a list of Spice (`spices`, catalogue
  order; one Spice still accepted as `spice`). Each Spice keeps its own state
  (`state.spice[id]`); hooks run in catalogue order. How each combines:
  - `setup`, `beforeThrow`, `afterSettle`: each Spice in turn, its own
    slice; announcements joined, swipes from Cat Paw only.
  - `table`: merged (each field has one Spice).
  - `hand`: chained (Burnout's dice left, then Underdog's extra die, then a
    scorer change).
  - `edge`, `adjust`, `explain`: joined.
  - `values`: chained, a die one Spice has tagged left alone by the rest. A
    fallen die is the engine's, before any Spice (counts 0); then cursed,
    then explosions, then burnt.
  - `applyDamage`: chained (Revenge and Critical Hit together: four times).
  - `compare`, `winCondition`, `rethrow`, `again`, `redraws`: one Spice at
    most, guaranteed by the slots and clashes.
  `canStack` is checked by `matchConfig`. Existing tests, fixtures and
  `table-throws.json` unchanged. Done as `src/rules/compose.js`: the stack
  played as one Spice, so the engine barely changed.
- [x] **9.2** What some stacks need to be right, before any can be played:
  - Mercy reads hearts through the win condition, so it works with Death
    Saves and Burnout (their state isn't plain hearts).
  - A die down a hole counts for nothing in hooks that read faces (Snake
    Eyes, Triples, Caltrops, a natural 20 or 1, Burnout, Doubles Again).
  - Pothole's holes kept clear of Tug of War's rope (only when it's down,
    so every recorded throw replays unchanged).
  - Texts that say "hearts" (Raising the Stakes, Revenge, Critical Hit) say
    it in the win condition's units under Hit Points and Tug of War. Only
    Raising the Stakes' did (`3 times as much`); the others say "double".
  - Found on the way: Doubles Again with Pothole doesn't know which dice of
    a throw made again went down a hole, so it's a fixable clash (9.10).
- [x] **9.3** The game: what names "the" Spice names the right one (a
  re-throw's button and notes name the re-throw Spice; `guestSeat`'s
  `explain`). The match's Dice/Spice label in the top corner shows a stack
  as icons and a count, still two lines at most; the rules popup lists every
  Spice in it; several announcements fit their pill. `npm run verify`
  measures each against the nearest resting die (4.6a).
- [x] **9.4** Physics: the table Spice together, measured in
  `check-table.mjs`: holes with a breeze, a rope or no divider; a rope with
  a breeze or no divider; a cat's knock on each; a redraw in a breeze. New
  records only, so nothing to re-record. Measured (100 throws a case on
  the four sets single Spice are checked with, 300 for a stack with
  Fireball): no die sunk, escaped or misread in any stack, and timeouts at
  0-2%, as alone, bar three, all with **Fireball's eight dice a side**: No
  Man's Land with the rope (14 in 300) or the breeze (12-14 in 300), and the
  breeze with the rope (1-7 in 300, run to run). Made fixable clashes for
  eight dice a side only (`minDice` in stacking.js, 9.10); with The Whole
  Bag's six and fewer they stall no more than alone.
- [x] **9.5** Quick Game: step 2 deals two stacks (Q8, Q9) from the match
  seed, each shown as one card listing its Spice, the stack's size marked.
- [x] **9.6** Test bench: after the dice set, pick any number of Spice, a
  clashing one greyed out with its reason (`clashWith`), then Start
  (`hud.showStackPicker`). The log line names the stack; `?dev&seed=N`
  replays it once the same stack is picked (no `&spice=` needed).
- [x] **9.7** Multiplayer: the room's choice is `{ diceSet, spices }`
  (protocol 3); the host's picker is the test bench's, opening on a dealt
  stack (Q10); the guest sees every Spice's card and rules. No Man's Land
  still left out (D48).
- [x] **9.8** Checks: `test/seat.test.js` plays every pair that stacks, on
  every dice set it's allowed, from both seats, and a sample of the largest
  stacks; `npm run verify` plays a stacked Quick Game, the bench and a
  stacked multiplayer match.
- [ ] **9.9** Phase end: `npm test`, `npm run verify`, `npm run phase0`,
  build and republish, then the docs: CLAUDE.md ("one Spice a match"),
  README.md, `package.json` and `index.html`'s copy.
  2026-10-30: all three pass (280 unit tests, 135 browser checks, 116
  physics checks), the build made and the docs refreshed; the artifact
  republish is still to do.
- [ ] **9.10** The fixable clashes, one at a time, each taken off the list
  once it's done: Doubles Again with a re-throw, a re-throw or doubles under
  No Man's Land (hold the other side's dice where they lie, as Draw Poker
  does), Draw Poker with Pothole, Doubles Again with Pothole (record which
  dice of a throw made again fell), and with Fireball's eight dice a side,
  No Man's Land with the rope or the breeze, and the breeze with the rope.
- [ ] **9.11** Playtest stacks (owner, 2026-10-30 evening): the sizes Q8
  deals, the cards, and whether any stack that's allowed shouldn't be.

## Phase 10 — Playtest requests (2026-10-30)

From the first evening with Spice stacks. *(D52)*

- [x] **10.1** In the room, the host taps a Spice of the stack last chosen to
  switch it off or on again (`toggleSpice`, `room.pool`): a rematch without
  one rule. Switched-off cards stay, greyed, on both screens; all off is
  Vanilla.
- [x] **10.2** The room's buttons (Leave, Change, Ready) at its top as well
  as the bottom: copies kept in step, a tap on one a tap on the other.
- [x] **10.3** Tapping your own card in the room edits your profile without
  leaving it; the other player sees it (`profile` message, protocol 3
  still). Both ready and the match starts mid-edit: what was typed is
  saved and the match plays (`saveEdits`).
- [x] **10.4** Twin Axes, 2d12. Brutal Critical plays with it too.
- [x] **10.5** A room with any XdY: X from 1 to 8 (D6), Y any die from the
  d4 to the d20 (D53): *Any dice* in the host's dice picker, then the die,
  then how many.
- [x] **10.6** The host taps the dice in the room to change just them, the
  Spice kept, bar any the new dice don't allow (D54).
- [x] **10.7** Throws that really roll: much harder (14, tapering to 10
  for eight dice), a little bouncier, never a drop (a minimum speed and
  spin), and a handful that follows the finger much faster (D55).
- [x] **10.8** Reroll Cocked, a Spice: a cocked die is tossed again (D56).
- [x] **10.10** The AI has a name for its dice set, two or three each (D57).
- [x] **10.11** A full room hides its code and link (D57).
- [x] **10.12** Gusty Table from a breeze to a gale; a named cat; Exploding
  Dice both ways; the stack picker grouped; compact cards (D58).
- [x] **10.9** The room's Ready button: bigger, red until you're ready and
  green once you are, and always on the right.

## Post-MVP — Browser compatibility *(D14)*

- [ ] **P.1** Run the verification checklist in Firefox and WebKit as well as
  Chromium. Unexamined so far: during Phase 0, one early run in Firefox timed
  out on check 4 and one in WebKit failed check 3, the second probably the
  same test flakiness that was fixed for Chromium.
- [ ] **P.2** Check D (history 0.7) in desktop Firefox and Safari, and iOS
  Safari. Required before multiplayer is offered to players on iOS.

---

## Loose ends

Carried over from finished phases. Not re-checked since, so either may
already be fixed.

- **A flaky verify check** (history 1.7): one run in six of `npm run verify`
  failed "Zen (390x844)" with a 15 s `waitForFunction` timeout (a throw that
  never produced a round). Never diagnosed.
- **Layout on a real phone** (history 0.8a): noted on a Pixel 9 Pro during
  Phase 0 as needing work. Much of the 390×844 work since may have covered
  it.

## Ideas, not scheduled

- **Lifetime scores between players**: games won carried over from room to
  room for the same two players, rather than starting again at 0-0 (Q7,
  D50).
- **Difficult terrain** (spec §6.4): the board covered in bumps and strange
  geometry that influence the rolls.
- **A proper AI** (D41, D47): it has a name for its dice now (D57), but
  throws at random.
- **Unlockable colours** (D47): the profile's registries take them by id.
