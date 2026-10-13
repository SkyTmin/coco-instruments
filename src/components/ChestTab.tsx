// Сундуки (v2.71): вкладка лагеря и сцена открытия. Правила — lib/prison.ts
// (`rollCase`, `CASE_BUNDLE`), стор — `prisonOpenCase(s)`.
//
// Сундук — пиксельные полосы (`lib/props-pixel/chests.ts`, запекание
// `scripts/props-pixel/bake.ts -- --set chests`): покой яруса, открытие
// яруса, тёмный сундук-загадка и его вращение. В сундуке набор: монеты,
// токены, приз (книга, руна, находка…).
// Ярус не виден заранее: падает обычный сундук и при открытии «растёт» —
// вздрагивает и со вспышкой становится редким, эпическим, легендарным.
// Исход решён стором в обработчике тапа (StrictMode в разработке гоняет
// эффекты дважды — открывать в эффекте нельзя), сцена его только показывает.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RarityName, rarityVars } from '@/components/PickArt';
import { PxStrip, preloadPx, pxFitOf } from '@/components/PxStrip';
import { pxStrip } from '@/lib/props-pixel/manifest';
import { KeyIcon, RewardIcon, rewardLabel } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { CasesOpened } from '@/store';
import { fmtNum, fmtShort, itemName, petName, rich, runeName, t, useT } from '@/i18n';
import { bookName, eggName } from '@/i18n/data-books';
import { findName } from '@/i18n/data-mine';
import { rarityOf } from '@/lib/rarity';
import { caseClimb, caseTierOf, RUNE_ROMAN } from '@/lib/prison';
import type { CaseRoll, CaseTier, ItemId, Reward } from '@/lib/prison';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { registerEscape } from '@/lib/escape-stack';
import {
  caseTick,
  cardFlip,
  chestFly,
  chestLand,
  chestLatch,
  chestOpen,
  chestReveal,
  chestShake,
  coinDing,
  primeAudio,
  softChime,
  tierBreak,
  uiError,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => fmtNum(n);

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Ярус сундука → ступень редкости (цвет): как у книг. */
export const CHEST_RARITY: Record<CaseTier, number> = { common: 0, rare: 2, epic: 3, legend: 4 };
const TIER_ORDER: CaseTier[] = ['common', 'rare', 'epic', 'legend'];
/** Сторона сундука в сцене: крупная полоса ровно ×2 CSS (×6 точек на DPR 3, ×4 на DPR 2). */
const SCENE_PX = 240;

/**
 * Сундук: пиксельная полоса яруса. Закрытый — кадр 0 покоя (`live` — живой
 * покой: блик по оковке, у легендарного парение и искры), открытый —
 * последний кадр открытия.
 */
export function ChestArt({
  tier = 'common',
  open = false,
  size = 96,
  live = false,
  phase = 0,
}: {
  /** `mystery` — тёмный сундук-загадка (ярус ещё не известен). */
  tier?: CaseTier | 'mystery';
  open?: boolean;
  size?: number;
  live?: boolean;
  phase?: number;
}) {
  const shut = !open || tier === 'mystery';
  return (
    <PxStrip
      set="chests"
      name={shut ? `idle-${tier}` : `open-${tier}`}
      size={size}
      mode={live && shut ? 'loop' : 'still'}
      frame={shut ? 0 : -1}
      phase={phase}
      className="pchest-px"
    />
  );
}

/**
 * Скважина замка в CSS-пикселях от угла квадрата `size`: якорь `lock` полосы
 * в процентах рамки, рамка подогнана под целый масштаб и стоит по центру.
 */
function lockAt(size: number): [number, number] {
  const fo = pxFitOf('chests', 'idle-common', size);
  const [lx, ly] = pxStrip('chests', 'idle-common')?.anchors?.lock ?? [40, 69];
  const s = fo?.fit.s ?? size;
  const o = (size - s) / 2;
  return [o + (s * lx) / 100, o + (s * ly) / 100];
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
      return `+${fmtShort(r.amount)}`;
    case 'tokens':
      return `+${fmt(r.amount)}`;
    case 'keys':
      return r.amount > 1 ? t('chests.keys', { n: r.amount }) : t('chests.key');
    case 'rune':
      return `${runeName(r.rune.kind)} ${RUNE_ROMAN[r.rune.tier - 1]}`;
    case 'book':
      return bookName(r.book);
    case 'pet':
      return petName(r.id);
    case 'egg':
      return eggName(r.egg);
    case 'item':
      return r.amount > 1 ? `${itemName(r.id)} ×${r.amount}` : itemName(r.id);
    case 'treat':
      return t('chests.treat');
    case 'find':
      return findName(r.id);
    default:
      return rewardLabel(r);
  }
}

/** Полная подпись награды — итог «Открыть все» и подсказки. */
function fullText(r: Reward): string {
  switch (r.kind) {
    case 'coins':
      return t('chests.coins', { n: r.amount, v: fmtShort(r.amount) });
    case 'tokens':
      return t('chests.tokens', { n: r.amount });
    case 'keys':
      return t('chests.keys', { n: r.amount });
    case 'treat':
      return r.amount > 1 ? t('chests.treats', { n: r.amount }) : t('chests.treat');
    case 'rune':
      return t('chests.rune', { name: cardText(r) });
    default:
      return cardText(r);
  }
}

/** Вторая строка приза: что это и куда легло. */
function cardSub(r: Reward): string | null {
  switch (r.kind) {
    case 'book':
      return t('chests.sub.book', { v: r.book.chance });
    case 'rune':
    case 'find':
    case 'pet':
    case 'egg':
    case 'keys':
    case 'item':
      return t(`chests.sub.${r.kind}`);
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
  const t = useT();
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

  // Полёт начинается сразу по тапу: вращение и тёмный сундук — заранее.
  useEffect(() => {
    void preloadPx('chests', 'mystery-spin', SCENE_PX);
    void preloadPx('chests', 'idle-mystery', SCENE_PX);
  }, []);

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
          aria-label={t('chests.openAria')}
          onClick={() => {
            tapLight();
            start();
          }}
        >
          <ChestArt size={180} live />
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
          {t('chests.open')}
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
            {t('chests.all', { n: fmt(keys) })}
          </button>
        )}
      </div>
      {(keys <= 0 || hint > 0) && (
        <p key={hint} className={`pch-hint${hint ? ' is-shake' : ''}`}>
          <KeyIcon size={14} /> {t('chests.hint')}
        </p>
      )}

      <div className="pch-odds">
        {TIER_ORDER.map((id) => (
          <span key={id} className="pch-odd" style={rarityVars(CHEST_RARITY[id])}>
            <ChestArt tier={id} size={48} />
            <b>{t(`chests.tier.${id}`)}</b>
            <i>{t('books.pct', { v: caseTierOf(id).weight })}</i>
          </span>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="pch-recent">
          <b>{t('chests.recent')}</b>
          <div>
            {recent.map((r, i) => (
              <span key={i} title={fullText(r)}>
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
// Сцена: тёмный сундук-загадка вылетает, вращаясь (полоса настоящего 3D-
// вращения), садится и превращается в выпавший → ключ летит в скважину →
// полоса открытия яруса (ключ, защёлка, крышка, свет) → карточки.
// ---------------------------------------------------------------------------

type Phase = 'fly' | 'land' | 'reveal' | 'key' | 'turn' | 'open' | 'done';

/** Полёт тёмного сундука, мс (полоса `mystery-spin`: два оборота за 0,92 с). */
const FLY_MS = 900;
/** Сколько сундук дрожит перед превращением: чем реже ярус, тем дольше. */
const TREMBLE_MS = [140, 260, 420, 700];
/** Превращение — полоса света снизу вверх: старшим медленнее. */
const REVEAL_MS = [480, 560, 700, 950];
/** Ключ летит в скважину (CSS `pch-key`); дальше его поворачивает полоса открытия. */
const KEY_MS = 420;
/** Пауза от пика открытия до первой карточки: старшим дольше — свет и монеты читаются. */
const CARDS_AFTER = [260, 400, 560, 720];
const OPEN_MARKS = ['turn', 'latch', 'lidOpen', 'peak'];

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
  const tx = useT();
  const keys = useFinanceStore((s) => s.prison.keys);
  const tier = roll.tier;
  const k = caseClimb(tier);
  const r = CHEST_RARITY[tier];
  const [phase, setPhase] = useState<Phase>('fly');
  const [shake, setShake] = useState(false);
  const [cards, setCards] = useState(0);
  /** Играет полоса открытия; пропуск тапом — сразу открытый кадр. */
  const [playing, setPlaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const paid = useRef(false);
  const over = useRef(false);
  const fired = useRef(new Set<string>());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const flying = phase === 'fly';
  const known = phase !== 'fly' && phase !== 'land' && phase !== 'reveal';
  const opened = phase === 'open' || phase === 'done';
  const [lx, ly] = lockAt(SCENE_PX);
  // Покой яруса доигрывает петлю ровно к прилёту ключа: полоса открытия
  // начинается с той же позы, без скачка (у легендарного — парение).
  const idle = pxStrip('chests', `idle-${tier}`);
  const idleMs = idle ? (idle.n / idle.fps) * 1000 : 2000;
  const idlePhase = 1 - ((REVEAL_MS[k] + KEY_MS) % idleMs) / idleMs;

  useEffect(() => registerEscape(() => closeRef.current()), []);

  const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const pay = () => {
    if (paid.current || !gain) return;
    paid.current = true;
    onGain(gain[0], gain[1]);
  };

  const finish = () => {
    over.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShake(false);
    setPlaying(false);
    setCards(roll.rewards.length);
    setPhase('done');
    pay();
  };

  /** Карточки по одной, приз — последним и с паузой. */
  const deal = () => {
    const t = CARDS_AFTER[k];
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
          if (k >= 2) tierBreak(Math.min(3, caseTierOf(tier).beats));
        }
      });
    });
    at(t + roll.rewards.length * 360 + 520, () => setPhase('done'));
  };

  /** Метки полосы открытия: звук и фазы сцены идут за кадрами, а не за таймерами. */
  const onMark = (m: string) => {
    if (over.current || fired.current.has(m)) return;
    fired.current.add(m);
    if (m === 'turn') caseTick();
    else if (m === 'latch') {
      chestLatch();
      tapLight();
    } else if (m === 'lidOpen') {
      setPhase('open');
      chestOpen();
      flashFrame('small');
    } else if (m === 'peak') deal();
  };

  useEffect(() => {
    void preloadPx('chests', `open-${tier}`, SCENE_PX);
    void preloadPx('chests', `idle-${tier}`, SCENE_PX);
    if (reduceMotion()) {
      chestReveal(k);
      finish();
      return undefined;
    }
    const color = rarityOf(r).color;
    // 1. Полёт: тёмный сундук вылетает снизу, вращаясь, и падает.
    chestFly();
    at(FLY_MS, () => {
      setPhase('land');
      chestLand();
      tapMedium();
    });
    // 2. Дрожь — пауза-вопрос: чем реже ярус, тем дольше.
    let t = FLY_MS + 260;
    at(t, () => {
      setShake(true);
      chestShake();
    });
    t += TREMBLE_MS[k];
    // 3. Превращение: полоса света снизу вверх открывает настоящий сундук.
    at(t, () => {
      setShake(false);
      setPhase('reveal');
      chestReveal(k);
      tapMedium();
    });
    t += REVEAL_MS[k];
    at(t, () => {
      setPhase('key');
      flashFrame(k >= 3 ? 'mega' : k >= 2 ? 'big' : 'small');
      if (k >= 1) notifySuccess();
      if (k >= 2) burstConfetti(40 + 30 * k, [color, rarityOf(r).light, '#ffffff']);
    });
    // 4. Ключ в скважине — дальше полоса открытия (метки ведут звук и карточки).
    t += KEY_MS;
    at(t, () => {
      setPhase('turn');
      setPlaying(true);
    });
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз на сундук (новый сундук — новый ключ компонента).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`pchs is-${phase}${opened ? ' is-opened' : ''}${known ? ' is-known' : ''} t-${tier}`}
      style={
        {
          ...rarityVars(r),
          '--rv': `${REVEAL_MS[k]}ms`,
          '--lx': `${lx}px`,
          '--ly': `${ly}px`,
        } as CSSProperties
      }
      onClick={() => {
        if (phase !== 'done') finish();
      }}
    >
      <div className="pchs__head">
        {known && <RarityName rarity={r}>{tx(`chests.full.${tier}`)}</RarityName>}
      </div>
      <div className="pchs__stage">
        <i className="pchs__rays" aria-hidden="true" />
        {known && <i className="pchs__burst" aria-hidden="true" />}
        <i className="pchs__floor" aria-hidden="true" />
        {flying ? (
          <div className="pchs__fly">
            <PxStrip set="chests" name="mystery-spin" size={SCENE_PX} mode="loop" />
          </div>
        ) : (
          <div
            className={`pchs__chest${phase === 'land' ? ' is-land' : ''}${shake ? ' is-shake' : ''}`}
          >
            {(phase === 'land' || phase === 'reveal') && (
              <span className="pchs__dark">
                <ChestArt tier="mystery" size={SCENE_PX} live />
                <i className="pchs__glowhole" aria-hidden="true" />
              </span>
            )}
            {phase !== 'land' && (
              <span className={`pchs__reveal${phase === 'reveal' ? ' is-run' : ''}`}>
                <span className="pchs__reveal-in">
                  {playing ? (
                    <PxStrip
                      set="chests"
                      name={`open-${tier}`}
                      size={SCENE_PX}
                      mode="once"
                      poster={`idle-${tier}`}
                      onMark={onMark}
                      onEnd={() => OPEN_MARKS.forEach(onMark)}
                    />
                  ) : (
                    <ChestArt
                      tier={tier}
                      open={opened}
                      size={SCENE_PX}
                      live={!opened}
                      phase={idlePhase}
                    />
                  )}
                </span>
              </span>
            )}
            {phase === 'reveal' && <i className="pchs__sweep" aria-hidden="true" />}
          </div>
        )}
        {phase === 'land' && <i className="pchs__dust" aria-hidden="true" />}
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
            <span className="pchs__note">{tx('chests.shattered', { n: fmt(shattered) })}</span>
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
            {rich('chests.again', { key: <KeyIcon size={18} />, n: fmt(keys) })}
          </button>
          <button
            type="button"
            className="gx-btn gx-btn--big"
            onClick={() => {
              tapLight();
              onClose();
            }}
          >
            {tx('common.ok')}
          </button>
        </div>
      ) : (
        <span className="pchs__skip">{tx('chests.skipOpen')}</span>
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

const SINGLE_ORDER: Record<string, number> = { egg: 0, book: 1, rune: 2, find: 3, pet: 4 };

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
  const EGG_ORDER = { dragon: 0, crystal: 1, stone: 2, moss: 3 };
  const rank = (x: Reward) =>
    x.kind === 'book'
      ? -x.book.lvl
      : x.kind === 'rune'
        ? -x.rune.tier
        : x.kind === 'egg'
          ? EGG_ORDER[x.egg]
          : 0;
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
  const t = useT();
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
    chestReveal(caseClimb(best));
    chestOpen();
    flashFrame(beats >= 2 ? 'big' : 'small');
    burstConfetti(30 + beats * 30, [rarityOf(CHEST_RARITY[best]).color, '#ffe08a', '#fff']);
    coinDing();
    notifySuccess();
    doneRef.current();
  }, [done, best]);

  return (
    <div
      className={`pchb${done ? ' is-done' : ''}`}
      style={{ ...rarityVars(CHEST_RARITY[best]), '--step': `${step}ms` } as CSSProperties}
      onClick={() => {
        if (!done) setDone(true);
      }}
    >
      <div className="pchb__card" onClick={(e) => done && e.stopPropagation()}>
        <span className="pchb__title">{t('chests.opened', { n: got.rolls.length })}</span>
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
            <b>{t('chests.total')}</b>
            {sum.single.length > 0 && (
              <span className="pchb__singles">
                {sum.single.map((r, i) => (
                  <span key={i} className="pchb__single" title={fullText(r)}>
                    <RewardIcon r={r} size={r.kind === 'book' ? 46 : 40} />
                    <i>{r.kind === 'book' ? cardText(r) : fullText(r)}</i>
                  </span>
                ))}
              </span>
            )}
            {sum.summed.map((r, i) => (
              <span key={i} className="pchb__row">
                <RewardIcon r={r} size={24} />
                <em>{fullText(r)}</em>
              </span>
            ))}
            {got.newPets.length > 0 && (
              <span className="pchb__note">
                {t('chests.newPets', { names: got.newPets.map((id) => petName(id)).join(', ') })}
              </span>
            )}
            {got.shattered > 0 && (
              <span className="pchb__note">
                {t('chests.shatteredMany', { n: fmt(got.shattered) })}
              </span>
            )}
            <button type="button" className="gx-btn gx-btn--red gx-btn--big" onClick={onClose}>
              {t('chests.takeAll')}
            </button>
          </div>
        )}
        {!done && <span className="pchb__skip">{t('chests.skipSum')}</span>}
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
