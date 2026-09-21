import { forwardRef, Fragment, useEffect, useImperativeHandle, useRef } from 'react';
import { sepVisible, wheelCount, wheelPos } from '@/lib/odometer';

/**
 * Механический счётчик: каждый разряд — колесо с цифрами 0…9.
 *
 * Зачем колёса, а не текст. Текстовое число меняется ПОДМЕНОЙ: был «1240»,
 * стал «1310» — ни одного кадра между ними, глазу не за что зацепиться, и
 * счёт читается как мелькание, а не как движение. У колеса есть ход: младший
 * разряд крутится непрерывно, старшие стоят и подхватываются только в самом
 * конце оборота младшего — ровно как шестерёнки на бензоколонке. Именно этот
 * ход и смотрят, когда смотрят, как считаются деньги.
 *
 * Обновляется ИМПЕРАТИВНО, через `ref.set(n)`: счёт идёт каждый кадр, а
 * перерисовывать на каждом кадре девять колёс силами React — значит отдать
 * весь бюджет кадра на сверку дерева. Здесь на кадр приходится ровно столько
 * записей в стиль, сколько видно разрядов, и ни одной перерисовки.
 */
export interface OdometerHandle {
  set(n: number): void;
}

/** Сколько разрядов держим наготове. Больше миллиарда монет не бывает. */
const PLACES = 9;
/** Цифры на колесе: 0…9 и ещё один 0, чтобы оборот замыкался без прыжка. */
const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export const Odometer = forwardRef<
  OdometerHandle,
  { value: number; min?: number; className?: string }
>(function Odometer({ value, min = 1, className }, ref) {
  const host = useRef<HTMLSpanElement>(null);
  const wheels = useRef<(HTMLSpanElement | null)[]>([]);
  const seps = useRef<(HTMLSpanElement | null)[]>([]);
  const lastLen = useRef(0);

  const apply = (n: number) => {
    const v = Math.max(0, n);
    const len = wheelCount(v, min);

    for (let p = 0; p < PLACES; p++) {
      const wheel = wheels.current[p];
      if (!wheel) continue;
      if (p >= len) {
        wheel.style.display = 'none';
        continue;
      }
      wheel.style.display = '';
      const strip = wheel.firstElementChild as HTMLElement | null;
      // Перевод в проценты СВОЕЙ высоты: лента ровно в FACES.length цифр,
      // поэтому одна цифра — 100/FACES.length процента.
      if (strip) {
        strip.style.transform = `translateY(${(-wheelPos(v, p) / FACES.length) * 100}%)`;
      }
    }
    for (let p = 3; p < PLACES; p += 3) {
      const sep = seps.current[p];
      if (sep) sep.style.display = sepVisible(p, len) ? '' : 'none';
    }

    // Появился новый разряд — счётчик толкает сам себя. Момент, когда число
    // становится ДЛИННЕЕ, читается сильнее, чем любое его значение.
    if (len !== lastLen.current) {
      const el = host.current;
      if (el && len > lastLen.current && lastLen.current > 0) {
        el.classList.remove('odo--grew');
        void el.offsetWidth;
        el.classList.add('odo--grew');
      }
      lastLen.current = len;
    }
  };

  useImperativeHandle(ref, () => ({ set: apply }));
  useEffect(() => {
    apply(value);
    // apply читает только рефы — пересоздавать эффект на каждый рендер незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min]);

  return (
    <span className={`odo${className ? ` ${className}` : ''}`} ref={host}>
      {Array.from({ length: PLACES }, (_, i) => PLACES - 1 - i).map((p) => (
        <Fragment key={p}>
          <span
            className="odo__w"
            ref={(el) => {
              wheels.current[p] = el;
            }}
            style={{ display: 'none' }}
          >
            <span className="odo__s">
              {FACES.map((d, i) => (
                <i key={i}>{d}</i>
              ))}
            </span>
          </span>
          {/* Разделитель стоит ПОСЛЕ разряда, кратного трём: «1 234», а не
              «␠1234». Виден, только когда за ним есть цифры. */}
          {p % 3 === 0 && p > 0 && (
            <span
              className="odo__sep"
              ref={(el) => {
                seps.current[p] = el;
              }}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
          )}
        </Fragment>
      ))}
    </span>
  );
});
