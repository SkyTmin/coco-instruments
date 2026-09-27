// Инвентарь (v2.81, первый вариант) — один экран со всем, что есть у
// игрока, по разделам: руда, подземелье, расходники, ключи, яйца, книги,
// руны, находки и личный сундук у койки. Палитра — как у инвентаря вылазки
// (`DungeonInventory`): серая панель со скосами, ячейки, белые цифры с
// тенью — владелец просил «как в Майнкрафте». Лимиты — прежние, видны
// полоской у раздела. Правила — `lib/inventory.ts`.
//
// У койки в Бараке 1 (`place="bunk"`) сверху сундук ячейками, снизу
// инвентарь — как сундук Майнкрафта: тап по вещи — карточка, в ней
// «в сундук» или «забрать». В шахте карточка умеет выпить энергетик и
// бросить бомбу, во дворе — положить яйцо в гнездо и продать рюкзак. Из
// вылазки (`place="view"`) — только посмотреть: сундук в бараке.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import '@/inventory.css';
import { GxIcon, KIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { ItemIcon, KeyIcon, OreIcon, RuneIcon, TokenIcon } from '@/components/PrisonCamp';
import { EggArt } from '@/components/PetArt';
import { BookArt, DustIcon } from '@/components/BooksTab';
import { useFinanceStore } from '@/store';
import {
  actsOf,
  BUNK_BIG_PRICE,
  BUNK_BIG_SLOTS,
  BUNK_ROW,
  bunkRoom,
  bunkSize,
  homeRoom,
  inventoryOf,
  limitFull,
  thingOfRef,
  WHERE_NAME,
} from '@/lib/inventory';
import type { InvIcon, InvItem, InvPlace, InvSection, InvSectionView } from '@/lib/inventory';
import {
  bagCount,
  bagValue,
  CASE_TIERS,
  modsOf,
  nextPick,
  reserveOre,
  shortMoney,
} from '@/lib/prison';
import type { ItemId } from '@/lib/prison';
import { findTexture } from '@/lib/prison-art';
import { itemUrl } from '@/lib/dungeon-art';
// Картинки материалов этажей регистрируют сами этажи.
import '@/lib/dungeon-floors/art';
import { registerEscape } from '@/lib/escape-stack';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { chestLatch, coinDing, softThud, uiClose, uiOpen } from '@/lib/sound';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
/** Число в ячейке: 12, 999, 1,2к, 12к. */
const slotNum = (n: number) =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? `${(Math.floor(n / 100) / 10).toLocaleString('ru-RU')}к`
      : `${Math.floor(n / 1000)}к`;

// ---------------------------------------------------------------------------
// Картинка вещи.
// ---------------------------------------------------------------------------

export function InvIconView({ icon, size = 26 }: { icon: InvIcon; size?: number }) {
  switch (icon.k) {
    case 'ore':
      return <OreIcon rock={icon.rock} size={size} />;
    case 'block':
      return <OreIcon rock={icon.rock} size={size} block />;
    case 'mat':
      return <img className="inv-px" src={itemUrl(icon.id)} width={size} height={size} alt="" />;
    case 'item':
      return <ItemIcon id={icon.id} size={size} />;
    case 'key':
      return <KeyIcon size={size} />;
    case 'dust':
      return <DustIcon size={size} />;
    case 'pearl':
      return <i className="inv-pearl" style={{ width: size * 0.7, height: size * 0.7 }} />;
    case 'coin':
      return <CoinIcon size={size} />;
    case 'token':
      return <TokenIcon size={size} />;
    case 'parcel': {
      const tier = CASE_TIERS.find((t) => t.id === icon.tier);
      return <GxIcon name="gift" size={size} style={{ color: tier?.color }} />;
    }
    case 'egg':
      return <EggArt egg={icon.egg} size={size} />;
    case 'book':
      return <BookArt book={icon.book} size={size} />;
    case 'rune':
      return <RuneIcon kind={icon.kind} tier={icon.tier} size={size} />;
    case 'find':
      return (
        <img
          className={`inv-px${icon.ghost ? ' is-ghost' : ''}`}
          src={findTexture(icon.id, icon.ghost)}
          width={size}
          height={size}
          alt=""
        />
      );
  }
}

/** Значок места в углу ячейки: ящик кузнеца, гнездо, оберег. */
const WHERE_MARK: Partial<Record<InvItem['where'], GxIconName>> = {
  box: 'anvil',
  nest: 'egg',
  socket: 'shield',
};

function Slot({ item, on, onPick }: { item: InvItem; on: boolean; onPick: () => void }) {
  const mark = WHERE_MARK[item.where];
  return (
    <button
      type="button"
      className={`mcslot inv-slot${on ? ' is-on' : ''}${item.n <= 0 ? ' is-ghost' : ''}`}
      aria-label={`${item.name}${item.n > 1 ? `: ${item.n}` : ''}`}
      onClick={onPick}
    >
      <InvIconView icon={item.icon} />
      {item.n > 1 && <b className="mcslot__n">{slotNum(item.n)}</b>}
      {mark && <GxIcon name={mark} size={11} className="inv-slot__mark" />}
      {item.progress !== undefined && (
        <i className="inv-slot__bar">
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, item.progress))})` }} />
        </i>
      )}
    </button>
  );
}

function Limit({ l }: { l: InvSectionView['limits'][number] }) {
  const full = limitFull(l);
  return (
    <span className={`inv-lim${full ? ' is-full' : ''}`}>
      {l.label}{' '}
      <b>
        {l.used}/{l.max}
      </b>
      <i>
        <i style={{ transform: `scaleX(${l.max ? Math.min(1, l.used / l.max) : 0})` }} />
      </i>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Экран.
// ---------------------------------------------------------------------------

type Sel = { key: string; kind: string } | { key: 'big'; kind: 'big' } | null;

export function Inventory({
  place,
  onClose,
  onUse,
}: {
  place: InvPlace;
  onClose: () => void;
  /** Шахта: выпить энергетик или бросить бомбу — делает страница. */
  onUse?: (id: ItemId) => void;
}) {
  const p = useFinanceStore((s) => s.prison);
  const d = useFinanceStore((s) => s.dungeon);
  const bunk = useFinanceStore((s) => s.bunk);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const bunkPut = useFinanceStore((s) => s.bunkPut);
  const bunkTake = useFinanceStore((s) => s.bunkTake);
  const bunkBuyBig = useFinanceStore((s) => s.bunkBuyBig);
  const eggPlace = useFinanceStore((s) => s.prisonEggPlace);
  const prisonSell = useFinanceStore((s) => s.prisonSell);

  const [sel, setSel] = useState<Sel>(null);
  const [note, setNote] = useState<{ key: number; text: string; bad?: boolean } | null>(null);
  const [armed, setArmed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const secRefs = useRef<Partial<Record<InvSection, HTMLElement | null>>>({});

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
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const atBunk = place === 'bunk';
  const sections = useMemo(() => inventoryOf(p, d, bunk), [p, d, bunk]);
  const byKey = useMemo(() => {
    const m = new Map<string, InvItem>();
    for (const s of sections) for (const it of s.items) m.set(it.key, it);
    return m;
  }, [sections]);
  // Вещь выбрана по ключу; после переноса под тем же ключом может оказаться
  // другая (книги сдвигаются на полке) — тогда выбор снимается.
  const picked = sel && sel.key !== 'big' ? byKey.get(sel.key) : undefined;
  const item = picked && picked.kind === sel!.kind ? picked : undefined;
  const bunkSec = sections.find((s) => s.id === 'bunk')!;
  // Рюкзак вылазки — раздел, только пока вылазка ждёт внизу; из самой
  // вылазки он виден живым в её инвентаре, здесь был бы снимок.
  const listed = sections.filter(
    (s) => !(atBunk && s.id === 'bunk') && (s.id !== 'sack' || (!!d.run && place !== 'view')),
  );

  const say = (text: string, bad = false) => setNote({ key: Date.now(), text, bad });
  const pick = (it: InvItem) => {
    selectionChanged();
    setNote(null);
    setArmed(false);
    setSel(sel?.key === it.key ? null : { key: it.key, kind: it.kind });
  };
  const jump = (id: InvSection) => {
    tapLight();
    const box = scrollRef.current;
    const el = secRefs.current[id];
    if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop - 2, behavior: 'smooth' });
  };

  // ---- Действия ------------------------------------------------------------

  const toBunk = (it: InvItem, n: number) => {
    if (!it.ref) return;
    const got = bunkPut(it.ref, n);
    if (got > 0) {
      chestLatch();
      notifySuccess();
      say(`В сундук: ${it.name}${got > 1 ? ` ×${got}` : ''}`);
    } else {
      softThud();
      notifyWarning();
      say('Сундук полон', true);
    }
  };
  const fromBunk = (it: InvItem, n: number) => {
    if (it.slot === undefined) return;
    const got = bunkTake(it.slot, n);
    if (got > 0) {
      chestLatch();
      notifySuccess();
      say(`${WHERE_NAME[homeOf(it)]}: +${got}`);
    } else {
      softThud();
      notifyWarning();
      say(fullText(it), true);
    }
  };
  const toNest = (it: InvItem) => {
    if (it.icon.k !== 'egg') return;
    if (eggPlace(it.icon.egg)) {
      notifySuccess();
      say('Яйцо греется в гнезде');
    } else {
      notifyWarning();
      say('Гнёзда заняты', true);
    }
  };
  const use = (it: InvItem) => {
    if (it.icon.k !== 'item' || !onUse) return;
    tapLight();
    onUse(it.icon.id);
    onClose();
  };
  const sellBag = () => {
    const got = prisonSell();
    if (got.coins > 0) {
      coinDing();
      notifySuccess();
      say(`Продано: +${fmt(got.coins)} монет${got.boxed ? ` · ${fmt(got.boxed)} в ящик` : ''}`);
    } else if (got.boxed > 0) {
      notifySuccess();
      say(`В ящик кузнеца: ${fmt(got.boxed)}`);
    }
    setSel(null);
  };
  const buyBig = () => {
    if (!armed) {
      tapLight();
      setArmed(true);
      return;
    }
    setArmed(false);
    if (bunkBuyBig()) {
      chestLatch();
      notifySuccess();
      say('Двойной сундук: 54 ячейки');
      setSel(null);
    } else {
      notifyWarning();
      say('Не хватает монет', true);
    }
  };

  // ---- Карточка вещи ---------------------------------------------------------

  const bagSell = useMemo(() => {
    if (!bagCount(p.bag)) return 0;
    return bagValue(reserveOre(p.bag, p.forgeBox, nextPick(p)).bag, modsOf(p).sell);
  }, [p]);

  let card: JSX.Element;
  if (sel?.key === 'big' && !bunk.big) {
    card = (
      <>
        <b className="mcinv__name">Двойной сундук</b>
        <span className="mcinv__sub">
          Ещё {BUNK_BIG_SLOTS - bunkSize(bunk)} ячеек. Вещи остаются на местах.
        </span>
        <span className="mcinv__cost">
          <span className={balance >= BUNK_BIG_PRICE ? '' : 'is-short'}>
            <CoinIcon size={12} /> {fmt(BUNK_BIG_PRICE)}
          </span>
        </span>
        <div className="mcinv__acts">
          <button
            type="button"
            className={`mcbtn mcbtn--ok${armed ? ' is-armed' : ''}`}
            disabled={balance < BUNK_BIG_PRICE}
            onClick={buyBig}
          >
            {armed ? 'Точно? Купить' : 'Купить'}
          </button>
        </div>
      </>
    );
  } else if (item) {
    const acts = actsOf(item, place);
    const thing = item.slot !== undefined ? bunk.slots[item.slot]?.thing : undefined;
    const refThing = item.ref ? thingOfRef({ p, d }, item.ref) : null;
    const room = refThing ? bunkRoom(bunk, refThing) : 0;
    const home = thing ? homeRoom({ p, d }, thing) : 0;
    const stackN = Math.max(1, Math.min(item.n, item.stack || 1));
    card = (
      <>
        <b className="mcinv__name">
          {item.name}
          {item.n > 1 && <em> ×{fmt(item.n)}</em>}
        </b>
        {item.sub && <span className="mcinv__sub">{item.sub}</span>}
        <span className={`mcinv__stat${item.where === 'sack' ? ' is-risk' : ''}`}>
          <GxIcon name={whereIcon(item)} size={12} /> {WHERE_NAME[item.where]}
          {item.price ? (
            <>
              {' '}
              · <CoinIcon size={11} /> {fmt(item.price)} за штуку
            </>
          ) : null}
        </span>
        {atBunk && item.stack > 1 && (
          <span className="mcinv__sub">В ячейке сундука до {item.stack}</span>
        )}
        <div className="mcinv__acts">
          {acts.includes('use') && (
            <button type="button" className="mcbtn mcbtn--ok" onClick={() => use(item)}>
              {item.key === 'item:energy'
                ? 'Выпить'
                : item.key === 'item:prop'
                  ? 'Поставить'
                  : 'Включить'}
            </button>
          )}
          {acts.includes('throw') && (
            <button type="button" className="mcbtn mcbtn--ok" onClick={() => use(item)}>
              {item.key === 'item:charge' ? 'Заложить' : 'Бросить'}
            </button>
          )}
          {acts.includes('nest') && (
            <button type="button" className="mcbtn mcbtn--ok" onClick={() => toNest(item)}>
              В гнездо
            </button>
          )}
          {acts.includes('toBunk') &&
            (room <= 0 ? (
              <button type="button" className="mcbtn" disabled>
                Сундук полон
              </button>
            ) : (
              <>
                {item.n > 1 && (
                  <button type="button" className="mcbtn" onClick={() => toBunk(item, 1)}>
                    В сундук 1
                  </button>
                )}
                {stackN > 1 && stackN < item.n && (
                  <button type="button" className="mcbtn" onClick={() => toBunk(item, stackN)}>
                    Стопку {stackN}
                  </button>
                )}
                <button
                  type="button"
                  className="mcbtn mcbtn--ok"
                  onClick={() => toBunk(item, item.n)}
                >
                  {item.n > 1 ? `Всё ${slotNum(Math.min(item.n, room))}` : 'В сундук'}
                </button>
              </>
            ))}
          {acts.includes('fromBunk') &&
            (home <= 0 ? (
              <button type="button" className="mcbtn" disabled>
                {fullText(item)}
              </button>
            ) : (
              <>
                {item.n > 1 && (
                  <button type="button" className="mcbtn" onClick={() => fromBunk(item, 1)}>
                    Забрать 1
                  </button>
                )}
                <button
                  type="button"
                  className="mcbtn mcbtn--ok"
                  onClick={() => fromBunk(item, item.n)}
                >
                  {item.n > 1 ? `Забрать ${Math.min(item.n, home)}` : 'Забрать'}
                </button>
              </>
            ))}
          {item.where === 'bag' && place !== 'view' && (
            <button type="button" className="mcbtn mcbtn--warn" onClick={sellBag}>
              {bagSell > 0 ? (
                <>
                  Продать рюкзак {shortMoney(bagSell)} <CoinIcon size={11} />
                </>
              ) : (
                'Рюкзак — в ящик'
              )}
            </button>
          )}
        </div>
      </>
    );
  } else {
    card = (
      <span className="mcinv__hint">
        {place === 'view'
          ? 'Здесь только посмотреть: сундук — у койки в Бараке 1.'
          : atBunk
            ? 'Тап по вещи — переложить в сундук или забрать.'
            : 'Тап по вещи — что это и что с ней можно сделать.'}
      </span>
    );
  }

  // ---- Разметка --------------------------------------------------------------

  const chestRows = bunkSize(bunk) / BUNK_ROW;

  // Портал живёт в дереве React у хозяина: клики и касания не должны
  // всплывать к нему (джойстик площади, фон инвентаря вылазки).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <div
      className="gx inv-back"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div
        className={`inv${atBunk ? ' inv--bunk' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={atBunk ? 'Сундук у койки' : 'Инвентарь'}
      >
        <div className="inv__head">
          <b>{atBunk ? 'Сундук у койки' : 'Инвентарь'}</b>
          <span className="inv__purse">
            <span>
              <CoinIcon size={14} /> {shortMoney(balance)}
            </span>
            <span>
              <TokenIcon size={14} /> {fmt(p.tokens)}
            </span>
          </span>
          <button type="button" className="mcinv__x" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>

        {atBunk && (
          <div className="inv__chest">
            <div className="mcinv__label">
              <span>
                <GxIcon name="chest" size={14} /> Сундук
              </span>
              <em>
                {bunkSec.limits[0].used}/{bunkSec.limits[0].max}
              </em>
            </div>
            <div className="inv__grid" style={{ '--rows': chestRows } as CSSProperties}>
              {bunk.slots.map((s, i) => {
                const it = s ? byKey.get(`bunk:${i}`) : undefined;
                return it ? (
                  <Slot key={i} item={it} on={sel?.key === it.key} onPick={() => pick(it)} />
                ) : (
                  <span key={i} className="mcslot inv-slot is-empty" />
                );
              })}
            </div>
            {!bunk.big && (
              <button
                type="button"
                className={`inv__more${sel?.key === 'big' ? ' is-on' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setNote(null);
                  setSel(sel?.key === 'big' ? null : { key: 'big', kind: 'big' });
                }}
              >
                <KIcon name="locked" size={12} /> Двойной сундук — ещё 27 ячеек
              </button>
            )}
          </div>
        )}

        <nav className="inv__tabs" aria-label="Разделы">
          {listed.map((s) => {
            const full = s.limits.some(limitFull) && s.id !== 'finds' && s.id !== 'bunk';
            const n = s.id === 'finds' ? s.limits[0].used : s.items.length;
            return (
              <button
                key={s.id}
                type="button"
                className={`inv__tab${n ? '' : ' is-empty'}`}
                aria-label={s.name}
                onClick={() => jump(s.id)}
              >
                <GxIcon name={s.icon as GxIconName} size={18} />
                {n > 0 && <i>{n}</i>}
                {full && <em className="inv__tab-full" />}
              </button>
            );
          })}
        </nav>

        <div className="inv__scroll" ref={scrollRef}>
          {listed.map((s) => (
            <section
              key={s.id}
              className="inv__sec"
              ref={(el) => {
                secRefs.current[s.id] = el;
              }}
            >
              <div className="inv__sec-head">
                <GxIcon name={s.icon as GxIconName} size={15} />
                <b>{s.id === 'bunk' ? 'Сундук у койки' : s.name}</b>
                <span className="inv__lims">
                  {s.limits.map((l) => (
                    <Limit key={l.label} l={l} />
                  ))}
                </span>
              </div>
              {s.items.length ? (
                <div className="inv__grid">
                  {s.items.map((it) => (
                    <Slot key={it.key} item={it} on={sel?.key === it.key} onPick={() => pick(it)} />
                  ))}
                </div>
              ) : (
                <span className="inv__empty">пусто</span>
              )}
            </section>
          ))}
        </div>

        <div className="mcinv__info inv__info">
          {card}
          {note && (
            <span key={note.key} className={`inv__note${note.bad ? ' is-bad' : ''}`}>
              {note.text}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Куда вещь вернётся из сундука. */
function homeOf(it: InvItem): InvItem['where'] {
  switch (it.icon.k) {
    case 'egg':
      return 'basket';
    case 'book':
      return 'shelf';
    case 'rune':
      return 'pouch';
    case 'item':
      return 'items';
    default:
      return 'stash';
  }
}

function fullText(it: InvItem): string {
  switch (homeOf(it)) {
    case 'basket':
      return 'Корзина полна';
    case 'shelf':
      return 'Полка полна';
    case 'pouch':
      return 'Мешочек полон';
    default:
      return 'Некуда';
  }
}

function whereIcon(it: InvItem): GxIconName {
  switch (it.where) {
    case 'bag':
      return 'backpack';
    case 'box':
      return 'anvil';
    case 'stash':
      return 'cave';
    case 'nest':
    case 'basket':
      return 'egg';
    case 'shelf':
      return 'book';
    case 'pouch':
      return 'rune';
    case 'socket':
      return 'shield';
    case 'parcels':
      return 'gift';
    case 'finds':
      return 'medal';
    case 'bunk':
      return 'chest';
    case 'sack':
      return 'skull';
    default:
      return 'backpack';
  }
}
