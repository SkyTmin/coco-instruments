/** Camp tabs on the pixel kit (`src/components/CampTabs.tsx`): shop, runes, finds, achievements, skills. */
export const ctabs = {
  shop: {
    title: 'Расходники',
    hint: 'Купленное — сразу с тобой в шахте',
    /** Tapped a price you can't pay: how many tokens are missing. */
    short: 'Не хватает {v} ✦',
    /** Phones: one effect chip per good instead of the sentence (the sentence is its tip). */
    fx: {
      bomb3: 'Взрыв 3×3',
      bomb5: 'Взрыв 5×5',
      charge: 'Весь ярус',
      energy: 'Кирка ×2 · 1 мин',
      lens: 'Ярус ниже · 90 с',
      prop: 'Порода выше · 10 мин',
    },
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
    /** Phone landscape: the title over the bonus box under the stone. */
    gives: 'Оберег даёт',
    /** A bonus chip at the cap (runes + pets share BONUS_CAP): the reason, in its tip. */
    capTip: 'Потолок {cap} на руны и питомцев вместе: руны дают {raw}, засчитано {eff}',
    /** …the sell chip when all sell bonuses together hit SELL_BONUS_CAP. */
    capSellTip: 'Все надбавки к продаже вместе — не больше +100%: руны дают {raw}, засчитано {eff}',
  },
  finds: {
    title: 'Находки',
    hint: 'Продажа +{pct}% · новая находка +1%',
    unknown: 'Ещё не найдена',
    copies: 'Найдено: {n}',
  },
  miles: {
    hint: 'Выполни — забери награду',
    /** Phone reward chip «+ гнездо» (the full «четвёртое гнездо» is its tip). */
    socket: 'гнездо',
  },
  perks: {
    hint: 'Очки дают престижи — вложи их',
    /** Word under the big number of free points. */
    points: { one: 'очко', few: 'очка', many: 'очков', other: 'очка' },
    prestige: 'престиж {n}',
    per: 'за уровень',
    now: 'Сейчас',
    /** One line of the skill panel: the value now → after «Learn». */
    step: 'Сейчас {now} → {next}',
    learn: 'Изучить',
    noPoints: 'Нет свободных очков — их дают престижи',
    /** The reset ↶ on the points plate is armed by a first tap; this says what the second does. */
    resetArm: 'Ещё раз — сбросить навыки',
    /** Short phone: the ‹ › page buttons of the skills strip (aria-label + mouse tip). */
    prev: 'Предыдущие навыки',
    next: 'Ещё навыки',
    /** «Blat»: the rank a prestige starts from now → after «Learn» (rank letters). */
    blatStep: 'Старт: ранг {now} → {next}',
    blatNow: 'Старт: ранг {now}',
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
