// A small seeded RNG for the Phase 0 tools, so every run of a check throws the
// same dice. (The game's own seeded RNG arrives in Phase 1, task 1.1.)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniformly random orientation, as [x, y, z, w]. */
export function randomQuaternion(rand) {
  const u1 = rand();
  const u2 = rand() * Math.PI * 2;
  const u3 = rand() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}
