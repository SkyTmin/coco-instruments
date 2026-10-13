import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Eski sikke', text: '1799 tarihli bir kopek' },
  key: { name: 'Hücre anahtarı', text: 'Paslı ama hâlâ dönüyor' },
  fern: { name: 'Eğrelti fosili', text: 'Karbonifer dönemi' },
  ammonite: { name: 'Amonit', text: 'Sarmal kıvrılmış bir kabuk' },
  trilobite: { name: 'Trilobit', text: 'Yarım milyar yaşında' },
  nugget: { name: 'Altın külçesi', text: 'Katıksız saf altın' },
  tooth: { name: 'Mamut dişi', text: 'Donmuş toprak saklamış' },
  geode: { name: 'Jeot', text: 'Dışı taş, içi ametist' },
  amber: { name: 'Sinekli kehribar', text: 'Kırk milyon yıl önce donup kalmış bir sinek' },
  medal: { name: 'Çar madalyası', text: '“Gayretinden dolayı”' },
  core: { name: 'Kola kuyusu karotu', text: 'On iki kilometre derinlikten' },
  lamp: { name: 'İlk madencinin lambası', text: 'Hâlâ yanıyor' },
};
