// Живая запись боя с боссом (v2.85, библия §14): креативом на этаж, герой
// к боссу, кадры канвы вокруг босса ~30 раз в секунду → лист и mp4.
//
//   PORT=5201 FLOOR=1 SECS=8 OUT=/путь/папка node scripts/dungeon/boss-live.mjs
//
// Переменные:
//   FLOOR   — этаж (1–15);
//   SECS    — сколько секунд писать (по умолчанию 8);
//   OUT     — папка для кадров, листа (sheet.png) и ролика (live.mp4);
//   HP      — доля здоровья босса перед записью (0.45 — вторая фаза и т. п.);
//   DY      — где встать герою: клеток ниже места босса (по умолчанию 4);
//   ATTACK  — 1: герой бьёт (J раз в 0,6 с), чтобы босс получал удары;
//   DMGK    — множитель урона героя (0.05 — босс не умрёт за запись);
//   WAIT    — секунд подождать после начала боя, прежде чем писать (2);
//   SETUP   — строка JS, выполняется на странице перед записью (есть `s` —
//             симуляция, `b` — моб босса);
//   CROP    — сторона окна записи в точках CSS (по умолчанию 300);
//   EVERY   — писать каждый N-й кадр рендера (по умолчанию 2 → ~30 к/с).
// Бессмертие креатива держит героя живым. Кадры — PNG в OUT/frames,
// лист — каждый 3-й кадр, ролик — все кадры с настоящей частотой записи.
// Playwright в проект не входит: если его нет рядом, путь к модулю —
// в PLAYWRIGHT_MODULE (…/node_modules/playwright/index.mjs).
const { chromium } = await import('playwright').catch(() => {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('нет playwright: задайте PLAYWRIGHT_MODULE');
  return import(process.env.PLAYWRIGHT_MODULE);
});
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const port = process.env.PORT ?? 5201;
const floor = Number(process.env.FLOOR ?? 1);
const secs = Number(process.env.SECS ?? 8);
const out = process.env.OUT ?? `/tmp/boss-live-f${floor}`;
const crop = Number(process.env.CROP ?? 300);
const every = Number(process.env.EVERY ?? 2);
fs.mkdirSync(out + '/frames', { recursive: true });
for (const f of fs.readdirSync(out + '/frames')) fs.unlinkSync(out + '/frames/' + f);

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
await p.waitForTimeout(1500);
// Вкладка этажа — по точному номеру: «1» не должна поймать «15».
await p.evaluate((n) => {
  const tab = [...document.querySelectorAll('.dgl-floor')].find(
    (el) => el.querySelector('b')?.textContent?.trim() === String(n),
  );
  if (!tab) throw new Error('нет вкладки этажа ' + n);
  tab.click();
}, floor);
await p.waitForTimeout(400);
await p.getByText('Спуститься').click();
await p.waitForTimeout(4000);
await p.evaluate(
  (dy) => {
    const s = window.__dg;
    const k = s.world.objs.find((o) => o.kind === 'boss');
    s.hero.x = k.x + 0.5;
    s.hero.y = k.y + dy;
    s.hero.inv = 2;
  },
  Number(process.env.DY ?? 4),
);
// Ждём начала боя.
for (let i = 0; i < 40; i++) {
  const st = await p.evaluate(() => window.__dg.boss?.state);
  if (st === 'fight') break;
  await p.waitForTimeout(250);
}
if (process.env.HP)
  await p.evaluate((k) => {
    const s = window.__dg;
    for (const m of s.mobs) if (s.boss && m.kind === s.boss.def.mob) m.hp = m.maxHp * k;
  }, Number(process.env.HP));
await p.waitForTimeout(Number(process.env.WAIT ?? 2) * 1000);
if (process.env.DMGK)
  await p.evaluate((k) => {
    window.__dg.stats.dmg *= k;
  }, Number(process.env.DMGK));
if (process.env.SETUP)
  await p.evaluate((code) => {
    const s = window.__dg;
    const b = s.mobs.find((m) => s.boss && m.kind === s.boss.def.mob);
    new Function('s', 'b', code)(s, b);
  }, process.env.SETUP);

let attack = null;
if (process.env.ATTACK === '1')
  attack = setInterval(() => {
    p.keyboard.press('j').catch(() => {});
  }, 600);

// Запись: после каждого кадра рендера — окно вокруг босса (или героя) в
// память, потом в PNG. Так кадры идут с настоящей частотой игры.
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
    let last = null;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        if (now - t0 > secs * 1000) return done();
        if (n++ % every === 0) {
          // Босс убит — окно остаётся на его последнем месте: сцена смерти
          // (\`linger\`) доигрывает там же.
          const live = s.mobs.find((m) => s.boss && m.kind === s.boss.def.mob);
          if (live) last = { x: live.x, y: live.y };
          const bm = live ?? last ?? s.hero;
          const c = r.toScreen(bm.x, bm.y);
          const x = Math.round(c.x * dpr - side / 2);
          const y = Math.round(c.y * dpr - side * 0.62);
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
for (let i = 0; i < meta.count; i++) {
  const url = await p.evaluate((i) => window.__shots[i].toDataURL('image/png'), i);
  fs.writeFileSync(
    `${out}/frames/${String(i).padStart(4, '0')}.png`,
    Buffer.from(url.split(',')[1], 'base64'),
  );
}
const fpsRec = meta.count / (meta.times[meta.times.length - 1] / 1000 || 1);
// Лист: каждый 3-й кадр, 8 в строке, уменьшенные.
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
console.log(
  JSON.stringify({
    frames: meta.count,
    fps: +fpsRec.toFixed(1),
    boss: await p.evaluate(() => ({
      phase: window.__dg.boss?.phase,
      state: window.__dg.boss?.state,
    })),
    out,
  }),
);
if (errs.length) console.log(errs.slice(0, 8).join('\n'));
await b.close();
