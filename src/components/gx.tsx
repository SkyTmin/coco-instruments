// Игровой интерфейс (gx): иконки-маски, окна, ленты, полоски. Стили —
// src/game-ui.css, картинки — public/ui (Kenney CC0, game-icons CC BY 3.0).

import { useEffect, useRef } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { registerEscape } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';

/** Иконки game-icons.net — имена файлов в public/ui/icons. */
export type GxIconName =
  | 'sword'
  | 'spin'
  | 'dash'
  | 'eat'
  | 'backpack'
  | 'anvil'
  | 'upgrade'
  | 'lift'
  | 'minecart'
  | 'pick'
  | 'map'
  | 'sign'
  | 'crown'
  | 'rat'
  | 'chest'
  | 'chest-open'
  | 'coins'
  | 'lantern'
  | 'exit'
  | 'skull'
  | 'cog'
  | 'swords'
  | 'axe'
  | 'saw'
  | 'tree'
  | 'forest'
  | 'shop'
  | 'trade'
  | 'miner'
  | 'slots'
  | 'cave'
  | 'gold-mine'
  | 'rune'
  | 'paw'
  | 'trophy'
  | 'podium'
  | 'sparkles'
  | 'magic'
  | 'gems'
  | 'key'
  | 'hourglass'
  | 'stopwatch'
  | 'heart'
  | 'shield'
  | 'campfire'
  | 'village'
  | 'house'
  | 'log'
  | 'wood-pile'
  | 'stone'
  | 'helmet'
  | 'boots'
  | 'armor'
  | 'scroll'
  | 'book'
  | 'tent'
  | 'gate'
  | 'checklist'
  | 'laurels'
  | 'ore'
  | 'minerals'
  | 'crystal'
  | 'steak'
  | 'pointing'
  | 'joystick'
  | 'move'
  | 'hammer'
  | 'explosion'
  | 'footsteps'
  | 'cycle'
  | 'gold-bar'
  | 'piggy'
  | 'hand-truck'
  | 'cage'
  | 'hood'
  | 'visored-helm'
  | 'robe'
  | 'bomb'
  | 'dynamite'
  | 'energy'
  | 'lens'
  | 'beam'
  | 'gift'
  | 'flame'
  | 'truck'
  | 'chainsaw'
  | 'coins-pile'
  | 'stairs'
  | 'medal';

/** Системные значки Kenney Game Icons — public/ui/kenney/i-*.png. */
export type KIconName =
  | 'pause'
  | 'gear'
  | 'home'
  | 'cross'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowUp'
  | 'arrowDown'
  | 'checkmark'
  | 'exclamation'
  | 'question'
  | 'information'
  | 'locked'
  | 'unlocked'
  | 'star'
  | 'plus'
  | 'minus'
  | 'return'
  | 'exitLeft'
  | 'exitRight'
  | 'menuList'
  | 'zoom'
  | 'trophy'
  | 'audioOn'
  | 'audioOff'
  | 'singleplayer'
  | 'warning';

export function GxIcon({
  name,
  size,
  className,
  style,
}: {
  name: GxIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={`gx-icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        ...(size ? { width: size, height: size } : null),
        ['--gx-icon' as string]: `url(/ui/icons/${name}.svg)`,
        ...style,
      }}
    />
  );
}

export function KIcon({
  name,
  size,
  className,
  style,
}: {
  name: KIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={`gx-icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        ...(size ? { width: size, height: size } : null),
        ['--gx-icon' as string]: `url(/ui/kenney/i-${name}.png)`,
        ...style,
      }}
    />
  );
}

/** Полоска: `value` от 0 до 1, подпись поверх. */
export function GxBar({
  value,
  tone = 'red',
  label,
  thin,
  className,
}: {
  value: number;
  tone?: 'red' | 'green' | 'blue' | 'gold';
  label?: ReactNode;
  thin?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`gx-bar${tone === 'red' ? '' : ` gx-bar--${tone}`}${thin ? ' gx-bar--thin' : ''}${className ? ` ${className}` : ''}`}
    >
      <i style={{ transform: `scaleX(${v})` }} />
      {label != null && <b>{label}</b>}
    </div>
  );
}

/**
 * Окно поверх игры: затемнение, рамка, лента с заголовком, крестик.
 * «Назад» Telegram и Esc закрывают его первым (escape-stack).
 */
export function GxModal({
  title,
  onClose,
  kind = 'paper',
  children,
  className,
}: PropsWithChildren<{
  title?: ReactNode;
  onClose: () => void;
  kind?: 'paper' | 'wood' | 'iron' | 'iron-dark';
  className?: string;
}>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);
  return (
    <div className="gx gx-modal" onClick={onClose}>
      <div className="gx-modal__box" onClick={(e) => e.stopPropagation()}>
        {title && <div className="gx-ribbon gx-modal__title">{title}</div>}
        <button
          type="button"
          className="gx-round gx-round--red gx-modal__close"
          aria-label="Закрыть"
          onClick={() => {
            tapLight();
            onClose();
          }}
        >
          <KIcon name="cross" />
        </button>
        <div
          className={`gx-panel gx-panel--${kind === 'paper' ? 'fancy' : kind} gx-modal__body${title ? ' has-title' : ''}${className ? ` ${className}` : ''}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Лист снизу в игровом наряде: деревянная рама, лента с заголовком,
 * крестик. Для больших меню (лагерь), где окну по центру тесно.
 */
export function GxSheet({
  title,
  onClose,
  tabs,
  children,
  className,
}: PropsWithChildren<{
  title: ReactNode;
  onClose: () => void;
  /** Вкладки над содержимым — не прокручиваются вместе с ним. */
  tabs?: ReactNode;
  className?: string;
}>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);
  return (
    <div className="gx gx-sheet" onClick={onClose}>
      <div
        className={`gx-sheet__box${className ? ` ${className}` : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gx-ribbon gx-sheet__title">{title}</div>
        <button
          type="button"
          className="gx-round gx-round--red gx-sheet__close"
          aria-label="Закрыть"
          onClick={() => {
            tapLight();
            onClose();
          }}
        >
          <KIcon name="cross" />
        </button>
        <div className="gx-panel gx-panel--wood-fancy gx-sheet__frame">
          {tabs && <div className="gx-sheet__tabs">{tabs}</div>}
          <div className="gx-panel gx-sheet__body">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Шапка игрового экрана: назад, лента с названием, плашки валют. */
export function GameTop({
  title,
  onBack,
  chips,
  right,
}: {
  title: ReactNode;
  onBack?: () => void;
  chips?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="gx gx-top">
      <div className="gx-top__row">
        {onBack ? (
          <button
            type="button"
            className="gx-round gx-round--dark gx-top__side"
            aria-label="Назад"
            onClick={() => {
              tapLight();
              onBack();
            }}
          >
            <KIcon name="arrowLeft" />
          </button>
        ) : (
          <span className="gx-top__side" />
        )}
        <div className="gx-ribbon gx-top__title">{title}</div>
        {right ?? <span className="gx-top__side" />}
      </div>
      {chips && <div className="gx-top__chips">{chips}</div>}
    </div>
  );
}
