// @ts-check
// How a match is won (DEV_PLAN.md D7). Hearts is the default; Spice can bring
// others (Hit Points, Race to N, Tug of War) from Phase 5.

import { HEARTS_PER_SIDE } from '../config.js';

/** @typedef {import('./types.js').PerSide<number>} HeartsState */

/**
 * Each side starts with `count` hearts. The round's loser loses one; a tie
 * costs nobody anything. Whoever runs out first loses the match.
 * @param {number} count
 * @returns {import('./types.js').WinCondition<HeartsState>}
 */
export function hearts(count) {
  return {
    id: `hearts-${count}`,
    init: () => ({ player: count, opponent: count }),
    damage: ({ winner }) => ({
      player: winner === 'opponent' ? 1 : 0,
      opponent: winner === 'player' ? 1 : 0,
    }),
    apply: (state, _round, damage) => ({
      player: Math.max(0, state.player - damage.player),
      opponent: Math.max(0, state.opponent - damage.opponent),
    }),
    // Both sides can only run out together if a Spice costs both a heart in
    // the same round (Mutual Destruction); that ends the match as a draw.
    matchWinner: (state) => {
      if (state.player <= 0 && state.opponent <= 0) return 'draw';
      if (state.player <= 0) return 'opponent';
      if (state.opponent <= 0) return 'player';
      return null;
    },
    view: (state) => ({
      kind: 'hearts',
      sides: {
        player: { left: state.player, max: count },
        opponent: { left: state.opponent, max: count },
      },
    }),
  };
}

export const HEARTS = hearts(HEARTS_PER_SIDE);
