// Этаж 12 — Шаманка сияния (анимации мобов 12; только бой с мамонтом, фаза 3).
// Мозг `f12_shaman` (`f12-brains.ts`, `shamanStep`): `f12s_jump` 0,9 (спрыгнула
// с мамонта, недосягаема) → `f12s_high` (под сводом кругами, лицом по ходу,
// недосягаема) → `f12s_dive` 0,45 к месту рядом с героем, лицом к нему →
// `f12s_cast` 1,1: в первый тик два занавеса `f12_curtain` крест-накрест
// (предупреждение 1,1) — урон в 1,1, то есть в первый кадр `f12s_low` →
// `f12s_low` 1,05 (выдохлась — урон по ней ×1,4) → `f12s_rise` 0,45 → под свод.
// Смерть оглушает мамонта (вспышка и `f12_auroraburst` — у мозга).
//
// Риг — тот же, что у наездницы на мамонте (`shamanParts` из `f12-art.ts`,
// общий с боссом — не менять), позы — прежние. Через набор этажа: 8 честных
// сторон (бубен в левой, колотушка в правой), кадры 24 к/с от `pose.t`, кадр
// обрезан по рисунку, вспышка — из кольца холстов, свой предел кеша. Прыжок 22
// (присела на спине → толчок, руки вверх, ленты бьют вниз, взмыла), под сводом
// 12 (ленты по ветру, 12 к/с, фаза от id; крен в поворот — `rot`, без новых
// кадров), пике 11, колдовство 27 (тормозит у пола — бубен вверх, три удара,
// руки к небу и ленты вспыхивают к 1,1), выдох 3 (кадр 0 — руки ещё в небе:
// занавесы падают в этот миг) + дыхание 4 на коленях, взлёт 11, смерть 25 (до
// 1,0 с; `linger` 1,3 — падает, сгибается, ленты гаснут; дальше тает). Удар
// героя — `hurtFx`. Прогрев — вместе с мамонтом (`f12-art.ts` вешает
// `shamanWarm` на `f12boss` после его кадров): к фазе 3 все режимы во всех
// сторонах готовы, в бою кадры не строятся.

import { paintSim, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  beatAt,
  BODY0,
  kf,
  scaleBuild,
  SH_HIGH,
  SH_S,
  SH_SC,
  shamanParts,
  shHands,
} from './f12-art';
import type { ShO } from './f12-art';
import { clamp01, ease, TAU } from './f12-rig';
import {
  angD,
  clamp,
  dirOf,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  paintMob,
  RIM_C,
  rimLight,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Part, V3 } from './f12-mobkit';

const lerp3 = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

/** Полёт: корпус наклонён по ходу, ноги отстают, бубен вперёд, ленты сзади. */
function shFly(lean: number, rib: number): ShO {
  return {
    body: {
      ...BODY0,
      s: SH_S,
      lean,
      handL: [3.5, -3.2, 12.5],
      handR: [-1, 4, 11],
      feet: [
        [-3.5 - lean * 2.5, -1.6, 1.5 + lean * 3.5],
        [-2.5 - lean * 2.5, 1.6, 0.5 + lean * 4],
      ],
    },
    drum: 0,
    beat: 0,
    aurora: 1,
    rib,
    ribA: 1.1,
    ribUp: 0.12,
    ribLen: 1,
    hem: Math.min(1, lean * 1.3),
  };
}

const LEN: Record<string, number> = {
  jump: 22,
  high: 12,
  dive: 11,
  cast: 27,
  lowb: 3,
  low: 4,
  rise: 11,
  die: 25,
};

/** Поза кадра `f` (24 к/с; под сводом — 12 к/с, дыхание — 10 к/с). */
function pose(anim: string, f: number): ShO {
  const t = f / 24;
  switch (anim) {
    case 'jump': {
      // Спрыгнула со спины мамонта и взмыла.
      const k = clamp01((t - 0.1) / 0.5);
      const o = shFly(lerp(-0.1, 0.65, ease(k)), t * 7);
      const up = 1 - ease(clamp01((t - 0.3) / 0.6));
      const hd = shHands(0, 0);
      o.body.handL = lerp3(hd.L, [1.6, -3.4, 19.5], up);
      o.body.handR = lerp3([-1, 4, 11], [1.6, 3.4, 19.5], up);
      o.body.crouch = t < 0.1 ? 2 : 0;
      if (t < 0.3) o.body.feet = undefined;
      o.ribUp = kf(t, [
        [0, -1],
        [0.5, -0.6],
        [0.9, 0.12],
      ]);
      o.ribA = 1.4;
      o.aurora = kf(t, [
        [0, 1.3],
        [0.9, 1],
      ]);
      return o;
    }
    case 'dive': {
      // Пике к месту колдовства: головой вниз, руки назад, ленты рвутся вверх.
      const o = shFly(1.0, t * 12);
      o.body.handL = [-1.5, -4, 12];
      o.body.handR = [-1.5, 4, 12];
      o.ribUp = 1.3;
      o.ribA = 0.6;
      return o;
    }
    case 'cast': {
      // Тормозит у пола — бубен вверх, три удара — руки к небу, ленты встают
      // и вспыхивают к 1,1 с (занавесы падают в этот миг).
      const o = shFly(
        kf(t, [
          [0, 0.9],
          [0.12, -0.12, 'o'],
          [1.0, -0.2],
          [1.1, -0.3],
        ]),
        t * 9,
      );
      o.body.feet = undefined;
      o.body.wide = 0.8;
      o.drum = kf(t, [
        [0.08, 0],
        [0.3, 1, 'o'],
      ]);
      o.beat = beatAt(t, [0.45, 0.65, 0.85]);
      const hd = shHands(o.drum, o.beat);
      const up = kf(t, [
        [0.92, 0],
        [1.05, 1, 'o'],
      ]);
      o.body.handL = lerp3(hd.L, [1.5, -3.3, 20.5], up);
      o.body.handR = lerp3(hd.R, [1.5, 3.3, 20.5], up);
      o.ribUp = kf(t, [
        [0, 1.2],
        [0.2, 0.6],
        [0.95, 1.7],
        [1.1, 2.2],
      ]);
      o.ribA = kf(t, [
        [0, 0.8],
        [1.1, 1.8],
      ]);
      o.aurora = kf(t, [
        [0, 0.8],
        [0.9, 1.4],
        [1.1, 2],
      ]);
      o.hem = kf(t, [
        [0, 1],
        [0.2, 0.2],
      ]);
      return o;
    }
    case 'lowb':
    case 'low': {
      // Выдохлась: у самого пола, на коленях, грудь ходит — бей сейчас.
      // `lowb` — первые 0,12 с: руки из неба вниз (кадр 0 — контакт занавесов).
      const fP = anim === 'low' ? f : 0;
      const o = shFly(0.55 + 0.07 * Math.sin((fP / 4) * TAU), fP * 0.6);
      o.body.feet = undefined;
      o.body.kneel = 1;
      o.body.crouch = 2.2 + 0.4 * Math.sin((fP / 4) * TAU);
      o.body.handL = [2.5, -3.6, 5];
      o.body.handR = [2.5, 3.6, 4.5];
      o.ribUp = -1.4;
      o.ribA = 0.25;
      o.ribLen = 0.85;
      o.aurora = 0.25;
      o.hem = 0;
      if (anim === 'lowb') {
        const k = ease(t / 0.12);
        o.body.handL = lerp3([1.5, -3.3, 20.5], [2.5, -3.6, 5], k);
        o.body.handR = lerp3([1.5, 3.3, 20.5], [2.5, 3.6, 4.5], k);
        o.ribUp = lerp(2.2, -1.4, k);
        o.aurora = lerp(2, 0.25, k);
      }
      return o;
    }
    case 'rise': {
      // Взмывает: присела глубже — толчок, ленты хлещут вниз.
      const o = shFly(
        kf(t, [
          [0, 0.55],
          [0.12, 0.8],
          [0.45, 0.65],
        ]),
        t * 10,
      );
      if (t < 0.15) {
        o.body.feet = undefined;
        o.body.kneel = 1;
        o.body.crouch = kf(t, [
          [0, 2.2],
          [0.12, 3],
        ]);
      }
      o.ribUp = kf(t, [
        [0, -1.4],
        [0.15, -1.2],
        [0.45, 0.12],
      ]);
      o.ribA = 1.6;
      o.aurora = kf(t, [
        [0, 0.3],
        [0.2, 1.2],
        [0.45, 1],
      ]);
      return o;
    }
    case 'die': {
      // Падает с высоты, сгибается, ленты гаснут и опадают.
      const o = shFly(
        kf(t, [
          [0, -0.45],
          [0.3, -0.2],
          [0.45, 0.9],
          [0.9, 1.35],
        ]),
        t * 6,
      );
      o.body.feet = undefined;
      o.body.kneel = kf(t, [
        [0.3, 0],
        [0.5, 1],
      ]);
      o.body.handL = lerp3([1, -5, 17], [3, -4, 2], clamp01((t - 0.3) / 0.4));
      o.body.handR = lerp3([1, 5, 17], [3, 4, 2], clamp01((t - 0.3) / 0.4));
      o.ribLen = kf(t, [
        [0, 1],
        [1.0, 0],
      ]);
      o.ribUp = kf(t, [
        [0, 1.5],
        [0.6, -1.5],
      ]);
      o.aurora = kf(t, [
        [0, 2],
        [0.15, 1.5],
        [1.0, 0],
      ]);
      o.hem = 0;
      return o;
    }
  }
  // Под сводом кругами — ленты по ветру (полный взмах за 1 с).
  return shFly(0.65, (f / LEN.high) * TAU);
}

const LIST = Object.entries(LEN) as [string, number][];
const TOTAL = LIST.reduce((s, [, n]) => s + n, 0);
const K = kindOf('f12_shaman', { w: 76, h: 92, ox: 38, oy: 70 }, Math.ceil(TOTAL * 8 * 1.08));

function build(anim: string, f: number): Build {
  const parts: Part[] = [];
  const r = shamanParts(parts, pose(anim, f), 'normal', (p) => p);
  return scaleBuild({ parts, eyes: r.eyes, post: (p) => rimLight(p, RIM_C, 0.38) }, SH_SC);
}

/** Прогрев всех режимов во всех сторонах (вешается и на мамонта — до фазы 3). */
export function shamanWarm() {
  return warmAll(K, LIST, build);
}

/** Крен в поворот под сводом: курс скорости, сглажено. */
const BANK = new WeakMap<Mob, { a: number; r: number; now: number }>();
function bankOf(m: Mob, now: number, on: boolean): number {
  const vx = m.vx ?? 0;
  const vy = m.vy ?? 0;
  const a = Math.atan2(vy, vx);
  let b = BANK.get(m);
  if (!b) {
    BANK.set(m, (b = { a, r: 0, now }));
    return 0;
  }
  const dt = clamp(now - b.now, 0, 0.1);
  if (dt <= 0) return b.r;
  b.now = now;
  const rate = on && Math.hypot(vx, vy) > 0.5 ? angD(a, b.a) / dt : 0;
  b.a = a;
  b.r += (clamp(rate * 0.2, -0.2, 0.2) - b.r) * Math.min(1, dt * 4);
  return b.r;
}

const GHOST = { every: 0.05, life: 0.22, tint: '#9affd8', alpha: 0.3 };

paintMob('f12_shaman', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  let want = m.face ?? 0;
  if (mode === 'f12s_jump') {
    // Спрыгнула со спины мамонта: смотрит туда же, куда он.
    const mam = paintSim()?.mobs.find((x) => x.kind === 'f12boss');
    if (mam) want = mam.face;
  }
  const v = visOf(m, p, want, 10);
  const ex: Partial<MobFrame> = { shadow: 4, still: true, lift: 0.01 };
  let anim = 'high';
  let f = 0;
  const high = mode === 'f12s_high';
  const bank = bankOf(m, now, high);
  switch (mode) {
    case 'f12s_jump':
      anim = 'jump';
      f = fi(t, LEN.jump - 1);
      ex.lift = kf(t, [
        [0, 14],
        [0.1, 12, 'o'],
        [0.55, SH_HIGH + 8, 'o'],
        [0.9, SH_HIGH],
      ]);
      ex.ghost = GHOST;
      ex.shadow = 3.5;
      break;
    case 'f12s_dive': {
      anim = 'dive';
      f = fi(t, LEN.dive - 1);
      const k = clamp01(t / 0.45);
      ex.lift = lerp(SH_HIGH, 5, k * k);
      ex.ghost = { every: 0.035, life: 0.18, tint: '#9affd8', alpha: 0.4 };
      break;
    }
    case 'f12s_cast':
      anim = 'cast';
      f = fi(t, LEN.cast - 1);
      ex.lift = kf(t, [
        [0, 5],
        [0.1, 3.5, 'o'],
        [0.3, 4.5],
        [1.1, 7.5],
      ]);
      if (t < 0.12) {
        const q = 1 - t / 0.12;
        ex.sy = 1 - 0.1 * q;
        ex.sx = 1 + 0.08 * q;
      }
      ex.shadow = 5;
      break;
    case 'f12s_low':
      if (t < 0.12) {
        anim = 'lowb';
        f = fi(t, LEN.lowb - 1);
        ex.lift = lerp(7.5, 1.5, ease(t / 0.12));
      } else {
        anim = 'low';
        f = Math.floor(t * 10) % LEN.low;
        ex.lift = 1.5;
      }
      ex.shadow = 5;
      break;
    case 'f12s_rise':
      anim = 'rise';
      f = fi(t, LEN.rise - 1);
      ex.lift = kf(t, [
        [0, 1.5],
        [0.12, 0.8, 'o'],
        [0.45, SH_HIGH, 'o'],
      ]);
      ex.ghost = { every: 0.04, life: 0.2, tint: '#9affd8', alpha: 0.32 };
      break;
    case 'dying':
      anim = 'die';
      f = fi(t, LEN.die - 1);
      ex.lift = kf(t, [
        [0, 6],
        [0.3, 0.01, 'i'],
        [0.36, 1, 'o'],
        [0.45, 0.01, 'i'],
      ]);
      ex.linger = 1.3;
      ex.alpha = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.45) : 1;
      ex.shadow = 5;
      break;
    case 'escape':
      f = idlePh(m, now, 12, LEN.high);
      ex.lift = SH_HIGH + t * 50;
      ex.alpha = Math.max(0, 1 - t / 0.4);
      break;
    default:
      // Под сводом кругами — недосягаема: чуть прозрачна, ленты по ветру.
      f = idlePh(m, now, 12, LEN.high);
      ex.lift = SH_HIGH + Math.sin(now * 1.7) * 1.5;
      ex.alpha = 0.88;
      ex.shadow = 3.2;
  }
  if (high) ex.rot = bank;
  const fr = frameOf(K, anim, f, dirOf(v.yaw), p, () => build(anim, f));
  if (mode !== 'dying') hurtFx(v, now, 1.5, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_shaman', shamanWarm);
