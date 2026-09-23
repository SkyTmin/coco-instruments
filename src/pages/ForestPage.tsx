import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Sheet } from '@/components/ui';
import { IconGift } from '@/components/icons';
import { RewardsSheet, useReadyRewards } from '@/components/RewardsSheet';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon } from '@/components/slot-art';
import {
  AxeIcon,
  KeyIcon,
  ParcelReveal,
  PickIcon,
  PrisonCamp,
  TokenIcon,
} from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
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
  pileCapacity,
  planBuyout,
  SPECIES,
  standHit,
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
import {
  barkTexture,
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
  const campRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const parcelsRef = useRef<HTMLDivElement>(null);
  const moneyRef = useRef<MoneyHandle>(null);
  const fx = useRef<Fx | null>(null);
  const hp = useRef(-1);
  const sideRef = useRef<Side>('L');
  const stunUntil = useRef(0);
  const lastHit = useRef(0);
  const pointer = useRef<{ id: number; side: Side } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolling = useRef<(() => void) | null>(null);
  const toastSeq = useRef(0);
  const streakBase = useRef({ n: 0, at: 0 });
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCut = useRef(cut);
  const falling = useRef(false);
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
    if (cut === was + 1 && trunkRef.current) {
      try {
        trunkRef.current.animate(
          [{ transform: `translateY(${-logH}px)` }, { transform: 'translateY(0)' }],
          { duration: 120, easing: 'cubic-bezier(.5,0,1,1)' },
        );
      } catch {
        /* без WAAPI просто встанет */
      }
    } else if (cut === 0 && was > 0 && treeRef.current) {
      try {
        treeRef.current.animate(
          [
            { transform: 'translateX(115%)', opacity: 0 },
            { transform: 'translateX(115%)', opacity: 0, offset: 0.45 },
            { transform: 'translateX(0)', opacity: 1 },
          ],
          { duration: 820, easing: 'cubic-bezier(.2,.7,.3,1)' },
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
  const flyLog = (t: Tree, s: Side) => {
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
        { duration: 560, easing: 'cubic-bezier(.45,0,.55,1)' },
      );
      a.onfinish = () => {
        done();
        squashPop(pile, 0.22);
      };
      a.oncancel = done;
    } catch {
      done();
    }
    setTimeout(done, 1100);
  };

  /** «Бойся!»: крона валится в сторону от топора, снег из неё — облаком. */
  const fellScene = (t: Tree, s: Side) => {
    treeFall();
    addTrauma(sceneRef.current, 0.5);
    flashFrame('small');
    notifySuccess();
    floatAt(size.w / 2, size.h * 0.34, 'БОЙСЯ!', 'pfloat--fell');
    const layer = layerRef.current;
    if (!layer || reduceMotion()) return;
    falling.current = true;
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
      falling.current = false;
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

  const announce = (res: ForestCut, s: Side) => {
    const { x, y } = bottomAt(s);
    const kind = res.tree.logs[res.index]?.kind;
    if (kind === 'burl') {
      floatAt(x, y - 20, 'КАПОКОРЕНЬ ×10', 'pfloat--burl');
      tierBreak(2);
      burstConfetti(40, ['#c88a52', '#ffe08a', '#fff']);
    } else if (kind === 'figured') floatAt(x, y - 20, 'СВИЛЬ ×3', 'pfloat--figured');
    const h = res.chop.hollow;
    if (h) {
      tierBreak(1);
      if (h.kind === 'tokens') floatAt(x, y - 34, `ДУПЛО: +${h.amount} ✦`, 'pfloat--token', 120);
      else if (h.kind === 'parcel') floatAt(x, y - 34, 'ДУПЛО: ПЕРЕДАЧКА', 'pfloat--parcel', 120);
    }
    const tokens = res.chop.tokens + res.chop.chaga;
    if (res.chop.chaga) floatAt(x, y - 46, `ЧАГА +${res.chop.chaga} ✦`, 'pfloat--token', 200);
    else if (tokens) floatAt(x, y - 46, `+${tokens} ✦`, 'pfloat--token', 200);
    const keys = res.chop.keys + (h?.kind === 'keys' ? h.amount : 0);
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
    if (res.parcelsReady) say('Передачка дозрела — вскрой её');
    if (res.petUp) {
      const st = useFinanceStore.getState().prison;
      if (st.pet) say(`${petOf(st.pet).name}: ${res.petUp} уровень`);
      tierBreak(1);
    }
    if (res.felled?.tokens) {
      floatAt(size.w / 2, size.h * 0.24, `СЕЙД-СОСНА +${res.felled.tokens} ✦`, 'pfloat--seid', 300);
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

  const hit = (s: Side) => {
    const now = performance.now();
    if (now < stunUntil.current || falling.current) return;
    const st = useFinanceStore.getState();
    const f = st.forest;
    if (st.prison.rank < FOREST_UNLOCK_RANK) return;
    const fm = forestMods(st.prison);
    const rate = AXES[f.axe].rate * fm.rate;
    if (now - lastHit.current < 1000 / (rate * 1.8) - 4) return;
    lastHit.current = now;
    if (sideRef.current !== s) {
      sideRef.current = s;
      setSide(s);
    }
    const t = buildTree(f.rank, f.tree.seed);
    const i = f.tree.cut;
    // Встал туда, где у нижнего бревна сучок, — сам на него и налетел.
    if (standHit(t, i, s)) {
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
    flyLog(res.tree, s);
    bumpStreak();
    announce(res, s);
    if (res.felled) fellScene(res.tree, s);
    else if (res.hit) strike(s);
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
    const rate = AXES[st.forest.axe].rate * forestMods(st.prison).rate;
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
    const rate = AXES[st.forest.axe].rate * forestMods(st.prison).rate;
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

  // ---- Деньги: сдать штабель, разряд, передачки ------------------------

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
      <Screen title="Лесоповал" className="prison-screen forest-screen">
        <div className="forest-scene-bg" aria-hidden="true" />
      </Screen>
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
  const pileValue = Math.round(forest.pile.value * forestMods(prison).sell);
  const campBadge = perkPointsFree(prison) > 0;
  const sTier = streakTier(streak);
  const sNext = STREAK_TIERS[sTier + 1];
  const sFrom = sTier >= 0 ? STREAK_TIERS[sTier].at : 0;
  const sFill = sNext ? (streak - sFrom) / (sNext.at - sFrom) : 1;
  const plotSpecies = SPECIES[forest.rank];
  const logs = tree.logs.slice(cut, cut + visible);
  const crownBottom = (tree.logs.length - cut) * logH;
  const crownW = logW * 2.4;

  return (
    <Screen
      title="Лесоповал"
      subtitle={`Делянка ${forest.rank + 1} · ${plotSpecies.name.toLowerCase()} · до ${plotSpecies.value} за бревно`}
      className="prison-screen forest-screen"
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
            className="pmine-btn"
            type="button"
            aria-label="В шахту"
            onClick={() => {
              tapLight();
              nav('/prison');
            }}
          >
            <PickIcon pick={prison.pick} size={24} />
          </button>
        </div>
      }
    >
      <div className="forest-scene-bg" aria-hidden="true" />
      {locked ? (
        <div className="forest-lock">
          <b>Лесоповал откроется с ранга {rankLetter(FOREST_UNLOCK_RANK)}</b>
          <p>
            Сначала шахта: возьми ранг {rankLetter(FOREST_UNLOCK_RANK)} — и тебя поставят на делянку
            с топором.
          </p>
          <button className="btn btn--primary btn--block" onClick={() => nav('/prison')}>
            В шахту
          </button>
        </div>
      ) : (
        <div className="prison forest">
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
                setCamp('axes');
              }}
            >
              <span className="phud__label">Токены</span>
              <span className="phud__value phud__value--token">
                {shortCount(prison.tokens)} <TokenIcon size={14} />
              </span>
            </button>
            <button
              type="button"
              className={`phud__rank${ready ? ' is-ready' : ''}`}
              onClick={rankUp}
            >
              <span className="phud__label">
                {atTop ? 'Высший разряд' : `Разряд ${forest.rank + 1} → ${forest.rank + 2}`}
              </span>
              <span className="phud__cost">
                {atTop ? (
                  '★'
                ) : ready ? (
                  'Взять'
                ) : (
                  <>
                    <span className={progress >= 1 ? 'phud__ok' : undefined}>
                      {shortMoney(cost)}
                    </span>
                    <CoinIcon size={12} />
                    <span className="pquota">
                      <span className={`pquota__chip${planOk ? ' is-done' : ''}`}>
                        <img src={barkTexture(forest.rank)} alt={plotSpecies.name} />
                        {planOk ? '✓' : `${toM3(planHave)}/${toM3(need)} м³`}
                      </span>
                    </span>
                  </>
                )}
              </span>
              <span className="phud__bar">
                <i
                  style={{
                    transform: `scaleX(${atTop ? 1 : Math.min(progress, planHave / need)})`,
                  }}
                />
              </span>
            </button>
          </div>

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
                  {sTier >= 0 ? STREAK_TIERS[sTier].name : 'Запал'}
                  {sTier >= 0 && <em>+{Math.round(STREAK_TIERS[sTier].loot * 100)}%</em>}
                </span>
                <span className="pstrip__bar">
                  <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, sFill))})` }} />
                </span>
              </span>
              <span className="pstrip__pace">
                <small>{streak > 0 ? `${fmt(streak)} подряд` : 'руби в ритм'}</small>
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
                      aria-label={`Передачка, ${tier.name.toLowerCase()}${done ? ', готова' : ''}`}
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

            <div
              className={`fscene${stunned ? ' is-stunned' : ''}${tree.seid ? ' is-seid' : ''}`}
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
                          className={`flog__branch is-${log.branch}`}
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
              <canvas className="pmine__fx" ref={canvasRef} />
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
              ref={pileRef}
              className={`pbag fpile${pileFull ? ' is-full' : ''}${forest.truck ? ' has-cart' : ''}`}
              onClick={sell}
            >
              <span className="fpile__ico" aria-hidden="true">
                <img src={barkTexture(forest.rank)} alt="" />
                <img src={barkTexture(Math.max(0, forest.rank - 1))} alt="" />
              </span>
              <span className="pbag__body">
                <span className="pbag__top">
                  <b>
                    {forest.pile.n} / {cap}
                  </b>
                  <span className="pbag__sell">
                    {forest.pile.n ? (
                      <>
                        Сдать · {shortMoney(pileValue)} <CoinIcon size={12} />
                      </>
                    ) : (
                      'Штабель пуст'
                    )}
                  </span>
                </span>
                <span className="pbag__bar">
                  <i style={{ transform: `scaleX(${Math.min(1, forest.pile.n / cap)})` }} />
                </span>
              </span>
            </button>
            <button
              type="button"
              className="pforge-btn"
              ref={campRef}
              onClick={() => {
                tapLight();
                setCamp('axes');
              }}
            >
              <AxeIcon axe={forest.axe} size={28} />
              <span>Лагерь</span>
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
                <i className="pforge-btn__dot pforge-btn__dot--n">
                  <KeyIcon size={9} />
                  {prison.keys}
                </i>
              ) : (
                campBadge && <i className="pforge-btn__dot" />
              )}
            </button>
          </div>

          <p className="forest-note">
            Тапай по той стороне ствола, откуда рубить. Сучок на твоей стороне бьёт по лбу — смотри
            на бревно выше и вставай с другой стороны.
          </p>
        </div>
      )}

      {camp && (
        <PrisonCamp
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
        <Sheet title={`Разряд ${forest.rank + 2}`} onClose={() => setSheet(null)}>
          <div className="stack">
            <p className="pnorm__lead">
              План в кубометрах: одних денег мало — сдай {plotSpecies.gen}. Считаются брёвна,
              срубленные своими руками.
            </p>
            <div className="pnorm">
              <div className={`pnorm__row${planOk ? ' is-done' : ''}`}>
                <img src={barkTexture(forest.rank)} alt="" />
                <span className="pnorm__info">
                  <b>{plotSpecies.name}</b>
                  <i>{planOk ? 'сдано' : 'растёт на этой делянке чаще прочих'}</i>
                  <span className="pnorm__bar">
                    <i style={{ transform: `scaleX(${planHave / need})` }} />
                  </span>
                </span>
                <span className="pnorm__n">
                  {planOk ? '✓' : `${toM3(planHave)}/${toM3(need)} м³`}
                </span>
              </div>
              <div className={`pnorm__row${balance >= cost ? ' is-done' : ''}`}>
                <span className="pnorm__coin">
                  <CoinIcon size={26} />
                </span>
                <span className="pnorm__info">
                  <b>Цена разряда</b>
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
              disabled={!planOk || balance < cost}
              onClick={() => takeRank(false)}
            >
              {!planOk
                ? `Не хватает ${toM3(need - planHave)} м³ ${plotSpecies.gen}`
                : balance < cost
                  ? `Не хватает ${fmt(cost - balance)} монет`
                  : `Взять разряд за ${fmt(cost)} монет`}
            </button>
            {!planOk && (
              <>
                <button
                  className="btn btn--ghost btn--block"
                  disabled={balance < cost + buyout}
                  onClick={() => takeRank(true)}
                >
                  Откупить план: {fmt(cost)} + {fmt(buyout)} монет
                </button>
                <p className="pnorm__note">
                  Откуп дешевеет с каждым сданным бревном: сейчас выполнено{' '}
                  {Math.round((planHave / need) * 100)}%.
                </p>
              </>
            )}
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
            <span className="prank__label">Новый разряд лесоруба</span>
            <b className="prank__letter">{sceneShown.rank + 1}</b>
            <span className="prank__mine">
              <img src={barkTexture(sceneShown.rank)} alt="" />
              Открыта делянка: {SPECIES[sceneShown.rank].name.toLowerCase()},{' '}
              {SPECIES[sceneShown.rank].value} за бревно
            </span>
            <span className="prank__key">
              <KeyIcon size={13} /> +1 ключ от сундука
            </span>
            {sceneShown.buyout > 0 && (
              <span className="prank__lvl">План откуплен за {fmt(sceneShown.buyout)} монет</span>
            )}
            {sceneShown.rank < LAST_PLOT && (
              <span className="prank__norm">
                План на разряд {sceneShown.rank + 2}: {toM3(forestPlan(sceneShown.rank))} м³{' '}
                {SPECIES[sceneShown.rank].gen}
              </span>
            )}
            <span className="prank__cta">На делянку</span>
          </div>
        </div>
      )}
    </Screen>
  );
}
