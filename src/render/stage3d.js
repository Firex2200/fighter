// The stage in 3D: a floating stone shrine. Built around the exact collision
// shapes in STAGE (src/stage.js) — the art changes, the platforms don't.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STAGE } from '../stage.js';
import { glowMaterial } from './materials.js';

const RUNE = 0x3fe6d4; // Rook's storm teal

/** Seeded random, so the rocks and textures look the same every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Stone tiles with mortar lines and speckle, drawn on a canvas. */
function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rng(11);
  g.fillStyle = '#3a3f52';
  g.fillRect(0, 0, 256, 256);
  const rows = 4;
  for (let row = 0; row < rows; row++) {
    const h = 256 / rows;
    const offset = (row % 2) * 32;
    for (let x = -64 + offset; x < 256; x += 64) {
      const shade = 52 + Math.floor(r() * 18);
      g.fillStyle = `rgb(${shade},${shade + 4},${shade + 18})`;
      g.fillRect(x + 2, row * h + 2, 60, h - 4);
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
        g.fillRect(x + 2 + r() * 58, row * h + 2 + r() * (h - 6), 2, 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Wood planks with grain. */
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const r = rng(5);
  for (let p = 0; p < 4; p++) {
    const shade = 92 + Math.floor(r() * 26);
    g.fillStyle = `rgb(${shade},${Math.floor(shade * 0.66)},${Math.floor(shade * 0.42)})`;
    g.fillRect(0, p * 16, 256, 15);
    g.strokeStyle = 'rgba(40,20,10,0.35)';
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      const y = p * 16 + 2 + r() * 11;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + r() * 4 - 2, 170, y + r() * 4 - 2, 256, y);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A jagged rock: an icosahedron with its corners pushed in and out. */
function rock(radius, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const r = rng(seed);
  const pos = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.78 + r() * 0.42);
    const k = seen.get(key); // same corner, same push, so the faces stay joined
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Stage3D {
  constructor(scene, { shadows = true } = {}) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.runeMats = [];
    this.time = 0;

    const main = STAGE.platforms.find((p) => p.solid);
    const width = main.x2 - main.x1;

    // ------------------------------------------------------- main platform
    const stone = stoneTexture();
    stone.repeat.set(width / 40, 1.4);
    const stoneMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.85, color: 0xa3abc4 });
    const slab = new THREE.Mesh(new RoundedBoxGeometry(width + 2, 9, 64, 3, 1.6), stoneMat);
    slab.position.set((main.x1 + main.x2) / 2, main.y - 4.5, 0);
    slab.receiveShadow = shadows;
    this.group.add(slab);

    // Darker trim band along the front edge.
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(width + 3, 2.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x23273a, roughness: 0.5, metalness: 0.3 })
    );
    trim.position.set(slab.position.x, main.y - 2, 32.4);
    this.group.add(trim);

    // Glowing runes along the front face.
    for (let i = 0; i < 9; i++) {
      const mat = glowMaterial(RUNE, 0.9);
      this.runeMats.push(mat);
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.2), mat);
      rune.position.set(main.x1 + 12 + i * ((width - 24) / 8), main.y - 6.2, 32.6);
      rune.rotation.z = (i % 2 ? 1 : -1) * 0.2;
      this.group.add(rune);
    }

    // Rocky underside tapering to a point, like a floating island. Every rock
    // is placed so its highest corner stays below the slab: rocks poking up
    // through the floor would hide what the fighters stand on.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3b3446, roughness: 0.95, flatShading: true });
    const SLAB_BOTTOM = main.y - 8;
    const layers = [
      // x, radius, scale x/y/z, depth below the slab
      [0, 58, [1.55, 0.32, 0.5], 0],
      [-34, 32, [1.2, 0.42, 0.5], 2],
      [34, 30, [1.2, 0.42, 0.5], 4],
      [4, 34, [1.1, 0.5, 0.5], 22],
      [-6, 22, [1, 0.55, 0.55], 46],
      [4, 12, [1, 0.6, 0.6], 66],
    ];
    layers.forEach(([x, radius, [sx, sy, sz], below], i) => {
      const m = new THREE.Mesh(rock(radius, 30 + i), rockMat);
      // Corners are pushed out by up to 1.2x, so allow for that.
      m.position.set(x, SLAB_BOTTOM - below - radius * sy * 1.2, -2);
      m.scale.set(sx, sy, sz);
      this.group.add(m);
    });

    // Stone lanterns at the back corners, windows lit warm.
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0x7b8095, roughness: 0.9 });
    const lightMat = glowMaterial(0xffb867, 2.2);
    for (const x of [main.x1 + 10, main.x2 - 10]) {
      const l = new THREE.Group();
      const part = (geo, mat, y) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = y;
        mesh.castShadow = shadows;
        l.add(mesh);
      };
      part(new THREE.CylinderGeometry(2.2, 3, 8, 8), lanternMat, 4);
      part(new THREE.BoxGeometry(7, 5, 7), lightMat, 10.5);
      part(new THREE.ConeGeometry(7, 4, 4), lanternMat, 15);
      l.position.set(x, main.y, -24);
      l.rotation.y = Math.PI / 4;
      this.group.add(l);
    }

    // Torii gate behind the stage, standing on its back edge.
    const lacquer = new THREE.MeshStandardMaterial({ color: 0xb3322a, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 0.6 });
    const torii = new THREE.Group();
    for (const x of [-46, 46]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 78, 12), lacquer);
      pillar.position.set(x, 39, 0);
      pillar.castShadow = shadows;
      torii.add(pillar);
    }
    const beam = (w, h, y, mat) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), mat);
      b.position.y = y;
      torii.add(b);
    };
    beam(108, 4, 62, lacquer);
    beam(136, 5, 78, black);
    beam(124, 3, 74.5, lacquer);
    torii.position.set(0, main.y, -30);
    this.group.add(torii);

    // ------------------------------------------------------ soft platforms
    const wood = woodTexture();
    wood.repeat.set(1, 1);
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 });
    for (const p of STAGE.platforms.filter((q) => !q.solid)) {
      const w = p.x2 - p.x1;
      const plank = new THREE.Mesh(new RoundedBoxGeometry(w, 3, 22, 2, 0.8), woodMat);
      plank.position.set((p.x1 + p.x2) / 2, p.y - 1.5, 0);
      plank.receiveShadow = shadows;
      plank.castShadow = shadows;
      this.group.add(plank);
      // A glowing charm hanging under each end.
      for (const x of [p.x1 + 4, p.x2 - 4]) {
        const charm = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), glowMaterial(RUNE, 1.6));
        charm.position.set(x, p.y - 7, 9);
        this.runeMats.push(charm.material);
        this.group.add(charm);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 4), black);
        cord.position.set(x, p.y - 4.5, 9);
        this.group.add(cord);
      }
    }
  }

  /** Runes pulse slowly, and flare when lightning strikes. */
  update(dt, lightning = 0) {
    this.time += dt;
    const pulse = 0.9 + Math.sin(this.time * 1.6) * 0.3 + lightning * 1.5;
    for (const m of this.runeMats) m.emissiveIntensity = pulse;
  }
}
