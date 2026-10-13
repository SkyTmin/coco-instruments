import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Alte Münze', text: 'Eine Kopeke von 1799' },
  key: { name: 'Zellenschlüssel', text: 'Rostig, aber er dreht sich noch' },
  fern: { name: 'Farnabdruck', text: 'Aus dem Karbon' },
  ammonite: { name: 'Ammonit', text: 'Eine spiralförmig gewundene Schale' },
  trilobite: { name: 'Trilobit', text: 'Eine halbe Milliarde Jahre alt' },
  nugget: { name: 'Goldnugget', text: 'Reines Gold ohne Beimischung' },
  tooth: { name: 'Mammutzahn', text: 'Vom Permafrost bewahrt' },
  geode: { name: 'Geode', text: 'Außen Stein, innen Amethyst' },
  amber: { name: 'Bernstein mit Fliege', text: 'Vor vierzig Millionen Jahren erstarrt' },
  medal: { name: 'Zarenmedaille', text: '„Für Fleiß“' },
  core: { name: 'Kola-Bohrkern', text: 'Aus zwölf Kilometern Tiefe' },
  lamp: { name: 'Lampe des ersten Hauers', text: 'Brennt noch immer' },
};
