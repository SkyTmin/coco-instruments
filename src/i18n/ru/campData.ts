/** Camp data by id (generated from src/lib: prison HANDLES, pets EGGS, forest AXES/SPECIES/AXE_ENCHANTS/BENCH_ITEMS; finds and achievements are T1's areas finds/miles). «gen» = the wood form after «boards» in each language. */
export const campData = {
  handle: {
    birch: 'Берёзовая рукоять',
    larch: 'Лиственничная рукоять',
    karelian: 'Рукоять из карельской берёзы',
  },
  axe: {
    rusty: 'Ржавый топор',
    carpenter: 'Плотницкий топор',
    feller: 'Лесорубный топор',
    cleaver: 'Колун',
    bowsaw: 'Лучковая пила',
    druzhba: 'Бензопила «Дружба»',
    ural: 'Бензопила «Урал»',
  },
  species: {
    willow: {
      name: 'Ива',
      gen: 'ивы',
    },
    alder: {
      name: 'Ольха',
      gen: 'ольхи',
    },
    aspen: {
      name: 'Осина',
      gen: 'осины',
    },
    birch: {
      name: 'Берёза',
      gen: 'берёзы',
    },
    rowan: {
      name: 'Рябина',
      gen: 'рябины',
    },
    pine: {
      name: 'Сосна',
      gen: 'сосны',
    },
    spruce: {
      name: 'Ель',
      gen: 'ели',
    },
    larch: {
      name: 'Лиственница',
      gen: 'лиственницы',
    },
    juniper: {
      name: 'Можжевельник',
      gen: 'можжевельника',
    },
    karelian: {
      name: 'Карельская берёза',
      gen: 'карельской берёзы',
    },
  },
  axeEnch: {
    chips: {
      name: 'Щепа',
      per: '+4% к шансу лишнего бревна',
    },
    resin: {
      name: 'Живица',
      per: '+20% токенов с брёвен',
    },
    sense: {
      name: 'Чутьё',
      per: '+8% увернуться от сучка, опасный сучок подсвечен',
    },
    swing: {
      name: 'Замах',
      per: '+2% срубить два бревна разом',
    },
    fell: {
      name: 'Валка',
      per: '+0,4% повалить дерево с одного удара',
    },
    storm: {
      name: 'Бурелом',
      per: '+2% падающее дерево валит соседнее',
    },
  },
  bench: {
    box: {
      name: 'Ящик',
      who: 'для рыбзавода',
    },
    stool: {
      name: 'Табурет',
      who: 'в барак',
    },
    skis: {
      name: 'Лыжи',
      who: 'охотнику-промысловику',
    },
    barrel: {
      name: 'Бочка',
      who: 'под засол трески',
    },
    frame: {
      name: 'Оконная рама',
      who: 'в новый дом',
    },
    sled: {
      name: 'Сани-волокуши',
      who: 'оленеводу',
    },
    boat: {
      name: 'Карбас',
      who: 'поморам на Белое море',
    },
  },
} as const;
