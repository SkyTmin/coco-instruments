// Этаж 12 — «Полярная ночь». Подземный север: пещеры голубого льда,
// огромное замёрзшее озеро и ледяной чертог, над сводом которого горит
// северное сияние — его свет пробивается сквозь лёд. Вечная ночь, тишина,
// мороз и красота: лёд светится и переливается, а тепло редко и дорого.
// Названия свои.
//
// ===========================================================================
// ДИЗАЙН-ДОКУМЕНТ
// ===========================================================================
//
// ГЛАГОЛ ЭТАЖА — ЛЁД И МОРОЗ. Меняет, КАК ты ходишь и дерёшься:
//   • СКОЛЬЖЕНИЕ. На льду и герой, и монстры идут по инерции: разгон
//     ~0,35 с, торможение ~0,8 с (с бега проезжаешь 2–3 клетки), поворот —
//     дугой, рывок уносит дальше. Снег, песок, коврики и камень тормозят —
//     там обычное управление. Лёд видно сразу: блеск, полосы бликов,
//     отражение героя в зеркальной глади, шорох конька (`f12_glide`).
//     Заманил моба на лёд — он проскочил мимо и подставил спину; тяжёлые
//     скользят дальше лёгких.
//   • ТОНКИЙ ЛЁД. Три стадии трещин, все видны: паутинка → трещины → белые
//     раны с водой. Трещит под тяжёлыми (масса ≥ 3), под рывком (+1 стадия
//     сразу), под долгим стоянием. Проломился — полынья (`deep`): герой
//     получает 8% и мороз и выбирается на последнюю твёрдую клетку; моб
//     уходит под лёд (`api.fall`, убийство в зачёт). Полынья затягивается
//     шугой и через ~25 с замерзает обратно (`setTile`) — снова тонкая.
//   • МОРОЗ. Вне тепла копится иней — три доли, их видно на герое
//     (изморозь на плечах → на голове → корка), изо рта идёт пар. Три
//     доли — ЗАМОРОЗКА на 1 с (ледяная глыба). Удар по замёрзшему
//     разбивает лёд: урон больше, но ты свободен. Тепло снимает иней:
//     жаровни, факелы, тёплые источники. Снежный дух дышит морозом.
//   • ДЕЙСТВИЯ ЭТАЖА (E8):
//       – жаровня «Зажечь» — свет на ходу (E2), круг тепла, вокруг тает лёд
//         (лёд → мокрый камень), вмёрзшие рядом оживают;
//       – ледяной затвор «Разбить» — три удара, открывает короткий путь;
//       – гонг сияния «Ударить в гонг» — вспышка сияния: невидимки видны,
//         монстры рядом ослеплены;
//       – лебёдка «Крутить» — доска за доской поднимает мост над полыньями.
//   • РОСТ ПО РАЙОНАМ: Грот — лёд и жаровни, мороз медленный; Озеро —
//     тонкий лёд, полыньи, тюлени, ледолом, мороз быстрее; Чертог — вьюга
//     (видимость падает, ветер со снегом толкает по льду) и всё вместе.
//     Арена — всё сразу: набег мамонта по льду, вьюга, ледниковый период,
//     сияние.
//
// РАЙОНЫ (снизу вверх; id старые, имена новые):
//   1. `f12` «Ледяной грот» — вход. Тёплая пещера с лифтом (жаровни
//      горят), развилка: западный Сосулечный ход → «Купол сияния»
//      (ЗАЛ-СОБЫТИЕ «СИЯНИЕ»: над тонким сводом раз в полминуты вспыхивает
//      сияние, ленты света ползут по залу, в их свете пикируют совы —
//      свет на ходу, E2); восточная Ледяная горка (длинный скат, ежи) →
//      «Зал вмёрзших» (ЗАЛ-СОБЫТИЕ «ОТТЕПЕЛЬ»: зажёг три жаровни — лёд
//      тает, открывается ниша с сундуком, но вмёрзшие воины оживают).
//      Шахта «Ледяная выработка», тайник за трещиной, КОРОТКИЙ ПУТЬ —
//      ледяной затвор с Перекрёстка в тёплую пещеру (бить только с севера).
//   2. `f12plat` «Замёрзшее озеро» — южный берег с рыбацким станом
//      (вмёрзшие лодки, лунки, тёплый источник, шахта «Под озером»),
//      гладь с островами, тонкими местами и полыньями (тюлени). РАЗВИЛКА:
//      запад — «Острова» через лебёдку моста; восток — «Протока»
//      (ЗАЛ-СОБЫТИЕ «ЛЕДОХОД»: по чёрной воде плывут льдины, переправа по
//      ним). Посередине — «Стремнина» (ЗАЛ-СОБЫТИЕ «ЛЕДОЛОМ»: шагнул на
//      середину — лёд за спиной трещит и рушится волной, беги к острову).
//      Тайник на островке среди тонкого льда. КОРОТКИЙ ПУТЬ — торосный лаз
//      сквозь гряду с северного берега к стану (затвор бьют изнутри).
//   3. `f12shrine` «Чертог вьюги» — Снежное поле перед дворцом
//      (ЗАЛ-СОБЫТИЕ «ВЬЮГА»: порывы с предупреждением, видимость падает,
//      заносы — укрытие, песцы в сугробах), развилка: Колоннада или
//      Ледяной сад статуй; «Зал гонга» (ЗАЛ-СОБЫТИЕ «БЕЗМОЛВИЕ»: огни
//      гаснут, видны только глаза; гонг — вспышка сияния); КОРОТКИЙ ПУТЬ —
//      ледяной жёлоб из Зала гонга к Вратам (затвор бьют сверху); тайник за
//      трещиной в саду; преддверие с табличкой и лифтом, арена «Чертог»
//      (лёд с узором, четыре жаровни по краю), печать и лестница.
//
// МОНСТРЫ (ИИ — `f12-brains.ts`, рисунок — `f12-art.ts`; сила — этаж 10
// ×1,2 базовыми числами, уровень районов 9):
//   • лемминг — мелочь стаей, на льду носится юзом;
//   • ледяной ёж — сворачивается шаром и катится по льду, отскакивает от
//     стен (на снегу вязнет и останавливается); после — кружится, открыт;
//   • тюлень-толкач — скользит на брюхе по линии и сталкивает героя
//     (сильный отброс — на тонкий лёд, в полынью); ныряет в полынью и
//     выныривает из другой рядом с героем (раскрывается у полыней);
//   • сосулька — висит на своде (видна только тень), герой под ней — тень
//     растёт, падает; вонзилась — открыта, потом крошится (раскрывается
//     на своём месте — своды ходов);
//   • полярная сова — бесшумная, в темноте видны только глаза; пикирует
//     по линии, потом уходит вверх (недосягаема); гонг и сияние её
//     показывают и сбивают;
//   • вмёрзший воин — стоит во льду статуей на своём месте; оживает, если
//     рядом зажгли жаровню или трижды ударили по глыбе; тяжёлый топор
//     конусом;
//   • снежный дух — летит к горящим жаровням и гасит их, дышит морозом
//     конусом (иней +1 доля); у горящей жаровни ему больно;
//   • песец-оборотень — прячется в сугробе (видны уши), прыгает из него
//     дугой, кусает серией и ныряет в ближний сугроб (раскрывается в
//     сугробах);
//   • ледяной голем — тяжёлый, бьёт кулаками оземь кольцом; под ним
//     трещит тонкий лёд (и под тобой) — заманил на тонкое, он провалился;
//   • ЭЛИТА — хранитель сияния: ледяной щит (урон ×0,3), который тает у
//     горящей жаровни и после его заклинания; режет занавесом сияния по
//     линии (перелив — честное предупреждение), зовёт духов;
//   • РЕДКИЙ — песец с мешком: удирает юзом, сыплет монеты.
// Свои места: сосульки (своды), вмёрзшие (посты), песцы (сугробы), тюлени
// (полыньи). Со льдом и морозом: ёж, тюлень, голем, дух, воин, хранитель.
//
// БОСС — «Ледниковый мамонт» с всадницей-шаманкой сияния (`f12boss`,
// дуэт). Мамонт 4×4: древний, в ледяной броне, снег на загривке, бивни —
// левый треснут (слабое место: в окнах трещина светится, удар ×2).
// Шаманка в мехах с бубном сидит на загривке, от неё тянутся ленты
// сияния. БОКОМ НЕ ХОДИТ: тело всегда туда, куда идёт; разворот плавный,
// на месте, всем телом (рисунок — любой угол, лист — 16 сторон), шаг
// четырёх ног — от пройденного пути; набег — только прямо.
// Засечки 75/50/25%, вход камерой (E9).
//   1. «НАБЕГ» — разворот к герою, роет ногой (линия на льду наливается),
//      несётся прямо по льду; затормозить не может — юзом в стену,
//      оглушён, бивень открыт (окно). Топот трясёт свод: сосульки падают
//      по теням. Вблизи — взмах бивнями (конус) и удар хоботом.
//   2. «ВЬЮГА» — шаманка бьёт в бубен: видимость падает, по арене
//      катятся снежные валы с проёмом (обойди), порывы толкают по льду.
//   3. «ЛЕДНИКОВЫЙ ПЕРИОД» — арена замерзает слоями от краёв (`setTile`),
//      из пола растут ледяные шипы линиями; мороз копится втрое быстрее;
//      четыре жаровни по краю — укрытие и тепло; мамонт идёт их тушить.
//   4. «СИЯНИЕ» — шаманка взмывает в небо; занавесы сияния режут арену
//      полосами (перелив — предупреждение); мамонт без всадницы в ярости
//      и набегает чаще; сбить шаманку (она снижается колдовать) — она
//      падает, мамонт оглушён — окно.
// Смерть — сценой: мамонт опускается на колени, лёд с брони осыпается,
// шаманка гасит сияние.
//
// ПАЛИТРА: ночной синий (`#0a1226`…`#1c2c52`), бирюза и зелень сияния
// (`#3ef0c8`, `#6cff9a`, `#8ad8ff`), белый снег с голубыми тенями
// (`#eef6ff` / `#9ab8e0`), голубой лёд (`#7cc8f0` блик `#e8fbff`), тёплые
// пятна жаровен — оранжевый (`#ff9a3a`, `#ffd27a`) как ценность.
//
// СНИМОК ДЛЯ ВИТРИНЫ: огромное озеро в ночи; лёд — тёмное стекло с
// бирюзовыми бликами сияния, в нём отражается герой; посреди глади —
// одинокая жаровня, круг оранжевого тепла на льду, вокруг тающая вода;
// из темноты пикирует сова — видны только жёлтые глаза; на заднем плане —
// вмёрзшая рыбацкая лодка и полынья с паром.
//
// Карта — `scripts/dungeon/f12.py` → `f12-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F12_GROTTO, MAP_F12_LAKE, MAP_F12_SHRINE } from './f12-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/**
 * Свои клетки этажа: номер вида для рисовальщика клеток и правил этажа.
 * Снег — вид 0 (пол без метки), его рисует этаж (`paintAll`).
 */
export const F12_MARK = {
  snow: 0,
  ice: 1,
  thin: 2,
  drift: 3,
  grit: 4,
  rug: 5,
  polish: 6,
  arena: 7,
  stone: 8,
  warm: 9,
  postWar: 10,
  postIce: 11,
  foxDrift: 12,
  hole: 13,
  sealHole: 14,
  water: 15,
  current: 16,
  bridge0: 17,
  spring: 18,
  // На ходу (ставит сценарий этажа).
  bridge: 19,
  holeNew: 20,
  melt: 21,
  glacier: 22,
  // Стены.
  crystalWall: 30,
  iceWall: 31,
  window: 32,
  banner: 33,
  iceGate: 34,
  gateSide: 35,
  meltWall: 36,
  icicles: 37,
} as const;

export const F12_GROTTO = 'f12';
export const F12_LAKE = 'f12plat';
export const F12_SHRINE = 'f12shrine';

/**
 * Первые мировые ряды районов: мир складывается снизу вверх, верхний район
 * (Чертог) начинается с нуля. Рисовальщику клеток видны только мировые ряды.
 */
export const F12_TOP = {
  [F12_SHRINE]: 0,
  [F12_LAKE]: MAP_F12_SHRINE.length,
  [F12_GROTTO]: MAP_F12_SHRINE.length + MAP_F12_LAKE.length,
} as Record<string, number>;

/** Геометрия залов в местных координатах районов (та же, что в f12.py). */
export const F12_GEO = {
  /** Купол сияния: круг. */
  dome: { area: F12_GROTTO, x: 14.5, y: 36.5, r: 9.5 },
  /** Зал вмёрзших: рамка; тающая стена ниши — ряд 26, x 48…52. */
  frozen: { area: F12_GROTTO, x0: 40, y0: 26, x1: 60, y1: 44, wallY: 26, wallX: [48, 52] },
  /** Протока (вода льдин) и её берега: посадка внизу, причал наверху. */
  channel: { area: F12_LAKE, x0: 41, y0: 42, x1: 52, y1: 70 },
  /** Стремнина «Ледолома». */
  rapids: { area: F12_LAKE, x0: 8, y0: 31, x1: 29, y1: 64 },
  /** Пролив и мост лебёдки. */
  strait: { area: F12_LAKE, y0: 28, y1: 30, bx0: 15, bx1: 17 },
  /** Снежное поле «Вьюги». */
  field: { area: F12_SHRINE, x: 32, y: 84, rx: 27, ry: 9.5 },
  /** Зал гонга «Безмолвия» и сам гонг. */
  gongHall: { area: F12_SHRINE, x0: 14, y0: 27, x1: 50, y1: 40, gx: 32, gy: 33 },
  /** Арена «Чертог»: середина и полуоси ледяного узора. */
  arena: { area: F12_SHRINE, x: 32.5, y: 9.5, rx: 13.5, ry: 7.2 },
} as const;

const M = F12_MARK;

// ---------------------------------------------------------------------------
// Легенды районов.
// ---------------------------------------------------------------------------

/** Сугроб: вязнешь. */
const DRIFT = { slow: 0.62 };

/** Общее у трёх районов. */
const COMMON: Record<string, LegendCell> = {
  i: { tile: 'floor', mark: M.ice },
  t: { tile: 'floor', mark: M.thin },
  s: { tile: 'hazard', mark: M.drift, hazard: DRIFT },
  d: { tile: 'hazard', mark: M.foxDrift, hazard: DRIFT },
  g: { tile: 'floor', mark: M.grit },
  r: { tile: 'floor', mark: M.rug },
  p: { tile: 'floor', mark: M.polish },
  I: { tile: 'floor', mark: M.arena },
  k: { tile: 'floor', mark: M.stone },
  H: { tile: 'floor', mark: M.warm },
  A: { tile: 'floor', mark: M.postWar },
  N: { tile: 'floor', mark: M.postIce },
  w: { tile: 'deep', mark: M.hole },
  z: { tile: 'deep', mark: M.sealHole },
  _: { tile: 'deep', mark: M.water },
  // Стены.
  Q: { tile: 'wall', mark: M.crystalWall, light: { r: 1.8, tint: 'teal' } },
  '|': { tile: 'wall', mark: M.iceWall },
  '?': { tile: 'wall', mark: M.window, light: { r: 2.8, tint: 'green' } },
  '5': { tile: 'wall', mark: M.banner },
  J: {
    tile: 'wall',
    mark: M.iceGate,
    obj: { kind: 'deco', ref: 'f12_icegate', solid: 0, use: { label: 'Разбить' } },
  },
  '/': { tile: 'wall', mark: M.gateSide },
  W: { tile: 'wall', mark: M.meltWall },
  Z: { tile: 'wall', mark: M.icicles },
  // Предметы.
  F: {
    tile: 'floor',
    mark: M.stone,
    obj: { kind: 'deco', ref: 'f12_brazier', solid: 0.42, use: { label: 'Зажечь' } },
  },
  f: {
    tile: 'floor',
    mark: M.stone,
    obj: { kind: 'deco', ref: 'f12_hearth', solid: 0.42 },
    light: { r: 5.2, tint: 'warm' },
  },
  '8': {
    tile: 'floor',
    // Свет ставит правило этажа (`f12t:id`): дух и «Безмолвие» его гасят.
    obj: { kind: 'deco', ref: 'f12_torch', solid: 0.2 },
  },
  O: { tile: 'floor', mark: M.polish, obj: { kind: 'deco', ref: 'f12_column', solid: 0.5 } },
  U: { tile: 'floor', obj: { kind: 'breakable', ref: 'f12_crate', solid: 0.38, hp: 2 } },
  V: { tile: 'floor', obj: { kind: 'breakable', ref: 'f12_barrel', solid: 0.34, hp: 3 } },
  j: { tile: 'floor', mark: M.ice, obj: { kind: 'deco', ref: 'f12_boat', solid: 0.7 } },
  e: { tile: 'floor', obj: { kind: 'deco', ref: 'f12_tent', solid: 0.8 } },
  m: { tile: 'floor', obj: { kind: 'deco', ref: 'f12_rack', solid: 0.4 } },
  q: {
    tile: 'floor',
    mark: M.ice,
    obj: { kind: 'deco', ref: 'f12_fishhole', solid: 0, flat: true },
  },
  x: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f12_crystals', solid: 0.36 },
    light: { r: 2.4, tint: 'teal' },
  },
  y: { tile: 'floor', mark: M.ice, obj: { kind: 'deco', ref: 'f12_stalag', solid: 0.36 } },
  '0': {
    tile: 'floor',
    mark: M.rug,
    obj: { kind: 'deco', ref: 'f12_gong', solid: 0.6, use: { label: 'Ударить в гонг' } },
    light: { r: 3.2, tint: 'teal' },
  },
  '1': {
    tile: 'floor',
    mark: M.stone,
    obj: { kind: 'deco', ref: 'f12_winch', solid: 0.45, use: { label: 'Крутить' } },
  },
  '3': { tile: 'floor', mark: M.ice, obj: { kind: 'deco', ref: 'f12_statue', solid: 0.5 } },
  '4': {
    tile: 'floor',
    mark: M.stone,
    obj: { kind: 'deco', ref: 'f12_runestone', solid: 0.45 },
    light: { r: 2.6, tint: 'green' },
  },
  '6': { tile: 'floor', obj: { kind: 'breakable', ref: 'f12_sled', solid: 0.42, hp: 2 } },
  '7': {
    tile: 'floor',
    mark: M.ice,
    obj: { kind: 'breakable', ref: 'f12_icechunk', solid: 0.44, hp: 4, loot: 'f12_crystal' },
  },
  '9': {
    tile: 'floor',
    mark: M.warm,
    obj: { kind: 'deco', ref: 'f12_steam', solid: 0, flat: true },
  },
  // Рёбра мамонта, вмёрзшие в снег.
  b: { tile: 'floor', obj: { kind: 'deco', ref: 'f12_bones', solid: 0.45 } },
  // Тотем шаманки: ленты сияния на ветру.
  c: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f12_totem', solid: 0.3 },
    light: { r: 2.2, tint: 'green' },
  },
};

const LEGEND_GROTTO: Record<string, LegendCell> = { ...COMMON };

const LEGEND_LAKE: Record<string, LegendCell> = {
  ...COMMON,
  // Протока: вода, по которой идут льдины. Ступить можно — и упасть, если
  // под ногами нет льдины (сценарий этажа).
  ':': { tile: 'hazard', mark: M.current },
  // Вода под мостом лебёдки: доски поднимает сценарий.
  '2': { tile: 'deep', mark: M.bridge0 },
  h: { tile: 'deep', mark: M.spring, light: { r: 2.2, tint: 'warm' } },
};

const LEGEND_SHRINE: Record<string, LegendCell> = { ...COMMON };

// ---------------------------------------------------------------------------
// Монстры. Сила — этаж 10 ×1,2 базовыми числами (уровень районов 9).
// ---------------------------------------------------------------------------

const GORE_ICE = ['#1c3a5c', '#7cc8f0', '#e8fbff', '#0e1e34'];
const GORE_FUR = ['#5a2a2a', '#b84848', '#eef6ff', '#2a1414'];

const MOBS: MobDef[] = [
  {
    id: 'f12_lemming',
    name: 'Лемминг',
    many: 'леммингов',
    hp: 16,
    dmg: 9,
    speed: 4.6,
    radius: 0.24,
    windup: 0.42,
    reach: 0.5,
    rest: 0.6,
    xp: 6,
    meat: ['f12_fish', 0.12, 1],
    mats: [['f12_fur', 0.06]],
    beast: true,
    brain: 'f12_lemming',
    art: { kind: 'paint', id: 'f12_lemming' },
    mass: 0.5,
    flinch: 1,
    eye: '#1a0e08',
    gore: GORE_FUR,
  },
  {
    id: 'f12_urchin',
    name: 'Ледяной ёж',
    many: 'ледяных ежей',
    hp: 34,
    dmg: 16,
    speed: 2.6,
    radius: 0.34,
    windup: 0.55,
    reach: 0.6,
    rest: 0.9,
    xp: 14,
    meat: null,
    mats: [
      ['f12_quill', 0.3],
      ['f12mat', 0.12],
    ],
    beast: true,
    brain: 'f12_urchin',
    art: { kind: 'paint', id: 'f12_urchin' },
    mass: 1.4,
    flinch: 0.5,
    stunT: 0.3,
    eye: '#8af0ff',
    gore: GORE_ICE,
  },
  {
    id: 'f12_seal',
    name: 'Тюлень-толкач',
    many: 'тюленей-толкачей',
    hp: 60,
    dmg: 22,
    speed: 2.2,
    radius: 0.46,
    windup: 0.7,
    reach: 0.8,
    rest: 1,
    xp: 18,
    meat: ['f12_fish', 0.5, 1],
    mats: [['f12mat', 0.18]],
    beast: true,
    brain: 'f12_seal',
    art: { kind: 'paint', id: 'f12_seal' },
    mass: 3,
    flinch: 0.25,
    stunT: 0.35,
    hit: { push: 9 },
    eye: '#101820',
    gore: ['#2a3a4a', '#6a8aa8', '#c8d8e8', '#141c24'],
  },
  {
    id: 'f12_icicle',
    name: 'Сосулька',
    many: 'сосулек',
    hp: 22,
    dmg: 24,
    speed: 0,
    radius: 0.3,
    windup: 0.8,
    reach: 0.9,
    rest: 1,
    xp: 10,
    meat: null,
    mats: [['f12mat', 0.22]],
    beast: true,
    brain: 'f12_icicle',
    art: { kind: 'paint', id: 'f12_icicle' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    gore: GORE_ICE,
  },
  {
    id: 'f12_owl',
    name: 'Полярная сова',
    many: 'полярных сов',
    hp: 30,
    dmg: 17,
    speed: 4.2,
    radius: 0.34,
    windup: 0.55,
    reach: 0.7,
    rest: 1.1,
    xp: 15,
    meat: null,
    mats: [
      ['f12_fur', 0.2],
      ['f12mat', 0.1],
    ],
    beast: true,
    brain: 'f12_owl',
    art: { kind: 'paint', id: 'f12_owl' },
    mass: 0.8,
    flinch: 0.7,
    fly: true,
    eye: '#ffd23a',
    gore: ['#6a7a8a', '#eef6ff', '#c8d4e0', '#2a3440'],
  },
  {
    id: 'f12_warrior',
    name: 'Вмёрзший воин',
    many: 'вмёрзших воинов',
    hp: 64,
    dmg: 24,
    speed: 2.5,
    radius: 0.4,
    windup: 0.75,
    reach: 1.15,
    rest: 1,
    xp: 20,
    meat: null,
    mats: [
      ['f12mat', 0.3],
      ['f12_crystal', 0.06],
    ],
    beast: true,
    brain: 'f12_warrior',
    art: { kind: 'paint', id: 'f12_warrior' },
    mass: 3,
    flinch: 0.2,
    stunT: 0.3,
    eye: '#8ad8ff',
    gore: GORE_ICE,
  },
  {
    id: 'f12_spirit',
    name: 'Снежный дух',
    many: 'снежных духов',
    hp: 30,
    dmg: 12,
    speed: 3.4,
    radius: 0.32,
    windup: 0.6,
    reach: 2.4,
    rest: 1.2,
    xp: 14,
    meat: null,
    mats: [['f12_crystal', 0.12]],
    beast: true,
    brain: 'f12_spirit',
    art: { kind: 'paint', id: 'f12_spirit' },
    mass: 0.6,
    flinch: 0.8,
    fly: true,
    noAlbino: true,
    eye: '#bff8ff',
    light: 1.4,
    gore: ['#9ab8e0', '#eef6ff', '#ffffff', '#5a78a8'],
  },
  {
    id: 'f12_fox',
    name: 'Песец-оборотень',
    many: 'песцов-оборотней',
    hp: 34,
    dmg: 18,
    speed: 4.8,
    radius: 0.32,
    windup: 0.45,
    reach: 0.75,
    rest: 0.7,
    xp: 16,
    meat: ['f12_fish', 0.15, 1],
    mats: [['f12_fur', 0.35]],
    beast: true,
    brain: 'f12_fox',
    art: { kind: 'paint', id: 'f12_fox' },
    mass: 1,
    flinch: 0.6,
    eye: '#ffb84a',
    gore: GORE_FUR,
  },
  {
    id: 'f12_golem',
    name: 'Ледяной голем',
    many: 'ледяных големов',
    hp: 96,
    dmg: 26,
    speed: 1.9,
    radius: 0.62,
    windup: 0.9,
    reach: 1.2,
    rest: 1.2,
    xp: 30,
    meat: null,
    mats: [
      ['f12mat', 0.45],
      ['f12_crystal', 0.15],
    ],
    beast: true,
    brain: 'f12_golem',
    art: { kind: 'paint', id: 'f12_golem' },
    mass: 6,
    flinch: 0.1,
    stunT: 0.25,
    eye: '#6cf0ff',
    light: 1.2,
    gore: GORE_ICE,
  },
  {
    id: 'f12_keeper',
    name: 'Хранитель сияния',
    many: 'хранителей сияния',
    hp: 80,
    dmg: 22,
    speed: 2.4,
    radius: 0.4,
    windup: 0.8,
    reach: 5,
    rest: 1.4,
    xp: 40,
    meat: ['f12_tea', 0.4, 1],
    mats: [
      ['f12_crystal', 0.5],
      ['f12mat', 0.3],
    ],
    beast: true,
    brain: 'f12_keeper',
    art: { kind: 'paint', id: 'f12_keeper' },
    mass: 2,
    flinch: 0.3,
    noAlbino: true,
    eye: '#6cff9a',
    light: 2,
    gore: ['#1c2c52', '#3ef0c8', '#e8fbff', '#0a1226'],
  },
  {
    id: 'f12_sackfox',
    name: 'Песец с мешком',
    many: 'песцов с мешком',
    hp: 26,
    dmg: 8,
    speed: 5.4,
    radius: 0.28,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 36,
    meat: null,
    mats: [
      ['f12_fur', 0.6],
      ['f12_crystal', 0.3],
    ],
    beast: true,
    brain: 'f12_sackfox',
    art: { kind: 'paint', id: 'f12_sackfox' },
    mass: 0.8,
    flinch: 1,
    coins: 2000,
    resume: 'flee',
    eye: '#ffb84a',
    gore: GORE_FUR,
  },
  {
    id: 'f12_shaman',
    name: 'Шаманка сияния',
    many: 'шаманок сияния',
    hp: 90,
    dmg: 16,
    speed: 3,
    radius: 0.36,
    windup: 0.7,
    reach: 6,
    rest: 1.2,
    xp: 60,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f12_shaman',
    art: { kind: 'paint', id: 'f12_shaman' },
    mass: 1.2,
    flinch: 0.4,
    fly: true,
    noAlbino: true,
    eye: '#6cff9a',
    light: 2.2,
    gore: ['#3a2418', '#c88a4a', '#3ef0c8', '#1c120c'],
  },
  {
    id: 'f12boss',
    name: 'Ледниковый мамонт',
    many: 'ледниковых мамонтов',
    hp: 1250,
    dmg: 24,
    speed: 2.3,
    radius: 1.45,
    windup: 0.85,
    reach: 1.6,
    rest: 1,
    xp: 1200,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f12boss',
    art: { kind: 'paint', id: 'f12boss' },
    mass: 20,
    boss: true,
    noAlbino: true,
    eye: '#8ad8ff',
    light: 2.4,
    gore: ['#3a2418', '#7a4a2a', '#e8fbff', '#1c120c'],
  },
];

/** Грот: лемминги из нор, ежи на горке, совы и сосульки. */
const spawnGrotto: SpawnSpec = {
  mobs: [
    ['f12_lemming', 40],
    ['f12_urchin', 30],
    ['f12_owl', 14],
    ['f12_golem', 8],
    ['f12_spirit', 8],
  ],
  density: 0.7,
  pack: [1, 2],
  filler: 'f12_lemming',
  group: (i) => (i < 1 ? 'f12_urchin' : 'f12_lemming'),
  horde: null,
  treasure: 'f12_sackfox',
  nest: () => 'f12_lemming',
};

const spawnLake: SpawnSpec = {
  ...spawnGrotto,
  mobs: [
    ['f12_lemming', 30],
    ['f12_urchin', 22],
    ['f12_owl', 18],
    ['f12_fox', 14],
    ['f12_golem', 10],
    ['f12_spirit', 6],
  ],
  density: 0.74,
  filler: 'f12_lemming',
  group: (i) => (i < 1 ? 'f12_golem' : i < 3 ? 'f12_urchin' : 'f12_lemming'),
};

const spawnShrine: SpawnSpec = {
  ...spawnGrotto,
  mobs: [
    ['f12_spirit', 26],
    ['f12_fox', 22],
    ['f12_owl', 16],
    ['f12_urchin', 14],
    ['f12_golem', 12],
    ['f12_keeper', 6],
  ],
  density: 0.78,
  filler: 'f12_spirit',
  group: (i) => (i < 1 ? 'f12_keeper' : i < 3 ? 'f12_fox' : 'f12_spirit'),
};

export const F12: FloorDef = {
  id: 12,
  name: 'Полярная ночь',
  lead: 'Подземный север: лёд, снег и вечная ночь. Сквозь свод светит сияние.',
  mapVer: 2,
  areas: [
    {
      id: F12_GROTTO,
      name: 'Ледяной грот',
      lead: 'Пещеры голубого льда. Скользко, а тепло — только у жаровен.',
      tier: 8,
      level: 9,
      ambient: 0.46,
      rows: MAP_F12_GROTTO,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.62, 0.78, 1], mix: '#0a1838', k: 0.2 },
        fog: '#040814',
      },
      legend: LEGEND_GROTTO,
      paintAll: true,
      mine: 'f12mine',
      spawn: spawnGrotto,
    },
    {
      id: F12_LAKE,
      name: 'Замёрзшее озеро',
      lead: 'Гладь до самой темноты. Тонкий лёд трещит, в полыньях — тюлени.',
      tier: 8,
      level: 9,
      ambient: 0.4,
      rows: MAP_F12_LAKE,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.58, 0.74, 1], mix: '#081430', k: 0.22 },
        fog: '#030712',
      },
      legend: LEGEND_LAKE,
      paintAll: true,
      mine: 'f12mine2',
      spawn: spawnLake,
    },
    {
      id: F12_SHRINE,
      name: 'Чертог вьюги',
      lead: 'Ледяной дворец под сиянием. Здесь метёт даже под крышей.',
      tier: 8,
      level: 9,
      ambient: 0.44,
      rows: MAP_F12_SHRINE,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.66, 0.8, 1], mix: '#0c1a3a', k: 0.2 },
        fog: '#040816',
      },
      legend: LEGEND_SHRINE,
      paintAll: true,
      spawn: spawnShrine,
    },
  ],
  boss: {
    id: 'f12boss',
    name: 'Ледниковый мамонт',
    lead: 'Чертог под сиянием, лёд с узором',
    area: F12_SHRINE,
    restMs: 20 * 60_000,
    mob: 'f12boss',
    script: 'f12boss',
    parts: ['f12boss'],
    loot: (rnd) => ({
      tokens: 80 + Math.floor(rnd() * 40),
      keys: rnd() < 0.85 ? 1 : 0,
      coins: 72_000,
      mats: {
        f12_tusk: 1,
        f12mat: 5 + Math.floor(rnd() * 5),
        f12_crystal: 2 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f12mine',
      name: 'Ледяная выработка',
      area: F12_GROTTO,
      windowMs: 60 * 60_000,
      ores: [22, 23],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.6,
    },
    {
      id: 'f12mine2',
      name: 'Шахта под озером',
      area: F12_LAKE,
      windowMs: 3 * 60 * 60_000,
      ores: [22, 23],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f12_fish', name: 'Мороженая рыба', price: 80, heal: 0.3 },
    { id: 'f12_tea', name: 'Брусничный сбитень', price: 150, heal: 0.45 },
  ],
  mats: [
    {
      id: 'f12mat',
      name: 'Осколок вечного льда',
      price: 520,
      lead: 'Не тает даже в ладони. Внутри — пузырьки воздуха тысячелетней давности.',
    },
    {
      id: 'f12_fur',
      name: 'Песцовый мех',
      price: 600,
      lead: 'Густой, белый, с голубым отливом. Греет, даже мокрый.',
    },
    {
      id: 'f12_quill',
      name: 'Ледяная игла',
      price: 640,
      lead: 'Игла ледяного ежа. Холодит пальцы сквозь рукавицу.',
    },
    {
      id: 'f12_crystal',
      name: 'Кристалл сияния',
      price: 760,
      lead: 'Внутри медленно переливаются зелёные ленты, как в небе.',
    },
    {
      id: 'f12_tusk',
      name: 'Бивень мамонта',
      price: 72_000,
      lead: 'Трофей. Треснутый бивень Ледникового мамонта, тяжёлый, как бревно.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f12.png',
  flowR: 30,
};
