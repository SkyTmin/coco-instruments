import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { digitCount, moneyText } from '@/lib/money';

/**
 * Счётчик денег: крупное целое число, которое растёт на глазах.
 *
 * Обновляется ИМПЕРАТИВНО, через `ref.set(n)`. Счёт идёт каждый кадр (см.
 * lib/rollup.ts), и гонять его через состояние React значило бы сверять
 * дерево шестьдесят раз в секунду ради одной строки текста. Здесь на кадр
 * приходится одна запись в `textContent` — и ни одной перерисовки.
 *
 * Цифры НЕ крутятся и не подменяются по одной. Пробовал и то и другое: при
 * непрерывном ходе колеса на экране постоянно висят половинки цифр, а своё
 * `overflow` у каждого разряда обрезает свечение в прямоугольную коробку —
 * число рассыпается на плитки. Сочность даёт темп счёта, а не форма цифр;
 * цифрам достаточно быть крупными, целыми и читаемыми на любом кадре.
 */
export interface MoneyHandle {
  set(n: number): void;
}

export const MoneyCounter = forwardRef<
  MoneyHandle,
  {
    value: number;
    className?: string;
    /** Свой вид числа — например, «12,3 млн» в тесной шапке шахты. */
    format?: (n: number) => string;
  }
>(function MoneyCounter({ value, className, format }, ref) {
  const host = useRef<HTMLSpanElement>(null);
  const lastLen = useRef(0);

  const apply = (n: number) => {
    const el = host.current;
    if (!el) return;
    el.textContent = (format ?? moneyText)(n);
    const len = digitCount(n);
    if (len !== lastLen.current) {
      // Прибавился разряд — счётчик толкает сам себя. Момент, когда число
      // становится ДЛИННЕЕ, читается сильнее, чем любое его значение.
      if (len > lastLen.current && lastLen.current > 0) {
        el.classList.remove('mnum--grew');
        void el.offsetWidth;
        el.classList.add('mnum--grew');
      }
      lastLen.current = len;
    }
  };

  useImperativeHandle(ref, () => ({ set: apply }));
  // apply читает только рефы, поэтому зависимость здесь ровно одна — само
  // значение: пересоздавать эффект на каждый рендер родителя незачем.
  useEffect(() => {
    apply(value);
  }, [value]);

  return <span className={`mnum${className ? ` ${className}` : ''}`} ref={host} />;
});
