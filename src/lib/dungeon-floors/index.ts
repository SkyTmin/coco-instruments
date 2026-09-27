// Реестр этажей подземелья (v2.81). Порядок — сверху вниз: этаж 1 под
// лагерем, дальше глубже. Файлы этажей — `fN.ts` (данные), `fN-brains.ts`
// (ИИ и сценарий босса), `fN-art.ts` (рисовальщики); подключение ИИ и
// рисунков — `brains.ts` и `art.ts` рядом. Этот файл агенты не правят.

import { F1 } from './f1';
import { F2 } from './f2';
import { F3 } from './f3';
import { F4 } from './f4';
import { F5 } from './f5';
import type { FloorDef } from './types';

export const FLOORS: FloorDef[] = [F1, F2, F3, F4, F5];
