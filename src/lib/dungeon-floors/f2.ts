// Этаж 2 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F2 = stubFloor({
  id: 2,
  name: 'Этаж 2',
  lead: 'Ещё не открыт.',
  mob: { id: 'f2mob', name: 'Гоблин', many: 'гоблинов', x72: 'goblin' },
  boss: { id: 'f2boss', name: 'Огр', x72: 'ogre' },
  mat: { id: 'f2mat', name: 'Трофей второго этажа' },
  ores: [2, 3],
  skin: { floor: 'ground', wall: 'rock', tint: { mul: [0.9, 1.05, 0.9] } },
});
