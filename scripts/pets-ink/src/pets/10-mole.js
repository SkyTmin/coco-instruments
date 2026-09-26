// pets/10-mole.js : Крот-подкопщик (common, loot). Biped kit (art bible 10).
// A dented yellow miner's helmet with a brass lamp, a belt with a buckle and a side pouch; the
// spade forepaws are the character. Work: lying low over a heap, two scoops a loop, clods flung
// over the back.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const TAU = Math.PI * 2;
  const ID = 'mole';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#6B615B',
    furDeep: '#433A36',
    furLit: '#8C8078',
    chest: '#7E736C',
    skin: '#EDA898',
    skinDeep: '#C27466',
    claw: '#F3E7D1',
    clawDeep: '#B9A688',
    helmet: '#E8B53D',
    helmetDeep: '#AE7B25',
    helmetLit: '#FAE3A0',
    brass: '#C39A55',
    brassDeep: '#7E5E2E',
    glass: '#FFF6D2',
    leather: '#8C5A33',
    leatherDeep: '#5A361D',
    eye: '#1A110E',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
  };

  // the silhouette [x, y, head weight]
  const SIL = [
    [-20, -22, 0],
    [-110, -32, 0],
    [-176, -88, 0],
    [-204, -186, 0],
    [-206, -290, 0],
    [-184, -382, 0.25],
    [-140, -450, 0.65],
    [-55, -494, 1],
    [40, -506, 1],
    [128, -484, 1],
    [192, -440, 1],
    [236, -402, 1],
    [298, -382, 1],
    [346, -370, 1],
    [364, -352, 1],
    [334, -334, 1],
    [272, -326, 1],
    [218, -312, 0.85],
    [202, -268, 0.3],
    [206, -200, 0],
    [193, -120, 0],
    [152, -56, 0],
    [80, -27, 0],
  ];

  function helmet(ctx, R, B) {
    const Hm = M.mul(R.Mh, M.about(R.pose.hat, 40, -470));
    K.helmet(ctx, Hm, { cx: 32, cy: -470, rx: 160, ry: 118, col: { hat: C.helmet, hatDeep: C.helmetDeep, hatLit: C.helmetLit, brass: C.brass, brassDeep: C.brassDeep, glass: C.glass }, lamp: R.pose.lamp, seed: sd('helmet'), boil: B });
  }

  function belt(ctx, R, B, bodyPts) {
    const top = (x) => -186 + 16 * (1 - (x / 230) ** 2);
    const line = [];
    for (let x = -250; x <= 250; x += 20) line.push([x, top(x) + 19]);
    K.band(ctx, M.all(R.Mb, line), 38 * R.pose.sq, { fill: C.leather, deep: C.leatherDeep, stitch: C.leatherDeep, seed: sd('belt'), boil: B, clip: bodyPts, width: 5 });
    const bx = 158, by = top(158) - 5;
    const outer = M.all(R.Mb, L.rrectPts(bx - 20, by, 40, 48, 8, 6));
    const inner = M.all(R.Mb, L.rrectPts(bx - 9, by + 11, 18, 26, 4, 5));
    K.plate(ctx, outer, { seed: sd('buckle'), boil: B });
    K.fill(ctx, inner, C.leatherDeep);
    L.inkPath(ctx, inner, { closed: true, width: 3, seed: sd('buckle2'), boil: B, wobble: 0.3 });
  }

  function pouch(ctx, R, B) {
    const T = R.Mb;
    const bag = M.all(T, K.smooth([[-196, -176], [-104, -180], [-98, -118], [-120, -92], [-178, -92], [-200, -120]], 5));
    K.form(ctx, bag, { fill: C.leather, deep: C.leatherDeep, width: 6, seed: sd('pouch'), boil: B, shade: 0.9, spacing: 7, hatchW: 2.4, hatchAlpha: 0.7 });
    const flap = M.all(T, K.smooth([[-200, -180], [-100, -184], [-104, -150], [-150, -136], [-196, -150]], 5));
    K.form(ctx, flap, { fill: C.leatherDeep, deep: P.ink, width: 5.5, seed: sd('flap'), boil: B, shade: 0.5, spacing: 7, hatchW: 2.2, hatchAlpha: 0.6 });
    K.plate(ctx, M.all(T, L.ellipsePts(-150, -143, 8, 8, 16)), { width: 3, seed: sd('btn'), boil: B, shade: 0 });
  }

  K.kits.biped.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    sil: SIL,
    neck: [110, -400],
    bodyC: [0, -270],
    legh: 46,
    shoulders: { n: [122, -285], f: [92, -305] },
    hips: { n: [40, -62], f: [-40, -66] },
    arm: {
      len: 46,
      r: 28,
      paw: 'spade',
      pawScale: 1.28,
      rest: { n: { a1: 0.78, a2: 0.12 }, f: { a1: 0.56, a2: 0.02 } },
      up: { n: { a1: -0.55, a2: -0.95 }, f: { a1: -1.9, a2: -2.1 } },
    },
    leg: { r: 29 },
    foot: { len: 48, rest: { n: { x: 52 }, f: { x: -38 } } },
    tail: { base: [-186, -74], len: 80, lift: 0.25, curl: 0.35, rise: 6, w0: 26, w1: 9 },
    chest: [150, -210, 70, 120, -0.15],
    face: {
      eye: { x: 206, y: -414, r: 17 },
      nose: { x: 360, y: -356, rx: 25, ry: 19 },
      mouth: [[322, -334], [300, -326], [278, -324]],
      whiskers: [326, -346, 92],
      blush: [236, -368],
    },
    hooks: {
      bodyAfter: belt,
      front: pouch,
      head: helmet,
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx || fx.kind !== 'dig') return;
        const H0 = M.ap(R.Mr, [330, 0]);
        K.fx.heap(ctx, H0[0], B, sd('heap'), C);
        K.fx.clods(ctx, [H0[0] - 70, K.GROUND - 50], fx.d, fx.n, [2, 6], B, sd('clod'), C);
      },
    },
    poses: {
      // lying low over the heap, two scoops per loop: near paw on drawings 0-3, far paw on 4-7
      work(d, n) {
        const S = [
          { a1: -0.25, a2: 0.25 },
          { a1: 0.55, a2: 1.0 },
          { a1: 1.3, a2: 1.75 },
          { a1: 2.0, a2: 2.5 },
        ];
        const rest = { a1: 1.0, a2: 1.3 };
        return {
          x: -170,
          y: d % 2 ? -5 : 0,
          lean: 0.52 + 0.04 * Math.cos((TAU * d) / 4),
          sq: 0.94,
          legh: 34,
          head: 0.04,
          armN: d < 4 ? S[d] : rest,
          armF: d >= 4 ? S[d - 4] : rest,
          footN: { x: 70, lift: 0, ang: 0 },
          footF: { x: -60, lift: 0, ang: 0 },
          tail: 0.35 * Math.sin((TAU * d) / 4),
          fx: { kind: 'dig', d, n },
        };
      },
    },
  });
})();
