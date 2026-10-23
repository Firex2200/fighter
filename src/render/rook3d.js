// Rook Ashvane in 3D, built from shapes in a joint hierarchy and posed every
// frame from rigPose() (src/rook.js). Modelled in "character space": units are
// percent of his height, x forward, y up, z toward the camera; the root then
// scales him to his in-game height.
//
// shortcut: a primitive-built figure, not a sculpted model. When a real rigged
// model exists (e.g. generated from the concept turnaround), replace this file's
// build() and keep update(): the rig data it consumes stays the same.

import * as THREE from 'three';
import { rigPose, poseOf, SHOULDER } from '../rook.js';
import { shieldScale } from '../combat.js';
import { STATE } from '../fighter.js';
import { rimMaterial, glowMaterial } from './materials.js';

const DEG = Math.PI / 180;
const HIP_Y = 52;
const TRAIL_LEN = 6; // blade angles remembered for the swing ribbon
const TRAIL_SUB = 6; // points filled in between each pair, so the ribbon curves
const TRAIL_PTS = (TRAIL_LEN - 1) * TRAIL_SUB + 1;

// Geometry is identical for every Rook, so it is built once and shared.
let G = null;
function geometries() {
  if (G) return G;
  G = {
    leg: new THREE.CylinderGeometry(7.4, 11.6, 46, 14, 1).translate(0, -23, 0),
    sandal: new THREE.BoxGeometry(10, 3.2, 7),
    torso: new THREE.CylinderGeometry(11.6, 12.4, 26, 16).translate(0, 12.5, 0),
    shoulders: new THREE.SphereGeometry(12.2, 16, 10),
    obi: new THREE.CylinderGeometry(12.9, 12.9, 7.5, 18),
    collar: new THREE.ConeGeometry(4.6, 12, 3),
    sleeve: new THREE.BoxGeometry(1, 9.5, 9).translate(0.5, 0, 0),
    hand: new THREE.SphereGeometry(4.3, 14, 12),
    skull: new THREE.SphereGeometry(12, 22, 18),
    face: new THREE.SphereGeometry(10.6, 22, 18),
    bang: new THREE.ConeGeometry(3, 9, 6),
    eye: new THREE.BoxGeometry(1.2, 4.2, 2.6),
    mark: new THREE.BoxGeometry(0.6, 3.4, 0.8),
    headband: new THREE.TorusGeometry(11.6, 1.5, 8, 28),
    tail: new THREE.BoxGeometry(13, 2.4, 0.6).translate(-6.5, 0, 0),
    ponytail: new THREE.ConeGeometry(3.6, 15, 8).translate(0, -7.5, 0),
    hat: new THREE.CylinderGeometry(1.6, 14.5, 4.5, 20),
    sheath: new THREE.CylinderGeometry(1.4, 1.4, 30, 8).rotateZ(Math.PI / 2).translate(-15, 0, 0),
    blade: new THREE.BoxGeometry(1, 2.4, 0.6).translate(0.5, 0, 0),
    edge: new THREE.BoxGeometry(1, 0.8, 0.8).translate(0.5, 0, 0),
    hilt: new THREE.BoxGeometry(6, 2.2, 2.2).translate(-3, 0, 0),
    guard: new THREE.CylinderGeometry(2.4, 2.4, 0.8, 10).rotateZ(Math.PI / 2),
    star: new THREE.OctahedronGeometry(1.8),
  };
  return G;
}

export class Rook3D {
  /**
   * @param scene    THREE.Scene to add him (and his effects) to
   * @param palette  result of paletteFor()
   * @param height   in-game height in world units
   * @param opts     { outlines, shadows }
   */
  constructor(scene, palette, height, opts = {}) {
    this.scene = scene;
    this.height = height;
    this.opts = { outlines: true, shadows: true, ...opts };
    this.flash = 0;
    this.trail = [];
    this.build(palette);
  }

  build(pal) {
    const g = geometries();
    const m = (this.mats = {
      kimono: rimMaterial(pal.kimono),
      hakama: rimMaterial(pal.hakama, { roughness: 0.75 }),
      obi: rimMaterial(pal.obi, { roughness: 0.5 }),
      straw: rimMaterial(pal.straw, { roughness: 0.85 }),
      hair: rimMaterial(pal.hair, { roughness: 0.45, rimStrength: 0.8 }),
      skin: rimMaterial(pal.skin, { roughness: 0.55, rim: 0xffc8a0, rimStrength: 0.35 }),
      sandal: rimMaterial(pal.sandal),
      steel: rimMaterial(pal.steel, { metalness: 0.7, roughness: 0.25, rimStrength: 0.9 }),
      sheath: rimMaterial(0x1a1c26, { roughness: 0.4 }),
      eye: glowMaterial(pal.spark, 1.1),
      edge: glowMaterial(pal.spark, 3.2),
      star: glowMaterial(pal.spark, 2.6),
    });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x07080d, side: THREE.BackSide });

    const add = (parent, geo, mat, pos = [0, 0, 0], outline = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.castShadow = this.opts.shadows;
      parent.add(mesh);
      // Inverted-hull ink line: a slightly larger black copy showing only its
      // back faces, which reads as an outline. Skipped on the lowest quality.
      if (outline && this.opts.outlines) {
        const hull = new THREE.Mesh(geo, this.outlineMat);
        hull.scale.setScalar(1 + outline);
        mesh.add(hull);
      }
      return mesh;
    };

    this.root = new THREE.Group();
    this.root.scale.setScalar(this.height / 100);
    this.pose = new THREE.Group(); // offset (getup climb, bob)
    this.pivot = new THREE.Group(); // lean and squash happen about this point
    this.body = new THREE.Group(); // everything in character space
    this.root.add(this.pose);
    this.pose.add(this.pivot);
    this.pivot.add(this.body);
    this.scene.add(this.root);

    // ---------------------------------------------------------- legs, hakama
    // Two wide tapered legs overlap into the hakama's flared silhouette; each
    // swings from the hip to wherever rigPose puts that foot.
    const leg = (z) => {
      const grp = new THREE.Group();
      grp.position.set(0, HIP_Y, z);
      add(grp, g.leg, m.hakama, [0, 0, 0], 0.06);
      const sandal = add(grp, g.sandal, m.sandal, [1.5, -47, 0]);
      grp.userData.sandal = sandal;
      this.body.add(grp);
      return grp;
    };
    this.frontLeg = leg(2.6);
    this.backLeg = leg(-2.6);

    // ------------------------------------------------------------- torso
    add(this.body, g.torso, m.kimono, [0, 50, 0], 0.05).scale.z = 0.76;
    const sh = add(this.body, g.shoulders, m.kimono, [0, 74, 0]);
    sh.scale.set(1, 0.36, 0.8);
    add(this.body, g.obi, m.obi, [0, 53.5, 0], 0.04).scale.z = 0.78;
    const collar = add(this.body, g.collar, m.straw, [10.4, 69, 0]);
    collar.rotation.z = Math.PI; // point down: the V of the under-robe
    collar.scale.set(0.3, 1, 1);

    // Hat slung on his back, edge-on from the side.
    const hat = add(this.body, g.hat, m.straw, [-10, 63, -1], 0.04);
    hat.rotation.set(0.25, 0, Math.PI / 2 + 0.25);

    // Scabbard through the obi at the hip, angled back and down; the hilt pokes
    // forward and is hidden while the blade is drawn.
    this.sheath = new THREE.Group();
    this.sheath.position.set(-1, 52.5, -8);
    this.sheath.rotation.z = -142 * DEG + Math.PI;
    add(this.sheath, g.sheath, m.sheath);
    this.sheathHilt = add(this.sheath, g.hilt, m.obi, [6, 0, 0]);
    this.sheathHilt.rotation.z = Math.PI;
    this.body.add(this.sheath);

    // Back arm: a sleeve hanging behind the body.
    const backArm = new THREE.Group();
    backArm.position.set(-2, 71, -8);
    backArm.rotation.z = -105 * DEG;
    add(backArm, g.sleeve, m.kimono).scale.x = 11;
    add(backArm, g.hand, m.skin, [11, 0, 0]);
    this.body.add(backArm);

    // Sword arm: shoulder pivots toward the hand position from rigPose.
    this.arm = new THREE.Group();
    this.arm.position.set(SHOULDER[0], SHOULDER[1], 8);
    this.sleeve = add(this.arm, g.sleeve, m.kimono, [0, 0, 0], 0.08);
    this.hand = add(this.arm, g.hand, m.skin);
    this.body.add(this.arm);

    // Drawn blade, attached at the hand.
    this.blade = new THREE.Group();
    this.bladeSteel = add(this.blade, g.blade, m.steel, [2, 0, 0]);
    this.bladeEdge = add(this.blade, g.edge, m.edge, [2, 1.3, 0]);
    add(this.blade, g.hilt, m.obi, [0, 0, 0]);
    add(this.blade, g.guard, m.sheath, [0.4, 0, 0]);
    this.body.add(this.blade);

    // --------------------------------------------------------------- head
    this.head = new THREE.Group();
    this.head.position.set(1, 88, 0);
    this.body.add(this.head);
    add(this.head, g.skull, m.hair, [-3.4, 1.6, 0], 0.05);
    const face = add(this.head, g.face, m.skin, [3.4, -1.8, 0]);
    face.scale.set(0.9, 1, 1.02);
    // Anime-style bangs over the brow.
    for (const [z, tilt] of [[-6, 0.2], [-2, 0.05], [2, -0.05], [6, -0.2]]) {
      const bang = add(this.head, g.bang, m.hair, [8.6, 6.6, z]);
      bang.rotation.set(tilt, 0, -2.3);
    }
    this.eyes = [3.8, -3.8].map((z) => add(this.head, g.eye, m.eye, [12.6, 0.2, z]));
    add(this.head, g.mark, m.eye, [12.4, -5.6, 5.4]).rotation.z = 0.35;
    const band = add(this.head, g.headband, m.obi, [0.6, 4.6, 0]);
    band.rotation.set(Math.PI / 2, 0.12, 0);
    band.scale.set(1, 0.95, 1);
    this.tails = new THREE.Group();
    this.tails.position.set(-11, 5, 0);
    add(this.tails, g.tail, m.obi, [0, 0, 1]);
    add(this.tails, g.tail, m.obi, [0, -1, -1]).rotation.z = -0.25;
    this.head.add(this.tails);
    this.ponytail = new THREE.Group();
    this.ponytail.position.set(-10, 3, 0);
    add(this.ponytail, g.ponytail, m.hair, [0, 0, 0], 0.06);
    this.head.add(this.ponytail);

    // Dizzy stars, shown after a shield break.
    this.stars = new THREE.Group();
    this.stars.position.set(0, 104, 0);
    this.starMeshes = [0, 1, 2].map(() => add(this.stars, g.star, m.star));
    this.body.add(this.stars);

    // Shield bubble: separate from the body so lean and squash don't distort it.
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(pal.spark) }, uAlpha: { value: 0.5 } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
          void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(uColor * (0.6 + 1.6*f), uAlpha*(0.25 + 0.75*f)); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scene.add(this.shield);

    // Swing ribbon: a curved strip along the arc the blade just swept.
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_PTS * 2 * 3), 3));
    trailGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TRAIL_PTS * 2), 1));
    const idx = [];
    for (let i = 0; i < TRAIL_PTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    trailGeo.setIndex(idx);
    this.trailMesh = new THREE.Mesh(
      trailGeo,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(pal.spark).multiplyScalar(1.5) } },
        vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA*0.55); }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    this.trailMesh.frustumCulled = false;
    this.scene.add(this.trailMesh);
  }

  /** Swap the costume's three colours without rebuilding anything. */
  setPalette(pal) {
    const set = (mat, c) => {
      mat.color.set(c);
      mat.userData.base?.set(c);
    };
    set(this.mats.kimono, pal.kimono);
    set(this.mats.obi, pal.obi);
    for (const k of ['eye', 'edge', 'star']) this.mats[k].emissive.set(pal.spark);
    this.shield.material.uniforms.uColor.value.set(pal.spark);
    this.trailMesh.material.uniforms.uColor.value.set(pal.spark).multiplyScalar(1.5);
  }

  /**
   * Pose him from the game. `fighter` is a Fighter; `frame` a frame counter.
   * Pass `override` (a pose object) to pose him without a fighter, e.g. menus.
   */
  update(fighter, frame, override = null) {
    const pose = override ?? poseOf(fighter, frame);
    const r = rigPose(pose);
    const facing = fighter ? fighter.facing : override.facing ?? 1;

    // Visible unless dead or blinking through respawn invulnerability.
    const dead = fighter && fighter.state === STATE.DEAD;
    const blinking = fighter && fighter.invulnFrames > 0 && Math.floor(fighter.invulnFrames / 4) % 2 === 0;
    this.root.visible = !dead && !blinking;

    if (fighter) this.root.position.set(fighter.x, fighter.y, 0);
    // Turned a little toward the camera, like Smash. Mirroring depth keeps the
    // sword arm on the camera side whichever way he faces.
    this.root.rotation.y = facing > 0 ? -0.45 : Math.PI + 0.45;
    this.root.scale.set(this.height / 100, this.height / 100, (facing > 0 ? 1 : -1) * (this.height / 100));

    this.pose.position.set(r.ox, r.oy + r.bob, 0);
    this.pivot.position.set(0, r.pivotY, 0);
    this.body.position.set(0, -r.pivotY, 0);
    this.pivot.rotation.z = r.angle * DEG;
    this.pivot.scale.set(1, r.sy, 1);

    // Legs reach for their feet: rotate from the hip, and shorten for a lifted
    // foot so it reads as a bent knee.
    const legTo = (grp, footX, lift) => {
      const dx = footX;
      const dy = HIP_Y - lift;
      grp.rotation.z = Math.atan2(dx, dy);
      grp.scale.y = Math.hypot(dx, dy) / HIP_Y;
      grp.userData.sandal.rotation.z = -grp.rotation.z;
    };
    legTo(this.frontLeg, r.frontFoot, r.frontLift);
    legTo(this.backLeg, r.backFoot, r.backLift);

    // Sword arm toward the hand.
    const hx = r.hand[0] - SHOULDER[0];
    const hy = r.hand[1] - SHOULDER[1];
    const reach = Math.hypot(hx, hy);
    this.arm.rotation.z = Math.atan2(hy, hx);
    this.sleeve.scale.x = Math.max(1, reach);
    this.hand.position.set(reach, 0, 0);

    // Blade: drawn and swinging during attacks, sheathed otherwise.
    const drawn = !!r.blade;
    this.blade.visible = drawn;
    this.sheathHilt.visible = !drawn;
    if (drawn) {
      this.blade.position.set(r.hand[0], r.hand[1], 9);
      this.blade.rotation.z = r.blade.a * DEG;
      this.bladeSteel.scale.x = r.blade.len;
      this.bladeEdge.scale.x = r.blade.len;
      this.bladeEdge.visible = r.blade.lit;
    }

    // Hair and headband tails lag behind his motion.
    this.tails.rotation.z = (r.trailY * 2.4 - 6) * DEG;
    this.tails.rotation.y = (-r.trailX * 2) * DEG;
    this.ponytail.rotation.z = (-35 + r.trailY * 3 - r.trailX * 2) * DEG;

    for (const e of this.eyes) e.scale.y = r.eyeOpen;
    this.stars.visible = r.stars;
    if (r.stars) {
      this.starMeshes.forEach((s, i) => {
        const a = frame / 9 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 14, Math.sin(a) * 3, Math.sin(a) * 10);
      });
    }

    // Helpless: dimmed. Hit or dodging: flashed bright.
    if (this.flash > 0) this.flash--;
    const flash = (this.flash > 0 ? 0.55 * (this.flash / 6) : 0) + (fighter?.intangible && frame % 6 < 3 ? 0.35 : 0);
    for (const mat of Object.values(this.mats)) {
      if (mat.userData.uniforms) mat.userData.uniforms.uFlash.value = flash;
      if (mat.userData.base) mat.color.copy(mat.userData.base).multiplyScalar(r.dim ? 0.45 : 1);
    }

    this.root.updateMatrixWorld(true);
    this.updateShield(fighter);
    this.updateTrail(drawn && r.blade.trail ? { a: r.blade.a, hx: r.hand[0], hy: r.hand[1], len: r.blade.len } : null);
  }

  updateShield(f) {
    const on = f && f.state === STATE.SHIELD && this.root.visible;
    this.shield.visible = !!on;
    if (!on) return;
    const s = this.height * 0.62 * shieldScale(f.shieldHP);
    this.shield.position.set(f.x, f.y + this.height * 0.5, 0);
    this.shield.scale.setScalar(s);
    this.shield.material.uniforms.uAlpha.value = f.shieldstun > 0 ? 0.85 : 0.5;
  }

  /**
   * Keep the last few blade angles and draw a ribbon along the arc between them.
   * Angles are interpolated, so even a swing that covers 60 degrees in one frame
   * leaves a smooth curve rather than a flat slab.
   */
  updateTrail(sample) {
    if (sample) {
      this.trail.unshift(sample);
      if (this.trail.length > TRAIL_LEN) this.trail.pop();
    } else if (this.trail.length) {
      this.trail.pop(); // shrink away rather than vanish
    }
    const n = this.trail.length;
    this.trailMesh.visible = n > 1;
    if (n < 2) return;

    const pos = this.trailMesh.geometry.attributes.position;
    const alpha = this.trailMesh.geometry.attributes.alpha;
    const m = this.body.matrixWorld;
    const v = new THREE.Vector3();
    const span = (n - 1) * TRAIL_SUB;
    for (let k = 0; k < TRAIL_PTS; k++) {
      const kk = Math.min(k, span);
      const i = Math.floor(kk / TRAIL_SUB);
      const t = (kk - i * TRAIL_SUB) / TRAIL_SUB;
      const p = this.trail[i];
      const q = this.trail[Math.min(i + 1, n - 1)];
      const a = (p.a + (q.a - p.a) * t) * DEG;
      const hx = p.hx + (q.hx - p.hx) * t;
      const hy = p.hy + (q.hy - p.hy) * t;
      const len = p.len + (q.len - p.len) * t;
      const fade = k <= span ? Math.pow(1 - kk / span, 1.6) : 0;
      // Inner edge near the hand is faint, the tip edge is bright.
      [len * 0.35, len + 2].forEach((r, j) => {
        v.set(hx + Math.cos(a) * r, hy + Math.sin(a) * r, 9).applyMatrix4(m);
        pos.setXYZ(k * 2 + j, v.x, v.y, v.z);
        alpha.setX(k * 2 + j, fade * (j ? 1 : 0.1));
      });
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.root, this.shield, this.trailMesh);
  }
}
