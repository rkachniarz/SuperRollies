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
// dice (Cat Paw's swipe), or have a side throw again (Doubles Again); the
// rules play the round out; and its loser may get to throw again and have it
// played out once more (Second Wind, Mercy). The rules say what happens at
// each step and the table carries it out, so every throw, paw and breeze is
// in a throw record and replays exactly.
//
// Zen: no opponent, no divider, no score - the whole tray, for throwing for
// the sake of it. It's also the testbed: its catalogue offers every dice set
// Quick Game does, and every die type on its own (DEV_PLAN.md D18).

import { GAME_OVER_LINGER_MS } from './config.js';
import { randomHandful } from './handful.js';
import { DIE_TYPES } from './die-shapes.js';
import { createRng, deriveSeed, randomSeed } from './rng.js';
import {
  matchConfig, resolveRules, startMatch, beginRound, playRound, handOf, edgeOf, scoreDice,
  tableOf, afterSettle, throwsAgain, canRethrow, spendRethrow,
} from './rules/engine.js';
import { DICE_SETS, THE_CLASSIC, dieTypes, sum } from './rules/dice-sets.js';
import { SPICE } from './rules/spice.js';
import { dealDice, dealSpice } from './rules/draft.js';
import { diceSetCard, dieCard, spiceCard } from './cards.js';

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

// Zen's table: nothing on it but the dice.
const PLAIN_TABLE = { holes: [], wind: null, divider: false };

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createGame({ hud, roller, arena, table, effects }) {
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
    const { holes, wind } = tableNow;
    return {
      v: 1,
      arenaHalfWidth: arena.arenaHalfWidth,
      divider: arena.divider,
      tray: arena.tray,
      ...(holes.length ? { holes } : {}),
      ...(wind ? { wind } : {}),
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
    const record = recordFor(releases);
    return { record, result: await roller.start(record) };
  }

  /** The opponent's handful, thrown at random from its own half. */
  function opponentReleases() {
    const { offsets, reach } = table.hands.opponent;
    return randomHandful(arena.opponentZone(reach), offsets, () => opponentRng.next());
  }

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
    leaveRound();
    newMatch(seed, diceSet, spice);
    rounds.length = 0;
    const zen = mode === 'zen';
    const alone = zen && dieType;
    const types = alone ? [dieType] : dieTypes(rules.diceSet);
    zenScorer = alone ? sum : rules.diceSet.scorer;
    tableNow = zen ? PLAIN_TABLE : tableOf(rules, match);
    table.setup({
      types,
      scale: alone ? 1 : rules.diceSet.dieScale,
      tray: alone ? THE_CLASSIC.tray : rules.diceSet.tray,
      opponent: !zen,
      divider: !zen && tableNow.divider,
      holes: tableNow.holes,
    });
    effects.setWind(null);
    hud.showBoard(mode);
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
    effects.setWind(tableNow.wind);
    for (const side of SIDES) table.setHand(side, handOf(rules, match, side).types);
    hud.showAnnounce(announce);
    showEdges();
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

  // Abandons whatever round is under way: the throw in flight, a paw, a
  // throw or a decision waited on. The next match resets the table.
  function leaveRound() {
    matchId++;
    roller.cancel();
    effects.clear();
    rolling = false;
    awaiting = null;
    offer = null;
    replaying = false;
    hud.showRethrow(null);
  }

  function returnToMenu() {
    leaveRound();
    state = 'menu';
    hud.showMenu();
  }

  async function runZenThrow(playerReleases) {
    const record = recordFor({ player: playerReleases });
    const result = await roller.start(record);
    rounds.push({ record, result, throws: [{ record, result }] });
    const faces = facesOf(result, 'player');
    const { dice, score } = scoreDice(zenScorer, faces);
    // The total up top; with several dice, how it was made up below.
    if (faces.length === 1) hud.showResult(`You rolled ${score}`, '');
    else hud.showRound(`You rolled ${score}`, [{ side: 'player', dice, score }]);
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
    const throws = [await roll({ opponent: opponentReleases(), player: playerReleases })];
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
   * Plays the round out from `before` (the state it started in), shows it,
   * and if its loser can throw again (Second Wind, Mercy), lets them: the
   * opponent decides at once, the player is offered it (see commit).
   */
  async function playOut(before, round, throws, id) {
    for (;;) {
      const { outcome, state: after } = playRound(rules, before, round.faces, round);
      const loser = outcome.winner && other(outcome.winner);
      // The opponent calls on it when this loss would cost it the match.
      if (loser === 'opponent' && canRethrow(rules, before, loser) && outcome.matchWinner === 'player') {
        hud.showMatch(rules.winCondition.view(after.win));
        hud.showRound(ROUND_HEADLINES.player, breakdownOf(outcome),
          { notes: [outcome.note, `Your opponent calls on its ${rules.spice.name}!`] });
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

  const breakdownOf = (outcome) => SIDES.map((side) => ({
    side,
    dice: outcome.dice[side],
    adjustments: outcome.adjustments[side],
    score: outcome.scores[side],
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
    const notes = [outcome.note];
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
        { notes: [outcome.note, `Use your ${rules.spice.name} to throw again, or tap the table to accept it.`] });
    } else {
      prepareRound();
      hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdownOf(outcome), { notes: [...notes, announced] });
    }
    hud.showRethrow(rethrow ? { label: `${rules.spice.icon} Throw again`, title: `${rules.spice.name}: throw your dice again` } : null);
    rolling = false;
  }

  // Match over: announce it, then head back to the main menu after a beat (or
  // immediately if they tap the card).
  function endMatch(outcome) {
    state = 'ended';
    offer = null;
    hud.showRethrow(null);
    hud.showAnnounce(undefined);
    hud.showEdge(null);
    hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdownOf(outcome), { gameOver: true, notes: [outcome.note] });
    rolling = false;
    const id = matchId;
    setTimeout(() => { if (state === 'ended' && id === matchId) returnToMenu(); }, GAME_OVER_LINGER_MS);
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
    effects.setWind(tableNow.wind);
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
  hud.onBack(returnToMenu);
  hud.onRethrow(useRethrow);

  // The match-over card is the one that takes pointer events, so tapping it
  // heads straight back to the menu instead of waiting out the timer.
  hud.onResultClick(() => {
    if (state === 'ended') returnToMenu();
    else hud.hideResult();
  });

  return {
    get state() { return state; },
    get mode() { return mode; },
    get config() { return config; },
    get match() { return match; },
    get rules() { return rules; },
    /** The seed the draft on screen deals from. */
    get draftSeed() { return draftSeed; },
    /** What the round is waiting on from the player: a throw ('throw'), or nothing. */
    get awaiting() { return awaiting ? 'throw' : null; },
    /** Whether a re-throw is on offer to the player. */
    get offered() { return offer !== null; },
    rounds,
    start,
    openDraft,
    useRethrow,
    /** Spin jitter for the player's throws, from the match's seed. */
    random: () => throwRng.next(),
    // The dice can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    onGrab() {
      // Dice still dropping from a fumble are caught again mid-fall.
      roller.cancel();
      // Picking the dice up for the next round lets the last one stand.
      if (offer && !awaiting) {
        offer = null;
        hud.showRethrow(null);
        showEdges();
      }
      hud.showResult('Let go to throw', '');
    },
    onFumble(playerReleases, { cancelled = false } = {}) {
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
      if (awaiting) {
        const resolve = awaiting;
        awaiting = null;
        resolve(playerReleases);
      } else if (mode === 'zen') runZenThrow(playerReleases);
      else runRound(playerReleases);
    },
    onBoardTap() {
      // Tapping the table accepts a match-ending round the player could have
      // thrown again.
      if (state === 'deciding') endMatch(offer.outcome);
      else if (state === 'playing') hud.hideResult();
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
