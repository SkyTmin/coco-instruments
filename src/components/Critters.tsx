// Живность шахты (v2.64): летучая мышь, сорока-воровка, сундучок «одна из
// трёх» и риск-игра на картах. Правила — `lib/critters.ts`, состояние
// сундучка — в сторе (`prison.treasure`), здесь только то, что видно.
//
// Мышь и сорока двигаются через requestAnimationFrame и пишут `transform`
// прямо в элемент: одна-две вещи на поле, перерисовывать ради них React
// шестьдесят раз в секунду незачем. Поймать мышь можно только ТАПОМ по ней —
// это и есть вся игра с ней; блестяшки сороки подбираются любым ударом по
// клетке (страница спрашивает `takeAt` до удара по породе).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, RewardIcon, TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { RiskOpen, TreasureGot } from '@/store';
import {
  batAt,
  batPath,
  cardRank,
  MAGPIE_DROP_MS,
  MAGPIE_KEYS,
  offerLabel,
  RANK_NAMES,
  RISK_STEPS,
  riskable,
  SHINY_LIFE_MS,
  shinyRoll,
} from '@/lib/critters';
import type { BatPath, ShinyKind, Treasure } from '@/lib/critters';
import { MINE_COLS, MINE_ROWS, shortMoney } from '@/lib/prison';
import type { YardEvent } from '@/lib/prison';
import {
  batSqueak,
  cardDeal,
  cardFlip,
  cardShuffle,
  primeAudio,
  riskDraw,
  riskLose,
  riskWin,
  shinyDrop,
  uiTap,
  wingFlap,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';
import { burstConfetti } from '@/lib/confetti';

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Палец на живности не должен долбить породу под ней. */
const swallow = (e: ReactPointerEvent) => {
  e.stopPropagation();
};

// ---------------------------------------------------------------------------
// Летучая мышь.
// ---------------------------------------------------------------------------

/** Лист `critters/bat.png`: 5 кадров 51×57, ряд 0 — бурая, ряд 1 — синяя. */
const BAT_W = 51;
const BAT_H = 57;
/** Кадры взмаха: вверх, середина, вниз, середина. */
const FLAP = [0, 1, 2, 1];
const FRAME_HIT = 3;
const FRAME_DIZZY = 4;

export interface BatHandle {
  launch(rare: boolean): void;
  busy(): boolean;
}

interface BatRun {
  path: BatPath;
  t0: number;
  raf: number;
  caught: boolean;
  x: number;
  y: number;
  flapAt: number;
  size: number;
}

export const BatLayer = forwardRef<
  BatHandle,
  {
    /** Поле: по нему меряются путь и размер. */
    host: () => HTMLElement | null;
    /** Поймана: где (в точках поля) и какая. */
    onCatch: (rare: boolean, x: number, y: number) => void;
  }
>(function BatLayer({ host, onCatch }, ref) {
  const [bat, setBat] = useState<{ id: number; rare: boolean; size: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const shadow = useRef<HTMLElement>(null);
  const sprite = useRef<HTMLElement>(null);
  const run = useRef<BatRun | null>(null);
  const seq = useRef(0);
  const catchRef = useRef(onCatch);
  catchRef.current = onCatch;
  const hostRef = useRef(host);
  hostRef.current = host;

  useImperativeHandle(ref, () => ({
    launch(rare) {
      const h = hostRef.current();
      if (run.current || !h) return;
      const size = h.clientWidth / MINE_COLS;
      seq.current += 1;
      run.current = {
        path: batPath(Math.random, rare),
        t0: performance.now(),
        raf: 0,
        caught: false,
        x: -999,
        y: -999,
        flapAt: 0,
        size,
      };
      setBat({ id: seq.current, rare, size });
      batSqueak(false);
    },
    busy: () => !!run.current,
  }));

  useEffect(() => {
    const r = run.current;
    if (!bat || !r) return undefined;
    const still = reduceMotion();
    const w = r.size * 1.12;
    const step = (now: number) => {
      const h = hostRef.current();
      const b = btn.current;
      const cur = run.current;
      if (!h || !b || !cur || cur.caught) return;
      const t = (now - cur.t0) / cur.path.ms;
      if (t >= 1) {
        run.current = null;
        setBat(null);
        return;
      }
      const p = batAt(cur.path, still ? 0.5 : t);
      const x = p.x * h.clientWidth;
      const y = p.y * h.clientHeight;
      cur.x = x;
      cur.y = y;
      b.style.transform = `translate(${x}px, ${y}px)`;
      // Тень лежит на дне ямы ниже мыши: высота читается без слов.
      const s = shadow.current;
      if (s) s.style.transform = `translate(${x}px, ${y + cur.size * 0.62}px)`;
      const f = still ? 0 : FLAP[Math.floor((now - cur.t0) / 80) % FLAP.length];
      if (sprite.current) sprite.current.style.backgroundPositionX = `${-f * w}px`;
      if (!still && now - cur.flapAt > 330) {
        cur.flapAt = now;
        wingFlap(0.14);
      }
      cur.raf = requestAnimationFrame(step);
    };
    r.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(r.raf);
  }, [bat]);

  const grab = (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    primeAudio();
    const r = run.current;
    if (!r || r.caught || !bat) return;
    r.caught = true;
    cancelAnimationFrame(r.raf);
    batSqueak(true);
    tapMedium();
    const w = r.size * 1.12;
    const sp = sprite.current;
    const b = btn.current;
    if (sp) sp.style.backgroundPositionX = `${-FRAME_HIT * w}px`;
    // Удар: мышь сбита — кадр удара, потом оглушённая падает вниз и тает.
    setTimeout(() => {
      if (sp) sp.style.backgroundPositionX = `${-FRAME_DIZZY * w}px`;
    }, 140);
    if (b && !reduceMotion()) {
      try {
        b.animate(
          [
            { transform: `translate(${r.x}px, ${r.y}px) scale(1)`, opacity: 1 },
            {
              transform: `translate(${r.x}px, ${r.y - r.size * 0.15}px) scale(1.15) rotate(-8deg)`,
              opacity: 1,
              offset: 0.2,
            },
            {
              transform: `translate(${r.x}px, ${r.y + r.size * 0.7}px) scale(.8) rotate(14deg)`,
              opacity: 0,
            },
          ],
          { duration: 620, easing: 'cubic-bezier(.45,0,.8,.6)', fill: 'forwards' },
        );
      } catch {
        /* не страшно */
      }
    }
    catchRef.current(bat.rare, r.x, r.y);
    setTimeout(() => {
      run.current = null;
      setBat(null);
    }, 640);
  };

  if (!bat) return null;
  const w = bat.size * 1.12;
  const h = (w * BAT_H) / BAT_W;
  return (
    <>
      <i
        ref={shadow}
        className="pbat-shadow"
        style={{ width: bat.size * 0.7, height: bat.size * 0.2 } as CSSProperties}
      />
      <button
        key={bat.id}
        ref={btn}
        type="button"
        className={`pbat${bat.rare ? ' is-rare' : ''}`}
        style={{ width: bat.size * 1.7, height: bat.size * 1.7 }}
        aria-label="Летучая мышь — поймай"
        onPointerDown={grab}
      >
        <i
          ref={sprite}
          className="pbat__sprite"
          style={{
            width: w,
            height: h,
            backgroundSize: `${w * 5}px ${h * 2}px`,
            backgroundPositionY: bat.rare ? `${-h}px` : '0px',
          }}
        />
      </button>
    </>
  );
});

// ---------------------------------------------------------------------------
// Сорока-воровка.
// ---------------------------------------------------------------------------

/** Кольцо — самая дорогая блестяшка сороки. */
export function RingIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <ellipse cx="12" cy="15" rx="7.2" ry="6.2" fill="none" stroke="#7a4d0c" strokeWidth="3.4" />
      <ellipse cx="12" cy="15" rx="7.2" ry="6.2" fill="none" stroke="#ffd257" strokeWidth="2" />
      <path d="M8.6 6.8 12 3l3.4 3.8L12 10.2Z" fill="#b7f3ff" stroke="#1d5a78" strokeWidth="1" />
      <path d="M12 3v7.2M8.6 6.8h6.8" stroke="#ffffff" strokeWidth=".6" opacity=".7" />
    </svg>
  );
}

function ShinyIcon({ kind, size }: { kind: ShinyKind; size: number }) {
  if (kind === 'coin') return <CoinIcon size={size} />;
  if (kind === 'ring') return <RingIcon size={size} />;
  if (kind === 'token') return <TokenIcon size={size} />;
  return <KeyIcon size={size} />;
}

interface Shiny {
  id: number;
  cell: number;
  kind: ShinyKind;
  born: number;
}

export interface MagpieHandle {
  /** Блестяшка в клетке — подобрать (удар по ней не бьёт породу). */
  takeAt(cell: number): ShinyKind | null;
}

export const MagpieLayer = forwardRef<
  MagpieHandle,
  {
    ev: YardEvent;
    host: () => HTMLElement | null;
    /** Можно ли уронить в клетку (не под метеоритом и не на дне). */
    canDrop: (cell: number) => boolean;
    onPick: (kind: ShinyKind, cell: number) => void;
  }
>(function MagpieLayer({ ev, host, canDrop, onPick }, ref) {
  const [shinies, setShinies] = useState<Shiny[]>([]);
  const list = useRef<Shiny[]>([]);
  const bird = useRef<HTMLDivElement>(null);
  const sprite = useRef<HTMLElement>(null);
  const shadow = useRef<HTMLElement>(null);
  const seq = useRef(0);
  const keysDropped = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;
  const dropRef = useRef(canDrop);
  dropRef.current = canDrop;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const put = (next: Shiny[]) => {
    list.current = next;
    setShinies(next);
  };

  const take = (cell: number): ShinyKind | null => {
    const s = list.current.find((x) => x.cell === cell);
    if (!s) return null;
    put(list.current.filter((x) => x !== s));
    return s.kind;
  };

  useImperativeHandle(ref, () => ({ takeAt: take }));

  useEffect(() => {
    const h0 = hostRef.current();
    if (!h0) return undefined;
    const still = reduceMotion();
    const W = h0.clientWidth;
    const H = h0.clientHeight;
    const fromLeft = Math.random() < 0.5;
    let x = fromLeft ? -W * 0.1 : W * 1.1;
    let y = H * (0.2 + Math.random() * 0.3);
    let vx = (fromLeft ? 1 : -1) * (W / 3.1);
    let vy = (Math.random() < 0.5 ? 1 : -1) * (H / 4.5);
    let last = performance.now();
    let dropAt = last + 500;
    let flapAt = 0;
    let face = fromLeft ? 1 : -1;
    let raf = 0;
    const cellW = W / MINE_COLS;
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const leaving = Date.now() > ev.until - 1400;
      if (!still) {
        x += vx * dt;
        y += vy * dt;
        // Отскок от краёв — как сова от стен: меняет курс и чуть сбивается.
        if (!leaving) {
          if ((x < W * 0.08 && vx < 0) || (x > W * 0.92 && vx > 0)) {
            vx = -vx;
            vy += (Math.random() - 0.5) * H * 0.15;
          }
          if ((y < H * 0.12 && vy < 0) || (y > H * 0.86 && vy > 0)) vy = -vy;
        }
        face = vx >= 0 ? 1 : -1;
      } else {
        x = W / 2;
        y = H * 0.18;
      }
      const b = bird.current;
      if (b) b.style.transform = `translate(${x}px, ${y}px)`;
      if (sprite.current) {
        // Три взмаха и планирование: так летят сороки — не мельтешат.
        const k = Math.floor(now / 110) % 6;
        const f = still ? 1 : [0, 1, 2, 1, 1, 1][k];
        sprite.current.style.backgroundPositionX = `${-f * cellW * 1.7}px`;
        sprite.current.style.transform = `scaleX(${face})`;
      }
      if (shadow.current) shadow.current.style.transform = `translate(${x}px, ${y + cellW * 0.9}px)`;
      if (!still && now - flapAt > 420) {
        flapAt = now;
        wingFlap(0.12);
      }
      // Роняет краденое в клетку под собой.
      if (now >= dropAt && !leaving && x > 0 && x < W && y > 0 && y < H) {
        dropAt = now + MAGPIE_DROP_MS * (0.75 + Math.random() * 0.5);
        const col = Math.min(MINE_COLS - 1, Math.max(0, Math.floor(x / cellW)));
        const row = Math.min(MINE_ROWS - 1, Math.max(0, Math.floor((y + cellW * 0.5) / cellW)));
        const cell = row * MINE_COLS + col;
        if (dropRef.current(cell) && !list.current.some((s) => s.cell === cell)) {
          const keyLeft = ev.need + keysDropped.current < MAGPIE_KEYS;
          const kind = shinyRoll(Math.random, keyLeft);
          if (kind === 'key') keysDropped.current += 1;
          seq.current += 1;
          put([...list.current, { id: seq.current, cell, kind, born: Date.now() }]);
          shinyDrop();
        }
      }
      // Не подобрал — сорока заберёт обратно (просто гаснет).
      const t = Date.now();
      if (list.current.some((s) => t - s.born > SHINY_LIFE_MS))
        put(list.current.filter((s) => t - s.born <= SHINY_LIFE_MS));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Налёт один на событие: новое событие — новый ключ компонента.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const h = hostRef.current();
  const cellW = h ? h.clientWidth / MINE_COLS : 48;
  const bw = cellW * 1.7;
  const bh = bw / 2;
  return (
    <>
      {shinies.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`pshiny pshiny--${s.kind}`}
          style={
            {
              left: `${((s.cell % MINE_COLS) + 0.5) * (100 / MINE_COLS)}%`,
              top: `${(Math.floor(s.cell / MINE_COLS) + 0.5) * (100 / MINE_ROWS)}%`,
              '--life': `${SHINY_LIFE_MS}ms`,
            } as CSSProperties
          }
          aria-label="Блестяшка — подбери"
          onPointerDown={(e) => {
            swallow(e);
            primeAudio();
            const kind = take(s.cell);
            if (kind) pickRef.current(kind, s.cell);
          }}
        >
          <ShinyIcon kind={s.kind} size={Math.round(cellW * 0.52)} />
        </button>
      ))}
      <i ref={shadow} className="pmag-shadow" style={{ width: cellW, height: cellW * 0.22 }} />
      <div ref={bird} className="pmag" style={{ width: bw, height: bh }} aria-hidden="true">
        <i
          ref={sprite}
          className="pmag__sprite"
          style={{ backgroundSize: `${bw * 3}px ${bh}px` }}
        />
      </div>
    </>
  );
});

// ---------------------------------------------------------------------------
// Карта колоды: лист `cards/deck.png`, 14×4 по 42×60 — пики, червы, бубны,
// трефы; столбец 13 — рубашка.
// ---------------------------------------------------------------------------

/** Масти в колоде игры (0…3) → ряды листа. */
const SUIT_ROW = [0, 1, 2, 3];

export function PlayingCard({
  card,
  open,
  className,
  style,
}: {
  card: number;
  open: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const face = {
    backgroundPosition: `${(cardRank(card) * 100) / 13}% ${(SUIT_ROW[Math.floor(card / 13)] * 100) / 3}%`,
  };
  return (
    <span className={`pcard${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} style={style}>
      <span className="pcard__in">
        <i className="pcard__back" />
        <i className="pcard__face" style={card >= 0 ? face : undefined} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Сундучок и риск.
// ---------------------------------------------------------------------------

const FROM_TITLE: Record<Treasure['from'], string> = {
  bat: 'Сундучок мыши',
  batRare: 'Сундучок синей мыши',
  magpie: 'Мешочек сороки',
};

type Flash = { kind: 'win' | 'draw'; step: number } | null;

export function TreasurePanel({
  onGot,
  onLost,
}: {
  /** Выдано: монеты уже в кошельке, страница досчитает табло. */
  onGot: (got: TreasureGot) => void;
  /** Риск сгорел. */
  onLost: (stake: number) => void;
}) {
  const treasure = useFinanceStore((s) => s.prison.treasure);
  const pickCard = useFinanceStore((s) => s.prisonTreasurePick);
  const takeIt = useFinanceStore((s) => s.prisonTreasureTake);
  const deal = useFinanceStore((s) => s.prisonRiskDeal);
  const riskPick = useFinanceStore((s) => s.prisonRiskPick);
  // Проигрыш закрывает сундучок в сторе сразу, а стол доигрывает открытие
  // карт — поэтому показываем снимок, пока он не отыграл.
  const [ghost, setGhost] = useState<Treasure | null>(null);
  const [reveal, setReveal] = useState<RiskOpen | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [leaving, setLeaving] = useState(-1);
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // Карты сундучка выходят веером, по одной.
  const shownId = treasure ? `${treasure.from}:${treasure.options.length}` : '';
  useEffect(() => {
    if (!treasure || treasure.pick >= 0) return;
    treasure.options.forEach((_, i) => cardDeal(0.08 + i * 0.12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const t = treasure ?? ghost;
  if (!t) return null;
  const chosen = t.pick >= 0 ? t.options[t.pick] : null;
  const risky = riskable(chosen ?? undefined);
  const stage: 'pick' | 'decide' | 'risk' =
    t.pick < 0 ? 'pick' : t.dealer >= 0 || reveal ? 'risk' : 'decide';

  const choose = (i: number) => {
    if (busy.current || !treasure || treasure.pick >= 0) return;
    primeAudio();
    uiTap();
    tapLight();
    const r = treasure.options[i];
    if (riskable(r)) {
      pickCard(i);
      cardFlip();
      return;
    }
    busy.current = true;
    setLeaving(i);
    cardFlip();
    later(() => {
      const got = pickCard(i);
      busy.current = false;
      setLeaving(-1);
      if (got) onGot(got);
    }, 380);
  };

  const take = () => {
    if (busy.current) return;
    primeAudio();
    const got = takeIt();
    setFlash(null);
    if (got) onGot(got);
  };

  const risk = () => {
    if (busy.current || !treasure) return;
    primeAudio();
    setFlash(null);
    setReveal(null);
    const d = deal();
    if (d == null) return;
    cardShuffle();
    [0, 1, 2, 3].forEach((k) => cardDeal(0.25 + k * 0.09));
    later(() => cardFlip(), 180);
    tapLight();
  };

  const open = (slot: number) => {
    if (busy.current || !treasure || treasure.dealer < 0) return;
    primeAudio();
    busy.current = true;
    const snap = treasure;
    const res = riskPick(slot);
    if (!res) {
      busy.current = false;
      return;
    }
    cardFlip();
    tapMedium();
    setReveal(res);
    if (res.outcome === 'lose') setGhost(snap);
    // Остальные три открываются следом — было ли там что-то лучше.
    later(() => cardFlip(), 420);
    later(() => {
      if (res.outcome === 'win') {
        riskWin(res.step);
        notifySuccess();
        burstConfetti(24 + res.step * 18, ['#ffd257', '#fff1d2', '#e2665b']);
      } else if (res.outcome === 'lose') {
        riskLose();
        notifyWarning();
      } else riskDraw();
    }, 520);
    later(
      () => {
        busy.current = false;
        setReveal(null);
        if (res.outcome === 'lose') {
          setGhost(null);
          onLost(snap.stake);
          return;
        }
        setFlash({ kind: res.outcome === 'win' ? 'win' : 'draw', step: res.step });
      },
      res.outcome === 'lose' ? 1700 : 1350,
    );
  };

  const shownStake = reveal?.outcome === 'win' ? reveal.stake : t.stake;
  const unit = chosen?.kind === 'tokens' ? 'tokens' : 'coins';
  const money = (n: number) => (unit === 'coins' ? shortMoney(n) : n.toLocaleString('ru-RU'));
  const Unit = ({ size }: { size: number }) =>
    unit === 'coins' ? <CoinIcon size={size} /> : <TokenIcon size={size} />;

  return (
    <div className="ptreasure" onPointerDown={swallow} role="dialog" aria-label={FROM_TITLE[t.from]}>
      <div className="ptreasure__veil" />
      <div className={`ptreasure__box is-${stage}`}>
        <div className="gx-ribbon ptreasure__title">
          {stage === 'risk' ? 'Риск' : FROM_TITLE[t.from]}
        </div>

        {stage === 'pick' && (
          <div className="ptreasure__cards">
            {t.options.map((r, i) => {
              const l = offerLabel(r);
              return (
                <button
                  key={i}
                  type="button"
                  className={`gx-panel ptcard${leaving === i ? ' is-taken' : ''}${leaving >= 0 && leaving !== i ? ' is-gone' : ''}`}
                  style={{ '--i': i } as CSSProperties}
                  onClick={() => choose(i)}
                >
                  <span className="ptcard__ico">
                    <RewardIcon r={r} size={40} />
                  </span>
                  <b>{l.amount}</b>
                  <i>{l.title}</i>
                </button>
              );
            })}
          </div>
        )}

        {stage === 'decide' && chosen && risky && (
          <div className="ptreasure__decide">
            <div className={`ptreasure__stake${flash?.kind === 'win' ? ' is-win' : ''}`}>
              <Unit size={34} />
              <b key={t.stake}>{money(t.stake)}</b>
              {t.step > 0 && <em>×{2 ** t.step}</em>}
            </div>
            {flash && (
              <span className={`ptreasure__flash is-${flash.kind}`}>
                {flash.kind === 'win' ? 'Угадал! Вдвое' : 'Ничья — ставка та же'}
              </span>
            )}
            <div className="ptreasure__btns">
              <button type="button" className="gx-btn gx-btn--red gx-btn--big" onClick={take}>
                Забрать
              </button>
              {t.step < RISK_STEPS && (
                <button type="button" className="gx-btn gx-btn--big ptreasure__risk" onClick={risk}>
                  Рискнуть <small>×2</small>
                </button>
              )}
            </div>
            {t.step === 0 && !flash && (
              <span className="ptreasure__hint">Старше карты сдающего — вдвое, младше — сгорит</span>
            )}
          </div>
        )}

        {stage === 'risk' && (
          <div className="prisk">
            <div className="prisk__stake">
              <Unit size={20} />
              <b>{money(shownStake)}</b>
              {!reveal && <em>→ {money(t.stake * 2)}</em>}
            </div>
            <div className="prisk__table">
              <div className="prisk__dealer">
                <PlayingCard card={reveal?.dealer ?? t.dealer} open className="is-dealt" />
                <i>Сдающий · {RANK_NAMES[cardRank(reveal?.dealer ?? t.dealer)]}</i>
              </div>
              <div className="prisk__four">
                {[0, 1, 2, 3].map((k) => {
                  const mine = reveal?.pick === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`prisk__slot${mine ? ' is-mine' : ''}${reveal && !mine ? ' is-other' : ''}`}
                      style={{ '--k': k } as CSSProperties}
                      disabled={!!reveal}
                      onClick={() => open(k)}
                      aria-label={`Карта ${k + 1}`}
                    >
                      <PlayingCard
                        card={reveal ? reveal.cards[k] : -1}
                        open={!!reveal}
                        className={`is-dealt${reveal && !mine ? ' is-late' : ''}`}
                        style={{ '--k': k } as CSSProperties}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            {reveal && (
              <span className={`prisk__verdict is-${reveal.outcome}`}>
                {reveal.outcome === 'win'
                  ? `Старше! ${money(reveal.stake)}`
                  : reveal.outcome === 'lose'
                    ? 'Младше — сгорело'
                    : 'Равная — ещё раз'}
              </span>
            )}
            {!reveal && <span className="prisk__hint">Выбери карту старше</span>}
          </div>
        )}
      </div>
    </div>
  );
}
