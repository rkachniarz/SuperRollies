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

- [ ] **Q1 — Simultaneous or turn-based throws in multiplayer?**
  - Simultaneous: faster, more chaotic, required for No Man's Land.
  - Turn-based: tenser reveals, and rerolls are easier to reason about because
    the opponent's result is known.
  - **Blocks:** Second Wind, Mercy and Draw Poker's redraw timing, No Man's
    Land in multiplayer, and the Phase 7 message protocol. Single-player
    keeps today's behaviour (both sides throw together) until this is
    settled.
- [ ] **Q2 — Rejoin window after a multiplayer disconnect.** How long before the
  remaining player is awarded the match?
- [ ] **Q4 — Which TURN provider?** Needs a free or cheap tier and credentials
  that are safe to ship in a static site (short-lived credentials are better if
  the provider supports them).

(Q3, Rapier or cannon-es, was settled by Phase 0: D10.)

---

## Phase 7 — Multiplayer

Requirements: R4 and R6.11 in [docs/spec.md](docs/spec.md). Decisions already
made for it: D2 (GitHub Pages only, PeerJS), D3 (host picks from the
catalogue), D10 (send release records, not trajectories), D12 (TURN), D27
(both clients evaluate the engine from the host's seat).

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
- [ ] **7.8** Interactive Spice in multiplayer: Second Wind, Mercy, Draw
  Poker's redraw, No Man's Land.
- [ ] **7.9** Host/Join hidden in the artifact build (R4.6).
- [ ] **7.9a** Keep multiplayer code out of the artifact bundle.
  `tools/build-artifact.mjs` treats every import-map entry as a CDN external,
  so adding PeerJS to the import map would make the artifact load it too. Add
  a build flag or a separate entry point that excludes the multiplayer modules.
- [ ] **7.10** Tested with two real browsers across two machines.
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
