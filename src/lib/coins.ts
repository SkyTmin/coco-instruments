// Дождь монет для крупных выигрышей — брат burstConfetti из lib/confetti.
// Создаёт недолговечные DOM-элементы и сам за собой убирает; уважает
// prefers-reduced-motion.

const FACES = ['🪙', '💰', '🪙', '✨'];

export function rainCoins(count = 24): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.createElement('div');
  root.className = 'coinrain';

  for (let i = 0; i < count; i++) {
    const coin = document.createElement('i');
    coin.textContent = FACES[i % FACES.length];
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
