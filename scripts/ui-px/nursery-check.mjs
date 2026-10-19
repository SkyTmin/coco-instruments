// Nursery stand check (N4, 19.10.2026 — replaces the N3 check of the old `.nur-*` screen).
// Needs a running dev server (`npm run dev -- --port 5559`) and Playwright with Chromium.
//
//   node scripts/ui-px/nursery-check.mjs [p320,pp,p440,pl,tp,tl,d1,…]
//   env: PORT (5559), UILANG ru|de|tr…, TG=1 (Telegram insets: top 47, content top 46, bottom 34 —
//        then the TG targets apply), SHOT=dir (screenshots), PW (playwright module), CHROME.
//
// Fails (exit 1) when, on a format:
// - the stage pet (`.nrs-pet`) is below `TARGET` (`TARGET_TG` with TG=1);
// - the page scrolls, or a text box clips its text (overflow hidden, content wider / taller);
// - a framed block (`.pxd-f`) is longer than 2.5:1 (the CTA / «hatch all» 5:1);
// - a block moves between pets, between tabs (header, tabs; the card on wide screens) or on a
//   key press (the name ribbon may follow the name's width);
// - fewer collection cards than `CELLS` are fully visible on the collection tab.
import fs from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright');
const OUT = process.env.SHOT ? `${process.env.SHOT.replace(/\/$/, '')}/` : '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT || 5559;
const LANG = process.env.UILANG || 'ru';
const TG = !!process.env.TG;
const SIZES = {
  p320: [320, 568, 2],
  p360s: [360, 640, 3],
  p360: [360, 780, 3],
  pp: [390, 844, 3],
  p430: [430, 932, 3],
  p440: [440, 956, 3],
  pl: [844, 390, 3],
  pl440: [956, 440, 3],
  tp: [820, 1180, 2],
  tl: [1180, 820, 2],
  d1: [1440, 900, 1],
  d2: [1920, 1080, 1],
};
// N4 measured (no insets — the N3 table's conditions); never lower without the owner
const TARGET = {
  p320: 168,
  p360s: 224,
  p360: 298,
  pp: 336,
  p430: 373,
  p440: 373,
  pl: 261,
  pl440: 298,
  tp: 336,
  tl: 448,
  d1: 560,
  d2: 560,
};
// with Telegram's insets (the brief's acceptance: 390×844 ≥ 298.67, 440×956 ≥ 336)
const TARGET_TG = {
  p320: 112,
  p360s: 149,
  p360: 224,
  pp: 298,
  p430: 373,
  p440: 373,
  pl: 186,
  pl440: 224,
  tp: 280,
  tl: 392,
  d1: 448,
  d2: 448,
};
// collection cards fully visible on the collection tab («never below prod v2.152»: pp 10,
// p360 4, pl 12, tp 12, tl 10, d1 18, d2 12 — those counted the drawer / the wide list)
const CELLS = {
  p320: 6,
  p360s: 6,
  p360: 9,
  pp: 12,
  p430: 12,
  p440: 12,
  pl: 2,
  pl440: 2,
  tp: 5,
  tl: 9,
  d1: 9,
  d2: 9,
};
const fmts = (process.argv[2] || 'p320,pp,p440,pl,tp,tl,d1').split(',');

async function open(b, k) {
  const [w, h, dpr] = SIZES[k];
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: k[0] !== 'd',
    isMobile: k[0] === 'p',
  });
  await ctx.addInitScript((l) => localStorage.setItem('coco.lang', l), LANG);
  if (TG)
    await ctx.addInitScript(() => {
      const put = () => {
        const s = document.documentElement.style;
        s.setProperty('--tg-viewport-safe-area-inset-top', '47px');
        s.setProperty('--tg-viewport-content-safe-area-inset-top', '46px');
        s.setProperty('--tg-viewport-safe-area-inset-bottom', '34px');
      };
      if (document.documentElement) put();
      document.addEventListener('DOMContentLoaded', put);
    });
  await ctx.route(/eruda/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
  await p.goto(`http://127.0.0.1:${PORT}/#/prison`);
  await p.waitForSelector('.pmx-dock__pets', { timeout: 40000 });
  await p.waitForTimeout(800);
  // seed through the store module the page really uses (after HMR it is `store.ts?t=…`)
  await p.evaluate(async () => {
    const live = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\/src\/store\.ts(\?|$)/.test(n))
      .pop();
    const S = await import(live || '/src/store.ts');
    const pr = S.useFinanceStore.getState().prison;
    const pets = {};
    [
      'mole',
      'mouse',
      'pigeon',
      'cat',
      'bulldog',
      'ferret',
      'owl',
      'raccoon',
      'spider',
      'fox',
      'scarab',
    ].forEach((id, i) => (pets[id] = { xp: 2000 + i * 3000, v: 0, dup: i % 3, pat: 0 }));
    pets.spider = { xp: 0, v: 0, dup: 0, pat: 0 };
    pets.fox = { xp: 90000, v: 1, dup: 0, pat: 0 };
    S.useFinanceStore.setState({
      slotsBalance: 99_400_000,
      prison: {
        ...pr,
        rank: 9,
        prestige: 0,
        tokens: 965,
        pets,
        squad: ['spider', 'fox'],
        nest: [
          { egg: 'moss', left: 4000 },
          { egg: 'moss', left: 1200 },
        ],
        eggs: { moss: 1, stone: 0, crystal: 0, dragon: 1 },
        eggHeat: { moss: 1500, stone: 0, crystal: 0, dragon: 0 },
      },
    });
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('.pmx-dock__pets')?.closest('button')?.click());
  await p.waitForSelector('.nrs', { timeout: 10000 });
  await p.waitForTimeout(1200);
  return { ctx, p };
}

const BLOCKS = {
  top: '.nrs-top',
  tabs: '.nrs-tabs',
  stage: '.nrs-stage',
  pet: '.nrs-pet',
  marks: '.nrs-marks',
  stats: '.nrs-stats',
  bar: '.nrs-bar',
  cta: '.nrs-cta',
  slots: '.nrs-slots',
  sum: '.nrs-sum',
  grid: '.nrs-grid',
  tools: '.nrs-tools',
};
const grab = (sel) => {
  const o = {};
  for (const [k, s] of Object.entries(sel)) {
    const e = document.querySelector(s);
    if (!e) continue;
    const r = e.getBoundingClientRect();
    o[k] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  }
  return o;
};
const moved = (a, b) =>
  Object.keys(a)
    .filter((k) => b[k] && a[k].some((v, i) => Math.abs(v - b[k][i]) > 0.05))
    .map((k) => `${k} ${a[k].join(',')} → ${b[k].join(',')}`);
// page scroll, clipped text, long framed blocks, visible cards
const audit = () => {
  const cut = [];
  for (const e of document.querySelectorAll('.nrs *')) {
    if (e.closest('.nrs-grid') && !e.closest('.nrs-card')) continue;
    const cs = getComputedStyle(e);
    if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
    if (!e.textContent?.trim() || e.matches('.pet, .pet *, .pxs, .pxs *, .nrs-grid')) continue;
    if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      cut.push(
        `${e.className}: «${e.textContent.trim().slice(0, 24)}» ${e.scrollWidth}/${e.clientWidth}×${e.scrollHeight}/${e.clientHeight}`,
      );
  }
  const long = [];
  for (const e of document.querySelectorAll('.nrs .pxd-f')) {
    const q = e.getBoundingClientRect();
    if (q.width < 2 || q.height < 2) continue;
    const a = Math.max(q.width / q.height, q.height / q.width);
    if (a > (e.matches('.nrs-cta, .nrs-all') ? 5 : 2.5) + 0.01)
      long.push(`${e.className} ${Math.round(q.width)}×${Math.round(q.height)}`);
  }
  const g = document.querySelector('.nrs-grid')?.getBoundingClientRect();
  const cards = g
    ? [...document.querySelectorAll('.nrs-card')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5;
      }).length
    : -1;
  return {
    scroll: document.scrollingElement.scrollHeight - innerHeight,
    cut,
    long,
    cards,
    pet: document.querySelector('.nrs-pet')?.getBoundingClientRect().width ?? 0,
  };
};

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fail = 0;
const bad = (k, msg) => {
  fail++;
  console.log(`  FAIL ${k}: ${msg}`);
};
for (const k of fmts) {
  const { ctx, p } = await open(b, k);
  const tab = async (i) => {
    await p.locator('.nrs-tabs [role=tab]').nth(i).click();
    await p.waitForTimeout(500);
  };
  const one = await p.evaluate(() => !!document.querySelector('.nrs--one'));
  const res = {};
  for (const [i, name] of ['squad', 'coll', 'eggs'].entries()) {
    await tab(i);
    if (OUT) await p.screenshot({ path: `${OUT}${k}-${name}-${LANG}.png`, scale: 'css' });
    res[name] = await p.evaluate(audit);
  }
  const want = (TG ? TARGET_TG : TARGET)[k];
  const pet = Math.round(res.squad.pet * 100) / 100;
  console.log(`${k}: pet ${pet} (≥ ${want}), cards ${res.coll.cards} (≥ ${CELLS[k]})`);
  if (pet + 0.5 < want) bad(k, `pet ${pet} < ${want}`);
  if (res.coll.cards < CELLS[k]) bad(k, `cards ${res.coll.cards} < ${CELLS[k]}`);
  for (const [name, r] of Object.entries(res)) {
    if (r.scroll > 0) bad(k, `${name}: page scrolls ${r.scroll}`);
    for (const c of r.cut) bad(k, `${name}: clipped ${c}`);
    for (const l of r.long) bad(k, `${name}: long block ${l}`);
  }
  // pets: the card keeps every box (picked from the collection; phones go back to the squad tab)
  let base = null;
  for (const id of ['spider', 'fox', 'mole', 'raccoon', 'dragon']) {
    await tab(1);
    await p.locator(`.nrs-card[data-pet=${id}]`).click();
    await p.waitForTimeout(650);
    if (!one) await tab(0);
    const s = await p.evaluate(grab, BLOCKS);
    if (!base) base = s;
    else for (const m of moved(base, s)) bad(k, `pet ${id}: ${m}`);
  }
  // tabs and a key press
  await tab(0);
  const sq = await p.evaluate(grab, BLOCKS);
  await tab(1);
  for (const m of moved(sq, await p.evaluate(grab, BLOCKS))) bad(k, `tab coll: ${m}`);
  await tab(2);
  for (const m of moved({ top: sq.top, tabs: sq.tabs }, await p.evaluate(grab, BLOCKS)))
    bad(k, `tab eggs: ${m}`);
  await tab(0);
  const before = await p.evaluate(grab, BLOCKS);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(500);
  for (const m of moved(before, await p.evaluate(grab, BLOCKS))) bad(k, `key press: ${m}`);
  await ctx.close();
}
await b.close();
console.log(fail ? `${fail} failure(s)` : 'ok');
process.exit(fail ? 1 : 0);
