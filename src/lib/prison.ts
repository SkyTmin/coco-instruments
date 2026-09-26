// «Каторга» — присон с видом сверху. Здесь все правила; страница только
// показывает и ловит пальцы.
//
// С v2.66 Каторга — главная игра, автоматы — казино внутри неё. Все цены
// ПОСТОЯННЫЕ и лежат таблицами в `economy.ts`: руда, блок этажа, ранг,
// кирка, заточка — одно число навсегда, без множителей от ранга и престижа,
// без миллионов. Темп подобран тестом-симуляцией (`prison.test.ts`).
//
// Как устроено поле. Шахта — яма, а не плоскость: 7×9 клеток, в каждой пять
// ярусов. Сломал верхний блок — под ним следующий. На этаже две руды: своя
// и прошлого этажа, к дну своей больше. Редкие блоки этажа — цельные кубы
// руды — лежат в поле из того же зерна. Поле собирается из зерна (`seed`):
// сохранять нужно только зерно и глубину раскопа по клеткам.

import {
  BAG_PRICE,
  BLOCK_BUYOUT,
  BLOCK_PRICE,
  blocksPerField,
  CREW_PRICE,
  nice,
  ORE_PRICE,
  PICKS,
  PRESTIGE_PRICE,
  PRESTIGE_SELL_MAX,
  PRESTIGE_SELL_STEP,
  RANK_BLOCKS,
  RANK_PRICE,
  RANK_WORK,
  SELL_BONUS_CAP,
} from './economy';

export { nice, PICKS, AUTOSELL_TOKENS, BLOCK_HITS, blockPity } from './economy';
export type { PickDef as Pick } from './economy';

export const MINE_COLS = 7;
export const MINE_ROWS = 9;
export const MINE_CELLS = MINE_COLS * MINE_ROWS;
/** Ярусов в клетке. Глубина `DEPTH` — выработано до дна. */
export const DEPTH = 5;
/** Доля выработки, после которой шахта обновляется: последние блоки не ищут. */
export const MINE_RESET_AT = 0.85;

// ---------------------------------------------------------------------------
// Породы. Индекс породы = буква этажа, на котором она впервые появляется;
// пять последних — престижные, только в спецзоне. Картинки — готовые
// (`public/ui/ores`, сборка `scripts/ores-assets.py`), палитра здесь нужна
// для крошки и оттенков: основа — пустая порода, вкрапления — руда.
// ---------------------------------------------------------------------------

/** Материал — от него звук удара и характер крошки. */
export type RockKind = 'soil' | 'stone' | 'metal' | 'crystal' | 'star';

/** Узор — остался для процедурных текстур подземелья. */
export type RockPattern = 'grain' | 'bands' | 'specks' | 'veins' | 'crystal' | 'flakes' | 'stars';

export interface Rock {
  id: string;
  name: string;
  /** «Золотой блок», «Алмазный блок» — цельный куб этой руды. */
  blockName: string;
  kind: RockKind;
  pattern: RockPattern;
  /** Основа, тень, вкрапления, блик — палитра крошки. */
  base: string;
  dark: string;
  fleck: string;
  shine: string;
  /** Прочность: сколько урона выдержит блок. */
  hp: number;
  /** Цена продажи одного блока руды, монет. */
  value: number;
  /** Цена блока этажа. */
  block: number;
}

type RockDef = Omit<Rock, 'hp' | 'value' | 'block'>;

const R = (
  id: string,
  name: string,
  blockName: string,
  kind: RockKind,
  pattern: RockPattern,
  base: string,
  dark: string,
  fleck: string,
  shine: string,
): RockDef => ({ id, name, blockName, kind, pattern, base, dark, fleck, shine });

const ROCK_DEFS: RockDef[] = [
  R('clay', 'Глина', 'Глиняный блок', 'soil', 'grain', '#b87a44', '#7a4a24', '#d89a5a', '#f0c08a'),
  R(
    'sandstone',
    'Песчаник',
    'Песчаниковый блок',
    'stone',
    'bands',
    '#e8d4a2',
    '#b89a6a',
    '#f4e4c0',
    '#fff4dc',
  ),
  R(
    'limestone',
    'Известняк',
    'Известняковый блок',
    'stone',
    'specks',
    '#e6e8e0',
    '#a8aca4',
    '#ffffff',
    '#ffffff',
  ),
  R(
    'granite',
    'Гранит',
    'Гранитный блок',
    'stone',
    'specks',
    '#a8989a',
    '#6a5e60',
    '#d0a8a8',
    '#f0dcdc',
  ),
  R(
    'coal',
    'Уголь',
    'Угольный блок',
    'stone',
    'specks',
    '#9aa8ac',
    '#5a6468',
    '#2a2a30',
    '#6a6a78',
  ),
  R('copper', 'Медь', 'Медный блок', 'metal', 'specks', '#9aa8ac', '#5a6468', '#e07a3a', '#ffb07a'),
  R(
    'iron',
    'Железо',
    'Железный блок',
    'metal',
    'veins',
    '#9aa8ac',
    '#5a6468',
    '#b8421e',
    '#e0805a',
  ),
  R(
    'cobalt',
    'Кобальт',
    'Кобальтовый блок',
    'metal',
    'specks',
    '#9aa8ac',
    '#5a6468',
    '#2a6aff',
    '#8ab0ff',
  ),
  R(
    'turquoise',
    'Бирюза',
    'Бирюзовый блок',
    'crystal',
    'specks',
    '#9aa8ac',
    '#5a6468',
    '#2ab8a0',
    '#8af0e0',
  ),
  R(
    'amber',
    'Янтарь',
    'Янтарный блок',
    'crystal',
    'crystal',
    '#9aa8ac',
    '#5a6468',
    '#ffa82a',
    '#ffe08a',
  ),
  R(
    'quartz',
    'Кварц',
    'Кварцевый блок',
    'crystal',
    'crystal',
    '#6a7478',
    '#3a4246',
    '#f4f8ff',
    '#ffffff',
  ),
  R(
    'silver',
    'Серебро',
    'Серебряный блок',
    'metal',
    'veins',
    '#6a7478',
    '#3a4246',
    '#c8d4e4',
    '#ffffff',
  ),
  R(
    'opal',
    'Опал',
    'Опаловый блок',
    'crystal',
    'crystal',
    '#6a7478',
    '#3a4246',
    '#ffc8e8',
    '#ffffff',
  ),
  R(
    'malachite',
    'Малахит',
    'Малахитовый блок',
    'stone',
    'bands',
    '#6a7478',
    '#3a4246',
    '#1ab86a',
    '#8af0b8',
  ),
  R('gold', 'Золото', 'Золотой блок', 'metal', 'veins', '#6a7478', '#3a4246', '#ffcc1a', '#fff29a'),
  R(
    'amethyst',
    'Аметист',
    'Аметистовый блок',
    'crystal',
    'crystal',
    '#6a7478',
    '#3a4246',
    '#b05aff',
    '#e0b8ff',
  ),
  R(
    'lapis',
    'Лазурит',
    'Лазуритовый блок',
    'stone',
    'specks',
    '#3a3e44',
    '#1e2024',
    '#2a4aff',
    '#9ab0ff',
  ),
  R(
    'jade',
    'Нефрит',
    'Нефритовый блок',
    'stone',
    'grain',
    '#3a3e44',
    '#1e2024',
    '#8ae0a0',
    '#d0ffe0',
  ),
  R(
    'garnet',
    'Гранат',
    'Гранатовый блок',
    'crystal',
    'crystal',
    '#3a3e44',
    '#1e2024',
    '#c01a3a',
    '#ff7a90',
  ),
  R(
    'topaz',
    'Топаз',
    'Топазовый блок',
    'crystal',
    'crystal',
    '#3a3e44',
    '#1e2024',
    '#ff8a1a',
    '#ffd08a',
  ),
  R(
    'sapphire',
    'Сапфир',
    'Сапфировый блок',
    'crystal',
    'crystal',
    '#3a3e44',
    '#1e2024',
    '#2a6aff',
    '#a0c0ff',
  ),
  R(
    'emerald',
    'Изумруд',
    'Изумрудный блок',
    'crystal',
    'crystal',
    '#3a3e44',
    '#1e2024',
    '#1ad060',
    '#9affb8',
  ),
  R(
    'ruby',
    'Рубин',
    'Рубиновый блок',
    'crystal',
    'crystal',
    '#3a2a4a',
    '#1e1428',
    '#ff1a3a',
    '#ff9aa8',
  ),
  R(
    'diamond',
    'Алмаз',
    'Алмазный блок',
    'crystal',
    'crystal',
    '#3a2a4a',
    '#1e1428',
    '#9af0ff',
    '#ffffff',
  ),
  R(
    'meteorite',
    'Метеорит',
    'Метеоритный блок',
    'metal',
    'veins',
    '#e0621a',
    '#8a2a0a',
    '#2a2020',
    '#ffb04a',
  ),
  R(
    'starstone',
    'Звёздный кристалл',
    'Звёздный блок',
    'star',
    'stars',
    '#1e1e4a',
    '#0e0e2a',
    '#bff4ff',
    '#ffffff',
  ),
  // Престижные — только в спецзоне.
  R(
    'rhodonite',
    'Родонит',
    'Родонитовый блок',
    'crystal',
    'veins',
    '#6a7478',
    '#3a4246',
    '#ff7aa0',
    '#ffd0dc',
  ),
  R(
    'lovchorrite',
    'Ловчоррит',
    'Ловчорритовый блок',
    'crystal',
    'bands',
    '#e8d4a2',
    '#b89a6a',
    '#c08a3a',
    '#f0d0a0',
  ),
  R(
    'charoite',
    'Чароит',
    'Чароитовый блок',
    'crystal',
    'flakes',
    '#3a2a4a',
    '#1e1428',
    '#d08aff',
    '#f4d8ff',
  ),
  R(
    'demantoid',
    'Демантоид',
    'Демантоидовый блок',
    'crystal',
    'crystal',
    '#3a2a4a',
    '#1e1428',
    '#b0ff3a',
    '#eaffb0',
  ),
  R(
    'alexandrite',
    'Александрит',
    'Александритовый блок',
    'star',
    'crystal',
    '#3a2a4a',
    '#1e1428',
    '#1ad0b0',
    '#ff5a9a',
  ),
];

/** Прочность растёт медленнее цены: кирка обязана догонять породу. */
export const HP_BASE = 2;
export const HP_GROWTH = 1.165;

export const ROCKS: Rock[] = ROCK_DEFS.map((d, j) => ({
  ...d,
  hp: Math.max(2, Math.round(HP_BASE * Math.pow(HP_GROWTH, j))),
  value: ORE_PRICE[j],
  block: BLOCK_PRICE[j],
}));

/**
 * Шахт и рангов — 26, A…Z. Пород больше: пять престижных лежат только в
 * спецзоне, их шахты не открываются рангом.
 */
export const MINES = 26;
export const LAST_RANK = MINES - 1;

/** Буква ранга или шахты. */
export const rankLetter = (r: number): string =>
  String.fromCharCode(65 + Math.max(0, Math.min(LAST_RANK, Math.round(r))));

// ---------------------------------------------------------------------------
// Твёрдость руды и сила кирки (v2.67), как Breaking Power в Hypixel SkyBlock
// и сила кирки в Terraria. Руда твёрже кирки не ломается вовсе: удар звенит
// и высекает искры. Кирка N куётся из руды, которую берёт кирка N−1, поэтому
// лестница всегда проходима.
//
// Условие ранга: кирка, которая берёт руду следующего этажа. Так новый этаж
// никогда не встречает игрока полем, которое он не может копать (шахта —
// яма: твёрдый верхний блок закрыл бы всё под собой), а «звенит» только
// руда следующего этажа на дне — подсказка, за какой киркой идти.
// ---------------------------------------------------------------------------

/** Сила ⛏ кирки `pick`. */
export function pickPower(pick: number): number {
  return PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))].power;
}

/**
 * Твёрдость руды: сила самой слабой кирки, которая её берёт. Этажи
 * открываются киркой, выкованной на этаже ниже: кирка с этажа `floor` берёт
 * руду с `floor + 1`. Руда спецзоны — под звёздную кирку.
 */
export function rockHardness(rock: number): number {
  let h = 1;
  for (const p of PICKS)
    if (!p.prestige && p.power > 1 && rock >= Math.min(p.floor + 1, LAST_RANK))
      h = Math.max(h, p.power);
  return h;
}

/** Берёт ли кирка `pick` руду `rock`. */
export function canMine(pick: number, rock: number): boolean {
  return rock < 0 || pickPower(pick) >= rockHardness(rock);
}

/** Самая простая кирка, которой копается этаж `floor`. */
export function minPickFor(floor: number): number {
  const need = rockHardness(Math.max(0, Math.min(LAST_RANK, floor)));
  return Math.max(
    0,
    PICKS.findIndex((p) => !p.prestige && p.power >= need),
  );
}

/** Какие руды кирка `pick` берёт первой — её «открывает». */
export function opensRocks(pick: number): number[] {
  const pw = pickPower(pick);
  const out: number[] = [];
  for (let r = 0; r < MINES; r++) if (rockHardness(r) === pw) out.push(r);
  return out;
}

// ---------------------------------------------------------------------------
// Состав шахты (v2.66). На этаже ДВЕ руды: своя и прошлого этажа. Сверху
// поровну, к дну своей до 85%; на дне изредка руда следующего этажа —
// подсказка, за чем идти. Было пять пород вперемешку, новая — 5% поля: этаж
// не запоминался, «как будто пофиг, что копаешь».
// ---------------------------------------------------------------------------

/** Доля руды этажа по ярусам (0 — верхний). */
export const OWN_SHARE = [0.5, 0.5875, 0.675, 0.7625, 0.85];
/** На дне изредка попадается руда следующего этажа. */
export const NEXT_ROCK_CHANCE = 0.05;

export interface MineShare {
  rock: number;
  share: number;
}

/** Состав яруса `depth` шахты `mine`. */
export function layerMix(mine: number, depth = 0): MineShare[] {
  if (mine <= 0) return [{ rock: 0, share: 1 }];
  const own = OWN_SHARE[Math.max(0, Math.min(DEPTH - 1, depth))];
  const next = depth === DEPTH - 1 && mine < LAST_RANK ? NEXT_ROCK_CHANCE : 0;
  const out: MineShare[] = [
    { rock: mine - 1, share: (1 - own) * (1 - next) },
    { rock: mine, share: own * (1 - next) },
  ];
  if (next) out.push({ rock: mine + 1, share: next });
  return out;
}

/** Состав верхнего яруса — что видно, едва спустился. */
export function mineMix(mine: number): MineShare[] {
  return layerMix(mine, 0);
}

/** Средний состав шахты по всем ярусам. */
export function mineShares(mine: number): MineShare[] {
  const acc = new Map<number, number>();
  for (let d = 0; d < DEPTH; d++)
    for (const m of layerMix(mine, d)) acc.set(m.rock, (acc.get(m.rock) ?? 0) + m.share / DEPTH);
  return [...acc.entries()]
    .map(([rock, share]) => ({ rock, share }))
    .sort((a, b) => a.rock - b.rock);
}

/** Детерминированный генератор: одно зерно — одно и то же поле везде. */
export function rng32(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Порода одного блока на ярусе `depth`, без учёта соседей. */
function rollRock(mine: number, depth: number, rnd: () => number): number {
  const mix = layerMix(mine, depth);
  let x = rnd();
  for (const m of mix) {
    x -= m.share;
    if (x <= 0) return m.rock;
  }
  return mix[mix.length - 1].rock;
}

/**
 * Поле шахты: `rocks[depth * MINE_CELLS + cell]`. Порода кладётся жилами, а
 * не солью с перцем: после броска каждая клетка с некоторым шансом берёт
 * породу соседа. Сверху это читается как настоящие прожилки руды.
 */
export function buildMine(mine: number, seed: number): number[] {
  const rnd = rng32(seed * 31 + mine * 7919 + 17);
  const rocks = new Array<number>(MINE_CELLS * DEPTH);
  for (let d = 0; d < DEPTH; d++) {
    const layer = Array.from({ length: MINE_CELLS }, () => rollRock(mine, d, rnd));
    // Жилы: редкая порода растекается к соседям, дешёвая не растекается —
    // иначе поле превратилось бы в пятна глины.
    const veins = layer.slice();
    for (let c = 0; c < MINE_CELLS; c++) {
      if (rnd() > 0.34) continue;
      const x = c % MINE_COLS;
      const y = Math.floor(c / MINE_COLS);
      const nb: number[] = [];
      if (x > 0) nb.push(c - 1);
      if (x < MINE_COLS - 1) nb.push(c + 1);
      if (y > 0) nb.push(c - MINE_COLS);
      if (y < MINE_ROWS - 1) nb.push(c + MINE_COLS);
      const from = layer[nb[Math.floor(rnd() * nb.length)]];
      if (from > veins[c]) veins[c] = from;
    }
    for (let c = 0; c < MINE_CELLS; c++) rocks[d * MINE_CELLS + c] = veins[c];
  }
  return rocks;
}

// ---------------------------------------------------------------------------
// Сейд-камень — священный камень саамов, самая редкая вещь в шахте. На поле
// их 0, 1 или 2, и лежат они только в глубине: сверху не видно, находит лупа
// или случай. Бьётся не уроном, а УДАРАМИ — сколько бы ни била кирка, нужно
// несколько попаданий (крит считается за два). Взрывы, жилы и отбойник его не
// берут: иначе редкость уходила бы сама, мимо рук. Платит токенами — их на
// каторге добывать тяжелее всего — и монетами в общий кошелёк.
// ---------------------------------------------------------------------------

export const SEID_HITS = 4;
/** Сколько сейдов на поле: 0 — в 70% шахт, 1 — в 25%, 2 — в 5%. */
const SEID_ODDS = [0.7, 0.95];

export interface Seid {
  cell: number;
  depth: number;
}

/** Где лежат сейды шахты: из того же зерна, что и порода. */
export function seidsOf(mine: number, seed: number): Seid[] {
  const rnd = rng32(seed * 131 + mine * 17 + 7);
  const x = rnd();
  const n = x < SEID_ODDS[0] ? 0 : x < SEID_ODDS[1] ? 1 : 2;
  const out: Seid[] = [];
  while (out.length < n) {
    const cell = Math.floor(rnd() * MINE_CELLS);
    const depth = 1 + Math.floor(rnd() * (DEPTH - 1));
    if (!out.some((s) => s.cell === cell)) out.push({ cell, depth });
  }
  return out;
}

/** Сверху клетки сейчас сейд. */
export function seidTop(seids: Seid[], cell: number, dug: number): boolean {
  return seids.some((s) => s.cell === cell && s.depth === dug);
}

/** Награда за сейд: токены по этажу и цена одного блока этажа монетами. */
export function seidReward(rank: number, _prestige = 0): { tokens: number; coins: number } {
  return {
    tokens: 30 + 6 * rank,
    coins: blockValue(Math.min(rank, LAST_RANK)),
  };
}

/** Средний выход сейдов на один блок шахты — для теста темпа. */
export function seidPerBlock(): number {
  const mean = 1 * (SEID_ODDS[1] - SEID_ODDS[0]) + 2 * (1 - SEID_ODDS[1]);
  return mean / (MINE_CELLS * DEPTH * MINE_RESET_AT);
}

// ---------------------------------------------------------------------------
// Блоки этажа (v2.66) — цельные кубы руды, как алмазный блок против
// алмазной руды в Майнкрафте. Лежат в поле из того же зерна, чаще на
// глубине; часть видна сверху. Бьются УДАРАМИ (`BLOCK_HITS`, крит за два),
// площадные чары их не берут — такой блок копают руками. Платят сразу, в
// кошелёк, и идут в условие ранга.
// ---------------------------------------------------------------------------

export interface OreBlock {
  cell: number;
  depth: number;
}

/** Ярус блока: сверху реже, к дну чаще. */
const BLOCK_DEPTH = [0.15, 0.15, 0.2, 0.25, 0.25];

/** Где лежат блоки этажа шахты. В спецзоне их нет — она платит токенами. */
export function blocksOf(mine: number, seed: number): OreBlock[] {
  if (mine > LAST_RANK) return [];
  const rnd = rng32(seed * 197 + mine * 31 + 11);
  const mean = blocksPerField(mine);
  const n = Math.floor(mean) + (rnd() < mean - Math.floor(mean) ? 1 : 0);
  const seids = seidsOf(mine, seed);
  const out: OreBlock[] = [];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const cell = Math.floor(rnd() * MINE_CELLS);
    let x = rnd();
    let depth = DEPTH - 1;
    for (let d = 0; d < DEPTH; d++) {
      x -= BLOCK_DEPTH[d];
      if (x <= 0) {
        depth = d;
        break;
      }
    }
    if (out.some((b) => b.cell === cell)) continue;
    if (seids.some((q) => q.cell === cell && q.depth === depth)) continue;
    out.push({ cell, depth });
  }
  return out;
}

/** Сверху клетки сейчас блок этажа. */
export function blockTop(blocks: OreBlock[], cell: number, dug: number): boolean {
  return blocks.some((b) => b.cell === cell && b.depth === dug);
}

/** Все блоки этажа поля: из зерна и блок гарантии, если он встал. */
export function mineBlocks(m: { id: number; seed: number; bonus?: OreBlock | null }): OreBlock[] {
  const out = blocksOf(m.id, m.seed);
  return m.bonus ? [...out, m.bonus] : out;
}

/**
 * Куда встанет блок гарантии: случайная клетка, где сверху руда самого
 * этажа, а не сейд, не блок из зерна и не событие. −1 — некуда.
 */
export function pityCell(
  m: { id: number; seed: number; dug: number[] },
  rocks: number[],
  rnd: () => number,
  busy: (cell: number) => boolean = () => false,
): number {
  const seeded = blocksOf(m.id, m.seed);
  const seids = seidsOf(m.id, m.seed);
  const free: number[] = [];
  for (let c = 0; c < MINE_CELLS; c++) {
    const d = m.dug[c];
    if (d >= DEPTH || busy(c)) continue;
    if (rocks[d * MINE_CELLS + c] !== m.id) continue;
    if (blockTop(seeded, c, d) || seidTop(seids, c, d)) continue;
    free.push(c);
  }
  return free.length ? free[Math.floor(rnd() * free.length)] : -1;
}

/**
 * Горизонты — этажи группами по пять, у каждого свой характер: наверху
 * простой камень, ниже металлы, потом самоцветы, на дне алмазы и звёзды.
 * Название видно на лестнице этажей и в сцене нового ранга.
 */
export const HORIZONS: { from: number; name: string }[] = [
  { from: 0, name: 'Верхние штольни' },
  { from: 5, name: 'Рудный двор' },
  { from: 10, name: 'Серебряный горизонт' },
  { from: 15, name: 'Самоцветные штреки' },
  { from: 20, name: 'Алмазное дно' },
];
export const horizonOf = (floor: number) =>
  [...HORIZONS].reverse().find((h) => floor >= h.from) ?? HORIZONS[0];

/** Цена блока этажа шахты `mine`. */
export function blockValue(mine: number): number {
  return BLOCK_PRICE[Math.max(0, Math.min(BLOCK_PRICE.length - 1, mine))];
}

/** Порода верхнего блока клетки при раскопе `dug`; −1 — дно. */
export function rockAt(rocks: number[], cell: number, dug: number): number {
  if (dug >= DEPTH) return -1;
  return rocks[dug * MINE_CELLS + cell];
}

/** Доля выработанных блоков. */
export function minedShare(dug: number[]): number {
  let n = 0;
  for (const d of dug) n += Math.min(DEPTH, d);
  return n / (MINE_CELLS * DEPTH);
}

// ---------------------------------------------------------------------------
// Ранги и престиж.
// ---------------------------------------------------------------------------

/** Цена перехода с ранга `rank` на следующий. Постоянная: престиж её не меняет. */
export function rankCost(rank: number, _prestige = 0): number {
  return RANK_PRICE[Math.max(0, Math.min(RANK_PRICE.length - 1, rank))];
}

export function prestigeCost(_prestige = 0): number {
  return PRESTIGE_PRICE;
}

/** Надбавка к продаже от престижа: +5% за каждый, не больше +50%. */
export function sellMult(prestige: number): number {
  return 1 + Math.min(PRESTIGE_SELL_MAX, PRESTIGE_SELL_STEP * prestige);
}

/** Опыт в общий уровень за новый ранг — уровень теперь только украшение. */
export function rankXp(newRank: number): number {
  return 25 + 15 * newRank;
}
export const PRESTIGE_XP = 2500;

// ---------------------------------------------------------------------------
// Кузница (v2.67): кирка куётся одной кнопкой из руды и монет, без заказа.
// Руда для следующей кирки копится в ЯЩИКЕ КУЗНЕЦА: при продаже рюкзака
// (руками или вагонеткой) нужная руда не продаётся, а откладывается — как
// запас досок на рукоять в лесу. Выковать можно и из рюкзака: кузнец берёт
// сначала из ящика, потом из рюкзака.
// ---------------------------------------------------------------------------

/** Крит: редкий удар втрое — ради него и держат палец. */
export const CRIT_CHANCE = 0.07;
export const CRIT_MULT = 3;

/** Рюкзак: сколько блоков влезает. */
export const BAG_MAX = BAG_PRICE.length;
export function bagCapacity(level: number): number {
  return Math.round(40 * Math.pow(1.35, level));
}
export function bagCost(level: number): number {
  return BAG_PRICE[Math.max(0, Math.min(BAG_PRICE.length - 1, level))];
}

/** Урон одного удара без крита — внутреннее число, игрок видит скорость. */
export function hitDamage(pick: number): number {
  return PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))].dmg;
}

/**
 * Минимальный промежуток между ударами ТАПОМ, мс. Тапать можно быстрее, чем
 * бьёт кирка на удержании (это награда за усилие), но не бесконечно: иначе
 * выигрывает не кирка, а автокликер.
 */
export function tapGapMs(pick: number): number {
  return 1000 / (PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))].rate * 1.8);
}

/** Можно ли ковать кирку `pick` при ранге и престиже игрока. */
export function pickOpen(pick: number, rank: number, prestige: number): boolean {
  const d = PICKS[pick];
  if (!d) return false;
  return d.prestige ? prestige >= d.prestige : rank >= d.floor || prestige > 0;
}

/** Следующая кирка лестницы (−1 — лучше нет или она за престижем, которого нет). */
export function nextPick(p: { pick: number; prestige: number }): number {
  const n = p.pick + 1;
  const d = PICKS[n];
  if (!d) return -1;
  return d.prestige && p.prestige < d.prestige ? -1 : n;
}

export interface ForgeOre {
  rock: number;
  need: number;
  /** Уже в ящике кузнеца. */
  box: number;
  /** Лежит в рюкзаке — кузнец возьмёт и оттуда. */
  bag: number;
}

/** Руда рецепта кирки `pick`: сколько нужно и где что лежит. */
export function forgeOres(pick: number, box: Bag, bag: Bag): ForgeOre[] {
  const d = PICKS[pick];
  if (!d) return [];
  return d.ore.map(([rock, need]) => ({
    rock,
    need,
    box: Math.min(need, box[rock] ?? 0),
    bag: Math.max(0, Math.min(need - Math.min(need, box[rock] ?? 0), bag[rock] ?? 0)),
  }));
}

export interface ForgeCheck {
  pick: number;
  /** Открыта ли кирка по этажу/престижу. */
  open: boolean;
  /** Руды хватает (ящик + рюкзак). */
  ore: boolean;
  /** Сколько монет просит (0 — оплачено старым заказом). */
  coins: number;
  /** Сколько руды не хватает, по породам. */
  missing: [number, number][];
}

export function forgeCheck(p: {
  pick: number;
  rank: number;
  prestige: number;
  forgeBox: Bag;
  bag: Bag;
  forgePaid: number;
}): ForgeCheck | null {
  const n = nextPick(p);
  if (n < 0) return null;
  const ores = forgeOres(n, p.forgeBox, p.bag);
  const missing = ores
    .map((o) => [o.rock, o.need - o.box - o.bag] as [number, number])
    .filter(([, k]) => k > 0);
  return {
    pick: n,
    open: pickOpen(n, p.rank, p.prestige),
    ore: !missing.length,
    coins: p.forgePaid === n ? 0 : PICKS[n].coins,
    missing,
  };
}

/** Выковать: руда уходит из ящика, недостающая — из рюкзака. */
export function forgeTake(pick: number, box: Bag, bag: Bag): { box: Bag; bag: Bag } {
  const outBox: Bag = { ...box };
  const outBag: Bag = { ...bag };
  for (const [rock, need] of PICKS[pick]?.ore ?? []) {
    const a = Math.min(need, outBox[rock] ?? 0);
    const b = Math.min(need - a, outBag[rock] ?? 0);
    if (a) outBox[rock] -= a;
    if (b) outBag[rock] -= b;
    if (!outBox[rock]) delete outBox[rock];
    if (!outBag[rock]) delete outBag[rock];
  }
  return { box: outBox, bag: outBag };
}

/** Сколько руды каждой породы ящик ещё примет для кирки `pick`. */
function boxRoom(pick: number, box: Bag): Map<number, number> {
  const room = new Map<number, number>();
  for (const [rock, need] of PICKS[pick]?.ore ?? [])
    room.set(rock, Math.max(0, need - (box[rock] ?? 0)));
  return room;
}

/**
 * Продажа: руда для следующей кирки не продаётся, а ложится в ящик кузнеца
 * (ровно столько, сколько рецепту ещё не хватает).
 */
export function reserveOre(
  bag: Bag,
  box: Bag,
  pick: number,
): { bag: Bag; box: Bag; moved: number } {
  if (pick < 0) return { bag, box, moved: 0 };
  const outBag: Bag = { ...bag };
  const outBox: Bag = { ...box };
  let moved = 0;
  for (const [rock, room] of boxRoom(pick, box)) {
    const k = Math.min(room, outBag[rock] ?? 0);
    if (k <= 0) continue;
    outBox[rock] = (outBox[rock] ?? 0) + k;
    outBag[rock] -= k;
    if (!outBag[rock]) delete outBag[rock];
    moved += k;
  }
  return moved ? { bag: outBag, box: outBox, moved } : { bag, box, moved: 0 };
}

/**
 * Спецзона платит токенами и рюкзака не знает: руда престижной кирки из неё
 * идёт в ящик сразу, из-под кирки.
 */
export function feedBox(
  box: Bag,
  units: number[],
  pick: number,
): { box: Bag; rest: number[]; took: number } {
  if (pick < 0) return { box, rest: units, took: 0 };
  const room = boxRoom(pick, box);
  const out: Bag = { ...box };
  const rest: number[] = [];
  let took = 0;
  for (const rock of units) {
    const left = room.get(rock) ?? 0;
    if (left > 0) {
      room.set(rock, left - 1);
      out[rock] = (out[rock] ?? 0) + 1;
      took += 1;
    } else rest.push(rock);
  }
  return took ? { box: out, rest, took } : { box, rest, took: 0 };
}

// ---------------------------------------------------------------------------
// Рюкзак и продажа.
// ---------------------------------------------------------------------------

/** Содержимое рюкзака: сколько блоков каждой породы (по индексу породы). */
export type Bag = Record<number, number>;

export function bagCount(bag: Bag): number {
  let n = 0;
  for (const k in bag) n += bag[k] || 0;
  return n;
}

/** Цена рюкзака. `mult` — множитель продажи (престиж, перки, коллекция). */
export function bagValue(bag: Bag, mult = 1): number {
  let v = 0;
  for (const k in bag) v += (bag[k] || 0) * (ROCKS[Number(k)]?.value ?? 0);
  return Math.round(v * mult);
}

/**
 * Разложить добычу по рюкзаку. Места нет — вагонетка (если куплена) продаёт
 * рюкзак и укладка продолжается; без вагонетки остаток пропадает в шахте.
 * Вагонетка, как и продажа руками, сперва откладывает руду для следующей
 * кирки в ящик кузнеца (`forge`).
 */
export function stash(
  bag: Bag,
  units: number[],
  cap: number,
  cart: boolean,
  mult: number,
  forge: { box: Bag; pick: number } = { box: {}, pick: -1 },
): { bag: Bag; taken: number; lost: number; sold: number; box: Bag; boxed: number } {
  let out: Bag = { ...bag };
  let box = forge.box;
  let count = bagCount(out);
  let taken = 0;
  let lost = 0;
  let sold = 0;
  let boxed = 0;
  for (const rock of units) {
    if (count >= cap) {
      if (!cart) {
        lost += 1;
        continue;
      }
      const r = reserveOre(out, box, forge.pick);
      out = { ...r.bag };
      box = r.box;
      boxed += r.moved;
      sold += bagValue(out, mult);
      for (const k in out) delete out[k];
      count = 0;
    }
    out[rock] = (out[rock] ?? 0) + 1;
    count += 1;
    taken += 1;
  }
  return { bag: out, taken, lost, sold, box, boxed };
}

// ---------------------------------------------------------------------------
// Токены и зачарования — как в X-Prison. Токены падают с блоков, на них
// качаются зачарования кирки. Цена уровня — база плюс шаг за каждый уже
// взятый уровень; сброс возвращает половину потраченного.
//
// Зачарования — главная кривая силы присона: к концу кирка ломает не блок,
// а полшахты за удар. Поэтому их цены не «на глаз»: тест темпа покупает их
// так же, как кирку, и следит, чтобы первый круг A→Z не схлопнулся.
// ---------------------------------------------------------------------------

export type EnchantId =
  | 'power'
  | 'fortune'
  | 'vein'
  | 'blast'
  | 'hammer'
  | 'token'
  | 'key'
  | 'frenzy'
  | 'crack'
  | 'beam'
  | 'reforge'
  | 'rockfall'
  | 'echo';

export interface Enchant {
  id: EnchantId;
  name: string;
  /** Что даёт один уровень — подпись в мастерской. */
  per: string;
  max: number;
  base: number;
  inc: number;
  glyph: string;
}

export const ENCHANTS: Enchant[] = [
  // «Сила» переименована в «Эффективность» (v2.67): у кирки теперь Сила ⛏ —
  // какую руду она берёт, а урона игрок не видит вовсе.
  {
    id: 'power',
    name: 'Эффективность',
    per: '+10% к скорости копки',
    max: 30,
    base: 50,
    inc: 30,
    glyph: '⚒',
  },
  {
    id: 'fortune',
    name: 'Удача',
    per: '+6% к шансу лишнего блока',
    max: 30,
    base: 80,
    inc: 50,
    glyph: '☘',
  },
  {
    id: 'vein',
    name: 'Жилокоп',
    per: '+2,5% выломать жилу целиком',
    max: 20,
    base: 65,
    inc: 40,
    glyph: '⚡',
  },
  { id: 'blast', name: 'Взрыв', per: '+1% снести 3×3', max: 20, base: 95, inc: 65, glyph: '✸' },
  {
    id: 'hammer',
    name: 'Отбойник',
    per: '+0,2% снести весь ярус',
    max: 15,
    base: 240,
    inc: 130,
    glyph: '≋',
  },
  { id: 'token', name: 'Токенист', per: '+15% токенов', max: 20, base: 40, inc: 25, glyph: '✦' },
  {
    id: 'key',
    name: 'Ключник',
    per: '+0,05% найти ключ',
    max: 20,
    base: 65,
    inc: 40,
    glyph: '⚿',
  },
  {
    id: 'frenzy',
    name: 'Кураж',
    per: '+0,08% впасть в кураж',
    max: 15,
    base: 130,
    inc: 80,
    glyph: '✺',
  },
  // Пять чар v2.49 — с серверов (X-Prison, Cosmic), под нашу сетку 7×9.
  {
    id: 'crack',
    name: 'Трещина',
    per: '+2% ударить и по соседям',
    max: 20,
    base: 60,
    inc: 35,
    glyph: '╳',
  },
  {
    id: 'beam',
    name: 'Луч',
    per: '+0,6% снести весь ряд',
    max: 15,
    base: 110,
    inc: 70,
    glyph: '═',
  },
  {
    id: 'reforge',
    name: 'Перековка',
    per: '+1,5% блоку стать породой выше',
    max: 20,
    base: 90,
    inc: 60,
    glyph: '⚙',
  },
  {
    id: 'rockfall',
    name: 'Камнепад',
    per: '+0,15% обрушить град взрывов',
    max: 15,
    base: 260,
    inc: 140,
    glyph: '☄',
  },
  {
    id: 'echo',
    name: 'Эхо',
    per: '+5% к шансам чар поля',
    max: 20,
    base: 200,
    inc: 120,
    glyph: '◎',
  },
];

export const enchantOf = (id: EnchantId): Enchant => ENCHANTS.find((e) => e.id === id)!;

export type Enchants = Record<EnchantId, number>;

export const NO_ENCHANTS: Enchants = {
  power: 0,
  fortune: 0,
  vein: 0,
  blast: 0,
  hammer: 0,
  token: 0,
  key: 0,
  frenzy: 0,
  crack: 0,
  beam: 0,
  reforge: 0,
  rockfall: 0,
  echo: 0,
};

/** Цена следующего уровня (с уровня `level` на `level + 1`). */
export function enchantCost(id: EnchantId, level: number): number {
  const e = enchantOf(id);
  return Math.round((e.base + e.inc * level) * ENCHANT_PRICE);
}

/**
 * Во сколько раз чары дороже, чем в v2.66. Круг A→Z стал в 2,6 раза
 * длиннее, токенов за него падает столько же больше — без этого чары
 * докачивались бы к середине круга, и поздние этажи пролетались бы.
 */
export const ENCHANT_PRICE = Number((typeof process !== 'undefined' && process.env?.EP) || 2.5);

/** Сколько вернёт сброс: половина всего, что ушло на уровни. */
export function enchantRefund(id: EnchantId, level: number): number {
  let sum = 0;
  for (let i = 0; i < level; i++) sum += enchantCost(id, i);
  return Math.floor(sum / 2);
}

/** Базовые шансы с одного блока — до зачарований и перков. */
export const TOKEN_CHANCE = 0.05;
export const TOKEN_MIN = 1;
export const TOKEN_MAX = 3;
export const KEY_CHANCE = 0.0012;
/** Кураж: столько длится и во сколько раз больше добычи и быстрее удар. */
export const FRENZY_MS = 15_000;
export const FRENZY_LOOT = 2;
export const FRENZY_RATE = 1.5;
/** Энергетик — вдвое быстрее кирка; лупа — видно ярус ниже. */
export const ENERGY_MS = 60_000;
export const ENERGY_RATE = 2;
export const LENS_MS = 90_000;

/** Сколько лишних блоков в среднем даёт срабатывание (для темпа). */
export const VEIN_EXTRA = 1.3;
export const BLAST_EXTRA = 7;
export const HAMMER_EXTRA = 55;
/** Луч — ряд из семи клеток; камнепад — четыре взрыва 3×3 внахлёст. */
export const BEAM_EXTRA = 5;
export const ROCKFALL_EXTRA = 24;
/** Трещина бьёт четырёх соседей одним ударом: ломается в среднем один. */
export const CRACK_EXTRA = 1.2;
/** Камнепад: сколько взрывов и через сколько мс друг за другом. */
export const ROCKFALL_HITS = 4;

/** Всё, что меняют зачарования, престиж, перки и коллекция, — в одном месте. */
export interface Mods {
  dmg: number;
  rate: number;
  sell: number;
  /** Ожидаемые лишние блоки добычи с одного сломанного. */
  fortune: number;
  vein: number;
  /** Сколько блоков жилы максимум уйдёт вместе с первым. */
  veinMax: number;
  blast: number;
  hammer: number;
  frenzy: number;
  crack: number;
  beam: number;
  rockfall: number;
  /** Шанс, что сломанный блок засчитается породой выше (Перековка). */
  reforge: number;
  tokenChance: number;
  keyChance: number;
  findChance: number;
  parcelChance: number;
}

export const BASE_MODS: Mods = {
  dmg: 1,
  rate: 1,
  sell: 1,
  fortune: 0,
  vein: 0,
  veinMax: 0,
  blast: 0,
  hammer: 0,
  frenzy: 0,
  crack: 0,
  beam: 0,
  rockfall: 0,
  reforge: 0,
  tokenChance: TOKEN_CHANCE,
  keyChance: KEY_CHANCE,
  findChance: 0,
  parcelChance: 0,
};

/** Что нужно `modsOf` из состояния: всё необязательное — для тестов и темпа. */
export interface ModsSource {
  ench: Enchants;
  prestige: number;
  perks?: Perks;
  finds?: Finds;
  pickXp?: number;
  off?: EnchantId[];
  runes?: Rune[];
  sockets?: number[];
  pet?: PetId | null;
  pets?: Pets;
  miles?: string[];
  handle?: number;
  event?: YardEvent | null;
  pickStars?: number;
  pearls?: number;
}

/** Жемчуг с рыбалки (v2.65): +0,5% к продаже везде за каждую, не больше десяти. */
export const PEARL_MAX = 10;
export const PEARL_SELL = 0.005;

// ---------------------------------------------------------------------------
// События двора (v2.54). Правила и награды — в `lib/yard.ts`; здесь только
// то, что нужно состоянию и множителям, иначе модули замкнулись бы друг на
// друга.
// ---------------------------------------------------------------------------

export type EventId =
  | 'meteor'
  | 'kuiva'
  | 'convoy'
  | 'gold'
  | 'payday'
  | 'blizzard'
  | 'bear'
  | 'magpie';
export const EVENT_IDS: EventId[] = [
  'meteor',
  'kuiva',
  'convoy',
  'gold',
  'payday',
  'blizzard',
  'bear',
  'magpie',
];

export interface YardEvent {
  id: EventId;
  /** Где началось: страница показывает событие только у себя. */
  place: 'mine' | 'forest';
  from: number;
  until: number;
  /** Метеорит — клетка; Куйва — левый верхний угол квадрата 3×3. */
  cell: number;
  /** Куйва: запас здоровья в единицах урона. */
  hp: number;
  /** Конвой — порода; медведь — не нужна (−1). */
  rock: number;
  /** Конвой и медведь: сколько сдать и сколько сдано. Сорока: `have` —
   *  монеты в мешочке, `need` — сколько ключей она уже уронила. */
  need: number;
  have: number;
}

// ---------------------------------------------------------------------------
// Сундучок живности (v2.64): награда, которая ждёт решения игрока — какую
// карту взять и рискнуть ли. Правила — в `critters.ts`; здесь только то, что
// лежит в сохранении: закрыл приложение посреди выбора — вернёшься к нему же.
// ---------------------------------------------------------------------------

export type TreasureFrom = 'bat' | 'batRare' | 'magpie' | 'box';

export interface Treasure {
  from: TreasureFrom;
  options: Reward[];
  /** Выбранная карта; −1 — ещё не выбрал. */
  pick: number;
  /** Ставка риска: монеты или токены выбранной карты. */
  stake: number;
  /** Сколько раз уже удвоено. */
  step: number;
  /** Открытая карта сдающего (0…51); −1 — раздачи нет. */
  dealer: number;
}

/** Больше четырёх удвоений (×16) не бывает: дальше — чистая лотерея. */
export const RISK_STEPS = 4;

/** Сохранение могло прийти битым — чиним по полям, иначе выбрасываем. */
export function normalizeTreasure(raw: unknown): Treasure | null {
  const t = raw as Partial<Treasure> | null | undefined;
  if (!t || typeof t !== 'object' || !Array.isArray(t.options) || !t.options.length) return null;
  const from: TreasureFrom =
    t.from === 'batRare' || t.from === 'magpie' || t.from === 'box' ? t.from : 'bat';
  const options = t.options.filter(
    (r): r is Reward =>
      !!r &&
      typeof r === 'object' &&
      ['coins', 'tokens', 'keys', 'item', 'rune'].includes((r as Reward).kind),
  );
  if (!options.length) return null;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  return {
    from,
    options,
    pick: num(t.pick, -1, options.length - 1, -1),
    stake: num(t.stake, 0, 1e13, 0),
    step: num(t.step, 0, RISK_STEPS, 0),
    dealer: num(t.dealer, -1, 51, -1),
  };
}

/** Получка платит вдвое, золотая жила — втрое больше добычи с блока. */
export const PAYDAY_SELL = 2;
export const GOLD_FORTUNE = 2;

// ---------------------------------------------------------------------------
// Спецзона (v2.55) — после первого престижа. Шахта из престижных пород,
// десять минут в день, норма зоны даёт ещё десять (до получаса). Платит НЕ
// монетами, а токенами: богатая порода за монеты обесценила бы всю лестницу
// рангов, а токенов не хватает всегда. Время идёт только за работой — между
// ударами засчитывается не больше трёх секунд, простой бесплатен.
// ---------------------------------------------------------------------------

export interface Zone {
  /** День по местному времени, к которому относится счёт. */
  day: string;
  /** Потрачено сегодня, мс. */
  used: number;
  /** Добавлено за нормы сегодня, мс. */
  bonus: number;
  /** Блоков сегодня в зачёт нормы. */
  have: number;
  /** Сейчас в спецзоне. */
  on: boolean;
  /** Когда засчитан последний удар. */
  tick: number;
  /** Шахта, в которую вернуться. */
  back: PrisonMine | null;
}

export const ZONE_MS = 10 * 60_000;
export const ZONE_BONUS_MS = 10 * 60_000;
export const ZONE_MAX_MS = 30 * 60_000;
export const ZONE_QUOTA = 400;
export const ZONE_IDLE_MS = 3_000;
/** С какого престижа открывается ступень спецзоны: новая порода сверху. */
export const ZONE_TIERS = [1, 3, 6, 10, 15];

export function zoneTier(prestige: number): number {
  return ZONE_TIERS.filter((t) => prestige >= t).length;
}

/** Шахта спецзоны: самая новая престижная порода, что открыта. */
export function zoneMineId(prestige: number): number {
  return LAST_RANK + zoneTier(prestige);
}

export function zoneDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Счёт на сегодня: новый день — время и норма заново, но из зоны не выкидывает. */
export function zoneToday(z: Zone, now: number): Zone {
  const day = zoneDay(now);
  return z.day === day ? z : { ...z, day, used: 0, bonus: 0, have: 0 };
}

export function zoneLeft(z: Zone, now: number): number {
  const t = zoneToday(z, now);
  return Math.max(0, ZONE_MS + t.bonus - t.used);
}

/**
 * Сколько токенов даёт блок в спецзоне. Престижная порода — от полутора и
 * выше, обычная (она лежит в зоне основой) — половина. На стенде первая
 * прикидка (1 и 0,35) давала треть токена с блока — поход в зону того не
 * стоил: обычная шахта даёт десятую, и разница не ощущалась.
 */
export function zoneTokens(rock: number): number {
  return rock >= MINES ? 1.5 + (rock - MINES) * 0.5 : 0.5;
}

function normalizeZone(raw: unknown): Zone {
  const z = raw as Partial<Zone> | null | undefined;
  const back = z?.back;
  return {
    day: typeof z?.day === 'string' ? z.day.slice(0, 12) : '',
    used: int(z?.used, 0, ZONE_MAX_MS * 2, 0),
    bonus: int(z?.bonus, 0, ZONE_MAX_MS, 0),
    have: int(z?.have, 0, 1e7, 0),
    on: z?.on === true,
    tick: int(z?.tick, 0, 1e14, 0),
    back:
      back && Array.isArray(back.dug) && back.dug.length === MINE_CELLS
        ? (() => {
            const dug = back.dug.map((d) => int(d, 0, DEPTH, 0));
            return {
              id: int(back.id, 0, LAST_RANK, 0),
              seed: int(back.seed, 0, 2 ** 31, 1),
              dug,
              bonus: normalizeBonus(back.bonus, dug),
            };
          })()
        : null,
  };
}

/** Событие, которое идёт прямо сейчас (null — тихо). */
export function liveEvent(p: { event?: YardEvent | null }, now = Date.now()): YardEvent | null {
  return p.event && p.event.until > now ? p.event : null;
}

export function modsOf(p: ModsSource): Mods {
  // Отключённая чара (игрок выключил её в мастерской) не срабатывает, но и
  // не теряет уровни: включил — и она снова в деле.
  const off = p.off ?? [];
  const lv = (id: EnchantId) => (off.includes(id) ? 0 : (p.ench[id] ?? 0));
  const k = p.perks ?? NO_PERKS;
  const nose = 1 + 0.2 * k.nose;
  const level = pickLevelOf(p.pickXp ?? 0).level;
  // Руны и питомец — прибавки v2.49. Складываются между собой и упираются
  // в потолок (`BONUS_CAP`): иначе к концу игры шахта печатала бы деньги, и
  // ставка в автоматах стала бы мелочью, ради которой незачем крутить.
  const b = bonusOf(p);
  // Эхо и руна Совило множат шансы чар поля: жилы, взрыва, отбойника, луча,
  // камнепада и трещины. Перековку не трогают — она про цену, а не про поле.
  const proc = (1 + 0.05 * lv('echo')) * (1 + b.proc);
  const ev = liveEvent(p)?.id;
  return {
    // Сноровка: каждый уровень кирки — ещё полпроцента к урону.
    dmg:
      (1 + 0.1 * lv('power')) *
      (1 + PICK_LEVEL_DMG * (level - 1)) *
      (1 + b.dmg) *
      (1 + STAR_DMG * (p.pickStars ?? 0)),
    rate: (1 + 0.08 * k.grip) * (1 + b.rate) * (1 + handleRate(p.handle)),
    // Постоянные надбавки к продаже вместе упираются в +100%; «получка» —
    // событие, она сверху.
    sell:
      Math.min(
        1 + SELL_BONUS_CAP,
        sellMult(p.prestige) *
          (1 + 0.06 * k.dealer) *
          findsMult(p.finds ?? {}) *
          (1 + b.sell) *
          (1 + PEARL_SELL * Math.min(PEARL_MAX, p.pearls ?? 0)),
      ) * (ev === 'payday' ? PAYDAY_SELL : 1),
    fortune: 0.06 * lv('fortune') + b.loot + (ev === 'gold' ? GOLD_FORTUNE : 0),
    vein: 0.025 * lv('vein') * proc,
    veinMax: 3 + Math.floor(lv('vein') / 4),
    blast: 0.01 * lv('blast') * proc,
    hammer: 0.002 * lv('hammer') * proc,
    frenzy: 0.0008 * lv('frenzy'),
    crack: 0.02 * lv('crack') * proc,
    beam: 0.006 * lv('beam') * proc,
    rockfall: 0.0015 * lv('rockfall') * proc,
    reforge: 0.015 * lv('reforge'),
    tokenChance: TOKEN_CHANCE * (1 + 0.15 * lv('token')) * (1 + 0.1 * k.lucky) * (1 + b.token),
    keyChance: (KEY_CHANCE + 0.0005 * lv('key')) * nose * (1 + b.luck),
    findChance: FIND_CHANCE * nose * (1 + b.luck),
    parcelChance: PARCEL_CHANCE * nose * (1 + b.luck),
  };
}

/** Целое число с вероятностным остатком: 2,3 → 2 или 3 (с шансом 30%). */
function rollCount(x: number, rnd: () => number): number {
  const whole = Math.floor(x);
  return whole + (rnd() < x - whole ? 1 : 0);
}

export interface Drops {
  /** Порода каждой единицы добычи (с учётом Удачи и Куража). */
  units: number[];
  /** Порода каждого сломанного блока ПОСЛЕ перековки — она идёт в норму. */
  rocks: number[];
  /** Индексы блоков (в порядке `rocks`), которые перековались. */
  reforged: number[];
  tokens: number;
  keys: number;
  finds: FindId[];
  /** Выпавшие посылки — по редкости. */
  parcels: CaseTier[];
}

/** Бросок добычи за сломанные блоки. Чистая функция: `rnd` передаёт вызвавший. */
export function rollDrops(
  rocks: number[],
  m: Mods,
  rnd: () => number,
  opts: { frenzy?: boolean; mine?: number; streak?: number } = {},
): Drops {
  const units: number[] = [];
  const out: number[] = [];
  const reforged: number[] = [];
  let tokens = 0;
  let keys = 0;
  const finds: FindId[] = [];
  const parcels: CaseTier[] = [];
  const whole = Math.floor(m.fortune);
  const frac = m.fortune - whole;
  const streak = Math.max(0, opts.streak ?? 0);
  for (let i = 0; i < rocks.length; i++) {
    let rock = rocks[i];
    // Перековка: блок засчитывается породой выше — и в цене, и в норме.
    if (m.reforge > 0 && rock < LAST_RANK && rnd() < m.reforge) {
      rock += 1;
      reforged.push(i);
    }
    out.push(rock);
    let n = 1 + whole + (rnd() < frac ? 1 : 0);
    // Запал множит уже посчитанную Удачу: серия и чара складываются как
    // множители, а не как проценты.
    if (streak > 0) n = rollCount(n * (1 + streak), rnd);
    if (opts.frenzy) n *= FRENZY_LOOT;
    for (let i = 0; i < n; i++) units.push(rock);
    if (rnd() < m.tokenChance)
      tokens += TOKEN_MIN + Math.floor(rnd() * (TOKEN_MAX - TOKEN_MIN + 1));
    if (rnd() < m.keyChance) keys += 1;
    if (m.findChance > 0 && rnd() < m.findChance) {
      const f = rollFind(opts.mine ?? LAST_RANK, rnd);
      if (f) finds.push(f);
    }
    if (m.parcelChance > 0 && rnd() < m.parcelChance) parcels.push(rollTier(rnd));
  }
  return { units, rocks: out, reforged, tokens, keys, finds, parcels };
}

// ---------------------------------------------------------------------------
// Запал — серия копания, как Momentum на присон-серверах. Каждый сломанный
// блок подбрасывает счётчик, ступени дают прибавку к добыче. Перестал бить —
// через несколько секунд запал гаснет по ступени. Хранится только в странице:
// это награда за то, что ты копаешь СЕЙЧАС, её не накопить впрок.
//
// Ступени названы по-шахтёрски, и четвёртая не случайно «Стахановец»: норма
// выработки — главная механика рангов, а Стаханов вошёл в историю тем, что
// перекрыл её в четырнадцать раз.
// ---------------------------------------------------------------------------

export interface StreakTier {
  name: string;
  /** С какого счёта серии открывается ступень. */
  at: number;
  /** Прибавка к добыче: 0,25 — четверть блоков сверху. */
  loot: number;
}

export const STREAK_TIERS: StreakTier[] = [
  { name: 'Разогрев', at: 40, loot: 0.04 },
  { name: 'Раж', at: 150, loot: 0.1 },
  { name: 'В ударе', at: 400, loot: 0.18 },
  { name: 'Стахановец', at: 1000, loot: 0.28 },
  { name: 'Легенда забоя', at: 2500, loot: 0.4 },
];

/** Пауза, после которой запал начинает гаснуть, и шаг угасания. */
export const STREAK_GRACE_MS = 4000;
export const STREAK_DECAY_MS = 2500;

/** Номер ступени (−1 — запала нет). */
export function streakTier(streak: number): number {
  let t = -1;
  for (let i = 0; i < STREAK_TIERS.length; i++) if (streak >= STREAK_TIERS[i].at) t = i;
  return t;
}

export function streakLoot(streak: number): number {
  const t = streakTier(streak);
  return t < 0 ? 0 : STREAK_TIERS[t].loot;
}

/**
 * Серия после простоя `idleMs`. Первые STREAK_GRACE_MS ничего не теряется
 * (продать рюкзак и вернуться — не повод гасить), дальше каждые
 * STREAK_DECAY_MS — минус ступень, и счёт встаёт на её нижнюю границу.
 */
export function decayStreak(streak: number, idleMs: number): number {
  if (idleMs <= STREAK_GRACE_MS || streak <= 0) return streak;
  const steps = Math.floor((idleMs - STREAK_GRACE_MS) / STREAK_DECAY_MS) + 1;
  const t = streakTier(streak) - steps;
  return t >= 0 ? STREAK_TIERS[t].at : 0;
}

// ---------------------------------------------------------------------------
// Уровень кирки. Опыт — сломанные блоки (любые: удар, жила, взрыв). Уровень
// открывает чары по веткам (Отбойник не купишь с новенькой киркой) и
// поднимает их потолок; каждый уровень — ещё процент к урону. Так у каждого
// удара появляется смысл: даже мелкий блок двигает полоску.
// ---------------------------------------------------------------------------

export const PICK_LEVEL_MAX = 50;
export const PICK_LEVEL_DMG = 0.005;

/** Опыта, чтобы уйти с уровня `level` на следующий. */
export function pickXpFor(level: number): number {
  return Math.round(PICK_XP * Math.pow(1.13, level - 1));
}

/** Опыт первого уровня кирки (v2.67: круг длиннее — уровни реже). */
export const PICK_XP = Number((typeof process !== 'undefined' && process.env?.PX) || 200);

export function pickLevelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  for (;;) {
    const need = pickXpFor(level);
    if (level >= PICK_LEVEL_MAX) return { level, into: 0, need: 0 };
    if (rest < need) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/** С какого уровня кирки открывается чара. */
export const ENCHANT_UNLOCK: Record<EnchantId, number> = {
  power: 1,
  fortune: 1,
  token: 1,
  vein: 3,
  key: 5,
  crack: 6,
  blast: 8,
  beam: 10,
  frenzy: 12,
  reforge: 14,
  hammer: 18,
  rockfall: 22,
  echo: 26,
};

/**
 * Престиж кирки (v2.55). На 50-м уровне кирку можно перековать: опыт — в
 * ноль, зато звезда. Каждая звезда поднимает потолок КАЖДОЙ чары на 20% и
 * даёт +10% урона. Уровни чар, купленные раньше, не срезаются — как и при
 * обычном потолке, он ограничивает только покупку.
 */
export const PICK_STARS_MAX = 10;
export const STAR_CAP = 0.2;
export const STAR_DMG = 0.1;
export const STAR_TOKENS = 500;
export const STAR_KEYS = 3;

/** Предел чары с учётом звёзд кирки. */
export function enchantMax(id: EnchantId, stars = 0): number {
  return Math.round(enchantOf(id).max * (1 + STAR_CAP * Math.max(0, stars)));
}

/** Потолок уровня чары при данном уровне кирки: к 40-му открыт весь. */
export function enchantCap(id: EnchantId, pickLevel: number, stars = 0): number {
  const max = enchantMax(id, stars);
  if (pickLevel < ENCHANT_UNLOCK[id]) return 0;
  return Math.min(max, 3 + Math.floor((pickLevel * max) / 40));
}

/**
 * Чары, которые можно выключить, не сбрасывая: те, что меняют САМО копание
 * (ломают соседей, ускоряют кирку). Иногда нужен точный удар — например,
 * добрать норму в одном месте, не сметя всё вокруг.
 */
export const ENCHANT_TOGGLE: EnchantId[] = [
  'vein',
  'blast',
  'hammer',
  'frenzy',
  'crack',
  'beam',
  'rockfall',
];

/** Награда за новый уровень кирки: токены, а каждый пятый — ещё ключ. */
export function pickLevelReward(level: number): { tokens: number; keys: number } {
  return { tokens: 10 * level, keys: level % 5 === 0 ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Условия ранга (v2.67). Одних денег мало, как на русских присонах:
// - КИРКА — берёт руду следующего этажа (с C: на D нужна каменная). Новый
//   этаж без неё не копается: шахта — яма, твёрдый верх закрыл бы всё.
// - ВЫРАБОТКА — сломать N блоков (удары и чары кирки; рабочие не в счёт).
//   Докупить нельзя: это и есть «сначала поработай».
// - БЛОКИ ЭТАЖА — 3…10 цельных блоков руды своего этажа. Недостающие
//   докупаются втрое дороже блока; за долгую невезуху есть гарантия.
// A–D — деньги (и каменная кирка на D): там учатся копать. Счётчики —
// `norm` (блоки по породам, сумма — выработка), `oreBlocks` и `pity`;
// сбрасываются на ранге.
// ---------------------------------------------------------------------------

/** Доля породы `rock` среди всех блоков шахты `mine`, по всем ярусам. */
export function rockShare(mine: number, rock: number): number {
  return mineShares(mine).find((m) => m.rock === rock)?.share ?? 0;
}

export function rankWork(rank: number): number {
  return RANK_WORK[rank] ?? 0;
}

export function rankBlocks(rank: number): number {
  return RANK_BLOCKS[rank] ?? 0;
}

/** Сломано блоков на этаже с прошлого ранга. */
export function workDone(norm: Record<number, number>): number {
  let n = 0;
  for (const k in norm) n += norm[k] || 0;
  return n;
}

export interface RankNeeds {
  coins: number;
  work: number;
  workNeed: number;
  blocks: number;
  blocksNeed: number;
  /** Цена докупки недостающих блоков этажа; 0 — докупать нечего. */
  buyout: number;
  /** Сила кирки, которую просит следующий этаж, и есть ли она. */
  power: number;
  pickOk: boolean;
}

export function rankNeeds(p: {
  rank: number;
  norm: Record<number, number>;
  oreBlocks: number;
  pick: number;
}): RankNeeds {
  const r = Math.min(p.rank, LAST_RANK - 1);
  const blocksNeed = rankBlocks(r);
  const missing = Math.max(0, blocksNeed - p.oreBlocks);
  const power = rockHardness(r + 1);
  return {
    coins: rankCost(r),
    work: Math.min(workDone(p.norm), rankWork(r)),
    workNeed: rankWork(r),
    blocks: Math.min(p.oreBlocks, blocksNeed),
    blocksNeed,
    buyout: missing * BLOCK_PRICE[r] * BLOCK_BUYOUT,
    power,
    pickOk: pickPower(p.pick) >= power,
  };
}

// ---------------------------------------------------------------------------
// Руны — как кристаллы Cosmic и руны VimeWorld. Три гнезда на кирке (четвёртое
// — за десятый престиж), шесть видов. Сила выпадает ВНУТРИ полосы ступени,
// поэтому две руны одной ступени не равны — есть что искать. Три руны одной
// ступени сплавляются в руну ступенью выше; вид берётся у той, которую
// сплавляешь, а сила не ниже средней из трёх: хорошие руны не пропадают.
//
// Руны названы по-настоящему (старший футарк), и смысл знака совпадает с
// действием: Феху — богатство, Уруз — сила, Райдо — дорога, Йера — урожай,
// Гебо — дар, Совило — солнце.
// ---------------------------------------------------------------------------

export type RuneKind = 'sell' | 'dmg' | 'rate' | 'loot' | 'token' | 'proc';

export interface RuneDef {
  id: RuneKind;
  name: string;
  /** Что даёт: «+4% к продаже». */
  text: string;
  /** Сколько даёт одна «единица» силы. */
  unit: number;
}

export const RUNES: RuneDef[] = [
  { id: 'sell', name: 'Феху', text: 'к продаже', unit: 0.016 },
  { id: 'dmg', name: 'Уруз', text: 'к скорости копки', unit: 0.024 },
  { id: 'rate', name: 'Райдо', text: 'к частоте ударов', unit: 0.01 },
  { id: 'loot', name: 'Йера', text: 'к добыче', unit: 0.016 },
  { id: 'token', name: 'Гебо', text: 'к токенам', unit: 0.032 },
  { id: 'proc', name: 'Совило', text: 'к шансам чар кирки и топора', unit: 0.024 },
];

export const runeOf = (kind: RuneKind): RuneDef => RUNES.find((r) => r.id === kind)!;

export const RUNE_TIERS = 5;
/** Полоса силы каждой ступени, в единицах руны. */
export const RUNE_BAND: [number, number][] = [
  [1, 2],
  [2, 3.5],
  [3.5, 5.5],
  [5.5, 8],
  [8, 11],
];
/** Римские цифры ступеней — так руны подписаны на кирке. */
export const RUNE_ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** Сколько токенов даёт разбитая руна. */
export const RUNE_SHATTER = [8, 25, 70, 200, 600];
/** Мешочек для рун: лишние разбиваются сами. */
export const RUNE_BAG = 40;
/** С какого уровня кирки открывается гнездо. Четвёртое — веха «Престиж 10». */
export const SOCKET_UNLOCK = [5, 15, 30];
export const SOCKETS_MAX = 4;

export interface Rune {
  id: number;
  kind: RuneKind;
  /** Ступень 1…5. */
  tier: number;
  /** Где внутри полосы ступени: 0…100. */
  roll: number;
}

/** Сколько даёт руна: доля, 0,05 — пять процентов. */
export function runePower(r: { kind: RuneKind; tier: number; roll: number }): number {
  const [lo, hi] = RUNE_BAND[Math.max(1, Math.min(RUNE_TIERS, r.tier)) - 1];
  return runeOf(r.kind).unit * (lo + ((hi - lo) * r.roll) / 100);
}

/** Новая руна: вид случайный (если не задан), сила — внутри полосы. */
export function rollRune(
  tier: number,
  rnd: () => number,
  kind?: RuneKind,
  floor = 0,
): Omit<Rune, 'id'> {
  return {
    kind: kind ?? RUNES[Math.floor(rnd() * RUNES.length)].id,
    tier: Math.max(1, Math.min(RUNE_TIERS, tier)),
    roll: Math.max(Math.round(floor), Math.floor(rnd() * 101)),
  };
}

/**
 * Сколько гнёзд оберега открыто: по уровню кирки ИЛИ топора (что выше) плюс
 * веха «Престиж 10». Оберег один на шахту и лес, поэтому и открывать его
 * можно любым инструментом — лесоруб не должен ради гнезда идти в забой.
 */
export function socketsOpen(p: { pickXp: number; miles?: string[] }, axeLevel = 0): number {
  const level = Math.max(pickLevelOf(p.pickXp).level, axeLevel);
  return SOCKET_UNLOCK.filter((l) => level >= l).length + (p.miles?.includes('p10') ? 1 : 0);
}

/**
 * Сплавить руну `baseId` с двумя другими той же ступени. Берутся самые
 * слабые свободные (не в гнезде) — чтобы сплав не съел то, что носишь.
 */
export function fusePlan(
  runes: Rune[],
  sockets: number[],
  baseId: number,
): { base: Rune; with: Rune[] } | null {
  const base = runes.find((r) => r.id === baseId);
  if (!base || base.tier >= RUNE_TIERS) return null;
  const others = runes
    .filter((r) => r.id !== baseId && r.tier === base.tier && !sockets.includes(r.id))
    .sort((a, b) => runePower(a) - runePower(b));
  if (others.length < 2) return null;
  return { base, with: others.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// Питомцы — кольская фауна. Растут, пока копаешь (опыт — сломанные блоки),
// с собой водишь одного. Каждый даёт одну прибавку, растущую с уровнем.
// Приходят из посылок; второй такой же — лакомство, опыт текущему.
// ---------------------------------------------------------------------------

export type PetId = 'lemming' | 'fox' | 'wolverine' | 'raven' | 'owl' | 'calf';

/** Что умеет питомец. `luck` — ключи, находки и посылки. */
export type PetStat = 'loot' | 'sell' | 'dmg' | 'token' | 'luck' | 'rate';

export interface PetDef {
  id: PetId;
  name: string;
  stat: PetStat;
  /** Прибавка за уровень. */
  per: number;
  text: string;
  lore: string;
}

export const PETS: PetDef[] = [
  {
    id: 'lemming',
    name: 'Лемминг',
    stat: 'loot',
    per: 0.012,
    text: 'к добыче',
    lore: 'Их в тундре тысячи, и все копают',
  },
  {
    id: 'fox',
    name: 'Песец',
    stat: 'sell',
    per: 0.01,
    text: 'к продаже',
    lore: 'Торгуется за каждый камешек',
  },
  {
    id: 'wolverine',
    name: 'Росомаха',
    stat: 'dmg',
    per: 0.02,
    text: 'к скорости копки',
    lore: 'Грызёт мёрзлый гранит',
  },
  {
    id: 'raven',
    name: 'Ворон',
    stat: 'token',
    per: 0.03,
    text: 'к токенам',
    lore: 'Тащит всё, что блестит',
  },
  {
    id: 'owl',
    name: 'Полярная сова',
    stat: 'luck',
    per: 0.03,
    text: 'к ключам, находкам и посылкам',
    lore: 'Видит сквозь пургу',
  },
  {
    id: 'calf',
    name: 'Оленёнок',
    stat: 'rate',
    per: 0.008,
    text: 'к частоте ударов',
    lore: 'Тянет волокушу с рудой',
  },
];

export const petOf = (id: PetId): PetDef => PETS.find((x) => x.id === id)!;

/** Опыт каждого приручённого питомца. Нет ключа — не приручён. */
export type Pets = Partial<Record<PetId, number>>;

export const PET_LEVEL_MAX = 25;
/** Лакомство (второй такой же питомец) — опыт текущему. */
export const PET_TREAT_XP = 400;

export function petXpFor(level: number): number {
  return Math.round(150 * Math.pow(1.2, level - 1));
}

export function petLevelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  for (;;) {
    if (level >= PET_LEVEL_MAX) return { level, into: 0, need: 0 };
    const need = petXpFor(level);
    if (rest < need) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/** Прибавка питомца на уровне `level`. */
export function petPower(id: PetId, level: number): number {
  return petOf(id).per * level;
}

// ---------------------------------------------------------------------------
// Потолок прибавок. Руны и питомец складываются по виду и упираются в
// потолок: общий кошелёк не переживёт шахту, которая к престижу печатает
// миллионы, — ставка 500 в автоматах перестала бы что-то значить.
// ---------------------------------------------------------------------------

export interface Bonus {
  sell: number;
  dmg: number;
  rate: number;
  loot: number;
  token: number;
  proc: number;
  luck: number;
}

export const NO_BONUS: Bonus = { sell: 0, dmg: 0, rate: 0, loot: 0, token: 0, proc: 0, luck: 0 };

export const BONUS_CAP: Bonus = {
  sell: 1,
  dmg: 1,
  rate: 0.5,
  loot: 1,
  token: 1.5,
  proc: 1,
  luck: 1,
};

/** Прибавки рун в гнёздах и питомца — уже с потолком. */
export function bonusOf(p: {
  runes?: Rune[];
  sockets?: number[];
  pet?: PetId | null;
  pets?: Pets;
}): Bonus {
  const b: Bonus = { ...NO_BONUS };
  const runes = p.runes ?? [];
  for (const id of p.sockets ?? []) {
    if (!id) continue;
    const r = runes.find((x) => x.id === id);
    if (r) b[r.kind] += runePower(r);
  }
  if (p.pet && p.pets && p.pets[p.pet] !== undefined) {
    const def = petOf(p.pet);
    b[def.stat] += petPower(p.pet, petLevelOf(p.pets[p.pet] ?? 0).level);
  }
  for (const k of Object.keys(b) as (keyof Bonus)[]) b[k] = Math.min(BONUS_CAP[k], b[k]);
  return b;
}

// ---------------------------------------------------------------------------
// Посылки — Lucky Blocks присон-серверов, по-нашему «посылка с воли».
// Падает с блока, ложится в одно из трёх мест и вскрывается, когда ты добудешь
// ещё N блоков: чем реже посылка, тем дольше ждать. Копятся все сразу.
// Главный источник рун и питомцев.
// ---------------------------------------------------------------------------

export interface Parcel {
  tier: CaseTier;
  /** Сколько блоков ещё добыть до вскрытия. */
  left: number;
}

export const PARCEL_SLOTS = 3;
/** Шанс посылки с блока: примерно одна на полторы тысячи. */
export const PARCEL_CHANCE = 0.0012;
export const PARCEL_NEED: Record<CaseTier, number> = {
  common: 150,
  rare: 400,
  epic: 900,
  legend: 2000,
};
/** Мест нет — посылку сдают за токены. */
export const PARCEL_OVERFLOW: Record<CaseTier, number> = {
  common: 10,
  rare: 25,
  epic: 60,
  legend: 150,
};

// ---------------------------------------------------------------------------
// Расходники: за токены в лавке, позже — из сундуков.
// ---------------------------------------------------------------------------

export type ItemId = 'bomb3' | 'bomb5' | 'charge' | 'energy' | 'lens' | 'prop';

export interface Item {
  id: ItemId;
  name: string;
  text: string;
  glyph: string;
  /** Цена в лавке, токенов. */
  price: number;
}

export const ITEMS: Item[] = [
  { id: 'bomb3', name: 'Бомба', text: 'Сносит 3×3 на ярус', glyph: '💣', price: 25 },
  { id: 'bomb5', name: 'Динамит', text: 'Сносит 5×5 на ярус', glyph: '🧨', price: 70 },
  { id: 'charge', name: 'Заряд', text: 'Снимает весь верхний ярус', glyph: '💥', price: 180 },
  { id: 'energy', name: 'Энергетик', text: 'Кирка вдвое быстрее минуту', glyph: '⚡', price: 40 },
  { id: 'lens', name: 'Лупа', text: 'Полторы минуты видно ярус ниже', glyph: '🔍', price: 20 },
  // Крепь в лавке не продаётся (цена 0): её сбивают на лесопилке из досок.
  {
    id: 'prop',
    name: 'Крепь',
    text: 'Десять минут каждый второй блок — порода выше',
    glyph: '⛩',
    price: 0,
  },
];

export const itemOf = (id: ItemId): Item => ITEMS.find((i) => i.id === id)!;

export type Items = Record<ItemId, number>;

export const NO_ITEMS: Items = { bomb3: 0, bomb5: 0, charge: 0, energy: 0, lens: 0, prop: 0 };

/**
 * Крепь — брёвна, которыми подпирают свод. С ней лезут в забой, куда без
 * неё не пускают: десять минут Перековка сильнее на `PROP_REFORGE`.
 * Делается из досок лесопилки — первый мост из леса в шахту.
 */
export const PROP_MS = 10 * 60_000;
export const PROP_REFORGE = 0.5;
export const PROP_BOARDS = 20;

/**
 * Рукояти — второй мост: из досок редких пород. Ставятся на кирку и топор
 * разом и ускоряют удар. Каждая следующая заменяет прошлую, а не
 * складывается с ней. `species` — номер породы в лесу (`forest.ts`).
 */
export interface Handle {
  id: string;
  name: string;
  species: number;
  boards: number;
  rate: number;
}

export const HANDLES: Handle[] = [
  { id: 'birch', name: 'Берёзовая рукоять', species: 3, boards: 40, rate: 0.03 },
  { id: 'larch', name: 'Лиственничная рукоять', species: 7, boards: 60, rate: 0.06 },
  { id: 'karelian', name: 'Рукоять из карельской берёзы', species: 9, boards: 80, rate: 0.1 },
];

/** Прибавка к скорости от рукояти: 0 — родная. */
export function handleRate(handle: number | undefined): number {
  const h = HANDLES[(handle ?? 0) - 1];
  return h ? h.rate : 0;
}

/** Клетки, которые снесёт бомба радиуса `r` с центром в `cell`. */
export function blastCells(cell: number, r: number): number[] {
  const cx = cell % MINE_COLS;
  const cy = Math.floor(cell / MINE_COLS);
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < MINE_COLS && y < MINE_ROWS) out.push(y * MINE_COLS + x);
  return out;
}

/**
 * Жила от клетки `cell`: соседи (по стороне), у которых СВЕРХУ та же
 * порода, — обход в ширину, не больше `max` клеток сверх первой.
 */
export function veinCells(
  rocks: number[],
  dug: number[],
  cell: number,
  rock: number,
  max: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>([cell]);
  const queue = [cell];
  while (queue.length && out.length < max) {
    const c = queue.shift()!;
    const x = c % MINE_COLS;
    const y = Math.floor(c / MINE_COLS);
    const nb = [
      x > 0 ? c - 1 : -1,
      x < MINE_COLS - 1 ? c + 1 : -1,
      y > 0 ? c - MINE_COLS : -1,
      y < MINE_ROWS - 1 ? c + MINE_COLS : -1,
    ];
    for (const n of nb) {
      if (n < 0 || seen.has(n)) continue;
      seen.add(n);
      if (rockAt(rocks, n, dug[n]) !== rock) continue;
      out.push(n);
      queue.push(n);
      if (out.length >= max) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Темп. Та же модель, что в тесте: сколько монет в секунду даёт шахта при
// ударах на удержании. Страница ею не пользуется — она для баланса.
// ---------------------------------------------------------------------------

/** Ожидаемое число ударов на блок породы `rock`. */
export function hitsFor(rock: number, dmg: number): number {
  const hp = ROCKS[rock].hp;
  // Крит — это шанс снести блок на удар раньше. Честный расчёт по цепочке
  // ударов тут не нужен: для темпа хватает среднего урона.
  const mean = dmg * (1 + CRIT_CHANCE * (CRIT_MULT - 1));
  return Math.max(1, Math.ceil(hp / mean - 1e-9));
}

/** Сколько блоков в среднем ломается за удар, который сломал один. */
export function extraBlocks(m: Mods): number {
  return (
    m.vein * VEIN_EXTRA +
    m.blast * BLAST_EXTRA +
    m.hammer * HAMMER_EXTRA +
    m.beam * BEAM_EXTRA +
    m.rockfall * ROCKFALL_EXTRA +
    m.crack * CRACK_EXTRA
  );
}

/**
 * Средний доход шахты, монет в секунду, на удержании. Считает и зачарования:
 * урон от Эффективности, лишние блоки от жил и взрывов, лишнюю добычу от
 * Удачи. Руда твёрже кирки не копается — её доля выпадает из дохода.
 */
export function incomeRate(mine: number, pick: number, m: Mods = BASE_MODS): number {
  // Перековка поднимает блок на породу выше — примерно на шаг цены руды.
  const r = Math.max(0, Math.min(ORE_PRICE.length - 2, mine));
  const reforge = 1 + m.reforge * (ORE_PRICE[r + 1] / ORE_PRICE[r] - 1);
  return blockRate(mine, pick, m) * (1 + m.fortune) * avgValue(mine, pick) * m.sell * reforge;
}

/** Средняя цена блока шахты по всем ярусам — из тех, что кирка берёт. */
export function avgValue(mine: number, pick = PICKS.length - 1): number {
  const ok = mineShares(mine).filter((s) => canMine(pick, s.rock));
  const sum = ok.reduce((v, s) => v + s.share, 0);
  return sum ? ok.reduce((v, s) => v + s.share * ROCKS[s.rock].value, 0) / sum : 0;
}

/** Сколько блоков в секунду ломает кирка на удержании (с чарами поля). */
export function blockRate(mine: number, pick: number, m: Mods = BASE_MODS): number {
  return hitRate(mine, pick, m) * (1 + extraBlocks(m));
}

/** Блоков в секунду одними ударами, без взрывов и жил. */
function hitRate(mine: number, pick: number, m: Mods): number {
  const dmg = hitDamage(pick) * m.dmg;
  const rate = PICKS[pick].rate * m.rate;
  const ok = mineShares(mine).filter((s) => canMine(pick, s.rock));
  const sum = ok.reduce((v, s) => v + s.share, 0);
  if (!sum) return 0;
  const hits = ok.reduce((h, s) => h + (s.share / sum) * hitsFor(s.rock, dmg), 0);
  return rate / hits;
}

/**
 * Скорость кирки для игрока: блоков в минуту на удержании в шахте `mine`,
 * одними ударами (без взрывов и жил — они случай, а не скорость). Это
 * цифра вместо урона: её видно в кузнице и на кирке.
 */
export function pickSpeed(mine: number, pick: number, m: Mods = BASE_MODS): number {
  return Math.round(60 * hitRate(mine, pick, m));
}

// ---------------------------------------------------------------------------
// Находки. Редкий дроп поверх породы, как коллекции на VimeWorld и
// DiamondWorld: каждая новая находка навсегда прибавляет 1% к продаже, полная
// коллекция — ещё 10%. Дубликат не пропадает: его сдают за токены. Находки
// открываются по мере спуска — в шахте A не найдёшь лампу забойщика.
// ---------------------------------------------------------------------------

export type FindId =
  | 'coin'
  | 'key'
  | 'fern'
  | 'ammonite'
  | 'trilobite'
  | 'nugget'
  | 'tooth'
  | 'geode'
  | 'amber'
  | 'medal'
  | 'core'
  | 'lamp';

export interface Find {
  id: FindId;
  name: string;
  /** С какой шахты попадается. */
  from: number;
  /** Вес среди доступных: ранние находки чаще. */
  weight: number;
  text: string;
}

export const FINDS: Find[] = [
  { id: 'coin', name: 'Старая монета', from: 0, weight: 10, text: 'Копейка 1799 года' },
  { id: 'key', name: 'Ключ от камеры', from: 2, weight: 9, text: 'Ржавый, но ещё поворачивается' },
  { id: 'fern', name: 'Отпечаток папоротника', from: 4, weight: 8, text: 'Каменноугольный период' },
  { id: 'ammonite', name: 'Аммонит', from: 6, weight: 7, text: 'Раковина, закрученная спиралью' },
  { id: 'trilobite', name: 'Трилобит', from: 8, weight: 6, text: 'Ему полмиллиарда лет' },
  { id: 'nugget', name: 'Самородок', from: 10, weight: 5, text: 'Золото без примесей' },
  { id: 'tooth', name: 'Зуб мамонта', from: 12, weight: 4, text: 'Вечная мерзлота сохранила' },
  { id: 'geode', name: 'Жеода', from: 14, weight: 3.5, text: 'Снаружи камень, внутри аметист' },
  {
    id: 'amber',
    name: 'Янтарь с мушкой',
    from: 16,
    weight: 3,
    text: 'Муха застыла сорок миллионов лет назад',
  },
  { id: 'medal', name: 'Царская медаль', from: 18, weight: 2.5, text: '«За усердие»' },
  {
    id: 'core',
    name: 'Керн Кольской сверхглубокой',
    from: 20,
    weight: 2,
    text: 'С глубины двенадцать километров',
  },
  { id: 'lamp', name: 'Лампа первого забойщика', from: 23, weight: 1.5, text: 'Горит до сих пор' },
];

export type Finds = Partial<Record<FindId, number>>;

/** Шанс находки с блока: одна на две с половиной тысячи. */
export const FIND_CHANCE = 0.0004;
/** Токены за дубликат. */
export const FIND_DUP_TOKENS = 40;

export const findOf = (id: FindId): Find => FINDS.find((f) => f.id === id)!;

/** Какая находка выпала в шахте `mine` (или null, если доступных нет). */
export function rollFind(mine: number, rnd: () => number): FindId | null {
  const pool = FINDS.filter((f) => f.from <= mine);
  if (!pool.length) return null;
  const total = pool.reduce((s, f) => s + f.weight, 0);
  let x = rnd() * total;
  for (const f of pool) {
    x -= f.weight;
    if (x <= 0) return f.id;
  }
  return pool[pool.length - 1].id;
}

export function findsFound(finds: Finds): number {
  return FINDS.filter((f) => (finds[f.id] ?? 0) > 0).length;
}

/** Бонус коллекции к продаже. */
export function findsMult(finds: Finds): number {
  const n = findsFound(finds);
  return 1 + 0.01 * n + (n === FINDS.length ? 0.1 : 0);
}

// ---------------------------------------------------------------------------
// Ключи и сундуки. Ключ падает с блока (Ключник поднимает шанс), даётся за
// каждый ранг и пачкой за престиж. Сундук крутит ленту наград: четыре
// ступени редкости, награда в монетах — доля цены текущего ранга, поэтому
// сундук одинаково приятен на ранге C и на ранге X.
// ---------------------------------------------------------------------------

export type CaseTier = 'common' | 'rare' | 'epic' | 'legend';

export interface CaseTierDef {
  id: CaseTier;
  name: string;
  weight: number;
  color: string;
  /** Вес события для звука и вспышки (как у выигрышей автоматов). */
  beats: number;
}

export const CASE_TIERS: CaseTierDef[] = [
  { id: 'common', name: 'Обычное', weight: 58, color: '#9aa7b4', beats: 0 },
  { id: 'rare', name: 'Редкое', weight: 30, color: '#4f8cff', beats: 1 },
  { id: 'epic', name: 'Эпическое', weight: 10, color: '#b36cff', beats: 2 },
  { id: 'legend', name: 'Легенда', weight: 2, color: '#ffb020', beats: 4 },
];

export type Reward =
  | { kind: 'coins'; amount: number }
  | { kind: 'tokens'; amount: number }
  | { kind: 'item'; id: ItemId; amount: number }
  | { kind: 'find'; id: FindId }
  | { kind: 'keys'; amount: number }
  | { kind: 'rune'; rune: Omit<Rune, 'id'> }
  | { kind: 'pet'; id: PetId }
  | { kind: 'treat'; amount: number };

export interface CaseRoll {
  tier: CaseTier;
  reward: Reward;
}

type Slot = { w: number; make: (rnd: () => number, rank: number, prestige: number) => Reward };

const coins = (lo: number, hi: number) => (rnd: () => number, rank: number, prestige: number) =>
  ({
    kind: 'coins',
    amount: nice(rankCost(Math.min(rank, LAST_RANK - 1), prestige) * (lo + (hi - lo) * rnd())),
  }) as Reward;
const tokens = (lo: number, hi: number) => (rnd: () => number) =>
  ({ kind: 'tokens', amount: Math.round(lo + (hi - lo) * rnd()) }) as Reward;
const item = (id: ItemId, amount: number) => () => ({ kind: 'item', id, amount }) as Reward;
const FIND_SLOT = () => ({ kind: 'find', id: 'coin' }) as Reward;
/** Руна ступени `lo`, с шансом `pHi` — ступени `hi`. */
const rune = (lo: number, hi: number, pHi: number) => (rnd: () => number) =>
  ({ kind: 'rune', rune: rollRune(rnd() < pHi ? hi : lo, rnd) }) as Reward;
const keysOf = (amount: number) => () => ({ kind: 'keys', amount }) as Reward;
/** Место под питомца: кто именно — решается по тому, кого ещё нет. */
const PET_SLOT = () => ({ kind: 'pet', id: 'lemming' }) as Reward;

const CASE_TABLE: Record<CaseTier, Slot[]> = {
  common: [
    { w: 35, make: coins(0.04, 0.08) },
    { w: 35, make: tokens(15, 40) },
    { w: 10, make: item('energy', 1) },
    { w: 10, make: item('lens', 1) },
    { w: 10, make: item('bomb3', 1) },
  ],
  rare: [
    { w: 30, make: coins(0.1, 0.18) },
    { w: 30, make: tokens(50, 120) },
    { w: 15, make: item('bomb3', 2) },
    { w: 10, make: item('energy', 2) },
    { w: 15, make: item('bomb5', 1) },
    { w: 12, make: rune(1, 2, 0.3) },
  ],
  epic: [
    { w: 30, make: coins(0.3, 0.45) },
    { w: 25, make: tokens(150, 300) },
    { w: 15, make: item('charge', 1) },
    { w: 10, make: item('bomb5', 2) },
    { w: 20, make: FIND_SLOT },
    { w: 15, make: rune(2, 3, 0.3) },
  ],
  legend: [
    { w: 35, make: coins(0.9, 1.3) },
    { w: 25, make: tokens(500, 800) },
    { w: 15, make: item('charge', 2) },
    { w: 25, make: FIND_SLOT },
    { w: 15, make: rune(3, 4, 0.3) },
  ],
};

/** Посылка: руны и питомцы — её главное, монеты и токены — подкладка. */
const PARCEL_TABLE: Record<CaseTier, Slot[]> = {
  common: [
    { w: 30, make: coins(0.03, 0.06) },
    { w: 30, make: tokens(15, 40) },
    { w: 25, make: rune(1, 1, 0) },
    { w: 5, make: item('bomb3', 1) },
    { w: 5, make: item('energy', 1) },
    { w: 5, make: item('lens', 1) },
  ],
  rare: [
    { w: 22, make: coins(0.08, 0.15) },
    { w: 22, make: tokens(50, 120) },
    { w: 32, make: rune(1, 2, 0.4) },
    { w: 12, make: keysOf(1) },
    { w: 12, make: PET_SLOT },
  ],
  epic: [
    { w: 18, make: coins(0.25, 0.4) },
    { w: 18, make: tokens(150, 300) },
    { w: 36, make: rune(2, 3, 0.4) },
    { w: 12, make: keysOf(2) },
    { w: 16, make: PET_SLOT },
  ],
  legend: [
    { w: 18, make: coins(0.8, 1.2) },
    { w: 14, make: tokens(400, 700) },
    { w: 40, make: rune(3, 4, 0.35) },
    { w: 28, make: PET_SLOT },
  ],
};

function pickWeighted<T extends { w: number }>(list: T[], rnd: () => number): T {
  const total = list.reduce((s, x) => s + x.w, 0);
  let x = rnd() * total;
  for (const it of list) {
    x -= it.w;
    if (x <= 0) return it;
  }
  return list[list.length - 1];
}

/**
 * Что лежит в сундуке. Находка в сундуке — только НЕДОСТАЮЩАЯ из доступных
 * по шахте; если таких нет, вместо неё токены.
 */
/** Редкость сундука или посылки. */
export function rollTier(rnd: () => number): CaseTier {
  return pickWeighted(
    CASE_TIERS.map((t) => ({ ...t, w: t.weight })),
    rnd,
  ).id;
}

/** Питомец из посылки: тот, кого ещё нет; все есть — лакомство текущему. */
function resolvePet(pets: Pets, tier: CaseTier, rnd: () => number): Reward {
  const missing = PETS.filter((x) => pets[x.id] === undefined);
  if (missing.length) return { kind: 'pet', id: missing[Math.floor(rnd() * missing.length)].id };
  const k = tier === 'legend' ? 3 : tier === 'epic' ? 2 : 1;
  return { kind: 'treat', amount: PET_TREAT_XP * k };
}

/** Что лежит в посылке редкости `tier`. */
export function rollParcel(
  p: { rank: number; prestige: number; pets: Pets },
  tier: CaseTier,
  rnd: () => number,
): Reward {
  const r = pickWeighted(PARCEL_TABLE[tier], rnd).make(rnd, p.rank, p.prestige);
  return r.kind === 'pet' ? resolvePet(p.pets, tier, rnd) : r;
}

export function rollCase(
  p: { rank: number; prestige: number; finds: Finds },
  rnd: () => number,
): CaseRoll {
  const tier = rollTier(rnd);
  let reward = pickWeighted(CASE_TABLE[tier], rnd).make(rnd, p.rank, p.prestige);
  if (reward.kind === 'find') {
    const missing = FINDS.filter((f) => f.from <= p.rank && !(p.finds[f.id] ?? 0));
    reward = missing.length
      ? { kind: 'find', id: missing[Math.floor(rnd() * missing.length)].id }
      : { kind: 'tokens', amount: tier === 'legend' ? 600 : 250 };
  }
  return { tier, reward };
}

/** Средняя выплата монетами за сундук в долях цены ранга — для теста. */
export function caseCoinShare(): number {
  const total = CASE_TIERS.reduce((s, t) => s + t.weight, 0);
  const ranges: Record<CaseTier, [number, number, number]> = {
    common: [35, 0.04, 0.08],
    rare: [30, 0.1, 0.18],
    epic: [30, 0.3, 0.45],
    legend: [35, 0.9, 1.3],
  };
  let ev = 0;
  for (const t of CASE_TIERS) {
    const slots = CASE_TABLE[t.id].reduce((s, x) => s + x.w, 0);
    const [w, lo, hi] = ranges[t.id];
    ev += (t.weight / total) * (w / slots) * ((lo + hi) / 2);
  }
  return ev;
}

/** Ключей за новый ранг и за престиж. */
export const RANK_KEYS = 1;
export const PRESTIGE_KEYS = 5;

// ---------------------------------------------------------------------------
// Бригада — автошахтёр. Копает в лучшей открытой шахте, пока тебя нет, и
// копит добычу до потолка: восемь часов (перк — до двенадцати). Для вахты это
// главное: зашёл после смены — забрал. Считается при входе, сервер не нужен.
// Бригада берёт долю: отдаёт 60% цены добытого.
// ---------------------------------------------------------------------------

export const CREW_MAX = 6;
export const CREW_CAP_H = 8;
export const CREW_SHARE = 0.6;

/** Блоков в минуту у бригады уровня `level`. */
export function crewRate(level: number): number {
  return level > 0 ? 2 * Math.pow(level, 1.4) : 0;
}

/** Цена следующего уровня бригады (нанять — это уровень 1). */
export function crewCost(level: number): number {
  return CREW_PRICE[Math.max(0, Math.min(CREW_PRICE.length - 1, level))];
}

/**
 * Наряд на смену (v2.57). Раньше бригада только копила и ждала кнопки —
 * владелец попросил «механики побольше». Три наряда — три способа
 * возвращаться: раз в день (норма), каждые два часа (ударная) или ради
 * находок (разведка).
 */
export type CrewShift = 'norm' | 'rush' | 'scout';

export interface CrewShiftDef {
  id: CrewShift;
  name: string;
  text: string;
  /** Длина смены без перка и сколько часов добавляет каждый уровень перка. */
  hours: number;
  perHour: number;
  rate: number;
  /** Ищут ли ключи и посылки. */
  scout: boolean;
}

export const CREW_SHIFTS: CrewShiftDef[] = [
  {
    id: 'norm',
    name: 'Норма',
    text: 'Спокойно копают всю смену',
    hours: CREW_CAP_H,
    perHour: 1,
    rate: 1,
    scout: false,
  },
  {
    id: 'rush',
    name: 'Ударная',
    text: 'В 2,5 раза быстрее, но всего два часа',
    hours: 2,
    perHour: 0.25,
    rate: 2.5,
    scout: false,
  },
  {
    id: 'scout',
    name: 'Разведка',
    text: 'Копают вполсилы, зато ищут ключи и посылки',
    hours: 6,
    perHour: 0.5,
    rate: 0.5,
    scout: true,
  },
];

export const crewShiftOf = (id: CrewShift | undefined): CrewShiftDef =>
  CREW_SHIFTS.find((c) => c.id === id) ?? CREW_SHIFTS[0];

/** Пайка: +30% ко всей смене, если накормить в первые 10 минут. */
export const CREW_FED_BOOST = 0.3;
export const CREW_FEED_WINDOW_MIN = 10;

export function crewFeedCost(p: { rank: number; prestige: number }): number {
  return nice(rankCost(Math.min(p.rank, LAST_RANK - 1), p.prestige) * 0.12);
}

/** Разведка: ключей и посылок в среднем за час смены. */
export const SCOUT_KEYS_PER_H = 0.3;
export const SCOUT_PARCELS_PER_H = 0.08;

export function crewCapHours(p: { perks: Perks; crewShift?: CrewShift }): number {
  const sh = crewShiftOf(p.crewShift);
  return sh.hours + sh.perHour * p.perks.shift;
}

export interface CrewYield {
  minutes: number;
  blocks: number;
  coins: number;
  tokens: number;
  /** Потолок уже достигнут — бригада стоит. */
  capped: boolean;
}

/** Что бригада накопила к моменту `now`. */
export function crewYield(p: PrisonState, now: number): CrewYield {
  if (!p.crew || !p.crewFrom) return { minutes: 0, blocks: 0, coins: 0, tokens: 0, capped: false };
  const cap = crewCapHours(p) * 60;
  const raw = Math.max(0, (now - p.crewFrom) / 60000);
  const minutes = Math.min(cap, raw);
  const sh = crewShiftOf(p.crewShift);
  const fed = p.crewFed ? 1 + CREW_FED_BOOST : 1;
  const blocks = Math.floor(crewRate(p.crew) * sh.rate * fed * minutes);
  const m = modsOf(p);
  return {
    minutes,
    blocks,
    coins: Math.round(blocks * avgValue(p.rank) * CREW_SHARE * m.sell),
    tokens: Math.round(blocks * m.tokenChance),
    capped: raw >= cap,
  };
}

// ---------------------------------------------------------------------------
// Перки — дерево престижа. Очки: два за каждый престиж. Сброс бесплатный:
// перки — это выбор стиля игры, а не вложение, за которое страшно.
// ---------------------------------------------------------------------------

export type PerkId = 'dealer' | 'grip' | 'lucky' | 'shift' | 'blat' | 'nose';

export interface Perk {
  id: PerkId;
  name: string;
  per: string;
  max: number;
}

export const PERKS: Perk[] = [
  { id: 'dealer', name: 'Скупщик', per: '+6% к продаже', max: 5 },
  { id: 'grip', name: 'Хватка', per: '+8% к скорости кирки', max: 5 },
  { id: 'lucky', name: 'Везунчик', per: '+10% токенов', max: 5 },
  { id: 'nose', name: 'Нюх', per: '+20% ключей и находок', max: 5 },
  { id: 'shift', name: 'Длинная смена', per: '+1 час рабочим', max: 4 },
  { id: 'blat', name: 'Блат', per: 'после престижа — на ранг выше', max: 3 },
];

export type Perks = Record<PerkId, number>;

export const NO_PERKS: Perks = { dealer: 0, grip: 0, lucky: 0, nose: 0, shift: 0, blat: 0 };

export const PERK_POINTS_PER_PRESTIGE = 2;

export function perkPointsFree(p: { prestige: number; perks: Perks }): number {
  const spent = PERKS.reduce((s, k) => s + p.perks[k.id], 0);
  return p.prestige * PERK_POINTS_PER_PRESTIGE - spent;
}

// ---------------------------------------------------------------------------
// Награда в состояние. Одна функция на сундук, посылку, веху и проводника:
// раньше каждая раздавала награды сама, и руна из сундука легла бы мимо
// мешочка. Монеты возвращаются отдельно — они идут в ОБЩИЙ кошелёк.
// ---------------------------------------------------------------------------

export interface Applied {
  p: PrisonState;
  coins: number;
  /** Руна не влезла в мешочек и разбилась на столько токенов. */
  shattered: number;
  /** Новый питомец пришёл (а не лакомство). */
  newPet: PetId | null;
}

export function applyReward(p: PrisonState, r: Reward): Applied {
  const out: Applied = { p, coins: 0, shattered: 0, newPet: null };
  switch (r.kind) {
    case 'coins':
      out.coins = r.amount;
      break;
    case 'tokens':
      out.p = { ...p, tokens: p.tokens + r.amount };
      break;
    case 'keys':
      out.p = { ...p, keys: p.keys + r.amount };
      break;
    case 'item':
      out.p = { ...p, items: { ...p.items, [r.id]: p.items[r.id] + r.amount } };
      break;
    case 'find':
      out.p = { ...p, finds: { ...p.finds, [r.id]: (p.finds[r.id] ?? 0) + 1 } };
      break;
    case 'rune':
      if (p.runes.length >= RUNE_BAG) {
        out.shattered = RUNE_SHATTER[r.rune.tier - 1];
        out.p = { ...p, tokens: p.tokens + out.shattered };
      } else {
        const id = p.runeSeq + 1;
        out.p = { ...p, runeSeq: id, runes: [...p.runes, { ...r.rune, id }] };
      }
      break;
    case 'pet':
      if (p.pets[r.id] !== undefined)
        return applyReward(p, { kind: 'treat', amount: PET_TREAT_XP });
      out.newPet = r.id;
      out.p = { ...p, pets: { ...p.pets, [r.id]: 0 }, pet: p.pet ?? r.id };
      break;
    case 'treat':
      out.p = p.pet
        ? { ...p, pets: { ...p.pets, [p.pet]: (p.pets[p.pet] ?? 0) + r.amount } }
        : { ...p, tokens: p.tokens + 50 };
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Вехи — разовые награды за большое: тысячи блоков, первый Z, престижи.
// На Mineland престиж без бонусов был неинтересен 99,9% игроков — поэтому
// 1-й, 5-й, 10-й и 20-й престиж дают весомое, а десятый — четвёртое гнездо
// для руны: такое не купишь ничем.
// ---------------------------------------------------------------------------

export interface MileReward {
  tokens?: number;
  keys?: number;
  /** Посылка вскрывается сразу — места под полем она не ждёт. */
  parcel?: CaseTier;
  /** Руна этой ступени, вид случайный. */
  rune?: number;
  /** Четвёртое гнездо для руны. */
  socket?: boolean;
}

export interface Mile {
  id: string;
  title: string;
  text: string;
  progress: (p: PrisonState) => [number, number];
  reward: MileReward;
}

const upToM = (v: number, goal: number): [number, number] => [Math.min(v, goal), goal];

export const MILES: Mile[] = [
  {
    id: 'b1k',
    title: 'Тысяча блоков',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e3),
    reward: { tokens: 50, parcel: 'common' },
  },
  {
    id: 'b10k',
    title: 'Десять тысяч',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e4),
    reward: { tokens: 200, keys: 2, parcel: 'rare' },
  },
  {
    id: 'b100k',
    title: 'Сто тысяч',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e5),
    reward: { tokens: 800, keys: 5, parcel: 'epic' },
  },
  {
    id: 'b1m',
    title: 'Миллион',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e6),
    reward: { tokens: 3000, keys: 10, parcel: 'legend', rune: 5 },
  },
  {
    id: 'z',
    title: 'Первый Z',
    text: 'Дойти до последнего ранга',
    progress: (p) => upToM(p.prestige > 0 ? LAST_RANK : p.rank, LAST_RANK),
    reward: { keys: 5, parcel: 'legend' },
  },
  {
    id: 'p1',
    title: 'Престиж 1',
    text: 'Начать второй срок',
    progress: (p) => upToM(p.prestige, 1),
    reward: { keys: 10, parcel: 'legend', rune: 3 },
  },
  {
    id: 'p5',
    title: 'Престиж 5',
    text: 'Пятый срок',
    progress: (p) => upToM(p.prestige, 5),
    reward: { keys: 15, rune: 4, tokens: 2000 },
  },
  {
    id: 'p10',
    title: 'Престиж 10',
    text: 'Четвёртое гнездо для руны',
    progress: (p) => upToM(p.prestige, 10),
    reward: { keys: 20, socket: true, rune: 4 },
  },
  {
    id: 'p20',
    title: 'Престиж 20',
    text: 'Двадцать сроков',
    progress: (p) => upToM(p.prestige, 20),
    reward: { keys: 30, rune: 5, tokens: 10000 },
  },
  {
    id: 'legend',
    title: 'Легенда забоя',
    text: `Набрать серию до «${STREAK_TIERS[STREAK_TIERS.length - 1].name}»`,
    progress: (p) => upToM(p.bestStreak, STREAK_TIERS.length),
    reward: { keys: 3, parcel: 'epic' },
  },
  {
    id: 'zoo',
    title: 'Кольская фауна',
    text: 'Приручить всех шестерых',
    progress: (p) => upToM(Object.keys(p.pets).length, PETS.length),
    reward: { tokens: 1000, rune: 4 },
  },
  {
    id: 'cases',
    title: 'Сто сундуков',
    text: 'Открыть ключами',
    progress: (p) => upToM(p.cases, 100),
    reward: { rune: 3, tokens: 500 },
  },
  {
    id: 'seid',
    title: 'Хранитель сейдов',
    text: 'Разбить десять сейд-камней',
    progress: (p) => upToM(p.seids, 10),
    reward: { tokens: 600, rune: 3 },
  },
  {
    id: 'bats',
    title: 'Ловец мышей',
    text: 'Поймать тридцать летучих мышей',
    progress: (p) => upToM(p.bats ?? 0, 30),
    reward: { tokens: 400, keys: 3, rune: 2 },
  },
  {
    id: 'parcels',
    title: 'Сто посылок',
    text: 'Вскрыть',
    progress: (p) => upToM(p.parcelsOpened, 100),
    reward: { rune: 4, keys: 5 },
  },
];

export function mileReady(p: PrisonState, m: Mile): boolean {
  if (p.miles.includes(m.id)) return false;
  const [v, goal] = m.progress(p);
  return v >= goal;
}

export function milesReady(p: PrisonState): number {
  return MILES.filter((m) => mileReady(p, m)).length;
}

// ---------------------------------------------------------------------------
// Сохранение.
// ---------------------------------------------------------------------------

export interface PrisonMine {
  /** Буква шахты (индекс). */
  id: number;
  seed: number;
  /** Глубина раскопа по клеткам, 0…DEPTH. */
  dug: number[];
  /**
   * Блок этажа по гарантии (v2.67): долго не везло — он встаёт на верх
   * случайной клетки. Живёт вместе с полем: новая шахта — гарантии нет.
   */
  bonus?: OreBlock | null;
}

export interface PrisonState {
  rank: number;
  prestige: number;
  pick: number;
  bagLevel: number;
  cart: boolean;
  bag: Bag;
  mine: PrisonMine;
  /** Сколько блоков сломано за всё время и сколько выручено продажей. */
  mined: number;
  earned: number;
  tokens: number;
  ench: Enchants;
  items: Items;
  /** До какого времени действуют энергетик, лупа и кураж (мс эпохи). */
  energyUntil: number;
  lensUntil: number;
  frenzyUntil: number;
  /** До какого времени стоит крепь (v2.53). */
  propUntil: number;
  /** Рукоять из досок: 0 — родная, иначе номер в `HANDLES` + 1. */
  handle: number;
  /** Событие двора (v2.54) и не раньше какого времени следующее. */
  event: YardEvent | null;
  eventNext: number;
  eventsDone: number;
  /** Барыга: окно ассортимента и сколько взято каждого лота. */
  baryga: { window: number; bought: number[] };
  /** Спецзона (v2.55): дневное время и где был до неё. */
  zone: Zone;
  /** Престиж кирки: звёзды, 0…5. */
  pickStars: number;
  keys: number;
  /** Коллекция: сколько экземпляров каждой находки нашлось. */
  finds: Finds;
  /** Бригада: уровень и с какого момента она копит добычу. */
  crew: number;
  crewFrom: number;
  /** Наряд текущей смены и накормлена ли бригада (v2.57). */
  crewShift: CrewShift;
  crewFed: boolean;
  perks: Perks;
  /** Открыто сундуков — для статистики. */
  cases: number;
  /** Опыт кирки — сломанные блоки (v2.48). */
  pickXp: number;
  /** Норма: сколько блоков каждой породы добыто на текущем ранге. */
  norm: Record<number, number>;
  /** Шаг проводника; GUIDE.length — пройден. */
  guide: number;
  /** Сколько раз продавал рюкзак, сколько бомб взорвал. */
  sells: number;
  bombs: number;
  /** Лучшая ступень запала за всё время: 0 — не было, 1…5 — ступень. */
  bestStreak: number;
  /** Чары, выключенные игроком: не срабатывают, уровни целы. */
  off: EnchantId[];
  /** Посылки под полем (v2.49) и сколько вскрыто за всё время. */
  parcels: Parcel[];
  parcelsOpened: number;
  /** Мешочек рун, счётчик их номеров и гнёзда кирки (0 — пусто). */
  runes: Rune[];
  runeSeq: number;
  sockets: number[];
  /** Приручённые питомцы (опыт каждого) и тот, что с собой. */
  pets: Pets;
  pet: PetId | null;
  /** Забранные вехи. */
  miles: string[];
  /** Сколько сейд-камней разбито за всё время. */
  seids: number;
  /** Сундучок живности, ждущий решения (v2.64). */
  treasure: Treasure | null;
  /** Сколько летучих мышей поймано — для статистики и вех. */
  bats: number;
  /** Жемчуг с рыбалки (v2.65): сколько найдено; действует не больше десяти. */
  pearls: number;
  /** Блоки этажа (v2.66): расколото на этом ранге и за всё время. */
  oreBlocks: number;
  oreBlocksAll: number;
  /** Ящик кузнеца (v2.67): руда, отложенная для следующей кирки. */
  forgeBox: Bag;
  /** Кирка, за которую монеты уже внесены старым заказом (−1 — нет). */
  forgePaid: number;
  /** Гарантия блока этажа: сломано на своём этаже с прошлого блока. */
  pity: number;
}

export function freshMine(id: number, seed = Math.floor(Math.random() * 2 ** 31)): PrisonMine {
  return { id, seed, dug: new Array<number>(MINE_CELLS).fill(0) };
}

export const PRISON_START: PrisonState = {
  rank: 0,
  prestige: 0,
  pick: 0,
  bagLevel: 0,
  cart: false,
  bag: {},
  mine: { id: 0, seed: 1, dug: new Array<number>(MINE_CELLS).fill(0) },
  mined: 0,
  earned: 0,
  tokens: 0,
  ench: NO_ENCHANTS,
  items: NO_ITEMS,
  energyUntil: 0,
  lensUntil: 0,
  frenzyUntil: 0,
  propUntil: 0,
  handle: 0,
  event: null,
  eventNext: 0,
  eventsDone: 0,
  baryga: { window: 0, bought: [] },
  zone: {
    day: '',
    used: 0,
    bonus: 0,
    have: 0,
    on: false,
    tick: 0,
    back: null,
  },
  pickStars: 0,
  keys: 0,
  finds: {},
  crew: 0,
  crewFrom: 0,
  crewShift: 'norm',
  crewFed: false,
  perks: NO_PERKS,
  cases: 0,
  pickXp: 0,
  norm: {},
  guide: 0,
  sells: 0,
  bombs: 0,
  bestStreak: 0,
  off: [],
  parcels: [],
  parcelsOpened: 0,
  runes: [],
  runeSeq: 0,
  sockets: [0, 0, 0, 0],
  pets: {},
  pet: null,
  miles: [],
  seids: 0,
  treasure: null,
  bats: 0,
  pearls: 0,
  oreBlocks: 0,
  oreBlocksAll: 0,
  forgeBox: {},
  forgePaid: -1,
  pity: 0,
};

const int = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

/** Сохранение могло прийти битым или от старой версии — чиним по полям. */
export function normalizePrison(raw: Partial<PrisonState> | null | undefined): PrisonState {
  if (!raw || typeof raw !== 'object') return { ...PRISON_START, mine: freshMine(0) };
  const rank = int(raw.rank, 0, LAST_RANK, 0);
  const bag: Bag = {};
  if (raw.bag && typeof raw.bag === 'object') {
    for (const [k, v] of Object.entries(raw.bag)) {
      const i = Number(k);
      const n = int(v, 0, 1e7, 0);
      if (Number.isInteger(i) && i >= 0 && i < ROCKS.length && n > 0) bag[i] = n;
    }
  }
  const m = raw.mine;
  const zone = normalizeZone(raw.zone);
  // В спецзоне шахта — престижная, её номер выше ранга.
  const mineId = zone.on ? int(m?.id, 0, ROCKS.length - 1, rank) : int(m?.id, 0, rank, rank);
  const dug =
    m && Array.isArray(m.dug) && m.dug.length === MINE_CELLS
      ? m.dug.map((d) => int(d, 0, DEPTH, 0))
      : null;
  const prestige = int(raw.prestige, 0, 999, 0);
  // v2.67: этаж копается только киркой, что берёт его руду. Сохранение
  // из прошлых версий могло стоять на этаже со слабой киркой — кузнец
  // выдаёт нужную: иначе поле встало бы стеной, а старый путь этого не знал.
  const pick = Math.max(int(raw.pick, 0, PICKS.length - 1, 0), minPickFor(rank));
  const old = normalizeOldOrder((raw as { forge?: unknown }).forge, pick);
  const box = normalizeBag(raw.forgeBox ?? old?.have);
  return {
    rank,
    prestige,
    pick,
    bagLevel: int(raw.bagLevel, 0, BAG_MAX, 0),
    cart: raw.cart === true,
    bag,
    mine: dug
      ? {
          id: mineId,
          seed: int(m?.seed, 0, 2 ** 31, 1),
          dug,
          bonus: normalizeBonus(m?.bonus, dug),
        }
      : freshMine(mineId),
    mined: int(raw.mined, 0, 1e12, 0),
    earned: int(raw.earned, 0, 1e15, 0),
    tokens: int(raw.tokens, 0, 1e12, 0),
    ench: Object.fromEntries(
      ENCHANTS.map((e) => [
        e.id,
        int(raw.ench?.[e.id], 0, enchantMax(e.id, int(raw.pickStars, 0, PICK_STARS_MAX, 0)), 0),
      ]),
    ) as Enchants,
    items: Object.fromEntries(ITEMS.map((i) => [i.id, int(raw.items?.[i.id], 0, 1e6, 0)])) as Items,
    energyUntil: int(raw.energyUntil, 0, 1e14, 0),
    lensUntil: int(raw.lensUntil, 0, 1e14, 0),
    frenzyUntil: int(raw.frenzyUntil, 0, 1e14, 0),
    propUntil: int(raw.propUntil, 0, 1e14, 0),
    handle: int(raw.handle, 0, HANDLES.length, 0),
    event: normalizeEvent(raw.event),
    zone,
    pickStars: int(raw.pickStars, 0, PICK_STARS_MAX, 0),
    eventNext: int(raw.eventNext, 0, 1e14, 0),
    eventsDone: int(raw.eventsDone, 0, 1e9, 0),
    baryga: {
      window: int(raw.baryga?.window, 0, 1e12, 0),
      bought: (Array.isArray(raw.baryga?.bought) ? raw.baryga.bought : [])
        .slice(0, 8)
        .map((n) => int(n, 0, 99, 0)),
    },
    keys: int(raw.keys, 0, 1e7, 0),
    finds: Object.fromEntries(
      FINDS.map((f) => [f.id, int(raw.finds?.[f.id], 0, 1e6, 0)]).filter(([, n]) => n),
    ) as Finds,
    crew: int(raw.crew, 0, CREW_MAX, 0),
    crewFrom: int(raw.crewFrom, 0, 1e14, 0),
    crewShift: CREW_SHIFTS.some((c) => c.id === raw.crewShift)
      ? (raw.crewShift as CrewShift)
      : 'norm',
    crewFed: raw.crewFed === true,
    perks: Object.fromEntries(
      PERKS.map((k) => [k.id, int(raw.perks?.[k.id], 0, k.max, 0)]),
    ) as Perks,
    cases: int(raw.cases, 0, 1e9, 0),
    // Кирка из прошлых версий не начинает с нуля: весь её опыт — это уже
    // сломанные блоки.
    pickXp: int(raw.pickXp, 0, 1e12, int(raw.mined, 0, 1e12, 0)),
    norm: Object.fromEntries(
      Object.entries(raw.norm ?? {})
        .map(([k, v]) => [Number(k), int(v, 0, 1e9, 0)] as const)
        .filter(([k, v]) => Number.isInteger(k) && k >= 0 && k < MINES && v > 0),
    ),
    guide: int(raw.guide, 0, GUIDE.length, 0),
    sells: int(raw.sells, 0, 1e9, (raw.earned ?? 0) > 0 ? 1 : 0),
    bombs: int(raw.bombs, 0, 1e9, 0),
    bestStreak: int(raw.bestStreak, 0, STREAK_TIERS.length, 0),
    off: Array.isArray(raw.off)
      ? (raw.off.filter((id) => ENCHANTS.some((e) => e.id === id)) as EnchantId[])
      : [],
    ...normalizeLoot(raw),
    seids: int(raw.seids, 0, 1e9, 0),
    treasure: normalizeTreasure(raw.treasure),
    bats: int(raw.bats, 0, 1e9, 0),
    pearls: int(raw.pearls, 0, 1e6, 0),
    oreBlocks: int(raw.oreBlocks, 0, 1e6, 0),
    oreBlocksAll: int(raw.oreBlocksAll, 0, 1e9, 0),
    forgeBox: box,
    // Заказ v2.66 был оплачен вперёд: за эту кирку монеты второй раз не берём.
    forgePaid:
      old && old.pick === nextPick({ pick, prestige })
        ? old.pick
        : int(raw.forgePaid, -1, PICKS.length - 1, -1) === pick + 1
          ? pick + 1
          : -1,
    pity: int(raw.pity, 0, 1e7, 0),
  };
}

/** Рюкзак или ящик: породы — целые индексы, количества — неотрицательные. */
function normalizeBag(raw: unknown): Bag {
  const out: Bag = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    const n = int(v, 0, 1e7, 0);
    if (Number.isInteger(i) && i >= 0 && i < ROCKS.length && n > 0) out[i] = n;
  }
  return out;
}

/** Заказ кузнице из v2.66: кирка оплачена, часть руды уже набрана. */
function normalizeOldOrder(
  raw: unknown,
  pick: number,
): { pick: number; have: Record<number, number> } | null {
  const o = raw as { pick?: unknown; have?: Record<number, unknown> } | null | undefined;
  if (!o || typeof o !== 'object') return null;
  const target = int(o.pick, 0, PICKS.length - 1, -1);
  if (target <= pick) return null;
  const have: Record<number, number> = {};
  for (const [rock, n] of PICKS[target].ore) have[rock] = int(o.have?.[rock], 0, n, 0);
  return { pick: target, have };
}

function normalizeBonus(raw: unknown, dug: number[]): OreBlock | null {
  const b = raw as Partial<OreBlock> | null | undefined;
  if (!b || typeof b !== 'object') return null;
  const cell = int(b.cell, 0, MINE_CELLS - 1, -1);
  const depth = int(b.depth, 0, DEPTH - 1, -1);
  // Блок гарантии лежит на верху клетки; клетку уже раскопали глубже — его нет.
  return cell >= 0 && depth >= 0 && dug[cell] === depth ? { cell, depth } : null;
}

const TIER_IDS: CaseTier[] = ['common', 'rare', 'epic', 'legend'];

function normalizeEvent(raw: unknown): YardEvent | null {
  const e = raw as Partial<YardEvent> | null | undefined;
  if (!e || typeof e !== 'object' || !EVENT_IDS.includes(e.id as EventId)) return null;
  return {
    id: e.id as EventId,
    place: e.place === 'forest' ? 'forest' : 'mine',
    from: int(e.from, 0, 1e14, 0),
    until: int(e.until, 0, 1e14, 0),
    cell: int(e.cell, 0, MINE_CELLS - 1, 0),
    hp: typeof e.hp === 'number' && Number.isFinite(e.hp) && e.hp > 0 ? e.hp : 0,
    rock: int(e.rock, -1, MINES - 1, -1),
    need: int(e.need, 0, 1e6, 0),
    have: int(e.have, 0, 1e13, 0),
  };
}

/** Посылки, руны, питомцы и вехи (v2.49) — отдельно, чтобы не раздувать. */
interface LootState {
  parcels: Parcel[];
  parcelsOpened: number;
  runes: Rune[];
  runeSeq: number;
  sockets: number[];
  pets: Pets;
  pet: PetId | null;
  miles: string[];
}

function normalizeLoot(raw: Partial<PrisonState>): LootState {
  const parcels = (Array.isArray(raw.parcels) ? raw.parcels : [])
    .filter((x) => x && TIER_IDS.includes(x.tier))
    .slice(0, PARCEL_SLOTS)
    .map((x) => ({ tier: x.tier, left: int(x.left, 0, PARCEL_NEED[x.tier], PARCEL_NEED[x.tier]) }));
  const seen = new Set<number>();
  const runes: Rune[] = [];
  for (const r of Array.isArray(raw.runes) ? raw.runes : []) {
    if (!r || !RUNES.some((d) => d.id === r.kind)) continue;
    const id = int(r.id, 1, 1e9, 0);
    if (!id || seen.has(id) || runes.length >= RUNE_BAG) continue;
    seen.add(id);
    runes.push({
      id,
      kind: r.kind,
      tier: int(r.tier, 1, RUNE_TIERS, 1),
      roll: int(r.roll, 0, 100, 0),
    });
  }
  const maxId = runes.reduce((m, r) => Math.max(m, r.id), 0);
  const used = new Set<number>();
  const sockets = Array.from({ length: SOCKETS_MAX }, (_, i) => {
    const id = int(raw.sockets?.[i], 0, 1e9, 0);
    if (!id || !seen.has(id) || used.has(id)) return 0;
    used.add(id);
    return id;
  });
  const pets: Pets = {};
  for (const d of PETS) {
    const xp = raw.pets?.[d.id];
    if (typeof xp === 'number') pets[d.id] = int(xp, 0, 1e12, 0);
  }
  const pet = raw.pet && pets[raw.pet] !== undefined ? raw.pet : null;
  return {
    parcels,
    parcelsOpened: int(raw.parcelsOpened, 0, 1e9, 0),
    runes,
    runeSeq: Math.max(maxId, int(raw.runeSeq, 0, 1e9, 0)),
    sockets,
    pets,
    pet,
    miles: Array.isArray(raw.miles) ? raw.miles.filter((id) => MILES.some((m) => m.id === id)) : [],
  };
}

// ---------------------------------------------------------------------------
// Проводник — как квесты проводника на VimeWorld: первые шаги цепочкой
// заданий, каждое учит одной механике и платит за неё. Условия читаются из
// состояния, поэтому игрок из прошлых версий просто забирает то, что уже
// сделал, и идёт дальше.
// ---------------------------------------------------------------------------

export interface GuideReward {
  coins?: number;
  tokens?: number;
  keys?: number;
  item?: [ItemId, number];
  /** Руна этой ступени (вид случайный). */
  rune?: number;
  pet?: PetId;
}

export interface GuideStep {
  id: string;
  title: string;
  hint: string;
  progress: (p: PrisonState) => [number, number];
  reward: GuideReward;
}

const upTo = (v: number, goal: number): [number, number] => [Math.min(v, goal), goal];
const enchSum = (p: PrisonState) => ENCHANTS.reduce((s, e) => s + p.ench[e.id], 0);

export const GUIDE: GuideStep[] = [
  {
    id: 'mine',
    title: 'Сломай 20 блоков',
    hint: 'Тапай по блоку или держи палец — кирка бьёт сама',
    progress: (p) => upTo(p.mined, 20),
    reward: { coins: 40 },
  },
  {
    id: 'sell',
    title: 'Продай добычу',
    hint: 'Кнопка с рюкзаком под полем',
    progress: (p) => upTo(p.sells, 1),
    reward: { coins: 60 },
  },
  {
    id: 'rankB',
    title: 'Возьми ранг B',
    hint: 'Накопи монет и жми на полосу ранга',
    progress: (p) => upTo(p.rank, 1),
    reward: { keys: 1 },
  },
  {
    id: 'case',
    title: 'Открой сундук',
    hint: 'Кнопка «Сундуки» внизу. Ключ дали за ранг',
    progress: (p) => upTo(p.cases, 1),
    reward: { tokens: 25 },
  },
  {
    id: 'steel',
    title: 'Выкуй каменную кирку',
    hint: 'На этаже C, в кузнице: известняк, песчаник и монеты',
    progress: (p) => upTo(p.pick, 1),
    reward: { coins: 150 },
  },
  {
    id: 'enchant',
    title: 'Возьми первую чару',
    hint: 'Кнопка «Чары» внизу, платишь токенами',
    progress: (p) => upTo(enchSum(p), 1),
    reward: { tokens: 30 },
  },
  {
    id: 'streak',
    title: `Набери серию до «${STREAK_TIERS[1].name}»`,
    hint: `${STREAK_TIERS[1].at} блоков без перерыва — полоска над полем`,
    progress: (p) => upTo(p.bestStreak, 2),
    reward: { item: ['bomb3', 1] },
  },
  {
    id: 'bomb',
    title: 'Взорви бомбу',
    hint: 'Кнопка с бомбой под полем, потом тап по клетке',
    progress: (p) => upTo(p.bombs, 1),
    reward: { tokens: 40 },
  },
  {
    id: 'level',
    title: 'Доведи кирку до 5 уровня',
    hint: 'Опыт кирки — каждый сломанный блок',
    progress: (p) => upTo(pickLevelOf(p.pickXp).level, 5),
    reward: { item: ['energy', 1] },
  },
  {
    id: 'rankE',
    title: 'Возьми ранг E',
    hint: 'Для ранга нужна кирка, которая берёт руду следующего этажа',
    progress: (p) => upTo(p.rank, 4),
    reward: { keys: 2 },
  },
  {
    id: 'bag',
    title: 'Прокачай рюкзак',
    hint: 'В кузнице, под киркой',
    progress: (p) => upTo(p.bagLevel, 1),
    reward: { item: ['lens', 1] },
  },
  {
    id: 'rankH',
    title: 'Возьми ранг H',
    hint: 'Дальше — сам: ранги до Z и престиж',
    progress: (p) => upTo(p.rank, 7),
    reward: { keys: 3, tokens: 150 },
  },
  // v2.49: добыча. Игрок, прошедший первые двенадцать, увидит проводник
  // снова — ровно ради этих трёх шагов.
  {
    id: 'parcel',
    title: 'Вскрой посылку',
    hint: 'Посылки падают с блоков и зреют под полем, пока копаешь',
    progress: (p) => upTo(p.parcelsOpened, 1),
    reward: { rune: 2 },
  },
  {
    id: 'rune',
    title: 'Вставь руну в оберег',
    hint: '«Ещё» → Руны. Первое гнездо открывается на 5 уровне кирки',
    progress: (p) => upTo(p.sockets.filter(Boolean).length, 1),
    reward: { pet: 'lemming' },
  },
  {
    id: 'pet',
    title: 'Дорасти питомца до 3 уровня',
    hint: 'Питомец растёт, пока ты копаешь',
    progress: (p) => upTo(p.pet ? petLevelOf(p.pets[p.pet] ?? 0).level : 0, 3),
    reward: { keys: 2, tokens: 100 },
  },
];

export function guideStep(p: PrisonState): GuideStep | null {
  return GUIDE[p.guide] ?? null;
}

export function guideReady(p: PrisonState): boolean {
  const step = guideStep(p);
  if (!step) return false;
  const [v, goal] = step.progress(p);
  return v >= goal;
}

// ---------------------------------------------------------------------------
// Большие числа сокращениями: 1,2 тыс., 3,4 млн.
// ---------------------------------------------------------------------------

export function shortMoney(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, u: string) =>
    `${(Math.round(x * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${u}`;
  if (a >= 1e9) return f(n / 1e9, 'млрд');
  if (a >= 1e6) return f(n / 1e6, 'млн');
  if (a >= 1e4) return f(n / 1e3, 'тыс.');
  return Math.round(n).toLocaleString('ru-RU');
}
