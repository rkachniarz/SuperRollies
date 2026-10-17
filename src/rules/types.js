// @ts-check
// Shared JSDoc types for the rules: the match config, dice sets, win conditions
// and Spice. Types only - nothing here runs. Editors pick them up through
// `// @ts-check`; there is no build step (DEV_PLAN.md, D13).

/**
 * The two sides of the table, from this screen's point of view. Rules never
 * favour a side by identity (R1.7), so in multiplayer each client can evaluate
 * a round from its own side and both reach the same outcome, mirrored.
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
 * @typedef {(faces: number[]) => number} Scorer
 */

/**
 * @typedef {Object} DiceSet
 * @property {string} id
 * @property {string} name
 * @property {string} notation  As printed on its card, e.g. `8d6`.
 * @property {{ type: string, count: number }[]} dice  Per side, in order.
 * @property {Scorer} scorer
 * @property {number} dieScale  Die size relative to DIE_RADIUS.
 * @property {{ halfWidth: number, depth: number }} tray  Depth is one side's half.
 */

/**
 * What happened in a round, before the win condition has its say.
 * @typedef {Object} Round
 * @property {PerSide<number[]>} faces
 * @property {PerSide<number>} scores
 * @property {Side | null} winner  null for a tie.
 */

/**
 * The match-state HUD a win condition asks for. hud.js draws whichever kind it
 * is given, and assumes nothing else (R3.4).
 * @typedef {{ kind: 'hearts', sides: PerSide<{ left: number, max: number }> }} MatchView
 */

/**
 * How a match is won (D7). Hearts by default; a Spice may bring its own.
 * @template S  This win condition's slice of the match state.
 * @typedef {Object} WinCondition
 * @property {string} id
 * @property {() => S} init
 * @property {(round: Round) => PerSide<number>} damage  What the round costs
 *   each side by default, in this win condition's own units.
 * @property {(state: S, round: Round, damage: PerSide<number>) => S} apply
 * @property {(state: S) => MatchResult | null} matchWinner  null while play goes on.
 * @property {(state: S) => MatchView} view
 */

/**
 * Which dice sets a Spice may be played with (R3.2). Every field is optional;
 * an empty object means "any".
 * @typedef {Object} Eligibility
 * @property {number} [minDice]
 * @property {number} [maxDice]
 * @property {string[]} [dieTypes]  All of these must be in the set.
 * @property {string[]} [diceSets]  Only these sets, by id.
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
 * A rule change for one match (R3.1). Every hook is optional; leaving one out
 * keeps the default behaviour.
 * @typedef {Object} Spice
 * @property {string} id
 * @property {string} name
 * @property {string} summary  One line, for its card.
 * @property {Eligibility} eligibility
 * @property {WinCondition<any>} [winCondition]  Replaces Hearts.
 * @property {(ctx: HookContext) => unknown} [setup]  Starting state for this
 *   Spice's own bookkeeping (stored as MatchState.spice).
 * @property {(ctx: HookContext) => { spice?: unknown, announce?: string } | void} [beforeThrow]
 *   Per-round setup, before anyone throws.
 * @property {(ctx: HookContext) => void} [afterSettle]  Acts on settled dice:
 *   nudge, remove or re-throw them. Physical, so the game calls it around the
 *   simulation rather than the rules engine (wired up with the first Spice that
 *   needs it, Phase 5).
 * @property {(faces: number[], score: number, ctx: HookContext) => number} [score]
 *   Transforms the dice set's score for one side.
 * @property {(scores: PerSide<number>, ctx: HookContext) => Side | null} [compare]
 *   Decides the round winner. Default: higher score wins, equal is a tie.
 * @property {(round: Round, damage: PerSide<number>, ctx: HookContext) => PerSide<number>} [applyDamage]
 *   Changes what the round costs, given the win condition's default.
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
 * @property {MatchResult | null} winner  Set once the match is over.
 */

/**
 * @typedef {Round & { damage: PerSide<number>, matchWinner: MatchResult | null }} RoundOutcome
 */

export {};
