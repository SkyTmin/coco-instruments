// Скины автомата: набор символов + палитра корпуса + надпись на вывеске.
// Символы лежат в public/slots/<skin>/<symbol>.svg — это Twemoji (CC-BY 4.0,
// см. public/slots/LICENSE.txt), единый по стилю и свободный по лицензии
// набор, который выглядит одинаково на любом телефоне (в отличие от
// системных эмодзи, у каждой платформы своих).

import type { SlotSymbolId } from '@/types';

export type SkinId =
  | 'classic'
  | 'asia'
  | 'space'
  | 'pirate'
  | 'egypt'
  | 'candy'
  | 'neon'
  | 'winter'
  | 'olympus'
  | 'pumpkin'
  | 'abyss'
  | 'kupala'
  | 'relic';

/**
 * Сколько ставок нужно взять за один спин, чтобы открылась «Реликвия».
 * Это ступень «МЕГА-ВЫИГРЫШ» из lib/rollup.ts — не случайное число, а та же
 * лестница, по которой игра называет выигрыши. Ниже брать нельзя: скин,
 * который получают все, статуса не показывает.
 */
export const RELIC_X = 200;

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
  /**
   * Скин-достижение: его не открывает уровень и не выдаёт календарь, его
   * ЗАРАБАТЫВАЮТ. `topX` — какой множитель нужно взять за один спин.
   */
  earn?: { topX: number; what: string };
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
  {
    id: 'pumpkin',
    name: 'Тыквенная ночь',
    hint: 'Паутина, призраки и фонарь из тыквы',
    sign: ['PUMPKIN', 'NIGHT'],
    preview: 'seven',
    title: 'Тыквенная ночь',
    subtitle: 'Сладость или гадость',
    rain: 'seven',
    confetti: ['#ff8c1a', '#7b2ff7', '#ffd166', '#2b2b3d', '#ffffff'],
  },
  {
    id: 'abyss',
    name: 'Из глубины',
    hint: 'Кораллы, медузы и кит на большой глубине',
    sign: ['THE', 'ABYSS'],
    preview: 'seven',
    title: 'Из глубины',
    subtitle: 'Там, куда не доходит свет',
    rain: 'star',
    confetti: ['#33e0d4', '#1b7fd4', '#8ef0ff', '#0a2b4a', '#c8fff6'],
  },
  {
    id: 'neon',
    name: 'Неон',
    hint: 'Ночной аркадный зал — открывается на 5 уровне',
    sign: ['ARCADE', 'NEON'],
    preview: 'seven',
    title: 'Неоновый зал',
    subtitle: 'Аркада, которая не закрывается',
    rain: 'star',
    confetti: ['#ff2fb9', '#00e5ff', '#9d4bff', '#ffe66d', '#ff5f9e'],
  },
  {
    id: 'winter',
    name: 'Зима',
    hint: 'Снег, подарки и какао — открывается на 9 уровне',
    sign: ['FROST', 'NIGHT'],
    preview: 'star',
    title: 'Морозная ночь',
    subtitle: 'Снег, огни и подарки',
    rain: 'star',
    confetti: ['#ffffff', '#bfe9ff', '#7fc7ff', '#e7f6ff', '#ffd76a'],
  },
  {
    id: 'olympus',
    name: 'Олимп',
    hint: 'Золото богов и молнии Зевса — открывается на 12 уровне',
    sign: ['GATES OF', 'OLYMPUS'],
    preview: 'seven',
    title: 'Врата Олимпа',
    subtitle: 'Золото богов и молнии Зевса',
    rain: 'seven',
    confetti: ['#ffd83d', '#fff3c4', '#7fd4ff', '#f0a01e', '#ffffff'],
  },
  {
    // Флагман. Единственный скин, символы которого нарисованы для него, а не
    // взяты из Twemoji: один свет, один контурный приём, сложность растёт со
    // ступенью. Лестница со смыслом — внизу лист папоротника, наверху его
    // цветок, тот самый, ради которого в эту ночь и ходят в лес.
    id: 'kupala',
    name: 'Купальская ночь',
    hint: 'Светляки и цвет папоротника — открывается на 15 уровне',
    sign: ['KUPALA', 'NIGHT'],
    preview: 'seven',
    title: 'Цвет папоротника',
    subtitle: 'Одна ночь в году, чтобы найти клад',
    rain: 'seven',
    confetti: ['#9dff57', '#ffd54a', '#4f7fff', '#e01f3c', '#eaf7ea'],
  },
  {
    // Витрина. Единственный скин, который нельзя просто выбрать: его
    // зарабатывают одним крупным спином, и он об этом говорит всем своим
    // видом — своя анимация корпуса, свой блик на вывеске, своя пыль в
    // сцене. Всё дорогое, что есть в проекте, включено здесь и только здесь.
    id: 'relic',
    name: 'Реликвия',
    hint: 'Золото, которое достают раз в жизни',
    sign: ['THE', 'RELIC'],
    preview: 'seven',
    title: 'Реликвия',
    subtitle: 'То, что берут один раз',
    rain: 'cherry',
    confetti: ['#ffe9a3', '#ffc23c', '#fff6d5', '#c98b1b', '#ffffff'],
    earn: { topX: RELIC_X, what: `выигрыш ×${RELIC_X} за один спин` },
  },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinOf(id: SkinId): Skin {
  return BY_ID.get(id) ?? SKINS[0];
}

/** Путь к символу выбранного скина. `scatter` — «Зевс» темы из «Каскада». */
export function symbolSrc(skin: SkinId, symbol: SlotSymbolId | 'scatter'): string {
  return `/slots/${skin}/${symbol}.svg`;
}
