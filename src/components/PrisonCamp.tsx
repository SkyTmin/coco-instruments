// «Лагерь» каторги: всё, что не шахта. Кузница, чары, лавка, сундуки,
// бригада, коллекция и перки — один лист с вкладками. Его открывает кнопка в
// шахте, а позже — здания двора, каждое на своей вкладке.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { GxIcon, GxSheet } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { useFormFactor } from '@/game-shell';
import { Tabs } from '@/ui-px';
import type { TabItem } from '@/ui-px';
import { CoinIcon } from '@/components/slot-art';
import { rarityOf } from '@/lib/rarity';
import { CREW_ON } from '@/lib/features';
import { useFinanceStore } from '@/store';
import { BeastTab, GearTab, StashTab } from '@/components/DungeonCamp';
import { RodsTab, TrophiesTab } from '@/components/FishingCamp';
import { PickPx } from '@/components/PickArt';
import { BookArt, BooksTab } from '@/components/BooksTab';
import { ChestTab } from '@/components/ChestTab';
import { EggArt, PetArt } from '@/components/PetArt';
import { PetsTab } from '@/components/PetsTab';
import { FindsTab, MilesTab, PerksTab, RunesTab, ShopTab } from '@/components/CampTabs';
import {
  CASE_TIERS,
  CREW_MAX,
  crewCapHours,
  crewCost,
  crewFeedCost,
  crewShiftOf,
  CREW_FED_BOOST,
  CREW_FEED_WINDOW_MIN,
  CREW_SHARE,
  CREW_SHIFTS,
  crewRate,
  crewYield,
  CASE_TIERS as TIERS_OF,
  milesReady,
  RUNE_ROMAN,
  runePower,
  runesIdle,
  handleRate,
  HANDLES,
  perkPointsFree,
  PICKS,
  rankLetter,
} from '@/lib/prison';
import type {
  CrewShift,
  CaseTier,
  ItemId,
  PetId,
  PrisonState,
  Reward,
  Rune,
  RuneKind,
} from '@/lib/prison';
import type { CrewCollect, ParcelOpen } from '@/store';
import {
  AXE_ENCHANTS,
  axeEnchCap,
  axeEnchCost,
  axeLevelOf,
  AXES,
  axeDamage,
  axeSharpCost,
  AXE_SHARP_MAX,
  AXE_SHARP_STEP,
  BOARD_MULT,
  benchCan,
  benchItemOf,
  benchOrders,
  HANDLE_STRIKES,
  PROP_STRIKES,
  boardsForSale,
  boardsReserve,
  boardsValue,
  forestMods,
  millCost,
  MILL_MAX,
  millQueueCap,
  millRate,
  millTick,
  pileCapacity,
  pileCost,
  PILE_MAX,
  PROP_BOARDS,
  SPECIES,
  sumRow,
  TRUCK_TOKENS,
} from '@/lib/forest';
import type { AxeEnchId, ForestState } from '@/lib/forest';
import {
  barkTexture,
  benchTexture,
  boardTexture,
  cartTexture,
  workerTexture,
  findTexture,
  runeTexture,
  parcelTexture,
  tearTexture,
} from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame, squashPop } from '@/lib/juice';
import {
  axeChop,
  caseTick,
  coinDing,
  keyFound,
  pickHit,
  primeAudio,
  tierBreak,
  uiBuy,
  uiTab,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import {
  chestName,
  crewName,
  crewText,
  fmtDec,
  fmtNum,
  fmtShort,
  itemName,
  petLore,
  petName,
  rich,
  runeName,
  runeText,
  t,
  useT,
} from '@/i18n';
import {
  axeEnchName,
  axeEnchPer,
  axeName,
  benchName,
  benchWho,
  handleName,
  speciesName,
  woodOf,
} from '@/i18n/data-camp';
import { eggName } from '@/i18n/data-books';
import { bookName, findName, nameIn } from '@/i18n/data-mine';

const fmt = (n: number) => fmtNum(n);
const pct = (x: number) => `${fmtDec(Math.round(x * 1000) / 10, 2)}%`;

// ---------------------------------------------------------------------------
// Иконки.
// ---------------------------------------------------------------------------

/**
 * Кирка — пиксельный значок (`PickPx`, полоса `icon-<i>` набора «picks»). С редкой и выше
 * ореол цвета ступени (CSS): дорогую кирку видно издалека.
 */
export function PickIcon({ pick, size = 30 }: { pick: number; size?: number }) {
  const i = Math.max(0, Math.min(PICKS.length - 1, pick));
  const rar = PICKS[i].rarity;
  return (
    <span
      className={`ppick-ico r${rar}`}
      style={{ width: size, height: size, '--rc': rarityOf(rar).color } as CSSProperties}
      aria-hidden="true"
    >
      <PickPx pick={i} size={size} />
    </span>
  );
}

export function BagIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M11 9 C11 4.5 21 4.5 21 9" fill="none" stroke="#6a4424" strokeWidth="2.4" />
      <path
        d="M7 12 C7 9.6 9 8.6 11 8.6 H21 C23 8.6 25 9.6 25 12 L26.4 25 C26.6 27.6 24.8 29 22.6 29 H9.4 C7.2 29 5.4 27.6 5.6 25 Z"
        fill="#9a6a3c"
        stroke="#3f2612"
        strokeWidth="1.4"
      />
      <path d="M8.6 14.5 H23.4" stroke="#6a4424" strokeWidth="2" />
      <rect x="14" y="13" width="4" height="4" rx="1" fill="#d9b35a" stroke="#6a4424" />
      <path
        d="M9 18 C9 24 10 26 12 27"
        fill="none"
        stroke="rgba(255,255,255,.2)"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** Токен: латунная бляха со звездой. */
export function TokenIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="ptoken-ico" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#7fd6c4" stroke="#1d5a50" strokeWidth="1.4" />
      <path
        d="M8 3.6 9.2 6.6 12.4 6.8 9.9 8.8 10.7 11.9 8 10.2 5.3 11.9 6.1 8.8 3.6 6.8 6.8 6.6Z"
        fill="#e8fff8"
        stroke="#1d5a50"
        strokeWidth=".6"
      />
    </svg>
  );
}

/** Ключ от сундука — слеза гаста, как в Майнкрафте. */
export function KeyIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      className="ptear"
      src={tearTexture()}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Лист лагеря.
// ---------------------------------------------------------------------------

export type CampTab =
  | 'gear'
  | 'beasts'
  | 'stash'
  | 'rods'
  | 'trophies'
  | 'axes'
  | 'axench'
  | 'mill'
  | 'bench'
  | 'enchant'
  | 'runes'
  | 'pets'
  | 'shop'
  | 'cases'
  | 'crew'
  | 'finds'
  | 'miles'
  | 'perks';

/** Картинка вкладки: вкладку узнают по ней раньше, чем прочтут. */
const TAB_ICONS: Record<CampTab, GxIconName> = {
  gear: 'helmet',
  beasts: 'rat',
  stash: 'chest',
  rods: 'fishing',
  trophies: 'fish',
  axes: 'axe',
  axench: 'magic',
  mill: 'saw',
  bench: 'hammer',
  enchant: 'book',
  runes: 'rune',
  pets: 'paw',
  shop: 'shop',
  cases: 'chest-open',
  crew: 'miner',
  finds: 'gems',
  miles: 'trophy',
  perks: 'sparkles',
};

export type CampPlace = 'mine' | 'forest' | 'dungeon' | 'fish';

/**
 * Лагерь у шахты и у леса — РАЗНЫЙ. В шахте топоры и пилорама — чужое, в
 * лесу кирка и бригада — чужое (владелец: «если я в шахте, лагерь должен
 * быть про шахту»). Общее — сундуки, питомцы и руны: оно работает в обоих
 * местах, поэтому есть в обоих, но в лесу стоит после лесного.
 */
const PLACE_TABS: Record<CampPlace, CampTab[]> = {
  // Кузница (v2.67) — отдельный экран `ForgeScreen`, а не вкладка.
  // Рабочие временно убраны (v2.77, lib/features.ts).
  mine: [
    'enchant',
    'runes',
    'pets',
    'shop',
    'cases',
    ...(CREW_ON ? (['crew'] as CampTab[]) : []),
    'finds',
    'miles',
    'perks',
  ],
  forest: ['axes', 'axench', 'mill', 'bench', 'cases', 'pets', 'runes'],
  dungeon: ['gear', 'beasts', 'stash', 'cases', 'runes', 'pets'],
  // Руны рыбалке ничего не дают — их тут нет. Питомца здесь кормят уловом.
  fish: ['rods', 'trophies', 'pets', 'cases'],
};

/** Где живёт вкладка: для двора, который открывает лагерь со своих зданий. */
export const campPlaceOf = (tab: CampTab): CampPlace =>
  PLACE_TABS.mine.includes(tab)
    ? 'mine'
    : PLACE_TABS.forest.includes(tab)
      ? 'forest'
      : PLACE_TABS.fish.includes(tab)
        ? 'fish'
        : 'dungeon';

export function PrisonCamp({
  place = 'mine',
  only,
  title,
  tab: asked,
  onTab,
  onClose,
  onGain,
  onSpend,
}: {
  place?: CampPlace;
  /**
   * Только эти вкладки (v2.67: кнопки нижней панели шахты открывают свой
   * экран, а не весь лагерь). Одна вкладка — без ряда вкладок.
   */
  only?: CampTab[];
  /** Заголовок вместо «Лагерь». */
  title?: string;
  tab: CampTab;
  onTab: (t: CampTab) => void;
  onClose: () => void;
  /** Монеты пришли в кошелёк (сундук, бригада) — табло досчитывает. */
  onGain: (from: number, to: number) => void;
  /** Монеты ушли (покупка) — табло встаёт на новое значение. */
  onSpend: () => void;
}) {
  const t = useT();
  const { ff } = useFormFactor();
  const p = useFinanceStore((s) => s.prison);
  const f = useFinanceStore((s) => s.forest);
  const now = useNow(1000);
  const tabs = only?.length ? only : PLACE_TABS[place];
  const tab = tabs.includes(asked) ? asked : tabs[0];
  const crew = crewYield(p, now);
  const miles = milesReady(p);
  const badge: Partial<Record<CampTab, ReactNode>> = {
    bench: benchReady(f, p, now) ? '•' : null,
    cases: p.keys > 0 ? p.keys : null,
    crew: crew.blocks > 0 && crew.minutes >= 10 ? '•' : null,
    perks: perkPointsFree(p) > 0 ? perkPointsFree(p) : null,
    miles: miles > 0 ? miles : null,
    runes: runesIdle(p, axeLevelOf(f.logs).level) ? '•' : null,
  };
  // Wave 2 — C: the kit tab bar. Phones: icons only (the word is the tip / aria-label) and the
  // window's ribbon names the open tab; landscape/tablet/desktop: a rail of icon + word on the
  // left and the camp's own title on the ribbon. Tab / Shift+Tab, LB / RB switch tabs.
  const multi = tabs.length > 1;
  const compact = ff === 'phone-portrait' || ff === 'phone-landscape';
  const items: TabItem<CampTab>[] = tabs.map((id) => ({
    id,
    label: t(`camp.tab.${id}`),
    name: t(`camp.tab.${id}`),
    art: <GxIcon name={TAB_ICONS[id]} />,
    badge: badge[id] ?? undefined,
  }));
  return (
    <GxSheet
      className={`gx-camp${multi ? ' is-tabs' : ' is-single'}${compact ? ' is-compact' : ''}`}
      title={multi && compact ? t(`camp.tab.${tab}`) : (title ?? t(`camp.title.${place}`))}
      onClose={onClose}
      tabs={
        multi && (
          <Tabs
            items={items}
            value={tab}
            vertical={ff !== 'phone-portrait'}
            main
            className="gx-camp__tabs"
            onChange={(id) => {
              selectionChanged();
              uiTab();
              onTab(id);
            }}
          />
        )
      }
    >
      <div className="pcamp-body">
        {tab === 'gear' && <GearTab onSpend={onSpend} />}
        {tab === 'beasts' && <BeastTab />}
        {tab === 'stash' && <StashTab onSpend={onSpend} />}
        {tab === 'rods' && <RodsTab onSpend={onSpend} />}
        {tab === 'trophies' && <TrophiesTab />}
        {tab === 'axes' && <AxesTab onSpend={onSpend} />}
        {tab === 'axench' && <AxeEnchSection f={f} p={p} />}
        {tab === 'mill' && (
          <MillTab now={now} onGain={onGain} onSpend={onSpend} onBench={() => onTab('bench')} />
        )}
        {tab === 'bench' && <BenchTab now={now} onGain={onGain} />}
        {tab === 'enchant' && <BooksTab />}
        {tab === 'runes' && <RunesTab axeLevel={axeLevelOf(f.logs).level} />}
        {tab === 'pets' && <PetsTab />}
        {tab === 'miles' && <MilesTab onGain={onGain} />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'cases' && <ChestTab onGain={onGain} />}
        {tab === 'crew' && <CrewTab now={now} onGain={onGain} onSpend={onSpend} />}
        {tab === 'finds' && <FindsTab />}
        {tab === 'perks' && <PerksTab />}
      </div>
    </GxSheet>
  );
}

/** Текущее время с шагом `ms` — для живых счётчиков (бригада, баффы). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Row({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  text: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="pforge__row">
      <span className="pforge__ico">{icon}</span>
      <span className="pforge__info">
        <b>{title}</b>
        <i>{text}</i>
      </span>
      {action}
    </div>
  );
}

function Buy({
  price,
  can,
  onClick,
  token = false,
  count = 1,
}: {
  price: number;
  can: boolean;
  onClick: () => void;
  token?: boolean;
  /** Пачка: на кнопке «×5» перед ценой всей пачки. */
  count?: number;
}) {
  return (
    <button
      type="button"
      className="btn btn--sm pforge__buy"
      disabled={!can}
      onClick={() => {
        uiBuy();
        onClick();
      }}
    >
      {count > 1 && <small className="pforge__count">×{count}</small>}
      {fmtShort(price)} {token ? <TokenIcon size={12} /> : <CoinIcon size={12} />}
    </button>
  );
}

const Done = ({ children }: { children?: ReactNode }) => (
  <span className="pforge__done">{children ?? t('camp.have')}</span>
);

// ---- Кузница: за монеты ------------------------------------------------------

/** Руда породы (кусок в камне) или цельный блок этажа — готовые картинки. */
export function OreIcon({
  rock,
  size = 24,
  block = false,
}: {
  rock: number;
  size?: number;
  block?: boolean;
}) {
  return (
    <img
      className="pore-ico"
      src={block ? `/ui/ores/b${rock}.png` : `/ui/ores/r${rock}-0.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

/** Сколько уровней брать разом (чары топора). */
const BULK: { n: number; label: string }[] = [
  { n: 1, label: '+1' },
  { n: 5, label: '+5' },
  { n: 25, label: '+25' },
  { n: 1e9, label: 'max' },
];
const bulkLabel = (b: { label: string }) => (b.label === 'max' ? t('camp.bulkMax') : b.label);

// ---- Иконки расходников -------------------------------------------------------

const ITEM_ICON: Record<ItemId, GxIconName> = {
  bomb3: 'bomb',
  bomb5: 'dynamite',
  charge: 'explosion',
  energy: 'energy',
  lens: 'lens',
  prop: 'beam',
};
const ITEM_TONE: Record<ItemId, string> = {
  bomb3: '#3a3f55',
  bomb5: '#c0392b',
  charge: '#d35400',
  energy: '#1f6fc2',
  lens: '#1d7a68',
  prop: '#7a4a1e',
};

/** Расходник картинкой, а не эмодзи: цвет — свой у каждого. */
export function ItemIcon({ id, size }: { id: ItemId; size?: number }) {
  return <GxIcon name={ITEM_ICON[id]} size={size} style={{ color: ITEM_TONE[id] }} />;
}

// ---- Сундуки -----------------------------------------------------------------

export function rewardLabel(r: Reward): string {
  switch (r.kind) {
    case 'coins':
      return t('camp.reward.coins', { n: r.amount, v: fmtShort(r.amount) });
    case 'tokens':
      return t('camp.reward.tokens', { n: r.amount });
    case 'item':
      return r.amount > 1 ? `${itemName(r.id)} ×${r.amount}` : itemName(r.id);
    case 'find':
      return findName(r.id);
    case 'keys':
      return r.amount > 1 ? t('camp.reward.keys', { n: r.amount }) : t('camp.reward.key');
    case 'rune':
      return t('camp.reward.rune', {
        name: runeName(r.rune.kind),
        tier: RUNE_ROMAN[r.rune.tier - 1],
      });
    case 'pet':
      return petName(r.id);
    case 'egg':
      return eggName(r.egg);
    case 'treat':
      return t('camp.reward.treat');
    case 'book':
      return t('camp.reward.book', { title: bookName(r.book) });
  }
}

export function RewardIcon({ r, size = 30 }: { r: Reward; size?: number }) {
  switch (r.kind) {
    case 'coins':
      return <CoinIcon size={size} />;
    case 'tokens':
      return <TokenIcon size={size} />;
    case 'item':
      return <ItemIcon id={r.id} size={size} />;
    case 'find':
      return (
        <img className="pfind-img" src={findTexture(r.id)} width={size} height={size} alt="" />
      );
    case 'keys':
      return <KeyIcon size={size} />;
    case 'rune':
      return <RuneIcon kind={r.rune.kind} tier={r.rune.tier} size={size} />;
    case 'pet':
      return <PetIcon id={r.id} size={size} />;
    case 'egg':
      return <EggArt egg={r.egg} size={size} />;
    case 'treat':
      return (
        <span className="preward__emoji" style={{ fontSize: size * 0.9 }}>
          🐟
        </span>
      );
    case 'book':
      return <BookArt book={r.book} size={size} />;
  }
}

// ---- Бригада -------------------------------------------------------------------

function CrewTab({
  now,
  onGain,
  onSpend,
}: {
  now: number;
  onGain: (from: number, to: number) => void;
  onSpend: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonCrewUp = useFinanceStore((s) => s.prisonCrewUp);
  const prisonCrewCollect = useFinanceStore((s) => s.prisonCrewCollect);
  const prisonCrewShift = useFinanceStore((s) => s.prisonCrewShift);
  const prisonCrewFeed = useFinanceStore((s) => s.prisonCrewFeed);
  const [unload, setUnload] = useState<CrewCollect | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const y = crewYield(p, now);
  const sh = crewShiftOf(p.crewShift);
  const cap = crewCapHours(p);
  const price = p.crew < CREW_MAX ? crewCost(p.crew) : 0;
  const feed = crewFeedCost(p);
  const canFeed = p.crew > 0 && !p.crewFed && y.minutes <= CREW_FEED_WINDOW_MIN;
  const hh = Math.floor(y.minutes / 60);
  const mm = Math.floor(y.minutes % 60);
  const rate = crewRate(p.crew) * sh.rate * (p.crewFed ? 1 + CREW_FED_BOOST : 1);

  const collect = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonCrewCollect();
    if (!got) {
      notifyWarning();
      return;
    }
    onGain(from, from + got.coins);
    setNote(null);
    setUnload(got);
  };

  const pickShift = (id: CrewShift) => {
    if (id === p.crewShift) return;
    primeAudio();
    selectionChanged();
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonCrewShift(id);
    if (got) {
      onGain(from, from + got.coins);
      setNote(t('camp.crew.handed', { coins: fmtShort(got.coins), tokens: fmt(got.tokens) }));
    } else setNote(null);
  };

  return (
    <div className="pforge">
      <div className={`pcrew-scene${p.crew ? '' : ' is-empty'}${y.capped ? ' is-idle' : ''}`}>
        <span className="pcrew-scene__adit" aria-hidden="true" />
        <span className="pcrew-scene__row">
          {p.crew ? (
            Array.from({ length: Math.min(CREW_MAX, p.crew) }, (_, i) => (
              <img
                key={i}
                className="pcrew-scene__man"
                src={workerTexture(i)}
                alt=""
                style={{ animationDelay: `${i * -0.17}s` }}
              />
            ))
          ) : (
            <span className="pcrew-scene__sign">{t('camp.crew.none')}</span>
          )}
        </span>
        {y.capped && <span className="pcrew-scene__zzz">{t('camp.crew.idle')}</span>}
      </div>
      <div className="pcrew__info pcrew__head">
        <b>
          {p.crew
            ? t('camp.crew.head', { lv: p.crew, shift: crewName(sh.id) })
            : t('camp.crew.hire')}
        </b>
        <i>
          {p.crew
            ? t('camp.crew.rate', {
                rate: rate.toFixed(1),
                mine: rankLetter(p.rank),
                cap: fmtDec(cap, 3),
              }) + (p.crewFed ? t('camp.crew.fedTag') : '')
            : t('camp.crew.pitch', { pct: Math.round(CREW_SHARE * 100) })}
        </i>
      </div>
      {p.crew > 0 && (
        <div className="pcrew__yield">
          <div className="pcrew__row">
            <span>
              {t('camp.crew.time', { h: hh, m: String(mm).padStart(2, '0'), cap: fmtDec(cap, 3) })}
            </span>
            <b>
              +{fmtShort(y.coins)} <CoinIcon size={13} /> · +{fmt(y.tokens)} <TokenIcon size={12} />
            </b>
          </div>
          <span className="pcrew__bar">
            <i style={{ transform: `scaleX(${Math.min(1, y.minutes / (cap * 60))})` }} />
          </span>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={y.blocks <= 0}
            onClick={collect}
          >
            {y.blocks > 0
              ? t('camp.crew.collect', { n: y.blocks, v: fmt(y.blocks) })
              : t('camp.crew.justStarted')}
          </button>
        </div>
      )}
      {note && <p className="msaw__note">{note}</p>}
      {p.crew > 0 && (
        <>
          <h4 className="pcamp-h">{t('camp.crew.shiftsH')}</h4>
          <div className="pcrew-shifts">
            {CREW_SHIFTS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pcrew-shift${c.id === p.crewShift ? ' is-on' : ''}`}
                onClick={() => pickShift(c.id)}
              >
                <b>{crewName(c.id)}</b>
                <i>{crewText(c.id)}</i>
                <em>
                  {t('camp.crew.shiftMeta', {
                    h: fmtDec(c.hours + c.perHour * p.perks.shift, 3),
                    x: fmtDec(c.rate, 3),
                  })}
                </em>
              </button>
            ))}
          </div>
          <Row
            icon={<span className="pforge__glyph">🍲</span>}
            title={p.crewFed ? t('camp.crew.fed') : t('camp.crew.feed')}
            text={
              p.crewFed
                ? t('camp.crew.fedText')
                : canFeed
                  ? t('camp.crew.feedText')
                  : t('camp.crew.feedLate', { n: CREW_FEED_WINDOW_MIN })
            }
            action={
              p.crewFed ? (
                <Done>{t('camp.crew.fedDone')}</Done>
              ) : (
                <Buy
                  price={feed}
                  can={canFeed && balance >= feed}
                  onClick={() => {
                    primeAudio();
                    if (!prisonCrewFeed()) {
                      notifyWarning();
                      return;
                    }
                    onSpend();
                    tierBreak(1);
                    notifySuccess();
                  }}
                />
              )
            }
          />
        </>
      )}
      {p.crew < CREW_MAX ? (
        <Row
          icon={<img className="pmill-hico" src={workerTexture(p.crew)} alt="" />}
          title={p.crew ? t('camp.crew.hireMore', { lv: p.crew + 1 }) : t('camp.crew.hire')}
          text={
            t('camp.crew.hireRate', { rate: crewRate(p.crew + 1).toFixed(1) }) +
            (p.crew ? t('camp.crew.hireNow', { rate: crewRate(p.crew).toFixed(1) }) : '')
          }
          action={
            <Buy
              price={price}
              can={balance >= price}
              onClick={() => {
                primeAudio();
                if (!prisonCrewUp()) {
                  notifyWarning();
                  return;
                }
                onSpend();
                tierBreak(1);
                notifySuccess();
              }}
            />
          }
        />
      ) : (
        <p className="pcamp-note">{t('camp.crew.full')}</p>
      )}
      {unload && <CrewUnload got={unload} rock={p.rank} onClose={() => setUnload(null)} />}
    </div>
  );
}

/**
 * Приём смены: добыча приезжает вагонетками, тап опрокидывает вагонетку, и
 * её доля падает в кошелёк. В последней — находки разведки. Деньги уже
 * начислены в сторе; сцена только показывает, из чего они сложились.
 */
function CrewUnload({
  got,
  rock,
  onClose,
}: {
  got: CrewCollect;
  rock: number;
  onClose: () => void;
}) {
  const carts = Math.max(3, Math.min(6, Math.ceil(got.blocks / 150)));
  const [tipped, setTipped] = useState<boolean[]>(() => new Array(carts).fill(false));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = tipped.filter(Boolean).length;
  const all = n >= carts;
  const coinsShown = all ? got.coins : Math.round((got.coins * n) / carts);
  const tokensShown = all ? got.tokens : Math.round((got.tokens * n) / carts);
  const sh = crewShiftOf(got.shift);
  const t = useT();

  const tip = (i: number) => {
    if (tipped[i]) return;
    primeAudio();
    // Кренится вагонетка, а не плитка с рамкой.
    const el = refs.current[i]?.querySelector('img');
    if (el && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      try {
        el.animate(
          [
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(-38deg) translateY(-4px)', offset: 0.5 },
            { transform: 'rotate(-30deg)' },
          ],
          { duration: 360, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
        );
      } catch {
        /* не страшно */
      }
    }
    pickHit('stone', i === carts - 1);
    coinDing();
    tapLight();
    const next = tipped.map((x, k) => x || k === i);
    setTipped(next);
    if (next.every(Boolean)) {
      tierBreak(2);
      notifySuccess();
      burstConfetti(40, ['#ffe08a', '#b8f4e6', '#fff']);
      if (got.keys) keyFound();
    }
  };

  return createPortal(
    <div
      className="pcases pcrew-unload"
      style={{ '--tier': '#ffd98a' } as CSSProperties}
      onClick={() => all && onClose()}
    >
      <div className="pcases__card" onClick={(e) => e.stopPropagation()}>
        <span className="pcases__title">{t('camp.unload.title')}</span>
        <span className="pcases__tiers">
          <i>
            {t('camp.unload.sub', {
              shift: crewName(sh.id),
              n: got.blocks,
              v: fmt(got.blocks),
              h: Math.floor(got.minutes / 60),
              m: String(Math.floor(got.minutes % 60)).padStart(2, '0'),
            })}
          </i>
        </span>
        <div className="pcrew-carts">
          {Array.from({ length: carts }, (_, i) => (
            <button
              key={i}
              type="button"
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={`pcrew-cart${tipped[i] ? ' is-tipped' : ''}`}
              onClick={() => tip(i)}
              aria-label={t('camp.unload.cart')}
            >
              <img src={cartTexture(rock)} alt="" />
            </button>
          ))}
        </div>
        <div className="pcrew-count">
          <b>
            +{fmtShort(coinsShown)} <CoinIcon size={16} />
          </b>
          <b>
            +{fmt(tokensShown)} <TokenIcon size={15} />
          </b>
        </div>
        {!all ? (
          <>
            <span className="pcases__skip">{t('camp.unload.hint')}</span>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => {
                primeAudio();
                setTipped(new Array(carts).fill(true));
                tierBreak(1);
                coinDing();
                if (got.keys) keyFound();
              }}
            >
              {t('camp.unload.all')}
            </button>
          </>
        ) : (
          <div className="pcases__sum">
            {(got.keys > 0 || got.parcels.length > 0) && (
              <>
                <b>{t('camp.unload.found')}</b>
                {got.keys > 0 && (
                  <span className="pcases__row">
                    <KeyIcon size={22} />
                    <em>{t('camp.keysN', { n: got.keys })}</em>
                  </span>
                )}
                {got.parcels.map((id, i) => {
                  const tier = CASE_TIERS.find((x) => x.id === id)!;
                  return (
                    <span key={i} className="pcases__row">
                      <img
                        src={parcelTexture(tier.color)}
                        alt=""
                        width={24}
                        height={24}
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <em>{t('camp.unload.parcel', { tier: nameIn(chestName(tier.id)) })}</em>
                    </span>
                  );
                })}
              </>
            )}
            {got.parcelTokens > 0 && (
              <span className="pcases__note">
                {t('camp.unload.noRoom', { v: fmt(got.parcelTokens) })}
              </span>
            )}
            <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
              {t('camp.unload.back')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Руны. Рунный камень рисует `runeTexture` (пиксели 40×40: высеченный знак,
// светящаяся смальта по ступени, оковка у старших). Символы футарка шрифтом
// не берём: их нет в половине шрифтов телефона. Цвет ступени — как у
// сундуков, плюс пятая — красная.
// ---------------------------------------------------------------------------

export const RUNE_COLORS = ['#9aa7b4', '#4f8cff', '#b36cff', '#ffb020', '#ff5a6a'];

export function RuneIcon({
  kind,
  tier,
  size = 40,
}: {
  kind: RuneKind;
  tier: number;
  size?: number;
}) {
  return (
    <img
      className="prune-ico"
      src={runeTexture(kind, tier)}
      width={size}
      height={size}
      // Инлайн — чтобы общие правила строк (картинки по 18 px) не сжали камень.
      style={{ width: size, height: size }}
      alt=""
      aria-hidden="true"
    />
  );
}

const pctText = (x: number) => `+${fmtDec(Math.round(x * 1000) / 10, 1)}%`;

/** Руна словами: «Феху III · +7,1% к продаже». */
export function runeLine(r: { kind: RuneKind; tier: number; roll: number }): string {
  return `${pctText(runePower(r))} ${runeText(r.kind)}`;
}

// ---- Питомцы -------------------------------------------------------------------

/** Питомец значком (списки, награды): портрет вида без движения. */
export function PetIcon({
  id,
  size = 32,
  ghost = false,
}: {
  id: PetId;
  size?: number;
  ghost?: boolean;
}) {
  return <PetArt id={id} size={size} ghost={ghost} still />;
}

// ---------------------------------------------------------------------------
// Вскрытие посылки. Коробка трясётся три удара (редкая — дольше), потом
// вспышка — и под ней уже награда: склейка прячется во вспышке, как у жетона
// в автоматах. Награда начислена ДО сцены, в обработчике нажатия; тап
// досматривать не заставляет.
// ---------------------------------------------------------------------------

const SHAKES: Record<CaseTier, number> = { common: 2, rare: 3, epic: 4, legend: 5 };

export function ParcelReveal({ open, onClose }: { open: ParcelOpen; onClose: () => void }) {
  const t = useT();
  const tier = TIERS_OF.find((x) => x.id === open.tier)!;
  const shakes = SHAKES[open.tier];
  const [stage, setStage] = useState<'shake' | 'shown'>('shake');
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < shakes; i++) timers.push(setTimeout(() => caseTick(), i * 260));
    timers.push(
      setTimeout(
        () => {
          setStage('shown');
        },
        shakes * 260 + 120,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [shakes]);
  useEffect(() => {
    if (stage !== 'shown') return;
    tierBreak(tier.beats);
    flashFrame(tier.beats >= 2 ? 'big' : 'small');
    burstConfetti(24 + tier.beats * 30, [tier.color, '#ffe08a', '#fff']);
    if (open.reward.kind === 'keys') keyFound();
    else coinDing();
    notifySuccess();
  }, [stage, tier, open.reward.kind]);
  return createPortal(
    <div
      className={`preveal is-${open.tier}`}
      style={{ '--tier': tier.color, '--shakes': shakes } as CSSProperties}
      onClick={() => {
        if (stage === 'shake') {
          setStage('shown');
          return;
        }
        tapLight();
        onClose();
      }}
    >
      {stage === 'shake' ? (
        <img className="preveal__box" src={parcelTexture(tier.color)} alt="" />
      ) : (
        <div className="preveal__card">
          <span className="preveal__tier">
            {t('camp.reveal.tier', { tier: nameIn(chestName(tier.id)) })}
          </span>
          <span className="preveal__icon">
            <RewardIcon r={open.reward} size={64} />
          </span>
          <b className="preveal__name">{rewardLabel(open.reward)}</b>
          {open.reward.kind === 'rune' && (
            <i className="preveal__sub">{runeLine(open.reward.rune)}</i>
          )}
          {open.newPet && (
            <i className="preveal__sub">
              {t('camp.reveal.newPet', { lore: petLore(open.newPet) })}
            </i>
          )}
          {open.reward.kind === 'treat' && <i className="preveal__sub">{t('camp.reveal.treat')}</i>}
          {open.shattered > 0 && (
            <i className="preveal__sub">{t('camp.reveal.shattered', { n: open.shattered })}</i>
          )}
          <span className="preveal__cta">{t('camp.take')}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

export type { Rune };

// ---- Топоры: лесоповал -----------------------------------------------------

/** Топор или пила. Цвет лезвия — ступень; у пил свой силуэт. */
export function AxeIcon({ axe, size = 30 }: { axe: number; size?: number }) {
  const a = AXES[Math.max(0, Math.min(AXES.length - 1, axe))];
  if (a.id === 'bowsaw')
    return (
      <svg className="paxe-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <path d="M5 22 Q16 2 27 22" fill="none" stroke="#7a4a24" strokeWidth="2.6" />
        <path d="M5 22 H27" stroke={a.head} strokeWidth="2.4" />
        <path
          d="M6 24 L8 22 L10 24 L12 22 L14 24 L16 22 L18 24 L20 22 L22 24 L24 22 L26 24"
          fill="none"
          stroke="#5a6068"
          strokeWidth=".9"
        />
      </svg>
    );
  if (a.saw)
    return (
      <svg className="paxe-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <rect
          x="14"
          y="13"
          width="17"
          height="5"
          rx="2.5"
          fill="#7a8088"
          stroke="#2a2e34"
          strokeWidth=".8"
        />
        <path
          d="M15 12.5 H30 M15 18.5 H30"
          stroke="#2a2e34"
          strokeWidth=".8"
          strokeDasharray="1.2 1"
        />
        <rect
          x="3"
          y="10"
          width="13"
          height="11"
          rx="2.5"
          fill={a.head}
          stroke="#2a1a10"
          strokeWidth="1"
        />
        <path d="M5 10 Q9 5 14 10" fill="none" stroke="#2a2e34" strokeWidth="1.6" />
        <rect x="6" y="13" width="6" height="3" rx="1" fill="rgba(255,255,255,.35)" />
      </svg>
    );
  return (
    <svg className="paxe-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M8 29 L21 7" stroke="#4a2d16" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M8 29 L21 7" stroke="#b07a44" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M17 4 C21 2.6 26 4.4 28.6 8.6 L27 15.6 C24.6 12.6 21.6 11.4 18.4 11.6 Z"
        fill={a.head}
        stroke="rgba(0,0,0,.55)"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M27.6 9 L26.4 14.4"
        stroke="rgba(255,255,255,.6)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AxesTab({ onSpend }: { onSpend: () => void }) {
  const t = useT();
  const f = useFinanceStore((s) => s.forest);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const forestBuy = useFinanceStore((s) => s.forestBuy);
  const cur = AXES[f.axe];
  const next = AXES[f.axe + 1];
  const fm = forestMods(p, f);
  const dmg = axeDamage(f.axe, f.sharp) * fm.dmg;
  const buy = (what: 'axe' | 'sharp' | 'pile' | 'truck') => {
    primeAudio();
    if (!forestBuy(what)) {
      notifyWarning();
      return;
    }
    onSpend();
    coinDing();
    tierBreak(what === 'axe' ? 1 : 0);
    notifySuccess();
  };
  return (
    <div className="pforge">
      <div className="pforge__now">
        <AxeIcon axe={f.axe} size={40} />
        <span>
          <b>{axeName(f.axe)}</b>
          <i>
            {t('camp.axes.now', {
              dmg: dmg.toFixed(dmg < 10 ? 1 : 0),
              rate: (cur.rate * fm.rate).toFixed(1),
            })}
          </i>
        </span>
      </div>
      <Row
        icon={<AxeIcon axe={next ? f.axe + 1 : f.axe} size={30} />}
        title={next ? axeName(f.axe + 1) : t('camp.axes.best')}
        text={
          next
            ? t('camp.axes.next', {
                dmg: String(cur.dmg),
                dmg2: String(next.dmg),
                rate: String(cur.rate),
                rate2: String(next.rate),
              })
            : t('camp.axes.top')
        }
        action={
          next ? (
            <Buy price={next.price} can={balance >= next.price} onClick={() => buy('axe')} />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<span className="pforge__glyph">⟋</span>}
        title={t('camp.axes.sharp', { n: f.sharp, max: AXE_SHARP_MAX })}
        text={
          f.sharp < AXE_SHARP_MAX
            ? t('camp.axes.sharpText', { pct: Math.round(AXE_SHARP_STEP * 100) })
            : t('camp.axes.sharpMax')
        }
        action={
          f.sharp < AXE_SHARP_MAX ? (
            <Buy
              price={axeSharpCost(f.sharp)}
              can={balance >= axeSharpCost(f.sharp)}
              onClick={() => buy('sharp')}
            />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<span className="pforge__glyph">🪵</span>}
        title={t('camp.axes.pile', { n: pileCapacity(f.pileLevel) })}
        text={
          f.pileLevel < PILE_MAX
            ? t('camp.axes.pileText', {
                a: pileCapacity(f.pileLevel),
                n: pileCapacity(f.pileLevel + 1),
              })
            : t('camp.axes.pileMax')
        }
        action={
          f.pileLevel < PILE_MAX ? (
            <Buy
              price={pileCost(f.pileLevel)}
              can={balance >= pileCost(f.pileLevel)}
              onClick={() => buy('pile')}
            />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<span className="pforge__glyph">🚛</span>}
        title={t('camp.axes.truck')}
        text={t('camp.axes.truckText')}
        action={
          f.truck ? (
            <Done />
          ) : (
            <Buy
              price={TRUCK_TOKENS}
              token
              can={p.tokens >= TRUCK_TOKENS}
              onClick={() => buy('truck')}
            />
          )
        }
      />
      <p className="pcamp-note">
        {t('camp.axes.stats', {
          felled: fmt(f.felled),
          logs: fmt(f.logs),
          earned: fmt(f.earned),
        })}
      </p>
    </div>
  );
}

function axeEnchNow(id: AxeEnchId, f: ForestState, p: PrisonState): string {
  const l = f.ench[id];
  const fm = forestMods(p, f);
  switch (id) {
    case 'chips':
      return t('camp.axench.chips', { pct: 4 * l });
    case 'resin':
      return t('camp.axench.resin', { pct: pct(fm.tokenChance) });
    case 'sense':
      return t('camp.axench.sense', { pct: pct(fm.dodge) });
    case 'swing':
      return t('camp.axench.swing', { pct: pct(fm.swing) });
    case 'fell':
      return t('camp.axench.fell', { pct: pct(fm.fell) });
    case 'storm':
      return t('camp.axench.storm', { pct: pct(fm.storm) });
  }
}

/** Чары топора: те же токены, что у кирки, свой уровень — от брёвен. */
function AxeEnchSection({ f, p }: { f: ForestState; p: PrisonState }) {
  const t = useT();
  const forestEnchant = useFinanceStore((s) => s.forestEnchant);
  const [bulk, setBulk] = useState(1);
  const lvl = axeLevelOf(f.logs);
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <TokenIcon size={18} />{' '}
        {rich('camp.purseTokens', { n: p.tokens, v: <b>{fmt(p.tokens)}</b> })}
        <span>{t('camp.axench.shared', { resin: axeEnchName('resin') })}</span>
      </div>
      <div className="pench-pick">
        <span className="pench-pick__lv">
          <AxeIcon axe={f.axe} size={20} /> {t('camp.axench.level', { n: lvl.level })}
        </span>
        <span className="pench-pick__bar">
          <i style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
        </span>
        <span className="pench-pick__txt">
          {lvl.need
            ? t('camp.axench.more', { n: lvl.need - lvl.into, v: fmt(lvl.need - lvl.into) })
            : t('camp.axench.max')}
        </span>
      </div>
      <div className="pench-bulk" role="radiogroup" aria-label={t('camp.axench.bulk')}>
        {BULK.map((b) => (
          <button
            key={b.n}
            type="button"
            role="radio"
            aria-checked={bulk === b.n}
            className={`pench-bulk__b${bulk === b.n ? ' is-on' : ''}`}
            onClick={() => {
              selectionChanged();
              setBulk(b.n);
            }}
          >
            {bulkLabel(b)}
          </button>
        ))}
      </div>
      {AXE_ENCHANTS.map((e) => {
        const l = f.ench[e.id];
        const cap = axeEnchCap(e.id, lvl.level);
        const locked = cap === 0;
        const maxed = l >= e.max;
        // Сколько уровней возьмёт кнопка и во что встанет.
        let k = 0;
        let price = 0;
        let tokens = p.tokens;
        for (let x = l; k < bulk && x < cap; x++) {
          const c = axeEnchCost(e.id, x);
          if (tokens < c) break;
          tokens -= c;
          price += c;
          k += 1;
        }
        const nextCost = l < cap ? axeEnchCost(e.id, l) : 0;
        return (
          <div key={e.id} className={`pforge__row${locked ? ' is-locked' : ''}`}>
            <span className="pforge__ico">
              <span className="pforge__glyph pench-glyph">{locked ? '🔒' : e.glyph}</span>
            </span>
            <span className="pforge__info">
              <b>
                {axeEnchName(e.id)}{' '}
                <span className="pench-lvl">
                  {l}/{maxed || locked ? e.max : cap}
                </span>
              </b>
              <i>
                {locked
                  ? t('camp.axench.unlock', { n: e.unlock })
                  : l
                    ? axeEnchNow(e.id, f, p)
                    : axeEnchPer(e.id)}
                {!locked && !maxed && l >= cap && (
                  <span className="pench-cap">{t('camp.axench.capGrows')}</span>
                )}
              </i>
            </span>
            {maxed ? (
              <Done>{t('camp.maxDone')}</Done>
            ) : locked ? (
              <Done>{t('camp.axench.lv', { n: e.unlock })}</Done>
            ) : l >= cap ? (
              <Done>{t('camp.axench.cap')}</Done>
            ) : (
              <button
                type="button"
                className="btn btn--sm pforge__buy"
                disabled={k === 0}
                onClick={() => {
                  primeAudio();
                  const got = forestEnchant(e.id, bulk);
                  if (!got) {
                    notifyWarning();
                    return;
                  }
                  tierBreak(l + got >= e.max ? 2 : got >= 5 ? 1 : 0);
                  notifySuccess();
                }}
              >
                {k > 1 && <em className="pforge__k">+{k}</em>}
                {fmtShort(k ? price : nextCost)} <TokenIcon size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Верстак: вещи из досок --------------------------------------------------

/** Молоток — рукоять и боёк, как на иконке кирки. */
function HammerIcon({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M9 29 L20 11" stroke="#4a2d16" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M9 29 L20 11" stroke="#b07a44" strokeWidth="2.2" strokeLinecap="round" />
      <rect
        x="12"
        y="3"
        width="17"
        height="8"
        rx="1.5"
        transform="rotate(31 20.5 7)"
        fill="#8a939e"
        stroke="#2a2e34"
        strokeWidth="1.2"
      />
      <path d="M15 4.5 L26 11" stroke="rgba(255,255,255,.55)" strokeWidth="1.2" />
    </svg>
  );
}

/** Есть что сдать или собрать — точка на вкладке. */
function benchReady(f: ForestState, p: PrisonState, now: number): boolean {
  if (f.mill.level <= 0) return false;
  const mill = millTick(f.mill, now);
  const reserve = boardsReserve(p.handle);
  const { orders } = benchOrders(f.bench, f.rank);
  return orders.some((o) => now >= o.at && benchCan(mill.boards, o, reserve));
}

type Craft = { kind: 'prop' } | { kind: 'handle' } | { kind: 'order'; i: number };

/**
 * Верстак. Вещь собирают молотком: выбрал — и бьёшь по верстаку, гвоздь за
 * гвоздём, вещь проявляется. Под каждой вещью написано, куда она уйдёт:
 * владелец не понимал, что делается из досок и что с этим потом.
 */
function BenchTab({ now, onGain }: { now: number; onGain: (from: number, to: number) => void }) {
  const t = useT();
  const f = useFinanceStore((s) => s.forest);
  const p = useFinanceStore((s) => s.prison);
  const forestCraftProp = useFinanceStore((s) => s.forestCraftProp);
  const forestCraftHandle = useFinanceStore((s) => s.forestCraftHandle);
  const forestOrderFill = useFinanceStore((s) => s.forestOrderFill);
  const [craft, setCraft] = useState<Craft | null>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState<{ tex: string; title: string; where: string } | null>(null);
  const hammerRef = useRef<HTMLSpanElement>(null);
  const itemRef = useRef<HTMLImageElement>(null);
  const mill = millTick(f.mill, now);
  const reserve = boardsReserve(p.handle);
  const { orders } = benchOrders(f.bench, f.rank);
  const boards = sumRow(mill.boards);
  const nextH = HANDLES[p.handle];
  const curH = HANDLES[p.handle - 1];
  const propSpecies = topOf(boardsForSale(mill.boards, reserve));

  /** Что собираем: картинка, имя, сколько ударов, хватает ли досок, куда уйдёт. */
  const meta = (c: Craft) => {
    if (c.kind === 'prop')
      return {
        tex: benchTexture('prop', Math.max(0, propSpecies)),
        name: itemName('prop'),
        need: PROP_STRIKES,
        can: boards >= PROP_BOARDS,
        where: t('camp.bench.propWhere', { n: p.items.prop + 1 }),
        finish: () => forestCraftProp(),
      };
    if (c.kind === 'handle')
      return {
        tex: benchTexture('handle', nextH?.species ?? 3),
        name: nextH ? handleName(nextH.id) : t('camp.bench.handle'),
        need: HANDLE_STRIKES,
        can: !!nextH && mill.boards[nextH.species] >= nextH.boards,
        where: nextH ? t('camp.bench.handleWhere', { pct: Math.round(nextH.rate * 100) }) : '',
        finish: () => forestCraftHandle(),
      };
    const o = orders[c.i];
    const item = benchItemOf(o.item);
    return {
      tex: benchTexture(o.item, o.species),
      name: `${benchName(item.id)} ${benchWho(item.id)}`,
      need: item.strikes,
      can: now >= o.at && benchCan(mill.boards, o, reserve),
      where: '',
      finish: () => {
        const from = useFinanceStore.getState().slotsBalance;
        const r = forestOrderFill(c.i);
        if (!r) return false;
        onGain(from, from + r.coins);
        setDone({
          tex: benchTexture(o.item, o.species),
          title: t('camp.bench.delivered', { name: benchName(item.id) }),
          where: t('camp.bench.paid', { coins: fmtShort(r.coins), tokens: r.tokens }),
        });
        return true;
      },
    };
  };

  const start = (c: Craft) => {
    primeAudio();
    const m = meta(c);
    if (!m.can) {
      notifyWarning();
      return;
    }
    selectionChanged();
    setCraft(c);
    setHits(0);
    setDone(null);
  };

  const strike = () => {
    if (!craft) return;
    primeAudio();
    const m = meta(craft);
    const n = hits + 1;
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      try {
        hammerRef.current?.animate(
          [
            { transform: 'rotate(-35deg)' },
            { transform: 'rotate(18deg)', offset: 0.45 },
            { transform: 'rotate(0deg)' },
          ],
          { duration: 170, easing: 'cubic-bezier(.5,0,.3,1)' },
        );
        itemRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(.92, 1.06)' }, { transform: 'scale(1)' }],
          { duration: 150 },
        );
      } catch {
        /* не страшно */
      }
    }
    pickHit('metal', n >= m.need);
    tapLight();
    if (n < m.need) {
      setHits(n);
      return;
    }
    const ok = m.finish();
    setCraft(null);
    setHits(0);
    if (!ok) {
      notifyWarning();
      return;
    }
    tierBreak(2);
    notifySuccess();
    burstConfetti(40, ['#e8c89a', '#ffe08a', '#fff']);
    if (craft.kind !== 'order')
      setDone({ tex: m.tex, title: t('camp.bench.ready', { name: m.name }), where: m.where });
  };

  const cur = craft ? meta(craft) : null;
  const clock = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  if (f.mill.level <= 0)
    return (
      <div className="pforge">
        <div className="pcamp-lock">
          <GxIcon name="saw" size={40} />
          <b>{t('camp.bench.needMill')}</b>
          <span>{t('camp.bench.needMillText')}</span>
        </div>
      </div>
    );

  return (
    <div className="pforge">
      <div className="bench">
        <span className="bench__top">
          {cur ? (
            <>
              <img
                ref={itemRef}
                className="bench__item"
                src={cur.tex}
                alt=""
                style={{ opacity: 0.25 + (0.75 * hits) / cur.need }}
              />
              <span className="bench__nails">
                {Array.from({ length: cur.need }, (_, k) => (
                  <i key={k} className={k < hits ? 'is-in' : undefined} />
                ))}
              </span>
            </>
          ) : done ? (
            <img className="bench__item is-done" src={done.tex} alt="" />
          ) : (
            <span className="bench__idle">{t('camp.bench.idle')}</span>
          )}
        </span>
        <button
          type="button"
          className="bench__hammer"
          disabled={!cur}
          onClick={strike}
          aria-label={t('camp.bench.strike')}
        >
          <span ref={hammerRef} className="bench__hammerart">
            <HammerIcon size={46} />
          </span>
          <em>{cur ? t('camp.bench.hit', { n: hits, max: cur.need }) : t('camp.bench.hammer')}</em>
        </button>
      </div>
      {cur && <p className="msaw__status">{t('camp.bench.making', { name: cur.name })}</p>}
      {done && (
        <p className="msaw__note">
          <b>{done.title}.</b> {done.where}
        </p>
      )}
      <div className="pcamp-purse bench__purse">
        <img
          src={boardTexture(Math.max(0, topOf(mill.boards)))}
          alt=""
          className="bench__purseimg"
        />
        <b>{fmt(boards)}</b> {t('camp.bench.stock', { n: boards })}
        <span>{t('camp.bench.stockText')}</span>
      </div>

      <h4 className="pcamp-h">{t('camp.bench.forMe')}</h4>
      <Row
        icon={
          <img className="pmill-hico" src={benchTexture('prop', Math.max(0, propSpecies))} alt="" />
        }
        title={
          <>
            {itemName('prop')}{' '}
            {p.items.prop > 0 && (
              <span className="pench-lvl">{t('camp.bench.inMine', { n: p.items.prop })}</span>
            )}
          </>
        }
        text={t('camp.bench.propText', { n: PROP_BOARDS })}
        action={
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={boards < PROP_BOARDS || !!craft}
            onClick={() => start({ kind: 'prop' })}
          >
            {t('camp.bench.make')}
          </button>
        }
      />
      {nextH ? (
        <Row
          icon={<img className="pmill-hico" src={benchTexture('handle', nextH.species)} alt="" />}
          title={handleName(nextH.id)}
          text={
            t('camp.bench.handleText', {
              have: fmt(Math.min(mill.boards[nextH.species], nextH.boards)),
              n: nextH.boards,
              wood: woodOf(nextH.species),
              pct: Math.round(nextH.rate * 100),
            }) +
            (curH
              ? t('camp.bench.handleNow', {
                  name: nameIn(handleName(curH.id)),
                  pct: Math.round(handleRate(p.handle) * 100),
                })
              : '')
          }
          action={
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={mill.boards[nextH.species] < nextH.boards || !!craft}
              onClick={() => start({ kind: 'handle' })}
            >
              {t('camp.bench.make')}
            </button>
          }
        />
      ) : (
        <Row
          icon={<img className="pmill-hico" src={benchTexture('handle', 9)} alt="" />}
          title={handleName('karelian')}
          text={t('camp.bench.handleBest')}
          action={<Done />}
        />
      )}

      <h4 className="pcamp-h">{t('camp.bench.orders')}</h4>
      {orders.map((o, i) => {
        const item = benchItemOf(o.item);
        const wait = o.at - now;
        const have =
          o.species >= 0 ? mill.boards[o.species] : sumRow(boardsForSale(mill.boards, reserve));
        const can = wait <= 0 && have >= o.boards;
        return (
          <div key={i} className={`pforge__row bench__order${wait > 0 ? ' is-wait' : ''}`}>
            <span className="pforge__ico">
              <img className="pmill-hico" src={benchTexture(o.item, o.species)} alt="" />
            </span>
            <span className="pforge__info">
              <b>
                {benchName(item.id)} <span className="bench__who">{benchWho(item.id)}</span>
              </b>
              <i>
                {wait > 0
                  ? t('camp.bench.wait', { time: clock(wait) })
                  : t(o.species >= 0 ? 'camp.bench.orderWood' : 'camp.bench.orderAny', {
                      have: fmt(Math.min(have, o.boards)),
                      n: o.boards,
                      wood: o.species >= 0 ? woodOf(o.species) : '',
                      coins: fmtShort(o.coins),
                      tokens: o.tokens,
                    })}
              </i>
            </span>
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={!can || !!craft}
              onClick={() => start({ kind: 'order', i })}
            >
              {wait > 0 ? clock(wait) : t('camp.bench.make')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---- Лесопилка: пилорама, доски, верстак -------------------------------------

/** Дисковая пила: зубья по кругу, ступица. */
export function MillIcon({ size = 30 }: { size?: number }) {
  const teeth = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const b = a + Math.PI / 12;
    const p = (r: number, t: number) =>
      `${(16 + r * Math.cos(t)).toFixed(2)} ${(16 + r * Math.sin(t)).toFixed(2)}`;
    return `M${p(11, a)} L${p(14.5, a + 0.12)} L${p(11, b)}`;
  }).join(' ');
  return (
    <svg className="pmill-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d={teeth} fill="#c8ccd0" stroke="#2a2e34" strokeWidth=".7" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="11.2" fill="#aeb4ba" stroke="#2a2e34" strokeWidth=".9" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
      <circle cx="16" cy="16" r="3.4" fill="#d8402a" stroke="#2a1a10" strokeWidth=".8" />
      <path d="M9 11 L12 9" stroke="rgba(255,255,255,.7)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const minutes = (m: number) =>
  m < 1
    ? t('camp.mill.lessMin')
    : m < 60
      ? t('camp.mill.min', { n: Math.ceil(m) })
      : t('camp.mill.hm', { h: Math.floor(m / 60), m: Math.ceil(m % 60) });

/** Самая дорогая порода в ряду (пила берёт её первой), −1 — ряд пуст. */
const topOf = (row: number[]): number => {
  for (let i = row.length - 1; i >= 0; i--) if (row[i] > 0) return i;
  return -1;
};

/**
 * Пилорама как сцена, а не как список цифр: слева брёвна в очереди, по
 * ленте они едут в диск, справа выходят доски. Пока очередь не пуста, лента
 * идёт в темпе пилы (но не чаще раза в полсекунды — быстрее глаз не видит).
 * Тап по диску подаёт бревно рукой: диск рвётся, летят опилки, справа
 * выскакивает доска. Так понятно, что куда уходит и зачем.
 */
function MillScene({
  level,
  queue,
  boards,
  pileTop,
  onFeed,
  stockRef,
}: {
  level: number;
  queue: number[];
  boards: number[];
  pileTop: number;
  onFeed: () => { species: number } | null;
  stockRef?: React.Ref<HTMLSpanElement>;
}) {
  const t = useT();
  const discRef = useRef<HTMLSpanElement>(null);
  const outRef = useRef<HTMLSpanElement>(null);
  const bladeRef = useRef<HTMLButtonElement>(null);
  const lastFeed = useRef(0);
  const queued = sumRow(queue);
  const made = sumRow(boards);
  const busy = level > 0 && queued > 0;
  const inTop = topOf(queue) >= 0 ? topOf(queue) : Math.max(0, pileTop);
  const outTop = topOf(boards) >= 0 ? topOf(boards) : inTop;
  const beat = Math.max(0.5, 60 / Math.max(1, millRate(level)));

  const feed = () => {
    const now = performance.now();
    if (now - lastFeed.current < 110) return;
    lastFeed.current = now;
    primeAudio();
    const got = onFeed();
    if (!got) {
      notifyWarning();
      return;
    }
    axeChop(true, false);
    tapLight();
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) return;
    // Рывок диска — на вложенном слое: у внешнего своё вечное вращение.
    try {
      discRef.current?.animate(
        [
          { transform: 'rotate(0deg) scale(1)' },
          { transform: 'rotate(200deg) scale(1.08)' },
          { transform: 'rotate(360deg) scale(1)' },
        ],
        { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
    } catch {
      /* не страшно */
    }
    // Опилки веером вверх из-под диска.
    const blade = bladeRef.current;
    if (blade) {
      for (let k = 0; k < 7; k++) {
        const d = document.createElement('i');
        d.className = 'msaw__chip';
        d.style.background = SPECIES[got.species]?.wood ?? '#e8c89a';
        blade.appendChild(d);
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        const r = 26 + Math.random() * 26;
        const gone = () => d.remove();
        try {
          const an = d.animate(
            [
              { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
              {
                transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.4)`,
                opacity: 0,
              },
            ],
            { duration: 380 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.4,1)' },
          );
          an.onfinish = gone;
          an.oncancel = gone;
        } catch {
          gone();
        }
        setTimeout(gone, 900);
      }
    }
    // Доска выскакивает на выходную ленту.
    const out = outRef.current;
    if (out) {
      const b = document.createElement('img');
      b.className = 'msaw__plank is-hand';
      b.src = boardTexture(got.species);
      b.alt = '';
      out.appendChild(b);
      const gone = () => b.remove();
      try {
        const an = b.animate(
          [
            { transform: 'translate(-40%, 0) scale(.6)', opacity: 0 },
            { transform: 'translate(10%, -30%) scale(1.1)', opacity: 1, offset: 0.35 },
            { transform: 'translate(120%, 0) scale(.9)', opacity: 0 },
          ],
          { duration: 520, easing: 'cubic-bezier(.3,.7,.4,1)' },
        );
        an.onfinish = gone;
        an.oncancel = gone;
      } catch {
        gone();
      }
      setTimeout(gone, 900);
    }
  };

  return (
    <div
      className={`msaw${busy ? ' is-busy' : ''}${level <= 0 ? ' is-off' : ''}`}
      style={{ '--beat': `${beat}s` } as CSSProperties}
    >
      <span className="msaw__stock" ref={stockRef}>
        <span className="msaw__pile" aria-hidden="true">
          <img src={barkTexture(inTop)} alt="" />
          <img src={barkTexture(inTop)} alt="" />
          <img src={barkTexture(inTop)} alt="" />
        </span>
        <b>{fmt(queued)}</b>
        <i>{t('camp.mill.logs', { n: queued })}</i>
      </span>
      <span className="msaw__belt" aria-hidden="true">
        {busy && (
          <span className="msaw__mover">
            <img className="msaw__log" src={barkTexture(inTop)} alt="" />
          </span>
        )}
      </span>
      <button
        type="button"
        className="msaw__blade"
        ref={bladeRef}
        onClick={feed}
        disabled={level <= 0}
        aria-label={t('camp.mill.feed')}
      >
        <span className="msaw__spin">
          <span className="msaw__disc" ref={discRef}>
            <MillIcon size={58} />
          </span>
        </span>
        <em>{level > 0 ? t('camp.mill.tap') : t('camp.mill.noSaw')}</em>
      </button>
      <span className="msaw__belt is-out" aria-hidden="true" ref={outRef}>
        {busy && (
          <span className="msaw__mover is-late">
            <img className="msaw__plank" src={boardTexture(inTop)} alt="" />
          </span>
        )}
      </span>
      <span className="msaw__stock is-out">
        <span className="msaw__pile" aria-hidden="true">
          <img src={boardTexture(outTop)} alt="" />
          <img src={boardTexture(outTop)} alt="" />
        </span>
        <b>{fmt(made)}</b>
        <i>{t('camp.mill.boards', { n: made })}</i>
      </span>
    </div>
  );
}

function MillTab({
  now,
  onGain,
  onSpend,
  onBench,
}: {
  now: number;
  onGain: (from: number, to: number) => void;
  onSpend: () => void;
  onBench: () => void;
}) {
  const t = useT();
  const f = useFinanceStore((s) => s.forest);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const forestMillUp = useFinanceStore((s) => s.forestMillUp);
  const forestMillLoad = useFinanceStore((s) => s.forestMillLoad);
  const forestMillSell = useFinanceStore((s) => s.forestMillSell);
  const forestMillFeed = useFinanceStore((s) => s.forestMillFeed);
  const stockRef = useRef<HTMLSpanElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const mill = millTick(f.mill, now);
  const fm = forestMods(p, f);
  const reserve = boardsReserve(p.handle);
  const sale = boardsForSale(mill.boards, reserve);
  const saleValue = Math.round(boardsValue(sale) * fm.sell);
  const queued = sumRow(mill.queue);
  const cap = millQueueCap(mill.level);
  const rate = millRate(mill.level);
  const nextH = HANDLES[p.handle];
  const kept = reserve.reduce((a, k, i) => a + Math.min(k, mill.boards[i]), 0);

  const up = () => {
    primeAudio();
    if (!forestMillUp()) {
      notifyWarning();
      return;
    }
    onSpend();
    coinDing();
    tierBreak(1);
    notifySuccess();
  };
  const load = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const r = forestMillLoad();
    if (!r.loaded) {
      notifyWarning();
      return;
    }
    if (r.premium) onGain(from, from + r.premium);
    tapLight();
    notifySuccess();
    squashPop(stockRef.current, 0.6);
    setNote(
      r.premium
        ? t('camp.mill.loadedPremium', {
            n: r.loaded,
            v: fmt(r.loaded),
            coins: fmtShort(r.premium),
          })
        : t('camp.mill.loaded', { n: r.loaded, v: fmt(r.loaded) }),
    );
  };
  const feed = () => {
    const from = useFinanceStore.getState().slotsBalance;
    const r = forestMillFeed();
    if (!r) {
      setNote(t('camp.mill.nothing'));
      return null;
    }
    if (r.loaded) {
      squashPop(stockRef.current, 0.6);
      setNote(t('camp.mill.pileLoaded', { n: r.loaded, v: fmt(r.loaded) }));
    }
    if (r.premium) onGain(from, from + r.premium);
    return r;
  };
  const pileTop = topOf(f.pile.sp);
  const sell = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const v = forestMillSell();
    if (!v) {
      notifyWarning();
      return;
    }
    onGain(from, from + v);
    coinDing();
    notifySuccess();
  };

  if (mill.level <= 0) {
    return (
      <div className="pforge">
        <MillScene
          level={0}
          queue={mill.queue}
          boards={mill.boards}
          pileTop={pileTop}
          onFeed={() => null}
        />
        <Row
          icon={<MillIcon size={30} />}
          title={t('camp.mill.build')}
          text={t('camp.mill.buildText', {
            n: Math.round(millRate(1)),
            x: fmtDec(BOARD_MULT, 3),
          })}
          action={<Buy price={millCost(0)} can={balance >= millCost(0)} onClick={up} />}
        />
      </div>
    );
  }

  return (
    <div className="pforge">
      <MillScene
        level={mill.level}
        queue={mill.queue}
        boards={mill.boards}
        pileTop={pileTop}
        onFeed={feed}
        stockRef={stockRef}
      />
      <p className="msaw__status">
        {t('camp.mill.rate', { n: Math.round(rate) })}
        {queued ? t('camp.mill.eta', { time: minutes(queued / rate) }) : t('camp.mill.stopped')}
      </p>
      <button
        type="button"
        className="btn btn--block msaw__load"
        disabled={!f.pile.n || queued >= cap}
        onClick={load}
      >
        {!f.pile.n
          ? t('camp.mill.pileEmpty')
          : queued >= cap
            ? t('camp.mill.queueFull')
            : t('camp.mill.load', { n: f.pile.n, v: fmt(f.pile.n) })}
      </button>
      {note && <p className="msaw__note">{note}</p>}
      {/* Разбивка по породам — только когда пород больше одной: одну и так
          показывает сцена, а для рукоятей важно, чьи именно доски. */}
      {mill.boards.filter((k) => k > 0).length > 1 && (
        <div className="pmill-boards">
          {mill.boards.map((k, i) =>
            k > 0 ? (
              <span key={i} className="pmill-board" title={speciesName(i)}>
                <img src={boardTexture(i)} alt="" />
                {fmt(k)} · {nameIn(speciesName(i))}
              </span>
            ) : null,
          )}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={!saleValue}
        onClick={sell}
      >
        {saleValue ? (
          <>
            {t('camp.mill.sell', { coins: fmtShort(saleValue) })} <CoinIcon size={13} />
          </>
        ) : (
          t('camp.mill.sellNone')
        )}
      </button>
      {kept > 0 && nextH && (
        <p className="pmill-keep">
          {t('camp.mill.kept', { n: kept, v: fmt(kept), wood: woodOf(nextH.species) })}
        </p>
      )}
      {mill.level < MILL_MAX ? (
        <Row
          icon={<MillIcon size={30} />}
          title={t('camp.mill.up', { n: mill.level + 1 })}
          text={t('camp.mill.upText', {
            a: Math.round(rate),
            n: Math.round(millRate(mill.level + 1)),
          })}
          action={
            <Buy price={millCost(mill.level)} can={balance >= millCost(mill.level)} onClick={up} />
          }
        />
      ) : (
        <Row
          icon={<MillIcon size={30} />}
          title={t('camp.mill.max')}
          text={t('camp.mill.maxText')}
          action={<Done />}
        />
      )}

      <button type="button" className="btn btn--block msaw__tobench" onClick={onBench}>
        {t('camp.mill.toBench')}
      </button>
    </div>
  );
}
