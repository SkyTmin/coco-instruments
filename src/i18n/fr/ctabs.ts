import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Fournitures',
    hint: 'Tes achats descendent avec toi à la mine',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Il manque {v} ✦',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Explose 3×3',
      bomb5: 'Explose 5×5',
      charge: 'Toute la couche',
      energy: 'Pioche ×2 · 1 min',
      lens: 'Couche du dessous · 90 s',
      prop: 'Roche du dessus · 10 min',
    },
  },
  runes: {
    amulet: 'Amulette',
    amuletHint: 'Place des runes dans les emplacements',
    pouch: 'Bourse',
    pouchHint: 'choisis une rune',
    pick: 'Choisis une rune pour voir ce qu’elle donne',
    /** No runes at all: where they come from (`PARCEL_TABLE`, `CASE_PRIZE`), in the panel. */
    whereFrom: 'Les runes viennent des colis et des coffres',
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
    /** Phone landscape: the title over the bonus box under the stone. */
    gives: 'L’amulette donne',
    /** A bonus chip at the cap (runes + pets share BONUS_CAP): the reason, in its tip. */
    capTip:
      'Plafond {cap} pour runes et familiers ensemble : les runes donnent {raw}, {eff} compte',
    /** …the sell chip when all sell bonuses together hit SELL_BONUS_CAP. */
    capSellTip:
      'Tous les bonus de vente ensemble plafonnent à +100 % : les runes donnent {raw}, {eff} compte',
  },
  finds: {
    title: 'Trouvailles',
    hint: 'Vente +{pct} % · chaque nouvelle +1 %',
    unknown: 'Pas encore trouvée',
    copies: 'Trouvée : {n}',
  },
  miles: {
    hint: 'Accomplis-le — récupère la récompense',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'emplacement',
  },
  perks: {
    hint: 'Le prestige donne des points — dépense-les',
    /** Word under the big number of free points. */
    points: { one: 'point', many: 'de points', other: 'points' },
    prestige: 'prestige {n}',
    per: 'par niveau',
    now: 'Actuel',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Actuel {now} → {next}',
    learn: 'Apprendre',
    noPoints: 'Aucun point libre — le prestige en donne',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Encore une fois pour réinitialiser',
    /** Short phone: the ‹ › page buttons of the skills strip (aria-label + mouse tip). */
    prev: 'Talents précédents',
    next: 'Plus de talents',
    /** «Blat»: the rank a prestige starts from now → after «Learn» (rank letters). */
    blatStep: 'Départ : rang {now} → {next}',
    blatNow: 'Départ : rang {now}',
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
