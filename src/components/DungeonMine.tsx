// Шахта подземелья: тот же экран, что у каторги (`MineField` + `useMineDig`),
// та же кирка и те же чары — но добыча идёт в СИДОР вылазки, а не в рюкзак.
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
  DEEP_DONE_AT,
  DEEP_MINES,
  DEEP_NOISE_BLOCKS,
  DEEP_NOISE_MAX,
  canTake,
  deepField,
  deepHp,
  deepMineNow,
  deepRock,
  mineNextAt,
  mineWindow,
  sackSlots,
  slotsUsed,
} from '@/lib/dungeon';
import type { DeepMineId, DeepMineState } from '@/lib/dungeon';
import type { Sim } from '@/lib/dungeon-sim';
import {
  DEPTH,
  hitDamage,
  MINE_CELLS,
  minedShare,
  modsOf,
  PICKS,
  rockAt,
  veinCells,
} from '@/lib/prison';
import { bedrockTexture, deepRockColors, deepRockTexture, rockVariant } from '@/lib/prison-art';
import { itemUrl } from '@/lib/dungeon-art';
import { bagFull, deepRumble, ratSqueak } from '@/lib/sound';
import { notifyWarning, tapLight } from '@/lib/haptics';

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
  const field = useRef<MineFieldHandle>(null);
  const sackRef = useRef<HTMLSpanElement>(null);
  const noise = useRef(0);
  const [packs, setPacks] = useState(0);
  const [sackN, setSackN] = useState(() => slotsUsed(sim.sack));
  const [ore, setOre] = useState(() => sim.sack.mats.pyrite ?? 0);
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
        if (got <= 6) field.current?.fly(b.cell, deepRockTexture(b.rock), sackRef.current);
      } else lost += 1;
    }
    const next = { window: cur.window, dug };
    mRef.current = next;
    setM(next);
    // Добытая руда идёт в условие каски сразу: прогресс не пропадает и при
    // смерти, как убийства.
    useFinanceStore.getState().dungeonMineSave(id, next, first, got);
    if (got) {
      setOre(sim.sack.mats.pyrite ?? 0);
      setSackN(slotsUsed(sim.sack));
      if (got > 1) field.current?.float(list[0].cell, `+${got}`, 'pfloat--vein');
    }
    if (lost) {
      bagFull();
      notifyWarning();
      onToast('Рюкзак полон — руда осыпается мимо');
    }
    noise.current += list.length;
    const p = Math.min(DEEP_NOISE_MAX, Math.floor(noise.current / DEEP_NOISE_BLOCKS));
    if (p > packs) {
      setPacks(p);
      ratSqueak(0);
      ratSqueak(1);
      field.current?.float(list[0].cell, 'ШУМ', 'pfloat--blast');
    }
  };

  const dig = useMineDig(field, {
    key: `${id}:${m.window}`,
    rockAt: (c) => rockAt(rocks, c, mRef.current.dug[c]),
    rock: (r) => ({
      hp: deepHp(r, useFinanceStore.getState().prison),
      kind: deepRock(r).kind,
      colors: deepRockColors(r),
    }),
    // Выработанную шахту не копают до следующего окна.
    shut: () => doneRef.current,
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
      cells.push(
        <MineCell
          key={c}
          index={c}
          tex={top < 0 ? bedrockTexture() : deepRockTexture(top, rockVariant(m.window, c, d))}
          bottom={top < 0}
          depth={d}
          crack={dig.cracks[c]}
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
        <span className="gx-chip" ref={sackRef}>
          <img src={itemUrl('pyrite')} alt="" /> {ore}
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
