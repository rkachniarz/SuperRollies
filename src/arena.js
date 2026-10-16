// The tray the dice are thrown into: what you see (renderer, camera, lights,
// floor, walls) and what they collide with (the physics world), plus the rules
// about where a die is allowed to end up.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  SCENE_BACKGROUND, OPPONENT_FLOOR_COLOR, PLAYER_FLOOR_COLOR, WALL_COLOR,
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, WALL_HALF_HEIGHT, WALL_VISIBLE_HALF_HEIGHT,
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
  }
  addFloor(OPPONENT_FLOOR_COLOR, -TRAY_DEPTH / 2);
  addFloor(PLAYER_FLOOR_COLOR, TRAY_DEPTH / 2);

  // ---------- Physics ----------
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);

  const diceMaterial = new CANNON.Material('dice');
  const floorMaterial = new CANNON.Material('floor');
  const wallMaterial = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, floorMaterial, { friction: 0.45, restitution: 0.3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, wallMaterial, { friction: 0.3, restitution: 0.55 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, { friction: 0.3, restitution: 0.4 }));

  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: floorMaterial });
  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(groundBody);

  // ---------- Walls ----------
  const wallVisualMaterial = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.45,
    metalness: 0.12,
  });

  function addWall(x, z, sx, sz) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(sx, WALL_HALF_HEIGHT, sz)),
      material: wallMaterial,
    });
    body.position.set(x, WALL_HALF_HEIGHT, z);
    world.addBody(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 2, WALL_VISIBLE_HALF_HEIGHT * 2, sz * 2),
      wallVisualMaterial
    );
    mesh.position.set(x, WALL_VISIBLE_HALF_HEIGHT, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  addWall(-TRAY_HALF_WIDTH - WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // left
  addWall(TRAY_HALF_WIDTH + WALL_T, 0, WALL_T, TRAY_DEPTH + WALL_T * 2); // right
  addWall(0, -TRAY_DEPTH - WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // far edge
  addWall(0, TRAY_DEPTH + WALL_T, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T); // near edge
  addWall(0, 0, TRAY_HALF_WIDTH + WALL_T * 2, WALL_T * 1.4); // the divider

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

  const ARENA_Z_MIN = -TRAY_DEPTH + DIE_RADIUS;
  const ARENA_Z_MAX = TRAY_DEPTH - DIE_RADIUS;

  // A hard backstop, independent of the wall colliders above: cannon-es has no
  // continuous collision detection, so a small, fast, tumbling die can
  // occasionally tunnel straight through a thin wall in a single physics step
  // instead of bouncing off it. Rather than chase that per-collision, every
  // die's position is clamped after each step, so ending up outside the tray is
  // impossible no matter what the collision pass missed.
  function clampToArena(body) {
    if (body.type !== CANNON.Body.DYNAMIC) return; // held dice are clamped by the drag instead
    const xLimit = arenaHalfWidth;
    if (body.position.x < -xLimit) { body.position.x = -xLimit; if (body.velocity.x < 0) body.velocity.x = 0; }
    else if (body.position.x > xLimit) { body.position.x = xLimit; if (body.velocity.x > 0) body.velocity.x = 0; }
    if (body.position.z < ARENA_Z_MIN) { body.position.z = ARENA_Z_MIN; if (body.velocity.z < 0) body.velocity.z = 0; }
    else if (body.position.z > ARENA_Z_MAX) { body.position.z = ARENA_Z_MAX; if (body.velocity.z > 0) body.velocity.z = 0; }
  }

  // While held, the die is kinematic (moved by direct position, not physics), so
  // it wouldn't be stopped by the solid divider wall on its own - clamp it to
  // the player's own zone, and to the same sideways limit a thrown die gets, so
  // it can't be dragged through the divider or out past the edge of the screen.
  function clampToTray(x, z) {
    return {
      x: Math.max(-arenaHalfWidth, Math.min(arenaHalfWidth, x)),
      z: Math.max(WALL_T * 1.4 + DIE_RADIUS * 0.6, Math.min(TRAY_DEPTH - DIE_RADIUS, z)),
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
    renderer, scene, camera, world, diceMaterial,
    clampToArena, clampToTray, resize,
    get arenaHalfWidth() { return arenaHalfWidth; },
  };
}
