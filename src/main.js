// Wires the pieces together and runs the frame loop.

import { THEMES, TRAY_DEPTH } from './config.js';
import { createArena } from './arena.js';
import { createDie } from './dice.js';
import { initPhysics } from './physics.js';
import { createRoller } from './roll.js';
import { replayThrow } from './replay.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';
import { createThrowControls } from './input.js';

const canvas = document.getElementById('scene');
const arena = createArena(canvas);

const opponentDie = createDie({ theme: THEMES.opponent, spawnZ: -TRAY_DEPTH / 2, scene: arena.scene });
const playerDie = createDie({ theme: THEMES.player, spawnZ: TRAY_DEPTH / 2, scene: arena.scene });

const roller = createRoller({ opponent: opponentDie.mesh, player: playerDie.mesh });
const hud = createHud();

// Lays the table out for a mode, with the dice back on their starting spots.
// Zen has no opponent die and no divider.
function setTable(mode) {
  const zen = mode === 'zen';
  roller.cancel();
  arena.setDivider(!zen);
  opponentDie.mesh.visible = !zen;
  opponentDie.goHome();
  playerDie.goHome();
}

const game = createGame({ hud, roller, arena, setTable });

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
  dice: { player: playerDie, opponent: opponentDie },
  game,
  roller,
};

let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  roller.frame(dt);
  arena.renderer.render(arena.scene, arena.camera);
}

requestAnimationFrame(animate);
