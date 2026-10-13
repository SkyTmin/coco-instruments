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
import { fmtShort, hasKey, t } from '@/i18n/core';
import type { Key } from '@/i18n/core';
import { blockName, rockName } from '@/i18n/data';
import { nameIn, pickTitle } from '@/i18n/data-mine';
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
  /** Её номер в `PICKS` (имя на языке игры); −1 — лучше уже не скуёшь. */
  nextPickI: number;
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
    /** Номер породы блока в `ROCKS`. */
    blockI: number;
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
  /** Номер породы особой шахты в `ROCKS`. */
  zoneRockI: number;
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
      blockI: p.rank,
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
    nextPickI: np,
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
    zoneRockI: zoneMineId(p.prestige),
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
  return m >= 60 ? t('hub.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('hub.min', { n: m });
};

/** Две реплики из общего запаса — разные в разные минуты, но не мигают на глазах. */
function pick2<T>(pool: T[], now: number): T[] {
  if (pool.length <= 2) return pool;
  const k = Math.floor(now / 60_000) % pool.length;
  return [pool[k], pool[(k + 1) % pool.length]];
}

const camp = (tabs: CampTab[], title: string): HubAction => ({ kind: 'camp', tabs, title });

/** Присказки дневального — по одной, разные в разные минуты (`hub.orderly.say.<i>`). */
const ORDERLY_SAYS = [0, 1, 2, 3, 4];

/**
 * Присказка Чародея `i`: перевод — в каталоге книг (`books.mage.<i>`), пока
 * его нет — русская строка `MAGE_LINES`.
 */
const mageLine = (i: number) => {
  const key = `books.mage.${i}`;
  return hasKey(key) ? t(key) : MAGE_LINES[i];
};

export const RESIDENTS: Record<string, Resident> = {
  smith: {
    id: 'smith',
    name: 'Кузнец',
    sheet: 'smith',
    lines: (f) => [
      f.forgeReady
        ? t('hub.smith.ready')
        : f.nextPickI < 0
          ? t('hub.smith.best')
          : f.nextPickFloor
            ? t('hub.smith.nextFloor', {
                pick: nameIn(pickTitle(f.nextPickI)),
                floor: f.nextPickFloor,
              })
            : t('hub.smith.next', { pick: nameIn(pickTitle(f.nextPickI)) }),
      t('hub.smith.floors'),
      t('hub.smith.keep'),
    ],
    options: () => [{ label: t('hub.opt.forge'), action: { kind: 'forge' } }],
    badge: (f) => f.forgeReady,
  },
  mage: {
    id: 'mage',
    name: 'Чародей',
    sheet: 'mage',
    lines: (f) => [
      f.booksReady
        ? t('hub.mage.book')
        : f.runesIdle
          ? t('hub.mage.rune')
          : f.tokens < 140
            ? t('hub.mage.poor')
            : t('hub.mage.wait'),
      ...pick2(
        MAGE_LINES.map((_, i) => i),
        f.now,
      ).map(mageLine),
    ],
    options: () => [
      { label: t('hub.opt.books'), action: camp(['enchant'], t('hub.opt.books')) },
      { label: t('hub.opt.runes'), action: camp(['runes'], t('hub.opt.runes')) },
    ],
    badge: (f) => f.booksReady || f.runesIdle,
  },
  foreman: {
    id: 'foreman',
    name: 'Бригадир',
    sheet: 'foreman',
    lines: (f) => {
      const r = f.rank2;
      if (!r) return [t('hub.foreman.bottom'), t('hub.foreman.cage')];
      if (r.ready) return [t('hub.foreman.ready', { r: r.letter }), t('hub.foreman.cage')];
      const out: string[] = [];
      if (r.power) out.push(t('hub.foreman.power', { n: r.power }));
      if (r.coins)
        out.push(t('hub.foreman.coins', { n: r.coins, v: fmtShort(r.coins), r: r.letter }));
      if (r.work) out.push(t('hub.foreman.work', { n: r.work, v: fmtShort(r.work) }));
      if (r.blocks)
        out.push(
          t('hub.foreman.blocks', {
            n: r.blocks,
            block: ROCKS[r.blockI] ? blockName(r.blockI) : t('hub.floorBlock'),
          }),
        );
      return out.slice(0, 4);
    },
    options: () => [{ label: t('hub.opt.mine'), action: { kind: 'route', path: '/prison' } }],
    badge: (f) => !!f.rank2?.ready,
  },
  guard: {
    id: 'guard',
    name: 'Охранник',
    sheet: 'guard',
    lines: (f) =>
      !f.zoneOpen
        ? [t('hub.guard.closed', { n: ZONE_TIERS[0] }), t('hub.guard.rock')]
        : f.zoneOn
          ? [t('hub.guard.on', { n: mins(f.zoneMs) })]
          : f.zoneMs <= 0
            ? [t('hub.guard.over'), t('hub.guard.work')]
            : [
                t('hub.guard.have', { n: mins(f.zoneMs) }),
                t('hub.guard.there', { rock: nameIn(rockName(f.zoneRockI)) }),
                t('hub.guard.dig'),
              ],
    options: (f) =>
      f.zoneOpen && (f.zoneOn || f.zoneMs > 0)
        ? [{ label: t('hub.opt.zone'), action: { kind: 'zone' } }]
        : [],
    badge: (f) => f.zoneOpen && f.zoneMs > 0 && !f.zoneOn,
  },
  liftman: {
    id: 'liftman',
    name: 'Лифтёр',
    sheet: 'liftman',
    lines: (f) =>
      !f.dungeonOpen
        ? [t('hub.liftman.closed', { r: rankLetter(DUNGEON_UNLOCK_RANK) }), t('hub.liftman.rats')]
        : f.dungeonRun
          ? [t('hub.liftman.pack'), t('hub.liftman.hurry')]
          : f.kingInMs > 0
            ? [t('hub.liftman.sleeps', { n: mins(f.kingInMs) }), t('hub.liftman.loot')]
            : [t('hub.liftman.awake'), t('hub.liftman.loot')],
    options: (f) =>
      f.dungeonOpen
        ? [{ label: t('hub.opt.down'), action: { kind: 'route', path: '/dungeon' } }]
        : [],
    badge: (f) => f.dungeonRun,
  },
  keeper: {
    id: 'keeper',
    name: 'Смотрительница',
    sheet: 'keeper',
    lines: (f) => [
      f.eggReady
        ? t('hub.keeper.ready')
        : f.nests === 0
          ? t('hub.keeper.empty')
          : t('hub.keeper.warm'),
      t('hub.keeper.gold'),
    ],
    options: () => [{ label: t('hub.opt.pets'), action: camp(['pets'], t('hub.opt.pets')) }],
    badge: (f) => f.eggReady,
  },
  clerk: {
    id: 'clerk',
    name: 'Каптёрщик',
    sheet: 'clerk',
    lines: (f) =>
      f.keys > 0
        ? [t('hub.clerk.keys', { n: f.keys }), t('hub.clerk.books')]
        : [t('hub.clerk.none'), t('hub.clerk.books')],
    options: () => [{ label: t('hub.opt.cases'), action: camp(['cases'], t('hub.opt.cases')) }],
    badge: (f) => f.keys > 0,
  },
  trader: {
    id: 'trader',
    name: 'Торговец',
    sheet: 'trader',
    lines: (f) => [
      f.hotLot ? t('hub.trader.hot') : t('hub.trader.gone'),
      t('hub.trader.next', { t: hoursMins(f.barygaNextMs) }),
      t('hub.trader.coins'),
    ],
    options: () => [{ label: t('hub.opt.goods'), action: { kind: 'baryga' } }],
    badge: (f) => f.hotLot,
  },
  seller: {
    id: 'seller',
    name: 'Продавщица',
    sheet: 'seller',
    lines: () => [t('hub.seller.stock'), t('hub.seller.deep')],
    options: () => [{ label: t('hub.opt.shop'), action: camp(['shop'], t('hub.opt.shop')) }],
    badge: () => false,
  },
  chief: {
    id: 'chief',
    name: 'Начальник',
    sheet: 'chief',
    lines: (f) => {
      const out: string[] = [];
      if (f.miles > 0) out.push(t('hub.chief.miles', { n: f.miles }));
      if (f.perksFree > 0) out.push(t('hub.chief.perks', { n: f.perksFree }));
      if (!out.length) out.push(t('hub.chief.idle'));
      out.push(t('hub.chief.finds'));
      return out;
    },
    options: () => [
      { label: t('hub.opt.miles'), action: camp(['miles'], t('hub.opt.miles')) },
      { label: t('hub.opt.perks'), action: camp(['perks'], t('hub.opt.perks')) },
      { label: t('hub.opt.finds'), action: camp(['finds'], t('hub.opt.finds')) },
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
      if (f.eggsFull) out.push(t('hub.orderly.eggs'));
      if (f.shelfFull) out.push(t('hub.orderly.shelf'));
      if (f.runesFull) out.push(t('hub.orderly.runes'));
      if (f.bunkUsed >= f.bunkSize)
        out.push(
          f.bunkBig
            ? t('hub.orderly.stuffed')
            : t('hub.orderly.full', { v: fmtShort(BUNK_BIG_PRICE) }),
        );
      if (!out.length)
        out.push(
          f.bunkUsed === 0
            ? t('hub.orderly.empty')
            : t('hub.orderly.used', { n: f.bunkUsed, size: f.bunkSize }),
        );
      out.push(t(`hub.orderly.say.${pick2(ORDERLY_SAYS, f.now)[0]}` as Key));
      return out.slice(0, 3);
    },
    options: () => [
      { label: t('hub.opt.bunk'), action: { kind: 'bunk' } },
      { label: t('hub.opt.inventory'), action: { kind: 'inventory' } },
    ],
    badge: (f) => f.eggsFull || f.shelfFull || f.runesFull,
  },
  croupier: {
    id: 'croupier',
    name: 'Крупье',
    sheet: 'croupier',
    lines: (f) => [
      f.coins < 10 ? t('hub.croupier.broke') : t('hub.croupier.same'),
      t('hub.croupier.orbs'),
    ],
    options: () => [
      { label: t('hub.opt.slots'), action: { kind: 'route', path: '/slots' } },
      { label: t('hub.opt.cascade'), action: { kind: 'route', path: '/scatter' } },
      { label: t('hub.opt.hall'), action: { kind: 'route', path: '/games' } },
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
