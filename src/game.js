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
// Quick Game does, and every die type on its own (docs/decisions.md D18).
//
// A multiplayer match ('net') is a Quick Game against another player's
// browser, through a session (net/session.js). The round goes the same way,
// but each step that waits on a player waits for each separately: each
// throws when they like, their throw is shown on the other screen as it
// arrives, and once one has, the other has 30 s (D48). Everything either
// player does goes into the session's log, from which a reloaded page
// catches up (D49).

import { GAME_OVER_LINGER_MS, NET_FOLLOW_MS, NET_WAITING_DELAY_MS } from './config.js';
import { randomHandful, aimHandful, handLayout, liftClear } from './handful.js';
import { DIE_TYPES } from './die-shapes.js';
import { createRng, deriveSeed, randomSeed } from './rng.js';
import { replayThrow } from './replay.js';
import { SHAPES } from './die-shapes.js';
import * as engine from './rules/engine.js';
import { guestSeat, swapSides, swapId, turnDie, turnTable, digestOf } from './seat.js';
import { DICE_SETS, THE_CLASSIC, dieTypes, sum } from './rules/dice-sets.js';
import { SPICE } from './rules/spice.js';
import { clashWith, stackGroups } from './rules/stacking.js';
import { dealDice, dealSpice, testBenchSpice } from './rules/draft.js';
import { diceSetCard, dieCard, spiceCard, stackCard } from './cards.js';
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

// A step's clock running out on this player (see stepClock).
const EXPIRED = Symbol('expired');

/**
 * A record exactly as the other client will get it: through JSON, which
 * turns a -0 into 0. Both then simulate the very same numbers.
 */
const sealed = (record) => JSON.parse(JSON.stringify(record));

export function createGame({ hud, roller, arena, table, effects, profiles }) {
  let state = 'menu'; // 'menu' | 'playing' | 'deciding' | 'ended'
  let mode = 'quick'; // 'quick' | 'zen' | 'net'
  // The rules engine, from this player's seat: as it is, or for a
  // multiplayer guest, turned round (seat.js, docs/decisions.md D27).
  let E = engine;
  // A multiplayer match: its view of the session's log (`net`), the
  // session, what to do once it's over, and the round being played, by
  // number, for naming its steps. `restoring` while it's being caught up
  // on from the log (D49): throws then run to rest at once, undrawn.
  let net = null;
  let session = null;
  let onNetOver = null;
  let roundNo = 0;
  let restoring = false;
  // A re-throw on offer in a multiplayer match: take it, or let it go.
  let netOffer = null;
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

  // A beat for the eye; none while a match is being caught up on.
  const pause = (ms) => (restoring ? Promise.resolve() : new Promise((resolve) => { setTimeout(resolve, ms); }));

  function newMatch(seed, diceSet, spices) {
    config = engine.matchConfig({ seed, diceSet, spices });
    rules = engine.resolveRules(config);
    match = E.startMatch(rules);
    opponentRng = createRng(deriveSeed(seed, 'opponent'));
    throwRng = createRng(deriveSeed(seed, 'throw'));
  }
  newMatch(0);

  /**
   * A throw record of `dice` on the table as it is this round, or on
   * `on` (Cat Paw's swipe in multiplayer, simulated in the host's frame).
   */
  function recordOf(dice, { on = tableNow, arenaHalfWidth = arena.arenaHalfWidth } = {}) {
    const { holes, wind, rope, reroll } = on;
    return {
      v: 1,
      arenaHalfWidth,
      divider: arena.divider,
      tray: arena.tray,
      ...(holes.length ? { holes } : {}),
      ...(wind ? { wind } : {}),
      ...(rope ? { rope: true } : {}),
      ...(reroll ? { reroll: true } : {}),
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

  /**
   * Resolves with the player's releases when they next throw, prompted by
   * `headline` if there is one (in multiplayer, the last round's result may
   * be on the card instead).
   */
  function playerThrow(headline, detail) {
    rolling = false;
    if (headline) hud.showResult(headline, detail);
    return new Promise((resolve) => { awaiting = resolve; });
  }

  /** The Spice in the match's stack that gives a re-throw (Second Wind, Mercy). */
  const rethrower = () => rules.spices.find((s) => s.rethrow) ?? rules.spice;

  // How Zen totals a throw: the dice set's scorer, or for one die alone, its face.
  let zenScorer = sum;

  /**
   * Starts a match. Both modes play `diceSet` (an id), Quick Game with
   * `spices` (a stack, D51; or one, as `spice`); Zen can instead throw one die of `dieType`. `seed` is for tests:
   * the same seed plays the same match. A multiplayer match (startNet) is
   * started here too, with both `players` given.
   */
  function start(newMode, { seed = randomSeed(), diceSet = THE_CLASSIC.id, spice, spices = spice ? [spice] : [], dieType, players: given } = {}) {
    mode = newMode;
    bench = null;
    leaveRound();
    if (mode !== 'net') net = null;
    E = net?.seat === 'guest' ? guestSeat(engine) : engine;
    newMatch(seed, diceSet, spices);
    rounds.length = 0;
    const zen = mode === 'zen';
    const alone = zen && dieType;
    const types = alone ? [dieType] : dieTypes(rules.diceSet);
    zenScorer = alone ? sum : rules.diceSet.scorer;
    tableNow = zen ? PLAIN_TABLE : E.tableOf(rules, match);
    // The AI's looks come from a stream of their own, so a replayed match
    // looks the same and no other stream moves (R6.6).
    const you = profiles.get();
    players = given ?? { player: you, opponent: zen ? null : opponentProfile(createRng(deriveSeed(seed, 'looks')), you, diceSet) };
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
    hud.setOpponentName(mode === 'net' ? looks.opponent.name : null);
    hud.showMatchInfo(diceSetCard(rules.diceSet), zen ? null : rules.spices.map(spiceCard));
    roundNo = 0;
    if (mode !== 'zen') {
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
    roundNo++;
    let announce;
    ({ state: match, announce } = E.beginRound(rules, match));
    announced = announce;
    tableNow = E.tableOf(rules, match);
    showTable();
    for (const side of SIDES) table.setHand(side, E.handOf(rules, match, side).types);
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
    const edges = [E.edgeOf(rules, match)].flat().filter((e) => e && !(offer && e.side === 'player'));
    hud.showEdge(edges.length ? edges : null);
  }

  /**
   * The Quick Game draft (R1.1-R1.3): two dice sets, then two Spice stacks
   * for the one picked (D51), both dealt from the match's seed (R1.6), then the
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
      cards: dealSpice(seed, diceSet).map((ids) => stackCard(ids.map((id) => SPICE[id]))),
      onPick: (stack) => start('quick', { seed, diceSet, spices: stack.split('+') }),
      onBack: pickDice,
    });
    pickDice();
  }

  /**
   * The test bench, for development only (behind ?dev, docs/decisions.md D39): a
   * Quick Game without the draft's luck. Every dice set, then any stack of
   * the Spice that set allows (D51), those made for it first (testBenchSpice
   * in rules/draft.js).
   * The match's seed is logged, and `?seed=` in the address replays it.
   * Once a match is over, another starts on the same dice and Spice, from a
   * new seed.
   */
  function openTestBench() {
    const startBench = (diceSet, spices) => {
      const given = new URLSearchParams(window.location.search).get('seed');
      benchMatch(diceSet, spices, given === null ? randomSeed() : Number(given));
    };
    const pickDice = () => hud.showPicker('Test bench: choose your dice',
      Object.values(DICE_SETS).map(diceSetCard), pickSpice);
    const pickSpice = (diceSet) => hud.showStackPicker({
      title: `Test bench: Spice for ${DICE_SETS[diceSet].name}`,
      cards: testBenchSpice(diceSet).filter((s) => s.id !== 'vanilla').map(spiceCard),
      clash: (picked, id) => clashWith(picked, id, diceSet),
      groups: stackGroups(testBenchSpice(diceSet).filter((s) => s.id !== 'vanilla').map((s) => s.id)),
      start: 'Start',
      onStart: (spices) => startBench(diceSet, spices),
      onBack: pickDice,
    });
    pickDice();
  }

  /** A test bench match of `diceSet` with the Spice stack `spices` (ids), from `seed`, logged. */
  function benchMatch(diceSet, spices, seed = randomSeed()) {
    const named = spices.length ? spices.join(' + ') : 'vanilla';
    console.info(`Test bench: ${diceSet} with ${named}, seed ${seed} (replay with ?dev&seed=${seed})`);
    start('quick', { seed, diceSet, spices });
    bench = { diceSet, spices };
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
    netOffer = null;
    replaying = false;
    restoring = false;
    endPicking();
    hud.showStatus(null);
    holding = null;
    for (const die of [...table.sides.player, ...table.sides.opponent]) die.highlight(false);
    hud.showRethrow(null);
  }

  function returnToMenu() {
    const leaving = net;
    leaveRound();
    state = 'menu';
    hud.showMenu();
    // Leaving a multiplayer match before it's over gives it away (D48).
    if (leaving) {
      net = null;
      onNetOver?.({ left: !leaving.ended });
    }
  }

  // ---------- The player editor (R6.8) ----------
  // The table shows through behind it: a few dice in the colours picked, on
  // the tray picked, turning slowly in the far half (clear of the editor on a
  // phone, where it sits at the bottom).
  let editing = false;
  let previewLook = null;
  let previewTurn = 0;

  /**
   * The player editor, from the menu or a multiplayer room. `onDone` goes on
   * from there once it's saved or left (the room); the menu by default.
   */
  function openEditor({ onDone } = {}) {
    leaveRound();
    state = 'menu';
    editing = true;
    previewLook = null;
    hud.showEditor(profiles.get(), {
      onChange: showLook,
      onSave(profile) {
        profiles.save(profile);
        closeEditor(onDone);
      },
      onBack: () => closeEditor(onDone),
    });
  }

  function closeEditor(onDone) {
    editing = false;
    hud.setCompact(profiles.get().compact);
    hud.showMenuPlayer(looksOf(profiles.get()));
    if (onDone) onDone();
    else hud.showMenu();
  }

  /**
   * A multiplayer match is starting while the player edits their profile:
   * what they had is saved, and the editor closed. Whether it was open.
   */
  function saveEdits() {
    if (!editing) return false;
    const draft = hud.takeEdits();
    if (draft) profiles.save(draft);
    editing = false;
    hud.setCompact(profiles.get().compact);
    hud.showMenuPlayer(looksOf(profiles.get()));
    return true;
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
    const { dice, score, named } = E.scoreDice(zenScorer, faces);
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
    const { knocks, targets } = pawKnocks(lying, swipes, (side, index) => table.sides[side][index].radius);
    await effects.swipe(targets);
    const record = recordOf(last.record.dice.map(({ id, type, s }) => ({
      id, type, s, p: lying[id].p, q: lying[id].q, ...(knocks.get(id) ?? { v: [0, 0, 0], w: [0, 0, 0] }),
    })));
    return { record, result: await roller.start(record), swipes };
  }

  /**
   * How the paw knocks each die `swipes` names, lying as `lying` says (by
   * id): the knock, by id, and where the paw goes for each, for effects.swipe.
   * `radiusOf(side, index)` is a die's circumradius.
   */
  function pawKnocks(lying, swipes, radiusOf) {
    const knocks = new Map();
    const targets = swipes.map(({ side, index, power, turn }) => {
      const id = `${side}-${index}`;
      const [x, y, z] = lying[id].p;
      const from = x >= 0 ? 1 : -1;
      const v = [-from * (2.5 + 3 * power), 1 + 1.5 * power, turn * (1 + power)];
      knocks.set(id, { v, w: [v[2] * 3, turn * 4, -v[0] * 3] });
      const length = Math.hypot(1, turn * (1 + power) / (2.5 + 3 * power));
      return { x, y, z, from, dir: [-from / length, (turn * (1 + power) / (2.5 + 3 * power)) / length], reach: radiusOf(side, index) + 0.3 };
    });
    return { knocks, targets };
  }

  async function runRound(playerReleases) {
    const id = matchId;
    const throws = [await roll({ opponent: opponentReleases(centreOf(playerReleases)), player: playerReleases })];
    if (id !== matchId) return;

    // Anything the Spice does to the dice where they've settled.
    let swipes;
    const counts = { player: table.sides.player.length, opponent: table.sides.opponent.length };
    ({ state: match, swipes } = E.afterSettle(rules, match, counts));
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
    for (let n = E.redrawsOf(rules); n > 0; n--) {
      if (!await redraw(round, throws, id)) return;
    }

    // Doubles: whoever threw them throws again, both together if both did.
    for (;;) {
      const sides = SIDES.filter((side) => E.throwsAgain(rules, match, side, [round.faces[side], ...round.again[side]]));
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
      [side, E.scoreDice(E.handOf(rules, match, side).scorer, round.faces[side])]));
    const { scorer } = E.handOf(rules, match, 'opponent');
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
   * one and its own dice stay as far apart as they were. In multiplayer each
   * side throws on its own (D48), so its record has only its own `sides`;
   * the divider keeps the other's out of reach anyway.
   */
  function recordKeeping(thrown, sides = SIDES) {
    const all = sides.flatMap((side) => table.sides[side]);
    const lying = all.filter((d) => !thrown.has(d.id)).map((d) => ({ p: d.mesh.position.toArray(), r: d.radius }));
    const released = new Map();
    for (const side of sides) {
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
      const { outcome, state: after } = E.playRound(rules, before, round.faces, round);
      await showOnTable(outcome, id);
      if (id !== matchId) return;
      const loser = outcome.winner && other(outcome.winner);
      // The opponent calls on it when this loss would cost it the match.
      if (loser === 'opponent' && E.canRethrow(rules, before, loser) && outcome.matchWinner === 'player') {
        hud.showMatch(rules.winCondition.view(after.win));
        hud.showRound(ROUND_HEADLINES.player, breakdownOf(outcome),
          { notes: [...notesOf(outcome), `Your opponent calls on its ${rethrower().name}!`] });
        await pause(OPPONENT_BEAT_MS);
        if (id !== matchId) return;
        before = E.spendRethrow(rules, before, 'opponent');
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
      `${side === 'player' ? 'You lose' : `${theirName()} loses`} ${outcome.damage[side]} ${unit}.`).join(' ');
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
    const rethrow = outcome.winner === 'opponent' && E.canRethrow(rules, before, 'player');
    offer = rethrow ? { before, round, throws, outcome, announced } : null;
    const notes = notesOf(outcome);
    if (rethrow) notes.push(`Not happy? Use your ${rethrower().name} to throw again.`);

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
        { notes: [...notesOf(outcome), `Use your ${rethrower().name} to throw again, or tap the table to accept it.`] });
    } else {
      prepareRound();
      hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdownOf(outcome), { notes: [...notes, announced] });
    }
    hud.showRethrow(rethrow ? { label: `${rethrower().icon} Throw again`, title: `${rethrower().name}: throw your dice again` } : null, table.onScreen);
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
    if (net) net.end({ winner: seatOf(outcome.matchWinner), reason: 'played' });
    hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdownOf(outcome), { gameOver: true, notes });
    rolling = false;
    const id = matchId;
    setTimeout(() => { if (state === 'ended' && id === matchId) afterMatch(); }, GAME_OVER_LINGER_MS);
  }

  // Once a match is over: back to the menu, or on the test bench, the same
  // again, or in multiplayer, the room.
  function afterMatch() {
    if (mode === 'net') finishNet();
    else if (bench) benchMatch(bench.diceSet, bench.spices);
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
    const before = E.spendRethrow(rules, offer.before, 'player');
    const id = matchId;
    offer = null;
    replaying = true;
    hud.showRethrow(null);
    // Back as it was before the round: its hand, its announcement, its score.
    match = before;
    state = 'playing';
    announced = then;
    tableNow = E.tableOf(rules, match);
    showTable();
    for (const side of SIDES) table.setHand(side, E.handOf(rules, match, side).types);
    hud.showMatch(rules.winCondition.view(match.win));
    hud.showAnnounce(then);
    showEdges();
    const releases = await playerThrow(`${rethrower().name}!`, 'Throw your dice again: this throw replaces the last.');
    if (id !== matchId) return;
    const next = await roll({ player: releases });
    if (id !== matchId) return;
    throws.push(next);
    round.faces.player = facesOf(next.result, 'player');
    round.fallen.player = diceOf(next.result, 'player').map((d) => d.fallen);
    await playOut(before, round, throws, id);
  }

  // ---------- Multiplayer (docs/decisions.md D48, D49) ----------

  /** What the other player is called: their name in multiplayer. */
  const theirName = () => (mode === 'net' ? players.opponent.name : 'Your opponent');

  /** A side on this screen as a seat in the session ('host', 'guest'); a draw is null. */
  const seatOf = (side) => (side === 'player' ? net.seat : side === 'opponent' ? (net.seat === 'host' ? 'guest' : 'host') : null);
  /** A seat as a side on this screen. */
  const sideOfSeat = (seat) => (seat ? (seat === net.seat ? 'player' : 'opponent') : null);

  /** One side's faces, and which of its dice fell in a hole, from a throw's result. */
  const sideOf = (result, side) => ({ faces: facesOf(result, side), fallen: diceOf(result, side).map((d) => d.fallen) });

  /**
   * Starts a multiplayer match on `view`, the session's view of its log
   * (session.startMatch), with `link` the session itself. With `restore`
   * the match is first caught up on from the log (a reloaded page, D49).
   * `onOver` is called once it's over and its card has been seen, or the
   * player has left it (`{ left: true }`).
   */
  function startNet(view, link, { restore = false, onOver } = {}) {
    net = view;
    session = link;
    onNetOver = onOver;
    watchSession(link);
    start('net', { ...view.config, players: view.profiles });
    // Each seat's spin jitter from a stream of its own: from the one
    // stream, two players making the same drag would throw the same throw.
    throwRng = createRng(deriveSeed(view.config.seed, `throw-${view.seat}`));
    restoring = restore;
    netLoop(matchId);
  }

  // The session's news, for the match under way: the link lost or back, the
  // other player gone for good, the match ended over there, or the two
  // clients come apart. Listened to once per session.
  const watched = new WeakSet();
  function watchSession(link) {
    if (watched.has(link)) return;
    watched.add(link);
    const live = () => session === link && net && !net.ended;
    link.on('status', (status) => { if (live()) connectionNow(status); });
    link.on('left', () => { if (live()) walkover('player', 'left'); });
    link.on('over', (result) => { if (session === link && net) showWalkover(sideOfSeat(result.winner), result.reason); });
    link.on('desync', (why) => { if (live()) outOfSync(why); });
  }

  async function netLoop(id) {
    while (id === matchId && state === 'playing') {
      if (!await netRound(id)) return;
    }
  }

  /**
   * One round of a multiplayer match, the same steps as runRound: both
   * throw; a paw may swipe; each may throw some dice again; doubles are
   * thrown again; then it's played out. Resolves false once the match is
   * over or left.
   */
  async function netRound(id) {
    const r = roundNo;
    const first = await netThrows(`${r}/throw`, SIDES, id);
    if (!first) return false;
    const throws = [first];
    const round = {
      faces: { player: first.player.faces, opponent: first.opponent.faces },
      fallen: { player: first.player.fallen, opponent: first.opponent.fallen },
      again: { player: [], opponent: [] },
    };

    let swipes;
    const counts = { player: table.sides.player.length, opponent: table.sides.opponent.length };
    ({ state: match, swipes } = E.afterSettle(rules, match, counts));
    if (swipes.length) {
      const paw = await netCatPaw(first, swipes, id);
      if (!paw) return false;
      throws.push(paw);
      round.faces = { player: paw.sides.player.faces, opponent: paw.sides.opponent.faces };
      round.fallen = { player: paw.sides.player.fallen, opponent: paw.sides.opponent.fallen };
    }

    for (let n = 1; n <= E.redrawsOf(rules); n++) {
      if (!await netRedraw(`${r}/redraw${n}`, round, throws, id)) return false;
    }

    // Doubles: only whoever threw them owes a throw.
    for (let k = 1; ; k++) {
      const sides = SIDES.filter((side) => E.throwsAgain(rules, match, side, [round.faces[side], ...round.again[side]]));
      if (!sides.length) break;
      let prompt = null;
      if (sides.includes('player')) {
        prompt = { headline: 'Doubles! Throw again',
          detail: sides.length > 1 ? `So did ${theirName()}. Both throws are added on.` : 'Your next throw is added to your total.' };
      } else {
        hud.showResult(`${theirName()} threw doubles`, 'They throw again, and add it on.');
      }
      const next = await netThrows(`${r}/again${k}`, sides, id, prompt);
      if (!next) return false;
      throws.push(next);
      for (const side of sides) round.again[side].push(next[side].faces);
    }

    return netPlayOut(r, match, round, throws, id);
  }

  /**
   * A step where `sides` each throw, each when they like (D48): this
   * player's throw is made here, theirs arrives from the session, and each
   * plays on its own half as soon as it's in. Resolves with each side's
   * throw once all have settled, or null if the match ended meanwhile (a
   * throw not made in time loses it).
   */
  async function netThrows(step, sides, id, prompt = null) {
    const clock = stepClock(sides, id);
    const got = {};
    await Promise.all(sides.map(async (side) => {
      got[side] = side === 'player' ? await myThrow(step, prompt, clock) : await theirThrow(step, clock);
      clock.settled(side);
    }));
    clock.stop();
    if (id !== matchId) return null;
    const late = sides.find((side) => got[side].forfeit);
    if (late) {
      walkover(other(late), 'stalled');
      return null;
    }
    return got;
  }

  /** This player's throw at `step`: made now, or from the log if it was made before a reload. */
  async function myThrow(step, prompt, clock) {
    let data = net.mine(step);
    if (!data) {
      restoring = false;
      const releases = await Promise.race([playerThrow(prompt?.headline, prompt?.detail), clock.expired()]);
      awaiting = null;
      data = releases === EXPIRED ? { forfeit: true } : { record: sealed(recordFor({ player: releases })) };
      net.put(step, data);
    }
    clock.made('player');
    if (data.forfeit) return data;
    return playMine(step, data.record);
  }

  /** The other player's throw at `step`, shown on their half as soon as it's in. */
  async function theirThrow(step, clock) {
    if (!net.has(step)) restoring = false;
    const data = await net.take(step);
    clock.made('opponent');
    if (data.forfeit) return data;
    return playTheirs(step, data.record);
  }

  /** Plays this player's `record`, and logs where it landed for the other client to check (R4.3). */
  async function playMine(step, record) {
    rolling = true;
    table.tidy();
    const view = net;
    const result = await roller.start(record, { instant: restoring });
    if (net !== view) return { record, result, ...sideOf(result, 'player') };
    net.put(`${step}#`, { digest: result.digest });
    return { record, result, ...sideOf(result, 'player') };
  }

  /**
   * Plays the other player's `record`, made in their frame, turned round
   * onto their half, and checks it landed where it did for them (R4.3).
   * Their dice are `player-` in it, as they are to them.
   */
  async function playTheirs(step, record) {
    const view = net;
    const types = table.sides.opponent.map((d) => d.type).join();
    if (record?.dice?.map((d) => d.type).join() !== types) {
      outOfSync(`${step}: the other player threw different dice`);
      return new Promise(() => {});
    }
    table.tidy();
    const result = await roller.start(record, { track: 'opponent', turned: true, instant: restoring });
    net?.take(`${step}#`).then(({ digest }) => {
      if (net === view && digest !== result.digest) outOfSync(`${step}: the throw landed differently on the two screens`);
    });
    return { record, result, ...sideOf(result, 'player') };
  }

  /**
   * The clock on a step waiting on `owes` (D48): once one side has done its
   * part, the other has NET_FOLLOW_MS; a step only one side owes starts it
   * at once. When this player's runs out, `expired()` resolves; the other
   * player's own client calls theirs, so a throw sent at the last moment is
   * never both made and too late. Meanwhile it says what's awaited: this
   * player's time left on the status pill, and once their part is done and
   * settled, "Waiting for…" (a throw, on the card; a choice, on the pill,
   * leaving the round's result on the card to read).
   */
  function stepClock(owes, id, { choice = false } = {}) {
    const deadline = {};
    const made = new Set();
    let expire;
    const expired = new Promise((resolve) => { expire = resolve; });
    const start = (side) => { if (deadline[side] === undefined && !made.has(side)) deadline[side] = Date.now() + NET_FOLLOW_MS; };
    if (owes.length === 1) start(owes[0]);
    // Since when this player has had nothing left to do here.
    let idleSince = owes.includes('player') ? null : Date.now() + NET_WAITING_DELAY_MS;
    let waiting = false;
    const view = net;

    function tick() {
      if (id !== matchId || net !== view) {
        stop();
        return;
      }
      const now = Date.now();
      const left = (side) => Math.max(0, Math.ceil((deadline[side] - now) / 1000));
      const mine = owes.includes('player') && !made.has('player');
      const theirs = owes.includes('opponent') && !made.has('opponent');
      const idle = idleSince !== null && now - idleSince >= NET_WAITING_DELAY_MS;
      if (mine && deadline.player !== undefined) {
        if (now >= deadline.player) expire(EXPIRED);
        hud.showStatus(`${choice ? 'Your call' : 'Your throw'} · ${left('player')} s`);
      } else if (theirs && idle && choice) {
        hud.showStatus(`Waiting for ${theirName()}${deadline.opponent !== undefined ? ` · ${left('opponent')} s` : '…'}`);
      } else {
        hud.showStatus(null);
      }
      if (theirs && idle && !choice && !lostShown) {
        hud.showResult(`Waiting for ${theirName()}…`, deadline.opponent !== undefined ? `${left('opponent')} s left to throw.` : '');
        waiting = true;
      } else if (waiting && !theirs) {
        hud.hideResult();
        waiting = false;
      }
    }

    const timer = setInterval(tick, 250);
    function stop() {
      clearInterval(timer);
      if (id === matchId) hud.showStatus(null);
      if (waiting && id === matchId) hud.hideResult();
      waiting = false;
    }
    return {
      expired: () => expired,
      made(side) {
        made.add(side);
        for (const s of owes) if (s !== side) start(s);
        tick();
      },
      settled(side) { if (side === 'player') idleSince = Date.now(); },
      stop,
    };
  }

  /**
   * Cat Paw's swipe in multiplayer: the one simulation of both sides' dice
   * together, so it runs in the host's frame on both clients (D48): each
   * side's dice where its throw left them, the guest's turned round onto
   * the host's far half, and on the guest's screen all of it drawn turned
   * round again. Resolves with each side's faces after it, or null if the
   * match ended meanwhile.
   */
  async function netCatPaw(first, swipes, id) {
    const guest = net.seat === 'guest';
    const hostSide = guest ? 'opponent' : 'player';
    const inHostFrame = (side) => {
      const { record, result } = first[side];
      const at = Object.fromEntries(result.dice.map((d) => [d.id, d]));
      const dice = record.dice.map(({ id: die, type, s }) => ({ id: die, type, s, p: at[die].p, q: at[die].q }));
      return side === hostSide ? dice : dice.map(turnDie);
    };
    const dice = [...inHostFrame(hostSide), ...inHostFrame(other(hostSide))];
    const lying = Object.fromEntries(dice.map((d) => [d.id, d]));
    const { knocks, targets } = pawKnocks(lying, guest ? swapSides(swipes) : swipes,
      (side, index) => table.sides[guest ? swapSides(side) : side][index].radius);
    const turnTarget = (t) => ({ ...t, x: -t.x, z: -t.z, from: -t.from, dir: [-t.dir[0], -t.dir[1]] });
    if (!restoring) await effects.swipe(guest ? targets.map(turnTarget) : targets);
    if (id !== matchId) return null;
    const record = sealed(recordOf(dice.map((d) => ({ ...d, ...(knocks.get(d.id) ?? { v: [0, 0, 0], w: [0, 0, 0] }) })), {
      on: guest ? turnTable(tableNow) : tableNow,
      arenaHalfWidth: Math.max(first.player.record.arenaHalfWidth, first.opponent.record.arenaHalfWidth),
    }));
    const result = await roller.start(record, { turned: guest, instant: restoring });
    if (id !== matchId) return null;
    return {
      record, result,
      sides: { player: sideOf(result, hostSide === 'player' ? 'player' : 'opponent'), opponent: sideOf(result, hostSide === 'player' ? 'opponent' : 'player') },
    };
  }

  /**
   * A redraw (Draw Poker) in multiplayer: each player picks the dice to
   * throw again and throws them, or keeps them all, without waiting on the
   * other; their dice held where they lie, in their own throw. Resolves
   * false if the match ended meanwhile.
   */
  async function netRedraw(step, round, throws, id) {
    const clock = stepClock(SIDES, id, { choice: true });
    const got = {};
    await Promise.all(SIDES.map(async (side) => {
      got[side] = side === 'player' ? await myRedraw(step, round, clock) : await theirRedraw(step, clock);
      clock.settled(side);
    }));
    clock.stop();
    if (id !== matchId) return false;
    for (const side of SIDES) {
      const thrown = got[side];
      if (!thrown) continue;
      throws.push(thrown);
      // Whoever threw, the dice in their record are `player-`: their own.
      const fixed = new Set(thrown.record.dice.filter((d) => d.fixed).map((d) => d.id));
      for (const d of thrown.result.dice) if (!fixed.has(d.id)) round.faces[side][Number(d.id.split('-')[1])] = d.face;
    }
    return true;
  }

  async function myRedraw(step, round, clock) {
    let data = net.mine(step);
    if (!data) {
      restoring = false;
      const scored = Object.fromEntries(SIDES.map((side) =>
        [side, E.scoreDice(E.handOf(rules, match, side).scorer, round.faces[side])]));
      const hand = (side) => ({ side, dice: scored[side].dice, score: scored[side].score, named: scored[side].named });
      rolling = false;
      hud.showRound('Throw any again?', [hand('player'), hand('opponent')],
        { notes: ['Tap the dice you want to throw again, then throw them. Or keep them all.'] });
      hud.showRethrow({ label: '✋ Keep them', title: 'Keep all your dice as they are' }, table.onScreen);
      const mine = await Promise.race([new Promise((resolve) => {
        picking = { chosen: new Set(), keep: () => resolve(null) };
        awaiting = (releases, dice) => resolve({ releases, dice });
      }), clock.expired()]);
      endPicking();
      if (mine && mine !== EXPIRED) {
        const thrown = new Map();
        mine.dice.forEach((die, i) => thrown.set(die.id, mine.releases[i]));
        data = { record: sealed(recordKeeping(thrown, ['player'])) };
      } else {
        data = { keep: true };
      }
      net.put(step, data);
    }
    clock.made('player');
    return data.record ? playMine(step, data.record) : null;
  }

  async function theirRedraw(step, clock) {
    if (!net.has(step)) restoring = false;
    const data = await net.take(step);
    clock.made('opponent');
    return data.record ? playTheirs(step, data.record) : null;
  }

  /**
   * Plays the round out from `before`, as playOut does; if its loser may
   * throw again (Second Wind, Mercy), the next round waits for their call,
   * made on their screen. Resolves false once the match is over or left.
   */
  async function netPlayOut(r, before, round, throws, id) {
    for (let k = 1; ; k++) {
      const { outcome, state: after } = E.playRound(rules, before, round.faces, round);
      await showOnTable(outcome, id);
      if (id !== matchId) return false;
      const loser = outcome.winner && other(outcome.winner);
      if (loser && E.canRethrow(rules, before, loser)) {
        const thrown = await rethrowCall(`${r}/rethrow${k}`, loser, outcome, after, id);
        if (id !== matchId || !thrown) return false;
        if (thrown.result) {
          before = E.spendRethrow(rules, before, loser);
          hud.showMatch(rules.winCondition.view(before.win));
          throws.push(thrown);
          round.faces[loser] = thrown.faces;
          round.fallen[loser] = thrown.fallen;
          continue;
        }
      }
      netCommit(r, round, throws, outcome, after);
      return state === 'playing';
    }
  }

  /**
   * The loser of a round may throw again (D48): on their screen, offered it
   * until they tap the table to accept the result, or their time is up; on
   * the other, waited for. Resolves with the re-throw, `{}` if it wasn't
   * taken, or null if the match ended meanwhile.
   */
  async function rethrowCall(step, loser, outcome, after, id) {
    const clock = stepClock([loser], id, { choice: true });
    hud.showMatch(rules.winCondition.view(after.win));
    const headline = outcome.matchWinner ? MATCH_HEADLINES[outcome.matchWinner] : ROUND_HEADLINES[outcome.winner];
    const { name, icon } = rethrower();
    let data;
    if (loser === 'player') {
      data = net.mine(step);
      if (!data) {
        restoring = false;
        hud.showRound(headline, breakdownOf(outcome),
          { notes: [...notesOf(outcome), `Use your ${name} to throw again, or tap the table to accept it.`] });
        hud.showRethrow({ label: `${icon} Throw again`, title: `${name}: throw your dice again` }, table.onScreen);
        const releases = await Promise.race([new Promise((resolve) => {
          netOffer = {
            async use() {
              netOffer = null;
              hud.showRethrow(null);
              resolve(await playerThrow(`${name}!`, 'Throw your dice again: this throw replaces the last.'));
            },
            decline() {
              netOffer = null;
              resolve(null);
            },
          };
        }), clock.expired()]);
        netOffer = null;
        awaiting = null;
        hud.showRethrow(null);
        data = releases && releases !== EXPIRED ? { record: sealed(recordFor({ player: releases })) } : { decline: true };
        net.put(step, data);
      }
    } else {
      hud.showRound(headline, breakdownOf(outcome),
        { notes: [...notesOf(outcome), `${theirName()} can use their ${name} to throw again.`] });
      if (!net.has(step)) restoring = false;
      data = await net.take(step);
    }
    clock.made(loser);
    clock.stop();
    if (id !== matchId) return null;
    if (!data.record) return {};
    if (loser === 'player') return playMine(step, data.record);
    hud.showResult(`${theirName()} calls on their ${name}!`, 'Their throw replaces the last.');
    return playTheirs(step, data.record);
  }

  /**
   * The round's outcome stands: the match moves on, and the two clients
   * check they agree on where it now stands (R4.4).
   */
  function netCommit(r, round, throws, outcome, after) {
    rounds.push({ throws, outcome });
    match = after;
    hud.showMatch(rules.winCondition.view(after.win));
    const view = net;
    const digest = digestOf(net.seat === 'guest' ? swapSides(after) : after);
    net.put(`${r}/state`, { digest });
    net.take(`${r}/state`).then((theirs) => {
      if (net === view && theirs.digest !== digest) outOfSync(`after round ${r} the match stands differently on the two screens`);
    });
    if (outcome.matchWinner) {
      endMatch(outcome);
      return;
    }
    prepareRound();
    hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdownOf(outcome), { notes: [...notesOf(outcome), announced] });
    rolling = false;
  }

  // The link lost: the other player has NET_FOLLOW_MS to come back (D49).
  // Past that, whoever can still reach the server wins: the other side is
  // the one that dropped.
  let lostTimer = null;
  let lostShown = false;
  function connectionNow(status) {
    clearInterval(lostTimer);
    lostTimer = null;
    if (status !== 'lost') {
      if (lostShown && state === 'playing') hud.hideResult();
      lostShown = false;
      return;
    }
    const view = net;
    const tick = () => {
      if (net !== view || view.ended) {
        clearInterval(lostTimer);
        lostShown = false;
        return;
      }
      const left = Math.max(0, Math.ceil((session.lostAt + NET_FOLLOW_MS - Date.now()) / 1000));
      const online = session.online();
      lostShown = true;
      hud.showResult('Connection lost',
        online ? `Waiting for ${theirName()} to come back · ${left} s` : `Trying to reconnect · ${left} s`);
      if (left > 0) return;
      clearInterval(lostTimer);
      lostShown = false;
      walkover(online ? 'player' : 'opponent', online ? 'gone' : 'dropped');
    };
    lostTimer = setInterval(tick, 250);
    tick();
  }

  /** The match is over off the table: `winner` wins by walkover, for `reason`. */
  function walkover(winner, reason) {
    if (!net || net.ended) return;
    net.end({ winner: seatOf(winner), reason });
    showWalkover(winner, reason);
  }

  /** The two clients came apart (R4.4): the match can't go on. */
  function outOfSync(why) {
    if (!net || net.ended) return;
    console.error(`Multiplayer: out of sync: ${why}`);
    net.end({ winner: null, reason: 'desync' });
    showWalkover(null, 'desync');
  }

  function showWalkover(winner, reason) {
    if (state === 'ended' || !net) return;
    clearInterval(lostTimer);
    lostShown = false;
    leaveRound();
    state = 'ended';
    hud.showAnnounce(undefined);
    hud.showEdge(null);
    const name = theirName();
    const why = {
      stalled: winner === 'player' ? `${name} didn't throw in time.` : "You didn't throw in time.",
      left: winner === 'player' ? `${name} left the match.` : 'You left the match.',
      gone: winner === 'player' ? `${name} lost the connection and didn't come back.` : 'You lost the connection.',
      dropped: winner === 'player' ? `${name} lost the connection and didn't come back.` : 'You lost the connection.',
      desync: 'The two games came out differently, so this match can\'t go on.',
    }[reason] ?? '';
    const headline = reason === 'desync' ? 'Out of sync'
      : winner === 'player' ? 'You win by walkover' : winner === 'opponent' ? 'You lose by walkover' : 'Match abandoned';
    hud.showResult(headline, why, { gameOver: true });
    const id = matchId;
    setTimeout(() => { if (state === 'ended' && id === matchId) afterMatch(); }, GAME_OVER_LINGER_MS * 2);
  }

  /** Done with a multiplayer match: back to the room it was played from. */
  function finishNet() {
    const done = net;
    leaveRound();
    state = 'menu';
    net = null;
    if (done) onNetOver?.({ left: false });
  }

  hud.onQuickGame(() => openDraft());
  hud.onZen(() => hud.showPicker('Zen: choose your dice', ZEN_CARDS,
    (id) => start('zen', id.startsWith('die:') ? { dieType: id.slice(4) } : { diceSet: id })));
  hud.onTestBench(openTestBench);
  hud.onEditPlayer(() => openEditor());
  hud.setCompact(profiles.get().compact);
  hud.onBack(returnToMenu);
  hud.showMenuPlayer(looksOf(profiles.get()));
  // The button under the card: keep all your dice while picking (Draw
  // Poker), or a re-throw (Second Wind).
  hud.onRethrow(() => {
    if (picking && !rolling && !holding) picking.keep();
    else if (netOffer && !awaiting) netOffer.use();
    else if (!picking && mode !== 'net') useRethrow();
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
    get offered() { return offer !== null || (netOffer !== null && !awaiting); },
    rounds,
    start,
    openDraft,
    openEditor,
    saveEdits,
    startNet,
    /** The multiplayer match under way: its seat, and whether it's still being caught up on. */
    get net() { return net && { seat: net.seat, n: net.n, restoring, round: roundNo }; },
    frame,
    useRethrow,
    /** Spin jitter for the player's throws, from the match's seed. */
    random: () => throwRng.next(),
    // The dice can only be picked up between rounds of a match in progress;
    // in multiplayer, only when a throw is due from them.
    canGrab: () => state === 'playing' && !rolling && (mode !== 'net' || awaiting !== null),
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
      // Dice still dropping from a fumble are caught again mid-fall (the
      // other player's throw plays on).
      roller.cancel('player');
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
      else if (mode === 'net') {
        // A throw no longer wanted (the clock ran out on it while held): the
        // dice go back where they lay.
        rolling = false;
        held?.dice.forEach((die, i) => { die.mesh.position.copy(held.from[i].p); die.mesh.quaternion.copy(held.from[i].q); });
      } else runRound(playerReleases);
    },
    onBoardTap() {
      // Tapping the table accepts a round the player could have thrown
      // again: in multiplayer, any; otherwise one that ends the match.
      if (netOffer && !awaiting) netOffer.decline();
      else if (state === 'deciding') endMatch(offer.outcome);
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
