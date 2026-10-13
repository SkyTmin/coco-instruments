// Книги зачарований (v2.70; UI v2 — пиксельный набор) — вкладка «Книги» у шахты: места в
// кирке, Чародей, полка, пыль, наковальня. Каркас — «оружейная» (`armory.ts`, как кузница и
// рюкзак): выбранная книга крупно на подиуме, три цифры, сетки ячеек, кнопки внизу. Правила — lib/books.ts, стор —
// prisonBook*. Сцены (покупка, вписывание, наковальня) — порталом в body:
// у листа лагеря `backdrop-filter`, и `position: fixed` внутри него жил бы
// в рамке листа.
//
// Как в Майнкрафте и на присонах: книгу покупают «вслепую» (ярус известен,
// чара — нет), вписывают С ШАНСОМ, и шанс виден как стрелка на круге —
// зелёный сектор ровно такого размера, сколько процентов. Не вписалась —
// сгорает книга, не кирка.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './books.css';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { PickArt, PickPx, RarityChip, RarityName, rarityVars } from '@/components/PickArt';
import {
  fromKeys,
  heroFit,
  nameFit,
  numFit,
  useArmGuard,
  useArmLayout,
  useBox,
  useFirstFrame,
  useFullWin,
} from '@/components/armory';
import { preloadPx, PxStrip, pxFitOf } from '@/components/PxStrip';
import { TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import { enchantName, fmtNum, fmtShort, rich, useT } from '@/i18n';
import {
  bookName,
  bookTierBook,
  enchantEffect,
  enchantPct,
  mageLine,
  pickFull,
  rarityPick,
} from '@/i18n/data-books';
import { rarityOf } from '@/lib/rarity';
import {
  anvilMate,
  applyChance,
  BOOK_TIERS,
  bookTierOf,
  canApply,
  dustOf,
  dustToFull,
  MAGE_LINES,
  ROMAN,
  SHELF_MAX,
  tierOfLevel,
} from '@/lib/books';
import type { Book, BookTier } from '@/lib/books';
import { bookIdleBob } from '@/lib/props-pixel/books-idle';
import {
  ENCHANT_TOGGLE,
  ENCHANTS,
  enchSlots,
  enchUnits,
  PICK_LEVEL_MAX,
  PICK_STARS_MAX,
  pickLevelOf,
  PICKS,
  STAR_CAP,
  STAR_DMG,
  STAR_KEYS,
  STAR_TOKENS,
} from '@/lib/prison';
import type { EnchantId } from '@/lib/prison';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import {
  caseTick,
  chestLand,
  chestLatch,
  chestOpen,
  forgeReveal,
  forgeStrike,
  primeAudio,
  riskLose,
  softChime,
  softThud,
  tierBreak,
  uiBuy,
  uiClose,
  uiError,
  uiOpen,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';
import { useAction } from '@/input';
import { Bar, Button, Heading, Icon, Modal, Panel, Slot, useTip } from '@/ui-px';

const fmt = (n: number) => fmtNum(n);

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Знак чары на обложке — маска game-icons, как все значки игры. */
export const ENCH_ICON: Record<EnchantId, GxIconName> = {
  power: 'pick',
  fortune: 'minerals',
  vein: 'energy',
  blast: 'explosion',
  hammer: 'hammer',
  token: 'sparkles',
  key: 'key',
  frenzy: 'flame',
  beam: 'beam',
  reforge: 'anvil',
};

/** Ярус книги → ступень редкости (цвет свечения и имени). */
export const TIER_RARITY: Record<BookTier, number> = { simple: 0, rare: 2, epic: 3, legend: 4 };

const rarityOfLevel = (lvl: number) => TIER_RARITY[tierOfLevel(lvl)];

/** Точка якоря полосы книги (проценты рамки) → CSS-пиксели в квадрате `size`. */
function bookAnchor(name: string, size: number, key: string): [number, number] | null {
  const fo = pxFitOf('books', name, size);
  const a = fo?.st.anchors?.[key];
  if (!fo || !a) return null;
  const o = (size - fo.fit.s) / 2;
  return [o + (a[0] / 100) * fo.fit.s, o + (a[1] / 100) * fo.fit.s];
}

/**
 * Знак чары в медальоне: квадрат 100×100 матрицей ложится на медальон с тем
 * же поворотом крышки (якоря `glyph`, `glyphX` — край вправо, `glyphY` — вверх).
 */
function glyphStyle(name: string, size: number): CSSProperties | null {
  const c = bookAnchor(name, size, 'glyph');
  const x = bookAnchor(name, size, 'glyphX');
  const y = bookAnchor(name, size, 'glyphY');
  if (!c || !x || !y) return null;
  const m = [x[0] - c[0], x[1] - c[1], c[0] - y[0], c[1] - y[1]].map((v) => (v / 50).toFixed(4));
  return { left: c[0] - 50, top: c[1] - 50, transform: `matrix(${m.join(',')},0,0)` };
}

/** Знак чары (или «?» загадочной книги) — маска иконки в медальоне. */
function BookGlyph({ book }: { book?: Pick<Book, 'id' | 'lvl'> }) {
  return book ? (
    <i
      className="pbook__glyph"
      style={{ ['--gx-icon' as string]: `url(/ui/icons/${ENCH_ICON[book.id]}.svg)` }}
    />
  ) : (
    <b className="pbook__q">?</b>
  );
}

/**
 * Книга — пиксельная полоса (`lib/props-pixel/books.ts`): `still-<ярус>` на
 * полке, `idle-<ярус>` (`live`, по умолчанию при `glow`) — парит и бликует.
 * Знак чары лежит поверх в медальоне и покачивается с книгой кадр в кадр
 * (`bookIdleBob`). Без `book` — загадочная книга Чародея: знак «?».
 */
export function BookArt({
  book,
  tier,
  size = 64,
  glow = false,
  live,
}: {
  book?: Pick<Book, 'id' | 'lvl'>;
  tier?: BookTier;
  size?: number;
  glow?: boolean;
  live?: boolean;
}) {
  const t = book ? tierOfLevel(book.lvl) : (tier ?? 'simple');
  const r = TIER_RARITY[t];
  const anim = live ?? glow;
  const name = `${anim ? 'idle' : 'still'}-${t}`;
  const gs = glyphStyle(name, size);
  const bob = useRef<HTMLSpanElement>(null);

  // Знак едет с книгой: тот же кадр полосы, что у `PxStrip` (часы от монтирования).
  useEffect(() => {
    const fo = anim && !reduceMotion() ? pxFitOf('books', name, size) : null;
    if (!fo) return undefined;
    const { st, fit, box } = fo;
    const k = fit.s / box;
    const scale = box / BOOK_BOX;
    const t0 = performance.now();
    let cur = -1;
    let raf = requestAnimationFrame(function step(now) {
      const i = Math.floor(((now - t0) / 1000) * st.fps) % st.n;
      if (i !== cur && bob.current) {
        cur = i;
        bob.current.style.transform = `translateY(${bookIdleBob(t, i, st.n, scale) * k}px)`;
      }
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [anim, name, size, t]);

  return (
    <span
      className={`pbook t-${t}${glow ? ' is-glow' : ''}`}
      style={{ width: size, height: size, ...rarityVars(r) } as CSSProperties}
      aria-hidden="true"
    >
      {/* Своя рамка `size` по центру: CSS может ужать `.pbook` (ячейка инвентаря), знак не съедет. */}
      <span className="pbook__in" style={{ width: size, height: size }}>
        <PxStrip set="books" name={name} size={size} mode={anim ? 'loop' : 'still'} />
        {gs && (
          <span className="pbook__bob" ref={bob}>
            <span className="pbook__emboss" style={gs}>
              <BookGlyph book={book} />
            </span>
          </span>
        )}
      </span>
    </span>
  );
}

/** Рамка малой полосы книг (пиксели рисунка) — покачивание считается в ней. */
const BOOK_BOX = 48;
/** Сцены книг: сторона рамки (CSS) — у крупной полосы (112) целый масштаб на 2× и 3×. */
const REVEAL_SIZE = 170;
const APPLY_SIZE = 112;

/** Подгрузить полосу открытия заранее — по нажатию «Купить» / «Склеить». */
function preloadBookReveal(tier: BookTier): void {
  void preloadPx('books', `reveal-${tier}`, REVEAL_SIZE);
}

/** Пыль чар: фиолетовая искра. */
export function DustIcon({ size = 16 }: { size?: number }) {
  return <GxIcon name="magic" size={size} className="pdust-ico" />;
}

/** Эффект книги уровня `lvl` на кирке со звёздами `stars`. */
const effectOf = (id: EnchantId, lvl: number, stars: number) =>
  enchantEffect(id, enchUnits(id, lvl, stars));

/** Цвет шанса: зелёный — почти наверняка, жёлтый — как повезёт, красный — рискованно. */
const chanceTone = (c: number) => (c >= 80 ? 'hi' : c >= 50 ? 'mid' : 'lo');

// ---------------------------------------------------------------------------
// Вкладка.
// ---------------------------------------------------------------------------

type Scene =
  | { kind: 'buy'; book: Book; tier: BookTier }
  | { kind: 'anvil'; book: Book; from: Book }
  | { kind: 'apply'; book: Book; ok: boolean; chance: number; replaced?: EnchantId };

/** What sits on the showcase: a shelf book, an enchant in the pick, an Enchanter tier, the pick. */
type Sel =
  | { k: 'book'; i: number }
  | { k: 'slot'; id: EnchantId }
  | { k: 'tier'; id: BookTier }
  | { k: 'pick' };

const selKey = (s: Sel) =>
  s.k === 'book' ? `b${s.i}` : s.k === 'slot' ? `s${s.id}` : s.k === 'tier' ? `t${s.id}` : 'p';

/** One action place of the bar (three per screen: destructive · secondary · main). */
interface Act {
  id: string;
  label: ReactNode;
  kind: 'confirm' | 'primary' | 'secondary' | 'danger';
  off?: boolean;
  hide?: boolean;
  armed?: boolean;
  /** The words of an icon-only button (the phone's anvil). */
  aria?: string;
  run?: () => void;
}

/** Dust puff: where its eight motes fly, in art pixels (whole steps, as the kit moves art). */
const PUFF: [number, number][] = [
  [0, -40],
  [30, -30],
  [40, 0],
  [30, 26],
  [0, 36],
  [-30, 26],
  [-40, 0],
  [-30, -30],
];

/** Green «+2» / red «−1» beside a big number. */
function Delta({ v }: { v: number }) {
  if (!v) return null;
  return (
    <span className={`arm-delta ${v > 0 ? 'is-up' : 'is-down'}`}>{v > 0 ? `+${v}` : `−${-v}`}</span>
  );
}

/** «+252 %» — the effect of enchant `id` at level `lvl` as one number (tr «+%252»). */
function usePlusPct() {
  const t = useT();
  return (id: EnchantId, lvl: number, stars: number) =>
    `+${t('books.pct', { v: enchantPct(id, enchUnits(id, lvl, stars)) })}`;
}

/**
 * The book against the same enchant in the pick, as one row: `[✦] I +42 % ⌄ [⛏] VI +252 %` and a
 * verdict chip. The sentence that said it in nine lines is the row's tooltip (critic).
 */
function Compare({
  book,
  have,
  pick,
  stars,
  lower,
  tip,
  u,
}: {
  book: Pick<Book, 'id' | 'lvl'>;
  have: number;
  pick: number;
  stars: number;
  lower: boolean;
  tip: string;
  u: number;
}) {
  const t = useT();
  const plus = usePlusPct();
  const ref = useRef<HTMLDivElement>(null);
  const tipNode = useTip(ref, <span className="arm-tip">{tip}</span>);
  return (
    <div ref={ref} className="bkx-cmp" role="group" aria-label={tip}>
      <span className="bkx-cmp__side">
        <GxIcon name={ENCH_ICON[book.id]} size={u * 10} />
        <b>{ROMAN[book.lvl - 1]}</b>
        <span className="arm-num">{plus(book.id, book.lvl, stars)}</span>
      </span>
      <Icon
        name={lower ? 'down' : 'up'}
        className={lower ? 'bkx-cmp__arrow is-down' : 'bkx-cmp__arrow'}
      />
      <span className="bkx-cmp__side">
        <PickPx pick={pick} size={u * 12} />
        {have > 0 ? (
          <>
            <b>{ROMAN[have - 1]}</b>
            <span className="arm-num">{plus(book.id, have, stars)}</span>
          </>
        ) : (
          <b className="arm-muted">—</b>
        )}
      </span>
      {lower && <span className="bkx-verdict">{t('books.weakerShort')}</span>}
      {tipNode}
    </div>
  );
}

/**
 * The books: with `onClose` a full-screen window like the forge and the backpack (the mine dock
 * opens it so — critic ruling 4: the one-tab camp cost 64 px on top and closed with a ✕ at the
 * other corner); without it, a tab embedded in a multi-tab camp.
 */
export function BooksTab({ onClose }: { onClose?: () => void } = {}) {
  const t = useT();
  const win = !!onClose;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!win) return undefined;
    uiOpen();
    const off = registerEscape(() => closeRef.current?.());
    return () => {
      off();
      uiClose();
    };
  }, [win]);
  const p = useFinanceStore((s) => s.prison);
  const buy = useFinanceStore((s) => s.prisonBookBuy);
  const apply = useFinanceStore((s) => s.prisonBookApply);
  const salvage = useFinanceStore((s) => s.prisonBookSalvage);
  const anvil = useFinanceStore((s) => s.prisonBookAnvil);
  const toggle = useFinanceStore((s) => s.prisonEnchantToggle);
  const wipe = useFinanceStore((s) => s.prisonEnchantWipe);
  const prisonPickStar = useFinanceStore((s) => s.prisonPickStar);
  const { layout, u } = useArmLayout();
  const root = useRef<HTMLDivElement>(null);

  const [sel, setSel] = useState<Sel>(() => (p.books.length ? { k: 'book', i: 0 } : { k: 'pick' }));
  const [scene, setScene] = useState<Scene | null>(null);
  const [hint, setHint] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [fresh, setFresh] = useState<Book | null>(null);
  /** The armed two-tap action («В пыль», «Снять», «Перековать»): its id. */
  const [armed, setArmed] = useState<string | null>(null);
  const guard = useArmGuard();
  /** Dust puffs so far: each salvage / wipe plays one and ticks the dust counter. */
  const [puff, setPuff] = useState(0);
  const plus = usePlusPct();
  const [dustOn, setDustOn] = useState(true);
  const [asking, setAsking] = useState(false);
  const [replace, setReplace] = useState<EnchantId | null>(null);
  const [byLevel, setByLevel] = useState(false);

  const say = (text: string, bad = false) => setHint({ text, key: Date.now(), bad });
  useEffect(() => {
    if (!hint) return undefined;
    const id = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(id);
  }, [hint]);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(id);
  }, [armed]);

  const slots = enchSlots(p);
  const pk = PICKS[p.pickMax];
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0);
  const full = p.books.length >= SHELF_MAX;
  const lvl = pickLevelOf(p.pickXp);
  const starMax = p.pickStars >= PICK_STARS_MAX;
  const starReady = lvl.level >= PICK_LEVEL_MAX && !starMax;

  // The selection survives the shelf changing under it: a book index past the end falls back
  // to the last book (after «в пыль» the next one slides into the same place), a wiped enchant
  // to the pick. The showcase never empties.
  let cur: Sel = sel;
  if (cur.k === 'book' && p.books.length === 0) cur = { k: 'pick' };
  if (cur.k === 'slot' && !(p.ench[cur.id] > 0)) cur = { k: 'pick' };
  const bi = cur.k === 'book' ? Math.min(cur.i, p.books.length - 1) : -1;
  const b = bi >= 0 ? p.books[bi] : undefined;

  const select = (s: Sel) => {
    if (selKey(s) === selKey(cur)) return false;
    selectionChanged();
    setSel(s);
    setArmed(null);
    setDustOn(true);
    setReplace(null);
    return true;
  };

  // ---- Book on the showcase -------------------------------------------------------------------
  const check = b ? canApply(p.ench, slots, b) : 'ok';
  const inPick = b ? p.ench[b.id] : 0;
  const need = b ? dustToFull(b) : 0;
  const dust = b && dustOn ? Math.min(p.dust, need) : 0;
  const chance = b ? applyChance(b, dust) : 0;
  const mate = bi >= 0 ? anvilMate(p.books, bi) : -1;

  // ---- Actions (behaviour as before: same store calls, same two-tap confirmations) ------------
  const onBuy = (tier: BookTier) => {
    primeAudio();
    const def = bookTierOf(tier);
    if (full) {
      uiError();
      notifyWarning();
      say(t('books.shelfFull'), true);
      return;
    }
    if (p.tokens < def.price) {
      uiError();
      notifyWarning();
      say(t('books.needTokens', { n: Math.round(def.price - p.tokens) }), true);
      return;
    }
    const book = buy(tier);
    if (!book) return;
    uiBuy();
    preloadBookReveal(tierOfLevel(book.lvl));
    setScene({ kind: 'buy', book, tier });
  };
  const doApply = (rep?: EnchantId) => {
    if (!b) return;
    primeAudio();
    if (check === 'lower') {
      uiError();
      notifyWarning();
      say(lowerText(), true);
      return;
    }
    if (check === 'full' && !rep) {
      tapLight();
      setAsking(true);
      return;
    }
    const res = apply(bi, dust, check === 'full' ? rep : undefined);
    if (!res) {
      uiError();
      return;
    }
    setAsking(false);
    setReplace(null);
    void preloadPx(
      'books',
      `${res.ok ? 'apply-ok' : 'apply-burn'}-${tierOfLevel(res.book.lvl)}`,
      APPLY_SIZE,
    );
    setScene({
      kind: 'apply',
      book: res.book,
      ok: res.ok,
      chance: res.chance,
      replaced: check === 'full' ? rep : undefined,
    });
  };
  const doAnvil = () => {
    if (!b || mate < 0) return;
    primeAudio();
    const from = b;
    const got = anvil(bi, mate);
    if (!got) return;
    preloadBookReveal(tierOfLevel(got.lvl));
    setScene({ kind: 'anvil', book: got, from });
  };
  const doSalvage = () => {
    if (!b) return;
    if (armed !== 'salvage') {
      tapLight();
      guard.mark();
      setArmed('salvage');
      return;
    }
    if (guard.tooSoon()) return; // a double tap is not a confirmation
    setArmed(null);
    const name = bookName(b);
    const got = salvage(bi);
    softChime(1);
    tapLight();
    if (got) {
      setPuff((n) => n + 1);
      say(t('books.crumbled', { name }));
    }
  };
  const doWipe = (id: EnchantId) => {
    if (armed !== 'wipe') {
      tapLight();
      guard.mark();
      setArmed('wipe');
      return;
    }
    if (guard.tooSoon()) return;
    setArmed(null);
    const got = wipe(id);
    softThud();
    tapMedium();
    if (got) {
      setPuff((n) => n + 1);
      say(t('books.crumbled', { name: bookName({ id, lvl: p.ench[id] }) }));
    }
  };
  const doStar = () => {
    primeAudio();
    if (!starReady) {
      uiError();
      notifyWarning();
      say(starMax ? t('books.starMax') : t('books.starNeed', { n: PICK_LEVEL_MAX }), true);
      return;
    }
    if (armed !== 'star') {
      tapLight();
      guard.mark();
      setArmed('star');
      return;
    }
    if (guard.tooSoon()) return;
    setArmed(null);
    if (!prisonPickStar()) {
      notifyWarning();
      return;
    }
    tierBreak(3);
    burstConfetti(80, ['#ffe08a', '#ffffff', '#b8f4e6']);
    flashFrame('big');
    notifySuccess();
  };
  /** Dust raises the chance: on by default, the chance cell and the details button toggle it. */
  const toggleDust = () => {
    if (!b || need <= 0 || check === 'lower') return;
    if (p.dust <= 0) {
      notifyWarning();
      say(t('books.noDust'), true);
      return;
    }
    selectionChanged();
    setDustOn(!dustOn);
  };
  const lowerText = () =>
    t(mate >= 0 ? 'books.lowerMate' : 'books.lower', {
      name: b ? bookName({ id: b.id, lvl: inPick }) : '',
    });

  // ---- Showcase ---------------------------------------------------------------------------------
  const roomRef = useRef<HTMLSpanElement>(null);
  const roomBox = useBox(roomRef);
  const painted = useFirstFrame(); // the shelf grid comes a frame after the window
  useFullWin(win);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const pedOf = (a: number) => Math.max(u, Math.round((a * 0.8 * dpr) / 112) / dpr);
  const art = heroFit(roomBox, u, 160 * u, pedOf);
  const ped = pedOf(art);

  let rarity = 0;
  let hero: ReactNode = null;
  let name: ReactNode = '';
  let status: ReactNode = null;
  let fx: ReactNode = '';
  let stats: ReactNode = null;
  const acts: Act[] = [
    { id: 'a0', label: '·', kind: 'danger', hide: true },
    { id: 'a1', label: '·', kind: 'secondary', hide: true },
    { id: 'a2', label: '·', kind: 'confirm', hide: true },
  ];

  if (cur.k === 'book' && b) {
    const tier = tierOfLevel(b.lvl);
    rarity = TIER_RARITY[tier];
    hero = <BookArt key={`${bi}-${b.id}-${b.lvl}`} book={b} size={art} glow />;
    name = bookName(b);
    status = (
      <span className={`arm-status is-${check}`}>
        {check === 'ok' && <Icon name="up" />}
        {check === 'lower' && <Icon name="down" />}
        {check === 'ok'
          ? t('books.canApply')
          : check === 'lower'
            ? t('books.weaker')
            : t('books.noRoomShort')}
      </span>
    );
    fx = effectOf(b.id, b.lvl, p.pickStars);
    const canDust = need > 0 && check !== 'lower';
    stats = (
      <div className="arm-stats">
        <button
          type="button"
          className={`arm-stat bkx-chance px-f is-${chanceTone(check === 'lower' ? b.chance : chance)}`}
          aria-pressed={canDust ? dustOn && p.dust > 0 : undefined}
          aria-label={
            !canDust
              ? t('books.chance', { v: check === 'lower' ? b.chance : chance })
              : p.dust <= 0
                ? t('books.noDust')
                : dustOn
                  ? t('books.dustOn', { n: dust })
                  : t('books.dustOff', { n: Math.min(p.dust, need) })
          }
          onClick={toggleDust}
        >
          <b>{t('books.pct', { v: check === 'lower' ? b.chance : chance })}</b>
          {canDust && (
            <span className={`bkx-dusttag${dustOn && p.dust > 0 ? ' is-on' : ''}`}>
              <DustIcon size={u * 7} />
              {p.dust > 0 ? `+${Math.min(p.dust, need)}` : '0'}
            </span>
          )}
          <i>{t('books.statChance')}</i>
        </button>
        <span className="arm-stat">
          <b>{ROMAN[b.lvl - 1]}</b>
          {inPick > 0 && <Delta v={b.lvl - inPick} />}
          <i>{t('books.statLevel')}</i>
        </span>
        <span className="arm-stat">
          <b>
            <DustIcon size={u * 8} />
            {dustOf(b)}
          </b>
          <i>{t('books.statDust')}</i>
        </span>
      </div>
    );
    acts[0] = {
      id: 'salvage',
      label: (
        <>
          {layout === 'three' && <DustIcon size={u * 7} />}
          <span className="arm-btn-txt">
            {armed === 'salvage'
              ? t('books.sureDust', { n: dustOf(b) })
              : t('books.salvage', { n: dustOf(b) })}
          </span>
        </>
      ),
      kind: 'danger',
      armed: armed === 'salvage',
      run: doSalvage,
    };
    acts[1] = {
      id: 'anvil',
      label:
        layout !== 'three' ? (
          <GxIcon name="anvil" size={u * 11} />
        ) : (
          <>
            <GxIcon name="anvil" size={u * 8} />
            <span className="arm-btn-txt">
              {t('books.glue', { lvl: ROMAN[Math.min(b.lvl, ROMAN.length - 1)] })}
            </span>
          </>
        ),
      aria: t('books.glue', { lvl: ROMAN[Math.min(b.lvl, ROMAN.length - 1)] }),
      kind: 'secondary',
      hide: mate < 0,
      run: doAnvil,
    };
    acts[2] = {
      id: 'apply',
      label: <span className="arm-btn-txt">{t('books.apply', { v: chance })}</span>,
      kind: 'confirm',
      off: check === 'lower',
      run: () => doApply(),
    };
  } else if (cur.k === 'slot') {
    const id = cur.id;
    const l = p.ench[id];
    const off = p.off.includes(id);
    rarity = rarityOfLevel(l);
    hero = <BookArt key={`s-${id}-${l}`} book={{ id, lvl: l }} size={art} glow={!off} />;
    name = bookName({ id, lvl: l });
    status = (
      <span className={`arm-status ${off ? 'is-locked' : 'is-hand'}`}>
        <Icon name={off ? 'zzz' : 'check'} />
        {off ? t('books.offState') : t('books.inPickNow')}
      </span>
    );
    fx = effectOf(id, l, p.pickStars);
    stats = (
      <div className="arm-stats">
        <span className="arm-stat">
          <b>{ROMAN[l - 1]}</b>
          <i>{t('books.statLevel')}</i>
        </span>
        <span className="arm-stat">
          <b>
            <Icon name={off ? 'zzz' : 'check'} />
            {off ? t('common.off') : t('common.on')}
          </b>
          <i>{t('books.statState')}</i>
        </span>
        <span className="arm-stat">
          <b>
            <DustIcon size={u * 8} />
            {dustOf({ lvl: l })}
          </b>
          <i>{t('books.statDust')}</i>
        </span>
      </div>
    );
    acts[0] = {
      id: 'wipe',
      label: (
        <span className="arm-btn-txt">
          {armed === 'wipe'
            ? t('books.sureDust', { n: dustOf({ lvl: l }) })
            : t('books.wipeBtn', { n: dustOf({ lvl: l }) })}
        </span>
      ),
      kind: 'danger',
      armed: armed === 'wipe',
      run: () => doWipe(id),
    };
    acts[2] = {
      id: 'toggle',
      label: off ? t('books.toggleOn') : t('books.toggleOff'),
      kind: 'secondary',
      hide: !ENCHANT_TOGGLE.includes(id),
      run: () => {
        selectionChanged();
        toggle(id);
      },
    };
  } else if (cur.k === 'tier') {
    const bt = bookTierOf(cur.id);
    const can = p.tokens >= bt.price && !full;
    rarity = TIER_RARITY[bt.id];
    hero = <BookArt key={`t-${bt.id}`} tier={bt.id} size={art} glow={can} />;
    name = bookTierBook(bt.id);
    status = (
      <span className="arm-status">
        <GxIcon name="book" size={u * 7} />
        {t('books.mageName')}
      </span>
    );
    fx = t('books.tierFx');
    stats = (
      <div className="arm-stats">
        <span className={`arm-stat${p.tokens < bt.price ? ' is-short' : ''}`}>
          <b style={numFit(fmtShort(bt.price), true)}>
            <TokenIcon size={u * 8} />
            {fmtShort(bt.price)}
          </b>
          <i>{t('books.statPrice')}</i>
        </span>
        <span className="arm-stat">
          <b style={numFit(`${ROMAN[bt.lvl[0] - 1]}–${ROMAN[bt.lvl[1] - 1]}`)}>
            {ROMAN[bt.lvl[0] - 1]}–{ROMAN[bt.lvl[1] - 1]}
          </b>
          <i>{t('books.statLevel')}</i>
        </span>
        <span className="arm-stat">
          <b style={numFit(t('books.pctRange', { a: bt.chance[0], b: bt.chance[1] }))}>
            {t('books.pctRange', { a: bt.chance[0], b: bt.chance[1] })}
          </b>
          <i>{t('books.statChance')}</i>
        </span>
      </div>
    );
    acts[2] = {
      id: 'buy',
      label: (
        <>
          <span className="arm-btn-txt">{t('books.buy')}</span>
          <span className="arm-btn-price">
            {fmt(bt.price)} <TokenIcon size={u * 7} />
          </span>
        </>
      ),
      kind: 'primary',
      off: !can,
      run: () => onBuy(bt.id),
    };
  } else {
    rarity = pk.rarity;
    hero = <PickArt key={`p-${p.pickMax}`} pick={p.pickMax} size={art} />;
    name = pickFull(p.pickMax);
    status = (
      <span className="arm-status">
        {rich('books.onPick', { a: <b>{onPick.length}</b>, b: <b>{slots}</b> })}
      </span>
    );
    fx = lvl.need
      ? `${t('books.pickLv', { n: lvl.level })} · ${t('books.blocksLeft', { n: Math.round(lvl.need - lvl.into) })}`
      : `${t('books.pickLv', { n: lvl.level })} · ${t('books.max')}`;
    stats = (
      <div className="arm-stats">
        <span className="arm-stat">
          <b>
            <Icon name="up" />
            {lvl.level}
          </b>
          <i>{t('books.statLevel')}</i>
        </span>
        <span className="arm-stat bkx-stars">
          <b>
            <Icon name="star" />
            {p.pickStars}/{PICK_STARS_MAX}
          </b>
          <i>{t('books.statStars')}</i>
        </span>
        <span className="arm-stat">
          <b>
            <GxIcon name="book" size={u * 8} />
            {onPick.length}/{slots}
          </b>
          <i>{t('books.statSlots')}</i>
        </span>
      </div>
    );
    acts[2] = {
      id: 'star',
      label: (
        <span className="arm-btn-txt">
          {armed === 'star'
            ? t('books.sure')
            : starMax
              ? t('books.starMax')
              : // the short verb: «Spitzhacke umschmieden ★3» took three lines on a phone
                `${t('books.reforge')} ★${p.pickStars + 1}`}
        </span>
      ),
      kind: 'primary',
      off: !starReady,
      armed: armed === 'star',
      run: doStar,
    };
  }

  // X / pad Y — the main action of whatever is on the showcase.
  const main = [...acts].reverse().find((a) => !a.hide && !a.off && a.kind !== 'danger');
  useAction(['inspect'], () => main?.run?.(), { scope: root, enabled: !!main });

  const showcase = (
    <section className="arm-show" style={rarityVars(rarity)}>
      <Panel material="stone" stage className="arm-stage bkx-stage">
        <span ref={roomRef} className="arm-room">
          {art > 0 && (
            <span className="arm-ped" style={{ '--ped': `${ped}px` } as CSSProperties}>
              {hero}
            </span>
          )}
          {puff > 0 && (
            <span key={puff} className="bkx-puff" aria-hidden="true">
              {PUFF.map(([x, y], i) => (
                <i
                  key={i}
                  style={
                    {
                      '--dx': `calc(${x} * var(--u))`,
                      '--dy': `calc(${y} * var(--u))`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          )}
        </span>
        <div className="arm-id px-dark">
          <h2 className="arm-name" style={nameFit(name)}>
            {name}
          </h2>
          <div className="arm-sub">{status}</div>
          <p className="bkx-fx">{fx}</p>
        </div>
        {stats}
      </Panel>
    </section>
  );

  // ---- Details: what the choice means (side column; a fixed box over the list on phones) ------
  let details: ReactNode = null;
  if (cur.k === 'book' && b) {
    details = (
      <div className="arm-details bkx-details">
        <div className="bkx-block">
          <Heading sub>{t('books.inPickHead')}</Heading>
          <Compare
            book={b}
            have={inPick}
            pick={p.pickMax}
            stars={p.pickStars}
            lower={check === 'lower'}
            u={u}
            tip={
              check === 'lower'
                ? lowerText()
                : inPick > 0
                  ? t('books.inPick', {
                      name: bookName({ id: b.id, lvl: inPick }),
                      fx: effectOf(b.id, inPick, p.pickStars),
                    })
                  : t('books.notInPick')
            }
          />
        </div>
        {check === 'lower' ? null : (
          <div className="bkx-block">
            <Heading sub>{t('books.statChance')}</Heading>
            <Bar
              value={chance / 100}
              tone={chance >= 80 ? 'green' : 'gold'}
              label={
                dust > 0
                  ? `${t('books.pct', { v: b.chance })} + ${t('books.pct', { v: chance - b.chance })}`
                  : t('books.pct', { v: chance })
              }
            />
            {need > 0 && (
              <Button
                size="sm"
                kind="secondary"
                on={dustOn && p.dust > 0}
                off={p.dust <= 0}
                className={p.dust <= 0 ? 'bkx-dustbtn px-dark' : 'bkx-dustbtn'}
                onClick={toggleDust}
              >
                <DustIcon size={u * 7} />
                {p.dust <= 0
                  ? t('books.noDust')
                  : dustOn
                    ? t('books.dustOn', { n: dust })
                    : t('books.dustOff', { n: Math.min(p.dust, need) })}
              </Button>
            )}
            <p className="arm-muted">{t('books.warn')}</p>
          </div>
        )}
        {mate >= 0 && (
          <p className="bkx-note">
            <GxIcon name="anvil" size={u * 8} />{' '}
            {t('books.glue', { lvl: ROMAN[Math.min(b.lvl, ROMAN.length - 1)] })}
          </p>
        )}
        {check === 'full' && <p className="bkx-note">{t('books.replace')}</p>}
      </div>
    );
  } else if (cur.k === 'slot') {
    const id = cur.id;
    details = (
      <div className="arm-details bkx-details">
        <p>{effectOf(id, p.ench[id], p.pickStars)}</p>
        <p className="arm-muted">
          {armed === 'wipe'
            ? t('books.wipeArmed', { n: dustOf({ lvl: p.ench[id] }) })
            : t('books.wipeInfo')}
        </p>
      </div>
    );
  } else if (cur.k === 'tier') {
    const bt = bookTierOf(cur.id);
    details = (
      <div className="arm-details bkx-details">
        <p>{mageLine(0)}</p>
        <p>
          {ROMAN[bt.lvl[0] - 1]}–{ROMAN[bt.lvl[1] - 1]} ·{' '}
          {t('books.pctRange', { a: bt.chance[0], b: bt.chance[1] })}
        </p>
        <p className={full ? 'bkx-note is-bad' : 'arm-muted'}>
          {full ? t('books.shelfFull') : `${t('books.shelf')} ${p.books.length}/${SHELF_MAX}`}
        </p>
      </div>
    );
  } else {
    details = (
      <div className="arm-details bkx-details">
        <div className="bkx-block">
          <Heading sub>{t('books.pickLv', { n: lvl.level })}</Heading>
          <Bar
            value={lvl.need ? lvl.into / lvl.need : 1}
            tone="blue"
            label={
              lvl.need
                ? t('books.blocksLeft', { n: Math.round(lvl.need - lvl.into) })
                : t('books.max')
            }
          />
        </div>
        <p>
          {t('books.starText', {
            cap: Math.round(STAR_CAP * 100),
            dmg: Math.round(STAR_DMG * 100),
            tokens: fmt(STAR_TOKENS * (p.pickStars + 1)),
            keys: STAR_KEYS,
          })}
        </p>
        <p className="arm-muted">{t('books.perStep')}</p>
      </div>
    );
  }

  // ---- Lists: the pick's places · the Enchanter · the shelf -----------------------------------
  const cell = u * 20;
  const pickSec = (
    <section className="bkx-sec">
      <div className="arm-head">
        <Heading>
          {layout === 'one' ? (
            <>
              {t('books.inPickHead')}{' '}
              <b className="arm-num">
                {onPick.length}/{slots}
              </b>
            </>
          ) : (
            rich('books.onPick', {
              a: <b className="arm-num">{onPick.length}</b>,
              b: <b className="arm-num">{slots}</b>,
            })
          )}
        </Heading>
      </div>
      <div className="arm-grid bkx-grid bkx-pickgrid" role="group">
        <Slot
          rarity={pk.rarity}
          selected={cur.k === 'pick'}
          corner={p.pickStars > 0 ? `★${p.pickStars}` : undefined}
          dot={starReady ? '!' : undefined}
          aria-label={pickFull(p.pickMax)}
          tip={pickFull(p.pickMax)}
          data-autofocus={cur.k === 'pick' ? '' : undefined}
          onClick={() => select({ k: 'pick' })}
          onFocus={() => select({ k: 'pick' })}
        >
          <PickPx pick={p.pickMax} size={cell} />
        </Slot>
        {onPick.map((e) => {
          const l = p.ench[e.id];
          const off = p.off.includes(e.id);
          const on = cur.k === 'slot' && cur.id === e.id;
          return (
            <Slot
              key={e.id}
              rarity={rarityOfLevel(l)}
              selected={on}
              count={ROMAN[l - 1]}
              corner={off ? <Icon name="zzz" /> : undefined}
              className={off ? 'bkx-off' : undefined}
              aria-label={bookName({ id: e.id, lvl: l })}
              tip={<BookTip book={{ id: e.id, lvl: l }} stars={p.pickStars} />}
              data-autofocus={on ? '' : undefined}
              onClick={() => select({ k: 'slot', id: e.id })}
              onFocus={() => select({ k: 'slot', id: e.id })}
            >
              <BookArt book={{ id: e.id, lvl: l }} size={cell} />
            </Slot>
          );
        })}
        {Array.from({ length: Math.max(0, slots - onPick.length) }, (_, i) => (
          <Slot
            key={`e${i}`}
            empty
            aria-label={t('books.free')}
            tip={`${t('books.free')}: ${p.books.some((x) => canApply(p.ench, slots, x) === 'ok') ? t('books.freeShelf') : t('books.freeBuy')}`}
            onClick={() => {
              tapLight();
              say(
                `${t('books.free')}: ${p.books.some((x) => canApply(p.ench, slots, x) === 'ok') ? t('books.freeShelf') : t('books.freeBuy')}`,
              );
            }}
          >
            <Icon name="plus" />
          </Slot>
        ))}
        {Array.from({ length: Math.max(0, 7 - slots) }, (_, i) => {
          const r = rarityOf(slots + i);
          const txt = t('books.lockedBy', { pick: rarityPick(r.id) });
          return (
            <Slot
              key={`l${i}`}
              locked
              rarity={slots + i}
              aria-label={txt}
              tip={txt}
              onClick={() => {
                tapLight();
                say(txt);
              }}
            >
              <span className="bkx-ghost">
                <GxIcon name="book" size={Math.round(cell * 0.7)} />
              </span>
            </Slot>
          );
        })}
      </div>
    </section>
  );

  const mageSec = (
    <section className="bkx-sec">
      <div className="arm-head">
        <Heading>{t('books.mageName')}</Heading>
      </div>
      <div className="bkx-seller">
        <MageCard poor={p.tokens < BOOK_TIERS[0].price} />
        <div className="bkx-tiers" role="group">
          {BOOK_TIERS.map((bt) => {
            const can = p.tokens >= bt.price && !full;
            const on = cur.k === 'tier' && cur.id === bt.id;
            return (
              <Slot
                key={bt.id}
                rarity={TIER_RARITY[bt.id]}
                selected={on}
                count={fmtShort(bt.price)}
                className={can ? undefined : 'bkx-off'}
                aria-label={`${bookTierBook(bt.id)} · ${fmt(bt.price)}`}
                tip={`${bookTierBook(bt.id)} · ${fmt(bt.price)}`}
                data-autofocus={on ? '' : undefined}
                onPointerDown={() => can && preloadBookReveal(bt.id)}
                onClick={(e) => {
                  // Enter / Space / the pad on the tier already on the showcase buys it; a finger
                  // buys with the button (a double tap or a long press bought on release).
                  if (!select({ k: 'tier', id: bt.id }) && fromKeys(e)) onBuy(bt.id);
                }}
                onFocus={() => select({ k: 'tier', id: bt.id })}
              >
                <BookArt tier={bt.id} size={cell} />
              </Slot>
            );
          })}
        </div>
      </div>
    </section>
  );

  const order = p.books.map((x, i) => i);
  if (byLevel) order.sort((a, c) => p.books[c].lvl - p.books[a].lvl || a - c);
  const shelfSec = (
    <section className="bkx-sec">
      <div className="arm-head bkx-shelfhead">
        <Heading>
          {t('books.shelf')}{' '}
          <span className="arm-num">
            {p.books.length}/{SHELF_MAX}
          </span>
        </Heading>
        <Button
          size="sm"
          icon="sort"
          on={byLevel}
          label={t('books.sortLevel')}
          onClick={() => {
            tapLight();
            setByLevel((v) => !v);
          }}
        />
      </div>
      {p.books.length === 0 ? (
        <p className="arm-muted">{t('books.shelfEmpty')}</p>
      ) : (
        <div className="arm-grid bkx-grid" role="group">
          {(painted ? order : []).map((i) => {
            const x = p.books[i];
            const ck = canApply(p.ench, slots, x);
            const mt = anvilMate(p.books, i) >= 0;
            const on = cur.k === 'book' && bi === i;
            return (
              <Slot
                key={`${i}-${x.id}-${x.lvl}-${x.chance}`}
                rarity={rarityOfLevel(x.lvl)}
                selected={on}
                count={ROMAN[x.lvl - 1]}
                corner={
                  ck === 'ok' ? (
                    <Icon name="up" className="bkx-up" />
                  ) : mt ? (
                    <GxIcon name="anvil" size={Math.round(cell * 0.45)} />
                  ) : undefined
                }
                dot={fresh === x ? '!' : undefined}
                className={ck === 'lower' ? 'bkx-weak' : undefined}
                aria-label={`${bookName(x)} · ${t('books.pct', { v: x.chance })}`}
                tip={<BookTip book={x} stars={p.pickStars} have={p.ench[x.id]} />}
                data-autofocus={on ? '' : undefined}
                onClick={() => select({ k: 'book', i })}
                onFocus={() => select({ k: 'book', i })}
              >
                <BookArt book={x} size={cell} />
              </Slot>
            );
          })}
        </div>
      )}
    </section>
  );

  const actBar = (
    <div className="arm-acts bkx-acts">
      {acts.map((a) => (
        <Button
          key={a.id}
          kind={a.kind}
          off={a.off}
          className={`${a.hide ? 'is-hidden' : ''}${a.armed ? ' is-armed' : ''}${a.off ? ' px-dark' : ''}${a.id === 'anvil' && layout !== 'three' ? ' bkx-iconbtn' : ''}`}
          aria-label={a.aria}
          aria-hidden={a.hide || undefined}
          tabIndex={a.hide ? -1 : undefined}
          hint={a === main ? 'inspect' : undefined}
          onClick={a.hide ? undefined : a.run}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );

  // Tokens and dust: a row of their own on phone portrait; elsewhere on top of the side column,
  // so the showcase gets that row's height too.
  const purse = (
    <span className="arm-purse">
      <span>
        <TokenIcon size={u * 8} />
        <b className="arm-num">{fmt(p.tokens)}</b>
      </span>
      <span key={puff} className={`bkx-dust${puff ? ' is-tick' : ''}`}>
        <DustIcon size={u * 8} />
        <b className="arm-num">{fmt(p.dust)}</b>
      </span>
    </span>
  );

  // Phone portrait: the shelf right under the pick's strip — two rows of books show on open (the
  // details box and the Enchanter used to fill the list: 0 of 42 cells visible).
  const list = (
    <div className="arm-list bkx-list">
      {pickSec}
      {layout === 'one' ? shelfSec : mageSec}
      {layout === 'one' ? mageSec : shelfSec}
    </div>
  );

  const body = (
    <div
      ref={root}
      className={`px arm arm--${layout} ${win ? 'is-window' : 'is-embed'} bkx`}
      style={{ '--slot': `${cell + 6 * u}px` } as CSSProperties}
      role={win ? 'dialog' : undefined}
      aria-label={win ? t('mineHud.dock.books') : undefined}
    >
      {win ? (
        <header className="arm-top">
          <Button
            icon="left"
            label={t('common.back')}
            className="arm-top__back"
            onClick={() => {
              tapLight();
              onClose?.();
            }}
          />
          <Heading ribbon className="arm-top__title">
            {t('mineHud.dock.books')}
          </Heading>
          {purse}
        </header>
      ) : (
        layout === 'one' && <header className="arm-top bkx-top">{purse}</header>
      )}
      {showcase}
      {list}
      {layout === 'one' ? (
        actBar
      ) : (
        <aside className="arm-side">
          {!win && purse}
          <Panel material="obsidian" className="arm-info">
            <div className="arm-info__head">
              <h3 className="arm-info__name">{name}</h3>
              <RarityChip rarity={rarity} />
            </div>
            {details}
          </Panel>
          {actBar}
        </aside>
      )}

      {hint && (
        <div key={hint.key} className={`arm-note${hint.bad ? ' is-bad' : ''}`} role="status">
          {hint.text}
        </div>
      )}

      {asking && b && (
        <Modal title={t('books.replaceTitle')} sheet width={220} onClose={() => setAsking(false)}>
          <div className="bkx-replace">
            <p>{t('books.replacePick')}</p>
            <div className="bkx-replace__chips" role="group" aria-label={t('books.replacePick')}>
              {onPick
                .filter((e) => e.id !== b.id)
                .map((e, i) => {
                  const l = p.ench[e.id];
                  return (
                    <span key={e.id} className="bkx-replace__chip">
                      <Slot
                        rarity={rarityOfLevel(l)}
                        selected={replace === e.id}
                        count={ROMAN[l - 1]}
                        aria-label={`${bookName({ id: e.id, lvl: l })} · ${effectOf(e.id, l, p.pickStars)}`}
                        tip={<BookTip book={{ id: e.id, lvl: l }} stars={p.pickStars} />}
                        data-autofocus={i === 0 ? '' : undefined}
                        onClick={() => {
                          selectionChanged();
                          setReplace(e.id);
                        }}
                      >
                        <GxIcon name={ENCH_ICON[e.id]} size={u * 13} />
                      </Slot>
                      <span className="bkx-replace__fx arm-num">{plus(e.id, l, p.pickStars)}</span>
                    </span>
                  );
                })}
            </div>
            <Button
              kind="confirm"
              wide
              off={!replace}
              className={replace ? undefined : 'px-dark'}
              onClick={() => {
                if (!replace) {
                  uiError();
                  notifyWarning();
                  return;
                }
                doApply(replace);
              }}
            >
              {replace ? t('books.apply', { v: chance }) : t('books.replaceFirst')}
            </Button>
          </div>
        </Modal>
      )}

      {scene &&
        createPortal(
          scene.kind === 'apply' ? (
            <ApplyScene scene={scene} pick={p.pickMax} onDone={() => setScene(null)} />
          ) : (
            <RevealScene
              scene={scene}
              onDone={() => {
                setFresh(scene.book);
                const i = useFinanceStore.getState().prison.books.indexOf(scene.book);
                if (i >= 0) select({ k: 'book', i });
                setScene(null);
              }}
            />
          ),
          document.body,
        )}
    </div>
  );
  return win ? createPortal(body, document.body) : body;
}

/** Tooltip of a book cell: effect, chance, and the same enchant in the pick (green / red). */
function BookTip({
  book,
  stars,
  have,
}: {
  book: Book | Pick<Book, 'id' | 'lvl'>;
  stars: number;
  have?: number;
}): ReactNode {
  const t = useT();
  const r = rarityOfLevel(book.lvl);
  const chance = 'chance' in book ? book.chance : undefined;
  return (
    <span className="arm-tip" style={rarityVars(r)}>
      <b>{bookName(book)}</b>
      <span className={`rchip r${r}`}>{bookTierBook(tierOfLevel(book.lvl))}</span>
      <span className="arm-tip__row">{effectOf(book.id, book.lvl, stars)}</span>
      {chance !== undefined && (
        <span className="arm-tip__row">{t('books.chance', { v: chance })}</span>
      )}
      {have !== undefined && (
        <span className="arm-tip__row">
          {have > 0 ? (
            <>
              {t('books.inPickHead')}: {ROMAN[have - 1]} <Delta v={book.lvl - have} />
            </>
          ) : (
            t('books.notInPick')
          )}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Чародей: портрет над ярусами. Лица нет — капюшон, светятся глаза (так он
// же будет выглядеть спрайтом во дворе, см. CLAUDE.md «План двора»).
// ---------------------------------------------------------------------------

/**
 * Реплики Чародея — одна строка, тап по портрету даёт следующую. Это его
 * голос, а не подсказка интерфейса: механику книг он рассказывает сам.
 * UI v2: the line sits beside the portrait (kit text), not on it.
 */
function MageCard({ poor }: { poor: boolean }) {
  const t = useT();
  const [k, setK] = useState(0);
  const line =
    poor && k === 0 ? t('books.magePoor') : mageLine((poor ? k - 1 : k) % MAGE_LINES.length);
  return (
    <div className="bkx-mage">
      <button
        type="button"
        className="pbk-mage px-f"
        aria-label={t('books.mageName')}
        onClick={() => {
          primeAudio();
          softChime(1);
          tapLight();
          setK(k + 1);
        }}
      >
        <img src="/ui/books/enchanter.webp" alt="" draggable={false} />
        <i className="pbk-mage__eye is-l" aria-hidden="true" />
        <i className="pbk-mage__eye is-r" aria-hidden="true" />
        <i className="pbk-mage__lid is-l" aria-hidden="true" />
        <i className="pbk-mage__lid is-r" aria-hidden="true" />
        <i className="pbk-mage__fire is-l" aria-hidden="true" />
        <i className="pbk-mage__fire is-r" aria-hidden="true" />
        {k > 0 && <i key={k} className="pbk-mage__flare" aria-hidden="true" />}
      </button>
      <p key={k} className="bkx-mage__say">
        {line}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Сцены.
// ---------------------------------------------------------------------------

/**
 * Покупка у Чародея и наковальня. Книга — полоса `reveal-<ярус>`: падает,
 * вращаясь, садится, щёлкает застёжка, раскрывается, свет из страниц; на
 * метке `peak` над разворотом зажигается знак чары, на `close` он уходит в
 * страницы, последний кадр — книга в покое (её сменяет `BookArt` кадр в кадр).
 * На наковальне сперва сходятся две книги-источника под удары молота.
 */
function RevealScene({
  scene,
  onDone,
}: {
  scene: Extract<Scene, { kind: 'buy' | 'anvil' }>;
  onDone: () => void;
}) {
  const tx = useT();
  const b = scene.book;
  const t = tierOfLevel(b.lvl);
  const r = rarityOfLevel(b.lvl);
  const strip = `reveal-${t}`;
  const slow = b.lvl >= 7;
  const [phase, setPhase] = useState<'build' | 'play' | 'show'>(() =>
    reduceMotion() ? 'show' : scene.kind === 'anvil' ? 'build' : 'play',
  );
  const [sigil, setSigil] = useState<'' | 'up' | 'sink'>('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const p = useFinanceStore((s) => s.prison);
  useFullWin(true, true);

  useEffect(() => registerEscape(() => doneRef.current()), []);

  const show = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSigil('');
    setPhase('show');
  };
  // Тап до конца — сразу итог, со звуком исхода.
  const skip = () => {
    forgeReveal(r);
    notifySuccess();
    show();
  };

  useEffect(() => {
    if (reduceMotion()) {
      forgeReveal(r);
      return undefined;
    }
    void preloadPx('books', strip, REVEAL_SIZE);
    if (scene.kind !== 'anvil') return undefined;
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    // A simple or rare merge is everyday work: three quick strikes, the flash and the book — under
    // 1.5 s (critic: ~4 s for every merge). Epic and legend keep the full reveal strip.
    const quick = t === 'simple' || t === 'rare';
    const beats = slow ? 5 : 3;
    const step = quick ? 260 : 360;
    for (let k = 0; k < beats; k++)
      at(k * step, () => {
        forgeStrike(k);
        tapLight();
      });
    at(beats * step + 80, () => {
      flashFrame(slow ? 'mega' : 'big');
      if (!quick) {
        setPhase('play');
        return;
      }
      forgeReveal(r);
      notifySuccess();
      show();
    });
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMark = (m: string) => {
    if (m === 'land') {
      chestLand();
      tapMedium();
    } else if (m === 'snap') {
      chestLatch();
      tapLight();
    } else if (m === 'open') {
      chestOpen();
    } else if (m === 'peak') {
      setSigil('up');
      forgeReveal(r);
      notifySuccess();
      flashFrame(r >= 4 ? 'mega' : r >= 2 ? 'big' : 'small');
      if (r >= 3) burstConfetti(30 + 20 * r, [rarityOf(r).color, rarityOf(r).light, '#ffffff']);
    } else if (m === 'close') {
      setSigil('sink');
    } else if (m === 'lock') {
      softChime(Math.min(4, r));
      tapLight();
    }
  };

  const fo = pxFitOf('books', strip, REVEAL_SIZE);
  const rise = bookAnchor(strip, REVEAL_SIZE, 'rise');
  const meta = fo?.st;
  // Знак уходит в разворот за время от `close` до `lock`.
  const sinkMs = meta?.marks ? ((meta.marks.lock - meta.marks.close) / meta.fps) * 1000 : 400;
  const shown = phase === 'show';
  return (
    <div
      className={`pbks arm-scn px is-${phase} is-${scene.kind}${slow ? ' is-slow' : ''}${sigil === 'up' ? ' is-peak' : ''}${shown ? ' is-lit' : ''}`}
      style={rarityVars(r)}
      data-ui-layer=""
      onClick={() => {
        if (!shown) skip();
        else {
          tapLight();
          onDone();
        }
      }}
    >
      <div className="arm-scn__card">
        <div className="pbks__stage">
          <i className="pbks__burst" aria-hidden="true" />
          {phase === 'build' && scene.kind === 'anvil' && (
            <div className="pbks__pair">
              <span className="is-l">
                <BookArt book={scene.from} size={120} />
              </span>
              <span className="is-r">
                <BookArt book={scene.from} size={120} />
              </span>
            </div>
          )}
          {phase === 'play' && (
            <span className="pbks__px" style={{ width: REVEAL_SIZE, height: REVEAL_SIZE }}>
              <PxStrip
                set="books"
                name={strip}
                size={REVEAL_SIZE}
                mode="once"
                onMark={onMark}
                onEnd={show}
              />
              {sigil && rise && (
                <span
                  className={`pbks__sigil t-${t} is-${sigil}`}
                  style={
                    {
                      left: rise[0],
                      top: rise[1],
                      '--sink-y': `${Math.round(REVEAL_SIZE * 0.2)}px`,
                      '--sink-ms': `${Math.round(sinkMs)}ms`,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <BookGlyph book={b} />
                </span>
              )}
            </span>
          )}
          {shown && (
            <span className="pbks__book">
              <BookArt book={b} size={REVEAL_SIZE} glow />
            </span>
          )}
        </div>
        {/* Подпись занимает место с первого кадра: иначе на смене полосы книга прыгнула бы вверх. */}
        <div className={`pbks__text arm-scn__text${shown ? '' : ' is-wait'}`} aria-hidden={!shown}>
          <RarityName rarity={r}>{bookName(b)}</RarityName>
          <span className="arm-scn__line">{effectOf(b.id, b.lvl, p.pickStars)}</span>
          <span className={`pbks__ch is-${chanceTone(b.chance)}`}>
            {tx('books.chance', { v: b.chance })}
          </span>
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
            {tx('books.toShelf')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Вписывание: книга над киркой, стрелка бежит по кругу и встаёт — в
 * зелёном секторе (он ровно `chance` процентов круга) или в красном.
 * Исход уже записан стором; сцена только показывает его честно: угол
 * остановки берётся внутри нужного сектора. Потом полоса книги: удача —
 * `apply-ok-<ярус>` (раскрылась, листы светом летят в кирку: якорь `to`,
 * метка `hit`), сгорела — `apply-burn-<ярус>` (огонь с краёв, пепел).
 */
function ApplyScene({
  scene,
  pick,
  onDone,
}: {
  scene: Extract<Scene, { kind: 'apply' }>;
  pick: number;
  onDone: () => void;
}) {
  const tx = useT();
  const b = scene.book;
  const t = tierOfLevel(b.lvl);
  const r = rarityOfLevel(b.lvl);
  const strip = `${scene.ok ? 'apply-ok' : 'apply-burn'}-${t}`;
  const [phase, setPhase] = useState<'spin' | 'ok' | 'fail'>(() =>
    reduceMotion() ? (scene.ok ? 'ok' : 'fail') : 'spin',
  );
  // Удача: лучи дошли до кирки. Сгорела: книга рассыпалась. Тогда же — подпись.
  const [hit, setHit] = useState(() => reduceMotion());
  const [ended, setEnded] = useState(() => reduceMotion());
  const needle = useRef<HTMLSpanElement>(null);
  useFullWin(true, true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const anim = useRef<Animation | null>(null);
  const hitRef = useRef(hit);
  hitRef.current = hit;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const p = useFinanceStore((s) => s.prison);
  // Угол остановки: внутри зелёного сектора при удаче, внутри красного — нет.
  // Не у самой границы — иначе «чуть-чуть не хватило» читалось бы подкруткой.
  const [stopAt] = useState(() => {
    const c = Math.max(1, Math.min(99, scene.chance));
    const u = 0.12 + Math.random() * 0.76;
    const deg = scene.ok ? u * c * 3.6 : (c + u * (100 - c)) * 3.6;
    return scene.chance >= 100 ? 0.5 * 360 * u : deg;
  });

  useEffect(() => registerEscape(() => doneRef.current()), []);

  const land = () => {
    if (hitRef.current) return;
    hitRef.current = true;
    setHit(true);
    if (scene.ok) {
      tierBreak(r >= 3 ? 2 : 1);
      forgeReveal(r);
      flashFrame(r >= 4 ? 'mega' : 'big');
      notifySuccess();
      burstConfetti(40 + 15 * r, [rarityOf(r).color, rarityOf(r).light, '#ffffff']);
    } else softThud(0.4);
  };

  const settle = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    anim.current?.finish();
    if (scene.ok) {
      setPhase('ok');
      softChime(1);
    } else {
      setPhase('fail');
      riskLose();
      notifyWarning();
    }
  };

  useEffect(() => {
    if (reduceMotion()) {
      if (scene.ok) forgeReveal(r);
      else riskLose();
      return undefined;
    }
    void preloadPx('books', strip, APPLY_SIZE);
    const total = 2 * 360 + stopAt;
    const dur = 1700;
    try {
      anim.current =
        needle.current?.animate(
          [{ transform: 'rotate(0deg)' }, { transform: `rotate(${total}deg)` }],
          { duration: dur, easing: 'cubic-bezier(.12,.62,.24,1)', fill: 'forwards' },
        ) ?? null;
    } catch {
      /* без анимации — сразу исход */
    }
    // Щелчки редеют вместе со скоростью стрелки.
    for (let k = 0; k < 12; k++) {
      const t = dur * (1 - Math.pow(1 - k / 12, 0.45));
      timers.current.push(setTimeout(() => caseTick(), t));
    }
    timers.current.push(setTimeout(settle, dur + 120));
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMark = (m: string) => {
    if (m === 'open') chestOpen();
    else if (m === 'ignite') tapMedium();
    else if (m === 'hit' || m === 'crumble') land();
  };
  const finish = () => {
    land();
    setEnded(true);
  };

  // Кирка встаёт так, чтобы точка `to` (куда бьют лучи) пришлась на её верхнюю треть.
  const to = bookAnchor(`apply-ok-${t}`, APPLY_SIZE, 'to');
  const pickTop = to ? APPLY_TOP + to[1] - PICK_SIZE * 0.36 : undefined;
  const c = Math.max(0, Math.min(100, scene.chance));
  const told = phase !== 'spin' && hit;
  return (
    <div
      className={`pbka arm-scn px is-${phase}${hit ? ' is-hit' : ''}${told ? ' is-lit' : ''}`}
      style={{ ...rarityVars(r), '--ch': `${c}%` } as CSSProperties}
      data-ui-layer=""
      onClick={() => {
        if (phase === 'spin') settle();
        else if (!ended) finish();
        else {
          tapLight();
          onDone();
        }
      }}
    >
      <div className="arm-scn__card">
        <div className="pbka__stage">
          <i className="pbks__burst" aria-hidden="true" />
          <span className="pbka__dial" aria-hidden="true">
            <span
              className="pbka__needle"
              ref={needle}
              style={phase === 'spin' ? undefined : { transform: `rotate(${stopAt}deg)` }}
            />
          </span>
          <span className="pbka__pick" style={{ top: pickTop }}>
            <PickArt pick={pick} size={PICK_SIZE} fx={phase === 'ok' && hit} />
          </span>
          <span
            className="pbka__book"
            style={{ top: APPLY_TOP, width: APPLY_SIZE, height: APPLY_SIZE }}
          >
            {phase === 'spin' ? (
              <BookArt book={b} size={APPLY_SIZE} glow />
            ) : (
              !ended && (
                <>
                  <PxStrip
                    set="books"
                    name={strip}
                    size={APPLY_SIZE}
                    mode="once"
                    onMark={onMark}
                    onEnd={finish}
                  />
                  <BookLift book={b} size={APPLY_SIZE} burn={!scene.ok} />
                </>
              )
            )}
          </span>
        </div>
        <div className="pbka__text arm-scn__text">
          {phase === 'spin' && <b className="pbka__odds px-dark">{tx('books.pct', { v: c })}</b>}
          {told && phase === 'ok' && (
            <>
              <RarityName rarity={r}>{tx('books.applied', { name: bookName(b) })}</RarityName>
              <span className="arm-scn__line">{effectOf(b.id, b.lvl, p.pickStars)}</span>
              {scene.replaced && (
                <span className="arm-scn__line">
                  {tx('books.crumbled', { name: enchantName(scene.replaced) })}
                </span>
              )}
            </>
          )}
          {told && phase === 'fail' && (
            <>
              <b className="pbka__lost">{tx('books.burned')}</b>
              <span className="arm-scn__line">{tx('books.burnedSub')}</span>
            </>
          )}
          {/* Rendered from the first frame, hidden: the button never pushes the card. */}
          <Button
            kind="primary"
            className={`arm-scn__cta${told ? '' : ' is-wait'}`}
            data-autofocus=""
            aria-hidden={!told}
            onClick={(e) => {
              e.stopPropagation();
              if (!told) return;
              tapLight();
              onDone();
            }}
          >
            {tx('books.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Сцена вписывания: книга над киркой (верх рамки книги в сцене), сторона рамки кирки. */
const APPLY_TOP = 42;
const PICK_SIZE = 132;

/**
 * Знак чары в начале полосы вписывания: стоит в медальоне покоя и уходит —
 * вверх светом (удача) или темнеет и гаснет (сгорела). Дальше книгу ведёт полоса.
 */
function BookLift({
  book,
  size,
  burn,
}: {
  book: Pick<Book, 'id' | 'lvl'>;
  size: number;
  burn: boolean;
}) {
  const t = tierOfLevel(book.lvl);
  const gs = glyphStyle(`still-${t}`, size);
  if (!gs) return null;
  return (
    <span className={`pbook pbook--lift t-${t}${burn ? ' is-burn' : ''}`}>
      <span className="pbook__bob">
        <span className="pbook__emboss" style={gs}>
          <BookGlyph book={book} />
        </span>
      </span>
    </span>
  );
}
