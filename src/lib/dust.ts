// «Пыль Таноса» — распад картинки на пиксели, как при удалении сообщения
// в Telegram. Символ рисуется в offscreen-канву, каждый непрозрачный пиксель
// становится частицей, и частицы разлетаются вверх-вправо, истаивая.
//
// Всё живёт на одной канве поверх барабанов: девять символов — это тысячи
// частиц, и DOM такого не выдержит, а канва рисует их одним проходом.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Задержка старта: левый край осыпается первым — это и даёт «распад». */
  delay: number;
  size: number;
  /** Цвет строкой считается один раз: на каждом кадре это были бы тысячи
      склеек `rgb(...)` — главный расход этого эффекта. */
  color: string;
  a: number;
}

/** Ячейка, которую нужно рассыпать: картинка и её место на канве (в CSS-px). */
export interface DustCell {
  img: CanvasImageSource;
  x: number;
  y: number;
  size: number;
}

/** Сколько живёт распад. */
export const DUST_MS = 820;

/** Шаг выборки пикселей: 2 — плотная пыль, 3 — экономнее на слабых телефонах. */
const STEP = 2;
/** Верхний предел частиц на всю канву. */
const MAX_PARTICLES = 2600;

/**
 * Рассыпает переданные ячейки на канве. Возвращает функцию отмены.
 * Канва должна покрывать те же координаты, в которых заданы ячейки.
 */
export function dustBurst(canvas: HTMLCanvasElement, cells: DustCell[]): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !cells.length) return () => {};

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return () => {};
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Снимаем пиксели каждой картинки во вспомогательной канве.
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!sctx) return () => {};

  const particles: Particle[] = [];
  const budget = Math.max(1, Math.floor(MAX_PARTICLES / cells.length));

  for (const cell of cells) {
    const n = Math.max(8, Math.round(cell.size / 2));
    scratch.width = n;
    scratch.height = n;
    sctx.clearRect(0, 0, n, n);
    try {
      sctx.drawImage(cell.img, 0, 0, n, n);
    } catch {
      continue; // картинка ещё не загрузилась — пропускаем ячейку
    }
    let data: Uint8ClampedArray;
    try {
      data = sctx.getImageData(0, 0, n, n).data;
    } catch {
      continue; // канва «запятнана» — эффекта просто не будет
    }

    const scale = cell.size / n;
    const found: Particle[] = [];
    for (let py = 0; py < n; py += STEP) {
      for (let px = 0; px < n; px += STEP) {
        const i = (py * n + px) * 4;
        const a = data[i + 3];
        if (a < 24) continue;
        const x = cell.x + px * scale;
        const y = cell.y + py * scale;
        found.push({
          x,
          y,
          // Разлёт вверх и вправо, как в Telegram; немного случайности.
          vx: 14 + Math.random() * 46,
          vy: -22 - Math.random() * 54,
          // Чем левее пиксель, тем раньше он срывается.
          delay: (px / n) * 0.42 + Math.random() * 0.12,
          size: Math.max(1, STEP * scale * 0.9),
          color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
          a: a / 255,
        });
      }
    }
    // Если пикселей больше бюджета — прореживаем равномерно.
    if (found.length > budget) {
      const keep = found.length / budget;
      for (let i = 0; i < budget; i++) particles.push(found[Math.floor(i * keep)]);
    } else {
      particles.push(...found);
    }
  }

  if (!particles.length) return () => {};
  // Один раз сортируем по цвету: в кадре fillStyle будет переключаться
  // столько раз, сколько в символе разных оттенков, а не по разу на пиксель.
  particles.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));

  let raf = 0;
  const start = performance.now();
  const dur = DUST_MS;

  const frame = (now: number) => {
    const t = (now - start) / dur;
    ctx.clearRect(0, 0, cssW, cssH);
    if (t >= 1) {
      raf = 0;
      return;
    }
    // Прозрачность округляем до шага 1/16 и группируем: смена globalAlpha и
    // fillStyle — самые дорогие вызовы канвы, а на глаз ступень незаметна.
    let lastAlpha = -1;
    let lastColor = '';
    for (const p of particles) {
      const life = (t - p.delay) / (1 - p.delay);
      if (life >= 1) continue;
      let x = p.x;
      let y = p.y;
      let alpha = p.a;
      if (life > 0) {
        const s = life * (dur / 1000);
        x += p.vx * s;
        y += p.vy * s + 120 * s * s; // лёгкая гравитация
        alpha = p.a * (1 - life) ** 1.4;
      }
      const stepped = Math.round(alpha * 16) / 16;
      if (stepped <= 0) continue;
      if (stepped !== lastAlpha) {
        ctx.globalAlpha = stepped;
        lastAlpha = stepped;
      }
      if (p.color !== lastColor) {
        ctx.fillStyle = p.color;
        lastColor = p.color;
      }
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try {
      ctx.clearRect(0, 0, cssW, cssH);
    } catch {
      /* канва уже снята */
    }
  };
}
