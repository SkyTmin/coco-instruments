// Сгенерировано scripts/props-pixel/post.py — руками не править.
// Набор «eggs»: полосы в public/ui/px/eggs/, прямоугольники — в пикселях рисунка от левого
// верхнего угла рамки (`box`), у крупных (`-l`) — в пикселях своей рамки (`large`).
import type { PxManifest } from './types';

export const PX: PxManifest = {
  set: 'eggs',
  box: 36,
  large: 112,
  strips: {
    'idle-moss': {
      n: 48,
      fps: 24,
      loop: true,
      s: { x: 5, y: 2, w: 26, h: 35, cols: 48 },
      l: { x: 20, y: 11, w: 72, h: 99, cols: 48 },
      rev: '20c78b82',
    },
    'hatch-moss-r0': {
      n: 24,
      fps: 24,
      loop: false,
      marks: { crack1: 8, burst: 16, clear: 23 },
      s: { x: 5, y: -3, w: 26, h: 39, cols: 24 },
      l: { x: 20, y: -5, w: 72, h: 114, cols: 24 },
      rev: '5dd47311',
    },
  },
};
