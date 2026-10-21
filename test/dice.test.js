import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHAPES, DIE_TYPES } from '../src/die-shapes.js';

const EPS = 1e-9;
const sorted = (a) => [...a].sort((x, y) => x - y);
const range = (from, to, step = 1) => Array.from({ length: (to - from) / step + 1 }, (_, i) => from + i * step);

// What each die type is numbered with, and what opposite faces add up to
// (none on a d4, which has no opposite faces).
const EXPECTED = {
  d4: { numbers: range(1, 4), decals: 12 },
  d6: { numbers: range(1, 6), opposite: 7, decals: 6 },
  d8: { numbers: range(1, 8), opposite: 9, decals: 8 },
  d10: { numbers: range(1, 10), opposite: 11, decals: 10 },
  'd%': { numbers: range(10, 100, 10), opposite: 110, decals: 10 },
  d12: { numbers: range(1, 12), opposite: 13, decals: 12 },
  d20: { numbers: range(1, 20), opposite: 21, decals: 20 },
};

/** The orientation that leaves face `f` lying the way the die reads it: on top, or for a d4 underneath. */
const lyingOn = (shape, f) =>
  new THREE.Quaternion().setFromUnitVectors(f.normal, new THREE.Vector3(0, shape.reads === 'down' ? -1 : 1, 0));

/** The four corners of a decal, in the die's frame, and the two directions along its sides. */
function decalSquare({ position, quaternion, size }) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
    position.clone().addScaledVector(right, (a * size) / 2).addScaledVector(up, (b * size) / 2));
  return { corners, axes: [right, up] };
}

/** Whether point `p`, on the plane of `face`, lies inside it. */
function insideFace(shape, face, p) {
  const v = face.verts.map((i) => new THREE.Vector3(...shape.verts[i]));
  return v.every((a, k) => {
    const b = v[(k + 1) % v.length];
    return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(p, a)).dot(face.normal) > -EPS;
  });
}

/** Whether two squares on the same plane overlap (separating axis test). */
function overlap(s1, s2) {
  return [...s1.axes, ...s2.axes].every((axis) => {
    const p1 = s1.corners.map((c) => c.dot(axis));
    const p2 = s2.corners.map((c) => c.dot(axis));
    return Math.min(Math.max(...p1), Math.max(...p2)) - Math.max(Math.min(...p1), Math.min(...p2)) > EPS;
  });
}

test('every die type is registered', () => {
  assert.deepEqual(DIE_TYPES, Object.keys(EXPECTED));
});

for (const type of DIE_TYPES) {
  const shape = SHAPES[type];
  const expected = EXPECTED[type];

  describe(type, () => {
    test('is numbered with each of its numbers once', () => {
      assert.deepEqual(sorted(shape.faces.map((f) => f.number)), expected.numbers);
    });

    if (expected.opposite) {
      test(`opposite faces add up to ${expected.opposite}`, () => {
        for (const f of shape.faces) {
          const opposite = shape.faces.find((g) => g.normal.dot(f.normal) < -1 + 1e-6);
          assert.ok(opposite, `face ${f.number} has an opposite`);
          assert.equal(f.number + opposite.number, expected.opposite);
        }
      });
    }

    test('is convex, every face flat, and its faces are its whole surface', () => {
      for (const f of [...shape.faces, ...shape.plainFaces]) {
        const d = f.normal.dot(new THREE.Vector3(...shape.verts[f.verts[0]]));
        for (const i of f.verts) assert.ok(Math.abs(f.normal.dot(new THREE.Vector3(...shape.verts[i])) - d) < 1e-9, 'flat');
        for (const p of shape.verts) assert.ok(f.normal.dot(new THREE.Vector3(...p)) <= d + 1e-9, 'nothing beyond a face');
        assert.ok(d > 0, 'faces point outwards');
      }
      // Every edge is shared by exactly two faces: a closed surface.
      const edges = new Map();
      for (const f of [...shape.faces, ...shape.plainFaces]) {
        f.verts.forEach((a, k) => {
          const b = f.verts[(k + 1) % f.verts.length];
          const key = Math.min(a, b) + '-' + Math.max(a, b);
          edges.set(key, (edges.get(key) ?? 0) + 1);
        });
      }
      assert.ok([...edges.values()].every((n) => n === 2));
    });

    test('lying each way up, it reads the face it shows', () => {
      for (const f of shape.faces) assert.equal(shape.faceUp(lyingOn(shape, f).toArray()), f.number);
    });

    test('a fresh die is placed showing its highest number', () => {
      assert.equal(shape.faceUp(shape.restQuaternion.toArray()), Math.max(...expected.numbers));
    });

    test(`has ${expected.decals} decals, each inside its own face`, () => {
      assert.equal(shape.decals.length, expected.decals);
      for (const decal of shape.decals) {
        const face = shape.faces[decal.face];
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(decal.quaternion);
        assert.ok(facing.dot(face.normal) > 1 - 1e-9, 'faces out along its face (a mirrored basis would not)');
        for (const corner of decalSquare(decal).corners) {
          const onFace = corner.clone().addScaledVector(face.normal, -face.normal.dot(corner.clone().sub(face.centroid)));
          assert.ok(insideFace(shape, face, onFace), `a corner of ${decal.text} leaves its face`);
        }
      }
    });

    test('decals on the same face never overlap', () => {
      shape.decals.forEach((a, i) => shape.decals.slice(i + 1).forEach((b) => {
        if (a.face === b.face) assert.ok(!overlap(decalSquare(a), decalSquare(b)), `${a.text} and ${b.text}`);
      }));
    });

    test('can be turned onto itself to show any number instead of any other (an explosion\'s pop)', () => {
      for (const shown of shape.faces) {
        const q = lyingOn(shape, shown);
        for (const wanted of expected.numbers) {
          const turned = q.clone().multiply(shape.turnShowing(shown.number, wanted));
          assert.equal(shape.faceUp(turned.toArray()), wanted, `${shown.number} turned to ${wanted}`);
        }
      }
    });
  });
}

describe('d4', () => {
  test('is read from its top corner: the numerals nearest it all show the number read', () => {
    const shape = SHAPES.d4;
    for (const f of shape.faces) {
      const q = lyingOn(shape, f);
      const height = (d) => d.position.clone().applyQuaternion(q).y;
      const top = [...shape.decals].sort((a, b) => height(b) - height(a)).slice(0, 3);
      assert.deepEqual(top.map((d) => d.number), Array(3).fill(shape.faceUp(q.toArray())));
    }
  });
});

describe('d10 and d%', () => {
  test('print 0 and 00 for 10 and 100, as real ones do', () => {
    assert.deepEqual(sorted(SHAPES.d10.decals.map((d) => d.number)).map((n) => SHAPES.d10.decals.find((d) => d.number === n).text),
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    assert.equal(SHAPES['d%'].decals.find((d) => d.number === 100).text, '00');
  });

  test('even numbers round one point, odd round the other', () => {
    const top = SHAPES.d10.faces.filter((f) => f.normal.y > 0).map((f) => f.number % 2);
    assert.deepEqual(top, [0, 0, 0, 0, 0]);
  });

  test('share the collider Phase 0 checked (docs/history.md 0.5)', () => {
    assert.deepEqual(SHAPES.d10.hull, SHAPES['d%'].hull);
  });
});

test("the d20's numbering is unchanged (the recorded throws depend on it)", () => {
  assert.deepEqual(SHAPES.d20.numbers, [1, 19, 3, 17, 5, 6, 7, 8, 9, 10, 4, 18, 2, 20, 16, 12, 11, 15, 14, 13]);
});
