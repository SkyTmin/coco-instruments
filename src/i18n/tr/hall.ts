import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Kumarhane',
  cascade: 'Şelale',
  prison: 'Kürek',
  wallet: 'Ortak cüzdan',
  play: 'Oyna',
  reels: {
    one: '{n} makara',
    other: '{n} makara',
  },
  lines: {
    one: '{n} çizgi',
    other: '{n} çizgi',
  },
  grid: '{cols}×{rows} alan',
  orbsUpTo: '×{x}’e kadar küre',
  stat: {
    one: '{n} çevirme · rekor {best}',
    other: '{n} çevirme · rekor {best}',
  },
  note: 'Madendeki altınların aynısı. Satın alınmaz — sadece kazanılır',
};
