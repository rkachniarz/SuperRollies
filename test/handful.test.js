import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handLayout, scatter, randomHandful } from '../src/handful.js';
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
