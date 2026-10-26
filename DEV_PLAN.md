# Super Rollies — Development Plan

What's left to do on the Dice & Spice expansion. Tick boxes as work lands;
record decisions in [docs/decisions.md](docs/decisions.md) rather than
silently changing requirements.

**Scope:** Quick Game (vs. AI) and host/join 1v1 multiplayer. The campaign is
out of scope (D1).

**Where things stand (2026-10-21):** Phases 0 to 6b are done: Rapier physics,
every die type from d4 to d20 plus percentile, 15 dice sets, 33 Spice, the
two-card draft, Zen, the `?dev` test bench, and player profiles with each side
shown as a card. Next is Phase 7, multiplayer.

## Where things are

| Cited as | What | Where |
|---|---|---|
| `D1`–`D47` | Decisions and their reasons | [docs/decisions.md](docs/decisions.md) |
| `R1.1`–`R6.11`, `§1`, `§4`–`§6` | Vision, requirements, catalogue of dice sets and Spice | [docs/spec.md](docs/spec.md) |
| `0.1`–`6b.9`, `§8` | Finished phases, task by task, with what was measured | [docs/history.md](docs/history.md) |
| `Q1`–`Q4`, `7.x`, `P.x` | Open questions, work still to do | here |

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
- [ ] **7.10** Tested with two real browsers across two machines. Two
  headless pages on one machine over the real PeerJS server: done.
- [ ] **7.10a** Two players with the same dice colour can't tell their dice
  apart by colour (only by half). Decide whether the guest's are shown in
  another colour on both screens.
- [ ] **7.11** Docs refresh. `README.md` "Publishing" notes the runtime
  dependency on PeerJS's public signalling server, a third party that can be
  unavailable.

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

- **Difficult terrain** (spec §6.4): the board covered in bumps and strange
  geometry that influence the rolls.
- **Stacking Spice** (D9): eligibility already has incompatibilities to allow
  for it.
- **AI opponent names and a proper AI** (D41, D47): it's "Opponent" and throws
  at random for now.
- **Unlockable colours** (D47): the profile's registries take them by id.
