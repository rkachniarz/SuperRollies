// Everything on top of the 3D view: each side's card with its match state, the
// message card, the match's Dice/Spice label and its rules, the menu, the
// player editor, the Quick Game draft and Zen's catalogue.
//
// The match state is drawn from whatever the win condition asks for (its
// `view`, see rules/types.js), never from a count kept here: hearts are the
// default, not an assumption (docs/spec.md R3.4).

import { renderCard } from './cards.js';
import { CARD_COLORS, TRAY_COLORS, DICE_COLORS } from './config.js';
import { NAME_MAX, nameLength, limitName, cleanName, looksOf } from './profile.js';

/** A colour as config.js gives it (a number or a CSS string), for CSS. */
const css = (color) => (typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color);

// How small a long name may shrink before it's cut short instead.
const NAME_MIN_PX = 12;

/**
 * Shrinks a card's name until it fits its card, down to NAME_MIN_PX; past
 * that, it's cut short with an ellipsis (styles.css). Starts from the size
 * the stylesheet gives it, so it grows back when there's room again.
 * @param {HTMLElement} el
 */
function fitName(el) {
  el.style.fontSize = '';
  if (!el.clientWidth) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > NAME_MIN_PX) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

function buildHeartsRow(container, count) {
  container.innerHTML = '';
  const fulls = [];
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('span');
    wrap.className = 'heart';
    wrap.innerHTML =
      `<svg class="heart-empty" viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="none" stroke="rgba(27,23,18,0.4)" stroke-width="1.6"/></svg>` +
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
  const editorEl = document.getElementById('editor');
  const editBtn = document.getElementById('editBtn');
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
  const statusEl = document.getElementById('netStatus');
  const opponentHudEl = document.getElementById('opponentHud');
  const youHudEl = document.getElementById('youHud');
  const edgeEls = { player: document.getElementById('youEdge'), opponent: document.getElementById('opponentEdge') };
  const resultEl = document.getElementById('result');
  const resultHeadlineEl = document.getElementById('resultHeadline');
  const resultDetailEl = document.getElementById('resultDetail');
  const menuStatusEl = document.getElementById('menuStatus');

  const rethrowBtn = document.getElementById('rethrowBtn');

  // Each side's card in a match (R6.4), the player's on the menu, and the
  // editor's copy of it.
  const cards = {
    player: { card: document.getElementById('youCard'), name: document.getElementById('youName') },
    opponent: { card: document.getElementById('opponentCard'), name: document.getElementById('opponentName') },
    menu: { card: document.getElementById('menuCard'), name: document.getElementById('menuName'), look: document.getElementById('menuLook') },
    editor: { card: document.getElementById('editorCard'), name: document.getElementById('editorCardName'), look: document.getElementById('editorLook') },
    // The multiplayer room's two (net/lobby.js): this player's, and the other's.
    me: { card: document.getElementById('netMeCard'), name: document.getElementById('netMeName'), look: document.getElementById('netMeLook') },
    them: { card: document.getElementById('netThemCard'), name: document.getElementById('netThemName'), look: document.getElementById('netThemLook') },
  };

  /**
   * Draws a card for `looks` (looksOf in profile.js): its background and
   * name, and where it has one, a chip of its tray and dice colours.
   */
  function paintCard({ card, name, look }, looks) {
    card.style.setProperty('--card', looks.card);
    name.textContent = looks.name;
    if (look) {
      look.style.setProperty('--tray', css(looks.tray));
      look.style.setProperty('--die', css(looks.dice.body));
      look.style.setProperty('--pip', css(looks.dice.number));
    }
    fitName(name);
  }

  function fitNames() {
    for (const { name } of Object.values(cards)) fitName(name);
  }
  window.addEventListener('resize', fitNames);
  // The names' font arrives after the page: fit them again once it has.
  document.fonts?.ready.then(fitNames);

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

  /**
   * A row of `max` marks, `count` of them struck with the mark's icon
   * (failed death saves, dice burnt out).
   */
  function showMarks(el, mark) {
    el.hidden = !mark;
    if (!mark) return;
    el.title = `${mark.count} of ${mark.max} ${mark.label}`;
    el.setAttribute('aria-label', el.title);
    el.replaceChildren(...Array.from({ length: mark.max }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = i < mark.count ? 'mark struck' : 'mark';
      dot.textContent = i < mark.count ? mark.icon ?? '💀' : '';
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

  /** What the opponent is called on the card: their name in multiplayer, or null for "Opponent". */
  function setOpponentName(name) {
    SIDE_NAMES.opponent = name ?? 'Opponent';
  }

  /**
   * A round's result, with how each side's score was made up (R2.5): every
   * die, anything a Spice added or took off, then the total. Dice that didn't
   * count (a dropped lowest, the lower of two under advantage) are greyed
   * out; an exploded die is written `(6+6+2)` and a cursed one struck through,
   * as the round's `dice` say. With one plain die a side there's nothing to
   * break down, so it's just the two rolls. A score with a name (a poker
   * hand, `2 sixes`) isn't a sum, so its dice are listed rather than added
   * up, and it's the name that's written as the result. `notes` are extra
   * lines: what the Spice decided (`Boxcars!`), and what it announces for
   * the next round.
   * @param {string} headline
   * @param {{ side: string, dice: import('./rules/types.js').DieTerm[],
   *   adjustments?: import('./rules/types.js').Adjustment[], score: number, named?: string }[]} sides
   * @param {{ gameOver?: boolean, notes?: (string | undefined)[] }} [options]
   */
  function showRound(headline, sides, { notes = [], ...options } = {}) {
    showResult(headline, '', options);
    const plain = sides.every((s) => s.dice.length === 1 && !s.dice[0].tag && !s.adjustments?.length);
    if (plain) {
      resultDetailEl.textContent = sides.map((s) => `${SIDE_NAMES[s.side]} rolled ${s.score}`).join(' · ');
    } else {
      for (const { side, dice, adjustments = [], score, named } of sides) {
        const line = document.createElement('span');
        line.className = 'breakdown';
        line.append(`${SIDE_NAMES[side]}: `);
        dice.forEach(({ text, kept, tag }, i) => {
          if (i > 0) line.append(named ? ' · ' : ' + ');
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
        total.textContent = named ?? String(score);
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
   * for as long as it holds. A stack's announcements are a line each.
   * @param {string | undefined} text
   */
  function showAnnounce(text) {
    announceEl.textContent = text ?? '';
    announceEl.hidden = !text;
  }

  /**
   * A multiplayer match's clock (docs/decisions.md D48): this player's time
   * left to throw, or who's being waited on. null takes it away.
   * @param {string | null} text
   */
  function showStatus(text) {
    statusEl.textContent = text ?? '';
    statusEl.hidden = !text;
  }

  /**
   * Marks the side holding a state-based advantage this round, by its name
   * (R3.5): `You  +1 die`. Both sides can hold one (Second Wind).
   * @param {import('./rules/types.js').Edge | import('./rules/types.js').Edge[] | null} edge
   */
  function showEdge(edge) {
    const edges = edge ? [edge].flat() : [];
    for (const [side, el] of Object.entries(edgeEls)) {
      // A Spice stack can give a side several at once (D51): one line, cut short.
      const held = edges.filter((e) => e.side === side).map((e) => e.label).join(' · ');
      el.hidden = !held;
      el.textContent = held;
      el.title = held;
    }
  }

  /**
   * Offers the player a re-throw of the round just shown (Second Wind,
   * Mercy), or to keep all their dice rather than throw some again (Draw
   * Poker): a short `label` for the button, and a `title` saying what it is.
   * null takes the offer away. `dice` says where the dice lie on screen
   * (table.onScreen), for placeRethrow to keep the button off them.
   * @param {{ label: string, title: string } | null} offer
   * @param {() => { x: number, y: number, r: number }[]} [dice]
   */
  function showRethrow(offer, dice = () => []) {
    rethrowBtn.hidden = !offer;
    rethrowBtn.textContent = offer?.label ?? '';
    rethrowBtn.title = offer?.title ?? '';
    if (offer) rethrowBtn.setAttribute('aria-label', offer.title);
    rethrowDice = offer ? dice : null;
    placeRethrow();
  }

  let rethrowDice = null;

  /**
   * Puts the re-throw button right under the result card, where the eye
   * already is - unless a die lies there: a die under a button can't be
   * picked up, and the tap meant for it would spend the re-throw (docs/history.md
   * 4.6a). Then the next spot along that's clear: under the card's left or
   * right edge, a row lower, or above it. If none is, its own corner,
   * bottom-right, below the tray on every screen shape.
   */
  function placeRethrow() {
    const style = rethrowBtn.style;
    for (const side of ['left', 'top', 'right', 'bottom']) style[side] = '';
    if (rethrowBtn.hidden || !rethrowDice || !resultEl.classList.contains('show')) return;
    const card = resultEl.getBoundingClientRect();
    const w = rethrowBtn.offsetWidth;
    const h = rethrowBtn.offsetHeight;
    const gap = 10;
    const xs = [card.left + (card.width - w) / 2, card.left, card.right - w];
    const ys = [card.bottom + gap, card.bottom + 2 * gap + h, card.top - gap - h];
    const corners = [backBtn, matchInfoBtn].filter((el) => !el.hidden).map((el) => el.getBoundingClientRect());
    const dice = rethrowDice();
    const clear = (x, y) => x >= gap && y >= gap && x + w <= window.innerWidth - gap && y + h <= window.innerHeight - gap &&
      dice.every((d) => {
        const dx = Math.max(x - d.x, 0, d.x - (x + w));
        const dy = Math.max(y - d.y, 0, d.y - (y + h));
        return dx * dx + dy * dy > (d.r + gap) * (d.r + gap);
      }) &&
      corners.every((c) => x + w < c.left || x > c.right || y + h < c.top || y > c.bottom);
    for (const y of ys) {
      for (const x of xs) {
        if (!clear(x, y)) continue;
        Object.assign(style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
        return;
      }
    }
  }
  window.addEventListener('resize', placeRethrow);

  // The cards behind the match label, for its rules popup.
  let matchCards = [];

  /**
   * The match's Dice/Spice label (R1.5): its dice and its Spice, by name.
   * Tapping it shows every card with its full rules. Without a Spice (Zen)
   * there's no label.
   * @param {import('./cards.js').CardData} dice
   * @param {(import('./cards.js').CardData & { emoji: string })[] | null} spices  A stack (D51).
   */
  function showMatchInfo(dice, spices) {
    matchCards = spices ? [dice, ...spices] : [];
    // Names only, one line each, so the label stays as small as the back
    // button on a phone; the notation is on the cards it opens. A stack is
    // its icons and how many: names would be cut short at once.
    matchInfoDiceEl.textContent = dice.name;
    matchInfoSpiceEl.textContent = !spices ? ''
      : spices.length === 1 ? `${spices[0].emoji} ${spices[0].name}`
        : `${spices.map((s) => s.emoji).join('')} ${spices.length} Spice`;
    matchInfoBtn.hidden = !spices;
  }

  function showRules() {
    rulesCardsEl.replaceChildren(...matchCards.map((card) => renderCard(card, { full: true })));
    rulesPopupEl.hidden = false;
    rulesCloseBtn.focus();
  }

  function hideRules() {
    rulesPopupEl.hidden = true;
  }

  // Zen has no opponent and no score, so no hearts either: the player's card
  // shows only their name.
  function showBoard(mode) {
    menuEl.hidden = true;
    showStatus(null);
    opponentHudEl.hidden = mode === 'zen';
    youHudEl.hidden = false;
    youHudEl.classList.toggle('name-only', mode === 'zen');
    fitNames();
    backBtn.hidden = false;
    hideRules();
    showAnnounce(undefined);
    showEdge(null);
    showRethrow(null);
  }

  // Waiting for the physics engine (onLoaded).
  let loaded = false;
  const whenLoaded = [];

  // The menu is up before the physics engine has finished loading (its
  // WebAssembly takes a moment, longest on a phone), so Quick Game starts
  // disabled and is switched on once it's ready.
  function setLoaded() {
    loaded = true;
    for (const fn of whenLoaded.splice(0)) fn();
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

  // Where the back button of the menu card on screen goes (the draft's or the
  // catalogue's): the menu, unless that card's step says otherwise.
  let menuBack = showMenu;

  /**
   * Shows one card of the menu (the main menu, the draft or the catalogue),
   * its back button going to `onBack`.
   */
  function showMenuCard(el, onBack = showMenu) {
    menuBack = onBack;
    // Every card of the menu, the multiplayer ones (net/lobby.js) too.
    for (const card of menuEl.querySelectorAll(':scope > .menu-card')) card.hidden = card !== el;
    // The editor lets the table show through, to show off the colours picked.
    menuEl.classList.toggle('editing', el === editorEl);
    menuEl.hidden = false;
    menuEl.scrollTop = 0;
    fitNames();
  }

  /**
   * Draws each side's card for the match about to start: `player` and
   * `opponent` are their looks (looksOf in profile.js); Zen has no opponent.
   */
  function showPlayers({ player, opponent }) {
    paintCard(cards.player, player);
    if (opponent) paintCard(cards.opponent, opponent);
  }

  /** Draws one of the multiplayer room's cards, `'me'` or `'them'`, for `looks`. */
  function showRoomPlayer(which, looks) {
    paintCard(cards[which], looks);
  }

  /** Draws the player's card on the menu. */
  function showMenuPlayer(looks) {
    paintCard(cards.menu, looks);
  }

  // ---------- The player editor (R6.8) ----------
  const editorNameEl = /** @type {HTMLInputElement} */ (document.getElementById('editorName'));
  const editorCountEl = document.getElementById('editorCount');
  const swatchRows = {
    card: { el: document.getElementById('editorCards'), list: CARD_COLORS },
    tray: { el: document.getElementById('editorTrays'), list: TRAY_COLORS },
    dice: { el: document.getElementById('editorDice'), list: DICE_COLORS },
  };
  // The profile being edited, and where its changes go; null when closed.
  let editing = null;

  // One row of swatches, one per choice: the card's colour, a patch of the
  // tray, or a die face with a pip in its numerals' colour.
  for (const [key, { el, list }] of Object.entries(swatchRows)) {
    el.replaceChildren(...list.map((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swatch swatch-${key}`;
      btn.dataset.choice = choice.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', choice.name);
      btn.title = choice.name;
      if (key === 'dice') {
        btn.style.setProperty('--die', css(choice.body));
        btn.style.setProperty('--die-edge', css(choice.edge));
        btn.style.setProperty('--pip', css(choice.number));
        btn.append(Object.assign(document.createElement('span'), { className: 'swatch-pip' }));
      } else {
        btn.style.setProperty('--swatch', css(choice.color));
      }
      btn.addEventListener('click', () => {
        if (!editing) return;
        editing.profile[key] = choice.id;
        showEdits();
      });
      return btn;
    }));
  }

  editorNameEl.addEventListener('input', () => {
    if (!editing) return;
    const limited = limitName(editorNameEl.value);
    if (limited !== editorNameEl.value) editorNameEl.value = limited;
    editing.profile.name = limited;
    showEdits();
  });
  editorNameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') editorNameEl.blur(); });

  // Brings the editor in line with the profile being edited, and passes it
  // on, for the table to show it off.
  function showEdits() {
    const { profile, onChange } = editing;
    editorCountEl.textContent = `${nameLength(profile.name)}/${NAME_MAX}`;
    paintCard(cards.editor, looksOf({ ...profile, name: cleanName(profile.name) }));
    for (const [key, { el }] of Object.entries(swatchRows)) {
      for (const btn of el.children) btn.setAttribute('aria-checked', String(btn.dataset.choice === profile[key]));
    }
    onChange({ ...profile });
  }

  /**
   * Opens the player editor on `profile`. Every change is passed to
   * `onChange` (to show it on the table); Save hands the profile to `onSave`,
   * Back drops it.
   * @param {import('./profile.js').Profile} profile
   * @param {{ onChange: (p: import('./profile.js').Profile) => void,
   *   onSave: (p: import('./profile.js').Profile) => void, onBack: () => void }} handlers
   */
  function showEditor(profile, { onChange, onSave, onBack }) {
    editing = { profile: { ...profile }, onChange, onSave };
    editorNameEl.value = profile.name;
    showMenuCard(editorEl, () => { editing = null; onBack(); });
    showEdits();
  }
  document.getElementById('editorBack').addEventListener('click', () => menuBack());
  document.getElementById('editorSave').addEventListener('click', () => {
    if (!editing) return;
    const { profile, onSave } = editing;
    editing = null;
    onSave(profile);
  });

  function showMenu() {
    hideResult();
    hideRules();
    showAnnounce(undefined);
    showStatus(null);
    opponentHudEl.hidden = true;
    youHudEl.hidden = true;
    backBtn.hidden = true;
    matchInfoBtn.hidden = true;
    showRethrow(null);
    showMenuCard(menuMainEl);
  }

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
    showMenuCard(draftEl, onBack);
    draftCardsEl.querySelector('button')?.focus();
  }

  /**
   * The catalogue (docs/history.md 4.3): every card on offer, as a list, one to
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
    showMenuCard(pickerEl, onBack);
    pickerOptionsEl.querySelector('button')?.focus();
  }

  /**
   * A Spice stack to pick (D51): the catalogue's list, any number of cards
   * toggled on, then Start. A card that clashes with one picked is greyed
   * out, and says why (`clash(picked, id)`, a reason or null), on the card
   * itself, so it reads on a phone too. `deal`, if given, offers "Deal
   * again", which picks a fresh stack (the multiplayer host's default, Q10).
   * @param {{ title: string, cards: import('./cards.js').CardData[], picked?: string[],
   *   clash: (picked: string[], id: string) => string | null, start: string,
   *   onStart: (ids: string[]) => void, onBack?: () => void, deal?: () => string[] }} options
   */
  function showStackPicker({ title, cards, picked = [], clash, start, onStart, onBack = showMenu, deal }) {
    let chosen = [...picked];
    pickerTitleEl.textContent = title;
    const bar = document.createElement('div');
    bar.className = 'stack-bar';
    const startBtn = document.createElement('button');
    startBtn.className = 'menu-btn';
    startBtn.id = 'stackStart';
    const dealBtn = document.createElement('button');
    dealBtn.className = 'menu-btn secondary';
    dealBtn.id = 'stackDeal';
    dealBtn.textContent = 'Deal again';
    dealBtn.hidden = !deal;
    bar.append(startBtn, dealBtn);
    const els = cards.map((card) => {
      const el = renderCard(card, { compact: true, onPick: (id) => {
        chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
        refresh();
      } });
      const why = document.createElement('div');
      why.className = 'card-why';
      el.append(why);
      return el;
    });
    function refresh() {
      for (const el of els) {
        const { pick: id } = el.dataset;
        const on = chosen.includes(id);
        const reason = on ? null : clash(chosen, id);
        el.classList.toggle('chosen', on);
        el.setAttribute('aria-pressed', String(on));
        /** @type {HTMLButtonElement} */ (el).disabled = Boolean(reason);
        el.querySelector('.card-why').textContent = reason ?? '';
      }
      startBtn.textContent = chosen.length ? `${start}: ${chosen.length} Spice` : `${start}: no Spice`;
    }
    startBtn.addEventListener('click', () => onStart(cards.map((c) => c.id).filter((id) => chosen.includes(id))));
    dealBtn.addEventListener('click', () => { chosen = deal(); refresh(); });
    refresh();
    pickerOptionsEl.replaceChildren(bar, ...els);
    showMenuCard(pickerEl, onBack);
    startBtn.focus();
  }

  // The test bench is for development only: shown with ?dev in the address.
  testBenchBtn.hidden = !new URLSearchParams(window.location.search).has('dev');

  for (const btn of [pickerBackBtn, draftBackBtn]) btn.addEventListener('click', () => menuBack());
  matchInfoBtn.addEventListener('click', showRules);
  rulesCloseBtn.addEventListener('click', hideRules);
  // A tap outside the cards closes the popup too, as does Escape.
  rulesPopupEl.addEventListener('click', (e) => { if (e.target === rulesPopupEl) hideRules(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !rulesPopupEl.hidden) hideRules(); });

  return {
    showMatch,
    showResult, showRound, hideResult, showBoard, showMenu, showPicker, showStackPicker, showDraft, setLoaded, setLoadFailed,
    showMatchInfo, showAnnounce, showEdge, showRethrow, showPlayers, showMenuPlayer, showEditor,
    showStatus, setOpponentName, showMenuCard, showRoomPlayer,
    onEditPlayer(handler) { editBtn.addEventListener('click', handler); },
    /** Calls `fn` once the physics engine has loaded (now, if it has). */
    onLoaded(fn) { if (loaded) fn(); else whenLoaded.push(fn); },
    onRethrow(handler) { rethrowBtn.addEventListener('click', handler); },
    onQuickGame(handler) { quickGameBtn.addEventListener('click', handler); },
    onZen(handler) { zenBtn.addEventListener('click', handler); },
    onTestBench(handler) { testBenchBtn.addEventListener('click', handler); },
    onBack(handler) { backBtn.addEventListener('click', handler); },
    onResultClick(handler) { resultEl.addEventListener('click', handler); },
  };
}
