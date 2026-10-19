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
import { OreIcon, TokenIcon } from '@/components/PrisonCamp';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import {
  PICK_ART,
  PickArt,
  PickPx,
  RarityChip,
  RarityName,
  rarityVars,
} from '@/components/PickArt';
import { preloadPx, pxFitOf, PxStrip } from '@/components/PxStrip';
import {
  fromKeys,
  nameFit,
  useArmLayout,
  useBox,
  useFirstFrame,
  useFullWin,
  useWordFit,
} from '@/components/armory';
import { useFinanceStore } from '@/store';
import { enchantName, fmtNum, fmtShort, pickName, rarityName, rockName, t, useT } from '@/i18n';
import { nameIn, pickTitle, pickToForge } from '@/i18n/data-mine';
import { useAction } from '@/input';
import { Button, Icon } from '@/ui-px';
import {
  PxdButton,
  PxdGem,
  PxdPedestal,
  PxdPips,
  PxdRibbon,
  PxdSheet,
  PxdSocket,
  usePxd,
} from '@/ui-px/dark';
import { PX_SETS } from '@/lib/props-pixel/manifest';
import {
  AUTOSELL_TOKENS,
  BAG_MAX,
  bagCapacity,
  bagCost,
  enchSlots,
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
  ROCKS,
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

type Status = 'hand' | 'have' | 'next' | 'locked';

export function ForgeScreen({
  onClose,
  onSpend,
  onBooks,
}: {
  onClose: () => void;
  /** Монеты ушли — табло встаёт на новое значение. */
  onSpend?: () => void;
  /** Открыть книги чар (кнопка › у гнёзд); нет — кнопки нет. */
  onBooks?: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonForge = useFinanceStore((s) => s.prisonForge);
  const prisonBuy = useFinanceStore((s) => s.prisonBuy);
  const prisonEquip = useFinanceStore((s) => s.prisonEquip);
  const { layout, u } = useArmLayout();
  const root = useRef<HTMLDivElement>(null);
  useWordFit(root);
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
  // The collection row shows 4 picks from `win`; a tap inside it never shifts it, a pick chosen
  // elsewhere (the full sheet, a forging) re-centres it.
  const winOf = (i: number) => Math.max(0, Math.min(PICKS.length - 4, i - 1));
  const [win, setWin] = useState(() => winOf(sel));
  const choose = (i: number, recenter: boolean) => {
    setSel(i);
    setWin((w) => (recenter ? winOf(i) : i < w ? i : i > w + 3 ? i - 3 : w));
  };
  const [tab, setTab] = useState<'picks' | 'gear'>('picks');
  const switchTab = (to: 'picks' | 'gear') => {
    if (to === tab) return;
    selectionChanged();
    setTab(to);
  };
  const [sheet, setSheet] = useState<'all' | 'recipe' | null>(null);
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
    choose(got, true);
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
  const pickTap = (i: number, keys: boolean, recenter = false) => {
    if (i !== sel) {
      selectionChanged();
      choose(i, recenter);
      return;
    }
    if (!keys) return;
    if (i === n) forge();
    else equip(i);
  };

  useAction(['inspect'], () => forge(), { scope: root });

  useAction(['tabPrev', 'tabNext'], () => switchTab(tab === 'picks' ? 'gear' : 'picks'), {
    scope: root,
  });

  // ---- CTA: «Выковать <name>» over the price, or over what is still missing ------------------
  let why = '';
  if (check && !check.open)
    why = next?.prestige
      ? t('forge.cta.prestige', { n: next.prestige })
      : t('forge.cta.floor', { rank: rankLetter(next!.floor) });
  else if (check && !check.ore) why = t('forge.cta.ore');
  else if (check && balance < coins) why = t('forge.cta.coins', { sum: fmtShort(coins - balance) });
  const ctaText = check && n >= 0 ? t('forge.forgeIt', { name: pickToForge(n) }) : t('forge.best');

  // ---- Stage: the selected pick, STILL (owner: «почему она вообще в 3д»), on a plinth --------
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useBox(stageRef, tab === 'picks');
  const painted = useFirstFrame(); // the collection comes a frame after the window
  useFullWin();
  usePxd();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const ov = 13 * u; // the ribbon covers the bottom of the stage
  const roomH = stage.h - ov - 8 * u;
  let art = fitPick(Math.min(stage.w - 18 * u, roomH * 0.94));
  let pedW = Math.max(15, Math.round((art * 0.9) / u) | 1);
  let pedH = Math.max(7, Math.round(pedW / 6) | 1);
  while (art > 24 && art + (pedH * u) / 2 > roomH) {
    art = fitPick(art - 1);
    pedW = Math.max(15, Math.round((art * 0.9) / u) | 1);
    pedH = Math.max(7, Math.round(pedW / 6) | 1);
  }
  const pedBottom = ov + 2 * u;
  const dim = st === 'locked' || (st === 'next' && !ready);
  const selSpeed = pickSpeed(floor, sel, m);

  const stateRow =
    st === 'have' ? (
      <PxdButton className="frg-equip" hint="confirm" onClick={() => equip(sel)}>
        <Icon name="up" />
        {t('forge.equip')}
      </PxdButton>
    ) : (
      <span className={`frg-state is-${st}`}>
        {st === 'hand' && <Icon name="check" />}
        {st === 'locked' && <Icon name="lock" />}
        {st === 'hand'
          ? t('forge.state.hand')
          : st === 'next'
            ? ready
              ? t('forge.state.ready')
              : t('forge.next')
            : d.prestige
              ? t('forge.state.lockedPrestige', { n: d.prestige })
              : t('forge.state.locked', { rank: rankLetter(d.floor) })}
        {st === 'hand' && p.pickStars > 0 && (
          <span className="frg-stars" aria-label={`★${p.pickStars}`}>
            <Icon name="star" />×{p.pickStars}
          </span>
        )}
      </span>
    );

  const show = (
    <section className="frg-show" style={rarityVars(d.rarity)}>
      <div ref={stageRef} className="frg-stage pxd-f pxd-f--oct">
        <i className="frg-glow" />
        {art > 0 && (
          <>
            <PxdPedestal
              w={pedW}
              className="frg-ped"
              style={{
                left: Math.round((stage.w - pedW * u) / 2 / u) * u,
                bottom: pedBottom,
              }}
            />
            <span
              className={`frg-art${dim ? ' is-dim' : ''}`}
              style={{
                width: art,
                height: art,
                left: snap((stage.w - art) / 2),
                bottom: snap(pedBottom + (pedH * u) / 2),
              }}
            >
              <PickPx key={sel} pick={sel} size={art} />
            </span>
          </>
        )}
        <span className="frg-no pxd-f pxd-f--well">
          {sel + 1} / {PICKS.length}
        </span>
      </div>
      <PxdRibbon className="frg-name" style={nameFit(pickTitle(sel))}>
        {pickTitle(sel)}
      </PxdRibbon>
      <div className="frg-staterow">{stateRow}</div>
    </section>
  );

  // ---- Three square stats: power · blocks a minute · level (floor for other picks) -----------
  const tile = (
    key: string,
    icon: GxIconName,
    num: ReactNode,
    label: ReactNode,
    extra?: ReactNode,
    delta = 0,
  ) => (
    <div key={key} className={`frg-stat is-${key} pxd-f pxd-f--panel`}>
      <span className="frg-stat__ic pxd-f pxd-f--well">
        <GxIcon name={icon} />
      </span>
      <b className="frg-stat__n">
        {num}
        {delta !== 0 && (
          <em className={delta > 0 ? 'is-up' : 'is-down'}>
            {delta > 0 ? '+' : '−'}
            {fmt(Math.abs(delta))}
          </em>
        )}
      </b>
      {extra}
      {label != null && <i className="frg-stat__l">{label}</i>}
    </div>
  );
  const lvPips = lvl.need ? Math.floor((10 * lvl.into) / lvl.need) : 10;
  const stats = (
    <div className="frg-stats">
      {tile(
        'power',
        'pick',
        d.power,
        t('forge.power'),
        null,
        st === 'hand' ? 0 : d.power - cur.power,
      )}
      {tile(
        'speed',
        'stopwatch',
        fmt(selSpeed),
        t('forge.perMinLong'),
        null,
        st === 'hand' ? 0 : selSpeed - speed,
      )}
      {st === 'hand'
        ? tile(
            'level',
            'upgrade',
            <>
              <small>{t('forge.lvlShort')}</small>
              {lvl.level}
            </>,
            lvl.need ? `${fmt(lvl.into)} / ${fmt(lvl.need)}` : t('forge.max'),
            <PxdPips n={10} on={lvPips} label={t('common.level', { n: lvl.level })} />,
          )
        : tile(
            'floor',
            'stairs',
            d.prestige ? t('forge.rungPrestige', { n: d.prestige }) : rankLetter(d.floor),
            t('forge.floorTile'),
          )}
    </div>
  );

  // ---- «Берёт»: ore chips of what the selected pick breaks ------------------------------------
  const opens = opensRocks(sel);
  const oreLen = opens.reduce((a, r) => a + rockName(r).length, 0);
  const takes = (
    <div
      className="frg-line frg-takes"
      style={{ '--clen': oreLen + opens.length * 4 } as CSSProperties}
    >
      <i className="frg-line__k">{t('forge.takesShort')}</i>
      <span className="frg-line__v">
        {opens.map((r) => (
          <span key={r} className="frg-ore pxd-chip pxd-f pxd-f--well">
            <PxdGem color={oreGem(r)} />
            {rockName(r)}
          </span>
        ))}
      </span>
    </div>
  );

  // ---- «Чары»: round sockets + what is in them + › to the books ------------------------------
  const slots = enchSlots(p);
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0).slice(0, Math.max(slots, 1));
  const enchText =
    onPick.length === 0
      ? slots > 1
        ? t('forge.enchEmptyN')
        : t('forge.enchEmpty1')
      : onPick.map((e) => `${enchantName(e.id)} ${ROMAN[p.ench[e.id] - 1]}`).join(', ');
  const ench = (
    <div
      className={`frg-line frg-ench${slots > 2 ? ' is-many' : ''}${slots > 4 ? ' is-lots' : ''}`}
      title={onPick.length > 0 ? enchText : undefined}
    >
      <i className="frg-line__k">{t('forge.enchShort')}</i>
      <span className="frg-line__v frg-ench__v">
        <span className="frg-socks" role="img" aria-label={enchText}>
          {Array.from({ length: slots }, (_, k) => {
            const e = onPick[k];
            return (
              <PxdSocket
                key={k}
                d={slots > 4 ? 12 : slots > 2 ? 14 : 16}
                gem={
                  e ? (p.off.includes(e.id) ? ENCH_OFF : (ENCH_GEM[e.id] ?? ENCH_OFF)) : undefined
                }
              />
            );
          })}
        </span>
        <small className="frg-ench__txt">{enchText}</small>
      </span>
      <PxdButton
        className={`frg-round${onBooks ? '' : ' is-hidden'}`}
        aria-label={t('forge.toBooks')}
        onClick={() => {
          tapLight();
          onBooks?.();
        }}
      >
        <Icon name="right" />
      </PxdButton>
    </div>
  );

  // ---- Collection: four picks around the selected one + «all 17» ----------------------------
  const rowRef = useRef<HTMLDivElement>(null);
  const row = useBox(rowRef, tab === 'picks');
  // the icon's box has a transparent margin: it may reach over the cell's 2-px ring
  const cellArt = fitPick((row.w - 4 * 4 * u) / 5 - 2 * u);
  const fullArt = fitPick(24 * u);
  const cell = (i: number, size: number, after?: () => void) => {
    const s = statusOf(i);
    return (
      <PxdButton
        key={i}
        frame={sel === i ? 'sel' : 'panel'}
        className={`frg-cell is-${s}`}
        data-autofocus={sel === i ? '' : undefined}
        aria-pressed={sel === i}
        aria-label={
          s === 'hand'
            ? t('forge.rungHand', { name: pickName(i) })
            : s === 'have'
              ? t('forge.rungTake', { name: pickName(i) })
              : pickName(i)
        }
        onClick={(e) => {
          pickTap(i, fromKeys(e), !!after);
          after?.();
        }}
        onFocus={() => {
          if (i !== sel && !after) choose(i, false);
        }}
      >
        <span className={s === 'locked' || (s === 'next' && !ready) ? 'frg-ghost' : undefined}>
          {size > 0 && <PickPx pick={i} size={size} />}
        </span>
        {s === 'hand' && <i className="frg-tick">✓</i>}
        {s === 'next' && ready && <i className="frg-tick is-go">!</i>}
        {after && (
          <i className="frg-pw">
            {PICKS[i].prestige ? t('forge.rungPrestige', { n: PICKS[i].prestige }) : PICKS[i].power}
          </i>
        )}
      </PxdButton>
    );
  };
  const forged = p.pickMax + 1;
  // «17 кирок»: a narrow cell keeps only the number (every language puts it first)
  const [allNum, ...allWord] = t('forge.allPicks', { n: PICKS.length }).split(' ');
  const collHead = (
    <div className="frg-coll__h">
      <h3>{t('forge.collection')}</h3>
      <small>{t('forge.collCount', { n: forged, all: PICKS.length })}</small>
    </div>
  );
  const coll =
    layout === 'one' ? (
      <section className="frg-coll">
        {collHead}
        <div ref={rowRef} className="frg-row">
          {painted && Array.from({ length: 4 }, (_, k) => cell(win + k, cellArt))}
          <PxdButton
            className="frg-cell frg-all"
            onClick={() => {
              tapLight();
              setSheet('all');
            }}
          >
            <b>{t('forge.allTile')}</b>
            <small>
              {allNum}
              <span className="frg-all__w"> {allWord.join(' ')}</span>
            </small>
          </PxdButton>
        </div>
      </section>
    ) : (
      <section className="frg-coll frg-list">
        {collHead}
        <div className="frg-grid">{painted && PICKS.map((_, i) => cell(i, fullArt))}</div>
      </section>
    );

  // ---- Bottom bar: recipe square + the forge CTA, always in the same place -------------------
  const bar = (
    <div className="frg-bar">
      <PxdButton
        className="frg-sq"
        off={n < 0}
        onClick={() => {
          tapLight();
          if (n < 0) forge();
          else setSheet('recipe');
        }}
      >
        <GxIcon name="book" />
        <span>{t('forge.recipeShort')}</span>
      </PxdButton>
      <PxdButton
        frame="act"
        off={!ready}
        hint="inspect"
        className="frg-go"
        onClick={forge}
        style={nameFit(ctaText)}
      >
        <GxIcon name="hammer" />
        <span className="frg-go__t">
          <b>{ctaText}</b>
          <small>
            {ready || (check && !why) ? (
              <>
                {coins > 0 ? fmt(coins) : t('forge.paidShort')}
                {coins > 0 && <CoinIcon size={u * 8} />}
              </>
            ) : (
              why ||
              (lockedByPrestige ? t('forge.cta.prestige', { n: lockedByPrestige.prestige }) : '')
            )}
          </small>
        </span>
      </PxdButton>
    </div>
  );

  // ---- Sheets: the whole collection; the recipe of the next pick -----------------------------
  const oreTile = (o: { rock: number; need: number; box: number; bag: number }) => {
    const have = o.box + o.bag;
    const ok = have >= o.need;
    return (
      <PxdButton
        key={o.rock}
        frame={ok ? 'sel' : 'panel'}
        className={`frg-bt${ok ? ' is-ok' : ''}`}
        aria-label={t('forge.ore', {
          rock: rockName(o.rock),
          have: String(have),
          need: String(o.need),
        })}
        onClick={() => oreTap(o.rock, o.need, o.box, o.bag)}
      >
        <PxdGem color={oreGem(o.rock)} className="frg-bt__gem" />
        <b>
          {fmtShort(Math.min(have, o.need))} / {fmtShort(o.need)}
          {ok && ' ✓'}
        </b>
        <i>{rockName(o.rock)}</i>
      </PxdButton>
    );
  };
  const sheetEl =
    sheet === 'all' ? (
      <PxdSheet
        title={t('forge.allTitle')}
        sub={t('forge.collCount', { n: forged, all: PICKS.length })}
        closeLabel={t('common.close')}
        onClose={() => setSheet(null)}
        className="frg-sheet"
      >
        <div className="frg-grid">
          {PICKS.map((_, i) =>
            cell(i, fullArt, () => {
              choose(i, true);
              setSheet(null);
            }),
          )}
        </div>
      </PxdSheet>
    ) : sheet === 'recipe' && next ? (
      <PxdSheet
        title={t('forge.recipe')}
        sub={pickTitle(n)}
        closeLabel={t('common.close')}
        onClose={() => setSheet(null)}
        className="frg-sheet"
      >
        <div className="frg-recipe">
          <div className="frg-recipe__row">
            <span className="frg-bt pxd-f pxd-f--panel" style={rarityVars(PICKS[p.pickMax].rarity)}>
              <PickPx pick={p.pickMax} size={fitPick(20 * u)} />
              <i>{pickName(p.pickMax)}</i>
            </span>
            <b className="frg-op">+</b>
            {ores.map(oreTile)}
          </div>
          <div className="frg-recipe__row">
            <span
              className={`frg-coins pxd-chip pxd-f pxd-f--well${balance < coins ? ' is-short' : ''}`}
            >
              <CoinIcon size={u * 8} />
              {coins > 0 ? fmt(coins) : t('forge.paidShort')}
            </span>
            <b className="frg-op">=</b>
            <span className="frg-bt pxd-f pxd-f--sel" style={rarityVars(next.rarity)}>
              <span className={ready ? undefined : 'frg-ghost'}>
                <PickPx pick={n} size={fitPick(20 * u)} />
              </span>
              <i>{pickName(n)}</i>
            </span>
          </div>
          <p className="frg-hint">
            <GxIcon name="sparkles" />
            {t('forge.boxHint')}
          </p>
        </div>
      </PxdSheet>
    ) : null;

  // ---- Equipment tab: backpack and minecart as two tall cards + the smith's box --------------
  const bagMax = p.bagLevel >= BAG_MAX;
  const bagPrice = bagCost(p.bagLevel);
  const cap = bagCapacity(p.bagLevel);
  const gear = (
    <div className="frg-gear">
      <div className="frg-cards">
        <article className="frg-card pxd-f pxd-f--panel">
          <span className="frg-card__art pxd-f pxd-f--oct">
            <GxIcon name="backpack" />
          </span>
          <h3>{t('forge.bagName')}</h3>
          <p>{t('forge.bagWhat')}</p>
          <div className="frg-card__val">
            <b>{fmt(cap)}</b>
            {!bagMax && (
              <>
                →<em>{fmt(bagCapacity(p.bagLevel + 1))}</em>
              </>
            )}
            <small>{t('forge.blocksN', { n: bagMax ? cap : bagCapacity(p.bagLevel + 1) })}</small>
          </div>
          <div className="frg-card__lv">
            <PxdPips n={BAG_MAX + 1} on={p.bagLevel + 1} />
            {t('forge.lvlOf', { n: p.bagLevel + 1, max: BAG_MAX + 1 })}
          </div>
          {bagMax ? (
            <span className="frg-card__done pxd-f pxd-f--well">
              <Icon name="check" />
              {t('forge.maxed')}
            </span>
          ) : (
            <PxdButton
              frame="act"
              off={balance < bagPrice}
              className="frg-card__btn"
              onClick={() => {
                if (balance < bagPrice) {
                  notifyWarning();
                  say(t('forge.say.coins', { n: Math.round(bagPrice - balance) }));
                } else buy('bag');
              }}
            >
              <span className="frg-go__t">
                <b>{t('forge.upgrade')}</b>
                <small>
                  {fmt(bagPrice)}
                  <CoinIcon size={u * 8} />
                </small>
              </span>
            </PxdButton>
          )}
        </article>
        <article className="frg-card pxd-f pxd-f--panel">
          <span className="frg-card__art pxd-f pxd-f--oct">
            <GxIcon name="minecart" />
          </span>
          <h3>{t('forge.cart')}</h3>
          <p>{t('forge.cartWhat')}</p>
          <div className="frg-card__val">
            {p.cart ? (
              <em>{t('forge.cartYes')}</em>
            ) : (
              <>
                <small>{t('forge.cartNo')}</small>→<em>{t('forge.cartYes')}</em>
              </>
            )}
          </div>
          <div className="frg-card__lv">{t('forge.once')}</div>
          {p.cart ? (
            <span className="frg-card__done pxd-f pxd-f--well">
              <Icon name="check" />
              {t('forge.bought')}
            </span>
          ) : (
            <PxdButton
              frame="act"
              off={p.tokens < AUTOSELL_TOKENS}
              className="frg-card__btn"
              onClick={() => {
                if (p.tokens < AUTOSELL_TOKENS) {
                  notifyWarning();
                  say(t('forge.say.tokens', { n: AUTOSELL_TOKENS - p.tokens }));
                } else buy('cart');
              }}
            >
              <span className="frg-go__t">
                <b>{t('forge.buy')}</b>
                <small>
                  {fmt(AUTOSELL_TOKENS)}
                  <TokenIcon size={u * 8} />
                </small>
              </span>
            </PxdButton>
          )}
        </article>
      </div>
      <section className="frg-box pxd-f pxd-f--panel">
        <div className="frg-coll__h">
          <h3>{t('forge.box')}</h3>
          {next && <small>{pickTitle(n)}</small>}
        </div>
        {next ? (
          <div className="frg-box__row">
            {ores.map(oreTile)}
            <p className="frg-hint">
              <GxIcon name="sparkles" />
              {t('forge.boxHint')}
            </p>
          </div>
        ) : (
          <p className="frg-hint">{t('forge.boxNone')}</p>
        )}
      </section>
    </div>
  );

  const tabBtn = (id: 'picks' | 'gear', icon: GxIconName, label: string) => (
    <PxdButton
      frame={tab === id ? 'sel' : 'panel'}
      className={`frg-tab${tab === id ? ' is-on' : ''}`}
      role="tab"
      aria-selected={tab === id}
      onClick={() => switchTab(id)}
    >
      <GxIcon name={icon} />
      {label}
    </PxdButton>
  );
  const tabs = (
    <nav className="frg-tabs" role="tablist">
      {tabBtn('picks', 'pick', t('forge.picks'))}
      {tabBtn('gear', 'backpack', t('forge.gear'))}
    </nav>
  );

  return createPortal(
    <div
      ref={root}
      className={`px pxd arm is-window frg frg--${layout} is-${tab}`}
      role="dialog"
      aria-label={t('forge.title')}
    >
      <header className="frg-top">
        <PxdButton
          className="frg-back"
          aria-label={t('common.back')}
          onClick={() => {
            tapLight();
            onClose();
          }}
        >
          <Icon name="left" />
        </PxdButton>
        <div className="frg-ttl">
          <h1>{t('forge.title')}</h1>
          <p>{t('forge.purpose')}</p>
        </div>
        {layout !== 'one' && tabs}
        <span className="frg-purse pxd-chip pxd-f pxd-f--well">
          <CoinIcon size={u * 8} />
          <b>{fmtShort(balance)}</b>
        </span>
      </header>
      {layout === 'one' && tabs}
      {tab === 'picks' ? (
        <>
          <div className="frg-main">
            {show}
            {stats}
          </div>
          <div className="frg-side">
            {takes}
            {ench}
            {layout === 'one' && coll}
          </div>
          {layout !== 'one' && coll}
          {bar}
        </>
      ) : (
        gear
      )}
      {note && (
        <div className="arm-note frg-note pxd-f pxd-f--panel" key={note.id} role="status">
          {note.text}
        </div>
      )}
      {sheetEl}
      {reveal != null && <ForgeReveal pick={reveal} onDone={() => setReveal(null)} />}
    </div>,
    document.body,
  );
}

/** Pick art sizes that the strip shows pixel-exact (whole device px per art px), ≤ `max`. */
function fitPick(max: number): number {
  if (!(max > 0)) return 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const set = PX_SETS.picks;
  let best = 0;
  for (const box of [set.box, set.large]) {
    if (!box) continue;
    for (let k = 1; (k * box) / dpr <= max + 0.01; k++) {
      const s = (k * box) / dpr;
      const f = pxFitOf('picks', 'icon-0', s);
      if (f && f.fit.crisp && Math.abs(f.fit.s - s) < 0.01 && s > best) best = s;
    }
  }
  return best || Math.max(16, Math.floor(max));
}

/** The gem colour of an ore: the rock itself for plain rocks, its fleck for ores. */
function oreGem(rock: number): string {
  const r = ROCKS[rock];
  if (!r) return '#9aa8ac';
  return rock < 4 || rock === 24 ? r.base : r.fleck;
}

/** Gem colours of the enchantments in the sockets (the books' own colours). */
const ENCH_GEM: Partial<Record<string, string>> = {
  power: '#ff8a3a',
  fortune: '#5fd35a',
  vein: '#4ff0dc',
  blast: '#ff5a3a',
  hammer: '#c4c0b8',
  token: '#4aa0ff',
  key: '#ffd25e',
  frenzy: '#ff5fa8',
  beam: '#b86bff',
  reforge: '#ffb52e',
};
/** A switched-off enchantment: a grey gem. */
const ENCH_OFF = '#5e6875';

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
