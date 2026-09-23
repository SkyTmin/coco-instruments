// Вылазка: канва мира, пальцы, табло. Правила боя — `lib/dungeon-sim.ts`,
// картинка — `lib/dungeon-render.ts`; здесь только то, что связывает их с
// человеком: джойстик, кнопки, звук, вибрация, листы клети и таблички, запись
// в стор. React перерисовывает только табло и только когда оно поменялось:
// сам кадр рисуется в цикле `requestAnimationFrame` мимо React.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Sheet } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, TokenIcon } from '@/components/PrisonCamp';
import { DungeonMine } from '@/components/DungeonMine';
import { DungeonInventory } from '@/components/DungeonInventory';
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
} from '@/lib/dungeon';
import type { AreaId, DeepMineId, Haul, MatId } from '@/lib/dungeon';
import {
  createSim,
  dropFromSack,
  fogOf,
  heroStuck,
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
import type { World } from '@/lib/dungeon-world';
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
}

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
    say(a.name, run.x >= 0 ? 'Вылазка продолжается' : a.lead);
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

  // Пауза, пока открыт любой лист или шахта. «Назад» Telegram — сперва пауза.
  const sheetOpen = useRef(false);
  useEffect(() => {
    sheetOpen.current = sheet !== null || mine !== null;
    paused.current = sheetOpen.current || ended.current;
    if (sheetOpen.current) {
      input.current = { ...NO_INPUT };
      stick.current = null;
      stickRef.current?.classList.remove('is-on');
    }
  }, [sheet, mine]);
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
    const W = sim.world.w;
    const rows = 44;
    const s = 2;
    if (c.width !== W * s) {
      c.width = W * s;
      c.height = rows * s;
    }
    g.clearRect(0, 0, c.width, c.height);
    const hy = Math.floor(sim.hero.y);
    const y0 = Math.max(0, Math.min(sim.world.h - rows, hy - Math.floor(rows / 2)));
    for (let y = y0; y < y0 + rows; y++) {
      const band = bandAt(sim.world, y);
      const bits = sim.fog[band.def.id];
      if (!bits) continue;
      for (let x = 0; x < W; x++) {
        if (!fogGet(bits, x, y - band.top, W)) continue;
        const t = sim.tiles[y * W + x];
        const open = walkableTile(t) || t === Tile.Lift || t === Tile.Gate || t === Tile.Grate;
        g.fillStyle = open
          ? t === Tile.RailV || t === Tile.RailH
            ? 'rgba(170,160,150,0.8)'
            : 'rgba(190,168,140,0.55)'
          : 'rgba(60,48,40,0.7)';
        g.fillRect(x * s, (y - y0) * s, s, s);
      }
    }
    for (const o of sim.world.objs) {
      if (o.y < y0 || o.y >= y0 + rows) continue;
      const band = bandAt(sim.world, o.y);
      const bits = sim.fog[band.def.id];
      if (!bits || !fogGet(bits, o.x, o.y - band.top, W)) continue;
      const col =
        o.kind === 'lift'
          ? '#6fe0ff'
          : o.kind === 'mine'
            ? '#ffd24a'
            : o.kind === 'boss'
              ? '#ff4a3a'
              : o.kind === 'secret' && !sim.props.find((p) => p.obj === o)?.on
                ? null
                : null;
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(o.x * s - 1, (o.y - y0) * s - 1, s + 2, s + 2);
    }
    // Крысы рядом — красные точки, как на радаре.
    g.fillStyle = '#ff5a4a';
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || m.mode === 'sleep') continue;
      if (Math.hypot(m.x - sim.hero.x, m.y - sim.hero.y) > 9) continue;
      g.fillRect(Math.floor(m.x) * s, (Math.floor(m.y) - y0) * s, s, s);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(Math.floor(sim.hero.x) * s - 1, (hy - y0) * s - 1, s + 2, s + 2);
  };

  // ---- События боя → звук, вибрация, надписи ------------------------------

  const onEvents = (sim: Sim, events: SimEvent[]) => {
    const now = performance.now();
    for (const e of events) {
      switch (e.t) {
        case 'swing':
          swordSwing(e.step, e.heavy);
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
          break;
        case 'die':
          break;
        case 'pick':
          pickUp(e.what);
          if (e.what === 'key') playTotem(sackRef.current);
          if (e.what === 'crown') say('КОРОНА', 'трофей Крысиного короля', 'gold', 2200);
          break;
        case 'full':
          if (now - lastFull.current > 3000) {
            lastFull.current = now;
            bagFull();
            notifyWarning();
            note('Сидор полон — выносить к клети');
          }
          break;
        case 'dash':
          dashWhoosh();
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
    stickRef.current?.classList.remove('is-on');
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
        note('Нечем заколотить: крепь сбивают на лесопилке');
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

  return (
    <div
      className={`dg${dying ? ' is-dying' : ''}${lowHp ? ' is-low' : ''}`}
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

      {/* Табло: здоровье, уровень, сидор, мини-карта. */}
      <div className="dg-top" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="dg-btn dg-btn--pause"
          aria-label="Пауза"
          onClick={() => {
            tapLight();
            setSheet('pause');
          }}
        >
          <i />
          <i />
        </button>
        <div className="dg-vitals">
          <div className="dg-hp">
            <i
              className="dg-hp__ghost"
              style={{ transform: `scaleX(${hud ? hud.hp / hud.maxHp : 1})` }}
            />
            <i
              className="dg-hp__fill"
              style={{ transform: `scaleX(${hud ? hud.hp / hud.maxHp : 1})` }}
            />
            <b>
              {hud ? Math.ceil(hud.hp) : ''} / {hud?.maxHp ?? ''}
            </b>
          </div>
          <div className="dg-xp">
            <em>{hud?.level ?? 1}</em>
            <span>
              <i style={{ transform: `scaleX(${hud?.xp ?? 0})` }} />
            </span>
          </div>
          <button
            type="button"
            ref={sackRef}
            className={`dg-sack${hud && hud.sackN >= hud.cap ? ' is-full' : ''}`}
            onClick={() => {
              tapLight();
              setSheet('inv');
            }}
          >
            <img src={itemUrl('meat')} alt="" />
            <b>
              {hud?.sackN ?? 0}/{hud?.cap ?? 0}
            </b>
            {hud && hud.smell > 0 && (
              <em className="dg-sack__smell" title="Запах мяса манит крыс">
                +{Math.round(hud.smell * 100)}%
              </em>
            )}
            {hud && (hud.coins > 0 || hud.tokens > 0) && (
              <span className="dg-sack__loot">
                {hud.coins > 0 && (
                  <>
                    <CoinIcon size={11} /> {fmt(hud.coins)}
                  </>
                )}
                {hud.tokens > 0 && (
                  <>
                    <TokenIcon size={11} /> {hud.tokens}
                  </>
                )}
                {hud.keys > 0 && (
                  <>
                    <KeyIcon size={11} /> {hud.keys}
                  </>
                )}
              </span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="dg-mini"
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
        <div className="dg-boss">
          <b>{BOSSES.king.name}</b>
          <span>
            <i style={{ transform: `scaleX(${hud.bossHp})` }} />
          </span>
        </div>
      )}
      {hud?.plaque != null && hud.bossHp == null && (
        <div className="dg-plaque">
          <b>Логово пусто</b>
          <span>
            {hud.plaque > 0
              ? `король вернётся через ${clock(hud.plaque)}`
              : 'король вот-вот вернётся'}
          </span>
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

      <div className="dg-stick" ref={stickRef} aria-hidden="true">
        <i ref={knobRef} />
      </div>

      {/* Кнопки под правый большой палец. */}
      <div className="dg-pad" onPointerDown={(e) => e.stopPropagation()}>
        {u && (
          <button
            type="button"
            className={`dg-use dg-use--${u.kind}`}
            onClick={(e) => {
              e.stopPropagation();
              actNear();
            }}
          >
            {u.label}
          </button>
        )}
        <button
          type="button"
          className={`dg-btn dg-btn--eat${hud?.eat ? '' : ' is-off'}`}
          aria-label="Съесть"
          onPointerDown={press('eat')}
        >
          <img src={itemUrl('meat')} alt="" />
          <em>{hud?.meat ?? 0}</em>
        </button>
        <button
          type="button"
          className={`dg-btn dg-btn--skill${skillReady ? ' is-ready' : ''}`}
          aria-label="Вихрь"
          style={{ '--fill': hud?.skill ?? 0 } as CSSProperties}
          onPointerDown={press('skill')}
        >
          <span>ВИХРЬ</span>
        </button>
        <button
          type="button"
          className={`dg-btn dg-btn--dash${hud?.dash === false ? ' is-off' : ''}`}
          aria-label="Рывок"
          onPointerDown={press('dash')}
        >
          <span>РЫВОК</span>
        </button>
        <button
          type="button"
          className="dg-btn dg-btn--atk"
          aria-label="Удар"
          onPointerDown={atkDown}
          onPointerMove={atkMove}
          onPointerUp={atkUp}
          onPointerCancel={atkUp}
        >
          <span>УДАР</span>
        </button>
      </div>

      {dying && (
        <div className="dg-dying">
          <b>Тебя растащили крысы</b>
        </div>
      )}

      {mine && <DungeonMine id={mine.id} sim={simRef.current!} onExit={leaveMine} onToast={note} />}

      {sheet === 'pause' && (
        <Sheet title="Привал" onClose={() => setSheet(null)}>
          <SackList sack={simRef.current?.sack} econ={econ} sold={marketSold(d, Date.now())} />
          <p className="dg-note">
            Добыча в сидоре — твоя, только пока ты жив. Вынести её можно клетью: у клети спуска или
            у починенной. Умрёшь — растащат всё, что несёшь. Убийства, опыт и открытые места
            остаются всегда.
          </p>
          <div className="stack">
            <button className="btn btn--primary btn--block" onClick={() => setSheet(null)}>
              Дальше
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                save();
                setSheet(null);
                onLeave();
              }}
            >
              Наверх без клети — вылазка подождёт внизу
            </button>
          </div>
        </Sheet>
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
              note('Клеть починена — теперь здесь можно спускаться и подниматься');
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
        <Sheet title="Доска у клети" onClose={() => setSheet(null)}>
          <ul className="dg-rules">
            <li>
              <b>Левая половина экрана</b> — ходить: палец ставит джойстик там, где коснулся.
            </li>
            <li>
              <b>УДАР</b> — серия из трёх. Держи — тяжёлый удар, он сбивает замах. Смахни с кнопки —
              удар в ту сторону. Тап по крысе — взять её целью.
            </li>
            <li>
              <b>РЫВОК</b> проходит сквозь укус. Рывок в последний миг перед укусом — время
              замирает, следующий удар — крит.
            </li>
            <li>
              <b>ВИХРЬ</b> копится от ударов: круговой удар по всем вокруг.
            </li>
            <li>Мясо лечит (кнопка с куском), но пахнет: чем больше в сидоре, тем больше крыс.</li>
            <li>Всё, что бьёт, сперва краснеет. Красное на полу — отойди.</li>
            <li>Фонари держат крыс поодаль. Треснувшую стену можно обрушить ударами.</li>
          </ul>
          <button className="btn btn--primary btn--block" onClick={() => setSheet(null)}>
            Понял
          </button>
        </Sheet>
      )}

      {sheet === 'plaque' && (
        <Sheet title="Табличка у логова" onClose={() => setSheet(null)}>
          <PlaqueBody />
          <button className="btn btn--primary btn--block" onClick={() => setSheet(null)}>
            Ясно
          </button>
        </Sheet>
      )}

      {sheet === 'map' && simRef.current && (
        <Sheet title="Карта подземелья" onClose={() => setSheet(null)}>
          <BigMap sim={simRef.current} />
          <button className="btn btn--primary btn--block" onClick={() => setSheet(null)}>
            Закрыть
          </button>
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Листы.
// ---------------------------------------------------------------------------

/** Что в сидоре и сколько за это дадут наверху. */
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
  return (
    <div className="dg-sacklist">
      {empty && <span className="dg-sacklist__empty">Сидор пуст</span>}
      {mv.pieces > 0 && (
        <span>
          <img src={itemUrl('meat')} alt="" /> Мясо: {mv.pieces} шт. ≈ {fmt(mv.value)}{' '}
          <CoinIcon size={12} />
        </span>
      )}
      {mats.map(([id, n]) => (
        <span key={id}>
          <img src={itemUrl(id)} alt="" /> {MATS[id].name}: {n}
        </span>
      ))}
      {sack.coins > 0 && (
        <span>
          <CoinIcon size={14} /> Монеты: {fmt(sack.coins)}
        </span>
      )}
      {sack.tokens > 0 && (
        <span>
          <TokenIcon size={14} /> Токены: {sack.tokens}
        </span>
      )}
      {sack.keys > 0 && (
        <span>
          <KeyIcon size={14} /> Ключи: {sack.keys}
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
      <Sheet title={`Клеть · ${a.name}`} onClose={onClose}>
        <p className="dg-note">
          Трос оборван, лебёдка ржавая. Почини — и эта клеть станет твоей точкой спуска и выхода:
          сюда можно будет спускаться сразу, а не топать от Устья.
        </p>
        <div className="dg-cost">
          <span className={balance >= cost.coins ? '' : 'is-short'}>
            <CoinIcon size={14} /> {fmt(cost.coins)}
          </span>
          <span className={(stash.skin ?? 0) >= (cost.mats.skin ?? 0) ? '' : 'is-short'}>
            <img src={itemUrl('skin')} alt="" /> {cost.mats.skin} шкурок на складе (есть{' '}
            {stash.skin ?? 0})
          </span>
        </div>
        <p className="dg-note dg-note--dim">
          Шкурки берутся со склада наверху — те, что в сидоре, ещё не вынесены.
        </p>
        <div className="stack">
          <button className="btn btn--primary btn--block" disabled={!ok} onClick={onRepair}>
            Починить клеть
          </button>
          <button className="btn btn--ghost btn--block" onClick={onClose}>
            Потом
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Подняться наверх?" onClose={onClose}>
      <SackList sack={sack} econ={econ} sold={sold} />
      <p className="dg-note">
        Мясо сразу уйдёт Барыге, монеты — в кошелёк, материалы — на склад, токены и ключи — в
        каторгу. Вылазка на этом кончится.
      </p>
      <div className="stack">
        <button className="btn btn--primary btn--block" onClick={onUp}>
          Подняться клетью
        </button>
        <button className="btn btn--ghost btn--block" onClick={onClose}>
          Ещё побегаю
        </button>
      </div>
    </Sheet>
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
  return (
    <div className="dg-plaquebody">
      <b>{BOSSES.king.name}</b>
      <p>
        Сорок крыс, сросшихся хвостами. Катится клубком, хлещет хвостами по кругу, зовёт стаю. На
        половине здоровья раскалывается на двух принцев.
      </p>
      <p className="dg-plaquebody__time">
        {ready > now
          ? `Вернётся в логово через ${clock(ready - now)}`
          : 'Сейчас в логове. Ворота закроются за тобой.'}
      </p>
      {b && <p className="dg-note--dim">Повержен раз: {b.kills}</p>}
      <p className="dg-note--dim">
        С него: корона (для перековки во второй комплект), шкурки, токены, монеты и изредка ключ.
      </p>
    </div>
  );
}

/** Вся карта, разведанное — светлым. Масштаб — по ширине листа. */
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
    g.fillStyle = '#0c0908';
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
          g.fillStyle = open ? '#9a8870' : '#3a2e26';
          g.fillRect(x * s, y * s, s, s);
        }
    }
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const band of sim.world.bands) {
      g.fillStyle = 'rgba(255,230,190,0.5)';
      g.fillText(band.def.name, (W * s) / 2, band.top * s + 28);
      g.fillStyle = 'rgba(255,230,190,0.15)';
      g.fillRect(0, band.top * s, W * s, 2);
    }
    for (const o of sim.world.objs) {
      const band = bandAt(sim.world, o.y);
      const bits = sim.fog[band.def.id];
      if (!bits || !fogGet(bits, o.x, o.y - band.top, W)) continue;
      const col =
        o.kind === 'lift'
          ? '#6fe0ff'
          : o.kind === 'mine'
            ? '#ffd24a'
            : o.kind === 'boss'
              ? '#ff4a3a'
              : null;
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(o.x * s - 3, o.y * s - 3, s + 6, s + 6);
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(sim.hero.x * s, sim.hero.y * s, 6, 0, Math.PI * 2);
    g.fill();
    // Лист открывается на герое.
    const wrap = c.parentElement;
    if (wrap) wrap.scrollTop = Math.max(0, (sim.hero.y * s * wrap.clientWidth) / c.width - 160);
  }, [sim]);
  return (
    <div className="dg-bigmap">
      <canvas ref={ref} />
      <div className="dg-bigmap__legend">
        <span>
          <i style={{ background: '#6fe0ff' }} /> клеть
        </span>
        <span>
          <i style={{ background: '#ffd24a' }} /> шахта
        </span>
        <span>
          <i style={{ background: '#ff4a3a' }} /> логово
        </span>
      </div>
    </div>
  );
}
