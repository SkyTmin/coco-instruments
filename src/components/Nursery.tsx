// Nursery — the pets view of «Питомник», the first screen on the pixel kit (`@/ui-px`, style
// guide `.claude/rules/ui-px.md`). Rules are untouched (`lib/pets.ts`, store actions): this is
// only how the same squad, collection, merge and skin choice look and are reached.
//
// One component, four arrangements by the shell's format (`useFormFactor`). The stage (room +
// framed animation buttons + the name plate) always takes about half the screen, and every box
// has a fixed size whatever pet is chosen — nothing jumps when the selection changes:
// - `one` (phone portrait): stage on top, the squad (three big slots + the 3×2 bonus grid), the
//   action bar `[▦ 18/18] [take/leave] [i]`; the collection opens in a drawer over the side.
// - `land` (phone landscape): stage | side (plate, squad with the bonus grid beside the slots,
//   actions); the collection is the same drawer.
// - `tall` (tablet portrait): stage on top, side below with the full collection grid.
// - `wide` (tablet landscape, desktop): stage | side with the full collection grid.
// Details (stats table, merge, skins) open in a sheet on every format.
// Keyboard/gamepad: arrows move between slots (the shell's spatial focus), a focused slot is
// the selected pet, `inspect` (X / pad Y) takes it along or leaves it home.
//
// Wave 3 — N2 (critic, 13.10): bonuses are baked 12 × 12 stat pictures (`--pximg-st-*`) at
// 24 CSS px (36 at ui-scale ≥ 4) with whole percents; the squad sum is a fixed grid of all six
// stats; at most three chips per pet; the stage swaps to another pet only once its strip is
// decoded; cells and squad slots are memoised.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useFinanceStore } from '@/store';
import { fmtNum, useT } from '@/i18n';
import { useFormFactor } from '@/game-shell';
import { focusEl, getInputDevice, useAction } from '@/input';
import { registerEscape } from '@/lib/escape-stack';
import { PetArt, petArtSrc } from '@/components/PetArt';
import type { PetAnim } from '@/components/PetArt';
import { RARITIES } from '@/lib/rarity';
import { pxFit } from '@/lib/pet-pixel-fit';
import { PET_PX } from '@/lib/pet-pixel-sprites';
import { rankLetter } from '@/lib/prison';
import {
  canMerge,
  canPat,
  eggChances,
  EGGS,
  MERGE_NEED,
  PAT_XP,
  petBonus,
  petLevelOf,
  petLook,
  petOf,
  PETS,
  petScore,
  squadSlots,
  SQUAD_RANK2,
  zooMult,
} from '@/lib/pets';
import type { PetId, PetRec, PetStat } from '@/lib/pets';
import { burstConfetti } from '@/lib/confetti';
import { flashFrame } from '@/lib/juice';
import { petMerge, petPat, primeAudio } from '@/lib/sound';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';
import { Badge, Bar, Button, Grid, Heading, Icon, Modal, Panel, Slot, usePress } from '@/ui-px';
import type { PxIconName } from '@/ui-px';
import './nursery.css';

/** Showcase buttons: loops switch the base animation, one-shots play once and return. */
const ANIMS: { id: PetAnim; icon: PxIconName; loop: boolean }[] = [
  { id: 'idle', icon: 'pause', loop: true },
  { id: 'walk', icon: 'paws', loop: true },
  { id: 'happy', icon: 'heart', loop: false },
  { id: 'work', icon: 'star', loop: false },
  { id: 'attack', icon: 'claw', loop: false },
  { id: 'sleep', icon: 'moon', loop: true },
];
/** The fixed order of the six stats (squad grid, ties between equal chips). */
const STATS: PetStat[] = ['loot', 'sell', 'dmg', 'token', 'luck', 'rate'];
/** Chips on the plate: the biggest bonuses first, the rest behind «+N» (opens the details). */
const MAX_CHIPS = 3;
type Sort = 'rarity' | 'level' | 'power';
type Filter = 'all' | 'owned' | 'missing';
const SORTS: Sort[] = ['rarity', 'level', 'power'];
const FILTERS: Filter[] = ['all', 'owned', 'missing'];
type Layout = 'one' | 'land' | 'tall' | 'wide';
type SquadView = (PetId | null)[];

/** Percent with one decimal (details table, tips): the locale formats the number. */
const pctV = (x: number) => Math.round(x * 1000) / 10;
/** Whole percent for the first glance (plate chips, squad grid); never «+0%» for a real bonus. */
const pctI = (x: number) => Math.max(x > 0 ? 1 : 0, Math.round(x * 100));
const rc = (r: number) => ({ '--rc': RARITIES[r]?.color }) as CSSProperties;
const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

/** Stat picture size: 24 CSS px (36 at ui-scale ≥ 4), rounded to whole screen dots per art
 *  pixel — the 12 × 12 art stays crisp at any DPR. */
function useStatPx(): string {
  const { scale } = useFormFactor();
  const dpr = dprNow();
  const k = Math.max(1, Math.round(((scale >= 4 ? 36 : 24) * dpr) / 12));
  return `${(k * 12) / dpr}px`;
}

/** A baked 12 × 12 stat picture (`paint.ts`, wave 3 — N2) at `--st`. */
function StatIcon({ stat, dim }: { stat: PetStat | 'power'; dim?: boolean }) {
  return <i className={`nur-st nur-st--${stat}${dim ? ' is-dim' : ''}`} aria-hidden="true" />;
}

// ---- Decode before swap ------------------------------------------------------------------------
// Switching pets used to show the OLD strip squeezed into the new frame box until the new one
// loaded (+186 → +600 ms at 4×, critic). The stage now keeps the old pet until the new strip is
// decoded; the squad and the neighbours in the collection are decoded ahead of time.
const decoded = new Map<string, HTMLImageElement>();
const decoding = new Map<string, Promise<void>>();
function decodeArt(src: string): Promise<void> {
  if (decoded.has(src)) return Promise.resolve();
  let job = decoding.get(src);
  if (!job) {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    job = im
      .decode()
      .catch(() => undefined)
      .then(() => {
        decoding.delete(src);
        // keep a handful referenced, so the decoded bitmaps stay in the memory cache
        decoded.set(src, im);
        if (decoded.size > 30) decoded.delete(decoded.keys().next().value as string);
      });
    decoding.set(src, job);
  }
  return job;
}

/** Size of an element's box, kept in state: the stage sizes the pet from it. */
function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const put = (w: number, h: number) =>
      setBox((b) =>
        b.w === Math.floor(w) && b.h === Math.floor(h) ? b : { w: Math.floor(w), h: Math.floor(h) },
      );
    put(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => put(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/** Pedestal pixel in CSS px, from the ROOM and not from the pet: every pet stands on the same
 *  pedestal, so switching pets never moves it (owner: «чтобы картинка не дёргалась»). Whole
 *  screen dots, never under the UI pixel. The pedestal is 56 × 18 of its pixels. */
const pedFor = (w: number, h: number, dpr: number, u: number) =>
  Math.max(u, Math.floor(((Math.min(w, h * 1.25) * 0.8) / 56) * dpr) / dpr);

/** The biggest pet frame that fits `w` × `h` with its feet `lift` px above the room's floor, at
 *  a whole number of screen dots per art pixel (what `pxFit` will draw — it may round up by 15%,
 *  so the check is on its result). */
function fitPet(id: PetId, w: number, h: number, dpr: number, lift: number): number {
  const px = PET_PX[id];
  const ok = (s: number) => s <= w && s + lift <= h;
  const plain = Math.max(0, Math.floor(Math.min(w, h - lift)));
  if (!px) return plain;
  let best = 0;
  let arg = 0;
  for (const box of [px.box, px.large?.box ?? 0]) {
    if (!box) continue;
    for (let k = 2; (k * box) / dpr <= w * 1.2; k++) {
      const want = (k * box) / dpr;
      const s = pxFit(want, px, dpr).s;
      if (s > best && ok(s)) {
        best = s;
        arg = want;
      }
    }
  }
  if (!best) return plain;
  return pxFit(best, px, dpr).s === best ? best : arg;
}

/** The squad as the slots show it: a pet left home keeps its slot empty (no shifting), the next
 *  one taken fills the first empty slot. The store keeps the plain list (`view` without holes, in
 *  the same order), so nothing in the save changes; a change from elsewhere resets the view. */
const padSquad = (squad: PetId[], n: number): SquadView =>
  Array.from({ length: n }, (_, i) => squad[i] ?? null);
const sameList = (a: readonly (PetId | null)[], b: readonly PetId[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Memoised: the camp re-renders every second (`useNow` in `PrisonCamp`) — the Nursery only
 *  when the store or its own state changes (`say` from `PetsTab` is stable). */
export const Nursery = memo(function Nursery({ say }: { say: (text: string) => void }) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const { ff, landscape, scale } = useFormFactor();
  const stPx = useStatPx();
  const layout: Layout =
    ff === 'phone-portrait'
      ? 'one'
      : ff === 'phone-landscape'
        ? 'land'
        : ff === 'tablet' && !landscape
          ? 'tall'
          : 'wide';
  // Phones: the collection opens in a drawer from the action bar; tablets and desktops show the grid.
  const drawerMode = layout === 'one' || layout === 'land';
  // Phone landscape and wide screens: the name plate tops the side column, so the room keeps
  // the whole stage height (the pet there is limited by the height).
  const plateSide = layout === 'land' || layout === 'wide';
  const root = useRef<HTMLDivElement>(null);

  const owned = PETS.filter((d) => p.pets[d.id]).length;
  const [sel, setSel] = useState<PetId>(
    () => p.squad[0] ?? PETS.find((d) => p.pets[d.id])?.id ?? PETS[0].id,
  );
  const [base, setBase] = useState<PetAnim>('idle');
  const [show, setShow] = useState<{ anim: PetAnim; k: number } | null>(null);
  const [joy, setJoy] = useState(0);
  const [xpPop, setXpPop] = useState(0);
  const [sort, setSort] = useState<Sort>('rarity');
  const [filter, setFilter] = useState<Filter>('all');
  const [pick, setPick] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [animsOpen, setAnimsOpen] = useState(false);
  const animsRef = useRef<HTMLDivElement>(null);
  const morePress = usePress<HTMLButtonElement>();

  const rec = p.pets[sel];
  const slots = Math.min(3, squadSlots(p.rank, p.prestige));
  const here = p.squad.includes(sel);

  // The slots' own order (item 14 of the critic): holes stay where a pet left.
  const [view, setView] = useState<SquadView>(() => padSquad(p.squad, slots));
  let squadView = view;
  if (view.length !== slots || !sameList(view.filter(Boolean), p.squad)) {
    squadView = padSquad(p.squad, slots);
    setView(squadView);
  }
  const commitSquad = (next: SquadView) => {
    setView(next);
    setSquad(next.filter((x): x is PetId => !!x));
  };

  const select = (id: PetId) => {
    if (id === sel) return;
    selectionChanged();
    setSel(id);
    setBase('idle');
    setShow(null);
  };
  // Stable for the memoised cells: they get the id back.
  const selectRef = useRef(select);
  selectRef.current = select;
  const onPick = useCallback((id: PetId) => selectRef.current(id), []);

  const toggleSquad = () => {
    if (!rec) {
      say(t('nursery.hatchFirst'));
      return;
    }
    primeAudio();
    selectionChanged();
    if (here) {
      commitSquad(squadView.map((x) => (x === sel ? null : x)));
      return;
    }
    // The first empty slot; squad full — the newcomer takes the last place (as the old card did).
    const next = [...squadView];
    const free = next.indexOf(null);
    next[free >= 0 ? free : next.length - 1] = sel;
    commitSquad(next);
    petPat();
    setJoy((j) => j + 1);
  };
  useAction(
    ['inspect'],
    () => {
      toggleSquad();
    },
    { scope: root },
  );

  const list = useMemo(() => {
    const ids = PETS.filter((d) =>
      filter === 'all' ? true : filter === 'owned' ? !!p.pets[d.id] : !p.pets[d.id],
    );
    if (sort === 'rarity') return ids;
    const key = (id: PetId) => {
      const r = p.pets[id];
      if (!r) return -1;
      return sort === 'level' ? r.xp : petScore(id, r);
    };
    return [...ids].sort((a, b) => key(b.id) - key(a.id) || b.rarity - a.rarity);
  }, [p.pets, sort, filter]);

  const zoo = zooMult(p.pets) - 1;
  const squadBonus: Partial<Record<PetStat, number>> = {};
  for (const id of p.squad) {
    const r = p.pets[id];
    if (!r) continue;
    for (const [k, v] of Object.entries(petBonus(id, r)))
      squadBonus[k as PetStat] = (squadBonus[k as PetStat] ?? 0) + (v ?? 0);
  }

  // The stage measures its room and takes the biggest crisp pet that fits; the pedestal and the
  // room depend on the layout only, so another pet never moves anything around it.
  const u = scale || 2;
  const dpr = dprNow();
  const roomRef = useRef<HTMLSpanElement>(null);
  const room = useBox(roomRef);
  const ped = pedFor(room.w, room.h, dpr, u);
  const lift = 4 * ped;
  const artFor = (id: PetId) => {
    const r = p.pets[id];
    const s = room.w && room.h ? fitPet(id, room.w, room.h, dpr, lift) : 0;
    return { size: s, src: s ? petArtSrc(id, s, r ? petLook(r) : 0, !r) : '' };
  };
  // Decode before swap: the stage (art + plate) keeps the pet it shows until the picked one's
  // strip is decoded. Already decoded (preloaded neighbours) → the same render.
  const want = artFor(sel);
  const shownRef = useRef<PetId>(sel);
  const [, setDecodedTick] = useState(0);
  const ready = !want.src || decoded.has(want.src);
  if (ready) shownRef.current = sel;
  const stageId = shownRef.current;
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    void decodeArt(want.src).then(() => live && setDecodedTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, [ready, want.src]);
  // Preload the squad and ±3 neighbours of the selection in the collection order, one by one
  // and after the switch itself has painted.
  useEffect(() => {
    if (!room.w || !room.h) return undefined;
    const i = list.findIndex((d) => d.id === sel);
    const ids = new Set<PetId>(p.squad);
    for (let k = -3; k <= 3; k++) if (list[i + k]) ids.add(list[i + k].id);
    let live = true;
    const timer = window.setTimeout(async () => {
      for (const id of ids) {
        if (!live) return;
        const a = artFor(id);
        if (a.src) await decodeArt(a.src);
      }
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, list, p.squad, room.w, room.h]);

  const sdef = petOf(stageId);
  const srec = p.pets[stageId];
  const slv = petLevelOf(srec?.xp ?? 0);
  const size = stageId === sel ? want.size : artFor(stageId).size;
  // Slot art: the drawer/grid cell is 26 art px, the squad cells bigger (nursery.css `--slot`).
  const thumb = 20 * u;
  const big = (layout === 'land' ? 20 : layout === 'one' ? 22 : 26) * u;

  const name = t(`pets.${stageId}.name`);

  const pet = (
    <span
      key={stageId}
      className="nur-pet"
      style={
        {
          '--ped': `${ped}px`,
          '--lift': `${lift}px`,
          // whole screen dots, so the art never lands between pixels
          '--x': `${Math.round(((room.w - size) / 2) * dpr) / dpr}px`,
          '--pedx': `${Math.round(((room.w - 56 * ped) / 2) * dpr) / dpr}px`,
        } as CSSProperties
      }
    >
      {size > 0 && (
        <PetArt
          id={stageId}
          size={size}
          v={petLook(srec)}
          ghost={!srec}
          anim={base}
          joy={joy}
          play={show}
          onClick={
            srec
              ? () => {
                  primeAudio();
                  petPat();
                  tapLight();
                  setJoy((j) => j + 1);
                  if (canPat(srec, Date.now()) && pat(stageId)) setXpPop((x) => x + 1);
                }
              : undefined
          }
        />
      )}
    </span>
  );

  // Six framed buttons, always all six (a pet not hatched yet: greyed, a tap says why) — the row
  // never changes. The word is the tip / aria label. Tablets and desktops: a column beside the
  // room (the room is limited by its height there). Phones: one ▶ toggle in the room's corner
  // opens them as a 3 × 2 menu (pitch ≥ 44 px) — the column cost the portrait pet its width.
  const animBtns = ANIMS.map((a) => {
    const word = t(`nursery.anim.${a.id}`);
    return (
      <Button
        key={a.id}
        size={drawerMode ? 'md' : 'sm'}
        icon={a.icon}
        label={word}
        className="nur-anim"
        off={!srec}
        on={srec && a.loop ? base === a.id && !show : undefined}
        data-autofocus={drawerMode && a.loop && base === a.id && !show ? '' : undefined}
        onClick={() => {
          tapLight();
          setAnimsOpen(false);
          if (!srec) {
            say(t('nursery.hatchFirst'));
            return;
          }
          if (a.loop) {
            setBase(a.id);
            setShow(null);
          } else setShow((s) => ({ anim: a.id, k: (s?.k ?? 0) + 1 }));
        }}
      />
    );
  });
  const anims = drawerMode ? (
    <>
      <Button
        size="sm"
        icon="play"
        label={t('nursery.anims')}
        className="nur-anim-tog"
        on={animsOpen}
        aria-expanded={animsOpen}
        onClick={() => {
          tapLight();
          setAnimsOpen((o) => !o);
        }}
      />
      {animsOpen && (
        <div
          ref={animsRef}
          className="nur-anims nur-anims--pop"
          role="toolbar"
          aria-label={t('nursery.anims')}
          data-ui-layer=""
        >
          {animBtns}
        </div>
      )}
    </>
  ) : (
    <div className="nur-anims" role="toolbar">
      {animBtns}
    </div>
  );

  // Role chips: picture + whole percent, biggest first; the sentence with one decimal is the tip.
  // At most three, the rest behind «+N» (opens the details) — one row, the plate never grows.
  const sb = srec ? petBonus(stageId, srec) : {};
  const ranked = [...sdef.stats].sort(
    (a, b) => (sb[b] ?? 0) - (sb[a] ?? 0) || STATS.indexOf(a) - STATS.indexOf(b),
  );
  const shown = ranked.slice(0, MAX_CHIPS);
  // «+N» is not a kit button: its press shows on pointerdown by the shared `usePress` handlers.
  // A narrow plate shows two chips + «+N+1» (nursery.css picks the variant by the row's width).
  const moreBtn = (n: number, cls: string) => (
    <button
      type="button"
      {...morePress}
      className={`nur-chip nur-chip--more${cls} px-f`}
      aria-label={t('nursery.details')}
      data-tip={t('nursery.details')}
      onClick={() => {
        tapLight();
        setInfo(true);
      }}
    >
      +{n}
    </button>
  );
  const roles = srec ? (
    <>
      {shown.map((s, i) => {
        const full = t(`nursery.role.${s}.text`, { v: pctV(sb[s] ?? 0) });
        return (
          <span
            key={s}
            className={`nur-chip${i === 2 ? ' nur-chip--3' : ''}`}
            data-tip={full}
            aria-label={full}
          >
            <StatIcon stat={s} />
            <b className="px-num">{t('nursery.bonus', { v: pctI(sb[s] ?? 0) })}</b>
          </span>
        );
      })}
      {shown.length < ranked.length && moreBtn(ranked.length - shown.length, '')}
      {shown.length === MAX_CHIPS && moreBtn(ranked.length - 2, ' nur-chip--more2')}
    </>
  ) : (
    <span className="nur-chip nur-chip--note">{t('nursery.notYet')}</span>
  );

  // The plate under the pet: name (one line, sized to fit) + power, rarity pill + gold + level,
  // the chips and the level bar. Fixed rows — switching pets never changes its height.
  const xpV = srec ? (slv.need ? slv.into / slv.need : 1) : 0;
  const xpText = !srec
    ? ''
    : !slv.need
      ? t('nursery.lvMax')
      : `${fmtNum(slv.into)} / ${fmtNum(slv.need)}`;
  const plate = (
    <div
      className="px-dark nur-plate"
      style={{ ...rc(sdef.rarity), '--len': Math.max(8, name.length) } as CSSProperties}
    >
      <div className="nur-plate__top">
        <span className="nur-plate__nm">
          <h3 className="nur-plate__name">{name}</h3>
        </span>
        <span
          className={`nur-pow${srec ? '' : ' is-none'}`}
          data-tip={t('nursery.power')}
          aria-label={srec ? `${t('nursery.power')} ${fmtNum(petScore(stageId, srec) * 10)}` : ''}
        >
          <StatIcon stat="power" />
          <b className="px-num">{srec ? fmtNum(petScore(stageId, srec) * 10) : ''}</b>
        </span>
      </div>
      <div className="nur-plate__row">
        <span className="nur-rar">
          {t(`nursery.rarity.r${sdef.rarity}` as 'nursery.rarity.r0')}
        </span>
        {!!srec?.v && (
          <span
            className="nur-gold"
            role="img"
            aria-label={t('nursery.gold')}
            data-tip={t('nursery.gold')}
          >
            <Badge gold>
              <Icon name="star" />
              <span className="nur-gold__w">{t('nursery.gold')}</span>
            </Badge>
          </span>
        )}
        {srec && <span className="nur-lv">{t('common.level', { n: slv.level })}</span>}
      </div>
      <div
        className={`nur-plate__roles${shown.some((s) => pctI(sb[s] ?? 0) >= 100) ? ' is-big' : ''}`}
      >
        {roles}
      </div>
      {layout === 'one' ? (
        // phone portrait: a slim bar (the pet takes the height); the numbers are its tip and
        // the details sheet's bar
        <span className="nur-xp" data-tip={xpText || undefined} aria-label={xpText || undefined}>
          <Bar value={xpV} height={4} />
        </span>
      ) : (
        <Bar value={xpV} label={xpText} />
      )}
    </div>
  );

  const xp = xpPop > 0 && (
    <b key={xpPop} className="nur-stage__xp">
      {t('nursery.patXp', { n: PAT_XP })}
    </b>
  );

  // The soft aura and rotating rays of legendary/mythic pets are hidden on the stage (no vector
  // glow next to pixel art); rarity shows on the plate's pill and name.
  const showcase = (
    <section className={`nur-show nur-show--r${sdef.rarity}`} style={rc(sdef.rarity)}>
      <Panel material="stone" stage className="nur-stage">
        <span ref={roomRef} className="nur-room">
          {pet}
        </span>
        {anims}
        {!plateSide && plate}
        {xp}
      </Panel>
    </section>
  );

  // Squad: three BIG cells, then all six stats in a fixed grid (a stat the squad lacks keeps its
  // box: a dim picture and «—»). On phone landscape the grid stands beside the cells.
  const squad = (
    <section className="nur-squad" aria-label={t('nursery.squad')}>
      <div className="nur-squad__head">
        <span
          className="nur-squad__t"
          data-tip={layout === 'land' ? t('nursery.squadHint') : undefined}
        >
          <Heading className="nur-squad__title">{t('nursery.squad')}</Heading>
        </span>
        {layout !== 'land' && <span className="nur-squad__hint">{t('nursery.squadHint')}</span>}
      </div>
      <div className="nur-squad__row">
        {[0, 1, 2].map((i) => {
          if (i >= slots) {
            // What opens it is written in the cell; a tap says it too.
            const why =
              i === 1
                ? t('nursery.lockRank', { rank: rankLetter(SQUAD_RANK2) })
                : t('nursery.lockPrestige');
            return (
              <Slot
                key={i}
                empty
                className="nur-squad__lock"
                aria-disabled
                aria-label={why}
                tip={why}
                onClick={() => {
                  tapLight();
                  say(why);
                }}
              >
                <Icon name="lock" />
                <span className="nur-squad__why">{why}</span>
              </Slot>
            );
          }
          const id = squadView[i];
          const r = id ? p.pets[id] : undefined;
          if (!id || !r)
            return (
              <Slot
                key={i}
                empty
                className="nur-squad__add"
                aria-label={t('nursery.pick')}
                tip={t('nursery.pick')}
                onClick={() => {
                  tapLight();
                  if (!owned) say(t('nursery.hatchFirst'));
                  else setPick(i);
                }}
              >
                <Icon name="plus" />
              </Slot>
            );
          return (
            <SquadSlot key={i} id={id} rec={r} selected={sel === id} size={big} onPick={onPick} />
          );
        })}
      </div>
      <div className="nur-squad__sum">
        {STATS.map((k) => {
          const v = squadBonus[k] ?? 0;
          const full = v ? t(`nursery.role.${k}.text`, { v: pctV(v) }) : t(`nursery.stat.${k}`);
          return (
            <span
              key={k}
              className={`nur-sum${v ? '' : ' is-none'}`}
              data-tip={full}
              aria-label={v ? full : `${t(`nursery.stat.${k}`)} —`}
            >
              <StatIcon stat={k} dim={!v} />
              <b className="px-num">{v ? t('nursery.bonus', { v: pctI(v) }) : '—'}</b>
            </span>
          );
        })}
      </div>
    </section>
  );

  const cells = list.map((d) => (
    <NurCell
      key={d.id}
      id={d.id}
      rec={p.pets[d.id]}
      selected={sel === d.id}
      along={p.squad.includes(d.id)}
      size={thumb}
      onPick={onPick}
    />
  ));

  const collHead = (
    <div className="nur-coll__head">
      <Heading>
        {t('nursery.collection')}{' '}
        <span className="nur-coll__count px-num">
          {owned}/{PETS.length}
        </span>
      </Heading>
      {zoo > 0 && (
        <span
          className="nur-chip nur-chip--sm"
          data-tip={t('nursery.zoo', { v: pctV(zoo) })}
          aria-label={t('nursery.zoo', { v: pctV(zoo) })}
        >
          <StatIcon stat="sell" />
          <b className="px-num">{t('nursery.bonus', { v: pctI(zoo) })}</b>
        </span>
      )}
      <span className="nur-tools">
        <Button
          size="sm"
          icon="sort"
          aria-label={t('nursery.sortLabel')}
          onClick={() => {
            tapLight();
            setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);
          }}
        >
          {t(`nursery.sort.${sort}`)}
        </Button>
        <Button
          size="sm"
          icon="filter"
          aria-label={t('nursery.filterLabel')}
          onClick={() => {
            tapLight();
            setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length]);
          }}
        >
          {t(`nursery.filter.${filter}`)}
        </Button>
      </span>
    </div>
  );

  // Phones: the grid button sits in the action bar and opens the drawer.
  const openBtn = (
    <Button
      className="nur-strip__open"
      icon="grid"
      aria-label={t('nursery.collection')}
      data-tip={t('nursery.collection')}
      aria-expanded={drawer}
      onClick={() => {
        tapLight();
        setDrawer(true);
      }}
    >
      <span className="px-num">
        {owned}/{PETS.length}
      </span>
    </Button>
  );
  const collection = drawerMode ? null : (
    <section className="nur-coll">
      {collHead}
      <Grid className="nur-grid">{cells}</Grid>
    </section>
  );

  // The drawer covers the side area only (squad, actions): the stage stays in view and shows
  // each pet as it is picked. Esc / Back / pad B closes it (escape stack).
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const host = root.current;
    const off = registerEscape(() => setDrawer(false));
    const dev = getInputDevice();
    if (dev === 'keyboard' || dev === 'gamepad') {
      const el = drawerRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      if (el) focusEl(el);
    }
    return () => {
      off();
      const d = getInputDevice();
      const open = host?.querySelector<HTMLElement>('.nur-strip__open');
      if ((d === 'keyboard' || d === 'gamepad') && open) focusEl(open);
    };
  }, [drawer]);
  useEffect(() => {
    if (!drawerMode) {
      setDrawer(false);
      setAnimsOpen(false);
    }
  }, [drawerMode]);

  // The phone anims menu: Esc / Back / pad B and a tap outside close it; keyboard and pad focus
  // go into it (the current loop) and back to the toggle.
  useEffect(() => {
    if (!animsOpen) return undefined;
    const host = root.current;
    const tog = () => host?.querySelector<HTMLElement>('.nur-anim-tog') ?? null;
    const off = registerEscape(() => setAnimsOpen(false));
    const dev = getInputDevice();
    if (dev === 'keyboard' || dev === 'gamepad') {
      const box = animsRef.current;
      const el =
        box?.querySelector<HTMLElement>('[data-autofocus]') ??
        box?.querySelector<HTMLElement>('button');
      if (el) focusEl(el);
    }
    const outside = (e: PointerEvent) => {
      const tg = e.target as Node | null;
      if (animsRef.current?.contains(tg) || tog()?.contains(tg)) return;
      setAnimsOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      off();
      document.removeEventListener('pointerdown', outside, true);
      const d = getInputDevice();
      const el = tog();
      if ((d === 'keyboard' || d === 'gamepad') && el) focusEl(el);
    };
  }, [animsOpen]);

  const acts = (
    <div className="nur-acts">
      {drawerMode && openBtn}
      <Button
        kind={here ? 'secondary' : 'primary'}
        wide
        off={!rec}
        hint="inspect"
        onClick={toggleSquad}
      >
        {here ? t('nursery.leave') : t('nursery.take')}
      </Button>
      <span className="nur-acts__info">
        <Button
          icon="info"
          label={t('nursery.details')}
          onClick={() => {
            tapLight();
            setInfo(true);
          }}
        />
        {canMerge(rec) && (
          <span className="px-slot__dot">
            <Badge>!</Badge>
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div ref={root} className={`px nur nur--${layout}`} style={{ '--st': stPx } as CSSProperties}>
      {showcase}
      <div className="nur-side">
        {plateSide && plate}
        {layout === 'wide' ? (
          // the plate on top and the action bar at the bottom stay put; the squad and the
          // collection scroll between them as one list (a grid-only scroll was 0.2–1 row high)
          <div className="nur-side__mid">
            {squad}
            {collection}
          </div>
        ) : (
          <>
            {squad}
            {collection}
          </>
        )}
        {acts}
      </div>
      {drawer && drawerMode && (
        <div
          ref={drawerRef}
          className="px-panel px-panel--obsidian pxk-frame-obsidian nur-drawer"
          data-ui-layer=""
          role="dialog"
          aria-label={t('nursery.collection')}
        >
          {collHead}
          <Button
            kind="danger"
            size="sm"
            icon="down"
            label={t('common.close')}
            className="nur-drawer__close"
            onClick={() => {
              tapLight();
              setDrawer(false);
            }}
          />
          <Grid className="nur-grid">{cells}</Grid>
        </div>
      )}
      {info && (
        <Modal title={t(`pets.${sel}.name`)} sheet onClose={() => setInfo(false)}>
          <PetInfo id={sel} xp onJoy={() => setJoy((j) => j + 1)} />
        </Modal>
      )}
      {pick !== null && (
        <SquadPick
          thumb={thumb}
          onPicked={(id) => {
            const next = [...squadView];
            next[pick] = id;
            commitSquad(next);
            setSel(id);
            setJoy((j) => j + 1);
          }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
});

/** A collection cell — memoised: a switch re-renders the two cells whose selection changed, not
 *  all eighteen (the worst frame of a switch was 220–292 ms at 4×). The tip is built on demand. */
const NurCell = memo(function NurCell({
  id,
  rec,
  selected,
  along,
  size,
  onPick,
}: {
  id: PetId;
  rec: PetRec | undefined;
  selected: boolean;
  along: boolean;
  size: number;
  onPick: (id: PetId) => void;
}) {
  const t = useT();
  const d = petOf(id);
  return (
    <Slot
      rarity={d.rarity}
      locked={!rec}
      selected={selected}
      count={rec ? petLevelOf(rec.xp).level : undefined}
      corner={rec?.v ? '★' : undefined}
      dot={canMerge(rec) ? '!' : undefined}
      data-autofocus={selected ? '' : undefined}
      data-pet={id}
      aria-label={rec ? t(`pets.${id}.name`) : t('nursery.unknown')}
      tip={() => <SlotTip id={id} rec={rec} />}
      onClick={() => onPick(id)}
      onFocus={() => onPick(id)}
    >
      <PetArt id={id} size={size} v={petLook(rec)} ghost={!rec} still />
      {along && <Icon name="paw" className="nur-along" />}
    </Slot>
  );
});

/** A filled squad slot (memoised like the cells). */
const SquadSlot = memo(function SquadSlot({
  id,
  rec,
  selected,
  size,
  onPick,
}: {
  id: PetId;
  rec: PetRec;
  selected: boolean;
  size: number;
  onPick: (id: PetId) => void;
}) {
  const t = useT();
  return (
    <Slot
      rarity={petOf(id).rarity}
      selected={selected}
      count={petLevelOf(rec.xp).level}
      corner={rec.v ? '★' : undefined}
      dot={canMerge(rec) ? '!' : undefined}
      aria-label={t(`pets.${id}.name`)}
      data-pet={id}
      tip={() => <SlotTip id={id} rec={rec} />}
      onClick={() => onPick(id)}
      onFocus={() => onPick(id)}
    >
      <PetArt id={id} size={size} v={petLook(rec)} still />
    </Slot>
  );
});

/** Hover / long-press card of a collection slot: name in the rarity colour, level and perks. */
function SlotTip({ id, rec }: { id: PetId; rec: PetRec | undefined }) {
  const t = useT();
  const def = petOf(id);
  if (!rec)
    return (
      <span className="nur-tip" style={rc(def.rarity)}>
        <b>{t('nursery.unknown')}</b>
        <i>{t(`nursery.rarity.r${def.rarity}` as 'nursery.rarity.r0')}</i>
      </span>
    );
  const b = petBonus(id, rec);
  return (
    <span className="nur-tip" style={rc(def.rarity)}>
      <b>{t(`pets.${id}.name`)}</b>
      <i>
        {t(`nursery.rarity.r${def.rarity}` as 'nursery.rarity.r0')} ·{' '}
        {t('common.level', { n: petLevelOf(rec.xp).level })}
      </i>
      {def.stats.map((s) => (
        <span key={s}>{t(`nursery.role.${s}.text`, { v: pctV(b[s] ?? 0) })}</span>
      ))}
    </span>
  );
}

/** Details: lore, the stats table, experience, copies to gold + merge, skin, eggs it hatches
 *  from. `head` — the name block on top (the details column); `xp` — its own experience bar (the
 *  phone sheet). The stats are a table — picture, noun, value with one decimal — one line each;
 *  the full sentence is the row's tip. */
function PetInfo({
  id,
  head,
  xp,
  onJoy,
}: {
  id: PetId;
  head?: ReactNode;
  xp?: boolean;
  onJoy: () => void;
}) {
  const t = useT();
  const stPx = useStatPx();
  const p = useFinanceStore((s) => s.prison);
  const merge = useFinanceStore((s) => s.prisonPetMerge);
  const setSkin = useFinanceStore((s) => s.prisonPetSkin);
  const def = petOf(id);
  const rec = p.pets[id];
  const lv = petLevelOf(rec?.xp ?? 0);
  const b = rec ? petBonus(id, rec) : {};
  // Which eggs it hatches from: those with a chance for its rarity.
  const from = EGGS.filter((e) => eggChances(e.id)[def.rarity] > 0);
  // The species is picked evenly inside the rolled rarity (`rollEgg`), so one pet's chance is
  // the rarity's share divided by how many pets share it.
  const kin = PETS.filter((d) => d.rarity === def.rarity).length || 1;
  const lvText = t('common.level', { n: lv.level });
  let rows: ReactNode;
  if (!rec)
    rows = (
      <div className="nur-info__from">
        <span>{t('nursery.from')}</span>
        {from.map((e) => (
          <span key={e.id} className="nur-egg">
            <Icon name="egg" />
            <span>{t(`nursery.egg.${e.id}`)}</span>
            <b>
              {t('nursery.eggPct', {
                v: Math.round((eggChances(e.id)[def.rarity] / kin) * 1000) / 10,
              })}
            </b>
          </span>
        ))}
      </div>
    );
  else
    rows = (
      <>
        {xp && (
          <Bar
            value={lv.need ? lv.into / lv.need : 1}
            label={
              lv.need
                ? `${lvText} · ${fmtNum(lv.into)} / ${fmtNum(lv.need)}`
                : `${lvText} · ${t('nursery.lvMax')}`
            }
          />
        )}
        {rec.v < MERGE_NEED.length && (
          <div className="nur-info__merge">
            <span>
              {t('nursery.copies')}{' '}
              <b>
                {Math.min(rec.dup, MERGE_NEED[rec.v])}/{MERGE_NEED[rec.v]}
              </b>
            </span>
            <Bar tone="blue" value={rec.dup / MERGE_NEED[rec.v]} />
            {canMerge(rec) && (
              <Button
                kind="primary"
                wide
                onClick={() => {
                  primeAudio();
                  if (merge(id)) {
                    petMerge();
                    notifySuccess();
                    flashFrame('big');
                    burstConfetti(60, ['#ffd24a', '#fff3b0', '#ffffff']);
                    onJoy();
                  }
                }}
              >
                <Icon name="star" />
                {t('nursery.makeGold')}
              </Button>
            )}
          </div>
        )}
        {rec.v >= 1 && (
          <div className="nur-info__skin" role="radiogroup" aria-label={t('nursery.skin')}>
            <span>{t('nursery.skin')}</span>
            {[0, 1].map((s) => {
              const on = petLook(rec) === s;
              return (
                <Button
                  key={s}
                  size="sm"
                  kind={s ? 'primary' : 'secondary'}
                  on={on}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    if (on) return;
                    selectionChanged();
                    if (setSkin(id, s)) onJoy();
                  }}
                >
                  {s ? t('nursery.skinGold') : t('nursery.skinNormal')}
                </Button>
              );
            })}
          </div>
        )}
      </>
    );
  return (
    <div className="nur-info__body" style={{ ...rc(def.rarity), '--st': stPx } as CSSProperties}>
      {head && <div className="nur-info__grp">{head}</div>}
      <div className="nur-info__grp">
        <p className="nur-info__lore">{t(`pets.${id}.lore`)}</p>
        <div className="nur-info__roles">
          {def.stats.map((s) => {
            const full = rec ? t(`nursery.role.${s}.text`, { v: pctV(b[s] ?? 0) }) : undefined;
            return (
              <div key={s} className="nur-role" data-tip={full} aria-label={full}>
                <StatIcon stat={s} dim={!rec} />
                <span className="nur-role__k">{t(`nursery.stat.${s}`)}</span>
                <b className="px-num">{rec ? t('nursery.bonus', { v: pctV(b[s] ?? 0) }) : '—'}</b>
              </div>
            );
          })}
        </div>
      </div>
      <div className="nur-info__grp">{rows}</div>
    </div>
  );
}

/** Who goes to an empty squad place: owned pets not along yet, strongest first. */
function SquadPick({
  thumb,
  onPicked,
  onClose,
}: {
  thumb: number;
  onPicked: (id: PetId) => void;
  onClose: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const list = (Object.keys(p.pets) as PetId[])
    .filter((id) => !p.squad.includes(id))
    .sort((a, b) => petScore(b, p.pets[b]!) - petScore(a, p.pets[a]!));
  return (
    <Modal title={t('nursery.pick')} sheet onClose={onClose} width={160}>
      {list.length ? (
        <Grid className="nur-pick">
          {list.map((id, i) => {
            const r = p.pets[id]!;
            return (
              <Slot
                key={id}
                rarity={petOf(id).rarity}
                count={petLevelOf(r.xp).level}
                corner={r.v ? '★' : undefined}
                aria-label={t(`pets.${id}.name`)}
                data-autofocus={i === 0 ? '' : undefined}
                tip={() => <SlotTip id={id} rec={r} />}
                onClick={() => {
                  primeAudio();
                  selectionChanged();
                  onPicked(id);
                  petPat();
                  onClose();
                }}
              >
                <PetArt id={id} size={thumb} v={petLook(r)} still />
              </Slot>
            );
          })}
        </Grid>
      ) : (
        <p className="nur-empty">{t('nursery.allWithYou')}</p>
      )}
    </Modal>
  );
}
