import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Scorte',
    hint: 'Ciò che compri scende con te in miniera',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Mancano {v} ✦',
  },
  runes: {
    amulet: 'Amuleto',
    amuletHint: 'Metti le rune negli incastri',
    pouch: 'Sacchetto',
    pouchHint: 'scegli una runa',
    pick: 'Scegli una runa per vedere cosa dà',
    shatter: 'Spezza per gettoni',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'forza {n}/100',
    /** The fuse button (half a panel wide: German «Verschmelzen» did not fit). */
    fuse: 'Fondi',
  },
  finds: {
    title: 'Reperti',
    hint: 'Vendita +{pct}% · ogni nuovo reperto +1%',
    unknown: 'Non ancora trovato',
    copies: 'Trovati: {n}',
  },
  miles: {
    hint: 'Completalo e riscuoti il premio',
  },
  perks: {
    hint: 'Il prestigio dà punti: spendili',
    /** Word under the big number of free points. */
    points: { one: 'punto', many: 'di punti', other: 'punti' },
    prestige: 'prestigio {n}',
    per: 'per livello',
    now: 'Ora',
    next: 'Poi',
    learn: 'Impara',
    noPoints: 'Nessun punto libero: li dà il prestigio',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Tocca ancora per azzerare',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'vendita',
    dmg: 'scavo',
    rate: 'colpi',
    loot: 'bottino',
    token: 'gettoni',
    proc: 'incanti',
    luck: 'chiavi',
  },
};
