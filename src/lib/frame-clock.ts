// Общие часы покадровых полос: один requestAnimationFrame на все (`PxStrip`, `PetArt`).
// Кадр полосы меняется сдвигом картинки из JS, а не CSS `steps()`: iOS Safari не ускоряет
// transform-анимации со `steps()`, и у питомцев на телефоне полоса ехала вбок «каруселью»
// (владелец, 19.10). Часы стоят, пока на них никто не подписан и пока вкладка в фоне.

type Tick = (now: number) => void;
const subs = new Set<Tick>();
let raf = 0;
function tick(now: number) {
  for (const f of [...subs]) f(now);
  raf = subs.size ? requestAnimationFrame(tick) : 0;
}

/** Звать `f(now)` на каждом кадре экрана; возвращает отписку. */
export function onTick(f: Tick): () => void {
  subs.add(f);
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);
  return () => {
    subs.delete(f);
  };
}
