// Креатив владельца (v2.81): окно песочницы и плашка «КРЕАТИВ» поверх всего,
// пока он включён. Правила песочницы — `lib/creative.ts`, действия — стор.
// Окно открывается из «Кассы» (настройки шахты и автоматов), кнопкой во
// дворе и тапом по плашке — то есть отовсюду, где владелец может оказаться.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinanceStore } from '@/store';
import { cachedOwner, getBackupStatus } from '@/lib/backup';
import { OPEN_FLOORS, PLUS_SAFE, SETS } from '@/lib/dungeon';
import { PICKS } from '@/lib/economy';
import { LAST_RANK, rankLetter } from '@/lib/prison';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';
import { GxIcon, GxModal } from '@/components/gx';
import { pickName, t, useT } from '@/i18n';
import { setName } from '@/i18n/data-dungeon';

/** Владелец (или разработка): только ему видна песочница. */
export function useOwner(): boolean {
  const [owner, setOwner] = useState<boolean>(!!cachedOwner() || import.meta.env.DEV);
  useEffect(() => {
    if (owner) return;
    let alive = true;
    void getBackupStatus().then((s) => alive && s.owner && setOwner(true));
    return () => {
      alive = false;
    };
  }, [owner]);
  return owner;
}

let openPanel: (() => void) | null = null;

/** Открыть окно креатива откуда угодно (кнопка в «Кассе», во дворе). */
export function openCreative(): void {
  openPanel?.();
}

function Stepper({
  label,
  value,
  min,
  max,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const go = (d: number) => {
    const v = Math.max(min, Math.min(max, value + d));
    if (v === value) return;
    tapLight();
    onChange(v);
  };
  return (
    <div className="crv-step">
      <span className="crv-step__label">{label}</span>
      <button type="button" className="gx-btn gx-btn--sm gx-btn--grey" onClick={() => go(-1)}>
        −
      </button>
      <b className="crv-step__val">{show(value)}</b>
      <button type="button" className="gx-btn gx-btn--sm gx-btn--grey" onClick={() => go(1)}>
        +
      </button>
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  useT();
  const nav = useNavigate();
  const creative = useFinanceStore((s) => s.creative);
  const prison = useFinanceStore((s) => s.prison);
  const dungeon = useFinanceStore((s) => s.dungeon);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const enter = useFinanceStore((s) => s.creativeEnter);
  const exit = useFinanceStore((s) => s.creativeExit);
  const god = useFinanceStore((s) => s.creativeGod);
  const setPrison = useFinanceStore((s) => s.creativePrisonSet);
  const setDungeon = useFinanceStore((s) => s.creativeDungeonSet);
  const coins = useFinanceStore((s) => s.creativeCoins);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const go = (path: string) => {
    tapLight();
    onClose();
    nav(path);
  };

  if (!creative.on)
    return (
      <div className="crv">
        <p className="crv__lead">{t('creative.lead1')}</p>
        <p className="crv__lead">{t('creative.lead2')}</p>
        <button
          type="button"
          className="gx-btn gx-btn--big gx-btn--block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await enter();
            setBusy(false);
            notifySuccess();
          }}
        >
          <GxIcon name="magic" /> {t('creative.enter')}
        </button>
      </div>
    );

  const g = dungeon.gear.weapon;
  return (
    <div className="crv">
      <section className="crv__sec">
        <h4>{t('creative.where')}</h4>
        <div className="crv__row">
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/yard')}>
            {t('creative.yard')}
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/prison')}>
            {t('creative.mine')}
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/dungeon')}>
            {t('creative.dungeon')}
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/games')}>
            {t('creative.hall')}
          </button>
        </div>
      </section>

      <section className="crv__sec">
        <h4>{t('creative.wallet')}</h4>
        <p className="crv__note">
          {[
            t('common.coins', { n: balance }),
            t('chests.tokens', { n: prison.tokens }),
            t('chests.keys', { n: prison.keys }),
          ].join(' · ')}
        </p>
        <div className="crv__row">
          <button type="button" className="gx-btn gx-btn--sm" onClick={coins}>
            {t('creative.addCoins')}
          </button>
          <button
            type="button"
            className="gx-btn gx-btn--sm"
            onClick={() => setPrison({ fill: true })}
          >
            {t('creative.addStuff')}
          </button>
        </div>
      </section>

      <section className="crv__sec">
        <h4>{t('creative.mine')}</h4>
        <Stepper
          label={t('creative.rank')}
          value={prison.rank}
          min={0}
          max={LAST_RANK}
          show={rankLetter}
          onChange={(rank) => setPrison({ rank })}
        />
        <Stepper
          label={t('creative.prestige')}
          value={prison.prestige}
          min={0}
          max={30}
          show={String}
          onChange={(prestige) => setPrison({ prestige })}
        />
        <Stepper
          label={t('creative.pick')}
          value={prison.pick}
          min={0}
          max={PICKS.length - 1}
          show={(v) => (PICKS[v] ? pickName(v) : String(v))}
          onChange={(pick) => setPrison({ pick })}
        />
      </section>

      <section className="crv__sec">
        <h4>{t('creative.dungeon')}</h4>
        <p className="crv__note">
          {t('creative.floors', {
            n: String(Math.min(dungeon.reached, OPEN_FLOORS.length)),
            total: String(OPEN_FLOORS.length),
          })}
        </p>
        <Stepper
          label={t('creative.tier')}
          value={g.tier}
          min={1}
          max={SETS.length}
          show={(v) => `${v} · ${SETS[v - 1] ? setName(v) : ''}`}
          onChange={(tier) => setDungeon({ tier })}
        />
        <Stepper
          label={t('creative.plus')}
          value={g.plus}
          min={0}
          max={PLUS_SAFE}
          show={(v) => `+${v}`}
          onChange={(plus) => setDungeon({ plus })}
        />
        <label className="crv-check">
          <input
            type="checkbox"
            checked={creative.god}
            onChange={(e) => {
              tapLight();
              god(e.target.checked);
            }}
          />
          {t('creative.god')}
        </label>
        <div className="crv__row">
          <button
            type="button"
            className="gx-btn gx-btn--sm"
            onClick={() => setDungeon({ open: true, bosses: true })}
          >
            {t('creative.bosses')}
          </button>
          <button
            type="button"
            className="gx-btn gx-btn--sm"
            onClick={() => setDungeon({ stash: true })}
          >
            {t('creative.stash')}
          </button>
        </div>
      </section>

      <button
        type="button"
        className="gx-btn gx-btn--red gx-btn--block"
        disabled={busy}
        onClick={async () => {
          if (!armed) {
            notifyWarning();
            setArmed(true);
            return;
          }
          setBusy(true);
          await exit();
          setBusy(false);
          setArmed(false);
          notifySuccess();
        }}
      >
        {armed ? t('creative.leaveSure') : t('creative.leave')}
      </button>
    </div>
  );
}

/**
 * Хозяин окна и плашка. Ставится один раз на всё приложение: окно
 * открывается через `openCreative()`, плашка видна, пока креатив включён.
 */
export function CreativeHost() {
  useT();
  const on = useFinanceStore((s) => s.creative.on);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openPanel = () => setOpen(true);
    return () => {
      openPanel = null;
    };
  }, []);
  return (
    <>
      {on && !open && (
        <button
          type="button"
          className="crv-badge"
          onClick={() => {
            tapLight();
            setOpen(true);
          }}
        >
          {t('creative.badge')}
        </button>
      )}
      {open && (
        <GxModal title={t('creative.title')} onClose={() => setOpen(false)}>
          <Panel onClose={() => setOpen(false)} />
        </GxModal>
      )}
    </>
  );
}

/** Строка в «Кассе»: войти в песочницу или открыть её настройки. */
export function CreativeRow() {
  useT();
  const on = useFinanceStore((s) => s.creative.on);
  return (
    <div className="cash-row">
      <button
        type="button"
        className="cash-btn cash-btn--creative"
        onClick={() => {
          tapLight();
          openCreative();
        }}
      >
        {on ? t('creative.rowOn') : t('creative.row')}
      </button>
    </div>
  );
}
