// Навигация фокусом без мыши: стрелки/крестовина ведут к ближайшей кнопке в
// нужную сторону ВНУТРИ верхнего слоя (окно поверх страницы — его кнопки,
// а не кнопки под ним). Подтверждение с геймпада нажимает кнопку в фокусе.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Сосед в направлении `dir`: кандидат должен лежать по ту сторону (центр за
 * серединой и ближний край не глубже половины меньшей стороны внутри), счёт
 * — расстояние вдоль оси + удвоенный зазор поперёк (ряд/колонка важнее
 * близости) + десятая доля несоосности центров (ровнее — лучше).
 * Возвращает индекс или −1.
 */
export function pickNeighbour(from: Box, cands: readonly Box[], dir: Dir): number {
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const fc = horiz ? from.x + from.w / 2 : from.y + from.h / 2;
  const fLo = horiz ? from.y : from.x;
  const fHi = horiz ? from.y + from.h : from.x + from.w;
  const fOc = (fLo + fHi) / 2;
  let best = -1;
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    if (c === from) return;
    const cc = horiz ? c.x + c.w / 2 : c.y + c.h / 2;
    if ((cc - fc) * sign <= 0.5) return;
    // Расстояние вдоль оси: от нашего дальнего края до его ближнего.
    const fFar = horiz
      ? sign > 0
        ? from.x + from.w
        : from.x
      : sign > 0
        ? from.y + from.h
        : from.y;
    const cNear = horiz ? (sign > 0 ? c.x : c.x + c.w) : sign > 0 ? c.y : c.y + c.h;
    const along = (cNear - fFar) * sign;
    const minSide = Math.min(horiz ? from.w : from.h, horiz ? c.w : c.h);
    if (along < -minSide / 2) return;
    const cLo = horiz ? c.y : c.x;
    const cHi = horiz ? c.y + c.h : c.x + c.w;
    const gap = Math.max(0, cLo - fHi, fLo - cHi);
    const off = Math.abs((cLo + cHi) / 2 - fOc);
    const score = Math.max(0, along) + gap * 2 + off * 0.1;
    if (score < bestScore - 1e-6) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ---- DOM ------------------------------------------------------------------

export const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"]:not([aria-disabled="true"]), [data-focusable]';

/** Слой, объявленный явно (`data-ui-layer`), иначе — фиксированная обёртка,
 *  которая лежит под центром экрана и закрывает его больше чем наполовину
 *  (GxModal, GxSheet, сцены сундуков и яиц, инвентарь), иначе — страница. */
export function topLayer(): HTMLElement {
  const explicit = [...document.querySelectorAll<HTMLElement>('[data-ui-layer]')].filter(visible);
  const last = explicit[explicit.length - 1];
  if (last) return last;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let el = document.elementFromPoint(vw / 2, vh / 2) as HTMLElement | null;
  let found: HTMLElement | null = null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (getComputedStyle(el).position === 'fixed') {
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= vw * vh * 0.5) found = el;
    }
    el = el.parentElement;
  }
  return found ?? document.body;
}

/** Элемент на верхнем слое (горячие клавиши страницы молчат под окном). */
export function inTopLayer(el: Element | null): boolean {
  if (!el) return false;
  return topLayer().contains(el);
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= -1 && !el.hasAttribute('data-nofocus') && visible(el),
  );
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

let marked: HTMLElement | null = null;

/** Поставить фокус и метку `data-focus` (рамка видна и при фокусе от
 *  геймпада, где браузер не считает фокус «клавиатурным»). */
export function focusEl(el: HTMLElement): void {
  if (marked && marked !== el) delete marked.dataset.focus;
  marked = el;
  el.dataset.focus = '';
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const off = () => {
    if (marked === el) {
      delete el.dataset.focus;
      marked = null;
    }
    el.removeEventListener('blur', off);
  };
  el.addEventListener('blur', off);
}

/** Первая цель в слое: `data-autofocus`, иначе выбранная вкладка/кнопка
 *  (`aria-current`, `aria-selected`), иначе верхняя-левая. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  const list = focusablesIn(root);
  if (!list.length) return null;
  const pref =
    list.find((el) => el.hasAttribute('data-autofocus')) ??
    list.find(
      (el) =>
        el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-current') === 'page',
    );
  if (pref) return pref;
  return [...list].sort((a, b) => {
    const A = boxOf(a);
    const B = boxOf(b);
    return Math.abs(A.y - B.y) > 8 ? A.y - B.y : A.x - B.x;
  })[0]!;
}

/** Сдвинуть фокус. false — двигаться некуда (пусть браузер прокрутит). */
export function moveFocus(dir: Dir): boolean {
  const layer = topLayer();
  const cur = document.activeElement as HTMLElement | null;
  const list = focusablesIn(layer);
  if (!cur || cur === document.body || !layer.contains(cur) || !list.includes(cur)) {
    const first = firstFocusable(layer);
    if (!first) return false;
    focusEl(first);
    return true;
  }
  const from = boxOf(cur);
  const boxes = list.map(boxOf);
  const i = pickNeighbour(
    from,
    boxes.map((b, k) => (list[k] === cur ? from : b)),
    dir,
  );
  const next = i >= 0 ? list[i] : null;
  if (!next) return false;
  focusEl(next);
  return true;
}

/** Нажать то, что в фокусе (геймпад «A»). */
export function activateFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) {
    const first = firstFocusable(topLayer());
    if (!first) return false;
    focusEl(first);
    return true;
  }
  el.click();
  return true;
}
