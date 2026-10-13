// Лагерь рыбака (v2.65): удочки и садок, журнал улова. Вкладки живут в том
// же листе лагеря, что шахта, лес и подземелье (`PrisonCamp`, место 'fish').
//
// Здесь же спрайт рыбы из листа `ui/fish/fish.png` — его берут и страница
// рыбалки, и журнал; в странице он жить не может, иначе лагерь и страница
// импортировали бы друг друга.

import type { CSSProperties } from 'react';
import { CoinIcon } from '@/components/slot-art';
import { GxIcon, KIcon } from '@/components/gx';
import { TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import {
  FISH,
  NET_MAX,
  netCapacity,
  netCost,
  PEARL_MAX,
  PEARL_SELL,
  RODS,
  rodReach,
  skillOf,
  SPOTS,
  spotOpen,
  SPOT_GATE,
  NET_AUTO_TOKENS,
} from '@/lib/fishing';
import type { FishDef } from '@/lib/fishing';
import { CASE_TIERS, rankLetter } from '@/lib/prison';
import { coinDing, primeAudio, tierBreak, uiBuy } from '@/lib/sound';
import { notifySuccess, notifyWarning } from '@/lib/haptics';
import { fmtDec, fmtNum, fmtShort, t as tNow, useT } from '@/i18n';
import { fishName, kgText, rodName, spotName } from '@/i18n/data-fishing';

const fmt = (n: number) => fmtNum(n);

/** Лист `ui/fish/fish.png`: 40×16, по 8 в ряд; 26 рыб, ракушка, жемчуг, поплавок. */
const TILE_W = 40;
const TILE_H = 16;
export const MUSSEL_TILE = 26;
export const PEARL_TILE = 27;
export const FLOAT_TILE = 28;

export function FishSprite({
  index,
  scale = 2,
  className = '',
}: {
  index: number;
  scale?: number;
  className?: string;
}) {
  const col = index % 8;
  const row = Math.floor(index / 8);
  return (
    <i
      className={`ffish ${className}`}
      aria-hidden="true"
      style={{
        width: TILE_W * scale,
        height: TILE_H * scale,
        backgroundSize: `${8 * TILE_W * scale}px ${4 * TILE_H * scale}px`,
        backgroundPosition: `${-col * TILE_W * scale}px ${-row * TILE_H * scale}px`,
      }}
    />
  );
}

export const fishIndex = (f: FishDef) => FISH.indexOf(f);

/** Цвет редкости — тот же, что у сундуков: редкость читается одинаково везде. */
export const rarityColor = (f: FishDef) => CASE_TIERS.find((t) => t.id === f.rarity)!.color;
/** Fish rarity in the current language, lower case («редкая», «rare»). */
export const rarityName = (r: FishDef['rarity']) => tNow(`fishing.rarity.${r}`);

const reachText = (rod: number) =>
  rod === RODS.length - 1
    ? tNow('fishing.rods.reachTop')
    : tNow('fishing.rods.reach', { spot: spotName(rodReach(rod)) });

function RodArt({ rod, size = 34 }: { rod: number; size?: number }) {
  // Удочка одна, ступени различает цвет удилища: от ветки до золота.
  const colors = ['#8a6a44', '#c9b27a', '#9aa6b0', '#3d3f47', '#2f6fa8', '#e2b23c'];
  return (
    <span
      className="frod"
      style={{ '--rod': colors[rod] ?? colors[0], width: size, height: size } as CSSProperties}
    >
      <GxIcon name="fishing" size={size} />
    </span>
  );
}

export function RodsTab({ onSpend }: { onSpend: () => void }) {
  const t = useT();
  const f = useFinanceStore((s) => s.fishing);
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const fishBuyRod = useFinanceStore((s) => s.fishBuyRod);
  const fishNetUp = useFinanceStore((s) => s.fishNetUp);
  const fishNetAuto = useFinanceStore((s) => s.fishNetAuto);
  const cur = RODS[f.rod];
  const next = RODS[f.rod + 1];
  const cap = netCapacity(f.netLevel);
  const buy = (ok: boolean, beats: number) => {
    primeAudio();
    if (!ok) {
      notifyWarning();
      return;
    }
    uiBuy();
    onSpend();
    coinDing();
    tierBreak(beats);
    notifySuccess();
  };
  const pearls = Math.min(PEARL_MAX, p.pearls);
  return (
    <div className="pforge">
      <div className="pforge__now">
        <RodArt rod={f.rod} size={40} />
        <span>
          <b>{rodName(f.rod)}</b>
          <i>
            {t('fishing.rods.now', { power: cur.power, reel: cur.reel, reach: reachText(f.rod) })}
          </i>
        </span>
      </div>
      <div className="pforge__row">
        <span className="pforge__ico">
          <RodArt rod={next ? f.rod + 1 : f.rod} size={30} />
        </span>
        <span className="pforge__info">
          <b>{next ? rodName(f.rod + 1) : t('fishing.rods.best')}</b>
          <i>
            {next
              ? t('fishing.rods.next', {
                  power: cur.power,
                  power2: next.power,
                  reel: cur.reel,
                  reel2: next.reel,
                  reach: reachText(f.rod + 1),
                })
              : t('fishing.rods.top')}
          </i>
        </span>
        {next ? (
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={balance < next.price}
            onClick={() => buy(fishBuyRod(), 1)}
          >
            {fmtShort(next.price)} <CoinIcon size={12} />
          </button>
        ) : (
          <span className="pforge__done">{t('camp.have')}</span>
        )}
      </div>
      <div className="pforge__row">
        <span className="pforge__ico">
          <GxIcon name="fish-bucket" size={28} />
        </span>
        <span className="pforge__info">
          <b>{t('fishing.rods.net', { n: cap })}</b>
          <i>
            {f.netLevel < NET_MAX
              ? t('fishing.rods.netNext', { a: cap, n: netCapacity(f.netLevel + 1) })
              : t('fishing.rods.netMax')}
          </i>
        </span>
        {f.netLevel < NET_MAX ? (
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={balance < netCost(f.netLevel)}
            onClick={() => buy(fishNetUp(), 0)}
          >
            {fmtShort(netCost(f.netLevel))} <CoinIcon size={12} />
          </button>
        ) : (
          <span className="pforge__done">{t('camp.have')}</span>
        )}
      </div>
      <div className="pforge__row">
        <span className="pforge__ico">
          <GxIcon name="fish-bucket" size={28} />
        </span>
        <span className="pforge__info">
          <b>{t('fishing.rods.auto')}</b>
          <i>{t('fishing.rods.autoText')}</i>
        </span>
        {f.auto ? (
          <span className="pforge__done">{t('camp.have')}</span>
        ) : (
          <button
            type="button"
            className="btn btn--sm pforge__buy"
            disabled={p.tokens < NET_AUTO_TOKENS}
            onClick={() => buy(fishNetAuto(), 1)}
          >
            {fmtShort(NET_AUTO_TOKENS)} <TokenIcon size={12} />
          </button>
        )}
      </div>
      <div className="pforge__row">
        <span className="pforge__ico">
          <FishSprite index={PEARL_TILE} scale={1} />
        </span>
        <span className="pforge__info">
          <b>{t('fishing.rods.pearls', { n: pearls, max: PEARL_MAX })}</b>
          <i>{t('fishing.rods.pearlsText', { pct: fmtDec(pearls * PEARL_SELL * 100, 1) })}</i>
        </span>
      </div>
      <p className="pcamp-note">
        {t('fishing.rods.stats', { n: f.total, lvl: skillOf(f.xp).level })}
      </p>
    </div>
  );
}

export function TrophiesTab() {
  const t = useT();
  const f = useFinanceStore((s) => s.fishing);
  const p = useFinanceStore((s) => s.prison);
  const skill = skillOf(f.xp).level;
  const kinds = FISH.filter((x) => (f.caught[x.id] ?? 0) > 0).length;
  return (
    <div className="pforge">
      <div className="pcamp-purse">
        <b>
          {kinds} / {FISH.length}
        </b>{' '}
        {t('fishing.trophies.kinds')}
      </div>
      {SPOTS.map((s, si) => {
        const open = spotOpen(si, skill, p.rank, p.prestige);
        return (
          <section key={s.id} className={`ftrophy${open ? '' : ' is-locked'}`}>
            <h4 className="ftrophy__head">
              {spotName(si)}
              {!open && (
                <span>
                  <KIcon name="locked" size={12} />{' '}
                  {skill < s.skill
                    ? t('fishing.trophies.lockSkill', { n: s.skill })
                    : t('fishing.trophies.lockRank', { r: rankLetter(SPOT_GATE[si]) })}
                </span>
              )}
            </h4>
            <div className="ftrophy__grid">
              {FISH.filter((x) => x.spot === si).map((x) => {
                const n = f.caught[x.id] ?? 0;
                const best = f.records[x.id] ?? 0;
                return (
                  <div
                    key={x.id}
                    className={`ftrophy__cell is-${x.rarity}${n ? ' is-found' : ''}`}
                    style={{ '--tier': rarityColor(x) } as CSSProperties}
                  >
                    <FishSprite index={fishIndex(x)} scale={2} className={n ? '' : 'is-shadow'} />
                    <b>{n ? fishName(x.id) : '???'}</b>
                    <i>{n ? `${kgText(best)} · ×${fmt(n)}` : rarityName(x.rarity)}</i>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
