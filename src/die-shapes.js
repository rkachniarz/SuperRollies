// The die types, as shapes: vertices, the faces that carry a number, and
// everything derived from them that the rest of the game needs - outward
// normals, where each number sits, how a die lies at rest, which number is up.
//
// Pure geometry: no DOM and no physics engine, so it is shared by the drawing
// (dice.js), the colliders (physics.js) and the face reader (replay.js), and
// they can never disagree about which face is "the 6".

import * as THREE from 'three';
import { D20 } from './d20.js';
import { D6 } from './d6.js';

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
 * @property {number} decalSize  Decal side, as a multiple of the face's
 *   inradius. Must stay under sqrt(2) - see dice.js.
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

  // Lying flat with its highest number on top, as a fresh die is placed.
  const top = faces.reduce((best, f) => (f.number > best.number ? f : best));
  const restQuaternion = new THREE.Quaternion().setFromUnitVectors(top.normal, new THREE.Vector3(0, 1, 0));
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
    /** The number on top of a die at orientation `q` ([x, y, z, w]). */
    faceUp(q) {
      const quaternion = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
      let best = faces[0];
      let bestUp = -Infinity;
      for (const f of faces) {
        const up = scratch.copy(f.normal).applyQuaternion(quaternion).y;
        if (up > bestUp) { bestUp = up; best = f; }
      }
      return best.number;
    },
  };
}

/** Every die type the game can throw, by type name. */
export const SHAPES = Object.fromEntries([D20, D6].map((spec) => [spec.type, defineShape(spec)]));

/** The die types, in the order they're offered (e.g. in Zen). */
export const DIE_TYPES = Object.keys(SHAPES);
