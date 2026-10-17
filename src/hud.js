// Everything on top of the 3D view: the match-state display, the message card,
// the menu and its pickers.
//
// The match state is drawn from whatever the win condition asks for (its
// `view`, see rules/types.js), never from a count kept here: hearts are the
// default, not an assumption (DEV_PLAN.md R3.4).

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

function buildHeartsRow(container, count) {
  container.innerHTML = '';
  const fulls = [];
  for (let i = 0; i < count; i++) {
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
  const menuMainEl = document.getElementById('menuMain');
  const pickerEl = document.getElementById('picker');
  const pickerTitleEl = document.getElementById('pickerTitle');
  const pickerOptionsEl = document.getElementById('pickerOptions');
  const pickerBackBtn = document.getElementById('pickerBack');
  const quickGameBtn = document.getElementById('quickGameBtn');
  const zenBtn = document.getElementById('zenBtn');
  const backBtn = document.getElementById('backBtn');
  const opponentHudEl = document.getElementById('opponentHud');
  const youHudEl = document.getElementById('youHud');
  const resultEl = document.getElementById('result');
  const resultHeadlineEl = document.getElementById('resultHeadline');
  const resultDetailEl = document.getElementById('resultDetail');
  const menuStatusEl = document.getElementById('menuStatus');

  // Each side's row of hearts, and how many of them are currently drawn full.
  const heartRows = {
    player: { container: document.getElementById('youHearts'), fulls: [], left: 0 },
    opponent: { container: document.getElementById('opponentHearts'), fulls: [], left: 0 },
  };

  // Brings one side's hearts in line with `left` of `max`. A heart that goes
  // from full to empty gets a little "pop and fade" animation, so the loss
  // reads as an event rather than a number quietly changing; a fresh match
  // (all full again) just redraws.
  function showHearts(row, { left, max }) {
    if (row.fulls.length !== max) {
      row.fulls = buildHeartsRow(row.container, max);
      row.left = max;
    }
    row.fulls.forEach((el, i) => {
      if (i < left) {
        el.classList.remove('losing', 'empty');
      } else if (i < row.left) {
        el.classList.add('losing');
        el.addEventListener('animationend', () => {
          el.classList.remove('losing');
          el.classList.add('empty');
        }, { once: true });
      }
    });
    row.left = left;
  }

  /** Draws the match state, as given by the win condition's `view`. */
  function showMatch(view) {
    if (view.kind !== 'hearts') throw new Error(`No HUD for match state "${view.kind}"`);
    showHearts(heartRows.player, view.sides.player);
    showHearts(heartRows.opponent, view.sides.opponent);
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

  const SIDE_NAMES = { player: 'You', opponent: 'Opponent' };

  /**
   * A round's result, with how each side's score was made up (R2.5): every
   * die, then the total, with dice that didn't count (a dropped lowest, the
   * lower of two under advantage) greyed out. With one die a side there's
   * nothing to break down, so it's just the two rolls.
   * @param {{ side: string, faces: number[], kept: boolean[], score: number }[]} sides
   */
  function showRound(headline, sides, options) {
    showResult(headline, '', options);
    if (sides.every((s) => s.faces.length === 1)) {
      resultDetailEl.textContent = sides.map((s) => `${SIDE_NAMES[s.side]} rolled ${s.score}`).join(' · ');
      return;
    }
    for (const { side, faces, kept, score } of sides) {
      const line = document.createElement('span');
      line.className = 'breakdown';
      line.append(`${SIDE_NAMES[side]}: `);
      faces.forEach((face, i) => {
        if (i > 0) line.append(' + ');
        const die = document.createElement('span');
        die.textContent = String(face);
        if (!kept[i]) die.className = 'dropped';
        line.append(die);
      });
      line.append(' = ');
      const total = document.createElement('strong');
      total.textContent = String(score);
      line.append(total);
      resultDetailEl.append(line);
    }
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
    pickerEl.hidden = true;
    menuMainEl.hidden = false;
    menuEl.hidden = false;
  }

  /**
   * Swaps the menu for a list of choices, one button each; `onPick` gets the
   * chosen one's id. Back returns to the menu.
   * @param {string} title
   * @param {{ id: string, label: string, detail?: string }[]} options
   * @param {(id: string) => void} onPick
   */
  function showPicker(title, options, onPick) {
    pickerTitleEl.textContent = title;
    pickerOptionsEl.replaceChildren(...options.map(({ id, label, detail }) => {
      const btn = document.createElement('button');
      btn.className = 'pick-btn';
      btn.dataset.pick = id;
      btn.textContent = label;
      if (detail) {
        const small = document.createElement('small');
        small.textContent = detail;
        btn.append(small);
      }
      btn.addEventListener('click', () => onPick(id));
      return btn;
    }));
    menuMainEl.hidden = true;
    pickerEl.hidden = false;
    pickerOptionsEl.querySelector('button')?.focus();
  }

  pickerBackBtn.addEventListener('click', showMenu);

  return {
    showMatch,
    showResult, showRound, hideResult, showBoard, showMenu, showPicker, setLoaded, setLoadFailed,
    onQuickGame(handler) { quickGameBtn.addEventListener('click', handler); },
    onZen(handler) { zenBtn.addEventListener('click', handler); },
    onBack(handler) { backBtn.addEventListener('click', handler); },
    onResultClick(handler) { resultEl.addEventListener('click', handler); },
  };
}
