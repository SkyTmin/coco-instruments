/**
 * Fishing (`src/pages/FishingPage.tsx`, `src/components/FishingCamp.tsx`):
 * top bar, hints, mastery, spots, catch card, toasts, rods and trophies tabs.
 */
/** Russian plural: 1 рыба / 3 рыбы / 5 рыб; `other` (fractions) reads like `few`. */
const ru3 = (one: string, few: string, many: string) => ({ one, few, many, other: few });

export const fishing = {
  title: 'Рыбалка',
  titleAt: 'Рыбалка · {spot}',
  fromRank: 'Откроется с ранга {r}',
  /** Hint under the scene by phase. */
  hint: {
    netFull: 'Садок полон — продай',
    idle: 'Держи палец — отпусти, чтобы забросить',
    aim: 'Отпусти!',
    wait: 'Жди — поплавок уйдёт под воду',
    bite: 'Клюёт! Тапни!',
    fight: 'Держи — подматывай. Краснеет — отпусти',
  },
  /** Toasts. */
  say: {
    early: 'Сорвалась — не успел подсечь',
    snap: 'Леска лопнула — сильная рыба. Отпускай, когда краснеет',
    slack: 'Ушла — леска провисла',
    netLost: 'Садок полон — рыбу пришлось отпустить',
    netSold: 'Садок полон — продан сам: +{sum}',
    netFull: 'Садок полон — продай улов или покорми питомца',
    spooked: 'Рано — спугнул. Жди, пока поплавок уйдёт под воду',
    netEmpty: 'Садок пуст — лови',
    noPets: 'Питомцев нет — они вылупляются из яиц',
    noFeed: 'Садок пуст — кормить нечем',
    squad: 'Отряд',
    fed: '{who}: +{xp} опыта',
    fedUp: '{who}: +{xp} опыта · {lvl} уровень',
    onHook: 'Сначала вытащи, что на крючке',
    spotSkill: '{spot} откроется с {n} уровня мастерства',
    spotRank: '{spot} откроется с ранга шахты {r}',
    yours: '{reward} — твоё',
    lost: 'Сгорело. В другой раз повезёт',
  },
  pearlsChip: 'Жемчуг: +0,5% к продаже везде',
  mastery: 'Мастерство {n}',
  masteryBar: 'Мастерство · {a}/{b}',
  master: 'Мастер',
  spots: 'Места',
  spotLv: '{n} ур.',
  spotMine: 'шахта {r}',
  bite: 'Клёв',
  biteHere: 'Клёв здесь',
  biteNow: 'клёв {pct}%',
  /** Catch card. */
  card: {
    toNet: '· в садок',
    newKind: 'Новый вид! +{n}',
    record: 'Рекорд вида!',
    level: 'Мастерство {n}',
    opened: ' · открыто: {spot}',
    pearl: 'Жемчужина!',
    mussel: 'Ракушка',
    pearlsFull: 'Жемчуга хватает — +{n} ✦',
    pearlBonus: '+0,5% к продаже везде',
    empty: 'Пустая',
    box: 'Шкатулка со дна',
    boxText: 'Открой — выбери одно из трёх',
    next: 'Тапни — дальше',
  },
  feedAria: 'Покормить питомца уловом',
  feed: 'Кормить',
  g: '{n} г',
  kg: '{n} кг',
  /** Fish rarity (lower case, «рыба» is feminine in Russian). */
  rarity: {
    common: 'обычная',
    rare: 'редкая',
    epic: 'эпическая',
    legend: 'легенда',
  },
  /** Rods tab of the fisher's camp. */
  rods: {
    reachTop: 'тянет даже тунца и осетра',
    reach: 'по силе — до места «{spot}»',
    now: 'сила {power} · катушка ×{reel} · {reach}',
    best: 'Лучше не бывает',
    next: 'сила {power} → {power2}, катушка ×{reel} → ×{reel2} · {reach}',
    top: 'Золотая удочка вытащит даже осетра',
    net: 'Садок на {n}',
    netNext: ru3('{a} → {n} рыба', '{a} → {n} рыбы', '{a} → {n} рыб'),
    netMax: 'Больше не влезет',
    auto: 'Садок продаёт сам',
    autoText: 'Полный садок сам уходит торговцу — удочку не бросать',
    pearls: 'Жемчуг {n}/{max}',
    pearlsText:
      '+{pct}% к продаже везде — в шахте, в лесу и здесь. Прячется в ракушках пруда, озера и моря',
    stats: 'Поймано рыб: {n} · мастерство {lvl}',
  },
  /** Trophies tab. */
  trophies: {
    kinds: 'видов · первая рыба вида — токены',
    lockSkill: '{n} ур. мастерства',
    lockRank: 'ранг шахты {r}',
  },
} as const;
