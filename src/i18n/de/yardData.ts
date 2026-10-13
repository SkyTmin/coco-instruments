import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Meteorit',
      lead: 'In die Mine gestürzt. Zerschlag ihn, bevor er abkühlt — drin ist Schmuggelware',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'Ein Steinriese ist aus dem Fels getreten. Schlag zu, bevor er zurückgeht',
    },
    convoy: {
      name: 'Konvoi',
      lead: 'Der Konvoi braucht eine Ladung Gestein. Beeil dich, bevor er abfährt',
    },
    gold: {
      name: 'Goldader',
      lead: 'Jeder Block zählt dreifach',
    },
    payday: {
      name: 'Zahltag',
      lead: 'Der Aufkäufer zahlt doppelt für Gestein',
    },
    magpie: {
      name: 'Diebische Elster',
      lead: 'Sie lässt Diebesgut in die Mine fallen. Heb es auf, solange es liegt',
    },
    blizzard: {
      name: 'Sturm',
      lead: 'Der Wind fällt den Wald: Jeder gefallene Baum reißt den nächsten mit',
    },
    bear: {
      name: 'Herr der Taiga',
      lead: 'Ein Bär will an den Holzstapel. Hack ohne Pause, dann zieht er ab',
    },
  },
  map: {
    square: 'Platz',
    forge: 'Schmiede',
    mine: 'Mine',
    zone: 'Sondermine',
    lift: 'Aufzug ins Verlies',
    tower: 'Turm des Verzauberers',
    kennel: 'Zucht',
    store: 'Kammer',
    kiosk: 'Kiosk',
    trader: 'Händler',
    hq: 'Zentrale',
    club: 'Club',
    barrack1: 'Baracke 1',
  },
  npc: {
    smith: 'Schmied',
    mage: 'Verzauberer',
    foreman: 'Vorarbeiter',
    guard: 'Wärter',
    liftman: 'Liftführer',
    keeper: 'Pflegerin',
    clerk: 'Kammerwart',
    trader: 'Händler',
    seller: 'Verkäuferin',
    chief: 'Direktor',
    orderly: 'Stubendienst',
    croupier: 'Croupier',
  },
  door: {
    forge: 'Schmiede',
    mine: 'Mine',
    zone: 'Sondermine',
    hq: 'Zentrale',
    kiosk: 'Kiosk',
    tower: 'Turm',
    lift: 'Aufzug',
    store: 'Kammer',
    kennel: 'Zucht',
    trader: 'Händler',
    barrack1: 'Baracke 1',
    club: 'Club',
    square: 'Raus',
  },
  act: {
    board: 'Schwarzes Brett',
    back: 'Ausgang',
    prison: 'Runter',
    zone: 'Rein',
    dungeon: 'Runter',
    bunk: 'Meine Truhe',
  },
};
