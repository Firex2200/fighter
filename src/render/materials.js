// Shared material helpers for the 3D renderer.

import * as THREE from 'three';

/**
 * A lit material with a rim light: surfaces turned away from the camera glow
 * faintly, which outlines characters against the background the way Smash's
 * lighting does. `flash` brightens the whole surface (hits, dodges).
 */
export function rimMaterial(color, { rim = 0x9ab8ff, rimStrength = 0.55, roughness = 0.62, metalness = 0, emissive = 0x000000, emissiveIntensity = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
  mat.userData.base = new THREE.Color(color);
  const uniforms = {
    uRim: { value: new THREE.Color(rim).multiplyScalar(rimStrength) },
    uFlash: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uFlash;')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
outgoingLight += uRim * rimF + vec3(uFlash);
#include <opaque_fragment>`
      );
  };
  return mat;
}

/** Bright unlit-looking material that blooms: blade edges, eyes, runes. */
export function glowMaterial(color, intensity = 2.4) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 1,
  });
}

/** Soft round sprite texture made in code, used by particles and glows. */
export function softDotTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
