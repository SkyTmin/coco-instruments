// Camp tabs on the pixel kit (wave 3 — T): «Лавка», «Руны», «Коллекция», «Достижения», «Навыки».
// Moved out of `PrisonCamp.tsx`; behaviour is the old one (same store actions, prices, sounds),
// the look and layout are the kit's (`.claude/rules/game-ui.md` → «Camp tabs on the kit»).
//
// Every tab has four arrangements by the shell's format (like the Nursery): `one` phone
// portrait (one column, actions at the bottom — the thumb zone), `land` phone landscape and
// `wide` tablet landscape / desktop (two columns), `tall` tablet portrait. Nothing jumps:
// inspect panels and rows have fixed heights, selection only moves a ring.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  bonusOf,
  FINDS,
  findsFound,
  findsMult,
  fusePlan,
  ITEMS,
  itemPrice,
  MILES,
  mileReady,
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
} from '@/components/PrisonCamp';
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
/** A slot (in art pixels) around art of `px` CSS pixels: the frame and a margin. */
const slotFor = (px: number, scale: number, pad: number) => Math.ceil(px / scale) + pad;
const slotVar = (n: number) => ({ '--slot': `calc(${n} * var(--u))` }) as CSSProperties;

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

/** Tokens: always in the head's right corner. */
function Purse({ n }: { n: number }) {
  return (
    <span
      className="px-dark ctab-purse"
      role="status"
      aria-label={t('camp.purseTokens', { n, v: fmtNum(n) })}
    >
      <TokenIcon size={18} />
      <span className="px-num">{fmtNum(n)}</span>
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
  const fitBonus = useCallback(() => {
    const el = bonusBox.current;
    if (!el) return;
    el.classList.remove('is-tight');
    const cut = [...el.querySelectorAll<HTMLElement>('.ctab-bonus__w')].some(
      (w) => w.scrollWidth > w.clientWidth + 1,
    );
    el.classList.toggle('is-tight', cut);
  }, []);
  useLayoutEffect(fitBonus);
  useEffect(() => {
    const el = bonusBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fitBonus);
    ro.observe(el);
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
  const inspPx = fit(40, lay === 'wide' ? 30 : 24, scale, dpr);
  const actSize = short || lay === 'tall' || lay === 'land' ? 'sm' : undefined;

  // The amulet's own bonus: the worn runes only (the squad's pets show theirs in the Nursery), so
  // four sockets give at most four kinds and the 2×2 box never scrolls (critic5 P0).
  const b = bonusOf({ runes: p.runes, sockets: p.sockets });
  const bonus = BONUS_KEYS.filter((k) => b[k] > 0);
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
                {/* A worn rune's % is in the bonus box below — no caption; a locked socket says
                    its condition on a cream plate (R53: no text straight on the stone). */}
                <span className={`ctab-sock__cap${locked ? ' is-lock' : ''}`}>
                  {r ? '' : locked ? lockText(i) : t('camp.runes.empty')}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
      <div ref={bonusBox} className="ctab-bonus" style={{ '--st': stPx } as CSSProperties}>
        {bonus.length ? (
          bonus.map((k) => (
            <span
              key={k}
              className="ctab-chip ctab-bonus__chip"
              data-tip={`${pctText(b[k])} ${t(`camp.bonus.${k}`)}`}
              aria-label={`${pctText(b[k])} ${t(`camp.bonus.${k}`)}`}
            >
              <i className={`ctab-st ctab-st--${k}`} aria-hidden="true" />
              <b className="px-num">{pctText(b[k])}</b>
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
        <span className="ctab-sub__hint">{t('ctabs.runes.pouchHint')}</span>
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
            <span className="ctab-insp__gives">{runeLine(shown)}</span>
            <span className="ctab-insp__sub">{t('ctabs.runes.roll', { n: shown.roll })}</span>
          </span>
        </div>
        <div
          className={`ctab-insp__line${note ? ' is-note' : ''}`}
          data-tip={short ? (note ?? fuseLine) || undefined : undefined}
        >
          {note ?? fuseLine}
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
            <TokenIcon size={16} />
          </Button>
        </div>
      </div>
      {!rune && (
        <div className="ctab-insp__empty">
          <Icon name="info" />
          <span>{note ?? (p.runes.length ? t('ctabs.runes.pick') : t('camp.runes.none'))}</span>
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
  const { lay, scale, dpr } = useLay();
  const p = useFinanceStore((s) => s.prison);
  const found = findsFound(p.finds);
  const [sel, setSel] = useState(() => FINDS.find((f) => p.finds[f.id])?.id ?? FINDS[0].id);
  const f = FINDS.find((x) => x.id === sel) ?? FINDS[0];
  const n = p.finds[f.id] ?? 0;
  const small = lay !== 'wide';
  const px = fit(16, small ? 26 : 32, scale, dpr);
  const slot = slotFor(px, scale, 2);
  const bigPx = fit(16, small ? 30 : 40, scale, dpr);
  const pick = (id: string) => {
    if (id === sel) return;
    selectionChanged();
    setSel(id as typeof sel);
  };
  return (
    <div className={`px ctab ctab-finds ctab--${lay}`}>
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
      <div className="ctab-scroll ctab-finds__grid">
        <Grid className="ctab-grid" style={slotVar(slot)}>
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
      <Panel material="obsidian" className="ctab-insp ctab-insp--find" aria-live="polite">
        <div className="ctab-insp__top">
          <span className="ctab-insp__art">
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

function MileGifts({ m }: { m: (typeof MILES)[number] }) {
  const r = m.reward;
  return (
    <span className="ctab-gifts">
      {!!r.tokens && (
        <span className="ctab-chip">
          <TokenIcon size={16} />
          <b className="px-num">+{fmtNum(r.tokens)}</b>
        </span>
      )}
      {!!r.keys && (
        <span className="ctab-chip">
          <KeyIcon size={16} />
          <b className="px-num">×{r.keys}</b>
        </span>
      )}
      {r.parcel && (
        <span className="ctab-chip">
          <GxIcon name="gift" />
          {t('camp.mile.parcel', { tier: nameIn(chestName(r.parcel)) })}
        </span>
      )}
      {!!r.rune && (
        <span className="ctab-chip">
          <GxIcon name="rune" />
          {t('camp.mile.rune', { tier: RUNE_ROMAN[r.rune - 1] })}
        </span>
      )}
      {r.socket && (
        <span className="ctab-chip">
          <Icon name="plus" />
          {t('camp.mile.socket')}
        </span>
      )}
      {r.egg && (
        <span className="ctab-chip">
          <EggArt egg={r.egg} size={16} />
          {nameIn(eggName(r.egg))}
        </span>
      )}
    </span>
  );
}

// memo: the camp shell re-renders every second (useNow) — a tab only when its props change (R55).
export const MilesTab = memo(function MilesTab({
  onGain,
}: {
  onGain: (from: number, to: number) => void;
}) {
  const t = useT();
  const { lay } = useLay();
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
    <div ref={root} className={`px ctab ctab-miles ctab--${lay}`}>
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
        <div className="ctab-miles__list">
          {order.map(({ m, done: isDone, ready }) => {
            const [v, goal] = m.progress(p);
            return (
              <div
                key={m.id}
                className={`ctab-mile${ready ? ' is-ready' : ''}${isDone ? ' is-done' : ''}`}
              >
                <span
                  className={`px-slot px-slot--r${ready ? 4 : 0} ctab-mile__art`}
                  aria-hidden="true"
                >
                  <span className="px-slot__art">
                    <GxIcon name={MILE_ICON[m.id] ?? 'trophy'} />
                  </span>
                </span>
                <span className="ctab-mile__info">
                  <span className="ctab-mile__name">{mileTitle(m.id)}</span>
                  <span className="ctab-mile__text">{mileText(m.id)}</span>
                  <MileGifts m={m} />
                </span>
                <span className="ctab-mile__end">
                  {ready || takenNow.current.has(m.id) ? (
                    // The button and the check share one cell: taking swaps them, the cell (and
                    // so the row) keeps its width and height.
                    <span className="ctab-mile__swap">
                      <Button
                        kind="primary"
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
  const { lay: lay0, short } = useLay();
  const lay: Lay = short ? 'tall' : lay0;
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
  // Short phone: the nodes are one sideways strip; a › at its right end while more skills lie
  // beyond (a strip that ends on a whole node gave no hint of the other three).
  const strip = useRef<HTMLDivElement>(null);
  const lastLearn = useRef(0);
  const [more, setMore] = useState(false);
  const fitStrip = useCallback(() => {
    const el = strip.current;
    setMore(!!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    const el = strip.current;
    if (!short || !el) {
      setMore(false);
      return undefined;
    }
    fitStrip();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitStrip);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [short, fitStrip]);
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

  const nodeSlot = lay === 'tall' ? 24 : 30;
  const line = armed ? t('ctabs.perks.resetArm') : note;
  const now = perkVal(perkAt(k.id, lv));
  const next = perkVal(perkAt(k.id, lv + 1));
  // One line «Сейчас +6% → +12%» (the rows took 106 px; the effect's noun is the line above).
  const step = max
    ? `${t('ctabs.perks.now')} ${now ?? `${lv}/${k.max}`}`
    : t('ctabs.perks.step', {
        now: lv ? (now ?? `${lv}/${k.max}`) : '—',
        next: next ?? `${lv + 1}/${k.max}`,
      });

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
        {more && (
          <span className="ctab-tree__more" aria-hidden="true">
            <Icon name="right" />
          </span>
        )}
        <div ref={strip} className="ctab-scroll" onScroll={short ? fitStrip : undefined}>
          <div className="ctab-nodes" style={slotVar(nodeSlot)}>
            {list.map((x) => {
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
                    <GxIcon
                      name={PERK_ICON[x.id]}
                      style={{ color: PERK_TONE[x.id] } as CSSProperties}
                    />
                  </Slot>
                  <span className="ctab-node__name">{perkName(x.id)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
      <Panel material="obsidian" className="ctab-insp ctab-insp--perk" aria-live="polite">
        <div className="ctab-insp__top">
          <span className="ctab-insp__art ctab-perk-art" aria-hidden="true">
            <GxIcon name={PERK_ICON[k.id]} style={{ color: PERK_TONE[k.id] } as CSSProperties} />
          </span>
          <span className="ctab-insp__head">
            <span className="ctab-insp__name is-plain">
              {perkName(k.id)}{' '}
              <span className="px-num ctab-insp__lv">
                {lv}/{k.max}
              </span>
            </span>
            <span className="ctab-insp__sub">
              {perkText(k.id)} · {t('ctabs.perks.per')}
            </span>
          </span>
        </div>
        <div className="px-num ctab-insp__step">{step}</div>
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
