// Каркас экрана игры: шапка, навигация, главное, панель подробностей,
// нижняя полоса действий — и раскладка под формат (game-shell.css):
//   phone-portrait  — шапка, главное и панель стопкой (одна прокрутка),
//                     полоса действий и навигация снизу, под большой палец;
//   phone-landscape — рейка слева, главное, панель справа во всю высоту;
//   tablet          — рейка, главное, панель справа;
//   desktop         — колонка навигации с подписями, главное, панель;
//                     ширина ограничена, всё по центру.

import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Action } from '@/input/actions';
import { useAction, useHotkeys } from '@/input/hooks';
import { Prompt } from '@/input/Prompt';

export interface GameScreenProps {
  /** Главное: список, поле, сетка. */
  children: ReactNode;
  /** Шапка (GameTop или своя). */
  top?: ReactNode;
  /** Навигация (обычно <GameNav>). */
  nav?: ReactNode;
  /** Панель подробностей: крупный вид выбранного, характеристики. */
  side?: ReactNode;
  /** Полоса действий под главным (кнопки «Купить», «Взять в отряд»). */
  bottom?: ReactNode;
  /** Фон-сцена за всем (абсолютный слой). */
  bg?: ReactNode;
  /** Телефон стоя: панель над главным (крупный вид сверху, список под ним). */
  sideFirst?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Метка для чтения с экрана. */
  label?: string;
}

export function GameScreen({
  children,
  top,
  nav,
  side,
  bottom,
  bg,
  sideFirst,
  className,
  style,
  label,
}: GameScreenProps) {
  return (
    <div
      className={`gs${className ? ` ${className}` : ''}`}
      style={style}
      data-side={side ? '' : undefined}
      data-nav={nav ? '' : undefined}
      data-side-first={sideFirst ? '' : undefined}
      aria-label={label}
    >
      {bg && (
        <div className="gs__bg" aria-hidden="true">
          {bg}
        </div>
      )}
      {top && <div className="gs__top">{top}</div>}
      {nav && <div className="gs__nav">{nav}</div>}
      <div className="gs__body">
        <main className="gs__main">{children}</main>
        {side && <aside className="gs__side">{side}</aside>}
      </div>
      {bottom && <div className="gs__bottom">{bottom}</div>}
    </div>
  );
}

export interface GameNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** «!», число, ключик. */
  badge?: ReactNode;
  /** Горячая клавиша (I, P, F…): работает, пока навигация на верхнем слое. */
  hotkey?: Action;
  disabled?: boolean;
}

export interface GameNavProps {
  items: readonly GameNavItem[];
  active?: string | null;
  onSelect: (id: string) => void;
  /** Tab/Shift+Tab и LB/RB листают пункты по кругу (по умолчанию да). */
  cycle?: boolean;
  label?: string;
  className?: string;
}

/** Навигация экрана: нижняя полоса на телефоне стоя, рейка сбоку на
 *  остальных форматах. Кнопки — с подсказкой мыши «Питомцы · P». */
export function GameNav({ items, active, onSelect, cycle = true, label, className }: GameNavProps) {
  const ref = useRef<HTMLElement>(null);
  const enabled = items.filter((it) => !it.disabled);

  useAction(
    ['tabPrev', 'tabNext'],
    (e) => {
      if (!enabled.length) return false;
      const i = enabled.findIndex((it) => it.id === active);
      const step = e.action === 'tabNext' ? 1 : -1;
      const next = enabled[(i + step + enabled.length) % enabled.length] ?? enabled[0]!;
      onSelect(next.id);
      return true;
    },
    { enabled: cycle && enabled.length > 1, phases: ['down', 'repeat'], scope: ref },
  );

  const hot: Partial<Record<Action, () => void>> = {};
  for (const it of enabled) if (it.hotkey) hot[it.hotkey] = () => onSelect(it.id);
  useHotkeys(hot, { scope: ref });

  return (
    <nav ref={ref} className={`gs-nav${className ? ` ${className}` : ''}`} aria-label={label}>
      {cycle && enabled.length > 1 && <Prompt action="tabPrev" className="gs-nav__pad" />}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="gs-nav__btn"
          aria-current={it.id === active ? 'page' : undefined}
          disabled={it.disabled}
          data-tip={it.label}
          data-tip-key={it.hotkey}
          onClick={() => onSelect(it.id)}
        >
          {it.icon && <span className="gs-nav__icon">{it.icon}</span>}
          <span className="gs-nav__label">{it.label}</span>
          {it.badge != null && it.badge !== false && (
            <span className="gs-nav__badge">{it.badge}</span>
          )}
        </button>
      ))}
      {cycle && enabled.length > 1 && <Prompt action="tabNext" className="gs-nav__pad" />}
    </nav>
  );
}
