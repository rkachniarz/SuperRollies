// The tray the dice are thrown into: what you see (renderer, camera, lights,
// floor, walls), plus the rules about where a die is allowed to end up. What
// the dice actually collide with is built in physics.js, from the same
// dimensions.

import * as THREE from 'three';
import {
  SCENE_BACKGROUND, OPPONENT_FLOOR_COLOR, PLAYER_FLOOR_COLOR, WALL_COLOR,
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, WALL_VISIBLE_HALF_HEIGHT,
  DIE_RADIUS, CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, CAMERA_POSITION, CAMERA_LOOK_AT,
} from './config.js';

export function createArena(canvas) {
  // ---------- Renderer, scene, camera, lights ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR
  );
  camera.position.set(...CAMERA_POSITION);
  camera.lookAt(...CAMERA_LOOK_AT);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(-4, 8, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb2ff, 0.35);
  rim.position.set(3, 4, 5);
  scene.add(rim);

  // ---------- Tray floor ----------
  // Two tinted halves matching each side's colour identity, split by the
  // divider wall added below.
  function addFloor(color, z) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAY_HALF_WIDTH * 2, TRAY_DEPTH),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, z);
    floor.receiveShadow = true;
    scene.add(floor);
    return floor;
  }
  const opponentFloor = addFloor(OPPONENT_FLOOR_COLOR, -TRAY_DEPTH / 2);
  addFloor(PLAYER_FLOOR_COLOR, TRAY_DEPTH / 2);

  // ---------- Walls ----------
  const wallVisualMaterial = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.45,
    metalness: 0.12,
  });

  // Only a short strip at the base of each wall is drawn; its collider (in
  // physics.js) is WALL_HALF_HEIGHT tall, so it blocks throws well above what
  // you can see of it.
  function addWall(x, z, sx, sz) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 2, WALL_VISIBLE_HALF_HEIGHT * 2, sz * 2),
      wallVisualMaterial
    );
    mesh.position.set(x, WALL_VISIBLE_HALF_HEIGHT, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  addWall(-TRAY_HALF_WIDTH - WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // left
  addWall(TRAY_HALF_WIDTH + WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // right
  addWall(0, -TRAY_DEPTH - WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // far edge
  addWall(0, TRAY_DEPTH + WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // near edge
  const dividerMesh = addWall(0, 0, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T * 1.4);

  // Zen mode takes the divider out, giving one die the whole tray - and paints
  // the floor one colour, so it reads as one tray rather than two halves.
  let divider = true;
  function setDivider(on) {
    divider = on;
    dividerMesh.visible = on;
    opponentFloor.material.color.set(on ? OPPONENT_FLOOR_COLOR : PLAYER_FLOOR_COLOR);
  }

  // ---------- Where a die is allowed to be ----------
  // How far out to the sides a die may end up. The camera has a fixed VERTICAL
  // field of view, so the narrower the window, the less of the tray's WIDTH is
  // in frame - on a phone held upright, the tray's side walls sit well outside
  // the screen. Left alone, a die could roll to a legitimate resting spot that
  // simply isn't visible, and since a throw starts by tapping the die, an
  // off-screen die means the match can't continue at all. So the playable strip
  // is narrowed to whatever is actually on screen (never wider than the tray).
  let arenaHalfWidth = TRAY_HALF_WIDTH - DIE_RADIUS;
  const arenaProbe = new THREE.Vector3();

  function updateArenaBounds() {
    // project() reads the camera's inverse world matrix, which three.js only
    // refreshes during a render - on the very first call (before any frame has
    // been drawn) it is still identity and every probe below would be nonsense.
    camera.updateMatrixWorld();
    const trayLimit = TRAY_HALF_WIDTH - DIE_RADIUS;
    // Checked at the row nearest the camera, where perspective spreads a given
    // world x furthest across the screen - clamp there and every row behind it
    // is safely in frame too. 0.9 keeps the die clear of the very edge rather
    // than half-hanging off it.
    for (let x = trayLimit; x > DIE_RADIUS; x -= 0.05) {
      arenaProbe.set(x, DIE_RADIUS, TRAY_DEPTH - DIE_RADIUS).project(camera);
      if (Math.abs(arenaProbe.x) <= 0.9) { arenaHalfWidth = x; return; }
    }
    arenaHalfWidth = DIE_RADIUS;
  }

  // The thrown dice are held to the same sideways limit inside the simulation
  // (clampToArena in physics.js), which reads it from each throw's record.
  //
  // While held, the die isn't simulated at all (it simply follows the pointer),
  // so nothing would stop it at the solid divider wall on its own - clamp it to
  // the player's own zone, and to the same sideways limit a thrown die gets, so
  // it can't be dragged through the divider or out past the edge of the screen.
  function clampToTray(x, z) {
    const zMin = divider ? WALL_T * 1.4 + DIE_RADIUS * 0.6 : -TRAY_DEPTH + DIE_RADIUS;
    return {
      x: Math.max(-arenaHalfWidth, Math.min(arenaHalfWidth, x)),
      z: Math.max(zMin, Math.min(TRAY_DEPTH - DIE_RADIUS, z)),
    };
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateArenaBounds();
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera,
    clampToTray, resize, setDivider,
    get divider() { return divider; },
    get arenaHalfWidth() { return arenaHalfWidth; },
  };
}
