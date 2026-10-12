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
import { useT } from '@/i18n';
import { CoinIcon } from '@/components/slot-art';
import { TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { HatchResult } from '@/store';
import { rarityOf } from '@/lib/rarity';
import { rankLetter, shortMoney } from '@/lib/prison';
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
  PET_RARITY_NAME,
  petBonus,
  petLook,
  petOf,
  ROLE,
} from '@/lib/pets';
import type { EggId, PetId, PetStat } from '@/lib/pets';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import { eggCrack, eggHatch, eggWobble, primeAudio, uiBuy, uiError } from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const pct = (x: number) =>
  `+${(Math.round(x * 1000) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Цвет яйца — по лучшей редкости, какая из него бывает. */
export const EGG_RARITY: Record<EggId, number> = { moss: 2, stone: 3, crystal: 4, dragon: 5 };

/** Прибавки питомца словами: «+6% к добыче · +3% к скорости копки». */
export function petLine(id: PetId, rec: { xp: number; v: number }): string {
  const b = petBonus(id, rec);
  return (Object.keys(b) as PetStat[]).map((k) => `${pct(b[k] ?? 0)} ${ROLE[k].text}`).join(' · ');
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
            title={`${PET_RARITY_NAME[r]} ${Math.round(c * 1000) / 10}%`}
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
      if (coin.length) miss.push(`${shortMoney(Math.min(...coin) - balance)} монет`);
      if (tok.length) miss.push(`${fmt(Math.min(...tok) - p.tokens)} токенов`);
      say(`Не хватает ${miss.join(' или ')}`);
      return;
    }
    if ((plan.coins || plan.tokens) && !arm('all')) {
      tapLight();
      say('Нажми ещё раз — вылупятся все сразу');
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

      <h4 className="ppn__h">Гнёзда</h4>
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
                  else say('Корзина пуста');
                }}
              >
                <i className="ppn__straw" aria-hidden="true" />
                <em>{eggCount(p.eggs) > 0 ? 'Положить яйцо' : 'Пусто'}</em>
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
                <b className="ppn__go">Вылупить!</b>
              ) : (
                <GxBar tone="green" value={1 - n.left / need} label={fmt(n.left)} />
              )}
            </button>
          );
        })}
      </div>
      {eggCount(p.eggs) > 0 && (
        <div className="ppn__basket">
          <span>Ждут гнезда:</span>
          {EGG_IDS.filter((id) => p.eggs[id] > 0).map((id) => (
            <button
              key={id}
              type="button"
              className="ppn__chip"
              onClick={() => {
                primeAudio();
                if (p.nest.length < NEST_SLOTS && place(id)) {
                  selectionChanged();
                  say(`${eggOf(id).name} — в гнездо`);
                } else {
                  tapLight();
                  say('Гнёзда заняты — нажми на гнездо, чтобы поменять');
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
            {armed === 'all' ? 'Точно? ' : 'Вылупить все '}
            {plan.picks.length && plan.picks.length < eggsAll
              ? `${plan.picks.length} из ${eggsAll}`
              : `(${eggsAll})`}
          </span>
          {price.coins > 0 && (
            <span className="ppn__price">
              <CoinIcon size={14} /> {shortMoney(price.coins)}
            </span>
          )}
          {price.tokens > 0 && (
            <span className="ppn__price">
              <TokenIcon size={14} /> {fmt(price.tokens)}
            </span>
          )}
        </button>
      )}

      <h4 className="ppn__h">Яйца</h4>
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
                  say(`Откроется с ранга ${rankLetter(e.from)}`);
                  return;
                }
                if (!room) {
                  uiError();
                  say('Корзина полна — вылупи кого-нибудь');
                  return;
                }
                if (!rich) {
                  uiError();
                  notifyWarning();
                  say(
                    tok
                      ? `Не хватает ${fmt(tok - p.tokens)} токенов`
                      : `Не хватает ${shortMoney(e.price - balance)} монет`,
                  );
                  return;
                }
                if (tok && !arm(e.id)) {
                  tapLight();
                  say(`${e.name} за ${fmt(tok)} токенов — нажми ещё раз`);
                  return;
                }
                setArmed(null);
                if (buyEgg(e.id)) {
                  uiBuy();
                  tapMedium();
                  say(`${e.name} — ${p.nest.length < NEST_SLOTS ? 'в гнездо' : 'в корзину'}`);
                }
              }}
            >
              <EggArt egg={e.id} size={58} />
              <b>{e.name.replace(' яйцо', '')}</b>
              <OddsBar egg={e.id} />
              {locked ? (
                <i>
                  <KIcon name="locked" /> ранг {rankLetter(e.from)}
                </i>
              ) : (
                <span className="ppn__price">
                  {tok ? <TokenIcon size={14} /> : <CoinIcon size={14} />}{' '}
                  {shortMoney(tok || e.price)}
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
    <GxModal title={n ? eggOf(n.egg).name : 'Гнездо'} onClose={onClose}>
      <div className="ppn-nest">
        {n && (
          <div className="ppn-nest__now" style={rarityVars(EGG_RARITY[n.egg])}>
            <EggArt egg={n.egg} size={88} />
            <GxBar
              tone="green"
              value={1 - n.left / eggOf(n.egg).need}
              label={n.left > 0 ? `ещё ${fmt(n.left)} блоков` : 'готово'}
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
                        cost.coins
                          ? `Не хватает ${shortMoney(short)} монет`
                          : `Не хватает ${fmt(short)} токенов`,
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
                  {armed ? 'Точно? ' : 'Вылупить сразу '}
                  {cost.coins ? shortMoney(price) : fmt(price)}{' '}
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
                    say('Корзина полна');
                    return;
                  }
                  selectionChanged();
                  onClose();
                }}
              >
                В корзину
              </button>
            </div>
          </div>
        )}
        {basket.length > 0 ? (
          <>
            <h5 className="ppn-nest__h">{n ? 'Положить вместо' : 'Положить в гнездо'}</h5>
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
          !n && <p className="ppn-sheet__from">Корзина пуста</p>
        )}
      </div>
    </GxModal>
  );
}

// ---- Сцена вылупления --------------------------------------------------------

/** Сколько яйцо качается до разлома: чем реже, тем дольше вопрос. */
const WOBBLE_MS = [1100, 1300, 1600, 2000, 2600, 3200];

type HPhase = 'w1' | 'w2' | 'w3' | 'burst' | 'reveal' | 'done';

function HatchScene({
  res,
  onAgain,
  onClose,
}: {
  res: HatchResult;
  onAgain: () => void;
  onClose: () => void;
}) {
  const p = useFinanceStore((s) => s.prison);
  const r = res.rarity;
  const def = petOf(res.id);
  const rec = p.pets[res.id];
  const [phase, setPhase] = useState<HPhase>('w1');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);
  const hatched = phase === 'burst' || phase === 'reveal' || phase === 'done';
  const shown = phase === 'reveal' || phase === 'done';
  const cracks = phase === 'w1' ? 0 : phase === 'w2' ? 1 : phase === 'w3' ? 2 : 3;

  const finish = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('done');
  };

  useEffect(() => {
    if (reduceMotion()) {
      eggHatch(r);
      finish();
      return undefined;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const W = WOBBLE_MS[r];
    eggWobble(0);
    // Качается сильнее с каждой трещиной; трещины светятся цветом редкости.
    [0.34, 0.62].forEach((f, j) =>
      at(W * f, () => {
        setPhase(j === 0 ? 'w2' : 'w3');
        eggCrack(j);
        eggWobble(j + 1);
        tapLight();
      }),
    );
    at(W * 0.86, () => {
      eggCrack(2);
      tapMedium();
    });
    at(W, () => {
      setPhase('burst');
      eggHatch(r);
      flashFrame(r >= 4 ? 'mega' : r >= 2 ? 'big' : 'small');
      if (r >= 2) notifySuccess();
      if (r >= 3)
        burstConfetti(40 + 30 * (r - 2), [rarityOf(r).color, rarityOf(r).light, '#ffffff']);
    });
    at(W + 260, () => setPhase('reveal'));
    at(W + 1300, () => setPhase('done'));
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз на яйцо (новое яйцо — новый ключ компонента).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moreReady = p.nest.some((x) => x.left <= 0);
  const label =
    res.kind === 'new'
      ? 'Новый питомец!'
      : res.kind === 'dup'
        ? rec && rec.v < MERGE_NEED.length
          ? `Копия · ${Math.min(rec.dup, MERGE_NEED[rec.v])}/${MERGE_NEED[rec.v]} до золотого`
          : 'Копия'
        : 'Лакомство: +400 опыта';

  return (
    <div
      className={`phs is-${phase} r${r}`}
      style={{ ...rarityVars(r), '--wob': `${WOBBLE_MS[r]}ms` } as CSSProperties}
      onClick={() => {
        if (phase !== 'done') finish();
      }}
    >
      <div className="phs__head">
        {shown && <RarityName rarity={r}>{PET_RARITY_NAME[r]}</RarityName>}
        {shown && <b className="phs__name">{def.name}</b>}
      </div>
      <div className="phs__stage">
        {hatched && <i className="phs__rays" aria-hidden="true" />}
        {hatched && <i className="phs__burst" aria-hidden="true" />}
        {hatched && r >= 3 && <i className="phs__pillar" aria-hidden="true" />}
        <i className="phs__floor" aria-hidden="true" />
        <i className="phs__nest" aria-hidden="true" />
        {!hatched && (
          <div className={`phs__egg is-${phase}`}>
            <i className="phs__leak" style={{ opacity: cracks * 0.3 }} aria-hidden="true" />
            <EggArt egg={res.egg} size={220} />
            <svg className="phs__cracks" viewBox="0 0 100 100" aria-hidden="true">
              <g className={cracks >= 1 ? 'is-on' : ''}>
                <path d="M 26 47 L 33 43 L 39 50 L 46 44 L 52 51 L 58 43" />
              </g>
              <g className={cracks >= 2 ? 'is-on' : ''}>
                <path d="M 58 43 L 65 49 L 71 44 L 76 48" />
                <path d="M 46 44 L 44 36 L 48 30" />
              </g>
              <g className={cracks >= 3 ? 'is-on' : ''}>
                <path d="M 39 50 L 37 59 L 41 65" />
                <path d="M 65 49 L 68 57" />
              </g>
            </svg>
          </div>
        )}
        {hatched && (
          <>
            <span className="phs__half phs__half--top" aria-hidden="true">
              <EggArt egg={res.egg} size={220} />
            </span>
            <span className="phs__half phs__half--bot" aria-hidden="true">
              <EggArt egg={res.egg} size={220} />
            </span>
          </>
        )}
        {shown && (
          <span className="phs__pet">
            <PetArt id={res.id} size={190} v={petLook(rec)} intro="happy" />
          </span>
        )}
      </div>
      <div className="phs__label">
        {shown && <b>{label}</b>}
        {shown && res.forced && <i>Гарантия: двадцать пятое яйцо</i>}
      </div>
      {phase === 'done' ? (
        <div className="phs__btns" onClick={(e) => e.stopPropagation()}>
          {moreReady && (
            <button type="button" className="gx-btn gx-btn--red" onClick={onAgain}>
              Ещё яйцо
            </button>
          )}
          <button type="button" className="gx-btn" onClick={onClose}>
            Готово
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

const petsWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'питомец'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? 'питомца'
      : 'питомцев';

/**
 * Итог «вылупить все»: яйца волной лопаются в питомцев, потом лучший —
 * крупно и живой, остальные списком по редкости (одинаковые сложены).
 * Броски уже сделал стор; экран только показывает. Тап — сразу итог.
 */
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
        <span className="phb__title">
          Вылупилось {fmt(list.length)} {petsWord(list.length)}
        </span>
        {!done && (
          <div className="phb__grid">
            {shown.map((r, i) => (
              <span
                key={i}
                className="phb__tile"
                style={{ ...rarityVars(r.rarity), '--i': i } as CSSProperties}
              >
                <span className="phb__egg">
                  <EggArt egg={r.egg} size={40} />
                </span>
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
              <RarityName rarity={best.rarity}>{PET_RARITY_NAME[best.rarity]}</RarityName>
              <b>{petOf(best.id).name}</b>
            </div>
            <div className="phb__list">
              {rows.map((x) => (
                <span key={x.id} className="phb__row" style={rarityVars(x.rarity)}>
                  <PetArt id={x.id} size={44} v={petLook(p.pets[x.id])} still />
                  <span>
                    <b>
                      {petOf(x.id).name}
                      {x.n > 1 && <em> ×{x.n}</em>}
                    </b>
                    <i>
                      {[
                        x.dup > 0 && (x.dup > 1 ? `копии ×${x.dup}` : 'копия'),
                        x.treat > 0 && (x.treat > 1 ? `лакомства ×${x.treat}` : 'лакомство'),
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
                fresh > 0 && `новых ${fresh}`,
                dups > 0 && `копий ${dups}`,
                treats > 0 && `лакомств ${treats}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {(coins > 0 || tokens > 0) && (
              <span className="phb__note">
                Потрачено:{' '}
                {coins > 0 && (
                  <>
                    {shortMoney(coins)} <CoinIcon size={12} />
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
            {forced && <span className="phb__note">Сработала гарантия: двадцать пятое яйцо</span>}
            {merge && (
              <span className="phb__note">Есть кого слить в золотого — «!» в коллекции</span>
            )}
            <button type="button" className="gx-btn gx-btn--red gx-btn--big" onClick={onClose}>
              Готово
            </button>
          </>
        )}
        {!done && <span className="phb__skip">тап — показать итог</span>}
      </div>
    </div>
  );
}
