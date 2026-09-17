// Дождь монет для крупных выигрышей — брат burstConfetti из lib/confetti.
// Создаёт недолговечные DOM-элементы и сам за собой убирает; уважает
// prefers-reduced-motion.

/** Монета того же рисунка, что и в интерфейсе (components/slot-art). */
const COIN_SVG = `<svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
  <defs><linearGradient id="cr-g" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#ffe9a3"/><stop offset="45%" stop-color="#ffc53c"/>
    <stop offset="100%" stop-color="#b97a05"/></linearGradient></defs>
  <circle cx="32" cy="32" r="27" fill="url(#cr-g)" stroke="#8a5a02" stroke-width="3"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="#8a5a02" stroke-width="2" opacity="0.55"/>
  <path d="M32 17c-6 0-10 3.4-10 8 0 8.6 16 5.4 16 12 0 3.2-2.8 5-6 5s-6-1.8-6-5" fill="none"
    stroke="#7a4f02" stroke-width="4" stroke-linecap="round"/>
  <path d="M32 13v38" stroke="#7a4f02" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="23" cy="21" rx="6" ry="3.6" fill="#fff" opacity="0.5" transform="rotate(-35 23 21)"/>
</svg>`;

/** `src` — путь к символу темы; по умолчанию сыплется монета. */
export function rainCoins(count = 24, src?: string): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.createElement('div');
  root.className = 'coinrain';

  for (let i = 0; i < count; i++) {
    const coin = document.createElement('i');
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.width = 30;
      img.height = 30;
      img.alt = '';
      coin.appendChild(img);
    } else {
      coin.innerHTML = COIN_SVG;
    }
    coin.style.left = `${Math.random() * 100}%`;
    coin.style.setProperty('--d', `${(1.1 + Math.random() * 0.9).toFixed(2)}s`);
    coin.style.setProperty('--x', `${(Math.random() * 2 - 1).toFixed(2)}`);
    coin.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    coin.style.setProperty('--s', `${(0.75 + Math.random() * 0.75).toFixed(2)}`);
    coin.style.animationDelay = `${(Math.random() * 0.6).toFixed(2)}s`;
    root.appendChild(coin);
  }

  document.body.appendChild(root);
  window.setTimeout(() => root.remove(), 3000);
}
