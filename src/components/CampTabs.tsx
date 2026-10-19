// Camp tabs on the pixel kit (wave 3 — T): «Лавка», «Руны», «Коллекция», «Достижения», «Навыки».
// Moved out of `PrisonCamp.tsx`; behaviour is the old one (same store actions, prices, sounds),
// the look and layout are the kit's (`.claude/rules/game-ui.md` → «Camp tabs on the kit»).
//
// Every tab has four arrangements by the shell's format (like the Nursery): `one` phone
// portrait (one column, actions at the bottom — the thumb zone), `land` phone landscape and
// `wide` tablet landscape / desktop (two columns), `tall` tablet portrait. Nothing jumps:
// inspect panels and rows have fixed heights, selection only moves a ring.

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { GxIcon } from '@/components/gx';
import type { GxIconName } from '@/components/gx';
import { useFormFactor } from '@/game-shell';
import { getInputDevice, useAction } from '@/input';
import { Bar, Button, Grid, Icon, KeyHint, Panel, Slot } from '@/ui-px';
import { useFinanceStore } from '@/store';
import type { ParcelOpen } from '@/store';
import { CREW_ON } from '@/lib/features';
import {
  BONUS_CAP,
  bonusOf,
  FINDS,
  findsFound,
  findsMult,
  fusePlan,
  ITEMS,
  itemPrice,
  LAST_RANK,
  MILES,
  mileReady,
  modsOf,
  NO_BONUS,
  PERKS,
  perkPointsFree,
  rankLetter,
  RUNE_BAG,
  RUNE_ROMAN,
  RUNE_SHATTER,
  runePower,
  SOCKET_UNLOCK,
  socketsOpen,
} from '@/lib/prison';
import type { Bonus, ItemId, PerkId, Rune } from '@/lib/prison';
import { findTexture } from '@/lib/prison-art';
import { burstConfetti } from '@/lib/confetti';
import { coinDing, keyFound, primeAudio, tierBreak, uiBuy } from '@/lib/sound';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import {
  chestName,
  fmtDec,
  fmtNum,
  fmtShort,
  itemName,
  itemText,
  perkName,
  perkText,
  runeName,
  runeText,
  t,
  useT,
} from '@/i18n';
import { eggName } from '@/i18n/data-books';
import { findName, findText, mileText, mileTitle, nameIn } from '@/i18n/data-mine';
import { EggArt } from '@/components/PetArt';
import { useArmGuard } from '@/components/armory';
import {
  ItemIcon,
  KeyIcon,
  ParcelReveal,
  RUNE_COLORS,
  RuneIcon,
  runeLine,
  TokenIcon,
} from '@/components/camp-art';
import './camp-tabs.css';

// ---- Shared ------------------------------------------------------------------------------------

type Lay = 'one' | 'land' | 'tall' | 'wide';

function useLay() {
  const { ff, landscape, scale, dpr, h } = useFormFactor();
  const lay: Lay =
    ff === 'phone-portrait'
      ? 'one'
      : ff === 'phone-landscape'
        ? 'land'
        : ff === 'tablet' && !landscape
          ? 'tall'
          : 'wide';
  // A short phone (320×568, an iPhone SE in Telegram): the body is ~146×213 art px, about the
  // tablet-portrait body — the tabs that fill the height take a compact variant there.
  const short = lay === 'one' && h / scale < 350;
  return { lay, scale, dpr, short };
}

/** Keyboard / gamepad: focus is the selection (as in the Nursery grid). */
const kbd = () => {
  const d = getInputDevice();
  return d === 'keyboard' || d === 'gamepad';
};

/**
 * Pixel art of `base` texels shown at a whole number of DEVICE pixels per texel, about `u` art
 * pixels big (runes are 40 texels, finds 16): never blurry, never uneven.
 */
function fit(base: number, u: number, scale: number, dpr: number): number {
  const m = Math.max(1, Math.round((u * scale * dpr) / base));
  return (base * m) / dpr;
}
/** The biggest whole multiple of the art's pixel grid that is ≤ `max` CSS pixels. */
function fitDown(base: number, max: number, dpr: number): number {
  return (base * Math.max(1, Math.floor((max * dpr) / base))) / dpr;
}
/** A slot (in art pixels) around art of `px` CSS pixels: the frame and a margin. */
const slotFor = (px: number, scale: number, pad: number) => Math.ceil(px / scale) + pad;
const slotVar = (n: number) => ({ '--slot': `calc(${n} * var(--u))` }) as CSSProperties;

/**
 * The showcase area of an inspect panel (the height left after the grid / tree, R66): its size in
 * CSS px, measured (it is `flex: 1 1 0`, so the art inside never feeds back into it).
 */
function useShowBox(on: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  return [ref, box] as const;
}

/** Block title: what it is + what to do (owner: every block obvious to a new player). */
function Head({ title, hint, right }: { title: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ctab-head">
      <div className="ctab-head__txt">
        <div className="px-h ctab-head__title">{title}</div>
        {hint != null && <div className="ctab-head__hint">{hint}</div>}
      </div>
      {right}
    </div>
  );
}

/**
 * A number that counts to its new value (≈ 400 ms, 12 steps; at once with reduced motion) — a buy
 * or a shatter is seen, not a jump (critic5 «Лавка 5»).
 */
function useCountTo(n: number): number {
  const [shown, setShown] = useState(n);
  const from = useRef(n);
  useEffect(() => {
    const a = from.current;
    if (a === n || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = n;
      setShown(n);
      return undefined;
    }
    const t0 = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const k = Math.min(1, Math.ceil(((now - t0) / 400) * 12) / 12);
      const v = Math.round(a + (n - a) * k);
      from.current = v;
      setShown(v);
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [n]);
  return shown;
}

/** Tokens: always in the head's right corner. */
function Purse({ n }: { n: number }) {
  const v = useCountTo(n);
  // As wide as the longest value it has shown while the tab is open: a count across a digit
  // (10 010 → 9 980) never narrows the plate mid-count or after it (critic17 #4 — the final
  // value's width moved its left edge 14 px when the digit went).
  const ch = useRef(0);
  ch.current = Math.max(ch.current, fmtNum(n).length, fmtNum(v).length);
  return (
    <span
      className="px-dark ctab-purse"
      role="status"
      aria-label={t('camp.purseTokens', { n, v: fmtNum(n) })}
    >
      <TokenIcon size={18} />
      <span className="px-num" style={{ minWidth: `${ch.current}ch` }}>
        {fmtNum(v)}
      </span>
    </span>
  );
}

const pctText = (x: number) => `+${fmtDec(Math.round(x * 1000) / 10, 1)}%`;

// ---- Лавка: расходники за токены ---------------------------------------------------------------

/** How many one tap buys. Remembered until the app closes. */
const SHOP_PACKS = [1, 5, 10] as const;
let shopPack: number = 1;

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const ShopTab = memo(function ShopTab() {
  const t = useT();
  const { lay, short } = useLay();
  // phones: an effect chip instead of the sentence (the sentence is its tip)
  const phone = lay === 'one' || lay === 'land';
  const p = useFinanceStore((s) => s.prison);
  const prisonBuyItem = useFinanceStore((s) => s.prisonBuyItem);
  const [pack, setPack] = useState(shopPack);
  const [pop, setPop] = useState<{ id: ItemId; text: string; bad: boolean; k: number } | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const pick = (n: number) => {
    shopPack = n;
    setPack(n);
    tapLight();
  };
  // X / pad Y: the next amount (×1 → ×5 → ×10).
  useAction(
    ['inspect'],
    () => {
      const i = SHOP_PACKS.findIndex((n) => n === pack);
      pick(SHOP_PACKS[(i + 1) % SHOP_PACKS.length]);
    },
    { scope: root },
  );
  useEffect(() => {
    if (!pop) return undefined;
    const id = window.setTimeout(() => setPop(null), 1100);
    return () => window.clearTimeout(id);
  }, [pop]);

  const buy = (id: ItemId, cost: number) => {
    if (p.tokens < cost) {
      // The old button was greyed out; now the tap says how much is missing.
      notifyWarning();
      setPop({
        id,
        text: t('ctabs.shop.short', { v: fmtNum(cost - p.tokens) }),
        bad: true,
        k: Date.now(),
      });
      return;
    }
    uiBuy();
    primeAudio();
    if (!prisonBuyItem(id, pack)) {
      notifyWarning();
      return;
    }
    coinDing();
    tapLight();
    setPop({ id, text: `+${pack}`, bad: false, k: Date.now() });
  };

  const packs = (
    <div className="ctab-pack" role="group" aria-label={t('camp.shop.pack')}>
      <span className="ctab-pack__label">{t('camp.shop.pack')}</span>
      <span className="ctab-pack__row">
        {SHOP_PACKS.map((n) => (
          <Button
            key={n}
            size={lay === 'one' ? 'md' : 'sm'}
            on={pack === n}
            className="ctab-pack__opt"
            onClick={() => pick(n)}
          >
            <span className="px-num">×{n}</span>
          </Button>
        ))}
        <KeyHint action="inspect" />
      </span>
    </div>
  );

  return (
    <div ref={root} className={`px ctab ctab-shop ctab--${lay}${short ? ' ctab--short' : ''}`}>
      <Head
        title={t('ctabs.shop.title')}
        hint={lay === 'land' ? undefined : t('ctabs.shop.hint')}
      />
      <Purse n={p.tokens} />
      {packs}
      <div className="ctab-scroll ctab-goods">
        {ITEMS.filter((it) => itemPrice(it.id, p.rank, p.prestige) > 0).map((it) => {
          const cost = itemPrice(it.id, p.rank, p.prestige) * pack;
          const can = p.tokens >= cost;
          const have = p.items[it.id] ?? 0;
          return (
            <div key={it.id} className="ctab-good">
              <span className="px-slot px-slot--r0 ctab-good__art" aria-hidden="true">
                <span className="px-slot__art">
                  <ItemIcon id={it.id} />
                </span>
                {have > 0 && <span className="px-slot__n">×{have}</span>}
                {/* the amount being bought rides on the art, so nothing covers the price's token */}
                {pack > 1 && <span className="ctab-good__pack">×{pack}</span>}
              </span>
              <span className="ctab-good__info">
                <span className="ctab-good__name">{itemName(it.id)}</span>
                {phone ? (
                  <span className="ctab-good__fx" data-tip={itemText(it.id)}>
                    {t(`ctabs.shop.fx.${it.id}`)}
                  </span>
                ) : (
                  <span className="ctab-good__text">{itemText(it.id)}</span>
                )}
              </span>
              <Button
                kind="primary"
                off={!can}
                className="ctab-good__buy"
                aria-label={`${itemName(it.id)} ×${pack} · ${t('camp.purseTokens', { n: cost, v: fmtNum(cost) })}`}
                onClick={() => buy(it.id, cost)}
              >
                <span className="px-num">{fmtShort(cost)}</span>
                <TokenIcon size={24} />
              </Button>
              {pop?.id === it.id && (
                <span
                  key={pop.k}
                  className={`ctab-pop${pop.bad ? ' is-bad' : ''}`}
                  aria-live="polite"
                >
                  {pop.text}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---- Руны -------------------------------------------------------------------------------------

/** A rune tier as a slot rarity frame: I grey, II blue, III violet, IV gold, V red. */
const TIER_RAR = [0, 2, 3, 4, 5];

const BONUS_KEYS: (keyof Bonus)[] = ['sell', 'dmg', 'rate', 'loot', 'token', 'proc', 'luck'];

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const RunesTab = memo(function RunesTab({ axeLevel }: { axeLevel: number }) {
  const t = useT();
  const { lay, scale, dpr, short } = useLay();
  const p = useFinanceStore((s) => s.prison);
  const socket = useFinanceStore((s) => s.prisonRuneSocket);
  const fuse = useFinanceStore((s) => s.prisonRuneFuse);
  const shatter = useFinanceStore((s) => s.prisonRuneShatter);
  const [sel, setSel] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const bonusBox = useRef<HTMLDivElement>(null);
  const wearGuard = useArmGuard();
  const shGuard = useArmGuard();
  const [shArm, setShArm] = useState(0);
  const [shake, setShake] = useState(-1);
  useEffect(() => {
    if (shake < 0) return undefined;
    const id = setTimeout(() => setShake(-1), 320);
    return () => clearTimeout(id);
  }, [shake]);
  useEffect(() => {
    if (!shArm) return undefined;
    const id = setTimeout(() => {
      setShArm(0);
      setNote(null);
    }, 4000);
    return () => clearTimeout(id);
  }, [shArm]);
  // Bonus words go all together when one of them would be cut: a lone «прода…» reads worse than
  // the stat picture alone (its full text is the chip's tip). Values and the language change the
  // words — checked after every render; the box's width — by a ResizeObserver.
  // The rune's full sentence likewise: when two lines don't hold it (fr «aux chances
  // d'enchantement de la pioche et de la hache» in a 134-px panel), the bonus box's shorter
  // `camp.bonus.*` takes its place; the full one stays the tip.
  const fullRef = useRef<HTMLSpanElement>(null);
  const givesRef = useRef<HTMLSpanElement>(null);
  const fuseRef = useRef<HTMLDivElement>(null);
  const fitBonus = useCallback(() => {
    const el = bonusBox.current;
    if (el) {
      el.classList.remove('is-tight');
      const cut = [...el.querySelectorAll<HTMLElement>('.ctab-bonus__w')].some(
        (w) => w.scrollWidth > w.clientWidth + 1,
      );
      el.classList.toggle('is-tight', cut);
    }
    const full = fullRef.current;
    if (full) {
      full.classList.remove('is-tight', 'is-none');
      const over = () => full.scrollHeight > full.clientHeight + 1;
      // (a short phone gives it one line: when even the short words don't fit, none)
      if (over()) {
        full.classList.add('is-tight');
        if (over()) full.classList.add('is-none');
      }
    }
    // …and the short word itself: en «+4.6% enchants» is 150 px in the short phone's 134 — the
    // number alone then (the sentence under it names the stat).
    const gives = givesRef.current;
    if (gives) {
      gives.classList.remove('is-tight');
      gives.classList.toggle('is-tight', gives.scrollWidth > gives.clientWidth + 1);
    }
    // The fuse plan in pictures: the result's name would be cut (it «Si consumano:» on a phone
    // landscape) — «Uses up:» goes first, then the name (the result's picture still says it).
    const fuse = fuseRef.current;
    if (fuse) {
      fuse.classList.remove('is-tight', 'is-bare');
      const name = fuse.querySelector<HTMLElement>(':scope.is-fuse > b');
      // the text's own box, not scrollWidth: a 1-px overrun («Jera III», 59.3 in 58.1) rounds away
      const cut = () => {
        if (!name) return false;
        const rg = document.createRange();
        rg.selectNodeContents(name);
        return rg.getBoundingClientRect().right > name.getBoundingClientRect().right + 0.5;
      };
      if (cut()) {
        fuse.classList.add('is-tight');
        if (cut()) fuse.classList.add('is-bare');
      }
    }
  }, []);
  useLayoutEffect(fitBonus);
  useEffect(() => {
    const el = bonusBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fitBonus);
    ro.observe(el);
    if (fullRef.current) ro.observe(fullRef.current);
    if (fuseRef.current) ro.observe(fuseRef.current);
    return () => ro.disconnect();
  }, [fitBonus]);
  const open = socketsOpen(p, axeLevel);
  const rune = p.runes.find((r) => r.id === sel) ?? null;
  const worn = rune ? p.sockets.includes(rune.id) : false;
  const plan = rune ? fusePlan(p.runes, p.sockets, rune.id) : null;
  const bag = p.runes
    .slice()
    .sort((a, b) => b.tier - a.tier || runePower(b) - runePower(a) || a.id - b.id);
  const cross = lay === 'wide';
  const quad = lay === 'land' || lay === 'tall';

  const tapSocket = (i: number) => {
    setShArm(0);
    if (i >= open) {
      notifyWarning();
      // the reason is the socket's own caption: it shakes (1u) and the note repeats it
      setShake(i);
      setNote(
        short
          ? t('ctabs.runes.lockedShort', { cond: lockText(i) })
          : `${t('camp.runes.slotLocked')} · ${lockText(i)}`,
      );
      return;
    }
    selectionChanged();
    const cur = p.sockets[i];
    // A rune from the pouch is picked — it goes here (instead of the one that was).
    if (rune && !worn) {
      socket(i, rune.id);
      tierBreak(0);
      setNote(null);
      return;
    }
    setNote(null);
    setSel(cur || null);
  };

  const wear = () => {
    if (!rune) return;
    // a double tap is not «in, then out again» (R22)
    if (wearGuard.tooSoon()) return;
    wearGuard.mark();
    primeAudio();
    if (worn) {
      socket(p.sockets.indexOf(rune.id), 0);
      tapLight();
      return;
    }
    const empty = p.sockets.findIndex((id, i) => i < open && !id);
    if (empty < 0) {
      notifyWarning();
      setNote(open ? t('camp.runes.full') : t('camp.runes.firstAt', { lv: SOCKET_UNLOCK[0] }));
      return;
    }
    socket(empty, rune.id);
    tierBreak(0);
    notifySuccess();
  };

  const doFuse = () => {
    if (!rune) return;
    primeAudio();
    const made = fuse(rune.id);
    if (!made) {
      notifyWarning();
      return;
    }
    tierBreak(Math.min(3, made.tier - 1));
    notifySuccess();
    burstConfetti(30 + made.tier * 12, [RUNE_COLORS[made.tier - 1], '#fff']);
    setSel(made.id);
  };

  const doShatter = () => {
    if (!rune) return;
    if (worn) {
      notifyWarning();
      setNote(t('ctabs.runes.wornNoShatter'));
      return;
    }
    // Tier III and up is worth something: the first tap arms, a second ≥ ARM_GUARD_MS later breaks.
    if (rune.tier >= 3 && shArm !== rune.id) {
      tapLight();
      shGuard.mark();
      setShArm(rune.id);
      setNote(t('ctabs.runes.shatterArm'));
      return;
    }
    if (rune.tier >= 3 && shGuard.tooSoon()) return;
    setShArm(0);
    setNote(null);
    primeAudio();
    const got = shatter(rune.id);
    if (!got) return;
    coinDing();
    tapLight();
    setSel(null);
  };

  // X / pad Y: into the amulet / out of it.
  useAction(
    ['inspect'],
    () => {
      if (!rune) return false;
      wear();
    },
    { scope: root },
  );

  const pickRune = (id: number, focus = false) => {
    if (focus && id === sel) return;
    setShArm(0);
    selectionChanged();
    setNote(null);
    setSel(sel === id && !focus && !kbd() ? null : id);
  };

  const lockText = (i: number) =>
    i < SOCKET_UNLOCK.length
      ? t('common.level', { n: SOCKET_UNLOCK[i] })
      : t('camp.runes.prestige10');

  // Sizes: runes are 40-texel pictures — whole device pixels per texel.
  const bagPx = fit(40, short ? 18 : lay === 'tall' ? 20 : 22, scale, dpr);
  const bagSlot = slotFor(bagPx, scale, 6);
  const sockPx = fit(
    40,
    lay === 'wide' ? 30 : short ? 18 : lay === 'one' ? 26 : lay === 'tall' ? 18 : 22,
    scale,
    dpr,
  );
  const sockSlot = slotFor(sockPx, scale, 6);
  // Wide: the picked rune at least 1.5× the socket's, in whole texels (160 / 120 px at 1180×820 /
  // 1440×900 — it was the socket's own 100 / 80, critic17 #2); elsewhere 30u.
  const inspPx =
    lay === 'wide' ? (40 * Math.ceil((1.5 * sockPx * dpr) / 40)) / dpr : fit(40, 30, scale, dpr);
  const actSize = short || lay === 'tall' || lay === 'land' ? 'sm' : undefined;

  // The amulet's own bonus: the worn runes only (the squad's pets show theirs in the Nursery), so
  // four sockets give at most four kinds and the 2×2 box never scrolls (critic5 P0). Each chip
  // says what the runes REALLY add: the mine caps runes + pets together (`BONUS_CAP`) and all sell
  // bonuses together (`SELL_BONUS_CAP`), so a chip is the full bonus minus the one without the
  // runes; a chip under its rune sum gets a cap mark and the reason in its tip (critic14 (a)).
  const raw: Record<string, number> = {};
  for (const id of p.sockets) {
    const r = id ? p.runes.find((z) => z.id === id) : null;
    if (r) raw[r.kind] = (raw[r.kind] ?? 0) + runePower(r);
  }
  const bonus = BONUS_KEYS.filter((k) => (raw[k] ?? 0) > 0);
  const withR = bonusOf(p);
  const noR = bonusOf({ ...p, sockets: [] });
  const sellK = modsOf(p).sell / modsOf({ ...p, sockets: [] }).sell;
  const b = { ...NO_BONUS };
  for (const k of bonus)
    b[k] = Math.max(0, k === 'sell' ? (sellK - 1) * (1 + noR.sell) : withR[k] - noR[k]);
  const capped = (k: keyof Bonus) => b[k] < (raw[k] ?? 0) - 1e-6;
  const chipTip = (k: keyof Bonus) =>
    capped(k)
      ? withR[k] >= BONUS_CAP[k] - 1e-6
        ? t('ctabs.runes.capTip', {
            cap: pctText(BONUS_CAP[k]),
            raw: pctText(raw[k] ?? 0),
            eff: pctText(b[k]),
          })
        : t('ctabs.runes.capSellTip', { raw: pctText(raw[k] ?? 0), eff: pctText(b[k]) })
      : `${pctText(b[k])} ${t(`camp.bonus.${k}`)}`;
  // Bonus pictures: the kit's 12 × 12 stat art at 24 CSS px (36 at ui-scale ≥ 4), whole device
  // pixels per art pixel (as the Nursery's `useStatPx`).
  const stPx = `${(Math.max(1, Math.round(((scale >= 4 ? 36 : 24) * dpr) / 12)) * 12) / dpr}px`;

  const amulet = (
    <section className="ctab-amulet">
      <Head title={t('ctabs.runes.amulet')} hint={t('ctabs.runes.amuletHint')} />
      <Panel material="stone" stage className="ctab-stage">
        <div
          className={`ctab-socks${cross ? ' is-cross' : quad ? ' is-quad' : ''}`}
          style={slotVar(sockSlot)}
        >
          {cross && (
            <span className="ctab-socks__core" aria-hidden="true">
              <GxIcon name="pick" />
              <GxIcon name="axe" />
            </span>
          )}
          {[0, 1, 2, 3].map((i) => {
            const id = p.sockets[i];
            const r = id ? (p.runes.find((z) => z.id === id) ?? null) : null;
            const locked = i >= open;
            return (
              <div key={i} className={`ctab-sock ctab-sock--${i}${shake === i ? ' is-shake' : ''}`}>
                <Slot
                  rarity={r ? TIER_RAR[r.tier - 1] : 0}
                  selected={!!r && sel === r.id}
                  locked={locked}
                  empty={!r && !locked}
                  count={r ? RUNE_ROMAN[r.tier - 1] : undefined}
                  className={rune && !worn && !locked ? 'is-target' : undefined}
                  aria-label={
                    r
                      ? `${runeName(r.kind)}, ${runeLine(r)}`
                      : locked
                        ? t('camp.runes.slotLocked')
                        : t('camp.runes.slotEmpty')
                  }
                  onClick={() => tapSocket(i)}
                >
                  {r ? (
                    <RuneIcon kind={r.kind} tier={r.tier} size={sockPx} />
                  ) : locked ? null : (
                    <Icon name="plus" />
                  )}
                </Slot>
                {/* A worn rune's % is in the bonus box below and an empty socket has its gold «+»
                    (the name is its aria-label) — no caption; a locked socket says its condition
                    on a cream plate (R53: no text straight on the stone, critic14 #4). */}
                <span className={`ctab-sock__cap${!r && locked ? ' is-lock' : ''}`}>
                  {!r && locked ? lockText(i) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
      {/* phone landscape, tablet portrait: the box sits under the pouch column — it says whose
          bonus it is */}
      {(lay === 'land' || lay === 'tall') && (
        <span className="ctab-bonus__title">{t('ctabs.runes.gives')}</span>
      )}
      <div ref={bonusBox} className="ctab-bonus" style={{ '--st': stPx } as CSSProperties}>
        {bonus.length ? (
          bonus.map((k) => (
            <span
              key={k}
              className={`ctab-chip ctab-bonus__chip${capped(k) ? ' is-cap' : ''}`}
              data-tip={chipTip(k)}
              aria-label={chipTip(k)}
            >
              <i className={`ctab-st ctab-st--${k}`} aria-hidden="true" />
              <b className="px-num">{pctText(b[k])}</b>
              {capped(k) && <Icon name="excl" className="ctab-bonus__cap" />}
              <span className="ctab-bonus__w">{t(`ctabs.bonus.${k}`)}</span>
            </span>
          ))
        ) : (
          <span className="ctab-bonus__none">{t('camp.runes.amuletEmpty')}</span>
        )}
      </div>
    </section>
  );

  const pouch = (
    <section className="ctab-pouch">
      <div className="ctab-sub">
        <span className="ctab-sub__title">{t('ctabs.runes.pouch')}</span>
        <span className="px-num ctab-sub__count">
          {p.runes.length}/{RUNE_BAG}
        </span>
        {/* (an empty pouch has nothing to pick: the line stays, empty) */}
        <span className="ctab-sub__hint">{bag.length ? t('ctabs.runes.pouchHint') : ''}</span>
      </div>
      <div className="ctab-scroll">
        {bag.length ? (
          <Grid className="ctab-grid" style={slotVar(bagSlot)}>
            {bag.map((r) => (
              <Slot
                key={r.id}
                rarity={TIER_RAR[r.tier - 1]}
                selected={sel === r.id}
                count={RUNE_ROMAN[r.tier - 1]}
                corner={p.sockets.includes(r.id) ? <Icon name="check" /> : undefined}
                aria-label={`${runeName(r.kind)} ${RUNE_ROMAN[r.tier - 1]}, ${runeLine(r)}`}
                onFocus={() => kbd() && pickRune(r.id, true)}
                onClick={() => pickRune(r.id)}
              >
                <RuneIcon kind={r.kind} tier={r.tier} size={bagPx} />
              </Slot>
            ))}
          </Grid>
        ) : (
          <p className="ctab-empty">{t('camp.runes.none')}</p>
        )}
      </div>
    </section>
  );

  const fuseLine = rune
    ? plan && short
      ? t('ctabs.runes.fuseGoShort', {
          tier: RUNE_ROMAN[rune.tier - 1],
          rune: `${runeName(rune.kind)} ${RUNE_ROMAN[rune.tier]}`,
        })
      : plan
        ? `${t('camp.runes.fuseGo')} ${plan.with
            .map((r: Rune) => `${runeName(r.kind)} ${pctText(runePower(r))}`)
            .join(', ')} → ${runeName(rune.kind)} ${RUNE_ROMAN[rune.tier]}`
        : rune.tier < RUNE_ROMAN.length
          ? t(short ? 'ctabs.runes.fuseNeedShort' : 'camp.runes.fuseNeed', {
              tier: RUNE_ROMAN[rune.tier - 1],
            })
          : ''
    : '';

  // The fuse plan in pictures: «Уйдут: [rune] [rune] → [rune] Гебо II» (the sentence with the
  // two runes' % is the tip and the aria-label; critic14 «next pass» 6). A short phone keeps words.
  const fusePx = fit(40, lay === 'tall' ? 8 : 12, scale, dpr);
  const fuseArt =
    rune && plan && !short ? (
      <>
        <span>{t('camp.runes.fuseGo')}</span>
        {plan.with.map((r: Rune) => (
          <RuneIcon key={r.id} kind={r.kind} tier={r.tier} size={fusePx} />
        ))}
        <Icon name="right" />
        <RuneIcon kind={rune.kind} tier={rune.tier + 1} size={fusePx} />
        <b>
          {runeName(rune.kind)} {RUNE_ROMAN[rune.tier]}
        </b>
      </>
    ) : null;

  // The panel keeps one height: with nothing picked the same rows are laid out invisibly (a
  // stand-in rune) and the prompt lies over them — picking a rune never moves a box.
  const shown: Rune = rune ?? { id: 0, kind: 'sell', tier: 1, roll: 0 };
  const shownWorn = rune ? worn : false;
  const insp = (
    <Panel material="obsidian" className="ctab-insp" aria-live="polite">
      <div className={`ctab-insp__body${rune ? '' : ' is-ghost'}`} aria-hidden={!rune || undefined}>
        <div className="ctab-insp__top">
          <span className="ctab-insp__art">
            <RuneIcon kind={shown.kind} tier={shown.tier} size={inspPx} />
          </span>
          <span className="ctab-insp__head">
            <span
              className="ctab-insp__name"
              style={{ '--rc': RUNE_COLORS[shown.tier - 1] } as CSSProperties}
            >
              {runeName(shown.kind)} {RUNE_ROMAN[shown.tier - 1]}
            </span>
            {/* The effect in the bonus chips' short word (one line on every format, it was cut
                at 320–390 px: «+4,6% к шансам чар ки…»), the full sentence in two lines under it;
                the roll («сила 90/100») is only the tip (critic14 #1). */}
            <span ref={givesRef} className="ctab-insp__gives">
              {pctText(runePower(shown))}
              <span className="ctab-insp__gw"> {t(`ctabs.bonus.${shown.kind}`)}</span>
            </span>
            <span
              ref={fullRef}
              className="ctab-insp__sub ctab-insp__full"
              data-tip={`${runeLine(shown)} · ${t('ctabs.runes.roll', { n: shown.roll })}`}
            >
              <span className="ctab-insp__full-l">{runeText(shown.kind)}</span>
              <span className="ctab-insp__full-s">{t(`camp.bonus.${shown.kind}`)}</span>
            </span>
          </span>
        </div>
        <div
          ref={fuseRef}
          className={`ctab-insp__line${note ? ' is-note' : fuseArt ? ' is-fuse' : ''}`}
          data-tip={short || (fuseArt && !note) ? (note ?? fuseLine) || undefined : undefined}
          aria-label={fuseArt && !note ? fuseLine : undefined}
        >
          {note ?? fuseArt ?? fuseLine}
        </div>
        <div className="ctab-insp__acts">
          <Button
            kind={shownWorn ? 'secondary' : 'primary'}
            size={actSize}
            hint="inspect"
            onClick={wear}
          >
            {shownWorn ? t('camp.runes.takeOut') : t('camp.runes.wear')}
          </Button>
          <Button size={actSize} off={!plan} onClick={plan ? doFuse : () => notifyWarning()}>
            {t('camp.runes.fuse')}
          </Button>
          <Button
            kind="danger"
            size={actSize}
            off={shownWorn}
            className={shArm && shArm === rune?.id ? 'is-armed' : undefined}
            data-tip={t('ctabs.runes.shatter')}
            aria-label={`${t('ctabs.runes.shatter')}: +${RUNE_SHATTER[shown.tier - 1]}`}
            onClick={doShatter}
          >
            <GxIcon name="hammer" className="ctab-shatter__ico" />
            <span className="px-num">+{fmtNum(RUNE_SHATTER[shown.tier - 1])}</span>
            <TokenIcon size={24} />
          </Button>
        </div>
      </div>
      {!rune && (
        <div className="ctab-insp__empty">
          <Icon name="info" />
          {/* an empty pouch already says «no runes» — the panel says where they come from */}
          <span>
            {note ?? (p.runes.length ? t('ctabs.runes.pick') : t('ctabs.runes.whereFrom'))}
          </span>
        </div>
      )}
    </Panel>
  );

  return (
    <div ref={root} className={`px ctab ctab-runes ctab--${lay}${short ? ' ctab--short' : ''}`}>
      {amulet}
      {pouch}
      {insp}
    </div>
  );
});

// ---- Коллекция находок -----------------------------------------------------------------------

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const FindsTab = memo(function FindsTab() {
  const t = useT();
  const { lay, scale, dpr, short } = useLay();
  const p = useFinanceStore((s) => s.prison);
  const found = findsFound(p.finds);
  // Phone portrait and tablet landscape / desktop: a 4×3 case, all 12 without scrolling — the
  // slots as big as a quarter of the width and a third of the height let (≈ 80 px with 64-px art
  // on a phone, ≈ 120 on a tablet, 52 at 320×568); the other layouts keep auto-fill columns.
  const four = lay === 'one' || lay === 'wide';
  // Phone portrait (not short) and tablet portrait: the case is as tall as its rows and the
  // inspect panel below is a showcase — the find as big as the height left over (144–192 px on a
  // phone; 210–318 px stood empty under the case, critic14 #2 / R66). Tablet landscape / desktop:
  // the side column is a showcase too (a 120-px find over 270 px of blank, critic17 #2) — its
  // case keeps sizing by width AND height.
  const show = (lay === 'one' && !short) || lay === 'tall' || lay === 'wide';
  const byW = show && lay !== 'wide';
  const box = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const grid = el?.firstElementChild;
    if (!four || !el || !grid) return undefined;
    const measure = () => {
      const cs = getComputedStyle(grid);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const rows = Math.ceil(FINDS.length / 4);
      const wCell = (el.clientWidth - padX - 3 * parseFloat(cs.columnGap)) / 4;
      // a showcase case under the panel sizes by its width only (its height follows its rows)
      setCell(
        byW
          ? wCell
          : Math.min(wCell, (el.clientHeight - padY - (rows - 1) * parseFloat(cs.rowGap)) / rows),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [four, byW]);
  const [artRef, artBox] = useShowBox(show);
  const [sel, setSel] = useState(() => FINDS.find((f) => p.finds[f.id])?.id ?? FINDS[0].id);
  const f = FINDS.find((x) => x.id === sel) ?? FINDS[0];
  const n = p.finds[f.id] ?? 0;
  const roomy = lay === 'one' && !short;
  // a 6u margin around the art; a narrow phone (360) gives up the margin (down to 3u), not the 64 px
  const padU = roomy ? 6 : 2;
  let px = fit(16, lay === 'wide' ? 37 : roomy ? 32 : 26, scale, dpr);
  if (four && cell > 0) px = Math.min(px, fitDown(16, cell - (roomy ? 3 : padU) * scale, dpr));
  const slot =
    four && cell > 0
      ? Math.min(slotFor(px, scale, padU), Math.floor(cell / scale))
      : slotFor(px, scale, padU);
  // the selected find big: ≥ 96 px on a phone with room and on a tablet; 48 on a short phone
  // (with 64, es «Moneda antigua» was cut at 320); up to 288 in the wide side column
  const bigPx =
    show && artBox.h > 0
      ? fitDown(16, Math.min(artBox.h, artBox.w, lay === 'wide' ? 288 : 192), dpr)
      : fit(16, lay === 'wide' ? 40 : roomy ? 48 : short ? 24 : 30, scale, dpr);
  const pick = (id: string) => {
    if (id === sel) return;
    selectionChanged();
    setSel(id as typeof sel);
  };
  return (
    <div className={`px ctab ctab-finds ctab--${lay}${short ? ' ctab--short' : ''}`}>
      <Head
        title={t('ctabs.finds.title')}
        hint={t('ctabs.finds.hint', { pct: Math.round((findsMult(p.finds) - 1) * 100) })}
        right={
          <span className="px-dark ctab-count">
            <span className="px-num">
              {found}/{FINDS.length}
            </span>
          </span>
        }
      />
      <div ref={box} className="ctab-scroll ctab-finds__grid">
        <Grid
          className="ctab-grid"
          style={four ? ({ ...slotVar(slot), '--cols': 4 } as CSSProperties) : slotVar(slot)}
        >
          {FINDS.map((x) => {
            const c = p.finds[x.id] ?? 0;
            return (
              <Slot
                key={x.id}
                selected={x.id === sel}
                locked={!c}
                count={c > 1 ? `×${c}` : undefined}
                aria-label={c ? findName(x.id) : t('ctabs.finds.unknown')}
                onFocus={() => kbd() && pick(x.id)}
                onClick={() => pick(x.id)}
              >
                <img
                  className="ctab-find"
                  src={findTexture(x.id, !c)}
                  style={{ width: px, height: px }}
                  alt=""
                  draggable={false}
                />
              </Slot>
            );
          })}
        </Grid>
      </div>
      <Panel
        material="obsidian"
        className={`ctab-insp ctab-insp--find${show ? ' is-show' : ''}`}
        aria-live="polite"
      >
        <div className="ctab-insp__top">
          <span ref={artRef} className="ctab-insp__art">
            <img
              className="ctab-find"
              src={findTexture(f.id, !n)}
              style={{ width: bigPx, height: bigPx }}
              alt=""
              draggable={false}
            />
          </span>
          <span className="ctab-insp__head">
            <span className="ctab-insp__name is-plain">
              {n ? findName(f.id) : t('ctabs.finds.unknown')}
            </span>
            <span className="ctab-insp__gives">
              {n ? findText(f.id) : t('camp.finds.from', { mine: rankLetter(f.from) })}
            </span>
            <span className="ctab-insp__sub">{n ? t('ctabs.finds.copies', { n }) : ' '}</span>
          </span>
        </div>
      </Panel>
    </div>
  );
});

// ---- Достижения -------------------------------------------------------------------------------

const MILE_ICON: Record<string, GxIconName> = {
  b1k: 'pick',
  b10k: 'pick',
  b100k: 'pick',
  b1m: 'pick',
  z: 'crown',
  p1: 'laurels',
  p5: 'laurels',
  p10: 'laurels',
  p20: 'laurels',
  legend: 'flame',
  pets6: 'paw',
  hatch50: 'egg',
  golden: 'medal',
  zoo: 'paw',
  cases: 'chest',
  seid: 'stone',
  bats: 'cave',
  parcels: 'gift',
};

type Gift = { k: string; tip: string; node: ReactNode };

/** At most three reward chips, the rest folded into «+N» (its tip lists them). `compact` (phone /
 * tablet portrait): one line of chips — «+N» takes the third place (the second on a short phone);
 * the parcel and the rune chips keep the icon and the tier only, the full words go to the tip. */
function MileGifts({ m, short }: { m: (typeof MILES)[number]; short: boolean }) {
  const r = m.reward;
  const all: Gift[] = [];
  if (r.tokens)
    all.push({
      k: 'tokens',
      tip: t('camp.purseTokens', { n: r.tokens, v: fmtNum(r.tokens) }),
      node: (
        <>
          <TokenIcon size={16} />
          <b className="px-num">+{fmtNum(r.tokens)}</b>
        </>
      ),
    });
  if (r.keys)
    all.push({
      k: 'keys',
      tip: t('camp.keysN', { n: r.keys }),
      node: (
        <>
          <KeyIcon size={16} />
          <b className="px-num">×{r.keys}</b>
        </>
      ),
    });
  if (r.parcel) {
    const tip = t('camp.mile.parcel', { tier: nameIn(chestName(r.parcel)) });
    all.push({
      k: 'parcel',
      tip,
      node: (
        <>
          <GxIcon name="gift" />
          <span className="ctab-chip__w">{chestName(r.parcel)}</span>
        </>
      ),
    });
  }
  if (r.rune) {
    const roman = RUNE_ROMAN[r.rune - 1];
    const tip = t('camp.mile.rune', { tier: roman });
    all.push({
      k: 'rune',
      tip,
      node: (
        <>
          <GxIcon name="rune" />
          <b className="px-num">{roman}</b>
        </>
      ),
    });
  }
  if (r.socket)
    all.push({
      k: 'socket',
      tip: t('camp.mile.socket'),
      node: (
        <>
          <Icon name="plus" />
          <span className="ctab-chip__w">{t('ctabs.miles.socket')}</span>
        </>
      ),
    });
  if (r.egg)
    all.push({
      k: 'egg',
      tip: nameIn(eggName(r.egg)),
      node: (
        <>
          <EggArt egg={r.egg} size={16} />
          <span className="ctab-chip__w">{t(`nursery.egg.${r.egg}`)}</span>
        </>
      ),
    });
  const limit = short ? 2 : 3;
  const keep = 2;
  const shown = all.length > limit ? all.slice(0, keep) : all;
  const rest = all.slice(shown.length);
  return (
    <span className="ctab-gifts">
      {shown.map((g) => (
        <span key={g.k} className="ctab-chip" data-tip={g.tip}>
          {g.node}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="ctab-chip" data-tip={rest.map((g) => g.tip).join(' · ')}>
          <b className="px-num">+{rest.length}</b>
        </span>
      )}
    </span>
  );
}

/** Rows painted on opening: a 430×932 phone shows 7, a tablet / desktop 2 × 4. */
const MILES_FIRST = 8;

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const MilesTab = memo(function MilesTab({
  onGain,
}: {
  onGain: (from: number, to: number) => void;
}) {
  const t = useT();
  const { lay, short } = useLay();
  // Every format: the compact row «icon | title + chips + bar | claim», the condition is the
  // icon's tip; two columns on phone landscape / wide (2–4 of 18 rows showed there, critic14 #3).
  const p = useFinanceStore((s) => s.prison);
  const claim = useFinanceStore((s) => s.prisonMileClaim);
  const [reveal, setReveal] = useState<ParcelOpen | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const frozen = useRef<string[] | null>(null);
  const takenNow = useRef(new Set<string>());
  const take = (id: string) => {
    primeAudio();
    const before = useFinanceStore.getState().slotsBalance;
    const got = claim(id);
    if (!got) {
      notifyWarning();
      return;
    }
    takenNow.current.add(id);
    const after = useFinanceStore.getState().slotsBalance;
    if (after > before) onGain(before, after);
    coinDing();
    notifySuccess();
    if (got.mile.reward.keys) keyFound();
    if (got.parcel) setReveal(got.parcel);
    else {
      tierBreak(2);
      burstConfetti(50, ['#ffe08a', '#b8f4e6', '#fff']);
    }
  };
  const rows = MILES.map((m) => ({ m, done: p.miles.includes(m.id), ready: mileReady(p, m) }));
  // Ready ones on top, then the ones in progress, the taken ones dimmed at the bottom. The order is
  // fixed while the tab is open: a row taken now stays in place (button → check, its bar kept) and
  // sinks to the taken ones next time — nothing under the finger moves.
  if (!frozen.current)
    frozen.current = [
      ...rows.filter((r) => r.ready),
      ...rows.filter((r) => !r.ready && !r.done),
      ...rows.filter((r) => r.done),
    ].map((r) => r.m.id);
  const byId = new Map(rows.map((r) => [r.m.id, r]));
  const order = frozen.current.flatMap((id) => byId.get(id) ?? []);
  const first = order.find((r) => r.ready)?.m.id;
  // Opening paints the first rows (more than any screen shows; the ready ones are on top), the
  // rest follow a frame later in a transition: the open took 264 ms at 4× CPU with all 18 (R55).
  const [allRows, setAllRows] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => startTransition(() => setAllRows(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  const shownRows = allRows ? order : order.slice(0, MILES_FIRST);
  // Chips keep to their lines (one; a ready row on a tablet / desktop two, beside «Take»): when
  // they would wrap further, their words go — the pictures and numbers stay, the words are the
  // tips (`.is-tight`). Rows off screen skip layout (`content-visibility`), so each chip box is
  // checked when it gets a size.
  const list = useRef<HTMLDivElement>(null);
  const two = lay === 'tall' || lay === 'wide';
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return undefined;
    const fitGifts = (g: Element) => {
      g.classList.remove('is-tight');
      const tops = new Set([...g.children].map((c) => Math.round(c.getBoundingClientRect().top)));
      const max = two && g.closest('.ctab-mile')?.querySelector('.ctab-mile__swap') ? 2 : 1;
      g.classList.toggle('is-tight', tops.size > max);
    };
    const all = [...el.querySelectorAll('.ctab-gifts')];
    all.forEach(fitGifts);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((es) => es.forEach((e) => fitGifts(e.target)));
    all.forEach((g) => ro.observe(g));
    return () => ro.disconnect();
  });
  const done = rows.filter((r) => r.done).length;
  // X / pad Y: take the top ready one.
  useAction(
    ['inspect'],
    () => {
      if (!first) return false;
      take(first);
    },
    { scope: root },
  );
  return (
    <div ref={root} className={`px ctab ctab-miles ctab--${lay}${short ? ' ctab--short' : ''}`}>
      <Head
        title={t('camp.tab.miles')}
        hint={t('ctabs.miles.hint')}
        right={
          <span className="ctab-head__right">
            {/* X takes the top ready one; the hint lives here, not in a button, so taking one
                never resizes the next row's button. */}
            {first && <KeyHint action="inspect" label={t('camp.take')} />}
            <span className="px-dark ctab-count">
              <span className="px-num">
                {done}/{MILES.length}
              </span>
            </span>
          </span>
        }
      />
      <div className="ctab-scroll">
        <div ref={list} className="ctab-miles__list">
          {shownRows.map(({ m, done: isDone, ready }) => {
            const [v, goal] = m.progress(p);
            return (
              <div
                key={m.id}
                className={`ctab-mile${ready ? ' is-ready' : ''}${isDone ? ' is-done' : ''}`}
              >
                <span
                  className={`px-slot px-slot--r${ready ? 4 : 0} ctab-mile__art`}
                  data-tip={mileText(m.id)}
                  aria-hidden="true"
                >
                  <span className="px-slot__art">
                    <GxIcon name={MILE_ICON[m.id] ?? 'trophy'} />
                  </span>
                </span>
                <span className="ctab-mile__info">
                  <span className="ctab-mile__name">{mileTitle(m.id)}</span>
                  <MileGifts m={m} short={short} />
                </span>
                <span className="ctab-mile__end">
                  {ready || takenNow.current.has(m.id) ? (
                    // The button and the check share one cell: taking swaps them, the cell (and
                    // so the row) keeps its width and height.
                    <span className="ctab-mile__swap">
                      <Button
                        kind="primary"
                        size="sm"
                        className={isDone ? 'is-gone' : undefined}
                        onClick={() => take(m.id)}
                      >
                        {t('camp.take')}
                      </Button>
                      <span className={`ctab-mile__taken${isDone ? '' : ' is-gone'}`}>
                        <Icon name="check" />
                        {t('camp.mile.taken')}
                      </span>
                    </span>
                  ) : isDone ? (
                    <span className="ctab-mile__taken">
                      <Icon name="check" />
                      {t('camp.mile.taken')}
                    </span>
                  ) : null}
                </span>
                {(!isDone || takenNow.current.has(m.id)) && (
                  <Bar
                    className="ctab-mile__bar"
                    value={goal ? v / goal : 0}
                    tone={ready ? 'green' : 'gold'}
                    label={
                      <span className="px-num">
                        {fmtShort(v)} / {fmtShort(goal)}
                      </span>
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {reveal && <ParcelReveal open={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
});

// ---- Навыки -----------------------------------------------------------------------------------

const PERK_ICON: Record<PerkId, GxIconName> = {
  dealer: 'coins-pile',
  grip: 'pick',
  lucky: 'gems',
  nose: 'key',
  shift: 'hourglass',
  blat: 'stairs',
};
const PERK_TONE: Record<PerkId, string> = {
  dealer: '#7a4a00',
  grip: '#34404f',
  lucky: '#17604f',
  nose: '#5a2f9e',
  shift: '#6b3f20',
  blat: '#9a2414',
};

/** «+6% к продаже» at level `n`: the number of the per-level text times n (null — no number). */
function perkAt(id: PerkId, n: number): string | null {
  const s = perkText(id);
  return /\d/.test(s) ? s.replace(/\d+/, (d) => fmtNum(Number(d) * n)) : null;
}

/** The bare value of a skill text: «+6%», fr «+8 %», tr «+%6» (the noun stays in the line above). */
function perkVal(text: string | null): string | null {
  const m = text?.match(/[+\u2212-]?\s?%?\s?\d[\d\s.,]*(?:\s?%)?/);
  return m ? m[0].trim() : null;
}

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const PerksTab = memo(function PerksTab() {
  const t = useT();
  // A short phone takes the tablet-portrait skills (one-line values, smaller nodes) — the tree
  // was squeezed to nothing at 320×568.
  const { lay: lay0, short, scale } = useLay();
  const lay: Lay = short ? 'tall' : lay0;
  // Phone / tablet portrait and the wide side column: the panel is a showcase — the skill's picture
  // as big as the height left over (36–72u: 72–144 px on a phone), the words under it (critic14 #2).
  const show = !short && lay !== 'land';
  const [artRef, artBox] = useShowBox(show);
  const tileU = show
    ? Math.max(36, Math.min(72, Math.floor(Math.min(artBox.h, artBox.w) / scale)))
    : 36; // 72 px on a phone: phone landscape beside the words, a short phone under the name
  const p = useFinanceStore((s) => s.prison);
  const prisonPerk = useFinanceStore((s) => s.prisonPerk);
  const prisonPerksReset = useFinanceStore((s) => s.prisonPerksReset);
  const free = perkPointsFree(p);
  const locked = !p.prestige;
  const list = PERKS.filter((k) => CREW_ON || k.id !== 'shift');
  const [sel, setSel] = useState<PerkId>(list[0].id);
  const [note, setNote] = useState<string | null>(null);
  // The reset is armed by a first tap; a second one ≥ ARM_GUARD_MS later resets (R22).
  const [armed, setArmed] = useState(false);
  const guard = useArmGuard();
  const root = useRef<HTMLDivElement>(null);
  // Short phone: the nodes are a sideways strip in pages as wide as the strip (whole nodes only —
  // no name cut by the edge at rest), snapped; ‹ › are real buttons that turn a page (critic14 #5:
  // a `pointer-events: none` › passed the tap to the node under it and never scrolled).
  const strip = useRef<HTMLDivElement>(null);
  const lastLearn = useRef(0);
  const [pages, setPages] = useState<number[] | null>(null);
  const [edge, setEdge] = useState({ less: false, more: false });
  const fitArrows = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const less = el.scrollLeft > 1;
    const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((e) => (e.less === less && e.more === more ? e : { less, more }));
  }, []);
  const paginate = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const row = el.firstElementChild as HTMLElement | null;
    const nodes = [...el.querySelectorAll<HTMLElement>('.ctab-node')];
    const arrow = el.parentElement?.querySelector<HTMLElement>('.ctab-tree__pg');
    if (!row || !arrow) return;
    // (a page has the row's 2u gap: the same sum before and after paging — no loop)
    const gap = parseFloat(getComputedStyle(el.querySelector('.ctab-page') ?? row).columnGap) || 0;
    // each page leaves an arrow's width (and a gap) free at both ends
    const avail = el.clientWidth - 2 * (arrow.offsetWidth + gap);
    const out: number[] = [];
    let n = 0;
    let w = 0;
    for (const nd of nodes) {
      const nw = nd.offsetWidth;
      if (n && w + gap + nw > avail) {
        out.push(n);
        n = 0;
        w = 0;
      }
      w += (n ? gap : 0) + nw;
      n++;
    }
    if (n) out.push(n);
    setPages((pg) => (pg && pg.join() === out.join() ? pg : out));
  }, []);
  useLayoutEffect(() => {
    if (short) paginate();
  });
  // The effect keeps to its lines: when it would run over (ru «после престижа — на ранг выше» at
  // 320), «· за уровень» goes — the step line under it shows the next level anyway; the whole
  // sentence is the tip.
  // The step line likewise: beside a short phone's 72-px picture «Сейчас +6% → +12%» needs 196 px
  // of 172 — the bare values then (the effect above names them); measured by the text's Range.
  const subRef = useRef<HTMLSpanElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const fitSub = useCallback(() => {
    const el = subRef.current;
    if (el) {
      el.classList.remove('is-tight');
      el.classList.toggle('is-tight', el.scrollHeight > el.clientHeight + 1);
    }
    const st = stepRef.current;
    const full = st?.firstElementChild;
    if (st && full) {
      st.classList.remove('is-tight');
      st.classList.toggle('is-tight', full.getBoundingClientRect().width > st.clientWidth + 0.2);
    }
  }, []);
  useLayoutEffect(fitSub);
  useEffect(() => {
    const el = subRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fitSub);
    ro.observe(el);
    if (stepRef.current) ro.observe(stepRef.current);
    return () => ro.disconnect();
  }, [fitSub]);
  useEffect(() => {
    const el = strip.current;
    if (!short || !el) {
      setEdge({ less: false, more: false });
      return undefined;
    }
    fitArrows();
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            paginate();
            fitArrows();
          });
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [short, fitArrows, paginate, pages]);
  const turn = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    tapLight();
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };
  // Tablet landscape / desktop: the nodes in two columns of three rows, as big as the tree's
  // height lets (30–45u: 90 → 135 px at 1180×820 — two rows of 90-px nodes left half of the stone
  // empty, critic17 #2). Measured on the scroller, whose size never follows its content.
  const [wideSlot, setWideSlot] = useState(30);
  useLayoutEffect(() => {
    const el = strip.current;
    if (lay !== 'wide' || !el) return undefined;
    const measure = () => {
      const nameH = el.querySelector<HTMLElement>('.ctab-node__name')?.offsetHeight ?? 0;
      const rows = Math.ceil(list.length / 2);
      // .ctab-nodes: 3u + 2u padding, a 2u gap slot → name, 4u between rows
      const byH = ((el.clientHeight - rows * nameH) / scale - 5 - 2 * rows - 4 * (rows - 1)) / rows;
      // a node is its slot + 10u wide; two columns and the nodes' 2u side padding
      const byW = (el.clientWidth / scale - 6) / 2 - 10;
      const s = Math.max(30, Math.min(45, Math.floor(Math.min(byH, byW))));
      setWideSlot((o) => (o === s ? o : s));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lay, scale, list.length]);
  const k = list.find((x) => x.id === sel) ?? list[0];
  const lv = p.perks[k.id];
  const max = lv >= k.max;

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const learn = () => {
    // a double tap is one level, not two (300 ms; real fast taps still count)
    const at = performance.now();
    if (at - lastLearn.current < 300) return;
    lastLearn.current = at;
    setArmed(false);
    if (locked) {
      notifyWarning();
      setNote(t('camp.perks.locked'));
      return;
    }
    if (max) return;
    if (free <= 0) {
      notifyWarning();
      setNote(t('ctabs.perks.noPoints'));
      return;
    }
    if (!prisonPerk(k.id as PerkId)) {
      notifyWarning();
      return;
    }
    tierBreak(1);
    notifySuccess();
    setNote(null);
  };
  // X / pad Y: learn the selected skill.
  useAction(
    ['inspect'],
    () => {
      learn();
    },
    { scope: root },
  );
  const pick = (id: PerkId) => {
    if (id === sel) return;
    selectionChanged();
    setNote(null);
    setArmed(false);
    setSel(id);
  };
  const doReset = () => {
    if (!armed) {
      tapLight();
      guard.mark();
      setArmed(true);
      return;
    }
    if (guard.tooSoon()) return; // a double tap is not a confirmation
    setArmed(false);
    prisonPerksReset();
    tapLight();
    setNote(null);
  };

  const nodeSlot = lay === 'tall' ? 24 : lay === 'wide' ? wideSlot : 30;
  const line = armed ? t('ctabs.perks.resetArm') : note;
  const now = perkVal(perkAt(k.id, lv));
  const next = perkVal(perkAt(k.id, lv + 1));
  // One line «Сейчас +6% → +12%» (the rows took 106 px; the effect's noun is the line above).
  // «Blat» has no number: the rank a prestige starts from (the store's `min(LAST_RANK − 1, blat)`).
  const blatAt = (n: number) => rankLetter(Math.min(LAST_RANK - 1, n));
  const nowV = now ?? `${lv}/${k.max}`;
  const nextV = next ?? `${lv + 1}/${k.max}`;
  const bare =
    k.id === 'blat'
      ? max
        ? blatAt(lv)
        : `${blatAt(lv)} → ${blatAt(lv + 1)}`
      : max
        ? nowV
        : `${lv ? nowV : '—'} → ${nextV}`;
  const step =
    k.id === 'blat'
      ? max
        ? t('ctabs.perks.blatNow', { now: blatAt(lv) })
        : t('ctabs.perks.blatStep', { now: blatAt(lv), next: blatAt(lv + 1) })
      : max
        ? `${t('ctabs.perks.now')} ${nowV}`
        : t('ctabs.perks.step', { now: lv ? nowV : '—', next: nextV });

  const node = (x: (typeof list)[number]) => {
    const l = p.perks[x.id];
    return (
      <div key={x.id} className={`ctab-node${l >= x.max ? ' is-max' : ''}`}>
        <Slot
          rarity={l >= x.max ? 4 : l > 0 ? 2 : 0}
          selected={x.id === sel}
          locked={locked}
          count={`${l}/${x.max}`}
          aria-label={`${perkName(x.id)} ${l}/${x.max}`}
          onFocus={() => kbd() && pick(x.id)}
          onClick={() => pick(x.id)}
        >
          <GxIcon name={PERK_ICON[x.id]} style={{ color: PERK_TONE[x.id] } as CSSProperties} />
        </Slot>
        <span className="ctab-node__name">{perkName(x.id)}</span>
      </div>
    );
  };

  return (
    <div ref={root} className={`px ctab ctab-perks ctab--${lay}${short ? ' ctab--short' : ''}`}>
      <Head
        title={t('camp.tab.perks')}
        hint={
          locked
            ? t('camp.perks.locked')
            : lay === 'land' || lay === 'tall'
              ? undefined
              : t('ctabs.perks.hint')
        }
        right={
          locked ? (
            <span className="px-dark ctab-points is-locked">
              <Icon name="lock" />
              <span className="ctab-points__w">
                {t('camp.perks.lockedRank', { rank: rankLetter(p.rank) })}
              </span>
            </span>
          ) : (
            <span className={`px-dark ctab-points${free > 0 ? ' is-free' : ''}`}>
              <span className="px-num ctab-points__n">{free}</span>
              <span className="ctab-points__w">
                <span>{t('ctabs.perks.points', { n: free })}</span>
                <span className="ctab-points__p">
                  {t('ctabs.perks.prestige', { n: p.prestige })}
                </span>
              </span>
              {/* Reset is secondary and free: a small ↶ on the plate, never in the action row
                  (it fell out of the 844×390 window there — critic5 P0). Two taps. */}
              <Button
                size="sm"
                icon="undo"
                kind={armed ? 'danger' : 'secondary'}
                label={t('camp.perks.reset')}
                className={`ctab-points__reset${armed ? ' is-armed' : ''}`}
                onClick={doReset}
              />
            </span>
          )
        }
      />
      <Panel material="stone" stage className="ctab-tree">
        <div ref={strip} className="ctab-scroll" onScroll={short ? fitArrows : undefined}>
          <div
            className={`ctab-nodes${short && pages ? ' is-paged' : ''}`}
            style={slotVar(nodeSlot)}
          >
            {short && pages
              ? pages.map((cnt, pi) => {
                  const from = pages.slice(0, pi).reduce((x, c) => x + c, 0);
                  return (
                    <div key={pi} className="ctab-page">
                      {list.slice(from, from + cnt).map(node)}
                    </div>
                  );
                })
              : list.map(node)}
          </div>
        </div>
        {short && (
          <>
            <Button
              size="sm"
              icon="left"
              label={t('ctabs.perks.prev')}
              className={`ctab-tree__pg is-prev${edge.less ? '' : ' is-gone'}`}
              tabIndex={-1}
              onClick={() => turn(-1)}
            />
            <Button
              size="sm"
              icon="right"
              label={t('ctabs.perks.next')}
              className={`ctab-tree__pg is-next${edge.more ? '' : ' is-gone'}`}
              tabIndex={-1}
              onClick={() => turn(1)}
            />
          </>
        )}
      </Panel>
      <Panel
        material="obsidian"
        className={`ctab-insp ctab-insp--perk${show ? ' is-show' : ''}`}
        aria-live="polite"
      >
        <div className="ctab-insp__top">
          <span ref={artRef} className="ctab-insp__art" aria-hidden="true">
            <span className="ctab-perk-art" style={{ '--tile': tileU } as CSSProperties}>
              <GxIcon name={PERK_ICON[k.id]} style={{ color: PERK_TONE[k.id] } as CSSProperties} />
              {/* row layouts (short phone, phone landscape): the level on the picture's corner, as
                  on the node — the name keeps the width (en «Connections 0/3» was cut) */}
              <span className="px-slot__n ctab-perk-art__lv">
                {lv}/{k.max}
              </span>
            </span>
          </span>
          <span className="ctab-insp__head">
            <span className="ctab-insp__name is-plain">
              {perkName(k.id)}{' '}
              <span className="px-num ctab-insp__lv">
                {lv}/{k.max}
              </span>
            </span>
            <span
              ref={subRef}
              className="ctab-insp__sub"
              data-tip={`${perkText(k.id)} · ${t('ctabs.perks.per')}`}
            >
              {perkText(k.id)}
              <span className="ctab-insp__per"> · {t('ctabs.perks.per')}</span>
            </span>
          </span>
        </div>
        <div ref={stepRef} className="px-num ctab-insp__step">
          <span className="ctab-insp__step-l">{step}</span>
          <span className="ctab-insp__step-s">{bare}</span>
        </div>
        <div className={`ctab-insp__line${line ? ' is-note' : ''}`}>{line ?? ''}</div>
        <div className="ctab-insp__acts">
          {max ? (
            <span className="ctab-insp__max">
              <Icon name="check" />
              {t('camp.maxDone')}
            </span>
          ) : (
            <Button kind="primary" off={locked || free <= 0} hint="inspect" onClick={learn}>
              {t('ctabs.perks.learn')}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
});
