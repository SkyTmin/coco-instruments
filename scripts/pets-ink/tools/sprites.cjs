#!/usr/bin/env node
// sprites.cjs (Coco): render every drawing of every pet animation on a transparent canvas, for the
// game's sprite strips. The strips, crops and manifest are cut by tools/sprites-post.py.
//
//   node tools/sprites.cjs                 all pets
//   node tools/sprites.cjs --pet mole      one pet
//   node tools/sprites.cjs --scale 0.5     render scale (default 0.5 = 540 px frames)
//
// Output: .tmp/sprites/<pet>/<anim>-<dd>.png, one file per drawing (art bible 5: drawings are held
// two frames, so a drawing is sampled in the middle of its hold).
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

async function main() {
  const args = C.parseArgs(process.argv.slice(2));
  const scale = args.scale ? Number(args.scale) : 0.5;
  const only = typeof args.pet === 'string' ? args.pet : null;
  const src = C.sources({ player: false });
  const TL = src.timeline;
  const out = path.join(C.ROOT, '.tmp', 'sprites');
  const browser = await C.launch();
  const t0 = Date.now();
  let n = 0;
  let failed = false;
  try {
    const pg = await C.openPage(browser, src.files, { scale, prefix: 'sprites', query: '?render=1&transparent=1' });
    const anims = await pg.page.evaluate(() => window.FILM.pets.ANIMS);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'anims.json'), JSON.stringify(anims));
    for (const shot of TL.shots) {
      const [pet, anim] = shot.id.split('-');
      if (only && pet !== only) continue;
      const A = anims[anim];
      if (!A) continue;
      const dir = path.join(out, pet);
      fs.mkdirSync(dir, { recursive: true });
      for (let d = 0; d < A.n; d++) {
        const T = shot.start + (d + 0.5) / A.fps;
        const r = await pg.page.evaluate((T) => window.__h.render(T), T);
        for (const e of r.errors) {
          failed = true;
          console.log(`[error] ${shot.id} d${d}: ${e.message}`);
        }
        const png = Buffer.from(await pg.page.evaluate(() => window.__h.png()), 'base64');
        fs.writeFileSync(path.join(dir, `${anim}-${String(d).padStart(2, '0')}.png`), png);
        n++;
      }
      console.log(`${shot.id}: ${A.n} drawings`);
    }
    for (const e of pg.pageErrors) {
      failed = true;
      console.log(`[error] page: ${e}`);
    }
    await pg.close();
  } finally {
    await browser.close();
  }
  console.log(`${n} drawing(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.relative(C.ROOT, out)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
