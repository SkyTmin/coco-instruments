// Креатив владельца (v2.81): окно песочницы и плашка «КРЕАТИВ» поверх всего,
// пока он включён. Правила песочницы — `lib/creative.ts`, действия — стор.
// Окно открывается из «Кассы» (настройки шахты и автоматов), кнопкой во
// дворе и тапом по плашке — то есть отовсюду, где владелец может оказаться.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinanceStore } from '@/store';
import { cachedOwner, getBackupStatus } from '@/lib/backup';
import { SETS } from '@/lib/dungeon';
import { PLUS_SAFE } from '@/lib/dungeon';
import { FLOORS } from '@/lib/dungeon-floors';
import { PICKS } from '@/lib/economy';
import { LAST_RANK, rankLetter } from '@/lib/prison';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';
import { GxIcon, GxModal } from '@/components/gx';

const fmt = (n: number) => n.toLocaleString('ru-RU');

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
        <p className="crv__lead">
          Песочница: все этажи, лифты и боссы открыты, денег, токенов и ключей — сколько угодно,
          ранг, кирку и снаряжение выбираешь сам.
        </p>
        <p className="crv__lead">
          Настоящее сохранение не трогается: креатив пишется в отдельные записи. Выйдешь — всё вернётся
          как было, а сделанное в креативе останется в креативе.
        </p>
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
          <GxIcon name="magic" /> Включить креатив
        </button>
      </div>
    );

  const g = dungeon.gear.weapon;
  return (
    <div className="crv">
      <section className="crv__sec">
        <h4>Куда</h4>
        <div className="crv__row">
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/yard')}>
            Двор
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/prison')}>
            Шахта
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/dungeon')}>
            Подземелье
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => go('/games')}>
            Зал
          </button>
        </div>
      </section>

      <section className="crv__sec">
        <h4>Кошелёк</h4>
        <p className="crv__note">
          {fmt(balance)} монет · {fmt(prison.tokens)} токенов · {fmt(prison.keys)} ключей
        </p>
        <div className="crv__row">
          <button type="button" className="gx-btn gx-btn--sm" onClick={coins}>
            +100 млн монет
          </button>
          <button
            type="button"
            className="gx-btn gx-btn--sm"
            onClick={() => setPrison({ fill: true })}
          >
            Токены, ключи, яйца
          </button>
        </div>
      </section>

      <section className="crv__sec">
        <h4>Шахта</h4>
        <Stepper
          label="Ранг"
          value={prison.rank}
          min={0}
          max={LAST_RANK}
          show={rankLetter}
          onChange={(rank) => setPrison({ rank })}
        />
        <Stepper
          label="Престиж"
          value={prison.prestige}
          min={0}
          max={30}
          show={String}
          onChange={(prestige) => setPrison({ prestige })}
        />
        <Stepper
          label="Кирка"
          value={prison.pick}
          min={0}
          max={PICKS.length - 1}
          show={(v) => PICKS[v].name}
          onChange={(pick) => setPrison({ pick })}
        />
      </section>

      <section className="crv__sec">
        <h4>Подземелье</h4>
        <p className="crv__note">
          Открыто этажей: {Math.min(dungeon.reached, FLOORS.length)} из {FLOORS.length}
        </p>
        <Stepper
          label="Ступень"
          value={g.tier}
          min={1}
          max={SETS.length}
          show={(v) => `${v} · ${SETS[v - 1].name}`}
          onChange={(tier) => setDungeon({ tier })}
        />
        <Stepper
          label="Заточка"
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
          Бессмертие (с новой вылазки)
        </label>
        <div className="crv__row">
          <button
            type="button"
            className="gx-btn gx-btn--sm"
            onClick={() => setDungeon({ open: true, bosses: true })}
          >
            Боссы готовы
          </button>
          <button type="button" className="gx-btn gx-btn--sm" onClick={() => setDungeon({ stash: true })}>
            Склад по 99
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
        {armed ? 'Точно? Сделанное в креативе пропадёт' : 'Выйти из креатива'}
      </button>
    </div>
  );
}

/**
 * Хозяин окна и плашка. Ставится один раз на всё приложение: окно
 * открывается через `openCreative()`, плашка видна, пока креатив включён.
 */
export function CreativeHost() {
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
          КРЕАТИВ
        </button>
      )}
      {open && (
        <GxModal title="Креатив" onClose={() => setOpen(false)}>
          <Panel onClose={() => setOpen(false)} />
        </GxModal>
      )}
    </>
  );
}

/** Строка в «Кассе»: войти в песочницу или открыть её настройки. */
export function CreativeRow() {
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
        {on ? 'Креатив включён — настроить' : 'Режим креатива'}
      </button>
    </div>
  );
}
