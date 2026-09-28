// Этаж 15 «Сердце подземелья» — половина агента «Мир» (заготовка каркаса):
// районы снизу вверх, монстры этажа, шахта, правила этажа. Агент «Мир»
// заменяет этот файл целиком, СОХРАНЯЯ договор с агентом «Сердце»
// (см. шапку `f15-boss.ts`): последний район — F15_HEART_AREA, босс —
// F15_BOSS, списки монстров, материалов и мяса склеиваются с его списками,
// верхний ряд последнего своего района — пол ровно в столбцах F15_JOIN.

import type { MobDef } from '../dungeon';
import { F15_BOSS, F15_BOSS_MATS, F15_BOSS_MEATS, F15_BOSS_MOBS, F15_HEART_AREA } from './f15-boss';
import { F15_ENTRY_MAP } from './f15-map';
import type { FloorDef } from './types';

const MOB: MobDef = {
  id: 'f15_mob',
  name: 'Антитело',
  many: 'антител',
  hp: 22,
  dmg: 10,
  speed: 3,
  radius: 0.3,
  windup: 0.35,
  reach: 0.4,
  rest: 0.7,
  xp: 5,
  meat: null,
  mats: [['f15_tissue', 0.3]],
  beast: true,
  brain: 'melee',
  art: { kind: 'x72', name: 'tiny_slug' },
  mass: 1.4,
  flinch: 0.3,
};

export const F15: FloorDef = {
  id: 15,
  name: 'Сердце подземелья',
  lead: 'Ещё не открыт.',
  mapVer: 1,
  areas: [
    {
      id: 'f15',
      name: 'Горло',
      lead: 'Стены тёплые',
      tier: 8,
      level: 9,
      ambient: 0.4,
      rows: F15_ENTRY_MAP,
      skin: { floor: 'slab', wall: 'rock', tint: { mul: [1.2, 0.85, 0.85] } },
      mine: 'f15mine',
      spawn: {
        mobs: [[MOB.id, 1]],
        density: 1,
        pack: [2, 2],
        filler: MOB.id,
        group: () => MOB.id,
        horde: null,
        treasure: null,
        nest: () => MOB.id,
      },
    },
    F15_HEART_AREA,
  ],
  boss: F15_BOSS,
  mines: [
    {
      id: 'f15mine',
      name: 'Шахта этажа',
      area: 'f15',
      windowMs: 60 * 60_000,
      ores: [28, 29],
      share: [0.2, 0.26, 0.32, 0.4, 0.48],
      pyrite: 0,
      blocks: 1.6,
    },
  ],
  mobs: [MOB, ...F15_BOSS_MOBS],
  meats: [...F15_BOSS_MEATS],
  // Ходовой материал этажа — первый со стопкой больше 1 (им чинят лифты).
  mats: [
    { id: 'f15_tissue', name: 'Живая ткань', price: 600, lead: 'Тёплая, ещё дышит.' },
    ...F15_BOSS_MATS,
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/haul.png',
};
