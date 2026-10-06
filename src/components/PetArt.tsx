// Питомец (v2.73): рисунок тушью по кадрам (`scripts/pets-ink`), шесть
// анимаций на вид — покой, ходьба, радость, трюк, атака, сон. Каждая —
// полоса кадров в одном WebP (`public/ui/pets/<id>/<anim>.webp`), кадры
// переключает CSS `steps()` сдвигом полосы: только transform, без
// перерисовки (см. «Бюджет кадра» в CLAUDE.md).
//
// Покой играет всегда; радость (ласка) и трюк (работа роли) — по событию, один
// раз, и обратно в покой. Где питомцев много (коллекция, списки), рисуется
// неподвижная миниатюра — это двести килобайт, а не два мегабайта.
//
// Рамка тела у всех кадров вида одна (размер `size`), полоса может вылезать
// за неё ровно там, где вылезает рисунок: прыжок, брызги, паутина.
//
// Пиксельные питомцы (`lib/pet-pixel-sprites.ts`, конвейер
// `scripts/pets-pixel`) играют так же, но их полосы — в родном размере
// рисунка: рамка подгоняется к ЦЕЛОМУ числу точек экрана на пиксель рисунка
// (`pxFit`) и растягивается без сглаживания, иначе пиксели размываются или
// выходят разной ширины. У них свой `rev` в адресе и нет крупных полос.
// Золотой и радужный у них запечены в свои полосы (`<anim>-v1/-v2.webp`,
// `thumb-v1/-v2`): класс `is-pxpet` снимает CSS-фильтр с полосы и миниатюры
// при любом масштабе — фильтр на длинной полосе растеризовал её целиком.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { rarityVars } from '@/components/PickArt';
import { eggOf, petOf } from '@/lib/pets';
import type { EggId, PetId } from '@/lib/pets';
import { PET_PX } from '@/lib/pet-pixel-sprites';
import type { PetPx } from '@/lib/pet-pixel-sprites';
import { PET_LARGE, PET_REV, PET_SPRITES } from '@/lib/pet-sprites';

export type PetAnim = 'idle' | 'walk' | 'happy' | 'work' | 'attack' | 'sleep';

/** С какого размера рамки берём крупные полосы (там, где они есть). */
const LARGE_FROM = 110;

const stripSrc = (id: PetId, anim: PetAnim, large: boolean, v = 0): string => {
  const px = PET_PX[id];
  // У пиксельных золотой и радужный — свои запечённые полосы, а не CSS-фильтр.
  if (px) return `/ui/pets/${id}/${anim}${v ? `-v${v}` : ''}.webp?v=${px.rev}`;
  return `/ui/pets/${id}/${anim}${large && (PET_LARGE as readonly string[]).includes(anim) ? '-l' : ''}.webp?v=${PET_REV}`;
};

/**
 * Размер рамки пиксельного питомца: целое число точек экрана на пиксель
 * рисунка. Мельче полутора точек — как есть и со сглаживанием (пиксели всё
 * равно не различить); если до целого дальше 15% — размер прежний, без
 * сглаживания (мелочь неровной ширины лучше мыла).
 */
function pxFit(size: number, px: PetPx): { s: number; crisp: boolean } {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const k = (size * dpr) / px.box;
  if (k < 1.5) return { s: size, crisp: false };
  const kr = Math.round(k);
  if (Math.abs(kr / k - 1) > 0.15) return { s: size, crisp: true };
  return { s: (kr * px.box) / dpr, crisp: true };
}

/** Разовые анимации подгружаем заранее: иначе на первой ласке — пустая рамка. */
const preloaded = new Set<string>();
function preload(src: string) {
  if (preloaded.has(src) || typeof Image === 'undefined') return;
  preloaded.add(src);
  const im = new Image();
  im.decoding = 'async';
  im.src = src;
}

const reduce = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Рассинхрон: у каждого вида своя фаза, чтобы отряд не дышал хором. */
function phase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export function PetArt({
  id,
  size = 72,
  v = 0,
  ghost = false,
  still = false,
  anim = 'idle',
  intro,
  joy = 0,
  trick = 0,
  play: show = null,
  className,
  onClick,
}: {
  id: PetId;
  size?: number;
  /** 0 — обычный, 1 — золотой, 2 — радужный. */
  v?: number;
  /** Ещё не приручён: тёмный силуэт без движения. */
  ghost?: boolean;
  /** Без движения (списки, где таких много): миниатюра. */
  still?: boolean;
  /** Что играть в покое. */
  anim?: PetAnim;
  /** Сыграть один раз при появлении (вылупление). */
  intro?: PetAnim;
  /** Меняется — питомец радуется (анимация радости, сердечки). */
  joy?: number;
  /** Меняется — питомец делает свой трюк. */
  trick?: number;
  /** Сыграть анимацию один раз (новое `k` — ещё раз): витрина в карточке. */
  play?: { anim: PetAnim; k: number } | null;
  className?: string;
  onClick?: () => void;
}) {
  const def = petOf(id);
  const px = PET_PX[id];
  const sprites = px ? px.anims : PET_SPRITES[id]?.anims;
  const fit = px ? pxFit(size, px) : null;
  const large = size >= LARGE_FROM;
  const [once, setOnce] = useState<{ anim: PetAnim; k: number } | null>(
    intro && !still && !ghost && !reduce() ? { anim: intro, k: 0 } : null,
  );
  const [hearts, setHearts] = useState(0);
  // Пиксельный после разовой анимации продолжает покой с первого кадра:
  // последний кадр разовой стыкуется именно с ним, а не со сдвигом фазы.
  const [resume, setResume] = useState(false);
  const done = () => {
    setOnce(null);
    if (px) setResume(true);
  };
  const seen = useRef({ joy, trick });

  const play = (a: PetAnim) => {
    if (still || ghost || reduce()) return;
    setOnce((o) => ({ anim: a, k: (o?.k ?? 0) + 1 }));
  };
  useEffect(() => {
    if (joy === seen.current.joy) return;
    seen.current.joy = joy;
    play('happy');
    setHearts((h) => h + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joy]);
  useEffect(() => {
    if (trick === seen.current.trick) return;
    seen.current.trick = trick;
    play('work');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trick]);
  useEffect(() => {
    if (show) play(show.anim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.k]);
  useEffect(() => {
    if (still || ghost) return;
    preload(stripSrc(id, 'happy', large, v));
    preload(stripSrc(id, 'work', large, v));
  }, [id, large, still, ghost, v]);

  // Разовая анимация доигрывает и уступает покою; таймер — на случай, если
  // конец анимации не придёт (вкладка в фоне, отключённые анимации).
  const cur: PetAnim = once?.anim ?? anim;
  const st = sprites?.[cur] ?? sprites?.idle;
  useEffect(() => {
    if (!once || !st) return undefined;
    const t = setTimeout(done, (st.n / st.fps) * 1000 + 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [once, st]);
  useEffect(() => {
    if (!hearts) return undefined;
    const t = setTimeout(() => setHearts(0), 950);
    return () => clearTimeout(t);
  }, [hearts]);

  const cls = [
    'pet',
    `r${def.rarity}`,
    v ? `v${v}` : '',
    ghost ? 'is-ghost' : '',
    still || ghost ? 'is-still' : '',
    px ? 'is-pxpet' : '',
    fit?.crisp ? 'is-px' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = {
    ...rarityVars(def.rarity),
    '--ps': `${size}px`,
    '--pd': `${-phase(id) * 6}s`,
  } as CSSProperties;

  return (
    <span
      className={cls}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={ghost ? undefined : def.name}
    >
      {!ghost && def.rarity >= 1 && <i className="pet__aura" aria-hidden="true" />}
      {!ghost && (v === 2 || def.rarity >= 4) && <i className="pet__rays" aria-hidden="true" />}
      {still || ghost || !st ? (
        <img
          className="pet__thumb"
          src={
            px
              ? `/ui/pets/${id}/thumb${v && !ghost ? `-v${v}` : ''}.webp?v=${px.rev}`
              : `/ui/pets/${id}/thumb.webp?v=${PET_REV}`
          }
          alt=""
          draggable={false}
        />
      ) : px && fit ? (
        <span
          className="pet__px"
          style={{ width: fit.s, height: fit.s, left: (size - fit.s) / 2, top: size - fit.s }}
        >
          <span
            className="pet__frame"
            style={{
              left: (st.x * fit.s) / px.box,
              top: (st.y * fit.s) / px.box,
              width: (st.w * fit.s) / px.box,
              height: (st.h * fit.s) / px.box,
            }}
          >
            <img
              key={`${cur}:${once?.k ?? 'loop'}`}
              className={`pet__strip${once ? ' is-once' : ''}`}
              src={stripSrc(id, cur, false, v)}
              style={
                {
                  width: `${st.n * 100}%`,
                  '--n': st.n,
                  '--pt': `${st.n / st.fps}s`,
                  ...(resume && !once ? { animationDelay: '0s' } : null),
                } as CSSProperties
              }
              alt=""
              draggable={false}
              onAnimationEnd={done}
            />
          </span>
        </span>
      ) : (
        <span
          className="pet__frame"
          style={{
            left: `${st.x * 100}%`,
            top: `${st.y * 100}%`,
            width: `${st.w * 100}%`,
            height: `${st.h * 100}%`,
          }}
        >
          <img
            key={`${cur}:${once?.k ?? 'loop'}`}
            className={`pet__strip${once ? ' is-once' : ''}`}
            src={stripSrc(id, cur, large)}
            style={
              { width: `${st.n * 100}%`, '--n': st.n, '--pt': `${st.n / st.fps}s` } as CSSProperties
            }
            alt=""
            draggable={false}
            onAnimationEnd={() => setOnce(null)}
          />
        </span>
      )}
      {hearts > 0 && (
        <span key={hearts} className="pet__hearts" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

/** Яйцо: 3D-рендер вида (`scripts/eggs-render`). */
export function EggArt({
  egg,
  size = 72,
  className,
}: {
  egg: EggId;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`pegg-img${className ? ` ${className}` : ''}`}
      src={`/ui/eggs/${egg}.webp`}
      width={size}
      height={size}
      alt={eggOf(egg).name}
      draggable={false}
    />
  );
}
