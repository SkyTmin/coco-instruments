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

import { AUDIO_REV, MUSIC_TRACKS, SFX_LOOPS, SFX_VARIANTS } from '@/lib/audio-manifest';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let sfxBus: GainNode | null = null;
/** Полка по верхам на эффектах: в каторге срезает звон, в казино ровная. */
let warm: BiquadFilterNode | null = null;
let musicBus: GainNode | null = null;
let muted = false;
let musicOn = true;
/** Было касание экрана: без него iOS не даст контексту играть. */
let primed = false;

/** Громкость музыки относительно эффектов: подложка, а не солист. */
const MUSIC_LEVEL = 0.42;
const SFX_LEVEL = 0.9;

/**
 * «Тёплая» полка каторги (v2.67.3): всё, что выше 2,8 кГц, на 7 дБ тише.
 * Владелец: «звуки должны быть мягкими и приятными, а не звонкими и
 * отталкивающими». Звон — это и есть энергия в 2–6 кГц, к которой ухо
 * чувствительнее всего: у монет, металла, защёлок и щелчков её 60–98%
 * (замер с A-взвешиванием по готовым файлам). Полка
 * смягчает разом все эффекты шахты, леса, двора, рыбалки и подземелья и
 * не трогает казино — там звон и есть жанр. Музыка идёт мимо неё.
 */
const WARM_HZ = 2800;
const WARM_DB = -7;

/**
 * Чей голос у джинглов: в зале и автоматах — стил-драм, в каторге —
 * пиццикато. Та же мелодия, но стил-драм в шахте звучит казино.
 */
let flavor: 'casino' | 'camp' = 'casino';

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
    warm = ctx.createBiquadFilter();
    warm.type = 'highshelf';
    warm.frequency.value = WARM_HZ;
    warm.gain.value = flavor === 'camp' ? WARM_DB : 0;
    sfxBus.connect(warm).connect(comp);
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

/**
 * Наборы звуков по местам: грузятся, когда игрок туда пришёл. `floors` —
 * все звуки этажей 6–15 разом (≈1,3 МБ); по одному этажу — `preloadFloorSounds`.
 */
export type SoundGroup = 'ui' | 'slots' | 'mine' | 'forest' | 'dungeon' | 'fishing' | 'floors';

/** Звуки этажей 6–15 (v2.83): стихии, механизмы, время, финал. */
const FLOOR_SFX =
  /^(thunder|wind|lava\.|steam|glass\.break|string|train|clock\.|heart|flesh|warp|stone\.grind|chains|cannon|laser|time\.|choir|beast)/;

const GROUPS: Record<SoundGroup, (name: string) => boolean> = {
  ui: (n) =>
    /^(ui\.|chip|coins|cloth|jingle\.|rank\.up|soft\.up|slot\.drum|slot\.win|tick|case\.tick|crate|latch|gem\.|card\.flip|crit\.thud|dash|step\.)/.test(
      n,
    ),
  slots: (n) => /^(reel\.|slot\.|gem\.|pluck|bubble|orb\.|slam|chips)/.test(n),
  mine: (n) =>
    /^(pick\.|crit\.|break\.|bag\.|rumble|boom\.|fuse|gem\.chime|pluck|card\.|flap|shiny|bat\.|clang|jingle\.)/.test(
      n,
    ),
  forest: (n) => /^(axe\.|saw\.|log\.|tree\.|snow\.|crit\.|bag\.)/.test(n),
  fishing: (n) => /^(splash|plop|snap|swing|tick|bubble|coins|gem\.chime|pluck|card\.)/.test(n),
  dungeon: (n) =>
    /^(swing|hit|bite|dash|crate|gate|clang|latch|winch|roar|rat\.|rumble|boom\.|pick\.|break\.|crit\.|bag\.|gem\.chime|splash|plop)/.test(
      n,
    ),
  floors: (n) => FLOOR_SFX.test(n),
};

export function preloadSounds(...groups: SoundGroup[]): void {
  for (const name of Object.keys(SFX_VARIANTS))
    if (groups.some((g) => GROUPS[g](name))) void load(name);
}

/**
 * Что звучит на каком этаже (v2.83). Первый вызов незагруженного звука
 * молчит — пока идёт загрузка, — поэтому этаж просит свой набор заранее,
 * при входе: гром на первой молнии и хор финала обязаны прозвучать.
 * Этаж 15 — сердце, которое «переварило» всё выше, — берёт всё.
 */
export const FLOOR_SOUNDS: Record<number, readonly string[]> = {
  6: ['lava.bubble', 'lava.hiss', 'steam', 'stone.grind', 'beast', 'thunder', 'wind'],
  7: ['glass.break', 'warp', 'string.bend', 'time.stop', 'time.go'],
  8: ['string', 'string.bend', 'stone.grind', 'clock.bell', 'warp', 'wind'],
  9: ['warp', 'flesh', 'lava.hiss', 'steam', 'thunder', 'beast', 'stone.grind'],
  10: ['thunder', 'chains', 'stone.grind', 'glass.break', 'wind', 'beast'],
  11: ['wind', 'laser', 'laser.hum', 'stone.grind', 'chains', 'cannon', 'steam', 'thunder'],
  12: [
    'glass.break',
    'wind',
    'beast',
    'stone.grind',
    'clock.bell',
    'chains',
    'steam',
    'lava.hiss',
    'heart',
    'warp',
    'splash',
    'flap',
    'dash',
    'rumble',
  ],
  13: [
    'string',
    'string.bend',
    'chains',
    'clock.bell',
    'gate',
    'clang',
    'wind',
    'stone.grind',
    'glass.break',
  ],
  14: [
    'clock.tick',
    'clock.bell',
    'time.stop',
    'time.go',
    'warp',
    'stone.grind',
    'chains',
    'glass.break',
  ],
};

/** Загрузить звуки этажа `floor` (6–15); прочие этажи звучат общим набором. */
export function preloadFloorSounds(floor: number): void {
  const names =
    floor >= 15 ? Object.keys(SFX_VARIANTS).filter((n) => FLOOR_SFX.test(n)) : FLOOR_SOUNDS[floor];
  for (const name of names ?? []) void load(name);
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
  chip: 3,
  'chip.lay': 3,
  'chips.stack': 2,
  coins: 2,
  tick: 2,
  'case.tick': 2,
  pluck: 3,
  'gem.burst': 3,
  'gem.chime': 2,
  shiny: 3,
  'crit.thud': 2,
  'break.soil': 3,
  'break.stone': 3,
  'break.metal': 3,
  'break.crystal': 3,
  'boom.1': 2,
  'boom.2': 1,
  'boom.3': 1,
  rumble: 1,
  swing: 2,
  hit: 3,
  'step.ground': 1,
  'step.wood': 1,
  // v2.83, этажи 6–15. Долгие звуки (гром, поезд, хор) — по одному: два
  // раската разом — уже каша, а не гроза.
  thunder: 1,
  wind: 2,
  'lava.bubble': 2,
  'lava.hiss': 1,
  steam: 2,
  'glass.break': 2,
  string: 3,
  'string.bend': 1,
  train: 1,
  'train.horn': 1,
  'clock.tick': 1,
  'clock.bell': 13, // бой до двенадцати ударов: будущие удары уже заняли голоса
  heart: 1,
  flesh: 3,
  warp: 2,
  'stone.grind': 1,
  chains: 2,
  cannon: 2,
  laser: 1,
  'time.stop': 1,
  'time.go': 1,
  choir: 1,
  beast: 1,
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
  shiny: 0.06,
  plop: 0.05,
  splash: 0.08,
  // v2.67.1: всё, что сыплется пачкой (взрыв, жила, дождь монет), — не чаще.
  'crit.thud': 0.06,
  'gem.chime': 0.07,
  'chips.stack': 0.12,
  coins: 0.1,
  'break.soil': 0.03,
  'break.stone': 0.03,
  'break.metal': 0.03,
  'break.crystal': 0.03,
  'boom.1': 0.12,
  'boom.2': 0.2,
  'boom.3': 0.3,
  rumble: 1.2,
  'slot.drum.1': 0.12,
  'slot.drum.2': 0.12,
  'slot.drum.3': 0.4,
  // v2.83, этажи 6–15: события, которые приходят пачкой (гейзеры рядами,
  // удары по стеклу, шлепки плоти), — не чаще.
  thunder: 1.5,
  wind: 0.6,
  'lava.bubble': 0.15,
  'lava.hiss': 0.5,
  steam: 0.3,
  'glass.break': 0.08,
  string: 0.06,
  'string.bend': 0.8,
  train: 3,
  'train.horn': 2,
  'clock.tick': 0.25,
  'clock.bell': 0.5,
  heart: 0.3,
  flesh: 0.06,
  warp: 0.12,
  'stone.grind': 0.5,
  chains: 0.25,
  cannon: 0.2,
  laser: 0.3,
  'time.stop': 1,
  'time.go': 1,
  choir: 3,
  beast: 1,
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
    // Все голоса заняты — новый не звучит. Раньше обрывался самый старый:
    // оборванный сэмпл щёлкает, и пачка звуков превращалась в треск.
    const max = VOICES[name] ?? 6;
    const live = voices.get(name) ?? [];
    if (live.length >= max) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const vary = opts.vary ?? 0.04;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = c.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g).connect(sfxBus);
    src.start(t0, lead);
    live.push(src);
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
  if (scene) {
    flavor = scene === 'hall' || scene === 'slots' || scene === 'cascade' ? 'casino' : 'camp';
    if (ctx && warm)
      warm.gain.setTargetAtTime(flavor === 'camp' ? WARM_DB : 0, ctx.currentTime, 0.05);
  }
  wantScene = scene;
  if (!scene) {
    fadeOut(current);
    current = null;
    stopLoops();
    return;
  }
  if (current?.scene === scene) return;
  void startScene(scene);
}

let duckUntil = 0;
/**
 * Приглушить музыку на время джингла, чтобы выигрыш не тонул в подложке.
 * `depth` — до какой доли громкости (остановка времени глушит глубже).
 */
function duck(sec: number, depth = 0.35): void {
  if (!ctx || !musicBus || muted || !musicOn) return;
  try {
    const t = ctx.currentTime;
    const until = t + sec;
    if (until <= duckUntil) return;
    duckUntil = until;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL * depth, t, 0.05);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL, until, 0.4);
  } catch {
    /* no-op */
  }
}

/** Вернуть музыку сразу, не дожидаясь конца приглушения (время пошло). */
function unduck(): void {
  if (!ctx || !musicBus) return;
  try {
    const t = ctx.currentTime;
    duckUntil = t;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(muted || !musicOn ? 0 : MUSIC_LEVEL, t, 0.12);
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Петли эффектов: включить и выключить (гул долгого луча). Как вращение
// барабанов, только по имени; уход из игр (`setMusicScene(null)`) глушит все.
// ---------------------------------------------------------------------------

const loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

function loopSound(name: string, on: boolean, gain = 0.4, rate = 1): void {
  const c = ctx;
  const have = loops.get(name);
  if (!on) {
    if (have && c) {
      try {
        const t = c.currentTime;
        have.gain.gain.setTargetAtTime(0.0001, t, 0.08);
        have.src.stop(t + 0.5);
      } catch {
        /* no-op */
      }
    }
    loops.delete(name);
    return;
  }
  if (have || muted || !c || !sfxBus || c.state !== 'running') return;
  const l = bank.get(name);
  if (!l) {
    void load(name);
    return;
  }
  try {
    const { buf, lead } = l[0];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Точки петли — по настоящей длине из манифеста, как у музыки: хвостовая
    // тишина MP3 в петлю не попадёт, даже если браузер её не срезал.
    const dur = SFX_LOOPS[name] ?? buf.duration - lead;
    src.loopStart = lead;
    src.loopEnd = Math.min(buf.duration, lead + dur);
    src.playbackRate.value = rate;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(gain, t, 0.08);
    src.connect(g).connect(sfxBus);
    src.start(t, lead);
    loops.set(name, { src, gain: g });
  } catch {
    loops.delete(name);
  }
}

function stopLoops(): void {
  for (const name of [...loops.keys()]) loopSound(name, false);
}

/**
 * Бюджет мелодий в каторге (v2.67.1): не чаще одной фразы в `PHRASE_GAP`
 * секунд. Владелец: «слишком много ненужных звуков… когда ключ выпадает,
 * этот звук очень раздражает и похожие». Мелодия в игре, где бьёшь 5–10 раз
 * в секунду, — это событие; когда их несколько в минуту, это шум. Частые
 * события звучат тихим сигналом (`softChime`, `softThud`), фраза остаётся
 * ранга, престижа, редкой выковки и смерти.
 */
const PHRASE_GAP = 10;
let lastPhrase = -1e9;

/** Джингл: музыка уходит в тень на его длину. В каторге — по бюджету. */
function jingle(name: string, sec: number, opts: PlayOpts = {}): boolean {
  const c = ctx;
  if (flavor === 'camp' && c) {
    const t = c.currentTime + (opts.at ?? 0);
    if (t - lastPhrase < PHRASE_GAP) return false;
    lastPhrase = t;
  }
  duck(sec + (opts.at ?? 0));
  play(name, { vary: 0, ...opts });
  return true;
}

/**
 * Тихий стеклянный «дзынь» — для частых хороших новостей: ключ, уровень
 * кирки, посылка, блок под сломанным. `k` поднимает тон на полтона за шаг.
 */
export function softChime(k = 0): void {
  play('gem.chime', { gain: 0.26, rate: Math.pow(2, Math.min(k, 7) / 12), vary: 0.02 });
}

/**
 * Шаг героя на площади (v2.80): тихий, один голос — площадь зовёт его на каждом
 * втором кадре ходьбы, громче будет барабанной дробью. wood — полы в зданиях.
 */
export function footstep(wood = false): void {
  play(wood ? 'step.wood' : 'step.ground', { gain: 0.22, vary: 0.06 });
}

/** Тихий глухой удар — «готово», без мелодии. */
export function softThud(gain = 0.32): void {
  play('crit.thud', { gain, rate: 1.15, vary: 0.04 });
}

/**
 * Большое событие каторги — новый этаж, престиж, легендарная кирка, король:
 * нарастающий аккорд до-ми-соль-до (атака 0,9 с, ни щелчка, ни шума). Идёт
 * мимо бюджета мелодий — такое бывает раз в несколько минут, — но сам его
 * занимает, чтобы следом не влезла ещё одна фраза.
 */
export function bigMoment(gain = 0.8): void {
  if (ctx) lastPhrase = ctx.currentTime;
  duck(2.2);
  play('rank.up', { gain, vary: 0 });
}

/** Редкая награда: мягкое арпеджио колокольчиком. По бюджету мелодий. */
function softPhrase(gain = 0.6, at = 0): boolean {
  return jingle('soft.up', 1.2, { gain, at });
}

// ---------------------------------------------------------------------------
// Интерфейс.
// ---------------------------------------------------------------------------

export function uiTap(): void {
  play('ui.tap', { gain: 0.5, vary: 0.06 });
}
export function uiOpen(): void {
  play('ui.open', { gain: 0.4 });
}
export function uiClose(): void {
  play('ui.close', { gain: 0.35 });
}
export function uiTab(): void {
  play('ui.tab', { gain: 0.45 });
}
export function uiBuy(): void {
  play('ui.buy', { gain: 0.55 });
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
  // В каторге (король повержен) — аккорд, без тарелки и фишек казино.
  if (flavor === 'camp') {
    bigMoment(0.85);
    play('coins', { gain: 0.3, at: 0.3 });
    return;
  }
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
  play('chip', { at, gain: flavor === 'camp' ? 0.24 : 0.55, vary: 0.08 });
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
  // В каторге табло досчитывает каждую продажу — там тиканье еле слышно.
  play('chip.lay', {
    gain: flavor === 'camp' ? 0.14 : 0.32,
    rate: Math.pow(2, semis / 12),
    vary: 0.03,
  });
}

/**
 * Пробой ступени. Эскалация обязана быть НЕРАВНОМЕРНОЙ: обычный порог —
 * короткий удар барабана, а легендарный — дробь с пассажем.
 */
export function tierBreak(beats: number): void {
  // В каторге — без барабанной дроби и фраз: барабаны набора звонкие (у
  // них 30–40% энергии в резкой середине 2–6 кГц), а зовут эту функцию
  // двадцать мест шахты. Фраза — только от четвёртой ступени и по бюджету.
  // v2.67.3: и без ударов барабана вовсе. Четвёртая ступень (новый этаж)
  // звучала ударом тарелки — шум по всей полосе почти секунду, — и
  // владелец назвал его ужасным.
  if (flavor === 'camp') {
    if (beats <= 1) softThud(0.3);
    else if (beats === 2) {
      softThud(0.36);
      softChime(4);
    } else if (beats === 3) {
      softThud(0.36);
      if (!softPhrase(0.55, 0.05)) softChime(7);
    } else bigMoment();
    return;
  }
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
  if (flavor === 'camp') {
    play('chips.stack', { gain: 0.26 });
    if (beats >= 3) softPhrase(0.5, 0.05);
    return;
  }
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
  // Металл звенит сильнее всего остального (64% энергии в резкой середине):
  // на тон ниже и тише.
  if (kind === 'metal') play('pick.metal', { gain: 0.36, rate: 0.88, vary: 0.06 });
  else play(`pick.${kind}`, { gain: kind === 'soil' ? 0.62 : 0.48, vary: 0.06 });
  if (crit) play('crit.thud', { gain: 0.45 });
}

/** Блок развалился — громче удара и с хвостом: это событие, а не такт. */
export function blockBreak(kind: MineSound): void {
  if (kind === 'soil') play('break.soil', { gain: 0.45 });
  else if (kind === 'metal') play('break.metal', { gain: 0.4 });
  else if (kind === 'crystal' || kind === 'star') play('break.crystal', { gain: 0.4 });
  else play('break.stone', { gain: 0.48 });
}

/** По дну: кирка не берёт коренную породу. */
export function bedrockClink(): void {
  // Был звон металла на квинту выше — теперь глухой стук: «не берёт».
  play('pick.stone', { gain: 0.4, rate: 0.72, vary: 0.04 });
}

/** Кирка по руде твёрже себя (v2.67): звон и искры — и ничего. */
export function hardClang(): void {
  // Был лязг на кварту выше и звон поверх — самый резкий звук шахты, а
  // бьёшь по такой руде очередью. Теперь глухой «тук» с металлом где-то
  // внизу: не берёт — и так видно по искрам и метке «⛏N».
  play('pick.stone', { gain: 0.42, rate: 0.7, vary: 0.04 });
  play('clang', { gain: 0.14, rate: 0.62, vary: 0.03, at: 0.01 });
}

/** Удар молота по наковальне в сцене выковки: от удара к удару выше. */
export function forgeStrike(i: number): void {
  // Наковальня обязана звенеть, но не резать: ниже тоном и тише, чем была.
  play('clang', { gain: 0.42, rate: 0.72 + 0.06 * i, vary: 0 });
  play('crit.thud', { gain: 0.55 });
  if (i >= 2) softChime(2);
}

/** Кирка проявилась: чем реже, тем длиннее фраза (эскалация неравномерна). */
export function forgeReveal(rarity: number): void {
  // Одна фраза, не две разом: раньше легендарная звучала дробью с фразой
  // из tierBreak(4) и поверх ещё своей.
  softThud(0.4);
  if (rarity >= 4) bigMoment(0.75);
  else if (rarity >= 2) {
    if (!softPhrase(0.55, 0.1)) softChime(4);
  } else softChime(4);
}

/** Рюкзак полон — мешок шлёпнулся. */
export function bagFull(): void {
  play('bag.full', { gain: 0.55 });
}

/** Шахта обновляется: гул снизу и перестук поднимающихся блоков. */
export function mineRumble(): void {
  play('rumble', { gain: 0.45 });
}

/** Взрыв: бомба, Взрыв-зачарование, заряд, отбойник. `power` 1…3. */
export function boom(power = 1): void {
  const p = Math.max(1, Math.min(3, Math.round(power)));
  play(`boom.${p}`, { gain: p === 1 ? 0.55 : 0.7, vary: 0.05 });
}

/** Фитиль шипит, бомба тикает. */
export function fuseTick(k = 0): void {
  play('fuse', { gain: 0.5 });
  play('tick', { gain: 0.4, rate: 1 + k * 0.08 });
}

/** Звено жилы: тон забирается вверх — ухо считает, сколько ушло разом. */
export function chainTick(k: number): void {
  play('pluck', { gain: 0.22, rate: Math.pow(2, Math.min(k, 12) / 12), vary: 0 });
}

/** Кураж: короткий восходящий пассаж. */
export function frenzyStart(): void {
  softThud(0.4);
  softChime(5);
}

/** Щелчок ленты сундука, как у колеса удачи. */
export function caseTick(): void {
  play('case.tick', { gain: 0.32 });
}

/**
 * Нашёлся ключ. Был джингл-пиццикато на 0,6 с — владелец: «очень
 * раздражает». Ключ падает раз в несколько минут, и сцена тотема его и так
 * показывает — хватает тихого «дзынь».
 */
export function keyFound(): void {
  softChime(3);
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
  play('log.drop', { gain: 0.4 });
}

/** «Бойся!»: скрип ствола и глухой удар о снег. */
export function treeFall(): void {
  play('tree.creak', { gain: 0.4 });
  play('tree.thud', { gain: 0.6, at: 0.5 });
  play('snow.thud', { gain: 0.35, at: 0.52 });
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
  play(name, { gain: 0.32, vary: 0.1 });
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

/**
 * Дверь на площади: щеколда и глухой стук створки. Мягко — дверь стучит
 * каждый раз, как входишь в здание, звонкий лязг решётки тут утомил бы.
 */
export function doorLatch(): void {
  play('latch', { gain: 0.42, rate: 0.9, vary: 0.05 });
  softThud(0.22);
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
  if (!softPhrase(0.7)) softChime(5);
}

/** Серия убийств выросла: удар барабана, выше с каждой ступенью. */
export function streakUp(tier: number): void {
  // Были удары барабанов набора — те же звонкие, что у нового этажа.
  const t = Math.max(1, Math.min(tier, 3));
  softThud(0.3 + 0.06 * t);
  softChime(t * 2);
}

/** Лифт: скрип троса, лязг защёлки. */
export function liftClank(): void {
  play('winch', { gain: 0.6 });
  play('latch', { gain: 0.45, at: 0.4 });
  play('clang', { gain: 0.22, rate: 0.8, at: 0.42 });
}

/** Смерть героя: удар и нисходящий пассаж. */
export function heroDeath(): void {
  play('break.soil', { gain: 0.8 });
  jingle('jingle.down', 1.3, { gain: 0.8, at: 0.2 });
}

// ---------------------------------------------------------------------------
// Этажи 6–15 (v2.83): стихии, механизмы, время, финал.
//
// Записи из свободных наборов (CC0 и CC BY — public/audio/CREDITS.txt),
// выбранные по замерам без прослушивания: A-взвешенная доля выше 2,5 кГц,
// атака, спектрограмма (правило v2.67.3). Всё, что по природе звонкое —
// стекло, цепи, пар, влажное, — собрано ниже тоном и со срезанными верхами
// и звучит тише остального. Частые события (гейзер рядами, шаг поезда,
// тиканье, удары по плоти) — короткие и без мелодии; мелодия — только хор
// финала, и он занимает бюджет фраз, как `bigMoment`.
// ---------------------------------------------------------------------------

/** Далёкий гром — низкий раскат без треска. `near` — ближе, громче и ниже. */
export function thunder(near = false): void {
  play('thunder', { gain: near ? 0.75 : 0.5, rate: near ? 0.92 : 1, vary: 0.05 });
}

/** Порыв ветра: нарастает и уходит (~2,3 с). `k` — сила 0…1. */
export function windGust(k = 0.6): void {
  const s = Math.max(0, Math.min(1, k));
  play('wind', { gain: 0.25 + 0.4 * s, rate: 0.9 + 0.2 * s, vary: 0.06 });
}

/** Лава булькнула: густой пузырь. */
export function lavaBubble(): void {
  play('lava.bubble', { gain: 0.42, vary: 0.1 });
}

/** Лава зашипела: корка остыла, в неё нырнули, жерло выдохнуло. */
export function lavaHiss(): void {
  play('lava.hiss', { gain: 0.36, vary: 0.05 });
}

/** Пар вырвался из клапана или трещины. */
export function steamBurst(): void {
  play('steam', { gain: 0.3, vary: 0.05 });
}

/** Стекло разбилось — мягко, без визга. `big` — зеркало или витраж целиком. */
export function glassBreak(big = false): void {
  play('glass.break', { gain: big ? 0.46 : 0.32, rate: big ? 0.88 : 1.05, vary: 0.05 });
  if (big) play('crit.thud', { gain: 0.3, rate: 0.9, at: 0.01 });
}

/**
 * Лад бивы — японская пентатоника «мияко-буси» (ин): 0, 1, 5, 7, 8. Щипок
 * `k` идёт вверх по ладу: струнник, играющий подряд, звучит мелодией, а не
 * одной нотой.
 */
const IN_SCALE = [0, 1, 5, 7, 8, 12, 13, 17];

/** Щипок струны (бива). `k` — ступень лада (0 — нижняя, по кругу). */
export function stringPluck(k = 0): void {
  const i = ((Math.round(k) % IN_SCALE.length) + IN_SCALE.length) % IN_SCALE.length;
  play('string', { gain: 0.5, rate: Math.pow(2, IN_SCALE[i] / 12), vary: 0.004 });
}

/** Струна скользит вниз — комнаты сдвинулись, струна оборвалась. */
export function stringBend(): void {
  play('string.bend', { gain: 0.46, vary: 0.02 });
}

/** Поезд проходит по линии: гул с Доплером (~4 с), `horn` — с гудком в начале. */
export function trainPass(horn = true): void {
  play('train', { gain: 0.62, vary: 0.02 });
  if (horn) trainHorn(0.1);
}

/** Гудок поезда (семафор, фары из темноты). */
export function trainHorn(at = 0): void {
  play('train.horn', { gain: 0.46, at, vary: 0.01 });
}

let tock = false;
/** Часы: тик и так по очереди (так на полтона ниже). Для маятника и такта. */
export function clockTick(): void {
  tock = !tock;
  play('clock.tick', { gain: 0.34, rate: tock ? 0.94 : 1, vary: 0.01 });
}

/** Удар часового колокола. `deep` — «ЧАС»: октавой ниже и дольше. */
export function clockBell(deep = false): void {
  play('clock.bell', { gain: deep ? 0.62 : 0.46, rate: deep ? 0.5 : 1, vary: 0 });
}

/**
 * Бой часов: `n` ударов колокола (не больше двенадцати), одна нота — у
 * вариантов своя высота, поэтому бой берёт один и тот же. Первый удар —
 * сразу, дальше каждые 1,1 с (`deep` — через 1,6 с, низкий колокол гудит дольше).
 */
export function clockChime(n = 3, deep = false): void {
  const k = Math.max(1, Math.min(12, Math.round(n)));
  const step = deep ? 1.6 : 1.1;
  for (let i = 0; i < k; i++)
    play('clock.bell', {
      gain: deep ? 0.6 : 0.44,
      rate: deep ? 0.5 : 1,
      vary: 0,
      pick: 0,
      at: i * step,
    });
}

/** Сердцебиение: «тук-тук». `fast` — чаще и громче (сердце в ярости). */
export function heartbeat(fast = false): void {
  play('heart', { gain: fast ? 0.72 : 0.56, rate: fast ? 1.1 : 1, vary: 0.02 });
}

/** Влажный звук плоти: стена дышит, мешок лопнул, пиявка присосалась. */
export function fleshSquelch(big = false): void {
  play('flesh', { gain: big ? 0.52 : 0.38, rate: big ? 0.82 : 1, vary: 0.08 });
}

/** Телепорт: вдох и хлопок (круг, зеркало, отмотка). */
export function teleport(): void {
  play('warp', { gain: 0.5, vary: 0.04 });
}

/** Скрежет камня: плита, жернов, шестерня, стена сдвинулась. */
export function stoneGrind(): void {
  play('stone.grind', { gain: 0.44, vary: 0.05 });
}

/** Цепи: ворот, мост на цепях, маятник, крюк. */
export function chainRattle(): void {
  play('chains', { gain: 0.42, vary: 0.05 });
}

/** Пушка — глухой выстрел. `far` — со стены: тише и ниже. */
export function cannonShot(far = false): void {
  play('cannon', { gain: far ? 0.5 : 0.78, rate: far ? 0.88 : 1, vary: 0.04 });
}

/** Лазер: гул заряда и луч (~1,1 с), разовый. */
export function laserBeam(): void {
  play('laser', { gain: 0.46, vary: 0.03 });
}

/** Долгий луч (лазер по кругу): петля гула — включить и выключить. */
export function laserHum(on: boolean): void {
  loopSound('laser.hum', on, 0.3);
}

/**
 * Время остановилось: гонг задом наперёд (вдох) и глухой удар. Музыка на
 * `dur` секунд уходит почти в тишину — мир стоит; `timeResume` возвращает
 * её сразу. Удар — через ~2 с после вызова: звать в начале замаха.
 */
export function timeStop(dur = 2.5): void {
  duck(Math.max(1, dur) + 2, 0.12);
  play('time.stop', { gain: 0.62, vary: 0 });
}

/** Время пошло: выдох и тихий гонг, музыка возвращается. */
export function timeResume(): void {
  unduck();
  play('time.go', { gain: 0.5, vary: 0 });
}

/**
 * Хоровой акцент финала: вдох гонга, хор и тот же хор октавой ниже.
 * Раз на всю игру — пробуждение Хозяина подземелья или последний удар;
 * идёт мимо бюджета мелодий, но занимает его, как `bigMoment`.
 */
export function finaleChoir(): void {
  if (ctx) lastPhrase = ctx.currentTime;
  duck(4, 0.25);
  play('choir', { gain: 0.72, vary: 0 });
}

/** Рёв крупного зверя — босс не из крыс (змей, гидра, колосс). `big` — ниже. */
export function beastRoar(big = true): void {
  play('beast', { gain: big ? 0.8 : 0.58, rate: big ? 0.9 : 1.08, vary: 0.05 });
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
  play('bat.squeak', { gain: caught ? 0.5 : 0.32, rate: caught ? 1.1 : 1, vary: 0.06 });
  if (caught) play('crit.thud', { gain: 0.35, at: 0.02 });
}

/** Блестяшка подобрана: звон стекла, выше с каждой подряд. */
export function shinyPick(k = 0): void {
  // «shiny» почти целиком в резкой середине — тише и на тон ниже.
  play('shiny', { gain: 0.28, rate: 0.85 * Math.pow(2, Math.min(k, 12) / 24), vary: 0 });
}

/** Карты: сдать на стол, открыть, перетасовать, раскрыть веером. */
export function cardDeal(at = 0): void {
  play('card.deal', { gain: 0.55, at });
}
// ---- Сундук (v2.71) ---------------------------------------------------------

/** Сундук сел на пол: глухой деревянный удар. */
export function chestLand(): void {
  play('crate', { gain: 0.42, rate: 0.78, vary: 0.04 });
  softThud(0.3);
}

/** Сундук вздрогнул — вырастет или нет. */
export function chestShake(): void {
  play('crit.thud', { gain: 0.2, rate: 0.9, vary: 0.06 });
}

/** Ключ повернулся в замке. */
export function chestLatch(): void {
  play('latch', { gain: 0.5, rate: 1.1 });
}

/** Тёмный сундук вылетел: свист полёта. */
export function chestFly(): void {
  play('dash', { gain: 0.34, rate: 0.85 });
}

/**
 * Тёмный сундук превращается в выпавший (v2.71.1): звон выше с каждым
 * ярусом, у эпического — фраза, у легендарного — большой аккорд.
 */
export function chestReveal(step: number): void {
  play('gem.burst', { gain: 0.3, rate: Math.pow(2, (step * 3) / 12), vary: 0.01 });
  softChime(3 + step * 2);
  if (step >= 3) bigMoment(0.7);
  else if (step >= 2) softPhrase(0.5, 0.1);
}

/** Крышка открылась: защёлка и скрип дерева. */
export function chestOpen(): void {
  play('latch', { gain: 0.38, rate: 0.82 });
  play('crate', { gain: 0.24, rate: 1.25, at: 0.05 });
  softChime(4);
}

// ---- Питомцы (v2.72) ---------------------------------------------------------

/** Яйцо качнулось в гнезде: мягкий стук скорлупы. */
export function eggWobble(k = 0): void {
  play('crit.thud', { gain: 0.14 + 0.03 * k, rate: 1.3 + 0.05 * k, vary: 0.05 });
}

/** По яйцу пошла трещина: сухой щелчок, выше с каждой. */
export function eggCrack(step: number): void {
  play('crate', { gain: 0.2, rate: 1.7 + 0.18 * step, vary: 0.03 });
}

/**
 * Вылупился: звон по редкости, у эпического — фраза, у легендарного и
 * мифического — большой аккорд (как сундук, тот же язык редкости).
 */
export function eggHatch(rarity: number): void {
  const step = rarity >= 4 ? 3 : rarity >= 3 ? 2 : rarity >= 2 ? 1 : 0;
  play('gem.burst', { gain: 0.3, rate: Math.pow(2, (step * 3) / 12), vary: 0.01 });
  softChime(4 + step * 2);
  if (step >= 3) bigMoment(0.7);
  else if (step >= 2) softPhrase(0.5, 0.1);
}

/** Погладили питомца: тихий высокий «дзынь». */
export function petPat(): void {
  softChime(9);
}

/** Трюк питомца в шахте: частое событие — только стекло, без мелодии. */
export function petTrick(): void {
  play('gem.chime', { gain: 0.18, rate: 1.5, vary: 0.04 });
}

/** Золотой или радужный: удар и фраза. */
export function petMerge(): void {
  play('gem.burst', { gain: 0.32, rate: 1.2 });
  if (!softPhrase(0.55, 0.08)) softChime(8);
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
  jingle(step >= 3 ? 'jingle.win' : step >= 2 ? 'jingle.up' : 'jingle.go', 1, { gain: 0.65 });
  play('chips.stack', { gain: 0.28, at: 0.08 });
}
export function riskLose(): void {
  jingle('jingle.down', 1.2, { gain: 0.7 });
}
export function riskDraw(): void {
  softThud(0.35);
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
  play('snap', { gain: 0.45 });
}

/** Вытащил: плеск и звон, редкая — пассаж. `beats` — как у сундука. */
export function fishLanded(beats: number): void {
  play('splash', { gain: 0.45, rate: 1.2 });
  if (beats >= 2 && jingle('jingle.win', 1.2, { gain: 0.6, at: 0.1 })) return;
  if (beats >= 1) softChime(beats >= 2 ? 7 : 4);
}
