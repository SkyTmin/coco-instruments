// Пиксельные предметы — запекание кадров. Подробности — `.claude/rules/props-pixel.md`.
//
//   npx vite-node scripts/props-pixel/bake.ts -- --set eggs [--only idle-moss,hatch-moss-r0]
//       [--res s] [--sheet DIR] [--keys 12] [--no-game]
//
// 1. Рисовальщик набора `src/lib/props-pixel/<set>.ts` (чистый TS, без браузера)
//    рисует все кадры в `scripts/props-pixel/.tmp/<set>/<res>/<name>.rgba`.
// 2. Сразу за ним `python3 scripts/props-pixel/post.py --set <set>` режет полосы
//    (WebP без потерь) в `public/ui/px/<set>/` и пишет манифест
//    `src/lib/props-pixel/sprites-<set>.ts` (+ `scripts/props-pixel/<set>.json`).
// `--only` печёт только названные полосы (через запятую; `*` в конце — по началу
// имени) и вписывает их в манифест, остальные не трогает. `--res` печёт одну
// полосу — только для листов (`--no-game` сам). `--sheet DIR` — листы ключевых кадров.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PropSetModule, Res } from '../../src/lib/props-pixel/types';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const set = arg('--set');
if (!set || !/^[a-z]+$/.test(set))
  throw new Error('нужно --set <набор> (eggs, chests, books, picks)');
const only = arg('--only')?.split(',').filter(Boolean) ?? null;
const resOnly = arg('--res') as Res | null;
const sheet = arg('--sheet');
const keys = arg('--keys');
const noGame = argv.includes('--no-game') || !!resOnly;

const mod = (await import(path.join(ROOT, 'src/lib/props-pixel', `${set}.ts`))) as PropSetModule;
const match = (name: string) =>
  !only || only.some((o) => (o.endsWith('*') ? name.startsWith(o.slice(0, -1)) : name === o));
const names = Object.keys(mod.STRIPS).filter(match);
if (!names.length) throw new Error(`в наборе ${set} нет полос ${only?.join(',')}`);

const TMP = path.join(HERE, '.tmp', set);
// Полный прогон начинает с чистого листа: удалённая полоса не задержится.
if (!only && !resOnly) fs.rmSync(TMP, { recursive: true, force: true });
const t00 = Date.now();
for (const res of ['s', 'l'] as Res[]) {
  const cv = mod.RES[res];
  if (!cv || (resOnly && res !== resOnly)) continue;
  const dir = path.join(TMP, res);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const def = mod.STRIPS[name];
    if (def.res && !def.res.includes(res)) {
      fs.rmSync(path.join(dir, `${name}.rgba`), { force: true });
      continue;
    }
    const n = def.frames;
    const buf = Buffer.alloc(n * cv.cw * cv.ch * 4);
    for (let i = 0; i < n; i++) {
      const p = mod.frame(name, i, res);
      if (p.w !== cv.cw || p.h !== cv.ch)
        throw new Error(`${set}/${res}/${name}: кадр ${p.w}×${p.h}`);
      buf.set(p.data, i * cv.cw * cv.ch * 4);
    }
    fs.writeFileSync(path.join(dir, `${name}.rgba`), buf);
  }
  // Описание холста и полос — для post.py (полосы набора целиком: --only дописывает).
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ ...cv, strips: mod.STRIPS, order: Object.keys(mod.STRIPS) }),
  );
}
console.log(`${set}: ${names.length} полос за ${((Date.now() - t00) / 1000).toFixed(1)} с`);

const py = ['scripts/props-pixel/post.py', '--set', set];
if (only) py.push('--only', names.join(','));
if (sheet) py.push('--sheet', sheet);
if (keys) py.push('--keys', keys);
if (noGame) py.push('--no-game');
const r = spawnSync('python3', py, { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
