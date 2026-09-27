// Сутки на площади каторги (v2.80): двадцать настоящих минут, как в
// Майнкрафте. Час берётся из `Date.now()`, а не из того, сколько игрок
// простоял на площади, — поэтому сутки одни для всех: вышел в шахту на пять
// минут и вернулся — на площади уже стемнело, как и у соседа.
//
// Доли: день 50%, закат 7,5%, ночь 35%, рассвет 7,5%. Ночь короче дня не
// из-за реализма, а ради игры: в темноте хуже видно двери, и десять минут
// ночи подряд были бы наказанием, а не настроением.

export const DAY_MS = 20 * 60_000;

/** Где начинается каждая часть суток, доля от 0 до 1. */
export const DAWN = 0;
export const DAY = 0.075;
export const DUSK = 0.575;
export const NIGHT = 0.65;

export type DayPart = 'dawn' | 'day' | 'dusk' | 'night';

/** Час суток площади: 0…1, одинаков у всех. */
export function dayPhase(now = Date.now()): number {
  const m = now % DAY_MS;
  return (m < 0 ? m + DAY_MS : m) / DAY_MS;
}

export function dayPart(phase: number): DayPart {
  const p = wrap(phase);
  if (p < DAY) return 'dawn';
  if (p < DUSK) return 'day';
  if (p < NIGHT) return 'dusk';
  return 'night';
}

/** Темнота поверх площади: цвет и непрозрачность слоя. */
export interface Shade {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Ключевые кадры темноты. Слой ложится на мир обычным наложением, поэтому
 * цвет — это то, во что тонет картинка: ночью в глубокий синий, на закате —
 * через оранжевый в фиолетовый, на рассвете — через розовый в золото. Днём
 * слоя нет вовсе (a = 0). Последний кадр равен первому — сутки замкнуты.
 */
const KEYS: [phase: number, s: Shade][] = [
  [0, { r: 12, g: 18, b: 52, a: 0.64 }],
  [0.028, { r: 96, g: 58, b: 112, a: 0.44 }],
  [0.052, { r: 236, g: 138, b: 112, a: 0.24 }],
  [0.068, { r: 255, g: 196, b: 120, a: 0.08 }],
  [DAY, { r: 255, g: 214, b: 150, a: 0 }],
  [DUSK - 0.01, { r: 255, g: 190, b: 120, a: 0 }],
  [DUSK + 0.02, { r: 238, g: 116, b: 48, a: 0.22 }],
  [DUSK + 0.05, { r: 110, g: 44, b: 118, a: 0.42 }],
  [NIGHT, { r: 20, g: 22, b: 70, a: 0.6 }],
  [0.82, { r: 8, g: 12, b: 42, a: 0.7 }],
  [1, { r: 12, g: 18, b: 52, a: 0.64 }],
];

const wrap = (p: number) => p - Math.floor(p);

/** Темнота на час `phase` — между ключевыми кадрами по прямой. */
export function shadeAt(phase: number): Shade {
  const p = wrap(phase);
  for (let i = 1; i < KEYS.length; i++) {
    const [p1, b] = KEYS[i];
    if (p > p1) continue;
    const [p0, a] = KEYS[i - 1];
    const k = p1 > p0 ? (p - p0) / (p1 - p0) : 0;
    return {
      r: a.r + (b.r - a.r) * k,
      g: a.g + (b.g - a.g) * k,
      b: a.b + (b.b - a.b) * k,
      a: a.a + (b.a - a.a) * k,
    };
  }
  return { ...KEYS[0][1] };
}

/**
 * Насколько сейчас ночь, 0…1: прожекторы, ночные фонари, свет в окнах
 * берут силу отсюда. Это просто непрозрачность темноты, приведённая к её
 * пику: на закате свет разгорается ровно так, как темнеет.
 */
export function nightness(phase: number): number {
  return Math.max(0, Math.min(1, shadeAt(phase).a / 0.64));
}

/** Детерминированная доля 0…1 для номера фонаря — не `Math.random`. */
function frac(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Горит ли ночной фонарь `i`. Зажигаются по очереди на закате — не разом,
 * как по рубильнику, — и гаснут вразнобой на рассвете. Разброс только
 * внутри своей части суток: к ночи горят все, днём — ни один.
 */
export function lampsOn(phase: number, i: number): boolean {
  const p = wrap(phase);
  const on = DUSK + (NIGHT - DUSK) * (0.15 + 0.7 * frac(i, 1));
  const off = DAWN + (DAY - DAWN) * (0.25 + 0.65 * frac(i, 2));
  return p >= on || p < off;
}
