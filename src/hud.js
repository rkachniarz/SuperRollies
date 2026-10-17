// Everything on top of the 3D view: the hearts, the message card, the menu.

import { HEARTS_PER_SIDE } from './config.js';

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

function buildHeartsRow(container) {
  container.innerHTML = '';
  const fulls = [];
  for (let i = 0; i < HEARTS_PER_SIDE; i++) {
    const wrap = document.createElement('span');
    wrap.className = 'heart';
    wrap.innerHTML =
      `<svg class="heart-empty" viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="none" stroke="rgba(245,241,255,0.35)" stroke-width="1.6"/></svg>` +
      `<svg class="heart-full" viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="#ff5470"/></svg>`;
    container.appendChild(wrap);
    fulls.push(wrap.querySelector('.heart-full'));
  }
  return fulls;
}

export function createHud() {
  const menuEl = document.getElementById('menu');
  const quickGameBtn = document.getElementById('quickGameBtn');
  const zenBtn = document.getElementById('zenBtn');
  const backBtn = document.getElementById('backBtn');
  const opponentHudEl = document.getElementById('opponentHud');
  const youHudEl = document.getElementById('youHud');
  const resultEl = document.getElementById('result');
  const resultHeadlineEl = document.getElementById('resultHeadline');
  const resultDetailEl = document.getElementById('resultDetail');
  const menuStatusEl = document.getElementById('menuStatus');

  const opponentHeartEls = buildHeartsRow(document.getElementById('opponentHearts'));
  const youHeartEls = buildHeartsRow(document.getElementById('youHearts'));

  // Each side starts a match with 3 full hearts. Losing a round empties one,
  // with a little "pop and fade" animation so the loss reads as an event rather
  // than a number quietly changing.
  const hearts = { you: HEARTS_PER_SIDE, opponent: HEARTS_PER_SIDE };

  function resetHearts() {
    hearts.you = HEARTS_PER_SIDE;
    hearts.opponent = HEARTS_PER_SIDE;
    youHeartEls.concat(opponentHeartEls).forEach((el) => el.classList.remove('losing', 'empty'));
  }

  // Empties the next still-full heart (rightmost-full one) for the given side
  // and returns how many that side has left.
  function loseHeart(side) {
    const els = side === 'you' ? youHeartEls : opponentHeartEls;
    hearts[side] = Math.max(0, hearts[side] - 1);
    const el = els[hearts[side]];
    if (el) {
      el.classList.add('losing');
      el.addEventListener('animationend', () => {
        el.classList.remove('losing');
        el.classList.add('empty');
      }, { once: true });
    }
    return hearts[side];
  }

  function showResult(headline, detail, { gameOver = false } = {}) {
    resultHeadlineEl.textContent = headline;
    resultDetailEl.textContent = detail || '';
    resultEl.classList.toggle('game-over', gameOver);
    resultEl.classList.add('show');
  }

  function hideResult() {
    resultEl.classList.remove('show', 'game-over');
  }

  // Zen has no opponent and no score, so no hearts either.
  function showBoard(mode) {
    menuEl.hidden = true;
    opponentHudEl.hidden = mode === 'zen';
    youHudEl.hidden = mode === 'zen';
    backBtn.hidden = false;
  }

  // The menu is up before the physics engine has finished loading (its
  // WebAssembly takes a moment, longest on a phone), so Quick Game starts
  // disabled and is switched on once it's ready.
  function setLoaded() {
    quickGameBtn.disabled = false;
    zenBtn.disabled = false;
    quickGameBtn.textContent = 'Quick Game';
  }

  function setLoadFailed() {
    quickGameBtn.textContent = "Couldn't load";
    menuStatusEl.textContent = 'The physics engine failed to load. Check your connection and reload the page.';
    menuStatusEl.hidden = false;
  }

  function showMenu() {
    hideResult();
    opponentHudEl.hidden = true;
    youHudEl.hidden = true;
    backBtn.hidden = true;
    menuEl.hidden = false;
  }

  return {
    hearts, resetHearts, loseHeart,
    showResult, hideResult, showBoard, showMenu, setLoaded, setLoadFailed,
    onQuickGame(handler) { quickGameBtn.addEventListener('click', handler); },
    onZen(handler) { zenBtn.addEventListener('click', handler); },
    onBack(handler) { backBtn.addEventListener('click', handler); },
    onResultClick(handler) { resultEl.addEventListener('click', handler); },
  };
}
