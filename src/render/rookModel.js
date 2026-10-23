// Rook's sculpted, skinned model (models/rook.glb, built in Blender from the
// concept turnaround), posed from the same rigPose() data as the shape-built
// figure in rook3d.js. Rook3D uses this when the file loads, and falls back to
// its own shapes when it doesn't.
//
// The model is 1 unit tall in glTF axes: y up, his front +z, his right hand -x.
// Bones: hips > spine > neck > head; upper_arm/forearm/hand and
// thigh/shin/foot, _R (his right, the sword arm) and _L.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { rimMaterial } from './materials.js';
import { COSTUMES, SHOULDER } from '../rook.js';

// Loads in the background so the game starts at once; Rook3D switches over
// when it arrives (after the first visit it comes from the offline cache).
let gltf = null;
export const modelReady = new GLTFLoader()
  .loadAsync(new URL('../../models/rook.glb', import.meta.url).href)
  .then((g) => {
    gltf = g;
    return true;
  })
  .catch((err) => {
    console.warn('Rook model did not load; using the built-in figure.', err);
    return false;
  });

export const hasModel = () => !!gltf;

const Y = new THREE.Vector3(0, 1, 0);
const DEFAULT = COSTUMES.default;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Costume recolouring. The painted texture is the Indigo costume; other
 * costumes swap the kimono, its sleeve pattern, the sash and the hakama by
 * picking those parts out by colour and height on the body, keeping the
 * painted shading as brightness.
 */
function costumeShader(mat, uniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRest;\nuniform vec3 uKimono, uPattern, uObi, uHakama;\nuniform vec4 uRefLum;'
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float hi = max(c.r, max(c.g, c.b));
  float sat = (hi - min(c.r, min(c.g, c.b))) / max(hi, 1e-3);
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float h = vRest.y;
  float robe = step(0.38, h) * step(h, 0.78);
  float kimono = robe * smoothstep(0.02, 0.07, c.b - c.r);
  float pattern = robe * step(0.13, abs(vRest.x)) * smoothstep(0.3, 0.45, L) * (1.0 - smoothstep(0.08, 0.18, sat));
  float obi = step(0.42, h) * step(h, 0.62) * step(abs(vRest.x), 0.15) * smoothstep(0.25, 0.4, c.r - c.b) * step(0.6, sat);
  float hakama = step(0.08, h) * step(h, 0.5) * (1.0 - smoothstep(0.1, 0.16, L)) * (1.0 - smoothstep(0.25, 0.4, sat));
  c = mix(c, uKimono * min(L / uRefLum.x, 1.3), kimono);
  c = mix(c, uPattern * min(L / uRefLum.y, 1.3), pattern);
  c = mix(c, uObi * min(L / uRefLum.z, 1.3), obi);
  c = mix(c, uHakama * min(L / uRefLum.w, 1.3), hakama);
  diffuseColor.rgb = c;
}`
      );
  };
}

export class RookModel {
  /** @param opts { outlines, shadows } as for Rook3D */
  constructor(pal, opts) {
    // Model space -> character space (percent of height, x forward, z to camera):
    // turn his front to +x, which also puts his sword arm on the camera side.
    this.root = new THREE.Group();
    this.root.rotation.y = Math.PI / 2;
    this.root.scale.setScalar(100);
    const model = clone(gltf.scene);
    this.root.add(model);

    const src = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    this.uniforms = {
      uKimono: { value: new THREE.Color() },
      uPattern: { value: new THREE.Color() },
      uObi: { value: new THREE.Color() },
      uHakama: { value: new THREE.Color() },
      uRefLum: {
        value: new THREE.Vector4(
          ...['kimono', 'pattern', 'obi', 'hakama'].map((k) => lum(new THREE.Color(DEFAULT[k])))
        ),
      },
    };
    this.material = rimMaterial(0xffffff, { roughness: 0.7, rimStrength: 0.45 });
    this.material.map = src.material.map;
    costumeShader(this.material, this.uniforms);
    this.setPalette(pal);

    this.bones = {};
    model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        this.mesh = o;
        o.material = this.material;
        o.castShadow = opts.shadows;
        o.frustumCulled = false; // skinned: its rest-pose bounds don't follow the pose
      }
    });

    // Ink outline: a copy pushed out along its normals, back faces only, on the
    // same skeleton.
    if (opts.outlines) {
      const ink = new THREE.MeshBasicMaterial({ color: 0x07080d, side: THREE.BackSide });
      ink.onBeforeCompile = (s) => {
        s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.005;');
      };
      const hull = new THREE.SkinnedMesh(this.mesh.geometry, ink);
      hull.bind(this.mesh.skeleton, this.mesh.bindMatrix);
      hull.frustumCulled = false;
      this.mesh.parent.add(hull);
      hull.position.copy(this.mesh.position);
      hull.quaternion.copy(this.mesh.quaternion);
      hull.scale.copy(this.mesh.scale);
    }

    // Rest pose of every bone in model space, measured once.
    this.root.updateMatrixWorld(true);
    const toModel = this.root.matrixWorld.clone().invert();
    this.rest = {};
    const m = new THREE.Matrix4();
    for (const [name, b] of Object.entries(this.bones)) {
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      m.multiplyMatrices(toModel, b.matrixWorld).decompose(pos, q, new THREE.Vector3());
      this.rest[name] = { pos, q, dir: Y.clone().applyQuaternion(q) };
    }
    this.root.updateMatrix();
    this.toModel = this.root.matrix.clone().invert();
    this.toChar = this.root.matrix.clone();
    this.v = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.q = new THREE.Quaternion();
  }

  setPalette(pal) {
    const u = this.uniforms;
    u.uKimono.value.set(pal.kimono);
    u.uPattern.value.set(pal.pattern);
    u.uObi.value.set(pal.obi);
    u.uHakama.value.set(pal.hakama);
  }

  /**
   * Turn bone `name` so its length points along `dir` (model space), given
   * the model-space rotation of its parent. Returns its own model-space rotation.
   */
  aim(name, dir, parentQ) {
    const rest = this.rest[name];
    const q = new THREE.Quaternion().setFromUnitVectors(rest.dir, dir).multiply(rest.q);
    this.bones[name].quaternion.copy(parentQ).invert().multiply(q);
    return q;
  }

  /**
   * Two-bone reach: root of `upper` toward `target` (model space), bending the
   * middle joint toward `pole`. Returns the end point actually reached.
   */
  reach(upper, lower, end, target, pole) {
    const R = this.rest;
    const S = R[upper].pos;
    const a = S.distanceTo(R[lower].pos);
    const b = R[lower].pos.distanceTo(R[end].pos);
    const d = this.v[0].subVectors(target, S);
    const D = THREE.MathUtils.clamp(d.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    d.normalize();
    const x = (a * a - b * b + D * D) / (2 * D);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const side = this.v[1].copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const mid = this.v[2].copy(S).addScaledVector(d, x).addScaledVector(side, h);
    const tip = new THREE.Vector3().copy(S).addScaledVector(d, D);
    const parentQ = R[this.bones[upper].parent.name]?.q ?? new THREE.Quaternion();
    const q1 = this.aim(upper, this.v[3].subVectors(mid, S).normalize(), parentQ);
    const q2 = this.aim(lower, this.v[3].subVectors(tip, mid).normalize(), q1);
    // The last bone keeps its rest orientation (feet flat, hand in line).
    this.bones[end].quaternion.copy(q2).invert().multiply(R[end].q);
    return tip;
  }

  /** Character space (x forward, y up, percent) -> model space, and back. */
  m(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.toModel);
  }
  c(v) {
    return v.clone().applyMatrix4(this.toChar);
  }
  mDir(x, y, z) {
    return new THREE.Vector3(x, y, z).transformDirection(this.toModel);
  }

  /**
   * Pose from rigPose() output. Returns the sword hand in character space
   * [x, y, z], where the blade is held.
   */
  pose(r) {
    const R = this.rest;
    // Legs: the near leg (his right) is the "front" foot. Feet stay flat.
    for (const [s, footX, lift] of [['R', r.frontFoot, r.frontLift], ['L', r.backFoot, r.backLift]]) {
      const ankle = this.c(R[`foot_${s}`].pos);
      this.reach(`thigh_${s}`, `shin_${s}`, `foot_${s}`, this.m(footX * 0.9, ankle.y + lift * 1.3, ankle.z), this.mDir(1, 0, 0));
    }

    // Sword arm: from the shoulder toward rigPose's hand, scaled up to this
    // model's longer arm, elbow bent down, back and out.
    const sh = this.c(R.upper_arm_R.pos);
    const hx = (r.hand[0] - SHOULDER[0]) * 2;
    const hy = (r.hand[1] - SHOULDER[1]) * 2;
    const tip = this.reach(
      'upper_arm_R', 'forearm_R', 'hand_R',
      this.m(sh.x + hx, sh.y + hy, sh.z + 3),
      this.mDir(-0.5, -1, 0.7)
    );
    // Grip: a little past the wrist, along the forearm.
    const grip = this.c(tip.addScaledVector(this.v[3], 0.035));

    // Free arm hangs at his side, swinging opposite the sword hand as he runs.
    const shL = this.c(R.upper_arm_L.pos);
    this.reach(
      'upper_arm_L', 'forearm_L', 'hand_L',
      this.m(shL.x - (r.hand[0] - 10) * 0.9 + 2, shL.y - 25, shL.z - 3),
      this.mDir(-0.5, -1, -0.6)
    );

    return [grip.x, grip.y, grip.z];
  }
}
