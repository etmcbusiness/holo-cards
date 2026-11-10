import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const cards = window.CARDS;
const stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
const pivot = new THREE.Group();
scene.add(pivot);
let cardHeight = 1.4; // card width is always 1

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = Math.max(cardHeight / 0.8 / k, 1 / 0.82 / (k * camera.aspect)) + 0.2;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- shaders ----------
const GLSL_COMMON = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hue(float h) { return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
`;

// card face: red/cyan split, rainbow foil, glare and sparkles that all follow the viewing angle
const faceMaterial = (map) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying vec3 vN;
    void main() {
      vUv = uv;
      vN = normalMatrix * normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map; uniform float time;
    varying vec2 vUv; varying vec3 vN;
    ${GLSL_COMMON}
    void main() {
      vec2 t = normalize(vN).xy;               // how far the card is turned
      float s = t.x < 0. ? -1. : 1.;
      vec2 off = vec2(.0008 + .004 * abs(t.x), .002 * t.y) * s;
      vec3 col = vec3(texture2D(map, vUv + off).r, texture2D(map, vUv - off).gb);

      col += (hue(vUv.x * .9 + vUv.y * .6 + t.x * 1.6 - t.y) - .5) * .14;   // foil
      vec2 g = vec2(.5 - t.x * 1.3, .55 + t.y * 1.3);
      col += pow(max(0., 1. - distance(vUv * vec2(1., 1.4), g * vec2(1., 1.4)) * 1.4), 3.) * .3; // glare

      vec2 gp = vUv * vec2(26., 36.), id = floor(gp);
      float hs = hash(id);
      if (hs > .72) {                                                     // sparkles
        vec2 p = fract(gp) - .5 - (vec2(hash(id + 1.3), hash(id + 7.1)) - .5) * .6;
        float tw = pow(max(0., sin(time * (1. + hs * 2.) + hs * 40. + (t.x + t.y) * 14.)), 6.);
        float star = max(0., 1. - abs(p.x * p.y) * 400.) * max(0., 1. - length(p) * 3.);
        col += star * tw * mix(vec3(1., .95, .7), hue(hs * 5.), .4) * 1.3;
      }
      col *= 1. - .035 * step(.66, fract(gl_FragCoord.x / 3.));            // faint stripes
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }`,
});

// the character: a flat cut-out puffed into a 3D shape using a depth map made from its outline
const popMaterial = (map, info, opts) => new THREE.ShaderMaterial({
  uniforms: {
    map: { value: map }, info: { value: info },
    depth: { value: opts.depth }, side: { value: opts.side },
    cutV: { value: opts.cutV }, zLow: { value: 0.012 }, zHigh: { value: 0.07 },
  },
  side: THREE.DoubleSide,
  alphaToCoverage: true,
  vertexShader: /* glsl */ `
    uniform sampler2D info; uniform float depth, side, cutV, zLow, zHigh;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 i = texture2D(info, uv);
      float rise = smoothstep(cutV, cutV + .2, uv.y);     // sinks into the card at the cut line
      vec3 p = position;
      p.z = mix(zLow, zHigh, rise) + side * i.b * depth * smoothstep(cutV, cutV + .1, uv.y);
      vec3 n = normalize(vec3(i.rg * 2. - 1., 1.));
      n.z *= sign(side);
      vN = normalMatrix * n;
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map; uniform float side, cutV;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      if (vUv.y < cutV) discard;
      vec4 c = texture2D(map, vUv);
      if (c.a < .05) discard;
      vec3 N = normalize(vN), V = normalize(vV);
      if (!gl_FrontFacing) N = -N;
      vec3 L = normalize(vec3(-.4, .6, .8));
      float diff = max(dot(N, L), 0.);
      float spec = pow(max(dot(N, normalize(L + V)), 0.), 40.) * .25;
      float rim = pow(1. - max(dot(N, V), 0.), 3.) * .3;
      vec3 col = c.rgb * (.5 + .65 * diff) + spec + rim * vec3(1., .6, .3);
      if (side < 0.) col *= .6;
      col *= 1. - .035 * step(.66, fract(gl_FragCoord.x / 3.));
      gl_FragColor = vec4(col, smoothstep(.3, .7, c.a));
      #include <colorspace_fragment>
    }`,
});

// ---------- depth map from the cut-out's outline ----------
// Distance from the edge, shaped so thin parts (arms, wings) are round and the body is fuller.
function makeInfo(img, worldWidth, depth) {
  const sw = 256, sh = Math.round((256 * img.naturalHeight) / img.naturalWidth);
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, sw, sh);
  const a = cx.getImageData(0, 0, sw, sh).data;
  const N = sw * sh, d = new Float32Array(N);
  for (let k = 0; k < N; k++) d[k] = a[k * 4 + 3] > 128 ? 1e9 : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh ? 0 : d[y * sw + x]);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const k = y * sw + x;
    d[k] = Math.min(d[k], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  for (let y = sh - 1; y >= 0; y--) for (let x = sw - 1; x >= 0; x--) {
    const k = y * sw + x;
    d[k] = Math.min(d[k], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  }
  let max = 0;
  for (let k = 0; k < N; k++) max = Math.max(max, d[k]);
  const R = 22;
  let h = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const r = Math.min(d[k], R) / R;
    h[k] = d[k] ? 0.7 * Math.sqrt(1 - (1 - r) * (1 - r)) + 0.3 * (d[k] / max) : 0;
  }
  for (let pass = 0; pass < 2; pass++) { // smooth
    const s = new Float32Array(N);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let t = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < sw && yy < sh) { t += h[yy * sw + xx]; n++; }
      }
      s[y * sw + x] = t / n;
    }
    h = s;
  }
  // pack normal (rg) + height (b); rows bottom-up to match the image texture
  const px = worldWidth / sw, k = depth / px / 2;
  const out = new Uint8Array(N * 4);
  const H = (x, y) => h[Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const gx = (H(x + 1, y) - H(x - 1, y)) * k, gy = -(H(x, y + 1) - H(x, y - 1)) * k;
    const len = Math.hypot(gx, gy, 1);
    const o = ((sh - 1 - y) * sw + x) * 4;
    out[o] = ((-gx / len) * 0.5 + 0.5) * 255;
    out[o + 1] = ((-gy / len) * 0.5 + 0.5) * 255;
    out[o + 2] = H(x, y) * 255;
    out[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, sw, sh, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------- building a card ----------
const loader = new THREE.TextureLoader();
const loadTex = (src) => new Promise((ok, fail) => loader.load(src, (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ok(t);
}, undefined, fail));

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

const THICK = 0.012;
let current = null, popGroup = null, faceMat = null;

async function build(c) {
  const art = await loadTex(c.art);
  const Hc = art.image.naturalHeight / art.image.naturalWidth;
  const group = new THREE.Group();
  const shape = roundedRect(1, Hc, 0.045);

  group.add(new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -THICK / 2),
    new THREE.MeshBasicMaterial({ color: 0xd8d2b8 })));

  const faceGeo = new THREE.ShapeGeometry(shape, 10);
  const pos = faceGeo.attributes.position, uv = faceGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) / Hc + 0.5);
  const mat = faceMaterial(art);
  const face = new THREE.Mesh(faceGeo, mat);
  face.position.z = THICK / 2 + 0.0008;
  group.add(face);

  const back = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), new THREE.MeshBasicMaterial({ color: 0x1d3f8f }));
  back.rotation.y = Math.PI;
  back.position.z = -THICK / 2 - 0.0008;
  group.add(back);

  let pg = null;
  if (c.pop) {
    const tex = await loadTex(c.pop.src);
    const [l, t, w] = c.pop.box;
    const pw = w / 100, ph = (pw * tex.image.naturalHeight) / tex.image.naturalWidth;
    const cx = -0.5 + l / 100 + pw / 2, top = Hc / 2 - (t / 100) * Hc;
    const cy = top - ph / 2;
    const cutV = c.pop.cut == null ? -1 : (Hc / 2 - (c.pop.cut / 100) * Hc - (cy - ph / 2)) / ph;
    const depth = 0.14;
    const info = makeInfo(tex.image, pw, depth);
    const geo = new THREE.PlaneGeometry(pw, ph, 220, Math.round((220 * ph) / pw));
    pg = new THREE.Group();
    pg.position.set(cx, cy, 0);
    pg.add(new THREE.Mesh(geo, popMaterial(tex, info, { depth, side: 1, cutV })));
    pg.add(new THREE.Mesh(geo, popMaterial(tex, info, { depth, side: -0.4, cutV })));
    pg.userData.float = !!c.pop.float;
    group.add(pg);
  }

  if (current) {
    pivot.remove(current);
    current.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  current = group; popGroup = pg; faceMat = mat;
  pivot.add(group);
  cardHeight = Hc;
  resize();
}

let index = 0;
function show(i) {
  index = (i + cards.length) % cards.length;
  document.title = cards[index].name;
  [...$('dots').children].forEach((d, n) => d.classList.toggle('on', n === index));
  build(cards[index]).catch((e) => console.error('Could not load card', e));
}
$('dots').innerHTML = cards.map(() => '<i></i>').join('');
$('controls').style.visibility = cards.length > 1 ? '' : 'hidden';
$('prev').onclick = () => show(index - 1);
$('next').onclick = () => show(index + 1);
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') show(index - 1);
  if (e.key === 'ArrowRight') show(index + 1);
});

// ---------- spinning with a finger or mouse ----------
const rot = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
let drag = null, lastInput = -1e9;
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
  vel.x = vel.y = 0;
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = 3 / Math.min(stage.clientWidth, stage.clientHeight); // a full-width drag ≈ 3 rad
  const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
  rot.y += dx; rot.x += dy;
  vel.x = dy; vel.y = dx;
  drag = { x: e.clientX, y: e.clientY };
  lastInput = performance.now();
});
const release = () => { drag = null; lastInput = performance.now(); };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);

// phone tilt (iOS asks first)
const gyro = { x: 0, y: 0 };
let base = null;
function onOrient(e) {
  if (e.beta == null) return;
  if (!base) base = { b: e.beta, g: e.gamma };
  gyro.x = THREE.MathUtils.clamp((e.gamma - base.g) / 40, -1, 1);
  gyro.y = THREE.MathUtils.clamp((e.beta - base.b) / 40, -1, 1);
}
const DOE = window.DeviceOrientationEvent;
if (matchMedia('(pointer: coarse)').matches && DOE) {
  if (typeof DOE.requestPermission === 'function') {
    const btn = $('motion');
    btn.hidden = false;
    btn.onclick = async () => {
      if ((await DOE.requestPermission().catch(() => 'denied')) === 'granted') {
        addEventListener('deviceorientation', onOrient);
        btn.hidden = true;
      } else btn.textContent = 'Motion blocked';
    };
  } else addEventListener('deviceorientation', onOrient);
}

// ---------- frame loop ----------
const clock = new THREE.Clock();
function frame() {
  const t = clock.getElapsedTime();
  if (!drag) {
    rot.x += vel.x; rot.y += vel.y;
    vel.x *= 0.92; vel.y *= 0.92;
    if (performance.now() - lastInput > 1500) {
      // drift back to face-on (nearest full turn), with a gentle sway
      const home = Math.round(rot.y / (2 * Math.PI)) * 2 * Math.PI;
      const sway = reduceMotion ? 0 : 1;
      rot.y += (home + Math.sin(t * 0.55) * 0.25 * sway - rot.y) * 0.03;
      rot.x += (Math.cos(t * 0.4) * 0.12 * sway - rot.x) * 0.03;
    }
  }
  rot.x = THREE.MathUtils.clamp(rot.x, -1.1, 1.1);
  pivot.rotation.set(rot.x + gyro.y * 0.6, rot.y + gyro.x * 0.6, 0);
  if (faceMat) faceMat.uniforms.time.value = t;
  if (popGroup?.userData.float && !reduceMotion) popGroup.position.z = 0.006 * Math.sin(t * 1.8);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
show(0);
requestAnimationFrame(frame);
