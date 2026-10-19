import type { Translation } from '../types';
import type { ctabs as ru } from '../ru/ctabs';

export const ctabs: Translation<typeof ru> = {
  shop: {
    title: 'Scorte',
    hint: 'Ciò che compri scende con te in miniera',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Mancano {v} ✦',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Esplode 3×3',
      bomb5: 'Esplode 5×5',
      charge: 'Strato intero',
      energy: 'Piccone ×2 · 1 min',
      lens: 'Strato sotto · 90 s',
      prop: 'Roccia superiore · 10 min',
    },
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
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Fusione: servono 2 {tier} libere',
    fuseGoShort: 'Fusione: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Ancora: frantuma',
    wornNoShatter: 'Prima toglila dall’amuleto',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Incastro: {cond}',
  },
  finds: {
    title: 'Reperti',
    hint: 'Vendita +{pct}% · ogni nuovo reperto +1%',
    unknown: 'Non ancora trovato',
    copies: 'Trovati: {n}',
  },
  miles: {
    hint: 'Completalo e riscuoti il premio',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'incastro',
  },
  perks: {
    hint: 'Il prestigio dà punti: spendili',
    /** Word under the big number of free points. */
    points: { one: 'punto', many: 'di punti', other: 'punti' },
    prestige: 'prestigio {n}',
    per: 'per livello',
    now: 'Ora',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Ora {now} → {next}',
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
