// «Заход» — один присест за играми, от первого вращения до того, как игрок
// ушёл. Нужен ровно для одной вещи: чтобы у захода был КОНЕЦ.
//
// Почему это вообще важно. Канеман и Фредриксон показали, что впечатление от
// эпизода — это примерно среднее между самым ярким моментом и последним, а
// длительность почти не учитывается («duration neglect»). То есть пятьдесят
// ровных вращений и одна реликвия запомнятся как реликвия — но только если
// заход на ней и закончится, а не утечёт в десять обычных спинов и закрытое
// приложение.
//
// Поэтому здесь две задачи: найти ПИК захода и дать поводу закончиться.
// Всё в этом файле — чистые функции, состояние живёт в сторе.

import { ORB_TIERS, orbRarity } from './orb-rarity';

/** Разрыв, после которого это уже новый заход, а не продолжение старого. */
export const SESSION_GAP_MS = 25 * 60_000;

/** Короче восьми вращений — это не заход, а «заглянул». Итог не показываем. */
export const MIN_SPINS = 8;

export type GameId = 'slots' | 'scatter';

/** Экраны, на которых заход считается продолжающимся. */
export const GAME_ROUTES = ['/slots', '/scatter', '/games'];

/** Заход давно не трогали — значит, он кончился. */
export function isStale(s: Session | null, now: number): boolean {
  return !!s && now - s.lastAt > SESSION_GAP_MS;
}

/** Что случилось за один спин — то, из чего собирается заход. */
export interface SpinRecord {
  game: GameId;
  at: number;
  /** Сколько списано со счёта: у бесплатного вращения ноль. */
  staked: number;
  won: number;
  /** Ставка, от которой считается множитель — даже если вращение бесплатное. */
  bet: number;
  /** Длина цепочки каскада (в «Слотах» тоже есть). */
  chain: number;
  /** Самая дорогая сфера этого спина; 0 — сфер не было. */
  orb: number;
  /** Этот спин запустил бонус. */
  bonus: boolean;
  /** Уровни, взятые этим спином. */
  levels: number[];
}

export interface Session {
  startedAt: number;
  lastAt: number;
  spins: number;
  staked: number;
  won: number;
  /** Лучший спин: монеты, множитель ставки и номер спина в заходе. */
  bestWin: number;
  bestMult: number;
  bestWinAt: number;
  bestChain: number;
  bestChainAt: number;
  bestOrb: number;
  bestOrbAt: number;
  /** Сколько раз залетел бонус и на каком спине впервые. */
  bonuses: number;
  bonusAt: number;
  /** Сколько уровней взято и какой последний. */
  levels: number;
  topLevel: number;
  levelAt: number;
  /** Сколько вращений пришлось на каждую игру — заход общий для обеих. */
  bySlots: number;
  byScatter: number;
}

export function emptySession(at: number): Session {
  return {
    startedAt: at,
    lastAt: at,
    spins: 0,
    staked: 0,
    won: 0,
    bestWin: 0,
    bestMult: 0,
    bestWinAt: 0,
    bestChain: 0,
    bestChainAt: 0,
    bestOrb: 0,
    bestOrbAt: 0,
    bonuses: 0,
    bonusAt: 0,
    levels: 0,
    topLevel: 0,
    levelAt: 0,
    bySlots: 0,
    byScatter: 0,
  };
}

/**
 * Записать спин. Если с прошлого прошло больше SESSION_GAP_MS, прежний заход
 * считается закрытым: он возвращается в `ended`, а спин открывает новый.
 * Решение о разрыве принимается здесь, чтобы стор не знал о правилах.
 */
export function advance(
  prev: Session | null,
  rec: SpinRecord,
): { session: Session; ended: Session | null } {
  let ended: Session | null = null;
  let s = prev;
  if (!s || rec.at - s.lastAt > SESSION_GAP_MS) {
    // Закрываем только то, что было настоящим заходом: одинокое вращение
    // получасовой давности архивировать незачем.
    if (s && s.spins >= MIN_SPINS) ended = s;
    s = emptySession(rec.at);
  }

  const n = s.spins + 1;
  const mult = rec.bet > 0 ? rec.won / rec.bet : 0;
  const next: Session = {
    ...s,
    lastAt: rec.at,
    spins: n,
    staked: s.staked + rec.staked,
    won: s.won + rec.won,
    bySlots: s.bySlots + (rec.game === 'slots' ? 1 : 0),
    byScatter: s.byScatter + (rec.game === 'scatter' ? 1 : 0),
  };
  if (rec.won > next.bestWin) {
    next.bestWin = rec.won;
    next.bestWinAt = n;
  }
  // Множитель ведём отдельно от монет: по мелкой ставке можно словить
  // огромный множитель, и запомнится именно он, а не сумма.
  if (mult > next.bestMult) next.bestMult = mult;
  if (rec.chain > next.bestChain) {
    next.bestChain = rec.chain;
    next.bestChainAt = n;
  }
  if (rec.orb > next.bestOrb) {
    next.bestOrb = rec.orb;
    next.bestOrbAt = n;
  }
  if (rec.bonus) {
    next.bonuses += 1;
    if (!next.bonusAt) next.bonusAt = n;
  }
  if (rec.levels.length) {
    next.levels += rec.levels.length;
    next.topLevel = Math.max(next.topLevel, ...rec.levels);
    next.levelAt = n;
  }
  return { session: next, ended };
}

// ---------------------------------------------------------------------------
// Пик
// ---------------------------------------------------------------------------

export type PeakKind = 'none' | 'win' | 'orb' | 'chain' | 'bonus' | 'level';

export interface Peak {
  kind: PeakKind;
  /** Насколько это было ярко, 0…100. Общая шкала для всех видов событий. */
  intensity: number;
  /** Крупная строка: сам факт. */
  title: string;
  /** Мелкая строка под ним: когда это случилось. */
  detail: string;
}

/**
 * Насколько ярок выигрыш — по множителю ставки, а не по монетам.
 * Ступени те же, по которым игра уже делит выигрыши на big и mega.
 */
export function winIntensity(mult: number): number {
  if (mult >= 50) return 100;
  if (mult >= 25) return 85;
  if (mult >= 10) return 65;
  if (mult >= 5) return 48;
  if (mult >= 2) return 25;
  if (mult > 0) return 8;
  return 0;
}

/** Яркость сферы — прямо по лестнице редкости. */
export function orbIntensity(value: number): number {
  if (value <= 0) return 0;
  const map: Record<string, number> = {
    common: 0,
    uncommon: 12,
    rare: 32,
    epic: 58,
    legendary: 82,
    mythic: 100,
  };
  return map[orbRarity(value)] ?? 0;
}

/** Яркость цепочки: каждое звено сверх первого прибавляет вес. */
export function chainIntensity(chain: number): number {
  if (chain < 2) return 0;
  return Math.min(95, (chain - 1) * 17);
}

const fmtNum = (n: number) => Math.round(n).toLocaleString('ru-RU');
/** Множитель: ×12 без хвоста, ×2,4 — с одним знаком. */
const fmtMult = (m: number) =>
  m >= 10 ? `×${Math.round(m)}` : `×${m.toFixed(1).replace('.', ',').replace(',0', '')}`;

function orbName(value: number): string {
  const id = orbRarity(value);
  return ORB_TIERS.find((t) => t.id === id)?.name ?? 'Сфера';
}

/**
 * Самый яркий момент захода. Кандидаты меряются одной шкалой, побеждает
 * сильнейший — так пик остаётся ОДИН. Две строки вместо списка достижений:
 * заход должен вспоминаться одним кадром, а не таблицей.
 */
export function sessionPeak(s: Session): Peak {
  const of = ` из ${s.spins}`;
  const candidates: Peak[] = [];

  if (s.bestWin > 0) {
    candidates.push({
      kind: 'win',
      intensity: winIntensity(s.bestMult),
      title: `${fmtMult(s.bestMult)} за один спин`,
      detail: `${fmtNum(s.bestWin)} монет на ${s.bestWinAt}-м спине${of}`,
    });
  }
  if (s.bestOrb > 0 && orbIntensity(s.bestOrb) > 0) {
    candidates.push({
      kind: 'orb',
      intensity: orbIntensity(s.bestOrb),
      title: `${orbName(s.bestOrb)} ×${s.bestOrb}`,
      detail: `на ${s.bestOrbAt}-м спине${of}`,
    });
  }
  if (s.bestChain >= 2) {
    candidates.push({
      kind: 'chain',
      intensity: chainIntensity(s.bestChain),
      title: `Цепочка из ${s.bestChain} звеньев`,
      detail: `на ${s.bestChainAt}-м спине${of}`,
    });
  }
  if (s.bonuses > 0) {
    candidates.push({
      kind: 'bonus',
      intensity: 60,
      title: s.bonuses > 1 ? `Бонус ${s.bonuses} раза` : 'Бонус',
      detail: `впервые на ${s.bonusAt}-м спине${of}`,
    });
  }
  if (s.levels > 0) {
    candidates.push({
      kind: 'level',
      intensity: 40,
      title: `${s.topLevel}-й уровень`,
      detail: s.levels > 1 ? `и ещё ${s.levels - 1} по дороге` : `на ${s.levelAt}-м спине${of}`,
    });
  }

  if (!candidates.length) {
    return { kind: 'none', intensity: 0, title: 'Ровный заход', detail: `${s.spins} вращений` };
  }
  // При равной яркости выигрыш обходит остальных: крупный множитель обычно и
  // есть следствие редкой сферы, так что он рассказывает ту же историю целиком.
  const order: PeakKind[] = ['win', 'orb', 'chain', 'bonus', 'level', 'none'];
  return candidates.sort(
    (a, b) => b.intensity - a.intensity || order.indexOf(a.kind) - order.indexOf(b.kind),
  )[0];
}

// ---------------------------------------------------------------------------
// Оценка захода
// ---------------------------------------------------------------------------

export type Grade = 'quiet' | 'ordinary' | 'good' | 'great' | 'unforgettable';

/** Название ступени — оно же заголовок карточки. */
export const GRADE_NAME: Record<Grade, string> = {
  quiet: 'Тихий заход',
  ordinary: 'Заход окончен',
  good: 'Удачный заход',
  great: 'Отличный заход',
  unforgettable: 'Такое не забывается',
};

export function sessionNet(s: Session): number {
  return s.won - s.staked;
}

/** Доход на вложенное: −1 — просадили всё, 0 — вышли в ноль. */
export function sessionRoi(s: Session): number {
  return s.staked > 0 ? (s.won - s.staked) / s.staked : 0;
}

export function sessionGrade(s: Session): Grade {
  const p = sessionPeak(s).intensity;
  if (p >= 85) return 'unforgettable';
  if (p >= 60) return 'great';
  if (p >= 32 || sessionNet(s) > 0) return 'good';
  if (s.spins >= 10) return 'ordinary';
  return 'quiet';
}

/**
 * Оценка захода одним числом — для сравнения с прошлыми.
 * Решает пик, итог только подправляет: заход с реликвией и минусом всё равно
 * помнится лучше, чем ровный плюс, в котором не случилось ничего.
 */
export function sessionScore(s: Session): number {
  return sessionPeak(s).intensity * 10 + Math.max(-100, Math.min(300, sessionRoi(s) * 100));
}

/**
 * Какое место заход занимает среди прошлых. `1` — лучший за всё время.
 * `history` — завершённые заходы, текущий в неё не входит.
 */
export function rankAmong(s: Session, history: Session[]): { rank: number; of: number } {
  const mine = sessionScore(s);
  const better = history.filter((h) => sessionScore(h) > mine).length;
  return { rank: better + 1, of: history.length + 1 };
}

/** Стоит ли вообще показывать итог. */
export function worthShowing(s: Session | null): s is Session {
  return !!s && s.spins >= MIN_SPINS;
}

/** Сколько длился заход, человеческими словами. */
export function sessionLength(s: Session): string {
  const mins = Math.round((s.lastAt - s.startedAt) / 60_000);
  if (mins < 1) return 'меньше минуты';
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
