// Лагерь подземелья: снаряжение (заточка и перековка по условиям),
// бестиарий и склад с сидором. Живёт вкладками в том же листе лагеря, что
// шахта и лес (`PrisonCamp`, место 'dungeon').
//
// Перековка открывается не деньгами, а делом: «убить 300 пасюков», «вскрыть
// три шахты» — как меч на VimeWorld. Поэтому у каждого условия своя полоса
// и цифра «сколько ещё» — условие без прогресса читается как отказ.

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import {
  beastStep,
  BEAST_STEPS,
  BOSSES,
  canPay,
  conditionsMet,
  econOf,
  fullSet,
  heroOf,
  levelOf,
  MATS,
  MOBS,
  nextStep,
  pieceStats,
  reforgeConditions,
  SACK_MAX,
  SACK_ROW,
  sackCost,
  sackSlots,
  setOf,
  SETS,
  SLOT_NAMES,
  SLOTS,
} from '@/lib/dungeon';
import type { Cost, MatId, MobId, Slot } from '@/lib/dungeon';
import { gearIcon, heroFrame, itemUrl, mobArt } from '@/lib/dungeon-art';
import { shortMoney } from '@/lib/prison';
import { coinDing, primeAudio, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/** Спрайт кодом → картинка для разметки, один раз на ключ. */
const spriteUrls = new Map<string, string>();
function spriteUrl(key: string, make: () => HTMLCanvasElement): string {
  let u = spriteUrls.get(key);
  if (!u) {
    u = make().toDataURL();
    spriteUrls.set(key, u);
  }
  return u;
}

function CostLine({
  cost,
  balance,
  stash,
}: {
  cost: Cost;
  balance: number;
  stash: Partial<Record<MatId, number>>;
}) {
  return (
    <span className="dgc-cost">
      <span className={balance >= cost.coins ? '' : 'is-short'}>
        <CoinIcon size={12} /> {shortMoney(cost.coins)}
      </span>
      {(Object.entries(cost.mats) as [MatId, number][]).map(([id, n]) => (
        <span key={id} className={(stash[id] ?? 0) >= n ? '' : 'is-short'} title={MATS[id].name}>
          <img src={itemUrl(id)} alt="" /> {stash[id] ?? 0}/{n}
        </span>
      ))}
    </span>
  );
}

function statLine(slot: Slot, tier: number, plus: number): string {
  const s = pieceStats(slot, { tier, plus });
  if (slot === 'weapon') return `урон ${s.dmg.toFixed(0)}`;
  if (slot === 'helm') return `броня ${s.armor.toFixed(0)} · свет ${s.light.toFixed(1)}`;
  if (slot === 'robe') return `броня ${s.armor.toFixed(0)} · здоровье +${s.hp.toFixed(0)}`;
  return `шаг ${s.speed.toFixed(1)} · рывок ${s.dash.toFixed(1)}`;
}

// ---- Снаряжение ------------------------------------------------------------

export function GearTab({ onSpend }: { onSpend: () => void }) {
  const d = useFinanceStore((s) => s.dungeon);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const upgrade = useFinanceStore((s) => s.dungeonUpgrade);
  const econ = econOf(p);
  const hero = heroOf(d, p);
  const lv = levelOf(d.xp);
  const set = fullSet(d.gear);
  const gearKey = SLOTS.map((s) => `${d.gear[s].tier}.${d.gear[s].plus}`).join(',');
  const heroUrl = useMemo(
    () => spriteUrl(`hero:${gearKey}`, () => heroFrame(d.gear, 'down', 'idle', 0, false)),
    // gearKey — вся разница снаряжения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gearKey],
  );
  const go = (slot: Slot) => {
    primeAudio();
    const r = upgrade(slot);
    if (!r) {
      notifyWarning();
      return;
    }
    onSpend();
    coinDing();
    tierBreak(r === 'reforge' ? 3 : 1);
    notifySuccess();
  };
  return (
    <div className="pforge dgc">
      <div className="dgc-hero">
        <img className="dgc-hero__img" src={heroUrl} alt="" />
        <span className="dgc-hero__info">
          <b>
            Уровень {lv.level}
            <em>
              {fmt(lv.into)} / {fmt(lv.need)}
            </em>
          </b>
          <span className="dgc-xp">
            <i style={{ transform: `scaleX(${lv.need ? lv.into / lv.need : 1})` }} />
          </span>
          <i>
            здоровье {hero.maxHp} · урон {hero.dmg.toFixed(0)} · броня {hero.armor.toFixed(0)} ·
            крит {Math.round(hero.crit * 100)}%
          </i>
          <i>
            Комплект: {set ? `${setOf(set).name} — ${setOf(set).bonus}` : 'разный — бонуса нет'}
          </i>
        </span>
      </div>

      {SLOTS.map((slot) => {
        const g = d.gear[slot];
        const cur = setOf(g.tier);
        const step = nextStep(d, slot, econ);
        const conds = step.kind === 'reforge' ? reforgeConditions(slot, g.tier) : [];
        const met = step.kind === 'reforge' && conditionsMet(d, slot, g.tier);
        const next = SETS[g.tier];
        const can =
          (step.kind === 'plus' || (step.kind === 'reforge' && met)) &&
          canPay(d, step.cost, balance);
        return (
          <div key={slot} className={`dgc-slot dgc-slot--t${g.tier}`}>
            <div className="dgc-slot__head">
              <img className="dgc-slot__ico" src={gearIcon(slot, g.tier)} alt="" />
              <span className="dgc-slot__name">
                <b>
                  {cur.items[slot]}
                  {g.plus > 0 && <em> +{g.plus}</em>}
                </b>
                <i>
                  {SLOT_NAMES[slot]} · {cur.name} · {statLine(slot, g.tier, g.plus)}
                </i>
              </span>
            </div>
            {step.kind === 'plus' && (
              <div className="dgc-step">
                <span className="dgc-step__what">
                  Заточка до +{g.plus + 1}: {statLine(slot, g.tier, g.plus + 1)}
                </span>
                <CostLine cost={step.cost} balance={balance} stash={d.stash} />
                <button
                  type="button"
                  className="btn btn--sm pforge__buy"
                  disabled={!can}
                  onClick={() => go(slot)}
                >
                  Заточить
                </button>
              </div>
            )}
            {step.kind === 'reforge' && next && (
              <div className="dgc-step dgc-step--reforge">
                <span className="dgc-step__what">
                  <img src={gearIcon(slot, g.tier + 1)} alt="" /> Перековка в «{next.items[slot]}» ·{' '}
                  {statLine(slot, g.tier + 1, 0)}
                </span>
                {conds.map((c) => {
                  const have = Math.min(c.need, c.have(d));
                  return (
                    <span key={c.label} className={`dgc-cond${have >= c.need ? ' is-done' : ''}`}>
                      <b>{c.label}</b>
                      <em>
                        {fmt(have)} / {fmt(c.need)}
                      </em>
                      <span>
                        <i style={{ transform: `scaleX(${have / c.need})` }} />
                      </span>
                    </span>
                  );
                })}
                <CostLine cost={step.cost} balance={balance} stash={d.stash} />
                <button
                  type="button"
                  className="btn btn--sm btn--primary pforge__buy"
                  disabled={!can}
                  onClick={() => go(slot)}
                >
                  {met ? 'Перековать' : 'Условия не выполнены'}
                </button>
              </div>
            )}
            {step.kind === 'soon' && (
              <div className="dgc-step dgc-step--soon">
                Заточено до предела. Следующая ступень — «{SETS[g.tier]?.name ?? '…'}» — откроется с
                новыми районами.
              </div>
            )}
            {step.kind === 'max' && (
              <div className="dgc-step dgc-step--soon">Лучшее, что есть.</div>
            )}
          </div>
        );
      })}

      <div className="dgc-sets">
        <b>Комплекты</b>
        <p>
          Вещи одной ступени выглядят как одна вещь — каска, роба, сапоги и клинок в одной отделке.
          Все четыре одной ступени — бонус комплекта.
        </p>
        <div className="dgc-sets__row">
          {SETS.slice(0, 4).map((s) => (
            <span key={s.tier} className={`dgc-set${s.tier <= 2 ? '' : ' is-soon'}`}>
              <span className="dgc-set__icons">
                {SLOTS.map((slot) => (
                  <img key={slot} src={gearIcon(slot, s.tier)} alt="" />
                ))}
              </span>
              <b>{s.name}</b>
              <i>{s.tier <= 2 ? s.bonus : 'скоро'}</i>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Бестиарий -------------------------------------------------------------

const BEASTS: MobId[] = ['rat', 'fatrat', 'bomber', 'goldrat'];

export function BeastTab() {
  const d = useFinanceStore((s) => s.dungeon);
  return (
    <div className="pforge dgc">
      <p className="dgc-lead">
        Каждого зверя знаешь тем лучше, чем больше их убил. Ступени бестиария — навсегда, на всё
        подземелье.
      </p>
      {BEASTS.map((id) => {
        const def = MOBS[id];
        const n = d.kills[id] ?? 0;
        const st = beastStep(n);
        const next = BEAST_STEPS[st];
        const from = st > 0 ? BEAST_STEPS[st - 1].at : 0;
        const seen = n > 0;
        const url = spriteUrl(`beast:${id}`, () => mobArt(id, 'normal', 'run0', false));
        return (
          <div
            key={id}
            className={`dgc-beast${seen ? '' : ' is-unseen'}${st >= 4 ? ' is-gold' : ''}`}
          >
            <img className="dgc-beast__img" src={url} alt="" />
            <span className="dgc-beast__info">
              <b>
                {seen ? def.name : '???'}
                <em>{fmt(n)}</em>
              </b>
              {next ? (
                <>
                  <span className="dgc-xp">
                    <i style={{ transform: `scaleX(${(n - from) / (next.at - from)})` }} />
                  </span>
                  <i>
                    ещё {fmt(next.at - n)} — {next.what}
                  </i>
                </>
              ) : (
                <i>Изучен весь — золотая рамка</i>
              )}
              <span className="dgc-beast__steps">
                {BEAST_STEPS.map((b, i) => (
                  <em key={b.at} className={i < st ? 'is-on' : ''} title={b.what}>
                    {b.at}
                  </em>
                ))}
              </span>
            </span>
          </div>
        );
      })}
      <div className="dgc-beast dgc-beast--boss">
        <img
          className="dgc-beast__img"
          src={spriteUrl('beast:king', () => mobArt('king', 'normal', 'run0', false))}
          alt=""
        />
        <span className="dgc-beast__info">
          <b>
            {BOSSES.king.name}
            <em>{d.bosses.king?.kills ?? 0}</em>
          </b>
          <i>Логово — в конце Откатки. Возвращается через 20 минут после смерти.</i>
        </span>
      </div>
    </div>
  );
}

// ---- Склад и сидор ---------------------------------------------------------

export function StashTab({ onSpend }: { onSpend: () => void }) {
  const d = useFinanceStore((s) => s.dungeon);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const sackUp = useFinanceStore((s) => s.dungeonSackUp);
  const econ = econOf(p);
  const cost = sackCost(d.sackLevel, econ);
  const can = d.sackLevel < SACK_MAX && !d.run && canPay(d, cost, balance);
  const mats = Object.keys(MATS) as MatId[];
  const stats: [string, number, ReactNode?][] = [
    ['Вылазок', d.stats.runs ?? 0],
    ['Вышел живым', d.stats.extracts ?? 0],
    ['С полным сидором', d.stats.fullExtracts ?? 0],
    ['Погиб', d.stats.deaths ?? 0],
    ['Пройдено, м', d.stats.meters ?? 0],
    ['Уклонов в последний миг', d.stats.dodges ?? 0],
    ['Шахт вскрыто', d.stats.mines ?? 0],
    ['Тайников', d.stats.secrets ?? 0],
  ];
  return (
    <div className="pforge dgc">
      <div className="dgc-slot">
        <div className="dgc-slot__head">
          <img className="dgc-slot__ico" src={itemUrl('skin')} alt="" />
          <span className="dgc-slot__name">
            <b>
              Сидор · {d.sackLevel + 1} {d.sackLevel === 0 ? 'ряд' : 'ряда'} по {SACK_ROW}
            </b>
            <i>
              {sackSlots(d.sackLevel)} ячеек, в ячейке до 32 штук одного вида · монеты, токены и
              ключи места не занимают
            </i>
          </span>
        </div>
        {d.sackLevel < SACK_MAX ? (
          <div className="dgc-step">
            <span className="dgc-step__what">
              Нашить карман: ещё ряд, {sackSlots(d.sackLevel + 1)} ячеек
              {d.run ? ' · сперва выйди из вылазки' : ''}
            </span>
            <CostLine cost={cost} balance={balance} stash={d.stash} />
            <button
              type="button"
              className="btn btn--sm pforge__buy"
              disabled={!can}
              onClick={() => {
                primeAudio();
                if (!sackUp()) {
                  notifyWarning();
                  return;
                }
                onSpend();
                coinDing();
                notifySuccess();
              }}
            >
              Нашить
            </button>
          </div>
        ) : (
          <div className="dgc-step dgc-step--soon">Больше не нашить.</div>
        )}
      </div>

      <div className="dgc-stash">
        <b>Склад наверху</b>
        {mats.map((id) => (
          <span key={id} className={(d.stash[id] ?? 0) > 0 ? '' : 'is-empty'}>
            <img src={itemUrl(id)} alt="" />
            <b>{fmt(d.stash[id] ?? 0)}</b>
            <span>
              {MATS[id].name}
              <i>{MATS[id].lead}</i>
            </span>
          </span>
        ))}
      </div>

      <div className="dgc-stats">
        {stats.map(([name, n]) => (
          <span key={name}>
            <i>{name}</i>
            <b>{fmt(n)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
