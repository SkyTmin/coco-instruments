import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Talpa Minatrice',
    lore: 'Prima a entrare in galleria, ultima a uscire',
  },
  roach: {
    name: 'Scarafaggio Corridore',
    lore: 'Campione delle corse di scarafaggi, numero sette',
  },
  mouse: {
    name: 'Topina Ladruncola',
    lore: 'Quello che è in giro è suo',
  },
  pigeon: {
    name: 'Piccione Postino',
    lore: 'Porta notizie da fuori, a volte buone',
  },
  cat: {
    name: 'Gatto Sfregiato',
    lore: 'Contratta fino all’ultima lisca',
  },
  bulldog: {
    name: 'Bulldog Tirapugni',
    lore: 'Spacca la roccia a testate',
  },
  ferret: {
    name: 'Furetto Galoppino',
    lore: 'Non sta fermo un secondo',
  },
  scarab: {
    name: 'Scarabeo Stercorario',
    lore: 'Fa una palla di tutto ciò che luccica',
  },
  badger: {
    name: 'Tasso Scavatore',
    lore: 'Scava gallerie dritte come un righello',
  },
  owl: {
    name: 'Civetta Lampionaia',
    lore: 'Fa luce dove c’è qualcosa di nascosto',
  },
  raccoon: {
    name: 'Procione Scassinatore',
    lore: 'Apre il minerale come una cassaforte',
  },
  shepherd: {
    name: 'Pastora Fedele',
    lore: 'Prima scortava i detenuti, ora è dei nostri',
  },
  fox: {
    name: 'Volpone Baro',
    lore: 'Sempre un asso dietro l’orecchio',
  },
  spider: {
    name: 'Ragno Grimaldello',
    lore: 'Otto zampe, otto grimaldelli',
  },
  dragon: {
    name: 'Drago di Carbone',
    lore: 'Fonde la pietra in oro',
  },
  wolf: {
    name: 'Lupo Capobranco',
    lore: 'Ha spezzato la catena, ha radunato il branco',
  },
  raven: {
    name: 'Corvo Portachiavi',
    lore: 'Ha le chiavi di ogni porta del campo',
  },
  phoenix: {
    name: 'Fenice della Libertà',
    lore: 'Brucia e rinasce, ogni volta più libera',
  },
};
