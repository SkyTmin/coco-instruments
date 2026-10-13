// Игровой интерфейс (gx): иконки-маски, окна, шапка, полоски. Окна и шапка (волна 2) —
// на пиксельном наборе `@/ui-px` (рамки Panel, лента, кнопки набора); стили каркаса —
// `gx-px.css`, старые виджеты — src/game-ui.css; картинки — public/ui (Kenney CC0,
// game-icons CC BY 3.0). Правила: .claude/rules/game-ui.md (часть «Окна и шапка»).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { registerEscape } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';
import { uiClose, uiOpen, uiTap } from '@/lib/sound';
import { useT } from '@/i18n';
import { useFormFactor } from '@/game-shell';
import { Button, Panel } from '@/ui-px';
import type { Material, PxIconName } from '@/ui-px';
import './gx-px.css';

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
  | 'medal'
  | 'fishing'
  | 'fish'
  | 'fish-bucket'
  | 'egg'
  | `pet-${string}`;

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
  | 'musicOn'
  | 'musicOff'
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

/** Kenney значки, у которых есть пиксельная пара в наборе (`@/ui-px` ICONS): рисуются ею —
 *  маска 9×9, цвет `currentColor`, размер — целое число точек экрана на точку рисунка. */
const KIT_ICON: Partial<Record<KIconName, PxIconName>> = {
  cross: 'x',
  arrowLeft: 'left',
  arrowRight: 'right',
  arrowUp: 'up',
  arrowDown: 'down',
  checkmark: 'check',
  plus: 'plus',
  minus: 'minus',
  star: 'star',
  locked: 'lock',
  information: 'info',
  pause: 'pause',
  gear: 'gear',
  audioOn: 'sound',
  audioOff: 'mute',
  musicOn: 'music',
  musicOff: 'nomusic',
  question: 'question',
  exclamation: 'excl',
};

/** `size` CSS px → a box of 9 art pixels, each a whole number of device pixels. */
function kitIconBox(size: number): CSSProperties {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const a = Math.max(1, Math.round((size * dpr) / 9)) / dpr;
  return { width: a * 9, height: a * 9 };
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
  const kit = KIT_ICON[name];
  if (kit)
    return (
      <i
        className={`px-i pxi-${kit} gx-kicon${className ? ` ${className}` : ''}`}
        aria-hidden="true"
        style={size ? { ...kitIconBox(size), ...style } : style}
      />
    );
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

/** Полоска: `value` от 0 до 1, подпись поверх. Вид — полоса набора (жёлоб + заливка). */
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
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <i style={{ transform: `scaleX(${v})` }} />
      {label != null && <b>{label}</b>}
    </div>
  );
}

// ---- Окна ----------------------------------------------------------------------------------

/** Старое содержимое окон нарисовано в CSS-пикселях под телефон. На 1080p и выше (масштаб
 *  набора ≥ 4) тело окна увеличивается целым `zoom: 2`, чтобы старые экраны не были мелкими;
 *  содержимое на наборе (`.px` внутри) не увеличивается — у него свои единицы `--u`. */
function useWinZoom(): number {
  const { scale } = useFormFactor();
  return scale >= 4 ? 2 : 1;
}

/** Каркас окна и листа: затемнение, деревянная рамка набора, лента, крестик набора, тело с
 *  своей прокруткой. Esc / «Назад» / B закрывают верхнее окно (escape-stack). */
function GxWindow({
  sheet,
  title,
  onClose,
  frame,
  body,
  tabs,
  boxClass,
  bodyClass,
  children,
}: PropsWithChildren<{
  sheet?: boolean;
  title?: ReactNode;
  onClose: () => void;
  frame: Material;
  body: Material;
  tabs?: ReactNode;
  boxClass?: string;
  bodyClass?: string;
}>) {
  const t = useT();
  const z = useWinZoom();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    uiOpen();
    const off = registerEscape(() => closeRef.current());
    return () => {
      off();
      uiClose();
    };
  }, []);
  const k = sheet ? 'gx-sheet' : 'gx-modal';
  return (
    <div
      className={`gx ${k} gx-win gx-win--${sheet ? 'sheet' : 'modal'}`}
      data-ui-layer=""
      style={{ '--gx-z': z } as CSSProperties}
      onClick={onClose}
    >
      <Panel
        material={frame}
        className={`${k}__box${sheet ? ' gx-sheet__frame' : ''} gx-win__box${tabs ? ' has-tabs' : ''}${title ? ' has-title' : ''}${boxClass ? ` ${boxClass}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={`px-ribbon ${k}__title gx-win__title`}>
            <span>{title}</span>
          </div>
        )}
        <Button
          kind="danger"
          size="sm"
          icon="x"
          label={t('common.close')}
          className={`${k}__close gx-win__close`}
          onClick={() => {
            tapLight();
            onClose();
          }}
        />
        {tabs && <div className="gx-sheet__tabs gx-win__tabs">{tabs}</div>}
        <Panel
          material={body}
          className={`${k}__body gx-win__body${title ? ' has-title' : ''}${bodyClass ? ` ${bodyClass}` : ''}`}
        >
          {children}
        </Panel>
      </Panel>
    </div>
  );
}

const MODAL_LOOK: Record<'paper' | 'wood' | 'iron' | 'iron-dark', [Material, Material]> = {
  paper: ['wood', 'parch'],
  wood: ['wood', 'well'],
  iron: ['iron', 'parch'],
  'iron-dark': ['iron', 'well'],
};

/**
 * Окно поверх игры: затемнение, рамка, лента с заголовком, крестик.
 * «Назад» Telegram и Esc закрывают его первым (escape-stack). `className` — на тело окна
 * (как и раньше); `kind` выбирает материалы набора: рамка (дерево/железо) и тело
 * (пергамент — тёмный текст, колодец — светлый).
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
  const [frame, body] = MODAL_LOOK[kind];
  return (
    <GxWindow title={title} onClose={onClose} frame={frame} body={body} bodyClass={className}>
      {children}
    </GxWindow>
  );
}

/**
 * Лист в игровом наряде: на телефоне стоя — снизу во всю ширину, иначе — окно по центру.
 * Для больших меню (лагерь, торговец). `className` — на рамку листа (как и раньше).
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
  /** Вкладки рядом с содержимым — не прокручиваются вместе с ним. */
  tabs?: ReactNode;
  className?: string;
}>) {
  return (
    <GxWindow
      sheet
      title={title}
      onClose={onClose}
      frame="wood"
      body="parch"
      tabs={tabs}
      boxClass={className}
    >
      {children}
    </GxWindow>
  );
}

/** Шапка игрового экрана в одну строку: назад, лента с названием, фишки валют, кнопки справа.
 *  Высота — `--gx-top-h`: окна начинаются ниже неё, крестик окна не ложится на ⚙ шапки. */
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
  const t = useT();
  // One row: when back + title + chips + buttons don't fit, the title is hidden (`is-tight`)
  // until the row is as wide as it was when it overflowed.
  const row = useRef<HTMLDivElement>(null);
  const need = useRef(0);
  const [tight, setTight] = useState(false);
  const hasChips = chips != null;
  const hasRight = right != null;
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => {
      if (!el.classList.contains('is-tight')) {
        if (el.scrollWidth > el.clientWidth + 1) {
          need.current = el.scrollWidth;
          setTight(true);
        }
      } else if (el.clientWidth >= need.current) setTight(false);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [title, hasChips, hasRight]);
  return (
    <div className={`gx gx-top${chips ? ' has-chips' : ''}`}>
      <div ref={row} className={`gx-top__row${tight ? ' is-tight' : ''}`}>
        {onBack ? (
          <Button
            icon="left"
            label={t('common.back')}
            className="gx-top__side gx-top__back"
            onClick={() => {
              tapLight();
              uiTap();
              onBack();
            }}
          />
        ) : (
          <span className="gx-top__side" />
        )}
        <div className="px-ribbon gx-top__title">
          <span>{title}</span>
        </div>
        {chips && <div className="gx-top__chips">{chips}</div>}
        <div className="gx-top__right">{right}</div>
      </div>
    </div>
  );
}
