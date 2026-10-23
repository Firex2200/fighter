// Hit sparks, KO blasts, dust and friends. Everything is pooled and drawn in a
// few draw calls, so a busy fight costs a phone no more than a quiet one.

import * as THREE from 'three';
import { softDotTexture } from './materials.js';

/**
 * Many particles in one draw call. Each particle: position, velocity, colour,
 * start/end size, life. Sizes are in world units and shrink with distance.
 */
class Particles {
  constructor(scene, capacity, blending) {
    this.capacity = capacity;
    this.p = []; // live particles
    this.free = [];
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.alpha = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.pos, this.col, this.size, this.alpha]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    geo.setAttribute('size', this.size);
    geo.setAttribute('alpha', this.alpha);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDotTexture() }, uScale: { value: 400 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit({ x, y, z = 0, vx = 0, vy = 0, vz = 0, color, size0, size1, life, drag = 0.92, gravity = 0, alpha = 1 }) {
    const i = this.free.pop();
    if (i === undefined) return; // pool full: skip rather than allocate mid-fight
    this.p.push({ i, x, y, z, vx, vy, vz, c: new THREE.Color(color), size0, size1, life, max: life, drag, gravity, alpha });
  }

  update(dt) {
    for (let k = this.p.length - 1; k >= 0; k--) {
      const q = this.p[k];
      q.life -= dt;
      if (q.life <= 0) {
        this.alpha.setX(q.i, 0);
        this.free.push(q.i);
        this.p.splice(k, 1);
        continue;
      }
      q.vx *= q.drag;
      q.vy = q.vy * q.drag - q.gravity * dt;
      q.vz *= q.drag;
      q.x += q.vx * dt * 60;
      q.y += q.vy * dt * 60;
      q.z += q.vz * dt * 60;
      const t = 1 - q.life / q.max;
      this.pos.setXYZ(q.i, q.x, q.y, q.z);
      this.col.setXYZ(q.i, q.c.r, q.c.g, q.c.b);
      this.size.setX(q.i, q.size0 + (q.size1 - q.size0) * t);
      this.alpha.setX(q.i, q.alpha * (1 - t) * Math.min(1, t * 8 + 0.3));
    }
    for (const a of [this.pos, this.col, this.size, this.alpha]) a.needsUpdate = true;
  }
}

/** A streak that is brightest at its root and along its centre line. */
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  const along = g.createLinearGradient(0, 0, 128, 0);
  along.addColorStop(0, 'rgba(255,255,255,1)');
  along.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 128, 32);
  // Fade the edges across the width so the beam has no hard sides.
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 0, 32);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flat shapes that grow and fade: impact rings, KO beams, halos. */
class Flashes {
  constructor(scene, count) {
    this.items = [];
    // Beams and discs get soft textures; rings stay crisp.
    this.maps = { beam: beamTexture(), disc: softDotTexture(), ring: null };
    const ring = new THREE.RingGeometry(0.75, 1, 40);
    const disc = new THREE.PlaneGeometry(2, 2); // with the soft dot texture, reads as a glow
    const beam = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.geos = { ring, disc, beam };
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        ring,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, life: 0 });
    }
  }

  spawn({ shape = 'ring', x, y, z = 4, color, s0, s1, life, rot = 0, sy = null, opacity = 0.9 }) {
    const item = this.items.find((it) => it.life <= 0) ?? this.items[0];
    item.mesh.geometry = this.geos[shape];
    const map = this.maps[shape];
    if (item.mesh.material.map !== map) {
      item.mesh.material.map = map;
      item.mesh.material.needsUpdate = true;
    }
    item.mesh.material.color.set(color);
    item.mesh.position.set(x, y, z);
    item.mesh.rotation.set(0, 0, rot);
    item.mesh.visible = true;
    Object.assign(item, { life, max: life, s0, s1, sy, opacity });
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.mesh.visible = false;
        continue;
      }
      const t = 1 - it.life / it.max;
      const s = it.s0 + (it.s1 - it.s0) * (1 - (1 - t) * (1 - t));
      it.mesh.scale.set(s, it.sy ?? s, 1);
      it.mesh.material.opacity = it.opacity * (1 - t);
    }
  }
}

export class Effects {
  /** @param quality 0..1, scales particle counts on slower devices */
  constructor(scene, quality = 1) {
    this.q = quality;
    this.glow = new Particles(scene, 900, THREE.AdditiveBlending);
    this.smoke = new Particles(scene, 500, THREE.NormalBlending);
    this.flashes = new Flashes(scene, 24);
    this.shake = 0;
  }

  count(n) {
    return Math.max(1, Math.round(n * this.q));
  }

  /** A clean hit: spark burst, flash and ring, all scaled by damage. */
  hit(x, y, damage, color, kb = 0) {
    const big = Math.min(1, damage / 15);
    const n = this.count(10 + damage * 1.6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * (1.5 + big * 2.5);
      this.glow.emit({ x, y, z: 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, size0: 3 + big * 3, size1: 0.5, life: 0.25 + Math.random() * 0.25, drag: 0.86 });
    }
    this.glow.emit({ x, y, z: 6, color: 0xffffff, size0: 10 + big * 22, size1: 2, life: 0.12 });
    this.flashes.spawn({ shape: 'ring', x, y, color, s0: 2, s1: 9 + big * 14, life: 0.28 });
    if (kb > 120) this.flashes.spawn({ shape: 'ring', x, y, color: 0xffffff, s0: 4, s1: 22, life: 0.3, opacity: 0.35 });
    this.shake = Math.max(this.shake, big * 2.2 + (kb > 120 ? 2.5 : 0));
  }

  block(x, y, color) {
    this.flashes.spawn({ shape: 'ring', x, y, color, s0: 6, s1: 16, life: 0.22 });
    for (let i = 0; i < this.count(8); i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({ x, y, z: 6, vx: Math.cos(a), vy: Math.sin(a), color, size0: 2.5, size1: 0.4, life: 0.25 });
    }
  }

  /** Thunder Guard's catch: a bright burst in the counterer's colour. */
  counter(x, y, color) {
    this.hit(x, y, 14, color, 140);
    this.flashes.spawn({ shape: 'disc', x, y, color, s0: 4, s1: 20, life: 0.3, opacity: 0.5 });
  }

  /**
   * Smash-style KO: a coloured blast at the blast line, with a beam shooting
   * back toward the stage.
   * @param x,y        where they crossed
   * @param toward     {x, y} the camera centre, so the beam points on screen
   */
  ko(x, y, color, toward) {
    const ang = Math.atan2(toward.y - y, toward.x - x);
    for (let i = 0; i < 3; i++) {
      this.flashes.spawn({ shape: 'beam', x, y, z: 8 + i, color: i ? color : 0xffffff, rot: ang + (i - 1) * 0.12, s0: 30, s1: 260 - i * 50, sy: 14 - i * 4, life: 0.75 + i * 0.1, opacity: 0.85 });
    }
    this.flashes.spawn({ shape: 'disc', x, y, z: 9, color, s0: 10, s1: 80, life: 0.6, opacity: 0.8 });
    this.flashes.spawn({ shape: 'ring', x, y, z: 10, color: 0xffffff, s0: 10, s1: 110, life: 0.7 });
    for (let i = 0; i < this.count(60); i++) {
      const a = ang + (Math.random() - 0.5) * 1.6;
      const sp = 2 + Math.random() * 6;
      this.glow.emit({ x, y, z: 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color: Math.random() < 0.3 ? 0xffffff : color, size0: 6, size1: 1, life: 0.5 + Math.random() * 0.5, drag: 0.93 });
    }
    this.shake = Math.max(this.shake, 7);
  }

  /** Smoke left behind someone flying at kill speed. */
  launchTrail(x, y) {
    this.smoke.emit({ x: x + Math.random() * 3 - 1.5, y: y + Math.random() * 3 - 1.5, z: -1, color: 0xd8dce8, size0: 5, size1: 13, life: 0.55, alpha: 0.5, drag: 0.95 });
  }

  dust(x, y, amount = 1) {
    for (let i = 0; i < this.count(6 * amount); i++) {
      const side = i % 2 ? 1 : -1;
      this.smoke.emit({ x: x + side * 4, y: y + 1, z: 2, vx: side * (0.3 + Math.random() * 0.6), vy: 0.15 + Math.random() * 0.2, color: 0xb8b2a8, size0: 3, size1: 8, life: 0.45, alpha: 0.55 });
    }
  }

  jumpPuff(x, y) {
    this.flashes.spawn({ shape: 'ring', x, y: y + 1, color: 0xdfe6ff, s0: 3, s1: 11, life: 0.25, sy: 2, opacity: 0.6 });
  }

  glint(x, y, color) {
    this.glow.emit({ x, y, z: 6, color: 0xffffff, size0: 12, size1: 0, life: 0.3 });
    this.glow.emit({ x, y, z: 6, color, size0: 18, size1: 2, life: 0.4 });
  }

  /** A glowing halo under a fighter who has just respawned. */
  halo(x, y, color) {
    this.glow.emit({ x: x + Math.random() * 16 - 8, y: y - 1, z: 2, vy: 0.05, color, size0: 3, size1: 0.5, life: 0.4 });
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.flashes.update(dt);
    this.shake *= Math.pow(0.0008, dt); // fades to nothing in about a second
    if (this.shake < 0.05) this.shake = 0;
  }

  /** How far to jiggle the camera this frame. */
  shakeOffset() {
    if (!this.shake) return [0, 0];
    return [(Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake];
  }

  setScale(pxPerUnitAt1) {
    this.glow.material.uniforms.uScale.value = pxPerUnitAt1;
    this.smoke.material.uniforms.uScale.value = pxPerUnitAt1;
  }
}
