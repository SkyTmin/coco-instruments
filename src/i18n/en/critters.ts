import type { Translation } from '../types';
import type { critters as ru } from '../ru/critters';

export const critters: Translation<typeof ru> = {
  bat: 'Bat — catch it',
  shiny: 'Shiny — pick it up',
  from: {
    bat: 'Bat’s chest',
    batRare: 'Blue bat’s chest',
    magpie: 'Magpie’s pouch',
    box: 'Casket from the bottom',
  },
  offer: {
    coins: 'Coins',
    tokens: 'Tokens',
    key: 'Key',
    keys: 'Keys',
    rune: 'rune: {text}',
  },
  risk: 'Risk',
  win: 'Right! Doubled',
  draw: 'Tie — same stake',
  take: 'Take',
  double: 'Risk it',
  rule: 'Beat the dealer’s card — double; lower — it burns',
  dealer: 'Dealer · {rank}',
  card: 'Card {n}',
  higher: 'Higher! {v}',
  lower: 'Lower — burned',
  equal: 'Equal — again',
  pick: 'Pick a higher card',
  rank: {
    '9': 'J',
    '10': 'Q',
    '11': 'K',
    '12': 'A',
  },
};
