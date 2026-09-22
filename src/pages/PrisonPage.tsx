import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Screen, Sheet } from '@/components/ui';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import type { PrisonRankUp } from '@/store';
import {
  bagCapacity,
  bagCost,
  bagCount,
  bagValue,
  BAG_MAX,
  buildMine,
  CART_PRICE,
  CRIT_CHANCE,
  CRIT_MULT,
  hitDamage,
  LAST_RANK,
  MINE_COLS,
  MINE_CELLS,
  MINE_RESET_AT,
  MINE_ROWS,
  mineMix,
  minedShare,
  PICKS,
  prestigeCost,
  rankCost,
  rankLetter,
  rockAt,
  ROCKS,
  sellMult,
  sharpCost,
  SHARP_MAX,
  SHARP_STEP,
  shortMoney,
  tapGapMs,
} from '@/lib/prison';
import {
  bedrockTexture,
  crackTexture,
  rockColors,
  rockTexture,
  rockVariant,
} from '@/lib/prison-art';
import { createFx } from '@/lib/prison-fx';
import type { Fx } from '@/lib/prison-fx';
import { plainPlan, runRollup } from '@/lib/rollup';
import { addTrauma, squashPop, stopShake } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { useExit } from '@/lib/use-exit';
import {
  bagFull as bagFullSound,
  bedrockClink,
  blockBreak,
  coinDing,
  mineRumble,
  payoutEnd,
  pickHit,
  primeAudio,
  rollupTick,
  setMuted,
  tierBreak,
} from '@/lib/sound';
import {
  notifySuccess,
  notifyWarning,
  selectionChanged,
  setHapticsMuted,
  tapLight,
  tapMedium,
} from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// ---------------------------------------------------------------------------
// Кирка: рисунок один, цвет головки — от материала.
// ---------------------------------------------------------------------------

function PickIcon({ pick, size = 30 }: { pick: number; size?: number }) {
  const p = PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))];
  return (
    <svg className="ppick-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M6.5 27.5 L20 14" stroke="#4a2d16" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M6.5 27.5 L20 14" stroke="#a36d3c" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 5.5 C18.5 4.8 25.6 10.4 27.2 20 L24.6 20.6 C22.6 13.6 17.6 9.6 10.6 8.4 Z"
        fill={p.head}
        stroke="rgba(0,0,0,.55)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12.4 6.6 C18 6.4 23 9.8 25.2 15.6"
        fill="none"
        stroke="rgba(255,255,255,.55)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <rect
        x="17.2"
        y="10.8"
        width="5"
        height="5"
        rx="1"
        transform="rotate(45 19.7 13.3)"
        fill="#3a2414"
      />
    </svg>
  );
}

function BagIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M11 9 C11 4.5 21 4.5 21 9" fill="none" stroke="#6a4424" strokeWidth="2.4" />
      <path
        d="M7 12 C7 9.6 9 8.6 11 8.6 H21 C23 8.6 25 9.6 25 12 L26.4 25 C26.6 27.6 24.8 29 22.6 29 H9.4 C7.2 29 5.4 27.6 5.6 25 Z"
        fill="#9a6a3c"
        stroke="#3f2612"
        strokeWidth="1.4"
      />
      <path d="M8.6 14.5 H23.4" stroke="#6a4424" strokeWidth="2" />
      <rect x="14" y="13" width="4" height="4" rx="1" fill="#d9b35a" stroke="#6a4424" />
      <path
        d="M9 18 C9 24 10 26 12 27"
        fill="none"
        stroke="rgba(255,255,255,.2)"
        strokeWidth="1.4"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Клетка шахты. Сверху видно торец верхнего блока; чем глубже раскоп, тем
// темнее и чуть меньше торец (яма уходит вниз), а стенки соседей отбрасывают
// тень внутрь — свет падает сверху-слева.
// ---------------------------------------------------------------------------

interface CellProps {
  index: number;
  rock: number;
  variant: number;
  depth: number;
  crack: number;
  wt: number;
  wl: number;
  wb: number;
  wr: number;
  faceRef: (index: number, el: HTMLSpanElement | null) => void;
}

const MineCell = memo(function MineCell({
  index,
  rock,
  variant,
  depth,
  crack,
  wt,
  wl,
  wb,
  wr,
  faceRef,
}: CellProps) {
  const tex = rock < 0 ? bedrockTexture() : rockTexture(rock, variant);
  const x = index % MINE_COLS;
  const y = Math.floor(index / MINE_COLS);
  // Задержка подъёма при обновлении шахты: волна от центра к краям.
  const rise = Math.hypot(x - (MINE_COLS - 1) / 2, y - (MINE_ROWS - 1) / 2);
  const style = {
    '--d': depth,
    '--wt': wt,
    '--wl': wl,
    '--wb': wb,
    '--wr': wr,
    '--rd': `${Math.round(rise * 34)}ms`,
  } as CSSProperties;
  return (
    <div className={`pcell${rock < 0 ? ' is-bottom' : ''}`} style={style}>
      <span
        className="pcell__face"
        ref={(el) => faceRef(index, el)}
        style={{ backgroundImage: `url(${tex})` }}
      >
        {crack > 0 && (
          <i className="pcell__crack" style={{ backgroundImage: `url(${crackTexture(crack)})` }} />
        )}
      </span>
    </div>
  );
});

/** Высота стены между клеткой и соседом: сосед выше — тень глубже. */
function wall(dug: number[], c: number, dx: number, dy: number): number {
  const x = (c % MINE_COLS) + dx;
  const y = Math.floor(c / MINE_COLS) + dy;
  // За краем шахты — нетронутая порода: стена в полную глубину раскопа.
  const other = x < 0 || y < 0 || x >= MINE_COLS || y >= MINE_ROWS ? 0 : dug[y * MINE_COLS + x];
  return Math.max(0, dug[c] - other);
}

type Sheetname = 'forge' | 'mines' | 'prestige' | null;

export function PrisonPage() {
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const sound = useFinanceStore((s) => s.slotsSound);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const prisonBreak = useFinanceStore((s) => s.prisonBreak);
  const prisonSell = useFinanceStore((s) => s.prisonSell);
  const prisonRankUp = useFinanceStore((s) => s.prisonRankUp);
  const prisonBuy = useFinanceStore((s) => s.prisonBuy);
  const prisonGoMine = useFinanceStore((s) => s.prisonGoMine);
  const prisonPrestige = useFinanceStore((s) => s.prisonPrestige);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  const { mine, rank, prestige, pick, bagLevel, cart, bag } = prison;
  const rocks = useMemo(() => buildMine(mine.id, mine.seed), [mine.id, mine.seed]);
  const mineKey = `${mine.id}:${mine.seed}`;

  const [cracks, setCracks] = useState<number[]>(() => new Array<number>(MINE_CELLS).fill(0));
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [rankScene, setRankScene] = useState<PrisonRankUp | null>(null);
  const [sceneShown, sceneLeaving] = useExit(rankScene, 260);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [aiming, setAiming] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bagRef = useRef<HTMLButtonElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  const moneyRef = useRef<MoneyHandle>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const fx = useRef<Fx | null>(null);
  const faces = useRef<(HTMLSpanElement | null)[]>([]);
  const hp = useRef<Float32Array>(new Float32Array(MINE_CELLS).fill(-1));
  const lastHit = useRef(0);
  const pointer = useRef<{ id: number; cell: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const rolling = useRef<(() => void) | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullWarnAt = useRef(0);
  const toastSeq = useRef(0);
  // Баланс на табло: во время счёта продажи его ведёт ролл-ап, а не стор.
  const [shownBalance, setShownBalance] = useState(balance);
  useEffect(() => {
    if (!rolling.current) setShownBalance(balance);
  }, [balance]);

  const faceRef = useCallback((i: number, el: HTMLSpanElement | null) => {
    faces.current[i] = el;
  }, []);

  // Новая шахта (ранг, обновление, переход): трещины и урон — с нуля.
  useEffect(() => {
    hp.current.fill(-1);
    setCracks(new Array<number>(MINE_CELLS).fill(0));
  }, [mineKey]);

  // Канва крошки живёт вместе с полем.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    fx.current = createFx(c);
    const onResize = () => fx.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      fx.current?.destroy();
      fx.current = null;
    };
  }, [hydrated]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      rolling.current?.();
      stopShake();
    },
    [],
  );

  const say = useCallback((text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  // Счёт денег на табло — тот же ролл-ап, что у выигрышей в автоматах.
  const rollBalance = useCallback((from: number, to: number) => {
    rolling.current?.();
    const span = to - from;
    if (span <= 0) {
      setShownBalance(to);
      return;
    }
    const ms = Math.min(1800, 380 + 70 * Math.pow(span, 0.3));
    const stop = runRollup(plainPlan(from, to, ms), {
      value: (n) => moneyRef.current?.set(n),
      tick: (_leg, k) => rollupTick(0, k),
      done: () => {
        rolling.current = null;
        setShownBalance(useFinanceStore.getState().slotsBalance);
      },
    });
    rolling.current = () => {
      stop();
      rolling.current = null;
    };
  }, []);

  const cellCenter = (c: number) => {
    const field = fieldRef.current;
    if (!field) return { x: 0, y: 0, size: 0 };
    const size = field.clientWidth / MINE_COLS;
    return {
      x: ((c % MINE_COLS) + 0.5) * size,
      y: (Math.floor(c / MINE_COLS) + 0.5) * size,
      size,
    };
  };

  /** Всплывающая надпись над клеткой: «КРИТ», «+120». */
  const floatText = (c: number, text: string, cls: string) => {
    const layer = layerRef.current;
    const field = fieldRef.current;
    if (!layer || !field || reduceMotion()) return;
    const { x, y } = cellCenter(c);
    const el = document.createElement('span');
    el.className = `pfloat ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    const done = () => el.remove();
    try {
      const a = el.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
          { transform: 'translate(-50%, -110%) scale(1.15)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
        ],
        { duration: 700, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1200);
  };

  /** Добыча летит дугой из клетки в рюкзак. */
  const flyLoot = (c: number, rock: number) => {
    const layer = layerRef.current;
    const field = fieldRef.current;
    const bagEl = bagRef.current;
    if (!layer || !field || !bagEl) return;
    if (reduceMotion() || layer.childElementCount > 14) {
      squashPop(bagEl, 0.25);
      return;
    }
    const { x, y, size } = cellCenter(c);
    const fr = field.getBoundingClientRect();
    const br = bagEl.getBoundingClientRect();
    const tx = br.left + 26 - fr.left;
    const ty = br.top + br.height / 2 - fr.top;
    const img = document.createElement('img');
    img.className = 'ploot';
    img.src = rockTexture(rock);
    img.alt = '';
    const s = size * 0.46;
    img.style.width = `${s}px`;
    img.style.height = `${s}px`;
    img.style.left = `${x - s / 2}px`;
    img.style.top = `${y - s / 2}px`;
    layer.appendChild(img);
    const dx = tx - x;
    const dy = ty - y;
    // Дуга: сначала вверх и в сторону, потом вниз в рюкзак.
    const mx = dx * 0.35 + (Math.random() - 0.5) * 30;
    const my = Math.min(dy, 0) - 50;
    const done = () => img.remove();
    try {
      const a = img.animate(
        [
          { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(${mx}px, ${my}px) scale(1.2) rotate(${Math.random() * 60 - 30}deg)`,
            opacity: 1,
            offset: 0.38,
          },
          { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(0deg)`, opacity: 0.9 },
        ],
        { duration: 520, easing: 'cubic-bezier(.45,0,.55,1)' },
      );
      a.onfinish = () => {
        done();
        squashPop(bagEl, 0.22);
      };
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1000);
  };

  /** Кирка на клетке: качнулась и ударила. Одна на всё поле. */
  const swing = (c: number, crit: boolean) => {
    const el = pickRef.current;
    if (!el || reduceMotion()) return;
    const { x, y, size } = cellCenter(c);
    el.style.setProperty('--px', `${x}px`);
    el.style.setProperty('--py', `${y}px`);
    el.style.setProperty('--ps', `${size}px`);
    el.classList.add('is-on');
    try {
      el.animate(
        [
          { transform: 'rotate(-38deg)' },
          { transform: `rotate(${crit ? 16 : 10}deg)`, offset: 0.45 },
          { transform: 'rotate(0deg)' },
        ],
        { duration: 170, easing: 'cubic-bezier(.5,0,.3,1)' },
      );
    } catch {
      /* без WAAPI просто стоит */
    }
  };

  const aimAt = (c: number) => {
    const el = aimRef.current;
    if (!el) return;
    const { x, y, size } = cellCenter(c);
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  };

  const scheduleReset = () => {
    if (resetTimer.current) return;
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      const st = useFinanceStore.getState().prison;
      if (minedShare(st.mine.dug) < MINE_RESET_AT) return;
      mineRumble();
      tapMedium();
      addTrauma(fieldRef.current, 0.3);
      say('Шахта обновилась');
      prisonGoMine(st.mine.id);
    }, 650);
  };

  /** Один удар кирки по клетке. Весь «кликер» — здесь. */
  const hit = (c: number) => {
    if (c < 0 || c >= MINE_CELLS) return;
    const now = performance.now();
    const st = useFinanceStore.getState().prison;
    if (now - lastHit.current < tapGapMs(st.pick) - 4) return;
    lastHit.current = now;

    const depth = st.mine.dug[c];
    const rock = rockAt(rocks, c, depth);
    const { x, y } = cellCenter(c);
    swing(c, false);
    if (rock < 0) {
      bedrockClink();
      fx.current?.chips(x, y, ['#3a3432', '#1f1b1b'], 2, 0.5);
      return;
    }
    const r = ROCKS[rock];
    const crit = Math.random() < CRIT_CHANCE;
    const dmg = hitDamage(st.pick, st.sharp) * (crit ? CRIT_MULT : 1);
    const left = (hp.current[c] < 0 ? r.hp : hp.current[c]) - dmg;
    const face = faces.current[c];

    if (crit) {
      floatText(c, 'КРИТ', 'pfloat--crit');
      addTrauma(fieldRef.current, 0.16);
      tapMedium();
    }

    if (left > 1e-6) {
      hp.current[c] = left;
      const stage = Math.min(3, 1 + Math.floor((1 - left / r.hp) * 3));
      setCracks((prev) => {
        if (prev[c] === stage) return prev;
        const next = prev.slice();
        next[c] = stage;
        return next;
      });
      pickHit(r.kind, crit);
      if (!crit) selectionChanged();
      fx.current?.chips(x, y, rockColors(rock), crit ? 9 : 3, crit ? 1.3 : 0.7);
      if (face && !reduceMotion()) {
        try {
          face.animate(
            [
              { transform: 'scale(1)' },
              { transform: `scale(${crit ? 0.84 : 0.91})`, offset: 0.3 },
              { transform: 'scale(1.02)', offset: 0.7 },
              { transform: 'scale(1)' },
            ],
            { duration: 150, easing: 'ease-out' },
          );
        } catch {
          /* не страшно */
        }
      }
      return;
    }

    // Блок развалился.
    hp.current[c] = -1;
    setCracks((prev) => {
      if (!prev[c]) return prev;
      const next = prev.slice();
      next[c] = 0;
      return next;
    });
    const res = prisonBreak(c, rock);
    blockBreak(r.kind);
    if (crit) pickHit(r.kind, true);
    else tapLight();
    fx.current?.chips(x, y, rockColors(rock), crit ? 22 : 14, crit ? 1.6 : 1.1);
    fx.current?.puff(x, y, 'rgba(210,190,160,1)', 5);
    if (face && !reduceMotion()) {
      // Под сломанным блоком открылся следующий: он «проступает» из ямы.
      try {
        face.animate(
          [
            { transform: 'scale(.72)', opacity: 0.2 },
            { transform: 'scale(1.03)', opacity: 1, offset: 0.7 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 200, easing: 'cubic-bezier(.2,.8,.3,1)' },
        );
      } catch {
        /* не страшно */
      }
    }
    if (res.taken) {
      flyLoot(c, rock);
      // Порода следующей шахты на дне — находка, о ней стоит сказать.
      if (rock > st.mine.id) floatText(c, r.name, 'pfloat--find');
    } else if (now - fullWarnAt.current > 1400) {
      fullWarnAt.current = now;
      bagFullSound();
      notifyWarning();
      say(cart ? 'Рюкзак полон' : 'Рюкзак полон — продай добычу');
      squashPop(bagRef.current, 0.5);
    }
    if (res.sold) {
      // Вагонетка сама отвезла рюкзак.
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - res.sold, to);
      coinDing();
      floatText(c, `+${shortMoney(res.sold)}`, 'pfloat--coin');
    }
    const dug = useFinanceStore.getState().prison.mine.dug;
    if (minedShare(dug) >= MINE_RESET_AT) scheduleReset();
  };

  // Удержание бьёт из таймера, заведённого при касании. Зовёт оно ВСЕГДА
  // свежий `hit`: иначе после обновления шахты под пальцем таймер ломал бы
  // породу прошлой шахты — у того замыкания своё поле.
  const hitRef = useRef(hit);
  hitRef.current = hit;

  // ---- Пальцы: тап, удержание, ведение по жиле ---------------------------

  const cellAt = (cx: number, cy: number): number => {
    const r = rect.current;
    if (!r) return -1;
    const x = Math.floor(((cx - r.left) / r.width) * MINE_COLS);
    const y = Math.floor(((cy - r.top) / r.height) * MINE_ROWS);
    if (x < 0 || y < 0 || x >= MINE_COLS || y >= MINE_ROWS) return -1;
    return y * MINE_COLS + x;
  };

  const stopHold = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    pointer.current = null;
    setAiming(false);
    pickRef.current?.classList.remove('is-on');
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    primeAudio();
    rect.current = e.currentTarget.getBoundingClientRect();
    const c = cellAt(e.clientX, e.clientY);
    if (pointer.current) {
      // Второй палец — просто лишний удар, удержание ведёт первый.
      hit(c);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата тоже работает, пока палец над полем */
    }
    pointer.current = { id: e.pointerId, cell: c };
    if (c >= 0) aimAt(c);
    setAiming(true);
    hit(c);
    const rate = PICKS[useFinanceStore.getState().prison.pick].rate;
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = setInterval(() => {
      const p = pointer.current;
      if (p && p.cell >= 0) hitRef.current(p.cell);
    }, 1000 / rate);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c === p.cell) return;
    p.cell = c;
    if (c >= 0) {
      aimAt(c);
      // Провёл на новую клетку — удар сразу, если кирка успела (см. tapGapMs).
      hit(c);
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === e.pointerId) stopHold();
  };

  // ---- Деньги: продажа, ранг, кузница ------------------------------------

  const sell = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const value = prisonSell();
    if (!value) {
      notifyWarning();
      say('Рюкзак пуст — копай');
      return;
    }
    rollBalance(from, from + value);
    coinDing();
    coinDing(0.08);
    notifySuccess();
    squashPop(bagRef.current, 0.6);
    const cost = rankCost(rank, prestige);
    if (value >= cost * 0.3) {
      rainCoins(Math.min(30, 8 + Math.round((value / cost) * 20)));
      setTimeout(() => payoutEnd(1), 300);
    }
  };

  const rankUp = () => {
    primeAudio();
    if (rank >= LAST_RANK) {
      setSheet('prestige');
      return;
    }
    const res = prisonRankUp();
    if (!res) {
      notifyWarning();
      say(`Не хватает ${fmt(rankCost(rank, prestige) - balance)} монет`);
      return;
    }
    rolling.current?.();
    setShownBalance(useFinanceStore.getState().slotsBalance);
    tierBreak(3);
    notifySuccess();
    burstConfetti(80);
    addTrauma(fieldRef.current, 0.35);
    setRankScene(res);
  };

  const buy = (what: 'pick' | 'sharp' | 'bag' | 'cart') => {
    primeAudio();
    if (!prisonBuy(what)) {
      notifyWarning();
      return;
    }
    rolling.current?.();
    setShownBalance(useFinanceStore.getState().slotsBalance);
    coinDing();
    tierBreak(0);
    notifySuccess();
  };

  const goMine = (id: number) => {
    primeAudio();
    tapLight();
    prisonGoMine(id);
    mineRumble();
    setSheet(null);
  };

  const prestigeNow = () => {
    if (!prisonPrestige()) {
      notifyWarning();
      return;
    }
    rolling.current?.();
    setShownBalance(useFinanceStore.getState().slotsBalance);
    tierBreak(4);
    notifySuccess();
    burstConfetti(140);
    setSheet(null);
    say(`Престиж ${prestige + 1}: продажа ×${sellMult(prestige + 1).toFixed(2)}`);
  };

  // ---- Разметка ----------------------------------------------------------

  const cap = bagCapacity(bagLevel);
  const count = bagCount(bag);
  const value = bagValue(bag, prestige);
  const full = count >= cap;
  const atTop = rank >= LAST_RANK;
  const cost = atTop ? prestigeCost(prestige) : rankCost(rank, prestige);
  const progress = Math.max(0, Math.min(1, balance / cost));
  const mix = mineMix(mine.id);
  const newest = ROCKS[mine.id];

  const cells = [];
  for (let c = 0; c < MINE_CELLS; c++) {
    const d = mine.dug[c];
    cells.push(
      <MineCell
        key={c}
        index={c}
        rock={rockAt(rocks, c, d)}
        variant={rockVariant(mine.seed, c, d)}
        depth={d}
        crack={cracks[c]}
        wt={wall(mine.dug, c, 0, -1)}
        wl={wall(mine.dug, c, -1, 0)}
        wb={wall(mine.dug, c, 0, 1)}
        wr={wall(mine.dug, c, 1, 0)}
        faceRef={faceRef}
      />,
    );
  }

  if (!hydrated) {
    return (
      <Screen title="Каторга" className="prison-screen">
        <div className="prison-scene" aria-hidden="true" />
      </Screen>
    );
  }

  return (
    <Screen
      title="Каторга"
      subtitle={`Шахта ${rankLetter(mine.id)} · до ${newest.value} монет за блок${prestige ? ` · престиж ${prestige}` : ''}`}
      className="prison-screen"
      action={
        <button
          className="pmine-btn"
          type="button"
          aria-label="Шахты"
          onClick={() => {
            tapLight();
            setSheet('mines');
          }}
        >
          <span>{rankLetter(mine.id)}</span>
        </button>
      }
    >
      <div className="prison-scene" aria-hidden="true" />
      <div className="prison">
        <div className="phud">
          <div className="phud__cell">
            <span className="phud__label">Кошелёк · общий</span>
            <span className="phud__value">
              <MoneyCounter ref={moneyRef} value={shownBalance} />
              <CoinIcon size={17} />
            </span>
          </div>
          <button
            type="button"
            className={`phud__rank${progress >= 1 ? ' is-ready' : ''}`}
            onClick={rankUp}
          >
            <span className="phud__label">
              {atTop
                ? `Ранг Z · престиж ${prestige + 1}`
                : `Ранг ${rankLetter(rank)} → ${rankLetter(rank + 1)}`}
            </span>
            <span className="phud__cost">
              {progress >= 1 ? (atTop ? 'Престиж' : 'Взять ранг') : shortMoney(cost)}
              {progress < 1 && <CoinIcon size={13} />}
            </span>
            <span className="phud__bar">
              <i style={{ transform: `scaleX(${progress})` }} />
            </span>
          </button>
        </div>

        <div className="pmine-frame">
          <div
            className={`pmine${aiming ? ' is-aiming' : ''}`}
            ref={fieldRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="pmine__grid" key={mineKey}>
              {cells}
            </div>
            <canvas className="pmine__fx" ref={canvasRef} />
            <div className="pmine__aim" ref={aimRef} />
            <div className="pmine__pick" ref={pickRef}>
              <PickIcon pick={pick} size={38} />
            </div>
            <div className="pmine__layer" ref={layerRef} />
            {toast && (
              <div className="pmine__toast" key={toast.id}>
                {toast.text}
              </div>
            )}
          </div>
        </div>

        <div className="pbar">
          <button
            type="button"
            ref={bagRef}
            className={`pbag${full ? ' is-full' : ''}${cart ? ' has-cart' : ''}`}
            onClick={sell}
          >
            <BagIcon />
            <span className="pbag__body">
              <span className="pbag__top">
                <b>
                  {count} / {cap}
                </b>
                <span className="pbag__sell">
                  {count ? (
                    <>
                      Продать · {shortMoney(value)} <CoinIcon size={12} />
                    </>
                  ) : (
                    'Рюкзак пуст'
                  )}
                </span>
              </span>
              <span className="pbag__bar">
                <i style={{ transform: `scaleX(${Math.min(1, count / cap)})` }} />
              </span>
            </span>
          </button>
          <button
            type="button"
            className="pforge-btn"
            onClick={() => {
              tapLight();
              setSheet('forge');
            }}
          >
            <PickIcon pick={pick} size={28} />
            <span>Кузница</span>
          </button>
        </div>

        {/* Породы этой шахты и цена блока — чтобы знать, что почём. */}
        <div className="pmix" aria-label="Породы шахты">
          {mix.map((m) => (
            <span key={m.rock} className="pmix__rock">
              <img src={rockTexture(m.rock)} alt="" />
              <b>{ROCKS[m.rock].value}</b>
            </span>
          ))}
        </div>

        {prison.mined < 12 && (
          <p className="prison-hint">
            Тапни по блоку. Держи палец — кирка бьёт сама. Веди пальцем — ломаешь по жиле. Добычу
            продавай: деньги те же, что в автоматах.
          </p>
        )}
      </div>

      {sheet === 'forge' && (
        <Sheet title="Кузница" onClose={() => setSheet(null)}>
          <Forge balance={balance} onBuy={buy} />
        </Sheet>
      )}

      {sheet === 'mines' && (
        <Sheet title="Шахты" onClose={() => setSheet(null)}>
          <div className="pmines">
            {Array.from({ length: Math.min(LAST_RANK, rank + 1) + 1 }, (_, id) => {
              const locked = id > rank;
              const here = id === mine.id;
              return (
                <div
                  key={id}
                  className={`pmines__row${here ? ' is-here' : ''}${locked ? ' is-locked' : ''}`}
                >
                  <span className="pmines__letter">{rankLetter(id)}</span>
                  <span className="pmines__rocks">
                    {mineMix(id).map((m) => (
                      <img key={m.rock} src={rockTexture(m.rock)} alt={ROCKS[m.rock].name} />
                    ))}
                  </span>
                  <span className="pmines__info">
                    <b>{ROCKS[id].name}</b>
                    <i>
                      {locked ? `Нужен ранг ${rankLetter(id)}` : `до ${ROCKS[id].value} за блок`}
                    </i>
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      className="btn btn--sm pmines__go"
                      onClick={() => goMine(id)}
                    >
                      {here ? 'Обновить' : 'Спуститься'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            В шахте пять пород: самая новая — редкая, глубже её больше. На дне изредка попадается
            порода следующей шахты. Выработал 85% — шахта обновится сама.
          </p>
        </Sheet>
      )}

      {sheet === 'prestige' && (
        <Sheet title={`Престиж ${prestige + 1}`} onClose={() => setSheet(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              Ранг и шахта вернутся на A. Кирка, заточка, рюкзак и вагонетка останутся. Продажа
              станет дороже: ×{sellMult(prestige + 1).toFixed(2)} вместо ×
              {sellMult(prestige).toFixed(2)}. Ранги на новом круге дороже на треть.
            </p>
            <button
              className="btn btn--primary btn--block"
              disabled={balance < prestigeCost(prestige)}
              onClick={prestigeNow}
            >
              Престиж за {fmt(prestigeCost(prestige))} монет
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => setSheet(null)}>
              Пока нет
            </button>
          </div>
        </Sheet>
      )}

      {sceneShown && (
        <div
          className={`prank${sceneLeaving ? ' is-out' : ''}`}
          onClick={() => {
            tapLight();
            setRankScene(null);
          }}
        >
          <div className="prank__card">
            <span className="prank__label">Новый ранг</span>
            <b className="prank__letter">{rankLetter(sceneShown.rank)}</b>
            <span className="prank__mine">
              <img src={rockTexture(sceneShown.rank)} alt="" />
              Открыта шахта {rankLetter(sceneShown.rank)}:{' '}
              {ROCKS[sceneShown.rank].name.toLowerCase()}, {ROCKS[sceneShown.rank].value} за блок
            </span>
            {sceneShown.levelUps.length > 0 && (
              <span className="prank__lvl">
                Уровень {sceneShown.levelUps[sceneShown.levelUps.length - 1]} — награда в кошельке
              </span>
            )}
            <span className="prank__cta">В шахту</span>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Кузница: всё покупается за общие монеты.
// ---------------------------------------------------------------------------

function Forge({
  balance,
  onBuy,
}: {
  balance: number;
  onBuy: (what: 'pick' | 'sharp' | 'bag' | 'cart') => void;
}) {
  const p = useFinanceStore((s) => s.prison);
  const cur = PICKS[p.pick];
  const next = PICKS[p.pick + 1];
  const dmg = hitDamage(p.pick, p.sharp);

  const row = (
    key: string,
    icon: ReactNode,
    title: string,
    text: string,
    price: number | null,
    what: 'pick' | 'sharp' | 'bag' | 'cart',
  ) => (
    <div className="pforge__row" key={key}>
      <span className="pforge__ico">{icon}</span>
      <span className="pforge__info">
        <b>{title}</b>
        <i>{text}</i>
      </span>
      {price === null ? (
        <span className="pforge__done">Есть</span>
      ) : (
        <button
          type="button"
          className="btn btn--sm pforge__buy"
          disabled={balance < price}
          onClick={() => onBuy(what)}
        >
          {shortMoney(price)} <CoinIcon size={12} />
        </button>
      )}
    </div>
  );

  return (
    <div className="pforge">
      <div className="pforge__now">
        <PickIcon pick={p.pick} size={40} />
        <span>
          <b>{cur.name} кирка</b>
          <i>
            урон {dmg.toFixed(dmg < 10 ? 1 : 0)} · {cur.rate} удара в секунду · крит{' '}
            {Math.round(CRIT_CHANCE * 100)}% ×{CRIT_MULT}
          </i>
        </span>
      </div>
      {row(
        'pick',
        <PickIcon pick={next ? p.pick + 1 : p.pick} size={30} />,
        next ? `${next.name} кирка` : 'Лучшая кирка',
        next
          ? `урон ${cur.dmg} → ${next.dmg}, скорость ${cur.rate} → ${next.rate}`
          : 'Сильнее кирки нет',
        next ? next.price : null,
        'pick',
      )}
      {row(
        'sharp',
        <span className="pforge__glyph">⟋</span>,
        `Заточка ${p.sharp}/${SHARP_MAX}`,
        p.sharp < SHARP_MAX
          ? `+${Math.round(SHARP_STEP * 100)}% урона любой кирке`
          : 'Острее некуда',
        p.sharp < SHARP_MAX ? sharpCost(p.sharp) : null,
        'sharp',
      )}
      {row(
        'bag',
        <BagIcon size={28} />,
        `Рюкзак ${bagCapacity(p.bagLevel)}`,
        p.bagLevel < BAG_MAX
          ? `${bagCapacity(p.bagLevel)} → ${bagCapacity(p.bagLevel + 1)} блоков`
          : 'Больше не унести',
        p.bagLevel < BAG_MAX ? bagCost(p.bagLevel) : null,
        'bag',
      )}
      {row(
        'cart',
        <span className="pforge__glyph">🛒</span>,
        'Вагонетка',
        'Сама продаёт рюкзак, когда он полон',
        p.cart ? null : CART_PRICE,
        'cart',
      )}
      <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
        Сломано блоков: {fmt(p.mined)} · выручено: {fmt(p.earned)} монет
        {p.prestige ? ` · продажа ×${sellMult(p.prestige).toFixed(2)}` : ''}
      </p>
    </div>
  );
}
