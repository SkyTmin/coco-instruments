// Этаж 4 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F4 = stubFloor({
  id: 4,
  name: 'Этаж 4',
  lead: 'Ещё не открыт.',
  mob: { id: 'f4mob', name: 'Скелет', many: 'скелетов', x72: 'skelet' },
  boss: { id: 'f4boss', name: 'Каменный страж', x72: 'big_demon' },
  mat: { id: 'f4mat', name: 'Трофей четвёртого этажа' },
  ores: [6, 7],
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [0.9, 0.9, 1] } },
});
