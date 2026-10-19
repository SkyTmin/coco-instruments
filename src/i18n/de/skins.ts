import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Klassik',
    hint: 'Früchte und Siebenen – wie in Vegas',
    title: 'Slots',
    subtitle: 'Ein kleines Glücksspiel',
  },
  asia: {
    name: 'Drache',
    hint: 'Rote Laternen, Gold und Drachen',
    title: 'Drachentor',
    subtitle: 'Laternen, Gold und Glück',
  },
  space: {
    name: 'Weltall',
    hint: 'Planeten, Raketen und Aliens',
    title: 'Tiefes All',
    subtitle: 'Einsätze am Rand der Galaxie',
  },
  pirate: {
    name: 'Piraten',
    hint: 'Anker, Säbel und eine Truhe voll Gold',
    title: 'Schwarze Flagge',
    subtitle: 'Die Truhe wartet auf Mutige',
  },
  egypt: {
    name: 'Ägypten',
    hint: 'Skarabäen, Katzen und die Pharaonenkrone',
    title: 'Gold des Nils',
    subtitle: 'Schätze der Pharaonen',
  },
  candy: {
    name: 'Süßes',
    hint: 'Lutscher, Donuts und Torten',
    title: 'Zuckerladen',
    subtitle: 'Dreh für Lutscher',
  },
  pumpkin: {
    name: 'Kürbisnacht',
    hint: 'Spinnweben, Gespenster und Kürbislaterne',
    title: 'Kürbisnacht',
    subtitle: 'Süßes oder Saures',
  },
  abyss: {
    name: 'Aus der Tiefe',
    hint: 'Korallen, Quallen und ein Wal tief unten',
    title: 'Aus der Tiefe',
    subtitle: 'Wo kein Licht hinkommt',
  },
  neon: {
    name: 'Neon',
    hint: 'Nachts in der Spielhalle – ab Level 5',
    title: 'Neon-Halle',
    subtitle: 'Die Spielhalle, die nie schließt',
  },
  winter: {
    name: 'Winter',
    hint: 'Schnee, Geschenke und Kakao – ab Level 9',
    title: 'Frostnacht',
    subtitle: 'Schnee, Lichter und Geschenke',
  },
  olympus: {
    name: 'Olymp',
    hint: 'Gold der Götter und Zeus’ Blitze – ab Level 12',
    title: 'Tore des Olymp',
    subtitle: 'Gold der Götter und Zeus’ Blitze',
  },
  kupala: {
    // Soft hyphen: a 320-px phone's skin card is 100 px wide; one word cannot wrap otherwise.
    name: 'Mittsommer\u00adnacht',
    hint: 'Glühwürmchen und Farnblüte – ab Level 15',
    title: 'Farnblüte',
    subtitle: 'Eine Nacht im Jahr, um den Schatz zu finden',
  },
  relic: {
    name: 'Relikt',
    hint: 'Gold, das man einmal im Leben findet',
    title: 'Relikt',
    subtitle: 'Gibt’s nur einmal',
  },
};
