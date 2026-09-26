import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameTop, GxBar, GxIcon, GxModal, KIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, campPlaceOf, PrisonCamp, TokenIcon, useNow } from '@/components/PrisonCamp';
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
import { areaOf, bossReadyAt, dungeonOpen, DUNGEON_UNLOCK_RANK } from '@/lib/dungeon';
import { FISH_UNLOCK_RANK, netCapacity, skillOf, SPOTS } from '@/lib/fishing';
import { tapLight } from '@/lib/haptics';
import { useGameAudio } from '@/lib/use-game-audio';
import { AudioToggles } from '@/components/AudioToggles';

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
  const newTerm = useFinanceStore((s) => s.newTerm);
  const dismissNewTerm = useFinanceStore((s) => s.dismissNewTerm);
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const forest = useFinanceStore((s) => s.forest);
  const dungeon = useFinanceStore((s) => s.dungeon);
  const fishing = useFinanceStore((s) => s.fishing);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonZoneEnter = useFinanceStore((s) => s.prisonZoneEnter);
  const [camp, setCamp] = useState<CampTab | null>(null);
  // Место лагеря фиксируется зданием: общая вкладка (сундуки) внутри лесного
  // лагеря не должна перебрасывать его в шахтный.
  const [campPlace, setCampPlace] = useState<CampPlace>('mine');
  const [baryga, setBaryga] = useState(false);
  const now = useNow(1000);
  useGameAudio('yard');

  if (!hydrated) {
    return (
      <div className="gx yardx">
        <div className="yard-scene-bg" aria-hidden="true" />
      </div>
    );
  }

  const ev = liveEvent(prison, now);
  const def = ev ? eventOf(ev.id) : null;
  const forestOpen = prison.rank >= FOREST_UNLOCK_RANK || prison.prestige > 0;
  const fishOpen = prison.rank >= FISH_UNLOCK_RANK || prison.prestige > 0;
  const netFull = fishing.net.n >= netCapacity(fishing.netLevel);
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
    <div className="gx yardx">
      <div className="yard-scene-bg" aria-hidden="true" />
      <div className="yardx__wrap">
        <GameTop
          title="Двор"
          onBack={() => nav(-1)}
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
                  onClick={() => go(ev.place === 'forest' ? '/forest' : '/prison')}
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
                      : 'Событие вот-вот — начни копать или рубить'}
                </span>
              </div>
            )}
          </div>
          <div className="yardx-board__all">
            {EVENTS.map((e) => (
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

        <div className="yardx-grid">
          <Building
            icon="gold-mine"
            name="Шахта"
            text={`${ROCKS[prison.mine.id].name} · ранг ${rankLetter(prison.rank)}`}
            badge={ev?.place === 'mine' ? def?.glyph : null}
            onClick={() => go('/prison')}
          />
          <Building
            icon="forest"
            name="Лес"
            text={
              forestOpen
                ? `${SPECIES[forest.rank].name} · разряд ${forest.rank + 1}`
                : `С ранга ${rankLetter(FOREST_UNLOCK_RANK)}`
            }
            locked={!forestOpen}
            badge={ev?.place === 'forest' ? def?.glyph : null}
            onClick={() => go('/forest')}
          />
          <Building
            icon="fishing"
            name="Рыбалка"
            text={
              !fishOpen
                ? `С ранга ${rankLetter(FISH_UNLOCK_RANK)}`
                : netFull
                  ? 'Садок полон — продай улов'
                  : `${SPOTS[fishing.spot].name} · мастерство ${skillOf(fishing.xp).level}`
            }
            locked={!fishOpen}
            badge={fishOpen && netFull ? '!' : null}
            onClick={() => go('/fishing')}
          />
          <Building
            icon="cave"
            name="Подземелье"
            text={
              !dgOpen
                ? `С ранга ${rankLetter(DUNGEON_UNLOCK_RANK)}`
                : dungeon.run
                  ? `Ты внизу: ${areaOf(dungeon.run.area).name}`
                  : kingAt > now
                    ? `Король вернётся через ${Math.ceil((kingAt - now) / 60_000)} мин`
                    : 'Крысиный король в логове'
            }
            locked={!dgOpen}
            badge={dungeon.run ? '!' : null}
            onClick={() => go('/dungeon')}
          />
          <Building
            icon="crystal"
            name="Особая шахта"
            text={
              !zoneOpen
                ? `После ${ZONE_TIERS[0]}-го престижа`
                : prison.zone.on
                  ? `Ты там · ${Math.ceil(zoneMs / 60_000)} мин`
                  : zoneMs > 0
                    ? `${ROCKS[zoneMineId(prison.prestige)].name} · ${Math.ceil(zoneMs / 60_000)} мин`
                    : 'На сегодня всё'
            }
            locked={!zoneOpen || (!prison.zone.on && zoneMs <= 0)}
            badge={zoneOpen && zoneMs > 0 && !prison.zone.on ? '✦' : null}
            onClick={() => {
              tapLight();
              if (prison.zone.on || prisonZoneEnter()) nav('/prison');
            }}
          />
          <Building
            icon="shop"
            name="Торговец"
            text={`Новый товар через ${Math.floor(barygaNext / 3_600_000)} ч ${Math.ceil((barygaNext % 3_600_000) / 60_000)} мин`}
            badge={hotLeft ? '%' : null}
            onClick={() => {
              tapLight();
              setBaryga(true);
            }}
          />
          <Building
            icon="anvil"
            name="Кузница"
            text="Кирка, заточка, рюкзак, чары"
            onClick={() => open('forge')}
          />
          <Building
            icon="saw"
            name="Лесопилка"
            text={
              mill.level > 0
                ? `Досок ${fmt(sumRow(mill.boards))}, в очереди ${fmt(sumRow(mill.queue))}`
                : 'Пилорамы ещё нет'
            }
            badge={mill.level > 0 && sumRow(mill.boards) >= PROP_BOARDS ? '•' : null}
            onClick={() => open('mill')}
          />
          <Building
            icon="chest-open"
            name="Сундуки"
            text={prison.keys > 0 ? `Ключей: ${prison.keys}` : 'Ключи падают в шахте'}
            badge={prison.keys > 0 ? prison.keys : null}
            onClick={() => open('cases')}
          />
          <Building
            icon="miner"
            name="Рабочие"
            text={crew.blocks > 0 ? `Накопали ${fmt(crew.blocks)} блоков` : 'Копают, пока тебя нет'}
            badge={crew.blocks > 0 && crew.minutes >= 10 ? '•' : null}
            onClick={() => open('crew')}
          />
          <Building
            icon="slots"
            name="Казино"
            text="Слоты и Каскад на те же монеты"
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
              nav('/prison');
            }}
          >
            В шахту
          </button>
        </GxModal>
      )}
    </div>
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
  icon: GxIconName;
  name: string;
  text: string;
  badge?: ReactNode;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`yardx-b${locked ? ' is-locked' : ''}`}
      onClick={onClick}
      disabled={locked}
    >
      <span className="yardx-b__medal">
        <GxIcon name={icon} />
        {locked && <KIcon name="locked" size={18} className="yardx-b__lock" />}
      </span>
      <b>{name}</b>
      <i>{text}</i>
      {badge != null && <span className="gx-badge">{badge}</span>}
    </button>
  );
}
