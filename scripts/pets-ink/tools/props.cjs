#!/usr/bin/env node
// props.cjs (Coco): render the chests and eggs of src/pets/90-props.js on transparent canvases.
//
//   node tools/props.cjs            -> .tmp/props/{tier}-{closed|open}.png, mystery-closed.png,
//                                      mystery-spin-NN.png (16 turns), eggs/{kind}.png
// Chests and eggs are drawn at 1024 px and cut to 512 by tools/props-post.py (the spin at 320).
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

async function main() {
  const src = C.sources({ player: false });
  const out = path.join(C.ROOT, '.tmp', 'props');
  fs.mkdirSync(path.join(out, 'eggs'), { recursive: true });
  const browser = await C.launch();
  let failed = false;
  try {
    const pg = await C.openPage(browser, src.files, { scale: 0.5, prefix: 'props', query: '?render=1&transparent=1' });
    const shot = async (name, fn, arg) => {
      const b64 = await pg.page.evaluate(
        ([fn, arg]) => {
          const S = 1024;
          const cv = document.createElement('canvas');
          cv.width = S;
          cv.height = S;
          const ctx = cv.getContext('2d');
          const K = window.FILM.pets;
          if (fn === 'chest') K.props.drawChest(ctx, S, arg.tier, arg);
          else K.props.drawEgg(ctx, S, arg.kind);
          return cv.toDataURL('image/png').split(',')[1];
        },
        [fn, arg],
      );
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(b64, 'base64'));
    };
    for (const tier of ['common', 'rare', 'epic', 'legend']) {
      await shot(`${tier}-closed`, 'chest', { tier });
      await shot(`${tier}-open`, 'chest', { tier, open: true });
    }
    await shot('mystery-closed', 'chest', { tier: 'mystery' });
    for (let f = 0; f < 16; f++) await shot(`mystery-spin-${String(f).padStart(2, '0')}`, 'chest', { tier: 'mystery', yaw: -0.55 + (f / 16) * Math.PI * 2, boil: f % 4 });
    for (const kind of ['moss', 'stone', 'crystal', 'dragon']) await shot(`eggs/${kind}`, 'egg', { kind });
    for (const e of pg.pageErrors) {
      failed = true;
      console.log(`[error] page: ${e}`);
    }
    await pg.close();
  } finally {
    await browser.close();
  }
  console.log(`props -> ${path.relative(C.ROOT, out)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
