# Super Rollies

A d20 roll-off game. Pick up your die, throw it, roll higher than your opponent.
Lose a round and you lose a heart; lose three and the match is over. Or pick
**Zen** and just throw: one die, the whole tray, no score.

Real rigid-body physics (Rapier, in its deterministic build, so a throw replays
identically on any machine), a proper twenty-sided die with the numbers etched onto
its faces in the standard (non-spindown) layout, and a throw driven by an actual
drag-and-release gesture that works the same with a mouse or a finger.

## Running it

It's a static site with no build step — but it does need to be served over HTTP,
because browsers refuse to load ES modules from `file://`. Opening `index.html`
by double-clicking it will show a blank page.

```bash
npm install     # only needed for the dev server and the artifact build
npm run dev     # http://localhost:8000
```

Any static server works just as well (`python -m http.server`, the VS Code Live
Server extension, etc.).

## Publishing

The repository root *is* the deployable site. For GitHub Pages: push, then in
Settings → Pages pick your branch and the `/` root folder. `index.html`,
`styles.css` and `src/` are all that's served; three.js and Rapier come from a
CDN at runtime.

## Layout

```
index.html    the page: markup, and the import map pinning three.js / Rapier
styles.css    all styling - HUD, hearts, menu, result card
src/
  config.js   every tunable number and colour, in one place
  d20.js      the icosahedron, and which number goes on which face
  dice.js     building a die: faceted body, etched numbers, its starting spot
  arena.js    the tray as drawn - renderer, camera, lights, walls - and how
              much of it is on screen
  physics.js  the tray's colliders and the dice in flight; no DOM, so it runs
              in Node too
  roll.js     plays a throw on screen: fixed-step physics, smooth drawing
  replay.js   replays a recorded throw to rest; reads the faces
  input.js    grab / drag / release, and telling a throw from a fumble
  hud.js      the match state (hearts), the message card, the menu
  game.js     match flow: starts a match, throws, hands each round's dice to
              the rules, and Zen
  rng.js      the seeded random number generator every outcome draws from
  rules/      the rules, as pure functions with no DOM or physics:
    engine.js         match config, and what a round's dice mean for the match
    dice-sets.js      what each side throws, and how it's scored
    spice.js          per-match rule changes (only Vanilla so far)
    win-conditions.js how a match is won (Hearts by default)
    types.js          the JSDoc types they share
  main.js     wires it together and runs the frame loop
test/         unit tests for the RNG and the rules (npm test)
tools/
  build-artifact.mjs   bundles everything into one file (see below)
  phase0/              browser checks and physics checks (see below)
```

Start with `main.js` — it's short, and it names every piece in the order they're
created.

## The single-file build

`npm run build` writes `dist/artifact.html`, the whole game inlined into one
page. That exists only for publishing to claude.ai as an artifact, which takes a
single file. Nothing about running or deploying the site needs it.

## Checks

```bash
npm test         # unit tests: RNG and rules engine (node:test, no server needed)
```

With `npm run dev` running:

```bash
npm run verify   # plays the game in headless Chromium and checks it behaves
npm run phase0   # physics: d10 settling, tunnelling, bit-identical replays
```

`npm run phase0`'s determinism check replays the throws recorded in
`tools/phase0/throws.json`. To check a real device, open
`http://<this machine's address>:8000/tools/phase0/determinism.html` on it.
The first `npm install` also needs `npx playwright install chromium`.

## A few things worth knowing before changing them

Several details here look arbitrary but are load-bearing — each one is commented
at the point it matters:

- **Face numbering is computed, not hard-coded.** Opposite faces summing to 21 is
  derived from the geometry itself, so it can't silently disagree with the mesh.
- **The number decals' orientation basis must stay right-handed.** Building it
  the other way round produces a mirror, which a quaternion cannot represent —
  the numbers then render at wrong angles or vanish entirely.
- **A throw is judged by distance dragged, not speed.** Speed came from
  timestamps a couple of pointer events apart and was badly unreliable whenever
  the browser was briefly busy.
- **The die is confined to what's actually on screen.** The camera's field of
  view is vertical, so a narrow phone screen sees less of the tray's width — and
  a die resting off screen can't be tapped, which would strand the match. The
  limit is made of invisible wall colliders at the screen's edges.
- **Every throw gets a fresh physics world**, built from where and how the dice
  were let go. That's what makes a replay exact, so don't fold it into one
  long-lived world.
- **Camera near/far is deliberately tight**, to keep depth-buffer precision where
  the etched numbers need it.
- **No `Math.random()` in anything that affects a result.** Every match has a
  seed, and the opponent's throws, the spin on yours, and (later) Spice events
  each draw from their own stream derived from it. Same seed, same match.
