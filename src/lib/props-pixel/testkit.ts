// Пиксельные предметы — общие проверки для тестов наборов (`src/lib/props-pixel-<set>.test.ts`).
// Только для тестов: игра этот модуль не импортирует.

import fs from 'node:fs';
import path from 'node:path';
import type { Px } from '../dungeon-art';
import type { PropSetModule, PxManifest, Res } from './types';

/** Доля пикселей, которые различаются (по цвету или прозрачности) у двух кадров. */
export function pxDiff(a: Px, b: Px): number {
  if (a.w !== b.w || a.h !== b.h) return 1;
  let d = 0;
  let any = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const on = a.data[i + 3] > 0 || b.data[i + 3] > 0;
    if (!on) continue;
    any++;
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    )
      d++;
  }
  return any ? d / any : 0;
}

export const sameBytes = (a: Px, b: Px) =>
  a.w === b.w && a.h === b.h && Buffer.from(a.data).equals(Buffer.from(b.data));

/**
 * Шов петли: разница «последний → первый» против самого крупного обычного шага между соседними
 * кадрами. ≤ 1 — стык не заметнее обычного шага.
 */
export function seamRatio(mod: PropSetModule, name: string, res: Res): number {
  const n = mod.STRIPS[name].frames;
  const fr = Array.from({ length: n }, (_, i) => mod.frame(name, i, res));
  let step = 0;
  for (let i = 1; i < n; i++) step = Math.max(step, pxDiff(fr[i - 1], fr[i]));
  const seam = pxDiff(fr[n - 1], fr[0]);
  return step ? seam / step : seam ? Infinity : 0;
}

/** Что не сходится между рисовальщиком и манифестом/файлами (пустой список — всё сходится). */
export function manifestProblems(mod: PropSetModule, man: PxManifest, root: string): string[] {
  const out: string[] = [];
  const names = Object.keys(mod.STRIPS);
  const have = Object.keys(man.strips);
  if (names.join() !== have.join()) out.push(`полосы: рисовальщик ${names} ≠ манифест ${have}`);
  if (man.box !== mod.RES.s.box) out.push(`рамка ${man.box} ≠ ${mod.RES.s.box}`);
  if (mod.RES.l && man.large !== mod.RES.l.box) out.push(`крупная рамка ${man.large}`);
  for (const name of names) {
    const d = mod.STRIPS[name];
    const m = man.strips[name];
    if (!m) continue;
    if (m.n !== d.frames || m.fps !== d.fps || m.loop !== d.loop)
      out.push(`${name}: n/fps/loop ${m.n}/${m.fps}/${m.loop}`);
    if (JSON.stringify(m.marks ?? {}) !== JSON.stringify(sortMarks(d.marks ?? {})))
      out.push(`${name}: метки ${JSON.stringify(m.marks)}`);
    for (const [k, i] of Object.entries(d.marks ?? {}))
      if (!(i >= 0 && i < d.frames)) out.push(`${name}: метка ${k}=${i} вне полосы`);
    for (const res of ['s', 'l'] as Res[]) {
      const want = !!mod.RES[res] && (!d.res || d.res.includes(res));
      const r = m[res];
      if (want !== !!r) out.push(`${name}/${res}: ${want ? 'нет в манифесте' : 'лишняя'}`);
      if (!r) continue;
      if (r.w * r.cols > 16383) out.push(`${name}/${res}: полоса шире 16383`);
      const f = path.join(root, 'public/ui/px', man.set, `${name}${res === 'l' ? '-l' : ''}.webp`);
      if (!fs.existsSync(f)) out.push(`${name}/${res}: нет файла ${f}`);
    }
  }
  return out;
}

const sortMarks = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).sort((a, b) => a[1] - b[1]));
