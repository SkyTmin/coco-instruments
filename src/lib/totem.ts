// Сцена тотема бессмертия из Майнкрафта — так выпадает ключ-слеза гаста и в
// шахте, и в лесу. Слеза вылетает в центр экрана, растёт и проворачивается
// по оси Y, вокруг брызжут зелёно-жёлтые квадратные искры, потом она
// улетает в `target` (кнопка лагеря, где копятся ключи). Слой на весь экран,
// но только transform и opacity; живёт две секунды и убирает себя сам.

import { tearTexture } from './prison-art';

let playingSince = 0;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Сыграть сцену. Вернёт false, если сцена не играла (уже идёт другая или
 * включено «уменьшить движение») — тогда вызвавший показывает надпись: две
 * сцены подряд съедают друг друга.
 */
export function playTotem(target: HTMLElement | null, onLand?: () => void): boolean {
  const now = performance.now();
  if (reduceMotion() || now - playingSince < 2300 || typeof document === 'undefined') return false;
  playingSince = now;
  const host = document.createElement('div');
  host.className = 'ptotem';
  document.body.appendChild(host);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.42;
  const colors = ['#3fbf3f', '#6fdc3a', '#a6ec3a', '#f2e64a', '#e8c23a', '#58d06a'];
  for (let i = 0; i < 48; i++) {
    const p = document.createElement('i');
    p.className = 'ptotem__p';
    p.style.background = colors[i % colors.length];
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    host.appendChild(p);
    const ang = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 160;
    const dx = Math.cos(ang) * sp;
    const dy = Math.sin(ang) * sp * 0.75 - 30;
    const fall = 90 + Math.random() * 110;
    try {
      p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + fall}px)) scale(.3)`,
            opacity: 0,
          },
        ],
        {
          duration: 1100 + Math.random() * 600,
          delay: 150 + Math.random() * 250,
          easing: 'cubic-bezier(.2,.6,.4,1)',
          fill: 'both',
        },
      );
    } catch {
      /* без WAAPI — без искр */
    }
  }
  const img = document.createElement('img');
  img.className = 'ptotem__item';
  img.src = tearTexture();
  img.alt = '';
  img.style.left = `${cx}px`;
  img.style.top = `${cy}px`;
  host.appendChild(img);
  const r = target?.getBoundingClientRect();
  const tx = r ? r.left + r.width / 2 - cx : 0;
  const ty = r ? r.top + r.height / 2 - cy : window.innerHeight * 0.4;
  const done = () => host.remove();
  try {
    const a = img.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.3) rotateY(0deg) rotateZ(-14deg)', opacity: 0 },
        {
          transform: 'translate(-50%, -50%) scale(3.4) rotateY(200deg) rotateZ(9deg)',
          opacity: 1,
          offset: 0.3,
        },
        {
          transform: 'translate(-50%, -50%) scale(2.8) rotateY(360deg) rotateZ(-5deg)',
          opacity: 1,
          offset: 0.52,
        },
        {
          transform: 'translate(-50%, -50%) scale(2.7) rotateY(360deg) rotateZ(0deg)',
          opacity: 1,
          offset: 0.72,
        },
        {
          transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(.45) rotateY(360deg)`,
          opacity: 0.9,
        },
      ],
      { duration: 2000, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
    );
    a.onfinish = () => {
      done();
      onLand?.();
    };
    a.oncancel = done;
  } catch {
    done();
  }
  setTimeout(done, 3200);
  return true;
}
