import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Bau 20 Blöcke ab',
    hint: 'Tippe auf einen Block oder halte den Finger drauf — die Spitzhacke schlägt von selbst',
  },
  sell: { title: 'Verkauf die Beute', hint: 'Knopf „{sell}“ beim Rucksack' },
  rankB: { title: 'Hol dir Rang B', hint: 'Spar Münzen und tippe auf die Rangleiste' },
  case: {
    title: 'Öffne eine Truhe',
    hint: 'Knopf „{chests}“. Den Schlüssel gab’s für den Rang',
  },
  steel: {
    title: 'Schmiede die Stein-Spitzhacke',
    hint: 'Auf Ebene C, in der Schmiede: Kalkstein, Sandstein und Münzen',
  },
  enchant: {
    title: 'Wende dein erstes Buch an',
    hint: 'Knopf „{books}“: Der Verzauberer verkauft Bücher gegen Tokens',
  },
  streak: {
    title: 'Bring die Serie auf „Feuer frei“',
    hint: '150 Blöcke ohne Pause — die Leiste „{streak}“',
  },
  bomb: {
    title: 'Zünde eine Bombe',
    hint: 'Tippe auf die Bombe, dann auf ein Feld',
  },
  level: {
    title: 'Spitzhacke auf Level 5 bringen',
    hint: 'Jeder abgebaute Block gibt der Spitzhacke EP',
  },
  rankE: {
    title: 'Hol dir Rang E',
    hint: 'Für den Rang brauchst du eine Spitzhacke, die das Erz der nächsten Ebene schafft',
  },
  bag: { title: 'Rüste den Rucksack auf', hint: 'In der Schmiede, Zeile „{bag}“' },
  rankH: { title: 'Hol dir Rang H', hint: 'Ab jetzt bist du allein: Ränge bis Z, dann Prestige' },
  parcel: {
    title: 'Öffne ein Paket',
    hint: 'Pakete fallen aus Blöcken und reifen am Feld, während du gräbst',
  },
  rune: {
    title: 'Setz eine Rune ins Amulett',
    hint: '„{camp}“ → {runes}. Der erste Sockel öffnet sich auf Spitzhacken-Level 5',
  },
  pet: {
    title: 'Bring ein Haustier auf Level 3',
    hint: 'Das Ei wärmt sich, während du gräbst; geschlüpft wächst es mit der Arbeit',
  },
};
