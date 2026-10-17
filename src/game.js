// Match flow: starting a match, throwing, and handing each round's dice to the
// rules engine (rules/engine.js), which decides what they mean. This file only
// turns that into dice on the table and words on the screen.
//
// Quick Game: The Classic (1d20) with Vanilla - both dice are thrown, whoever
// rolls higher wins the round, and the loser empties a heart. Lose all three
// and the match ends.
//
// Zen: no opponent, no divider, no score - one die and the whole tray, for
// throwing for the sake of it.

import { GAME_OVER_LINGER_MS } from './config.js';
import { randomThrow } from './dice.js';
import { createRng, deriveSeed, randomSeed } from './rng.js';
import { matchConfig, resolveRules, startMatch, beginRound, playRound } from './rules/engine.js';
import { dieTypes } from './rules/dice-sets.js';

export function createGame({ hud, roller, arena, setTable }) {
  let state = 'menu'; // 'menu' | 'playing' | 'ended'
  let mode = 'quick'; // 'quick' | 'zen'
  let rolling = false;
  // This match's throw records and outcomes, newest last. Kept so any round can
  // be replayed exactly (see replay.js); the test tools read it from the page.
  // Emptied, not replaced, for each new match, so a reference to it stays good.
  const rounds = [];

  // The match being played: its config, the rules it names, and where it
  // stands. Zen has a config too (for its seed and die type) but no rules state.
  let config;
  let rules;
  let match;
  // Separate random streams for the AI's throws and for the spin jitter on the
  // player's, so neither can shift the other or the rules' own stream.
  let opponentRng;
  let throwRng;

  function newMatch(seed) {
    config = matchConfig({ seed });
    rules = resolveRules(config);
    match = startMatch(rules);
    opponentRng = createRng(deriveSeed(seed, 'opponent'));
    throwRng = createRng(deriveSeed(seed, 'throw'));
  }
  newMatch(0);

  // The type of die each side throws. One per side until Phase 2.
  const dieType = () => dieTypes(rules.diceSet)[0];

  function recordFor(dice) {
    return { v: 1, arenaHalfWidth: arena.arenaHalfWidth, divider: arena.divider, dice };
  }

  function start(newMode, seed = randomSeed()) {
    mode = newMode;
    rolling = false;
    newMatch(seed);
    rounds.length = 0;
    // Dice back to their starting spots, and the divider in or out.
    setTable(mode);
    hud.showBoard(mode);
    if (mode === 'quick') {
      hud.showMatch(rules.winCondition.view(match.win));
      announceRound();
    }
    state = 'playing';
    hud.showResult('Pick up your die and throw it', '');
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

  async function runZenThrow(playerRelease) {
    const record = recordFor([{ id: 'player', type: dieType(), ...playerRelease }]);
    const result = await roller.start(record);
    rounds.push({ record, result });
    hud.showResult(`You rolled ${result.dice[0].face}`, '');
    rolling = false;
  }

  async function runRound(playerRelease) {
    // The player's release comes from the throw gesture; the opponent's die is
    // thrown at random from its own half.
    const opponentRelease = randomThrow(arena.opponentZone(), () => opponentRng.next());
    const record = recordFor([
      { id: 'opponent', type: dieType(), ...opponentRelease },
      { id: 'player', type: dieType(), ...playerRelease },
    ]);
    const result = await roller.start(record);

    const faces = (id) => result.dice.filter((d) => d.id === id).map((d) => d.face);
    let outcome;
    ({ outcome, state: match } = playRound(rules, match, { player: faces('player'), opponent: faces('opponent') }));
    rounds.push({ record, result, outcome });
    hud.showMatch(rules.winCondition.view(match.win));

    const detail = `You rolled ${outcome.scores.player} · Opponent rolled ${outcome.scores.opponent}`;

    if (outcome.matchWinner) {
      // Match over: announce it, then head back to the main menu after a beat
      // (or immediately if they tap the card).
      state = 'ended';
      hud.showResult(MATCH_HEADLINES[outcome.matchWinner], detail, { gameOver: true });
      rolling = false;
      setTimeout(() => { if (state === 'ended') returnToMenu(); }, GAME_OVER_LINGER_MS);
      return;
    }

    announceRound();
    hud.showResult(ROUND_HEADLINES[outcome.winner ?? 'tie'], detail);
    rolling = false;
  }

  hud.onQuickGame(() => start('quick'));
  hud.onZen(() => start('zen'));
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
    // The die can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    onGrab() {
      // A die still dropping from a fumble is caught again mid-fall.
      roller.cancel();
      hud.showResult('Let go to throw', '');
    },
    onFumble(playerRelease, { cancelled = false } = {}) {
      // Let go of it without a throw: it just drops back onto the table. If the
      // browser took the gesture away (cancelled), there's nobody to scold.
      roller.start(recordFor([{ id: 'player', type: dieType(), ...playerRelease }]));
      if (cancelled) hud.hideResult();
      else hud.showResult('Make a proper throw!', 'That was too gentle to count - give it a real toss.');
    },
    onThrow(playerRelease) {
      // Clear the "let go to throw" prompt now that they have - it would
      // otherwise sit there, stale, while the dice settle.
      hud.hideResult();
      if (!rolling) {
        rolling = true;
        if (mode === 'zen') runZenThrow(playerRelease);
        else runRound(playerRelease);
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
