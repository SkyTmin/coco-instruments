// pets/10-mole.js : Крот-забойщик (common, loot). Front kit, stands.
// Velvet charcoal fur, a big pink snout, small shiny eyes under the brim of a dented yellow miner's
// helmet with a brass lamp, huge pink spade paws with white claws, a leather belt with a brass
// buckle and a pouch, a patch on the belly fur where the belt rubs. Work: the lamp comes on, he
// digs in front of himself — the heap grows, clods fly both ways — and pops up with a chunk of ore.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const F = () => K.front;
  const ID = 'mole';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#6E6560',
    furDeep: '#3F3733',
    furLit: '#968A82',
    belly: '#857A73',
    muzzle: '#9A8C86',
    skin: '#EFA2A0',
    nose: '#E8888C',
    paw: '#EFA8A4',
    pad: '#D98282',
    foot: '#EFA8A4',
    leg: '#6E6560',
    arm: '#6E6560',
    claw: '#F6EEDC',
    blush: '#E48A8E',
    mouth: '#7A2C2C',
    tongue: '#F29A96',
    helmet: '#EDB83C',
    helmetDeep: '#B07A22',
    helmetLit: '#FFE9A6',
    brass: '#C9A05A',
    brassDeep: '#7E5E2E',
    glass: '#FFF6D2',
    leather: '#8C5A33',
    leatherDeep: '#5A361D',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
    ore: '#6FC0D8',
    oreDeep: '#2F7F9E',
  };

  const helmetCol = { hat: C.helmet, hatDeep: C.helmetDeep, hatLit: C.helmetLit, brass: C.brass, brassDeep: C.brassDeep, glass: C.glass };

  function belt(ctx, R, B, bodyPts) {
    const y0 = -196;
    const line = [];
    for (let x = -200; x <= 200; x += 20) line.push([x, y0 + 14 * (1 - (x / 190) ** 2)]);
    K.clip(ctx, bodyPts, () => {
      K.band(ctx, M.all(R.Mb, line), 40, { fill: C.leather, deep: C.leatherDeep, seed: sd('belt'), boil: B, width: 5 });
      // stitching along both edges
      for (const s of [-1, 1])
        for (let i = 0; i + 1 < line.length; i++) {
          const [x, y] = line[i];
          K.line(ctx, M.all(R.Mb, [[x + 4, y + s * 13], [x + 12, y + s * 13 + 1]]), { width: 2.4, color: '#C99A6A', alpha: 0.85, seed: sd('stitch', s, i), boil: B, taper: 0, smooth: false });
        }
    });
    const buckle = M.all(R.Mb, L.rrectPts(-30, y0 - 12, 60, 50, 9, 6));
    F().form(ctx, buckle, C.brass, B, sd('buckle'), { width: 5, off: 0.12, shine: 0.9, hatch: 0.4 });
    K.fill(ctx, M.all(R.Mb, L.rrectPts(-15, y0 + 1, 30, 24, 4, 5)), C.leatherDeep);
    L.inkPath(ctx, M.all(R.Mb, L.rrectPts(-15, y0 + 1, 30, 24, 4, 5)), { closed: true, width: 3, seed: sd('buckle2'), boil: B, wobble: 0.3 });
    K.line(ctx, M.all(R.Mb, [[0, y0 + 2], [0, y0 + 26]]), { width: 5, color: C.brassDeep, seed: sd('prong'), boil: B, taper: 0 });
    // the pouch on his right hip, with a flap and a stud
    const pouch = M.all(R.Mb, L.rrectPts(100, y0 + 4, 74, 70, 14, 6));
    F().form(ctx, pouch, C.leather, B, sd('pouch'), { width: 6, off: 0.12, hatch: 0.6 });
    const flap = M.all(R.Mb, K.smooth([[98, y0 + 2], [176, y0 + 2], [172, y0 + 34], [137, y0 + 44], [102, y0 + 34]], 4));
    F().form(ctx, flap, C.leatherDeep, B, sd('flap'), { width: 5, off: 0.1, hatch: 0.3, rim: false });
    F().form(ctx, M.all(R.Mb, L.ellipsePts(137, y0 + 36, 8, 8, 12)), C.brass, B, sd('stud'), { width: 3, shine: 1, hatch: 0 });
  }

  function patch(ctx, R, B) {
    // a sewn-on patch of paler cloth over a hole in the fur, big stitches
    const T = R.Mb;
    const pts = M.all(T, L.rrectPts(-120, -128, 56, 50, 6, 4));
    K.fill(ctx, pts, '#B8A07E');
    L.hatch(ctx, pts, { angle: 0.7, spacing: 6, width: 1.6, color: '#8C7556', alpha: 0.7, density: 0.6, clip: true, seed: sd('weave'), boil: B });
    L.inkPath(ctx, pts, { closed: true, width: 3.4, seed: sd('patch'), boil: B, wobble: 0.5 });
    for (let k = 0; k < 5; k++) {
      const x = -118 + k * 13;
      K.line(ctx, M.all(T, [[x, -134], [x + 3, -122]]), { width: 3, seed: sd('ps', k), boil: B, smooth: false, taper: 0 });
    }
  }

  function ore(ctx, c, s, B, seed) {
    const pts = [[c[0], c[1] - 40 * s], [c[0] + 34 * s, c[1] - 12 * s], [c[0] + 26 * s, c[1] + 26 * s], [c[0] - 22 * s, c[1] + 30 * s], [c[0] - 36 * s, c[1] - 6 * s]];
    F().form(ctx, pts, '#8A8078', B, seed, { width: 5, off: 0.12, hatch: 0.6, smooth: false });
    for (const [x, y, r] of [[-8, -10, 12], [14, 8, 9], [-16, 14, 7]]) {
      const g = [[c[0] + x * s, c[1] + (y - r) * s], [c[0] + (x + r) * s, c[1] + y * s], [c[0] + x * s, c[1] + (y + r) * s], [c[0] + (x - r) * s, c[1] + y * s]];
      K.fill(ctx, g, C.ore);
      K.fill(ctx, [g[0], g[1], [c[0] + x * s, c[1] + y * s]], '#D8F4FF', 0.8);
      L.inkPath(ctx, g, { closed: true, width: 2.4, seed: seed + x, boil: B, smooth: false, taper: 0 });
    }
  }

  function heap(ctx, h, B) {
    if (h <= 0) return;
    const g = K.GROUND, cx = K.CXF;
    const pts = K.smooth([[cx - 190 * h, g + 6], [cx - 120 * h, g - 50 * h], [cx - 20, g - 80 * h], [cx + 110 * h, g - 56 * h], [cx + 200 * h, g + 6]], 5);
    F().form(ctx, pts, C.dirt, B, sd('heap'), { width: 7, off: 0.1, hatch: 0.8 });
    L.stipple(ctx, pts, { spacing: 12, r: [1.6, 3.2], color: C.dirtDeep, alpha: 0.8, seed: sd('heapS'), boil: B });
  }

  function clods(ctx, side, age, B) {
    if (age < 0 || age > 2) return;
    for (let k = 0; k < 4; k++) {
      const t = age + 0.5 + k * 0.12;
      const x = K.CXF + side * (60 + 150 * t + k * 18), y = K.GROUND - 60 - 260 * t + 150 * t * t - k * 12;
      if (y > K.GROUND) continue;
      const r = 12 + 6 * L.h3(k, side, 3);
      F().form(ctx, L.ellipsePts(x, y, r, r * 0.8, 10, k + t), C.dirt, B, sd('clod', side, k), { width: 4, off: 0.1, hatch: 0.5, rim: false });
    }
  }

  // the dig, facing us: the lamp on, paws taking turns, the heap growing, clods both ways, the ore
  const WORK = [
    { sq: 0.9, arm: { l: 1.2, r: 1.2 }, lamp: 1, heap: 0.3, low: 10 },
    { sq: 0.92, arm: { l: 1.0, r: -0.55 }, lamp: 1, heap: 0.5, clods: [1, 0] },
    { sq: 0.9, arm: { l: -0.55, r: 1.0 }, lamp: 1, heap: 0.65, clods: [-1, 0], turn: -0.15 },
    { sq: 0.92, arm: { l: 1.0, r: -0.55 }, lamp: 1, heap: 0.8, clods: [1, 0], turn: 0.15 },
    { sq: 0.9, arm: { l: -0.55, r: 1.0 }, lamp: 1, heap: 0.9, clods: [-1, 0] },
    { sq: 1.08, y: -70, arm: { l: -1.0, r: -1.0 }, lamp: 1, heap: 0.9, ore: 'chest', eye: 'happy', mouth: 0.7 },
    { sq: 1.02, y: -20, arm: { l: -0.98, r: -0.98 }, lamp: 1, heap: 0.9, ore: 'chest', eye: 'happy', mouth: 0.6, star: 1 },
    { sq: 1, arm: { l: -0.95, r: -0.95 }, lamp: 1, heap: 0.9, ore: 'chest' },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'stand',
    bodyC: [0, -210],
    bodyR: 260,
    body: {
      half: [[0, -348], [96, -338], [158, -296], [190, -226], [196, -146], [176, -80], [128, -44], [60, -34], [0, -32]],
    },
    belly: [0, -150, 118, 118],
    legs: { hip: [70, -58], r: 30, foot: [50, 30], splay: 10 },
    arms: [{ at: [150, -282], len: 132, r: 30, pr: 58, rest: 0.42, claws: 30 }],
    head: { c: [0, -470], rx: 186, ry: 168, tufts: [[0.55, 0.62, 14], [0.88, 0.95, 14]] },
    face: {
      eyes: { x: 66, y: -14, rx: 27, ry: 30, beadLit: '#5A4A56' },
      muzzle: [0, 52, 88, 60],
      nose: { y: 34, w: 40, h: 32 },
      mouth: { y: 82, w: 24, drop: 12, h: 30, style: 'cat' },
      whiskers: { x: 58, y: 46, len: 64 },
      blush: [112, 36, 28],
    },
    shadowW: 250,
    hooks: {
      body: patch,
      bodyAfter: belt,
      head(ctx, R, B) {
        F().helmet(ctx, R, B, { cy: -78, rx: 178, ry: 118, col: helmetCol, lamp: R.pose.fx && R.pose.fx.lamp ? 1 : null, tilt: 0.05 }, sd('helmet'));
      },
      hand(ctx, R, B, side, end) {
        const fx = R.pose.fx;
        if (!fx || !fx.ore || side < 0) return;
        const l = K.front.armEnd(R, R.S.arms[0], -1).end;
        const c = [(end[0] + l[0]) / 2, (end[1] + l[1]) / 2 - 36];
        ore(ctx, c, 1.3, B, sd('ore'));
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx) return;
        heap(ctx, fx.heap || 0, B);
        if (fx.clods) clods(ctx, fx.clods[0], 0, B);
        if (fx.star) {
          const t = R.hp(0, -300, 0);
          K.fx.star(ctx, t[0] - 110, t[1] + 10, 34, B, sd('s1'), '#FFF1C4');
          K.fx.star(ctx, t[0] + 120, t[1] + 40, 24, B, sd('s2'), '#FFF1C4');
        }
      },
    },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: {} });
      },
      work(d) {
        const T = WORK[d];
        return {
          sq: T.sq || 1,
          y: T.y || 0,
          low: T.low || 0,
          turn: T.turn || 0,
          arm: T.arm,
          eyeMode: T.eye || 'open',
          mouth: T.mouth || 0,
          head: T.ore ? -0.04 : 0.04,
          fx: { lamp: T.lamp, heap: T.heap, clods: T.clods, ore: T.ore, star: T.star },
        };
      },
    },
  });
})();
