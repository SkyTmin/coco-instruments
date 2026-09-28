// Этаж 11 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F11 = stubFloor({
  id: 11,
  name: 'Небесный архипелаг',
  lead: 'Ещё не открыт.',
  mob: { id: 'f11mob', name: 'Небесный скат', many: 'скатов', x72: 'imp' },
  boss: { id: 'f11boss', name: 'Древний страж', x72: 'big_zombie' },
  mat: { id: 'f11mat', name: 'Трофей 11-го этажа' },
  ores: [20, 21],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (библия §12в).
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [0.95, 1.05, 1.25] } },
});
