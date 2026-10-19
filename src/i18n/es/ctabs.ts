import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Suministros',
    hint: 'Lo que compras baja contigo a la mina',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Faltan {v} ✦',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Vuela 3×3',
      bomb5: 'Vuela 5×5',
      charge: 'Capa entera',
      energy: 'Pico ×2 · 1 min',
      lens: 'Capa de abajo · 90 s',
      prop: 'Roca superior · 10 min',
    },
  },
  runes: {
    amulet: 'Amuleto',
    amuletHint: 'Pon runas en los engastes',
    pouch: 'Bolsa',
    pouchHint: 'elige una runa',
    pick: 'Elige una runa para ver lo que da',
    /** No runes at all: where they come from (`PARCEL_TABLE`, `CASE_PRIZE`), in the panel. */
    whereFrom: 'Las runas salen de paquetes y cofres',
    shatter: 'Romper por fichas',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'fuerza {n}/100',
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Fusión: faltan 2 {tier} libres',
    fuseGoShort: 'Fusión: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Otra vez: romper',
    wornNoShatter: 'Primero sácala del amuleto',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Engaste: {cond}',
    /** Phone landscape: the title over the bonus box under the stone. */
    gives: 'El amuleto da',
    /** A bonus chip at the cap (runes + pets share BONUS_CAP): the reason, in its tip. */
    capTip: 'Tope {cap} para runas y mascotas juntas: las runas dan {raw}, cuenta {eff}',
    /** …the sell chip when all sell bonuses together hit SELL_BONUS_CAP. */
    capSellTip:
      'Todos los bonos de venta juntos topan en +100 %: las runas dan {raw}, cuenta {eff}',
  },
  finds: {
    title: 'Hallazgos',
    hint: 'Venta +{pct} % · cada hallazgo nuevo +1 %',
    unknown: 'Aún sin encontrar',
    copies: 'Encontrado: {n}',
  },
  miles: {
    hint: 'Cúmplelo y reclama el premio',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'engaste',
  },
  perks: {
    hint: 'El prestigio da puntos: gástalos',
    /** Word under the big number of free points. */
    points: { one: 'punto', many: 'de puntos', other: 'puntos' },
    prestige: 'prestigio {n}',
    per: 'por nivel',
    now: 'Ahora',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Ahora {now} → {next}',
    learn: 'Aprender',
    noPoints: 'No hay puntos libres: los da el prestigio',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Toca otra vez para restablecer',
    /** Short phone: the ‹ › page buttons of the skills strip (aria-label + mouse tip). */
    prev: 'Talentos anteriores',
    next: 'Más talentos',
    /** «Blat»: the rank a prestige starts from now → after «Learn» (rank letters). */
    blatStep: 'Inicio: rango {now} → {next}',
    blatNow: 'Inicio: rango {now}',
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
