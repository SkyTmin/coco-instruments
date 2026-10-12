import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Zurück',
  close: 'Schließen',
  cancel: 'Abbrechen',
  ok: 'Fertig',
  yes: 'Ja',
  no: 'Nein',
  on: 'An',
  off: 'Aus',
  auto: 'Auto',
  soon: 'Bald',
  settings: 'Einstellungen',
  loading: 'Lädt…',
  level: 'Lvl. {n}',
  coins: { one: '{n} Münze', other: '{n} Münzen' },
};
