// Прогрессия слотов: ежедневная лесенка, уровни, миссии и колесо.
// Всё, что заставляет вернуться завтра, живёт здесь — чистыми функциями без
// DOM и без стора, поэтому правила проверяемы тестами.
//
// Что взято из казино: причины возвращаться (серия дней, цели на день, уровни,
// бесплатные вращения по таймеру). Чего нет и не будет: подкрученных «почти
// выигрышей» и проигрышей, замаскированных под победу. Результат спина
// считает честный ГСЧ в lib/slots, и ничто отсюда на него не влияет —
// прогресс только начисляет монеты сверху.

import type { SlotSymbolId } from '@/types';
import type { Skin } from './skins';
import { STREAK_TIERS } from './prison';

// ---------------------------------------------------------------------------
// Ежедневная лесенка: чем дольше серия, тем крупнее награда. Пропустил день —
// серия начинается сначала, но забрать бонус можно всегда.
// ---------------------------------------------------------------------------

export const DAILY_LADDER = [500, 800, 1200, 1800, 2600, 4000, 7000];

/** Дата в виде YYYY-MM-DD по местному времени игрока. */
export function dayKey(at: number | Date = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Разница в календарных днях между двумя ключами дат. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export interface DailyState {
  /** Сколько дней подряд забирали бонус (растёт без предела). */
  streak: number;
  /** День последнего получения, YYYY-MM-DD. */
  lastClaim?: string;
}

export interface DailyStatus {
  /** Можно ли забрать сегодня. */
  ready: boolean;
  /** Какой день серии будет засчитан при получении. */
  nextStreak: number;
  /** Сколько монет дадут. */
  reward: number;
  /** Серия оборвалась: вчера не заходили. */
  broken: boolean;
  /** Ступень 1…7 внутри недельной лесенки. */
  step: number;
}

export function dailyStatus(state: DailyState, today = dayKey()): DailyStatus {
  const last = state.lastClaim;
  const streak = Math.max(0, Math.round(state.streak || 0));
  if (last === today) {
    return {
      ready: false,
      nextStreak: streak,
      reward: ladderReward(streak),
      broken: false,
      step: ladderStep(streak),
    };
  }
  const continues = !!last && daysBetween(last, today) === 1;
  const nextStreak = continues ? streak + 1 : 1;
  return {
    ready: true,
    nextStreak,
    reward: ladderReward(nextStreak),
    broken: !continues && !!last && streak > 1,
    step: ladderStep(nextStreak),
  };
}

/** Ступень недельной лесенки (1…7) для серии длиной `streak`. */
export function ladderStep(streak: number): number {
  if (streak < 1) return 1;
  return ((streak - 1) % DAILY_LADDER.length) + 1;
}

/** Награда за день серии. После седьмого дня лесенка идёт по кругу. */
export function ladderReward(streak: number): number {
  return DAILY_LADDER[ladderStep(streak) - 1];
}

// ---------------------------------------------------------------------------
// Уровни: опыт капает за каждый спин, ранние уровни берутся быстро — иначе
// игрок не почувствует движения и бросит на второй минуте.
// ---------------------------------------------------------------------------

/** Сколько опыта нужно, чтобы уйти с уровня `level` на следующий. */
export function xpForLevel(level: number): number {
  return 60 + Math.round(45 * Math.pow(level, 1.35));
}

export interface LevelInfo {
  level: number;
  /** Опыт, набранный внутри текущего уровня. */
  into: number;
  /** Сколько нужно для следующего. */
  need: number;
}

export const MAX_LEVEL = 200;

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.round(xp || 0));
  for (;;) {
    const need = xpForLevel(level);
    if (rest < need || level >= MAX_LEVEL) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/** Опыт за один спин: базовый + за выигрыш, чтобы удача тоже двигала прогресс. */
export function xpForSpin(payout: number, bet: number, kind: string): number {
  let xp = 3;
  if (payout > 0) xp += 2;
  if (kind === 'big') xp += 12;
  if (kind === 'jackpot') xp += 120;
  // Крупная ставка — чуть больше опыта, но без перекоса (максимум ×2).
  return Math.round(xp * Math.min(2, 1 + bet / 500));
}

export interface LevelReward {
  coins: number;
  freeSpins: number;
  /** Скин, который открывается именно на этом уровне (если есть). */
  skin?: string;
}

/**
 * Что даёт новый уровень. С v2.66 — только скин на своём уровне: денег из
 * ничего нет (владелец: «ежедневные награды и колесо убираем полностью»),
 * монеты зарабатываются работой в Каторге.
 */
export function levelReward(level: number): LevelReward {
  const skin = Object.keys(SKIN_UNLOCK).find((id) => SKIN_UNLOCK[id] === level);
  return { coins: 0, freeSpins: 0, skin };
}

// ---------------------------------------------------------------------------
// Ежедневные миссии: три цели в день, одинаковые на любом устройстве —
// генерируются детерминированно от даты, поэтому их не нужно хранить.
// Две цели — автоматы, третья — «Каторга»: деньги в зале общие, и задания
// дня тоже общие, поэтому шахта не живёт отдельной игрой.
// ---------------------------------------------------------------------------

export type MissionKind =
  | 'spins'
  | 'wins'
  | 'triple'
  | 'coins'
  | 'bigbet'
  | 'blocks'
  | 'streak'
  | 'ore'
  | 'trees';

export interface Mission {
  id: string;
  kind: MissionKind;
  goal: number;
  reward: number;
  title: string;
}

export type MissionCounters = Record<MissionKind, number>;

export const EMPTY_COUNTERS: MissionCounters = {
  spins: 0,
  wins: 0,
  triple: 0,
  coins: 0,
  bigbet: 0,
  blocks: 0,
  streak: 0,
  ore: 0,
  trees: 0,
};

/** Ставка, с которой спин считается «крупным» для миссии bigbet. */
export const BIG_BET = 100;

interface MissionDef {
  kind: MissionKind;
  goals: number[];
  reward: (g: number) => number;
  title: (g: number) => string;
}

const MISSION_POOL: MissionDef[] = [
  {
    kind: 'spins',
    goals: [20, 30, 50],
    reward: (g) => g * 12,
    title: (g) => `Сделать ${g} вращений`,
  },
  {
    kind: 'wins',
    goals: [5, 8, 12],
    reward: (g) => g * 45,
    title: (g) => `Выиграть ${g} раз`,
  },
  {
    kind: 'triple',
    goals: [1, 2, 3],
    reward: (g) => g * 400,
    title: (g) => (g === 1 ? 'Собрать три в ряд' : `Собрать три в ряд ${g} раза`),
  },
  {
    kind: 'coins',
    goals: [500, 1000, 2000],
    reward: (g) => Math.round(g * 0.6),
    title: (g) => `Выиграть ${g.toLocaleString('ru-RU')} монет за день`,
  },
  {
    kind: 'bigbet',
    goals: [5, 10, 15],
    reward: (g) => g * 60,
    title: (g) => `${g} вращений со ставкой от ${BIG_BET}`,
  },
];

/** Задания шахты: одно в день. `streak` — номер ступени запала (2 — «Раж»). */
const PRISON_POOL: MissionDef[] = [
  {
    kind: 'blocks',
    goals: [200, 400, 700],
    reward: (g) => Math.round(g * 1.5),
    title: (g) => `Сломать ${g} блоков в «Каторге»`,
  },
  {
    kind: 'streak',
    goals: [2, 3, 4],
    reward: (g) => [0, 150, 300, 600, 1200][g],
    title: (g) => `Набрать серию до «${STREAK_TIERS[g - 1].name}»`,
  },
  {
    kind: 'ore',
    goals: [500, 1500, 4000],
    reward: (g) => Math.round(g * 0.3),
    title: (g) => `Продать добычи на ${g.toLocaleString('ru-RU')} монет`,
  },
  {
    kind: 'trees',
    goals: [10, 20, 40],
    reward: (g) => g * 25,
    title: (g) => `Повалить ${g} деревьев в лесу`,
  },
];

/** Простой детерминированный хеш строки — из даты получаем «случайный» набор. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `n` определений из пула, перемешанных хешем даты. */
function pickFor(today: string, pool: MissionDef[], n: number, salt = ''): MissionDef[] {
  return pool
    .map((m, i) => ({ m, k: hash(`${today}#${salt}${i}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map(({ m }) => m);
}

/** Три миссии на календарный день: две в автоматах, одна в шахте. */
export function dailyMissions(today = dayKey()): Mission[] {
  const picked = [...pickFor(today, MISSION_POOL, 2), ...pickFor(today, PRISON_POOL, 1, 'p')];
  return picked.map((m) => {
    const goal = m.goals[hash(`${today}/${m.kind}`) % m.goals.length];
    return {
      id: `${today}:${m.kind}`,
      kind: m.kind,
      goal,
      reward: m.reward(goal),
      title: m.title(goal),
    };
  });
}

/** Выполнена ли миссия по текущим счётчикам дня. */
export function missionDone(mission: Mission, counters: MissionCounters): boolean {
  return (counters[mission.kind] ?? 0) >= mission.goal;
}

// ---------------------------------------------------------------------------
// Колесо удачи: бесплатный спин раз в несколько часов — повод заглянуть днём.
// ---------------------------------------------------------------------------

export const WHEEL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export interface WheelSector {
  label: string;
  coins: number;
  freeSpins: number;
  weight: number;
}

export const WHEEL: WheelSector[] = [
  { label: '100', coins: 100, freeSpins: 0, weight: 26 },
  { label: '250', coins: 250, freeSpins: 0, weight: 22 },
  { label: '500', coins: 500, freeSpins: 0, weight: 16 },
  { label: '5 вращений', coins: 0, freeSpins: 5, weight: 14 },
  { label: '1 000', coins: 1000, freeSpins: 0, weight: 10 },
  { label: '10 вращений', coins: 0, freeSpins: 10, weight: 7 },
  { label: '2 500', coins: 2500, freeSpins: 0, weight: 4 },
  { label: '5 000', coins: 5000, freeSpins: 0, weight: 1 },
];

/**
 * Выбор сектора по весам. Колесо честное: страница крутит картинку ровно к
 * тому сектору, который вернула эта функция, и никогда не «доворачивает».
 */
export function spinWheel(rng: () => number = Math.random): number {
  const total = WHEEL.reduce((sum, s) => sum + s.weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < WHEEL.length; i++) {
    roll -= WHEEL[i].weight;
    if (roll < 0) return i;
  }
  return WHEEL.length - 1;
}

/** Средняя ценность колеса — тест следит, чтобы оно не стало банкоматом. */
export function wheelAverage(): number {
  const total = WHEEL.reduce((sum, s) => sum + s.weight, 0);
  return WHEEL.reduce((sum, s) => sum + (s.coins * s.weight) / total, 0);
}

// ---------------------------------------------------------------------------
// Скины, которые открываются уровнем: новая тема — лучшая награда за прогресс.
// ---------------------------------------------------------------------------

export const SKIN_UNLOCK: Record<string, number> = {
  classic: 1,
  asia: 1,
  space: 1,
  pirate: 1,
  egypt: 1,
  candy: 1,
  neon: 5,
  winter: 9,
  olympus: 12,
  pumpkin: 1,
  abyss: 1,
  // Флагман: самый высокий уровневый порог в проекте.
  kupala: 15,
  // «Реликвию» уровень не открывает вовсе — см. isSkinAvailable.
  relic: 1,
};

export function isSkinUnlocked(skin: string, level: number): boolean {
  return level >= (SKIN_UNLOCK[skin] ?? 1);
}

/**
 * Можно ли выбрать скин прямо сейчас.
 *
 * Обычные открывает уровень — то есть время за игрой. «Реликвию» уровень не
 * открывает никогда: её условие — один крупный спин. Разница принципиальная:
 * уровень набивается усидчивостью, а `topX` нужно ВЗЯТЬ. Только поэтому
 * скин и может что-то значить.
 *
 * `topX` — лучший множитель за всё время (в ставках, не в монетах): в
 * монетах «лучший спин» зависит от ставки и не говорит ни о чём.
 *
 * `granted` — владелец автомата. Заработанные скины он получает без условия:
 * это его витрина, и она должна быть ему доступна. Условие при этом НЕ
 * трогаем — порог остаётся прежним для всех остальных. Разница важная:
 * опустить порог значит обесценить скин навсегда, а выдать владельцу — это
 * ровно один аккаунт, и он же его и заказывал. Флаг приходит с сервера
 * (`/api/backup/status`, сверка id из подписанного `initData` с админом),
 * так что подделать его из приложения нельзя.
 */
export function isSkinAvailable(skin: Skin, level: number, topX: number, granted = false): boolean {
  if (skin.earn) return granted || topX >= skin.earn.topX;
  return isSkinUnlocked(skin.id, level);
}

/** Символ-«награда» для превью в списке — чтобы было видно, за что бороться. */
export const REWARD_PREVIEW: SlotSymbolId = 'seven';
