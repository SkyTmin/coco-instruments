// Подсчёт выигрыша — «ролл-ап». Не анимация числа, а СЦЕНА.
//
// Чем это было и почему не работало. Сумма ехала через `AnimatedNumber` с
// фиксированной длительностью: 400 мс в строке статуса, 700 в результате,
// 1400 в тотеме. Значит ×2 и ×500 считались одинаково долго — редчайшая
// сфера проскакивала за те же четыреста миллисекунд, что и мелочь. Вдобавок
// easeOutCubic начинает быстро и ТОРМОЗИТ к концу: самые крупные разряды
// пролетают мгновенно, а последние копейки ползут. Ровно наоборот тому, что
// нужно.
//
// Как устроено здесь. Три правила, все три взяты у настоящих автоматов:
//
//   1. ДЛИТЕЛЬНОСТЬ ПРОПОРЦИОНАЛЬНА ВЫИГРЫШУ. Не «столько-то миллисекунд»,
//      а «столько ступеней, сколько он пробил». Мелкий выигрыш считается
//      полсекунды, максимальный — пятнадцать. Время нельзя назначить: оно
//      должно быть следствием суммы, иначе размер выигрыша не ощущается.
//
//   2. СЧЁТ ПРОБИВАЕТ ПОРОГИ. На каждой ступени он замирает, звучит удар,
//      меняется титул — и счёт продолжается ДАЛЬШЕ. Это главное: пока число
//      просто доезжает до итога, смотреть не на что; как только оно проходит
//      «КРУПНЫЙ ВЫИГРЫШ» и не останавливается, начинается то самое «а
//      сколько же будет». Пауза здесь не задержка, а вопрос.
//
//   3. ТЕМП РОВНЫЙ. Механический ролл-ап не ускоряется и не замедляется —
//      он идёт как счётчик на бензоколонке. Замедление в конце читается как
//      «выдохлось», ускорение — как «пропускает».
//
// Ступени заодно дают титулы: имя выигрыша не назначается по `kind`, а
// вычитывается из того, какую ступень он пробил. Одно место правды.

/** Ступень выигрыша. `at` — нижняя граница в СТАВКАХ, а не в монетах. */
export interface WinTier {
  id: string;
  at: number;
  name: string;
  /** Вес события, 0…4: сколько тактов положено пробою этой ступени. */
  beats: number;
}

/**
 * Лестница. Шаг между ступенями примерно втрое — так пробой каждой следующей
 * ощущается как отдельное событие, а не как продолжение прошлого. Верхняя
 * ступень совпадает с пределом выигрыша (MAX_WIN в scatter.ts): «МАКСИМУМ»
 * должен существовать, чтобы его можно было хотеть.
 */
export const WIN_TIERS: WinTier[] = [
  { id: 'back', at: 1, name: 'ВЕРНУЛОСЬ', beats: 0 },
  { id: 'nice', at: 3, name: 'ЕСТЬ НАВАР', beats: 0 },
  { id: 'good', at: 10, name: 'ХОРОШИЙ ВЫИГРЫШ', beats: 1 },
  { id: 'big', at: 25, name: 'КРУПНЫЙ ВЫИГРЫШ', beats: 2 },
  { id: 'huge', at: 75, name: 'ОГРОМНЫЙ ВЫИГРЫШ', beats: 2 },
  { id: 'mega', at: 200, name: 'МЕГА-ВЫИГРЫШ', beats: 3 },
  { id: 'insane', at: 600, name: 'НЕВЕРОЯТНЫЙ ВЫИГРЫШ', beats: 3 },
  { id: 'legend', at: 2000, name: 'ЛЕГЕНДАРНЫЙ ВЫИГРЫШ', beats: 4 },
  { id: 'max', at: 5000, name: 'МАКСИМУМ', beats: 4 },
];

/** Самая высокая ступень, взятая выигрышем в `x` ставок. */
export function winTier(x: number): WinTier | null {
  let found: WinTier | null = null;
  for (const tier of WIN_TIERS) if (x >= tier.at) found = tier;
  return found;
}

/** Отрезок счёта: доползти до `to`, пробить ступень, подержать паузу. */
export interface RollupLeg {
  to: number;
  ms: number;
  tier: WinTier | null;
  hold: number;
}

export interface RollupPlan {
  from: number;
  to: number;
  legs: RollupLeg[];
  /** Вся длительность вместе с паузами. */
  ms: number;
  /** Самая высокая пробитая ступень — она и даёт титул. */
  top: WinTier | null;
}

/** Базовая длина отрезка и надбавка за каждый следующий: счёт «тяжелеет». */
const LEG_MS = 700;
const LEG_GROW = 110;
/** Минимум на последний, неполный отрезок — иначе он мелькает. */
const TAIL_MS = 360;
/** Пауза после пробоя по весу ступени. Тишина — тоже такт. */
const HOLD = [150, 380, 560, 740, 920];
/** Потолок: даже максимальный выигрыш не считается дольше. */
export const ROLLUP_MAX_MS = 16_000;

/**
 * План счёта от `from` до `to` при ставке `bet`.
 *
 * `from` важен: в «Каскаде» база уже посчитана во время каскада, и настоящее
 * событие — это путь от базы к итогу после множителя. Именно он и пробивает
 * все ступени разом, когда сработала крупная сфера.
 */
export function rollupPlan(from: number, to: number, bet: number): RollupPlan {
  const span = to - from;
  if (!(span > 0) || !(bet > 0)) return { from, to, legs: [], ms: 0, top: null };

  const crossed = WIN_TIERS.filter((t) => t.at * bet > from && t.at * bet <= to);
  const legs: RollupLeg[] = [];
  let at = from;
  crossed.forEach((tier, i) => {
    legs.push({
      to: tier.at * bet,
      ms: LEG_MS + i * LEG_GROW,
      tier,
      hold: HOLD[tier.beats] ?? HOLD[0],
    });
    at = tier.at * bet;
  });

  // Хвост — сколько успели пройти внутрь ступени, которую НЕ пробили.
  // Его длина пропорциональна пройденной доле, иначе выигрыш чуть выше
  // порога считался бы столько же, сколько выигрыш перед следующим.
  if (to > at) {
    const next = WIN_TIERS.find((t) => t.at * bet > at);
    const full = next ? next.at * bet - at : to - at;
    const frac = full > 0 ? Math.min(1, (to - at) / full) : 1;
    legs.push({
      to,
      ms: TAIL_MS + (LEG_MS + crossed.length * LEG_GROW) * frac,
      tier: null,
      hold: 0,
    });
  }

  let ms = legs.reduce((s, l) => s + l.ms + l.hold, 0);
  if (ms > ROLLUP_MAX_MS) {
    // Ужимаем только ход, но не паузы: паузы и есть событие.
    const holds = legs.reduce((s, l) => s + l.hold, 0);
    const k = Math.max(0.2, (ROLLUP_MAX_MS - holds) / (ms - holds));
    legs.forEach((l) => {
      l.ms *= k;
    });
    ms = legs.reduce((s, l) => s + l.ms + l.hold, 0);
  }

  return { from, to, legs, ms, top: crossed.length ? crossed[crossed.length - 1] : null };
}

/**
 * План без ступеней: просто доползти за `ms`. Для мелких промежуточных
 * пересчётов — например, выплаты одного звена каскада, где титулы и паузы
 * только мешали бы ритму самого каскада.
 */
export function plainPlan(from: number, to: number, ms: number): RollupPlan {
  if (!(to > from)) return { from, to, legs: [], ms: 0, top: null };
  return { from, to, legs: [{ to, ms, tier: null, hold: 0 }], ms, top: null };
}

export interface RollupHandlers {
  /** Текущее показание. Зовётся каждый кадр — писать в DOM, не в состояние. */
  value: (n: number) => void;
  /** Тик счётчика: `leg` — номер отрезка, `k` — доля пути внутри него. */
  tick?: (leg: number, k: number) => void;
  /** Ступень пробита. */
  tier?: (tier: WinTier, at: number, leg: number) => void;
  done?: () => void;
}

/** Тик счётчика — ровная дробь, независимо от суммы. Считает МАШИНА. */
const TICK_MS = 52;

/**
 * Проигрывает план. Возвращает «оборвать»: зовите её и по тапу игрока
 * (счёт обязан быть пропускаемым — иначе длинный ролл-ап превращается
 * из награды в наказание), и при размонтировании.
 */
export function runRollup(plan: RollupPlan, h: RollupHandlers, speed = 1): () => void {
  let raf = 0;
  let stopped = false;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    h.value(plan.to);
    h.done?.();
  };

  if (!plan.legs.length) {
    h.value(plan.to);
    h.done?.();
    return () => {};
  }

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  if (reduce) {
    // Без движения план вырождается в один кадр, но ступени всё равно
    // объявляем: титул — это информация, а не украшение.
    plan.legs.forEach((l, i) => l.tier && h.tier?.(l.tier, l.to, i));
    h.value(plan.to);
    h.done?.();
    return () => {};
  }

  let leg = 0;
  let from = plan.from;
  let startedAt = performance.now();
  let holding = false;
  let lastTick = 0;

  const frame = (now: number) => {
    if (stopped) return;
    const l = plan.legs[leg];
    const dur = Math.max(1, l.ms * speed);
    const held = Math.max(0, l.hold * speed);
    const t = (now - startedAt) / (holding ? held : dur);

    if (!holding) {
      const k = Math.min(1, t);
      h.value(from + (l.to - from) * k);
      if (now - lastTick >= TICK_MS * speed) {
        lastTick = now;
        h.tick?.(leg, k);
      }
      if (k >= 1) {
        if (l.tier) h.tier?.(l.tier, l.to, leg);
        if (held > 0) {
          holding = true;
          startedAt = now;
        } else {
          from = l.to;
          leg += 1;
          startedAt = now;
          if (leg >= plan.legs.length) return finish();
        }
      }
    } else if (t >= 1) {
      holding = false;
      from = l.to;
      leg += 1;
      startedAt = now;
      if (leg >= plan.legs.length) return finish();
    }

    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return finish;
}
