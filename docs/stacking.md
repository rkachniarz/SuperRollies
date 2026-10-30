# Stacking Spice: the cross-list

Which Spice can be played together in one match (docs/decisions.md D51).
Generated from `src/rules/stacking.js` by `node tools/stacking-table.mjs`;
edit that file, not this one. Each Spice must also be eligible for the dice
set on its own (R3.2). Vanilla is no Spice at all, so it never stacks.

## Slots

A part of the match only one Spice can have its way with. Two Spice in the
same slot never stack.

| Slot | What | Spice |
|---|---|---|
| `win` | How the match is won | 💀 Sudden Death, 🏃 Marathon, 🩸 Hit Points, 🏁 Race to N, 💪 Tug of War, ⚰️ Death Saves, 🔥 Burnout |
| `verdict` | Who wins a round | 🔻 Lowball, 🐍 Snake Eyes / Boxcars, 🎰 Triples, 🌀 Wild Magic |
| `scorer` | How a hand is totalled | ✨ Inspiration, 🎲 Count the Sixes, 👑 Crown |
| `extra-die` | An extra die for a side in a given state | 🐶 Underdog, ✨ Inspiration |
| `extra-roll` | Extra rolls added to a die | 🧨 Exploding Dice, 🪓 Brutal Critical |
| `rethrow` | A re-throw once the result is shown | 🌬️ Second Wind, 🕊️ Mercy |

Every other Spice takes no slot: the table ones (Pothole, Cat Paw, Gusty
Table, No Man's Land), the ones that change what a round costs (Mutual
Destruction, Raising the Stakes, Revenge, Critical Hit, Critical Fumble),
Cursed Number, Caltrops, Doubles Again and Draw Poker.

## Clashes

Pairs that take no slot in common but still don't stack. *Fixable* means
the rules make sense together and only the game doesn't handle it yet.

| Spice | Doesn't stack with | Why |
|---|---|---|
| 🏁 Race to N | 💥 Mutual Destruction, 📈 Raising the Stakes, 😤 Revenge, 🎯 Critical Hit, 🍌 Critical Fumble, 🔻 Lowball, 🐍 Snake Eyes / Boxcars, 🎰 Triples, 🌀 Wild Magic | Race to N banks every total, win or lose: who wins a round, and what it costs, count for nothing. |
| 🩸 Hit Points, 💪 Tug of War | 💥 Mutual Destruction, 🍌 Critical Fumble, 🌀 Wild Magic | They add or take a heart's worth: 1 HP is nothing, and in Tug of War a point off each side cancels out. |
| 🎲 Count the Sixes, 👑 Crown | 🩸 Hit Points, 🏁 Race to N, 💪 Tug of War | Points are scaled to the dice set's totals; counting sixes, or the highest die, makes totals far smaller. |
| 🧨 Exploding Dice, 🪓 Brutal Critical | 🎲 Count the Sixes, 👑 Crown | An exploded 6 counts as 6 plus its rolls, so it is no longer a six, nor a die on its maximum. |
| 🕊️ Mercy | 💀 Sudden Death, 🩸 Hit Points, 🏁 Race to N, 💪 Tug of War | Mercy needs a side two hearts behind: with one heart, or no hearts, that never happens. |
| 💀 Sudden Death | 🐶 Underdog, 😤 Revenge, 📈 Raising the Stakes, 🎯 Critical Hit, ✨ Inspiration | The first round lost ends the match, so nobody is ever behind, or has lost the last round, and double of one heart is one. |
| 🔻 Lowball | 🐶 Underdog, ✨ Inspiration, 📌 Caltrops, 🎲 Doubles Again, 👑 Crown, 🧨 Exploding Dice, 🪓 Brutal Critical, 🎯 Critical Hit | Under Lowball a Spice meant to help a side would hurt it: an extra die, a bonus or an explosion raises the total, and Caltrops would lower the other side's. |
| 🎲 Doubles Again | 🌬️ Second Wind, 🕊️ Mercy | A re-throw replays the round's first throw but not the doubles thrown after it. *Fixable.* |
| ⚔️ No Man's Land | 🌬️ Second Wind, 🕊️ Mercy, 🎲 Doubles Again | Only one side throws again, and the other side's dice, which may lie anywhere without the divider, are not in that throw. (Fixable as Draw Poker does it: hold them where they lie.) *Fixable.* |
| 🎲 Doubles Again | 🕳️ Pothole | A throw made again for doubles doesn't say which of its dice went down a hole. *Fixable.* |
| ⚔️ No Man's Land | 💪 Tug of War, 💨 Gusty Table, 🕳️ Pothole | With eight dice a side and no divider, dice heap up against the rope, are blown into a heap, or pile round a hole: measured, 1 throw in 20 to 45 waited out the timeout. Fine with fewer dice. *Fixable.* *Only with 8 dice a side or more (Fireball).* |
| 💪 Tug of War | 💨 Gusty Table | With eight dice a side the breeze blows dice into the rope, where they rock: measured, up to 1 throw in 40 waited out the timeout. Fine with fewer dice. *Fixable.* *Only with 8 dice a side or more (Fireball).* |
| 🃏 Draw Poker | 🕳️ Pothole | A redraw picks dice up from where they lie, and lifting one out of a pit has never been tried. *Fixable.* |

## The cross-list

Columns are numbered as the rows. `✓` stacks; a letter is a shared slot
(**w**in, **v**erdict, **s**corer, e**x**tra die, extra **r**oll, re**t**hrow);
`✕` a clash, `f` a fixable one, `8` a fixable one only with eight dice a side (Fireball);
blank: never eligible for the same dice set.

| | Spice | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 |
|---:|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | 💀 Sudden Death | · | w | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | w | w | w | ✕ | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | w | ✓ | ✓ | w | ✓ | ✓ |
| 2 | 🏃 Marathon | w | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w | w | w | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w | ✓ | ✓ | w | ✓ | ✓ |
| 3 | 💥 Mutual Destruction | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 | 🔻 Lowball | ✓ | ✓ | ✓ | · | ✕ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✕ | ✕ | v | v | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✕ | v |
| 5 | 🧨 Exploding Dice | ✓ | ✓ | ✓ | ✕ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | r | ✓ | ✓ | ✓ | ✓ | ✓ |   | ✕ | ✓ | ✕ |   |
| 6 | 📈 Raising the Stakes | ✕ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7 | 👻 Cursed Number | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |
| 8 | 🌬️ Second Wind | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | t | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 | 🩸 Hit Points | w | w | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | · | w | w | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w |   | ✕ | w | ✕ | ✕ |
| 10 | 🏁 Race to N | w | w | ✕ | ✕ | ✓ | ✕ | ✓ | ✓ | w | · | w | ✓ | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✕ | ✕ | ✓ | ✓ | ✕ | ✕ | ✓ | ✓ | w |   | ✕ | w | ✕ | ✕ |
| 11 | 💪 Tug of War | w | w | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | w | w | · | ✓ | ✓ | ✕ | ✓ | ✓ | 8 | 8 | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w |   | ✕ | w | ✕ | ✕ |
| 12 | 🐶 Underdog | ✕ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | x | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   | ✓ |   |
| 13 | 😤 Revenge | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 14 | 🕊️ Mercy | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | t | ✕ | ✕ | ✕ | ✓ | ✓ | · | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 15 | 🕳️ Pothole | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | 8 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | f | ✓ | f | ✓ | ✓ | ✓ | ✓ |
| 16 | 🐾 Cat Paw | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 17 | 💨 Gusty Table | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8 | ✓ | ✓ | ✓ | ✓ | ✓ | · | 8 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 18 | ⚔️ No Man's Land | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | f | ✓ | ✓ | 8 | ✓ | ✓ | f | 8 | ✓ | 8 | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 19 | 🎯 Critical Hit | ✕ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |
| 20 | 🍌 Critical Fumble | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |
| 21 | ✨ Inspiration | ✕ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | x | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |   |   |   |   |   | ✓ |   |   |   |   |   |
| 22 | 🪓 Brutal Critical | ✓ | ✓ | ✓ | ✕ | r | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   | · |   |   |   |   |   |   |   |   |   |   |
| 23 | 🐍 Snake Eyes / Boxcars | ✓ | ✓ | ✓ | v | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   | · |   |   | ✓ |   |   |   |   |   |   |
| 24 | 🎰 Triples | ✓ | ✓ | ✓ | v | ✓ | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   | · |   | ✓ |   |   |   |   |   |   |
| 25 | 📌 Caltrops | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   | · |   |   |   |   |   |   |   |
| 26 | 🎲 Doubles Again | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | f | ✓ | ✓ | ✓ | ✓ | ✓ | f | f | ✓ | ✓ | f |   |   |   |   | ✓ | ✓ |   | · |   |   |   |   |   |   |
| 27 | ⚰️ Death Saves | w | w | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w | w | w | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   | · |   |   |   |   |   |
| 28 | 🃏 Draw Poker | ✓ | ✓ | ✓ | ✓ |   | ✓ | ✓ | ✓ |   |   |   |   | ✓ | ✓ | f | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   | · |   |   |   |   |
| 29 | 🎲 Count the Sixes | ✓ | ✓ | ✓ | ✓ | ✕ | ✓ | ✓ | ✓ | ✕ | ✕ | ✕ |   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   | · | ✓ |   |   |
| 30 | 🔥 Burnout | w | w | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | w | w | w |   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   | ✓ | · |   |   |
| 31 | 👑 Crown | ✓ | ✓ | ✓ | ✕ | ✕ | ✓ | ✓ | ✓ | ✕ | ✕ | ✕ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   |   |   | · |   |
| 32 | 🌀 Wild Magic | ✓ | ✓ | ✓ | v |   | ✓ |   | ✓ | ✕ | ✕ | ✕ |   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |   | · |

## The most Spice each dice set can take

One largest stack per set (there are often several).

| Dice set | How many | One such stack |
|---|--:|---|
| The Classic | 13 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎯 Critical Hit, 🍌 Critical Fumble |
| Advantage | 13 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎯 Critical Hit, 🍌 Critical Fumble |
| Greatsword | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🐍 Snake Eyes / Boxcars |
| Greataxe | 11 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
| Ability Score | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎰 Triples |
| Heroic Stats | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎰 Triples |
| Magic Missile | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 📌 Caltrops |
| Swarm of Daggers | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 📌 Caltrops |
| Guiding Bolt | 12 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎰 Triples |
| Divine Smite | 11 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
| Fireball | 11 | 🏃 Marathon, 💥 Mutual Destruction, 🔻 Lowball, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table, 🎲 Count the Sixes |
| Percentile | 9 | 🏃 Marathon, 💥 Mutual Destruction, 🔻 Lowball, 📈 Raising the Stakes, 🌬️ Second Wind, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
| Sneak Attack | 11 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
| The Whole Bag | 11 | 🏃 Marathon, 💥 Mutual Destruction, 🧨 Exploding Dice, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 🐶 Underdog, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
| Dice Poker | 10 | 🏃 Marathon, 💥 Mutual Destruction, 🔻 Lowball, 📈 Raising the Stakes, 👻 Cursed Number, 🌬️ Second Wind, 😤 Revenge, 🕳️ Pothole, 🐾 Cat Paw, 💨 Gusty Table |
