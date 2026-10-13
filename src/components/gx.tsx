// Игровой интерфейс (gx): иконки-маски, окна, шапка, полоски. Окна и шапка (волна 2) —
// на пиксельном наборе `@/ui-px` (рамки Panel, лента, кнопки набора); стили каркаса —
// `gx-px.css`, старые виджеты — src/game-ui.css; картинки — public/ui (Kenney CC0,
// game-icons CC BY 3.0). Правила: .claude/rules/game-ui.md (часть «Окна и шапка»).

import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { registerEscape } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';
import { uiClose, uiOpen, uiTap } from '@/lib/sound';
import { fmtCompact, fmtNum, useT } from '@/i18n';
import { useFormFactor } from '@/game-shell';
import { Button, Panel, usePress } from '@/ui-px';
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

const GameSettingsLazy = lazy(() =>
  import('@/settings').then((m) => ({ default: m.GameSettings })),
);

/**
 * A GameTop chip given as data (preferred over ready nodes): GameTop prints the number short
 * (`fmtCompact`) at a fixed width, hides it by priority when the row runs out of room, and shows
 * the exact value in the mouse tip and in the wallet popover (opened by the money chip — the
 * first priority-1 chip that is not an action).
 */
export interface TopChip {
  id: string;
  icon: ReactNode;
  /** Number — short in the chip, exact in the tip / wallet; text — as is. None — icon only. */
  value?: number | string;
  /** What it is: the tip, the wallet row, the screen reader. */
  name: string;
  /** 1 — never hidden (money; actions always are); 3 — hidden first. Default 2. */
  pri?: 1 | 2 | 3;
  /** Minimum width of the value in `ch`: a changing number never moves its neighbours. */
  ch?: number;
  /** An action chip (the dungeon's backpack): a button, never hidden, not in the wallet. */
  onClick?: () => void;
  className?: string;
}

// Fit levels — `data-fit` on the row, set straight on the DOM before paint (no React render, so
// nothing flashes): 0 everything; 1 the title goes (sr-only, `is-tight`); 2 the right-hand group
// folds into one ⚙ (GameSettings on the Sound tab); 3 chips `data-pri=3` go; 4 `data-pri=2` go.
// Money and action chips never go. The first level that fits wins.
const FIT_MAX = 4;

function rowFits(el: HTMLElement, level: number): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return false;
  if (level > 0) return true;
  // The title never ends in «…»: a cut title is a hidden title.
  const title = el.querySelector<HTMLElement>('.gx-top__title > span');
  return !title || title.scrollWidth <= title.clientWidth + 1;
}

function fitRow(el: HTMLElement, hasRight: boolean): void {
  for (let level = 0; level <= FIT_MAX; level++) {
    if (level === 2 && !hasRight) continue;
    el.dataset.fit = String(level);
    el.classList.toggle('is-tight', level > 0);
    if (rowFits(el, level)) return;
  }
}

function chipValue(c: TopChip): { short: string; exact: string } | null {
  if (c.value == null || c.value === '') return null;
  if (typeof c.value === 'number') return { short: fmtCompact(c.value), exact: fmtNum(c.value) };
  return { short: c.value, exact: c.value };
}

/** Шапка игрового экрана в одну строку: назад, лента с названием, фишки валют, кнопки справа.
 *  Высота — `--gx-top-h`: окна начинаются ниже неё, крестик окна не ложится на ⚙ шапки.
 *  Не влезает — по очереди: прячется название, правые кнопки сворачиваются в ⚙, уходят фишки
 *  по приоритету (деньги — никогда). */
export function GameTop({
  title,
  onBack,
  chips,
  right,
}: {
  title: ReactNode;
  onBack?: () => void;
  /** `TopChip[]` (short numbers, priorities, wallet) or ready nodes (kept as they are). */
  chips?: ReactNode | TopChip[];
  /** Sound / music / ⚙ — only what GameSettings also has: a short row folds it into one ⚙. */
  right?: ReactNode;
}) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const press = usePress();
  const [gear, setGear] = useState(false);
  const [purse, setPurse] = useState<number | null>(null);
  const hasChips = chips != null && chips !== false;
  const hasRight = right != null && right !== false;
  const list = Array.isArray(chips) ? (chips as TopChip[]) : null;
  const walletId = list?.find((c) => !c.onClick && (c.pri ?? 2) === 1 && c.value != null)?.id;

  const fit = useRef(() => {});
  fit.current = () => {
    if (row.current) fitRow(row.current, hasRight);
  };
  // Every render: a new number, language or chip set may need another level.
  useLayoutEffect(() => fit.current());
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const again = () => fit.current();
    const ro = new ResizeObserver(again);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    // A web font that arrives later widens the title / numbers without resizing their boxes.
    document.fonts?.addEventListener?.('loadingdone', again);
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', again);
    };
  }, [hasChips, hasRight]);

  // Wallet popover: Esc / «Назад» / a tap anywhere else closes it.
  const open = purse != null;
  useEffect(() => {
    if (!open) return undefined;
    const off = registerEscape(() => setPurse(null));
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('.gx-wallet, .gx-chip--purse')) setPurse(null);
    };
    window.addEventListener('pointerdown', away, true);
    return () => {
      off();
      window.removeEventListener('pointerdown', away, true);
    };
  }, [open]);

  const chipEls = list
    ? list.map((c) => {
        const v = chipValue(c);
        const pri = c.onClick ? 1 : (c.pri ?? 2);
        const label = v ? `${c.name}: ${v.exact}` : c.name;
        const body = (
          <>
            {c.icon}
            {v && (
              <span className="gx-chip__v" style={c.ch ? { minWidth: `${c.ch}ch` } : undefined}>
                {v.short}
              </span>
            )}
          </>
        );
        const cls = `gx-chip${c.className ? ` ${c.className}` : ''}`;
        if (c.onClick)
          return (
            <button
              key={c.id}
              type="button"
              className={`${cls} gx-chip--btn`}
              data-pri={pri}
              aria-label={label}
              data-tip={label}
              {...press}
              onClick={c.onClick}
            >
              {body}
            </button>
          );
        if (c.id === walletId)
          return (
            <button
              key={c.id}
              type="button"
              className={`${cls} gx-chip--btn gx-chip--purse`}
              data-pri={pri}
              aria-label={label}
              aria-expanded={open}
              aria-haspopup="dialog"
              data-tip={label}
              {...press}
              onClick={(e) => {
                tapLight();
                uiTap();
                const box = top.current?.getBoundingClientRect();
                const r = e.currentTarget.getBoundingClientRect();
                setPurse(open ? null : r.left - (box?.left ?? 0));
              }}
            >
              {body}
            </button>
          );
        return (
          <span
            key={c.id}
            className={cls}
            data-pri={pri}
            role="img"
            aria-label={label}
            data-tip={label}
          >
            {body}
          </span>
        );
      })
    : (chips as ReactNode);

  return (
    <div ref={top} className={`gx gx-top${hasChips ? ' has-chips' : ''}`}>
      <div ref={row} className="gx-top__row">
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
        {hasChips && <div className="gx-top__chips">{chipEls}</div>}
        <div className="gx-top__right">{right}</div>
        {hasRight && (
          <button
            type="button"
            className="gx-round gx-round--dark gx-top__gear"
            aria-label={t('common.settings')}
            data-tip={t('common.settings')}
            {...press}
            onClick={() => {
              tapLight();
              uiTap();
              setGear(true);
            }}
          >
            <KIcon name="gear" />
          </button>
        )}
      </div>
      {open && list && <Wallet chips={list} x={purse} onClose={() => setPurse(null)} />}
      {gear &&
        createPortal(
          <Suspense fallback={null}>
            <GameSettingsLazy initial="sound" onClose={() => setGear(false)} />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}

/** The shared wallet: every value chip of the row with its exact number. */
function Wallet({ chips, x, onClose }: { chips: TopChip[]; x: number; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  // Keep it on screen: shift left when it would run past the right edge.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent?.getBoundingClientRect();
    if (!el || !box) return;
    const over = box.left + x + el.offsetWidth - (window.innerWidth - 4);
    setLeft(Math.max(-box.left + 4, x - Math.max(0, over)));
  }, [x]);
  const rows = chips.filter((c) => !c.onClick && chipValue(c));
  return (
    <div
      ref={ref}
      className="gx-wallet px"
      role="dialog"
      aria-label={t('hall.wallet')}
      style={{ left } as CSSProperties}
      onClick={onClose}
    >
      <Panel material="parch" className="gx-wallet__box">
        <b className="gx-wallet__h">{t('hall.wallet')}</b>
        {rows.map((c) => (
          <div key={c.id} className="gx-wallet__row">
            <span className="gx-wallet__i">{c.icon}</span>
            <span className="gx-wallet__n">{c.name}</span>
            <b className="gx-wallet__v px-num">{chipValue(c)?.exact}</b>
          </div>
        ))}
      </Panel>
    </div>
  );
}
