// pets/21-bulldog.js : Бульдог Кастет (uncommon, dmg). Front kit, sits.
// A stocky fawn-and-white English bulldog sitting square to us: a head wider than his chest, heavy
// white jowls, a wide black nose under a thick nose roll, a frown of wrinkles, rose ears folded at
// the top corners, an underbite with two lower fangs showing. A white blaze and bib, white socks,
// bowed forelegs set wide. A spiked black collar with a steel ring and his number tag, spiked
// cuffs, two crossed plasters on his forehead and a brass knuckle-duster on his right paw — that's
// his name. Work: sizes up a stone block, winds up, punches it to rubble, admires his knuckles.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'bulldog';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#C4935F',
    furDeep: '#7D5A3A',
    furLit: '#E2BE92',
    belly: '#F3EBDD',
    muzzle: '#F3EBDD',
    white: '#F3EBDD',
    sock: '#F3EBDD',
    paw: '#F3EBDD',
    ear: '#9E7049',
    earIn: '#6E4A30',
    skin: '#D9968C',
    skinDeep: '#A8605A',
    nose: '#2C2523',
    blush: '#E39088',
    mouth: '#5E2220',
    tongue: '#E88E86',
    pad: '#6A4A44',
    wrinkle: '#8C6440',
    leather: '#2E2724',
    steel: '#C9CED2',
    steelDeep: '#737B81',
    brass: '#D2A64E',
    brassDeep: '#8A6424',
    plaster: '#EBD3AE',
    stone: '#8C877F',
    stoneTop: '#ADA89F',
    stoneDeep: '#57524C',
    ore: '#E8B84A',
  };

  // ---- the face: blaze, wrinkles, brows, nose roll, jowl creases, nostrils, plasters
  function blaze(c2, R) {
    const T = R.Mh;
    const pts = [R.hl(-20, -170, 0.5), R.hl(20, -170, 0.5), R.hl(30, -80, 0.8), R.hl(58, 6, 0.9), R.hl(-58, 6, 0.9), R.hl(-30, -80, 0.8)];
    K.fill(c2, M.all(T, K.smooth(pts, 4)), C.white);
  }

  function faceMarks(ctx, R, B) {
    const T = R.Mh;
    const soft = { color: C.wrinkle, boil: B };
    // a frown: three short wrinkles between the brows
    for (let k = -1; k <= 1; k++) {
      const y = -74 + Math.abs(k) * 10;
      K.line(ctx, M.all(T, K.curve([R.hl(k * 26 - 16, y + 4, 0.9), R.hl(k * 26, y - 6, 0.9), R.hl(k * 26 + 16, y + 4, 0.9)], 4)), Object.assign({ width: 5, seed: sd('wr', k), taper: [3, 3] }, soft));
    }
    // heavy brows, low at the middle: a tough frown even when he grins
    for (const s of [-1, 1]) {
      const br = M.all(T, K.curve([R.hl(s * 58, -58, 0.85), R.hl(s * 100, -78, 0.85), R.hl(s * 150, -66, 0.7)], 5));
      K.line(ctx, br, { width: 17, color: P.ink, seed: sd('brow', s), boil: B, taper: [6, 8] });
      K.line(ctx, br, { width: 10, color: C.furDeep, seed: sd('brow', s), boil: B, taper: [6, 8] });
    }
    // the nose roll: a thick fold of skin over the nose
    const roll = M.all(T, K.curve([R.hl(-70, 2, 1), R.hl(-30, -14, 1), R.hl(30, -14, 1), R.hl(70, 2, 1)], 5));
    K.line(ctx, roll, { width: 6, color: C.wrinkle, seed: sd('roll'), boil: B, taper: [4, 4] });
    // the creases of the jowls, from the nose down past the corners of the mouth
    for (const s of [-1, 1]) K.line(ctx, M.all(T, K.curve([R.hl(s * 30, 40, 1), R.hl(s * 70, 70, 1), R.hl(s * 104, 112, 1), R.hl(s * 110, 140, 0.95)], 5)), { width: 5, seed: sd('jowl', s), boil: B, taper: [3, 6] });
    // nostrils
    for (const s of [-1, 1]) K.fill(ctx, M.all(T, L.ellipsePts(...R.hl(s * 16, 26, 1), 8, 5, 10, s * 0.5)), '#0E0A0A');
    // two crossed plasters high on his right temple
    const pc = R.hl(-118, -104, 0.6);
    for (const a of [-0.7, 0.75]) {
      const TP = M.chain(T, M.tr(pc[0], pc[1]), M.rot(a));
      const pl = M.all(TP, L.rrectPts(-40, -12, 80, 24, 10, 5));
      K.fill(ctx, pl, C.plaster);
      K.fill(ctx, M.all(TP, L.rrectPts(-13, -9, 26, 18, 4, 3)), L.mix(C.plaster, '#FFFFFF', 0.4));
      L.inkPath(ctx, pl, { closed: true, width: 3.4, seed: sd('pl', a), boil: B, wobble: 0.3, taper: 0 });
      for (const [x, y] of [[-28, -4], [-24, 4], [24, -4], [28, 4]]) K.fill(ctx, M.all(TP, L.ellipsePts(x, y, 1.8, 1.8, 6)), '#A58A64');
    }
  }

  // ---- metalwork
  function spike(ctx, base, dir, h, w, B, seed) {
    const nx = -dir[1], ny = dir[0];
    const s = [[base[0] - nx * w, base[1] - ny * w], [base[0] + dir[0] * h, base[1] + dir[1] * h], [base[0] + nx * w, base[1] + ny * w]];
    K.fill(ctx, s, C.steel);
    K.fill(ctx, [s[0], s[1], [base[0], base[1]]], C.steelDeep, 0.6);
    L.inkPath(ctx, s, { closed: true, width: 3, seed, boil: B, smooth: false, taper: 0, wobble: 0.2 });
  }

  function collar(ctx, R, B) {
    const T = R.Mb;
    const cl = [[-200, -326], [-126, -300], [0, -290], [126, -300], [200, -326]];
    const line = M.all(T, K.curve(cl, 8));
    K.band(ctx, line, 36, { fill: C.leather, deep: '#141010', seed: sd('collar'), boil: B, width: 5 });
    // spikes along the lower edge, pointing down and out
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const k = Math.floor(u * (line.length - 1));
      const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dir = [-(b[1] - a[1]) / tl, (b[0] - a[0]) / tl];
      if (dir[1] < 0) (dir[0] = -dir[0]), (dir[1] = -dir[1]);
      const base = [line[k][0] + dir[0] * 10, line[k][1] + dir[1] * 10];
      spike(ctx, base, dir, 26, 10, B, sd('spk', i));
    }
    // the steel ring and the number tag
    const ring = M.ap(T, [0, -264]);
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 20, 22, 22), { closed: true, width: 14, color: P.ink, seed: sd('ring'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 20, 22, 22), { closed: true, width: 7, color: C.steel, seed: sd('ring'), boil: B, wobble: 0.3 });
    const tc = [ring[0], ring[1] + 48];
    const tag = L.ellipsePts(tc[0], tc[1], 30, 28, 24);
    F().form(ctx, tag, C.steel, B, sd('tag'), { width: 5, off: 0.12, shine: 0.9, hatch: 0.4 });
    K.line(ctx, [[tc[0] - 12, tc[1] - 10], [tc[0] - 12, tc[1] + 10]], { width: 4, color: C.steelDeep, seed: sd('t1'), boil: B, smooth: false, taper: 0 });
    K.line(ctx, [[tc[0] + 2, tc[1] - 10], [tc[0] + 12, tc[1] - 10], [tc[0] + 4, tc[1] + 10]], { width: 4, color: C.steelDeep, seed: sd('t7'), boil: B, smooth: false, taper: 0 });
  }

  function cuff(ctx, R, B, side, end) {
    const { sh } = F().sitPaw(R, side);
    const dx = end[0] - sh[0], dy = end[1] - sh[1], dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
    const c = [end[0] - ux * 74, end[1] - uy * 74];
    const w = 46, h = 17;
    const band = [[c[0] - nx * w - ux * h, c[1] - ny * w - uy * h], [c[0] + nx * w - ux * h, c[1] + ny * w - uy * h], [c[0] + nx * w + ux * h, c[1] + ny * w + uy * h], [c[0] - nx * w + ux * h, c[1] - ny * w + uy * h]];
    K.fill(ctx, band, C.leather);
    L.inkPath(ctx, band, { closed: true, width: 4, seed: sd('cuff', side), boil: B, smooth: false, taper: 0, wobble: 0.3 });
    // a stud facing us and a spike to the outside
    for (const k of [-0.3, 0.3]) {
      const s = [c[0] + nx * w * k, c[1] + ny * w * k];
      K.fill(ctx, L.ellipsePts(s[0], s[1], 8, 8, 10), C.steel);
      K.fill(ctx, L.ellipsePts(s[0] - 2, s[1] - 3, 3, 2, 8), '#FFFFFF', 0.9);
      L.inkPath(ctx, L.ellipsePts(s[0], s[1], 8, 8, 10), { closed: true, width: 2.6, seed: sd('stud', side, k), boil: B, wobble: 0.2 });
    }
    const o = -side * Math.sign(nx || 1);
    spike(ctx, [c[0] + nx * w * -o * 0.92, c[1] + ny * w * -o * 0.92], [nx * -o, ny * -o], 24, 10, B, sd('cspk', side));
  }

  /** The knuckle-duster over the toes of a paw: a brass plate with four finger holes, a grip below. */
  function knuckles(ctx, c, a, B, glint) {
    const T = M.chain(M.tr(c[0], c[1]), M.rot(a));
    const out = [];
    // four round bumps along the top, then the grip curving under
    for (let k = 0; k < 4; k++) {
      const cx = -39 + k * 26;
      for (let i = 0; i <= 6; i++) {
        const t = Math.PI + (i / 6) * Math.PI;
        out.push([cx + Math.cos(t) * 14, -10 + Math.sin(t) * 16]);
      }
    }
    out.push([54, -6], [50, 12], [28, 24], [0, 28], [-28, 24], [-50, 12], [-54, -6]);
    const pts = M.all(T, out);
    F().form(ctx, pts, C.brass, B, sd('kd'), { width: 5, off: 0.12, shine: 1, hatch: 0.3, dark: C.brassDeep, smooth: false });
    for (let k = 0; k < 4; k++) {
      const h = M.all(T, L.ellipsePts(-39 + k * 26, -12, 8, 9, 12));
      K.fill(ctx, h, '#3A2410');
      L.inkPath(ctx, h, { closed: true, width: 2.6, seed: sd('kh', k), boil: B, wobble: 0.2 });
    }
    if (glint) K.fx.star(ctx, ...M.ap(T, [46, -34]), 28 * glint, B, sd('kgl'), '#FFF1C4');
  }

  /** An irregular chunk of stone: six corners at uneven distances. */
  const rock = (x, y, r, a, k) => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const t = a + (i / 6) * Math.PI * 2;
      const rr = r * (0.7 + 0.45 * L.h3(k, i, 11));
      out.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.85]);
    }
    return out;
  };

  // ---- the stone block he punches (to his left, our right)
  function block(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (!fx.block) return;
    const g = K.GROUND, x0 = K.CXF + 322, x1 = x0 + 150, top = g - 150;
    if (fx.block > 2) return;
    {
      const front = [[x0, g], [x0, top], [x1, top], [x1, g]];
      const lid = [[x0, top], [x0 + 30, top - 36], [x1 + 30, top - 36], [x1, top]];
      const side = [[x1, top], [x1 + 30, top - 36], [x1 + 30, g - 36], [x1, g]];
      F().form(ctx, side, C.stoneDeep, B, sd('bs'), { width: 6, off: 0.1, hatch: 0.5, rim: false, smooth: false });
      F().form(ctx, lid, C.stoneTop, B, sd('bt'), { width: 6, off: 0.1, hatch: 0.2, rim: false, smooth: false });
      F().form(ctx, front, C.stone, B, sd('bf'), {
        width: 7,
        off: 0.08,
        hatch: 0.5,
        smooth: false,
        inside(c2) {
          L.stipple(c2, front, { spacing: 15, r: [1.6, 3.2], color: C.stoneDeep, alpha: 0.7, seed: sd('bst'), boil: B });
          for (const [x, y, r] of [[36, -106, 11], [106, -54, 9], [62, -36, 7], [124, -124, 7]]) {
            K.fill(c2, L.ellipsePts(x0 + x, g + y, r, r * 0.75, 10, 0.5), C.ore);
            L.inkPath(c2, L.ellipsePts(x0 + x, g + y, r, r * 0.75, 10, 0.5), { closed: true, width: 2.4, seed: sd('bo', x), boil: B, wobble: 0.2 });
          }
          if (fx.block === 2) {
            // cracks running from where the fist landed
            const o = [x0 + 30, top + 60];
            for (let i = 0; i < 5; i++) {
              const a = -0.9 + i * 0.45;
              const pts = [o];
              let p = o;
              for (let s = 1; s <= 3; s++) {
                p = [p[0] + Math.cos(a + (s % 2 ? 0.3 : -0.3)) * 42, p[1] + Math.sin(a + (s % 2 ? 0.3 : -0.3)) * 42];
                pts.push(p);
              }
              K.line(c2, pts, { width: 6, seed: sd('cr', i), boil: B, smooth: false, taper: [2, 10] });
            }
          }
        },
      });
      return;
    }
  }

  /** The block breaking (in front of him): chunks flying, then rubble and a nugget on the floor. */
  function rubble(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (!fx.block || fx.block < 3) return;
    const g = K.GROUND, cx = K.CXF + 410;
    if (fx.block === 3) {
      const t = fx.t;
      K.fx.cloud(ctx, [cx, g - 10], 170, t, B, sd('bdust'));
      for (let i = 0; i < 7; i++) {
        const vx = (i - 2.4) * 110 + 60, vy = -420 - 180 * L.h3(i, 2, 7);
        const x = cx + vx * t, y = g - 90 + vy * t + 620 * t * t;
        const r = 30 + 18 * L.h3(i, 3, 7);
        const pts = rock(x, y, r, i + t * 4, i);
        F().form(ctx, pts, i === 3 ? C.ore : i % 2 ? C.stone : C.stoneTop, B, sd('deb', i), {
          width: 5,
          off: 0.1,
          hatch: 0.4,
          rim: false,
          smooth: false,
          inside: (c2) => i !== 3 && L.stipple(c2, pts, { spacing: 13, r: [1.4, 2.6], color: C.stoneDeep, alpha: 0.7, seed: sd('ds', i), boil: B }),
        });
      }
      return;
    }
    // rubble on the floor and a nugget of ore glinting
    for (let i = 0; i < 5; i++) {
      const x = cx - 100 + i * 48 + 10 * L.h3(i, 4, 7), r = 20 + 12 * L.h3(i, 5, 7);
      F().form(ctx, rock(x, g - r * 0.5, r, i * 0.7, i + 9).map(([px, py]) => [px, g - r * 0.5 + (py - g + r * 0.5) * 0.65]), i % 2 ? C.stone : C.stoneTop, B, sd('rb', i), { width: 5, off: 0.1, hatch: 0.4, rim: false, smooth: false });
    }
    F().form(ctx, L.ellipsePts(cx + 10, g - 20, 22, 16, 8, 0.4), C.ore, B, sd('nug'), { width: 5, off: 0.12, shine: 1, hatch: 0.2, rim: false });
    if (fx.nugStar) K.fx.star(ctx, cx + 44, g - 64, 34, B, sd('nugs'), '#FFF1C4');
  }

  const WORK = [
    { turn: 0.45, look: [0.75, 0.35], lid: 0.45, arm: { l: 0.05, r: 0.05 }, fx: { block: 1 } },
    { x: -30, lean: -0.12, sq: 0.95, turn: 0.4, look: [0.7, 0.3], eye: 'angry', arm: { l: 0.2, r: 2.4 }, fx: { block: 1, glint: 1 } },
    { x: 80, lean: 0.2, sq: 1.02, turn: 0.5, look: [0.8, 0.3], eye: 'angry', mouth: 0.8, arm: { l: 0.1, r: 1.45 }, fx: { block: 2, hit: 1 } },
    { x: 60, lean: 0.14, turn: 0.4, look: [0.7, 0], eye: 'angry', mouth: 0.4, arm: { l: 0.1, r: 1.3 }, fx: { block: 3, t: 0.3 } },
    { x: 20, lean: 0.04, turn: 0.25, look: [0.6, -0.3], arm: { l: 0.1, r: 0.6 }, fx: { block: 3, t: 0.72 } },
    { turn: 0.1, look: [0.4, 0.6], lid: 0.3, arm: { l: 0.1, r: 2.0 }, fx: { block: 4, glint: 0.7 } },
    { arm: { l: 0.1, r: 2.0 }, eye: 'happy', mouth: 0.6, fx: { block: 4, glint: 1.2, nugStar: 1 } },
    { arm: { l: 0.05, r: 0.05 }, lid: 0.42, fx: { block: 4 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'sit',
    bodyC: [0, -190],
    bodyR: 270,
    body: { half: [[0, -334], [104, -326], [168, -290], [204, -214], [218, -124], [210, -50], [164, -14], [0, -10]] },
    belly: { half: [[0, -334], [70, -326], [102, -280], [110, -190], [94, -100], [52, -48], [0, -40]] },
    sit: {
      thigh: [156, -80, 76, 70],
      hind: [200, 0, 42, 22],
      front: { at: [124, -256], len: 240, r: 48, paw: [52, 30], splay: 0.2, sock: 0.62 },
    },
    tail: { pts: [[150, -40], [214, -52], [236, -84]], w0: 22, w1: 20, swing: 1.2 },
    head: { c: [0, -478], rx: 222, ry: 164, half: [[0, -148], [112, -144], [176, -124], [204, -80], [208, -20], [218, 40], [232, 96], [216, 138], [168, 162], [90, 174], [0, 176]] },
    ears: {
      at: [186, -104],
      pts: [[-34, -18], [14, -44], [62, -34], [84, -6], [70, 14], [40, 10], [8, 22], [-26, 16]],
      inner: [[0, -22], [40, -30], [64, -12], [40, -2], [12, 4]],
      fill: C.ear,
      innerFill: C.earIn,
      tilt: 0.05,
      flop: 0.2,
    },
    face: {
      eyes: { x: 104, y: -22, rx: 30, ry: 31, white: '#FBF4E4', iris: '#6B4428', irisR: 0.8, lid: 0.34, lidColor: C.fur },
      muzzle: { half: [[0, -8], [52, -12], [112, 6], [160, 46], [178, 100], [158, 144], [100, 166], [44, 164], [0, 154]] },
      nose: { y: 22, w: 50, h: 34 },
      mouth: { y: 110, w: 62, h: 44, style: 'grin', fangs: 26 },
      blush: [150, 30, 26],
    },
    shadowW: 290,
    attack: 'bite',
    hooks: {
      behind: block,
      skin: blaze,
      front: collar,
      face: faceMarks,
      hand(ctx, R, B, side, end) {
        const fx = R.pose.fx || {};
        cuff(ctx, R, B, side, end);
        if (side < 0) return;
        const armA = R.pose.arm.r;
        knuckles(ctx, [end[0] + 2, end[1] - 6], side * armA * 0.3, B, fx.glint || 0);
        if (fx.hit) K.fx.star(ctx, end[0] + 40, end[1] - 30, 76, B, sd('hit'), '#FFF1C4');
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        rubble(ctx, R, B);
        if (fx.kind === 'zzz') {
          // a snot bubble swelling and shrinking out of his left nostril
          const n = R.hp(-16, 26, 1);
          const r = 30 + 40 * (0.5 + 0.5 * K.wave(fx.u));
          const bc = [n[0] - r * 0.55, n[1] + r * 0.75];
          const bp = L.ellipsePts(bc[0], bc[1], r, r * 0.94, 26);
          K.fill(ctx, bp, '#CFE6EF', 0.5);
          L.inkPath(ctx, bp, { closed: true, width: 3.4, seed: sd('bub'), boil: B, wobble: 0.3 });
          K.fill(ctx, L.ellipsePts(bc[0] - r * 0.4, bc[1] - r * 0.42, r * 0.3, r * 0.17, 10, -0.6), '#FFFFFF', 0.95);
          K.fill(ctx, L.ellipsePts(bc[0] + r * 0.45, bc[1] + r * 0.4, r * 0.1, r * 0.08, 8), '#FFFFFF', 0.8);
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { x: T.x || 0, lean: T.lean || 0, sq: T.sq || 1, turn: T.turn || 0, look: T.look || null, eyeMode: T.eye || 'open', lid: T.lid == null ? null : T.lid, mouth: T.mouth || 0, arm: T.arm, fx: T.fx };
      },
    },
  });
})();
