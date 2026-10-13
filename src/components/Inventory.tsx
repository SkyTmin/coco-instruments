// Инвентарь (v2.81, UI v2 — пиксельный набор) — один экран со всем, что есть у игрока, по
// разделам: руда, подземелье, расходники, ключи, яйца, книги, руны, находки и личный сундук у
// койки. Правила и лимиты — `lib/inventory.ts`.
//
// Каркас — «оружейная» (`armory.ts`/`armory.css`, как кузница и книги): выбранная вещь крупно
// на подиуме (не меньше половины экрана), под ней три цифры; ниже/сбоку — сетка ячеек набора
// с рамками редкости и вкладками разделов; кнопки действий — внизу, под большим пальцем, их
// число на месте постоянно (пустые места скрыты), так что выбор другой вещи ничего не двигает.
//
// У койки в Бараке 1 (`place="bunk"`) сверху сундук ячейками (9 в ряд, как в Майнкрафте), ниже
// инвентарь: «в сундук» или «забрать». В шахте вещь можно выпить или бросить, во дворе — яйцо
// в гнездо и продать рюкзак. Из вылазки (`place="view"`) — только посмотреть.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './backpack.css';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { ItemIcon, KeyIcon, OreIcon, RuneIcon, TokenIcon } from '@/components/PrisonCamp';
import { EggArt } from '@/components/PetArt';
import { BookArt, DustIcon, TIER_RARITY } from '@/components/BooksTab';
import { RarityChip, rarityVars } from '@/components/PickArt';
import { heroSize, useArmLayout, useBox } from '@/components/armory';
import { useFinanceStore } from '@/store';
import {
  actsOf,
  BUNK_BIG_PRICE,
  BUNK_BIG_SLOTS,
  bunkRoom,
  bunkSize,
  homeRoom,
  inventoryOf,
  limitFull,
  thingOfRef,
} from '@/lib/inventory';
import type { InvIcon, InvItem, InvPlace, InvSection, InvSectionView } from '@/lib/inventory';
import { bagCount, bagValue, CASE_TIERS, modsOf, nextPick, PICKS, reserveOre } from '@/lib/prison';
import type { ItemId } from '@/lib/prison';
import { EGGS } from '@/lib/pets';
import { tierOfLevel } from '@/lib/books';
import { findTexture } from '@/lib/prison-art';
import { itemUrl } from '@/lib/dungeon-art';
// Картинки материалов этажей регистрируют сами этажи.
import '@/lib/dungeon-floors/art';
import { registerEscape } from '@/lib/escape-stack';
import { useAction } from '@/input';
import { Bar, Button, Heading, Panel, Slot, Tabs } from '@/ui-px';
import { fmtDec, fmtNum, fmtShort, t, useLang, useT } from '@/i18n';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { chestLatch, coinDing, softThud, uiClose, uiOpen } from '@/lib/sound';

const fmt = (n: number) => fmtNum(n);
/** Big stat numbers: whole up to 9 999, then the compact slot form (12к) — the cell keeps its width. */
const big = (n: number) => (n < 10_000 ? fmtNum(n) : slotNum(n));
/** Число в ячейке: 12, 999, 1,2к, 12к. */
const slotNum = (n: number) =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? t('inv.kilo', { n: fmtDec(Math.floor(n / 100) / 10, 3) })
      : t('inv.kilo', { n: String(Math.floor(n / 1000)) });

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
      return <EggArt egg={icon.egg} size={Math.round(size * 1.15)} />;
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

/**
 * Ступень редкости вещи — рамка ячейки и цвет имени. Руда — по кирке, которая куётся на её
 * этаже (та же лестница, что у кузницы); книги — по ступени; яйца — по виду; руны — по уровню.
 */
function rarityOfIcon(icon: InvIcon): number {
  switch (icon.k) {
    case 'ore':
    case 'block': {
      let r = 0;
      for (const pk of PICKS) if (!pk.prestige && pk.floor <= icon.rock) r = pk.rarity;
      return r;
    }
    case 'book':
      return TIER_RARITY[tierOfLevel(icon.book.lvl)];
    case 'egg':
      return Math.min(6, EGGS.findIndex((e) => e.id === icon.egg) + 1);
    case 'rune':
      return Math.max(0, Math.min(6, icon.tier - 1));
    case 'parcel':
      return (
        Math.max(
          0,
          CASE_TIERS.findIndex((c) => c.id === icon.tier),
        ) + 1
      );
    default:
      return 0;
  }
}

/** Значок места в углу ячейки: ящик кузнеца, гнездо, оберег. */
const WHERE_MARK: Partial<Record<InvItem['where'], GxIconName>> = {
  box: 'anvil',
  nest: 'egg',
  socket: 'shield',
};

/** Ячейка набора с вещью: рамка редкости, число, значок места, полоска готовности. */
function ItemSlot({
  item,
  on,
  icon,
  onPick,
}: {
  item: InvItem;
  on: boolean;
  icon: number;
  onPick: () => void;
}) {
  const mark = WHERE_MARK[item.where];
  const ready = item.progress !== undefined && item.progress >= 1;
  return (
    <Slot
      rarity={rarityOfIcon(item.icon)}
      selected={on}
      count={item.n > 1 ? slotNum(item.n) : undefined}
      corner={mark ? <GxIcon name={mark} size={Math.round(icon * 0.5)} /> : undefined}
      dot={ready ? '!' : undefined}
      className={item.n <= 0 ? 'ivx-ghost' : undefined}
      data-autofocus={on ? '' : undefined}
      aria-label={`${item.name}${item.n > 1 ? `: ${item.n}` : ''}`}
      tip={<ItemTip item={item} />}
      onClick={onPick}
      onFocus={() => {
        if (!on) onPick();
      }}
    >
      <InvIconView icon={item.icon} size={icon} />
      {item.progress !== undefined && (
        <Bar
          value={item.progress}
          tone={ready ? 'green' : 'blue'}
          height={4}
          className="ivx-slot-bar"
        />
      )}
    </Slot>
  );
}

/** Подсказка ячейки (наведение мышью, долгое нажатие): что это и где лежит. */
function ItemTip({ item }: { item: InvItem }): ReactNode {
  const r = rarityOfIcon(item.icon);
  return (
    <span className="arm-tip" style={rarityVars(r)}>
      <b>{item.name}</b>
      {item.sub && <i>{item.sub}</i>}
      <span className="arm-tip__row">
        <GxIcon name={whereIcon(item)} size={14} /> {t(`inv.where.${item.where}`)}
      </span>
      {item.price ? (
        <span className="arm-tip__row">
          <CoinIcon size={14} /> {t('inv.perPiece', { price: fmt(item.price) })}
        </span>
      ) : null}
    </span>
  );
}

function Limit({ l }: { l: InvSectionView['limits'][number] }) {
  const full = limitFull(l);
  return (
    <span className={`ivx-lim${full ? ' is-full' : ''}`}>
      <span>
        {l.label}{' '}
        <b className="arm-num">
          {l.used}/{l.max}
        </b>
      </span>
      <Bar value={l.max ? l.used / l.max : 0} tone={full ? 'gold' : 'blue'} height={5} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Экран.
// ---------------------------------------------------------------------------

type Sel = { key: string; kind: string } | null;
type Filter = 'all' | InvSection;
/** Кнопка действия: одна раскладка на всё, места не пляшут. */
interface Act {
  id: string;
  label: ReactNode;
  kind: 'confirm' | 'secondary' | 'danger';
  off?: boolean;
  run: () => void;
}

/**
 * Сколько мест под кнопки держит каждое место: столько, сколько бывает максимум. В шахте и во
 * дворе у вещи одно действие (выпить / бросить / в гнездо / продать рюкзак) — кнопка во всю ширину.
 */
const ACT_SLOTS: Record<InvPlace, number> = { bunk: 4, mine: 1, yard: 1, view: 0 };

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
  const { layout, u } = useArmLayout();
  const root = useRef<HTMLDivElement>(null);

  const atBunk = place === 'bunk';
  const lang = useLang();
  useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the names follow the language
  const sections = useMemo(() => inventoryOf(p, d, bunk), [p, d, bunk, lang]);
  const byKey = useMemo(() => {
    const m = new Map<string, InvItem>();
    for (const s of sections) for (const it of s.items) m.set(it.key, it);
    return m;
  }, [sections]);
  const bunkSec = sections.find((s) => s.id === 'bunk')!;
  // Рюкзак вылазки — раздел, только пока вылазка ждёт внизу; из самой
  // вылазки он виден живым в её инвентаре, здесь был бы снимок.
  const listed = sections.filter(
    (s) => !(atBunk && s.id === 'bunk') && (s.id !== 'sack' || (!!d.run && place !== 'view')),
  );

  // Сразу на подиуме — первая вещь (у койки — первая в сундуке): пустой подиум ничего не говорит.
  const [sel, setSel] = useState<Sel>(() => {
    const first =
      (atBunk ? bunkSec.items[0] : undefined) ??
      listed.flatMap((s) => s.items).find((it) => it.n > 0);
    return first ? { key: first.key, kind: first.kind } : null;
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [byRarity, setByRarity] = useState(false);
  const [note, setNote] = useState<{ key: number; text: string; bad?: boolean } | null>(null);
  const [armed, setArmed] = useState(false);

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
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => {
    if (!note) return undefined;
    const id = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(id);
  }, [note]);

  // Вещь выбрана по ключу; после переноса под тем же ключом может оказаться другая (книги
  // сдвигаются на полке) — тогда на подиуме остаётся тень прежней: «больше нет», кнопки
  // погашены. Подиум не перескакивает на соседнюю вещь — второй тап не унесёт её следом.
  const isBig = sel?.key === 'big';
  const picked = sel && !isBig ? byKey.get(sel.key) : undefined;
  const live = picked && picked.kind === sel!.kind ? picked : undefined;
  const lastRef = useRef<InvItem | undefined>(undefined);
  if (live) lastRef.current = live;
  const item = live ?? (isBig ? undefined : lastRef.current);
  const gone = !!item && !live;

  const say = (text: string, bad = false) => setNote({ key: Date.now(), text, bad });
  const pick = (it: InvItem) => {
    if (sel?.key === it.key && sel.kind === it.kind) return;
    selectionChanged();
    setNote(null);
    setArmed(false);
    setSel({ key: it.key, kind: it.kind });
  };
  const pickBig = () => {
    if (isBig) return;
    selectionChanged();
    setNote(null);
    setArmed(false);
    setSel({ key: 'big', kind: 'big' });
  };

  // ---- Действия ------------------------------------------------------------

  const toBunk = (it: InvItem, n: number) => {
    if (!it.ref) return;
    const got = bunkPut(it.ref, n);
    if (got > 0) {
      chestLatch();
      notifySuccess();
      say(`${t('inv.toChest', { name: it.name })}${got > 1 ? ` ×${got}` : ''}`);
    } else {
      softThud();
      notifyWarning();
      say(t('inv.chestFull'), true);
    }
  };
  const fromBunk = (it: InvItem, n: number) => {
    if (it.slot === undefined) return;
    const got = bunkTake(it.slot, n);
    if (got > 0) {
      chestLatch();
      notifySuccess();
      say(`${t(`inv.where.${homeOf(it)}`)}: +${got}`);
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
      say(t('inv.eggWarming'));
    } else {
      notifyWarning();
      say(t('inv.nestsBusy'), true);
    }
  };
  const applyItem = (it: InvItem) => {
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
      say(
        got.boxed
          ? t('inv.soldBoxed', { n: got.coins, coins: fmt(got.coins), boxed: fmt(got.boxed) })
          : t('inv.sold', { n: got.coins, coins: fmt(got.coins) }),
      );
    } else if (got.boxed > 0) {
      notifySuccess();
      say(t('inv.toBox', { n: fmt(got.boxed) }));
    }
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
      say(t('inv.bigBought'));
    } else {
      notifyWarning();
      say(t('inv.noCoins'), true);
    }
  };

  const bagSell = useMemo(() => {
    if (!bagCount(p.bag)) return 0;
    return bagValue(reserveOre(p.bag, p.forgeBox, nextPick(p)).bag, modsOf(p).sell);
  }, [p]);

  // ---- Кнопки выбранной вещи -------------------------------------------------
  const acts: Act[] = [];
  if (isBig && !bunk.big) {
    acts.push({
      id: 'buy',
      label: (
        <>
          <span className="arm-btn-txt">{armed ? t('inv.buySure') : t('inv.buy')}</span>
          <span className="arm-btn-price">
            {fmtShort(BUNK_BIG_PRICE)} <CoinIcon size={u * 7} />
          </span>
        </>
      ),
      kind: 'confirm',
      off: balance < BUNK_BIG_PRICE,
      run: () =>
        balance < BUNK_BIG_PRICE ? (notifyWarning(), say(t('inv.noCoins'), true)) : buyBig(),
    });
  } else if (item && !gone) {
    const can = actsOf(item, place);
    const thing = item.slot !== undefined ? bunk.slots[item.slot]?.thing : undefined;
    const refThing = item.ref ? thingOfRef({ p, d }, item.ref) : null;
    const room = refThing ? bunkRoom(bunk, refThing) : 0;
    const home = thing ? homeRoom({ p, d }, thing) : 0;
    const stackN = Math.max(1, Math.min(item.n, item.stack || 1));
    if (can.includes('use'))
      acts.push({
        id: 'use',
        label:
          item.key === 'item:energy'
            ? t('inv.drink')
            : item.key === 'item:prop'
              ? t('inv.place')
              : t('inv.turnOn'),
        kind: 'confirm',
        run: () => applyItem(item),
      });
    if (can.includes('throw'))
      acts.push({
        id: 'throw',
        label: item.key === 'item:charge' ? t('inv.plant') : t('inv.throw'),
        kind: 'confirm',
        run: () => applyItem(item),
      });
    if (can.includes('nest'))
      acts.push({ id: 'nest', label: t('inv.toNest'), kind: 'confirm', run: () => toNest(item) });
    if (can.includes('toBunk')) {
      if (room <= 0)
        acts.push({
          id: 'full',
          label: t('inv.chestFull'),
          kind: 'secondary',
          off: true,
          run: () => (notifyWarning(), say(t('inv.chestFull'), true)),
        });
      else {
        if (item.n > 1)
          acts.push({
            id: 'one',
            label: t('inv.toChest1'),
            kind: 'secondary',
            run: () => toBunk(item, 1),
          });
        if (stackN > 1 && stackN < item.n)
          acts.push({
            id: 'stack',
            label: t('inv.stackN', { n: String(stackN) }),
            kind: 'secondary',
            run: () => toBunk(item, stackN),
          });
        acts.push({
          id: 'all',
          label:
            item.n > 1 ? t('inv.all', { n: slotNum(Math.min(item.n, room)) }) : t('inv.toChestBtn'),
          kind: 'confirm',
          run: () => toBunk(item, item.n),
        });
      }
    }
    if (can.includes('fromBunk')) {
      if (home <= 0)
        acts.push({
          id: 'nohome',
          label: fullText(item),
          kind: 'secondary',
          off: true,
          run: () => (notifyWarning(), say(fullText(item), true)),
        });
      else {
        if (item.n > 1)
          acts.push({
            id: 'take1',
            label: t('inv.take1'),
            kind: 'secondary',
            run: () => fromBunk(item, 1),
          });
        acts.push({
          id: 'take',
          label: item.n > 1 ? t('inv.takeN', { n: String(Math.min(item.n, home)) }) : t('inv.take'),
          kind: 'confirm',
          run: () => fromBunk(item, item.n),
        });
      }
    }
    if (item.where === 'bag' && place !== 'view')
      acts.push({
        id: 'sell',
        label:
          bagSell > 0 ? (
            <>
              <span className="arm-btn-txt">{t('inv.sellBag', { price: fmtShort(bagSell) })}</span>
              <CoinIcon size={u * 7} />
            </>
          ) : (
            t('inv.bagToBox')
          ),
        kind: 'danger',
        run: sellBag,
      });
  }
  // Горячая клавиша X / Y на геймпаде — главное действие (первое «подтверждающее»).
  const main = acts.find((a) => a.kind === 'confirm' && !a.off) ?? acts.find((a) => !a.off);
  useAction(['inspect'], () => main?.run(), { scope: root, enabled: !!main });

  // ---- Витрина ----------------------------------------------------------------
  const roomRef = useRef<HTMLSpanElement>(null);
  const roomBox = useBox(roomRef);
  const stage = heroSize(roomBox, u, 160 * u);
  const art = Math.max(u, Math.floor((stage * 0.72) / u) * u);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const ped = Math.max(u, Math.round((stage * 0.8 * dpr) / 112) / dpr);

  const rarity = item ? rarityOfIcon(item.icon) : 0;
  const sec = item ? sections.find((s) => s.id === item.section) : undefined;
  const lim = sec?.limits[0];
  const n = gone ? 0 : (item?.n ?? 0);

  let heroArt: ReactNode = null;
  let name: ReactNode = '';
  let sub: ReactNode = '';
  if (isBig) {
    heroArt = <GxIcon name="chest" size={art} />;
    name = t('inv.bigChest');
    sub = t('inv.bigMore', { n: String(BUNK_BIG_SLOTS - bunkSize(bunk)) });
  } else if (item) {
    heroArt = <InvIconView icon={item.icon} size={art} />;
    name = item.name;
    sub = gone ? t('inv.gone') : (item.sub ?? '');
  } else {
    heroArt = <GxIcon name="backpack" size={art} />;
    name = atBunk ? t('inv.bunkTitle') : t('inv.title');
    sub = place === 'view' ? t('inv.hintView') : atBunk ? t('inv.hintBunk') : t('inv.hintAny');
  }

  const stats = (
    <div className="arm-stats">
      <span className="arm-stat">
        <b>×{isBig ? big(BUNK_BIG_SLOTS - bunkSize(bunk)) : big(n)}</b>
        <i>{isBig ? t('inv.lim.slots') : t('inv.statHave')}</i>
      </span>
      <span className="arm-stat">
        <b>
          <CoinIcon size={u * 8} />
          {isBig ? fmtShort(BUNK_BIG_PRICE) : item?.price ? fmtShort(item.price) : '—'}
        </b>
        <i>{isBig ? t('inv.buy') : t('inv.statPrice')}</i>
      </span>
      <span
        className={`arm-stat${item?.where === 'sack' && !isBig ? ' is-risk' : ''}`}
        title={item && !isBig ? t(`inv.where.${item.where}`) : undefined}
      >
        <b>{isBig ? big(bunkSec.limits[0].used) : lim ? big(lim.used) : '—'}</b>
        {(isBig || lim) && (
          <span className="arm-of">/{big(isBig ? bunkSec.limits[0].max : lim!.max)}</span>
        )}
        <i>{isBig ? t('inv.chest') : item ? t(`inv.where.${item.where}`) : t('inv.tabs')}</i>
      </span>
    </div>
  );

  const showcase = (
    <section className="arm-show" style={rarityVars(rarity)}>
      <Panel material="stone" stage className="arm-stage ivx-stage">
        <span ref={roomRef} className="arm-room">
          {stage > 0 && (
            <span className="arm-ped" style={{ '--ped': `${ped}px` } as CSSProperties}>
              <span
                className={`ivx-hero${gone || (item && item.n <= 0) ? ' is-ghost' : ''}`}
                style={{ width: stage, height: stage } as CSSProperties}
              >
                {heroArt}
              </span>
            </span>
          )}
        </span>
        <div className="arm-id px-dark">
          <h2 className="arm-name">{name}</h2>
          <p className="ivx-sub">{sub}</p>
        </div>
        {stats}
      </Panel>
    </section>
  );

  // ---- Подробности (две и три колонки) -----------------------------------------
  const hint = place === 'view' ? t('inv.hintView') : atBunk ? t('inv.hintBunk') : t('inv.hintAny');
  const details = (
    <div className="arm-details ivx-details">
      {isBig ? (
        <>
          <p>{t('inv.bigMore', { n: String(BUNK_BIG_SLOTS - bunkSize(bunk)) })}</p>
          <p className={`ivx-price${balance < BUNK_BIG_PRICE ? ' is-short' : ''}`}>
            <CoinIcon size={u * 8} /> <b className="arm-num">{fmt(BUNK_BIG_PRICE)}</b>
          </p>
        </>
      ) : item ? (
        <>
          {item.sub && <p>{item.sub}</p>}
          <div className="ivx-where">
            <Heading sub>{t('inv.whereHead')}</Heading>
            <p className={item.where === 'sack' ? 'is-risk' : undefined}>
              <GxIcon name={whereIcon(item)} size={u * 9} /> {t(`inv.where.${item.where}`)}
            </p>
          </div>
          {item.price ? (
            <p className="ivx-price">
              <CoinIcon size={u * 8} /> {t('inv.perPiece', { price: fmt(item.price) })}
            </p>
          ) : null}
          {atBunk && item.stack > 1 && <p>{t('inv.stackMax', { n: String(item.stack) })}</p>}
          {sec && sec.limits.length > 0 && (
            <div className="ivx-lims">
              {sec.limits.map((l) => (
                <Limit key={l.label} l={l} />
              ))}
            </div>
          )}
        </>
      ) : null}
      <p className="arm-muted">{hint}</p>
    </div>
  );

  // ---- Сетка -------------------------------------------------------------------
  const cell = u * 16;
  const order = (items: InvItem[]) =>
    byRarity
      ? items
          .map((it, i) => ({ it, i, r: rarityOfIcon(it.icon) }))
          .sort((a, b) => b.r - a.r || a.i - b.i)
          .map((x) => x.it)
      : items;
  const shown =
    filter === 'all'
      ? listed.filter((s) => s.items.length > 0)
      : listed.filter((s) => s.id === filter);
  const tabs = [
    { id: 'all' as Filter, label: t('inv.filterAll') },
    ...listed.map((s) => {
      const k = s.id === 'finds' ? s.limits[0].used : s.items.length;
      return {
        id: s.id as Filter,
        label: (
          <span className="ivx-tab" aria-label={s.name}>
            <GxIcon name={s.icon as GxIconName} size={u * 8} />
          </span>
        ),
        badge: k > 0 ? (k > 99 ? '99+' : k) : undefined,
      };
    }),
  ];

  const chest = atBunk && (
    <section className="ivx-sec ivx-chestsec">
      <div className="arm-head">
        <Heading>
          <GxIcon name="chest" size={u * 8} /> {t('inv.chest')}
        </Heading>
        <Limit l={bunkSec.limits[0]} />
      </div>
      <div className="ivx-chest" role="group" aria-label={t('inv.chest')}>
        {bunk.slots.map((s, i) => {
          const it = s ? byKey.get(`bunk:${i}`) : undefined;
          return it ? (
            <ItemSlot
              key={i}
              item={it}
              icon={u * 12}
              on={sel?.key === it.key}
              onPick={() => pick(it)}
            />
          ) : (
            <Slot
              key={i}
              empty
              aria-label={t('inv.empty')}
              onClick={() => {
                tapLight();
                say(hint);
              }}
            />
          );
        })}
        {!bunk.big && (
          <Slot
            locked
            selected={isBig}
            className="ivx-big"
            aria-label={t('inv.bigLocked')}
            tip={t('inv.bigLocked')}
            data-autofocus={isBig ? '' : undefined}
            onClick={pickBig}
            onFocus={pickBig}
          >
            <GxIcon name="chest" size={u * 10} />
          </Slot>
        )}
      </div>
      {!bunk.big && <p className="arm-muted ivx-lock">{t('inv.bigLocked')}</p>}
    </section>
  );

  const list = (
    <div className="arm-list ivx-list">
      <div className="ivx-bar">
        <Tabs
          className="ivx-tabs"
          items={tabs}
          value={filter}
          onChange={(f) => {
            tapLight();
            setFilter(f);
          }}
        />
        <Button
          size="sm"
          icon="sort"
          on={byRarity}
          label={t('inv.sortRarity')}
          onClick={() => {
            tapLight();
            setByRarity((v) => !v);
          }}
        />
      </div>
      <div className="ivx-scroll">
        {chest}
        {shown.map((s) => (
          <section key={s.id} className="ivx-sec">
            <div className="arm-head">
              <Heading>
                <GxIcon name={s.icon as GxIconName} size={u * 8} /> {s.name}
              </Heading>
              {s.limits.length > 0 && (
                <span className="ivx-lims">
                  {s.limits.map((l) => (
                    <Limit key={l.label} l={l} />
                  ))}
                </span>
              )}
            </div>
            {s.items.length ? (
              <div className="arm-grid ivx-grid" role="group" aria-label={s.name}>
                {order(s.items).map((it) => (
                  <ItemSlot
                    key={it.key}
                    item={it}
                    icon={cell}
                    on={sel?.key === it.key}
                    onPick={() => pick(it)}
                  />
                ))}
              </div>
            ) : (
              <p className="arm-muted">{t('inv.empty')}</p>
            )}
          </section>
        ))}
        {shown.length === 0 && <p className="arm-muted">{t('inv.empty')}</p>}
      </div>
    </div>
  );

  // Мест под кнопки — всегда одно и то же число на это место; лишние спрятаны (ничего не прыгает).
  const slots = ACT_SLOTS[place];
  const pad = Math.max(0, slots - acts.length);
  const actBar =
    slots > 0 ? (
      <div className="arm-acts ivx-acts" style={{ '--n': slots } as CSSProperties}>
        {Array.from({ length: pad }, (_, i) => (
          <Button key={`pad${i}`} kind="secondary" className="is-hidden" aria-hidden tabIndex={-1}>
            ·
          </Button>
        ))}
        {acts.slice(0, slots).map((a) => (
          <Button
            key={a.id}
            kind={a.kind}
            off={a.off}
            hint={a === main ? 'inspect' : undefined}
            className={a.id === 'buy' && armed ? 'is-armed' : undefined}
            onClick={a.run}
          >
            {a.label}
          </Button>
        ))}
      </div>
    ) : (
      <p className="arm-acts ivx-acts is-hint arm-muted">{hint}</p>
    );

  // Портал живёт в дереве React у хозяина: касания не должны всплывать к нему (джойстик
  // площади, фон инвентаря вылазки).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return createPortal(
    <div
      ref={root}
      className={`px arm arm--${layout} is-window ivx${atBunk ? ' is-bunk' : ''}`}
      role="dialog"
      aria-label={atBunk ? t('inv.bunkTitle') : t('inv.title')}
      onClick={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <header className="arm-top">
        <Button
          icon="left"
          label={t('inv.close')}
          className="arm-top__back"
          onClick={() => {
            tapLight();
            onClose();
          }}
        />
        <Heading ribbon className="arm-top__title">
          {atBunk ? (layout === 'one' ? t('inv.chest') : t('inv.bunkTitle')) : t('inv.title')}
        </Heading>
        <span className="arm-purse">
          <span>
            <CoinIcon size={u * 8} />
            <b className="arm-num">{fmtShort(balance)}</b>
          </span>
          {layout !== 'one' && (
            <span>
              <TokenIcon size={u * 8} />
              <b className="arm-num">{fmtShort(p.tokens)}</b>
            </span>
          )}
        </span>
      </header>
      {showcase}
      {list}
      {layout === 'one' ? (
        actBar
      ) : (
        <aside className="arm-side">
          <Panel material="obsidian" className="arm-info">
            <div className="arm-info__head">
              <h3 className="arm-info__name">{name}</h3>
              <span className={rarity > 0 && item ? undefined : 'ivx-hide'}>
                <RarityChip rarity={rarity} />
              </span>
            </div>
            {details}
          </Panel>
          {actBar}
        </aside>
      )}
      {note && (
        <div className={`arm-note${note.bad ? ' is-bad' : ''}`} key={note.key} role="status">
          {note.text}
        </div>
      )}
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
      return t('inv.basketFull');
    case 'shelf':
      return t('inv.shelfFull');
    case 'pouch':
      return t('inv.pouchFull');
    default:
      return t('inv.nowhere');
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
