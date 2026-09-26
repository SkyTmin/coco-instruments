// pets/25-wolf.js : Волк-вожак (legendary, dmg + rate). Quad kit.
// A big grey pack leader: a thick ruff round the neck, a scarred muzzle, a torn ear, a pale belly
// and a darker saddle, yellow eyes. A heavy iron collar with rivets, a broken chain dangling from
// it and a tin number tag. Bites. Work: howls (the sound goes out in rings), lowers the head,
// charges, skids to a stop with the fur up.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'wolf';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8E8C87',
    furDeep: '#565450',
    furLit: '#BEBBB5',
    chest: '#DCD5C7',
    saddle: '#63615C',
    skin: '#D2958C',
    skinDeep: '#A0605A',
    nose: '#2A2522',
    noseDeep: '#141010',
    eye: '#1A110E',
    mouth: '#4E1E1C',
    tongue: '#E08880',
    scar: '#E3A69A',
    iron: '#5E6166',
    ironDeep: '#34373B',
    ironLit: '#8F949A',
    tin: '#C7C9C4',
  };

  const SIL = [
    [-196, -180, 0],
    [-232, -236, 0],
    [-224, -292, 0],
    [-168, -318, 0],
    [-60, -334, 0],
    [30, -352, 0.1],
    [70, -392, 0.3],
    [110, -432, 0.7],
    [140, -452, 1],
    [176, -470, 1],
    [238, -476, 1],
    [284, -450, 1],
    [340, -430, 1],
    [398, -414, 1],
    [414, -398, 1],
    [400, -380, 1],
    [346, -372, 1],
    [298, -358, 1],
    [254, -336, 0.9],
    [236, -300, 0.6],
    [228, -250, 0.2],
    [206, -210, 0],
    [180, -190, 0],
    [100, -178, 0],
    [0, -184, 0],
    [-110, -190, 0],
  ];

  function markings(ctx, R) {
    const T = R.Mb, H = R.Mh;
    K.fill(ctx, M.all(T, K.smooth([[-236, -250], [-190, -320], [-60, -342], [60, -356], [90, -320], [-40, -300], [-170, -284]], 5)), C.saddle);
    K.fill(ctx, M.all(T, K.smooth([[160, -310], [214, -280], [206, -200], [170, -188], [140, -250]], 5)), C.chest);
    K.fill(ctx, M.all(H, K.smooth([[262, -392], [330, -386], [410, -384], [404, -366], [340, -364], [290, -350], [248, -350]], 5)), C.chest);
  }

  function face(ctx, R, B) {
    const H = R.Mh;
    // brow ridge and the scar across the muzzle
    K.line(ctx, M.all(H, [[236, -438], [270, -428], [300, -414]]), { width: 5, color: C.furDeep, seed: sd('brow'), boil: B });
    const s = M.all(H, [[318, -426], [334, -402], [346, -378]]);
    K.line(ctx, s, { width: 10, color: P.ink, seed: sd('scar'), boil: B, taper: [5, 6] });
    K.line(ctx, s, { width: 5, color: C.scar, seed: sd('scar'), boil: B, taper: [5, 6] });
  }

  // the mane: strands of fur down the thick neck (the outline itself is tufted)
  function mane(ctx, R, B) {
    const T = R.Mf;
    for (let k = 0; k < 7; k++) {
      const x = 60 + k * 26, y = -392 + k * 18;
      K.line(ctx, M.all(T, [[x, y], [x + 16, y + 40], [x + 10, y + 70]]), { width: 3.4, color: C.furDeep, alpha: 0.85, seed: sd('strand', k), boil: B, taper: [3, 8] });
    }
  }

  function collar(ctx, R, B) {
    const T = R.Mf;
    const line = M.all(T, K.curve([[110, -392], [170, -356], [226, -318]], 8));
    K.band(ctx, line, 30, { fill: C.iron, deep: C.ironDeep, seed: sd('collar'), boil: B, width: 5.5 });
    for (let k = 0; k < 4; k++) {
      const p = line[Math.floor(((k + 0.5) / 4) * (line.length - 1))];
      K.fill(ctx, L.ellipsePts(p[0], p[1], 5, 5, 10), C.ironLit);
      L.inkPath(ctx, L.ellipsePts(p[0], p[1], 5, 5, 10), { closed: true, width: 2.2, seed: sd('rivet', k), boil: B, taper: 0 });
    }
    // the broken chain: three links and an open one
    const ring = M.ap(T, [212, -318]);
    const sw = R.pose.fx && R.pose.fx.swing != null ? R.pose.fx.swing : 0;
    K.chain(ctx, [ring, [ring[0] + 10 + 14 * sw, ring[1] + 44], [ring[0] + 6 + 26 * sw, ring[1] + 84]], 18, { width: 7, color: C.ironLit, seed: sd('chain'), boil: B });
    const end = [ring[0] + 6 + 26 * sw, ring[1] + 96];
    L.inkPath(ctx, L.ellipsePts(end[0], end[1], 9, 14, 16, 0.3).slice(3, 15), { width: 7, color: P.ink, seed: sd('open'), boil: B, taper: [2, 2] });
    L.inkPath(ctx, L.ellipsePts(end[0], end[1], 9, 14, 16, 0.3).slice(3, 15), { width: 3.2, color: C.ironLit, seed: sd('open'), boil: B, taper: [2, 2] });
    // the tin number tag
    const tagC = M.ap(T, [176, -330]);
    const tag = L.rrectPts(tagC[0] - 18, tagC[1] + 10, 36, 30, 5, 5);
    K.plate(ctx, tag, { fill: C.tin, deep: '#8C8E88', width: 4, seed: sd('tag'), boil: B });
    K.line(ctx, [[tagC[0] - 10, tagC[1] + 20], [tagC[0] - 2, tagC[1] + 32]], { width: 3, seed: sd('n1'), boil: B, smooth: false, taper: 0 });
    K.line(ctx, [[tagC[0] + 4, tagC[1] + 20], [tagC[0] + 12, tagC[1] + 20], [tagC[0] + 6, tagC[1] + 32]], { width: 3, seed: sd('n2'), boil: B, smooth: false, taper: 0 });
  }

  function howl(ctx, R, B) {
    const fx = R.pose.fx;
    if (!fx) return;
    if (fx.howl) {
      const m = M.ap(R.Mh, [400, -380]);
      for (let k = 0; k < 3; k++) {
        const r = 40 + k * 44 + 30 * fx.howl;
        const arc = [];
        for (let i = 0; i <= 10; i++) {
          const a = -1.4 + (i / 10) * 1.1;
          arc.push([m[0] + Math.cos(a) * r, m[1] + Math.sin(a) * r]);
        }
        K.line(ctx, arc, { width: 6 - k, alpha: 1 - k * 0.25, color: P.annBlue, seed: sd('howl', k), boil: B, taper: [6, 6] });
      }
    }
    if (fx.speed) K.fx.speed(ctx, M.ap(R.Mr, [-260, -260]), 200, fx.speed, B, sd('speed'));
    if (fx.dust) K.fx.dust(ctx, M.ap(R.Mr, [180, 0]), 70, fx.dust, B, sd('dust'));
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [170, -390],
    headScale: 1.1,
    spine: [0, -300],
    bodyC: [-20, -250],
    bodyR: 250,
    front: { atN: [130, -210], atF: [106, -218], l1: 100, l2: 92, r1: 38, rj: 27, r2: 23, paw: [38, 18] },
    hind: { atN: [-160, -220], atF: [-136, -228], l1: 116, l2: 92, r1: 56, rj: 27, r2: 22, paw: [38, 18] },
    feet: { fn: 144, ff: 118, hn: -150, hf: -126 },
    stride: 66,
    lift: 42,
    lie: 150,
    tail: { base: [-226, -276], len: 250, lift: -0.95, curl: -0.6, rise: 0, w0: 56, w1: 42, bushy: true, fill: C.fur, deep: C.furDeep, ink: 6.5, tip: C.saddle, tipLen: 0.2 },
    ears: {
      n: { at: [184, -464], flop: 0.12, fill: C.fur, deep: C.furDeep, innerFill: C.saddle, pts: [[156, -456], [168, -530], [186, -566], [196, -540], [208, -548], [228, -470]], inner: [[172, -462], [180, -520], [190, -540], [212, -474]] },
      f: { at: [236, -470], flop: 0.1, fill: C.fur, deep: C.furDeep, innerFill: C.saddle, pts: [[220, -464], [236, -540], [256, -574], [278, -526], [276, -462]], inner: null },
    },
    tuftRange: [3, 9],
    face: {
      eye: { x: 262, y: -420, r: 17, style: 'iris', iris: '#E2B321', lid: 0.34, lidColor: C.fur },
      nose: { x: 408, y: -398, rx: 18, ry: 13 },
      mouth: [[400, -378], [354, -370], [304, -356]],
      whiskers: null,
      blush: null,
      tongue: 34,
      fangs: 1.2,
    },
    hooks: { body: markings, face, front(ctx, R, B) { mane(ctx, R, B); collar(ctx, R, B); }, fx: howl },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { swing: Math.sin((Math.PI * 2 * d) / n) * 0.3 } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { swing: Math.cos((Math.PI * 2 * d) / n) } });
      },
      // the howl, head down, the charge, the skid
      work(d, n, P0) {
        const st = P0.idle(0, 12).legs;
        const run = P0.walk(d % 8, 8).legs;
        const T = [
          { head: -0.55, hy: -10, mouth: 0.9, eye: 'closed', howl: 0.2, legs: st },
          { head: -0.6, hy: -12, mouth: 1, eye: 'closed', howl: 1, legs: st },
          { head: 0.14, eye: 'angry', mouth: -0.6, legs: st },
          { bow: 0.16, sq: 0.9, eye: 'angry', mouth: -1, legs: st, x: -20 },
          { x: 50, bow: -0.06, eye: 'angry', speed: 1, legs: run },
          { x: 100, bow: -0.04, eye: 'angry', speed: 1, legs: run },
          { x: 110, bow: 0.14, eye: 'angry', dust: 0.4, legs: st, lean: -0.08 },
          { x: 100, bow: 0, head: -0.08, dust: 0.8, legs: st },
        ][d];
        return { x: T.x || 0, lean: T.lean || 0, bow: T.bow || 0, sq: T.sq || 1, head: T.head || 0, hy: T.hy || 0, mouth: T.mouth || 0, tongue: T.howl ? 0 : 1, eyeMode: T.eye || 'open', ear: d < 2 ? -1 : 0, legs: T.legs, fx: { howl: T.howl, speed: T.speed || 0, dust: T.dust || 0, swing: d % 2 ? 0.5 : -0.5 } };
      },
    },
  });
})();
