// Rook Ashvane in 3D, built from shapes in a joint hierarchy and posed every
// frame from rigPose() (src/rook.js). Modelled in "character space": units are
// percent of his height, x forward, y up, z toward the camera; the root then
// scales him to his in-game height.
//
// When the sculpted model (rookModel.js) has loaded, it replaces the body
// shapes; the sword, sheath, effects and all posing logic here stay in use.

import * as THREE from 'three';
import { rigPose, poseOf, SHOULDER } from '../rook.js';
import { shieldScale } from '../combat.js';
import { STATE } from '../fighter.js';
import { rimMaterial, glowMaterial } from './materials.js';
import { RookModel, hasModel } from './rookModel.js';

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
    // Hakama ends at mid-shin; striped wraps and sandals show below it.
    leg: new THREE.CylinderGeometry(7.6, 12.4, 38, 16, 1).translate(0, -19, 0),
    shin: new THREE.CylinderGeometry(2.7, 2.4, 10, 10).translate(0, -5, 0),
    foot: new THREE.BoxGeometry(7.6, 2.4, 4.4),
    sole: new THREE.BoxGeometry(10.8, 1.4, 6.2),
    strap: new THREE.BoxGeometry(1.2, 1.4, 5.4),
    torso: new THREE.CylinderGeometry(11.6, 12.4, 26, 16).translate(0, 12.5, 0),
    shoulders: new THREE.SphereGeometry(12.2, 16, 10),
    obi: new THREE.CylinderGeometry(12.9, 12.9, 7.5, 18),
    knot: new THREE.BoxGeometry(4, 6, 6),
    sashTail: new THREE.BoxGeometry(0.8, 20, 3.4).translate(0, -10, 0),
    tassel: new THREE.ConeGeometry(1.3, 4, 6),
    collar: new THREE.ConeGeometry(4.6, 12, 3),
    // Kimono sleeves are wide and deep: a big box that hangs below the arm.
    sleeve: new THREE.BoxGeometry(1, 12.5, 11).translate(0.5, -1.5, 0),
    wrist: new THREE.CylinderGeometry(3.5, 3.5, 4, 10).rotateZ(Math.PI / 2),
    hand: new THREE.SphereGeometry(4.3, 14, 12),
    skull: new THREE.SphereGeometry(12, 22, 18),
    face: new THREE.SphereGeometry(10.6, 22, 18),
    bang: new THREE.ConeGeometry(3, 9, 6),
    spike: new THREE.ConeGeometry(3.4, 13, 6).translate(0, 6.5, 0),
    eye: new THREE.BoxGeometry(1.2, 4.2, 2.6),
    mark: new THREE.BoxGeometry(0.6, 3.4, 0.8),
    headband: new THREE.TorusGeometry(11.6, 1.5, 8, 28),
    hairTie: new THREE.TorusGeometry(2.6, 0.9, 6, 14),
    tail: new THREE.BoxGeometry(13, 2.4, 0.6).translate(-6.5, 0, 0),
    ponytail: new THREE.ConeGeometry(3.6, 15, 8).translate(0, -7.5, 0),
    hat: new THREE.CylinderGeometry(1.2, 16.5, 5.5, 26),
    // Raimei, the sword: scabbard, hilt and blade all along +x from the hilt.
    sheath: new THREE.CylinderGeometry(1.5, 1.5, 30, 10).rotateZ(Math.PI / 2).translate(-15, 0, 0),
    sheathStripe: new THREE.BoxGeometry(22, 0.5, 0.4).translate(-16, 0, 0),
    cap: new THREE.CylinderGeometry(1.75, 1.75, 1.6, 10).rotateZ(Math.PI / 2),
    blade: new THREE.BoxGeometry(1, 2.4, 0.6).translate(0.5, 0, 0),
    edge: new THREE.BoxGeometry(1, 0.8, 0.8).translate(0.5, 0, 0),
    hilt: new THREE.CylinderGeometry(1.1, 1.1, 7, 8).rotateZ(Math.PI / 2).translate(-3.5, 0, 0),
    guard: new THREE.CylinderGeometry(2.6, 2.6, 0.9, 12).rotateZ(Math.PI / 2),
    gem: new THREE.OctahedronGeometry(1.1),
    star: new THREE.OctahedronGeometry(1.8),
  };
  return G;
}

// ------------------------------------------------- textures, drawn in code
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Kimono cloth with the sheet's swirling cloud pattern near the hem. */
const kimonoTextures = new Map();
function kimonoTexture(kimono, pattern) {
  const key = `${kimono}-${pattern}`;
  if (!kimonoTextures.has(key)) {
    kimonoTextures.set(
      key,
      canvasTexture(128, 128, (g, w, h) => {
        g.fillStyle = css(kimono);
        g.fillRect(0, 0, w, h);
        g.strokeStyle = css(pattern);
        g.fillStyle = css(pattern);
        g.lineWidth = 7;
        g.lineCap = 'round';
        // Two rows of curling cloud scrolls along the lower half.
        for (const [cx, cy, r] of [[24, 96, 14], [64, 104, 16], [104, 94, 13], [44, 70, 10], [90, 68, 9]]) {
          g.beginPath();
          g.arc(cx, cy, r, Math.PI * 0.9, Math.PI * 2.4);
          g.stroke();
          g.beginPath();
          g.arc(cx + r * 0.35, cy - r * 0.15, r * 0.45, Math.PI, Math.PI * 2.6);
          g.stroke();
        }
        g.fillRect(0, h - 10, w, 10); // pattern band at the hem
      })
    );
  }
  return kimonoTextures.get(key);
}

let SHARED = null;
function sharedTextures(base) {
  if (SHARED) return SHARED;
  SHARED = {
    // Woven straw: crossed strands.
    straw: canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = css(base.straw);
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,45,15,0.45)';
      g.lineWidth = 1.5;
      for (let i = -64; i < 128; i += 6) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.stroke();
        g.beginPath();
        g.moveTo(i + 64, 0);
        g.lineTo(i, 64);
        g.stroke();
      }
    }),
    // Shin wraps: dark cloth with pale stripes.
    stripes: canvasTexture(16, 32, (g, w, h) => {
      g.fillStyle = css(base.wrap);
      g.fillRect(0, 0, w, h);
      g.fillStyle = css(base.wrapStripe);
      for (let y = 2; y < h; y += 8) g.fillRect(0, y, w, 3);
    }),
    // Hilt: dark cord wrapped in a gold diamond pattern.
    hilt: canvasTexture(64, 16, (g, w, h) => {
      g.fillStyle = '#1a1d33';
      g.fillRect(0, 0, w, h);
      g.fillStyle = css(base.gold);
      for (let x = 0; x < w; x += 8) {
        g.beginPath();
        g.moveTo(x, h / 2);
        g.lineTo(x + 4, 2);
        g.lineTo(x + 8, h / 2);
        g.lineTo(x + 4, h - 2);
        g.closePath();
        g.fill();
      }
    }),
  };
  SHARED.straw.repeat.set(3, 1);
  SHARED.stripes.repeat.set(1, 2);
  return SHARED;
}

/** Point a cone (built along +y) in direction d. */
const UP = new THREE.Vector3(0, 1, 0);
function aim(mesh, d) {
  mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...d).normalize());
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
    const tex = sharedTextures(pal);
    const textured = (map, opts) => {
      const mat = rimMaterial(0xffffff, opts);
      mat.map = map;
      return mat;
    };
    const m = (this.mats = {
      kimono: rimMaterial(pal.kimono),
      sleeve: textured(kimonoTexture(pal.kimono, pal.pattern)),
      hakama: rimMaterial(pal.hakama, { roughness: 0.75 }),
      obi: rimMaterial(pal.obi, { roughness: 0.5 }),
      gold: rimMaterial(pal.gold, { roughness: 0.35, metalness: 0.5, rimStrength: 0.4 }),
      collar: rimMaterial(pal.collar, { roughness: 0.6 }),
      straw: textured(tex.straw, { roughness: 0.9 }),
      wrap: rimMaterial(pal.wrap, { roughness: 0.8 }),
      shin: textured(tex.stripes, { roughness: 0.8 }),
      strap: rimMaterial(pal.strap, { roughness: 0.7 }),
      hair: rimMaterial(pal.hair, { roughness: 0.45, rimStrength: 0.8 }),
      skin: rimMaterial(pal.skin, { roughness: 0.55, rim: 0xffc8a0, rimStrength: 0.35 }),
      steel: rimMaterial(pal.steel, { metalness: 0.7, roughness: 0.25, rimStrength: 0.9 }),
      scabbard: rimMaterial(pal.scabbard, { roughness: 0.3, metalness: 0.2 }),
      hilt: textured(tex.hilt, { roughness: 0.6 }),
      eye: glowMaterial(0xe0a23a, 0.45), // amber eyes, as in the sheet
      mark: glowMaterial(pal.spark, 1.2), // the storm mark on his cheek
      stripe: glowMaterial(0x3fe6d4, 0.8), // teal stripe on the scabbard
      gem: glowMaterial(pal.spark, 2.2),
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
    // swings from the hip to wherever rigPose puts that foot. Below the hakama:
    // striped shin wraps, a bare foot, and a straw sandal.
    const leg = (z) => {
      const grp = new THREE.Group();
      grp.position.set(0, HIP_Y, z);
      add(grp, g.leg, m.hakama, [0, 0, 0], 0.06);
      add(grp, g.shin, m.shin, [0, -37, 0]);
      const foot = new THREE.Group();
      foot.position.set(0, -48.6, 0);
      add(foot, g.foot, m.skin, [1.6, 0.9, 0]);
      add(foot, g.sole, m.straw, [1.6, -0.9, 0]);
      add(foot, g.strap, m.strap, [3.2, 0.9, 0]);
      add(foot, g.strap, m.strap, [-0.4, 0.9, 0]);
      grp.add(foot);
      grp.userData.sandal = foot;
      this.body.add(grp);
      return grp;
    };
    this.frontLeg = leg(2.6);
    this.backLeg = leg(-2.6);

    // ------------------------------------------------------------- torso
    add(this.body, g.torso, m.kimono, [0, 50, 0], 0.05).scale.z = 0.76;
    const sh = add(this.body, g.shoulders, m.kimono, [0, 74, 0]);
    sh.scale.set(1, 0.36, 0.8);
    const collar = add(this.body, g.collar, m.collar, [10.4, 69, 0]);
    collar.rotation.z = Math.PI; // point down: the V of the white under-robe
    collar.scale.set(0.3, 1, 1);

    // Sash: band, a knot at the front, two long tails and a gold tassel.
    add(this.body, g.obi, m.obi, [0, 53.5, 0], 0.04).scale.z = 0.78;
    add(this.body, g.knot, m.obi, [12.4, 53.5, 1.5], 0.05);
    const sashTails = new THREE.Group();
    sashTails.position.set(13.2, 51, 1.5);
    add(sashTails, g.sashTail, m.obi, [0, 0, 1.6]).rotation.z = 0.08;
    add(sashTails, g.sashTail, m.obi, [0.4, 0, -1.4]).rotation.z = -0.05;
    add(sashTails, g.tassel, m.gold, [1.2, -2, 4]).rotation.z = Math.PI;
    this.body.add(sashTails);
    this.sashTails = sashTails;

    // Wide woven hat slung on his back, edge-on from the side.
    const hat = add(this.body, g.hat, m.straw, [-11, 64, -1], 0.03);
    hat.rotation.set(0.25, 0, Math.PI / 2 + 0.25);

    // Raimei's scabbard through the sash at the hip, angled back and down: black
    // lacquer, a teal stripe, gold end caps. The hilt pokes forward and is
    // hidden while the blade is drawn.
    this.sheath = new THREE.Group();
    this.sheath.position.set(-1, 52.5, -8);
    this.sheath.rotation.z = -142 * DEG + Math.PI;
    add(this.sheath, g.sheath, m.scabbard);
    add(this.sheath, g.sheathStripe, m.stripe, [0, 1.3, 0.9]);
    add(this.sheath, g.cap, m.gold, [-29.4, 0, 0]);
    add(this.sheath, g.cap, m.gold, [-0.6, 0, 0]);
    this.sheathHilt = new THREE.Group();
    add(this.sheathHilt, g.guard, m.gold, [0.9, 0, 0]);
    add(this.sheathHilt, g.gem, m.gem, [0.9, 0, 1.4]);
    const h = add(this.sheathHilt, g.hilt, m.hilt, [8.4, 0, 0]);
    h.rotation.z = Math.PI;
    this.sheath.add(this.sheathHilt);
    this.body.add(this.sheath);

    // Back arm: a wide sleeve hanging behind the body.
    const backArm = new THREE.Group();
    backArm.position.set(-2, 71, -8);
    backArm.rotation.z = -105 * DEG;
    add(backArm, g.sleeve, m.sleeve).scale.x = 11;
    add(backArm, g.wrist, m.wrap, [10, 0, 0]);
    add(backArm, g.hand, m.skin, [12, 0, 0]);
    this.body.add(backArm);

    // Sword arm: shoulder pivots toward the hand position from rigPose.
    this.arm = new THREE.Group();
    this.arm.position.set(SHOULDER[0], SHOULDER[1], 8);
    this.sleeve = add(this.arm, g.sleeve, m.sleeve, [0, 0, 0], 0.06);
    this.wrist = add(this.arm, g.wrist, m.wrap);
    this.hand = add(this.arm, g.hand, m.skin);
    this.body.add(this.arm);

    // Drawn blade, attached at the hand: gold guard with a cyan gem, a wrapped
    // hilt with a gold tassel, and in storm form crackling lightning.
    this.blade = new THREE.Group();
    this.bladeSteel = add(this.blade, g.blade, m.steel, [2, 0, 0]);
    this.bladeEdge = add(this.blade, g.edge, m.edge, [2, 1.3, 0]);
    add(this.blade, g.hilt, m.hilt, [0, 0, 0]);
    add(this.blade, g.guard, m.gold, [0.9, 0, 0]);
    add(this.blade, g.gem, m.gem, [0.9, 0, 1.4]);
    add(this.blade, g.tassel, m.gold, [-7.4, -1.8, 0]).rotation.z = Math.PI;
    this.lightning = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(pal.spark).multiplyScalar(3), toneMapped: false })
    );
    this.blade.add(this.lightning);
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
    // Spiky mane, swept back and up like the sheet: longer spikes raking
    // backward from the crown and sides, none poking forward over the face.
    const skullC = new THREE.Vector3(-3.4, 1.6, 0);
    for (const [d, len] of [
      [[-1, 0.35, 0], 1.45], [[-1, 0.05, 0.55], 1.3], [[-1, 0.05, -0.55], 1.3],
      [[-0.9, -0.35, 0.4], 1.15], [[-0.9, -0.35, -0.4], 1.15], [[-0.75, 0.7, 0.3], 1.35],
      [[-0.75, 0.7, -0.3], 1.35], [[-0.45, 0.95, 0], 1.25], [[-0.55, 0.3, 0.85], 1.0],
      [[-0.55, 0.3, -0.85], 1.0],
    ]) {
      const dir = new THREE.Vector3(...d).normalize();
      const spike = add(this.head, g.spike, m.hair, skullC.clone().addScaledVector(dir, 8).toArray());
      aim(spike, dir.toArray());
      spike.scale.set(0.8, len, 0.8);
    }
    this.eyes = [3.8, -3.8].map((z) => add(this.head, g.eye, m.eye, [12.6, 0.2, z]));
    add(this.head, g.mark, m.mark, [12.4, -5.6, 5.4]).rotation.z = 0.35;
    const band = add(this.head, g.headband, m.gold, [0.6, 4.6, 0]);
    band.rotation.set(Math.PI / 2, 0.12, 0);
    band.scale.set(1, 0.95, 1);
    this.tails = new THREE.Group();
    this.tails.position.set(-11, 5, 0);
    add(this.tails, g.tail, m.gold, [0, 0, 1]);
    add(this.tails, g.tail, m.gold, [0, -1, -1]).rotation.z = -0.25;
    this.head.add(this.tails);
    // High topknot tied with a gold band; the tail flows back from it.
    const tie = add(this.head, g.hairTie, m.gold, [-5, 12.6, 0]);
    tie.rotation.set(Math.PI / 2, 0, 0.5);
    this.ponytail = new THREE.Group();
    this.ponytail.position.set(-5.6, 13, 0);
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

    if (hasModel) {
      const keep = new Set([this.blade, this.sheath, this.stars]);
      for (const c of this.body.children) c.visible = keep.has(c);
      this.model = new RookModel(pal, this.opts);
      this.mats.model = this.model.material; // dims and flashes with the rest
      this.body.add(this.model.root);
    }
  }

  /** Swap the costume's colours without rebuilding anything. */
  setPalette(pal) {
    const set = (mat, c) => {
      mat.color.set(c);
      mat.userData.base?.set(c);
    };
    set(this.mats.kimono, pal.kimono);
    set(this.mats.hakama, pal.hakama);
    set(this.mats.obi, pal.obi);
    this.mats.sleeve.map = kimonoTexture(pal.kimono, pal.pattern);
    this.mats.sleeve.needsUpdate = true;
    this.model?.setPalette(pal);
    for (const k of ['mark', 'gem', 'edge', 'star']) this.mats[k].emissive.set(pal.spark);
    this.lightning.material.color.set(pal.spark).multiplyScalar(3);
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
    this.wrist.position.set(Math.max(1, reach - 4.5), 0, 0);

    // The model's arm is longer than the shape figure's: the blade goes where
    // its hand actually is.
    const hand = this.model ? this.model.pose(r) : [...r.hand, 9];

    // Blade: drawn and swinging during attacks, sheathed otherwise.
    const drawn = !!r.blade;
    this.blade.visible = drawn;
    this.sheathHilt.visible = !drawn;
    if (drawn) {
      this.blade.position.set(...hand);
      this.blade.rotation.z = r.blade.a * DEG;
      this.bladeSteel.scale.x = r.blade.len;
      this.bladeEdge.scale.x = r.blade.len;
      this.bladeEdge.visible = r.blade.lit;
      // Storm form: jagged lightning along the blade, re-drawn every few frames.
      this.lightning.visible = r.blade.lit;
      if (r.blade.lit && frame % 3 === 0) {
        const pos = this.lightning.geometry.attributes.position;
        const n = pos.count;
        for (let i = 0; i < n; i++) {
          const x = 3 + (i / (n - 1)) * (r.blade.len - 1);
          const jag = i === 0 || i === n - 1 ? 0 : (Math.random() - 0.5) * 3.2;
          pos.setXYZ(i, x, 0.6 + jag, 0.5);
        }
        pos.needsUpdate = true;
      }
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
    this.updateTrail(drawn && r.blade.trail ? { a: r.blade.a, hx: hand[0], hy: hand[1], hz: hand[2], len: r.blade.len } : null);
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
        v.set(hx + Math.cos(a) * r, hy + Math.sin(a) * r, p.hz).applyMatrix4(m);
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
