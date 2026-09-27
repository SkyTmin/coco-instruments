// Этаж 6 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F6 = stubFloor({
  id: 6,
  name: 'Огненный разлом',
  lead: 'Ещё не открыт.',
  mob: { id: 'f6mob', name: 'Саламандра', many: 'саламандр', x72: 'lizard_m' },
  boss: { id: 'f6boss', name: 'Красный змей', x72: 'big_demon' },
  mat: { id: 'f6mat', name: 'Трофей 6-го этажа' },
  ores: [10, 11],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (см. библию §12).
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [1.35, 0.8, 0.65] } },
});
