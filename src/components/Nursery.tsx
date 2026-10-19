// Nursery — the «Отряд» and «Коллекция» tabs of the pets screen (`PetsTab`), N4 (19.10): the
// handoff LAYOUT on the dark kit (`@/ui-px/dark`), the forge's sibling. Squad: three compact
// places on top, then the selected pet on an octagon stage with its name ribbon, four facts as
// square tiles (power · bonus · level · copies) and the action bar. Collection: a grid of cards
// with a filter and a sort. LOOKING at a pet (`sel`) and TAKING it (`squad`) are different
// actions: a card only selects; «Взять с собой» takes; a full squad asks whom to leave home.
// Rules — `lib/pets.ts`; store actions — prisonSquadSet, prisonPetPat, prisonPetMerge, prisonPetSkin.

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useFinanceStore } from '@/store';
import { fmtNum, useT } from '@/i18n';
import { focusEl, getInputDevice, useAction } from '@/input';
import { registerEscape } from '@/lib/escape-stack';
import { PetArt, petArtSrc } from '@/components/PetArt';
import type { PetAnim } from '@/components/PetArt';
import { fromKeys, useBox } from '@/components/armory';
import type { ArmLayout } from '@/components/armory';
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
  isPetId,
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
import { Icon } from '@/ui-px';
import type { PxIconName } from '@/ui-px';
import { PxdButton, PxdPedestal, PxdPips, PxdRibbon, PxdSheet } from '@/ui-px/dark';
import './nursery.css';

export type NurTab = 'squad' | 'coll' | 'eggs';

/** Showcase moves: loops switch the base animation, one-shots play once and return. */
const ANIMS: { id: PetAnim; icon: PxIconName; loop: boolean }[] = [
  { id: 'idle', icon: 'paw', loop: true },
  { id: 'walk', icon: 'paws', loop: true },
  { id: 'happy', icon: 'heart', loop: false },
  { id: 'work', icon: 'star', loop: false },
  { id: 'attack', icon: 'claw', loop: false },
  { id: 'sleep', icon: 'zzz', loop: true },
];
const STATS: PetStat[] = ['loot', 'sell', 'dmg', 'token', 'luck', 'rate'];
type Sort = 'rarity' | 'level' | 'power';
type Filter = 'all' | 'owned' | 'missing';
const SORTS: Sort[] = ['rarity', 'level', 'power'];
const FILTERS: Filter[] = ['all', 'owned', 'missing'];
type SquadView = (PetId | null)[];

/** Bonus share → percent with ONE decimal — the one formatter of the screen (the old chips
 *  rounded to whole percent: «+1%» on the card against «+0,7%» in the details). */
const pctV = (x: number) => Math.round(x * 1000) / 10;
const rc = (r: number) => ({ '--rc': RARITIES[r]?.color }) as CSSProperties;
const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
/** A 48-art-px thumbnail at the biggest whole screen-dot scale not above `want` css px. */
const thumbPx = (want: number, dpr: number) =>
  (Math.max(1, Math.floor((want * dpr) / 48)) * 48) / dpr;

/** A baked 12 × 12 stat picture (`paint.ts` `STAT_ART`) at 12 art px of the UI. */
function StatIcon({ stat, dim }: { stat: PetStat | 'power'; dim?: boolean }) {
  return <i className={`nrs-st nrs-st--${stat}${dim ? ' is-dim' : ''}`} aria-hidden="true" />;
}

// ---- Decode before swap ------------------------------------------------------------------------
// The stage keeps the pet it shows until the picked one's strip is decoded (N3: no wrong-pet
// frames); the squad and the collection neighbours are decoded ahead of time.
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
        decoded.set(src, im);
        if (decoded.size > 30) decoded.delete(decoded.keys().next().value as string);
      });
    decoding.set(src, job);
  }
  return job;
}

/** The biggest pet frame that fits `w` × `h` with its feet `lift` px above the bottom, at a whole
 *  number of screen dots per art pixel (what `pxFit` draws — it may round up by 15 %). */
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

/** The squad as the places show it: a pet left home keeps its place empty, the next one taken
 *  fills the chosen / first empty place. The store keeps the plain list (`prisonSquadSet`). */
const padSquad = (squad: PetId[], n: number): SquadView =>
  Array.from({ length: n }, (_, i) => squad[i] ?? null);
const sameList = (a: readonly (PetId | null)[], b: readonly PetId[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// ---- Fitting a line to the kit's type steps (as the forge: nothing shrinks freely) ------------
let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of one line of `text` in the CSS `font` (0 without canvas). */
function textW(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
/** The px size of a dark-kit type var (`--pd-fs-sm` …) inside `el`. */
function fsOf(el: HTMLElement, v: string): number {
  const probe = document.createElement('i');
  probe.style.cssText = `position:absolute;visibility:hidden;font-size:var(${v})`;
  el.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize) || 0;
  probe.remove();
  return px;
}
const STEPS = ['--pd-fs-xl', '--pd-fs-lg', '--pd-fs', '--pd-fs-sm'] as const;

// Latin vowels of the 7 languages + Cyrillic а е ё и о у ы э ю я (escaped: the i18n guard)
const VOWEL =
  /[aeiouyäöüéèêëàâîïôûùíóúıаеёиоуыэюя]/i;
/** Soft hyphens at syllable breaks of a long word (as the forge's tiles): a card name breaks
 *  «медве-жатник» in a 90-px cell, never «медвежатни-к» or out of the cell. */
function syl(text: string): string {
  const isV = (ch: string | undefined) => !!ch && VOWEL.test(ch);
  // a hyphen or a space is a break already: the parts of «Крот-забойщик» stay whole unless long
  const parts = text.split(/(\s+|-)/);
  const min = parts.length > 1 ? 9 : 7;
  return parts
    .map((w) => {
      if (w.length < min) return w;
      let out = '';
      for (let i = 0; i < w.length; i++) {
        let j = i;
        while (j > 0 && !isV(w[j - 1])) j--;
        let k = i;
        while (k < w.length && !isV(w[k])) k++;
        const n = k - j;
        const ok =
          !isV(w[i]) &&
          !/[ьъйЬЪЙ-]/.test(w[i]) &&
          j > 0 &&
          k < w.length &&
          i >= 2 &&
          w.length - i >= 3 &&
          i === (n === 1 ? j : n === 2 ? j + 1 : k - 1);
        out += (ok ? '­' : '') + w[i];
      }
      return out;
    })
    .join('');
}

/** A card name's box: inner width and the two fonts it may use (measured once per layout). */
type NameFit = { room: number; sm: string; xs: string };
/** Lines `text` takes in `room` px with breaks only at spaces and after hyphens (∞ if a part
 *  alone is wider than the room). */
function lineCount(text: string, font: string, room: number): number {
  const toks = text.match(/[^\s-]+-?|-|\s+/g) ?? [text];
  const gap = textW(' ', font);
  let n = 1;
  let line = 0;
  let space = false;
  for (const tk of toks) {
    if (/^\s+$/.test(tk)) {
      space = true;
      continue;
    }
    const w = textW(tk, font);
    if (w > room) return Infinity;
    if (line === 0) line = w;
    else if (line + (space ? gap : 0) + w <= room) line += (space ? gap : 0) + w;
    else {
      n++;
      line = w;
    }
    space = false;
  }
  return n;
}
/** A card name that fits two lines: whole words at the label size, else whole words one step
 *  smaller, else syllable breaks at the smaller size. → [text, small]. */
function fitName(name: string, fit: NameFit | null): [string, boolean] {
  if (!fit || fit.room <= 0) return [syl(name), false];
  if (lineCount(name, fit.sm, fit.room) <= 2) return [name, false];
  if (lineCount(name, fit.xs, fit.room) <= 2) return [name, true];
  return [syl(name), true];
}

/** Memoised: the camp re-renders every second; `say`, `onSel`, `onTab` from `PetsTab` are stable. */
export const Nursery = memo(function Nursery({
  tab,
  sel,
  onSel,
  onTab,
  say,
  layout,
  u,
}: {
  tab: 'squad' | 'coll';
  sel: PetId;
  onSel: (id: PetId) => void;
  onTab: (tab: NurTab) => void;
  say: (text: string) => void;
  layout: ArmLayout;
  u: number;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const merge = useFinanceStore((s) => s.prisonPetMerge);
  const one = layout === 'one';
  // Phone portrait shows the card on the squad tab only; wider formats beside both lists.
  const card = !one || tab === 'squad';
  const root = useRef<HTMLDivElement>(null);
  const dpr = dprNow();

  const owned = PETS.filter((d) => p.pets[d.id]).length;
  const [base, setBase] = useState<PetAnim>('idle');
  const [show, setShow] = useState<{ anim: PetAnim; k: number } | null>(null);
  const [joy, setJoy] = useState(0);
  const [xpPop, setXpPop] = useState(0);
  const [sort, setSort] = useState<Sort>('rarity');
  const [filter, setFilter] = useState<Filter>('all');
  /** «Choose for this place» mode, set by an empty place: the collection shows owned pets, a
   *  card selects, «Взять с собой» puts the pet into THIS place. */
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  const [replace, setReplace] = useState(false);
  const [animsOpen, setAnimsOpen] = useState(false);
  const animsRef = useRef<HTMLDivElement>(null);

  const rec = p.pets[sel];
  const slots = Math.min(3, squadSlots(p.rank, p.prestige));
  const here = p.squad.includes(sel);

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
    onSel(id);
    setBase('idle');
    setShow(null);
  };
  const selectRef = useRef(select);
  selectRef.current = select;
  // Stable for the memoised cards. Phone portrait: a card opens the squad tab with the pet's
  // details (the handoff's flow); wider formats show the details beside the grid.
  const oneRef = useRef(one);
  oneRef.current = one;
  const onCard = useCallback(
    (id: PetId) => {
      selectRef.current(id);
      if (oneRef.current) onTab('squad');
    },
    [onTab],
  );
  const onSlot = useCallback((id: PetId) => selectRef.current(id), []);

  const take = (id: PetId, slot: number) => {
    const next = [...squadView];
    next[slot] = id;
    commitSquad(next);
    setPickSlot(null);
    petPat();
    setJoy((j) => j + 1);
  };
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
    const free =
      pickSlot != null && pickSlot < slots && !squadView[pickSlot]
        ? pickSlot
        : squadView.indexOf(null);
    if (free >= 0) take(sel, free);
    // A full squad: an explicit choice of who goes home (nothing is replaced silently).
    else setReplace(true);
  };
  useAction(['inspect'], () => toggleSquad(), { scope: root });

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

  // ---- Stage: the room is measured; the pedestal and the pet size follow the room only, so
  // another pet never moves anything (owner: «чтобы картинка не дёргалась»).
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useBox(stageRef, card);
  const pb = 17 * u; // pedestal bottom: over the ribbon that covers the stage's lower 15u
  const pw = Math.max(15, Math.round((Math.min(stage.w * 0.8, (stage.h - pb) * 0.8) * 0.75) / u) | 1);
  const ph = Math.max(7, Math.round(pw / 6) | 1);
  const lift = pb + Math.round(ph / 2) * u;
  const artFor = (id: PetId) => {
    const r = p.pets[id];
    const s = stage.w && stage.h ? fitPet(id, stage.w - 2 * u, stage.h, dpr, lift) : 0;
    return { size: s, src: s ? petArtSrc(id, s, r ? petLook(r) : 0, !r) : '' };
  };
  const stageSel = useDeferredValue(sel);
  const want = artFor(stageSel);
  const shownRef = useRef<PetId>(stageSel);
  const [, setDecodedTick] = useState(0);
  const [cold, setCold] = useState<PetId | null>(null);
  const ready = !want.src || decoded.has(want.src);
  if (ready || cold === stageSel) shownRef.current = stageSel;
  const stageId = shownRef.current;
  const thumbOnly = !ready && stageId === stageSel && !!p.pets[stageSel];
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    void decodeArt(want.src).then(() => live && setDecodedTick((n) => n + 1));
    const late = window.setTimeout(() => live && setCold(stageSel), 100);
    return () => {
      live = false;
      window.clearTimeout(late);
    };
  }, [ready, want.src, stageSel]);
  const artRef = useRef(artFor);
  artRef.current = artFor;
  const warm = useCallback((id: PetId) => {
    const a = artRef.current(id);
    if (a.src) void decodeArt(a.src);
  }, []);
  const warmFrom = (e: ReactPointerEvent) => {
    const id = (e.target as Element).closest?.('[data-pet]')?.getAttribute('data-pet');
    if (id && isPetId(id) && id !== sel) warm(id);
  };
  useEffect(() => {
    if (!stage.w || !stage.h) return undefined;
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
  }, [sel, list, p.squad, stage.w, stage.h]);

  const sdef = petOf(stageId);
  const srec = p.pets[stageId];
  const slv = petLevelOf(srec?.xp ?? 0);
  const sHere = p.squad.includes(stageId);
  const size = stageId === stageSel ? want.size : artFor(stageId).size;
  const phBox = PET_PX[stageId]?.box ?? 48;
  const phS = (Math.max(1, Math.floor((size * dpr) / phBox)) * phBox) / dpr;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const name = t(`pets.${stageId}.name`);
  // The ribbon: the biggest kit step at which the whole name fits its straight part.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFonts((x) => x + 1)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useLayoutEffect(() => {
    const h = stageRef.current?.parentElement?.querySelector<HTMLElement>('.nrs-name > h2');
    if (!h || !stage.w) return;
    const cs = getComputedStyle(h);
    const room = stage.w - 30 * u;
    const steps = STEPS.map((v) => fsOf(h, v));
    const s =
      steps.find((px) => textW(name, `${cs.fontWeight} ${px}px ${cs.fontFamily}`) <= room) ??
      steps[3];
    h.style.fontSize = `${s}px`;
  }, [name, stage.w, u, fonts]);

  const petEl = (
    <span
      key={stageId}
      className="nrs-pet"
      style={{ left: snap((stage.w - size) / 2), bottom: snap(lift), width: size, height: size }}
    >
      {size > 0 && thumbOnly ? (
        <img
          className="nrs-ph"
          src={petArtSrc(stageId, size, petLook(srec), true)}
          alt=""
          draggable={false}
          style={{ width: phS, height: phS, left: snap((size - phS) / 2) }}
        />
      ) : (
        size > 0 && (
          <PetArt
            id={stageId}
            size={size}
            v={petLook(srec)}
            ghost={!srec}
            anim={base}
            joy={joy}
            play={show}
            focusable
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
        )
      )}
    </span>
  );

  // Six moves (all six always; a pet not hatched yet: greyed, a tap says why) in a 3 × 2 menu
  // over the stage, opened from the action bar's ▶.
  const animBtns = ANIMS.map((a) => {
    const word = t(`nursery.anim.${a.id}`);
    const on = !!srec && a.loop && base === a.id && !show;
    return (
      <PxdButton
        key={a.id}
        frame={on ? 'sel' : 'panel'}
        className="nrs-anim"
        off={!srec}
        aria-label={word}
        aria-pressed={a.loop ? on : undefined}
        data-tip={word}
        data-autofocus={on ? '' : undefined}
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
      >
        <Icon name={a.icon} />
        <span>{word}</span>
      </PxdButton>
    );
  });
  useEffect(() => {
    if (!animsOpen) return undefined;
    const host = root.current;
    const tog = () => host?.querySelector<HTMLElement>('.nrs-bar__anims') ?? null;
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
  useEffect(() => {
    if (!card) setAnimsOpen(false);
  }, [card]);

  // ---- The card: stage (pet, pedestal, rarity / power / «в отряде» marks), name ribbon --------
  const showEl = card && (
    <section className="nrs-show" style={rc(sdef.rarity)}>
      <div ref={stageRef} className="nrs-stage pxd-f pxd-f--oct">
        <i className="nrs-glow" />
        {size > 0 && (
          <PxdPedestal
            w={pw}
            className="nrs-ped"
            style={{ left: Math.round((stage.w - pw * u) / 2 / u) * u, bottom: pb }}
          />
        )}
        {petEl}
        <span className="nrs-marks">
          <span className="nrs-marks__l">
            <span className="nrs-rar pxd-chip">
              <i className="nrs-dot" aria-hidden="true" />
              {t(`nursery.rarity.r${sdef.rarity}` as 'nursery.rarity.r0')}
              {!!srec?.v && (
                <span className="nrs-gold" role="img" aria-label={t('nursery.gold')}>
                  <Icon name="star" />
                </span>
              )}
            </span>
            <span
              className={`nrs-pow pxd-chip${srec ? '' : ' is-hidden'}`}
              data-tip={t('nursery.powerTip')}
              aria-label={`${t('nursery.power')} ${srec ? fmtNum(petScore(stageId, srec) * 10) : ''}`}
            >
              <StatIcon stat="power" />
              <b className="px-num">{srec ? fmtNum(petScore(stageId, srec) * 10) : '0'}</b>
            </span>
          </span>
          {sHere && (
            <span className="nrs-along pxd-chip">
              <Icon name="check" />
              {t('nursery.along')}
            </span>
          )}
        </span>
        {xpPop > 0 && (
          <b key={xpPop} className="nrs-xp">
            {t('nursery.patXp', { n: PAT_XP })}
          </b>
        )}
        {animsOpen && (
          <div
            ref={animsRef}
            className="nrs-anims pxd-f pxd-f--panel"
            role="toolbar"
            aria-label={t('nursery.anims')}
            data-ui-layer=""
          >
            {animBtns}
          </div>
        )}
      </div>
      <PxdRibbon className="nrs-name" style={{ '--nlen': Math.max(8, name.length) } as CSSProperties}>
        {name}
      </PxdRibbon>
    </section>
  );

  // ---- Four square facts: power · bonus · level · copies to gold ------------------------------
  const sb = srec ? petBonus(stageId, srec) : {};
  const roles = [...sdef.stats].sort(
    (a, b) => (sb[b] ?? 0) - (sb[a] ?? 0) || STATS.indexOf(a) - STATS.indexOf(b),
  );
  const roleTip = roles
    .map((s) => (srec ? t(`nursery.role.${s}.text`, { v: pctV(sb[s] ?? 0) }) : t(`nursery.stat.${s}`)))
    .join(' · ');
  const need = srec && srec.v < MERGE_NEED.length ? MERGE_NEED[srec.v] : 0;
  const mergeOk = canMerge(srec);
  const xpText = !srec ? '—' : !slv.need ? t('nursery.lvMax') : `${fmtNum(slv.into)} / ${fmtNum(slv.need)}`;
  const openInfo = () => {
    tapLight();
    setInfo(true);
  };
  const doMerge = () => {
    primeAudio();
    if (merge(stageId)) {
      petMerge();
      notifySuccess();
      flashFrame('big');
      burstConfetti(60, ['#ffd24a', '#fff3b0', '#ffffff']);
      setJoy((j) => j + 1);
    }
  };
  const statsEl = card && (
    <div className="nrs-stats">
      <PxdButton
        className="nrs-stat is-bonus"
        data-tip={roleTip}
        aria-label={`${roleTip}. ${t('nursery.details')}`}
        onClick={openInfo}
      >
        <span className="nrs-roles">
          {roles.slice(0, roles.length > 2 ? 1 : 2).map((s) => (
            <span key={s} className="nrs-role">
              <StatIcon stat={s} dim={!srec} />
              <b className="px-num">{srec ? t('nursery.bonus', { v: pctV(sb[s] ?? 0) }) : '—'}</b>
            </span>
          ))}
          {roles.length > 2 && <b className="nrs-more">+{roles.length - 1}</b>}
        </span>
        <span className="nrs-stat__l">
          {roles.length === 1 ? t(`nursery.stat.${roles[0]}`) : t('nursery.bonusL')}
        </span>
      </PxdButton>
      <div className="nrs-stat pxd-f pxd-f--panel is-level" aria-label={`${t('common.level', { n: slv.level })} · ${xpText}`}>
        <b className="nrs-stat__n">{srec ? t('common.level', { n: slv.level }) : '—'}</b>
        <PxdPips n={10} on={srec ? (slv.need ? Math.floor((10 * slv.into) / slv.need) : 10) : 0} />
        <span className="nrs-stat__l px-num">{xpText}</span>
      </div>
      <PxdButton
        frame={mergeOk ? 'act' : 'panel'}
        className={`nrs-stat is-copies${mergeOk ? ' is-merge' : ''}`}
        aria-label={
          mergeOk
            ? t('nursery.makeGold')
            : srec?.v
              ? t('nursery.gold')
              : `${t('nursery.copies')} ${srec ? Math.min(srec.dup, need) : 0} / ${need || MERGE_NEED[0]}`
        }
        onClick={() => {
          if (mergeOk) doMerge();
          else openInfo();
        }}
      >
        {srec?.v ? (
          <>
            <span className="nrs-stat__star">
              <Icon name="star" />
            </span>
            <span className="nrs-stat__l">{t('nursery.gold')}</span>
          </>
        ) : (
          <>
            <b className="nrs-stat__n px-num">
              {srec ? Math.min(srec.dup, need) : 0} / {need || MERGE_NEED[0]}
            </b>
            <PxdPips n={need || MERGE_NEED[0]} on={srec ? Math.min(srec.dup, need) : 0} ok={mergeOk} />
            <span className="nrs-stat__l">{mergeOk ? t('nursery.makeGold') : t('nursery.toGold')}</span>
          </>
        )}
      </PxdButton>
    </div>
  );

  // ---- Action bar: moves · take / leave · details ----------------------------------------------
  const barEl = card && (
    <div className="nrs-bar">
      <PxdButton
        className="nrs-bar__sq nrs-bar__anims"
        aria-label={t('nursery.anims')}
        data-tip={t('nursery.anims')}
        aria-expanded={animsOpen}
        frame={animsOpen ? 'sel' : 'panel'}
        onClick={() => {
          tapLight();
          setAnimsOpen((o) => !o);
        }}
      >
        <Icon name="play" />
      </PxdButton>
      <PxdButton
        frame="act"
        off={!rec}
        hint="inspect"
        className={`nrs-cta${here ? ' is-leave' : ''}`}
        onClick={toggleSquad}
      >
        <span>{here ? t('nursery.leave') : t('nursery.take')}</span>
      </PxdButton>
      <PxdButton
        className="nrs-bar__sq"
        aria-label={t('nursery.details')}
        data-tip={t('nursery.details')}
        onClick={openInfo}
      >
        <Icon name="info" />
        {mergeOk && <em className="nrs-badge">!</em>}
      </PxdButton>
    </div>
  );

  // ---- What the whole squad gives: all six stats in a fixed grid (a missing one keeps its cell) --
  const sumEl = (
    <div className="nrs-sum" role="group" aria-label={t('nursery.squadHint')}>
      {STATS.map((k) => {
        const v = squadBonus[k] ?? 0;
        const full = v ? t(`nursery.role.${k}.text`, { v: pctV(v) }) : t(`nursery.stat.${k}`);
        return (
          <span
            key={k}
            className={`nrs-sum__c pxd-f pxd-f--well${v ? '' : ' is-none'}`}
            data-tip={full}
            aria-label={v ? full : `${t(`nursery.stat.${k}`)} —`}
          >
            <StatIcon stat={k} dim={!v} />
            <b className="px-num">{v ? t('nursery.bonus', { v: pctV(v) }) : '—'}</b>
          </span>
        );
      })}
    </div>
  );

  // ---- Squad places --------------------------------------------------------------------------
  // a wide screen stacks the three places in the list column: the art follows the measured place
  const slotsRef = useRef<HTMLDivElement>(null);
  const sq = useBox(slotsRef, tab === 'squad');
  const stacked = layout === 'three' && sq.h > sq.w * 1.5;
  const big = stacked
    ? thumbPx(Math.max(34 * u, Math.min(sq.w, (sq.h - 8 * u) / 3) * 0.8), dpr)
    : thumbPx(one ? 26 * u : 34 * u, dpr);
  const squadEl = (
    <section className="nrs-squad" aria-label={t('nursery.squad')}>
      <div className="nrs-h">
        <h2>{t('nursery.squadHint')}</h2>
        <span className="px-num">{t('eggs.someOf', { a: p.squad.length, b: slots })}</span>
      </div>
      <div ref={slotsRef} className="nrs-slots">
        {[0, 1, 2].map((i) => {
          if (i >= slots) {
            const why = i === 1 ? t('nursery.lockRank', { rank: rankLetter(SQUAD_RANK2) }) : t('nursery.lockPrestige');
            const tip = i === 1 ? t('nursery.lockRankTip', { rank: rankLetter(SQUAD_RANK2) }) : t('nursery.lockPrestigeTip');
            return (
              <PxdButton
                key={i}
                frame="well"
                className="nrs-slot is-lock"
                off
                aria-label={tip}
                data-tip={tip}
                onClick={() => {
                  tapLight();
                  say(tip);
                }}
              >
                <Icon name="lock" />
                <span>{why}</span>
              </PxdButton>
            );
          }
          const id = squadView[i];
          const r = id ? p.pets[id] : undefined;
          if (!id || !r)
            return (
              <PxdButton
                key={i}
                frame={pickSlot === i ? 'sel' : 'well'}
                className="nrs-slot is-add"
                aria-label={t('nursery.pick')}
                data-tip={t('nursery.pick')}
                onClick={() => {
                  tapLight();
                  if (!owned) {
                    say(t('nursery.hatchFirst'));
                    return;
                  }
                  setPickSlot(i);
                  setFilter('owned');
                  if (one) onTab('coll');
                }}
              >
                <Icon name="plus" />
              </PxdButton>
            );
          return <SquadSlot key={i} id={id} rec={r} selected={sel === id} size={big} onPick={onSlot} />;
        })}
      </div>
      {layout === 'two' && sumEl}
    </section>
  );

  // Fit the grid: the name box (→ `fitName` on every card) and the rarity words — one size for
  // all cards, then a smaller one, then the dot alone (the word stays in the aria-label).
  const [nameFit, setNameFit] = useState<NameFit | null>(null);
  const gridKey = list.map((d) => d.id).join();
  useLayoutEffect(() => {
    const grid = root.current?.querySelector<HTMLElement>('.nrs-grid');
    if (!grid) return;
    const fit = () => {
      const nm = grid.querySelector<HTMLElement>('.nrs-card__nm');
      if (nm) {
        const cs = getComputedStyle(nm);
        const f = (v: string) => `${cs.fontWeight} ${fsOf(nm, v)}px ${cs.fontFamily}`;
        const next = { room: nm.clientWidth, sm: f('--pd-fs-sm'), xs: f('--pd-fs-xs') };
        setNameFit((o) => (o && o.room === next.room && o.sm === next.sm && o.xs === next.xs ? o : next));
      }
      const rars = [...grid.querySelectorAll<HTMLElement>('.nrs-card__rar')];
      const over = () => rars.some((r) => r.scrollWidth > r.clientWidth + 0.5);
      grid.classList.remove('is-rar-sm', 'is-rar-dot');
      if (over()) grid.classList.add('is-rar-sm');
      if (over()) grid.classList.add('is-rar-dot');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [tab, layout, fonts, gridKey, t]);
  // a name that needs three lines even with syllable breaks («Panzerknacker-Waschbär» at 320 px):
  // every card's name box takes three small lines, so the rows stay equal
  useLayoutEffect(() => {
    const grid = root.current?.querySelector<HTMLElement>('.nrs-grid');
    if (!grid) return;
    grid.classList.remove('is-3l');
    const over = [...grid.querySelectorAll<HTMLElement>('.nrs-card__nm')].some(
      (n) => n.scrollHeight > n.clientHeight + 1,
    );
    grid.classList.toggle('is-3l', over);
  }, [nameFit, tab, layout, gridKey, t]);

  // ---- Collection ------------------------------------------------------------------------------
  const cardArt = thumbPx(one ? 28 * u : 24 * u, dpr);
  const zooText = `${t('nursery.zooL')}: ${t('nursery.zoo', { v: pctV(zoo) })}`;
  const collEl = (
    <section className="nrs-coll" aria-label={t('nursery.collection')}>
      <div className="nrs-coll__head">
        <div className="nrs-h">
          <h2>
            {t('nursery.collection')}{' '}
            <span className="px-num">{t('eggs.someOf', { a: owned, b: PETS.length })}</span>
          </h2>
        </div>
        {pickSlot != null ? (
          <div className="nrs-pickbar" role="status">
            <span>{t('nursery.pickHint')}</span>
            <PxdButton
              className="nrs-pickbar__x"
              aria-label={t('common.cancel')}
              onClick={() => {
                tapLight();
                setPickSlot(null);
                setFilter('all');
              }}
            >
              <Icon name="x" />
            </PxdButton>
          </div>
        ) : null}
        <div className="nrs-tools">
          <PxdButton
            className="nrs-tool"
            aria-label={`${t('nursery.filterLabel')}: ${t(`nursery.filter.${filter}`)}`}
            onClick={() => {
              tapLight();
              setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length]);
            }}
          >
            <Icon name="filter" />
            <span className="nrs-tool__k">{t('nursery.filterLabel')}</span>
            <b>{t(`nursery.filter.${filter}`)}</b>
          </PxdButton>
          <PxdButton
            className="nrs-tool"
            aria-label={`${t('nursery.sortLabel')}: ${t(`nursery.sort.${sort}`)}`}
            onClick={() => {
              tapLight();
              setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);
            }}
          >
            <Icon name="sort" />
            <span className="nrs-tool__k">{t('nursery.sortLabel')}</span>
            <b>{t(`nursery.sort.${sort}`)}</b>
          </PxdButton>
          {/* the collection bonus: a tile like its neighbours, the sentence on tap (touch has no tips) */}
          <PxdButton
            frame="well"
            className={`nrs-tool nrs-zoo${zoo > 0 ? '' : ' is-none'}`}
            data-tip={zooText}
            aria-label={zooText}
            onClick={() => {
              tapLight();
              say(zooText);
            }}
          >
            <StatIcon stat="sell" />
            <b className="px-num">{t('nursery.bonus', { v: pctV(zoo) })}</b>
          </PxdButton>
        </div>
      </div>
      <div className="nrs-grid">
        {list.map((d) => (
          <NurCard
            key={d.id}
            id={d.id}
            rec={p.pets[d.id]}
            selected={sel === d.id}
            along={p.squad.includes(d.id)}
            size={cardArt}
            fit={nameFit}
            onPick={onCard}
          />
        ))}
      </div>
    </section>
  );

  // Fit: the filter / sort keys and the level tile's «into / need» go when they don't fit.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const tools = el.querySelector<HTMLElement>('.nrs-tools');
    if (tools) {
      // key words go, then the icons, then the value takes the small size
      tools.classList.remove('is-tight', 'is-tight2', 'is-tight3');
      const over = () => [...tools.children].some((b) => b.scrollWidth > b.clientWidth + 0.5);
      for (const c of ['is-tight', 'is-tight2', 'is-tight3']) if (over()) tools.classList.add(c);
    }
    const lv = el.querySelector<HTMLElement>('.nrs-stat.is-level');
    const lvL = lv?.querySelector<HTMLElement>('.nrs-stat__l');
    if (lv && lvL) {
      lv.classList.remove('is-tight');
      lv.classList.toggle(
        'is-tight',
        lvL.scrollWidth > lvL.clientWidth + 0.5 ||
          lvL.scrollHeight > lvL.clientHeight + 1.5 ||
          lv.scrollWidth > lv.clientWidth + 0.5,
      );
    }
  }, [tab, filter, sort, xpText, stage.w, fonts, layout, t, pickSlot, zoo]);

  return (
    <div ref={root} className="nrs-nur" onPointerDownCapture={warmFrom}>
      {tab === 'squad' ? squadEl : collEl}
      {card && (
        <div className="nrs-main">
          {showEl}
          {statsEl}
        </div>
      )}
      {card && (
        <div className="nrs-side">
          {layout === 'three' && sumEl}
          {barEl}
        </div>
      )}
      {info && (
        <PxdSheet
          title={t(`pets.${sel}.name`)}
          sub={t(`nursery.rarity.r${petOf(sel).rarity}` as 'nursery.rarity.r0')}
          closeLabel={t('common.close')}
          width={200}
          className="nrs-sheet"
          onClose={() => setInfo(false)}
        >
          <PetInfo id={sel} onJoy={() => setJoy((j) => j + 1)} />
        </PxdSheet>
      )}
      {replace && (
        <PxdSheet
          title={t('nursery.replaceTitle')}
          sub={t('nursery.replaceHint', { name: t(`pets.${sel}.name`) })}
          closeLabel={t('common.close')}
          width={200}
          className="nrs-sheet"
          onClose={() => setReplace(false)}
        >
          <div className="nrs-rep">
            {squadView.map((id, i) =>
              id ? (
                <PxdButton
                  key={id}
                  className="nrs-rep__b"
                  data-autofocus={i === squadView.length - 1 ? '' : undefined}
                  style={rc(petOf(id).rarity)}
                  onClick={() => {
                    setReplace(false);
                    take(sel, i);
                  }}
                >
                  <PetArt id={id} size={thumbPx(24 * u, dpr)} v={petLook(p.pets[id])} still />
                  <b>{t(`pets.${id}.name`)}</b>
                  <small>{t('nursery.leave')}</small>
                </PxdButton>
              ) : null,
            )}
          </div>
        </PxdSheet>
      )}
    </div>
  );
});

/** A collection card — memoised: a switch re-renders the two cards whose selection changed. */
const NurCard = memo(function NurCard({
  id,
  rec,
  selected,
  along,
  size,
  fit,
  onPick,
}: {
  id: PetId;
  rec: PetRec | undefined;
  selected: boolean;
  along: boolean;
  size: number;
  fit: NameFit | null;
  onPick: (id: PetId) => void;
}) {
  const t = useT();
  const d = petOf(id);
  const nm = rec ? t(`pets.${id}.name`) : t('nursery.unknown');
  const [nmText, nmSmall] = useMemo(() => fitName(nm, fit), [nm, fit]);
  const rar = t(`nursery.rarity.r${d.rarity}` as 'nursery.rarity.r0');
  return (
    <PxdButton
      frame={selected ? 'sel' : 'panel'}
      className={`nrs-card${rec ? '' : ' is-missing'}`}
      style={rc(d.rarity)}
      data-pet={id}
      data-autofocus={selected ? '' : undefined}
      aria-label={`${nm}, ${rar}${rec ? `, ${t('common.level', { n: petLevelOf(rec.xp).level })}` : ''}${along ? `, ${t('nursery.along')}` : ''}`}
      aria-pressed={selected}
      onClick={(e) => {
        // a second tap on the selected card does nothing on touch; keys always act
        if (selected && !fromKeys(e)) return;
        onPick(id);
      }}
    >
      <span className="nrs-card__art">
        <PetArt id={id} size={size} v={petLook(rec)} ghost={!rec} still />
        {!rec && <Icon name="lock" className="nrs-card__lock" />}
      </span>
      <b className={`nrs-card__nm${nmSmall ? ' is-small' : ''}`}>{nmText}</b>
      <span className="nrs-card__rar">
        <i className="nrs-dot" aria-hidden="true" />
        <span>{rar}</span>
      </span>
      <span className="nrs-card__lv px-num">{rec ? t('common.level', { n: petLevelOf(rec.xp).level }) : ' '}</span>
      {along && (
        <em className="nrs-card__tick" aria-hidden="true">
          <Icon name="check" />
        </em>
      )}
      {!!rec?.v && (
        <em className="nrs-card__gold" aria-hidden="true">
          <Icon name="star" />
        </em>
      )}
      {canMerge(rec) && <em className="nrs-badge">!</em>}
    </PxdButton>
  );
});

/** A filled squad place (memoised like the cards). */
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
    <PxdButton
      frame={selected ? 'sel' : 'panel'}
      className="nrs-slot is-pet"
      style={rc(petOf(id).rarity)}
      data-pet={id}
      aria-label={`${t(`pets.${id}.name`)}, ${t('common.level', { n: petLevelOf(rec.xp).level })}`}
      aria-pressed={selected}
      onClick={() => onPick(id)}
    >
      <PetArt id={id} size={size} v={petLook(rec)} still />
      <b className="nrs-slot__lv px-num">{petLevelOf(rec.xp).level}</b>
      {!!rec.v && (
        <em className="nrs-card__gold" aria-hidden="true">
          <Icon name="star" />
        </em>
      )}
    </PxdButton>
  );
});

/** Details: lore, the stats table, experience, copies to gold + merge, skin, the eggs it hatches
 *  from. One line per stat: picture, noun, value with one decimal; the sentence is its tip. */
function PetInfo({ id, onJoy }: { id: PetId; onJoy: () => void }) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const merge = useFinanceStore((s) => s.prisonPetMerge);
  const setSkin = useFinanceStore((s) => s.prisonPetSkin);
  const def = petOf(id);
  const rec = p.pets[id];
  const lv = petLevelOf(rec?.xp ?? 0);
  const b = rec ? petBonus(id, rec) : {};
  const from = EGGS.filter((e) => eggChances(e.id)[def.rarity] > 0);
  // The species is picked evenly inside the rolled rarity (`rollEgg`).
  const kin = PETS.filter((d) => d.rarity === def.rarity).length || 1;
  let rows: ReactNode;
  if (!rec)
    rows = (
      <div className="nrs-info__grp">
        <h3>{t('nursery.from')}</h3>
        {from.map((e) => (
          <div key={e.id} className="nrs-info__row">
            <Icon name="egg" />
            <span>{t(`nursery.egg.${e.id}`)}</span>
            <b className="px-num">
              {t('nursery.eggPct', {
                v: Math.round((eggChances(e.id)[def.rarity] / kin) * 1000) / 10,
              })}
            </b>
          </div>
        ))}
      </div>
    );
  else
    rows = (
      <>
        <div className="nrs-info__grp">
          <div className="nrs-info__row">
            <span>{t('common.level', { n: lv.level })}</span>
            <b className="px-num">
              {lv.need ? `${fmtNum(lv.into)} / ${fmtNum(lv.need)}` : t('nursery.lvMax')}
            </b>
          </div>
          <PxdPips n={10} on={lv.need ? Math.floor((10 * lv.into) / lv.need) : 10} />
        </div>
        {rec.v < MERGE_NEED.length && (
          <div className="nrs-info__grp">
            <div className="nrs-info__row">
              <span>{t('nursery.copies')}</span>
              <b className="px-num">
                {Math.min(rec.dup, MERGE_NEED[rec.v])} / {MERGE_NEED[rec.v]}
              </b>
            </div>
            <PxdPips n={MERGE_NEED[rec.v]} on={Math.min(rec.dup, MERGE_NEED[rec.v])} ok={canMerge(rec)} />
            {canMerge(rec) && (
              <PxdButton
                frame="act"
                className="nrs-info__act"
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
              </PxdButton>
            )}
          </div>
        )}
        {rec.v >= 1 && (
          <div className="nrs-info__grp nrs-info__skin" role="radiogroup" aria-label={t('nursery.skin')}>
            <h3>{t('nursery.skin')}</h3>
            <div>
              {[0, 1].map((s) => {
                const on = petLook(rec) === s;
                return (
                  <PxdButton
                    key={s}
                    frame={on ? 'sel' : 'panel'}
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      if (on) return;
                      selectionChanged();
                      if (setSkin(id, s)) onJoy();
                    }}
                  >
                    {s ? <Icon name="star" /> : null}
                    {s ? t('nursery.skinGold') : t('nursery.skinNormal')}
                  </PxdButton>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  return (
    <div className="nrs-info" style={rc(def.rarity)}>
      <p className="nrs-info__lore">{t(`pets.${id}.lore`)}</p>
      <div className="nrs-info__grp">
        {def.stats.map((s) => {
          const full = rec ? t(`nursery.role.${s}.text`, { v: pctV(b[s] ?? 0) }) : undefined;
          return (
            <div key={s} className="nrs-info__row" data-tip={full} aria-label={full}>
              <StatIcon stat={s} dim={!rec} />
              <span>{t(`nursery.stat.${s}`)}</span>
              <b className="px-num">{rec ? t('nursery.bonus', { v: pctV(b[s] ?? 0) }) : '—'}</b>
            </div>
          );
        })}
      </div>
      {rows}
    </div>
  );
}
