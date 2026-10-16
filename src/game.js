// Match flow: what a round is, what winning and losing one costs, and when the
// match is over.
//
// A round: both dice are thrown, whoever rolls higher wins it, and the loser
// empties a heart (a tie costs nobody one). Lose all three and the match ends.

import { TRAY_DEPTH, TRAY_HALF_WIDTH, SETTLE_TIMEOUT_MS, GAME_OVER_LINGER_MS } from './config.js';
import { readFaceUp, throwDie } from './dice.js';

function waitForSleep(body, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      body.removeEventListener('sleep', onSleep);
      resolve();
    };
    const onSleep = () => finish();
    body.addEventListener('sleep', onSleep);
    setTimeout(finish, timeoutMs);
  });
}

export function createGame({ hud, playerDie, opponentDie }) {
  let state = 'menu'; // 'menu' | 'playing' | 'ended'
  let rolling = false;

  function startQuickGame() {
    hud.resetHearts();
    state = 'playing';
    hud.showBoard();
    hud.showResult('Pick up your die and throw it', '');
  }

  function returnToMenu() {
    state = 'menu';
    hud.showMenu();
  }

  async function runRound() {
    // The player's die already has its velocity set (from the throw gesture) by
    // the time this runs - only the opponent's needs a throw of its own.
    throwDie(opponentDie, -TRAY_DEPTH / 2, -1, { trayHalfWidth: TRAY_HALF_WIDTH, trayDepth: TRAY_DEPTH });

    await Promise.all([
      waitForSleep(opponentDie.body, SETTLE_TIMEOUT_MS),
      waitForSleep(playerDie.body, SETTLE_TIMEOUT_MS),
    ]);
    // Anything that never settled (rare - e.g. balanced on an edge) is forced to
    // a stop, so the game can never soft-lock waiting on physics.
    [opponentDie.body, playerDie.body].forEach((b) => {
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.sleep();
    });

    const opponentRoll = readFaceUp(opponentDie.body);
    const youRoll = readFaceUp(playerDie.body);
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

  hud.onQuickGame(startQuickGame);

  // The match-over card is the one that takes pointer events, so tapping it
  // heads straight back to the menu instead of waiting out the timer.
  hud.onResultClick(() => {
    if (state === 'ended') returnToMenu();
    else hud.hideResult();
  });

  return {
    get state() { return state; },
    // The die can only be picked up between rounds of a match in progress.
    canGrab: () => state === 'playing' && !rolling,
    onGrab() {
      hud.showResult('Let go to throw', '');
    },
    onFumble() {
      hud.showResult('Make a proper throw!', 'That was too gentle to count - give it a real toss.');
    },
    onThrow() {
      // Clear the "let go to throw" prompt now that they have - it would
      // otherwise sit there, stale, while the dice settle.
      hud.hideResult();
      if (!rolling) {
        rolling = true;
        runRound();
      }
    },
    onBoardTap() {
      if (state === 'playing') hud.hideResult();
    },
  };
}
