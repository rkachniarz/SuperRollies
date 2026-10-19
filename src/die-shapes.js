// The die types, as shapes: vertices, the faces that carry a number, and
// everything derived from them that the rest of the game needs - outward
// normals, where each number sits, how a die lies at rest, which number is up,
// and where its numbers are printed.
//
// Pure geometry: no DOM and no physics engine, so it is shared by the drawing
// (dice.js), the colliders (physics.js) and the face reader (replay.js), and
// they can never disagree about which face is "the 6".

import * as THREE from 'three';
import { D4 } from './d4.js';
import { D6 } from './d6.js';
import { D8 } from './d8.js';
import { D10, D_PERCENT } from './d10.js';
import { D12 } from './d12.js';
import { D20 } from './d20.js';

/**
 * @typedef {Object} ShapeSpec
 * @property {string} type  e.g. 'd20'.
 * @property {number[][]} verts  Every corner, in the die's own frame.
 * @property {number[][]} faces  The numbered faces, as convex polygons of
 *   vertex indices, counter-clockwise seen from outside.
 * @property {number[]} numbers  The number on each of `faces`.
 * @property {number[][]} [plainFaces]  Faces with no number (a d6's chamfered
 *   corners). Drawn, but never read.
 * @property {'numeral' | 'pips'} label  How a face's number is drawn.
 * @property {(n: number) => string} [numeral]  The text printed for number
 *   `n`, where it isn't just the number (a d10's 10 is printed "0").
 * @property {'up' | 'down'} [reads]  Which face gives the roll: the one on top
 *   (default), or the one it lies on (a d4, read from its top corner).
 * @property {number[]} [vertexNumbers]  Numbers printed at the corners rather
 *   than one per face (a d4): each face shows its corners' numbers, each near
 *   its own corner.
 * @property {number} [decalOffset]  With vertexNumbers: how far each numeral
 *   sits from the face's centre towards its corner, as a fraction of the way.
 * @property {number} decalSize  Decal side, as a multiple of the face's
 *   inradius. A centred decal must stay under sqrt(2) - see decalsOf.
 * @property {number} [numeralFill]  How much of its decal a numeral fills, top
 *   to bottom (default 0.68). Larger where the decal itself can't be (a d4).
 */

/**
 * Fills in what every die type needs from its bare geometry.
 * @param {ShapeSpec} spec
 */
export function defineShape(spec) {
  const v = spec.verts.map((p) => new THREE.Vector3(...p));
  const faceInfo = (face, number) => {
    const [a, b, c] = face.map((i) => v[i]);
    const normal = new THREE.Vector3().subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const centroid = face.reduce((s, i) => s.add(v[i]), new THREE.Vector3()).multiplyScalar(1 / face.length);
    // Distance from the centroid to the nearest edge: the largest circle
    // round the centroid that stays inside the face.
    let inradius = Infinity;
    face.forEach((i, k) => {
      const p1 = v[i];
      const p2 = v[face[(k + 1) % face.length]];
      const line = new THREE.Vector3().subVectors(p2, p1);
      const toC = new THREE.Vector3().subVectors(centroid, p1);
      inradius = Math.min(inradius, new THREE.Vector3().crossVectors(toC, line).length() / line.length());
    });
    return { verts: face, normal, centroid, inradius, number };
  };
  const faces = spec.faces.map((f, i) => faceInfo(f, spec.numbers[i]));
  const plainFaces = (spec.plainFaces ?? []).map((f) => faceInfo(f, 0));

  // Lying flat showing its highest number, as a fresh die is placed: that
  // face on top, or for a die read from below, lying on it.
  const readsDown = spec.reads === 'down';
  const top = faces.reduce((best, f) => (f.number > best.number ? f : best));
  const restQuaternion = new THREE.Quaternion().setFromUnitVectors(top.normal, new THREE.Vector3(0, readsDown ? -1 : 1, 0));
  // Centre to face: how high the centre sits when lying on one.
  const restHeight = top.normal.dot(v[top.verts[0]]);
  const circumradius = Math.sqrt(Math.max(...spec.verts.map(([x, y, z]) => x * x + y * y + z * z)));

  const scratch = new THREE.Vector3();
  return {
    ...spec,
    faces,
    plainFaces,
    restQuaternion,
    restHeight,
    circumradius,
    /** Convex-hull points for the collider, flattened. */
    hull: Float32Array.from(spec.verts.flat()),
    decals: decalsOf(spec, faces),
    /**
     * The number a die at orientation `q` ([x, y, z, w]) shows: its most
     * upward face, or for a d4 its most downward. A die cocked against a wall
     * is read the same way, as it lies (DEV_PLAN.md D24).
     */
    faceUp(q) {
      const quaternion = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
      let best = faces[0];
      let bestUp = -Infinity;
      for (const f of faces) {
        const y = scratch.copy(f.normal).applyQuaternion(quaternion).y;
        const up = readsDown ? -y : y;
        if (up > bestUp) { bestUp = up; best = f; }
      }
      return best.number;
    },
    /**
     * A turn of the die onto itself (one of its symmetries) that makes a die
     * showing `shown` show `wanted` instead: drawn at `q` times this turn, a
     * die whose physics lies at `q` looks exactly the same, outline and all,
     * but with `wanted` where `shown` was. How a die popped out by an
     * explosion lands on the roll the rules drew for it, without the rules
     * depending on physics.
     * @param {number} shown
     * @param {number} wanted
     */
    turnShowing(shown, wanted) {
      const from = faces.find((f) => f.number === wanted);
      const to = faces.find((f) => f.number === shown);
      const frame = (f, corner) => {
        const a = f.normal;
        const b = new THREE.Vector3().subVectors(v[corner], f.centroid).normalize();
        return new THREE.Matrix4().makeBasis(a, b, new THREE.Vector3().crossVectors(a, b));
      };
      const tolerance = 1e-6 * circumradius * circumradius;
      const fromFrame = frame(from, from.verts[0]).transpose();
      for (const corner of to.verts) {
        const turn = frame(to, corner).multiply(fromFrame);
        const onItself = v.every((p) => {
          const q = p.clone().applyMatrix4(turn);
          return v.some((r) => r.distanceToSquared(q) < tolerance);
        });
        if (onItself) return new THREE.Quaternion().setFromRotationMatrix(turn);
      }
      throw new Error(`No turn of a ${spec.type} shows ${wanted} for ${shown}`);
    },
  };
}

// ---------- Where the numbers are printed ----------
// Each number (or a d6's pips) is a small square decal lying on its face,
// just off the surface. Worked out here, as plain geometry, so a test can
// check every decal stays on its own face (test/dice.test.js); dice.js only
// draws them.

// How far a decal floats off its face. Well clear of it, not just a hair:
// paired with the tight camera near/far, this keeps the decal and its own face
// far enough apart in the depth buffer that which one wins a z-fight isn't a
// coin flip per GPU.
const DECAL_LIFT = 0.02;

/**
 * Every decal on a die: where it sits and which way it faces (in the die's own
 * frame), its side, and the number it shows.
 * @returns {{ face: number, number: number, text: string, size: number,
 *   position: THREE.Vector3, quaternion: THREE.Quaternion }[]}
 */
function decalsOf(spec, faces) {
  const text = spec.numeral ?? String;
  const decals = [];
  const place = (faceIndex, number, centre, up, size) => {
    const { normal } = faces[faceIndex];
    // right x up must equal normal for this to be a proper rotation (det +1).
    // crossVectors(normal, up) gives normal x up = -(up x normal), which is the
    // MIRROR of that - a left-handed basis. Quaternion.setFromRotationMatrix
    // can't represent a reflection (quaternions only encode proper rotations),
    // so it silently produced a wrong, unrelated orientation for every single
    // face - the actual root cause behind numbers looking jumbled, rotated
    // oddly, or simply missing (a decal facing the wrong way is backface-culled,
    // i.e. invisible, even on a face pointed straight at the camera). Building
    // right = up x normal keeps the basis right-handed.
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const trueUp = new THREE.Vector3().crossVectors(normal, right).normalize();
    decals.push({
      face: faceIndex,
      number,
      text: text(number),
      size,
      position: centre.clone().addScaledVector(normal, DECAL_LIFT),
      quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, normal)),
    });
  };

  faces.forEach(({ verts, normal, centroid, inradius, number }, i) => {
    const size = inradius * spec.decalSize;
    if (spec.vertexNumbers) {
      // One numeral per corner, partway towards it and pointing at it, so the
      // numbers round the top corner all read upright from round the die.
      for (const v of verts) {
        const towards = new THREE.Vector3(...spec.verts[v]).sub(centroid);
        const centre = centroid.clone().addScaledVector(towards, spec.decalOffset);
        place(i, spec.vertexNumbers[v], centre, towards.normalize(), size);
      }
      return;
    }
    // No single "upright" direction is possible for every face on a shape like
    // this (same reason real dice have numbers at no shared consistent
    // rotation), but leaning each face's "up" toward the die's own vertical
    // axis - rather than an arbitrary mesh-authoring choice like "toward this
    // face's first vertex" - keeps every numeral close to upright instead of
    // landing at random-looking angles. Falls back to the Z axis for any face
    // whose normal is nearly parallel to Y (up projects to ~zero there).
    //
    // A SQUARE decal's own corner sits size/2 * sqrt(2) from its centre. Since
    // "up" leans toward the die's axis rather than toward one of the face's own
    // vertices, that corner can point in ANY direction relative to the face -
    // including straight at the nearest edge, whose closest point is only
    // `inradius` away. So for the corner never to cross the face's own
    // boundary, size/2*sqrt(2) must stay under inradius, i.e. size under
    // inradius*sqrt(2) (~1.414). An earlier 1.55 multiplier overshot that,
    // which is exactly why numerals used to bleed past their face's edges onto
    // neighbouring faces. Each die type sets its own multiplier under that cap
    // (decalSize; 1.0 on the d20).
    const axisUp = new THREE.Vector3(0, 1, 0);
    let up = axisUp.clone().sub(normal.clone().multiplyScalar(normal.dot(axisUp)));
    if (up.lengthSq() < 1e-4) {
      const axisFallback = new THREE.Vector3(0, 0, 1);
      up = axisFallback.clone().sub(normal.clone().multiplyScalar(normal.dot(axisFallback)));
    }
    place(i, number, centroid, up.normalize(), size);
  });
  return decals;
}

/** Every die type the game can throw, by type name. */
export const SHAPES = Object.fromEntries(
  [D4, D6, D8, D10, D_PERCENT, D12, D20].map((spec) => [spec.type, defineShape(spec)])
);

/** The die types, in the order they're offered (e.g. in Zen). */
export const DIE_TYPES = Object.keys(SHAPES);
