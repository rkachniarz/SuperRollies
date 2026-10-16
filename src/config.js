// Every number worth tuning lives here, so you can change how the game looks
// and feels without hunting through the logic.

// ---------- Colours ----------
// `number` is the colour of the etched numerals on that die. The player's are
// near-black on orange, the opponent's near-white on purple.
export const THEMES = {
  player: { body: 0xf2a33d, edge: 0xd68522, number: 0x2b1b10 },
  opponent: { body: 0x7c5cff, edge: 0x4c3b8c, number: 0xf5f1ff },
};

export const SCENE_BACKGROUND = 0x12111a;
export const OPPONENT_FLOOR_COLOR = 0x241c38;
export const PLAYER_FLOOR_COLOR = 0x2a1c11;
export const WALL_COLOR = 0xe8d9b5;

// ---------- The tray ----------
export const TRAY_HALF_WIDTH = 3.1;
export const TRAY_DEPTH = 3.4; // depth of ONE side; the whole tray is twice this

// Half-thickness of a wall - thick enough to read as a real tray wall, not a
// line, and thick enough that a fast die is far less likely to tunnel through.
export const WALL_T = 0.2;
// Walls are tall enough that even the hardest possible throw (bounded by
// MAX_THROW_SPEED / LIFT_FACTOR below) can't sail over them - the middle one
// included, so the two dice truly can't cross into each other's zone. The
// COLLIDER is tall; what's actually DRAWN is only a short strip at its base, so
// the wall blocks throws well above what you can see of it.
export const WALL_HALF_HEIGHT = 1.3; // physics only
export const WALL_VISIBLE_HALF_HEIGHT = 0.09; // the visible rim

// ---------- The die ----------
export const DIE_RADIUS = 0.62;

// ---------- Camera ----------
// Near/far are deliberately tight around what is ever actually on screen (the
// camera sits ~11.5-15 units from anything in the tray) rather than a generic
// 0.1-50 span. A wide near/far range starves the depth buffer of precision in
// the range that matters, which once caused the etched numbers to lose the
// depth test against the very face they sit on - on some GPUs only.
export const CAMERA_FOV = 40;
export const CAMERA_NEAR = 8;
export const CAMERA_FAR = 20;
export const CAMERA_POSITION = [0, 12.5, 4.4];
export const CAMERA_LOOK_AT = [0, 0, 0.2];

// ---------- Throw feel ----------
export const HELD_HEIGHT = DIE_RADIUS + 0.5; // how high the die floats while held
export const HISTORY_MS = 120; // release velocity is averaged over this recent window
export const THROW_POWER = 1.5; // drag speed -> linear throw speed
export const MAX_THROW_SPEED = 9; // so a wild swipe can't send the die off-scale
export const MAX_LIFT_SPEED = 2.6; // bounds how high a throw can arc
export const LIFT_FACTOR = 0.3; // upward toss proportional to horizontal speed
export const SPIN_POWER = 2.2; // throw speed/direction -> tumbling spin
// Below this much total movement a release is a fumble, not a throw. See
// input.js for why this is measured as distance rather than speed.
export const MIN_DRAG_DISTANCE = 0.35;

// ---------- Match ----------
export const HEARTS_PER_SIDE = 3;
export const SETTLE_TIMEOUT_MS = 4000; // give up waiting for a die to come to rest
export const GAME_OVER_LINGER_MS = 2600; // how long the match-over card stays up
