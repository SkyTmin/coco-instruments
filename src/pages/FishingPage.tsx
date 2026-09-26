// «Рыбалка» (v2.65) — страница. Правила в `lib/fishing.ts`, здесь пальцы и
// картинка. Сцена сбоку: небо, дальний берег места, вода, мостки, удочка;
// леска — SVG-кривая от кончика удилища к поплавку, провисает по натяжению.
//
// Всё, что движется каждый кадр (поплавок, леска, тень рыбы, полосы силы и
// натяжения), пишется rAF-циклом прямо в элементы: бой — это 60 шагов в
// секунду, гнать его через состояние React незачем. Состояние меняется
// только на границах фаз: заброс, поклёвка, бой, улов.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GxBar, GxIcon, KIcon } from '@/components/gx';
import { AudioToggles } from '@/components/AudioToggles';
import { CoinIcon } from '@/components/slot-art';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { KeyIcon, PrisonCamp, TokenIcon, rewardLabel } from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { TreasurePanel } from '@/components/Critters';
import {
  FishSprite,
  fishIndex,
  FLOAT_TILE,
  kgText,
  MUSSEL_TILE,
  PEARL_TILE,
  rarityColor,
} from '@/components/FishingCamp';
import { useFinanceStore } from '@/store';
import type { FishCatch, TreasureGot } from '@/store';
import {
  biteNow,
  biteWait,
  FISH_UNLOCK_RANK,
  hookWindow,
  netCapacity,
  nibbles,
  PEARL_MAX,
  pullOf,
  RED_AT,
  RODS,
  rollBite,
  skillOf,
  SPOTS,
  spotOpen,
  SPOT_GATE,
  startFight,
  stepFight,
} from '@/lib/fishing';
import type { Bite, Fight, FishDef } from '@/lib/fishing';
import { modsOf, petOf, rankLetter, shortMoney } from '@/lib/prison';
import { petTexture } from '@/lib/prison-art';
import { createFx } from '@/lib/prison-fx';
import type { Fx } from '@/lib/prison-fx';
import { plainPlan, runRollup } from '@/lib/rollup';
import { squashPop } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { useGameAudio } from '@/lib/use-game-audio';
import {
  castWhoosh,
  coinDing,
  fishLanded,
  fishSplash,
  floatTwitch,
  keyFound,
  lineSnap,
  primeAudio,
  reelClick,
  rollupTick,
  tierBreak,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const rarityBeats = (f: FishDef) => ({ common: 0, rare: 1, epic: 2, legend: 4 })[f.rarity];

type Phase = 'idle' | 'aim' | 'fly' | 'wait' | 'bite' | 'fight' | 'result';

interface Run {
  phase: Phase;
  t0: number;
  power: number;
  dist: number;
  /** Куда лёг поплавок, в долях сцены. */
  fx: number;
  fy: number;
  biteAt: number;
  hookUntil: number;
  twitches: number[];
  /** Сколько холостых подёргиваний уже прозвучало. */
  tw: number;
  bite: Bite | null;
  pull: number;
  fight: Fight | null;
  fight0: number;
  hold: boolean;
  last: number;
  reelAt: number;
  splashAt: number;
  raf: number;
}

const freshRun = (): Run => ({
  phase: 'idle',
  t0: 0,
  power: 0,
  dist: 0,
  fx: 0.6,
  fy: 0.6,
  biteAt: 0,
  hookUntil: 0,
  twitches: [],
  tw: 0,
  bite: null,
  pull: 1,
  fight: null,
  fight0: 1,
  hold: false,
  last: 0,
  reelAt: 0,
  splashAt: 0,
  raf: 0,
});

/** Силуэт дальнего берега места: ступенчатый, как пиксельная картинка. */
function farPath(spot: number, w: number, h: number): string {
  const base = h * 0.4;
  const step = 4;
  const pts: string[] = [`M0 ${base}`];
  for (let x = 0; x <= w; x += step) {
    const t = x / w;
    let y = base;
    if (spot === 0)
      y = base - 10 - 8 * Math.abs(Math.sin(t * 23)) - 16 * Math.max(0, Math.sin(t * 5 + 1));
    else if (spot === 1) y = base - 18 - 10 * Math.abs(Math.sin(t * 17)) - 6 * Math.sin(t * 41);
    else if (spot === 2) y = base - 14 - 26 * Math.max(0, Math.sin(t * 3.2 + 0.4));
    else if (spot === 3)
      y = base - 12 - 70 * Math.max(0, 1 - Math.abs(((t * 3.4) % 1) - 0.5) * 2.4);
    else y = base - 2;
    pts.push(`L${x} ${Math.round(y / step) * step}`);
  }
  pts.push(`L${w} ${base} Z`);
  return pts.join(' ');
}

/** Солнце (или луна) места: где стоит, какого размера и цвета. */
const SUNS = [
  { x: 0.72, y: 0.33, r: 0.1, c: '#fff1c1', glow: 'rgba(255, 214, 140, 0.55)' },
  { x: 0.8, y: 0.1, r: 0.055, c: '#fffbe6', glow: 'rgba(255, 250, 220, 0.6)' },
  { x: 0.28, y: 0.3, r: 0.12, c: '#ffd9c8', glow: 'rgba(255, 170, 170, 0.45)' },
  { x: 0.22, y: 0.13, r: 0.05, c: '#ffffff', glow: 'rgba(255, 255, 255, 0.5)' },
  { x: 0.78, y: 0.12, r: 0.045, c: '#eef4ff', glow: 'rgba(200, 220, 255, 0.35)' },
];

/** Даль: солнце, облака, звёзды и снег на пиках — всё неподвижное, рисуется раз. */
function FarDecor({ spot, w, h }: { spot: number; w: number; h: number }) {
  const sun = SUNS[spot];
  const base = h * 0.4;
  const cloud = (x: number, y: number, k: number, key: string) => (
    <g key={key} fill="rgba(255,255,255,0.55)">
      <rect x={x} y={y} width={46 * k} height={8 * k} rx={4 * k} />
      <rect x={x + 10 * k} y={y - 6 * k} width={20 * k} height={10 * k} rx={5 * k} />
    </g>
  );
  return (
    <>
      <defs>
        <radialGradient id={`fsx-sun${spot}`}>
          <stop offset="0.45" stopColor={sun.glow} />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <clipPath id="fsx-snow">
          <rect x="0" y="0" width={w} height={base - 46} />
        </clipPath>
      </defs>
      <circle cx={sun.x * w} cy={sun.y * h} r={sun.r * w * 2.4} fill={`url(#fsx-sun${spot})`} />
      <circle cx={sun.x * w} cy={sun.y * h} r={sun.r * w} fill={sun.c} />
      {spot === 4 &&
        [0.1, 0.22, 0.38, 0.5, 0.63, 0.9, 0.3, 0.7].map((x, i) => (
          <rect
            key={i}
            x={x * w}
            y={(0.05 + ((i * 37) % 23) / 100) * h}
            width="2"
            height="2"
            fill="rgba(255,255,255,0.8)"
          />
        ))}
      {(spot === 1 || spot === 3) && [
        cloud(w * 0.08, h * 0.08, 1.1, 'a'),
        cloud(w * 0.5, h * 0.18, 0.8, 'b'),
      ]}
      {spot === 0 && cloud(w * 0.12, h * 0.14, 0.9, 'a')}
      <path className="fsx-far__shore" d={farPath(spot, w, h)} />
      {spot === 3 && <path d={farPath(spot, w, h)} fill="#f2f6fb" clipPath="url(#fsx-snow)" />}
    </>
  );
}

/** Ближний план: дорожка солнца на воде, камыш и кувшинки. */
function NearDecor({ spot, w, h }: { spot: number; w: number; h: number }) {
  const sun = SUNS[spot];
  const water = h * 0.4;
  const bars = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const y = water + 6 + i * i * 4.5;
    const len = sun.r * w * (1.6 - i * 0.15);
    return (
      <rect
        key={i}
        x={sun.x * w - len / 2 + ((i % 2) * 2 - 1) * 5}
        y={y}
        width={len}
        height={3}
        fill={sun.c}
        opacity={0.55 - i * 0.06}
      />
    );
  });
  const reeds =
    spot === 0 || spot === 2
      ? [0.86, 0.9, 0.93, 0.96, 0.99].map((x, i) => {
          const top = h * (0.76 + (i % 3) * 0.03);
          return (
            <g key={i}>
              <rect x={x * w} y={top} width="3" height={h - top} fill="#3f5a2a" />
              <rect x={x * w - 1} y={top - 12} width="5" height="14" rx="2" fill="#6b4020" />
            </g>
          );
        })
      : null;
  const lilies =
    spot === 0
      ? [
          [0.55, 0.82, 16],
          [0.68, 0.93, 20],
          [0.14, 0.62, 12],
        ].map(([x, y, r], i) => (
          <g key={i}>
            <ellipse cx={x * w} cy={y * h} rx={r} ry={r * 0.38} fill="#3d7a3a" />
            <path
              d={`M${x * w} ${y * h} l${r} ${-r * 0.12} l0 ${r * 0.24} z`}
              fill="rgba(20,50,30,0.8)"
            />
          </g>
        ))
      : null;
  return (
    <>
      {bars}
      {lilies}
      {reeds}
    </>
  );
}

export function FishingPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const fishing = useFinanceStore((s) => s.fishing);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const fishSpot = useFinanceStore((s) => s.fishSpot);
  const fishCatch = useFinanceStore((s) => s.fishCatch);
  const fishSell = useFinanceStore((s) => s.fishSell);
  const fishFeed = useFinanceStore((s) => s.fishFeed);
  useGameAudio('fishing', 'fishing');

  const [camp, setCamp] = useState<CampTab | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [card, setCard] = useState<{ bite: Bite; got: FishCatch } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [size, setSize] = useState({ w: 340, h: 420 });
  const [shownBalance, setShownBalance] = useState(balance);
  const rolling = useRef<(() => void) | null>(null);
  const moneyRef = useRef<MoneyHandle>(null);
  const toastSeq = useRef(0);

  const sceneRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const rodRef = useRef<SVGPathElement>(null);
  const gripRef = useRef<SVGPathElement>(null);
  const reelRef = useRef<SVGCircleElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<HTMLElement>(null);
  const tensionRef = useRef<HTMLElement>(null);
  const tenseBoxRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLButtonElement>(null);
  const tokenRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fx = useRef<Fx | null>(null);
  const run = useRef<Run>(freshRun());

  useEffect(() => {
    if (!rolling.current) setShownBalance(balance);
  }, [balance]);

  const say = useCallback((text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1700);
    return () => clearTimeout(t);
  }, [toast]);

  const rollBalance = useCallback((from: number, to: number) => {
    rolling.current?.();
    if (to <= from) {
      setShownBalance(to);
      return;
    }
    const ms = Math.min(1600, 380 + 70 * Math.pow(to - from, 0.3));
    const stop = runRollup(plainPlan(from, to, ms), {
      value: (n) => moneyRef.current?.set(n),
      tick: (_l, k) => rollupTick(0, k),
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

  // Размер сцены и канва брызг. Сцены нет, пока рыбалка закрыта, — поэтому
  // эффекты ждут и её: открылась прямо на странице — перемерить.
  const sceneOn = hydrated && (prison.rank >= FISH_UNLOCK_RANK || prison.prestige > 0);
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [sceneOn]);
  useEffect(() => {
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
  }, [sceneOn]);
  useEffect(
    () => () => {
      cancelAnimationFrame(run.current.raf);
      rolling.current?.();
    },
    [],
  );

  const skill = skillOf(fishing.xp);
  const spot = fishing.spot;
  const cap = netCapacity(fishing.netLevel);
  const netFull = fishing.net.n >= cap;
  const locked = prison.rank < FISH_UNLOCK_RANK && !prison.prestige;
  const now = Date.now();
  const bites = SPOTS.map((_, i) => biteNow(fishing.bite[i], fishing.biteAt[i], now));

  // ---- Геометрия сцены --------------------------------------------------

  const geo = useMemo(() => {
    const { w, h } = size;
    return {
      w,
      h,
      water: h * 0.4,
      base: { x: w * 0.03, y: h * 0.99 },
      tip: { x: w * 0.3, y: h * 0.3 },
      near: { x: w * 0.36, y: h * 0.84 },
    };
  }, [size]);
  const geoRef = useRef(geo);
  geoRef.current = geo;

  /** Точка, куда ляжет поплавок при силе заброса `d`: дальше — выше (перспектива). */
  const castPoint = (d: number) => ({ x: 0.42 + 0.46 * d, y: 0.7 - 0.24 * d });

  /** Нарисовать удочку, леску и поплавок для текущего кадра. */
  const paint = (floatX: number, floatY: number, tension: number, bend: number, under = 0) => {
    const g = geoRef.current;
    const tip = {
      x: g.tip.x - bend * g.w * 0.08,
      y: g.tip.y + bend * g.h * 0.04 + tension * g.h * 0.05,
    };
    const midX = (g.base.x + tip.x) / 2 + tension * g.w * 0.05;
    const midY = (g.base.y + tip.y) / 2 - g.h * 0.02;
    rodRef.current?.setAttribute(
      'd',
      `M${g.base.x} ${g.base.y} Q${midX} ${midY} ${tip.x} ${tip.y}`,
    );
    // Рукоять — первая пятая удилища (кусок той же кривой), катушка на ней.
    const at = (k: number) => ({
      x: (1 - k) * (1 - k) * g.base.x + 2 * (1 - k) * k * midX + k * k * tip.x,
      y: (1 - k) * (1 - k) * g.base.y + 2 * (1 - k) * k * midY + k * k * tip.y,
    });
    const k = 0.22;
    const c1 = { x: g.base.x + (midX - g.base.x) * k, y: g.base.y + (midY - g.base.y) * k };
    const e1 = at(k);
    gripRef.current?.setAttribute('d', `M${g.base.x} ${g.base.y} Q${c1.x} ${c1.y} ${e1.x} ${e1.y}`);
    const r1 = at(0.15);
    reelRef.current?.setAttribute('cx', `${r1.x + 7}`);
    reelRef.current?.setAttribute('cy', `${r1.y}`);
    const fxp = floatX * g.w;
    const fyp = floatY * g.h;
    const sag = Math.max(0, 1 - tension) * g.h * 0.12;
    const cx = (tip.x + fxp) / 2;
    const cy = Math.max(tip.y, fyp) + sag - (1 - Math.max(0, 1 - tension)) * g.h * 0.02;
    lineRef.current?.setAttribute('d', `M${tip.x} ${tip.y} Q${cx} ${cy} ${fxp} ${fyp - 6}`);
    const fl = floatRef.current;
    if (fl) fl.style.transform = `translate(${fxp}px, ${fyp + under}px)`;
  };

  // ---- Цикл кадров -------------------------------------------------------

  const setPh = (p: Phase) => {
    run.current.phase = p;
    setPhase(p);
  };

  const loop = (t: number) => {
    const r = run.current;
    const dt = Math.min(0.05, Math.max(0, (t - (r.last || t)) / 1000));
    r.last = t;
    const g = geoRef.current;
    const still = reduceMotion();
    if (r.phase === 'aim') {
      // Сила ходит туда-сюда: отпустить надо вовремя.
      const k = ((t - r.t0) / 1300) % 1;
      r.power = 0.5 - 0.5 * Math.cos(k * Math.PI * 2);
      if (powerRef.current) powerRef.current.style.transform = `scaleY(${r.power})`;
      paint(0.34, 0.32, 0.9, r.power, 0);
    } else if (r.phase === 'fly') {
      const k = Math.min(1, (t - r.t0) / 520);
      const p0 = { x: g.tip.x / g.w, y: g.tip.y / g.h };
      const x = p0.x + (r.fx - p0.x) * k;
      const y = p0.y + (r.fy - p0.y) * k - Math.sin(k * Math.PI) * 0.22;
      paint(x, y, 0.8, -0.4 * (1 - k), 0);
      if (k >= 1) {
        fx.current?.chips(r.fx * g.w, r.fy * g.h, ['#cfe8ff', '#ffffff', '#7fb8e0'], 8, 0.8);
        setPh('wait');
      }
    } else if (r.phase === 'wait' || r.phase === 'bite') {
      const now2 = Date.now();
      let under = still ? 0 : Math.sin(t / 420) * 1.5;
      // Холостые подёргивания: поплавок клюёт носом и возвращается.
      for (const at of r.twitches) {
        const d = now2 - at;
        if (d >= 0 && d < 260) under += Math.sin((d / 260) * Math.PI) * 5;
      }
      if (r.tw < r.twitches.length && now2 >= r.twitches[r.tw]) {
        r.tw += 1;
        floatTwitch(false);
      }
      if (r.phase === 'wait' && now2 >= r.biteAt) {
        startBite();
      }
      if (r.phase === 'bite') {
        under += 12;
        if (now2 > r.hookUntil) {
          miss('Сорвалась — не успел подсечь');
          return;
        }
      }
      paint(r.fx, r.fy, 0.15, 0, under);
    } else if (r.phase === 'fight' && r.fight) {
      const res = stepFight(
        r.fight,
        dt,
        r.hold,
        r.pull,
        RODS[useFinanceStore.getState().fishing.rod].reel,
        Math.random,
      );
      r.fight = res.f;
      const f = res.f;
      // Поплавок едет к берегу вместе с рыбой.
      const k = Math.max(0, Math.min(1, f.dist / r.fight0));
      const x = g.near.x / g.w + (r.fx - g.near.x / g.w) * k;
      const y = g.near.y / g.h + (r.fy - g.near.y / g.h) * k;
      const wig = still ? 0 : Math.sin(t / (f.burst > 0 ? 45 : 160)) * (f.burst > 0 ? 6 : 2);
      paint(x + wig / g.w, y, Math.min(1.2, f.tension), 0, 10);
      const sh = shadowRef.current;
      if (sh) sh.style.transform = `translate(${x * g.w + wig * 2}px, ${y * g.h + 18}px)`;
      const tb = tensionRef.current;
      if (tb) {
        tb.style.transform = `scaleX(${Math.min(1, f.tension / 1.2)})`;
        tenseBoxRef.current?.classList.toggle('is-red', f.tension >= RED_AT * 0.92);
        tenseBoxRef.current?.classList.toggle('is-slack', f.tension < 0.14);
      }
      if (r.hold && t - r.reelAt > 95) {
        r.reelAt = t;
        reelClick(Math.min(1, f.tension));
      }
      if (f.burst > 0 && t - r.splashAt > 380) {
        r.splashAt = t;
        fishSplash(r.pull);
        fx.current?.chips(
          x * g.w,
          y * g.h,
          ['#cfe8ff', '#ffffff', '#7fb8e0'],
          6 + Math.round(r.pull * 4),
          1,
        );
      }
      if (res.end) {
        endFight(res.end);
        return;
      }
    }
    r.raf = requestAnimationFrame(loop);
  };
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const kick = () => {
    cancelAnimationFrame(run.current.raf);
    run.current.last = 0;
    run.current.raf = requestAnimationFrame((t) => loopRef.current(t));
  };

  // Покой: удочка и поплавок у ног, ничего не крутится.
  useEffect(() => {
    if (run.current.phase === 'idle' || run.current.phase === 'result')
      paint(0.36, 0.86, 0.3, 0, 0);
  }, [geo, phase, sceneOn]);

  // ---- Фазы --------------------------------------------------------------

  const startBite = () => {
    const r = run.current;
    const f = useFinanceStore.getState().fishing;
    const b = rollBite(
      f.spot,
      biteNow(f.bite[f.spot], f.biteAt[f.spot], Date.now()),
      r.dist,
      Math.random,
    );
    r.bite = b;
    r.hookUntil = Date.now() + hookWindow(b.kind === 'fish' ? b.fish : null);
    setPh('bite');
    floatTwitch(true);
    notifyWarning();
    const g = geoRef.current;
    fx.current?.chips(r.fx * g.w, r.fy * g.h, ['#cfe8ff', '#ffffff', '#7fb8e0'], 14, 1.2);
  };

  const miss = (text: string) => {
    cancelAnimationFrame(run.current.raf);
    run.current = { ...freshRun(), fx: run.current.fx, fy: run.current.fy };
    setPh('idle');
    say(text);
  };

  const hook = () => {
    const r = run.current;
    const b = r.bite;
    if (!b) return;
    const rod = useFinanceStore.getState().fishing.rod;
    r.pull = b.kind === 'fish' ? pullOf(b.fish, b.kg, rod) : 0.45;
    r.fight = startFight(r.dist, Math.random);
    r.fight0 = r.fight.dist;
    r.hold = true;
    setPh('fight');
    tapMedium();
    fishSplash(1);
  };

  const endFight = (end: 'caught' | 'snap' | 'escape') => {
    const r = run.current;
    cancelAnimationFrame(r.raf);
    if (end === 'snap') {
      lineSnap();
      notifyWarning();
      miss('Леска лопнула — сильная рыба. Отпускай, когда краснеет');
      return;
    }
    if (end === 'escape') {
      miss('Ушла — леска провисла');
      return;
    }
    const bite = r.bite!;
    const got = fishCatch(bite);
    if (!got) {
      miss('Садок полон — рыбу пришлось отпустить');
      return;
    }
    setPh('result');
    setCard({ bite, got });
    if (got.sold) {
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - got.sold, to);
      coinDing();
      say(`Садок полон — продан сам: +${shortMoney(got.sold)}`);
    }
    const g = geoRef.current;
    fx.current?.chips(g.near.x, g.near.y, ['#cfe8ff', '#ffffff', '#ffd257'], 20, 1.4);
    if (bite.kind === 'fish') {
      const beats = rarityBeats(bite.fish);
      fishLanded(beats);
      notifySuccess();
      if (beats >= 2)
        burstConfetti(40 + beats * 20, [rarityColor(bite.fish), '#ffffff', '#ffd257']);
      if (got.firstTokens) squashPop(tokenRef.current, 0.6);
      squashPop(netRef.current, 0.4);
      if (got.levelUp) tierBreak(2);
    } else if (bite.kind === 'box') {
      tierBreak(2);
      notifySuccess();
    } else {
      if (got.pearl) {
        keyFound();
        burstConfetti(40, ['#f4eef8', '#ffffff', '#cbb8e8']);
      } else coinDing();
    }
  };

  // ---- Пальцы ------------------------------------------------------------

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    primeAudio();
    const r = run.current;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата тоже работает */
    }
    if (r.phase === 'result') {
      setCard(null);
      setPh('idle');
      return;
    }
    if (r.phase === 'idle') {
      if (useFinanceStore.getState().prison.treasure) return;
      if (
        useFinanceStore.getState().fishing.net.n >=
        netCapacity(useFinanceStore.getState().fishing.netLevel)
      ) {
        notifyWarning();
        squashPop(netRef.current, 0.6);
        say('Садок полон — продай улов или покорми питомца');
        return;
      }
      r.t0 = performance.now();
      setPh('aim');
      tapLight();
      kick();
      return;
    }
    if (r.phase === 'wait') {
      miss('Рано — спугнул. Жди, пока поплавок уйдёт под воду');
      return;
    }
    if (r.phase === 'bite') {
      hook();
      return;
    }
    if (r.phase === 'fight') r.hold = true;
  };

  const onUp = () => {
    const r = run.current;
    if (r.phase === 'aim') {
      const f = useFinanceStore.getState().fishing;
      r.dist = r.power;
      const p = castPoint(r.dist);
      r.fx = p.x;
      r.fy = p.y;
      r.t0 = performance.now();
      const b = biteNow(f.bite[f.spot], f.biteAt[f.spot], Date.now());
      const wait = biteWait(b, r.dist, Math.random);
      r.biteAt = Date.now() + 520 + wait;
      // Холостые поклёвки — до настоящей, не вплотную к ней.
      const n = nibbles(Math.random);
      r.twitches = Array.from(
        { length: n },
        () => Date.now() + 700 + Math.random() * Math.max(300, wait - 700),
      ).sort((a, b) => a - b);
      r.tw = 0;
      setPh('fly');
      castWhoosh(r.dist);
      if (powerRef.current) powerRef.current.style.transform = 'scaleY(0)';
      return;
    }
    if (r.phase === 'fight') r.hold = false;
  };

  // Свернули приложение посреди боя — отпустить катушку.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') run.current.hold = false;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  // Стенд: в разработке поклёвку можно вызвать сразу (`__fish.bite()`).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const w = window as unknown as { __fish?: Record<string, () => void> };
    w.__fish = {
      bite: () => {
        if (run.current.phase === 'wait') run.current.biteAt = Date.now();
      },
    };
    return () => {
      delete w.__fish;
    };
  }, []);

  // ---- Деньги, садок, места ---------------------------------------------

  const sell = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = fishSell();
    if (!got) {
      tapLight();
      say('Садок пуст — лови');
      return;
    }
    rollBalance(from, from + got);
    coinDing();
    notifySuccess();
    squashPop(netRef.current, 0.6);
  };

  const feed = () => {
    primeAudio();
    const pet = useFinanceStore.getState().prison.pet;
    if (!pet) {
      tapLight();
      say('Питомца нет — они выпадают из посылок');
      return;
    }
    const got = fishFeed();
    if (!got) {
      tapLight();
      say('Садок пуст — кормить нечем');
      return;
    }
    tierBreak(1);
    notifySuccess();
    say(`${petOf(pet).name}: +${fmt(got.xp)} опыта${got.up ? ` · ${got.up} уровень` : ''}`);
  };

  const goSpot = (i: number) => {
    primeAudio();
    const r = run.current;
    if (r.phase === 'bite' || r.phase === 'fight') {
      tapLight();
      say('Сначала вытащи, что на крючке');
      return;
    }
    if (!spotOpen(i, skill.level, prison.rank, prison.prestige)) {
      notifyWarning();
      say(
        skill.level < SPOTS[i].skill
          ? `${SPOTS[i].name} откроется с ${SPOTS[i].skill} уровня мастерства`
          : `${SPOTS[i].name} откроется с ранга шахты ${rankLetter(SPOT_GATE[i])}`,
      );
      return;
    }
    if (fishSpot(i)) {
      // Заброшенная удочка сматывается: на новом месте всё сначала.
      tapLight();
      cancelAnimationFrame(r.raf);
      run.current = freshRun();
      setCard(null);
      setPh('idle');
    }
  };

  const onTreasureGot = (got: TreasureGot) => {
    const r = got.reward;
    notifySuccess();
    if (got.coins) {
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - got.coins, to);
      coinDing();
      return;
    }
    if (r.kind === 'keys') keyFound();
    else coinDing();
    say(
      got.shattered
        ? `Мешочек рун полон — руна разбита на ${got.shattered} ✦`
        : `${rewardLabel(r)} — твоё`,
    );
  };

  // ---- Разметка ----------------------------------------------------------

  if (!hydrated) {
    return (
      <div className="gx pmx fsx">
        <div className="fish-scene-bg" aria-hidden="true" />
      </div>
    );
  }

  const top = (
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
      <div className="gx-ribbon pmx-top__title">
        {locked ? 'Рыбалка' : `Рыбалка · ${SPOTS[spot].name.toLowerCase()}`}
      </div>
      <AudioToggles />
    </div>
  );

  if (locked) {
    return (
      <div className="gx pmx fsx">
        <div className="fish-scene-bg" aria-hidden="true" />
        <div className="prison">
          {top}
          <div className="gx-panel gx-panel--wood-fancy fmx-lock">
            <span className="fmx-lock__ico fsx-lock__ico">
              <FishSprite index={2} scale={3} />
              <KIcon name="locked" size={24} />
            </span>
            <b>Откроется с ранга {rankLetter(FISH_UNLOCK_RANK)}</b>
            <button
              type="button"
              className="gx-btn gx-btn--red gx-btn--block"
              onClick={() => nav('/prison')}
            >
              <GxIcon name="pick" size={18} /> В шахту
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cardFish = card?.bite.kind === 'fish' ? card.bite : null;
  const hint =
    phase === 'idle'
      ? netFull
        ? 'Садок полон — продай'
        : 'Держи палец — отпусти, чтобы забросить'
      : phase === 'aim'
        ? 'Отпусти!'
        : phase === 'wait'
          ? 'Жди — поплавок уйдёт под воду'
          : phase === 'bite'
            ? 'Клюёт! Тапни!'
            : phase === 'fight'
              ? 'Держи — подматывай. Краснеет — отпусти'
              : '';
  const petOn = prison.pet;
  // Садок продаётся с той же надбавкой, что порода и лес: показываем то, что придёт.
  const sellMult = modsOf(prison).sell;

  return (
    <div className="gx pmx fsx">
      <div className="fish-scene-bg" aria-hidden="true" />
      <div className="prison">
        {top}

        <div className="pmx-chips">
          <span className="gx-chip pmx-chip--coins">
            <CoinIcon size={18} />
            <MoneyCounter ref={moneyRef} value={shownBalance} />
          </span>
          <span className="gx-chip" ref={tokenRef}>
            <TokenIcon size={17} /> {fmt(prison.tokens)}
          </span>
          <span className="gx-chip fsx-pearls" title="Жемчуг: +0,5% к продаже везде">
            <FishSprite index={PEARL_TILE} scale={1} /> {Math.min(PEARL_MAX, prison.pearls)}/
            {PEARL_MAX}
          </span>
        </div>

        <button
          type="button"
          className="gx-panel gx-panel--wood pmx-rank"
          onClick={() => {
            tapLight();
            setCamp('trophies');
          }}
          aria-label={`Мастерство ${skill.level}`}
        >
          <span className="gx-hex pmx-rank__hex">{skill.level}</span>
          <span className="pmx-rank__mid">
            <GxBar
              value={skill.need ? skill.into / skill.need : 1}
              tone="blue"
              label={skill.need ? `Мастерство · ${skill.into}/${skill.need}` : 'Мастер'}
            />
          </span>
          <span className="gx-hex gx-hex--dark pmx-rank__hex">
            {skill.need ? skill.level + 1 : <KIcon name="star" size={16} />}
          </span>
        </button>

        <div className="fsx-spots" role="tablist" aria-label="Места">
          {SPOTS.map((s, i) => {
            const open = spotOpen(i, skill.level, prison.rank, prison.prestige);
            const lockText =
              skill.level < s.skill ? `${s.skill} ур.` : `шахта ${rankLetter(SPOT_GATE[i])}`;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={spot === i}
                className={`fsx-spot${spot === i ? ' is-on' : ''}${open ? '' : ' is-locked'}`}
                onClick={() => goSpot(i)}
              >
                <b>{open ? s.name : lockText}</b>
                {open ? (
                  <span className="fsx-spot__bite" title="Клёв">
                    <i style={{ transform: `scaleX(${bites[i]})` }} />
                  </span>
                ) : (
                  <KIcon name="locked" size={12} />
                )}
              </button>
            );
          })}
        </div>

        <div className="fframe fsx-frame">
          <div
            className={`fsx-scene is-spot${spot} is-${phase}`}
            ref={sceneRef}
            style={{ '--cell': `${size.w / 7}px` } as CSSProperties}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="fsx-sky" aria-hidden="true" />
            <svg className="fsx-far" width={size.w} height={size.h} aria-hidden="true">
              <FarDecor spot={spot} w={size.w} h={size.h} />
            </svg>
            <div className="fsx-water" aria-hidden="true">
              <i className="fsx-glint" />
              <i className="fsx-glint is-b" />
            </div>
            <svg className="fsx-far" width={size.w} height={size.h} aria-hidden="true">
              <NearDecor spot={spot} w={size.w} h={size.h} />
            </svg>
            <div className="fsx-pier" aria-hidden="true" />
            <div className="fsx-shadow" ref={shadowRef} aria-hidden="true" />
            <svg className="fsx-rig" width={size.w} height={size.h} aria-hidden="true">
              <path className="fsx-line" ref={lineRef} />
              <path className="fsx-rod" ref={rodRef} />
              <path className="fsx-rod__grip" ref={gripRef} />
              <circle className="fsx-rod__reel" ref={reelRef} r="7" />
            </svg>
            <div className="fsx-float" ref={floatRef} aria-hidden="true">
              <FishSprite index={FLOAT_TILE} scale={2} />
              {phase === 'bite' && <b className="fsx-float__bang">!</b>}
            </div>
            <canvas className="pmine__fx" ref={canvasRef} />

            <div className="fsx-bite" title="Клёв здесь">
              <GxIcon name="fish" size={13} /> клёв {Math.round(bites[spot] * 100)}%
            </div>

            {phase === 'aim' && (
              <div className="fsx-power" aria-hidden="true">
                <i ref={powerRef} />
              </div>
            )}
            {phase === 'fight' && (
              <div className="fsx-tense" ref={tenseBoxRef} aria-hidden="true">
                <span className="fsx-tense__zone" />
                <i ref={tensionRef} />
              </div>
            )}
            {hint && <div className={`fsx-hint is-${phase}`}>{hint}</div>}

            {card && (
              <div
                className="fsx-card"
                role="status"
                style={
                  cardFish ? ({ '--tier': rarityColor(cardFish.fish) } as CSSProperties) : undefined
                }
              >
                {cardFish ? (
                  <>
                    <span className="fsx-card__glow" />
                    <FishSprite
                      index={fishIndex(cardFish.fish)}
                      scale={Math.max(3, Math.floor(size.w / 100))}
                    />
                    <b>{cardFish.fish.name}</b>
                    <span className="fsx-card__kg">{kgText(cardFish.kg)}</span>
                    <span className="fsx-card__price">
                      {fmt(card.got.value * sellMult)} <CoinIcon size={14} /> · в садок
                    </span>
                    {card.got.firstTokens > 0 && (
                      <em className="fsx-card__tag is-new">
                        Новый вид! +{card.got.firstTokens} <TokenIcon size={12} />
                      </em>
                    )}
                    {card.got.record > 0 && <em className="fsx-card__tag">Рекорд вида!</em>}
                    {card.got.levelUp > 0 && (
                      <em className="fsx-card__tag is-level">
                        Мастерство {card.got.levelUp}
                        {SPOTS.some((s) => s.skill === card.got.levelUp)
                          ? ` · открыто: ${SPOTS.find((s) => s.skill === card.got.levelUp)!.name}`
                          : ''}
                      </em>
                    )}
                  </>
                ) : card.bite.kind === 'mussel' ? (
                  <>
                    <FishSprite index={card.got.pearl ? PEARL_TILE : MUSSEL_TILE} scale={4} />
                    <b>{card.got.pearl ? 'Жемчужина!' : 'Ракушка'}</b>
                    <span className="fsx-card__kg">
                      {card.got.pearl
                        ? card.got.tokens
                          ? `Жемчуга хватает — +${card.got.tokens} ✦`
                          : '+0,5% к продаже везде'
                        : 'Пустая'}
                    </span>
                  </>
                ) : (
                  <>
                    <GxIcon name="chest" size={64} />
                    <b>Шкатулка со дна</b>
                    <span className="fsx-card__kg">
                      {card.got.tokens ? `+${card.got.tokens} ✦` : 'Открой — выбери одно из трёх'}
                    </span>
                  </>
                )}
                <i className="fsx-card__cta">Тапни — дальше</i>
              </div>
            )}
            {toast && (
              <div className="pmine__toast" key={toast.id}>
                {toast.text}
              </div>
            )}
            {phase === 'idle' && (
              <TreasurePanel
                onGot={onTreasureGot}
                onLost={() => say('Сгорело. В другой раз повезёт')}
              />
            )}
          </div>
        </div>

        <div className="pmx-foot fsx-foot">
          <button
            type="button"
            ref={netRef}
            className={`gx-panel gx-panel--wood pmx-bag${netFull ? ' is-full' : ''}`}
            onClick={sell}
          >
            <GxIcon name="fish-bucket" className="pmx-bag__ico" />
            <span className="pmx-bag__body">
              <GxBar
                value={fishing.net.n / cap}
                tone={netFull ? 'red' : 'green'}
                label={`${fishing.net.n} / ${cap}`}
              />
              <span
                className={`gx-btn gx-btn--sm${fishing.net.n ? ' gx-btn--red' : ''} pmx-bag__sell`}
              >
                {fishing.net.n ? (
                  <>
                    {shortMoney(Math.round(fishing.net.value * sellMult))} <CoinIcon size={13} />
                  </>
                ) : (
                  'Пусто'
                )}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`gx-panel gx-panel--wood pmx-camp fsx-feed${petOn && fishing.net.n ? '' : ' is-off'}`}
            onClick={feed}
            aria-label="Покормить питомца уловом"
          >
            {petOn ? <img src={petTexture(petOn)} alt="" /> : <GxIcon name="paw" size={28} />}
            <b>Кормить</b>
          </button>
          <button
            type="button"
            className="gx-panel gx-panel--wood pmx-camp"
            onClick={() => {
              tapLight();
              setCamp('rods');
            }}
          >
            <GxIcon name="fishing" size={28} />
            <b>Лагерь</b>
            {prison.keys > 0 && (
              <i className="gx-badge gx-badge--gold pmx-camp__keys">
                <KeyIcon size={10} />
                {prison.keys}
              </i>
            )}
          </button>
        </div>
      </div>

      {camp && (
        <PrisonCamp
          place="fish"
          tab={camp}
          onTab={setCamp}
          onClose={() => setCamp(null)}
          onGain={rollBalance}
          onSpend={settleBalance}
        />
      )}
    </div>
  );
}
