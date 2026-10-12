import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Indietro',
  close: 'Chiudi',
  cancel: 'Annulla',
  ok: 'Fatto',
  yes: 'Sì',
  no: 'No',
  on: 'Attivo',
  off: 'Spento',
  auto: 'Auto',
  soon: 'Presto',
  settings: 'Impostazioni',
  loading: 'Caricamento…',
  level: 'Liv. {n}',
  coins: { one: '{n} moneta', many: '{n} di monete', other: '{n} monete' },
};
