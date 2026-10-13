import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Kasse',
  meta: 'Münzen sind virtuell',
  hint: 'Die Auszahlung des Automaten ändert sich nicht: Die Spins bestimmt weiter ein fairer Zufallsgenerator, verlieren kann man also auch. Es spart nur das Warten auf Tagesboni.',
  telegram: 'Verbindung zu Telegram',
  linkOk: 'da · {ms} ms',
  linkNo: 'NEIN',
  disk: 'Freier Speicher',
  mb: '{n} MB',
  last: 'Letztes Backup',
  none: 'noch keins',
  failed: 'Letzter Lauf fehlgeschlagen ({stage}): {error}',
  schedule:
    'Backups entstehen jede Nacht um 03:30 und kommen in den Bot. Sofort eins holen: Befehl /backup.',
};
