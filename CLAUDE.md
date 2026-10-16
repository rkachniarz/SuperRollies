# Super Rollies — notes for Claude

A d20 roll-off game: three.js for rendering, cannon-es for physics, no framework,
no build step to run it. See README.md for the file-by-file map.

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
```

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
- **`src/arena.js` — the die is confined to what's actually on screen.** The
  camera's FOV is vertical, so a narrow phone screen sees less of the tray's
  width; a die resting off screen cannot be tapped, and with no reset button the
  match is stranded. On wide screens the limit equals the full tray, so this
  costs nothing there.
- **`src/arena.js` — `clampToArena` is a backstop, not redundancy.** cannon-es
  has no continuous collision detection, so a fast tumbling die can tunnel
  through a thin wall in one step.
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

Worth re-checking after any change to dice, camera or input:

1. 20 decals per die, and at rest at least one squarely faces the camera.
2. A micro-nudge is refused ("Make a proper throw!"); a genuine drag throws.
3. The die is grabbable on the first tap even when the result card overlaps it.
4. On a 390×844 viewport the die is still reachable at its sideways limit.
5. A full match drains hearts to 0, announces the result, returns to the menu.
