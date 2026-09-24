// Инвентарь вылазки — как в Майнкрафте (просьба владельца): слева броня на
// человечке, справа клинок и что он даёт, ниже сидор ячейками со стопками.
// Открывается кнопкой сидора прямо в бою, мир на это время стоит. Тап по
// ячейке — подробности и действия (съесть, выбросить); тап по вещи на
// человечке — её сила, заточка и перековка ПРЯМО ЗДЕСЬ (владелец: «качать
// вещи можно прям в подземелье»); тап по тёмному ряду — нашить карман.

import { useEffect, useMemo, useState } from 'react';
import { CoinIcon } from '@/components/slot-art';
import { KeyIcon, TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import {
  areaOf,
  AREA_PAY,
  conditionsMet,
  econOf,
  fullSet,
  levelOf,
  marketSold,
  MARKET_CUT,
  MARKET_FULL,
  MATS,
  MEAT_NAMES,
  MEAT_SHARE,
  minusMats,
  nextStep,
  payFromBoth,
  pieceStats,
  reforgeConditions,
  SACK_MAX,
  SACK_ROW,
  sackCost,
  sackSlots,
  sackStacks,
  setOf,
  SLOT_NAMES,
  SLOTS,
  slotsUsed,
  STACK,
  upgradable,
} from '@/lib/dungeon';
import type { AreaId, Cost, DungeonState, ItemId, MatId, MeatId, Slot } from '@/lib/dungeon';
import type { Sim } from '@/lib/dungeon-sim';
import { heroPortrait, useDungeonSprites } from '@/lib/dungeon-sprites';
import { gearIcon, heroFrame, itemUrl } from '@/lib/dungeon-art';
import { registerEscape } from '@/lib/escape-stack';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { coinDing, tierBreak } from '@/lib/sound';
import { shortMoney } from '@/lib/prison';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const isMeat = (id: ItemId): id is MeatId => id === 'meat' || id === 'fatmeat';
const itemName = (id: ItemId) => (isMeat(id) ? MEAT_NAMES[id] : MATS[id as MatId].name);

const urls = new Map<string, string>();
const spriteUrl = (key: string, make: () => HTMLCanvasElement) => {
  let u = urls.get(key);
  if (!u) {
    u = make().toDataURL();
    urls.set(key, u);
  }
  return u;
};

type Pick =
  | { kind: 'gear'; slot: Slot }
  | { kind: 'stack'; id: ItemId; i: number }
  | { kind: 'pocket' }
  | null;

/** Цена: монеты из кошелька, материалы — склад лагеря плюс сидор. */
function CostRow({
  cost,
  balance,
  d,
  sack,
}: {
  cost: Cost;
  balance: number;
  d: DungeonState;
  sack: Partial<Record<MatId, number>>;
}) {
  return (
    <span className="mcinv__cost">
      <span className={balance >= cost.coins ? '' : 'is-short'}>
        <CoinIcon size={11} /> {shortMoney(cost.coins)}
      </span>
      {(Object.entries(cost.mats) as [MatId, number][]).map(([id, n]) => {
        const have = (d.stash[id] ?? 0) + (sack[id] ?? 0);
        return (
          <span key={id} className={have >= n ? '' : 'is-short'} title={MATS[id].name}>
            <img src={itemUrl(id)} alt={MATS[id].name} /> {fmt(have)}/{fmt(n)}
          </span>
        );
      })}
    </span>
  );
}

function statLine(slot: Slot, tier: number, plus: number): string[] {
  const s = pieceStats(slot, { tier, plus });
  if (slot === 'weapon') return [`Урон ${s.dmg.toFixed(0)}`];
  if (slot === 'helm') return [`Броня ${s.armor.toFixed(0)}`, `Свет ${s.light.toFixed(1)} кл.`];
  if (slot === 'robe') return [`Броня ${s.armor.toFixed(0)}`, `Здоровье +${s.hp.toFixed(0)}`];
  return [`Шаг ${s.speed.toFixed(1)} кл./с`, `Рывок ${s.dash.toFixed(1)} кл.`];
}

export function DungeonInventory({
  sim,
  onClose,
  onEat,
  onDrop,
  onSave,
  onGear,
}: {
  sim: Sim;
  onClose: () => void;
  /** Съесть кусок: лист закрывается, герой ест в бою. */
  onEat: () => void;
  onDrop: (id: ItemId, n: number) => void;
  /** Записать сделанное в вылазке — условия перековки считаются по стору. */
  onSave: () => void;
  /** Снаряжение или сидор изменились — пересчитать героя в бою. */
  onGear: () => void;
}) {
  const d = useFinanceStore((s) => s.dungeon);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const upgradeHere = useFinanceStore((s) => s.dungeonUpgradeHere);
  const sackUpHere = useFinanceStore((s) => s.dungeonSackUpHere);
  const [pick, setPick] = useState<Pick>(null);
  // Сидор живёт в мире, а не в сторе: после «выбросить» перерисовываемся сами.
  const [, bump] = useState(0);
  useEffect(() => registerEscape(onClose), [onClose]);

  const sprites = useDungeonSprites();
  const gearKey = SLOTS.map((s) => `${d.gear[s].tier}`).join('');
  const heroUrl = useMemo(
    () =>
      spriteUrl(
        `inv:${gearKey}:${sprites ? 1 : 0}`,
        () => heroPortrait(d.gear) ?? heroFrame(d.gear, 'down', 'idle', 0, false),
      ),
    // Картинка меняется только со ступенями.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gearKey, sprites],
  );
  const st = sim.stats;
  const lv = levelOf(sim.xp);
  const slots = sackSlots(sim.sackLevel);
  const stacks = sackStacks(sim.sack);
  const used = slotsUsed(sim.sack);
  const rows = SACK_MAX + 1;
  const set = fullSet(d.gear);
  const econ = econOf(prison);

  // Цена куска: средний район мяса в сидоре, рынок этого часа.
  const areaMul = (() => {
    let k = 0;
    let n = 0;
    for (const [id, c] of Object.entries(sim.sack.meatBy) as [AreaId, number][]) {
      k += c * Math.pow(AREA_PAY, areaOf(id).level);
      n += c;
    }
    return n > 0 ? k / n : 1;
  })();
  const cut = marketSold(d, Date.now()) >= MARKET_FULL ? MARKET_CUT : 1;

  const choose = (p: Pick) => {
    selectionChanged();
    setPick(p);
  };

  // Сделанное в этой вылазке ещё не записано в стор — прибавляем для показа.
  const live: DungeonState = { ...d, kills: { ...d.kills }, stats: { ...d.stats } };
  for (const [k, v] of Object.entries(sim.delta.kills))
    live.kills[k as keyof typeof live.kills] =
      (live.kills[k as keyof typeof live.kills] ?? 0) + (v ?? 0);
  for (const [k, v] of Object.entries(sim.delta.stats))
    live.stats[k as keyof typeof live.stats] =
      (live.stats[k as keyof typeof live.stats] ?? 0) + (v ?? 0);

  // «!» на вещи, которую можно улучшить прямо сейчас (склад плюс рюкзак).
  const ups = upgradable(live, econ, balance, sim.sack.mats);

  const canAfford = (cost: Cost) =>
    balance >= cost.coins && payFromBoth(d, cost, sim.sack.mats) !== null;

  /** Сидор отдал материалы в уплату — мир держит сидор, стор его не знает. */
  const tookFromSack = (from: Partial<Record<MatId, number>>) => {
    sim.sack.mats = minusMats(sim.sack.mats, from);
  };

  const upgrade = (slot: Slot) => {
    // Убийства и руда этой вылазки — в стор, иначе перековка их не увидит.
    onSave();
    const r = upgradeHere(slot, sim.sack.mats);
    if (!r) {
      notifyWarning();
      return;
    }
    tookFromSack(r.fromSack);
    onGear();
    if (r.kind === 'reforge') tierBreak(3);
    else coinDing();
    notifySuccess();
    bump((x) => x + 1);
  };

  const pocket = () => {
    onSave();
    const r = sackUpHere(sim.sack.mats);
    if (!r) {
      notifyWarning();
      return;
    }
    tookFromSack(r.fromSack);
    onGear();
    coinDing();
    notifySuccess();
    setPick(null);
    bump((x) => x + 1);
  };

  const slotBtn = (slot: Slot) => {
    const g = d.gear[slot];
    const on = pick?.kind === 'gear' && pick.slot === slot;
    return (
      <button
        key={slot}
        type="button"
        className={`mcslot mcslot--gear${on ? ' is-on' : ''}`}
        onClick={() => choose({ kind: 'gear', slot })}
        aria-label={SLOT_NAMES[slot]}
      >
        <img src={gearIcon(slot, g.tier)} alt="" />
        {g.plus > 0 && <b className="mcslot__n">+{g.plus}</b>}
        {ups.includes(slot) && <span className="gx-badge gx-badge--gold">!</span>}
      </button>
    );
  };

  let info: JSX.Element;
  if (pick?.kind === 'gear') {
    const g = d.gear[pick.slot];
    const s = setOf(g.tier);
    const step = nextStep(d, pick.slot, econ);
    const conds = step.kind === 'reforge' ? reforgeConditions(pick.slot, g.tier) : [];
    info = (
      <>
        <b className="mcinv__name">
          {s.items[pick.slot]}
          {g.plus > 0 && <em> +{g.plus}</em>}
        </b>
        <span className="mcinv__sub">
          {SLOT_NAMES[pick.slot]} · комплект «{s.name}»
        </span>
        {statLine(pick.slot, g.tier, g.plus).map((x) => (
          <span key={x} className="mcinv__stat">
            {x}
          </span>
        ))}
        <span className={`mcinv__set${set === g.tier ? ' is-on' : ''}`}>
          Все четыре вещи «{s.name}»: {s.bonus}
          {set === g.tier ? ' — действует' : ''}
        </span>
        {step.kind === 'plus' && (
          <>
            <span className="mcinv__sub">
              Заточка до +{g.plus + 1}: {statLine(pick.slot, g.tier, g.plus + 1).join(', ')}
            </span>
            <CostRow cost={step.cost} balance={balance} d={d} sack={sim.sack.mats} />
            <div className="mcinv__acts">
              <button
                type="button"
                className="mcbtn mcbtn--ok"
                disabled={!canAfford(step.cost)}
                onClick={() => upgrade(pick.slot)}
              >
                Заточить до +{g.plus + 1}
              </button>
            </div>
          </>
        )}
        {step.kind === 'reforge' && (
          <>
            <span className="mcinv__sub">
              Улучшение до «{setOf(g.tier + 1).items[pick.slot]}»
              {conditionsMet(live, pick.slot, g.tier) ? ' — условия выполнены' : ':'}
            </span>
            {conds.map((c) => {
              const have = Math.min(c.need, c.have(live));
              return (
                <span key={c.label} className={`mcinv__cond${have >= c.need ? ' is-done' : ''}`}>
                  <span>
                    {c.label}
                    <em>
                      {fmt(have)} / {fmt(c.need)}
                    </em>
                  </span>
                  <i>
                    <i style={{ transform: `scaleX(${have / c.need})` }} />
                  </i>
                </span>
              );
            })}
            <CostRow cost={step.cost} balance={balance} d={d} sack={sim.sack.mats} />
            <div className="mcinv__acts">
              <button
                type="button"
                className="mcbtn mcbtn--ok"
                disabled={!conditionsMet(live, pick.slot, g.tier) || !canAfford(step.cost)}
                onClick={() => upgrade(pick.slot)}
              >
                Улучшить
              </button>
            </div>
          </>
        )}
        {(step.kind === 'soon' || step.kind === 'max') && (
          <span className="mcinv__sub">Заточено до предела. Дальше — новые районы.</span>
        )}
      </>
    );
  } else if (pick?.kind === 'stack' && stacks[pick.i]?.id === pick.id) {
    const sk = stacks[pick.i];
    const meat = isMeat(sk.id);
    const each = meat
      ? econ * MEAT_SHARE[sk.id as MeatId] * areaMul * cut
      : econ * MATS[sk.id as MatId].share;
    const total = meat
      ? (sim.sack.meat[sk.id as MeatId] ?? 0)
      : (sim.sack.mats[sk.id as MatId] ?? 0);
    const canEat = meat && sim.hero.hp < st.maxHp && sim.hero.eatCd <= 0;
    info = (
      <>
        <b className="mcinv__name">
          {itemName(sk.id)} <em>×{sk.n}</em>
        </b>
        <span className="mcinv__sub">
          {meat
            ? `Лечит ${Math.round(st.maxHp * (sk.id === 'fatmeat' ? 0.25 : 0.15))} здоровья. Пахнет — крысы идут на запах.`
            : MATS[sk.id as MatId].lead}
        </span>
        <span className="mcinv__stat">
          {meat ? 'Торговец даст' : 'Цена лишнего'} ≈ {fmt(each)} <CoinIcon size={11} /> за штуку ·
          всего в рюкзаке {fmt(total)}
        </span>
        <span className="mcinv__sub">
          В ячейке до {STACK[sk.id]} шт.
          {meat && cut < 1 ? ' Рынок этого часа насыщен — цена вдвое ниже.' : ''}
        </span>
        <div className="mcinv__acts">
          {meat && (
            <button
              type="button"
              className="mcbtn mcbtn--ok"
              disabled={!canEat}
              onClick={() => {
                tapLight();
                onEat();
              }}
            >
              Съесть
            </button>
          )}
          <button
            type="button"
            className="mcbtn"
            onClick={() => {
              tapLight();
              onDrop(sk.id, 1);
              bump((x) => x + 1);
            }}
          >
            Выбросить 1
          </button>
          <button
            type="button"
            className="mcbtn mcbtn--warn"
            onClick={() => {
              tapLight();
              onDrop(sk.id, sk.n);
              setPick(null);
              bump((x) => x + 1);
            }}
          >
            Выбросить стопку
          </button>
        </div>
      </>
    );
  } else if (pick?.kind === 'pocket' && sim.sackLevel < SACK_MAX) {
    const cost = sackCost(sim.sackLevel, econ);
    info = (
      <>
        <b className="mcinv__name">Карман</b>
        <span className="mcinv__sub">
          Рюкзак побольше: {sackSlots(sim.sackLevel + 1)} ячеек вместо {slots}. Готов сразу, прямо
          здесь. Шкурки — со склада, недостающие — из рюкзака.
        </span>
        <CostRow cost={cost} balance={balance} d={d} sack={sim.sack.mats} />
        <div className="mcinv__acts">
          <button
            type="button"
            className="mcbtn mcbtn--ok"
            disabled={!canAfford(cost)}
            onClick={pocket}
          >
            Увеличить рюкзак
          </button>
        </div>
      </>
    );
  } else {
    info = (
      <span className="mcinv__hint">
        Тапни по вещи на человечке — заточить её можно прямо здесь. Тап по ячейке — съесть или
        выбросить. Монеты, токены и ключи лежат в кошельке на поясе и места не занимают.
      </span>
    );
  }

  return (
    <div className="mcinv-back" onClick={onClose}>
      <div className="mcinv" onClick={(e) => e.stopPropagation()}>
        <div className="mcinv__head">
          <b>Инвентарь</b>
          <button type="button" className="mcinv__x" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mcinv__top">
          <div className="mcinv__armor">{(['helm', 'robe', 'boots'] as Slot[]).map(slotBtn)}</div>
          <div className="mcinv__doll">
            <img src={heroUrl} alt="" />
          </div>
          <div className="mcinv__side">
            {slotBtn('weapon')}
            <span className="mcinv__lv">
              Ур. {lv.level}
              <i>
                <i style={{ transform: `scaleX(${lv.need ? lv.into / lv.need : 1})` }} />
              </i>
            </span>
            <span className="mcinv__stats">
              <span>
                <em className="mcico mcico--hp" /> {Math.ceil(sim.hero.hp)}/{st.maxHp}
              </span>
              <span>
                <em className="mcico mcico--dmg" /> {st.dmg.toFixed(0)}
              </span>
              <span>
                <em className="mcico mcico--arm" /> {st.armor.toFixed(0)}
              </span>
              <span>
                <em className="mcico mcico--crit" /> {Math.round(st.crit * 100)}%
              </span>
            </span>
          </div>
        </div>

        <div className="mcinv__label">
          Рюкзак{' '}
          <em>
            {used}/{slots} ячеек
          </em>
        </div>
        <div className="mcinv__grid">
          {Array.from({ length: rows * SACK_ROW }, (_, i) => {
            const locked = i >= slots;
            const sk = locked ? undefined : stacks[i];
            const on =
              (pick?.kind === 'stack' && pick.i === i) ||
              (pick?.kind === 'pocket' && locked && i < slots + SACK_ROW);
            return (
              <button
                key={i}
                type="button"
                className={`mcslot${locked ? ' is-locked' : ''}${on ? ' is-on' : ''}`}
                disabled={!locked && !sk}
                onClick={() =>
                  locked
                    ? choose({ kind: 'pocket' })
                    : sk && choose({ kind: 'stack', id: sk.id, i })
                }
              >
                {sk && <img src={itemUrl(sk.id)} alt={itemName(sk.id)} />}
                {sk && sk.n > 1 && <b className="mcslot__n">{sk.n}</b>}
              </button>
            );
          })}
        </div>
        {slots < rows * SACK_ROW && (
          <span className="mcinv__lock">Тёмные ряды — место под рюкзак побольше: нажми.</span>
        )}

        <div className="mcinv__purse">
          <span>
            <CoinIcon size={14} /> {fmt(sim.sack.coins)}
          </span>
          <span>
            <TokenIcon size={14} /> {sim.sack.tokens}
          </span>
          <span>
            <KeyIcon size={14} /> {sim.sack.keys}
          </span>
        </div>

        <div className="mcinv__info">{info}</div>
      </div>
    </div>
  );
}
