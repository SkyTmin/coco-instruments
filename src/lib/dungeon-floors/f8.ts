// Этаж 8 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F8 = stubFloor({
  id: 8,
  name: 'Бесконечный замок',
  lead: 'Ещё не открыт.',
  mob: { id: 'f8mob', name: 'Демон', many: 'демонов', x72: 'chort' },
  boss: { id: 'f8boss', name: 'Демон семи лун', x72: 'big_demon' },
  mat: { id: 'f8mat', name: 'Трофей 8-го этажа' },
  ores: [14, 15],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (см. библию §12).
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [1.1, 0.8, 1.15] } },
});
