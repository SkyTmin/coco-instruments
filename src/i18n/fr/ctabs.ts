import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Fournitures',
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
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'force {n}/100',
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Fusion : encore 2 {tier} libres',
    fuseGoShort: 'Fusion : 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Encore : briser',
    wornNoShatter: 'Portée — retire-la d’abord',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Emplacement : {cond}',
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
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Encore une fois pour réinitialiser',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'vente',
    dmg: 'minage',
    rate: 'coups',
    loot: 'butin',
    token: 'jetons',
    proc: 'sorts',
    luck: 'clés',
  },
};
