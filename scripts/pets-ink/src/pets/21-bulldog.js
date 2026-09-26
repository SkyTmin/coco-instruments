// pets/21-bulldog.js : Бульдог Кастет (uncommon, dmg). Quad kit.
// A stocky fawn-and-white bulldog: a chest wider than he is long, a square head with heavy jowls,
// an underbite with two little fangs pointing up, a scar over the eye, rose ears. A spiked black
// collar with a big steel ring, spiked cuffs on the forelegs. Bites. Work: crouches, leaps, slams
// headfirst into the ground (it cracks, stones fly), shakes it off, proud.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'bulldog';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#BC8C5F',
    furDeep: '#7D5A3A',
    furLit: '#DDB88E',
    white: '#F1E9DB',
    chest: '#F1E9DB',
    skin: '#D9968C',
    skinDeep: '#A8605A',
    nose: '#2C2523',
    noseDeep: '#141010',
    eye: '#1A110E',
    mouth: '#5E2220',
    tongue: '#E88E86',
    scar: '#E7A89C',
    leather: '#2E2724',
    leatherDeep: '#141010',
    steel: '#C9CED2',
    steelDeep: '#737B81',
    stone: '#8A857E',
    stoneDeep: '#55504A',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
  };

  const SIL = [
    [-150, -140, 0],
    [-174, -192, 0],
    [-170, -252, 0],
    [-128, -282, 0],
    [-40, -298, 0],
    [40, -310, 0.1],
    [100, -334, 0.5],
    [124, -392, 1],
    [164, -432, 1],
    [232, -442, 1],
    [290, -424, 1],
    [322, -392, 1],
    [336, -362, 1],
    [340, -338, 1],
    [334, -316, 1],
    [346, -298, 1],
    [328, -272, 1],
    [278, -262, 1],
    [222, -262, 0.9],
    [182, -240, 0.5],
    [194, -190, 0],
    [174, -130, 0],
    [100, -118, 0],
    [0, -124, 0],
    [-80, -134, 0],
  ];

  function markings(ctx, R) {
    const H = R.Mh, T = R.Mb;
    // white chest and throat, white muzzle and a blaze up the forehead
    K.fill(ctx, M.all(T, K.smooth([[120, -320], [196, -300], [200, -190], [176, -126], [120, -130], [100, -220]], 5)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[278, -400], [320, -396], [346, -360], [350, -290], [300, -262], [250, -276], [262, -330]], 5)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[262, -440], [296, -428], [300, -396], [280, -396]], 4)), C.white);
    // jowl fold and brow wrinkles
  }

  function face(ctx, R, B) {
    const H = R.Mh;
    K.line(ctx, M.all(H, [[268, -330], [290, -300], [322, -296]]), { width: 4, color: P.inkSoft, seed: sd('jowl'), boil: B });
    for (let k = 0; k < 2; k++) K.line(ctx, M.all(H, [[236 + k * 8, -432 + k * 12], [266 + k * 6, -438 + k * 12]]), { width: 3.2, color: C.furDeep, seed: sd('brow', k), boil: B });
    // the scar over the eye
    const s = M.all(H, [[232, -440], [248, -406], [266, -370]]);
    K.line(ctx, s, { width: 10, color: P.ink, seed: sd('scar'), boil: B, taper: [5, 7] });
    K.line(ctx, s, { width: 5, color: C.scar, seed: sd('scar'), boil: B, taper: [5, 7] });
    // the underbite: two small fangs up from the lower jaw, always showing
    for (const x of [326, 306]) {
      const f = M.all(H, [[x - 6, -300], [x + 6, -300], [x + 1, -320]]);
      K.fill(ctx, f, P.white);
      L.inkPath(ctx, f, { closed: true, width: 2.6, seed: sd('fang', x), boil: B, smooth: false, taper: 0, wobble: 0.2 });
    }
  }

  function spikes(ctx, pts, n, h, B, seed) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const k = Math.floor(u * (pts.length - 1));
      const a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      const nx = ty / tl, ny = -tx / tl;
      const s = [[a[0] - (tx / tl) * 9, a[1] - (ty / tl) * 9], [a[0] + nx * h, a[1] + ny * h], [a[0] + (tx / tl) * 9, a[1] + (ty / tl) * 9]];
      K.fill(ctx, s, C.steel);
      L.inkPath(ctx, s, { closed: true, width: 3, seed: seed + i, boil: B, smooth: false, taper: 0, wobble: 0.2 });
    }
  }

  function collar(ctx, R, B) {
    const T = R.Mf;
    const line = M.all(T, K.curve([[92, -356], [140, -330], [190, -290], [214, -262]], 8));
    K.band(ctx, line, 30, { fill: C.leather, deep: C.leatherDeep, seed: sd('collar'), boil: B, width: 5 });
    spikes(ctx, line, 5, 20, B, sd('spk'));
    const ring = M.ap(T, [200, -244]);
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 24, 26, 24), { closed: true, width: 14, color: P.ink, seed: sd('ring'), boil: B, wobble: 0.4 });
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 24, 26, 24), { closed: true, width: 7, color: C.steel, seed: sd('ring'), boil: B, wobble: 0.4 });
  }

  function cuff(ctx, R, B, key, knee, foot, far) {
    if (key[0] !== 'f') return;
    const a = [knee[0] + (foot[0] - knee[0]) * 0.45, knee[1] + (foot[1] - knee[1]) * 0.45];
    const b = [knee[0] + (foot[0] - knee[0]) * 0.75, knee[1] + (foot[1] - knee[1]) * 0.75];
    const band = K.limbPts(a, b, 27, 26, 6);
    K.form(ctx, band, { fill: K.far(C.leather, far), deep: C.leatherDeep, width: 4.5, seed: sd('cuff', key), boil: B, shade: 0 });
    if (!far) spikes(ctx, [[b[0] + 26, b[1]], [a[0] + 26, a[1]]], 2, 14, B, sd('cspk', key));
  }

  function smash(ctx, R, B) {
    const fx = R.pose.fx;
    if (!fx || !fx.crack) return;
    const g = M.ap(R.Mr, [330, 0]);
    const k = fx.crack;
    // cracks spreading along the ground from the hit
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i - 2) * 0.35;
      const len = 90 + 130 * k * (0.6 + 0.4 * L.h3(i, 1, 77));
      const pts = [[g[0], g[1] + 2]];
      for (let s = 1; s <= 3; s++) pts.push([g[0] + Math.cos(a) * len * (s / 3) * (i % 2 ? -1 : 1), g[1] + 2 + Math.abs(Math.sin(a)) * 12 * (s / 3) + (s % 2 ? 6 : -4)]);
      K.line(ctx, pts, { width: 7, seed: sd('crack', i), boil: B, smooth: false, taper: [2, 12] });
    }
    // stones flying up
    if (fx.debris) {
      for (let i = 0; i < 6; i++) {
        const t = fx.debris;
        const vx = (i - 2.5) * 34, vy = -120 - 40 * L.h3(i, 2, 77);
        const x = g[0] + vx * t, y = g[1] - 20 + vy * t + 90 * t * t;
        const r = 16 + 10 * L.h3(i, 3, 77);
        K.form(ctx, L.ellipsePts(x, y, r, r * 0.8, 8, i), { fill: i % 2 ? C.stone : C.dirt, deep: C.stoneDeep, width: 4, seed: sd('deb', i), boil: B, shade: 0.6, spacing: 5, hatchW: 1.8 });
      }
    }
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [150, -320],
    headScale: 1.12,
    spine: [0, -250],
    bodyC: [0, -210],
    bodyR: 220,
    front: { atN: [124, -150], atF: [100, -158], l1: 66, l2: 62, r1: 36, rj: 27, r2: 24, paw: [36, 17] },
    hind: { atN: [-120, -164], atF: [-98, -172], l1: 78, l2: 62, r1: 48, rj: 25, r2: 21, paw: [34, 16] },
    feet: { fn: 134, ff: 108, hn: -124, hf: -100 },
    stride: 46,
    lift: 32,
    pawFill: (key) => (key === 'fn' ? C.white : C.fur),
    tail: { base: [-168, -238], len: 52, lift: 0.7, curl: 0, rise: 0, w0: 30, w1: 20, fill: C.fur, deep: C.furDeep, ink: 6 },
    ears: {
      n: { at: [170, -424], flop: 0.1, fill: C.fur, deep: C.furDeep, innerFill: C.skin, pts: [[150, -420], [160, -452], [196, -458], [214, -432], [194, -414]], inner: [[164, -426], [172, -446], [192, -448], [200, -432]] },
      f: { at: [250, -440], flop: 0.08, fill: C.fur, deep: C.furDeep, innerFill: C.skin, pts: [[236, -434], [248, -464], [282, -462], [290, -436]], inner: null },
    },
    tuftBelow: -300,
    tufts: false,
    face: {
      eye: { x: 254, y: -394, r: 17, style: 'iris', iris: '#5C3B22', lid: 0.35, lidColor: C.fur },
      nose: { x: 332, y: -350, rx: 18, ry: 13 },
      mouth: [[336, -310], [306, -300], [276, -290]],
      whiskers: null,
      blush: null,
      tongue: 36,
      fangs: 1,
    },
    hooks: { body: markings, face, front: collar, legAfter: cuff, fx: smash },
    poses: {
      // growl in a crouch, leap, slam headfirst (the ground cracks), shake it off, proud
      work(d, n, P0) {
        const st = P0.idle(0, 12).legs;
        const tuck = { fn: { x: 150, lift: 50 }, ff: { x: 124, lift: 50 }, hn: { x: -140, lift: 50 }, hf: { x: -116, lift: 50 } };
        const T = [
          { bow: 0.18, sq: 0.9, mouth: -1, eye: 'angry', legs: st },
          { y: -110, sq: 1.08, bow: -0.1, legs: tuck, eye: 'angry' },
          { y: -150, bow: 0.1, head: 0.2, legs: tuck, eye: 'angry' },
          { x: 30, bow: 0.4, head: 0.35, sq: 0.9, legs: st, crack: 0.6, debris: 0.25, eye: 'closed' },
          { x: 30, bow: 0.34, head: 0.3, sq: 0.94, legs: st, crack: 1, debris: 0.6, eye: 'closed' },
          { x: 20, bow: 0.1, head: 0.05, legs: st, crack: 1, debris: 0.95 },
          { x: 10, bow: 0, head: -0.16, legs: st, crack: 1, ear: 1 },
          { x: 0, bow: 0, head: -0.08, legs: st, crack: 1, mouth: 0.8, eye: 'happy' },
        ][d];
        return { x: T.x || 0, y: T.y || 0, bow: T.bow, sq: T.sq || 1, head: T.head || 0, mouth: T.mouth || 0, eyeMode: T.eye || 'open', ear: T.ear || 0, legs: T.legs, fx: { crack: T.crack || 0, debris: T.debris || 0 } };
      },
    },
  });
})();
