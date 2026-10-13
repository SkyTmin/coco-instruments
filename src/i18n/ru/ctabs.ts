/** Camp tabs on the pixel kit (`src/components/CampTabs.tsx`): shop, runes, finds, achievements, skills. */
export const ctabs = {
  shop: {
    title: 'Расходники за токены',
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
  },
} as const;
