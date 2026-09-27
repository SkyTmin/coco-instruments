// Этаж 3 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F3 = stubFloor({
  id: 3,
  name: 'Этаж 3',
  lead: 'Ещё не открыт.',
  mob: { id: 'f3mob', name: 'Болотник', many: 'болотников', x72: 'tiny_zombie' },
  boss: { id: 'f3boss', name: 'Великан', x72: 'big_zombie' },
  mat: { id: 'f3mat', name: 'Трофей третьего этажа' },
  ores: [4, 5],
  skin: { floor: 'ground', wall: 'rock', tint: { mul: [0.8, 0.95, 1.1] } },
});
