// Шахта подземелья: тот же экран, что у каторги (`MineField` + `useMineDig`),
// та же кирка и те же чары — но добыча идёт в СИДОР вылазки, а не в рюкзак.
// С v2.81 у каждого этажа своя шахта: две руды этажа (номера пород каторги,
// те же текстуры) и их цельные блоки — редкими клетками, бьются ударами,
// как блок этажа наверху. Блоки и руда — материалы, в ранг они не идут.
// Поле одно на окно часов (`deepField`), раскоп в сторе, чтобы вход в ту же
// шахту в тот же час показывал ту же выработку. Пока копаешь — мир стоит,
// но шум слышен: каждые `DEEP_NOISE_BLOCKS` блоков у входа собирается стая,
// и выйдешь ты к ней.

import { useEffect, useMemo, useRef, useState } from 'react';
import { GxBar, GxIcon } from '@/components/gx';
import { MineCell, MineField, useMineDig, wall } from '@/components/MineField';
import type { BreakKind, DigBlock, MineFieldHandle } from '@/components/MineField';
import { PickIcon } from '@/components/PrisonCamp';
import { useFinanceStore } from '@/store';
import {
  blockItem,
  DEEP_BLOCK_HITS,
  DEEP_DONE_AT,
  DEEP_MINES,
  DEEP_NOISE_BLOCKS,
  DEEP_NOISE_MAX,
  canTake,
  deepBlocks,
  deepBlockTop,
  deepField,
  deepHp,
  deepMineNow,
  deepRock,
  matDef,
  mineNextAt,
  mineWindow,
  oreItem,
  sackSlots,
  slotsUsed,
} from '@/lib/dungeon';
import { DEEP_BASE } from '@/lib/dungeon-floors/types';
import type { DeepMineId, DeepMineState } from '@/lib/dungeon';
import type { Sim } from '@/lib/dungeon-sim';
import {
  CRIT_CHANCE,
  DEPTH,
  hitDamage,
  MINE_CELLS,
  minedShare,
  modsOf,
  PICKS,
  rockAt,
  veinCells,
} from '@/lib/prison';
import {
  bedrockTexture,
  blockTexture,
  crackVariant,
  deepRockColors,
  deepRockTexture,
  rockColors,
  rockTexture,
  rockVariant,
} from '@/lib/prison-art';
import { itemUrl } from '@/lib/dungeon-art';
import { crackStage } from '@/components/MineField';
import { bagFull, deepRumble, pickHit, ratSqueak, softChime, tierBreak } from '@/lib/sound';
import { notifySuccess, notifyWarning, tapLight, tapMedium } from '@/lib/haptics';

/** Руда этажа — текстуры каторги, пустая порода и пирит — свои. */
const texOf = (r: number, v = 0) => (r >= DEEP_BASE ? deepRockTexture(r, v) : rockTexture(r, v));
const colorsOf = (r: number) => (r >= DEEP_BASE ? deepRockColors(r) : rockColors(r));

const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  return m >= 60
    ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
    : `${m}:${String(t % 60).padStart(2, '0')}`;
};

export function DungeonMine({
  id,
  sim,
  onExit,
  onToast,
}: {
  id: DeepMineId;
  sim: Sim;
  /** Вышел: сколько стай собралось у входа. */
  onExit: (packs: number) => void;
  onToast: (text: string) => void;
}) {
  const def = DEEP_MINES[id];
  const pick = useFinanceStore((s) => s.prison.pick);
  const [now, setNow] = useState(() => Date.now());
  const [m, setM] = useState<DeepMineState>(() =>
    deepMineNow(useFinanceStore.getState().dungeon, id, Date.now(), MINE_CELLS),
  );
  const mRef = useRef(m);
  mRef.current = m;
  const rocks = useMemo(() => deepField(id, m.window, MINE_CELLS, DEPTH), [id, m.window]);
  const blocks = useMemo(() => deepBlocks(id, m.window, MINE_CELLS, DEPTH), [id, m.window]);
  const field = useRef<MineFieldHandle>(null);
  const sackRef = useRef<HTMLSpanElement>(null);
  const noise = useRef(0);
  const [packs, setPacks] = useState(0);
  const [sackN, setSackN] = useState(() => slotsUsed(sim.sack));
  // Что этой шахты уже в рюкзаке: две руды этажа, пирит и блоки.
  const chipIds = [
    oreItem(def.ores[0]),
    oreItem(def.ores[1]),
    ...(def.pyrite > 0 ? ['pyrite'] : []),
    blockItem(def.ores[0]),
    blockItem(def.ores[1]),
  ];
  const countOf = () => chipIds.map((k) => sim.sack.mats[k] ?? 0);
  const [ore, setOre] = useState(countOf);
  const share = minedShare(m.dug);
  const done = share >= DEEP_DONE_AT;
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Час сменился, пока копал, — шахта обновилась прямо на глазах.
  useEffect(() => {
    if (mineWindow(id, now) !== m.window)
      setM(deepMineNow(useFinanceStore.getState().dungeon, id, now, MINE_CELLS));
  }, [id, now, m.window]);

  const onBreak = (list: DigBlock[], _kind: BreakKind) => {
    const cur = mRef.current;
    const first = cur.dug.every((x) => x === 0);
    const dug = cur.dug.slice();
    let got = 0;
    let lost = 0;
    for (const b of list) {
      dug[b.cell] = Math.min(DEPTH, dug[b.cell] + 1);
      const mat = deepRock(b.rock).mat;
      if (!mat) continue;
      if (canTake(sim.sack, mat, 1, sim.sackLevel)) {
        sim.sack.mats[mat] = (sim.sack.mats[mat] ?? 0) + 1;
        got += 1;
        if (got <= 6) field.current?.fly(b.cell, texOf(b.rock), sackRef.current);
      } else lost += 1;
    }
    const next = { window: cur.window, dug };
    mRef.current = next;
    setM(next);
    // Добытая руда идёт в условие каски сразу: прогресс не пропадает и при
    // смерти, как убийства.
    useFinanceStore.getState().dungeonMineSave(id, next, first, got);
    if (got) {
      setOre(countOf());
      setSackN(slotsUsed(sim.sack));
      if (got > 1) field.current?.float(list[0].cell, `+${got}`, 'pfloat--vein');
    }
    if (lost) {
      bagFull();
      notifyWarning();
      onToast('Рюкзак полон — руда осыпается мимо');
    }
    makeNoise(list.length, list[0].cell);
  };

  const makeNoise = (n: number, cell: number) => {
    noise.current += n;
    const p = Math.min(DEEP_NOISE_MAX, Math.floor(noise.current / DEEP_NOISE_BLOCKS));
    if (p > packs) {
      setPacks(p);
      ratSqueak(0);
      ratSqueak(1);
      field.current?.float(cell, 'ШУМ', 'pfloat--blast');
    }
  };

  /**
   * Удар по цельному блоку: как блок этажа наверху — считаются УДАРЫ
   * (`DEEP_BLOCK_HITS`, крит за два), площадные чары его не берут. Сломал —
   * блок в рюкзак, а не деньги: это материал для снаряжения.
   */
  const blockHit = (c: number, crit: boolean) => {
    const f = field.current;
    const cur = mRef.current;
    const b = deepBlockTop(blocks, c, cur.dug[c]);
    if (!b) return;
    const colors = colorsOf(b.rock);
    f?.swing(c, crit);
    const hp = dig.hp.current;
    const left = (hp[c] < 0 ? DEEP_BLOCK_HITS : hp[c]) - (crit ? 2 : 1);
    f?.chips(c, [...colors, '#ffffff'], crit ? 14 : 8, crit ? 1.4 : 1);
    if (left > 0) {
      hp[c] = left;
      dig.setCrack(c, crackStage(left, DEEP_BLOCK_HITS));
      pickHit('crystal', crit);
      tapMedium();
      f?.wobble(c);
      return;
    }
    hp[c] = -1;
    f?.shatter(c, true);
    dig.setCrack(c, 0);
    const dug = cur.dug.slice();
    dug[c] = Math.min(DEPTH, dug[c] + 1);
    const next = { window: cur.window, dug };
    mRef.current = next;
    setM(next);
    const item = blockItem(b.rock);
    const ok = canTake(sim.sack, item, 1, sim.sackLevel);
    if (ok) {
      sim.sack.mats[item] = (sim.sack.mats[item] ?? 0) + 1;
      f?.fly(c, blockTexture(b.rock), sackRef.current);
      setOre(countOf());
      setSackN(slotsUsed(sim.sack));
      tierBreak(2);
      softChime(1);
      notifySuccess();
      f?.trauma(0.4);
      f?.chips(c, [...colors, '#ffffff', '#ffe08a'], 36, 2);
      f?.float(c, matDef(item).name.toUpperCase(), 'pfloat--block', 0);
    } else {
      bagFull();
      notifyWarning();
      onToast('Рюкзак полон — блок раскололся мимо');
    }
    useFinanceStore.getState().dungeonMineSave(id, next, false, ok ? 1 : 0);
    makeNoise(1, c);
  };

  const dig = useMineDig(field, {
    key: `${id}:${m.window}`,
    rockAt: (c) => rockAt(rocks, c, mRef.current.dug[c]),
    rock: (r) => ({
      hp: deepHp(r, useFinanceStore.getState().prison),
      kind: deepRock(r).kind,
      colors: colorsOf(r),
    }),
    // Выработанную шахту не копают до следующего окна; цельный блок
    // площадные чары не берут — только руками.
    shut: (c) => doneRef.current || !!deepBlockTop(blocks, c, mRef.current.dug[c]),
    special: (c) => {
      if (doneRef.current || !deepBlockTop(blocks, c, mRef.current.dug[c])) return false;
      blockHit(c, Math.random() < CRIT_CHANCE);
      return true;
    },
    gapMs: () => {
      const p = useFinanceStore.getState().prison;
      return 1000 / (PICKS[p.pick].rate * modsOf(p).rate * 1.8);
    },
    damage: () => {
      const p = useFinanceStore.getState().prison;
      return hitDamage(p.pick) * modsOf(p).dmg;
    },
    procs: () => modsOf(useFinanceStore.getState().prison),
    vein: (c, rock, max) => veinCells(rocks, mRef.current.dug, c, rock, max),
    onBreak,
  });

  const renderCells = (faceRef: (i: number, el: HTMLSpanElement | null) => void) => {
    const cells = [];
    for (let c = 0; c < MINE_CELLS; c++) {
      const d = m.dug[c];
      const top = rockAt(rocks, c, d);
      const blk = deepBlockTop(blocks, c, d);
      cells.push(
        <MineCell
          key={c}
          index={c}
          tex={
            blk
              ? blockTexture(blk.rock)
              : top < 0
                ? bedrockTexture()
                : texOf(top, rockVariant(m.window, c, d))
          }
          block={!!blk}
          bottom={top < 0}
          depth={d}
          crack={dig.cracks[c]}
          crackVar={crackVariant(m.window, c, d)}
          peek=""
          need={false}
          seid={false}
          seidBelow={0}
          wt={wall(m.dug, c, 0, -1)}
          wl={wall(m.dug, c, -1, 0)}
          wb={wall(m.dug, c, 0, 1)}
          wr={wall(m.dug, c, 1, 0)}
          faceRef={faceRef}
        />,
      );
    }
    return cells;
  };

  const left = packs * DEEP_NOISE_BLOCKS + DEEP_NOISE_BLOCKS - noise.current;

  return (
    <div className="gx dgmine">
      <div className="dgmine__head">
        <button
          type="button"
          className="gx-round gx-round--red dgmine__out"
          aria-label="Выйти из шахты"
          onClick={() => {
            tapLight();
            field.current?.stop();
            if (packs > 0) deepRumble();
            onExit(packs);
          }}
        >
          <GxIcon name="exit" />
        </button>
        <div className="gx-ribbon dgmine__title">{def.name}</div>
        <span className="gx-chip dgmine__clock" title="Новая порода">
          <GxIcon name="hourglass" size={15} /> {clock(mineNextAt(id, now) - now)}
        </span>
      </div>
      <GxBar
        tone="green"
        value={share / DEEP_DONE_AT}
        label={`${Math.min(100, Math.round((share / DEEP_DONE_AT) * 100))}%`}
        className="dgmine__bar"
      />
      <div className="dgmine__info">
        <span className="dgmine__ores" ref={sackRef}>
          {chipIds.map((k, i) =>
            ore[i] > 0 || i < 2 ? (
              <span key={k} className="gx-chip" title={matDef(k).name}>
                <img src={itemUrl(k)} alt="" /> {ore[i]}
              </span>
            ) : null,
          )}
        </span>
        <span className="gx-chip">
          <GxIcon name="backpack" size={16} /> {sackN}/{sackSlots(sim.sackLevel)}
        </span>
        <span className={`gx-chip dgmine__noise${packs > 0 ? ' is-loud' : ''}`}>
          <GxIcon name="rat" size={16} /> {packs}
          {packs < DEEP_NOISE_MAX && (
            <GxBar thin value={1 - left / DEEP_NOISE_BLOCKS} className="dgmine__noisebar" />
          )}
        </span>
      </div>
      <div className="prison dgmine__wrap">
        <MineField
          ref={field}
          gridKey={`${id}:${m.window}`}
          cells={renderCells}
          pick={<PickIcon pick={pick} size={38} />}
          rate={() => {
            const p = useFinanceStore.getState().prison;
            return PICKS[p.pick].rate * modsOf(p).rate;
          }}
          onHit={dig.strike}
        >
          {done && (
            <div className="dgmine__done">
              <b>Выработана</b>
              <span>Порода нарастёт через {clock(mineNextAt(id, now) - now)}</span>
            </div>
          )}
        </MineField>
      </div>
    </div>
  );
}
