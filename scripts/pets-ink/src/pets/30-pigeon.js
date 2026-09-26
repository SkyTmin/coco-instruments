// pets/30-pigeon.js : Голубь-почтальон (common, luck). Bird kit, struts.
// A plump blue-grey city pigeon with the green-and-violet sheen on its neck, two dark bars on the
// wing, an orange eye and a white cere. A leather flying cap with goggles, a satchel on a strap,
// a rolled note tied to its leg. Work: pulls the note off its leg, unrolls it, is amazed — the
// luck of the camp, a "!" over its head.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'pigeon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8E97A6',
    furDeep: '#586072',
    furLit: '#BAC1CD',
    chest: '#A0A8B6',
    wing: '#9CA4B2',
    wingDeep: '#566074',
    covert: '#B6BDC9',
    tail: '#747C8C',
    sheenG: '#5F8E6B',
    sheenV: '#7D5E8E',
    beak: '#3A3434',
    beakDeep: '#1E1A1A',
    cere: '#F2EEE6',
    eye: '#1A110E',
    leg: '#D8675E',
    legDeep: '#9C3F38',
    leather: '#7B4E2F',
    leatherDeep: '#4A2C18',
    paper: '#F4ECD8',
    paperDeep: '#B9AB88',
  };

  const SIL = [
    [-150, -150, 0],
    [-172, -178, 0],
    [-132, -232, 0],
    [-60, -272, 0],
    [16, -302, 0.2],
    [40, -350, 0.7],
    [60, -400, 1],
    [100, -432, 1],
    [150, -430, 1],
    [180, -406, 1],
    [184, -382, 1],
    [162, -360, 1],
    [132, -340, 0.6],
    [124, -290, 0.2],
    [120, -220, 0],
    [84, -150, 0],
    [0, -116, 0],
    [-80, -122, 0],
  ];

  const WING = {
    fold: [[40, -300], [0, -298], [-80, -272], [-140, -236], [-180, -210], [-196, -196], [-170, -184], [-120, -178], [-40, -190], [20, -220], [50, -262]],
    spread: [[40, -300], [26, -380], [-16, -470], [-80, -524], [-150, -536], [-204, -512], [-186, -470], [-146, -418], [-86, -360], [-20, -314], [44, -282]],
    covert: [[40, -300], [0, -298], [-84, -272], [-70, -236], [-4, -236], [44, -262]],
    covertSpread: [[40, -300], [26, -380], [-16, -470], [-40, -420], [-12, -356], [34, -300]],
    wrist: [-60, -262],
    wristSpread: [-50, -470],
    tips: [3, 4, 5],
    feather: 62,
    trail: [7, 8, 9],
    secLen: 22,
    scallops: [[-150, -214], [-110, -200], [-70, -196], [-30, -206]],
    scallopsSpread: [[-150, -470], [-110, -420], [-70, -372], [-30, -330]],
  };

  function sheen(ctx, R) {
    const H = R.Mh;
    K.fill(ctx, M.all(R.Mb, K.smooth([[20, -300], [60, -350], [130, -350], [130, -300], [110, -272], [40, -280]], 5)), C.sheenG);
    K.fill(ctx, M.all(H, K.smooth([[50, -360], [70, -392], [110, -380], [134, -350], [110, -334], [70, -336]], 5)), C.sheenV);
  }

  function wingBars(c2, R, B, T, t) {
    if (t > 0.5) return;
    for (const u of [0.45, 0.62]) {
      const a = [lerp(40, -200, u), lerp(-290, -206, u) - 10], b = [lerp(40, -200, u) + 30, lerp(-290, -206, u) + 60];
      K.line(c2, M.all(T, [a, b]), { width: 10, color: '#3E4556', seed: sd('bar', u), boil: B, taper: [4, 4] });
    }
  }

  function cap(ctx, R, B) {
    const H = R.Mh;
    const pts = M.all(H, K.smooth([[56, -398], [66, -442], [108, -462], [156, -452], [178, -424], [150, -418], [110, -424], [80, -412]], 5));
    K.form(ctx, pts, { fill: C.leather, deep: C.leatherDeep, width: 6, seed: sd('cap'), boil: B, spacing: 7, hatchAlpha: 0.7 });
    const flap = M.all(H, K.smooth([[66, -404], [92, -400], [96, -352], [76, -344], [62, -372]], 4));
    K.form(ctx, flap, { fill: C.leather, deep: C.leatherDeep, width: 5.5, seed: sd('flap'), boil: B, spacing: 6 });
    K.line(ctx, M.all(H, [[90, -456], [84, -412]]), { width: 3, color: C.leatherDeep, seed: sd('capSeam'), boil: B });
    K.goggles(ctx, H, 130, -456, 13, { seed: sd('goggles'), boil: B });
  }

  function satchel(ctx, R, B) {
    const T = R.Mb;
    K.line(ctx, M.all(T, [[70, -316], [20, -262], [-30, -206]]), { width: 13, color: P.ink, seed: sd('strap'), boil: B, taper: 0 });
    K.line(ctx, M.all(T, [[70, -316], [20, -262], [-30, -206]]), { width: 7, color: C.leather, seed: sd('strap'), boil: B, taper: 0 });
    const bag = M.all(T, L.rrectPts(-96, -214, 84, 66, 12, 6));
    K.form(ctx, bag, { fill: C.leather, deep: C.leatherDeep, width: 6, seed: sd('bag'), boil: B, spacing: 7 });
    const flap = M.all(T, K.smooth([[-98, -216], [-10, -216], [-14, -186], [-54, -176], [-94, -186]], 4));
    K.form(ctx, flap, { fill: C.leatherDeep, deep: P.ink, width: 5, seed: sd('bagFlap'), boil: B, shade: 0.4, spacing: 6 });
    K.plate(ctx, M.all(T, L.ellipsePts(-54, -184, 7, 7, 10)), { width: 2.8, seed: sd('bagBtn'), boil: B, shade: 0 });
  }

  function note(ctx, x, y, s, rot, B, seed) {
    const pts = M.all(M.chain(M.tr(x, y), M.rot(rot)), L.capsulePts(0, 0, 44 * s, 11 * s, 0, 20));
    K.form(ctx, pts, { fill: C.paper, deep: C.paperDeep, width: 4, seed, boil: B, shade: 0.6, spacing: 4, hatchW: 1.6 });
    K.line(ctx, M.all(M.chain(M.tr(x, y), M.rot(rot)), [[0, -11 * s], [0, 11 * s]]), { width: 3, color: '#B0402E', seed: seed + 1, boil: B, taper: 0, smooth: false });
  }

  function sheet(ctx, x, y, u, B) {
    const w = 40 + 50 * u, h = 64;
    const pts = [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2 + 4], [x + w / 2 - 4, y + h / 2], [x - w / 2 + 2, y + h / 2 - 4]];
    K.fill(ctx, pts, C.paper);
    for (let k = 0; k < 4; k++) K.line(ctx, [[x - w / 2 + 10, y - 20 + k * 13], [x + w / 2 - 12, y - 18 + k * 13]], { width: 2.4, color: C.paperDeep, seed: sd('lines', k), boil: B, taper: 0 });
    L.inkPath(ctx, pts, { closed: true, width: 4, seed: sd('sheet'), boil: B, smooth: false, taper: 0, wobble: 0.4 });
  }

  function bang(ctx, c, s, B) {
    K.fill(ctx, [[c[0] - 12 * s, c[1] - 60 * s], [c[0] + 12 * s, c[1] - 60 * s], [c[0] + 5 * s, c[1] - 6 * s], [c[0] - 5 * s, c[1] - 6 * s]], P.annYellow);
    L.inkPath(ctx, [[c[0] - 12 * s, c[1] - 60 * s], [c[0] + 12 * s, c[1] - 60 * s], [c[0] + 5 * s, c[1] - 6 * s], [c[0] - 5 * s, c[1] - 6 * s]], { closed: true, width: 4.5, seed: sd('bang'), boil: B, smooth: false, taper: 0 });
    K.fill(ctx, L.ellipsePts(c[0], c[1] + 12 * s, 9 * s, 9 * s, 12), P.annYellow);
    L.inkPath(ctx, L.ellipsePts(c[0], c[1] + 12 * s, 9 * s, 9 * s, 12), { closed: true, width: 4, seed: sd('bangDot'), boil: B });
  }

  K.kits.bird.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [60, -330],
    headScale: 1.3,
    bodyC: [-10, -220],
    bodyR: 170,
    gait: 'strut',
    feet: { n: 34, f: -6 },
    wing: WING,
    tailFan: { base: [-150, -168], angle: Math.PI + 0.3, spread: 0.36, n: 5, len: 116, width: 16, taper: 0.14, band: '#3E4556', fill: () => C.tail },
    sit: 34,
    leg: { hipN: [24, -130], hipF: [-6, -134], l1: 46, l2: 58, r: 7, toe: 34 },
    tufts: false,
    fur: true,
    beak: { hinge: [180, -392], tip: [224, -386], upper: [[176, -406], [200, -402], [226, -388], [206, -382], [178, -382]], lower: [[178, -386], [200, -382], [216, -378], [198, -372], [180, -374]], cere: [190, -400, 12, 8] },
    face: { eye: { x: 140, y: -404, r: 14, style: 'iris', iris: '#E07B2E', ring: null } },
    hooks: {
      body: sheen,
      wingInside: wingBars,
      bodyAfter: satchel,
      head: cap,
      legAfter(ctx, R, B, side, knee, f) {
        if (side === 'n' && !(R.pose.fx && R.pose.fx.noLegNote)) note(ctx, (knee[0] + f[0]) / 2 + 4, (knee[1] + f[1]) / 2, 0.8, 1.4, B, sd('legNote'));
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx) return;
        const tip = M.ap(R.Mh, [218, -386]);
        if (fx.item === 'beak') note(ctx, tip[0] + 10, tip[1] + 6, 1, 0.2, B, sd('beakNote'));
        if (fx.item === 'sheet') sheet(ctx, tip[0] + 36, tip[1] + 30, fx.open || 1, B);
        if (fx.bang) {
          const top = M.ap(R.Mh, [110, -520]);
          bang(ctx, top, fx.bang, B);
          if (fx.bang > 0.9) K.fx.burst(ctx, top, 0.4, B, sd('burst'));
        }
      },
    },
    poses: {
      // a peck at the leg, the note in the beak, unrolled, amazed: "!"
      work(d, n, P0) {
        const T = [
          { head: 0.4, hy: 10, fx: {} },
          { head: 0.55, hy: 20, beak: 0.5, fx: { noLegNote: 1 } },
          { head: -0.05, beak: 0.2, fx: { noLegNote: 1, item: 'beak' } },
          { head: 0.05, fx: { noLegNote: 1, item: 'sheet', open: 0.5 } },
          { head: -0.1, fx: { noLegNote: 1, item: 'sheet', open: 1, bang: 0.7 }, eye: 'open' },
          { head: -0.14, sq: 1.05, fx: { noLegNote: 1, item: 'sheet', open: 1, bang: 1.1 } },
          { head: -0.1, sq: 1.04, fx: { noLegNote: 1, item: 'sheet', open: 1, bang: 1 }, eye: 'happy' },
          { head: 0.08, fx: { noLegNote: 1, item: 'sheet', open: 1 } },
        ][d];
        return { head: T.head, hy: T.hy || 0, beak: T.beak || 0, sq: T.sq || 1, eyeMode: T.eye || 'open', feet: P0.idle(0, 12).feet, fx: T.fx };
      },
    },
  });
})();
