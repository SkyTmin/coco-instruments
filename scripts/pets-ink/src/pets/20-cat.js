// pets/20-cat.js : Кот Шрам (uncommon, sell). Quad kit.
// A scruffy grey-brown tabby: the scar that names him runs through the visible eye (the eye is
// narrowed, not lost — a patch there would kill his whole face), a notched ear, a striped prisoner
// neckerchief, a bandaged front leg, a question-mark tail. Swipes with a paw. Work: brings a fish,
// pats it, the fish turns into a coin, walks off with the coin in his teeth.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'cat';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9E8C74',
    furDeep: '#665646',
    furLit: '#C6B69E',
    chest: '#DCCEB6',
    stripe: '#5A4938',
    skin: '#E0978E',
    skinDeep: '#B46A62',
    nose: '#D98A82',
    noseDeep: '#A8605A',
    eye: '#1A110E',
    scar: '#E7A89C',
    mouth: '#5E2220',
    tongue: '#E88E86',
    band: '#EFE9DC',
    bandDark: '#2C2522',
    bandage: '#F2ECDD',
    bandageDeep: '#B9AE98',
    fish: '#8FA7B4',
    fishDeep: '#56707E',
  };

  const SIL = [
    [-150, -120, 0],
    [-184, -166, 0],
    [-188, -230, 0],
    [-158, -264, 0],
    [-90, -278, 0],
    [0, -282, 0],
    [72, -292, 0.2],
    [112, -322, 0.6],
    [128, -378, 1],
    [160, -422, 1],
    [220, -438, 1],
    [276, -414, 1],
    [298, -378, 1],
    [314, -352, 1],
    [302, -328, 1],
    [278, -306, 1],
    [232, -290, 1],
    [184, -270, 0.7],
    [152, -232, 0.2],
    [140, -170, 0],
    [100, -128, 0],
    [0, -118, 0],
    [-100, -122, 0],
  ];

  // a pointed ear with a V notch out of its tip (near) or whole (far)
  const earPts = (x, y, h, w, notch) =>
    notch ? [[x - w, y], [x - w * 0.6, y - h * 0.6], [x - w * 0.22, y - h], [x + w * 0.02, y - h * 0.62], [x + w * 0.3, y - h * 0.88], [x + w * 0.7, y - h * 0.4], [x + w * 0.8, y + 6]] : [[x - w, y], [x - w * 0.4, y - h * 0.7], [x, y - h], [x + w * 0.5, y - h * 0.5], [x + w * 0.8, y + 6]];

  function stripes(ctx, R) {
    const T = R.Mb;
    // across the back and the haunch
    for (let k = 0; k < 7; k++) {
      const x = -168 + k * 40;
      K.fill(ctx, M.all(T, K.smooth([[x - 10, -300], [x + 12, -300], [x + 20, -240], [x + 6, -200], [x - 2, -236]], 4)), C.stripe);
    }
    K.fill(ctx, M.all(T, K.smooth([[-176, -200], [-126, -214], [-106, -196], [-166, -180]], 4)), C.stripe);
    // the M on the forehead and cheek stripes
    const H = R.Mh;
    for (const [x0, y0, x1, y1] of [[170, -430, 196, -392], [200, -438, 214, -398], [236, -436, 238, -404]]) {
      K.fill(ctx, M.all(H, K.ribbonPts([[x0, y0], [(x0 + x1) / 2 + 2, (y0 + y1) / 2], [x1, y1]], 13, 4)), C.stripe);
    }
    for (const [x0, y0, x1, y1] of [[196, -350, 150, -344], [202, -330, 160, -318]]) {
      K.fill(ctx, M.all(H, K.ribbonPts([[x0, y0], [x1, y1]], 10, 3)), C.stripe);
    }
    // the pale muzzle and chest
    K.fill(ctx, M.all(H, K.smooth([[252, -360], [300, -370], [318, -340], [300, -310], [262, -300], [236, -320]], 5)), C.chest);
    K.fill(ctx, M.all(T, K.smooth([[120, -290], [170, -270], [158, -190], [120, -150], [96, -210]], 5)), C.chest);
  }

  function scar(ctx, R, B) {
    const H = R.Mh;
    const s = M.all(H, [[216, -452], [228, -426], [252, -362], [262, -338]]);
    K.line(ctx, s, { width: 11, color: P.ink, seed: sd('scar'), boil: B, taper: [5, 7] });
    K.line(ctx, s, { width: 6, color: C.scar, seed: sd('scar'), boil: B, taper: [5, 7] });
    for (let k = 0; k < 4; k++) {
      const u = k / 3;
      const x = 218 + u * 42, y = -446 + u * 104;
      if (y > -414 && y < -372) continue; // the eye sits on the scar
      K.line(ctx, M.all(H, [[x - 11, y + 3], [x + 11, y - 3]]), { width: 3, seed: sd('scarSt', k), boil: B, smooth: false, taper: 0 });
    }
  }

  // the striped prisoner neckerchief, knotted at the throat, its corner hanging on the chest
  function kerchief(ctx, R, B) {
    const T = R.Mf;
    const band = M.all(T, K.smooth([[92, -334], [150, -312], [196, -286], [190, -262], [140, -284], [86, -306]], 5));
    const tri = M.all(T, K.smooth([[150, -300], [196, -278], [184, -220], [164, -206], [150, -250]], 4));
    for (const pts of [band, tri]) {
      K.fill(ctx, pts, C.band);
      K.clip(ctx, pts, () => {
        for (let k = -6; k < 12; k++) {
          const a = M.ap(T, [60 + k * 22, -360]), b = M.ap(T, [110 + k * 22, -180]);
          const w = 9;
          K.fill(ctx, [[a[0] - w, a[1]], [a[0] + w, a[1]], [b[0] + w, b[1]], [b[0] - w, b[1]]], C.bandDark);
        }
      });
      L.inkPath(ctx, pts, { closed: true, width: 5, seed: sd('kerch', pts.length), boil: B, wobble: 0.6, taper: [4, 8] });
    }
    const knot = M.all(T, L.ellipsePts(176, -284, 17, 14, 16));
    K.form(ctx, knot, { fill: C.band, deep: C.bandDark, width: 4.5, seed: sd('knot'), boil: B, shade: 0.8, spacing: 5, hatchW: 1.8 });
  }

  // the bandage wrapped round the near front leg
  function bandage(ctx, R, B, key, knee, foot) {
    if (key !== 'fn') return;
    const a = [knee[0] + (foot[0] - knee[0]) * 0.25, knee[1] + (foot[1] - knee[1]) * 0.25];
    const b = [knee[0] + (foot[0] - knee[0]) * 0.8, knee[1] + (foot[1] - knee[1]) * 0.8];
    const wrap = K.limbPts(a, b, 22, 21, 6);
    K.form(ctx, wrap, { fill: C.bandage, deep: C.bandageDeep, width: 5, seed: sd('bandage'), boil: B, shade: 0.7, spacing: 6, hatchW: 2 });
    for (let k = 1; k < 4; k++) {
      const u = k / 4;
      const c = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      K.line(ctx, [[c[0] - 21, c[1] - 6], [c[0] + 21, c[1] + 6]], { width: 3, color: C.bandageDeep, seed: sd('wrap', k), boil: B, taper: [2, 2] });
    }
  }

  function fish(ctx, x, y, s, rot, B) {
    const T = M.chain(M.tr(x, y), M.rot(rot), M.sc(s));
    const body = M.all(T, K.smooth([[-40, 0], [-10, -18], [26, -14], [44, 0], [26, 14], [-10, 16]], 4));
    const tail = M.all(T, [[-36, 0], [-62, -18], [-56, 0], [-62, 18]]);
    K.form(ctx, tail, { fill: C.fish, deep: C.fishDeep, width: 4, seed: sd('fishT'), boil: B, shade: 0.5, spacing: 5, hatchW: 1.6 });
    K.form(ctx, body, { fill: C.fish, deep: C.fishDeep, width: 4.5, seed: sd('fish'), boil: B, shade: 0.8, spacing: 5, hatchW: 1.6 });
    K.fill(ctx, M.all(T, L.ellipsePts(28, -3, 4, 4, 8)), P.ink);
    K.line(ctx, M.all(T, [[10, -12], [4, 0], [10, 12]]), { width: 2.6, seed: sd('gill'), boil: B, taper: 0 });
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeYellow,
    sil: SIL,
    neck: [150, -300],
    headScale: 1.24,
    spine: [0, -250],
    bodyC: [-20, -200],
    bodyR: 220,
    front: { atN: [100, -150], atF: [76, -160], l1: 72, l2: 70, r1: 27, rj: 20, r2: 18, paw: [30, 15] },
    hind: { atN: [-126, -168], atF: [-104, -176], l1: 88, l2: 72, r1: 44, rj: 20, r2: 17, paw: [30, 15] },
    feet: { fn: 118, ff: 92, hn: -132, hf: -106 },
    stride: 50,
    attack: 'swipe',
    slashAt: [330, -240],
    tail: { base: [-180, -234], len: 250, lift: 0.9, curl: -1.1, rise: 0, w0: 30, w1: 22, fill: C.fur, deep: C.furDeep, ink: 6, rings: 5, ringCol: C.stripe },
    ears: {
      n: { at: [150, -410], flop: 0.12, fill: C.fur, deep: C.furDeep, innerFill: C.skin, pts: earPts(150, -408, 104, 44, true), inner: earPts(152, -414, 70, 26, false) },
      f: { at: [230, -430], flop: 0.1, fill: C.fur, deep: C.furDeep, innerFill: C.skin, pts: earPts(232, -428, 96, 40, false), inner: null },
    },
    tuftBelow: -160,
    face: {
      eye: { x: 240, y: -392, r: 21, style: 'iris', iris: '#C4B53A', slit: true, lid: 0.42, lidColor: C.fur },
      nose: { x: 310, y: -352, rx: 12, ry: 9 },
      mouth: [[304, -326], [288, -318], [268, -318]],
      whiskers: [296, -340, 118],
      blush: null,
      tongue: 0,
      fangs: 0.8,
    },
    hooks: {
      body: stripes,
      face: scar,
      front: kerchief,
      legAfter: bandage,
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx || !fx.item) return;
        const mouth = M.ap(R.Mh, [300, -318]);
        const g = M.ap(R.Mr, [260, -26]);
        if (fx.item === 'fishMouth') fish(ctx, mouth[0] + 8, mouth[1] + 14, 1, 0.25, B);
        if (fx.item === 'fishGround') fish(ctx, g[0], g[1], 1.05, 0, B);
        if (fx.item === 'coinGround') {
          K.fx.coin(ctx, g[0], g[1] - 10, 30, 0, B, sd('coin'));
          K.fx.star(ctx, g[0] + 44, g[1] - 60, 30, B, sd('st1'), '#FFF1C4');
          K.fx.star(ctx, g[0] - 40, g[1] - 44, 20, B, sd('st2'), '#FFF1C4');
        }
        if (fx.item === 'coinMouth') {
          K.fx.coin(ctx, mouth[0] + 10, mouth[1] + 10, 26, 0.12, B, sd('coinM'));
          if (fx.star) K.fx.star(ctx, mouth[0] + 50, mouth[1] - 40, 24 * fx.star, B, sd('st3'), '#FFF1C4');
        }
      },
    },
    poses: {
      work(d, n, P0) {
        const legs = P0.idle(0, 12).legs;
        const T = [
          { head: 0, item: 'fishMouth' },
          { head: 0.18, hy: 10, item: 'fishMouth' },
          { head: -0.04, item: 'fishGround' },
          { head: 0.08, item: 'fishGround', paw: 1 },
          { head: 0.02, item: 'coinGround', mode: 'happy' },
          { head: 0.3, hy: 16, item: 'coinGround' },
          { head: -0.12, item: 'coinMouth', star: 1, mode: 'happy' },
          { head: -0.1, item: 'coinMouth', star: 0.6 },
        ][d];
        if (T.paw) legs.fn = { x: 176, lift: 30 };
        return { head: T.head, hy: T.hy || 0, eyeMode: T.mode || 'open', tail: d % 2 ? 0.2 : -0.1, legs, fx: { item: T.item, star: T.star } };
      },
    },
  });
})();
