import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Vieille pièce', text: 'Un kopeck de 1799' },
  key: { name: 'Clé de cellule', text: 'Rouillée, mais elle tourne encore' },
  fern: { name: 'Empreinte de fougère', text: 'Carbonifère' },
  ammonite: { name: 'Ammonite', text: 'Une coquille enroulée en spirale' },
  trilobite: { name: 'Trilobite', text: "Un demi-milliard d'années" },
  nugget: { name: 'Pépite', text: 'De l’or pur, sans mélange' },
  tooth: { name: 'Dent de mammouth', text: 'Gardée par le permafrost' },
  geode: { name: 'Géode', text: 'Pierre dehors, améthyste dedans' },
  amber: { name: 'Ambre à mouche', text: "Une mouche figée il y a quarante millions d'années" },
  medal: { name: 'Médaille du tsar', text: '« Pour le zèle »' },
  core: { name: 'Carotte de Kola', text: 'Tirée de douze kilomètres de fond' },
  lamp: { name: 'Lampe du premier mineur', text: 'Elle brûle encore' },
};
