// Общие куски «Двора» (v2.54): объявление события, плашка с таймером и
// лист Барыги. Шахта, лес и сам двор показывают их одинаково.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GxIcon, GxSheet } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { RewardIcon, rewardLabel } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import type { YardEnd } from '@/store';
import { liveEvent } from '@/lib/prison';
import type { YardEvent } from '@/lib/prison';
import { barygaBought, barygaLots, barygaWindow, BARYGA_HOT, BARYGA_MS, eventOf } from '@/lib/yard';
import type { YardPrize } from '@/lib/yard';
import { barygaTexture, rockTexture } from '@/lib/prison-art';
import { useExit } from '@/lib/use-exit';
import { coinDing, primeAudio, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning } from '@/lib/haptics';
import { fmtShort, t, useT } from '@/i18n';
import { eventLead, eventName } from '@/i18n/data-yard';

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s < 60
    ? t('yard.sec', { n: s })
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
      return t('yard.end.meteor');
    case 'kuiva':
      return t('yard.end.kuiva');
    case 'convoy':
      return t('yard.end.convoy');
    case 'bear':
      return end.lost > 0 ? t('yard.end.bear', { n: end.lost }) : t('yard.end.bearNone');
    case 'magpie':
      return t('yard.end.magpie');
    default:
      return null;
  }
}

/** Объявление: крупно, на две с половиной секунды, не мешает бить. */
export function EventAnnounce({ ev, onDone }: { ev: YardEvent | null; onDone: () => void }) {
  const t = useT();
  const [shown, leaving] = useExit(ev, 320);
  useEffect(() => {
    if (!ev) return undefined;
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [ev, onDone]);
  if (!shown) return null;
  const def = eventOf(shown.id);
  return (
    <div
      className={`yannounce${leaving ? ' is-out' : ''}`}
      style={{ '--ev': def.color } as CSSProperties}
      role="status"
    >
      <span className="yannounce__tag">{t('yard.tag')}</span>
      <b className="yannounce__name">
        <i>{def.glyph}</i> {eventName(shown.id)}
      </b>
      <span className="yannounce__lead">{eventLead(shown.id)}</span>
    </div>
  );
}

/** Плашка события: знак, имя, таймер, прогресс, если он есть. */
export function EventPill({ ev, now }: { ev: YardEvent; now: number }) {
  useT();
  const def = eventOf(ev.id);
  const left = ev.until - now;
  // У сороки `have` — монеты в мешочке, а не счёт сданного.
  const part =
    ev.id === 'magpie'
      ? `${fmtShort(ev.have)} · `
      : ev.need
        ? `${Math.min(ev.have, ev.need)}/${ev.need} · `
        : '';
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
      {eventName(ev.id)} · {part}
      {clock(left)}
    </span>
  );
}

/** Приз события на языке игры (`prizeText` из lib — тот же порядок частей). */
function prizeLine(x: YardPrize): string {
  const parts: string[] = [];
  if (x.coins) parts.push(t('yard.prize.coins', { n: x.coins }));
  if (x.tokens) parts.push(`+${x.tokens} ✦`);
  if (x.keys) parts.push(x.keys > 1 ? t('yard.prize.keys', { n: x.keys }) : t('yard.prize.key'));
  if (x.parcel) parts.push(t('yard.prize.parcel'));
  return parts.join(' · ');
}

/** Приз события — одной строкой для тоста. */
export function prizeSay(x: YardPrize): string {
  const name = eventName(x.id);
  const item = x.item ? ` · ${rewardLabel({ kind: 'item', id: x.item.id, amount: x.item.n })}` : '';
  return `${name}: ${prizeLine(x)}${item}`;
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
  const t = useT();
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
    <GxSheet title={t('yard.trader.title')} className="gx-camp" onClose={onClose}>
      <div className="stack">
        <div className="ybaryga">
          <img src={barygaTexture()} alt="" />
          <span>
            <b>{t('yard.trader.motto')}</b>
            <i>
              <GxIcon name="hourglass" size={14} />{' '}
              {h ? t('yard.trader.nextHm', { h, m }) : t('yard.trader.nextM', { m })}
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
                <i>{left > 0 ? t('yard.trader.left', { n: left }) : t('yard.trader.gone')}</i>
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
                      ? t('yard.trader.shattered', { n: got.shattered })
                      : t('yard.trader.took', { what: rewardLabel(lot.reward) }),
                  );
                }}
              >
                {left > 0 ? (
                  <>
                    {lot.hot && <s className="ylot__was">{fmtShort(lot.was)}</s>}
                    {fmtShort(lot.price)} <CoinIcon size={12} />
                  </>
                ) : (
                  t('yard.trader.none')
                )}
              </button>
            </div>
          );
        })}
        {note && <p className="ybaryga__note">{note}</p>}
        <p className="pcamp-note">{t('yard.trader.note')}</p>
      </div>
    </GxSheet>
  );
}

export { liveEvent };
