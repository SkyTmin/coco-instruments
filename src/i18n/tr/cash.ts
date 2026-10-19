import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Kasa',
  hintShort: 'Makinenin ödeme oranı değişmez',
  meta: 'altınlar sanal',
  hint: 'Makinenin ödemesi değişmez: spinleri yine dürüst bir rastgele sayı üreteci belirler, kaybetmek de olur. Sadece günlük bonusları beklememenin bir yolu.',
  telegram: 'Telegram bağlantısı',
  linkOk: 'var · {ms} ms',
  linkNo: 'YOK',
  disk: 'Boş disk alanı',
  mb: '{n} MB',
  last: 'Son yedek',
  none: 'hiç yok',
  failed: 'Son çalıştırma başarısız ({stage}): {error}',
  schedule: 'Yedekler her gece 03:30’da alınır ve bota gelir. Hemen almak için: /backup komutu.',
};
