import type { Translation } from '../types';
import type { yardData as ru } from '../ru/yardData';

export const yardData: Translation<typeof ru> = {
  event: {
    meteor: {
      name: 'Météorite',
      lead: 'Elle est tombée dans la mine. Casse-la avant qu’elle refroidisse — dedans, de la contrebande',
    },
    kuiva: {
      name: 'Kuiva',
      lead: 'Un géant de pierre est sorti de la roche. Frappe avant qu’il y retourne',
    },
    convoy: {
      name: 'Convoi',
      lead: 'Le convoi attend un chargement de roche. Fais vite avant son départ',
    },
    gold: {
      name: 'Filon d’or',
      lead: 'Chaque bloc compte triple',
    },
    payday: {
      name: 'Jour de paie',
      lead: 'L’acheteur paie la roche le double',
    },
    magpie: {
      name: 'La Pie voleuse',
      lead: 'Elle lâche son butin volé dans la mine. Ramasse-le tant qu’il traîne',
    },
    blizzard: {
      name: 'Tempête',
      lead: 'Le vent couche la forêt : chaque arbre abattu entraîne son voisin',
    },
    bear: {
      name: 'Maître de la taïga',
      lead: 'Un ours fonce sur la pile de bois. Coupe sans t’arrêter pour le chasser',
    },
  },
  map: {
    square: 'Place',
    forge: 'Forge',
    mine: 'Mine',
    zone: 'Mine spéciale',
    lift: 'Monte-charge du donjon',
    tower: 'Tour de l’Enchanteur',
    kennel: 'Nurserie',
    store: 'Réserve',
    kiosk: 'Kiosque',
    trader: 'Marchand',
    hq: 'QG',
    club: 'Club',
    barrack1: 'Baraque 1',
  },
  npc: {
    smith: 'Forgeron',
    mage: 'Enchanteur',
    foreman: 'Contremaître',
    guard: 'Gardien',
    liftman: 'Liftier',
    keeper: 'Soigneuse',
    clerk: 'Magasinier',
    trader: 'Marchand',
    seller: 'Vendeuse',
    chief: 'Directeur',
    orderly: 'Planton',
    croupier: 'Croupier',
  },
  door: {
    forge: 'Forge',
    mine: 'Mine',
    zone: 'Mine spéciale',
    hq: 'QG',
    kiosk: 'Kiosque',
    tower: 'Tour',
    lift: 'Monte-charge',
    store: 'Réserve',
    kennel: 'Nurserie',
    trader: 'Marchand',
    barrack1: 'Baraque 1',
    club: 'Club',
    square: 'Sortir',
  },
  act: {
    board: 'Tableau',
    back: 'Sortie',
    prison: 'Descendre',
    zone: 'Entrer',
    dungeon: 'Descendre',
    bunk: 'Mon coffre',
  },
};
