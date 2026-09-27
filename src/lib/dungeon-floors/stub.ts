// Заготовка этажа (каркас v2.81): один район на общей карте `STUB_MAP`,
// один вид монстров из атласа 0x72 и босс-громила с общим сценарием. Нужна,
// чтобы спуск, лифт, шахта и арена работали до того, как агент этажа
// нарисует свой. Агент заменяет `fN.ts` целиком и эту заготовку не трогает.

import type { MobDef } from '../dungeon';
import { STUB_MAP } from './stub-map';
import type { AreaSkin, FloorDef } from './types';

export function stubFloor(o: {
  id: number;
  name: string;
  lead: string;
  mob: { id: string; name: string; many: string; x72: string };
  boss: { id: string; name: string; x72: string };
  mat: { id: string; name: string };
  ores: [number, number];
  skin: AreaSkin;
  /** Уровень района (по умолчанию — номер этажа). */
  level?: number;
}): FloorDef {
  const level = o.level ?? o.id;
  const area = `f${o.id}`;
  const mob: MobDef = {
    id: o.mob.id,
    name: o.mob.name,
    many: o.mob.many,
    hp: 22,
    dmg: 10,
    speed: 3,
    radius: 0.3,
    windup: 0.35,
    reach: 0.4,
    rest: 0.7,
    xp: 5,
    meat: null,
    mats: [[o.mat.id, 0.3]],
    beast: true,
    brain: 'melee',
    art: { kind: 'x72', name: o.mob.x72 },
    mass: 1.4,
    flinch: 0.3,
  };
  const boss: MobDef = {
    id: o.boss.id,
    name: o.boss.name,
    many: o.boss.name,
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
    art: { kind: 'x72', name: o.boss.x72, scale: 1 },
    mass: 8,
    boss: true,
    noAlbino: true,
    eye: '#ffcc30',
  };
  return {
    id: o.id,
    name: o.name,
    lead: o.lead,
    mapVer: 1,
    areas: [
      {
        id: area,
        name: o.name,
        lead: o.lead,
        tier: Math.min(8, o.id + 1),
        level,
        ambient: 0.4,
        rows: STUB_MAP,
        skin: o.skin,
        mine: `${area}mine`,
        spawn: {
          mobs: [[mob.id, 1]],
          density: 1,
          pack: [2, 2],
          filler: mob.id,
          group: () => mob.id,
          horde: null,
          treasure: null,
          nest: () => mob.id,
        },
      },
    ],
    boss: {
      id: o.boss.id,
      name: o.boss.name,
      lead: 'Арена в глубине этажа',
      area,
      restMs: 20 * 60_000,
      mob: boss.id,
      script: 'brute',
      parts: [boss.id],
      loot: (rnd) => ({
        tokens: 20 + Math.floor(rnd() * 20),
        keys: rnd() < 0.4 ? 1 : 0,
        coins: 8_000 * o.id,
        mats: { [o.mat.id]: 4 + Math.floor(rnd() * 4) },
      }),
    },
    mines: [
      {
        id: `${area}mine`,
        name: 'Шахта этажа',
        area,
        windowMs: 60 * 60_000,
        ores: o.ores,
        share: [0.2, 0.26, 0.32, 0.4, 0.48],
        pyrite: 0,
        blocks: 1.6,
      },
    ],
    mobs: [mob, boss],
    meats: [],
    mats: [{ id: o.mat.id, name: o.mat.name, price: 40 * o.id, lead: 'Трофей этажа.' }],
    music: { explore: 'depths', boss: 'boss' },
    cover: '/ui/areas/haul.png',
  };
}
