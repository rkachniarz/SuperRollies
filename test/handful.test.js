import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handLayout, scatter, randomHandful, aimHandful, liftClear } from '../src/handful.js';
import { mulberry32 } from '../src/rng.js';

const distance = ([ax, az], [bx, bz]) => Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);

describe('handLayout', () => {
  test('one die sits at the centre and reaches its own radius', () => {
    assert.deepEqual(handLayout(1, 0.6), { offsets: [[0, 0]], reach: { x: 0.6, z: 0.6 } });
  });

  for (let count = 1; count <= 8; count++) {
    test(`${count} dice: clear of each other in any orientation, centred, within reach`, () => {
      const radius = 0.66;
      const { offsets, reach } = handLayout(count, radius);
      assert.equal(offsets.length, count);
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) assert.ok(distance(offsets[i], offsets[j]) > 2 * radius, `${i}-${j}`);
      }
      for (const [x, z] of offsets) {
        assert.ok(Math.abs(x) + radius <= reach.x + 1e-9 && Math.abs(z) + radius <= reach.z + 1e-9);
      }
      const xs = offsets.map(([x]) => x);
      const zs = offsets.map(([, z]) => z);
      assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...zs) + Math.min(...zs)) < 1e-9);
    });
  }

  test('more than 8 dice is refused (D6)', () => {
    assert.throws(() => handLayout(9, 0.6), /9 dice/);
  });
});

describe('scatter', () => {
  test('a single die keeps the throw exactly, and draws nothing', () => {
    let draws = 0;
    const out = scatter([1, 2, 3], [4, 5, 6], [[0, 0]], () => { draws++; return 0.5; });
    assert.deepEqual(out, [{ v: [1, 2, 3], w: [4, 5, 6] }]);
    assert.equal(draws, 0);
  });

  test('a handful: every die a little different, all heading the same way', () => {
    const { offsets } = handLayout(5, 0.66);
    const out = scatter([0, 2, -8], [10, 0, 0], offsets, mulberry32(3));
    assert.equal(new Set(out.map((d) => d.v.join())).size, 5);
    for (const { v } of out) assert.ok(v[2] < -5 && v[1] > 1.5, v.join());
  });
});

describe('randomHandful', () => {
  const zone = { halfWidth: 1, zNear: -1, zFar: -2.5 };
  test('the same stream throws the same handful', () => {
    const { offsets } = handLayout(4, 0.66);
    assert.deepEqual(randomHandful(zone, offsets, mulberry32(9)), randomHandful(zone, offsets, mulberry32(9)));
    assert.notDeepEqual(randomHandful(zone, offsets, mulberry32(9)), randomHandful(zone, offsets, mulberry32(10)));
  });

  test('keeps the layout: every die where its offset says, round a centre in the zone', () => {
    const { offsets } = handLayout(8, 0.6);
    const dice = randomHandful(zone, offsets, mulberry32(4));
    const cx = dice[0].p[0] - offsets[0][0];
    const cz = dice[0].p[2] - offsets[0][1];
    assert.ok(Math.abs(cx) <= 1 && cz <= -1 && cz >= -2.5);
    dice.forEach((d, i) => {
      assert.ok(Math.abs(d.p[0] - (cx + offsets[i][0])) < 1e-12 && Math.abs(d.p[2] - (cz + offsets[i][1])) < 1e-12);
    });
  });
});

describe('aimHandful', () => {
  const zone = { halfWidth: 1.5, zNear: -1, zFar: -2.5 };

  test('sends the handful at the target, from where it was, as fast as a strong throw', () => {
    const rand = mulberry32(11);
    const { offsets } = handLayout(4, 0.66);
    const thrown = randomHandful(zone, offsets, rand);
    const aimed = aimHandful(thrown, [0.5, 2], rand);
    const centre = [0, 2].map((k) => thrown.reduce((s, d) => s + d.p[k], 0) / thrown.length);
    const toward = [0.5 - centre[0], 2 - centre[1]];
    aimed.forEach((d, i) => {
      assert.deepEqual([d.p, d.q, d.w, d.v[1]], [thrown[i].p, thrown[i].q, thrown[i].w, thrown[i].v[1]]);
      // Heading for the target, give or take its own scatter.
      const along = (d.v[0] * toward[0] + d.v[2] * toward[1]) / Math.hypot(...toward);
      assert.ok(along > 3, `die ${i} only ${along.toFixed(2)} towards the target`);
    });
  });

  test('the same stream aims the same way', () => {
    const throwAt = () => {
      const rand = mulberry32(5);
      return aimHandful(randomHandful(zone, handLayout(2, 0.66).offsets, rand), [0, 2], rand);
    };
    assert.deepEqual(throwAt(), throwAt());
  });
});

describe('liftClear (Draw Poker: thrown over dice held where they lie)', () => {
  const lying = [{ p: [0, 0.4, 2], r: 0.7 }];

  test('a handful over a die lying there is lifted clear of it, all together', () => {
    const releases = [{ p: [0.3, 1.1, 2], v: [1, 0, 0] }, { p: [2, 1.1, 2], v: [0, 0, 1] }];
    const lifted = liftClear(releases, [0.7, 0.7], lying);
    assert.ok(Math.abs(lifted[0].p[1] - (0.4 + 1.4)) < 1e-12);
    assert.equal(lifted[1].p[1] - lifted[0].p[1], 0);
    assert.deepEqual(lifted[1].v, [0, 0, 1]);
    assert.equal(releases[0].p[1], 1.1);
  });

  test('one let go clear of every die lying there is left as it is', () => {
    const releases = [{ p: [3, 1.1, 2] }];
    assert.deepEqual(liftClear(releases, [0.7], lying), releases);
  });
});
