// pets/22-ferret.js : Хорёк-контрабандист (uncommon, rate). Quad kit, long and low.
// A cream polecat-ferret with dark legs and tail, a dark mask round the eyes, a burlap bundle
// roped to its back and a thin red scarf. It does not walk, it bounds: fronts together, hinds
// together, the back humping as the legs gather. Work: the weasel war dance — hops with an arched
// back, a twist in the air, a skid.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const TAU = Math.PI * 2;
  const ID = 'ferret';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#E7D6B4',
    furDeep: '#A88F66',
    furLit: '#F7EDD6',
    chest: '#F5EEDC',
    dark: '#4F3A2A',
    darkDeep: '#2E2118',
    white: '#F7F2E6',
    skin: '#E3A195',
    skinDeep: '#B46A62',
    nose: '#E3A195',
    noseDeep: '#B46A62',
    eye: '#1A110E',
    mouth: '#5E2220',
    tongue: '#E88E86',
    sack: '#B0925E',
    sackDeep: '#6F5634',
    rope: '#8C6A3E',
    scarf: '#BE3A2E',
    scarfDeep: '#7A2019',
  };

  const SIL = [
    [-250, -86, 0],
    [-284, -128, 0],
    [-282, -176, 0],
    [-240, -206, 0],
    [-140, -216, 0],
    [-20, -214, 0],
    [80, -214, 0.1],
    [140, -228, 0.5],
    [170, -270, 1],
    [210, -300, 1],
    [262, -304, 1],
    [306, -284, 1],
    [340, -262, 1],
    [350, -246, 1],
    [334, -232, 1],
    [296, -222, 1],
    [256, -208, 1],
    [210, -196, 0.8],
    [180, -172, 0.4],
    [170, -120, 0],
    [120, -92, 0],
    [0, -86, 0],
    [-120, -86, 0],
  ];

  // dark points and the mask, the white face
  function markings(ctx, R) {
    const H = R.Mh, T = R.Mb;
    K.fill(ctx, M.all(T, K.smooth([[-300, -90], [-240, -120], [-170, -110], [-150, -80], [-300, -60]], 5)), C.dark);
    K.fill(ctx, M.all(H, K.smooth([[216, -290], [270, -300], [330, -270], [352, -244], [300, -214], [240, -206], [206, -230]], 5)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[222, -276], [262, -286], [300, -272], [306, -252], [270, -244], [232, -242], [214, -256]], 5)), C.dark);
  }

  function bundle(ctx, R, B) {
    const T = R.Mb;
    const top = R.place([-80, -216], 0);
    // the ropes round the belly, then the sack on the back
    for (const x of [-120, -40]) {
      const a = R.place([x, -226], 0), b = R.place([x + 10, -80], 0);
      K.line(ctx, [a, [(a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2], b], { width: 9, color: P.ink, seed: sd('rope', x), boil: B, taper: 0 });
      K.line(ctx, [a, [(a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2], b], { width: 4.5, color: C.rope, seed: sd('rope', x), boil: B, taper: 0 });
    }
    const sack = K.smooth([[top[0] - 90, top[1] + 6], [top[0] - 96, top[1] - 50], [top[0] - 40, top[1] - 96], [top[0] + 30, top[1] - 90], [top[0] + 70, top[1] - 40], [top[0] + 60, top[1] + 8]], 5);
    K.form(ctx, sack, {
      fill: C.sack,
      deep: C.sackDeep,
      width: 6.5,
      seed: sd('sack'),
      boil: B,
      spacing: 8,
      hatchAlpha: 0.7,
      after(c2, pts) {
        L.hatch(c2, pts, { angle: 0.1, spacing: 9, length: [6, 12], gap: [6, 12], width: 2, color: C.sackDeep, alpha: 0.5, clip: true, seed: sd('weave'), boil: B });
        K.line(c2, [[top[0] - 56, top[1] - 80], [top[0] - 20, top[1] - 60], [top[0] + 20, top[1] - 76]], { width: 4, color: C.sackDeep, seed: sd('tie'), boil: B });
      },
    });
    // the knot on top
    const knot = K.smooth([[top[0] - 36, top[1] - 94], [top[0] - 20, top[1] - 118], [top[0] + 2, top[1] - 112], [top[0] + 4, top[1] - 90]], 4);
    K.form(ctx, knot, { fill: C.sack, deep: C.sackDeep, width: 5, seed: sd('knot'), boil: B, shade: 0.6, spacing: 5 });
    void T;
  }

  function scarf(ctx, R, B) {
    const T = R.Mf;
    const band = M.all(T, K.curve([[150, -250], [182, -226], [204, -198]], 8));
    K.band(ctx, band, 24, { fill: C.scarf, deep: C.scarfDeep, seed: sd('scarf'), boil: B, width: 4.5 });
    const flap = R.pose.fx && R.pose.fx.flap != null ? R.pose.fx.flap : 0.3;
    const tailPts = M.all(T, K.ribbonPts([[160, -236], [120, -230 - 20 * flap], [80, -218 - 34 * flap], [52, -214 - 40 * flap]], 20, 12));
    K.form(ctx, tailPts, { fill: C.scarf, deep: C.scarfDeep, width: 4.5, seed: sd('scarfT'), boil: B, shade: 0.7, spacing: 5, hatchW: 1.8 });
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeSpring,
    sil: SIL,
    neck: [170, -220],
    headScale: 1.2,
    spine: [20, -170],
    archX: -60,
    archW: 170,
    bodyC: [-40, -150],
    bodyR: 230,
    front: { atN: [130, -110], atF: [108, -116], l1: 54, l2: 50, r1: 22, rj: 17, r2: 15, paw: [24, 12] },
    hind: { atN: [-220, -120], atF: [-196, -126], l1: 60, l2: 52, r1: 30, rj: 17, r2: 15, paw: [26, 12] },
    feet: { fn: 142, ff: 118, hn: -210, hf: -186 },
    legFill: () => C.dark,
    pawFill: () => C.dark,
    lie: 60,
    tail: { base: [-282, -150], len: 190, lift: 0.3, curl: -0.3, rise: 0, w0: 34, w1: 26, fill: C.dark, deep: C.darkDeep, ink: 6 },
    ears: {
      n: { at: [214, -292], flop: 0.1, fill: C.fur, deep: C.furDeep, innerFill: C.dark, pts: L.ellipsePts(210, -304, 22, 20, 16), inner: L.ellipsePts(212, -302, 11, 10, 12) },
      f: { at: [252, -300], flop: 0.08, fill: C.fur, deep: C.furDeep, innerFill: C.dark, pts: L.ellipsePts(250, -310, 20, 18, 16), inner: null },
    },
    tuftBelow: -300,
    tufts: false,
    face: {
      eye: { x: 266, y: -262, r: 13 },
      nose: { x: 346, y: -248, rx: 10, ry: 8 },
      mouth: [[338, -232], [320, -226], [300, -224]],
      whiskers: [326, -242, 80],
      blush: null,
    },
    hooks: { body: markings, bodyAfter: bundle, front: scarf, fx(ctx, R, B) {
      const fx = R.pose.fx;
      if (fx && fx.speed) K.fx.speed(ctx, M.ap(R.Mr, [-300, -140]), 160, fx.speed, B, sd('speed'));
      if (fx && fx.dust) K.fx.dust(ctx, M.ap(R.Mr, [-240, 0]), 60, fx.dust, B, sd('dust'));
    } },
    poses: {
      // bounding: fronts together, hinds together, a hump when the legs gather
      walk(d, n) {
        const ph = (TAU * d) / n;
        const c = Math.cos(ph), s = Math.sin(ph);
        const st = 48;
        const fl = s < 0 ? -s * 46 : 0, hl = s > 0 ? s * 46 : 0;
        return {
          y: -14 * (1 - c) / 2,
          arch: 34 * (1 - c),
          sq: 1,
          head: 0.08 * Math.sin(ph + 0.8),
          tail: 0.3 * s,
          legs: { fn: { x: 142 + st * c, lift: fl }, ff: { x: 122 + st * c, lift: fl }, hn: { x: -210 - st * c, lift: hl }, hf: { x: -190 - st * c, lift: hl } },
          fx: { flap: 0.5 + 0.5 * c },
        };
      },
      // the war dance: hop, twist, hop, skid
      work(d) {
        const T = [
          { bow: 0.1, sq: 0.9, arch: 20, head: 0.1 },
          { y: -70, arch: 70, lean: -0.08, head: -0.2, tuck: 1 },
          { y: -100, arch: 84, lean: -0.22, head: -0.35, tuck: 1, mouth: 1 },
          { y: 0, arch: 50, sq: 0.9, head: 0.05 },
          { y: -60, x: 30, arch: 64, lean: 0.14, head: -0.1, tuck: 1, mouth: 1 },
          { y: 0, x: 50, arch: 30, sq: 0.92, dust: 0.3 },
          { x: 90, bow: 0.1, arch: 10, speed: 1, dust: 0.6 },
          { x: 60, arch: 20, head: -0.12, mouth: 0.6, eye: 'happy' },
        ][d];
        const up = T.tuck ? 40 : 0;
        return {
          x: T.x || 0,
          y: T.y || 0,
          lean: T.lean || 0,
          bow: T.bow || 0,
          sq: T.sq || 1,
          arch: T.arch,
          head: T.head || 0,
          mouth: T.mouth || 0,
          eyeMode: T.eye || 'open',
          tail: d % 2 ? 0.5 : -0.3,
          legs: { fn: { x: 150, lift: up }, ff: { x: 128, lift: up }, hn: { x: -200, lift: up }, hf: { x: -178, lift: up } },
          fx: { speed: T.speed || 0, dust: T.dust || 0, flap: d % 2 },
        };
      },
    },
  });
})();
