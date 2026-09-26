// «Лагерь» каторги: всё, что не шахта. Кузница, чары, лавка, сундуки,
// бригада, коллекция и перки — один лист с вкладками. Его открывает кнопка в
// шахте, а позже — здания двора, каждое на своей вкладке.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { GxIcon, GxSheet } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { rarityOf } from '@/lib/rarity';
import { useFinanceStore } from '@/store';
import { BeastTab, GearTab, StashTab } from '@/components/DungeonCamp';
import { RodsTab, TrophiesTab } from '@/components/FishingCamp';
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
  bonusOf,
  CASE_TIERS as TIERS_OF,
  ENCHANTS,
  enchantCap,
  enchantCost,
  enchantMax,
  PICK_LEVEL_MAX,
  PICK_STARS_MAX,
  STAR_CAP,
  STAR_DMG,
  STAR_KEYS,
  STAR_TOKENS,
  fusePlan,
  MILES,
  mileReady,
  milesReady,
  petLevelOf,
  petOf,
  petPower,
  PETS,
  RUNE_BAG,
  RUNE_ROMAN,
  RUNE_SHATTER,
  runeOf,
  runePower,
  SOCKET_UNLOCK,
  socketsOpen,
  enchantRefund,
  ENCHANT_TOGGLE,
  ENCHANT_UNLOCK,
  FINDS,
  findsFound,
  findsMult,
  handleRate,
  HANDLES,
  ITEMS,
  modsOf,
  PERKS,
  perkPointsFree,
  pickLevelOf,
  PICKS,
  PRESTIGE_KEYS,
  rankLetter,
  rollCase,
  shortMoney,
} from '@/lib/prison';
import type {
  Bonus,
  CaseRoll,
  CrewShift,
  CaseTier,
  EnchantId,
  ItemId,
  PerkId,
  PetId,
  PrisonState,
  Reward,
  Rune,
  RuneKind,
} from '@/lib/prison';
import type { CasesOpened, CrewCollect, ParcelOpen } from '@/store';
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
  petTexture,
  tearTexture,
} from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame, squashPop } from '@/lib/juice';
import {
  axeChop,
  caseTick,
  coinDing,
  keyFound,
  payoutEnd,
  pickHit,
  primeAudio,
  tierBreak,
  uiBuy,
  uiTab,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const pct = (x: number) =>
  `${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;

// ---------------------------------------------------------------------------
// Иконки.
// ---------------------------------------------------------------------------

/**
 * Кирка — готовая картинка Kenney (CC0) с перекрашенной головкой
 * (`scripts/picks-assets.py`). С золотой и выше головка светится: дорогую
 * кирку видно издалека. `sharp` — заточка уголком.
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
      <img src={`/ui/picks/p${i}.png`} alt="" draggable={false} />
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

const TAB_NAMES: Record<CampTab, string> = {
  gear: 'Снаряжение',
  beasts: 'Враги',
  stash: 'Склад',
  rods: 'Снасти',
  trophies: 'Журнал',
  axes: 'Топоры',
  axench: 'Чары',
  mill: 'Лесопилка',
  bench: 'Верстак',
  enchant: 'Чары',
  runes: 'Руны',
  pets: 'Питомцы',
  shop: 'Лавка',
  cases: 'Сундуки',
  crew: 'Рабочие',
  finds: 'Коллекция',
  miles: 'Достижения',
  perks: 'Навыки',
};

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
  enchant: 'magic',
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
  mine: ['enchant', 'runes', 'pets', 'shop', 'cases', 'crew', 'finds', 'miles', 'perks'],
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
  return (
    <GxSheet
      className={`gx-camp${tabs.length === 1 ? ' is-single' : ''}`}
      title={
        title ??
        (place === 'forest'
          ? 'Лагерь лесоруба'
          : place === 'dungeon'
            ? 'Снаряжение'
            : place === 'fish'
              ? 'Лагерь рыбака'
              : 'Лагерь')
      }
      onClose={onClose}
      tabs={
        tabs.length > 1 && (
          <div className="gx-tabs" role="tablist">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`gx-tab${tab === id ? ' is-on' : ''}`}
                onClick={() => {
                  selectionChanged();
                  uiTab();
                  onTab(id);
                }}
              >
                <GxIcon name={TAB_ICONS[id]} />
                {TAB_NAMES[id]}
                {badge[id] != null && <span className="gx-badge">{badge[id]}</span>}
              </button>
            ))}
          </div>
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
        {tab === 'enchant' && <EnchantTab />}
        {tab === 'runes' && <RunesTab axeLevel={axeLevelOf(f.logs).level} />}
        {tab === 'pets' && <PetsTab />}
        {tab === 'miles' && <MilesTab onGain={onGain} />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'cases' && <CasesTab onGain={onGain} />}
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
}: {
  price: number;
  can: boolean;
  onClick: () => void;
  token?: boolean;
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
      {shortMoney(price)} {token ? <TokenIcon size={12} /> : <CoinIcon size={12} />}
    </button>
  );
}

const Done = ({ children = 'Есть' }: { children?: ReactNode }) => (
  <span className="pforge__done">{children}</span>
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

// ---- Чары: за токены ---------------------------------------------------------

function enchantNow(id: EnchantId, p: PrisonState): string {
  const l = p.ench[id];
  const m = modsOf(p);
  switch (id) {
    case 'power':
      return `+${10 * l}% к скорости копки`;
    case 'fortune':
      return `+${6 * l}% лишних блоков`;
    case 'vein':
      return `${pct(m.vein)} · до ${m.veinMax} блоков жилы`;
    case 'blast':
      return `${pct(m.blast)} · квадрат 3×3`;
    case 'hammer':
      return `${pct(m.hammer)} · весь верхний ярус`;
    case 'token':
      return `токен с ${pct(m.tokenChance)} блоков`;
    case 'key':
      return `ключ с ${pct(m.keyChance)} блоков`;
    case 'frenzy':
      return `${pct(m.frenzy)} · 15 с двойной добычи`;
    case 'crack':
      return `${pct(m.crack)} · удар по четырём соседям`;
    case 'beam':
      return `${pct(m.beam)} · весь ряд`;
    case 'reforge':
      return `${pct(m.reforge)} блоков — порода выше`;
    case 'rockfall':
      return `${pct(m.rockfall)} · четыре взрыва по полю`;
    case 'echo':
      return `шансы чар поля ×${(1 + 0.05 * l).toFixed(2)}`;
  }
}

/** Сколько уровней чары возьмёт кнопка и во что это встанет. */
function enchantPlan(
  id: EnchantId,
  p: PrisonState,
  want: number,
): { k: number; price: number; next: number } {
  const cap = enchantCap(id, pickLevelOf(p.pickXp).level, p.pickStars);
  let l = p.ench[id];
  let tokens = p.tokens;
  let k = 0;
  let price = 0;
  const next = l < cap ? enchantCost(id, l) : 0;
  while (k < want && l < cap) {
    const c = enchantCost(id, l);
    if (tokens < c) break;
    tokens -= c;
    price += c;
    l += 1;
    k += 1;
  }
  return { k, price, next };
}

const BULK: { n: number; label: string }[] = [
  { n: 1, label: '+1' },
  { n: 5, label: '+5' },
  { n: 25, label: '+25' },
  { n: 1e9, label: 'Макс' },
];

function EnchantTab() {
  const p = useFinanceStore((s) => s.prison);
  const prisonEnchant = useFinanceStore((s) => s.prisonEnchant);
  const prisonEnchantReset = useFinanceStore((s) => s.prisonEnchantReset);
  const prisonEnchantToggle = useFinanceStore((s) => s.prisonEnchantToggle);
  const prisonPickStar = useFinanceStore((s) => s.prisonPickStar);
  const [confirm, setConfirm] = useState<EnchantId | null>(null);
  const [starArmed, setStarArmed] = useState(false);
  const [bulk, setBulk] = useState(1);
  const lvl = pickLevelOf(p.pickXp);
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <TokenIcon size={18} /> <b>{fmt(p.tokens)}</b> токенов
        <span>падают с блоков, Токенист — чаще</span>
      </div>
      <div className="pench-pick">
        <span className="pench-pick__lv">
          <PickIcon pick={p.pick} size={20} /> Кирка ур. {lvl.level}
          {p.pickStars > 0 && <em className="pench-stars">{'★'.repeat(p.pickStars)}</em>}
        </span>
        <span className="pench-pick__bar">
          <i style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
        </span>
        <span className="pench-pick__txt">
          {lvl.need ? `ещё ${fmt(lvl.need - lvl.into)} блоков` : 'максимум'}
        </span>
      </div>
      {lvl.level >= PICK_LEVEL_MAX && p.pickStars < PICK_STARS_MAX && (
        <div className="pstar">
          <span>
            <b>Перековать кирку ★{p.pickStars + 1}</b>
            <i>
              Уровень кирки — в ноль, зато потолок каждой чары +{Math.round(STAR_CAP * 100)}%,
              скорость копки +{Math.round(STAR_DMG * 100)}%, {fmt(STAR_TOKENS * (p.pickStars + 1))}{' '}
              токенов и {STAR_KEYS} ключа. Купленные уровни чар остаются.
            </i>
          </span>
          <button
            type="button"
            className={`btn btn--sm pforge__buy${starArmed ? ' is-armed' : ''}`}
            onClick={() => {
              primeAudio();
              if (!starArmed) {
                setStarArmed(true);
                return;
              }
              setStarArmed(false);
              if (!prisonPickStar()) {
                notifyWarning();
                return;
              }
              tierBreak(3);
              burstConfetti(80, ['#ffe08a', '#ffffff', '#b8f4e6']);
              flashFrame('big');
              notifySuccess();
            }}
          >
            {starArmed ? 'Точно?' : 'Перековать'}
          </button>
        </div>
      )}
      <div className="pench-bulk" role="radiogroup" aria-label="Сколько уровней брать">
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
            {b.label}
          </button>
        ))}
      </div>
      {ENCHANTS.map((e) => {
        const l = p.ench[e.id];
        const cap = enchantCap(e.id, lvl.level, p.pickStars);
        const max = enchantMax(e.id, p.pickStars);
        const locked = cap === 0;
        const maxed = l >= max;
        const plan = enchantPlan(e.id, p, bulk);
        const off = p.off.includes(e.id);
        const toggle = ENCHANT_TOGGLE.includes(e.id) && l > 0;
        return (
          <div
            key={e.id}
            className={`pforge__row${locked ? ' is-locked' : ''}${off ? ' is-off' : ''}`}
          >
            <span className="pforge__ico">
              <span className="pforge__glyph pench-glyph">{locked ? '🔒' : e.glyph}</span>
            </span>
            <span className="pforge__info">
              <b>
                {e.name}{' '}
                <span className="pench-lvl">
                  {l}/{maxed || locked ? max : cap}
                </span>
              </b>
              <i>
                {locked
                  ? `Откроется на ${ENCHANT_UNLOCK[e.id]} уровне кирки`
                  : l
                    ? off
                      ? 'отключено — не срабатывает'
                      : enchantNow(e.id, p)
                    : e.per}
                {!locked && !maxed && l >= cap && (
                  <span className="pench-cap"> · потолок растёт с уровнем кирки</span>
                )}
              </i>
              {(toggle || l > 0) && (
                <span className="pench-tools">
                  {toggle && (
                    <button
                      type="button"
                      className={`pench-switch${off ? '' : ' is-on'}`}
                      aria-pressed={!off}
                      onClick={() => {
                        selectionChanged();
                        prisonEnchantToggle(e.id);
                      }}
                    >
                      <i />
                      {off ? 'выкл' : 'вкл'}
                    </button>
                  )}
                  {l > 0 && (
                    <button
                      type="button"
                      className={`pench-reset${confirm === e.id ? ' is-armed' : ''}`}
                      onClick={() => {
                        if (confirm !== e.id) {
                          setConfirm(e.id);
                          return;
                        }
                        setConfirm(null);
                        prisonEnchantReset(e.id);
                        notifySuccess();
                      }}
                    >
                      {confirm === e.id ? `вернуть ${fmt(enchantRefund(e.id, l))}?` : 'сбросить'}
                    </button>
                  )}
                </span>
              )}
            </span>
            {maxed ? (
              <Done>Макс.</Done>
            ) : locked ? (
              <Done>ур. {ENCHANT_UNLOCK[e.id]}</Done>
            ) : l >= cap ? (
              <Done>Потолок</Done>
            ) : (
              <button
                type="button"
                className="btn btn--sm pforge__buy"
                disabled={plan.k === 0}
                onClick={() => {
                  primeAudio();
                  const got = prisonEnchant(e.id, bulk);
                  if (!got) {
                    notifyWarning();
                    return;
                  }
                  tierBreak(l + got >= max ? 2 : got >= 5 ? 1 : 0);
                  notifySuccess();
                }}
              >
                {plan.k > 1 && <em className="pforge__k">+{plan.k}</em>}
                {shortMoney(plan.k ? plan.price : plan.next)} <TokenIcon size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

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

// ---- Лавка: расходники за токены --------------------------------------------

function ShopTab() {
  const p = useFinanceStore((s) => s.prison);
  const prisonBuyItem = useFinanceStore((s) => s.prisonBuyItem);
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <TokenIcon size={18} /> <b>{fmt(p.tokens)}</b> токенов
      </div>
      {ITEMS.filter((it) => it.price > 0).map((it) => (
        <Row
          key={it.id}
          icon={<ItemIcon id={it.id} size={30} />}
          title={
            <>
              {it.name} {p.items[it.id] > 0 && <span className="pench-lvl">×{p.items[it.id]}</span>}
            </>
          }
          text={it.text}
          action={
            <Buy
              token
              price={it.price}
              can={p.tokens >= it.price}
              onClick={() => {
                primeAudio();
                if (!prisonBuyItem(it.id)) {
                  notifyWarning();
                  return;
                }
                coinDing();
                tapLight();
              }}
            />
          }
        />
      ))}
    </div>
  );
}

// ---- Сундуки -----------------------------------------------------------------

function CasesTab({ onGain }: { onGain: (from: number, to: number) => void }) {
  const p = useFinanceStore((s) => s.prison);
  const prisonOpenCases = useFinanceStore((s) => s.prisonOpenCases);
  const [open, setOpen] = useState<OpenedCase | null>(null);
  const [batch, setBatch] = useState<CasesOpened | null>(null);
  return (
    <div className="pforge">
      <div className="pchest">
        <ChestArt />
        <div className="pchest__info">
          <b>
            <KeyIcon size={16} /> {p.keys}{' '}
            {p.keys === 1 ? 'ключ' : p.keys >= 2 && p.keys <= 4 ? 'ключа' : 'ключей'}
          </b>
          <i>Ключи падают с блоков, по одному даётся за ранг и {PRESTIGE_KEYS} за престиж.</i>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={p.keys <= 0}
            onClick={() => {
              primeAudio();
              tapLight();
              const o = openCase();
              if (o) setOpen(o);
              else notifyWarning();
            }}
          >
            Открыть сундук
          </button>
          {p.keys >= 2 && (
            <button
              type="button"
              className="btn btn--block pchest__all"
              onClick={() => {
                primeAudio();
                tapLight();
                const from = useFinanceStore.getState().slotsBalance;
                const got = prisonOpenCases(p.keys);
                if (!got) {
                  notifyWarning();
                  return;
                }
                const to = useFinanceStore.getState().slotsBalance;
                if (to > from) onGain(from, to);
                setBatch(got);
              }}
            >
              Открыть все · {fmt(p.keys)}
            </button>
          )}
        </div>
      </div>
      <div className="pchest__odds">
        {CASE_TIERS.map((t) => (
          <span key={t.id} style={{ color: t.color }}>
            {t.name} · {t.weight}%
          </span>
        ))}
      </div>
      {open && <CaseRoller first={open} onClose={() => setOpen(null)} onGain={onGain} />}
      {batch && <CasesSummary got={batch} onClose={() => setBatch(null)} />}
    </div>
  );
}

// ---- Сундуки разом: плитки и итог ------------------------------------------

interface CaseSum {
  tiers: Record<CaseTier, number>;
  /** Что складывается — одной строкой на вид. */
  summed: Reward[];
  /** Что не складывается — каждое отдельно. */
  single: Reward[];
}

/** Сложить награды сундуков: монеты к монетам, бомбы к бомбам. */
function sumCases(rolls: CaseRoll[]): CaseSum {
  const tiers: Record<CaseTier, number> = { common: 0, rare: 0, epic: 0, legend: 0 };
  let coins = 0;
  let tokens = 0;
  let keys = 0;
  let treats = 0;
  const items = new Map<ItemId, number>();
  const single: Reward[] = [];
  for (const r of rolls) {
    tiers[r.tier] += 1;
    const x = r.reward;
    if (x.kind === 'coins') coins += x.amount;
    else if (x.kind === 'tokens') tokens += x.amount;
    else if (x.kind === 'keys') keys += x.amount;
    else if (x.kind === 'treat') treats += 1;
    else if (x.kind === 'item') items.set(x.id, (items.get(x.id) ?? 0) + x.amount);
    else single.push(x);
  }
  const summed: Reward[] = [];
  if (coins) summed.push({ kind: 'coins', amount: coins });
  if (tokens) summed.push({ kind: 'tokens', amount: tokens });
  if (keys) summed.push({ kind: 'keys', amount: keys });
  for (const [id, amount] of items) summed.push({ kind: 'item', id, amount });
  if (treats) summed.push({ kind: 'treat', amount: treats });
  // Старшие руны — вперёд: их ищут глазами первыми.
  single.sort((a, b) =>
    a.kind === 'rune' && b.kind === 'rune' ? b.rune.tier - a.rune.tier : a.kind < b.kind ? -1 : 1,
  );
  return { tiers, summed, single };
}

/** Сколько плиток показываем; остальные — «и ещё N». */
const CASES_TILES = 48;

function CasesSummary({ got, onClose }: { got: CasesOpened; onClose: () => void }) {
  const [done, setDone] = useState(false);
  const sum = sumCases(got.rolls);
  const shown = got.rolls.slice(0, CASES_TILES);
  const best = [...CASE_TIERS].reverse().find((t) => sum.tiers[t.id] > 0) ?? CASE_TIERS[0];
  // Плитки открываются очередью, итог — после последней.
  const step = Math.min(60, 1400 / Math.max(1, shown.length));
  const total = step * shown.length + 250;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ticks = Math.min(12, shown.length);
    for (let i = 0; i < ticks; i++)
      timers.push(setTimeout(() => caseTick(), (i * total) / Math.max(1, ticks)));
    timers.push(
      setTimeout(() => {
        setDone(true);
      }, total),
    );
    return () => timers.forEach(clearTimeout);
  }, [shown.length, total]);
  useEffect(() => {
    if (!done) return;
    tierBreak(best.beats);
    flashFrame(best.beats >= 2 ? 'big' : 'small');
    burstConfetti(30 + best.beats * 30, [best.color, '#ffe08a', '#fff']);
    coinDing();
    notifySuccess();
  }, [done, best]);
  const count = (n: number) =>
    n % 10 === 1 && n % 100 !== 11
      ? 'сундук'
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
        ? 'сундука'
        : 'сундуков';
  return createPortal(
    <div
      className={`pcases${done ? ' is-done' : ''}`}
      style={{ '--tier': best.color, '--step': `${step}ms` } as CSSProperties}
      onClick={() => {
        if (!done) {
          setDone(true);
          return;
        }
        tapLight();
        onClose();
      }}
    >
      <div className="pcases__card" onClick={(e) => done && e.stopPropagation()}>
        <span className="pcases__title">
          Открыто {fmt(got.rolls.length)} {count(got.rolls.length)}
        </span>
        <span className="pcases__tiers">
          {CASE_TIERS.filter((t) => sum.tiers[t.id] > 0).map((t) => (
            <i key={t.id} style={{ color: t.color }}>
              {t.name} ×{sum.tiers[t.id]}
            </i>
          ))}
        </span>
        <div className="pcases__grid">
          {shown.map((r, i) => {
            const t = CASE_TIERS.find((x) => x.id === r.tier)!;
            return (
              <span
                key={i}
                className="pcases__tile"
                style={{ '--c': t.color, '--i': i } as CSSProperties}
                title={rewardLabel(r.reward)}
              >
                <RewardIcon r={r.reward} size={26} />
              </span>
            );
          })}
          {got.rolls.length > shown.length && (
            <span className="pcases__more">+{got.rolls.length - shown.length}</span>
          )}
        </div>
        {done && (
          <div className="pcases__sum">
            <b>Итого</b>
            {sum.summed.map((r, i) => (
              <span key={i} className="pcases__row">
                <RewardIcon r={r} size={24} />
                <em>
                  {r.kind === 'treat'
                    ? `Лакомство питомцу ×${r.amount}`
                    : r.kind === 'keys'
                      ? `${r.amount} ${r.amount === 1 ? 'ключ' : r.amount < 5 ? 'ключа' : 'ключей'}`
                      : rewardLabel(r)}
                </em>
              </span>
            ))}
            {sum.single.length > 0 && (
              <span className="pcases__singles">
                {sum.single.map((r, i) => (
                  <span key={i} className="pcases__single" title={rewardLabel(r)}>
                    <RewardIcon r={r} size={r.kind === 'rune' ? 40 : 28} />
                    <i>
                      {r.kind === 'rune'
                        ? `${runeOf(r.rune.kind).name} ${RUNE_ROMAN[r.rune.tier - 1]}`
                        : rewardLabel(r)}
                    </i>
                  </span>
                ))}
              </span>
            )}
            {got.newPets.length > 0 && (
              <span className="pcases__note">
                Новый питомец: {got.newPets.map((id) => petOf(id).name).join(', ')}
              </span>
            )}
            {got.shattered > 0 && (
              <span className="pcases__note">
                Мешочек рун полон — лишние разбиты на {fmt(got.shattered)} ✦
              </span>
            )}
            <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
              Забрать всё
            </button>
          </div>
        )}
        {!done && <span className="pcases__skip">тап — показать итог</span>}
      </div>
    </div>,
    document.body,
  );
}

function ChestArt({ size = 84 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="pchest__art" aria-hidden="true">
      <rect x="4" y="12" width="24" height="15" rx="2" fill="#7a4a24" stroke="#2e1a0a" />
      <path d="M4 12 Q16 3 28 12 Z" fill="#9a5e2e" stroke="#2e1a0a" />
      <rect x="4" y="12" width="24" height="3" fill="#c8923a" stroke="#2e1a0a" />
      <rect x="9" y="12" width="3" height="15" fill="#c8923a" stroke="#2e1a0a" strokeWidth=".6" />
      <rect x="20" y="12" width="3" height="15" fill="#c8923a" stroke="#2e1a0a" strokeWidth=".6" />
      <rect x="14" y="15" width="4" height="5" rx="1" fill="#ffd35a" stroke="#2e1a0a" />
      <circle cx="16" cy="17.4" r=".9" fill="#2e1a0a" />
    </svg>
  );
}

export function rewardLabel(r: Reward): string {
  switch (r.kind) {
    case 'coins':
      return `${shortMoney(r.amount)} монет`;
    case 'tokens':
      return `${fmt(r.amount)} токенов`;
    case 'item': {
      const it = ITEMS.find((i) => i.id === r.id)!;
      return r.amount > 1 ? `${it.name} ×${r.amount}` : it.name;
    }
    case 'find':
      return FINDS.find((f) => f.id === r.id)!.name;
    case 'keys':
      return r.amount > 1 ? `${r.amount} ключа` : 'Ключ';
    case 'rune':
      return `Руна ${runeOf(r.rune.kind).name} ${RUNE_ROMAN[r.rune.tier - 1]}`;
    case 'pet':
      return petOf(r.id).name;
    case 'treat':
      return 'Лакомство питомцу';
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
      return <img className="pfind-img" src={petTexture(r.id)} width={size} height={size} alt="" />;
    case 'treat':
      return (
        <span className="preward__emoji" style={{ fontSize: size * 0.9 }}>
          🐟
        </span>
      );
  }
}

const TILE = 88;
const STRIP = 44;
const WIN_AT = 38;
const ROLL_MS = 4800;

/**
 * Лента сундука. Награда уже начислена в сторе — лента только доезжает до
 * неё. Ход не WAAPI, а свой кадр: щелчок звучит на КАЖДОЙ плитке, прошедшей
 * под стрелкой, и редеет вместе со скоростью, как у колеса удачи. Тап
 * досчитывает мгновенно — ожидание не должно быть наказанием.
 */
/**
 * Открыть сундук: ключ списывается и награда начисляется СРАЗУ, в обработчике
 * нажатия, а не в эффекте. Эффект в разработке (StrictMode) отрабатывает
 * дважды — и на стенде один тап открывал два сундука.
 */
function openCase(): OpenedCase | null {
  const before = useFinanceStore.getState().slotsBalance;
  const result = useFinanceStore.getState().prisonOpenCase();
  if (!result) return null;
  const after = useFinanceStore.getState().slotsBalance;
  const p = useFinanceStore.getState().prison;
  const strip = Array.from({ length: STRIP }, (_, i) =>
    i === WIN_AT ? result : rollCase(p, Math.random),
  );
  return { result, strip, gain: after > before ? [before, after] : null };
}

interface OpenedCase {
  result: CaseRoll;
  strip: CaseRoll[];
  gain: [number, number] | null;
}

function CaseRoller({
  first,
  onClose,
  onGain,
}: {
  first: OpenedCase;
  onClose: () => void;
  onGain: (from: number, to: number) => void;
}) {
  const keys = useFinanceStore((s) => s.prison.keys);
  const [roll, setRoll] = useState<{ result: CaseRoll; strip: CaseRoll[]; id: number }>(() => ({
    result: first.result,
    strip: first.strip,
    id: 0,
  }));
  const [done, setDone] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLElement>(null);
  const skip = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  // Монеты из сундука: табло досчитает их, когда лента доедет.
  const pending = useRef<[number, number] | null>(first.gain);

  const start = () => {
    const o = openCase();
    if (!o) {
      notifyWarning();
      return;
    }
    seq.current += 1;
    setDone(false);
    setRoll({ result: o.result, strip: o.strip, id: seq.current });
    pending.current = o.gain;
  };

  useEffect(() => {
    const strip = stripRef.current;
    const win = winRef.current;
    if (!strip || !win) return undefined;
    const W = win.clientWidth;
    const jitter = (Math.random() - 0.5) * TILE * 0.7;
    const end = WIN_AT * TILE + TILE / 2 - W / 2 + jitter;
    const from = 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let lastTile = -1;
    let stopped = false;
    const t0 = performance.now();
    const place = (x: number) => {
      strip.style.transform = `translate3d(${-x.toFixed(1)}px,0,0)`;
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      place(end);
      reveal(roll.result);
    };
    skip.current = finish;
    if (reduce) {
      finish();
      return undefined;
    }
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ROLL_MS);
      // Быстрый старт и очень долгое торможение: последние плитки ползут, и
      // на них смотрят — «остановится или нет».
      const k = 1 - Math.pow(1 - t, 4.2);
      const x = from + (end - from) * k;
      place(x);
      const tile = Math.floor((x + W / 2) / TILE);
      if (tile !== lastTile) {
        lastTile = tile;
        caseTick();
        const n = needleRef.current;
        try {
          n?.animate([{ transform: 'rotate(-14deg)' }, { transform: 'rotate(0deg)' }], {
            duration: 110,
            easing: 'ease-out',
          });
        } catch {
          /* не страшно */
        }
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else finish();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // Лента заводится на каждый новый сундук, и только на него.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll.id]);

  const reveal = (r: CaseRoll) => {
    setDone(true);
    skip.current = null;
    const tier = CASE_TIERS.find((t) => t.id === r.tier)!;
    tierBreak(tier.beats);
    if (tier.beats >= 2) burstConfetti(tier.beats >= 4 ? 140 : 70, [tier.color, '#ffe08a', '#fff']);
    if (tier.beats >= 4) flashFrame('big');
    notifySuccess();
    setTimeout(() => payoutEnd(Math.min(3, tier.beats)), 250);
    if (pending.current) {
      onGain(pending.current[0], pending.current[1]);
      pending.current = null;
    }
  };

  const tierOf = (t: CaseTier) => CASE_TIERS.find((x) => x.id === t)!;

  // Портал: у листа `backdrop-filter`, а он делает лист рамкой даже для
  // `position: fixed` — лента сундука жила бы внутри листа, а не над экраном.
  return createPortal(
    <div
      className="pcase"
      onClick={() => {
        if (skip.current) skip.current();
      }}
    >
      <div className="pcase__card" onClick={(e) => e.stopPropagation()}>
        <b className="pcase__title">Сундук</b>
        <div
          className="pcase__window"
          ref={winRef}
          onClick={() => {
            if (skip.current) skip.current();
          }}
        >
          <div className="pcase__strip" ref={stripRef} key={roll.id}>
            {roll.strip.map((c, i) => (
              <div
                key={i}
                className={`pcase__tile${done && i === WIN_AT ? ' is-win' : ''}`}
                style={{ '--tc': tierOf(c.tier).color } as CSSProperties}
              >
                <RewardIcon r={c.reward} />
                <span>{rewardLabel(c.reward)}</span>
              </div>
            ))}
          </div>
          <i className="pcase__needle" ref={needleRef} />
        </div>
        <div className="pcase__result">
          {done ? (
            <>
              <span style={{ color: tierOf(roll.result.tier).color }}>
                {tierOf(roll.result.tier).name}
              </span>
              <b>{rewardLabel(roll.result.reward)}</b>
              {roll.result.reward.kind === 'find' && <i>Новая находка в коллекции</i>}
            </>
          ) : (
            <span className="muted">Тапни, чтобы остановить сразу</span>
          )}
        </div>
        <div className="pcase__btns">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!done || keys <= 0}
            onClick={() => {
              primeAudio();
              tapLight();
              start();
            }}
          >
            Ещё · <KeyIcon size={13} /> {keys}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              skip.current?.();
              onClose();
            }}
          >
            Готово
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
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
      setNote(`Прошлая смена сдана: +${shortMoney(got.coins)} монет, +${fmt(got.tokens)} ✦`);
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
            <span className="pcrew-scene__sign">Рабочих нет</span>
          )}
        </span>
        {y.capped && <span className="pcrew-scene__zzz">смена кончилась — ждут</span>}
      </div>
      <div className="pcrew__info pcrew__head">
        <b>{p.crew ? `Рабочие · ${p.crew} ур. · смена «${sh.name}»` : 'Нанять рабочих'}</b>
        <i>
          {p.crew
            ? `${rate.toFixed(1)} блока в минуту в шахте ${rankLetter(p.rank)}, смена ${cap.toLocaleString('ru-RU')} ч${p.crewFed ? ' · сыты, +30%' : ''}`
            : `Копает в лучшей шахте и когда ты в игре, и когда нет. Отдаёт ${Math.round(CREW_SHARE * 100)}% добытого.`}
        </i>
      </div>
      {p.crew > 0 && (
        <div className="pcrew__yield">
          <div className="pcrew__row">
            <span>
              {hh} ч {String(mm).padStart(2, '0')} мин из {cap.toLocaleString('ru-RU')}
            </span>
            <b>
              +{shortMoney(y.coins)} <CoinIcon size={13} /> · +{fmt(y.tokens)}{' '}
              <TokenIcon size={12} />
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
            {y.blocks > 0 ? `Принять смену · ${fmt(y.blocks)} блоков` : 'Смена только началась'}
          </button>
        </div>
      )}
      {note && <p className="msaw__note">{note}</p>}
      {p.crew > 0 && (
        <>
          <h4 className="pcamp-h">Наряд на смену</h4>
          <div className="pcrew-shifts">
            {CREW_SHIFTS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pcrew-shift${c.id === p.crewShift ? ' is-on' : ''}`}
                onClick={() => pickShift(c.id)}
              >
                <b>{c.name}</b>
                <i>{c.text}</i>
                <em>
                  {(c.hours + c.perHour * p.perks.shift).toLocaleString('ru-RU')} ч · ×
                  {c.rate.toLocaleString('ru-RU')}
                </em>
              </button>
            ))}
          </div>
          <Row
            icon={<span className="pforge__glyph">🍲</span>}
            title={p.crewFed ? 'Рабочие сыты' : 'Накормить'}
            text={
              p.crewFed
                ? '+30% выработки до конца этой смены'
                : canFeed
                  ? '+30% выработки на всю смену — кормят в начале смены'
                  : `Кормят в первые ${CREW_FEED_WINDOW_MIN} минут смены: прими смену — и накорми`
            }
            action={
              p.crewFed ? (
                <Done>Сыты</Done>
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
          title={p.crew ? `Нанять ещё одного · ${p.crew + 1} ур.` : 'Нанять рабочих'}
          text={`${crewRate(p.crew + 1).toFixed(1)} блока в минуту на норме${p.crew ? `, сейчас ${crewRate(p.crew).toFixed(1)}` : ''}`}
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
        <p className="pcamp-note">Все места заняты.</p>
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
    const next = tipped.map((t, k) => t || k === i);
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
        <span className="pcases__title">Приём смены</span>
        <span className="pcases__tiers">
          <i>
            Наряд «{sh.name}» · {fmt(got.blocks)} блоков за {Math.floor(got.minutes / 60)} ч{' '}
            {String(Math.floor(got.minutes % 60)).padStart(2, '0')} мин
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
              aria-label="Разгрузить вагонетку"
            >
              <img src={cartTexture(rock)} alt="" />
            </button>
          ))}
        </div>
        <div className="pcrew-count">
          <b>
            +{shortMoney(coinsShown)} <CoinIcon size={16} />
          </b>
          <b>
            +{fmt(tokensShown)} <TokenIcon size={15} />
          </b>
        </div>
        {!all ? (
          <>
            <span className="pcases__skip">Тапай по вагонеткам — разгружай</span>
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
              Разгрузить всё
            </button>
          </>
        ) : (
          <div className="pcases__sum">
            {(got.keys > 0 || got.parcels.length > 0) && (
              <>
                <b>Разведка нашла</b>
                {got.keys > 0 && (
                  <span className="pcases__row">
                    <KeyIcon size={22} />
                    <em>
                      {got.keys} {got.keys === 1 ? 'ключ' : got.keys < 5 ? 'ключа' : 'ключей'}
                    </em>
                  </span>
                )}
                {got.parcels.map((t, i) => {
                  const tier = CASE_TIERS.find((x) => x.id === t)!;
                  return (
                    <span key={i} className="pcases__row">
                      <img
                        src={parcelTexture(tier.color)}
                        alt=""
                        width={24}
                        height={24}
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <em>Посылка · {tier.name.toLowerCase()} — легла под поле шахты</em>
                    </span>
                  );
                })}
              </>
            )}
            {got.parcelTokens > 0 && (
              <span className="pcases__note">
                Мест под посылки нет — сданы за {fmt(got.parcelTokens)} ✦
              </span>
            )}
            <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
              Бригаду — снова в забой
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---- Коллекция -----------------------------------------------------------------

function FindsTab() {
  const p = useFinanceStore((s) => s.prison);
  const found = findsFound(p.finds);
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <b>
          {found} / {FINDS.length}
        </b>{' '}
        находок · продажа +{Math.round((findsMult(p.finds) - 1) * 100)}%
      </div>
      <div className="pfinds">
        {FINDS.map((f) => {
          const n = p.finds[f.id] ?? 0;
          return (
            <div key={f.id} className={`pfinds__cell${n ? ' is-found' : ''}`}>
              <img src={findTexture(f.id, !n)} alt="" />
              <b>{n ? f.name : '???'}</b>
              <i>{n ? (n > 1 ? `×${n} · ${f.text}` : f.text) : `с шахты ${rankLetter(f.from)}`}</i>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Перки ---------------------------------------------------------------------

function PerksTab() {
  const p = useFinanceStore((s) => s.prison);
  const prisonPerk = useFinanceStore((s) => s.prisonPerk);
  const prisonPerksReset = useFinanceStore((s) => s.prisonPerksReset);
  const free = perkPointsFree(p);
  if (!p.prestige) {
    return (
      <div className="pforge">
        <div className="pcamp-lock">
          <GxIcon name="upgrade" size={40} />
          <b>Откроются после престижа</b>
          <span>Ранг {rankLetter(p.rank)} → Z</span>
        </div>
      </div>
    );
  }
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <b>{free}</b> свободных очков · престиж {p.prestige}
      </div>
      {PERKS.map((k) => (
        <Row
          key={k.id}
          icon={<span className="pforge__glyph">★</span>}
          title={
            <>
              {k.name}{' '}
              <span className="pench-lvl">
                {p.perks[k.id]}/{k.max}
              </span>
            </>
          }
          text={k.per}
          action={
            p.perks[k.id] >= k.max ? (
              <Done>Макс.</Done>
            ) : (
              <button
                type="button"
                className="btn btn--sm pforge__buy"
                disabled={free <= 0}
                onClick={() => {
                  if (!prisonPerk(k.id as PerkId)) {
                    notifyWarning();
                    return;
                  }
                  tierBreak(1);
                  notifySuccess();
                }}
              >
                +1
              </button>
            )
          }
        />
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => {
          prisonPerksReset();
          tapLight();
        }}
      >
        Сбросить перки — бесплатно
      </button>
    </div>
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

const pctText = (x: number) =>
  `+${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

/** Руна словами: «Феху III · +7,1% к продаже». */
export function runeLine(r: { kind: RuneKind; tier: number; roll: number }): string {
  return `${pctText(runePower(r))} ${runeOf(r.kind).text}`;
}

/** Есть свободное гнездо и руна, которую можно в него вставить. */
function runesIdle(p: PrisonState, axeLevel = 0): boolean {
  const open = socketsOpen(p, axeLevel);
  const empty = p.sockets.slice(0, open).some((id) => !id);
  return empty && p.runes.some((r) => !p.sockets.includes(r.id));
}

const BONUS_TEXT: { k: keyof Bonus; text: string }[] = [
  { k: 'sell', text: 'к продаже' },
  { k: 'dmg', text: 'к скорости копки' },
  { k: 'rate', text: 'к частоте ударов' },
  { k: 'loot', text: 'к добыче' },
  { k: 'token', text: 'к токенам' },
  { k: 'proc', text: 'к шансам чар' },
  { k: 'luck', text: 'к ключам и посылкам' },
];

function bonusSummary(b: Bonus): string {
  const parts = BONUS_TEXT.filter((x) => b[x.k] > 0).map((x) => `${pctText(b[x.k])} ${x.text}`);
  return parts.length ? parts.join(' · ') : 'пока ничего';
}

/**
 * Оберег — то, КУДА ставятся руны. Раньше вкладка писала «Кирка» и ничего
 * не рисовала, хотя руны работают и на топоре. Теперь это бронзовый оберег
 * на шнурке: четыре гнезда крестом, в середине скрещены кирка и топор — он
 * один на шахту и лес. Сами гнёзда — кнопки поверх рисунка.
 */
function AmuletArt() {
  const rivets = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    return [110 + Math.cos(a) * 88, 118 + Math.sin(a) * 88];
  });
  return (
    <svg className="pamulet__art" viewBox="0 0 220 236" aria-hidden="true">
      <defs>
        <radialGradient id="amBronze" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#f0c878" />
          <stop offset="0.45" stopColor="#b8803a" />
          <stop offset="1" stopColor="#5a3614" />
        </radialGradient>
        <radialGradient id="amInner" cx="45%" cy="40%" r="70%">
          <stop offset="0" stopColor="#5a3e24" />
          <stop offset="1" stopColor="#2a1a0e" />
        </radialGradient>
        <linearGradient id="amCord" x1="0" x2="1">
          <stop offset="0" stopColor="#3a2412" />
          <stop offset="0.5" stopColor="#7a5230" />
          <stop offset="1" stopColor="#3a2412" />
        </linearGradient>
      </defs>
      {/* Шнурок и петля */}
      <path
        d="M70 0 C80 22 96 26 104 30 M150 0 C140 22 124 26 116 30"
        stroke="url(#amCord)"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M70 0 C80 22 96 26 104 30 M150 0 C140 22 124 26 116 30"
        stroke="rgba(255,230,190,.25)"
        strokeWidth="1.2"
        strokeDasharray="3 4"
        fill="none"
      />
      <rect
        x="99"
        y="24"
        width="22"
        height="14"
        rx="5"
        fill="url(#amBronze)"
        stroke="#3a220c"
        strokeWidth="1.5"
      />
      {/* Диск: внешний обод, гравировка, заклёпки */}
      <circle cx="110" cy="118" r="100" fill="url(#amBronze)" stroke="#3a220c" strokeWidth="2.5" />
      <circle
        cx="110"
        cy="118"
        r="94"
        fill="none"
        stroke="rgba(255,240,200,.55)"
        strokeWidth="1.2"
      />
      <circle
        cx="110"
        cy="118"
        r="80"
        fill="none"
        stroke="#5a3614"
        strokeWidth="5"
        strokeDasharray="7 5"
        opacity=".75"
      />
      <circle
        cx="110"
        cy="118"
        r="80"
        fill="none"
        stroke="rgba(255,236,190,.35)"
        strokeWidth="1"
        strokeDasharray="7 5"
        strokeDashoffset="-1"
      />
      {rivets.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill="#6a4418" />
          <circle cx={x - 1} cy={y - 1} r="2.2" fill="#f4d48a" />
        </g>
      ))}
      <circle cx="110" cy="118" r="72" fill="url(#amInner)" stroke="#2a180a" strokeWidth="2" />
      {/* Резьба: крест, связывающий гнёзда, и ромб */}
      <path
        d="M110 58 V178 M50 118 H170"
        stroke="#1a0e06"
        strokeWidth="6"
        strokeLinecap="round"
        opacity=".6"
      />
      <path
        d="M110 58 V178 M50 118 H170"
        stroke="rgba(255,210,150,.25)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M110 76 L152 118 L110 160 L68 118 Z"
        fill="none"
        stroke="rgba(255,210,150,.3)"
        strokeWidth="1.4"
      />
      {/* Середина: кирка и топор накрест — оберег на оба инструмента */}
      <g transform="translate(110 118)">
        <circle r="17" fill="#3a2614" stroke="#c8903e" strokeWidth="2" />
        <g stroke="#e8c070" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M-8 9 L8 -9" />
          <path d="M-12 -6 Q-2 -14 9 -10" />
          <path d="M8 9 L-8 -9" />
        </g>
        <path d="M-10 -12 Q-15 -7 -12 -2 L-6 -8 Z" fill="#e8c070" />
      </g>
    </svg>
  );
}

/** Где на оберег встают гнёзда: верх, лево, право, низ (в долях рисунка). */
const AMULET_SLOTS: [number, number][] = [
  [50, 25.4],
  [23.6, 50],
  [76.4, 50],
  [50, 74.6],
];

function RunesTab({ axeLevel }: { axeLevel: number }) {
  const p = useFinanceStore((s) => s.prison);
  const socket = useFinanceStore((s) => s.prisonRuneSocket);
  const fuse = useFinanceStore((s) => s.prisonRuneFuse);
  const shatter = useFinanceStore((s) => s.prisonRuneShatter);
  const [sel, setSel] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const open = socketsOpen(p, axeLevel);
  const rune = p.runes.find((r) => r.id === sel) ?? null;
  const worn = rune ? p.sockets.includes(rune.id) : false;
  const plan = rune ? fusePlan(p.runes, p.sockets, rune.id) : null;
  const bag = p.runes
    .slice()
    .sort((a, b) => b.tier - a.tier || runePower(b) - runePower(a) || a.id - b.id);

  const tapSocket = (i: number) => {
    if (i >= open) {
      notifyWarning();
      return;
    }
    selectionChanged();
    const cur = p.sockets[i];
    // Выбрана руна из мешочка — ставим её сюда (вместо той, что была).
    if (rune && !worn) {
      socket(i, rune.id);
      tierBreak(0);
      setNote(null);
      return;
    }
    setSel(cur || null);
  };

  const wear = () => {
    if (!rune) return;
    primeAudio();
    if (worn) {
      socket(p.sockets.indexOf(rune.id), 0);
      tapLight();
      return;
    }
    const empty = p.sockets.findIndex((id, i) => i < open && !id);
    if (empty < 0) {
      notifyWarning();
      setNote(
        open
          ? 'Гнёзда заняты — тапни по гнезду, чтобы заменить'
          : `Первое гнездо откроется с ${SOCKET_UNLOCK[0]} уровня кирки или топора`,
      );
      return;
    }
    socket(empty, rune.id);
    tierBreak(0);
    notifySuccess();
  };

  const doFuse = () => {
    if (!rune) return;
    primeAudio();
    const made = fuse(rune.id);
    if (!made) {
      notifyWarning();
      return;
    }
    tierBreak(Math.min(3, made.tier - 1));
    notifySuccess();
    burstConfetti(30 + made.tier * 12, [RUNE_COLORS[made.tier - 1], '#fff']);
    setSel(made.id);
  };

  const doShatter = () => {
    if (!rune || worn) return;
    primeAudio();
    const got = shatter(rune.id);
    if (!got) return;
    coinDing();
    tapLight();
    setSel(null);
  };

  return (
    <div className="pforge">
      <div className="pamulet">
        <AmuletArt />
        {AMULET_SLOTS.map(([x, y], i) => {
          const id = p.sockets[i];
          const r = id ? p.runes.find((z) => z.id === id) : null;
          const locked = i >= open;
          return (
            <button
              key={i}
              type="button"
              style={{ left: `${x}%`, top: `${y}%` }}
              className={`pamulet__slot${locked ? ' is-locked' : ''}${r ? ' is-full' : ''}${
                r && sel === r.id ? ' is-sel' : ''
              }${rune && !worn && !locked ? ' is-target' : ''}`}
              aria-label={
                r
                  ? `${runeOf(r.kind).name}, ${runeLine(r)}`
                  : locked
                    ? 'Гнездо закрыто'
                    : 'Пустое гнездо'
              }
              onClick={() => tapSocket(i)}
            >
              {r ? (
                <RuneIcon kind={r.kind} tier={r.tier} size={40} />
              ) : locked ? (
                <span className="pamulet__lock">🔒</span>
              ) : null}
              <i>
                {r
                  ? pctText(runePower(r))
                  : locked
                    ? i < SOCKET_UNLOCK.length
                      ? `${SOCKET_UNLOCK[i]} ур.`
                      : 'престиж 10'
                    : 'пусто'}
              </i>
            </button>
          );
        })}
      </div>
      <div className="prunes-head">
        <b>Оберег — и в шахте, и в лесу</b>
        <span>{bonusSummary(bonusOf(p)) || 'Руны не вставлены — оберег пока пустой'}</span>
      </div>
      {rune ? (
        <div className="prune-card">
          <RuneIcon kind={rune.kind} tier={rune.tier} size={80} />
          <span className="prune-card__info">
            <b>
              {runeOf(rune.kind).name} {RUNE_ROMAN[rune.tier - 1]}
            </b>
            <i>{runeLine(rune)}</i>
            <em>сила {rune.roll} из 100 внутри ступени</em>
          </span>
          <span className="prune-card__btns">
            <button type="button" className="btn btn--sm pforge__buy" onClick={wear}>
              {worn ? 'Вынуть' : 'В оберег'}
            </button>
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={!plan}
              onClick={doFuse}
            >
              Сплавить
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost pforge__buy"
              disabled={worn}
              onClick={doShatter}
            >
              +{RUNE_SHATTER[rune.tier - 1]} <TokenIcon size={11} />
            </button>
          </span>
          {!plan && rune.tier < RUNE_ROMAN.length && (
            <span className="prune-card__hint">
              Для сплава нужны ещё две свободные руны {RUNE_ROMAN[rune.tier - 1]}
            </span>
          )}
          {plan && (
            <span className="prune-card__hint">
              Уйдут:{' '}
              {plan.with.map((r) => `${runeOf(r.kind).name} ${pctText(runePower(r))}`).join(', ')} →{' '}
              {runeOf(rune.kind).name} {RUNE_ROMAN[rune.tier]}
            </span>
          )}
        </div>
      ) : (
        <p className="pcamp-note" style={{ margin: 0 }}>
          {p.runes.length ? `Мешочек ${p.runes.length}/${RUNE_BAG} · тапни руну` : 'Рун пока нет'}
        </p>
      )}
      {note && <p className="pcamp-note prune-note">{note}</p>}
      {bag.length > 0 && (
        <div className="prunes-bag">
          {bag.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`prune-tile${sel === r.id ? ' is-sel' : ''}${
                p.sockets.includes(r.id) ? ' is-worn' : ''
              }`}
              onClick={() => {
                selectionChanged();
                setNote(null);
                setSel(sel === r.id ? null : r.id);
              }}
            >
              <RuneIcon kind={r.kind} tier={r.tier} size={40} />
              <i>{RUNE_ROMAN[r.tier - 1]}</i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Питомцы -------------------------------------------------------------------

export function PetIcon({
  id,
  size = 32,
  ghost = false,
}: {
  id: PetId;
  size?: number;
  ghost?: boolean;
}) {
  return (
    <img
      className="ppet-img"
      src={petTexture(id, ghost)}
      width={size}
      height={size}
      alt={ghost ? '' : petOf(id).name}
    />
  );
}

function PetsTab() {
  const p = useFinanceStore((s) => s.prison);
  const setPet = useFinanceStore((s) => s.prisonPetSet);
  return (
    <div className="pforge">
      {PETS.map((d) => {
        const xp = p.pets[d.id];
        const have = xp !== undefined;
        const lv = petLevelOf(xp ?? 0);
        const here = p.pet === d.id;
        return (
          <div
            key={d.id}
            className={`pforge__row ppet-row${here ? ' is-here' : ''}${have ? '' : ' is-ghost'}`}
          >
            <span className="pforge__ico ppet-ico">
              <PetIcon id={d.id} size={34} ghost={!have} />
            </span>
            <span className="pforge__info">
              <b>
                {have ? d.name : '???'} {have && <span className="pench-lvl">ур. {lv.level}</span>}
              </b>
              <i>
                {have
                  ? `${pctText(petPower(d.id, lv.level))} ${d.text}`
                  : `Придёт в посылке · ${d.text}`}
              </i>
              {have && lv.need > 0 && (
                <span className="ppet-bar">
                  <i style={{ transform: `scaleX(${lv.into / lv.need})` }} />
                </span>
              )}
              <em className="ppet-lore">{have ? d.lore : ' '}</em>
            </span>
            {have &&
              (here ? (
                <Done>С тобой</Done>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm pforge__buy"
                  onClick={() => {
                    primeAudio();
                    selectionChanged();
                    setPet(d.id);
                    tierBreak(0);
                  }}
                >
                  С собой
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

// ---- Вехи ------------------------------------------------------------------------

function mileRewardText(m: (typeof MILES)[number]): string {
  const r = m.reward;
  const out: string[] = [];
  if (r.tokens) out.push(`+${fmt(r.tokens)} ✦`);
  if (r.keys) out.push(`${r.keys} ключ${r.keys === 1 ? '' : r.keys < 5 ? 'а' : 'ей'}`);
  if (r.parcel)
    out.push(`посылка «${TIERS_OF.find((t) => t.id === r.parcel)!.name.toLowerCase()}»`);
  if (r.rune) out.push(`руна ${RUNE_ROMAN[r.rune - 1]}`);
  if (r.socket) out.push('четвёртое гнездо');
  return out.join(' · ');
}

function MilesTab({ onGain }: { onGain: (from: number, to: number) => void }) {
  const p = useFinanceStore((s) => s.prison);
  const claim = useFinanceStore((s) => s.prisonMileClaim);
  const [reveal, setReveal] = useState<ParcelOpen | null>(null);
  const take = (id: string) => {
    primeAudio();
    const before = useFinanceStore.getState().slotsBalance;
    const got = claim(id);
    if (!got) {
      notifyWarning();
      return;
    }
    const after = useFinanceStore.getState().slotsBalance;
    if (after > before) onGain(before, after);
    coinDing();
    notifySuccess();
    if (got.mile.reward.keys) keyFound();
    if (got.parcel) setReveal(got.parcel);
    else {
      tierBreak(2);
      burstConfetti(50, ['#ffe08a', '#b8f4e6', '#fff']);
    }
  };
  return (
    <div className="pforge">
      {MILES.map((m) => {
        const [v, goal] = m.progress(p);
        const done = p.miles.includes(m.id);
        const ready = mileReady(p, m);
        return (
          <div
            key={m.id}
            className={`pforge__row pmile${done ? ' is-done' : ''}${ready ? ' is-ready' : ''}`}
          >
            <span className="pforge__ico">
              <span className="pforge__glyph">{done ? '✓' : ready ? '★' : '☆'}</span>
            </span>
            <span className="pforge__info">
              <b>{m.title}</b>
              <i>
                {m.text} · {mileRewardText(m)}
              </i>
              {!done && (
                <span className="ppet-bar">
                  <i style={{ transform: `scaleX(${goal ? v / goal : 0})` }} />
                </span>
              )}
            </span>
            {done ? (
              <Done>Взято</Done>
            ) : ready ? (
              <button type="button" className="btn btn--sm pforge__buy" onClick={() => take(m.id)}>
                Забрать
              </button>
            ) : (
              <Done>
                {shortMoney(v)}/{shortMoney(goal)}
              </Done>
            )}
          </div>
        );
      })}
      {reveal && <ParcelReveal open={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Вскрытие посылки. Коробка трясётся три удара (редкая — дольше), потом
// вспышка — и под ней уже награда: склейка прячется во вспышке, как у жетона
// в автоматах. Награда начислена ДО сцены, в обработчике нажатия; тап
// досматривать не заставляет.
// ---------------------------------------------------------------------------

const SHAKES: Record<CaseTier, number> = { common: 2, rare: 3, epic: 4, legend: 5 };

export function ParcelReveal({ open, onClose }: { open: ParcelOpen; onClose: () => void }) {
  const tier = TIERS_OF.find((t) => t.id === open.tier)!;
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
          <span className="preveal__tier">Посылка · {tier.name.toLowerCase()}</span>
          <span className="preveal__icon">
            <RewardIcon r={open.reward} size={64} />
          </span>
          <b className="preveal__name">{rewardLabel(open.reward)}</b>
          {open.reward.kind === 'rune' && (
            <i className="preveal__sub">{runeLine(open.reward.rune)}</i>
          )}
          {open.newPet && <i className="preveal__sub">Новый питомец! {petOf(open.newPet).lore}</i>}
          {open.reward.kind === 'treat' && <i className="preveal__sub">Опыт тому, кто с тобой</i>}
          {open.shattered > 0 && (
            <i className="preveal__sub">Мешочек полон — руна разбита на {open.shattered} ✦</i>
          )}
          <span className="preveal__cta">Забрать</span>
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
          <b>{cur.name}</b>
          <i>
            урон {dmg.toFixed(dmg < 10 ? 1 : 0)} · {(cur.rate * fm.rate).toFixed(1)} удара в секунду
          </i>
        </span>
      </div>
      <Row
        icon={<AxeIcon axe={next ? f.axe + 1 : f.axe} size={30} />}
        title={next ? next.name : 'Лучше не бывает'}
        text={
          next
            ? `урон ${cur.dmg} → ${next.dmg}, скорость ${cur.rate} → ${next.rate}`
            : '«Урал» — вершина'
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
        title={`Правка ${f.sharp}/${AXE_SHARP_MAX}`}
        text={
          f.sharp < AXE_SHARP_MAX
            ? `+${Math.round(AXE_SHARP_STEP * 100)}% урона топору и пиле`
            : 'Острее некуда'
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
        title={`Штабель ${pileCapacity(f.pileLevel)}`}
        text={
          f.pileLevel < PILE_MAX
            ? `${pileCapacity(f.pileLevel)} → ${pileCapacity(f.pileLevel + 1)} брёвен`
            : 'Больше не уложить'
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
        title="Лесовоз"
        text="Сам увозит штабель, когда он полон"
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
        Повалено деревьев: {fmt(f.felled)} · срублено брёвен: {fmt(f.logs)} · выручено:{' '}
        {fmt(f.earned)} монет
      </p>
    </div>
  );
}

function axeEnchNow(id: AxeEnchId, f: ForestState, p: PrisonState): string {
  const l = f.ench[id];
  const fm = forestMods(p, f);
  switch (id) {
    case 'chips':
      return `+${4 * l}% лишних брёвен`;
    case 'resin':
      return `токен с ${pct(fm.tokenChance)} брёвен`;
    case 'sense':
      return `${pct(fm.dodge)} увернуться · опасный сучок светится`;
    case 'swing':
      return `${pct(fm.swing)} · два бревна разом`;
    case 'fell':
      return `${pct(fm.fell)} · дерево с одного удара`;
    case 'storm':
      return `${pct(fm.storm)} · падающее валит соседнее`;
  }
}

/** Чары топора: те же токены, что у кирки, свой уровень — от брёвен. */
function AxeEnchSection({ f, p }: { f: ForestState; p: PrisonState }) {
  const forestEnchant = useFinanceStore((s) => s.forestEnchant);
  const [bulk, setBulk] = useState(1);
  const lvl = axeLevelOf(f.logs);
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <TokenIcon size={18} /> <b>{fmt(p.tokens)}</b> токенов
        <span>общие с киркой: падают и с брёвен, Живица — чаще</span>
      </div>
      <div className="pench-pick">
        <span className="pench-pick__lv">
          <AxeIcon axe={f.axe} size={20} /> Топор ур. {lvl.level}
        </span>
        <span className="pench-pick__bar">
          <i style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
        </span>
        <span className="pench-pick__txt">
          {lvl.need ? `ещё ${fmt(lvl.need - lvl.into)} брёвен` : 'максимум'}
        </span>
      </div>
      <div className="pench-bulk" role="radiogroup" aria-label="Сколько уровней брать">
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
            {b.label}
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
                {e.name}{' '}
                <span className="pench-lvl">
                  {l}/{maxed || locked ? e.max : cap}
                </span>
              </b>
              <i>
                {locked
                  ? `Откроется на ${e.unlock} уровне топора`
                  : l
                    ? axeEnchNow(e.id, f, p)
                    : e.per}
                {!locked && !maxed && l >= cap && (
                  <span className="pench-cap"> · потолок растёт с уровнем топора</span>
                )}
              </i>
            </span>
            {maxed ? (
              <Done>Макс.</Done>
            ) : locked ? (
              <Done>ур. {e.unlock}</Done>
            ) : l >= cap ? (
              <Done>Потолок</Done>
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
                {shortMoney(k ? price : nextCost)} <TokenIcon size={12} />
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
        name: 'Крепь',
        need: PROP_STRIKES,
        can: boards >= PROP_BOARDS,
        where: `Легла в шахту, в ряд расходников (теперь ×${p.items.prop + 1}). Тапни её там — 10 минут каждый второй блок считается породой выше.`,
        finish: () => forestCraftProp(),
      };
    if (c.kind === 'handle')
      return {
        tex: benchTexture('handle', nextH?.species ?? 3),
        name: nextH?.name ?? 'Рукоять',
        need: HANDLE_STRIKES,
        can: !!nextH && mill.boards[nextH.species] >= nextH.boards,
        where: nextH
          ? `Надета на кирку и топор навсегда: удар быстрее на ${Math.round(nextH.rate * 100)}%.`
          : '',
        finish: () => forestCraftHandle(),
      };
    const o = orders[c.i];
    const item = benchItemOf(o.item);
    return {
      tex: benchTexture(o.item, o.species),
      name: `${item.name} ${item.who}`,
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
          title: `${item.name} сдан заказчику`,
          where: `+${shortMoney(r.coins)} монет и +${r.tokens} ✦ — уже в кошельке. Новый заказ появится через 10 минут.`,
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
    if (craft.kind !== 'order') setDone({ tex: m.tex, title: `${m.name} готова`, where: m.where });
  };

  const cur = craft ? meta(craft) : null;
  const clock = (ms: number) => {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  if (f.mill.level <= 0)
    return (
      <div className="pforge">
        <div className="pcamp-lock">
          <GxIcon name="saw" size={40} />
          <b>Нужна пилорама</b>
          <span>Доски для верстака пилит она</span>
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
            <span className="bench__idle">Выбери ниже, что собрать</span>
          )}
        </span>
        <button
          type="button"
          className="bench__hammer"
          disabled={!cur}
          onClick={strike}
          aria-label="Ударить молотком"
        >
          <span ref={hammerRef} className="bench__hammerart">
            <HammerIcon size={46} />
          </span>
          <em>{cur ? `Бей! ${hits}/${cur.need}` : 'молоток'}</em>
        </button>
      </div>
      {cur && <p className="msaw__status">Собираешь: {cur.name}</p>}
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
        <b>{fmt(boards)}</b> досок на складе
        <span>доски режет пилорама; здесь они становятся вещами</span>
      </div>

      <h4 className="pcamp-h">Для себя</h4>
      <Row
        icon={
          <img className="pmill-hico" src={benchTexture('prop', Math.max(0, propSpecies))} alt="" />
        }
        title={
          <>
            Крепь {p.items.prop > 0 && <span className="pench-lvl">в шахте ×{p.items.prop}</span>}
          </>
        }
        text={`${PROP_BOARDS} досок любых → в ряд расходников шахты: 10 минут каждый второй блок — порода выше`}
        action={
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={boards < PROP_BOARDS || !!craft}
            onClick={() => start({ kind: 'prop' })}
          >
            Собрать
          </button>
        }
      />
      {nextH ? (
        <Row
          icon={<img className="pmill-hico" src={benchTexture('handle', nextH.species)} alt="" />}
          title={nextH.name}
          text={`${fmt(Math.min(mill.boards[nextH.species], nextH.boards))}/${nextH.boards} досок ${SPECIES[nextH.species].gen} → на кирку и топор навсегда, +${Math.round(nextH.rate * 100)}% к скорости${curH ? ` (сейчас ${curH.name.toLowerCase()}, +${Math.round(handleRate(p.handle) * 100)}%)` : ''}`}
          action={
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={mill.boards[nextH.species] < nextH.boards || !!craft}
              onClick={() => start({ kind: 'handle' })}
            >
              Собрать
            </button>
          }
        />
      ) : (
        <Row
          icon={<img className="pmill-hico" src={benchTexture('handle', 9)} alt="" />}
          title="Рукоять из карельской берёзы"
          text="Надета — лучше рукояти не бывает"
          action={<Done />}
        />
      )}

      <h4 className="pcamp-h">Заказы на продажу</h4>
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
                {item.name} <span className="bench__who">{item.who}</span>
              </b>
              <i>
                {wait > 0
                  ? `Заказчик придёт через ${clock(wait)}`
                  : `${fmt(Math.min(have, o.boards))}/${o.boards} досок ${o.species >= 0 ? SPECIES[o.species].gen : 'любых'} · заплатит ${shortMoney(o.coins)} монет и ${o.tokens} ✦`}
              </i>
            </span>
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={!can || !!craft}
              onClick={() => start({ kind: 'order', i })}
            >
              {wait > 0 ? clock(wait) : 'Собрать'}
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
    ? 'меньше минуты'
    : m < 60
      ? `${Math.ceil(m)} мин`
      : `${Math.floor(m / 60)} ч ${Math.ceil(m % 60)} мин`;

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
        <i>брёвен</i>
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
        aria-label="Подать бревно в пилу"
      >
        <span className="msaw__spin">
          <span className="msaw__disc" ref={discRef}>
            <MillIcon size={58} />
          </span>
        </span>
        <em>{level > 0 ? 'тапни' : 'нет пилы'}</em>
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
        <i>досок</i>
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
        ? `${fmt(r.loaded)} брёвен легли в очередь. За свиль, капокорень и дрова с кроны — сразу +${shortMoney(r.premium)}`
        : `${fmt(r.loaded)} брёвен легли в очередь — пила режет их сама`,
    );
  };
  const feed = () => {
    const from = useFinanceStore.getState().slotsBalance;
    const r = forestMillFeed();
    if (!r) {
      setNote('Пилить нечего: сруби брёвен и загрузи штабель');
      return null;
    }
    if (r.loaded) {
      squashPop(stockRef.current, 0.6);
      setNote(`Штабель лёг в очередь: ${fmt(r.loaded)} брёвен`);
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
    coinDing(0.08);
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
          title="Поставить пилораму"
          text={`${Math.round(millRate(1))} брёвен в минуту, доска в ${BOARD_MULT.toLocaleString('ru-RU')} раза дороже бревна`}
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
        {Math.round(rate)} брёвен/мин
        {queued ? ` · готово через ${minutes(queued / rate)}` : ' · стоит'}
      </p>
      <button
        type="button"
        className="btn btn--block msaw__load"
        disabled={!f.pile.n || queued >= cap}
        onClick={load}
      >
        {!f.pile.n
          ? 'Штабель пуст — сначала сруби'
          : queued >= cap
            ? 'Очередь полна — пусть пила догонит'
            : `Штабель → в пилу · ${fmt(f.pile.n)} брёвен`}
      </button>
      {note && <p className="msaw__note">{note}</p>}
      {/* Разбивка по породам — только когда пород больше одной: одну и так
          показывает сцена, а для рукоятей важно, чьи именно доски. */}
      {mill.boards.filter((k) => k > 0).length > 1 && (
        <div className="pmill-boards">
          {mill.boards.map((k, i) =>
            k > 0 ? (
              <span key={i} className="pmill-board" title={SPECIES[i].name}>
                <img src={boardTexture(i)} alt="" />
                {fmt(k)} · {SPECIES[i].name.toLowerCase()}
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
            Продать доски · {shortMoney(saleValue)} <CoinIcon size={13} />
          </>
        ) : (
          'Продавать пока нечего'
        )}
      </button>
      {kept > 0 && nextH && (
        <p className="pmill-keep">
          {fmt(kept)} досок {SPECIES[nextH.species].gen} отложено на рукоять — продажа их не трогает
        </p>
      )}
      {mill.level < MILL_MAX ? (
        <Row
          icon={<MillIcon size={30} />}
          title={`Пилорама ${mill.level + 1} ур.`}
          text={`${Math.round(rate)} → ${Math.round(millRate(mill.level + 1))} брёвен в минуту`}
          action={
            <Buy price={millCost(mill.level)} can={balance >= millCost(mill.level)} onClick={up} />
          }
        />
      ) : (
        <Row
          icon={<MillIcon size={30} />}
          title="Пилорама на пределе"
          text="Быстрее пилит только «Урал» в руках"
          action={<Done />}
        />
      )}

      <button type="button" className="btn btn--block msaw__tobench" onClick={onBench}>
        Из досок — вещи на верстаке: крепь, рукояти, заказы на продажу →
      </button>
    </div>
  );
}
