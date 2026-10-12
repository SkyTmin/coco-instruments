import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Retour',
  close: 'Fermer',
  cancel: 'Annuler',
  ok: 'OK',
  yes: 'Oui',
  no: 'Non',
  on: 'Activé',
  off: 'Désactivé',
  auto: 'Auto',
  soon: 'Bientôt',
  settings: 'Paramètres',
  loading: 'Chargement…',
  level: 'niv. {n}',
  coins: { one: '{n} pièce', many: '{n} de pièces', other: '{n} pièces' },
};
