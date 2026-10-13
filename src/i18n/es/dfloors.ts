import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: 'Madrigueras de ratas',
    lead: 'Madrigueras bajo el campo: ratas, hombres rata, trampas y la Sala del trono del rey.',
    area: {
      mouth: {
        name: 'Entrada a las minas',
        lead: 'Viejas galerías junto al ascensor. Ratas y las primeras trampas: mira dónde pisas.',
      },
      haul: {
        name: 'Galerías roídas',
        lead: 'Madrigueras de los hombres rata: cepos en los caminos, chamanes detrás, la guarida del rey.',
      },
    },
    boss: {
      name: 'Rey Rata',
      lead: 'Sala del trono de las Galerías roídas',
    },
    mine: {
      pyrite1: 'Mina de la entrada',
      pyrite2: 'Mina profunda',
    },
  },
  f2: {
    name: 'Gruta de las setas',
    lead: 'Una gruta donde todo crece y se come entre sí. Más arriba, ruinas y la Armadura viviente.',
    area: {
      f2grot: {
        name: 'Gruta de las setas',
        lead: 'Las setas caminan, el limo gotea del techo, las raíces gritan.',
      },
      f2ruin: {
        name: 'Ruinas cubiertas',
        lead: 'Una fortaleza que el micelio se termina de comer. Las armaduras en sus soportes… ¿vacías?',
      },
    },
    boss: {
      name: 'Armadura viviente',
      lead: 'Sala del trono de las Ruinas cubiertas',
    },
    mine: {
      f2mine1: 'Galería de caliza',
      f2mine2: 'Pozo de granito',
    },
  },
  f3: {
    name: 'Abismo anegado',
    lead: 'Un abismo a pico de agua y geodas. Las voces en la oscuridad mienten, y subir con carga tira hacia atrás.',
    area: {
      f3rim: {
        name: 'Borde del Abismo',
        lead: 'La Gruta turquesa y el Gran Precipicio. Subir con carga cuesta.',
      },
      f3depth: {
        name: 'Cornisas anegadas',
        lead: 'Cascadas, la Sala del Eco y el Lago carmesí. No acudas a la llamada.',
      },
    },
    boss: {
      name: 'Fauces carmesí',
      lead: 'El Lago carmesí al fondo de las Cornisas anegadas',
    },
    mine: {
      f3mine1: 'Galería de carbón',
      f3mine2: 'Pozo de cobre',
    },
  },
  f4: {
    name: 'Cripta doble',
    lead: 'Una tumba corriente… y detrás, una segunda sala, la de verdad. Un ídolo de piedra en el trono y estatuas que odian que no las mires.',
    area: {
      f4crypt: {
        name: 'Cripta',
        lead: 'Tumbas y nichos con huesos. Aquí los huesos se levantan si no los rematas.',
      },
      f4sanct: {
        name: 'Santuario',
        lead: 'La segunda sala. Las estatuas miran. No les des la espalda mucho rato.',
      },
    },
    boss: {
      name: 'Ídolo de piedra',
      lead: 'El trono al fondo del santuario',
    },
    mine: {
      f4mine: 'Galería de hierro',
      f4mine2: 'Veta de cobalto',
    },
  },
  f5: {
    name: 'Laberinto',
    lead: 'Muros vivos, callejones y bucles. De la mampostería salen monstruos y en el fondo ruge un toro.',
    area: {
      f5maze: {
        name: 'Laberinto vivo',
        lead: 'Los muros respiran. Sigue las señales.',
      },
      f5arena: {
        name: 'Coliseo',
        lead: 'Una vieja arena en el corazón del laberinto. Se oye un rugido.',
      },
    },
    boss: {
      name: 'Minotauro',
      lead: 'La arena en el corazón del Coliseo',
    },
    mine: {
      f5mine1: 'Mina del laberinto',
      f5mine2: 'Mina del Coliseo',
    },
  },
  f6: {
    name: 'Grieta de fuego',
    lead: 'Lava, ceniza y obsidiana. Abajo duerme la serpiente roja, y tiene hambre.',
    area: {
      f6: {
        name: 'Galerías de ceniza',
        lead: 'Un campamento abandonado junto al ascensor. El caldero aún está tibio.',
      },
      f6lakes: {
        name: 'Lagos de lava',
        lead: 'Puentes de obsidiana sobre fuego líquido. No te quedes quieto.',
      },
      f6nest: {
        name: 'Nido de la serpiente',
        lead: 'El calor sube del suelo. Aquí pone sus huevos.',
      },
    },
    boss: {
      name: 'Serpiente roja',
      lead: 'La arena en el corazón del Nido',
    },
    mine: {
      f6mine: 'Veta de cuarzo',
      f6mine2: 'Galería de plata',
    },
  },
  f7: {
    name: 'Laberinto de espejos',
    lead: 'Los espejos repiten cada paso. No todo pasillo es un pasillo. En el fondo te esperas a ti mismo.',
    area: {
      f7: {
        name: 'Galería de reflejos',
        lead: 'Un palacio de espejos abandonado. De los espejos salen cosas.',
      },
      f7crystal: {
        name: 'Laberinto de cristal',
        lead: 'Muros de cristal. Un pasillo puede resultar un reflejo.',
      },
      f7hall: {
        name: 'Sala del Doble',
        lead: 'En cada espejo estás tú. Uno de los reflejos espera.',
      },
    },
    boss: {
      name: 'Reflejo del héroe',
      lead: 'La arena de espejos en la Sala del Doble',
    },
    mine: {
      f7mine1: 'Mina del vidriero',
      f7mine2: 'Mina de cristal',
    },
  },
  f8: {
    name: 'Castillo Infinito',
    lead: 'Tatamis, shōjis y un abismo entre pisos. Las salas se mueven al son de la biwa.',
    area: {
      f8: {
        name: 'Aposentos bajos',
        lead: 'Las puertas se deslizan solas. Alguien mira tras el papel.',
      },
      f8halls: {
        name: 'Salas móviles',
        lead: 'Suena una cuerda y los muros se mueven. Encuentra a quien toca.',
      },
      f8moon: {
        name: 'Sala de la luna',
        lead: 'Puentes sobre el abismo. En algún lugar arriba, siete lunas.',
      },
    },
    boss: {
      name: 'Demonio de las siete lunas',
      lead: 'La arena bajo la ventana lunar',
    },
    mine: {
      f8mine: 'Mina bajo la despensa',
      f8mine2: 'Mina de la isla',
    },
  },
  f9: {
    name: 'Laberinto de la hidra',
    lead: 'Ruinas anegadas y círculos que te llevan a su pareja. En la charca negra, una hidra a la que le vuelven a crecer las cabezas.',
    area: {
      f9: {
        name: 'Ruinas sumergidas',
        lead: 'El pantano se comió la ciudad. Los círculos del suelo te transportan.',
      },
      f9maze: {
        name: 'Laberinto de círculos',
        lead: 'Pasos que no están en el suelo. Fíjate en el color del círculo.',
      },
      f9lair: {
        name: 'Guarida de la hidra',
        lead: 'Una charca negra. El agua sube a tu espalda.',
      },
    },
    boss: {
      name: 'Hidra de mil cabezas',
      lead: 'El lago en el corazón de la guarida',
    },
    mine: {
      f9mine: 'Mina de las ruinas',
      f9mine2: 'Mina de los círculos',
    },
  },
  f10: {
    name: 'Trono del demonio',
    lead: 'Un castillo bajo el campo: las Puertas, las vidrieras y el trono. Aquí terminan todos los descensos.',
    area: {
      f10: {
        name: 'Puertas del Inframundo',
        lead: 'Huesos de héroes ante las puertas. Más allá, un puente sobre el abismo.',
      },
      f10gallery: {
        name: 'Galería de vidrieras',
        lead: 'Relámpagos tras los cristales. Las estatuas te siguen con la mirada.',
      },
      f10throne: {
        name: 'Sala del trono',
        lead: 'El Camino del Cortejo. Al final, el trono y quien se sienta en él.',
      },
    },
    boss: {
      name: 'Rey demonio',
      lead: 'La Sala del trono al final del Camino del Cortejo',
    },
    mine: {
      f10mine: 'Mina del Patio de ejecuciones',
      f10mine2: 'Mina bajo el trono',
    },
  },
  f11: {
    name: 'Archipiélago celeste',
    lead: 'Islas entre las nubes. El viento manda: mira hacia dónde vuelan las cintas.',
    area: {
      f11: {
        name: 'Jardines del viento',
        lead: 'Un jardín sobre las nubes. El viento empuja: camina contra las cintas.',
      },
      f11aqua: {
        name: 'Acueducto roto',
        lead: 'El agua fluye hacia el cielo. Las ráfagas son más fuertes: no te salgas del centro.',
      },
      f11castle: {
        name: 'Castillo en las nubes',
        lead: 'Tormenta sobre las agujas. Los guardianes duermen hasta que pisas su patio.',
      },
    },
    boss: {
      name: 'Guardián ancestral',
      lead: '«Corazón del castillo» en la cima del archipiélago',
    },
    mine: {
      f11mine: 'Mina de los Jardines',
      f11mine2: 'Mina bajo el Corazón',
    },
  },
  f12: {
    name: 'Noche polar',
    lead: 'El norte subterráneo: hielo, nieve y noche eterna. La aurora brilla a través de la bóveda.',
    area: {
      f12: {
        name: 'Gruta de hielo',
        lead: 'Cuevas de hielo azul. Resbala, y solo hay calor junto a los braseros.',
      },
      f12plat: {
        name: 'Lago helado',
        lead: 'Una superficie lisa hasta la oscuridad. El hielo fino cruje y hay focas en los agujeros.',
      },
      f12shrine: {
        name: 'Salón de la ventisca',
        lead: 'Un palacio de hielo bajo la aurora. Aquí nieva incluso bajo techo.',
      },
    },
    boss: {
      name: 'Mamut glacial',
      lead: 'El salón bajo la aurora, hielo labrado',
    },
    mine: {
      f12mine: 'Excavación de hielo',
      f12mine2: 'Mina bajo el lago',
    },
  },
  f13: {
    name: 'Teatro de marionetas',
    lead: 'Un teatro de marionetas abandonado. La función sigue sola: los muñecos actúan sin actores y los hilos se pierden en la oscuridad del telar.',
    area: {
      f13: {
        name: 'Vestíbulo',
        lead: 'Las lámparas se encienden solas. Los muñecos esperan el tercer aviso.',
      },
      f13wall: {
        name: 'Patio de butacas',
        lead: 'Una sala oscura. Donde cae el foco, te ven.',
      },
      f13bell: {
        name: 'Telar',
        lead: 'Pasarelas, cuerdas y contrapesos sobre el escenario. Desde aquí se mueven los hilos.',
      },
    },
    boss: {
      name: 'Titiritero',
      lead: 'El gran escenario bajo el telar',
    },
    mine: {
      f13mine: 'Mina bajo el salón',
      f13mine2: 'Mina del foso',
    },
  },
  f14: {
    name: 'Torre del reloj',
    lead: 'El mecanismo de un reloj de torre. Una vez por minuto suena la campana y el mundo se congela.',
    area: {
      f14: {
        name: 'Mecanismo',
        lead: 'Engranajes, péndulos y pesas. Aquí todo va al compás.',
      },
      f14sand: {
        name: 'Reloj de arena',
        lead: 'Dentro de la ampolla. Aquí la arena cae hacia arriba.',
      },
      f14dial: {
        name: 'Esfera',
        lead: 'Tras el cristal, la noche. Las agujas avanzan por el suelo.',
      },
    },
    boss: {
      name: 'Señor de la hora',
      lead: 'La arena-esfera en lo alto de la torre',
    },
    mine: {
      f14mine: 'Mina bajo las pesas',
      f14mine2: 'Mina en la arena',
    },
  },
  f15: {
    name: 'Núcleo de la mazmorra',
    lead: 'En el fondo yace una estrella caída. La mazmorra creció a su alrededor y tiende hacia ella.',
    area: {
      f15: {
        name: 'Raíces de cristal',
        lead: 'Aquí la roca se vuelve cristal. Los fragmentos de estrella lo atraen todo, también a ti.',
      },
      f15gut: {
        name: 'Observatorio de los constructores',
        lead: 'Los constructores de la mazmorra miraban la estrella desde aquí. Cúpulas, anillos, mapas del cielo en el suelo.',
      },
      f15veins: {
        name: 'Cinturón de órbitas',
        lead: 'Vacío alrededor del núcleo. Los escombros giran en círculo y dentro casi nada pesa.',
      },
      f15heart: {
        name: 'Núcleo',
        lead: 'Aquí yace la estrella caída. Su luz recuerda a todos los que reinaron arriba.',
      },
    },
    boss: {
      name: 'Amo de la mazmorra',
      lead: 'La arena de la estrella caída tras la Sala de la memoria',
    },
    mine: {
      f15mine: 'Veta de cristal',
      f15mine2: 'Mina bajo la cúpula',
      f15mine3: 'Fragmento de meteorito',
    },
  },
};
