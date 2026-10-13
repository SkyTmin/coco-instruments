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
  SLOTS,
  OPEN_FLOORS,
} from '@/lib/dungeon';
import type { Cost, MatId, MobId, Slot } from '@/lib/dungeon';
import { heroPortrait, useDungeonSprites } from '@/lib/dungeon-sprites';
import { gearIcon, heroFrame, itemUrl } from '@/lib/dungeon-art';
import { mobPortrait } from '@/lib/dungeon-mobart';
import '@/lib/dungeon-floors/art';
import { fmtNum, fmtShort, t, useT } from '@/i18n';
import {
  beastText,
  bossLead,
  bossName,
  dl,
  matLead,
  matName,
  mobName,
  setBonus,
  setItem,
  setName,
  slotName,
} from '@/i18n/data-dungeon';
import { coinDing, primeAudio, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning } from '@/lib/haptics';

const fmt = (n: number) => fmtNum(n);

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
        <CoinIcon size={16} /> {fmtShort(cost.coins)}
      </span>
      {(Object.entries(cost.mats) as [MatId, number][]).map(([id, n]) => (
        <span key={id} className={(stash[id] ?? 0) >= n ? '' : 'is-short'} title={matName(id)}>
          <img src={itemUrl(id)} alt={matName(id)} /> {stash[id] ?? 0}/{n}
        </span>
      ))}
    </span>
  );
}

function statLine(slot: Slot, tier: number, plus: number): string {
  const s = pieceStats(slot, { tier, plus });
  if (slot === 'weapon') return t('dungeon.camp.statWeapon', { dmg: s.dmg.toFixed(0) });
  if (slot === 'helm')
    return t('dungeon.camp.statHelm', { armor: s.armor.toFixed(0), light: s.light.toFixed(1) });
  if (slot === 'robe')
    return t('dungeon.camp.statRobe', { armor: s.armor.toFixed(0), hp: s.hp.toFixed(0) });
  return t('dungeon.camp.statBoots', { speed: s.speed.toFixed(1), dash: s.dash.toFixed(1) });
}

// ---- Снаряжение ------------------------------------------------------------

export function GearTab({ onSpend }: { onSpend: () => void }) {
  useT();
  const d = useFinanceStore((s) => s.dungeon);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const upgrade = useFinanceStore((s) => s.dungeonUpgrade);
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
            label={t('dungeon.camp.xp', { into: fmt(lv.into), need: fmt(lv.need) })}
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
              ? t('dungeon.camp.fullSet', {
                  name: setName(setOf(set).tier),
                  bonus: setBonus(setOf(set).tier),
                })
              : t('dungeon.camp.setHint')}
          </i>
        </div>
      </div>

      {SLOTS.map((slot) => {
        const g = d.gear[slot];
        const cur = setOf(g.tier);
        const step = nextStep(d, slot);
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
                <b>{setItem(cur.tier, slot)}</b>
                <i>
                  {slotName(slot)} · {nowStat}
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
                  {t('dungeon.camp.sharpen')}
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
                    «{setItem(next.tier, slot)}» · {statLine(slot, g.tier + 1, 0)}
                  </span>
                </div>
                {conds.map((c) => {
                  const have = Math.min(c.need, c.have(d));
                  return (
                    <div key={c.label} className="dgc-cond">
                      <span>
                        {have >= c.need && <KIcon name="checkmark" size={14} />}
                        {dl(c.label)}
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
                  {met
                    ? t('dungeon.camp.reforgeTo', { name: setName(next.tier) })
                    : t('dungeon.camp.tasksFirst')}
                </button>
              </div>
            )}
            {step.kind === 'soon' && (
              <div className="dgc-item__done">
                <KIcon name="checkmark" size={16} /> {t('dungeon.camp.maxed')}
              </div>
            )}
            {step.kind === 'max' && (
              <div className="dgc-item__done">
                <KIcon name="star" size={16} /> {t('dungeon.camp.best')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Бестиарий -------------------------------------------------------------

/** Бестиарий — звери всех этажей по порядку (боссы — отдельной строкой этажа). */
const BEASTS: MobId[] = OPEN_FLOORS.flatMap((f) =>
  f.mobs.filter((m) => m.beast && !m.boss).map((m) => m.id),
);

export function BeastTab() {
  useT();
  const d = useFinanceStore((s) => s.dungeon);
  return (
    <div className="pforge dgc">
      <p className="dgc-lead">{t('dungeon.camp.beastLead')}</p>
      {BEASTS.map((id) => {
        const def = MOBS[id];
        const n = d.kills[id] ?? 0;
        const st = beastStep(n);
        const next = BEAST_STEPS[st];
        const from = st > 0 ? BEAST_STEPS[st - 1].at : 0;
        const seen = n > 0;
        const url = spriteUrl(`beast:${id}`, () => mobPortrait(id));
        return (
          <div
            key={id}
            className={`dgc-beast${seen ? '' : ' is-unseen'}${st >= 4 ? ' is-gold' : ''}`}
          >
            <img className="dgc-beast__img" src={url} alt="" />
            <span className="dgc-beast__info">
              <b>
                {seen ? mobName(def.id) : '???'}
                <em>{fmt(n)}</em>
              </b>
              {next ? (
                <>
                  <span className="dgc-xp">
                    <i style={{ transform: `scaleX(${(n - from) / (next.at - from)})` }} />
                  </span>
                  <i>{t('dungeon.camp.beastNext', { n: fmt(next.at - n), what: beastText(st) })}</i>
                </>
              ) : (
                <i>{t('dungeon.camp.beastDone')}</i>
              )}
              <span className="dgc-beast__steps">
                {BEAST_STEPS.map((b, i) => (
                  <em key={b.at} className={i < st ? 'is-on' : ''} title={beastText(i)}>
                    {b.at}
                  </em>
                ))}
              </span>
            </span>
          </div>
        );
      })}
      {OPEN_FLOORS.map((f) => {
        const b = BOSSES[f.boss.id];
        const kills = d.bosses[b.id]?.kills ?? 0;
        return (
          <div key={b.id} className="dgc-beast dgc-beast--boss">
            <img
              className="dgc-beast__img"
              src={spriteUrl(`beast:${b.mob}`, () => mobPortrait(b.mob))}
              alt=""
            />
            <span className="dgc-beast__info">
              <b>
                {kills > 0 || d.reached >= f.id ? bossName(b.id) : '???'}
                <em>{kills}</em>
              </b>
              <i>
                {t('dungeon.camp.bossLine', {
                  floor: String(f.id),
                  lead: bossLead(b.id),
                  n: String(Math.round(b.restMs / 60_000)),
                })}
              </i>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Склад и сидор ---------------------------------------------------------

export function StashTab({ onSpend }: { onSpend: () => void }) {
  useT();
  const d = useFinanceStore((s) => s.dungeon);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const sackUp = useFinanceStore((s) => s.dungeonSackUp);
  const cost = sackCost(d.sackLevel);
  const can = d.sackLevel < SACK_MAX && canPay(d, cost, balance);
  const mats = Object.keys(MATS) as MatId[];
  const stats: [string, number, ReactNode?][] = [
    [t('dungeon.camp.stat.runs'), d.stats.runs ?? 0],
    [t('dungeon.camp.stat.extracts'), d.stats.extracts ?? 0],
    [t('dungeon.camp.stat.fullExtracts'), d.stats.fullExtracts ?? 0],
    [t('dungeon.camp.stat.deaths'), d.stats.deaths ?? 0],
    [t('dungeon.camp.stat.meters'), d.stats.meters ?? 0],
    [t('dungeon.camp.stat.dodges'), d.stats.dodges ?? 0],
    [t('dungeon.camp.stat.mines'), d.stats.mines ?? 0],
    [t('dungeon.camp.stat.secrets'), d.stats.secrets ?? 0],
  ];
  return (
    <div className="pforge dgc">
      <div className="dgc-slot">
        <div className="dgc-slot__head">
          <img className="dgc-slot__ico" src={itemUrl('skin')} alt="" />
          <span className="dgc-slot__name">
            <b>
              {t('dungeon.camp.sackRows', { n: String(d.sackLevel + 1), row: String(SACK_ROW) })}
            </b>
            <i>{t('dungeon.camp.sackInfo', { n: String(sackSlots(d.sackLevel)) })}</i>
          </span>
        </div>
        {d.sackLevel < SACK_MAX ? (
          <div className="dgc-step">
            <span className="dgc-step__what">
              {t('dungeon.camp.pocket', { n: String(sackSlots(d.sackLevel + 1)) })}
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
              {t('dungeon.camp.sew')}
            </button>
          </div>
        ) : (
          <div className="dgc-step dgc-step--soon">{t('dungeon.camp.noMore')}</div>
        )}
      </div>

      <div className="dgc-stash">
        <b>{t('dungeon.camp.stashTitle')}</b>
        {mats.map((id) => (
          <span key={id} className={(d.stash[id] ?? 0) > 0 ? '' : 'is-empty'}>
            <img src={itemUrl(id)} alt="" />
            <b>{fmt(d.stash[id] ?? 0)}</b>
            <span>
              {matName(id)}
              <i>{matLead(id)}</i>
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
