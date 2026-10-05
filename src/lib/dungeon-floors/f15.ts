// Этаж 15 «Ядро подземелья» — ФИНАЛ, половина агента «Мир».
//
// На дне подземелья лежит упавшая звезда. Подземелье выросло вокруг неё:
// её свет кристаллизовал породу, кристаллы рождают монстров и хранят
// память обо всём, что было выше. Не утроба и не ад — красота и величие:
// глубокий индиго и фиолет, холодный голубой свет кристаллов, золото звёзд
// и редкие тёплые искры. Совсем другой цвет, чем дневное небо 11-го и
// латунь 14-го.
//
// ГЛАГОЛ — ГРАВИТАЦИЯ. Он меняет, КАК ты ходишь и дерёшься:
//   • колодцы — осколки звезды в кратерах — тянут героя, монстров, снаряды
//     и добычу. Колодец видно: воронка искр, сетка пола выгнута к ядру.
//     Перед включением он предупреждает (секунда: искры закручиваются,
//     кольца сходятся), потом тянет 3 с и стихает. Сердцевина жжёт.
//     Монстра, которого затянуло в сердцевину, звезда сминает — заманивай;
//   • снаряды огибают колодец по дуге: звездочёт стреляет «за угол», а
//     отбитый мечом снаряд (на этом этаже клинок отбивает снаряды) сам
//     заходит врагам за спину, огибая ядро;
//   • рычаг колодца переключает «тянет / толкает»: толкающий колодец
//     отводит чужие снаряды и раздвигает проход;
//   • орбиты — каменные острова ходят по кругу вокруг ядра-колодца по такту
//     (ход — стоянка у причала). Перебегаешь, пока остров у края; якорь на
//     причале цепляет световым тросом и дёргает тебя на остров;
//   • невесомость (пол с плывущей пылью): рывок длиннее, торможения нет —
//     скользишь по инерции, у края пустоты легко сорваться (8% и возврат
//     на твёрдое со вспышкой); монстры плывут, отбитые улетают в пустоту;
//   • тяжесть (тёмная сетка): идёшь медленнее, но удар тяжелее (×1,4).
// Растёт по районам: в Корнях — одиночные колодцы; в Обсерватории —
// телескоп и игра со светом, рычаги, звездопад; на Орбитах — острова,
// невесомость и тяжесть вместе. Дальше — бой «Сердца».
//
// РАЙОНЫ (снизу вверх; id старые — на них лифты и шахты):
//   • «Кристальные корни» (`f15`, вход) — пещера, где порода переходит в
//     кристалл. Устье жилы с лифтом и шахтой, Первый осколок (колодец
//     учит тяге), Жила, развилка: Друзы (круглые жеоды, кристаллы памяти,
//     тайник за трещиной) или Провал осколков (короче: тропа над
//     кристальной бездной мимо трёх колодцев по очереди). Залы-события:
//     «ПРОБУЖДЕНИЕ ОСКОЛКА» — спящий осколок в кратере просыпается,
//     колодец бьёт волнами, из стен лезут метеор-жуки, их тараны гнёт к
//     ядру; «ГАЛЕРЕЯ ПАМЯТИ» — стены в кристаллах памяти, они вспыхивают
//     по очереди и выпускают отражения прошлых этажей, свет зала живёт с
//     ними. Старый штрек за решёткой — короткий путь назад к лифту.
//   • «Обсерватория строителей» (`f15gut`) — древняя обсерватория:
//     купола, латунные кольца армиллярных сфер, звёздные карты на полу,
//     телескопы. Звёздная дверь закрыта, пока телескоп не наведён на
//     созвездие Ключа (луч звёздного света — дверь тает). Колодезная с
//     двумя рычагами. Звёздные карты на полу — места стражей созвездий.
//     Развилка: Купольный ход или Архив карт (тайник). Залы-события:
//     «ЗВЕЗДОПАД» — купол раскрывается, звёзды падают по меткам, свет
//     летит вместе с ними, упавшая звезда на миг становится колодцем;
//     «ЗАТМЕНИЕ» — в Зале планетария гаснет свет, выходят пожиратели света;
//     зажжённые кристаллы — островки безопасности, большой телескоп
//     возвращает солнце. Служебная лестница с решёткой — короткий путь.
//   • «Пояс орбит» (`f15veins`) — пустота вокруг ядра, звёздная пыль,
//     острова-обломки. Причал, Малые орбиты (обход по кромке или верхом
//     на острове), шахта на обломке. Залы-события: «ПАРАД ПЛАНЕТ» — три
//     кольца островов выстраиваются в мост через пустоту (единственная
//     дорога, кроме якорей); «ГРАВИТАЦИОННЫЙ ШТОРМ» — ядро вспыхивает, и
//     зал по очереди то тяжелеет, то теряет вес: в тяжести бей, в
//     невесомости сталкивай врагов в пустоту. Развилка: Кольцо пыли
//     (тайник) или Обломочный мост; решётка назад к причалу. Наверху —
//     тихое Преддверие ядра и стык с «Сердцем» (столбцы `F15_JOIN`).
//
// МОНСТРЫ (ИИ — `f15-brains.ts`, рисунок — `f15-art.ts`), сила — этаж 10
// ×1,5 базовыми числами, районы на уровне 9:
//   • кристальный ёж — сворачивается в шар и катится (у колодца путь
//     гнётся), раскрывшись — веер игл;
//   • метеор-жук — панцирь из метеорита, прицел линией и таран; о стену —
//     оглушён; на островах таран сбрасывает;
//   • комета-гончая — рывок по ДУГЕ вокруг колодца: заходит сбоку по
//     светящейся дуге (раскрывается у колодцев), без колодца — короткий
//     выпад;
//   • гравитонный страж — тяжёлый, удар кулаком оставляет зону тяжести;
//     щит гасит обычные удары, а из тяжести ты бьёшь сквозь;
//   • звездочёт — маг: ставит малый колодец под ноги (кольцо за секунду),
//     звёздные стрелы гнутся к колодцам; три камня на орбите вокруг него
//     отводят удары — бей в просвет;
//   • страж созвездия — фигура из звёзд и линий на звёздной карте пола:
//     спит рисунком, встаёт, когда ступишь на карту. Бить можно только
//     узлы-звёзды, линии неуязвимы и жгут, когда фигура хлещет ими;
//   • пожиратель света — тёмный силуэт Обсерватории: гасит кристаллы и
//     лампы вокруг, во тьме неуязвим (сквозь него проходит клинок), в
//     свете — уязвим. Зажги кристалл рядом — и бей;
//   • отражение — монстр прошлого этажа из кристалла памяти (крыса, гриб,
//     саламандра, призрак, скат, солдатик): рисунок тех этажей,
//     перекрашенный звёздным светом и кристаллом вместо плоти;
//   • спутник — малая луна: кружит вокруг героя (или колодца) по орбите,
//     сужает её спиралью и бьёт с пике; летает над пустотой;
//   • сверхновая (элита) — звёздный голем: копит свет и вспыхивает
//     кольцом; погибнув, схлопывается в колодец на 6 с;
//   • золотой метеорит (редкий) — удирает с мешком монет, закручиваясь
//     вокруг колодцев.
//
// БОСС — у агента «Сердце» (`f15-boss.ts`, его шапка): пять фаз на арене
// над Поясом орбит. Этот файл только собирает этаж: районы «Мира» снизу,
// `F15_HEART_AREA` сверху, `F15_BOSS`, монстры, мясо и материалы «Сердца».
// Правила этажа (`registerFloor(15)`) — «Мира» и в районе «Сердце» молчат.
//
// ПАЛИТРА: порода — индиго (#120c2a…#3a2e6a), кристалл — холодный голубой
// (#3a8ad8, #7cd0ff, #d8f6ff), звёзды и латунь — золото (#c89a3a,
// #ffd56a, #fff4c0), искры — тёплые (#ff9a4a), пустота — ночь с туманностью
// (#05030e, #2a1450, #5a2a8a). Свет: cold и teal у кристаллов, violet у
// пустоты, warm — только звёзды, латунь и искры.
//
// СНИМОК ДЛЯ ВИТРИНЫ: герой стоит на каменном острове посреди звёздной
// пустоты; вокруг по кругу идут обломки, в центре пылает голубое
// ядро-колодец, к нему спиралью тянутся золотые искры, сетка пола выгнута
// воронкой; комета-гончая заходит по дуге вокруг ядра, оставляя голубой
// хвост; на ближнем причале — кристалл памяти, внутри которого кипит лава
// шестого этажа.
//
// Карта — `scripts/dungeon/f15.py` → `f15-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { F15_BOSS, F15_BOSS_MATS, F15_BOSS_MEATS, F15_BOSS_MOBS, F15_HEART_AREA } from './f15-boss';
import { F15_GUT_MAP, F15_SPOTS, F15_THROAT_MAP, F15_VEINS_MAP } from './f15-map';
import type { AreaSpec, FloorDef, HazardSpec, LegendCell, SpawnSpec } from './types';

/** Районы «Мира». `f15` — вход: на нём могут стоять сохранения игроков. */
export const F15_THROAT = 'f15';
export const F15_GUT = 'f15gut';
export const F15_VEINS = 'f15veins';
export const F15_WORLD_AREAS = [F15_THROAT, F15_GUT, F15_VEINS] as const;

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F15_MARK = {
  flesh: 1,
  ring: 2,
  vein: 3,
  node: 4,
  mucus: 5,
  fold: 6,
  acid: 7,
  shallow: 8,
  ring1: 9,
  ring2: 10,
  ring3: 11,
  blood: 12,
  flowN: 13,
  flowS: 14,
  flowW: 15,
  flowE: 16,
  gore: 17,
  bones: 18,
  vessel: 19,
  scar: 20,
  debris: 21,
  band: 22,
  valve: 23,
  clot: 24,
  leaflet: 25,
  door: 26,
  lymphDoor: 27,
  // Стены.
  wall: 40,
  relic: 41,
  polyp: 42,
  eye: 43,
  tendril: 44,
  artery: 45,
  // Сменённые на ходу (`setTile`).
  acidRise: 50,
  clotWall: 51,
  shut: 52,
} as const;

const M = F15_MARK;

/** Опасности клеток: сок, мелкий сок, слизь, течение. */
export const F15_HAZ: Record<string, HazardSpec> = {
  shallow: { status: 'poison', dur: 1.4, dps: 0.012, slow: 0.82 },
  acid: { status: 'poison', dur: 2, dps: 0.07, slow: 0.62 },
  mucus: { slow: 0.74 },
  flow: { slow: 0.92 },
};

/** Течение клетки (складки и русло): куда толкает удар сердца. */
export const F15_FLOW: Partial<Record<number, [number, number]>> = {
  [M.flowN]: [0, -1],
  [M.flowS]: [0, 1],
  [M.flowW]: [-1, 0],
  [M.flowE]: [1, 0],
};

type Tint = 'warm' | 'cold' | 'teal' | 'red' | 'violet' | 'green';

const prop = (
  ref: string,
  solid: number,
  extra: Partial<NonNullable<LegendCell['obj']>> = {},
): NonNullable<LegendCell['obj']> => ({ kind: 'deco', ref, solid, ...extra });

/** Свои буквы карты. `polyp` — оттенок светляков района. */
function legendOf(polyp: Tint): Record<string, LegendCell> {
  return {
    // Пол.
    '.': { tile: 'floor', mark: M.flesh },
    r: { tile: 'floor', mark: M.ring },
    y: { tile: 'floor', mark: M.vein },
    j: { tile: 'floor', mark: M.node, obj: prop('f15_node', 0, { flat: true }) },
    m: { tile: 'hazard', mark: M.mucus, hazard: F15_HAZ.mucus },
    f: { tile: 'floor', mark: M.fold },
    _: { tile: 'deep', mark: M.acid },
    ':': { tile: 'hazard', mark: M.shallow, hazard: F15_HAZ.shallow },
    '1': { tile: 'floor', mark: M.ring1 },
    '3': { tile: 'floor', mark: M.ring2 },
    '5': { tile: 'floor', mark: M.ring3 },
    h: { tile: 'deep', mark: M.blood },
    '8': { tile: 'hazard', mark: M.flowN, hazard: F15_HAZ.flow },
    '2': { tile: 'hazard', mark: M.flowS, hazard: F15_HAZ.flow },
    '4': { tile: 'hazard', mark: M.flowW, hazard: F15_HAZ.flow },
    '6': { tile: 'hazard', mark: M.flowE, hazard: F15_HAZ.flow },
    x: { tile: 'floor', mark: M.gore },
    k: { tile: 'floor', mark: M.bones },
    e: { tile: 'floor', mark: M.vessel },
    z: { tile: 'floor', mark: M.scar },
    d: { tile: 'floor', mark: M.debris },
    // Дышащая кромка, сфинктеры, сгусток, створки: пол, на котором стоит
    // «живая» стенка (предмет): сомкнулась — держит, как стена.
    w: { tile: 'floor', mark: M.band, obj: prop('f15_band', 0) },
    s: { tile: 'floor', mark: M.valve, obj: prop('f15_valve', 0) },
    Q: { tile: 'floor', mark: M.door, obj: prop('f15_door', 0) },
    H: { tile: 'floor', mark: M.lymphDoor, obj: prop('f15_lymphdoor', 0.5) },
    t: { tile: 'floor', mark: M.clot },
    q: { tile: 'floor', mark: M.leaflet, obj: prop('f15_leaflet', 0) },
    // Стены.
    '#': { tile: 'wall', mark: M.wall },
    O: { tile: 'wall', mark: M.relic },
    F: {
      tile: 'wall',
      mark: M.polyp,
      obj: prop('f15_polyp', 0),
      light: { r: 3.2, tint: polyp },
    },
    J: { tile: 'wall', mark: M.eye, obj: prop('f15_walleye', 0) },
    I: { tile: 'wall', mark: M.tendril, obj: prop('f15_tendrils', 0) },
    V: {
      tile: 'wall',
      mark: M.artery,
      obj: prop('f15_artery', 0),
      light: { r: 2.2, tint: 'red' },
    },
    // Предметы: живое.
    '^': { tile: 'floor', obj: prop('f15_spike', 0.26) },
    '&': { tile: 'floor', obj: prop('f15_rib', 0.42) },
    '*': { tile: 'floor', obj: { kind: 'breakable', ref: 'f15_cyst', solid: 0.3, hp: 2 } },
    '-': {
      tile: 'floor',
      mark: M.gore,
      obj: { kind: 'breakable', ref: 'f15_eggs', solid: 0.28, hp: 1, loot: 'f15_lymph' },
    },
    '+': { tile: 'floor', mark: M.gore, obj: prop('f15_clot', 0.36) },
    '|': {
      tile: 'floor',
      obj: prop('f15_heartpod', 0.32),
      light: { r: 2.4, tint: 'red' },
    },
    // Переваренное: обломки прошлых этажей.
    '(': { tile: 'floor', mark: M.debris, obj: prop('f15_cart', 0.42) },
    '}': {
      tile: 'floor',
      obj: prop('f15_shrooms', 0.28),
      light: { r: 2.4, tint: 'green' },
    },
    '{': { tile: 'floor', obj: prop('f15_druse', 0.34), light: { r: 2.6, tint: 'teal' } },
    '7': { tile: 'floor', mark: M.bones, obj: prop('f15_skull', 0.5) },
    '9': { tile: 'floor', obj: prop('f15_obsidian', 0.4), light: { r: 2, tint: 'red' } },
    ']': { tile: 'floor', obj: prop('f15_mirror', 0.3), light: { r: 1.4, tint: 'cold' } },
    '[': { tile: 'floor', mark: M.debris, obj: prop('f15_shoji', 0.34) },
    U: { tile: 'floor', obj: prop('f15_rune', 0.34), light: { r: 1.8, tint: 'teal' } },
    '/': { tile: 'floor', mark: M.debris, obj: prop('f15_blade', 0.2) },
    '<': { tile: 'floor', obj: prop('f15_vane', 0.3) },
    '?': { tile: 'floor', mark: M.debris, obj: prop('f15_sign', 0.3) },
    '0': { tile: 'floor', mark: M.debris, obj: prop('f15_cannon', 0.44) },
    ')': { tile: 'floor', mark: M.debris, obj: prop('f15_gear', 0.42) },
    // Действия этажа.
    g: {
      tile: 'floor',
      mark: M.mucus,
      obj: prop('f15_gland', 0.36, { use: { label: 'Выдавить слизь' } }),
      light: { r: 1.6, tint: 'green' },
    },
    N: {
      tile: 'floor',
      obj: prop('f15_nervecord', 0.28, { use: { label: 'Дёрнуть нерв' } }),
      light: { r: 1.5, tint: 'violet' },
    },
    W: {
      tile: 'floor',
      obj: prop('f15_wheel', 0.34, { use: { label: 'Сжать вену' } }),
    },
  };
}

// ---------------------------------------------------------------------------
// Посты и залы-события: `F15_SPOTS` из карты («вид район x y …»).
// ---------------------------------------------------------------------------

export interface F15Spot {
  kind: string;
  area: string;
  x: number;
  y: number;
  /** Для рамок (`box`): имя и правый нижний угол. */
  name?: string;
  x1?: number;
  y1?: number;
}

export const F15_SPOT_LIST: F15Spot[] = F15_SPOTS.map((s) => {
  const p = s.split(' ');
  if (p[0] === 'box')
    return {
      kind: 'box',
      area: p[1],
      name: p[2],
      x: Number(p[3]),
      y: Number(p[4]),
      x1: Number(p[5]),
      y1: Number(p[6]),
    };
  return { kind: p[0], area: p[1], x: Number(p[2]), y: Number(p[3]) };
});

// ---------------------------------------------------------------------------
// Монстры. Базовые числа — этаж 10 ×1,5 (§12в): районы на уровне 9.
// ---------------------------------------------------------------------------

const GORE_FLESH = ['#5a1420', '#c83a4a', '#ff8a8a', '#2a0a10'];
const GORE_BILE = ['#6a7a14', '#c8e040', '#3a2a10', '#f0ff90'];

const MOBS: MobDef[] = [
  {
    // Антитело: «Y» из белка. Лезет стаей, прилипает к чужаку и метит его.
    id: 'f15_mob',
    name: 'Антитело',
    many: 'антител',
    hp: 18,
    dmg: 12,
    speed: 4.3,
    radius: 0.26,
    windup: 0.45,
    reach: 0.36,
    rest: 0.8,
    xp: 7,
    meat: null,
    mats: [
      ['f15_tissue', 0.12],
      ['f15_lymph', 0.1],
    ],
    beast: true,
    brain: 'f15_antibody',
    art: { kind: 'paint', id: 'f15_antibody' },
    mass: 0.8,
    flinch: 0.5,
    eye: '#ffe0f0',
    gore: ['#6a3a7a', '#e8c8ff', '#ff8aa8', '#2a1430'],
  },
  {
    // Макрофаг: большая амёба. Поглощает — изнутри его бьют вдвое, рывок
    // вырывает. Ест добычу с пола и личинок.
    id: 'f15_macro',
    name: 'Макрофаг',
    many: 'макрофагов',
    hp: 96,
    dmg: 26,
    speed: 1.9,
    radius: 0.62,
    windup: 0.95,
    reach: 0.9,
    rest: 1.2,
    xp: 26,
    meat: ['f15_offal', 0.35, 1],
    mats: [
      ['f15_tissue', 0.6],
      ['f15_lymph', 0.3],
    ],
    beast: true,
    brain: 'f15_macro',
    art: { kind: 'paint', id: 'f15_macro' },
    mass: 8,
    flinch: 0.04,
    stunT: 0.35,
    eye: '#ffd060',
    gore: ['#c8a0a8', '#f0d8d8', '#8a3a4a', '#fff0f0'],
  },
  {
    // Нервный узел: сидит на узле вен. Увидел — сигнал: разряды по полу,
    // метка «чужак» и антитела из пор. Убит — вены вокруг гаснут.
    id: 'f15_nerve',
    name: 'Нервный узел',
    many: 'нервных узлов',
    hp: 70,
    dmg: 22,
    speed: 0,
    radius: 0.44,
    windup: 1.1,
    reach: 8,
    rest: 3.6,
    xp: 22,
    meat: null,
    mats: [
      ['f15_nerve', 0.55],
      ['f15_tissue', 0.3],
    ],
    beast: true,
    brain: 'f15_nerve',
    art: { kind: 'paint', id: 'f15_nerve' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#d08aff',
    light: 1.8,
    gore: ['#3a1a4a', '#d08aff', '#f4d8ff', '#1a0a20'],
  },
  {
    // Паразит: пиявка под слизистой. Бугор ползёт к тебе, выныривает
    // прыжком, присасывается — сбить рывком. Промахнулся — открыт.
    id: 'f15_parasite',
    name: 'Паразит',
    many: 'паразитов',
    hp: 30,
    dmg: 14,
    speed: 4.2,
    radius: 0.28,
    windup: 0.55,
    reach: 0.4,
    rest: 1,
    xp: 12,
    meat: ['f15_offal', 0.2, 1],
    mats: [['f15_tissue', 0.3]],
    beast: true,
    brain: 'f15_parasite',
    art: { kind: 'paint', id: 'f15_parasite' },
    mass: 1,
    flinch: 0.4,
    eye: '#ffe86a',
    gore: GORE_FLESH,
  },
  {
    // Кислотный пузырь: плывёт над соком. Раздувается и лопается лужей —
    // ударь раньше, и он улетит лопаться туда, куда отбил (и во врагов).
    id: 'f15_acid',
    name: 'Кислотный пузырь',
    many: 'кислотных пузырей',
    hp: 16,
    dmg: 22,
    speed: 1.9,
    radius: 0.34,
    windup: 0.85,
    reach: 1.2,
    rest: 1,
    xp: 9,
    meat: null,
    mats: [['f15_bile', 0.4]],
    beast: true,
    brain: 'f15_acid',
    art: { kind: 'paint', id: 'f15_acid' },
    mass: 0.4,
    flinch: 1,
    fly: true,
    noAlbino: true,
    eye: '#e0ff60',
    light: 1.6,
    gore: GORE_BILE,
  },
  {
    // Кровяной дрон: эритроцит-таран. Тройками, прицел линией и таран; на
    // русле удар сердца несёт его, как и тебя. О стену — оглушён.
    id: 'f15_drone',
    name: 'Кровяной дрон',
    many: 'кровяных дронов',
    hp: 36,
    dmg: 18,
    speed: 3.4,
    radius: 0.34,
    windup: 0.6,
    reach: 0.4,
    rest: 1.2,
    xp: 14,
    meat: null,
    mats: [
      ['f15_plasma', 0.4],
      ['f15_tissue', 0.15],
    ],
    beast: true,
    brain: 'f15_drone',
    art: { kind: 'paint', id: 'f15_drone' },
    mass: 2.2,
    flinch: 0.25,
    stunT: 0.3,
    fly: true,
    eye: '#ffb0a0',
    gore: ['#8a0a14', '#e02a3a', '#ff9a9a', '#3a0408'],
  },
  {
    // Личинка: из мешков. Не добил за 14 с — окукливается и выходит
    // подражателем: подземелье вспоминает монстров сверху.
    id: 'f15_larva',
    name: 'Личинка',
    many: 'личинок',
    hp: 10,
    dmg: 8,
    speed: 4.4,
    radius: 0.2,
    windup: 0.35,
    reach: 0.3,
    rest: 0.7,
    xp: 3,
    meat: null,
    mats: [['f15_tissue', 0.06]],
    beast: true,
    brain: 'f15_larva',
    art: { kind: 'paint', id: 'f15_larva' },
    mass: 0.4,
    flinch: 1,
    eye: '#ff6a4a',
    gore: ['#e8dcc8', '#fff4e0', '#c83a4a', '#8a7a60'],
  },
  {
    // Смотритель: глаз на стебле. Водит конусом взгляда; увидел — метит
    // «чужака» и бьёт лучом. Прячься за колоннами; моргнул — открыт.
    id: 'f15_watcher',
    name: 'Смотритель',
    many: 'смотрителей',
    hp: 60,
    dmg: 26,
    speed: 0,
    radius: 0.42,
    windup: 0.9,
    reach: 9,
    rest: 1.4,
    xp: 20,
    meat: null,
    mats: [
      ['f15_lens', 0.5],
      ['f15_tissue', 0.3],
    ],
    beast: true,
    brain: 'f15_watcher',
    art: { kind: 'paint', id: 'f15_watcher' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#fff4a0',
    light: 1.4,
    gore: GORE_FLESH,
  },
  {
    // Подражатель: гончая — адский пёс Трона, переваренный и собранный
    // заново. Прыжок оставляет лужу желчи; промахнулся — прыгает ещё раз.
    id: 'f15_mhound',
    name: 'Подражатель: гончая',
    many: 'подражателей-гончих',
    hp: 33,
    dmg: 14,
    speed: 4.6,
    radius: 0.32,
    windup: 0.4,
    reach: 0.42,
    rest: 0.8,
    xp: 13,
    meat: ['f15_offal', 0.35, 1],
    mats: [
      ['f15_mold', 0.18],
      ['f15_tissue', 0.2],
    ],
    beast: true,
    brain: 'f15_mhound',
    art: { kind: 'paint', id: 'f15_mhound' },
    mass: 1.3,
    flinch: 0.35,
    eye: '#e0ff60',
    gore: GORE_FLESH,
  },
  {
    // Подражатель: саламандра — ныряет в желудочный сок, как её образец в
    // лаву, и выныривает у берега с плевком.
    id: 'f15_msala',
    name: 'Подражатель: саламандра',
    many: 'подражателей-саламандр',
    hp: 45,
    dmg: 14,
    speed: 3.2,
    radius: 0.34,
    windup: 0.5,
    reach: 0.45,
    rest: 0.9,
    xp: 16,
    meat: ['f15_offal', 0.3, 1],
    mats: [
      ['f15_mold', 0.22],
      ['f15_bile', 0.25],
    ],
    beast: true,
    fly: true,
    brain: 'f15_msala',
    art: { kind: 'paint', id: 'f15_msala' },
    mass: 1.6,
    flinch: 0.3,
    eye: '#e0ff60',
    shot: {
      speed: 7,
      r: 0.36,
      life: 1.4,
      dmg: 0.6,
      art: 'f15_spit',
      lob: true,
      status: 'poison',
      dur: 2,
      onLand: { r: 1, life: 2.6, dps: 0.012, status: 'poison', dur: 1.2, art: 'f15_bilepool' },
    },
    gore: GORE_BILE,
  },
  {
    // Подражатель: латник — рыцарь крипты, щит у него из кости. Спереди
    // не берёт; после тарана щитом открыт со спины. Два тяжёлых по щиту —
    // щит треснул.
    id: 'f15_mknight',
    name: 'Подражатель: латник',
    many: 'подражателей-латников',
    hp: 72,
    dmg: 20,
    speed: 2.5,
    radius: 0.4,
    windup: 0.75,
    reach: 0.55,
    rest: 1.1,
    xp: 22,
    meat: null,
    mats: [
      ['f15_mold', 0.35],
      ['f15_tissue', 0.3],
    ],
    beast: true,
    brain: 'f15_mknight',
    art: { kind: 'paint', id: 'f15_mknight' },
    mass: 4,
    flinch: 0.08,
    stunT: 0.3,
    eye: '#e0ff60',
    gore: GORE_FLESH,
  },
  {
    // Златожил (редкий): золотая жила-червь. Удирает по венам, от ударов
    // сыплет монетами, не догнал — уходит в стену.
    id: 'f15_gold',
    name: 'Златожил',
    many: 'златожилов',
    hp: 30,
    dmg: 6,
    speed: 5.6,
    radius: 0.26,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 40,
    meat: null,
    mats: [['f15_tissue', 0.8]],
    beast: true,
    brain: 'f15_gold',
    art: { kind: 'paint', id: 'f15_gold' },
    mass: 0.8,
    flinch: 1,
    coins: 2400,
    resume: 'flee',
    eye: '#ffe060',
    light: 1.6,
    gore: ['#8a6a14', '#ffd040', '#fff4a0', '#5a1420'],
  },
  // --- Не звери, а органы: в бестиарий не идут.
  {
    // Мешок-рождение: слушает шум. Набух — лопается выводком личинок.
    id: 'f15_sac',
    name: 'Мешок-рождение',
    many: 'мешков',
    hp: 12,
    dmg: 0,
    speed: 0,
    radius: 0.42,
    windup: 1,
    reach: 0,
    rest: 1,
    xp: 8,
    meat: ['f15_heartlet', 0.1, 1],
    mats: [['f15_tissue', 0.4]],
    beast: false,
    brain: 'f15_sac',
    art: { kind: 'paint', id: 'f15_sac' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    gore: ['#e8a0a8', '#fff0f0', '#c83a4a', '#8a2a3a'],
  },
  {
    // Миндалина: железа Горла. Рожает антитела и плюётся слизью.
    id: 'f15_tonsil',
    name: 'Миндалина',
    many: 'миндалин',
    hp: 50,
    dmg: 14,
    speed: 0,
    radius: 0.62,
    windup: 0.9,
    reach: 7,
    rest: 2,
    xp: 40,
    meat: ['f15_heartlet', 0.35, 1],
    mats: [
      ['f15_lymph', 0.9],
      ['f15_tissue', 0.5],
    ],
    beast: false,
    brain: 'f15_tonsil',
    art: { kind: 'paint', id: 'f15_tonsil' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    shot: {
      speed: 6,
      r: 0.4,
      life: 1.6,
      dmg: 1,
      art: 'f15_phlegm',
      lob: true,
      status: 'slow',
      dur: 2,
      onLand: { r: 1.1, life: 3, slow: 0.55, art: 'f15_slime' },
    },
    gore: ['#e8a0a8', '#fff0f0', '#c8e0a0', '#8a2a3a'],
  },
  {
    // Матка Выводка: рожает мешки. Убил — выводок завял.
    id: 'f15_matron',
    name: 'Матка выводка',
    many: 'маток выводка',
    hp: 120,
    dmg: 18,
    speed: 0,
    radius: 0.9,
    windup: 1,
    reach: 1.6,
    rest: 2,
    xp: 60,
    meat: ['f15_heartlet', 0.8, 2],
    mats: [
      ['f15_mold', 0.8],
      ['f15_tissue', 0.8],
    ],
    beast: false,
    brain: 'f15_matron',
    art: { kind: 'paint', id: 'f15_matron' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#ffe86a',
    light: 2.2,
    gore: GORE_FLESH,
  },
];

// ---------------------------------------------------------------------------
// Кто водится в районах.
// ---------------------------------------------------------------------------

const spawnThroat: SpawnSpec = {
  mobs: [
    ['f15_mob', 60],
    ['f15_mhound', 16],
    ['f15_parasite', 14],
    ['f15_larva', 10],
  ],
  density: 0.6,
  pack: [1, 2],
  filler: 'f15_mob',
  group: (i) => (i < 3 ? 'f15_mhound' : 'f15_mob'),
  horde: null,
  treasure: 'f15_gold',
  nest: () => 'f15_larva',
};

const spawnGut: SpawnSpec = {
  mobs: [
    ['f15_mob', 38],
    ['f15_parasite', 26],
    ['f15_mhound', 10],
    ['f15_msala', 14],
    ['f15_larva', 12],
  ],
  density: 0.62,
  pack: [1, 2],
  filler: 'f15_mob',
  group: (i) => (i < 2 ? 'f15_parasite' : i < 3 ? 'f15_mhound' : 'f15_mob'),
  horde: null,
  treasure: 'f15_gold',
  nest: () => 'f15_larva',
};

const spawnVeins: SpawnSpec = {
  mobs: [
    ['f15_mob', 36],
    ['f15_drone', 30],
    ['f15_mknight', 16],
    ['f15_mhound', 12],
    ['f15_parasite', 6],
  ],
  density: 0.64,
  pack: [1, 2],
  filler: 'f15_mob',
  group: (i) => (i < 3 ? 'f15_drone' : i < 4 ? 'f15_mknight' : 'f15_mob'),
  horde: null,
  treasure: 'f15_gold',
  nest: () => 'f15_larva',
};

const area = (
  id: string,
  name: string,
  lead: string,
  rows: string[],
  ambient: number,
  tint: AreaSpec['skin']['tint'],
  fog: string,
  polyp: Tint,
  spawn: SpawnSpec,
  mine: string,
): AreaSpec => ({
  id,
  name,
  lead,
  tier: 8,
  level: 9,
  ambient,
  rows,
  skin: { floor: 'ground', wall: 'rock', tint, fog },
  legend: legendOf(polyp),
  mine,
  spawn,
  paintAll: true,
});

export const F15_AREAS: AreaSpec[] = [
  area(
    F15_THROAT,
    'Горло',
    'Стены дышат. Здесь ты — чужой.',
    F15_THROAT_MAP,
    0.44,
    { mul: [0.82, 0.52, 0.56], mix: '#3a0a14', k: 0.16 },
    '#0e0306',
    'teal',
    spawnThroat,
    'f15mine',
  ),
  area(
    F15_GUT,
    'Чрево',
    'Всё, что было выше, переварено здесь.',
    F15_GUT_MAP,
    0.46,
    { mul: [0.8, 0.56, 0.44], mix: '#2a1a06', k: 0.14 },
    '#0a0703',
    'green',
    spawnGut,
    'f15mine2',
  ),
  area(
    F15_VEINS,
    'Сосуды',
    'Кровь течёт к сердцу. И ты — с ней.',
    F15_VEINS_MAP,
    0.38,
    { mul: [0.78, 0.4, 0.48], mix: '#2a020a', k: 0.18 },
    '#0c0206',
    'red',
    spawnVeins,
    'f15mine3',
  ),
];

export const F15: FloorDef = {
  id: 15,
  name: 'Сердце подземелья',
  lead: 'Подземелье живое. Оно переварило всё, что выше, — и слышит, как ты идёшь.',
  mapVer: 2,
  flowR: 30,
  areas: [...F15_AREAS, F15_HEART_AREA],
  boss: F15_BOSS,
  mines: [
    {
      id: 'f15mine',
      name: 'Хрящевая шахта',
      area: F15_THROAT,
      windowMs: 60 * 60_000,
      ores: [28, 29],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.4,
    },
    {
      id: 'f15mine2',
      name: 'Шахта в желчном камне',
      area: F15_GUT,
      windowMs: 2 * 60 * 60_000,
      ores: [28, 29],
      share: [0.28, 0.34, 0.42, 0.5, 0.58],
      pyrite: 0,
      blocks: 2.8,
    },
    {
      id: 'f15mine3',
      name: 'Кальцинат',
      area: F15_VEINS,
      windowMs: 3 * 60 * 60_000,
      ores: [28, 29],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3.2,
    },
  ],
  mobs: [...MOBS, ...F15_BOSS_MOBS],
  meats: [
    { id: 'f15_offal', name: 'Требуха подражателя', price: 70, heal: 0.3 },
    { id: 'f15_heartlet', name: 'Сердечко', price: 140, heal: 0.5 },
    ...F15_BOSS_MEATS,
  ],
  // Ходовой материал этажа — первый со стопкой больше 1 (им чинят лифты).
  mats: [
    {
      id: 'f15_tissue',
      name: 'Живая ткань',
      price: 600,
      lead: 'Тёплая, ещё дышит. Из неё подземелье строит себя.',
    },
    {
      id: 'f15_lymph',
      name: 'Лимфа',
      price: 640,
      lead: 'Прозрачная, густая. Иммунитет узнаёт по ней своих.',
    },
    {
      id: 'f15_bile',
      name: 'Желчь',
      price: 680,
      lead: 'Разъедает железо. Держать в стекле и не нюхать.',
    },
    {
      id: 'f15_nerve',
      name: 'Нервное волокно',
      price: 760,
      lead: 'Дёргается в руке. Помнит сигнал, который не успело передать.',
    },
    {
      id: 'f15_lens',
      name: 'Хрусталик смотрителя',
      price: 820,
      lead: 'Сквозь него видно то, что было на этом месте раньше.',
    },
    {
      id: 'f15_plasma',
      name: 'Сгусток плазмы',
      price: 720,
      lead: 'Бьётся сам по себе — в такт тому, что наверху.',
    },
    {
      id: 'f15_mold',
      name: 'Слепок подражателя',
      price: 900,
      lead: 'Оболочка чудовища с верхних этажей. Подземелье учится по ним.',
    },
    ...F15_BOSS_MATS,
  ],
  music: { explore: 'depths', boss: 'finale' },
  cover: '/ui/areas/f15.png',
};

/** Сколько видов монстров «Мира» (без органов) — для отчёта и тестов. */
export const F15_BEASTS = MOBS.filter((m) => m.beast).map((m) => m.id);
