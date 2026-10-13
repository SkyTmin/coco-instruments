import type { Translation } from '../types';
import type { hall as ru } from '../ru/hall';

export const hall: Translation<typeof ru> = {
  title: 'Casino',
  cascade: 'Cascade',
  prison: 'Hard Labor',
  wallet: 'Shared wallet',
  play: 'Play',
  reels: {
    one: '{n} reel',
    other: '{n} reels',
  },
  lines: {
    one: '{n} line',
    other: '{n} lines',
  },
  grid: 'Grid {cols}×{rows}',
  orbsUpTo: 'Orbs up to ×{x}',
  stat: {
    one: '{n} spin · best {best}',
    other: '{n} spins · best {best}',
  },
  note: 'Same coins as in the mine. You can’t buy them — only earn them',
};
