import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GxBar, GxIcon, GxModal, KIcon } from '@/components/gx';
import { RewardsSheet, useReadyRewards } from '@/components/RewardsSheet';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon } from '@/components/slot-art';
import { AxeIcon, KeyIcon, ParcelReveal, PrisonCamp, TokenIcon } from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { EventAnnounce, EventPill, endText, prizeSay, useYardEvent } from '@/components/YardBits';
import { useFinanceStore } from '@/store';
import type { ForestCut, ParcelOpen } from '@/store';
import {
  AXE_CRIT_CHANCE,
  AXE_CRIT_MULT,
  AXES,
  axeDamage,
  BRANCH_STUN_MS,
  buildTree,
  FOREST_UNLOCK_RANK,
  forestMods,
  forestPlan,
  forestRankCost,
  LAST_PLOT,
  logHp,
  millQueueCap,
  millTick,
  pileCapacity,
  planBuyout,
  SPECIES,
  standHit,
  sumRow,
  toM3,
} from '@/lib/forest';
import type { Side, Tree } from '@/lib/forest';
import {
  CASE_TIERS,
  decayStreak,
  PARCEL_NEED,
  perkPointsFree,
  petLevelOf,
  petOf,
  rankLetter,
  shortMoney,
  STREAK_DECAY_MS,
  STREAK_GRACE_MS,
  STREAK_TIERS,
  streakTier,
} from '@/lib/prison';
import type { YardEvent } from '@/lib/prison';
import {
  barkTexture,
  bearTexture,
  branchTexture,
  crackTexture,
  crownTexture,
  logMarkTexture,
  parcelTexture,
  petTexture,
} from '@/lib/prison-art';
import { createFx } from '@/lib/prison-fx';
import type { Fx } from '@/lib/prison-fx';
import { plainPlan, runRollup } from '@/lib/rollup';
import { addTrauma, flashFrame, squashPop, stopShake } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { useExit } from '@/lib/use-exit';
import { playTotem } from '@/lib/totem';
import {
  axeChop,
  bagFull as pileFullSound,
  branchHit,
  coinDing,
  keyFound,
  logOff,
  payoutEnd,
  primeAudio,
  rollupTick,
  setMuted,
  tierBreak,
  treeFall,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, setHapticsMuted, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const shortCount = (n: number) =>
  n < 1e4
    ? fmt(n)
    : n < 1e6
      ? `${(Math.floor(n / 100) / 10).toLocaleString('ru-RU')}к`
      : `${(Math.floor(n / 1e5) / 10).toLocaleString('ru-RU')}м`;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Предупреждение, что запал гаснет, — как в шахте. */
const STREAK_WARN_MS = 1500;
/**
 * Тапать можно быстрее удержания во столько раз. Тап раньше срока НЕ
 * выбрасывается, а ждёт своей очереди (`pendingTap`): выброшенный тап на
 * ритмичной рубке читается как «не сработало».
 */
const TAP_BOOST = 2.4;

/** Сколько брёвен рисуем над нижним: ровно столько, сколько влезает. */
const LOG_ASPECT = 0.46;

type Sheetname = 'plan' | null;

/**
 * Лесоповал. Шахта — «держи и веди» сверху; здесь — «ритм и реакция» сбоку.
 * Одно дерево на весь экран, ствол из брёвен, сучья то слева, то справа.
 * Тап по стороне рубит нижнее бревно с неё. Урон по бревну живёт в
 * странице (как урон по блоку в шахте): в стор уходит только срубленное.
 */
export function ForestPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const forest = useFinanceStore((s) => s.forest);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const sound = useFinanceStore((s) => s.slotsSound);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const forestCut = useFinanceStore((s) => s.forestCut);
  const forestSell = useFinanceStore((s) => s.forestSell);
  const forestRankUp = useFinanceStore((s) => s.forestRankUp);
  const prisonStreak = useFinanceStore((s) => s.prisonStreak);
  const prisonParcelOpen = useFinanceStore((s) => s.prisonParcelOpen);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  const tree = useMemo(
    () => buildTree(forest.rank, forest.tree.seed),
    [forest.rank, forest.tree.seed],
  );
  const cut = forest.tree.cut;
  const species = SPECIES[tree.species];

  const [side, setSide] = useState<Side>('L');
  const [crack, setCrack] = useState(0);
  const [stunned, setStunned] = useState(false);
  const [camp, setCamp] = useState<CampTab | null>(null);
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [rewards, setRewards] = useState(false);
  const [reveal, setReveal] = useState<ParcelOpen | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [rankScene, setRankScene] = useState<{ rank: number; buyout: number } | null>(null);
  const [sceneShown, sceneLeaving] = useExit(rankScene, 260);
  const [size, setSize] = useState({ w: 360, h: 420 });
  const [streak, setStreak] = useState(0);
  const [cooling, setCooling] = useState(false);
  const [rewardsNow, setRewardsNow] = useState(() => Date.now());
  const readyRewards = useReadyRewards(rewardsNow);

  const sceneRef = useRef<HTMLDivElement>(null);
  const trunkRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const axeRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pileRef = useRef<HTMLButtonElement>(null);
  const millRef = useRef<HTMLButtonElement>(null);
  const bearRef = useRef<HTMLDivElement>(null);
  const campRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const parcelsRef = useRef<HTMLDivElement>(null);
  const moneyRef = useRef<MoneyHandle>(null);
  const fx = useRef<Fx | null>(null);
  const hp = useRef(-1);
  const sideRef = useRef<Side>('L');
  const stunUntil = useRef(0);
  const lastHit = useRef(0);
  const pendingTap = useRef<{ side: Side; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pointer = useRef<{ id: number; side: Side } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolling = useRef<(() => void) | null>(null);
  const toastSeq = useRef(0);
  const streakBase = useRef({ n: 0, at: 0 });
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCut = useRef(cut);
  const fullWarnAt = useRef(0);

  // Баланс на табло: во время счёта продажи его ведёт ролл-ап, а не стор.
  const [shownBalance, setShownBalance] = useState(balance);
  useEffect(() => {
    if (!rolling.current) setShownBalance(balance);
  }, [balance]);

  useEffect(() => {
    const id = setInterval(() => setRewardsNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Размер сцены — от него размер бревна: дерево обязано влезать по ширине.
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hydrated]);

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
      if (streakTimer.current) clearTimeout(streakTimer.current);
      if (pendingTap.current) clearTimeout(pendingTap.current.timer);
      rolling.current?.();
      stopShake();
    },
    [],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stopHold();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1700);
    return () => clearTimeout(t);
  }, [toast]);

  const say = useCallback((text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text });
  }, []);

  // ---- Двор: события на делянке ------------------------------------------
  const [yardSplash, setYardSplash] = useState<YardEvent | null>(null);
  const closeSplash = useCallback(() => setYardSplash(null), []);
  const { ev: yardEv, now: yardNow } = useYardEvent('forest', (end) => {
    const t = endText(end);
    if (!t) return;
    say(t);
    if (end.lost > 0) {
      branchHit();
      notifyWarning();
      addTrauma(sceneRef.current, 0.4);
      squashPop(pileRef.current, 0.6);
    }
  });

  const logW = Math.round(Math.min(size.w * 0.3, 150));
  const logH = Math.round(logW * LOG_ASPECT);
  const ground = Math.round(size.h * 0.14);
  const trunkLeft = Math.round((size.w - logW) / 2);
  const visible = Math.max(3, Math.ceil((size.h - ground) / logH) + 1);

  // Бревно срублено — ствол оседает на одно бревно: падение с ускорением,
  // без перелёта. Новое дерево въезжает сбоку.
  useLayoutEffect(() => {
    const was = prevCut.current;
    prevCut.current = cut;
    if (reduceMotion()) return;
    if (cut > was && trunkRef.current) {
      // Замах снимает два бревна — ствол оседает на два, чуть дольше.
      const d = cut - was;
      try {
        trunkRef.current.animate(
          [{ transform: `translateY(${-logH * d}px)` }, { transform: 'translateY(0)' }],
          { duration: 120 * Math.sqrt(d), easing: 'cubic-bezier(.5,0,1,1)' },
        );
      } catch {
        /* без WAAPI просто встанет */
      }
    } else if (cut === 0 && was > 0 && treeRef.current) {
      // Новое дерево въезжает сразу и быстро: рубить его можно с первого
      // кадра. Раньше оно 0,37 с стояло невидимым и ещё 0,45 с ехало — это
      // читалось как «тап не сработал».
      try {
        treeRef.current.animate(
          [
            { transform: 'translateX(45%)', opacity: 0.2 },
            { transform: 'translateX(0)', opacity: 1 },
          ],
          { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' },
        );
      } catch {
        /* не страшно */
      }
    }
  }, [cut, logH]);

  // ---- Запал: те же ступени, что в шахте ---------------------------------

  const streakNow = () => {
    const b = streakBase.current;
    return decayStreak(b.n, Date.now() - b.at);
  };

  const armDecay = () => {
    if (streakTimer.current) clearTimeout(streakTimer.current);
    streakTimer.current = null;
    const b = streakBase.current;
    if (b.n <= 0) return;
    const idle = Date.now() - b.at;
    const wake =
      idle < STREAK_WARN_MS
        ? STREAK_WARN_MS
        : idle <= STREAK_GRACE_MS
          ? STREAK_GRACE_MS + 1
          : STREAK_GRACE_MS +
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

  const bumpStreak = () => {
    const now = Date.now();
    const n0 = decayStreak(streakBase.current.n, now - streakBase.current.at);
    const n = n0 + 1;
    streakBase.current = { n, at: now };
    setStreak(n);
    setCooling(false);
    const t0 = streakTier(n0);
    const t1 = streakTier(n);
    if (t1 > t0) {
      prisonStreak(t1);
      floatAt(
        size.w / 2,
        size.h * 0.3,
        `${STREAK_TIERS[t1].name.toUpperCase()}!`,
        'pfloat--streak',
      );
      tierBreak(Math.min(3, t1));
      tapMedium();
      squashPop(stripRef.current, 0.35 + 0.1 * t1);
    }
    armDecay();
  };

  /** Сучок сбрасывает запал целиком: ритм сломан — начинай заново. */
  const breakStreak = () => {
    if (streakTimer.current) clearTimeout(streakTimer.current);
    streakBase.current = { n: 0, at: 0 };
    setStreak(0);
    setCooling(false);
  };

  // ---- Эффекты -------------------------------------------------------------

  const rollBalance = useCallback((from: number, to: number) => {
    rolling.current?.();
    if (to - from <= 0) {
      setShownBalance(to);
      return;
    }
    const ms = Math.min(1800, 380 + 70 * Math.pow(to - from, 0.3));
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

  function floatAt(x: number, y: number, text: string, cls: string, delay = 0) {
    const layer = layerRef.current;
    if (!layer || reduceMotion()) return;
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
        { duration: 820, delay, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1500 + delay);
  }

  /** Точка у нижнего бревна со стороны топора. */
  const bottomAt = (s: Side) => ({
    x: s === 'L' ? trunkLeft + logW * 0.15 : trunkLeft + logW * 0.85,
    y: size.h - ground - logH / 2,
  });

  const swing = (s: Side, crit: boolean) => {
    const el = axeRef.current;
    if (!el || reduceMotion()) return;
    const k = s === 'L' ? 1 : -1;
    try {
      el.animate(
        [
          { transform: `scaleX(${k}) rotate(-42deg)` },
          { transform: `scaleX(${k}) rotate(${crit ? 18 : 10}deg)`, offset: 0.45 },
          { transform: `scaleX(${k}) rotate(0deg)` },
        ],
        { duration: 170, easing: 'cubic-bezier(.5,0,.3,1)' },
      );
    } catch {
      /* стоит */
    }
  };

  /** Срубленное бревно улетает в штабель дугой, крутясь. */
  const flyLog = (t: Tree, s: Side, delay = 0) => {
    const layer = layerRef.current;
    const scene = sceneRef.current;
    const pile = pileRef.current;
    if (!layer || !scene || reduceMotion()) {
      squashPop(pile, 0.25);
      return;
    }
    const el = document.createElement('i');
    el.className = 'flog-fly';
    el.style.width = `${logW}px`;
    el.style.height = `${logH}px`;
    el.style.left = `${trunkLeft}px`;
    el.style.top = `${size.h - ground - logH}px`;
    el.style.backgroundImage = `url(${barkTexture(t.species)})`;
    layer.appendChild(el);
    const sr = scene.getBoundingClientRect();
    const pr = pile?.getBoundingClientRect();
    const tx = pr ? pr.left + 24 - sr.left - trunkLeft - logW / 2 : s === 'L' ? size.w : -size.w;
    const ty = pr ? pr.top + pr.height / 2 - sr.top - (size.h - ground - logH / 2) : 80;
    // Летит в сторону от топора, потом вниз в штабель.
    const away = (s === 'L' ? 1 : -1) * logW * 0.9;
    const done = () => el.remove();
    try {
      const a = el.animate(
        [
          { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
          {
            transform: `translate(${away}px, ${-logH * 1.4}px) rotate(${s === 'L' ? 70 : -70}deg) scale(.8)`,
            opacity: 1,
            offset: 0.35,
          },
          {
            transform: `translate(${tx}px, ${ty}px) rotate(${s === 'L' ? 200 : -200}deg) scale(.3)`,
            opacity: 0.85,
          },
        ],
        { duration: 560, delay, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'backwards' },
      );
      a.onfinish = () => {
        done();
        squashPop(pile, 0.22);
      };
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1100 + delay);
  };

  /** «Бойся!»: крона валится в сторону от топора, снег из неё — облаком. */
  const fellScene = (t: Tree, s: Side, label = 'БОЙСЯ!', cls = 'pfloat--fell') => {
    treeFall();
    addTrauma(sceneRef.current, 0.5);
    flashFrame('small');
    notifySuccess();
    floatAt(size.w / 2, size.h * 0.34, label, cls);
    const layer = layerRef.current;
    if (!layer || reduceMotion()) return;
    const cw = logW * 2.4;
    const ch = cw;
    const el = document.createElement('img');
    el.className = 'fcrown-fall';
    el.src = crownTexture(t.species, t.seid);
    el.alt = '';
    el.style.width = `${cw}px`;
    el.style.height = `${ch}px`;
    el.style.left = `${size.w / 2 - cw / 2}px`;
    el.style.top = `${size.h - ground - ch * 0.92}px`;
    layer.appendChild(el);
    const dir = s === 'L' ? 1 : -1;
    const done = () => {
      el.remove();
    };
    try {
      const a = el.animate(
        [
          { transform: 'rotate(0deg)', opacity: 1 },
          { transform: `rotate(${dir * 18}deg)`, opacity: 1, offset: 0.3 },
          {
            transform: `translate(${dir * cw * 0.35}px, ${ch * 0.18}px) rotate(${dir * 88}deg)`,
            opacity: 1,
            offset: 0.72,
          },
          {
            transform: `translate(${dir * cw * 0.4}px, ${ch * 0.25}px) rotate(${dir * 92}deg)`,
            opacity: 0,
          },
        ],
        { duration: 900, easing: 'cubic-bezier(.55,0,.8,.6)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(() => {
      fx.current?.puff(size.w / 2 + dir * cw * 0.5, size.h - ground, 'rgba(236,242,248,1)', 16);
      fx.current?.chips(
        size.w / 2 + dir * cw * 0.45,
        size.h - ground - 10,
        ['#ffffff', '#dfe8f0', species.leaf],
        22,
        1.4,
      );
    }, 620);
    setTimeout(done, 1400);
  };

  /** Сучок по лбу: оглушение, запал — в ноль. */
  const strike = (s: Side) => {
    const now = performance.now();
    stunUntil.current = now + BRANCH_STUN_MS;
    if (pendingTap.current) {
      clearTimeout(pendingTap.current.timer);
      pendingTap.current = null;
    }
    setStunned(true);
    setTimeout(() => setStunned(false), BRANCH_STUN_MS);
    breakStreak();
    branchHit();
    notifyWarning();
    addTrauma(sceneRef.current, 0.32);
    const { x, y } = bottomAt(s);
    floatAt(x, y - logH, 'СУЧОК!', 'pfloat--branch');
    fx.current?.chips(x, y, [species.leaf, species.dark, '#ffffff'], 10, 1.1);
  };

  /** Чутьё: сучок пролетел мимо. */
  const dodge = (s: Side) => {
    const { x, y } = bottomAt(s);
    floatAt(x, y - logH, 'УВЕРНУЛСЯ', 'pfloat--dodge');
    tapLight();
    const el = axeRef.current;
    if (!el || reduceMotion()) return;
    try {
      el.animate(
        [
          { translate: '0 0' },
          { translate: `${s === 'L' ? -10 : 10}px 4px`, offset: 0.4 },
          { translate: '0 0' },
        ],
        { duration: 260, easing: 'cubic-bezier(.3,.7,.3,1)' },
      );
    } catch {
      /* стоит */
    }
  };

  /** Что двор сказал по итогам рубки: событие началось, выполнено, ушло. */
  const yardLoot = (res: ForestCut) => {
    if (res.eventEnded) {
      const t = endText(res.eventEnded);
      if (t) say(t);
      if (res.eventEnded.lost > 0) squashPop(pileRef.current, 0.6);
    }
    const x = res.eventDone;
    if (x) {
      if (x.id === 'bear') bearFlee();
      tierBreak(3);
      notifySuccess();
      burstConfetti(50, ['#ffe08a', '#c88a52', '#fff']);
      floatAt(size.w / 2, size.h * 0.3, x.id === 'bear' ? 'ОТОГНАЛ!' : 'ГОТОВО', 'pfloat--fellx');
      if (x.keys) {
        keyFound();
        playTotem(campRef.current, () => squashPop(campRef.current, 0.6));
      }
      say(prizeSay(x));
    }
    if (res.eventStarted) {
      setYardSplash(res.eventStarted);
      tierBreak(2);
      notifyWarning();
      if (res.eventStarted.id === 'blizzard') addTrauma(sceneRef.current, 0.3);
    }
  };

  /** Медведь удирает туда, откуда пришёл, — отдельным слоем: события уже нет. */
  const bearFlee = () => {
    const layer = layerRef.current;
    const from = bearRef.current;
    if (!layer || !from || reduceMotion()) return;
    const el = document.createElement('img');
    el.className = 'fbear-flee';
    el.src = bearTexture();
    el.alt = '';
    el.style.left = from.style.left;
    el.style.width = `${from.offsetWidth}px`;
    el.style.height = `${from.offsetHeight}px`;
    el.style.bottom = `${ground - 8}px`;
    layer.appendChild(el);
    const done = () => el.remove();
    try {
      const a = el.animate(
        [
          { transform: 'translateX(0) translateY(0)' },
          { transform: 'translateX(20px) translateY(-10px)', offset: 0.15 },
          { transform: `translateX(${size.w}px) translateY(0)` },
        ],
        { duration: 900, easing: 'cubic-bezier(.4,0,.8,.6)' },
      );
      a.onfinish = done;
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1400);
  };

  const announce = (res: ForestCut, s: Side) => {
    const { x, y } = bottomAt(s);
    // Замах и валка снимают несколько брёвен: показываем самое ценное.
    const kinds = res.tree.logs.slice(res.index, res.index + res.take).map((l) => l.kind);
    if (kinds.includes('burl')) {
      floatAt(x, y - 20, 'КАПОКОРЕНЬ ×10', 'pfloat--burl');
      tierBreak(2);
      burstConfetti(40, ['#c88a52', '#ffe08a', '#fff']);
    } else if (kinds.includes('figured')) floatAt(x, y - 20, 'СВИЛЬ ×3', 'pfloat--figured');
    const h = res.chop.hollow;
    if (h) {
      tierBreak(1);
      const hTokens = res.hollows.reduce((a, z) => a + (z.kind === 'tokens' ? z.amount : 0), 0);
      if (hTokens) floatAt(x, y - 34, `ДУПЛО: +${hTokens} ✦`, 'pfloat--token', 120);
      else if (h.kind === 'parcel') floatAt(x, y - 34, 'ДУПЛО: ПЕРЕДАЧКА', 'pfloat--parcel', 120);
    }
    const tokens = res.chop.tokens + res.chop.chaga;
    if (res.chop.chaga) floatAt(x, y - 46, `ЧАГА +${res.chop.chaga} ✦`, 'pfloat--token', 200);
    else if (tokens) floatAt(x, y - 46, `+${tokens} ✦`, 'pfloat--token', 200);
    const keys =
      res.chop.keys + res.hollows.reduce((a, z) => a + (z.kind === 'keys' ? z.amount : 0), 0);
    if (keys) {
      keyFound();
      notifySuccess();
      const played = playTotem(campRef.current, () => {
        squashPop(campRef.current, 0.6);
        coinDing();
      });
      if (!played) floatAt(x, y - 60, keys > 1 ? `+${keys} ключа` : '+ключ', 'pfloat--key', 120);
    }
    if (res.parcels.length) {
      squashPop(parcelsRef.current, 0.5);
      if (!h || h.kind !== 'parcel') floatAt(x, y - 60, 'ПЕРЕДАЧКА', 'pfloat--parcel', 160);
    }
    if (res.parcelsReady) say('Посылка дозрела — вскрой её');
    if (res.petUp) {
      const st = useFinanceStore.getState().prison;
      if (st.pet) say(`${petOf(st.pet).name}: ${res.petUp} уровень`);
      tierBreak(1);
    }
    const seidTokens = (res.felled?.tokens ?? 0) + (res.storm?.tokens ?? 0);
    if (seidTokens) {
      floatAt(size.w / 2, size.h * 0.24, `СЕЙД-СОСНА +${seidTokens} ✦`, 'pfloat--seid', 300);
      burstConfetti(60, ['#3fe6d0', '#c8fff6', '#ffe08a']);
      tierBreak(3);
    }
    if (res.planDone) {
      tierBreak(2);
      notifySuccess();
      burstConfetti(40, ['#9be38a', '#ffe08a', '#fff']);
      say('План сдан — бери разряд');
    }
    if (res.sold) {
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - res.sold, to);
      coinDing();
      floatAt(x, y - 70, `+${shortMoney(res.sold)}`, 'pfloat--coin');
    }
    if (res.toMill) {
      floatAt(x, y - 84, `${res.toMill} → НА ПИЛОРАМУ`, 'pfloat--mill', 80);
      squashPop(millRef.current, 0.45);
    }
    const now = performance.now();
    if (res.lost > 0 && now - fullWarnAt.current > 1500) {
      fullWarnAt.current = now;
      pileFullSound();
      notifyWarning();
      say('Штабель полон — сдай лес');
      squashPop(pileRef.current, 0.5);
    }
  };

  // ---- Удар ------------------------------------------------------------------

  /**
   * Топор на сторону — сразу, в этом же кадре, а не после перерисовки React:
   * иначе замах играл бы кадр-другой на старом месте.
   */
  const placeAxe = (s: Side) => {
    if (sideRef.current === s) return;
    sideRef.current = s;
    const el = axeRef.current;
    if (el) {
      el.style.left = `${s === 'L' ? trunkLeft - logW * 0.72 : trunkLeft + logW * 1.02}px`;
      el.classList.toggle('is-L', s === 'L');
      el.classList.toggle('is-R', s === 'R');
    }
    setSide(s);
  };

  const hit = (s: Side) => {
    const now = performance.now();
    // Оглушение — единственное, что глушит тапы. Падающая крона больше не
    // глушит: она живёт своим слоем, а новое дерево уже стоит.
    if (now < stunUntil.current) return;
    const st = useFinanceStore.getState();
    const f = st.forest;
    if (st.prison.rank < FOREST_UNLOCK_RANK) return;
    const fm = forestMods(st.prison, f);
    const rate = AXES[f.axe].rate * fm.rate;
    const wait = 1000 / (rate * TAP_BOOST) - (now - lastHit.current);
    if (wait > 4) {
      // Рано: топор ещё не вернулся. Встаём на сторону сразу, а удар — в
      // очередь; второй ранний тап только меняет сторону у ждущего.
      placeAxe(s);
      if (pendingTap.current) pendingTap.current.side = s;
      else
        pendingTap.current = {
          side: s,
          timer: setTimeout(() => {
            const q = pendingTap.current;
            pendingTap.current = null;
            if (q) hitRef.current(q.side);
          }, wait),
        };
      return;
    }
    lastHit.current = now;
    placeAxe(s);
    const t = buildTree(f.rank, f.tree.seed);
    const i = f.tree.cut;
    // Встал туда, где у нижнего бревна сучок, — сам на него и налетел.
    // Чутьё иногда уводит голову: не оглушён, но и не срубил.
    if (standHit(t, i, s)) {
      if (Math.random() < fm.dodge) {
        dodge(s);
        return;
      }
      strike(s);
      return;
    }
    const crit = Math.random() < AXE_CRIT_CHANCE;
    swing(s, crit);
    const dmg = axeDamage(f.axe, f.sharp) * fm.dmg * (crit ? AXE_CRIT_MULT : 1);
    const max = logHp(t, i);
    const left = (hp.current < 0 ? max : hp.current) - dmg;
    const { x, y } = bottomAt(s);
    const woodColors = [SPECIES[t.species].wood, SPECIES[t.species].bark, SPECIES[t.species].light];
    if (crit) {
      floatAt(x, y - 24, 'КРИТ', 'pfloat--crit');
      addTrauma(sceneRef.current, 0.14);
      tapMedium();
    }
    if (left > 1e-6) {
      hp.current = left;
      setCrack(Math.min(3, 1 + Math.floor((1 - left / max) * 3)));
      axeChop(AXES[f.axe].saw, crit);
      if (!crit) tapLight();
      fx.current?.chips(x, y, woodColors, crit ? 10 : 4, crit ? 1.3 : 0.8);
      const bottom = trunkRef.current?.firstElementChild as HTMLElement | null;
      if (bottom && !reduceMotion()) {
        try {
          bottom.animate(
            [
              { transform: 'translateX(0)' },
              { transform: `translateX(${s === 'L' ? 3 : -3}px)`, offset: 0.35 },
              { transform: 'translateX(0)' },
            ],
            { duration: 110 },
          );
        } catch {
          /* не страшно */
        }
      }
      return;
    }
    // Бревно срублено.
    hp.current = -1;
    setCrack(0);
    axeChop(AXES[f.axe].saw, crit);
    logOff();
    fx.current?.chips(x, y, woodColors, crit ? 18 : 12, crit ? 1.5 : 1.15);
    const res = forestCut(s, streakNow());
    const flying = Math.min(3, res.take);
    for (let k = 0; k < flying; k++) flyLog(res.tree, s, k * 90);
    bumpStreak();
    announce(res, s);
    yardLoot(res);
    if (res.how === 'swing') {
      floatAt(size.w / 2, y - logH * 1.6, 'ЗАМАХ ×2', 'pfloat--swing');
      addTrauma(sceneRef.current, 0.18);
      tapMedium();
    }
    if (res.felled) {
      if (res.how === 'fell') {
        tierBreak(2);
        fellScene(res.tree, s, 'ВАЛКА!', 'pfloat--fellx');
      } else fellScene(res.tree, s);
    } else if (res.hit) strike(s);
    else if (res.dodged) dodge(s);
    if (res.storm) {
      const t2 = res.storm.tree;
      setTimeout(() => {
        tierBreak(3);
        burstConfetti(50, ['#bfe4ff', '#ffffff', SPECIES[t2.species].leaf]);
        fellScene(t2, s === 'L' ? 'R' : 'L', 'БУРЕЛОМ!', 'pfloat--storm');
        say(`Бурелом: ещё ${res.storm!.logs} брёвен ${SPECIES[t2.species].gen}`);
      }, 700);
    }
  };
  const hitRef = useRef(hit);
  hitRef.current = hit;

  // ---- Пальцы: левая половина — рубить слева, правая — справа -----------

  function stopHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    pointer.current = null;
  }

  const sideOf = (e: ReactPointerEvent<HTMLDivElement>): Side => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX - r.left < r.width / 2 ? 'L' : 'R';
  };

  const holdTick = () => {
    const p = pointer.current;
    if (!p) return;
    hitRef.current(p.side);
    const st = useFinanceStore.getState();
    const rate = AXES[st.forest.axe].rate * forestMods(st.prison, st.forest).rate;
    holdTimer.current = setTimeout(holdTick, 1000 / rate);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button')) return;
    primeAudio();
    const s = sideOf(e);
    if (pointer.current) {
      hit(s);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата тоже работает */
    }
    pointer.current = { id: e.pointerId, side: s };
    hit(s);
    const st = useFinanceStore.getState();
    const rate = AXES[st.forest.axe].rate * forestMods(st.prison, st.forest).rate;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(holdTick, 1000 / rate);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const s = sideOf(e);
    if (s === p.side) return;
    // Перевёл палец на другую сторону — перешёл и сразу рубишь оттуда.
    p.side = s;
    hit(s);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === e.pointerId) stopHold();
  };

  // ---- Деньги: сдать штабель, разряд, посылки ------------------------

  const sell = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const value = forestSell();
    if (!value) {
      notifyWarning();
      say('Штабель пуст — руби');
      return;
    }
    rollBalance(from, from + value);
    coinDing();
    coinDing(0.08);
    notifySuccess();
    squashPop(pileRef.current, 0.6);
    const cost = forestRankCost(Math.min(forest.rank, LAST_PLOT - 1));
    if (value >= cost * 0.3) {
      rainCoins(Math.min(30, 8 + Math.round((value / cost) * 20)));
      setTimeout(() => payoutEnd(1), 300);
    }
  };

  /**
   * Пилорама — открыть её сцену. Раньше кнопка молча перекладывала штабель
   * в очередь, и было непонятно, что куда ушло; теперь штабель грузят там,
   * где видно ленту, пилу и доски.
   */
  const toMill = () => {
    primeAudio();
    tapLight();
    setCamp('mill');
  };

  const takeRank = (buyout: boolean) => {
    const res = forestRankUp(buyout);
    if (!res) {
      notifyWarning();
      return;
    }
    setSheet(null);
    settleBalance();
    tierBreak(3);
    notifySuccess();
    burstConfetti(80, ['#8fb85a', '#ffe08a', '#fff']);
    hp.current = -1;
    setCrack(0);
    setRankScene({ rank: res.rank, buyout: res.buyout });
  };

  const rankUp = () => {
    primeAudio();
    if (forest.rank >= LAST_PLOT) return;
    const st = useFinanceStore.getState();
    if (
      st.forest.plan < forestPlan(st.forest.rank) ||
      st.slotsBalance < forestRankCost(st.forest.rank)
    ) {
      tapLight();
      setSheet('plan');
      return;
    }
    takeRank(false);
  };

  const openParcel = (i: number) => {
    primeAudio();
    const x = useFinanceStore.getState().prison.parcels[i];
    if (!x) return;
    if (x.left > 0) {
      tapLight();
      say(`Вскроется через ${fmt(x.left)} брёвен или блоков`);
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

  // ---- Разметка -------------------------------------------------------------

  if (!hydrated) {
    return (
      <div className="gx pmx fmx">
        <div className="forest-scene-bg" aria-hidden="true" />
      </div>
    );
  }

  const locked = prison.rank < FOREST_UNLOCK_RANK;
  const atTop = forest.rank >= LAST_PLOT;
  const cost = atTop ? 0 : forestRankCost(forest.rank);
  const need = forestPlan(forest.rank);
  const planHave = Math.min(need, forest.plan);
  const planOk = planHave >= need;
  const progress = atTop ? 1 : Math.max(0, Math.min(1, balance / cost));
  const ready = !atTop && planOk && progress >= 1;
  const buyout = atTop ? 0 : planBuyout(forest.rank, forest.plan);
  const cap = pileCapacity(forest.pileLevel);
  const pileFull = forest.pile.n >= cap;
  const pileValue = Math.round(forest.pile.value * forestMods(prison, forest).sell);
  const mill = millTick(forest.mill, Date.now());
  const millQueued = sumRow(mill.queue);
  const millBoards = sumRow(mill.boards);
  const sense = forest.ench.sense > 0;
  const campBadge = perkPointsFree(prison) > 0;
  const sTier = streakTier(streak);
  const sNext = STREAK_TIERS[sTier + 1];
  const sFrom = sTier >= 0 ? STREAK_TIERS[sTier].at : 0;
  const sFill = sNext ? (streak - sFrom) / (sNext.at - sFrom) : 1;
  const plotSpecies = SPECIES[forest.rank];
  const logs = tree.logs.slice(cut, cut + visible);
  const crownBottom = (tree.logs.length - cut) * logH;
  const crownW = logW * 2.4;

  const toMine = () => {
    tapLight();
    nav('/prison');
  };
  const rankFill = atTop ? 1 : Math.min(progress, planHave / need);

  return (
    <div className="gx pmx fmx">
      <div className="forest-scene-bg" aria-hidden="true" />
      {locked ? (
        <div className="prison forest">
          <div className="pmx-top">
            <button
              type="button"
              className="gx-round gx-round--dark pmx-top__btn"
              aria-label="Назад"
              onClick={() => {
                tapLight();
                nav(-1);
              }}
            >
              <KIcon name="arrowLeft" />
            </button>
            <div className="gx-ribbon pmx-top__title">Лес</div>
            <span className="pmx-top__btn" />
          </div>
          <div className="gx-panel gx-panel--wood-fancy fmx-lock">
            <span className="fmx-lock__ico">
              <GxIcon name="forest" size={54} />
              <KIcon name="locked" size={24} />
            </span>
            <b>Откроется с ранга {rankLetter(FOREST_UNLOCK_RANK)}</b>
            <button type="button" className="gx-btn gx-btn--red gx-btn--block" onClick={toMine}>
              <GxIcon name="pick" size={18} /> В шахту
            </button>
          </div>
        </div>
      ) : (
        <div className="prison forest">
          <div className="pmx-top">
            <button
              type="button"
              className="gx-round gx-round--dark pmx-top__btn"
              aria-label="Назад"
              onClick={() => {
                tapLight();
                nav(-1);
              }}
            >
              <KIcon name="arrowLeft" />
            </button>
            <div className="gx-ribbon pmx-top__title">Лес · {plotSpecies.name.toLowerCase()}</div>
            <button
              type="button"
              className="gx-round gx-round--dark pmx-top__btn"
              aria-label="Награды дня"
              onClick={() => {
                tapLight();
                setRewards(true);
              }}
            >
              <GxIcon name="gift" />
              {readyRewards > 0 && <i className="gx-badge">{readyRewards}</i>}
            </button>
          </div>

          <div className="pmx-chips">
            <span className="gx-chip pmx-chip--coins">
              <CoinIcon size={18} />
              <MoneyCounter ref={moneyRef} value={shownBalance} />
            </span>
            <button
              type="button"
              className="gx-chip pmx-chip--btn"
              aria-label="Токены — чары топора"
              onClick={() => {
                tapLight();
                setCamp('axench');
              }}
            >
              <TokenIcon size={17} /> {shortCount(prison.tokens)}
            </button>
            <span className="pmx-chips__gap" />
            <button type="button" className="gx-chip pmx-chip--btn" onClick={toMine}>
              <GxIcon name="pick" /> Шахта
            </button>
          </div>

          <button
            type="button"
            className={`gx-panel gx-panel--wood pmx-rank${ready ? ' is-ready' : ''}`}
            onClick={rankUp}
            aria-label={atTop ? 'Высший разряд' : `Разряд ${forest.rank + 2}`}
          >
            <span className="gx-hex pmx-rank__hex">{forest.rank + 1}</span>
            <span className="pmx-rank__mid">
              <GxBar
                value={rankFill}
                tone="gold"
                label={
                  atTop ? (
                    'Высший разряд'
                  ) : ready ? (
                    'Новый разряд — жми!'
                  ) : (
                    <span className={`pmx-rank__cost${progress >= 1 ? ' is-ok' : ''}`}>
                      {shortMoney(cost)} <CoinIcon size={12} />
                    </span>
                  )
                }
              />
              {!atTop && !ready && (
                <span className="pquota">
                  <span className={`pquota__chip${planOk ? ' is-done' : ''}`}>
                    <img src={barkTexture(forest.rank)} alt={plotSpecies.name} />
                    {planOk ? '✓' : `${toM3(planHave)}/${toM3(need)} м³`}
                  </span>
                </span>
              )}
            </span>
            <span className="gx-hex gx-hex--dark pmx-rank__hex">
              {atTop ? <KIcon name="star" size={16} /> : forest.rank + 2}
            </span>
          </button>

          <div className="fframe">
            <div
              className={`pstrip${sTier >= 0 ? ` is-t${sTier}` : ''}${cooling ? ' is-cooling' : ''}`}
              ref={stripRef}
            >
              <span className="pstrip__pick" title="Топор">
                <b>
                  <AxeIcon axe={forest.axe} size={13} />
                  {forest.felled}
                </b>
              </span>
              <span className="pstrip__streak">
                <span className="pstrip__name">
                  <GxIcon name="flame" size={13} />
                  {sTier >= 0 && STREAK_TIERS[sTier].name}
                  {sTier >= 0 && <em>+{Math.round(STREAK_TIERS[sTier].loot * 100)}%</em>}
                </span>
                <span className="pstrip__bar">
                  <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, sFill))})` }} />
                </span>
              </span>
              <span className="pstrip__pace">
                {streak > 0 && <small>{fmt(streak)} подряд</small>}
              </span>
            </div>

            {prison.parcels.length > 0 && (
              <div className="pparcels" ref={parcelsRef}>
                {prison.parcels.map((x, i) => {
                  const tier = CASE_TIERS.find((t) => t.id === x.tier)!;
                  const done = x.left <= 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`pparcel${done ? ' is-ready' : ''}`}
                      style={{ '--tier': tier.color } as CSSProperties}
                      aria-label={`Посылка, ${tier.name.toLowerCase()}${done ? ', готова' : ''}`}
                      onClick={() => openParcel(i)}
                    >
                      <img src={parcelTexture(tier.color)} alt="" />
                      {!done && (
                        <span className="pparcel__bar">
                          <i style={{ transform: `scaleX(${1 - x.left / PARCEL_NEED[x.tier]})` }} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {yardEv && (
              <div className="pbuffs">
                <EventPill ev={yardEv} now={yardNow} />
              </div>
            )}
            <div
              className={`fscene${stunned ? ' is-stunned' : ''}${tree.seid ? ' is-seid' : ''}${yardEv?.id === 'blizzard' ? ' is-blizzard' : ''}`}
              ref={sceneRef}
              style={
                {
                  '--lw': `${logW}px`,
                  '--lh': `${logH}px`,
                  '--gh': `${ground}px`,
                } as CSSProperties
              }
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="fscene__far" aria-hidden="true" />
              <div className="fscene__ground" aria-hidden="true" />
              <div className="fscene__snow" aria-hidden="true" />
              {yardEv?.id === 'blizzard' && <div className="fscene__wind" aria-hidden="true" />}
              {yardEv?.id === 'bear' && (
                <div
                  className="fbear"
                  ref={bearRef}
                  style={{
                    // Идёт от правого края к штабелю: по доле прошедшего времени.
                    left: `${Math.round(
                      size.w -
                        logW * 0.72 -
                        6 -
                        (size.w - logW * 0.72 - 12) *
                          Math.min(1, (yardNow - yardEv.from) / (yardEv.until - yardEv.from)),
                    )}px`,
                    bottom: ground - 8,
                    width: logW * 0.72,
                    height: logW * 0.72,
                  }}
                >
                  <img src={bearTexture()} alt="Медведь" />
                  <b className="fbear__n">
                    {Math.min(yardEv.have, yardEv.need)}/{yardEv.need}
                  </b>
                </div>
              )}
              <div className="ftree" ref={treeRef} style={{ left: trunkLeft }}>
                {tree.seid && <i className="ftree__aura" />}
                <div className="ftrunk" ref={trunkRef}>
                  {logs.map((log, k) => (
                    <div
                      key={cut + k}
                      className={`flog${k === 0 ? ' is-bottom' : ''}`}
                      style={{
                        bottom: k * logH,
                        backgroundImage: `url(${barkTexture(tree.species)})`,
                      }}
                    >
                      {log.branch && (
                        <i
                          className={`flog__branch is-${log.branch}${sense && k < 2 && log.branch === side ? ' is-danger' : ''}`}
                          style={{ backgroundImage: `url(${branchTexture(tree.species)})` }}
                        />
                      )}
                      {log.kind !== 'plain' && (
                        <i
                          className={`flog__mark is-${log.kind}`}
                          style={{ backgroundImage: `url(${logMarkTexture(log.kind)})` }}
                        />
                      )}
                      {k === 0 && crack > 0 && (
                        <i
                          className="flog__crack"
                          style={{ backgroundImage: `url(${crackTexture(crack)})` }}
                        />
                      )}
                    </div>
                  ))}
                  {cut + visible >= tree.logs.length && (
                    <img
                      className="fcrown"
                      src={crownTexture(tree.species, tree.seid)}
                      alt=""
                      style={{
                        bottom: crownBottom - logH * 0.25,
                        width: crownW,
                        height: crownW,
                        left: (logW - crownW) / 2,
                      }}
                    />
                  )}
                </div>
              </div>
              <div
                className={`faxe is-${side}`}
                ref={axeRef}
                style={{
                  left: side === 'L' ? trunkLeft - logW * 0.72 : trunkLeft + logW * 1.02,
                  bottom: ground + logH * 0.05,
                  width: logW * 0.7,
                  height: logW * 0.7,
                }}
              >
                <AxeIcon axe={forest.axe} size={Math.round(logW * 0.7)} />
              </div>
              {forest.logs === 0 && (
                <div className="fmx-tap" aria-hidden="true">
                  <GxIcon name="pointing" />
                  <b>Тапай слева или справа</b>
                  <GxIcon name="pointing" />
                </div>
              )}
              <canvas className="pmine__fx" ref={canvasRef} />
              <div className="pmine__layer" ref={layerRef} />
              {toast && (
                <div className="pmine__toast" key={toast.id}>
                  {toast.text}
                </div>
              )}
            </div>
          </div>

          <div className={`pmx-foot${mill.level > 0 ? ' is-tight' : ''}`}>
            <button
              type="button"
              ref={pileRef}
              className={`gx-panel gx-panel--wood pmx-bag${pileFull ? ' is-full' : ''}${forest.truck ? ' has-cart' : ''}`}
              onClick={sell}
            >
              <GxIcon name="wood-pile" className="pmx-bag__ico" />
              <span className="pmx-bag__body">
                <GxBar
                  value={forest.pile.n / cap}
                  tone={pileFull ? 'red' : 'green'}
                  label={`${forest.pile.n} / ${cap}`}
                />
                <span
                  className={`gx-btn gx-btn--sm${forest.pile.n ? ' gx-btn--red' : ''} pmx-bag__sell`}
                >
                  {forest.pile.n ? (
                    <>
                      {shortMoney(pileValue)} <CoinIcon size={13} />
                    </>
                  ) : (
                    'Пусто'
                  )}
                </span>
              </span>
            </button>
            {mill.level > 0 && (
              <button
                type="button"
                ref={millRef}
                className={`gx-panel gx-panel--wood pmx-camp fmx-mill${millQueued > 0 ? ' is-busy' : ''}`}
                aria-label="Пилорама"
                onClick={toMill}
              >
                <GxIcon name="saw" size={28} className="fmx-mill__saw" />
                <b>Пилорама</b>
                <GxBar thin tone="blue" value={millQueued / millQueueCap(mill.level)} />
                {millBoards > 0 && (
                  <i className="gx-badge gx-badge--gold">{shortCount(millBoards)}</i>
                )}
              </button>
            )}
            <button
              type="button"
              className="gx-panel gx-panel--wood pmx-camp"
              ref={campRef}
              onClick={() => {
                tapLight();
                setCamp('axes');
              }}
            >
              <AxeIcon axe={forest.axe} size={30} />
              <b>Лагерь</b>
              {prison.pet && (
                <img
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
                <i className="gx-badge gx-badge--gold pmx-camp__keys">
                  <KeyIcon size={10} />
                  {prison.keys}
                </i>
              ) : (
                campBadge && <i className="gx-badge">!</i>
              )}
            </button>
          </div>
        </div>
      )}

      {camp && (
        <PrisonCamp
          place="forest"
          tab={camp}
          onTab={setCamp}
          onClose={() => setCamp(null)}
          onGain={rollBalance}
          onSpend={settleBalance}
        />
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

      {sheet === 'plan' && !atTop && (
        <GxModal
          title={`Разряд ${forest.rank + 2}`}
          onClose={() => setSheet(null)}
          className="pmx-norm"
        >
          <div className={`pmx-norm__row${planOk ? ' is-done' : ''}`}>
            <img src={barkTexture(forest.rank)} alt="" />
            <span className="pmx-norm__info">
              <b>{plotSpecies.name}</b>
              <GxBar
                tone={planOk ? 'green' : 'gold'}
                value={planHave / need}
                label={
                  planOk ? (
                    <KIcon name="checkmark" size={12} />
                  ) : (
                    `${toM3(planHave)} / ${toM3(need)} м³`
                  )
                }
              />
            </span>
          </div>
          <div className={`pmx-norm__row${balance >= cost ? ' is-done' : ''}`}>
            <CoinIcon size={32} />
            <span className="pmx-norm__info">
              <b>Монеты</b>
              <GxBar
                tone={balance >= cost ? 'green' : 'gold'}
                value={progress}
                label={
                  balance >= cost ? (
                    <KIcon name="checkmark" size={12} />
                  ) : (
                    `${shortMoney(balance)} / ${shortMoney(cost)}`
                  )
                }
              />
            </span>
          </div>
          <div className="pmx-norm__actions">
            <button
              type="button"
              className="gx-btn gx-btn--red gx-btn--block gx-btn--big"
              disabled={!planOk || balance < cost}
              onClick={() => takeRank(false)}
            >
              Взять разряд {forest.rank + 2}
            </button>
            {!planOk && (
              <button
                type="button"
                className="gx-btn gx-btn--block"
                disabled={balance < cost + buyout}
                onClick={() => takeRank(true)}
              >
                Докупить брёвна · {shortMoney(buyout)} <CoinIcon size={13} />
              </button>
            )}
          </div>
        </GxModal>
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
            <span className="prank__label">Новый разряд</span>
            <b className="prank__letter">{sceneShown.rank + 1}</b>
            <span className="prank__mine">
              <img src={barkTexture(sceneShown.rank)} alt="" />
              {SPECIES[sceneShown.rank].name} · до {SPECIES[sceneShown.rank].value} за бревно
            </span>
            <span className="prank__key">
              <KeyIcon size={13} /> +1 ключ от сундука
            </span>
            {sceneShown.buyout > 0 && (
              <span className="prank__lvl">Брёвна докуплены за {fmt(sceneShown.buyout)} монет</span>
            )}
            {sceneShown.rank < LAST_PLOT && (
              <span className="prank__norm">
                Для разряда {sceneShown.rank + 2}: {toM3(forestPlan(sceneShown.rank))} м³{' '}
                {SPECIES[sceneShown.rank].gen}
              </span>
            )}
            <span className="prank__cta">Рубить</span>
          </div>
        </div>
      )}
      <EventAnnounce ev={yardSplash} onDone={closeSplash} />
    </div>
  );
}
