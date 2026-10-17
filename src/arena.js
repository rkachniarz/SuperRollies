// The tray the dice are thrown into: what you see (renderer, camera, lights,
// floor, walls), plus the rules about where a die is allowed to end up. What
// the dice actually collide with is built in physics.js, from the same
// dimensions.
//
// Each dice set brings its own tray (setTray): bigger handfuls get a bigger
// table, and the camera pulls back to fit it.

import * as THREE from 'three';
import {
  SCENE_BACKGROUND, OPPONENT_FLOOR_COLOR, PLAYER_FLOOR_COLOR, WALL_COLOR,
  TRAY_HALF_WIDTH, TRAY_DEPTH, WALL_T, DIVIDER_T, WALL_HALF_HEIGHT, WALL_VISIBLE_HALF_HEIGHT,
  DIE_RADIUS, CAMERA_FOV, CAMERA_POSITION, CAMERA_LOOK_AT, CAMERA_DEPTH_MARGIN,
} from './config.js';

export function createArena(canvas) {
  // ---------- Renderer, scene, camera, lights ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND);

  // Placed, and its near/far set, by fitCamera once the tray is known.
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight);

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

  // ---------- Tray: floor and walls ----------
  const wallVisualMaterial = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.45,
    metalness: 0.12,
  });

  let tray = { halfWidth: TRAY_HALF_WIDTH, depth: TRAY_DEPTH };
  let trayGroup = null;
  let opponentFloor = null;
  let dividerMesh = null;
  let divider = true;

  function buildTray() {
    if (trayGroup) {
      scene.remove(trayGroup);
      trayGroup.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        if (o.material !== wallVisualMaterial) o.material.dispose();
      });
    }
    trayGroup = new THREE.Group();
    scene.add(trayGroup);
    const { halfWidth, depth } = tray;

    // Two tinted halves matching each side's colour identity, split by the
    // divider wall added below.
    function addFloor(color, z) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(halfWidth * 2, depth),
        new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0, z);
      floor.receiveShadow = true;
      trayGroup.add(floor);
      return floor;
    }
    opponentFloor = addFloor(OPPONENT_FLOOR_COLOR, -depth / 2);
    addFloor(PLAYER_FLOOR_COLOR, depth / 2);

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
      trayGroup.add(mesh);
      return mesh;
    }

    addWall(-halfWidth - WALL_T, 0, WALL_T, depth + WALL_T * 2); // left
    addWall(halfWidth + WALL_T, 0, WALL_T, depth + WALL_T * 2); // right
    addWall(0, -depth - WALL_T, halfWidth + WALL_T * 2, WALL_T); // far edge
    addWall(0, depth + WALL_T, halfWidth + WALL_T * 2, WALL_T); // near edge
    dividerMesh = addWall(0, 0, halfWidth + WALL_T * 2, DIVIDER_T);
    setDivider(divider);
  }

  // Zen mode takes the divider out, giving one die the whole tray - and paints
  // the floor one colour, so it reads as one tray rather than two halves.
  function setDivider(on) {
    divider = on;
    dividerMesh.visible = on;
    opponentFloor.material.color.set(on ? OPPONENT_FLOOR_COLOR : PLAYER_FLOOR_COLOR);
  }

  // ---------- Camera ----------
  // The camera frames The Classic's tray from CAMERA_POSITION. A bigger tray
  // is the same picture from further back: everything scales by the same
  // factor, so the tray fills the screen just as The Classic's does (its dice
  // look smaller, as they would on a bigger table).
  //
  // Near/far are recomputed tightly around the tray for every fit, never set
  // to one wide range that would cover every tray. A wide near/far range
  // starves the depth buffer of precision in the range that matters, which
  // once caused the etched numbers to lose the depth test against the very
  // face they sit on - on some GPUs only. The box measured here is everything
  // that is ever on screen: the tray with its walls, up to the top of the wall
  // colliders, which no die gets above.
  const viewDir = new THREE.Vector3();
  const corner = new THREE.Vector3();
  function fitCamera() {
    const k = Math.max(tray.halfWidth / TRAY_HALF_WIDTH, tray.depth / TRAY_DEPTH);
    camera.position.set(...CAMERA_POSITION).multiplyScalar(k);
    camera.lookAt(new THREE.Vector3(...CAMERA_LOOK_AT).multiplyScalar(k));
    camera.getWorldDirection(viewDir);
    let near = Infinity;
    let far = 0;
    const xs = tray.halfWidth + WALL_T * 2;
    const zs = tray.depth + WALL_T * 2;
    for (const x of [-xs, xs]) for (const y of [0, WALL_HALF_HEIGHT * 2]) for (const z of [-zs, zs]) {
      const d = corner.set(x, y, z).sub(camera.position).dot(viewDir);
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
    camera.near = near - CAMERA_DEPTH_MARGIN;
    camera.far = far + CAMERA_DEPTH_MARGIN;
    camera.updateProjectionMatrix();

    // The shadow-casting light covers the tray, whatever its size.
    const cover = 6 * k;
    Object.assign(key.shadow.camera, { left: -cover, right: cover, top: cover, bottom: -cover, far: 30 * k });
    key.shadow.camera.updateProjectionMatrix();
    key.position.set(-4, 8, -2).multiplyScalar(k);
  }

  // ---------- Where a die is allowed to be ----------
  // How far out to the sides a die may end up. The camera has a fixed VERTICAL
  // field of view, so the narrower the window, the less of the tray's WIDTH is
  // in frame - on a phone held upright, the tray's side walls sit well outside
  // the screen. Left alone, a die could roll to a legitimate resting spot that
  // simply isn't visible, and since a throw starts by tapping the die, an
  // off-screen die means the match can't continue at all. So the playable strip
  // is narrowed to whatever is actually on screen (never wider than the tray).
  //
  // Measured for a die of DIE_RADIUS (the d20); the side walls stand that much
  // further out (sideWallFace in physics.js), and a die of any other size
  // keeps its own radius from them.
  let arenaHalfWidth = TRAY_HALF_WIDTH - DIE_RADIUS;
  const arenaProbe = new THREE.Vector3();

  function updateArenaBounds() {
    // project() reads the camera's inverse world matrix, which three.js only
    // refreshes during a render - on the very first call (before any frame has
    // been drawn) it is still identity and every probe below would be nonsense.
    camera.updateMatrixWorld();
    const trayLimit = tray.halfWidth - DIE_RADIUS;
    // Checked at the row nearest the camera, where perspective spreads a given
    // world x furthest across the screen - clamp there and every row behind it
    // is safely in frame too. 0.9 keeps the die clear of the very edge rather
    // than half-hanging off it.
    for (let x = trayLimit; x > DIE_RADIUS; x -= 0.05) {
      arenaProbe.set(x, DIE_RADIUS, tray.depth - DIE_RADIUS).project(camera);
      if (Math.abs(arenaProbe.x) <= 0.9) { arenaHalfWidth = x; return; }
    }
    arenaHalfWidth = DIE_RADIUS;
  }

  // Where the side walls' inner faces are: the tray's own, or on a narrow
  // screen the invisible ones at its edges. The same sum as sideWallFace in
  // physics.js, which works it out from the same arenaHalfWidth.
  const sideFace = () => Math.min(tray.halfWidth, arenaHalfWidth + DIE_RADIUS);

  // `v` held to lo..hi, or the middle of them if there's no room between.
  const within = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

  // While held, the dice aren't simulated at all (they simply follow the
  // pointer), so nothing would stop them at the solid divider wall on their
  // own - the handful's centre is clamped to the player's own zone, and inside
  // the side walls a thrown die gets, so it can't be dragged through the
  // divider or out past the edge of the screen. `reach` is how far the handful
  // reaches from its centre, to the outside of its outermost dice (handLayout
  // in handful.js).
  //
  // The reach includes each die's circumradius, so a die this far from a wall
  // clears it in any orientation. Any closer and the throw would start inside
  // the wall's collider, and Rapier's push back out of it would fling the die
  // the other way before the throw had even begun.
  function clampToTray(x, z, reach) {
    const xMax = sideFace() - reach.x;
    const zMin = (divider ? DIVIDER_T : -tray.depth) + reach.z;
    return {
      x: within(x, -xMax, xMax),
      z: within(z, zMin, tray.depth - reach.z),
    };
  }

  // Where the opponent's handful may be released from (the range for its
  // centre): the middle of its own half, clear of the divider and within the
  // side walls - which on a narrow screen are the invisible ones at its edges.
  function opponentZone(reach) {
    const zNear = -(DIVIDER_T + reach.z);
    const zFar = Math.max(-tray.depth * 0.75, -(tray.depth - reach.z));
    const zMid = (zNear + zFar) / 2;
    return {
      halfWidth: Math.max(0, Math.min(tray.halfWidth * 0.55, sideFace() - reach.x)),
      zNear: zFar > zNear ? zMid : zNear,
      zFar: zFar > zNear ? zMid : zFar,
    };
  }

  /** Lays out the tray for a dice set (DiceSet.tray), and frames it. */
  function setTray(next) {
    if (next.halfWidth === tray.halfWidth && next.depth === tray.depth) return;
    tray = { halfWidth: next.halfWidth, depth: next.depth };
    buildTray();
    fitCamera();
    updateArenaBounds();
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

  buildTray();
  fitCamera();
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera,
    clampToTray, opponentZone, resize, setDivider, setTray,
    get divider() { return divider; },
    get tray() { return tray; },
    get arenaHalfWidth() { return arenaHalfWidth; },
    /** How far out the centre of a die of circumradius `radius` can be: against a side wall. */
    xLimit: (radius) => sideFace() - radius,
  };
}
