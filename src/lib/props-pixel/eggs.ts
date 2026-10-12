// Пиксельные яйца — ЗАГОТОВКА инфраструктуры (одно яйцо, петля и разовая с метками):
// проверяет запекание, манифест и `PxStrip`. Настоящий рисунок придёт следующим шагом.

import type { Px } from '../dungeon-art';
import {
  AX0,
  bump,
  drawParts,
  newFrame,
  ramp,
  selOutline,
  seams,
  toPx,
  hx,
} from '../pets-pixel/rig';
import type { Part } from '../pets-pixel/rig';
import type { Canvas, Res, StripDef } from './types';

export const RES: Record<Res, Canvas> = {
  s: { box: 36, cw: 96, ch: 96, bx: 30, by: 40 },
  l: { box: 112, cw: 300, ch: 300, bx: 94, by: 124 },
};

export const STRIPS: Record<string, StripDef> = {
  'idle-moss': { frames: 48, fps: 24, loop: true },
  'hatch-moss-r0': { frames: 24, fps: 24, loop: false, marks: { crack1: 8, burst: 16, clear: 23 } },
};

const PAL = [ramp('#2a3a1c', '#3d5426', '#55712f', '#73903c', '#98b058')];

export function frame(name: string, i: number, res: Res): Px {
  const cv = RES[res];
  const k = cv.box / 36;
  const f = newFrame(cv.cw, cv.ch);
  const def = STRIPS[name];
  const t = i / def.fps;
  const T = def.frames / def.fps;
  const breath = def.loop ? Math.sin((t / T) * Math.PI * 2) * 0.04 : 0;
  const pop = def.loop ? 0 : bump(t, 0.3, 0.7) * 6;
  const parts: Part[] = [
    {
      c: [0, 0, (15 + pop) * k],
      ax: AX0,
      r: [11 * k, 11 * k, 15 * k * (1 + breath)],
      pal: 0,
      id: 1,
    },
  ];
  drawParts(f, parts, PAL, cv.bx + cv.box / 2, cv.by + cv.box - 2 * k);
  seams(f);
  const p = toPx(f, PAL);
  selOutline(p, hx('#120c10'));
  return p;
}
