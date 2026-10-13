import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Fournitures contre jetons',
    hint: 'Tes achats descendent avec toi à la mine',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Il manque {v} ✦',
  },
  runes: {
    amulet: 'Amulette',
    amuletHint: 'Place des runes dans les emplacements',
    pouch: 'Bourse',
    pouchHint: 'choisis une rune',
    pick: 'Choisis une rune pour voir ce qu’elle donne',
    shatter: 'Briser contre des jetons',
  },
  finds: {
    title: 'Trouvailles',
    hint: 'Vente +{pct} % · chaque nouvelle +1 %',
    unknown: 'Pas encore trouvée',
    copies: 'Trouvée : {n}',
  },
  miles: {
    hint: 'Accomplis-le — récupère la récompense',
  },
  perks: {
    hint: 'Le prestige donne des points — dépense-les',
    /** Word under the big number of free points. */
    points: { one: 'point', many: 'de points', other: 'points' },
    prestige: 'prestige {n}',
    per: 'par niveau',
    now: 'Actuel',
    next: 'Suivant',
    learn: 'Apprendre',
    noPoints: 'Aucun point libre — le prestige en donne',
  },
};
