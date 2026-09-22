// Движение барабана. Одно на обе игры: и три барабана «Слотов», и шесть
// колонок «Каскада» крутятся по одному и тому же плану.
//
// Чем это было и почему не работало. Лента ехала одной кривой
// `cubic-bezier(.18,.76,.24,1.06)` за всю длительность вращения. Такая кривая
// стартует в четыре раза быстрее средней скорости и тормозит всё остальное
// время. Замер на стенде: первая колонка «Каскада» проходила 90% пути за
// 400 мс из 780, а оставшиеся 380 мс ползла на последних пикселях — всё ещё
// размытая. Пик скорости — 78 px за кадр, больше клетки: символы не текли,
// а стробили. И раз путь у всех колонок был один и тот же, поздняя колонка
// просто ехала медленнее ранней: шесть барабанов в середине спина стояли
// почти одинаково, и поочерёдной остановки было не видно.
//
// Как устроено здесь — как у механического барабана:
//
//   1. ЗАМАХ. Лента дёргается назад на восьмую клетки — рычаг сорвал барабан.
//   2. РАЗГОН. Из покоя до ровного хода, скорость растёт линейно.
//   3. РОВНЫЙ ХОД. Скорость ОДНА И ТА ЖЕ у всех барабанов обеих игр. Поздний
//      барабан не медленнее, он просто дольше крутится: путь считается от
//      длительности, а не длительность подгоняется под путь.
//   4. ТОРМОЖЕНИЕ с проездом на шестую клетки мимо гнезда.
//   5. ВОЗВРАТ в гнездо — тот самый механический отскок.
//
// Скорость непрерывна на всех стыках (кривые фаз подобраны по наклонам на
// концах), поэтому шов между фазами не виден. Размытие включается только на
// скорости: тормозящий барабан уже резкий, как в жизни.
//
// Длинное вращение (предвкушение бонуса тянет колонку секунды по три) не
// раздувает ленту: ровный ход проходит по ПЕТЛЕ. Участок пролёта повторяет
// в конце собственное начало, и лента на ровном ходу незаметно прыгает назад
// на длину петли — в окне в этот момент стоит ровно то же самое.

/** Параметры хода. Длительности фаз — для обычного темпа, турбо их ужимает. */
export const REEL = {
  /** Замах назад, доля клетки. */
  kick: 0.12,
  kickMs: 70,
  accelMs: 140,
  decelMs: 220,
  settleMs: 150,
  /** Проезд мимо гнезда перед возвратом, доля клетки. */
  overshoot: 0.16,
  /**
   * Скорость ровного хода, клеток за миллисекунду. 0,024 — это 0,4 клетки
   * за кадр при 60 Гц: быстрее глаз перестаёт видеть направление и символы
   * начинают стробить.
   */
  speed: 0.024,
  /** Больше этого числа пролетающих клеток лента не бывает — дальше петля. */
  maxFiller: 48,
  /** Длина петли в клетках. */
  loop: 20,
} as const;

/** Кривые фаз. Наклоны на концах совпадают — отсюда непрерывная скорость. */
export const REEL_EASE = {
  /** Быстрый срыв назад, в конце скорость 0 — точка разворота. */
  kick: 'cubic-bezier(0.2, 0.7, 0.4, 1)',
  /** Квадратичный разгон из покоя: в конце наклон 2 = ровно скорость хода. */
  accel: 'cubic-bezier(0.11, 0, 0.5, 0)',
  cruise: 'linear',
  /** Квадратичное торможение: в начале наклон 2 = скорость хода, в конце 0. */
  decel: 'cubic-bezier(0.5, 1, 0.89, 1)',
  /** Возврат в гнездо: плавно с обеих сторон. */
  settle: 'cubic-bezier(0.37, 0, 0.63, 1)',
} as const;

export interface ReelFrame {
  offset: number;
  transform: string;
  easing: string;
  /** Положение ленты, px (для тестов и замеров). */
  y: number;
}

export interface ReelPlan<T> {
  /** Лента: голова над окном, то, что на экране, пролёт, результат, хвост. */
  strip: T[];
  keyframes: ReelFrame[];
  duration: number;
  /** translateY ленты в покое до вращения и после, px. */
  startY: number;
  endY: number;
  /** Когда включить и снять размытие, мс от старта. */
  blurOn: number;
  blurOff: number;
  /** Удар: символы дошли до гнёзд. Здесь звучит остановка барабана. */
  impact: number;
  /** Скорость ровного хода, px/мс. */
  speed: number;
  /** Сколько клеток физически проехало мимо окна (с учётом петель). */
  travel: number;
  /** Сколько раз лента прошла петлю. */
  loops: number;
}

export interface ReelInput<T> {
  /** Что стоит в окне сейчас — с этого вращение и начинается. */
  from: T[];
  /** Результат. */
  to: T[];
  filler: () => T;
  /** Высота клетки, px. */
  cell: number;
  /** Длительность всего вращения, мс. */
  duration: number;
  /** Доля длительности фаз: 1 — обычный ход, 0,5 — турбо. */
  tempo?: number;
  /** Во сколько раз быстрее ровный ход (турбо). */
  speedup?: number;
}

const ty = (y: number) => `translateY(${y.toFixed(2)}px)`;

/** Лента в покое: голова, поле, хвост. Никакого движения. */
export function restReel<T>(grid: T[], filler: () => T, cell: number): ReelPlan<T> {
  return {
    strip: [filler(), ...grid, filler()],
    keyframes: [],
    duration: 0,
    startY: -cell,
    endY: -cell,
    blurOn: 0,
    blurOff: 0,
    impact: 0,
    speed: 0,
    travel: 0,
    loops: 0,
  };
}

/** План одного вращения. Чистая функция: ленту и кадры можно проверить тестом. */
export function planReel<T>(input: ReelInput<T>): ReelPlan<T> {
  const { from, to, filler, cell, duration } = input;
  const rows = to.length;
  const tempo = input.tempo ?? 1;

  let K = REEL.kickMs * tempo;
  let A = REEL.accelMs * tempo;
  let Dc = REEL.decelMs * tempo;
  let S = REEL.settleMs * tempo;
  // Совсем короткое вращение: фазы ужимаются, но ровный ход всё равно есть.
  const fixed = K + A + Dc + S;
  if (fixed > duration * 0.85) {
    const f = (duration * 0.85) / fixed;
    K *= f;
    A *= f;
    Dc *= f;
    S *= f;
  }
  const C = Math.max(0, duration - (K + A + Dc + S));

  const k = REEL.kick * cell;
  const o = REEL.overshoot * cell;
  const v0 = REEL.speed * cell * (input.speedup ?? 1);
  // Время, которое лента «едет на полной скорости», если сложить фазы:
  // разгон и торможение из покоя/в покой — это половина их длительности.
  const span = A / 2 + C + Dc / 2;
  // Путь — целое число клеток, иначе результат не встанет в окно. Скорость
  // подгоняется под него на доли процента.
  const N = Math.max(rows, Math.round((v0 * span - o - k) / cell));
  const V = (N * cell + o + k) / span;

  let fill = N - rows;
  let loops = 0;
  if (fill > REEL.maxFiller) {
    loops = Math.ceil((fill - REEL.maxFiller) / REEL.loop);
    fill -= loops * REEL.loop;
  }
  const cells = Array.from({ length: fill }, () => filler());
  // Петля: конец участка повторяет его начало на высоту окна с запасом,
  // поэтому прыжок назад на длину петли в окне не виден.
  if (loops) for (let i = 0; i <= rows; i++) cells[REEL.loop + i] = cells[i];

  const strip = [filler(), ...from, ...cells, ...to, filler()];
  const startY = -cell;
  const nStrip = N - loops * REEL.loop;
  const endY = startY - nStrip * cell;

  const frames: ReelFrame[] = [];
  const push = (t: number, y: number, easing: string) => {
    const prev = frames.length ? frames[frames.length - 1].offset : 0;
    const offset = Math.min(1, Math.max(prev, duration > 0 ? t / duration : 1));
    frames.push({ offset, transform: ty(y), easing, y });
  };

  const pAccel = -k + (V * A) / 2;
  push(0, startY, REEL_EASE.kick);
  push(K, startY + k, REEL_EASE.accel);
  push(K + A, startY - pAccel, REEL_EASE.cruise);
  for (let m = 1; m <= loops; m++) {
    const p = (rows + m * REEL.loop) * cell;
    const t = K + A + (p - pAccel) / V;
    push(t, startY - (p - (m - 1) * REEL.loop * cell), REEL_EASE.cruise);
    push(t, startY - (p - m * REEL.loop * cell), REEL_EASE.cruise);
  }
  const pCruise = pAccel + V * C;
  push(K + A + C, startY - (pCruise - loops * REEL.loop * cell), REEL_EASE.decel);
  push(K + A + C + Dc, endY - o, REEL_EASE.settle);
  push(duration, endY, 'linear');

  // Удар — когда символы впервые дошли до гнёзд, ещё до проезда. Для
  // квадратичного торможения оставшийся путь равен d·(1−u)², отсюда корень.
  const d = (V * Dc) / 2;
  const impact = K + A + C + Dc * (d > o ? 1 - Math.sqrt(o / d) : 1);

  return {
    strip,
    keyframes: frames,
    duration,
    startY,
    endY,
    blurOn: K + A * 0.45,
    blurOff: K + A + C + Dc * 0.35,
    impact,
    speed: V,
    travel: N,
    loops,
  };
}

/** Кадры для Element.animate: без служебного поля `y`. */
export function reelKeyframes(plan: ReelPlan<unknown>): Keyframe[] {
  return plan.keyframes.map(({ offset, transform, easing }) => ({ offset, transform, easing }));
}

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Проиграть план на ленте. Возвращает «снять»: для эффекта React.
 *
 * Покой ставится инлайн-стилем, а не заливкой анимации (`fill: 'forwards'`).
 * Законченная анимация с заливкой всё ещё числится у элемента, и стоп-кадр
 * (`juice.hitStop`) её ставил бы на паузу и запускал снова — а запуск
 * законченной анимации перематывает её в начало. Поле закрутилось бы ещё раз.
 */
export function spinReel(
  el: HTMLElement | null,
  plan: ReelPlan<unknown>,
  spinId: number,
  onImpact: () => void,
): (() => void) | undefined {
  if (!el) return undefined;
  el.style.transform = `translateY(${plan.endY}px)`;
  if (spinId === 0 || !plan.keyframes.length) return undefined;
  if (reduceMotion()) {
    onImpact();
    return undefined;
  }
  let anim: Animation | null = null;
  try {
    anim = el.animate(reelKeyframes(plan), { duration: plan.duration });
  } catch {
    anim = null; // движок без WAAPI — лента просто встанет на место
  }
  const timers = [
    // Размытие — только на скорости. Замах, разгон и торможение резкие.
    setTimeout(() => el.classList.add('is-blur'), plan.blurOn),
    setTimeout(() => el.classList.remove('is-blur'), plan.blurOff),
    setTimeout(onImpact, plan.impact),
  ];
  return () => {
    timers.forEach(clearTimeout);
    el.classList.remove('is-blur');
    anim?.cancel();
  };
}
