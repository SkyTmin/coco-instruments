// Этаж 10 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F10 = stubFloor({
  id: 10,
  name: 'Трон демона',
  lead: 'Ещё не открыт.',
  mob: { id: 'f10mob', name: 'Страж', many: 'стражей', x72: 'masked_orc' },
  boss: { id: 'f10boss', name: 'Король демонов', x72: 'big_demon' },
  mat: { id: 'f10mat', name: 'Трофей 10-го этажа' },
  ores: [18, 19],
  // Глубже снаряжения Т8 пока нет — уровень держится на 9 (см. библию §12).
  level: 9,
  skin: { floor: 'slab', wall: 'brick', tint: { mul: [1.2, 0.75, 0.9] } },
});
