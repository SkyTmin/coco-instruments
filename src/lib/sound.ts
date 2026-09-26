// Звук игр: записанные эффекты и музыка из свободных наборов (public/audio,
// источники — public/audio/CREDITS.txt, сборка — scripts/audio-build.py).
//
// Раньше всё синтезировалось осцилляторами — квадратной и пилообразной
// волной на высоких частотах, и владелец описал это одной фразой: «из ушей
// кровь идёт». Теперь каждое событие — настоящая запись, у частых событий
// по несколько вариантов и лёгкий разброс высоты, а выход идёт через
// компрессор: тридцать монет разом не складываются в перегруз.
//
// Всё обёрнуто в try/catch: звук никогда не должен ломать игру (в Telegram
// WebView контекст может быть недоступен или заморожен до первого касания).

import { AUDIO_REV, MUSIC_TRACKS, SFX_VARIANTS } from '@/lib/audio-manifest';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let muted = false;
let musicOn = true;
/** Было касание экрана: без него iOS не даст контексту играть. */
let primed = false;

/** Громкость музыки относительно эффектов: подложка, а не солист. */
const MUSIC_LEVEL = 0.42;
const SFX_LEVEL = 0.9;

function ensureCtx(): Ctx | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = muted ? 0 : SFX_LEVEL;
    sfxBus.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = muted || !musicOn ? 0 : MUSIC_LEVEL;
    musicBus.connect(comp);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      // Свернули Telegram — музыка молчит и не тратит батарею.
      if (document.hidden) void ctx.suspend().catch(() => undefined);
      else if (primed) void ctx.resume().catch(() => undefined);
    });
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Создаёт/размораживает контекст. Вызывается из обработчика жеста (iOS). */
export function primeAudio(): void {
  const c = ensureCtx();
  if (!c) return;
  primed = true;
  try {
    if (c.state !== 'running' && !document.hidden) void c.resume().catch(() => undefined);
  } catch {
    /* no-op */
  }
  if (wantScene && !current) void startScene(wantScene);
}

// Первое касание где угодно размораживает звук: музыка сцены начинается
// сама, а не ждёт первого удара кирки.
if (typeof window !== 'undefined') {
  const once = () => primeAudio();
  window.addEventListener('pointerdown', once, { capture: true, passive: true });
  window.addEventListener('keydown', once, { capture: true, passive: true });
}

function applyLevels(): void {
  if (!ctx || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(muted ? 0 : SFX_LEVEL, t, 0.03);
  musicBus.gain.setTargetAtTime(muted || !musicOn ? 0 : MUSIC_LEVEL, t, 0.15);
}

export function setMuted(value: boolean): void {
  muted = value;
  applyLevels();
}

export function setMusicOn(value: boolean): void {
  musicOn = value;
  applyLevels();
}

// ---------------------------------------------------------------------------
// Загрузка сэмплов. Каждый звук — несколько вариантов `name.k.mp3`.
// ---------------------------------------------------------------------------

type Loaded = { buf: AudioBuffer; lead: number };
const bank = new Map<string, Loaded[]>();
const pending = new Map<string, Promise<void>>();

function decode(c: Ctx, data: ArrayBuffer): Promise<AudioBuffer> {
  // Старый Safari знает только форму с колбэками.
  return new Promise((ok, fail) => {
    try {
      const p = c.decodeAudioData(data, ok, fail);
      if (p && typeof p.then === 'function') p.then(ok, fail);
    } catch (e) {
      fail(e);
    }
  });
}

/**
 * Тишина в начале MP3 (задержка кодера, если браузер её не срезал):
 * удар обязан прозвучать в тот же кадр, что и картинка.
 */
function leadOf(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const lim = Math.min(d.length, Math.floor(buf.sampleRate * 0.06));
  for (let i = 0; i < lim; i++) if (Math.abs(d[i]) > 0.004) return i / buf.sampleRate;
  return 0;
}

function load(name: string): Promise<void> {
  const have = pending.get(name);
  if (have) return have;
  const c = ensureCtx();
  const n = SFX_VARIANTS[name] ?? 0;
  if (!c || !n) return Promise.resolve();
  const p = Promise.all(
    Array.from({ length: n }, (_, i) =>
      fetch(`/audio/sfx/${name}.${i + 1}.mp3?v=${AUDIO_REV}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => decode(c, b))
        .then((buf) => ({ buf, lead: leadOf(buf) }))
        .catch(() => null),
    ),
  ).then((list) => {
    const ok = list.filter((x): x is Loaded => !!x);
    if (ok.length) bank.set(name, ok);
    else pending.delete(name); // не вышло — попробуем при следующем вызове
  });
  pending.set(name, p);
  return p;
}

/** Наборы звуков по местам: грузятся, когда игрок туда пришёл. */
export type SoundGroup = 'ui' | 'slots' | 'mine' | 'forest' | 'dungeon' | 'fishing';

const GROUPS: Record<SoundGroup, (name: string) => boolean> = {
  ui: (n) => /^(ui\.|chip|coins|cloth|jingle\.|slot\.drum|slot\.win|tick|case\.tick)/.test(n),
  slots: (n) => /^(reel\.|slot\.|gem\.|pluck|bubble|orb\.|slam|chips)/.test(n),
  mine: (n) =>
    /^(pick\.|crit\.|break\.|bag\.|rumble|boom\.|fuse|gem\.chime|pluck|card\.|flap|shiny|bat\.)/.test(
      n,
    ),
  forest: (n) => /^(axe\.|saw\.|log\.|tree\.|snow\.|crit\.|bag\.)/.test(n),
  fishing: (n) => /^(splash|plop|snap|swing|tick|bubble|coins|gem\.chime|pluck|card\.)/.test(n),
  dungeon: (n) =>
    /^(swing|hit|bite|dash|crate|gate|clang|latch|winch|roar|rat\.|rumble|boom\.|pick\.|break\.|crit\.|bag\.|gem\.chime)/.test(
      n,
    ),
};

export function preloadSounds(...groups: SoundGroup[]): void {
  for (const name of Object.keys(SFX_VARIANTS))
    if (groups.some((g) => GROUPS[g](name))) void load(name);
}

// ---------------------------------------------------------------------------
// Проигрывание.
// ---------------------------------------------------------------------------

type PlayOpts = {
  /** Громкость 0…1+ относительно выровненного сэмпла. */
  gain?: number;
  /** Высота: 2 — октава вверх. */
  rate?: number;
  /** Через сколько секунд. */
  at?: number;
  /** Случайный разброс высоты, доля (0,04 = ±4%). */
  vary?: number;
  /** Номер варианта вместо случайного. */
  pick?: number;
};

/** Сколько раз подряд событие может звучать одновременно. */
const VOICES: Record<string, number> = {
  chip: 5,
  'chip.lay': 3,
  tick: 2,
  'case.tick': 2,
  pluck: 3,
  'gem.burst': 3,
  swing: 2,
  hit: 3,
};
/** Минимальный промежуток между двумя запусками, с: пулемёт режет ухо. */
const GAP: Record<string, number> = {
  chip: 0.035,
  'chip.lay': 0.045,
  tick: 0.04,
  'case.tick': 0.03,
  'pick.soil': 0.04,
  'pick.stone': 0.04,
  'pick.metal': 0.04,
  'pick.crystal': 0.04,
  'pick.star': 0.04,
  'gem.burst': 0.05,
  'rat.call': 0.12,
  'rat.attack': 0.1,
  'rat.die': 0.06,
  hit: 0.03,
  flap: 0.07,
  shiny: 0.04,
  plop: 0.05,
  splash: 0.08,
};

const voices = new Map<string, AudioBufferSourceNode[]>();
const lastAt = new Map<string, number>();
const lastPick = new Map<string, number>();

function play(name: string, opts: PlayOpts = {}): void {
  if (muted) return;
  const c = ctx;
  if (!c || !sfxBus || c.state !== 'running') {
    void load(name);
    return;
  }
  const list = bank.get(name);
  if (!list) {
    void load(name);
    return;
  }
  try {
    const at = opts.at ?? 0;
    const t0 = c.currentTime + at;
    const gap = GAP[name];
    if (gap && at === 0) {
      const prev = lastAt.get(name) ?? -1;
      if (t0 - prev < gap) return;
      lastAt.set(name, t0);
    }
    let k = opts.pick ?? Math.floor(Math.random() * list.length);
    if (opts.pick == null && list.length > 1 && k === lastPick.get(name)) k = (k + 1) % list.length;
    lastPick.set(name, k);
    const { buf, lead } = list[Math.min(k, list.length - 1)];
    const src = c.createBufferSource();
    src.buffer = buf;
    const vary = opts.vary ?? 0.04;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = c.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g).connect(sfxBus);
    src.start(t0, lead);
    const max = VOICES[name] ?? 6;
    const live = voices.get(name) ?? [];
    live.push(src);
    while (live.length > max) {
      const old = live.shift();
      try {
        old?.stop();
      } catch {
        /* уже остановлен */
      }
    }
    voices.set(name, live);
    src.onended = () => {
      const l = voices.get(name);
      if (l) l.splice(l.indexOf(src) >>> 0, 1);
    };
  } catch {
    /* звук не критичен */
  }
}

// ---------------------------------------------------------------------------
// Музыка сцены: петля, смена через кроссфейд, приглушение под джинглы.
// ---------------------------------------------------------------------------

export type MusicScene = keyof typeof MUSIC_TRACKS;

type Playing = { scene: MusicScene; src: AudioBufferSourceNode; gain: GainNode };
let current: Playing | null = null;
let wantScene: MusicScene | null = null;
const tracks = new Map<MusicScene, Promise<AudioBuffer | null>>();

function loadTrack(scene: MusicScene): Promise<AudioBuffer | null> {
  const have = tracks.get(scene);
  if (have) return have;
  const c = ensureCtx();
  if (!c) return Promise.resolve(null);
  const p = fetch(`/audio/music/${scene}.mp3?v=${AUDIO_REV}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => decode(c, b))
    .catch(() => {
      tracks.delete(scene);
      return null;
    });
  tracks.set(scene, p);
  // В памяти держим не больше трёх расшифрованных треков.
  if (tracks.size > 3) {
    for (const key of tracks.keys()) {
      if (key !== scene && key !== current?.scene) {
        tracks.delete(key);
        break;
      }
    }
  }
  return p;
}

async function startScene(scene: MusicScene): Promise<void> {
  const buf = await loadTrack(scene);
  const c = ctx;
  if (!buf || !c || !musicBus || wantScene !== scene || current?.scene === scene) return;
  if (c.state !== 'running') return; // начнёт primeAudio после касания
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Точки петли — по настоящей длине трека: если браузер не срезал
    // задержку MP3-кодера, лишние сэмплы по краям в петлю не попадут.
    const dur = MUSIC_TRACKS[scene].dur;
    const extra = buf.duration - dur;
    const lead = extra > 0.002 ? Math.min(extra, 0.026) : 0;
    src.loopStart = lead;
    src.loopEnd = Math.min(buf.duration, lead + dur);
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 1.4);
    src.connect(gain).connect(musicBus);
    src.start(t, lead);
    fadeOut(current);
    current = { scene, src, gain };
  } catch {
    /* no-op */
  }
}

function fadeOut(p: Playing | null): void {
  if (!p || !ctx) return;
  try {
    const t = ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), t);
    p.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    p.src.stop(t + 1);
  } catch {
    /* no-op */
  }
}

/**
 * Чей голос у джинглов: в зале и автоматах — стил-драм, в каторге —
 * пиццикато. Та же мелодия, но стил-драм в шахте звучит казино.
 */
let flavor: 'casino' | 'camp' = 'casino';
const CAMP: Record<string, string> = {
  'slot.win.s': 'jingle.go',
  'slot.win.b': 'jingle.up',
  'slot.win.m': 'jingle.end',
  'slot.win.e': 'jingle.win',
  'slot.win.l': 'jingle.small',
};
const voice = (name: string) => (flavor === 'camp' ? (CAMP[name] ?? name) : name);

/** Музыка сцены; `null` — тишина (ушли из игр). */
export function setMusicScene(scene: MusicScene | null): void {
  if (scene)
    flavor = scene === 'hall' || scene === 'slots' || scene === 'cascade' ? 'casino' : 'camp';
  wantScene = scene;
  if (!scene) {
    fadeOut(current);
    current = null;
    return;
  }
  if (current?.scene === scene) return;
  void startScene(scene);
}

let duckUntil = 0;
/** Приглушить музыку на время джингла, чтобы выигрыш не тонул в подложке. */
function duck(sec: number): void {
  if (!ctx || !musicBus || muted || !musicOn) return;
  try {
    const t = ctx.currentTime;
    const until = t + sec;
    if (until <= duckUntil) return;
    duckUntil = until;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL * 0.35, t, 0.05);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL, until, 0.4);
  } catch {
    /* no-op */
  }
}

/** Джингл: музыка уходит в тень на его длину. */
function jingle(name: string, sec: number, opts: PlayOpts = {}): void {
  duck(sec + (opts.at ?? 0));
  play(name, { vary: 0, ...opts });
}

// ---------------------------------------------------------------------------
// Интерфейс.
// ---------------------------------------------------------------------------

export function uiTap(): void {
  play('ui.tap', { gain: 0.5, vary: 0.06 });
}
export function uiOpen(): void {
  play('ui.open', { gain: 0.55 });
}
export function uiClose(): void {
  play('ui.close', { gain: 0.5 });
}
export function uiTab(): void {
  play('ui.tab', { gain: 0.45 });
}
export function uiBuy(): void {
  play('ui.buy', { gain: 0.8 });
}
export function uiError(): void {
  play('ui.error', { gain: 0.5, vary: 0 });
}

// ---------------------------------------------------------------------------
// Автоматы.
// ---------------------------------------------------------------------------

let spin: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/**
 * Вращение барабанов — одна петля мягких щелчков, а не отдельный шумовой
 * щелчок каждые 55–80 мс (так было, и это было половиной «крови из ушей»).
 */
export function reelSpin(on: boolean, fast = false): void {
  const c = ctx;
  if (!on) {
    if (spin && c) {
      try {
        const t = c.currentTime;
        spin.gain.gain.setTargetAtTime(0.0001, t, 0.05);
        spin.src.stop(t + 0.3);
      } catch {
        /* no-op */
      }
    }
    spin = null;
    return;
  }
  if (spin || muted || !c || !sfxBus || c.state !== 'running') return;
  const l = bank.get('reel.spin');
  if (!l) {
    void load('reel.spin');
    return;
  }
  try {
    const src = c.createBufferSource();
    src.buffer = l[0].buf;
    src.loop = true;
    src.playbackRate.value = fast ? 1.35 : 1;
    const gain = c.createGain();
    gain.gain.value = 0.55;
    src.connect(gain).connect(sfxBus);
    src.start(c.currentTime, Math.random() * 1.5);
    spin = { src, gain };
  } catch {
    spin = null;
  }
}

/** Оставлен ради старых вызовов: одиночный тихий щелчок. */
export function reelTick(): void {
  play('case.tick', { gain: 0.25, rate: 0.9 });
}

/** Барабан встал: глухой «тук», каждый следующий чуть ниже. */
export function reelStop(index = 0): void {
  play('reel.stop', { gain: 0.8, rate: 1 - index * 0.04 });
}

/** Рычаг: лязг защёлки. */
export function leverPull(): void {
  play('reel.lever', { gain: 0.7 });
}

/** Нарастающее напряжение: трель, пока третий барабан тормозит. */
export function anticipation(): void {
  jingle('slot.tension', 1.4, { gain: 0.6 });
}

/** Выигрыш: короткая фраза стил-драм; крупный — восходящий пассаж. */
export function winChime(level: 'small' | 'big'): void {
  if (level === 'big') jingle(voice('slot.win.b'), 1.4, { gain: 0.8 });
  else jingle(voice('slot.win.s'), 0.9, { gain: 0.65 });
}

/** Джекпот: пассаж и барабанная дробь поверх. */
export function jackpotFanfare(): void {
  jingle(voice('slot.win.b'), 1.6, { gain: 0.9 });
  play('slot.drum.5', { gain: 0.7, vary: 0 });
  play('chips.stack', { gain: 0.7, at: 0.35 });
}

/** Тик счётчика во время подсчёта выигрыша: фишка ложится на стол. */
export function counterTick(): void {
  play('chip.lay', { gain: 0.35, vary: 0.08 });
}

/** Монета — звон фишек. Для дождя монет, продажи и наград. */
export function coinDing(at = 0): void {
  play('chip', { at, gain: 0.55, vary: 0.08 });
}

/**
 * Звено каскада: стеклянный «дзынь», который забирается вверх по тонам —
 * ухо само считает звенья.
 */
export function comboHit(step: number): void {
  const n = Math.max(1, Math.min(step, 8));
  play('gem.chime', { gain: 0.6, rate: Math.pow(2, ((n - 1) * 2) / 12), vary: 0 });
}

/** Символы рассыпались: хруст стекла. */
export function symbolBurst(): void {
  play('gem.burst', { gain: 0.45 });
}

/**
 * Падение сферы-множителя. Ухо узнаёт редкость раньше, чем глаз прочитает
 * число: обычная — капля, редкая — звон, эпическая и выше — джингл.
 * `beats` — «вес события» из lib/orb-rarity (0…3).
 */
export function orbDrop(beats: number, at = 0): void {
  if (beats <= 0) play('bubble.low', { at, gain: 0.5 });
  else if (beats === 1) play('gem.chime', { at, gain: 0.6, rate: 1.19 });
  else if (beats === 2) jingle(voice('slot.win.e'), 1, { at, gain: 0.7 });
  else {
    jingle(voice('slot.win.b'), 1.5, { at, gain: 0.85 });
    play('orb.ring', { at: at + 0.25, gain: 0.35, rate: 0.8, vary: 0 });
  }
}

/** Счёт суммы множителей: щипок, высота ползёт вверх вместе с суммой. */
export function multTick(k: number): void {
  const x = Math.min(1, Math.max(0, k));
  play('pluck', { gain: 0.45, rate: Math.pow(2, (x * 12) / 12), vary: 0 });
}

/** Пузыри надуваются вокруг камней. */
export function bubbleForm(): void {
  play('bubble.low', { gain: 0.35, rate: 0.9 });
}

/** Два пузыря слились — «блоп», каждый следующий выше. */
export function bubbleMerge(k: number): void {
  play('bubble', { gain: 0.6, rate: Math.pow(2, Math.min(12, Math.max(0, k)) / 12), vary: 0.02 });
}

/** Общий пузырь лопнул. */
export function bubblePop(): void {
  play('bubble.pop', { gain: 0.6 });
}

/** Множитель применился к выплате — глухой удар «печати» и фишки. */
export function multSlam(): void {
  play('slam', { gain: 0.8 });
  play('chips.stack', { gain: 0.6, at: 0.04 });
}

/**
 * Тик счётчика выигрыша. Частота ровная (её задаёт rollup.ts), высота
 * ползёт вверх отрезок за отрезком — ухо слышит, что счёт забирается выше.
 */
export function rollupTick(leg: number, k: number): void {
  const semis = Math.min(14, leg * 2 + k * 2);
  play('chip.lay', { gain: 0.32, rate: Math.pow(2, semis / 12), vary: 0.03 });
}

/**
 * Пробой ступени. Эскалация обязана быть НЕРАВНОМЕРНОЙ: обычный порог —
 * короткий удар барабана, а легендарный — дробь с пассажем.
 */
export function tierBreak(beats: number): void {
  if (beats <= 0) play('slot.drum.1', { gain: 0.55, vary: 0 });
  else if (beats === 1) play('slot.drum.2', { gain: 0.65, vary: 0 });
  else if (beats === 2) jingle('slot.drum.3', 0.8, { gain: 0.75 });
  else if (beats === 3) {
    jingle('slot.drum.4', 1, { gain: 0.8 });
    play(voice('slot.win.e'), { gain: 0.6, at: 0.1, vary: 0 });
  } else {
    jingle('slot.drum.5', 1.3, { gain: 0.85 });
    play(voice('slot.win.b'), { gain: 0.75, at: 0.12, vary: 0 });
  }
}

/** Счёт договорил: фраза-разрешение «всё, это твоё». */
export function payoutEnd(beats: number): void {
  if (beats >= 3) jingle(voice('slot.win.m'), 1.3, { gain: 0.75 });
  else if (beats >= 1) jingle(voice('slot.win.s'), 1, { gain: 0.65 });
  else jingle(voice('slot.win.l'), 0.8, { gain: 0.5 });
  play('chips.stack', { gain: 0.5, at: 0.05 });
}

// ---------------------------------------------------------------------------
// Шахта: материал слышен по удару — земля глухая, камень звонкий, металл
// звенит, кристалл поёт.
// ---------------------------------------------------------------------------

export type MineSound = 'soil' | 'stone' | 'metal' | 'crystal' | 'star';

/** Удар кирки. Вариант и высота гуляют — сорок одинаковых ударов режут ухо. */
export function pickHit(kind: MineSound, crit = false): void {
  play(`pick.${kind}`, { gain: kind === 'soil' ? 0.7 : 0.55, vary: 0.06 });
  if (crit) play('crit.thud', { gain: 0.6 });
}

/** Блок развалился — громче удара и с хвостом: это событие, а не такт. */
export function blockBreak(kind: MineSound): void {
  if (kind === 'soil') play('break.soil', { gain: 0.55 });
  else if (kind === 'metal') play('break.metal', { gain: 0.5 });
  else if (kind === 'crystal' || kind === 'star') play('break.crystal', { gain: 0.5 });
  else play('break.stone', { gain: 0.6 });
}

/** По дну: кирка не берёт коренную породу. */
export function bedrockClink(): void {
  play('pick.metal', { gain: 0.35, rate: 1.5 });
}

/** Рюкзак полон — мешок шлёпнулся. */
export function bagFull(): void {
  play('bag.full', { gain: 0.8 });
  play('ui.error', { gain: 0.3, at: 0.08, vary: 0 });
}

/** Шахта обновляется: гул снизу и перестук поднимающихся блоков. */
export function mineRumble(): void {
  play('rumble', { gain: 0.8 });
  for (let i = 0; i < 4; i++) play('break.stone', { gain: 0.3, at: 0.25 + i * 0.12 });
}

/** Взрыв: бомба, Взрыв-зачарование, заряд, отбойник. `power` 1…3. */
export function boom(power = 1): void {
  const p = Math.max(1, Math.min(3, Math.round(power)));
  play(`boom.${p}`, { gain: 0.9, vary: 0.05 });
  if (p >= 2) for (let i = 0; i < 3; i++) play('break.stone', { gain: 0.35, at: 0.15 + i * 0.09 });
}

/** Фитиль шипит, бомба тикает. */
export function fuseTick(k = 0): void {
  play('fuse', { gain: 0.5 });
  play('tick', { gain: 0.4, rate: 1 + k * 0.08 });
}

/** Звено жилы: тон забирается вверх — ухо считает, сколько ушло разом. */
export function chainTick(k: number): void {
  play('pluck', { gain: 0.35, rate: Math.pow(2, Math.min(k, 12) / 12), vary: 0 });
}

/** Кураж: короткий восходящий пассаж. */
export function frenzyStart(): void {
  jingle('jingle.go', 0.9, { gain: 0.7 });
}

/** Щелчок ленты сундука, как у колеса удачи. */
export function caseTick(): void {
  play('case.tick', { gain: 0.5 });
}

/** Нашёлся ключ — «нашёл!». */
export function keyFound(): void {
  jingle('jingle.found', 0.7, { gain: 0.7 });
}

// ---------------------------------------------------------------------------
// Лес.
// ---------------------------------------------------------------------------

/** Удар топора; у пил вместо удара — рык мотора: пила не бьёт, а грызёт. */
export function axeChop(saw = false, crit = false): void {
  if (saw) play('saw.bite', { gain: 0.55, vary: 0.05 });
  else play('axe.chop', { gain: 0.75, vary: 0.06 });
  if (crit) play('crit.thud', { gain: 0.6 });
}

/** Бревно отлетело в штабель. */
export function logOff(): void {
  play('log.drop', { gain: 0.55 });
}

/** «Бойся!»: скрип ствола и глухой удар о снег. */
export function treeFall(): void {
  play('tree.creak', { gain: 0.6 });
  play('tree.thud', { gain: 0.85, at: 0.5 });
  play('snow.thud', { gain: 0.6, at: 0.52 });
}

/** Сучок по лбу. */
export function branchHit(): void {
  play('crit.thud', { gain: 0.75, rate: 1.1 });
  play('log.drop', { gain: 0.4, at: 0.03 });
}

// ---------------------------------------------------------------------------
// Подземелье.
// ---------------------------------------------------------------------------

/** Свист клинка. Тяжёлый — ниже. `step` — номер удара серии. */
export function swordSwing(step = 0, heavy = false): void {
  play('swing', { gain: heavy ? 0.7 : 0.5, rate: heavy ? 0.82 : 1 + step * 0.05 });
}

/** Клинок вошёл. Крит — со звоном стали, по боссу — ниже. */
export function swordHit(crit = false, boss = false): void {
  play('hit', { gain: 0.6, rate: boss ? 0.85 : 1.05, vary: 0.08 });
  if (crit) play('pick.metal', { gain: 0.35, at: 0.01 });
}

/** Крысиный писк — выползла из норы, заметила, сдохла (`k` 0…2). */
export function ratSqueak(k = 0): void {
  const name = k === 0 ? 'rat.call' : k === 1 ? 'rat.attack' : 'rat.die';
  play(name, { gain: 0.45, vary: 0.1 });
}

/** Крыса убита: предсмертный писк и мягкий шлепок. */
export function ratDie(big = false): void {
  play('rat.die', { gain: big ? 0.6 : 0.45, rate: big ? 0.75 : 1, vary: 0.1 });
  play('break.soil', { gain: big ? 0.6 : 0.4, at: 0.03 });
}

/** Укус по герою. */
export function heroHurt(): void {
  play('bite', { gain: 0.6 });
  play('crit.thud', { gain: 0.45, at: 0.02 });
}

/** Рывок: свист и шорох. */
export function dashWhoosh(): void {
  play('dash', { gain: 0.5 });
}

/** Уклон в последний миг: время замерло — звон. */
export function perfectDodge(): void {
  play('orb.ring', { gain: 0.3, rate: 0.9, vary: 0 });
  play('gem.chime', { gain: 0.4, rate: 1.5, vary: 0 });
}

/** Подобрал: монета звякает, токен поёт, мясо шуршит. */
export function pickUp(what: string): void {
  if (what === 'coin') play('coins', { gain: 0.45 });
  else if (what === 'token') play('gem.chime', { gain: 0.45, rate: 1.33 });
  else if (what === 'key' || what === 'crown') keyFound();
  else play('cloth', { gain: 0.5 });
}

/** Ящик или бочка разлетелись. */
export function crateBreak(): void {
  play('crate', { gain: 0.7 });
}

/** Вагонетка покатилась: гул колёс. */
export function cartRoll(v = 1): void {
  const k = Math.min(1.5, Math.max(0.5, v / 6));
  play('rumble', { gain: 0.3 * k, rate: 1.4 + k * 0.3 });
}

/** Гул из глубины: орда или вагонетка сорвалась. */
export function deepRumble(): void {
  play('rumble', { gain: 0.8, rate: 0.85 });
}

/** Крысиный король: рёв великана, над ним писк свиты. */
export function kingRoar(): void {
  play('roar', { gain: 0.9, rate: 1.1 });
  play('rat.attack', { gain: 0.45, at: 0.1, rate: 0.8 });
  play('rat.call', { gain: 0.35, at: 0.25, rate: 0.9 });
}

/** Ворота арены: лязг решётки об пол. */
export function gateSlam(): void {
  play('gate', { gain: 0.8 });
  play('clang', { gain: 0.5, at: 0.05 });
}

/** Съел. */
export function eatChomp(): void {
  play('bite', { gain: 0.6 });
  play('bite', { gain: 0.45, at: 0.18 });
}

/** Новый уровень героя — восходящий пассаж. */
export function levelUp(): void {
  jingle('jingle.up', 1.1, { gain: 0.8 });
}

/** Серия убийств выросла: удар барабана, выше с каждой ступенью. */
export function streakUp(tier: number): void {
  const t = Math.max(1, Math.min(tier, 3));
  play(`slot.drum.${t}`, { gain: 0.55, vary: 0 });
}

/** Лифт: скрип троса, лязг защёлки. */
export function liftClank(): void {
  play('winch', { gain: 0.6 });
  play('latch', { gain: 0.8, at: 0.4 });
  play('clang', { gain: 0.4, at: 0.42 });
}

/** Смерть героя: удар и нисходящий пассаж. */
export function heroDeath(): void {
  play('break.soil', { gain: 0.8 });
  jingle('jingle.down', 1.3, { gain: 0.8, at: 0.2 });
}

// ---------------------------------------------------------------------------
// Живность шахты и риск-игра (v2.64).
// ---------------------------------------------------------------------------

/** Взмах крыльев: мышь и сорока. Тише у дальних — `gain`. */
export function wingFlap(gain = 0.35): void {
  play('flap', { gain, vary: 0.08 });
}

/** Летучая мышь пискнула: заметили или поймали. */
export function batSqueak(caught = false): void {
  play('bat.squeak', { gain: caught ? 0.7 : 0.4, rate: caught ? 1.1 : 1, vary: 0.06 });
  if (caught) play('crit.thud', { gain: 0.35, at: 0.02 });
}

/** Блестяшка подобрана: звон стекла, выше с каждой подряд. */
export function shinyPick(k = 0): void {
  play('shiny', { gain: 0.5, rate: Math.pow(2, Math.min(k, 12) / 24), vary: 0 });
  play('coins', { gain: 0.25, at: 0.03 });
}

/** Карты: сдать на стол, открыть, перетасовать, раскрыть веером. */
export function cardDeal(at = 0): void {
  play('card.deal', { gain: 0.55, at });
}
export function cardFlip(): void {
  play('card.flip', { gain: 0.7 });
}
export function cardShuffle(): void {
  play('card.shuffle', { gain: 0.6 });
}
export function cardFan(): void {
  play('card.fan', { gain: 0.6 });
}

/** Риск: угадал — пассаж выше с каждым удвоением; мимо — вниз; ничья — вопрос. */
export function riskWin(step: number): void {
  jingle(step >= 3 ? 'jingle.win' : step >= 2 ? 'jingle.up' : 'jingle.go', 1, { gain: 0.75 });
  play('chips.stack', { gain: 0.45, at: 0.08 });
}
export function riskLose(): void {
  jingle('jingle.down', 1.2, { gain: 0.7 });
}
export function riskDraw(): void {
  jingle('jingle.nope', 0.8, { gain: 0.6 });
}

/** Сорока уронила блестяшку: тихий звон, чтобы слышно было, куда смотреть. */
export function shinyDrop(): void {
  play('shiny', { gain: 0.16, rate: 0.9 });
}

// ---------------------------------------------------------------------------
// Рыбалка (v2.65).
// ---------------------------------------------------------------------------

/** Заброс: свист удилища, потом поплавок шлёпается — `far` 0…1 даёт паузу. */
export function castWhoosh(far: number): void {
  play('swing', { gain: 0.45, rate: 0.9 });
  play('plop', { gain: 0.55, at: 0.35 + 0.35 * far });
}

/** Поплавок дёрнулся: холостая поклёвка — тихо; настоящая — всплеск. */
export function floatTwitch(real: boolean): void {
  if (real) {
    play('splash', { gain: 0.7 });
    play('plop', { gain: 0.5, rate: 0.8 });
  } else play('plop', { gain: 0.25, rate: 1.2 });
}

/** Катушка: щелчок трещотки; частота — как быстро крутишь. */
export function reelClick(tension: number): void {
  play('tick', { gain: 0.18 + 0.2 * tension, rate: 0.9 + 0.5 * tension, vary: 0.02 });
}

/** Рыба бьётся у поверхности. */
export function fishSplash(power = 1): void {
  play('splash', { gain: Math.min(0.9, 0.35 + 0.25 * power) });
}

/** Леска лопнула. */
export function lineSnap(): void {
  play('snap', { gain: 0.8 });
  jingle('jingle.nope', 0.8, { gain: 0.45, at: 0.1 });
}

/** Вытащил: плеск и звон, редкая — пассаж. `beats` — как у сундука. */
export function fishLanded(beats: number): void {
  play('splash', { gain: 0.5, rate: 1.2 });
  if (beats >= 2) jingle('jingle.win', 1.2, { gain: 0.75, at: 0.1 });
  else if (beats >= 1) jingle('jingle.found', 0.8, { gain: 0.65, at: 0.1 });
  else play('coins', { gain: 0.4, at: 0.1 });
}
