// Wires the pieces together and runs the frame loop.

import { THEMES, TRAY_DEPTH } from './config.js';
import { createArena } from './arena.js';
import { createDie } from './dice.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';
import { createThrowControls } from './input.js';

const canvas = document.getElementById('scene');
const arena = createArena(canvas);

const opponentDie = createDie({
  theme: THEMES.opponent,
  spawnZ: -TRAY_DEPTH / 2,
  scene: arena.scene,
  world: arena.world,
  physicsMaterial: arena.diceMaterial,
});

const playerDie = createDie({
  theme: THEMES.player,
  spawnZ: TRAY_DEPTH / 2,
  scene: arena.scene,
  world: arena.world,
  physicsMaterial: arena.diceMaterial,
});

const hud = createHud();
const game = createGame({ hud, playerDie, opponentDie });

createThrowControls({
  canvas,
  camera: arena.camera,
  die: playerDie,
  clampToTray: arena.clampToTray,
  canGrab: game.canGrab,
  onGrab: game.onGrab,
  onFumble: game.onFumble,
  onThrow: game.onThrow,
  onBoardTap: game.onBoardTap,
});

const FIXED_STEP = 1 / 60;
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  arena.world.step(FIXED_STEP, dt, 5);
  arena.clampToArena(opponentDie.body);
  arena.clampToArena(playerDie.body);

  opponentDie.mesh.position.copy(opponentDie.body.position);
  opponentDie.mesh.quaternion.copy(opponentDie.body.quaternion);
  playerDie.mesh.position.copy(playerDie.body.position);
  playerDie.mesh.quaternion.copy(playerDie.body.quaternion);

  arena.renderer.render(arena.scene, arena.camera);
}

requestAnimationFrame(animate);
