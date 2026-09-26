// Яйца питомцев (v2.72) — четыре вида, тот же конвейер, что книги и сундуки.
// Форма — тело вращения по профилю яйца (шире снизу); вид — материал:
// мшистое — кремовая скорлупа в крапе и пятнах мха, каменное — гранит со
// слоями и трещинами, кристальное — гранёный самоцвет с переливом,
// драконье — тёмная чешуя с золотой каймой и светящимися прожилками.
//
// Кадр и поза общие на все четыре: трещины при вылуплении рисует страница
// поверх картинки, в одних и тех же долях кадра (печатает run.mjs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = 1024;
const q = new URLSearchParams(location.search);
const kind = q.get('t') ?? 'moss';

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
  t.wrapS = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const hex = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- форма
// Профиль яйца: x — радиус на высоте y (−1…1), шире снизу.
const HALF = 1;
const WIDE = 0.74;
function eggProfile(n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    const y = -Math.cos(t) * HALF;
    const x = Math.sin(t) * WIDE * (1 - 0.16 * (y / HALF));
    pts.push(new THREE.Vector2(Math.max(1e-4, x), y));
  }
  return pts;
}

// Шум для пятен: сумма синусов с разными фазами — без швов по кругу (u).
function field(seed) {
  const r = rng(seed);
  const waves = Array.from({ length: 7 }, () => ({
    ku: 1 + Math.floor(r() * 5),
    kv: 1 + r() * 6,
    p: r() * 7,
    a: 0.4 + r(),
  }));
  return (u, v) =>
    waves.reduce((s, w) => s + w.a * Math.sin(w.ku * u * Math.PI * 2 + w.kv * v * 6 + w.p), 0) /
    waves.length;
}

// ---------------------------------------------------------------- виды
function mossMaps() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [b, bg] = canvas(W, H);
  const r = rng(11);
  g.fillStyle = '#efe4c9';
  g.fillRect(0, 0, W, H);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, W, H);
  // Тёплые разводы скорлупы.
  for (let i = 0; i < 50; i++) {
    g.fillStyle = `rgba(${180 + r() * 40},${150 + r() * 30},${100 + r() * 30},0.1)`;
    g.beginPath();
    g.ellipse(r() * W, r() * H, 30 + r() * 90, 20 + r() * 50, r() * 3, 0, 7);
    g.fill();
  }
  // Крап на скорлупе.
  for (let i = 0; i < 420; i++) {
    const s = 1 + r() * 3;
    g.fillStyle = `rgba(${100 + r() * 40},${70 + r() * 30},45,${0.35 + r() * 0.4})`;
    g.beginPath();
    g.arc(r() * W, r() * H * 0.75, s, 0, 7);
    g.fill();
  }
  // Мох — пушистые кочки из тысяч точек, гуще к низу: растёт от земли.
  // Шов по кругу (u) закрываем, рисуя кочку ещё раз со сдвигом на ширину.
  const clumps = [];
  for (let i = 0; i < 34; i++) {
    const v = 0.3 + Math.pow(r(), 0.6) * 0.7;
    clumps.push({ x: r() * W, y: v * H, rx: 40 + r() * 90, ry: 22 + r() * 40 });
  }
  clumps.push({ x: W * 0.3, y: H * 0.98, rx: W, ry: 50 });
  for (const k of clumps)
    for (let d = 0; d < 4200; d++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * 0.45;
      if (rr > 1.1) continue;
      const x = k.x + Math.cos(a) * rr * k.rx;
      const y = k.y + Math.sin(a) * rr * k.ry;
      const shade = 0.55 + r() * 0.6 - rr * 0.2;
      const col = `rgb(${Math.round(58 * shade)},${Math.round(120 * shade)},${Math.round(40 * shade)})`;
      const s = 0.8 + r() * 1.8;
      for (const dx of [-W, 0, W]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x + dx, y, s, 0, 7);
        g.fill();
        bg.fillStyle = `rgb(${160 + r() * 90},${160 + r() * 90},${160 + r() * 90})`;
        bg.beginPath();
        bg.arc(x + dx, y, s, 0, 7);
        bg.fill();
      }
    }
  // Светлые кончики мха — поверх, реже.
  for (const k of clumps)
    for (let d = 0; d < 260; d++) {
      const x = k.x + (r() - 0.5) * k.rx * 1.3;
      const y = k.y + (r() - 0.5) * k.ry * 1.3;
      g.fillStyle = `rgba(160,205,90,${0.5 + r() * 0.4})`;
      for (const dx of [-W, 0, W]) {
        g.beginPath();
        g.arc(x + dx, y, 1 + r() * 1.4, 0, 7);
        g.fill();
      }
    }
  return { map: tex(c), bump: tex(b, false) };
}

function stoneMaps() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [b, bg] = canvas(W, H);
  const r = rng(23);
  const f = field(9);
  const img = g.createImageData(W, H);
  const bimg = bg.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y / H;
      // Слои породы — полосами по высоте, с изгибом от шума.
      const band = Math.sin((v + f(x / W, v) * 0.12) * 16) * 0.5 + 0.5;
      const grain = r();
      let base = 104 + band * 18 + (grain - 0.5) * 40;
      let pink = 0;
      if (grain > 0.975)
        base += 70; // светлые зёрна кварца
      else if (grain > 0.93) pink = 38; // розовый полевой шпат
      if (grain < 0.03) base -= 55; // тёмная слюда
      const i = (y * W + x) * 4;
      img.data[i] = base * 1.02 + pink;
      img.data[i + 1] = base * 0.97 + pink * 0.35;
      img.data[i + 2] = base * 0.92 + pink * 0.3;
      img.data[i + 3] = 255;
      const bh = 120 + band * 40 + (grain - 0.5) * 50;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = bh;
      bimg.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  bg.putImageData(bimg, 0, 0);
  // Трещины: ломаные, тёмные на цвете и впадиной на рельефе.
  for (let k = 0; k < 9; k++) {
    let x = r() * W;
    let y = r() * H;
    g.strokeStyle = 'rgba(40,36,34,0.8)';
    bg.strokeStyle = 'rgba(20,20,20,1)';
    g.lineWidth = bg.lineWidth = 1.5 + r() * 1.5;
    g.beginPath();
    bg.beginPath();
    g.moveTo(x, y);
    bg.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (r() - 0.5) * 60;
      y += 10 + r() * 26;
      g.lineTo(x, y);
      bg.lineTo(x, y);
    }
    g.stroke();
    bg.stroke();
  }
  // Пятна лишайника: рыжие и серо-зелёные.
  for (let i = 0; i < 26; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(200,140,60,0.35)' : 'rgba(150,170,120,0.35)';
    const cx = r() * W;
    const cy = r() * H;
    for (let d = 0; d < 14; d++) {
      g.beginPath();
      g.arc(cx + (r() - 0.5) * 30, cy + (r() - 0.5) * 18, 2 + r() * 6, 0, 7);
      g.fill();
    }
  }
  return { map: tex(c), bump: tex(b, false) };
}

function dragonMaps() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [b, bg] = canvas(W, H);
  const [e, eg] = canvas(W, H);
  const r = rng(41);
  g.fillStyle = '#3a0a14';
  g.fillRect(0, 0, W, H);
  bg.fillStyle = '#000';
  bg.fillRect(0, 0, W, H);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  // Чешуя: ряды полукругов внахлёст, каждый ряд сдвинут на полшага.
  const cols = 22;
  const rows = 17;
  const sw = W / cols;
  const sh = H / rows;
  for (let row = rows; row >= -1; row--)
    for (let col = -1; col <= cols; col++) {
      const x = col * sw + (row % 2 ? sw / 2 : 0);
      const y = row * sh;
      const v = row / rows;
      const grad = g.createRadialGradient(x, y + sh * 0.2, 2, x, y, sw * 0.62);
      const hi = v < 0.5 ? '#8a1c2a' : '#6a1420';
      grad.addColorStop(0, hi);
      grad.addColorStop(0.75, '#2a060e');
      grad.addColorStop(1, '#14030a');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, sw * 0.6, 0, Math.PI);
      g.fill();
      // Золотая кайма по нижнему краю чешуйки.
      g.strokeStyle = `rgba(230,170,70,${0.55 + r() * 0.3})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, sw * 0.58, 0.15, Math.PI - 0.15);
      g.stroke();
      // Рельеф: выпуклая чешуйка.
      const bgrad = bg.createRadialGradient(x, y + sh * 0.1, 1, x, y, sw * 0.6);
      bgrad.addColorStop(0, '#ddd');
      bgrad.addColorStop(1, '#222');
      bg.fillStyle = bgrad;
      bg.beginPath();
      bg.arc(x, y, sw * 0.6, 0, Math.PI);
      bg.fill();
    }
  // Светящиеся прожилки между чешуёй — только на карте свечения.
  for (let k = 0; k < 7; k++) {
    let x = r() * W;
    let y = H * (0.1 + r() * 0.3);
    eg.strokeStyle = '#ffb040';
    eg.lineWidth = 2.5;
    eg.shadowColor = '#ff8a20';
    eg.shadowBlur = 10;
    eg.beginPath();
    eg.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (r() - 0.5) * 50;
      y += 18 + r() * 22;
      eg.lineTo(x, y);
    }
    eg.stroke();
  }
  return { map: tex(c), bump: tex(b, false), emissive: tex(e) };
}

function build() {
  const g = new THREE.Group();
  let mesh;
  if (kind === 'crystal') {
    // Гранёный: мало сегментов и плоские грани — самоцвет, а не шар. У каждой
    // грани свой тон: так камень «играет», а не светится ровной лампой.
    const geo = new THREE.LatheGeometry(eggProfile(8), 9).toNonIndexed();
    const r = rng(77);
    const cols = [];
    const n = geo.attributes.position.count;
    for (let i = 0; i < n; i += 3) {
      const t = r();
      const col = hex('#8a7cff')
        .lerp(hex('#6fd6ff'), t * 0.8)
        .multiplyScalar(0.7 + r() * 0.5);
      for (let k = 0; k < 3; k++) cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      emissive: hex('#3a2cb0'),
      emissiveIntensity: 0.45,
      roughness: 0.1,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      iridescence: 0.6,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [250, 650],
      flatShading: true,
    });
    mesh = new THREE.Mesh(geo, mat);
  } else {
    const geo = new THREE.LatheGeometry(eggProfile(96), 128);
    if (kind === 'stone') {
      // Камень бугристый: вершины сдвинуты по нормали шумом — силуэт
      // неровный, как у валуна, а не у фарфора.
      geo.computeVertexNormals();
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const f = field(31);
      const f2 = field(47);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const u = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
        const v = (y + HALF) / (2 * HALF);
        const pole = Math.sin(v * Math.PI);
        const d = (f(u, v) * 0.035 + f2(u * 2, v * 2) * 0.02) * pole;
        pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
      }
      geo.computeVertexNormals();
    }
    const maps = kind === 'moss' ? mossMaps() : kind === 'stone' ? stoneMaps() : dragonMaps();
    const mat = new THREE.MeshPhysicalMaterial({
      map: maps.map,
      bumpMap: maps.bump,
      bumpScale: kind === 'stone' ? 3 : kind === 'dragon' ? 4 : 2.5,
      roughness: kind === 'moss' ? 0.78 : kind === 'stone' ? 0.9 : 0.42,
      metalness: kind === 'dragon' ? 0.15 : 0,
      clearcoat: kind === 'dragon' ? 0.7 : kind === 'moss' ? 0.1 : 0,
      clearcoatRoughness: 0.3,
      sheen: kind === 'moss' ? 0.5 : 0,
      sheenColor: hex('#9fd070'),
      emissiveMap: maps.emissive ?? null,
      emissive: maps.emissive ? hex('#ffffff') : hex('#000000'),
      emissiveIntensity: maps.emissive ? 1.6 : 0,
    });
    mesh = new THREE.Mesh(geo, mat);
    if (kind === 'stone') {
      // Друза аметиста проросла сквозь камень — намёк, что внутри не просто
      // камень.
      const am = new THREE.MeshPhysicalMaterial({
        color: hex('#a070ff'),
        emissive: hex('#6a30d0'),
        emissiveIntensity: 0.6,
        roughness: 0.15,
        metalness: 0.2,
        clearcoat: 1,
        flatShading: true,
      });
      const r = rng(5);
      // Доли оборота считаны так, чтобы после поворота яйца (0,6 рад) друза
      // смотрела в кадр: лицевая сторона — около 0,345.
      const spots = [
        [0.4, -0.34, 1.8],
        [0.29, 0.32, 1.2],
      ];
      for (const [a, y, k] of spots)
        for (let i = 0; i < 5; i++) {
          const cr = new THREE.Mesh(new THREE.ConeGeometry(0.06 * k, 0.26 * k, 6), am);
          const rad = WIDE * (1 - 0.16 * y) * Math.sqrt(1 - y * y) * 0.97;
          const ang = a * Math.PI * 2 + (r() - 0.5) * 0.25;
          const yy = y + (r() - 0.5) * 0.12;
          cr.position.set(Math.cos(ang) * rad, yy, Math.sin(ang) * rad);
          const out = new THREE.Vector3(Math.cos(ang), 1.1, Math.sin(ang)).normalize();
          cr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
          cr.rotateX((r() - 0.5) * 0.9);
          cr.rotateZ((r() - 0.5) * 0.9);
          cr.translateY(0.05 * k);
          g.add(cr);
        }
    }
  }
  g.add(mesh);
  return g;
}

// ---------------------------------------------------------------- сцена
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
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
scene.environmentIntensity = kind === 'crystal' ? 1 : 0.55;
const key = new THREE.DirectionalLight('#fff3e0', 2.3);
key.position.set(-3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(kind === 'dragon' ? '#ffb070' : '#bcd8ff', 1.8);
rim.position.set(4, 2, -3);
scene.add(rim);
const fill = new THREE.DirectionalLight('#ffffff', 0.45);
fill.position.set(2, -3, 4);
scene.add(fill);
scene.add(new THREE.AmbientLight('#ffffff', 0.25));

const egg = build();
const holder = new THREE.Group();
holder.add(egg);
egg.rotation.set(0, 0.6, 0);
holder.rotation.x = 0.16;
scene.add(holder);

const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
const span = 2.5;
const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(22 / 2));
camera.position.set(0, 0, dist);
camera.lookAt(0, 0, 0);
holder.position.set(0, -0.02, 0);

renderer.render(scene, camera);
// Рамка яйца в долях кадра: по ней страница кладёт трещины и разлом.
holder.updateMatrixWorld(true);
const pr = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(holder.matrixWorld).project(camera);
const top = pr(0, HALF);
const bot = pr(0, -HALF);
const left = pr(-WIDE, -0.2);
const right = pr(WIDE, -0.2);
window.box = {
  top: (1 - top.y) / 2,
  bottom: (1 - bot.y) / 2,
  left: (left.x + 1) / 2,
  right: (right.x + 1) / 2,
};
window.eggPNG = renderer.domElement.toDataURL('image/png');
window.done = true;
