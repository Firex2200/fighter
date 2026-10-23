// The 3D world: renderer, camera, lights, glow, and everything drawn in it.
// It only *shows* the game; src/match.js and the gameplay modules decide what
// happens. camera.js still decides framing; this turns it into a 3D camera.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STATE } from '../fighter.js';
import { Rook3D } from './rook3d.js';
import { Stage3D } from './stage3d.js';
import { Sky, HORIZON } from './sky.js';
import { Effects } from './effects.js';

/**
 * Quality tiers. Phones start at medium; any device steps down a tier if frames
 * run slow for two seconds straight.
 */
export const TIERS = {
  high: { name: 'high', pixelRatio: 2, shadowSize: 2048, bloom: true, msaa: 4, outlines: true, rain: 900, particles: 1 },
  medium: { name: 'medium', pixelRatio: 2, shadowSize: 1024, bloom: true, msaa: 0, outlines: true, rain: 450, particles: 0.7 },
  low: { name: 'low', pixelRatio: 1.25, shadowSize: 0, bloom: false, msaa: 0, outlines: false, rain: 180, particles: 0.45 },
};
const ORDER = ['high', 'medium', 'low'];

export function pickTier() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (TIERS[forced]) return forced;
  return window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}

const FOV = 30; // narrow, like Smash: flattens depth so the fight reads as 2D
const TILT = 6 * (Math.PI / 180); // camera looks slightly down on the stage
const FIGHTER_HEIGHT = 26;

export class World {
  constructor(container, tierName = pickTier()) {
    this.container = container;
    this.tier = TIERS[tierName];
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(HORIZON, 0.00042);
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 5, 9000);

    // Lighting: cool sky fill, a warm key light with soft shadows, and a cool
    // rim light from behind that outlines the fighters.
    this.hemi = new THREE.HemisphereLight(0x9fb4ff, 0x2a2230, 0.7);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffe2c4, 2.8);
    this.key.position.set(-120, 220, 260);
    const sc = this.key.shadow.camera;
    Object.assign(sc, { left: -160, right: 160, top: 130, bottom: -110, near: 10, far: 900 });
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.6;
    this.scene.add(this.key, this.key.target);
    this.rim = new THREE.DirectionalLight(0x7fd8ff, 1.4);
    this.rim.position.set(80, 120, -300);
    this.scene.add(this.rim);

    this.sky = new Sky(this.scene, { rain: this.tier.rain });
    this.stage = new Stage3D(this.scene, { shadows: this.tier.shadowSize > 0 });
    this.effects = new Effects(this.scene, this.tier.particles);
    this.rooks = [];
    this.view = { x: 0, y: 20, halfH: 92 };
    this.frame = 0;
    this.slowFrames = 0;
    this.onDegrade = null;

    this.buildPipeline();
    this.applyTier();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildPipeline() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.tier.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Glow on anything brighter than the scene: blade edges, runes, effects.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  applyTier() {
    const t = this.tier;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pixelRatio));
    this.renderer.shadowMap.enabled = t.shadowSize > 0;
    this.key.castShadow = t.shadowSize > 0;
    if (t.shadowSize) {
      this.key.shadow.mapSize.set(t.shadowSize, t.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.bloom.enabled = t.bloom;
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true; // shadow on/off recompiles
    });
    this.resize();
  }

  /** Step down one quality tier (called automatically when frames run slow). */
  degrade() {
    const i = ORDER.indexOf(this.tier.name);
    if (i >= ORDER.length - 1) return false;
    this.tier = TIERS[ORDER[i + 1]];
    this.applyTier();
    this.onDegrade?.(this.tier.name);
    return true;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio?.(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Particle sizes are in world units; this converts them to pixels.
    const px = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((FOV * Math.PI) / 360));
    this.effects.setScale(px);
  }

  /** Screen height / width, which camera.js needs. */
  get aspect() {
    return this.camera.aspect ? 1 / this.camera.aspect : 9 / 16;
  }

  /** Make one Rook per fighter (or per menu figure) in the given costumes. */
  setFighters(palettes) {
    for (const r of this.rooks) r.dispose();
    this.rooks = palettes.map(
      (pal) => new Rook3D(this.scene, pal, FIGHTER_HEIGHT, { outlines: this.tier.outlines, shadows: this.tier.shadowSize > 0 })
    );
  }

  /** Point the camera: centre (x, y) and visible half-height, as camera.js gives. */
  setView(view) {
    this.view = view;
  }

  /**
   * React to what happened in the match this frame: sparks, blasts, dust.
   * @returns nothing; sounds are handled by the caller from the same events
   */
  handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          this.effects.hit(e.x, e.y, e.damage, e.attacker.palette.spark, e.kb);
          this.rooks[e.defender.slot] && (this.rooks[e.defender.slot].flash = 6);
          break;
        case 'block':
          this.effects.block(e.x, e.y, e.defender.palette.spark);
          break;
        case 'counter':
          this.effects.counter(e.x, e.y, e.attacker.palette.spark);
          break;
        case 'ko':
          this.effects.ko(e.x, e.y, e.fighter.palette.obi, this.view);
          break;
        case 'land':
          this.effects.dust(e.fighter.x, e.fighter.y);
          break;
        case 'jump':
          this.effects.jumpPuff(e.fighter.x, e.fighter.y);
          break;
        case 'ledge':
          this.effects.glint(e.fighter.ledge?.x ?? e.fighter.x, 0, e.fighter.palette.spark);
          break;
      }
    }
  }

  /**
   * Draw one frame.
   * @param fighters  Fighter objects to pose (or null to leave rooks as posed)
   * @param dt        seconds since last frame
   */
  render(fighters, dt) {
    this.frame++;

    if (fighters) {
      fighters.forEach((f, i) => {
        const rook = this.rooks[i];
        if (!rook) return;
        rook.update(f, this.frame);
        // Trails and halos that follow fighters around.
        if (f.state === STATE.HITSTUN && Math.hypot(f.launchX, f.launchY) > 2.2 && this.frame % 2 === 0) {
          this.effects.launchTrail(f.x, f.y + FIGHTER_HEIGHT / 2);
        }
        if (f.invulnFrames > 40 && f.airborne && f.state !== STATE.DEAD && this.frame % 3 === 0) {
          this.effects.halo(f.x, f.y, f.palette.spark);
        }
      });
    }

    // Camera: distance so the visible half-height at the stage equals view.halfH.
    const [sx, sy] = this.effects.shakeOffset();
    const dist = this.view.halfH / Math.tan((FOV * Math.PI) / 360);
    const tx = this.view.x + sx;
    const ty = this.view.y + sy;
    this.camera.position.set(tx, ty + Math.sin(TILT) * dist, Math.cos(TILT) * dist);
    this.camera.lookAt(tx, ty, 0);

    const flash = this.sky.update(dt, { x: this.view.x, y: this.view.y });
    this.hemi.intensity = 0.7 + flash * 1.2;
    this.stage.update(dt, flash);
    this.effects.update(dt);

    this.composer.render(dt);
    this.watchSpeed(dt);
  }

  /** Step down a quality tier after two seconds of slow frames. */
  watchSpeed(dt) {
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 120) {
      this.slowFrames = 0;
      this.degrade();
    }
  }

  /** Render one Rook's head to an image, for the HUD portraits. */
  portrait(palette, size = 128) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x302838, 1.6));
    const key = new THREE.DirectionalLight(0xffe8d0, 2.2);
    key.position.set(40, 60, 100);
    scene.add(key);
    const rook = new Rook3D(scene, palette, FIGHTER_HEIGHT, { outlines: true, shadows: false });
    rook.update(null, 0, { kind: 'idle', t: 0, frame: 0, vx: 0, vy: 0, stride: 0, airborne: false, ox: 0, oy: 0, facing: 1 });
    rook.shield.visible = false;
    rook.trailMesh.visible = false;
    const cam = new THREE.PerspectiveCamera(22, 1, 1, 500);
    cam.position.set(2, 23.5, 34);
    cam.lookAt(1.5, 22.5, 0);

    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    const prevTone = this.renderer.toneMapping;
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = prevTone;
    rt.dispose();

    // Pixels come out upside down, and in linear light: an off-screen render
    // skips the sRGB conversion the screen gets, so apply it here or the
    // portrait comes out too dark.
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      lut[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    }
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      const dst = y * size * 4;
      for (let x = 0; x < size * 4; x += 4) {
        img.data[dst + x] = lut[px[src + x]];
        img.data[dst + x + 1] = lut[px[src + x + 1]];
        img.data[dst + x + 2] = lut[px[src + x + 2]];
        img.data[dst + x + 3] = px[src + x + 3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}
