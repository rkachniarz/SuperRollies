// @ts-check
// Shared JSDoc types for the rules: the match config, dice sets, win conditions
// and Spice. Types only - nothing here runs. Editors pick them up through
// `// @ts-check`; there is no build step (DEV_PLAN.md, D13).

/**
 * The two sides of the table. Rules never favour a side by identity (R1.7),
 * but a Spice that draws random numbers for each side (Exploding Dice, Brutal
 * Critical) draws the player's first, so in multiplayer both clients must
 * evaluate the round from the same seat - the host's as 'player' - and the
 * guest mirror the outcome for display (DEV_PLAN.md D27).
 * @typedef {'player' | 'opponent'} Side
 */

/**
 * How a match ended: a side won, or both lost together.
 * @typedef {Side | 'draw'} MatchResult
 */

/**
 * One value per side.
 * @template T
 * @typedef {{ player: T, opponent: T }} PerSide
 */

/**
 * Everything that defines a match before it starts. Plain data, so it can be
 * sent to another player as-is: the dice set and Spice are named by id.
 * @typedef {Object} MatchConfig
 * @property {number} seed  uint32; every random event in the match follows from it.
 * @property {string} diceSet  A key of DICE_SETS.
 * @property {string} spice  A key of SPICE.
 */

/**
 * Turns one side's face values, in the dice set's order, into its total.
 * `kept` says which dice counted towards it (for the breakdown on the result
 * card, R2.5); a scorer without it counts every die. `labels` says how each
 * die is written in that breakdown, where it isn't just its face (percentile:
 * `00 + 0`, making 100). `describe` names the score, where the number itself
 * means nothing to a player (a poker hand's rank) or needs a word (`2
 * sixes`); a named score isn't a sum, so the card lists its dice rather than
 * adding them up. `hold` says which dice are worth keeping when a side may
 * throw the others again (Draw Poker), for the opponent; without it, the
 * dice that count are kept.
 * @typedef {((faces: number[]) => number) & {
 *   id: string,
 *   suffix: string,
 *   kept?: (faces: number[]) => boolean[],
 *   labels?: (faces: number[]) => string[],
 *   describe?: (faces: number[]) => string,
 *   hold?: (faces: number[]) => boolean[],
 * }} Scorer
 */

/**
 * @typedef {Object} DiceSet
 * @property {string} id
 * @property {string} name
 * @property {string} notation  As printed on its card, e.g. `8d6`.
 * @property {string} summary  One line, for its card.
 * @property {string} range  The totals it can make, e.g. `8–48`.
 * @property {string} [rules]  Its full rules, for the rules popup, where the
 *   summary and range don't say it all (Dice Poker's hands).
 * @property {{ type: string, count: number }[]} dice  Per side, in order.
 * @property {Scorer} scorer
 * @property {number} dieScale  Die size relative to the die type's own.
 * @property {{ halfWidth: number, depth: number }} tray  Inside the walls; depth
 *   is one side's half.
 */

/**
 * What one side throws in a round, and how it's totalled: the dice set's,
 * unless a Spice changes it for the round (Underdog's extra die, Inspiration's
 * advantage).
 * @typedef {Object} Hand
 * @property {string[]} types  One entry per die, in the order faces are scored.
 * @property {Scorer} scorer
 */

/**
 * What a Spice says one die counts for, when that isn't just its face. `text`
 * is how the result card writes it (`(6+6+2)` for a die that exploded twice);
 * `tag` marks it for the card to style ('exploded', 'cursed', 'burnt'). `extra` is
 * any rolls the game made for it and added on (an exploded die's), in order,
 * for the table to show them rolled.
 * @typedef {{ value: number, text?: string, tag?: string, extra?: number[] }} DieValue
 */

/**
 * One die in the breakdown on the result card (R2.5), and on the table.
 * @typedef {{ text: string, kept: boolean, tag?: string, extra?: number[] }} DieTerm
 */

/**
 * Something a Spice adds to or takes off a side's total, named on the card
 * (Caltrops: `- 2 caltrops`).
 * @typedef {{ label: string, value: number }} Adjustment
 */

/**
 * What happened in a round, before the win condition has its say.
 * @typedef {Object} Round
 * @property {PerSide<number[]>} faces  As thrown.
 * @property {PerSide<boolean[]>} fallen  Which dice ended up in a hole
 *   (Pothole). All false on a table without one.
 * @property {PerSide<number[][]>} again  The faces of each further throw a
 *   side made this round (Doubles Again). Usually none.
 * @property {PerSide<number[]>} values  What each die counted for, once a
 *   Spice has had its say (an exploded die, a cursed one). Usually the faces.
 * @property {PerSide<boolean[]>} kept  Which dice counted, per the hand's scorer.
 * @property {PerSide<DieTerm[]>} dice  Each die as the result card writes it.
 * @property {PerSide<Adjustment[]>} adjustments
 * @property {PerSide<number>} scores
 * @property {PerSide<string | undefined>} named  What each score is called,
 *   where the hand's scorer names it (`Full house (6s, 2s)`, `2 sixes`).
 * @property {Side | null} winner  null for a tie.
 */

/**
 * The match-state HUD a win condition asks for. hud.js draws whichever kind it
 * is given, and assumes nothing else (R3.4): a row of hearts per side, with a
 * row of marks beside them if the win condition counts something else too
 * (Death Saves' fails); or a bar per side, styled as HP, a race's progress,
 * or the ground left in a tug of war.
 * @typedef {{ kind: 'hearts', sides: PerSide<{ left: number, max: number }>,
 *   marks?: PerSide<{ count: number, max: number, label: string, icon?: string }> }
 *   | { kind: 'bar', style: 'hp' | 'race' | 'tug', sides: PerSide<{ value: number, max: number, text: string }> }} MatchView
 */

/**
 * How a match is won (D7). Hearts by default; a Spice may bring its own.
 * @template S  This win condition's slice of the match state.
 * @typedef {Object} WinCondition
 * @property {string} id
 * @property {string} [unit]  What a side loses, if it's a count worth naming
 *   on the result card ('HP': `You lose 8 HP.`). Hearts are seen going.
 * @property {() => S} init
 * @property {(round: Round) => PerSide<number>} damage  What the round costs
 *   each side by default, in this win condition's own units.
 * @property {(state: S, round: Round, damage: PerSide<number>) => S} apply
 * @property {(state: S) => MatchResult | null} matchWinner  null while play goes on.
 * @property {(state: S) => Side | null} behind  Who is losing, if anyone
 *   (Underdog helps them).
 * @property {(state: S) => MatchView} view
 * @property {(state: S) => number} [pull]  How far a marker has been pulled
 *   towards the opponent's edge, -1 (the player's) to 1 (Tug of War's rope).
 */

/**
 * Which dice sets a Spice may be played with (R3.2). Every field is optional;
 * an empty object means "any".
 * @typedef {Object} Eligibility
 * @property {number} [minDice]
 * @property {number} [maxDice]
 * @property {string[]} [dieTypes]  All of these must be in the set.
 * @property {string[]} [diceSets]  Only these sets, by id.
 * @property {string[]} [excludeDiceSets]  Never these sets, by id.
 * @property {string[]} [incompatible]  Spice ids it can't be combined with.
 */

/**
 * What a hook gets to look at. Hooks are pure: they return what changes and
 * never mutate the state they are given.
 * @typedef {Object} HookContext
 * @property {Rules} rules
 * @property {MatchState} state
 * @property {import('../rng.js').Rng} rng  The match's rules stream. Drawing
 *   from it is how a hook does anything random (R5.2).
 */

/**
 * A hook context without the random stream, for hooks that only look at where
 * the match stands and may be asked any number of times (`hand`, `edge`,
 * `explain`).
 * @typedef {Object} StateContext
 * @property {Rules} rules
 * @property {MatchState} state
 */

/**
 * A hook context for one side's dice in a round.
 * @typedef {HookContext & { side: Side, hand: Hand, fallen: boolean[] }} SideContext
 */

/**
 * A hole in the table (Pothole): its centre and radius on the floor, and how
 * deep the pit under it is.
 * @typedef {{ x: number, z: number, r: number, depth: number }} Hole
 */

/**
 * What the table is like for a round, beyond the dice set's tray: holes in
 * it, a steady breeze across it (an acceleration along x and z, in units/s²,
 * felt by every die still moving), and whether the divider is up. All of it
 * goes in the throw's record, so a replay meets the same table.
 * @typedef {{ holes: Hole[], wind: number[] | null, divider: boolean, rope: Rope | null }} TableEffects
 */

/**
 * A rope lying down the middle of the table, end to end (Tug of War), with a
 * flag tied to it `pull` of the way to the opponent's end (-1 to 1: -1 at
 * the player's end). Only the rope is in a throw's record; the flag is drawn.
 * @typedef {{ pull: number }} Rope
 */

/**
 * One die a cat's paw knocks once the dice have settled (Cat Paw): which, how
 * hard (0-1), and how far off straight across the table it goes (-1-1).
 * @typedef {{ side: Side, index: number, power: number, turn: number }} Swipe
 */

/**
 * A state-based advantage one side holds this round (R1.7, R3.5), named for
 * the HUD: `+1 die`.
 * @typedef {{ side: Side, label: string }} Edge
 */

/**
 * A rule change for one match (R3.1). Every hook is optional; leaving one out
 * keeps the default behaviour.
 * @typedef {Object} Spice
 * @property {string} id
 * @property {string} name
 * @property {string} icon  An emoji, for its card.
 * @property {'rule' | 'win' | 'comeback' | 'table' | 'dice'} kind  What sort of
 *   change it is, written on its card: a rule, a win condition, a comeback
 *   rule, something on the table, or one for particular dice.
 * @property {string} summary  One line, for its card.
 * @property {string} rules  The full rules, for the in-match rules popup (R1.5).
 * @property {Eligibility} eligibility
 * @property {WinCondition<any> | ((diceSet: DiceSet) => WinCondition<any>)} [winCondition]
 *   Replaces Hearts. Made for the dice set, where it scales to it (Hit Points).
 * @property {(ctx: HookContext) => unknown} [setup]  Starting state for this
 *   Spice's own bookkeeping (stored as MatchState.spice).
 * @property {(ctx: HookContext) => { spice?: unknown, announce?: string } | void} [beforeThrow]
 *   Per-round setup, before anyone throws.
 * @property {(ctx: HookContext & { dice: PerSide<number> }) => { swipes?: Swipe[], spice?: unknown } | void} [afterSettle]
 *   Acts on settled dice (Cat Paw). Says what happens to them, drawing from
 *   the rules stream; the game carries it out on the table, then reads the
 *   faces. `dice` is how many each side has.
 * @property {(ctx: StateContext) => Partial<TableEffects>} [table]  The table
 *   this round is thrown on (TableEffects). Depends on the match state only.
 * @property {number} [redraws]  How many times a round each side may throw
 *   any of its dice again, keeping the rest where they lie, once both have
 *   thrown and before the round is played out (Draw Poker). Default none.
 * @property {(throws: number[][], ctx: StateContext & { side: Side }) => boolean} [again]
 *   Whether a side throws once more this round, given the faces of each throw
 *   it has made in it so far (Doubles Again).
 * @property {{ can: (side: Side, ctx: StateContext) => boolean, spend: (side: Side, ctx: StateContext) => unknown }} [rethrow]
 *   A side's chance to throw its dice again once the round's result is shown
 *   (Second Wind, Mercy): whether it may, from the state the round started
 *   in, and the Spice's state once it has.
 * @property {(side: Side, base: Hand, ctx: StateContext) => Hand} [hand]
 *   What a side throws this round, given the dice set's. Asked by the game
 *   before the round (to lay the dice out) and by the engine after it (to
 *   score them), so it must depend on the match state only.
 * @property {(ctx: StateContext) => Edge | Edge[] | null} [edge]  Who holds a
 *   state-based advantage this round, if anyone (R3.5). Both sides can.
 * @property {(faces: number[], ctx: SideContext) => DieValue[]} [values]
 *   What each of a side's dice counts for, one entry per die, before the
 *   scorer totals them.
 * @property {(round: Pick<Round, 'faces' | 'values' | 'again'>, ctx: SideContext) => Adjustment[]} [adjust]
 *   Added to (or taken off) a side's total after the scorer.
 * @property {(round: Omit<Round, 'winner'>, ctx: HookContext) => Side | null} [compare]
 *   Decides the round winner. Default: higher score wins, equal is a tie.
 * @property {(round: Round, damage: PerSide<number>, ctx: HookContext) => PerSide<number>} [applyDamage]
 *   Changes what the round costs, given the win condition's default.
 * @property {(round: Round & { damage: PerSide<number> }, ctx: StateContext) => string | undefined} [explain]
 *   A line for the result card when the Spice decided something (`Boxcars!`).
 */

/**
 * A match config with its ids looked up.
 * @typedef {Object} Rules
 * @property {MatchConfig} config
 * @property {DiceSet} diceSet
 * @property {Spice} spice
 * @property {WinCondition<any>} winCondition
 */

/**
 * Where a match stands between rounds. Plain data: two clients holding the
 * same state and the same results reach the same next state.
 * @typedef {Object} MatchState
 * @property {number} round  Rounds played so far.
 * @property {number} rng  State of the rules stream (see rng.js).
 * @property {unknown} win  The win condition's own state.
 * @property {unknown} spice  The Spice's own state.
 * @property {{ winner: Side | null } | null} previous  How the last round
 *   went; null before the first.
 * @property {MatchResult | null} winner  Set once the match is over.
 */

/**
 * @typedef {Round & {
 *   damage: PerSide<number>,
 *   matchWinner: MatchResult | null,
 *   note?: string,
 * }} RoundOutcome
 */

export {};
