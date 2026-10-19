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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import './books.css';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { PickArt, PickPx, RarityName, rarityVars } from '@/components/PickArt';
import {
  fromKeys,
  useArmGuard,
  useArmLayout,
  useFirstFrame,
  useFullWin,
} from '@/components/armory';
import { preloadPx, PxStrip, pxFitOf } from '@/components/PxStrip';
import { propFit } from '@/lib/props-pixel/fit';
import { TokenIcon } from '@/components/camp-art';
import { useFinanceStore } from '@/store';
import { enchantName, fmtNum, fmtShort, rich, useT } from '@/i18n';
import {
  bookName,
  bookTierBook,
  bookTierName,
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
import { Button, Icon } from '@/ui-px';
import { PxdButton, PxdPips, PxdSheet, PxdSocket, usePxd } from '@/ui-px/dark';

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

/** Green «+2» / muted «−1» beside a number. */
function Delta({ v }: { v: number }) {
  if (!v) return null;
  return <em className={v > 0 ? 'is-up' : 'is-down'}>{v > 0 ? `+${v}` : `−${-v}`}</em>;
}

/** «+252 %» — the effect of enchant `id` at level `lvl` as one number (tr «+%252»). */
function usePlusPct() {
  const t = useT();
  return (id: EnchantId, lvl: number, stars: number) =>
    `+${t('books.pct', { v: enchantPct(id, enchUnits(id, lvl, stars)) })}`;
}

/**
 * The biggest art size ≤ `max` CSS px that a strip of box 48 (large 112: books and picks) shows
 * pixel-exact — whole device pixels per art pixel, as `PxStrip` will snap it.
 */
function artPx(max: number): number {
  if (!(max > 0)) return 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  let best = 0;
  for (const [box, k0] of [
    [BOOK_BOX, 1],
    [112, 2],
  ] as const)
    for (let k = k0; (k * box) / dpr <= max + 0.01; k++) {
      const s = (k * box) / dpr;
      if (Math.abs(propFit(s, BOOK_BOX, 112, dpr).s - s) < 0.01) best = Math.max(best, s);
    }
  return best || Math.floor(max);
}

/** Content box of `ref`, re-measured when `key` changes (the element may be a new one then). */
function useMeasure(ref: RefObject<HTMLElement | null>, key: string) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const put = (w: number, h: number) =>
      setBox((b) =>
        b.w === Math.floor(w) && b.h === Math.floor(h) ? b : { w: Math.floor(w), h: Math.floor(h) },
      );
    const cs = getComputedStyle(el);
    const px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0;
    put(
      el.clientWidth - px('padding-left') - px('padding-right'),
      el.clientHeight - px('padding-top') - px('padding-bottom'),
    );
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => put(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, key]);
  return box;
}

type Tab = 'pick' | 'shelf' | 'mage';
const TABS: readonly Tab[] = ['pick', 'shelf', 'mage'];
/** On the «В кирке» tab: an enchant in the pick, a free place or the locked places. */
type SlotSel = EnchantId | 'free' | 'lock';

/** One place of the bottom bar: two squares and the main button. */
interface Act {
  id: string;
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  off?: boolean;
  hide?: boolean;
  armed?: boolean;
  aria?: string;
  run?: () => void;
}

/**
 * The books (owner 19.10, the ChatGPT handoff LAYOUT on the dark kit — the forge's sibling):
 * header «Книги» + purpose + tokens / dust; tabs «В кирке» / «Полка» / «Чародей»; tab 1 = a compact
 * card of the pick (level, blocks left, stars, a local reforge) + its places as square tiles +
 * the card of the chosen one; tab 2 = the owned books + the card of the chosen one; tab 3 = a small
 * Enchanter + four offers 2 × 2. A bar of three fixed places at the bottom. With `onClose` a
 * full-screen window (the mine dock, the forge's «Чары ›», the square's mage); without it a tab of
 * a camp.
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
  usePxd();
  useFullWin(win);
  const painted = useFirstFrame(); // the shelf grid comes a frame after the window

  const slots = enchSlots(p);
  const pk = PICKS[p.pickMax];
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0);
  const free = Math.max(0, slots - onPick.length);
  const locked = Math.max(0, 7 - slots);
  const full = p.books.length >= SHELF_MAX;
  const lvl = pickLevelOf(p.pickXp);
  const starMax = p.pickStars >= PICK_STARS_MAX;
  const starReady = lvl.level >= PICK_LEVEL_MAX && !starMax;
  const fits = p.books.filter((x) => canApply(p.ench, slots, x) === 'ok').length;
  const cheapest = BOOK_TIERS[0].price;

  const [tab, setTab] = useState<Tab>('pick');
  const [slotSel, setSlotSel] = useState<SlotSel>(() =>
    onPick.length ? onPick[0].id : free > 0 ? 'free' : 'lock',
  );
  const [bookI, setBookI] = useState(0);
  const [tierSel, setTierSel] = useState<BookTier>(() => {
    const ok = BOOK_TIERS.filter((x) => p.tokens >= x.price);
    return ok.length ? ok[ok.length - 1].id : BOOK_TIERS[0].id;
  });
  const [scene, setScene] = useState<Scene | null>(null);
  const [hint, setHint] = useState<{ text: string; key: number; bad?: boolean; ms: number } | null>(
    null,
  );
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
  const [mageK, setMageK] = useState(0);

  const say = (text: string, bad = false, ms = 2600) =>
    setHint({ text, key: Date.now(), bad, ms });
  useEffect(() => {
    if (!hint) return undefined;
    const id = setTimeout(() => setHint(null), hint.ms);
    return () => clearTimeout(id);
  }, [hint]);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(id);
  }, [armed]);

  // The selection survives the shelf / the pick changing under it: a book index past the end
  // falls back to the last book (after «в пыль» the next one slides into the same place), a wiped
  // enchant to the place it freed.
  let sid: SlotSel = slotSel;
  if (sid !== 'free' && sid !== 'lock' && !(p.ench[sid] > 0))
    sid = free > 0 ? 'free' : onPick.length ? onPick[0].id : 'lock';
  if (sid === 'free' && free <= 0) sid = onPick.length ? onPick[0].id : 'lock';
  if (sid === 'lock' && locked <= 0) sid = onPick.length ? onPick[0].id : 'free';
  const bi = p.books.length ? Math.min(bookI, p.books.length - 1) : -1;
  const b = bi >= 0 ? p.books[bi] : undefined;
  const bt = bookTierOf(tierSel);

  const resetArm = () => {
    setArmed(null);
    setDustOn(true);
    setReplace(null);
  };
  const switchTab = (to: Tab) => {
    if (to === tab) return;
    selectionChanged();
    setTab(to);
    resetArm();
  };
  const pickSlot = (s: SlotSel) => {
    if (s === sid) return false;
    selectionChanged();
    setSlotSel(s);
    resetArm();
    return true;
  };
  const pickBook = (i: number) => {
    if (i === bi) return false;
    selectionChanged();
    setBookI(i);
    resetArm();
    return true;
  };
  const pickTier = (id: BookTier) => {
    if (id === tierSel) return false;
    selectionChanged();
    setTierSel(id);
    resetArm();
    return true;
  };

  // ---- Book on the card -------------------------------------------------------------------------
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
      say(t('books.wipeArmed', { n: dustOf({ lvl: p.ench[id] }) }), false, 5000);
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
      // what the reforge does, before the confirming tap (the handoff: «пояснение результата»)
      say(
        t('books.starText', {
          cap: Math.round(STAR_CAP * 100),
          dmg: Math.round(STAR_DMG * 100),
          tokens: fmt(STAR_TOKENS * (p.pickStars + 1)),
          keys: STAR_KEYS,
        }),
        false,
        5000,
      );
      return;
    }
    if (guard.tooSoon()) return;
    setArmed(null);
    setHint(null);
    if (!prisonPickStar()) {
      notifyWarning();
      return;
    }
    tierBreak(3);
    burstConfetti(80, ['#ffe08a', '#ffffff', '#b8f4e6']);
    flashFrame('big');
    notifySuccess();
  };
  /** Dust raises the chance: on by default, the chance cell toggles it. */
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
  /** The way to a new book: the shelf when one fits the pick, else the Enchanter. */
  const toBooks = () => {
    tapLight();
    if (p.books.length) {
      const i = p.books.findIndex((x) => canApply(p.ench, slots, x) === 'ok');
      if (i >= 0) setBookI(i);
      switchTab('shelf');
    } else switchTab('mage');
  };

  // ---- Measured sizes: art in whole device pixels per art pixel ---------------------------------
  const cardArtRef = useRef<HTMLSpanElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const offersRef = useRef<HTMLDivElement>(null);
  const cardBox = useMeasure(cardArtRef, `${tab}:${layout}`);
  const slotsBox = useMeasure(slotsRef, `${tab}:${layout}`);
  const gridBox = useMeasure(gridRef, `${tab}:${layout}:${p.books.length > 0}`);
  const offersBox = useMeasure(offersRef, `${tab}:${layout}`);
  const gap = 3 * u;
  const ring = 3 * u; // a tile's frame ring + one art pixel of air
  const slotN = slots + (locked > 0 ? 1 : 0);
  const slotTile = slotsBox.w
    ? Math.min(40 * u, (slotsBox.w - (slotN - 1) * gap) / Math.max(1, slotN))
    : 0;
  const slotArt = artPx(slotTile - 2 * ring);
  const cols = gridBox.w ? Math.max(4, Math.floor((gridBox.w + gap) / (28 * u + gap))) : 5;
  const gridTile = gridBox.w ? (gridBox.w - (cols - 1) * gap) / cols : 0;
  const gridArt = artPx(gridTile - 2 * ring);
  const cardArt = artPx(Math.min(cardBox.w, cardBox.h, 112 * u));
  // an offer: 2 × 2 cells; its art beside the price lines, or over them when the cell is tall
  const offW = (offersBox.w - gap) / 2 - 6 * u;
  const offH = (offersBox.h - gap) / 2 - 4 * u;
  const lineH = 11 * u; // one text row of the offer
  const offStack = offersBox.h > 0 && offH - 4 * lineH >= 40 * u;
  const offerArt = !offersBox.w
    ? 0
    : offStack
      ? artPx(Math.min(64 * u, offW, offH - 4 * lineH - 4 * u))
      : artPx(Math.min(40 * u, offW * 0.45, offH - 2 * lineH));
  const pickIco = artPx(24 * u);

  // ---- The card: what is chosen on this tab ---------------------------------------------------
  let cKind = 'none';
  let cRar = 0;
  let cArt: ReactNode = null;
  let cName: ReactNode = '';
  let cState: ReactNode = null;
  let cFx: ReactNode = '';
  let cFacts: ReactNode = null;
  const fact = (
    key: string,
    num: ReactNode,
    label: ReactNode,
    extra?: { cls?: string; aria?: string; on?: boolean; run?: () => void },
  ) =>
    extra?.run ? (
      <PxdButton
        key={key}
        frame="well"
        className={`bks-fact is-btn${extra.cls ? ` ${extra.cls}` : ''}`}
        aria-label={extra.aria}
        aria-pressed={extra.on}
        onClick={extra.run}
      >
        <b>{num}</b>
        <i>{label}</i>
      </PxdButton>
    ) : (
      <span key={key} className={`bks-fact pxd-f pxd-f--well${extra?.cls ? ` ${extra.cls}` : ''}`}>
        <b>{num}</b>
        <i>{label}</i>
      </span>
    );
  const factsOf = (cells: ReactNode[]) => <div className="bks-facts">{cells}</div>;

  if (tab === 'shelf' && b) {
    const tier = tierOfLevel(b.lvl);
    const canDust = need > 0 && check !== 'lower';
    const shown = check === 'lower' ? b.chance : chance;
    cKind = 'book';
    cRar = TIER_RARITY[tier];
    cArt = <BookArt key={`${bi}-${b.id}-${b.lvl}`} book={b} size={cardArt} glow />;
    cName = bookName(b);
    cState = (
      <span className={`bks-state is-${check}`}>
        {check === 'ok' && <Icon name="up" />}
        {check === 'lower' && <Icon name="down" />}
        {check === 'full' && <Icon name="excl" />}
        {check === 'ok'
          ? t('books.canApply')
          : check === 'lower'
            ? t('books.weaker')
            : t('books.noRoomShort')}
      </span>
    );
    cFx = effectOf(b.id, b.lvl, p.pickStars);
    cFacts = factsOf([
      fact(
        'chance',
        <>
          {t('books.pct', { v: shown })}
          {canDust && (
            <small className={dustOn && p.dust > 0 ? 'is-on' : undefined}>
              <DustIcon size={u * 6} />
              {p.dust > 0 ? `+${Math.min(p.dust, need)}` : '0'}
            </small>
          )}
        </>,
        t('books.statChance'),
        {
          cls: `is-${chanceTone(shown)}`,
          on: canDust ? dustOn && p.dust > 0 : undefined,
          aria: !canDust
            ? t('books.chance', { v: shown })
            : p.dust <= 0
              ? t('books.noDust')
              : dustOn
                ? t('books.dustOn', { n: dust })
                : t('books.dustOff', { n: Math.min(p.dust, need) }),
          run: canDust ? toggleDust : undefined,
        },
      ),
      fact(
        'lvl',
        <>
          {ROMAN[b.lvl - 1]}
          {inPick > 0 && <Delta v={b.lvl - inPick} />}
        </>,
        t('books.statLevel'),
      ),
      fact(
        'dust',
        <>
          <DustIcon size={u * 7} />
          {dustOf(b)}
        </>,
        t('books.statDust'),
      ),
    ]);
  } else if (tab === 'shelf') {
    cKind = 'empty';
    cArt = <BookArt key="empty" tier="simple" size={cardArt} />;
    cName = t('books.emptyTitle');
    cState = <span className="bks-state">{t('books.emptyText')}</span>;
  } else if (tab === 'mage') {
    cKind = 'tier';
    cRar = TIER_RARITY[bt.id];
    const can = p.tokens >= bt.price && !full;
    cArt = <BookArt key={`t-${bt.id}`} tier={bt.id} size={cardArt} glow={can} />;
    cName = bookTierBook(bt.id);
    cState = <span className="bks-state">{t('books.unknown')}</span>;
    cFx = t('books.toShelfNote');
    cFacts = factsOf([
      fact(
        'price',
        <>
          <TokenIcon size={u * 7} />
          {fmtShort(bt.price)}
        </>,
        t('books.statPrice'),
        { cls: p.tokens < bt.price ? 'is-lo' : undefined },
      ),
      fact(
        'lvl',
        `${ROMAN[bt.lvl[0] - 1]}–${ROMAN[bt.lvl[1] - 1]}`,
        t('books.statLevel'),
      ),
      fact('chance', t('books.pctRange', { a: bt.chance[0], b: bt.chance[1] }), t('books.statChance')),
    ]);
  } else if (sid === 'free') {
    cKind = 'free';
    cArt = (
      <span className="bks-card__sock">
        <PxdSocket d={20} />
      </span>
    );
    cName = t('books.freeTitle');
    cState = (
      <span className="bks-state">
        {fits > 0 ? t('books.freeFits', { n: fits }) : t('books.freeNone')}
      </span>
    );
  } else if (sid === 'lock') {
    cKind = 'lock';
    const next = rarityOf(slots);
    cArt = (
      <span className="bks-card__sock is-lock">
        <Icon name="lock" />
      </span>
    );
    cName = t('books.lockedN', { n: locked });
    cState = (
      <span className="bks-state">{t('books.lockedBy', { pick: rarityPick(next.id) })}</span>
    );
    cFx = t('books.perStep');
  } else {
    const id = sid;
    const l = p.ench[id];
    const off = p.off.includes(id);
    cKind = 'slot';
    cRar = rarityOfLevel(l);
    cArt = <BookArt key={`s-${id}-${l}`} book={{ id, lvl: l }} size={cardArt} glow={!off} />;
    cName = bookName({ id, lvl: l });
    cState = (
      <span className={`bks-state ${off ? 'is-off' : 'is-ok'}`}>
        <Icon name={off ? 'zzz' : 'check'} />
        {off ? `${t('books.inPickNow')} · ${t('books.offState')}` : t('books.inPickNow')}
      </span>
    );
    cFx = effectOf(id, l, p.pickStars);
    cFacts = factsOf([
      fact('lvl', ROMAN[l - 1], t('books.statLevel')),
      fact(
        'state',
        off ? t('common.off') : t('common.on'),
        t('books.statState'),
        { cls: off ? 'is-lo' : 'is-hi' },
      ),
      fact(
        'dust',
        <>
          <DustIcon size={u * 7} />
          {dustOf({ lvl: l })}
        </>,
        t('books.statDust'),
      ),
    ]);
  }

  // ---- The bar: two squares + the main button, the same three places on every tab --------------
  const sq: [Act, Act] = [
    { id: 'a', label: '·', hide: true },
    { id: 'b', label: '·', hide: true },
  ];
  let go: Act = { id: 'go', label: '·', hide: true };
  const toBooksAct: Act = {
    id: 'to',
    icon: <GxIcon name={fits > 0 || p.books.length ? 'book' : 'hood'} />,
    label: fits > 0 || p.books.length ? t('books.toShelf') : t('books.toMage'),
    sub:
      fits > 0
        ? t('books.fitsN', { n: fits })
        : p.books.length
          ? t('books.booksN', { n: p.books.length })
          : t('books.fromPrice', { n: fmt(cheapest) }),
    run: toBooks,
  };
  if (tab === 'pick') {
    go = toBooksAct;
    if (cKind === 'slot' && sid !== 'free' && sid !== 'lock') {
      const id = sid;
      const l = p.ench[id];
      const off = p.off.includes(id);
      sq[0] = {
        id: 'wipe',
        icon: <DustIcon size={u * 9} />,
        label: armed === 'wipe' ? t('books.sure') : t('books.wipeBare'),
        sub: `+${dustOf({ lvl: l })}`,
        armed: armed === 'wipe',
        aria: t('books.wipeBtn', { n: dustOf({ lvl: l }) }),
        run: () => doWipe(id),
      };
      sq[1] = {
        id: 'toggle',
        icon: <Icon name={off ? 'check' : 'zzz'} />,
        label: off ? t('common.on') : t('common.off'),
        aria: off ? t('books.toggleOn') : t('books.toggleOff'),
        hide: !ENCHANT_TOGGLE.includes(id),
        run: () => {
          selectionChanged();
          toggle(id);
        },
      };
    }
  } else if (tab === 'shelf') {
    if (b) {
      sq[0] = {
        id: 'salvage',
        icon: <DustIcon size={u * 9} />,
        label: armed === 'salvage' ? t('books.sure') : t('books.statDust'),
        sub: `+${dustOf(b)}`,
        armed: armed === 'salvage',
        aria: t('books.salvage', { n: dustOf(b) }),
        run: doSalvage,
      };
      sq[1] = {
        id: 'anvil',
        icon: <GxIcon name="anvil" />,
        label: t('books.glueShort'),
        sub: `→ ${ROMAN[Math.min(b.lvl, ROMAN.length - 1)]}`,
        aria: t('books.glue', { lvl: ROMAN[Math.min(b.lvl, ROMAN.length - 1)] }),
        hide: mate < 0,
        run: doAnvil,
      };
      go = {
        id: 'apply',
        icon: <GxIcon name="sparkles" />,
        label: t('books.applyBare'),
        sub:
          check === 'lower'
            ? t('books.weaker')
            : check === 'full'
              ? t('books.applyFull', { v: chance })
              : t('books.chance', { v: chance }),
        off: check === 'lower',
        run: () => doApply(),
      };
    } else
      go = {
        ...toBooksAct,
        icon: <GxIcon name="hood" />,
        label: t('books.toMage'),
        sub: t('books.fromPrice', { n: fmt(cheapest) }),
      };
  } else {
    const can = p.tokens >= bt.price && !full;
    sq[0] = {
      id: 'shelf',
      icon: <GxIcon name="book" />,
      label: t('books.shelf'),
      sub: `${p.books.length}/${SHELF_MAX}`,
      run: () => switchTab('shelf'),
    };
    go = {
      id: 'buy',
      icon: <TokenIcon size={u * 11} />,
      label: t('books.buy'),
      sub: full
        ? t('books.shelfFullShort')
        : p.tokens < bt.price
          ? t('books.lack', { n: fmt(bt.price - p.tokens) })
          : fmt(bt.price),
      off: !can,
      run: () => onBuy(bt.id),
    };
  }

  // X / pad Y — the main button.
  useAction(['inspect'], () => go.run?.(), { scope: root, enabled: !go.hide && !go.off });
  useAction(
    ['tabPrev', 'tabNext'],
    (e) => {
      const i = TABS.indexOf(tab);
      switchTab(TABS[(i + (e.action === 'tabNext' ? 1 : TABS.length - 1)) % TABS.length]);
    },
    { scope: root },
  );

  const sqBtn = (a: Act) => (
    <PxdButton
      key={a.id}
      className={`bks-sq${a.hide ? ' is-hidden' : ''}${a.armed ? ' is-armed' : ''}`}
      off={a.off}
      aria-label={a.aria}
      aria-hidden={a.hide || undefined}
      tabIndex={a.hide ? -1 : undefined}
      onClick={a.hide ? undefined : a.run}
    >
      <span className="bks-sq__i">{a.icon}</span>
      <span className="bks-sq__t">
        <b>{a.label}</b>
        {a.sub != null && <small>{a.sub}</small>}
      </span>
    </PxdButton>
  );
  const bar = (
    <div className="bks-bar">
      {sqBtn(sq[0])}
      {sqBtn(sq[1])}
      <PxdButton
        frame="act"
        off={go.off}
        className={`bks-go${go.hide ? ' is-hidden' : ''}`}
        aria-hidden={go.hide || undefined}
        tabIndex={go.hide ? -1 : undefined}
        hint={go.hide || go.off ? undefined : 'inspect'}
        onClick={go.hide ? undefined : go.run}
      >
        <span className="bks-go__i">{go.icon}</span>
        <span className="bks-go__t">
          <b>{go.label}</b>
          {go.sub != null && <small>{go.sub}</small>}
        </span>
      </PxdButton>
    </div>
  );

  // ---- The card ----------------------------------------------------------------------------------
  const card = (
    <section className={`bks-card pxd-f pxd-f--panel is-${cKind}`} style={rarityVars(cRar)}>
      <div className="bks-card__main">
        <span ref={cardArtRef} className="bks-card__art">
          {cardArt > 0 && cArt}
          {puff > 0 && (
            <span key={puff} className="bks-puff" aria-hidden="true">
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
        <div className="bks-card__txt">
          <h2 className="bks-card__name">
            <span className="pxd-rname">{cName}</span>
          </h2>
          <p className="bks-card__state">{cState}</p>
          <p className="bks-card__fx">{cFx}</p>
        </div>
      </div>
      {cFacts ?? (
        <div className="bks-facts is-none" aria-hidden="true">
          <span className="bks-fact" />
        </div>
      )}
    </section>
  );

  // ---- Tab «В кирке»: the pick + its places --------------------------------------------------
  const pickCard = (
    <section className="bks-pc pxd-f pxd-f--panel" style={rarityVars(pk.rarity)}>
      <span className="bks-pc__ico pxd-f pxd-f--well">
        {pickIco > 0 && <PickPx pick={p.pickMax} size={pickIco} />}
      </span>
      <div className="bks-pc__txt">
        <h3 className="bks-pc__name">
          <span className="pxd-rname">{pickFull(p.pickMax)}</span>
        </h3>
        <p className="bks-pc__lv">
          {t('books.lv', { n: lvl.level })}
          {' · '}
          {lvl.need ? t('books.blocksLeft', { n: Math.round(lvl.need - lvl.into) }) : t('books.max')}
        </p>
        <p className="bks-pc__stars">
          <Icon name="star" />
          <b>
            {p.pickStars}/{PICK_STARS_MAX}
          </b>
          <PxdPips
            n={PICK_STARS_MAX}
            on={p.pickStars}
            label={`${t('books.statStars')} ${p.pickStars}/${PICK_STARS_MAX}`}
          />
        </p>
      </div>
      <PxdButton
        frame="act"
        off={!starReady}
        className={`bks-pc__re${armed === 'star' ? ' is-armed' : ''}`}
        aria-label={starMax ? t('books.starMax') : t('books.star', { n: p.pickStars + 1 })}
        onClick={doStar}
      >
        <b>{armed === 'star' ? t('books.sure') : t('books.reforge')}</b>
        <small>{starMax ? '★' : `★${p.pickStars + 1}`}</small>
      </PxdButton>
    </section>
  );

  const tile = (
    key: string,
    on: boolean,
    kind: string,
    body: ReactNode,
    aria: string,
    pick: () => boolean,
    extra?: { badge?: ReactNode; corner?: ReactNode; cls?: string; keys?: () => void },
  ) => (
    <PxdButton
      key={key}
      frame={on ? 'sel' : kind === 'free' || kind === 'lock' ? 'well' : 'panel'}
      className={`bks-tile is-${kind}${extra?.cls ? ` ${extra.cls}` : ''}`}
      aria-label={aria}
      aria-pressed={on}
      data-autofocus={on ? '' : undefined}
      onClick={(e) => {
        // Enter / Space / the pad on the tile already chosen does its job; a finger uses the bar
        if (!pick() && fromKeys(e)) extra?.keys?.();
      }}
      onFocus={pick}
    >
      {body}
      {extra?.badge != null && <b className="bks-tile__lv">{extra.badge}</b>}
      {extra?.corner}
    </PxdButton>
  );

  const slotsSec = (
    <section className="bks-sl">
      <h3 className="bks-h">
        {rich('books.onPick', {
          a: <b>{onPick.length}</b>,
          b: <b>{slots}</b>,
        })}
      </h3>
      <div
        ref={slotsRef}
        className="bks-slots"
        role="group"
        style={{ '--n': slotN, '--tile': `${slotTile}px` } as CSSProperties}
      >
        {onPick.map((e) => {
          const l = p.ench[e.id];
          const off = p.off.includes(e.id);
          return tile(
            e.id,
            sid === e.id,
            'slot',
            slotArt > 0 && <BookArt book={{ id: e.id, lvl: l }} size={slotArt} />,
            bookName({ id: e.id, lvl: l }),
            () => pickSlot(e.id),
            {
              badge: ROMAN[l - 1],
              cls: off ? 'is-off' : undefined,
              corner: off ? (
                <span className="bks-tile__c">
                  <Icon name="zzz" />
                </span>
              ) : undefined,
            },
          );
        })}
        {Array.from({ length: free }, (_, i) =>
          tile(
            `f${i}`,
            sid === 'free' && i === 0,
            'free',
            <PxdSocket d={slotTile > 30 * u ? 16 : 12} />,
            t('books.free'),
            () => pickSlot('free'),
            { keys: toBooks },
          ),
        )}
        {locked > 0 &&
          tile(
            'lock',
            sid === 'lock',
            'lock',
            <Icon name="lock" />,
            t('books.lockedBy', { pick: rarityPick(rarityOf(slots).id) }),
            () => pickSlot('lock'),
            { badge: `+${locked}` },
          )}
      </div>
    </section>
  );

  // ---- Tab «Полка»: the owned books ---------------------------------------------------------
  const order = p.books.map((x, i) => i);
  if (byLevel) order.sort((a, c) => p.books[c].lvl - p.books[a].lvl || a - c);
  const shelfSec = (
    <section className="bks-sh">
      <div className="bks-sh__h">
        <h3 className="bks-h">
          {t('books.shelf')}{' '}
          <b>
            {p.books.length}/{SHELF_MAX}
          </b>
        </h3>
        <PxdButton
          className={`bks-sort${byLevel ? ' is-on' : ''}`}
          frame={byLevel ? 'sel' : 'panel'}
          aria-label={t('books.sortLevel')}
          aria-pressed={byLevel}
          onClick={() => {
            tapLight();
            setByLevel((v) => !v);
          }}
        >
          <Icon name="sort" />
          <span>{t('books.sortLevel')}</span>
        </PxdButton>
      </div>
      <div
        ref={gridRef}
        className="bks-grid"
        role="group"
        style={{ '--cols': cols, '--tile': `${gridTile}px` } as CSSProperties}
      >
        {p.books.length === 0 ? (
          <p className="bks-sh__empty">
            <GxIcon name="chest" />
            <GxIcon name="gift" />
            <GxIcon name="pick" />
            <span>{t('books.sources')}</span>
          </p>
        ) : (
          (painted ? order : []).map((i) => {
            const x = p.books[i];
            const ck = canApply(p.ench, slots, x);
            const mt = anvilMate(p.books, i) >= 0;
            return tile(
              `${i}-${x.id}-${x.lvl}-${x.chance}`,
              bi === i,
              'book',
              gridArt > 0 && <BookArt book={x} size={gridArt} />,
              `${bookName(x)} · ${t('books.pct', { v: x.chance })}`,
              () => pickBook(i),
              {
                badge: ROMAN[x.lvl - 1],
                cls: ck === 'lower' ? 'is-weak' : undefined,
                corner:
                  fresh === x ? (
                    <span className="bks-tile__c is-new">!</span>
                  ) : ck === 'ok' ? (
                    <span className="bks-tile__c is-up">
                      <Icon name="up" />
                    </span>
                  ) : mt ? (
                    <span className="bks-tile__c">
                      <GxIcon name="anvil" />
                    </span>
                  ) : undefined,
              },
            );
          })
        )}
      </div>
    </section>
  );

  // ---- Tab «Чародей»: a small portrait + four offers 2 × 2 ---------------------------------
  const poor = p.tokens < cheapest;
  const mageLineNow =
    poor && mageK === 0
      ? t('books.magePoor')
      : mageLine((poor ? mageK - 1 : mageK) % MAGE_LINES.length);
  const mageSec = (
    <section className="bks-mg pxd-f pxd-f--panel">
      <button
        type="button"
        className="pbk-mage bks-mg__pic px-f"
        aria-label={t('books.mageName')}
        onClick={() => {
          primeAudio();
          softChime(1);
          tapLight();
          setMageK((k) => k + 1);
        }}
      >
        <img src="/ui/books/enchanter.webp" alt="" draggable={false} />
        <i className="pbk-mage__eye is-l" aria-hidden="true" />
        <i className="pbk-mage__eye is-r" aria-hidden="true" />
        <i className="pbk-mage__lid is-l" aria-hidden="true" />
        <i className="pbk-mage__lid is-r" aria-hidden="true" />
        <i className="pbk-mage__fire is-l" aria-hidden="true" />
        <i className="pbk-mage__fire is-r" aria-hidden="true" />
        {mageK > 0 && <i key={mageK} className="pbk-mage__flare" aria-hidden="true" />}
      </button>
      <div className="bks-mg__txt">
        <h3 className="bks-h">{t('books.mageName')}</h3>
        <p key={mageK} className="bks-mg__say">
          {mageLineNow}
        </p>
      </div>
    </section>
  );
  const offersSec = (
    <div
      ref={offersRef}
      className={`bks-of${offStack ? ' is-stack' : ''}`}
      role="group"
      aria-label={t('books.mageName')}
    >
      {BOOK_TIERS.map((x) => {
        const can = p.tokens >= x.price && !full;
        const on = tierSel === x.id;
        const why = full
          ? t('books.shelfFullShort')
          : p.tokens < x.price
            ? t('books.lack', { n: fmt(x.price - p.tokens) })
            : t('books.canBuy');
        return (
          <PxdButton
            key={x.id}
            frame={on ? 'sel' : 'panel'}
            className={`bks-offer${can ? ' is-can' : ' is-short'}`}
            style={rarityVars(TIER_RARITY[x.id])}
            aria-label={`${bookTierBook(x.id)} · ${fmt(x.price)} · ${why}`}
            aria-pressed={on}
            data-autofocus={on ? '' : undefined}
            onPointerDown={() => can && preloadBookReveal(x.id)}
            onClick={(e) => {
              if (!pickTier(x.id)) {
                if (fromKeys(e)) onBuy(x.id);
                return;
              }
              if (!can) say(full ? t('books.shelfFull') : t('books.needTokens', { n: Math.round(x.price - p.tokens) }), true);
            }}
            onFocus={() => pickTier(x.id)}
          >
            <span className="bks-offer__name">
              <span className="pxd-rname">{bookTierName(x.id)}</span>
            </span>
            <span className="bks-offer__art">
              {offerArt > 0 && <BookArt tier={x.id} size={offerArt} glow={on && can} />}
            </span>
            <span className="bks-offer__price">
              <TokenIcon size={u * 8} />
              <b>{fmt(x.price)}</b>
            </span>
            <span className={`bks-offer__st${can ? ' is-ok' : ''}`}>
              {can && <Icon name="check" />}
              <span className="bks-fit">{why}</span>
              {!can && !full && (
                <span className="bks-fit is-s">
                  <TokenIcon size={u * 7} />−{fmt(x.price - p.tokens)}
                </span>
              )}
            </span>
            <span className="bks-offer__lv">
              {t('books.unknownShort')} · {ROMAN[x.lvl[0] - 1]}–{ROMAN[x.lvl[1] - 1]}
            </span>
          </PxdButton>
        );
      })}
    </div>
  );

  // ---- Header and tabs ------------------------------------------------------------------------
  const tabBtn = (id: Tab, icon: GxIconName, label: string, n?: string) => (
    <PxdButton
      key={id}
      frame={tab === id ? 'sel' : 'panel'}
      className={`bks-tab${tab === id ? ' is-on' : ''}`}
      role="tab"
      aria-selected={tab === id}
      onClick={() => switchTab(id)}
    >
      <GxIcon name={icon} />
      <span className="bks-tab__l">{label}</span>
      {n != null && <small className="bks-tab__n">{n}</small>}
    </PxdButton>
  );
  const tabs = (
    <nav className="bks-tabs" role="tablist">
      {tabBtn('pick', 'pick', t('books.tabPick'), `${onPick.length}/${slots}`)}
      {tabBtn('shelf', 'book', t('books.shelf'), `${p.books.length}`)}
      {tabBtn('mage', 'hood', t('books.mageName'))}
    </nav>
  );
  const purse = (
    <span className="bks-purse pxd-chip pxd-f pxd-f--well">
      <span>
        <TokenIcon size={u * 8} />
        <b>{fmtShort(p.tokens)}</b>
      </span>
      <span key={puff} className={`bks-dust${puff ? ' is-tick' : ''}`}>
        <DustIcon size={u * 8} />
        <b>{fmtShort(p.dust)}</b>
      </span>
    </span>
  );

  // ---- Fit pass: the purpose line's row, the tabs' icons and counts ---------------------------
  const [fitTick, setFitTick] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFitTick((x) => x + 1));
    };
    const ro = new ResizeObserver(bump);
    ro.observe(el);
    document.fonts?.ready.then(bump).catch(() => {});
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const top = el.querySelector<HTMLElement>('.bks-top');
    const sub = top?.querySelector<HTMLElement>('.bks-ttl p');
    if (top && sub) {
      top.classList.remove('is-subrow');
      if (layout === 'one')
        top.classList.toggle('is-subrow', sub.scrollWidth > sub.clientWidth + 0.5);
    }
    const tabsEl = el.querySelector<HTMLElement>('.bks-tabs');
    if (tabsEl) {
      tabsEl.classList.remove('is-tight', 'is-tight2');
      const over = () => {
        const kids = [...tabsEl.children] as HTMLElement[];
        const g = parseFloat(getComputedStyle(tabsEl).columnGap) || 0;
        const need = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0);
        return need + g * (kids.length - 1) > tabsEl.clientWidth + 0.5;
      };
      if (over()) {
        tabsEl.classList.add('is-tight');
        if (over()) tabsEl.classList.add('is-tight2');
      }
    }
    // a line that has a short form (`.bks-fit`): the short one when the long one overflows
    for (const f of el.querySelectorAll<HTMLElement>('.bks-go__t, .bks-sq__t, .bks-offer__st')) {
      f.classList.remove('is-short');
      const over = [...f.children].some(
        (k) => (k as HTMLElement).scrollWidth > (k as HTMLElement).clientWidth + 0.5,
      );
      f.classList.toggle('is-short', over);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs of the measured texts
  }, [fitTick, layout, tab, sid, bi, tierSel, armed, t, p.tokens, p.books.length]);

  const body = (
    <div
      ref={root}
      className={`px pxd arm ${win ? 'is-window' : 'is-embed'} bks bks--${layout} is-${tab}`}
      role={win ? 'dialog' : undefined}
      aria-label={win ? t('mineHud.dock.books') : undefined}
    >
      <header className="bks-top">
        {win && (
          <PxdButton
            className="bks-back"
            aria-label={t('common.back')}
            onClick={() => {
              tapLight();
              onClose?.();
            }}
          >
            <Icon name="left" />
          </PxdButton>
        )}
        <div className="bks-ttl">
          <h1>{t('mineHud.dock.books')}</h1>
          <p>{t('books.purpose')}</p>
        </div>
        {layout !== 'one' && tabs}
        {purse}
      </header>
      {layout === 'one' && tabs}
      <div className="bks-body">
        {tab === 'pick' && pickCard}
        {tab === 'pick' && slotsSec}
        {tab === 'shelf' && shelfSec}
        {tab === 'mage' && mageSec}
        {tab === 'mage' && offersSec}
        {card}
        {bar}
      </div>

      {hint && (
        <div
          key={hint.key}
          className={`arm-note bks-note pxd-f pxd-f--panel${hint.bad ? ' is-bad' : ''}`}
          role="status"
        >
          {hint.text}
        </div>
      )}

      {asking && b && (
        <PxdSheet
          title={t('books.replaceTitle')}
          sub={t('books.replacePick')}
          closeLabel={t('common.close')}
          width={200}
          className="bks-rep"
          onClose={() => setAsking(false)}
        >
          <div className="bks-rep__tiles" role="group" aria-label={t('books.replacePick')}>
            {onPick
              .filter((e) => e.id !== b.id)
              .map((e, i) => {
                const l = p.ench[e.id];
                const on = replace === e.id;
                return (
                  <PxdButton
                    key={e.id}
                    frame={on ? 'sel' : 'panel'}
                    className="bks-tile is-slot bks-rep__tile"
                    aria-pressed={on}
                    aria-label={`${bookName({ id: e.id, lvl: l })} · ${effectOf(e.id, l, p.pickStars)}`}
                    data-autofocus={i === 0 ? '' : undefined}
                    onClick={() => {
                      selectionChanged();
                      setReplace(e.id);
                    }}
                  >
                    <BookArt book={{ id: e.id, lvl: l }} size={artPx(24 * u)} />
                    <b className="bks-tile__lv">{ROMAN[l - 1]}</b>
                    <small className="bks-rep__fx">{plus(e.id, l, p.pickStars)}</small>
                  </PxdButton>
                );
              })}
          </div>
          <p className="bks-rep__note">{t('books.replace')}</p>
          <PxdButton
            frame="act"
            off={!replace}
            className="bks-rep__go"
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
          </PxdButton>
        </PxdSheet>
      )}

      {scene &&
        createPortal(
          scene.kind === 'apply' ? (
            <ApplyScene
              scene={scene}
              pick={p.pickMax}
              onDone={() => {
                // a book that took its place shows in the pick; a burnt one leaves the shelf as is
                if (scene.ok) {
                  setSlotSel(scene.book.id);
                  setTab('pick');
                }
                setScene(null);
              }}
            />
          ) : (
            <RevealScene
              scene={scene}
              onDone={() => {
                setFresh(scene.book);
                const i = useFinanceStore.getState().prison.books.indexOf(scene.book);
                if (i >= 0) setBookI(i);
                resetArm();
                setTab('shelf');
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
