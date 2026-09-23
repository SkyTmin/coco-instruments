// «Лагерь» каторги: всё, что не шахта. Кузница, чары, лавка, сундуки,
// бригада, коллекция и перки — один лист с вкладками. Его открывает кнопка в
// шахте, а позже — здания двора, каждое на своей вкладке.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { Sheet } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import {
  bagCapacity,
  bagCost,
  BAG_MAX,
  CART_PRICE,
  CASE_TIERS,
  CREW_MAX,
  CRIT_CHANCE,
  CRIT_MULT,
  crewCapHours,
  crewCost,
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
  SOCKETS_MAX,
  socketsOpen,
  enchantRefund,
  ENCHANT_TOGGLE,
  ENCHANT_UNLOCK,
  FINDS,
  findsFound,
  findsMult,
  handleRate,
  HANDLES,
  hitDamage,
  ITEMS,
  modsOf,
  PROP_MS,
  PERKS,
  perkPointsFree,
  pickLevelOf,
  PICKS,
  PRESTIGE_KEYS,
  rankLetter,
  rollCase,
  ROCKS,
  sharpCost,
  SHARP_MAX,
  SHARP_STEP,
  shortMoney,
} from '@/lib/prison';
import type {
  Bonus,
  CaseRoll,
  CaseTier,
  EnchantId,
  PerkId,
  PetId,
  PrisonState,
  Reward,
  Rune,
  RuneKind,
} from '@/lib/prison';
import type { ParcelOpen } from '@/store';
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
  TRUCK_PRICE,
} from '@/lib/forest';
import type { AxeEnchId, ForestState } from '@/lib/forest';
import {
  barkTexture,
  boardTexture,
  findTexture,
  parcelTexture,
  petTexture,
  tearTexture,
} from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { caseTick, coinDing, keyFound, payoutEnd, primeAudio, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const pct = (x: number) =>
  `${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;

// ---------------------------------------------------------------------------
// Иконки.
// ---------------------------------------------------------------------------

export function PickIcon({ pick, size = 30 }: { pick: number; size?: number }) {
  const p = PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))];
  return (
    <svg className="ppick-ico" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M6.5 27.5 L20 14" stroke="#4a2d16" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M6.5 27.5 L20 14" stroke="#a36d3c" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 5.5 C18.5 4.8 25.6 10.4 27.2 20 L24.6 20.6 C22.6 13.6 17.6 9.6 10.6 8.4 Z"
        fill={p.head}
        stroke="rgba(0,0,0,.55)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12.4 6.6 C18 6.4 23 9.8 25.2 15.6"
        fill="none"
        stroke="rgba(255,255,255,.55)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <rect
        x="17.2"
        y="10.8"
        width="5"
        height="5"
        rx="1"
        transform="rotate(45 19.7 13.3)"
        fill="#3a2414"
      />
    </svg>
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
  | 'forge'
  | 'axes'
  | 'mill'
  | 'enchant'
  | 'runes'
  | 'pets'
  | 'shop'
  | 'cases'
  | 'crew'
  | 'finds'
  | 'miles'
  | 'perks';

const TABS: { id: CampTab; name: string }[] = [
  { id: 'forge', name: 'Кузница' },
  { id: 'axes', name: 'Топоры' },
  { id: 'mill', name: 'Лесопилка' },
  { id: 'enchant', name: 'Чары' },
  { id: 'runes', name: 'Руны' },
  { id: 'pets', name: 'Питомцы' },
  { id: 'shop', name: 'Лавка' },
  { id: 'cases', name: 'Сундуки' },
  { id: 'crew', name: 'Бригада' },
  { id: 'finds', name: 'Коллекция' },
  { id: 'miles', name: 'Вехи' },
  { id: 'perks', name: 'Перки' },
];

export function PrisonCamp({
  tab,
  onTab,
  onClose,
  onGain,
  onSpend,
}: {
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
  const crew = crewYield(p, now);
  const miles = milesReady(p);
  const mill = millTick(f.mill, now);
  const badge: Partial<Record<CampTab, ReactNode>> = {
    mill: mill.level > 0 && sumRow(mill.boards) >= PROP_BOARDS ? '•' : null,
    cases: p.keys > 0 ? p.keys : null,
    crew: crew.blocks > 0 && crew.minutes >= 10 ? '•' : null,
    perks: perkPointsFree(p) > 0 ? perkPointsFree(p) : null,
    miles: miles > 0 ? miles : null,
    runes: runesIdle(p) ? '•' : null,
  };
  return (
    <Sheet title="Лагерь" onClose={onClose}>
      <div className="pcamp-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`pcamp-tab${tab === t.id ? ' is-on' : ''}`}
            onClick={() => {
              selectionChanged();
              onTab(t.id);
            }}
          >
            {t.name}
            {badge[t.id] != null && <i className="pcamp-tab__badge">{badge[t.id]}</i>}
          </button>
        ))}
      </div>
      <div className="pcamp-body">
        {tab === 'forge' && <ForgeTab onSpend={onSpend} />}
        {tab === 'axes' && <AxesTab onSpend={onSpend} />}
        {tab === 'mill' && <MillTab now={now} onGain={onGain} onSpend={onSpend} />}
        {tab === 'enchant' && <EnchantTab />}
        {tab === 'runes' && <RunesTab />}
        {tab === 'pets' && <PetsTab />}
        {tab === 'miles' && <MilesTab onGain={onGain} />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'cases' && <CasesTab onGain={onGain} />}
        {tab === 'crew' && <CrewTab now={now} onGain={onGain} onSpend={onSpend} />}
        {tab === 'finds' && <FindsTab />}
        {tab === 'perks' && <PerksTab />}
      </div>
    </Sheet>
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
    <button type="button" className="btn btn--sm pforge__buy" disabled={!can} onClick={onClick}>
      {shortMoney(price)} {token ? <TokenIcon size={12} /> : <CoinIcon size={12} />}
    </button>
  );
}

const Done = ({ children = 'Есть' }: { children?: ReactNode }) => (
  <span className="pforge__done">{children}</span>
);

// ---- Кузница: за монеты ------------------------------------------------------

function ForgeTab({ onSpend }: { onSpend: () => void }) {
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonBuy = useFinanceStore((s) => s.prisonBuy);
  const cur = PICKS[p.pick];
  const next = PICKS[p.pick + 1];
  const m = modsOf(p);
  const dmg = hitDamage(p.pick, p.sharp) * m.dmg;
  const buy = (what: 'pick' | 'sharp' | 'bag' | 'cart') => {
    primeAudio();
    if (!prisonBuy(what)) {
      notifyWarning();
      return;
    }
    onSpend();
    coinDing();
    tierBreak(0);
    notifySuccess();
  };
  return (
    <div className="pforge">
      <div className="pforge__now">
        <PickIcon pick={p.pick} size={40} />
        <span>
          <b>
            {cur.name} кирка · ур. {pickLevelOf(p.pickXp).level}
          </b>
          <i>
            урон {dmg.toFixed(dmg < 10 ? 1 : 0)} · {(cur.rate * m.rate).toFixed(1)} удара в секунду
            · крит {Math.round(CRIT_CHANCE * 100)}% ×{CRIT_MULT}
          </i>
        </span>
      </div>
      <Row
        icon={<PickIcon pick={next ? p.pick + 1 : p.pick} size={30} />}
        title={next ? `${next.name} кирка` : 'Лучшая кирка'}
        text={
          next
            ? `урон ${cur.dmg} → ${next.dmg}, скорость ${cur.rate} → ${next.rate}`
            : 'Сильнее кирки нет'
        }
        action={
          next ? (
            <Buy price={next.price} can={balance >= next.price} onClick={() => buy('pick')} />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<span className="pforge__glyph">⟋</span>}
        title={`Заточка ${p.sharp}/${SHARP_MAX}`}
        text={
          p.sharp < SHARP_MAX
            ? `+${Math.round(SHARP_STEP * 100)}% урона любой кирке`
            : 'Острее некуда'
        }
        action={
          p.sharp < SHARP_MAX ? (
            <Buy
              price={sharpCost(p.sharp)}
              can={balance >= sharpCost(p.sharp)}
              onClick={() => buy('sharp')}
            />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<BagIcon size={28} />}
        title={`Рюкзак ${bagCapacity(p.bagLevel)}`}
        text={
          p.bagLevel < BAG_MAX
            ? `${bagCapacity(p.bagLevel)} → ${bagCapacity(p.bagLevel + 1)} блоков`
            : 'Больше не унести'
        }
        action={
          p.bagLevel < BAG_MAX ? (
            <Buy
              price={bagCost(p.bagLevel)}
              can={balance >= bagCost(p.bagLevel)}
              onClick={() => buy('bag')}
            />
          ) : (
            <Done />
          )
        }
      />
      <Row
        icon={<span className="pforge__glyph">🛒</span>}
        title="Вагонетка"
        text="Сама продаёт рюкзак, когда он полон"
        action={
          p.cart ? (
            <Done />
          ) : (
            <Buy price={CART_PRICE} can={balance >= CART_PRICE} onClick={() => buy('cart')} />
          )
        }
      />
      <p className="pcamp-note">
        Сломано блоков: {fmt(p.mined)} · выручено: {fmt(p.earned)} монет · продажа ×
        {m.sell.toFixed(2)}
      </p>
    </div>
  );
}

// ---- Чары: за токены ---------------------------------------------------------

function enchantNow(id: EnchantId, p: PrisonState): string {
  const l = p.ench[id];
  const m = modsOf(p);
  switch (id) {
    case 'power':
      return `+${10 * l}% урона`;
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
              Уровень кирки — в ноль, зато потолок каждой чары +{Math.round(STAR_CAP * 100)}%, урон
              +{Math.round(STAR_DMG * 100)}%, {fmt(STAR_TOKENS * (p.pickStars + 1))} токенов и{' '}
              {STAR_KEYS} ключа. Купленные уровни чар остаются.
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
      <p className="pcamp-note">
        Уровень кирки растёт от каждого сломанного блока: открывает новые чары и поднимает их
        потолок. Жилу, взрыв, отбойник и кураж можно выключить, не теряя уровней. Сброс возвращает
        половину токенов.
      </p>
    </div>
  );
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
          icon={<span className="pforge__glyph">{it.glyph}</span>}
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
      <p className="pcamp-note">
        Расходники лежат под полем шахты: бомбу — тапом по кнопке, потом по клетке.
      </p>
    </div>
  );
}

// ---- Сундуки -----------------------------------------------------------------

function CasesTab({ onGain }: { onGain: (from: number, to: number) => void }) {
  const p = useFinanceStore((s) => s.prison);
  const [open, setOpen] = useState<OpenedCase | null>(null);
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
        </div>
      </div>
      <div className="pchest__odds">
        {CASE_TIERS.map((t) => (
          <span key={t.id} style={{ color: t.color }}>
            {t.name} · {t.weight}%
          </span>
        ))}
      </div>
      <p className="pcamp-note">
        Монеты в сундуке — доля цены твоего ранга, поэтому сундук одинаково приятен и на C, и на X.
        Находка из сундука — всегда та, которой в коллекции ещё нет. Открыто: {fmt(p.cases)}.
      </p>
      {open && <CaseRoller first={open} onClose={() => setOpen(null)} onGain={onGain} />}
    </div>
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
      return (
        <span className="preward__emoji" style={{ fontSize: size * 0.9 }}>
          {ITEMS.find((i) => i.id === r.id)!.glyph}
        </span>
      );
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
  const y = crewYield(p, now);
  const cap = crewCapHours(p);
  const price = p.crew < CREW_MAX ? crewCost(p.crew) : 0;
  const hh = Math.floor(y.minutes / 60);
  const mm = Math.floor(y.minutes % 60);
  return (
    <div className="pforge">
      <div className="pcrew">
        <span className="pcrew__art" aria-hidden="true">
          {p.crew ? '👷'.repeat(Math.min(3, p.crew)) : '🪧'}
        </span>
        <div className="pcrew__info">
          <b>{p.crew ? `Бригада · уровень ${p.crew}` : 'Бригады нет'}</b>
          <i>
            {p.crew
              ? `${crewRate(p.crew).toFixed(1)} блока в минуту в шахте ${rankLetter(p.rank)}, копит до ${cap} ч`
              : `Копает в лучшей шахте, пока тебя нет, до ${cap} часов. Отдаёт 60% добытого.`}
          </i>
        </div>
      </div>
      {p.crew > 0 && (
        <div className="pcrew__yield">
          <div className="pcrew__row">
            <span>
              {hh} ч {String(mm).padStart(2, '0')} мин {y.capped ? '· смена кончилась' : ''}
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
            onClick={() => {
              primeAudio();
              const from = useFinanceStore.getState().slotsBalance;
              const got = prisonCrewCollect();
              if (!got) {
                notifyWarning();
                return;
              }
              onGain(from, from + got.coins);
              coinDing();
              notifySuccess();
            }}
          >
            Забрать {fmt(y.blocks)} блоков
          </button>
        </div>
      )}
      {p.crew < CREW_MAX ? (
        <Row
          icon={<span className="pforge__glyph">⛏</span>}
          title={p.crew ? `Уровень ${p.crew + 1}` : 'Нанять бригаду'}
          text={`${crewRate(p.crew + 1).toFixed(1)} блока в минуту${p.crew ? `, сейчас ${crewRate(p.crew).toFixed(1)}` : ''}`}
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
        <p className="pcamp-note">Бригада полная.</p>
      )}
      <p className="pcamp-note">
        Бригада работает всегда — и когда ты в игре, и когда нет. Смена кончилась — бригада стоит,
        пока не заберёшь добычу. Перк «Длинная смена» продлевает её до 12 часов.
      </p>
    </div>
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
      <p className="pcamp-note">
        Каждая новая находка — +1% к продаже навсегда, вся коллекция — ещё +10%. Дубликат сдаётся за
        40 токенов. Находки падают с блоков редко, одна на пару тысяч; сундук всегда кладёт
        недостающую.
      </p>
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
        <p className="pcamp-note" style={{ marginTop: 4 }}>
          Перки открывает престиж: дойди до ранга Z и начни круг заново. За каждый престиж — два
          очка. Ранг сейчас: {rankLetter(p.rank)}, до Z ещё {ROCKS.length - 1 - p.rank}.
        </p>
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
// Руны. Знак вырезан на плитке сланца, цвет — ступень (как у сундуков, плюс
// пятая — красная). Рисуется линиями: символы старшего футарка есть не в
// каждом шрифте телефона, а квадрат вместо руны хуже, чем никакой руны.
// ---------------------------------------------------------------------------

export const RUNE_COLORS = ['#9aa7b4', '#4f8cff', '#b36cff', '#ffb020', '#ff5a6a'];

const RUNE_PATHS: Record<RuneKind, string> = {
  sell: 'M7 4 V24 M7 11 L14 5 M7 17 L14 11',
  dmg: 'M6 24 V4 L14 10 V24',
  rate: 'M6 24 V4 L13 8 L6 13 L14 24',
  loot: 'M9 5 L4 11 L9 17 M11 11 L16 17 L11 23',
  token: 'M4 5 L16 23 M16 5 L4 23',
  proc: 'M13 3 L6 11 L14 17 L7 25',
};

export function RuneIcon({
  kind,
  tier,
  size = 28,
}: {
  kind: RuneKind;
  tier: number;
  size?: number;
}) {
  const c = RUNE_COLORS[Math.max(1, Math.min(5, tier)) - 1];
  return (
    <svg
      className="prune-ico"
      viewBox="0 0 20 28"
      width={(size * 20) / 28}
      height={size}
      aria-hidden="true"
    >
      <path
        d="M3.5 1.5 H16.5 Q18.5 1.5 18.5 4 V23.5 Q18.5 26.5 15.5 26.5 H4.5 Q1.5 26.5 1.5 23.5 V4 Q1.5 1.5 3.5 1.5Z"
        fill="#272320"
        stroke={c}
        strokeWidth="1.3"
      />
      <path
        d={RUNE_PATHS[kind]}
        fill="none"
        stroke={c}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const pctText = (x: number) =>
  `+${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

/** Руна словами: «Феху III · +7,1% к продаже». */
export function runeLine(r: { kind: RuneKind; tier: number; roll: number }): string {
  return `${pctText(runePower(r))} ${runeOf(r.kind).text}`;
}

/** Есть свободное гнездо и руна, которую можно в него вставить. */
function runesIdle(p: PrisonState): boolean {
  const open = socketsOpen(p);
  const empty = p.sockets.slice(0, open).some((id) => !id);
  return empty && p.runes.some((r) => !p.sockets.includes(r.id));
}

const BONUS_TEXT: { k: keyof Bonus; text: string }[] = [
  { k: 'sell', text: 'к продаже' },
  { k: 'dmg', text: 'к урону' },
  { k: 'rate', text: 'к скорости' },
  { k: 'loot', text: 'к добыче' },
  { k: 'token', text: 'к токенам' },
  { k: 'proc', text: 'к шансам чар' },
  { k: 'luck', text: 'к ключам и передачкам' },
];

function bonusSummary(b: Bonus): string {
  const parts = BONUS_TEXT.filter((x) => b[x.k] > 0).map((x) => `${pctText(b[x.k])} ${x.text}`);
  return parts.length ? parts.join(' · ') : 'пока ничего';
}

function RunesTab() {
  const p = useFinanceStore((s) => s.prison);
  const socket = useFinanceStore((s) => s.prisonRuneSocket);
  const fuse = useFinanceStore((s) => s.prisonRuneFuse);
  const shatter = useFinanceStore((s) => s.prisonRuneShatter);
  const [sel, setSel] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const open = socketsOpen(p);
  const level = pickLevelOf(p.pickXp).level;
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
          : 'Первое гнездо — с 5 уровня кирки',
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
      <div className="prunes-head">
        <b>Кирка</b>
        <span>{bonusSummary(bonusOf(p))}</span>
      </div>
      <div className="prunes-sockets">
        {Array.from({ length: SOCKETS_MAX }, (_, i) => {
          const id = p.sockets[i];
          const r = id ? p.runes.find((x) => x.id === id) : null;
          const locked = i >= open;
          return (
            <button
              key={i}
              type="button"
              className={`prune-socket${locked ? ' is-locked' : ''}${r ? ' is-full' : ''}${
                r && sel === r.id ? ' is-sel' : ''
              }${rune && !worn && !locked ? ' is-target' : ''}`}
              onClick={() => tapSocket(i)}
            >
              {r ? (
                <>
                  <RuneIcon kind={r.kind} tier={r.tier} size={30} />
                  <i>{pctText(runePower(r))}</i>
                </>
              ) : locked ? (
                <>
                  <span className="prune-socket__lock">🔒</span>
                  <i>{i < SOCKET_UNLOCK.length ? `ур. ${SOCKET_UNLOCK[i]}` : 'престиж 10'}</i>
                </>
              ) : (
                <i>пусто</i>
              )}
            </button>
          );
        })}
      </div>
      {rune ? (
        <div className="prune-card">
          <RuneIcon kind={rune.kind} tier={rune.tier} size={44} />
          <span className="prune-card__info">
            <b>
              {runeOf(rune.kind).name} {RUNE_ROMAN[rune.tier - 1]}
            </b>
            <i>{runeLine(rune)}</i>
            <em>сила {rune.roll} из 100 внутри ступени</em>
          </span>
          <span className="prune-card__btns">
            <button type="button" className="btn btn--sm pforge__buy" onClick={wear}>
              {worn ? 'Вынуть' : 'В кирку'}
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
          {p.runes.length
            ? 'Выбери руну: вставить в кирку, сплавить или разбить на токены'
            : `Рун пока нет. Они приходят в передачках и сундуках${level < SOCKET_UNLOCK[0] ? '; первое гнездо откроется на 5 уровне кирки' : ''}`}
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
              <RuneIcon kind={r.kind} tier={r.tier} size={30} />
              <i>{RUNE_ROMAN[r.tier - 1]}</i>
            </button>
          ))}
        </div>
      )}
      <p className="pcamp-note">
        Мешочек: {p.runes.length} из {RUNE_BAG}. Три руны одной ступени сплавляются в руну ступенью
        выше — вид у выбранной, сила не ниже средней. Лишние разбивай на токены: в полный мешочек
        новая руна не ляжет и разобьётся сама.
      </p>
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
                  : `Придёт в передачке · ${d.text}`}
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
      <p className="pcamp-note">
        С собой ходит один. Растёт от каждого блока, пока он с тобой. Второй такой же из передачки —
        лакомство: опыт тому, кто с тобой.
      </p>
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
    out.push(`передачка «${TIERS_OF.find((t) => t.id === r.parcel)!.name.toLowerCase()}»`);
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
// Вскрытие передачки. Коробка трясётся три удара (редкая — дольше), потом
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
          <span className="preveal__tier">Передачка · {tier.name.toLowerCase()}</span>
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
            <Buy price={TRUCK_PRICE} can={balance >= TRUCK_PRICE} onClick={() => buy('truck')} />
          )
        }
      />
      <AxeEnchSection f={f} p={p} />
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
    <>
      <h4 className="pcamp-h">Чары топора</h4>
      <div className="pcamp-purse">
        <TokenIcon size={18} /> <b>{fmt(p.tokens)}</b> токенов
        <span>общие с киркой</span>
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
    </>
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

function MillTab({
  now,
  onGain,
  onSpend,
}: {
  now: number;
  onGain: (from: number, to: number) => void;
  onSpend: () => void;
}) {
  const f = useFinanceStore((s) => s.forest);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const forestMillUp = useFinanceStore((s) => s.forestMillUp);
  const forestMillLoad = useFinanceStore((s) => s.forestMillLoad);
  const forestMillSell = useFinanceStore((s) => s.forestMillSell);
  const forestCraftProp = useFinanceStore((s) => s.forestCraftProp);
  const forestCraftHandle = useFinanceStore((s) => s.forestCraftHandle);
  const mill = millTick(f.mill, now);
  const fm = forestMods(p, f);
  const reserve = boardsReserve(p.handle);
  const sale = boardsForSale(mill.boards, reserve);
  const saleValue = Math.round(boardsValue(sale) * fm.sell);
  const queued = sumRow(mill.queue);
  const boards = sumRow(mill.boards);
  const cap = millQueueCap(mill.level);
  const rate = millRate(mill.level);
  const nextH = HANDLES[p.handle];
  const curH = HANDLES[p.handle - 1];
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
  };
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
        <div className="pforge__now">
          <MillIcon size={40} />
          <span>
            <b>Пилорамы нет</b>
            <i>Брёвна пока уходят кругляком</i>
          </span>
        </div>
        <Row
          icon={<MillIcon size={30} />}
          title="Поставить пилораму"
          text={`${Math.round(millRate(1))} брёвен в минуту, доска в ${BOARD_MULT.toLocaleString('ru-RU')} раза дороже бревна`}
          action={<Buy price={millCost(0)} can={balance >= millCost(0)} onClick={up} />}
        />
        <p className="pcamp-note">
          Пилорама пилит брёвна в доски сама — и пока ты в шахте, и пока телефон в кармане. Из досок
          сбивают крепь для шахты и точат рукояти для кирки и топора.
        </p>
      </div>
    );
  }

  return (
    <div className="pforge">
      <div className="pforge__now">
        <MillIcon size={40} />
        <span>
          <b>Пилорама {mill.level} ур.</b>
          <i>
            {Math.round(rate)} брёвен в минуту
            {curH ? ` · ${curH.name.toLowerCase()} +${Math.round(curH.rate * 100)}%` : ''}
          </i>
        </span>
      </div>
      <div className="pmill-queue">
        <span className="pmill-queue__top">
          <b>
            В очереди {fmt(queued)} / {fmt(cap)}
          </b>
          <i>{queued ? `допилит через ${minutes(queued / rate)}` : 'стоит без дела'}</i>
        </span>
        <span className="pmill-queue__bar">
          <i style={{ transform: `scaleX(${Math.min(1, queued / cap)})` }} />
        </span>
        <button
          type="button"
          className="btn btn--sm btn--block"
          disabled={!f.pile.n || queued >= cap}
          onClick={load}
        >
          {f.pile.n ? `Загрузить штабель · ${fmt(f.pile.n)} брёвен` : 'Штабель пуст'}
        </button>
      </div>
      <div className="pmill-boards">
        {mill.boards.every((k) => k === 0) ? (
          <span className="pmill-boards__empty">Досок пока нет</span>
        ) : (
          mill.boards.map((k, i) =>
            k > 0 ? (
              <span key={i} className="pmill-board" title={SPECIES[i].name}>
                <img src={boardTexture(i)} alt="" />
                {fmt(k)}
              </span>
            ) : null,
          )
        )}
      </div>
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

      <h4 className="pcamp-h">Верстак</h4>
      <Row
        icon={<span className="pforge__glyph">⛩</span>}
        title={<>Крепь {p.items.prop > 0 && <span className="pench-lvl">×{p.items.prop}</span>}</>}
        text={`${PROP_BOARDS} досок любых пород: в шахте ${Math.round(PROP_MS / 60_000)} минут каждый второй блок — порода выше`}
        action={
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={boards < PROP_BOARDS}
            onClick={() => {
              primeAudio();
              if (!forestCraftProp()) {
                notifyWarning();
                return;
              }
              tierBreak(0);
              notifySuccess();
            }}
          >
            Сбить
          </button>
        }
      />
      {nextH ? (
        <Row
          icon={<img className="pmill-hico" src={boardTexture(nextH.species)} alt="" />}
          title={nextH.name}
          text={`${fmt(Math.min(mill.boards[nextH.species], nextH.boards))}/${nextH.boards} досок ${SPECIES[nextH.species].gen} · +${Math.round(nextH.rate * 100)}% к скорости кирки и топора${curH ? ` (вместо ${Math.round(handleRate(p.handle) * 100)}%)` : ''}`}
          action={
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={mill.boards[nextH.species] < nextH.boards}
              onClick={() => {
                primeAudio();
                if (!forestCraftHandle()) {
                  notifyWarning();
                  return;
                }
                tierBreak(2);
                burstConfetti(40, ['#e8c89a', '#ffe08a', '#fff']);
                notifySuccess();
              }}
            >
              Выточить
            </button>
          }
        />
      ) : (
        <Row
          icon={<img className="pmill-hico" src={barkTexture(9)} alt="" />}
          title="Рукоять из карельской берёзы"
          text="Лучше рукояти не бывает"
          action={<Done />}
        />
      )}
      <p className="pcamp-note">
        Пилит дорогие породы вперёд. Лесовоз везёт полный штабель сюда, пока в очереди есть место;
        свиль, капокорень и дрова с кроны оплачиваются сразу при загрузке.
      </p>
    </div>
  );
}
