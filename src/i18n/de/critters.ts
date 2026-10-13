import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Fledermaus — fang sie',
  shiny: 'Glitzerding — heb es auf',
  from: {
    bat: 'Fledermaus-Truhe',
    batRare: 'Truhe der blauen Fledermaus',
    magpie: 'Elsterbeutel',
    box: 'Kästchen vom Grund',
  },
  offer: {
    coins: 'Münzen',
    tokens: 'Tokens',
    key: 'Schlüssel',
    keys: 'Schlüssel',
    rune: 'Rune {text}',
  },
  risk: 'Risiko',
  win: 'Richtig! Verdoppelt',
  draw: 'Gleichstand — Einsatz bleibt',
  take: 'Nehmen',
  double: 'Riskieren',
  rule: 'Höher als die Karte des Gebers — doppelt, niedriger — verbrannt',
  dealer: 'Geber · {rank}',
  card: 'Karte {n}',
  higher: 'Höher! {v}',
  lower: 'Niedriger — verbrannt',
  equal: 'Gleich — nochmal',
  pick: 'Wähl eine höhere Karte',
  rank: {
    '9': 'B',
    '10': 'D',
    '11': 'K',
    '12': 'A',
  },
};
