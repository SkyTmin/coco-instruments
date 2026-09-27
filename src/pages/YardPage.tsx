// Двор каторги (v2.80) — площадь лагеря, по которой ходит герой. Здания —
// двери: вошёл — затемнение и комната, внутри житель; подошёл к нему или
// ткнул в него — окно разговора с портретом, репликой по делу и кнопками,
// которые открывают те же экраны, что раньше открывали кнопки двора
// (кузница, лагерь, Торговец, маршруты). Владелец: «чтобы наш герой мог
// ходить по двору, идти в шахту, подземелье или к чародею».
//
// Правила мира — `lib/hub-sim.ts`, картинка — `lib/hub-render.ts`, реплики —
// `lib/hub-dialog.ts`, сутки — `lib/hub-time.ts`. Здесь — то, что связывает
// их с человеком: пальцы, табло, окна, переходы, запись места. Кадр рисуется
// в цикле `requestAnimationFrame` мимо React; React перерисовывает табло,
// только когда оно поменялось.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameTop, GxBar, GxIcon, GxModal } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, PrisonCamp, TokenIcon, useNow } from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { ForgeScreen } from '@/components/ForgeScreen';
import { BarygaSheet, useYardEvent } from '@/components/YardBits';
import { AudioToggles } from '@/components/AudioToggles';
import { FloatingStick, useFloatingStick } from '@/components/FloatingStick';
import { useFinanceStore } from '@/store';
import { liveEvent, rankLetter, shortMoney, ZONE_TIERS } from '@/lib/prison';
import { eventOf, EVENTS, EVENTS_FROM_RANK } from '@/lib/yard';
import { DUNGEON_UNLOCK_RANK } from '@/lib/dungeon';
import { FOREST_ON } from '@/lib/features';
import { HUB_MAPS, HUB_SPRITES } from '@/lib/hub-maps';
import {
  createHubSim,
  endTalk,
  enterMap,
  HUB_NO_INPUT,
  hitTest,
  nearestUsable,
  placeAtDoor,
  interactNear,
  placeOf,
  stepHub,
  walkTo,
} from '@/lib/hub-sim';
import type { HubDoor, HubEvent, HubInput, HubPlace, HubSim } from '@/lib/hub-sim';
import { HubRenderer, hubImage, hubUrl, preloadHubMap } from '@/lib/hub-render';
import { hubFacts, residentOf } from '@/lib/hub-dialog';
import type { HubAction, HubFacts, HubOption } from '@/lib/hub-dialog';
import { useDungeonSprites } from '@/lib/dungeon-sprites';
import { useGameAudio } from '@/lib/use-game-audio';
import { doorLatch, footstep, primeAudio, softChime, softThud, uiTap } from '@/lib/sound';
import { tapLight } from '@/lib/haptics';
import { registerEscape } from '@/lib/escape-stack';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return t < 60 ? `${t} с` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Шаг мира: длинный кадр режется на куски не длиннее 1/60 с (см. подземелье). */
const STEP = 1 / 60;
/** Затемнение при смене карты — половина уходит в чёрное, половина из него. */
const FADE_MS = 250;
/** Сколько снизу занимают джойстик и кнопки, CSS px. */
const BOTTOM_INSET = 100;
/** Где стоял герой: удобство, не прогресс — пропало, значит встанет у ворот. */
const POS_KEY = 'hub.pos.v1';

function loadPlace(): HubPlace | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<HubPlace>;
    if (
      typeof p.map === 'string' &&
      HUB_MAPS[p.map] &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y)
    )
      return { map: p.map, x: p.x!, y: p.y!, face: (p.face ?? 0) & 3 };
  } catch {
    /* нет хранилища — начнём у ворот */
  }
  return null;
}

function savePlace(p: HubPlace): void {
  try {
    localStorage.setItem(
      POS_KEY,
      JSON.stringify({
        map: p.map,
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
        face: p.face,
      }),
    );
  } catch {
    /* приватное окно — не помним, не беда */
  }
}

/** Где встать при первом входе: у ворот площади (или где есть). */
function firstPlace(): HubPlace | { map: string; at: string } {
  const saved = loadPlace();
  if (saved) return saved;
  if (HUB_MAPS.square) return { map: 'square', at: 'kpp' };
  return { map: Object.keys(HUB_MAPS)[0], at: 'in' };
}

/** Соседние карты — подгрузить заранее, чтобы за дверью не было пусто. */
function preloadAround(mapId: string): void {
  const m = HUB_MAPS[mapId];
  if (!m) return;
  preloadHubMap(m);
  for (const d of m.doors) if (HUB_MAPS[d.to]) preloadHubMap(HUB_MAPS[d.to]);
}

interface Talk {
  id: string;
  name: string;
  sheet: string;
  lines: string[];
}

interface CampOpen {
  tabs: CampTab[];
  title: string;
  tab: CampTab;
}

export function YardPage() {
  const hydrated = useFinanceStore((s) => s.hydrated);
  useGameAudio('yard');
  // Герой площади — тот же, что в подземелье: его листы грузятся отсюда.
  useDungeonSprites();
  if (!hydrated) return <div className="gx hub" />;
  return <HubWorld />;
}

function HubWorld() {
  const nav = useNavigate();
  const prison = useFinanceStore((s) => s.prison);
  const dungeon = useFinanceStore((s) => s.dungeon);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const newTerm = useFinanceStore((s) => s.newTerm);
  const dismissNewTerm = useFinanceStore((s) => s.dismissNewTerm);
  const prisonZoneEnter = useFinanceStore((s) => s.prisonZoneEnter);
  const now = useNow(1000);
  const facts = useMemo(
    () => hubFacts(prison, dungeon, balance, now),
    [prison, dungeon, balance, now],
  );
  const factsRef = useRef(facts);
  factsRef.current = facts;
  // Событие кончилось по часам — стор закрывает его, даже если герой стоит
  // на площади (медведь заберёт штабель, сорока отдаст мешочек).
  useYardEvent('mine', () => undefined);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [sim] = useState<HubSim>(() => createHubSim(firstPlace()));
  const rendRef = useRef<HubRenderer | null>(null);
  const input = useRef<HubInput>({ ...HUB_NO_INPUT });
  const busyRef = useRef(false);
  const fading = useRef(false);
  /** Ушли со страницы через дверь — место уже записано, снятие его не трогает. */
  const leaving = useRef(false);

  const [mapId, setMapId] = useState(sim.map.id);
  const [use, setUse] = useState<{ key: string; label: string; kind: 'npc' | 'door' } | null>(null);
  const [talk, setTalk] = useState<Talk | null>(null);
  const [camp, setCamp] = useState<CampOpen | null>(null);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [baryga, setBaryga] = useState(false);
  const [board, setBoard] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [fade, setFade] = useState(false);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = !!talk || !!camp || forgeOpen || baryga || board || mapOpen || newTerm;
  busyRef.current = busy || fade;
  const coveredRef = useRef(false);
  coveredRef.current = forgeOpen;

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), text });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const stick = useFloatingStick({
    rootRef,
    // Джойстик — по всему экрану, но ленивый: без сдвига пальца это тап
    // «иди сюда», а не джойстик.
    zone: 1,
    lazy: true,
    onMove: (mx, my) => {
      input.current = { mx, my };
    },
  });
  // Открылось окно — палец бросаем, герой встаёт.
  useEffect(() => {
    if (busy) stick.release();
    // release — стабильный колбэк хука.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // ---- Переходы -----------------------------------------------------------

  /** На другую карту: в чёрное, смена, из чёрного. */
  const go = useCallback(
    (to: string, at: string | HubPlace) => {
      if (fading.current || !HUB_MAPS[to]) return;
      fading.current = true;
      setFade(true);
      doorLatch();
      setTimeout(() => {
        enterMap(sim, to, at);
        rendRef.current?.snap();
        setMapId(to);
        savePlace(placeOf(sim));
        preloadAround(to);
        setFade(false);
        fading.current = false;
      }, FADE_MS);
    },
    [sim],
  );

  /** Уйти с площади на маршрут игры, записав, где потом встать. */
  const leave = useCallback(
    (path: string, place: HubPlace = placeOf(sim)) => {
      leaving.current = true;
      savePlace(place);
      tapLight();
      nav(path);
    },
    [nav, sim],
  );

  /** Прочь с площади: назад по истории, а если её нет — в зал игр. */
  const exit = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav('/games');
  }, [nav]);

  const enterZone = useCallback(
    (place?: HubPlace) => {
      const st = useFinanceStore.getState();
      if (st.prison.zone.on || prisonZoneEnter()) leave('/prison', place);
      else {
        softThud();
        say(
          factsRef.current.zoneOpen
            ? 'На сегодня время особой шахты вышло'
            : `Особая шахта — после ${ZONE_TIERS[0]}-го престижа`,
        );
      }
    },
    [leave, prisonZoneEnter, say],
  );

  const onDoor = useCallback(
    (d: HubDoor) => {
      const f = factsRef.current;
      // Замок проверяет игра: карта знает только, какой.
      if (d.lock === 'dungeon' && !f.dungeonOpen) {
        softThud();
        say(`Лифт вниз — с ранга ${rankLetter(DUNGEON_UNLOCK_RANK)}`);
        return;
      }
      if (d.lock === 'zone' && !(f.zoneOpen && (f.zoneOn || f.zoneMs > 0))) {
        softThud();
        say(
          f.zoneOpen
            ? 'На сегодня время особой шахты вышло'
            : `Особая шахта — после ${ZONE_TIERS[0]}-го престижа`,
        );
        return;
      }
      const back = placeAtDoor(sim.map, d);
      switch (d.to) {
        case '@prison':
          doorLatch();
          leave('/prison', back);
          return;
        case '@dungeon':
          doorLatch();
          leave('/dungeon', back);
          return;
        case '@zone':
          enterZone(back);
          return;
        case '@board':
          uiTap();
          setBoard(true);
          return;
        case '@back':
          leaving.current = true;
          savePlace(back);
          exit();
          return;
        default:
          if (HUB_MAPS[d.to]) go(d.to, d.at);
          else {
            softThud();
            say('Заперто');
          }
      }
    },
    [enterZone, exit, go, leave, say, sim],
  );

  const openTalk = useCallback(
    (id: string) => {
      const n = sim.map.data.npcs.find((x) => x.id === id);
      const res = residentOf(id, n?.name, n?.sheet);
      setTalk({
        id,
        name: n?.name || res.name,
        sheet: n?.sheet ?? res.sheet,
        lines: res.lines(factsRef.current),
      });
      softChime(2);
      tapLight();
    },
    [sim],
  );

  const closeTalk = useCallback(() => {
    endTalk(sim);
    setTalk(null);
  }, [sim]);

  const act = useCallback(
    (a: HubAction) => {
      endTalk(sim);
      setTalk(null);
      tapLight();
      switch (a.kind) {
        case 'forge':
          setForgeOpen(true);
          return;
        case 'camp':
          setCamp({ tabs: a.tabs, title: a.title, tab: a.tabs[0] });
          return;
        case 'baryga':
          setBaryga(true);
          return;
        case 'zone':
          enterZone();
          return;
        case 'route':
          leave(a.path);
      }
    },
    [enterZone, leave, sim],
  );

  // События мира приходят из цикла кадров — ссылка на свежий обработчик.
  const onEvents = useRef<(ev: HubEvent[]) => void>(() => undefined);
  onEvents.current = (events: HubEvent[]) => {
    for (const e of events) {
      if (e.t === 'door' || e.t === 'use') onDoor(e.door);
      else if (e.t === 'talk') openTalk(e.npc);
      else if (e.t === 'step') {
        // Шаг — на каждом втором кадре ходьбы, тихо. Под крышей — доски,
        // снаружи — утоптанная земля (своего пола у карты пока нет).
        footstep(sim.map.data.kind === 'indoor');
        rendRef.current?.onStep(sim);
      }
    }
  };

  // ---- Мир: цикл кадров ----------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return undefined;
    const r = new HubRenderer(canvas);
    rendRef.current = r;
    if (import.meta.env.DEV)
      Object.assign(window as unknown as Record<string, unknown>, {
        __hub: {
          sim,
          r,
          go: (to: string, at: string) => go(to, at),
          /** Час суток для стенда: 0…1 или null — настоящий. */
          phase: (p: number | null) => {
            r.phaseOverride = p;
          },
        },
      });
    const fit = () => {
      r.resize(root.clientWidth, root.clientHeight, window.devicePixelRatio || 1);
      const top = topRef.current?.getBoundingClientRect().bottom ?? 0;
      // Снизу — джойстик и кнопки: маленькая комната встаёт посередине между
      // табло и ними, а край большой карты не прячется под пальцем.
      r.setInsets(Math.max(0, top - root.getBoundingClientRect().top), BOTTOM_INSET);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    if (topRef.current) ro.observe(topRef.current);
    preloadAround(sim.map.id);

    let raf = 0;
    let last = performance.now();
    let hudT = 0;
    let saveT = 0;
    const loop = (t: number) => {
      // Метка первого кадра бывает раньше `performance.now()`: шаг не бывает
      // отрицательным (грабля подземелья).
      const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
      last = t;
      if (dt > 0) {
        const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
        for (let j = 0; j < n; j++) {
          stepHub(sim, dt / n, busyRef.current ? HUB_NO_INPUT : input.current);
          if (sim.events.length) {
            const ev = sim.events.splice(0);
            onEvents.current(ev);
          }
        }
      }
      // Кузница закрывает экран целиком — площадь под ней не рисуем.
      if (!coveredRef.current) r.frame(sim, useFinanceStore.getState().dungeon.gear, dt);
      hudT += dt;
      if (hudT > 0.12) {
        hudT = 0;
        const u = busyRef.current ? null : nearestUsable(sim);
        const key = u ? `${u.kind}:${u.kind === 'npc' ? u.id : u.door.i}` : '';
        setUse((prev) =>
          (prev?.key ?? '') === key ? prev : u ? { key, label: u.label, kind: u.kind } : null,
        );
      }
      saveT += dt;
      if (saveT > 3) {
        saveT = 0;
        if (!leaving.current) savePlace(placeOf(sim));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onHide = () => {
      if (document.visibilityState === 'hidden' && !leaving.current) savePlace(placeOf(sim));
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onHide);
      if (!leaving.current) savePlace(placeOf(sim));
      rendRef.current = null;
    };
    // Мир один на заход на площадь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  // «!» над жителями с делом и над дверями, за которыми такой житель.
  useEffect(() => {
    const r = rendRef.current;
    if (!r) return;
    const npcs = new Set<string>();
    const doors = new Set<number>();
    const has = (id: string) =>
      (HUB_MAPS[id]?.npcs ?? []).some((n) => residentOf(n.id).badge(facts));
    // Идёт событие — «!» у доски объявлений и у шахты, где оно идёт.
    const live = liveEvent(prison, facts.now);
    const evMine = !!live && live.place === 'mine';
    for (const n of sim.map.data.npcs) if (residentOf(n.id).badge(facts)) npcs.add(n.id);
    for (const d of sim.map.doors) {
      if (HUB_MAPS[d.to] && has(d.to)) doors.add(d.i);
      if (live && d.to === '@board') doors.add(d.i);
      if (evMine && (d.to === 'mine' || d.to === '@prison')) doors.add(d.i);
    }
    r.flags = { npcs, doors };
    r.nests = prison.nest.map((x) => ({ egg: x.egg, ready: x.left <= 0 }));
  }, [facts, mapId, prison, sim]);

  // ---- Пальцы и клавиатура ---------------------------------------------------

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    primeAudio();
    if (busyRef.current) return;
    stick.down(e);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => stick.move(e);
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const tap = stick.up(e);
    if (!tap || busyRef.current) return;
    const r = rendRef.current;
    if (!r) return;
    const w = r.toWorld(tap.x, tap.y);
    const t = hitTest(sim, w.x, w.y);
    if (walkTo(sim, t) && t.kind === 'point') r.markTap(w.x, w.y);
  };

  const actNear = useCallback(() => {
    if (busyRef.current) return;
    if (interactNear(sim)) tapLight();
  }, [sim]);

  useEffect(() => {
    const keys = new Set<string>();
    const axis = () => {
      const x =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const y =
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0) -
        (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      input.current = { mx: x / l, my: y / l };
    };
    const MOVE = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (busyRef.current) return;
      if (MOVE.includes(k)) {
        keys.add(k);
        axis();
      } else if (k === 'e' && !e.repeat) actNear();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!keys.delete(k)) return;
      axis();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [actNear]);

  // ---- Табло --------------------------------------------------------------

  const live = liveEvent(prison, now);
  const ev = live && (FOREST_ON || live.place !== 'forest') ? live : null;
  const def = ev ? eventOf(ev.id) : null;
  const onSquare = mapId === 'square';
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  const talkRes = talk ? residentOf(talk.id, talk.name, talk.sheet) : null;

  return (
    <div
      className="gx hub"
      ref={rootRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas className="hub__canvas" ref={canvasRef} />

      <div className="hub-top" ref={topRef} onPointerDown={stop}>
        <GameTop
          title={sim.map.data.name || 'Двор'}
          onBack={exit}
          right={<AudioToggles />}
          chips={
            <>
              <span className="gx-chip">
                <CoinIcon size={18} /> {shortMoney(balance)}
              </span>
              <span className="gx-chip">
                <TokenIcon size={17} /> {fmt(prison.tokens)}
              </span>
              <span className="gx-chip">
                <KeyIcon size={17} /> {prison.keys}
              </span>
              <span className="gx-chip yardx__rank" title="Ранг в шахте">
                <GxIcon name="pick" size={16} /> {rankLetter(prison.rank)}
              </span>
            </>
          }
        />
        {ev && def && (
          <button
            type="button"
            className="hub-ev"
            style={{ '--ev': def.color } as CSSProperties}
            onClick={() => leave(ev.place === 'forest' ? '/forest' : '/prison')}
          >
            <span className="hub-ev__glyph">{def.glyph}</span>
            <b>{def.name}</b>
            <em>
              <GxIcon name="hourglass" size={13} /> {clock(ev.until - now)}
            </em>
            <GxIcon name={ev.place === 'forest' ? 'axe' : 'pick'} size={16} />
          </button>
        )}
      </div>

      {toast && (
        <div key={toast.key} className="hub-toast" role="status">
          {toast.text}
        </div>
      )}

      <FloatingStick api={stick} />

      <div className="hub-pad" onPointerDown={stop}>
        {onSquare && (
          <button
            type="button"
            className="gx-round gx-round--dark hub-pad__map"
            aria-label="Карта"
            onClick={() => {
              tapLight();
              setMapOpen(true);
            }}
          >
            <GxIcon name="map" />
          </button>
        )}
        {use && !busy && (
          <button
            type="button"
            className={`gx-btn hub-pad__use${use.kind === 'npc' ? ' gx-btn--red' : ''}`}
            onClick={actNear}
          >
            <GxIcon name={use.kind === 'npc' ? 'scroll' : 'gate'} />
            {use.label}
          </button>
        )}
      </div>

      <div className={`hub-fade${fade ? ' is-on' : ''}`} aria-hidden="true" />

      {talk && talkRes && (
        <HubTalk
          key={talk.id}
          name={talk.name}
          sheet={talk.sheet}
          lines={talk.lines}
          options={talkRes.options(facts)}
          badge={talkRes.badge(facts)}
          onOption={(o) => act(o.action)}
          onClose={closeTalk}
        />
      )}

      {mapOpen && (
        <HubMapSheet
          sim={sim}
          flags={rendRef.current?.flags.doors ?? new Set()}
          onClose={() => setMapOpen(false)}
          onPick={(d) => {
            setMapOpen(false);
            const s = sim.map.data.spawns[d.to];
            go(
              'square',
              s ? { map: 'square', x: s[0], y: s[1], face: s[2] } : placeAtDoor(sim.map, d),
            );
          }}
        />
      )}

      {board && (
        <GxModal title="Доска" onClose={() => setBoard(false)} className="hub-board">
          <BoardNote
            facts={facts}
            onGo={(place) => {
              setBoard(false);
              leave(place === 'forest' ? '/forest' : '/prison');
            }}
          />
        </GxModal>
      )}

      {camp && (
        <PrisonCamp
          place="mine"
          only={camp.tabs}
          title={camp.title}
          tab={camp.tab}
          onTab={(t) => setCamp({ ...camp, tab: t })}
          onClose={() => setCamp(null)}
          onGain={() => undefined}
          onSpend={() => undefined}
        />
      )}
      {baryga && <BarygaSheet onClose={() => setBaryga(false)} />}
      {forgeOpen && <ForgeScreen onClose={() => setForgeOpen(false)} />}
      {newTerm && (
        <GxModal title="Новый срок" onClose={dismissNewTerm} className="yard-term">
          <ul className="yard-term__list">
            <li>
              <GxIcon name="coins" size={20} /> Цены постоянные: руда, блоки, ранги, кирки
            </li>
            <li>
              <GxIcon name="gold-mine" size={20} /> С ранга E — выработка и блок этажа
            </li>
            <li>
              <GxIcon name="anvil" size={20} /> Кирки куются из руды
            </li>
            <li>
              <GxIcon name="slots" size={20} /> Наград за вход больше нет — монеты только за работу
            </li>
          </ul>
          <p className="yard-term__note">Все игры начаты заново.</p>
          <button
            type="button"
            className="gx-btn gx-btn--red gx-btn--big gx-btn--block"
            onClick={() => {
              dismissNewTerm();
              leave('/prison');
            }}
          >
            В шахту
          </button>
        </GxModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Разговор.
// ---------------------------------------------------------------------------

/** Букв в секунду: реплика печатается быстро — читать, а не ждать. */
const TYPE_CPS = 55;

function HubTalk({
  name,
  sheet,
  lines,
  options,
  badge,
  onOption,
  onClose,
}: {
  name: string;
  sheet: string;
  lines: string[];
  options: HubOption[];
  badge: boolean;
  onOption: (o: HubOption) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const skip = useRef(false);
  const line = lines[Math.min(i, lines.length - 1)] ?? '';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);

  // Печать — прямо в текст узла, мимо React: шестьдесят перерисовок окна в
  // секунду ради одной буквы незачем.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    skip.current = false;
    setDone(false);
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (still) {
      el.textContent = line;
      setDone(true);
      return undefined;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const n = skip.current
        ? line.length
        : Math.min(line.length, Math.floor(((performance.now() - t0) / 1000) * TYPE_CPS));
      el.textContent = line.slice(0, n);
      if (n >= line.length) setDone(true);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line]);

  const more = i < lines.length - 1;
  const next = () => {
    if (!done) {
      skip.current = true;
      return;
    }
    if (more) {
      uiTap();
      setI(i + 1);
    }
  };

  return (
    <div className="gx hub-talk" onPointerDown={(e) => e.stopPropagation()}>
      <div className="gx-panel gx-panel--wood-fancy hub-talk__box">
        <div className="hub-talk__head">
          <span className="hub-talk__face">
            <img src={hubUrl(`faces/${sheet}.png`)} alt="" draggable={false} />
            {badge && <span className="gx-badge gx-badge--gold">!</span>}
          </span>
          <button type="button" className="gx-panel hub-talk__say" onClick={next}>
            <b className="hub-talk__name">{name}</b>
            <span className="hub-talk__text" ref={textRef} />
            {done && more && <i className="hub-talk__more" aria-hidden="true" />}
          </button>
        </div>
        <div className="hub-talk__opts">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className="gx-btn gx-btn--red"
              onClick={() => onOption(o)}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            className="gx-btn gx-btn--grey"
            onClick={() => {
              uiTap();
              onClose();
            }}
          >
            Пока
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карта площади — быстрый переход к зданию.
// ---------------------------------------------------------------------------

function HubMapSheet({
  sim,
  flags,
  onClose,
  onPick,
}: {
  sim: HubSim;
  flags: Set<number>;
  onClose: () => void;
  onPick: (d: HubDoor) => void;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const m = sim.map;
  // Карта рисуется один раз: пол и все постройки кадром «покоя». Картинки
  // могли ещё не прийти — тогда повтор через миг.
  useEffect(() => {
    let timer = 0;
    let tries = 0;
    const draw = () => {
      const c = cvRef.current;
      if (!c) return;
      c.width = m.w * 16;
      c.height = m.h * 16;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.fillStyle = m.data.bg || '#000';
      g.fillRect(0, 0, c.width, c.height);
      const ground = hubImage(`maps/${m.id}.png`);
      const atlas = hubImage('atlas.png');
      if (ground) g.drawImage(ground, 0, 0);
      if (atlas)
        for (const o of [...m.data.objs].sort((a, b) => a[4] - b[4] || a[3] - b[3])) {
          const sp = HUB_SPRITES[o[0]];
          if (sp) g.drawImage(atlas, sp[0], sp[1], sp[2], sp[3], o[1], o[2], sp[2], sp[3]);
        }
      if ((!ground || !atlas) && tries++ < 20) timer = window.setTimeout(draw, 150);
    };
    draw();
    return () => clearTimeout(timer);
  }, [m]);
  const places = m.doors.filter((d) => d.kind === 'enter' && HUB_MAPS[d.to]);
  const hx = (sim.hero.x / m.w) * 100;
  const hy = (sim.hero.y / m.h) * 100;
  return (
    <GxModal title="Карта лагеря" onClose={onClose} className="hub-map">
      <div className="hub-map__frame" style={{ aspectRatio: `${m.w} / ${m.h}` }}>
        <canvas ref={cvRef} className="hub-map__cv" />
        <i className="hub-map__me" style={{ left: `${hx}%`, top: `${hy}%` }} aria-hidden="true" />
        {places.map((d) => (
          <button
            key={d.i}
            type="button"
            className="hub-map__pin"
            style={{ left: `${((d.x + d.w / 2) / m.w) * 100}%`, top: `${(d.y / m.h) * 100}%` }}
            onClick={() => {
              tapLight();
              onPick(d);
            }}
          >
            {d.label || HUB_MAPS[d.to].name}
            {flags.has(d.i) && <span className="gx-badge gx-badge--gold">!</span>}
          </button>
        ))}
      </div>
    </GxModal>
  );
}

// ---------------------------------------------------------------------------
// Доска объявлений.
// ---------------------------------------------------------------------------

function BoardNote({ facts, onGo }: { facts: HubFacts; onGo: (place: 'mine' | 'forest') => void }) {
  const prison = useFinanceStore((s) => s.prison);
  const now = facts.now;
  const live = liveEvent(prison, now);
  const ev = live && (FOREST_ON || live.place !== 'forest') ? live : null;
  const def = ev ? eventOf(ev.id) : null;
  const quiet = prison.rank < EVENTS_FROM_RANK && !prison.prestige;
  const nextMin = Math.max(1, Math.ceil((prison.eventNext - now) / 60_000));
  return (
    <section
      className={`gx-panel gx-panel--wood-fancy yardx-board${ev ? ' is-live' : ''}`}
      style={def ? ({ '--ev': def.color } as CSSProperties) : undefined}
    >
      <div className="gx-panel yardx-note">
        {ev && def ? (
          <>
            <div className="yardx-note__head">
              <span className="yardx-note__glyph">{def.glyph}</span>
              <b>{def.name}</b>
              <em>
                <GxIcon name="hourglass" size={14} /> {clock(ev.until - now)}
              </em>
            </div>
            <span className="yardx-note__lead">{def.lead}</span>
            {ev.need > 0 && (
              <GxBar
                value={Math.min(1, ev.have / ev.need)}
                tone="gold"
                label={`${fmt(ev.have)} / ${fmt(ev.need)}`}
              />
            )}
            <button
              type="button"
              className="gx-btn gx-btn--red gx-btn--block"
              onClick={() => onGo(ev.place === 'forest' ? 'forest' : 'mine')}
            >
              <GxIcon name={ev.place === 'forest' ? 'axe' : 'pick'} />
              {ev.place === 'forest' ? 'В лес' : 'В шахту'}
            </button>
          </>
        ) : (
          <div className="yardx-note__quiet">
            <GxIcon name="scroll" size={30} />
            <span>
              {quiet
                ? `События во дворе начнутся с ранга ${rankLetter(EVENTS_FROM_RANK)}`
                : prison.eventNext > now
                  ? `Тихо. Следующее событие — через ${nextMin} мин, пока работаешь`
                  : 'Событие вот-вот — начни копать'}
            </span>
          </div>
        )}
      </div>
      <div className="yardx-board__all">
        {EVENTS.filter((e) => FOREST_ON || e.place !== 'forest').map((e) => (
          <span
            key={e.id}
            title={e.name}
            className={ev?.id === e.id ? 'is-on' : ''}
            style={{ '--ev': e.color } as CSSProperties}
          >
            {e.glyph}
          </span>
        ))}
      </div>
    </section>
  );
}
