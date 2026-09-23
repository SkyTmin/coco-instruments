import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Screen, Sheet } from '@/components/ui';
import { IconGear, IconGift } from '@/components/icons';
import { CashDesk } from '@/components/CashDesk';
import { RewardsSheet, useReadyRewards } from '@/components/RewardsSheet';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon } from '@/components/slot-art';
import {
  BagIcon,
  KeyIcon,
  ParcelReveal,
  PickIcon,
  PrisonCamp,
  TokenIcon,
} from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { ParcelOpen, PrisonLoot, PrisonRankUp } from '@/store';
import {
  bagCapacity,
  bagCount,
  bagValue,
  blastCells,
  buildMine,
  CRIT_CHANCE,
  CRIT_MULT,
  crewYield,
  decayStreak,
  DEPTH,
  ENCHANT_UNLOCK,
  ENCHANTS,
  ENERGY_RATE,
  findOf,
  FRENZY_RATE,
  GUIDE,
  guideReady,
  guideStep,
  hitDamage,
  ITEMS,
  LAST_RANK,
  MINE_CELLS,
  MINE_COLS,
  MINE_RESET_AT,
  MINE_ROWS,
  mineMix,
  minedShare,
  modsOf,
  perkPointsFree,
  pickLevelOf,
  PICKS,
  prestigeCost,
  quotaBuyout,
  quotaDone,
  quotaProgress,
  rankCost,
  rankQuota,
  rankLetter,
  rockAt,
  ROCKS,
  sellMult,
  shortMoney,
  STREAK_GRACE_MS,
  STREAK_DECAY_MS,
  STREAK_TIERS,
  streakTier,
  veinCells,
  CASE_TIERS,
  milesReady,
  PARCEL_NEED,
  petLevelOf,
  petOf,
  ROCKFALL_HITS,
  RUNE_ROMAN,
  SEID_HITS,
  seidsOf,
  seidTop,
} from '@/lib/prison';
import type { FindId, GuideReward, ItemId, PrisonState, Quota } from '@/lib/prison';
import {
  bedrockTexture,
  crackTexture,
  findTexture,
  parcelTexture,
  petTexture,
  seidTexture,
  tearTexture,
  rockColors,
  rockTexture,
  rockVariant,
} from '@/lib/prison-art';
import { createFx } from '@/lib/prison-fx';
import type { Fx } from '@/lib/prison-fx';
import { plainPlan, runRollup } from '@/lib/rollup';
import { addTrauma, flashFrame, squashPop, stopShake } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { useExit } from '@/lib/use-exit';
import {
  bagFull as bagFullSound,
  bedrockClink,
  blockBreak,
  boom,
  chainTick,
  coinDing,
  frenzyStart,
  fuseTick,
  keyFound,
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
/** Коротко для узкой ячейки табло: 12 345 → «12,3к». */
const shortCount = (n: number) =>
  n < 1e4
    ? fmt(n)
    : n < 1e6
      ? `${(Math.floor(n / 100) / 10).toLocaleString('ru-RU')}к`
      : `${(Math.floor(n / 1e5) / 10).toLocaleString('ru-RU')}м`;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Скорость кирки прямо сейчас: перки, энергетик, кураж. */
function liveRate(p: PrisonState): number {
  const now = Date.now();
  const base = PICKS[p.pick].rate * modsOf(p).rate;
  let r = base;
  if (now < p.energyUntil) r *= ENERGY_RATE;
  if (now < p.frenzyUntil) r *= FRENZY_RATE;
  // Потолок: иначе энергетик в кураже превращал бы удержание в пулемёт.
  return Math.min(r, base * 2.5);
}

/** Минимальный промежуток между ударами тапом — 1,8 скорости удержания. */
const gapMs = (p: PrisonState) => 1000 / (liveRate(p) * 1.8);

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
  /** Лупа: порода ярусом ниже, если она ценнее верхней (−1 — не показывать). */
  peek: number;
  /** Сверху порода, которой не хватает в норме ранга. */
  need: boolean;
  /** Сверху сейд-камень. */
  seid: boolean;
  /** Лупа: сейд в этой клетке на столько ярусов ниже (−1 — нет). */
  seidBelow: number;
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
  peek,
  need,
  seid,
  seidBelow,
  wt,
  wl,
  wb,
  wr,
  faceRef,
}: CellProps) {
  const tex = seid ? seidTexture() : rock < 0 ? bedrockTexture() : rockTexture(rock, variant);
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
    <div className={`pcell${rock < 0 ? ' is-bottom' : ''}${seid ? ' is-seid' : ''}`} style={style}>
      <span
        className="pcell__face"
        ref={(el) => faceRef(index, el)}
        style={{ backgroundImage: `url(${tex})` }}
      >
        {crack > 0 && (
          <i className="pcell__crack" style={{ backgroundImage: `url(${crackTexture(crack)})` }} />
        )}
      </span>
      {seid && <i className="pcell__glow" />}
      {seidBelow > 0 ? (
        <span className="pcell__seidmark">
          <img src={seidTexture()} alt="" />
          <b>↓{seidBelow}</b>
        </span>
      ) : (
        peek >= 0 && <img className="pcell__peek" src={rockTexture(peek)} alt="" />
      )}
      {need && !seid && <i className="pcell__need" />}
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

/** Кольца вокруг клетки: для волн отбойника и взрыва (по Чебышёву). */
function rings(center: number, cells: number[]): number[][] {
  const cx = center % MINE_COLS;
  const cy = Math.floor(center / MINE_COLS);
  const out: number[][] = [];
  for (const c of cells) {
    const d = Math.max(Math.abs((c % MINE_COLS) - cx), Math.abs(Math.floor(c / MINE_COLS) - cy));
    (out[d] ??= []).push(c);
  }
  return out.filter(Boolean);
}

type BreakKind = 'hit' | 'crit' | 'vein' | 'blast' | 'hammer';

type Sheetname = 'mines' | 'prestige' | 'norm' | 'settings' | null;

/** Сколько секунд простоя до того, как полоска запала начинает мигать. */
const STREAK_WARN_MS = 1500;
/** Сводка смены — раз в столько минут копания. */
const SHIFT_MS = 5 * 60_000;

/** Награда проводника одной строкой. */
function rewardText(r: GuideReward): string {
  const out: string[] = [];
  if (r.coins) out.push(`+${fmt(r.coins)} монет`);
  if (r.tokens) out.push(`+${fmt(r.tokens)} ✦`);
  if (r.keys) out.push(r.keys > 1 ? `+${r.keys} ключа` : '+ключ');
  if (r.item) {
    const it = ITEMS.find((i) => i.id === r.item![0])!;
    out.push(`${it.glyph} ${it.name.toLowerCase()}${r.item[1] > 1 ? ` ×${r.item[1]}` : ''}`);
  }
  if (r.rune) out.push(`руна ${RUNE_ROMAN[r.rune - 1]}`);
  if (r.pet) out.push(petOf(r.pet).name.toLowerCase());
  return out.join(' · ');
}

/** Норма фишками: порода, сколько сдано из скольких. */
function QuotaChips({ quota, norm }: { quota: Quota[]; norm: Record<number, number> }) {
  return (
    <span className="pquota">
      {quota.map((q) => {
        const have = Math.min(q.n, norm[q.rock] ?? 0);
        return (
          <span key={q.rock} className={`pquota__chip${have >= q.n ? ' is-done' : ''}`}>
            <img src={rockTexture(q.rock)} alt={ROCKS[q.rock].name} />
            {have >= q.n ? '✓' : `${have}/${q.n}`}
          </span>
        );
      })}
    </span>
  );
}

export function PrisonPage() {
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const sound = useFinanceStore((s) => s.slotsSound);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const prisonBreak = useFinanceStore((s) => s.prisonBreak);
  const prisonSell = useFinanceStore((s) => s.prisonSell);
  const prisonRankUp = useFinanceStore((s) => s.prisonRankUp);
  const prisonGoMine = useFinanceStore((s) => s.prisonGoMine);
  const prisonPrestige = useFinanceStore((s) => s.prisonPrestige);
  const prisonUseItem = useFinanceStore((s) => s.prisonUseItem);
  const prisonFrenzy = useFinanceStore((s) => s.prisonFrenzy);
  const prisonCrewCollect = useFinanceStore((s) => s.prisonCrewCollect);
  const prisonStreak = useFinanceStore((s) => s.prisonStreak);
  const prisonGuideClaim = useFinanceStore((s) => s.prisonGuideClaim);
  const prisonParcelOpen = useFinanceStore((s) => s.prisonParcelOpen);
  const prisonSeid = useFinanceStore((s) => s.prisonSeid);
  const prisonReset = useFinanceStore((s) => s.prisonReset);
  const gamesReset = useFinanceStore((s) => s.gamesReset);
  const skin = useFinanceStore((s) => s.slotsSkin);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  const { mine, rank, prestige, pick, bagLevel, cart, bag } = prison;
  const rocks = useMemo(() => buildMine(mine.id, mine.seed), [mine.id, mine.seed]);
  const seids = useMemo(() => seidsOf(mine.id, mine.seed), [mine.id, mine.seed]);
  const mineKey = `${mine.id}:${mine.seed}`;

  const [cracks, setCracks] = useState<number[]>(() => new Array<number>(MINE_CELLS).fill(0));
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [camp, setCamp] = useState<CampTab | null>(null);
  const [rankScene, setRankScene] = useState<PrisonRankUp | null>(null);
  const [sceneShown, sceneLeaving] = useExit(rankScene, 260);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [findCard, setFindCard] = useState<{ id: FindId; fresh: boolean; n: number } | null>(null);
  const [cardShown, cardLeaving] = useExit(findCard, 260);
  const [aiming, setAiming] = useState(false);
  const [arming, setArming] = useState<ItemId | null>(null);
  const [crewNote, setCrewNote] = useState(false);
  const [rewards, setRewards] = useState(false);
  const [reveal, setReveal] = useState<ParcelOpen | null>(null);
  /** Какой сброс взведён: первый тап взводит, второй — сбрасывает. */
  const [wipe, setWipe] = useState<'prison' | 'all' | null>(null);
  useEffect(() => {
    if (!wipe) return undefined;
    const t = setTimeout(() => setWipe(null), 5000);
    return () => clearTimeout(t);
  }, [wipe]);
  const [shift, setShift] = useState<{
    blocks: number;
    coins: number;
    tokens: number;
    keys: number;
  } | null>(null);
  const [shiftShown, shiftLeaving] = useExit(shift, 260);
  // Запал живёт в странице: это награда за то, что копаешь СЕЙЧАС.
  const [streak, setStreak] = useState(0);
  const [cooling, setCooling] = useState(false);

  // Баффы: страница перерисовывается раз в секунду, только пока хоть один
  // идёт, — ради таймеров на плашках и чтобы лупа погасла вовремя.
  const nowTick = Date.now();
  const buffs = {
    energy: Math.max(0, prison.energyUntil - nowTick),
    frenzy: Math.max(0, prison.frenzyUntil - nowTick),
    lens: Math.max(0, prison.lensUntil - nowTick),
  };
  const anyBuff = buffs.energy > 0 || buffs.frenzy > 0 || buffs.lens > 0;
  useTicker(anyBuff);
  // Подарок в шапке: награды дня общие с автоматами, счётчик — тот же.
  const [rewardsNow, setRewardsNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setRewardsNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const readyRewards = useReadyRewards(rewardsNow);

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
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const rolling = useRef<(() => void) | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fullWarnAt = useRef(0);
  const toastSeq = useRef(0);
  const mineKeyRef = useRef(mineKey);
  mineKeyRef.current = mineKey;
  const stripRef = useRef<HTMLDivElement>(null);
  const parcelsRef = useRef<HTMLDivElement>(null);
  const campRef = useRef<HTMLButtonElement>(null);
  const totemAt = useRef(0);
  const petRef = useRef<HTMLImageElement>(null);
  const streakBase = useRef({ n: 0, at: 0 });
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Темп: что сломано и сколько это стоит за последнюю минуту.
  const paceLog = useRef<{ t: number; blocks: number; coins: number }[]>([]);
  // Смена: итог каждые пять минут копания.
  const shiftAcc = useRef({ from: 0, blocks: 0, coins: 0, tokens: 0, keys: 0 });
  // Баланс на табло: во время счёта продажи его ведёт ролл-ап, а не стор.
  const [shownBalance, setShownBalance] = useState(balance);
  useEffect(() => {
    if (!rolling.current) setShownBalance(balance);
  }, [balance]);

  const faceRef = useCallback((i: number, el: HTMLSpanElement | null) => {
    faces.current[i] = el;
  }, []);

  // Новая шахта (ранг, обновление, переход): трещины и урон — с нуля, волны
  // прошлого поля не доигрываются.
  useEffect(() => {
    hp.current.fill(-1);
    setCracks(new Array<number>(MINE_CELLS).fill(0));
    waveTimers.current.forEach(clearTimeout);
    waveTimers.current = [];
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
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (streakTimer.current) clearTimeout(streakTimer.current);
      waveTimers.current.forEach(clearTimeout);
      rolling.current?.();
      stopShake();
    },
    [],
  );

  // Вернулся после смены — бригада уже накопала: сказать об этом сразу.
  useEffect(() => {
    if (!hydrated) return;
    const y = crewYield(useFinanceStore.getState().prison, Date.now());
    if (y.blocks > 0 && y.minutes >= 15) setCrewNote(true);
  }, [hydrated]);

  // Свернули приложение посреди удержания — кирка не должна бить в фоне.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stopHold();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const say = useCallback((text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!findCard) return undefined;
    const t = setTimeout(() => setFindCard(null), 2600);
    return () => clearTimeout(t);
  }, [findCard]);
  useEffect(() => {
    if (!shift) return undefined;
    const t = setTimeout(() => setShift(null), 4200);
    return () => clearTimeout(t);
  }, [shift]);

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

  const settleBalance = useCallback(() => {
    rolling.current?.();
    setShownBalance(useFinanceStore.getState().slotsBalance);
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

  /** Всплывающая надпись над клеткой: «КРИТ», «ВЗРЫВ», «+3 токена». */
  const floatText = (c: number, text: string, cls: string, delay = 0) => {
    const layer = layerRef.current;
    const field = fieldRef.current;
    if (!layer || !field || reduceMotion()) return;
    const { x, y } = cellCenter(c);
    const el = document.createElement('span');
    el.className = `pfloat ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = '0';
    layer.appendChild(el);
    const done = () => el.remove();
    try {
      const a = el.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
          { transform: 'translate(-50%, -110%) scale(1.15)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
        ],
        { duration: 760, delay, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1400 + delay);
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

  /** Ударная волна: кольцо по полю от точки. Только прозрачность и масштаб. */
  const shockwave = (c: number, cells: number, hot = false) => {
    const layer = layerRef.current;
    if (!layer || reduceMotion()) return;
    const { x, y, size } = cellCenter(c);
    const el = document.createElement('i');
    el.className = `pwave${hot ? ' pwave--hot' : ''}`;
    const d = size * cells;
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.left = `${x - d / 2}px`;
    el.style.top = `${y - d / 2}px`;
    layer.appendChild(el);
    const done = () => el.remove();
    try {
      const a = el.animate(
        [
          { transform: 'scale(.2)', opacity: 1 },
          { transform: 'scale(1.15)', opacity: 0 },
        ],
        { duration: 420 + cells * 25, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1200);
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

  // ---- Запал --------------------------------------------------------------

  /** Запал прямо сейчас, с учётом простоя с последнего блока. */
  const streakNow = () => {
    const b = streakBase.current;
    return decayStreak(b.n, Date.now() - b.at);
  };

  /**
   * Следующий такт угасания. Таймер спит до ближайшей границы: сначала
   * полоска начинает мигать (предупреждение), потом ступень гаснет.
   */
  const armDecay = () => {
    if (streakTimer.current) clearTimeout(streakTimer.current);
    streakTimer.current = null;
    const b = streakBase.current;
    if (b.n <= 0) return;
    const idle = Date.now() - b.at;
    let wake: number;
    if (idle < STREAK_WARN_MS) wake = STREAK_WARN_MS;
    else if (idle <= STREAK_GRACE_MS) wake = STREAK_GRACE_MS + 1;
    else
      wake =
        STREAK_GRACE_MS +
        (Math.floor((idle - STREAK_GRACE_MS) / STREAK_DECAY_MS) + 1) * STREAK_DECAY_MS +
        1;
    streakTimer.current = setTimeout(() => {
      const n = streakNow();
      setStreak(n);
      setCooling(n > 0);
      if (n <= 0) {
        streakBase.current = { n: 0, at: 0 };
        return;
      }
      armDecay();
    }, wake - idle);
  };

  /** Запал поднялся на ступень: надпись, удар, рекорд и миссия дня. */
  const streakUp = (t: number, c: number) => {
    const tier = STREAK_TIERS[t];
    const first = t + 1 > useFinanceStore.getState().prison.bestStreak;
    prisonStreak(t);
    floatText(c, `${tier.name.toUpperCase()}!`, 'pfloat--streak');
    tierBreak(Math.min(3, t));
    tapMedium();
    squashPop(stripRef.current, 0.35 + 0.1 * t);
    if (t >= 3) addTrauma(fieldRef.current, 0.2);
    if (first)
      say(`«${tier.name}»: +${Math.round(tier.loot * 100)}% к добыче, пока бьёшь без пауз`);
  };

  const bumpStreak = (blocks: number, c: number) => {
    const now = Date.now();
    const n0 = decayStreak(streakBase.current.n, now - streakBase.current.at);
    const n = n0 + blocks;
    streakBase.current = { n, at: now };
    setStreak(n);
    setCooling(false);
    const t0 = streakTier(n0);
    const t1 = streakTier(n);
    if (t1 > t0) streakUp(t1, c);
    armDecay();
  };

  /** Темп и смена: копим, что сломано и сколько стоит. */
  const logPace = (blocks: number, coins: number, res: PrisonLoot) => {
    const now = Date.now();
    const log = paceLog.current;
    log.push({ t: now, blocks, coins });
    while (log.length && now - log[0].t > 60_000) log.shift();
    const acc = shiftAcc.current;
    // Больше минуты без блоков — прошлая смена закончилась, начинаем новую.
    const last = log.length > 1 ? log[log.length - 2].t : 0;
    if (!acc.from || (last && now - last > 60_000)) {
      shiftAcc.current = { from: now, blocks: 0, coins: 0, tokens: 0, keys: 0 };
    }
    const a = shiftAcc.current;
    a.blocks += blocks;
    a.coins += coins;
    a.tokens += res.tokens + res.pickUps.reduce((x, u) => x + u.tokens, 0);
    a.keys += res.keys + res.pickUps.reduce((x, u) => x + u.keys, 0);
    if (now - a.from >= SHIFT_MS && a.blocks >= 50) {
      setShift({ blocks: a.blocks, coins: a.coins, tokens: a.tokens, keys: a.keys });
      notifySuccess();
      shiftAcc.current = { from: now, blocks: 0, coins: 0, tokens: 0, keys: 0 };
    }
  };

  /**
   * Выпал ключ — сцена тотема бессмертия из Майнкрафта: слеза гаста
   * вылетает в центр экрана, растёт и проворачивается, вокруг брызжут
   * зелёно-жёлтые искры, потом она улетает в лагерь, где лежат ключи.
   * Слой на весь экран, но в нём только transform и opacity; живёт две
   * секунды и убирает себя сам. Второй ключ, пока играет первый, — просто
   * надпись: две сцены подряд друг друга съедают.
   */
  const totemKey = (c: number, n: number) => {
    keyFound();
    notifySuccess();
    const { x, y } = cellCenter(c);
    fx.current?.chips(x, y, ['#4fd04a', '#a6ec3a', '#f2e64a', '#ffffff'], 18, 1.4);
    const now = performance.now();
    if (reduceMotion() || now - totemAt.current < 2300) {
      floatText(c, n > 1 ? `+${n} ключа` : '+ключ', 'pfloat--key', 120);
      return;
    }
    totemAt.current = now;
    tierBreak(2);
    tapMedium();
    const host = document.createElement('div');
    host.className = 'ptotem';
    document.body.appendChild(host);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.42;
    const colors = ['#3fbf3f', '#6fdc3a', '#a6ec3a', '#f2e64a', '#e8c23a', '#58d06a'];
    for (let i = 0; i < 48; i++) {
      const p = document.createElement('i');
      p.className = 'ptotem__p';
      p.style.background = colors[i % colors.length];
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      host.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 160;
      const dx = Math.cos(ang) * sp;
      const dy = Math.sin(ang) * sp * 0.75 - 30;
      const fall = 90 + Math.random() * 110;
      try {
        p.animate(
          [
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
            {
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`,
              opacity: 1,
              offset: 0.45,
            },
            {
              transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + fall}px)) scale(.3)`,
              opacity: 0,
            },
          ],
          {
            duration: 1100 + Math.random() * 600,
            delay: 150 + Math.random() * 250,
            easing: 'cubic-bezier(.2,.6,.4,1)',
            fill: 'both',
          },
        );
      } catch {
        /* без WAAPI — без искр */
      }
    }
    const img = document.createElement('img');
    img.className = 'ptotem__item';
    img.src = tearTexture();
    img.alt = '';
    img.style.left = `${cx}px`;
    img.style.top = `${cy}px`;
    host.appendChild(img);
    const cr = campRef.current?.getBoundingClientRect();
    const tx = cr ? cr.left + cr.width / 2 - cx : 0;
    const ty = cr ? cr.top + cr.height / 2 - cy : window.innerHeight * 0.4;
    const done = () => host.remove();
    try {
      const a = img.animate(
        [
          {
            transform: 'translate(-50%, -50%) scale(.3) rotateY(0deg) rotateZ(-14deg)',
            opacity: 0,
          },
          {
            transform: 'translate(-50%, -50%) scale(3.4) rotateY(200deg) rotateZ(9deg)',
            opacity: 1,
            offset: 0.3,
          },
          {
            transform: 'translate(-50%, -50%) scale(2.8) rotateY(360deg) rotateZ(-5deg)',
            opacity: 1,
            offset: 0.52,
          },
          {
            transform: 'translate(-50%, -50%) scale(2.7) rotateY(360deg) rotateZ(0deg)',
            opacity: 1,
            offset: 0.72,
          },
          {
            transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(.45) rotateY(360deg)`,
            opacity: 0.9,
          },
        ],
        { duration: 2000, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
      );
      a.onfinish = () => {
        done();
        squashPop(campRef.current, 0.6);
        coinDing();
      };
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 3200);
    if (n > 1) say(`${n} ключа от сундука!`);
  };

  /** Что сказать и показать по итогам слома: токены, ключи, находки, рюкзак. */
  const announce = (c: number, res: PrisonLoot) => {
    const now = performance.now();
    if (res.tokens > 0) floatText(c, `+${res.tokens} ✦`, 'pfloat--token', 120);
    if (res.keys > 0) totemKey(c, res.keys);
    if (res.finds.length) {
      const f = res.finds[res.finds.length - 1];
      const n = useFinanceStore.getState().prison.finds[f.id] ?? 1;
      setFindCard({ id: f.id, fresh: f.fresh, n });
      if (f.fresh) {
        tierBreak(2);
        burstConfetti(50, ['#ffe08a', '#b8f4e6', '#fff']);
        notifySuccess();
      } else coinDing();
    }
    if (res.pickUps.length) {
      const up = res.pickUps[res.pickUps.length - 1];
      const opened = ENCHANTS.filter((e) =>
        res.pickUps.some((u) => ENCHANT_UNLOCK[e.id] === u.level),
      );
      floatText(c, `КИРКА ${up.level}`, 'pfloat--level', 180);
      tierBreak(1);
      notifySuccess();
      const tokens = res.pickUps.reduce((x, u) => x + u.tokens, 0);
      const keys = res.pickUps.reduce((x, u) => x + u.keys, 0);
      say(
        opened.length
          ? `Кирка ${up.level} ур. · открыта чара «${opened[opened.length - 1].name}»`
          : `Кирка ${up.level} ур. · +${fmt(tokens)} ✦${keys ? ' · +ключ' : ''}`,
      );
    }
    if (res.parcels.length) {
      floatText(c, 'ПЕРЕДАЧКА', 'pfloat--parcel', 200);
      tierBreak(1);
      tapMedium();
      squashPop(parcelsRef.current, 0.5);
    }
    if (res.parcelTokens) floatText(c, `+${res.parcelTokens} ✦`, 'pfloat--token', 260);
    if (res.parcelsReady) {
      notifySuccess();
      keyFound();
      say('Передачка дозрела — вскрой её');
    }
    if (res.petUp) {
      const st = useFinanceStore.getState().prison;
      if (st.pet) say(`${petOf(st.pet).name}: ${res.petUp} уровень`);
      tierBreak(1);
      squashPop(petRef.current, 0.6);
    }
    if (res.normDone) {
      tierBreak(2);
      notifySuccess();
      burstConfetti(40, ['#9be38a', '#ffe08a', '#fff']);
      say('Норма выполнена — бери ранг');
    }
    if (res.lost > 0 && now - fullWarnAt.current > 1400) {
      fullWarnAt.current = now;
      bagFullSound();
      notifyWarning();
      say('Рюкзак полон — продай добычу');
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

  /**
   * Сломать верхние блоки клеток разом. Порода берётся с поля В ЭТОТ МИГ —
   * волны отбойника идут кольцами, и к третьему кольцу первое уже на ярус
   * глубже.
   */
  const breakCells = (cells: number[], kind: BreakKind): PrisonLoot | null => {
    const st = useFinanceStore.getState().prison;
    // Сейд-камень площадные чары не берут: его ломают только руками.
    const list = cells
      .filter((cell) => !seidTop(seids, cell, st.mine.dug[cell]))
      .map((cell) => ({ cell, rock: rockAt(rocks, cell, st.mine.dug[cell]) }))
      .filter((b) => b.rock >= 0);
    if (!list.length) return null;
    for (const b of list) hp.current[b.cell] = -1;
    setCracks((prev) => {
      if (!list.some((b) => prev[b.cell])) return prev;
      const next = prev.slice();
      for (const b of list) next[b.cell] = 0;
      return next;
    });
    const valueBefore = bagValue(st.bag, modsOf(st).sell);
    const res = prisonBreak(list, { streak: streakNow() });
    const after = useFinanceStore.getState().prison;
    const gained = bagValue(after.bag, modsOf(after).sell) - valueBefore + res.sold;
    bumpStreak(res.broken, list[0].cell);
    logPace(res.broken, gained, res);
    const single = kind === 'hit' || kind === 'crit';
    // Перековка: блок засчитан породой выше — золотые искры и её имя.
    if (res.reforged.length) {
      const f = res.reforged[0];
      const { x, y } = cellCenter(f.cell);
      fx.current?.chips(x, y, ['#ffd35a', '#fff3b0', '#ffae3a'], single ? 12 : 6, 1.2);
      if (single) floatText(f.cell, `⚙ ${ROCKS[f.rock].name}`, 'pfloat--reforge', 120);
    }
    // Порода в норму: счёт над клеткой, пока норма по ней не закрыта.
    const q = after.rank < LAST_RANK ? rankQuota(after.rank, after.prestige) : [];
    const qb = list.find((b) => res.normAdd[b.rock] && q.some((x) => x.rock === b.rock));
    if (qb && !res.normDone) {
      const row = q.find((x) => x.rock === qb.rock)!;
      const have = after.norm[qb.rock] ?? 0;
      if (have <= row.n)
        floatText(
          qb.cell,
          `${have}/${row.n}`,
          `pfloat--norm${have >= row.n ? ' is-done' : ''}`,
          60,
        );
    }
    list.forEach((b, i) => {
      const { x, y } = cellCenter(b.cell);
      const colors = rockColors(b.rock);
      if (single) {
        fx.current?.chips(x, y, colors, kind === 'crit' ? 22 : 14, kind === 'crit' ? 1.6 : 1.1);
        fx.current?.puff(x, y, 'rgba(210,190,160,1)', 5);
      } else {
        fx.current?.chips(x, y, colors, kind === 'hammer' ? 5 : 9, kind === 'vein' ? 1 : 1.35);
        if (i < 12) fx.current?.puff(x, y, 'rgba(210,190,160,1)', 3);
      }
      const face = faces.current[b.cell];
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
      if (res.taken > 0 && i < (single ? 1 : 4)) flyLoot(b.cell, b.rock);
      // Порода следующей шахты на дне — находка, о ней стоит сказать.
      if (single && b.rock > st.mine.id) floatText(b.cell, ROCKS[b.rock].name, 'pfloat--find');
    });
    if (single) blockBreak(ROCKS[list[0].rock].kind);
    announce(list[0].cell, res);
    return res;
  };
  const breakRef = useRef(breakCells);
  breakRef.current = breakCells;

  /** Волна колец: каждое кольцо ломается в свой такт, от центра наружу. */
  const wave = (groups: number[][], kind: BreakKind, stepMs: number) => {
    const key = mineKeyRef.current;
    groups.forEach((g, i) => {
      const t = setTimeout(() => {
        // Шахта сменилась посреди волны — прошлое поле не доламываем.
        if (mineKeyRef.current !== key) return;
        breakRef.current(g, kind);
      }, i * stepMs);
      waveTimers.current.push(t);
    });
  };

  const blastAt = (c: number, r: number, label: string) => {
    const cells = blastCells(c, r);
    boom(r);
    // Без надписи — это не первый взрыв серии (камнепад): вспышка на каждом
    // превратила бы град в стробоскоп.
    if (label) flashFrame(r >= 2 ? 'big' : 'small');
    addTrauma(fieldRef.current, 0.3 + 0.15 * r);
    tapMedium();
    shockwave(c, 2 * r + 1.6, true);
    if (label) floatText(c, label, 'pfloat--blast');
    wave(rings(c, cells), 'blast', 45);
  };

  /** Луч: весь ряд, от места удара к краям. Полоса света — одним слоем. */
  const beamFrom = (c: number) => {
    const row = Math.floor(c / MINE_COLS);
    const cells = Array.from({ length: MINE_COLS }, (_, x) => row * MINE_COLS + x);
    const layer = layerRef.current;
    if (layer && !reduceMotion()) {
      const { y, size } = cellCenter(c);
      const el = document.createElement('i');
      el.className = 'pbeam';
      el.style.top = `${y - size * 0.32}px`;
      el.style.height = `${size * 0.64}px`;
      el.style.transformOrigin = `${cellCenter(c).x}px 50%`;
      layer.appendChild(el);
      const done = () => el.remove();
      try {
        const a = el.animate(
          [
            { transform: 'scaleX(0)', opacity: 1 },
            { transform: 'scaleX(1)', opacity: 1, offset: 0.35 },
            { transform: 'scaleX(1) scaleY(.2)', opacity: 0 },
          ],
          { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        a.onfinish = done;
        a.oncancel = done;
      } catch {
        done();
      }
      setTimeout(done, 900);
    }
    boom(1);
    tierBreak(1);
    addTrauma(fieldRef.current, 0.3);
    tapMedium();
    floatText(c, 'ЛУЧ', 'pfloat--beam');
    wave(rings(c, cells), 'blast', 40);
  };

  /** Камнепад: град взрывов по полю, друг за другом. */
  const rockfallAt = (c: number) => {
    const key = mineKeyRef.current;
    const picked = new Set<number>();
    while (picked.size < ROCKFALL_HITS) picked.add(Math.floor(Math.random() * MINE_CELLS));
    floatText(c, 'КАМНЕПАД', 'pfloat--blast');
    mineRumble();
    flashFrame('big');
    [...picked].forEach((cell, i) => {
      waveTimers.current.push(
        setTimeout(
          () => {
            if (mineKeyRef.current !== key) return;
            blastAt(cell, 1, '');
          },
          140 + i * 190,
        ),
      );
    });
  };

  /**
   * Трещина: удар расходится по четырём соседям тем же уроном. Слабые
   * соседи ломаются, крепкие — трескаются: урон живёт в странице, как и
   * у обычного удара.
   */
  const crackFrom = (c: number, dmg: number) => {
    const st = useFinanceStore.getState().prison;
    const x = c % MINE_COLS;
    const y = Math.floor(c / MINE_COLS);
    const nb = [
      x > 0 ? c - 1 : -1,
      x < MINE_COLS - 1 ? c + 1 : -1,
      y > 0 ? c - MINE_COLS : -1,
      y < MINE_ROWS - 1 ? c + MINE_COLS : -1,
    ].filter((n) => n >= 0);
    const broken: number[] = [];
    const staged: [number, number][] = [];
    for (const n of nb) {
      const rock = rockAt(rocks, n, st.mine.dug[n]);
      if (rock < 0 || seidTop(seids, n, st.mine.dug[n])) continue;
      const hpMax = ROCKS[rock].hp;
      const left = (hp.current[n] < 0 ? hpMax : hp.current[n]) - dmg;
      if (left <= 1e-6) broken.push(n);
      else {
        hp.current[n] = left;
        staged.push([n, Math.min(3, 1 + Math.floor((1 - left / hpMax) * 3))]);
      }
    }
    if (staged.length)
      setCracks((prev) => {
        const next = prev.slice();
        for (const [n, stage] of staged) next[n] = stage;
        return next;
      });
    floatText(c, 'ТРЕЩИНА', 'pfloat--crack');
    chainTick(2);
    if (broken.length) breakCells(broken, 'vein');
  };

  const hammerFrom = (c: number, label: string, power = 2) => {
    const all = Array.from({ length: MINE_CELLS }, (_, i) => i);
    boom(power);
    mineRumble();
    flashFrame('big');
    addTrauma(fieldRef.current, 0.65);
    tapMedium();
    shockwave(c, 16);
    floatText(c, label, 'pfloat--blast');
    wave(rings(c, all), 'hammer', 34);
  };

  const veinFrom = (c: number, rock: number, max: number) => {
    const st = useFinanceStore.getState().prison;
    const cells = veinCells(rocks, st.mine.dug, c, rock, max);
    if (!cells.length) return;
    floatText(c, `ЖИЛА ×${cells.length + 1}`, 'pfloat--vein');
    const key = mineKeyRef.current;
    cells.forEach((cell, i) => {
      const t = setTimeout(
        () => {
          if (mineKeyRef.current !== key) return;
          chainTick(i + 1);
          breakRef.current([cell], 'vein');
        },
        (i + 1) * 60,
      );
      waveTimers.current.push(t);
    });
  };

  const startFrenzy = (c: number) => {
    prisonFrenzy();
    frenzyStart();
    notifySuccess();
    floatText(c, 'КУРАЖ!', 'pfloat--frenzy');
    say('Кураж: 15 секунд двойной добычи');
  };

  /**
   * Удар по сейд-камню. Считаются УДАРЫ, а не урон: сколько бы ни била
   * кирка, нужно несколько попаданий, крит — за два. Счёт живёт в том же
   * `hp`, что и урон породы: сейд сверху — значит, это его запас.
   */
  const seidHit = (c: number, crit: boolean) => {
    swing(c, crit);
    const { x, y } = cellCenter(c);
    const left = (hp.current[c] < 0 ? SEID_HITS : hp.current[c]) - (crit ? 2 : 1);
    fx.current?.chips(x, y, ['#3fe6d0', '#c8fff6', '#262b33'], crit ? 12 : 6, crit ? 1.4 : 0.9);
    if (left > 0) {
      hp.current[c] = left;
      const stage = Math.min(3, 1 + Math.floor((1 - left / SEID_HITS) * 3));
      setCracks((prev) => {
        if (prev[c] === stage) return prev;
        const next = prev.slice();
        next[c] = stage;
        return next;
      });
      pickHit('crystal', crit);
      tapMedium();
      if (crit) floatText(c, 'КРИТ', 'pfloat--crit');
      const face = faces.current[c];
      if (face && !reduceMotion()) {
        try {
          face.animate(
            [
              { transform: 'scale(1)' },
              { transform: 'scale(.86) rotate(-3deg)', offset: 0.3 },
              { transform: 'scale(1.04) rotate(2deg)', offset: 0.7 },
              { transform: 'scale(1)' },
            ],
            { duration: 200, easing: 'ease-out' },
          );
        } catch {
          /* не страшно */
        }
      }
      return;
    }
    hp.current[c] = -1;
    setCracks((prev) => {
      if (!prev[c]) return prev;
      const next = prev.slice();
      next[c] = 0;
      return next;
    });
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonSeid(c);
    if (!got) return;
    rollBalance(from, from + got.coins);
    tierBreak(3);
    flashFrame('big');
    addTrauma(fieldRef.current, 0.45);
    notifySuccess();
    shockwave(c, 5, false);
    fx.current?.chips(x, y, ['#3fe6d0', '#c8fff6', '#ffffff', '#8ff5e6'], 40, 2);
    burstConfetti(70, ['#3fe6d0', '#c8fff6', '#ffe08a']);
    floatText(c, `+${got.tokens} ✦`, 'pfloat--seid');
    say(`Сейд-камень: +${fmt(got.tokens)} токенов, +${shortMoney(got.coins)} монет`);
    bumpStreak(1, c);
  };

  /** Один удар кирки по клетке. Весь «кликер» — здесь. */
  const hit = (c: number) => {
    if (c < 0 || c >= MINE_CELLS) return;
    const now = performance.now();
    const st = useFinanceStore.getState().prison;
    if (now - lastHit.current < gapMs(st) - 4) return;
    lastHit.current = now;

    const depth = st.mine.dug[c];
    if (seidTop(seids, c, depth)) {
      seidHit(c, Math.random() < CRIT_CHANCE);
      return;
    }
    const rock = rockAt(rocks, c, depth);
    const { x, y } = cellCenter(c);
    if (rock < 0) {
      swing(c, false);
      bedrockClink();
      fx.current?.chips(x, y, ['#3a3432', '#1f1b1b'], 2, 0.5);
      return;
    }
    const r = ROCKS[rock];
    const m = modsOf(st);
    const crit = Math.random() < CRIT_CHANCE;
    swing(c, crit);
    const dmg = hitDamage(st.pick, st.sharp) * m.dmg * (crit ? CRIT_MULT : 1);
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
    if (crit) pickHit(r.kind, true);
    else tapLight();
    breakCells([c], crit ? 'crit' : 'hit');

    // Зачарования. Срабатывает одно, старшее: отбойник, камнепад, луч,
    // взрыв, жила, трещина — несколько сразу превращают поле в кашу, в
    // которой не видно ни одного.
    if (Math.random() < m.hammer) hammerFrom(c, 'ОТБОЙНИК');
    else if (Math.random() < m.rockfall) rockfallAt(c);
    else if (Math.random() < m.beam) beamFrom(c);
    else if (Math.random() < m.blast) blastAt(c, 1, 'ВЗРЫВ');
    else if (Math.random() < m.vein) veinFrom(c, rock, m.veinMax);
    else if (Math.random() < m.crack) crackFrom(c, dmg);
    if (Math.random() < m.frenzy) startFrenzy(c);
  };

  // Удержание бьёт из таймера, заведённого при касании. Зовёт оно ВСЕГДА
  // свежий `hit`: иначе после обновления шахты под пальцем таймер ломал бы
  // породу прошлой шахты — у того замыкания своё поле.
  const hitRef = useRef(hit);
  hitRef.current = hit;

  // ---- Расходники --------------------------------------------------------

  /** Бомба ложится в клетку, фитиль шипит, потом взрыв. */
  const dropBomb = (c: number, id: ItemId) => {
    if (!prisonUseItem(id)) {
      notifyWarning();
      return;
    }
    const r = id === 'bomb5' ? 2 : 1;
    const layer = layerRef.current;
    const { x, y, size } = cellCenter(c);
    let sprite: HTMLElement | null = null;
    if (layer && !reduceMotion()) {
      sprite = document.createElement('span');
      sprite.className = 'pbomb';
      sprite.textContent = ITEMS.find((i) => i.id === id)!.glyph;
      sprite.style.left = `${x}px`;
      sprite.style.top = `${y}px`;
      sprite.style.fontSize = `${size * 0.8}px`;
      layer.appendChild(sprite);
      try {
        sprite.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1.8)', opacity: 0 },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.2 },
            { transform: 'translate(-50%,-50%) scale(1.12)', offset: 0.45 },
            { transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 },
            { transform: 'translate(-50%,-50%) scale(1.22)', offset: 0.85 },
            { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1 },
          ],
          { duration: 760, fill: 'forwards' },
        );
      } catch {
        /* не страшно */
      }
    }
    tapLight();
    const key = mineKeyRef.current;
    [0, 260, 520].forEach((ms, k) => waveTimers.current.push(setTimeout(() => fuseTick(k), ms)));
    waveTimers.current.push(
      setTimeout(() => {
        sprite?.remove();
        if (mineKeyRef.current !== key) return;
        blastAt(c, r, r > 1 ? 'ДИНАМИТ' : 'БУМ');
      }, 760),
    );
  };

  const applyItem = (id: ItemId) => {
    primeAudio();
    const st = useFinanceStore.getState().prison;
    if (st.items[id] <= 0) {
      tapLight();
      setCamp('shop');
      return;
    }
    if (id === 'bomb3' || id === 'bomb5') {
      selectionChanged();
      setArming((cur) => (cur === id ? null : id));
      return;
    }
    if (id === 'charge') {
      if (!prisonUseItem('charge')) return;
      say('Заряд заложен');
      fuseTick(0);
      const key = mineKeyRef.current;
      waveTimers.current.push(
        setTimeout(() => {
          if (mineKeyRef.current !== key) return;
          hammerFrom(Math.floor(MINE_CELLS / 2), 'ЗАРЯД', 3);
        }, 450),
      );
      return;
    }
    if (!prisonUseItem(id)) return;
    notifySuccess();
    tierBreak(1);
    say(id === 'energy' ? 'Энергетик: кирка вдвое быстрее' : 'Лупа: видно, что лежит ярусом ниже');
  };

  // ---- Пальцы: тап, удержание, ведение по жиле ---------------------------

  const cellAt = (cx: number, cy: number): number => {
    const r = rect.current;
    if (!r) return -1;
    const x = Math.floor(((cx - r.left) / r.width) * MINE_COLS);
    const y = Math.floor(((cy - r.top) / r.height) * MINE_ROWS);
    if (x < 0 || y < 0 || x >= MINE_COLS || y >= MINE_ROWS) return -1;
    return y * MINE_COLS + x;
  };

  function stopHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    pointer.current = null;
    setAiming(false);
    pickRef.current?.classList.remove('is-on');
  }

  // Шаг удержания пересчитывается на каждом ударе: энергетик или кураж,
  // начавшиеся под пальцем, ускоряют кирку сразу, без повторного касания.
  const holdTick = () => {
    const p = pointer.current;
    if (!p) return;
    if (p.cell >= 0) hitRef.current(p.cell);
    holdTimer.current = setTimeout(holdTick, 1000 / liveRate(useFinanceStore.getState().prison));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    primeAudio();
    rect.current = e.currentTarget.getBoundingClientRect();
    const c = cellAt(e.clientX, e.clientY);
    if (arming) {
      if (c >= 0) {
        const id = arming;
        setArming(null);
        dropBomb(c, id);
      }
      return;
    }
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
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(holdTick, 1000 / liveRate(useFinanceStore.getState().prison));
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c === p.cell) return;
    p.cell = c;
    if (c >= 0) {
      aimAt(c);
      // Провёл на новую клетку — удар сразу, если кирка успела (см. gapMs).
      hit(c);
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === e.pointerId) stopHold();
  };

  // ---- Деньги: продажа, ранг, бригада -----------------------------------

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
    const cost = rankCost(Math.min(rank, LAST_RANK - 1), prestige);
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
    const st = useFinanceStore.getState();
    const q = rankQuota(st.prison.rank, st.prison.prestige);
    // Не готово — лист нормы: что сдано, чего не хватает, сколько стоит откуп.
    if (!quotaDone(q, st.prison.norm) || st.slotsBalance < rankCost(rank, prestige)) {
      tapLight();
      setSheet('norm');
      return;
    }
    takeRank(false);
  };

  /** Взять ранг: по выполненной норме или с откупом недобора. */
  const takeRank = (buyout: boolean) => {
    const res = prisonRankUp(buyout);
    if (!res) {
      notifyWarning();
      return;
    }
    setSheet(null);
    settleBalance();
    tierBreak(3);
    notifySuccess();
    burstConfetti(80);
    addTrauma(fieldRef.current, 0.35);
    setRankScene(res);
  };

  const openParcel = (i: number) => {
    primeAudio();
    const x = useFinanceStore.getState().prison.parcels[i];
    if (!x) return;
    if (x.left > 0) {
      tapLight();
      say(
        `Вскроется через ${fmt(x.left)} ${x.left % 10 === 1 && x.left % 100 !== 11 ? 'блок' : 'блоков'}`,
      );
      return;
    }
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonParcelOpen(i);
    if (!got) return;
    const to = useFinanceStore.getState().slotsBalance;
    if (to > from) rollBalance(from, to);
    tapMedium();
    setReveal(got);
  };

  /**
   * Сброс необратим, поэтому в два касания: первое взводит кнопку и пишет,
   * что пропадёт, второе — сбрасывает. Взведённая сама гаснет через 5 с.
   */
  const doWipe = (what: 'prison' | 'all') => {
    primeAudio();
    if (wipe !== what) {
      notifyWarning();
      setWipe(what);
      return;
    }
    setWipe(null);
    if (what === 'all') gamesReset();
    else prisonReset();
    streakBase.current = { n: 0, at: 0 };
    if (streakTimer.current) clearTimeout(streakTimer.current);
    setStreak(0);
    setCooling(false);
    paceLog.current = [];
    settleBalance();
    setSheet(null);
    mineRumble();
    tapMedium();
    say(what === 'all' ? 'Всё в играх начато заново' : 'Каторга начата заново');
  };

  const claimGuide = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const r = prisonGuideClaim();
    if (!r) return;
    if (r.coins) rollBalance(from, from + r.coins);
    coinDing();
    tierBreak(1);
    notifySuccess();
    burstConfetti(36, ['#ffe08a', '#b8f4e6', '#fff']);
    if (r.keys) keyFound();
  };

  const collectCrew = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonCrewCollect();
    setCrewNote(false);
    if (!got) return;
    rollBalance(from, from + got.coins);
    coinDing();
    notifySuccess();
    say(`Бригада: +${shortMoney(got.coins)} монет, +${fmt(got.tokens)} токенов`);
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
    settleBalance();
    tierBreak(4);
    notifySuccess();
    burstConfetti(140);
    setSheet(null);
    const st = useFinanceStore.getState().prison;
    say(`Престиж ${st.prestige}: +2 очка перков, продажа ×${sellMult(st.prestige).toFixed(2)}`);
  };

  // ---- Разметка ----------------------------------------------------------

  const m = modsOf(prison);
  const cap = bagCapacity(bagLevel);
  const count = bagCount(bag);
  const value = bagValue(bag, m.sell);
  const full = count >= cap;
  const atTop = rank >= LAST_RANK;
  const cost = atTop ? prestigeCost(prestige) : rankCost(rank, prestige);
  const progress = Math.max(0, Math.min(1, balance / cost));
  const quota = atTop ? [] : rankQuota(rank, prestige);
  const qDone = quotaDone(quota, prison.norm);
  const buyout = atTop ? 0 : quotaBuyout(rank, prestige, prison.norm);
  const rankReady = progress >= 1 && qDone;
  // Точка — только на редкой породе нормы: ходовая лежит на каждом шагу, и
  // точки на половине поля ничего не подсказывают.
  const needRocks = new Set(
    quota
      .filter((q) => q.rock === rank && rank > 0 && (prison.norm[q.rock] ?? 0) < q.n)
      .map((q) => q.rock),
  );
  const pickLv = pickLevelOf(prison.pickXp);
  const sTier = streakTier(streak);
  const sNext = STREAK_TIERS[sTier + 1];
  const sFrom = sTier >= 0 ? STREAK_TIERS[sTier].at : 0;
  const sFill = sNext ? (streak - sFrom) / (sNext.at - sFrom) : 1;
  // Темп за последнюю минуту — только пока копаешь.
  const pace = (() => {
    const log = paceLog.current;
    if (!log.length || streak <= 0 || nowTick - log[log.length - 1].t > 8000) return null;
    const span = Math.max(10_000, Math.min(60_000, nowTick - log[0].t));
    if (nowTick - log[0].t < 6000) return null;
    let b = 0;
    let c = 0;
    for (const e of log) {
      if (nowTick - e.t > 60_000) continue;
      b += e.blocks;
      c += e.coins;
    }
    return { blocks: (b * 60_000) / span, coins: (c * 60_000) / span };
  })();
  const guide = guideStep(prison);
  const guideOk = guideReady(prison);
  const [guideV, guideGoal] = guide ? guide.progress(prison) : [0, 0];
  const mix = mineMix(mine.id);
  const newest = ROCKS[mine.id];
  const crewNow = crewYield(prison, nowTick);
  const campBadge = perkPointsFree(prison) > 0 || crewNow.minutes >= 60 || milesReady(prison) > 0;

  const cells = [];
  for (let c = 0; c < MINE_CELLS; c++) {
    const d = mine.dug[c];
    const top = rockAt(rocks, c, d);
    let peek = -1;
    if (buffs.lens > 0 && top >= 0 && d + 1 < DEPTH) {
      const below = rockAt(rocks, c, d + 1);
      if (ROCKS[below].value > ROCKS[top].value) peek = below;
    }
    cells.push(
      <MineCell
        key={c}
        index={c}
        rock={top}
        variant={rockVariant(mine.seed, c, d)}
        depth={d}
        crack={cracks[c]}
        peek={peek}
        need={needRocks.has(top)}
        seid={seidTop(seids, c, d)}
        seidBelow={
          buffs.lens > 0 ? (seids.find((x) => x.cell === c && x.depth > d)?.depth ?? d) - d : 0
        }
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

  const sec = (ms: number) => `${Math.ceil(ms / 1000)} с`;

  return (
    <Screen
      title="Каторга"
      subtitle={`Шахта ${rankLetter(mine.id)} · до ${newest.value} монет за блок${prestige ? ` · престиж ${prestige}` : ''}`}
      className="prison-screen"
      action={
        <div className="row" style={{ gap: 8 }}>
          <button
            className="pmine-btn pmine-btn--gift"
            type="button"
            aria-label="Награды дня"
            onClick={() => {
              tapLight();
              setRewards(true);
            }}
          >
            <IconGift size={19} />
            {readyRewards > 0 && <i className="pmine-btn__badge">{readyRewards}</i>}
          </button>
          <button
            className="pmine-btn pmine-btn--gear"
            type="button"
            aria-label="Настройки"
            onClick={() => {
              tapLight();
              setSheet('settings');
            }}
          >
            <IconGear size={19} />
          </button>
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
        </div>
      }
    >
      <div className="prison-scene" aria-hidden="true" />
      <div className={`prison${guide ? ' has-guide' : ''}`}>
        <div className="phud">
          <div className="phud__cell">
            <span className="phud__label">Кошелёк</span>
            <span className="phud__value">
              <MoneyCounter ref={moneyRef} value={shownBalance} />
              <CoinIcon size={16} />
            </span>
          </div>
          <button
            type="button"
            className="phud__cell phud__purse"
            onClick={() => {
              tapLight();
              setCamp('enchant');
            }}
          >
            <span className="phud__label">Токены</span>
            <span className="phud__value phud__value--token">
              {shortCount(prison.tokens)} <TokenIcon size={14} />
            </span>
          </button>
          <button
            type="button"
            className={`phud__rank${(atTop ? progress >= 1 : rankReady) ? ' is-ready' : ''}`}
            onClick={rankUp}
          >
            <span className="phud__label">
              {atTop
                ? `Z · престиж ${prestige + 1}`
                : `Ранг ${rankLetter(rank)} → ${rankLetter(rank + 1)}`}
            </span>
            <span className="phud__cost">
              {atTop ? (
                progress >= 1 ? (
                  'Престиж'
                ) : (
                  <>
                    {shortMoney(cost)} <CoinIcon size={12} />
                  </>
                )
              ) : rankReady ? (
                'Взять'
              ) : (
                <>
                  <span className={progress >= 1 ? 'phud__ok' : undefined}>{shortMoney(cost)}</span>
                  <CoinIcon size={12} />
                  <QuotaChips quota={quota} norm={prison.norm} />
                </>
              )}
            </span>
            <span className="phud__bar">
              <i
                style={{
                  transform: `scaleX(${atTop ? progress : Math.min(progress, quotaProgress(quota, prison.norm))})`,
                }}
              />
            </span>
          </button>
        </div>

        <div
          className={`pmine-frame${buffs.energy ? ' is-energy' : ''}${buffs.frenzy ? ' is-frenzy' : ''}`}
        >
          {/* Полоса запала сидит на верхней кромке рамы: отдельной строкой
              она отнимала бы у поля высоту. */}
          <div
            className={`pstrip${sTier >= 0 ? ` is-t${sTier}` : ''}${cooling ? ' is-cooling' : ''}`}
            ref={stripRef}
          >
            <span className="pstrip__pick" title="Уровень кирки">
              <b>
                <PickIcon pick={pick} size={13} />
                {pickLv.level}
              </b>
              <span className="pstrip__xp">
                <i
                  style={{ transform: `scaleX(${pickLv.need ? pickLv.into / pickLv.need : 1})` }}
                />
              </span>
            </span>
            <span className="pstrip__streak">
              <span className="pstrip__name">
                {sTier >= 0 ? STREAK_TIERS[sTier].name : 'Запал'}
                {sTier >= 0 && <em>+{Math.round(STREAK_TIERS[sTier].loot * 100)}%</em>}
              </span>
              <span className="pstrip__bar">
                <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, sFill))})` }} />
              </span>
            </span>
            <span className="pstrip__pace">
              {pace ? (
                <>
                  {shortCount(pace.blocks)} бл · {shortMoney(pace.coins)}
                  <CoinIcon size={10} />
                  <small>/мин</small>
                </>
              ) : (
                <small>{streak > 0 ? `${fmt(streak)} подряд` : 'бей без пауз'}</small>
              )}
            </span>
          </div>
          {anyBuff && (
            <div className="pbuffs">
              {buffs.frenzy > 0 && (
                <span className="pbuff pbuff--frenzy">✺ {sec(buffs.frenzy)}</span>
              )}
              {buffs.energy > 0 && (
                <span className="pbuff pbuff--energy">⚡ {sec(buffs.energy)}</span>
              )}
              {buffs.lens > 0 && <span className="pbuff pbuff--lens">🔍 {sec(buffs.lens)}</span>}
            </div>
          )}
          {prison.parcels.length > 0 && (
            <div className="pparcels" ref={parcelsRef}>
              {prison.parcels.map((x, i) => {
                const tier = CASE_TIERS.find((t) => t.id === x.tier)!;
                const ready = x.left <= 0;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pparcel${ready ? ' is-ready' : ''}`}
                    style={{ '--tier': tier.color } as CSSProperties}
                    aria-label={`Передачка, ${tier.name.toLowerCase()}${ready ? ', готова' : ''}`}
                    onClick={() => openParcel(i)}
                  >
                    <img src={parcelTexture(tier.color)} alt="" />
                    {!ready && (
                      <span className="pparcel__bar">
                        <i style={{ transform: `scaleX(${1 - x.left / PARCEL_NEED[x.tier]})` }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div
            className={`pmine${aiming ? ' is-aiming' : ''}${arming ? ' is-arming' : ''}`}
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
            {arming && (
              <div className="pmine__arm">
                {ITEMS.find((i) => i.id === arming)!.glyph} Куда положить? Тапни по клетке
              </div>
            )}
            {toast && (
              <div className="pmine__toast" key={toast.id}>
                {toast.text}
              </div>
            )}
            {cardShown && (
              <div className={`pfindcard${cardLeaving ? ' is-out' : ''}`}>
                <img src={findTexture(cardShown.id)} alt="" />
                <span>
                  <i>{cardShown.fresh ? 'Находка!' : `Дубликат ×${cardShown.n}`}</i>
                  <b>{findOf(cardShown.id).name}</b>
                  <em>{cardShown.fresh ? '+1% к продаже навсегда' : '+40 токенов'}</em>
                </span>
              </div>
            )}
            {shiftShown && (
              <div className={`pshift${shiftLeaving ? ' is-out' : ''}`}>
                <i>Смена · 5 минут</i>
                <b>
                  {fmt(shiftShown.blocks)} блоков · +{shortMoney(shiftShown.coins)}{' '}
                  <CoinIcon size={12} />
                </b>
                <em>
                  +{fmt(shiftShown.tokens)} ✦
                  {shiftShown.keys
                    ? ` · +${shiftShown.keys} ${shiftShown.keys > 1 ? 'ключа' : 'ключ'}`
                    : ''}
                </em>
              </div>
            )}
            {crewNote && crewNow.blocks > 0 && (
              <div className="pcrewnote">
                <span>
                  <b>Бригада накопала {fmt(crewNow.blocks)} блоков</b>
                  <i>
                    +{shortMoney(crewNow.coins)} монет · +{fmt(crewNow.tokens)} токенов
                    {crewNow.capped ? ' · смена кончилась' : ''}
                  </i>
                </span>
                <button type="button" className="btn btn--sm pmines__go" onClick={collectCrew}>
                  Забрать
                </button>
                <button
                  type="button"
                  className="pcrewnote__x"
                  aria-label="Позже"
                  onClick={() => setCrewNote(false)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="pitems">
          {ITEMS.map((it) => {
            const n = prison.items[it.id];
            return (
              <button
                key={it.id}
                type="button"
                className={`pitem${n ? '' : ' is-empty'}${arming === it.id ? ' is-armed' : ''}`}
                aria-label={`${it.name}: ${n}`}
                onClick={() => applyItem(it.id)}
              >
                <span className="pitem__glyph">{it.glyph}</span>
                <i className="pitem__n">{n || '+'}</i>
              </button>
            );
          })}
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
            ref={campRef}
            onClick={() => {
              tapLight();
              setCamp('forge');
            }}
          >
            <PickIcon pick={pick} size={28} />
            <span>Лагерь</span>
            {prison.pet && (
              <img
                ref={petRef}
                className="ppet-perch"
                src={petTexture(prison.pet)}
                alt={petOf(prison.pet).name}
                title={`${petOf(prison.pet).name}, ${petLevelOf(prison.pets[prison.pet] ?? 0).level} ур.`}
                onClick={(e) => {
                  e.stopPropagation();
                  tapLight();
                  setCamp('pets');
                }}
              />
            )}
            {prison.keys > 0 ? (
              <i className="pforge-btn__dot pforge-btn__dot--n">
                <KeyIcon size={9} />
                {prison.keys}
              </i>
            ) : (
              campBadge && <i className="pforge-btn__dot" />
            )}
          </button>
        </div>

        {/* Проводник, пока он не пройден, стоит на месте строки с ценами
            пород: высота под полем на счету, а цены есть и в листе шахт. */}
        {guide ? (
          <div className={`pguide${guideOk ? ' is-ready' : ''}`}>
            <span className="pguide__n">
              {prison.guide + 1}/{GUIDE.length}
            </span>
            <span className="pguide__body">
              <b>{guide.title}</b>
              <i>{guideOk ? `Награда: ${rewardText(guide.reward)}` : guide.hint}</i>
            </span>
            {guideOk ? (
              <button type="button" className="btn btn--sm pmines__go" onClick={claimGuide}>
                Забрать
              </button>
            ) : (
              <span className="pguide__prog">
                {guideGoal > 1 ? `${fmt(guideV)}/${fmt(guideGoal)}` : rewardText(guide.reward)}
              </span>
            )}
          </div>
        ) : (
          /* Породы этой шахты и цена блока — чтобы знать, что почём. */
          <div className="pmix" aria-label="Породы шахты">
            {mix.map((s) => (
              <span key={s.rock} className="pmix__rock">
                <img src={rockTexture(s.rock)} alt="" />
                <b>{Math.round(ROCKS[s.rock].value * m.sell)}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {camp && (
        <PrisonCamp
          tab={camp}
          onTab={setCamp}
          onClose={() => setCamp(null)}
          onGain={rollBalance}
          onSpend={settleBalance}
        />
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
                    {mineMix(id).map((s) => (
                      <img key={s.rock} src={rockTexture(s.rock)} alt={ROCKS[s.rock].name} />
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

      {sheet === 'settings' && (
        <Sheet
          title="Настройки"
          onClose={() => {
            setSheet(null);
            setWipe(null);
          }}
        >
          <div className="stack">
            <div className="pcash">
              <CashDesk />
            </div>
            <div className="pwipe">
              <b className="pwipe__title">Начать заново</b>
              <button
                type="button"
                className={`btn btn--block pwipe__btn${wipe === 'prison' ? ' is-armed' : ''}`}
                onClick={() => doWipe('prison')}
              >
                {wipe === 'prison' ? 'Точно? Нажми ещё раз' : 'Сбросить Каторгу'}
              </button>
              <p className="pwipe__text">
                Пропадут ранги, кирка, заточка, чары, руны, питомцы, токены, ключи, сундуки,
                коллекция, бригада, перки и вехи. Кошелёк и уровень останутся — они общие с
                автоматами.
              </p>
              <button
                type="button"
                className={`btn btn--block pwipe__btn${wipe === 'all' ? ' is-armed' : ''}`}
                onClick={() => doWipe('all')}
              >
                {wipe === 'all' ? 'Точно всё? Нажми ещё раз' : 'Сбросить всё в играх'}
              </button>
              <p className="pwipe__text">
                Каторга и автоматы с нуля: кошелёк вернётся к стартовой тысяче, уровень, серия
                бонусов, цели дня, рекорды и прогресс скинов — тоже. Звук, вибрация и выбранный скин
                останутся. Вернуть прогресс после сброса нельзя.
              </p>
            </div>
          </div>
        </Sheet>
      )}

      {sheet === 'norm' && !atTop && (
        <Sheet title={`Ранг ${rankLetter(rank + 1)}`} onClose={() => setSheet(null)}>
          <div className="stack">
            <p className="pnorm__lead">
              Норма выработки: одних денег мало — сдай породу. Считаются блоки, сломанные своими
              руками, в любой шахте.
            </p>
            <div className="pnorm">
              {quota.map((q) => {
                const have = Math.min(q.n, prison.norm[q.rock] ?? 0);
                const done = have >= q.n;
                return (
                  <div key={q.rock} className={`pnorm__row${done ? ' is-done' : ''}`}>
                    <img src={rockTexture(q.rock)} alt="" />
                    <span className="pnorm__info">
                      <b>{ROCKS[q.rock].name}</b>
                      <i>
                        {done
                          ? 'сдано'
                          : q.rock === rank
                            ? 'редкая порода шахты — её больше на глубине'
                            : 'ходовая порода — встречается на каждом ярусе'}
                      </i>
                      <span className="pnorm__bar">
                        <i style={{ transform: `scaleX(${have / q.n})` }} />
                      </span>
                    </span>
                    <span className="pnorm__n">{done ? '✓' : `${have}/${q.n}`}</span>
                  </div>
                );
              })}
              <div className={`pnorm__row${balance >= cost ? ' is-done' : ''}`}>
                <span className="pnorm__coin">
                  <CoinIcon size={26} />
                </span>
                <span className="pnorm__info">
                  <b>Цена ранга</b>
                  <i>{balance >= cost ? 'хватает' : `не хватает ${fmt(cost - balance)}`}</i>
                  <span className="pnorm__bar">
                    <i style={{ transform: `scaleX(${progress})` }} />
                  </span>
                </span>
                <span className="pnorm__n">{shortMoney(cost)}</span>
              </div>
            </div>
            <button
              className="btn btn--primary btn--block"
              disabled={!qDone || balance < cost}
              onClick={() => takeRank(false)}
            >
              {!qDone
                ? `Не хватает: ${quota
                    .filter((q) => (prison.norm[q.rock] ?? 0) < q.n)
                    .map(
                      (q) =>
                        `${q.n - (prison.norm[q.rock] ?? 0)} × ${ROCKS[q.rock].name.toLowerCase()}`,
                    )
                    .join(', ')}`
                : balance < cost
                  ? `Не хватает ${fmt(cost - balance)} монет`
                  : `Взять ранг за ${fmt(cost)} монет`}
            </button>
            {!qDone && (
              <>
                <button
                  className="btn btn--ghost btn--block"
                  disabled={balance < cost + buyout}
                  onClick={() => takeRank(true)}
                >
                  Откупить норму: {fmt(cost)} + {fmt(buyout)} монет
                </button>
                <p className="pnorm__note">
                  Откуп дешевеет с каждым сданным блоком: сейчас выполнено{' '}
                  {Math.round(quotaProgress(quota, prison.norm) * 100)}%. Блоки с нужной породой в
                  шахте помечены точкой.
                </p>
              </>
            )}
          </div>
        </Sheet>
      )}

      {reveal && <ParcelReveal open={reveal} onClose={() => setReveal(null)} />}

      {rewards && (
        <RewardsSheet
          skin={skin}
          onClose={() => {
            setRewards(false);
            setRewardsNow(Date.now());
          }}
        />
      )}

      {sheet === 'prestige' && (
        <Sheet title={`Престиж ${prestige + 1}`} onClose={() => setSheet(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              Ранг и шахта вернутся на {rankLetter(Math.min(LAST_RANK - 1, prison.perks.blat))}.
              Кирка, чары, токены, рюкзак, вагонетка, бригада и коллекция останутся. Продажа станет
              дороже: ×{sellMult(prestige + 1).toFixed(2)} вместо ×{sellMult(prestige).toFixed(2)},
              ранги на новом круге — на треть. За престиж — два очка перков и пять ключей.
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
            <span className="prank__key">
              <KeyIcon size={13} /> +1 ключ от сундука
            </span>
            {sceneShown.buyout > 0 && (
              <span className="prank__lvl">Норма откуплена за {fmt(sceneShown.buyout)} монет</span>
            )}
            {sceneShown.rank < LAST_RANK && (
              <span className="prank__norm">
                Норма на {rankLetter(sceneShown.rank + 1)}:
                <QuotaChips quota={rankQuota(sceneShown.rank, prestige)} norm={{}} />
              </span>
            )}
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

/** Перерисовка раз в секунду, пока `on` — для таймеров баффов. */
function useTicker(on: boolean): void {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}
