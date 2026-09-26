// Рендер кирок «Каторги» в высоком разрешении.
// Модель собирается кодом: изогнутая головка с фаской, обух, рукоять с
// обмоткой. Материал головки — по руде кирки, детали — по редкости.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = 1280;
const q = new URLSearchParams(location.search);
const idx = +(q.get('i') ?? 0);

// ---------------------------------------------------------------- ГСЧ и холсты
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(n = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return [c, c.getContext('2d')];
}
function tex(c, rep = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const hex = (h) => new THREE.Color(h);
const css = (c) => `#${c.getHexString()}`;

// Древесина: продольные волокна вдоль рукояти (V текстуры).
function woodTex(base, seed) {
  const [c, g] = canvas(512);
  const r = rng(seed);
  const b = hex(base);
  g.fillStyle = css(b);
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512;
    const w = 1 + r() * 5;
    const dark = r() < 0.6;
    g.fillStyle = dark ? 'rgba(20,10,4,' + (0.08 + r() * 0.18) + ')' : 'rgba(255,230,190,' + (0.04 + r() * 0.08) + ')';
    g.beginPath();
    let xx = x;
    g.moveTo(xx, 0);
    for (let y = 0; y <= 512; y += 16) {
      xx += (r() - 0.5) * 3;
      g.lineTo(xx, y);
    }
    for (let y = 512; y >= 0; y -= 16) g.lineTo(xx + w, y);
    g.fill();
  }
  // Сучки.
  for (let i = 0; i < 3; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const grd = g.createRadialGradient(x, y, 1, x, y, 10 + r() * 8);
    grd.addColorStop(0, 'rgba(30,14,6,.55)');
    grd.addColorStop(1, 'rgba(30,14,6,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, 8, 22, 0, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, 1);
}

// Пятнистая поверхность: ржавчина, камень, прожилки. Возвращает цвет и шероховатость.
function blotchTex(base, spots, seed, opts = {}) {
  const [c, g] = canvas(512);
  const [cr, gr] = canvas(512);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  gr.fillStyle = `rgb(${opts.rough0 ?? 120},${opts.rough0 ?? 120},${opts.rough0 ?? 120})`;
  gr.fillRect(0, 0, 512, 512);
  for (const [color, n, rmin, rmax, alpha, rough] of spots) {
    for (let i = 0; i < n; i++) {
      const x = r() * 512;
      const y = r() * 512;
      const rad = rmin + r() * (rmax - rmin);
      for (const [gg, col] of [
        [g, color],
        [gr, rough != null ? `rgb(${rough},${rough},${rough})` : null],
      ]) {
        if (!col) continue;
        const grd = gg.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, col.replace(')', `,${alpha})`).replace('rgb(', 'rgba('));
        grd.addColorStop(1, col.replace(')', ',0)').replace('rgb(', 'rgba('));
        gg.fillStyle = grd;
        gg.beginPath();
        gg.arc(x, y, rad, 0, Math.PI * 2);
        gg.fill();
      }
    }
  }
  if (opts.veins) {
    const [col, n, w] = opts.veins;
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      let x = r() * 512;
      let y = r() * 512;
      let a = r() * Math.PI * 2;
      g.lineWidth = w * (0.4 + r());
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 30; s++) {
        a += (r() - 0.5) * 0.9;
        x += Math.cos(a) * 9;
        y += Math.sin(a) * 9;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  if (opts.flecks) {
    const [col, n] = opts.flecks;
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = 1 + r() * 2.5;
      g.fillRect(r() * 512, r() * 512, s, s);
    }
  }
  return [tex(c, opts.rep ?? 1.4), tex(cr, opts.rep ?? 1.4, false)];
}

// Кованый металл: вмятины от молота — карта нормалей.
function hammeredNormal(seed, n = 110, depth = 3) {
  const N = 256;
  const h = new Float32Array(N * N);
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const cx = r() * N;
    const cy = r() * N;
    const rad = 6 + r() * 12;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d > 1) continue;
        const xi = ((x % N) + N) % N;
        const yi = ((y % N) + N) % N;
        h[yi * N + xi] -= (1 - d * d) * 0.5;
      }
  }
  const [c, g] = canvas(N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
      const hy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      const v = new THREE.Vector3(-hx * depth, -hy * depth, 1).normalize();
      const i = (y * N + x) * 4;
      img.data[i] = (v.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, 1.6, false);
}

// Звёздная сталь: тёмная основа, россыпь светящихся точек.
function starTex(seed) {
  const [c, g] = canvas(512);
  const [ce, ge] = canvas(512);
  const r = rng(seed);
  g.fillStyle = '#1a2250';
  g.fillRect(0, 0, 512, 512);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const s = r() < 0.08 ? 3 : 1 + r();
    const col = r() < 0.5 ? '#cfe0ff' : '#ffffff';
    ge.fillStyle = col;
    ge.beginPath();
    ge.arc(x, y, s, 0, Math.PI * 2);
    ge.fill();
    g.fillStyle = 'rgba(160,190,255,.5)';
    g.fillRect(x - 1, y - 1, 2, 2);
  }
  return [tex(c, 1.2), tex(ce, 1.2)];
}

// Чароит: волокнистые завитки сиреневого с белым.
function swirlTex(seed) {
  const [c, g] = canvas(512);
  const r = rng(seed);
  const img = g.createImageData(512, 512);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      const v = y / 512;
      const w = Math.sin(u * 14 + Math.sin(v * 9 + ph[0]) * 2.2 + Math.sin(u * 5 + v * 7 + ph[1]));
      const k = 0.5 + 0.5 * w;
      const s = Math.pow(0.5 + 0.5 * Math.sin(v * 40 + w * 3 + ph[2]), 6);
      const i = (y * 512 + x) * 4;
      img.data[i] = 120 + 90 * k + 40 * s;
      img.data[i + 1] = 50 + 50 * k + 60 * s;
      img.data[i + 2] = 170 + 70 * k + 20 * s;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, 1.1);
}

// ---------------------------------------------------------------- материалы
function metal(color, rough = 0.25, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, ...extra });
}
function polished(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    ...extra,
  });
}
// Самоцвет: гранёный, насыщенный. Сильный лак белил камни до пастели —
// отражение студии ложилось поверх цвета, поэтому лак слабый.
function gem(color, extra = {}) {
  const c = hex(color);
  return new THREE.MeshPhysicalMaterial({
    color: c,
    metalness: 0,
    roughness: 0.1,
    clearcoat: 0.35,
    clearcoatRoughness: 0.05,
    specularIntensity: 0.8,
    ior: 1.8,
    emissive: c.clone().multiplyScalar(0.14),
    envMapIntensity: 0.6,
    flatShading: true,
    ...extra,
  });
}

// Опал: молочная основа с пятнами игры цвета.
function opalTex(seed) {
  const [c, g] = canvas(512);
  const r = rng(seed);
  g.fillStyle = '#f2ecf2';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 12 + r() * 40;
    const hue = Math.floor(r() * 360);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `hsla(${hue},85%,62%,.75)`);
    grd.addColorStop(1, `hsla(${hue},85%,62%,0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, 1);
}

// Градиент вдоль головки (V текстуры): александрит зелёный с одного
// острия и малиновый с другого — камень, меняющий цвет.
function lengthGradient(stops) {
  const [c, g] = canvas(64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = tex(c, 1);
  t.repeat.set(1, 1 / 3);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------- лестница кирок
// kind головки: metal | rusty | stone | forged | opaque | gem
// trim — металл обуха и колец; wood — рукоять; wrap — обмотка; tier — ступень
// редкости 0…6 (от неё украшения).
const W = { pine: '#c8955c', oak: '#9a6434', walnut: '#5e3a20', ebony: '#2a1c16', black: '#15110f' };
const T = {
  iron: '#8e959e',
  steel: '#c8d0da',
  dark: '#3a3c42',
  gold: '#e8b43a',
  silver: '#e2e6ec',
  plat: '#dfe8f2',
  bronze: '#b0703a',
};
// Порядок — как PICKS в src/lib/economy.ts: картинка N — кирка N.
const PICKS = [
  { name: 'rusty', kind: 'rusty', trim: T.iron, wood: W.pine, wrap: '#5a3a24', tier: 0 },
  { name: 'stone', kind: 'stone', trim: null, wood: W.pine, wrap: '#b89a66', tier: 0 },
  { name: 'forged', kind: 'forged', color: '#4a4c54', trim: T.dark, wood: W.oak, wrap: '#3a2618', tier: 0 },
  { name: 'iron', kind: 'metal', color: '#c9d2dc', rough: 0.18, trim: T.steel, wood: W.oak, wrap: '#4a2e1a', tier: 1 },
  { name: 'turquoise', kind: 'opaque', color: '#3fc9b8', veins: ['rgba(70,50,30,.75)', 26, 3], trim: T.steel, wood: W.oak, wrap: '#2e3b3a', tier: 1 },
  { name: 'quartz', kind: 'gem', color: '#c9bde8', trim: T.steel, wood: W.oak, wrap: '#3a3a44', tier: 1, extra: { iridescence: 0.4, envMapIntensity: 0.8 } },
  { name: 'opal', kind: 'opal', trim: T.silver, wood: W.walnut, wrap: '#403040', tier: 2 },
  { name: 'gold', kind: 'metal', color: '#ffc93a', rough: 0.16, trim: T.gold, wood: W.walnut, wrap: '#5a2412', tier: 2 },
  { name: 'lapis', kind: 'opaque', color: '#2638a8', flecks: ['#ffd76a', 160], trim: T.gold, wood: W.walnut, wrap: '#1c2350', tier: 2 },
  { name: 'garnet', kind: 'gem', color: '#6e0618', trim: T.gold, wood: W.ebony, wrap: '#3a0c14', tier: 3 },
  { name: 'sapphire', kind: 'gem', color: '#0f3ccc', trim: T.gold, wood: W.ebony, wrap: '#0c1c44', tier: 3 },
  { name: 'ruby', kind: 'gem', color: '#e0061e', trim: T.gold, wood: W.ebony, wrap: '#44081a', tier: 3 },
  { name: 'diamond', kind: 'gem', color: '#7fdcff', trim: T.plat, wood: W.black, wrap: '#20303a', tier: 4, extra: { iridescence: 0.9, iridescenceIOR: 2.2, envMapIntensity: 1.1, roughness: 0.04 } },
  { name: 'star', kind: 'star', trim: T.silver, wood: W.black, wrap: '#141a40', tier: 4 },
  { name: 'rhodonite', kind: 'opaque', color: '#ec6a90', veins: ['rgba(25,12,16,.85)', 30, 3.5], trim: T.plat, wood: W.black, wrap: '#3a1422', tier: 5, glow: '#ff7aa8' },
  { name: 'charoite', kind: 'swirl', trim: T.gold, wood: W.black, wrap: '#2a1440', tier: 5, glow: '#c070ff' },
  { name: 'alexandrite', kind: 'gem', color: '#ffffff', trim: T.gold, wood: W.black, wrap: '#240a1a', tier: 6, grad: [[0, '#0e8a5a'], [0.5, '#5a2a8a'], [1, '#d0104a']], extra: { iridescence: 0.7, iridescenceIOR: 2.3 }, glow: '#ff3a7a' },
];

// ---------------------------------------------------------------- геометрия
// Головка — брус по дуге поперёк рукояти, сечение сходится в острие на
// обоих концах. Сечение по ступени: кованый металл — ромб (грани ловят
// свет), камень — неровный семигранник со сколами, самоцвет — шестигранник.
function taperTube(points, radial, rFn, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = opts.segs ?? 72;
  const frames = curve.computeFrenetFrames(segs, false);
  const r = rng(opts.seed ?? 1);
  const pos = [];
  const uv = [];
  const ring = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const P = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const rr = rFn(t);
    const row = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2 + (opts.rot ?? 0);
      const jit = opts.jitter ? 1 + (r() - 0.5) * opts.jitter : 1;
      const v = P.clone()
        .addScaledVector(N, Math.cos(a) * rr * (opts.w ?? 1) * jit)
        .addScaledVector(B, Math.sin(a) * rr * (opts.d ?? 1) * jit);
      row.push(pos.length / 3);
      pos.push(v.x, v.y, v.z);
      uv.push(j / radial, t * (opts.vRep ?? 3));
    }
    ring.push(row);
  }
  const index = [];
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = ring[i][j];
      const b2 = ring[i][(j + 1) % radial];
      const c = ring[i + 1][(j + 1) % radial];
      const d = ring[i + 1][j];
      index.push(a, b2, d, b2, c, d);
    }
  // Торцы (на остриях сечение почти точка).
  for (const [i, flip] of [
    [0, true],
    [segs, false],
  ]) {
    const P = curve.getPointAt(i / segs);
    const ci = pos.length / 3;
    pos.push(P.x, P.y, P.z);
    uv.push(0.5, 0);
    for (let j = 0; j < radial; j++) {
      const a = ring[i][j];
      const b2 = ring[i][(j + 1) % radial];
      if (flip) index.push(ci, b2, a);
      else index.push(ci, a, b2);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  if (opts.flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

function headGeometry(p) {
  const tier = p.tier;
  const stone = p.kind === 'stone';
  // Дуга: чем выше ступень, тем длиннее и изящнее головка.
  const R = stone ? 0.95 : 1.1 + tier * 0.03;
  const aMax = stone ? 0.62 : 0.7 + tier * 0.012;
  const top = 0.3;
  const cy = top - R;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const a = -aMax + (2 * aMax * i) / 16;
    pts.push(new THREE.Vector3(Math.sin(a) * R, cy + Math.cos(a) * R, 0));
  }
  const r0 = stone ? 0.12 : p.kind === 'gem' ? 0.085 : 0.075;
  const rFn = (t) => {
    const u = Math.abs(2 * t - 1);
    // Ржавая: остриё сбито — сечение у конца не сходится в точку.
    const tip = p.kind === 'rusty' ? 0.018 : stone ? 0.02 : 0.004;
    return r0 * Math.pow(Math.max(0, 1 - Math.pow(u, 1.7)), 0.62) + tip;
  };
  if (stone)
    return taperTube(pts, 7, rFn, { w: 1.05, d: 1.1, jitter: 0.35, flat: true, seed: 5, segs: 22 });
  if (p.kind === 'gem')
    return taperTube(pts, 6, rFn, { w: 1, d: 1.15, flat: true, rot: Math.PI / 6, segs: 18 });
  return taperTube(pts, 4, rFn, {
    w: 1,
    d: 1.25,
    rot: Math.PI / 4,
    flat: true,
    jitter: p.kind === 'rusty' ? 0.08 : 0,
    seed: 9,
    segs: 64,
  });
}

function headMaterial(p) {
  switch (p.kind) {
    case 'rusty': {
      const [map, rough] = blotchTex(
        'rgb(118,78,58)',
        [
          ['rgb(150,70,30)', 60, 10, 40, 0.8, 230],
          ['rgb(70,38,24)', 70, 4, 18, 0.9, 250],
          ['rgb(96,92,92)', 14, 6, 20, 0.5, 140],
          ['rgb(40,22,14)', 60, 1, 3, 0.7, 255],
        ],
        11,
        { rough0: 200 },
      );
      return new THREE.MeshPhysicalMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0.55, normalMap: hammeredNormal(3, 60, 2), normalScale: new THREE.Vector2(0.8, 0.8) });
    }
    case 'stone': {
      const [map, rough] = blotchTex(
        'rgb(104,100,94)',
        [
          ['rgb(70,66,62)', 120, 3, 14, 0.7, 240],
          ['rgb(150,146,138)', 60, 2, 8, 0.45, 200],
          ['rgb(40,38,36)', 220, 1, 3, 0.9, 255],
        ],
        21,
        { rough0: 225 },
      );
      return new THREE.MeshPhysicalMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0, normalMap: hammeredNormal(5, 160, 5), normalScale: new THREE.Vector2(1.2, 1.2) });
    }
    case 'forged':
      return metal(p.color, 0.42, { normalMap: hammeredNormal(7, 120, 4), normalScale: new THREE.Vector2(1, 1) });
    case 'metal':
      return metal(p.color, p.rough, { clearcoat: 0.6, clearcoatRoughness: 0.1 });
    case 'opaque': {
      const [map] = blotchTex(
        css(hex(p.color)),
        [
          [`rgb(${hex(p.color).clone().multiplyScalar(0.7).toArray().map((v) => Math.round(v * 255)).join(',')})`, 40, 10, 40, 0.6, null],
          ['rgb(255,255,255)', 30, 6, 24, 0.18, null],
        ],
        31 + idx,
        { veins: p.veins, flecks: p.flecks, rep: 1.2 },
      );
      return polished('#ffffff', { map, ...(p.glow ? { emissive: hex(p.glow), emissiveIntensity: 0.12 } : {}), ...(p.extra ?? {}) });
    }
    case 'gem':
      return gem(p.color, {
        ...(p.extra ?? {}),
        ...(p.grad ? { map: lengthGradient(p.grad), emissive: hex(p.glow ?? '#000').multiplyScalar(0.12) } : {}),
      });
    case 'opal':
      return polished('#ffffff', { map: opalTex(71), iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [250, 800], roughness: 0.1 });
    case 'star': {
      const [map, em] = starTex(41);
      return metal('#ffffff', 0.22, { map, emissiveMap: em, emissive: hex('#ffffff'), emissiveIntensity: 1.6, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.05 });
    }
    case 'swirl':
      return polished('#ffffff', { map: swirlTex(51), emissive: hex(p.glow), emissiveIntensity: 0.1, sheen: 1, sheenColor: hex('#f0d0ff'), sheenRoughness: 0.3 });
    default:
      return metal('#999', 0.3);
  }
}

function build(p) {
  const g = new THREE.Group();
  // Головка.
  const head = new THREE.Mesh(headGeometry(p), headMaterial(p));
  g.add(head);

  const trimMat = p.trim ? metal(p.trim, p.trim === T.iron ? 0.55 : 0.2, { clearcoat: 0.5 }) : null;
  // Обух: гранёная втулка, сквозь неё рукоять. У каменной — верёвочная
  // обвязка крест-накрест.
  if (p.kind === 'stone') {
    const rope = new THREE.MeshPhysicalMaterial({ color: p.wrap, roughness: 0.95 });
    for (const [rz, dy] of [
      [0.6, 0],
      [-0.6, 0],
      [0, 0.1],
      [0, -0.1],
    ]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 10, 28), rope);
      t.rotation.set(Math.PI / 2, 0, rz);
      t.position.set(0, 0.3 + dy, 0);
      g.add(t);
    }
  } else {
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.34, 8, 1), trimMat);
    eye.position.set(0, 0.26, 0);
    g.add(eye);
    // Кольца обуха у редких и выше.
    if (p.tier >= 2) {
      for (const dy of [-0.17, 0.17]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.018, 10, 32), metal(T.gold === p.trim ? T.gold : p.trim, 0.15));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, 0.26 + dy, 0);
        g.add(ring);
      }
    }
    // Самоцвет на обухе у эпических и выше.
    if (p.tier >= 3) {
      const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), gem(p.glow ?? p.color ?? '#ffffff'));
      gm.scale.set(1, 1.3, 0.55);
      gm.position.set(0, 0.26, 0.105);
      g.add(gm);
    }
    // Заклёпка у железных.
    if (p.tier <= 2) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), metal(p.trim, 0.3));
      rivet.position.set(0, 0.3, 0.1);
      rivet.scale.z = 0.5;
      g.add(rivet);
    }
  }

  // Рукоять.
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex(p.wood, 60 + idx),
    roughness: p.tier >= 3 ? 0.35 : 0.7,
    clearcoat: p.tier >= 3 ? 0.8 : 0.1,
    clearcoatRoughness: 0.2,
  });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.052, 1.78, 32, 1), woodMat);
  handle.position.y = 0.42 - 0.89;
  g.add(handle);
  // Обмотка рукояти: кожаный ремень витками.
  const wrapMat = new THREE.MeshPhysicalMaterial({ color: p.wrap, roughness: 0.8, sheen: 0.4, sheenColor: hex('#ffe8d0') });
  // Ремень под обмоткой — сплошной, витки поверх — рельефом.
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.061, 0.46, 32), wrapMat);
  sleeve.position.y = -1.08;
  g.add(sleeve);
  const y0 = -1.29;
  const turns = 12;
  for (let i = 0; i < turns; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 36), wrapMat);
    t.rotation.set(Math.PI / 2 + 0.32, 0, 0);
    t.position.set(0, y0 + i * 0.038, 0);
    g.add(t);
  }
  // Навершие.
  const pomMat = trimMat ?? new THREE.MeshPhysicalMaterial({ color: '#6a5a44', roughness: 0.9 });
  const pom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.066, 0.07, 16), pomMat);
  pom.position.y = -1.34;
  g.add(pom);
  if (p.tier >= 4) {
    const pg = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), gem(p.glow ?? p.color ?? '#ffffff'));
    pg.position.y = -1.41;
    g.add(pg);
  }
  // Кольцо у головки на рукояти (редкие и выше).
  if (p.tier >= 2 && p.trim) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 24), metal(p.trim, 0.2));
    band.position.y = 0.02;
    g.add(band);
  }
  return g;
}

// ---------------------------------------------------------------- сцена
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.85;

const key = new THREE.DirectionalLight('#fff3e0', 2.4);
key.position.set(-3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight('#bcd8ff', 2.2);
rim.position.set(4, 2, -4);
scene.add(rim);
const fill = new THREE.DirectionalLight('#ffffff', 0.5);
fill.position.set(2, -3, 4);
scene.add(fill);
scene.add(new THREE.AmbientLight('#ffffff', 0.25));

const p = PICKS[idx];
const model = build(p);
const holder = new THREE.Group();
holder.add(model);
// Кирка лежит по диагонали: рукоять снизу-слева, головка сверху-справа,
// и чуть повёрнута к зрителю — видны фаска и толщина.
model.rotation.set(0.12, -0.42, 0);
holder.rotation.z = -Math.PI / 4;
scene.add(holder);

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
const box = new THREE.Box3().setFromObject(holder);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
holder.position.sub(center);
const span = Math.max(size.x, size.y) * 1.02;
const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(22 / 2));
camera.position.set(0, 0, dist);
camera.lookAt(0, 0, 0);

renderer.render(scene, camera);
window.pickPNG = renderer.domElement.toDataURL('image/png');
window.done = true;
