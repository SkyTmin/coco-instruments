// Кузница (v2.67) — отдельный экран, а не вкладка лагеря. Руда для следующей кирки сама
// откладывается в ящик кузнеца, когда продаёшь рюкзак, и копится там.
//
// UI v2 (пиксельный набор `@/ui-px`, разметка — `armory.css` + `forge.css`): как оружейная в
// Diablo / PoE — витрина выбранной кирки на половину экрана, сетка всех 17 кирок (выкованные в
// цвете, дальние — силуэтами), карточка с цифрами и сравнением с киркой в руке, рецепт
// следующей. Телефон стоя: витрина сверху, ниже карточка, лестница и снаряжение, кнопки — под
// большим пальцем. Лёжа, планшет, компьютер: список | витрина | карточка. Клавиатура/геймпад:
// фокус в сетке = выбор, Enter по выбранной выкованной — в руку, X / Y — выковать.
//
// Выковка — сцена, как открытие в Genshin: три удара молота, цвет искр на третьем заранее
// говорит редкость, вспышка, силуэт, и кирка проявляется.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CoinIcon } from '@/components/slot-art';
import { BagIcon, OreIcon, TokenIcon } from '@/components/PrisonCamp';
import { GxIcon } from '@/components/gx';
import {
  PICK_ART,
  PickArt,
  PickPx,
  RarityChip,
  RarityName,
  rarityVars,
} from '@/components/PickArt';
import { preloadPx, PxStrip } from '@/components/PxStrip';
import {
  fromKeys,
  heroFit,
  nameFit,
  useArmLayout,
  useBox,
  useFirstFrame,
  useFullWin,
} from '@/components/armory';
import { useFinanceStore } from '@/store';
import { enchantName, fmtNum, fmtShort, pickName, rarityName, rockName, t, useT } from '@/i18n';
import { nameIn, pickTitle } from '@/i18n/data-mine';
import { enchantEffect } from '@/i18n/data-books';
import { useAction } from '@/input';
import { Bar, Button, Heading, Icon, Panel, Slot } from '@/ui-px';
import {
  AUTOSELL_TOKENS,
  BAG_MAX,
  bagCapacity,
  bagCost,
  enchSlots,
  enchUnits,
  ENCHANTS,
  forgeCheck,
  forgeOres,
  forgeReadyNow,
  modsOf,
  nextPick,
  opensRocks,
  pickLevelOf,
  pickSpeed,
  PICKS,
  rankLetter,
} from '@/lib/prison';
import { ROMAN } from '@/lib/books';
import { rarityOf } from '@/lib/rarity';
import { registerEscape } from '@/lib/escape-stack';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import {
  coinDing,
  forgeReveal,
  forgeStrike,
  lavaHiss,
  primeAudio,
  uiBuy,
  uiClose,
  uiOpen,
  uiTap,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';
import './armory.css';
import './forge.css';

const fmt = (n: number) => fmtNum(n);

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Руды списком: «гранат и топаз». */
function oreList(rocks: number[]): string {
  const names = rocks.map((r) => nameIn(rockName(r)));
  if (names.length < 2) return names[0] ?? '';
  return t('forge.listAnd', { a: names.slice(0, -1).join(', '), b: names[names.length - 1] });
}

/** Разница с киркой в руке: «+3» зелёным, «−2» красным, ноль — ничего. */
function Delta({ v }: { v: number }) {
  if (!v) return null;
  return (
    <span className={`arm-delta ${v > 0 ? 'is-up' : 'is-down'}`}>
      {v > 0 ? '+' : '−'}
      {fmt(Math.abs(v))}
    </span>
  );
}

type Status = 'hand' | 'have' | 'next' | 'locked';

/** Pedestal pixel: the pick's own pixel (large strip, box 112) in whole screen dots, ≥ UI px. */
function pedPx(art: number, u: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.max(u, Math.round((art * PICK_ART * dpr) / 112) / dpr);
}

export function ForgeScreen({
  onClose,
  onSpend,
}: {
  onClose: () => void;
  /** Монеты ушли — табло встаёт на новое значение. */
  onSpend?: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonForge = useFinanceStore((s) => s.prisonForge);
  const prisonBuy = useFinanceStore((s) => s.prisonBuy);
  const prisonEquip = useFinanceStore((s) => s.prisonEquip);
  const { layout, u } = useArmLayout();
  const root = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const noteSeq = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    uiOpen();
    const off = registerEscape(() => closeRef.current());
    return () => {
      off();
      uiClose();
    };
  }, []);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

  const say = (text: string) => {
    noteSeq.current += 1;
    setNote({ id: noteSeq.current, text });
  };

  const m = modsOf(p);
  const floor = p.mine.id;
  const cur = PICKS[p.pick];
  const lvl = pickLevelOf(p.pickXp);
  const speed = pickSpeed(floor, p.pick, m);
  const check = forgeCheck(p);
  const n = check?.pick ?? -1;
  const next = n >= 0 ? PICKS[n] : null;
  const ores = n >= 0 ? forgeOres(n, p.forgeBox, p.bag) : [];
  const coins = check?.coins ?? 0;
  const ready = !!check && check.open && check.ore && balance >= coins;
  // Лучше этой кирки сейчас нет: либо конец лестницы, либо следующая — за
  // престижем, которого ещё нет.
  const lockedByPrestige = n < 0 && PICKS[p.pickMax + 1] ? PICKS[p.pickMax + 1] : null;

  // Выбор при открытии: следующая кирка, если её уже можно выковать, иначе та, что в руке.
  const [sel, setSel] = useState(() => (ready && n >= 0 ? n : p.pick));
  const statusOf = (i: number): Status =>
    i === p.pick ? 'hand' : i <= p.pickMax ? 'have' : i === n ? 'next' : 'locked';
  const st = statusOf(sel);
  const d = PICKS[sel];

  // Сцена выковки не ждёт сети: её полосу и вращение новой кирки берём заранее.
  useEffect(() => {
    if (!ready || n < 0) return;
    void preloadPx('picks', `forge-r${PICKS[n].rarity}`, FORGE_PX);
    void preloadPx('picks', `spin-${n}`, FORGE_PX);
  }, [ready, n]);

  const forge = () => {
    primeAudio();
    if (!check) {
      tapLight();
      say(
        lockedByPrestige
          ? t('forge.bestBeforePrestige', {
              name: pickName(p.pickMax + 1),
              n: lockedByPrestige.prestige,
            })
          : t('forge.best'),
      );
      return;
    }
    if (!check.open) {
      notifyWarning();
      say(
        next?.prestige
          ? t('forge.say.prestige', { n: next.prestige })
          : t('forge.say.floor', {
              rank: rankLetter(next!.floor),
              rock: nameIn(rockName(next!.floor)),
            }),
      );
      return;
    }
    if (!check.ore) {
      notifyWarning();
      const [rock, k] = check.missing[0];
      say(t('forge.say.ore', { rock: nameIn(rockName(rock)), n: fmt(k) }));
      return;
    }
    if (balance < coins) {
      notifyWarning();
      say(t('forge.say.coins', { n: Math.round(coins - balance) }));
      return;
    }
    const got = prisonForge();
    if (got < 0) {
      notifyWarning();
      return;
    }
    uiBuy();
    onSpend?.();
    setSel(got);
    setReveal(got);
  };

  const oreTap = (rock: number, need: number, box: number, bag: number) => {
    tapLight();
    const left = Math.max(0, need - box - bag);
    say(
      left
        ? t('forge.say.oreLeft', {
            rock: rockName(rock),
            box: fmt(box),
            bag: fmt(bag),
            left: fmt(left),
          })
        : t('forge.say.oreAll', { rock: rockName(rock), box: fmt(box), bag: fmt(bag) }),
    );
  };

  const buy = (what: 'bag' | 'cart') => {
    primeAudio();
    if (!prisonBuy(what)) {
      notifyWarning();
      return;
    }
    uiBuy();
    coinDing();
    notifySuccess();
    onSpend?.();
  };

  // Любую выкованную кирку можно взять в руку снова (v2.69). Лучшая при этом никуда не
  // девается — от неё кузница и ранг.
  const equip = (i: number) => {
    const dd = PICKS[i];
    const r = nameIn(rarityName(rarityOf(dd.rarity).id));
    if (i === p.pick) {
      tapLight();
      say(t('forge.say.inHand', { name: pickName(i), rarity: r, power: dd.power }));
      return;
    }
    if (i <= p.pickMax) {
      primeAudio();
      if (!prisonEquip(i)) return;
      tapMedium();
      uiTap();
      say(t('forge.say.equip', { name: nameIn(pickName(i)), power: dd.power }));
      return;
    }
    tapLight();
    say(
      dd.prestige
        ? t('forge.say.ladderPrestige', { name: pickName(i), rarity: r, n: dd.prestige })
        : t('forge.say.ladderFloor', {
            name: pickName(i),
            rarity: r,
            power: dd.power,
            rank: rankLetter(dd.floor),
            list: oreList(opensRocks(i)),
          }),
    );
  };

  /**
   * Тап по ячейке: выбрать. По уже выбранной действуют только клавиши (Enter, Space, геймпад):
   * палец действует кнопкой внизу — долгое нажатие, чтобы прочесть подсказку, выковывало кирку
   * на отпускании (критик), а двойной тап выбирал и сразу действовал.
   */
  const pickTap = (i: number, keys: boolean) => {
    if (i !== sel) {
      selectionChanged();
      setSel(i);
      return;
    }
    if (!keys) return;
    if (i === n) forge();
    else equip(i);
  };

  useAction(['inspect'], () => forge(), { scope: root });

  let cta: string;
  if (!check) cta = t('forge.best');
  else if (!check.open)
    cta = next?.prestige
      ? t('forge.cta.prestige', { n: next.prestige })
      : t('forge.cta.floor', { rank: rankLetter(next!.floor) });
  else if (!check.ore) cta = t('forge.cta.ore');
  else if (balance < coins) cta = t('forge.cta.coins', { sum: fmtShort(coins - balance) });
  else cta = t('forge.cta.go');

  // ---- Витрина: кирка крупно, имя, ступень, состояние, три цифры ----------------------------
  const roomRef = useRef<HTMLSpanElement>(null);
  const room = useBox(roomRef);
  const painted = useFirstFrame(); // the picks grid comes a frame after the window
  useFullWin();
  const art = heroFit(room, u, 64 * u * 4, (a) => pedPx(a, u));
  const dim = st === 'locked' || (st === 'next' && !ready);
  const selSpeed = pickSpeed(floor, sel, m);
  const statusText =
    st === 'hand'
      ? t('forge.hand')
      : st === 'have'
        ? t('forge.forged')
        : st === 'next'
          ? t('forge.next')
          : PICKS[sel].prestige
            ? t('forge.cta.prestige', { n: PICKS[sel].prestige })
            : t('forge.cta.floor', { rank: rankLetter(PICKS[sel].floor) });

  const stats = (
    <div className="arm-stats">
      <span className="arm-stat">
        <b>
          <GxIcon name="pick" size={u * 8} />
          {d.power}
        </b>
        <i>{t('forge.power')}</i>
        <Delta v={st === 'hand' ? 0 : d.power - cur.power} />
      </span>
      <span className="arm-stat">
        <b>
          <GxIcon name="energy" size={u * 8} />
          {fmt(selSpeed)}
        </b>
        {/* a break allowed after «/»: «Blöcke/Min.» broke inside a word in the narrow cell */}
        <i>{t('forge.perMin').replace('/', '/​')}</i>
        <Delta v={st === 'hand' ? 0 : selSpeed - speed} />
      </span>
      {st === 'hand' ? (
        <span className="arm-stat">
          <b>
            <Icon name="up" />
            {lvl.level}
          </b>
          <i>{t('forge.level')}</i>
        </span>
      ) : (
        <span className="arm-stat">
          <b>
            <Icon name="down" />
            {d.prestige ? t('forge.rungPrestige', { n: d.prestige }) : rankLetter(d.floor)}
          </b>
          <i>{t('forge.floorWord')}</i>
        </span>
      )}
    </div>
  );

  const showcase = (
    <section className="arm-show" style={rarityVars(d.rarity)}>
      <Panel material="stone" stage className="arm-stage frg-stage">
        <span ref={roomRef} className="arm-room">
          {art > 0 && (
            <span className="arm-ped" style={{ '--ped': `${pedPx(art, u)}px` } as CSSProperties}>
              <PickArt key={sel} pick={sel} size={art} dim={dim} />
            </span>
          )}
        </span>
        <div className="arm-id px-dark">
          <h2 className="arm-name" style={nameFit(pickTitle(sel))}>
            {pickTitle(sel)}
          </h2>
          <div className="arm-sub">
            <span className={`arm-status is-${st}`}>
              {st === 'hand' && <Icon name="check" />}
              {st === 'locked' && <Icon name="lock" />}
              {statusText}
            </span>
            {st === 'hand' && p.pickStars > 0 && (
              <span className="arm-stars" aria-label={`★${p.pickStars}`}>
                <Icon name="star" />×{p.pickStars}
              </span>
            )}
          </div>
        </div>
        {stats}
      </Panel>
    </section>
  );

  // ---- Карточка выбранной кирки: рецепт / чары и уровень / где куётся -----------------------
  const opens = opensRocks(sel);
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0);
  const recipe = st === 'next' && next && (
    <div className="frg-recipe">
      <Heading sub>{t('forge.recipe')}</Heading>
      <div className="frg-ing">
        <Slot
          rarity={PICKS[p.pickMax].rarity}
          aria-label={pickName(p.pickMax)}
          tip={pickName(p.pickMax)}
        >
          <PickPx pick={p.pickMax} size={u * 18} />
        </Slot>
        <span className="frg-ing__txt">
          <b style={rarityVars(PICKS[p.pickMax].rarity)}>{pickTitle(p.pickMax)}</b>
        </span>
      </div>
      {ores.map((o) => {
        const have = o.box + o.bag;
        const ok = have >= o.need;
        return (
          <div key={o.rock} className={`frg-ing${ok ? ' is-ok' : ''}`}>
            <Slot
              aria-label={t('forge.ore', {
                rock: rockName(o.rock),
                have: String(have),
                need: String(o.need),
              })}
              corner={ok ? '✓' : undefined}
              onClick={() => oreTap(o.rock, o.need, o.box, o.bag)}
            >
              <OreIcon rock={o.rock} size={u * 18} />
            </Slot>
            <span className="frg-ing__txt">
              <b>{rockName(o.rock)}</b>
              <Bar
                value={o.need ? have / o.need : 1}
                tone={ok ? 'green' : 'gold'}
                label={`${fmtShort(have)} / ${fmtShort(o.need)}`}
              />
            </span>
          </div>
        );
      })}
      <div className="frg-ing">
        <span className="frg-ing__coin">
          <CoinIcon size={u * 14} />
        </span>
        <span className="frg-ing__txt">
          <b className={`arm-num${balance < coins ? ' is-short' : ''}`}>
            {coins > 0 ? fmt(coins) : t('forge.paidShort')}
          </b>
        </span>
      </div>
    </div>
  );

  const handInfo = st === 'hand' && (
    <>
      <div className="frg-level">
        <span className="frg-level__lv">{t('common.level', { n: lvl.level })}</span>
        <Bar value={lvl.need ? lvl.into / lvl.need : 1} tone="blue" />
        <span className="arm-num">
          {lvl.need ? `${fmt(lvl.into)}/${fmt(lvl.need)}` : t('forge.max')}
        </span>
      </div>
      <div className="frg-ench">
        <Heading sub>
          {t('forge.enchants')}{' '}
          <span className="arm-num">
            {onPick.length}/{enchSlots(p)}
          </span>
        </Heading>
        {onPick.length === 0 ? (
          <p className="arm-muted">{t('forge.noEnch')}</p>
        ) : (
          onPick.map((e) => {
            const l = p.ench[e.id];
            const off = p.off.includes(e.id);
            return (
              <div key={e.id} className={`frg-ench__row${off ? ' is-off' : ''}`}>
                <b>
                  {enchantName(e.id)} {ROMAN[l - 1]}
                </b>
                <span>
                  {off ? t('books.offState') : enchantEffect(e.id, enchUnits(e.id, l, p.pickStars))}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  const where = (st === 'locked' || st === 'have') && (
    <p className="arm-muted">
      {d.prestige
        ? t('forge.say.ladderPrestige', {
            name: pickName(sel),
            rarity: nameIn(rarityName(rarityOf(d.rarity).id)),
            n: d.prestige,
          })
        : st === 'locked'
          ? t('forge.say.floor', { rank: rankLetter(d.floor), rock: nameIn(rockName(d.floor)) })
          : t('forge.forgedOn', { rank: rankLetter(d.floor) })}
    </p>
  );

  const details = (
    <div className="arm-details">
      {opens.length > 0 && (
        <div className="frg-opens">
          <span>{t('forge.takesShort')}</span>
          {opens.map((r) => (
            <span key={r} className="frg-opens__ore" data-tip={rockName(r)}>
              <OreIcon rock={r} size={u * 12} />
            </span>
          ))}
        </div>
      )}
      {recipe}
      {handInfo}
      {where}
    </div>
  );

  // ---- Лестница: вся коллекция кирок ---------------------------------------------------------
  const thumb = u * 20;
  const ladder = (
    <section className="frg-ladder">
      <div className="arm-head">
        <Heading>
          {t('forge.picks')}{' '}
          <span className="arm-num arm-muted">
            {p.pickMax + 1}/{PICKS.length}
          </span>
        </Heading>
      </div>
      <div className="arm-grid frg-grid" role="group">
        {(painted ? PICKS : []).map((pk, i) => {
          const s = statusOf(i);
          return (
            <Slot
              key={pk.id}
              rarity={s === 'locked' ? 0 : pk.rarity}
              selected={sel === i}
              locked={s === 'locked'}
              count={pk.prestige ? t('forge.rungPrestige', { n: pk.prestige }) : pk.power}
              corner={s === 'hand' ? '✓' : undefined}
              dot={s === 'next' && ready ? '!' : undefined}
              className={`frg-slot is-${s}`}
              data-autofocus={sel === i ? '' : undefined}
              aria-label={
                s === 'hand'
                  ? t('forge.rungHand', { name: pickName(i) })
                  : s === 'have'
                    ? t('forge.rungTake', { name: pickName(i) })
                    : pickName(i)
              }
              tip={<PickTip i={i} hand={p.pick} speedOf={(k) => pickSpeed(floor, k, m)} />}
              onClick={(e) => pickTap(i, fromKeys(e))}
              onFocus={() => {
                if (i !== sel) setSel(i);
              }}
            >
              <span className={s === 'locked' || (s === 'next' && !ready) ? 'frg-ghost' : ''}>
                <PickPx pick={i} size={thumb} />
              </span>
            </Slot>
          );
        })}
      </div>
    </section>
  );

  // ---- Снаряжение: рюкзак и вагонетка ----------------------------------------------------------
  const gear = (
    <section className="frg-gear">
      <div className="arm-head">
        <Heading>{t('forge.gear')}</Heading>
      </div>
      <div className="frg-gear__row">
        <span className="frg-gear__ico">
          <BagIcon size={u * 16} />
        </span>
        <span className="frg-gear__info">
          <b>{t('forge.bag', { n: fmt(bagCapacity(p.bagLevel)) })}</b>
          {p.bagLevel < BAG_MAX && (
            <i className="arm-num">
              {fmt(bagCapacity(p.bagLevel))} → {fmt(bagCapacity(p.bagLevel + 1))}
            </i>
          )}
        </span>
        {p.bagLevel < BAG_MAX ? (
          <Button
            kind="primary"
            size="sm"
            off={balance < bagCost(p.bagLevel)}
            className={balance < bagCost(p.bagLevel) ? 'px-dark' : undefined}
            onClick={() => (balance < bagCost(p.bagLevel) ? notifyWarning() : buy('bag'))}
          >
            {fmtShort(bagCost(p.bagLevel))} <CoinIcon size={u * 7} />
          </Button>
        ) : (
          <Icon name="check" className="frg-gear__ok" />
        )}
      </div>
      <div className="frg-gear__row">
        <span className="frg-gear__ico">
          <GxIcon name="minecart" size={u * 16} />
        </span>
        <span className="frg-gear__info">
          <b>{t('forge.cart')}</b>
          <i>{p.cart ? t('forge.cartOn') : t('forge.cartOff')}</i>
        </span>
        {p.cart ? (
          <Icon name="check" className="frg-gear__ok" />
        ) : (
          <Button
            kind="primary"
            size="sm"
            off={p.tokens < AUTOSELL_TOKENS}
            className={p.tokens < AUTOSELL_TOKENS ? 'px-dark' : undefined}
            onClick={() => (p.tokens < AUTOSELL_TOKENS ? notifyWarning() : buy('cart'))}
          >
            {fmtShort(AUTOSELL_TOKENS)} <TokenIcon size={u * 7} />
          </Button>
        )}
      </div>
    </section>
  );

  // ---- Кнопки под большим пальцем -------------------------------------------------------------
  // Both buttons always stand in place (nothing jumps): «в руку» is hidden for picks that are
  // not forged yet and greyed for the one already in hand.
  const acts = (
    <div className="arm-acts">
      <Button
        kind="confirm"
        wide
        hint={st === 'have' ? 'confirm' : undefined}
        off={st !== 'have'}
        className={
          st === 'next' || st === 'locked' ? 'is-hidden' : st !== 'have' ? 'px-dark' : undefined
        }
        onClick={() => equip(sel)}
      >
        {st === 'hand' ? t('forge.inHandBtn') : t('forge.equip')}
      </Button>
      <Button
        kind="primary"
        wide
        off={!ready}
        hint="inspect"
        onClick={forge}
        className={ready ? 'frg-go' : 'frg-go px-dark'}
      >
        {ready && <GxIcon name="anvil" size={u * 9} />}
        <span className="arm-btn-txt">{cta}</span>
        {ready && coins > 0 && (
          <span className="arm-btn-price">
            {fmtShort(coins)} <CoinIcon size={u * 7} />
          </span>
        )}
      </Button>
    </div>
  );

  const list = (
    <div className="arm-list">
      {layout === 'one' && details}
      {ladder}
      {gear}
    </div>
  );

  return createPortal(
    <div
      ref={root}
      className={`px arm arm--${layout} is-window frg`}
      role="dialog"
      aria-label={t('forge.title')}
    >
      <header className="arm-top">
        <Button
          icon="left"
          label={t('common.back')}
          className="arm-top__back"
          onClick={() => {
            tapLight();
            onClose();
          }}
        />
        <Heading ribbon className="arm-top__title">
          {t('forge.title')}
        </Heading>
        <span className="arm-purse">
          <span>
            <CoinIcon size={u * 8} />
            <b className="arm-num">{fmtShort(balance)}</b>
          </span>
        </span>
      </header>
      {showcase}
      {list}
      {layout === 'one' ? (
        acts
      ) : (
        <aside className="arm-side">
          <Panel material="obsidian" className="arm-info">
            <div className="arm-info__head">
              <h3 className="arm-info__name">{pickTitle(sel)}</h3>
              <RarityChip rarity={d.rarity} />
            </div>
            {details}
          </Panel>
          {acts}
        </aside>
      )}
      {note && (
        <div className="arm-note" key={note.id} role="status">
          {note.text}
        </div>
      )}
      {reveal != null && <ForgeReveal pick={reveal} onDone={() => setReveal(null)} />}
    </div>,
    document.body,
  );
}

/** Подсказка ячейки (наведение мышью, долгое нажатие): сила и скорость против кирки в руке. */
function PickTip({
  i,
  hand,
  speedOf,
}: {
  i: number;
  hand: number;
  speedOf: (i: number) => number;
}): ReactNode {
  const t = useT();
  const d = PICKS[i];
  const h = PICKS[hand];
  const sp = speedOf(i);
  const hs = speedOf(hand);
  return (
    <span className="arm-tip" style={rarityVars(d.rarity)}>
      <b>{pickTitle(i)}</b>
      <RarityChip rarity={d.rarity} />
      <span className="arm-tip__row">
        <GxIcon name="pick" size={24} /> {d.power} {i !== hand && <Delta v={d.power - h.power} />}
      </span>
      <span className="arm-tip__row">
        <GxIcon name="energy" size={24} /> {fmt(sp)} {t('forge.perMin')}{' '}
        {i !== hand && <Delta v={sp - hs} />}
      </span>
      {i !== hand && <i className="arm-tip__vs">{t('forge.vsHand')}</i>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Сцена выковки.
// ---------------------------------------------------------------------------

/**
 * Сторона рамки кирки в сцене (CSS-пикселей). Полоса `forge-r<r>` есть только крупной (рамка
 * 112), и вращение кирки на пьедестале сцены (`PickArt` 188 → рамка 150) встаёт ровно туда же:
 * при DPR 2 и 3 у обеих целый масштаб крупной полосы — 3 и 4, — и подмена по метке `reveal`
 * не сдвигает кирку ни на пиксель.
 */
const FORGE_PX = 150;
const FORGE_ART = Math.round(FORGE_PX / PICK_ART);

/**
 * Сцена выковки — пиксельная полоса `forge-r<ступень>` (`lib/props-pixel/picks.ts`): раскалённая
 * заготовка, три удара молота, закалка в пару, свечение → силуэт, вспышка цвета ступени. По
 * метке `reveal` под полосой встаёт настоящая кирка (`PickArt`, вращение с кадра 0 — та же
 * поза), полоса доигрывает вспышку и кончается пустой. Звук и дрожь — на метках полосы.
 */
function ForgeReveal({ pick, onDone }: { pick: number; onDone: () => void }) {
  const t = useT();
  const d = PICKS[pick];
  const r = rarityOf(d.rarity);
  const still = reduceMotion();
  const [shown, setShown] = useState(still);
  const [strip, setStrip] = useState(!still);
  const stage = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const p = useFinanceStore((s) => s.prison);
  const m = modsOf(p);
  const opens = opensRocks(pick);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useFullWin(true, true);

  useEffect(() => {
    const off = registerEscape(() => doneRef.current());
    return off;
  }, []);

  /** Кирка проявилась: звук, отклик, вспышка экрана, конфетти у эпической и выше. */
  const reveal = () => {
    if (done.current) return;
    done.current = true;
    setShown(true);
    forgeReveal(d.rarity);
    notifySuccess();
    if (still) return;
    flashFrame(d.rarity >= 4 ? 'mega' : 'big');
    if (d.rarity >= 3) burstConfetti(40 + 20 * d.rarity, [r.color, r.light, '#ffffff']);
  };

  useEffect(() => {
    if (still) reveal();
    // Сцена играет один раз на выковку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Удар (метки strike1…3): звон, отклик, дрожь сцены. */
  const strike = (i: number) => {
    forgeStrike(i);
    tapMedium();
    const st = stage.current;
    if (!st) return;
    try {
      st.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: `translate(${i % 2 ? 3 : -3}px, ${3 + i}px)` },
          { transform: 'translate(0,0)' },
        ],
        { duration: 140, easing: 'ease-out' },
      );
    } catch {
      /* не страшно */
    }
  };

  const onMark = (mark: string) => {
    if (mark.startsWith('strike')) strike(Number(mark.slice(6)) - 1);
    else if (mark === 'quench') lavaHiss();
    else if (mark === 'reveal') reveal();
  };

  return (
    <div
      className={`fgr arm-scn px${shown ? ' is-reveal is-lit' : ' is-forge'} r${d.rarity}`}
      style={rarityVars(d.rarity)}
      data-ui-layer=""
      onClick={() => {
        if (!shown) {
          // Тап до развязки — сразу кирка.
          setStrip(false);
          reveal();
        } else {
          tapLight();
          onDone();
        }
      }}
    >
      {/* Dark while the hammer strikes and the flash; the result lies on a light kit card. */}
      <div className="arm-scn__card">
        <div className="fgr__stage" ref={stage}>
          <i className="fgr__burst" aria-hidden="true" />
          {shown && (
            <div className="fgr__pick is-shown">
              <PickArt pick={pick} size={FORGE_ART} />
            </div>
          )}
          {strip && (
            <div className="fgr__forge">
              <PxStrip
                set="picks"
                name={`forge-r${d.rarity}`}
                size={FORGE_PX}
                mode="once"
                onMark={onMark}
                onEnd={() => {
                  setStrip(false);
                  reveal();
                }}
              />
            </div>
          )}
        </div>
        {/* Подпись занимает место с начала сцены (скрыта): иначе по вспышке сцена прыгнула бы вверх. */}
        <div className={`arm-scn__text${shown ? '' : ' is-wait'}`} aria-hidden={!shown}>
          <RarityChip rarity={d.rarity} />
          <RarityName rarity={d.rarity}>{pickTitle(pick)}</RarityName>
          <span className="arm-scn__line">
            {t('forge.stats', { power: d.power, speed: fmt(pickSpeed(p.mine.id, pick, m)) })}
          </span>
          {opens.length > 0 && (
            <span className="arm-scn__line">
              {t('forge.opens', { list: oreList(opens) })}
              {opens.map((x) => (
                <OreIcon key={x} rock={x} size={24} />
              ))}
            </span>
          )}
          <Button
            kind="primary"
            className="arm-scn__cta"
            data-autofocus=""
            onClick={(e) => {
              e.stopPropagation();
              if (!shown) return;
              tapLight();
              onDone();
            }}
          >
            {t('forge.toMine')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Можно ли выковать прямо сейчас — правило живёт в `lib/prison.ts`. */
export { forgeReadyNow };

/** Есть ли вообще следующая кирка (без престижа, которого нет). */
export const hasNextPick = (p: { pickMax: number; prestige: number }) => nextPick(p) >= 0;
