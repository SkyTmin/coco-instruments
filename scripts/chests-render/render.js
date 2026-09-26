// Сундуки (v2.71) — по одному на ярус, закрытый и открытый. Модель
// собирается кодом: корпус из досок, крышка-полубочка на петлях сзади,
// окованные полосы, уголки, замок с накладкой; по ярусу — металл, лак,
// камни и светящаяся вязь. Открытый: крышка откинута, изнутри свет цвета
// яруса и монеты.
//
// Кадр и поза общие на все восемь картинок: сцена меняет ярус и открывает
// крышку подменой картинки под вспышкой — сундук не должен прыгать.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SIZE = 1024;
const q = new URLSearchParams(location.search);
const tier = q.get('t') ?? 'common';
const open = q.get('s') === 'open';

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
function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const hex = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- ярусы
const TIERS = {
  // Обычный: дубовые доски, железные полосы с заклёпками, бронзовый замок.
  common: {
    wood: '#8a5a30',
    lacquer: 0.05,
    band: '#55585d',
    bandRough: 0.55,
    bandW: 0.085,
    corner: '#4d5055',
    lock: '#b07a3e',
    gem: null,
    vyaz: null,
    glow: '#ffcf7a',
  },
  // Редкий: тёмное дерево, воронёная сталь, серебряные уголки, синий камень.
  rare: {
    wood: '#4a2c18',
    lacquer: 0.25,
    band: '#5f7ea8',
    bandRough: 0.28,
    bandW: 0.09,
    corner: '#cfd8e2',
    lock: '#d4dde8',
    gem: '#3f7bff',
    vyaz: null,
    glow: '#8cc4ff',
  },
  // Эпический: фиолетовый лак, золото, аметисты.
  epic: {
    wood: '#3a1262',
    lacquer: 0.85,
    band: '#e3b44a',
    bandRough: 0.22,
    bandW: 0.095,
    corner: '#e3b44a',
    lock: '#eabd52',
    gem: '#b35cff',
    vyaz: null,
    glow: '#d49cff',
  },
  // Легендарный: алый лак, литое золото, рубины, светящаяся вязь.
  legend: {
    wood: '#6a0c18',
    lacquer: 0.9,
    band: '#ffc53d',
    bandRough: 0.18,
    bandW: 0.12,
    corner: '#ffc53d',
    lock: '#ffcf4a',
    gem: '#ff2e4a',
    vyaz: '#ffd98a',
    glow: '#ffd978',
  },
};
const T = TIERS[tier];

// Размеры: ширина, высота корпуса, глубина; крышка — полубочка радиусом D/2.
const W = 1.22;
const H = 0.6;
const D = 0.78;
const R = D / 2;

// ---------------------------------------------------------------- текстуры
/**
 * Доски: волокна вдоль доски, шов между досками, разный тон у каждой,
 * гвозди у концов. `along` — доски идут вдоль u (корпус) или вдоль v
 * (крышка: доски вдоль оси бочки).
 */
function planksTex(seed, count, along) {
  const [c, g] = canvas(1024, 512);
  const r = rng(seed);
  const base = hex(T.wood);
  const w = c.width;
  const h = c.height;
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, w, h);
  const span = (along === 'u' ? h : w) / count;
  for (let k = 0; k < count; k++) {
    const tint = 0.86 + r() * 0.24;
    const col = base.clone().multiplyScalar(tint);
    g.fillStyle = `#${col.getHexString()}`;
    if (along === 'u') g.fillRect(0, k * span, w, span);
    else g.fillRect(k * span, 0, span, h);
    // Волокна.
    for (let i = 0; i < 26; i++) {
      const o = k * span + r() * span;
      g.strokeStyle = r() < 0.6 ? `rgba(20,8,2,${0.08 + r() * 0.16})` : `rgba(255,225,190,${0.04 + r() * 0.07})`;
      g.lineWidth = 0.8 + r() * 2.2;
      g.beginPath();
      let d = o;
      for (let t = 0; t <= (along === 'u' ? w : h); t += 24) {
        d += (r() - 0.5) * 1.6;
        if (along === 'u') t === 0 ? g.moveTo(t, d) : g.lineTo(t, d);
        else t === 0 ? g.moveTo(d, t) : g.lineTo(d, t);
      }
      g.stroke();
    }
    // Сучок.
    if (r() < 0.6) {
      const x = along === 'u' ? r() * w : k * span + span * (0.3 + r() * 0.4);
      const y = along === 'u' ? k * span + span * (0.3 + r() * 0.4) : r() * h;
      const grd = g.createRadialGradient(x, y, 1, x, y, 14);
      grd.addColorStop(0, 'rgba(25,10,3,.6)');
      grd.addColorStop(1, 'rgba(25,10,3,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, y, along === 'u' ? 18 : 8, along === 'u' ? 8 : 18, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Швы.
  g.fillStyle = 'rgba(15,6,2,.75)';
  for (let k = 1; k < count; k++) {
    if (along === 'u') g.fillRect(0, k * span - 3, w, 6);
    else g.fillRect(k * span - 3, 0, 6, h);
  }
  const t = tex(c);
  return t;
}

/** Вязь легендарного: золотые завитки, они же светятся. */
function vyazTex(seed) {
  const [c, g] = canvas(1024, 512);
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = T.vyaz;
  g.lineCap = 'round';
  g.lineWidth = 5;
  const curl = (x, y, s, a0, dir) => {
    g.beginPath();
    for (let k = 0; k < 44; k++) {
      const t = k / 43;
      const a = a0 + dir * t * Math.PI * 2.3;
      const rad = s * (1 - t * 0.85);
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (k) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  };
  for (let i = 0; i < 14; i++) {
    const x = 90 + (i % 7) * 140 + (r() - 0.5) * 20;
    const y = i < 7 ? 150 : 360;
    curl(x, y, 34 + r() * 10, r() * Math.PI * 2, i % 2 ? 1 : -1);
  }
  return tex(c);
}

/** Дно изнутри открытого сундука: свет яруса из глубины. */
function glowTex() {
  const [c, g] = canvas(512);
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 300);
  const col = hex(T.glow);
  grd.addColorStop(0, `#${col.clone().lerp(hex('#ffffff'), 0.35).getHexString()}`);
  grd.addColorStop(0.35, `#${col.getHexString()}`);
  grd.addColorStop(1, `#${col.clone().multiplyScalar(0.3).getHexString()}`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  return tex(c);
}

// ---------------------------------------------------------------- материалы
const metal = (color, rough = 0.3) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: 0.25 });
const gem = (color) => {
  const c = hex(color);
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.08,
    clearcoat: 0.4,
    ior: 1.8,
    emissive: c.clone().multiplyScalar(0.3),
    flatShading: true,
  });
};
function woodMat(map, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.68 - T.lacquer * 0.4,
    clearcoat: T.lacquer,
    clearcoatRoughness: 0.25,
    ...extra,
  });
}

// ---------------------------------------------------------------- модель
function build() {
  const g = new THREE.Group();
  const bodyWood = woodMat(planksTex(11, 4, 'u'));
  const sideWood = woodMat(planksTex(12, 4, 'u'));
  const innerWood = new THREE.MeshStandardMaterial({
    color: hex(T.wood).multiplyScalar(0.4),
    roughness: 0.9,
  });
  // Корпус — ящик со стенками, а не сплошной брус: у открытого видно, что
  // внутри. Грани BoxGeometry: +x, −x, +y, −y, +z, −z.
  const t = 0.05;
  const wall = (w, h, d, x, y, z, innerFace) => {
    const mats = [bodyWood, bodyWood, bodyWood, bodyWood, bodyWood, bodyWood];
    mats[innerFace] = innerWood;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    m.position.set(x, y, z);
    g.add(m);
  };
  wall(W, H, t, 0, H / 2, D / 2 - t / 2, 5);
  wall(W, H, t, 0, H / 2, -D / 2 + t / 2, 4);
  wall(t, H, D - 2 * t, -W / 2 + t / 2, H / 2, 0, 0);
  wall(t, H, D - 2 * t, W / 2 - t / 2, H / 2, 0, 1);
  // Боковины — свои доски (текстура ложится на всю грань).
  g.children.slice(-2).forEach((m) => {
    m.material = m.material.map((x) => (x === bodyWood ? sideWood : x));
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * t, t, D - 2 * t), innerWood);
  floor.position.y = t / 2;
  g.add(floor);
  // Внутри — горка сокровищ, светится цветом яруса. У закрытого не видна.
  if (open) {
    const pile = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 2 * t, D - 2 * t),
      new THREE.MeshStandardMaterial({
        map: glowTex(),
        emissive: hex('#ffffff'),
        emissiveMap: glowTex(),
        emissiveIntensity: 0.75,
        roughness: 0.9,
      }),
    );
    pile.rotation.x = -Math.PI / 2;
    pile.position.y = H - 0.11;
    g.add(pile);
  }

  const bandMat = metal(T.band, T.bandRough);
  const cornerMat = metal(T.corner, 0.26);
  const bw = T.bandW;
  // Полосы на корпусе: две вертикальные спереди и сзади, пояс по низу.
  for (const x of [-0.36, 0.36]) {
    for (const z of [D / 2 + 0.008, -D / 2 - 0.008]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(bw, H + 0.01, 0.016), bandMat);
      s.position.set(x, H / 2, z);
      g.add(s);
    }
    for (const sx of [1]) {
      void sx;
    }
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.07, D + 0.03), bandMat);
  belt.position.y = 0.035;
  g.add(belt);
  // Обод по верху — рамкой, иначе закрыл бы нутро открытого.
  for (const [w, d, x, z] of [
    [W + 0.025, 0.02, 0, D / 2 + 0.004],
    [W + 0.025, 0.02, 0, -D / 2 - 0.004],
    [0.02, D + 0.025, W / 2 + 0.004, 0],
    [0.02, D + 0.025, -W / 2 - 0.004, 0],
  ]) {
    const rb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), bandMat);
    rb.position.set(x, H - 0.025, z);
    g.add(rb);
  }
  // Уголки: литые накладки на четырёх рёбрах.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new RoundedBoxGeometry(0.11, H + 0.02, 0.11, 2, 0.012), cornerMat);
      c.position.set((sx * W) / 2, H / 2, (sz * D) / 2);
      g.add(c);
      if (T.gem && sz > 0) {
        const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), gem(T.gem));
        gm.scale.z = 0.55;
        gm.position.set((sx * W) / 2 + sx * 0.006, H * 0.5, (sz * D) / 2 + 0.058);
        g.add(gm);
      }
    }
  // Заклёпки по полосам.
  const rivetMat = metal(T.band, 0.35);
  for (const x of [-0.36, 0.36])
    for (let k = 0; k < 3; k++) {
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), rivetMat);
      rv.scale.z = 0.6;
      rv.position.set(x, 0.14 + k * 0.17, D / 2 + 0.02);
      g.add(rv);
    }

  // Замок: накладка, скважина, у легендарного — корона и большой рубин.
  const lockMat = metal(T.lock, 0.22);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.26, 0.04, 3, 0.02), lockMat);
  plate.position.set(0, H - 0.16, D / 2 + 0.025);
  g.add(plate);
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: '#0a0604', roughness: 1 }),
  );
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0, H - 0.14, D / 2 + 0.047);
  g.add(hole);
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.05, 0.02),
    new THREE.MeshStandardMaterial({ color: '#0a0604', roughness: 1 }),
  );
  slot.position.set(0, H - 0.175, D / 2 + 0.047);
  g.add(slot);
  if (T.gem) {
    const gm = new THREE.Mesh(new THREE.OctahedronGeometry(tier === 'legend' ? 0.05 : 0.035, 0), gem(T.gem));
    gm.scale.z = 0.55;
    gm.position.set(0, H - 0.24, D / 2 + 0.055);
    g.add(gm);
  }
  if (tier === 'legend') {
    for (let i = -2; i <= 2; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07 - Math.abs(i) * 0.012, 6), lockMat);
      sp.position.set(i * 0.045, H - 0.005 + 0.03 - Math.abs(i) * 0.006, D / 2 + 0.03);
      g.add(sp);
    }
  }

  // Крышка: полубочка на петлях по заднему верхнему ребру.
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  const lidWood = woodMat(planksTex(21, 5, 'v'), T.vyaz ? {} : {});
  let lidMat = lidWood;
  if (T.vyaz) {
    const vt = vyazTex(5);
    lidMat = woodMat(planksTex(21, 5, 'v'), {
      emissive: hex('#ffb640'),
      emissiveMap: vt,
      emissiveIntensity: 0.9,
    });
  }
  const shellGeo = new THREE.CylinderGeometry(R, R, W, 48, 1, false, Math.PI, Math.PI);
  shellGeo.rotateZ(-Math.PI / 2);
  const shell = new THREE.Mesh(shellGeo, [lidMat, sideWood, sideWood]);
  shell.position.z = R;
  lid.add(shell);
  // Изнанка крышки — тёмное дерево (видно у открытого).
  const underGeo = new THREE.CylinderGeometry(R - 0.02, R - 0.02, W - 0.04, 40, 1, true, Math.PI, Math.PI);
  underGeo.rotateZ(-Math.PI / 2);
  const under = new THREE.Mesh(
    underGeo,
    new THREE.MeshStandardMaterial({ color: hex(T.wood).multiplyScalar(0.45), roughness: 0.9, side: THREE.BackSide }),
  );
  under.position.z = R;
  lid.add(under);
  // Полосы крышки — дуги поверх досок, и кант по краю.
  for (const x of [-0.36, 0.36, -W / 2 + 0.012, W / 2 - 0.012]) {
    const edge = Math.abs(x) > 0.5;
    const bandGeo = new THREE.CylinderGeometry(R + 0.012, R + 0.012, edge ? 0.05 : bw, 48, 1, true, Math.PI, Math.PI);
    bandGeo.rotateZ(-Math.PI / 2);
    const bm = new THREE.Mesh(bandGeo, edge ? cornerMat : bandMat);
    bm.material.side = THREE.DoubleSide;
    bm.position.set(x, 0, R);
    lid.add(bm);
  }
  const lidRim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.025, 0.04, 0.04), bandMat);
  lidRim.position.set(0, 0.02, D);
  lid.add(lidRim);
  // Пробой: язычок крышки над замком.
  const hasp = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.16, 0.03, 2, 0.01), lockMat);
  hasp.position.set(0, -0.02, D + 0.03);
  lid.add(hasp);
  if (open) lid.rotation.x = -1.85;
  g.add(lid);

  // Открытый: монеты горкой и свет изнутри.
  if (open) {
    const coinMat = metal('#ffcf4a', 0.2);
    const r = rng(9);
    // Горка: монеты лежат гуще к середине и выше, по краям — россыпь.
    for (let i = 0; i < 70; i++) {
      const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 20), coinMat);
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r());
      const x = Math.cos(a) * rr * 0.5;
      const z = Math.sin(a) * rr * 0.3;
      cn.position.set(x, H - 0.1 + (1 - rr) * 0.09 + r() * 0.015, z);
      cn.rotation.set((r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8);
      g.add(cn);
    }
    // У редкого и выше в горке — камни цвета яруса.
    if (T.gem)
      for (let i = 0; i < (tier === 'legend' ? 7 : 4); i++) {
        const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), gem(i % 3 ? T.gem : T.glow));
        const a = r() * Math.PI * 2;
        const rr = Math.sqrt(r()) * 0.8;
        gm.position.set(Math.cos(a) * rr * 0.45, H - 0.06 + (1 - rr) * 0.07, Math.sin(a) * rr * 0.26);
        gm.rotation.set(r() * 3, r() * 3, r() * 3);
        g.add(gm);
      }
    const light = new THREE.PointLight(hex(T.glow), 3.2, 3, 1.6);
    light.position.set(0, H + 0.2, 0);
    g.add(light);
  }
  return g;
}

// ---------------------------------------------------------------- сцена
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.55;
const key = new THREE.DirectionalLight('#fff3e0', 2.3);
key.position.set(-3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight('#bcd8ff', 1.6);
rim.position.set(4, 2, -3);
scene.add(rim);
const fill = new THREE.DirectionalLight('#ffffff', 0.45);
fill.position.set(2, -3, 4);
scene.add(fill);
scene.add(new THREE.AmbientLight('#ffffff', 0.25));

const chest = build();
const holder = new THREE.Group();
holder.add(chest);
// Три четверти сверху: видны перед, правый бок и крышка.
chest.rotation.set(0, -0.55, 0);
holder.rotation.x = 0.42;
scene.add(holder);

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
// Кадр общий для закрытого и открытого: крышка открытого уходит вверх.
const span = 2.2;
const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(22 / 2));
camera.position.set(0, 0, dist);
camera.lookAt(0, 0, 0);
holder.position.set(0, -0.5, 0);

renderer.render(scene, camera);
// Где замок на картинке — туда сцена вставляет ключ (печатает run.mjs).
holder.updateMatrixWorld(true);
const lk = new THREE.Vector3(0, H - 0.14, D / 2 + 0.05).applyMatrix4(chest.matrixWorld).project(camera);
window.lock = { x: (lk.x + 1) / 2, y: (1 - lk.y) / 2 };
window.chestPNG = renderer.domElement.toDataURL('image/png');
window.done = true;
