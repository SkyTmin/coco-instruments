// pets/20-cat.js : Кот Шрам (uncommon, sell). Front kit, sits.
// A big tabby tom sitting up: grey-brown with dark stripes, the tabby "M" on his forehead, striped
// cheeks, legs and tail, a pale bib; green eyes with slit pupils under half-lowered lids, a
// stitched scar over his right eye, a notch in his left ear, a prison-striped kerchief knotted at
// his throat and a bandage round one foreleg. Work: flips a fish off his paws, it turns into a gold
// coin in the air, he catches it — and the lids come down, smug.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'cat';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#A5937A',
    furDeep: '#665646',
    furLit: '#CDBEA6',
    belly: '#E6DAC4',
    muzzle: '#EFE5D2',
    stripe: '#5A4938',
    skin: '#E6A098',
    nose: '#DE8C86',
    paw: '#A5937A',
    pad: '#D98C86',
    leg: '#A5937A',
    blush: '#E48E88',
    mouth: '#6A2422',
    tongue: '#EE908A',
    scar: '#E9AEA2',
    white: '#F4EEE2',
    black: '#2C2522',
    bandage: '#F2ECDD',
    bandageDeep: '#B9AE98',
    fish: '#8FA7B4',
    fishDeep: '#56707E',
  };

  function markings(c2, R, B) {
    const T = R.Mh;
    // the tabby M on the forehead and stripes on the cheeks
    const M1 = [R.hl(-54, -80, 0.8), R.hl(-40, -128, 0.6), R.hl(-18, -96, 0.7), R.hl(0, -134, 0.6), R.hl(18, -96, 0.7), R.hl(40, -128, 0.6), R.hl(54, -80, 0.8)];
    K.line(c2, M.all(T, M1), { width: 12, color: C.stripe, seed: sd('M'), boil: B, smooth: false, taper: [5, 5] });
    for (const x of [-96, 96]) K.line(c2, M.all(T, [R.hl(x, -120, 0.5), R.hl(x * 1.05, -80, 0.6)]), { width: 11, color: C.stripe, seed: sd('fs', x), boil: B, taper: [6, 6] });
    for (const s of [-1, 1])
      for (let k = 0; k < 3; k++) K.line(c2, M.all(T, K.curve([R.hl(s * 196, 10 + k * 26, 0.2), R.hl(s * 160, 16 + k * 22, 0.45), R.hl(s * 128, 30 + k * 16, 0.6)], 4)), { width: 10, color: C.stripe, seed: sd('cs', s, k), boil: B, taper: [8, 3] });
  }

  function bodyStripes(c2, R, B) {
    const T = R.Mb;
    for (const s of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const y = -290 + k * 58;
        K.line(c2, M.all(T, K.curve([[s * 184, y + 20], [s * 150, y], [s * 118, y + 16]], 4)), { width: 13, color: C.stripe, seed: sd('bs', s, k), boil: B, taper: [8, 4] });
      }
  }

  function scar(ctx, R, B) {
    const T = R.Mh;
    const a = R.hl(40, -96, 0.8), b = R.hl(100, 40, 0.8);
    const s = M.all(T, [a, [lerp(a[0], b[0], 0.5) + 6, lerp(a[1], b[1], 0.5)], b]);
    K.line(ctx, s, { width: 14, color: P.ink, seed: sd('scar'), boil: B, taper: [5, 6] });
    K.line(ctx, s, { width: 8, color: C.scar, seed: sd('scar'), boil: B, taper: [5, 6] });
    for (let k = 0; k < 4; k++) {
      const u = 0.15 + k * 0.23;
      const c = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
      K.line(ctx, M.all(T, [[c[0] - 12, c[1] - 3], [c[0] + 12, c[1] + 3]]), { width: 3, seed: sd('stitch', k), boil: B, smooth: false, taper: 0 });
    }
  }

  function kerchief(ctx, R, B) {
    const T = R.Mb;
    // a band round the neck, a triangle over the bib, prison stripes, a knot at his left
    const band = M.all(T, K.smooth([[-150, -350], [0, -326], [150, -350], [148, -318], [0, -292], [-148, -318]], 4));
    const tri = M.all(T, K.smooth([[-120, -330], [120, -330], [10, -176], [-10, -176]], 3));
    for (const pts of [tri, band])
      F().form(ctx, pts, C.white, B, sd('ker', pts.length), {
        width: 6,
        off: 0.1,
        hatch: 0.5,
        inside(c2) {
          for (let k = -6; k <= 6; k++) K.line(c2, M.all(T, [[k * 28 - 30, -380], [k * 28 + 40, -160]]), { width: 13, color: C.black, seed: sd('ks', k), boil: B, taper: 0, smooth: false });
        },
      });
    const kn = M.ap(T, [-120, -326]);
    F().form(ctx, L.ellipsePts(kn[0], kn[1], 24, 20, 16), C.white, B, sd('knot'), { width: 5, off: 0.1, hatch: 0.5, inside: (c2) => K.line(c2, [[kn[0] - 20, kn[1] - 10], [kn[0] + 20, kn[1] + 10]], { width: 10, color: C.black, seed: sd('kk'), boil: B, taper: 0 }) });
    for (const s of [-1, 1]) {
      const tail = M.all(T, K.smooth([[-130, -318], [-150 + s * 20, -270], [-164 + s * 30, -250], [-140 + s * 10, -290]], 3));
      F().form(ctx, tail, C.white, B, sd('ktail', s), { width: 4.5, off: 0.1, hatch: 0.4, rim: false });
    }
  }

  function fish(ctx, c, a, s, B, seed) {
    const T = M.chain(M.tr(c[0], c[1]), M.rot(a), M.sc(s, s));
    const body = M.all(T, K.smooth([[-50, 0], [-10, -22], [30, -14], [50, 0], [30, 14], [-10, 22]], 4));
    const tail = M.all(T, [[-46, 0], [-80, -24], [-72, 0], [-80, 24]]);
    F().form(ctx, tail, C.fishDeep, B, seed + 1, { width: 4, off: 0.1, hatch: 0, rim: false, smooth: false });
    F().form(ctx, body, C.fish, B, seed, {
      width: 4.5,
      off: 0.12,
      shine: 0.8,
      hatch: 0.3,
      inside(c2) {
        for (let k = 0; k < 3; k++) K.line(c2, M.all(T, K.curve([[-20 + k * 14, -14], [-14 + k * 14, 0], [-20 + k * 14, 14]], 4)), { width: 2, color: C.fishDeep, seed: seed + 3 + k, boil: B });
      },
    });
    K.fill(ctx, M.all(T, L.ellipsePts(32, -4, 5, 5, 10)), P.ink);
  }

  const WORK = [
    { arm: 1.4, lift: 130, item: 'fishChest' },
    { arm: 2.0, lift: 110, item: 'fishAir', h: 0.8, spin: 0.8, look: [0, -0.6], head: -0.12 },
    { arm: 1.6, lift: 120, item: 'fishAir', h: 1.15, spin: 2.2, look: [0, -0.8], head: -0.16 },
    { arm: 1.6, lift: 120, item: 'coinAir', h: 1.2, spin: 0.1, burst: 1, look: [0, -0.8], head: -0.16, eye: 'open' },
    { arm: 1.8, lift: 120, item: 'coinAir', h: 0.6, spin: 0.45, look: [0, -0.5] },
    { arm: 1.4, lift: 130, item: 'coinChest', eye: 'happy', mouth: 0.6 },
    { arm: 1.4, lift: 130, item: 'coinChest', lid: 0.55, turn: 0.2, star: 1 },
    { arm: 1.4, lift: 130, item: 'coinChest', lid: 0.45 },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'sit',
    bodyC: [0, -190],
    bodyR: 260,
    body: { half: [[0, -344], [84, -334], [136, -292], [164, -210], [178, -116], [172, -44], [132, -16], [0, -12]] },
    belly: [0, -214, 70, 122],
    sit: {
      thigh: [118, -98, 78, 86],
      hind: [156, 0, 48, 24],
      front: { at: [62, -250], len: 232, r: 30, paw: [40, 26], splay: 0.04, stripes: 3 },
      thighStripes: 3,
    },
    tail: { pts: [[110, -60], [226, -80], [276, -200], [250, -320], [206, -364]], w0: 34, w1: 28, rings: 5, ringColor: C.stripe, tip: C.stripe, tipLen: 0.14, swing: 0.8 },
    head: { c: [0, -486], rx: 184, ry: 152, half: [[0, -152], [92, -144], [152, -106], [184, -44], [202, 26], [176, 66], [124, 104], [62, 124], [0, 130]], tufts: [[0.36, 0.44, 22], [0.56, 0.64, 22]] },
    ears: {
      at: [112, -118],
      pts: [[-56, 10], [-12, -124], [48, 8]],
      inner: [[-36, 4], [-12, -88], [26, 4]],
      ptsL: [[56, 10], [12, -124], [-10, -88], [6, -72], [-22, -58], [-48, 8]],
      innerL: [[36, 4], [12, -88], [-4, -60], [-26, 4]],
      fill: C.fur,
      innerFill: C.skin,
      tilt: 0.1,
    },
    face: {
      eyes: { x: 70, y: -12, rx: 34, ry: 36, white: '#FBF6E6', iris: '#9EC23A', irisR: 0.82, slit: true, lid: 0.26, lidColor: C.fur, tilt: -0.1, lash: true },
      muzzle: [0, 52, 76, 46],
      nose: { y: 30, w: 22, h: 16 },
      mouth: { y: 58, w: 28, drop: 12, h: 30, style: 'cat', fangs: 16 },
      whiskers: { x: 62, y: 44, len: 116 },
      blush: [118, 40, 24],
    },
    shadowW: 270,
    attack: 'slash',
    hooks: {
      skin: markings,
      body: bodyStripes,
      front: kerchief,
      face: scar,
      hand(ctx, R, B, side, end) {
        const fx = R.pose.fx || {};
        // the bandage on his left foreleg
        if (side < 0) {
          // wound round the leg just above the paw, following the leg
          const { sh } = K.front.sitPaw(R, side);
          const dx = end[0] - sh[0], dy = end[1] - sh[1], dl = Math.hypot(dx, dy) || 1;
          const ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
          for (let k = 0; k < 3; k++) {
            const c = [end[0] - ux * (70 - k * 15), end[1] - uy * (70 - k * 15)];
            const w = 33;
            const band = [[c[0] - nx * w - ux * 6, c[1] - ny * w - uy * 6], [c[0] + nx * w - ux * 2, c[1] + ny * w - uy * 2], [c[0] + nx * w + ux * 9, c[1] + ny * w + uy * 9], [c[0] - nx * w + ux * 5, c[1] - ny * w + uy * 5]];
            K.fill(ctx, band, C.bandage);
            L.inkPath(ctx, band, { closed: true, width: 3, seed: sd('bd', k), boil: B, smooth: false, taper: 0, wobble: 0.3 });
          }
        }
        if (side < 0 || !fx.item) return;
        const l = [end[0] - 2 * (end[0] - K.CXF), end[1]];
        const mid = [(end[0] + l[0]) / 2, end[1] - 30];
        // the toss is measured from the paws (0) to just over the head (1)
        const top = R.hp(0, -R.S.head.ry, 0)[1] - 70;
        const y = (h) => mid[1] + (top - mid[1]) * h;
        if (fx.item === 'fishChest') fish(ctx, mid, 0, 1.1, B, sd('fishC'));
        if (fx.item === 'fishAir') fish(ctx, [mid[0], y(fx.h)], fx.spin, 1.1, B, sd('fishA'));
        if (fx.item === 'coinAir') {
          K.fx.coin(ctx, mid[0], y(fx.h), 34, fx.spin, B, sd('coinA'));
          if (fx.burst) K.fx.star(ctx, mid[0] + 50, y(fx.h) - 40, 40, B, sd('cb'), '#FFF1C4');
        }
        if (fx.item === 'coinChest') K.fx.coin(ctx, mid[0], mid[1], 34, 0.05, B, sd('coinC'));
        if (fx.star) K.fx.star(ctx, mid[0] + 60, mid[1] - 40, 28, B, sd('cs'), '#FFF1C4');
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { arm: { l: T.arm, r: T.arm }, leg: { l: T.lift, r: T.lift }, look: T.look || null, head: T.head || 0, eyeMode: T.eye || 'open', mouth: T.mouth || 0, lid: T.lid == null ? null : T.lid, turn: T.turn || 0, fx: { item: T.item, h: T.h, spin: T.spin, burst: T.burst, star: T.star } };
      },
    },
  });
})();
