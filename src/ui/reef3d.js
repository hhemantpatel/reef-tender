import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EMPTY, KELP, ANEMONE, CORAL, SHELL, SILT, ROCK } from '../game/world.js';

// The reef as a sunset toy diorama: a sandy island in a warm evening sea, the
// tiles sunk in a shallow tide pool, and the little drone flying over it.
// Same interface as the 2D ReefRenderer (draw / resize / refreshTheme), so the
// app does not care which one it got.

// --- layout (world units; one tile = 1) ------------------------------------
const TILE_TOP = 0.16;
const WATER_Y = 0.52;
const DRONE_Y = 1.6;
const OCEAN_Y = -0.28;

// --- palette (the old diorama's sunset, plus reef colours) -----------------
const C = {
  skyZenith: '#475e8a', skyMid: '#e67a5c', skyHorizon: '#ffb36b',
  sunGlow: '#ff8a29',
  sand: '#f2d7a0', sandWet: '#d9b47a', sandDeep: '#a47f52', berm: '#e7c891',
  silt: '#9b7f5c', rock: '#8e9098', poolFloor: '#c9a46b',
  oceanDeep: '#2b6f8f', oceanShallow: '#4fb3bf', foam: '#fff1e2',
  poolShallow: '#6fe0d0', poolDeep: '#2a9cb3',
  kelpLow: '#2f6532', kelpHigh: '#8cc456', kelpBulb: '#dce46a',
  anemone: '#ef6a3f', anemoneTip: '#ffc29a', anemoneOral: '#ffb48a',
  coral: ['#e9609b', '#f2795c', '#b56bd6'], coralTip: '#ffe0ec',
  shellLo: '#f6e7d6', shellHi: '#e88bb0',
  bleach: '#efebe1', stung: '#a49e8c',
  palmTrunkA: '#8a5a2c', palmTrunkB: '#b9783f', palmLeaf: '#4f9d3a', palmLeafB: '#6fb447',
  coconut: '#6b4a33', stone: '#99958b', stoneDark: '#76736c', plank: '#b9783f', plankDark: '#8a5a2c',
  starfish: '#f08d5c',
};
// The light comes from high enough to model the props; the sun you see sits
// low on the horizon so it shows above the island and lays a path on the sea.
const SUN_DIR = new THREE.Vector3(-45, 22, -35).normalize();
const SUN_VIEW = new THREE.Vector3(-45, 5, -35).normalize();
// Lens shift: the island sits in the lower part of the frame, sky above it.
const LENS_SHIFT = 1.3;

const LOW_END = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;

// One clock for every shader that moves.
const TIME = { value: 0 };

const GLSL_NOISE = /* glsl */ `
float envHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float envNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x),
             mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float envFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * envNoise(p); p = p * 2.03 + 17.17; a *= 0.5; }
  return v;
}
`;

// --- small helpers -----------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Bake (geometry, transform, colour) parts into one vertex-coloured geometry: one draw call. */
function merge(parts) {
  const prepared = parts.map(({ geo, color, position, rotation, scale, quaternion, parent }) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    _p.set(...(position ?? [0, 0, 0]));
    if (quaternion) _q.copy(quaternion);
    else _q.setFromEuler(_e.set(...(rotation ?? [0, 0, 0])));
    if (typeof scale === 'number') _s.setScalar(scale);
    else _s.set(...(scale ?? [1, 1, 1]));
    _m.compose(_p, _q, _s);
    if (parent) _m.premultiply(parent);
    g.applyMatrix4(_m);
    const col = new Float32Array(g.attributes.position.count * 3);
    _c.set(color);
    for (let i = 0; i < col.length; i += 3) { col[i] = _c.r; col[i + 1] = _c.g; col[i + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const out = mergeGeometries(prepared, false);
  prepared.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

/**
 * Flat-shaded, vertex-coloured standard material whose vertices sway with
 * height (kelp, tentacles, palm fronds). Each instance keeps its own colour,
 * but they all share one GPU program.
 */
function swayMaterial(amp, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', vertexColors: true, flatShading: true, roughness: 0.55, ...opts,
  });
  mat.userData.uAmp = { value: amp };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = TIME;
    shader.uniforms.uAmp = mat.userData.uAmp;
    shader.vertexShader = `uniform float uTime;\nuniform float uAmp;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float swH = max(position.y, 0.0);
      vec3 swO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float swP = swO.x * 0.9 + swO.z * 0.6;
      transformed.x += sin(uTime * 1.3 + swP) * uAmp * swH * swH;
      transformed.z += cos(uTime * 1.05 + swP * 1.3) * uAmp * 0.6 * swH * swH;`,
    );
  };
  mat.customProgramCacheKey = () => 'reef-sway';
  return mat;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- sky, sun, sea -------------------------------------------------------------

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(C.skyZenith) },
      uMid: { value: new THREE.Color(C.skyMid) },
      uHorizon: { value: new THREE.Color(C.skyHorizon) },
      uSunDir: { value: SUN_VIEW.clone() },
      uSunGlow: { value: new THREE.Color(C.sunGlow) },
      uTime: TIME,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;
      uniform vec3 uSunDir; uniform vec3 uSunGlow; uniform float uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, y));
        col = mix(col, uZenith, smoothstep(0.3, 1.0, y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunGlow * (pow(sd, 900.0) * 1.2 + pow(sd, 48.0) * 0.45 + pow(sd, 6.0) * 0.18);
        col += uSunGlow * 0.12 * pow(sd, 2.0) * (1.0 - smoothstep(0.0, 0.35, y));
        if (y > 0.015) {
          vec2 p = d.xz / (y + 0.12);
          p += vec2(uTime * 0.006, uTime * 0.0025);
          float sn = sin(0.6), cs = cos(0.6);
          p = mat2(cs, -sn, sn, cs) * p;
          float n = envFbm(vec2(p.x * 0.55, p.y * 2.6) * 1.4);
          float detail = envNoise(vec2(p.x * 2.0, p.y * 9.0));
          float wisp = smoothstep(0.52, 0.82, n + detail * 0.12);
          float fade = smoothstep(0.015, 0.22, y) * (1.0 - 0.5 * smoothstep(0.55, 1.0, y));
          col = mix(col, vec3(1.0), wisp * fade * 0.42);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  return sky;
}

function makeSun() {
  const g = new THREE.Group();
  const basic = (o) => new THREE.MeshBasicMaterial({ fog: false, depthWrite: false, transparent: true, ...o });
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(128, 128, 5, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.18, 'rgba(255,235,130,0.92)');
  grad.addColorStop(0.42, 'rgba(255,160,50,0.65)');
  grad.addColorStop(0.68, 'rgba(240,85,30,0.28)');
  grad.addColorStop(1, 'rgba(180,30,40,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  g.add(new THREE.Mesh(new THREE.PlaneGeometry(42, 42), basic({ map: tex, opacity: 0.92 })));
  const rays = new THREE.Group();
  const rayMat = basic({ color: '#ffa31a', opacity: 0.4, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) {
    const long = i % 2 === 0;
    const geo = new THREE.ConeGeometry(long ? 1.6 : 1.3, long ? 22 : 15, 4);
    geo.translate(0, long ? 11 : 7.5, 0);
    const m = new THREE.Mesh(geo, rayMat);
    m.rotation.z = (i / 12) * Math.PI * 2 + Math.PI;
    m.position.z = 0.1;
    rays.add(m);
  }
  g.add(rays);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(7.8, 32), basic({ color: '#ffb336', opacity: 0.6 }));
  halo.position.z = 0.2;
  g.add(halo);
  const orb = new THREE.Mesh(new THREE.CircleGeometry(6.2, 32), basic({ color: '#fffde2', transparent: false }));
  orb.position.z = 0.3;
  g.add(orb);
  g.position.copy(SUN_VIEW).multiplyScalar(150);
  g.renderOrder = -500;
  g.traverse((o) => { o.renderOrder = -500; });
  g.userData.rays = rays;
  return g;
}

const WATER_COMMON = /* glsl */ `
  ${GLSL_NOISE}
  float ripples(vec2 q, float t) {
    return envNoise(q * 1.3 + vec2(t * 0.35, t * 0.2)) + 0.5 * envNoise(q * 2.9 - vec2(t * 0.25, t * 0.5));
  }
  vec3 rippleNormal(vec2 q, float t, float k) {
    float h0 = ripples(q, t);
    float hx = ripples(q + vec2(0.08, 0.0), t);
    float hz = ripples(q + vec2(0.0, 0.08), t);
    return normalize(vec3((h0 - hx) * k, 1.0, (h0 - hz) * k));
  }
`;

function waterVertex() {
  return /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
}

function makeOcean() {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDeep: { value: new THREE.Color(C.oceanDeep) },
      uShallow: { value: new THREE.Color(C.oceanShallow) },
      uFoam: { value: new THREE.Color(C.foam) },
      uSky: { value: new THREE.Color(C.skyMid) },
      uSunDir: { value: SUN_VIEW.clone() },
      uShore: { value: 4 },
    }]),
    vertexShader: waterVertex(),
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSky;
      uniform vec3 uSunDir; uniform float uShore; uniform float uTime;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_fragment>
      ${WATER_COMMON}
      void main() {
        vec2 q = vWorldPos.xz;
        vec3 N = rippleNormal(q * 0.7, uTime, 2.4);
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Rounded-square distance from the island edge.
        vec2 a = abs(q) - vec2(uShore);
        float edge = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 9.0, edge));
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        col = mix(col, uSky, fres * 0.6);
        vec3 H = normalize(uSunDir + V);
        col += pow(max(dot(N, H), 0.0), 140.0) * 1.6 * vec3(1.0, 0.8, 0.55);
        float fn = envNoise(q * 1.7 + vec2(uTime * 0.4, -uTime * 0.3));
        float wave = 0.5 + 0.5 * sin(edge * 5.0 - uTime * 1.8 + fn * 2.0);
        float foam = (1.0 - smoothstep(0.0, 0.55, edge)) * smoothstep(0.35, 0.6, fn + 0.25);
        foam += (1.0 - smoothstep(0.6, 1.4, edge)) * smoothstep(0.82, 0.98, wave) * 0.6;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
  mat.uniforms.uTime = TIME;
  const geo = new THREE.PlaneGeometry(600, 600, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(geo, mat);
  ocean.position.y = OCEAN_Y;
  return ocean;
}

function makePoolWater() {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uShallow: { value: new THREE.Color(C.poolShallow) },
      uDeep: { value: new THREE.Color(C.poolDeep) },
      uSky: { value: new THREE.Color(C.skyHorizon) },
      uSunDir: { value: SUN_VIEW.clone() },
    }]),
    vertexShader: waterVertex(),
    fragmentShader: /* glsl */ `
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunDir; uniform float uTime;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_fragment>
      ${WATER_COMMON}
      void main() {
        vec2 q = vWorldPos.xz;
        vec3 N = rippleNormal(q * 1.6, uTime * 0.8, 1.6);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
        vec3 col = mix(uShallow, uDeep, 0.35 + 0.3 * envNoise(q * 0.6 + uTime * 0.05));
        col = mix(col, uSky, fres * 0.5);
        vec3 H = normalize(uSunDir + V);
        float glint = pow(max(dot(N, H), 0.0), 90.0);
        col += glint * vec3(1.0, 0.85, 0.6) * 1.4;
        float alpha = 0.34 + fres * 0.4 + glint * 0.3;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.uniforms.uTime = TIME;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WATER_Y;
  m.renderOrder = 10;
  return m;
}

/** Sand tiles get soft moving caustic light on their tops. */
function tileMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = TIME;
    shader.vertexShader = `varying vec3 vCWP;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 cwp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cwp = instanceMatrix * cwp;
      #endif
      vCWP = (modelMatrix * cwp).xyz;`,
    );
    shader.fragmentShader = `uniform float uTime;\nvarying vec3 vCWP;\n${GLSL_NOISE}\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec2 cp = vCWP.xz * 2.2;
        float c1 = envNoise(cp + vec2(uTime * 0.35, uTime * 0.21));
        float c2 = envNoise(cp * 1.37 + vec2(-uTime * 0.27, uTime * 0.31) + 7.0);
        float caust = pow(1.0 - smoothstep(0.0, 0.16, abs(c1 - c2)), 3.0);
        float top = smoothstep(${(TILE_TOP - 0.03).toFixed(3)}, ${TILE_TOP.toFixed(3)}, vCWP.y);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.8) * caust * top * 0.28;
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'reef-tile';
  return mat;
}

// --- entity geometry (local space: tile top at y = 0) ------------------------

function kelpGeometry(seed) {
  const r = rng(seed);
  const blades = [];
  const bulbs = [];
  const ribbons = 4;
  for (let i = 0; i < ribbons; i++) {
    const a = (i / ribbons) * Math.PI * 2 + r() * 0.8;
    const h = 0.8 + r() * 0.25;
    const parent = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12)),
      new THREE.Vector3(1, 1, 1),
    );
    const stem = new THREE.CylinderGeometry(0.012, 0.03, h, 5, 4);
    stem.translate(0, h / 2, 0);
    blades.push({ geo: stem, color: C.kelpLow, parent });
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const side = k % 2 ? 1 : -1;
      _c.set(C.kelpLow).lerp(new THREE.Color(C.kelpHigh), t);
      blades.push({
        geo: new THREE.SphereGeometry(1, 6, 4),
        color: `#${_c.getHexString()}`,
        position: [side * 0.045, h * t, 0],
        rotation: [0, a, side * 0.7],
        scale: [0.06, 0.12, 0.016],
        parent,
      });
    }
    bulbs.push({ geo: new THREE.SphereGeometry(0.038, 8, 6), color: C.kelpBulb, position: [0, h + 0.02, 0], parent });
  }
  return { body: merge(blades), extra: merge(bulbs) };
}

function anemoneGeometry() {
  const parts = [];
  const col = new THREE.CylinderGeometry(0.12, 0.155, 0.14, 12);
  col.translate(0, 0.07, 0);
  parts.push({ geo: col, color: C.anemone });
  parts.push({ geo: new THREE.CylinderGeometry(0.125, 0.125, 0.02, 12), color: C.anemoneOral, position: [0, 0.145, 0] });
  const rings = [{ n: 12, r: 0.1, tilt: 0.85, color: C.anemone, len: 0.17 }, { n: 8, r: 0.05, tilt: 0.35, color: C.anemoneTip, len: 0.14 }];
  const tips = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ring.r * 10;
      const t = new THREE.CapsuleGeometry(0.02, ring.len, 3, 6);
      t.translate(0, ring.len / 2 + 0.02, 0);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -ring.tilt)));
      const pos = [Math.cos(a) * ring.r, 0.14, Math.sin(a) * ring.r];
      parts.push({ geo: t, color: ring.color, position: pos, quaternion: q });
      const tip = new THREE.Vector3(0, ring.len + 0.04, 0).applyQuaternion(q).add(new THREE.Vector3(...pos));
      tips.push({ geo: new THREE.SphereGeometry(0.026, 6, 5), color: '#fff3c4', position: tip.toArray() });
    }
  }
  return { body: merge(parts), extra: merge(tips) };
}

function coralGeometry(seed) {
  const r = rng(seed);
  const color = C.coral[Math.floor(r() * C.coral.length)];
  const parts = [];
  const tips = [];
  const branch = (origin, dir, len, rad, depth) => {
    const geo = new THREE.CylinderGeometry(rad * 0.72, rad, len, 6);
    geo.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    parts.push({ geo, color, position: origin.toArray(), quaternion: q });
    const end = origin.clone().addScaledVector(dir, len);
    parts.push({ geo: new THREE.SphereGeometry(rad * 0.72, 6, 4), color, position: end.toArray() });
    if (depth <= 1) {
      tips.push({ geo: new THREE.SphereGeometry(rad * 1.25, 7, 5), color: C.coralTip, position: end.toArray() });
      return;
    }
    const kids = 2 + (r() < 0.45 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spin = (k / kids) * Math.PI * 2 + r() * 1.2;
      const tilt = 0.35 + r() * 0.35;
      const side = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin));
      const nd = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
      branch(end, nd, len * (0.68 + r() * 0.12), rad * 0.72, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.24, 0.08, 4);
  return { body: merge(parts), extra: merge(tips) };
}

const SHELL_GEO = (() => {
  const g = new THREE.SphereGeometry(1, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rib = 0.9 + 0.1 * Math.pow(Math.abs(Math.sin(a * 9)), 0.6);
    p.setXYZ(i, x * rib, p.getY(i), z * rib);
  }
  g.scale(0.22, 0.11, 0.22);
  g.computeVertexNormals();
  return g;
})();

// --- drone (the old garden drone, rebuilt without React) ------------------------

function makeDrone() {
  const ARM = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  const REACH = 0.36;
  const mat = {
    shell: new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.22, metalness: 0.08 }),
    accent: new THREE.MeshStandardMaterial({ color: '#f2a93b', roughness: 0.24, metalness: 0.35 }),
    frame: new THREE.MeshStandardMaterial({ color: '#7f8a99', roughness: 0.35, metalness: 0.6, flatShading: true }),
    rotor: new THREE.MeshStandardMaterial({ color: '#2b3442', roughness: 0.35, metalness: 0.4 }),
    visor: new THREE.MeshStandardMaterial({ color: '#172033', roughness: 0.08, metalness: 0.6 }),
    eye: new THREE.MeshBasicMaterial({ color: '#5eead4', toneMapped: false }),
    bulb: new THREE.MeshBasicMaterial({ color: '#ff6b6b', toneMapped: false }),
    beam: new THREE.MeshBasicMaterial({
      color: '#fcd34d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  };
  const root = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(yaw);

  const body = new THREE.SphereGeometry(0.2, 22, 14);
  body.scale(1, 0.78, 1);
  const bodyMesh = new THREE.Mesh(body, mat.shell);
  bodyMesh.castShadow = true;
  yaw.add(bodyMesh);
  const band = new THREE.TorusGeometry(0.2, 0.016, 8, 28);
  band.rotateX(Math.PI / 2);
  yaw.add(new THREE.Mesh(band, mat.accent));
  const visor = new THREE.SphereGeometry(0.205, 18, 6, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.42, 0.68);
  visor.scale(1, 0.78, 1);
  yaw.add(new THREE.Mesh(visor, mat.visor));
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.025, 0.198);
  const eyeGeo = new THREE.SphereGeometry(1, 10, 8);
  eyeGeo.scale(0.024, 0.036, 0.012);
  for (const x of [-0.055, 0.055]) {
    const e = new THREE.Mesh(eyeGeo, mat.eye);
    e.position.x = x;
    eyes.add(e);
  }
  yaw.add(eyes);

  const frameParts = ARM.flatMap((a) => [
    { geo: new THREE.BoxGeometry(0.24, 0.024, 0.036), color: '#ffffff', position: [Math.cos(a) * 0.25, 0.02, Math.sin(a) * 0.25], rotation: [0, -a, 0] },
    { geo: new THREE.CylinderGeometry(0.026, 0.032, 0.055, 10), color: '#ffffff', position: [Math.cos(a) * REACH, 0.035, Math.sin(a) * REACH] },
  ]);
  frameParts.push(
    { geo: new THREE.BoxGeometry(0.02, 0.09, 0.02), color: '#ffffff', position: [-0.1, -0.17, 0], rotation: [0, 0, 0.25] },
    { geo: new THREE.BoxGeometry(0.02, 0.09, 0.02), color: '#ffffff', position: [0.1, -0.17, 0], rotation: [0, 0, -0.25] },
    { geo: new THREE.CylinderGeometry(0.03, 0.045, 0.06, 10), color: '#ffffff', position: [0, -0.16, 0] },
  );
  const frame = new THREE.Mesh(merge(frameParts), mat.frame);
  frame.castShadow = true;
  yaw.add(frame);
  const guards = merge(ARM.map((a) => {
    const g = new THREE.TorusGeometry(0.115, 0.011, 6, 24);
    g.rotateX(Math.PI / 2);
    return { geo: g, color: '#ffffff', position: [Math.cos(a) * REACH, 0.065, Math.sin(a) * REACH] };
  }));
  yaw.add(new THREE.Mesh(guards, mat.accent));
  const rotorGeo = merge([
    { geo: new THREE.BoxGeometry(0.2, 0.006, 0.03), color: '#ffffff' },
    { geo: new THREE.BoxGeometry(0.03, 0.006, 0.2), color: '#ffffff' },
    { geo: new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), color: '#ffffff' },
  ]);
  const rotors = ARM.map((a) => {
    const m = new THREE.Mesh(rotorGeo, mat.rotor);
    m.position.set(Math.cos(a) * REACH, 0.07, Math.sin(a) * REACH);
    yaw.add(m);
    return m;
  });
  const antenna = new THREE.Group();
  antenna.position.set(0.04, 0.14, -0.04);
  antenna.rotation.set(-0.25, 0, 0.15);
  const ant = new THREE.CylinderGeometry(0.006, 0.008, 0.11, 6);
  ant.translate(0, 0.055, 0);
  antenna.add(new THREE.Mesh(ant, mat.frame));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mat.bulb);
  bulb.position.y = 0.12;
  antenna.add(bulb);
  yaw.add(antenna);

  const beam = new THREE.Group();
  beam.position.y = -0.12;
  beam.visible = false;
  const beamGeo = new THREE.CylinderGeometry(0.07, 0.34, 1, 18, 1, true);
  beamGeo.translate(0, -0.5, 0);
  beam.add(new THREE.Mesh(beamGeo, mat.beam));
  root.add(beam);

  const light = new THREE.PointLight('#5eead4', 0.7, 2.2, 2);
  light.position.y = -0.25;
  root.add(light);

  root.scale.setScalar(1.25);
  return { root, yaw, rotors, eyes, bulb, beam, light, mat };
}

// --- the renderer ------------------------------------------------------------------

const EYE_IDLE = new THREE.Color('#5eead4');
const EYE_HARVEST = new THREE.Color('#fcd34d');
const EYE_PLANT = new THREE.Color('#86efac');
const ANT_IDLE = new THREE.Color('#ff6b6b');
const ANT_RUN = new THREE.Color('#4ade80');
const KIND_BURST = {
  KELP: new THREE.Color('#9fd65a'), ANEMONE: new THREE.Color('#ff9a6b'),
  CORAL: new THREE.Color('#ff8fc0'), SHELL: new THREE.Color('#fff1d6'),
};

export class Reef3DRenderer {
  constructor(canvas, session) {
    this.canvas = canvas;
    this.session = session;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.time = 0;
    this.builtSize = -1;
    this.bedSize = -1; // kept for API parity with the 2D renderer
    this.views = [];
    this.labelCache = new Map();

    const r = new THREE.WebGLRenderer({ canvas, antialias: !LOW_END, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW_END ? 1.25 : 1.75));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(C.skyHorizon, 40, 160);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 450);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false,
      minPolarAngle: 0.35, maxPolarAngle: 1.18, rotateSpeed: 0.6, zoomSpeed: 0.8,
    });

    this.sky = makeSky();
    scene.add(this.sky);
    this.sun = makeSun();
    scene.add(this.sun);
    this.ocean = makeOcean();
    scene.add(this.ocean);

    const sunLight = new THREE.DirectionalLight('#ffad5c', 2.35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(LOW_END ? 512 : 1024, LOW_END ? 512 : 1024);
    sunLight.shadow.bias = -0.0002;
    sunLight.shadow.normalBias = 0.03;
    scene.add(sunLight, sunLight.target);
    this.sunLight = sunLight;
    scene.add(new THREE.AmbientLight('#fff1e0', 0.62));
    scene.add(new THREE.HemisphereLight('#f9a8d4', '#92400e', 0.68));
    const fill = new THREE.DirectionalLight('#ffd9b0', 0.45);
    fill.position.set(18, 14, 26);
    scene.add(fill);

    this.world = new THREE.Group();
    scene.add(this.world);
    this.tileMat = tileMaterial();
    this.pool = makePoolWater();
    scene.add(this.pool);

    this.drone = makeDrone();
    scene.add(this.drone.root);
    this.droneSim = { init: false, px: 0, pz: 0, tiltX: 0, tiltZ: 0, beam: 0, beamColor: EYE_HARVEST, act: 0, nextBlink: 2, blinkT: -1 };

    this.dot = dotTexture();
    this.makeParticles();
    this.makeTrail();
  }

  // --- API used by the app -----------------------------------------------------

  refreshTheme() {} // the diorama keeps its sunset in both UI themes

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.renderer.setSize(rect.width, rect.height, false);
    const fullH = rect.height * LENS_SHIFT;
    this.camera.aspect = rect.width / fullH;
    this.camera.setViewOffset(rect.width, fullH, 0, 0, rect.width, rect.height);
    this.camera.updateProjectionMatrix();
    this.w = rect.width;
  }

  draw(dt) {
    if (!this.w) this.resize();
    if (!this.w) return;
    const n = this.session.world.size;
    if (n !== this.builtSize || this.session.world.tiles.length !== this.views.length) this.build(n);
    if (!this.reduceMotion) this.time += dt;
    TIME.value = this.time;

    this.updateTiles(dt);
    this.updateDrone(dt);
    this.updateParticles(dt);
    this.updateTrail();

    this.sky.position.copy(this.camera.position);
    this.sun.quaternion.copy(this.camera.quaternion);
    this.sun.userData.rays.rotation.z = this.time * 0.038;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // --- build -----------------------------------------------------------------------

  disposeGroup(group) {
    group.traverse((o) => {
      if (o.geometry && o.geometry !== SHELL_GEO) o.geometry.dispose();
      if (o.material && o.material !== this.tileMat) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (!m.map || !this.isLabelMap(m.map)) m.dispose(); });
      }
    });
    group.clear();
  }

  isLabelMap(map) {
    for (const t of this.labelCache.values()) if (t === map) return true;
    return false;
  }

  build(n) {
    this.disposeGroup(this.world);
    this.views = [];
    this.builtSize = n;
    const half = n / 2;
    this.half = half;

    this.buildIsland(n);

    // Tiles: one instanced mesh, coloured by ground.
    const tiles = this.session.world.tiles;
    const slab = new RoundedBoxGeometry(0.94, TILE_TOP, 0.94, 2, 0.035);
    slab.translate(0, TILE_TOP / 2, 0);
    this.tileMesh = new THREE.InstancedMesh(slab, this.tileMat, tiles.length);
    this.tileMesh.receiveShadow = true;
    this.tileBase = [];
    tiles.forEach((t, i) => {
      const [x, z] = this.tilePos(t);
      _m.makeTranslation(x, 0, z);
      this.tileMesh.setMatrixAt(i, _m);
      const r = rng(t.x * 7919 + t.y * 104729)();
      const base = new THREE.Color(t.ground === SILT ? C.silt : t.ground === ROCK ? C.rock : C.sand)
        .offsetHSL(0, 0, (r - 0.5) * 0.05);
      this.tileBase.push(base);
      this.tileMesh.setColorAt(i, base);
      this.views.push({ kind: null, ground: t.ground, group: null });
    });
    this.world.add(this.tileMesh);

    this.pool.scale.set(n + 0.05, 1, n + 0.05);
    this.ocean.material.uniforms.uShore.value = half + 1.9;

    const reach = half + 4;
    const sl = this.sunLight;
    sl.position.copy(SUN_DIR).multiplyScalar(30);
    Object.assign(sl.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 70 });
    sl.shadow.camera.updateProjectionMatrix();

    // Frame the reef: keep the current viewing angle, refit the distance.
    const dist = (half + 2.4) * 3.25;
    const dir = this.camera.position.lengthSq() > 0
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(0.62, 0.36, 0.78).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.minDistance = dist * 0.45;
    this.controls.maxDistance = dist * 1.5;
    this.controls.update();

    this.resetParticles();
    this.droneSim.init = false;
  }

  tilePos(t) {
    const h = (this.builtSize - 1) / 2;
    return [t.x - h, h - t.y];
  }

  buildIsland(n) {
    const half = n / 2;
    const hs = half + 1.9;
    const rad = 1.5;
    const shape = new THREE.Shape();
    shape.moveTo(-hs + rad, -hs);
    shape.lineTo(hs - rad, -hs);
    shape.quadraticCurveTo(hs, -hs, hs, -hs + rad);
    shape.lineTo(hs, hs - rad);
    shape.quadraticCurveTo(hs, hs, hs - rad, hs);
    shape.lineTo(-hs + rad, hs);
    shape.quadraticCurveTo(-hs, hs, -hs, hs - rad);
    shape.lineTo(-hs, -hs + rad);
    shape.quadraticCurveTo(-hs, -hs, -hs + rad, -hs);
    const depth = 1.3;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.3, bevelSegments: 4, curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.04 - depth - 0.16, 0);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(C.sand); const wet = new THREE.Color(C.sandWet); const deep = new THREE.Color(C.sandDeep);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const c = nor.getY(i) > 0.75 ? top : y > OCEAN_Y - 0.05 ? wet : deep;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const island = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.95 }));
    island.receiveShadow = true;
    island.castShadow = true;
    this.world.add(island);

    // Pool floor and the sand berm that holds the water in.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(n, 0.04, n),
      new THREE.MeshStandardMaterial({ color: C.poolFloor, roughness: 1 }),
    );
    floor.position.y = 0.06;
    floor.receiveShadow = true;
    this.world.add(floor);

    const bermMat = new THREE.MeshStandardMaterial({ color: C.berm, roughness: 0.9 });
    const bh = WATER_Y + 0.1;
    const t = 0.38;
    for (const [w, d, x, z] of [
      [n + t * 2, t, 0, -(half + t / 2)], [n + t * 2, t, 0, half + t / 2],
      [t, n, -(half + t / 2), 0], [t, n, half + t / 2, 0],
    ]) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(w, bh, d, 3, 0.14), bermMat);
      b.position.set(x, bh / 2, z);
      b.castShadow = true;
      b.receiveShadow = true;
      this.world.add(b);
    }

    this.buildDecor(n);
  }

  buildDecor(n) {
    const half = n / 2;
    const r = rng(n * 31 + 7);
    const ring = half + 1.25;
    const parts = [];

    // Pebbles along the berm and on the beach.
    for (let i = 0; i < 10 + n * 2; i++) {
      const side = Math.floor(r() * 4);
      const along = (r() - 0.5) * (n + 1.6);
      const out = half + 0.35 + r() * 1.6;
      const [x, z] = side === 0 ? [along, -out] : side === 1 ? [along, out] : side === 2 ? [-out, along] : [out, along];
      const s = 0.07 + r() * 0.12;
      parts.push({
        geo: new THREE.DodecahedronGeometry(1, 0), color: r() < 0.5 ? C.stone : C.stoneDark,
        position: [x, 0.04 + s * 0.4, z], rotation: [r() * 3, r() * 3, r() * 3], scale: [s * 1.3, s * 0.7, s],
      });
    }
    // Starfish on the sand.
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2;
      const pos = [Math.cos(a) * ring, 0.06, Math.sin(a) * ring];
      for (let k = 0; k < 5; k++) {
        const arm = new THREE.ConeGeometry(0.05, 0.2, 4);
        arm.rotateZ(-Math.PI / 2);
        arm.translate(0.1, 0, 0);
        parts.push({ geo: arm, color: C.starfish, position: pos, rotation: [0, (k / 5) * Math.PI * 2 + a, 0], scale: [1, 0.5, 1] });
      }
    }
    const props = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }));
    props.castShadow = true;
    props.receiveShadow = true;
    this.world.add(props);

    // Palms in the two back corners and one front-left, so the reef stays in view.
    const palmSpots = [[-ring, -ring, 0.4], [ring, -ring, -0.5], [-ring, ring * 0.92, 0.9]];
    for (const [x, z, lean] of palmSpots) this.world.add(this.makePalm(x, z, lean, r));

    // A little dock off the east beach.
    const dock = [];
    const x0 = half + 1.4;
    for (let i = 0; i < 6; i++) {
      dock.push({
        geo: new THREE.BoxGeometry(0.42, 0.06, 1.1), color: i % 2 ? C.plank : C.plankDark,
        position: [x0 + i * 0.46, 0.2, half * 0.4],
      });
    }
    for (const dz of [-0.48, 0.48]) {
      for (const dx of [1, 3, 5]) {
        dock.push({ geo: new THREE.CylinderGeometry(0.06, 0.07, 1.0, 7), color: C.plankDark, position: [x0 + dx * 0.46, -0.25, half * 0.4 + dz] });
      }
    }
    dock.push({ geo: new THREE.CylinderGeometry(0.035, 0.04, 0.9, 6), color: C.plankDark, position: [x0 + 5 * 0.46, 0.65, half * 0.4 + 0.48] });
    const dockMesh = new THREE.Mesh(merge(dock), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 }));
    dockMesh.castShadow = true;
    dockMesh.receiveShadow = true;
    this.world.add(dockMesh);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false }));
    lamp.position.set(x0 + 5 * 0.46, 1.14, half * 0.4 + 0.48);
    this.world.add(lamp);
    const lampLight = new THREE.PointLight('#ffb35c', 1.2, 4, 2);
    lampLight.position.copy(lamp.position);
    this.world.add(lampLight);
  }

  makePalm(x, z, lean, r) {
    const parts = [];
    const segs = 7;
    let p = new THREE.Vector3(0, 0, 0);
    const bend = new THREE.Vector3(Math.sign(-x) * 0.6, 0, Math.sign(-z) * 0.6).normalize();
    let top = p;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const dir = new THREE.Vector3(0, 1, 0).addScaledVector(bend, lean * t * 0.9).normalize();
      const len = 0.34;
      const g = new THREE.CylinderGeometry(0.075 - t * 0.03, 0.09 - t * 0.03, len, 7);
      g.translate(0, len / 2, 0);
      parts.push({ geo: g, color: i % 2 ? C.palmTrunkA : C.palmTrunkB, position: p.toArray(), quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir) });
      p = p.clone().addScaledVector(dir, len * 0.96);
      top = p;
    }
    const leaf = (() => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.22, 0.45, 0, 1.15);
      s.quadraticCurveTo(-0.22, 0.45, 0, 0);
      const g = new THREE.ShapeGeometry(s, 6);
      g.rotateX(Math.PI / 2);
      const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const d = pp.getZ(i);
        pp.setY(i, pp.getY(i) + Math.abs(pp.getX(i)) * 0.5 - d * d * 0.35);
      }
      g.computeVertexNormals();
      return g;
    })();
    const fronds = 8;
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + r();
      parts.push({
        geo: leaf, color: k % 2 ? C.palmLeaf : C.palmLeafB, position: top.toArray(),
        rotation: [0.15 - r() * 0.2, a, 0], scale: 1.05,
      });
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      parts.push({ geo: new THREE.SphereGeometry(0.07, 8, 6), color: C.coconut, position: [top.x + Math.cos(a) * 0.08, top.y - 0.08, top.z + Math.sin(a) * 0.08] });
    }
    const mat = swayMaterial(0.012, { side: THREE.DoubleSide, roughness: 0.6 });
    const palm = new THREE.Mesh(merge(parts), mat);
    palm.position.set(x, 0.04, z);
    palm.castShadow = true;
    return palm;
  }

  // --- entities --------------------------------------------------------------------

  makeView(tile, i) {
    const seed = tile.x * 7919 + tile.y * 104729 + 17;
    let geos;
    let amp = 0;
    if (tile.entity === KELP) { geos = kelpGeometry(seed); amp = 0.09; }
    else if (tile.entity === ANEMONE) { geos = anemoneGeometry(); amp = 0.6; }
    else if (tile.entity === CORAL) { geos = coralGeometry(seed); amp = 0.015; }
    const group = new THREE.Group();
    const [x, z] = this.tilePos(tile);
    group.position.set(x, TILE_TOP, z);
    group.rotation.y = rng(seed)() * Math.PI * 2;
    const view = { kind: tile.entity, group, born: this.time, mats: [] };

    if (geos) {
      const mat = swayMaterial(amp);
      const body = new THREE.Mesh(geos.body, mat);
      body.castShadow = true;
      group.add(body);
      const extraMat = swayMaterial(amp, { emissive: '#000000' });
      const extra = new THREE.Mesh(geos.extra, extraMat);
      extra.visible = false;
      group.add(extra);
      view.mats = [mat, extraMat];
      view.extra = extra;
    } else if (tile.entity === SHELL) {
      const mat = new THREE.MeshStandardMaterial({ color: C.shellLo, roughness: 0.3, metalness: 0.15, flatShading: true });
      const shell = new THREE.Mesh(SHELL_GEO, mat);
      shell.castShadow = true;
      group.add(shell);
      view.shell = shell;
      view.mats = [mat];
      view.shellMat = mat;
      view.label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      view.label.renderOrder = 20;
      view.label.position.y = WATER_Y - TILE_TOP + 0.3;
      view.label.scale.set(0.42, 0.42, 1);
      group.add(view.label);
      view.value = null;
    }
    this.world.add(group);
    this.views[i] = view;
    return view;
  }

  labelTexture(value) {
    let t = this.labelCache.get(value);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(30, 22, 40, 0.72)';
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff7ea';
    g.font = '700 28px "JetBrains Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(value), 32, 34);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.labelCache.set(value, t);
    return t;
  }

  removeView(i) {
    const v = this.views[i];
    if (v?.group) {
      this.world.remove(v.group);
      v.group.traverse((o) => {
        if (o.geometry && o.geometry !== SHELL_GEO) o.geometry.dispose();
      });
      v.mats.forEach((m) => m.dispose());
      if (v.label) v.label.material.dispose();
    }
    this.views[i] = { kind: EMPTY, group: null, mats: [] };
  }

  updateTiles() {
    const world = this.session.world;
    const tiles = world.tiles;
    const bleachCol = new THREE.Color(C.bleach);
    let tilesDirty = false;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let v = this.views[i];

      // Entity appeared, changed or was taken: rebuild and fire the effects.
      if (v.kind !== t.entity) {
        const was = v.kind;
        if (was && was !== EMPTY) {
          this.removeView(i);
          if (this.droneSim.init) this.burst(t, KIND_BURST[was.name] || KIND_BURST.KELP, 14);
          this.droneAction(t, EYE_HARVEST);
        }
        if (t.entity !== EMPTY) {
          v = this.makeView(t, i);
          if (was !== null) this.droneAction(t, EYE_PLANT);
        } else {
          this.views[i] = v = { kind: EMPTY, group: null, mats: [] };
        }
      }

      // Bleach tints the sand slab.
      const b = Math.min(1, t.bleach || 0);
      if (v.lastBleach !== b) {
        v.lastBleach = b;
        _c.copy(this.tileBase[i]).lerp(bleachCol, b * 0.8);
        this.tileMesh.setColorAt(i, _c);
        tilesDirty = true;
      }
      if (!v.group) continue;

      const g = t.entity === SHELL ? 1 : Math.min(1, t.growth / world.maturityOf(t));
      const mature = g >= 1;
      const age = this.time - v.born;
      const pop = this.reduceMotion || age > 0.45 ? 1 : easeOutBack(Math.min(1, age / 0.45));

      if (t.entity === SHELL) {
        const frac = Math.min(1, t.value / tiles.length);
        v.shell.scale.setScalar((0.75 + 0.6 * frac) * pop);
        if (v.value !== t.value) {
          v.value = t.value;
          v.label.material.map = this.labelTexture(t.value);
          v.label.material.needsUpdate = true;
          v.shellMat.color.set(C.shellLo).lerp(_c.set(C.shellHi), frac);
        }
        continue;
      }

      let sy = 0.22 + 0.78 * g;
      let sxz = 0.55 + 0.45 * g;
      if (t.entity === KELP) sy *= 1.15;
      const stung = t.entity === ANEMONE && t.stung;
      if (stung) { sy *= 0.6; sxz *= 0.85; }
      v.group.scale.set(sxz * pop, sy * pop, sxz * pop);

      v.extra.visible = mature && !stung;
      const tint = stung ? 0.75 : b * 0.85;
      const target = stung ? C.stung : C.bleach;
      for (const m of v.mats) m.color.set('#ffffff').lerp(_c.set(target), tint);
      if (mature && v.mats[1].emissive) {
        const glow = t.entity === ANEMONE ? 0.35 + 0.25 * Math.sin(this.time * 2.4 + i) : 0.12;
        v.mats[1].emissive.set(t.entity === KELP ? '#7a8a10' : '#ff9ec7').multiplyScalar(glow);
      }
    }
    if (tilesDirty) this.tileMesh.instanceColor.needsUpdate = true;
  }

  // --- drone -------------------------------------------------------------------------

  droneAction(tile, color) {
    const d = this.session.world.drones[0];
    if (!d || d.x !== tile.x || d.y !== tile.y) return;
    this.droneSim.act = 0.5;
    this.droneSim.beamColor = color;
  }

  updateDrone(dt) {
    const d = this.session.world.drones[0];
    if (!d) return;
    const { root, yaw, rotors, eyes, bulb, beam, light, mat } = this.drone;
    const s = this.droneSim;
    const [tx, tz] = this.tilePos(d);
    const time = this.time;
    if (!s.init) {
      root.position.set(tx, DRONE_Y, tz);
      s.px = tx; s.pz = tz; s.init = true;
    }
    s.act = Math.max(0, s.act - dt);
    const busy = s.act > 0;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const far = Math.hypot(tx - root.position.x, tz - root.position.z) > 1.6;
    if (far || this.reduceMotion) { root.position.x = tx; root.position.z = tz; }
    else {
      root.position.x += (tx - root.position.x) * k(7);
      root.position.z += (tz - root.position.z) * k(7);
    }
    const bob = this.reduceMotion ? 0 : Math.sin(time * 2.2) * 0.04 + Math.sin(time * 3.7) * 0.014;
    const dip = busy ? -0.28 : 0;
    root.position.y += (DRONE_Y + dip + bob - root.position.y) * k(8);

    const vx = dt > 0 ? (root.position.x - s.px) / dt : 0;
    const vz = dt > 0 ? (root.position.z - s.pz) / dt : 0;
    s.px = root.position.x; s.pz = root.position.z;
    if (Math.abs(vx) + Math.abs(vz) > 0.2) {
      const want = Math.atan2(vx, vz);
      let delta = want - yaw.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      yaw.rotation.y += delta * k(8);
    }
    s.tiltX += (THREE.MathUtils.clamp(vz * 0.12, -0.35, 0.35) - s.tiltX) * k(8);
    s.tiltZ += (THREE.MathUtils.clamp(-vx * 0.12, -0.35, 0.35) - s.tiltZ) * k(8);
    root.rotation.x = s.tiltX + Math.sin(time * 1.9) * 0.025;
    root.rotation.z = s.tiltZ + Math.cos(time * 2.3) * 0.025;

    const moving = Math.abs(vx) + Math.abs(vz) > 0.2;
    const spin = (moving ? 48 : 30) * dt;
    rotors.forEach((m, i) => { m.rotation.y += i % 2 ? -spin : spin; });

    mat.eye.color.lerp(busy ? s.beamColor : EYE_IDLE, k(8));
    if (s.blinkT < 0 && time > s.nextBlink) s.blinkT = 0;
    let sy = 1;
    if (s.blinkT >= 0) {
      s.blinkT += dt;
      const b = s.blinkT / 0.16;
      sy = b < 1 ? Math.abs(1 - 2 * b) * 0.9 + 0.1 : 1;
      if (b >= 1) { s.blinkT = -1; s.nextBlink = time + 2.2 + Math.random() * 3; }
    }
    eyes.scale.y = sy * (busy && s.beamColor === EYE_HARVEST ? 0.55 : 1);

    const running = this.session.running;
    const pulse = running ? (Math.sin(time * 10) > 0 ? 1 : 0.25) : 0.55 + 0.45 * Math.sin(time * 2.5);
    mat.bulb.color.copy(running ? ANT_RUN : ANT_IDLE).multiplyScalar(0.4 + 0.9 * pulse);

    s.beam += ((busy ? 1 : 0) - s.beam) * k(10);
    mat.beam.color.copy(s.beamColor);
    mat.beam.opacity = 0.32 * s.beam;
    beam.visible = s.beam > 0.02;
    beam.scale.set(1, Math.max(0.05, (root.position.y - TILE_TOP - 0.2) / root.scale.y), 1);
    light.intensity += ((busy ? 2.4 : 0.8) - light.intensity) * k(5);
    light.color.copy(mat.eye.color);
  }

  // --- particles: bubbles, sparkles, harvest bursts ---------------------------------------

  makeParticles() {
    const mk = (count, size, opts) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      const mat = new THREE.PointsMaterial({
        size, map: this.dot, transparent: true, depthWrite: false, vertexColors: true, sizeAttenuation: true, ...opts,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      return pts;
    };
    this.bubbles = mk(70, 0.07, { opacity: 0.55 });
    this.sparkles = mk(LOW_END ? 0 : 40, 0.16, { opacity: 0.7, blending: THREE.AdditiveBlending, color: '#fed7aa' });
    this.bursts = mk(160, 0.11, { opacity: 0.95 });
    this.burstState = Array.from({ length: 160 }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
    this.burstNext = 0;
    this.bubbleState = [];
    this.sparkState = [];
  }

  resetParticles() {
    const half = this.half;
    const rnd = Math.random;
    const bp = this.bubbles.geometry.attributes.position;
    this.bubbleState = Array.from({ length: bp.count }, () => ({
      x: (rnd() - 0.5) * this.builtSize, z: (rnd() - 0.5) * this.builtSize,
      y: TILE_TOP + rnd() * (WATER_Y - TILE_TOP), v: 0.06 + rnd() * 0.12, p: rnd() * 6,
    }));
    const sp = this.sparkles.geometry.attributes.position;
    this.sparkState = Array.from({ length: sp.count }, () => ({
      x: (rnd() - 0.5) * (half * 2 + 6), z: (rnd() - 0.5) * (half * 2 + 6), y: 0.8 + rnd() * 4, p: rnd() * 6,
    }));
    const pp = this.bursts.geometry.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setXYZ(i, 0, -50, 0);
    this.burstState.forEach((b) => { b.life = 0; });
  }

  burst(tile, color, count) {
    const [x, z] = this.tilePos(tile);
    const pos = this.bursts.geometry.attributes.position;
    const col = this.bursts.geometry.attributes.color;
    for (let k = 0; k < count; k++) {
      const i = this.burstNext;
      this.burstNext = (this.burstNext + 1) % this.burstState.length;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.2;
      Object.assign(this.burstState[i], { life: 0.9, vx: Math.cos(a) * sp, vy: 1.8 + Math.random() * 1.6, vz: Math.sin(a) * sp });
      pos.setXYZ(i, x, TILE_TOP + 0.3, z);
      col.setXYZ(i, color.r, color.g, color.b);
    }
    col.needsUpdate = true;
  }

  updateParticles(dt) {
    const motion = this.reduceMotion ? 0 : dt;
    const bp = this.bubbles.geometry.attributes.position;
    this.bubbleState.forEach((b, i) => {
      b.y += b.v * motion;
      if (b.y > WATER_Y) { b.y = TILE_TOP; b.x = (Math.random() - 0.5) * this.builtSize; b.z = (Math.random() - 0.5) * this.builtSize; }
      bp.setXYZ(i, b.x + Math.sin(this.time * 2 + b.p) * 0.03, b.y, b.z);
    });
    bp.needsUpdate = true;

    const sp = this.sparkles.geometry.attributes.position;
    this.sparkState.forEach((s, i) => {
      sp.setXYZ(i, s.x + Math.sin(this.time * 0.3 + s.p) * 0.4, s.y + Math.sin(this.time * 0.5 + s.p) * 0.3, s.z);
    });
    sp.needsUpdate = true;

    const pp = this.bursts.geometry.attributes.position;
    let any = false;
    this.burstState.forEach((b, i) => {
      if (b.life <= 0) return;
      any = true;
      b.life -= dt;
      b.vy -= 6 * dt;
      pp.setXYZ(i, pp.getX(i) + b.vx * dt, pp.getY(i) + b.vy * dt, pp.getZ(i) + b.vz * dt);
      if (b.life <= 0) pp.setXYZ(i, 0, -50, 0);
    });
    if (any) pp.needsUpdate = true;
  }

  // --- trail: where the drone has been, as glowing rings on the water --------------------

  makeTrail() {
    const geo = new THREE.RingGeometry(0.12, 0.2, 20);
    geo.rotateX(-Math.PI / 2);
    this.trail = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: '#9ff5ea', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.position.y = WATER_Y + 0.01;
      m.renderOrder = 11;
      this.scene.add(m);
      return m;
    });
  }

  updateTrail() {
    const d = this.session.world.drones[0];
    const trail = d?.trail || [];
    this.trail.forEach((m, i) => {
      const t = trail[trail.length - this.trail.length + i];
      if (!t) { m.visible = false; return; }
      const [x, z] = this.tilePos(t);
      m.visible = true;
      m.position.x = x;
      m.position.z = z;
      m.material.opacity = ((i + 1) / this.trail.length) * 0.45;
    });
  }
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
