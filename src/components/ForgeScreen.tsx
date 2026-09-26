// Кузница (v2.67) — отдельный экран, а не вкладка лагеря. Образец —
// кузнечный стол Майнкрафта и кузнец Клинт из Stardew Valley: кирка на
// пьедестале, рецепт картинками (кирка + руда + монеты → новая), одна
// кнопка. Никаких «заказов»: руда для следующей кирки сама откладывается в
// ящик кузнеца, когда продаёшь рюкзак, и копится там.
//
// Выковка — сцена, как открытие в Genshin: три удара молота, цвет искр на
// третьем заранее говорит редкость, вспышка, силуэт, и кирка проявляется.
// Для обычной — коротко, для легендарной — с паузой и фанфарой.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GxIcon, KIcon } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { BagIcon, OreIcon, TokenIcon } from '@/components/PrisonCamp';
import { PickArt, pickSrc, RarityChip, RarityName, rarityVars } from '@/components/PickArt';
import { useFinanceStore } from '@/store';
import {
  AUTOSELL_TOKENS,
  BAG_MAX,
  bagCapacity,
  bagCost,
  forgeCheck,
  forgeOres,
  modsOf,
  nextPick,
  opensRocks,
  pickLevelOf,
  pickSpeed,
  PICKS,
  rankLetter,
  ROCKS,
  shortMoney,
} from '@/lib/prison';
import { rarityOf } from '@/lib/rarity';
import { registerEscape } from '@/lib/escape-stack';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import {
  coinDing,
  forgeReveal,
  forgeStrike,
  primeAudio,
  uiBuy,
  uiClose,
  uiOpen,
  uiTap,
} from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Руды списком: «гранат и топаз». */
function oreList(rocks: number[]): string {
  const names = rocks.map((r) => ROCKS[r].name.toLowerCase());
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

export function ForgeScreen({
  onClose,
  onSpend,
}: {
  onClose: () => void;
  /** Монеты ушли — табло встаёт на новое значение. */
  onSpend?: () => void;
}) {
  const p = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const prisonForge = useFinanceStore((s) => s.prisonForge);
  const prisonBuy = useFinanceStore((s) => s.prisonBuy);
  const prisonEquip = useFinanceStore((s) => s.prisonEquip);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const noteSeq = useRef(0);
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
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

  const say = (text: string) => {
    noteSeq.current += 1;
    setNote({ id: noteSeq.current, text });
  };

  const m = modsOf(p);
  const floor = p.mine.id;
  const cur = PICKS[p.pick];
  const lvl = pickLevelOf(p.pickXp);
  const speed = pickSpeed(floor, p.pick, m);
  const check = forgeCheck(p);
  const n = check?.pick ?? -1;
  const next = n >= 0 ? PICKS[n] : null;
  const ores = n >= 0 ? forgeOres(n, p.forgeBox, p.bag) : [];
  const nextSpeed = n >= 0 ? pickSpeed(floor, n, m) : 0;
  const opens = n >= 0 ? opensRocks(n) : [];
  const coins = check?.coins ?? 0;
  const ready = !!check && check.open && check.ore && balance >= coins;
  // Лучше этой кирки сейчас нет: либо конец лестницы, либо следующая — за
  // престижем, которого ещё нет.
  const lockedByPrestige = n < 0 && PICKS[p.pickMax + 1] ? PICKS[p.pickMax + 1] : null;

  const forge = () => {
    primeAudio();
    if (!check) return;
    if (!check.open) {
      notifyWarning();
      say(
        next?.prestige
          ? `Откроется после ${next.prestige}-го престижа`
          : `Куётся на этаже ${rankLetter(next!.floor)}: там лежит ${ROCKS[next!.floor].name.toLowerCase()}`,
      );
      return;
    }
    if (!check.ore) {
      notifyWarning();
      const [rock, k] = check.missing[0];
      say(`Не хватает: ${ROCKS[rock].name.toLowerCase()} ×${fmt(k)}`);
      return;
    }
    if (balance < coins) {
      notifyWarning();
      say(`Не хватает ${fmt(coins - balance)} монет`);
      return;
    }
    const got = prisonForge();
    if (got < 0) {
      notifyWarning();
      return;
    }
    uiBuy();
    onSpend?.();
    setReveal(got);
  };

  const oreTap = (rock: number, need: number, box: number, bag: number) => {
    tapLight();
    const left = Math.max(0, need - box - bag);
    say(
      left
        ? `${ROCKS[rock].name}: в ящике ${fmt(box)}, в рюкзаке ${fmt(bag)}, ещё ${fmt(left)}. Продай рюкзак — нужная руда ляжет в ящик сама`
        : `${ROCKS[rock].name}: есть всё — в ящике ${fmt(box)}, в рюкзаке ${fmt(bag)}`,
    );
  };

  const buy = (what: 'bag' | 'cart') => {
    primeAudio();
    if (!prisonBuy(what)) {
      notifyWarning();
      return;
    }
    uiBuy();
    coinDing();
    notifySuccess();
    onSpend?.();
  };

  // Любую выкованную кирку можно взять в руку снова (v2.69): тап по ней на
  // лестнице. Лучшая при этом никуда не девается — от неё кузница и ранг.
  const ladderTap = (i: number) => {
    const d = PICKS[i];
    const r = rarityOf(d.rarity).name.toLowerCase();
    if (i === p.pick) {
      tapLight();
      say(`${d.name} кирка в руке · ${r} · ⛏${d.power}`);
      return;
    }
    if (i <= p.pickMax) {
      primeAudio();
      if (!prisonEquip(i)) return;
      tapMedium();
      uiTap();
      say(`В руке: ${d.name.toLowerCase()} кирка · ⛏${d.power}`);
      return;
    }
    tapLight();
    say(
      d.prestige
        ? `${d.name} · ${r} · после ${d.prestige}-го престижа, из руды особой шахты`
        : `${d.name} · ${r} · ⛏${d.power}: куётся на этаже ${rankLetter(d.floor)}, открывает ${oreList(opensRocks(i))}`,
    );
  };

  let cta: string;
  if (!check) cta = '';
  else if (!check.open)
    cta = next?.prestige
      ? `После ${next.prestige}-го престижа`
      : `Откроется на этаже ${rankLetter(next!.floor)}`;
  else if (!check.ore) cta = 'Не хватает руды';
  else if (balance < coins) cta = `Не хватает ${shortMoney(coins - balance)}`;
  else cta = 'Выковать';

  return createPortal(
    <div className="gx fg" role="dialog" aria-label="Кузница">
      <div className="fg__glow" aria-hidden="true" />
      <div className="fg__wrap">
        <div className="fg__top">
          <button
            type="button"
            className="gx-round gx-round--dark fg__back"
            aria-label="Назад"
            onClick={() => {
              tapLight();
              onClose();
            }}
          >
            <KIcon name="arrowLeft" />
          </button>
          <div className="gx-ribbon fg__title">Кузница</div>
          <span className="gx-chip fg__coins">
            <CoinIcon size={16} /> {shortMoney(balance)}
          </span>
        </div>

        {/* Пьедестал: кирка в руке, крупно и в цвете своей редкости. */}
        <div className={`fg-hero r${cur.rarity}`} style={rarityVars(cur.rarity)}>
          <div className="fg-hero__stand">
            <PickArt pick={p.pick} size={164} />
            <i className="fg-hero__plinth" aria-hidden="true" />
          </div>
          <RarityName rarity={cur.rarity}>{cur.name} кирка</RarityName>
          <RarityChip rarity={cur.rarity} />
          <div className="fg-stats">
            <span className="fg-stat">
              <b>⛏ {cur.power}</b>
              <i>Сила</i>
            </span>
            <span className="fg-stat">
              <b>{fmt(speed)}</b>
              <i>блоков/мин</i>
            </span>
            <span className="fg-stat">
              <b>{lvl.level}</b>
              <i>уровень</i>
            </span>
          </div>
        </div>

        {next && (
          <div className="gx-panel gx-panel--wood fg-recipe">
            <div className="fg-recipe__head">
              <span>Следующая</span>
              <RarityName rarity={next.rarity}>{next.name} кирка</RarityName>
            </div>
            <div className="fg-recipe__row">
              <span className="fg-slot" title={PICKS[p.pickMax].name}>
                <PickArt pick={p.pickMax} size={40} fx={false} />
              </span>
              <i className="fg-recipe__plus">+</i>
              {ores.map((o) => {
                const have = o.box + o.bag;
                const ok = have >= o.need;
                return (
                  <button
                    key={o.rock}
                    type="button"
                    className={`fg-slot fg-slot--ore${ok ? ' is-ok' : ''}`}
                    onClick={() => oreTap(o.rock, o.need, o.box, o.bag)}
                    aria-label={`${ROCKS[o.rock].name}: ${have} из ${o.need}`}
                  >
                    <OreIcon rock={o.rock} size={36} />
                    <span className="fg-slot__bar">
                      <i className="is-box" style={{ transform: `scaleX(${o.box / o.need})` }} />
                      <i
                        className="is-bag"
                        style={
                          {
                            transform: `scaleX(${o.bag / o.need})`,
                            '--x': `${(o.box / o.need) * 100}%`,
                          } as CSSProperties
                        }
                      />
                    </span>
                    <b>
                      {ok ? <KIcon name="checkmark" size={11} /> : null}
                      {shortMoney(have)}/{shortMoney(o.need)}
                    </b>
                  </button>
                );
              })}
              <i className="fg-recipe__arrow">
                <KIcon name="arrowRight" size={18} />
              </i>
              <span
                className={`fg-slot fg-slot--out r${next.rarity}`}
                style={rarityVars(next.rarity)}
              >
                <PickArt pick={n} size={48} fx={false} dim={!ready} />
              </span>
            </div>
            <div className="fg-gain">
              <span>
                <GxIcon name="pick" size={16} /> Сила ⛏ {cur.power} → <b>{next.power}</b>
                {opens.length > 0 && (
                  <em>
                    {' '}
                    · берёт {oreList(opens)}
                    {opens.map((r) => (
                      <OreIcon key={r} rock={r} size={16} />
                    ))}
                  </em>
                )}
              </span>
              <span>
                <GxIcon name="energy" size={16} /> {fmt(speed)} → <b>{fmt(nextSpeed)}</b> блоков/мин
              </span>
            </div>
            <button
              type="button"
              className={`gx-btn gx-btn--block gx-btn--big fg-go${ready ? ' gx-btn--red is-ready' : ''}`}
              onClick={forge}
              aria-disabled={!ready}
            >
              {ready ? (
                <GxIcon name="anvil" />
              ) : !check?.open ? (
                <KIcon name="locked" size={18} />
              ) : null}
              {cta}
              {ready &&
                (coins > 0 ? (
                  <small>
                    · {shortMoney(coins)} <CoinIcon size={13} />
                  </small>
                ) : (
                  <small>· оплачено</small>
                ))}
            </button>
          </div>
        )}
        {!next && (
          <div className="gx-panel gx-panel--wood fg-recipe fg-recipe--top">
            <GxIcon name="laurels" size={28} />
            <span>
              {lockedByPrestige
                ? `Лучшая кирка до престижа. ${lockedByPrestige.name} — после ${lockedByPrestige.prestige}-го`
                : 'Лучше этой кирки нет'}
            </span>
          </div>
        )}

        {/* Лестница: вся коллекция кирок, пройденные — в цвете, дальние —
            силуэтами. Видно, куда идёшь. */}
        <div className="fg-ladder" role="list">
          {PICKS.map((d, i) => (
            <button
              key={d.id}
              type="button"
              role="listitem"
              className={`fg-rung r${d.rarity}${i <= p.pickMax ? ' is-have' : ''}${i === p.pick ? ' is-cur' : ''}${i === n ? ' is-next' : ''}`}
              style={rarityVars(d.rarity)}
              onClick={() => ladderTap(i)}
              aria-label={
                i === p.pick
                  ? `${d.name}, в руке`
                  : i <= p.pickMax
                    ? `${d.name}, взять в руку`
                    : d.name
              }
              aria-pressed={i <= p.pickMax ? i === p.pick : undefined}
            >
              <img src={pickSrc(i)} alt="" draggable={false} />
              <b>{d.prestige ? `П${d.prestige}` : `⛏${d.power}`}</b>
              {i === p.pick && <i className="fg-rung__hand">в руке</i>}
            </button>
          ))}
        </div>

        <div className="gx-panel fg-gear">
          <div className="fg-gear__row">
            <BagIcon size={30} />
            <span className="fg-gear__info">
              <b>Рюкзак {fmt(bagCapacity(p.bagLevel))}</b>
              {p.bagLevel < BAG_MAX && (
                <i>
                  {fmt(bagCapacity(p.bagLevel))} → {fmt(bagCapacity(p.bagLevel + 1))}
                </i>
              )}
            </span>
            {p.bagLevel < BAG_MAX ? (
              <button
                type="button"
                className="gx-btn gx-btn--sm gx-btn--red"
                disabled={balance < bagCost(p.bagLevel)}
                onClick={() => buy('bag')}
              >
                {shortMoney(bagCost(p.bagLevel))} <CoinIcon size={12} />
              </button>
            ) : (
              <KIcon name="checkmark" size={20} />
            )}
          </div>
          <div className="fg-gear__row">
            <GxIcon name="minecart" size={30} />
            <span className="fg-gear__info">
              <b>Вагонетка</b>
              <i>{p.cart ? 'продаёт полный рюкзак сама' : 'сама продаёт полный рюкзак'}</i>
            </span>
            {p.cart ? (
              <KIcon name="checkmark" size={20} />
            ) : (
              <button
                type="button"
                className="gx-btn gx-btn--sm gx-btn--red"
                disabled={p.tokens < AUTOSELL_TOKENS}
                onClick={() => buy('cart')}
              >
                {shortMoney(AUTOSELL_TOKENS)} <TokenIcon size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
      {note && (
        <div className="fg__note" key={note.id}>
          {note.text}
        </div>
      )}
      {reveal != null && <ForgeReveal pick={reveal} onDone={() => setReveal(null)} />}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Сцена выковки.
// ---------------------------------------------------------------------------

type Phase = 'strike' | 'flash' | 'shape' | 'reveal';

/** Сколько длится «силуэт»: чем реже кирка, тем дольше пауза — это вопрос. */
const SHAPE_MS = [300, 360, 460, 560, 820, 920, 1100];

function ForgeReveal({ pick, onDone }: { pick: number; onDone: () => void }) {
  const d = PICKS[pick];
  const r = rarityOf(d.rarity);
  const [phase, setPhase] = useState<Phase>(() => (reduceMotion() ? 'reveal' : 'strike'));
  const stage = useRef<HTMLDivElement>(null);
  const hammer = useRef<HTMLSpanElement>(null);
  const sparks = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const p = useFinanceStore((s) => s.prison);
  const m = modsOf(p);
  const opens = opensRocks(pick);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const off = registerEscape(() => doneRef.current());
    return off;
  }, []);

  const finish = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('reveal');
  };

  useEffect(() => {
    if (reduceMotion()) {
      forgeReveal(d.rarity);
      notifySuccess();
      return undefined;
    }
    const slow = d.rarity >= 4;
    const step = slow ? 460 : 380;
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    for (let i = 0; i < 3; i++) {
      at(i * step, () => swing(i));
      at(i * step + step * 0.62, () => strike(i));
    }
    const tFlash = 3 * step + 60;
    at(tFlash, () => {
      setPhase('flash');
      flashFrame(d.rarity >= 4 ? 'mega' : 'big');
    });
    at(tFlash + 140, () => setPhase('shape'));
    at(tFlash + 140 + SHAPE_MS[d.rarity], () => {
      setPhase('reveal');
      forgeReveal(d.rarity);
      notifySuccess();
      if (d.rarity >= 3) burstConfetti(40 + 20 * d.rarity, [r.color, r.light, '#ffffff']);
    });
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Сцена играет один раз на выковку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Молот замахивается и падает на наковальню. */
  const swing = (i: number) => {
    const el = hammer.current;
    if (!el) return;
    try {
      el.animate(
        [
          { transform: 'rotate(-10deg)' },
          { transform: 'rotate(-62deg)', offset: 0.45 },
          { transform: 'rotate(14deg)', offset: 0.62 },
          { transform: 'rotate(4deg)' },
        ],
        { duration: d.rarity >= 4 ? 460 : 380, easing: 'ease-in' },
      );
    } catch {
      /* не страшно */
    }
    void i;
  };

  /** Удар: звон, дрожь, искры. Третий удар — искры цвета редкости. */
  const strike = (i: number) => {
    forgeStrike(i);
    tapMedium();
    const st = stage.current;
    if (st) {
      try {
        st.animate(
          [
            { transform: 'translate(0,0)' },
            { transform: `translate(${i % 2 ? 3 : -3}px, 4px)` },
            { transform: 'translate(0,0)' },
          ],
          { duration: 140, easing: 'ease-out' },
        );
      } catch {
        /* не страшно */
      }
    }
    const last = i === 2;
    spray(
      last ? [r.color, r.light, '#ffffff', r.color] : ['#fff3b0', '#ffb04a', '#ff7a1a'],
      last ? 26 + 4 * d.rarity : 12,
      last ? 1.5 : 1,
    );
  };

  /** Искры из точки удара: DOM-точки на трансформе и прозрачности. */
  const spray = (colors: string[], count: number, power: number) => {
    const host = sparks.current;
    if (!host) return;
    for (let k = 0; k < count; k++) {
      const s = document.createElement('i');
      s.style.background = colors[k % colors.length];
      s.style.color = colors[k % colors.length];
      host.appendChild(s);
      const a = -Math.PI * (0.08 + 0.84 * Math.random());
      const dist = (40 + Math.random() * 90) * power;
      const dx = Math.cos(a) * dist;
      const dy = Math.sin(a) * dist;
      const ms = 380 + Math.random() * 320;
      try {
        const anim = s.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            {
              transform: `translate(${dx}px, ${dy + 30 * power}px) scale(0.2)`,
              opacity: 0,
            },
          ],
          { duration: ms, easing: 'cubic-bezier(.2,.6,.4,1)' },
        );
        anim.onfinish = () => s.remove();
      } catch {
        s.remove();
      }
    }
  };

  const shown = phase === 'reveal';
  return (
    <div
      className={`fgr is-${phase} r${d.rarity}`}
      style={rarityVars(d.rarity)}
      onClick={() => {
        if (!shown) finish();
        else {
          tapLight();
          onDone();
        }
      }}
    >
      <div className="fgr__stage" ref={stage}>
        <i className="fgr__burst" aria-hidden="true" />
        {(phase === 'strike' || phase === 'flash') && (
          <div className="fgr__anvil">
            <span className="fgr__hammer" ref={hammer}>
              <GxIcon name="hammer" size={78} />
            </span>
            <GxIcon name="anvil" size={128} />
            <div className="fgr__sparks" ref={sparks} />
          </div>
        )}
        {phase === 'shape' && (
          <div className="fgr__pick">
            <PickArt pick={pick} size={168} dim />
          </div>
        )}
        {shown && (
          <div className="fgr__pick is-shown">
            <PickArt pick={pick} size={168} />
          </div>
        )}
      </div>
      {shown && (
        <div className="fgr__text">
          <RarityChip rarity={d.rarity} />
          <RarityName rarity={d.rarity}>{d.name} кирка</RarityName>
          <span className="fgr__stats">
            ⛏ {d.power} · {fmt(pickSpeed(p.mine.id, pick, m))} блоков/мин
          </span>
          {opens.length > 0 && (
            <span className="fgr__opens">
              Берёт {oreList(opens)}
              {opens.map((x) => (
                <OreIcon key={x} rock={x} size={18} />
              ))}
            </span>
          )}
          <span className="fgr__cta">В шахту</span>
        </div>
      )}
    </div>
  );
}

/** Можно ли выковать прямо сейчас — для «!» на кнопке кузницы. */
export function forgeReadyNow(p: Parameters<typeof forgeCheck>[0], balance: number): boolean {
  const c = forgeCheck(p);
  return !!c && c.open && c.ore && balance >= c.coins;
}

/** Есть ли вообще следующая кирка (без престижа, которого нет). */
export const hasNextPick = (p: { pickMax: number; prestige: number }) => nextPick(p) >= 0;
