// Вылазка: канва мира, пальцы, табло. Правила боя — `lib/dungeon-sim.ts`,
// картинка — `lib/dungeon-render.ts`; здесь только то, что связывает их с
// человеком: джойстик, кнопки, звук, вибрация, листы клети и таблички, запись
// в стор. React перерисовывает только табло и только когда оно поменялось:
// сам кадр рисуется в цикле `requestAnimationFrame` мимо React.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CoinIcon } from '@/components/slot-art';
import { GxBar, GxIcon, GxModal, KIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { KeyIcon, TokenIcon } from '@/components/PrisonCamp';
import { DungeonMine } from '@/components/DungeonMine';
import { DungeonInventory } from '@/components/DungeonInventory';
import { AudioToggles } from '@/components/AudioToggles';
import { useFinanceStore } from '@/store';
import type { DungeonExit } from '@/store';
import {
  areaOf,
  BOSSES,
  canPay,
  DEEP_MINES,
  econOf,
  heroOf,
  levelOf,
  liftCost,
  MATS,
  meatCount,
  meatValue,
  marketSold,
  sackSlots,
  slotsUsed,
  smellOf,
  upgradable,
} from '@/lib/dungeon';
import type { AreaId, DeepMineId, Haul, MatId } from '@/lib/dungeon';
import {
  createSim,
  dropFromSack,
  fogOf,
  heroStuck,
  nearLair,
  NO_INPUT,
  packAtMine,
  snapshot,
  stepSim,
  streakName,
  takeDelta,
  usableNear,
  useObject as interact,
  worldPos,
} from '@/lib/dungeon-sim';
import type { Sim, SimEvent, SimInput, Usable } from '@/lib/dungeon-sim';
import { DungeonRenderer } from '@/lib/dungeon-render';
import { bandAt, bandOf, fogEncode, fogGet, liftOf, Tile, walkableTile } from '@/lib/dungeon-world';
import type { World, WorldObj } from '@/lib/dungeon-world';
import { itemUrl } from '@/lib/dungeon-art';
import { registerEscape } from '@/lib/escape-stack';
import { playTotem } from '@/lib/totem';
import {
  bagFull,
  bedrockClink,
  boom,
  cartRoll,
  coinDing,
  crateBreak,
  dashWhoosh,
  deepRumble,
  eatChomp,
  fuseTick,
  gateSlam,
  heroDeath,
  heroHurt,
  jackpotFanfare,
  kingRoar,
  levelUp,
  liftClank,
  perfectDodge,
  pickUp,
  primeAudio,
  ratDie,
  ratSqueak,
  streakUp,
  swordHit,
  swordSwing,
  setMusicScene,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

const STEP = 1 / 60;
const SAVE_MS = 5000;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  return m >= 60
    ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
    : `${m}:${String(t % 60).padStart(2, '0')}`;
};

export type RunEnd = { kind: 'extract'; exit: DungeonExit } | { kind: 'dead'; lost: Haul };

interface Hud {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  sackN: number;
  cap: number;
  meat: number;
  smell: number;
  coins: number;
  tokens: number;
  keys: number;
  skill: number;
  dash: boolean;
  eat: boolean;
  use: Usable | null;
  bossHp: number | null;
  plaque: number | null;
  /** Есть что улучшить прямо сейчас — «!» на рюкзаке. */
  up: boolean;
  sign: Sign | null;
  coach: CoachStep | null;
}

/** Указатель у дороги: куда идти, в какую сторону и сколько шагов. */
interface SignRow {
  icon: GxIconName;
  label: string;
  /** Направление стрелки, градусы от «вверх» по часовой. */
  angle: number;
  dist: number;
}
interface Sign {
  id: string;
  rows: SignRow[];
}

/**
 * Подсказки первого раза: игра показывает пальцем, а не пишет правила.
 * Каждая — один раз на телефон (localStorage: удобство, не прогресс).
 */
type CoachStep = 'move' | 'attack' | 'bag' | 'dash' | 'spin' | 'eat';
const COACH_KEY = 'dg.coach.v1';
const COACH_TEXT: Record<CoachStep, string> = {
  move: 'Веди пальцем — идти',
  attack: 'Бей!',
  bag: 'Добыча — в рюкзаке',
  dash: 'Рывок — увернуться',
  spin: 'Вихрь готов!',
  eat: 'Съешь — лечит',
};
function coachDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COACH_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function coachSave(done: Set<string>) {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify([...done]));
  } catch {
    /* приватный режим — подсказки покажутся ещё раз, не беда */
  }
}

/** Что показывает указатель: ближайшие лифт, шахта и логово. */
function signRows(sim: Sim, o: WorldObj, lifts: readonly string[]): SignRow[] {
  const nearest = (kind: WorldObj['kind']) => {
    let best: WorldObj | null = null;
    let bd = 1e9;
    for (const t of sim.world.objs) {
      if (t.kind !== kind) continue;
      const dd = Math.hypot(t.x - o.x, t.y - o.y);
      if (dd < bd) {
        bd = dd;
        best = t;
      }
    }
    return best;
  };
  const rows: SignRow[] = [];
  const add = (t: WorldObj | null, icon: GxIconName, label: string) => {
    if (!t) return;
    const dx = t.x - o.x;
    const dy = t.y - o.y;
    rows.push({
      icon,
      label,
      angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
      dist: Math.max(1, Math.round(Math.hypot(dx, dy))),
    });
  };
  const lift = nearest('lift');
  add(lift, 'lift', lift && !lifts.includes(lift.area) ? 'Лифт (сломан)' : 'Лифт');
  add(nearest('mine'), 'minecart', 'Шахта');
  if (sim.boss) add(sim.boss.obj, 'crown', 'Логово короля');
  return rows;
}

const USE_ICON: Record<Usable['kind'], GxIconName> = {
  lift: 'lift',
  mine: 'minecart',
  light: 'lantern',
  grate: 'gate',
  secret: 'chest',
  board: 'joystick',
  seal: 'hammer',
  plaque: 'crown',
};

type Banner = { key: number; big: string; small?: string; tone: string };
type Toast = { key: number; text: string };
type SheetKind = 'pause' | 'lift' | 'board' | 'plaque' | 'map' | 'inv' | null;

/** Ключ, по которому видно, что табло поменялось. */
const hudKey = (h: Hud) =>
  [
    Math.ceil(h.hp),
    h.maxHp,
    h.level,
    Math.round(h.xp * 50),
    h.sackN,
    h.cap,
    h.meat,
    h.smell,
    h.coins,
    h.tokens,
    h.keys,
    Math.round(h.skill * 20),
    h.dash,
    h.eat,
    h.use ? `${h.use.kind}:${h.use.obj.id}` : '',
    h.bossHp === null ? -1 : Math.round(h.bossHp * 100),
    h.plaque === null ? -1 : Math.ceil(h.plaque / 1000),
    h.up,
    h.sign?.id ?? '',
    h.coach ?? '',
  ].join('|');

export function DungeonRun({
  world,
  onEnd,
  onLeave,
}: {
  world: World;
  onEnd: (e: RunEnd) => void;
  /** Ушёл с экрана посреди вылазки: она сохранена и ждёт внизу. */
  onLeave: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLElement>(null);
  const sackRef = useRef<HTMLButtonElement>(null);
  const atkRef = useRef<HTMLButtonElement>(null);
  const dashRef = useRef<HTMLButtonElement>(null);
  const spinRef = useRef<HTMLButtonElement>(null);
  const eatRef = useRef<HTMLButtonElement>(null);
  const coach = useRef<{ done: Set<string>; walk0: number | null; bagAt: number; dashAt: number }>({
    done: coachDone(),
    walk0: null,
    bagAt: 0,
    dashAt: 0,
  });
  const hurtRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const rendRef = useRef<DungeonRenderer | null>(null);
  const input = useRef<SimInput>({ ...NO_INPUT });
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const atk = useRef<{ id: number; x: number; y: number; swiped: boolean } | null>(null);
  const paused = useRef(false);
  const ended = useRef(false);
  const lastSave = useRef(0);
  const hudKeyRef = useRef('');
  const lastSqueak = useRef(0);
  const lastFull = useRef(0);
  const lastCart = useRef(0);
  const [hud, setHud] = useState<Hud | null>(null);
  // Король на арене — своя музыка; пал или ушли — снова глубина.
  const bossOn = hud?.bossHp != null;
  useEffect(() => setMusicScene(bossOn ? 'boss' : 'depths'), [bossOn]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [mine, setMine] = useState<{ id: DeepMineId; obj: Usable['obj'] } | null>(null);
  const [liftArea, setLiftArea] = useState<AreaId>('mouth');
  const [dying, setDying] = useState(false);
  const [lowHp, setLowHp] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((big: string, small?: string, tone = 'area', ms = 2400) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner({ key: Date.now() + Math.random(), big, small, tone });
    bannerTimer.current = setTimeout(() => setBanner(null), ms);
  }, []);
  const note = useCallback((text: string, ms = 2200) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ key: Date.now() + Math.random(), text });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // ---- Запись в стор -----------------------------------------------------

  const fogNow = (sim: Sim): Partial<Record<AreaId, string>> => {
    if (!sim.fogDirty) return {};
    sim.fogDirty = false;
    const out: Partial<Record<AreaId, string>> = {};
    for (const b of sim.world.bands) {
      const bits = fogOf(sim, b.def.id);
      if (bits) out[b.def.id] = fogEncode(bits);
    }
    return out;
  };

  const save = useCallback(() => {
    const sim = simRef.current;
    if (!sim || ended.current) return;
    lastSave.current = performance.now();
    useFinanceStore.getState().dungeonSave(snapshot(sim), takeDelta(sim), fogNow(sim));
  }, []);

  // ---- Мир: симуляция и рисовальщик --------------------------------------

  useEffect(() => {
    const st = useFinanceStore.getState();
    const d = st.dungeon;
    const run = d.run;
    const canvas = canvasRef.current;
    if (!run || !canvas) return undefined;
    const stats = heroOf(d, st.prison);
    let x: number;
    let y: number;
    if (run.x >= 0) ({ x, y } = { x: run.x, y: (bandOf(world, run.area)?.top ?? 0) + run.y });
    else {
      const lift = liftOf(world, run.lift as AreaId) ?? liftOf(world, 'mouth')!;
      x = lift.x + 0.5;
      y = lift.y + 0.5;
    }
    const sim = createSim({
      world,
      dungeon: d,
      stats,
      econ: econOf(st.prison),
      x,
      y,
      hp: run.hp > 0 ? run.hp : stats.maxHp,
      sack: run.sack,
      props: st.prison.items.prop,
    });
    sim.killed = run.killed;
    // Битое сохранение (стоит в стене) — к клети спуска.
    if (heroStuck(sim)) {
      const lift = liftOf(world, run.lift as AreaId) ?? liftOf(world, 'mouth')!;
      const p = worldPos(sim, lift.area, lift.x + 0.5, lift.ly + 0.5);
      sim.hero.x = p.x;
      sim.hero.y = p.y;
    }
    // Вернулся в недосиженную вылазку — пара секунд, чтобы осмотреться.
    if (run.x >= 0) sim.hero.inv = 2;
    simRef.current = sim;
    // Стенд разработки водит героя ботом — ему нужен мир.
    const r = new DungeonRenderer(canvas);
    if (import.meta.env.DEV)
      Object.assign(window as unknown as Record<string, unknown>, { __dg: sim, __dgr: r });
    rendRef.current = r;
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      r.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (rootRef.current) ro.observe(rootRef.current);
    const a = areaOf(sim.area);
    say(a.name, run.x >= 0 ? 'Продолжаем' : a.lead);
    lastSave.current = performance.now();

    let raf = 0;
    let last = performance.now();
    let hudT = 0;
    let mapT = 0;
    const loop = (t: number) => {
      // Метка кадра бывает раньше `performance.now()` при запуске: шаг не
      // бывает отрицательным.
      const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
      last = t;
      if (!paused.current && dt > 0) {
        // Шаг боя — под каждый кадр, а не фиксированный 1/60 с накопителем:
        // на экранах 90–120 Гц накопитель давал то ноль шагов за кадр, то
        // два, и мир ехал рывками. Длинный кадр делится на куски не больше
        // 1/60 с — бой считается так же точно.
        const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
        for (let j = 0; j < n; j++) {
          stepSim(sim, dt / n, input.current);
          // Разовые нажатия съедены шагом.
          const i = input.current;
          i.attack = false;
          i.dash = false;
          i.skill = false;
          i.eat = false;
          i.aim = null;
          i.lock = null;
          if (sim.events.length) {
            r.onEvents(sim, sim.events);
            onEvents(sim, sim.events);
          }
        }
        if (t - lastSave.current > SAVE_MS) save();
      }
      r.frame(sim, useFinanceStore.getState().dungeon.gear, paused.current ? 0 : dt);
      hudT += dt;
      if (hudT > 0.12) {
        hudT = 0;
        pushHud(sim);
      }
      mapT += dt;
      if (mapT > 0.25) {
        mapT = 0;
        drawMini(sim);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        save();
        paused.current = true;
      } else if (!sheetOpen.current) paused.current = false;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onHide);
      // Разработческий StrictMode снимает и ставит эффект сразу: мир ещё не
      // сделал ни шага, и запись превратила бы новую вылазку в «продолжение».
      if (sim.time > 0.3) save();
      simRef.current = null;
    };
    // Мир создаётся один раз на вылазку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Джойстик в покое стоит внизу слева полупрозрачным: видно, чем ходить.
  // Коснулся левой половины — встаёт под палец; отпустил — возвращается.
  const parkStick = useCallback(() => {
    const s = stickRef.current;
    const el = rootRef.current;
    if (!s || !el) return;
    const h = el.clientHeight;
    s.style.transform = `translate(${36}px, ${Math.max(120, h - 210)}px)`;
    s.classList.remove('is-on');
    s.classList.add('is-idle');
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  }, []);
  useEffect(() => {
    parkStick();
    window.addEventListener('resize', parkStick);
    return () => window.removeEventListener('resize', parkStick);
  }, [parkStick]);

  // Пауза, пока открыт любой лист или шахта. «Назад» Telegram — сперва пауза.
  const sheetOpen = useRef(false);
  useEffect(() => {
    sheetOpen.current = sheet !== null || mine !== null;
    paused.current = sheetOpen.current || ended.current;
    if (sheetOpen.current) {
      input.current = { ...NO_INPUT };
      stick.current = null;
      parkStick();
    }
  }, [sheet, mine, parkStick]);
  useEffect(() => {
    if (sheet || mine || dying) return undefined;
    return registerEscape(() => setSheet('pause'));
  }, [sheet, mine, dying]);

  // ---- Табло -----------------------------------------------------------

  const pushHud = (sim: Sim) => {
    const h = sim.hero;
    const lv = levelOf(sim.xp);
    const props = useFinanceStore.getState().prison.items.prop;
    const boss = sim.boss;
    let bossHp: number | null = null;
    if (boss?.state === 'fight') {
      // Одна полоса на весь бой: король — первые 60%, принцы после раскола —
      // последние 40%. Иначе на расколе полоса прыгала бы обратно к полной.
      const king = sim.mobs.find((m) => m.kind === 'king' && m.mode !== 'dying');
      if (king) bossHp = 0.4 + (0.6 * Math.max(0, king.hp)) / king.maxHp;
      else {
        let hp = 0;
        let max = 0;
        for (const m of sim.mobs)
          if (m.kind === 'kinglet') {
            hp += Math.max(0, m.hp);
            max += m.maxHp;
          }
        bossHp = max > 0 ? (0.4 * hp) / max : 0;
      }
    }
    let plaque: number | null = null;
    if (boss && boss.state === 'rest') {
      const d = Math.hypot(boss.obj.x - h.x, boss.obj.y - h.y);
      if (d < 16) plaque = Math.max(0, boss.readyAt - Date.now());
    }
    // Указатель у дороги: читается сам, когда стоишь рядом.
    let sign: Sign | null = null;
    const st = useFinanceStore.getState();
    for (const o of sim.world.objs) {
      if (o.kind !== 'plaque' || nearLair(sim, o)) continue;
      if (Math.hypot(o.x + 0.5 - h.x, o.y + 0.5 - h.y) > 2.4) continue;
      sign = { id: o.id, rows: signRows(sim, o, st.dungeon.lifts) };
      break;
    }
    const up = upgradable(st.dungeon, econOf(st.prison), st.slotsBalance, sim.sack.mats).length > 0;
    // Подсказка первого раза: одна за раз, по порядку важности.
    const c = coach.current;
    if (c.walk0 === null) c.walk0 = h.walk;
    const now = Date.now();
    const mark = (k: CoachStep) => {
      if (c.done.has(k)) return;
      c.done.add(k);
      coachSave(c.done);
    };
    if (h.walk - c.walk0 > 3) mark('move');
    if (c.bagAt && now - c.bagAt > 6000) mark('bag');
    if (c.dashAt && now - c.dashAt > 5000) mark('dash');
    const meatN = meatCount(sim.sack);
    const ratNear = sim.mobs.some(
      (m) => m.mode !== 'dying' && m.mode !== 'sleep' && Math.hypot(m.x - h.x, m.y - h.y) < 3.5,
    );
    let step: CoachStep | null = null;
    if (!c.done.has('move')) step = 'move';
    else if (!c.done.has('attack') && ratNear) step = 'attack';
    else if (!c.done.has('eat') && meatN > 0 && h.hp < sim.stats.maxHp * 0.45) step = 'eat';
    else if (!c.done.has('spin') && h.skill >= 1) step = 'spin';
    else if (!c.done.has('dash') && c.dashAt) step = 'dash';
    else if (!c.done.has('bag') && c.bagAt) step = 'bag';
    const next: Hud = {
      hp: Math.max(0, h.hp),
      maxHp: sim.stats.maxHp,
      level: lv.level,
      xp: lv.need > 0 ? lv.into / lv.need : 1,
      sackN: slotsUsed(sim.sack),
      cap: sackSlots(sim.sackLevel),
      meat: meatCount(sim.sack),
      smell: smellOf(sim.sack),
      coins: sim.sack.coins,
      tokens: sim.sack.tokens,
      keys: sim.sack.keys,
      skill: h.skill,
      dash: h.dashCd <= 0,
      eat: meatCount(sim.sack) > 0 && h.hp < sim.stats.maxHp && h.eatCd <= 0,
      use: usableNear(sim, props),
      bossHp,
      plaque,
      up,
      sign,
      coach: step,
    };
    const k = hudKey(next);
    if (k !== hudKeyRef.current) {
      hudKeyRef.current = k;
      setHud(next);
      setLowHp(next.hp > 0 && next.hp < next.maxHp * 0.3);
    }
  };

  // ---- Мини-карта: район вокруг, разведанное ------------------------------

  const drawMini = (sim: Sim) => {
    const c = mapRef.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    // Радар: 16 клеток вокруг героя, герой всегда в центре круга.
    const R = 16;
    const s = 4;
    const N = R * 2 + 1;
    if (c.width !== N * s) {
      c.width = N * s;
      c.height = N * s;
    }
    g.clearRect(0, 0, c.width, c.height);
    const W = sim.world.w;
    const hx = Math.floor(sim.hero.x);
    const hy = Math.floor(sim.hero.y);
    for (let y = hy - R; y <= hy + R; y++) {
      if (y < 0 || y >= sim.world.h) continue;
      const band = bandAt(sim.world, y);
      const bits = sim.fog[band.def.id];
      if (!bits) continue;
      for (let x = hx - R; x <= hx + R; x++) {
        if (x < 0 || x >= W || !fogGet(bits, x, y - band.top, W)) continue;
        const t = sim.tiles[y * W + x];
        const open = walkableTile(t) || t === Tile.Lift || t === Tile.Gate || t === Tile.Grate;
        g.fillStyle = open
          ? t === Tile.RailV || t === Tile.RailH
            ? '#c9b8a0'
            : '#a78d6c'
          : '#4a331b';
        g.fillRect((x - hx + R) * s, (y - hy + R) * s, s, s);
      }
    }
    for (const o of sim.world.objs) {
      if (Math.abs(o.x - hx) > R || Math.abs(o.y - hy) > R) continue;
      const band = bandAt(sim.world, o.y);
      const bits = sim.fog[band.def.id];
      if (!bits || !fogGet(bits, o.x, o.y - band.top, W)) continue;
      const col =
        o.kind === 'lift'
          ? '#5ca2e0'
          : o.kind === 'mine'
            ? '#ffd257'
            : o.kind === 'boss'
              ? '#e2665b'
              : null;
      if (!col) continue;
      g.fillStyle = '#1c130c';
      g.fillRect((o.x - hx + R) * s - 3, (o.y - hy + R) * s - 3, s + 6, s + 6);
      g.fillStyle = col;
      g.fillRect((o.x - hx + R) * s - 2, (o.y - hy + R) * s - 2, s + 4, s + 4);
    }
    // Крысы рядом — красные точки, как на радаре.
    g.fillStyle = '#ff5a4a';
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || m.mode === 'sleep') continue;
      const mx = Math.floor(m.x) - hx + R;
      const my = Math.floor(m.y) - hy + R;
      if (mx < 0 || my < 0 || mx >= N || my >= N) continue;
      g.fillRect(mx * s, my * s, s, s);
    }
    g.fillStyle = '#1c130c';
    g.fillRect(R * s - 3, R * s - 3, s + 6, s + 6);
    g.fillStyle = '#ffffff';
    g.fillRect(R * s - 1, R * s - 1, s + 2, s + 2);
  };

  // ---- События боя → звук, вибрация, надписи ------------------------------

  const onEvents = (sim: Sim, events: SimEvent[]) => {
    const now = performance.now();
    for (const e of events) {
      switch (e.t) {
        case 'swing':
          swordSwing(e.step, e.heavy);
          coachMark('attack');
          break;
        case 'hit':
          swordHit(e.crit, e.boss);
          if (e.crit) tapMedium();
          else tapLight();
          break;
        case 'kill':
          ratDie(e.mob === 'fatrat' || e.mob === 'king' || e.mob === 'kinglet');
          if (e.mob === 'goldrat') {
            coinDing();
            coinDing(0.08);
            note('Золотая крыса — мешок монет!');
          }
          if (e.albino) say('АЛЬБИНОС', 'редкая крыса — добыча ×10', 'gold', 1800);
          else if (e.elite) note('Вожак стаи повержен');
          break;
        case 'hurt':
          heroHurt();
          tapMedium();
          flashHurt();
          if (!coach.current.dashAt) coach.current.dashAt = Date.now();
          break;
        case 'die':
          break;
        case 'pick':
          pickUp(e.what);
          if (!coach.current.bagAt) coach.current.bagAt = Date.now();
          if (e.what === 'key') playTotem(sackRef.current);
          if (e.what === 'crown') say('КОРОНА', 'трофей Крысиного короля', 'gold', 2200);
          break;
        case 'full':
          if (now - lastFull.current > 3000) {
            lastFull.current = now;
            bagFull();
            notifyWarning();
            note('Рюкзак полон — неси добычу к лифту');
          }
          break;
        case 'dash':
          dashWhoosh();
          coachMark('dash');
          break;
        case 'dodge':
          perfectDodge();
          tapMedium();
          say('УКЛОН', 'следующий удар — крит', 'dodge', 900);
          break;
        case 'boom':
          boom(e.r > 0 ? 2 : 1);
          tapMedium();
          break;
        case 'emerge':
        case 'squeak':
          if (now - lastSqueak.current > 180) {
            lastSqueak.current = now;
            ratSqueak(e.t === 'emerge' ? 0 : 1);
          }
          break;
        case 'break':
          if (e.kind === 'crack') {
            boom(1);
            note('Стена осыпалась — проход открыт');
          } else crateBreak();
          break;
        case 'cart':
          if (now - lastCart.current > 400) {
            lastCart.current = now;
            cartRoll(e.v);
          }
          break;
        case 'clank':
          bedrockClink();
          break;
        case 'level': {
          levelUp();
          notifySuccess();
          say(`УРОВЕНЬ ${e.level}`, 'здоровье и урон выросли', 'gold', 1800);
          // Новый уровень — сильнее сразу, прямо в бою.
          const st = useFinanceStore.getState();
          const hpK = sim.hero.hp / sim.stats.maxHp;
          sim.stats = heroOf({ gear: st.dungeon.gear, xp: sim.xp }, st.prison);
          sim.hero.hp = Math.min(sim.stats.maxHp, Math.max(sim.hero.hp, hpK * sim.stats.maxHp));
          break;
        }
        case 'eat':
          eatChomp();
          coachMark('eat');
          break;
        case 'rumble':
          deepRumble();
          tapMedium();
          if (e.what === 'horde') say('ОРДА', 'крысы идут стаей — к стене спиной', 'danger', 1800);
          else note('Вагонетка сорвалась!');
          break;
        case 'area': {
          const a = areaOf(e.area);
          say(a.name, a.lead);
          save();
          break;
        }
        case 'boss':
          if (e.what === 'wake') {
            kingRoar();
            gateSlam();
            notifyWarning();
            say(BOSSES.king.name.toUpperCase(), 'ворота закрылись', 'danger', 2600);
          } else if (e.what === 'split') {
            kingRoar();
            say('КОРОЛЬ РАСКОЛОЛСЯ', 'два принца — бей по очереди', 'danger', 2000);
          } else if (e.what === 'dead') {
            jackpotFanfare();
            notifySuccess();
            say('КОРОЛЬ ПАЛ', 'сундук, корона и дорога дальше', 'gold', 3000);
            save();
          } else if (e.what === 'reset') {
            gateSlam();
            note('Король уполз в логово — ворота открыты');
          } else if (e.what === 'roll') deepRumble();
          else if (e.what === 'whip') swordSwing(2, true);
          else if (e.what === 'summon') {
            ratSqueak(0);
            ratSqueak(1);
          }
          break;
        case 'streak':
          streakUp(e.tier);
          tapMedium();
          say(
            streakName(e.tier).toUpperCase(),
            `серия ${sim.streak} — добыча больше`,
            'streak',
            1300,
          );
          break;
        case 'skill':
          coachMark('spin');
          swordSwing(2, true);
          boom(1);
          tapMedium();
          break;
        case 'gold':
          coinDing();
          note('Золотая крыса! Догони — убежит в нору');
          break;
        case 'fuse':
          fuseTick();
          break;
        case 'charge':
          selectionChanged();
          break;
        default:
          break;
      }
      if (e.t === 'die' && !ended.current) {
        ended.current = true;
        setDying(true);
        heroDeath();
        notifyWarning();
        setTimeout(() => {
          const s2 = simRef.current ?? sim;
          const lost = useFinanceStore
            .getState()
            .dungeonDie(snapshot(s2), takeDelta(s2), fogNow(s2));
          onEnd({
            kind: 'dead',
            lost: lost ?? {
              meat: 0,
              meatValue: 0,
              coins: 0,
              tokens: 0,
              keys: 0,
              mats: {},
              killed: s2.killed,
              ms: 0,
              full: false,
            },
          });
        }, 1400);
      }
    }
  };

  const coachMark = (k: CoachStep) => {
    const c = coach.current;
    if (c.done.has(k)) return;
    c.done.add(k);
    coachSave(c.done);
  };

  const flashHurt = () => {
    const el = hurtRef.current;
    if (!el) return;
    try {
      el.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
    } catch {
      /* не страшно */
    }
  };

  // ---- Пальцы ------------------------------------------------------------

  const STICK_R = 46;

  const onRootDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    primeAudio();
    if (paused.current || ended.current) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Левая часть экрана — джойстик там, где коснулся.
    if (x < rect.width * 0.55 && !stick.current) {
      stick.current = { id: e.pointerId, x, y };
      const s = stickRef.current;
      if (s) {
        s.style.transform = `translate(${x - 60}px, ${y - 60}px)`;
        s.classList.remove('is-idle');
        s.classList.add('is-on');
      }
      if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* нет захвата — и ладно */
      }
      return;
    }
    // Правая часть — тап по крысе: цель и удар в неё.
    const sim = simRef.current;
    const r = rendRef.current;
    if (!sim || !r) return;
    const w = r.toWorld(x, y);
    let best: Sim['mobs'][number] | null = null;
    let bd = 1.4;
    for (const m of sim.mobs) {
      if (m.mode === 'dying') continue;
      const d = Math.hypot(m.x - w.x, m.y - 0.3 - w.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) {
      input.current.lock = best.id;
      input.current.aim = { x: best.x - sim.hero.x, y: best.y - sim.hero.y };
      input.current.attack = true;
    }
  };

  const onRootMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let dx = e.clientX - rect.left - s.x;
    let dy = e.clientY - rect.top - s.y;
    const len = Math.hypot(dx, dy);
    // Палец ушёл дальше края — основа едет за ним (как в Brawl Stars).
    if (len > STICK_R * 1.6) {
      const k = (len - STICK_R * 1.6) / len;
      s.x += dx * k;
      s.y += dy * k;
      dx -= dx * k;
      dy -= dy * k;
      if (stickRef.current)
        stickRef.current.style.transform = `translate(${s.x - 60}px, ${s.y - 60}px)`;
    }
    const l2 = Math.hypot(dx, dy);
    const k = l2 > STICK_R ? STICK_R / l2 : 1;
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const mag = Math.min(1, l2 / STICK_R);
    // Мёртвая зона: дрожь пальца не двигает героя.
    const m = mag < 0.14 ? 0 : (mag - 0.14) / 0.86;
    input.current.mx = l2 > 0 ? (dx / l2) * m : 0;
    input.current.my = l2 > 0 ? (dy / l2) * m : 0;
  };

  const onRootUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    stick.current = null;
    input.current.mx = 0;
    input.current.my = 0;
    parkStick();
  };

  // Удар: тап — удар серии, держать — тяжёлый, свайп с кнопки — удар туда.
  const atkDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    primeAudio();
    if (paused.current) return;
    atk.current = { id: e.pointerId, x: e.clientX, y: e.clientY, swiped: false };
    input.current.attack = true;
    input.current.attackHeld = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ничего */
    }
  };
  const atkMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const a = atk.current;
    if (!a || a.id !== e.pointerId || a.swiped) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.hypot(dx, dy) > 30) {
      a.swiped = true;
      input.current.aim = { x: dx, y: dy };
      input.current.attack = true;
      input.current.attackHeld = false;
    }
  };
  const atkUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const a = atk.current;
    if (!a || a.id !== e.pointerId) return;
    atk.current = null;
    input.current.attackHeld = false;
  };
  const press = (k: 'dash' | 'skill' | 'eat') => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    primeAudio();
    if (paused.current) return;
    input.current[k] = true;
  };

  // Клавиатура — для стенда и планшета с клавиатурой.
  useEffect(() => {
    const keys = new Set<string>();
    const axis = () => {
      const i = input.current;
      const x =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const y =
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0) -
        (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      i.mx = x / l;
      i.my = y / l;
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (paused.current) return;
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        axis();
      } else if ((k === 'j' || k === ' ') && !e.repeat) {
        input.current.attack = true;
        input.current.attackHeld = true;
      } else if (k === 'k' || k === 'shift') input.current.dash = true;
      else if (k === 'l') input.current.skill = true;
      else if (k === 'q') input.current.eat = true;
      else if (k === 'e') actNear();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      axis();
      if (k === 'j' || k === ' ') input.current.attackHeld = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Контекстное действие ------------------------------------------------

  const actNear = () => {
    const sim = simRef.current;
    if (!sim || paused.current) return;
    const st = useFinanceStore.getState();
    const u = usableNear(sim, st.prison.items.prop);
    if (!u) return;
    tapLight();
    if (u.kind === 'lift') {
      setLiftArea(u.obj.area);
      setSheet('lift');
      return;
    }
    if (u.kind === 'mine') {
      const id = (u.obj.ref ?? 'pyrite1') as DeepMineId;
      if (!(id in DEEP_MINES)) return;
      save();
      setMine({ id, obj: u.obj });
      return;
    }
    if (u.kind === 'board') {
      setSheet('board');
      return;
    }
    if (u.kind === 'plaque') {
      setSheet('plaque');
      return;
    }
    if (u.kind === 'seal') {
      if (!st.dungeonSpendProp()) {
        note('Нужна крепь — её делают на лесопилке в лесу');
        return;
      }
      if (interact(sim, u)) {
        crateBreak();
        note('Нора заколочена крепью');
      }
      return;
    }
    if (interact(sim, u)) {
      if (u.kind === 'light') {
        liftClank();
        note('Фонарь горит — свет держит крыс поодаль');
      } else if (u.kind === 'grate') {
        gateSlam();
        say('КОРОТКИЙ ПУТЬ', 'решётка открыта навсегда', 'area', 1800);
      } else if (u.kind === 'secret') {
        coinDing();
        coinDing(0.06);
        say('ТАЙНИК', 'монеты, токены и ключ', 'gold', 1800);
      }
      save();
    }
  };

  // ---- Подъём клетью ----------------------------------------------------

  const extract = () => {
    const sim = simRef.current;
    if (!sim || ended.current) return;
    ended.current = true;
    paused.current = true;
    liftClank();
    const exit = useFinanceStore
      .getState()
      .dungeonExtract(snapshot(sim), takeDelta(sim), fogNow(sim));
    if (exit) onEnd({ kind: 'extract', exit });
  };

  // Выход из шахты: сколько стай собралось у входа — столько ждёт снаружи.
  const leaveMine = (packs: number) => {
    const sim = simRef.current;
    const m = mine;
    setMine(null);
    if (!sim || !m) return;
    if (packs > 0) {
      packAtMine(sim, m.obj, packs);
      say(
        'У ВХОДА ЖДУТ',
        packs > 1 ? `шумел — собралось ${packs} стаи` : 'шумел — собралась стая',
        'danger',
        1800,
      );
    }
    save();
  };

  const d = useFinanceStore((s) => s.dungeon);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const econ = econOf(prison);
  const u = hud?.use ?? null;
  const skillReady = (hud?.skill ?? 0) >= 1;
  const stop = (e: ReactPointerEvent) => e.stopPropagation();

  // Палец-подсказка встаёт над своей кнопкой: мерим её на экране.
  const [hintAt, setHintAt] = useState<{ x: number; y: number; r: number } | null>(null);
  const step = hud?.coach ?? null;
  useEffect(() => {
    if (!step || sheet || mine) {
      setHintAt(null);
      return;
    }
    const target =
      step === 'move'
        ? stickRef.current
        : step === 'attack'
          ? atkRef.current
          : step === 'bag'
            ? sackRef.current
            : step === 'dash'
              ? dashRef.current
              : step === 'spin'
                ? spinRef.current
                : eatRef.current;
    const root = rootRef.current;
    if (!target || !root) return;
    const a = target.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    setHintAt({
      x: a.left - b.left + a.width / 2,
      y: a.top - b.top + a.height / 2,
      r: Math.max(a.width, a.height) / 2 + 6,
    });
  }, [step, sheet, mine]);

  return (
    <div
      className={`dg gx${dying ? ' is-dying' : ''}${lowHp ? ' is-low' : ''}`}
      ref={rootRef}
      onPointerDown={onRootDown}
      onPointerMove={onRootMove}
      onPointerUp={onRootUp}
      onPointerCancel={onRootUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas className="dg__canvas" ref={canvasRef} />
      <div className="dg__hurt" ref={hurtRef} />
      <div className="dg__low" />

      {/* Табло: пауза, здоровье и уровень, рюкзак, карта. */}
      <div className="dgx-top" onPointerDown={stop}>
        <button
          type="button"
          className="gx-round gx-round--steel dgx-pause"
          aria-label="Пауза"
          onClick={() => {
            tapLight();
            setSheet('pause');
          }}
        >
          <KIcon name="pause" />
        </button>
        <div className="dgx-vitals">
          <div className="dgx-hp">
            <GxIcon name="heart" className="dgx-hp__icon" />
            <GxBar
              value={hud ? hud.hp / hud.maxHp : 1}
              label={hud ? `${Math.ceil(hud.hp)} / ${hud.maxHp}` : ''}
            />
          </div>
          <div className="dgx-lv">
            <span className="gx-hex gx-hex--dark">{hud?.level ?? 1}</span>
            <GxBar value={hud?.xp ?? 0} tone="gold" thin />
          </div>
          {hud && (hud.coins > 0 || hud.tokens > 0 || hud.keys > 0) && (
            <div className="dgx-loot">
              {hud.coins > 0 && (
                <span>
                  <CoinIcon size={12} /> {fmt(hud.coins)}
                </span>
              )}
              {hud.tokens > 0 && (
                <span>
                  <TokenIcon size={12} /> {hud.tokens}
                </span>
              )}
              {hud.keys > 0 && (
                <span>
                  <KeyIcon size={12} /> {hud.keys}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          ref={sackRef}
          className={`gx-round gx-round--grey dgx-bag${hud && hud.sackN >= hud.cap ? ' is-full' : ''}`}
          aria-label="Рюкзак"
          onClick={() => {
            tapLight();
            if (coach.current.bagAt) {
              coach.current.done.add('bag');
              coachSave(coach.current.done);
            }
            setSheet('inv');
          }}
        >
          <GxIcon name="backpack" />
          <b className="dgx-bag__n">
            {hud?.sackN ?? 0}/{hud?.cap ?? 0}
          </b>
          {hud?.up && <span className="gx-badge gx-badge--gold">!</span>}
          {hud && hud.smell > 0 && (
            <em className="dgx-bag__smell">
              <GxIcon name="rat" size={11} />+{Math.round(hud.smell * 100)}%
            </em>
          )}
        </button>
        <button
          type="button"
          className="dgx-mini"
          aria-label="Карта"
          onClick={() => {
            tapLight();
            setSheet('map');
          }}
        >
          <canvas ref={mapRef} />
        </button>
      </div>

      {hud?.bossHp != null && (
        <div className="dgx-boss">
          <GxIcon name="crown" />
          <b>{BOSSES.king.name}</b>
          <GxBar value={hud.bossHp} />
        </div>
      )}
      {hud?.plaque != null && hud.bossHp == null && (
        <div className="gx-panel gx-panel--wood dgx-card">
          <GxIcon name="crown" size={28} />
          <span>
            <b>Логово пусто</b>
            <i>
              {hud.plaque > 0
                ? `король вернётся через ${clock(hud.plaque)}`
                : 'король вот-вот вернётся'}
            </i>
          </span>
        </div>
      )}
      {hud?.sign && hud.plaque == null && hud.bossHp == null && (
        <div key={hud.sign.id} className="gx-panel gx-panel--wood dgx-card dgx-sign">
          {hud.sign.rows.map((r) => (
            <div key={r.label} className="dgx-sign__row">
              <GxIcon name={r.icon} size={22} />
              <span>{r.label}</span>
              <KIcon name="arrowUp" size={18} style={{ transform: `rotate(${r.angle}deg)` }} />
              <b>{r.dist} м</b>
            </div>
          ))}
        </div>
      )}

      {banner && (
        <div key={banner.key} className={`dg-banner dg-banner--${banner.tone}`}>
          <b>{banner.big}</b>
          {banner.small && <span>{banner.small}</span>}
        </div>
      )}
      {toast && (
        <div key={toast.key} className="dg-toast">
          {toast.text}
        </div>
      )}

      <div className="dg-stick is-idle" ref={stickRef} aria-hidden="true">
        <i ref={knobRef} />
      </div>

      {/* Кнопки под правый большой палец. */}
      <div className="dgx-pad" onPointerDown={stop}>
        {u && (
          <button
            type="button"
            className={`gx-btn dgx-use dgx-use--${u.kind}`}
            onClick={(e) => {
              e.stopPropagation();
              actNear();
            }}
          >
            <GxIcon name={USE_ICON[u.kind]} />
            {u.label}
          </button>
        )}
        <button
          type="button"
          ref={eatRef}
          className={`gx-round gx-round--green dgx-eat${hud?.eat ? '' : ' is-off'}`}
          aria-label="Съесть мясо"
          onPointerDown={press('eat')}
        >
          <GxIcon name="eat" />
          {(hud?.meat ?? 0) > 0 && <span className="gx-badge">{hud?.meat}</span>}
        </button>
        <button
          type="button"
          ref={spinRef}
          className={`gx-round gx-round--dark dgx-spin${skillReady ? ' is-ready' : ''}`}
          aria-label="Вихрь"
          style={{ '--fill': hud?.skill ?? 0 } as CSSProperties}
          onPointerDown={press('skill')}
        >
          <i className="dgx-spin__ring" />
          <GxIcon name="spin" />
        </button>
        <button
          type="button"
          ref={dashRef}
          className={`gx-round gx-round--steel dgx-dash${hud?.dash === false ? ' is-off' : ''}`}
          aria-label="Рывок"
          onPointerDown={press('dash')}
        >
          <GxIcon name="dash" />
        </button>
        <button
          type="button"
          ref={atkRef}
          className="gx-round dgx-atk"
          aria-label="Удар"
          onPointerDown={atkDown}
          onPointerMove={atkMove}
          onPointerUp={atkUp}
          onPointerCancel={atkUp}
        >
          <GxIcon name="sword" />
        </button>
      </div>

      {hintAt && step && (
        <>
          <i
            className="gx-hint-ring"
            style={{
              left: hintAt.x - hintAt.r,
              top: hintAt.y - hintAt.r,
              width: hintAt.r * 2,
              height: hintAt.r * 2,
            }}
          />
          <div
            className={`gx-hint dgx-hint dgx-hint--${step}`}
            style={{ left: hintAt.x, top: hintAt.y }}
          >
            <GxIcon name="pointing" />
            <b>{COACH_TEXT[step]}</b>
          </div>
        </>
      )}

      {dying && (
        <div className="dg-dying">
          <GxIcon name="skull" size={64} />
          <b>Ты погиб</b>
        </div>
      )}

      {mine && <DungeonMine id={mine.id} sim={simRef.current!} onExit={leaveMine} onToast={note} />}

      {sheet === 'pause' && (
        <GxModal title="Пауза" onClose={() => setSheet(null)}>
          <SackList sack={simRef.current?.sack} econ={econ} sold={marketSold(d, Date.now())} />
          <div className="dgx-menu">
            <AudioToggles className="dgx-menu__audio" />
            <button
              className="gx-btn gx-btn--red gx-btn--big gx-btn--block"
              onClick={() => setSheet(null)}
            >
              <KIcon name="arrowRight" />
              Продолжить
            </button>
            <div className="dgx-menu__row">
              <button className="gx-btn" onClick={() => setSheet('inv')}>
                <GxIcon name="backpack" />
                Рюкзак
              </button>
              <button className="gx-btn" onClick={() => setSheet('map')}>
                <GxIcon name="map" />
                Карта
              </button>
              <button className="gx-btn" onClick={() => setSheet('board')}>
                <GxIcon name="joystick" />
                Кнопки
              </button>
            </div>
            <button
              className="gx-btn gx-btn--grey gx-btn--block"
              onClick={() => {
                save();
                setSheet(null);
                onLeave();
              }}
            >
              <KIcon name="exitLeft" />
              Выйти из игры
              <small>вернёшься на это же место</small>
            </button>
          </div>
        </GxModal>
      )}

      {sheet === 'inv' && simRef.current && (
        <DungeonInventory
          sim={simRef.current}
          onClose={() => setSheet(null)}
          onEat={() => {
            setSheet(null);
            input.current.eat = true;
          }}
          onDrop={(id, n) => {
            const sim = simRef.current;
            if (!sim) return;
            if (dropFromSack(sim, id, n) > 0) crateBreak();
            pushHud(sim);
          }}
          onSave={save}
          onGear={() => {
            // Заточил внизу — сильнее сразу, как при новом уровне; нашил
            // карман — ряд открыт сразу. И сразу запись: рюкзак уже отдал
            // материалы, перезапуск не должен их вернуть.
            const sim = simRef.current;
            if (!sim) return;
            const st = useFinanceStore.getState();
            const hpK = sim.hero.hp / sim.stats.maxHp;
            sim.stats = heroOf({ gear: st.dungeon.gear, xp: sim.xp }, st.prison);
            sim.hero.hp = Math.min(sim.stats.maxHp, Math.max(sim.hero.hp, hpK * sim.stats.maxHp));
            sim.sackLevel = st.dungeon.sackLevel;
            save();
            pushHud(sim);
          }}
        />
      )}

      {sheet === 'lift' && (
        <LiftSheet
          area={liftArea}
          repaired={d.lifts.includes(liftArea)}
          econ={econ}
          balance={balance}
          canRepair={(cost) => canPay(d, cost, balance)}
          stash={d.stash}
          sack={simRef.current?.sack}
          sold={marketSold(d, Date.now())}
          onRepair={() => {
            if (useFinanceStore.getState().dungeonLiftRepair(liftArea)) {
              liftClank();
              notifySuccess();
              note('Лифт починен — теперь можно спускаться прямо сюда');
            }
          }}
          onUp={() => {
            setSheet(null);
            extract();
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'board' && (
        <GxModal title="Управление" onClose={() => setSheet(null)}>
          <Controls />
        </GxModal>
      )}

      {sheet === 'plaque' && (
        <GxModal title="Логово короля" kind="wood" onClose={() => setSheet(null)}>
          <PlaqueBody />
        </GxModal>
      )}

      {sheet === 'map' && simRef.current && (
        <GxModal title="Карта" onClose={() => setSheet(null)}>
          <BigMap sim={simRef.current} />
        </GxModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Окна.
// ---------------------------------------------------------------------------

/** Что в рюкзаке и сколько за это дадут наверху — картинками. */
function SackList({
  sack,
  econ,
  sold,
}: {
  sack: Sim['sack'] | undefined;
  econ: number;
  sold: number;
}) {
  if (!sack) return null;
  const mv = meatValue(sack, econ, sold);
  const mats = Object.entries(sack.mats) as [MatId, number][];
  const empty = !mv.pieces && !mats.length && !sack.coins && !sack.tokens && !sack.keys;
  if (empty)
    return (
      <div className="dgx-sack dgx-sack--empty">
        <GxIcon name="backpack" size={26} />
        Рюкзак пока пуст
      </div>
    );
  return (
    <div className="dgx-sack">
      {mv.pieces > 0 && (
        <span title="Мясо">
          <img src={itemUrl('meat')} alt="Мясо" />
          <b>{mv.pieces}</b>
          <i>
            ≈{fmt(mv.value)} <CoinIcon size={10} />
          </i>
        </span>
      )}
      {mats.map(([id, n]) => (
        <span key={id} title={MATS[id].name}>
          <img src={itemUrl(id)} alt={MATS[id].name} />
          <b>{n}</b>
        </span>
      ))}
      {sack.coins > 0 && (
        <span title="Монеты">
          <CoinIcon size={24} />
          <b>{fmt(sack.coins)}</b>
        </span>
      )}
      {sack.tokens > 0 && (
        <span title="Токены">
          <TokenIcon size={24} />
          <b>{sack.tokens}</b>
        </span>
      )}
      {sack.keys > 0 && (
        <span title="Ключи">
          <KeyIcon size={24} />
          <b>{sack.keys}</b>
        </span>
      )}
    </div>
  );
}

function LiftSheet({
  area,
  repaired,
  econ,
  balance,
  canRepair,
  stash,
  sack,
  sold,
  onRepair,
  onUp,
  onClose,
}: {
  area: AreaId;
  repaired: boolean;
  econ: number;
  balance: number;
  canRepair: (c: ReturnType<typeof liftCost>) => boolean;
  stash: Partial<Record<MatId, number>>;
  sack: Sim['sack'] | undefined;
  sold: number;
  onRepair: () => void;
  onUp: () => void;
  onClose: () => void;
}) {
  const a = areaOf(area);
  if (!repaired) {
    const cost = liftCost(area, econ);
    const ok = canRepair(cost);
    return (
      <GxModal title="Лифт сломан" kind="iron" onClose={onClose}>
        <div className="dgx-lift">
          <GxIcon name="lift" size={56} />
          <p>Почини — и сможешь спускаться сразу в «{a.name}» и подниматься отсюда с добычей.</p>
        </div>
        <div className="gx-panel dgx-cost">
          <div className={`gx-row${balance >= cost.coins ? '' : ' is-short'}`}>
            <CoinIcon size={26} />
            <span>Монеты</span>
            <b>{fmt(cost.coins)}</b>
          </div>
          <div className={`gx-row${(stash.skin ?? 0) >= (cost.mats.skin ?? 0) ? '' : ' is-short'}`}>
            <img src={itemUrl('skin')} alt="" />
            <span>Шкурки со склада</span>
            <b>
              {stash.skin ?? 0} / {cost.mats.skin}
            </b>
          </div>
        </div>
        <button
          className="gx-btn gx-btn--red gx-btn--big gx-btn--block dgx-cta"
          disabled={!ok}
          onClick={onRepair}
        >
          <GxIcon name="hammer" />
          Починить
        </button>
      </GxModal>
    );
  }
  return (
    <GxModal title="Лифт" kind="iron" onClose={onClose}>
      <SackList sack={sack} econ={econ} sold={sold} />
      <button className="gx-btn gx-btn--red gx-btn--big gx-btn--block dgx-cta" onClick={onUp}>
        <KIcon name="arrowUp" />
        Подняться с добычей
      </button>
      <button className="gx-btn gx-btn--block dgx-cta2" onClick={onClose}>
        Остаться внизу
      </button>
    </GxModal>
  );
}

/** Кнопки игры картинками: что нажать — и что будет. */
function Controls() {
  const rows: [GxIconName, string, string][] = [
    ['move', 'Левая половина экрана', 'веди пальцем — идти'],
    ['sword', 'Удар', 'жми — серия; держи — сильный удар'],
    ['dash', 'Рывок', 'проскакивает сквозь укус'],
    ['spin', 'Вихрь', 'копится от ударов, бьёт всех вокруг'],
    ['eat', 'Мясо', 'лечит; запах мяса зовёт крыс'],
    ['backpack', 'Рюкзак', 'добыча и улучшение снаряжения'],
    ['lift', 'Лифт', 'только им можно вынести добычу'],
  ];
  return (
    <div className="dgx-controls">
      {rows.map(([icon, name, what]) => (
        <div key={name} className="gx-row">
          <span className="dgx-controls__ico">
            <GxIcon name={icon} size={26} />
          </span>
          <span>
            <b>{name}</b>
            <i>{what}</i>
          </span>
        </div>
      ))}
    </div>
  );
}

function PlaqueBody() {
  const d = useFinanceStore((s) => s.dungeon);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const b = d.bosses.king;
  const ready = (b?.at ?? 0) + BOSSES.king.restMs;
  const home = ready <= now;
  return (
    <div className="dgx-lair">
      <GxIcon name="crown" size={64} className={home ? 'is-home' : ''} />
      <b>{home ? 'Король в логове' : 'Логово пусто'}</b>
      <span>
        {home ? 'Войдёшь — ворота закроются за тобой' : `вернётся через ${clock(ready - now)}`}
      </span>
      <div className="dgx-lair__loot">
        <img src={itemUrl('crown')} alt="Корона" />
        <img src={itemUrl('skin')} alt="Шкурки" />
        <TokenIcon size={24} />
        <CoinIcon size={24} />
        <KeyIcon size={24} />
      </div>
      {b && b.kills > 0 && <i>Побеждён: {b.kills}</i>}
    </div>
  );
}

/** Вся карта, разведанное — светлым. Масштаб — по ширине окна. */
function BigMap({ sim }: { sim: Sim }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const W = sim.world.w;
    const H = sim.world.h;
    const s = 4;
    c.width = W * s;
    c.height = H * s;
    g.fillStyle = '#1c130c';
    g.fillRect(0, 0, c.width, c.height);
    for (const band of sim.world.bands) {
      const bits = sim.fog[band.def.id];
      if (!bits) continue;
      for (let ly = 0; ly < band.h; ly++)
        for (let x = 0; x < W; x++) {
          if (!fogGet(bits, x, ly, W)) continue;
          const y = band.top + ly;
          const t = sim.tiles[y * W + x];
          const open = walkableTile(t) || t === Tile.Lift || t === Tile.Gate || t === Tile.Grate;
          g.fillStyle = open ? '#e8d0ac' : '#6d4b27';
          g.fillRect(x * s, y * s, s, s);
        }
    }
    g.font = 'bold 22px GxRubik, system-ui, sans-serif';
    g.textAlign = 'center';
    for (const band of sim.world.bands) {
      g.fillStyle = 'rgba(255,241,210,0.7)';
      g.fillText(band.def.name, (W * s) / 2, band.top * s + 28);
      g.fillStyle = 'rgba(255,241,210,0.2)';
      g.fillRect(0, band.top * s, W * s, 2);
    }
    for (const o of sim.world.objs) {
      const band = bandAt(sim.world, o.y);
      const bits = sim.fog[band.def.id];
      if (!bits || !fogGet(bits, o.x, o.y - band.top, W)) continue;
      const col =
        o.kind === 'lift'
          ? '#5ca2e0'
          : o.kind === 'mine'
            ? '#ffd257'
            : o.kind === 'boss'
              ? '#e2665b'
              : null;
      if (!col) continue;
      g.fillStyle = '#3d2a16';
      g.fillRect(o.x * s - 5, o.y * s - 5, s + 10, s + 10);
      g.fillStyle = col;
      g.fillRect(o.x * s - 3, o.y * s - 3, s + 6, s + 6);
    }
    g.fillStyle = '#3d2a16';
    g.beginPath();
    g.arc(sim.hero.x * s, sim.hero.y * s, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(sim.hero.x * s, sim.hero.y * s, 6, 0, Math.PI * 2);
    g.fill();
    // Окно открывается на герое.
    const wrap = c.parentElement;
    if (wrap) wrap.scrollTop = Math.max(0, (sim.hero.y * s * wrap.clientWidth) / c.width - 160);
  }, [sim]);
  return (
    <>
      <div className="dgx-bigmap">
        <canvas ref={ref} />
      </div>
      <div className="dgx-bigmap__legend">
        <span>
          <i style={{ background: '#fff' }} /> ты
        </span>
        <span>
          <i style={{ background: '#5ca2e0' }} /> лифт
        </span>
        <span>
          <i style={{ background: '#ffd257' }} /> шахта
        </span>
        <span>
          <i style={{ background: '#e2665b' }} /> логово
        </span>
      </div>
    </>
  );
}
