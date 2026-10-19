import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: '20 blok kır',
    hint: 'Bloğa dokun ya da parmağını basılı tut — kazma kendisi vurur',
  },
  sell: { title: 'Ganimeti sat', hint: 'Çantanın yanındaki “{sell}” düğmesi' },
  rankB: { title: 'B rütbesini al', hint: 'Altın biriktir ve rütbe çubuğuna dokun' },
  case: {
    title: 'Bir sandık aç',
    hint: '“{chests}” düğmesi. Rütbe sana bir anahtar verdi',
  },
  steel: { title: 'Taş kazmayı döv', hint: 'C katında, demirhanede: kireçtaşı, kumtaşı ve altın' },
  enchant: {
    title: 'İlk kitabını uygula',
    hint: '“{books}” düğmesi: Büyücü kitapları jetonla satar',
  },
  streak: {
    title: 'Seriyi “Gaza geldi”ye çıkar',
    hint: 'Ara vermeden 150 blok — “{streak}” çubuğu',
  },
  bomb: {
    title: 'Bir bomba patlat',
    hint: 'Bombaya, sonra bir kareye dokun',
  },
  level: { title: 'Kazmanı 5. seviyeye çıkar', hint: 'Kırdığın her blok kazmaya XP verir' },
  rankE: {
    title: 'E rütbesini al',
    hint: 'Rütbe için sonraki katın cevherini kıran bir kazma gerekir',
  },
  bag: { title: 'Çantanı geliştir', hint: 'Demirhanede, “{bag}” satırı' },
  rankH: { title: 'H rütbesini al', hint: 'Gerisi sende: Z’ye kadar rütbeler, sonra prestij' },
  parcel: {
    title: 'Bir koli aç',
    hint: 'Koliler bloklardan düşer, sen kazarken alanın yanında olgunlaşır',
  },
  rune: {
    title: 'Muskaya bir rün tak',
    hint: '“{camp}” → {runes}. İlk yuva kazmanın 5. seviyesinde açılır',
  },
  pet: {
    title: 'Bir hayvanı 3. seviyeye çıkar',
    hint: 'Sen kazarken yumurta ısınır; çıkınca çalıştıkça büyür',
  },
};
