// Живая запись и замер толпы мобов этажа (анимации мобов, v2.98): креативом
// на этаж, герой на открытое место, вокруг — мобы кольцом; кадры канвы
// вокруг героя → лист и mp4, или (MEASURE=1) только цена кадра рендера.
//
//   PORT=5201 FLOOR=1 MOBS=f1_ratman:4,rat:8 SECS=8 OUT=/путь node scripts/dungeon/mob-live.mjs
//
// Переменные:
//   FLOOR   — этаж (1–15);
//   MOBS    — какие мобы и сколько: «вид:число,вид:число» (id из MOBS этажа);
//   ELITE   — 1: все поставленные мобы — элита;
//   RING    — радиус кольца, клеток (3,5);
//   AT      — «x,y»: где встать герою; без него — ближайшее к лифту открытое
//             место (круг RING+1 без стен) не ближе FAR клеток (8): у лифта
//             решётка клети мешает смотреть;
//   CLEAR   — 1 (по умолчанию): убрать чужих мобов в 14 клетках перед записью;
//   SECS    — сколько секунд писать или мерить (8);
//   WAIT    — секунд подождать после расстановки (2; для замера — 6 и больше,
//             чтобы прогрев и кеш кадров успели);
//   ATTACK  — 1: герой бьёт (J раз в 0,6 с);
//   DMGK    — множитель урона героя (0.05 — никто не умрёт за запись; 5 —
//             записать смерти);
//   SETUP   — строка JS перед записью (есть `s` — симуляция, `ms` — свои
//             мобы, `D` — модуль dungeon-sim);
//   MEASURE — 1: не писать кадры, а мерить `frame` рендера: p50/p90/p95/p99,
//             max, среднее (мс) и сколько мобов было в кадре;
//   CROP    — сторона окна записи в точках CSS (300), EVERY — каждый N-й
//             кадр (2 → ~30 к/с).
// Бессмертие креатива держит героя живым. Playwright — как у boss-live.mjs
// (PLAYWRIGHT_MODULE).
const { chromium } = await import('playwright').catch(() => {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('нет playwright: задайте PLAYWRIGHT_MODULE');
  return import(process.env.PLAYWRIGHT_MODULE);
});
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const port = process.env.PORT ?? 5201;
const floor = Number(process.env.FLOOR ?? 1);
const secs = Number(process.env.SECS ?? 8);
const measure = process.env.MEASURE === '1';
const out = process.env.OUT ?? `/tmp/mob-live-f${floor}`;
const crop = Number(process.env.CROP ?? 300);
const every = Number(process.env.EVERY ?? 2);
const mobs = (process.env.MOBS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [kind, n] = s.split(':');
    return { kind, n: Number(n ?? 1) };
  });
if (!mobs.length) throw new Error('MOBS пуст: «вид:число,вид:число»');
if (!measure) {
  fs.mkdirSync(out + '/frames', { recursive: true });
  for (const f of fs.readdirSync(out + '/frames')) fs.unlinkSync(out + '/frames/' + f);
}

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR ' + e.stack));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text());
});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:${port}/#/yard`, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.evaluate(async () => {
  const S = await import('/src/store.ts');
  const st = S.useFinanceStore.getState();
  S.useFinanceStore.setState({
    prison: { ...st.prison, rank: 8, pick: 3, pickMax: 3 },
    dungeon: { ...st.dungeon, intro: true },
  });
  await S.useFinanceStore.getState().creativeEnter();
  S.useFinanceStore.getState().creativeDungeonSet({ tier: 8, plus: 5 });
});
await p.goto(`http://127.0.0.1:${port}/#/dungeon`);
await p.waitForSelector('.dgl-floor', { timeout: 120000 });
await p.waitForTimeout(500);
await p.evaluate((n) => {
  const tab = [...document.querySelectorAll('.dgl-floor')].find(
    (el) => el.querySelector('b')?.textContent?.trim() === String(n),
  );
  if (!tab) throw new Error('нет вкладки этажа ' + n);
  tab.click();
}, floor);
await p.waitForTimeout(400);
await p.getByText('Спуститься').click();
await p.waitForFunction(() => window.__dg?.world && window.__dg.floor !== undefined, null, {
  timeout: 120000,
});
await p.waitForTimeout(1500);

// Расстановка: открытое место, чужих мобов прочь, свои — кольцом.
const placed = await p.evaluate(
  async ({ mobs, ring, at, clear, elite, far }) => {
    const s = window.__dg;
    const D = await import('/src/lib/dungeon-sim.ts');
    const h = s.hero;
    const open = (cx, cy, r) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          if (D.solidTile(s, Math.floor(cx + dx), Math.floor(cy + dy))) return false;
        }
      return true;
    };
    let spot = at;
    if (!spot) {
      const R = Math.ceil(ring + 1);
      for (let d = far; d < far + 60 && !spot; d++)
        for (let k = 0; k < Math.max(1, d * 8) && !spot; k++) {
          const a = (k / Math.max(1, d * 8)) * Math.PI * 2;
          const x = Math.floor(h.x + Math.cos(a) * d) + 0.5;
          const y = Math.floor(h.y + Math.sin(a) * d) + 0.5;
          if (open(x, y, R)) spot = { x, y };
        }
    }
    if (!spot) throw new Error('нет открытого места: задайте AT');
    h.x = spot.x;
    h.y = spot.y;
    h.inv = 2;
    if (clear)
      for (let i = s.mobs.length - 1; i >= 0; i--) {
        const m = s.mobs[i];
        if (Math.hypot(m.x - h.x, m.y - h.y) < 14) s.mobs.splice(i, 1);
      }
    const total = mobs.reduce((a, m) => a + m.n, 0);
    const ms = [];
    let i = 0;
    for (const { kind, n } of mobs)
      for (let j = 0; j < n; j++, i++) {
        const a = (i / total) * Math.PI * 2;
        const rr = ring * (i % 2 ? 0.75 : 1);
        ms.push(D.spawnMob(s, kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, { elite }));
      }
    window.__mobLive = { ms, D };
    return { hero: spot, n: ms.length };
  },
  {
    mobs,
    ring: Number(process.env.RING ?? 3.5),
    at: process.env.AT ? (([x, y]) => ({ x, y }))(process.env.AT.split(',').map(Number)) : null,
    clear: process.env.CLEAR !== '0',
    elite: process.env.ELITE === '1',
    far: Number(process.env.FAR ?? 8),
  },
);
await p.waitForTimeout(Number(process.env.WAIT ?? 2) * 1000);
if (process.env.DMGK)
  await p.evaluate((k) => {
    window.__dg.stats.dmg *= k;
  }, Number(process.env.DMGK));
if (process.env.SETUP)
  await p.evaluate((code) => {
    const { ms, D } = window.__mobLive;
    new Function('s', 'ms', 'D', code)(window.__dg, ms, D);
  }, process.env.SETUP);

let attack = null;
if (process.env.ATTACK === '1')
  attack = setInterval(() => {
    p.keyboard.press('j').catch(() => {});
  }, 600);

if (measure) {
  const res = await p.evaluate(async (secs) => {
    const s = window.__dg;
    const r = window.__dgr;
    const ts = [];
    let near = 0;
    const orig = r.frame;
    r.frame = function (...a) {
      const t0 = performance.now();
      const v = orig.apply(this, a);
      ts.push(performance.now() - t0);
      for (const m of s.mobs) if (Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 9) near++;
      return v;
    };
    await new Promise((d) => setTimeout(d, secs * 1000));
    r.frame = orig;
    ts.sort((a, b) => a - b);
    const q = (k) => +ts[Math.min(ts.length - 1, Math.floor(ts.length * k))].toFixed(2);
    return {
      n: ts.length,
      p50: q(0.5),
      p90: q(0.9),
      p95: q(0.95),
      p99: q(0.99),
      max: +ts[ts.length - 1].toFixed(2),
      mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2),
      mobsNear: +(near / ts.length).toFixed(1),
    };
  }, secs);
  if (attack) clearInterval(attack);
  console.log(JSON.stringify({ ...res, placed }));
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
  await b.close();
  process.exit(0);
}

const meta = await p.evaluate(
  async ({ secs, crop, every }) => {
    const s = window.__dg;
    const r = window.__dgr;
    const view = document.querySelector('canvas');
    const dpr = view.width / view.getBoundingClientRect().width;
    const side = Math.round(crop * dpr);
    const shots = [];
    const times = [];
    const t0 = performance.now();
    let n = 0;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        if (now - t0 > secs * 1000) return done();
        if (n++ % every === 0) {
          const c = r.toScreen(s.hero.x, s.hero.y);
          const x = Math.round(c.x * dpr - side / 2);
          const y = Math.round(c.y * dpr - side / 2);
          const cv = document.createElement('canvas');
          cv.width = side;
          cv.height = side;
          cv.getContext('2d').drawImage(view, x, y, side, side, 0, 0, side, side);
          shots.push(cv);
          times.push(now - t0);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    window.__shots = shots;
    return { count: shots.length, times };
  },
  { secs, crop, every },
);
if (attack) clearInterval(attack);
await p.screenshot({ path: `${out}/page.png` });
for (let i = 0; i < meta.count; i++) {
  const url = await p.evaluate((i) => window.__shots[i].toDataURL('image/png'), i);
  fs.writeFileSync(
    `${out}/frames/${String(i).padStart(4, '0')}.png`,
    Buffer.from(url.split(',')[1], 'base64'),
  );
}
const fpsRec = meta.count / (meta.times[meta.times.length - 1] / 1000 || 1);
const sheet = await p.evaluate(
  ({ count }) => {
    const shots = window.__shots;
    const pick = [];
    for (let i = 0; i < count; i += 3) pick.push(shots[i]);
    const cols = 8;
    const w = 180;
    const rows = Math.ceil(pick.length / cols);
    const o = document.createElement('canvas');
    o.width = cols * w;
    o.height = rows * w;
    const g = o.getContext('2d');
    pick.forEach((c, i) => g.drawImage(c, (i % cols) * w, Math.floor(i / cols) * w, w, w));
    return o.toDataURL('image/png');
  },
  { count: meta.count },
);
fs.writeFileSync(`${out}/sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));
try {
  const ff = execFileSync('python3', [
    '-c',
    'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
  ])
    .toString()
    .trim();
  execFileSync(ff, [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    fpsRec.toFixed(2),
    '-i',
    `${out}/frames/%04d.png`,
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '20',
    `${out}/live.mp4`,
  ]);
} catch (e) {
  errs.push('ffmpeg: ' + e.message);
}
console.log(JSON.stringify({ frames: meta.count, fps: +fpsRec.toFixed(1), placed, out }));
if (errs.length) console.log(errs.slice(0, 8).join('\n'));
await b.close();
