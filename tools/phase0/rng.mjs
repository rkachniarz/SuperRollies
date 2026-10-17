// A small seeded RNG for the Phase 0 tools, so every run of a check throws the
// same dice. The generator is the game's own (src/rng.js); the recorded
// fixtures depend on its exact sequence.

export { mulberry32 } from '../../src/rng.js';

/** A uniformly random orientation, as [x, y, z, w]. */
export function randomQuaternion(rand) {
  const u1 = rand();
  const u2 = rand() * Math.PI * 2;
  const u3 = rand() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}
