// Этаж 13 — «Театр марионеток». Заброшенный подземный кукольный театр:
// спектакль идёт сам, куклы играют без актёров, а нити уходят вверх, во тьму
// колосников. Кто дёргает нити — не видно.
//
// ═══ ДИЗАЙН-ДОКУМЕНТ ════════════════════════════════════════════════════════
//
// ПАЛИТРА. Бархат занавеса (тёмно-вишнёвый с бликом), золотая лепнина
// (охра → светлое золото), тёплый луч софита и рампы на тёмной сцене (почти
// чёрный сине-фиолетовый пол), крашеный картон декораций (выцветшая зелень
// леса, серо-голубой замок, синее полотняное море). Сказочно, торжественно,
// чуть тревожно — НЕ хоррор: никаких выколотых глаз, крови, слизи, трупов.
// Смерти — рассыпается в опилки и лоскуты, гаснет, ломается, улетает вверх
// на нити. Обводка тёмная, свет сверху-слева, как во всём подземелье.
//
// ГЛАГОЛ — НИТИ И СЦЕНА.
//  * Нити. Марионетки висят на видимых нитях (от плеч и головы вверх, к
//    балке колосников). Каждая нить — отдельная цель: удар мечом по сектору,
//    рывок поперёк нити, мешок противовеса, нота скрипача — режут её.
//    Перерезанная нить — кукла шатается (стан), слабеет; все нити — лёгкая
//    кукла падает и рассыпается, тяжёлая ползёт дальше без нитей, медленно и
//    беззащитно (урон по ней ×1,5). Пока нити целы, кукла бьёт сильнее
//    (×1,25), а нити отдёргивают её от удара (уклон-рывок назад). Видно, куда
//    идёт нить: золотая линия к точке крепления над куклой.
//  * Софиты — свет на ходу (E2). Лучи ходят по сцене в такт (плавно сдвиг →
//    стоят → сдвиг). В луче тебя видят все и бьют сильнее; в тени мобы
//    теряют тебя (дальше ~4 клеток — ищут наугад), удар из тени — крит ×2.
//    Тени-актёры существуют только в луче. Повернуть софит — действие этажа.
//  * Смена декораций «Третий звонок». Звонок, мигает свет, через 2 с едет
//    задник и зал перестраивается `setTile` (картонный лес → замок → море).
//    Линии-предупреждения на полу заранее показывают, где встанут декорации.
//  * Люки. Открываются по такту (`deep`) с подсветкой за 1,2 с; мобов можно
//    уронить в люк, героя люк роняет на край (доля здоровья, `hurtEnv`).
//  * Действия этажа (E8): «Противовес» (мешок с песком падает на врага или
//    на нить), «Повернуть софит», «Лебёдка занавеса» (закрыть проход),
//    «Люк» (открыть под врагом), «Палочка дирижёра» (оркестр замолкает),
//    «Звонок» (сменить декорацию раньше).
//  * Рост по районам: Фойе — нити и куклы; Зал — софиты, свет и тень;
//    Колосники — смена сцены, люки и всё вместе.
//
// РАЙОНЫ (снизу вверх; id прежние, названия новые).
//  1. `f13` «Фойе» — вход с лифтом. Вестибюль с афишами и люстрой: первый
//     рыцарь на нитях и противовес — учат глаголу. Развилка: на запад
//     Гардероб (событие «Гардероб оживает»: с вешалок падают костюмы-куклы,
//     с люстры спускается паук) или на северо-восток Курительная с шахтой
//     `f13mine`. Обе ведут в Буфет — событие «Антракт»: звонок, свет
//     вспыхивает, куклы уходят в боковые двери-кулуары, через ~12 с второй
//     звонок — возвращаются толпой; лебёдки занавеса у дверей отсекают их.
//     Парадная лестница с люстрами, выход наверх. Тайник «Касса» за
//     трещиной, ход — решётка из Лестницы в Гардероб.
//  2. `f13wall` «Зрительный зал». Кулуары, Партер — ряды кресел, проходы.
//     Событие «Премьера»: люстры гаснут, занавес поднимается (`setTile`),
//     три софита ходят по залу в такт, в лучах встают тени-актёры, суфлёр в
//     будке; кончается «Аплодисментами» (свет, хлопки, награда). Развилка:
//     Боковые ложи (софиты на поворот) или Оркестровая яма — событие
//     «Увертюра»: барабанщики бьют кольца на сильную долю, скрипачи режут
//     нотами, люки открываются по очереди; «Палочка» глушит оркестр на ~8 с.
//     Рампа и сцена с будкой суфлёра и люками, кулисы, выход на север.
//     Тайник «Царская ложа», ход — служебный коридор с решёткой.
//  3. `f13bell` «Колосники». Лестница и галерея противовесов, мостки над
//     провалом (сцена далеко внизу). Событие «Третий звонок» на поворотном
//     круге: лес → замок → море каждые ~14 с, линии на полу заранее.
//     Событие «Пожарный занавес» на длинной галерее: железные секции
//     падают волной (полосы с предупреждением) и стоят стеной 2,5 с;
//     противовес клинит секцию. Обход — мостки на западе. Шахта `f13mine2`
//     «Трюм». Тайник «Реквизиторская». Ход — решётка из предбанника арены.
//     Арена — «Большая сцена», ворота с юга, рядом лифт и лестница вниз.
//
// МОНСТРЫ (база = 10-й этаж ×1,3, уровень 9).
//  * Рыцарь-марионетка (2 нити) — рубит конусом, нити отдёргивают; без
//    нитей ползёт. Учит глаголу.
//  * Арлекин — ныряет в люк и выскакивает за спиной (круг за 0,7 с). Только
//    там, где люки.
//  * Суфлёр — сидит в будке, шепчет соседям (урон ×1,3, видно ленточкой),
//    прячется, когда герой рядом. Только у своей будки.
//  * Барабанщик — кольцо-ударная волна на сильную долю. Сидит в яме.
//  * Скрипач — ноты летят дугой и режут (и чужие нити тоже).
//  * Маски Комедии и Трагедии — летают парой, одна лечит другую; убитая
//    встаёт через 4 с, если вторая жива. Убивать обе.
//  * Тень-актёр — существует только в луче софита (вне луча неуязвима и
//    невидима). Играет со светом.
//  * Паук-кукловод — сидит на колосниках, спускается на нити (круг), тянет
//    кукол и вяжет им перерезанные нити. Срежь его нить — падает оглушённым.
//    Только под люстрами и балками.
//  * Балерина-волчок — кружится 2,5 с и отражает удары (0), потом кружится
//    голова — окно. Одна нить.
//  * Элита — Щелкунчик-гвардеец: 3 нити, челюсти-конус, марш-таран.
//  * Редкий бегун — Кассир с выручкой (`coins`), удирает к служебной двери.
//
// БОСС «Кукловод». Высокий, изящный, фрак чёрный с золотом, маска, вага в
// руке, от неё золотые светящиеся нити. Слабое место — вага: когда она
// светится, по нему проходит урон. Сначала висит над сценой и командует
// куклами, потом спускается. Не ходит боком: скользит лицом по ходу,
// поворачивается плавно, фалды отстают. Бой — спектакль в актах; между
// актами падает занавес (камера E9), звонок, арена переписывается `setTile`.
//  I.  «Рыцарский роман» — картонный замок, рыцарь-исполин на нитях к ваге:
//      удары копьём по линиям (зубцы замка — укрытие), щит-конус. Каждая
//      срезанная нить — кукловод клюёт вниз; все четыре — вага светится 6 с.
//  II. «Буря» — полотняное море, волны катятся рядами (перепрыгнуть рывком
//      или в проём), качается картонный корабль, молнии-софиты.
//  III.«Звёздная ночь» — звёзды-маятники на нитях качаются через сцену,
//      ходит луна-софит: в её луче кукловод тебя видит. Срежь две нити
//      звёзд — он теряет равновесие и опускается.
//  IV. «Финал — Оборванные нити» — спускается сам: нити режут арену сеткой
//      (честное предупреждение), вага горит ярко — окно. Последний удар —
//      нити лопаются, он падает, как марионетка.
// Смерть — сцена: падает занавес, кукловод кланяется.
//
// ВИТРИНА (кадр для показа): Зрительный зал во время «Премьеры» — три луча
// софитов по партеру, тени-актёры в луче, рыцари на золотых нитях, бархат
// и лепнина лож по краям.
// ════════════════════════════════════════════════════════════════════════════
//
// (Ниже пока старый код «Города за стенами» — заменяется по шагам.)

import type { MobDef } from '../dungeon';
import { MAP_F13_BELL, MAP_F13_OUTER, MAP_F13_WALL } from './f13-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F13_MARK = {
  cobble: 1,
  plaza: 2,
  ash: 3,
  rubble: 4,
  blood: 5,
  crack: 6,
  planks: 7,
  weeds: 8,
  rampart: 9,
  crater: 10,
  drain: 11,
  mosaic: 12,
  vent: 13,
  fault: 14,
  breach: 15,
  pad: 16,
  // Глубина.
  proval: 20,
  canal: 21,
  drop: 22,
  // Стены.
  house: 30,
  burnt: 31,
  wall: 32,
  parapet: 33,
  gate: 34,
  tower: 35,
  shop: 36,
  window: 37,
  // Посты исполинов (пол): кого ставит правило этажа.
  pWalker: 41,
  pAbnormal: 42,
  pThrower: 43,
  pArmored: 44,
  pCrystal: 45,
  pCrawler: 46,
  // Клетки, сменённые на ходу (`setTile`).
  sealed: 50,
  rift: 51,
  cracking: 52,
  scorch: 53,
} as const;

/** Районы этажа. `f13` — вход: на нём могут стоять сохранения. */
export const F13_OUTER = 'f13';
export const F13_WALL = 'f13wall';
export const F13_BELL = 'f13bell';

const M = F13_MARK;

/** Кто стоит на посту (метка пола → вид). */
export const F13_POSTS: Record<number, string> = {
  [M.pWalker]: 'f13_walker',
  [M.pAbnormal]: 'f13_abnormal',
  [M.pThrower]: 'f13_thrower',
  [M.pArmored]: 'f13_armored',
  [M.pCrystal]: 'f13_crystal',
  [M.pCrawler]: 'f13_crawler',
};

/** Исполины: у них затылок и крюк за спину. */
export const F13_GIANTS = new Set([
  'f13_walker',
  'f13_abnormal',
  'f13_thrower',
  'f13_armored',
  'f13_crystal',
  'f13_climber',
  'f13boss',
]);

/** Свои буквы карты — одни на все три района. */
const LEGEND: Record<string, LegendCell> = {
  // Пол.
  s: { tile: 'floor', mark: M.cobble },
  q: { tile: 'floor', mark: M.plaza },
  z: { tile: 'floor', mark: M.ash },
  k: { tile: 'floor', mark: M.rubble },
  x: { tile: 'floor', mark: M.blood },
  j: { tile: 'floor', mark: M.crack },
  h: { tile: 'floor', mark: M.planks },
  g: { tile: 'floor', mark: M.weeds },
  w: { tile: 'floor', mark: M.rampart },
  e: { tile: 'floor', mark: M.crater },
  d: { tile: 'floor', mark: M.drain },
  m: { tile: 'floor', mark: M.mosaic },
  y: { tile: 'floor', mark: M.vent },
  f: { tile: 'floor', mark: M.fault },
  r: { tile: 'floor', mark: M.breach },
  '^': { tile: 'floor', mark: M.pad },
  '1': { tile: 'floor', mark: M.pWalker },
  '2': { tile: 'floor', mark: M.pAbnormal },
  '3': { tile: 'floor', mark: M.pThrower },
  '4': { tile: 'floor', mark: M.pArmored },
  '5': { tile: 'floor', mark: M.pCrystal },
  '6': { tile: 'floor', mark: M.pCrawler },
  // Глубина: провал в сток, канал, обрыв со Стены.
  _: { tile: 'deep', mark: M.proval },
  ':': { tile: 'deep', mark: M.canal },
  '-': { tile: 'deep', mark: M.drop },
  // Стены: дома, Стена, колокольня.
  '#': { tile: 'wall', mark: M.house },
  Q: { tile: 'wall', mark: M.burnt },
  W: { tile: 'wall', mark: M.wall },
  N: { tile: 'wall', mark: M.parapet },
  I: { tile: 'wall', mark: M.gate },
  O: { tile: 'wall', mark: M.tower },
  П: { tile: 'wall' },
  '[': { tile: 'wall', mark: M.shop },
  ']': {
    tile: 'wall',
    mark: M.window,
    obj: { kind: 'deco', ref: 'f13_window', solid: 0 },
    light: { r: 1.9, tint: 'warm' },
  },
  A: {
    tile: 'wall',
    mark: M.burnt,
    obj: { kind: 'deco', ref: 'f13_fire', solid: 0 },
    light: { r: 3.6, tint: 'warm' },
  },
  J: { tile: 'wall', mark: M.house, obj: { kind: 'deco', ref: 'f13_chimney', solid: 0 } },
  V: { tile: 'wall', mark: M.wall, obj: { kind: 'deco', ref: 'f13_banner', solid: 0 } },
  U: {
    tile: 'wall',
    mark: M.house,
    obj: { kind: 'deco', ref: 'f13_torch', solid: 0 },
    light: { r: 3.8, tint: 'warm' },
  },
  // Действия: крюк, пушка, валун, набат.
  '0': {
    tile: 'floor',
    mark: M.pad,
    obj: { kind: 'deco', ref: 'f13_hook', solid: 0.2, use: { label: 'Крюк' } },
  },
  '9': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_hookc', solid: 0.2, use: { label: 'Крюк' } },
  },
  Z: {
    tile: 'floor',
    mark: M.rampart,
    obj: { kind: 'deco', ref: 'f13_cannon', solid: 0.42, use: { label: 'Выстрел' } },
  },
  '(': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_boulder', solid: 0.55, use: { label: 'Сбросить валун' } },
  },
  ')': {
    tile: 'floor',
    mark: M.planks,
    obj: { kind: 'deco', ref: 'f13_bell', solid: 0.55, use: { label: 'Набат' } },
    light: { r: 2.4, tint: 'warm' },
  },
  // Вещи на полу.
  '8': {
    tile: 'floor',
    mark: M.plaza,
    obj: { kind: 'deco', ref: 'f13_fountain', solid: 0.62 },
  },
  n: { tile: 'floor', obj: { kind: 'deco', ref: 'f13_corpse', solid: 0.55 } },
  i: { tile: 'floor', obj: { kind: 'deco', ref: 'f13_well', solid: 0.46 } },
  p: { tile: 'floor', obj: { kind: 'deco', ref: 'f13_stall', solid: 0.44 } },
  t: { tile: 'floor', obj: { kind: 'deco', ref: 'f13_cart', solid: 0.46 } },
  '&': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_skull', solid: 0.56 } },
  '*': { tile: 'floor', mark: M.rubble, obj: { kind: 'deco', ref: 'f13_hand', solid: 0.5 } },
  '+': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_statue', solid: 0.55 } },
  '<': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_laundry', solid: 0 } },
  '|': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_crystal', solid: 0.34 },
    light: { r: 2.4, tint: 'teal' },
  },
  '}': { tile: 'floor', mark: M.ash, obj: { kind: 'deco', ref: 'f13_tree', solid: 0.26 } },
  '{': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_balls', solid: 0.34 } },
  '/': { tile: 'floor', mark: M.rubble, obj: { kind: 'deco', ref: 'f13_debris', solid: 0.46 } },
  '?': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_crane', solid: 0.4 } },
  '7': { tile: 'floor', obj: { kind: 'deco', ref: 'f13_roost', solid: 0.32 } },
  ';': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_lamp', solid: 0.16 },
    light: { r: 4.2, tint: 'warm' },
  },
  u: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_candles', solid: 0.2 },
    light: { r: 1.8, tint: 'warm' },
  },
  X: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f13_bonfire', solid: 0.4 },
    light: { r: 4.6, tint: 'warm' },
  },
  // Бьётся.
  b: { tile: 'floor', obj: { kind: 'breakable', ref: 'f13_crates', solid: 0.4, hp: 2 } },
  v: { tile: 'floor', obj: { kind: 'breakable', ref: 'f13_sandbags', solid: 0.42, hp: 3 } },
  c: { tile: 'floor', obj: { kind: 'breakable', ref: 'f13_barrel', solid: 0.34, hp: 1 } },
  l: {
    tile: 'floor',
    obj: { kind: 'breakable', ref: 'f13_hay', solid: 0.4, hp: 1, loot: 'f13_ration' },
  },
};

/** Брызги при смерти исполина: пар, кровь, кость. */
const GORE_GIANT = ['#f0e6dc', '#c85a44', '#7a2a22', '#fff6ea'];

const MOBS: MobDef[] = [
  {
    id: 'f13_walker',
    name: 'Бродячий исполин',
    many: 'бродячих исполинов',
    hp: 110,
    dmg: 24,
    speed: 1.6,
    radius: 0.8,
    windup: 0.9,
    reach: 1.2,
    rest: 1.2,
    xp: 26,
    meat: null,
    mats: [
      ['f13_tooth', 0.35],
      ['f13mat', 0.45],
    ],
    beast: true,
    brain: 'f13_walker',
    art: { kind: 'paint', id: 'f13_walker' },
    mass: 12,
    flinch: 0,
    stunT: 0.4,
    eye: '#ffe6b0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_abnormal',
    name: 'Аномальный исполин',
    many: 'аномальных исполинов',
    hp: 84,
    dmg: 22,
    speed: 3.4,
    radius: 0.66,
    windup: 0.6,
    reach: 1,
    rest: 1,
    xp: 28,
    meat: null,
    mats: [
      ['f13_tooth', 0.3],
      ['f13mat', 0.4],
    ],
    beast: true,
    brain: 'f13_abnormal',
    art: { kind: 'paint', id: 'f13_abnormal' },
    mass: 9,
    flinch: 0,
    stunT: 0.3,
    eye: '#fff4c0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_thrower',
    name: 'Метатель',
    many: 'метателей',
    hp: 92,
    dmg: 22,
    speed: 1.7,
    radius: 0.8,
    windup: 1,
    reach: 1.1,
    rest: 1.4,
    xp: 26,
    meat: null,
    mats: [
      ['f13_tooth', 0.3],
      ['f13mat', 0.45],
    ],
    beast: true,
    brain: 'f13_thrower',
    art: { kind: 'paint', id: 'f13_thrower' },
    mass: 12,
    flinch: 0,
    stunT: 0.4,
    shot: { speed: 7, r: 0.8, life: 3, dmg: 1.1, art: 'f13_rock', lob: true },
    eye: '#ffd8a0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_armored',
    name: 'Бронированный исполин',
    many: 'бронированных исполинов',
    hp: 150,
    dmg: 28,
    speed: 1.8,
    radius: 0.9,
    windup: 1,
    reach: 1.2,
    rest: 1.3,
    xp: 36,
    meat: null,
    mats: [
      ['f13_plate', 0.5],
      ['f13mat', 0.35],
    ],
    beast: true,
    brain: 'f13_armored',
    art: { kind: 'paint', id: 'f13_armored' },
    mass: 18,
    flinch: 0,
    stunT: 0.3,
    noAlbino: true,
    eye: '#ffb060',
    gore: ['#e8dcd0', '#c8b8a0', '#8a3a2a', '#fff4e4'],
  },
  {
    id: 'f13_crystal',
    name: 'Кристальная особь',
    many: 'кристальных особей',
    hp: 100,
    dmg: 24,
    speed: 2.5,
    radius: 0.7,
    windup: 0.7,
    reach: 1.1,
    rest: 1.1,
    xp: 34,
    meat: null,
    mats: [
      ['f13_shard', 0.5],
      ['f13mat', 0.3],
    ],
    beast: true,
    brain: 'f13_crystal',
    art: { kind: 'paint', id: 'f13_crystal' },
    mass: 10,
    flinch: 0,
    stunT: 0.3,
    noAlbino: true,
    eye: '#bff4ff',
    light: 1.6,
    gore: ['#bff4ff', '#6ab8d8', '#e8f8ff', '#c85a44'],
  },
  {
    id: 'f13_climber',
    name: 'Стенолаз',
    many: 'стенолазов',
    hp: 72,
    dmg: 20,
    speed: 2.6,
    radius: 0.66,
    windup: 0.7,
    reach: 1.1,
    rest: 1.1,
    xp: 24,
    meat: null,
    mats: [
      ['f13_tooth', 0.25],
      ['f13mat', 0.45],
    ],
    beast: true,
    brain: 'f13_climber',
    art: { kind: 'paint', id: 'f13_climber' },
    mass: 9,
    flinch: 0,
    stunT: 0.3,
    eye: '#ffe0a0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_crawler',
    name: 'Ползун',
    many: 'ползунов',
    hp: 56,
    dmg: 18,
    speed: 3.2,
    radius: 0.6,
    windup: 0.55,
    reach: 0.8,
    rest: 0.9,
    xp: 18,
    meat: null,
    mats: [['f13mat', 0.35]],
    beast: true,
    brain: 'f13_crawler',
    art: { kind: 'paint', id: 'f13_crawler' },
    mass: 5,
    flinch: 0.1,
    stunT: 0.3,
    eye: '#ffe0a0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_grin',
    name: 'Ухмылка',
    many: 'ухмылок',
    hp: 16,
    dmg: 12,
    speed: 3.3,
    radius: 0.36,
    windup: 0.45,
    reach: 0.45,
    rest: 0.8,
    xp: 8,
    meat: ['f13_ration', 0.22, 1],
    mats: [['f13mat', 0.12]],
    beast: true,
    brain: 'f13_grin',
    art: { kind: 'paint', id: 'f13_grin' },
    mass: 1.6,
    flinch: 0.4,
    zigzag: true,
    eye: '#fff0c0',
    gore: GORE_GIANT,
  },
  {
    id: 'f13_crow',
    name: 'Ворона',
    many: 'ворон',
    hp: 8,
    dmg: 8,
    speed: 5.2,
    radius: 0.24,
    windup: 0.4,
    reach: 0.35,
    rest: 0.7,
    xp: 4,
    meat: ['f13_crowmeat', 0.3, 1],
    mats: [['f13_feather', 0.35]],
    beast: true,
    brain: 'f13_crow',
    art: { kind: 'paint', id: 'f13_crow' },
    mass: 0.4,
    flinch: 1,
    fly: true,
    eye: '#ffcc40',
    gore: ['#1a1418', '#3a3440', '#8a1c22', '#6a6070'],
  },
  {
    id: 'f13_smuggler',
    name: 'Контрабандист',
    many: 'контрабандистов',
    hp: 24,
    dmg: 8,
    speed: 5.6,
    radius: 0.28,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 36,
    meat: ['f13_ration', 0.6, 2],
    mats: [
      ['f13_rope', 0.7],
      ['f13mat', 0.4],
    ],
    beast: true,
    brain: 'f13_smuggler',
    art: { kind: 'paint', id: 'f13_smuggler' },
    mass: 0.9,
    flinch: 1,
    coins: 2200,
    resume: 'flee',
    eye: '#ffd040',
    light: 1.3,
    gore: ['#6a4a2a', '#ffd040', '#3a2a1a', '#c84030'],
  },
  {
    id: 'f13boss',
    name: 'Колосс',
    many: 'колоссов',
    hp: 820,
    dmg: 24,
    speed: 1.15,
    radius: 1.8,
    windup: 1,
    reach: 1.8,
    rest: 1,
    xp: 1100,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f13boss',
    art: { kind: 'paint', id: 'f13boss' },
    mass: 60,
    boss: true,
    noAlbino: true,
    eye: '#ffd080',
    light: 3.4,
    gore: ['#fff6ea', '#e0604a', '#8a2a22', '#f0e0d0'],
  },
];

/** Внешний район: ухмылки из проломов, вороны, ползуны из подвалов. */
const spawnOuter: SpawnSpec = {
  mobs: [
    ['f13_grin', 60],
    ['f13_crow', 24],
    ['f13_crawler', 16],
  ],
  density: 0.66,
  pack: [2, 2],
  filler: 'f13_grin',
  // Спящая стая — ухмылки, пятой — ворона на страже.
  group: (i) => (i < 4 ? 'f13_grin' : 'f13_crow'),
  horde: null,
  treasure: 'f13_smuggler',
  nest: () => 'f13_grin',
};

const spawnWall: SpawnSpec = {
  ...spawnOuter,
  mobs: [
    ['f13_grin', 58],
    ['f13_crow', 26],
    ['f13_crawler', 16],
  ],
  density: 0.7,
  group: (i) => (i < 3 ? 'f13_grin' : 'f13_crawler'),
};

const spawnBell: SpawnSpec = {
  ...spawnOuter,
  mobs: [
    ['f13_grin', 52],
    ['f13_crow', 32],
    ['f13_crawler', 16],
  ],
  density: 0.74,
  group: (i) => (i < 3 ? 'f13_grin' : 'f13_crow'),
};

export const F13: FloorDef = {
  id: 13,
  name: 'Город за стенами',
  lead: 'Город в осаде исполинов. Бей в затылок — за спину выносит крюк.',
  mapVer: 1,
  // Исполины велики, а площади открыты: поле путей шире обычного.
  flowR: 32,
  areas: [
    {
      id: F13_OUTER,
      name: 'Внешний район',
      lead: 'Провал у самого лифта. Столб-якорь — крюк перенесёт.',
      tier: 8,
      level: 9,
      ambient: 0.5,
      rows: MAP_F13_OUTER,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.94, 0.8, 0.7], mix: '#2a1206', k: 0.08 },
        fog: '#120a07',
      },
      legend: LEGEND,
      paintAll: true,
      mine: 'f13mine',
      spawn: spawnOuter,
    },
    {
      id: F13_WALL,
      name: 'Ворота и стена',
      lead: 'Ворота заперты. Пролом рядом — и пушки на Стене.',
      tier: 8,
      level: 9,
      ambient: 0.54,
      rows: MAP_F13_WALL,
      skin: {
        floor: 'ground',
        wall: 'brick',
        tint: { mul: [0.86, 0.8, 0.72], mix: '#1e1208', k: 0.06 },
        fog: '#0e0b0a',
      },
      legend: LEGEND,
      paintAll: true,
      spawn: spawnWall,
    },
    {
      id: F13_BELL,
      name: 'Площадь колокола',
      lead: 'Набат молчит. За колокольней встаёт Колосс.',
      tier: 8,
      level: 9,
      ambient: 0.46,
      rows: MAP_F13_BELL,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.8, 0.78, 0.86], mix: '#1a1024', k: 0.06 },
        fog: '#0b0a10',
      },
      legend: LEGEND,
      paintAll: true,
      mine: 'f13mine2',
      spawn: spawnBell,
    },
  ],
  boss: {
    id: 'f13boss',
    name: 'Колосс',
    lead: 'Площадь колокола за Сторожевой площадью',
    area: F13_BELL,
    restMs: 20 * 60_000,
    mob: 'f13boss',
    script: 'f13boss',
    parts: ['f13boss'],
    loot: (rnd) => ({
      tokens: 80 + Math.floor(rnd() * 40),
      keys: rnd() < 0.85 ? 1 : 0,
      coins: 70_000,
      mats: {
        f13_heart: 1,
        f13mat: 5 + Math.floor(rnd() * 4),
        f13_shard: 2 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f13mine',
      name: 'Шахта в подвале у канала',
      area: F13_OUTER,
      windowMs: 60 * 60_000,
      ores: [24, 25],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.6,
    },
    {
      id: 'f13mine2',
      name: 'Шахта звёздного кристалла',
      area: F13_BELL,
      windowMs: 3 * 60 * 60_000,
      ores: [24, 25],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f13_ration', name: 'Солдатский паёк', price: 90, heal: 0.36 },
    { id: 'f13_crowmeat', name: 'Воронье крыло', price: 50, heal: 0.22 },
  ],
  mats: [
    {
      id: 'f13mat',
      name: 'Жила исполина',
      price: 520,
      lead: 'Тянется, как трос, остывая — твердеет. Из неё вьют тросы крюков.',
    },
    {
      id: 'f13_tooth',
      name: 'Зуб исполина',
      price: 640,
      lead: 'С ладонь величиной. Улыбка у хозяина была шире.',
    },
    {
      id: 'f13_plate',
      name: 'Пластина брони',
      price: 780,
      lead: 'Снята со спины бронированного. Держит пушечное ядро.',
    },
    {
      id: 'f13_shard',
      name: 'Осколок твердыни',
      price: 860,
      lead: 'Кристалл, в который пряталась особь. Не бьётся даже о Стену.',
    },
    {
      id: 'f13_feather',
      name: 'Воронье перо',
      price: 280,
      lead: 'Чёрное, пахнет дымом горящего квартала.',
    },
    {
      id: 'f13_rope',
      name: 'Трос крюкомёта',
      price: 720,
      lead: 'Контрабандный, с гарпуном. Второй конец ещё тёплый.',
    },
    {
      id: 'f13_heart',
      name: 'Сердце Колосса',
      price: 70_000,
      lead: 'Трофей. Горячее, парит в ладонях и не остывает.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f13.png',
};
