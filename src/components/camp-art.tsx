// Pictures of the camp, shared by PrisonCamp, CampTabs and the other screens: token, key
// (a ghast tear), consumables, runes, pets, rewards and the parcel reveal. Moved out of
// PrisonCamp.tsx so CampTabs doesn't import the camp that imports it (round 2 of the critic).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { BookArt } from '@/components/BooksTab';
import { EggArt, PetArt } from '@/components/PetArt';
import { CASE_TIERS as TIERS_OF, RUNE_ROMAN, runePower } from '@/lib/prison';
import type { CaseTier, ItemId, PetId, Reward, RuneKind } from '@/lib/prison';
import type { ParcelOpen } from '@/store';
import { findTexture, parcelTexture, runeTexture, tearTexture } from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { caseTick, coinDing, keyFound, tierBreak } from '@/lib/sound';
import { notifySuccess, tapLight } from '@/lib/haptics';
import {
  chestName,
  fmtDec,
  fmtShort,
  itemName,
  petLore,
  petName,
  runeName,
  runeText,
  t,
  useT,
} from '@/i18n';
import { eggName } from '@/i18n/data-books';
import { bookName, findName, nameIn } from '@/i18n/data-mine';

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
