// Поле шахты — общее для каторги и для шахт подземелья.
//
// Здесь всё, что делает яму ямой и удар ударом: клетки с глубиной и тенью
// от стенок, трещины, пальцы (тап, удержание, ведение по жиле), кирка на
// клетке, крошка на канве, всплывающие надписи и волны чар. Правила — чья
// порода, сколько она стоит, куда идёт добыча — остаются странице: она
// отдаёт их хуку `useMineDig` и получает обратно слом блоков через
// `onBreak`. Так шахта подземелья выглядит и бьётся точь-в-точь как шахта
// каторги, но копает в свой сидор, а не в рюкзак.

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react';
import {
  CRIT_CHANCE,
  CRIT_MULT,
  blastCells,
  MINE_CELLS,
  MINE_COLS,
  MINE_ROWS,
  ROCKFALL_HITS,
} from '@/lib/prison';
import type { RockKind } from '@/lib/prison';
import { crackTexture } from '@/lib/prison-art';
import { createFx } from '@/lib/prison-fx';
import type { Fx } from '@/lib/prison-fx';
import { addTrauma, flashFrame } from '@/lib/juice';
import {
  bedrockClink,
  blockBreak,
  boom,
  chainTick,
  mineRumble,
  pickHit,
  primeAudio,
  tierBreak,
} from '@/lib/sound';
import { selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// ---------------------------------------------------------------------------
// Клетка. Сверху видно торец верхнего блока; чем глубже раскоп, тем темнее и
// чуть меньше торец (яма уходит вниз), а стенки соседей отбрасывают тень
// внутрь — свет падает сверху-слева.
// ---------------------------------------------------------------------------

export interface MineCellProps {
  index: number;
  /** Картинка торца. */
  tex: string;
  /** Дно: коренная порода, её не берёт ни одна кирка. */
  bottom: boolean;
  depth: number;
  crack: number;
  /** Лупа: картинка породы ярусом ниже (пусто — не показывать). */
  peek: string;
  /** Сверху порода, которую сейчас ищут (норма, конвой, заказ). */
  need: boolean;
  /** Сверху сейд-камень: светится. */
  seid: boolean;
  /** Лупа: сейд в этой клетке на столько ярусов ниже (0 — нет). */
  seidBelow: number;
  /** Картинка сейда для метки лупы. */
  seidTex?: string;
  wt: number;
  wl: number;
  wb: number;
  wr: number;
  faceRef: (index: number, el: HTMLSpanElement | null) => void;
}

export const MineCell = memo(function MineCell({
  index,
  tex,
  bottom,
  depth,
  crack,
  peek,
  need,
  seid,
  seidBelow,
  seidTex,
  wt,
  wl,
  wb,
  wr,
  faceRef,
}: MineCellProps) {
  const x = index % MINE_COLS;
  const y = Math.floor(index / MINE_COLS);
  // Задержка подъёма при обновлении шахты: волна от центра к краям.
  const rise = Math.hypot(x - (MINE_COLS - 1) / 2, y - (MINE_ROWS - 1) / 2);
  const style = {
    '--d': depth,
    '--wt': wt,
    '--wl': wl,
    '--wb': wb,
    '--wr': wr,
    '--rd': `${Math.round(rise * 34)}ms`,
  } as CSSProperties;
  return (
    <div className={`pcell${bottom ? ' is-bottom' : ''}${seid ? ' is-seid' : ''}`} style={style}>
      <span
        className="pcell__face"
        ref={(el) => faceRef(index, el)}
        style={{ backgroundImage: `url(${tex})` }}
      >
        {crack > 0 && (
          <i className="pcell__crack" style={{ backgroundImage: `url(${crackTexture(crack)})` }} />
        )}
      </span>
      {seid && <i className="pcell__glow" />}
      {seidBelow > 0 && seidTex ? (
        <span className="pcell__seidmark">
          <img src={seidTex} alt="" />
          <b>↓{seidBelow}</b>
        </span>
      ) : (
        peek && <img className="pcell__peek" src={peek} alt="" />
      )}
      {need && !seid && <i className="pcell__need" />}
    </div>
  );
});

/** Высота стены между клеткой и соседом: сосед выше — тень глубже. */
export function wall(dug: number[], c: number, dx: number, dy: number): number {
  const x = (c % MINE_COLS) + dx;
  const y = Math.floor(c / MINE_COLS) + dy;
  // За краем шахты — нетронутая порода: стена в полную глубину раскопа.
  const other = x < 0 || y < 0 || x >= MINE_COLS || y >= MINE_ROWS ? 0 : dug[y * MINE_COLS + x];
  return Math.max(0, dug[c] - other);
}

/** Кольца вокруг клетки: для волн отбойника и взрыва (по Чебышёву). */
export function rings(center: number, cells: number[]): number[][] {
  const cx = center % MINE_COLS;
  const cy = Math.floor(center / MINE_COLS);
  const out: number[][] = [];
  for (const c of cells) {
    const d = Math.max(Math.abs((c % MINE_COLS) - cx), Math.abs(Math.floor(c / MINE_COLS) - cy));
    (out[d] ??= []).push(c);
  }
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Поле: разметка, пальцы, эффекты.
// ---------------------------------------------------------------------------

export interface MineFieldHandle {
  /** Само поле — для тряски и замеров. */
  readonly el: HTMLDivElement | null;
  /** Слой всплывающих надписей и летящей добычи. */
  readonly layer: HTMLDivElement | null;
  /** Центр клетки и её размер в пикселях поля. */
  center(c: number): { x: number; y: number; size: number };
  /** Всплывающая надпись над клеткой: «КРИТ», «ВЗРЫВ», «+3 токена». */
  float(c: number, text: string, cls: string, delay?: number): void;
  /** Кирка на клетке: качнулась и ударила. */
  swing(c: number, crit: boolean): void;
  /** Ударная волна: кольцо по полю от клетки. */
  shockwave(c: number, cells: number, hot?: boolean): void;
  /** Полоса луча через весь ряд клетки. */
  beam(c: number): void;
  chips(c: number, colors: string[], n: number, power?: number): void;
  puff(c: number, color: string, n?: number): void;
  /** Торец вздрогнул от удара. */
  kick(c: number, crit: boolean): void;
  /** Под сломанным блоком открылся следующий: он «проступает» из ямы. */
  rise(c: number): void;
  /** Торец качнулся — удар по сейду. */
  wobble(c: number): void;
  /** Картинка летит дугой из клетки в элемент (рюкзак, сидор). */
  fly(c: number, src: string, target: HTMLElement | null, onLand?: () => void): void;
  trauma(amount: number): void;
  /** Отпустить удержание: палец ушёл, приложение свернули, открылся лист. */
  stop(): void;
}

interface MineFieldProps {
  /** Меняется вместе с шахтой: сетка пересобирается с подъёмом блоков. */
  gridKey: string;
  /** Клетки поля; `faceRef` отдаёт полю торцы — для вздрагивания и подъёма. */
  cells: (faceRef: (index: number, el: HTMLSpanElement | null) => void) => ReactNode;
  /** Кирка, которая ходит за пальцем. */
  pick: ReactNode;
  /** Ударов в секунду при удержании — спрашивается на каждом ударе. */
  rate: () => number;
  onHit: (c: number) => void;
  /** Тап забирает страница (бомба, прицел) — удара и удержания не будет. */
  onTap?: (c: number) => boolean;
  className?: string;
  /** Поверх сетки, под крошкой: метеорит, Куйва. */
  under?: ReactNode;
  /** Поверх всего: тост, карточки, подсказки. */
  children?: ReactNode;
}

export const MineField = forwardRef<MineFieldHandle, MineFieldProps>(function MineField(
  { gridKey, cells, pick, rate, onHit, onTap, className, under, children },
  ref,
) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const fx = useRef<Fx | null>(null);
  const faces = useRef<(HTMLSpanElement | null)[]>([]);
  const pointer = useRef<{ id: number; cell: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const [aiming, setAiming] = useState(false);

  // Удержание бьёт из таймера, заведённого при касании. Зовёт оно ВСЕГДА
  // свежие `onHit` и `rate`: иначе после обновления шахты под пальцем
  // таймер ломал бы породу прошлой шахты — у того замыкания своё поле.
  const hitRef = useRef(onHit);
  hitRef.current = onHit;
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const faceRef = useCallback((i: number, el: HTMLSpanElement | null) => {
    faces.current[i] = el;
  }, []);

  // Канва крошки живёт вместе с полем.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    fx.current = createFx(c);
    const onResize = () => fx.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      fx.current?.destroy();
      fx.current = null;
    };
  }, []);

  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    pointer.current = null;
    setAiming(false);
    pickRef.current?.classList.remove('is-on');
  }, []);

  // Свернули приложение посреди удержания — кирка не должна бить в фоне.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stopHold();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [stopHold]);

  const center = (c: number) => {
    const field = fieldRef.current;
    if (!field) return { x: 0, y: 0, size: 0 };
    const size = field.clientWidth / MINE_COLS;
    return {
      x: ((c % MINE_COLS) + 0.5) * size,
      y: (Math.floor(c / MINE_COLS) + 0.5) * size,
      size,
    };
  };

  const faceAnim = (c: number, frames: Keyframe[], ms: number, easing: string) => {
    const face = faces.current[c];
    if (!face || reduceMotion()) return;
    try {
      face.animate(frames, { duration: ms, easing });
    } catch {
      /* не страшно */
    }
  };

  const aimAt = (c: number) => {
    const el = aimRef.current;
    if (!el) return;
    const { x, y, size } = center(c);
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  };

  const handle: MineFieldHandle = {
    get el() {
      return fieldRef.current;
    },
    get layer() {
      return layerRef.current;
    },
    center,
    float(c, text, cls, delay = 0) {
      const layer = layerRef.current;
      if (!layer || !fieldRef.current || reduceMotion()) return;
      const { x, y } = center(c);
      const el = document.createElement('span');
      el.className = `pfloat ${cls}`;
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = '0';
      layer.appendChild(el);
      const done = () => el.remove();
      try {
        const a = el.animate(
          [
            { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
            { transform: 'translate(-50%, -110%) scale(1.15)', opacity: 1, offset: 0.2 },
            { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
          ],
          { duration: 760, delay, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        a.onfinish = done;
        a.oncancel = done;
      } catch {
        done();
      }
      setTimeout(done, 1400 + delay);
    },
    swing(c, crit) {
      const el = pickRef.current;
      if (!el || reduceMotion()) return;
      const { x, y, size } = center(c);
      el.style.setProperty('--px', `${x}px`);
      el.style.setProperty('--py', `${y}px`);
      el.style.setProperty('--ps', `${size}px`);
      el.classList.add('is-on');
      try {
        el.animate(
          [
            { transform: 'rotate(-38deg)' },
            { transform: `rotate(${crit ? 16 : 10}deg)`, offset: 0.45 },
            { transform: 'rotate(0deg)' },
          ],
          { duration: 170, easing: 'cubic-bezier(.5,0,.3,1)' },
        );
      } catch {
        /* без WAAPI просто стоит */
      }
    },
    shockwave(c, cells, hot = false) {
      const layer = layerRef.current;
      if (!layer || reduceMotion()) return;
      const { x, y, size } = center(c);
      const el = document.createElement('i');
      el.className = `pwave${hot ? ' pwave--hot' : ''}`;
      const d = size * cells;
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.style.left = `${x - d / 2}px`;
      el.style.top = `${y - d / 2}px`;
      layer.appendChild(el);
      const done = () => el.remove();
      try {
        const a = el.animate(
          [
            { transform: 'scale(.2)', opacity: 1 },
            { transform: 'scale(1.15)', opacity: 0 },
          ],
          { duration: 420 + cells * 25, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        a.onfinish = done;
        a.oncancel = done;
      } catch {
        done();
      }
      setTimeout(done, 1200);
    },
    beam(c) {
      const layer = layerRef.current;
      if (!layer || reduceMotion()) return;
      const { x, y, size } = center(c);
      const el = document.createElement('i');
      el.className = 'pbeam';
      el.style.top = `${y - size * 0.32}px`;
      el.style.height = `${size * 0.64}px`;
      el.style.transformOrigin = `${x}px 50%`;
      layer.appendChild(el);
      const done = () => el.remove();
      try {
        const a = el.animate(
          [
            { transform: 'scaleX(0)', opacity: 1 },
            { transform: 'scaleX(1)', opacity: 1, offset: 0.35 },
            { transform: 'scaleX(1) scaleY(.2)', opacity: 0 },
          ],
          { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        a.onfinish = done;
        a.oncancel = done;
      } catch {
        done();
      }
      setTimeout(done, 900);
    },
    chips(c, colors, n, power) {
      const { x, y } = center(c);
      fx.current?.chips(x, y, colors, n, power);
    },
    puff(c, color, n) {
      const { x, y } = center(c);
      fx.current?.puff(x, y, color, n);
    },
    kick(c, crit) {
      faceAnim(
        c,
        [
          { transform: 'scale(1)' },
          { transform: `scale(${crit ? 0.84 : 0.91})`, offset: 0.3 },
          { transform: 'scale(1.02)', offset: 0.7 },
          { transform: 'scale(1)' },
        ],
        150,
        'ease-out',
      );
    },
    rise(c) {
      faceAnim(
        c,
        [
          { transform: 'scale(.72)', opacity: 0.2 },
          { transform: 'scale(1.03)', opacity: 1, offset: 0.7 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        200,
        'cubic-bezier(.2,.8,.3,1)',
      );
    },
    wobble(c) {
      faceAnim(
        c,
        [
          { transform: 'scale(1)' },
          { transform: 'scale(.86) rotate(-3deg)', offset: 0.3 },
          { transform: 'scale(1.04) rotate(2deg)', offset: 0.7 },
          { transform: 'scale(1)' },
        ],
        200,
        'ease-out',
      );
    },
    fly(c, src, target, onLand) {
      const layer = layerRef.current;
      const field = fieldRef.current;
      if (!layer || !field || !target) return;
      if (reduceMotion() || layer.childElementCount > 14) {
        onLand?.();
        return;
      }
      const { x, y, size } = center(c);
      const fr = field.getBoundingClientRect();
      const br = target.getBoundingClientRect();
      const tx = br.left + Math.min(26, br.width / 2) - fr.left;
      const ty = br.top + br.height / 2 - fr.top;
      const img = document.createElement('img');
      img.className = 'ploot';
      img.src = src;
      img.alt = '';
      const s = size * 0.46;
      img.style.width = `${s}px`;
      img.style.height = `${s}px`;
      img.style.left = `${x - s / 2}px`;
      img.style.top = `${y - s / 2}px`;
      layer.appendChild(img);
      const dx = tx - x;
      const dy = ty - y;
      // Дуга: сначала вверх и в сторону, потом вниз в цель.
      const mx = dx * 0.35 + (Math.random() - 0.5) * 30;
      const my = Math.min(dy, 0) - 50;
      const done = () => img.remove();
      try {
        const a = img.animate(
          [
            { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
            {
              transform: `translate(${mx}px, ${my}px) scale(1.2) rotate(${Math.random() * 60 - 30}deg)`,
              opacity: 1,
              offset: 0.38,
            },
            { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(0deg)`, opacity: 0.9 },
          ],
          { duration: 520, easing: 'cubic-bezier(.45,0,.55,1)' },
        );
        a.onfinish = () => {
          done();
          onLand?.();
        };
        a.oncancel = done;
      } catch {
        done();
      }
      setTimeout(done, 1000);
    },
    trauma(amount) {
      addTrauma(fieldRef.current, amount);
    },
    stop: stopHold,
  };
  // Ручка — всегда свежая: у эффектов в замыкании ничего, кроме ссылок.
  useImperativeHandle(ref, () => handle);

  // ---- Пальцы: тап, удержание, ведение по жиле ---------------------------

  const cellAt = (cx: number, cy: number): number => {
    const r = rect.current;
    if (!r) return -1;
    const x = Math.floor(((cx - r.left) / r.width) * MINE_COLS);
    const y = Math.floor(((cy - r.top) / r.height) * MINE_ROWS);
    if (x < 0 || y < 0 || x >= MINE_COLS || y >= MINE_ROWS) return -1;
    return y * MINE_COLS + x;
  };

  // Шаг удержания пересчитывается на каждом ударе: энергетик или кураж,
  // начавшиеся под пальцем, ускоряют кирку сразу, без повторного касания.
  const holdTick = () => {
    const p = pointer.current;
    if (!p) return;
    if (p.cell >= 0) hitRef.current(p.cell);
    holdTimer.current = setTimeout(holdTick, 1000 / rateRef.current());
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    primeAudio();
    rect.current = e.currentTarget.getBoundingClientRect();
    const c = cellAt(e.clientX, e.clientY);
    if (onTap?.(c)) return;
    if (pointer.current) {
      // Второй палец — просто лишний удар, удержание ведёт первый.
      if (c >= 0) onHit(c);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата тоже работает, пока палец над полем */
    }
    pointer.current = { id: e.pointerId, cell: c };
    if (c >= 0) aimAt(c);
    setAiming(true);
    if (c >= 0) onHit(c);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(holdTick, 1000 / rateRef.current());
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c === p.cell) return;
    p.cell = c;
    if (c >= 0) {
      aimAt(c);
      // Провёл на новую клетку — удар сразу, если кирка успела (зазор
      // между ударами проверяет сам удар).
      onHit(c);
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === e.pointerId) stopHold();
  };

  return (
    <div
      className={`pmine${aiming ? ' is-aiming' : ''}${className ? ` ${className}` : ''}`}
      ref={fieldRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pmine__grid" key={gridKey}>
        {cells(faceRef)}
      </div>
      {under}
      <canvas className="pmine__fx" ref={canvasRef} />
      <div className="pmine__aim" ref={aimRef} />
      <div className="pmine__pick" ref={pickRef}>
        {pick}
      </div>
      <div className="pmine__layer" ref={layerRef} />
      {children}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Удар. Весь «кликер» шахты: урон по блоку, трещины, крит, слом и чары.
// Одинаков для каторги и подземелья — разные у них только правила.
// ---------------------------------------------------------------------------

export type BreakKind = 'hit' | 'crit' | 'vein' | 'blast' | 'hammer';

export interface DigBlock {
  cell: number;
  rock: number;
}

/** Шансы чар поля на один сломанный блок. */
export interface DigProcs {
  hammer: number;
  rockfall: number;
  beam: number;
  blast: number;
  vein: number;
  veinMax: number;
  crack: number;
  frenzy: number;
}

export interface DigRules {
  /** Ключ поля: сменился — урон, трещины и отложенные волны с нуля. */
  key: string;
  /** Порода верхнего блока клетки прямо сейчас (−1 — дно). */
  rockAt(c: number): number;
  /** Прочность, материал (звук удара) и цвета крошки породы. */
  rock(r: number): { hp: number; kind: RockKind; colors: string[] };
  /** Клетку не берут ни удар, ни площадные чары (сейд, событие поверх). */
  shut?(c: number): boolean;
  /** Особая клетка забирает удар себе целиком (метеорит, Куйва, сейд). */
  special?(c: number): boolean;
  /** Сколько мс минимум между ударами тапом. */
  gapMs(): number;
  /** Урон одного удара без крита. */
  damage(): number;
  procs(): DigProcs;
  /** Жила: соседи с той же породой сверху, не больше `max`. */
  vein(c: number, rock: number, max: number): number[];
  /** Сломать блоки: стор, добыча, объявления. Визуал слома делает хук. */
  onBreak(list: DigBlock[], kind: BreakKind): void;
  onFrenzy?(c: number): void;
}

export interface Dig {
  /** Стадии трещин по клеткам — для разметки. */
  cracks: number[];
  /** Урон по недобитым блокам: −1 — блок цел. */
  hp: MutableRefObject<Float32Array>;
  strike(c: number): void;
  breakCells(cells: number[], kind: BreakKind): void;
  blastAt(c: number, r: number, label: string): void;
  hammerFrom(c: number, label: string, power?: number): void;
  setCrack(c: number, stage: number): void;
  /** Отложить действие по этому полю: сменится шахта — не выполнится. */
  later(fn: () => void, ms: number): void;
}

/** Стадия трещины 1…3 по остатку прочности. */
export const crackStage = (left: number, max: number) =>
  Math.min(3, 1 + Math.floor((1 - left / max) * 3));

export function useMineDig(field: RefObject<MineFieldHandle | null>, rules: DigRules): Dig {
  const [cracks, setCracks] = useState<number[]>(() => new Array<number>(MINE_CELLS).fill(0));
  const hp = useRef<Float32Array>(new Float32Array(MINE_CELLS).fill(-1));
  const lastHit = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const R = useRef(rules);
  R.current = rules;
  const keyRef = useRef(rules.key);
  keyRef.current = rules.key;

  // Новая шахта (ранг, обновление, переход): трещины и урон — с нуля, волны
  // прошлого поля не доигрываются.
  useEffect(() => {
    hp.current.fill(-1);
    setCracks(new Array<number>(MINE_CELLS).fill(0));
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, [rules.key]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    const key = keyRef.current;
    timers.current.push(
      setTimeout(() => {
        // Шахта сменилась — прошлое поле не трогаем.
        if (keyRef.current !== key) return;
        fn();
      }, ms),
    );
  };

  const setCrack = (c: number, stage: number) =>
    setCracks((prev) => {
      if (prev[c] === stage) return prev;
      const next = prev.slice();
      next[c] = stage;
      return next;
    });

  /**
   * Сломать верхние блоки клеток разом. Порода берётся с поля В ЭТОТ МИГ —
   * волны отбойника идут кольцами, и к третьему кольцу первое уже на ярус
   * глубже.
   */
  const breakCells = (cells: number[], kind: BreakKind) => {
    const r = R.current;
    const list = cells
      .filter((cell) => !r.shut?.(cell))
      .map((cell) => ({ cell, rock: r.rockAt(cell) }))
      .filter((b) => b.rock >= 0);
    if (!list.length) return;
    for (const b of list) hp.current[b.cell] = -1;
    setCracks((prev) => {
      if (!list.some((b) => prev[b.cell])) return prev;
      const next = prev.slice();
      for (const b of list) next[b.cell] = 0;
      return next;
    });
    r.onBreak(list, kind);
    const single = kind === 'hit' || kind === 'crit';
    const f = field.current;
    list.forEach((b, i) => {
      const colors = r.rock(b.rock).colors;
      if (single) {
        f?.chips(b.cell, colors, kind === 'crit' ? 22 : 14, kind === 'crit' ? 1.6 : 1.1);
        f?.puff(b.cell, 'rgba(210,190,160,1)', 5);
      } else {
        f?.chips(b.cell, colors, kind === 'hammer' ? 5 : 9, kind === 'vein' ? 1 : 1.35);
        if (i < 12) f?.puff(b.cell, 'rgba(210,190,160,1)', 3);
      }
      f?.rise(b.cell);
    });
    if (single) blockBreak(r.rock(list[0].rock).kind);
  };
  const breakRef = useRef(breakCells);
  breakRef.current = breakCells;

  /** Волна колец: каждое кольцо ломается в свой такт, от центра наружу. */
  const wave = (groups: number[][], kind: BreakKind, stepMs: number) => {
    groups.forEach((g, i) => later(() => breakRef.current(g, kind), i * stepMs));
  };

  const blastAt = (c: number, r: number, label: string) => {
    const cells = blastCells(c, r);
    boom(r);
    // Без надписи — это не первый взрыв серии (камнепад): вспышка на каждом
    // превратила бы град в стробоскоп.
    if (label) flashFrame(r >= 2 ? 'big' : 'small');
    field.current?.trauma(0.3 + 0.15 * r);
    tapMedium();
    field.current?.shockwave(c, 2 * r + 1.6, true);
    if (label) field.current?.float(c, label, 'pfloat--blast');
    wave(rings(c, cells), 'blast', 45);
  };

  /** Луч: весь ряд, от места удара к краям. */
  const beamFrom = (c: number) => {
    const row = Math.floor(c / MINE_COLS);
    const cells = Array.from({ length: MINE_COLS }, (_, x) => row * MINE_COLS + x);
    field.current?.beam(c);
    boom(1);
    tierBreak(1);
    field.current?.trauma(0.3);
    tapMedium();
    field.current?.float(c, 'ЛУЧ', 'pfloat--beam');
    wave(rings(c, cells), 'blast', 40);
  };

  /** Камнепад: град взрывов по полю, друг за другом. */
  const rockfallAt = (c: number) => {
    const picked = new Set<number>();
    while (picked.size < ROCKFALL_HITS) picked.add(Math.floor(Math.random() * MINE_CELLS));
    field.current?.float(c, 'КАМНЕПАД', 'pfloat--blast');
    mineRumble();
    flashFrame('big');
    [...picked].forEach((cell, i) => later(() => blastAt(cell, 1, ''), 140 + i * 190));
  };

  /**
   * Трещина: удар расходится по четырём соседям тем же уроном. Слабые
   * соседи ломаются, крепкие — трескаются.
   */
  const crackFrom = (c: number, dmg: number) => {
    const r = R.current;
    const x = c % MINE_COLS;
    const y = Math.floor(c / MINE_COLS);
    const nb = [
      x > 0 ? c - 1 : -1,
      x < MINE_COLS - 1 ? c + 1 : -1,
      y > 0 ? c - MINE_COLS : -1,
      y < MINE_ROWS - 1 ? c + MINE_COLS : -1,
    ].filter((n) => n >= 0);
    const broken: number[] = [];
    const staged: [number, number][] = [];
    for (const n of nb) {
      const rock = r.rockAt(n);
      if (rock < 0 || r.shut?.(n)) continue;
      const hpMax = r.rock(rock).hp;
      const left = (hp.current[n] < 0 ? hpMax : hp.current[n]) - dmg;
      if (left <= 1e-6) broken.push(n);
      else {
        hp.current[n] = left;
        staged.push([n, crackStage(left, hpMax)]);
      }
    }
    if (staged.length)
      setCracks((prev) => {
        const next = prev.slice();
        for (const [n, stage] of staged) next[n] = stage;
        return next;
      });
    field.current?.float(c, 'ТРЕЩИНА', 'pfloat--crack');
    chainTick(2);
    if (broken.length) breakCells(broken, 'vein');
  };

  const hammerFrom = (c: number, label: string, power = 2) => {
    const all = Array.from({ length: MINE_CELLS }, (_, i) => i);
    boom(power);
    mineRumble();
    flashFrame('big');
    field.current?.trauma(0.65);
    tapMedium();
    field.current?.shockwave(c, 16);
    field.current?.float(c, label, 'pfloat--blast');
    wave(rings(c, all), 'hammer', 34);
  };

  const veinFrom = (c: number, rock: number, max: number) => {
    const cells = R.current.vein(c, rock, max);
    if (!cells.length) return;
    field.current?.float(c, `ЖИЛА ×${cells.length + 1}`, 'pfloat--vein');
    cells.forEach((cell, i) =>
      later(
        () => {
          chainTick(i + 1);
          breakRef.current([cell], 'vein');
        },
        (i + 1) * 60,
      ),
    );
  };

  /** Один удар кирки по клетке. */
  const strike = (c: number) => {
    if (c < 0 || c >= MINE_CELLS) return;
    const r = R.current;
    const now = performance.now();
    if (now - lastHit.current < r.gapMs() - 4) return;
    lastHit.current = now;
    if (r.special?.(c)) return;
    const f = field.current;
    const rock = r.rockAt(c);
    if (rock < 0) {
      f?.swing(c, false);
      bedrockClink();
      f?.chips(c, ['#3a3432', '#1f1b1b'], 2, 0.5);
      return;
    }
    const def = r.rock(rock);
    const m = r.procs();
    const crit = Math.random() < CRIT_CHANCE;
    f?.swing(c, crit);
    const dmg = r.damage() * (crit ? CRIT_MULT : 1);
    const left = (hp.current[c] < 0 ? def.hp : hp.current[c]) - dmg;

    if (crit) {
      f?.float(c, 'КРИТ', 'pfloat--crit');
      f?.trauma(0.16);
      tapMedium();
    }

    if (left > 1e-6) {
      hp.current[c] = left;
      setCrack(c, crackStage(left, def.hp));
      pickHit(def.kind, crit);
      if (!crit) selectionChanged();
      f?.chips(c, def.colors, crit ? 9 : 3, crit ? 1.3 : 0.7);
      f?.kick(c, crit);
      return;
    }

    // Блок развалился.
    if (crit) pickHit(def.kind, true);
    else tapLight();
    breakCells([c], crit ? 'crit' : 'hit');

    // Зачарования. Срабатывает одно, старшее: отбойник, камнепад, луч,
    // взрыв, жила, трещина — несколько сразу превращают поле в кашу, в
    // которой не видно ни одного.
    if (Math.random() < m.hammer) hammerFrom(c, 'ОТБОЙНИК');
    else if (Math.random() < m.rockfall) rockfallAt(c);
    else if (Math.random() < m.beam) beamFrom(c);
    else if (Math.random() < m.blast) blastAt(c, 1, 'ВЗРЫВ');
    else if (Math.random() < m.vein) veinFrom(c, rock, m.veinMax);
    else if (Math.random() < m.crack) crackFrom(c, dmg);
    if (Math.random() < m.frenzy) r.onFrenzy?.(c);
  };

  return { cracks, hp, strike, breakCells, blastAt, hammerFrom, setCrack, later };
}
