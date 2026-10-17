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
import {
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, WALL_HALF_HEIGHT, DIE_RADIUS,
  PHYSICS_STEP, GRAVITY, SETTLE_SPEED, SETTLE_TIME, SETTLE_TIMEOUT_MS,
  DIE_FRICTION, DIE_RESTITUTION, FLOOR_FRICTION, FLOOR_RESTITUTION,
  WALL_FRICTION, WALL_RESTITUTION, DIE_LINEAR_DAMPING, DIE_ANGULAR_DAMPING,
} from './config.js';
import { VERTS } from './d20.js';

/**
 * One die at the moment it is let go. Arrays rather than objects so a record
 * serialises compactly and round-trips through JSON exactly.
 * @typedef {{
 *   id: string,          // which die this is, e.g. 'player'
 *   type: string,        // key into HULLS, e.g. 'd20'
 *   p: number[],         // position [x, y, z]
 *   q: number[],         // orientation quaternion [x, y, z, w]
 *   v: number[],         // linear velocity
 *   w: number[],         // angular velocity
 * }} DieRelease
 *
 * Everything needed to reproduce a throw.
 * @typedef {{
 *   v: 1,
 *   arenaHalfWidth: number,  // how far out a die's centre can be and stay on screen (see sideWallFace)
 *   divider?: boolean,       // whether the wall splitting the tray is there (default true; Zen has none)
 *   dice: DieRelease[],
 * }} ThrowRecord
 */

/** Convex-hull points for each die type, in the die's own frame. */
export const HULLS = {
  d20: Float32Array.from(VERTS.flat()),
};

const SETTLE_STEPS = Math.ceil(SETTLE_TIME / PHYSICS_STEP);
export const TIMEOUT_STEPS = Math.ceil(SETTLE_TIMEOUT_MS / 1000 / PHYSICS_STEP);
const SETTLE_SPEED_SQ = SETTLE_SPEED * SETTLE_SPEED;

// How close a contact point has to be to count as touching. Rapier also
// reports points a little apart (it predicts contacts before they happen).
const TOUCHING = 0.01;
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
function sideWallFace(arenaHalfWidth) {
  return Math.min(TRAY_HALF_WIDTH, arenaHalfWidth + DIE_RADIUS);
}

function addTray(world, divider, sideFace) {
  // The floor is a thick slab rather than a plane, so a die driven hard into
  // it has a body of material to be pushed back out of, not a surface to slip
  // past.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(TRAY_HALF_WIDTH * 4, 1, TRAY_DEPTH * 4)
      .setTranslation(0, -1, 0)
      .setFriction(FLOOR_FRICTION)
      .setRestitution(FLOOR_RESTITUTION)
  );

  // Same layout as the visible walls in arena.js (bar the side walls on a
  // narrow screen, see sideWallFace), but WALL_HALF_HEIGHT tall: high enough
  // that no throw can sail over one.
  const addWall = (x, z, sx, sz) => world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx, WALL_HALF_HEIGHT, sz)
      .setTranslation(x, WALL_HALF_HEIGHT, z)
      .setFriction(WALL_FRICTION)
      .setRestitution(WALL_RESTITUTION)
  );
  addWall(-sideFace - WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // left
  addWall(sideFace + WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // right
  addWall(0, -TRAY_DEPTH - WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // far edge
  addWall(0, TRAY_DEPTH + WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // near edge
  if (divider) addWall(0, 0, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T * 1.4);
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
function clampToArena(body, xFace) {
  const t = body.translation();
  let { x, z } = t;
  if (x >= -xFace && x <= xFace && z >= -TRAY_DEPTH && z <= TRAY_DEPTH) return;
  const v = body.linvel();
  if (x < -xFace) { x = -xFace + DIE_RADIUS; if (v.x < 0) v.x = 0; }
  else if (x > xFace) { x = xFace - DIE_RADIUS; if (v.x > 0) v.x = 0; }
  if (z < -TRAY_DEPTH) { z = -TRAY_DEPTH + DIE_RADIUS; if (v.z < 0) v.z = 0; }
  else if (z > TRAY_DEPTH) { z = TRAY_DEPTH - DIE_RADIUS; if (v.z > 0) v.z = 0; }
  body.setTranslation({ x, y: t.y, z }, true);
  body.setLinvel(v, true);
}

/**
 * Whether a die is resting on a face rather than balanced on an edge or a
 * point: the places it touches must span an actual area, not a line. (Counting
 * contact points is not enough - Rapier can report several along one edge.) A
 * die cocked against a wall also passes, across the floor and the wall, and it
 * is genuinely at rest, so that's right.
 */
function restsOnFace(world, collider) {
  const points = [];
  world.contactPairsWith(collider, (other) => {
    world.contactPair(collider, other, (manifold) => {
      for (let i = 0; i < manifold.numSolverContacts(); i++) {
        if (manifold.solverContactDist(i) < TOUCHING) points.push(manifold.solverContactPoint(i));
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

function readPose(body) {
  const t = body.translation();
  const r = body.rotation();
  return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
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
  const sideFace = sideWallFace(record.arenaHalfWidth);
  addTray(world, record.divider ?? true, sideFace);

  const dice = record.dice.map((d) => {
    const [qx, qy, qz, qw] = d.q;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
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
      RAPIER.ColliderDesc.convexHull(HULLS[d.type])
        .setFriction(DIE_FRICTION)
        .setRestitution(DIE_RESTITUTION),
      body
    );
    const pose = readPose(body);
    return { id: d.id, type: d.type, body, collider, prev: pose, curr: pose, quietSteps: 0, settled: false };
  });

  const sim = {
    world,
    dice,
    steps: 0,
    done: false,
    timedOut: false,

    step() {
      if (sim.done) return;
      world.step();
      sim.steps++;
      for (const d of dice) {
        if (clamp) clampToArena(d.body, sideFace);
        d.prev = d.curr;
        d.curr = readPose(d.body);

        // A settled die put to sleep can be woken again by another die
        // knocking into it, at which point it has to settle all over again.
        if (d.settled && !d.body.isSleeping()) { d.settled = false; d.quietSteps = 0; }
        if (d.settled) continue;
        // Squared magnitudes rather than Math.hypot: hypot's last bit is
        // allowed to differ between JavaScript engines, and anything that
        // decides when the simulation stops has to be bit-exact everywhere.
        //
        // Slow is not enough on its own: a die toppling off an edge passes
        // through a slow moment at the tipping point, and stopping it there
        // leaves it balanced at an angle. So it must also be resting on a face.
        const v = d.body.linvel();
        const w = d.body.angvel();
        const quiet =
          v.x * v.x + v.y * v.y + v.z * v.z < SETTLE_SPEED_SQ &&
          w.x * w.x + w.y * w.y + w.z * w.z < SETTLE_SPEED_SQ &&
          restsOnFace(world, d.collider);
        d.quietSteps = quiet ? d.quietSteps + 1 : 0;
        if (d.quietSteps >= SETTLE_STEPS) { d.settled = true; d.body.sleep(); }
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
