// Match flow: what a round is, what winning and losing one costs, and when the
// match is over.
//
// Quick Game: both dice are thrown, whoever rolls higher wins the round, and
// the loser empties a heart (a tie costs nobody one). Lose all three and the
// match ends.
//
// Zen: no opponent, no divider, no score - one die and the whole tray, for
// throwing for the sake of it.

import { TRAY_DEPTH, TRAY_HALF_WIDTH, GAME_OVER_LINGER_MS } from './config.js';
import { randomThrow } from './dice.js';

export function createGame({ hud, roller, arena, setTable }) {
  let state = 'menu'; // 'menu' | 'playing' | 'ended'
  let mode = 'quick'; // 'quick' | 'zen'
  let rolling = false;
  // Every round's throw record and outcome, newest last. Kept so any round can
  // be replayed exactly (see replay.js); the test tools read it from the page.
  const rounds = [];

  function recordFor(dice) {
    return { v: 1, arenaHalfWidth: arena.arenaHalfWidth, divider: arena.divider, dice };
  }

  function start(newMode) {
    mode = newMode;
    rolling = false;
    // Dice back to their starting spots, and the divider in or out.
    setTable(mode);
    hud.resetHearts();
    state = 'playing';
    hud.showBoard(mode);
    hud.showResult('Pick up your die and throw it', '');
  }

  function returnToMenu() {
    // Leaving mid-throw just abandons it; the next match resets the table.
    roller.cancel();
    rolling = false;
    state = 'menu';
    hud.showMenu();
  }

  async function runZenThrow(playerRelease) {
    const record = recordFor([{ id: 'player', type: 'd20', ...playerRelease }]);
    const result = await roller.start(record);
    rounds.push({ record, result });
    hud.showResult(`You rolled ${result.dice[0].face}`, '');
    rolling = false;
  }

  async function runRound(playerRelease) {
    // The player's release comes from the throw gesture; the opponent's die is
    // thrown at random from its own half.
    const record = recordFor([
      { id: 'opponent', type: 'd20', ...randomThrow(-TRAY_DEPTH / 2, -1, { trayHalfWidth: TRAY_HALF_WIDTH, trayDepth: TRAY_DEPTH }) },
      { id: 'player', type: 'd20', ...playerRelease },
    ]);
    const result = await roller.start(record);
    rounds.push({ record, result });

    const face = (id) => result.dice.find((d) => d.id === id).face;
    const opponentRoll = face('opponent');
    const youRoll = face('player');
    const detail = `You rolled ${youRoll} · Opponent rolled ${opponentRoll}`;

    let headline;
    let loserSide = null;
    if (youRoll > opponentRoll) {
      headline = 'You win!';
      loserSide = 'opponent';
    } else if (youRoll < opponentRoll) {
      headline = 'You lose.';
      loserSide = 'you';
    } else {
      headline = "It's a tie!";
    }

    if (loserSide) {
      const remaining = hud.loseHeart(loserSide);
      if (remaining <= 0) {
        // Match over: announce it, then head back to the main menu after a beat
        // (or immediately if they tap the card).
        state = 'ended';
        hud.showResult(
          loserSide === 'you' ? 'You lose the game' : 'You win the game',
          detail,
          { gameOver: true }
        );
        rolling = false;
        setTimeout(() => { if (state === 'ended') returnToMenu(); }, GAME_OVER_LINGER_MS);
        return;
      }
    }

    hud.showResult(headline, detail);
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
    rounds,
    // The die can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    onGrab() {
      // A die still dropping from a fumble is caught again mid-fall.
      roller.cancel();
      hud.showResult('Let go to throw', '');
    },
    onFumble(playerRelease) {
      // Let go of it without a throw: it just drops back onto the table.
      roller.start(recordFor([{ id: 'player', type: 'd20', ...playerRelease }]));
      hud.showResult('Make a proper throw!', 'That was too gentle to count - give it a real toss.');
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
