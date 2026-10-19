import type { Translation } from '../types';
import type { guide as ru } from '../ru/guide';

export const guide: Translation<typeof ru> = {
  mine: {
    title: 'Rompi 20 blocchi',
    hint: 'Tocca un blocco o tieni premuto — il piccone colpisce da solo',
  },
  sell: { title: 'Vendi il bottino', hint: 'Il pulsante con lo zaino sotto il campo' },
  rankB: { title: 'Prendi il grado B', hint: 'Accumula monete e tocca la barra del grado' },
  case: {
    title: 'Apri un forziere',
    hint: 'Pulsante «Forzieri» in basso. Il grado ti ha dato una chiave',
  },
  steel: {
    title: 'Forgia il piccone di pietra',
    hint: 'Al piano C, nella fucina: calcare, arenaria e monete',
  },
  enchant: {
    title: 'Applica il primo libro',
    hint: 'Pulsante «Libri» in basso: l’Incantatore vende libri per gettoni',
  },
  streak: {
    title: 'Porta la serie a «Gasato»',
    hint: '150 blocchi senza pause — la barra sopra il campo',
  },
  bomb: {
    title: 'Fai esplodere una bomba',
    hint: 'Il pulsante della bomba sotto il campo, poi tocca una casella',
  },
  level: {
    title: 'Porta il piccone al livello 5',
    hint: 'Ogni blocco rotto dà esperienza al piccone',
  },
  rankE: {
    title: 'Prendi il grado E',
    hint: 'Per il grado serve un piccone che rompa il minerale del piano successivo',
  },
  bag: { title: 'Potenzia lo zaino', hint: 'Nella fucina, sotto il piccone' },
  rankH: {
    title: 'Prendi il grado H',
    hint: 'Da qui vai da solo: gradi fino alla Z, poi il prestigio',
  },
  parcel: {
    title: 'Apri un pacco',
    hint: 'I pacchi cadono dai blocchi e maturano accanto al campo mentre scavi',
  },
  rune: {
    title: 'Incastona una runa nell’amuleto',
    hint: '«{camp}» → {runes}. Il primo slot si apre al livello 5 del piccone',
  },
  pet: {
    title: 'Porta un animale al livello 3',
    hint: 'L’uovo si scalda mentre scavi; una volta nato, cresce col lavoro',
  },
};
