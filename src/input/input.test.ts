import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actionsForButton,
  actionsForCode,
  actionsForKey,
  DEFAULT_BINDINGS,
  keyLabel,
  normalizeBindings,
  PAD,
  rebind,
} from './actions';
import {
  __resetBus,
  emitAction,
  getMoveAxis,
  isHeld,
  onAction,
  onMoveAxis,
  type ActionEvent,
} from './bus';
import { getInputDevice, getPadStyle, padStyleOf } from './device';
import { applyDeadzone, GamepadPoller, REPEAT_DELAY, REPEAT_EVERY } from './gamepad';
import { pickNeighbour, type Box } from './focus-nav';
import { promptText } from './Prompt';

const B = normalizeBindings(DEFAULT_BINDINGS);

describe('ввод: действия по клавишам', () => {
  it('WASD и стрелки — и меню, и движение; по коду, а не по букве', () => {
    expect(actionsForKey(B, { code: 'KeyW' })).toEqual(['up', 'moveUp']);
    expect(actionsForKey(B, { code: 'ArrowLeft' })).toEqual(['left', 'moveLeft']);
  });
  it('Tab и Shift+Tab — разные действия', () => {
    expect(actionsForKey(B, { code: 'Tab' })).toEqual(['tabNext']);
    expect(actionsForKey(B, { code: 'Tab', shiftKey: true })).toEqual(['tabPrev']);
  });
  it('с зажатым Shift без своей привязки — как без Shift (бег с рывком)', () => {
    expect(actionsForKey(B, { code: 'KeyD', shiftKey: true })).toEqual(['right', 'moveRight']);
    expect(actionsForKey(B, { code: 'ShiftLeft', shiftKey: true })).toEqual(['dash']);
  });
  it('Ctrl/Alt/Cmd — сочетания браузера, не наши', () => {
    expect(actionsForKey(B, { code: 'KeyS', ctrlKey: true })).toEqual([]);
    expect(actionsForKey(B, { code: 'KeyI', metaKey: true })).toEqual([]);
  });
  it('пробел — «подтвердить» в меню и «удар» в бою, горячие клавиши лагеря', () => {
    expect(actionsForKey(B, { code: 'Space' })).toEqual(['confirm', 'attack']);
    expect(actionsForKey(B, { code: 'KeyI' })).toEqual(['inventory']);
    expect(actionsForKey(B, { code: 'KeyM' })).toEqual(['mines']);
  });
  it('отпускание клавиши отпускает все её действия, с Shift и без', () => {
    expect(actionsForCode(B, 'Tab').sort()).toEqual(['tabNext', 'tabPrev']);
  });
  it('кнопки геймпада', () => {
    expect(actionsForButton(B, PAD.A)).toEqual(['confirm', 'attack']);
    expect(actionsForButton(B, PAD.B)).toEqual(['back', 'dash']);
    expect(actionsForButton(B, PAD.UP)).toEqual(['up', 'moveUp']);
  });
  it('подписи клавиш', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Shift+Tab')).toBe('Shift+Tab');
  });
});

describe('ввод: переназначение', () => {
  it('клавиша уходит с действия той же группы, но не из другой', () => {
    const b = rebind(B, 'up', 'keys', 'KeyS');
    expect(b.keys.up[0]).toBe('KeyS');
    expect(b.keys.down).not.toContain('KeyS'); // та же группа (меню)
    expect(b.keys.moveDown).toContain('KeyS'); // движение — другая группа
    expect(B.keys.down).toContain('KeyS'); // исходник не тронут
  });
  it('кнопка геймпада переназначается так же', () => {
    const b = rebind(B, 'skill', 'pad', PAD.RB);
    expect(b.pad.skill[0]).toBe(PAD.RB);
    expect(b.pad.tabNext).toContain(PAD.RB); // меню — другая группа
  });
  it('старое сохранение без нового действия получает значение по умолчанию; мусор выброшен', () => {
    const b = normalizeBindings({ keys: { up: ['KeyU', 5, ''] }, pad: { up: [3, -1, 'x', 99] } });
    expect(b.keys.up).toEqual(['KeyU']);
    expect(b.pad.up).toEqual([3]);
    expect(b.keys.inventory).toEqual(['KeyI']);
    expect(normalizeBindings(null).keys.back).toEqual(['Escape']);
  });
});

describe('ввод: шина', () => {
  beforeEach(() => __resetBus());

  it('стек: позже подписанный первым и может съесть событие', () => {
    const log: string[] = [];
    onAction((e) => void log.push(`page:${e.action}`));
    const off = onAction((e) => {
      log.push(`modal:${e.action}`);
      return e.action === 'back';
    });
    expect(emitAction('back', 'down', 'keyboard')).toBe(true);
    expect(emitAction('confirm', 'down', 'keyboard')).toBe(false);
    off();
    emitAction('back', 'down', 'keyboard');
    expect(log).toEqual(['modal:back', 'modal:confirm', 'page:confirm', 'page:back']);
  });

  it('удержание — пока держит хоть один источник; лишнее отпускание не событие', () => {
    const seen: ActionEvent[] = [];
    onAction((e) => void seen.push(e));
    emitAction('attack', 'down', 'keyboard', undefined, 'key:KeyJ');
    emitAction('attack', 'down', 'gamepad', undefined, 'pad:0');
    emitAction('attack', 'up', 'keyboard', undefined, 'key:KeyJ');
    expect(isHeld('attack')).toBe(true);
    emitAction('attack', 'up', 'gamepad', undefined, 'pad:0');
    expect(isHeld('attack')).toBe(false);
    emitAction('attack', 'up', 'keyboard', undefined, 'key:KeyJ');
    expect(seen.length).toBe(4);
  });

  it('ось: клавиши дают единичный вектор, диагональ нормирована', () => {
    const axes: { x: number; y: number }[] = [];
    onMoveAxis((a) => axes.push(a));
    emitAction('moveUp', 'down', 'keyboard', undefined, 'key:KeyW');
    expect(getMoveAxis()).toEqual({ x: 0, y: -1 });
    emitAction('moveRight', 'down', 'keyboard', undefined, 'key:KeyD');
    const a = getMoveAxis();
    expect(a.x).toBeCloseTo(Math.SQRT1_2);
    expect(a.y).toBeCloseTo(-Math.SQRT1_2);
    emitAction('moveUp', 'up', 'keyboard', undefined, 'key:KeyW');
    emitAction('moveRight', 'up', 'keyboard', undefined, 'key:KeyD');
    expect(getMoveAxis()).toEqual({ x: 0, y: 0 });
    expect(axes.length).toBe(4);
  });
});

describe('ввод: геймпад (поддельный navigator.getGamepads)', () => {
  type FakePad = {
    id: string;
    index: number;
    connected: boolean;
    mapping: string;
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
  };
  let pad: FakePad;
  const btn = (i: number, on: boolean) => {
    pad.buttons[i] = { pressed: on, value: on ? 1 : 0 };
  };
  beforeEach(() => {
    __resetBus();
    pad = {
      id: 'Sony Interactive Entertainment Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad, null, null, null] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('кнопка: нажатие и отпускание, устройство и стиль подписей', () => {
    const seen: string[] = [];
    onAction((e) => void seen.push(`${e.action}:${e.phase}:${e.source}`));
    const p = new GamepadPoller();
    p.step(0);
    expect(seen).toEqual([]);
    btn(PAD.A, true);
    p.step(16);
    p.step(32); // держим — повторов у «confirm» нет
    btn(PAD.A, false);
    p.step(48);
    expect(seen).toEqual([
      'confirm:down:gamepad',
      'attack:down:gamepad',
      'confirm:up:gamepad',
      'attack:up:gamepad',
    ]);
    expect(getInputDevice()).toBe('gamepad');
    expect(getPadStyle()).toBe('ps');
  });

  it('стик: мёртвая зона, аналоговая ось движения и направление меню с повтором', () => {
    const seen: string[] = [];
    onAction((e) => void seen.push(`${e.action}:${e.phase}`));
    const p = new GamepadPoller();
    pad.axes = [0.15, 0.1, 0, 0];
    p.step(0);
    expect(getMoveAxis()).toEqual({ x: 0, y: 0 });
    expect(seen).toEqual([]);
    pad.axes = [0.9, 0, 0, 0];
    p.step(16);
    expect(getMoveAxis().x).toBeCloseTo((0.9 - 0.24) / 0.76, 3);
    expect(seen).toEqual(['right:down']);
    p.step(16 + REPEAT_DELAY - 1);
    expect(seen.length).toBe(1);
    p.step(16 + REPEAT_DELAY);
    p.step(16 + REPEAT_DELAY + REPEAT_EVERY);
    expect(seen).toEqual(['right:down', 'right:repeat', 'right:repeat']);
    pad.axes = [0, 0, 0, 0];
    p.step(1000);
    expect(seen.at(-1)).toBe('right:up');
    expect(getMoveAxis()).toEqual({ x: 0, y: 0 });
  });

  it('крестовина — и движение, и меню; отключённый геймпад отпускает всё', () => {
    const p = new GamepadPoller();
    btn(PAD.LEFT, true);
    p.step(0);
    expect(isHeld('moveLeft')).toBe(true);
    expect(getMoveAxis()).toEqual({ x: -1, y: 0 });
    pad.connected = false;
    p.reset();
    expect(isHeld('moveLeft')).toBe(false);
    expect(getMoveAxis()).toEqual({ x: 0, y: 0 });
  });

  it('мёртвая зона пересчитывает ход от нуля', () => {
    expect(applyDeadzone(0.2, 0)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0).x).toBeCloseTo(1);
    expect(applyDeadzone(0.62, 0).x).toBeCloseTo(0.5);
  });

  it('стиль подписей по id', () => {
    expect(padStyleOf('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)')).toBe('xbox');
    expect(padStyleOf('DualSense Wireless Controller')).toBe('ps');
    expect(padStyleOf('Pro Controller (Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padStyleOf('Some USB pad')).toBe('xbox');
  });

  it('подсказки кнопок по устройству', () => {
    expect(promptText('confirm', 'keyboard', 'xbox', B)).toBe('Enter');
    expect(promptText('confirm', 'gamepad', 'xbox', B)).toBe('A');
    expect(promptText('confirm', 'gamepad', 'ps', B)).toBe('✕');
    expect(promptText('confirm', 'gamepad', 'nintendo', B)).toBe('B');
    expect(promptText('tabNext', 'gamepad', 'ps', B)).toBe('R1');
    expect(promptText('up', 'gamepad', 'xbox', B)).toBe('↑');
    expect(promptText('pets', 'gamepad', 'xbox', B)).toBe('');
    expect(promptText('move', 'keyboard', 'xbox', B)).toBe('WASD');
  });
});

describe('ввод: фокус по соседям', () => {
  // Сетка 3×3 кнопок 100×50 с зазором 20.
  const grid: Box[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) grid.push({ x: c * 120, y: r * 70, w: 100, h: 50 });
  const at = (i: number) => grid[i]!;

  it('сетка: соседи по четырём сторонам, у края — никого', () => {
    expect(pickNeighbour(at(4), grid, 'right')).toBe(5);
    expect(pickNeighbour(at(4), grid, 'left')).toBe(3);
    expect(pickNeighbour(at(4), grid, 'up')).toBe(1);
    expect(pickNeighbour(at(4), grid, 'down')).toBe(7);
    expect(pickNeighbour(at(5), grid, 'right')).toBe(-1);
    expect(pickNeighbour(at(0), grid, 'up')).toBe(-1);
  });

  it('свой ряд важнее близкой диагонали', () => {
    const from: Box = { x: 0, y: 0, w: 100, h: 40 };
    const sameRowFar: Box = { x: 400, y: 0, w: 100, h: 40 };
    const diagNear: Box = { x: 120, y: 60, w: 100, h: 40 };
    expect(pickNeighbour(from, [from, sameRowFar, diagNear], 'right')).toBe(1);
  });

  it('вниз из широкой кнопки — к той, что под ней, а не к крайней', () => {
    const wide: Box = { x: 0, y: 0, w: 360, h: 50 };
    const row: Box[] = [0, 1, 2].map((c) => ({ x: c * 120, y: 80, w: 100, h: 50 }));
    expect(pickNeighbour(wide, [wide, ...row], 'down')).toBe(2); // центр ровнее
  });

  it('карточки лесенкой: вправо ведёт в соседнюю колонку, а не вниз', () => {
    const from: Box = { x: 0, y: 100, w: 150, h: 100 };
    const right: Box = { x: 170, y: 140, w: 150, h: 100 };
    const below: Box = { x: 0, y: 220, w: 150, h: 100 };
    expect(pickNeighbour(from, [from, below, right], 'right')).toBe(2);
    expect(pickNeighbour(from, [from, below, right], 'down')).toBe(1);
  });
});
