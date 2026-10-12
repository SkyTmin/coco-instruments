// Книги зачарований (v2.70) — вкладка «Книги» у шахты: места в кирке,
// Чародей, полка, пыль, наковальня. Правила — lib/books.ts, стор —
// prisonBook*. Сцены (покупка, вписывание, наковальня) — порталом в body:
// у листа лагеря `backdrop-filter`, и `position: fixed` внутри него жил бы
// в рамке листа.
//
// Как в Майнкрафте и на присонах: книгу покупают «вслепую» (ярус известен,
// чара — нет), вписывают С ШАНСОМ, и шанс виден как стрелка на круге —
// зелёный сектор ровно такого размера, сколько процентов. Не вписалась —
// сгорает книга, не кирка.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GxIcon, GxModal } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { PickArt, RarityName, rarityVars } from '@/components/PickArt';
import { preloadPx, PxStrip, pxFitOf } from '@/components/PxStrip';
import { PickIcon, TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
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
  bookTitle,
  ENCHANT_TOGGLE,
  ENCHANTS,
  enchantOf,
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
import type { EnchantId, PrisonState } from '@/lib/prison';
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
  uiError,
  uiTap,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

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
  enchantOf(id).fx(enchUnits(id, lvl, stars));

/** Цвет шанса: зелёный — почти наверняка, жёлтый — как повезёт, красный — рискованно. */
const chanceTone = (c: number) => (c >= 80 ? 'hi' : c >= 50 ? 'mid' : 'lo');

// ---------------------------------------------------------------------------
// Вкладка.
// ---------------------------------------------------------------------------

type Scene =
  | { kind: 'buy'; book: Book; tier: BookTier }
  | { kind: 'anvil'; book: Book; from: Book }
  | { kind: 'apply'; book: Book; ok: boolean; chance: number; replaced?: EnchantId };

export function BooksTab() {
  const p = useFinanceStore((s) => s.prison);
  const buy = useFinanceStore((s) => s.prisonBookBuy);
  const [open, setOpen] = useState<number | null>(null);
  const [slot, setSlot] = useState<EnchantId | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [hint, setHint] = useState<{ text: string; key: number } | null>(null);
  const [fresh, setFresh] = useState<Book | null>(null);
  const slots = enchSlots(p);
  const pick = PICKS[p.pickMax];
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0);
  const full = p.books.length >= SHELF_MAX;

  const say = (text: string) => setHint({ text, key: Date.now() });

  useEffect(() => {
    if (!hint) return undefined;
    const t = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(t);
  }, [hint]);

  const onBuy = (tier: BookTier) => {
    primeAudio();
    const def = bookTierOf(tier);
    if (full) {
      uiError();
      notifyWarning();
      say('Полка полна — разбери лишние книги в пыль');
      return;
    }
    if (p.tokens < def.price) {
      uiError();
      notifyWarning();
      say(`Не хватает ${fmt(def.price - p.tokens)} токенов — они падают с блоков`);
      return;
    }
    const book = buy(tier);
    if (!book) return;
    uiBuy();
    preloadBookReveal(tierOfLevel(book.lvl));
    setScene({ kind: 'buy', book, tier });
  };

  // Лучший кандидат на полке — для подсказки «что вписать».
  const better = (b: Book) => canApply(p.ench, slots, b) === 'ok';

  return (
    <div className="pforge pbk">
      <div className="pcamp-purse pbk-purse">
        <span>
          <TokenIcon size={18} /> <b>{fmt(p.tokens)}</b>
        </span>
        <span>
          <DustIcon size={18} /> <b>{fmt(p.dust)}</b> пыли
        </span>
      </div>

      {/* ---- Кирка и её места ---- */}
      <section className="pbk-pick" style={rarityVars(pick.rarity)}>
        <div className="pbk-pick__head">
          <PickIcon pick={p.pickMax} size={46} />
          <span>
            <RarityName rarity={pick.rarity}>{pick.name} кирка</RarityName>
            <i>
              Книг в кирке: <b>{onPick.length}</b> из <b>{slots}</b>
            </i>
          </span>
        </div>
        <div className="pbk-slots">
          {onPick.map((e) => {
            const lvl = p.ench[e.id];
            const off = p.off.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className={`pbk-slot${off ? ' is-off' : ''}${slot === e.id ? ' is-open' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setSlot(slot === e.id ? null : e.id);
                }}
              >
                <BookArt book={{ id: e.id, lvl }} size={44} />
                <span className="pbk-slot__txt">
                  <b>
                    {e.name} <em>{ROMAN[lvl - 1]}</em>
                  </b>
                  <i>{off ? 'выключена' : effectOf(e.id, lvl, p.pickStars)}</i>
                </span>
              </button>
            );
          })}
          {Array.from({ length: Math.max(0, slots - onPick.length) }, (_, i) => (
            <div key={`e${i}`} className="pbk-slot is-empty">
              <span className="pbk-slot__plus">+</span>
              <span className="pbk-slot__txt">
                <b>Свободно</b>
                <i>{p.books.some(better) ? 'впиши книгу с полки' : 'купи книгу у Чародея'}</i>
              </span>
            </div>
          ))}
        </div>
        {slot && p.ench[slot] > 0 && <SlotTools id={slot} p={p} onDone={() => setSlot(null)} />}
        {slots < 7 && (
          <div className="pbk-locks" aria-label="Места, которые откроют кирки редче">
            {Array.from({ length: 7 - slots }, (_, i) => {
              const r = rarityOf(slots + i);
              return (
                <span
                  key={i}
                  className={`pbk-lock${i === 0 ? ' is-next' : ''}`}
                  style={{ '--rc': r.color } as CSSProperties}
                  title={`${r.name} кирка`}
                >
                  <GxIcon name="book" size={12} />
                  {i === 0 && `${r.name} кирка`}
                </span>
              );
            })}
            <em>+1 место за ступень</em>
          </div>
        )}
      </section>

      {/* ---- Чародей ---- */}
      <section className="pbk-seller">
        <MageCard poor={p.tokens < BOOK_TIERS[0].price} />
        <div className="pbk-tiers">
          {BOOK_TIERS.map((t) => {
            const can = p.tokens >= t.price && !full;
            return (
              <button
                key={t.id}
                type="button"
                className={`pbk-tier t-${t.id}${can ? '' : ' is-no'}`}
                aria-disabled={!can}
                style={rarityVars(TIER_RARITY[t.id])}
                onPointerDown={() => can && preloadBookReveal(t.id)}
                onClick={() => onBuy(t.id)}
              >
                <BookArt tier={t.id} size={56} glow={can} />
                <b>{t.name}</b>
                <i>
                  {ROMAN[t.lvl[0] - 1]}–{ROMAN[t.lvl[1] - 1]} · {t.chance[0]}–{t.chance[1]}%
                </i>
                <span className="pbk-tier__price">
                  {fmt(t.price)} <TokenIcon size={13} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Полка ---- */}
      <section className="pbk-shelf">
        <h4>
          <GxIcon name="book" size={18} /> Полка
          <i>
            {p.books.length}/{SHELF_MAX}
          </i>
        </h4>
        {p.books.length === 0 ? (
          <p className="pbk-empty">Пусто. Книги продаёт Чародей, кладут сундуки и посылки.</p>
        ) : (
          <div className="pbk-grid">
            {p.books.map((b, i) => {
              const check = canApply(p.ench, slots, b);
              const mate = anvilMate(p.books, i) >= 0;
              return (
                <button
                  key={`${i}-${b.id}-${b.lvl}-${b.chance}`}
                  type="button"
                  className={`pbk-book${check === 'lower' ? ' is-weak' : ''}${fresh === b ? ' is-fresh' : ''}`}
                  onClick={() => {
                    uiTap();
                    setOpen(i);
                  }}
                >
                  <BookArt book={b} size={54} />
                  <em className="pbk-book__lv">{ROMAN[b.lvl - 1]}</em>
                  <span className={`pbk-book__ch is-${chanceTone(b.chance)}`}>{b.chance}%</span>
                  {check === 'ok' && <i className="pbk-book__up" title="Можно вписать" />}
                  {mate && <GxIcon name="anvil" size={14} className="pbk-book__anvil" />}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <StarSection p={p} />

      {hint && (
        <div key={hint.key} className="pbk-hint" role="status">
          {hint.text}
        </div>
      )}

      {open !== null &&
        p.books[open] &&
        createPortal(
          <BookSheet
            i={open}
            p={p}
            onClose={() => setOpen(null)}
            onScene={(s) => {
              setOpen(null);
              setScene(s);
            }}
          />,
          document.body,
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
                setScene(null);
              }}
            />
          ),
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Чародей: портрет над ярусами. Лица нет — капюшон, светятся глаза (так он
// же будет выглядеть спрайтом во дворе, см. CLAUDE.md «План двора»).
// ---------------------------------------------------------------------------

/**
 * Реплики Чародея — одна строка, тап по портрету даёт следующую. Это его
 * голос, а не подсказка интерфейса: механику книг он рассказывает сам.
 */
function MageCard({ poor }: { poor: boolean }) {
  const [k, setK] = useState(0);
  const line =
    poor && k === 0
      ? 'Приходи с токенами — они падают с блоков.'
      : MAGE_LINES[(poor ? k - 1 : k) % MAGE_LINES.length];
  return (
    <button
      type="button"
      className="pbk-mage"
      aria-label="Чародей"
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
      <span className="pbk-mage__cap">
        <b>Чародей</b>
        <span key={k} className="pbk-mage__say">
          {line}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Место в кирке: выключить или снять в пыль.
// ---------------------------------------------------------------------------

function SlotTools({ id, p, onDone }: { id: EnchantId; p: PrisonState; onDone: () => void }) {
  const toggle = useFinanceStore((s) => s.prisonEnchantToggle);
  const wipe = useFinanceStore((s) => s.prisonEnchantWipe);
  const [armed, setArmed] = useState(false);
  const lvl = p.ench[id];
  const off = p.off.includes(id);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="pbk-tools">
      {ENCHANT_TOGGLE.includes(id) && (
        <button
          type="button"
          className={`pench-switch${off ? '' : ' is-on'}`}
          aria-pressed={!off}
          onClick={() => {
            selectionChanged();
            toggle(id);
          }}
        >
          <i />
          {off ? 'выкл' : 'вкл'}
        </button>
      )}
      <button
        type="button"
        className={`pench-reset${armed ? ' is-armed' : ''}`}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          const got = wipe(id);
          softThud();
          tapMedium();
          setArmed(false);
          if (got) onDone();
        }}
      >
        {armed ? `книга рассыплется: +${dustOf({ lvl })} пыли?` : 'снять'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Книга с полки: вписать, разобрать, склеить.
// ---------------------------------------------------------------------------

function BookSheet({
  i,
  p,
  onClose,
  onScene,
}: {
  i: number;
  p: PrisonState;
  onClose: () => void;
  onScene: (s: Scene) => void;
}) {
  const apply = useFinanceStore((s) => s.prisonBookApply);
  const salvage = useFinanceStore((s) => s.prisonBookSalvage);
  const anvil = useFinanceStore((s) => s.prisonBookAnvil);
  const b = p.books[i];
  const slots = enchSlots(p);
  const check = canApply(p.ench, slots, b);
  const cur = p.ench[b.id];
  const need = dustToFull(b);
  const [useDust, setUseDust] = useState(() => p.dust > 0 && need > 0);
  const dust = useDust ? Math.min(p.dust, need) : 0;
  const chance = applyChance(b, dust);
  const onPick = ENCHANTS.filter((e) => p.ench[e.id] > 0 && e.id !== b.id);
  const [replace, setReplace] = useState<EnchantId | null>(null);
  const mate = anvilMate(p.books, i);
  const [armed, setArmed] = useState(false);
  const r = rarityOfLevel(b.lvl);

  const doApply = () => {
    primeAudio();
    if (check === 'full' && !replace) {
      uiError();
      notifyWarning();
      return;
    }
    const res = apply(i, dust, check === 'full' ? (replace ?? undefined) : undefined);
    if (!res) {
      uiError();
      return;
    }
    void preloadPx(
      'books',
      `${res.ok ? 'apply-ok' : 'apply-burn'}-${tierOfLevel(res.book.lvl)}`,
      APPLY_SIZE,
    );
    onScene({
      kind: 'apply',
      book: res.book,
      ok: res.ok,
      chance: res.chance,
      replaced: check === 'full' ? (replace ?? undefined) : undefined,
    });
  };

  return (
    <GxModal title={bookTitle(b)} onClose={onClose} className="pbk-sheet">
      <div className="pbk-sheet__top" style={rarityVars(r)}>
        <BookArt book={b} size={112} glow />
        <div className="pbk-sheet__fx">
          <RarityName rarity={r}>{bookTierOf(tierOfLevel(b.lvl)).name} книга</RarityName>
          <b>{effectOf(b.id, b.lvl, p.pickStars)}</b>
          <i>
            {cur > 0
              ? `в кирке: ${enchantOf(b.id).name} ${ROMAN[cur - 1]} — ${effectOf(b.id, cur, p.pickStars)}`
              : 'такой чары в кирке нет'}
          </i>
        </div>
      </div>

      {check === 'lower' ? (
        <p className="pbk-note">
          В кирке уже {enchantOf(b.id).name} {ROMAN[cur - 1]} — эта книга не сильнее. Разбери её в
          пыль{mate >= 0 ? ' или склей с такой же' : ''}.
        </p>
      ) : (
        <>
          <div className={`pbk-odds is-${chanceTone(chance)}`}>
            <span className="pbk-odds__bar">
              <i style={{ width: `${b.chance}%` }} />
              <i
                className="is-dust"
                style={{ left: `${b.chance}%`, width: `${chance - b.chance}%` }}
              />
            </span>
            <b>{chance}%</b>
          </div>
          {need > 0 && (
            <button
              type="button"
              className={`pbk-dust${useDust ? ' is-on' : ''}`}
              aria-pressed={useDust}
              disabled={p.dust <= 0}
              onClick={() => {
                selectionChanged();
                setUseDust(!useDust);
              }}
            >
              <DustIcon size={16} />
              {p.dust <= 0
                ? 'пыли нет — её дают разобранные книги'
                : useDust
                  ? `подсыпано ${dust} пыли (+${dust}%)`
                  : `подсыпать пыль: +${Math.min(p.dust, need)}%`}
            </button>
          )}
          {check === 'full' && (
            <div className="pbk-replace">
              <i>Мест нет. Какую книгу выбить (рассыплется в пыль, только если эта впишется)?</i>
              <div>
                {onPick.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`pbk-chip${replace === e.id ? ' is-on' : ''}`}
                    onClick={() => {
                      selectionChanged();
                      setReplace(e.id);
                    }}
                  >
                    <GxIcon name={ENCH_ICON[e.id]} size={14} />
                    {e.name} {ROMAN[p.ench[e.id] - 1]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="pbk-warn">Не впишется — книга сгорит. Кирка цела.</p>
        </>
      )}

      <div className="pbk-sheet__btns">
        {check !== 'lower' && (
          <button
            type="button"
            className="gx-btn gx-btn--red pbk-go"
            aria-disabled={check === 'full' && !replace}
            onClick={doApply}
          >
            Вписать · {chance}%
          </button>
        )}
        {mate >= 0 && (
          <button
            type="button"
            className="gx-btn"
            onClick={() => {
              primeAudio();
              const from = b;
              const got = anvil(i, mate);
              if (!got) return;
              preloadBookReveal(tierOfLevel(got.lvl));
              onScene({ kind: 'anvil', book: got, from });
            }}
          >
            <GxIcon name="anvil" size={16} /> Склеить → {ROMAN[b.lvl]}
          </button>
        )}
        <button
          type="button"
          className={`gx-btn gx-btn--grey${armed ? ' is-armed' : ''}`}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            const got = salvage(i);
            softChime(1);
            tapLight();
            if (got) onClose();
          }}
        >
          <DustIcon size={15} /> {armed ? `Точно? +${dustOf(b)}` : `В пыль +${dustOf(b)}`}
        </button>
      </div>
    </GxModal>
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
    const beats = slow ? 5 : 3;
    for (let k = 0; k < beats; k++)
      at(k * 360, () => {
        forgeStrike(k);
        tapLight();
      });
    at(beats * 360 + 80, () => {
      flashFrame(slow ? 'mega' : 'big');
      setPhase('play');
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
      className={`pbks is-${phase} is-${scene.kind}${slow ? ' is-slow' : ''}${sigil === 'up' ? ' is-peak' : ''}`}
      style={rarityVars(r)}
      onClick={() => {
        if (!shown) skip();
        else {
          tapLight();
          onDone();
        }
      }}
    >
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
      {shown && (
        <div className="pbks__text">
          <RarityName rarity={r}>{bookTitle(b)}</RarityName>
          <span className="pbks__fx">{effectOf(b.id, b.lvl, p.pickStars)}</span>
          <span className={`pbks__ch is-${chanceTone(b.chance)}`}>шанс вписать {b.chance}%</span>
          <span className="fgr__cta">На полку</span>
        </div>
      )}
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
      className={`pbka is-${phase}${hit ? ' is-hit' : ''}`}
      style={{ ...rarityVars(r), '--ch': `${c}%` } as CSSProperties}
      onClick={() => {
        if (phase === 'spin') settle();
        else if (!ended) finish();
        else {
          tapLight();
          onDone();
        }
      }}
    >
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
      <div className="pbka__text">
        {phase === 'spin' && <b className="pbka__odds">{c}%</b>}
        {told && phase === 'ok' && (
          <>
            <RarityName rarity={r}>Вписано: {bookTitle(b)}</RarityName>
            <span className="pbks__fx">{effectOf(b.id, b.lvl, p.pickStars)}</span>
            {scene.replaced && (
              <span className="pbks__fx">{enchantOf(scene.replaced).name} рассыпалась в пыль</span>
            )}
          </>
        )}
        {told && phase === 'fail' && (
          <>
            <b className="pbka__lost">Книга сгорела</b>
            <span className="pbks__fx">кирка цела · пыль поднимет шанс</span>
          </>
        )}
        {told && <span className="fgr__cta">Дальше</span>}
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

// ---------------------------------------------------------------------------
// Перековка кирки звездой (престиж кирки): живёт у книг, потому что
// звезда делает сильнее каждую книгу.
// ---------------------------------------------------------------------------

function StarSection({ p }: { p: PrisonState }) {
  const prisonPickStar = useFinanceStore((s) => s.prisonPickStar);
  const [armed, setArmed] = useState(false);
  const lvl = pickLevelOf(p.pickXp);
  return (
    <>
      <div className="pench-pick">
        <span className="pench-pick__lv">
          <PickIcon pick={p.pick} size={20} /> Кирка ур. {lvl.level}
          {p.pickStars > 0 && <em className="pench-stars">{'★'.repeat(p.pickStars)}</em>}
        </span>
        <span className="pench-pick__bar">
          <i style={{ transform: `scaleX(${lvl.need ? lvl.into / lvl.need : 1})` }} />
        </span>
        <span className="pench-pick__txt">
          {lvl.need ? `ещё ${fmt(lvl.need - lvl.into)} блоков` : 'максимум'}
        </span>
      </div>
      {lvl.level >= PICK_LEVEL_MAX && p.pickStars < PICK_STARS_MAX && (
        <div className="pstar">
          <span>
            <b>Перековать кирку ★{p.pickStars + 1}</b>
            <i>
              Уровень кирки — в ноль, зато каждая книга сильнее на {Math.round(STAR_CAP * 100)}%,
              скорость копки +{Math.round(STAR_DMG * 100)}%, {fmt(STAR_TOKENS * (p.pickStars + 1))}{' '}
              токенов и {STAR_KEYS} ключа.
            </i>
          </span>
          <button
            type="button"
            className={`btn btn--sm pforge__buy${armed ? ' is-armed' : ''}`}
            onClick={() => {
              primeAudio();
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              if (!prisonPickStar()) {
                notifyWarning();
                return;
              }
              tierBreak(3);
              burstConfetti(80, ['#ffe08a', '#ffffff', '#b8f4e6']);
              flashFrame('big');
              notifySuccess();
            }}
          >
            {armed ? 'Точно?' : 'Перековать'}
          </button>
        </div>
      )}
    </>
  );
}
