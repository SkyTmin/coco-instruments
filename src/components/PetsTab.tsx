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
import { PxStrip, preloadPx } from '@/components/PxStrip';
import type { PetAnim } from '@/components/PetArt';
import { CoinIcon } from '@/components/slot-art';
import { TokenIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { HatchResult } from '@/store';
import { rarityOf } from '@/lib/rarity';
import { rankLetter, shortMoney } from '@/lib/prison';
import {
  canMerge,
  canPat,
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
  PAT_XP,
  PET_RARITY_NAME,
  petBonus,
  petLevelOf,
  petLook,
  petOf,
  PETS,
  petScore,
  ROLE,
  squadSlots,
  SQUAD_RANK2,
  VARIANT_NAME,
  zooMult,
} from '@/lib/pets';
import type { EggId, PetId, PetStat } from '@/lib/pets';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import {
  eggCrack,
  eggHatch,
  eggWobble,
  petMerge,
  petPat,
  primeAudio,
  uiBuy,
  uiError,
} from '@/lib/sound';
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
  const [sheet, setSheet] = useState<PetId | null>(null);
  const [pick, setPick] = useState<number | null>(null);
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
  const slots = squadSlots(p.rank, p.prestige);
  const owned = PETS.filter((d) => p.pets[d.id]).length;
  const zoo = zooMult(p.pets) - 1;
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

  const squadBonus: Partial<Record<PetStat, number>> = {};
  for (const id of p.squad) {
    const rec = p.pets[id];
    if (!rec) continue;
    for (const [k, v] of Object.entries(petBonus(id, rec)))
      squadBonus[k as PetStat] = (squadBonus[k as PetStat] ?? 0) + (v ?? 0);
  }
  const bonusText = (Object.keys(squadBonus) as PetStat[])
    .map((k) => `${pct(squadBonus[k] ?? 0)} ${ROLE[k].text}`)
    .join(' · ');

  return (
    <div className="ppn">
      <div className="ppn__squad">
        {[0, 1, 2].map((i) => {
          if (i >= slots)
            return (
              <div key={i} className="ppn__slot is-locked">
                <KIcon name="locked" />
                <i>{i === 1 ? `с ранга ${rankLetter(SQUAD_RANK2)}` : 'после престижа'}</i>
              </div>
            );
          const id = p.squad[i];
          const rec = id ? p.pets[id] : undefined;
          if (!id || !rec)
            return (
              <button
                key={i}
                type="button"
                className="ppn__slot is-empty"
                onClick={() => {
                  tapLight();
                  if (!owned) say('Сначала вырасти питомца из яйца');
                  else setPick(i);
                }}
              >
                <KIcon name="plus" />
                <i>С собой</i>
              </button>
            );
          const lv = petLevelOf(rec.xp);
          return (
            <button
              key={i}
              type="button"
              className="ppn__slot"
              style={rarityVars(petOf(id).rarity)}
              onClick={() => {
                tapLight();
                setSheet(id);
              }}
            >
              <span className="ppn__pad">
                <PetArt id={id} size={74} v={petLook(rec)} />
              </span>
              <b>{petOf(id).name}</b>
              <GxBar thin tone="gold" value={lv.need ? lv.into / lv.need : 1} />
              <i>ур. {lv.level}</i>
            </button>
          );
        })}
      </div>
      {bonusText && <div className="ppn__bonus">{bonusText}</div>}

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

      <h4 className="ppn__h">
        Коллекция {owned}/{PETS.length}
        {zoo > 0 && <em> · {pct(zoo)} к продаже</em>}
      </h4>
      <div className="ppn__zoo">
        {PETS.map((d) => {
          const rec = p.pets[d.id];
          return (
            <button
              key={d.id}
              type="button"
              className={`ppn__card r${d.rarity}${rec ? '' : ' is-ghost'}${rec?.v ? ` is-v${rec.v}` : ''}${p.squad.includes(d.id) ? ' is-with' : ''}`}
              style={rarityVars(d.rarity)}
              onClick={() => {
                tapLight();
                setSheet(d.id);
              }}
            >
              <PetArt id={d.id} size={48} v={petLook(rec)} ghost={!rec} still />
              {canMerge(rec) && <i className="ppn__dot">!</i>}
            </button>
          );
        })}
      </div>

      {note && <div className="ppn__note">{note}</div>}
      {sheet && <PetSheet id={sheet} onClose={() => setSheet(null)} />}
      {pick !== null && <SquadPicker slot={pick} onClose={() => setPick(null)} />}
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

// ---- Карточка питомца --------------------------------------------------------

/** Витрина в карточке: каждая анимация вида по кнопке. */
const SHOWCASE: [PetAnim, string][] = [
  ['happy', 'Радость'],
  ['work', 'Трюк'],
  ['attack', 'Атака'],
  ['sleep', 'Сон'],
];

/** Скины золотого: какой рисунок показывать везде, где питомец нарисован. */
const SKINS: [number, string][] = [
  [0, 'Обычный'],
  [1, 'Золотой'],
];

function PetSheet({ id, onClose }: { id: PetId; onClose: () => void }) {
  const p = useFinanceStore((s) => s.prison);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const merge = useFinanceStore((s) => s.prisonPetMerge);
  const setSkin = useFinanceStore((s) => s.prisonPetSkin);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const [joy, setJoy] = useState(0);
  const [xpPop, setXpPop] = useState(0);
  const [show, setShow] = useState<{ anim: PetAnim; k: number } | null>(null);
  const def = petOf(id);
  const rec = p.pets[id];
  const r = def.rarity;
  const slots = squadSlots(p.rank, p.prestige);
  const here = p.squad.includes(id);
  // Из каких яиц бывает: там, где у его редкости шанс больше нуля.
  const from = EGGS.filter((e) => eggChances(e.id)[r] > 0).map((e) => e.name.replace(' яйцо', ''));
  const lv = petLevelOf(rec?.xp ?? 0);
  return (
    <GxModal title={rec ? def.name : 'Кто это?'} onClose={onClose} className="ppn-sheet">
      <div className={`ppn-sheet__stage r${r}`} style={rarityVars(r)}>
        <PetArt
          id={id}
          size={150}
          v={petLook(rec)}
          ghost={!rec}
          joy={joy}
          play={show}
          onClick={
            rec
              ? () => {
                  primeAudio();
                  petPat();
                  tapLight();
                  setJoy((j) => j + 1);
                  if (canPat(rec, Date.now()) && pat(id)) setXpPop((x) => x + 1);
                }
              : undefined
          }
        />
        {xpPop > 0 && (
          <b key={xpPop} className="ppn-sheet__xp">
            +{PAT_XP} опыта
          </b>
        )}
      </div>
      {rec && (
        <div className="ppn-sheet__acts">
          {SHOWCASE.map(([anim, label]) => (
            <button
              key={anim}
              type="button"
              className="gx-btn gx-btn--sm"
              onClick={() => {
                tapLight();
                setShow((s) => ({ anim, k: (s?.k ?? 0) + 1 }));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Скин (v2.111): золотого можно нарисовать обычным. Сила и имя — по ступени. */}
      {rec && rec.v >= 1 && (
        <div className="ppn-skin">
          <span>Скин</span>
          <span className="ppn-skin__seg" role="radiogroup" aria-label="Скин">
            {SKINS.map(([s, name]) => {
              const on = petLook(rec) === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`${s ? 'is-gold' : ''}${on ? ' is-on' : ''}`}
                  onClick={() => {
                    if (on) return;
                    selectionChanged();
                    if (setSkin(id, s)) setJoy((j) => j + 1);
                  }}
                >
                  {name}
                </button>
              );
            })}
          </span>
        </div>
      )}
      <div className="ppn-sheet__name">
        <RarityName rarity={r}>
          {rec && rec.v ? `${VARIANT_NAME[rec.v]} ` : ''}
          {PET_RARITY_NAME[r]}
        </RarityName>
        {!rec && <b>{def.name}</b>}
      </div>
      <p className="ppn-sheet__lore">{def.lore}</p>
      <div className="ppn-sheet__roles">
        {def.stats.map((s) => (
          <span key={s}>
            <b>{ROLE[s].name}</b>
            <i>
              {rec ? pct(petBonus(id, rec)[s] ?? 0) : ''} {ROLE[s].text}
            </i>
          </span>
        ))}
      </div>
      {rec ? (
        <>
          <GxBar
            tone="gold"
            value={lv.need ? lv.into / lv.need : 1}
            label={
              lv.need
                ? `ур. ${lv.level} · ${fmt(lv.into)}/${fmt(lv.need)}`
                : `ур. ${lv.level} · предел`
            }
          />
          {rec.v < MERGE_NEED.length && (
            <div className="ppn-sheet__merge">
              <span>
                Копии до золотого: {Math.min(rec.dup, MERGE_NEED[rec.v])}/{MERGE_NEED[rec.v]}
              </span>
              <GxBar thin tone="blue" value={rec.dup / MERGE_NEED[rec.v]} />
              {canMerge(rec) && (
                <button
                  type="button"
                  className="gx-btn gx-btn--red"
                  onClick={() => {
                    primeAudio();
                    if (merge(id)) {
                      petMerge();
                      notifySuccess();
                      flashFrame('big');
                      burstConfetti(60, ['#ffd24a', '#fff3b0', '#ffffff']);
                      setJoy((j) => j + 1);
                    }
                  }}
                >
                  Сделать золотым
                </button>
              )}
            </div>
          )}
          <div className="ppn-sheet__btns">
            {here ? (
              <button
                type="button"
                className="gx-btn"
                onClick={() => {
                  selectionChanged();
                  setSquad(p.squad.filter((x) => x !== id));
                }}
              >
                Оставить дома
              </button>
            ) : (
              <button
                type="button"
                className="gx-btn gx-btn--red"
                onClick={() => {
                  primeAudio();
                  selectionChanged();
                  // Отряд полон — встаёт на место последнего.
                  const next =
                    p.squad.length < slots
                      ? [...p.squad, id]
                      : [...p.squad.slice(0, slots - 1), id];
                  setSquad(next);
                  petPat();
                  setJoy((j) => j + 1);
                }}
              >
                Взять с собой
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="ppn-sheet__from">Вылупляется из яиц: {from.join(', ')}</p>
      )}
    </GxModal>
  );
}

/** Кого взять на пустое место отряда: сильнейшие сверху. */
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

function SquadPicker({ slot, onClose }: { slot: number; onClose: () => void }) {
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const list = (Object.keys(p.pets) as PetId[])
    .filter((id) => !p.squad.includes(id))
    .sort((a, b) => petScore(b, p.pets[b]!) - petScore(a, p.pets[a]!));
  return (
    <GxModal title="С собой" onClose={onClose}>
      {list.length ? (
        <div className="ppn-pick">
          {list.map((id) => {
            const rec = p.pets[id]!;
            return (
              <button
                key={id}
                type="button"
                className="ppn-pick__row"
                style={rarityVars(petOf(id).rarity)}
                onClick={() => {
                  primeAudio();
                  selectionChanged();
                  const next = [...p.squad];
                  next.splice(slot, 0, id);
                  setSquad(next);
                  petPat();
                  onClose();
                }}
              >
                <PetArt id={id} size={48} v={petLook(rec)} still />
                <span>
                  <b>
                    {petOf(id).name} <em>ур. {petLevelOf(rec.xp).level}</em>
                  </b>
                  <i>{petLine(id, rec)}</i>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="ppn-sheet__from">Все питомцы уже с тобой</p>
      )}
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
  const p = useFinanceStore((s) => s.prison);
  const r = res.rarity;
  const def = petOf(res.id);
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
      ? 'Новый питомец!'
      : res.kind === 'dup'
        ? rec && rec.v < MERGE_NEED.length
          ? `Копия · ${Math.min(rec.dup, MERGE_NEED[rec.v])}/${MERGE_NEED[rec.v]} до золотого`
          : 'Копия'
        : 'Лакомство: +400 опыта';

  return (
    <div
      className={`phs is-${phase} r${r}`}
      style={rarityVars(r)}
      onClick={() => {
        if (phase !== 'done') setPhase('done');
      }}
    >
      <div className="phs__head">
        {shown && <RarityName rarity={r}>{PET_RARITY_NAME[r]}</RarityName>}
        {shown && <b className="phs__name">{def.name}</b>}
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
              label={eggOf(res.egg).name}
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
