// Everything on top of the 3D view: the match-state display, the message card,
// the match's Dice/Spice label and its rules, the menu, the Quick Game draft and
// Zen's catalogue.
//
// The match state is drawn from whatever the win condition asks for (its
// `view`, see rules/types.js), never from a count kept here: hearts are the
// default, not an assumption (DEV_PLAN.md R3.4).

import { renderCard } from './cards.js';

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
  const draftEl = document.getElementById('draft');
  const draftStepEl = document.getElementById('draftStep');
  const draftTitleEl = document.getElementById('draftTitle');
  const draftChosenEl = document.getElementById('draftChosen');
  const draftCardsEl = document.getElementById('draftCards');
  const draftBackBtn = document.getElementById('draftBack');
  const quickGameBtn = document.getElementById('quickGameBtn');
  const zenBtn = document.getElementById('zenBtn');
  const testBenchBtn = document.getElementById('testBenchBtn');
  const backBtn = document.getElementById('backBtn');
  const matchInfoBtn = document.getElementById('matchInfo');
  const matchInfoDiceEl = document.getElementById('matchInfoDice');
  const matchInfoSpiceEl = document.getElementById('matchInfoSpice');
  const rulesPopupEl = document.getElementById('rulesPopup');
  const rulesCardsEl = document.getElementById('rulesCards');
  const rulesCloseBtn = document.getElementById('rulesClose');
  const announceEl = document.getElementById('announce');
  const opponentHudEl = document.getElementById('opponentHud');
  const youHudEl = document.getElementById('youHud');
  const edgeEls = { player: document.getElementById('youEdge'), opponent: document.getElementById('opponentEdge') };
  const resultEl = document.getElementById('result');
  const resultHeadlineEl = document.getElementById('resultHeadline');
  const resultDetailEl = document.getElementById('resultDetail');
  const menuStatusEl = document.getElementById('menuStatus');

  const rethrowBtn = document.getElementById('rethrowBtn');

  // Each side's row of hearts, and how many of them are currently drawn full.
  const heartRows = {
    player: { container: document.getElementById('youHearts'), fulls: [], left: 0 },
    opponent: { container: document.getElementById('opponentHearts'), fulls: [], left: 0 },
  };
  // Each side's bar (Hit Points, Race to N, Tug of War) and row of marks
  // (failed death saves).
  const meters = { player: document.getElementById('youMeter'), opponent: document.getElementById('opponentMeter') };
  const marks = { player: document.getElementById('youMarks'), opponent: document.getElementById('opponentMarks') };

  // Brings one side's hearts in line with `left` of `max`. A heart that goes
  // from full to empty gets a little "pop and fade" animation, so the loss
  // reads as an event rather than a number quietly changing; a fresh match
  // (all full again) just redraws.
  function showHearts(row, { left, max }) {
    if (row.fulls.length !== max) {
      row.fulls = buildHeartsRow(row.container, max);
      row.left = max;
      // Marathon's six hearts are drawn smaller, to leave the corners free
      // for the back button and the match label on a phone.
      row.container.classList.toggle('many', max > 3);
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

  /**
   * One side's bar: filled `value` of `max`, labelled `text`, in `style`'s
   * look. A drop flashes, like a heart lost.
   */
  function showMeter(el, style, { value, max, text }) {
    const fill = el.querySelector('.meter-fill');
    const before = Number(el.dataset.value ?? value);
    el.className = `meter ${style}`;
    el.dataset.value = String(value);
    fill.style.width = `${(100 * Math.max(0, Math.min(value, max))) / max}%`;
    el.querySelector('.meter-text').textContent = text;
    if (value < before) {
      el.classList.remove('hit');
      void el.offsetWidth; // restart the animation
      el.classList.add('hit');
    }
  }

  /** A row of `max` marks, `count` of them struck (failed death saves). */
  function showMarks(el, mark) {
    el.hidden = !mark;
    if (!mark) return;
    el.title = `${mark.count} of ${mark.max} ${mark.label}`;
    el.setAttribute('aria-label', el.title);
    el.replaceChildren(...Array.from({ length: mark.max }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = i < mark.count ? 'mark struck' : 'mark';
      dot.textContent = i < mark.count ? '💀' : '';
      return dot;
    }));
  }

  /**
   * Draws the match state, as given by the win condition's `view`: hearts,
   * with marks beside them if it brings any, or a bar per side.
   * @param {import('./rules/types.js').MatchView} view
   */
  function showMatch(view) {
    if (view.kind !== 'hearts' && view.kind !== 'bar') throw new Error(`No HUD for match state "${view.kind}"`);
    for (const side of /** @type {const} */ (['player', 'opponent'])) {
      const hearts = view.kind === 'hearts';
      heartRows[side].container.hidden = !hearts;
      meters[side].hidden = hearts;
      if (hearts) showHearts(heartRows[side], view.sides[side]);
      else showMeter(meters[side], view.style, view.sides[side]);
      showMarks(marks[side], hearts ? view.marks?.[side] : undefined);
    }
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
   * die, anything a Spice added or took off, then the total. Dice that didn't
   * count (a dropped lowest, the lower of two under advantage) are greyed
   * out; an exploded die is written `(6+6+2)` and a cursed one struck through,
   * as the round's `dice` say. With one plain die a side there's nothing to
   * break down, so it's just the two rolls. `notes` are extra lines: what the
   * Spice decided (`Boxcars!`), and what it announces for the next round.
   * @param {string} headline
   * @param {{ side: string, dice: import('./rules/types.js').DieTerm[],
   *   adjustments?: import('./rules/types.js').Adjustment[], score: number }[]} sides
   * @param {{ gameOver?: boolean, notes?: (string | undefined)[] }} [options]
   */
  function showRound(headline, sides, { notes = [], ...options } = {}) {
    showResult(headline, '', options);
    const plain = sides.every((s) => s.dice.length === 1 && !s.dice[0].tag && !s.adjustments?.length);
    if (plain) {
      resultDetailEl.textContent = sides.map((s) => `${SIDE_NAMES[s.side]} rolled ${s.score}`).join(' · ');
    } else {
      for (const { side, dice, adjustments = [], score } of sides) {
        const line = document.createElement('span');
        line.className = 'breakdown';
        line.append(`${SIDE_NAMES[side]}: `);
        dice.forEach(({ text, kept, tag }, i) => {
          if (i > 0) line.append(' + ');
          const die = document.createElement('span');
          die.textContent = text;
          const classes = [kept ? '' : 'dropped', tag ?? ''].join(' ').trim();
          if (classes) die.className = classes;
          line.append(die);
        });
        for (const { label, value } of adjustments) {
          const adjustment = document.createElement('span');
          adjustment.className = 'adjustment';
          adjustment.textContent = `${value < 0 ? ' − ' : ' + '}${Math.abs(value)} ${label}`;
          line.append(adjustment);
        }
        line.append(' = ');
        const total = document.createElement('strong');
        total.textContent = String(score);
        line.append(total);
        resultDetailEl.append(line);
      }
    }
    for (const note of notes.filter(Boolean)) {
      const line = document.createElement('span');
      line.className = 'note';
      line.textContent = note;
      resultDetailEl.append(line);
    }
  }

  /**
   * What the Spice announces for the coming round (`Cursed number: 7`), shown
   * for as long as it holds.
   * @param {string | undefined} text
   */
  function showAnnounce(text) {
    announceEl.textContent = text ?? '';
    announceEl.hidden = !text;
  }

  /**
   * Marks the side holding a state-based advantage this round, by its name
   * (R3.5): `You  +1 die`. Both sides can hold one (Second Wind).
   * @param {import('./rules/types.js').Edge | import('./rules/types.js').Edge[] | null} edge
   */
  function showEdge(edge) {
    const edges = edge ? [edge].flat() : [];
    for (const [side, el] of Object.entries(edgeEls)) {
      const held = edges.find((e) => e.side === side);
      el.hidden = !held;
      el.textContent = held ? held.label : '';
    }
  }

  /**
   * Offers the player a re-throw of the round just shown (Second Wind,
   * Mercy): a short `label` for the button, and a `title` saying what it is.
   * null takes the offer away.
   * @param {{ label: string, title: string } | null} offer
   */
  function showRethrow(offer) {
    rethrowBtn.hidden = !offer;
    rethrowBtn.textContent = offer?.label ?? '';
    rethrowBtn.title = offer?.title ?? '';
    if (offer) rethrowBtn.setAttribute('aria-label', offer.title);
  }

  // The cards behind the match label, for its rules popup.
  let matchCards = [];

  /**
   * The match's Dice/Spice label (R1.5): its dice and its Spice, by name.
   * Tapping it shows both cards with their full rules. Without a Spice (Zen)
   * there's no label.
   * @param {import('./cards.js').CardData} dice
   * @param {(import('./cards.js').CardData & { emoji: string }) | null} spice
   */
  function showMatchInfo(dice, spice) {
    matchCards = spice ? [dice, spice] : [];
    // Names only, one line each, so the label stays as small as the back
    // button on a phone; the notation is on the cards it opens.
    matchInfoDiceEl.textContent = dice.name;
    matchInfoSpiceEl.textContent = spice ? `${spice.emoji} ${spice.name}` : '';
    matchInfoBtn.hidden = !spice;
  }

  function showRules() {
    rulesCardsEl.replaceChildren(...matchCards.map((card) => renderCard(card, { full: true })));
    rulesPopupEl.hidden = false;
    rulesCloseBtn.focus();
  }

  function hideRules() {
    rulesPopupEl.hidden = true;
  }

  // Zen has no opponent and no score, so no hearts either.
  function showBoard(mode) {
    menuEl.hidden = true;
    opponentHudEl.hidden = mode === 'zen';
    youHudEl.hidden = mode === 'zen';
    backBtn.hidden = false;
    hideRules();
    showAnnounce(undefined);
    showEdge(null);
    showRethrow(null);
  }

  // The menu is up before the physics engine has finished loading (its
  // WebAssembly takes a moment, longest on a phone), so Quick Game starts
  // disabled and is switched on once it's ready.
  function setLoaded() {
    quickGameBtn.disabled = false;
    zenBtn.disabled = false;
    testBenchBtn.disabled = false;
    quickGameBtn.textContent = 'Quick Game';
  }

  function setLoadFailed() {
    quickGameBtn.textContent = "Couldn't load";
    menuStatusEl.textContent = 'The physics engine failed to load. Check your connection and reload the page.';
    menuStatusEl.hidden = false;
  }

  /** Shows one card of the menu (the main menu, the draft or the catalogue). */
  function showMenuCard(el) {
    for (const card of [menuMainEl, draftEl, pickerEl]) card.hidden = card !== el;
    menuEl.hidden = false;
    menuEl.scrollTop = 0;
  }

  function showMenu() {
    hideResult();
    hideRules();
    showAnnounce(undefined);
    opponentHudEl.hidden = true;
    youHudEl.hidden = true;
    backBtn.hidden = true;
    matchInfoBtn.hidden = true;
    showRethrow(null);
    showMenuCard(menuMainEl);
  }

  // Where the draft's back button goes; each step sets it.
  let draftBack = showMenu;

  /**
   * One step of the Quick Game draft (R1.1, R1.2): a few cards, one to pick.
   * `chosen` recalls what an earlier step picked. Back goes to `onBack`.
   * @param {{ step: string, title: string, chosen?: string, cards: import('./cards.js').CardData[],
   *   onPick: (id: string) => void, onBack: () => void }} options
   */
  function showDraft({ step, title, chosen, cards, onPick, onBack }) {
    draftStepEl.textContent = step;
    draftTitleEl.textContent = title;
    draftChosenEl.textContent = chosen ?? '';
    draftChosenEl.hidden = !chosen;
    draftCardsEl.replaceChildren(...cards.map((card) => renderCard(card, { onPick })));
    draftBack = onBack;
    showMenuCard(draftEl);
    draftCardsEl.querySelector('button')?.focus();
  }

  // Where the catalogue's back button goes: the menu, unless a step says
  // otherwise (the test bench's Spice step goes back to its dice).
  let pickerBack = showMenu;

  /**
   * The catalogue (DEV_PLAN.md 4.3): every card on offer, as a list, one to
   * pick. Zen's picker and the test bench now; the multiplayer host's later
   * (R4.2). Back goes to `onBack`, the menu by default.
   * @param {string} title
   * @param {import('./cards.js').CardData[]} cards
   * @param {(id: string) => void} onPick
   * @param {() => void} [onBack]
   */
  function showPicker(title, cards, onPick, onBack = showMenu) {
    pickerTitleEl.textContent = title;
    pickerOptionsEl.replaceChildren(...cards.map((card) => renderCard(card, { onPick, compact: true })));
    pickerBack = onBack;
    showMenuCard(pickerEl);
    pickerOptionsEl.querySelector('button')?.focus();
  }

  // The test bench is for development only: shown with ?dev in the address.
  testBenchBtn.hidden = !new URLSearchParams(window.location.search).has('dev');

  pickerBackBtn.addEventListener('click', () => pickerBack());
  draftBackBtn.addEventListener('click', () => draftBack());
  matchInfoBtn.addEventListener('click', showRules);
  rulesCloseBtn.addEventListener('click', hideRules);
  // A tap outside the cards closes the popup too, as does Escape.
  rulesPopupEl.addEventListener('click', (e) => { if (e.target === rulesPopupEl) hideRules(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !rulesPopupEl.hidden) hideRules(); });

  return {
    showMatch,
    showResult, showRound, hideResult, showBoard, showMenu, showPicker, showDraft, setLoaded, setLoadFailed,
    showMatchInfo, showAnnounce, showEdge, showRethrow,
    onRethrow(handler) { rethrowBtn.addEventListener('click', handler); },
    onQuickGame(handler) { quickGameBtn.addEventListener('click', handler); },
    onZen(handler) { zenBtn.addEventListener('click', handler); },
    onTestBench(handler) { testBenchBtn.addEventListener('click', handler); },
    onBack(handler) { backBtn.addEventListener('click', handler); },
    onResultClick(handler) { resultEl.addEventListener('click', handler); },
  };
}
