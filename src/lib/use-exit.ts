import { useEffect, useRef, useState } from 'react';

/**
 * Выход вместо обрыва. Оверлей (тотем, плашка уровня) раньше исчезал одним
 * кадром: `setX(null)` — и полноэкранная тёмная сцена сменялась игрой без
 * перехода. Хук держит последнее значение ещё `ms` миллисекунд после того,
 * как оно стало `null`, и сообщает, что идёт уход, — чтобы разметка успела
 * сыграть анимацию ухода. Состояние страницы при этом уже `null`: вся логика
 * (автоспин, бонус) видит, что оверлея нет, и не ждёт его ухода.
 */
export function useExit<T>(value: T | null, ms: number): [shown: T | null, leaving: boolean] {
  const [shown, setShown] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);
  const last = useRef<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      last.current = value;
      setShown(value);
      setLeaving(false);
      return undefined;
    }
    if (last.current === null) return undefined;
    setLeaving(true);
    const t = setTimeout(() => {
      last.current = null;
      setShown(null);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms]);

  // Пока эффект не отработал, отдаём свежее значение сразу: иначе новый
  // оверлей появлялся бы на кадр позже положенного.
  return [value ?? shown, value === null && shown !== null && leaving];
}
