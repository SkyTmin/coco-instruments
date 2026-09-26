import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GxBar, GxIcon, GxModal, KIcon } from '@/components/gx';
import { CashDesk } from '@/components/CashDesk';
import { crackStage, MineCell, MineField, useMineDig, wall } from '@/components/MineField';
import type { BreakKind, DigBlock, MineFieldHandle } from '@/components/MineField';
import { useNavigate } from 'react-router-dom';
import { FOREST_UNLOCK_RANK } from '@/lib/forest';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon } from '@/components/slot-art';
import {
  ItemIcon,
  KeyIcon,
  ParcelReveal,
  PickIcon,
  PrisonCamp,
  rewardLabel,
  TokenIcon,
} from '@/components/PrisonCamp';
import type { CampTab } from '@/components/PrisonCamp';
import { ForgeScreen, forgeReadyNow } from '@/components/ForgeScreen';
import { EventAnnounce, EventPill, endText, prizeSay, useYardEvent } from '@/components/YardBits';
import { BatLayer, MagpieLayer, TreasurePanel } from '@/components/Critters';
import type { BatHandle, MagpieHandle } from '@/components/Critters';
import { BAT_GAP_MS, BAT_RARE, batRoll } from '@/lib/critters';
import type { ShinyKind } from '@/lib/critters';
import { useFinanceStore } from '@/store';
import type { ParcelOpen, PrisonLoot, PrisonRankUp, TreasureGot } from '@/store';
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
  ENCHANT_UNLOCK,
  ENCHANTS,
  enchantCap,
  enchantCost,
  ENERGY_RATE,
  findOf,
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
  shortMoney,
  STREAK_GRACE_MS,
  STREAK_DECAY_MS,
  STREAK_TIERS,
  streakTier,
  veinCells,
  CASE_TIERS,
  milesReady,
  PARCEL_NEED,
  petLevelOf,
  petOf,
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
  petTexture,
  seidTexture,
  rockColors,
  rockTexture,
  rockVariant,
} from '@/lib/prison-art';
import { plainPlan, runRollup } from '@/lib/rollup';
import { rarityOf } from '@/lib/rarity';
import { flashFrame, squashPop, stopShake } from '@/lib/juice';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { useExit } from '@/lib/use-exit';
import { useGameAudio } from '@/lib/use-game-audio';
import { AudioToggles } from '@/components/AudioToggles';
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
import { moneyText } from '@/lib/money';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
/** Коротко для узкой ячейки табло: 12 345 → «12,3к». */
const shortCount = (n: number) =>
  n < 1e4
    ? fmt(n)
    : n < 1e6
      ? `${(Math.floor(n / 100) / 10).toLocaleString('ru-RU')}к`
      : `${(Math.floor(n / 1e5) / 10).toLocaleString('ru-RU')}м`;

/**
 * Монеты в шапке шахты: до ста тысяч — целиком, дальше «123,4к» и «12,3м»,
 * как токены рядом. Шапка — одна строка на всё (v2.67.2): «999 999», как и
 * «12,3 млн», на экране 375 px в неё уже не влезают.
 */
const chipMoney = (n: number) => (n >= 1e5 ? shortCount(n) : moneyText(n));

/** Минуты и секунды: 7:05. */
const clockMs = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Скорость кирки прямо сейчас: перки, энергетик, кураж. */
function liveRate(p: PrisonState): number {
  const now = Date.now();
  const base = PICKS[p.pick].rate * modsOf(p).rate;
  let r = base;
  if (now < p.energyUntil) r *= ENERGY_RATE;
  if (now < p.frenzyUntil) r *= FRENZY_RATE;
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
  if (r.coins) out.push(`+${fmt(r.coins)} монет`);
  if (r.tokens) out.push(`+${fmt(r.tokens)} токенов`);
  if (r.keys) out.push(r.keys > 1 ? `+${r.keys} ключа` : '+ключ');
  if (r.item) {
    const it = ITEMS.find((i) => i.id === r.item![0])!;
    out.push(`${it.name.toLowerCase()}${r.item[1] > 1 ? ` ×${r.item[1]}` : ''}`);
  }
  if (r.rune) out.push(`руна ${RUNE_ROMAN[r.rune - 1]}`);
  if (r.pet) out.push(petOf(r.pet).name.toLowerCase());
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
const SCREENS: Record<Screen, { only: CampTab[]; title: string }> = {
  enchant: { only: ['enchant'], title: 'Чары' },
  cases: { only: ['cases'], title: 'Сундуки' },
  pets: { only: ['pets'], title: 'Питомцы' },
  more: { only: ['crew', 'runes', 'shop', 'finds', 'miles', 'perks'], title: 'Лагерь' },
};

/** Условия ранга фишками: кирка, выработка (блоков сломано) и блоки этажа. */
function RankChips({ need, floor }: { need: RankNeeds; floor: number }) {
  const workOk = need.work >= need.workNeed;
  const blocksOk = need.blocks >= need.blocksNeed;
  return (
    <span className="pquota">
      {!need.pickOk && (
        <span className="pquota__chip is-pick">
          <GxIcon name="anvil" size={12} />⛏{need.power}
        </span>
      )}
      {need.workNeed > 0 && (
        <span className={`pquota__chip${workOk ? ' is-done' : ''}`}>
          <GxIcon name="pick" size={12} />
          {workOk ? '✓' : `${shortMoney(need.work)}/${shortMoney(need.workNeed)}`}
        </span>
      )}
      {need.blocksNeed > 0 && (
        <span className={`pquota__chip${blocksOk ? ' is-done' : ''}`}>
          <img src={blockTexture(floor)} alt={ROCKS[floor].blockName} />
          {blocksOk ? '✓' : `${need.blocks}/${need.blocksNeed}`}
        </span>
      )}
    </span>
  );
}

export function PrisonPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const prison = useFinanceStore((s) => s.prison);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
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
  const openScreen = (key: Screen, tab?: CampTab) => {
    tapLight();
    setScreen({ key, tab: tab ?? SCREENS[key].only[0] });
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
  const petRef = useRef<HTMLImageElement>(null);
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
    if (!hydrated) return;
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
    field.current?.fly(c, rockTexture(rock), bagRef.current, () => squashPop(bagRef.current, 0.22));

  const scheduleReset = () => {
    if (resetTimer.current) return;
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      const st = useFinanceStore.getState().prison;
      if (minedShare(st.mine.dug) < MINE_RESET_AT) return;
      mineRumble();
      tapMedium();
      field.current?.trauma(0.3);
      say('Шахта обновилась');
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
  const streakUp = (t: number, c: number) => {
    const tier = STREAK_TIERS[t];
    const first = t + 1 > useFinanceStore.getState().prison.bestStreak;
    prisonStreak(t);
    floatText(c, `${tier.name.toUpperCase()}!`, 'pfloat--streak');
    tierBreak(Math.min(3, t));
    tapMedium();
    squashPop(stripRef.current, 0.35 + 0.1 * t);
    if (t >= 3) field.current?.trauma(0.2);
    if (first)
      say(`«${tier.name}»: +${Math.round(tier.loot * 100)}% к добыче, пока бьёшь без пауз`);
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
    const played = playTotem(chestRef.current, () => squashPop(chestRef.current, 0.6));
    if (!played) {
      floatText(c, n > 1 ? `+${n} ключа` : '+ключ', 'pfloat--key', 120);
      return;
    }
    tapMedium();
    if (n > 1) say(`${n} ключа от сундука!`);
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
      const opened = ENCHANTS.filter((e) =>
        res.pickUps.some((u) => ENCHANT_UNLOCK[e.id] === u.level),
      );
      floatText(c, `КИРКА ${up.level}`, 'pfloat--level', 180);
      softChime(2);
      notifySuccess();
      const tokens = res.pickUps.reduce((x, u) => x + u.tokens, 0);
      const keys = res.pickUps.reduce((x, u) => x + u.keys, 0);
      say(
        opened.length
          ? `Кирка ${up.level} ур. · открыта чара «${opened[opened.length - 1].name}»`
          : `Кирка ${up.level} ур. · +${fmt(tokens)} ✦${keys ? ' · +ключ' : ''}`,
      );
    }
    if (res.parcels.length) {
      floatText(c, 'ПОСЫЛКА', 'pfloat--parcel', 200);
      softChime(1);
      tapMedium();
      squashPop(parcelsRef.current, 0.5);
    }
    if (res.parcelTokens) floatText(c, `+${res.parcelTokens} ✦`, 'pfloat--token', 260);
    if (res.parcelsReady) {
      notifySuccess();
      keyFound();
      say('Посылка дозрела — вскрой её');
    }
    if (res.petUp) {
      const st = useFinanceStore.getState().prison;
      if (st.pet) say(`${petOf(st.pet).name}: ${res.petUp} уровень`);
      softChime(2);
      squashPop(petRef.current, 0.6);
    }
    if (res.normDone) {
      tierBreak(2);
      notifySuccess();
      burstConfetti(40, ['#9be38a', '#ffe08a', '#fff']);
      say('Выработка набрана');
    }
    if (res.lost > 0 && now - fullWarnAt.current > 4000) {
      fullWarnAt.current = now;
      bagFullSound();
      notifyWarning();
      say('Рюкзак полон — продай добычу');
      squashPop(bagRef.current, 0.5);
    }
    if (res.sold) {
      // Вагонетка сама отвезла рюкзак.
      const to = useFinanceStore.getState().slotsBalance;
      rollBalance(to - res.sold, to);
      coinDing();
      floatText(c, `+${shortMoney(res.sold)}`, 'pfloat--coin');
    }
    // Вагонетка (или спецзона) отложила руду для кирки — кузница кивнула.
    if (res.boxed > 0) squashPop(forgeRef.current, 0.45);
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
      const name = ROCKS[after.mine.id].blockName;
      floatText(opened.cell, `${name.toUpperCase()}!`, 'pfloat--block', 80);
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
      if (single) floatText(f.cell, `⚙ ${ROCKS[f.rock].name}`, 'pfloat--reforge', 120);
    }
    // Гарантия: долго не было блока этажа — он встал сам, это надо увидеть.
    if (res.pityBlock >= 0) {
      const cb = res.pityBlock;
      floatText(cb, 'ГАРАНТИЯ!', 'pfloat--block', 140);
      field.current?.chips(cb, [...rockColors(after.mine.id), '#ffffff', '#ffe08a'], 24, 1.6);
      field.current?.shockwave(cb, 2, false);
      field.current?.rise(cb);
      tierBreak(2);
      notifySuccess();
      say(`${ROCKS[after.mine.id].blockName} встал по гарантии — вон он, блестит`);
    }
    list.forEach((b, i) => {
      if (res.taken > 0 && i < (single ? 1 : 4)) flyLoot(b.cell, b.rock);
      // Порода следующей шахты на дне — находка, о ней стоит сказать.
      if (single && b.rock > st.mine.id) floatText(b.cell, ROCKS[b.rock].name, 'pfloat--find');
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
    floatText(c, rare ? 'СИНЯЯ!' : 'ПОЙМАЛ', rare ? 'pfloat--seid' : 'pfloat--streak');
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
    if (v.coins) floatText(c, `+${shortMoney(v.coins)}`, 'pfloat--coin');
    if (v.tokens) {
      floatText(c, `+${v.tokens} ✦`, 'pfloat--token');
      squashPop(tokenRef.current, 0.3);
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
      squashPop(tokenRef.current, 0.6);
      say(`+${fmt(r.amount)} токенов`);
    } else if (r.kind === 'keys') {
      keyFound();
      squashPop(chestRef.current, 0.6);
      say(r.amount > 1 ? `+${r.amount} ключа от сундука` : '+ключ от сундука');
    } else if (r.kind === 'rune') {
      tierBreak(2);
      say(
        got.shattered
          ? `Мешочек рун полон — руна разбита на ${got.shattered} ✦`
          : `${rewardLabel(r)} — в мешочке рун`,
      );
    } else {
      tierBreak(1);
      say(`${rewardLabel(r)} — в ряду расходников`);
    }
  };

  const onRiskLost = (stake: number) => {
    field.current?.trauma(0.25);
    say(`Сгорело: ${shortMoney(stake)}. В другой раз повезёт`);
  };

  /** Звон о руду твёрже кирки: подсказка, какая кирка её берёт. */
  const onHardOre = (c: number, power: number) => {
    floatText(c, `⛏${power}`, 'pfloat--hard');
    const now = Date.now();
    if (now - hardSayAt.current < 6000) return;
    hardSayAt.current = now;
    const need = PICKS.find((x) => !x.prestige && x.power >= power);
    say(
      `Не берёт! Нужна ${need ? need.name.toLowerCase() : 'кирка сильнее'} кирка ⛏${power} — кузница внизу`,
    );
  };

  const startFrenzy = (c: number) => {
    prisonFrenzy();
    frenzyStart();
    notifySuccess();
    floatText(c, 'КУРАЖ!', 'pfloat--frenzy');
    say('Кураж: 15 секунд двойной добычи');
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
      if (crit) floatText(c, 'КРИТ', 'pfloat--crit');
      f?.wobble(c);
      return;
    }
    hp[c] = -1;
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
    say(`Сейд-камень: +${fmt(got.tokens)} токенов, +${shortMoney(got.coins)} монет`);
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
      if (crit) floatText(c, 'КРИТ', 'pfloat--crit');
      f?.wobble(c);
      return;
    }
    hp[c] = -1;
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
    floatText(c, `+${shortMoney(got.coins)}`, 'pfloat--block', 0);
    say(
      `${ROCKS[floor].blockName}: +${fmt(got.coins)} монет${got.own ? '' : ' (для ранга — блок своего этажа)'}`,
    );
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
        say('Норма спецзоны: +10 минут');
      }
      if (z.ended) {
        mineRumble();
        notifyWarning();
        say('Время в спецзоне вышло — завтра ещё');
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
      if (crit) floatText(c, 'КРИТ', 'pfloat--crit');
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
        floatText(c, 'КРИТ', 'pfloat--crit');
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
    floatText(mid, 'КУЙВА ПОВЕРЖЕН', 'pfloat--fell');
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
    dig.later(() => dig.blastAt(c, r, r > 1 ? 'ДИНАМИТ' : 'БУМ'), 760);
  };

  const applyItem = (id: ItemId) => {
    primeAudio();
    const st = useFinanceStore.getState().prison;
    if (st.items[id] <= 0) {
      tapLight();
      // Крепь не продаётся — её сбивают на лесопилке, а она в лесу: лагерь
      // шахты про лес не знает.
      if (id === 'prop') say('Крепь делают из досок на лесопилке — она в лесу');
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
      say('Заряд заложен');
      fuseTick(0);
      dig.later(() => dig.hammerFrom(Math.floor(MINE_CELLS / 2), 'ЗАРЯД', 3), 450);
      return;
    }
    if (!prisonUseItem(id)) return;
    notifySuccess();
    tierBreak(1);
    say(
      id === 'energy'
        ? 'Энергетик: кирка вдвое быстрее'
        : id === 'prop'
          ? 'Крепь: каждый второй блок — выше'
          : 'Лупа: видно, что лежит ярусом ниже',
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
      squashPop(forgeRef.current, 0.7);
      say(`В ящик кузнеца: ${fmt(got.boxed)} руды для кирки`);
    }
    if (!value) {
      if (got.boxed > 0) {
        tapLight();
        return;
      }
      notifyWarning();
      say('Рюкзак пуст — копай');
      return;
    }
    rollBalance(from, from + value);
    coinDing();
    notifySuccess();
    squashPop(bagRef.current, 0.6);
    const cost = rankCost(Math.min(rank, LAST_RANK - 1), prestige);
    if (value >= cost * 0.3) {
      rainCoins(Math.min(30, 8 + Math.round((value / cost) * 20)));
      setTimeout(() => payoutEnd(1), 300);
    }
  };

  const rankUp = () => {
    primeAudio();
    if (rank >= LAST_RANK) {
      setSheet('prestige');
      return;
    }
    const st = useFinanceStore.getState();
    const nd = rankNeeds(st.prison);
    // Не готово — лист условий: что сделано, чего не хватает, что можно докупить.
    if (!nd.pickOk || nd.work < nd.workNeed || nd.buyout > 0 || st.slotsBalance < nd.coins) {
      tapLight();
      setSheet('norm');
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
    burstConfetti(80);
    field.current?.trauma(0.35);
    setRankScene(res);
  };

  const openParcel = (i: number) => {
    primeAudio();
    const x = useFinanceStore.getState().prison.parcels[i];
    if (!x) return;
    if (x.left > 0) {
      tapLight();
      say(
        `Вскроется через ${fmt(x.left)} ${x.left % 10 === 1 && x.left % 100 !== 11 ? 'блок' : 'блоков'}`,
      );
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
    say(what === 'all' ? 'Всё в играх начато заново' : 'Каторга начата заново');
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
    say(`Рабочие: +${shortMoney(got.coins)} монет, +${fmt(got.tokens)} токенов`);
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
    say(`Престиж ${st.prestige}: +2 очка навыков, продажа ×${sellMult(st.prestige).toFixed(2)}`);
  };

  // ---- Разметка ----------------------------------------------------------

  const m = modsOf(prison);
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
  const campBadge = perkPointsFree(prison) > 0 || crewNow.minutes >= 60 || milesReady(prison) > 0;
  const forgeReady = forgeReadyNow(prison, balance);
  // «!» на чарах: хоть одну можно поднять прямо сейчас.
  const enchReady = ENCHANTS.some((e) => {
    const l = prison.ench[e.id];
    return (
      l < enchantCap(e.id, pickLv.level, prison.pickStars) && prison.tokens >= enchantCost(e.id, l)
    );
  });

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

  if (!hydrated) {
    return (
      <div className="gx pmx">
        <div className="prison-scene" aria-hidden="true" />
      </div>
    );
  }

  const sec = (ms: number) => {
    const t = Math.ceil(ms / 1000);
    return t < 100 ? `${t} с` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  const openSheet = (which: 'mines' | 'settings') => {
    tapLight();
    setSheet(which);
  };
  const goForest = () => {
    if (rank < FOREST_UNLOCK_RANK && !prestige) {
      notifyWarning();
      say(`Лес откроется с ранга ${rankLetter(FOREST_UNLOCK_RANK)}`);
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

  return (
    <div className="gx pmx pmx--mine">
      <div className="prison-scene" aria-hidden="true" />
      <div className={`prison${guide ? ' has-guide' : ''}`}>
        {/* Одна строка сверху (v2.67.2): лента с названием этажа и отдельный
            ряд фишек съедали 78 px высоты, а поле шахты ограничено именно
            высотой — на телефоне оно сжималось до 32 px клетки. Этаж теперь
            фишкой с его рудой: тап — окно этажей. */}
        <div className="pmx-top pmx-bar">
          <button
            type="button"
            className="gx-round gx-round--dark pmx-top__btn"
            aria-label="Назад"
            onClick={() => {
              tapLight();
              nav(-1);
            }}
          >
            <KIcon name="arrowLeft" />
          </button>
          <span className="gx-chip pmx-chip--coins">
            <CoinIcon size={18} />
            <MoneyCounter ref={moneyRef} value={shownBalance} format={chipMoney} />
          </span>
          <button
            type="button"
            ref={tokenRef}
            className="gx-chip pmx-chip--btn"
            aria-label="Токены — чары"
            onClick={() => openScreen('enchant')}
          >
            <TokenIcon size={17} /> {shortCount(prison.tokens)}
          </button>
          <span className="pmx-chips__gap" />
          <button
            type="button"
            className="gx-chip pmx-chip--btn pmx-floor"
            aria-label={
              prison.zone.on
                ? 'Особая шахта — этажи'
                : `Этаж ${rankLetter(mine.id)}, ${ROCKS[mine.id].name} — этажи`
            }
            onClick={() => openSheet('mines')}
          >
            <img className="pmx-floor__ore" src={rockTexture(mine.id)} alt="" />
            {prison.zone.on ? <GxIcon name="stairs" size={16} /> : rankLetter(mine.id)}
          </button>
          <button
            type="button"
            className={`gx-round gx-round--dark pmx-top__btn${rank < FOREST_UNLOCK_RANK && !prestige ? ' is-locked' : ''}`}
            aria-label="Лес"
            onClick={goForest}
          >
            <GxIcon name="forest" />
          </button>
          <button
            type="button"
            className="gx-round gx-round--dark pmx-top__btn"
            aria-label="Настройки"
            onClick={() => openSheet('settings')}
          >
            <KIcon name="gear" />
          </button>
        </div>

        <button
          type="button"
          className={`gx-panel gx-panel--wood pmx-rank${(atTop ? progress >= 1 : rankReady) ? ' is-ready' : ''}`}
          onClick={rankUp}
          aria-label={atTop ? `Престиж ${prestige + 1}` : `Ранг ${rankLetter(rank + 1)}`}
        >
          <span className="gx-hex pmx-rank__hex">{rankLetter(rank)}</span>
          <span className="pmx-rank__mid">
            <GxBar
              value={rankFill}
              tone="gold"
              label={
                (atTop ? progress >= 1 : rankReady) ? (
                  atTop ? (
                    'Престиж — жми!'
                  ) : (
                    'Новый ранг — жми!'
                  )
                ) : (
                  <span className={`pmx-rank__cost${progress >= 1 ? ' is-ok' : ''}`}>
                    {shortMoney(cost)} <CoinIcon size={12} />
                  </span>
                )
              }
            />
            {!atTop && !rankReady && <RankChips need={need} floor={rank} />}
          </span>
          <span className="gx-hex gx-hex--dark pmx-rank__hex">
            {atTop ? <GxIcon name="stairs" size={16} /> : rankLetter(rank + 1)}
          </span>
        </button>

        <div
          className={`pmine-frame${buffs.energy ? ' is-energy' : ''}${buffs.frenzy ? ' is-frenzy' : ''}${yardEv?.id === 'gold' ? ' is-gold' : ''}${prison.zone.on ? ' is-zone' : ''}`}
        >
          {/* Полоса запала сидит на верхней кромке рамы: отдельной строкой
              она отнимала бы у поля высоту. */}
          <div
            className={`pstrip${sTier >= 0 ? ` is-t${sTier}` : ''}${cooling ? ' is-cooling' : ''}`}
            ref={stripRef}
          >
            <span className="pstrip__pick" title="Уровень кирки">
              <b>
                <PickIcon pick={pick} size={13} />
                {pickLv.level}
              </b>
              <span className="pstrip__xp">
                <i
                  style={{ transform: `scaleX(${pickLv.need ? pickLv.into / pickLv.need : 1})` }}
                />
              </span>
            </span>
            <span className="pstrip__streak">
              <span className="pstrip__name">
                <GxIcon name="flame" size={13} />
                {sTier >= 0 && STREAK_TIERS[sTier].name}
                {sTier >= 0 && <em>+{Math.round(STREAK_TIERS[sTier].loot * 100)}%</em>}
              </span>
              <span className="pstrip__bar">
                <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, sFill))})` }} />
              </span>
            </span>
            <span className="pstrip__pace">
              {pace ? (
                <>
                  {shortCount(pace.blocks)} бл · {shortMoney(pace.coins)}
                  <CoinIcon size={10} />
                  <small>/мин</small>
                </>
              ) : (
                streak > 0 && <small>{fmt(streak)} подряд</small>
              )}
            </span>
          </div>
          {prison.zone.on && (
            <button
              type="button"
              className="pzone-exit"
              onClick={() => {
                tapLight();
                prisonZoneExit();
                say('Вышел из спецзоны');
              }}
            >
              Выйти
            </button>
          )}
          {(anyBuff || yardEv || prison.zone.on) && (
            <div className="pbuffs">
              {prison.zone.on && (
                <span className="pbuff pbuff--zone">
                  <GxIcon name="hourglass" size={12} /> {clockMs(zoneLeft(prison.zone, Date.now()))}
                  {ZONE_MS + prison.zone.bonus < ZONE_MAX_MS &&
                    ` · +10 мин через ${ZONE_QUOTA - (prison.zone.have % ZONE_QUOTA)}`}
                </span>
              )}
              {yardEv && <EventPill ev={yardEv} now={yardNow} />}
              {buffs.frenzy > 0 && (
                <span className="pbuff pbuff--frenzy">
                  <GxIcon name="sparkles" size={12} /> {sec(buffs.frenzy)}
                </span>
              )}
              {buffs.energy > 0 && (
                <span className="pbuff pbuff--energy">
                  <ItemIcon id="energy" size={12} /> {sec(buffs.energy)}
                </span>
              )}
              {buffs.lens > 0 && (
                <span className="pbuff pbuff--lens">
                  <ItemIcon id="lens" size={12} /> {sec(buffs.lens)}
                </span>
              )}
              {buffs.prop > 0 && (
                <span className="pbuff pbuff--prop">
                  <ItemIcon id="prop" size={12} /> {sec(buffs.prop)}
                </span>
              )}
            </div>
          )}
          {prison.parcels.length > 0 && (
            <div className="pparcels" ref={parcelsRef}>
              {prison.parcels.map((x, i) => {
                const tier = CASE_TIERS.find((t) => t.id === x.tier)!;
                const ready = x.left <= 0;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pparcel${ready ? ' is-ready' : ''}`}
                    style={{ '--tier': tier.color } as CSSProperties}
                    aria-label={`Посылка, ${tier.name.toLowerCase()}${ready ? ', готова' : ''}`}
                    onClick={() => openParcel(i)}
                  >
                    <img src={parcelTexture(tier.color)} alt="" />
                    {!ready && (
                      <span className="pparcel__bar">
                        <i style={{ transform: `scaleX(${1 - x.left / PARCEL_NEED[x.tier]})` }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <MineField
            ref={field}
            gridKey={mineKey}
            cells={renderCells}
            pick={<PickIcon pick={pick} size={38} />}
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
                    <img src={meteorTexture()} alt="Метеорит" />
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
                    <img src={kuivaTexture()} alt="Куйва" />
                    <span className="ykuiva__hp">
                      <i style={{ transform: `scaleX(${bossFill})` }} />
                    </span>
                  </div>
                )}
              </>
            }
          >
            <BatLayer ref={batRef} host={fieldEl} onCatch={onBatCatch} />
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
                <ItemIcon id={arming} size={18} /> Тапни, куда бросить
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
                  <i>{cardShown.fresh ? 'Находка!' : `Дубликат ×${cardShown.n}`}</i>
                  <b>{findOf(cardShown.id).name}</b>
                  <em>{cardShown.fresh ? '+1% к продаже навсегда' : '+40 токенов'}</em>
                </span>
              </div>
            )}
            {shiftShown && (
              <div className={`pshift${shiftLeaving ? ' is-out' : ''}`}>
                <i>Смена · 5 минут</i>
                <b>
                  {fmt(shiftShown.blocks)} блоков · +{shortMoney(shiftShown.coins)}{' '}
                  <CoinIcon size={12} />
                </b>
                <em>
                  +{fmt(shiftShown.tokens)} ✦
                  {shiftShown.keys
                    ? ` · +${shiftShown.keys} ${shiftShown.keys > 1 ? 'ключа' : 'ключ'}`
                    : ''}
                </em>
              </div>
            )}
            {crewNote && crewNow.blocks > 0 && (
              <div className="pcrewnote">
                <span>
                  <b>Рабочие накопали {fmt(crewNow.blocks)} блоков</b>
                  <i>
                    +{shortMoney(crewNow.coins)} монет · +{fmt(crewNow.tokens)} токенов
                    {crewNow.capped ? ' · смена кончилась' : ''}
                  </i>
                </span>
                <button type="button" className="btn btn--sm pmines__go" onClick={collectCrew}>
                  Забрать
                </button>
                <button
                  type="button"
                  className="pcrewnote__x"
                  aria-label="Позже"
                  onClick={() => setCrewNote(false)}
                >
                  ×
                </button>
              </div>
            )}
          </MineField>
        </div>

        <div className="pmx-items">
          {ITEMS.filter((it) => it.id !== 'prop' || prison.items.prop > 0 || millLevel > 0).map(
            (it) => {
              const n = prison.items[it.id];
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`gx-round pmx-item${n ? '' : ' is-empty'}${arming === it.id ? ' is-armed' : ''}`}
                  aria-label={`${it.name}: ${n}`}
                  onClick={() => applyItem(it.id)}
                >
                  <ItemIcon id={it.id} />
                  <i className={`pmx-item__n${n ? '' : ' is-buy'}`}>{n || '+'}</i>
                </button>
              );
            },
          )}
        </div>

        <div className="pmx-foot">
          <button
            type="button"
            ref={bagRef}
            className={`gx-panel gx-panel--wood pmx-bag${full ? ' is-full' : ''}${cart ? ' has-cart' : ''}`}
            onClick={sell}
          >
            <GxIcon name="backpack" className="pmx-bag__ico" />
            <span className="pmx-bag__body">
              <GxBar
                value={count / cap}
                tone={full ? 'red' : 'green'}
                label={full ? `${count} / ${cap} — полный` : `${count} / ${cap}`}
              />
              <span className={`gx-btn gx-btn--sm${count ? ' gx-btn--red' : ''} pmx-bag__sell`}>
                {count && value ? (
                  <>
                    Продать {shortMoney(value)} <CoinIcon size={13} />
                  </>
                ) : count ? (
                  <>
                    <GxIcon name="anvil" size={14} /> В ящик
                  </>
                ) : (
                  'Пусто'
                )}
              </span>
            </span>
          </button>
        </div>

        {/* Нижняя панель (v2.67) вместо листа «Лагерь» с десятью вкладками:
            пять крупных кнопок, как в мобильных играх. Каждая открывает свой
            экран. Кузница показывает кирку в руке — в цвете её редкости. */}
        <nav className="gx-panel gx-panel--wood pmx-dock" aria-label="Лагерь">
          <button
            type="button"
            ref={forgeRef}
            className={`pmx-dock__btn${forgeReady ? ' is-ready' : ''}`}
            onClick={() => {
              tapLight();
              setForgeOpen(true);
            }}
          >
            <PickIcon pick={pick} size={24} />
            <b>Кузница</b>
            {forgeReady && <i className="gx-badge gx-badge--gold">!</i>}
          </button>
          <button type="button" className="pmx-dock__btn" onClick={() => openScreen('enchant')}>
            <GxIcon name="magic" />
            <b>Чары</b>
            {enchReady && <i className="gx-badge">!</i>}
          </button>
          <button
            type="button"
            ref={chestRef}
            className="pmx-dock__btn"
            onClick={() => openScreen('cases')}
          >
            <GxIcon name="chest" />
            <b>Сундуки</b>
            {prison.keys > 0 && (
              <i className="gx-badge gx-badge--gold">
                <KeyIcon size={10} />
                {prison.keys}
              </i>
            )}
          </button>
          <button type="button" className="pmx-dock__btn" onClick={() => openScreen('pets')}>
            {prison.pet ? (
              <img
                ref={petRef}
                className="pmx-dock__pet"
                src={petTexture(prison.pet)}
                alt={petOf(prison.pet).name}
                title={`${petOf(prison.pet).name}, ${petLevelOf(prison.pets[prison.pet] ?? 0).level} ур.`}
              />
            ) : (
              <GxIcon name="paw" />
            )}
            <b>Питомцы</b>
          </button>
          <button type="button" className="pmx-dock__btn" onClick={() => openScreen('more')}>
            <GxIcon name="campfire" />
            <b>Ещё</b>
            {campBadge && <i className="gx-badge">!</i>}
          </button>
        </nav>

        {/* Задание, пока они не пройдены, стоит на месте строки с ценами
            пород: высота под полем на счету, а цены есть и в окне шахт.
            Подсказка к заданию — по тапу, а не строкой под ним. */}
        {guide ? (
          <button
            type="button"
            className={`gx-panel pmx-quest${guideOk ? ' is-ready' : ''}`}
            onClick={() => {
              if (guideOk) {
                claimGuide();
                return;
              }
              tapLight();
              say(guide.hint);
            }}
          >
            <span className="gx-hex gx-hex--dark pmx-quest__n">{prison.guide + 1}</span>
            <span className="pmx-quest__body">
              <b>{guide.title}</b>
              {guideOk ? (
                <em>{rewardText(guide.reward)}</em>
              ) : guideGoal > 1 ? (
                <GxBar thin tone="green" value={guideV / guideGoal} className="pmx-quest__bar" />
              ) : (
                <em>{rewardText(guide.reward)}</em>
              )}
            </span>
            {guideOk ? (
              <span className="gx-btn gx-btn--red gx-btn--sm">Забрать</span>
            ) : (
              <span className="pmx-quest__n2">
                {guideGoal > 1 ? `${fmt(guideV)}/${fmt(guideGoal)}` : <KIcon name="question" />}
              </span>
            )}
          </button>
        ) : null}
      </div>

      {screen && (
        <PrisonCamp
          place="mine"
          only={SCREENS[screen.key].only}
          title={SCREENS[screen.key].title}
          tab={screen.tab}
          onTab={(t) => setScreen({ key: screen.key, tab: t })}
          onClose={() => setScreen(null)}
          onGain={rollBalance}
          onSpend={settleBalance}
        />
      )}
      {forgeOpen && <ForgeScreen onClose={() => setForgeOpen(false)} onSpend={settleBalance} />}

      {sheet === 'mines' && (
        <GxModal title="Этажи" onClose={() => setSheet(null)} className="pmx-mines">
          {Array.from({ length: Math.min(LAST_RANK, rank + 1) + 1 }, (_, id) => {
            const locked = id > rank;
            const here = id === mine.id && !prison.zone.on;
            const band = HORIZONS.find((h) => h.from === id);
            return (
              <div key={id} className="pmx-mines__item">
                {band && <div className="pmx-mines__band">{band.name}</div>}
                <div
                  className={`pmx-mines__row${here ? ' is-here' : ''}${locked ? ' is-locked' : ''}`}
                >
                  <span className={`gx-hex${locked ? '' : ' gx-hex--dark'}`}>{rankLetter(id)}</span>
                  <img className="pmx-mines__ore" src={blockTexture(id)} alt="" />
                  <span className="pmx-mines__info">
                    <b>
                      {ROCKS[id].name}
                      <em className={`pmx-mines__hard${canMine(pick, id) ? '' : ' is-no'}`}>
                        ⛏{rockHardness(id)}
                      </em>
                    </b>
                    <span className="pmx-mines__price">
                      руда {ROCKS[id].value} · блок {shortMoney(ROCKS[id].block)}
                    </span>
                  </span>
                  {locked ? (
                    <span className="pmx-mines__lock">
                      <KIcon name="locked" size={18} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`gx-btn gx-btn--sm${here ? '' : ' gx-btn--red'}`}
                      onClick={() => goMine(id)}
                    >
                      {here ? (
                        <>
                          <GxIcon name="cycle" size={14} /> Заново
                        </>
                      ) : (
                        'Вниз'
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </GxModal>
      )}

      {sheet === 'settings' && (
        <GxModal
          title="Настройки"
          onClose={() => {
            setSheet(null);
            setWipe(null);
          }}
          className="pmx-settings"
        >
          <div className="pmx-sound">
            <AudioToggles />
          </div>
          <div className="pcash">
            <CashDesk />
          </div>
          <div className="pmx-wipe">
            <button
              type="button"
              className={`gx-btn gx-btn--block${wipe === 'prison' ? ' gx-btn--red' : ''}`}
              onClick={() => doWipe('prison')}
            >
              {wipe === 'prison' ? 'Точно? Нажми ещё раз' : 'Начать шахту заново'}
            </button>
            <p>Монеты и уровень останутся — они общие с автоматами.</p>
            <button
              type="button"
              className={`gx-btn gx-btn--block${wipe === 'all' ? ' gx-btn--red' : ''}`}
              onClick={() => doWipe('all')}
            >
              {wipe === 'all' ? 'Точно всё? Нажми ещё раз' : 'Сбросить все игры'}
            </button>
            <p>Шахта, лес и автоматы с нуля, монет — снова тысяча. Отменить нельзя.</p>
          </div>
        </GxModal>
      )}

      {sheet === 'norm' && !atTop && (
        <GxModal
          title={`Ранг ${rankLetter(rank + 1)}`}
          onClose={() => setSheet(null)}
          className="pmx-norm"
        >
          {needPick > 0 && (
            <div className={`pmx-norm__row${pickOk ? ' is-done' : ''}`}>
              <PickIcon pick={needPick} size={40} />
              <span className="pmx-norm__info">
                <b>
                  Кирка ⛏{need.power} · {PICKS[needPick].name.toLowerCase()}
                </b>
                {pickOk ? (
                  <GxBar tone="green" value={1} label={<KIcon name="checkmark" size={12} />} />
                ) : (
                  <button
                    type="button"
                    className="gx-btn gx-btn--sm gx-btn--red pmx-norm__go"
                    onClick={() => {
                      tapLight();
                      setSheet(null);
                      setForgeOpen(true);
                    }}
                  >
                    <GxIcon name="anvil" size={16} /> В кузницу
                  </button>
                )}
              </span>
            </div>
          )}
          {need.workNeed > 0 && (
            <div className={`pmx-norm__row${workOk ? ' is-done' : ''}`}>
              <PickIcon pick={pick} size={40} />
              <span className="pmx-norm__info">
                <b>Выработка — сломать блоков</b>
                <GxBar
                  tone={workOk ? 'green' : 'gold'}
                  value={need.work / need.workNeed}
                  label={
                    workOk ? (
                      <KIcon name="checkmark" size={12} />
                    ) : (
                      `${fmt(need.work)} / ${fmt(need.workNeed)}`
                    )
                  }
                />
              </span>
            </div>
          )}
          {need.blocksNeed > 0 && (
            <div className={`pmx-norm__row${need.blocks >= need.blocksNeed ? ' is-done' : ''}`}>
              <img src={blockTexture(rank)} alt="" />
              <span className="pmx-norm__info">
                <b>
                  {ROCKS[rank].blockName} · {shortMoney(blockValue(rank))}
                </b>
                <GxBar
                  tone={need.blocks >= need.blocksNeed ? 'green' : 'gold'}
                  value={need.blocks / need.blocksNeed}
                  label={
                    need.blocks >= need.blocksNeed ? (
                      <KIcon name="checkmark" size={12} />
                    ) : (
                      `${need.blocks} / ${need.blocksNeed}`
                    )
                  }
                />
                {need.blocks < need.blocksNeed && mine.id === rank && (
                  <i className="pmx-norm__sub">
                    Гарантия: через {fmt(pityLeft)} блоков он встанет сам
                  </i>
                )}
              </span>
            </div>
          )}
          <div className={`pmx-norm__row${balance >= cost ? ' is-done' : ''}`}>
            <CoinIcon size={32} />
            <span className="pmx-norm__info">
              <b>Монеты</b>
              <GxBar
                tone={balance >= cost ? 'green' : 'gold'}
                value={progress}
                label={
                  balance >= cost ? (
                    <KIcon name="checkmark" size={12} />
                  ) : (
                    `${shortMoney(balance)} / ${shortMoney(cost)}`
                  )
                }
              />
            </span>
          </div>
          <div className="pmx-norm__actions">
            <button
              type="button"
              className="gx-btn gx-btn--red gx-btn--block gx-btn--big"
              disabled={!qDone || balance < cost}
              onClick={() => takeRank(false)}
            >
              Взять ранг {rankLetter(rank + 1)}
            </button>
            {workOk && buyout > 0 && (
              <button
                type="button"
                className="gx-btn gx-btn--block"
                disabled={balance < cost + buyout}
                onClick={() => takeRank(true)}
              >
                Докупить {need.blocksNeed - need.blocks > 1 ? 'блоки' : 'блок'} ·{' '}
                {shortMoney(buyout)} <CoinIcon size={13} />
              </button>
            )}
          </div>
        </GxModal>
      )}

      {reveal && <ParcelReveal open={reveal} onClose={() => setReveal(null)} />}

      {sheet === 'prestige' && (
        <GxModal
          title={`Престиж ${prestige + 1}`}
          onClose={() => setSheet(null)}
          className="pmx-pres"
        >
          <div className="pmx-pres__swap">
            <span className="gx-hex">Z</span>
            <KIcon name="arrowRight" size={20} />
            <span className="gx-hex gx-hex--dark">
              {rankLetter(Math.min(LAST_RANK - 1, prison.perks.blat))}
            </span>
          </div>
          <div className="gx-row">
            <GxIcon name="coins-pile" />
            <span>Продажа дороже</span>
            <b>
              ×{sellMult(prestige).toFixed(2)} → ×{sellMult(prestige + 1).toFixed(2)}
            </b>
          </div>
          <div className="gx-row">
            <GxIcon name="upgrade" />
            <span>Очки навыков</span>
            <b>+2</b>
          </div>
          <div className="gx-row">
            <KeyIcon size={26} />
            <span>Ключи</span>
            <b>+5</b>
          </div>
          <div className="pmx-pres__keep">
            <span>Останутся:</span>
            <GxIcon name="pick" size={20} />
            <GxIcon name="magic" size={20} />
            <TokenIcon size={18} />
            <GxIcon name="backpack" size={20} />
            <GxIcon name="miner" size={20} />
            <GxIcon name="trophy" size={20} />
          </div>
          <button
            type="button"
            className="gx-btn gx-btn--red gx-btn--block gx-btn--big"
            disabled={balance < prestigeCost(prestige)}
            onClick={prestigeNow}
          >
            Престиж · {shortMoney(prestigeCost(prestige))} <CoinIcon size={14} />
          </button>
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
            <span className="prank__label">
              {horizonOf(sceneShown.rank).from === sceneShown.rank
                ? `Новый горизонт · ${horizonOf(sceneShown.rank).name}`
                : 'Новый ранг'}
            </span>
            <b className="prank__letter">{rankLetter(sceneShown.rank)}</b>
            <span className="prank__mine">
              <img src={blockTexture(sceneShown.rank)} alt="" />
              Этаж {rankLetter(sceneShown.rank)} · {ROCKS[sceneShown.rank].name.toLowerCase()} ·{' '}
              {ROCKS[sceneShown.rank].value} за руду · блок{' '}
              {shortMoney(ROCKS[sceneShown.rank].block)}
            </span>
            <span className="prank__key">
              <KeyIcon size={13} /> +1 ключ от сундука
            </span>
            {sceneShown.rank === FOREST_UNLOCK_RANK && (
              <span className="prank__lvl">Открыт лес — кнопка «Лес» над полем</span>
            )}
            {sceneShown.buyout > 0 && (
              <span className="prank__lvl">Блок докуплен за {fmt(sceneShown.buyout)} монет</span>
            )}
            {sceneShown.rank < LAST_RANK && (
              <span className="prank__norm">
                Для ранга {rankLetter(sceneShown.rank + 1)}:
                <RankChips
                  need={rankNeeds({ rank: sceneShown.rank, norm: {}, oreBlocks: 0, pick })}
                  floor={sceneShown.rank}
                />
              </span>
            )}
            {sceneShown.levelUps.length > 0 && (
              <span className="prank__lvl">
                Уровень {sceneShown.levelUps[sceneShown.levelUps.length - 1]}
              </span>
            )}
            <span className="prank__cta">В шахту</span>
          </div>
        </div>
      )}
      <EventAnnounce ev={yardSplash} onDone={closeSplash} />
    </div>
  );
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
