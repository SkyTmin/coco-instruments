// Этаж 15 «Сердце подземелья» — половина агента «Сердце» (заготовка
// каркаса): верхний район-арена, финальный босс, его части, материалы и
// мясо. Агент «Сердце» заменяет этот файл целиком, СОХРАНЯЯ договор ниже.
//
// ДОГОВОР С АГЕНТОМ «МИР» (`f15.ts`, меняет только сводящий):
//   • экспорт — F15_HEART_AREA, F15_BOSS, F15_BOSS_MOBS, F15_BOSS_MATS,
//     F15_BOSS_MEATS, F15_JOIN;
//   • F15_HEART_AREA — ВЕРХНИЙ район этажа: арена (`K`, ворота `G`),
//     табличка `T`, печать `S` и лестница `>`; своего лифта нет;
//   • нижний ряд его карты — пол ровно в столбцах F15_JOIN.x0…x1, остальное
//     стена; верхний ряд последнего района «Мира» — так же (стык);
//   • id — с приставкой `f15b_` или `f15boss`; босс — `f15boss`, трофей —
//     материал `f15mat` (на него могут встать сохранения игроков);
//   • правила этажа (`registerFloor(15)`) — только у «Мира»; здесь — только
//     сценарий босса (`f15-boss-brains.ts`) и рисунок (`f15-boss-art.ts`).

import type { MobDef } from '../dungeon';
import { F15_HEART_MAP } from './f15-boss-map';
import type { AreaSpec, BossSpec, MatDefIn, MeatDef } from './types';

/** Стык района «Сердце» с районами «Мира»: столбцы прохода. */
export const F15_JOIN = { x0: 28, x1: 35 } as const;

const BOSS_MOB: MobDef = {
  id: 'f15boss',
  name: 'Хозяин подземелья',
  many: 'Хозяин подземелья',
  hp: 900,
  dmg: 18,
  speed: 2.2,
  radius: 0.8,
  windup: 0.7,
  reach: 0.6,
  rest: 1.1,
  xp: 400,
  meat: null,
  mats: [],
  beast: true,
  brain: 'brute',
  art: { kind: 'x72', name: 'big_demon', scale: 1 },
  mass: 8,
  boss: true,
  noAlbino: true,
  eye: '#ffcc30',
};

export const F15_HEART_AREA: AreaSpec = {
  id: 'f15heart',
  name: 'Сердце',
  lead: 'Здесь бьётся подземелье',
  tier: 8,
  level: 9,
  ambient: 0.4,
  rows: F15_HEART_MAP,
  skin: { floor: 'slab', wall: 'rock', tint: { mul: [1.25, 0.8, 0.85] } },
  spawn: {
    mobs: [['f15_mob', 1]],
    density: 0.4,
    pack: [2, 2],
    filler: 'f15_mob',
    group: () => 'f15_mob',
    horde: null,
    treasure: null,
    nest: () => 'f15_mob',
  },
};

export const F15_BOSS: BossSpec = {
  id: 'f15boss',
  name: 'Хозяин подземелья',
  lead: 'Сердце этажа',
  area: 'f15heart',
  restMs: 20 * 60_000,
  mob: 'f15boss',
  script: 'brute',
  parts: ['f15boss'],
  loot: (rnd) => ({
    tokens: 40 + Math.floor(rnd() * 30),
    keys: rnd() < 0.5 ? 1 : 0,
    coins: 150_000,
    mats: { f15mat: 1 },
  }),
};

export const F15_BOSS_MOBS: MobDef[] = [BOSS_MOB];

export const F15_BOSS_MATS: MatDefIn[] = [
  {
    id: 'f15mat',
    name: 'Сердце подземелья',
    price: 5000,
    lead: 'Трофей последнего этажа.',
    stack: 1,
  },
];

export const F15_BOSS_MEATS: MeatDef[] = [];
