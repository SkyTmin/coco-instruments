// Этаж 5 — заготовка каркаса. Агент этажа заменяет этот файл целиком.
import { stubFloor } from './stub';

export const F5 = stubFloor({
  id: 5,
  name: 'Этаж 5',
  lead: 'Ещё не открыт.',
  mob: { id: 'f5mob', name: 'Бес', many: 'бесов', x72: 'imp' },
  boss: { id: 'f5boss', name: 'Рогач', x72: 'big_demon' },
  mat: { id: 'f5mat', name: 'Трофей пятого этажа' },
  ores: [8, 9],
  skin: { floor: 'ground', wall: 'rock', tint: { mul: [1.1, 0.85, 0.8] } },
});
