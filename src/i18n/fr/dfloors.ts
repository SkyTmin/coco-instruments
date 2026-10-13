import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: "Terriers aux rats",
    lead: "Terriers sous le camp : rats, hommes-rats, pièges et la Salle du trône du roi.",
    area: {
      mouth: {
        name: "Entrée des mines",
        lead: "Vieilles galeries près du monte-charge. Rats et premiers pièges — regarde où tu marches.",
      },
      haul: {
        name: "Galeries rongées",
        lead: "Terriers des hommes-rats : pièges sur les sentiers, chamans en retrait, antre du roi.",
      },
    },
    boss: {
      name: "Roi des rats",
      lead: "Salle du trône des Galeries rongées",
    },
    mine: {
      pyrite1: "Mine de l'entrée",
      pyrite2: "Mine profonde",
    },
  },
  f2: {
    name: "Grotte aux champignons",
    lead: "Une grotte où tout pousse et se dévore. Plus haut — des ruines et l'Armure vivante.",
    area: {
      f2grot: {
        name: "Grotte aux champignons",
        lead: "Les champignons marchent, la bave goutte de la voûte, les racines hurlent.",
      },
      f2ruin: {
        name: "Ruines envahies",
        lead: "Une forteresse que le mycélium achève de dévorer. Les armures sur leurs supports — vides ?",
      },
    },
    boss: {
      name: "Armure vivante",
      lead: "Salle du trône des Ruines envahies",
    },
    mine: {
      f2mine1: "Galerie de calcaire",
      f2mine2: "Puits de granit",
    },
  },
  f3: {
    name: "Abîme englouti",
    lead: "Un abîme à pic, plein d'eau et de géodes. Les voix dans le noir mentent, et remonter chargé te tire en arrière.",
    area: {
      f3rim: {
        name: "Bord de l'Abîme",
        lead: "La Grotte turquoise et la Grande Falaise. Remonter chargé, c'est dur.",
      },
      f3depth: {
        name: "Corniches noyées",
        lead: "Cascades, Salle de l'Écho et Lac écarlate. Ne réponds pas à l'appel.",
      },
    },
    boss: {
      name: "Gueule écarlate",
      lead: "Le Lac écarlate au fond des Corniches noyées",
    },
    mine: {
      f3mine1: "Galerie de charbon",
      f3mine2: "Puits de cuivre",
    },
  },
  f4: {
    name: "Double Crypte",
    lead: "Un caveau ordinaire… et derrière, une seconde salle, la vraie. Une idole de pierre sur un trône et des statues qui détestent qu'on ne les regarde pas.",
    area: {
      f4crypt: {
        name: "Crypte",
        lead: "Caveaux et niches pleines d'os. Ici, les os se relèvent si on ne les achève pas.",
      },
      f4sanct: {
        name: "Sanctuaire",
        lead: "La seconde salle. Les statues regardent. Ne leur tourne pas le dos trop longtemps.",
      },
    },
    boss: {
      name: "Idole de pierre",
      lead: "Le trône au fond du sanctuaire",
    },
    mine: {
      f4mine: "Galerie de fer",
      f4mine2: "Filon de cobalt",
    },
  },
  f5: {
    name: "Labyrinthe",
    lead: "Murs vivants, impasses et boucles. Des monstres sortent de la maçonnerie, et au fond rugit un taureau.",
    area: {
      f5maze: {
        name: "Labyrinthe vivant",
        lead: "Les murs respirent. Suis les panneaux.",
      },
      f5arena: {
        name: "Colisée",
        lead: "Une vieille arène au cœur du labyrinthe. On entend rugir.",
      },
    },
    boss: {
      name: "Minotaure",
      lead: "L'arène au cœur du Colisée",
    },
    mine: {
      f5mine1: "Mine du labyrinthe",
      f5mine2: "Mine du Colisée",
    },
  },
  f6: {
    name: "Faille de feu",
    lead: "Lave, cendre et obsidienne. En bas dort le serpent rouge — et il a faim.",
    area: {
      f6: {
        name: "Galeries de cendre",
        lead: "Un camp abandonné près du monte-charge. Le chaudron est encore tiède.",
      },
      f6lakes: {
        name: "Lacs de lave",
        lead: "Des ponts d'obsidienne au-dessus du feu liquide. Ne reste pas sur place.",
      },
      f6nest: {
        name: "Nid du serpent",
        lead: "La chaleur monte du sol. C'est ici qu'il pond ses œufs.",
      },
    },
    boss: {
      name: "Serpent rouge",
      lead: "L'arène au cœur du Nid",
    },
    mine: {
      f6mine: "Filon de quartz",
      f6mine2: "Galerie d'argent",
    },
  },
  f7: {
    name: "Labyrinthe des miroirs",
    lead: "Les miroirs répètent chaque pas. Tous les passages n'en sont pas. Au fond, c'est toi-même qui t'attends.",
    area: {
      f7: {
        name: "Galerie des reflets",
        lead: "Un palais des glaces abandonné. Des choses sortent des miroirs.",
      },
      f7crystal: {
        name: "Labyrinthe de cristal",
        lead: "Des murs de cristal. Un passage peut n'être qu'un reflet.",
      },
      f7hall: {
        name: "Salle du Double",
        lead: "Dans chaque miroir — toi. L'un des reflets attend.",
      },
    },
    boss: {
      name: "Reflet du héros",
      lead: "L'arène des miroirs dans la Salle du Double",
    },
    mine: {
      f7mine1: "Mine du vitrier",
      f7mine2: "Mine de cristal",
    },
  },
  f8: {
    name: "Château Infini",
    lead: "Tatamis, shōjis et un gouffre entre les étages. Les pièces bougent au son du biwa.",
    area: {
      f8: {
        name: "Appartements du bas",
        lead: "Les portes coulissent toutes seules. Quelqu'un regarde derrière le papier.",
      },
      f8halls: {
        name: "Salles mouvantes",
        lead: "Une corde vibre — et les murs glissent. Trouve qui joue.",
      },
      f8moon: {
        name: "Salle de la lune",
        lead: "Des ponts au-dessus du gouffre. Quelque part en haut, sept lunes.",
      },
    },
    boss: {
      name: "Démon des sept lunes",
      lead: "L'arène sous la fenêtre de lune",
    },
    mine: {
      f8mine: "Mine sous le cellier",
      f8mine2: "Mine de l'île",
    },
  },
  f9: {
    name: "Labyrinthe de l'hydre",
    lead: "Ruines noyées et cercles qui t'envoient vers leur jumeau. Dans l'eau noire, une hydre dont les têtes repoussent.",
    area: {
      f9: {
        name: "Ruines noyées",
        lead: "Le marais a mangé la ville. Les cercles au sol te transportent.",
      },
      f9maze: {
        name: "Labyrinthe des cercles",
        lead: "Des passages qui ne sont pas au sol. Regarde la couleur du cercle.",
      },
      f9lair: {
        name: "Antre de l'hydre",
        lead: "Une eau noire. Elle monte derrière toi.",
      },
    },
    boss: {
      name: "Hydre aux mille têtes",
      lead: "Le lac au cœur de l'antre",
    },
    mine: {
      f9mine: "Mine des ruines",
      f9mine2: "Mine des cercles",
    },
  },
  f10: {
    name: "Trône du démon",
    lead: "Un château sous le camp : les Portes, les vitraux et le trône. Ici s'achèvent toutes les descentes.",
    area: {
      f10: {
        name: "Portes des Abysses",
        lead: "Des os de héros aux portes. Plus loin — un pont sur le gouffre.",
      },
      f10gallery: {
        name: "Galerie des vitraux",
        lead: "Des éclairs derrière les vitres. Les statues te suivent du regard.",
      },
      f10throne: {
        name: "Salle du trône",
        lead: "L'Allée du Cortège. Au bout — le trône et celui qui y siège.",
      },
    },
    boss: {
      name: "Roi démon",
      lead: "La Salle du trône au bout de l'Allée du Cortège",
    },
    mine: {
      f10mine: "Mine de la Cour des exécutions",
      f10mine2: "Mine sous le trône",
    },
  },
  f11: {
    name: "Archipel céleste",
    lead: "Des îles dans les nuages. Le vent est maître : regarde où filent les rubans.",
    area: {
      f11: {
        name: "Jardins du vent",
        lead: "Un jardin au-dessus des nuages. Le vent pousse — marche contre les rubans.",
      },
      f11aqua: {
        name: "Aqueduc brisé",
        lead: "L'eau coule vers le ciel. Les rafales sont plus fortes — reste au milieu.",
      },
      f11castle: {
        name: "Château des nuages",
        lead: "Un orage au-dessus des flèches. Les gardiens dorment tant que tu n'entres pas dans leur cour.",
      },
    },
    boss: {
      name: "Gardien ancien",
      lead: "« Cœur du château » au sommet de l'archipel",
    },
    mine: {
      f11mine: "Mine des Jardins",
      f11mine2: "Mine sous le Cœur",
    },
  },
  f12: {
    name: "Nuit polaire",
    lead: "Le Grand Nord souterrain : glace, neige et nuit éternelle. L'aurore brille à travers la voûte.",
    area: {
      f12: {
        name: "Grotte de glace",
        lead: "Des grottes de glace bleue. Ça glisse, et il ne fait chaud que près des braseros.",
      },
      f12plat: {
        name: "Lac gelé",
        lead: "Une étendue lisse jusqu'au fond du noir. La glace mince craque, des phoques dans les trous.",
      },
      f12shrine: {
        name: "Palais du blizzard",
        lead: "Un palais de glace sous l'aurore. Ici, il neige même sous le toit.",
      },
    },
    boss: {
      name: "Mammouth des glaces",
      lead: "Le palais sous l'aurore, glace ouvragée",
    },
    mine: {
      f12mine: "Chantier de glace",
      f12mine2: "Mine sous le lac",
    },
  },
  f13: {
    name: "Théâtre de marionnettes",
    lead: "Un théâtre de marionnettes abandonné. La pièce se joue seule : les poupées jouent sans acteurs, et les fils montent dans le noir des cintres.",
    area: {
      f13: {
        name: "Foyer",
        lead: "Les lustres s'allument seuls. Les poupées attendent les trois coups.",
      },
      f13wall: {
        name: "Salle",
        lead: "Une salle sombre. Là où tombe le projecteur, on te voit.",
      },
      f13bell: {
        name: "Cintres",
        lead: "Passerelles, cordes et contrepoids au-dessus de la scène. C'est d'ici qu'on tire les fils.",
      },
    },
    boss: {
      name: "Marionnettiste",
      lead: "La grande scène sous les cintres",
    },
    mine: {
      f13mine: "Mine sous le salon",
      f13mine2: "Mine des dessous",
    },
  },
  f14: {
    name: "Tour de l'horloge",
    lead: "Le mécanisme d'une horloge de tour. Une fois par minute, la cloche sonne — et le monde se fige.",
    area: {
      f14: {
        name: "Mécanisme",
        lead: "Engrenages, balanciers et poids. Ici, tout bouge en rythme.",
      },
      f14sand: {
        name: "Sablier",
        lead: "À l'intérieur de l'ampoule. Ici, le sable tombe vers le haut.",
      },
      f14dial: {
        name: "Cadran",
        lead: "Derrière la vitre — la nuit. Les aiguilles avancent sur le sol.",
      },
    },
    boss: {
      name: "Seigneur de l'heure",
      lead: "L'arène-cadran au sommet de la tour",
    },
    mine: {
      f14mine: "Mine sous les poids",
      f14mine2: "Mine dans le sable",
    },
  },
  f15: {
    name: "Cœur du donjon",
    lead: "Une étoile tombée gît au fond. Le donjon a poussé autour d'elle — et tend vers elle.",
    area: {
      f15: {
        name: "Racines de cristal",
        lead: "Ici, la roche devient cristal. Les éclats d'étoile attirent tout — toi aussi.",
      },
      f15gut: {
        name: "Observatoire des bâtisseurs",
        lead: "Les bâtisseurs du donjon observaient l'étoile d'ici. Coupoles, anneaux, cartes du ciel au sol.",
      },
      f15veins: {
        name: "Ceinture d'orbites",
        lead: "Le vide autour du cœur. Les débris tournent en rond, et là-dedans presque rien ne pèse.",
      },
      f15heart: {
        name: "Cœur",
        lead: "Ici gît l'étoile tombée. Sa lumière se souvient de tous ceux qui régnaient plus haut.",
      },
    },
    boss: {
      name: "Maître du donjon",
      lead: "L'arène de l'étoile tombée, derrière la Salle du souvenir",
    },
    mine: {
      f15mine: "Filon de cristal",
      f15mine2: "Mine sous la coupole",
      f15mine3: "Éclat de météorite",
    },
  },
};
