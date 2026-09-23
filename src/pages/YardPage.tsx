import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import {
  KeyIcon,
  MillIcon,
  PickIcon,
  campPlaceOf,
  PrisonCamp,
  TokenIcon,
  useNow,
} from '@/components/PrisonCamp';
import type { CampPlace, CampTab } from '@/components/PrisonCamp';
import { BarygaSheet } from '@/components/YardBits';
import { useFinanceStore } from '@/store';
import {
  crewYield,
  liveEvent,
  rankLetter,
  ROCKS,
  shortMoney,
  ZONE_TIERS,
  zoneLeft,
  zoneMineId,
  zoneTier,
} from '@/lib/prison';
import { FOREST_UNLOCK_RANK, millTick, PROP_BOARDS, SPECIES, sumRow } from '@/lib/forest';
import {
  barygaBought,
  barygaLots,
  barygaWindow,
  BARYGA_MS,
  eventOf,
  EVENTS,
  EVENTS_FROM_RANK,
} from '@/lib/yard';
import { barygaTexture, crownTexture, rockTexture } from '@/lib/prison-art';
import { areaOf, bossReadyAt, dungeonOpen, DUNGEON_UNLOCK_RANK, sackCount } from '@/lib/dungeon';
import { gearIcon } from '@/lib/dungeon-art';
import { tapLight } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return t < 60 ? `${t} с` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Двор каторги — хаб: здания ведут в шахту, на лесоповал, к Барыге и в
 * лагерь, а доска объявлений говорит, что во дворе творится. Событие само
 * живёт в шахте или в лесу — двор только показывает, где оно и сколько
 * осталось.
 */
export function YardPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const forest = useFinanceStore((s) => s.forest);
  const dungeon = useFinanceStore((s) => s.dungeon);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonZoneEnter = useFinanceStore((s) => s.prisonZoneEnter);
  const [camp, setCamp] = useState<CampTab | null>(null);
  // Место лагеря фиксируется зданием: общая вкладка (сундуки) внутри лесного
  // лагеря не должна перебрасывать его в шахтный.
  const [campPlace, setCampPlace] = useState<CampPlace>('mine');
  const [baryga, setBaryga] = useState(false);
  const now = useNow(1000);

  if (!hydrated) {
    return (
      <Screen title="Двор" className="prison-screen yard-screen">
        <div className="yard-scene-bg" aria-hidden="true" />
      </Screen>
    );
  }

  const ev = liveEvent(prison, now);
  const def = ev ? eventOf(ev.id) : null;
  const forestOpen = prison.rank >= FOREST_UNLOCK_RANK || prison.prestige > 0;
  const w = barygaWindow(now);
  const lots = barygaLots(w, prison);
  const bought = barygaBought(prison, w);
  const hotLeft = lots.some((l, i) => l.hot && (bought[i] ?? 0) < l.stock);
  const barygaNext = (w + 1) * BARYGA_MS - now;
  const mill = millTick(forest.mill, now);
  const crew = crewYield(prison, now);
  const quiet = prison.rank < EVENTS_FROM_RANK && !prison.prestige;
  const nextMin = Math.max(1, Math.ceil((prison.eventNext - now) / 60_000));
  const zoneOpen = zoneTier(prison.prestige) > 0;
  const zoneMs = zoneLeft(prison.zone, now);
  const dgOpen = dungeonOpen(prison);
  const kingAt = bossReadyAt(dungeon, 'king');

  const go = (path: string) => {
    tapLight();
    nav(path);
  };
  const open = (tab: CampTab) => {
    tapLight();
    setCampPlace(campPlaceOf(tab));
    setCamp(tab);
  };

  return (
    <Screen
      title="Двор"
      subtitle={`Лагпункт · ранг ${rankLetter(prison.rank)}${forestOpen ? ` · разряд ${forest.rank + 1}` : ''}`}
      className="prison-screen yard-screen"
    >
      <div className="yard-scene-bg" aria-hidden="true" />
      <div className="prison yard">
        <div className="yhud">
          <span>
            <CoinIcon size={15} /> {shortMoney(balance)}
          </span>
          <span className="yhud__token">
            <TokenIcon size={14} /> {fmt(prison.tokens)}
          </span>
          <span>
            <KeyIcon size={14} /> {prison.keys}
          </span>
        </div>

        <section
          className={`yboard${ev ? ' is-live' : ''}`}
          style={def ? ({ '--ev': def.color } as CSSProperties) : undefined}
        >
          <span className="yboard__tag">Доска объявлений</span>
          {ev && def ? (
            <>
              <b className="yboard__name">
                <i>{def.glyph}</i> {def.name}
                <em>{clock(ev.until - now)}</em>
              </b>
              <span className="yboard__lead">{def.lead}</span>
              {ev.need > 0 && (
                <span className="yboard__bar">
                  <i style={{ transform: `scaleX(${Math.min(1, ev.have / ev.need)})` }} />
                </span>
              )}
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => go(ev.place === 'forest' ? '/forest' : '/prison')}
              >
                {ev.place === 'forest' ? 'На делянку' : 'В шахту'}
              </button>
            </>
          ) : quiet ? (
            <span className="yboard__lead">
              Двор оживёт с ранга {rankLetter(EVENTS_FROM_RANK)}: метеориты, конвои, Куйва, медведь.
            </span>
          ) : (
            <span className="yboard__lead">
              Тихо.{' '}
              {prison.eventNext > now
                ? `Следующее событие — не раньше чем через ${nextMin} мин, за работой в шахте или на делянке.`
                : 'Событие вот-вот: начни копать или рубить.'}
            </span>
          )}
          <span className="yboard__all">
            {EVENTS.map((e) => (
              <i key={e.id} title={e.name} style={{ '--ev': e.color } as CSSProperties}>
                {e.glyph} {e.name}
              </i>
            ))}
          </span>
          {prison.eventsDone > 0 && (
            <span className="yboard__done">Событий закрыто: {fmt(prison.eventsDone)}</span>
          )}
        </section>

        <div className="ybuildings">
          <Building
            icon={<img src={rockTexture(prison.mine.id)} alt="" />}
            name="Шахта"
            text={`${ROCKS[prison.mine.id].name}, ранг ${rankLetter(prison.rank)}`}
            badge={ev?.place === 'mine' ? def?.glyph : null}
            onClick={() => go('/prison')}
          />
          <Building
            icon={<img src={crownTexture(forest.rank)} alt="" />}
            name="Лесоповал"
            text={
              forestOpen
                ? `Делянка ${forest.rank + 1}: ${SPECIES[forest.rank].name.toLowerCase()}`
                : `С ранга ${rankLetter(FOREST_UNLOCK_RANK)}`
            }
            locked={!forestOpen}
            badge={ev?.place === 'forest' ? def?.glyph : null}
            onClick={() => go('/forest')}
          />
          <Building
            icon={<img src={gearIcon('helm', dungeon.gear.helm.tier)} alt="" />}
            name="Клеть"
            text={
              !dgOpen
                ? `С ранга ${rankLetter(DUNGEON_UNLOCK_RANK)}`
                : dungeon.run
                  ? `Вылазка ждёт: ${areaOf(dungeon.run.area).name}, сидор ${sackCount(dungeon.run.sack)}`
                  : kingAt > now
                    ? `Подземелье · король вернётся через ${Math.ceil((kingAt - now) / 60_000)} мин`
                    : 'Подземелье · король в логове'
            }
            locked={!dgOpen}
            badge={dungeon.run ? '!' : null}
            onClick={() => go('/dungeon')}
          />
          <Building
            icon={
              zoneOpen ? (
                <img src={rockTexture(zoneMineId(prison.prestige))} alt="" />
              ) : (
                <span className="ybuilding__glyph">⛓</span>
              )
            }
            name="Спецзона"
            text={
              !zoneOpen
                ? `После ${ZONE_TIERS[0]}-го престижа`
                : prison.zone.on
                  ? `Ты там · осталось ${Math.ceil(zoneMs / 60_000)} мин`
                  : zoneMs > 0
                    ? `${ROCKS[zoneMineId(prison.prestige)].name}, ${Math.ceil(zoneMs / 60_000)} мин сегодня`
                    : 'Время на сегодня вышло'
            }
            locked={!zoneOpen || (!prison.zone.on && zoneMs <= 0)}
            badge={zoneOpen && zoneMs > 0 && !prison.zone.on ? '✦' : null}
            onClick={() => {
              tapLight();
              if (prison.zone.on || prisonZoneEnter()) nav('/prison');
            }}
          />
          <Building
            icon={<img src={barygaTexture()} alt="" />}
            name="Барыга"
            text={`Товар сменится через ${Math.floor(barygaNext / 3_600_000)} ч ${Math.ceil((barygaNext % 3_600_000) / 60_000)} мин`}
            badge={hotLeft ? '%' : null}
            onClick={() => {
              tapLight();
              setBaryga(true);
            }}
          />
          <Building
            icon={<PickIcon pick={prison.pick} size={30} />}
            name="Кузница"
            text="Кирка, заточка, рюкзак, чары"
            onClick={() => open('forge')}
          />
          <Building
            icon={<MillIcon size={30} />}
            name="Лесопилка"
            text={
              mill.level > 0
                ? `Досок: ${fmt(sumRow(mill.boards))}, в очереди ${fmt(sumRow(mill.queue))}`
                : 'Пилорамы ещё нет'
            }
            badge={mill.level > 0 && sumRow(mill.boards) >= PROP_BOARDS ? '•' : null}
            onClick={() => open('mill')}
          />
          <Building
            icon={<KeyIcon size={28} />}
            name="Каптёрка"
            text="Сундуки под ключ-слезу"
            badge={prison.keys > 0 ? prison.keys : null}
            onClick={() => open('cases')}
          />
          <Building
            icon={<span className="ybuilding__glyph">⚒</span>}
            name="Бригада"
            text={crew.blocks > 0 ? `Накопала ${fmt(crew.blocks)} блоков` : 'Копает, пока тебя нет'}
            badge={crew.blocks > 0 && crew.minutes >= 10 ? '•' : null}
            onClick={() => open('crew')}
          />
          <Building
            icon={<span className="ybuilding__glyph">🎰</span>}
            name="Автоматы"
            text="Тот же кошелёк"
            onClick={() => go('/games')}
          />
        </div>
      </div>

      {camp && (
        <PrisonCamp
          place={campPlace}
          tab={camp}
          onTab={setCamp}
          onClose={() => setCamp(null)}
          onGain={() => undefined}
          onSpend={() => undefined}
        />
      )}
      {baryga && <BarygaSheet onClose={() => setBaryga(false)} />}
    </Screen>
  );
}

function Building({
  icon,
  name,
  text,
  badge,
  locked = false,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  text: string;
  badge?: ReactNode;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ybuilding${locked ? ' is-locked' : ''}`}
      onClick={onClick}
      disabled={locked}
    >
      <span className="ybuilding__ico">{icon}</span>
      <b>{name}</b>
      <i>{text}</i>
      {badge != null && <em className="ybuilding__badge">{badge}</em>}
    </button>
  );
}
