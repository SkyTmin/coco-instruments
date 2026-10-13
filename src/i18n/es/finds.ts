import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Moneda antigua', text: 'Un kopek de 1799' },
  key: { name: 'Llave de la celda', text: 'Oxidada, pero aún gira' },
  fern: { name: 'Huella de helecho', text: 'Periodo Carbonífero' },
  ammonite: { name: 'Amonites', text: 'Una concha enrollada en espiral' },
  trilobite: { name: 'Trilobites', text: 'Tiene quinientos millones de años' },
  nugget: { name: 'Pepita de oro', text: 'Oro puro, sin mezcla' },
  tooth: { name: 'Diente de mamut', text: 'Lo conservó el permafrost' },
  geode: { name: 'Geoda', text: 'Piedra por fuera, amatista por dentro' },
  amber: { name: 'Ámbar con mosca', text: 'Una mosca atrapada hace cuarenta millones de años' },
  medal: { name: 'Medalla del zar', text: '«Por la diligencia»' },
  core: { name: 'Testigo de Kola', text: 'Sacado de doce kilómetros de profundidad' },
  lamp: { name: 'Lámpara del primer minero', text: 'Sigue encendida' },
};
