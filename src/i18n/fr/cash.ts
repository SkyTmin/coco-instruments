import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Caisse',
  meta: 'pièces virtuelles',
  hint: 'Le gain de la machine ne change pas : les tours sont toujours tirés par un générateur aléatoire honnête, et on peut toujours perdre. C’est juste pour ne pas attendre les bonus quotidiens.',
  telegram: 'Liaison Telegram',
  linkOk: 'ok · {ms} ms',
  linkNo: 'NON',
  disk: 'Espace disque libre',
  mb: '{n} Mo',
  last: 'Dernière sauvegarde',
  none: 'aucune',
  failed: 'Le dernier essai a échoué ({stage}) : {error}',
  schedule:
    'Les sauvegardes sont faites chaque nuit à 03:30 et arrivent dans le bot. Pour en avoir une tout de suite : commande /backup.',
};
