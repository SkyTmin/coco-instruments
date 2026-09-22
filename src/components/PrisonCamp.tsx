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
  ENCHANTS,
  enchantCap,
  enchantCost,
  enchantRefund,
  ENCHANT_TOGGLE,
  ENCHANT_UNLOCK,
  FINDS,
  findsFound,
  findsMult,
  hitDamage,
  ITEMS,
  modsOf,
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
import type { CaseRoll, CaseTier, EnchantId, PerkId, PrisonState, Reward } from '@/lib/prison';
import { findTexture } from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { caseTick, coinDing, payoutEnd, primeAudio, tierBreak } from '@/lib/sound';
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

export function KeyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="5" cy="8" r="3.4" fill="none" stroke="#e8b43a" strokeWidth="2" />
      <path d="M8 8 H15 M12.5 8 V11 M14.5 8 V10.4" stroke="#e8b43a" strokeWidth="2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Лист лагеря.
// ---------------------------------------------------------------------------

export type CampTab = 'forge' | 'enchant' | 'shop' | 'cases' | 'crew' | 'finds' | 'perks';

const TABS: { id: CampTab; name: string }[] = [
  { id: 'forge', name: 'Кузница' },
  { id: 'enchant', name: 'Чары' },
  { id: 'shop', name: 'Лавка' },
  { id: 'cases', name: 'Сундуки' },
  { id: 'crew', name: 'Бригада' },
  { id: 'finds', name: 'Коллекция' },
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
  const now = useNow(1000);
  const crew = crewYield(p, now);
  const badge: Partial<Record<CampTab, ReactNode>> = {
    cases: p.keys > 0 ? p.keys : null,
    crew: crew.blocks > 0 && crew.minutes >= 10 ? '•' : null,
    perks: perkPointsFree(p) > 0 ? perkPointsFree(p) : null,
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
        {tab === 'enchant' && <EnchantTab />}
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
  }
}

/** Сколько уровней чары возьмёт кнопка и во что это встанет. */
function enchantPlan(
  id: EnchantId,
  p: PrisonState,
  want: number,
): { k: number; price: number; next: number } {
  const cap = enchantCap(id, pickLevelOf(p.pickXp).level);
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
  const [confirm, setConfirm] = useState<EnchantId | null>(null);
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
        </span>
        <span className="pench-pick__bar">
          <i style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
        </span>
        <span className="pench-pick__txt">
          {lvl.need ? `ещё ${fmt(lvl.need - lvl.into)} блоков` : 'максимум'}
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
      {ENCHANTS.map((e) => {
        const l = p.ench[e.id];
        const cap = enchantCap(e.id, lvl.level);
        const locked = cap === 0;
        const maxed = l >= e.max;
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
                  {l}/{maxed || locked ? e.max : cap}
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
                  tierBreak(l + got >= e.max ? 2 : got >= 5 ? 1 : 0);
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
      {ITEMS.map((it) => (
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

function rewardLabel(r: Reward): string {
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
  }
}

function RewardIcon({ r, size = 30 }: { r: Reward; size?: number }) {
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
