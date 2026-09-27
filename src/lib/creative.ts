// Креатив владельца (v2.81). Владелец: «дай мне возможность включать режим
// креатива, чтобы я мог заходить куда захочу, покупать, открывать что захочу…
// Это нужно, чтобы я проверял всё без прохождения».
//
// Креатив — это ОТДЕЛЬНОЕ сохранение, а не правка настоящего. Пока он включён,
// все игровые ключи хранилища (слоты, каторга, лес, подземелье, рыбалка,
// сундук у койки) пишутся и читаются с приставкой `creative.`, а настоящие
// лежат нетронутыми. Выключил — стор перечитывает настоящие ключи, и всё,
// что было в песочнице, остаётся в песочнице. Так и только так: вариант
// «снимок настоящего в сторонку, потом вернуть» теряет прогресс, если
// снимок не дописался, а здесь настоящее сохранение просто никто не трогает.

import { AREAS, PLUS_SAFE, SACK_MAX, SETS, SLOTS } from './dungeon';
import type { DungeonState, Gear } from './dungeon';
import { FLOORS } from './dungeon-floors';
import { PICKS } from './economy';
import { BUNK_KEY } from './inventory';
import { EGG_BASKET, EGG_IDS } from './pets';
import { freshMine, LAST_RANK, minPickFor } from './prison';
import type { PrisonState } from './prison';
import { STORAGE_KEYS } from './storage';

/** Флаг креатива — свой ключ, он сам с приставкой не пишется. */
export const CREATIVE_KEY = 'creative.state';

export interface CreativeState {
  on: boolean;
  /** Бессмертие в подземелье: смертельный удар оставляет 1 здоровья. */
  god: boolean;
  /** Когда включён (для надписи). */
  since: number;
}

export const CREATIVE_OFF: CreativeState = { on: false, god: true, since: 0 };

export function normalizeCreative(raw: Partial<CreativeState> | null | undefined): CreativeState {
  return {
    on: raw?.on === true,
    god: raw?.god !== false,
    since: typeof raw?.since === 'number' ? raw.since : 0,
  };
}

const GAME_KEYS = new Set<string>([
  STORAGE_KEYS.slots,
  STORAGE_KEYS.prison,
  STORAGE_KEYS.forest,
  STORAGE_KEYS.dungeon,
  STORAGE_KEYS.fishing,
  BUNK_KEY,
]);

let active = false;

/** Идёт ли креатив прямо сейчас (читают записи стора). */
export const creativeActive = (): boolean => active;

export function setCreativeActive(v: boolean): void {
  active = v;
}

/** Ключ хранилища с учётом креатива: игровые — с приставкой, прочие — как есть. */
export function gameKey(key: string): string {
  return active && GAME_KEYS.has(key) ? `creative.${key}` : key;
}

/** Сколько кладёт песочница при входе. */
export const CREATIVE_COINS = 100_000_000;
export const CREATIVE_TOKENS = 10_000_000;
export const CREATIVE_KEYS = 999;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export interface PrisonPatch {
  rank?: number;
  prestige?: number;
  /** Кирка в руке (номер в `PICKS`). */
  pick?: number;
  /** Токены, ключи и яйца — до верха. */
  fill?: boolean;
}

/** Каторга песочницы: ранг, престиж, кирка, запасы. Правила игры не меняются. */
export function creativePrison(p: PrisonState, o: PrisonPatch): PrisonState {
  let q: PrisonState = { ...p };
  if (o.rank !== undefined) {
    const rank = clamp(o.rank, 0, LAST_RANK);
    if (rank !== p.rank || q.zone.on)
      // Новый ранг — свежая шахта его этажа, условия ранга с нуля. Спецзона
      // закрывается, как на настоящем ранге.
      q = {
        ...q,
        rank,
        mine: freshMine(rank),
        norm: {},
        oreBlocks: 0,
        pity: 0,
        zone: { ...q.zone, on: false },
      };
  }
  if (o.prestige !== undefined) q.prestige = clamp(o.prestige, 0, 30);
  // Лучшая выкованная не ниже той, что нужна этажу, — иначе поле встанет
  // стеной (так же чинит старые сохранения `normalizePrison`).
  const floorPick = minPickFor(q.rank);
  if (o.pick !== undefined) {
    const pick = clamp(o.pick, 0, PICKS.length - 1);
    q.pick = pick;
    q.pickMax = Math.max(pick, floorPick);
  } else {
    q.pickMax = Math.max(q.pickMax, floorPick);
    q.pick = Math.max(q.pick, Math.min(q.pickMax, floorPick));
  }
  if (o.fill) {
    const eggs = { ...q.eggs };
    const per = Math.floor(EGG_BASKET / EGG_IDS.length);
    for (const id of EGG_IDS) eggs[id] = Math.max(eggs[id] ?? 0, per);
    q = {
      ...q,
      tokens: Math.max(q.tokens, CREATIVE_TOKENS),
      keys: Math.max(q.keys, CREATIVE_KEYS),
      eggs,
    };
  }
  return q;
}

export interface DungeonPatch {
  /** Все этажи и все лифты открыты. */
  open?: boolean;
  /** Всё снаряжение — этой ступени и заточки. */
  tier?: number;
  plus?: number;
  /** Все боссы готовы к бою (без отдыха). */
  bosses?: boolean;
  /** Склад: каждого материала всех этажей по 99, рюкзак — самый большой. */
  stash?: boolean;
}

export function creativeDungeon(d: DungeonState, o: DungeonPatch): DungeonState {
  let q: DungeonState = { ...d };
  if (o.open)
    q = {
      ...q,
      intro: true,
      reached: Math.max(q.reached, FLOORS.length),
      lifts: [...new Set([...q.lifts, ...AREAS.map((a) => a.id)])],
    };
  if (o.tier !== undefined || o.plus !== undefined) {
    const gear = {} as Gear;
    for (const s of SLOTS) {
      const g = q.gear[s];
      gear[s] = {
        tier: clamp(o.tier ?? g.tier, 1, SETS.length),
        plus: clamp(o.plus ?? g.plus, 0, PLUS_SAFE),
      };
    }
    q = { ...q, gear };
  }
  if (o.bosses) {
    const bosses: DungeonState['bosses'] = {};
    for (const [id, b] of Object.entries(q.bosses)) if (b) bosses[id as keyof typeof bosses] = { ...b, at: 0 };
    q = { ...q, bosses };
  }
  if (o.stash) {
    const stash = { ...q.stash };
    for (const f of FLOORS)
      for (const m of f.mats) stash[m.id] = Math.max(stash[m.id] ?? 0, m.stack === 1 ? 3 : 99);
    q = { ...q, stash, sackLevel: SACK_MAX };
  }
  return q;
}
