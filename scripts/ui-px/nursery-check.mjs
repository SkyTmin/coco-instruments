// Nursery stand check (N3, 13.10.2026) — the pet is as big as each format allows and NOTHING
// JUMPS. Needs a running dev server (`npm run dev -- --port 5559`) and Playwright with Chromium.
//
//   node scripts/ui-px/nursery-check.mjs [pp,p360,p440,pl,pl440,tp,tl,d1,d2]
//   env: PORT (5559), UILANG ru|de|tr…, PETS a,b (phoenix,raven,mole,roach — roach unhatched),
//        KBD=1 (a Shift press must move nothing), HITS=1 (hit areas), MENU=1 (phone anim menu),
//        EGGS=1 (eggs tab), SHOT=dir (screenshots), V=1 (all boxes), PW (playwright module path),
//        CHROME (Chromium executable).
//
// Fails (exit 1) when the pet frame (`.nur-pet .pet__px`) is below `TARGET` on a format, when any
// box (stage, room, pet, plate, anims, squad, collection, actions, side, tabs) differs between
// the pets, or when a key press moves one. Targets = the critic's round-2 table; lower them only
// with the owner's consent («питомец как можно крупнее»).
import fs from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright');
const OUT = process.env.SHOT ? `${process.env.SHOT.replace(/\/$/, '')}/` : '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT || 5559;
const SIZES = {
  pp: [390, 844, 3],
  p360: [360, 780, 3],
  p440: [440, 956, 3],
  pl: [844, 390, 3],
  pl440: [956, 440, 3],
  tp: [820, 1180, 2],
  tl: [1180, 820, 2],
  d1: [1440, 900, 1],
  d2: [1920, 1080, 1],
};
const TARGET = {
  pp: 299,
  p360: 224,
  p440: 336,
  pl: 224,
  pl440: 299,
  tp: 336,
  tl: 448,
  d1: 560,
  d2: 560,
};
const want = (process.argv[2] || 'pp,p360,p440,pl,pl440,tp,tl,d1,d2').split(',');
const lang = process.env.UILANG || 'ru';
const PETS = (process.env.PETS || 'phoenix,raven,mole,roach').split(',');
const TAG = process.env.TAG || 'nur';
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const KEYS = [
  'stage',
  'room',
  'pet',
  'plate',
  'anims',
  'tog',
  'squad',
  'sum',
  'coll',
  'acts',
  'side',
  'tabs',
];
const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const R = (s) => {
    const e = q(s);
    if (!e) return '-';
    const b = e.getBoundingClientRect();
    return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10) / 10).join(',');
  };
  const fr = q('.nur-pet .pet__px');
  const side = q('.nur-side');
  const st = q('.nur-stage')?.getBoundingClientRect();
  return {
    stage: R('.nur-stage'),
    room: R('.nur-room'),
    pet: R('.nur-pet'),
    plate: R('.nur-plate'),
    anims: R('.nur-anims'),
    tog: R('.nur-anim-tog'),
    squad: R('.nur-squad'),
    sum: R('.nur-squad__sum'),
    coll: R('.nur-coll'),
    acts: R('.nur-acts'),
    side: R('.nur-side'),
    tabs: R('.ppn-tabs, .ppn .px-tabs'),
    frame: fr ? Math.round(fr.getBoundingClientRect().width * 10) / 10 : 0,
    roomWH: (() => {
      const r = q('.nur-room')?.getBoundingClientRect();
      return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '-';
    })(),
    stageH: st ? Math.round((st.height / innerHeight) * 100) : 0,
    pageScroll: document.scrollingElement.scrollHeight - innerHeight,
    sideScroll: side ? side.scrollHeight - side.clientHeight : 0,
    nurScroll: (() => {
      const n = q('.nur');
      return n ? n.scrollHeight - n.clientHeight : 0;
    })(),
    gridRows: (() => {
      const g = q('.nur-coll > .nur-grid');
      const c = g?.firstElementChild;
      if (!g || !c) return '-';
      const ch = c.getBoundingClientRect().height;
      const gap = parseFloat(getComputedStyle(g).rowGap) || 0;
      return Math.round((g.clientHeight / (ch + gap)) * 10) / 10;
    })(),
    name: q('.nur-plate__name')?.textContent,
    nameFits: (() => {
      const n = q('.nur-plate__name');
      return n
        ? n.scrollWidth <= n.clientWidth + 1
          ? true
          : `${n.scrollWidth}/${n.clientWidth}`
        : '-';
    })(),
    actsFit:
      [...document.querySelectorAll('.nur-acts .px-btn')]
        .map((e) => {
          const cs = getComputedStyle(e);
          const L =
            e.getBoundingClientRect().left +
            parseFloat(cs.borderLeftWidth) +
            parseFloat(cs.paddingLeft) -
            0.5;
          const Rr =
            e.getBoundingClientRect().right -
            parseFloat(cs.borderRightWidth) -
            parseFloat(cs.paddingRight) +
            0.5;
          const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
          let bad = '';
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (!n.textContent.trim() || n.parentElement.closest('.px-keyhint')) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            const rs = [...r.getClientRects()];
            if (rs.length > 1 || rs.some((x) => x.left < L || x.right > Rr))
              bad += n.textContent.trim().slice(0, 10) + ' ';
          }
          return bad;
        })
        .join('') || true,
  };
};
const HITS = () => {
  const out = [];
  for (const e of document.querySelectorAll(
    '.nur-chip--more, .nur-anim, .nur-anim-tog, .nur-acts .px-btn, .nur-squad__row > *',
  )) {
    const b = e.getBoundingClientRect();
    if (
      b.width === 0 ||
      getComputedStyle(e).display === 'none' ||
      getComputedStyle(e).visibility === 'hidden'
    )
      continue;
    const cx = b.left + b.width / 2,
      cy = b.top + b.height / 2;
    const hit = (x, y) => {
      const h = document.elementFromPoint(x, y);
      return h && (h === e || e.contains(h));
    };
    if (!hit(cx, cy)) {
      out.push(
        `${
          (e.className || '')
            .toString()
            .split(' ')
            .find((c) => c.startsWith('nur')) || 'btn'
        }:covered`,
      );
      continue;
    }
    const ext = (dx, dy) => {
      let n = 0;
      while (n < 80 && hit(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    out.push(
      `${
        (e.className || '')
          .toString()
          .split(' ')
          .find((c) => c.startsWith('nur')) || 'btn'
      } ${Math.round(b.width)}x${Math.round(b.height)}→${ext(-1, 0) + ext(1, 0) + 1}x${ext(0, -1) + ext(0, 1) + 1}`,
    );
  }
  return out;
};
async function tap(p, k, sel) {
  const c = await p.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!c) return false;
  if (k[0] === 'd') await p.mouse.click(c.x, c.y);
  else await p.touchscreen.tap(c.x, c.y);
  return true;
}
/** Opens the pets camp at format `k` in language `lg` with the seeded state. */
async function openNursery(k, lg) {
  const [w, h, dpr] = SIZES[k];
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: k[0] !== 'd',
  });
  await ctx.addInitScript((l) => localStorage.setItem('coco.lang', l), lg);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
  await p.goto(`http://127.0.0.1:${PORT}/#/prison`);
  await p.waitForSelector('.pmx-dock__pets', { timeout: 40000 });
  await p.waitForTimeout(600);
  await p.evaluate(async () => {
    const S = await import('/src/store.ts');
    const pr = S.useFinanceStore.getState().prison;
    const ids = [
      'mole',
      'mouse',
      'pigeon',
      'cat',
      'bulldog',
      'ferret',
      'scarab',
      'badger',
      'owl',
      'raccoon',
      'shepherd',
      'fox',
      'spider',
      'dragon',
      'wolf',
      'raven',
      'phoenix',
    ];
    const pets = {};
    ids.forEach((id, i) => (pets[id] = { xp: 2000 + i * 3000, v: 1, dup: 0, pat: 0 }));
    pets.raven = { xp: 400000, v: 1, dup: 0, pat: 0 };
    pets.phoenix = { xp: 60000, v: 1, dup: 0, pat: 0 };
    // one NORMAL pet: the gold ★ badge comes and goes on the plate (critic round 3, item 6)
    pets.mole = { xp: 2000, v: 0, dup: 0, pat: 0 };
    S.useFinanceStore.setState({
      slotsBalance: 510_812_345,
      prison: {
        ...pr,
        rank: 12,
        prestige: 1,
        tokens: 9_769_119,
        keys: 12,
        pets,
        squad: ['phoenix', 'raven', 'dragon'],
      },
    });
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const b = document.querySelector('.pmx-dock__pets')?.closest('button');
    if (b) b.id = 'pets-btn';
  });
  await tap(p, k, '#pets-btn');
  await p.waitForTimeout(1800);
  if (!(await p.$('.nur'))) {
    await p.evaluate(() => document.querySelector('#pets-btn')?.click());
    await p.waitForTimeout(1800);
  }
  return { ctx, p, h };
}

// TABS=1 (or a language list): no «Питомцы / Яйца» label may overflow its box by even a fraction
// of a pixel (scrollWidth is an integer: tr «Yumurtalar» 113.16 in 113.00 hid an ellipsis).
if (process.env.TABS) {
  const langs = (process.env.TABS === '1' ? 'ru,en,fr,tr,de,es,it' : process.env.TABS).split(',');
  let bad = 0;
  for (const lg of langs) {
    for (const k of ['p360', 'pp', 'p440']) {
      const { ctx, p } = await openNursery(k, lg);
      const r = await p.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const row = document.querySelector('.ppn__tabs');
        const range = document.createRange();
        const labels = [...document.querySelectorAll('.ppn__tabs .px-tab__label')].map((l) => {
          range.selectNodeContents(l);
          const over = range.getBoundingClientRect().width - l.getBoundingClientRect().width;
          return { text: l.textContent, over: Math.round(over * 100) / 100 };
        });
        return { tight: !!row?.classList.contains('is-tight'), labels };
      });
      const cut = r.labels.filter((x) => x.over > 0.01);
      if (cut.length || !r.labels.length) bad++;
      console.log(
        `tabs ${lg} ${k}: ${r.tight ? 'tight' : 'icons'} ${r.labels.map((x) => `${x.text} ${x.over}`).join(', ')} ${cut.length || !r.labels.length ? 'CUT' : 'OK'}`,
      );
      await ctx.close();
    }
  }
  await b.close();
  console.log(bad ? `FAIL ${bad}` : 'ALL OK');
  process.exit(bad ? 1 : 0);
}

let fails = 0;
for (const k of want) {
  const { ctx, p, h } = await openNursery(k, lang);
  const rows = [];
  for (const id of PETS) {
    const direct = await tap(p, k, `.nur-side [data-pet="${id}"], .nur-coll [data-pet="${id}"]`);
    if (!direct) {
      await tap(p, k, '.nur-strip__open');
      await p.waitForTimeout(400);
      await p.evaluate(
        (id) =>
          document
            .querySelector(`.nur-drawer [data-pet="${id}"]`)
            ?.scrollIntoView({ block: 'center' }),
        id,
      );
      await p.waitForTimeout(150);
      await tap(p, k, `.nur-drawer [data-pet="${id}"]`);
      await p.waitForTimeout(250);
      await tap(p, k, '.nur-drawer__close');
    }
    await p.waitForTimeout(1000);
    // the test's own scrollIntoView moved the wide mid list: back to the top before measuring
    await p.evaluate(() => {
      const m = document.querySelector('.nur-side__mid');
      if (m) m.scrollTop = 0;
    });
    await p.waitForTimeout(100);
    const m = await p.evaluate(MEASURE);
    m.id = id;
    rows.push(m);
    if (process.env.HITS && id === PETS[0])
      console.log('   hits', (await p.evaluate(HITS)).join(' | '));
    if (process.env.MENU && id === PETS[0] && (await p.$('.nur-anim-tog'))) {
      const before = await p.evaluate(MEASURE);
      await tap(p, k, '.nur-anim-tog');
      await p.waitForTimeout(300);
      const mm = await p.evaluate(() => {
        const m = document.querySelector('.nur-anims--pop');
        if (!m) return null;
        const b = m.getBoundingClientRect(),
          r = document.querySelector('.nur-room').getBoundingClientRect();
        return {
          menu: [b.x - r.x, b.y - r.y, b.width, b.height].map(Math.round).join(','),
          inRoom: b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.bottom <= r.bottom + 0.5,
        };
      });
      const mh = await p.evaluate(HITS);
      if (process.env.SHOT) await p.screenshot({ path: `${OUT}${TAG}-${lang}-${k}-menu.png` });
      await tap(p, k, '.nur-anims--pop .nur-anim:nth-child(4)');
      await p.waitForTimeout(300);
      const closed = !(await p.$('.nur-anims--pop'));
      await tap(p, k, '.nur-anim-tog');
      await p.waitForTimeout(250);
      await tap(p, k, '.nur-squad__title');
      await p.waitForTimeout(250);
      const closed2 = !(await p.$('.nur-anims--pop'));
      const after = await p.evaluate(MEASURE);
      const md = KEYS.filter((q) => before[q] !== after[q] && q !== 'tog');
      console.log(
        '   menu',
        JSON.stringify(mm),
        'closeOnPick',
        closed,
        'closeOutside',
        closed2,
        md.length ? 'MOVED ' + md.join(' ') : 'nothing moved',
      );
      console.log('   menu hits', mh.filter((x) => x.startsWith('nur-anim ')).join(' | '));
    }
    if (process.env.SHOT && (id === 'phoenix' || id === 'roach'))
      await p.screenshot({ path: `${OUT}${TAG}-${lang}-${k}-${id}.png` });
  }
  const same = KEYS.filter((q) => rows.every((r) => r[q] === rows[0][q]));
  const diff = KEYS.filter((q) => !same.includes(q));
  const r0 = rows[0];
  const fr = Math.min(...rows.map((r) => r.frame).filter(Boolean));
  const ok = fr >= TARGET[k] - 0.5;
  if (!ok || diff.length) fails++;
  console.log(
    `${lang} ${k}: frame ${rows.map((r) => r.frame).join('/')} target ${TARGET[k]} ${ok ? 'OK' : 'LOW'} (${Math.round((fr / h) * 100)}% H) room ${r0.roomWH} stage ${r0.stageH}%H grid ${r0.gridRows} page ${r0.pageScroll} side ${r0.sideScroll} nur ${r0.nurScroll} name ${[...new Set(rows.map((r) => r.nameFits))].join('/')} acts ${[...new Set(rows.map((r) => r.actsFit))].join('/')} | ${diff.length ? 'DIFF ' + diff.map((q) => `${q}=${rows.map((r) => r[q]).join(' / ')}`).join(' ; ') : 'identical'}`,
  );
  if (process.env.V) for (const q of KEYS) console.log(`   ${q}: ${r0[q]}`);
  if (process.env.KBD) {
    const before = await p.evaluate(MEASURE);
    await p.keyboard.press('Shift');
    await p.waitForTimeout(700);
    const after = await p.evaluate(MEASURE);
    const kd = KEYS.filter((q) => before[q] !== after[q]);
    if (kd.length) fails++;
    console.log(
      `   kbd input=${await p.evaluate(() => document.documentElement.dataset.input)} ${kd.length ? kd.map((q) => `${q} ${before[q]}→${after[q]}`).join(' ; ') : 'no change'}`,
    );
    if (process.env.SHOT) await p.screenshot({ path: `${OUT}${TAG}-${lang}-${k}-kbd.png` });
  }
  if (process.env.EGGS) {
    const tabs = await p.$$('.ppn__tabs .px-tab');
    await tabs[1]?.click();
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const t = [...document.querySelectorAll('.ppn__tabs .px-tab')].map((x) => {
        const b = x.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}`;
      });
      const ppn = document.querySelector('.ppn');
      return {
        tabs: t.join(','),
        ppnScroll: ppn ? ppn.scrollHeight - ppn.clientHeight : -1,
        page: document.scrollingElement.scrollHeight - innerHeight,
        cls: ppn?.className,
      };
    });
    console.log('   eggs', JSON.stringify(r));
    if (process.env.SHOT) await p.screenshot({ path: `${OUT}${TAG}-${lang}-${k}-eggs.png` });
  }
  await ctx.close();
}
await b.close();
console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
