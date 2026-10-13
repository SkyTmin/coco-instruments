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
 * Сосед в направлении `dir` (как FocusFinder в Android): кандидат лежит по ту
 * сторону (центр дальше нашего, ближний край не глубже половины меньшей
 * стороны внутри). Кандидат «в луче» (перекрывает нас поперёк оси) бьёт
 * кандидата вне луча: по горизонтали — всегда (свой ряд важнее близкой
 * диагонали), по вертикали — если он ближе, чем дальний край другого. Дальше —
 * взвешенное расстояние 13·вдоль² + поперёк² (поперёк — между центрами).
 * Возвращает индекс или −1.
 */
export function pickNeighbour(from: Box, cands: readonly Box[], dir: Dir): number {
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const lo = (b: Box) => (horiz ? b.x : b.y);
  const hi = (b: Box) => (horiz ? b.x + b.w : b.y + b.h);
  const olo = (b: Box) => (horiz ? b.y : b.x);
  const ohi = (b: Box) => (horiz ? b.y + b.h : b.x + b.w);
  const fc = (lo(from) + hi(from)) / 2;
  const fFar = sign > 0 ? hi(from) : lo(from);
  const fOc = (olo(from) + ohi(from)) / 2;
  interface Cand {
    i: number;
    beam: boolean;
    along: number;
    alongFar: number;
    minor: number;
  }
  const list: Cand[] = [];
  cands.forEach((c, i) => {
    if (c === from) return;
    if (((lo(c) + hi(c)) / 2 - fc) * sign <= 0.5) return;
    const near = sign > 0 ? lo(c) : hi(c);
    const far = sign > 0 ? hi(c) : lo(c);
    const along = (near - fFar) * sign;
    const minSide = Math.min(hi(from) - lo(from), hi(c) - lo(c));
    if (along < -minSide / 2) return;
    const beam = Math.min(ohi(c), ohi(from)) - Math.max(olo(c), olo(from)) > 0;
    list.push({
      i,
      beam,
      along: Math.max(0, along),
      alongFar: Math.max(0, (far - fFar) * sign),
      minor: Math.abs((olo(c) + ohi(c)) / 2 - fOc),
    });
  });
  const beamBeats = (a: Cand, b: Cand) => a.beam && !b.beam && (horiz || a.along < b.alongFar);
  const weight = (a: Cand) => 13 * a.along * a.along + a.minor * a.minor;
  let best: Cand | null = null;
  for (const c of list) {
    if (!best) best = c;
    else if (beamBeats(c, best)) best = c;
    else if (beamBeats(best, c)) continue;
    else if (weight(c) < weight(best) - 1e-6) best = c;
  }
  return best ? best.i : -1;
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
  // Ближайший к точке «экран поверх»: окно паузы лежит ВНУТРИ экрана
  // подземелья, а тот тоже fixed во весь экран, — берём самый внутренний
  // такой слой, где есть что фокусировать (слой холста без кнопок — мимо).
  let el = document.elementFromPoint(vw / 2, vh / 2) as HTMLElement | null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (getComputedStyle(el).position === 'fixed') {
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= vw * vh * 0.5 && focusablesIn(el).length > 0) return el;
    }
    el = el.parentElement;
  }
  return document.body;
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

/** Крестик окна не берёт фокус первым: закрыть можно и «Назад». */
function closer(el: HTMLElement): boolean {
  return el.hasAttribute('data-focus-last') || /(^|\s)[\w-]+__close(\s|$)/.test(el.className);
}

/** Первая цель в слое: `data-autofocus`, иначе выбранная вкладка/кнопка
 *  (`aria-current`, `aria-selected`), иначе верхняя-левая (крестик — последним). */
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
  const open = list.filter((el) => !closer(el));
  return [...(open.length ? open : list)].sort((a, b) => {
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
