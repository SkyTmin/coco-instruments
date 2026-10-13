import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Geri',
  close: 'Kapat',
  cancel: 'İptal',
  ok: 'Tamam',
  yes: 'Evet',
  no: 'Hayır',
  on: 'Açık',
  off: 'Kapalı',
  auto: 'Otomatik',
  soon: 'Yakında',
  settings: 'Ayarlar',
  loading: 'Yükleniyor…',
  level: 'Sv. {n}',
  coins: { one: '{n} altın', other: '{n} altın' },
};
