// pets/12-badger.js : Барсук-проходчик (rare, loot). Biped kit.
// A stocky grey badger: white face with the black band from the snout through the eye to the ear,
// black forelegs and legs, long pale digging claws. An orange hard hat with goggles on it and a
// dusty canvas work vest with pockets. Work: digs, pulls a blue ore crystal out and lifts it high.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const TAU = Math.PI * 2;
  const ID = 'badger';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8F8A84',
    furDeep: '#5A5550',
    furLit: '#B9B3AB',
    chest: '#3A3431',
    black: '#2B2522',
    white: '#EEE9E0',
    skin: '#4A403B',
    skinDeep: '#2B2522',
    palm: '#4A403B',
    palmDeep: '#231D1A',
    sole: '#4A403B',
    soleDeep: '#231D1A',
    claw: '#EDE2CB',
    clawDeep: '#AD9C7C',
    nose: '#2E2724',
    noseDeep: '#171210',
    eye: '#1A110E',
    hat: '#E57B2E',
    hatDeep: '#A5501B',
    hatLit: '#F8BE84',
    vest: '#8E7C55',
    vestDeep: '#5B4E33',
    vestLit: '#B3A078',
    brass: '#C39A55',
    brassDeep: '#7E5E2E',
    ore: '#63B6D8',
    oreDeep: '#2B6F92',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
  };

  const SIL = [
    [-20, -24, 0],
    [-122, -36, 0],
    [-192, -98, 0],
    [-216, -198, 0],
    [-212, -300, 0.05],
    [-188, -382, 0.3],
    [-142, -442, 0.7],
    [-62, -480, 1],
    [30, -490, 1],
    [112, -472, 1],
    [182, -442, 1],
    [244, -414, 1],
    [304, -392, 1],
    [346, -382, 1],
    [360, -366, 1],
    [344, -350, 1],
    [296, -344, 1],
    [236, -336, 1],
    [198, -318, 0.8],
    [192, -270, 0.3],
    [202, -200, 0],
    [192, -118, 0],
    [152, -56, 0],
    [80, -28, 0],
  ];

  // the white face and the black band from the snout through the eye to the ear (head space)
  function markings(ctx, R) {
    const H = R.Mh;
    K.fill(ctx, M.all(H, K.smooth([[0, -520], [150, -500], [300, -420], [380, -380], [380, -330], [230, -318], [120, -330], [40, -380], [-10, -440]], 5)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[362, -384], [300, -408], [230, -440], [150, -470], [60, -486], [-30, -470], [-60, -430], [10, -432], [90, -420], [170, -404], [250, -380], [330, -360]], 5)), C.black);
    // the dark throat and chest
    K.fill(ctx, M.all(R.Mb, K.smooth([[90, -340], [200, -320], [222, -230], [206, -140], [120, -150], [70, -250]], 5)), C.black);
  }

  // an open canvas vest: the back panel and the shoulder, short, the black chest and the grey belly
  // show at the front; one pocket with a flap, dust
  function vest(ctx, R, B, bodyPts) {
    const T = R.Mb;
    const v = M.all(T, K.smooth([[-240, -330], [-150, -352], [-40, -352], [40, -330], [60, -250], [40, -190], [30, -150], [-240, -140]], 5));
    K.clip(ctx, bodyPts, () => {
      K.form(ctx, v, {
        fill: C.vest,
        deep: C.vestDeep,
        c: R.center,
        width: 6,
        seed: sd('vest'),
        boil: B,
        spacing: 9,
        hatchAlpha: 0.7,
        after(c2) {
          L.stipple(c2, v, { spacing: 13, r: [1.4, 2.8], color: C.vestDeep, alpha: 0.6, seed: sd('dust'), boil: B });
          K.line(c2, M.all(T, [[-120, -350], [-116, -250], [-120, -146]]), { width: 3.4, color: C.vestDeep, seed: sd('seam'), boil: B });
          const x = -40, y = -236;
          const pk = M.all(T, L.rrectPts(x - 30, y - 24, 60, 52, 8, 6));
          K.form(c2, pk, { fill: C.vestLit, deep: C.vestDeep, width: 4.5, seed: sd('pocket'), boil: B, shade: 0.6, spacing: 7, hatchW: 2 });
          const fl = M.all(T, [[x - 32, y - 26], [x + 32, y - 26], [x + 27, y - 7], [x - 27, y - 7]]);
          K.fill(c2, fl, C.vest);
          L.inkPath(c2, fl, { closed: true, width: 4, seed: sd('flap'), boil: B, smooth: false, wobble: 0.4, taper: 0 });
          K.plate(c2, M.all(T, L.ellipsePts(x, y - 14, 5, 5, 10)), { width: 2.4, seed: sd('btn'), boil: B, shade: 0 });
          // a hem stitched along the open front
          K.line(c2, M.all(T, K.curve([[40, -330], [60, -250], [40, -190], [30, -150]], 8)), { width: 3, color: C.vestLit, alpha: 0.9, seed: sd('hem'), boil: B });
        },
      });
    });
  }

  function hat(ctx, R, B) {
    const Hm = M.mul(R.Mh, M.about(R.pose.hat, 30, -460));
    K.helmet(ctx, Hm, { cx: 26, cy: -462, rx: 150, ry: 108, col: { hat: C.hat, hatDeep: C.hatDeep, hatLit: C.hatLit }, ridge: true, seed: sd('hat'), boil: B });
    K.goggles(ctx, Hm, 70, -512, 24, { seed: sd('goggles'), boil: B });
  }

  function ore(ctx, x, y, s, B, glow) {
    const pts = [[x - 26 * s, y + 18 * s], [x - 30 * s, y - 8 * s], [x - 10 * s, y - 34 * s], [x + 16 * s, y - 30 * s], [x + 30 * s, y - 4 * s], [x + 18 * s, y + 22 * s]];
    if (glow) {
      const g = ctx.createRadialGradient(x, y, 4, x, y, 90 * s);
      g.addColorStop(0, L.rgba(C.ore, 0.5 * glow));
      g.addColorStop(1, L.rgba(C.ore, 0));
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 90 * s, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    K.form(ctx, pts, { fill: C.ore, deep: C.oreDeep, width: 5, seed: sd('ore'), boil: B, shade: 1, spacing: 6, hatchW: 2.2 });
    K.line(ctx, [[x - 10 * s, y - 34 * s], [x - 2 * s, y - 2 * s], [x + 18 * s, y + 22 * s]], { width: 3, color: C.oreDeep, seed: sd('oreF'), boil: B, smooth: false, taper: 0 });
    K.fill(ctx, [[x - 20 * s, y - 6 * s], [x - 8 * s, y - 26 * s], [x - 4 * s, y - 10 * s]], P.white, 0.8);
  }

  K.kits.biped.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    sil: SIL,
    neck: [110, -390],
    bodyC: [0, -270],
    legh: 46,
    shoulders: { n: [120, -285], f: [90, -305] },
    hips: { n: [44, -62], f: [-40, -66] },
    arm: {
      len: 52,
      r: 30,
      paw: 'spade',
      pawScale: 1.25,
      claw: 40,
      sleeve: (far) => ({ fill: K.far(C.black, far) }),
      rest: { n: { a1: 0.8, a2: 0.15 }, f: { a1: 0.58, a2: 0.05 } },
      up: { n: { a1: -0.5, a2: -0.9 }, f: { a1: -1.9, a2: -2.1 } },
    },
    leg: { r: 31, fill: () => C.black },
    foot: { len: 50, rest: { n: { x: 54 }, f: { x: -40 } } },
    tail: { base: [-196, -96], len: 70, lift: -0.55, curl: 0.2, rise: 0, w0: 46, w1: 26, bushy: true, fill: C.fur, deep: C.furDeep, ink: 6 },
    face: {
      eye: { x: 192, y: -428, r: 15, style: 'iris', iris: '#6B4424' },
      nose: { x: 358, y: -370, rx: 22, ry: 17 },
      mouth: [[322, -350], [300, -344], [276, -342]],
      whiskers: null,
      blush: null,
    },
    ears: {
      n: { at: [-40, -470], flop: 0.08, fill: C.black, deep: P.ink, innerFill: C.white, pts: K.smooth([[-90, -470], [-78, -522], [-40, -532], [-10, -500], [-20, -462]], 5), inner: K.smooth([[-76, -478], [-66, -512], [-42, -516], [-26, -492], [-34, -470]], 5) },
      f: { at: [10, -480], flop: 0.06, fill: C.black, deep: P.ink, innerFill: C.white, pts: K.smooth([[-30, -486], [-20, -534], [14, -542], [40, -512], [30, -478]], 5), inner: null },
    },
    tuftBelow: -150,
    hooks: {
      body: markings,
      bodyAfter: vest,
      head: hat,
      hand(ctx, R, B, PT) {
        const fx = R.pose.fx;
        if (!fx || !fx.ore) return;
        const h = M.ap(PT, [60, -8]);
        ore(ctx, h[0], h[1] - 20, 1.2, B, fx.ore);
        if (fx.star) K.fx.star(ctx, h[0] + 46, h[1] - 70, 26 * fx.star, B, sd('glint'), '#E9FBFF');
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx || !fx.dig) return;
        const H0 = M.ap(R.Mr, [330, 0]);
        K.fx.heap(ctx, H0[0], B, sd('heap'), C);
        if (fx.dig === 2) K.fx.clods(ctx, [H0[0] - 70, K.GROUND - 50], fx.d, 8, [1, 3], B, sd('clod'), C);
      },
    },
    poses: {
      // two fast scoops, the crystal comes up, lifted high, gleaming
      work(d) {
        const S = [
          { a1: -0.2, a2: 0.3 },
          { a1: 1.2, a2: 1.6 },
          { a1: -0.1, a2: 0.35 },
          { a1: 1.3, a2: 1.7 },
        ];
        if (d < 4)
          return {
            x: -160,
            y: d % 2 ? -5 : 0,
            lean: 0.48,
            sq: 0.95,
            legh: 36,
            armN: S[d],
            armF: S[(d + 1) % 4],
            fx: { dig: 2, d },
          };
        const T = [
          { lean: 0.3, x: -110, a: [0.6, 0.6], ore: 0.3, star: 0 },
          { lean: 0.05, x: -40, a: [-0.4, -0.7], ore: 0.8, star: 0.6, mouth: 0.7 },
          { lean: -0.06, x: -20, a: [-1.0, -1.35], ore: 1, star: 1.1, mouth: 1, eye: 'happy' },
          { lean: -0.04, x: -20, a: [-0.95, -1.3], ore: 1, star: 0.7, mouth: 1, eye: 'happy' },
        ][d - 4];
        return {
          x: T.x,
          lean: T.lean,
          mouth: T.mouth || 0,
          eyeMode: T.eye || 'open',
          armN: { a1: T.a[0], a2: T.a[1] },
          fx: { dig: 1, d, ore: T.ore, star: T.star },
        };
      },
    },
  });
})();
