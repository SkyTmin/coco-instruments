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
  /** Заголовок и подзаголовок всего экрана — тема меняет и их. */
  title: string;
  subtitle: string;
  /** Символ, который сыплется дождём при крупном выигрыше. */
  rain: SlotSymbolId;
  /** Цвета конфетти под палитру темы. */
  confetti: string[];
}

export const SKINS: Skin[] = [
  {
    id: 'classic',
    name: 'Классика',
    hint: 'Фрукты и семёрки — как в Вегасе',
    sign: ['COCO', 'SLOTS'],
    preview: 'cherry',
    title: 'Слоты',
    subtitle: 'Мини-игра на удачу',
    rain: 'diamond',
    confetti: ['#ffd06a', '#ff8e5e', '#e0613a', '#ffe9a3', '#b06a36'],
  },
  {
    id: 'asia',
    name: 'Дракон',
    hint: 'Красные фонари, золото и драконы',
    sign: ['福', 'DRAGON'],
    preview: 'seven',
    title: 'Врата дракона',
    subtitle: 'Фонари, золото и удача',
    rain: 'bell',
    confetti: ['#ffd24d', '#ff3b30', '#ffb703', '#e63946', '#fff0c2'],
  },
  {
    id: 'space',
    name: 'Космос',
    hint: 'Планеты, ракеты и пришельцы',
    sign: ['DEEP', 'SPACE'],
    preview: 'seven',
    title: 'Глубокий космос',
    subtitle: 'Ставки на краю галактики',
    rain: 'star',
    confetti: ['#86b8ff', '#c78bff', '#ffffff', '#5de2ff', '#8f7bff'],
  },
  {
    id: 'pirate',
    name: 'Пираты',
    hint: 'Якоря, сабли и сундук с золотом',
    sign: ['BLACK', 'FLAG'],
    preview: 'seven',
    title: 'Чёрный флаг',
    subtitle: 'Сундук ждёт смелых',
    rain: 'diamond',
    confetti: ['#57d6c4', '#ffd166', '#e9d8a6', '#0d7a6f', '#f4f1de'],
  },
  {
    id: 'egypt',
    name: 'Египет',
    hint: 'Скарабеи, кошки и корона фараона',
    sign: ['GOLD OF', 'NILE'],
    preview: 'seven',
    title: 'Золото Нила',
    subtitle: 'Сокровища фараонов',
    rain: 'seven',
    confetti: ['#4fd0e0', '#ffc94d', '#e8c37a', '#1b6f8a', '#fff3d0'],
  },
  {
    id: 'candy',
    name: 'Сладости',
    hint: 'Леденцы, пончики и торты',
    sign: ['SWEET', 'CANDY'],
    preview: 'seven',
    title: 'Сладкая лавка',
    subtitle: 'Крутите на леденцы',
    rain: 'cherry',
    confetti: ['#ff8ad4', '#7ee0ff', '#ffe066', '#ff5d8f', '#ffffff'],
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
