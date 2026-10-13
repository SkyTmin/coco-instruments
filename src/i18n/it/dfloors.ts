import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: 'Tane dei ratti',
    lead: 'Tane sotto il campo: ratti, uomini-ratto, trappole e la Sala del trono del re.',
    area: {
      mouth: {
        name: 'Ingresso delle miniere',
        lead: 'Vecchie gallerie vicino al montacarichi. Ratti e le prime trappole — guarda dove metti i piedi.',
      },
      haul: {
        name: 'Gallerie rosicchiate',
        lead: 'Tane degli uomini-ratto: tagliole sui sentieri, sciamani alle spalle, la tana del re.',
      },
    },
    boss: {
      name: 'Re dei ratti',
      lead: 'Sala del trono nelle Gallerie rosicchiate',
    },
    mine: {
      pyrite1: "Miniera dell'ingresso",
      pyrite2: 'Miniera profonda',
    },
  },
  f2: {
    name: 'Grotta dei funghi',
    lead: "Una grotta dove tutto cresce e si divora. Più in alto — rovine e l'Armatura vivente.",
    area: {
      f2grot: {
        name: 'Grotta dei funghi',
        lead: 'I funghi camminano, la melma gocciola dalla volta, le radici urlano.',
      },
      f2ruin: {
        name: 'Rovine invase',
        lead: 'Una fortezza che il micelio sta finendo di divorare. Le armature sui supporti — vuote?',
      },
    },
    boss: {
      name: 'Armatura vivente',
      lead: 'Sala del trono delle Rovine invase',
    },
    mine: {
      f2mine1: 'Galleria di calcare',
      f2mine2: 'Pozzo di granito',
    },
  },
  f3: {
    name: 'Abisso sommerso',
    lead: 'Un abisso a strapiombo tra acqua e geodi. Le voci nel buio mentono, e salire carichi ti tira indietro.',
    area: {
      f3rim: {
        name: "Orlo dell'Abisso",
        lead: 'La Grotta turchese e il Grande Strapiombo. Salire carichi è dura.',
      },
      f3depth: {
        name: 'Cenge sommerse',
        lead: "Cascate, Sala dell'Eco e Lago cremisi. Non seguire il richiamo.",
      },
    },
    boss: {
      name: 'Fauci cremisi',
      lead: 'Il Lago cremisi in fondo alle Cenge sommerse',
    },
    mine: {
      f3mine1: 'Galleria di carbone',
      f3mine2: 'Pozzo di rame',
    },
  },
  f4: {
    name: 'Cripta doppia',
    lead: 'Una tomba qualunque… e dietro una seconda sala, quella vera. Un idolo di pietra sul trono e statue che odiano quando non le guardi.',
    area: {
      f4crypt: {
        name: 'Cripta',
        lead: "Tombe e nicchie piene d'ossa. Qui le ossa si rialzano se non le finisci.",
      },
      f4sanct: {
        name: 'Santuario',
        lead: 'La seconda sala. Le statue guardano. Non voltar loro le spalle a lungo.',
      },
    },
    boss: {
      name: 'Idolo di pietra',
      lead: 'Il trono in fondo al santuario',
    },
    mine: {
      f4mine: 'Galleria di ferro',
      f4mine2: 'Vena di cobalto',
    },
  },
  f5: {
    name: 'Labirinto',
    lead: 'Muri vivi, vicoli ciechi e anelli. Dai muri escono mostri, e nel profondo mugghia un toro.',
    area: {
      f5maze: {
        name: 'Labirinto vivente',
        lead: 'I muri respirano. Segui i cartelli.',
      },
      f5arena: {
        name: 'Colosseo',
        lead: 'Una vecchia arena nel cuore del labirinto. Si sente un ruggito.',
      },
    },
    boss: {
      name: 'Minotauro',
      lead: "L'arena nel cuore del Colosseo",
    },
    mine: {
      f5mine1: 'Miniera del labirinto',
      f5mine2: 'Miniera del Colosseo',
    },
  },
  f6: {
    name: 'Faglia di fuoco',
    lead: 'Lava, cenere e ossidiana. Giù dorme il serpente rosso — e ha fame.',
    area: {
      f6: {
        name: 'Gallerie di cenere',
        lead: 'Un campo abbandonato vicino al montacarichi. Il calderone è ancora tiepido.',
      },
      f6lakes: {
        name: 'Laghi di lava',
        lead: "Ponti d'ossidiana sul fuoco liquido. Non stare fermo.",
      },
      f6nest: {
        name: 'Nido del serpente',
        lead: 'Il calore sale dal pavimento. Qui depone le uova.',
      },
    },
    boss: {
      name: 'Serpente rosso',
      lead: "L'arena nel cuore del Nido",
    },
    mine: {
      f6mine: 'Vena di quarzo',
      f6mine2: "Galleria d'argento",
    },
  },
  f7: {
    name: 'Labirinto degli specchi',
    lead: 'Gli specchi ripetono ogni passo. Non tutti i passaggi sono passaggi. In fondo ti aspetti tu stesso.',
    area: {
      f7: {
        name: 'Galleria dei riflessi',
        lead: 'Un palazzo degli specchi abbandonato. Dagli specchi esce qualcosa.',
      },
      f7crystal: {
        name: 'Labirinto di cristallo',
        lead: 'Muri di cristallo. Un passaggio può rivelarsi un riflesso.',
      },
      f7hall: {
        name: 'Sala del Doppio',
        lead: 'In ogni specchio — tu. Uno dei riflessi aspetta.',
      },
    },
    boss: {
      name: "Riflesso dell'eroe",
      lead: "L'arena degli specchi nella Sala del Doppio",
    },
    mine: {
      f7mine1: 'Miniera del vetraio',
      f7mine2: 'Miniera di cristallo',
    },
  },
  f8: {
    name: "Castello dell'Infinito",
    lead: 'Tatami, shoji e un abisso tra i piani. Le stanze si spostano al suono della biwa.',
    area: {
      f8: {
        name: 'Stanze inferiori',
        lead: 'Le porte scorrono da sole. Qualcuno guarda da dietro la carta.',
      },
      f8halls: {
        name: 'Sale mobili',
        lead: 'Vibra una corda — e i muri si muovono. Trova chi suona.',
      },
      f8moon: {
        name: 'Sala della luna',
        lead: "Ponti sull'abisso. Da qualche parte in alto, sette lune.",
      },
    },
    boss: {
      name: 'Demone delle sette lune',
      lead: "L'arena sotto la finestra lunare",
    },
    mine: {
      f8mine: 'Miniera sotto la dispensa',
      f8mine2: "Miniera dell'isola",
    },
  },
  f9: {
    name: "Labirinto dell'idra",
    lead: "Rovine sommerse e cerchi che ti portano al loro gemello. Nella pozza nera, un'idra a cui ricrescono le teste.",
    area: {
      f9: {
        name: 'Rovine sommerse',
        lead: 'La palude ha mangiato la città. I cerchi sul pavimento ti trasportano.',
      },
      f9maze: {
        name: 'Labirinto dei cerchi',
        lead: 'Passaggi che non sono sul pavimento. Guarda il colore del cerchio.',
      },
      f9lair: {
        name: "Tana dell'idra",
        lead: "Una pozza nera. L'acqua sale alle tue spalle.",
      },
    },
    boss: {
      name: 'Idra dalle mille teste',
      lead: 'Il lago nel cuore della tana',
    },
    mine: {
      f9mine: 'Miniera delle rovine',
      f9mine2: 'Miniera dei cerchi',
    },
  },
  f10: {
    name: 'Trono del demone',
    lead: 'Un castello sotto il campo: i Cancelli, le vetrate e il trono. Qui finiscono tutte le discese.',
    area: {
      f10: {
        name: 'Porte degli Inferi',
        lead: "Ossa di eroi ai cancelli. Oltre — un ponte sull'abisso.",
      },
      f10gallery: {
        name: 'Galleria delle vetrate',
        lead: 'Lampi dietro i vetri. Le statue ti seguono con lo sguardo.',
      },
      f10throne: {
        name: 'Sala del trono',
        lead: 'La Via del Corteo. In fondo — il trono e chi vi siede.',
      },
    },
    boss: {
      name: 'Re dei demoni',
      lead: 'La Sala del trono in fondo alla Via del Corteo',
    },
    mine: {
      f10mine: 'Miniera del Cortile delle esecuzioni',
      f10mine2: 'Miniera sotto il trono',
    },
  },
  f11: {
    name: 'Arcipelago celeste',
    lead: 'Isole tra le nuvole. Il vento è padrone: guarda dove volano i nastri.',
    area: {
      f11: {
        name: 'Giardini del vento',
        lead: 'Un giardino sopra le nuvole. Il vento spinge — cammina contro i nastri.',
      },
      f11aqua: {
        name: 'Acquedotto spezzato',
        lead: "L'acqua scorre verso il cielo. Le raffiche sono più forti — resta al centro.",
      },
      f11castle: {
        name: 'Castello sulle nuvole',
        lead: 'Tempesta sulle guglie. I guardiani dormono finché non metti piede nel loro cortile.',
      },
    },
    boss: {
      name: 'Guardiano antico',
      lead: "«Cuore del castello» in cima all'arcipelago",
    },
    mine: {
      f11mine: 'Miniera dei Giardini',
      f11mine2: 'Miniera sotto il Cuore',
    },
  },
  f12: {
    name: 'Notte polare',
    lead: "Il nord sotterraneo: ghiaccio, neve e notte eterna. L'aurora brilla attraverso la volta.",
    area: {
      f12: {
        name: 'Grotta di ghiaccio',
        lead: 'Grotte di ghiaccio azzurro. Si scivola, e fa caldo solo vicino ai bracieri.',
      },
      f12plat: {
        name: 'Lago ghiacciato',
        lead: 'Una distesa liscia fino al buio. Il ghiaccio sottile scricchiola, nei buchi le foche.',
      },
      f12shrine: {
        name: 'Sala della bufera',
        lead: "Un palazzo di ghiaccio sotto l'aurora. Qui nevica perfino sotto il tetto.",
      },
    },
    boss: {
      name: 'Mammut dei ghiacci',
      lead: "La sala sotto l'aurora, ghiaccio ricamato",
    },
    mine: {
      f12mine: 'Scavo di ghiaccio',
      f12mine2: 'Miniera sotto il lago',
    },
  },
  f13: {
    name: 'Teatro delle marionette',
    lead: 'Un teatro delle marionette abbandonato. Lo spettacolo va da solo: le marionette recitano senza attori, e i fili salgono nel buio della graticcia.',
    area: {
      f13: {
        name: 'Foyer',
        lead: 'I lampadari si accendono da soli. Le marionette aspettano la terza chiamata.',
      },
      f13wall: {
        name: 'Platea',
        lead: "Una sala buia. Dove cade l'occhio di bue, ti vedono.",
      },
      f13bell: {
        name: 'Graticcia',
        lead: 'Passerelle, corde e contrappesi sopra il palco. Da qui si tirano i fili.',
      },
    },
    boss: {
      name: 'Burattinaio',
      lead: 'Il grande palco sotto la graticcia',
    },
    mine: {
      f13mine: 'Miniera sotto il salotto',
      f13mine2: 'Miniera del sottopalco',
    },
  },
  f14: {
    name: "Torre dell'orologio",
    lead: 'Il meccanismo di un orologio da torre. Una volta al minuto suona la campana — e il mondo si ferma.',
    area: {
      f14: {
        name: 'Meccanismo',
        lead: 'Ingranaggi, pendoli e pesi. Qui tutto va a tempo.',
      },
      f14sand: {
        name: 'Clessidra',
        lead: "Dentro l'ampolla. Qui la sabbia cade verso l'alto.",
      },
      f14dial: {
        name: 'Quadrante',
        lead: 'Dietro il vetro — la notte. Le lancette scorrono sul pavimento.',
      },
    },
    boss: {
      name: "Signore dell'ora",
      lead: "L'arena-quadrante in cima alla torre",
    },
    mine: {
      f14mine: 'Miniera sotto i pesi',
      f14mine2: 'Miniera nella sabbia',
    },
  },
  f15: {
    name: 'Nucleo delle segrete',
    lead: 'Sul fondo giace una stella caduta. Le segrete sono cresciute attorno a lei — e tendono verso di lei.',
    area: {
      f15: {
        name: 'Radici di cristallo',
        lead: 'Qui la roccia diventa cristallo. Le schegge di stella attirano tutto — anche te.',
      },
      f15gut: {
        name: 'Osservatorio dei costruttori',
        lead: 'I costruttori delle segrete guardavano la stella da qui. Cupole, anelli, mappe del cielo sul pavimento.',
      },
      f15veins: {
        name: 'Cintura delle orbite',
        lead: 'Vuoto attorno al nucleo. I detriti girano in tondo, e lì dentro quasi nulla pesa.',
      },
      f15heart: {
        name: 'Nucleo',
        lead: 'Qui giace la stella caduta. La sua luce ricorda tutti quelli che regnavano sopra.',
      },
    },
    boss: {
      name: 'Signore delle segrete',
      lead: "L'arena della stella caduta oltre la Sala della memoria",
    },
    mine: {
      f15mine: 'Vena di cristallo',
      f15mine2: 'Miniera sotto la cupola',
      f15mine3: 'Frammento di meteorite',
    },
  },
};
