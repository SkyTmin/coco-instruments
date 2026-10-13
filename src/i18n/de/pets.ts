import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Kumpel Maulwurf',
    lore: 'Als Erster in den Stollen, als Letzter raus',
  },
  roach: {
    name: 'Renn-Kakerlake',
    lore: 'Champion der Kakerlakenrennen, Startnummer sieben',
  },
  mouse: {
    name: 'Langfinger-Maus',
    lore: 'Was rumliegt, gehört ihr',
  },
  pigeon: {
    name: 'Posttaube',
    lore: 'Bringt Nachrichten von draußen, manchmal gute',
  },
  cat: {
    name: 'Kater Narbe',
    lore: 'Feilscht bis zur letzten Gräte',
  },
  bulldog: {
    name: 'Schlagring-Bulldogge',
    lore: 'Haut Gestein mit der Stirn kaputt',
  },
  ferret: {
    name: 'Kalfaktor-Frettchen',
    lore: 'Keine Sekunde still',
  },
  scarab: {
    name: 'Skarabäus',
    lore: 'Rollt alles, was glänzt, zu einer Kugel',
  },
  badger: {
    name: 'Stollen-Dachs',
    lore: 'Gräbt Stollen wie mit dem Lineal',
  },
  owl: {
    name: 'Laternen-Eule',
    lore: 'Leuchtet dorthin, wo was versteckt ist',
  },
  raccoon: {
    name: 'Panzerknacker-Waschbär',
    lore: 'Knackt Erz wie einen Tresor',
  },
  shepherd: {
    name: 'Treue Schäferhündin',
    lore: 'Früher im Wachdienst, jetzt eine von uns',
  },
  fox: {
    name: 'Zocker-Fuchs',
    lore: 'Immer ein Ass hinterm Ohr',
  },
  spider: {
    name: 'Dietrich-Spinne',
    lore: 'Acht Beine, acht Dietriche',
  },
  dragon: {
    name: 'Kohledrache',
    lore: 'Schmilzt Stein zu Gold',
  },
  wolf: {
    name: 'Leitwolf',
    lore: 'Kette zerrissen, Rudel versammelt',
  },
  raven: {
    name: 'Schließer-Rabe',
    lore: 'Hat die Schlüssel zu jeder Tür im Lager',
  },
  phoenix: {
    name: 'Freiheitsphönix',
    lore: 'Verbrennt und steht wieder auf – jedes Mal freier',
  },
};
