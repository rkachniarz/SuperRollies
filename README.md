# Super Rollies

A dice roll-off game. Draft your dice - a single d20, 3d4, a percentile roll,
two d12s, all the way up to a Fireball's 8d6 - then a **Spice** that bends the rules for
the match: the lowest total wins, dice explode on their highest number and on a 1, a
natural 20 hits twice as hard, whoever's behind throws an extra die. Or it
bends the table: a pothole in each half, a breeze across it, a cat's paw
swiping at the dice once they've settled, no wall down the middle. Or how
you score and win: poker hands with a redraw, only the sixes counting, dice
that burn out on a 1, hit points, a race to a target, a tug of war. Or
several Spice at once, stacked wherever they don't clash: hit points with a
breeze, a cat and exploding dice. Pick them up, throw
them, roll higher than your opponent. Lose a round and you lose a heart; lose
them all and the match is over. Or **play a friend**: host a room, send
them its link, pick the dice and a stack of Spice (or take the one dealt), and once you're both ready each of
you throws when you like, your friend's dice landing on your screen as they
throw them; the room keeps count of the games each of you has won. The host can
also pick *any dice*: one to eight of any die, 3d8 or 8d20. Between
matches the host can switch a Spice off for a rematch without it, and either
of you can tap your card to change it without leaving the room. Or pick
**Zen** and just throw: any of the dice, the whole tray, no score. Make it
yours on the menu: your name, your card, the colour of your half of the
tray and of your dice.

Real rigid-body physics (Rapier, in its deterministic build, so a throw replays
identically on any machine), proper dice - every polyhedral from the d4 to the
d20, plus the percentile die, numbered the standard way (the d4 read from its
top corner), six-sided ones with pips - and
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
`styles.css` and `src/` are all that's served; three.js, Rapier and PeerJS
come from a CDN at runtime.

Playing a friend also depends, at runtime, on **PeerJS's public signalling
server** (`0.peerjs.com`), a third party: it introduces the two browsers,
which then talk directly. If it's down, rooms can't be opened or joined;
everything else still works. Networks that won't let two browsers connect
directly need a TURN server as well, not yet configured (`ICE_SERVERS` in
`src/config.js`, DEV_PLAN.md Q4). Add `?net=local` to the address to play
between two tabs of one browser instead, with no server at all.

## Layout

```
index.html    the page: markup, and the import map pinning three.js / Rapier / PeerJS
styles.css    all styling - player cards, hearts, menu, editor, draft and cards, result card
src/
  config.js   every tunable number and colour, in one place, and the colours
              a player can pick for their card, tray and dice
  profile.js  the player's name and colours, saved on the device; the AI
              opponent's, drawn for each match
  d4.js d6.js d8.js d10.js d12.js d20.js
              each die type's shape and numbering (d10.js also has the
              percentile die, 00-90)
  polyhedra.js  helpers for those: faces from vertices, standard numbering
  die-shapes.js  every die type, and what's derived from its shape: normals,
              rest pose, which face is up, where its numbers are printed
  dice.js     drawing a die of any type: faceted body, etched numbers or pips
  handful.js  several dice as one handful: how they sit together, how they
              scatter when thrown, and the opponent's throw
  table.js    the dice on the table this match, and where they wait; dice
              popped out by an explosion, a cursed die's red 0, and dice
              burnt out for good
  arena.js    the tray as drawn - renderer, camera, lights, walls, any holes
              in the floor - sized per dice set, and how much of it is on screen
  physics.js  the tray's colliders (a floor with holes, a breeze), the dice
              in flight, and a handful being held (in an unseen palm); no
              DOM, so it runs in Node too
  effects.js  drawn but never simulated: the breeze's streaks, the cat's paw,
              an explosion's burst, the flag on Tug of War's rope
  roll.js     plays a throw on screen: fixed-step physics, smooth drawing;
              one per side at once, the other player's drawn turned round
  seat.js     a multiplayer match from the other chair: the rules engine
              from the host's seat, a throw turned 180° onto the far half
  replay.js   replays a recorded throw to rest; reads the faces
  input.js    grab / drag / release, telling a throw from a fumble, and a
              tap that picks a die out from a drag that throws
  cards.js    a dice set, Spice or single die as a card: the draft, Zen's
              catalogue and the rules popup all draw them
  hud.js      each side's card with its match state (hearts, or a bar for HP
              and the like), the message card, the match label and its rules
              popup, the re-throw button, the menu, the player editor, the
              draft and the catalogue
  game.js     match flow: the draft, starting a match, a round's throws (and
              a paw's knock, dice picked out and thrown again, doubles
              thrown again, a re-throw), handing them to the rules, Zen, and
              the editor's dice on the table; a multiplayer match's steps,
              each player in their own time, with its 30 s clocks
  net/        multiplayer, left out of the single-file build:
    transport.js      a room and a link into it: PeerJS, or ?net=local
    session.js        the room's players, the room passed to the guest,
                      every input of a match logged by step, pings,
                      reconnecting, picking a match back up after a reload
    room.js           between matches: the choice, who's ready, games won
    lobby.js          hosting, joining, and the room on screen: both cards,
                      Ready, and the dice and Spice
  rng.js      the seeded random number generator every outcome draws from
  rules/      the rules, as pure functions with no DOM or physics:
    engine.js         match config, and what a round's dice mean for the match
    dice-sets.js      what each side throws, how it's scored (sum, keep
                      highest, drop lowest, percentile, poker), and its tray
    poker.js          poker hands from dice: their ranking and names, and
                      which dice are worth keeping for a redraw
    spice.js          per-match changes: what dice count for, who wins a
                      round and what it costs, what each side throws, what
                      the table is like, and who may throw again, or throw
                      some of their dice again
    win-conditions.js how a match is won (Hearts by default; Hit Points,
                      Race to N and Tug of War scaled to the dice; Death
                      Saves and Burnout, Hearts with a second way to lose)
    draft.js          the two cards offered at each step of the draft,
                      the Spice ones each a stack of one Spice or more
    stacking.js       which Spice can be played together, and why not;
                      docs/stacking.md, the cross-list, is made from it
    compose.js        a Spice stack played as one Spice
    types.js          the JSDoc types they share
  main.js     wires it together and runs the frame loop
test/         unit tests for the RNG, the rules and every Spice, handfuls, die
              shapes, the player profile, the guest's seat, and the multiplayer
              room's Ready marks and games won (npm test)
tools/
  build-artifact.mjs   bundles everything into one file (see below)
  phase0/              browser checks and physics checks (see below)
```

Start with `main.js` — it's short, and it names every piece in the order they're
created.

## The single-file build

`npm run build` writes `dist/artifact.html`, the whole game inlined into one
page. That exists only for publishing to claude.ai as an artifact, which takes a
single file. Nothing about running or deploying the site needs it. It has no
multiplayer: `src/net/lobby.js` is swapped for a module that offers none, so
neither it nor PeerJS is in it.

## Checks

```bash
npm test         # unit tests: RNG, rules engine, scorers, handfuls, die shapes (node:test, no server needed)
```

With `npm run dev` running:

```bash
npm run verify   # plays the game in headless Chromium and checks it behaves, two players at once too
node tools/phase0/check-multiplayer.mjs   # only the multiplayer checks
npm run phase0   # physics: every die settles flat, tunnelling, handfuls, the tables Spice change, bit-identical replays
```

`npm run phase0`'s determinism check replays the throws recorded in
`tools/phase0/throws.json`, and in `table-throws.json` those onto tables a
Spice changes (holes, a breeze, no divider, a cat's knock, a rope). To check a real device, open
`http://<this machine's address>:8000/tools/phase0/determinism.html` on it.
The first `npm install` also needs `npx playwright install chromium`.

## A few things worth knowing before changing them

Several details here look arbitrary but are load-bearing — each one is commented
at the point it matters:

- **Face numbering is computed, not hard-coded.** Opposite faces summing to
  the same total (21 on a d20, 13 on a d12) is derived from the geometry
  itself, so it can't silently disagree with the mesh. Every die type's normals,
  rest pose, face reader and decal layout come from its own vertices, in
  `die-shapes.js`, and `test/dice.test.js` checks every numeral stays on its
  own face.
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
  seed, and the cards the draft deals, the opponent's throws, the spin on
  yours, and Spice events (an exploding die's extra roll, a cursed number)
  each draw from their own stream derived from it. Same seed, same match.
- **Nothing tappable sits where a die can come to rest.** The back button and
  the match label live in the top corners for that reason, and the re-throw
  button below the tray's near edge; a control over a resting die would steal
  the tap meant to pick it up.
- **In multiplayer each throw is simulated in its thrower's frame**, their
  dice in the near half, and the other screen replays the same record and
  draws it turned round. Both evaluate the rules from the host's seat
  (`seat.js`). Every input of a match is logged by step, which is what lets
  a reloaded page catch up, and lets the two clients notice if they ever
  disagree.
- **A pothole is a real hole.** With holes in it the floor is a triangle
  mesh with pits under it, so a die drops in and lies there. Rapier needed
  two things done differently for it (see `addHoledFloor` and `restsOnFace`
  in `physics.js`), found by `tools/phase0/check-table.mjs`.
