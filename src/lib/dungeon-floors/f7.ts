// Этаж 7 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F7 = stubFloor({
  id: 7,
  name: 'Зеркальный лабиринт',
  lead: 'Ещё не открыт.',
  mob: { id: 'f7mob', name: 'Отражение', many: 'отражений', x72: 'elf_m' },
  boss: { id: 'f7boss', name: 'Отражение героя', x72: 'knight_m' },
  mat: { id: 'f7mat', name: 'Трофей 7-го этажа' },
  ores: [12, 13],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (см. библию §12).
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [0.85, 0.95, 1.2] } },
});
