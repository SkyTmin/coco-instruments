import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICKS } from './economy';
import * as picks from './props-pixel/picks';
import { propFit } from './props-pixel/fit';
import { PX } from './props-pixel/sprites-picks';
import { manifestProblems, sameBytes, seamRatio } from './props-pixel/testkit';
import type { Res } from './props-pixel/types';

const ROOT = path.resolve(__dirname, '../..');
const RS: Res[] = ['s', 'l'];
const opaque = (d: Uint8ClampedArray, i: number) => d[i * 4 + 3] > 0;

describe('пиксельные кирки', () => {
  it('17 кирок: значок и вращение у каждой, кузня на каждую ступень', () => {
    expect(PICKS.length).toBe(17);
    for (let k = 0; k < PICKS.length; k++) {
      expect(picks.STRIPS[`icon-${k}`]?.frames).toBe(1);
      expect(picks.STRIPS[`spin-${k}`]?.loop).toBe(true);
    }
    for (let r = 0; r < 7; r++) expect(picks.STRIPS[`forge-r${r}`]?.res).toEqual(['l']);
  });

  it('манифест и файлы совпадают с рисовальщиком', () => {
    expect(manifestProblems(picks, PX, ROOT)).toEqual([]);
  });

  it('рисунок детерминирован, холст по размеру', () => {
    for (const r of RS)
      for (const name of ['icon-0', 'spin-7', 'spin-16']) {
        const a = picks.frame(name, 0, r);
        expect([a.w, a.h]).toEqual([picks.RES[r].cw, picks.RES[r].ch]);
        expect(sameBytes(a, picks.frame(name, 0, r))).toBe(true);
      }
    const f = picks.frame('forge-r6', 30, 'l');
    expect(sameBytes(f, picks.frame('forge-r6', 30, 'l'))).toBe(true);
  });

  it('значок — кадр 0 вращения: кирка та же, без блёсток вокруг', () => {
    for (let k = 0; k < PICKS.length; k++)
      for (const r of RS) {
        const ic = picks.frame(`icon-${k}`, 0, r).data;
        const sp = picks.frame(`spin-${k}`, 0, r).data;
        if (PICKS[k].rarity <= 1) {
          // Обычной и необычной вокруг нечего добавлять: кадр в кадр.
          expect(Buffer.from(ic).equals(Buffer.from(sp))).toBe(true);
          continue;
        }
        let n = 0;
        let same = 0;
        for (let i = 0; i < ic.length / 4; i++)
          if (opaque(ic, i)) {
            n++;
            if (
              ic[i * 4] === sp[i * 4] &&
              ic[i * 4 + 1] === sp[i * 4 + 1] &&
              ic[i * 4 + 2] === sp[i * 4 + 2]
            )
              same++;
          }
        expect(same / n).toBeGreaterThan(0.95);
      }
  });

  it('вращение — петля без шва', { timeout: 60000 }, () => {
    for (let k = 0; k < PICKS.length; k++)
      expect([k, seamRatio(picks, `spin-${k}`, 's') <= 1]).toEqual([k, true]);
    for (const k of [0, 9, 16])
      expect([k, seamRatio(picks, `spin-${k}`, 'l') <= 1]).toEqual([k, true]);
  });

  it('кузня: метки по порядку, длина растёт со ступенью, последний кадр пуст', () => {
    let prev = 0;
    for (let r = 0; r < 7; r++) {
      const d = picks.STRIPS[`forge-r${r}`];
      const m = d.marks ?? {};
      const order = ['strike1', 'strike2', 'strike3', 'quench', 'reveal'].map((k) => m[k]);
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
      expect(order[0]).toBeGreaterThan(0);
      expect(order[4]).toBeLessThan(d.frames - 4);
      const secs = d.frames / d.fps;
      expect(secs).toBeGreaterThanOrEqual(1.6);
      expect(secs).toBeLessThanOrEqual(3.3);
      expect(secs).toBeGreaterThanOrEqual(prev);
      prev = secs;
      const last = picks.frame(`forge-r${r}`, d.frames - 1, 'l').data;
      expect(last.some((v, i) => i % 4 === 3 && v > 0)).toBe(false);
    }
  });

  it('кузня: по метке reveal кирка стоит ровно там, где значок (подмена без сдвига)', () => {
    const rep = [0, 3, 6, 9, 12, 14, 16];
    for (let r = 0; r < 7; r++) {
      const d = picks.STRIPS[`forge-r${r}`];
      const ic = picks.frame(`icon-${rep[r]}`, 0, 'l').data;
      const f = picks.frame(`forge-r${r}`, d.marks!.reveal, 'l').data;
      let n = 0;
      let cov = 0;
      for (let i = 0; i < ic.length / 4; i++)
        if (opaque(ic, i)) {
          n++;
          if (opaque(f, i)) cov++;
        }
      expect([r, cov / n > 0.97]).toEqual([r, true]);
    }
  });

  it('вес: разовая кузня ≤ 250 КБ, значок — крохи', () => {
    const file = (n: string) => fs.statSync(path.join(ROOT, 'public/ui/px/picks', n)).size;
    for (let r = 0; r < 7; r++) expect(file(`forge-r${r}-l.webp`)).toBeLessThanOrEqual(250 * 1024);
    for (let k = 0; k < PICKS.length; k++) {
      expect(file(`icon-${k}.webp`)).toBeLessThanOrEqual(2 * 1024);
      expect(file(`spin-${k}-l.webp`)).toBeLessThanOrEqual(60 * 1024);
    }
  });

  it('сцена кузни и кирка в ней ложатся одной крупной полосой целого масштаба', () => {
    // ForgeScreen: FORGE_PX = 150 — у полосы кузни (только крупная) и у вращения (обе) одна рамка.
    for (const dpr of [2, 3]) {
      const forge = propFit(150, undefined, PX.large, dpr);
      const spin = propFit(150, PX.box, PX.large, dpr);
      expect(forge).toEqual(spin);
      expect(forge.large && forge.crisp).toBe(true);
    }
  });
});
