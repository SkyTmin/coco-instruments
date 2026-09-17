// Скины автомата: набор символов + палитра корпуса + надпись на вывеске.
// Символы лежат в public/slots/<skin>/<symbol>.svg — это Twemoji (CC-BY 4.0,
// см. public/slots/LICENSE.txt), единый по стилю и свободный по лицензии
// набор, который выглядит одинаково на любом телефоне (в отличие от
// системных эмодзи, у каждой платформы своих).

import type { SlotSymbolId } from '@/types';

export type SkinId = 'classic' | 'asia' | 'space' | 'pirate' | 'egypt' | 'candy';

export interface Skin {
  id: SkinId;
  /** Название в списке выбора. */
  name: string;
  /** Короткое пояснение под названием. */
  hint: string;
  /** Надпись на вывеске автомата: мелкая и крупная часть. */
  sign: [string, string];
  /** Символ для превью в списке скинов. */
  preview: SlotSymbolId;
}

export const SKINS: Skin[] = [
  {
    id: 'classic',
    name: 'Классика',
    hint: 'Фрукты и семёрки — как в Вегасе',
    sign: ['COCO', 'SLOTS'],
    preview: 'cherry',
  },
  {
    id: 'asia',
    name: 'Дракон',
    hint: 'Красные фонари, золото и драконы',
    sign: ['福', 'DRAGON'],
    preview: 'seven',
  },
  {
    id: 'space',
    name: 'Космос',
    hint: 'Планеты, ракеты и пришельцы',
    sign: ['DEEP', 'SPACE'],
    preview: 'seven',
  },
  {
    id: 'pirate',
    name: 'Пираты',
    hint: 'Якоря, сабли и сундук с золотом',
    sign: ['BLACK', 'FLAG'],
    preview: 'seven',
  },
  {
    id: 'egypt',
    name: 'Египет',
    hint: 'Скарабеи, кошки и корона фараона',
    sign: ['GOLD OF', 'NILE'],
    preview: 'seven',
  },
  {
    id: 'candy',
    name: 'Сладости',
    hint: 'Леденцы, пончики и торты',
    sign: ['SWEET', 'CANDY'],
    preview: 'seven',
  },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinOf(id: SkinId): Skin {
  return BY_ID.get(id) ?? SKINS[0];
}

/** Путь к символу выбранного скина. */
export function symbolSrc(skin: SkinId, symbol: SlotSymbolId): string {
  return `/slots/${skin}/${symbol}.svg`;
}
