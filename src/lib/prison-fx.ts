// Крошка каторги. Вид сверху, поэтому частицы не «падают вниз экрана»: у
// каждой есть высота над полом (z). Удар подбрасывает осколки, они летят в
// стороны, падают, отскакивают и остаются лежать, истаивая. Смещение по
// экрану — это y − z: так плоская картинка читается как объём.
//
// Одна канва на всё поле, один цикл кадров, и он живёт, только пока есть
// живые частицы. Пиксельные квадраты без поворота — в тон текстурам.

interface Chip {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  /** Сколько раз коснулась пола. */
  bounces: number;
  /** Мс после второго касания: с этого момента частица гаснет. */
  rest: number;
  life: number;
  /** Пыль: не прыгает, расползается и тает. */
  puff: boolean;
}

export interface Fx {
  /** Осколки от удара в точке (x, y), px канвы в CSS-пикселях. */
  chips(x: number, y: number, colors: string[], n: number, power?: number): void;
  /** Облачко пыли — на разрушении блока. */
  puff(x: number, y: number, color: string, n?: number): void;
  resize(): void;
  destroy(): void;
}

const GRAVITY = 1400; // px/с² по высоте
const DRAG = 3.2; // затухание горизонтальной скорости, 1/с
const FADE_MS = 380;
const MAX = 700;

const reduce = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function createFx(canvas: HTMLCanvasElement): Fx {
  const ctx = canvas.getContext('2d');
  let parts: Chip[] = [];
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const frame = (now: number) => {
    if (!ctx) return;
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    const next: Chip[] = [];
    for (const p of parts) {
      p.life += dt * 1000;
      if (p.puff) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-DRAG * 1.4 * dt);
        p.vy *= Math.exp(-DRAG * 1.4 * dt);
        p.size += 18 * dt;
        const a = 0.38 * (1 - p.life / 520);
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        next.push(p);
        continue;
      }
      p.vz -= GRAVITY * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        if (p.bounces < 2 && Math.abs(p.vz) > 60) {
          p.vz = -p.vz * 0.34;
          p.vx *= 0.6;
          p.vy *= 0.6;
          p.bounces += 1;
        } else {
          p.vz = 0;
          p.bounces = 3;
        }
      }
      const drag = Math.exp(-(p.z > 0 ? DRAG * 0.35 : DRAG * 2.2) * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.bounces >= 3) p.rest += dt * 1000;
      const a = p.bounces >= 3 ? 1 - p.rest / FADE_MS : 1;
      if (a <= 0 || p.life > 2200) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size * (1 + Math.min(0.6, p.z / 90));
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - p.z - s / 2), s, s);
      next.push(p);
    }
    ctx.globalAlpha = 1;
    parts = next;
    raf = parts.length ? requestAnimationFrame(frame) : 0;
  };

  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const push = (p: Chip) => {
    if (parts.length >= MAX) parts.shift();
    parts.push(p);
  };

  return {
    chips(x, y, colors, n, power = 1) {
      if (!ctx || reduce()) return;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (60 + Math.random() * 190) * power;
        push({
          x,
          y,
          z: 2,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp * 0.8,
          vz: (180 + Math.random() * 320) * Math.sqrt(power),
          size: 2 + Math.floor(Math.random() * 3) * (power > 1.2 ? 1.5 : 1),
          color: colors[Math.floor(Math.random() * colors.length)],
          bounces: 0,
          rest: 0,
          life: 0,
          puff: false,
        });
      }
      kick();
    },
    puff(x, y, color, n = 6) {
      if (!ctx || reduce()) return;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 30 + Math.random() * 60;
        push({
          x: x + Math.cos(ang) * 6,
          y: y + Math.sin(ang) * 6,
          z: 0,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          vz: 0,
          size: 8 + Math.random() * 8,
          color,
          bounces: 3,
          rest: 0,
          life: 0,
          puff: true,
        });
      }
      kick();
    },
    resize,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      parts = [];
    },
  };
}
