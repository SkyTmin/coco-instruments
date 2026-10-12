import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as books from './props-pixel/books';
import { bookIdleBob } from './props-pixel/books-idle';
import { PX } from './props-pixel/sprites-books';
import { manifestProblems, pxDiff, sameBytes, seamRatio } from './props-pixel/testkit';
import type { Res } from './props-pixel/types';

const ROOT = path.resolve(__dirname, '../..');
const RES: Res[] = ['s', 'l'];
const empty = (p: { data: Uint8ClampedArray | Uint8Array }) =>
  p.data.every((v, i) => i % 4 !== 3 || v === 0);

/**
 * Простая и редкая понравились владельцу как есть (v2.140): эпическую и легендарную
 * переделали своим путём, а эти полосы обязаны остаться байт в байт. sha1 всех кадров.
 */
const KEEP: Record<string, string> = {
  'apply-burn-rare/l': 'b18029ad642ba455',
  'apply-burn-rare/s': 'dd93905d1a8e3080',
  'apply-burn-simple/l': '85d146e95e1bd6be',
  'apply-burn-simple/s': '458a99d29b96de79',
  'apply-ok-rare/l': '1a3768d04f9be1a9',
  'apply-ok-rare/s': '996fe67882ceb150',
  'apply-ok-simple/l': '7b405de1a186bbde',
  'apply-ok-simple/s': '9a3ad621abff7e9c',
  'idle-rare/l': 'd95ae7a3a93409b0',
  'idle-rare/s': '0ae7002a922c1e80',
  'idle-simple/l': '7dc9842c6218dad2',
  'idle-simple/s': 'adb77300e354edc1',
  'reveal-rare/l': '259f235d89166796',
  'reveal-rare/s': 'e59bfd8c6e2a1880',
  'reveal-simple/l': '57057e4b01c2cfb8',
  'reveal-simple/s': 'd637a7b8b30c8969',
  'still-rare/l': '63d4b425d61b97ea',
  'still-rare/s': '5725d54a9c800282',
  'still-simple/l': 'aa7a00329e7e9f8b',
  'still-simple/s': 'e7015faef2637529',
};

describe('пиксельные книги', () => {
  it('рисунок детерминирован, у каждой полосы свой холст', () => {
    for (const r of RES)
      for (const [name, d] of Object.entries(books.STRIPS)) {
        const i = Math.floor(d.frames / 2);
        const a = books.frame(name, i, r);
        const b = books.frame(name, i, r);
        expect([a.w, a.h]).toEqual([books.RES[r].cw, books.RES[r].ch]);
        expect(sameBytes(a, b)).toBe(true);
      }
  });

  it('манифест и файлы совпадают с рисовальщиком, якоря — те же', () => {
    expect(manifestProblems(books, PX, ROOT)).toEqual([]);
    for (const [name, d] of Object.entries(books.STRIPS))
      for (const [k, [x, y]] of Object.entries(d.anchors ?? {})) {
        const m = PX.strips[name].anchors?.[k];
        expect(m, `${name}.${k}`).toBeDefined();
        expect(Math.abs(m![0] - x * 100) + Math.abs(m![1] - y * 100)).toBeLessThan(0.2);
      }
  });

  it('покой: петля без шва, кадр 0 — книга на полке, знак качается по той же формуле', () => {
    for (const t of books.TIERS)
      for (const r of RES) {
        const name = `idle-${t}`;
        expect([name, r, seamRatio(books, name, r) <= 1]).toEqual([name, r, true]);
        expect(pxDiff(books.frame(name, 0, r), books.frame(`still-${t}`, 0, r))).toBe(0);
        const n = books.STRIPS[name].frames;
        const scale = books.RES[r].box / books.RES.s.box;
        for (let i = 0; i < n; i++)
          expect(books.idleBob(t, i, r)).toBe(bookIdleBob(t, i, n, scale));
      }
  }, 60_000);

  it('открытие кончается книгой на полке, метки по порядку', () => {
    for (const t of books.TIERS) {
      const d = books.STRIPS[`reveal-${t}`];
      const m = d.marks!;
      const order = ['land', 'snap', 'open', 'peak', 'close', 'lock'].map((k) => m[k]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order[order.length - 1]).toBeLessThan(d.frames - 1);
      for (const r of RES)
        expect(
          pxDiff(books.frame(`reveal-${t}`, d.frames - 1, r), books.frame(`still-${t}`, 0, r)),
        ).toBe(0);
      // Знак загорается над разворотом, медальон — в рамке.
      const a = d.anchors!;
      expect(a.rise[1]).toBeLessThan(a.glyph[1]);
      for (const v of a.glyph) expect(v > 0 && v < 1).toBe(true);
    }
  });

  it('простая и редкая — байт в байт как в v2.140', () => {
    const got: Record<string, string> = {};
    for (const key of Object.keys(KEEP)) {
      const [name, r] = key.split('/') as [string, Res];
      const h = createHash('sha1');
      for (let i = 0; i < books.STRIPS[name].frames; i++) h.update(books.frame(name, i, r).data);
      got[key] = h.digest('hex').slice(0, 16);
    }
    expect(got).toEqual(KEEP);
  }, 120_000);

  it('вписывание и сгорание кончаются пустым кадром, лучи бьют ниже книги', () => {
    for (const t of books.TIERS) {
      const ok = books.STRIPS[`apply-ok-${t}`];
      const burn = books.STRIPS[`apply-burn-${t}`];
      expect(ok.marks!.open).toBeLessThan(ok.marks!.hit);
      expect(ok.marks!.hit).toBeLessThan(ok.marks!.gone);
      expect(burn.marks!.ignite).toBeLessThan(burn.marks!.crumble);
      expect(ok.anchors!.to[1]).toBeGreaterThan(1);
      for (const r of RES) {
        expect(empty(books.frame(`apply-ok-${t}`, ok.frames - 1, r))).toBe(true);
        expect(empty(books.frame(`apply-burn-${t}`, burn.frames - 1, r))).toBe(true);
        // Первый кадр — та же книга, что на полке (сцена меняет покой на полосу без скачка).
        expect(pxDiff(books.frame(`apply-ok-${t}`, 0, r), books.frame(`still-${t}`, 0, r))).toBe(0);
      }
    }
  });
});
