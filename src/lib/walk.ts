// Ходьба по сетке — общее для подземелья и площади каторги (v2.80). Здесь
// только то, что не зависит от мира: круг против клеток со скольжением вдоль
// стены, ход мелкими шагами, разгон к цели и шаг ног по пройденному пути.
//
// Вынесено из `dungeon-sim.ts` один в один: подземелье ходит клетками в
// целую плитку, площадь — половинками (`cell` 0,5), и формулы обязаны быть
// одни — иначе герой на площади скользил бы вдоль стен иначе, чем внизу, и
// это было бы видно сразу (тот же человечек, та же скорость).

/**
 * Сетка столкновений. Координаты тела — в единицах мира (подземелье и
 * площадь меряют в плитках), клетка — `cell` таких единиц. `solid` обязана
 * отвечать `true` за краем карты: мир кончается стеной, а не пропастью.
 */
export interface Grid {
  /** Клеток по ширине и высоте. */
  w: number;
  h: number;
  /** Размер клетки в единицах мира. */
  cell: number;
  solid(cx: number, cy: number): boolean;
}

export interface Body {
  x: number;
  y: number;
  r: number;
}

export interface Mover extends Body {
  vx: number;
  vy: number;
}

/**
 * Круг против клеток: вытолкнуть наружу, скользя вдоль стены. Толкает к
 * ближайшей точке каждой занятой клетки, поэтому о внешний угол тело
 * огибается, а вдоль ровной стены едет, не цепляясь за швы между клетками.
 * true — касался хоть одной.
 */
export function collideGrid(g: Grid, e: Body): boolean {
  let hit = false;
  const c = g.cell;
  const x0 = Math.floor((e.x - e.r) / c) - 1;
  const x1 = Math.floor((e.x + e.r) / c) + 1;
  const y0 = Math.floor((e.y - e.r) / c) - 1;
  const y1 = Math.floor((e.y + e.r) / c) + 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!g.solid(tx, ty)) continue;
      const ax = tx * c;
      const ay = ty * c;
      const bx = (tx + 1) * c;
      const by = (ty + 1) * c;
      const cx = Math.max(ax, Math.min(e.x, bx));
      const cy = Math.max(ay, Math.min(e.y, by));
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= e.r * e.r) continue;
      hit = true;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = e.r - d;
        e.x += (dx / d) * push;
        e.y += (dy / d) * push;
      } else {
        // Центр внутри клетки — выталкиваем к ближайшей грани.
        const l = e.x - ax;
        const r = bx - e.x;
        const t = e.y - ay;
        const b = by - e.y;
        const m = Math.min(l, r, t, b);
        if (m === l) e.x = ax - e.r;
        else if (m === r) e.x = bx + e.r;
        else if (m === t) e.y = ay - e.r;
        else e.y = by + e.r;
      }
    }
  }
  return hit;
}

/** Задевает ли круг хоть одну занятую клетку (ничего не двигает). */
export function overlapsGrid(g: Grid, x: number, y: number, r: number): boolean {
  const c = g.cell;
  const x0 = Math.floor((x - r) / c);
  const x1 = Math.floor((x + r) / c);
  const y0 = Math.floor((y - r) / c);
  const y1 = Math.floor((y + r) / c);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (!g.solid(tx, ty)) continue;
      const cx = Math.max(tx * c, Math.min(x, (tx + 1) * c));
      const cy = Math.max(ty * c, Math.min(y, (ty + 1) * c));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r - 1e-9) return true;
    }
  return false;
}

/** Самый длинный шаг внутри хода: меньше радиуса тела — сквозь стену не проскочить. */
export const MOVE_STEP = 0.2;

/**
 * Ход по скорости за `dt`: путь режется на шаги не длиннее `step`, после
 * каждого — выталкивание из стен и то, что мир хочет сделать ещё (`each`:
 * в подземелье — ящики и вагонетки). Возвращает пройденное расстояние.
 */
export function moveBody<T extends Mover>(
  g: Grid,
  b: T,
  dt: number,
  each?: (b: T) => void,
  step = MOVE_STEP,
): number {
  const ox = b.x;
  const oy = b.y;
  const n = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / step));
  for (let i = 0; i < n; i++) {
    b.x += (b.vx * dt) / n;
    b.y += (b.vy * dt) / n;
    collideGrid(g, b);
    each?.(b);
  }
  return Math.hypot(b.x - ox, b.y - oy);
}

/** Как быстро скорость догоняет желаемую: доля за секунду. */
export const STEER_RATE = 14;

/**
 * Разгон к цели: скорость тянется к `m · speed` на долю `dt · 14` за шаг —
 * старт и остановка за пятую долю секунды, без инерции льда.
 */
export function steerVelocity(
  b: { vx: number; vy: number },
  mx: number,
  my: number,
  speed: number,
  dt: number,
): void {
  const acc = Math.min(1, dt * STEER_RATE);
  b.vx += (mx * speed - b.vx) * acc;
  b.vy += (my * speed - b.vy) * acc;
}

/** Длина шага ног: кадр анимации на столько единиц пути. */
export const STRIDE = 0.36;

/**
 * Строка листа Ninja Adventure для шага (0…3) по пройденному пути — ноги не
 * скользят по полу на любой скорости. Путь бывает отрицательным только в
 * теории, но остаток держим положительным.
 */
export function walkRow(walk: number): number {
  return ((Math.floor(walk / STRIDE) % 4) + 4) % 4;
}
