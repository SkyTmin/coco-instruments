// Пиксельные предметы (яйца, сундуки, книги, кирки) — проигрыватель полос.
// Полосы печёт `scripts/props-pixel/bake.ts` (рисунок кодом, риг питомцев), манифест —
// `lib/props-pixel/sprites-<set>.ts`. Подробности — `.claude/rules/props-pixel.md`.
//
// Как у пиксельных питомцев (`PetArt`): рамка предмета (`box` пикселей рисунка) подгоняется к
// ЦЕЛОМУ числу точек экрана на пиксель (`propFit`), полоса растягивается без сглаживания, малая
// или крупная — по тому, что ровнее ляжет. Окно на кадр с `overflow: hidden`, кадр меняется
// сдвигом картинки (только transform). Кадры ведут общие часы (один requestAnimationFrame на
// все полосы): разовая знает, какой кадр показан, и зовёт `onMark` на метках манифеста —
// сцена вешает на них звук и фазы — и `onEnd` после последнего кадра.
//
// Разовая стартует, только когда её картинка раскодирована (`preloadPx`); до того — `poster`
// (кадр другой полосы набора, обычно покой) или пусто. При `prefers-reduced-motion`: петля —
// первый кадр, разовая — последний, метки и `onEnd` приходят сразу (сцена не зависает).

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import '@/px-strip.css';
import { propFit } from '@/lib/props-pixel/fit';
import { PX_SETS, pxSrc } from '@/lib/props-pixel/manifest';
import type { PxSetName } from '@/lib/props-pixel/manifest';
import type { PxRect, PxStripMeta } from '@/lib/props-pixel/types';

export type PxMode = 'loop' | 'once' | 'still';

const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
const reduced = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Какую полосу и в каком размере показать при стороне рамки `size` CSS-пикселей. */
export function pxFitOf(set: PxSetName, name: string, size: number, dpr = dprNow()) {
  const man = PX_SETS[set];
  const st = man.strips[name];
  if (!st) return null;
  const fit = propFit(size, st.s ? man.box : undefined, st.l ? man.large : undefined, dpr);
  const rect = (fit.large ? st.l : st.s) as PxRect;
  const box = fit.large ? (man.large as number) : man.box;
  return { st, fit, rect, box };
}

// --- Подгрузка ----------------------------------------------------------------

const loads = new Map<string, Promise<void>>();
const keep: HTMLImageElement[] = [];

/**
 * Подгрузить и раскодировать полосу заранее (по нажатию кнопки сцены). `size` — сторона рамки,
 * в которой её покажут: так берётся та же полоса (малая/крупная), что выберет `PxStrip`; без
 * него — обе. Обещание выполняется, когда картинка готова (или не загрузилась — сцена не ждёт
 * вечно).
 */
export function preloadPx(set: PxSetName, name: string, size?: number): Promise<void> {
  const st = PX_SETS[set].strips[name];
  if (!st || typeof Image === 'undefined') return Promise.resolve();
  const which =
    size != null
      ? [!!pxFitOf(set, name, size)?.fit.large]
      : [false, true].filter((l) => (l ? st.l : st.s));
  return Promise.all(which.map((large) => loadSrc(pxSrc(set, name, large)))).then(() => undefined);
}

function loadSrc(src: string): Promise<void> {
  let p = loads.get(src);
  if (p) return p;
  p = new Promise<void>((done) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      if (im.decode) im.decode().then(done, done);
      else done();
    };
    im.onerror = () => done();
    im.src = src;
    keep.push(im);
  });
  loads.set(src, p);
  return p;
}

// --- Общие часы ---------------------------------------------------------------

type Tick = (now: number) => void;
const subs = new Set<Tick>();
let raf = 0;
function tick(now: number) {
  for (const f of [...subs]) f(now);
  raf = subs.size ? requestAnimationFrame(tick) : 0;
}
function onTick(f: Tick): () => void {
  subs.add(f);
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);
  return () => {
    subs.delete(f);
  };
}

/** Метки по порядку кадров. */
const marksOf = (st: PxStripMeta): [string, number][] =>
  Object.entries(st.marks ?? {}).sort((a, b) => a[1] - b[1]);

export function PxStrip({
  set,
  name,
  size,
  mode = 'loop',
  frame = 0,
  phase = 0,
  align = 'center',
  poster,
  onEnd,
  onMark,
  className,
  style,
  label,
}: {
  set: PxSetName;
  name: string;
  /** Сторона рамки предмета в CSS-пикселях (полоса сама подгонит её к целому масштабу). */
  size: number;
  mode?: PxMode;
  /** Кадр для `still` (отрицательный — с конца: −1 последний). */
  frame?: number;
  /** Сдвиг петли в долях её длины: десяток одинаковых предметов не дышит хором. */
  phase?: number;
  /** Подогнанная рамка в `size`: по центру или на нижней кромке (предмет стоит на полу). */
  align?: 'center' | 'bottom';
  /** Пока разовая грузится — кадр 0 этой полосы того же набора. */
  poster?: string;
  onEnd?: () => void;
  onMark?: (mark: string) => void;
  className?: string;
  style?: CSSProperties;
  /** Подпись для чтения с экрана (иначе картинка декоративная). */
  label?: string;
}) {
  const fo = pxFitOf(set, name, size);
  const img = useRef<HTMLImageElement>(null);
  const cb = useRef({ onEnd, onMark });
  cb.current = { onEnd, onMark };
  const large = !!fo?.fit.large;
  const src = fo ? pxSrc(set, name, large) : '';
  const still = mode === 'still' || reduced();
  const [ready, setReady] = useState(mode !== 'once' || still);

  const show = (i: number) => {
    const el = img.current;
    if (!el || !fo) return;
    const { cols } = fo.rect;
    const rows = Math.ceil(fo.st.n / cols);
    const c = i % cols;
    const r = Math.floor(i / cols);
    el.style.transform = `translate(${(-c * 100) / cols}%, ${(-r * 100) / rows}%)`;
  };

  // Разовая ждёт раскодированную картинку.
  useEffect(() => {
    if (mode !== 'once' || still || !fo) return undefined;
    let live = true;
    setReady(false);
    loadSrc(src).then(() => live && setReady(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, mode, still]);

  useEffect(() => {
    const st = fo?.st;
    if (!st) {
      // Нет такой полосы — разовая сразу «доиграла», сцена не ждёт.
      if (mode === 'once') {
        const t = setTimeout(() => cb.current.onEnd?.(), 0);
        return () => clearTimeout(t);
      }
      return undefined;
    }
    const n = st.n;
    if (mode === 'still' || (still && mode === 'loop')) {
      show(mode === 'still' ? ((frame % n) + n) % n : 0);
      return undefined;
    }
    const marks = marksOf(st);
    if (mode === 'once' && still) {
      // Без движения: последний кадр, метки и конец — сразу.
      show(n - 1);
      const t = setTimeout(() => {
        for (const [m] of marks) cb.current.onMark?.(m);
        cb.current.onEnd?.();
      }, 0);
      return () => clearTimeout(t);
    }
    if (mode === 'loop') {
      const t0 = performance.now() - ((((phase % 1) + 1) % 1) * n * 1000) / st.fps;
      let cur = -1;
      show(0);
      return onTick((now) => {
        const i = Math.floor(((now - t0) / 1000) * st.fps) % n;
        if (i !== cur) show((cur = i));
      });
    }
    // Разовая.
    show(0);
    if (!ready) return undefined;
    let next = 0;
    let cur = -1;
    let ended = false;
    const fire = (upto: number) => {
      // `next++` — отдельно: у `onMark?.(…)` без обработчика аргументы не вычисляются,
      // и цикл без него крутился вечно (страница вставала на первой метке).
      while (next < marks.length && marks[next][1] <= upto) {
        const m = marks[next++][0];
        cb.current.onMark?.(m);
      }
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      show(n - 1);
      fire(n - 1);
      off();
      clearTimeout(guard);
      cb.current.onEnd?.();
    };
    const t0 = performance.now();
    const off = onTick((now) => {
      const el = ((now - t0) / 1000) * st.fps;
      if (el >= n) return finish();
      const i = Math.floor(el);
      if (i !== cur) {
        show((cur = i));
        fire(i);
      }
    });
    // Часы не идут (вкладка в фоне) — конец всё равно придёт.
    const guard = setTimeout(finish, (n / st.fps) * 1000 + 400);
    return () => {
      ended = true;
      off();
      clearTimeout(guard);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, name, mode, still, ready, large, frame, phase]);

  const cls = ['pxs', fo?.fit.crisp ? 'is-px' : '', className ?? ''].filter(Boolean).join(' ');
  const rootStyle = { width: size, height: size, ...style } as CSSProperties;
  if (!fo) return <span className={cls} style={rootStyle} aria-hidden="true" />;
  const { fit, rect, box, st } = fo;
  const k = fit.s / box;
  const rows = Math.ceil(st.n / rect.cols);
  return (
    <span
      className={cls}
      style={rootStyle}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {!ready && poster && (
        <PxStrip set={set} name={poster} size={size} mode="still" align={align} />
      )}
      <span
        className="pxs__box"
        style={{
          width: fit.s,
          height: fit.s,
          left: (size - fit.s) / 2,
          top: align === 'bottom' ? size - fit.s : (size - fit.s) / 2,
          visibility: ready ? undefined : 'hidden',
        }}
      >
        <span
          className="pxs__win"
          style={{ left: rect.x * k, top: rect.y * k, width: rect.w * k, height: rect.h * k }}
        >
          <img
            ref={img}
            className="pxs__img"
            src={src}
            style={{ width: `${rect.cols * 100}%`, height: `${rows * 100}%` }}
            alt=""
            draggable={false}
          />
        </span>
      </span>
    </span>
  );
}
