import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Suministros',
    hint: 'Lo que compras baja contigo a la mina',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Faltan {v} ✦',
  },
  runes: {
    amulet: 'Amuleto',
    amuletHint: 'Pon runas en los engastes',
    pouch: 'Bolsa',
    pouchHint: 'elige una runa',
    pick: 'Elige una runa para ver lo que da',
    shatter: 'Romper por fichas',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'fuerza {n}/100',
  },
  finds: {
    title: 'Hallazgos',
    hint: 'Venta +{pct} % · cada hallazgo nuevo +1 %',
    unknown: 'Aún sin encontrar',
    copies: 'Encontrado: {n}',
  },
  miles: {
    hint: 'Cúmplelo y reclama el premio',
  },
  perks: {
    hint: 'El prestigio da puntos: gástalos',
    /** Word under the big number of free points. */
    points: { one: 'punto', many: 'de puntos', other: 'puntos' },
    prestige: 'prestigio {n}',
    per: 'por nivel',
    now: 'Ahora',
    next: 'Luego',
    learn: 'Aprender',
    noPoints: 'No hay puntos libres: los da el prestigio',
    /** Secondary reset button (full wording stays in camp.perks.reset as its tooltip). */
    reset: 'Restablecer',
    free: 'gratis',
  },
};
