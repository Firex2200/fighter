// The world around the stage: stormy dusk sky, mountains, clouds, rain and
// distant lightning. Fills the whole view at every zoom, so the edges of the
// screen are never empty black.

import * as THREE from 'three';

export const HORIZON = 0x353d52; // also the fog colour, so distance fades into it

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A puffy cloud made of overlapping soft blobs, drawn on a canvas. */
function cloudTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const x = 40 + r() * 176;
    const y = 50 + r() * 40 - (Math.abs(x - 128) / 128) * 20;
    const rad = 22 + r() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A mountain range silhouette as a flat shape far away. */
function ridge(seed, width, base, peak, jag) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -400);
  let x = -width / 2;
  while (x < width / 2) {
    const y = base + r() * peak + (r() < 0.3 ? r() * peak * 0.8 : 0);
    shape.lineTo(x, y);
    x += jag * (0.5 + r());
  }
  shape.lineTo(width / 2, -400);
  return new THREE.ShapeGeometry(shape);
}

export class Sky {
  /**
   * @param scene THREE.Scene
   * @param opts  { rain: number of raindrops }
   */
  constructor(scene, { rain = 800 } = {}) {
    this.scene = scene;
    this.time = 0;
    this.flash = 0; // 0..1, decays after a lightning strike
    this.nextStrike = 4 + Math.random() * 6;
    this.onStrike = null; // set by the world, for thunder

    // ---------------------------------------------------------- sky dome
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uFlash: { value: 0 } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float uFlash; varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 top = vec3(0.04, 0.05, 0.14);
            vec3 mid = vec3(0.14, 0.17, 0.30);
            vec3 hor = vec3(0.21, 0.24, 0.32);
            vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
            col = mix(col, top, smoothstep(0.18, 0.7, h));
            col = mix(col, vec3(0.05, 0.05, 0.08), smoothstep(0.0, -0.25, h));
            // Last light of dusk, low on one side behind the mountains.
            vec3 sunDir = normalize(vec3(-0.55, 0.04, -0.83));
            float glow = pow(max(dot(vDir, sunDir), 0.0), 8.0);
            col += vec3(0.85, 0.42, 0.25) * glow * 0.55;
            col += vec3(0.25, 0.9, 0.85) * uFlash * 0.35 * smoothstep(-0.1, 0.5, h);
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    scene.add(this.dome);

    // --------------------------------------------------------- mountains
    // Fog fades each range further into the horizon colour, so depth reads.
    this.ranges = [
      [ridge(3, 6000, -40, 260, 90), 0x151824, -700],
      [ridge(8, 7000, -10, 330, 140), 0x1d2131, -1300],
      [ridge(13, 9000, 30, 420, 200), 0x272c3e, -2100],
    ].map(([geo, color, z]) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
      mesh.position.set(0, -60, z);
      scene.add(mesh);
      return mesh;
    });

    // ------------------------------------------------------------ clouds
    const r = rng(21);
    this.clouds = [];
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTexture(100 + i),
        color: new THREE.Color().setHSL(0.63, 0.14, 0.3 + r() * 0.16),
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      });
      const s = new THREE.Sprite(mat);
      const z = -250 - r() * 1400;
      const scale = 220 + r() * 380;
      s.scale.set(scale * 2, scale, 1);
      s.position.set(-1800 + r() * 3600, 60 + r() * 380, z);
      s.userData.speed = 2 + r() * 5;
      scene.add(s);
      this.clouds.push(s);
    }

    // -------------------------------------------------------------- rain
    // One draw call: many short streaks in a box around the camera's target.
    this.rainCount = rain;
    const pos = new Float32Array(rain * 6);
    this.rainSeeds = [];
    for (let i = 0; i < rain; i++) {
      this.rainSeeds.push([r() * 800 - 400, r() * 600 - 200, r() * 300 - 200, 0.8 + r() * 0.6]);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({ color: 0x9fb0d0, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.rain.frustumCulled = false;
    if (rain > 0) scene.add(this.rain);

    // ---------------------------------------------------------- lightning
    this.bolt = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xbffcff, transparent: true, opacity: 0 })
    );
    scene.add(this.bolt);
  }

  strike() {
    this.flash = 1;
    this.nextStrike = 5 + Math.random() * 9;
    // A jagged bolt far behind the stage.
    const pts = [];
    let x = -1200 + Math.random() * 2400;
    for (let y = 900; y > -50; y -= 60 + Math.random() * 60) {
      pts.push(new THREE.Vector3(x, y, -1600));
      x += Math.random() * 120 - 60;
    }
    this.bolt.geometry.setFromPoints(pts);
    this.onStrike?.();
  }

  /**
   * @param dt      seconds since last frame
   * @param target  {x, y} the camera is looking at, to keep rain around it
   */
  update(dt, target) {
    this.time += dt;
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) this.strike();
    // A double flicker, like real lightning, then a fade.
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const flicker = this.flash > 0.6 ? (Math.sin(this.time * 60) > 0 ? 1 : 0.4) : 1;
    const f = this.flash * flicker;
    this.dome.material.uniforms.uFlash.value = f;
    this.bolt.material.opacity = this.flash > 0.5 ? f : 0;

    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 2000) c.position.x = -2000;
    }

    // Rain falls on a slant and wraps around the camera's view.
    if (this.rainCount) {
      const pos = this.rain.geometry.attributes.position;
      const fall = (this.time * 260) % 600;
      for (let i = 0; i < this.rainCount; i++) {
        const [sx, sy, sz, len] = this.rainSeeds[i];
        let y = sy - fall * len;
        y = ((((y + 200) % 600) + 600) % 600) - 200;
        const x = target.x + sx + y * 0.12;
        const yy = target.y + y;
        pos.setXYZ(i * 2, x, yy, sz);
        pos.setXYZ(i * 2 + 1, x - 1.5, yy - 9 * len, sz);
      }
      pos.needsUpdate = true;
    }
    return f;
  }
}
