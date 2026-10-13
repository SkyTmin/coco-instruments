import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Cassa',
  meta: 'monete virtuali',
  hint: 'Il rendimento della macchina non cambia: i giri li decide sempre un generatore casuale onesto, e si può ancora perdere. È solo un modo per non aspettare i bonus giornalieri.',
  telegram: 'Collegamento a Telegram',
  linkOk: 'sì · {ms} ms',
  linkNo: 'NO',
  disk: 'Spazio libero su disco',
  mb: '{n} MB',
  last: 'Ultimo backup',
  none: 'nessuno',
  failed: 'L’ultima esecuzione è fallita ({stage}): {error}',
  schedule:
    'I backup si fanno ogni notte alle 03:30 e arrivano nel bot. Per averne uno subito: comando /backup.',
};
