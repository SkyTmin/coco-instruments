// Подземелье: клеть наверху (выбор спуска, снаряжение, вести снизу), сама
// вылазка (`components/DungeonRun`) и то, что после неё — итог подъёма или
// «растащили». Мир внизу цельный: переходов между районами нет, экран
// загрузки — только у клети, при спуске и при подъёме (так решил владелец).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, PrisonCamp, TokenIcon, useNow } from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { DungeonRun } from '@/components/DungeonRun';
import type { RunEnd } from '@/components/DungeonRun';
import { useFinanceStore } from '@/store';
import {
  AREAS,
  areaOf,
  BOSSES,
  bossReadyAt,
  DEEP_DONE_AT,
  DEEP_MINES,
  deepMineNow,
  dungeonOpen,
  DUNGEON_UNLOCK_RANK,
  heroOf,
  levelOf,
  MATS,
  mineNextAt,
  sackCap,
  sackCount,
  setOf,
  SLOTS,
} from '@/lib/dungeon';
import type { AreaId, DeepMineId, MatId } from '@/lib/dungeon';
import { buildWorld } from '@/lib/dungeon-world';
import { gearIcon, heroFrame, itemUrl, propArt } from '@/lib/dungeon-art';
import { MINE_CELLS, minedShare, rankLetter, shortMoney } from '@/lib/prison';
import { liftClank, primeAudio } from '@/lib/sound';
import { tapLight } from '@/lib/haptics';

type View = 'lobby' | 'down' | 'play' | 'up' | 'summary' | 'dead';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  return m >= 60
    ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
    : `${m}:${String(t % 60).padStart(2, '0')}`;
};
const minutes = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'меньше минуты' : `${m} мин`;
};

const urlCache = new Map<string, string>();
const once = (key: string, make: () => HTMLCanvasElement) => {
  let u = urlCache.get(key);
  if (!u) {
    u = make().toDataURL();
    urlCache.set(key, u);
  }
  return u;
};

/** Сколько длится клеть: спуск прячет первый кадр мира, подъём — подсчёт. */
const DOWN_MS = 1300;
const UP_MS = 1700;

export function DungeonPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const d = useFinanceStore((s) => s.dungeon);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const enter = useFinanceStore((s) => s.dungeonEnter);
  const introSeen = useFinanceStore((s) => s.dungeonIntroSeen);
  const world = useMemo(() => buildWorld(), []);
  const [view, setView] = useState<View>('lobby');
  const [end, setEnd] = useState<RunEnd | null>(null);
  const [camp, setCamp] = useState<CampTab | null>(null);
  const [lift, setLift] = useState<AreaId>('mouth');
  const [shaftArea, setShaftArea] = useState<AreaId>('mouth');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow(1000);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const descend = (area: AreaId) => {
    primeAudio();
    tapLight();
    liftClank();
    const st = useFinanceStore.getState();
    if (!st.dungeon.run) enter(area, heroOf(st.dungeon, st.prison).maxHp);
    introSeen();
    setShaftArea(st.dungeon.run?.area ?? area);
    setView('down');
    timer.current = setTimeout(() => setView('play'), DOWN_MS);
  };

  const onEnd = (e: RunEnd) => {
    setEnd(e);
    if (e.kind === 'extract') {
      setView('up');
      timer.current = setTimeout(() => setView('summary'), UP_MS);
    } else setView('dead');
  };

  if (!hydrated) {
    return (
      <Screen title="Клеть" className="prison-screen dg-screen">
        <div className="dg-shaft-bg" aria-hidden="true" />
      </Screen>
    );
  }

  // ---- Вылазка -----------------------------------------------------------

  if (view === 'down' || view === 'play') {
    return (
      <>
        <DungeonRun world={world} onEnd={onEnd} onLeave={() => nav(-1)} />
        {view === 'down' && <Shaft dir="down" area={shaftArea} />}
      </>
    );
  }
  if (view === 'up') return <Shaft dir="up" area="mouth" />;

  // ---- После -------------------------------------------------------------

  if (view === 'summary' && end?.kind === 'extract') {
    const h = end.exit.haul;
    const mats = Object.entries(h.mats) as [MatId, number][];
    return (
      <Screen title="Поднялся" className="prison-screen dg-screen">
        <div className="dg-shaft-bg" aria-hidden="true" />
        <div className="dg-after">
          <div className="dg-after__pay">
            <span>В кошелёк</span>
            <b>
              +{fmt(end.exit.pay)} <CoinIcon size={22} />
            </b>
          </div>
          <div className="dg-after__list">
            {h.meat > 0 && (
              <span>
                <img src={itemUrl('meat')} alt="" />
                Мясо Барыге: {h.meat} шт.
                <b>
                  {fmt(h.meatValue)} <CoinIcon size={13} />
                </b>
              </span>
            )}
            {h.coins > 0 && (
              <span>
                <CoinIcon size={18} />
                Монеты из сидора
                <b>{fmt(h.coins)}</b>
              </span>
            )}
            {mats.map(([id, n]) => (
              <span key={id}>
                <img src={itemUrl(id)} alt="" />
                {MATS[id].name} — на склад
                <b>{n}</b>
              </span>
            ))}
            {h.tokens > 0 && (
              <span>
                <TokenIcon size={18} />
                Токены — в каторгу
                <b>{h.tokens}</b>
              </span>
            )}
            {h.keys > 0 && (
              <span>
                <KeyIcon size={18} />
                Ключи
                <b>{h.keys}</b>
              </span>
            )}
            {!h.meat && !h.coins && !mats.length && !h.tokens && !h.keys && (
              <span className="dg-after__empty">Сидор пустой — зато живой.</span>
            )}
          </div>
          <p className="dg-after__meta">
            Убито: {fmt(h.killed)} · внизу {minutes(h.ms)}
            {h.full ? ' · сидор полный — засчитано в условие робы' : ''}
          </p>
          <div className="stack">
            <button
              className="btn btn--primary btn--block"
              onClick={() => {
                setEnd(null);
                setView('lobby');
              }}
            >
              К клети
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                tapLight();
                setCamp('gear');
              }}
            >
              Снаряжение
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => nav('/yard')}>
              Во двор
            </button>
          </div>
        </div>
        {camp && (
          <PrisonCamp
            place="dungeon"
            tab={camp}
            onTab={setCamp}
            onClose={() => setCamp(null)}
            onGain={() => undefined}
            onSpend={() => undefined}
          />
        )}
      </Screen>
    );
  }

  if (view === 'dead' && end?.kind === 'dead') {
    const l = end.lost;
    const mats = Object.entries(l.mats) as [MatId, number][];
    const any = l.meat || l.coins || mats.length || l.tokens || l.keys;
    return (
      <Screen title="Растащили" className="prison-screen dg-screen dg-screen--dead">
        <div className="dg-shaft-bg dg-shaft-bg--dead" aria-hidden="true" />
        <div className="dg-after dg-after--dead">
          <b className="dg-after__skull">Тебя вынесли без сознания</b>
          <p className="dg-after__meta">Всё, что было в сидоре, крысы растащили по норам:</p>
          <div className="dg-after__list dg-after__list--lost">
            {l.meat > 0 && (
              <span>
                <img src={itemUrl('meat')} alt="" />
                Мясо: {l.meat} шт.
                <b>
                  −{fmt(l.meatValue)} <CoinIcon size={13} />
                </b>
              </span>
            )}
            {l.coins > 0 && (
              <span>
                <CoinIcon size={18} />
                Монеты
                <b>−{fmt(l.coins)}</b>
              </span>
            )}
            {mats.map(([id, n]) => (
              <span key={id}>
                <img src={itemUrl(id)} alt="" />
                {MATS[id].name}
                <b>−{n}</b>
              </span>
            ))}
            {l.tokens > 0 && (
              <span>
                <TokenIcon size={18} />
                Токены
                <b>−{l.tokens}</b>
              </span>
            )}
            {l.keys > 0 && (
              <span>
                <KeyIcon size={18} />
                Ключи
                <b>−{l.keys}</b>
              </span>
            )}
            {!any && (
              <span className="dg-after__empty">Нести было нечего — потерял только время.</span>
            )}
          </div>
          <p className="dg-after__meta">
            Осталось с тобой:{' '}
            {l.killed > 0 ? `${fmt(l.killed)} убитых — в бестиарии и в условиях перековки, ` : ''}
            опыт, открытые решётки и фонари. Внизу ты пробыл {minutes(l.ms)}.
          </p>
          <div className="stack">
            <button
              className="btn btn--primary btn--block"
              onClick={() => {
                setEnd(null);
                setView('lobby');
              }}
            >
              К клети
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                tapLight();
                setCamp('gear');
              }}
            >
              Снаряжение
            </button>
          </div>
        </div>
        {camp && (
          <PrisonCamp
            place="dungeon"
            tab={camp}
            onTab={setCamp}
            onClose={() => setCamp(null)}
            onGain={() => undefined}
            onSpend={() => undefined}
          />
        )}
      </Screen>
    );
  }

  // ---- Клеть наверху -------------------------------------------------------

  const open = dungeonOpen(prison);
  const hero = heroOf(d, prison);
  const lv = levelOf(d.xp);
  const gearKey = SLOTS.map((s) => `${d.gear[s].tier}.${d.gear[s].plus}`).join(',');
  const heroUrl = once(`lobby:${gearKey}`, () => heroFrame(d.gear, 'down', 'idle', 0, false));
  const run = d.run;
  const kingAt = bossReadyAt(d, 'king');
  const lifts = AREAS.filter((a) => a.built);

  return (
    <Screen
      title="Клеть"
      subtitle={open ? `Спуск в подземелье · ур. ${lv.level}` : 'Подземелье под лагерем'}
      className="prison-screen dg-screen"
    >
      <div className="dg-shaft-bg" aria-hidden="true" />
      {!open ? (
        <div className="forest-lock">
          <b>Клеть пустят с ранга {rankLetter(DUNGEON_UNLOCK_RANK)}</b>
          <p>
            Под лагерем — старые выработки, и там крысы. Сперва шахта: возьми ранг{' '}
            {rankLetter(DUNGEON_UNLOCK_RANK)}, и тебя допустят к клети.
          </p>
          <button className="btn btn--primary btn--block" onClick={() => nav('/prison')}>
            В шахту
          </button>
        </div>
      ) : (
        <div className="dg-lobby">
          <div className="dg-lobby__hero">
            <img className="dg-lobby__sprite" src={heroUrl} alt="" />
            <div className="dg-lobby__stats">
              <b>{setOf(d.gear.weapon.tier).name} комплект</b>
              <span className="dg-lobby__gear">
                {SLOTS.map((s) => (
                  <span key={s} title={setOf(d.gear[s].tier).items[s]}>
                    <img src={gearIcon(s, d.gear[s].tier)} alt="" />
                    {d.gear[s].plus > 0 && <em>+{d.gear[s].plus}</em>}
                  </span>
                ))}
              </span>
              <i>
                здоровье {hero.maxHp} · урон {hero.dmg.toFixed(0)} · броня {hero.armor.toFixed(0)}
              </i>
              <i>сидор на {sackCap(d.sackLevel)} мест</i>
            </div>
            <button
              type="button"
              className="btn btn--sm dg-lobby__camp"
              onClick={() => {
                tapLight();
                setCamp('gear');
              }}
            >
              Лагерь
            </button>
          </div>

          {!d.intro && !run && (
            <div className="dg-intro">
              <b>Что внизу</b>
              <p>
                Под лагерем — выработки, брошенные ещё при старой власти. Там крысы: пасюки, жирные,
                подрывники с шашками, а в конце Откатки — Крысиный король.
              </p>
              <p>
                С крыс падает мясо — Барыга берёт его за монеты. Шкурки, хвосты и пирит — на
                снаряжение. Добыча твоя, только пока жив: <b>умрёшь — растащат весь сидор</b>.
                Вынести — только клетью.
              </p>
            </div>
          )}

          {run ? (
            <div className="dg-resume">
              <b>Вылазка ждёт внизу</b>
              <span>
                {areaOf(run.area).name} · здоровье {Math.ceil(run.hp)} · сидор {sackCount(run.sack)}
                /{sackCap(d.sackLevel)} · убито {run.killed}
              </span>
              <button className="btn btn--primary btn--block" onClick={() => descend(run.area)}>
                Вернуться вниз
              </button>
            </div>
          ) : (
            <div className="dg-lifts">
              {lifts.map((a) => {
                const ok = d.lifts.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`dg-lift${lift === a.id ? ' is-on' : ''}${ok ? '' : ' is-broken'}`}
                    disabled={!ok}
                    onClick={() => {
                      tapLight();
                      setLift(a.id);
                    }}
                  >
                    <b>{a.name}</b>
                    <i>{ok ? a.lead : 'клеть сломана — почини её внизу'}</i>
                  </button>
                );
              })}
              <button className="btn btn--primary btn--block dg-go" onClick={() => descend(lift)}>
                Спуститься
              </button>
            </div>
          )}

          <div className="dg-news">
            <b>Вести снизу</b>
            <span>
              <i className="dg-dot dg-dot--red" />
              {BOSSES.king.name}:{' '}
              {kingAt > now ? `вернётся через ${clock(kingAt - now)}` : 'в логове, в конце Откатки'}
            </span>
            {(Object.keys(DEEP_MINES) as DeepMineId[]).map((id) => {
              const m = deepMineNow(d, id, now, MINE_CELLS);
              const share = minedShare(m.dug);
              const def = DEEP_MINES[id];
              return (
                <span key={id}>
                  <i className="dg-dot dg-dot--gold" />
                  {def.name} ({areaOf(def.area).name}):{' '}
                  {share >= DEEP_DONE_AT
                    ? `выработана, новая через ${clock(mineNextAt(id, now) - now)}`
                    : share > 0
                      ? `выработано ${Math.round((share / DEEP_DONE_AT) * 100)}%, обновится через ${clock(mineNextAt(id, now) - now)}`
                      : `нетронута, обновится через ${clock(mineNextAt(id, now) - now)}`}
                </span>
              );
            })}
            <span>
              <i className="dg-dot" />
              Кошелёк: {shortMoney(balance)} · склад: шкурок {d.stash.skin ?? 0}, пирита{' '}
              {d.stash.pyrite ?? 0}
            </span>
          </div>
        </div>
      )}
      {camp && (
        <PrisonCamp
          place="dungeon"
          tab={camp}
          onTab={setCamp}
          onClose={() => setCamp(null)}
          onGain={() => undefined}
          onSpend={() => undefined}
        />
      )}
    </Screen>
  );
}

/**
 * Клеть с шахтёром внутри: задняя сетка, герой в своём снаряжении, пол из
 * рифлёного листа и рама с блоком троса — та же, что стоит внизу у ствола.
 */
function cageArt(gear: Parameters<typeof heroFrame>[0]): HTMLCanvasElement {
  const frame = propArt('liftFrame');
  const W = frame.width;
  const H = frame.height + 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  // Задняя стенка: тёмная, в сетку.
  g.fillStyle = '#16120f';
  g.fillRect(4, 8, W - 8, H - 12);
  g.fillStyle = '#3c4148';
  for (let x = 6; x < W - 5; x += 4) g.fillRect(x, 8, 1, H - 12);
  for (let y = 11; y < H - 4; y += 5) g.fillRect(4, y, W - 8, 1);
  // Шахтёр.
  const hero = heroFrame(gear, 'down', 'idle', 0, false);
  g.drawImage(hero, Math.round(W / 2 - hero.width / 2), H - 4 - hero.height);
  // Пол: рифлёный лист.
  g.fillStyle = '#4a5058';
  g.fillRect(2, H - 5, W - 4, 3);
  g.fillStyle = '#6a7078';
  for (let x = 3; x < W - 3; x += 3) g.fillRect(x, H - 5, 1, 1);
  // Передняя дверь-решётка до пояса.
  g.fillStyle = 'rgba(110,118,128,0.9)';
  for (let x = 6; x < W - 5; x += 6) g.fillRect(x, H - 18, 1, 13);
  g.fillRect(4, H - 18, W - 8, 1);
  g.drawImage(frame, 0, 0);
  return c;
}

/**
 * Экран клети: ствол шахты едет мимо, клеть стоит. Движение — только
 * трансформ полос крепи; картинка клети — та же, что внизу у ствола.
 */
function Shaft({ dir, area }: { dir: 'down' | 'up'; area: AreaId }) {
  const gear = useFinanceStore((s) => s.dungeon.gear);
  const gearKey = SLOTS.map((s) => gear[s].tier).join('');
  const cage = once(`shaft:cage:${gearKey}`, () => cageArt(gear));
  const a = areaOf(area);
  return (
    <div className={`dg-shaft dg-shaft--${dir}`}>
      <div className="dg-shaft__beams" />
      <img className="dg-shaft__cage" src={cage} alt="" />
      <div className="dg-shaft__text">
        <b>{dir === 'down' ? a.name : 'Наверх'}</b>
        <span>{dir === 'down' ? 'клеть идёт вниз…' : 'клеть идёт наверх — Барыга уже ждёт'}</span>
      </div>
    </div>
  );
}
