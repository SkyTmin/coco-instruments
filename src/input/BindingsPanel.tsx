// Вкладка «Управление» в настройках игры (экран агента L): какие клавиши и
// кнопки геймпада у каждого действия. Нажал ячейку → «нажми клавишу» →
// клавиша встала вместо старой. Esc — отмена, Backspace — стереть ячейку.

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { settingsPanels } from '@/settings/panels';
import { assignBinding, GAME_ACTIONS, HOTKEY_ACTIONS, UI_ACTIONS, type Action } from './actions';
import { getBindings, resetBindings, setBindings } from './bindings';
import { captureNextBinding } from './capture';
import { useBindings, usePadConnected, usePadStyle } from './hooks';
import { Glyph, keyText, padLabel } from './Prompt';
import './input.css';

type Dev = 'keys' | 'pad';
interface Wait {
  action: Action;
  dev: Dev;
  slot: number;
}

const GROUPS = [
  ['ui', UI_ACTIONS],
  ['game', GAME_ACTIONS],
  ['hotkey', HOTKEY_ACTIONS],
] as const;

/** Ячеек клавиатуры у действия (основная и запасная), геймпада — одна. */
const KEY_SLOTS = [0, 1];

export function BindingsPanel() {
  const t = useT();
  const b = useBindings();
  const pad = usePadStyle();
  const padOn = usePadConnected();
  const [wait, setWait] = useState<Wait | null>(null);
  const cap = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => () => cap.current?.cancel(), []);

  const start = (action: Action, dev: Dev, slot: number) => {
    cap.current?.cancel();
    const c = captureNextBinding(dev);
    cap.current = c;
    setWait({ action, dev, slot });
    void c.promise.then((r) => {
      if (cap.current !== c) return;
      cap.current = null;
      setWait(null);
      if (!r) return;
      if (r.device === 'keys') {
        const clear = r.chord === 'Backspace' || r.chord === 'Delete';
        setBindings(assignBinding(getBindings(), action, 'keys', clear ? null : r.chord, slot));
      } else setBindings(assignBinding(getBindings(), action, 'pad', r.button, slot));
    });
  };

  const cell = (action: Action, dev: Dev, slot: number) => {
    const v = dev === 'keys' ? b.keys[action][slot] : b.pad[action][slot];
    const label =
      v === undefined
        ? ''
        : dev === 'keys'
          ? keyText(String(v)).replace('Shift+', '⇧')
          : padLabel(+v, pad);
    const on = wait?.action === action && wait.dev === dev && wait.slot === slot;
    const name = t(`input.action.${action}`);
    return (
      <button
        key={`${dev}${slot}`}
        type="button"
        className={`ibind__cell ibind__cell--${dev}${on ? ' is-wait' : ''}`}
        aria-label={`${name}: ${on ? t(dev === 'keys' ? 'input.press' : 'input.pressPad') : label || '—'}`}
        onClick={() => {
          if (on) cap.current?.cancel();
          else start(action, dev, slot);
        }}
      >
        {on ? (
          <span className="ibind__dots" aria-hidden="true">
            …
          </span>
        ) : label ? (
          <Glyph text={label} device={dev === 'keys' ? 'keyboard' : 'gamepad'} pad={pad} />
        ) : (
          <span className="ibind__none" aria-hidden="true">
            —
          </span>
        )}
      </button>
    );
  };

  let hint = '';
  if (wait)
    hint =
      wait.dev === 'keys'
        ? `${t('input.press')} ${t('input.cancel')} · ${t('input.clear')}`
        : `${t('input.pressPad')} ${t('input.cancel')}`;
  else if (!padOn) hint = t('input.padNone');

  return (
    <div className="ibind">
      <div className="ibind__cols" aria-hidden="true">
        <span />
        <span className="ibind__col ibind__col--keys">{t('input.device.keys')}</span>
        <span className="ibind__col">{t('input.device.pad')}</span>
      </div>
      {GROUPS.map(([g, list]) => (
        <section key={g} className="ibind__group" aria-label={t(`input.group.${g}`)}>
          <h4 className="ibind__h">{t(`input.group.${g}`)}</h4>
          {list.map((a) => (
            <div key={a} className="ibind__row">
              <span className="ibind__name">{t(`input.action.${a}`)}</span>
              {KEY_SLOTS.map((s) => cell(a, 'keys', s))}
              {cell(a, 'pad', 0)}
            </div>
          ))}
        </section>
      ))}
      <div className="ibind__foot">
        <span className={`ibind__hint${wait ? ' is-wait' : ''}`} aria-live="polite">
          {hint}
        </span>
        <button
          type="button"
          className="ibind__reset"
          onClick={() => {
            cap.current?.cancel();
            resetBindings();
          }}
        >
          {t('input.reset')}
        </button>
      </div>
    </div>
  );
}

// Вкладка «Управление» в настройках L рисует эту панель вместо заглушки.
settingsPanels.controls = BindingsPanel;
