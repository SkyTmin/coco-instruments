import type { Translation } from '../types';
import type { skins as ru } from '../ru/skins';

export const skins: Translation<typeof ru> = {
  classic: {
    name: 'Clásico',
    hint: 'Frutas y sietes, como en Las Vegas',
    title: 'Tragaperras',
    subtitle: 'Un juego de suerte',
  },
  asia: {
    name: 'Dragón',
    hint: 'Farolillos rojos, oro y dragones',
    title: 'Puerta del Dragón',
    subtitle: 'Farolillos, oro y suerte',
  },
  space: {
    name: 'Espacio',
    hint: 'Planetas, cohetes y alienígenas',
    title: 'Espacio profundo',
    subtitle: 'Apuestas al borde de la galaxia',
  },
  pirate: {
    name: 'Piratas',
    hint: 'Anclas, sables y un cofre de oro',
    title: 'Bandera negra',
    subtitle: 'El cofre espera a los valientes',
  },
  egypt: {
    name: 'Egipto',
    hint: 'Escarabajos, gatos y la corona del faraón',
    title: 'Oro del Nilo',
    subtitle: 'Tesoros de los faraones',
  },
  candy: {
    name: 'Dulces',
    hint: 'Piruletas, donuts y tartas',
    title: 'La Dulcería',
    subtitle: 'Gira por piruletas',
  },
  pumpkin: {
    name: 'Noche de calabazas',
    hint: 'Telarañas, fantasmas y una calabaza farol',
    title: 'Noche de calabazas',
    subtitle: 'Truco o trato',
  },
  abyss: {
    name: 'Del abismo',
    hint: 'Corales, medusas y una ballena en lo hondo',
    title: 'Del abismo',
    subtitle: 'Donde no llega la luz',
  },
  neon: {
    name: 'Neón',
    hint: 'Salón recreativo nocturno: se abre en el nivel 5',
    title: 'Salón Neón',
    subtitle: 'El salón que nunca cierra',
  },
  winter: {
    name: 'Invierno',
    hint: 'Nieve, regalos y chocolate: se abre en el nivel 9',
    title: 'Noche helada',
    subtitle: 'Nieve, luces y regalos',
  },
  olympus: {
    name: 'Olimpo',
    hint: 'Oro de los dioses y rayos de Zeus: se abre en el nivel 12',
    title: 'Puertas del Olimpo',
    subtitle: 'Oro de los dioses y rayos de Zeus',
  },
  kupala: {
    name: 'Noche del solsticio',
    hint: 'Luciérnagas y flor de helecho: se abre en el nivel 15',
    title: 'Flor de helecho',
    subtitle: 'Una noche al año para encontrar el tesoro',
  },
  relic: {
    name: 'Reliquia',
    hint: 'Oro que se encuentra una vez en la vida',
    title: 'Reliquia',
    subtitle: 'Solo se coge una vez',
  },
};
