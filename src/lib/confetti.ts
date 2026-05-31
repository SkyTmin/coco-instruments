// A tiny, dependency-free confetti burst for milestone moments (a savings goal
// reached, a debt paid off). Appends short-lived DOM pieces and cleans them up.
// Respects prefers-reduced-motion.

const COLORS = ['#7b4b2a', '#b8814a', '#2e9e6b', '#d79a2b', '#e0b078', '#4cc18a', '#ef7d54'];

export function burstConfetti(count = 90): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.createElement('div');
  root.className = 'confetti-root';

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.setProperty('--x', `${(Math.random() * 2 - 1).toFixed(2)}`);
    piece.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
    piece.style.setProperty('--d', `${(0.9 + Math.random() * 0.8).toFixed(2)}s`);
    piece.style.setProperty('--s', `${(0.7 + Math.random() * 0.7).toFixed(2)}`);
    piece.style.animationDelay = `${(Math.random() * 0.2).toFixed(2)}s`;
    if (Math.random() > 0.5) piece.style.borderRadius = '50%';
    root.appendChild(piece);
  }

  document.body.appendChild(root);
  window.setTimeout(() => root.remove(), 2600);
}
