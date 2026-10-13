/**
 * The forest screen (`src/pages/ForestPage.tsx`): top bar, grade bar, field
 * floats and toasts, plan sheet, new-grade scene. Shared mine words (camp,
 * coins, parcels, «+ключ», pet level…) come from `mineHud`. Plurals whose
 * Russian forms are all alike keep the old text byte for byte.
 */
const same = (s: string) => ({ one: s, few: s, many: s, other: s });

export const forest = {
  title: 'Лес',
  titleAt: 'Лес · {name}',
  fromRank: 'Откроется с ранга {r}',
  tokensAria: 'Токены — чары топора',
  mine: 'Шахта',
  axe: 'Топор',
  bear: 'Медведь',
  tapSides: 'Тапай слева или справа',
  mill: 'Пилорама',
  petLevel: '{name}, {n} ур.',
  /** «Разряд» — the lumberjack's grade (the forest ladder; the mine has ranks). */
  grade: 'Разряд {n}',
  gradeTop: 'Высший разряд',
  gradeGo: 'Новый разряд — жми!',
  gradeLock: 'шахта',
  m3: '{a}/{b} м³',
  m3Bar: '{a} / {b} м³',
  /** Big floating words over the tree. */
  float: {
    fell: 'БОЙСЯ!',
    branch: 'СУЧОК!',
    dodge: 'УВЕРНУЛСЯ',
    bear: 'ОТОГНАЛ!',
    done: 'ГОТОВО',
    burl: 'КАПОКОРЕНЬ ×10',
    figured: 'СВИЛЬ ×3',
    hollowTokens: 'ДУПЛО: +{n} ✦',
    hollowParcel: 'ДУПЛО: ПЕРЕДАЧКА',
    chaga: 'ЧАГА +{n} ✦',
    keys: same('+{n} ключа'),
    parcel: 'ПЕРЕДАЧКА',
    seid: 'СЕЙД-СОСНА +{n} ✦',
    toMill: '{n} → НА ПИЛОРАМУ',
    /** Axe enchant that went off: {name} is the enchant name in upper case. */
    ench: '{name}!',
    swing: '{name} ×2',
  },
  /** Toasts under the tree. */
  say: {
    planDone: 'План сдан — бери разряд',
    pileFull: 'Штабель полон — сдай лес',
    pileEmpty: 'Штабель пуст — руби',
    storm: same('{name}: ещё {n} брёвен {wood}'),
    plotGate: 'Следующая делянка откроется с ранга шахты {r}',
    parcelLeft: same('Вскроется через {n} брёвен или блоков'),
  },
  /** Grade sheet. */
  plan: {
    take: 'Взять разряд {n}',
    buyout: 'Докупить брёвна · {sum}',
  },
  /** New-grade scene. */
  scene: {
    title: 'Новый разряд',
    wood: '{name} · до {v} за бревно',
    buyout: same('Брёвна докуплены за {n} монет'),
    next: 'Для разряда {n}: {m3} м³ {wood}',
    go: 'Рубить',
  },
} as const;
