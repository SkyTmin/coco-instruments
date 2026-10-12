// Nursery — the pets view of «Питомник», the first screen on the pixel kit (`@/ui-px`, style
// guide `.claude/rules/ui-px.md`). Rules are untouched (`lib/pets.ts`, store actions): this is
// only how the same squad, collection, merge and skin choice look and are reached.
//
// One component, three arrangements by the shell's format (`useFormFactor`):
// - `one` (phone portrait): showcase on top, squad + collection scroll under it, the action bar
//   sits in the thumb zone; details open in a sheet.
// - `two` (tablet portrait): showcase | details on top, a wide collection below.
// - `three` (phone landscape, tablet landscape, desktop): list | showcase | details.
// Keyboard/gamepad: arrows move between slots (the shell's spatial focus), a focused slot is
// the selected pet, `inspect` (X / pad Y) takes it along or leaves it home.

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useFinanceStore } from '@/store';
import { fmtNum, useT } from '@/i18n';
import { useFormFactor } from '@/game-shell';
import { useAction } from '@/input';
import { PetArt } from '@/components/PetArt';
import type { PetAnim } from '@/components/PetArt';
import { RARITIES } from '@/lib/rarity';
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
  { id: 'idle', icon: 'paw', loop: true },
  { id: 'walk', icon: 'right', loop: true },
  { id: 'happy', icon: 'heart', loop: false },
  { id: 'work', icon: 'star', loop: false },
  { id: 'attack', icon: 'sword', loop: false },
  { id: 'sleep', icon: 'zzz', loop: true },
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
type Layout = 'one' | 'two' | 'three';

/** Percent for the `{v}` of the role strings: one decimal, the locale formats the number. */
const pctV = (x: number) => Math.round(x * 1000) / 10;
const rc = (r: number) => ({ '--rc': RARITIES[r]?.color }) as CSSProperties;

export function Nursery({ say }: { say: (text: string) => void }) {
  const t = useT();
  const p = useFinanceStore((s) => s.prison);
  const setSquad = useFinanceStore((s) => s.prisonSquadSet);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const { ff, landscape, scale } = useFormFactor();
  const layout: Layout =
    ff === 'phone-portrait' ? 'one' : ff === 'tablet' && !landscape ? 'two' : 'three';
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

  // Sizes in ART pixels → CSS px through the shell's integer scale (PetArt fits its strip).
  const u = scale || 2;
  const stage =
    (ff === 'phone-landscape' ? 52 : ff === 'phone-portrait' ? 64 : ff === 'desktop' ? 88 : 72) * u;
  const thumb = 20 * u;

  const name = t(`pets.${sel}.name`);

  const showcase = (
    <section className="nur-show" style={rc(def.rarity)}>
      <Panel material="stone" stage className="nur-stage">
        <span className="nur-stage__pet">
          <PetArt
            id={sel}
            size={stage}
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
        </span>
        {xpPop > 0 && (
          <b key={xpPop} className="nur-stage__xp">
            {t('nursery.patXp', { n: PAT_XP })}
          </b>
        )}
        {rec && (
          <div className="nur-anims" role="toolbar">
            {ANIMS.map((a) => (
              <Button
                key={a.id}
                size="sm"
                icon={a.icon}
                label={t(`nursery.anim.${a.id}`)}
                on={a.loop ? base === a.id && !show : undefined}
                onClick={() => {
                  tapLight();
                  if (a.loop) {
                    setBase(a.id);
                    setShow(null);
                  } else setShow((s) => ({ anim: a.id, k: (s?.k ?? 0) + 1 }));
                }}
              />
            ))}
          </div>
        )}
        <div className="nur-id">
          <Heading className="nur-id__name">{name}</Heading>
          <div className="nur-id__sub">
            <span className="nur-id__rar">
              {t(`nursery.rarity.r${def.rarity}` as 'nursery.rarity.r0')}
            </span>
            {!!rec?.v && <Badge gold>{t('nursery.gold')}</Badge>}
          </div>
          {rec && (
            <>
              <Bar
                value={lv.need ? lv.into / lv.need : 1}
                height={9}
                label={
                  lv.need
                    ? t('common.level', { n: lv.level })
                    : `${t('common.level', { n: lv.level })} · ${t('nursery.lvMax')}`
                }
              />
              <div className="nur-perks">
                {def.stats.map((s) => (
                  <span key={s} className="nur-perk">
                    <Icon name={ROLE_ICON[s]} />
                    {t(`nursery.role.${s}.text`, { v: pctV(petBonus(sel, rec)[s] ?? 0) })}
                  </span>
                ))}
                <span className="nur-perk nur-perk--pow">
                  <Icon name="bolt" />
                  {t('nursery.power')} {fmtNum(petScore(sel, rec) * 10)}
                </span>
              </div>
            </>
          )}
        </div>
      </Panel>
    </section>
  );

  const squad = (
    <section className="nur-squad">
      <div className="nur-head">
        <Heading>{t('nursery.squad')}</Heading>
        <span className="nur-head__note">
          {(Object.keys(squadBonus) as PetStat[]).map((k) => (
            <span key={k} className="nur-perk nur-perk--sm">
              <Icon name={ROLE_ICON[k]} />
              {t(`nursery.role.${k}.text`, { v: pctV(squadBonus[k] ?? 0) })}
            </span>
          ))}
        </span>
      </div>
      <div className="nur-squad__row">
        {[0, 1, 2].map((i) => {
          if (i >= slots)
            return (
              <div key={i} className="nur-squad__cell">
                <Slot empty locked disabled aria-label={t('nursery.squad')} />
                <i>
                  {i === 1
                    ? t('nursery.lockRank', { rank: rankLetter(SQUAD_RANK2) })
                    : t('nursery.lockPrestige')}
                </i>
              </div>
            );
          const id = p.squad[i];
          const r = id ? p.pets[id] : undefined;
          if (!id || !r)
            return (
              <div key={i} className="nur-squad__cell">
                <Slot
                  empty
                  aria-label={t('nursery.pick')}
                  onClick={() => {
                    tapLight();
                    if (!owned) say(t('nursery.hatchFirst'));
                    else setPick(i);
                  }}
                >
                  <Icon name="plus" />
                </Slot>
                <i>&nbsp;</i>
              </div>
            );
          return (
            <div key={i} className="nur-squad__cell">
              <Slot
                rarity={petOf(id).rarity}
                selected={sel === id}
                count={petLevelOf(r.xp).level}
                corner={r.v ? '★' : undefined}
                dot={canMerge(r) ? '!' : undefined}
                aria-label={t(`pets.${id}.name`)}
                onClick={() => select(id)}
                onFocus={() => select(id)}
              >
                <PetArt id={id} size={thumb} v={petLook(r)} still />
              </Slot>
              <i>{t(`pets.${id}.name`)}</i>
            </div>
          );
        })}
      </div>
    </section>
  );

  const collection = (
    <section className="nur-coll">
      <div className="nur-head">
        <Heading>
          {t('nursery.collection')}{' '}
          <span className="nur-head__count">
            {owned}/{PETS.length}
          </span>
        </Heading>
        {zoo > 0 && (
          <span className="nur-perk nur-perk--sm">
            <Icon name="coin" />
            {t('nursery.zoo', { v: pctV(zoo) })}
          </span>
        )}
      </div>
      <div className="nur-tools">
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
      </div>
      <Grid className="nur-grid">
        {list.map((d) => {
          const r = p.pets[d.id];
          const lvl = r ? petLevelOf(r.xp).level : 0;
          return (
            <Slot
              key={d.id}
              rarity={d.rarity}
              locked={!r}
              selected={sel === d.id}
              count={r ? lvl : undefined}
              corner={r?.v ? '★' : undefined}
              dot={canMerge(r) ? '!' : undefined}
              data-autofocus={sel === d.id ? '' : undefined}
              aria-label={r ? t(`pets.${d.id}.name`) : t('nursery.unknown')}
              tip={<SlotTip id={d.id} rec={r} />}
              onClick={() => select(d.id)}
              onFocus={() => select(d.id)}
            >
              <PetArt id={d.id} size={thumb} v={petLook(r)} ghost={!r} still />
              {p.squad.includes(d.id) && <Icon name="paw" className="nur-along" />}
            </Slot>
          );
        })}
      </Grid>
    </section>
  );

  const acts = (
    <div className="nur-acts">
      <Button
        kind={here ? 'secondary' : 'primary'}
        wide
        off={!rec}
        hint="inspect"
        onClick={toggleSquad}
      >
        {here ? t('nursery.leave') : t('nursery.take')}
      </Button>
      {layout === 'one' && (
        <Button
          icon="info"
          label={t('nursery.details')}
          onClick={() => {
            tapLight();
            setInfo(true);
          }}
        />
      )}
    </div>
  );

  return (
    <div ref={root} className={`px nur nur--${layout}`}>
      {showcase}
      <div className="nur-list">
        {squad}
        {collection}
      </div>
      {layout !== 'one' && (
        <Panel material="obsidian" className="nur-info">
          <PetInfo id={sel} onJoy={() => setJoy((j) => j + 1)} />
        </Panel>
      )}
      {acts}
      {info && layout === 'one' && (
        <Modal title={name} sheet onClose={() => setInfo(false)}>
          <PetInfo id={sel} onJoy={() => setJoy((j) => j + 1)} />
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

/** Details: lore, roles, experience, copies to gold + merge, skin, eggs it hatches from. */
function PetInfo({ id, onJoy }: { id: PetId; onJoy: () => void }) {
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
  let rows: ReactNode;
  if (!rec)
    rows = (
      <div className="nur-info__from">
        <span>{t('nursery.from')}</span>
        <span className="nur-info__eggs">
          {from.map((e) => (
            <span key={e.id} className="nur-egg">
              <Icon name="egg" />
              {t(`nursery.egg.${e.id}`)}
            </span>
          ))}
        </span>
      </div>
    );
  else
    rows = (
      <>
        <Bar
          value={lv.need ? lv.into / lv.need : 1}
          height={9}
          label={lv.need ? `${fmtNum(lv.into)} / ${fmtNum(lv.need)}` : t('nursery.lvMax')}
        />
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
      {rows}
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
