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
export const PIT_COLOR = 0x08070c; // inside a pothole's pit

// ---------- The tray ----------
export const TRAY_HALF_WIDTH = 3.1;
export const TRAY_DEPTH = 3.4; // depth of ONE side; the whole tray is twice this

// Half-thickness of a wall - thick enough to read as a real tray wall, not a
// line, and thick enough that a fast die is far less likely to tunnel through.
export const WALL_T = 0.2;
export const DIVIDER_T = WALL_T * 1.4; // the wall between the two halves is a little heavier
// Walls are tall enough that even the hardest possible throw (bounded by
// MAX_THROW_SPEED / LIFT_FACTOR below) can't sail over them - the middle one
// included, so the two dice truly can't cross into each other's zone. The
// COLLIDER is tall; what's actually DRAWN is only a short strip at its base, so
// the wall blocks throws well above what you can see of it.
export const WALL_HALF_HEIGHT = 1.3; // physics only
export const WALL_VISIBLE_HALF_HEIGHT = 0.09; // the visible rim

// ---------- The die ----------
export const DIE_RADIUS = 0.62;

// ---------- Physics ----------
// The simulation always advances in steps of exactly this length, however fast
// or slow the screen refreshes, and the renderer interpolates between steps. A
// throw's outcome therefore depends only on how it was released, never on the
// frame rate - which is what lets a recorded throw be replayed exactly.
export const PHYSICS_HZ = 60;
export const PHYSICS_STEP = 1 / PHYSICS_HZ;
export const MAX_STEPS_PER_FRAME = 5; // a stalled tab slows the dice down rather than freezing
export const GRAVITY = -20;

// Rapier combines two colliders' coefficients by averaging them. These started
// out giving the same pairings the game had under cannon-es (die-floor
// friction 0.45 / bounce 0.3, die-wall 0.3 / 0.55, die-die 0.3 / 0.4), but the
// same numbers bounce noticeably less in Rapier - dice felt heavy. Die-floor
// bounce is now 0.375, which matches how high cannon-es's dice bounced on the
// same throws (measured side by side in Node, not by eye).
export const DIE_FRICTION = 0.3;
export const DIE_RESTITUTION = 0.4;
export const FLOOR_FRICTION = 0.6;
export const FLOOR_RESTITUTION = 0.35;
export const WALL_FRICTION = 0.3;
export const WALL_RESTITUTION = 0.7;
// Per-second damping rates. cannon-es's 0.05 / 0.35 were "fraction lost per
// second"; these are the equivalent continuous rates (-ln(1 - x)).
export const DIE_LINEAR_DAMPING = 0.05;
export const DIE_ANGULAR_DAMPING = 0.43;

// A die counts as settled once its linear and angular speeds have both stayed
// below SETTLE_SPEED for SETTLE_TIME seconds of simulated time, while resting
// on a face (see restsOnFace in physics.js).
export const SETTLE_SPEED = 0.22;
export const SETTLE_TIME = 0.22;
// Or, whatever it touches, once it has been all but motionless (both speeds
// under STILL_SPEED) for STILL_TIME: a die cocked against a wall can be
// perfectly still yet not quite count as resting on a face.
export const STILL_SPEED = 0.02;
export const STILL_TIME = 0.5;

// ---------- Camera ----------
// Placed for The Classic's tray; a bigger tray is framed from further back
// along the same line (fitCamera in arena.js). Near/far are not set here: they
// are computed tightly around whichever tray is in use, plus this margin,
// rather than a generic 0.1-50 span. A wide near/far range starves the depth
// buffer of precision in the range that matters, which once caused the etched
// numbers to lose the depth test against the very face they sit on - on some
// GPUs only.
export const CAMERA_FOV = 40;
export const CAMERA_POSITION = [0, 12.5, 4.4];
export const CAMERA_LOOK_AT = [0, 0, 0.2];
export const CAMERA_DEPTH_MARGIN = 0.5;

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

// ---------- A handful, held ----------
// Several dice held at once are simulated (createHoldSim in physics.js), lying
// in a cupped palm under gravity: a shallow bowl, flat in the middle, with a
// steep lip round the edge and fingers standing up round that, so they can't
// fall out. All of it unseen, like the hand. The palm follows the
// pointer, and is gently shaken side to side and tilted with it, so the dice
// slide and roll about in it - the outer ones on the slope most - and now and
// then one gives a little hop. One die alone is held still.
// The bowl's radius is HOLD_PALM_SIZE[0] + HOLD_PALM_SIZE[1] x the square root
// of how many dice it holds, times a die's circumradius: room for them all in
// one layer, loosely (palmFor in physics.js).
export const HOLD_PALM_SIZE = [0.75, 0.7];
export const HOLD_PALM_FLAT = 0.35; // the flat middle, as a fraction of the bowl's radius
export const HOLD_PALM_SLOPE = 0.2; // radians: the bowl's gentle slope (~11 degrees)
export const HOLD_PALM_LIP = 1.3; // the lip's length, x a die's circumradius
export const HOLD_PALM_LIP_SLOPE = 1.2; // radians: steep (~70 degrees), so nothing climbs out
export const HOLD_PALM_FINGERS = 1.5; // how far the fingers stand up above the lip, x a die's circumradius
export const HOLD_PALM_FRICTION = 0.8; // grippy, so dice roll rather than slide
export const HOLD_PALM_RESTITUTION = 0.05; // a hand is soft: dice barely bounce off it
// The palm chases the pointer like a critically damped spring of this natural
// frequency (rad/s), but never accelerates harder than HOLD_MAX_ACCEL: a palm
// jerked faster than gravity can hold the dice in it would fling them out.
export const HOLD_FOLLOW = 14;
export const HOLD_MAX_ACCEL = 14;
// The gentle shake: side to side by HOLD_SWAY either way, HOLD_SWAY_HZ times a
// second, rocking by up to HOLD_TILT radians as it goes.
export const HOLD_SWAY = 0.06;
export const HOLD_SWAY_HZ = 2.2;
export const HOLD_TILT = 0.2;
// The shake dies away as the hand moves: halved at this speed.
export const HOLD_CALM_SPEED = 1.5;
// Now and then a die is bumped up off the palm: a small hop, with barely any
// spin, so it lands on the same face it left.
export const HOLD_HOP_CHANCE = 0.008; // per die per step
export const HOLD_HOP = 1.3; // upward speed: ~4 cm high
export const HOLD_HOP_SPIN = 2;
// A held die never moves faster than this relative to the palm (units/s): a
// hop is 1.3, a die rolling across the bowl ~1-2. See createHoldSim.
export const HOLD_MAX_DIE_SPEED = 3;
// When let go, the held dice are given up to this many steps, unseen and
// heavily damped, to push apart until nothing overlaps by more than
// HOLD_RELEASE_OVERLAP. In practice it stalls at a few cm in the worst cases,
// which Rapier then separates gently (check-handfuls.mjs measures it); more
// steps don't help.
export const HOLD_SETTLE_STEPS = 30;
export const HOLD_SETTLE_DAMPING = 20; // per second, while they do
export const HOLD_RELEASE_OVERLAP = 0.005;

// ---------- Match ----------
export const HEARTS_PER_SIDE = 3;

// ---------- Spice on the table ----------
// Pothole: each hole's radius on The Classic's tray (scaled with the tray),
// wide enough for its biggest die, a d20, to drop in; and how deep the pit
// under it is, so a die down there sits wholly below the table.
export const POTHOLE_RADIUS = 0.85;
export const POTHOLE_DEPTH = 1.1;
// Cat Paw: the chance a paw swipes in once a round's dice have settled.
export const CAT_PAW_CHANCE = 0.4;
// Gusty Table: how hard the breeze pushes, as an acceleration (units/s²).
// Always well under what the floor's friction holds (~9), so it never shifts
// a die lying still; it only drifts the ones rolling.
export const WIND_MIN = 2.5;
export const WIND_MAX = 5;
// A gust, not a gale: full strength for the first WIND_FULL_TIME seconds of a
// throw, while the dice roll about, then dying away to nothing by
// WIND_END_TIME, so it never keeps a die from settling.
export const WIND_FULL_TIME = 1.5;
export const WIND_END_TIME = 2.5;
// Tug of War: the rope lying down the middle of the tray, from your end to
// the opponent's, on The Classic's tray (scaled with the tray). Thick enough
// to show over the divider it passes through (0.18 high), low enough that a
// die rolls over it as often as it bounces off.
export const ROPE_RADIUS = 0.1;
export const ROPE_FRICTION = 0.7;
export const ROPE_RESTITUTION = 0.2;
// A die propped against the rope on one corner rocks between the two, in
// place, for as long as you like: its speed peaks over SETTLE_SPEED every
// swing, so it never counted as settled, and Fireball timed out 1 throw in 6.
// With a rope down, a die that stays this close to one pose for STILL_TIME
// has settled, rocking or not.
export const ROCK_MOVE = 0.02; // units
export const ROCK_TURN_COS = 0.9996573; // cos of half of 3 degrees, written out (see physics.js)
export const SETTLE_TIMEOUT_MS = 4000; // simulated time; give up waiting for a die to come to rest
export const GAME_OVER_LINGER_MS = 2600; // how long the match-over card stays up
