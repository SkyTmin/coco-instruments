/** Games hall (casino): GamesPage. */
export const hall = {
  title: 'Казино',
  cascade: 'Каскад',
  prison: 'Каторга',
  wallet: 'Общий кошелёк',
  play: 'Играть',
  main: 'Главная игра',
  rank: 'ранг',
  tokens: 'токены',
  reels: {
    one: '{n} барабан',
    few: '{n} барабана',
    many: '{n} барабанов',
    other: '{n} барабана',
  },
  lines: {
    one: '{n} линия',
    few: '{n} линии',
    many: '{n} линий',
    other: '{n} линии',
  },
  grid: 'Поле {cols}×{rows}',
  orbsUpTo: 'Сферы до ×{x}',
  stat: {
    one: '{n} спин · лучший {best}',
    few: '{n} спина · лучший {best}',
    many: '{n} спинов · лучший {best}',
    other: '{n} спина · лучший {best}',
  },
  note: 'Те же монеты, что в шахте. Купить их нельзя — только заработать',
} as const;
