import { describe, expect, it } from 'vitest';
import { daysUntil, daysWord, limitLabel, windowState } from './skin-limits';

/** Полдень местного дня — чтобы тесты не зависели от часа прогона. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

describe('окно лимитированного скина', () => {
  const season = { from: '09-20', until: '11-05' };

  it('сезонное окно открыто внутри и закрыто снаружи', () => {
    expect(windowState(season, at(2026, 9, 19)).open).toBe(false);
    expect(windowState(season, at(2026, 9, 20)).open).toBe(true);
    expect(windowState(season, at(2026, 10, 31)).open).toBe(true);
    // Последний день ещё считается: окно кончается в КОНЦЕ 5 ноября.
    expect(windowState(season, at(2026, 11, 5)).open).toBe(true);
    expect(windowState(season, at(2026, 11, 6)).open).toBe(false);
  });

  it('сезонное возвращается каждый год и никогда не «кончается»', () => {
    const st = windowState(season, at(2026, 11, 6));
    expect(st.gone).toBe(false);
    expect(new Date(st.opensAt!).getFullYear()).toBe(2027);
    expect(windowState(season, at(2027, 10, 1)).open).toBe(true);
    expect(windowState(season, at(2030, 10, 1)).open).toBe(true);
  });

  it('до первого открытия в году ждём этого же года, а не следующего', () => {
    const st = windowState(season, at(2026, 3, 1));
    expect(st.open).toBe(false);
    expect(new Date(st.opensAt!).getFullYear()).toBe(2026);
    expect(new Date(st.opensAt!).getMonth()).toBe(8); // сентябрь
  });

  it('сезонное окно переживает Новый год', () => {
    // Зимнее окно: с 10 декабря по 10 января.
    const winter = { from: '12-10', until: '01-10' };
    expect(windowState(winter, at(2026, 12, 25)).open).toBe(true);
    expect(windowState(winter, at(2027, 1, 5)).open).toBe(true);
    expect(windowState(winter, at(2027, 1, 11)).open).toBe(false);
    expect(windowState(winter, at(2026, 12, 1)).open).toBe(false);
  });

  it('дроп разовый: кончился — значит кончился', () => {
    const drop = { from: '09-21', until: '11-15', year: 2026 };
    expect(windowState(drop, at(2026, 9, 20)).open).toBe(false);
    expect(windowState(drop, at(2026, 9, 20)).gone).toBe(false);
    expect(windowState(drop, at(2026, 10, 1)).open).toBe(true);
    expect(windowState(drop, at(2026, 11, 15)).open).toBe(true);
    const after = windowState(drop, at(2026, 11, 16));
    expect(after.open).toBe(false);
    expect(after.gone).toBe(true);
    expect(after.opensAt).toBeNull();
    // И через год он не возвращается — в этом вся разница с сезонным.
    expect(windowState(drop, at(2027, 10, 1)).open).toBe(false);
    expect(windowState(drop, at(2027, 10, 1)).gone).toBe(true);
  });
});

describe('подпись лимита', () => {
  const season = { from: '09-20', until: '11-05' };

  it('считает дни вверх: последний день — это ещё день', () => {
    expect(daysUntil(at(2026, 9, 21), at(2026, 9, 20))).toBe(1);
    expect(daysUntil(at(2026, 9, 20) + 1, at(2026, 9, 20))).toBe(1);
    expect(daysUntil(at(2026, 9, 20), at(2026, 9, 20))).toBe(0);
  });

  it('склоняет дни по-русски', () => {
    expect(daysWord(1)).toBe('день');
    expect(daysWord(2)).toBe('дня');
    expect(daysWord(5)).toBe('дней');
    expect(daysWord(11)).toBe('дней');
    expect(daysWord(21)).toBe('день');
    expect(daysWord(22)).toBe('дня');
    expect(daysWord(112)).toBe('дней');
  });

  it('говорит разное владельцу и тому, кто ещё не взял', () => {
    const now = at(2026, 10, 1);
    expect(limitLabel(season, false, now)).toContain('успеть');
    // Владельцу счётчик дней не показываем: он уже не торопится.
    expect(limitLabel(season, true, now)).toBe('ваш навсегда');
    // Взятый скин остаётся при владельце и после закрытия окна.
    expect(limitLabel(season, true, at(2026, 12, 1))).toBe('ваш навсегда');
    expect(limitLabel(season, false, at(2026, 12, 1))).toContain('вернётся');
    expect(limitLabel({ ...season, year: 2026 }, false, at(2027, 1, 1))).toBe('дроп закончился');
  });

  it('в последний день так и написано', () => {
    // 5 ноября — окно закроется в полночь, до неё меньше суток.
    expect(limitLabel(season, false, at(2026, 11, 5))).toContain('последний день');
  });
});
