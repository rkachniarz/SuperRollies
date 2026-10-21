// Cards: how a dice set, a Spice or a single die is shown when it's offered -
// in the Quick Game draft, Zen's catalogue, and the in-match rules popup. Each
// has a name, its dice notation (or what kind of Spice it is), a one-line
// summary and an icon (docs/spec.md R1.4).

import { SPICE_KINDS } from './rules/spice.js';

// Each die type as a flat outline, enough to tell them apart at a glance: the
// shape you'd draw of it, in a 32x32 box.
const DIE_ICONS = {
  d4: { outline: '16,3 29,27 3,27', lines: 'M16 3 16 19 M3 27 16 19 29 27' },
  d6: { outline: '16,3 28,9.5 28,22.5 16,29 4,22.5 4,9.5', lines: 'M4 9.5 16 16 28 9.5 M16 16 16 29' },
  d8: { outline: '16,3 28,16 16,29 4,16', lines: 'M4 16 16 20 28 16 M16 3 16 20' },
  d10: { outline: '16,3 29,13 29,19 16,29 3,19 3,13', lines: 'M16 3 10 17 16 21 22 17 16 3 M3 19 10 17 M29 19 22 17 M16 21 16 29' },
  'd%': { outline: '16,3 29,13 29,19 16,29 3,19 3,13', lines: 'M16 3 10 17 16 21 22 17 16 3 M3 19 10 17 M29 19 22 17 M16 21 16 29' },
  d12: {
    outline: '16,3 29,12.5 24,28 8,28 3,12.5',
    lines: 'M16 9 22.5 13.5 20 21 12 21 9.5 13.5 Z M16 3 16 9 M29 12.5 22.5 13.5 M24 28 20 21 M8 28 12 21 M3 12.5 9.5 13.5',
  },
  d20: {
    outline: '16,2.5 28,9.5 28,22.5 16,29.5 4,22.5 4,9.5',
    lines: 'M16 9 23 21 9 21 Z M16 2.5 16 9 4 9.5 M16 9 28 9.5 23 21 28 22.5 M23 21 16 29.5 9 21 4 22.5 M9 21 4 9.5',
  },
};

/** An inline SVG of one die type. */
function dieIcon(type) {
  const { outline, lines } = DIE_ICONS[type];
  const label = type === 'd%' ? '<text x="16" y="19" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none">%</text>' : '';
  return `<svg class="die-icon" viewBox="0 0 32 32" aria-hidden="true"><polygon points="${outline}"/><path d="${lines}"/>${label}</svg>`;
}

/**
 * @typedef {Object} CardData
 * @property {string} id  What picking it gives back.
 * @property {'dice' | 'spice'} kind  Colours it as dice or as Spice.
 * @property {string} name
 * @property {string} tag  The dice notation, or what kind of Spice it is.
 * @property {string} summary
 * @property {string} icon  Markup: die outlines, or an emoji.
 * @property {string} [emoji]  A Spice's emoji alone, for the match label.
 * @property {string} [rules]  The full rules, for the rules popup.
 */

/**
 * A dice set's card: its die types as icons, one of each type.
 * @param {import('./rules/types.js').DiceSet} set
 * @returns {CardData}
 */
export function diceSetCard(set) {
  const types = [...new Set(set.dice.map((d) => d.type))];
  return {
    id: set.id,
    kind: 'dice',
    name: set.name,
    tag: set.notation,
    summary: set.summary,
    icon: types.map(dieIcon).join(''),
    rules: set.rules ?? `${set.summary} Totals run ${set.range}.`,
  };
}

/**
 * One die alone (Zen's "One d8"), where no dice set is just that die.
 * @param {string} type
 * @returns {CardData}
 */
export function dieCard(type) {
  return { id: `die:${type}`, kind: 'dice', name: `One ${type}`, tag: `1${type}`, summary: 'Just the one die.', icon: dieIcon(type) };
}

/**
 * @param {import('./rules/types.js').Spice} spice
 * @returns {CardData}
 */
export function spiceCard(spice) {
  return {
    id: spice.id,
    kind: 'spice',
    name: spice.name,
    tag: SPICE_KINDS[spice.kind],
    summary: spice.summary,
    icon: `<span class="emoji" aria-hidden="true">${spice.icon}</span>`,
    emoji: spice.icon,
    rules: spice.rules,
  };
}

/**
 * The card as an element: a button when it can be picked (`onPick`), a plain
 * box when it's only there to be read (the rules popup, which shows the full
 * rules instead of the summary). `compact` lays it out in a row, for long
 * lists.
 * @param {CardData} card
 * @param {{ onPick?: (id: string) => void, compact?: boolean, full?: boolean }} [options]
 */
export function renderCard(card, { onPick, compact = false, full = false } = {}) {
  const el = document.createElement(onPick ? 'button' : 'div');
  el.className = `card ${card.kind}${compact ? ' compact' : ''}`;
  el.dataset.pick = card.id;
  const icon = document.createElement('div');
  icon.className = 'card-icon';
  icon.innerHTML = card.icon;
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = card.name;
  const tag = document.createElement('div');
  tag.className = 'card-tag';
  tag.textContent = card.tag;
  const summary = document.createElement('div');
  summary.className = 'card-summary';
  summary.textContent = full && card.rules ? card.rules : card.summary;
  el.append(icon, name, tag, summary);
  if (onPick) el.addEventListener('click', () => onPick(card.id));
  return el;
}
