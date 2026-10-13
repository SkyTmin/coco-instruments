// Питомник (v2.72): отряд, гнёзда, яйца, коллекция, карточка питомца и
// сцена вылупления. Правила — lib/pets.ts, стор — prisonHatch, prisonHatchAll,
// prisonEggBuy, prisonSquadSet, prisonPetMerge, prisonPetPat.
//
// Исход вылупления решает стор в обработчике тапа (как у сундука: StrictMode
// в разработке гоняет эффекты дважды), сцена его только показывает. Трещины
// светятся цветом редкости ДО того, как яйцо лопнет: «что-то редкое» видно
// заранее, и в эту секунду смотрят не отрываясь.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GxBar, GxModal, KIcon } from '@/components/gx';
import { RarityName, rarityVars } from '@/components/PickArt';
import { EggArt, PetArt } from '@/components/PetArt';
import { Nursery } from '@/components/Nursery';
import { Tabs } from '@/ui-px';
import { fmtNum, fmtShort, petName, t as tl, useT } from '@/i18n';
import { eggName } from '@/i18n/data-books';
import { PxStrip, preloadPx } from '@/components/PxStrip';
import { CoinIcon } from '@/components/slot-art';
import { TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { HatchResult } from '@/store';
import { rarityOf } from '@/lib/rarity';
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
  petBonus,
  petLook,
} from '@/lib/pets';
import type { EggId, PetId, PetStat } from '@/lib/pets';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import { eggCrack, eggHatch, eggWobble, primeAudio, uiBuy, uiError } from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => fmtNum(n);
/** Bonus share → percent with one decimal, as the Nursery shows it. */
const pctV = (x: number) => Math.round(x * 1000) / 10;

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

/** Полоска шансов яйца: доли редкостей их цветами. */
function OddsBar({ egg }: { egg: EggId }) {
  const ch = eggChances(egg);
  return (
    <span className="ppn__odds" aria-hidden="true">
      {ch.map((c, r) =>
        c > 0 ? (
          <i
            key={r}
            style={{ flexGrow: Math.max(c, 0.04), background: rarityOf(r).color }}
            title={`${tl(`nursery.rarity.r${r}` as 'nursery.rarity.r0')} ${tl('nursery.eggPct', { v: pctV(c) })}`}
          />
        ) : null,
      )}
    </span>
  );
}

export function PetsTab() {
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const hatch = useFinanceStore((s) => s.prisonHatch);
  const buyEgg = useFinanceStore((s) => s.prisonEggBuy);
  const t = useT();
  /** Pets (the pixel Nursery) or eggs; a ready nest opens straight on the eggs. */
  const [view, setView] = useState<'pets' | 'eggs'>(() =>
    p.nest.some((n) => n.left <= 0) ? 'eggs' : 'pets',
  );
  const [nestAt, setNestAt] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const armT = useRef<ReturnType<typeof setTimeout>>();
  /** Дорогая покупка — в два касания: первое взводит, второе платит. */
  const arm = (key: string) => {
    if (armed === key) return true;
    setArmed(key);
    clearTimeout(armT.current);
    armT.current = setTimeout(() => setArmed(null), 4000);
    return false;
  };
  const place = useFinanceStore((s) => s.prisonEggPlace);
  const hatchAll = useFinanceStore((s) => s.prisonHatchAll);
  const [scene, setScene] = useState<{ res: HatchResult; key: number } | null>(null);
  const [batch, setBatch] = useState<{
    list: HatchResult[];
    coins: number;
    tokens: number;
    key: number;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteT = useRef<ReturnType<typeof setTimeout>>();
  const say = (t: string) => {
    setNote(t);
    clearTimeout(noteT.current);
    noteT.current = setTimeout(() => setNote(null), 2200);
  };
  useEffect(
    () => () => {
      clearTimeout(noteT.current);
      clearTimeout(armT.current);
    },
    [],
  );
  const eggsAll = p.nest.length + eggCount(p.eggs);
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
      tapLight();
      say(t('eggs.armAll'));
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

  return (
    <div className={`ppn is-${view}`}>
      <Tabs
        className="ppn__tabs"
        items={[
          { id: 'pets', label: t('nursery.tabPets'), icon: 'paw' },
          {
            id: 'eggs',
            label: t('nursery.tabEggs'),
            icon: 'egg',
            badge: p.nest.some((n) => n.left <= 0) ? '!' : eggsAll || null,
          },
        ]}
        value={view}
        onChange={(v) => {
          selectionChanged();
          setView(v);
        }}
      />
      {view === 'pets' && <Nursery say={say} />}

      <h4 className="ppn__h">{t('eggs.nests')}</h4>
      <div className="ppn__nests">
        {Array.from({ length: NEST_SLOTS }, (_, i) => {
          const n = p.nest[i];
          if (!n)
            return (
              <button
                key={i}
                type="button"
                className="ppn__nest is-empty"
                onClick={() => {
                  tapLight();
                  if (eggCount(p.eggs) > 0) setNestAt(i);
                  else say(t('eggs.basketEmpty'));
                }}
              >
                <i className="ppn__straw" aria-hidden="true" />
                <em>{eggCount(p.eggs) > 0 ? t('eggs.putEgg') : t('eggs.empty')}</em>
              </button>
            );
          const need = eggOf(n.egg).need;
          const ready = n.left <= 0;
          return (
            <button
              key={i}
              type="button"
              className={`ppn__nest${ready ? ' is-ready' : ''}`}
              style={rarityVars(EGG_RARITY[n.egg])}
              onClick={() => {
                if (ready) doHatch(i);
                else {
                  tapLight();
                  setNestAt(i);
                }
              }}
            >
              <i className="ppn__straw" aria-hidden="true" />
              <span className="ppn__egg">
                <EggArt egg={n.egg} size={72} />
              </span>
              {ready ? (
                <b className="ppn__go">{t('eggs.hatch')}</b>
              ) : (
                <GxBar tone="green" value={1 - n.left / need} label={fmt(n.left)} />
              )}
            </button>
          );
        })}
      </div>
      {eggCount(p.eggs) > 0 && (
        <div className="ppn__basket">
          <span>{t('eggs.waiting')}</span>
          {EGG_IDS.filter((id) => p.eggs[id] > 0).map((id) => (
            <button
              key={id}
              type="button"
              className="ppn__chip"
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
              <EggArt egg={id} size={26} />×{p.eggs[id]}
              {p.eggHeat[id] > 0 && <HeatBar egg={id} heat={p.eggHeat[id]} />}
            </button>
          ))}
        </div>
      )}
      {eggsAll >= 2 && (
        <button
          type="button"
          className={`gx-btn gx-btn--red ppn__all${armed === 'all' ? ' is-armed' : ''}`}
          aria-disabled={!plan.picks.length}
          onClick={doHatchAll}
        >
          <span>
            {t(armed === 'all' ? 'eggs.sureAll' : 'eggs.hatchAll', {
              count:
                plan.picks.length && plan.picks.length < eggsAll
                  ? t('eggs.someOf', { a: plan.picks.length, b: eggsAll })
                  : `(${eggsAll})`,
            })}
          </span>
          {price.coins > 0 && (
            <span className="ppn__price">
              <CoinIcon size={14} /> {fmtShort(price.coins)}
            </span>
          )}
          {price.tokens > 0 && (
            <span className="ppn__price">
              <TokenIcon size={14} /> {fmt(price.tokens)}
            </span>
          )}
        </button>
      )}

      <h4 className="ppn__h">{t('nursery.tabEggs')}</h4>
      <div className="ppn__shop">
        {EGGS.map((e) => {
          const tok = e.tokens ?? 0;
          const sold = e.price > 0 || tok > 0;
          const locked = sold && !tok && p.rank < e.from;
          const room = p.nest.length < NEST_SLOTS || eggCount(p.eggs) < EGG_BASKET;
          const rich = tok ? p.tokens >= tok : balance >= e.price;
          const can = sold && !locked && room && rich;
          return (
            <button
              key={e.id}
              type="button"
              className={`ppn__buy${locked ? ' is-locked' : ''}${tok ? ' is-rare' : ''}${armed === e.id ? ' is-armed' : ''}`}
              style={rarityVars(EGG_RARITY[e.id])}
              aria-disabled={!can}
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
                  tapLight();
                  say(t('eggs.buyArm', { name: eggName(e.id), n: tok }));
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
              <EggArt egg={e.id} size={58} />
              <b>{t(`nursery.egg.${e.id}`)}</b>
              <OddsBar egg={e.id} />
              {locked ? (
                <i>
                  <KIcon name="locked" /> {t('eggs.rank', { r: rankLetter(e.from) })}
                </i>
              ) : (
                <span className="ppn__price">
                  {tok ? <TokenIcon size={14} /> : <CoinIcon size={14} />}{' '}
                  {fmtShort(tok || e.price)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {note && <div className="ppn__note">{note}</div>}
      {nestAt !== null && (
        <NestSheet
          i={nestAt}
          onClose={() => setNestAt(null)}
          onHatch={(i) => {
            setNestAt(null);
            doHatch(i);
          }}
          say={say}
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
    </div>
  );
}

/** Сбережённый прогрев вида — тонкая полоска под яйцом в корзине. */
function HeatBar({ egg, heat }: { egg: EggId; heat: number }) {
  return (
    <i className="ppn__heat" aria-hidden="true">
      <i style={{ width: `${Math.min(100, (100 * heat) / eggOf(egg).need)}%` }} />
    </i>
  );
}

/**
 * Гнездо (v2.76): что в нём греется, вынуть в корзину, положить другое
 * взамен, драконье — вылупить сразу за токены. Прогрев вынутого не сгорает —
 * он остаётся за видом яйца (`pullEgg`).
 */
function NestSheet({
  i,
  onClose,
  onHatch,
  say,
}: {
  i: number;
  onClose: () => void;
  onHatch: (i: number) => void;
  say: (t: string) => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const pull = useFinanceStore((s) => s.prisonEggPull);
  const place = useFinanceStore((s) => s.prisonEggPlace);
  const now = useFinanceStore((s) => s.prisonHatchNow);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const [armed, setArmed] = useState(false);
  const n = p.nest[i];
  // Цена «вылупить сразу» — цена яйца: монеты или токены (драконье).
  const cost = n ? hatchNowCost(n.egg) : { coins: 0, tokens: 0 };
  const price = cost.coins || cost.tokens;
  const short = cost.coins ? cost.coins - balance : cost.tokens - p.tokens;
  const basket = EGG_IDS.filter((id) => p.eggs[id] > 0 && id !== n?.egg);
  const full = eggCount(p.eggs) >= EGG_BASKET;
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <GxModal title={n ? eggName(n.egg) : t('eggs.nest')} onClose={onClose}>
      <div className="ppn-nest">
        {n && (
          <div className="ppn-nest__now" style={rarityVars(EGG_RARITY[n.egg])}>
            <EggArt egg={n.egg} size={88} />
            <GxBar
              tone="green"
              value={1 - n.left / eggOf(n.egg).need}
              label={
                n.left > 0 ? t('books.blocksLeft', { n: Math.round(n.left) }) : t('eggs.ready')
              }
            />
            <div className="ppn-nest__acts">
              {price > 0 && n.left > 0 && (
                <button
                  type="button"
                  className={`btn btn--primary btn--sm${armed ? ' is-armed' : ''}`}
                  aria-disabled={short > 0}
                  onClick={() => {
                    primeAudio();
                    if (short > 0) {
                      uiError();
                      notifyWarning();
                      say(
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
                      setArmed(true);
                      return;
                    }
                    if (now(i)) onHatch(i);
                  }}
                >
                  {armed ? t('eggs.sure') : t('eggs.hatchNow')}{' '}
                  {cost.coins ? fmtShort(price) : fmt(price)}{' '}
                  {cost.coins ? <CoinIcon size={13} /> : <TokenIcon size={13} />}
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-disabled={full}
                onClick={() => {
                  primeAudio();
                  if (!pull(i)) {
                    uiError();
                    say(t('eggs.basketFull'));
                    return;
                  }
                  selectionChanged();
                  onClose();
                }}
              >
                {t('eggs.toBasketBtn')}
              </button>
            </div>
          </div>
        )}
        {basket.length > 0 ? (
          <>
            <h5 className="ppn-nest__h">{t(n ? 'eggs.putInstead' : 'eggs.putInNest')}</h5>
            <div className="ppn-nest__basket">
              {basket.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="ppn-nest__egg"
                  style={rarityVars(EGG_RARITY[id])}
                  onClick={() => {
                    primeAudio();
                    if (!place(id, n ? i : undefined)) return;
                    selectionChanged();
                    onClose();
                  }}
                >
                  <EggArt egg={id} size={52} />
                  <b>×{p.eggs[id]}</b>
                  {p.eggHeat[id] > 0 && <HeatBar egg={id} heat={p.eggHeat[id]} />}
                </button>
              ))}
            </div>
          </>
        ) : (
          !n && <p className="ppn-sheet__from">{t('eggs.basketEmpty')}</p>
        )}
      </div>
    </GxModal>
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
