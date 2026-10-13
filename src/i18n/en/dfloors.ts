import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: 'Rat Burrows',
    lead: "Burrows under the camp: rats, ratmen, traps and the king's Throne Room.",
    area: {
      mouth: {
        name: 'Mine Entrance',
        lead: 'Old workings by the lift. Rats and the first traps — watch your step.',
      },
      haul: {
        name: 'Gnawed Tunnels',
        lead: "Ratman burrows: snares on the paths, shamans behind your back, the king's lair.",
      },
    },
    boss: {
      name: 'Rat King',
      lead: 'Throne Room in the Gnawed Tunnels',
    },
    mine: {
      pyrite1: 'Entrance Mine',
      pyrite2: 'Deep Mine',
    },
  },
  f2: {
    name: 'Mushroom Grotto',
    lead: 'A grotto where everything grows and eats everything else. Above — ruins and the Living Armor.',
    area: {
      f2grot: {
        name: 'Mushroom Grotto',
        lead: 'Mushrooms walk, slime drips from the ceiling, roots scream.',
      },
      f2ruin: {
        name: 'Overgrown Ruins',
        lead: 'A fortress the mycelium is eating up. Armor on the stands — empty?',
      },
    },
    boss: {
      name: 'Living Armor',
      lead: 'Throne Room of the Overgrown Ruins',
    },
    mine: {
      f2mine1: 'Limestone Tunnel',
      f2mine2: 'Granite Pit',
    },
  },
  f3: {
    name: 'Flooded Abyss',
    lead: 'A sheer abyss of water and geodes. Voices in the dark lie, and climbing with a load drags you back.',
    area: {
      f3rim: {
        name: 'Abyss Rim',
        lead: 'The Turquoise Grotto and the Great Drop. Going up with a load is hard.',
      },
      f3depth: {
        name: 'Flooded Ledges',
        lead: "Waterfalls, the Echo Hall and the Crimson Lake. Don't follow the call.",
      },
    },
    boss: {
      name: 'Crimson Maw',
      lead: 'The Crimson Lake at the bottom of the Flooded Ledges',
    },
    mine: {
      f3mine1: 'Coal Tunnel',
      f3mine2: 'Copper Pit',
    },
  },
  f4: {
    name: 'Twin Crypt',
    lead: 'An ordinary tomb… and behind it a second, real hall. A stone idol on a throne and statues that hate it when nobody looks at them.',
    area: {
      f4crypt: {
        name: 'Crypt',
        lead: 'Tombs and niches full of bones. Bones get up again here unless you finish them off.',
      },
      f4sanct: {
        name: 'Sanctum',
        lead: "The second hall. The statues are watching. Don't turn your back on them for long.",
      },
    },
    boss: {
      name: 'Stone Idol',
      lead: 'The throne at the end of the sanctum',
    },
    mine: {
      f4mine: 'Iron Tunnel',
      f4mine2: 'Cobalt Vein',
    },
  },
  f5: {
    name: 'Labyrinth',
    lead: 'Living walls, dead ends and loops. Monsters crawl out of the masonry, and deep inside a bull roars.',
    area: {
      f5maze: {
        name: 'Living Maze',
        lead: 'The walls breathe. Follow the signs.',
      },
      f5arena: {
        name: 'Colosseum',
        lead: 'An old arena at the heart of the maze. You can hear roaring.',
      },
    },
    boss: {
      name: 'Minotaur',
      lead: 'The arena at the heart of the Colosseum',
    },
    mine: {
      f5mine1: 'Maze Mine',
      f5mine2: 'Colosseum Mine',
    },
  },
  f6: {
    name: 'Fire Rift',
    lead: "Lava, ash and obsidian. Down below sleeps the red serpent — and he's hungry.",
    area: {
      f6: {
        name: 'Ash Galleries',
        lead: 'An abandoned camp by the lift. The cauldron is still warm.',
      },
      f6lakes: {
        name: 'Lava Lakes',
        lead: "Obsidian bridges over liquid fire. Don't stand still.",
      },
      f6nest: {
        name: "Serpent's Nest",
        lead: 'Heat rises from under the floor. This is where he lays his eggs.',
      },
    },
    boss: {
      name: 'Red Serpent',
      lead: 'The arena at the heart of the Nest',
    },
    mine: {
      f6mine: 'Quartz Vein',
      f6mine2: 'Silver Tunnel',
    },
  },
  f7: {
    name: 'Mirror Maze',
    lead: 'Mirrors repeat every step. Not every passage is a passage. Deep inside, you are waiting for yourself.',
    area: {
      f7: {
        name: 'Gallery of Reflections',
        lead: 'An abandoned mirror palace. Things step out of the mirrors.',
      },
      f7crystal: {
        name: 'Crystal Maze',
        lead: 'Walls of crystal. A passage may turn out to be a reflection.',
      },
      f7hall: {
        name: 'Hall of the Double',
        lead: 'In every mirror — you. One of the reflections is waiting.',
      },
    },
    boss: {
      name: "Hero's Reflection",
      lead: 'The mirror arena in the Hall of the Double',
    },
    mine: {
      f7mine1: "Glazier's Mine",
      f7mine2: 'Crystal Mine',
    },
  },
  f8: {
    name: 'Infinity Castle',
    lead: 'Tatami, shoji and an abyss between floors. Rooms shift to the twang of a biwa.',
    area: {
      f8: {
        name: 'Lower Chambers',
        lead: 'Doors slide on their own. Someone watches from behind the paper.',
      },
      f8halls: {
        name: 'Shifting Halls',
        lead: "A string twangs — and the walls move. Find the one who's playing.",
      },
      f8moon: {
        name: 'Moon Hall',
        lead: 'Bridges over the abyss. Somewhere above are seven moons.',
      },
    },
    boss: {
      name: 'Demon of Seven Moons',
      lead: 'The arena under the moon window',
    },
    mine: {
      f8mine: 'Mine under the Pantry',
      f8mine2: 'Island Mine',
    },
  },
  f9: {
    name: "Hydra's Maze",
    lead: 'Sunken ruins and circles that carry you to their twin. In the black pool lurks a hydra that grows its heads back.',
    area: {
      f9: {
        name: 'Sunken Ruins',
        lead: 'The swamp ate the city. The circles on the floor carry you away.',
      },
      f9maze: {
        name: 'Maze of Circles',
        lead: "Paths that aren't on the floor. Watch the circle's colour.",
      },
      f9lair: {
        name: "Hydra's Lair",
        lead: 'A black pool. The water rises behind your back.',
      },
    },
    boss: {
      name: 'Many-Headed Hydra',
      lead: 'The lake at the heart of the lair',
    },
    mine: {
      f9mine: 'Ruins Mine',
      f9mine2: 'Circles Mine',
    },
  },
  f10: {
    name: 'Demon Throne',
    lead: 'A castle beneath the camp: the Gates, stained glass and the throne. Every descent ends here.',
    area: {
      f10: {
        name: 'Underworld Gates',
        lead: "Heroes' bones at the gates. Beyond — a bridge over the abyss.",
      },
      f10gallery: {
        name: 'Stained Glass Gallery',
        lead: 'Lightning behind the glass. The statues follow you with their eyes.',
      },
      f10throne: {
        name: 'Throne Room',
        lead: 'The Processional Way. At its end — the throne and the one sitting on it.',
      },
    },
    boss: {
      name: 'Demon King',
      lead: 'The Throne Room at the end of the Processional Way',
    },
    mine: {
      f10mine: 'Execution Yard Mine',
      f10mine2: 'Mine under the Throne',
    },
  },
  f11: {
    name: 'Sky Archipelago',
    lead: 'Islands in the clouds. The wind is in charge: watch which way the ribbons fly.',
    area: {
      f11: {
        name: 'Wind Gardens',
        lead: 'A garden above the clouds. The wind pushes — walk against the ribbons.',
      },
      f11aqua: {
        name: 'Broken Aqueduct',
        lead: 'Water flows into the sky. The gusts are stronger — keep to the middle.',
      },
      f11castle: {
        name: 'Cloud Castle',
        lead: 'A storm above the spires. The guardians sleep until you step into their courtyard.',
      },
    },
    boss: {
      name: 'Ancient Guardian',
      lead: '“Heart of the Castle” at the top of the archipelago',
    },
    mine: {
      f11mine: 'Gardens Mine',
      f11mine2: 'Mine under the Heart',
    },
  },
  f12: {
    name: 'Polar Night',
    lead: 'The underground north: ice, snow and endless night. The aurora shines through the vault.',
    area: {
      f12: {
        name: 'Ice Grotto',
        lead: "Caves of blue ice. Slippery, and it's warm only by the braziers.",
      },
      f12plat: {
        name: 'Frozen Lake',
        lead: 'Smooth ice right into the dark. Thin ice cracks, seals in the ice holes.',
      },
      f12shrine: {
        name: 'Blizzard Hall',
        lead: 'An ice palace under the aurora. Here it snows even under a roof.',
      },
    },
    boss: {
      name: 'Glacier Mammoth',
      lead: 'The hall under the aurora, patterned ice',
    },
    mine: {
      f12mine: 'Ice Diggings',
      f12mine2: 'Mine under the Lake',
    },
  },
  f13: {
    name: 'Puppet Theater',
    lead: 'An abandoned puppet theater. The show runs by itself: the puppets play without actors, and the strings vanish into the dark of the fly loft.',
    area: {
      f13: {
        name: 'Foyer',
        lead: 'The chandeliers light themselves. The puppets wait for the third bell.',
      },
      f13wall: {
        name: 'Auditorium',
        lead: "A dark hall. Wherever the spotlight falls — that's where they see you.",
      },
      f13bell: {
        name: 'Fly Loft',
        lead: 'Catwalks, ropes and counterweights above the stage. This is where the strings get pulled.',
      },
    },
    boss: {
      name: 'Puppet Master',
      lead: 'The big stage under the fly loft',
    },
    mine: {
      f13mine: 'Mine under the Lounge',
      f13mine2: 'Mine under the Stage',
    },
  },
  f14: {
    name: 'Clock Tower',
    lead: 'The works of a tower clock. Once a minute the bell strikes — and the world freezes.',
    area: {
      f14: {
        name: 'Clockwork',
        lead: 'Gears, pendulums and weights. Everything here moves to the beat.',
      },
      f14sand: {
        name: 'Hourglass',
        lead: 'Inside the bulb. Here the sand falls upward.',
      },
      f14dial: {
        name: 'Clock Face',
        lead: 'Night behind the glass. The hands sweep across the floor.',
      },
    },
    boss: {
      name: 'Lord of the Hour',
      lead: 'The clock-face arena at the top of the tower',
    },
    mine: {
      f14mine: 'Mine under the Weights',
      f14mine2: 'Mine in the Sand',
    },
  },
  f15: {
    name: 'Dungeon Core',
    lead: 'A fallen star lies at the bottom. The dungeon grew around it — and reaches for it.',
    area: {
      f15: {
        name: 'Crystal Roots',
        lead: 'Rock turns to crystal here. Star shards pull everything toward them — you too.',
      },
      f15gut: {
        name: "Builders' Observatory",
        lead: "The dungeon's builders watched the star from here. Domes, rings, sky charts on the floor.",
      },
      f15veins: {
        name: 'Orbit Belt',
        lead: 'Emptiness around the core. Debris circles round, and inside it almost nothing weighs anything.',
      },
      f15heart: {
        name: 'Core',
        lead: 'The fallen star lies here. Its light remembers everyone who ruled above.',
      },
    },
    boss: {
      name: 'Dungeon Master',
      lead: "The fallen star's arena beyond the Hall of Memory",
    },
    mine: {
      f15mine: 'Crystal Vein',
      f15mine2: 'Mine under the Dome',
      f15mine3: 'Meteorite Fragment',
    },
  },
};
