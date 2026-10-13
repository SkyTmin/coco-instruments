import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Yarasa — yakala',
  shiny: 'Parıltı — topla',
  from: {
    bat: 'Yarasa sandığı',
    batRare: 'Mavi yarasa sandığı',
    magpie: 'Saksağan kesesi',
    box: 'Dipten gelen kutu',
  },
  offer: {
    coins: 'Altın',
    tokens: 'Jeton',
    key: 'Anahtar',
    keys: 'Anahtarlar',
    rune: 'rün ({text})',
  },
  risk: 'Risk',
  win: 'Bildin! İki katı',
  draw: 'Berabere — bahis aynı',
  take: 'Al',
  double: 'Riske et',
  rule: 'Krupiyenin kartından büyük — iki katı, küçük — yanar',
  dealer: 'Krupiye · {rank}',
  card: 'Kart {n}',
  higher: 'Büyük! {v}',
  lower: 'Küçük — yandı',
  equal: 'Eşit — bir daha',
  pick: 'Daha büyük bir kart seç',
  rank: {
    '9': 'V',
    '10': 'K',
    '11': 'P',
    '12': 'A',
  },
};
