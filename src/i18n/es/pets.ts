import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Topo Minero',
    lore: 'El primero en entrar al túnel, el último en salir',
  },
  roach: {
    name: 'Cucaracha Corredora',
    lore: 'Campeona de carreras de cucarachas, dorsal siete',
  },
  mouse: {
    name: 'Ratón Carterista',
    lore: 'Lo que está mal guardado es suyo',
  },
  pigeon: {
    name: 'Paloma Cartera',
    lore: 'Trae noticias de fuera, a veces buenas',
  },
  cat: {
    name: 'Gato Cicatriz',
    lore: 'Regatea hasta la última espina',
  },
  bulldog: {
    name: 'Bulldog Manopla',
    lore: 'Rompe la roca a cabezazos',
  },
  ferret: {
    name: 'Hurón Recadero',
    lore: 'No se está quieto ni un segundo',
  },
  scarab: {
    name: 'Escarabajo Pelotero',
    lore: 'Hace una bola con todo lo que brilla',
  },
  badger: {
    name: 'Tejón Excavador',
    lore: 'Abre túneles rectos como una regla',
  },
  owl: {
    name: 'Búho Farolero',
    lore: 'Alumbra donde hay algo escondido',
  },
  raccoon: {
    name: 'Mapache Revientacajas',
    lore: 'Abre el mineral como una caja fuerte',
  },
  shepherd: {
    name: 'Pastora Fiel',
    lore: 'Antes custodiaba presos, ahora es de los nuestros',
  },
  fox: {
    name: 'Zorro Tahúr',
    lore: 'Siempre un as detrás de la oreja',
  },
  spider: {
    name: 'Araña Ganzúa',
    lore: 'Ocho patas, ocho ganzúas',
  },
  dragon: {
    name: 'Dragón de Carbón',
    lore: 'Funde la piedra en oro',
  },
  wolf: {
    name: 'Lobo Cabecilla',
    lore: 'Rompió la cadena y reunió a la manada',
  },
  raven: {
    name: 'Cuervo Llavero',
    lore: 'Tiene las llaves de todas las puertas del campo',
  },
  phoenix: {
    name: 'Fénix de la Libertad',
    lore: 'Arde y renace, cada vez más libre',
  },
};
