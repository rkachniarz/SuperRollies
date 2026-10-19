// The physics: the tray's colliders and the dice in flight, simulated by Rapier.
//
// Nothing here touches the DOM or draws anything, so this exact code also runs
// in Node (see tools/phase0/), which is how a throw can be checked and replayed
// outside the page.
//
// A world lives for exactly one throw. createRoundSim() builds a fresh one from
// a release record - where each die was let go, how it was oriented, and how
// fast it was moving and spinning - and steps it until the dice settle. Fresh
// rather than long-lived because an engine carries internal state from step to
// step (contact caches, solver warm-starting) that no record could capture; a
// new world plus the record is the whole story, so the same record reaches the
// same result wherever it is simulated. The deterministic Rapier build is what
// makes "the same" mean bit-identical across browsers and machines.

import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { ShapeUtils, Vector2 } from 'three';
import {
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, DIVIDER_T, WALL_HALF_HEIGHT, DIE_RADIUS,
  PHYSICS_STEP, GRAVITY, SETTLE_SPEED, SETTLE_TIME, STILL_SPEED, STILL_TIME, SETTLE_TIMEOUT_MS,
  DIE_FRICTION, DIE_RESTITUTION, FLOOR_FRICTION, FLOOR_RESTITUTION,
  WALL_FRICTION, WALL_RESTITUTION, DIE_LINEAR_DAMPING, DIE_ANGULAR_DAMPING,
  HELD_HEIGHT, HOLD_PALM_SIZE, HOLD_PALM_FLAT, HOLD_PALM_SLOPE, HOLD_PALM_LIP, HOLD_PALM_LIP_SLOPE, HOLD_PALM_FINGERS, HOLD_PALM_FRICTION, HOLD_PALM_RESTITUTION, HOLD_MAX_DIE_SPEED,
  HOLD_FOLLOW, HOLD_MAX_ACCEL, HOLD_SWAY, HOLD_SWAY_HZ, HOLD_TILT, HOLD_CALM_SPEED, HOLD_HOP_CHANCE, HOLD_HOP, HOLD_HOP_SPIN,
  HOLD_SETTLE_STEPS, HOLD_SETTLE_DAMPING, HOLD_RELEASE_OVERLAP, WIND_FULL_TIME, WIND_END_TIME,
  ROPE_RADIUS, ROPE_FRICTION, ROPE_RESTITUTION, ROCK_MOVE, ROCK_TURN_COS,
} from './config.js';
import { SHAPES } from './die-shapes.js';

/**
 * One die at the moment it is let go. Arrays rather than objects so a record
 * serialises compactly and round-trips through JSON exactly.
 * @typedef {{
 *   id: string,          // which die this is, e.g. 'player'
 *   type: string,        // a die type (die-shapes.js), e.g. 'd20'
 *   s?: number,          // the dice set's die scale (default 1)
 *   p: number[],         // position [x, y, z]
 *   q: number[],         // orientation quaternion [x, y, z, w]
 *   v: number[],         // linear velocity
 *   w: number[],         // angular velocity
 *   fixed?: boolean,     // held where it is, for the others to bounce off (an explosion's pop)
 * }} DieRelease
 *
 * Everything needed to reproduce a throw.
 * @typedef {{
 *   v: 1,
 *   arenaHalfWidth: number,  // how far out a die's centre can be and stay on screen (see sideWallFace)
 *   divider?: boolean,       // whether the wall splitting the tray is there (default true; Zen and No Man's Land have none)
 *   tray?: Tray,             // the dice set's tray (default: The Classic's)
 *   holes?: Hole[],          // holes in the floor, each over a pit (Pothole; default none)
 *   wind?: number[] | null,  // a steady breeze, [x, z] in units/s², on every die still moving (Gusty Table)
 *   rope?: boolean,          // a rope lying down the middle, end to end (Tug of War; default none)
 *   dice: DieRelease[],
 * }} ThrowRecord
 *
 * @typedef {import('./rules/types.js').Hole} Hole
 *
 * The tray's size, inside its walls: half its width, and the depth of one
 * side (the whole tray is twice that).
 * @typedef {{ halfWidth: number, depth: number }} Tray
 */

/** @type {Tray} */
const CLASSIC_TRAY = { halfWidth: TRAY_HALF_WIDTH, depth: TRAY_DEPTH };

/** Convex-hull points for each die type, in the die's own frame. */
export const HULLS = Object.fromEntries(Object.entries(SHAPES).map(([type, shape]) => [type, shape.hull]));

const scaledHulls = new Map();
function hullFor(type, scale) {
  if (scale === 1) return HULLS[type];
  const key = type + '|' + scale;
  if (!scaledHulls.has(key)) scaledHulls.set(key, HULLS[type].map((x) => x * scale));
  return scaledHulls.get(key);
}

/** A die's circumradius: how far its furthest corner reaches from its centre. */
function radiusOf(type, scale) {
  return SHAPES[type]?.circumradius * scale || DIE_RADIUS * scale;
}

const SETTLE_STEPS = Math.ceil(SETTLE_TIME / PHYSICS_STEP);
const STILL_SPEED_SQ = STILL_SPEED * STILL_SPEED;
const STILL_STEPS = Math.ceil(STILL_TIME / PHYSICS_STEP);
export const TIMEOUT_STEPS = Math.ceil(SETTLE_TIMEOUT_MS / 1000 / PHYSICS_STEP);
const SETTLE_SPEED_SQ = SETTLE_SPEED * SETTLE_SPEED;
const ROCK_MOVE_SQ = ROCK_MOVE * ROCK_MOVE;
// How far a die Rapier says is asleep may drift before it's woken (see
// step()). Asleep dice routinely drop 3.5 mm, once, and stop (half the
// recorded table throws do it): too little to see, and waking them would
// change those throws. The fall this is for is centimetres.
const ASLEEP_DRIFT_SQ = 0.01 * 0.01;
// A breeze blows at full strength for the first of these many steps of a
// throw, then dies away by the second, so it can never keep a die from
// settling.
const WIND_STEPS = [Math.round(WIND_FULL_TIME / PHYSICS_STEP), Math.round(WIND_END_TIME / PHYSICS_STEP)];

// How close a contact point has to be to count as touching. Rapier also
// reports points a little apart (it predicts contacts before they happen).
const TOUCHING = 0.01;
// The same between two dice. Rapier holds two moving bodies resting on each
// other a little apart - 1-2 cm, measured on d20s leaning on each other - where
// a die rests on the floor at ~0. With the floor's threshold, a die leaning on
// another never counted as at rest. Still far closer than any corner of a die
// balanced on an edge gets to the floor.
const TOUCHING_DIE = 0.03;
// The smallest triangle of touching points that counts as resting on a face,
// as (twice its area) squared. A die's smallest face is far larger; points
// along a single edge make a triangle of ~zero area.
const MIN_REST_AREA_SQ = (2 * 0.005) ** 2;

let ready = null;

/** Loads the WebAssembly. Everything else here needs it to have resolved. */
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

/**
 * How far out the side walls' inner faces are. Normally the tray's own walls -
 * but on a narrow screen (a phone held upright) the tray is wider than what is
 * on screen, and a die resting off screen can't be tapped, which would strand
 * the match. arena.js works out how far out a die's centre can be and still be
 * visible; the side walls move in to match, as invisible walls at the screen's
 * edges. Real colliders, so a die bounces off them and settles against them
 * just as it does against the tray's own walls.
 */
export function sideWallFace(arenaHalfWidth, tray = CLASSIC_TRAY) {
  return Math.min(tray.halfWidth, arenaHalfWidth + DIE_RADIUS);
}

/** The rope's radius in a tray (Tug of War): ROPE_RADIUS, scaled with the tray. */
export const ropeRadius = (tray) => ROPE_RADIUS * (tray.halfWidth / TRAY_HALF_WIDTH);

// A quarter turn about x, as a quaternion: lays a capsule (Rapier's run along
// y) along z. Written out rather than from Math.sin/cos, whose last bit may
// differ between JavaScript engines (see HOLE_CORNERS).
const ALONG_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

/** Builds the tray's colliders; returns the rope's, if there is one. */
function addTray(world, divider, sideFace, tray, holes = [], rope = false) {
  const { halfWidth, depth } = tray;
  // The floor is a thick slab rather than a plane, so a die driven hard into
  // it has a body of material to be pushed back out of, not a surface to slip
  // past. With holes in it, it's built round them instead (addHoledFloor).
  if (holes.length) addHoledFloor(world, halfWidth + 1, depth + 1, holes);
  else {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth * 4, 1, depth * 4)
        .setTranslation(0, -1, 0)
        .setFriction(FLOOR_FRICTION)
        .setRestitution(FLOOR_RESTITUTION)
    );
  }

  // Same layout as the visible walls in arena.js (bar the side walls on a
  // narrow screen, see sideWallFace), but WALL_HALF_HEIGHT tall: high enough
  // that no throw can sail over one.
  const addWall = (x, z, sx, sz) => world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx, WALL_HALF_HEIGHT, sz)
      .setTranslation(x, WALL_HALF_HEIGHT, z)
      .setFriction(WALL_FRICTION)
      .setRestitution(WALL_RESTITUTION)
  );
  addWall(-sideFace - WALL_T, 0, WALL_T, depth + WALL_T * 2); // left
  addWall(sideFace + WALL_T, 0, WALL_T, depth + WALL_T * 2); // right
  addWall(0, -depth - WALL_T, halfWidth + WALL_T * 2, WALL_T); // far edge
  addWall(0, depth + WALL_T, halfWidth + WALL_T * 2, WALL_T); // near edge
  if (divider) addWall(0, 0, halfWidth + WALL_T * 2, DIVIDER_T);

  // Tug of War's rope: a capsule lying on the floor down the middle, wall to
  // wall, through the divider. Low and round, so a die rolls over it as
  // often as it bounces off.
  if (rope) {
    const r = ropeRadius(tray);
    return world.createCollider(
      RAPIER.ColliderDesc.capsule(depth - r, r)
        .setTranslation(0, r, 0)
        .setRotation(ALONG_Z)
        .setFriction(ROPE_FRICTION)
        .setRestitution(ROPE_RESTITUTION)
    );
  }
  return null;
}

// cos(k pi / 16) for k = 0..8: a hole is a 32-sided polygon. Written out
// rather than computed, because Math.cos's last bit may differ between
// JavaScript engines, and a hole's corners must be bit-identical everywhere
// for a throw to replay the same (DEV_PLAN.md D10).
const COS_16THS = [
  1, 0.9807852804032304, 0.9238795325112867, 0.8314696123025452, 0.7071067811865476,
  0.5555702330196023, 0.38268343236508984, 0.19509032201612833, 0,
];
/** The corners of a 32-sided polygon of radius 1, anticlockwise from +x (seen from below +y). */
export const HOLE_CORNERS = Array.from({ length: 32 }, (_, k) => {
  const q = k % 16;
  const c = q <= 8 ? COS_16THS[q] : -COS_16THS[16 - q];
  const s = q <= 8 ? COS_16THS[8 - q] : COS_16THS[q - 8];
  return k < 16 ? [c, s] : [-c, -s];
});

/**
 * The floor with holes in it (Pothole), each over a round pit: one triangle
 * mesh for its top, the pits' walls and their bottoms, which join up, so
 * there's no gap between pieces for a die to slip into. A few cm under the
 * mesh, solid boxes stand in for the slab, so a die driven hard into the
 * floor still has a body of material to be pushed back out of.
 *
 * Without Rapier's FIX_INTERNAL_EDGES, measured both ways: with it, a die
 * spinning flat where several triangles meet could take 3 s or more to stop
 * (on the slab, half a second), and Fireball timed out in 1 throw in 6.
 * Without it, dice settle as fast as on the slab; the cost is a slightly
 * bumpier floor where triangles meet (a sliding die's hardest bounce up 2.0
 * units/s against the slab's 1.5).
 * @param {RAPIER.World} world
 * @param {number} w  Half the floor's width.
 * @param {number} d  Half the floor's length.
 * @param {Hole[]} holes
 */
function addHoledFloor(world, w, d, holes) {
  const rims = holes.map(({ x, z, r }) => HOLE_CORNERS.map(([c, s]) => [x + c * r, z + s * r]));
  /** @type {number[]} */
  const verts = [];
  /** @type {number[]} */
  const indices = [];
  const vertex = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    verts.push(x, y, z);
    return verts.length / 3 - 1;
  };
  // A triangle wound so its normal points `out` of the solid floor: along
  // `out` as a direction, or towards it as a point if `toPoint`.
  const triangle = (a, b, c, out, toPoint = false) => {
    const at = (/** @type {number} */ i, /** @type {number} */ k) => verts[i * 3 + k];
    const u = [0, 1, 2].map((k) => at(b, k) - at(a, k));
    const v = [0, 1, 2].map((k) => at(c, k) - at(a, k));
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dir = toPoint ? [0, 1, 2].map((k) => out[k] - at(a, k)) : out;
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  // The top: the floor's outline with the holes cut out, triangulated.
  const outline = [[-w, -d], [w, -d], [w, d], [-w, d]];
  const top = [...outline, ...rims.flat()].map(([px, pz]) => vertex(px, 0, pz));
  const triangles = ShapeUtils.triangulateShape(
    outline.map(([px, pz]) => new Vector2(px, pz)),
    rims.map((rim) => rim.map(([px, pz]) => new Vector2(px, pz)))
  );
  for (const [a, b, c] of triangles) triangle(top[a], top[b], top[c], [0, 1, 0]);

  // Each pit: its wall, facing in, from the rim (the very same corners as
  // the top's, so the mesh joins up) down to its bottom; and the bottom.
  let first = outline.length;
  holes.forEach(({ x, z, depth }, h) => {
    const rim = rims[h].map((_, i) => top[first + i]);
    first += rim.length;
    const floor = rims[h].map(([px, pz]) => vertex(px, -depth, pz));
    const middle = vertex(x, -depth, z);
    const inside = [x, -depth / 2, z];
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      triangle(rim[i], rim[j], floor[j], inside, true);
      triangle(rim[i], floor[j], floor[i], inside, true);
      triangle(middle, floor[i], floor[j], [0, 1, 0]);
    }
  });
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(indices), RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES)
      .setFriction(FLOOR_FRICTION)
      .setRestitution(FLOOR_RESTITUTION)
  );

  // The solid underneath, BACKING below the surface: a grid cut along each
  // hole's bounding square, every cell bar those inside one (runs of cells
  // along x merged into one box), and a slab under each pit's bottom.
  const BACKING = 0.05;
  const slab = (x0, x1, z0, z1, below) => world.createCollider(
    RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 1, (z1 - z0) / 2)
      .setTranslation((x0 + x1) / 2, -below - 1, (z0 + z1) / 2)
      .setFriction(FLOOR_FRICTION)
      .setRestitution(FLOOR_RESTITUTION)
  );
  const cuts = (/** @type {number} */ edge, /** @type {(h: Hole) => number} */ at) =>
    [...new Set([-edge, edge, ...holes.flatMap((h) => [at(h) - h.r, at(h) + h.r])])].sort((a, b) => a - b);
  const xs = cuts(w, (h) => h.x);
  const zs = cuts(d, (h) => h.z);
  const inHole = (/** @type {number} */ cx, /** @type {number} */ cz) =>
    holes.some((h) => Math.abs(cx - h.x) < h.r && Math.abs(cz - h.z) < h.r);
  for (let j = 0; j + 1 < zs.length; j++) {
    let start = null;
    for (let i = 0; i < xs.length; i++) {
      const solid = i + 1 < xs.length && !inHole((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
      if (solid && start === null) start = i;
      if (!solid && start !== null) {
        slab(xs[start], xs[i], zs[j], zs[j + 1], BACKING);
        start = null;
      }
    }
  }
  for (const h of holes) slab(h.x - h.r, h.x + h.r, h.z - h.r, h.z + h.r, h.depth + BACKING);
}

/**
 * A safety net under the walls: a die whose centre is past a wall's inner face
 * has gone through it, so it is put back inside. Rapier's continuous collision
 * detection should mean this never happens (Check C, tools/phase0/, has never
 * seen it), but it costs next to nothing.
 *
 * Only for that. It used to also hold dice to the on-screen limit, by moving
 * them - which made it an invisible, frictionless wall that dice could come to
 * rest leaning against, or crawl down for seconds. The side walls do that
 * job now (sideWallFace).
 */
function clampToArena(body, xFace, depth, radius) {
  const t = body.translation();
  let { x, z } = t;
  if (x >= -xFace && x <= xFace && z >= -depth && z <= depth) return;
  const v = body.linvel();
  if (x < -xFace) { x = -xFace + radius; if (v.x < 0) v.x = 0; }
  else if (x > xFace) { x = xFace - radius; if (v.x > 0) v.x = 0; }
  if (z < -depth) { z = -depth + radius; if (v.z < 0) v.z = 0; }
  else if (z > depth) { z = depth - radius; if (v.z > 0) v.z = 0; }
  body.setTranslation({ x, y: t.y, z }, true);
  body.setLinvel(v, true);
}

/**
 * Whether a die is resting on a face rather than balanced on an edge or a
 * point: the places it touches must span an actual area, not a line. (Counting
 * contact points is not enough - Rapier can report several along one edge.) A
 * die cocked against a wall or another die also passes, across the floor and
 * what it leans on, and it is genuinely at rest, so that's right.
 */
function restsOnFace(world, collider) {
  const points = [];
  world.contactPairsWith(collider, (other) => {
    const touching = other.parent() ? TOUCHING_DIE : TOUCHING;
    // A floor with holes in it (a triangle mesh) has no solver contacts to
    // read here: Rapier reports its contacts only as raw ones. Their point
    // on the mesh is in world space, as the mesh sits at the origin,
    // unturned. Only for the mesh, so every other floor settles exactly as
    // its recorded throws did.
    if (other.shapeType() === RAPIER.ShapeType.TriMesh) {
      world.contactPair(collider, other, (manifold, flipped) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) < touching) {
            points.push(flipped ? manifold.localContactPoint1(i) : manifold.localContactPoint2(i));
          }
        }
      });
      return;
    }
    world.contactPair(collider, other, (manifold) => {
      for (let i = 0; i < manifold.numSolverContacts(); i++) {
        if (manifold.solverContactDist(i) < touching) points.push(manifold.solverContactPoint(i));
      }
    });
  });
  // Twice the largest triangle any three touching points make.
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const a = points[i], b = points[j], c = points[k];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        if (cx * cx + cy * cy + cz * cz > MIN_REST_AREA_SQ) return true;
      }
    }
  }
  return false;
}

/**
 * Whether any other die is in contact with this one (or about to be: Rapier
 * reports contacts a little before they happen, which errs on the safe side).
 * The tray's colliders belong to no body; every die's does.
 */
function touchesAnotherDie(world, collider) {
  let touching = false;
  world.contactPairsWith(collider, (other) => { if (other.parent()) touching = true; });
  return touching;
}

function readPose(body) {
  const t = body.translation();
  const r = body.rotation();
  return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
}

// The palm a handful is held in (see createHoldSim): a shallow bowl, flat in
// the middle, its slope rising to a steep lip, with fingers standing up round
// it and curled over at the tips. Built from flat panels round
// the middle, like the staves of a barrel.
const PALM_PANELS = 16;
const PALM_T = 0.05; // half the thickness of the palm's panels
// The palm's flat middle is this far below where a lone held die floats.
const PALM_Y = HELD_HEIGHT - DIE_RADIUS;

/**
 * The palm for `count` dice, of circumradius `radius` at most: the bowl's
 * radius - room for them all in one layer, loosely - the lip's and the
 * fingers' lengths, and how far the whole palm, fingers and all, reaches from
 * its centre, shaking included (for clampToTray in arena.js, so the palm never
 * passes through a wall).
 * @param {number} count
 * @param {number} radius
 */
export function palmFor(count, radius) {
  const bowl = radius * (HOLD_PALM_SIZE[0] + HOLD_PALM_SIZE[1] * Math.sqrt(count));
  const lip = HOLD_PALM_LIP * radius;
  const outer = bowl + lip * Math.cos(HOLD_PALM_LIP_SLOPE) + PALM_T * 2;
  return { bowl, lip, fingers: HOLD_PALM_FINGERS * radius, reach: { x: outer + HOLD_SWAY, z: outer } };
}

const quatMul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
/**
 * Where dice `spacing` apart can start in a palm, their centres no further than
 * `room` from its middle: packed side by side in a hexagonal grid, nearest the
 * middle first, and the dips between them for a second layer. Of three ways to
 * line the grid up (a die in the middle, two either side of it, three round
 * it), the one that fits the most dice.
 */
function startingSpots(spacing, room) {
  const rowGap = (spacing * Math.sqrt(3)) / 2;
  const grid = (dx, dz) => {
    const spots = [];
    for (let row = -8; row <= 8; row++) {
      for (let col = -8; col <= 8; col++) {
        const x = (col + (row & 1) / 2) * spacing + dx;
        const z = row * rowGap + dz;
        if (x * x + z * z <= room * room) spots.push([x, z]);
      }
    }
    return spots.sort(([ax, az], [bx, bz]) => ax * ax + az * az - (bx * bx + bz * bz));
  };
  let best = null;
  for (const [dx, dz] of [[0, 0], [spacing / 2, 0], [spacing / 2, rowGap / 3]]) {
    const flat = grid(dx, dz);
    if (!best || flat.length > best[0].length) best = [flat, grid(dx + spacing / 2, dz + rowGap / 3)];
  }
  return best;
}

/**
 * How far a die reaches from its centre, turned as it is (`q`): sideways in
 * any direction, and up or down.
 */
function extent({ type, s, q: [x, y, z, w] }) {
  let side = 0;
  let up = 0;
  for (const [vx, vy, vz] of SHAPES[type].verts) {
    // The vertex turned by q: v + 2w(u x v) + 2u x (u x v), u = (x, y, z).
    const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
    const px = vx + 2 * (w * cx + y * cz - z * cy);
    const py = vy + 2 * (w * cy + z * cx - x * cz);
    const pz = vz + 2 * (w * cz + x * cy - y * cx);
    side = Math.max(side, px * px + pz * pz);
    up = Math.max(up, Math.abs(py));
  }
  return { side: Math.sqrt(side) * s, up: up * s };
}
const aboutY = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const aboutZ = (a) => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });

/** The palm's colliders, on `body`, with its flat middle's top at the body's origin. */
function addPalm(world, body, { bowl, lip, fingers }) {
  const flat = bowl * HOLD_PALM_FLAT;
  const collider = (desc) => world.createCollider(
    desc.setFriction(HOLD_PALM_FRICTION).setRestitution(HOLD_PALM_RESTITUTION), body
  );
  collider(RAPIER.ColliderDesc.cylinder(PALM_T, flat).setTranslation(0, -PALM_T, 0));
  // A ring of panels whose top faces start `from` the centre at height `y`
  // and run outward `length`, rising at `slope`. Returns the height reached.
  const ring = (from, y, length, slope) => {
    // Wide enough at their outer ends to close the ring, with some overlap.
    const outer = Math.max(from, from + length * Math.cos(slope));
    const halfWide = outer * Math.tan(Math.PI / PALM_PANELS) * 1.15;
    const r = from + (length / 2) * Math.cos(slope) + PALM_T * Math.sin(slope);
    const h = y + (length / 2) * Math.sin(slope) - PALM_T * Math.cos(slope);
    for (let i = 0; i < PALM_PANELS; i++) {
      const turn = (i / PALM_PANELS) * Math.PI * 2;
      collider(RAPIER.ColliderDesc.cuboid(length / 2 + PALM_T, PALM_T, halfWide)
        .setTranslation(r * Math.cos(turn), h, -r * Math.sin(turn))
        .setRotation(quatMul(aboutY(turn), aboutZ(slope))));
    }
    return y + length * Math.sin(slope);
  };
  const rim = ring(flat, 0, (bowl - flat) / Math.cos(HOLD_PALM_SLOPE), HOLD_PALM_SLOPE);
  const top = ring(bowl, rim, lip, HOLD_PALM_LIP_SLOPE);
  // And the fingers: straight up from the lip, their tips curled in over the
  // dice. Without them a hand jerked about hard had dice riding up the lip
  // and over it, and without the tips a d20 could still roll up them and out.
  const edge = bowl + lip * Math.cos(HOLD_PALM_LIP_SLOPE);
  const tips = ring(edge, top, fingers, Math.PI / 2);
  ring(edge, tips, fingers / 2, Math.PI * 0.8);
}

/**
 * A handful being held: its dice lying in a cupped palm, under gravity. The
 * palm follows the hand and is gently shaken and rocked as it goes, so the
 * dice slide and roll about in it and knock into each other - the outer ones,
 * on the slope, most - and now and then one hops. Rapier keeps them from
 * overlapping each other, so wherever they are when let go is a fair start for
 * the throw.
 *
 * Not part of a throw's record and not deterministic (it follows the pointer
 * and the frame rate) - like the pointer itself, it only decides where the
 * dice are when let go, which the record then captures.
 *
 * @param {{ arenaHalfWidth: number, divider: boolean, tray: Tray,
 *   dice: { type: string, s: number, q: number[] }[], centre: number[] }} hold
 *   The dice, each turned as it was picked up; where the hand is, [x, z]; and
 *   the table it's all held over.
 * @param {() => number} rand  A seeded stream, for the hops and the shake.
 */
export function createHoldSim({ arenaHalfWidth, divider, tray, dice, centre }, rand) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  // Dice squeezed together in a bowl, jostled, sink into each other more than
  // anything in a throw; more solver passes and stiffer contacts (Rapier's are
  // soft springs) keep that shallow. Only here: a throw's world keeps the
  // defaults its records rely on.
  world.numSolverIterations = 8;
  world.integrationParameters.contact_natural_frequency = 120;
  addTray(world, divider, sideWallFace(arenaHalfWidth, tray), tray);
  const radius = Math.max(...dice.map((d) => radiusOf(d.type, d.s)));
  const size = palmFor(dice.length, radius);
  const palm = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(centre[0], PALM_Y, centre[1])
  );
  addPalm(world, palm, size);
  const middle = size.bowl * HOLD_PALM_FLAT;
  const rim = (size.bowl - middle) * Math.tan(HOLD_PALM_SLOPE);
  // How high the palm is `r` out from its centre.
  const palmHeight = (r) => (r < size.bowl
    ? Math.max(0, r - middle) * Math.tan(HOLD_PALM_SLOPE)
    : rim + (r - size.bowl) * Math.tan(HOLD_PALM_LIP_SLOPE));

  // The dice start packed into the palm side by side, as many as fit, each
  // turned as it lay on the table and dropped in from just above the palm so
  // no corner starts inside it. The rest start one layer up, in the dips
  // between the dice below, to tumble in: like dice scooped up together.
  const extents = dice.map(extent);
  const spacing = 2 * Math.max(...extents.map((e) => e.side)) + 0.01;
  const room = size.bowl + size.lip * Math.cos(HOLD_PALM_LIP_SLOPE) - spacing / 2;
  const [flat, dips] = startingSpots(spacing, room);
  const spots = [...flat, ...dips].slice(0, dice.length);
  const placed = [];
  const bodies = dice.map((d, i) => {
    const { side, up } = extents[i];
    const [ox, oz] = spots[i];
    let y = PALM_Y + palmHeight(Math.sqrt(ox * ox + oz * oz) + side) + up + 0.01;
    for (const p of placed) {
      const apart = p.side + side;
      if ((p.x - ox) ** 2 + (p.z - oz) ** 2 < apart * apart) y = Math.max(y, p.y + p.up + up + 0.01);
    }
    placed.push({ x: ox, y, z: oz, side, up });
    const [qx, qy, qz, qw] = d.q;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(centre[0] + ox, y, centre[1] + oz)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinearDamping(DIE_LINEAR_DAMPING)
        .setAngularDamping(DIE_ANGULAR_DAMPING)
        .setCcdEnabled(true)
        .setCanSleep(false)
    );
    world.createCollider(
      RAPIER.ColliderDesc.convexHull(hullFor(d.type, d.s)).setFriction(DIE_FRICTION).setRestitution(DIE_RESTITUTION),
      body
    );
    return body;
  });

  // The palm's own motion: where it is (before the shake), how fast it's
  // going, and how far through a shake.
  const at = [centre[0], centre[1]];
  const xMax = sideWallFace(arenaHalfWidth, tray) - size.reach.x;
  const zMin = (divider ? DIVIDER_T : -tray.depth) + size.reach.z;
  const zMax = tray.depth - size.reach.z;
  const speed = [0, 0];
  let phase = rand() * Math.PI * 2;
  let shake = 1;
  let rescued = 0;
  const k = HOLD_FOLLOW * HOLD_FOLLOW;
  const c = 2 * HOLD_FOLLOW;

  return {
    /** One PHYSICS_STEP, the palm chasing `hand` ([x, z]). */
    step(hand) {
      let ax = k * (hand[0] - at[0]) - c * speed[0];
      let az = k * (hand[1] - at[1]) - c * speed[1];
      const aSq = ax * ax + az * az;
      if (aSq > HOLD_MAX_ACCEL * HOLD_MAX_ACCEL) {
        const s = HOLD_MAX_ACCEL / Math.sqrt(aSq);
        ax *= s; az *= s;
      }
      speed[0] += ax * PHYSICS_STEP;
      speed[1] += az * PHYSICS_STEP;
      at[0] += speed[0] * PHYSICS_STEP;
      at[1] += speed[1] * PHYSICS_STEP;
      // Never past where the hand itself may go (clampToTray in arena.js):
      // its acceleration capped, the palm can overshoot the hand, and it
      // carried the dice into a wall.
      for (const [axis, lo, hi] of [[0, -xMax, xMax], [1, zMin, zMax]]) {
        const bound = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, at[axis]));
        if (bound !== at[axis]) { at[axis] = bound; speed[axis] = 0; }
      }
      phase += HOLD_SWAY_HZ * Math.PI * 2 * PHYSICS_STEP;
      // Shaken while held about in one place, less and less the faster the
      // hand is going anywhere: nobody shakes their hand while sweeping it
      // across the table, and doing both flung dice out of the palm.
      const calm = 1 / (1 + (speed[0] * speed[0] + speed[1] * speed[1]) / (HOLD_CALM_SPEED * HOLD_CALM_SPEED));
      shake += (calm - shake) * Math.min(1, PHYSICS_STEP * 8);
      palm.setNextKinematicTranslation({ x: at[0] + Math.sin(phase) * HOLD_SWAY * shake, y: PALM_Y, z: at[1] });
      // Rocked about the hand's length as it sways: dipping toward the side
      // it's heading for.
      palm.setNextKinematicRotation(aboutZ(-Math.cos(phase) * HOLD_TILT * shake));
      for (const body of bodies) {
        // A safety net, like clampToArena: a die that has somehow left the
        // palm is dropped back in, from above the rest. check-handfuls.mjs
        // counts how often it's needed.
        const t = body.translation();
        const dx = t.x - at[0];
        const dz = t.z - at[1];
        if (t.y < PALM_Y || dx * dx + dz * dz > size.reach.x * size.reach.x) {
          body.setTranslation({ x: at[0], y: PALM_Y + palmHeight(size.reach.x) + radius * 2, z: at[1] }, true);
          body.setLinvel({ x: speed[0], y: 0, z: speed[1] }, true);
          rescued++;
        }
        // No faster than a die in a hand ever goes, relative to the hand.
        // Dice that wedge into each other on the bowl's slope - d8s above all,
        // whose sides slope like ramps - were fired out of it at 10-16 units/s
        // by the stiff contacts above, against a palm moving at 5 at most.
        const v = body.linvel();
        const rx = v.x - speed[0];
        const rz = v.z - speed[1];
        const rSq = rx * rx + v.y * v.y + rz * rz;
        if (rSq > HOLD_MAX_DIE_SPEED * HOLD_MAX_DIE_SPEED) {
          const f = HOLD_MAX_DIE_SPEED / Math.sqrt(rSq);
          body.setLinvel({ x: speed[0] + rx * f, y: v.y * f, z: speed[1] + rz * f }, true);
        }
        if (rand() >= HOLD_HOP_CHANCE) continue;
        const m = body.mass();
        body.applyImpulse({ x: 0, y: HOLD_HOP * m * (0.6 + rand() * 0.8), z: 0 }, true);
        const w = body.angvel();
        const spin = () => (rand() - 0.5) * 2 * HOLD_HOP_SPIN;
        body.setAngvel({ x: w.x + spin(), y: w.y + spin(), z: w.z + spin() }, true);
      }
      world.step();
    },
    /** Where each die is and how it's turned, in the order given. */
    poses: () => bodies.map(readPose),
    /** How many times a die has had to be put back in the palm. */
    get rescued() { return rescued; },
    /** How far the two most deeply overlapping things (dice, palm or walls) are inside each other. */
    deepestOverlap() {
      let deepest = 0;
      for (const body of bodies) {
        const collider = body.collider(0);
        world.contactPairsWith(collider, (other) => {
          world.contactPair(collider, other, (manifold) => {
            for (let i = 0; i < manifold.numSolverContacts(); i++) {
              deepest = Math.max(deepest, -manifold.solverContactDist(i));
            }
          });
        });
      }
      return deepest;
    },
    /**
     * Gets the dice ready to be let go: with the palm held still, a few steps
     * let the contacts push apart any dice the jostling left overlapping, so
     * the throw never starts with them inside each other or a wall (CLAUDE.md:
     * Rapier would fling them apart). Heavily damped, so they part and stop
     * rather than fly. (Zeroing their velocities instead stalls it: that
     * throws away the very motion that separates them.) Never drawn: it takes
     * no time on screen. Returns how deep the worst overlap still is.
     */
    settle() {
      for (const body of bodies) {
        body.setLinearDamping(HOLD_SETTLE_DAMPING);
        body.setAngularDamping(HOLD_SETTLE_DAMPING);
      }
      for (let i = 0; i < HOLD_SETTLE_STEPS && this.deepestOverlap() > HOLD_RELEASE_OVERLAP; i++) world.step();
      return this.deepestOverlap();
    },
    free() { world.free(); },
  };
}

/**
 * Builds a fresh world for one throw. Call step() once per PHYSICS_STEP until
 * `done`, then free().
 *
 * `clamp: false` turns off the clampToArena safety net, so a test can see
 * whether the colliders alone hold the dice.
 *
 * @param {ThrowRecord} record
 * @param {{ clamp?: boolean }} [options]
 */
export function createRoundSim(record, { clamp = true } = {}) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  const tray = record.tray ?? CLASSIC_TRAY;
  const sideFace = sideWallFace(record.arenaHalfWidth, tray);
  const rope = addTray(world, record.divider ?? true, sideFace, tray, record.holes, record.rope);
  const wind = record.wind ?? null;

  const dice = record.dice.map((d) => {
    const [qx, qy, qz, qw] = d.q;
    const body = world.createRigidBody(
      (d.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
        .setTranslation(d.p[0], d.p[1], d.p[2])
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinvel(d.v[0], d.v[1], d.v[2])
        .setAngvel({ x: d.w[0], y: d.w[1], z: d.w[2] })
        .setLinearDamping(DIE_LINEAR_DAMPING)
        .setAngularDamping(DIE_ANGULAR_DAMPING)
        .setCcdEnabled(true)
        // Rapier's own sleeping is off: its default thresholds are loose
        // enough to freeze a die that is still slowly toppling off an edge,
        // leaving it balanced at an angle. The settle check in step() is the
        // only thing that puts a die to sleep.
        .setCanSleep(false)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.convexHull(hullFor(d.type, d.s ?? 1))
        .setFriction(DIE_FRICTION)
        .setRestitution(DIE_RESTITUTION),
      body
    );
    const pose = readPose(body);
    const radius = radiusOf(d.type, d.s ?? 1);
    const fixed = Boolean(d.fixed);
    return { id: d.id, type: d.type, radius, body, collider, prev: pose, curr: pose, quietSteps: 0, stillSteps: 0, settled: fixed, asleep: false, fixed };
  });

  // How long a die has stayed close to one pose (see ROCK_MOVE): the pose it's
  // measured from moves on whenever the die strays from it. Squared lengths
  // and a dot product only, so it's bit-exact everywhere.
  function rocking(d) {
    const from = d.rockFrom;
    const [px, py, pz] = d.curr.p;
    const q = d.curr.q;
    const near = from &&
      (px - from.p[0]) ** 2 + (py - from.p[1]) ** 2 + (pz - from.p[2]) ** 2 < ROCK_MOVE_SQ &&
      Math.abs(q[0] * from.q[0] + q[1] * from.q[1] + q[2] * from.q[2] + q[3] * from.q[3]) > ROCK_TURN_COS;
    if (near) d.rockSteps++;
    else {
      d.rockFrom = d.curr;
      d.rockSteps = 0;
    }
  }

  const sim = {
    world,
    dice,
    steps: 0,
    done: false,
    timedOut: false,

    step() {
      if (sim.done) return;
      // A breeze (Gusty Table) pushes every die still on the move, as an
      // impulse each step, for as long as the dice are rolling about, then
      // dies away (WIND_STEPS). One that has all but stopped is left be:
      // pushed on into a wall, a die jittered against it and never settled.
      const gust = wind ? Math.max(0, Math.min(1, (WIND_STEPS[1] - sim.steps) / (WIND_STEPS[1] - WIND_STEPS[0]))) : 0;
      if (gust > 0) {
        for (const d of dice) {
          const v = d.body.linvel();
          if (d.settled || v.x * v.x + v.y * v.y + v.z * v.z < SETTLE_SPEED_SQ) continue;
          const m = d.body.mass() * PHYSICS_STEP * gust;
          d.body.applyImpulse({ x: wind[0] * m, y: 0, z: wind[1] * m }, true);
        }
      }
      world.step();
      sim.steps++;
      for (const d of dice) {
        if (d.fixed) continue;
        if (clamp) clampToArena(d.body, sideFace, tray.depth, d.radius);
        d.prev = d.curr;
        d.curr = readPose(d.body);

        // Squared magnitudes rather than Math.hypot: hypot's last bit is
        // allowed to differ between JavaScript engines, and anything that
        // decides when the simulation stops has to be bit-exact everywhere.
        //
        // Slow is not enough on its own: a die toppling off an edge passes
        // through a slow moment at the tipping point, and stopping it there
        // leaves it balanced at an angle. So it must also be resting on a face
        // - or have been dead still for a good while, which a toppling die
        // never is. That catches a die cocked against a wall that Rapier holds
        // a hair off the floor at one corner, too far to count as touching:
        // a d12 does it in ~1 throw in 700, and waited out the timeout.
        const speedsSq = () => {
          const v = d.body.linvel();
          const w = d.body.angvel();
          return [v.x * v.x + v.y * v.y + v.z * v.z, w.x * w.x + w.y * w.y + w.z * w.z];
        };
        const [vSq, wSq] = speedsSq();
        d.stillSteps = vSq < STILL_SPEED_SQ && wSq < STILL_SPEED_SQ ? d.stillSteps + 1 : 0;
        // With a rope down (Tug of War): how long it's stayed within
        // ROCK_MOVE and 3 degrees of one pose, rocking in place or not.
        if (rope) rocking(d);
        const isQuiet = () => {
          if (rope && d.rockSteps >= STILL_STEPS) return true;
          const [v2, w2] = speedsSq();
          return v2 < SETTLE_SPEED_SQ && w2 < SETTLE_SPEED_SQ &&
            (d.stillSteps >= STILL_STEPS || restsOnFace(world, d.collider));
        };

        // Down a hole (Pothole), a die is out of play wherever it ends up,
        // so nothing waits for it: a heap of dice in a pit can shuffle
        // about for seconds. It goes on being simulated, so dice falling in
        // after it still land on it.
        if (d.fallen || d.curr.p[1] < 0) {
          d.fallen = true;
          d.settled = true;
          continue;
        }

        // A settled die stays settled until something moves it: one put to
        // sleep until another die knocks into it and wakes it, one left awake
        // (see below) until it stops being quiet. Then it has to settle all
        // over again.
        //
        // Rapier can also go on moving a die it says is asleep, with no
        // contact holding it up: a d4 hit hard by an aimed throw (No Man's
        // Land) fell 2.7 cm into the floor that way, about 1 throw in 500,
        // with no other die anywhere near it. So one it still calls asleep
        // that has sunk more than a centimetre since it was put to sleep is
        // woken, and the floor pushes it back out (see ASLEEP_DRIFT_SQ).
        if (d.settled) {
          const stirred = d.asleep && d.body.isSleeping() &&
            (d.curr.p[0] - d.sleptAt[0]) ** 2 + (d.curr.p[1] - d.sleptAt[1]) ** 2 + (d.curr.p[2] - d.sleptAt[2]) ** 2 > ASLEEP_DRIFT_SQ;
          if (stirred) d.body.wakeUp();
          else if (d.asleep ? d.body.isSleeping() : isQuiet()) continue;
          d.settled = false;
          d.asleep = false;
          d.quietSteps = 0;
        }
        d.quietSteps = isQuiet() ? d.quietSteps + 1 : 0;
        if (d.quietSteps >= SETTLE_STEPS) {
          d.settled = true;
          // Only put to sleep if no other die is touching it. Rapier doesn't
          // cope with a body sent to sleep while in contact with one still
          // awake: it reports it asleep, yet keeps applying gravity to it with
          // no contact to hold it up, and it sinks through the floor. (Never
          // seen with one die a side, which the divider keeps apart.)
          d.asleep = !touchesAnotherDie(world, d.collider);
          if (d.asleep) {
            d.body.sleep();
            d.sleptAt = d.curr.p;
          }
        }
      }
      // Anything that never settles (rare - e.g. balanced on an edge) is
      // simply stopped where it is, so a round can never soft-lock on physics.
      if (dice.every((d) => d.settled)) sim.done = true;
      else if (sim.steps >= TIMEOUT_STEPS) { sim.done = true; sim.timedOut = true; }
    },

    free() { world.free(); },
  };
  return sim;
}
