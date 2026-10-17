# Super Rollies

A dice roll-off game. Pick your dice - a single d20, 2d6, all the way up to a
Fireball's 8d6 - pick them up, throw them, roll higher than your opponent. Lose
a round and you lose a heart; lose three and the match is over. Or pick **Zen**
and just throw: any of the dice, the whole tray, no score.

Real rigid-body physics (Rapier, in its deterministic build, so a throw replays
identically on any machine), proper dice - a twenty-sided die with its numbers
etched on in the standard (non-spindown) layout, six-sided ones with pips - and
a throw driven by an actual drag-and-release gesture that works the same with a
mouse or a finger. Grab any one of your dice and the whole handful comes up,
rolling about in your palm until you throw it.

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
styles.css    all styling - HUD, hearts, menu and pickers, result card
src/
  config.js   every tunable number and colour, in one place
  d20.js      the icosahedron, and which number goes on which face
  d6.js       the cube (corners cut off a little), and its numbering
  die-shapes.js  every die type, and what's derived from its shape: normals,
              rest pose, which face is up
  dice.js     building a die of any type: faceted body, etched numbers or pips
  handful.js  several dice as one handful: how they sit together, how they
              scatter when thrown, and the opponent's throw
  table.js    the dice on the table this match, and where they wait
  arena.js    the tray as drawn - renderer, camera, lights, walls - sized per
              dice set, and how much of it is on screen
  physics.js  the tray's colliders, the dice in flight, and a handful being
              held (in an unseen palm); no DOM, so it runs in Node too
  roll.js     plays a throw on screen: fixed-step physics, smooth drawing
  replay.js   replays a recorded throw to rest; reads the faces
  input.js    grab / drag / release, and telling a throw from a fumble
  hud.js      the match state (hearts), the message card, the menu and pickers
  game.js     match flow: starts a match, throws, hands each round's dice to
              the rules, and Zen
  rng.js      the seeded random number generator every outcome draws from
  rules/      the rules, as pure functions with no DOM or physics:
    engine.js         match config, and what a round's dice mean for the match
    dice-sets.js      what each side throws, how it's scored (sum, keep
                      highest, drop lowest), and its tray
    spice.js          per-match rule changes (only Vanilla so far)
    win-conditions.js how a match is won (Hearts by default)
    types.js          the JSDoc types they share
  main.js     wires it together and runs the frame loop
test/         unit tests for the RNG, the rules and handfuls (npm test)
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
npm test         # unit tests: RNG, rules engine, scorers, handfuls (node:test, no server needed)
```

With `npm run dev` running:

```bash
npm run verify   # plays the game in headless Chromium and checks it behaves
npm run phase0   # physics: d10 settling, tunnelling, handfuls, bit-identical replays
```

`npm run phase0`'s determinism check replays the throws recorded in
`tools/phase0/throws.json`. To check a real device, open
`http://<this machine's address>:8000/tools/phase0/determinism.html` on it.
The first `npm install` also needs `npx playwright install chromium`.

## A few things worth knowing before changing them

Several details here look arbitrary but are load-bearing — each one is commented
at the point it matters:

- **Face numbering is computed, not hard-coded.** On the d20, opposite faces
  summing to 21 is derived from the geometry itself, so it can't silently
  disagree with the mesh. Every die type's normals, rest pose and face reader
  come from its own vertices, in `die-shapes.js`.
- **The number decals' orientation basis must stay right-handed.** Building it
  the other way round produces a mirror, which a quaternion cannot represent —
  the numbers then render at wrong angles or vanish entirely.
- **A throw is judged by distance dragged, not speed.** Speed came from
  timestamps a couple of pointer events apart and was badly unreliable whenever
  the browser was briefly busy.
- **The dice are confined to what's actually on screen.** The camera's field of
  view is vertical, so a narrow phone screen sees less of the tray's width — and
  a die resting off screen can't be tapped, which would strand the match. The
  limit is made of invisible wall colliders at the screen's edges.
- **Every throw gets a fresh physics world**, built from where and how the dice
  were let go. That's what makes a replay exact, so don't fold it into one
  long-lived world.
- **Camera near/far is deliberately tight**, computed around whichever tray is
  in use, to keep depth-buffer precision where the etched numbers need it.
- **A settled die is only put to sleep if no other die touches it.** Rapier
  lets a body sent to sleep while touching one still moving sink through the
  floor.
- **No `Math.random()` in anything that affects a result.** Every match has a
  seed, and the opponent's throws, the spin on yours, and (later) Spice events
  each draw from their own stream derived from it. Same seed, same match.
