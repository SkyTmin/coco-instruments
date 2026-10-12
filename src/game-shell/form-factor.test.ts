import { describe, expect, it } from 'vitest';
import { classifyFormFactor, isGameRoute, uiScaleFor } from './form-factor';

describe('каркас: форматы', () => {
  it('пять эталонных размеров', () => {
    expect(classifyFormFactor(390, 844)).toBe('phone-portrait');
    expect(classifyFormFactor(844, 390)).toBe('phone-landscape');
    expect(classifyFormFactor(1180, 820)).toBe('tablet');
    expect(classifyFormFactor(820, 1180)).toBe('tablet');
    expect(classifyFormFactor(1440, 900)).toBe('desktop');
    expect(classifyFormFactor(1920, 1080)).toBe('desktop');
  });
  it('решает место, а не устройство', () => {
    expect(classifyFormFactor(932, 430)).toBe('phone-landscape'); // большой телефон лёжа
    expect(classifyFormFactor(744, 1133)).toBe('tablet'); // iPad mini
    expect(classifyFormFactor(600, 900)).toBe('tablet'); // узкое окно браузера
    expect(classifyFormFactor(384, 700)).toBe('phone-portrait'); // окно Telegram Desktop
    expect(classifyFormFactor(1366, 600)).toBe('tablet'); // низкое широкое окно
  });
  it('целый масштаб пиксель-арта', () => {
    expect(uiScaleFor(390, 844)).toBe(2);
    expect(uiScaleFor(844, 390)).toBe(2);
    expect(uiScaleFor(1180, 820)).toBe(3);
    expect(uiScaleFor(1440, 900)).toBe(3);
    expect(uiScaleFor(1920, 1080)).toBe(4);
    expect(uiScaleFor(2560, 1440)).toBe(5);
    expect(Number.isInteger(uiScaleFor(777, 333))).toBe(true);
  });
  it('ручной масштаб не выводит интерфейс за край', () => {
    expect(uiScaleFor(390, 844, 4)).toBe(2);
    expect(uiScaleFor(1920, 1080, 1)).toBe(1);
    expect(uiScaleFor(1920, 1080, 6)).toBe(6);
  });
  it('игровые маршруты', () => {
    expect(isGameRoute('/prison')).toBe(true);
    expect(isGameRoute('/dungeon')).toBe(true);
    expect(isGameRoute('/games')).toBe(true);
    expect(isGameRoute('/finance')).toBe(false);
    expect(isGameRoute('/')).toBe(false);
    expect(isGameRoute('/slotsx')).toBe(false);
  });
});
