// Звук для слотов, синтезированный на лету через Web Audio — ни одного
// аудиофайла в бандле. Всё обёрнуто в try/catch: звук никогда не должен
// ломать игру (в Telegram WebView контекст может быть недоступен или
// заморожен до первого касания экрана).

let ctx: AudioContext | null = null;
let muted = false;

/** Создаёт/размораживает контекст. Вызывается из обработчика жеста (iOS). */
export function primeAudio(): void {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
}

/** Одна нота: осциллятор + огибающая громкости. */
function tone(
  freq: number,
  {
    at = 0,
    dur = 0.12,
    type = 'sine',
    gain = 0.14,
    sweepTo,
  }: { at?: number; dur?: number; type?: OscillatorType; gain?: number; sweepTo?: number } = {},
): void {
  if (muted || !ctx) return;
  try {
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    // Мягкая атака и экспоненциальный спад — без щелчков на краях.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* звук не критичен */
  }
}

/** Короткий шумовой щелчок — символ проскочил мимо окна барабана. */
export function reelTick(): void {
  if (muted || !ctx) return;
  try {
    const t0 = ctx.currentTime;
    const buffer = ctx.createBuffer(1, 256, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.08, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(t0);
  } catch {
    /* no-op */
  }
}

/** Глухой «тук» — барабан встал на место. */
export function reelStop(index = 0): void {
  tone(180 - index * 18, { dur: 0.12, type: 'triangle', gain: 0.22, sweepTo: 90 });
}

/** Свист опускающегося рычага. */
export function leverPull(): void {
  tone(520, { dur: 0.22, type: 'sawtooth', gain: 0.08, sweepTo: 130 });
}

/** Нарастающее напряжение: на двух премиальных символах третий барабан тормозит. */
export function anticipation(): void {
  tone(300, { dur: 0.9, type: 'sine', gain: 0.07, sweepTo: 900 });
  tone(302, { dur: 0.9, type: 'sine', gain: 0.05, sweepTo: 905 }); // лёгкий бит
}

const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C5 D5 E5 G5 A5 C6

/** Выигрыш: арпеджио, длина которого зависит от размера выигрыша. */
export function winChime(level: 'small' | 'big'): void {
  const notes = level === 'big' ? SCALE : SCALE.slice(0, 3);
  notes.forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.2, type: 'triangle', gain: 0.13 }));
}

/** Джекпот: фанфара с повторами и басом. */
export function jackpotFanfare(): void {
  const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
  melody.forEach((f, i) =>
    tone(f, { at: i * 0.11, dur: 0.3, type: 'square', gain: 0.1 }),
  );
  [130.81, 130.81, 196, 261.63].forEach((f, i) =>
    tone(f, { at: i * 0.22, dur: 0.4, type: 'triangle', gain: 0.16 }),
  );
}

/** Звон монеты — для дождя монет и получения бонуса. */
export function coinDing(at = 0): void {
  tone(1318.5, { at, dur: 0.16, type: 'sine', gain: 0.12 });
  tone(1975.5, { at: at + 0.03, dur: 0.12, type: 'sine', gain: 0.07 });
}
