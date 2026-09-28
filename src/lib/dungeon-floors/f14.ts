// Этаж 14 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F14 = stubFloor({
  id: 14,
  name: 'Часовая башня',
  lead: 'Ещё не открыт.',
  mob: { id: 'f14mob', name: 'Заводной солдатик', many: 'солдатиков', x72: 'knight_m' },
  boss: { id: 'f14boss', name: 'Повелитель часа', x72: 'big_demon' },
  mat: { id: 'f14mat', name: 'Трофей 14-го этажа' },
  ores: [26, 27],
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [1.2, 1.05, 0.75] } },
});
