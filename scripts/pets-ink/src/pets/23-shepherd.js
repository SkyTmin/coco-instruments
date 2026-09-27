// pets/23-shepherd.js : Конвойная овчарка (epic, dmg). Front kit, sits to attention.
// A black-and-tan German shepherd pup sitting straight: huge upright ears, a black muzzle and a
// black streak up the forehead, tan cheeks with the two tan "pips" over the eyes, the black saddle
// showing over the shoulders, a cream ruff on the chest. A guard harness of brown leather with
// brass rivets and a shield badge, a chain leash trailing from the collar, a long bushy tail on
// the floor. Work: the guard bark — ears flat, a breath in, a bark that goes out in rings and
// cracks the floor, stones jumping — then the tongue out, pleased.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'shepherd';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#C98F53',
    furDeep: '#8A5A2E',
    furLit: '#E6B67E',
    belly: '#EAD6B0',
    black: '#2E2622',
    blackLit: '#4E423A',
    muzzle: '#5E4F44',
    pip: '#E9BE86',
    ear: '#3A2E28',
    earIn: '#D9B385',
    skin: '#D9968C',
    nose: '#1E1816',
    blush: '#E08A78',
    mouth: '#5E2220',
    tongue: '#EE8E88',
    pad: '#3A2E28',
    eyeLine: '#F2E4C8',
    leather: '#6E4A2C',
    leatherDeep: '#43291A',
    brass: '#D8B65C',
    brassDeep: '#8A6C28',
    steel: '#B4BBC0',
    stone: '#8A857E',
    stoneTop: '#ABA69D',
    stoneDeep: '#55504A',
  };

  // ---- the black-and-tan pattern of the head
  function headMarks(c2, R) {
    const T = R.Mh;
    // a black cap over the crown running down the forehead in a streak
    const cap = [R.hl(-170, -60, 0.2), R.hl(-120, -140, 0.4), R.hl(0, -160, 0.6), R.hl(120, -140, 0.4), R.hl(170, -60, 0.2), R.hl(96, -92, 0.6), R.hl(30, -70, 0.9), R.hl(14, -10, 1), R.hl(-14, -10, 1), R.hl(-30, -70, 0.9), R.hl(-96, -92, 0.6)];
    K.fill(c2, M.all(T, K.smooth(cap, 4)), C.black);
    // dark rims round the eyes, fading out toward the temples
    for (const s of [-1, 1]) {
      K.fill(c2, M.all(T, K.smooth([R.hl(s * 30, -30, 0.95), R.hl(s * 76, -52, 0.85), R.hl(s * 124, -30, 0.6), R.hl(s * 136, 0, 0.5), R.hl(s * 100, 20, 0.7), R.hl(s * 50, 18, 0.9)], 4)), C.blackLit);
      // the tan pips over the eyes
      K.fill(c2, M.all(T, L.ellipsePts(...R.hl(s * 66, -74, 0.85), 17, 12, 14, -s * 0.3)), C.pip);
    }
  }

  function bodyMarks(c2, R) {
    const T = R.Mb;
    // the black saddle over the shoulders
    for (const s of [-1, 1]) K.fill(c2, M.all(T, K.smooth([[s * 60, -350], [s * 150, -330], [s * 210, -250], [s * 214, -170], [s * 180, -196], [s * 140, -268], [s * 90, -300]], 4)), C.black);
  }

  // ---- the harness, badge and leash
  function harness(ctx, R, B) {
    const T = R.Mb;
    const strap = (pts, w, seed) => {
      const line = M.all(T, K.curve(pts, 6));
      K.band(ctx, line, w, { fill: C.leather, deep: C.leatherDeep, seed, boil: B, width: 4.5, stitch: '#C9A878' });
      return line;
    };
    // the collar
    strap([[-150, -338], [-70, -318], [0, -312], [70, -318], [150, -338]], 26, sd('col'));
    // a Y: from each shoulder to the badge, then down the chest
    for (const s of [-1, 1]) {
      const l = strap([[s * 170, -300], [s * 110, -268], [s * 40, -236]], 24, sd('y', s));
      for (const u of [0.25, 0.7]) {
        const p = l[Math.floor(u * (l.length - 1))];
        K.fill(ctx, L.ellipsePts(p[0], p[1], 5, 5, 8), C.brass);
        L.inkPath(ctx, L.ellipsePts(p[0], p[1], 5, 5, 8), { closed: true, width: 2, seed: sd('rv', s, u), boil: B });
      }
    }
    strap([[0, -220], [0, -150], [0, -80]], 26, sd('down'));
    // the shield badge where the straps meet
    const b = M.ap(T, [0, -224]);
    const sh = [[b[0] - 40, b[1] - 38], [b[0], b[1] - 46], [b[0] + 40, b[1] - 38], [b[0] + 36, b[1] + 8], [b[0], b[1] + 44], [b[0] - 36, b[1] + 8]];
    F().form(ctx, K.smooth(sh, 3), C.brass, B, sd('badge'), {
      width: 5,
      off: 0.14,
      shine: 1,
      hatch: 0.3,
      dark: C.brassDeep,
      inside(c2) {
        L.inkPath(c2, K.smooth(sh.map(([x, y]) => [b[0] + (x - b[0]) * 0.74, b[1] + (y - b[1]) * 0.74]), 3), { closed: true, width: 2.6, color: C.brassDeep, seed: sd('bi'), boil: B, wobble: 0.2 });
        // a five-point star on it
        const st = [];
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
          const r = k % 2 ? 7 : 17;
          st.push([b[0] + Math.cos(a) * r, b[1] - 2 + Math.sin(a) * r]);
        }
        K.fill(c2, st, C.brassDeep);
      },
    });
    if (R.pose.fx && R.pose.fx.glint) K.fx.star(ctx, b[0] + 34, b[1] - 40, 30 * R.pose.fx.glint, B, sd('bgl'), '#FFF1C4');
    // the chain leash from a ring on the collar, trailing over the floor
    const ring = M.ap(T, [96, -322]);
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 14, 15, 16), { closed: true, width: 11, color: P.ink, seed: sd('ring'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 14, 15, 16), { closed: true, width: 5.5, color: C.steel, seed: sd('ring'), boil: B, wobble: 0.3 });
    const sway = Math.sin(R.pose.tail * 2) * 10;
    K.chain(ctx, [[ring[0], ring[1] + 14], M.ap(T, [150 + sway, -200]), M.ap(R.Mr, [196, -40]), M.ap(R.Mr, [250, 2]), M.ap(R.Mr, [330, 4])], 22, { width: 7, color: C.steel, seed: sd('leash'), boil: B });
    const h = M.ap(R.Mr, [352, -4]);
    F().form(ctx, L.rrectPts(h[0] - 18, h[1] - 16, 50, 26, 12, 4), C.leather, B, sd('handle'), { width: 4.5, off: 0.1, hatch: 0.3, rim: false });
  }

  // ---- the bark
  const rock = (x, y, r, a, k) => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const t = a + (i / 6) * Math.PI * 2;
      const rr = r * (0.7 + 0.45 * L.h3(k, i, 13));
      out.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.85]);
    }
    return out;
  };
  function bark(ctx, R, B) {
    const fx = R.pose.fx || {};
    const m = R.hp(0, 90, 1);
    if (fx.bark) {
      for (let k = 0; k < 3; k++) {
        const p = fx.bark - k * 0.35;
        if (p <= 0 || p > 1.3) continue;
        const r = 80 + p * 260;
        const a = Math.max(0, 1 - p / 1.3);
        // a pair of arcs either side of the mouth, like sound drawn in a comic
        for (const s of [-1, 1]) {
          const arc = [];
          for (let i = 0; i <= 10; i++) {
            const t = -0.75 + (i / 10) * 1.5;
            arc.push([m[0] + s * Math.cos(t) * r, m[1] + Math.sin(t) * r * 0.8]);
          }
          K.line(ctx, arc, { width: 12 - k * 2, alpha: a, seed: sd('arc', k, s), boil: B, taper: [6, 6] });
        }
      }
    }
    if (fx.inhale) for (const s of [-1, 1]) K.line(ctx, [[m[0] + s * 150, m[1] - 20], [m[0] + s * 90, m[1] - 10]], { width: 5, color: P.inkSoft, seed: sd('in', s), boil: B, smooth: false, taper: [2, 8] });
    const g = K.GROUND, cx = K.CXF;
    if (fx.crack) {
      // cracks fanning out over the floor in front of her: zigzags with a branch each
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (0.06 + (i / 5) * 0.88);
        const dx = Math.cos(a), dy = Math.sin(a) * 0.32;
        const o = [cx + dx * 130, g + 6 + dy * 40];
        const pts = [o];
        let p = o;
        for (let k = 1; k <= 4; k++) {
          const j = (k % 2 ? 1 : -1) * 16 * L.h3(i, k, 5);
          const step = (48 + 18 * L.h3(i, k, 6)) * fx.crack;
          p = [p[0] + dx * step - dy * j, p[1] + dy * step + dx * j * 0.3];
          pts.push(p);
        }
        K.line(ctx, pts, { width: 5, seed: sd('cr', i), boil: B, smooth: false, taper: [2, 8] });
        const b0 = pts[2];
        K.line(ctx, [b0, [b0[0] + dx * 30 + dy * 40, b0[1] + dy * 30 + 10]], { width: 3.2, seed: sd('crb', i), boil: B, smooth: false, taper: [2, 6] });
      }
    }
    if (fx.pebbles) {
      const t = fx.pebbles;
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? 1 : -1;
        const x = cx + s * (220 + 60 * i * 0.4), y = g - 16 - (200 + 80 * L.h3(i, 7, 5)) * Math.sin(Math.PI * t);
        const r = 14 + 8 * L.h3(i, 8, 5);
        F().form(ctx, rock(x, y, r, i + t * 5, i), i % 3 ? C.stone : C.stoneTop, B, sd('pb', i), { width: 4, off: 0.1, hatch: 0.3, rim: false, smooth: false });
      }
    }
  }

  const WORK = [
    { sq: 0.95, head: 0.08, ear: -0.8, eye: 'angry', mouth: 0, fx: {} },
    { sq: 1.06, y: -12, head: -0.1, ear: 0.4, eye: 'open', lid: 0.1, mouth: 0.3, fx: { inhale: 1 } },
    { scale: 1.06, head: 0.02, ear: -0.4, eye: 'angry', mouth: 1, fx: { bark: 0.3, glint: 1 } },
    { scale: 1.08, head: 0.03, ear: -0.4, eye: 'angry', mouth: 1, fx: { bark: 0.8, crack: 0.6 } },
    { scale: 1.04, ear: -0.2, eye: 'angry', mouth: 0.8, fx: { bark: 1.3, crack: 1, pebbles: 0.35 } },
    { mouth: 0.4, fx: { bark: 1.7, crack: 1, pebbles: 0.75 } },
    { eye: 'happy', mouth: 0.7, tail: 0.5, ear: 0.3, fx: { crack: 1 } },
    { lid: 0.1, tail: -0.3, fx: { crack: 1 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'sit',
    bodyC: [0, -190],
    bodyR: 260,
    body: { half: [[0, -350], [88, -342], [150, -300], [186, -214], [200, -120], [190, -44], [150, -14], [0, -10]] },
    belly: { half: [[0, -350], [60, -344], [92, -300], [100, -200], [84, -100], [44, -50], [0, -42]] },
    sit: {
      thigh: [146, -84, 78, 74],
      hind: [182, 0, 46, 24],
      front: { at: [98, -250], len: 236, r: 32, paw: [40, 24], splay: 0.05 },
    },
    tail: { pts: [[130, -30], [230, -14], [320, -30], [366, -90], [380, -150]], w0: 40, w1: 36, bushy: true, tip: C.black, tipLen: 0.3, swing: 0.9 },
    head: { c: [0, -500], rx: 176, ry: 150, half: [[0, -146], [84, -140], [140, -106], [170, -50], [176, 10], [160, 64], [120, 110], [70, 146], [0, 160]], tufts: [[0.2, 0.3, 18], [0.7, 0.8, 18]] },
    ears: {
      at: [100, -118],
      pts: [[-56, 22], [-34, -110], [-6, -184], [20, -120], [52, 20]],
      inner: [[-34, 12], [-18, -96], [-6, -146], [8, -100], [30, 12]],
      fill: C.ear,
      innerFill: C.earIn,
      tilt: 0.22,
      flop: 0.5,
    },
    face: {
      eyes: { x: 72, y: -16, rx: 30, ry: 32, white: '#FBF4E4', iris: '#6B4020', irisR: 0.8, lid: 0.08, lidColor: C.blackLit },
      muzzle: { half: [[0, 0], [38, 2], [66, 24], [78, 64], [66, 104], [38, 128], [0, 134]] },
      muzzleInk: 5,
      nose: { y: 36, w: 32, h: 23 },
      mouth: { y: 82, w: 28, drop: 14, h: 40, style: 'cat', fangs: 14 },
      whiskers: null,
      blush: [120, 44, 22],
    },
    shadowW: 270,
    attack: 'bite',
    hooks: {
      skin: headMarks,
      body: bodyMarks,
      front: harness,
      fx: bark,
      ear(c2, R, B, side, T) {
        for (let k = 0; k < 5; k++) {
          const x = (-22 + k * 11) * side;
          K.line(c2, M.all(T, K.curve([[x, 14], [x * 0.8 + side * 4, -30 - 8 * (k % 2)], [x * 0.5 + side * 6, -64 - 14 * (k % 3)]], 4)), { width: 3.2, color: '#F6E6C8', seed: sd('ef', side, k), boil: B, taper: [2, 6] });
        }
      },
    },
    poses: {
      idle(d, n, base) {
        // the tail sweeps the floor now and then
        const p = base.idle(d, n);
        p.tail = 0.25 * K.wave(d / n);
        return p;
      },
      work(d) {
        const T = WORK[d];
        return { sq: T.sq || 1, y: T.y || 0, scale: T.scale || 1, head: T.head || 0, ear: T.ear || 0, eyeMode: T.eye || 'open', lid: T.lid == null ? null : T.lid, mouth: T.mouth || 0, tail: T.tail || 0, fx: T.fx };
      },
    },
  });
})();
