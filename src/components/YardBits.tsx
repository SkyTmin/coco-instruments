// Общие куски «Двора» (v2.54): объявление события, плашка с таймером и
// лист Барыги. Шахта, лес и сам двор показывают их одинаково.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GxIcon, GxSheet } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { RewardIcon, rewardLabel } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { YardEnd } from '@/store';
import { liveEvent, shortMoney } from '@/lib/prison';
import type { YardEvent } from '@/lib/prison';
import {
  barygaBought,
  barygaLots,
  barygaWindow,
  BARYGA_HOT,
  BARYGA_MS,
  eventOf,
  prizeText,
} from '@/lib/yard';
import type { YardPrize } from '@/lib/yard';
import { barygaTexture, rockTexture } from '@/lib/prison-art';
import { useExit } from '@/lib/use-exit';
import { coinDing, primeAudio, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning } from '@/lib/haptics';

const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return t < 60 ? `${t} с` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Живое событие этой страницы и часы к нему. Страница перерисовывается раз в
 * секунду, только пока событие идёт; кончилось по часам — стор закрывает его
 * (`yardExpire`), и страница узнаёт, чем кончилось.
 */
export function useYardEvent(
  place: 'mine' | 'forest',
  onEnd: (end: YardEnd) => void,
): { ev: YardEvent | null; now: number } {
  const event = useFinanceStore((s) => s.prison.event);
  const yardExpire = useFinanceStore((s) => s.yardExpire);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (!event) return undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= event.until) {
        const end = yardExpire();
        if (end && event.place === place) endRef.current(end);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [event, place, yardExpire]);
  const ev = event && event.place === place && event.until > now ? event : null;
  return { ev, now };
}

/** Что сказать, когда событие ушло без награды. */
export function endText(end: YardEnd): string | null {
  if (!end.failed) return null;
  switch (end.id) {
    case 'meteor':
      return 'Метеорит остыл и ушёл в породу';
    case 'kuiva':
      return 'Куйва ушёл обратно в скалу';
    case 'convoy':
      return 'Конвой уехал без груза';
    case 'bear':
      return end.lost > 0 ? `Медведь унёс ${end.lost} брёвен` : 'Медведь ушёл ни с чем';
    default:
      return null;
  }
}

/** Объявление: крупно, на две с половиной секунды, не мешает бить. */
export function EventAnnounce({ ev, onDone }: { ev: YardEvent | null; onDone: () => void }) {
  const [shown, leaving] = useExit(ev, 320);
  useEffect(() => {
    if (!ev) return undefined;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [ev, onDone]);
  if (!shown) return null;
  const def = eventOf(shown.id);
  return (
    <div
      className={`yannounce${leaving ? ' is-out' : ''}`}
      style={{ '--ev': def.color } as CSSProperties}
      role="status"
    >
      <span className="yannounce__tag">Во дворе</span>
      <b className="yannounce__name">
        <i>{def.glyph}</i> {def.name}
      </b>
      <span className="yannounce__lead">{def.lead}</span>
    </div>
  );
}

/** Плашка события: знак, имя, таймер, прогресс, если он есть. */
export function EventPill({ ev, now }: { ev: YardEvent; now: number }) {
  const def = eventOf(ev.id);
  const left = ev.until - now;
  const part = ev.need ? `${Math.min(ev.have, ev.need)}/${ev.need} · ` : '';
  return (
    <span
      className={`pbuff pbuff--event${left < 10_000 ? ' is-ending' : ''}`}
      style={{ '--ev': def.color } as CSSProperties}
    >
      {ev.id === 'convoy' && ev.rock >= 0 ? (
        <img className="pbuff__rock" src={rockTexture(ev.rock)} alt="" />
      ) : (
        def.glyph
      )}{' '}
      {def.name} · {part}
      {clock(left)}
    </span>
  );
}

/** Приз события — одной строкой для тоста. */
export function prizeSay(x: YardPrize): string {
  const name = eventOf(x.id).name;
  const item = x.item ? ` · ${rewardLabel({ kind: 'item', id: x.item.id, amount: x.item.n })}` : '';
  return `${name}: ${prizeText(x)}${item}`;
}

// ---- Торговец (в коде — Барыга) -----------------------------------------------------------------

export function BarygaSheet({
  onClose,
  onGain,
}: {
  onClose: () => void;
  /** Монеты ушли или пришли — табло встаёт на новое значение. */
  onGain?: () => void;
}) {
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const barygaBuy = useFinanceStore((s) => s.barygaBuy);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const w = barygaWindow(now);
  const lots = barygaLots(w, p);
  const bought = barygaBought(p, w);
  const next = (w + 1) * BARYGA_MS - now;
  const h = Math.floor(next / 3_600_000);
  const m = Math.ceil((next % 3_600_000) / 60_000);

  return (
    <GxSheet title="Торговец" className="gx-camp" onClose={onClose}>
      <div className="stack">
        <div className="ybaryga">
          <img src={barygaTexture()} alt="" />
          <span>
            <b>«Всё есть, всё за монеты».</b>
            <i>
              <GxIcon name="hourglass" size={14} /> Новый товар через {h ? `${h} ч ` : ''}
              {m} мин
            </i>
          </span>
        </div>
        {lots.map((lot, i) => {
          const left = lot.stock - (bought[i] ?? 0);
          const can = left > 0 && balance >= lot.price;
          return (
            <div key={i} className={`pforge__row ylot${lot.hot ? ' is-hot' : ''}`}>
              <span className="pforge__ico">
                <RewardIcon r={lot.reward} size={30} />
              </span>
              <span className="pforge__info">
                <b>
                  {rewardLabel(lot.reward)}
                  {lot.hot && <em className="ylot__hot">−{Math.round(BARYGA_HOT * 100)}%</em>}
                </b>
                <i>{left > 0 ? `осталось ${left}` : 'разобрали'}</i>
              </span>
              <button
                type="button"
                className="btn btn--sm pforge__buy"
                disabled={!can}
                onClick={() => {
                  primeAudio();
                  const got = barygaBuy(i);
                  if (!got) {
                    notifyWarning();
                    return;
                  }
                  onGain?.();
                  coinDing();
                  tierBreak(lot.hot ? 2 : 1);
                  notifySuccess();
                  setNote(
                    got.shattered
                      ? `Мешочек рун полон — руна разбита на ${got.shattered} ✦`
                      : `Взято: ${rewardLabel(lot.reward)}`,
                  );
                }}
              >
                {left > 0 ? (
                  <>
                    {shortMoney(lot.price)} <CoinIcon size={12} />
                  </>
                ) : (
                  'нет'
                )}
              </button>
            </div>
          );
        })}
        {note && <p className="ybaryga__note">{note}</p>}
        <p className="pcamp-note">
          Только здесь монеты меняются на токены и ключи. Товар со скидкой — пока не разобрали.
        </p>
      </div>
    </GxSheet>
  );
}

export { liveEvent };
