// Match flow: starting a match, throwing, and handing each round's dice to the
// rules engine (rules/engine.js), which decides what they mean. This file only
// turns that into dice on the table and words on the screen.
//
// Quick Game: a two-step draft - two dice sets to pick from, then two Spice
// that suit them (rules/draft.js) - then both sides throw their handful each
// round and the rules, bent by the Spice, decide who wins it and what it
// costs, until the win condition says the match is over.
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

export function createGame({ hud, roller, arena, table }) {
  let state = 'menu'; // 'menu' | 'playing' | 'ended'
  let mode = 'quick'; // 'quick' | 'zen'
  let rolling = false;
  // This match's throw records and outcomes, newest last. Kept so any round can
  // be replayed exactly (see replay.js); the test tools read it from the page.
  // Emptied, not replaced, for each new match, so a reference to it stays good.
  const rounds = [];

  // The match being played: its config, the rules it names, and where it
  // stands. Zen has a config too (for its seed) but no rules state.
  let config;
  let rules;
  let match;
  // What the Spice announced for the round about to be thrown, if anything.
  let announced;
  // Separate random streams for the AI's throws and for the spin jitter on the
  // player's, so neither can shift the other or the rules' own stream.
  let opponentRng;
  let throwRng;
  // The seed the draft on screen is dealing from.
  let draftSeed;

  function newMatch(seed, diceSet, spice) {
    config = matchConfig({ seed, diceSet, spice });
    rules = resolveRules(config);
    match = startMatch(rules);
    opponentRng = createRng(deriveSeed(seed, 'opponent'));
    throwRng = createRng(deriveSeed(seed, 'throw'));
  }
  newMatch(0);

  /** A throw record from each side's releases (each in its dice's order). */
  function recordFor(releases) {
    const dice = Object.entries(releases).flatMap(([side, list]) => list.map((release, i) => {
      const die = table.sides[side][i];
      return { id: die.id, type: die.type, s: die.scale, ...release };
    }));
    return { v: 1, arenaHalfWidth: arena.arenaHalfWidth, divider: arena.divider, tray: arena.tray, dice };
  }

  /** One side's faces from a finished throw, in its dice's order. */
  const facesOf = (result, side) => result.dice.filter((d) => d.id.startsWith(side + '-')).map((d) => d.face);

  // How Zen totals a throw: the dice set's scorer, or for one die alone, its face.
  let zenScorer = sum;

  /**
   * Starts a match. Both modes play `diceSet` (an id), Quick Game with
   * `spice`; Zen can instead throw one die of `dieType`. `seed` is for tests:
   * the same seed plays the same match.
   */
  function start(newMode, { seed = randomSeed(), diceSet = THE_CLASSIC.id, spice, dieType } = {}) {
    mode = newMode;
    rolling = false;
    roller.cancel();
    newMatch(seed, diceSet, spice);
    rounds.length = 0;
    const zen = mode === 'zen';
    const alone = zen && dieType;
    const types = alone ? [dieType] : dieTypes(rules.diceSet);
    zenScorer = alone ? sum : rules.diceSet.scorer;
    table.setup({
      types,
      scale: alone ? 1 : rules.diceSet.dieScale,
      tray: alone ? THE_CLASSIC.tray : rules.diceSet.tray,
      opponent: !zen,
    });
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
    for (const side of SIDES) table.setHand(side, handOf(rules, match, side).types);
    hud.showAnnounce(announce);
    hud.showEdge(edgeOf(rules, match));
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

  function returnToMenu() {
    // Leaving mid-throw just abandons it; the next match resets the table.
    roller.cancel();
    rolling = false;
    state = 'menu';
    hud.showMenu();
  }

  async function runZenThrow(playerReleases) {
    const record = recordFor({ player: playerReleases });
    const result = await roller.start(record);
    rounds.push({ record, result });
    const faces = facesOf(result, 'player');
    const { dice, score } = scoreDice(zenScorer, faces);
    // The total up top; with several dice, how it was made up below.
    if (faces.length === 1) hud.showResult(`You rolled ${score}`, '');
    else hud.showRound(`You rolled ${score}`, [{ side: 'player', dice, score }]);
    rolling = false;
  }

  async function runRound(playerReleases) {
    // The player's handful comes from the throw gesture; the opponent's is
    // thrown at random from its own half.
    const { offsets, reach } = table.hands.opponent;
    const opponentReleases = randomHandful(arena.opponentZone(reach), offsets, () => opponentRng.next());
    const record = recordFor({ opponent: opponentReleases, player: playerReleases });
    const result = await roller.start(record);

    let outcome;
    ({ outcome, state: match } = playRound(rules, match, {
      player: facesOf(result, 'player'),
      opponent: facesOf(result, 'opponent'),
    }));
    rounds.push({ record, result, outcome });
    hud.showMatch(rules.winCondition.view(match.win));

    const breakdown = SIDES.map((side) => ({
      side,
      dice: outcome.dice[side],
      adjustments: outcome.adjustments[side],
      score: outcome.scores[side],
    }));

    if (outcome.matchWinner) {
      // Match over: announce it, then head back to the main menu after a beat
      // (or immediately if they tap the card).
      state = 'ended';
      hud.showAnnounce(undefined);
      hud.showEdge(null);
      hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdown, { gameOver: true, notes: [outcome.note] });
      rolling = false;
      setTimeout(() => { if (state === 'ended') returnToMenu(); }, GAME_OVER_LINGER_MS);
      return;
    }

    prepareRound();
    hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdown, { notes: [outcome.note, announced] });
    rolling = false;
  }

  hud.onQuickGame(() => openDraft());
  hud.onZen(() => hud.showPicker('Zen: choose your dice', ZEN_CARDS,
    (id) => start('zen', id.startsWith('die:') ? { dieType: id.slice(4) } : { diceSet: id })));
  hud.onBack(returnToMenu);

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
    rounds,
    start,
    openDraft,
    /** Spin jitter for the player's throws, from the match's seed. */
    random: () => throwRng.next(),
    // The dice can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    onGrab() {
      // Dice still dropping from a fumble are caught again mid-fall.
      roller.cancel();
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
      if (!rolling) {
        rolling = true;
        if (mode === 'zen') runZenThrow(playerReleases);
        else runRound(playerReleases);
      }
    },
    onBoardTap() {
      if (state === 'playing') hud.hideResult();
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
