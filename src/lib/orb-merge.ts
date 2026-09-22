// Слияние сфер — мыльные пузыри. Чистый план: по тому, где лежат сферы и
// сколько они стоят, считает, куда каждая плывёт, когда какая в какую
// вливается и где в конце оказывается одна общая. Страница только
// проигрывает план (ScatterPage → `finale`), поэтому всё, что здесь, можно
// проверить тестом: суммы, порядок, что поглощённая сфера доплывает ровно до
// поглотившей, что никто не вылетает за поле.
//
// Почему пузыри, а не полёт в жетон. Пока сфера одна, она по-прежнему
// улетает в жетон. Когда их несколько, раньше они по очереди ныряли в центр,
// и «×3 + ×10 + ×25» читалось тремя отдельными событиями. Пузыри, которые
// сливаются в один, показывают саму арифметику: число на общем пузыре растёт
// на глазах, а сам он раздувается.
//
// Сферы при этом остаются клетками поля (см. CLAUDE.md, «Сфера — это
// СОДЕРЖИМОЕ клетки»): план двигает сами клетки, а не рисует поверх поля
// новый слой. Пузырь — это то, во что клетка-сфера превращается на время
// слияния.

export type MergeVariant = 'gather' | 'magnet' | 'snowball' | 'pairs' | 'swirl' | 'rise';

/**
 * Варианты хореографии. Вес — насколько часто выпадает; `turbo` — годится ли
 * для турбо: там остаются только те, где пузыри сходятся одним движением, а
 * не цепочкой переходов, иначе сжатое по времени слияние превращается в
 * мельтешение.
 */
export const MERGE_VARIANTS: Record<
  MergeVariant,
  { name: string; weight: number; turbo: boolean }
> = {
  // Все плывут к одной точке, старшая — первой, остальные втекают в неё.
  gather: { name: 'К центру', weight: 3, turbo: true },
  // Старшая стоит на месте и притягивает остальных, потом общий пузырь плывёт к центру.
  magnet: { name: 'К старшей', weight: 3, turbo: true },
  // Младшая катится к ближайшей, растёт, катится к следующей — ком.
  snowball: { name: 'Снежный ком', weight: 2, turbo: false },
  // Сходятся парами на полпути, пары — снова парами, как сетка турнира.
  pairs: { name: 'Парами', weight: 2, turbo: true },
  // Выходят на круг и по спирали затягиваются в середину.
  swirl: { name: 'Вихрь', weight: 2, turbo: false },
  // Всплывают к верхнему краю, как пузыри в воде, сходятся там, общий опускается.
  rise: { name: 'Всплытие', weight: 2, turbo: false },
};

export interface Pt {
  x: number;
  y: number;
}

/** Сфера на входе: центр её клетки в координатах поля, px. */
export interface MergeOrb extends Pt {
  id: string;
  value: number;
}

/** Состояние пузыря в момент `t`: где он, какого размера и насколько виден. */
export interface MergeFrame extends Pt {
  t: number;
  s: number;
  o: number;
}

export interface MergeStep {
  /** Когда пузыри коснулись: здесь звучит «блоп» и растёт число. */
  at: number;
  from: string;
  into: string;
  /** Сколько показывает общий пузырь после слияния. */
  sum: number;
  /** Откуда пришёл поглощённый (радианы) — по этой оси колышется плёнка. */
  angle: number;
  /** Порядковый номер слияния: по нему звук забирается выше. */
  k: number;
}

export interface MergePlan {
  variant: MergeVariant;
  tracks: Record<string, MergeFrame[]>;
  merges: MergeStep[];
  survivor: string;
  /** Общий пузырь встал в конечную точку и готов лопнуть. */
  end: number;
  /** Где он лопнет — там же вырастет жетон. */
  home: Pt;
  /**
   * Во сколько раз план сжат по времени (турбо и потолок). Страница умножает
   * на него собственные такты — вытягивание поглощённого, колыхание, — чтобы
   * они совпали с кадрами плана.
   */
  timeScale: number;
}

export interface MergeOptions {
  /** Размер поля, px. */
  width: number;
  height: number;
  /** Радиус пузыря в покое, px (половина клетки). */
  radius: number;
  /** Доля времени: 1 — обычный ход, 0,55 — турбо. */
  speed?: number;
  /**
   * В бонусе жетон уже стоит посередине с прошлым множителем, и пузыри,
   * собираясь в центре, прятались бы под ним. Тогда они сходятся выше, а в
   * жетон входит уже общий.
   */
  stampShown?: boolean;
  rng?: () => number;
  variant?: MergeVariant;
}

/** Параметры хода в обычном темпе; турбо сжимает время, а не пути. */
export const MERGE = {
  /** Пузырь надувается вокруг камня и чуть приподнимается из гнезда. */
  inflateMs: 280,
  /** Скорость дрейфа, px/мс: пузырь плывёт, а не летит. */
  drift: 0.3,
  minMoveMs: 380,
  /** Между двумя слияниями — не меньше: каждое «блоп» слышно отдельно. */
  gapMs: 170,
  /** Последний отрезок перед касанием: поглощённый сжимается и гаснет. */
  absorbMs: 160,
  /** Рост пузыря после слияния. */
  growMs: 170,
  /** Общий пузырь доплыл — пауза перед тем, как лопнуть. */
  settleMs: 260,
  /** Потолок всего слияния: обычный темп и турбо. */
  capMs: 2800,
  capTurboMs: 1500,
  /** Размер пузыря в покое относительно клетки. */
  base: 1.06,
  /** Больше этого общий пузырь не раздувается — иначе закроет поле. */
  maxScale: 1.6,
  /** Пузырь шире клетки: `.bubble { width: 122% }` в theme.css. */
  span: 1.22,
} as const;

const STEP_MS = 40;

/** Размер общего пузыря, поглотившего `k` других: объём складывается. */
export function bubbleScale(k: number): number {
  return Math.min(MERGE.maxScale, MERGE.base * Math.cbrt(1 + k));
}

const easeInOut = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

interface Key {
  t: number;
  v: number;
}

/** Значение канала в момент t: линейно между ключами, за краями — крайние. */
function sample(keys: Key[], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const span = b.t - a.t;
      return span <= 0 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / span;
    }
  }
  return keys[keys.length - 1].v;
}

/** Путь одного пузыря: положение, размер и прозрачность — тремя каналами. */
class Track {
  xs: Key[] = [];
  ys: Key[] = [];
  ss: Key[] = [];
  os: Key[] = [];
  /** Сколько уже поглотил — от этого размер. */
  eaten = 0;

  constructor(
    public id: string,
    public value: number,
    start: Pt,
  ) {
    this.pos(0, start);
    this.ss.push({ t: 0, v: 1 });
    this.os.push({ t: 0, v: 1 });
  }

  pos(t: number, p: Pt): void {
    this.xs.push({ t, v: p.x });
    this.ys.push({ t, v: p.y });
  }

  at(t: number): Pt {
    return { x: sample(this.xs, t), y: sample(this.ys, t) };
  }

  /** Когда путь кончается: позже этого момента пузырь стоит. */
  get busyUntil(): number {
    return this.xs[this.xs.length - 1].t;
  }

  scaleTo(t: number, s: number, ms: number): void {
    this.ss.push({ t, v: sample(this.ss, t) }, { t: t + ms, v: s });
  }

  /** Держаться на месте до `t` — чтобы следующий отрезок стартовал отсюда. */
  holdTo(t: number): void {
    if (t > this.busyUntil) this.pos(t, this.at(this.busyUntil));
  }

  /**
   * Плыть из текущего места в `to` за [t0, t1]. Путь — дуга с лёгким
   * покачиванием: прямой отрезок читается как «передвинули», а пузырь
   * именно плывёт. `absorb` — последний отрезок поглощённого: у цели он
   * сжимается и гаснет.
   */
  move(
    t0: number,
    t1: number,
    to: Pt,
    o: { arc?: number; sway?: number; phase?: number; absorb?: boolean } = {},
  ): void {
    this.holdTo(t0);
    const from = this.at(t0);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Перпендикуляр к пути — по нему дуга и покачивание.
    const px = -dy / len;
    const py = dx / len;
    const arc = o.arc ?? 0;
    const sway = o.sway ?? 0;
    const phase = o.phase ?? 0;
    const dur = Math.max(1, t1 - t0);
    for (let t = t0 + STEP_MS; t < t1; t += STEP_MS) {
      const u = (t - t0) / dur;
      const e = easeInOut(u);
      const bend =
        arc * Math.sin(Math.PI * u) +
        sway * Math.sin(Math.PI * u) * Math.sin(phase + u * 4 * Math.PI);
      this.pos(t, { x: from.x + dx * e + px * bend, y: from.y + dy * e + py * bend });
    }
    this.pos(t1, to);
    if (o.absorb) {
      const a = Math.max(t0, t1 - MERGE.absorbMs);
      this.ss.push({ t: a, v: sample(this.ss, a) }, { t: t1, v: 0.35 });
      this.os.push({ t: a, v: 1 }, { t: t1, v: 0 });
    }
  }

  /** Спираль к `c`: с радиуса, на котором пузырь стоит, до нуля. */
  spiral(t0: number, t1: number, c: Pt, turns: number, absorb: boolean): void {
    this.holdTo(t0);
    const p = this.at(t0);
    const r0 = dist(p, c);
    const a0 = Math.atan2(p.y - c.y, p.x - c.x);
    const dur = Math.max(1, t1 - t0);
    for (let t = t0 + STEP_MS; t < t1; t += STEP_MS) {
      const u = (t - t0) / dur;
      const r = r0 * Math.pow(1 - u, 1.25);
      const a = a0 + turns * 2 * Math.PI * u;
      this.pos(t, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    this.pos(t1, c);
    if (absorb) {
      const a = Math.max(t0, t1 - MERGE.absorbMs);
      this.ss.push({ t: a, v: sample(this.ss, a) }, { t: t1, v: 0.35 });
      this.os.push({ t: a, v: 1 }, { t: t1, v: 0 });
    }
  }

  /**
   * Все каналы — в общие кадры по объединённым моментам времени. Дуги у
   * кромки поджимаются внутрь; кадр 0 — гнездо клетки, его не трогаем.
   */
  bake(k: number, clamp: (p: Pt) => Pt): MergeFrame[] {
    const times = [...new Set([...this.xs, ...this.ss, ...this.os].map((key) => key.t))].sort(
      (a, b) => a - b,
    );
    return times.map((t) => {
      const raw = { x: sample(this.xs, t), y: sample(this.ys, t) };
      const p = t > 0 ? clamp(raw) : raw;
      return {
        t: t * k,
        x: p.x,
        y: p.y,
        s: sample(this.ss, t),
        o: sample(this.os, t),
      };
    });
  }
}

/** Взвешенный случайный выбор варианта; в турбо — только быстрые. */
export function pickVariant(rng: () => number, turbo: boolean): MergeVariant {
  const pool = (Object.keys(MERGE_VARIANTS) as MergeVariant[]).filter(
    (v) => !turbo || MERGE_VARIANTS[v].turbo,
  );
  const total = pool.reduce((s, v) => s + MERGE_VARIANTS[v].weight, 0);
  let r = rng() * total;
  for (const v of pool) {
    r -= MERGE_VARIANTS[v].weight;
    if (r < 0) return v;
  }
  return pool[pool.length - 1];
}

/** План слияния. Сфер должно быть хотя бы две — одну сливать не с чем. */
export function planMerge(orbs: MergeOrb[], opts: MergeOptions): MergePlan {
  if (orbs.length < 2) throw new Error('planMerge: нужно хотя бы две сферы');
  const rng = opts.rng ?? Math.random;
  const speed = opts.speed ?? 1;
  const turbo = speed < 1;
  const variant = opts.variant ?? pickVariant(rng, turbo);
  const { width: W, height: H, radius: R } = opts;
  // Где сходятся «к центру» и «вихрь» и где общий лопнет. В бонусе — выше
  // жетона: иначе пузырь последние полсекунды висел бы под ним невидимым и
  // лопался бы там же, за жетоном.
  const meet: Pt = opts.stampShown ? { x: W / 2, y: H * 0.28 } : { x: W / 2, y: H / 2 };
  const home: Pt = meet;
  // Безопасная зона: раздутый пузырь целиком внутри поля. Крайняя колонка
  // иначе держала бы полпузыря за кромкой — поле его просто срезало.
  const pad = R * MERGE.span * MERGE.maxScale;
  const clamp = (p: Pt): Pt => ({
    x: Math.min(W - pad, Math.max(pad, p.x)),
    y: Math.min(H - pad, Math.max(pad, p.y)),
  });
  const V = MERGE.drift;
  const T0: number = MERGE.inflateMs;
  const travel = (a: Pt, b: Pt, slow = 1) => Math.max(MERGE.minMoveMs, dist(a, b) / (V * slow));
  const arc = () => (rng() < 0.5 ? -1 : 1) * (14 + rng() * 22);
  const sway = () => 2 + rng() * 3;
  const phase = () => rng() * Math.PI * 2;

  const tracks = new Map<string, Track>();
  for (const o of orbs) {
    const t = new Track(o.id, o.value, o);
    // Пузырь надувается и чуть всплывает из гнезда — отрывается от поля, а
    // у кромки заодно отходит от неё внутрь.
    t.pos(T0, clamp({ x: o.x, y: o.y - 5 }));
    t.ss.push({ t: T0, v: MERGE.base });
    tracks.set(o.id, t);
  }
  const all = [...tracks.values()];
  const byValue = [...all].sort((a, b) => a.value - b.value);
  const top = byValue[byValue.length - 1];

  const merges: MergeStep[] = [];
  let lastMerge = 0;
  /** Слить `from` в `into` в момент `at`: число и размер общего растут. */
  const merge = (from: Track, into: Track, at: number) => {
    const src = from.at(Math.max(0, at - MERGE.absorbMs));
    const dst = into.at(at);
    into.value += from.value;
    into.eaten += 1 + from.eaten;
    into.scaleTo(at, bubbleScale(into.eaten), MERGE.growMs);
    merges.push({
      at,
      from: from.id,
      into: into.id,
      sum: into.value,
      angle: Math.atan2(dst.y - src.y, dst.x - src.x),
      k: merges.length,
    });
    lastMerge = Math.max(lastMerge, at);
  };
  /** Следующее слияние — не раньше, чем через паузу после прошлого. */
  const slot = (natural: number) => Math.max(natural, lastMerge + MERGE.gapMs);

  let survivor = top;
  let end = 0;
  /** Общий пузырь доплывает до точки, где лопнет. */
  const goHome = (s: Track, from: number) => {
    const p = s.at(from);
    if (dist(p, home) < 2) {
      s.holdTo(from);
      end = from + MERGE.settleMs;
      return;
    }
    // Тяжёлый — плывёт медленнее: он теперь больше.
    const t1 = from + travel(p, home, 0.85);
    s.move(from, t1, home, { arc: arc() * 0.5, sway: sway() });
    end = t1 + MERGE.settleMs;
  };

  if (variant === 'gather' || variant === 'swirl') {
    const dS = travel(top.at(T0), meet);
    top.move(T0, T0 + dS, meet, { arc: arc() * 0.4, sway: sway() });
    const rest = byValue.filter((t) => t !== top);
    if (variant === 'gather') {
      rest.forEach((t, i) => {
        const start = T0 + i * 120;
        const at = slot(Math.max(start + travel(t.at(start), meet), T0 + dS + 60));
        t.move(start, at, meet, { arc: arc(), sway: sway(), phase: phase(), absorb: true });
        merge(t, top, at);
      });
    } else {
      // Вихрь: сначала на круг вокруг точки схождения, потом по спирали внутрь.
      const ring = Math.min(W, H) * (opts.stampShown ? 0.22 : 0.33);
      let ringAt = T0;
      rest.forEach((t) => {
        const p = t.at(T0);
        const a = Math.atan2(p.y - meet.y, p.x - meet.x) || rng() * 2 * Math.PI;
        const on = { x: meet.x + Math.cos(a) * ring, y: meet.y + Math.sin(a) * ring };
        const t1 = T0 + travel(p, on);
        t.move(T0, t1, on, { arc: arc() * 0.5, sway: sway() });
        ringAt = Math.max(ringAt, t1);
      });
      const dir = rng() < 0.5 ? -1 : 1;
      const start = Math.max(ringAt, T0 + dS) + 60;
      rest.forEach((t, i) => {
        const at = slot(start + 620 + i * 90);
        t.spiral(start, at, meet, dir * (1 + 0.15 * i), true);
        merge(t, top, at);
      });
    }
    survivor = top;
    goHome(top, lastMerge + 120);
  } else if (variant === 'magnet') {
    const anchor = top.at(T0);
    const rest = byValue
      .filter((t) => t !== top)
      .sort((a, b) => dist(a.at(T0), anchor) - dist(b.at(T0), anchor));
    rest.forEach((t, i) => {
      const start = T0 + i * 90;
      const at = slot(start + travel(t.at(start), anchor));
      t.move(start, at, anchor, { arc: arc(), sway: sway(), phase: phase(), absorb: true });
      merge(t, top, at);
    });
    survivor = top;
    goHome(top, lastMerge + 160);
  } else if (variant === 'snowball') {
    // Ком начинается с самой дешёвой и катится к ближайшей из оставшихся.
    const left = new Set(all);
    let cur = byValue[0];
    left.delete(cur);
    let t = T0;
    while (left.size) {
      let next: Track | null = null;
      for (const cand of left) {
        if (!next || dist(cand.at(t), cur.at(t)) < dist(next.at(t), cur.at(t))) next = cand;
      }
      if (!next) break;
      left.delete(next);
      const target = next.at(t);
      const at = slot(t + travel(cur.at(t), target));
      cur.move(t, at, target, { arc: arc(), sway: sway(), phase: phase(), absorb: true });
      next.holdTo(at);
      merge(cur, next, at);
      cur = next;
      t = at + 90;
    }
    survivor = cur;
    goHome(cur, lastMerge + 120);
  } else if (variant === 'pairs') {
    let alive = [...all];
    let t = T0;
    while (alive.length > 1) {
      const pool = [...alive];
      const pairs: [Track, Track][] = [];
      while (pool.length > 1) {
        let best: [number, number] = [0, 1];
        let bestD = Infinity;
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            const d = dist(pool[i].at(t), pool[j].at(t));
            if (d < bestD) {
              bestD = d;
              best = [i, j];
            }
          }
        }
        const a = pool[best[0]];
        const b = pool[best[1]];
        pool.splice(best[1], 1);
        pool.splice(best[0], 1);
        pairs.push([a, b]);
      }
      let roundEnd = t;
      const winners: Track[] = [];
      pairs.forEach(([a, b], k) => {
        const start = t + k * 80;
        const pa = a.at(start);
        const pb = b.at(start);
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const [keep, gone] = a.value >= b.value ? [a, b] : [b, a];
        const at = slot(start + Math.max(MERGE.minMoveMs * 0.8, dist(pa, pb) / 2 / V));
        const bend = arc() * 0.6;
        // Встречные дуги в разные стороны — пузыри обходят друг друга по кругу.
        keep.move(start, at, mid, { arc: bend, sway: sway() });
        gone.move(start, at, mid, { arc: bend, sway: sway(), phase: phase(), absorb: true });
        merge(gone, keep, at);
        winners.push(keep);
        roundEnd = Math.max(roundEnd, at);
      });
      alive = [...winners, ...pool];
      t = roundEnd + 120;
    }
    survivor = alive[0];
    goHome(survivor, lastMerge + 120);
  } else {
    // Всплытие: всё поднимается к верхнему краю, сходится там, общий тонет.
    const yTop = R + 8;
    const peak = { x: W / 2, y: yTop };
    const risen = new Map<Track, number>();
    // Первым в общий вливается тот, кто всплыл ближе к середине.
    const rest = byValue
      .filter((t) => t !== top)
      .sort((a, b) => Math.abs(a.at(T0).x - peak.x) - Math.abs(b.at(T0).x - peak.x));
    const rise = (t: Track, to: Pt) => {
      const p = t.at(T0);
      // Вверх пузырь идёт быстрее, чем вбок: его тянет.
      const t1 = T0 + Math.max(320, Math.abs(p.y - to.y) / (V * 1.4));
      t.move(T0, t1, to, { sway: sway() * 1.6, phase: phase() });
      risen.set(t, t1);
    };
    rise(top, peak);
    // Ярусы под кромкой: две сферы из одной колонки иначе всплыли бы в одну
    // точку и слиплись раньше, чем прозвучит их слияние.
    rest.forEach((t, i) => {
      const p = t.at(T0);
      rise(t, { x: p.x, y: Math.min(H - R, yTop + R * 0.4 + (i % 3) * R * 0.8) });
    });
    rest.forEach((t) => {
      const start = risen.get(t) ?? T0;
      const at = slot(Math.max(start + travel(t.at(start), peak), (risen.get(top) ?? T0) + 60));
      t.move(start, at, peak, { sway: sway(), phase: phase(), absorb: true });
      merge(t, top, at);
    });
    survivor = top;
    goHome(top, lastMerge + 200);
  }

  // Время: турбо сжимает, потолок не даёт слиянию стать ожиданием.
  const cap = turbo ? MERGE.capTurboMs : MERGE.capMs;
  let k = speed;
  if (end * k > cap) k = cap / end;

  const out: Record<string, MergeFrame[]> = {};
  for (const t of all) {
    t.holdTo(end);
    out[t.id] = t.bake(k, clamp);
  }
  return {
    variant,
    tracks: out,
    merges: merges.map((m) => ({ ...m, at: m.at * k })),
    survivor: survivor.id,
    end: end * k,
    home: clamp(home),
    timeScale: k,
  };
}
