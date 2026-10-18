// Building a die of any type: the faceted body and its etched numbers (or
// pips). The shape comes from die-shapes.js; its collision shape is built from
// the same vertices, in physics.js.

import * as THREE from 'three';
import { SHAPES } from './die-shapes.js';

// Built once per die type and colour, and shared by every die that looks the
// same: a side may throw eight of them, and they're rebuilt for every match.
const geometryCache = new Map();

function dieGeometry(shape, themeColor) {
  const key = shape.type + '|' + themeColor;
  let geo = geometryCache.get(key);
  if (geo) return geo;
  const positions = [];
  const normals = [];
  const colors = [];
  const base = new THREE.Color(themeColor);
  for (const face of [...shape.faces, ...shape.plainFaces]) {
    const n = face.normal;
    // Light-from-upper-left facet shading, baked into vertex colours - makes
    // the faceted surface read clearly under the real lights.
    const shade = 1 + n.y * 0.22 - n.x * 0.08;
    const shaded = base.clone().multiplyScalar(shade);
    // A fan of triangles from the face's first corner (every face is convex).
    for (let k = 1; k < face.verts.length - 1; k++) {
      for (const i of [face.verts[0], face.verts[k], face.verts[k + 1]]) {
        positions.push(...shape.verts[i]);
        normals.push(n.x, n.y, n.z);
        colors.push(shaded.r, shaded.g, shaded.b);
      }
    }
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometryCache.set(key, geo);
  return geo;
}

// ---------- Etched face numbers ----------
// Each number (or a d6's pips) is a small flat decal: a plane with a
// canvas-drawn label, transparent everywhere else, just off its face.
// Flat/unlit on purpose: a version of this that used a lit material (to "catch
// the light" like the body does) backfired badly - on faces angled away from
// the key light the numeral darkened along with the facet under it, and a dark
// numeral colour (the player die's near-black digits) over an already-darkened
// facet became nearly unreadable. An unlit numeral renders at the same full
// contrast on every face, which is what "printed on" actually needs.
const labelTextureCache = new Map();

// Where the pips go on a 3x3 grid (column, row), for each value.
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// A lone 6 or 9 is underlined, as on real dice, so the two can be told apart
// whichever way up the die lies.
const UNDERLINED = new Set(['6', '9']);

function labelTexture(value, text, style, colorHex, fill = 0.68) {
  const key = (style === 'pips' ? value : text) + '|' + style + '|' + colorHex + '|' + fill;
  let tex = labelTextureCache.get(key);
  if (tex) return tex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colorHex;
  if (style === 'pips') {
    for (const [col, row] of PIPS[value]) {
      ctx.beginPath();
      ctx.arc(size * (0.18 + col * 0.32), size * (0.18 + row * 0.32), size * 0.105, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Shrunk to fit if it's wide ("00" on a percentile die).
    const font = (px) => '700 ' + Math.round(px) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    let px = size * fill;
    ctx.font = font(px);
    const width = ctx.measureText(text).width;
    if (width > size * 0.9) {
      px *= (size * 0.9) / width;
      ctx.font = font(px);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);
    if (UNDERLINED.has(text)) ctx.fillRect(size / 2 - px * 0.22, size / 2 + px * 0.42, px * 0.44, px * 0.07);
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  labelTextureCache.set(key, tex);
  return tex;
}

// Where each decal goes is worked out with the shape (decalsOf in
// die-shapes.js), including why its size and orientation are what they are.
function addFaceNumbers(mesh, shape, numberColor) {
  const colorHex = '#' + new THREE.Color(numberColor).getHexString();
  for (const { number, text, size, position, quaternion } of shape.decals) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: labelTexture(number, text, shape.label, colorHex, shape.numeralFill),
        transparent: true,
        depthWrite: false,
      })
    );
    decal.position.copy(position);
    decal.quaternion.copy(quaternion);
    decal.renderOrder = 1;
    // For the checks (tools/phase0/verify.mjs): the number this decal shows.
    decal.userData.number = number;
    mesh.add(decal);
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Creates one die's mesh and adds it to the scene. `scale` is the dice set's
 * die scale (DiceSet.dieScale). The die's `radius` is its circumradius at
 * that scale: how far it must be released from any wall to clear it in every
 * orientation.
 */
export function createDie({ type, theme, scale = 1, scene }) {
  const shape = SHAPES[type];
  const geometry = dieGeometry(shape, theme.body);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(scale);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 1),
    new THREE.LineBasicMaterial({ color: theme.edge, transparent: true, opacity: 0.85 })
  );
  mesh.add(edges);
  addFaceNumbers(mesh, shape, theme.number);
  scene.add(mesh);

  return {
    mesh,
    type,
    scale,
    radius: shape.circumradius * scale,
    /**
     * Puts it down at rest at (x, z): lying flat with its highest number on
     * top, turned `yaw` radians about the vertical. Placed, never dropped - a
     * die released from rest in its default orientation lands exactly on a
     * level edge and, with nothing to tip it either way in a deterministic
     * simulation, stays balanced there.
     */
    placeAt(x, z, yaw = 0) {
      mesh.position.set(x, shape.restHeight * scale, z);
      mesh.quaternion.setFromAxisAngle(Y_AXIS, yaw).multiply(shape.restQuaternion);
    },
    /** Takes it off the table for good. Its geometry and textures are shared, so they stay. */
    remove() {
      scene.remove(mesh);
      material.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
      for (const child of mesh.children) {
        if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
      }
    },
  };
}
