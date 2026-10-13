import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Moneta antica', text: 'Un copeco del 1799' },
  key: { name: 'Chiave della cella', text: 'Arrugginita, ma gira ancora' },
  fern: { name: 'Impronta di felce', text: 'Periodo Carbonifero' },
  ammonite: { name: 'Ammonite', text: 'Una conchiglia avvolta a spirale' },
  trilobite: { name: 'Trilobite', text: 'Ha mezzo miliardo di anni' },
  nugget: { name: 'Pepita d’oro', text: 'Oro puro, senza impurità' },
  tooth: { name: 'Dente di mammut', text: 'Conservato dal permafrost' },
  geode: { name: 'Geode', text: 'Fuori pietra, dentro ametista' },
  amber: { name: 'Ambra con mosca', text: 'Una mosca intrappolata quaranta milioni di anni fa' },
  medal: { name: 'Medaglia dello zar', text: '«Per lo zelo»' },
  core: { name: 'Carota di Kola', text: 'Da dodici chilometri di profondità' },
  lamp: { name: 'Lampada del primo minatore', text: 'Brucia ancora' },
};
