import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as books from './props-pixel/books';
import { bookIdleBob } from './props-pixel/books-idle';
import { PX } from './props-pixel/sprites-books';
import { manifestProblems, pxDiff, sameBytes, seamRatio } from './props-pixel/testkit';
import type { Res } from './props-pixel/types';

const ROOT = path.resolve(__dirname, '../..');
const RES: Res[] = ['s', 'l'];
const empty = (p: { data: Uint8ClampedArray | Uint8Array }) => p.data.every((v, i) => i % 4 !== 3 || v === 0);

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
        for (let i = 0; i < n; i++) expect(books.idleBob(t, i, r)).toBe(bookIdleBob(t, i, n, scale));
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
        expect(pxDiff(books.frame(`reveal-${t}`, d.frames - 1, r), books.frame(`still-${t}`, 0, r))).toBe(0);
      // Знак загорается над разворотом, медальон — в рамке.
      const a = d.anchors!;
      expect(a.rise[1]).toBeLessThan(a.glyph[1]);
      for (const v of a.glyph) expect(v > 0 && v < 1).toBe(true);
    }
  });

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
