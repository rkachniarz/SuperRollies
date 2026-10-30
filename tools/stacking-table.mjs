// Writes docs/stacking.md, the cross-list of which Spice stack (D51), from
// src/rules/stacking.js. Run after changing the slots or clashes there:
//   node tools/stacking-table.mjs
import { writeFileSync } from 'node:fs';
import { SPICE } from '../src/rules/spice.js';
import { DICE_SETS } from '../src/rules/dice-sets.js';
import { isEligible } from '../src/rules/engine.js';
import { SLOTS, CLASHES, clashOf, largestStack } from '../src/rules/stacking.js';

const all = Object.values(SPICE).filter((s) => s.id !== 'vanilla');
const name = (id) => `${SPICE[id].icon} ${SPICE[id].name}`;
const sets = Object.values(DICE_SETS);
/** Whether two Spice are ever eligible for the same dice set. */
const meet = (a, b) => sets.some((set) => isEligible(a, set) && isEligible(b, set));

const lines = [
  '# Stacking Spice: the cross-list',
  '',
  'Which Spice can be played together in one match (docs/decisions.md D51).',
  'Generated from `src/rules/stacking.js` by `node tools/stacking-table.mjs`;',
  'edit that file, not this one. Each Spice must also be eligible for the dice',
  'set on its own (R3.2). Vanilla is no Spice at all, so it never stacks.',
  '',
  '## Slots',
  '',
  'A part of the match only one Spice can have its way with. Two Spice in the',
  'same slot never stack.',
  '',
  '| Slot | What | Spice |',
  '|---|---|---|',
  ...Object.entries(SLOTS).map(([slot, { what, spice }]) => `| \`${slot}\` | ${what} | ${spice.map(name).join(', ')} |`),
  '',
  'Every other Spice takes no slot: the table ones (Pothole, Cat Paw, Gusty',
  'Table, No Man\'s Land), the ones that change what a round costs (Mutual',
  'Destruction, Raising the Stakes, Revenge, Critical Hit, Critical Fumble),',
  'Cursed Number, Caltrops, Doubles Again and Draw Poker.',
  '',
  '## Clashes',
  '',
  'Pairs that take no slot in common but still don\'t stack. *Fixable* means',
  'the rules make sense together and only the game doesn\'t handle it yet.',
  '',
  '| Spice | Doesn\'t stack with | Why |',
  '|---|---|---|',
  ...CLASHES.map(({ a, b, why, fixable, minDice }) =>
    `| ${a.map(name).join(', ')} | ${b.map(name).join(', ')} | ${why}${fixable ? ' *Fixable.*' : ''}${minDice ? ` *Only with ${minDice} dice a side or more (Fireball).*` : ''} |`),
  '',
  '## The cross-list',
  '',
  'Columns are numbered as the rows. `✓` stacks; a letter is a shared slot',
  '(**w**in, **v**erdict, **s**corer, e**x**tra die, extra **r**oll, re**t**hrow);',
  '`✕` a clash, `f` a fixable one, `8` a fixable one only with eight dice a side (Fireball);',
  'blank: never eligible for the same dice set.',
  '',
  `| | Spice | ${all.map((_, i) => i + 1).join(' | ')} |`,
  `|---:|---|${all.map(() => ':-:').join('|')}|`,
];
const letter = { win: 'w', verdict: 'v', scorer: 's', 'extra-die': 'x', 'extra-roll': 'r', rethrow: 't' };
all.forEach((a, i) => {
  const cells = all.map((b) => {
    if (a === b) return '·';
    if (!meet(a, b)) return ' ';
    const clash = clashOf(a.id, b.id);
    if (!clash) return '✓';
    if (clash.slot) return letter[clash.slot];
    if (clash.minDice) return String(clash.minDice);
    return clash.fixable ? 'f' : '✕';
  });
  lines.push(`| ${i + 1} | ${name(a.id)} | ${cells.join(' | ')} |`);
});

lines.push(
  '',
  '## The most Spice each dice set can take',
  '',
  'One largest stack per set (there are often several).',
  '',
  '| Dice set | How many | One such stack |',
  '|---|--:|---|',
  ...sets.map((set) => {
    const stack = largestStack(set.id);
    return `| ${set.name} | ${stack.length} | ${stack.map(name).join(', ')} |`;
  }),
  '',
);

writeFileSync(new URL('../docs/stacking.md', import.meta.url), lines.join('\n'));
console.log('Wrote docs/stacking.md');
