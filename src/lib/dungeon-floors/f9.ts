// Этаж 9 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F9 = stubFloor({
  id: 9,
  name: 'Лабиринт гидры',
  lead: 'Ещё не открыт.',
  mob: { id: 'f9mob', name: 'Ящер', many: 'ящеров', x72: 'lizard_f' },
  boss: { id: 'f9boss', name: 'Многоглавая гидра', x72: 'big_zombie' },
  mat: { id: 'f9mat', name: 'Трофей 9-го этажа' },
  ores: [16, 17],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (см. библию §12).
  level: 9,
  skin: { floor: 'ground', wall: 'rock', tint: { mul: [0.8, 1.15, 1.05] } },
});
