import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Meteorite',
      lead: 'È caduto in miniera. Spaccalo prima che si raffreddi: dentro c’è contrabbando',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'Un gigante di pietra è uscito dalla roccia. Colpiscilo prima che ci torni',
    },
    convoy: {
      name: 'Convoglio',
      lead: 'Il convoglio vuole un carico di roccia. Sbrigati prima che parta',
    },
    gold: {
      name: 'Vena d’oro',
      lead: 'Ogni blocco vale il triplo',
    },
    payday: {
      name: 'Giorno di paga',
      lead: 'Il compratore paga il doppio per la roccia',
    },
    magpie: {
      name: 'Gazza ladra',
      lead: 'Lascia cadere la refurtiva in miniera. Raccoglila finché c’è',
    },
    blizzard: {
      name: 'Tempesta',
      lead: 'Il vento abbatte il bosco: ogni albero caduto trascina il vicino',
    },
    bear: {
      name: 'Signore della taiga',
      lead: 'Un orso punta alla catasta. Taglia senza sosta e lo scaccerai',
    },
  },
  map: {
    square: 'Piazza',
    forge: 'Fucina',
    mine: 'Miniera',
    zone: 'Miniera speciale',
    lift: 'Montacarichi delle segrete',
    tower: 'Torre dell’Incantatore',
    kennel: 'Allevamento',
    store: 'Magazzino',
    kiosk: 'Chiosco',
    trader: 'Mercante',
    hq: 'Comando',
    club: 'Club',
    barrack1: 'Baracca 1',
  },
  npc: {
    smith: 'Fabbro',
    mage: 'Incantatore',
    foreman: 'Caposquadra',
    guard: 'Guardia',
    liftman: 'Ascensorista',
    keeper: 'Custode',
    clerk: 'Magazziniere',
    trader: 'Mercante',
    seller: 'Commessa',
    chief: 'Direttore',
    orderly: 'Piantone',
    croupier: 'Croupier',
  },
  door: {
    forge: 'Fucina',
    mine: 'Miniera',
    zone: 'Miniera speciale',
    hq: 'Comando',
    kiosk: 'Chiosco',
    tower: 'Torre',
    lift: 'Montacarichi',
    store: 'Magazzino',
    kennel: 'Allevamento',
    trader: 'Mercante',
    barrack1: 'Baracca 1',
    club: 'Club',
    square: 'Esci',
  },
  act: {
    board: 'Bacheca',
    back: 'Uscita',
    prison: 'Scendi',
    zone: 'Entra',
    dungeon: 'Scendi',
    bunk: 'Il mio forziere',
  },
};
