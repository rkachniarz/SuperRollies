// Match flow: starting a match, throwing, and handing each round's dice to the
// rules engine (rules/engine.js), which decides what they mean. This file only
// turns that into dice on the table and words on the screen.
//
// Quick Game: a two-step draft - two dice sets to pick from, then two Spice
// that suit them (rules/draft.js) - then both sides throw their handful each
// round and the rules, bent by the Spice, decide who wins it and what it
// costs, until the win condition says the match is over.
//
// A round, in full: both sides throw; a Spice may then act on the settled
// dice (Cat Paw's swipe), let each side throw some of its dice again (Draw
// Poker), or have a side throw again (Doubles Again); the rules play the
// round out; and its loser may get to throw again and have it played out
// once more (Second Wind, Mercy). The rules say what happens at
// each step and the table carries it out, so every throw, paw and breeze is
// in a throw record and replays exactly.
//
// Zen: no opponent, no divider, no score - the whole tray, for throwing for
// the sake of it. It's also the testbed: its catalogue offers every dice set
// Quick Game does, and every die type on its own (DEV_PLAN.md D18).

import { GAME_OVER_LINGER_MS } from './config.js';
import { randomHandful, aimHandful, handLayout, liftClear } from './handful.js';
import { DIE_TYPES } from './die-shapes.js';
import { createRng, deriveSeed, randomSeed } from './rng.js';
import { replayThrow } from './replay.js';
import { SHAPES } from './die-shapes.js';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, handOf, edgeOf, scoreDice,
  tableOf, afterSettle, throwsAgain, canRethrow, spendRethrow, redrawsOf,
} from './rules/engine.js';
import { DICE_SETS, THE_CLASSIC, dieTypes, sum } from './rules/dice-sets.js';
import { SPICE } from './rules/spice.js';
import { dealDice, dealSpice, testBenchSpice } from './rules/draft.js';
import { diceSetCard, dieCard, spiceCard } from './cards.js';
import { checkProfile, looksOf, opponentProfile } from './profile.js';

// Zen's catalogue: every dice set, then each die type a set doesn't already
// throw on its own, so every die can be tried alone.
const ZEN_CARDS = [
  ...Object.values(DICE_SETS).map(diceSetCard),
  ...DIE_TYPES
    .filter((type) => !Object.values(DICE_SETS).some((set) => dieTypes(set).join() === type))
    .map(dieCard),
];

/** @type {('player' | 'opponent')[]} */
const SIDES = ['player', 'opponent'];
const other = (side) => (side === 'player' ? 'opponent' : 'player');

// How long the opponent seems to think before throwing again on its own (a
// re-throw, doubles), so the player sees why the dice are moving.
const OPPONENT_BEAT_MS = 1100;

// After a die explodes, how long before what it popped out explodes in turn.
const POP_BEAT_MS = 250;

// How long a die that burns out (Burnout) shows its 1 before it goes.
const BURN_BEAT_MS = 600;

// Zen's table: nothing on it but the dice.
const PLAIN_TABLE = { holes: [], wind: null, divider: false, rope: null };

// The dice the player editor shows off its colours on: where in the far half
// (a share of its depth), how far apart, and how fast they turn (radians/s).
const PREVIEW_DICE = ['d20', 'd6'];
const PREVIEW_DEPTH = 0.55;
const PREVIEW_SPACING = 1.7;
const PREVIEW_SPIN = 0.5;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createGame({ hud, roller, arena, table, effects, profiles }) {
  let state = 'menu'; // 'menu' | 'playing' | 'deciding' | 'ended'
  let mode = 'quick'; // 'quick' | 'zen'
  let rolling = false;
  // This match's rounds, newest last: each one's throw records and results,
  // and its outcome. Kept so any throw can be replayed exactly (see
  // replay.js); the test tools read it from the page. Emptied, not replaced,
  // for each new match, so a reference to it stays good.
  const rounds = [];
  // Bumped whenever a match starts or is left, so a round still under way in
  // the one before (awaiting a throw, a pause) knows to stop.
  let matchId = 0;

  // The match being played: its config, the rules it names, and where it
  // stands. Zen has a config too (for its seed) but no rules state.
  let config;
  let rules;
  let match;
  // What the Spice announced for the round about to be thrown, if anything,
  // and the table it's thrown on (holes, a breeze, the divider).
  let announced;
  let tableNow = PLAIN_TABLE;
  // Who's playing this match: each side's profile (profile.js). Zen has no
  // opponent.
  let players = null;
  // Separate random streams for the AI's throws and for the spin jitter on the
  // player's, so neither can shift the other or the rules' own stream.
  let opponentRng;
  let throwRng;
  // The seed the draft on screen is dealing from.
  let draftSeed;
  // A throw the round is waiting on from the player (doubles, a re-throw):
  // what their next throw resolves.
  let awaiting = null;
  // The re-throw on offer to the player, while it is: the round to play out
  // again (see commit). While it's being played out again, `replaying`.
  let offer = null;
  let replaying = false;
  // The test bench's dice and Spice, while it's a bench match: the next
  // match is played on them too.
  let bench = null;
  // While the player picks dice out to throw again (Draw Poker): which,
  // by index, and what keeping them all resolves.
  let picking = null;
  // The dice the player has picked up, and where they lay before, while
  // they're in the hand.
  let holding = null;

  function newMatch(seed, diceSet, spice) {
    config = matchConfig({ seed, diceSet, spice });
    rules = resolveRules(config);
    match = startMatch(rules);
    opponentRng = createRng(deriveSeed(seed, 'opponent'));
    throwRng = createRng(deriveSeed(seed, 'throw'));
  }
  newMatch(0);

  /** A throw record of `dice` on the table as it is this round. */
  function recordOf(dice) {
    const { holes, wind, rope } = tableNow;
    return {
      v: 1,
      arenaHalfWidth: arena.arenaHalfWidth,
      divider: arena.divider,
      tray: arena.tray,
      ...(holes.length ? { holes } : {}),
      ...(wind ? { wind } : {}),
      ...(rope ? { rope: true } : {}),
      dice,
    };
  }

  /** A throw record from each side's releases (each in its dice's order). */
  function recordFor(releases) {
    return recordOf(Object.entries(releases).flatMap(([side, list]) => list.map((release, i) => {
      const die = table.sides[side][i];
      return { id: die.id, type: die.type, s: die.scale, ...release };
    })));
  }

  /** One side's dice from a finished throw, in its dice's order. */
  const diceOf = (result, side) => result.dice.filter((d) => d.id.startsWith(side + '-'));
  const facesOf = (result, side) => diceOf(result, side).map((d) => d.face);

  /** Throws `releases` (by side) and resolves with the record and result, once settled. */
  async function roll(releases) {
    table.tidy();
    const record = recordFor(releases);
    return { record, result: await roller.start(record) };
  }

  /**
   * The opponent's handful, thrown at random from its own half. With no
   * divider (No Man's Land), it's thrown at `aim` ([x, z]), where the
   * player's dice are let go, so the two handfuls collide.
   */
  function opponentReleases(aim) {
    const { offsets, reach } = table.hands.opponent;
    const rand = () => opponentRng.next();
    const releases = randomHandful(arena.opponentZone(reach), offsets, rand);
    return aim && !tableNow.divider ? aimHandful(releases, aim, rand) : releases;
  }

  /** The middle of a handful's releases, [x, z]. */
  const centreOf = (releases) => [0, 2].map((k) => releases.reduce((s, r) => s + r.p[k], 0) / releases.length);

  /** Resolves with the player's releases when they next throw, prompted by `headline`. */
  function playerThrow(headline, detail) {
    rolling = false;
    hud.showResult(headline, detail);
    return new Promise((resolve) => { awaiting = resolve; });
  }

  // How Zen totals a throw: the dice set's scorer, or for one die alone, its face.
  let zenScorer = sum;

  /**
   * Starts a match. Both modes play `diceSet` (an id), Quick Game with
   * `spice`; Zen can instead throw one die of `dieType`. `seed` is for tests:
   * the same seed plays the same match.
   */
  function start(newMode, { seed = randomSeed(), diceSet = THE_CLASSIC.id, spice, dieType } = {}) {
    mode = newMode;
    bench = null;
    leaveRound();
    newMatch(seed, diceSet, spice);
    rounds.length = 0;
    const zen = mode === 'zen';
    const alone = zen && dieType;
    const types = alone ? [dieType] : dieTypes(rules.diceSet);
    zenScorer = alone ? sum : rules.diceSet.scorer;
    tableNow = zen ? PLAIN_TABLE : tableOf(rules, match);
    // The AI's looks come from a stream of their own, so a replayed match
    // looks the same and no other stream moves (R6.6).
    const you = profiles.get();
    players = { player: you, opponent: zen ? null : opponentProfile(createRng(deriveSeed(seed, 'looks')), you) };
    const looks = { player: looksOf(you), opponent: looksOf(players.opponent ?? you) };
    table.setup({
      types,
      scale: alone ? 1 : rules.diceSet.dieScale,
      tray: alone ? THE_CLASSIC.tray : rules.diceSet.tray,
      opponent: !zen,
      divider: !zen && tableNow.divider,
      holes: tableNow.holes,
      rope: Boolean(tableNow.rope),
      dice: { player: looks.player.dice, opponent: looks.opponent.dice },
      trays: { player: looks.player.tray, opponent: looks.opponent.tray },
    });
    showTable();
    hud.showBoard(mode);
    hud.showPlayers({ player: looks.player, opponent: zen ? null : looks.opponent });
    hud.showMatchInfo(diceSetCard(rules.diceSet), zen ? null : spiceCard(rules.spice));
    if (mode === 'quick') {
      hud.showMatch(rules.winCondition.view(match.win));
      prepareRound();
    }
    state = 'playing';
    hud.showResult(table.sides.player.length > 1 ? 'Pick up your dice and throw them' : 'Pick up your die and throw it',
      announced ?? '');
  }

  // Readies the coming round: lets the Spice set it up (and say so), puts each
  // side's dice for it on the table (Underdog's extra die, Inspiration's
  // advantage), and marks who holds an edge in it.
  function prepareRound() {
    let announce;
    ({ state: match, announce } = beginRound(rules, match));
    announced = announce;
    tableNow = tableOf(rules, match);
    showTable();
    for (const side of SIDES) table.setHand(side, handOf(rules, match, side).types);
    hud.showAnnounce(announce);
    showEdges();
  }

  // What's drawn on the table this round but never simulated: the breeze's
  // streaks, the flag on the rope.
  function showTable() {
    effects.setWind(tableNow.wind);
    effects.setFlag(tableNow.rope ? tableNow.rope.pull : null);
  }

  // Marks who holds an edge this round (R3.5); while the player is offered a
  // re-throw, its button says so for them.
  function showEdges() {
    const edges = [edgeOf(rules, match)].flat().filter((e) => e && !(offer && e.side === 'player'));
    hud.showEdge(edges.length ? edges : null);
  }

  /**
   * The Quick Game draft (R1.1-R1.3): two dice sets, then two Spice eligible
   * for the one picked, both dealt from the match's seed (R1.6), then the
   * match. `seed` is for tests.
   */
  function openDraft(seed = randomSeed()) {
    draftSeed = seed;
    const pickDice = () => hud.showDraft({
      step: 'Step 1 of 2',
      title: 'Choose your dice',
      cards: dealDice(seed).map((id) => diceSetCard(DICE_SETS[id])),
      onPick: pickSpice,
      onBack: () => hud.showMenu(),
    });
    const pickSpice = (diceSet) => hud.showDraft({
      step: 'Step 2 of 2',
      title: 'Choose your Spice',
      chosen: `${DICE_SETS[diceSet].name} · ${DICE_SETS[diceSet].notation}`,
      cards: dealSpice(seed, diceSet).map((id) => spiceCard(SPICE[id])),
      onPick: (spice) => start('quick', { seed, diceSet, spice }),
      onBack: pickDice,
    });
    pickDice();
  }

  /**
   * The test bench, for development only (behind ?dev, DEV_PLAN.md D39): a
   * Quick Game without the draft's luck. Every dice set, then every Spice that
   * set allows, those made for it first (testBenchSpice in rules/draft.js).
   * The match's seed is logged, and `?seed=` in the address replays it.
   * Once a match is over, another starts on the same dice and Spice, from a
   * new seed.
   */
  function openTestBench() {
    const startBench = (diceSet, spice) => {
      const given = new URLSearchParams(window.location.search).get('seed');
      benchMatch(diceSet, spice, given === null ? randomSeed() : Number(given));
    };
    const pickDice = () => hud.showPicker('Test bench: choose your dice',
      Object.values(DICE_SETS).map(diceSetCard), pickSpice);
    const pickSpice = (diceSet) => hud.showPicker(`Test bench: Spice for ${DICE_SETS[diceSet].name}`,
      testBenchSpice(diceSet).map(spiceCard), (spice) => startBench(diceSet, spice), pickDice);
    pickDice();
  }

  /** A test bench match of `diceSet` with `spice`, from `seed`, logged. */
  function benchMatch(diceSet, spice, seed = randomSeed()) {
    console.info(`Test bench: ${diceSet} with ${spice}, seed ${seed} (replay with ?dev&seed=${seed})`);
    start('quick', { seed, diceSet, spice });
    bench = { diceSet, spice };
  }

  // Abandons whatever round is under way: the throw in flight, a paw, a
  // throw or a decision waited on. The next match resets the table.
  function leaveRound() {
    matchId++;
    roller.cancel();
    effects.clear();
    table.tidy();
    rolling = false;
    awaiting = null;
    offer = null;
    replaying = false;
    endPicking();
    holding = null;
    for (const die of [...table.sides.player, ...table.sides.opponent]) die.highlight(false);
    hud.showRethrow(null);
  }

  function returnToMenu() {
    leaveRound();
    state = 'menu';
    hud.showMenu();
  }

  // ---------- The player editor (R6.8) ----------
  // The table shows through behind it: a few dice in the colours picked, on
  // the tray picked, turning slowly in the far half (clear of the editor on a
  // phone, where it sits at the bottom).
  let editing = false;
  let previewLook = null;
  let previewTurn = 0;

  function openEditor() {
    leaveRound();
    state = 'menu';
    editing = true;
    previewLook = null;
    hud.showEditor(profiles.get(), {
      onChange: showLook,
      onSave(profile) {
        profiles.save(profile);
        closeEditor();
      },
      onBack: closeEditor,
    });
  }

  function closeEditor() {
    editing = false;
    hud.showMenuPlayer(looksOf(profiles.get()));
    hud.showMenu();
  }

  // Lays the preview out for `profile`'s colours; only when they change, not
  // for every letter of a name typed.
  function showLook(profile) {
    const looks = looksOf(checkProfile(profile));
    const key = `${looks.tray}|${looks.dice.id}`;
    if (key === previewLook) return;
    previewLook = key;
    const { tray } = THE_CLASSIC;
    table.setup({
      types: PREVIEW_DICE, scale: 1, tray, opponent: false,
      dice: { player: looks.dice, opponent: looks.dice },
      trays: { player: looks.tray, opponent: looks.tray },
    });
    table.sides.player.forEach((die, i) => {
      die.placeAt((i - (PREVIEW_DICE.length - 1) / 2) * PREVIEW_SPACING, -tray.depth * PREVIEW_DEPTH, previewTurn + i * 2);
    });
  }

  /** Turns the editor's dice a little: called every frame. */
  function frame(dt) {
    if (!editing) return;
    previewTurn += dt * PREVIEW_SPIN;
    table.sides.player.forEach((die, i) => die.placeAt(die.mesh.position.x, die.mesh.position.z, previewTurn + i * 2));
  }

  async function runZenThrow(playerReleases) {
    const record = recordFor({ player: playerReleases });
    const result = await roller.start(record);
    rounds.push({ record, result, throws: [{ record, result }] });
    const faces = facesOf(result, 'player');
    const { dice, score, named } = scoreDice(zenScorer, faces);
    // The total up top (or what it's called: a poker hand); with several
    // dice, how it was made up below.
    if (faces.length === 1) hud.showResult(`You rolled ${score}`, '');
    else hud.showRound(`You rolled ${named ?? score}`, [{ side: 'player', dice, score, named }]);
    rolling = false;
  }

  /**
   * A cat's paw swipes at the dice `swipes` names (Cat Paw), where they lie
   * after `last`: each is knocked in from the side wall nearer it, towards
   * the middle, and every die on the table is simulated again until it
   * settles. Only arithmetic in the knock, so it's the same on any machine.
   */
  async function catPaw(last, swipes) {
    const lying = Object.fromEntries(last.result.dice.map((d) => [d.id, d]));
    const knocks = new Map();
    const targets = swipes.map(({ side, index, power, turn }) => {
      const die = table.sides[side][index];
      const [x, y, z] = lying[die.id].p;
      const from = x >= 0 ? 1 : -1;
      const v = [-from * (2.5 + 3 * power), 1 + 1.5 * power, turn * (1 + power)];
      knocks.set(die.id, { v, w: [v[2] * 3, turn * 4, -v[0] * 3] });
      const length = Math.hypot(1, turn * (1 + power) / (2.5 + 3 * power));
      return { x, y, z, from, dir: [-from / length, (turn * (1 + power) / (2.5 + 3 * power)) / length], reach: die.radius + 0.3 };
    });
    await effects.swipe(targets);
    const record = recordOf(last.record.dice.map(({ id, type, s }) => ({
      id, type, s, p: lying[id].p, q: lying[id].q, ...(knocks.get(id) ?? { v: [0, 0, 0], w: [0, 0, 0] }),
    })));
    return { record, result: await roller.start(record), swipes };
  }

  async function runRound(playerReleases) {
    const id = matchId;
    const throws = [await roll({ opponent: opponentReleases(centreOf(playerReleases)), player: playerReleases })];
    if (id !== matchId) return;

    // Anything the Spice does to the dice where they've settled.
    let swipes;
    const counts = { player: table.sides.player.length, opponent: table.sides.opponent.length };
    ({ state: match, swipes } = afterSettle(rules, match, counts));
    if (swipes.length) {
      throws.push(await catPaw(throws.at(-1), swipes));
      if (id !== matchId) return;
    }
    const { result } = throws.at(-1);
    const round = {
      faces: { player: facesOf(result, 'player'), opponent: facesOf(result, 'opponent') },
      fallen: {
        player: diceOf(result, 'player').map((d) => d.fallen),
        opponent: diceOf(result, 'opponent').map((d) => d.fallen),
      },
      again: { player: [], opponent: [] },
    };

    // Draw Poker: each side may throw some of its dice again.
    for (let n = redrawsOf(rules); n > 0; n--) {
      if (!await redraw(round, throws, id)) return;
    }

    // Doubles: whoever threw them throws again, both together if both did.
    for (;;) {
      const sides = SIDES.filter((side) => throwsAgain(rules, match, side, [round.faces[side], ...round.again[side]]));
      if (!sides.length) break;
      const releases = {};
      if (sides.includes('opponent')) releases.opponent = opponentReleases();
      if (sides.includes('player')) {
        releases.player = await playerThrow('Doubles! Throw again',
          sides.includes('opponent') ? 'So did your opponent. Both throws are added on.' : 'Your next throw is added to your total.');
      } else {
        hud.showResult('Your opponent threw doubles', 'They throw again, and add it on.');
        await pause(OPPONENT_BEAT_MS);
      }
      if (id !== matchId) return;
      hud.hideResult();
      rolling = true;
      const next = await roll(releases);
      if (id !== matchId) return;
      throws.push(next);
      for (const side of sides) round.again[side].push(facesOf(next.result, side));
    }

    await playOut(match, round, throws, id);
  }

  /**
   * A redraw (Draw Poker): each side may throw any of its dice again, once,
   * the rest held where they lie. The opponent keeps what its scorer says is
   * worth keeping (a poker hand's pairs and the like), and its dice to throw
   * glow; the player picks theirs out by tapping them, then throws them, or
   * keeps them all. Both throw together. The new faces replace the old in
   * `round`. Resolves false if the match was left meanwhile.
   */
  async function redraw(round, throws, id) {
    const scored = Object.fromEntries(SIDES.map((side) =>
      [side, scoreDice(handOf(rules, match, side).scorer, round.faces[side])]));
    const { scorer } = handOf(rules, match, 'opponent');
    const keep = scorer.hold?.(round.faces.opponent) ?? scored.opponent.kept;
    const theirs = keep.flatMap((kept, i) => (kept ? [] : [i]));
    for (const i of theirs) table.sides.opponent[i].highlight(true);
    const they = theirs.length
      ? `Your opponent throws ${theirs.length === 1 ? 'one die' : `${theirs.length} dice`} again.`
      : 'Your opponent keeps its dice.';

    const hand = (side) => ({ side, dice: scored[side].dice, score: scored[side].score, named: scored[side].named });
    rolling = false;
    hud.showRound('Throw any again?', [hand('player'), hand('opponent')],
      { notes: [they, 'Tap the dice you want to throw again, then throw them. Or keep them all.'] });
    hud.showRethrow({ label: '✋ Keep them', title: 'Keep all your dice as they are' }, table.onScreen);
    const mine = await new Promise((resolve) => {
      picking = { chosen: new Set(), keep: () => resolve(null) };
      awaiting = (releases, dice) => resolve({ releases, dice });
    });
    endPicking();
    if (id !== matchId) return false;
    // Whatever was picked, the round goes on without the player now.
    rolling = true;

    /** @type {Map<string, object>} the releases of the dice thrown, by id */
    const thrown = new Map();
    mine?.dice.forEach((die, i) => thrown.set(die.id, mine.releases[i]));
    if (theirs.length) {
      const dice = theirs.map((i) => table.sides.opponent[i]);
      const { offsets, reach } = handLayout(dice.length, Math.max(...dice.map((d) => d.radius)));
      randomHandful(arena.opponentZone(reach), offsets, () => opponentRng.next())
        .forEach((release, i) => thrown.set(dice[i].id, release));
    }
    if (!thrown.size) return true;
    if (!mine) {
      hud.showResult('Your opponent throws again', they);
      await pause(OPPONENT_BEAT_MS);
      if (id !== matchId) return false;
      hud.hideResult();
    }
    for (const die of table.sides.opponent) die.highlight(false);
    const record = recordKeeping(thrown);
    const next = { record, result: await roller.start(record) };
    if (id !== matchId) return false;
    throws.push(next);
    const faces = Object.fromEntries(next.result.dice.map((d) => [d.id, d.face]));
    for (const side of SIDES) {
      table.sides[side].forEach((die, i) => { if (thrown.has(die.id)) round.faces[side][i] = faces[die.id]; });
    }
    return true;
  }

  /**
   * A throw record of every die on the table: those in `thrown` (by id) let
   * go as released, the rest held where they lie for them to bounce off
   * (Draw Poker's kept dice). A side's handful let go over a die lying there
   * is lifted clear of it, all together, so it never starts a throw inside
   * one and its own dice stay as far apart as they were.
   */
  function recordKeeping(thrown) {
    const all = [...table.sides.player, ...table.sides.opponent];
    const lying = all.filter((d) => !thrown.has(d.id)).map((d) => ({ p: d.mesh.position.toArray(), r: d.radius }));
    const released = new Map();
    for (const side of SIDES) {
      const dice = table.sides[side].filter((d) => thrown.has(d.id));
      liftClear(dice.map((d) => thrown.get(d.id)), dice.map((d) => d.radius), lying)
        .forEach((release, i) => released.set(dice[i].id, release));
    }
    return recordOf(all.map((die) => {
      const at = { id: die.id, type: die.type, s: die.scale };
      const release = released.get(die.id);
      if (release) return { ...at, ...release };
      return { ...at, p: die.mesh.position.toArray(), q: die.mesh.quaternion.toArray(), v: [0, 0, 0], w: [0, 0, 0], fixed: true };
    }));
  }

  /** Done picking dice out: none glow, and the button to keep them goes. */
  function endPicking() {
    if (!picking) return;
    picking = null;
    awaiting = null;
    for (const die of table.sides.player) die.highlight(false);
    hud.showRethrow(null);
  }

  /** The player taps die `index` while picking dice out: picked out, or put back. */
  function pick(index) {
    if (!picking || rolling) return;
    const { chosen } = picking;
    if (chosen.has(index)) chosen.delete(index);
    else chosen.add(index);
    table.sides.player[index].highlight(chosen.has(index));
  }

  /**
   * Plays the round out from `before` (the state it started in), shows it,
   * and if its loser can throw again (Second Wind, Mercy), lets them: the
   * opponent decides at once, the player is offered it (see commit).
   */
  async function playOut(before, round, throws, id) {
    for (;;) {
      const { outcome, state: after } = playRound(rules, before, round.faces, round);
      await showOnTable(outcome, id);
      if (id !== matchId) return;
      const loser = outcome.winner && other(outcome.winner);
      // The opponent calls on it when this loss would cost it the match.
      if (loser === 'opponent' && canRethrow(rules, before, loser) && outcome.matchWinner === 'player') {
        hud.showMatch(rules.winCondition.view(after.win));
        hud.showRound(ROUND_HEADLINES.player, breakdownOf(outcome),
          { notes: [...notesOf(outcome), `Your opponent calls on its ${rules.spice.name}!`] });
        await pause(OPPONENT_BEAT_MS);
        if (id !== matchId) return;
        before = spendRethrow(rules, before, 'opponent');
        hud.showMatch(rules.winCondition.view(before.win));
        hud.hideResult();
        const next = await roll({ opponent: opponentReleases() });
        if (id !== matchId) return;
        throws.push(next);
        round.faces.opponent = facesOf(next.result, 'opponent');
        round.fallen.opponent = diceOf(next.result, 'opponent').map((d) => d.fallen);
        continue;
      }
      commit(before, round, throws, outcome, after);
      return;
    }
  }

  /**
   * Shows on the table what the rules made of the dice where they lie: a
   * cursed die's number turned to a red 0, and each extra roll an exploded
   * die was given popping out of it as a die of its own, landing on that
   * roll. A pop that is itself a maximum pops out another, and so on. Only
   * for show, so nothing here is in the round's records: the rules decided
   * the round already, from the rules stream (R4.4).
   */
  async function showOnTable(outcome, id) {
    for (const side of SIDES) {
      outcome.dice[side].forEach((term, i) => {
        if (term.tag === 'cursed') table.sides[side][i].showCursed(outcome.faces[side][i]);
      });
    }
    // Dice lost for the rest of the match (Burnout) burn up where they lie,
    // a beat after landing so the 1s they show are seen.
    const burnt = SIDES.map((side) => [side, outcome.dice[side].flatMap((term, i) => (term.tag === 'burnt' ? [i] : []))]);
    if (burnt.some(([, list]) => list.length)) {
      await pause(BURN_BEAT_MS);
      if (id !== matchId) return;
      for (const [side, list] of burnt) {
        for (const i of list) effects.burst(table.sides[side][i].mesh.position.toArray(), table.sides[side][i].radius);
        table.removeDice(side, list);
      }
    }
    let popping = SIDES.flatMap((side) => outcome.dice[side].flatMap((term, i) =>
      (term.extra ? [{ side, from: table.sides[side][i], rolls: term.extra }] : [])));
    for (let n = 0; popping.length; n++) {
      // Everything already on the table stays put for the pops to bounce
      // off, so no die the rules have read is moved.
      const still = [...table.sides.player, ...table.sides.opponent, ...table.pops].map((d) => ({
        id: d.id, type: d.type, s: d.scale, p: d.mesh.position.toArray(), q: d.mesh.quaternion.toArray(),
        v: [0, 0, 0], w: [0, 0, 0], fixed: true,
      }));
      const popped = popping.map((source) => ({ source, ...table.popOut(source.side, source.from) }));
      const record = recordOf([...still, ...popped.map((p) => p.release)]);
      // Run it once first to see where each pop lands, then turn its die so
      // it lands on its roll; playing it on screen runs it exactly the same.
      const landed = Object.fromEntries(replayThrow(record).dice.map((d) => [d.id, d.face]));
      for (const { source, pop } of popped) {
        pop.face.mesh.quaternion.copy(SHAPES[pop.type].turnShowing(landed[pop.id], source.rolls[n]));
        effects.burst(source.from.mesh.position.toArray(), source.from.radius);
        effects.grow(pop.face.mesh);
      }
      await roller.start(record);
      if (id !== matchId) return;
      popping = popped.filter(({ source }) => source.rolls.length > n + 1)
        .map(({ source, pop }) => ({ ...source, from: pop }));
      if (popping.length) await pause(POP_BEAT_MS);
      if (id !== matchId) return;
    }
  }

  /**
   * The lines under a round's breakdown: what it cost, where the win
   * condition counts that in something to name (`You lose 8 HP.`), and what
   * the Spice says about it.
   */
  function notesOf(outcome) {
    const { unit } = rules.winCondition;
    const cost = unit && SIDES.filter((side) => outcome.damage[side] > 0).map((side) =>
      `${side === 'player' ? 'You lose' : 'Your opponent loses'} ${outcome.damage[side]} ${unit}.`).join(' ');
    // Two hands with the same name (a pair of 6s each) were decided by the
    // dice left over.
    const { named, winner } = outcome;
    const kicker = winner && named.player && named.player === named.opponent
      ? 'The same hand: the dice left over decide it.' : undefined;
    return [cost || undefined, kicker, outcome.note];
  }

  const breakdownOf = (outcome) => SIDES.map((side) => ({
    side,
    dice: outcome.dice[side],
    adjustments: outcome.adjustments[side],
    score: outcome.scores[side],
    named: outcome.named[side],
  }));

  /**
   * The round's outcome stands, unless the player takes up a re-throw: the
   * match moves on to `after`, and the next round is readied. If the player
   * lost and may throw again, it's offered until they pick their dice up
   * for the next round - or, if this round ended the match, until they tap
   * the table to accept that.
   */
  function commit(before, round, throws, outcome, after) {
    const entry = { record: throws[0].record, result: throws[0].result, throws, outcome };
    // A round played out again replaces the one it was.
    if (replaying) rounds[rounds.length - 1] = entry;
    else rounds.push(entry);
    replaying = false;
    match = after;
    hud.showMatch(rules.winCondition.view(after.win));
    const rethrow = outcome.winner === 'opponent' && canRethrow(rules, before, 'player');
    offer = rethrow ? { before, round, throws, outcome, announced } : null;
    const notes = notesOf(outcome);
    if (rethrow) notes.push(`Not happy? Use your ${rules.spice.name} to throw again.`);

    if (outcome.matchWinner && !rethrow) {
      endMatch(outcome);
      return;
    }
    if (outcome.matchWinner) {
      // The player may still turn it round: wait for their choice.
      state = 'deciding';
      hud.showAnnounce(undefined);
      hud.showEdge(null);
      hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdownOf(outcome),
        { notes: [...notesOf(outcome), `Use your ${rules.spice.name} to throw again, or tap the table to accept it.`] });
    } else {
      prepareRound();
      hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdownOf(outcome), { notes: [...notes, announced] });
    }
    hud.showRethrow(rethrow ? { label: `${rules.spice.icon} Throw again`, title: `${rules.spice.name}: throw your dice again` } : null, table.onScreen);
    rolling = false;
  }

  // Match over: announce it, then head back to the main menu after a beat (or
  // immediately if they tap the card). On the test bench, another match on
  // the same dice and Spice instead.
  function endMatch(outcome) {
    state = 'ended';
    offer = null;
    hud.showRethrow(null);
    hud.showAnnounce(undefined);
    hud.showEdge(null);
    const notes = notesOf(outcome);
    if (bench) notes.push('Test bench: the same again next.');
    hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdownOf(outcome), { gameOver: true, notes });
    rolling = false;
    const id = matchId;
    setTimeout(() => { if (state === 'ended' && id === matchId) afterMatch(); }, GAME_OVER_LINGER_MS);
  }

  // Once a match is over: back to the menu, or on the test bench, the same again.
  function afterMatch() {
    if (bench) benchMatch(bench.diceSet, bench.spice);
    else returnToMenu();
  }

  /**
   * The player takes up the re-throw on offer: the round goes back to where
   * it started, the re-throw spent, and is played out again with their new
   * throw.
   */
  async function useRethrow() {
    if (!offer || rolling || awaiting) return;
    const { round, throws, announced: then } = offer;
    const before = spendRethrow(rules, offer.before, 'player');
    const id = matchId;
    offer = null;
    replaying = true;
    hud.showRethrow(null);
    // Back as it was before the round: its hand, its announcement, its score.
    match = before;
    state = 'playing';
    announced = then;
    tableNow = tableOf(rules, match);
    showTable();
    for (const side of SIDES) table.setHand(side, handOf(rules, match, side).types);
    hud.showMatch(rules.winCondition.view(match.win));
    hud.showAnnounce(then);
    showEdges();
    const releases = await playerThrow(`${rules.spice.name}!`, 'Throw your dice again: this throw replaces the last.');
    if (id !== matchId) return;
    const next = await roll({ player: releases });
    if (id !== matchId) return;
    throws.push(next);
    round.faces.player = facesOf(next.result, 'player');
    round.fallen.player = diceOf(next.result, 'player').map((d) => d.fallen);
    await playOut(before, round, throws, id);
  }

  hud.onQuickGame(() => openDraft());
  hud.onZen(() => hud.showPicker('Zen: choose your dice', ZEN_CARDS,
    (id) => start('zen', id.startsWith('die:') ? { dieType: id.slice(4) } : { diceSet: id })));
  hud.onTestBench(openTestBench);
  hud.onEditPlayer(openEditor);
  hud.onBack(returnToMenu);
  hud.showMenuPlayer(looksOf(profiles.get()));
  // The button under the card: keep all your dice while picking (Draw
  // Poker), or a re-throw (Second Wind).
  hud.onRethrow(() => {
    if (picking && !rolling && !holding) picking.keep();
    else if (!picking) useRethrow();
  });

  // The match-over card is the one that takes pointer events, so tapping it
  // heads straight back to the menu instead of waiting out the timer.
  hud.onResultClick(() => {
    if (state === 'ended') afterMatch();
    else hud.hideResult();
  });

  return {
    get state() { return state; },
    get mode() { return mode; },
    get config() { return config; },
    get match() { return match; },
    get rules() { return rules; },
    /** This match's players: each side's profile; no opponent in Zen. */
    get players() { return players; },
    /** The seed the draft on screen deals from. */
    get draftSeed() { return draftSeed; },
    /**
     * What the round is waiting on from the player: a throw ('throw'), dice
     * picked out to throw again ('pick'), or nothing.
     */
    get awaiting() { return picking ? 'pick' : awaiting ? 'throw' : null; },
    /** Whether a re-throw is on offer to the player. */
    get offered() { return offer !== null; },
    rounds,
    start,
    openDraft,
    openEditor,
    frame,
    useRethrow,
    /** Spin jitter for the player's throws, from the match's seed. */
    random: () => throwRng.next(),
    // The dice can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    /** Whether the player is picking dice out to throw again (Draw Poker). */
    picking: () => picking !== null,
    onPick: pick,
    /** The dice a drag from die `index` picks up: all, or those picked out, that one too. */
    grabbed(index) {
      if (!picking) return table.sides.player;
      if (!picking.chosen.has(index)) pick(index);
      return table.sides.player.filter((_, i) => picking.chosen.has(i));
    },
    onGrab(dice) {
      holding = { dice, from: dice.map((d) => ({ p: d.mesh.position.clone(), q: d.mesh.quaternion.clone() })) };
      // Dice still dropping from a fumble are caught again mid-fall.
      roller.cancel();
      table.tidy();
      // Picking the dice up for the next round lets the last one stand.
      if (offer && !awaiting) {
        offer = null;
        hud.showRethrow(null);
        showEdges();
      }
      hud.showResult('Let go to throw', '');
    },
    onFumble(playerReleases, { cancelled = false } = {}) {
      const held = holding;
      holding = null;
      // Picked out to throw again, they go straight back where they lay: a
      // drop could turn one over, and they may yet be kept.
      if (picking) {
        held.dice.forEach((die, i) => { die.mesh.position.copy(held.from[i].p); die.mesh.quaternion.copy(held.from[i].q); });
        if (cancelled) return;
        hud.showResult('Make a proper throw!', 'Throw the dice you picked out, or keep them all.');
        return;
      }
      // Let go of them without a throw: they just drop back onto the table. If
      // the browser took the gesture away (cancelled), there's nobody to scold.
      roller.start(recordFor({ player: playerReleases }));
      if (cancelled) hud.hideResult();
      else hud.showResult('Make a proper throw!', 'That was too gentle to count - give it a real toss.');
    },
    onThrow(playerReleases) {
      // Clear the "let go to throw" prompt now that they have - it would
      // otherwise sit there, stale, while the dice settle.
      hud.hideResult();
      if (rolling) return;
      rolling = true;
      // The dice picked out go; picking is over.
      if (picking) hud.showRethrow(null);
      const held = holding;
      holding = null;
      if (awaiting) {
        const resolve = awaiting;
        awaiting = null;
        resolve(playerReleases, held?.dice);
      } else if (mode === 'zen') runZenThrow(playerReleases);
      else runRound(playerReleases);
    },
    onBoardTap() {
      // Tapping the table accepts a match-ending round the player could have
      // thrown again.
      if (state === 'deciding') endMatch(offer.outcome);
      // While picking dice out, the card says how: it stays.
      else if (state === 'playing' && !picking) hud.hideResult();
    },
  };
}

const ROUND_HEADLINES = {
  player: 'You win!',
  opponent: 'You lose.',
  tie: "It's a tie!",
};

const MATCH_HEADLINES = {
  player: 'You win the game',
  opponent: 'You lose the game',
  draw: 'The game is a draw',
};
