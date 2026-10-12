import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Back',
  close: 'Close',
  cancel: 'Cancel',
  ok: 'Done',
  yes: 'Yes',
  no: 'No',
  on: 'On',
  off: 'Off',
  auto: 'Auto',
  soon: 'Soon',
  settings: 'Settings',
  loading: 'Loading…',
  level: 'Lv. {n}',
  coins: { one: '{n} coin', other: '{n} coins' },
};
