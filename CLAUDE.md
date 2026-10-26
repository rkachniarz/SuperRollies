# Super Rollies — notes for Claude

A dice roll-off game (one die up to 8 a side, d4 to d20 and percentile, and a Spice that bends the
rules or the table each match), against the AI or a friend over the network: three.js for rendering,
Rapier (deterministic build) for physics, PeerJS for multiplayer, no framework, no build step to run it. See README.md for the
file-by-file map.

## Development plan

**Read `DEV_PLAN.md` before starting work.** It holds what's left of the Dice &
Spice expansion: open questions and the remaining phases, with tickboxes. Tick
tasks off as they land. The rest is in `docs/`, read when a citation calls for
it, since code comments cite all of these by number:

- `docs/decisions.md`: the decision log, `D1` onwards. Record new decisions
  there rather than silently changing requirements.
- `docs/spec.md`: the vision, requirements (`R1.1`–`R6.11`) and the catalogue
  of dice sets (`§5`) and Spice (`§6`).
- `docs/history.md`: finished phases task by task (`0.5`, `4.6a`, `5.1`...),
  with what was measured on the way.

A few rules every change keeps: at most 8 dice a side (D6); one Spice a match
(D9); a rule may favour whoever is in a given state (behind, just lost) but
never a player by identity, such as the host (D8).

A phase ends with `npm test`, `npm run verify` and `npm run phase0` passing,
then `npm run build` and a republish (below), then a docs refresh: this file,
`README.md`, `package.json` and the copy in `index.html` (menu subtitle, meta
description) brought in line with what the game now does.

## Commands

```bash
npm install
npm run dev     # http://localhost:8000 - must be served, ES modules don't load over file://
npm run build   # -> dist/artifact.html, the single-file copy for claude.ai only
npm test        # unit tests (node:test): RNG, rules engine, scorers, handfuls, die shapes, profile
npm run verify  # the browser checks below, in headless Chromium (needs npm run dev)
node tools/phase0/verify.mjs chromium "second wind"   # only the checks whose label contains that
# http://localhost:8000/?dev adds a Test bench to the menu: any dice set, then any Spice it allows (D39); ?dev&seed=N replays a match it logged
npm run phase0  # physics checks: every die settles flat, tunnelling, handfuls, tables Spice change, determinism (needs npm run dev)
node tools/phase0/check-multiplayer.mjs [label]   # only the multiplayer checks (also run by verify)
# http://localhost:8000/?net=local plays a friend between two tabs of one browser, no PeerJS server needed
```

Browser checks run in Chromium only until after the MVP (docs/decisions.md, D14).

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

- **`src/die-shapes.js` — the decal orientation basis must be right-handed.**
  `right = up × normal`, not `normal × up`. The latter is a mirror, and a
  quaternion cannot represent a reflection, so `setFromRotationMatrix` silently
  yields a wrong orientation for every face: numbers come out at odd angles or
  vanish entirely (a decal facing away is backface-culled). Symptom when broken:
  the best camera-facing decal has a *negative* dot with the view direction,
  which is geometrically impossible on a correct die.
- **`src/die-shapes.js` — a centred decal must stay under `inradius * √2`.**
  Each die type sets its own multiple (`decalSize` in `d6.js` … `d20.js`):
  1.0 on the d20, 1.3 on the d6. Larger than √2 and a corner of the square
  decal can cross its face's edge and bleed onto the neighbouring face. The
  inradius is measured per face, from its centroid, so it holds for the d10's
  kites too. `test/dice.test.js` checks every decal's corners lie inside its
  face, for every die type.
- **`src/d4.js` — the d4 has its own decal bound.** Its numbers sit at the
  corners, three per face, each pointing at its corner, so the √2 rule doesn't
  apply. Halfway to the corner (`decalOffset` 0.5), a square more than 0.73×
  the inradius either crosses the face's edge or overlaps its neighbours on the
  face (0.68 is used). The numeral fills its decal (`numeralFill`) instead,
  since the faces slope steeply away from the camera. `test/dice.test.js`
  checks both inside-the-face and no-overlap.
- **`src/d4.js` — the d4 is read from the face it lies on (`reads: 'down'`).**
  Each face's number is that of the corner it *doesn't* touch, which is the one
  pointing up. Its rest pose lies on its highest-numbered face, not under it.
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
  as the throw ended - and **towards each wall separately**: a d4 against a
  wall on a face reaches a third as far towards it as its corner reaches the
  other way, and taking the larger for both teleported it half a die inwards,
  into its neighbours.
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
  - **A held die is speed-limited relative to the palm**
    (`HOLD_MAX_DIE_SPEED`). Those stiff contacts fired d8s, whose sides
    slope like ramps, out of the bowl at 10-16 units/s when they wedged
    into each other: 4d8 (Divine Smite plus Underdog's extra die) lost a
    die in 6% of holds. Only where the dice are at release comes from the
    hold, so this never touches a throw.
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
  **Or dead still for half a second (`STILL_SPEED`, `STILL_TIME`):** a d12
  cocked against a wall can sit perfectly still with one floor corner held
  1–2 cm up, and waited out the 4 s timeout (1 throw in 700). Don't fix that
  by raising the floor's 1 cm `TOUCHING` to 3 cm: measured, that froze d20s
  that were still slowly toppling flat off a wall (`check-dice.mjs`'s cocked
  count rose). A cocked die is read as it lies (docs/decisions.md D24).
- **`src/rules/engine.js` — a side's hand for the round (`handOf`) depends on
  the match state only.** Underdog and Inspiration give a side an extra die
  for a round. The game asks `handOf` before the round, to put that die on the
  table (`table.setHand`), and the engine asks again after it, to score the
  faces; if a Spice's `hand` hook read anything else, the two could disagree
  and `playRound` throws on a dice count that doesn't match.
- **`src/rules/` — a Spice's random draws for each side go player first**
  (Exploding Dice, Brutal Critical). So in multiplayer both clients must
  evaluate the engine from the same seat, the host as `player`, and the guest
  mirror the result for display (docs/decisions.md D27), not each from its own side.
- **`src/rules/` — the rules engine stays pure.** No DOM, physics, clock or
  `Math.random()`: a round's outcome is a function of the match config, the
  match state and both sides' faces, and nothing else. Multiplayer depends on
  both clients computing it themselves and agreeing (docs/spec.md R4.4).
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
  added there; `npm run verify` checks nothing is missing (docs/decisions.md, D18).
- **`src/physics.js` — a floor with holes (Pothole) is a triangle mesh,
  without `FIX_INTERNAL_EDGES`, and only when there are holes.** With that
  flag a die spinning where triangles meet took 3 s or more to stop, and
  Fireball timed out 1 throw in 6; without it dice settle as on the slab.
  Every table without holes keeps the slab, so recorded throws replay
  unchanged. Against the mesh Rapier gives **no solver contacts**, so
  `restsOnFace` reads its raw contacts instead (for the mesh only): without
  that no die ever counted as resting on a face there. A die whose centre
  drops below the table is down a hole, and **not waited for**: a heap of
  dice in a pit shuffles about for seconds. `check-table.mjs` guards all of
  it.
- **`src/physics.js`, `src/rules/spice.js` — numbers that go into a throw
  record are never from `Math.cos`/`sin`.** A hole's 32 corners and the
  breeze's eight directions are written out as literals: those functions'
  last bit may differ between JavaScript engines, and the record must replay
  bit-identically everywhere (`table-throws.json` checks it).
- **`src/physics.js` — the breeze (Gusty Table) is a gust, and only pushes
  dice that are moving.** Pushed on into a wall, a die jittered against it
  and never settled; and a d12 rocking in a corner was nudged back into it
  for as long as the wind blew. So below the settle speed a die gets no push,
  and the gust fades out between 1.5 s and 2.5 s.
- **`src/game.js` — a re-throw (Second Wind, Mercy) replays the round from
  the state it started in.** The engine is pure, so undoing a round is
  going back to that state (`spendRethrow`) and calling `playRound` again
  with the new faces; nothing is "un-applied". Every await in a round checks
  `matchId`, so a round still waiting on a throw, a pause or a paw stops
  when the player leaves the match.
- **`src/game.js` (`showOnTable`) — a die popped out by an explosion is
  turned onto itself to show its roll; it isn't thrown to it.** The rules
  draw the extra rolls (D28); the pop's tumble is simulated (`replayThrow`)
  with every other die *fixed* in the record, then its die is drawn turned by
  a symmetry of its shape (`turnShowing` in `die-shapes.js`) so the face it
  lands on shows the drawn roll, then the same record plays on screen. Same
  outline, so it looks right. Don't let pops push the dice the rules read
  (their faces could change after scoring), and don't put pops in a round's
  records: they're for show.
- **`src/physics.js` — with a rope down (Tug of War), a die rocking in
  place has settled (`rocking`).** Propped on one corner against the rope,
  a die swings between the two indefinitely, its speed over `SETTLE_SPEED`
  every swing; Fireball timed out 1 throw in 6. Within `ROCK_MOVE` and 3°
  of one pose for `STILL_TIME` counts as settled. Measured, none of these
  helped: more rope friction, a box-section rope, a lower rope, no bounce,
  extra damping by the rope (worse), more solver iterations, no CCD. It's
  only for records with a rope, so every other recorded throw is unchanged.
- **`src/physics.js` — a die Rapier says is asleep but that has sunk over
  a centimetre is woken (`ASLEEP_DRIFT_SQ`).** Rapier occasionally keeps
  moving a sleeping die with no contact holding it up: a d4 fell 2.7 cm
  into the floor. Asleep dice also routinely dip 3.5 mm, once; waking
  those too would change half the recorded table throws, so the threshold
  sits above that. And only when Rapier still calls it asleep: calling
  `wakeUp()` on a die it had already woken changed recorded throws.
- **`src/game.js` (`redraw`) — a redraw (Draw Poker) holds the kept dice
  where they lie, `fixed` in the record, and lifts the thrown handful clear
  of them, all together (`liftClear` in `handful.js`).** Fixed, so nothing
  thrown onto them can turn them over after they were read; lifted, or a
  release over one starts inside it. A die picked out and *fumbled* goes
  straight back where it lay rather than dropping: a drop could turn it
  over, and the player may still keep it.
- **`src/physics.js` — with a die held fixed, a die near one pose has
  settled (`HELD_ROCK_MOVE`, 5 cm and 6°).** Propped between a held die and
  a wall, a die jitters or creeps down the held one a few cm a second,
  neither resting on a face nor still: 1 redraw in 36 timed out. The rope's
  2 cm made no difference, nor did more friction on held dice. Only for
  records with a fixed die, so every recorded throw replays unchanged.
- **`src/table.js` (`removeDice`) — dice burnt out (Burnout) go by index,
  and the rest are numbered afresh.** The rules only count how many a side
  has left, so `setHand` would take dice off the end, leaving the one that
  showed the 1 on the table. Ids must stay `player-0` onwards, in order:
  throw records and the rules read faces by position.
- **`src/handful.js` — No Man's Land's aimed throw is gentle and flat
  (`AIM_SPEED`, no extra lift).** Harder, or lobbed, eight dice a side
  landed on each other's and heaped up, and 1 throw in 20 waited out the
  timeout.
- **`src/dice.js` — dice start each match *placed* flat on a face, never
  dropped.** Dropped from rest in the default orientation, a d20 lands exactly
  on a level edge and, the simulation being deterministic, stays balanced
  there; the opening settle then waited out the 4 s timeout, and the die
  couldn't be picked up in that time.
- **Nothing tappable may sit where a die can come to rest** (docs/history.md
  4.6a). A control over a resting die steals the tap meant to pick it up. So
  the back button and the match's Dice/Spice label sit in the top corners,
  outside the tray as drawn on every screen shape, and `npm run verify`
  measures each against the nearest resting spot. The label is two lines at
  most, each cut short with an ellipsis rather than wrapping: on 390×844 it
  is ~40 px clear, but wrapped to three or four lines (as it was with the
  dice notation in it) it came within ~11 px, and longer names would cover a die.
  The re-throw button (Second Wind, Mercy) is the exception: it sits right
  under the result card (D41), so it's placed clear of every die on the
  table (`placeRethrow` in `hud.js`, from `table.onScreen`), falling back
  to bottom-right, below the tray's near wall. Its label is short ("Throw
  again"): its full name wrapped to three lines on a phone. Anything else on
  the board (the announcement pill, edge badges, hearts, the bars of Hit
  Points and the like) takes no pointer events. Six hearts go two rows of
  three on a phone, to stay clear of both corners, and a bar is no wider
  than the gap between the corners (~130 px on 390×844).
- **`styles.css` — `#result` stays `pointer-events: none` except when it's the
  match-over card.** It sits dead centre, which is where the die rests against
  the divider (and, with No Man's Land's divider gone, anywhere in the
  middle); if it took pointer events, the tap that should pick up the die
  would dismiss the card instead. Board taps dismiss it (see `input.js`).
- **`src/profile.js`, `src/game.js` — a player's colours never reach the
  rules or a throw record** (docs/spec.md R6.10). The opponent's are drawn
  from a stream of their own (`deriveSeed(seed, 'looks')`), so adding them
  moved no other stream and every recorded throw replays unchanged.
- **`styles.css` — the cards are measured against real dice, not spheres.**
  The top card sits level with the corner controls; a d20 resting against
  the far wall comes within ~9 px of it on desktop. `npm run verify` tries
  each die against the wall turned twelve ways, by its actual corners: a
  sphere round it overstates its reach by 30 px and more, and failed cards
  that were clear. A taller card (a bigger name, more padding) needs that
  check to pass.
- **`styles.css` — `.hearts.many:not([hidden])`.** Marathon's two rows of
  hearts on a phone are a grid, and `display:grid` beat `.hearts[hidden]`,
  so a bar in the next match sat under an empty block of hearts and the card
  grew 50 px, over the dice at the far wall.
- **`src/seat.js` — the guest sees the match through `guestSeat`, which
  swaps every `{ player, opponent }` pair and every 'player'/'opponent'
  string in and out of the engine.** So a Spice's state must keep anything
  per side under such a pair, never in an array or under other names, or
  the guest's screen gets the two sides crossed. `test/seat.test.js` plays
  every Spice with every dice set it allows from both seats and catches it.
- **`src/game.js` — a multiplayer throw record goes through JSON
  (`sealed`) before the thrower simulates it.** Turning a pose round makes
  -0s, which JSON sends as 0: simulated unsealed, the thrower would run
  different bits from the other client.
- **`src/game.js` — each seat's spin jitter has its own stream
  (`throw-host`, `throw-guest`).** From the match's one `throw` stream,
  two players making the same drag threw exactly the same throw (the
  multiplayer check tied every round until this).
- **`src/game.js` — in multiplayer only the late player's own client
  calls their time up (`stepClock`)** and logs it as their input, so a
  throw sent at the last moment is never both made and too late. The waiting
  side only decides when the link itself is lost (D49).
- **`src/net/session.js` (`attach`) — a new link is made current before the
  old one is closed.** The other way round, the old link's close handler
  still took itself for the current one and marked the session lost the
  moment a reloaded player came back.
- **`src/net/lobby.js` — No Man's Land isn't offered in multiplayer**
  (D48): it needs both handfuls in one simulation, and throws there are
  independent.
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

`npm run verify` (`tools/phase0/verify.mjs`) is that habit scripted. It plays
the game in headless Chromium, on desktop and 390×844, and reports each check
by label; `node tools/phase0/verify.mjs chromium "<label>"` runs only those
whose label contains it. Run it after any change to dice, camera, input,
physics or match flow. Broadly, it checks that every die type shows its
numerals and the game reads the face that's on top; that throws, grabs and
fumbles behave (a micro-nudge refused, a first tap grabbing even under the
result card, a falling die caught); that every die stays reachable on a
phone and stays put at rest; that nothing tappable sits over a resting die;
that matches run to the end under each win condition and the same seed
replays the same; and that each Spice, the draft, Zen, the test bench and
the player cards do what their rules and requirements say. And two players:
two pages linked by the local transport play whole matches with every
interactive Spice, and the two screens must agree on every round; a stalled
throw, leaving, a dropped player and a reload mid-match each end, or carry
on, as D48 and D49 say. A new feature
lands with its own check there, and the script, not this file, is the list.

Run `npm test` alongside; it needs no server.

After a change to physics, also run `npm run phase0`. If throw outcomes change
on purpose (tuning, colliders), re-record the determinism fixtures with
`node tools/phase0/record-throws.mjs`, and those onto the tables Spice change
(holes, a breeze, no divider, a cat's knock, a rope) with `node
tools/phase0/record-throws.mjs --table` (both need `npm run dev`).
