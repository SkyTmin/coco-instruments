// Пиксельные питомцы — запекание кадров. Подробности — `.claude/rules/pets.md`.
//
//   npx vite-node scripts/pets-pixel/bake.ts [-- --pet phoenix] [--sheet DIR] [--only idle,work] [--res s]
//
// 1. Рисовальщики из `src/lib/pets-pixel/` (чистый TS, без браузера) рисуют
//    все кадры всех анимаций обеих полос в `scripts/pets-pixel/.tmp/<id>/<res>/<anim>.rgba`
//    (`s` — малая, `l` — крупная).
// 2. Сразу за ними `python3 scripts/pets-pixel/post.py` режет полосы (WebP
//    без потерь) в `public/ui/pets/<id>/` (крупные — `<anim>-l.webp`), золотой
//    (`-v1`), миниатюры, пишет манифест
//    `src/lib/pet-pixel-sprites.ts` (своя метка `rev` у каждого питомца) и
//    список `scripts/pets-pixel/pets.json`.
// Тушь (`scripts/pets-ink/tools/sprites-post.py`) читает `pets.json` и
// пиксельных питомцев пропускает — два конвейера не затирают друг друга.
// Рисунок детерминированный: те же рисовальщики дают те же байты и тот же `rev`.
// `--only` и `--res` рисуют не всё — только для листов; файлы игры тогда не пишутся.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PIXEL_PETS } from '../../src/lib/pets-pixel/index';
import type { Anim, Canvas, Res } from '../../src/lib/pets-pixel/index';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TMP = path.join(HERE, '.tmp');
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const only = arg('--pet');
const sheet = arg('--sheet');
const anims = arg('--only')?.split(',') ?? null;
const resOnly = arg('--res');

const ids = Object.keys(PIXEL_PETS).filter((id) => !only || id === only);
if (!ids.length) throw new Error(`нет пиксельного питомца ${only}`);
for (const id of ids) {
  const pet = PIXEL_PETS[id];
  fs.rmSync(path.join(TMP, id), { recursive: true, force: true });
  for (const [res, cv] of Object.entries(pet.res) as [Res, Canvas][]) {
    if (resOnly && res !== resOnly) continue;
    const dir = path.join(TMP, id, res);
    fs.mkdirSync(dir, { recursive: true });
    // Золотой, который рисовальщик рисует сам (`variants`), пишется рядом
    // (`<anim>-v1.rgba`); у остальных его сделает post.py матрицей фильтра.
    const vs = [0, ...(pet.variants ?? [])];
    const meta = { ...cv, anims: {} as Record<string, unknown>, variants: pet.variants ?? [] };
    for (const a of Object.keys(pet.anims) as Anim[]) {
      if (anims && !anims.includes(a)) continue;
      const { n, fps } = pet.anims[a];
      const bufs = vs.map(() => Buffer.alloc(n * cv.cw * cv.ch * 4));
      const t0 = Date.now();
      for (let i = 0; i < n; i++)
        vs.forEach((v, k) => {
          const p = pet.frame(a, i, res, v);
          if (p.w !== cv.cw || p.h !== cv.ch)
            throw new Error(`${id}/${res}/${a}: кадр ${p.w}×${p.h}`);
          bufs[k].set(p.data, i * cv.cw * cv.ch * 4);
        });
      vs.forEach((v, k) =>
        fs.writeFileSync(path.join(dir, `${a}${v ? `-v${v}` : ''}.rgba`), bufs[k]),
      );
      meta.anims[a] = { n, fps };
      console.log(`${id}/${res}/${a}: ${n} кадров × ${vs.length} за ${Date.now() - t0} мс`);
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  }
}
const py = ['scripts/pets-pixel/post.py', ...(only ? ['--pet', only] : [])];
if (sheet) py.push('--sheet', sheet);
if (anims || resOnly) py.push('--no-game');
const r = spawnSync('python3', py, { stdio: 'inherit', cwd: path.join(HERE, '..', '..') });
process.exit(r.status ?? 1);
