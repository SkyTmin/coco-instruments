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
import { GxBar, GxIcon, KIcon } from '@/components/gx';
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
import { heroPortrait, useDungeonSprites } from '@/lib/dungeon-sprites';
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
        <CoinIcon size={16} /> {shortMoney(cost.coins)}
      </span>
      {(Object.entries(cost.mats) as [MatId, number][]).map(([id, n]) => (
        <span key={id} className={(stash[id] ?? 0) >= n ? '' : 'is-short'} title={MATS[id].name}>
          <img src={itemUrl(id)} alt={MATS[id].name} /> {stash[id] ?? 0}/{n}
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
  const sprites = useDungeonSprites();
  const gearKey = SLOTS.map((s) => `${d.gear[s].tier}.${d.gear[s].plus}`).join(',');
  const heroUrl = useMemo(
    () =>
      spriteUrl(
        `hero:${gearKey}:${sprites ? 1 : 0}`,
        () => heroPortrait(d.gear) ?? heroFrame(d.gear, 'down', 'idle', 0, false),
      ),
    // gearKey — вся разница снаряжения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gearKey, sprites],
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
    <div className="dgc">
      <div className="dgc-top">
        <div className="dgc-top__pic">
          <img src={heroUrl} alt="" />
          <span className="gx-hex">{lv.level}</span>
        </div>
        <div className="dgc-top__info">
          <GxBar
            value={lv.need ? lv.into / lv.need : 1}
            tone="gold"
            label={`опыт ${fmt(lv.into)} / ${fmt(lv.need)}`}
          />
          <div className="dgc-top__stats">
            <span>
              <GxIcon name="heart" size={18} /> {hero.maxHp}
            </span>
            <span>
              <GxIcon name="sword" size={18} /> {hero.dmg.toFixed(0)}
            </span>
            <span>
              <GxIcon name="shield" size={18} /> {hero.armor.toFixed(0)}
            </span>
            <span>
              <GxIcon name="explosion" size={18} /> {Math.round(hero.crit * 100)}%
            </span>
          </div>
          <i className="dgc-top__set">
            {set
              ? `Весь комплект «${setOf(set).name}»: ${setOf(set).bonus}`
              : 'Собери 4 вещи одного комплекта — будет бонус'}
          </i>
        </div>
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
        const nowStat = statLine(slot, g.tier, g.plus);
        return (
          <div key={slot} className={`dgc-item${can ? ' is-ready' : ''}`}>
            <div className="dgc-item__head">
              <span className="dgc-item__ico">
                <img src={gearIcon(slot, g.tier)} alt="" />
                {g.plus > 0 && <em>+{g.plus}</em>}
              </span>
              <span className="dgc-item__name">
                <b>{cur.items[slot]}</b>
                <i>
                  {SLOT_NAMES[slot]} · {nowStat}
                </i>
              </span>
              {can && <span className="gx-badge gx-badge--gold dgc-item__bang">!</span>}
            </div>
            {step.kind === 'plus' && (
              <div className="dgc-item__step">
                <div className="dgc-item__arrow">
                  <b>+{g.plus}</b>
                  <KIcon name="arrowRight" size={16} />
                  <b className="is-next">+{g.plus + 1}</b>
                  <span>{statLine(slot, g.tier, g.plus + 1)}</span>
                </div>
                <CostLine cost={step.cost} balance={balance} stash={d.stash} />
                <button
                  type="button"
                  className="gx-btn gx-btn--red gx-btn--block"
                  disabled={!can}
                  onClick={() => go(slot)}
                >
                  <GxIcon name="anvil" />
                  Заточить
                </button>
              </div>
            )}
            {step.kind === 'reforge' && next && (
              <div className="dgc-item__step">
                <div className="dgc-item__arrow">
                  <img src={gearIcon(slot, g.tier)} alt="" />
                  <KIcon name="arrowRight" size={16} />
                  <img src={gearIcon(slot, g.tier + 1)} alt="" />
                  <span>
                    «{next.items[slot]}» · {statLine(slot, g.tier + 1, 0)}
                  </span>
                </div>
                {conds.map((c) => {
                  const have = Math.min(c.need, c.have(d));
                  return (
                    <div key={c.label} className="dgc-cond">
                      <span>
                        {have >= c.need && <KIcon name="checkmark" size={14} />}
                        {c.label}
                      </span>
                      <GxBar
                        value={have / c.need}
                        tone={have >= c.need ? 'green' : 'blue'}
                        label={`${fmt(have)} / ${fmt(c.need)}`}
                      />
                    </div>
                  );
                })}
                <CostLine cost={step.cost} balance={balance} stash={d.stash} />
                <button
                  type="button"
                  className="gx-btn gx-btn--red gx-btn--block"
                  disabled={!can}
                  onClick={() => go(slot)}
                >
                  <GxIcon name="upgrade" />
                  {met ? `Улучшить до «${next.name}»` : 'Сначала выполни задания'}
                </button>
              </div>
            )}
            {step.kind === 'soon' && (
              <div className="dgc-item__done">
                <KIcon name="checkmark" size={16} /> Заточено до предела. Дальше — с новыми уровнями
                подземелья.
              </div>
            )}
            {step.kind === 'max' && (
              <div className="dgc-item__done">
                <KIcon name="star" size={16} /> Лучшее, что есть.
              </div>
            )}
          </div>
        );
      })}
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
          <i>Логово — в конце Рельсовых туннелей. Возвращается через 20 минут после смерти.</i>
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
  const can = d.sackLevel < SACK_MAX && canPay(d, cost, balance);
  const mats = Object.keys(MATS) as MatId[];
  const stats: [string, number, ReactNode?][] = [
    ['Вылазок', d.stats.runs ?? 0],
    ['Вышел живым', d.stats.extracts ?? 0],
    ['С полным рюкзаком', d.stats.fullExtracts ?? 0],
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
              Рюкзак · {d.sackLevel + 1} {d.sackLevel === 0 ? 'ряд' : 'ряда'} по {SACK_ROW}
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
