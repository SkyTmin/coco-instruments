// Сундуки (v2.71): вкладка лагеря и сцена открытия. Правила — lib/prison.ts
// (`rollCase`, `CASE_BUNDLE`), стор — `prisonOpenCase(s)`.
//
// Сундук — 3D-рендер (scripts/chests-render), закрытый и открытый, по
// ярусу. В сундуке набор: монеты, токены, приз (книга, руна, находка…).
// Ярус не виден заранее: падает обычный сундук и при открытии «растёт» —
// вздрагивает и со вспышкой становится редким, эпическим, легендарным.
// Исход решён стором в обработчике тапа (StrictMode в разработке гоняет
// эффекты дважды — открывать в эффекте нельзя), сцена его только показывает.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RarityName, rarityVars } from '@/components/PickArt';
import { KeyIcon, RewardIcon, rewardLabel } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { CasesOpened } from '@/store';
import { rarityOf } from '@/lib/rarity';
import { caseClimb, caseTierOf, petOf, RUNE_ROMAN, runeOf, shortMoney } from '@/lib/prison';
import type { CaseRoll, CaseTier, ItemId, Reward } from '@/lib/prison';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import {
  caseTick,
  cardFlip,
  chestGrow,
  chestLand,
  chestLatch,
  chestOpen,
  chestShake,
  coinDing,
  primeAudio,
  softChime,
  tierBreak,
  uiError,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Ярус сундука → ступень редкости (цвет): как у книг. */
export const CHEST_RARITY: Record<CaseTier, number> = { common: 0, rare: 2, epic: 3, legend: 4 };
/** Имя сундука: «сундук» мужского рода, а `CASE_TIERS` говорят про посылки. */
export const CHEST_NAME: Record<CaseTier, string> = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legend: 'Легендарный',
};
const TIER_ORDER: CaseTier[] = ['common', 'rare', 'epic', 'legend'];

/** Сундук: 3D-рендер яруса, закрытый или открытый. */
export function ChestArt({
  tier = 'common',
  open = false,
  size = 96,
}: {
  tier?: CaseTier;
  open?: boolean;
  size?: number;
}) {
  return (
    <img
      className="pchest-img"
      src={`/ui/chests/${tier}-${open ? 'open' : 'closed'}.webp`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

/** Последние призы за сессию — живут, пока открыто приложение. */
const recent: Reward[] = [];
const RECENT_MAX = 8;

/** Главный приз набора — последний. */
const prizeOf = (r: CaseRoll): Reward => r.rewards[r.rewards.length - 1];

/** Подпись карточки: коротко, как на игровой карте. */
function cardText(r: Reward): string {
  switch (r.kind) {
    case 'coins':
      return `+${shortMoney(r.amount)}`;
    case 'tokens':
      return `+${fmt(r.amount)}`;
    case 'keys':
      return r.amount > 1 ? `${r.amount} ключа` : 'Ключ';
    case 'rune':
      return `${runeOf(r.rune.kind).name} ${RUNE_ROMAN[r.rune.tier - 1]}`;
    default:
      return rewardLabel(r).replace(/^Книга «(.*)»$/, '$1');
  }
}

/** Вторая строка приза: что это и куда легло. */
function cardSub(r: Reward): string | null {
  switch (r.kind) {
    case 'book':
      return `книга · шанс ${r.book.chance}%`;
    case 'rune':
      return 'руна · в мешочек';
    case 'find':
      return 'находка · в коллекцию';
    case 'pet':
      return 'новый питомец';
    case 'keys':
      return 'ещё сундук';
    case 'item':
      return 'в ряд расходников';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Вкладка.
// ---------------------------------------------------------------------------

interface Scene {
  got: CasesOpened;
  gain: [number, number] | null;
  id: number;
}

export function ChestTab({ onGain }: { onGain: (from: number, to: number) => void }) {
  const keys = useFinanceStore((s) => s.prison.keys);
  const openOne = useFinanceStore((s) => s.prisonOpenCase);
  const openAll = useFinanceStore((s) => s.prisonOpenCases);
  const [scene, setScene] = useState<Scene | null>(null);
  const [batch, setBatch] = useState<{ got: CasesOpened; gain: [number, number] | null } | null>(
    null,
  );
  const [hint, setHint] = useState<number>(0);
  const [, bump] = useState(0);
  const seq = useRef(0);

  const remember = (rolls: CaseRoll[]) => {
    for (const r of rolls) recent.unshift(prizeOf(r));
    recent.splice(RECENT_MAX);
    bump((x) => x + 1);
  };

  /** Открыть один: ключ и набор — сразу в сторе, сцена потом показывает. */
  const start = (): boolean => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = openOne();
    if (!got) {
      uiError();
      notifyWarning();
      setHint(Date.now());
      return false;
    }
    const to = useFinanceStore.getState().slotsBalance;
    remember(got.rolls);
    seq.current += 1;
    setScene({ got, gain: to > from ? [from, to] : null, id: seq.current });
    return true;
  };

  return (
    <div className="pforge pch">
      <div className={`pch-stage${keys > 0 ? '' : ' is-empty'}`}>
        <i className="pch-stage__glow" aria-hidden="true" />
        <i className="pch-ped" aria-hidden="true" />
        <button
          type="button"
          className="pch-hero"
          aria-label="Открыть сундук"
          onClick={() => {
            tapLight();
            start();
          }}
        >
          <ChestArt size={210} />
          <i className="pch-hero__glint" aria-hidden="true" />
        </button>
        <span className="pch-keys">
          <KeyIcon size={24} /> ×{fmt(keys)}
        </span>
      </div>

      <div className="pch-btns">
        <button
          type="button"
          className="gx-btn gx-btn--red gx-btn--big pch-open"
          aria-disabled={keys <= 0}
          onClick={() => {
            tapLight();
            start();
          }}
        >
          Открыть
        </button>
        {keys >= 2 && (
          <button
            type="button"
            className="gx-btn gx-btn--big pch-all"
            onClick={() => {
              primeAudio();
              tapLight();
              const from = useFinanceStore.getState().slotsBalance;
              const got = openAll(keys);
              if (!got) {
                notifyWarning();
                return;
              }
              const to = useFinanceStore.getState().slotsBalance;
              remember(got.rolls.slice(-RECENT_MAX));
              setBatch({ got, gain: to > from ? [from, to] : null });
            }}
          >
            Все · {fmt(keys)}
          </button>
        )}
      </div>
      {(keys <= 0 || hint > 0) && (
        <p key={hint} className={`pch-hint${hint ? ' is-shake' : ''}`}>
          <KeyIcon size={14} /> Ключи падают с блоков, по одному дают за ранг, пачкой — за престиж
        </p>
      )}

      <div className="pch-odds">
        {TIER_ORDER.map((id) => (
          <span key={id} className="pch-odd" style={rarityVars(CHEST_RARITY[id])}>
            <ChestArt tier={id} size={58} />
            <b>{CHEST_NAME[id]}</b>
            <i>{caseTierOf(id).weight}%</i>
          </span>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="pch-recent">
          <b>Последнее из сундуков</b>
          <div>
            {recent.map((r, i) => (
              <span key={i} title={rewardLabel(r)}>
                <RewardIcon r={r} size={30} />
              </span>
            ))}
          </div>
        </div>
      )}

      {scene &&
        createPortal(
          <ChestScene
            key={scene.id}
            roll={scene.got.rolls[0]}
            gain={scene.gain}
            shattered={scene.got.shattered}
            onGain={onGain}
            onAgain={() => {
              if (!start()) setScene(null);
            }}
            onClose={() => setScene(null)}
          />,
          document.body,
        )}
      {batch &&
        createPortal(
          <ChestsBatch
            got={batch.got}
            onDone={() => {
              if (batch.gain) onGain(batch.gain[0], batch.gain[1]);
            }}
            onClose={() => setBatch(null)}
          />,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Сцена: падение → ключ → рост → крышка → карточки.
// ---------------------------------------------------------------------------

type Phase = 'drop' | 'key' | 'climb' | 'open' | 'done';

function ChestScene({
  roll,
  gain,
  shattered,
  onGain,
  onAgain,
  onClose,
}: {
  roll: CaseRoll;
  gain: [number, number] | null;
  shattered: number;
  onGain: (from: number, to: number) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const keys = useFinanceStore((s) => s.prison.keys);
  const climb = caseClimb(roll.tier);
  const final = TIER_ORDER[climb];
  const [phase, setPhase] = useState<Phase>('drop');
  const [step, setStep] = useState(0);
  const [shake, setShake] = useState(0);
  const [cards, setCards] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const paid = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tier = TIER_ORDER[step];
  const r = CHEST_RARITY[tier];
  const opened = phase === 'open' || phase === 'done';

  useEffect(() => registerEscape(() => closeRef.current()), []);

  const pay = () => {
    if (paid.current || !gain) return;
    paid.current = true;
    onGain(gain[0], gain[1]);
  };

  const finish = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(climb);
    setCards(roll.rewards.length);
    setPhase('done');
    pay();
  };

  useEffect(() => {
    if (reduceMotion()) {
      chestOpen(caseTierOf(roll.tier).beats);
      finish();
      return undefined;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const beats = caseTierOf(roll.tier).beats;
    // 1. Падение и посадка.
    at(430, () => {
      chestLand();
      tapMedium();
    });
    // 2. Ключ в замок.
    at(620, () => setPhase('key'));
    at(1080, () => {
      chestLatch();
      tapLight();
    });
    // 3. Рост: встряска, вспышка — ярус выше. Легендарный — медленнее.
    let t = 1320;
    at(t, () => setPhase('climb'));
    for (let i = 1; i <= climb; i++) {
      const last = i === climb && climb === 3;
      at(t, () => {
        setShake((x) => x + 1);
        chestShake();
      });
      at(t + (last ? 620 : 380), () => {
        flashFrame(last ? 'mega' : i >= 2 ? 'big' : 'small');
        setStep(i);
        chestGrow(i);
        tapMedium();
        if (i >= 2)
          burstConfetti(30 + 25 * i, [rarityOf(CHEST_RARITY[TIER_ORDER[i]]).color, '#ffffff']);
      });
      t += last ? 1150 : 780;
    }
    // Последняя встряска без роста — пауза-вопрос «ещё?». У легендарного
    // её нет: выше некуда.
    if (climb < 3) {
      at(t, () => {
        setShake((x) => x + 1);
        chestShake();
      });
      t += 560;
    }
    // 4. Крышка.
    at(t, () => {
      setPhase('open');
      flashFrame(beats >= 2 ? 'big' : 'small');
      chestOpen(beats);
      notifySuccess();
      if (beats >= 2)
        burstConfetti(50 + 30 * beats, [rarityOf(CHEST_RARITY[final]).color, '#ffe08a', '#fff']);
    });
    t += 480;
    // 5. Карточки по одной, приз — последним и с паузой.
    roll.rewards.forEach((rw, j) => {
      const prize = j === roll.rewards.length - 1;
      at(t + j * 360 + (prize ? 260 : 0), () => {
        setCards(j + 1);
        cardFlip();
        if (rw.kind === 'coins') {
          coinDing();
          pay();
        }
        if (prize) {
          softChime(6);
          if (beats >= 2) tierBreak(Math.min(3, beats));
        }
      });
    });
    at(t + roll.rewards.length * 360 + 520, () => setPhase('done'));
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз на сундук (новый сундук — новый ключ компонента).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`pchs is-${phase}${opened ? ' is-opened' : ''} t-${tier}`}
      style={rarityVars(r)}
      onClick={() => {
        if (phase !== 'done') finish();
      }}
    >
      <div className="pchs__head">
        <RarityName rarity={r}>{CHEST_NAME[tier]} сундук</RarityName>
      </div>
      <div className="pchs__stage">
        <i className="pchs__rays" aria-hidden="true" />
        <i key={`b${step}`} className="pchs__burst" aria-hidden="true" />
        <i className="pchs__floor" aria-hidden="true" />
        <div className="pchs__drop">
          <div key={`s${shake}`} className={`pchs__chest${shake ? ' is-shake' : ''}`}>
            <ChestArt tier={tier} open={opened} size={240} />
          </div>
        </div>
        {phase === 'drop' && <i className="pchs__dust" aria-hidden="true" />}
        {phase === 'key' && (
          <span className="pchs__key" aria-hidden="true">
            <KeyIcon size={60} />
          </span>
        )}
      </div>
      {/* Место под карточки занято с первого кадра — иначе сундук прыгал бы
          вверх, когда они появляются. Приз — отдельной строкой, крупно. */}
      <div className="pchs__cards">
        <div className="pchs__row">
          {roll.rewards.slice(0, Math.min(cards, roll.rewards.length - 1)).map((rw, j) => (
            <span key={j} className="pchs__card">
              <span className="pchs__icon">
                <RewardIcon r={rw} size={40} />
              </span>
              <b>{cardText(rw)}</b>
            </span>
          ))}
        </div>
        {cards >= roll.rewards.length && (
          <span className="pchs__card is-prize">
            <span className="pchs__icon">
              <RewardIcon r={prizeOf(roll)} size={64} />
            </span>
            <b>{cardText(prizeOf(roll))}</b>
            {cardSub(prizeOf(roll)) && <i>{cardSub(prizeOf(roll))}</i>}
          </span>
        )}
      </div>
      {phase === 'done' ? (
        <div className="pchs__btns" onClick={(e) => e.stopPropagation()}>
          {shattered > 0 && (
            <span className="pchs__note">
              Мешочек рун полон — руна разбита на {fmt(shattered)} ✦
            </span>
          )}
          <button
            type="button"
            className="gx-btn gx-btn--red gx-btn--big"
            aria-disabled={keys <= 0}
            onClick={() => {
              tapLight();
              if (keys <= 0) {
                uiError();
                return;
              }
              onAgain();
            }}
          >
            Ещё · <KeyIcon size={18} /> {fmt(keys)}
          </button>
          <button
            type="button"
            className="gx-btn gx-btn--big"
            onClick={() => {
              tapLight();
              onClose();
            }}
          >
            Готово
          </button>
        </div>
      ) : (
        <span className="pchs__skip">тап — сразу открыть</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// «Открыть все»: сундуки волной, потом итог.
// ---------------------------------------------------------------------------

interface CaseSum {
  tiers: Record<CaseTier, number>;
  /** Что складывается — одной строкой на вид. */
  summed: Reward[];
  /** Что не складывается — поштучно: книги первыми. */
  single: Reward[];
}

const SINGLE_ORDER: Record<string, number> = { book: 0, rune: 1, find: 2, pet: 3 };

/** Сложить наборы: монеты к монетам, бомбы к бомбам; книги — вперёд. */
function sumCases(rolls: CaseRoll[]): CaseSum {
  const tiers: Record<CaseTier, number> = { common: 0, rare: 0, epic: 0, legend: 0 };
  let coins = 0;
  let tokens = 0;
  let keys = 0;
  let treats = 0;
  const items = new Map<ItemId, number>();
  const single: Reward[] = [];
  for (const r of rolls) {
    tiers[r.tier] += 1;
    for (const x of r.rewards) {
      if (x.kind === 'coins') coins += x.amount;
      else if (x.kind === 'tokens') tokens += x.amount;
      else if (x.kind === 'keys') keys += x.amount;
      else if (x.kind === 'treat') treats += 1;
      else if (x.kind === 'item') items.set(x.id, (items.get(x.id) ?? 0) + x.amount);
      else single.push(x);
    }
  }
  const summed: Reward[] = [];
  if (coins) summed.push({ kind: 'coins', amount: coins });
  if (tokens) summed.push({ kind: 'tokens', amount: tokens });
  if (keys) summed.push({ kind: 'keys', amount: keys });
  for (const [id, amount] of items) summed.push({ kind: 'item', id, amount });
  if (treats) summed.push({ kind: 'treat', amount: treats });
  const rank = (x: Reward) =>
    x.kind === 'book' ? -x.book.lvl : x.kind === 'rune' ? -x.rune.tier : 0;
  single.sort(
    (a, b) => (SINGLE_ORDER[a.kind] ?? 9) - (SINGLE_ORDER[b.kind] ?? 9) || rank(a) - rank(b),
  );
  return { tiers, summed, single };
}

/** Сколько сундуков рисуем волной; остальные — «+N». */
const BATCH_TILES = 24;

function ChestsBatch({
  got,
  onDone,
  onClose,
}: {
  got: CasesOpened;
  onDone: () => void;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);
  const sum = sumCases(got.rolls);
  const shown = got.rolls.slice(0, BATCH_TILES);
  const best = [...TIER_ORDER].reverse().find((t) => sum.tiers[t] > 0) ?? 'common';
  const step = Math.min(90, 1600 / Math.max(1, shown.length));
  const total = step * shown.length + 450;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => registerEscape(() => closeRef.current()), []);

  useEffect(() => {
    if (reduceMotion()) {
      setDone(true);
      return undefined;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ticks = Math.min(14, shown.length);
    for (let i = 0; i < ticks; i++)
      timers.push(setTimeout(() => caseTick(), (i * (total - 450)) / Math.max(1, ticks)));
    timers.push(setTimeout(() => setDone(true), total));
    return () => timers.forEach(clearTimeout);
  }, [shown.length, total]);

  useEffect(() => {
    if (!done) return;
    const beats = caseTierOf(best).beats;
    chestOpen(beats);
    flashFrame(beats >= 2 ? 'big' : 'small');
    burstConfetti(30 + beats * 30, [rarityOf(CHEST_RARITY[best]).color, '#ffe08a', '#fff']);
    coinDing();
    notifySuccess();
    doneRef.current();
  }, [done, best]);

  const count = (n: number) =>
    n % 10 === 1 && n % 100 !== 11
      ? 'сундук'
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
        ? 'сундука'
        : 'сундуков';

  return (
    <div
      className={`pchb${done ? ' is-done' : ''}`}
      style={{ ...rarityVars(CHEST_RARITY[best]), '--step': `${step}ms` } as CSSProperties}
      onClick={() => {
        if (!done) setDone(true);
      }}
    >
      <div className="pchb__card" onClick={(e) => done && e.stopPropagation()}>
        <span className="pchb__title">
          Открыто {fmt(got.rolls.length)} {count(got.rolls.length)}
        </span>
        <span className="pchb__tiers">
          {TIER_ORDER.filter((t) => sum.tiers[t] > 0).map((t) => (
            <span key={t} style={rarityVars(CHEST_RARITY[t])}>
              <ChestArt tier={t} size={30} /> ×{sum.tiers[t]}
            </span>
          ))}
        </span>
        <div className="pchb__grid">
          {shown.map((r, i) => (
            <span key={i} className="pchb__tile" style={{ '--i': i } as CSSProperties}>
              <span className="pchb__closed">
                <ChestArt tier={r.tier} size={48} />
              </span>
              <span className="pchb__open">
                <ChestArt tier={r.tier} open size={48} />
              </span>
            </span>
          ))}
          {got.rolls.length > shown.length && (
            <span className="pchb__more">+{got.rolls.length - shown.length}</span>
          )}
        </div>
        {done && (
          <div className="pchb__sum">
            <b>Итого</b>
            {sum.single.length > 0 && (
              <span className="pchb__singles">
                {sum.single.map((r, i) => (
                  <span key={i} className="pchb__single" title={rewardLabel(r)}>
                    <RewardIcon r={r} size={r.kind === 'book' ? 46 : 40} />
                    <i>{r.kind === 'book' ? cardText(r) : rewardLabel(r)}</i>
                  </span>
                ))}
              </span>
            )}
            {sum.summed.map((r, i) => (
              <span key={i} className="pchb__row">
                <RewardIcon r={r} size={24} />
                <em>
                  {r.kind === 'treat'
                    ? `Лакомство питомцу ×${r.amount}`
                    : r.kind === 'keys'
                      ? `${r.amount} ${r.amount === 1 ? 'ключ' : r.amount < 5 ? 'ключа' : 'ключей'}`
                      : rewardLabel(r)}
                </em>
              </span>
            ))}
            {got.newPets.length > 0 && (
              <span className="pchb__note">
                Новый питомец: {got.newPets.map((id) => petOf(id).name).join(', ')}
              </span>
            )}
            {got.shattered > 0 && (
              <span className="pchb__note">
                Мешочек рун полон — лишние разбиты на {fmt(got.shattered)} ✦
              </span>
            )}
            <button type="button" className="gx-btn gx-btn--red gx-btn--big" onClick={onClose}>
              Забрать всё
            </button>
          </div>
        )}
        {!done && <span className="pchb__skip">тап — показать итог</span>}
      </div>
    </div>
  );
}

// Для значка на нижней панели шахты.
export function ChestIcon({ size = 30 }: { size?: number }) {
  return (
    <span className="pchest-ico" style={{ width: size, height: size }} aria-hidden="true">
      <ChestArt size={size} />
    </span>
  );
}
