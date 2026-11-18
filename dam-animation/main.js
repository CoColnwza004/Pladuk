// Pladuk Chon Khuean — cinematic "model comes to life" dam animation.
// Deterministic: window.renderFrame(t) renders the frame at time t (seconds).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const P = new URLSearchParams(location.search);
const W = +P.get('w') || 1920, H = +P.get('h') || 1080;
const QUALITY = P.get('q') || 'high';

// ---------------------------------------------------------------- utils
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261118);
const rr = (a, b) => a + (b - a) * rand();
function hash2(ix, iz) { let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z); const fx = x - ix, fz = z - iz; const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz); const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1); return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; }
function fbm(x, z, o = 5) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1); n += a; f *= 2.02; a *= 0.5; } return s / n; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function distSeg(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); }
function distPoly(px, pz, pts) { let d = 1e9; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; }
function rectMask(x, z, x0, x1, z0, z1, f) { return sstep(x0 - f, x0, x) * (1 - sstep(x1, x1 + f, x)) * sstep(z0 - f, z0, z) * (1 - sstep(z1, z1 + f, z)); }

// ---------------------------------------------------------------- GLSL noise
const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  float a = mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z); }
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=ROT*p+vec2(17.1,9.2); a*=.5; } return s/0.875; }
float fbm5(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=ROT*p+vec2(17.1,9.2); a*=.5; } return s/0.96875; }
`;

// ---------------------------------------------------------------- world layout
const RES_LEVEL = 57.0, RIVER_LEVEL = 1.5, CREST = 66.0;
const riverX = z => 26 * Math.sin((z - 80) / 230);
const SIDE_CHAN = [[38, 300], [110, 338], [190, 388], [280, 436], [380, 466], [500, 482], [650, 494], [900, 524], [1300, 570], [1800, 640]];
const GLORY = { x: 85, z: -170 };
const FLAT_ZONES = [ // x0,x1,z0,z1,y  (building / farm pads)
  [85, 245, 120, 290, 5.2], [215, 300, 520, 600, 5.2], [300, 370, 560, 640, 5.2], [380, 520, 600, 690, 5.2],
  [-175, -60, 55, 140, 5.2], [105, 265, 630, 795, 5.2], [290, 650, 680, 915, 5.15],
];
const PAD = [-470, -112, 150, 830];

function keyInterp(z, keys) {
  const val = (k) => (typeof k[1] === 'function' ? k[1](z) : k[1]);
  if (z <= keys[0][0]) return val(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    if (z <= keys[i + 1][0]) return lerp(val(keys[i]), val(keys[i + 1]), sstep(keys[i][0], keys[i + 1][0], z));
  }
  return val(keys[keys.length - 1]);
}
const lakeW = z => 560 + 170 * (vnoise(z / 380, 3.1) - 0.5) * 2;
const dsW = z => Math.min(760, 250 + Math.max(0, z - 60) * 0.6);
const W_KEYS = [[-1900, 60], [-1450, 470], [-1000, lakeW], [-600, lakeW], [-470, 152], [-70, 152], [-28, 128], [42, 128], [110, dsW], [1500, dsW], [2500, 420], [3400, 300]];
const F_KEYS = [[-600, 20], [-470, 26], [-70, 26], [-28, 3], [42, 4.6], [110, 5], [3400, 5]];
const S_KEYS = [[-600, 300], [-470, 95], [-70, 95], [-28, 32], [42, 32], [110, 280], [1500, 280], [3400, 380]];

function hills(x, z) {
  let h = 82 + 95 * (fbm(x / 560 + 11, z / 560 - 7, 5) - 0.5) * 2;
  h += 34 * Math.abs(vnoise(x / 190 + 4, z / 190) - 0.5) * 2;
  const r = Math.hypot(x * 0.85, (z - 150) * 0.62);
  h += Math.max(0, r - 1050) * 0.2;
  return Math.max(h, 72);
}
function terrainBase(x, z) {
  const Wv = keyInterp(z, W_KEYS), F = keyInterp(z, F_KEYS), S = keyInterp(z, S_KEYS);
  const d = Math.abs(x) + (fbm(x / 95, z / 95, 3) - 0.5) * (z < 42 && z > -28 ? 8 : 46);
  const t = sstep(Wv, Wv + S, d);
  return lerp(F + (fbm(x / 70, z / 70, 3) - 0.5) * 2.4, hills(x, z), t);
}
// road along the crest that climbs onto both hills
const roadZ = x => -1 - 0.0009 * Math.max(0, Math.abs(x) - 140) ** 2;
const ROAD_TAB = (() => {
  const xs = [], ys = [];
  for (let x = -1100; x <= 1100; x += 5) { xs.push(x); ys.push(terrainBase(x, roadZ(x))); }
  let y = ys.map((v, i) => { const ax = Math.abs(xs[i]); return lerp(CREST + 0.05, Math.max(v, 60), sstep(140, 245, ax)); });
  for (let pass = 0; pass < 6; pass++) {
    y = y.map((v, i) => { let s = 0, n = 0; for (let k = -8; k <= 8; k++) { const j = clamp(i + k, 0, y.length - 1); s += y[j]; n++; } const ax = Math.abs(xs[i]); return lerp(CREST + 0.05, s / n, sstep(135, 205, ax)); });
  }
  return { xs, ys: y };
})();
function roadY(x) { const f = clamp((x + 1100) / 5, 0, ROAD_TAB.ys.length - 1.001); const i = Math.floor(f); return lerp(ROAD_TAB.ys[i], ROAD_TAB.ys[i + 1], f - i); }

function terrainY(x, z) {
  let y = terrainBase(x, z);
  if (z > 22) {
    const rx = riverX(z), hw = lerp(72, 46, sstep(70, 230, z));
    const k = sstep(hw, hw + 16, Math.abs(x - rx));
    y = lerp(y, Math.min(y, lerp(-3.5, y, k)), sstep(22, 40, z));
    const ds = distPoly(x, z, SIDE_CHAN);
    y = Math.min(y, lerp(-2.5, y, sstep(16, 28, ds)));
    y = lerp(y, 5.3, rectMask(x, z, PAD[0], PAD[1], PAD[2], PAD[3], 30));
    for (const f of FLAT_ZONES) y = lerp(y, f[4], rectMask(x, z, f[0], f[1], f[2], f[3], 12));
  }
  // road cut / fill
  if (Math.abs(x) > 130 && Math.abs(x) < 1100) {
    const dz = Math.abs(z - roadZ(x));
    const m = 1 - sstep(8, 30, dz);
    y = lerp(y, roadY(x) - 0.3, m);
  }
  return y;
}
function terrainSlope(x, z) { const e = 2; return Math.hypot(terrainY(x + e, z) - terrainY(x - e, z), terrainY(x, z + e) - terrainY(x, z - e)) / (2 * e); }

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.40;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // sun is static: bake the shadow map once
let shadowBaked = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 1.5, 40000);
const animators = [];

// sun / sky
const sunDir = new THREE.Vector3(0.80, 0.36, 0.30).normalize();
const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 5.5; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.86;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000); s2.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = su[k].value;
  envScene.add(s2);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
  scene.environmentIntensity = 0.55;
}
const FOG_COLOR = new THREE.Color(0.62, 0.70, 0.80);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00026);

const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.68), 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SC = sun.shadow.camera; SC.left = -950; SC.right = 950; SC.top = 950; SC.bottom = -950; SC.near = 50; SC.far = 4200;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
sun.target.position.set(40, 0, 60);
sun.position.copy(sun.target.position).addScaledVector(sunDir, 2000);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.68, 0.95), new THREE.Color(0.30, 0.26, 0.18), 0.55));

// clouds layer
{
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, camPos: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: NOISE + `
      varying vec3 vW; uniform float time; uniform vec3 camPos;
      void main(){
        vec2 p = vW.xz*0.00028 + vec2(time*0.0035, time*0.0012);
        float n = fbm5(p) + 0.45*(fbm5(p*3.3+5.2)-0.5);
        float cov = smoothstep(0.50, 0.78, n);
        float dist = length(vW.xz - camPos.xz);
        float fade = 1.0 - smoothstep(5000., 16000., dist);
        vec3 col = mix(vec3(0.62,0.66,0.74), vec3(1.0,0.90,0.78), smoothstep(0.55,0.95,n));
        gl_FragColor = vec4(col*1.9, cov*fade*0.9);
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), mat);
  clouds.rotation.x = Math.PI / 2; clouds.position.y = 2200; clouds.renderOrder = -1;
  scene.add(clouds);
  animators.push(t => { mat.uniforms.time.value = t; mat.uniforms.camPos.value.copy(camera.position); clouds.position.x = camera.position.x; clouds.position.z = camera.position.z; });
}

// ---------------------------------------------------------------- material helpers
function injectWorld(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp = vec4(transformed, 1.0); vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
        #endif
        wp = modelMatrix * wp; vWPos = wp.xyz; vWNrm = normalize(mat3(modelMatrix) * wn); }`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nfloat gFoam = 0.0;\n' + NOISE);
}
const BUMP = (expr, k) => `{ float bh = ${expr};
  vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(bh), dhy = dFdy(bh);
  vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * ${k}); }`;
const PROC = {
  plain: `diffuseColor.rgb *= 0.9 + 0.2*vnoise3(vWPos*0.6);`,
  concrete: `{ float cn = vnoise3(vWPos*0.35)*0.6 + vnoise3(vWPos*1.7)*0.4;
      float big = vnoise3(vWPos*0.035);
      float pour = smoothstep(0.90,1.0,fract(vWPos.y/3.0))*0.16 + (1.0-smoothstep(0.0,0.035,abs(fract(vWPos.x/16.5)-0.5)*2.0-0.965+0.035))*0.0;
      float joint = smoothstep(0.975,1.0,abs(fract(vWPos.x/16.5)-0.5)*2.0)*0.22;
      float stain = smoothstep(0.45,0.85,vnoise(vec2(vWPos.x*0.25, vWPos.y*0.012)))*smoothstep(20.0,62.0,vWPos.y)*0.28;
      pour += joint + stain;
      float streak = vnoise(vec2((vWPos.x+vWPos.z)*0.4, vWPos.y*0.025));
      float wet = 1.0 - 0.45*smoothstep(5.0,0.0,vWPos.y-1.0);
      diffuseColor.rgb *= (0.80+0.30*cn)*(0.84+0.30*big)*(1.0-pour)*mix(0.74,1.05,streak)*wet; }`,
  pad: `{ float cn = vnoise(vWPos.xz*0.7)*0.5+vnoise(vWPos.xz*0.08)*0.5;
      vec2 g = abs(fract(vWPos.xz/12.0)-0.5); float joint = smoothstep(0.485,0.5,max(g.x,g.y));
      diffuseColor.rgb *= (0.78+0.35*cn)*(1.0-joint*0.35); }`,
  asphalt: `diffuseColor.rgb *= 0.85 + 0.3*vnoise(vWPos.xz*1.3);`,
};
function procMat(color, kind = 'plain', opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
  m.onBeforeCompile = sh => { injectWorld(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + PROC[kind]); };
  m.customProgramCacheKey = () => 'proc_' + kind + (opts.map ? '_m' : '');
  return m;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const M = {
  concrete: procMat(0xa29c91, 'concrete', { roughness: 0.88 }),
  darkConcrete: procMat(0x8d8a84, 'concrete', { roughness: 0.9 }),
  pad: procMat(0x9a9894, 'pad', { roughness: 0.92 }),
  asphalt: procMat(0x3a3a3c, 'asphalt', { roughness: 0.95 }),
  white: procMat(0xecebe6, 'plain', { roughness: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xa8adb2, metalness: 0.85, roughness: 0.38 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.7, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa82020, roughness: 0.55, metalness: 0.3 }),
  wood: procMat(0x8a6a48, 'plain', { roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2a35, metalness: 0.6, roughness: 0.08 }),
  roofRed: procMat(0x8e3f2c, 'plain', { roughness: 0.75 }),
  roofGrey: procMat(0x4c5258, 'plain', { roughness: 0.7 }),
  black: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }),
};

function addMesh(geo, mat, x = 0, y = 0, z = 0, ry = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}
const box = (w, h, d, mat, x, y, z, ry = 0, parent = scene) => addMesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, ry, parent);

// ---------------------------------------------------------------- terrain
function warpAxis(N, c, a, b) { const r = []; for (let i = 0; i <= N; i++) { const u = -1 + 2 * i / N; r.push(c + Math.sign(u) * (a * Math.abs(u) + b * Math.abs(u) ** 3)); } return r; }
{
  const N = +P.get('tn') || (QUALITY === 'high' ? 560 : 300);
  const xs = warpAxis(N, 0, 1150, 1500), zs = warpAxis(N, 300, 1150, 2250);
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  let k = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = xs[i], z = zs[j]; pos[k++] = x; pos[k++] = terrainY(x, z); pos[k++] = z; }
  const idx = new Uint32Array(N * N * 6); k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
  mat.onBeforeCompile = sh => {
    injectWorld(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float dist = length(vWPos - cameraPosition);
        float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
        float n1 = fbm5(vWPos.xz*0.012);
        float n2 = fbm3(vWPos.xz*0.09);
        float n3 = vnoise(vWPos.xz*0.7);
        float detail = 1.0 - smoothstep(250.0, 900.0, dist);
        vec3 grassA = vec3(0.050,0.115,0.022), grassB = vec3(0.115,0.165,0.040), dry = vec3(0.21,0.18,0.075);
        vec3 col = mix(grassA, grassB, smoothstep(0.35,0.68,n1));
        col = mix(col, dry, smoothstep(0.60,0.80,n2)*0.55);
        col *= mix(1.0, 0.78+0.44*n3, detail);
        float wl = vWPos.z > -6.0 ? ${RIVER_LEVEL.toFixed(1)} : ${RES_LEVEL.toFixed(1)};
        float forest = smoothstep(14.0, 34.0, vWPos.y - wl + (n1-0.5)*40.0) * smoothstep(0.40, 0.58, fbm3(vWPos.xz*0.006+3.0));
        vec3 canopy = mix(vec3(0.018,0.055,0.014), vec3(0.06,0.10,0.025), fbm3(vWPos.xz*0.05));
        canopy *= 0.75 + 0.5*vnoise(vWPos.xz*0.12);
        col = mix(col, canopy, forest*0.9);
        float nr = fbm3(vec2(vWPos.x*0.7 + vWPos.z*0.7, vWPos.y*2.2)*0.06);
        float strata = 0.85 + 0.15*sin(vWPos.y*0.9 + nr*6.0);
        vec3 rock = mix(vec3(0.11,0.10,0.085), vec3(0.26,0.24,0.20), nr) * strata;
        col = mix(col, rock, smoothstep(0.42,0.68, slope + (n2-0.5)*0.25));
        float bank = 1.0 - smoothstep(0.3, 3.2, vWPos.y - wl);
        col = mix(col, vec3(0.13,0.10,0.06), bank);
        col *= mix(1.0, 0.45, 1.0 - smoothstep(-6.0, -0.2, vWPos.y - wl));
        diffuseColor.rgb = col;
      }`).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' +
        BUMP('(fbm3(vWPos.xz*0.35)*0.8 + vnoise(vWPos.xz*2.3)*0.12) * (1.0 - smoothstep(150.0, 600.0, length(vWPos - cameraPosition)))', '1.0'));
  };
  mat.customProgramCacheKey = () => 'terrain';
  const terrain = new THREE.Mesh(g, mat);
  terrain.receiveShadow = true; terrain.castShadow = QUALITY === 'high';
  scene.add(terrain);
}

// ---------------------------------------------------------------- water
function makeWaterNormals(size = 512) {
  const h = new Float32Array(size * size);
  const r = mulberry32(77);
  const waves = [];
  for (let i = 0; i < 60; i++) { const fx = Math.round(r() * 30 - 15), fz = Math.round(r() * 30 - 15); if (!fx && !fz) continue; const f = Math.hypot(fx, fz); waves.push([fx, fz, 1 / Math.pow(f, 1.3), r() * 6.283]); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let s = 0; for (const w of waves) s += w[2] * Math.sin(6.2832 * (w[0] * x + w[1] * y) / size + w[3]); h[y * size + x] = s; }
  const data = new Uint8Array(size * size * 4);
  const st = 14;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + (x + 1) % size] - h[y * size + (x - 1 + size) % size];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -hx * st, ny = -hy * st, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * size + x) * 4; data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = (nz * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const waterNormals = makeWaterNormals();
let inMirror = false;
function makeWater(geo, opts) {
  const mw = QUALITY === 'high' ? 1024 : 512;
  const w = new Water(geo, {
    textureWidth: mw, textureHeight: Math.round(mw * 0.5625), waterNormals,
    sunDirection: sunDir.clone(), sunColor: opts.sunColor || 0xffe2bb, waterColor: opts.color, distortionScale: opts.distortion, fog: true, alpha: 1.0,
  });
  w.material.uniforms.size.value = opts.size;
  w.material.uniforms.flowVel = { value: new THREE.Vector2(opts.flow[0], opts.flow[1]) };
  w.material.fragmentShader = w.material.fragmentShader.replace('vec4 getNoise( vec2 uv ) {', 'uniform vec2 flowVel;\nvec4 getNoise( vec2 uv ) {\n uv -= flowVel * size * time;');
  w.rotation.x = -Math.PI / 2;
  w.receiveShadow = true;
  const orig = w.onBeforeRender;
  w.onBeforeRender = function (...a) { if (inMirror) return; inMirror = true; orig.apply(this, a); inMirror = false; };
  scene.add(w);
  animators.push(t => { w.material.uniforms.time.value = t; });
  return w;
}
{ // reservoir, with a hole for the morning-glory spillway
  const sh = new THREE.Shape([new THREE.Vector2(-3000, 6), new THREE.Vector2(3000, 6), new THREE.Vector2(3000, 3200), new THREE.Vector2(-3000, 3200)]);
  const hole = new THREE.Path(); hole.absarc(GLORY.x, -GLORY.z, 16.2, 0, Math.PI * 2, true); sh.holes.push(hole);
  const res = makeWater(new THREE.ShapeGeometry(sh, 48), { color: 0x072a2c, distortion: 1.1, size: 9, flow: [0.0, -0.05] });
  res.position.y = RES_LEVEL;
}
{ // downstream river
  const g = new THREE.PlaneGeometry(6000, 3600); g.translate(0, -(52 + 1800), 0);
  const riv = makeWater(g, { color: 0x24321c, distortion: 1.6, size: 12, flow: [0.0, 1.6], sunColor: 0xb89a74 });
  riv.position.y = RIVER_LEVEL;
}

// ---------------------------------------------------------------- dam
function extrudeX(pts, x0, x1, segs = 1) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 12, steps: segs });
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.translate(x1, 0, 0);
  return g;
}
const NONOVER = [[-8, -8], [-8, CREST], [6, CREST], [6, 60], [56, -8]];
addMesh(extrudeX(NONOVER, -142, -66), M.concrete);
addMesh(extrudeX(NONOVER, 66, 142), M.concrete);
// spillway ogee + chute + basin
const OGEE_TOP = [[-12, 44], [-8, 50.5], [-4.5, 53.2], [-1, 54], [2, 53.8], [5, 52.8], [9, 50.6], [14, 46.6], [46, 6], [50, 2.5], [54, 0.6], [58, 0], [102, 0], [105, 2.4], [112, 2.4]];
addMesh(extrudeX([[-12, -8], ...OGEE_TOP, [112, -8]], -66, 66), M.concrete);
// training walls
const WALL = [[-14, -8], [-14, CREST], [10, CREST], [16, 55], [46, 14], [58, 8], [112, 8], [112, -8]];
addMesh(extrudeX(WALL, 62, 67), M.concrete); addMesh(extrudeX(WALL, -67, -62), M.concrete);
// piers + deck
for (const px of [-33, 0, 33]) {
  addMesh(extrudeX([[-14, 30], [-14, 63], [12, 63], [12, 52], [6, 50]], px - 2, px + 2), M.concrete);
  addMesh(new THREE.CylinderGeometry(2, 2, 33, 16), M.concrete, px, 46.5, -14);
}
box(140, 3, 14, M.concrete, 0, 63, -1);
// crest parapets + lamp posts
for (const side of [-7.4, 5.4]) {
  box(284, 1.1, 0.35, M.concrete, 0, CREST, side);
}
{
  const parts = [];
  const post = new THREE.CylinderGeometry(0.12, 0.16, 8, 6); post.translate(0, 4, 0); parts.push(post);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2); arm.translate(0, 8, 1.0); parts.push(arm);
  const head = new THREE.BoxGeometry(0.5, 0.25, 0.9); head.translate(0, 7.9, 2.0); parts.push(head);
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  const lamps = [];
  for (let x = -137; x <= 125; x += 25) { lamps.push([x, -7.4, 0]); lamps.push([x + 12.5, 5.4, Math.PI]); }
  const im = new THREE.InstancedMesh(g, M.darkMetal, lamps.length);
  const o = new THREE.Object3D();
  lamps.forEach((l, i) => { o.position.set(l[0], CREST + 0.5, l[1]); o.rotation.y = l[2]; o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.castShadow = true; scene.add(im);
}
// dam name painted on the downstream face (left block)
{
  const tex = canvasTex(2048, 360, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(245,245,240,0.92)'; c.font = '600 250px Kanit'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ปลาดุกชลเขื่อน', w / 2, h / 2 + 10);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(62, 10.9), mat);
  // downstream face runs (z=6,y=60) -> (z=56,y=-8); its outward normal is (0, 50, 68)
  const yC = 40, zC = 6 + (60 - yC) * (50 / 68);
  const nrm = new THREE.Vector3(0, 50, 68).normalize();
  pl.position.set(-104, yC, zC).addScaledVector(nrm, 0.15);
  pl.lookAt(pl.position.clone().add(nrm));
  scene.add(pl);
}
// powerhouse + penstocks at the toe (left)
box(50, 16, 24, M.white, -100, 4.6, 76);
box(52, 1.6, 26, M.roofGrey, -100, 20.6, 76);
for (let i = 0; i < 5; i++) box(5.5, 7, 0.3, M.glass, -118 + i * 9, 8, 88.1);

// ---------------------------------------------------------------- flowing-water materials
function foamMaterial(kind) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: kind !== 'chute', depthWrite: kind === 'chute' });
  m.userData.time = { value: 0 };
  m.onBeforeCompile = sh => {
    sh.uniforms.time = m.userData.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 flow;\nvarying vec2 vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = flow;');
    injectWorld(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float time;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFlow;\nuniform float time;');
    let body;
    if (kind === 'chute') body = `
      float v = vFlow.y, u = vFlow.x;
      float sp = 3.0 + v*0.32;
      float n = fbm5(vec2(u*0.30, v*0.02 - time*sp*0.02));
      float n2 = fbm3(vec2(u*0.9 + 3.0, v*0.09 - time*sp*0.09));
      float n3 = vnoise(vec2(u*2.1, v*0.25 - time*sp*0.25));
      float aer = smoothstep(9.0, 34.0, v);
      float foam = smoothstep(0.38, 0.80, n*0.65 + n2*0.35 + (n3-0.5)*0.12);
      foam = clamp(foam*mix(0.35, 1.0, aer) + aer*0.28 + smoothstep(66.0,74.0,v)*0.4, 0.0, 1.0);
      gFoam = foam;
      vec3 deep = mix(vec3(0.010,0.035,0.032), vec3(0.05,0.11,0.10), n2*aer);
      diffuseColor.rgb = mix(deep, vec3(0.78,0.82,0.81), foam);`;
    else if (kind === 'basin') body = `
      float v = vFlow.y, u = vFlow.x;
      float n = fbm5(vec2(u*0.07, v*0.07 - time*0.32) + vec2(sin(time*0.3)*0.3, 0.0));
      float n2 = vnoise(vec2(u*0.5 + time*0.2, v*0.5 - time*1.2));
      float dec = 1.0 - smoothstep(4.0, 60.0, v);
      float foam = clamp(smoothstep(0.30, 0.70, n + n2*0.25)*0.9*mix(0.35,1.0,dec) + dec*0.55, 0.0, 1.0);
      gFoam = foam;
      diffuseColor.rgb = mix(vec3(0.03,0.06,0.04), vec3(0.82,0.85,0.83), foam);
      diffuseColor.a = smoothstep(0.0, 0.25, foam + dec*0.3) * (1.0 - smoothstep(48.0, 62.0, v)) * smoothstep(0.0, 3.0, 31.0 - abs(u - 31.0) + 30.0);`;
    else if (kind === 'streak') body = `
      float v = vFlow.y, u = vFlow.x;
      float n = fbm5(vec2(u*0.10, v*0.02 - time*0.06));
      float streak = smoothstep(0.55, 0.80, n) * (1.0 - smoothstep(60.0, 420.0, v)) * smoothstep(0.0, 18.0, 44.0 - abs(u));
      gFoam = streak;
      diffuseColor.rgb = vec3(0.70,0.72,0.70);
      diffuseColor.a = streak*0.55;`;
    else if (kind === 'glory') body = `
      float v = vFlow.y, u = vFlow.x;
      float n = fbm5(vec2(u*0.25 + v*0.06 + time*0.15, v*0.10 - time*0.9));
      float n2 = vnoise(vec2(u*0.9 + time*0.4, v*0.5 - time*3.0));
      float aer = smoothstep(4.0, 9.0, v);
      float foam = clamp(smoothstep(0.42, 0.8, n*0.8 + n2*0.35)*mix(0.15,1.0,aer) + aer*0.5, 0.0, 1.0);
      gFoam = foam;
      diffuseColor.rgb = mix(vec3(0.02,0.07,0.065), vec3(0.80,0.84,0.83), foam) * mix(1.0, 0.15, smoothstep(14.0, 26.0, v));
      diffuseColor.a = smoothstep(0.2, 2.6, v);`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n{' + body + '}')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.06, 0.55, gFoam);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP('vnoise(vec2(vFlow.x*0.6, vFlow.y*0.25 - time*2.5))*0.5 + gFoam*0.4', '1.0'));
  };
  m.customProgramCacheKey = () => 'foam_' + kind;
  animators.push(t => { m.userData.time.value = t; });
  return m;
}
// ribbon along a (z,y) profile between x0..x1, flow attr = (u meters across, v meters along)
function ribbonZY(profile, x0, x1, nu = 8) {
  const curve = new THREE.CatmullRomCurve3(profile.map(p => new THREE.Vector3(0, p[1], p[0])));
  const pts = curve.getSpacedPoints(110);
  const pos = [], flow = [], idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= nu; j++) { const x = lerp(x0, x1, j / nu); pos.push(x, pts[i].y, pts[i].z); flow.push(x - x0, acc); }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < nu; j++) { const a = i * (nu + 1) + j, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
{
  const chuteMat = foamMaterial('chute');
  const WP = [[-8, 56.9], [-5, 56.3], [-1, 55.5], [3, 54.7], [7, 53.0], [11, 50.6], [15, 47.4], [30, 27.3], [46, 7.0], [50, 3.6], [54, 2.1], [60, 2.3]];
  for (const [a, b] of [[-62, -35], [-31, -2], [2, 31], [35, 62]]) {
    const m = new THREE.Mesh(ribbonZY(WP, a, b), chuteMat); m.receiveShadow = true; scene.add(m);
  }
  // stilling basin
  const g = new THREE.PlaneGeometry(124, 62, 30, 20); g.rotateX(-Math.PI / 2); g.translate(0, 2.5, 54 + 31);
  const p = g.attributes.position, fl = [];
  for (let i = 0; i < p.count; i++) fl.push(p.getX(i) + 62, p.getZ(i) - 54);
  g.setAttribute('flow', new THREE.Float32BufferAttribute(fl, 2));
  const basin = new THREE.Mesh(g, foamMaterial('basin')); basin.renderOrder = 2; scene.add(basin);
  // foam streaks on the river
  const sp = [], sf = [], si = []; const NV = 120, NU = 6;
  for (let i = 0; i <= NV; i++) { const z = 90 + i * 4.5; const rx = riverX(z); for (let j = 0; j <= NU; j++) { const u = lerp(-46, 46, j / NU); sp.push(rx + u, RIVER_LEVEL + 0.08, z); sf.push(u, z - 90); } }
  for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) { const a = i * (NU + 1) + j, b = a + 1, c = a + NU + 1, d = c + 1; si.push(a, c, b, b, c, d); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('flow', new THREE.Float32BufferAttribute(sf, 2)); sg.setIndex(si); sg.computeVertexNormals();
  const streak = new THREE.Mesh(sg, foamMaterial('streak')); streak.renderOrder = 1; scene.add(streak);
}
// morning-glory (bell-mouth) spillway
{
  const ring = new THREE.LatheGeometry([[9.8, 20], [9.8, 55.4], [10.6, 56.2], [12.5, 56.6], [14.5, 56.4], [16, 55.6], [16.2, 40]].map(p => new THREE.Vector2(p[0], p[1])), 64);
  addMesh(ring, M.concrete, GLORY.x, 0, GLORY.z);
  const prof = [[18.5, 56.93], [16.5, 56.92], [14.8, 56.88], [13, 56.82], [11.3, 56.45], [10.1, 55.2], [9.55, 52.5], [9.35, 47], [9.3, 38], [9.3, 28]];
  const pts = prof.map(p => new THREE.Vector2(p[0], p[1]));
  const lg = new THREE.LatheGeometry(pts, 96);
  // flow attr: u = arc around (m), v = distance along profile
  const lens = [0]; for (let i = 1; i < prof.length; i++) lens.push(lens[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const pa = lg.attributes.position, fl = [];
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const r = Math.hypot(x, z);
    let best = 0, bd = 1e9; for (let k = 0; k < prof.length; k++) { const d = Math.abs(prof[k][1] - y) + Math.abs(prof[k][0] - r); if (d < bd) { bd = d; best = k; } }
    fl.push(Math.atan2(z, x) * 12, lens[best]);
  }
  lg.setAttribute('flow', new THREE.Float32BufferAttribute(fl, 2));
  const gm = new THREE.Mesh(lg, foamMaterial('glory')); gm.material.side = THREE.DoubleSide; gm.position.set(GLORY.x, 0, GLORY.z); gm.renderOrder = 3; scene.add(gm);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(9.4, 32), M.black); disk.rotation.x = -Math.PI / 2; disk.position.set(GLORY.x, 30, GLORY.z); scene.add(disk);
}

// ---------------------------------------------------------------- road + cars
const roadTex = canvasTex(256, 1024, (c, w, h) => {
  c.fillStyle = '#5a5a5c'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { const g = 70 + Math.random() * 40; c.fillStyle = `rgba(${g},${g},${g},0.35)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  c.fillStyle = '#e8e8e2'; c.fillRect(10, 0, 7, h); c.fillRect(w - 17, 0, 7, h);
  c.fillStyle = '#e0c060'; for (let y = 0; y < h; y += 256) c.fillRect(w / 2 - 4, y, 8, 140);
});
{
  const pos = [], uv = [], idx = []; let acc = 0, prev = null; let n = 0;
  for (let x = -1100; x <= 1100; x += 4) {
    const z = roadZ(x), y = roadY(x) + 0.12; const dz = roadZ(x + 1) - roadZ(x - 1); const tx = 2, tz = dz; const l = Math.hypot(tx, tz); const nx = -tz / l, nz = tx / l;
    const cur = new THREE.Vector3(x, y, z); if (prev) acc += cur.distanceTo(prev); prev = cur;
    pos.push(x - nx * 5, y, z - nz * 5, x + nx * 5, y, z + nz * 5); uv.push(0, acc / 40, 1, acc / 40);
    if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } n++;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((v, i) => idx[i - (i % 3) + (2 - (i % 3))])); g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.receiveShadow = true; scene.add(m);
}
function carGeo(color) {
  const body = new THREE.BoxGeometry(1.8, 0.8, 4.3); body.translate(0, 0.75, 0);
  const cab = new THREE.BoxGeometry(1.6, 0.65, 2.2); cab.translate(0, 1.45, -0.2);
  const g = new THREE.Group();
  addMesh(body, new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.3 }), 0, 0, 0, 0, g);
  addMesh(cab, M.glass, 0, 0, 0, 0, g);
  return g;
}
{
  const cars = [[0xd8d8d8, 0, 13, 2.2], [0x7a1414, 700, 15, 2.2], [0x1f3550, 300, -14, -2.2], [0x2a5a2a, 1300, -12, -2.2], [0x111111, 1700, 14, 2.2]];
  for (const [col, s0, v, lane] of cars) {
    const c = carGeo(col); scene.add(c);
    animators.push(t => {
      let x = ((s0 + v * t) % 2200 + 2200) % 2200 - 1100;
      const z = roadZ(x), y = roadY(x) + 0.12; const ang = Math.atan2(2, roadZ(x + 1) - roadZ(x - 1));
      c.position.set(x, y, z + lane * Math.cos(ang - Math.PI / 2) * -1);
      c.rotation.y = v > 0 ? ang : ang + Math.PI;
    });
  }
}

// ---------------------------------------------------------------- buildings (downstream)
// industrial pad
{
  const g = new THREE.PlaneGeometry(PAD[1] - PAD[0], PAD[3] - PAD[2]); g.rotateX(-Math.PI / 2);
  addMesh(g, M.pad, (PAD[0] + PAD[1]) / 2, 5.45, (PAD[2] + PAD[3]) / 2, 0, scene, false);
}
// factory
{
  const clad = canvasTex(512, 256, (c, w, h) => { c.fillStyle = '#9aa3aa'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { c.fillStyle = x % 16 ? '#8c959c' : '#a7b0b6'; c.fillRect(x, 0, 4, h); } c.fillStyle = '#2a3440'; c.fillRect(0, 40, w, 34); });
  clad.repeat.set(4, 1);
  const cm = new THREE.MeshStandardMaterial({ map: clad, roughness: 0.6, metalness: 0.4 });
  box(90, 24, 40, cm, -250, 5.4, 300); box(92, 1.5, 42, M.roofGrey, -250, 29.4, 300);
  box(40, 16, 28, cm, -315, 5.4, 330);
  for (let i = 0; i < 6; i++) box(10, 3, 8, M.darkMetal, -285 + i * 14, 30.9, 300);
  const stripe = canvasTex(64, 512, (c, w, h) => { for (let y = 0; y < h; y += 64) { c.fillStyle = (y / 64) % 2 ? '#e8e6e0' : '#b2342a'; c.fillRect(0, y, w, 64); } });
  addMesh(new THREE.CylinderGeometry(2.6, 4.2, 78, 24), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.7 }), -210, 5.4 + 39, 288);
  // tanks
  for (let i = 0; i < 3; i++) addMesh(new THREE.CylinderGeometry(7, 7, 14, 24), M.white, -180 + i * 17, 12.4, 360);
}
// heliport
{
  const tex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#b8bab8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#f2f2ee'; c.lineWidth = 14; c.strokeRect(20, 20, w - 40, h - 40);
    c.beginPath(); c.arc(w / 2, h / 2, 170, 0, 6.283); c.stroke();
    c.fillStyle = '#c42a22'; c.fillRect(176, 136, 44, 240); c.fillRect(292, 136, 44, 240); c.fillRect(176, 234, 160, 44);
  });
  const g = new THREE.BoxGeometry(34, 0.6, 34);
  const mats = [M.pad, M.pad, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), M.pad, M.pad, M.pad];
  const m = new THREE.Mesh(g, mats); m.position.set(-175, 5.75, 540); m.receiveShadow = true; scene.add(m);
}
// control tower (left of dam)
{
  addMesh(new THREE.CylinderGeometry(3.2, 4.2, 54, 24), M.white, -150, 5 + 27, 122);
  addMesh(new THREE.CylinderGeometry(7.5, 6, 3, 8), M.darkMetal, -150, 60.5, 122);
  addMesh(new THREE.CylinderGeometry(7.2, 7.2, 5, 8, 1, true), M.glass, -150, 64.5, 122);
  addMesh(new THREE.CylinderGeometry(8.2, 7.6, 1.6, 8), M.darkMetal, -150, 67.8, 122);
  addMesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), M.darkMetal, -150, 71.5, 122);
  const bm = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 0 });
  addMesh(new THREE.SphereGeometry(0.7, 12, 8), bm, -150, 74.8, 122);
  animators.push(t => { bm.emissiveIntensity = (Math.sin(t * Math.PI * 2 * 0.75) > 0.2) ? 60 : 0.5; });
}
// transmission towers + lines
const TOWERS = [[-395, 200], [-400, 380], [-405, 560], [-410, 740], [-300, 650]];
{
  const parts = [];
  const beam = (a, b, t = 0.35) => { const d = new THREE.Vector3().subVectors(b, a); const g = new THREE.BoxGeometry(t, d.length(), t); g.translate(0, d.length() / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); g.applyQuaternion(q); g.translate(a.x, a.y, a.z); parts.push(g.toNonIndexed()); };
  const Ht = 46; const lvl = [0, 8, 16, 24, 31, 37, 42, Ht];
  const half = y => lerp(5.5, 1.1, y / Ht);
  const corner = (y, sx, sz) => new THREE.Vector3(sx * half(y), y, sz * half(y));
  const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of C) beam(corner(0, sx, sz), corner(Ht, sx, sz), 0.55);
  for (let i = 0; i < lvl.length; i++) for (let k = 0; k < 4; k++) {
    const a = C[k], b = C[(k + 1) % 4]; beam(corner(lvl[i], a[0], a[1]), corner(lvl[i], b[0], b[1]), 0.3);
    if (i < lvl.length - 1) { beam(corner(lvl[i], a[0], a[1]), corner(lvl[i + 1], b[0], b[1]), 0.22); beam(corner(lvl[i], b[0], b[1]), corner(lvl[i + 1], a[0], a[1]), 0.22); }
  }
  for (const [y, L] of [[31, 9], [37, 7.5]]) for (const s of [-1, 1]) { beam(new THREE.Vector3(s * half(y), y, 0), new THREE.Vector3(s * L, y + 0.5, 0), 0.4); beam(new THREE.Vector3(s * half(y + 3), y + 3, 0), new THREE.Vector3(s * L, y + 0.5, 0), 0.25); }
  const tg = mergeGeometries(parts);
  const im = new THREE.InstancedMesh(tg, M.metal, TOWERS.length);
  const o = new THREE.Object3D();
  TOWERS.forEach((p, i) => { o.position.set(p[0], 5.4, p[1]); o.rotation.y = 0; o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
  const lines = [];
  const chain = [[-175, 20], ...TOWERS.slice(0, 4)];
  for (let i = 1; i < 4; i++) {
    const a = TOWERS[i - 1], b = TOWERS[i];
    for (const [ox, oy] of [[-9, 31.5], [9, 31.5], [-7.5, 37.5], [7.5, 37.5]]) {
      const p0 = new THREE.Vector3(a[0] + ox, 5.4 + oy - 1.5, a[1]), p1 = new THREE.Vector3(b[0] + ox, 5.4 + oy - 1.5, b[1]);
      const pts = []; for (let k = 0; k <= 16; k++) { const s = k / 16; const p = p0.clone().lerp(p1, s); p.y -= 7 * 4 * s * (1 - s); pts.push(p); }
      lines.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.09, 3).toNonIndexed());
    }
  }
  void chain;
  addMesh(mergeGeometries(lines), M.darkMetal, 0, 0, 0, 0, scene, false);
}
// houses, cafe, pavilion (right bank)
const winTex = canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#eeece6'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#2b3946'; c.fillRect(30, 70, 70, 90); c.fillRect(156, 70, 70, 90);
  c.fillStyle = '#d8d4cc'; c.fillRect(30, 112, 70, 5); c.fillRect(156, 112, 70, 5);
  c.fillStyle = '#ccc8c0'; c.fillRect(0, 236, w, 20);
});
const houseMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.8 });
function house(x, z, ry, w = 11, d = 9, h = 6, roof = M.roofRed) {
  const g = new THREE.Group(); g.position.set(x, 5.2, z); g.rotation.y = ry; scene.add(g);
  box(w, h, d, houseMat, 0, 0, 0, 0, g);
  const r = addMesh(new THREE.ConeGeometry(Math.SQRT1_2 * 1.0, 1, 4, 1), roof, 0, h + 1.6, 0, Math.PI / 4, g);
  r.scale.set((w + 1.6), 3.2, (d + 1.6)); r.rotation.y = 0; r.geometry.rotateY(Math.PI / 4);
  return g;
}
house(118, 150, 0.15); house(140, 178, -0.1, 12, 9); house(102, 196, 0.3, 10, 8, 6, M.roofGrey); house(160, 140, 0.05, 9, 8);
{ // cafe
  const g = new THREE.Group(); g.position.set(190, 5.2, 238); g.rotation.y = -0.25; scene.add(g);
  box(26, 7, 16, houseMat, 0, 0, 0, 0, g);
  box(18, 6, 14, M.white, -3, 7, 0, 0, g);
  box(17.8, 4, 0.2, M.glass, -3, 8, 7.05, 0, g);
  box(8, 0.4, 14, M.wood, 9, 7, 0, 0, g);
  for (const zz of [-7, 7]) box(8, 1.1, 0.15, M.wood, 9, 7.4, zz, 0, g);
  box(0.15, 1.1, 14, M.wood, 13, 7.4, 0, 0, g);
  box(19, 0.6, 15, M.roofGrey, -3, 13, 0, 0, g);
  const sign = canvasTex(256, 64, (c, w, h) => { c.fillStyle = '#3a2a1c'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2e6cc'; c.font = '600 44px Kanit'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('CAFÉ', w / 2, h / 2 + 3); });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.7 })); s.position.set(-6, 5.6, 8.05); g.add(s);
  // umbrellas on deck
  for (const [ux, uz] of [[6, -3], [11, 3]]) { addMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), M.wood, ux, 8.4, uz, 0, g); addMesh(new THREE.ConeGeometry(1.7, 0.7, 8), M.roofRed, ux, 9.8, uz, 0, g); }
}
{ // pavilion with striped roof
  const stripes = canvasTex(256, 256, (c, w, h) => { for (let x = 0; x < w; x += 32) { c.fillStyle = (x / 32) % 2 ? '#f2f2f2' : '#2a5ca8'; c.fillRect(x, 0, 32, h); } });
  const g = new THREE.Group(); g.position.set(100, 5.2, 262); g.rotation.y = 0.4; scene.add(g);
  for (const [px, pz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) addMesh(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 6), M.wood, px, 1.7, pz, 0, g);
  const roof = addMesh(new THREE.BoxGeometry(9.5, 0.2, 7.5), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }), 0, 3.7, 0, 0, g); roof.rotation.z = 0.18;
}
// fish cages in side channel
{
  for (const [x, z] of [[240, 410], [262, 425], [330, 452], [352, 458]]) {
    const g = new THREE.Group(); g.position.set(x, RIVER_LEVEL + 0.2, z); g.rotation.y = -0.45; scene.add(g);
    for (const [w, d, ox, oz] of [[10, 0.5, 0, -5], [10, 0.5, 0, 5], [0.5, 10, -5, 0], [0.5, 10, 5, 0]]) box(w, 0.4, d, M.white, ox, 0, oz, 0, g);
    box(9.4, 0.05, 9.4, new THREE.MeshStandardMaterial({ color: 0x12201a, roughness: 0.5 }), 0, -0.05, 0, 0, g);
  }
}
// bridges: red footbridge over main river, red bridge over side channel, wooden footbridge near dam
function footbridge(x0, z0, x1, z1, y, mat, width = 3.4, arch = true) {
  const a = new THREE.Vector3(x0, y, z0), b = new THREE.Vector3(x1, y, z1); const L = a.distanceTo(b); const mid = a.clone().lerp(b, 0.5);
  const g = new THREE.Group(); g.position.copy(mid); g.rotation.y = Math.atan2(x1 - x0, z1 - z0); scene.add(g);
  box(width, 0.5, L, mat, 0, 0, 0, 0, g);
  for (const s of [-1, 1]) {
    box(0.18, 0.18, L, mat, s * width / 2, 1.2, 0, 0, g);
    if (!arch) { for (let k = 0; k <= Math.floor(L / 2.5); k++) box(0.14, 1.2, 0.14, mat, s * width / 2, 0.25, -L / 2 + k * 2.5, 0, g); continue; }
    const pts = []; for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push(new THREE.Vector3(s * width / 2, 0.5 + Math.sin(u * Math.PI) * L * 0.075, -L / 2 + u * L)); }
    addMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.55, 8), mat, 0, 0, 0, 0, g);
    for (let k = 1; k < 16; k++) { const u = k / 16; const hh = Math.sin(u * Math.PI) * L * 0.075; addMesh(new THREE.BoxGeometry(0.16, hh, 0.16), mat, s * width / 2, 0.5 + hh / 2, -L / 2 + u * L, 0, g); }
  }
  for (const u of [0.33, 0.66]) addMesh(new THREE.CylinderGeometry(0.5, 0.6, y + 4, 8), M.concrete, 0, -(y + 4) / 2, -L / 2 + u * L, 0, g);
  return g;
}
footbridge(riverX(395) - 70, 395, riverX(395) + 70, 400, 9, M.red);
footbridge(176, 360, 214, 414, 7, M.red, 3);
footbridge(riverX(150) - 74, 152, riverX(150) + 72, 150, 6.5, M.wood, 2.6, false);

// farm: crop field, pens, animals
{
  const field = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#5a4128'; c.fillRect(0, 0, w, h); for (let x = 6; x < w; x += 22) { c.fillStyle = '#4d7a24'; c.fillRect(x, 0, 11, h); for (let y = 0; y < h; y += 6) { c.fillStyle = `rgba(${60 + Math.random() * 40},${110 + Math.random() * 50},${30},0.8)`; c.beginPath(); c.arc(x + 5 + Math.random() * 3, y, 3 + Math.random() * 2, 0, 6.28); c.fill(); } } });
  field.repeat.set(3, 2);
  const g = new THREE.PlaneGeometry(130, 80); g.rotateX(-Math.PI / 2);
  addMesh(g, new THREE.MeshStandardMaterial({ map: field, roughness: 1 }), 450, 5.3, 645, 0.1, scene, false);
}
function fenceRect(cx, cz, w, d) {
  const parts = [];
  const per = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
  for (const [ax, az, bx, bz] of per) {
    const L = Math.hypot(bx - ax, bz - az); const n = Math.ceil(L / 3);
    for (let i = 0; i <= n; i++) { const g = new THREE.BoxGeometry(0.15, 1.4, 0.15); g.translate(lerp(ax, bx, i / n), 0.7, lerp(az, bz, i / n)); parts.push(g); }
    for (const yy of [0.6, 1.2]) { const g = new THREE.BoxGeometry(Math.abs(bx - ax) + 0.1, 0.1, Math.abs(bz - az) + 0.1); g.translate((ax + bx) / 2, yy, (az + bz) / 2); parts.push(g); }
  }
  addMesh(mergeGeometries(parts.map(p => p.toNonIndexed())), M.wood, cx, 5.2, cz);
}
function animal(kind, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, terrainY(x, z), z); g.rotation.y = ry; scene.add(g);
  const spec = { cow: [2.3, 1.0, 0.9, 1.3, 0xece8e0], pig: [1.4, 0.7, 0.75, 0.6, 0xe0a0a0], buffalo: [2.5, 1.15, 1.1, 1.3, 0x2c2a2a] }[kind];
  const [L, Hh, Wd, leg, col] = spec;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
  const bodyG = new THREE.CapsuleGeometry(Hh / 2, L - Hh, 4, 8); bodyG.rotateX(Math.PI / 2); bodyG.scale(Wd / Hh, 1, 1);
  addMesh(bodyG, mat, 0, leg + Hh / 2, 0, 0, g);
  addMesh(new THREE.BoxGeometry(Wd * 0.55, Hh * 0.55, Hh * 0.8), mat, 0, leg + Hh * 0.75, L / 2 + Hh * 0.2, 0, g);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(new THREE.CylinderGeometry(0.09, 0.08, leg, 5), mat, lx * Wd * 0.3, leg / 2, lz * L * 0.32, 0, g);
  if (kind === 'cow') { const sp = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }); addMesh(new THREE.SphereGeometry(0.4, 8, 6), sp, 0.32, leg + Hh * 0.7, -0.2, 0, g).scale.set(0.6, 0.9, 1.3); }
  if (kind === 'buffalo') for (const s of [-1, 1]) { const h = addMesh(new THREE.ConeGeometry(0.1, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xc8c0b0 }), s * 0.45, leg + Hh * 1.05, L / 2 + 0.1, 0, g); h.rotation.z = -s * 1.0; }
}
fenceRect(258, 560, 70, 60); fenceRect(335, 600, 50, 60);
// village + rice paddies (fill the downstream valley like a Thai countryside)
{
  const rv = mulberry32(99);
  for (let i = 0; i < 16; i++) {
    const x = 115 + rv() * 140, z = 638 + rv() * 148;
    house(x, z, rv() * 6.28, 8 + rv() * 5, 7 + rv() * 3, 4 + rv() * 3, rv() < 0.6 ? M.roofRed : M.roofGrey);
  }
  const paddy = canvasTex(1024, 704, (c, w, h) => {
    c.fillStyle = '#8a7a52'; c.fillRect(0, 0, w, h);
    const cols = 5, rows = 4, pw = w / cols, ph = h / rows;
    const tones = ['#5f8f2a', '#6e9c30', '#7aa63a', '#88a848', '#4f7a2a', '#9aae5a', '#5a6f6a', '#6f8a40'];
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const t = tones[Math.floor(Math.random() * tones.length)];
      c.fillStyle = t; c.fillRect(k * pw + 5, r * ph + 5, pw - 10, ph - 10);
      for (let y = r * ph + 8; y < (r + 1) * ph - 8; y += 4) { c.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.06})`; c.fillRect(k * pw + 6, y, pw - 12, 1.5); }
      for (let n = 0; n < 300; n++) { c.fillStyle = `rgba(255,255,200,${Math.random() * 0.08})`; c.fillRect(k * pw + 6 + Math.random() * (pw - 12), r * ph + 6 + Math.random() * (ph - 12), 3, 3); }
    }
  });
  paddy.wrapS = paddy.wrapT = THREE.ClampToEdgeWrapping;
  const g = new THREE.PlaneGeometry(350, 225); g.rotateX(-Math.PI / 2);
  addMesh(g, new THREE.MeshStandardMaterial({ map: paddy, roughness: 0.75 }), 470, 5.3, 797, 0, scene, false);
}
for (let i = 0; i < 9; i++) animal('cow', 258 + rr(-28, 28), 560 + rr(-24, 24), rr(0, 6.28));
for (let i = 0; i < 8; i++) animal('pig', 335 + rr(-20, 20), 600 + rr(-24, 24), rr(0, 6.28));
for (const [x, z] of [[85, 560], [95, 575], [128, 520], [-215, -42], [-232, -55], [-205, -70]]) animal('buffalo', x, z, rr(0, 6.28));

// ---------------------------------------------------------------- vegetation
function noGo(x, z) {
  if (x > PAD[0] - 15 && x < PAD[1] + 8 && z > PAD[2] - 15 && z < PAD[3] + 15) return true;
  if (Math.abs(x) < 160 && z > -20 && z < 130) return true;
  if (Math.abs(x) < 290 && z > -70 && z < 70) return true;
  if (Math.abs(x) > 110 && Math.abs(z - roadZ(x)) < 14) return true;
  for (const f of FLAT_ZONES) if (x > f[0] - 4 && x < f[1] + 4 && z > f[2] - 4 && z < f[3] + 4) return true;
  if (Math.hypot(x - GLORY.x, z - GLORY.z) < 30) return true;
  return false;
}
function displaceBlob(g, amp, seed) {
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = vnoise(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7 - seed); v.multiplyScalar(1 + (n - 0.5) * amp); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
function colorize(g, c) { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; }
function treeGeo(variant) {
  const parts = [];
  const trunkC = new THREE.Color(0x4a3a2a);
  const tr = new THREE.CylinderGeometry(0.22, 0.42, 5, 6); tr.translate(0, 2.5, 0); parts.push(colorize(tr, trunkC));
  const blobs = variant === 0 ? [[0, 6.2, 0, 3.2], [1.4, 5.4, 0.8, 2.3], [-1.3, 5.6, -0.6, 2.4], [0.2, 7.6, -0.3, 2.1]] : [[0, 7.5, 0, 2.2], [0, 5.6, 0, 2.6], [0, 9.2, 0, 1.6]];
  blobs.forEach((b, i) => {
    const g = displaceBlob(new THREE.IcosahedronGeometry(b[3], 1), 0.45, i * 3.7 + variant * 11);
    g.translate(b[0], b[1], b[2]);
    const c = new THREE.Color().setHSL(0.27 + i * 0.01, 0.55, 0.16 + i * 0.025);
    parts.push(colorize(g, c));
  });
  return mergeGeometries(parts);
}
function palmGeo() {
  const parts = [];
  const pts = []; for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push(new THREE.Vector3(Math.sin(u * 1.2) * 1.4, u * 11, 0)); }
  parts.push(colorize(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.22, 6), new THREE.Color(0x6b5a44)));
  const top = pts[8];
  for (let f = 0; f < 9; f++) {
    const a = f / 9 * Math.PI * 2; const pos = [];
    const seg = 6, len = 4.2;
    for (let s = 0; s <= seg; s++) {
      const u = s / seg; const r = u * len; const y = Math.sin(u * 1.5) * 1.2 - u * u * 2.6; const w = Math.sin(u * Math.PI) * 0.7 + 0.05;
      const cx = top.x + Math.cos(a) * r, cz = top.z + Math.sin(a) * r;
      pos.push([cx - Math.sin(a) * w, top.y + y, cz + Math.cos(a) * w], [cx + Math.sin(a) * w, top.y + y, cz - Math.cos(a) * w]);
    }
    const arr = [];
    for (let s = 0; s < seg; s++) { const A = pos[2 * s], B = pos[2 * s + 1], C = pos[2 * s + 2], D = pos[2 * s + 3]; arr.push(...A, ...C, ...B, ...B, ...C, ...D); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals();
    parts.push(colorize(g, new THREE.Color().setHSL(0.25, 0.5, 0.17)));
  }
  return mergeGeometries(parts);
}
const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
foliageMat.onBeforeCompile = sh => {
  injectWorld(sh);
  sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    { float leaf = vnoise3(vWPos*2.2)*0.55 + vnoise3(vWPos*6.5)*0.45;
      float isLeaf = step(diffuseColor.r, diffuseColor.g); // foliage is green-dominant, trunks are not
      diffuseColor.rgb *= mix(1.0, 0.62 + 0.75*leaf, isLeaf); }`)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP('(vnoise3(vWPos*2.2)*0.5 + vnoise3(vWPos*6.5)*0.25) * (1.0 - smoothstep(80.0, 300.0, length(vWPos - cameraPosition)))', '1.6'));
};
foliageMat.customProgramCacheKey = () => 'foliage';
function scatter(geo, count, sampler, scaleR, hueJ) {
  const pts = []; let tries = 0;
  while (pts.length < count && tries < count * 60) { tries++; const p = sampler(); if (p) pts.push(p); }
  const im = new THREE.InstancedMesh(geo, foliageMat, pts.length);
  const o = new THREE.Object3D(); const c = new THREE.Color();
  pts.forEach((p, i) => {
    o.position.set(p[0], p[1] - 0.3, p[2]); o.rotation.set(rr(-0.05, 0.05), rr(0, 6.28), rr(-0.05, 0.05)); const s = rr(scaleR[0], scaleR[1]); o.scale.set(s, s * rr(0.85, 1.2), s); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    c.setRGB(1, 1, 1).offsetHSL(rr(-hueJ, hueJ), rr(-0.1, 0.1), rr(-0.06, 0.08)); im.setColorAt(i, c);
  });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
  return im;
}
const NT = QUALITY === 'high' ? 6500 : 2200;
const treeSampler = () => {
  const x = rr(-1250, 1250), z = rr(-1500, 1500);
  if (noGo(x, z)) return null;
  const y = terrainY(x, z);
  if (z < -4 && y < RES_LEVEL + 1.5) return null;
  if (z >= -4 && y < 4.4) return null;
  if (terrainSlope(x, z) > 1.3) return null;
  const dens = fbm(x / 230, z / 230, 3);
  const thr = y > 30 ? 0.36 : 0.54;
  if (dens < thr + rand() * 0.12) return null;
  return [x, y, z];
};
scatter(treeGeo(0), NT * 0.6, treeSampler, [1.0, 1.9], 0.03);
scatter(treeGeo(1), NT * 0.4, treeSampler, [1.0, 1.7], 0.03);
scatter(palmGeo(), 260, () => {
  const x = rr(60, 700), z = rr(110, 900);
  if (noGo(x, z)) return null; const y = terrainY(x, z); if (y < 4.4 || y > 9) return null;
  const nearWater = Math.min(Math.abs(x - riverX(z)) - 60, distPoly(x, z, SIDE_CHAN) - 28);
  if (nearWater > 40 && rand() > 0.25) return null;
  return [x, y, z];
}, [0.9, 1.3], 0.02);
// a few trees around houses / cafe (like the model)
scatter(treeGeo(0), 40, () => { const x = rr(80, 250), z = rr(110, 300); const y = terrainY(x, z); if (y < 4.4) return null; for (const [hx, hz] of [[118, 150], [140, 178], [102, 196], [160, 140], [190, 238], [100, 262]]) if (Math.hypot(x - hx, z - hz) < 16) return null; return [x, y, z]; }, [0.7, 1.1], 0.03);

// riprap along the reservoir approach channel banks (like the model's stone embankments)
{
  const rock = displaceBlob(new THREE.DodecahedronGeometry(1, 0), 0.3, 5).toNonIndexed(); rock.computeVertexNormals();
  const pts = [];
  for (let z = -40; z > -470; z -= 1.6) for (const s of [-1, 1]) {
    let lo = 140, hi = 260; for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (terrainY(s * mid, z) < RES_LEVEL) lo = mid; else hi = mid; }
    for (let k = 0; k < 7; k++) { const off = rr(-7, 5); const x = s * (lo + off); const y = terrainY(x, z); if (y > RES_LEVEL + 7) continue; pts.push([x, y, z + rr(-0.8, 0.8)]); }
  }
  const im = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: 0x5f5b55, roughness: 0.9 }), pts.length);
  const o = new THREE.Object3D(); const c = new THREE.Color();
  pts.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.rotation.set(rr(0, 6), rr(0, 6), rr(0, 6)); o.scale.set(rr(1.0, 2.0), rr(0.7, 1.3), rr(1.0, 2.0)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); c.setRGB(1, 1, 1).multiplyScalar(rr(0.6, 1.15)); im.setColorAt(i, c); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
}

// ---------------------------------------------------------------- floating solar
{
  const tex = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#c8ccd0'; c.fillRect(0, 0, w, h); c.fillStyle = '#0f1c3a'; for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) c.fillRect(6 + x * 41, 6 + y * 39, 37, 35); });
  const panelMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.18 });
  const floatMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.7 });
  const arrays = [[-60, -270, 16, 34, 0.08], [30, -420, 14, 30, -0.05], [-100, -640, 20, 40, 0.12]];
  let n = 0; for (const a of arrays) n += a[2] * a[3];
  const pg = new THREE.BoxGeometry(2.0, 0.06, 1.1); const fg = new THREE.BoxGeometry(2.3, 0.4, 1.6);
  const pim = new THREE.InstancedMesh(pg, panelMat, n), fim = new THREE.InstancedMesh(fg, floatMat, n);
  const o = new THREE.Object3D(); let i = 0;
  for (const [cx, cz, rows, cols, ry] of arrays) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const lx = (c - cols / 2) * 2.45 + Math.floor(c / 10) * 1.2, lz = (r - rows / 2) * 1.75 + Math.floor(r / 2) * 0.9;
      const x = cx + lx * Math.cos(ry) - lz * Math.sin(ry), z = cz + lx * Math.sin(ry) + lz * Math.cos(ry);
      o.position.set(x, RES_LEVEL + 0.18, z); o.rotation.set(0, -ry, 0); o.updateMatrix(); fim.setMatrixAt(i, o.matrix);
      o.position.y = RES_LEVEL + 0.65; o.rotation.set(-0.2, -ry, 0, 'YXZ'); o.updateMatrix(); pim.setMatrixAt(i, o.matrix); i++;
    }
  }
  pim.receiveShadow = fim.receiveShadow = true; pim.castShadow = true; scene.add(pim, fim);
}

// ---------------------------------------------------------------- wind turbines
{
  const spots = [[318, -150], [345, -262], [368, -376], [390, -488]];
  const bladeG = new THREE.BoxGeometry(2.4, 40, 0.35, 1, 6, 1); bladeG.translate(0, 21, 0);
  { const p = bladeG.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 - 0.75 * (y - 1) / 40; p.setX(i, p.getX(i) * k + (y > 4 ? 0.3 * (1 - k) : 0)); p.setZ(i, p.getZ(i) * k); } bladeG.computeVertexNormals(); }
  for (const [x0, z0] of spots) {
    let x = x0; while (terrainY(x, z0) < 66 && x < 600) x += 10;
    const y = terrainY(x, z0) - 1;
    addMesh(new THREE.CylinderGeometry(1.4, 2.4, 82, 20), M.white, x, y + 41, z0);
    const head = new THREE.Group(); head.position.set(x, y + 82, z0); head.rotation.y = -2.25; scene.add(head);
    box(3.4, 3.4, 9, M.white, 0, -1.7, -1.5, 0, head);
    const rotor = new THREE.Group(); rotor.position.set(0, 0, 3.4); head.add(rotor);
    addMesh(new THREE.SphereGeometry(1.5, 16, 10), M.white, 0, 0, 0.6, 0, rotor).scale.set(1, 1, 1.5);
    for (let b = 0; b < 3; b++) { const bl = addMesh(bladeG, M.white, 0, 0, 0, 0, rotor); bl.rotation.z = b * Math.PI * 2 / 3; }
    const ph = rr(0, 6.28), sp = rr(1.05, 1.25);
    animators.push(t => { rotor.rotation.z = ph + t * sp; });
  }
}

// ---------------------------------------------------------------- particles (mist, chimney smoke)
function particles(n, glslPos, color, opacity, size0, size1) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) seeds[i] = rand();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4)); g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, color: { value: color }, opacity: { value: opacity }, fogColor: { value: FOG_COLOR }, fogDensity: { value: scene.fog.density } },
    vertexShader: `attribute vec4 aSeed; uniform float time; varying float vA; varying vec2 vUv; varying float vDepth; varying float vSeed;
      void main(){ vec3 p; float age; ${glslPos}
        float size = mix(${size0.toFixed(1)}, ${size1.toFixed(1)}, age);
        vA = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.5, 1.0, age));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float rot = aSeed.x*6.28 + time*0.1*(aSeed.y-0.5);
        vec2 c = vec2(cos(rot)*position.x - sin(rot)*position.y, sin(rot)*position.x + cos(rot)*position.y);
        mv.xy += c * size; vDepth = -mv.z; vUv = position.xy + 0.5; vSeed = aSeed.z;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: NOISE + `uniform vec3 color; uniform float opacity; uniform vec3 fogColor; uniform float fogDensity;
      varying float vA; varying vec2 vUv; varying float vDepth; varying float vSeed;
      void main(){ float d = length(vUv - 0.5);
        float n = vnoise(vUv*4.0 + vSeed*37.0)*0.6 + vnoise(vUv*9.0 - vSeed*11.0)*0.4;
        float a = (1.0 - smoothstep(0.15, 0.5, d)) * (0.55 + 0.6*n) * vA * opacity;
        a *= smoothstep(3.0, 18.0, vDepth);
        float f = 1.0 - exp(-fogDensity*fogDensity*vDepth*vDepth);
        gl_FragColor = vec4(mix(color, fogColor, f), a); }`,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5; scene.add(m);
  animators.push(t => { mat.uniforms.time.value = t; });
}
const NMIST = QUALITY === 'high' ? 1300 : 500;
particles(NMIST, `
  float life = mix(4.0, 7.5, aSeed.w); age = fract(time/life + aSeed.x); float T = age*life;
  p = vec3(mix(-60.0, 60.0, aSeed.y), 2.0, mix(52.0, 66.0, aSeed.z));
  vec3 vel = vec3((aSeed.z-0.5)*4.0, mix(4.0, 10.0, fract(aSeed.y*7.31)), mix(3.0, 9.0, fract(aSeed.z*5.17)));
  p += vel*T; p.y -= 0.55*T*T; p.y = max(p.y, 2.5);`, new THREE.Color(1.0, 0.98, 0.95).multiplyScalar(1.1), 0.05, 8, 34);
particles(Math.round(NMIST * 0.5), `
  float life = mix(3.0, 5.0, aSeed.w); age = fract(time/life + aSeed.x); float T = age*life;
  float s = mix(0.15, 1.0, aSeed.z);
  p = vec3(mix(-60.0, 60.0, aSeed.y), mix(46.6, 6.0, s) + 1.0, mix(14.0, 46.0, s));
  p += vec3(0.0, 1.5, 2.5)*T;`, new THREE.Color(1.0, 0.98, 0.95).multiplyScalar(1.1), 0.045, 3, 12);
particles(Math.round(NMIST * 0.35), `
  float life = mix(9.0, 14.0, aSeed.w); age = fract(time/life + aSeed.x); float T = age*life;
  p = vec3(-210.0, 84.0, 288.0) + vec3((aSeed.y-0.5)*2.0, 0.0, (aSeed.z-0.5)*2.0);
  p += vec3(2.2*T + 0.06*T*T, 3.2*T - 0.04*T*T, 1.2*T);`, new THREE.Color(0.75, 0.74, 0.72), 0.35, 4, 34);

// ---------------------------------------------------------------- birds
const birdMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.8, side: THREE.DoubleSide });
function makeBird(scale) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 3, 6), birdMat); body.rotation.x = Math.PI / 2; g.add(body);
  const neck = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4), new THREE.MeshStandardMaterial({ color: 0xd8a020 })); neck.rotation.x = Math.PI / 2; neck.position.z = 0.43; g.add(neck);
  const wingShape = new THREE.BufferGeometry();
  wingShape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.14, 0.85, 0, -0.06, 0, 0, 0.18, 0.85, 0, -0.06, 0.75, 0, 0.12], 3)); wingShape.computeVertexNormals();
  const wl = new THREE.Mesh(wingShape, birdMat), wr = new THREE.Mesh(wingShape, birdMat); wr.scale.x = -1;
  g.add(wl, wr); g.scale.setScalar(scale); scene.add(g);
  return { g, wl, wr };
}
function flock(n, center, scale, seed) {
  const r = mulberry32(seed); const birds = [];
  for (let i = 0; i < n; i++) birds.push({ b: makeBird(scale * (0.9 + r() * 0.2)), off: new THREE.Vector3((r() - 0.5) * 14, (r() - 0.5) * 5, (r() - 0.5) * 10 + Math.abs(i - n / 2) * 1.5), ph: r() * 6.28, fr: 2.4 + r() * 0.6 });
  animators.push(t => {
    const c0 = center(t), c1 = center(t + 0.05); const dir = c1.clone().sub(c0).normalize();
    for (const bd of birds) {
      const p = c0.clone().add(bd.off).add(new THREE.Vector3(Math.sin(t * 0.7 + bd.ph) * 1.2, Math.sin(t * 1.1 + bd.ph) * 0.6, 0));
      bd.b.g.position.copy(p); bd.b.g.lookAt(p.clone().add(dir));
      const flap = Math.sin(t * bd.fr * 2 * Math.PI + bd.ph); const glide = 0.5 + 0.5 * Math.sin(t * 0.4 + bd.ph);
      const a = flap * 0.75 * (glide > 0.3 ? 1 : 0.25);
      bd.b.wl.rotation.z = a; bd.b.wr.rotation.z = -a;
    }
  });
}
flock(9, t => new THREE.Vector3(150 - 14 * (t - 13), 30 + Math.sin(t * 0.3) * 3, 165 - 2.5 * (t - 13)), 1.5, 11);
flock(7, t => new THREE.Vector3(-30 + 4 * (t - 27), 72 + Math.sin(t * 0.4) * 2, -70 - 12.5 * (t - 27)), 1.6, 23);
flock(6, t => new THREE.Vector3(260 - 9 * (t - 40), 125 + Math.sin(t * 0.5) * 3, -470 + 14 * (t - 40)), 2.0, 37);

// ---------------------------------------------------------------- camera path (Hermite through keys)
const KEYS = [
  [6.5, [-8, 330, 480], [0, 30, 0], 24],
  [10.5, [0, 165, 275], [30, 28, 10], 31],
  [14.2, [150, 46, 330], [330, 5, 620], 46],
  [17.2, [22, 56, 468], [-220, 5, 600], 48],
  [19.6, [-8, 32, 300], [0, 25, 60], 52],
  [22.0, [-22, 17, 142], [0, 36, 15], 54],
  [25.0, [-92, 46, 74], [0, 40, 12], 54],
  [28.5, [-42, 94, 16], [20, 57, -150], 50],
  [32.0, [-6, 84, -44], [GLORY.x, 52, GLORY.z - 20], 46],
  [35.5, [168, 84, -116], [GLORY.x - 14, 52, GLORY.z - 30], 48],
  [39.0, [100, 82, -330], [25, 57, -440], 50],
  [43.0, [150, 205, -600], [370, 150, -330], 50],
  [47.0, [262, 382, -722], [0, 20, 250], 46],
  [50.5, [272, 432, -772], [0, 20, 262], 46],
];
function hermite(t, idx) {
  const n = KEYS.length;
  if (t <= KEYS[0][0]) return (typeof KEYS[0][idx] === 'number') ? KEYS[0][idx] : new THREE.Vector3(...KEYS[0][idx]);
  let i = 0; while (i < n - 2 && t > KEYS[i + 1][0]) i++;
  const k0 = KEYS[Math.max(0, i - 1)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(n - 1, i + 2)];
  const h = k2[0] - k1[0]; const s = clamp((t - k1[0]) / h, 0, 1);
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const val = k => (typeof k[idx] === 'number' ? [k[idx]] : k[idx]);
  const a = val(k0), b = val(k1), c = val(k2), d = val(k3);
  const out = b.map((_, j) => {
    const m1 = (c[j] - a[j]) / (k2[0] - k0[0] || h) * h, m2 = (d[j] - b[j]) / (k3[0] - k1[0] || h) * h;
    return h00 * b[j] + h10 * m1 + h01 * c[j] + h11 * m2;
  });
  return out.length === 1 ? out[0] : new THREE.Vector3(...out);
}
{ // derive unwrapped yaw / pitch for each key (indices 4, 5) so pans interpolate as rotations
  let prev = null;
  for (const k of KEYS) {
    const d = new THREE.Vector3(...k[2]).sub(new THREE.Vector3(...k[1]));
    let yaw = Math.atan2(d.x, d.z);
    if (prev !== null) { while (yaw - prev > Math.PI) yaw -= 2 * Math.PI; while (yaw - prev < -Math.PI) yaw += 2 * Math.PI; }
    prev = yaw;
    k[4] = yaw; k[5] = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }
}
function updateCamera(t) {
  const p = hermite(t, 1), fov = hermite(t, 3), yaw = hermite(t, 4), pitch = hermite(t, 5);
  const tg = p.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(100));
  const shake = new THREE.Vector3(Math.sin(t * 0.9) * 0.35 + Math.sin(t * 2.3) * 0.12, Math.sin(t * 1.3 + 1) * 0.25, Math.sin(t * 0.7 + 2) * 0.3);
  camera.position.copy(p).add(shake);
  const ty = terrainY(camera.position.x, camera.position.z) + 6; if (camera.position.y < ty) camera.position.y = ty;
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.lookAt(tg);
  camera.rotateZ(Math.sin(t * 0.5) * 0.006 + (hermite(t + 0.5, 1).x - p.x) * -0.0015);
}

// ---------------------------------------------------------------- post-processing
const photoTex = await new THREE.TextureLoader().loadAsync('assets/photo.jpg');
photoTex.colorSpace = THREE.NoColorSpace; photoTex.generateMipmaps = true; photoTex.minFilter = THREE.LinearMipmapLinearFilter; photoTex.anisotropy = 8;
const PHOTO_W = 3024, PHOTO_H = 2400;
await document.fonts.load('600 80px Kanit'); await document.fonts.load('300 40px Kanit');
const titleTex = canvasTex(W, H, (c, w, h) => {
  const s = w / 1920;
  c.clearRect(0, 0, w, h);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 30 * s;
  c.fillStyle = '#ffffff'; c.font = `600 ${118 * s}px Kanit`;
  c.fillText('ปลาดุกชลเขื่อน', w / 2, h * 0.43);
  c.shadowBlur = 18 * s; c.font = `300 ${36 * s}px Kanit`; c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fillText('จากโมเดลจำลอง  สู่โลกแห่งความจริง', w / 2, h * 0.43 + 105 * s);
  c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(w / 2 - 60 * s, h * 0.43 + 66 * s, 120 * s, 2 * s);
}, false);
titleTex.wrapS = titleTex.wrapT = THREE.ClampToEdgeWrapping;

const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: P.has('msaa') ? +P.get('msaa') : (QUALITY === 'high' ? 4 : 0) });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.18, 0.55, 2.2);
const outPass = new OutputPass();
const finalPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, tPhoto: { value: photoTex }, tTitle: { value: titleTex },
    photoRect: { value: new THREE.Vector4(0, 0, 1, 1) }, mixAmt: { value: 0 }, time: { value: 0 }, fade: { value: 1 }, titleAlpha: { value: 0 },
    res: { value: new THREE.Vector2(W, H) }, barFrac: { value: 0.094 }, photoAspect: { value: PHOTO_W / PHOTO_H },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: NOISE + `
    uniform sampler2D tDiffuse, tPhoto, tTitle; uniform vec4 photoRect; uniform float mixAmt, time, fade, titleAlpha, barFrac, photoAspect; uniform vec2 res;
    varying vec2 vUv;
    vec3 samplePhoto(vec2 uv){
      vec2 puv = photoRect.xy + uv*photoRect.zw;
      float d = length((uv-0.5)*vec2(res.x/res.y,1.0));
      float r = smoothstep(0.30, 0.95, d) * 0.010 * photoRect.z;
      vec3 c = texture2D(tPhoto, puv).rgb*0.2;
      for (int i=0;i<8;i++){ float a = float(i)*0.785398 + 0.3; c += texture2D(tPhoto, puv + vec2(cos(a), sin(a)*photoAspect)*r).rgb*0.1; }
      // gentle grade on the phone photo
      c = pow(c, vec3(1.06)); c *= vec3(1.03, 1.0, 0.97);
      return c;
    }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float ca = 0.0035*dot(dc,dc);
      vec3 scene = vec3(texture2D(tDiffuse, uv - dc*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + dc*ca).b);
      vec3 col = scene;
      if (mixAmt < 0.999) {
        vec3 ph = samplePhoto(uv);
        vec2 q = dc*vec2(res.x/res.y, 1.0);
        float n = fbm5(uv*vec2(res.x/res.y,1.0)*2.2 + 3.7);
        float field = length(q*vec2(0.8,1.0))*1.05 + (n-0.5)*0.85;
        float p = mix(-0.55, 1.75, mixAmt);
        float m = 1.0 - smoothstep(p - 0.32, p, field);
        m = mix(m, 1.0, smoothstep(0.85, 1.0, mixAmt)) * smoothstep(0.0, 0.04, mixAmt);
        float edge = (1.0 - smoothstep(0.0, 0.16, abs(field - (p - 0.16)))) * smoothstep(0.0, 0.15, mixAmt) * (1.0 - smoothstep(0.75, 1.0, mixAmt));
        col = mix(ph, scene, m) + edge*vec3(1.0, 0.87, 0.68)*0.20;
        col = mix(col, col + vec3(0.06,0.05,0.04), sin(mixAmt*3.14159)*0.5);
      }
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, 1.07);
      col += vec3(-0.010, 0.002, 0.016)*(1.0-l) + vec3(0.022, 0.008, -0.018)*l;
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col*col*(3.0-2.0*col), 0.28);
      float v = smoothstep(1.25, 0.35, length(dc*vec2(1.3,1.0)*1.5));
      col *= mix(0.70, 1.0, v);
      vec4 tt = texture2D(tTitle, uv);
      col = mix(col, tt.rgb, tt.a*titleAlpha);
      float g = hash12(uv*res + fract(time*13.7)*vec2(97.0,131.0)) - 0.5;
      col += g*0.032;
      col *= fade;
      if (uv.y < barFrac || uv.y > 1.0 - barFrac) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(outPass); composer.addPass(finalPass);

// ---------------------------------------------------------------- timeline
const T_MIX0 = 6.6, T_MIX1 = 10.6, DURATION = 50;
function photoRectAt(t) {
  const e = Math.pow(clamp(t / T_MIX1, 0, 1), 1.55);
  const w = 3024 * Math.pow(760 / 3024, e);
  const cx = lerp(1512, 1420, e), cy = lerp(1060, 862, e);
  const h = w * H / W;
  return new THREE.Vector4((cx - w / 2) / PHOTO_W, 1 - (cy + h / 2) / PHOTO_H, w / PHOTO_W, h / PHOTO_H);
}
window.renderFrame = (t) => {
  const mix = sstep(T_MIX0, T_MIX1, t);
  for (const a of animators) a(t);
  updateCamera(Math.max(t, KEYS[0][0]));
  const need3D = mix > 0;
  renderPass.enabled = need3D; bloom.enabled = need3D; outPass.enabled = need3D;
  if (need3D && !shadowBaked) { renderer.shadowMap.needsUpdate = true; shadowBaked = true; }
  const u = finalPass.uniforms;
  u.mixAmt.value = mix; u.time.value = t; u.photoRect.value.copy(photoRectAt(t));
  u.fade.value = sstep(0, 1.3, t) * (1 - sstep(48.4, 50.0, t));
  u.titleAlpha.value = sstep(44.6, 46.4, t) * (1 - sstep(48.6, 49.6, t));
  composer.render();
};
window.getFrame = (t, q = 0.94) => { window.renderFrame(t); return renderer.domElement.toDataURL('image/jpeg', q); };
window.DURATION = DURATION;
window.ready = true;
