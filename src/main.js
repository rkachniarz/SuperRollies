// Wires the pieces together and runs the frame loop.

import { createArena } from './arena.js';
import { createTable } from './table.js';
import { initPhysics } from './physics.js';
import { createRoller } from './roll.js';
import { replayThrow } from './replay.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createGame } from './game.js';
import { createThrowControls } from './input.js';

const canvas = document.getElementById('scene');
const arena = createArena(canvas);
const table = createTable(arena);
const roller = createRoller(table.meshFor);
const hud = createHud();
const effects = createEffects(arena);
const game = createGame({ hud, roller, arena, table, effects });
// Something to look at behind the menu while the physics engine loads.
table.setup({ types: ['d20'], scale: 1, tray: arena.tray, opponent: true });

const controls = createThrowControls({
  canvas,
  camera: arena.camera,
  table,
  arena,
  canGrab: game.canGrab,
  onGrab: game.onGrab,
  onFumble: game.onFumble,
  onThrow: game.onThrow,
  onBoardTap: game.onBoardTap,
  random: game.random,
});

// The scene is drawn straight away; the menu waits for the physics engine.
initPhysics().then(
  () => hud.setLoaded(),
  (err) => {
    console.error(err);
    hud.setLoadFailed();
  }
);

// For tools and tests driving the page (tools/phase0/): every round played so
// far, the replay function to check them against, and the scene to find the
// dice on screen.
window.superRollies = {
  rounds: game.rounds,
  replayThrow,
  arena,
  /** Each side's dice this match: { player: [...], opponent: [...] }. */
  dice: table.sides,
  table,
  game,
  roller,
};

let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  roller.frame(dt);
  controls.frame(dt);
  effects.frame(dt, roller.busy);
  if (!roller.busy) table.keepOnScreen();
  arena.renderer.render(arena.scene, arena.camera);
}

requestAnimationFrame(animate);
