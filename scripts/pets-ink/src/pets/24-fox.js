// pets/24-fox.js : Лис-картёжник (epic, sell). Quad kit.
// A slim red fox with a sly half-lidded amber eye, white cheeks and chest, black socks, black-backed
// ears, a big brush of a tail with a white tip. A card sharp: a burgundy vest with brass buttons
// and a gold watch chain, the ace tucked behind his ear. Bites. Work: tosses the card from his
// teeth, it spins, flashes into a gold coin, he catches the coin and winks.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'fox';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#D46A2E',
    furDeep: '#8C3D17',
    furLit: '#F19B5C',
    chest: '#F4ECDF',
    white: '#F4ECDF',
    black: '#2E2420',
    skin: '#D98C84',
    skinDeep: '#A8605A',
    nose: '#2A2320',
    noseDeep: '#141010',
    eye: '#1A110E',
    mouth: '#5E2220',
    tongue: '#E88E86',
    vest: '#6B2A38',
    vestDeep: '#3E1520',
    gold: '#E2B54A',
    goldDeep: '#96701E',
    card: '#FBF6EA',
    cardRed: '#C0392B',
  };

  const SIL = [
    [-176, -170, 0],
    [-206, -220, 0],
    [-196, -272, 0],
    [-140, -292, 0],
    [-40, -300, 0],
    [60, -312, 0.1],
    [112, -346, 0.5],
    [138, -398, 1],
    [178, -430, 1],
    [236, -430, 1],
    [276, -404, 1],
    [330, -380, 1],
    [384, -366, 1],
    [398, -352, 1],
    [384, -338, 1],
    [334, -330, 1],
    [288, -316, 1],
    [244, -302, 0.9],
    [196, -280, 0.5],
    [188, -226, 0],
    [164, -178, 0],
    [100, -168, 0],
    [0, -172, 0],
    [-100, -174, 0],
  ];

  function markings(ctx, R) {
    const H = R.Mh, T = R.Mb;
    K.fill(ctx, M.all(H, K.smooth([[248, -380], [310, -362], [392, -350], [388, -334], [320, -322], [262, -304], [220, -318], [232, -352]], 5)), C.white);
    K.fill(ctx, M.all(T, K.smooth([[140, -330], [196, -290], [192, -210], [150, -180], [126, -250]], 5)), C.white);
  }

  function vest(ctx, R, B, bodyPts) {
    const T = R.Mb;
    const v = M.all(T, K.smooth([[-90, -320], [40, -330], [96, -310], [120, -250], [110, -176], [-90, -170]], 5));
    K.clip(ctx, bodyPts, () => {
      K.form(ctx, v, {
        fill: C.vest,
        deep: C.vestDeep,
        c: R.center,
        width: 6,
        seed: sd('vest'),
        boil: B,
        spacing: 8,
        hatchAlpha: 0.7,
        after(c2) {
          K.line(c2, M.all(T, K.curve([[96, -310], [112, -250], [104, -176]], 8)), { width: 3.4, color: '#9A4658', seed: sd('hem'), boil: B });
          for (const y of [-290, -250, -210]) K.plate(c2, M.all(T, L.ellipsePts(106, y, 7, 7, 12)), { fill: C.gold, deep: C.goldDeep, width: 2.8, seed: sd('btn', y), boil: B, shade: 0 });
        },
      });
    });
    // the watch chain, looped from a button to the pocket
    const chain = M.all(T, K.curve([[106, -250], [60, -214], [0, -206], [-40, -224]], 6));
    L.inkPath(ctx, chain, { width: 7, color: P.ink, seed: sd('chain'), boil: B, taper: [2, 2], wobble: 0.5 });
    L.inkPath(ctx, chain, { width: 3.4, color: C.gold, seed: sd('chain'), boil: B, taper: [2, 2], wobble: 0.5 });
    K.plate(ctx, M.all(T, L.ellipsePts(-46, -226, 13, 13, 16)), { fill: C.gold, deep: C.goldDeep, width: 4, seed: sd('watch'), boil: B });
  }

  function card(ctx, T, x, y, rot, turn, B, seed, back) {
    const w = 26 * Math.max(0.12, Math.abs(Math.cos(Math.PI * turn)));
    const pts = M.all(M.chain(T, M.tr(x, y), M.rot(rot)), L.rrectPts(-w, -36, 2 * w, 72, 6, 6));
    K.fill(ctx, pts, C.card);
    if (w > 10) {
      const c = M.ap(M.chain(T, M.tr(x, y), M.rot(rot)), [0, 0]);
      // the ace of hearts
      const hs = (w / 26) * 0.8;
      const heart = [];
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        heart.push([c[0] + 16 * Math.sin(t) ** 3 * hs, c[1] - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.8]);
      }
      K.fill(ctx, heart, C.cardRed);
    }
    L.inkPath(ctx, pts, { closed: true, width: 4, seed, boil: B, smooth: false, wobble: 0.3, taper: 0 });
    void back;
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [170, -350],
    headScale: 1.14,
    spine: [0, -270],
    bodyC: [-10, -240],
    bodyR: 220,
    front: { atN: [124, -196], atF: [102, -204], l1: 92, l2: 86, r1: 26, rj: 19, r2: 16, paw: [28, 14] },
    hind: { atN: [-146, -206], atF: [-124, -214], l1: 108, l2: 82, r1: 40, rj: 19, r2: 16, paw: [28, 14] },
    feet: { fn: 136, ff: 112, hn: -140, hf: -118 },
    stride: 60,
    sock: C.black,
    pawFill: () => C.black,
    lie: 140,
    tail: { base: [-196, -250], len: 270, lift: -0.55, curl: -1.05, rise: 0, w0: 60, w1: 52, bushy: true, fill: C.fur, deep: C.furDeep, ink: 6.5, tip: C.white, tipLen: 0.26 },
    ears: {
      n: { at: [180, -424], flop: 0.12, fill: C.black, deep: P.ink, innerFill: C.white, pts: [[150, -414], [164, -500], [184, -548], [214, -498], [226, -424]], inner: [[166, -424], [176, -490], [188, -520], [206, -488], [212, -432]] },
      f: { at: [230, -430], flop: 0.1, fill: C.black, deep: P.ink, innerFill: C.white, pts: [[214, -424], [232, -504], [252, -544], [274, -494], [270, -420]], inner: null },
    },
    tufts: false,
    face: {
      eye: { x: 258, y: -390, r: 17, style: 'iris', iris: '#E0A020', slit: true, lid: 0.48, lidColor: C.fur },
      nose: { x: 392, y: -350, rx: 14, ry: 11 },
      mouth: [[384, -336], [346, -326], [304, -316]],
      whiskers: [364, -346, 90],
      blush: null,
      tongue: 30,
      fangs: 0.9,
    },
    hooks: {
      body: markings,
      bodyAfter: vest,
      head(ctx, R, B) {
        // the ace tucked behind the near ear
        if (!R.pose.fx || !R.pose.fx.noEarCard) card(ctx, R.Mh, 150, -430, -0.5, 0, B, sd('earCard'));
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx || !fx.item) return;
        const mouth = M.ap(R.Mh, [380, -324]);
        if (fx.item === 'cardMouth') card(ctx, M.I, mouth[0] + 16, mouth[1] + 18, 0.3, 0, B, sd('cardM'));
        if (fx.item === 'cardAir') card(ctx, M.I, mouth[0] + 20, mouth[1] - fx.h, fx.spin * 3, fx.spin, B, sd('cardA'));
        if (fx.item === 'coinAir') {
          K.fx.coin(ctx, mouth[0] + 20, mouth[1] - fx.h, 26, fx.spin, B, sd('coinA'));
          if (fx.star) {
            K.fx.star(ctx, mouth[0] + 70, mouth[1] - fx.h - 40, 30 * fx.star, B, sd('s1'), '#FFF1C4');
            K.fx.star(ctx, mouth[0] - 30, mouth[1] - fx.h - 10, 20 * fx.star, B, sd('s2'), '#FFF1C4');
          }
        }
        if (fx.item === 'coinMouth') {
          K.fx.coin(ctx, mouth[0] + 10, mouth[1] + 12, 24, 0.1, B, sd('coinM'));
          if (fx.star) K.fx.star(ctx, mouth[0] + 56, mouth[1] - 30, 24 * fx.star, B, sd('s3'), '#FFF1C4');
        }
      },
    },
    poses: {
      // the card from his teeth: toss, spin, flash into a coin, catch, wink
      work(d, n, P0) {
        const T = [
          { head: 0.04, item: 'cardMouth' },
          { head: -0.3, item: 'cardAir', h: 110, spin: 0.2 },
          { head: -0.36, item: 'cardAir', h: 190, spin: 0.45 },
          { head: -0.36, item: 'coinAir', h: 200, spin: 0.1, star: 1.2, eye: 'happy' },
          { head: -0.3, item: 'coinAir', h: 110, spin: 0.35 },
          { head: -0.2, item: 'coinMouth' },
          { head: -0.1, item: 'coinMouth', star: 1, eye: 'closed' },
          { head: -0.06, item: 'coinMouth', mouth: 0 },
        ][d];
        return { head: T.head, eyeMode: T.eye || 'open', tail: d % 2 ? 0.25 : -0.15, legs: P0.idle(0, 12).legs, fx: { item: T.item, h: T.h, spin: T.spin, star: T.star } };
      },
    },
  });
})();
