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
  melody.forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.3, type: 'square', gain: 0.1 }));
  [130.81, 130.81, 196, 261.63].forEach((f, i) =>
    tone(f, { at: i * 0.22, dur: 0.4, type: 'triangle', gain: 0.16 }),
  );
}

/** Тик счётчика во время подсчёта выигрыша. */
export function counterTick(): void {
  tone(1600, { dur: 0.035, type: 'square', gain: 0.05 });
}

/** Звон монеты — для дождя монет и получения бонуса. */
export function coinDing(at = 0): void {
  tone(1318.5, { at, dur: 0.16, type: 'sine', gain: 0.12 });
  tone(1975.5, { at: at + 0.03, dur: 0.12, type: 'sine', gain: 0.07 });
}

/**
 * Звук звена каскада. Высота тона растёт с длиной цепочки — тот самый приём
 * из аркад: чем длиннее комбо, тем выше «дзынь», и ухо само считает звенья.
 */
export function comboHit(step: number): void {
  const n = Math.max(1, Math.min(step, 8));
  // Мажорная гамма вверх: 523 Гц (до) и дальше по полутонам лестницы.
  const base = 523.25 * Math.pow(2, (n - 1) / 6);
  tone(base, { dur: 0.1, type: 'triangle', gain: 0.13 });
  tone(base * 1.5, { at: 0.05, dur: 0.12, type: 'sine', gain: 0.1 });
  if (n >= 3) tone(base * 2, { at: 0.1, dur: 0.14, type: 'sine', gain: 0.08 });
}

/** Хлопок исчезающих символов — короткий «пшик» перед падением новых. */
export function symbolBurst(): void {
  tone(880, { dur: 0.07, type: 'square', gain: 0.05, sweepTo: 300 });
}

/**
 * Падение сферы-множителя. Раньше сферы падали молча — и ×500 звучал ровно
 * так же, как ×2, то есть никак. Теперь у каждой ступени редкости свой звук,
 * и ухо узнаёт находку раньше, чем глаз успевает прочитать число.
 *
 * `beats` — «вес события» из lib/orb-rarity (0…3).
 */
export function orbDrop(beats: number, at = 0): void {
  if (beats <= 0) {
    // Обычная и необычная: короткое стеклянное «тюк», чтобы сфера не была немой.
    tone(880, { at, dur: 0.07, type: 'sine', gain: 0.07 });
    return;
  }
  if (beats === 1) {
    // Редкая: чистая квинта — звук «нашлось что-то приятное».
    tone(1046.5, { at, dur: 0.14, type: 'triangle', gain: 0.11 });
    tone(1568, { at: at + 0.05, dur: 0.14, type: 'sine', gain: 0.08 });
    return;
  }
  if (beats === 2) {
    // Эпическая: мажорное трезвучие с подъёмом.
    [783.99, 987.77, 1174.66].forEach((f, i) =>
      tone(f, { at: at + i * 0.045, dur: 0.22, type: 'triangle', gain: 0.11 }),
    );
    tone(392, { at, dur: 0.3, type: 'sine', gain: 0.1 });
    return;
  }
  // Легендарная и мифическая: колокол с басом и долгим хвостом.
  [523.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) =>
    tone(f, { at: at + i * 0.05, dur: 0.5, type: 'sine', gain: 0.1 }),
  );
  tone(130.81, { at, dur: 0.7, type: 'triangle', gain: 0.17 });
  tone(2093, { at: at + 0.24, dur: 0.6, type: 'sine', gain: 0.06 });
}

/**
 * Счёт суммы множителей: тик, высота которого ползёт вверх вместе с суммой.
 * `k` — доля пути от нуля к итогу (0…1).
 */
export function multTick(k: number): void {
  tone(700 + 900 * Math.min(1, Math.max(0, k)), { dur: 0.04, type: 'square', gain: 0.06 });
}

// ---------------------------------------------------------------------------
// Пузыри: сферы сливаются в одну (lib/orb-merge.ts). Звук мягкий и влажный —
// синус с подъёмом тона, без квадратных волн: это плёнка, а не металл.
// ---------------------------------------------------------------------------

/** Пузыри надуваются вокруг камней — тихое «вдох» перед слиянием. */
export function bubbleForm(): void {
  tone(420, { dur: 0.18, type: 'sine', gain: 0.05, sweepTo: 760 });
}

/**
 * Два пузыря слились — «блоп». `k` — какое по счёту слияние: тон
 * забирается выше, и ухо слышит, что общий пузырь растёт.
 */
export function bubbleMerge(k: number): void {
  const f = 300 * Math.pow(1.1, Math.min(12, Math.max(0, k)));
  tone(f, { dur: 0.13, type: 'sine', gain: 0.13, sweepTo: f * 2.2 });
  tone(f * 3.1, { at: 0.03, dur: 0.05, type: 'sine', gain: 0.035 });
}

/** Общий пузырь лопнул — сухой щелчок плёнки и брызги. */
export function bubblePop(): void {
  tone(1500, { dur: 0.05, type: 'triangle', gain: 0.1, sweepTo: 520 });
  tone(2800, { at: 0.012, dur: 0.035, type: 'sine', gain: 0.05 });
  tone(3900, { at: 0.03, dur: 0.03, type: 'sine', gain: 0.03 });
}

/** Множитель применился к выплате — глухой удар «печати». */
export function multSlam(): void {
  tone(196, { dur: 0.26, type: 'triangle', gain: 0.2, sweepTo: 98 });
  tone(784, { dur: 0.14, type: 'square', gain: 0.08, sweepTo: 392 });
}

// ---------------------------------------------------------------------------
// Подсчёт выигрыша. Голос счёта — половина его убедительности: ровная дробь
// и то, что она НЕ кончается, работают сильнее, чем само число на экране.
// ---------------------------------------------------------------------------

/**
 * Тик счётчика. Частота ровная (её задаёт rollup.ts), а высота ползёт вверх
 * отрезок за отрезком: ухо слышит, что счёт забирается всё выше, даже когда
 * глаз не успевает читать цифры. Тихий нарочно — их двадцать в секунду.
 */
export function rollupTick(leg: number, k: number): void {
  const f = Math.min(3400, 700 * Math.pow(1.11, leg) * (1 + 0.2 * k));
  tone(f, { dur: 0.03, type: 'square', gain: 0.045 });
}

/**
 * Пробой ступени. Здесь эскалация обязана быть НЕРАВНОМЕРНОЙ: обычный порог
 * — щелчок, а легендарный — бас с фанфарой. Если объявлять их одинаково,
 * верхние ступени перестают быть верхними.
 */
export function tierBreak(beats: number): void {
  if (beats <= 0) {
    tone(880, { dur: 0.09, type: 'triangle', gain: 0.12 });
    tone(1318.5, { at: 0.04, dur: 0.1, type: 'sine', gain: 0.08 });
    return;
  }
  if (beats === 1) {
    [783.99, 1046.5].forEach((f, i) =>
      tone(f, { at: i * 0.055, dur: 0.18, type: 'triangle', gain: 0.13 }),
    );
    tone(261.63, { dur: 0.22, type: 'sine', gain: 0.12 });
    return;
  }
  if (beats === 2) {
    [659.25, 830.61, 987.77].forEach((f, i) =>
      tone(f, { at: i * 0.05, dur: 0.26, type: 'triangle', gain: 0.13 }),
    );
    tone(164.81, { dur: 0.34, type: 'triangle', gain: 0.18, sweepTo: 110 });
    return;
  }
  if (beats === 3) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, { at: i * 0.05, dur: 0.34, type: 'square', gain: 0.1 }),
    );
    tone(130.81, { dur: 0.45, type: 'triangle', gain: 0.2, sweepTo: 87 });
    tone(1568, { at: 0.2, dur: 0.3, type: 'sine', gain: 0.07 });
    return;
  }
  // Легендарный порог и максимум: колокол, бас и долгий хвост.
  [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) =>
    tone(f, { at: i * 0.055, dur: 0.6, type: 'sine', gain: 0.1 }),
  );
  tone(65.41, { dur: 0.8, type: 'triangle', gain: 0.22 });
  tone(2093, { at: 0.3, dur: 0.7, type: 'sine', gain: 0.06 });
}

/** Счёт договорил. Разрешение аккорда — «всё, это твоё». */
export function payoutEnd(beats: number): void {
  const chord = beats >= 3 ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
  chord.forEach((f, i) =>
    tone(f, { at: i * 0.02, dur: 0.5 + beats * 0.1, type: 'triangle', gain: 0.11 }),
  );
  tone(130.81, { dur: 0.5, type: 'sine', gain: 0.14 });
}

// ---------------------------------------------------------------------------
// Каторга: удары кирки. Камень без шума не звучит — чистый тон даёт «пик», а
// не «тук», — поэтому здесь есть короткий шумовой всплеск через полосовой
// фильтр. Материал слышен по полосе фильтра и по звонкому хвосту: земля
// глухая, камень сухой, металл звенит, кристалл поёт.
// ---------------------------------------------------------------------------

let noiseBuf: AudioBuffer | null = null;

/** Шумовой всплеск: полоса `freq`, добротность `q`. */
function noise(freq: number, { at = 0, dur = 0.06, gain = 0.2, q = 1.2 } = {}): void {
  if (muted || !ctx) return;
  try {
    if (!noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(freq, t0);
    band.Q.setValueAtTime(q, t0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(band).connect(env).connect(ctx.destination);
    src.start(t0, Math.random() * 0.15);
    src.stop(t0 + dur + 0.02);
  } catch {
    /* звук не критичен */
  }
}

export type MineSound = 'soil' | 'stone' | 'metal' | 'crystal' | 'star';

/** Удар кирки. Высота чуть гуляет — сорок одинаковых ударов подряд режут ухо. */
export function pickHit(kind: MineSound, crit = false): void {
  const v = 0.94 + Math.random() * 0.12;
  if (kind === 'soil') {
    noise(420 * v, { dur: 0.07, gain: 0.26, q: 0.8 });
    tone(120 * v, { dur: 0.07, type: 'triangle', gain: 0.12, sweepTo: 70 });
  } else if (kind === 'stone') {
    noise(1500 * v, { dur: 0.05, gain: 0.24, q: 1.4 });
    tone(260 * v, { dur: 0.05, type: 'triangle', gain: 0.1, sweepTo: 150 });
  } else if (kind === 'metal') {
    noise(2600 * v, { dur: 0.035, gain: 0.18, q: 2 });
    tone(1180 * v, { dur: 0.16, type: 'sine', gain: 0.06 });
    tone(1770 * v, { at: 0.004, dur: 0.12, type: 'sine', gain: 0.035 });
  } else if (kind === 'crystal') {
    noise(3600 * v, { dur: 0.03, gain: 0.14, q: 2.5 });
    tone(2093 * v, { dur: 0.14, type: 'sine', gain: 0.05 });
    tone(3136 * v, { at: 0.01, dur: 0.1, type: 'sine', gain: 0.03 });
  } else {
    noise(3000 * v, { dur: 0.03, gain: 0.12, q: 2 });
    tone(1568 * v, { dur: 0.18, type: 'sine', gain: 0.05, sweepTo: 2349 });
  }
  if (crit) {
    tone(98, { dur: 0.16, type: 'triangle', gain: 0.18, sweepTo: 55 });
    noise(900, { at: 0.01, dur: 0.09, gain: 0.22, q: 0.7 });
  }
}

/** Блок развалился. Громче удара и с хвостом: это событие, а не такт. */
export function blockBreak(kind: MineSound): void {
  const v = 0.95 + Math.random() * 0.1;
  noise(kind === 'soil' ? 320 : 900 * v, { dur: 0.14, gain: 0.3, q: 0.6 });
  noise(2200 * v, { at: 0.02, dur: 0.08, gain: 0.12, q: 1.1 });
  tone(90 * v, { dur: 0.12, type: 'triangle', gain: 0.14, sweepTo: 50 });
  if (kind === 'metal') {
    tone(880 * v, { at: 0.02, dur: 0.3, type: 'sine', gain: 0.06 });
    tone(1320 * v, { at: 0.03, dur: 0.24, type: 'sine', gain: 0.04 });
  } else if (kind === 'crystal') {
    [1568, 2093, 2637].forEach((f, i) =>
      tone(f * v, { at: 0.02 + i * 0.035, dur: 0.18, type: 'sine', gain: 0.045 }),
    );
  } else if (kind === 'star') {
    [1760, 2217, 2637, 3520].forEach((f, i) =>
      tone(f, { at: 0.02 + i * 0.04, dur: 0.3, type: 'sine', gain: 0.04 }),
    );
  }
}

/** По дну: кирка не берёт коренную породу. */
export function bedrockClink(): void {
  tone(2400, { dur: 0.05, type: 'square', gain: 0.03 });
  noise(3200, { dur: 0.03, gain: 0.08, q: 3 });
}

/** Рюкзак полон — короткий глухой «нет». */
export function bagFull(): void {
  tone(196, { dur: 0.09, type: 'square', gain: 0.07 });
  tone(165, { at: 0.1, dur: 0.12, type: 'square', gain: 0.07 });
}

/** Шахта обновляется: гул снизу и перестук поднимающихся блоков. */
export function mineRumble(): void {
  tone(62, { dur: 0.7, type: 'triangle', gain: 0.2, sweepTo: 45 });
  for (let i = 0; i < 7; i++) noise(500 + i * 140, { at: 0.08 + i * 0.07, dur: 0.05, gain: 0.12 });
}

/** Взрыв: бомба, Взрыв-зачарование, заряд, отбойник. `power` 1…3. */
export function boom(power = 1): void {
  const p = Math.max(1, Math.min(3, power));
  noise(180, { dur: 0.35 + 0.15 * p, gain: 0.35, q: 0.5 });
  noise(700, { at: 0.01, dur: 0.18, gain: 0.2, q: 0.7 });
  tone(70, { dur: 0.4 + 0.15 * p, type: 'triangle', gain: 0.24, sweepTo: 35 });
  if (p >= 2) {
    for (let i = 0; i < 5; i++)
      noise(1400 + i * 300, { at: 0.12 + i * 0.06, dur: 0.05, gain: 0.08 });
  }
}

/** Фитиль шипит, бомба тикает. */
export function fuseTick(k = 0): void {
  tone(1200 + 200 * k, { dur: 0.04, type: 'square', gain: 0.05 });
  noise(5000, { dur: 0.05, gain: 0.05, q: 1.5 });
}

/** Звено жилы: тон забирается вверх — ухо считает, сколько ушло разом. */
export function chainTick(k: number): void {
  const f = 520 * Math.pow(2, Math.min(k, 12) / 12);
  tone(f, { dur: 0.08, type: 'triangle', gain: 0.08 });
  noise(2400, { dur: 0.04, gain: 0.1, q: 1.4 });
}

/** Кураж: короткий фанфарный подъём. */
export function frenzyStart(): void {
  [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(f, { at: i * 0.05, dur: 0.18, type: 'square', gain: 0.07 }),
  );
}

/** Щелчок ленты сундука, как у колеса удачи. */
export function caseTick(): void {
  tone(1900, { dur: 0.025, type: 'square', gain: 0.045 });
}

/** Нашёлся ключ — звонкий «дзынь» металла. */
export function keyFound(): void {
  tone(1568, { dur: 0.2, type: 'sine', gain: 0.09 });
  tone(2349, { at: 0.04, dur: 0.18, type: 'sine', gain: 0.06 });
}
