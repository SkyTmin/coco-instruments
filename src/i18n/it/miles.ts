import type { Translation } from '../types';
import type { miles as ru } from '../ru/miles';

export const miles: Translation<typeof ru> = {
  b1k: { title: 'Mille blocchi', text: 'Rompili con le tue mani' },
  b10k: { title: 'Diecimila', text: 'Rompili con le tue mani' },
  b100k: { title: 'Centomila', text: 'Rompili con le tue mani' },
  b1m: { title: 'Un milione', text: 'Rompili con le tue mani' },
  z: { title: 'Prima Z', text: 'Raggiungi l’ultimo grado' },
  p1: { title: 'Prestigio 1', text: 'Inizia la seconda condanna' },
  p5: { title: 'Prestigio 5', text: 'Quinta condanna' },
  p10: { title: 'Prestigio 10', text: 'Quarto slot per le rune' },
  p20: { title: 'Prestigio 20', text: 'Venti condanne' },
  legend: {
    title: 'Leggenda della miniera',
    text: 'Porta la serie fino a «Leggenda della miniera»',
  },
  pets6: { title: 'Sei specie', text: 'Fai schiudere sei animali diversi' },
  hatch50: { title: 'Chioccia', text: 'Cova cinquanta uova' },
  golden: { title: 'Animale d’oro', text: 'Raccogline cinque uguali' },
  zoo: { title: 'Tutto lo zoo', text: 'Raccoglili tutti e 18' },
  cases: { title: 'Cento forzieri', text: 'Aprili con le chiavi' },
  seid: { title: 'Custode dei seid', text: 'Rompi dieci pietre seid' },
  bats: { title: 'Acchiappapipistrelli', text: 'Cattura trenta pipistrelli' },
  parcels: { title: 'Cento pacchi', text: 'Aprili' },
};
