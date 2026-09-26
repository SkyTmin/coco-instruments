#!/usr/bin/env node
// review.cjs (Coco): one contact sheet per pet with every drawing of every animation, a row per
// animation. The critic's view: look at every drawing, then at the small row (--small) to judge
// how the pet reads at game size.
//
//   node tools/review.cjs --pet mole                   .frames/review/mole.png (thumbs 200 px)
//   node tools/review.cjs --pet mole --thumb 120 --anims idle,walk
//   node tools/review.cjs --pet mole --small           also .frames/review/mole-small.png: the first
//                                                      drawing of each animation at 44, 74 and 150 px
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

async function main() {
  const args = C.parseArgs(process.argv.slice(2), ['small']);
  const pet = typeof args.pet === 'string' ? args.pet : 'mole';
  const thumb = args.thumb ? Number(args.thumb) : 200;
  const src = C.sources({ player: false });
  const TL = src.timeline;
  const out = path.join(C.ROOT, '.frames', 'review');
  fs.mkdirSync(out, { recursive: true });
  const browser = await C.launch();
  let failed = false;
  try {
    const pg = await C.openPage(browser, src.files, { scale: Math.max(0.25, thumb / 540), prefix: 'review' });
    const anims = await pg.page.evaluate(() => window.FILM.pets.ANIMS);
    const want = typeof args.anims === 'string' ? args.anims.split(',') : Object.keys(anims);
    const shots = TL.shots.filter((s) => s.id.startsWith(pet + '-') && want.includes(s.id.split('-')[1]));
    const cols = Math.max(...shots.map((s) => anims[s.id.split('-')[1]].n));
    const cells = [];
    for (const s of shots) {
      const A = anims[s.id.split('-')[1]];
      for (let d = 0; d < cols; d++) cells.push(d < A.n ? { T: s.start + (d + 0.5) / A.fps, label: [`${s.id.split('-')[1]} ${d}`, ''] } : null);
    }
    await pg.page.evaluate(([n, c, w]) => window.__h.sheetInit(n, c, w, 26), [cells.length, cols, thumb]);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      const r = await pg.page.evaluate((T) => window.__h.render(T), cells[i].T);
      for (const e of r.errors) {
        failed = true;
        console.log(`[error] ${cells[i].label[0]}: ${e.message}`);
      }
      await pg.page.evaluate(([i, l]) => window.__h.sheetAdd(i, l), [i, cells[i].label]);
    }
    const file = path.join(out, `${pet}.png`);
    fs.writeFileSync(file, Buffer.from(await pg.page.evaluate(() => window.__h.sheetPng()), 'base64'));
    console.log(`sheet -> ${path.relative(C.ROOT, file)}`);
    for (const e of pg.pageErrors) {
      failed = true;
      console.log(`[error] page: ${e}`);
    }
    await pg.close();
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
