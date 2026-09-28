// Этаж 13 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F13 = stubFloor({
  id: 13,
  name: 'Город за стенами',
  lead: 'Ещё не открыт.',
  mob: { id: 'f13mob', name: 'Бродячий гигант', many: 'гигантов', x72: 'ogre' },
  boss: { id: 'f13boss', name: 'Колосс', x72: 'big_zombie' },
  mat: { id: 'f13mat', name: 'Трофей 13-го этажа' },
  ores: [24, 25],
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [1.15, 1.0, 0.85] } },
});
