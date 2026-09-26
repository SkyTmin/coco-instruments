// Питомник (v2.72): отряд, гнёзда, яйца, коллекция, карточка питомца и
// сцена вылупления. Правила — lib/pets.ts, стор — prisonHatch, prisonEggBuy,
// prisonSquadSet, prisonPetMerge, prisonPetPat.
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
import { CoinIcon } from '@/components/slot-art';
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
  MERGE_NEED,
  NEST_SLOTS,
  PAT_XP,
  PET_RARITY_NAME,
  petBonus,
  petLevelOf,
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
  const [scene, setScene] = useState<{ res: HatchResult; key: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteT = useRef<ReturnType<typeof setTimeout>>();
  const say = (t: string) => {
    setNote(t);
    clearTimeout(noteT.current);
    noteT.current = setTimeout(() => setNote(null), 2200);
  };
  useEffect(() => () => clearTimeout(noteT.current), []);
  const slots = squadSlots(p.rank, p.prestige);
  const owned = PETS.filter((d) => p.pets[d.id]).length;
  const zoo = zooMult(p.pets) - 1;

  const doHatch = (i: number) => {
    primeAudio();
    const res = hatch(i);
    if (!res) return;
    tapMedium();
    setScene({ res, key: Date.now() });
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
                <PetArt id={id} size={74} v={rec.v} />
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
              <div key={i} className="ppn__nest is-empty">
                <i className="ppn__straw" aria-hidden="true" />
                <em>Пусто</em>
              </div>
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
                  say(`${eggOf(n.egg).name} греется: ещё ${fmt(n.left)} блоков работы`);
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
            <span key={id} className="ppn__chip">
              <EggArt egg={id} size={26} />×{p.eggs[id]}
            </span>
          ))}
        </div>
      )}

      <h4 className="ppn__h">Яйца</h4>
      <div className="ppn__shop">
        {EGGS.map((e) => {
          const sold = e.price > 0;
          const locked = sold && p.rank < e.from;
          const room = p.nest.length < NEST_SLOTS || eggCount(p.eggs) < EGG_BASKET;
          const can = sold && !locked && room && balance >= e.price;
          return (
            <button
              key={e.id}
              type="button"
              className={`ppn__buy${locked ? ' is-locked' : ''}${sold ? '' : ' is-rare'}`}
              style={rarityVars(EGG_RARITY[e.id])}
              aria-disabled={!can}
              onClick={() => {
                primeAudio();
                if (!sold) {
                  tapLight();
                  say('Драконье не продаётся: сундуки, сейды и достижения');
                  return;
                }
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
                if (balance < e.price) {
                  uiError();
                  notifyWarning();
                  say(`Не хватает ${shortMoney(e.price - balance)} монет`);
                  return;
                }
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
              {!sold ? (
                <i>не продаётся</i>
              ) : locked ? (
                <i>
                  <KIcon name="locked" /> ранг {rankLetter(e.from)}
                </i>
              ) : (
                <span className="ppn__price">
                  <CoinIcon size={14} /> {shortMoney(e.price)}
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
              className={`ppn__card r${d.rarity}${rec ? '' : ' is-ghost'}${p.squad.includes(d.id) ? ' is-with' : ''}`}
              style={rarityVars(d.rarity)}
              onClick={() => {
                tapLight();
                setSheet(d.id);
              }}
            >
              <PetArt id={d.id} size={48} v={rec?.v ?? 0} ghost={!rec} still />
              {canMerge(rec) && <i className="ppn__dot">!</i>}
            </button>
          );
        })}
      </div>

      {note && <div className="ppn__note">{note}</div>}
      {sheet && <PetSheet id={sheet} onClose={() => setSheet(null)} />}
      {pick !== null && <SquadPicker slot={pick} onClose={() => setPick(null)} />}
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
    </div>
  );
}

// ---- Карточка питомца --------------------------------------------------------

function PetSheet({ id, onClose }: { id: PetId; onClose: () => void }) {
  const p = useFinanceStore((s) => s.prison);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const merge = useFinanceStore((s) => s.prisonPetMerge);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const [joy, setJoy] = useState(0);
  const [xpPop, setXpPop] = useState(0);
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
          v={rec?.v ?? 0}
          ghost={!rec}
          joy={joy}
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
                Копии до {rec.v === 0 ? 'золотого' : 'радужного'}:{' '}
                {Math.min(rec.dup, MERGE_NEED[rec.v])}/{MERGE_NEED[rec.v]}
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
                      burstConfetti(
                        60,
                        rec.v === 0 ? ['#ffd24a', '#fff3b0', '#ffffff'] : undefined,
                      );
                      setJoy((j) => j + 1);
                    }
                  }}
                >
                  Сделать {rec.v === 0 ? 'золотым' : 'радужным'}
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
                <PetArt id={id} size={48} v={rec.v} still />
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
          ? `Копия · ${Math.min(rec.dup, MERGE_NEED[rec.v])}/${MERGE_NEED[rec.v]} до ${rec.v === 0 ? 'золотого' : 'радужного'}`
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
            <PetArt id={res.id} size={190} v={rec?.v ?? 0} />
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
