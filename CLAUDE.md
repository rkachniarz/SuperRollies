# Super Rollies — notes for Claude

A dice roll-off game (1d20 up to 8d6 a side): three.js for rendering, Rapier
(deterministic build) for physics, no framework, no build step to run it. See README.md for the
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
npm test        # unit tests (node:test): RNG, rules engine, scorers, handfuls
npm run verify  # the browser checks below, in headless Chromium (needs npm run dev)
npm run phase0  # physics checks: d10 settling, tunnelling, handfuls, determinism (needs npm run dev)
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
- **`src/dice.js` — decal size must stay under `inradius * √2`.** Each die
  type sets its own multiple (`decalSize` in `d20.js`, `d6.js`): 1.0 on the
  d20, 1.3 on the d6. Larger than √2 and a corner of the square decal can cross
  its face's edge and bleed onto the neighbouring face.
- **`src/dice.js` — the numerals use an unlit `MeshBasicMaterial` on purpose.**
  A lit material makes the player die's near-black digits unreadable on faces
  angled away from the key light, because numeral and facet darken together.
- **`src/arena.js` — camera near/far is deliberately tight.** `fitCamera`
  computes it around the tray in use (≈9–15 for The Classic), plus
  `CAMERA_DEPTH_MARGIN`. Never one wide range covering every tray: a wide range
  starves depth-buffer precision exactly where the decals sit, and they lose
  the depth test against their own face on some GPUs only.
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
  and crawled down for seconds. Between throws, `keepOnScreen` (`table.js`)
  slides dice back in only if the window narrowed past them, judged by how
  far each die *actually* reaches sideways as it lies - never its
  circumradius, which made every d6 resting against a side wall jump inwards
  as the throw ended.
- **`src/arena.js` — a die is released at least its circumradius from any
  wall**, so it clears the wall in every orientation (`clampToTray` for the
  held handful, `opponentZone` for the opponent's, both given the handful's
  `reach`). Any closer and the throw starts inside the wall's collider, and
  Rapier's push out of it flings the die backwards before the throw has begun.
  For the same reason a single die is released from where it was *headed* in
  the hand, not where it's drawn while catching up, and the AI's handful is
  laid out with dice two circumradii apart (`handLayout` in `handful.js`).
- **`src/physics.js` — a held handful lies in a simulated palm
  (`createHoldSim`), and the throw starts from wherever its dice are.** That's
  what lets them roll about and knock together while held and still never
  start a throw inside each other. Each of these was found by measuring a
  failure (`check-handfuls.mjs` holds every set with the hand jumping about):
  - **Fingers, with curled tips.** A bowl and lip alone let dice ride up and
    over when the hand jerked; plain upright fingers let a rolling d20 out.
  - **The palm is clamped to where the hand may go.** Its acceleration is
    capped, so it overshoots the pointer, and it carried dice into a wall.
  - **The shake fades as the hand moves** (`HOLD_CALM_SPEED`). Shaking while
    sweeping across the table flung dice out of the palm.
  - **The bowl is sized by how many dice it holds, in one layer**
    (`HOLD_PALM_SIZE`), not by `handLayout`'s rows: those made Dice Poker's
    palm wider than its tray, and trimming it to fit stacked the d20s.
  - **Dice start packed flat on a hex grid, the rest in the dips one layer
    up** (`startingSpots`). Stacked straight above their own spots they
    started inside the curled fingertips; stacked in the middle they
    towered and bounced out.
  - **Stiffer contacts in the hold's world only**: dice squeezed together in
    a bowl sink into each other more than in any throw.
  - On release, `settle()` lets overlaps push apart, **damped, not with
    velocities zeroed** (zeroing stalls it). It bottoms out at a few cm, which
    Rapier separates at a few cm/s; `check-handfuls.mjs` measures that shove.
  - A die that leaves the palm anyway is put back (`rescued`), as a safety
    net; the check allows it in at most 1 hold in 100.
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
- **`src/physics.js` — a settled die is only put to sleep if no other die
  touches it (`touchesAnotherDie`).** Sent to sleep while touching a die still
  awake, Rapier reports it asleep yet keeps applying gravity with no contact to
  hold it up, and it sinks through the floor. One die a side never showed it
  (the divider keeps them apart); handfuls did, in ~1 throw in 3. A settled
  die left awake stays settled while it stays quiet. `check-handfuls.mjs`
  guards this.
- **`src/physics.js` — settled means slow *and* resting on a face
  (`restsOnFace`).** A die toppling off an edge pauses at the tipping point;
  speed alone called that settled. The touching points must span an area.
  Counting them doesn't work: Rapier reports several along a single edge.
  Between two dice "touching" is 3 cm, not 1 (`TOUCHING_DIE`): Rapier rests two
  moving bodies 1–2 cm apart, and dice leaning on each other never settled.
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
- **`src/game.js` — Zen is the testbed, and its picker offers everything:**
  every dice set (`DICE_SETS`) and every die type alone (`DIE_TYPES`). Both
  lists are built from the registries, so a new set or die joins it by being
  added there; `npm run verify` checks nothing is missing (DEV_PLAN.md, D18).
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

1. Every die shows its full set of numerals (20 on a d20, 6 pip faces on a
   d6), at rest at least one squarely faces the camera, and the face the game
   read is the one on top.
2. A micro-nudge is refused ("Make a proper throw!"); a genuine drag throws.
3. The die is grabbable on the first tap even when the result card overlaps it.
4. On a 390×844 viewport every die is still reachable at its sideways limit,
   for one die and for 8. Dice at rest stay exactly where they landed (against
   the side walls too), and narrowing the window slides them back on screen.
5. A full match drains hearts to 0, announces the result, returns to the menu.
6. A fresh match's die is grabbable at once; a fumbled die can be caught
   mid-fall.
7. Zen: no opponent, the die reaches the far half, the back button is clear of
   every spot a die can rest, and Quick Game afterwards restores the table.
   Zen offers every dice set and every die type alone, and throws what's
   picked: one d6, or a handful totalled with its set's scorer.
8. The same match seed throws the opponent's dice the same way.
9. Handfuls (2, 4, 5 and 8 dice): one grab picks them all up, they're thrown
   together, and the result card adds each side up, greying out dice that
   don't count (Advantage, Heroic Stats).

Run `npm test` alongside; it needs no server.

After a change to physics, also run `npm run phase0`. If throw outcomes change
on purpose (tuning, colliders), re-record the determinism fixtures with
`node tools/phase0/record-throws.mjs` (needs `npm run dev`).
