// Nursery — the pets view of «Питомник», the first screen on the pixel kit (`@/ui-px`, style
// guide `.claude/rules/ui-px.md`). Rules are untouched (`lib/pets.ts`, store actions): this is
// only how the same squad, collection, merge and skin choice look and are reached.
//
// One component, four arrangements by the shell's format (`useFormFactor`). The stage (room +
// framed animation buttons + the name plate) always takes about half the screen, and every box
// has a fixed size whatever pet is chosen — nothing jumps when the selection changes:
// - `one` (phone portrait): stage on top, the squad (three big slots), a one-row collection
//   strip whose grid button opens the full collection in a drawer over the side, action bar.
// - `land` (phone landscape): stage | side (plate, squad, collection button, actions); the
//   collection is the same drawer.
// - `tall` (tablet portrait): stage on top, side below with the full collection grid.
// - `wide` (tablet landscape, desktop): stage | side with the full collection grid.
// Details (roles, merge, skins) open in a sheet on every format.
// Keyboard/gamepad: arrows move between slots (the shell's spatial focus), a focused slot is
// the selected pet, `inspect` (X / pad Y) takes it along or leaves it home.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useFinanceStore } from '@/store';
import { fmtNum, useT } from '@/i18n';
import { useFormFactor } from '@/game-shell';
import { focusEl, getInputDevice, useAction } from '@/input';
import { registerEscape } from '@/lib/escape-stack';
import { PetArt } from '@/components/PetArt';
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
import { Badge, Bar, Button, Grid, Heading, Icon, Modal, Panel, Slot } from '@/ui-px';
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
const ROLE_ICON: Record<PetStat, PxIconName> = {
  loot: 'gem',
  sell: 'coin',
  dmg: 'bolt',
  token: 'token',
  luck: 'key',
  rate: 'clock',
};
type Sort = 'rarity' | 'level' | 'power';
type Filter = 'all' | 'owned' | 'missing';
const SORTS: Sort[] = ['rarity', 'level', 'power'];
const FILTERS: Filter[] = ['all', 'owned', 'missing'];
type Layout = 'one' | 'land' | 'tall' | 'wide';

/** Percent for the `{v}` of the role strings: one decimal, the locale formats the number. */
const pctV = (x: number) => Math.round(x * 1000) / 10;
const rc = (r: number) => ({ '--rc': RARITIES[r]?.color }) as CSSProperties;
const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

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

export function Nursery({ say }: { say: (text: string) => void }) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const { ff, landscape, scale } = useFormFactor();
  const layout: Layout =
    ff === 'phone-portrait'
      ? 'one'
      : ff === 'phone-landscape'
        ? 'land'
        : ff === 'tablet' && !landscape
          ? 'tall'
          : 'wide';
  // Phones: the collection is a strip that opens into a drawer; tablets and desktops show the grid.
  const drawerMode = layout === 'one' || layout === 'land';
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

  const def = petOf(sel);
  const rec = p.pets[sel];
  const slots = squadSlots(p.rank, p.prestige);
  const here = p.squad.includes(sel);
  const lv = petLevelOf(rec?.xp ?? 0);

  const select = (id: PetId) => {
    if (id === sel) return;
    selectionChanged();
    setSel(id);
    setBase('idle');
    setShow(null);
  };

  const toggleSquad = () => {
    if (!rec) {
      say(t('nursery.hatchFirst'));
      return;
    }
    primeAudio();
    selectionChanged();
    if (here) {
      setSquad(p.squad.filter((x) => x !== sel));
      return;
    }
    // Squad full — the newcomer takes the last place (as the old card did).
    setSquad(p.squad.length < slots ? [...p.squad, sel] : [...p.squad.slice(0, slots - 1), sel]);
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
  const size = room.w && room.h ? fitPet(sel, room.w, room.h, dpr, lift) : 0;
  // Slot art: the strip/grid cell is 26 art px, the squad cells bigger (nursery.css `--slot`).
  const thumb = 20 * u;
  const big = (layout === 'land' ? 20 : 26) * u;

  const name = t(`pets.${sel}.name`);
  const lvText = t('common.level', { n: lv.level });

  const pet = (
    <span
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
          id={sel}
          size={size}
          v={petLook(rec)}
          ghost={!rec}
          anim={base}
          joy={joy}
          play={show}
          onClick={
            rec
              ? () => {
                  primeAudio();
                  petPat();
                  tapLight();
                  setJoy((j) => j + 1);
                  if (canPat(rec, Date.now()) && pat(sel)) setXpPop((x) => x + 1);
                }
              : undefined
          }
        />
      )}
    </span>
  );

  // Six framed buttons, always all six (a pet not hatched yet: greyed, a tap says why) — the row
  // never changes. The word is the tip / aria label.
  const anims = (
    <div className="nur-anims" role="toolbar">
      {ANIMS.map((a) => {
        const word = t(`nursery.anim.${a.id}`);
        return (
          <Button
            key={a.id}
            size="sm"
            icon={a.icon}
            label={word}
            className="nur-anim"
            off={!rec}
            on={rec && a.loop ? base === a.id && !show : undefined}
            onClick={() => {
              tapLight();
              if (!rec) {
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
      })}
    </div>
  );

  // Role chips: icon + value; the full sentence is the tip. A fixed number per layout, the rest
  // behind «+N» (opens the details) — one row, so the plate never grows.
  const maxChips = layout === 'one' || layout === 'land' ? 2 : 3;
  const shown = def.stats.length > maxChips ? def.stats.slice(0, maxChips - 1) : def.stats;
  const roles = rec ? (
    <>
      {shown.map((s) => {
        const v = pctV(petBonus(sel, rec)[s] ?? 0);
        const full = t(`nursery.role.${s}.text`, { v });
        return (
          <span key={s} className="nur-chip" data-tip={full} aria-label={full}>
            <Icon name={ROLE_ICON[s]} />
            <b>{t('nursery.bonus', { v })}</b>
          </span>
        );
      })}
      {shown.length < def.stats.length && (
        <button
          type="button"
          className="nur-chip nur-chip--more px-f"
          aria-label={t('nursery.details')}
          data-tip={t('nursery.details')}
          onClick={() => {
            tapLight();
            setInfo(true);
          }}
        >
          +{def.stats.length - shown.length}
        </button>
      )}
    </>
  ) : (
    <span className="nur-chip nur-chip--note">{t('nursery.notYet')}</span>
  );

  // The plate under the pet: name (one line, sized to fit), rarity pill, gold, power, roles and
  // the level bar. Fixed rows — switching pets never changes its height.
  const plate = (
    <div
      className="px-dark nur-plate"
      style={{ ...rc(def.rarity), '--len': Math.max(8, name.length) } as CSSProperties}
    >
      <h3 className="nur-plate__name">{name}</h3>
      <div className="nur-plate__row">
        <span className="nur-rar">{t(`nursery.rarity.r${def.rarity}` as 'nursery.rarity.r0')}</span>
        {!!rec?.v && <Badge gold>{t('nursery.gold')}</Badge>}
        {rec && (
          <span className="nur-pow" data-tip={t('nursery.power')}>
            <Icon name="bolt" />
            <span className="nur-pow__w">{t('nursery.power')}</span>
            <b className="px-num">{fmtNum(petScore(sel, rec) * 10)}</b>
          </span>
        )}
      </div>
      <div className="nur-plate__roles">{roles}</div>
      <Bar
        value={rec ? (lv.need ? lv.into / lv.need : 1) : 0}
        label={
          !rec
            ? ''
            : !lv.need
              ? `${lvText} · ${t('nursery.lvMax')}`
              : `${lvText} · ${fmtNum(lv.into)} / ${fmtNum(lv.need)}`
        }
      />
    </div>
  );

  const xp = xpPop > 0 && (
    <b key={xpPop} className="nur-stage__xp">
      {t('nursery.patXp', { n: PAT_XP })}
    </b>
  );

  const showcase = (
    <section className="nur-show" style={rc(def.rarity)}>
      <Panel material="stone" stage className="nur-stage">
        <span ref={roomRef} className="nur-room">
          {pet}
        </span>
        {anims}
        {layout !== 'land' && plate}
        {xp}
      </Panel>
    </section>
  );

  // Squad: three BIG cells first, the summed bonuses as a small line under them.
  const squad = (
    <section className="nur-squad" aria-label={t('nursery.squad')}>
      <div className="nur-squad__head">
        <Heading className="nur-squad__title">{t('nursery.squad')}</Heading>
        <span className="nur-squad__hint">{t('nursery.squadHint')}</span>
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
          const id = p.squad[i];
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
            <Slot
              key={i}
              rarity={petOf(id).rarity}
              selected={sel === id}
              count={petLevelOf(r.xp).level}
              corner={r.v ? '★' : undefined}
              dot={canMerge(r) ? '!' : undefined}
              aria-label={t(`pets.${id}.name`)}
              tip={<SlotTip id={id} rec={r} />}
              onClick={() => select(id)}
              onFocus={() => select(id)}
            >
              <PetArt id={id} size={big} v={petLook(r)} still />
            </Slot>
          );
        })}
      </div>
      {layout !== 'land' && (
        <div className="nur-squad__sum">
          {(Object.keys(squadBonus) as PetStat[]).map((k) => {
            const v = pctV(squadBonus[k] ?? 0);
            const full = t(`nursery.role.${k}.text`, { v });
            return (
              <span key={k} className="nur-chip nur-chip--sm" data-tip={full} aria-label={full}>
                <Icon name={ROLE_ICON[k]} />
                <b>{t('nursery.bonus', { v })}</b>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );

  const cell = (d: (typeof PETS)[number], focusFirst: boolean) => {
    const r = p.pets[d.id];
    return (
      <Slot
        key={d.id}
        rarity={d.rarity}
        locked={!r}
        selected={sel === d.id}
        count={r ? petLevelOf(r.xp).level : undefined}
        corner={r?.v ? '★' : undefined}
        dot={canMerge(r) ? '!' : undefined}
        data-autofocus={focusFirst && sel === d.id ? '' : undefined}
        data-pet={d.id}
        aria-label={r ? t(`pets.${d.id}.name`) : t('nursery.unknown')}
        tip={<SlotTip id={d.id} rec={r} />}
        onClick={() => select(d.id)}
        onFocus={() => select(d.id)}
      >
        <PetArt id={d.id} size={thumb} v={petLook(r)} ghost={!r} still />
        {p.squad.includes(d.id) && <Icon name="paw" className="nur-along" />}
      </Slot>
    );
  };

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
          <Icon name="coin" />
          <b>{t('nursery.bonus', { v: pctV(zoo) })}</b>
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

  // Phones: one row of cells to flick through + the button that opens the whole grid.
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = stripRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-pet="${sel}"]`);
    if (!row || !el) return;
    // Keep the selected cell in view without scrolling anything but the strip itself.
    const l = el.offsetLeft - row.offsetLeft;
    if (l < row.scrollLeft) row.scrollLeft = l;
    else if (l + el.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = l + el.offsetWidth - row.clientWidth;
  }, [sel, list, drawerMode]);
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
  // Phone landscape has no height for the strip: the grid button sits in the action row.
  const collection =
    layout === 'land' ? null : drawerMode ? (
      <section className="nur-strip">
        {openBtn}
        <div ref={stripRef} className="nur-strip__row">
          {list.map((d) => cell(d, true))}
        </div>
      </section>
    ) : (
      <section className="nur-coll">
        {collHead}
        <Grid className="nur-grid">{list.map((d) => cell(d, true))}</Grid>
      </section>
    );

  // The drawer covers the side area only (squad, strip, actions): the stage stays in view and
  // shows each pet as it is picked. Esc / Back / pad B closes it (escape stack).
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const off = registerEscape(() => setDrawer(false));
    const dev = getInputDevice();
    if (dev === 'keyboard' || dev === 'gamepad') {
      const el = drawerRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      if (el) focusEl(el);
    }
    return () => {
      off();
      const d = getInputDevice();
      const open = root.current?.querySelector<HTMLElement>('.nur-strip__open');
      if ((d === 'keyboard' || d === 'gamepad') && open) focusEl(open);
    };
  }, [drawer]);
  useEffect(() => {
    if (!drawerMode) setDrawer(false);
  }, [drawerMode]);

  const acts = (
    <div className="nur-acts">
      {layout === 'land' && openBtn}
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
    <div ref={root} className={`px nur nur--${layout}`}>
      {showcase}
      <div className="nur-side">
        {layout === 'land' && plate}
        {squad}
        {collection}
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
          <Grid className="nur-grid">{list.map((d) => cell(d, true))}</Grid>
        </div>
      )}
      {info && (
        <Modal title={name} sheet onClose={() => setInfo(false)}>
          <PetInfo id={sel} xp onJoy={() => setJoy((j) => j + 1)} />
        </Modal>
      )}
      {pick !== null && (
        <SquadPick
          slot={pick}
          thumb={thumb}
          onPicked={(id) => {
            setSel(id);
            setJoy((j) => j + 1);
          }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

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

/** Details: lore, roles, experience, copies to gold + merge, skin, eggs it hatches from.
 *  `head` — the name block on top (the details column); `xp` — its own experience bar (the
 *  phone sheet: the column's level bar already carries the numbers). */
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
            label={lv.need ? `${fmtNum(lv.into)} / ${fmtNum(lv.need)}` : t('nursery.lvMax')}
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
    <div className="nur-info__body" style={rc(def.rarity)}>
      {head && <div className="nur-info__grp">{head}</div>}
      <div className="nur-info__grp">
        <p className="nur-info__lore">{t(`pets.${id}.lore`)}</p>
        <div className="nur-info__roles">
          {def.stats.map((s) => (
            <div key={s} className="nur-role">
              <Icon name={ROLE_ICON[s]} />
              <b>{t(`nursery.role.${s}.name`)}</b>
              {rec && <span>{t(`nursery.role.${s}.text`, { v: pctV(b[s] ?? 0) })}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="nur-info__grp">{rows}</div>
    </div>
  );
}

/** Who goes to an empty squad place: owned pets not along yet, strongest first. */
function SquadPick({
  slot,
  thumb,
  onPicked,
  onClose,
}: {
  slot: number;
  thumb: number;
  onPicked: (id: PetId) => void;
  onClose: () => void;
}) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
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
                tip={<SlotTip id={id} rec={r} />}
                onClick={() => {
                  primeAudio();
                  selectionChanged();
                  const next = [...p.squad];
                  next.splice(slot, 0, id);
                  setSquad(next);
                  petPat();
                  onPicked(id);
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
