import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: "Rattenbau",
    lead: "Baue unter dem Lager: Ratten, Rattenmenschen, Fallen und der Thronsaal des Königs.",
    area: {
      mouth: {
        name: "Mineneingang",
        lead: "Alte Stollen am Aufzug. Ratten und die ersten Fallen — pass auf, wo du hintrittst.",
      },
      haul: {
        name: "Zernagte Stollen",
        lead: "Baue der Rattenmenschen: Fallen auf den Pfaden, Schamanen im Rücken, die Höhle des Königs.",
      },
    },
    boss: {
      name: "Rattenkönig",
      lead: "Thronsaal in den Zernagten Stollen",
    },
    mine: {
      pyrite1: "Mine am Eingang",
      pyrite2: "Tiefe Mine",
    },
  },
  f2: {
    name: "Pilzgrotte",
    lead: "Eine Grotte, in der alles wächst und sich gegenseitig frisst. Darüber — Ruinen und die Lebende Rüstung.",
    area: {
      f2grot: {
        name: "Pilzgrotte",
        lead: "Pilze laufen, Schleim tropft von der Decke, Wurzeln schreien.",
      },
      f2ruin: {
        name: "Überwucherte Ruinen",
        lead: "Eine Festung, die das Myzel auffrisst. Rüstungen auf den Ständern — leer?",
      },
    },
    boss: {
      name: "Lebende Rüstung",
      lead: "Thronsaal der Überwucherten Ruinen",
    },
    mine: {
      f2mine1: "Kalkstollen",
      f2mine2: "Granitgrube",
    },
  },
  f3: {
    name: "Versunkener Abgrund",
    lead: "Ein senkrechter Abgrund aus Wasser und Drusen. Stimmen im Dunkeln lügen, und der Aufstieg mit Last zieht zurück.",
    area: {
      f3rim: {
        name: "Rand des Abgrunds",
        lead: "Türkisgrotte und Großer Absturz. Mit Last nach oben — schwer.",
      },
      f3depth: {
        name: "Versunkene Simse",
        lead: "Wasserfälle, Echohalle und Purpursee. Folge nicht dem Ruf.",
      },
    },
    boss: {
      name: "Purpurschlund",
      lead: "Der Purpursee am Grund der Versunkenen Simse",
    },
    mine: {
      f3mine1: "Kohlestollen",
      f3mine2: "Kupfergrube",
    },
  },
  f4: {
    name: "Doppelgruft",
    lead: "Eine gewöhnliche Gruft… und dahinter eine zweite, die echte Halle. Ein Steinidol auf dem Thron und Statuen, die es hassen, wenn man sie nicht ansieht.",
    area: {
      f4crypt: {
        name: "Gruft",
        lead: "Grabkammern und Nischen voller Knochen. Hier stehen Knochen wieder auf, wenn man sie nicht erledigt.",
      },
      f4sanct: {
        name: "Inneres Gewölbe",
        lead: "Die zweite Halle. Die Statuen schauen. Dreh ihnen nicht lange den Rücken zu.",
      },
    },
    boss: {
      name: "Steinidol",
      lead: "Der Thron am Ende des Gewölbes",
    },
    mine: {
      f4mine: "Eisenstollen",
      f4mine2: "Kobaltader",
    },
  },
  f5: {
    name: "Labyrinth",
    lead: "Lebende Wände, Sackgassen und Schleifen. Aus dem Mauerwerk kommen Ungeheuer, in der Tiefe brüllt ein Stier.",
    area: {
      f5maze: {
        name: "Lebendes Labyrinth",
        lead: "Die Wände atmen. Halte dich an die Schilder.",
      },
      f5arena: {
        name: "Kolosseum",
        lead: "Eine alte Arena im Herzen des Labyrinths. Man hört Gebrüll.",
      },
    },
    boss: {
      name: "Minotaurus",
      lead: "Die Arena im Herzen des Kolosseums",
    },
    mine: {
      f5mine1: "Labyrinthmine",
      f5mine2: "Mine am Kolosseum",
    },
  },
  f6: {
    name: "Feuerriss",
    lead: "Lava, Asche und Obsidian. Unten schläft der rote Lindwurm — und er hat Hunger.",
    area: {
      f6: {
        name: "Aschegalerien",
        lead: "Ein verlassenes Lager am Aufzug. Der Kessel ist noch warm.",
      },
      f6lakes: {
        name: "Lavaseen",
        lead: "Obsidianbrücken über flüssigem Feuer. Bleib nicht stehen.",
      },
      f6nest: {
        name: "Nest des Lindwurms",
        lead: "Hitze steigt aus dem Boden. Hier legt er seine Eier.",
      },
    },
    boss: {
      name: "Roter Lindwurm",
      lead: "Die Arena im Herzen des Nests",
    },
    mine: {
      f6mine: "Quarzader",
      f6mine2: "Silberstollen",
    },
  },
  f7: {
    name: "Spiegellabyrinth",
    lead: "Spiegel wiederholen jeden Schritt. Nicht jeder Gang ist ein Gang. In der Tiefe wartest du selbst auf dich.",
    area: {
      f7: {
        name: "Galerie der Spiegelbilder",
        lead: "Ein verlassener Spiegelpalast. Aus den Spiegeln steigt etwas.",
      },
      f7crystal: {
        name: "Kristalllabyrinth",
        lead: "Wände aus Kristall. Ein Gang kann sich als Spiegelbild entpuppen.",
      },
      f7hall: {
        name: "Halle des Doppelgängers",
        lead: "In jedem Spiegel — du. Eines der Spiegelbilder wartet.",
      },
    },
    boss: {
      name: "Spiegelbild des Helden",
      lead: "Die Spiegelarena in der Halle des Doppelgängers",
    },
    mine: {
      f7mine1: "Glasermine",
      f7mine2: "Kristallmine",
    },
  },
  f8: {
    name: "Unendlichkeitsfestung",
    lead: "Tatami, Shoji und ein Abgrund zwischen den Ebenen. Die Räume verschieben sich zum Klang der Biwa.",
    area: {
      f8: {
        name: "Untere Gemächer",
        lead: "Türen gleiten von selbst. Hinter dem Papier schaut jemand.",
      },
      f8halls: {
        name: "Wandernde Hallen",
        lead: "Eine Saite klingt — und die Wände fahren. Finde den, der spielt.",
      },
      f8moon: {
        name: "Mondhalle",
        lead: "Brücken über dem Abgrund. Irgendwo oben sieben Monde.",
      },
    },
    boss: {
      name: "Dämon der sieben Monde",
      lead: "Die Arena unter dem Mondfenster",
    },
    mine: {
      f8mine: "Mine unter der Vorratskammer",
      f8mine2: "Inselmine",
    },
  },
  f9: {
    name: "Labyrinth der Hydra",
    lead: "Versunkene Ruinen und Kreise, die dich zu ihrem Gegenstück tragen. Im schwarzen Tümpel: eine Hydra, der die Köpfe nachwachsen.",
    area: {
      f9: {
        name: "Versunkene Ruinen",
        lead: "Der Sumpf hat die Stadt gefressen. Die Kreise am Boden versetzen dich.",
      },
      f9maze: {
        name: "Kreislabyrinth",
        lead: "Wege, die nicht auf dem Boden sind. Achte auf die Farbe des Kreises.",
      },
      f9lair: {
        name: "Hydrahöhle",
        lead: "Ein schwarzer Tümpel. Das Wasser steigt hinter dir.",
      },
    },
    boss: {
      name: "Vielköpfige Hydra",
      lead: "Der See im Herzen der Höhle",
    },
    mine: {
      f9mine: "Ruinenmine",
      f9mine2: "Kreismine",
    },
  },
  f10: {
    name: "Dämonenthron",
    lead: "Eine Burg unter dem Lager: das Tor, Buntglas und der Thron. Hier enden alle Abstiege.",
    area: {
      f10: {
        name: "Tor zur Unterwelt",
        lead: "Heldenknochen am Tor. Dahinter — eine Brücke über dem Abgrund.",
      },
      f10gallery: {
        name: "Buntglasgalerie",
        lead: "Blitze hinter dem Glas. Die Statuen blicken dir nach.",
      },
      f10throne: {
        name: "Thronsaal",
        lead: "Der Prozessionsweg. An seinem Ende — der Thron und wer darauf sitzt.",
      },
    },
    boss: {
      name: "Dämonenkönig",
      lead: "Der Thronsaal am Ende des Prozessionswegs",
    },
    mine: {
      f10mine: "Mine am Richthof",
      f10mine2: "Mine unter dem Thron",
    },
  },
  f11: {
    name: "Himmelsarchipel",
    lead: "Inseln in den Wolken. Der Wind ist der Herr: Achte, wohin die Bänder wehen.",
    area: {
      f11: {
        name: "Windgärten",
        lead: "Ein Garten über den Wolken. Der Wind drückt — geh gegen die Bänder.",
      },
      f11aqua: {
        name: "Zerbrochenes Aquädukt",
        lead: "Wasser fließt in den Himmel. Die Böen sind stärker — bleib in der Mitte.",
      },
      f11castle: {
        name: "Wolkenburg",
        lead: "Sturm über den Türmen. Die Wächter schlafen, bis du ihren Hof betrittst.",
      },
    },
    boss: {
      name: "Uralter Wächter",
      lead: "„Herz der Burg“ auf dem Gipfel des Archipels",
    },
    mine: {
      f11mine: "Gartenmine",
      f11mine2: "Mine unter dem Herzen",
    },
  },
  f12: {
    name: "Polarnacht",
    lead: "Der Norden unter Tage: Eis, Schnee und ewige Nacht. Durch das Gewölbe scheint das Polarlicht.",
    area: {
      f12: {
        name: "Eisgrotte",
        lead: "Höhlen aus blauem Eis. Glatt, und warm ist es nur an den Feuerschalen.",
      },
      f12plat: {
        name: "Gefrorener See",
        lead: "Spiegelglatt bis in die Dunkelheit. Dünnes Eis knackt, in den Eislöchern Robben.",
      },
      f12shrine: {
        name: "Halle des Schneesturms",
        lead: "Ein Eispalast unter dem Polarlicht. Hier stöbert es sogar unter dem Dach.",
      },
    },
    boss: {
      name: "Gletschermammut",
      lead: "Die Halle unter dem Polarlicht, Eis mit Muster",
    },
    mine: {
      f12mine: "Eisgrube",
      f12mine2: "Mine unter dem See",
    },
  },
  f13: {
    name: "Marionettentheater",
    lead: "Ein verlassenes Puppentheater. Das Stück läuft von selbst: Die Puppen spielen ohne Schauspieler, und die Fäden verschwinden im Dunkel des Schnürbodens.",
    area: {
      f13: {
        name: "Foyer",
        lead: "Die Kronleuchter brennen von selbst. Die Puppen warten aufs dritte Klingeln.",
      },
      f13wall: {
        name: "Zuschauerraum",
        lead: "Ein dunkler Saal. Wo der Scheinwerfer hinfällt — da sieht man dich.",
      },
      f13bell: {
        name: "Schnürboden",
        lead: "Stege, Seile und Gegengewichte über der Bühne. Von hier zieht man die Fäden.",
      },
    },
    boss: {
      name: "Puppenspieler",
      lead: "Die große Bühne unter dem Schnürboden",
    },
    mine: {
      f13mine: "Mine unter dem Salon",
      f13mine2: "Mine in der Unterbühne",
    },
  },
  f14: {
    name: "Uhrturm",
    lead: "Das Uhrwerk einer Turmuhr. Einmal pro Minute schlägt die Glocke — und die Welt erstarrt.",
    area: {
      f14: {
        name: "Uhrwerk",
        lead: "Zahnräder, Pendel und Gewichte. Hier geht alles im Takt.",
      },
      f14sand: {
        name: "Sanduhr",
        lead: "Im Glaskolben. Hier rieselt der Sand nach oben.",
      },
      f14dial: {
        name: "Zifferblatt",
        lead: "Hinter dem Glas — Nacht. Die Zeiger laufen über den Boden.",
      },
    },
    boss: {
      name: "Herr der Stunde",
      lead: "Die Zifferblatt-Arena auf der Turmspitze",
    },
    mine: {
      f14mine: "Mine unter den Gewichten",
      f14mine2: "Mine im Sand",
    },
  },
  f15: {
    name: "Kern des Verlieses",
    lead: "Am Grund liegt ein gefallener Stern. Das Verlies ist um ihn gewachsen — und streckt sich nach ihm.",
    area: {
      f15: {
        name: "Kristallwurzeln",
        lead: "Gestein wird hier zu Kristall. Sternsplitter ziehen alles an — auch dich.",
      },
      f15gut: {
        name: "Sternwarte der Erbauer",
        lead: "Die Erbauer des Verlieses sahen von hier auf den Stern. Kuppeln, Ringe, Himmelskarten am Boden.",
      },
      f15veins: {
        name: "Orbitgürtel",
        lead: "Leere um den Kern. Trümmer ziehen ihre Kreise, und darin wiegt fast nichts etwas.",
      },
      f15heart: {
        name: "Kern",
        lead: "Hier liegt der gefallene Stern. Sein Licht erinnert sich an alle, die oben herrschten.",
      },
    },
    boss: {
      name: "Herr des Verlieses",
      lead: "Die Arena des gefallenen Sterns hinter der Halle der Erinnerung",
    },
    mine: {
      f15mine: "Kristallader",
      f15mine2: "Mine unter der Kuppel",
      f15mine3: "Meteoritensplitter",
    },
  },
};
