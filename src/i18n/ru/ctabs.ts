/** Camp tabs on the pixel kit (`src/components/CampTabs.tsx`): shop, runes, finds, achievements, skills. */
export const ctabs = {
  shop: {
    title: 'Расходники',
    hint: 'Купленное — сразу с тобой в шахте',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Не хватает {v} ✦',
  },
  runes: {
    amulet: 'Оберег',
    amuletHint: 'Вставь руны в гнёзда',
    pouch: 'Мешочек',
    pouchHint: 'выбери руну',
    pick: 'Выбери руну — тут будет, что она даёт',
    shatter: 'Разбить на токены',
    /** Short roll line under the rune name in the inspect panel. */
    roll: 'сила {n}/100',
    /** Short phone: the fuse condition / plan in two lines of a 134-px panel. */
    fuseNeedShort: 'Сплав: ещё 2 свободные {tier}',
    fuseGoShort: 'Сплав: 2× {tier} → {rune}',
    /** Shatter of a tier III+ rune is armed by a first tap (the button shows what it gives). */
    shatterArm: 'Ещё раз — разбить',
    wornNoShatter: 'Сначала вынь из оберега',
    /** Short phone (no socket captions): a locked socket tapped — its condition. */
    lockedShort: 'Гнездо: {cond}',
  },
  finds: {
    title: 'Находки',
    hint: 'Продажа +{pct}% · новая находка +1%',
    unknown: 'Ещё не найдена',
    copies: 'Найдено: {n}',
  },
  miles: {
    hint: 'Выполни — забери награду',
  },
  perks: {
    hint: 'Очки дают престижи — вложи их',
    /** Word under the big number of free points. */
    points: { one: 'очко', few: 'очка', many: 'очков', other: 'очка' },
    prestige: 'престиж {n}',
    per: 'за уровень',
    now: 'Сейчас',
    next: 'Дальше',
    learn: 'Изучить',
    noPoints: 'Нет свободных очков — их дают престижи',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Ещё раз — сбросить навыки',
  },
  /** Amulet bonus chips (2×2): one short noun after «+7,5%»; the full camp.bonus.* is the tip. */
  bonus: {
    sell: 'продажа',
    dmg: 'копка',
    rate: 'удары',
    loot: 'добыча',
    token: 'токены',
    proc: 'чары',
    luck: 'ключи',
  },
} as const;
