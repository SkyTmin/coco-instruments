// Подземелье: лобби наверху (снаряжение, выбор спуска, король и шахты), сама
// вылазка (`components/DungeonRun`) и то, что после неё — итог подъёма или
// «растащили». Мир внизу цельный: переходов между районами нет, экран
// загрузки — только у лифта, при спуске и при подъёме (так решил владелец).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameTop, GxBar, GxIcon, KIcon } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, PrisonCamp, TokenIcon, useNow } from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { DungeonRun } from '@/components/DungeonRun';
import { AudioToggles } from '@/components/AudioToggles';
import { useGameAudio } from '@/lib/use-game-audio';
import type { RunEnd } from '@/components/DungeonRun';
import { useFinanceStore } from '@/store';
import {
  AREAS,
  areaOf,
  bossReadyAt,
  DEEP_DONE_AT,
  DEEP_MINES,
  deepMineNow,
  dungeonOpen,
  DUNGEON_UNLOCK_RANK,
  econOf,
  heroOf,
  levelOf,
  MATS,
  mineNextAt,
  sackSlots,
  slotsUsed,
  setOf,
  SLOTS,
  upgradable,
} from '@/lib/dungeon';
import type { AreaId, DeepMineId, MatId } from '@/lib/dungeon';
import { buildWorld } from '@/lib/dungeon-world';
import { gearIcon, heroFrame, itemUrl, propArt } from '@/lib/dungeon-art';
import { heroPortrait, useDungeonSprites } from '@/lib/dungeon-sprites';
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
  // Картинки героя грузятся, пока игрок в клети: к спуску они уже есть.
  const sprites = useDungeonSprites();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Внизу — тревожная музыка (у короля своя, её ставит вылазка), наверху — тихая.
  useGameAudio(
    view === 'down' || view === 'play' || view === 'up' ? 'depths' : 'lobby',
    'dungeon',
    'mine',
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
      <div className="gx dgl">
        <div className="dg-shaft-bg" aria-hidden="true" />
      </div>
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

  const campSheet = camp && (
    <PrisonCamp
      place="dungeon"
      tab={camp}
      onTab={setCamp}
      onClose={() => setCamp(null)}
      onGain={() => undefined}
      onSpend={() => undefined}
    />
  );

  if (view === 'summary' && end?.kind === 'extract') {
    const h = end.exit.haul;
    const mats = Object.entries(h.mats) as [MatId, number][];
    const nothing = !h.meat && !h.coins && !mats.length && !h.tokens && !h.keys;
    return (
      <div className="gx dgl dgl--after">
        <div className="dg-shaft-bg" aria-hidden="true" />
        <div className="dgl__wrap">
          <div className="gx-ribbon gx-ribbon--curtain dgl__big">Добыча</div>
          <div className="gx-panel gx-panel--fancy dgl-after">
            <div className="dgl-after__pay">
              <CoinIcon size={34} />
              <b>+{fmt(end.exit.pay)}</b>
            </div>
            {h.meat > 0 && (
              <div className="gx-row">
                <img src={itemUrl('meat')} alt="" />
                <span>Мясо продано · {h.meat} шт.</span>
                <b>
                  {fmt(h.meatValue)} <CoinIcon size={14} />
                </b>
              </div>
            )}
            {h.coins > 0 && (
              <div className="gx-row">
                <CoinIcon size={26} />
                <span>Монеты из рюкзака</span>
                <b>{fmt(h.coins)}</b>
              </div>
            )}
            {mats.map(([id, n]) => (
              <div key={id} className="gx-row">
                <img src={itemUrl(id)} alt="" />
                <span>{MATS[id].name} → склад</span>
                <b>+{n}</b>
              </div>
            ))}
            {h.tokens > 0 && (
              <div className="gx-row">
                <TokenIcon size={26} />
                <span>Токены</span>
                <b>+{h.tokens}</b>
              </div>
            )}
            {h.keys > 0 && (
              <div className="gx-row">
                <KeyIcon size={26} />
                <span>Ключи от сундуков</span>
                <b>+{h.keys}</b>
              </div>
            )}
            {nothing && <p className="dgl-after__empty">Рюкзак пустой — зато живой.</p>}
            <div className="dgl-after__meta">
              <span>
                <GxIcon name="rat" size={18} /> {fmt(h.killed)}
              </span>
              <span>
                <GxIcon name="hourglass" size={18} /> {minutes(h.ms)}
              </span>
            </div>
          </div>
          <div className="dgl__actions">
            <button
              className="gx-btn gx-btn--red gx-btn--big gx-btn--block"
              onClick={() => {
                setEnd(null);
                setView('lobby');
              }}
            >
              <GxIcon name="lift" />
              Ещё раз вниз
            </button>
            <div className="dgl__pair">
              <button
                className="gx-btn"
                onClick={() => {
                  tapLight();
                  setCamp('gear');
                }}
              >
                <GxIcon name="anvil" />
                Снаряжение
              </button>
              <button className="gx-btn" onClick={() => nav('/yard')}>
                <GxIcon name="village" />
                Во двор
              </button>
            </div>
          </div>
        </div>
        {campSheet}
      </div>
    );
  }

  if (view === 'dead' && end?.kind === 'dead') {
    const l = end.lost;
    const mats = Object.entries(l.mats) as [MatId, number][];
    const any = l.meat || l.coins || mats.length || l.tokens || l.keys;
    return (
      <div className="gx dgl dgl--dead">
        <div className="dg-shaft-bg dg-shaft-bg--dead" aria-hidden="true" />
        <div className="dgl__wrap">
          <div className="dgl-dead__skull">
            <GxIcon name="skull" size={72} />
          </div>
          <div className="gx-ribbon gx-ribbon--curtain dgl__big">Ты погиб</div>
          <div className="gx-panel gx-panel--wood dgl-after">
            <p className="dgl-after__lead">Крысы растащили рюкзак:</p>
            {l.meat > 0 && (
              <div className="gx-row">
                <img src={itemUrl('meat')} alt="" />
                <span>Мясо · {l.meat} шт.</span>
                <b>−{fmt(l.meatValue)}</b>
              </div>
            )}
            {l.coins > 0 && (
              <div className="gx-row">
                <CoinIcon size={26} />
                <span>Монеты</span>
                <b>−{fmt(l.coins)}</b>
              </div>
            )}
            {mats.map(([id, n]) => (
              <div key={id} className="gx-row">
                <img src={itemUrl(id)} alt="" />
                <span>{MATS[id].name}</span>
                <b>−{n}</b>
              </div>
            ))}
            {l.tokens > 0 && (
              <div className="gx-row">
                <TokenIcon size={26} />
                <span>Токены</span>
                <b>−{l.tokens}</b>
              </div>
            )}
            {l.keys > 0 && (
              <div className="gx-row">
                <KeyIcon size={26} />
                <span>Ключи</span>
                <b>−{l.keys}</b>
              </div>
            )}
            {!any && <p className="dgl-after__empty">Нести было нечего.</p>}
            <div className="dgl-after__kept">
              <GxIcon name="shield" size={20} />
              <span>
                Остались опыт{l.killed > 0 ? `, ${fmt(l.killed)} убитых` : ''} и открытые места
              </span>
            </div>
          </div>
          <div className="dgl__actions">
            <button
              className="gx-btn gx-btn--red gx-btn--big gx-btn--block"
              onClick={() => {
                setEnd(null);
                setView('lobby');
              }}
            >
              <GxIcon name="lift" />
              Снова вниз
            </button>
            <button
              className="gx-btn gx-btn--block"
              onClick={() => {
                tapLight();
                setCamp('gear');
              }}
            >
              <GxIcon name="anvil" />
              Улучшить снаряжение
            </button>
          </div>
        </div>
        {campSheet}
      </div>
    );
  }

  // ---- Лобби наверху ------------------------------------------------------

  const open = dungeonOpen(prison);
  const hero = heroOf(d, prison);
  const lv = levelOf(d.xp);
  const gearKey = SLOTS.map((s) => `${d.gear[s].tier}.${d.gear[s].plus}`).join(',');
  const heroUrl = once(
    `lobby:${gearKey}:${sprites ? 1 : 0}`,
    () => heroPortrait(d.gear) ?? heroFrame(d.gear, 'down', 'idle', 0, false),
  );
  const run = d.run;
  const kingAt = bossReadyAt(d, 'king');
  const lifts = AREAS.filter((a) => a.built);
  const ups = upgradable(d, econOf(prison), balance);
  const chips = (
    <>
      <span className="gx-chip">
        <CoinIcon size={18} /> {shortMoney(balance)}
      </span>
      <span className="gx-chip" title={MATS.skin.name}>
        <img src={itemUrl('skin')} alt="" /> {fmt(d.stash.skin ?? 0)}
      </span>
      <span className="gx-chip" title={MATS.pyrite.name}>
        <img src={itemUrl('pyrite')} alt="" /> {fmt(d.stash.pyrite ?? 0)}
      </span>
    </>
  );

  return (
    <div className="gx dgl">
      <div className="dg-shaft-bg" aria-hidden="true" />
      <div className="dgl__wrap">
        <GameTop
          title="Подземелье"
          onBack={() => nav(-1)}
          chips={open ? chips : undefined}
          right={<AudioToggles />}
        />
        {!open ? (
          <div className="gx-panel gx-panel--wood-fancy dgl-lock">
            <GxIcon name="gate" size={64} />
            <b>Откроется на ранге {rankLetter(DUNGEON_UNLOCK_RANK)}</b>
            <span>Под лагерем старые шахты, и там крысы. Сначала поднимись в шахте.</span>
            <button className="gx-btn gx-btn--red gx-btn--block" onClick={() => nav('/prison')}>
              <GxIcon name="pick" />В шахту
            </button>
          </div>
        ) : (
          <>
            <div className="gx-panel gx-panel--wood-fancy dgl-hero">
              <div className="dgl-hero__pic">
                <img src={heroUrl} alt="" />
                <span className="gx-hex">{lv.level}</span>
              </div>
              <div className="dgl-hero__info">
                <b>{setOf(d.gear.weapon.tier).name} комплект</b>
                <div className="dgl-hero__stats">
                  <span title="Здоровье">
                    <GxIcon name="heart" size={18} /> {hero.maxHp}
                  </span>
                  <span title="Урон">
                    <GxIcon name="sword" size={18} /> {hero.dmg.toFixed(0)}
                  </span>
                  <span title="Броня">
                    <GxIcon name="shield" size={18} /> {hero.armor.toFixed(0)}
                  </span>
                  <span title="Рюкзак">
                    <GxIcon name="backpack" size={18} /> {sackSlots(d.sackLevel)}
                  </span>
                </div>
                <div className="dgl-hero__gear">
                  {SLOTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      title={setOf(d.gear[s].tier).items[s]}
                      onClick={() => {
                        tapLight();
                        setCamp('gear');
                      }}
                    >
                      <img src={gearIcon(s, d.gear[s].tier)} alt="" />
                      {d.gear[s].plus > 0 && <em>+{d.gear[s].plus}</em>}
                      {ups.includes(s) && <span className="gx-badge gx-badge--gold">!</span>}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="gx-btn gx-btn--sm dgl-hero__up"
                onClick={() => {
                  tapLight();
                  setCamp('gear');
                }}
              >
                <GxIcon name="anvil" />
                Улучшить снаряжение
                {ups.length > 0 && <span className="gx-badge gx-badge--gold">!</span>}
              </button>
            </div>

            {run ? (
              <div className="gx-panel gx-panel--iron dgl-resume">
                <GxIcon name="miner" size={40} />
                <div>
                  <b>Ты остался внизу</b>
                  <span>
                    {areaOf(run.area).name} · рюкзак {slotsUsed(run.sack)}/{sackSlots(d.sackLevel)}
                  </span>
                  <GxBar
                    value={run.hp / Math.max(1, hero.maxHp)}
                    label={`${Math.ceil(run.hp)} / ${hero.maxHp}`}
                  />
                </div>
              </div>
            ) : (
              <div className="dgl-areas">
                {lifts.map((a, i) => {
                  const ok = d.lifts.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`dgl-area${lift === a.id ? ' is-on' : ''}${ok ? '' : ' is-locked'}`}
                      disabled={!ok}
                      onClick={() => {
                        tapLight();
                        setLift(a.id);
                      }}
                    >
                      <img src={`/ui/areas/${a.id}.png`} alt="" />
                      <span className="dgl-area__info">
                        <b>{a.name}</b>
                        <span className="dgl-area__stars" aria-label={`сложность ${i + 1}`}>
                          {Array.from({ length: 3 }, (_, k) => (
                            <KIcon
                              key={k}
                              name="star"
                              size={14}
                              className={k <= i ? 'is-on' : ''}
                            />
                          ))}
                        </span>
                        <i>{ok ? a.lead : 'Лифт сломан — дойди пешком и почини'}</i>
                      </span>
                      {!ok && (
                        <span className="dgl-area__lock">
                          <KIcon name="locked" size={26} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              className="gx-btn gx-btn--red gx-btn--big gx-btn--block dgl-go"
              onClick={() => descend(run ? run.area : lift)}
            >
              <GxIcon name="lift" />
              {run ? 'Вернуться вниз' : 'Спуститься'}
            </button>
            <p className="dgl-warn">
              <GxIcon name="skull" size={16} /> Погибнешь — добыча из рюкзака пропадёт
            </p>

            <div className="dgl-status">
              <div className="gx-panel gx-panel--wood dgl-tile">
                <GxIcon name="crown" size={28} className={kingAt > now ? '' : 'is-gold'} />
                <b>Король</b>
                <span>{kingAt > now ? `через ${clock(kingAt - now)}` : 'в логове'}</span>
              </div>
              {(Object.keys(DEEP_MINES) as DeepMineId[]).map((id) => {
                const m = deepMineNow(d, id, now, MINE_CELLS);
                const share = minedShare(m.dug);
                const def = DEEP_MINES[id];
                const left = clock(mineNextAt(id, now) - now);
                return (
                  <div key={id} className="gx-panel gx-panel--wood dgl-tile">
                    <GxIcon name="minecart" size={28} className={share > 0 ? '' : 'is-gold'} />
                    <b>{id === 'pyrite1' ? 'Шахта' : 'Богатая шахта'}</b>
                    <span>
                      {share >= DEEP_DONE_AT
                        ? `новая через ${left}`
                        : share > 0
                          ? `выкопано ${Math.round((share / DEEP_DONE_AT) * 100)}%`
                          : 'полная'}
                    </span>
                    <i>{areaOf(def.area).name}</i>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {campSheet}
    </div>
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
  const hero = heroPortrait(gear) ?? heroFrame(gear, 'down', 'idle', 0, false);
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
  const sprites = useDungeonSprites();
  const gearKey = SLOTS.map((s) => gear[s].tier).join('');
  const cage = once(`shaft:cage:${gearKey}:${sprites ? 1 : 0}`, () => cageArt(gear));
  const a = areaOf(area);
  return (
    <div className={`dg-shaft dg-shaft--${dir}`}>
      <div className="dg-shaft__beams" />
      <img className="dg-shaft__cage" src={cage} alt="" />
      <div className="dg-shaft__text">
        <b>{dir === 'down' ? a.name : 'Наверх'}</b>
        <span>{dir === 'down' ? 'лифт едет вниз…' : 'лифт едет наверх с добычей…'}</span>
      </div>
    </div>
  );
}
