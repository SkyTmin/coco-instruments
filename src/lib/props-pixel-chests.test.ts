import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Px } from './dungeon-art';
import * as chests from './props-pixel/chests';
import { LID_OPEN, RES, STRIPS, TIERS, __test, frame } from './props-pixel/chests';
import { PX } from './props-pixel/sprites-chests';
import { manifestProblems, pxDiff, sameBytes, seamRatio } from './props-pixel/testkit';
import type { Res } from './props-pixel/types';

const ROOT = path.resolve(__dirname, '../..');

/** Рамка непрозрачных пикселей кадра: [x0, y0, x1, y1]. */
function bbox(p: Px): [number, number, number, number] {
  const b: [number, number, number, number] = [p.w, p.h, -1, -1];
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3] > 0) {
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], y);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], y);
      }
  return b;
}

const resOf = (name: string): Res[] => (STRIPS[name].res ?? ['s', 'l']) as Res[];

describe('пиксельные сундуки', () => {
  it('кадр детерминирован, размер холста — по разрешению; вращение только крупное', () => {
    for (const name of Object.keys(STRIPS))
      for (const res of resOf(name)) {
        const a = frame(name, 1, res);
        expect([a.w, a.h]).toEqual([RES[res].cw, RES[res].ch]);
        expect(sameBytes(a, frame(name, 1, res))).toBe(true);
      }
    expect(STRIPS['mystery-spin'].res).toEqual(['l']);
  });

  it('манифест и файлы сходятся с рисовальщиком', () => {
    expect(manifestProblems(chests, PX, ROOT)).toEqual([]);
  });

  it('петли без шва: покой всех пяти и вращение', () => {
    for (const k of ['common', 'rare', 'epic', 'legend', 'mystery'])
      expect(seamRatio(chests, `idle-${k}`, 's'), k).toBeLessThanOrEqual(1);
    expect(seamRatio(chests, 'mystery-spin', 'l')).toBeLessThanOrEqual(1);
  });

  it('вращение: кадр 0 — тот же тёмный сундук, что в покое; два оборота за 0,9 с', () => {
    expect(sameBytes(frame('mystery-spin', 0, 'l'), frame('idle-mystery', 0, 'l'))).toBe(true);
    const st = STRIPS['mystery-spin'];
    expect(st.frames / st.fps).toBeGreaterThan(0.85);
    expect(st.frames / st.fps).toBeLessThan(0.95);
    const y = (i: number) => __test.poseOf('mystery-spin', i / st.fps).yaw;
    expect(y(st.frames) - y(0)).toBeCloseTo(4 * Math.PI, 6);
  });

  it('метки открытия по порядку и внутри полосы; якорь замка у всех ярусов один', () => {
    for (const t of TIERS) {
      const st = STRIPS[`open-${t}`];
      const m = st.marks!;
      expect(m.turn).toBeLessThan(m.latch);
      expect(m.latch).toBeLessThan(m.lidOpen);
      expect(m.lidOpen).toBeLessThanOrEqual(m.peak);
      expect(m.peak).toBeLessThan(st.frames - 4);
      expect(st.anchors?.lock).toEqual(STRIPS[`idle-${t}`].anchors?.lock);
    }
    // Старшим — дольше: лестница редкости в длине открытия и в моменте крышки.
    const len = TIERS.map((t) => STRIPS[`open-${t}`].frames);
    expect([...len].sort((a, b) => a - b)).toEqual(len);
    const lid = TIERS.map((t) => STRIPS[`open-${t}`].marks!.lidOpen);
    expect([...lid].sort((a, b) => a - b)).toEqual(lid);
  });

  it('ключ поворачивается и тает до того, как тронется крышка; защёлка — до крышки', () => {
    for (const t of TIERS) {
      const st = STRIPS[`open-${t}`];
      const m = st.marks!;
      const P = (i: number) => __test.poseOf(`open-${t}`, i / st.fps);
      expect(P(0).keyVis).toBe(1);
      expect(P(0).key).toBe(0);
      expect(P(m.latch).key).toBeCloseTo(Math.PI / 2, 3);
      expect(P(m.latch).hasp).toBeGreaterThan(0);
      for (let i = 0; i < m.lidOpen; i++) expect(P(i).lid, `${t} ${i}`).toBeLessThan(0.25);
      expect(P(m.lidOpen + 1).keyVis).toBe(0);
    }
  });

  it('последний кадр открытия — покой: крышка на упоре, эффекты кончились', () => {
    for (const t of TIERS) {
      const name = `open-${t}`;
      const n = STRIPS[name].frames;
      const o = __test.poseOf(name, (n - 1) / STRIPS[name].fps);
      expect(o.lid).toBeCloseTo(LID_OPEN, 6);
      expect([o.keyVis, o.beam, o.flash, o.leak, o.lift, o.shx, o.roll]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect([o.sz, o.sxy]).toEqual([1, 1]);
      // Два последних кадра одинаковы: пыль, искры и монеты погасли раньше.
      for (const res of ['s', 'l'] as Res[])
        expect(sameBytes(frame(name, n - 1, res), frame(name, n - 2, res)), `${name}/${res}`).toBe(
          true,
        );
    }
  });

  it('кадр 0 покоя — закрытая иконка; открытие начинается с неё же (разница — только ключ)', () => {
    for (const t of TIERS) {
      const p = __test.poseOf(`idle-${t}`, 0);
      expect(p.sheen).toBe(-1);
      expect([p.lid, p.lift, p.twinkle, p.keyVis]).toEqual([0, 0, 0, 0]);
      const d = pxDiff(frame(`open-${t}`, 0, 's'), frame(`idle-${t}`, 0, 's'));
      expect(d, t).toBeGreaterThan(0);
      expect(d, t).toBeLessThan(0.03);
    }
  });

  it('крышка на задней петле: открытая поднимается над закрытой, дно стоит на месте', () => {
    for (const t of TIERS) {
      const shut = bbox(frame(`idle-${t}`, 0, 'l'));
      const open = bbox(frame(`open-${t}`, -1 + STRIPS[`open-${t}`].frames, 'l'));
      // Крышка встаёт вверх и назад — выше закрытой минимум на треть высоты корпуса.
      expect(shut[1] - open[1], t).toBeGreaterThan(20);
      // Дно и левый (передний) бок — те же: сундук не сдвинулся, крышка не вылезла вперёд.
      expect(Math.abs(open[3] - shut[3]), t).toBeLessThanOrEqual(1);
      expect(Math.abs(open[0] - shut[0]), t).toBeLessThanOrEqual(3);
      // Сундук повёрнут задом вправо: откинутая назад крышка выходит вправо, но немного.
      expect(open[2] - shut[2], t).toBeGreaterThanOrEqual(0);
      expect(open[2] - shut[2], t).toBeLessThanOrEqual(16);
    }
  });

  it('ничего не касается края холста (запас на свет и монеты)', () => {
    for (const name of ['open-legend', 'open-epic', 'mystery-spin'])
      for (const res of resOf(name)) {
        const n = STRIPS[name].frames;
        for (let i = 0; i < n; i += 3) {
          const [x0, y0, x1, y1] = bbox(frame(name, i, res));
          if (x1 < 0) continue;
          expect(x0 > 0 && y0 > 0 && x1 < RES[res].cw - 1 && y1 < RES[res].ch - 1, `${name}/${res} #${i}`).toBe(
            true,
          );
        }
      }
  });
});
