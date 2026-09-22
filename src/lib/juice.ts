// «Сочность» — приёмы, которые не меняют правила игры, а меняют то, сколько
// игра о них рассказывает. Взяты из двух канонических докладов: «Juice it or
// lose it» (Jonasson & Purho) и «The Art of Screenshake» (Jan Willem Nijman),
// плюс математика тряски из «Juicing Your Cameras With Math» (Squirrel
// Eiserloh). Всё написано с нуля: заимствованы приёмы и числа, не код.
//
// Правила бюджета, которым здесь следуют все функции:
//   • анимируем только transform и opacity — они лежат на композиторе;
//   • НЕ анимируем радиус blur и параметры градиента: это перерисовка кадра;
//   • всё уважает prefers-reduced-motion и молча выключается.

const reduce = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// ---------------------------------------------------------------------------
// Стоп-кадр
// ---------------------------------------------------------------------------

/**
 * Пауза длиной в несколько кадров прямо перед выплатой. Приём из файтингов:
 * мозг читает остановку как удар, а длина паузы — как силу удара. Это самый
 * выгодный эффект из всех: полтора десятка строк и ни одного пикселя.
 *
 * Работает честно — замораживает все запущенные анимации поддерева, а не
 * подменяет их. Если getAnimations в этом движке нет, просто ничего не делает.
 */
export const HIT_STOP = { small: 40, big: 120, mega: 180 } as const;

export function hitStop(root: Element | null, ms: number): void {
  if (!root || reduce() || ms <= 0) return;
  let anims: Animation[] = [];
  try {
    anims = root.getAnimations({ subtree: true });
  } catch {
    return; // движок не умеет — обойдёмся без паузы
  }
  // Только идущие. Законченная анимация с заливкой (`fill: both`) тоже
  // числится у элемента, а `play()` законченной перематывает её в начало:
  // стоп-кадр во время выплаты заново ронял уже упавшие клетки, заново
  // впечатывал жетон и заново выкатывал титул.
  anims = anims.filter((a) => a.playState === 'running');
  if (!anims.length) return;
  for (const a of anims) {
    try {
      a.pause();
    } catch {
      /* анимация уже снята */
    }
  }
  window.setTimeout(() => {
    for (const a of anims) {
      try {
        a.play();
      } catch {
        /* анимация уже снята */
      }
    }
  }, ms);
}

// ---------------------------------------------------------------------------
// Кадр-вспышка
// ---------------------------------------------------------------------------

/**
 * Полноэкранная вспышка на 60–110 мс. Её работа — спрятать склейку: всё, что
 * меняется на экране во время вспышки, читается как ею вызванное. Именно она
 * превращает «стоп-кадр, взрыв, счётчик» в одно событие вместо трёх.
 */
export function flashFrame(tier: 'small' | 'big' | 'mega' = 'big'): void {
  if (typeof document === 'undefined' || reduce()) return;
  const peak = tier === 'mega' ? 0.92 : tier === 'big' ? 0.7 : 0.35;
  const ms = tier === 'mega' ? 110 : tier === 'big' ? 80 : 60;

  const el = document.createElement('div');
  el.className = 'juice-flash';
  document.body.appendChild(el);
  const done = () => el.remove();
  try {
    const a = el.animate([{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: 0 }], {
      duration: ms,
      easing: 'cubic-bezier(.16,1,.3,1)',
    });
    a.onfinish = done;
    a.oncancel = done;
  } catch {
    done();
    return;
  }
  // Подстраховка: если анимация не доиграет (вкладку свернули), слой снимется.
  window.setTimeout(done, ms + 400);

  // У мега-выигрыша вторая, слабая вспышка — «эхо» через 180 мс.
  if (tier === 'mega') window.setTimeout(() => flashFrame('small'), 180);
}

// ---------------------------------------------------------------------------
// Тряска экрана
// ---------------------------------------------------------------------------

/**
 * Тряска по Айзерло: копится «травма» в [0,1], смещение пропорционально её
 * КВАДРАТУ (линейная не читается как удар), затухание — за две секунды.
 * Смещение берётся из гладкого шума, а не из Math.random: случайное число на
 * кадр выглядит как сломанный телевизор, гладкий шум — как камера в руках.
 * Оси берут шум с разных сдвигов, иначе они ходят синхронно.
 */
const SHAKE = {
  decay: 0.5, // полная травма гаснет за 2 с
  exponent: 2,
  maxAngle: 2.2, // градусы: корпус автомата, а не вся сцена — хватает малого
  maxPx: 9,
  noiseSpeed: 20,
} as const;

export const TRAUMA = { small: 0.15, big: 0.4, mega: 0.75 } as const;

/** Детерминированный псевдослучайный знак для целой точки. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Гладкий одномерный шум в [-1, 1]. */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  return hash(i) * (1 - smooth(f)) + hash(i + 1) * smooth(f);
}

let trauma = 0;
let seed = 0;
let raf = 0;
let target: HTMLElement | null = null;
let last = 0;

function frame(now: number): void {
  const el = target;
  if (!el) {
    raf = 0;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (trauma <= 0) {
    el.style.transform = '';
    raf = 0;
    target = null;
    return;
  }
  const s = Math.pow(trauma, SHAKE.exponent);
  const n = (now / 1000) * SHAKE.noiseSpeed;
  const x = SHAKE.maxPx * s * noise1(seed + n);
  const y = SHAKE.maxPx * s * noise1(seed + 100 + n);
  const r = SHAKE.maxAngle * s * noise1(seed + 200 + n);
  el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg)`;
  trauma = Math.max(0, trauma - SHAKE.decay * dt);
  raf = requestAnimationFrame(frame);
}

/**
 * Добавить травму указанному элементу. Травма копится: два события подряд
 * трясут сильнее одного, но никогда не выходят за единицу.
 */
export function addTrauma(el: HTMLElement | null, amount: number): void {
  if (!el || reduce()) return;
  target = el;
  trauma = Math.min(1, trauma + amount);
  seed = Math.random() * 1000;
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

/** Снять тряску немедленно — например, при уходе со страницы. */
export function stopShake(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  trauma = 0;
  if (target) target.style.transform = '';
  target = null;
}

// ---------------------------------------------------------------------------
// Сплющивание и растягивание
// ---------------------------------------------------------------------------

/**
 * Первый из двенадцати принципов Диснея и самый дешёвый способ изобразить
 * удар. Объём сохраняется (scaleX × scaleY ≈ 1) — именно это отличает
 * «сочно» от «болтается».
 *
 * `composite: 'add'` складывает сплющивание с тем трансформом, который на
 * элементе уже есть (его место в сетке, параллельная тряска), а не дерётся
 * с ним. Без этого символ прыгал бы в угол поля.
 */
export function squashPop(el: Element | null, power = 1): void {
  if (!el || reduce()) return;
  const s = (x: number, y: number) => `scale(${x.toFixed(3)}, ${y.toFixed(3)})`;
  try {
    el.animate(
      [
        { transform: s(1, 1), offset: 0 },
        { transform: s(1 + 0.28 * power, 1 - 0.22 * power), offset: 0.18 },
        { transform: s(1 - 0.16 * power, 1 + 0.2 * power), offset: 0.42 },
        { transform: s(1 + 0.07 * power, 1 - 0.05 * power), offset: 0.68 },
        { transform: s(1, 1), offset: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)', composite: 'add' },
    );
  } catch {
    /* движок без WAAPI-композита — обойдёмся */
  }
}
