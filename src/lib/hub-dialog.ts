// Жители площади (v2.80): что говорит каждый и что открывает. Как у
// жителей присон-серверов и в MMORPG: подошёл — житель по делу рассказывает,
// что у тебя сейчас с его ремеслом, и предлагает то же меню, что раньше
// висело кнопкой во дворе. Реплики на «ты», короткие, без жаргона: владелец
// — целевой игрок, «норма» и «откуп» ему ничего не говорят.
//
// Модуль чистый: состояние игры сворачивается в `HubFacts` (`hubFacts`), а
// реплики, кнопки и «!» — функции от него. Так их можно проверить тестом, а
// страница не считает одно и то же в двух местах.

import type { CampTab } from '@/components/PrisonCamp';
import { MAGE_LINES, SHELF_MAX } from './books';
import { bossReadyAt, dungeonOpen, DUNGEON_UNLOCK_RANK } from './dungeon';
import type { DungeonState } from './dungeon';
import {
  booksReady,
  forgeReadyNow,
  LAST_RANK,
  milesReady,
  nextPick,
  perkPointsFree,
  PICKS,
  pickOpen,
  rankLetter,
  rankNeeds,
  ROCKS,
  runesIdle,
  shortMoney,
  zoneLeft,
  zoneMineId,
  ZONE_TIERS,
  zoneTier,
} from './prison';
import type { PrisonState } from './prison';
import { RUNE_BAG } from './prison';
import { EGG_BASKET, eggCount } from './pets';
import { BUNK_BIG_PRICE, bunkSize, bunkUsed } from './inventory';
import type { BunkState } from './inventory';
import { barygaBought, barygaLots, barygaWindow, BARYGA_MS } from './yard';

/** Что открывает кнопка разговора. */
export type HubAction =
  | { kind: 'forge' }
  | { kind: 'camp'; tabs: CampTab[]; title: string }
  | { kind: 'baryga' }
  | { kind: 'zone' }
  | { kind: 'route'; path: string }
  /** Личный сундук у койки (v2.81). */
  | { kind: 'bunk' }
  /** Инвентарь — всё добро одним экраном (v2.81). */
  | { kind: 'inventory' };

export interface HubOption {
  label: string;
  action: HubAction;
}

/** Всё, о чём могут заговорить жители, — одним снимком. */
export interface HubFacts {
  now: number;
  rank: number;
  prestige: number;
  coins: number;
  tokens: number;
  keys: number;
  forgeReady: boolean;
  /** Следующая кирка: имя; null — лучше уже не скуёшь. */
  nextPick: string | null;
  /** С какого этажа её можно ковать; null — уже можно (или престижная). */
  nextPickFloor: string | null;
  booksReady: boolean;
  runesIdle: boolean;
  eggReady: boolean;
  nests: number;
  hotLot: boolean;
  barygaNextMs: number;
  perksFree: number;
  miles: number;
  /** Чего не хватает до следующего ранга; null — последний ранг. */
  rank2: {
    letter: string;
    coins: number;
    work: number;
    blocks: number;
    blockName: string;
    power: number;
    ready: boolean;
  } | null;
  dungeonOpen: boolean;
  dungeonRun: boolean;
  kingInMs: number;
  zoneOpen: boolean;
  zoneOn: boolean;
  zoneMs: number;
  zoneRock: string;
  /** Хранилища, упёршиеся в край: следующая вещь разобьётся (v2.81). */
  eggsFull: boolean;
  shelfFull: boolean;
  runesFull: boolean;
  /** Сундук у койки: занято, всего, двойной ли. */
  bunkUsed: number;
  bunkSize: number;
  bunkBig: boolean;
}

export function hubFacts(
  p: PrisonState,
  d: Pick<DungeonState, 'run' | 'bosses'>,
  coins: number,
  now = Date.now(),
  bunk: Pick<BunkState, 'big' | 'slots'> = { big: false, slots: [] },
): HubFacts {
  const w = barygaWindow(now);
  const lots = barygaLots(w, p);
  const bought = barygaBought(p, w);
  const np = nextPick(p);
  let rank2: HubFacts['rank2'] = null;
  if (p.rank < LAST_RANK) {
    const need = rankNeeds(p);
    const r = {
      letter: rankLetter(p.rank + 1),
      coins: Math.max(0, need.coins - coins),
      work: Math.max(0, need.workNeed - need.work),
      blocks: Math.max(0, need.blocksNeed - need.blocks),
      blockName: ROCKS[p.rank]?.blockName ?? 'блок этажа',
      power: need.pickOk ? 0 : need.power,
      ready: false,
    };
    r.ready = r.coins === 0 && r.work === 0 && r.blocks === 0 && r.power === 0;
    rank2 = r;
  }
  return {
    now,
    rank: p.rank,
    prestige: p.prestige,
    coins,
    tokens: p.tokens,
    keys: p.keys,
    forgeReady: forgeReadyNow(p, coins),
    nextPick: np >= 0 ? PICKS[np].name : null,
    nextPickFloor:
      np >= 0 && !pickOpen(np, p.rank, p.prestige) && !PICKS[np].prestige
        ? rankLetter(PICKS[np].floor)
        : null,
    booksReady: booksReady(p),
    runesIdle: runesIdle(p),
    eggReady: p.nest.some((x) => x.left <= 0),
    nests: p.nest.length,
    hotLot: lots.some((l, i) => l.hot && (bought[i] ?? 0) < l.stock),
    barygaNextMs: (w + 1) * BARYGA_MS - now,
    perksFree: perkPointsFree(p),
    miles: milesReady(p),
    rank2,
    dungeonOpen: dungeonOpen(p),
    dungeonRun: !!d.run,
    kingInMs: Math.max(0, bossReadyAt(d as DungeonState, 'king') - now),
    zoneOpen: zoneTier(p.prestige) > 0,
    zoneOn: p.zone.on,
    zoneMs: zoneLeft(p.zone, now),
    zoneRock: ROCKS[zoneMineId(p.prestige)]?.name ?? '',
    eggsFull: eggCount(p.eggs) >= EGG_BASKET,
    shelfFull: p.books.length >= SHELF_MAX,
    runesFull: p.runes.length >= RUNE_BAG,
    bunkUsed: bunkUsed(bunk as BunkState),
    bunkSize: bunkSize(bunk),
    bunkBig: bunk.big,
  };
}

// ---------------------------------------------------------------------------
// Жители.
// ---------------------------------------------------------------------------

export interface Resident {
  id: string;
  name: string;
  /** Лист персонажа и портрета (`chars/`, `faces/`). */
  sheet: string;
  lines(f: HubFacts): string[];
  options(f: HubFacts): HubOption[];
  /** «!» над головой: у жителя сейчас есть для тебя дело. */
  badge(f: HubFacts): boolean;
}

const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
const hoursMins = (ms: number) => {
  const m = mins(ms);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
};
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

/** Две реплики из общего запаса — разные в разные минуты, но не мигают на глазах. */
function pick2(pool: string[], now: number): string[] {
  if (pool.length <= 2) return pool;
  const k = Math.floor(now / 60_000) % pool.length;
  return [pool[k], pool[(k + 1) % pool.length]];
}

const camp = (tabs: CampTab[], title: string): HubAction => ({ kind: 'camp', tabs, title });

/** Присказки дневального — по одной, разные в разные минуты. */
const ORDERLY_LINES = [
  'Сапоги у порога, не на койку.',
  'Печку не трогай — я топлю.',
  'Отбой в десять. Кто храпит — тот дневалит.',
  'Чужой сундук не открывают. Свой — пожалуйста.',
  'Умывальник общий, мыло своё.',
];

export const RESIDENTS: Record<string, Resident> = {
  smith: {
    id: 'smith',
    name: 'Кузнец',
    sheet: 'smith',
    lines: (f) => [
      f.forgeReady
        ? 'Руды хватает. Давай молот — выкую!'
        : !f.nextPick
          ? 'Лучше этой кирки я не скую. Береги её.'
          : f.nextPickFloor
            ? `Следующая — ${f.nextPick.toLowerCase()} кирка. Скую, когда дойдёшь до этажа ${f.nextPickFloor}.`
            : `Следующая — ${f.nextPick.toLowerCase()} кирка. Неси руду, ящик у наковальни.`,
      'Кирка берёт руду своего этажа и следующего.',
      'Руду для кирки не продавай — сама ляжет в ящик.',
    ],
    options: () => [{ label: 'Кузница', action: { kind: 'forge' } }],
    badge: (f) => f.forgeReady,
  },
  mage: {
    id: 'mage',
    name: 'Чародей',
    sheet: 'mage',
    lines: (f) => [
      f.booksReady
        ? 'На полке есть книга, что ляжет в кирку. Не тяни.'
        : f.runesIdle
          ? 'В обереге пустое гнездо — вставь руну.'
          : f.tokens < 140
            ? 'Приходи с токенами — они падают с блоков.'
            : 'Книга ждёт тебя. Какая — узнаешь, когда купишь.',
      ...pick2(MAGE_LINES, f.now),
    ],
    options: () => [
      { label: 'Книги', action: camp(['enchant'], 'Книги') },
      { label: 'Руны', action: camp(['runes'], 'Руны') },
    ],
    badge: (f) => f.booksReady || f.runesIdle,
  },
  foreman: {
    id: 'foreman',
    name: 'Бригадир',
    sheet: 'foreman',
    lines: (f) => {
      const r = f.rank2;
      if (!r) return ['Ты дошёл до самого дна. Дальше — престиж.', 'Клеть внизу — спускайся.'];
      if (r.ready) return [`Всё готово — бери ранг ${r.letter}!`, 'Клеть внизу — спускайся.'];
      const out: string[] = [];
      if (r.power) out.push(`Кирка слабовата: нужна сила ⛏${r.power}. Сходи к кузнецу.`);
      if (r.coins) out.push(`До ранга ${r.letter} не хватает ${shortMoney(r.coins)} монет.`);
      if (r.work)
        out.push(
          `Сломай ещё ${shortMoney(r.work)} ${plural(r.work, 'блок', 'блока', 'блоков')} — это выработка.`,
        );
      if (r.blocks)
        out.push(
          `Нужно ещё ${r.blocks} ${plural(r.blocks, 'блок', 'блока', 'блоков')} этажа: ${r.blockName}.`,
        );
      return out.slice(0, 4);
    },
    options: () => [{ label: 'В шахту', action: { kind: 'route', path: '/prison' } }],
    badge: (f) => !!f.rank2?.ready,
  },
  guard: {
    id: 'guard',
    name: 'Охранник',
    sheet: 'guard',
    lines: (f) =>
      !f.zoneOpen
        ? [
            `Сюда пускают после ${ZONE_TIERS[0]}-го престижа.`,
            'Там порода, которой в шахте нет. Платит токенами.',
          ]
        : f.zoneOn
          ? [`Ты там уже работаешь. Осталось ${mins(f.zoneMs)} мин.`]
          : f.zoneMs <= 0
            ? ['На сегодня твоё время вышло. Приходи завтра.', 'Время идёт только за работой.']
            : [
                `У тебя ${mins(f.zoneMs)} мин в особой шахте.`,
                `Там ${f.zoneRock.toLowerCase()}. Токены идут щедро.`,
                'Время идёт только, пока копаешь.',
              ],
    options: (f) =>
      f.zoneOpen && (f.zoneOn || f.zoneMs > 0)
        ? [{ label: 'В особую шахту', action: { kind: 'zone' } }]
        : [],
    badge: (f) => f.zoneOpen && f.zoneMs > 0 && !f.zoneOn,
  },
  liftman: {
    id: 'liftman',
    name: 'Лифтёр',
    sheet: 'liftman',
    lines: (f) =>
      !f.dungeonOpen
        ? [
            `Лифт не для новичков. Приходи с ранга ${rankLetter(DUNGEON_UNLOCK_RANK)}.`,
            'Внизу крысы. Злые.',
          ]
        : f.dungeonRun
          ? ['Ты оставил внизу рюкзак — он ждёт.', 'Спускайся, пока крысы не растащили.']
          : f.kingInMs > 0
            ? [
                `Крысиный король спит. Проснётся через ${mins(f.kingInMs)} мин.`,
                'Добычу выносят только лифтом.',
              ]
            : ['Крысиный король в логове. Точи клинок.', 'Добычу выносят только лифтом.'],
    options: (f) =>
      f.dungeonOpen ? [{ label: 'Спуститься', action: { kind: 'route', path: '/dungeon' } }] : [],
    badge: (f) => f.dungeonRun,
  },
  keeper: {
    id: 'keeper',
    name: 'Смотрительница',
    sheet: 'keeper',
    lines: (f) => [
      f.eggReady
        ? 'Яйцо согрелось — пора вылуплять!'
        : f.nests === 0
          ? 'Гнёзда пустые. Купи яйцо — согреем.'
          : 'Яйца греются от твоей работы в шахте.',
      'Пять одинаковых питомцев — и один станет золотым.',
    ],
    options: () => [{ label: 'Питомник', action: camp(['pets'], 'Питомник') }],
    badge: (f) => f.eggReady,
  },
  clerk: {
    id: 'clerk',
    name: 'Каптёрщик',
    sheet: 'clerk',
    lines: (f) =>
      f.keys > 0
        ? [
            `У тебя ${f.keys} ${plural(f.keys, 'ключ', 'ключа', 'ключей')}. Открывай!`,
            'В сундуке бывают книги.',
          ]
        : ['Ключи падают в шахте. Приноси — открою сундук.', 'В сундуке бывают книги.'],
    options: () => [{ label: 'Сундуки', action: camp(['cases'], 'Сундуки') }],
    badge: (f) => f.keys > 0,
  },
  trader: {
    id: 'trader',
    name: 'Торговец',
    sheet: 'trader',
    lines: (f) => [
      f.hotLot ? 'Сегодня скидка — бери, пока лежит.' : 'Всё хорошее уже разобрали.',
      `Новый товар через ${hoursMins(f.barygaNextMs)}.`,
      'Беру только монеты.',
    ],
    options: () => [{ label: 'Товар', action: { kind: 'baryga' } }],
    badge: (f) => f.hotLot,
  },
  seller: {
    id: 'seller',
    name: 'Продавщица',
    sheet: 'seller',
    lines: () => ['Бомбы, энергетик, лупа — всё для шахты.', 'Чем глубже этаж, тем дороже товар.'],
    options: () => [{ label: 'Лавка', action: camp(['shop'], 'Лавка') }],
    badge: () => false,
  },
  chief: {
    id: 'chief',
    name: 'Начальник',
    sheet: 'chief',
    lines: (f) => {
      const out: string[] = [];
      if (f.miles > 0)
        out.push(
          `Есть ${f.miles} ${plural(f.miles, 'достижение', 'достижения', 'достижений')} — забери награду.`,
        );
      if (f.perksFree > 0) out.push(`Свободных очков навыков: ${f.perksFree}. Распредели.`);
      if (!out.length) out.push('Работай. Лагерь всё видит.');
      out.push('Находки из шахты — в коллекцию. Каждая прибавит к продаже.');
      return out;
    },
    options: () => [
      { label: 'Достижения', action: camp(['miles'], 'Достижения') },
      { label: 'Навыки', action: camp(['perks'], 'Навыки') },
      { label: 'Коллекция', action: camp(['finds'], 'Коллекция') },
    ],
    badge: (f) => f.miles > 0 || f.perksFree > 0,
  },
  // Дневальный Барака 1 (v2.81): стоит у тумбочки, стережёт койки. Дело у
  // него одно — чтобы добро не пропадало: корзина, полка или мешочек полны
  // — следующая вещь разобьётся, и он зовёт отложить лишнее в сундук.
  orderly: {
    id: 'orderly',
    name: 'Дневальный',
    sheet: 'orderly',
    lines: (f) => {
      const out: string[] = [];
      if (f.eggsFull) out.push('Корзина яиц полна — новое разобьётся. Отложи в сундук.');
      if (f.shelfFull) out.push('Полка книг забита. Лишние — в сундук, пока не рассыпались.');
      if (f.runesFull) out.push('Мешочек рун полон. Сундук под койкой — туда.');
      if (f.bunkUsed >= f.bunkSize)
        out.push(
          f.bunkBig
            ? 'Сундук набит под крышку. Разбери, что лишнее.'
            : `Сундук полон. Двойной — ${shortMoney(BUNK_BIG_PRICE)} монет, у меня.`,
        );
      if (!out.length)
        out.push(
          f.bunkUsed === 0
            ? 'Твоя койка — у двери. Сундук под ней, клади что хочешь.'
            : `В сундуке занято ${f.bunkUsed} из ${f.bunkSize}. Всё цело, я слежу.`,
        );
      out.push(pick2(ORDERLY_LINES, f.now)[0]);
      return out.slice(0, 3);
    },
    options: () => [
      { label: 'Мой сундук', action: { kind: 'bunk' } },
      { label: 'Инвентарь', action: { kind: 'inventory' } },
    ],
    badge: (f) => f.eggsFull || f.shelfFull || f.runesFull,
  },
  croupier: {
    id: 'croupier',
    name: 'Крупье',
    sheet: 'croupier',
    lines: (f) => [
      f.coins < 10 ? 'Без монет за стол не садятся.' : 'Ставки на те же монеты, что в шахте.',
      'В Каскаде сферы множат весь выигрыш.',
    ],
    options: () => [
      { label: 'Слоты', action: { kind: 'route', path: '/slots' } },
      { label: 'Каскад', action: { kind: 'route', path: '/scatter' } },
      { label: 'Весь зал', action: { kind: 'route', path: '/games' } },
    ],
    badge: () => false,
  },
};

/**
 * Житель по id. Незнакомый (карту нарисовали раньше, чем написали ему
 * реплики) не ломает площадь: говорит одно слово и ничего не открывает.
 */
export function residentOf(id: string, name = '', sheet = id): Resident {
  return (
    RESIDENTS[id] ?? {
      id,
      name: name || 'Житель',
      sheet,
      lines: () => ['…'],
      options: () => [],
      badge: () => false,
    }
  );
}
