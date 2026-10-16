# Super Rollies

A d20 roll-off game. Pick up your die, throw it, roll higher than your opponent.
Lose a round and you lose a heart; lose three and the match is over.

Real rigid-body physics, a proper twenty-sided die with the numbers etched onto
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
`styles.css` and `src/` are all that's served; three.js and cannon-es come from
a CDN at runtime.

## Layout

```
index.html    the page: markup, and the import map pinning three.js / cannon-es
styles.css    all styling - HUD, hearts, menu, result card
src/
  config.js   every tunable number and colour, in one place
  d20.js      the icosahedron, and which number goes on which face
  dice.js     building a die: faceted body, etched numbers, physics shape
  arena.js    the tray - renderer, camera, lights, walls, physics world
  input.js    grab / drag / release, and telling a throw from a fumble
  hud.js      hearts, the message card, the menu
  game.js     match flow: rounds, hearts lost, win and lose
  main.js     wires it together and runs the frame loop
tools/
  build-artifact.mjs   bundles everything into one file (see below)
```

Start with `main.js` — it's short, and it names every piece in the order they're
created.

## The single-file build

`npm run build` writes `dist/artifact.html`, the whole game inlined into one
page. That exists only for publishing to claude.ai as an artifact, which takes a
single file. Nothing about running or deploying the site needs it.

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
  a die resting off screen can't be tapped, which would strand the match.
- **Camera near/far is deliberately tight**, to keep depth-buffer precision where
  the etched numbers need it.
