# Super Rollies — notes for Claude

A d20 roll-off game: three.js for rendering, Rapier (deterministic build) for
physics, no framework, no build step to run it. See README.md for the
file-by-file map.

## Development plan

**Read `DEV_PLAN.md` before starting work.** It holds the Dice & Spice expansion
(dice sets, rule modifiers, 1v1 multiplayer): requirements, a decision log, open
questions, and phased tasks with tickboxes. Tick tasks off as they land, and
record new decisions in its log rather than silently changing requirements.

## Commands

```bash
npm install
npm run dev     # http://localhost:8000 - must be served, ES modules don't load over file://
npm run build   # -> dist/artifact.html, the single-file copy for claude.ai only
npm test        # unit tests (node:test): RNG, rules engine, Hearts, Vanilla
npm run verify  # the browser checks below, in headless Chromium (needs npm run dev)
npm run phase0  # physics checks: d10 settling, tunnelling, determinism (needs npm run dev)
```

Browser checks run in Chromium only until after the MVP (DEV_PLAN.md, D14).

## The published artifact

The game is also published as a Claude artifact:

    https://claude.ai/artifact/SahBwJ5sN4dnuY7s3ooRbz

**Republish to that URL** (pass it as `url`) rather than publishing fresh, which
would create a second, disconnected artifact. The repo is the source of truth;
the artifact is a build output. Changing the game means: edit `src/` → `npm run
build` → publish `dist/artifact.html` to that URL.

## Things that look arbitrary but are not

Each of these was a real bug that took real effort to find. They are commented at
the point they matter; this is the index so they don't get "cleaned up" by
someone (or something) tidying with good intentions.

- **`src/dice.js` — the decal orientation basis must be right-handed.**
  `right = up × normal`, not `normal × up`. The latter is a mirror, and a
  quaternion cannot represent a reflection, so `setFromRotationMatrix` silently
  yields a wrong orientation for every face: numbers come out at odd angles or
  vanish entirely (a decal facing away is backface-culled). Symptom when broken:
  the best camera-facing decal has a *negative* dot with the view direction,
  which is geometrically impossible on a correct die.
- **`src/dice.js` — decal size must stay under `inradius * √2`.** It's at
  `inradius * 1.0`. Larger and a corner of the square decal crosses its
  triangle's edge and bleeds onto the neighbouring face.
- **`src/dice.js` — the numerals use an unlit `MeshBasicMaterial` on purpose.**
  A lit material makes the player die's near-black digits unreadable on faces
  angled away from the key light, because numeral and facet darken together.
- **`src/config.js` — camera near/far is deliberately tight (8–20).** A wide
  range starves depth-buffer precision exactly where the decals sit, and they
  lose the depth test against their own face on some GPUs only.
- **`src/input.js` — a throw is judged by drag *distance*, not speed.** Speed was
  derived from timestamps a couple of pointer events apart and became unreliable
  whenever the browser was briefly busy, wrongly rejecting genuine slow throws.
- **`src/arena.js` + `src/physics.js` — the die is confined to what's actually
  on screen.** The camera's FOV is vertical, so a narrow phone screen sees less
  of the tray's width; a die resting off screen cannot be tapped, and the match
  is stranded. `arena.js` works out the limit; `physics.js` (`sideWallFace`)
  moves the side-wall colliders in to it, as invisible walls at the screen's
  edges. On wide screens they are the tray's own walls, so this costs nothing
  there. **The limit must stay a collider, never a position clamp:** clamping
  by moving the die made an invisible frictionless wall that dice leaned on
  and crawled down for seconds.
- **`src/arena.js` — a die is released at least `DIE_RADIUS` from any wall.**
  That's the d20's circumradius, so it clears the wall in every orientation
  (`clampToTray` for the held die, `opponentZone` for the opponent's). Any
  closer and the throw starts inside the wall's collider, and Rapier's push out
  of it flings the die backwards before the throw has begun.
- **`src/physics.js` — `clampToArena` is only a safety net.** Rapier's
  continuous collision detection stops tunnelling (Check C has never seen a
  die escape), but the clamp costs nothing. It sits at the walls' inner
  faces, so in normal play it never fires.
- **`src/physics.js` — a fresh physics world for every throw.** The engine
  keeps internal state between steps (contact caches, warm-starting) that a
  release record can't capture. A new world plus the record is the whole
  story, which is why a replay is bit-identical, and why multiplayer can send a
  throw's record instead of its trajectory. Don't "optimise" this into one
  long-lived world.
- **`src/physics.js` — Rapier's own sleeping is off (`setCanSleep(false)`).**
  Its default thresholds froze dice that were still slowly toppling off an
  edge, leaving them balanced at an angle. The settle check in `step()` is the
  only thing that puts a die to sleep.
- **`src/physics.js` — settled means slow *and* resting on a face
  (`restsOnFace`).** A die toppling off an edge pauses at the tipping point;
  speed alone called that settled. The touching points must span an area.
  Counting them doesn't work: Rapier reports several along a single edge.
- **`src/rules/` — the rules engine stays pure.** No DOM, physics, clock or
  `Math.random()`: a round's outcome is a function of the match config, the
  match state and both sides' faces, and nothing else. Multiplayer depends on
  both clients computing it themselves and agreeing (DEV_PLAN.md R4.4).
  Randomness comes from the seeded rules stream in the hook context.
- **`src/rng.js` — one stream per consumer, derived from the match seed.** The
  opponent's throws, the player's spin jitter and the rules each have their
  own (`deriveSeed`). Sharing one would let an extra draw in one shift the
  others, and in multiplayer only the rules stream is common to both players.
- **`src/hud.js` — the HUD draws the win condition's `view`, it doesn't keep
  score.** Hearts are only the default win condition (R3.4).
- **`src/physics.js` — squared magnitudes, not `Math.hypot`, in anything that
  decides when a simulation stops.** `hypot`'s last bit may differ between
  JavaScript engines; determinism needs bit-exact decisions everywhere.
- **`src/dice.js` — dice start each match *placed* flat on a face, never
  dropped.** Dropped from rest in the default orientation, a d20 lands exactly
  on a level edge and, the simulation being deterministic, stays balanced
  there; the opening settle then waited out the 4 s timeout, and the die
  couldn't be picked up in that time.
- **`styles.css` — `#result` stays `pointer-events: none` except when it's the
  match-over card.** It sits dead centre, which is where the die rests against
  the divider; if it took pointer events, the tap that should pick up the die
  would dismiss the card instead. Board taps dismiss it (see `input.js`).
- **`index.html` must keep its doctype and viewport meta.** Without them a phone
  lays the page out at ~980px and scales it to ~40%. The artifact copy is a
  *fragment* without them on purpose — claude.ai supplies its own wrapper.

## Working style that has paid off here

Check changes in a real browser before calling them fixed. This project has a
track record of confident, plausible-sounding diagnoses that turned out wrong —
lighting, z-fighting and camera precision were all blamed before the actual cause
(a mirrored basis) was found by measuring rather than reasoning. Headless
Chromium via Playwright works well: drive a real throw, then read the scene graph
or sample pixels instead of trusting a screenshot.

Worth re-checking after any change to dice, camera, input or physics. All of
these are scripted in `npm run verify` (`tools/phase0/verify.mjs`):

1. 20 decals per die, and at rest at least one squarely faces the camera.
2. A micro-nudge is refused ("Make a proper throw!"); a genuine drag throws.
3. The die is grabbable on the first tap even when the result card overlaps it.
4. On a 390×844 viewport the die is still reachable at its sideways limit.
5. A full match drains hearts to 0, announces the result, returns to the menu.
6. A fresh match's die is grabbable at once; a fumbled die can be caught
   mid-fall.
7. Zen: no opponent, the die reaches the far half, the back button is clear of
   every spot a die can rest, and Quick Game afterwards restores the table.
8. The same match seed throws the opponent's die the same way.

Run `npm test` alongside; it needs no server.

After a change to physics, also run `npm run phase0`. If throw outcomes change
on purpose (tuning, colliders), re-record the determinism fixtures with
`node tools/phase0/record-throws.mjs` (needs `npm run dev`).
