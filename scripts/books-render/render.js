// Обложки книг зачарований (v2.70) — по одной на ярус. Модель собирается
// кодом: две доски в коже, блок страниц с обрезом, корешок, медальон в
// центре (в него страница кладёт знак чары маской), а по ярусу — уголки,
// застёжка, камни и светящаяся вязь.
//
// Книга стоит почти анфас, чуть повёрнута: виден обрез страниц справа и
// сверху. Центр медальона на картинке — MEDAL в run.mjs, его же берёт CSS
// (`.pbook__emboss`).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SIZE = 1024;
const q = new URLSearchParams(location.search);
const tier = q.get('t') ?? 'simple';

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

// ---------------------------------------------------------------- ярусы
const TIERS = {
  // Простая: бурая кожа, тиснёная рамка, бронзовое кольцо медальона.
  simple: {
    leather: '#4e2c14',
    grain: 0.22,
    frame: 'emboss',
    ring: '#b07a3e',
    corners: null,
    clasp: null,
    gems: null,
    vyaz: null,
    pages: '#e8dcc0',
    edge: null,
  },
  // Редкая: синяя кожа, серебряные уголки и кольцо, серебряный обрез.
  rare: {
    leather: '#14305e',
    grain: 0.18,
    frame: 'foil',
    foil: '#c9d3de',
    ring: '#cfd8e2',
    corners: '#c3ccd6',
    clasp: null,
    gems: null,
    vyaz: null,
    pages: '#e9e2d0',
    edge: '#b8c4d0',
  },
  // Эпическая: фиолетовая кожа, золото, застёжка через обрез, аметисты.
  epic: {
    leather: '#35105a',
    grain: 0.16,
    frame: 'foil',
    foil: '#e0b24a',
    ring: '#e6b84c',
    corners: '#e3b44a',
    clasp: '#e3b44a',
    gems: '#b35cff',
    vyaz: null,
    pages: '#efe6cf',
    edge: '#d9a93e',
  },
  // Легендарная: тёмно-алая кожа, литое золото, рубины, светящаяся вязь.
  legend: {
    leather: '#560c16',
    grain: 0.14,
    frame: 'foil',
    foil: '#ffcf5a',
    ring: '#ffc94a',
    corners: '#ffc53d',
    clasp: '#ffc53d',
    gems: '#ff2e4a',
    vyaz: '#ffd98a',
    pages: '#f3ead2',
    edge: '#ffc53d',
  },
};
const T = TIERS[tier];

// Размеры книги (мир): ширина доски, высота, толщина доски и блока.
const W = 1;
const H = 1.36;
const BOARD = 0.055;
const BLOCK = 0.26;
const MEDAL_R = 0.28;
const MEDAL_Y = 0.02;

// ---------------------------------------------------------------- текстуры
/** Кожа: зерно, потёртости к краям, рамка тиснением или фольгой. */
function leatherTex(seed) {
  const N = 1024;
  const [c, g] = canvas(N, Math.round(N * (H / W)));
  const [cb, gb] = canvas(N, Math.round(N * (H / W)));
  const [cr, gr] = canvas(N, Math.round(N * (H / W)));
  const w = c.width;
  const h = c.height;
  const r = rng(seed);
  const base = new THREE.Color(T.leather);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, w, h);
  gb.fillStyle = '#808080';
  gb.fillRect(0, 0, w, h);
  gr.fillStyle = '#9a9a9a';
  gr.fillRect(0, 0, w, h);
  // Зерно кожи: тысячи мелких пор.
  for (let i = 0; i < 26000; i++) {
    const x = r() * w;
    const y = r() * h;
    const s = 0.6 + r() * 1.8;
    const d = r() < 0.5;
    g.fillStyle = d ? `rgba(0,0,0,${T.grain * r()})` : `rgba(255,235,210,${T.grain * 0.35 * r()})`;
    g.fillRect(x, y, s, s);
    gb.fillStyle = d ? 'rgba(40,40,40,.5)' : 'rgba(200,200,200,.35)';
    gb.fillRect(x, y, s, s);
  }
  // Складки и потёртости: мягкие пятна светлее к краям.
  for (let i = 0; i < 40; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 30 + r() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.55;
    grd.addColorStop(0, dark ? 'rgba(0,0,0,.14)' : 'rgba(255,230,200,.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Потёртый край: светлее у кромки доски.
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,.25)');
  edge.addColorStop(0.06, 'rgba(0,0,0,0)');
  edge.addColorStop(0.94, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(255,220,180,.10)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);

  // Рамка: двойная линия по периметру и ромбы в углах.
  const m = w * 0.09;
  const m2 = w * 0.125;
  const drawFrame = (ctx, col, lw) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.lineWidth = lw * 0.6;
    ctx.strokeRect(m2, m2, w - 2 * m2, h - 2 * m2);
    for (const [x, y] of [
      [m2, m2],
      [w - m2, m2],
      [m2, h - m2],
      [w - m2, h - m2],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 26);
      ctx.lineTo(x + 26, y);
      ctx.lineTo(x, y + 26);
      ctx.lineTo(x - 26, y);
      ctx.closePath();
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();
    }
    // Лучи от медальона к рамке — вверх и вниз.
    const cx = w / 2;
    const cy = h / 2 - (MEDAL_Y / H) * h;
    const rr = (MEDAL_R / W) * w * 1.18;
    ctx.lineWidth = lw * 0.6;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dir * rr);
      ctx.lineTo(cx, dir < 0 ? m2 : h - m2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (T.frame === 'emboss') {
    // Тиснение: тёмная вдавленная линия и светлая кромка под ней.
    g.save();
    g.translate(1.5, 2);
    drawFrame(g, 'rgba(255,225,190,.16)', 7);
    g.restore();
    drawFrame(g, 'rgba(20,8,2,.45)', 7);
    drawFrame(gb, '#303030', 9);
  } else {
    drawFrame(g, T.foil, 7);
    drawFrame(gb, '#d8d8d8', 9);
    drawFrame(gr, '#303030', 9);
  }
  // Вязь легендарной: узор из завитков, светится.
  let emissive = null;
  if (T.vyaz) {
    const [ce, ge] = canvas(w, h);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, w, h);
    ge.strokeStyle = T.vyaz;
    ge.lineCap = 'round';
    const rr = rng(seed + 7);
    const curl = (x, y, s, a0) => {
      ge.beginPath();
      for (let k = 0; k < 40; k++) {
        const t = k / 39;
        const a = a0 + t * Math.PI * 2.2;
        const rad = s * (1 - t * 0.8);
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (k) ge.lineTo(px, py);
        else ge.moveTo(px, py);
      }
      ge.stroke();
    };
    ge.lineWidth = 4;
    const m3 = w * 0.155;
    for (let i = 0; i < 16; i++) {
      const side = i % 4;
      const t = 0.15 + ((i >> 2) / 3) * 0.7;
      const x = side === 0 ? m3 : side === 1 ? w - m3 : m3 + t * (w - 2 * m3);
      const y = side === 2 ? m3 : side === 3 ? h - m3 : m3 + t * (h - 2 * m3);
      curl(x, y, 20 + rr() * 10, rr() * Math.PI * 2);
    }
    emissive = tex(ce);
    // В цвете тоже: тонкая золотая вязь видна и без свечения. Чёрный фон
    // холста свечения при сложении ничего не добавляет.
    g.globalCompositeOperation = 'lighter';
    g.drawImage(ce, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return { map: tex(c), bump: tex(cb, false), rough: tex(cr, false), emissive };
}

/** Обрез страниц: тонкие полоски листов, у дорогих — золочение. */
function pagesTex(seed, across) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  const base = new THREE.Color(T.edge ?? T.pages);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 2 + Math.floor(r() * 3)) {
    g.fillStyle = `rgba(${T.edge ? '90,60,10' : '80,60,30'},${0.05 + r() * 0.22})`;
    if (across) g.fillRect(i, 0, 1, 512);
    else g.fillRect(0, i, 512, 1);
  }
  return tex(c);
}

// ---------------------------------------------------------------- материалы
const metal = (color, rough = 0.28) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: 0.3 });
const gem = (color) => {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.08,
    clearcoat: 0.4,
    ior: 1.8,
    emissive: c.clone().multiplyScalar(0.25),
    flatShading: true,
  });
};

// ---------------------------------------------------------------- модель
function build() {
  const g = new THREE.Group();
  const lt = leatherTex(11 + tier.length);
  const leather = new THREE.MeshPhysicalMaterial({
    map: lt.map,
    bumpMap: lt.bump,
    bumpScale: 1.6,
    roughnessMap: lt.rough,
    roughness: 0.62,
    sheen: 0.15,
    sheenColor: new THREE.Color('#ffe2c4'),
    sheenRoughness: 0.6,
    clearcoat: tier === 'legend' ? 0.35 : 0.12,
    clearcoatRoughness: 0.4,
    emissiveMap: lt.emissive ?? null,
    emissive: lt.emissive ? new THREE.Color('#ffb640') : new THREE.Color('#000'),
    emissiveIntensity: lt.emissive ? 0.9 : 0,
  });
  const plain = new THREE.MeshPhysicalMaterial({
    color: T.leather,
    roughness: 0.65,
    sheen: 0.12,
    sheenColor: new THREE.Color('#ffe2c4'),
  });
  // Доска: грань +z — обложка с текстурой, остальные — кожа без рисунка.
  const boardGeo = new RoundedBoxGeometry(W, H, BOARD, 4, 0.018);
  const front = new THREE.Mesh(boardGeo, [plain, plain, plain, plain, leather, plain]);
  front.position.z = BLOCK / 2 + BOARD / 2;
  g.add(front);
  const back = new THREE.Mesh(boardGeo, plain);
  back.position.z = -BLOCK / 2 - BOARD / 2;
  g.add(back);

  // Блок страниц чуть утоплен от краёв досок.
  const pageSide = new THREE.MeshPhysicalMaterial({ map: pagesTex(3, false), roughness: T.edge ? 0.35 : 0.85, metalness: T.edge ? 0.55 : 0 });
  const pageTop = new THREE.MeshPhysicalMaterial({ map: pagesTex(4, true), roughness: T.edge ? 0.35 : 0.85, metalness: T.edge ? 0.55 : 0 });
  const blockGeo = new THREE.BoxGeometry(W - 0.05, H - 0.05, BLOCK);
  // +x — обрез справа, ±y — верх и низ.
  const block = new THREE.Mesh(blockGeo, [pageSide, pageSide, pageTop, pageTop, pageSide, pageSide]);
  block.position.x = 0.01;
  g.add(block);

  // Корешок слева: полуцилиндр кожи.
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry((BLOCK + 2 * BOARD) / 2, (BLOCK + 2 * BOARD) / 2, H, 32, 1, false, Math.PI, Math.PI),
    plain,
  );
  spine.position.x = -W / 2;
  g.add(spine);
  // Бинты на корешке.
  for (const y of [-0.38, -0.13, 0.13, 0.38]) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry((BLOCK + 2 * BOARD) / 2 + 0.004, 0.012, 8, 32, Math.PI),
      plain,
    );
    band.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    band.position.set(-W / 2, y * H, 0);
    g.add(band);
  }

  // Медальон: кольцо и тёмный утопленный диск (знак кладёт страница).
  const zf = BLOCK / 2 + BOARD;
  const ringMat = metal(T.ring, tier === 'simple' ? 0.45 : 0.22);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(MEDAL_R, 0.032, 20, 96), ringMat);
  ring.position.set(0, MEDAL_Y, zf + 0.012);
  g.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(MEDAL_R - 0.01, MEDAL_R - 0.01, 0.01, 96),
    new THREE.MeshPhysicalMaterial({ color: '#1a0f08', roughness: 0.55, clearcoat: 0.3 }),
  );
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0, MEDAL_Y, zf + 0.002);
  g.add(disc);
  // Шипы-лучи кольца у эпической и легендарной.
  if (tier === 'epic' || tier === 'legend') {
    const n = tier === 'legend' ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.075, 4), ringMat);
      spike.position.set(Math.cos(a) * (MEDAL_R + 0.055), MEDAL_Y + Math.sin(a) * (MEDAL_R + 0.055), zf + 0.012);
      spike.rotation.z = a - Math.PI / 2;
      g.add(spike);
    }
  }

  // Уголки: литые накладки на четырёх углах обложки.
  if (T.corners) {
    const cm = metal(T.corners, 0.24);
    const s = 0.2;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(s, 0);
    shape.quadraticCurveTo(s * 0.45, s * 0.45, 0, s);
    shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.014,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 3,
    });
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const c = new THREE.Mesh(geo, cm);
      c.scale.set(-sx, -sy, 1);
      c.position.set((sx * W) / 2 - sx * 0.004, (sy * H) / 2 - sy * 0.004, zf - 0.004);
      g.add(c);
      if (T.gems) {
        const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), gem(T.gems));
        gm.scale.z = 0.5;
        gm.position.set((sx * W) / 2 - sx * 0.07, (sy * H) / 2 - sy * 0.07, zf + 0.022);
        g.add(gm);
      }
    }
  }

  // Застёжка: ремень через обрез справа и пряжка на обложке.
  if (T.clasp) {
    const strapMat = new THREE.MeshPhysicalMaterial({ color: T.leather, roughness: 0.6, sheen: 0.3 });
    const strapW = 0.16;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.12, strapW, 0.012), strapMat);
    strap.position.set(W / 2 - 0.05, MEDAL_Y, zf + 0.006);
    g.add(strap);
    const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.012, strapW, BLOCK + 2 * BOARD + 0.02), strapMat);
    wrap.position.set(W / 2 + 0.006, MEDAL_Y, 0);
    g.add(wrap);
    const cm = metal(T.clasp, 0.2);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.1, strapW + 0.05, 0.03, 3, 0.012), cm);
    plate.position.set(W / 2 - 0.11, MEDAL_Y, zf + 0.02);
    g.add(plate);
    if (T.gems) {
      const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.038, 0), gem(T.gems));
      gm.scale.z = 0.55;
      gm.position.set(W / 2 - 0.11, MEDAL_Y, zf + 0.045);
      g.add(gm);
    }
  }
  // Закладка-ляссе снизу.
  const ribbon = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.2, 0.006),
    new THREE.MeshPhysicalMaterial({ color: tier === 'simple' ? '#8a1c1c' : T.corners ?? '#8a1c1c', roughness: 0.5, sheen: 0.8, sheenColor: new THREE.Color('#fff') }),
  );
  ribbon.position.set(0.18, -H / 2 - 0.07, 0.05);
  ribbon.rotation.z = 0.12;
  g.add(ribbon);
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

const book = build();
const holder = new THREE.Group();
holder.add(book);
// Почти анфас: обрез страниц справа и сверху виден, медальон — круг.
book.rotation.set(0.16, -0.36, 0.035);
scene.add(holder);

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
// Кадр общий для всех ярусов — по габаритам простой книги с запасом,
// иначе медальон легендарной (с застёжкой) съезжал бы относительно
// остальных, а знак чары кладётся на одно и то же место.
const span = 1.72;
const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(22 / 2));
camera.position.set(0, 0, dist);
camera.lookAt(0, 0, 0);
holder.position.set(0.04, 0.0, 0);
holder.updateMatrixWorld(true);

renderer.render(scene, camera);
// Где на картинке центр медальона и его радиус — для CSS.
const center = new THREE.Vector3(0, MEDAL_Y, BLOCK / 2 + BOARD + 0.01).applyMatrix4(book.matrixWorld).project(camera);
const edge = new THREE.Vector3(MEDAL_R - 0.03, MEDAL_Y, BLOCK / 2 + BOARD + 0.01).applyMatrix4(book.matrixWorld).project(camera);
window.medal = {
  x: (center.x + 1) / 2,
  y: (1 - center.y) / 2,
  r: Math.hypot(edge.x - center.x, edge.y - center.y) / 2,
};
window.bookPNG = renderer.domElement.toDataURL('image/png');
window.done = true;
