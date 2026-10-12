import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Classico',
    hint: 'Frutta e sette, come a Las Vegas',
    title: 'Slot',
    subtitle: 'Un giochino di fortuna',
  },
  asia: {
    name: 'Drago',
    hint: 'Lanterne rosse, oro e draghi',
    title: 'Porta del Drago',
    subtitle: 'Lanterne, oro e fortuna',
  },
  space: {
    name: 'Spazio',
    hint: 'Pianeti, razzi e alieni',
    title: 'Spazio profondo',
    subtitle: 'Puntate ai confini della galassia',
  },
  pirate: {
    name: 'Pirati',
    hint: 'Ancore, sciabole e un forziere d’oro',
    title: 'Bandiera nera',
    subtitle: 'Il forziere aspetta i coraggiosi',
  },
  egypt: {
    name: 'Egitto',
    hint: 'Scarabei, gatti e la corona del faraone',
    title: 'Oro del Nilo',
    subtitle: 'I tesori dei faraoni',
  },
  candy: {
    name: 'Dolci',
    hint: 'Lecca-lecca, ciambelle e torte',
    title: 'Pasticceria',
    subtitle: 'Gira per i lecca-lecca',
  },
  pumpkin: {
    name: 'Notte delle zucche',
    hint: 'Ragnatele, fantasmi e zucca-lanterna',
    title: 'Notte delle zucche',
    subtitle: 'Dolcetto o scherzetto',
  },
  abyss: {
    name: 'Dagli abissi',
    hint: 'Coralli, meduse e una balena laggiù',
    title: 'Dagli abissi',
    subtitle: 'Dove la luce non arriva',
  },
  neon: {
    name: 'Neon',
    hint: 'Sala giochi notturna: si sblocca al livello 5',
    title: 'Sala Neon',
    subtitle: 'La sala giochi che non chiude mai',
  },
  winter: {
    name: 'Inverno',
    hint: 'Neve, regali e cioccolata calda: si sblocca al livello 9',
    title: 'Notte gelata',
    subtitle: 'Neve, luci e regali',
  },
  olympus: {
    name: 'Olimpo',
    hint: 'Oro degli dèi e fulmini di Zeus: si sblocca al livello 12',
    title: 'Porte dell’Olimpo',
    subtitle: 'Oro degli dèi e fulmini di Zeus',
  },
  kupala: {
    name: 'Notte di mezza estate',
    hint: 'Lucciole e fiore di felce: si sblocca al livello 15',
    title: 'Fiore di felce',
    subtitle: 'Una notte all’anno per trovare il tesoro',
  },
  relic: {
    name: 'Reliquia',
    hint: 'Oro che si trova una volta nella vita',
    title: 'Reliquia',
    subtitle: 'Si prende una volta sola',
  },
};
