// Питомник: окно на тёмном наборе (`@/ui-px/dark`), раскладка из handoff N4 (19.10) — брат кузницы.
// Шапка (назад · «Питомник» + зачем · кошелёк), вкладки «Отряд» / «Коллекция» / «Яйца»; отряд и
// коллекция — `Nursery.tsx`, яйца (гнёзда, очередь, «вылупить все», лавка) — здесь, как и сцены
// вылупления. Правила — lib/pets.ts, стор — prisonHatch, prisonHatchAll, prisonEggBuy,
// prisonEggPlace, prisonEggPull, prisonHatchNow.
//
// Исход вылупления решает стор в обработчике тапа (как у сундука: StrictMode
// в разработке гоняет эффекты дважды), сцена его только показывает. Трещины
// светятся цветом редкости ДО того, как яйцо лопнет: «что-то редкое» видно
// заранее, и в эту секунду смотрят не отрываясь.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { RarityName, rarityVars } from '@/components/PickArt';
import { EggArt, PetArt } from '@/components/PetArt';
import { Nursery } from '@/components/Nursery';
import type { NurTab } from '@/components/Nursery';
import { useArmGuard, useArmLayout, useBox, useFullWin } from '@/components/armory';
import { Icon } from '@/ui-px';
import { PxdButton, PxdPips, PxdSheet, usePxd } from '@/ui-px/dark';
import { useAction } from '@/input';
import { fmtNum, fmtShort, petName, t as tl, useT } from '@/i18n';
import { eggName } from '@/i18n/data-books';
import { PxStrip, preloadPx } from '@/components/PxStrip';
import { CoinIcon } from '@/components/slot-art';
import { TokenIcon } from '@/components/camp-art';
import { useFinanceStore } from '@/store';
import type { HatchResult } from '@/store';
import { RARITIES, rarityOf } from '@/lib/rarity';
import { rankLetter } from '@/lib/prison';
import {
  canMerge,
  eggChances,
  eggCount,
  eggOf,
  EGGS,
  EGG_BASKET,
  EGG_IDS,
  hatchAllPlan,
  hatchNowCost,
  MERGE_NEED,
  NEST_SLOTS,
  PET_TREAT_XP,
  PETS,
  petBonus,
  petLook,
} from '@/lib/pets';
import type { EggId, PetId, PetStat } from '@/lib/pets';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import {
  eggCrack,
  eggHatch,
  eggWobble,
  primeAudio,
  uiBuy,
  uiClose,
  uiError,
  uiOpen,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';
import '@/components/armory.css';

const fmt = (n: number) => fmtNum(n);
/** Bonus share → percent with one decimal, as the Nursery shows it. */
const pctV = (x: number) => Math.round(x * 1000) / 10;
const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
/** An egg picture at a whole number of screen dots per art pixel of the 36-px egg strip. */
const eggPx = (want: number, dpr = dprNow()) =>
  (Math.max(1, Math.floor((want * dpr) / 36)) * 36) / dpr;
const rc = (r: number) => ({ '--rc': RARITIES[r]?.color }) as CSSProperties;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Цвет яйца — по лучшей редкости, какая из него бывает. */
export const EGG_RARITY: Record<EggId, number> = { moss: 2, stone: 3, crystal: 4, dragon: 5 };

/** Прибавки питомца словами: «+6% к добыче · +3% к скорости копки». */
export function petLine(id: PetId, rec: { xp: number; v: number }): string {
  const b = petBonus(id, rec);
  return (Object.keys(b) as PetStat[])
    .map((k) => tl(`nursery.role.${k}.text`, { v: pctV(b[k] ?? 0) }))
    .join(' · ');
}

/** Шансы яйца словами: «Редкий 60% · Эпический 30% · …» (подсказка и aria). */
function oddsText(egg: EggId): string {
  return eggChances(egg)
    .map((c, r) =>
      c > 0
        ? `${tl(`nursery.rarity.r${r}` as 'nursery.rarity.r0')} ${tl('nursery.eggPct', { v: pctV(c) })}`
        : '',
    )
    .filter(Boolean)
    .join(' · ');
}

/** Полоска шансов яйца: доли редкостей их цветами, по пикселю рисунка в высоту. */
function OddsBar({ egg }: { egg: EggId }) {
  const ch = eggChances(egg);
  return (
    <span className="nrs-odds" aria-hidden="true">
      {ch.map((c, r) =>
        c > 0 ? <i key={r} style={{ flexGrow: Math.max(c, 0.06), background: rarityOf(r).color }} /> : null,
      )}
    </span>
  );
}

/**
 * The pets screen: a full window on the dark kit (as the forge). `onClose` may change identity on
 * every render of the camp — it is kept in a ref, the window itself is memoised.
 */
export function PetsTab({ onClose }: { onClose?: () => void }) {
  const ref = useRef(onClose);
  ref.current = onClose;
  const close = useCallback(() => ref.current?.(), []);
  return <PetsWin onClose={close} />;
}

const TABS: NurTab[] = ['squad', 'coll', 'eggs'];

const PetsWin = memo(function PetsWin({ onClose }: { onClose: () => void }) {
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const hatch = useFinanceStore((s) => s.prisonHatch);
  const buyEgg = useFinanceStore((s) => s.prisonEggBuy);
  const place = useFinanceStore((s) => s.prisonEggPlace);
  const hatchAll = useFinanceStore((s) => s.prisonHatchAll);
  const t = useT();
  const { layout, u } = useArmLayout();
  const root = useRef<HTMLDivElement>(null);
  usePxd();
  useFullWin();
  useEffect(() => {
    uiOpen();
    const off = registerEscape(() => onClose());
    return () => {
      off();
      uiClose();
    };
  }, [onClose]);

  /** A ready nest opens straight on the eggs. */
  const [tab, setTab] = useState<NurTab>(() =>
    p.nest.some((n) => n.left <= 0) ? 'eggs' : 'squad',
  );
  const [sel, setSel] = useState<PetId>(
    () => p.squad[0] ?? PETS.find((d) => p.pets[d.id])?.id ?? PETS[0].id,
  );
  // Stable for the memoised Nursery.
  const onTab = useCallback((v: NurTab) => setTab(v), []);
  const pickTab = (v: NurTab) => {
    if (v === tab) return;
    selectionChanged();
    setTab(v);
  };
  useAction(
    ['tabPrev', 'tabNext'],
    (e) => {
      const d = e.action === 'tabNext' ? 1 : TABS.length - 1;
      selectionChanged();
      setTab((x) => TABS[(TABS.indexOf(x) + d) % TABS.length]);
    },
    { scope: root },
  );

  const [nestAt, setNestAt] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const armT = useRef<ReturnType<typeof setTimeout>>();
  const guard = useArmGuard();
  /** Дорогая покупка — в два касания: первое взводит, второе платит (второе быстрее 400 мс —
   *  половина двойного тапа, его не считаем). */
  const arm = (key: string) => {
    if (armed === key) return !guard.tooSoon();
    setArmed(key);
    guard.mark();
    clearTimeout(armT.current);
    armT.current = setTimeout(() => setArmed(null), 4000);
    return false;
  };
  const [scene, setScene] = useState<{ res: HatchResult; key: number } | null>(null);
  const [batch, setBatch] = useState<{
    list: HatchResult[];
    coins: number;
    tokens: number;
    key: number;
  } | null>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const noteT = useRef<ReturnType<typeof setTimeout>>();
  // Stable: the memoised Nursery takes it.
  const say = useCallback((text: string) => {
    setNote((n) => ({ id: (n?.id ?? 0) + 1, text }));
    clearTimeout(noteT.current);
    noteT.current = setTimeout(() => setNote(null), 2200);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(noteT.current);
      clearTimeout(armT.current);
    },
    [],
  );
  const eggsAll = p.nest.length + eggCount(p.eggs);
  const anyReady = p.nest.some((n) => n.left <= 0);
  const plan = hatchAllPlan(p.nest, p.eggs, p.eggHeat, balance, p.tokens);
  // Не хватает ни на одно — кнопка серая, но цена всего видна.
  const price = plan.picks.length
    ? plan
    : hatchAllPlan(p.nest, p.eggs, p.eggHeat, Infinity, Infinity);

  const doHatch = (i: number) => {
    primeAudio();
    const res = hatch(i);
    if (!res) return;
    // Полоса вылупления качается сразу после броска; сцена ждёт её декодирования.
    void preloadPx('eggs', `hatch-${res.egg}-r${res.rarity}`, 220);
    tapMedium();
    setScene({ res, key: Date.now() });
  };

  /** «Вылупить все» (v2.121): созревшие даром, остальные за цену яйца. */
  const doHatchAll = () => {
    primeAudio();
    if (!plan.picks.length) {
      uiError();
      notifyWarning();
      // Чего не хватает на самое дешёвое яйцо — монет или токенов.
      const have = EGG_IDS.filter((id) => p.eggs[id] > 0 || p.nest.some((n) => n.egg === id));
      const coin = have.filter((id) => !eggOf(id).tokens).map((id) => eggOf(id).price);
      const tok = have.filter((id) => eggOf(id).tokens).map((id) => eggOf(id).tokens ?? 0);
      const miss: string[] = [];
      if (coin.length) miss.push(t('eggs.missCoins', { v: fmtShort(Math.min(...coin) - balance) }));
      if (tok.length)
        miss.push(t('eggs.missTokens', { n: Math.round(Math.min(...tok) - p.tokens) }));
      say(
        t('eggs.miss', {
          what: miss.length > 1 ? t('eggs.missOr', { a: miss[0], b: miss[1] }) : (miss[0] ?? ''),
        }),
      );
      return;
    }
    if ((plan.coins || plan.tokens) && !arm('all')) {
      if (armed !== 'all') {
        tapLight();
        say(t('eggs.armAll'));
      }
      return;
    }
    setArmed(null);
    const list = hatchAll();
    if (!list) return;
    tapMedium();
    // Одно яйцо — обычная сцена вылупления, итог нужен только пачке.
    if (list.length === 1) setScene({ res: list[0], key: Date.now() });
    else setBatch({ list, coins: plan.coins, tokens: plan.tokens, key: Date.now() });
  };

  const nestRow = useRef<HTMLDivElement>(null);
  const nb = useBox(nestRow, tab === 'eggs');
  // the egg fills the nest's art box (measured in the fit pass: a two-line «blocks left» on a
  // narrow nest takes some of it); before the first measure — an estimate from the row
  const [nestArt, setNestArt] = useState({ w: 0, h: 0 });
  const nestEgg = eggPx(
    Math.max(
      18 * u,
      nestArt.h > 0
        ? Math.min(nestArt.w - 2 * u, nestArt.h - 2 * u, 64 * u)
        : Math.min((nb.w - 4 * u) / 2 - 10 * u, nb.h - 40 * u, 64 * u),
    ),
  );
  const shopRow = useRef<HTMLDivElement>(null);
  const sb = useBox(shopRow, tab === 'eggs');
  // the egg follows the tile: a low tile (short phones) takes the small egg, else the text loses
  // room; a tall wide-screen tile stacks art / name / price / status and grows the egg
  const tileH = (sb.h - 3 * u) / 2;
  const tileW = (sb.w - 3 * u) / 2;
  const shopTall = layout === 'three' && tileH >= 56 * u;
  const shopEgg = eggPx(
    layout === 'one'
      ? (tileH >= 40 * u ? 20 : 16) * u
      : layout === 'two'
        ? 28 * u
        : shopTall
          ? Math.min(tileH - 34 * u, tileW * 0.5, 56 * u)
          : (tileH >= 40 * u ? 24 : 16) * u,
  );
  // ---- Fit pass: the purpose line on its own row, tab icons / tab size, the queue label -------
  const [fitTick, setFitTick] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
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
    const top = el.querySelector<HTMLElement>('.nrs-top');
    const sub = top?.querySelector<HTMLElement>('.nrs-ttl p');
    if (top && sub) {
      top.classList.remove('is-subrow');
      if (layout === 'one')
        top.classList.toggle('is-subrow', sub.scrollWidth > sub.clientWidth + 0.5);
    }
    // the tabs drop their icons, then take the label size, when the words don't fit the row
    const tabsEl = el.querySelector<HTMLElement>('.nrs-tabs');
    if (tabsEl) {
      tabsEl.classList.remove('is-tight', 'is-tight2');
      const over = () =>
        [...tabsEl.querySelectorAll<HTMLElement>('.nrs-tab')].some(
          (b) => b.scrollWidth > b.clientWidth + 0.5,
        );
      if (over()) tabsEl.classList.add('is-tight');
      if (over()) tabsEl.classList.add('is-tight2');
    }
    const q = el.querySelector<HTMLElement>('.nrs-queue');
    if (q) {
      q.classList.remove('is-tight');
      q.classList.toggle('is-tight', q.scrollWidth > q.clientWidth + 0.5);
    }
    // nests and shop tiles: their words one size smaller (the shop's status under the art)
    const cut = (sel: string) =>
      [...el.querySelectorAll<HTMLElement>(sel)].some((x) => x.scrollWidth > x.clientWidth + 0.5);
    const row = el.querySelector<HTMLElement>('.nrs-nests__row');
    if (row) {
      row.classList.remove('is-tight', 'is-tight2');
      if (cut('.nrs-nest__nm, .nrs-nest__left')) row.classList.add('is-tight');
      if (cut('.nrs-nest__nm, .nrs-nest__left')) row.classList.add('is-tight2');
      const art = row.querySelector<HTMLElement>('.nrs-nest:not(.is-empty) .nrs-nest__art');
      const w = art?.clientWidth ?? 0;
      const h = art?.clientHeight ?? 0;
      setNestArt((o) => (o.w === w && o.h === h ? o : { w, h }));
    }
    const shop = el.querySelector<HTMLElement>('.nrs-shop');
    if (shop) {
      shop.classList.remove('is-tight');
      shop.classList.toggle('is-tight', cut('.nrs-buy__nm, .nrs-buy__st'));
    }
  }, [fitTick, layout, tab, t, p.eggs, p.nest, armed, balance, p.tokens, u, shopEgg, nb.w, nb.h]);

  const tabBtn = (id: NurTab, icon: GxIconName, label: string, badge?: ReactNode) => (
    <PxdButton
      frame={tab === id ? 'sel' : 'panel'}
      className={`nrs-tab${tab === id ? ' is-on' : ''}`}
      role="tab"
      aria-selected={tab === id}
      onClick={() => pickTab(id)}
    >
      <GxIcon name={icon} />
      <span className="nrs-tab__l">{label}</span>
      {badge != null && badge !== 0 && <em className="nrs-badge">{badge}</em>}
    </PxdButton>
  );
  const tabs = (
    <nav className="nrs-tabs" role="tablist">
      {tabBtn('squad', 'miner', t('nursery.squad'))}
      {tabBtn('coll', 'paw', t('nursery.collection'))}
      {tabBtn('eggs', 'egg', t('nursery.tabEggs'), anyReady ? '!' : eggsAll || null)}
    </nav>
  );

  // ---- Eggs: nests · queue · hatch all · shop ---------------------------------------------------
  // the egg takes what the nest tile leaves after its name, pips and blocks line (measured row)
  const chipEgg = eggPx(12 * u);
  const heatPips = (id: EggId) => {
    const h = p.eggHeat[id] ?? 0;
    if (h <= 0) return null;
    return <PxdPips n={4} on={Math.max(1, Math.min(4, Math.floor((4 * h) / eggOf(id).need)))} />;
  };
  const queue = EGG_IDS.filter((id) => p.eggs[id] > 0);
  const eggsEl = tab === 'eggs' && (
    <div className="nrs-eggs">
      <div className="nrs-eggs__home">
        <section className="nrs-nests" aria-label={t('eggs.nests')}>
          <div className="nrs-h">
            <h2>{t('eggs.nests')}</h2>
            <span className="px-num">{t('eggs.someOf', { a: p.nest.length, b: NEST_SLOTS })}</span>
          </div>
          <div ref={nestRow} className="nrs-nests__row">
            {Array.from({ length: NEST_SLOTS }, (_, i) => {
              const n = p.nest[i];
              if (!n)
                return (
                  <PxdButton
                    key={i}
                    frame="well"
                    className="nrs-nest is-empty"
                    onClick={() => {
                      tapLight();
                      if (eggCount(p.eggs) > 0) setNestAt(i);
                      else say(t('eggs.basketEmpty'));
                    }}
                  >
                    <span className="nrs-nest__art">
                      <Icon name={eggCount(p.eggs) > 0 ? 'plus' : 'egg'} />
                    </span>
                    <span className="nrs-nest__nm">
                      {eggCount(p.eggs) > 0 ? t('eggs.putEgg') : t('eggs.empty')}
                    </span>
                  </PxdButton>
                );
              const need = eggOf(n.egg).need;
              const ready = n.left <= 0;
              return (
                <PxdButton
                  key={i}
                  frame={ready ? 'act' : 'panel'}
                  className={`nrs-nest${ready ? ' is-ready' : ''}`}
                  style={rc(EGG_RARITY[n.egg])}
                  aria-label={`${eggName(n.egg)}: ${ready ? t('eggs.hatch') : t('books.blocksLeft', { n: Math.round(n.left) })}`}
                  onClick={() => {
                    if (ready) doHatch(i);
                    else {
                      tapLight();
                      setNestAt(i);
                    }
                  }}
                >
                  <span className="nrs-nest__art">
                    <EggArt egg={n.egg} size={nestEgg} phase={i * 0.37} />
                  </span>
                  <b className="nrs-nest__nm">{t(`nursery.egg.${n.egg}`)}</b>
                  {ready ? (
                    <span className="nrs-nest__go">{t('eggs.hatch')}</span>
                  ) : (
                    <>
                      <PxdPips n={10} on={Math.floor(10 * (1 - n.left / need))} />
                      <span className="nrs-nest__left px-num">
                        {t('books.blocksLeft', { n: Math.round(n.left) })}
                      </span>
                    </>
                  )}
                </PxdButton>
              );
            })}
          </div>
        </section>
        <section className="nrs-queue" aria-label={t('eggs.waiting')}>
          <span className="nrs-queue__l">{t('eggs.waiting')}</span>
          {queue.length ? (
            queue.map((id) => (
              <PxdButton
                key={id}
                className="nrs-qchip"
                style={rc(EGG_RARITY[id])}
                aria-label={`${eggName(id)} ×${p.eggs[id]}`}
                onClick={() => {
                  primeAudio();
                  if (p.nest.length < NEST_SLOTS && place(id)) {
                    selectionChanged();
                    say(t('eggs.toNest', { name: eggName(id) }));
                  } else {
                    tapLight();
                    say(t('eggs.nestsBusy'));
                  }
                }}
              >
                <EggArt egg={id} size={chipEgg} still />
                <span className="nrs-qchip__t">
                  <b className="px-num">×{p.eggs[id]}</b>
                  {heatPips(id)}
                </span>
              </PxdButton>
            ))
          ) : (
            <span className="nrs-queue__none">{t('eggs.basketEmpty')}</span>
          )}
        </section>
        {eggsAll >= 2 && (
          <PxdButton
            frame="act"
            off={!plan.picks.length}
            className={`nrs-all${armed === 'all' ? ' is-armed' : ''}`}
            onClick={doHatchAll}
          >
            <GxIcon name="egg" />
            <span className="nrs-all__t">
              {/* the count goes to the price line: the button stays short (≤ 5:1) */}
              <b>
                {t(armed === 'all' ? 'eggs.sureAll' : 'eggs.hatchAll', { count: '' })
                  .replace(/\s+/g, ' ')
                  .trim()}
              </b>
              <small className="px-num">
                <span>
                  {plan.picks.length && plan.picks.length < eggsAll
                    ? t('eggs.someOf', { a: plan.picks.length, b: eggsAll })
                    : `×${eggsAll}`}
                </span>
                {price.coins > 0 && (
                  <span>
                    <CoinIcon size={7 * u} /> {fmtShort(price.coins)}
                  </span>
                )}
                {price.tokens > 0 && (
                  <span>
                    <TokenIcon size={7 * u} /> {fmt(price.tokens)}
                  </span>
                )}
                {!price.coins && !price.tokens && <span>{t('eggs.free')}</span>}
              </small>
            </span>
          </PxdButton>
        )}
      </div>
      <section className="nrs-shop" aria-label={t('eggs.shop')}>
        <div className="nrs-h">
          <h2>{t('eggs.shop')}</h2>
        </div>
        <div ref={shopRow} className="nrs-shop__grid">
          {EGGS.map((e) => {
            const tok = e.tokens ?? 0;
            const sold = e.price > 0 || tok > 0;
            const locked = sold && !tok && p.rank < e.from;
            const room = p.nest.length < NEST_SLOTS || eggCount(p.eggs) < EGG_BASKET;
            const rich = tok ? p.tokens >= tok : balance >= e.price;
            const can = sold && !locked && room && rich;
            const short = tok ? tok - p.tokens : e.price - balance;
            const odds = oddsText(e.id);
            return (
              <PxdButton
                key={e.id}
                frame={armed === e.id ? 'sel' : 'panel'}
                off={!can}
                className={`nrs-buy${can ? ' is-can' : ''}${armed === e.id ? ' is-armed' : ''}${shopTall ? ' is-tall' : ''}`}
                style={rc(EGG_RARITY[e.id])}
                data-tip={odds}
                aria-label={`${eggName(e.id)}, ${tok ? fmt(tok) : fmtShort(e.price)}. ${odds}`}
                onClick={() => {
                  primeAudio();
                  if (locked) {
                    uiError();
                    notifyWarning();
                    say(t('eggs.fromRank', { r: rankLetter(e.from) }));
                    return;
                  }
                  if (!room) {
                    uiError();
                    say(t('eggs.basketFullHatch'));
                    return;
                  }
                  if (!rich) {
                    uiError();
                    notifyWarning();
                    say(
                      t('eggs.miss', {
                        what: tok
                          ? t('eggs.missTokens', { n: Math.round(tok - p.tokens) })
                          : t('eggs.missCoins', { v: fmtShort(e.price - balance) }),
                      }),
                    );
                    return;
                  }
                  if (tok && !arm(e.id)) {
                    if (armed !== e.id) {
                      tapLight();
                      say(t('eggs.buyArm', { name: eggName(e.id), n: tok }));
                    }
                    return;
                  }
                  setArmed(null);
                  if (buyEgg(e.id)) {
                    uiBuy();
                    tapMedium();
                    say(
                      t(p.nest.length < NEST_SLOTS ? 'eggs.toNest' : 'eggs.toBasket', {
                        name: eggName(e.id),
                      }),
                    );
                  }
                }}
              >
                <span className="nrs-buy__art">
                  <EggArt egg={e.id} size={shopEgg} still />
                  <OddsBar egg={e.id} />
                </span>
                <b className="nrs-buy__nm">{t(`nursery.egg.${e.id}`)}</b>
                <span className="nrs-buy__price px-num">
                  {tok ? <TokenIcon size={7 * u} /> : <CoinIcon size={7 * u} />}
                  {tok ? fmt(tok) : fmtShort(e.price)}
                </span>
                <span
                  className={`nrs-buy__st${can ? ' is-ok' : ''}${sold && !locked && room && !rich ? ' is-more' : ''}`}
                >
                  {locked ? (
                    <>
                      <Icon name="lock" />
                      {t('eggs.rank', { r: rankLetter(e.from) })}
                    </>
                  ) : !room ? (
                    t('eggs.noRoom')
                  ) : !rich ? (
                    <>
                      {t('eggs.more', { v: tok ? fmt(Math.round(short)) : fmtShort(short) })}
                      {tok ? <TokenIcon size={6 * u} /> : <CoinIcon size={6 * u} />}
                    </>
                  ) : armed === e.id ? (
                    t('eggs.sure')
                  ) : (
                    t('eggs.avail')
                  )}
                </span>
              </PxdButton>
            );
          })}
        </div>
      </section>
    </div>
  );

  return createPortal(
    <div
      ref={root}
      className={`px pxd arm is-window nrs nrs--${layout} is-${tab}`}
      role="dialog"
      aria-label={t('mineHud.dock.nursery')}
    >
      <header className="nrs-top">
        <PxdButton
          className="nrs-back"
          aria-label={t('common.back')}
          onClick={() => {
            tapLight();
            onClose();
          }}
        >
          <Icon name="left" />
        </PxdButton>
        <div className="nrs-ttl">
          <h1>{t('mineHud.dock.nursery')}</h1>
          <p>{t('nursery.purpose')}</p>
        </div>
        {layout === 'three' && tabs}
        <span
          className="nrs-purse"
          aria-label={`${fmtShort(balance)} · ${fmt(p.tokens)}`}
        >
          <span>
            <CoinIcon size={7 * u} />
            <b className="px-num">{fmtShort(balance)}</b>
          </span>
          <span>
            <TokenIcon size={7 * u} />
            <b className="px-num">{fmt(p.tokens)}</b>
          </span>
        </span>
      </header>
      {layout !== 'three' && tabs}
      {tab === 'eggs' ? (
        eggsEl
      ) : (
        <Nursery tab={tab} sel={sel} onSel={setSel} onTab={onTab} say={say} layout={layout} u={u} />
      )}
      {note && (
        <div className="arm-note nrs-note pxd-f pxd-f--panel" key={note.id} role="status">
          {note.text}
        </div>
      )}
      {nestAt !== null && (
        <NestSheet
          i={nestAt}
          u={u}
          onClose={() => setNestAt(null)}
          onHatch={(i) => {
            setNestAt(null);
            doHatch(i);
          }}
        />
      )}
      {scene &&
        createPortal(
          <HatchScene
            key={scene.key}
            res={scene.res}
            onAgain={() => {
              const i = useFinanceStore.getState().prison.nest.findIndex((x) => x.left <= 0);
              if (i < 0) setScene(null);
              else doHatch(i);
            }}
            onClose={() => setScene(null)}
          />,
          document.body,
        )}
      {batch &&
        createPortal(
          <HatchBatch
            key={batch.key}
            list={batch.list}
            coins={batch.coins}
            tokens={batch.tokens}
            onClose={() => setBatch(null)}
          />,
          document.body,
        )}
    </div>,
    document.body,
  );
});

/**
 * Гнездо (v2.76): что в нём греется, вынуть в корзину, положить другое взамен, вылупить сразу за
 * цену яйца. Прогрев вынутого не сгорает — он остаётся за видом яйца (`pullEgg`). Сообщения — своей
 * строкой в окне: тост окна лежит под его вуалью.
 */
function NestSheet({
  i,
  u,
  onClose,
  onHatch,
}: {
  i: number;
  u: number;
  onClose: () => void;
  onHatch: (i: number) => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const pull = useFinanceStore((s) => s.prisonEggPull);
  const place = useFinanceStore((s) => s.prisonEggPlace);
  const now = useFinanceStore((s) => s.prisonHatchNow);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState('');
  const guard = useArmGuard();
  const n = p.nest[i];
  // Цена «вылупить сразу» — цена яйца: монеты или токены (драконье).
  const cost = n ? hatchNowCost(n.egg) : { coins: 0, tokens: 0 };
  const price = cost.coins || cost.tokens;
  const short = cost.coins ? cost.coins - balance : cost.tokens - p.tokens;
  const basket = EGG_IDS.filter((id) => p.eggs[id] > 0 && id !== n?.egg);
  const full = eggCount(p.eggs) >= EGG_BASKET;
  useEffect(() => {
    if (!armed) return;
    const tm = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(tm);
  }, [armed]);
  const need = n ? eggOf(n.egg).need : 1;
  return (
    <PxdSheet
      title={n ? eggName(n.egg) : t('eggs.nest')}
      sub={
        n ? (n.left > 0 ? t('books.blocksLeft', { n: Math.round(n.left) }) : t('eggs.ready')) : undefined
      }
      closeLabel={t('common.close')}
      onClose={onClose}
      width={200}
      className="nrs-sheet"
    >
      <div className="nrs-ns">
        {n && (
          <div className="nrs-ns__now" style={rc(EGG_RARITY[n.egg])}>
            <span className="nrs-ns__art">
              <EggArt egg={n.egg} size={eggPx(36 * u)} />
            </span>
            <PxdPips n={10} on={n.left > 0 ? Math.floor(10 * (1 - n.left / need)) : 10} />
            <div className="nrs-ns__acts">
              {price > 0 && n.left > 0 && (
                <PxdButton
                  frame="act"
                  off={short > 0}
                  className={`nrs-ns__now-b${armed ? ' is-armed' : ''}`}
                  data-autofocus=""
                  onClick={() => {
                    primeAudio();
                    if (short > 0) {
                      uiError();
                      notifyWarning();
                      setMsg(
                        t('eggs.miss', {
                          what: cost.coins
                            ? t('eggs.missCoins', { v: fmtShort(short) })
                            : t('eggs.missTokens', { n: Math.round(short) }),
                        }),
                      );
                      return;
                    }
                    if (!armed) {
                      tapLight();
                      guard.mark();
                      setArmed(true);
                      return;
                    }
                    if (guard.tooSoon()) return;
                    if (now(i)) onHatch(i);
                  }}
                >
                  <span>{armed ? t('eggs.sure') : t('eggs.hatchNow')}</span>
                  <small className="px-num">
                    {cost.coins ? fmtShort(price) : fmt(price)}
                    {cost.coins ? <CoinIcon size={7 * u} /> : <TokenIcon size={7 * u} />}
                  </small>
                </PxdButton>
              )}
              <PxdButton
                off={full}
                onClick={() => {
                  primeAudio();
                  if (!pull(i)) {
                    uiError();
                    setMsg(t('eggs.basketFull'));
                    return;
                  }
                  selectionChanged();
                  onClose();
                }}
              >
                {t('eggs.toBasketBtn')}
              </PxdButton>
            </div>
          </div>
        )}
        {basket.length > 0 ? (
          <>
            <h3 className="nrs-ns__h">{t(n ? 'eggs.putInstead' : 'eggs.putInNest')}</h3>
            <div className="nrs-ns__basket">
              {basket.map((id) => (
                <PxdButton
                  key={id}
                  className="nrs-ns__egg"
                  style={rc(EGG_RARITY[id])}
                  aria-label={`${eggName(id)} ×${p.eggs[id]}`}
                  data-autofocus={!n ? '' : undefined}
                  onClick={() => {
                    primeAudio();
                    if (!place(id, n ? i : undefined)) return;
                    selectionChanged();
                    onClose();
                  }}
                >
                  <EggArt egg={id} size={eggPx(20 * u)} still />
                  <b className="px-num">×{p.eggs[id]}</b>
                  {p.eggHeat[id] > 0 && (
                    <PxdPips
                      n={4}
                      on={Math.max(1, Math.min(4, Math.floor((4 * p.eggHeat[id]) / eggOf(id).need)))}
                    />
                  )}
                </PxdButton>
              ))}
            </div>
          </>
        ) : (
          !n && <p className="nrs-ns__none">{t('eggs.basketEmpty')}</p>
        )}
        <p className="nrs-ns__msg" role="status">
          {msg}
        </p>
      </div>
    </PxdSheet>
  );
}

// ---- Сцена вылупления --------------------------------------------------------

type HPhase = 'egg' | 'burst' | 'reveal' | 'done';

/**
 * Сцена вылупления: пиксельная полоса `hatch-<яйцо>-r<редкость>` (`lib/props-pixel/eggs.ts`)
 * играет качку, трещины и разлом сама; звук, вспышка и показ питомца — по её меткам
 * (`w1…w3`, `crack1…3`, `burst`, `clear`), конец полосы — кнопки. Чем реже, тем дольше
 * качается (`HATCH_WOB`).
 */
function HatchScene({
  res,
  onAgain,
  onClose,
}: {
  res: HatchResult;
  onAgain: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const r = res.rarity;
  const rec = p.pets[res.id];
  const [phase, setPhase] = useState<HPhase>(() => (reduceMotion() ? 'done' : 'egg'));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);
  const hatched = phase !== 'egg';
  const shown = phase === 'reveal' || phase === 'done';

  useEffect(() => {
    if (reduceMotion()) eggHatch(r);
    // Сцена играет один раз на яйцо (новое яйцо — новый ключ компонента).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMark = (m: string) => {
    if (m === 'w1') eggWobble(0);
    else if (m === 'w2' || m === 'w3') {
      eggWobble(m === 'w2' ? 1 : 2);
      tapLight();
    } else if (m.startsWith('crack')) {
      const j = Number(m.slice(5)) - 1;
      eggCrack(j);
      if (j === 2) tapMedium();
    } else if (m === 'burst') {
      setPhase((x) => (x === 'egg' ? 'burst' : x));
      eggHatch(r);
      flashFrame(r >= 4 ? 'mega' : r >= 2 ? 'big' : 'small');
      if (r >= 2) notifySuccess();
      if (r >= 3)
        burstConfetti(40 + 30 * (r - 2), [rarityOf(r).color, rarityOf(r).light, '#ffffff']);
    } else if (m === 'clear') setPhase((x) => (x === 'burst' ? 'reveal' : x));
  };

  const moreReady = p.nest.some((x) => x.left <= 0);
  const label =
    res.kind === 'new'
      ? t('eggs.newPet')
      : res.kind === 'dup'
        ? rec && rec.v < MERGE_NEED.length
          ? t('eggs.copyTo', { a: Math.min(rec.dup, MERGE_NEED[rec.v]), b: MERGE_NEED[rec.v] })
          : t('eggs.copy')
        : t('eggs.treat', { n: PET_TREAT_XP });

  return (
    <div
      className={`phs is-${phase} r${r}`}
      style={rarityVars(r)}
      onClick={() => {
        if (phase !== 'done') setPhase('done');
      }}
    >
      <div className="phs__head">
        {shown && (
          <RarityName rarity={r}>{t(`nursery.rarity.r${r}` as 'nursery.rarity.r0')}</RarityName>
        )}
        {shown && <b className="phs__name">{petName(res.id)}</b>}
      </div>
      <div className="phs__stage">
        {hatched && <i className="phs__rays" aria-hidden="true" />}
        {hatched && <i className="phs__burst" aria-hidden="true" />}
        <i className="phs__floor" aria-hidden="true" />
        <i className="phs__nest" aria-hidden="true" />
        {phase !== 'done' && (
          <div className="phs__egg">
            <PxStrip
              set="eggs"
              name={`hatch-${res.egg}-r${r}`}
              size={220}
              mode="once"
              poster={`idle-${res.egg}`}
              onMark={onMark}
              onEnd={() => setPhase('done')}
              label={eggName(res.egg)}
            />
          </div>
        )}
        {shown && (
          <span className="phs__pet">
            <PetArt id={res.id} size={190} v={petLook(rec)} intro="happy" />
          </span>
        )}
      </div>
      <div className="phs__label">
        {shown && <b>{label}</b>}
        {shown && res.forced && <i>{t('eggs.pity')}</i>}
      </div>
      {phase === 'done' ? (
        <div className="phs__btns" onClick={(e) => e.stopPropagation()}>
          {moreReady && (
            <button type="button" className="gx-btn gx-btn--red" onClick={onAgain}>
              {t('eggs.again')}
            </button>
          )}
          <button type="button" className="gx-btn" onClick={onClose}>
            {t('common.ok')}
          </button>
        </div>
      ) : (
        <div className="phs__btns" />
      )}
    </div>
  );
}

// ---- «Вылупить все» (v2.121) ---------------------------------------------------

/** Сколько яиц показать волной; остальные — «+N». */
const BATCH_TILES = 24;

/**
 * Итог «вылупить все»: яйца волной лопаются в питомцев, потом лучший —
 * крупно и живой, остальные списком по редкости (одинаковые сложены).
 * Броски уже сделал стор; экран только показывает. Тап — сразу итог.
 */
/**
 * Яйцо в волне «Вылупить все»: дышит кадром покоя, в свой черёд (`at`, мс) играет короткую
 * полосу `pop-<яйцо>` — разлом на кадре 6 (250 мс), вместе с ним появляется питомец
 * (`.phb__pet`, задержка `--i × --step + 250ms`).
 */
function BatchEgg({ egg, at }: { egg: EggId; at: number }) {
  const [pop, setPop] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPop(true), at);
    return () => clearTimeout(t);
  }, [at]);
  if (gone) return null;
  return (
    <span className={`phb__egg${pop ? ' is-pop' : ''}`}>
      {pop ? (
        <PxStrip
          set="eggs"
          name={`pop-${egg}`}
          size={40}
          mode="once"
          poster={`idle-${egg}`}
          onEnd={() => setGone(true)}
        />
      ) : (
        <EggArt egg={egg} size={40} />
      )}
    </span>
  );
}

function HatchBatch({
  list,
  coins,
  tokens,
  onClose,
}: {
  list: HatchResult[];
  coins: number;
  tokens: number;
  onClose: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const [done, setDone] = useState(false);
  const shown = list.slice(0, BATCH_TILES);
  const best = list.reduce((a, b) => (b.rarity > a.rarity ? b : a), list[0]);
  const step = Math.min(110, 1800 / Math.max(1, shown.length));
  const total = step * shown.length + 500;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);

  useEffect(() => {
    if (reduceMotion()) {
      setDone(true);
      return undefined;
    }
    for (const id of new Set(shown.map((x) => x.egg))) void preloadPx('eggs', `pop-${id}`, 40);
    eggWobble(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ticks = Math.min(12, shown.length);
    for (let i = 0; i < ticks; i++)
      timers.push(setTimeout(() => eggCrack(i % 3), 180 + (i * (total - 500)) / ticks));
    timers.push(setTimeout(() => setDone(true), total));
    return () => timers.forEach(clearTimeout);
    // Волна играет один раз (новый итог — новый ключ компонента).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!done) return;
    const r = best.rarity;
    eggHatch(r);
    flashFrame(r >= 4 ? 'mega' : r >= 2 ? 'big' : 'small');
    notifySuccess();
    if (r >= 3) burstConfetti(40 + 30 * (r - 2), [rarityOf(r).color, rarityOf(r).light, '#ffffff']);
  }, [done, best.rarity]);

  // Одинаковых складываем: «Кот Шрам ×3 · новый».
  const rows: {
    id: PetId;
    rarity: number;
    n: number;
    fresh: boolean;
    dup: number;
    treat: number;
  }[] = [];
  for (const r of list) {
    let row = rows.find((x) => x.id === r.id);
    if (!row) {
      row = { id: r.id, rarity: r.rarity, n: 0, fresh: false, dup: 0, treat: 0 };
      rows.push(row);
    }
    row.n += 1;
    if (r.kind === 'new') row.fresh = true;
    else if (r.kind === 'dup') row.dup += 1;
    else row.treat += 1;
  }
  rows.sort((a, b) => b.rarity - a.rarity || b.n - a.n);
  const fresh = rows.filter((x) => x.fresh).length;
  const dups = rows.reduce((a, x) => a + x.dup, 0);
  const treats = rows.reduce((a, x) => a + x.treat, 0);
  const merge = rows.some((x) => canMerge(p.pets[x.id]));
  const forced = list.some((x) => x.forced);
  const bestRec = p.pets[best.id];

  return (
    <div
      className={`phb${done ? ' is-done' : ''}`}
      style={{ ...rarityVars(best.rarity), '--step': `${step}ms` } as CSSProperties}
      onClick={() => {
        if (!done) setDone(true);
      }}
    >
      <div className="phb__card" onClick={(e) => done && e.stopPropagation()}>
        <span className="phb__title">{t('eggs.hatched', { n: list.length })}</span>
        {!done && (
          <div className="phb__grid">
            {shown.map((r, i) => (
              <span
                key={i}
                className="phb__tile"
                style={{ ...rarityVars(r.rarity), '--i': i } as CSSProperties}
              >
                <BatchEgg egg={r.egg} at={i * step} />
                <span className="phb__pet">
                  <PetArt id={r.id} size={40} v={petLook(p.pets[r.id])} still />
                </span>
              </span>
            ))}
            {list.length > shown.length && (
              <span className="phb__more">+{list.length - shown.length}</span>
            )}
          </div>
        )}
        {done && (
          <>
            <div className="phb__best" style={rarityVars(best.rarity)}>
              <i className="phb__rays" aria-hidden="true" />
              <PetArt id={best.id} size={150} v={petLook(bestRec)} intro="happy" />
              <RarityName rarity={best.rarity}>
                {t(`nursery.rarity.r${best.rarity}` as 'nursery.rarity.r0')}
              </RarityName>
              <b>{petName(best.id)}</b>
            </div>
            <div className="phb__list">
              {rows.map((x) => (
                <span key={x.id} className="phb__row" style={rarityVars(x.rarity)}>
                  <PetArt id={x.id} size={44} v={petLook(p.pets[x.id])} still />
                  <span>
                    <b>
                      {petName(x.id)}
                      {x.n > 1 && <em> ×{x.n}</em>}
                    </b>
                    <i>
                      {[
                        x.dup > 0 &&
                          (x.dup > 1 ? t('eggs.copies', { n: x.dup }) : t('eggs.copyOne')),
                        x.treat > 0 &&
                          (x.treat > 1 ? t('eggs.treats', { n: x.treat }) : t('eggs.treatOne')),
                      ]
                        .filter(Boolean)
                        .join(' · ') || (p.pets[x.id] ? petLine(x.id, p.pets[x.id]!) : '')}
                    </i>
                  </span>
                  {x.fresh && <i className="phb__new">NEW</i>}
                </span>
              ))}
            </div>
            <span className="phb__note">
              {[
                fresh > 0 && t('eggs.freshN', { n: fresh }),
                dups > 0 && t('eggs.dupsN', { n: dups }),
                treats > 0 && t('eggs.treatsN', { n: treats }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {(coins > 0 || tokens > 0) && (
              <span className="phb__note">
                {t('eggs.spent')}{' '}
                {coins > 0 && (
                  <>
                    {fmtShort(coins)} <CoinIcon size={12} />
                  </>
                )}
                {coins > 0 && tokens > 0 && ' · '}
                {tokens > 0 && (
                  <>
                    {fmt(tokens)} <TokenIcon size={12} />
                  </>
                )}
              </span>
            )}
            {forced && <span className="phb__note">{t('eggs.pityFired')}</span>}
            {merge && <span className="phb__note">{t('eggs.mergeHint')}</span>}
            <button type="button" className="gx-btn gx-btn--red gx-btn--big" onClick={onClose}>
              {t('common.ok')}
            </button>
          </>
        )}
        {!done && <span className="phb__skip">{t('chests.skipSum')}</span>}
      </div>
    </div>
  );
}
