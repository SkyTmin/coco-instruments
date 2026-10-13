import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: '20 blok kır',
    hint: 'Bloğa dokun ya da parmağını basılı tut — kazma kendisi vurur',
  },
  sell: { title: 'Ganimeti sat', hint: 'Alanın altındaki çanta düğmesi' },
  rankB: { title: 'B rütbesini al', hint: 'Altın biriktir ve rütbe çubuğuna dokun' },
  case: {
    title: 'Bir sandık aç',
    hint: 'Aşağıdaki “Sandıklar” düğmesi. Rütbe sana bir anahtar verdi',
  },
  steel: { title: 'Taş kazmayı döv', hint: 'C katında, demirhanede: kireçtaşı, kumtaşı ve altın' },
  enchant: {
    title: 'İlk kitabını uygula',
    hint: 'Aşağıdaki “Kitaplar” düğmesi: Büyücü kitapları jetonla satar',
  },
  streak: {
    title: 'Seriyi “Gaza geldi”ye çıkar',
    hint: 'Ara vermeden 150 blok — alanın üstündeki çubuk',
  },
  bomb: {
    title: 'Bir bomba patlat',
    hint: 'Alanın altındaki bomba düğmesi, sonra bir kareye dokun',
  },
  level: { title: 'Kazmanı 5. seviyeye çıkar', hint: 'Kırdığın her blok kazmaya XP verir' },
  rankE: {
    title: 'E rütbesini al',
    hint: 'Rütbe için sonraki katın cevherini kıran bir kazma gerekir',
  },
  bag: { title: 'Çantanı geliştir', hint: 'Demirhanede, kazmanın altında' },
  rankH: { title: 'H rütbesini al', hint: 'Gerisi sende: Z’ye kadar rütbeler, sonra prestij' },
  parcel: {
    title: 'Bir koli aç',
    hint: 'Koliler bloklardan düşer, sen kazarken alanın altında olgunlaşır',
  },
  rune: {
    title: 'Muskaya bir rün tak',
    hint: '“Diğer” → Rünler. İlk yuva kazmanın 5. seviyesinde açılır',
  },
  pet: {
    title: 'Bir hayvanı 3. seviyeye çıkar',
    hint: 'Sen kazarken yumurta ısınır; çıkınca çalıştıkça büyür',
  },
};
