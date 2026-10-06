// Этаж 8 — тело нечисти в кимоно (анимации мобов 8): общий двуногий риг для
// беса, мечника, многорукого, барабанщика, казначея и струнника. Поза — числа
// (`OniO`): таз, наклоны, стопы и кисти; колени и локти — по IK. Кимоно —
// эллипсоид груди с узором в осях тела (ворот, пояс-оби, герб), хакама —
// расширяющиеся книзу штанины со складками, широкий рукав висит полотнищем.
// Рукава, волосы и хвост берут точки из позы «в прошлом» (`lag`) — отстают
// и доигрывают после остановки тела.

import {
  F3,
  ik,
  PI,
  Rig,
  vadd,
  vlerp,
  vmul,
  vsub,
  type Mat,
  type PoseO,
  type RGBA,
  type Tones,
  type V3,
} from './f8-mobkit';

export interface OniStyle {
  skin: Tones;
  top: Tones;
  pants: Tones;
  under: RGBA;
  sash: RGBA;
  hair: Tones | null;
  hairKind: 'bald' | 'knot' | 'tail' | 'wild' | 'long';
  horns: 0 | 1 | 2;
  horn: Tones;
  eye: RGBA;
  /** Длина ноги (бедро + голень), пиксели мира. */
  leg: number;
  /** Полуширина таза. */
  hipW: number;
  /** Высота корпуса (таз → шея). */
  torso: number;
  /** Полуширина плеч и полутолщина груди. */
  chestW: number;
  chestD: number;
  headR: number;
  /** Длина руки (плечо + предплечье). */
  arm: number;
  /** Висящий рукав кимоно: длина полотнища (0 — голая рука). */
  sleeve: number;
  hakama: boolean;
  /** Голый торс (бес): кожа вместо кимоно. */
  bare?: boolean;
  /** Набедренная повязка. */
  loin?: RGBA;
  /** Живот барабаном — полуось. */
  belly?: number;
  crest?: RGBA;
  fang?: boolean;
  /** Толщина рук и ног (1 — обычная). */
  thick?: number;
  /** Когти на кистях — цвет (светлые, видны на силуэте). */
  claw?: RGBA;
}

/** Поза двуногого: всё — числа (ключи смешиваются). */
export interface OniO extends PoseO {
  /** Таз: вперёд, вправо, вверх от стойки. */
  hf: number;
  hs: number;
  hu: number;
  /** Наклон корпуса вперёд, крен вправо, поворот плеч вправо (рад). */
  lean: number;
  roll: number;
  twist: number;
  /** Голова: кивок вниз, поворот вправо, крен. */
  hp: number;
  hy: number;
  hr: number;
  /** Стопы в осях тела от точки ног (вперёд, вправо, вверх). */
  fL: V3;
  fR: V3;
  /** Кисти в осях корпуса от плеча (вперёд, вправо, вверх). */
  aL: V3;
  aR: V3;
  /** Куда смотрят локти (оси корпуса). */
  eL: V3;
  eR: V3;
  /** Рот 0…1, прищур 0…1, брови (злость) 0…1. */
  mouth: number;
  squint: number;
  brow: number;
  /** Глаза закрыты (сон) 0/1. */
  shut: number;
}

export function oniBase(st: OniStyle): OniO {
  const w = st.hipW;
  return {
    hf: 0,
    hs: 0,
    hu: 0,
    lean: 0.06,
    roll: 0,
    twist: 0,
    hp: 0,
    hy: 0,
    hr: 0,
    fL: [0.4, -w * 1.05, 0],
    fR: [-0.4, w * 1.05, 0],
    aL: [0.5, -0.9, -st.arm * 0.9],
    aR: [0.5, 0.9, -st.arm * 0.9],
    eL: [-1, -0.5, 0],
    eR: [-1, 0.5, 0],
    mouth: 0,
    squint: 0,
    brow: 0.4,
    shut: 0,
  };
}

/** Суставы позы в мире кадра (точка ног — начало). */
export interface OniJ {
  B: F3;
  /** Таз и рамка корпуса. */
  P: V3;
  C: F3;
  /** Голова: рамка (начало — середина черепа). */
  H: F3;
  neck: V3;
  shL: V3;
  shR: V3;
  elL: V3;
  elR: V3;
  haL: V3;
  haR: V3;
  hipL: V3;
  hipR: V3;
  knL: V3;
  knR: V3;
  ftL: V3;
  ftR: V3;
}

export function oniJoints(o: OniO, st: OniStyle, yaw: number): OniJ {
  const B = F3.yaw(yaw);
  const hz = st.leg * 0.95 + o.hu;
  const P = B.p(o.hf, o.hs, hz);
  const PF = B.at(o.hf, o.hs, hz);
  const C = PF.turn(o.twist).pitch(o.lean).roll(o.roll);
  const neck = C.p(0, 0, st.torso);
  const H = B.at(0, 0, 0)
    .turn(o.twist * 0.6 + o.hy)
    .pitch(o.lean * 0.35 + o.hp)
    .roll(o.roll * 0.5 + o.hr);
  const Hc = new F3(vadd(neck, H.v(0.1 * st.headR, 0, st.headR * 0.92)), H.f, H.s, H.u);
  const shL = C.p(0, -st.chestW * 0.92, st.torso * 0.84);
  const shR = C.p(0, st.chestW * 0.92, st.torso * 0.84);
  const a1 = st.arm * 0.5;
  const a2 = st.arm * 0.52;
  const haL = reach(shL, vadd(shL, C.v(o.aL[0], o.aL[1], o.aL[2])), a1 + a2);
  const haR = reach(shR, vadd(shR, C.v(o.aR[0], o.aR[1], o.aR[2])), a1 + a2);
  const elL = ik(shL, haL, a1, a2, C.v(o.eL[0], o.eL[1], o.eL[2]));
  const elR = ik(shR, haR, a1, a2, C.v(o.eR[0], o.eR[1], o.eR[2]));
  const hipL = PF.p(0, -st.hipW * 0.75, -0.4);
  const hipR = PF.p(0, st.hipW * 0.75, -0.4);
  const l1 = st.leg * 0.5;
  const l2 = st.leg * 0.52;
  const ftL = reach(hipL, B.p(o.fL[0], o.fL[1], o.fL[2]), l1 + l2 + 0.4);
  const ftR = reach(hipR, B.p(o.fR[0], o.fR[1], o.fR[2]), l1 + l2 + 0.4);
  const knL = ik(hipL, vadd(ftL, [0, 0, 0.6]), l1, l2, B.v(1, -0.25, 0.2));
  const knR = ik(hipR, vadd(ftR, [0, 0, 0.6]), l1, l2, B.v(1, 0.25, 0.2));
  return { B, P, C, H: Hc, neck, shL, shR, elL, elR, haL, haR, hipL, hipR, knL, knR, ftL, ftR };
}

const TABI: Mat = {
  T: [
    [138, 132, 120, 255],
    [200, 192, 176, 255],
    [236, 228, 212, 255],
    [255, 255, 255, 255],
  ],
};

/** Материалы стиля — один раз на стиль. */
interface OniMats {
  skin: Mat;
  skinFar: Mat;
  top: Mat;
  sleeve: Mat;
  pants: Mat;
  hair: Mat | null;
  horn: Mat;
  sash: Mat;
}
const MATS = new WeakMap<OniStyle, OniMats>();
function matsOf(st: OniStyle): OniMats {
  let m = MATS.get(st);
  if (m) return m;
  const sashD: RGBA = [
    Math.round(st.sash[0] * 0.6),
    Math.round(st.sash[1] * 0.6),
    Math.round(st.sash[2] * 0.6),
    255,
  ];
  const underD: RGBA = [
    Math.round(st.under[0] * 0.75),
    Math.round(st.under[1] * 0.75),
    Math.round(st.under[2] * 0.75),
    255,
  ];
  const top: Mat = st.bare
    ? {
        T: st.skin,
        pat: (q, l) => {
          // Пояс и набедренная повязка поверх голого торса.
          if (q[2] < -0.62 && q[2] > -0.95) return l > 0.3 ? st.sash : sashD;
          return null;
        },
      }
    : {
        T: st.top,
        pat: (q, l) => {
          // Пояс-оби — полосой по низу груди.
          if (q[2] < -0.5 && q[2] > -0.86) return l > 0.35 ? st.sash : sashD;
          // Ворот: светлый клин нижнего кимоно спереди, кромка — светлым тоном.
          if (q[0] > 0.15 && q[2] > -0.5) {
            const half = 0.5 * (q[2] + 0.5);
            const a = Math.abs(q[1] + 0.06);
            if (a < half - 0.12) return l > 0.2 ? st.under : underD;
            if (a < half + 0.04) return st.top[3];
          }
          // Герб на спине.
          if (st.crest && q[0] < -0.6 && Math.abs(q[1]) < 0.2 && q[2] > 0.15 && q[2] < 0.5)
            return st.crest;
          return null;
        },
      };
  m = {
    skin: { T: st.skin },
    skinFar: { T: st.skin, bias: -0.12 },
    top,
    sleeve: { T: st.top },
    pants: {
      T: st.pants,
      // Складки хакама — тёмные полосы вдоль штанины.
      pat: st.hakama ? (q, l) => (Math.abs(q[1]) < 0.16 && l < 0.6 ? st.pants[0] : null) : undefined,
    },
    hair: st.hair ? { T: st.hair } : null,
    horn: { T: st.horn, spec: true },
    sash: { T: [st.sash, st.sash, st.sash, st.sash] },
  };
  MATS.set(st, m);
  return m;
}

export interface OniOpt {
  /** Поза «в прошлом» (на 2–4 кадра раньше): рукава, волосы, хвост тянутся за ней. */
  lag?: OniO;
  /** Снос ткани и волос встречным ходом (оси тела). */
  wind?: V3;
  /** Не рисовать голову (смерть: голова отдельно). */
  noHead?: boolean;
  /** Цвет глаз (облик): по умолчанию — из стиля. */
  eye?: RGBA;
  /** Глаза без свечения (мёртв). */
  dead?: boolean;
}

/** Двуногий в кимоно → риг. Вернёт суставы — для предметов в руках. */
export function oniRig(r: Rig, o: OniO, st: OniStyle, yaw: number, opt: OniOpt = {}): OniJ {
  const M = matsOf(st);
  const J = oniJoints(o, st, yaw);
  const L = opt.lag ? oniJoints(opt.lag, st, yaw) : J;
  const wind = opt.wind ?? [0, 0, 0];
  const windW = J.B.v(wind[0], wind[1], wind[2]);
  const th = st.thick ?? 1;
  const s = st.headR / 3.4;

  // Ноги: хакама — широкие штанины, иначе — голые ноги.
  for (const side of [-1, 1]) {
    const hip = side < 0 ? J.hipL : J.hipR;
    const kn = side < 0 ? J.knL : J.knR;
    const ft = side < 0 ? J.ftL : J.ftR;
    if (st.hakama) {
      r.cap(hip, kn, 1.9 * th, 2.25 * th, M.pants);
      const hem = vadd(ft, [0, 0, 0.9]);
      r.cap(kn, hem, 2.25 * th, 2.7 * th, M.pants);
      // Таби — светлая ступня из-под штанины.
      r.ell(atP(J.B, vadd(ft, J.B.v(0.9, 0, 0.5))), [0, 0, 0], [1.3, 0.8, 0.6], TABI);
    } else {
      r.cap(hip, kn, 1.15 * th, 0.95 * th, M.skin);
      r.cap(kn, ft, 0.95 * th, 0.75 * th, M.skin);
      r.ell(atP(J.B, vadd(ft, J.B.v(0.7, 0, 0.35))), [0, 0, 0], [1.2, 0.7, 0.5], M.skin);
    }
  }
  // Набедренная повязка (бес).
  if (st.loin) {
    const P0 = J.C.p(st.chestD * 0.6, 0, -0.4);
    const P1 = vadd(J.C.p(st.chestD * 0.75 + 0.6, 0, -3.2), vmul(vsub(L.P, J.P), 0.6));
    r.cap(P0, P1, 0.75, 0.55, { T: [darker2(st.loin, 0.4), st.loin, st.loin, hx2('#ffffff')] });
  }
  // Корпус: грудь эллипсоидом, таз — меньший эллипсоид.
  r.ell(J.C, [0, 0, st.torso * 0.5], [st.chestD, st.chestW, st.torso * 0.56], M.top);
  r.ell(J.C, [0, 0, 0.2], [st.chestD * 0.92, st.hipW * 1.05, st.torso * 0.28], st.hakama ? M.pants : M.top);
  if (st.belly) {
    const bR = st.belly;
    r.ell(J.C, [st.chestD * 0.55, 0, st.torso * 0.32], [bR * 0.85, bR, bR * 0.95], {
      T: st.skin,
      pat: (q, l) => (Math.abs(q[1]) < 0.12 && Math.abs(q[2] + 0.1) < 0.12 && q[0] > 0.8 && l < 0.9 ? st.skin[0] : null),
    });
  }

  // Руки: плечо — локоть в рукаве, предплечье и кисть.
  for (const side of [-1, 1]) {
    const sh = side < 0 ? J.shL : J.shR;
    const el = side < 0 ? J.elL : J.elR;
    const ha = side < 0 ? J.haL : J.haR;
    const elLag = side < 0 ? L.elL : L.elR;
    const shLag = side < 0 ? L.shL : L.shR;
    if (st.sleeve > 0) {
      r.cap(sh, el, 1.55 * th, 1.7 * th, M.sleeve);
      r.cap(el, ha, 0.95 * th, 0.85 * th, M.skin);
      // Полотнище рукава: верх — по руке, низ висит и отстаёт (поза в прошлом).
      const drop = st.sleeve;
      const dragE = vadd(vmul(vsub(elLag, el), 0.9), windW);
      const dragS = vadd(vmul(vsub(shLag, sh), 0.6), vmul(windW, 0.6));
      const a0 = vlerp(sh, el, 0.35);
      const b0 = vadd(el, vmul(vsub(el, sh), 0.12));
      const a1 = vadd(vadd(a0, [0, 0, -drop * 0.7]), dragS);
      const b1 = vadd(vadd(b0, [0, 0, -drop]), dragE);
      r.poly([a0, b0, b1, a1], M.sleeve);
    } else {
      r.cap(sh, el, 1.1 * th, 0.95 * th, M.skin);
      r.cap(el, ha, 0.95 * th, 0.8 * th, M.skin);
    }
    r.ball(ha, 1.05 * th, M.skin);
    if (st.claw) {
      // Когти: два светлых штриха от кисти по ходу предплечья.
      const dx = ha[0] - el[0];
      const dy = ha[1] - el[1];
      const dz = ha[2] - el[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const u: V3 = [dx / l, dy / l, dz / l];
      const sideV = J.B.v(0, 0.55, 0);
      for (const k of [-1, 1]) {
        const a = vadd(ha, vadd(vmul(u, 0.8), vmul(sideV, k)));
        r.line(a, vadd(a, vmul(u, 1.6)), st.claw, 0, 0.6);
      }
    }
  }

  // Голова.
  if (!opt.noHead) oniHead(r, J, L, st, o, s, windW, opt);
  return J;
}

/** Голова они: череп, лицо узором и точками, рога, волосы. */
function oniHead(
  r: Rig,
  J: OniJ,
  L: OniJ,
  st: OniStyle,
  o: OniO,
  s: number,
  windW: V3,
  opt: OniOpt,
): void {
  const M = matsOf(st);
  const H = J.H;
  const R = st.headR;
  r.ell(H, [0, 0, 0], [R * 0.95, R * 0.9, R], M.skin);
  // Челюсть вперёд — лицо не шар.
  r.ell(H, [R * 0.32, 0, -R * 0.42], [R * 0.6, R * 0.62, R * 0.5], M.skin);
  // Глаза: светятся (слой поверх темноты), закрытые — тёмная щель.
  const eyeC = opt.eye ?? st.eye;
  const ez = R * (0.12 - o.squint * 0.05);
  for (const sd of [-1, 1]) {
    const e = H.p(R * 0.86, sd * R * 0.36, ez);
    if (o.shut > 0.5 || opt.dead) r.dot(e, darker2(st.skin[0], 0.5), 0, 1, 0.7);
    else r.dot(e, eyeC, 1, 1, 0.7);
    // Брови: злой излом к переносице.
    if (o.brow > 0.2 && !opt.dead) {
      const b0 = H.p(R * 0.88, sd * R * 0.12, R * (0.28 - 0.1 * o.brow));
      const b1 = H.p(R * 0.8, sd * R * 0.58, R * (0.38 + 0.06 * o.brow));
      r.line(b0, b1, darker2(st.skin[0], 0.55), 0, 0.5);
    }
  }
  r.eye = H.p(R * 0.9, 0, ez);
  // Рот: щель или открытая пасть, клыки.
  const mz = -R * 0.5;
  if (o.mouth > 0.25) {
    r.ell(H, [R * 0.78, 0, mz - o.mouth * R * 0.12], [R * 0.2, R * 0.3, R * (0.12 + o.mouth * 0.2)], {
      T: [hx2('#1a0608'), hx2('#3a0c10'), hx2('#5a1418'), hx2('#7a2020')],
    });
  } else r.line(H.p(R * 0.9, -R * 0.22, mz), H.p(R * 0.9, R * 0.22, mz), darker2(st.skin[0], 0.6), 0, 0.5);
  if (st.fang) {
    r.dot(H.p(R * 0.92, -R * 0.2, mz - 0.6 - o.mouth * 0.4), hx2('#f4ecd8'), 0, 1, 0.8);
    r.dot(H.p(R * 0.92, R * 0.2, mz - 0.6 - o.mouth * 0.4), hx2('#f4ecd8'), 0, 1, 0.8);
  }
  // Рога они: со лба вверх и чуть вперёд, сужаются.
  const horn = (sd: number) => {
    const b = H.p(R * 0.35, sd * R * 0.42, R * 0.78);
    const m = H.p(R * 0.45, sd * R * 0.55, R * 1.45);
    const t = H.p(R * 0.8, sd * R * 0.5, R * 1.85);
    r.cap(b, m, 0.75 * s + 0.35, 0.5 * s + 0.2, M.horn);
    r.cap(m, t, 0.5 * s + 0.2, 0.15, M.horn);
  };
  if (st.horns === 1) {
    const b = H.p(R * 0.35, 0, R * 0.85);
    const m = H.p(R * 0.45, 0, R * 1.55);
    const t = H.p(R * 0.85, 0, R * 1.95);
    r.cap(b, m, 0.8 * s + 0.4, 0.55 * s + 0.2, M.horn);
    r.cap(m, t, 0.55 * s + 0.2, 0.15, M.horn);
  } else if (st.horns === 2) {
    horn(-1);
    horn(1);
  }
  // Волосы.
  if (!M.hair || st.hairKind === 'bald') return;
  const hairM = M.hair;
  // Снос волос — не дальше радиуса головы: на резком рывке позы (смерть, выпад)
  // хвост иначе вытягивался палкой на полкадра.
  const drag0 = vadd(vsub(L.H.o, H.o), windW);
  const dl = Math.hypot(drag0[0], drag0[1], drag0[2]);
  const drag = dl > R * 1.1 ? vmul(drag0, (R * 1.1) / dl) : drag0;
  if (st.hairKind === 'tail' || st.hairKind === 'knot') {
    // Макушка: шапка волос сверху и сзади, лицо открыто.
    r.ell(H, [-R * 0.22, 0, R * 0.18], [R * 0.85, R * 0.96, R * 0.92], hairM, (q) => q[0] > 0.55 && q[2] < 0.45);
    r.ball(H.p(-R * 0.25, 0, R * 1.05), R * 0.36, hairM);
    if (st.hairKind === 'tail') {
      // Тяжёлый хвост по спине — тянется за головой.
      const a = H.p(-R * 0.75, 0, R * 0.75);
      const b = vadd(H.p(-R * 1.55, 0, -R * 0.1), vmul(drag, 0.8));
      const c = vadd(H.p(-R * 1.75, 0, -R * 1.55), vmul(drag, 1.6));
      r.cap(a, b, R * 0.42, R * 0.36, hairM);
      r.cap(b, c, R * 0.36, R * 0.12, hairM);
    }
  } else if (st.hairKind === 'wild') {
    r.ell(H, [-R * 0.25, 0, R * 0.2], [R * 0.9, R * 1.02, R * 0.95], hairM, (q) => q[0] > 0.5 && q[2] < 0.5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 2.2;
      const b = H.p(-R * 0.3, Math.sin(a) * R * 0.8, R * 0.6 + Math.cos(a) * R * 0.3);
      const tip = vadd(H.p(-R * 1.5, Math.sin(a) * R * 1.6, R * 0.9 + Math.cos(a) * R * 0.9), vmul(drag, 0.8));
      r.cap(b, tip, R * 0.32, 0.2, hairM);
    }
  } else if (st.hairKind === 'long') {
    r.ell(H, [-R * 0.1, 0, R * 0.15], [R * 1.0, R * 1.05, R * 1.02], hairM, (q) => q[0] > 0.62 && q[2] < 0.35 && Math.abs(q[1]) < 0.75);
    const a = H.p(-R * 0.6, 0, R * 0.2);
    const b = vadd(H.p(-R * 1.0, 0, -R * 2.6), vmul(drag, 1.2));
    r.cap(a, b, R * 0.95, R * 0.8, hairM);
  }
}

/** Точка `b`, подтянутая к `a` не дальше `L` (кисть и стопа не рвут руку). */
function reach(a: V3, b: V3, L: number): V3 {
  const d = vsub(b, a);
  const l = Math.hypot(d[0], d[1], d[2]);
  return l <= L ? b : vadd(a, vmul(d, L / l));
}

/** Рамка с осями `F` в мировой точке `P`. */
export const atP = (F: F3, P: V3) => new F3(P, F.f, F.s, F.u);

const hx2 = (h: string): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
};
const darker2 = (c: RGBA, k: number): RGBA => [
  Math.round(c[0] * (1 - k)),
  Math.round(c[1] * (1 - k)),
  Math.round(c[2] * (1 - k)),
  255,
];

// ---- Ход ------------------------------------------------------------------------------------

/**
 * Шаг: фаза `ph` (0…1 — полный цикл, два шага), длина шага `L` (пиксели),
 * подъём стопы `up`. Опорная стопа стоит на полу, пока корпус едет; таз
 * качается вверх-вниз дважды за цикл, плечи — против таза, руки — против ног.
 */
export function gait(o: OniO, st: OniStyle, ph: number, L: number, up: number, arm = 1): OniO {
  const w = st.hipW;
  const foot = (p: number): V3 => {
    const q = ((p % 1) + 1) % 1;
    if (q < 0.5) return [L / 2 - L * (q / 0.5), 0, 0];
    const k = (q - 0.5) / 0.5;
    return [-L / 2 + L * k, 0, Math.sin(PI * k) * up];
  };
  const a = foot(ph);
  const b = foot(ph + 0.5);
  const sw = Math.cos(ph * 2 * PI);
  return {
    ...o,
    fL: [a[0] + 0.3, -w * 1.0, a[2]],
    fR: [b[0] - 0.3, w * 1.0, b[2]],
    hu: o.hu - Math.abs(Math.cos(ph * 2 * PI)) * up * 0.35 + up * 0.15,
    twist: o.twist - sw * 0.16,
    roll: o.roll + Math.sin(ph * 2 * PI) * 0.04,
    aL: [o.aL[0] - sw * L * 0.32 * arm, o.aL[1], o.aL[2] + Math.abs(sw) * 0.3 * arm],
    aR: [o.aR[0] + sw * L * 0.32 * arm, o.aR[1], o.aR[2] + Math.abs(sw) * 0.3 * arm],
  };
}
