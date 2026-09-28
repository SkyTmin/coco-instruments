// Этаж 12 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F12 = stubFloor({
  id: 12,
  name: 'Проклятая станция',
  lead: 'Ещё не открыт.',
  mob: { id: 'f12mob', name: 'Проклятый дух', many: 'духов', x72: 'wogol' },
  boss: { id: 'f12boss', name: 'Двуликий король проклятий', x72: 'big_demon' },
  mat: { id: 'f12mat', name: 'Трофей 12-го этажа' },
  ores: [22, 23],
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [0.9, 0.85, 1.1] } },
});
