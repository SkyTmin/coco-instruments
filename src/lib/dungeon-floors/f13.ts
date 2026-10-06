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
//    идёт нить: золотая линия к точке крепления над куклой. Нити идут ВВЕРХ
//    по экрану: снизу (с юга) по кукле бьёшь, но нитей не достать; режут
//    сбоку и сверху — это и есть выбор места.
//  * Софиты — свет на ходу (E2). Лучи ходят по сцене в такт (плавно сдвиг →
//    стоят → сдвиг). В луче тебя видят все и бьют сильнее; в тени мобы
//    теряют тебя (дальше ~4,5 клетки — ищут наугад), удар по потерявшему —
//    «из тени», ×2. Тени-актёры существуют только в луче. Повернуть софит —
//    действие этажа: луч уходит на другую дорожку.
//  * Смена декораций «Третий звонок». Звонок, мигает свет, через 2 с едет
//    задник и зал перестраивается `setTile` (картонный лес → замок → море).
//    Линии-предупреждения на полу заранее показывают, где встанут декорации.
//  * Люки. Открываются по такту (`deep`) с подсветкой за 1,2 с; мобов можно
//    уронить в люк, героя люк роняет на край (доля здоровья, `hurtEnv`).
//  * Действия этажа (E8): «Противовес» (мешок с песком падает на врага и
//    режет нити), «Повернуть софит», «Занавес» (лебёдка закрывает проход),
//    «Люки» (открыть под врагами), «Палочка» (оркестр замолкает),
//    «Звонок» (сменить декорацию раньше), «Стопор» (заклинить пожарный
//    занавес).
//  * Рост по районам: Фойе — нити и куклы; Зал — софиты, свет и тень;
//    Колосники — смена сцены, люки и всё вместе.
//
// РАЙОНЫ (снизу вверх; id прежние, названия новые).
//  1. `f13` «Фойе» — вход с лифтом. Вестибюль с афишами и люстрой: первый
//     рыцарь на нитях и противовес — учат глаголу. Развилка: на запад
//     Гардероб (событие «Гардероб оживает»: с вешалок падают костюмы-куклы,
//     с люстры спускается паук) или на северо-восток Курительная с шахтой
//     `f13mine`. Обе ведут в Буфет — событие «Антракт»: первый звонок, свет
//     вспыхивает, публика курит в боковых кулуарах; третий звонок — толпа
//     возвращается; лебёдки занавеса у дверей отсекают её. Парадная
//     лестница с люстрами, выход наверх. Тайник «Касса» за трещиной, ход —
//     решётка из Лестницы вниз к вестибюлю.
//  2. `f13wall` «Зрительный зал». Кулуары, Партер — ряды кресел дугой,
//     проходы. Событие «Премьера»: люстры гаснут, занавес поднимается
//     (`setTile`), три софита ходят по залу в такт, в лучах встают
//     тени-актёры; кончается «Аплодисментами». Развилка: Боковые ложи
//     (софиты на поворот, тени в лучах) или Оркестровая яма — событие
//     «Увертюра»: барабанщики бьют кольца на сильную долю, скрипачи режут
//     нотами, люки ямы открываются по очереди; «Палочка» глушит оркестр.
//     Сцена с будкой суфлёра и люками, закулисье, выход на север. Тайник
//     «Царская ложа», ход — решётка из закулисья вниз к кулуарам.
//  3. `f13bell` «Колосники». Служебная лестница, Поворотный круг — событие
//     «Третий звонок» (лес → замок → море, линии на полу заранее). Развилка:
//     галерея «Пожарный занавес» (железные секции падают волной полосами с
//     предупреждением и стоят стеной; «Стопор» клинит секцию) или мостки
//     над провалом на западе. Трюм с шахтой `f13mine2`. Тайник
//     «Реквизиторская». Предбанник с табличкой и лифтом, ход — решётка вниз.
//     Арена — «Большая сцена», ворота с юга, печать и лестница вниз.
//
// МОНСТРЫ (база = 10-й этаж ×1,3, уровень 9).
//  * Рыцарь-марионетка (2 нити) — рубит конусом, нити отдёргивают; без
//    нитей ползёт. Учит глаголу.
//  * Арлекин — ныряет в люк и выскакивает за спиной (круг за 0,7 с).
//  * Суфлёр — сидит в будке (только у неё), шепчет соседям (урон ×1,3,
//    видно ленточкой), прячется, когда герой рядом, кидает листки роли.
//  * Барабанщик — кольцо-ударная волна на сильную долю. Сидит в яме.
//  * Скрипач — ноты летят дугой и режут (и чужие нити тоже).
//  * Маски Комедии и Трагедии — летают парой, одна лечит другую; «убитая»
//    падает и встаёт через 4 с, если вторая цела. Убивать обе.
//  * Тень-актёр — существует только в луче софита (вне луча неуязвима и
//    почти невидима).
//  * Паук-кукловод — сидит на колосниках (под люстрами и балками),
//    спускается на нити (круг), вяжет куклам перерезанные нити. Срежь его
//    нить — падает оглушённым.
//  * Балерина-волчок — кружится 2,5 с и отражает удары, потом кружится
//    голова — окно. Одна нить.
//  * Элита — Щелкунчик-гвардеец: 3 нити, челюсти-конус, марш-таран.
//  * Редкий бегун — Кассир с выручкой (`coins`), удирает.
//
// БОСС «Кукловод». Высокий, изящный, фрак чёрный с золотом, маска, вага в
// руке, от неё золотые светящиеся нити. Слабое место — вага: когда она
// светится, удары проходят в полную силу (×1,5…1,6), в остальное время —
// треть. Сначала висит над сценой и водит кукол, потом спускается. Не ходит
// боком: скользит лицом по ходу, поворачивается плавно, фалды отстают. Бой —
// спектакль в актах; между актами падает занавес (камера E9), звонок, арена
// переписывается `setTile`.
//  I.  «Рыцарский роман» — картонный замок, рыцарь-исполин на четырёх нитях
//      к ваге: удары копьём по линиям (зубцы замка — укрытие), щит-конус.
//      Каждая срезанная нить — кукловод клюёт вниз; все четыре — вага
//      светится 6 с, потом исполина собирают заново.
//  II. «Буря» — полотняное море, волны катятся рядами (перепрыгнуть рывком
//      или в проём), качается картонный корабль (за ним — затишье),
//      молнии-софиты. Кукловод спускается на палубу.
//  III.«Звёздная ночь» — звёзды-маятники на нитях качаются через сцену,
//      ходит луна-софит: в её луче кукловод тебя видит и бьёт иглами, вне —
//      бьёт по памяти. Срежь две нити звёзд — он теряет равновесие.
//  IV. «Финал — Оборванные нити» — спускается сам: вага рубит и колет, нити
//      режут арену сеткой (честное предупреждение), аркан тянет к нему; после
//      сетки вага горит ярко — окно. Последний удар — нити лопаются, он
//      падает, как марионетка.
// Смерть — сцена: нити лопаются, он падает, встаёт уже без нитей, кланяется,
// и падает занавес.
//
// ВИТРИНА (кадр для показа): Зрительный зал во время «Премьеры» — три луча
// софитов по партеру, тени-актёры в луче, рыцари на золотых нитях, бархат
// и лепнина лож по краям.
// ════════════════════════════════════════════════════════════════════════════
//
// Карта — `scripts/dungeon/f13.py` → `f13-map.ts` (руками не править).
// Правила этажа, монстры и Кукловод — `f13-brains.ts`; рисунок — `f13-art.ts`
// (клетки, монстры, предметы, босс) и `f13-boss-fx.ts` (лучи, нити, метки).

import type { MobDef } from '../dungeon';
import { F13_GEO, MAP_F13_FLIES, MAP_F13_FOYER, MAP_F13_HALL } from './f13-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои виды клеток (марки легенды и смены на ходу). */
export const F13_MARK = {
  // пол
  marble: 1,
  parquet: 2,
  carpet: 3,
  steps: 4,
  parterre: 5,
  boards: 6,
  pit: 7,
  turn: 8,
  catwalk: 9,
  void: 10,
  groove: 11,
  trap: 12,
  rampLit: 13,
  ramp: 14,
  // стены
  seats: 15,
  velvet: 16,
  rail: 17,
  backdrop: 18,
  ropes: 19,
  poster: 20,
  mirror: 21,
  fireplace: 22,
  kassa: 23,
  masks: 24,
  // клетка под предметом и постом: вид — по соседям
  auto: 25,
  // на ходу (`api.setTile`)
  trapOpen: 30,
  curtainDown: 31,
  iron: 32,
  setWarn: 33,
  setTree: 34,
  setCastle: 35,
  setSea: 36,
  curtainUp: 37,
  // арена: акты
  actCastle: 40,
  actSea: 41,
  actShip: 42,
  actNight: 43,
  actGrid: 44,
  actCloud: 45,
} as const;

export const F13_FOYER = 'f13';
export const F13_HALL = 'f13wall';
export const F13_FLIES = 'f13bell';

/**
 * Первые мировые ряды районов: мир складывается снизу вверх, поэтому верхний
 * район (Колосники) начинается с нуля.
 */
export const F13_TOP = {
  [F13_FLIES]: 0,
  [F13_HALL]: MAP_F13_FLIES.length,
  [F13_FOYER]: MAP_F13_FLIES.length + MAP_F13_HALL.length,
} as Record<string, number>;

/** Ряды районов — по ним правило этажа находит посты (цифры карты). */
export const F13_ROWS: Record<string, readonly string[]> = {
  [F13_FOYER]: MAP_F13_FOYER,
  [F13_HALL]: MAP_F13_HALL,
  [F13_FLIES]: MAP_F13_FLIES,
};

/** Посты: цифра карты → кто стоит на месте с начала вылазки. */
export const F13_POSTS: Record<string, string> = {
  '1': 'f13_knight',
  '2': 'f13_ballerina',
  '3': 'f13_spider',
  '4': 'f13_prompter',
  '5': 'f13_drummer',
  '6': 'f13_fiddler',
  '7': 'f13_harlequin',
  '8': 'f13_nutcracker',
  '9': 'f13_comedy',
  '0': 'f13_shade',
};

export { F13_GEO };

const M = F13_MARK;

// ---------------------------------------------------------------------------
// Легенда: одна на три района (буквы карты — шапка `f13.py`).
// ---------------------------------------------------------------------------

const floorAuto = (obj?: LegendCell['obj'], light?: LegendCell['light']): LegendCell => ({
  tile: 'floor',
  mark: M.auto,
  ...(obj ? { obj } : {}),
  ...(light ? { light } : {}),
});

const wallFace = (mark: number, ref: string, light?: LegendCell['light']): LegendCell => ({
  tile: 'wall',
  mark,
  obj: { kind: 'deco', ref, solid: 0 },
  ...(light ? { light } : {}),
});

const LEGEND: Record<string, LegendCell> = {
  // пол
  m: { tile: 'floor', mark: M.marble },
  p: { tile: 'floor', mark: M.parquet },
  t: { tile: 'floor', mark: M.carpet },
  e: { tile: 'floor', mark: M.steps },
  x: { tile: 'floor', mark: M.parterre },
  k: { tile: 'floor', mark: M.boards },
  j: { tile: 'floor', mark: M.pit },
  q: { tile: 'floor', mark: M.turn },
  w: { tile: 'floor', mark: M.catwalk },
  _: { tile: 'deep', mark: M.void },
  y: { tile: 'floor', mark: M.groove },
  z: { tile: 'floor', mark: M.trap },
  f: { tile: 'floor', mark: M.rampLit, light: { r: 2.2, tint: 'warm' } },
  r: { tile: 'floor', mark: M.ramp },
  // стены
  s: { tile: 'wall', mark: M.seats },
  h: { tile: 'wall', mark: M.velvet },
  i: { tile: 'wall', mark: M.rail },
  d: { tile: 'wall', mark: M.backdrop },
  '|': wallFace(M.ropes, 'f13_ropes'),
  // на стене
  I: wallFace(M.poster, 'f13_poster'),
  Q: wallFace(M.mirror, 'f13_mirror'),
  ')': wallFace(M.fireplace, 'f13_fireplace', { r: 3.4, tint: 'warm' }),
  ';': wallFace(M.kassa, 'f13_kassa', { r: 1.8, tint: 'warm' }),
  ':': wallFace(M.masks, 'f13_masks'),
  // предметы на полу
  A: floorAuto({ kind: 'deco', ref: 'f13_chandelier', solid: 0 }),
  H: floorAuto({ kind: 'deco', ref: 'f13_rack', solid: 0.42 }),
  J: floorAuto({ kind: 'deco', ref: 'f13_counter', solid: 0.48 }),
  N: floorAuto({ kind: 'deco', ref: 'f13_table', solid: 0.36 }, { r: 2.4, tint: 'warm' }),
  O: floorAuto({ kind: 'deco', ref: 'f13_bust', solid: 0.4 }),
  '-': floorAuto({ kind: 'deco', ref: 'f13_post', solid: 0.2 }),
  '/': floorAuto({ kind: 'deco', ref: 'f13_palm', solid: 0.36 }),
  U: floorAuto({ kind: 'breakable', ref: 'f13_trunk', solid: 0.38, hp: 2, loot: 'f13_velvet' }),
  V: floorAuto({ kind: 'breakable', ref: 'f13_flowers', solid: 0.3, hp: 1 }),
  W: floorAuto({ kind: 'breakable', ref: 'f13_sandbags', solid: 0.38, hp: 2, loot: 'f13mat' }),
  '[': floorAuto({ kind: 'deco', ref: 'f13_coil', solid: 0.3 }),
  ']': floorAuto({ kind: 'breakable', ref: 'f13_flat', solid: 0.36, hp: 3 }),
  '}': floorAuto({ kind: 'deco', ref: 'f13_hanger', solid: 0 }),
  F: floorAuto({ kind: 'deco', ref: 'f13_stand', solid: 0.22 }),
  '(': floorAuto({ kind: 'deco', ref: 'f13_timpani', solid: 0.48 }),
  '*': floorAuto({ kind: 'deco', ref: 'f13_booth', solid: 0.6 }, { r: 1.6, tint: 'warm' }),
  // действия этажа
  Z: floorAuto({ kind: 'deco', ref: 'f13_spot', solid: 0.4, use: { label: 'Повернуть софит' } }),
  '+': floorAuto({ kind: 'deco', ref: 'f13_weight', solid: 0.3, use: { label: 'Противовес' } }),
  '<': floorAuto({ kind: 'deco', ref: 'f13_winch', solid: 0.3, use: { label: 'Занавес' } }),
  '^': floorAuto({ kind: 'deco', ref: 'f13_lever', solid: 0.28, use: { label: 'Люки' } }),
  '&': floorAuto({ kind: 'deco', ref: 'f13_podium', solid: 0.3, use: { label: 'Палочка' } }),
  '?': floorAuto(
    { kind: 'deco', ref: 'f13_bell', solid: 0.55, use: { label: 'Звонок' } },
    { r: 2, tint: 'warm' },
  ),
  '{': floorAuto({ kind: 'deco', ref: 'f13_stopper', solid: 0.3, use: { label: 'Стопор' } }),
  // посты
  ...Object.fromEntries(
    Object.keys(F13_POSTS).map((d): [string, LegendCell] => [d, { tile: 'floor', mark: M.auto }]),
  ),
};

// ---------------------------------------------------------------------------
// Монстры. Сила — как этаж 10 ×1,3 базовыми числами (уровень районов 9).
// ---------------------------------------------------------------------------

/** Опилки, лоскуты, золото — смерть куклы рассыпается, а не кровит. */
const DUST_WOOD = ['#5a3a1c', '#c89a5a', '#f0d8a0', '#3a2410'];
const DUST_VELVET = ['#4a0c14', '#a0202c', '#e8b860', '#1a0608'];
const DUST_PORCELAIN = ['#d8d0c4', '#f8f0e4', '#e8b860', '#6a6058'];
const DUST_SHADE = ['#1a1424', '#3a2c50', '#8a7ab0', '#0a0610'];

const mob = (m: Partial<MobDef> & Pick<MobDef, 'id' | 'name' | 'many' | 'hp' | 'dmg'>): MobDef => ({
  speed: 2.6,
  radius: 0.34,
  windup: 0.7,
  reach: 0.9,
  rest: 0.9,
  xp: 14,
  meat: null,
  mats: [['f13mat', 0.16]],
  beast: true,
  brain: m.id,
  art: { kind: 'paint', id: m.id },
  ...m,
});

const MOBS: MobDef[] = [
  mob({
    id: 'f13_knight',
    name: 'Рыцарь-марионетка',
    many: 'рыцарей-марионеток',
    hp: 52,
    dmg: 24,
    speed: 2.6,
    radius: 0.36,
    windup: 0.72,
    reach: 1.0,
    xp: 15,
    meat: ['f13_candy', 0.3, 1],
    mats: [
      ['f13_hinge', 0.28],
      ['f13mat', 0.18],
    ],
    mass: 2,
    flinch: 0.25,
    stunT: 0.3,
    eye: '#ffe08a',
    gore: DUST_WOOD,
  }),
  mob({
    id: 'f13_harlequin',
    name: 'Арлекин',
    many: 'арлекинов',
    hp: 34,
    dmg: 22,
    speed: 3.6,
    radius: 0.32,
    windup: 0.55,
    reach: 0.9,
    xp: 14,
    meat: ['f13_candy', 0.35, 1],
    mats: [
      ['f13_velvet', 0.25],
      ['f13mat', 0.14],
    ],
    mass: 0.9,
    flinch: 0.5,
    eye: '#ff7088',
    gore: DUST_VELVET,
  }),
  mob({
    id: 'f13_prompter',
    name: 'Суфлёр',
    many: 'суфлёров',
    hp: 30,
    dmg: 14,
    speed: 2.0,
    radius: 0.3,
    windup: 0.6,
    reach: 0.8,
    xp: 16,
    meat: ['f13_pie', 0.4, 1],
    mats: [['f13mat', 0.3]],
    mass: 1,
    flinch: 1,
    noAlbino: true,
    shot: { speed: 6.5, r: 0.22, life: 1.6, dmg: 0.8, art: 'f13_page' },
    eye: '#fff0b0',
    light: 1.2,
    gore: ['#e8e0c8', '#c8b890', '#5a4a30', '#fff8e0'],
  }),
  mob({
    id: 'f13_drummer',
    name: 'Барабанщик',
    many: 'барабанщиков',
    hp: 60,
    dmg: 24,
    speed: 1.7,
    radius: 0.4,
    windup: 0.75,
    reach: 1.0,
    xp: 18,
    mats: [
      ['f13_hinge', 0.3],
      ['f13mat', 0.2],
    ],
    mass: 3,
    flinch: 0.15,
    stunT: 0.35,
    eye: '#ffd060',
    gore: DUST_WOOD,
  }),
  mob({
    id: 'f13_fiddler',
    name: 'Скрипач',
    many: 'скрипачей',
    hp: 36,
    dmg: 20,
    speed: 2.3,
    radius: 0.32,
    windup: 0.7,
    reach: 0.8,
    xp: 15,
    mats: [
      ['f13_hinge', 0.22],
      ['f13mat', 0.16],
    ],
    mass: 1,
    flinch: 0.4,
    shot: { speed: 5.4, r: 0.26, life: 2.4, dmg: 1, art: 'f13_note' },
    eye: '#a8e0ff',
    gore: DUST_WOOD,
  }),
  mob({
    id: 'f13_comedy',
    name: 'Маска Комедии',
    many: 'масок Комедии',
    hp: 30,
    dmg: 18,
    speed: 3.3,
    radius: 0.32,
    windup: 0.55,
    reach: 0.8,
    xp: 15,
    mats: [
      ['f13_mask', 0.22],
      ['f13mat', 0.14],
    ],
    mass: 0.6,
    flinch: 0.6,
    fly: true,
    eye: '#ffd040',
    light: 1,
    gore: DUST_PORCELAIN,
  }),
  mob({
    id: 'f13_tragedy',
    name: 'Маска Трагедии',
    many: 'масок Трагедии',
    hp: 30,
    dmg: 18,
    speed: 3.0,
    radius: 0.32,
    windup: 0.6,
    reach: 0.8,
    xp: 15,
    mats: [
      ['f13_mask', 0.22],
      ['f13mat', 0.14],
    ],
    mass: 0.6,
    flinch: 0.6,
    fly: true,
    shot: { speed: 6, r: 0.22, life: 1.8, dmg: 0.9, art: 'f13_tear' },
    eye: '#8ad8ff',
    light: 1,
    gore: DUST_PORCELAIN,
  }),
  mob({
    id: 'f13_shade',
    name: 'Тень-актёр',
    many: 'теней-актёров',
    hp: 32,
    dmg: 24,
    speed: 3.4,
    radius: 0.34,
    windup: 0.6,
    reach: 1.0,
    xp: 17,
    mats: [['f13mat', 0.3]],
    mass: 0.8,
    flinch: 0.5,
    noAlbino: true,
    eye: '#d0c0ff',
    gore: DUST_SHADE,
  }),
  mob({
    id: 'f13_spider',
    name: 'Паук-кукловод',
    many: 'пауков-кукловодов',
    hp: 44,
    dmg: 20,
    speed: 2.8,
    radius: 0.36,
    windup: 0.8,
    reach: 0.9,
    xp: 18,
    mats: [
      ['f13mat', 0.4],
      ['f13_hinge', 0.2],
    ],
    mass: 1.2,
    flinch: 0.3,
    noAlbino: true,
    eye: '#ffcf40',
    gore: ['#2a1c2c', '#6a4a70', '#e8c860', '#100810'],
  }),
  mob({
    id: 'f13_ballerina',
    name: 'Балерина-волчок',
    many: 'балерин-волчков',
    hp: 40,
    dmg: 22,
    speed: 3.0,
    radius: 0.32,
    windup: 0.6,
    reach: 0.9,
    xp: 16,
    meat: ['f13_candy', 0.3, 1],
    mats: [
      ['f13_velvet', 0.2],
      ['f13mat', 0.16],
    ],
    mass: 0.9,
    flinch: 0.3,
    eye: '#ffc8e0',
    gore: ['#f0c8d8', '#fff0f4', '#e8b860', '#8a4a60'],
  }),
  mob({
    id: 'f13_nutcracker',
    name: 'Щелкунчик-гвардеец',
    many: 'щелкунчиков-гвардейцев',
    hp: 90,
    dmg: 30,
    speed: 2.2,
    radius: 0.46,
    windup: 0.85,
    reach: 1.2,
    rest: 1.1,
    xp: 30,
    meat: ['f13_pie', 0.5, 1],
    mats: [
      ['f13_hinge', 0.5],
      ['f13mat', 0.35],
    ],
    mass: 5,
    flinch: 0,
    stunT: 0.4,
    eye: '#ffe060',
    gore: DUST_WOOD,
  }),
  mob({
    id: 'f13_cashier',
    name: 'Кассир',
    many: 'кассиров',
    hp: 30,
    dmg: 0,
    speed: 4.2,
    radius: 0.3,
    windup: 9,
    reach: 0,
    xp: 30,
    meat: ['f13_pie', 1, 2],
    mats: [
      ['f13_ticket', 1],
      ['f13mat', 0.5],
    ],
    mass: 0.8,
    flinch: 1,
    coins: 2000,
    resume: 'flee',
    eye: '#ffd040',
    light: 1.4,
    gore: ['#2a3a24', '#ffd040', '#e8d8a0', '#1a1408'],
  }),
  mob({
    id: 'f13_giant',
    name: 'Рыцарь-исполин',
    many: 'рыцарей-исполинов',
    hp: 400,
    dmg: 26,
    speed: 2.0,
    radius: 0.85,
    windup: 0.9,
    reach: 1.4,
    rest: 1,
    xp: 0,
    mats: [],
    beast: false,
    mass: 30,
    boss: true,
    noAlbino: true,
    eye: '#ffe08a',
    gore: DUST_WOOD,
  }),
  mob({
    id: 'f13boss',
    name: 'Кукловод',
    many: 'кукловодов',
    hp: 1150,
    dmg: 26,
    speed: 2.4,
    radius: 0.7,
    windup: 0.8,
    reach: 1.2,
    rest: 0.9,
    xp: 1200,
    mats: [],
    mass: 14,
    boss: true,
    noAlbino: true,
    eye: '#ffe9a0',
    light: 2.4,
    gore: ['#120c10', '#e8b84a', '#fff0c0', '#3a1018'],
  }),
];

/** Фойе: рыцари и балерины, маски, арлекины; беглец — кассир с выручкой. */
const spawnFoyer: SpawnSpec = {
  mobs: [
    ['f13_knight', 44],
    ['f13_ballerina', 22],
    ['f13_comedy', 12],
    ['f13_harlequin', 12],
    ['f13_fiddler', 10],
  ],
  density: 0.7,
  pack: [1, 2],
  filler: 'f13_knight',
  group: (i) => (i < 2 ? 'f13_knight' : 'f13_ballerina'),
  horde: null,
  treasure: 'f13_cashier',
  nest: () => 'f13_knight',
};

const spawnHall: SpawnSpec = {
  ...spawnFoyer,
  mobs: [
    ['f13_knight', 26],
    ['f13_fiddler', 20],
    ['f13_harlequin', 18],
    ['f13_ballerina', 16],
    ['f13_comedy', 12],
    ['f13_nutcracker', 8],
  ],
  density: 0.74,
  filler: 'f13_knight',
  group: (i) => (i < 1 ? 'f13_nutcracker' : i < 3 ? 'f13_knight' : 'f13_fiddler'),
};

const spawnFlies: SpawnSpec = {
  ...spawnFoyer,
  mobs: [
    ['f13_knight', 24],
    ['f13_harlequin', 18],
    ['f13_ballerina', 16],
    ['f13_fiddler', 16],
    ['f13_comedy', 14],
    ['f13_nutcracker', 12],
  ],
  density: 0.78,
  filler: 'f13_harlequin',
  group: (i) => (i < 1 ? 'f13_nutcracker' : i < 3 ? 'f13_harlequin' : 'f13_knight'),
};

export const F13: FloorDef = {
  id: 13,
  name: 'Театр марионеток',
  lead: 'Заброшенный кукольный театр. Спектакль идёт сам: куклы играют без актёров, а нити уходят во тьму колосников.',
  mapVer: 2,
  areas: [
    {
      id: F13_FOYER,
      name: 'Фойе',
      lead: 'Люстры горят сами. Куклы ждут третьего звонка.',
      tier: 8,
      level: 9,
      ambient: 0.48,
      rows: MAP_F13_FOYER,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.92, 0.66, 0.58], mix: '#2a0a0e', k: 0.18 },
        fog: '#0a0406',
      },
      legend: LEGEND,
      paintAll: true,
      mine: 'f13mine',
      spawn: spawnFoyer,
    },
    {
      id: F13_HALL,
      name: 'Зрительный зал',
      lead: 'Тёмный зал. Где луч софита — там тебя видят.',
      tier: 8,
      level: 9,
      ambient: 0.3,
      rows: MAP_F13_HALL,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.74, 0.5, 0.52], mix: '#1a0410', k: 0.2 },
        fog: '#060207',
      },
      legend: LEGEND,
      paintAll: true,
      spawn: spawnHall,
    },
    {
      id: F13_FLIES,
      name: 'Колосники',
      lead: 'Мостки, канаты и противовесы над сценой. Отсюда дёргают нити.',
      tier: 8,
      level: 9,
      ambient: 0.32,
      rows: MAP_F13_FLIES,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.6, 0.55, 0.66], mix: '#0c0814', k: 0.18 },
        fog: '#040308',
      },
      legend: LEGEND,
      paintAll: true,
      mine: 'f13mine2',
      spawn: spawnFlies,
    },
  ],
  boss: {
    id: 'f13boss',
    name: 'Кукловод',
    lead: 'Большая сцена под колосниками',
    area: F13_FLIES,
    restMs: 20 * 60_000,
    mob: 'f13boss',
    script: 'f13boss',
    parts: ['f13boss'],
    loot: (rnd) => ({
      tokens: 80 + Math.floor(rnd() * 50),
      keys: rnd() < 0.85 ? 1 : 0,
      coins: 70_000,
      mats: {
        f13_vaga: 1,
        f13mat: 5 + Math.floor(rnd() * 5),
        f13_mask: 2 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f13mine',
      name: 'Шахта под курительной',
      area: F13_FOYER,
      windowMs: 60 * 60_000,
      ores: [24, 25],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.6,
    },
    {
      id: 'f13mine2',
      name: 'Шахта в трюме',
      area: F13_FLIES,
      windowMs: 3 * 60 * 60_000,
      ores: [24, 25],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f13_candy', name: 'Театральная конфета', price: 70, heal: 0.28 },
    { id: 'f13_pie', name: 'Пирожное из буфета', price: 140, heal: 0.42 },
  ],
  mats: [
    {
      id: 'f13mat',
      name: 'Золотая нить',
      price: 520,
      lead: 'Срезана с марионетки. Тянется вверх, даже когда лежит на ладони.',
    },
    {
      id: 'f13_hinge',
      name: 'Шарнир марионетки',
      price: 620,
      lead: 'Латунный, на тонкой оси. Скрипит в такт музыке, которой нет.',
    },
    {
      id: 'f13_velvet',
      name: 'Лоскут бархата',
      price: 580,
      lead: 'Из занавеса или костюма. Пахнет пылью и пудрой.',
    },
    {
      id: 'f13_mask',
      name: 'Фарфоровая маска',
      price: 760,
      lead: 'Улыбается или плачет — смотря как повернуть к свету.',
    },
    {
      id: 'f13_ticket',
      name: 'Контрамарка',
      price: 900,
      lead: 'Бесплатный вход на любой спектакль. Дата не проставлена.',
    },
    {
      id: 'f13_vaga',
      name: 'Вага Кукловода',
      price: 70_000,
      lead: 'Трофей. Крестовина с оборванными золотыми нитями. Ещё тёплая.',
      stack: 1,
    },
  ],
  music: { explore: 'lobby', boss: 'boss' },
  cover: '/ui/areas/f13.png',
  flowR: 30,
};
