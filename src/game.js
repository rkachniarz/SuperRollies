// Match flow: starting a match, throwing, and handing each round's dice to the
// rules engine (rules/engine.js), which decides what they mean. This file only
// turns that into dice on the table and words on the screen.
//
// Quick Game: pick a dice set, then both sides throw their handful, the higher
// score wins the round, and the loser empties a heart. Lose all three and the
// match ends. (A pick from the full list for now; Phase 4 brings the two-card
// draft and Spice.)
//
// Zen: no opponent, no divider, no score - the whole tray, for throwing for
// the sake of it. It's also the testbed: it offers every dice set Quick Game
// does, and every die type on its own (DEV_PLAN.md D18).

import { GAME_OVER_LINGER_MS } from './config.js';
import { randomHandful } from './handful.js';
import { DIE_TYPES } from './die-shapes.js';
import { createRng, deriveSeed, randomSeed } from './rng.js';
import { matchConfig, resolveRules, startMatch, beginRound, playRound } from './rules/engine.js';
import { DICE_SETS, THE_CLASSIC, dieTypes, sum } from './rules/dice-sets.js';

// Every dice set, as the pickers show them.
const DICE_SET_OPTIONS = Object.values(DICE_SETS).map((set) => ({ id: set.id, label: set.name, detail: set.notation }));

// Zen's picker: every dice set, then each die type a set doesn't already
// throw on its own, so every die can be tried alone.
const ZEN_OPTIONS = [
  ...DICE_SET_OPTIONS,
  ...DIE_TYPES
    .filter((type) => !Object.values(DICE_SETS).some((set) => dieTypes(set).join() === type))
    .map((type) => ({ id: `die:${type}`, label: `One ${type}`, detail: `1${type}` })),
];

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
  // What each side throws this match, one entry per die, and at what scale.
  let types = dieTypes(THE_CLASSIC);
  let dieScale = 1;
  // Separate random streams for the AI's throws and for the spin jitter on the
  // player's, so neither can shift the other or the rules' own stream.
  let opponentRng;
  let throwRng;

  function newMatch(seed, diceSet) {
    config = matchConfig({ seed, diceSet });
    rules = resolveRules(config);
    match = startMatch(rules);
    opponentRng = createRng(deriveSeed(seed, 'opponent'));
    throwRng = createRng(deriveSeed(seed, 'throw'));
  }
  newMatch(0);

  /** A throw record from each side's releases (each in its dice's order). */
  function recordFor(releases) {
    const dice = Object.entries(releases).flatMap(([side, list]) => list.map((release, i) => ({
      id: `${side}-${i}`, type: types[i], s: dieScale, ...release,
    })));
    return { v: 1, arenaHalfWidth: arena.arenaHalfWidth, divider: arena.divider, tray: arena.tray, dice };
  }

  /** One side's faces from a finished throw, in its dice's order. */
  const facesOf = (result, side) => result.dice.filter((d) => d.id.startsWith(side + '-')).map((d) => d.face);

  // How Zen totals a throw: the dice set's scorer, or for one die alone, its face.
  let zenScorer = sum;

  /**
   * Starts a match. Both modes play `diceSet` (an id); Zen can instead throw
   * one die of `dieType`. `seed` is for tests: the same seed plays the same
   * match.
   */
  function start(newMode, { seed = randomSeed(), diceSet = THE_CLASSIC.id, dieType } = {}) {
    mode = newMode;
    rolling = false;
    roller.cancel();
    newMatch(seed, diceSet);
    rounds.length = 0;
    const zen = mode === 'zen';
    const alone = zen && dieType;
    if (alone) {
      types = [dieType];
      dieScale = 1;
      zenScorer = sum;
    } else {
      types = dieTypes(rules.diceSet);
      dieScale = rules.diceSet.dieScale;
      zenScorer = rules.diceSet.scorer;
    }
    table.setup({ types, scale: dieScale, tray: alone ? THE_CLASSIC.tray : rules.diceSet.tray, opponent: !zen });
    hud.showBoard(mode);
    if (mode === 'quick') {
      hud.showMatch(rules.winCondition.view(match.win));
      announceRound();
    }
    state = 'playing';
    hud.showResult(types.length > 1 ? 'Pick up your dice and throw them' : 'Pick up your die and throw it', '');
  }

  // Lets the Spice set up the coming round. Vanilla has nothing to say yet;
  // what a Spice announces gets shown once one does (Phase 4).
  function announceRound() {
    ({ state: match } = beginRound(rules, match));
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
    const kept = zenScorer.kept?.(faces) ?? faces.map(() => true);
    const score = zenScorer(faces);
    // The total up top; with several dice, how it was made up below.
    if (faces.length === 1) hud.showResult(`You rolled ${score}`, '');
    else hud.showRound(`You rolled ${score}`, [{ side: 'player', faces, kept, score, labels: zenScorer.labels?.(faces) }]);
    rolling = false;
  }

  async function runRound(playerReleases) {
    // The player's handful comes from the throw gesture; the opponent's is
    // thrown at random from its own half.
    const { offsets, reach } = table.hand;
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

    const breakdown = ['player', 'opponent'].map((side) => ({
      side,
      faces: outcome.faces[side],
      kept: outcome.kept[side],
      score: outcome.scores[side],
      labels: rules.diceSet.scorer.labels?.(outcome.faces[side]),
    }));

    if (outcome.matchWinner) {
      // Match over: announce it, then head back to the main menu after a beat
      // (or immediately if they tap the card).
      state = 'ended';
      hud.showRound(MATCH_HEADLINES[outcome.matchWinner], breakdown, { gameOver: true });
      rolling = false;
      setTimeout(() => { if (state === 'ended') returnToMenu(); }, GAME_OVER_LINGER_MS);
      return;
    }

    announceRound();
    hud.showRound(ROUND_HEADLINES[outcome.winner ?? 'tie'], breakdown);
    rolling = false;
  }

  // Both menu buttons lead to a choice of dice first.
  hud.onQuickGame(() => hud.showPicker('Choose your dice', DICE_SET_OPTIONS,
    (diceSet) => start('quick', { diceSet })));
  hud.onZen(() => hud.showPicker('Zen: choose your dice', ZEN_OPTIONS,
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
    rounds,
    start,
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
