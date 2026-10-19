import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { GxIcon, GxModal } from '@/components/gx';
import { CashDesk } from '@/components/CashDesk';
import { ChestIcon } from '@/components/ChestTab';
import { crackStage, MineCell, MineField, useMineDig, wall } from '@/components/MineField';
import type { BreakKind, DigBlock, MineFieldHandle } from '@/components/MineField';
import { useNavigate } from 'react-router-dom';
import { FOREST_UNLOCK_RANK } from '@/lib/forest';
import { CREW_ON, FOREST_ON } from '@/lib/features';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import {
  ItemIcon,
  KeyIcon,
  ParcelReveal,
  PickIcon,
  PrisonCamp,
  rewardLabel,
  RuneIcon,
  TokenIcon,
} from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { ForgeScreen, forgeReadyNow } from '@/components/ForgeScreen';
import { BooksTab } from '@/components/BooksTab';
import { predecodeArmory } from '@/components/armory';
import { Inventory } from '@/components/Inventory';
import { EventAnnounce, EventPill, endText, prizeSay, useYardEvent } from '@/components/YardBits';
import { BatLayer, MagpieLayer, TreasurePanel } from '@/components/Critters';
import { MinePets } from '@/components/MinePets';
import { EggArt, PetArt } from '@/components/PetArt';
import { petLook, TRICK_RUSH, TRICK_RUSH_MS, TRICK_SENSE_MS } from '@/lib/pets';
import type { BatHandle, MagpieHandle } from '@/components/Critters';
import { BAT_GAP_MS, BAT_RARE, batRoll } from '@/lib/critters';
import type { ShinyKind } from '@/lib/critters';
import { useFinanceStore } from '@/store';
import type { ParcelOpen, PetTrick, PrisonLoot, PrisonRankUp, TreasureGot } from '@/store';
import type { YardEvent } from '@/lib/prison';
import {
  liveEvent,
  ZONE_MAX_MS,
  ZONE_MS,
  ZONE_QUOTA,
  zoneLeft,
  bagCapacity,
  bagCount,
  bagValue,
  buildMine,
  CRIT_CHANCE,
  CRIT_MULT,
  crewYield,
  decayStreak,
  DEPTH,
  booksReady,
  ENERGY_RATE,
  FRENZY_RATE,
  guideReady,
  guideStep,
  hitDamage,
  ITEMS,
  LAST_RANK,
  MINE_CELLS,
  MINE_COLS,
  MINE_RESET_AT,
  MINE_ROWS,
  minedShare,
  modsOf,
  perkPointsFree,
  pickLevelOf,
  PICKS,
  prestigeCost,
  rankCost,
  rankNeeds,
  rankLetter,
  blockPity,
  blockTop,
  canMine,
  mineBlocks,
  nextPick,
  reserveOre,
  rockHardness,
  blockValue,
  BLOCK_HITS,
  HORIZONS,
  horizonOf,
  rockAt,
  ROCKS,
  sellMult,
  STREAK_GRACE_MS,
  STREAK_DECAY_MS,
  STREAK_TIERS,
  streakTier,
  veinCells,
  CASE_TIERS,
  milesReady,
  PARCEL_NEED,
  RUNE_ROMAN,
  SEID_HITS,
  seidsOf,
  seidTop,
} from '@/lib/prison';
import type { FindId, GuideReward, ItemId, PrisonState, RankNeeds } from '@/lib/prison';
import {
  bedrockTexture,
  blockTexture,
  crackVariant,
  findTexture,
  kuivaTexture,
  meteorTexture,
  parcelTexture,
  seidTexture,
  rockColors,
  rockTexture,
  rockVariant,
} from '@/lib/prison-art';
import { plainPlan, runRollup } from '@/lib/rollup';
import { rarityOf } from '@/lib/rarity';
import { flashFrame, stopShake } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { useExit } from '@/lib/use-exit';
import { useGameAudio } from '@/lib/use-game-audio';
import { GameSettings } from '@/settings';
import {
  blockName,
  chestName,
  fmtNum,
  fmtShort,
  horizonName,
  itemName,
  petName,
  pickName,
  rockName,
  streakName,
  t,
  upper,
  useT,
  getLang,
} from '@/i18n';
import type { Key } from '@/i18n';
import { bookName, findName, guideHint, guideTitle, nameIn } from '@/i18n/data-mine';
import { playTotem } from '@/lib/totem';
import { kuivaCells, METEOR_HITS } from '@/lib/yard';
import type { YardPrize } from '@/lib/yard';
import {
  bagFull as bagFullSound,
  boom,
  treeFall,
  coinDing,
  frenzyStart,
  fuseTick,
  keyFound,
  mineRumble,
  payoutEnd,
  pickHit,
  primeAudio,
  rollupTick,
  shinyPick,
  softChime,
  tierBreak,
} from '@/lib/sound';
import {
  notifySuccess,
  notifyWarning,
  selectionChanged,
  setHapticsMuted,
  tapLight,
  tapMedium,
} from '@/lib/haptics';
import { useAction, useHotkeys } from '@/input/hooks';
import { inTopLayer } from '@/input/focus-nav';
import type { Action } from '@/input/actions';
import { useFormFactor } from '@/game-shell';
import { Badge, Bar, KeyHint, Slot, usePress } from '@/ui-px';
import './mine.css';

const fmt = (n: number) => fmtNum(n);
/** Коротко для узкой ячейки табло: 12 345 → «12,3к». */
const shortCount = (n: number) =>
  n < 1e4
    ? fmt(n)
    : n < 1e6
      ? t('mineHud.k', { n: Math.floor(n / 100) / 10 })
      : n < 1e9
        ? t('mineHud.m', { n: Math.floor(n / 1e5) / 10 })
        : t('mineHud.g', { n: n < 1e10 ? Math.floor(n / 1e8) / 10 : Math.floor(n / 1e9) });

/**
 * Монеты в шапке шахты: до ста тысяч — целиком, дальше «123,4к», «12,3м» и «1,2 млрд».
 * Кегль фишки постоянный (критик r2, R50): длинное число короче, а не мельче — место
 * рассчитано на самое длинное, «1,2 млрд».
 */
const chipMoney = (n: number) => (n >= 1e5 ? shortCount(n) : fmtNum(n));

/** Токены и ключи в фишке: не длиннее пяти знаков и суффикса («98,7к», «987к», «12м»).
 *  От миллиарда — что короче: «999м+» или «1 Mr» («1 млрд» не влезал на 320 px и на tl). */
const chipCount = (n: number) =>
  n < 1e4
    ? fmt(n)
    : n < 1e5
      ? t('mineHud.k', { n: Math.floor(n / 100) / 10 })
      : n < 1e6
        ? t('mineHud.k', { n: Math.floor(n / 1e3) })
        : n < 1e8
          ? t('mineHud.m', { n: Math.floor(n / 1e5) / 10 })
          : n < 1e9
            ? t('mineHud.m', { n: Math.floor(n / 1e6) })
            : [`${t('mineHud.m', { n: 999 })}+`, shortCount(n)].reduce((x, y) =>
                y.length < x.length ? y : x,
              );

/** Темп на полосе запала: не длиннее «99,9к» — колонка полосы рассчитана на это (R51). */
const paceCount = (n: number) =>
  n < 999.5
    ? fmt(Math.round(n))
    : n < 1e5
      ? t('mineHud.k', { n: Math.floor(n / 100) / 10 })
      : n < 1e6
        ? t('mineHud.k', { n: Math.floor(n / 1e3) })
        : t('mineHud.m', { n: Math.floor(n / 1e5) / 10 });

/**
 * Блок шахты, который перерисовывается, только когда меняется что-то из `deps` (примитивы).
 * Удар по породе перерисовывает страницу 5–10 раз в секунду, а шапка, расходники, рюкзак и
 * док при этом почти всегда те же (критик, волна 2: при 4× замедлении 35 % кадров > 20 мс).
 * Обработчики внутри — стабильные (сеттеры состояния) или через `live` страницы.
 */
const Keep = memo(
  function Keep({ render }: { deps: readonly unknown[]; render: () => ReactNode }) {
    return <>{render()}</>;
  },
  (a, b) => a.deps.length === b.deps.length && a.deps.every((x, i) => Object.is(x, b.deps[i])),
);

/** Размер пикселя арта для `hop` — страница пишет его из оболочки. */
let hopU = 2;
/**
 * «Пришло»: значки внутри `el` (с `data-hop`, иначе первый ребёнок) подпрыгивают на
 * 1–2 пикселя арта ступенями. Панели набора не масштабируются — рамка и текст на месте
 * (критик, волна 2: squashPop растягивал рюкзак на 23 px вбок).
 */
function hop(el: Element | null | undefined) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const marked = el.matches('[data-hop]') ? [el] : [...el.querySelectorAll('[data-hop]')];
  const list = marked.length ? marked : el.firstElementChild ? [el.firstElementChild] : [];
  const y = (n: number) => ({ translate: `0 ${-n * hopU}px`, easing: 'steps(1, jump-end)' });
  for (const n of list) n.animate([y(1), y(2), y(2), y(1), y(0)], { duration: 160 });
}

/** Минуты и секунды: 7:05. */
const clockMs = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Разгон от питомца-непоседы (v2.72): живёт в странице, как запал. */
let petRushUntil = 0;

/** Скорость кирки прямо сейчас: перки, энергетик, кураж, разгон питомца. */
function liveRate(p: PrisonState): number {
  const now = Date.now();
  const base = PICKS[p.pick].rate * modsOf(p).rate;
  let r = base;
  if (now < p.energyUntil) r *= ENERGY_RATE;
  if (now < p.frenzyUntil) r *= FRENZY_RATE;
  if (now < petRushUntil) r *= 1 + TRICK_RUSH;
  // Потолок: иначе энергетик в кураже превращал бы удержание в пулемёт.
  return Math.min(r, base * 2.5);
}

/** Минимальный промежуток между ударами тапом — 1,8 скорости удержания. */
const gapMs = (p: PrisonState) => 1000 / (liveRate(p) * 1.8);

type Sheetname = 'mines' | 'prestige' | 'norm' | 'settings' | null;

/** Сколько секунд простоя до того, как полоска запала начинает мигать. */
const STREAK_WARN_MS = 1500;
/** Сводка смены — раз в столько минут копания. */
const SHIFT_MS = 5 * 60_000;

/** Награда проводника одной строкой. */
function rewardText(r: GuideReward): string {
  const out: string[] = [];
  if (r.coins) out.push(t('mineHud.reward.coins', { n: Math.round(r.coins) }));
  if (r.tokens) out.push(t('mineHud.reward.tokens', { n: Math.round(r.tokens) }));
  if (r.keys)
    out.push(r.keys > 1 ? t('mineHud.reward.keys', { n: r.keys }) : t('mineHud.reward.key'));
  if (r.item) out.push(`${nameIn(itemName(r.item[0]))}${r.item[1] > 1 ? ` ×${r.item[1]}` : ''}`);
  if (r.rune) out.push(t('mineHud.reward.rune', { roman: RUNE_ROMAN[r.rune - 1] }));
  if (r.egg) out.push(t('mineHud.reward.egg', { name: nameIn(t(`nursery.egg.${r.egg}`)) }));
  return out.join(' · ');
}

/** Искры с каждого удара — у эпической и выше; легендарная сыплет золотом. */
function pickSpark(pick: number): { colors: string[]; n: number } | null {
  const rar = PICKS[pick]?.rarity ?? 0;
  if (rar < 3 || (rar === 3 && Math.random() < 0.5)) return null;
  const r = rarityOf(rar);
  return { colors: [r.color, r.light, '#ffffff'], n: rar - 2 };
}

/** Кузница и экраны лагеря — кнопки нижней панели шахты (v2.67). */
type Screen = 'enchant' | 'cases' | 'pets' | 'more';
const SCREENS: Record<Screen, { only: CampTab[]; title: Key }> = {
  enchant: { only: ['enchant'], title: 'mineHud.dock.books' },
  cases: { only: ['cases'], title: 'mineHud.dock.chests' },
  pets: { only: ['pets'], title: 'mineHud.dock.nursery' },
  // Рабочие временно убраны (v2.77, lib/features.ts).
  more: {
    only: [...(CREW_ON ? (['crew'] as CampTab[]) : []), 'runes', 'shop', 'finds', 'miles', 'perks'],
    title: 'mineHud.dock.camp',
  },
};

/** Условия ранга фишками: кирка, выработка (блоков сломано) и блоки этажа. */
/**
 * Подпись кнопки дока. Самое длинное слово (`--lw`) влезает по ширине кеглем, а не рвётся
 * посередине («Инвентар-ь» на 390 px); мягкие переносы (tr) делят слово на части.
 */
function DockLabel({ text }: { text: string }) {
  const lw = Math.max(...text.split(/[\s\u00ad-]+/).map((w) => w.length));
  return (
    <span className="mn-dock__label" style={{ '--lw': lw } as CSSProperties}>
      {text}
    </span>
  );
}

/** Награда проводника фишкой: значок и число на каждую часть, без слов (фраза — в подсказке). */
function RewardChip({ r, size }: { r: GuideReward; size: number }) {
  return (
    <span className="mn-reward">
      {r.coins ? (
        <span>
          <i className="mn-coin mn-coin--s" aria-hidden="true" />+{fmtNum(Math.round(r.coins))}
        </span>
      ) : null}
      {r.tokens ? (
        <span>
          <TokenIcon size={size} />+{fmtNum(Math.round(r.tokens))}
        </span>
      ) : null}
      {r.keys ? (
        <span>
          <KeyIcon size={size} />+{r.keys}
        </span>
      ) : null}
      {r.item ? (
        <span>
          <ItemIcon id={r.item[0]} size={size} />+{r.item[1]}
        </span>
      ) : null}
      {r.rune ? (
        <span>
          <RuneIcon kind="dmg" tier={r.rune} size={size} />
          {RUNE_ROMAN[r.rune - 1]}
        </span>
      ) : null}
      {r.egg ? (
        <span>
          <EggArt egg={r.egg} size={size} still />
          +1
        </span>
      ) : null}
    </span>
  );
}

function RankChips({ need }: { need: RankNeeds }) {
  const workOk = need.work >= need.workNeed;
  return (
    <span className="pquota">
      {!need.pickOk && (
        // Только «⛏12» — та же запись силы, что в полосе серии. Наковальня была розовой
        // (#ffb4a0 из game-ui.css) на пергаменте — почти не видна — и съедала 20–30 px строки.
        <span className="pquota__chip is-pick">⛏{need.power}</span>
      )}
      {need.workNeed > 0 && (
        <span className={`pquota__chip is-work${workOk ? ' is-done' : ''}`}>
          <i className="mn-pic mn-pic--work" aria-hidden="true" />
          {workOk ? '✓' : `${fmtShort(need.work)}/${fmtShort(need.workNeed)}`}
        </span>
      )}
    </span>
  );
}

/** Блоки этажа — отдельной фишкой: на телефоне стоя и на широком она стоит рядом с полосой
 *  денег (их докупают за деньги), в узкой широкой рамке — строкой ниже, рядом с киркой. */
function RankBlocks({ need, floor }: { need: RankNeeds; floor: number }) {
  if (need.blocksNeed <= 0) return null;
  const blocksOk = need.blocks >= need.blocksNeed;
  return (
    <span className={`pquota__chip is-blocks${blocksOk ? ' is-done' : ''}`}>
      <img src={blockTexture(floor)} alt={blockName(floor)} />
      {blocksOk ? '✓' : `${need.blocks}/${need.blocksNeed}`}
    </span>
  );
}

export function PrisonPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const t = useT();
  const prisonBreak = useFinanceStore((s) => s.prisonBreak);
  const prisonSell = useFinanceStore((s) => s.prisonSell);
  const prisonRankUp = useFinanceStore((s) => s.prisonRankUp);
  const prisonGoMine = useFinanceStore((s) => s.prisonGoMine);
  const prisonPrestige = useFinanceStore((s) => s.prisonPrestige);
  const prisonUseItem = useFinanceStore((s) => s.prisonUseItem);
  const prisonFrenzy = useFinanceStore((s) => s.prisonFrenzy);
  const prisonCrewCollect = useFinanceStore((s) => s.prisonCrewCollect);
  const prisonStreak = useFinanceStore((s) => s.prisonStreak);
  const prisonGuideClaim = useFinanceStore((s) => s.prisonGuideClaim);
  const prisonParcelOpen = useFinanceStore((s) => s.prisonParcelOpen);
  const prisonSeid = useFinanceStore((s) => s.prisonSeid);
  const prisonOreBlock = useFinanceStore((s) => s.prisonOreBlock);
  const prisonBatCatch = useFinanceStore((s) => s.prisonBatCatch);
  const yardShiny = useFinanceStore((s) => s.yardShiny);
  const prisonReset = useFinanceStore((s) => s.prisonReset);
  const gamesReset = useFinanceStore((s) => s.gamesReset);

  useGameAudio(prison.zone.on ? 'depths' : 'mine', 'mine');
  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  const { mine, rank, prestige, pick, bagLevel, cart, bag } = prison;
  const rocks = useMemo(() => buildMine(mine.id, mine.seed), [mine.id, mine.seed]);
  const seids = useMemo(() => seidsOf(mine.id, mine.seed), [mine.id, mine.seed]);
  // Блоки этажа: из зерна и блок гарантии, если встал. Дёшево — без memo:
  // гарантия меняет список посреди поля.
  const blocks = mineBlocks(mine);
  const mineKey = `${mine.id}:${mine.seed}`;

  const [sheet, setSheet] = useState<Sheetname>(null);
  const [screen, setScreen] = useState<{ key: Screen; tab: CampTab } | null>(null);
  const [forgeOpen, setForgeOpen] = useState(false);
  /** Инвентарь (v2.81): всё добро одним экраном. */
  const [invOpen, setInvOpen] = useState(false);
  /** Нижняя панель — область горячих клавиш лагеря. */
  const dockRef = useRef<HTMLElement>(null);
  /** Окно открывается: поле, отряд и посылки замирают сразу, на нажатии, а не когда
   *  переход смонтирует окно (критик r2: анимации шахты жили, пока строился питомник). */
  const freeze = () => rootRef.current?.classList.add('is-under');
  const openScreen = (key: Screen, tab?: CampTab) => {
    tapLight();
    freeze();
    // Окно монтируется переходом: нажатие и «прыжок» значка успевают в кадр, длинная
    // сборка вкладки не держит поток одним куском (критик, волна 2: до 370 мс при 4×).
    startTransition(() => setScreen({ key, tab: tab ?? SCREENS[key].only[0] }));
  };
  const openForge = () => {
    tapLight();
    freeze();
    startTransition(() => setForgeOpen(true));
  };
  const openInv = () => {
    tapLight();
    freeze();
    startTransition(() => setInvOpen(true));
  };
  const [rankScene, setRankScene] = useState<PrisonRankUp | null>(null);
  const [sceneShown, sceneLeaving] = useExit(rankScene, 260);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [findCard, setFindCard] = useState<{ id: FindId; fresh: boolean; n: number } | null>(null);
  const [cardShown, cardLeaving] = useExit(findCard, 260);
  const [arming, setArming] = useState<ItemId | null>(null);
  const [crewNote, setCrewNote] = useState(false);
  const [reveal, setReveal] = useState<ParcelOpen | null>(null);
  /** Какой сброс взведён: первый тап взводит, второй — сбрасывает. */
  const [wipe, setWipe] = useState<'prison' | 'all' | null>(null);
  // Кузница, рюкзак и книги открываются без раскодирования картинок в первом кадре: рамки набора,
  // вращение кирки, значки и полосы книг раскодируются, пока шахта простаивает.
  useEffect(() => predecodeArmory(useFinanceStore.getState().prison.pick), []);
  useEffect(() => {
    if (!wipe) return undefined;
    const t = setTimeout(() => setWipe(null), 5000);
    return () => clearTimeout(t);
  }, [wipe]);
  const [shift, setShift] = useState<{
    blocks: number;
    coins: number;
    tokens: number;
    keys: number;
  } | null>(null);
  const [shiftShown, shiftLeaving] = useExit(shift, 260);
  // Запал живёт в странице: это награда за то, что копаешь СЕЙЧАС.
  const [streak, setStreak] = useState(0);
  const [cooling, setCooling] = useState(false);

  // Баффы: страница перерисовывается раз в секунду, только пока хоть один
  // идёт, — ради таймеров на плашках и чтобы лупа погасла вовремя.
  const nowTick = Date.now();
  const buffs = {
    energy: Math.max(0, prison.energyUntil - nowTick),
    frenzy: Math.max(0, prison.frenzyUntil - nowTick),
    lens: Math.max(0, prison.lensUntil - nowTick),
    prop: Math.max(0, prison.propUntil - nowTick),
  };
  // Крепь в ряду расходников — только когда её есть из чего сбить.
  const millLevel = useFinanceStore((s) => s.forest.mill.level);
  const anyBuff = buffs.energy > 0 || buffs.frenzy > 0 || buffs.lens > 0 || buffs.prop > 0;
  useTicker(anyBuff);

  const field = useRef<MineFieldHandle>(null);
  const bagRef = useRef<HTMLButtonElement>(null);
  const tokenRef = useRef<HTMLButtonElement>(null);
  // Живность (v2.64): мышь, сорока и когда последний раз была мышь. Первая —
  // не раньше чем через полминуты после входа в шахту.
  const batRef = useRef<BatHandle>(null);
  const magRef = useRef<MagpieHandle>(null);
  const lastBat = useRef(Date.now() - BAT_GAP_MS + 30_000);
  const shinyRun = useRef({ n: 0, at: 0 });
  const fieldEl = useCallback(() => field.current?.el ?? null, []);
  const moneyRef = useRef<MoneyHandle>(null);
  const rolling = useRef<(() => void) | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullWarnAt = useRef(0);
  const hardSayAt = useRef(0);
  const toastSeq = useRef(0);
  // Удар по полю: урон, трещины, чары — общие с шахтами подземелья. Правила
  // зовут функции страницы через стрелки: в миг удара они уже объявлены.
  const dig = useMineDig(field, {
    key: mineKey,
    rockAt: (c) => rockAt(rocks, c, useFinanceStore.getState().prison.mine.dug[c]),
    rock: (r) => ({ hp: ROCKS[r].hp, kind: ROCKS[r].kind, colors: rockColors(r) }),
    // Сейд-камень площадные чары не берут: его ломают только руками. Под
    // метеоритом и Куйвой порода закрыта, пока они на поле.
    shut: (c) => {
      const st = useFinanceStore.getState().prison;
      return (
        yardShut(st).has(c) ||
        seidTop(seids, c, st.mine.dug[c]) ||
        blockTop(mineBlocks(st.mine), c, st.mine.dug[c])
      );
    },
    // Руда следующего этажа на дне — твёрже кирки: звенит, пока не выкуешь новую.
    hard: (c) => {
      const st = useFinanceStore.getState().prison;
      const rock = rockAt(rocks, c, st.mine.dug[c]);
      return rock < 0 || canMine(st.pick, rock) ? 0 : rockHardness(rock);
    },
    onHard: (c, power) => onHardOre(c, power),
    spark: () => pickSpark(useFinanceStore.getState().prison.pick),
    special: (c) => specialHit(c),
    gapMs: () => gapMs(useFinanceStore.getState().prison),
    damage: () => {
      const st = useFinanceStore.getState().prison;
      return hitDamage(st.pick) * modsOf(st).dmg;
    },
    procs: () => modsOf(useFinanceStore.getState().prison),
    vein: (c, rock, max) =>
      veinCells(rocks, useFinanceStore.getState().prison.mine.dug, c, rock, max),
    onBreak: (list, kind) => onBreak(list, kind),
    onFrenzy: (c) => startFrenzy(c),
  });
  const stripRef = useRef<HTMLDivElement>(null);
  const parcelsRef = useRef<HTMLDivElement>(null);
  const chestRef = useRef<HTMLButtonElement>(null);
  const forgeRef = useRef<HTMLButtonElement>(null);
  const petRef = useRef<HTMLSpanElement>(null);
  const streakBase = useRef({ n: 0, at: 0 });
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Темп: что сломано и сколько это стоит за последнюю минуту.
  const paceLog = useRef<{ t: number; blocks: number; coins: number }[]>([]);
  // Смена: итог каждые пять минут копания.
  const shiftAcc = useRef({ from: 0, blocks: 0, coins: 0, tokens: 0, keys: 0 });
  // Баланс на табло: во время счёта продажи его ведёт ролл-ап, а не стор.
  const [shownBalance, setShownBalance] = useState(balance);
  useEffect(() => {
    if (!rolling.current) setShownBalance(balance);
  }, [balance]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (streakTimer.current) clearTimeout(streakTimer.current);
      rolling.current?.();
      stopShake();
    },
    [],
  );

  // Стенд: в разработке мышь можно выпустить руками (`__mine.bat(true)`).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const w = window as unknown as { __mine?: { bat: (rare?: boolean) => void } };
    w.__mine = { bat: (rare = false) => batRef.current?.launch(rare) };
    return () => {
      delete w.__mine;
    };
  }, []);

  // Сундучок поверх поля: удержание под ним не должно долбить породу.
  const hasTreasure = !!prison.treasure;
  useEffect(() => {
    if (hasTreasure) field.current?.stop();
  }, [hasTreasure]);

  // Вернулся после смены — бригада уже накопала: сказать об этом сразу.
  useEffect(() => {
    if (!hydrated || !CREW_ON) return;
    const y = crewYield(useFinanceStore.getState().prison, Date.now());
    if (y.blocks > 0 && y.minutes >= 15) setCrewNote(true);
  }, [hydrated]);

  const say = useCallback((text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text });
  }, []);

  // ---- Двор: события в шахте ------------------------------------------------
  const yardMeteor = useFinanceStore((s) => s.yardMeteor);
  const prisonZoneExit = useFinanceStore((s) => s.prisonZoneExit);
  const yardKuiva = useFinanceStore((s) => s.yardKuiva);
  const [yardSplash, setYardSplash] = useState<YardEvent | null>(null);
  const closeSplash = useCallback(() => setYardSplash(null), []);
  const { ev: yardEv, now: yardNow } = useYardEvent('mine', (end) => {
    const t = endText(end);
    if (t) say(t);
  });
  // Удары по метеориту и здоровье Куйвы живут в странице, как урон по блоку.
  const meteorLeft = useRef(-1);
  const bossHp = useRef(-1);
  const [meteorN, setMeteorN] = useState(METEOR_HITS);
  const [bossFill, setBossFill] = useState(1);
  const meteorRef = useRef<HTMLDivElement>(null);
  const bossRef = useRef<HTMLDivElement>(null);
  const yardFrom = yardEv?.from ?? 0;
  useEffect(() => {
    meteorLeft.current = -1;
    bossHp.current = -1;
    setMeteorN(METEOR_HITS);
    setBossFill(1);
  }, [yardFrom]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!findCard) return undefined;
    const t = setTimeout(() => setFindCard(null), 2600);
    return () => clearTimeout(t);
  }, [findCard]);
  useEffect(() => {
    if (!shift) return undefined;
    const t = setTimeout(() => setShift(null), 4200);
    return () => clearTimeout(t);
  }, [shift]);

  // Счёт денег на табло — тот же ролл-ап, что у выигрышей в автоматах.
  const rollBalance = useCallback((from: number, to: number) => {
    rolling.current?.();
    const span = to - from;
    if (span <= 0) {
      setShownBalance(to);
      return;
    }
    const ms = Math.min(1800, 380 + 70 * Math.pow(span, 0.3));
    const stop = runRollup(plainPlan(from, to, ms), {
      value: (n) => moneyRef.current?.set(n),
      tick: (_leg, k) => rollupTick(0, k),
      done: () => {
        rolling.current = null;
        setShownBalance(useFinanceStore.getState().slotsBalance);
      },
    });
    rolling.current = () => {
      stop();
      rolling.current = null;
    };
  }, []);

  const settleBalance = useCallback(() => {
    rolling.current?.();
    setShownBalance(useFinanceStore.getState().slotsBalance);
  }, []);

  /** Всплывающая надпись над клеткой: «КРИТ», «ВЗРЫВ», «+3 токена». */
  const floatText = (c: number, text: string, cls: string, delay = 0) =>
    field.current?.float(c, text, cls, delay);

  /** Добыча летит дугой из клетки в рюкзак. */
  const flyLoot = (c: number, rock: number) =>
    field.current?.fly(c, rockTexture(rock), bagRef.current, () => hop(bagRef.current));

  const scheduleReset = () => {
    if (resetTimer.current) return;
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      const st = useFinanceStore.getState().prison;
      if (minedShare(st.mine.dug) < MINE_RESET_AT) return;
      mineRumble();
      tapMedium();
      field.current?.trauma(0.3);
      say(t('mineHud.say.mineRenewed'));
      prisonGoMine(st.mine.id);
    }, 650);
  };

  // ---- Запал --------------------------------------------------------------

  /** Запал прямо сейчас, с учётом простоя с последнего блока. */
  const streakNow = () => {
    const b = streakBase.current;
    return decayStreak(b.n, Date.now() - b.at);
  };

  /**
   * Следующий такт угасания. Таймер спит до ближайшей границы: сначала
   * полоска начинает мигать (предупреждение), потом ступень гаснет.
   */
  const armDecay = () => {
    if (streakTimer.current) clearTimeout(streakTimer.current);
    streakTimer.current = null;
    const b = streakBase.current;
    if (b.n <= 0) return;
    const idle = Date.now() - b.at;
    let wake: number;
    if (idle < STREAK_WARN_MS) wake = STREAK_WARN_MS;
    else if (idle <= STREAK_GRACE_MS) wake = STREAK_GRACE_MS + 1;
    else
      wake =
        STREAK_GRACE_MS +
        (Math.floor((idle - STREAK_GRACE_MS) / STREAK_DECAY_MS) + 1) * STREAK_DECAY_MS +
        1;
    streakTimer.current = setTimeout(() => {
      const n = streakNow();
      setStreak(n);
      setCooling(n > 0);
      if (n <= 0) {
        streakBase.current = { n: 0, at: 0 };
        return;
      }
      armDecay();
    }, wake - idle);
  };

  /** Запал поднялся на ступень: надпись, удар, рекорд и миссия дня. */
  const streakUp = (ti: number, c: number) => {
    const tier = STREAK_TIERS[ti];
    const first = ti + 1 > useFinanceStore.getState().prison.bestStreak;
    prisonStreak(ti);
    floatText(c, `${upper(streakName(ti))}!`, 'pfloat--streak');
    tierBreak(Math.min(3, ti));
    tapMedium();
    hop(stripRef.current);
    if (ti >= 3) field.current?.trauma(0.2);
    if (first)
      say(t('mineHud.say.streakFirst', { name: streakName(ti), pct: Math.round(tier.loot * 100) }));
  };

  const bumpStreak = (blocks: number, c: number) => {
    const now = Date.now();
    const n0 = decayStreak(streakBase.current.n, now - streakBase.current.at);
    const n = n0 + blocks;
    streakBase.current = { n, at: now };
    setStreak(n);
    setCooling(false);
    const t0 = streakTier(n0);
    const t1 = streakTier(n);
    if (t1 > t0) streakUp(t1, c);
    armDecay();
  };

  /** Темп и смена: копим, что сломано и сколько стоит. */
  const logPace = (blocks: number, coins: number, res: PrisonLoot) => {
    const now = Date.now();
    const log = paceLog.current;
    log.push({ t: now, blocks, coins });
    while (log.length && now - log[0].t > 60_000) log.shift();
    const acc = shiftAcc.current;
    // Больше минуты без блоков — прошлая смена закончилась, начинаем новую.
    const last = log.length > 1 ? log[log.length - 2].t : 0;
    if (!acc.from || (last && now - last > 60_000)) {
      shiftAcc.current = { from: now, blocks: 0, coins: 0, tokens: 0, keys: 0 };
    }
    const a = shiftAcc.current;
    a.blocks += blocks;
    a.coins += coins;
    a.tokens += res.tokens + res.pickUps.reduce((x, u) => x + u.tokens, 0);
    a.keys += res.keys + res.pickUps.reduce((x, u) => x + u.keys, 0);
    if (now - a.from >= SHIFT_MS && a.blocks >= 50) {
      setShift({ blocks: a.blocks, coins: a.coins, tokens: a.tokens, keys: a.keys });
      notifySuccess();
      shiftAcc.current = { from: now, blocks: 0, coins: 0, tokens: 0, keys: 0 };
    }
  };

  /**
   * Выпал ключ — сцена тотема бессмертия из Майнкрафта: слеза гаста
   * вылетает в центр экрана, растёт и проворачивается, вокруг брызжут
   * зелёно-жёлтые искры, потом она улетает в лагерь, где лежат ключи.
   * Слой на весь экран, но в нём только transform и opacity; живёт две
   * секунды и убирает себя сам. Второй ключ, пока играет первый, — просто
   * надпись: две сцены подряд друг друга съедают.
   */
  const totemKey = (c: number, n: number) => {
    keyFound();
    notifySuccess();
    field.current?.chips(c, ['#4fd04a', '#a6ec3a', '#f2e64a', '#ffffff'], 18, 1.4);
    // Слеза долетела до сундуков — только отскок кнопки, без звука: сцена
    // и так громкая, а ключ падает раз в несколько минут.
    const played = playTotem(chestRef.current, () => hop(chestRef.current));
    if (!played) {
      floatText(
        c,
        n > 1 ? t('mineHud.float.keys', { n }) : t('mineHud.float.key'),
        'pfloat--key',
        120,
      );
      return;
    }
    tapMedium();
    if (n > 1) say(t('mineHud.say.keys', { n }));
  };

  /** Что сказать и показать по итогам слома: токены, ключи, находки, рюкзак. */
  const announce = (c: number, res: PrisonLoot) => {
    const now = performance.now();
    if (res.tokens > 0) floatText(c, `+${res.tokens} ✦`, 'pfloat--token', 120);
    if (res.keys > 0) totemKey(c, res.keys);
    if (res.finds.length) {
      const f = res.finds[res.finds.length - 1];
      const n = useFinanceStore.getState().prison.finds[f.id] ?? 1;
      setFindCard({ id: f.id, fresh: f.fresh, n });
      if (f.fresh) {
        tierBreak(2);
        burstConfetti(50, ['#ffe08a', '#b8f4e6', '#fff']);
        notifySuccess();
      } else coinDing();
    }
    if (res.pickUps.length) {
      const up = res.pickUps[res.pickUps.length - 1];
      floatText(c, t('mineHud.float.pickLevel', { n: up.level }), 'pfloat--level', 180);
      softChime(2);
      notifySuccess();
      const tokens = res.pickUps.reduce((x, u) => x + u.tokens, 0);
      const keys = res.pickUps.reduce((x, u) => x + u.keys, 0);
      say(
        t(keys ? 'mineHud.say.pickLevelKey' : 'mineHud.say.pickLevel', {
          n: up.level,
          tokens: fmt(tokens),
        }),
      );
    }
    if (res.parcels.length) {
      floatText(c, t('mineHud.float.parcel'), 'pfloat--parcel', 200);
      softChime(1);
      tapMedium();
      hop(parcelsRef.current);
    }
    if (res.parcelTokens) floatText(c, `+${res.parcelTokens} ✦`, 'pfloat--token', 260);
    if (res.parcelsReady) {
      notifySuccess();
      keyFound();
      say(t('mineHud.say.parcelRipe'));
    }
    if (res.petUp) {
      say(t('mineHud.say.petLevel', { name: petName(res.petUp.id), n: res.petUp.level }));
      softChime(2);
      hop(petRef.current);
    }
    if (res.eggsReady) {
      say(t('mineHud.say.eggWarm'));
      softChime(5);
      hop(petRef.current);
    }
    if (res.normDone) {
      tierBreak(2);
      notifySuccess();
      burstConfetti(40, ['#9be38a', '#ffe08a', '#fff']);
      say(t('mineHud.say.normDone'));
    }
    if (res.lost > 0 && now - fullWarnAt.current > 4000) {
      fullWarnAt.current = now;
      bagFullSound();
      notifyWarning();
      say(t('mineHud.say.bagFull'));
      hop(bagRef.current);
    }
    if (res.sold) {
      // Вагонетка сама отвезла рюкзак.
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - res.sold, to);
      coinDing();
      floatText(c, `+${fmtShort(res.sold)}`, 'pfloat--coin');
    }
    // Вагонетка (или спецзона) отложила руду для кирки — кузница кивнула.
    if (res.boxed > 0) hop(forgeRef.current);
    const dug = useFinanceStore.getState().prison.mine.dug;
    if (minedShare(dug) >= MINE_RESET_AT) scheduleReset();
  };

  /**
   * Блоки сломаны (крошку и подъём торцов рисует поле): стор, запал, темп,
   * перековка, норма, добыча в рюкзак и всё, что надо сказать.
   */
  const onBreak = (list: DigBlock[], kind: BreakKind) => {
    const st = useFinanceStore.getState().prison;
    const valueBefore = bagValue(st.bag, modsOf(st).sell);
    const res = prisonBreak(list, { streak: streakNow() });
    const after = useFinanceStore.getState().prison;
    // Под сломанным открылся блок этажа — это надо увидеть сразу.
    const opened = list.find(
      (b) => after.mine.id === st.mine.id && blockTop(blocks, b.cell, after.mine.dug[b.cell]),
    );
    if (opened) {
      const name = blockName(after.mine.id);
      floatText(opened.cell, `${upper(name)}!`, 'pfloat--block', 80);
      field.current?.chips(opened.cell, [...rockColors(after.mine.id), '#ffffff'], 16, 1.4);
      softChime(0);
      notifySuccess();
    }
    const gained = bagValue(after.bag, modsOf(after).sell) - valueBefore + res.sold;
    bumpStreak(res.broken, list[0].cell);
    logPace(res.broken, gained, res);
    const single = kind === 'hit' || kind === 'crit';
    // Перековка: блок засчитан породой выше — золотые искры и её имя.
    if (res.reforged.length) {
      const f = res.reforged[0];
      field.current?.chips(f.cell, ['#ffd35a', '#fff3b0', '#ffae3a'], single ? 12 : 6, 1.2);
      if (single) floatText(f.cell, `⚙ ${rockName(f.rock)}`, 'pfloat--reforge', 120);
    }
    // Гарантия: долго не было блока этажа — он встал сам, это надо увидеть.
    if (res.pityBlock >= 0) {
      const cb = res.pityBlock;
      floatText(cb, t('mineHud.float.pity'), 'pfloat--block', 140);
      field.current?.chips(cb, [...rockColors(after.mine.id), '#ffffff', '#ffe08a'], 24, 1.6);
      field.current?.shockwave(cb, 2, false);
      field.current?.rise(cb);
      tierBreak(2);
      notifySuccess();
      say(t('mineHud.say.pity', { block: blockName(after.mine.id) }));
    }
    list.forEach((b, i) => {
      if (res.taken > 0 && i < (single ? 1 : 4)) flyLoot(b.cell, b.rock);
      // Порода следующей шахты на дне — находка, о ней стоит сказать.
      if (single && b.rock > st.mine.id) floatText(b.cell, rockName(b.rock), 'pfloat--find');
    });
    announce(list[0].cell, res);
    yardLoot(list[0].cell, res);
    maybeBat(res.broken);
  };

  // ---- Живность ------------------------------------------------------------

  /**
   * Удар мог вспугнуть летучую мышь. Не летает, пока ждёт сундучок, пока на
   * поле метеорит, Куйва или сорока: две вещи в воздухе — это уже каша.
   */
  const maybeBat = (blocks: number) => {
    const now = Date.now();
    const st = useFinanceStore.getState().prison;
    if (st.treasure || batRef.current?.busy()) return;
    const ev = liveEvent(st);
    if (ev?.place === 'mine' && (ev.id === 'meteor' || ev.id === 'kuiva' || ev.id === 'magpie'))
      return;
    if (!batRoll(blocks, now - lastBat.current, Math.random)) return;
    lastBat.current = now;
    batRef.current?.launch(Math.random() < BAT_RARE);
  };

  /** Клетка под точкой поля. */
  const cellAtPx = (x: number, y: number) => {
    const w = field.current?.el?.clientWidth ?? 1;
    const size = w / MINE_COLS;
    const col = Math.max(0, Math.min(MINE_COLS - 1, Math.floor(x / size)));
    const row = Math.max(0, Math.min(MINE_ROWS - 1, Math.floor(y / size)));
    return row * MINE_COLS + col;
  };

  // ---- Питомцы (v2.72): трюки отряда на поле -----------------------------
  const [sense, setSense] = useState<{ cell: number; below: number; key: number } | null>(null);
  const [rush, setRush] = useState(false);
  /** Клетка ближе всего к питомцам (нижний ряд, середина), где ещё есть порода. */
  const nearPets = (): number => {
    const st = useFinanceStore.getState().prison;
    const mid = Math.floor(MINE_COLS / 2);
    for (let row = MINE_ROWS - 1; row >= 0; row--)
      for (let d = 0; d <= mid; d++)
        for (const col of [mid - d, mid + d]) {
          const c = row * MINE_COLS + col;
          if (col < 0 || col >= MINE_COLS) continue;
          if (rockAt(rocks, c, st.mine.dug[c]) >= 0) return c;
        }
    return -1;
  };
  const onPetTrick = (t: PetTrick) => {
    const f = field.current;
    if (t.role === 'loot' && t.ore) {
      const c = nearPets();
      if (c >= 0) f?.fly(c, rockTexture(t.ore.rock), bagRef.current, () => hop(bagRef.current));
    } else if (t.role === 'sell' && t.coins) {
      coinDing();
    } else if (t.role === 'dmg') {
      // Силач раскалывает блок у своих лап — один, а не площадь.
      const c = nearPets();
      if (c >= 0) dig.breakCells([c], 'hit');
    } else if (t.role === 'rate') {
      petRushUntil = Date.now() + TRICK_RUSH_MS;
      setRush(true);
      dig.later(() => setRush(false), TRICK_RUSH_MS);
    } else if (t.role === 'luck' && t.sense) {
      const key = Date.now();
      setSense({ ...t.sense, key });
      softChime(6);
      setTimeout(() => setSense((x) => (x && x.key === key ? null : x)), TRICK_SENSE_MS);
    }
  };

  /** Мышь поймана: пух и искры там, где её сбили, потом — сундучок. */
  const onBatCatch = (rare: boolean, x: number, y: number) => {
    const f = field.current;
    f?.stop();
    const c = cellAtPx(x, y);
    f?.chips(
      c,
      rare ? ['#9fd8ff', '#e0f4ff', '#4a6aa0', '#ffffff'] : ['#c8905a', '#f0d0a0', '#5a3a20'],
      rare ? 26 : 16,
      1.3,
    );
    f?.puff(c, 'rgba(230,220,200,1)', 10);
    f?.trauma(rare ? 0.3 : 0.18);
    floatText(
      c,
      rare ? t('mineHud.float.batRare') : t('mineHud.float.batCaught'),
      rare ? 'pfloat--seid' : 'pfloat--streak',
    );
    tierBreak(rare ? 2 : 1);
    dig.later(() => {
      if (prisonBatCatch(rare)) notifySuccess();
    }, 420);
  };

  /** Блестяшка сороки подобрана: подряд — звон выше. */
  const pickShiny = (kind: ShinyKind, c: number) => {
    const v = yardShiny(kind);
    if (!v) return;
    const now = performance.now();
    const k = now - shinyRun.current.at < 1200 ? shinyRun.current.n + 1 : 0;
    shinyRun.current = { n: k, at: now };
    shinyPick(k);
    tapLight();
    field.current?.chips(c, ['#ffe08a', '#fff6c8', '#ffd257'], 8, 1);
    if (v.coins) floatText(c, `+${fmtShort(v.coins)}`, 'pfloat--coin');
    if (v.tokens) {
      floatText(c, `+${v.tokens} ✦`, 'pfloat--token');
      hop(tokenRef.current);
    }
    if (v.keys) totemKey(c, v.keys);
  };

  /** Сундучок выдал своё: монеты досчитываются на табло, прочее — тостом. */
  const onTreasureGot = (got: TreasureGot) => {
    const r = got.reward;
    notifySuccess();
    if (got.coins) {
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - got.coins, to);
      coinDing();
      payoutEnd(1);
      return;
    }
    if (r.kind === 'tokens') {
      coinDing();
      hop(tokenRef.current);
      say(t('mineHud.say.tokens', { n: Math.round(r.amount) }));
    } else if (r.kind === 'keys') {
      keyFound();
      hop(chestRef.current);
      say(r.amount > 1 ? t('mineHud.say.chestKeys', { n: r.amount }) : t('mineHud.say.chestKey'));
    } else if (r.kind === 'rune') {
      tierBreak(2);
      say(
        got.shattered
          ? t('mineHud.say.runeShattered', { n: got.shattered })
          : t('mineHud.say.runeBag', { reward: rewardLabel(r) }),
      );
    } else if (r.kind === 'book') {
      tierBreak(2);
      say(t('mineHud.say.bookShelf', { reward: rewardLabel(r) }));
    } else {
      tierBreak(1);
      say(t('mineHud.say.itemRow', { reward: rewardLabel(r) }));
    }
  };

  const onRiskLost = (stake: number) => {
    field.current?.trauma(0.25);
    say(t('mineHud.say.riskLost', { sum: fmtShort(stake) }));
  };

  /** Звон о руду твёрже кирки: подсказка, какая кирка её берёт. */
  const onHardOre = (c: number, power: number) => {
    floatText(c, `⛏${power}`, 'pfloat--hard');
    const now = Date.now();
    if (now - hardSayAt.current < 6000) return;
    hardSayAt.current = now;
    const needI = PICKS.findIndex((x) => !x.prestige && x.power >= power);
    const name = needI >= 0 ? nameIn(pickName(needI)) : '';
    // Нужная кирка уже выкована, просто в руке слабая — так и скажем.
    const have = useFinanceStore.getState().prison.pickMax;
    say(
      PICKS[have].power >= power && needI >= 0
        ? t('mineHud.say.hardHave', { name, power })
        : needI >= 0
          ? t('mineHud.say.hardNeed', { name, power })
          : t('mineHud.say.hardNone', { power }),
    );
  };

  const startFrenzy = (c: number) => {
    prisonFrenzy();
    frenzyStart();
    notifySuccess();
    floatText(c, t('mineHud.float.frenzy'), 'pfloat--frenzy');
    say(t('mineHud.say.frenzy'));
  };

  /**
   * Удар по сейд-камню. Считаются УДАРЫ, а не урон: сколько бы ни била
   * кирка, нужно несколько попаданий, крит — за два. Счёт живёт в том же
   * `hp`, что и урон породы: сейд сверху — значит, это его запас.
   */
  const seidHit = (c: number, crit: boolean) => {
    const f = field.current;
    f?.swing(c, crit);
    const hp = dig.hp.current;
    const left = (hp[c] < 0 ? SEID_HITS : hp[c]) - (crit ? 2 : 1);
    f?.chips(c, ['#3fe6d0', '#c8fff6', '#262b33'], crit ? 12 : 6, crit ? 1.4 : 0.9);
    if (left > 0) {
      hp[c] = left;
      dig.setCrack(c, crackStage(left, SEID_HITS));
      pickHit('crystal', crit);
      tapMedium();
      if (crit) floatText(c, t('mineHud.float.crit'), 'pfloat--crit');
      f?.wobble(c);
      return;
    }
    hp[c] = -1;
    f?.shatter(c, true);
    dig.setCrack(c, 0);
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonSeid(c);
    if (!got) return;
    rollBalance(from, from + got.coins);
    tierBreak(3);
    flashFrame('big');
    f?.trauma(0.45);
    notifySuccess();
    f?.shockwave(c, 5, false);
    f?.chips(c, ['#3fe6d0', '#c8fff6', '#ffffff', '#8ff5e6'], 40, 2);
    burstConfetti(70, ['#3fe6d0', '#c8fff6', '#ffe08a']);
    floatText(c, `+${got.tokens} ✦`, 'pfloat--seid');
    say(t('mineHud.say.seid', { tokens: fmt(got.tokens), coins: fmtShort(got.coins) }));
    bumpStreak(1, c);
  };

  /**
   * Удар по блоку этажа — цельному кубу руды. Как сейд, считаются УДАРЫ
   * (`BLOCK_HITS`, крит — за два), площадные чары его не берут: такой блок
   * добывают руками. Сломал — деньги сразу, крупно и с дождём монет.
   */
  const oreBlockHit = (c: number, crit: boolean) => {
    const f = field.current;
    const floor = useFinanceStore.getState().prison.mine.id;
    const colors = rockColors(floor);
    f?.swing(c, crit);
    const hp = dig.hp.current;
    const left = (hp[c] < 0 ? BLOCK_HITS : hp[c]) - (crit ? 2 : 1);
    f?.chips(c, [...colors, '#ffffff'], crit ? 14 : 8, crit ? 1.4 : 1);
    if (left > 0) {
      hp[c] = left;
      dig.setCrack(c, crackStage(left, BLOCK_HITS));
      pickHit('crystal', crit);
      tapMedium();
      if (crit) floatText(c, t('mineHud.float.crit'), 'pfloat--crit');
      f?.wobble(c);
      return;
    }
    hp[c] = -1;
    f?.shatter(c, true);
    dig.setCrack(c, 0);
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonOreBlock(c);
    if (!got) return;
    rollBalance(from, from + got.coins);
    // Блок этажа попадается раз в минуту: удар и фишки, без фанфары.
    tierBreak(2);
    flashFrame('big');
    f?.trauma(0.55);
    notifySuccess();
    f?.shockwave(c, 5, false);
    f?.chips(c, [...colors, '#ffffff', '#ffe08a'], 48, 2.2);
    burstConfetti(80, [...colors.slice(0, 3), '#ffe08a', '#ffffff']);
    rainCoins(Math.min(40, 14 + Math.round(Math.log2(1 + got.coins / 100) * 3)));
    setTimeout(() => payoutEnd(0), 350);
    floatText(c, `+${fmtShort(got.coins)}`, 'pfloat--block', 0);
    say(
      t('mineHud.say.block', { block: blockName(floor), n: fmt(got.coins) }) +
        (got.own ? '' : t('mineHud.say.blockNotOwn')) +
        (got.book ? t('mineHud.say.blockBook', { book: bookName(got.book) }) : ''),
    );
    if (got.book) floatText(c, t('mineHud.float.book'), 'pfloat--level', 260);
    bumpStreak(1, c);
  };

  // ---- Двор ---------------------------------------------------------------

  /** Клетки, закрытые событием: под метеоритом и под Куйвой. */
  const yardShut = (st: PrisonState): Set<number> => {
    const ev = liveEvent(st);
    if (!ev || ev.place !== 'mine') return new Set();
    if (ev.id === 'meteor') return new Set([ev.cell]);
    if (ev.id === 'kuiva') return new Set(kuivaCells(ev.cell));
    return new Set();
  };

  /** Приз события: деньги досчитываются, слеза — сценой тотема. */
  const yardPrize = (x: YardPrize, c: number) => {
    const to = useFinanceStore.getState().slotsBalance;
    if (x.coins) rollBalance(to - x.coins, to);
    tierBreak(3);
    notifySuccess();
    burstConfetti(60, ['#ffe08a', '#b8f4e6', '#fff']);
    if (x.tokens) floatText(c, `+${x.tokens} ✦`, 'pfloat--seid');
    if (x.keys) totemKey(c, x.keys);
    say(prizeSay(x));
  };

  /** Что двор сказал по итогам удара: событие началось, выполнено, ушло. */
  const yardLoot = (c: number, res: PrisonLoot) => {
    const z = res.zone;
    if (z) {
      if (z.tokens > 0) floatText(c, `+${z.tokens} ✦`, 'pfloat--token', 60);
      if (z.bonus) {
        tierBreak(2);
        notifySuccess();
        burstConfetti(40, ['#c89aff', '#e6c8ff', '#fff']);
        say(t('mineHud.say.zoneBonus'));
      }
      if (z.ended) {
        mineRumble();
        notifyWarning();
        say(t('mineHud.say.zoneOver'));
      }
    }
    if (res.eventEnded) {
      const t = endText(res.eventEnded);
      if (t) say(t);
    }
    if (res.eventDone) yardPrize(res.eventDone, c);
    const ev = res.eventStarted;
    if (!ev) return;
    setYardSplash(ev);
    tierBreak(2);
    notifyWarning();
    if (ev.id === 'meteor') {
      // Удар о поле — когда камень долетел (CSS `ymeteor-drop`, 650 мс).
      dig.later(
        () => {
          const f = field.current;
          treeFall();
          flashFrame('small');
          f?.trauma(0.55);
          f?.puff(ev.cell, 'rgba(255,170,90,1)', 14);
          f?.chips(ev.cell, ['#ff6a1a', '#ffd35a', '#4a3a30', '#fff3b0'], 30, 1.8);
          f?.shockwave(ev.cell, 3, true);
        },
        reduceMotion() ? 0 : 650,
      );
    } else if (ev.id === 'kuiva') {
      mineRumble();
      field.current?.trauma(0.6);
    }
  };

  /** Метеорит: считаются удары, крит — за два, как у сейда. */
  const meteorHit = (c: number, crit: boolean) => {
    const f = field.current;
    f?.swing(c, crit);
    const left = (meteorLeft.current < 0 ? METEOR_HITS : meteorLeft.current) - (crit ? 2 : 1);
    f?.chips(c, ['#ff6a1a', '#ffd35a', '#4a3a30'], crit ? 14 : 7, crit ? 1.5 : 1);
    const el = meteorRef.current;
    if (el && !reduceMotion()) {
      try {
        el.animate(
          [
            { transform: 'scale(1)' },
            { transform: `scale(.84) rotate(${crit ? -8 : -4}deg)`, offset: 0.3 },
            { transform: 'scale(1.05)', offset: 0.7 },
            { transform: 'scale(1)' },
          ],
          { duration: 190, easing: 'ease-out' },
        );
      } catch {
        /* не страшно */
      }
    }
    if (left > 0) {
      meteorLeft.current = left;
      setMeteorN(left);
      pickHit('crystal', crit);
      tapMedium();
      if (crit) floatText(c, t('mineHud.float.crit'), 'pfloat--crit');
      return;
    }
    meteorLeft.current = -1;
    setMeteorN(0);
    const got = yardMeteor();
    if (!got) return;
    boom(1);
    flashFrame('big');
    f?.trauma(0.5);
    f?.shockwave(c, 5, true);
    f?.chips(c, ['#ff6a1a', '#ffd35a', '#ffffff', '#4a3a30'], 44, 2.1);
    yardPrize(got, c);
  };

  /** Куйва: урон как по породе, здоровье — полоской над ним. */
  const kuivaHit = (c: number, crit: boolean, st: PrisonState, ev: YardEvent) => {
    const f = field.current;
    f?.swing(c, crit);
    const dmg = hitDamage(st.pick) * modsOf(st).dmg * (crit ? CRIT_MULT : 1);
    const left = (bossHp.current < 0 ? ev.hp : bossHp.current) - dmg;
    f?.chips(c, ['#6a727c', '#9aa4ae', '#3fe6d0'], crit ? 12 : 5, crit ? 1.4 : 0.9);
    const el = bossRef.current;
    if (el && !reduceMotion()) {
      const dx = ((c % MINE_COLS) - ((ev.cell % MINE_COLS) + 1)) * 3;
      try {
        el.animate(
          [
            { transform: 'translate(0,0)' },
            { transform: `translate(${-dx}px, ${crit ? 5 : 2}px)`, offset: 0.3 },
            { transform: 'translate(0,0)' },
          ],
          { duration: crit ? 220 : 140, easing: 'ease-out' },
        );
      } catch {
        /* не страшно */
      }
    }
    if (left > 1e-6) {
      bossHp.current = left;
      setBossFill(left / ev.hp);
      pickHit('stone', crit);
      if (crit) {
        floatText(c, t('mineHud.float.crit'), 'pfloat--crit');
        f?.trauma(0.2);
        tapMedium();
      } else selectionChanged();
      return;
    }
    bossHp.current = -1;
    setBossFill(0);
    const got = yardKuiva();
    if (!got) return;
    const mid = ev.cell + MINE_COLS + 1;
    boom(2);
    flashFrame('big');
    f?.trauma(0.8);
    f?.shockwave(mid, 7, false);
    f?.chips(mid, ['#6a727c', '#9aa4ae', '#3fe6d0', '#c8fff6'], 70, 2.4);
    f?.puff(mid, 'rgba(180,190,200,1)', 20);
    floatText(mid, t('mineHud.float.kuiva'), 'pfloat--fell');
    yardPrize(got, mid);
  };

  /**
   * Клетка забирает удар себе: метеорит и Куйва лежат поверх поля, сейд
   * бьётся ударами, а не уроном. Остальное — обычный удар поля.
   */
  const specialHit = (c: number): boolean => {
    // Блестяшка сороки лежит поверх породы — удар подбирает её.
    const shiny = magRef.current?.takeAt(c);
    if (shiny) {
      field.current?.swing(c, false);
      pickShiny(shiny, c);
      return true;
    }
    const st = useFinanceStore.getState().prison;
    const ev = liveEvent(st);
    if (ev?.place === 'mine') {
      if (ev.id === 'meteor' && c === ev.cell) {
        meteorHit(c, Math.random() < CRIT_CHANCE);
        return true;
      }
      if (ev.id === 'kuiva' && kuivaCells(ev.cell).includes(c)) {
        kuivaHit(c, Math.random() < CRIT_CHANCE, st, ev);
        return true;
      }
    }
    if (seidTop(seids, c, st.mine.dug[c])) {
      seidHit(c, Math.random() < CRIT_CHANCE);
      return true;
    }
    if (blockTop(blocks, c, st.mine.dug[c])) {
      oreBlockHit(c, Math.random() < CRIT_CHANCE);
      return true;
    }
    return false;
  };

  // ---- Расходники --------------------------------------------------------

  /** Бомба ложится в клетку, фитиль шипит, потом взрыв. */
  const dropBomb = (c: number, id: ItemId) => {
    if (!prisonUseItem(id)) {
      notifyWarning();
      return;
    }
    const r = id === 'bomb5' ? 2 : 1;
    const layer = field.current?.layer;
    const { x, y, size } = field.current?.center(c) ?? { x: 0, y: 0, size: 0 };
    let sprite: HTMLElement | null = null;
    if (layer && !reduceMotion()) {
      sprite = document.createElement('span');
      sprite.className = 'pbomb';
      sprite.textContent = ITEMS.find((i) => i.id === id)!.glyph;
      sprite.style.left = `${x}px`;
      sprite.style.top = `${y}px`;
      sprite.style.fontSize = `${size * 0.8}px`;
      layer.appendChild(sprite);
      try {
        sprite.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1.8)', opacity: 0 },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.2 },
            { transform: 'translate(-50%,-50%) scale(1.12)', offset: 0.45 },
            { transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 },
            { transform: 'translate(-50%,-50%) scale(1.22)', offset: 0.85 },
            { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 1 },
          ],
          { duration: 760, fill: 'forwards' },
        );
      } catch {
        /* не страшно */
      }
    }
    tapLight();
    [0, 260, 520].forEach((ms, k) => dig.later(() => fuseTick(k), ms));
    // Спрайт убирается всегда, взрыв — только если шахта та же.
    setTimeout(() => sprite?.remove(), 760);
    dig.later(
      () => dig.blastAt(c, r, r > 1 ? t('mineHud.float.dynamite') : t('mineHud.float.boom')),
      760,
    );
  };

  const applyItem = (id: ItemId) => {
    primeAudio();
    const st = useFinanceStore.getState().prison;
    if (st.items[id] <= 0) {
      tapLight();
      // Крепь не продаётся — её сбивают на лесопилке, а она в лесу: лагерь
      // шахты про лес не знает.
      if (id === 'prop') say(t('mineHud.say.propWhere'));
      else openScreen('more', 'shop');
      return;
    }
    if (id === 'bomb3' || id === 'bomb5') {
      selectionChanged();
      setArming((cur) => (cur === id ? null : id));
      return;
    }
    if (id === 'charge') {
      if (!prisonUseItem('charge')) return;
      say(t('mineHud.say.chargeSet'));
      fuseTick(0);
      dig.later(
        () => dig.hammerFrom(Math.floor(MINE_CELLS / 2), t('mineHud.float.charge'), 3),
        450,
      );
      return;
    }
    if (!prisonUseItem(id)) return;
    notifySuccess();
    tierBreak(1);
    say(
      id === 'energy'
        ? t('mineHud.say.energy')
        : id === 'prop'
          ? t('mineHud.say.prop')
          : t('mineHud.say.lens'),
    );
  };

  // ---- Пальцы: бомба забирает тап себе ------------------------------------

  const onFieldTap = (c: number): boolean => {
    if (!arming) return false;
    if (c >= 0) {
      const id = arming;
      setArming(null);
      dropBomb(c, id);
    }
    return true;
  };

  // ---- Деньги: продажа, ранг, бригада -----------------------------------

  const sell = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonSell();
    const value = got.coins;
    if (got.boxed > 0) {
      // Руда для следующей кирки не продана — легла в ящик кузнеца.
      hop(forgeRef.current);
      say(t('mineHud.say.boxed', { n: fmt(got.boxed) }));
    }
    if (!value) {
      if (got.boxed > 0) {
        tapLight();
        return;
      }
      notifyWarning();
      say(t('mineHud.say.bagEmpty'));
      return;
    }
    rollBalance(from, from + value);
    coinDing();
    notifySuccess();
    hop(bagRef.current);
    const cost = rankCost(Math.min(rank, LAST_RANK - 1), prestige);
    if (value >= cost * 0.3) {
      rainCoins(Math.min(30, 8 + Math.round((value / cost) * 20)));
      setTimeout(() => payoutEnd(1), 300);
    }
  };

  const rankUp = () => {
    primeAudio();
    if (rank >= LAST_RANK) {
      startTransition(() => setSheet('prestige'));
      return;
    }
    const st = useFinanceStore.getState();
    const nd = rankNeeds(st.prison);
    // Не готово — лист условий: что сделано, чего не хватает, что можно докупить.
    if (!nd.pickOk || nd.work < nd.workNeed || nd.buyout > 0 || st.slotsBalance < nd.coins) {
      tapLight();
      startTransition(() => setSheet('norm'));
      return;
    }
    takeRank(false);
  };

  /** Взять ранг: по выполненной норме или с откупом недобора. */
  const takeRank = (buyout: boolean) => {
    const res = prisonRankUp(buyout);
    if (!res) {
      notifyWarning();
      return;
    }
    setSheet(null);
    settleBalance();
    // Ранг — редкое событие: ему фраза положена (по бюджету мелодий).
    tierBreak(4);
    notifySuccess();
    // Телефону — вдвое меньше конфетти (критик r2: 95 узлов, кадр до 283 мс при 4×).
    burstConfetti(shell.ff.startsWith('phone') ? 40 : 80);
    field.current?.trauma(0.35);
    setRankScene(res);
  };

  const openParcel = (i: number) => {
    primeAudio();
    const x = useFinanceStore.getState().prison.parcels[i];
    if (!x) return;
    if (x.left > 0) {
      tapLight();
      say(t('mineHud.say.parcelLeft', { n: Math.round(x.left) }));
      return;
    }
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonParcelOpen(i);
    if (!got) return;
    const to = useFinanceStore.getState().slotsBalance;
    if (to > from) rollBalance(from, to);
    tapMedium();
    setReveal(got);
  };

  /**
   * Сброс необратим, поэтому в два касания: первое взводит кнопку и пишет,
   * что пропадёт, второе — сбрасывает. Взведённая сама гаснет через 5 с.
   */
  const doWipe = (what: 'prison' | 'all') => {
    primeAudio();
    if (wipe !== what) {
      notifyWarning();
      setWipe(what);
      return;
    }
    setWipe(null);
    if (what === 'all') gamesReset();
    else prisonReset();
    streakBase.current = { n: 0, at: 0 };
    if (streakTimer.current) clearTimeout(streakTimer.current);
    setStreak(0);
    setCooling(false);
    paceLog.current = [];
    settleBalance();
    setSheet(null);
    mineRumble();
    tapMedium();
    say(what === 'all' ? t('settings.progress.wipedAll') : t('settings.progress.wipedPrison'));
  };

  const claimGuide = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const r = prisonGuideClaim();
    if (!r) return;
    if (r.coins) rollBalance(from, from + r.coins);
    coinDing();
    softChime(2);
    notifySuccess();
    burstConfetti(36, ['#ffe08a', '#b8f4e6', '#fff']);
  };

  const collectCrew = () => {
    primeAudio();
    const from = useFinanceStore.getState().slotsBalance;
    const got = prisonCrewCollect();
    setCrewNote(false);
    if (!got) return;
    rollBalance(from, from + got.coins);
    coinDing();
    notifySuccess();
    say(t('mineHud.say.crew', { coins: fmtShort(got.coins), tokens: fmt(got.tokens) }));
  };

  const goMine = (id: number) => {
    primeAudio();
    tapLight();
    prisonGoMine(id);
    mineRumble();
    setSheet(null);
  };

  const prestigeNow = () => {
    if (!prisonPrestige()) {
      notifyWarning();
      return;
    }
    settleBalance();
    tierBreak(4);
    notifySuccess();
    burstConfetti(140);
    setSheet(null);
    const st = useFinanceStore.getState().prison;
    say(t('mineHud.say.prestige', { n: st.prestige, x: sellMult(st.prestige).toFixed(2) }));
  };

  // ---- Разметка ----------------------------------------------------------

  const m = modsOf(prison);
  // Свежие обработчики для блоков под Keep (их разметка не перерисовывается на каждом ударе).
  const live = useRef({ sell, applyItem });
  live.current = { sell, applyItem };
  const cap = bagCapacity(bagLevel);
  const count = bagCount(bag);
  // Цена на кнопке — без руды для следующей кирки: её кузнец отложит в ящик.
  const value = bagValue(reserveOre(bag, prison.forgeBox, nextPick(prison)).bag, m.sell);
  const full = count >= cap;
  const atTop = rank >= LAST_RANK;
  const cost = atTop ? prestigeCost(prestige) : rankCost(rank, prestige);
  const progress = Math.max(0, Math.min(1, balance / cost));
  const need = rankNeeds(prison);
  const workOk = atTop || need.work >= need.workNeed;
  const pickOk = atTop || need.pickOk;
  const buyout = atTop ? 0 : need.buyout;
  const qDone = workOk && pickOk && buyout === 0;
  // Кирка, которую просит следующий этаж, и гарантия блока этажа.
  const needPick = PICKS.findIndex((x) => !x.prestige && x.power >= need.power);
  const pityLeft = mine.id === rank ? Math.max(0, blockPity(rank) - prison.pity) : 0;
  const rankReady = progress >= 1 && qDone;
  const needRocks = new Set<number>();
  // Конвой: та же точка на породе, которую он ждёт.
  if (yardEv?.id === 'convoy') needRocks.add(yardEv.rock);
  const pickLv = pickLevelOf(prison.pickXp);
  const sTier = streakTier(streak);
  const sNext = STREAK_TIERS[sTier + 1];
  const sFrom = sTier >= 0 ? STREAK_TIERS[sTier].at : 0;
  const sFill = sNext ? (streak - sFrom) / (sNext.at - sFrom) : 1;
  // Темп за последнюю минуту — только пока копаешь.
  const pace = (() => {
    const log = paceLog.current;
    if (!log.length || streak <= 0 || nowTick - log[log.length - 1].t > 8000) return null;
    const span = Math.max(10_000, Math.min(60_000, nowTick - log[0].t));
    if (nowTick - log[0].t < 6000) return null;
    let b = 0;
    let c = 0;
    for (const e of log) {
      if (nowTick - e.t > 60_000) continue;
      b += e.blocks;
      c += e.coins;
    }
    return { blocks: (b * 60_000) / span, coins: (c * 60_000) / span };
  })();
  const guide = guideStep(prison);
  const guideOk = guideReady(prison);
  const [guideV, guideGoal] = guide ? guide.progress(prison) : [0, 0];
  const crewNow = crewYield(prison, nowTick);
  /** Вкладка лагеря, где «!» на кнопке снимается (критик r2: «!» открывал «Руны»). */
  const campTab: CampTab | null =
    milesReady(prison) > 0
      ? 'miles'
      : perkPointsFree(prison) > 0
        ? 'perks'
        : CREW_ON && crewNow.minutes >= 60
          ? 'crew'
          : null;
  const campBadge = campTab !== null;
  const openCamp = () => {
    const p = useFinanceStore.getState().prison;
    const tab: CampTab | undefined =
      milesReady(p) > 0
        ? 'miles'
        : perkPointsFree(p) > 0
          ? 'perks'
          : CREW_ON && crewYield(p, Date.now()).minutes >= 60
            ? 'crew'
            : undefined;
    openScreen('more', tab);
  };
  const forgeReady = forgeReadyNow(prison, balance);
  // «!» на книгах: есть что вписать или склеить на наковальне.
  const enchReady = booksReady(prison);

  /** Лупа: метка ближайшей редкости под клеткой — сейда или блока этажа. */
  const lensMark = (c: number, d: number): { seidBelow: number; seidTex?: string } => {
    if (buffs.lens <= 0) return { seidBelow: 0 };
    const sd = seids.find((x) => x.cell === c && x.depth > d);
    const bl = blocks.find((x) => x.cell === c && x.depth > d);
    if (sd && (!bl || sd.depth <= bl.depth))
      return { seidBelow: sd.depth - d, seidTex: seidTexture() };
    if (bl) return { seidBelow: bl.depth - d, seidTex: blockTexture(mine.id) };
    return { seidBelow: 0 };
  };

  const renderCells = (faceRef: (i: number, el: HTMLSpanElement | null) => void) => {
    const cells = [];
    for (let c = 0; c < MINE_CELLS; c++) {
      const d = mine.dug[c];
      const top = rockAt(rocks, c, d);
      const seid = seidTop(seids, c, d);
      const oreBlock = !seid && blockTop(blocks, c, d);
      const hard = top >= 0 && !seid && !oreBlock && !canMine(pick, top) ? rockHardness(top) : 0;
      let peek = -1;
      if (buffs.lens > 0 && top >= 0 && d + 1 < DEPTH) {
        const below = rockAt(rocks, c, d + 1);
        if (ROCKS[below].value > ROCKS[top].value) peek = below;
      }
      cells.push(
        <MineCell
          key={c}
          index={c}
          tex={
            seid
              ? seidTexture()
              : oreBlock
                ? blockTexture(mine.id)
                : top < 0
                  ? bedrockTexture()
                  : rockTexture(top, rockVariant(mine.seed, c, d))
          }
          bottom={top < 0}
          depth={d}
          crack={dig.cracks[c]}
          crackVar={crackVariant(mine.seed, c, d)}
          peek={peek >= 0 ? rockTexture(peek) : ''}
          need={needRocks.has(top)}
          seid={seid}
          block={oreBlock}
          hard={hard}
          {...lensMark(c, d)}
          wt={wall(mine.dug, c, 0, -1)}
          wl={wall(mine.dug, c, -1, 0)}
          wb={wall(mine.dug, c, 0, 1)}
          wr={wall(mine.dug, c, 1, 0)}
          faceRef={faceRef}
        />,
      );
    }
    return cells;
  };

  // Расходники в ряду: крепь — только когда её есть из чего сбить.
  const shownItems = ITEMS.filter(
    (it) => it.id !== 'prop' || prison.items.prop > 0 || (FOREST_ON && millLevel > 0),
  );

  // Раскладка (UI v2): высокий экран — стопкой, широкий — три колонки.
  const shell = useFormFactor();
  // Нажатие видно на pointerdown (набор): для кнопок шахты вне набора.
  const press = usePress();
  useEffect(() => {
    hopU = shell.scale;
  }, [shell.scale]);
  const wide = shell.w > shell.h;
  /** Широкий экран не телефона: колонки высокие — крупнее значки и расходники, рюкзак
   *  переезжает влево, док занимает правую колонку целиком (критик: без пустых полос). */
  const roomy = wide && !shell.ff.startsWith('phone');
  /** Низкий телефон стоя (320×568, ≤ 640 px — тот же порог, что в mine.css): расходники —
   *  столбиком слева от рамы, их ряд (44 + 2 px) отдан полю (критик r3: клетка с заданием
   *  16 → 21). От окна, а не от клетки — иначе раскладка качалась бы между двумя видами. */
  const itemsCol = !wide && shell.ff.startsWith('phone') && shell.h <= 640;
  const rootRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cell = useFieldCell(rootRef, slotRef, frameRef, wide, shell.scale);
  // Отряд на кромке рамы растёт вместе с клеткой; на телефоне — прежние 44.
  const petSize = Math.max(44, Math.min(112, Math.round(cell * 0.9)));
  const dockIco = (roomy ? 24 : 12) * shell.scale;

  // Горячие клавиши шахты (слой действий src/input): I инвентарь, P питомцы,
  // F кузница, B книги, C сундуки, M этажи, L лагерь, E продать рюкзак,
  // R ранг, 1–6 расходники; работают, пока шахта на верхнем слое (под окном
  // молчат). Tab/Shift+Tab (LB/RB) листают вкладки открытого экрана лагеря.
  const itemKey = (i: number) => () => {
    const it = shownItems[i];
    if (it) applyItem(it.id);
  };
  useHotkeys(
    {
      inventory: openInv,
      pets: () => openScreen('pets'),
      forge: openForge,
      books: () => openScreen('enchant'),
      chests: () => openScreen('cases'),
      mines: () => {
        tapLight();
        startTransition(() => setSheet('mines'));
      },
      camp: () => openCamp(),
      sell: () => sell(),
      rank: () => rankUp(),
      item1: itemKey(0),
      item2: itemKey(1),
      item3: itemKey(2),
      item4: itemKey(3),
      item5: itemKey(4),
      item6: itemKey(5),
    },
    { scope: dockRef },
  );
  useAction(
    ['tabPrev', 'tabNext'],
    (e) => {
      if (!screen) return false;
      const tabs = SCREENS[screen.key].only;
      if (tabs.length < 2 || !inTopLayer(document.querySelector('.gx-camp'))) return false;
      const i = Math.max(0, tabs.indexOf(screen.tab));
      const next = tabs[(i + (e.action === 'tabNext' ? 1 : -1) + tabs.length) % tabs.length];
      if (next) setScreen({ key: screen.key, tab: next });
      return true;
    },
    { enabled: !!screen, phases: ['down', 'repeat'] },
  );

  if (!hydrated) {
    return (
      <div className="gx pmx">
        <div className="prison-scene pxt-stone" aria-hidden="true" />
      </div>
    );
  }

  const sec = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return s < 100
      ? t('mineHud.sec', { n: s })
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const openSheet = (which: 'mines' | 'settings') => {
    tapLight();
    startTransition(() => setSheet(which));
  };
  const goForest = () => {
    if (rank < FOREST_UNLOCK_RANK && !prestige) {
      notifyWarning();
      say(t('mineHud.say.forestAt', { rank: rankLetter(FOREST_UNLOCK_RANK) }));
      return;
    }
    tapLight();
    nav('/forest');
  };
  // Полоса ранга — самое отстающее из условий.
  const rankFill = atTop
    ? progress
    : Math.min(
        progress,
        need.workNeed ? need.work / need.workNeed : 1,
        need.blocksNeed ? need.blocks / need.blocksNeed : 1,
        need.pickOk ? 1 : 0.95,
      );

  // ---- Экран шахты (UI v2, пиксельный набор) ------------------------------
  // Поле — герой: клетку меряет JS (useFieldCell) по месту, которое осталось
  // после шапки и дока. Высокий экран — всё стопкой, док внизу под пальцем;
  // широкий — поле в центре, слева сводка (деньги, ранг, серия), справа док,
  // расходники и рюкзак. Всё, что меняется (числа, значки, плашки), стоит в
  // своих местах фиксированного размера или висит поверх поля — ничего не
  // сдвигается.
  const u = shell.scale;
  const rankOk = atTop ? progress >= 1 : rankReady;

  const floorName = prison.zone.on
    ? t('mineHud.hud.floorZone')
    : t('mineHud.hud.floor', { rank: rankLetter(mine.id), rock: rockName(mine.id) });
  const floorBtn = (
    <button
      key="floor"
      type="button"
      className="mn-stat mn-stat--btn mn-floor px-f"
      {...press}
      data-tip={floorName}
      data-tip-key="mines"
      aria-label={floorName}
      onClick={() => openSheet('mines')}
    >
      <img className="mn-floor__ore" src={rockTexture(mine.id)} alt="" />
      {/* Буква — только когда этаж не тот, что у ранга (критик r2: «J J» рядом); плашка
          нейтральная: красный на этом экране — только «!». */}
      {(prison.zone.on || mine.id !== rank) && (
        <span className="mn-floor__badge">
          <Badge>
            {prison.zone.on ? <GxIcon name="stairs" size={6 * u} /> : rankLetter(mine.id)}
          </Badge>
        </span>
      )}
      <KeyHint action="mines" />
    </button>
  );

  const hud = (
    <Keep
      key="hud"
      deps={[
        getLang(),
        shownBalance,
        prison.tokens,
        prison.keys,
        rank,
        wide,
        u,
        mine.id,
        prison.zone.on,
        rank < FOREST_UNLOCK_RANK && !prestige,
      ]}
      render={() => {
        // Порядок в DOM = порядок Tab (критик r2, WCAG 2.4.3): на широком этаж и ⚙ стоят
        // в первой строке — они и в DOM раньше денег; места задают `order`/`grid-area`.
        const forestBtn = FOREST_ON && (
          <button
            key="forest"
            type="button"
            className={`px-btn px-btn--iron px-btn--icon px-f mn-hud__forest${rank < FOREST_UNLOCK_RANK && !prestige ? ' is-locked' : ''}`}
            {...press}
            aria-label={t('mineHud.hud.forest')}
            data-tip={t('mineHud.hud.forest')}
            onClick={goForest}
          >
            <GxIcon name="forest" size={9 * u} />
          </button>
        );
        const gearBtn = (
          <button
            key="gear"
            type="button"
            className="px-btn px-btn--iron px-btn--icon px-f mn-hud__gear"
            {...press}
            aria-label={t('common.settings')}
            data-tip={t('common.settings')}
            data-mine-settings=""
            onClick={() => openSheet('settings')}
          >
            <i className="px-i pxi-gear" aria-hidden="true" />
          </button>
        );
        return (
          <div className="mn-hud">
            <button
              type="button"
              className="px-btn px-btn--iron px-btn--icon px-f mn-hud__back"
              {...press}
              aria-label={t('common.back')}
              onClick={() => {
                tapLight();
                nav(-1);
              }}
            >
              <i className="px-i pxi-left" aria-hidden="true" />
            </button>
            {wide && [floorBtn, forestBtn, gearBtn]}
            <span className="mn-stat mn-stat--coins" title={t('mineHud.norm.coins')}>
              <i className="mn-coin" aria-hidden="true" />
              <MoneyCounter
                ref={moneyRef}
                value={shownBalance}
                format={chipMoney}
                className="px-num mn-stat__n"
              />
            </span>
            <button
              type="button"
              ref={tokenRef}
              className="mn-stat mn-stat--btn mn-stat--tokens px-f"
              {...press}
              aria-label={t('mineHud.hud.tokens')}
              data-tip={t('mineHud.hud.tokens')}
              onClick={() => openScreen('enchant')}
            >
              <TokenIcon size={12 * u} />
              <b className="px-num mn-stat__n">{chipCount(prison.tokens)}</b>
            </button>
            {/* Стоя ключей в шапке нет: их число — на «Сундуках» в доке, а место
                отдано деньгам и токенам (критик r2: кегль не ниже 16 px). */}
            {wide && (
              <button
                type="button"
                className="mn-stat mn-stat--btn mn-stat--keys px-f"
                {...press}
                aria-label={t('mineHud.pres.keys')}
                data-tip={t('mineHud.pres.keys')}
                onClick={() => openScreen('cases')}
              >
                <KeyIcon size={12 * u} />
                <b className="px-num mn-stat__n">{chipCount(prison.keys)}</b>
              </button>
            )}
            {!wide && [forestBtn, gearBtn]}
          </div>
        );
      }}
    />
  );

  const rankBox = (
    <button
      key="rank"
      type="button"
      className={`mn-rank px-f${rankOk ? ' is-ready' : ''}`}
      {...press}
      onClick={rankUp}
      data-tip={t('input.action.rank')}
      data-tip-key="rank"
      aria-label={
        atTop
          ? t('mineHud.hud.prestige', { n: prestige + 1 })
          : t('mineHud.hud.rank', { rank: rankLetter(rank + 1) })
      }
    >
      <span className="mn-hex px-num">{rankLetter(rank)}</span>
      <span className="mn-rank__mid">
        <Bar
          value={rankFill}
          height={11}
          className="mn-rank__bar"
          label={
            rankOk ? (
              atTop ? (
                t('mineHud.hud.prestigeGo')
              ) : (
                t('mineHud.hud.rankGo')
              )
            ) : (
              <span className={`mn-rank__cost${progress >= 1 ? ' is-ok' : ''}`}>
                {shortCount(cost)} <i className="mn-coin mn-coin--s" aria-hidden="true" />
              </span>
            )
          }
        />
        {!atTop && !rankReady && <RankBlocks need={need} floor={rank} />}
        <span className="mn-rank__needs">
          {!atTop && !rankReady && <RankChips need={need} />}
          {/* Широкий: «Новый ранг — жми!» строкой во всю ширину — в полосе между буквами
              она ломалась на три строки. */}
          {rankOk && (
            <b className="mn-rank__go" aria-hidden="true">
              {atTop ? t('mineHud.hud.prestigeGo') : t('mineHud.hud.rankGo')}
            </b>
          )}
        </span>
      </span>
      <span className="mn-hex mn-hex--next px-num">
        {atTop ? <GxIcon name="stairs" size={8 * u} /> : rankLetter(rank + 1)}
      </span>
      {rankOk && <i className="mn-rank__ready" aria-hidden="true" />}
      <KeyHint action="rank" />
    </button>
  );

  // Строка-запал: уровень кирки, серия, темп. На высоком экране — на верхней
  // кромке рамы (поле не теряет высоты), на широком — панелью слева.
  const streakBox = (
    <div
      key="strip"
      ref={stripRef}
      className={`mn-strip${sTier >= 0 ? ` is-t${sTier}` : ''}${cooling ? ' is-cooling' : ''}`}
    >
      <span className="mn-strip__pick" data-tip={t('mineHud.hud.pickLevel')}>
        <span className="mn-strip__lv">
          <PickIcon pick={pick} size={8 * u} />
          <b className="px-num">{pickLv.level}</b>
        </span>
        <Bar value={pickLv.need ? pickLv.into / pickLv.need : 1} tone="blue" height={4} />
      </span>
      <span className="mn-strip__streak">
        <span className="mn-strip__name">
          <b>{sTier >= 0 ? streakName(sTier) : t('mineHud.hud.streak')}</b>
        </span>
        {/* Огонёк и ступень — в строке полосы, а не у названия: «Легенда забоя» на 360 px
            иначе обрезалась (критик r2). */}
        <span className="mn-strip__barrow">
          <i
            className={`px-i ${roomy ? 'pxi-m-flame' : 'pxi-m-flame7'}`}
            data-hop=""
            aria-hidden="true"
          />
          <Bar value={Math.max(0, Math.min(1, streak > 0 ? sFill : 0))} height={4} />
          {sTier >= 0 && <em className="px-num">+{Math.round(STREAK_TIERS[sTier].loot * 100)}%</em>}
        </span>
      </span>
      {/* Колонка темпа шириной по самой длинной строке языка (невидимая копия в той же
          клетке): живые числа её не раздвигают и на полосу серии не залезают (R51). */}
      <span className="mn-strip__pace">
        <span className="mn-strip__ghost" aria-hidden="true">
          <span>{t('mineHud.hud.paceBlocks', { n: fmt(999) })}</span>
          <span>
            {paceCount(99_999)}
            <i className="mn-coin mn-coin--s" />
            {t('mineHud.perMin')}
          </span>
        </span>
        <span className="mn-strip__live">
          {pace ? (
            <>
              <span>{t('mineHud.hud.paceBlocks', { n: paceCount(pace.blocks) })}</span>
              <span>
                {paceCount(pace.coins)}
                <i className="mn-coin mn-coin--s" aria-hidden="true" />
                {t('mineHud.perMin')}
              </span>
            </>
          ) : (
            streak > 0 && (
              <span className="mn-strip__row">
                {t('mineHud.hud.inARow', { n: paceCount(streak) })}
              </span>
            )
          )}
        </span>
      </span>
    </div>
  );

  // Задание проводника, пока они не пройдены. Высота постоянная (критик r2, R49: поле
  // не прыгает от шага к шагу): название — до двух строк, справа — награда фишкой и счёт;
  // готово — тот же блок становится золотой кнопкой «Забрать». Фраза целиком — в подсказке,
  // по тапу — совет.
  const questTip = guide ? `${guideTitle(guide.id)} · ${rewardText(guide.reward)}` : '';
  const questBox = guide ? (
    <button
      key="quest"
      type="button"
      className={`mn-quest px-f${guideOk ? ' is-ready' : ''}`}
      {...press}
      data-tip={questTip}
      aria-label={guideOk ? `${t('mineHud.card.collect')}: ${questTip}` : questTip}
      onClick={() => {
        if (guideOk) {
          claimGuide();
          return;
        }
        tapLight();
        say(guideHint(guide.id));
      }}
    >
      <span className="mn-hex mn-hex--next px-num">{prison.guide + 1}</span>
      <span className="mn-quest__body">
        <b className="mn-quest__title">{guideTitle(guide.id)}</b>
        {!guideOk && guideGoal > 1 && <Bar value={guideV / guideGoal} tone="green" height={3} />}
      </span>
      <span className={`px-btn px-btn--sm mn-quest__end${guideOk ? ' px-btn--gold' : ''}`}>
        <RewardChip r={guide.reward} size={8 * u} />
        <span className="mn-quest__n">
          <span className={guideOk ? undefined : 'is-off'}>{t('mineHud.card.collect')}</span>
          <span className={guideOk ? 'is-off' : 'px-num'}>
            {guideGoal > 1 ? (
              `${fmt(Math.min(guideV, guideGoal))}/${fmt(guideGoal)}`
            ) : (
              <i className="px-i pxi-info" aria-hidden="true" />
            )}
          </span>
        </span>
      </span>
    </button>
  ) : null;

  // Расходники: цифры 1–6 на клавиатуре — по порядку на экране.
  const itemsRow = (
    <Keep
      key="items"
      deps={[
        getLang(),
        arming,
        roomy,
        u,
        ...shownItems.map((it) => `${it.id}:${prison.items[it.id]}`),
      ]}
      render={() => (
        <div
          className="mn-items"
          role="group"
          aria-label={t('inv.section.items')}
          data-n={shownItems.length}
        >
          {wide && <h3 className="px-h mn-side__h">{t('inv.section.items')}</h3>}
          <div className="mn-items__row">
            {shownItems.map((it, i) => {
              const n = prison.items[it.id];
              return (
                <Slot
                  key={it.id}
                  className={`mn-item${n ? '' : ' is-buy'}`}
                  empty={!n}
                  selected={arming === it.id}
                  count={n || undefined}
                  aria-label={`${itemName(it.id)}: ${n}`}
                  data-tip={itemName(it.id)}
                  data-tip-key={`item${i + 1}`}
                  onClick={() => live.current.applyItem(it.id)}
                >
                  <ItemIcon id={it.id} />
                  {!n && <i className="px-i pxi-plus mn-item__plus" aria-hidden="true" />}
                  <KeyHint action={`item${i + 1}` as Action} />
                </Slot>
              );
            })}
          </div>
        </div>
      )}
    />
  );

  // Узкая рама (320×568, 360×740 с заданием): отряд по центру нижней кромки накрывал
  // посылки — они уходят столбиком вправо, за раму (место там есть: поле упёрлось в высоту).
  const slim = !wide && cell > 0 && 7 * cell < 124 * u;
  const fieldBox = (
    <div
      key="field"
      className={`mn-field${slim ? ' is-slim' : ''}${itemsCol ? ' has-items' : ''}`}
      ref={slotRef}
    >
      <div
        ref={frameRef}
        className={`mn-frame px-panel px-panel--wood pxk-frame-wood${buffs.energy ? ' is-energy' : ''}${buffs.frenzy ? ' is-frenzy' : ''}${yardEv?.id === 'gold' ? ' is-gold' : ''}${prison.zone.on ? ' is-zone' : ''}`}
      >
        {!wide && streakBox}
        {(anyBuff || rush || yardEv || prison.zone.on) && (
          <div className="mn-buffs">
            {prison.zone.on && (
              <button
                type="button"
                className="px-btn px-btn--sm px-btn--iron px-f mn-zone-exit"
                onClick={() => {
                  tapLight();
                  prisonZoneExit();
                  say(t('mineHud.say.zoneExit'));
                }}
              >
                {t('mineHud.hud.zoneExit')}
              </button>
            )}
            {prison.zone.on && (
              <span className="mn-buff mn-buff--zone">
                <GxIcon name="hourglass" size={6 * u} />{' '}
                {clockMs(zoneLeft(prison.zone, Date.now()))}
                {ZONE_MS + prison.zone.bonus < ZONE_MAX_MS &&
                  t('mineHud.hud.zoneMore', { n: ZONE_QUOTA - (prison.zone.have % ZONE_QUOTA) })}
              </span>
            )}
            {yardEv && <EventPill ev={yardEv} now={yardNow} />}
            {rush && (
              <span className="mn-buff mn-buff--frenzy">
                <GxIcon name="paw" size={6 * u} /> {t('mineHud.hud.rush')}
              </span>
            )}
            {buffs.frenzy > 0 && (
              <span className="mn-buff mn-buff--frenzy">
                <GxIcon name="sparkles" size={6 * u} /> {sec(buffs.frenzy)}
              </span>
            )}
            {buffs.energy > 0 && (
              <span className="mn-buff mn-buff--energy">
                <ItemIcon id="energy" size={6 * u} /> {sec(buffs.energy)}
              </span>
            )}
            {buffs.lens > 0 && (
              <span className="mn-buff mn-buff--lens">
                <ItemIcon id="lens" size={6 * u} /> {sec(buffs.lens)}
              </span>
            )}
            {buffs.prop > 0 && (
              <span className="mn-buff mn-buff--prop">
                <ItemIcon id="prop" size={6 * u} /> {sec(buffs.prop)}
              </span>
            )}
          </div>
        )}
        {prison.parcels.length > 0 && (
          <div className="mn-parcels" ref={parcelsRef}>
            {prison.parcels.map((x, i) => {
              const tier = CASE_TIERS.find((t) => t.id === x.tier)!;
              const ready = x.left <= 0;
              return (
                <button
                  key={i}
                  type="button"
                  className={`mn-parcel px-f${ready ? ' is-ready' : ''}`}
                  {...press}
                  style={{ '--tier': tier.color } as CSSProperties}
                  aria-label={t(ready ? 'mineHud.hud.parcelReady' : 'mineHud.hud.parcel', {
                    tier: nameIn(chestName(tier.id)),
                  })}
                  data-tip={t(ready ? 'mineHud.hud.parcelReady' : 'mineHud.hud.parcel', {
                    tier: nameIn(chestName(tier.id)),
                  })}
                  onClick={() => openParcel(i)}
                >
                  <img src={parcelTexture(tier.color)} alt="" data-hop="" />
                  {!ready && (
                    <Bar value={1 - x.left / PARCEL_NEED[x.tier]} tone="green" height={3} />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {itemsCol && itemsRow}
        <MinePets onTrick={onPetTrick} size={petSize} />
        <MineField
          ref={field}
          gridKey={mineKey}
          cells={renderCells}
          pick={<PickIcon pick={pick} size={Math.round(cell * 0.76) || 38} />}
          rate={() => liveRate(useFinanceStore.getState().prison)}
          onHit={dig.strike}
          onTap={onFieldTap}
          className={arming ? 'is-arming' : undefined}
          under={
            <>
              {yardEv?.id === 'meteor' && (
                <div
                  className="ymeteor"
                  ref={meteorRef}
                  key={yardEv.from}
                  style={{
                    left: `${((yardEv.cell % MINE_COLS) / MINE_COLS) * 100}%`,
                    top: `${(Math.floor(yardEv.cell / MINE_COLS) / MINE_ROWS) * 100}%`,
                    width: `${100 / MINE_COLS}%`,
                    height: `${100 / MINE_ROWS}%`,
                  }}
                >
                  <i className="ymeteor__glow" />
                  <img src={meteorTexture()} alt={t('mineHud.hud.meteor')} />
                  <span className="ymeteor__pips">
                    {Array.from({ length: METEOR_HITS }, (_, k) => (
                      <i key={k} className={k < meteorN ? 'is-on' : undefined} />
                    ))}
                  </span>
                </div>
              )}
              {yardEv?.id === 'kuiva' && (
                <div
                  className="ykuiva"
                  ref={bossRef}
                  key={yardEv.from}
                  style={{
                    left: `${((yardEv.cell % MINE_COLS) / MINE_COLS) * 100}%`,
                    top: `${(Math.floor(yardEv.cell / MINE_COLS) / MINE_ROWS) * 100}%`,
                    width: `${(3 / MINE_COLS) * 100}%`,
                    height: `${(3 / MINE_ROWS) * 100}%`,
                  }}
                >
                  <img src={kuivaTexture()} alt={t('mineHud.hud.kuiva')} />
                  <span className="ykuiva__hp">
                    <i style={{ transform: `scaleX(${bossFill})` }} />
                  </span>
                </div>
              )}
            </>
          }
        >
          <BatLayer ref={batRef} host={fieldEl} onCatch={onBatCatch} />
          {sense && (
            <span
              key={sense.key}
              className="psense"
              style={{
                left: `${((sense.cell % MINE_COLS) / MINE_COLS) * 100}%`,
                top: `${(Math.floor(sense.cell / MINE_COLS) / MINE_ROWS) * 100}%`,
                width: `${100 / MINE_COLS}%`,
                height: `${100 / MINE_ROWS}%`,
              }}
            >
              <b>{sense.below ? `↓${sense.below}` : '★'}</b>
            </span>
          )}
          {yardEv?.id === 'magpie' && (
            <MagpieLayer
              key={yardEv.from}
              ref={magRef}
              ev={yardEv}
              host={fieldEl}
              canDrop={(c) => !yardShut(useFinanceStore.getState().prison).has(c)}
              onPick={pickShiny}
            />
          )}
          <TreasurePanel onGot={onTreasureGot} onLost={onRiskLost} />
          {arming && (
            <div className="pmine__arm">
              <ItemIcon id={arming} size={18} /> {t('mineHud.hud.arm')}
            </div>
          )}
          {toast && (
            <div className="pmine__toast" key={toast.id}>
              {toast.text}
            </div>
          )}
          {cardShown && (
            <div className={`pfindcard${cardLeaving ? ' is-out' : ''}`}>
              <img src={findTexture(cardShown.id)} alt="" />
              <span>
                <i>
                  {cardShown.fresh
                    ? t('mineHud.card.findNew')
                    : t('mineHud.card.findDup', { n: cardShown.n })}
                </i>
                <b>{findName(cardShown.id)}</b>
                <em>
                  {cardShown.fresh
                    ? t('mineHud.card.findNewBonus')
                    : t('mineHud.card.findDupBonus')}
                </em>
              </span>
            </div>
          )}
          {shiftShown && (
            <div className={`pshift${shiftLeaving ? ' is-out' : ''}`}>
              <i>{t('mineHud.card.shift')}</i>
              <b>
                {t('mineHud.card.shiftBlocks', {
                  n: Math.round(shiftShown.blocks),
                  coins: fmtShort(shiftShown.coins),
                })}{' '}
                <i className="mn-coin mn-coin--s" aria-hidden="true" />
              </b>
              <em>
                +{fmt(shiftShown.tokens)} ✦
                {shiftShown.keys ? t('mineHud.card.shiftKeys', { n: shiftShown.keys }) : ''}
              </em>
            </div>
          )}
          {crewNote && crewNow.blocks > 0 && (
            <div className="pcrewnote">
              <span>
                <b>{t('mineHud.card.crewDug', { n: Math.round(crewNow.blocks) })}</b>
                <i>
                  {t('mineHud.card.crewLine', {
                    coins: fmtShort(crewNow.coins),
                    tokens: fmt(crewNow.tokens),
                  })}
                  {crewNow.capped ? t('mineHud.card.crewCapped') : ''}
                </i>
              </span>
              <button type="button" className="btn btn--sm pmines__go" onClick={collectCrew}>
                {t('mineHud.card.collect')}
              </button>
              <button
                type="button"
                className="pcrewnote__x"
                aria-label={t('mineHud.card.later')}
                onClick={() => setCrewNote(false)}
              >
                ×
              </button>
            </div>
          )}
        </MineField>
      </div>
    </div>
  );

  const bagBox = (
    <Keep
      key="bag"
      deps={[getLang(), full, !!cart, count, cap, value, u]}
      render={() => (
        <button
          type="button"
          ref={bagRef}
          className={`mn-bag px-f${full ? ' is-full' : ''}${cart ? ' has-cart' : ''}`}
          {...press}
          onClick={() => live.current.sell()}
          aria-label={t('input.action.sell')}
          data-tip={t('input.action.sell')}
          data-tip-key="sell"
        >
          <span className="mn-bag__ico">
            <i className="mn-pic mn-pic--bag" data-hop="" aria-hidden="true" />
            {full && (
              <span className="mn-bag__badge">
                <Badge>!</Badge>
              </span>
            )}
          </span>
          <span className="mn-bag__mid">
            <span className="mn-bag__title">{t('inv.lim.bag')}</span>
            <Bar
              value={count / cap}
              tone={full ? 'gold' : 'green'}
              height={11}
              className="mn-bag__bar"
              label={<span>{`${count} / ${cap}`}</span>}
            />
          </span>
          <span
            className={`px-btn px-btn--sm ${count && value ? 'px-btn--gold' : 'px-btn--iron'} mn-bag__sell`}
          >
            {count && value ? (
              <>
                <span>{t('mineHud.bag.sell', { sum: fmtShort(value) })}</span>
                <i className="mn-coin mn-coin--s" aria-hidden="true" />
              </>
            ) : count ? (
              <>
                <GxIcon name="anvil" size={7 * u} /> <span>{t('mineHud.bag.toBox')}</span>
              </>
            ) : (
              <span>{t('mineHud.bag.empty')}</span>
            )}
          </span>
          <KeyHint action="sell" />
        </button>
      )}
    />
  );

  // Док (v2.67 → UI v2): шесть крупных кнопок под большим пальцем. Каждая
  // открывает свой экран; горячие клавиши — на кнопках (клавиатура, геймпад).
  const nestReady = prison.nest.some((x) => x.left <= 0);
  const pet0 = prison.squad[0];
  const dock = (
    <Keep
      key="dock"
      deps={[
        getLang(),
        forgeReady,
        enchReady,
        prison.keys,
        pet0,
        petLook(prison.pets[pet0]),
        nestReady,
        campBadge,
        dockIco,
        pick,
      ]}
      render={() => (
        <nav ref={dockRef} className="mn-dock px-dark" aria-label={t('mineHud.dock.camp')}>
          <button
            type="button"
            ref={forgeRef}
            className={`px-btn px-btn--iron px-f mn-dock__btn${forgeReady ? ' is-ready' : ''}`}
            {...press}
            data-tip={t('input.action.forge')}
            data-tip-key="forge"
            onClick={openForge}
          >
            <span className="mn-dock__ico" data-hop="">
              <PickIcon pick={pick} size={dockIco} />
            </span>
            <DockLabel text={t('mineHud.dock.forge')} />
            {forgeReady && (
              <span className="mn-dock__badge">
                <Badge gold>!</Badge>
              </span>
            )}
            <KeyHint action="forge" />
          </button>
          <button
            type="button"
            className="px-btn px-btn--iron px-f mn-dock__btn"
            {...press}
            data-tip={t('input.action.books')}
            data-tip-key="books"
            onClick={() => openScreen('enchant')}
          >
            <span className="mn-dock__ico">
              <i className="mn-pic mn-pic--books" aria-hidden="true" />
            </span>
            <DockLabel text={t('mineHud.dock.books')} />
            {enchReady && (
              <span className="mn-dock__badge">
                <Badge>!</Badge>
              </span>
            )}
            <KeyHint action="books" />
          </button>
          <button
            type="button"
            ref={chestRef}
            className="px-btn px-btn--iron px-f mn-dock__btn"
            {...press}
            data-tip={t('input.action.chests')}
            data-tip-key="chests"
            onClick={() => openScreen('cases')}
          >
            <span className="mn-dock__ico" data-hop="">
              <ChestIcon size={dockIco} />
            </span>
            <DockLabel text={t('mineHud.dock.chests')} />
            {prison.keys > 0 && (
              <span className="mn-dock__badge">
                <Badge gold>{shortCount(prison.keys)}</Badge>
              </span>
            )}
            <KeyHint action="chests" />
          </button>
          <button
            type="button"
            className="px-btn px-btn--iron px-f mn-dock__btn"
            {...press}
            data-tip={t('input.action.pets')}
            data-tip-key="pets"
            onClick={() => openScreen('pets')}
          >
            <span className="mn-dock__ico" ref={petRef}>
              {prison.squad[0] ? (
                <PetArt
                  id={prison.squad[0]}
                  size={dockIco}
                  v={petLook(prison.pets[prison.squad[0]])}
                  still
                />
              ) : (
                <i className="px-i pxi-paw mn-dock__mask" aria-hidden="true" />
              )}
            </span>
            <DockLabel text={t('mineHud.dock.pets')} />
            {nestReady && (
              <span className="mn-dock__badge">
                <Badge>!</Badge>
              </span>
            )}
            <KeyHint action="pets" />
          </button>
          <button
            type="button"
            className="px-btn px-btn--iron px-f mn-dock__btn"
            {...press}
            data-tip={t('input.action.inventory')}
            data-tip-key="inventory"
            onClick={openInv}
          >
            <span className="mn-dock__ico">
              <i className="mn-pic mn-pic--inv" aria-hidden="true" />
            </span>
            <DockLabel text={t('input.action.inventory')} />
            <KeyHint action="inventory" />
          </button>
          <button
            type="button"
            className="px-btn px-btn--iron px-f mn-dock__btn"
            {...press}
            data-tip={t('input.action.camp')}
            data-tip-key="camp"
            onClick={openCamp}
          >
            <span className="mn-dock__ico">
              <i className="mn-pic mn-pic--camp" aria-hidden="true" />
            </span>
            <DockLabel text={t('mineHud.dock.camp')} />
            {campBadge && (
              <span className="mn-dock__badge">
                <Badge>!</Badge>
              </span>
            )}
            <KeyHint action="camp" />
          </button>
        </nav>
      )}
    />
  );

  const layout = wide
    ? [
        <div key="l" className="mn-side mn-side--l">
          {hud}
          {/* Обёртка — контейнер `mnrank`: по её ширине рамка ранга выбирает раскладку условий. */}
          <div className="mn-rankwrap">{rankBox}</div>
          <div className="mn-panel">{streakBox}</div>
          {questBox}
          {itemsRow}
          {roomy && bagBox}
        </div>,
        fieldBox,
        <div key="r" className="mn-side mn-side--r">
          {!roomy && bagBox}
          {dock}
        </div>,
      ]
    : [
        hud,
        <div key="rankrow" className="mn-rankrow">
          {floorBtn}
          {rankBox}
        </div>,
        questBox,
        fieldBox,
        !itemsCol && itemsRow,
        bagBox,
        dock,
      ];

  return (
    <div
      ref={rootRef}
      className={`gx px mn ${wide ? 'mn--wide' : 'mn--tall'}${screen || forgeOpen || invOpen ? ' is-under' : ''}`}
      style={cell ? ({ '--cell': `${cell}px` } as CSSProperties) : undefined}
    >
      <div className="prison-scene pxt-stone" aria-hidden="true" />
      {layout}

      {/* The books open as a full-screen window, like the forge and the backpack (UI wave 2). */}
      {screen?.key === 'enchant' && <BooksTab onClose={() => setScreen(null)} />}
      {screen && screen.key !== 'enchant' && (
        <PrisonCamp
          place="mine"
          only={SCREENS[screen.key].only}
          title={t(SCREENS[screen.key].title)}
          tab={screen.tab}
          onTab={(t) => setScreen({ key: screen.key, tab: t })}
          onClose={() => setScreen(null)}
          onGain={rollBalance}
          onSpend={settleBalance}
        />
      )}
      {forgeOpen && <ForgeScreen onClose={() => setForgeOpen(false)} onSpend={settleBalance} />}
      {invOpen && (
        <Inventory place="mine" onClose={() => setInvOpen(false)} onUse={(id) => applyItem(id)} />
      )}

      {sheet === 'mines' && (
        <GxModal title={t('mineHud.floors.title')} onClose={() => setSheet(null)}>
          <div className="px mn-sheet mn-mines">
            {Array.from({ length: Math.min(LAST_RANK, rank + 1) + 1 }, (_, id) => {
              const locked = id > rank;
              const here = id === mine.id && !prison.zone.on;
              const band = HORIZONS.find((h) => h.from === id);
              return (
                <div key={id} className="mn-mines__item">
                  {band && (
                    <h3 className="px-h px-h--sub mn-mines__band">
                      {horizonName(HORIZONS.indexOf(band))}
                    </h3>
                  )}
                  <div
                    className={`mn-mines__row${here ? ' is-here' : ''}${locked ? ' is-locked' : ''}`}
                  >
                    <span className={`mn-hex${locked ? ' mn-hex--next' : ''}`}>
                      {rankLetter(id)}
                    </span>
                    <img className="mn-mines__ore" src={blockTexture(id)} alt="" />
                    <span className="mn-mines__info">
                      <b>
                        {rockName(id)}{' '}
                        <em className={`mn-mines__hard${canMine(pick, id) ? '' : ' is-no'}`}>
                          ⛏{rockHardness(id)}
                        </em>
                      </b>
                      <span className="mn-mines__price">
                        {t('mineHud.floors.price', {
                          ore: String(ROCKS[id].value),
                          block: fmtShort(ROCKS[id].block),
                        })}
                      </span>
                    </span>
                    {locked ? (
                      <i className="px-i pxi-lock mn-mines__lock" aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className={`px-btn px-btn--sm ${here ? 'px-btn--iron' : 'px-btn--gold'} px-f`}
                        onClick={() => goMine(id)}
                      >
                        {here ? (
                          <>
                            <GxIcon name="cycle" size={7 * u} /> {t('mineHud.floors.again')}
                          </>
                        ) : (
                          t('mineHud.floors.down')
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </GxModal>
      )}

      {sheet === 'settings' && (
        <GameSettings
          initial="progress"
          onClose={() => {
            setSheet(null);
            setWipe(null);
          }}
          progress={
            <>
              <div className="mn-wipe">
                <button
                  type="button"
                  className={`px-btn px-btn--wide ${wipe === 'prison' ? 'px-btn--red' : 'px-btn--iron'} px-f`}
                  onClick={() => doWipe('prison')}
                >
                  {wipe === 'prison'
                    ? t('settings.progress.wipePrisonSure')
                    : t('settings.progress.wipePrison')}
                </button>
                <p>{t('settings.progress.wipePrisonNote')}</p>
                <button
                  type="button"
                  className={`px-btn px-btn--wide ${wipe === 'all' ? 'px-btn--red' : 'px-btn--iron'} px-f`}
                  onClick={() => doWipe('all')}
                >
                  {wipe === 'all'
                    ? t('settings.progress.wipeAllSure')
                    : t('settings.progress.wipeAll')}
                </button>
                <p>{t('settings.progress.wipeAllNote')}</p>
              </div>
              <div className="pcash">
                <CashDesk />
              </div>
            </>
          }
        />
      )}

      {sheet === 'norm' && !atTop && (
        <GxModal
          title={t('mineHud.hud.rank', { rank: rankLetter(rank + 1) })}
          onClose={() => setSheet(null)}
        >
          <div className="px mn-sheet mn-norm">
            {needPick > 0 && (
              <div className={`mn-norm__row${pickOk ? ' is-done' : ''}`}>
                <span className="mn-norm__ico">
                  <PickIcon pick={needPick} size={16 * u} />
                </span>
                <span className="mn-norm__info">
                  <b>
                    {t('mineHud.norm.pick', {
                      power: need.power,
                      name: nameIn(pickName(needPick)),
                    })}
                  </b>
                  {pickOk ? (
                    <Bar
                      tone="green"
                      value={1}
                      height={10}
                      label={<i className="px-i pxi-check" aria-hidden="true" />}
                    />
                  ) : (
                    <button
                      type="button"
                      className="px-btn px-btn--sm px-btn--gold px-f mn-norm__go"
                      onClick={() => {
                        tapLight();
                        setSheet(null);
                        setForgeOpen(true);
                      }}
                    >
                      <GxIcon name="anvil" size={7 * u} /> {t('mineHud.norm.toForge')}
                    </button>
                  )}
                </span>
              </div>
            )}
            {need.workNeed > 0 && (
              <div className={`mn-norm__row${workOk ? ' is-done' : ''}`}>
                <span className="mn-norm__ico">
                  <PickIcon pick={pick} size={16 * u} />
                </span>
                <span className="mn-norm__info">
                  <b>{t('mineHud.norm.work')}</b>
                  <Bar
                    tone={workOk ? 'green' : 'gold'}
                    value={need.work / need.workNeed}
                    height={10}
                    label={
                      workOk ? (
                        <i className="px-i pxi-check" aria-hidden="true" />
                      ) : (
                        `${fmt(need.work)} / ${fmt(need.workNeed)}`
                      )
                    }
                  />
                </span>
              </div>
            )}
            {need.blocksNeed > 0 && (
              <div className={`mn-norm__row${need.blocks >= need.blocksNeed ? ' is-done' : ''}`}>
                <span className="mn-norm__ico">
                  <img src={blockTexture(rank)} alt="" />
                </span>
                <span className="mn-norm__info">
                  <b>
                    {blockName(rank)} · {fmtShort(blockValue(rank))}
                  </b>
                  <Bar
                    tone={need.blocks >= need.blocksNeed ? 'green' : 'gold'}
                    value={need.blocks / need.blocksNeed}
                    height={10}
                    label={
                      need.blocks >= need.blocksNeed ? (
                        <i className="px-i pxi-check" aria-hidden="true" />
                      ) : (
                        `${need.blocks} / ${need.blocksNeed}`
                      )
                    }
                  />
                  {need.blocks < need.blocksNeed && mine.id === rank && (
                    <i className="mn-norm__sub">
                      {t('mineHud.norm.pity', { n: Math.round(pityLeft) })}
                    </i>
                  )}
                </span>
              </div>
            )}
            <div className={`mn-norm__row${balance >= cost ? ' is-done' : ''}`}>
              <span className="mn-norm__ico">
                <i className="mn-coin" aria-hidden="true" />
              </span>
              <span className="mn-norm__info">
                <b>{t('mineHud.norm.coins')}</b>
                <Bar
                  tone={balance >= cost ? 'green' : 'gold'}
                  value={progress}
                  height={10}
                  label={
                    balance >= cost ? (
                      <i className="px-i pxi-check" aria-hidden="true" />
                    ) : (
                      `${fmtShort(balance)} / ${fmtShort(cost)}`
                    )
                  }
                />
              </span>
            </div>
            <div className="mn-norm__actions">
              <button
                type="button"
                className="px-btn px-btn--gold px-btn--wide px-f"
                disabled={!qDone || balance < cost}
                aria-disabled={!qDone || balance < cost || undefined}
                onClick={() => takeRank(false)}
              >
                {t('mineHud.norm.take', { rank: rankLetter(rank + 1) })}
              </button>
              {workOk && buyout > 0 && (
                <button
                  type="button"
                  className="px-btn px-btn--iron px-btn--wide px-f"
                  disabled={balance < cost + buyout}
                  aria-disabled={balance < cost + buyout || undefined}
                  onClick={() => takeRank(true)}
                >
                  {t(
                    need.blocksNeed - need.blocks > 1
                      ? 'mineHud.norm.buyBlocks'
                      : 'mineHud.norm.buyBlock',
                    {
                      sum: fmtShort(buyout),
                    },
                  )}{' '}
                  <i className="mn-coin mn-coin--s" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </GxModal>
      )}

      {reveal && <ParcelReveal open={reveal} onClose={() => setReveal(null)} />}

      {sheet === 'prestige' && (
        <GxModal
          title={t('mineHud.hud.prestige', { n: prestige + 1 })}
          onClose={() => setSheet(null)}
        >
          <div className="px mn-sheet mn-pres">
            <div className="mn-pres__swap">
              <span className="mn-hex">Z</span>
              <i className="px-i pxi-right" aria-hidden="true" />
              <span className="mn-hex mn-hex--next">
                {rankLetter(Math.min(LAST_RANK - 1, prison.perks.blat))}
              </span>
            </div>
            <div className="mn-pres__row">
              <GxIcon name="coins-pile" size={11 * u} />
              <span>{t('mineHud.pres.sell')}</span>
              <b>
                ×{sellMult(prestige).toFixed(2)} → ×{sellMult(prestige + 1).toFixed(2)}
              </b>
            </div>
            <div className="mn-pres__row">
              <GxIcon name="upgrade" size={11 * u} />
              <span>{t('mineHud.pres.points')}</span>
              <b>+2</b>
            </div>
            <div className="mn-pres__row">
              <KeyIcon size={11 * u} />
              <span>{t('mineHud.pres.keys')}</span>
              <b>+5</b>
            </div>
            <div className="mn-pres__keep">
              <span>{t('mineHud.pres.keep')}</span>
              <GxIcon name="pick" size={9 * u} />
              <GxIcon name="magic" size={9 * u} />
              <TokenIcon size={8 * u} />
              <GxIcon name="backpack" size={9 * u} />
              <GxIcon name="miner" size={9 * u} />
              <GxIcon name="trophy" size={9 * u} />
            </div>
            <button
              type="button"
              className="px-btn px-btn--gold px-btn--wide px-f"
              disabled={balance < prestigeCost(prestige)}
              aria-disabled={balance < prestigeCost(prestige) || undefined}
              onClick={prestigeNow}
            >
              {t('mineHud.pres.go', { sum: fmtShort(prestigeCost(prestige)) })}{' '}
              <i className="mn-coin mn-coin--s" aria-hidden="true" />
            </button>
          </div>
        </GxModal>
      )}

      {sceneShown && (
        <div
          className={`prank${sceneLeaving ? ' is-out' : ''}`}
          onClick={() => {
            tapLight();
            setRankScene(null);
          }}
        >
          <div className="prank__card">
            <span className="prank__label px-ribbon">
              {horizonOf(sceneShown.rank).from === sceneShown.rank
                ? horizonName(HORIZONS.indexOf(horizonOf(sceneShown.rank)))
                : t('mineHud.scene.rank')}
            </span>
            <b className="prank__letter">{rankLetter(sceneShown.rank)}</b>
            {/* Этаж, цена руды, цена блока — строкой значков; фраза целиком — для чтеца. */}
            <span
              className="prank__mine"
              role="img"
              aria-label={t('mineHud.scene.mine', {
                rank: rankLetter(sceneShown.rank),
                rock: nameIn(rockName(sceneShown.rank)),
                ore: String(ROCKS[sceneShown.rank].value),
                block: fmtShort(ROCKS[sceneShown.rank].block),
              })}
            >
              <span>
                <img src={rockTexture(sceneShown.rank)} alt="" />
                {rankLetter(sceneShown.rank)}
              </span>
              <span>
                <i className="mn-coin" aria-hidden="true" />
                {fmt(ROCKS[sceneShown.rank].value)}
              </span>
              <span>
                <img src={blockTexture(sceneShown.rank)} alt="" />
                {fmtShort(ROCKS[sceneShown.rank].block)}
              </span>
            </span>
            <span className="prank__key">
              <KeyIcon size={10 * u} /> {t('mineHud.scene.key')}
            </span>
            {FOREST_ON && sceneShown.rank === FOREST_UNLOCK_RANK && (
              <span className="prank__lvl">{t('mineHud.scene.forest')}</span>
            )}
            {sceneShown.buyout > 0 && (
              <span className="prank__lvl">
                {t('mineHud.scene.buyout', { n: Math.round(sceneShown.buyout) })}
              </span>
            )}
            {sceneShown.levelUps.length > 0 && (
              <span className="prank__lvl">
                {t('mineHud.scene.level', {
                  n: sceneShown.levelUps[sceneShown.levelUps.length - 1],
                })}
              </span>
            )}
            <span className="prank__cta px-btn px-btn--gold px-f">{t('mineHud.scene.toMine')}</span>
          </div>
        </div>
      )}
      <EventAnnounce ev={yardSplash} onDone={closeSplash} />
    </div>
  );
}

/** Широкий экран: меньше этого (в пикселях арта) боковой колонке не дать. */
const SIDE_MIN_U = 84;
/** Зазор между колонками, в пикселях арта (как `gap` у `.mn--wide`). */
const SIDE_GAP_U = 4;

/**
 * Клетка поля в целых пикселях: самая крупная, при которой 7×9 клеток с
 * рамой влезают в место под поле. Высокий экран — место = ячейка `.mn-field`
 * (растягивается между шапкой и доком), широкий — высота ячейки и ширина
 * экрана минус две боковые колонки. Рама меряется с поля: ширина рамы минус
 * ширина сетки, поэтому толщина рамы в CSS может меняться.
 */
function useFieldCell(
  root: RefObject<HTMLDivElement>,
  slot: RefObject<HTMLDivElement>,
  frame: RefObject<HTMLDivElement>,
  wide: boolean,
  scale: number,
): number {
  const [cell, setCell] = useState(0);
  useLayoutEffect(() => {
    const r = root.current;
    const s = slot.current;
    const f = frame.current;
    if (!r || !s || !f) return undefined;
    const measure = () => {
      const grid = f.querySelector<HTMLElement>('.pmine');
      if (!grid || !grid.offsetWidth) return;
      const cw = f.offsetWidth - grid.offsetWidth;
      const ch = f.offsetHeight - grid.offsetHeight;
      const ss = getComputedStyle(s);
      const H = s.clientHeight - parseFloat(ss.paddingTop) - parseFloat(ss.paddingBottom);
      let W = s.clientWidth - parseFloat(ss.paddingLeft) - parseFloat(ss.paddingRight);
      if (wide) {
        const rs = getComputedStyle(r);
        const inner = r.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight);
        W = inner - 2 * (SIDE_MIN_U + SIDE_GAP_U) * scale;
      }
      const c = Math.floor(Math.min((W - cw) / 7, (H - ch) / 9));
      // Нижний предел 12, а не 20: на 320×568 рама с клеткой 20 налезала на расходники
      // на 20 px — поле всегда влезает в своё место.
      setCell(Math.max(12, Math.min(160, c)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(r);
    ro.observe(s);
    return () => ro.disconnect();
  }, [root, slot, frame, wide, scale]);
  return cell;
}

/** Перерисовка раз в секунду, пока `on` — для таймеров баффов. */
function useTicker(on: boolean): void {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}
