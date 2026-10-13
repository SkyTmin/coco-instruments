// <Prompt action="confirm" /> — значок кнопки того устройства, которым
// играют сейчас: клавиша-колпачок, буква Xbox, фигура PlayStation, буква
// Nintendo. На сенсорном экране — ничего (кнопки там нажимают пальцем).

import type { ReactNode } from 'react';
import { keyLabel, PAD, type Action, type Bindings } from './actions';
import { getBindings } from './bindings';
import type { InputDevice, PadStyle } from './device';
import { useBindings, useInputDevice, usePadStyle } from './hooks';
import './input.css';

export type PromptAction = Action | 'move';

const XBOX: Record<number, string> = {
  [PAD.A]: 'A',
  [PAD.B]: 'B',
  [PAD.X]: 'X',
  [PAD.Y]: 'Y',
  [PAD.LB]: 'LB',
  [PAD.RB]: 'RB',
  [PAD.LT]: 'LT',
  [PAD.RT]: 'RT',
  [PAD.VIEW]: 'View',
  [PAD.MENU]: 'Menu',
  [PAD.L3]: 'L3',
  [PAD.R3]: 'R3',
  [PAD.HOME]: 'Home',
};
const PS: Record<number, string> = {
  [PAD.A]: '✕',
  [PAD.B]: '○',
  [PAD.X]: '□',
  [PAD.Y]: '△',
  [PAD.LB]: 'L1',
  [PAD.RB]: 'R1',
  [PAD.LT]: 'L2',
  [PAD.RT]: 'R2',
  [PAD.VIEW]: 'Create',
  [PAD.MENU]: 'Options',
  [PAD.L3]: 'L3',
  [PAD.R3]: 'R3',
  [PAD.HOME]: 'PS',
};
// Nintendo в стандартной раскладке: нижняя — B, правая — A.
const NIN: Record<number, string> = {
  [PAD.A]: 'B',
  [PAD.B]: 'A',
  [PAD.X]: 'Y',
  [PAD.Y]: 'X',
  [PAD.LB]: 'L',
  [PAD.RB]: 'R',
  [PAD.LT]: 'ZL',
  [PAD.RT]: 'ZR',
  [PAD.VIEW]: '−',
  [PAD.MENU]: '+',
  [PAD.L3]: 'L3',
  [PAD.R3]: 'R3',
  [PAD.HOME]: 'Home',
};
const DPAD: Record<number, string> = {
  [PAD.UP]: '↑',
  [PAD.DOWN]: '↓',
  [PAD.LEFT]: '←',
  [PAD.RIGHT]: '→',
};

/** Текст подсказки (для title, aria-label, тостов): «I», «A», «✕», «LB». */
export function promptText(
  action: PromptAction,
  device: InputDevice,
  pad: PadStyle = 'xbox',
  b: Bindings = getBindings(),
): string {
  if (device === 'gamepad') {
    if (action === 'move') return 'L';
    const btn = b.pad[action][0];
    if (btn === undefined) return '';
    if (DPAD[btn]) return DPAD[btn]!;
    const map = pad === 'ps' ? PS : pad === 'nintendo' ? NIN : XBOX;
    return map[btn] ?? `#${btn}`;
  }
  if (action === 'move') return 'WASD';
  const k = b.keys[action][0];
  return k ? keyLabel(k) : '';
}

/** Подпись для всплывающей подсказки мыши: «Инвентарь · I». */
export function hintTitle(text: string, action: Action, b: Bindings = getBindings()): string {
  const k = b.keys[action][0];
  return k ? `${text} · ${keyLabel(k)}` : text;
}

// Фигуры PlayStation точками 9×9 — шрифт игры их не знает, а системный
// рисует их всякий раз по-разному.
const PS_SHAPES: Record<string, string> = {
  '✕': 'M2 2h1v1h-1zM6 2h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM4 4h1v1h-1zM3 5h1v1h-1zM5 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1z',
  '○': 'M3 1h3v1h-3zM2 2h1v1h-1zM6 2h1v1h-1zM1 3h1v3h-1zM7 3h1v3h-1zM2 6h1v1h-1zM6 6h1v1h-1zM3 7h3v1h-3z',
  '□': 'M2 2h5v1h-5zM2 6h5v1h-5zM2 3h1v3h-1zM6 3h1v3h-1z',
  '△': 'M4 1h1v1h-1zM3 2h1v2h-1zM5 2h1v2h-1zM2 4h1v2h-1zM6 4h1v2h-1zM1 6h7v1h-7z',
};
const PS_TONE: Record<string, string> = {
  '✕': 'ps-x',
  '○': 'ps-o',
  '□': 'ps-sq',
  '△': 'ps-tri',
};
const DPAD_ARM: Record<string, string> = {
  '↑': 'M3 0h3v3h-3z',
  '↓': 'M3 6h3v3h-3z',
  '←': 'M0 3h3v3h-3z',
  '→': 'M6 3h3v3h-3z',
};

function Glyph({ text, device, pad }: { text: string; device: InputDevice; pad: PadStyle }) {
  if (device !== 'gamepad') return <kbd className="ip ip--key">{text}</kbd>;
  if (DPAD_ARM[text])
    return (
      <span className="ip ip--dpad" aria-label={text}>
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
          <path d="M3 0h3v9h-3zM0 3h9v3h-9z" className="ip__base" />
          <path d={DPAD_ARM[text]} className="ip__hot" />
        </svg>
      </span>
    );
  if (pad === 'ps' && PS_SHAPES[text])
    return (
      <span className={`ip ip--face ip--${PS_TONE[text]}`} aria-label={text}>
        <svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
          <path d={PS_SHAPES[text]} fill="currentColor" />
        </svg>
      </span>
    );
  const face = text.length === 1 && /[ABXY]/.test(text);
  const tone = face ? (pad === 'nintendo' ? 'nin' : `xb-${text.toLowerCase()}`) : '';
  return (
    <span className={`ip ${face ? `ip--face ip--${tone}` : 'ip--pill'}`}>
      <b>{text}</b>
    </span>
  );
}

export interface PromptProps {
  action: PromptAction;
  /** Подпись рядом со значком: «Купить». */
  label?: ReactNode;
  /** Показывать и на сенсорном экране (по умолчанию нет). */
  always?: boolean;
  /** Подменить устройство (экран настроек показывает обе колонки). */
  device?: InputDevice;
  pad?: PadStyle;
  className?: string;
}

export function Prompt({ action, label, always, device, pad, className }: PromptProps) {
  const cur = useInputDevice();
  const curPad = usePadStyle();
  const b = useBindings();
  const dev = device ?? cur;
  if (dev === 'touch' && !always) return null;
  const shown = dev === 'touch' ? 'keyboard' : dev === 'mouse' ? 'keyboard' : dev;
  const ps = pad ?? curPad;
  const text = promptText(action, shown, ps, b);
  if (!text) return null;
  return (
    <span className={`ip-prompt${className ? ` ${className}` : ''}`} data-action={action}>
      <Glyph text={text} device={shown} pad={ps} />
      {label != null && <span className="ip-prompt__label">{label}</span>}
    </span>
  );
}
