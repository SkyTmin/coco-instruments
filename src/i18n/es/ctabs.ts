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
    /** The fuse button (half a panel wide: German «Verschmelzen» did not fit). */
    fuse: 'Fusionar',
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
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Toca otra vez para restablecer',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'venta',
    dmg: 'picado',
    rate: 'golpes',
    loot: 'botín',
    token: 'fichas',
    proc: 'encantos',
    luck: 'llaves',
  },
};
