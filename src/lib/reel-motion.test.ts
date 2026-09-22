import { describe, expect, it } from 'vitest';
import { planReel, REEL, restReel } from './reel-motion';
import type { ReelPlan } from './reel-motion';

/** cubic-bezier как в CSS: по доле времени — доля пути. */
function bezier(easing: string): (t: number) => number {
  if (easing === 'linear') return (t) => t;
  const m = /cubic-bezier\(([^)]+)\)/.exec(easing);
  if (!m) throw new Error(easing);
  const [x1, y1, x2, y2] = m[1].split(',').map(Number);
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
  return (t) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

/** Положение ленты в момент `ms` — так, как его посчитает браузер. */
function yAt(plan: ReelPlan<unknown>, ms: number): number {
  const f = plan.keyframes;
  const t = Math.min(1, Math.max(0, ms / plan.duration));
  for (let i = f.length - 2; i >= 0; i--) {
    if (t >= f[i].offset) {
      const span = f[i + 1].offset - f[i].offset;
      if (span <= 0) return f[i + 1].y;
      const k = bezier(f[i].easing)((t - f[i].offset) / span);
      return f[i].y + (f[i + 1].y - f[i].y) * k;
    }
  }
  return f[0].y;
}

let n = 0;
const filler = () => `f${n++}`;
const grid = (tag: string, rows: number) => Array.from({ length: rows }, (_, i) => `${tag}${i}`);

describe('план вращения барабана', () => {
  it('стартует с того, что на экране, и встаёт ровно на результат', () => {
    const from = grid('from', 5);
    const to = grid('to', 5);
    const plan = planReel({ from, to, filler, cell: 68, duration: 1200 });
    // В окне на старте — текущее поле, не случайные символы.
    const top0 = -plan.startY / 68;
    expect(Number.isInteger(top0)).toBe(true);
    expect(plan.strip.slice(top0, top0 + 5)).toEqual(from);
    // В конце — ровно результат, на целой клетке.
    const top1 = -plan.endY / 68;
    expect(Number.isInteger(top1)).toBe(true);
    expect(plan.strip.slice(top1, top1 + 5)).toEqual(to);
    // Под результатом есть хвост: проезд мимо гнезда не открывает пустоту.
    expect(plan.strip.length).toBeGreaterThan(top1 + 5);
    // Над стартом есть голова: замах назад тоже не открывает пустоту.
    expect(top0).toBeGreaterThanOrEqual(1);
  });

  it('кадры идут по порядку и начинаются и кончаются в покое', () => {
    const plan = planReel({
      from: grid('a', 3),
      to: grid('b', 3),
      filler,
      cell: 74,
      duration: 900,
    });
    const f = plan.keyframes;
    expect(f[0].offset).toBe(0);
    expect(f[f.length - 1].offset).toBe(1);
    for (let i = 1; i < f.length; i++) expect(f[i].offset).toBeGreaterThanOrEqual(f[i - 1].offset);
    expect(f[0].y).toBe(plan.startY);
    expect(f[f.length - 1].y).toBe(plan.endY);
  });

  it('все барабаны крутятся с ОДНОЙ скоростью — поздний просто дольше', () => {
    // Ровно это и было сломано: путь у всех один, длительность разная,
    // и последний барабан ехал вдвое медленнее первого.
    const speeds = [780, 930, 1080, 1230, 1380, 1530].map(
      (duration) =>
        planReel({ from: grid('a', 5), to: grid('b', 5), filler, cell: 68, duration }).speed,
    );
    const lo = Math.min(...speeds);
    const hi = Math.max(...speeds);
    expect(hi / lo).toBeLessThan(1.08);
  });

  it('нигде не быстрее ровного хода и не стробит', () => {
    for (const [duration, tempo, speedup] of [
      [390, 0.5, 1.2],
      [780, 1, 1],
      [1530, 1, 1],
      [2360, 1, 1],
    ]) {
      const plan = planReel({
        from: grid('a', 5),
        to: grid('b', 5),
        filler,
        cell: 68,
        duration,
        tempo,
        speedup,
      });
      let worst = 0;
      let prev = yAt(plan, 0);
      for (let ms = 4; ms <= duration; ms += 4) {
        const y = yAt(plan, ms);
        // Прыжки петли — не движение: в окне в этот миг то же самое.
        if (Math.abs(y - prev) < REEL.loop * 68 * 0.5)
          worst = Math.max(worst, Math.abs(y - prev) / 4);
        prev = y;
      }
      expect(worst).toBeLessThan(plan.speed * 1.06);
      // Меньше половины клетки за кадр — глаз видит, куда едет лента.
      expect(plan.speed * 16.7).toBeLessThan(68 * 0.5);
    }
  });

  it('скорость непрерывна на стыках фаз', () => {
    const plan = planReel({
      from: grid('a', 3),
      to: grid('b', 3),
      filler,
      cell: 74,
      duration: 1460,
    });
    let worstJerk = 0;
    // Сам срыв с места — рывок нарочно: барабан дёрнули рычагом. Дальше,
    // от точки разворота замаха, скорость обязана быть непрерывной.
    const from = REEL.kickMs;
    let prevV = (yAt(plan, from) - yAt(plan, from - 2)) / 2;
    for (let ms = from + 2; ms <= plan.duration; ms += 2) {
      const v = (yAt(plan, ms) - yAt(plan, ms - 2)) / 2;
      worstJerk = Math.max(worstJerk, Math.abs(v - prevV));
      prevV = v;
    }
    // Скачок скорости за 2 мс меньше пятой доли скорости хода: шов не виден.
    expect(worstJerk).toBeLessThan(plan.speed * 0.2);
  });

  it('замах и отскок — доли клетки, а не прыжок в соседнюю', () => {
    const plan = planReel({
      from: grid('a', 3),
      to: grid('b', 3),
      filler,
      cell: 74,
      duration: 1200,
    });
    let maxBack = 0;
    let maxOver = 0;
    for (let ms = 0; ms <= plan.duration; ms += 2) {
      const y = yAt(plan, ms);
      maxBack = Math.max(maxBack, y - plan.startY);
      maxOver = Math.max(maxOver, plan.endY - y);
    }
    expect(maxBack).toBeGreaterThan(0);
    expect(maxBack).toBeLessThan(74 * 0.2);
    expect(maxOver).toBeGreaterThan(0);
    expect(maxOver).toBeLessThan(74 * 0.25);
  });

  it('удар звучит, когда символы дошли до гнёзд, а не после отскока', () => {
    const plan = planReel({
      from: grid('a', 5),
      to: grid('b', 5),
      filler,
      cell: 68,
      duration: 1000,
    });
    expect(plan.impact).toBeLessThan(plan.duration);
    expect(Math.abs(yAt(plan, plan.impact) - plan.endY)).toBeLessThan(2);
    // Размытие снято раньше удара: тормозящий барабан уже резкий.
    expect(plan.blurOff).toBeLessThan(plan.impact);
    expect(plan.blurOn).toBeLessThan(plan.blurOff);
  });

  it('длинное вращение идёт по петле, и прыжок в окне не виден', () => {
    const rows = 5;
    const plan = planReel({
      from: grid('a', rows),
      to: grid('b', rows),
      filler,
      cell: 68,
      duration: 4200,
    });
    expect(plan.loops).toBeGreaterThan(0);
    // Лента не раздувается: пролёт не больше потолка.
    expect(plan.strip.length).toBeLessThanOrEqual(1 + rows + REEL.maxFiller + rows + 1);
    // В каждый прыжок окно показывает одно и то же до и после.
    const f = plan.keyframes;
    let jumps = 0;
    for (let i = 1; i < f.length; i++) {
      if (f[i].offset !== f[i - 1].offset) continue;
      jumps++;
      const before = -f[i - 1].y / 68;
      const after = -f[i].y / 68;
      expect(Number.isInteger(Math.round(before * 1e6) / 1e6)).toBe(true);
      const a = Math.round(before);
      const b = Math.round(after);
      expect(plan.strip.slice(a, a + rows + 1)).toEqual(plan.strip.slice(b, b + rows + 1));
    }
    expect(jumps).toBe(plan.loops);
    // И всё равно встаёт на результат.
    const top = -plan.endY / 68;
    expect(plan.strip.slice(top, top + rows)).toEqual(grid('b', rows));
  });

  it('турбо: короткое вращение всё равно доезжает, пусть и на минимуме пути', () => {
    const plan = planReel({
      from: grid('a', 5),
      to: grid('b', 5),
      filler,
      cell: 68,
      duration: 390,
      tempo: 0.5,
      speedup: 1.2,
    });
    const top = -plan.endY / 68;
    expect(plan.strip.slice(top, top + 5)).toEqual(grid('b', 5));
    expect(plan.travel).toBeGreaterThanOrEqual(5);
  });

  it('лента в покое показывает поле и прячет голову', () => {
    const plan = restReel(grid('g', 3), filler, 74);
    expect(plan.startY).toBe(-74);
    expect(plan.strip.slice(1, 4)).toEqual(grid('g', 3));
  });
});
