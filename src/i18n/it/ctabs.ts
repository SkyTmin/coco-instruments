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
    /** Secondary reset button (full wording stays in camp.perks.reset as its tooltip). */
    reset: 'Azzera',
    free: 'gratis',
  },
};
