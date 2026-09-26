// pets/11-mouse.js : Мышь-воришка (common, token). Biped kit.
// A light grey mouse with a head as big as its body, huge round ears (the near one torn), a sly
// heavy-lidded eye, a ragged hooded cape over the shoulders, a rope belt, and a brass camp token on a
// chain in its hand. Work: sniffs, snatches the token, holds it up gleaming, pockets it.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'mouse';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9C958D',
    furDeep: '#655E58',
    furLit: '#C3BCB3',
    chest: '#DCCFBE',
    skin: '#EFA9A1',
    skinDeep: '#C6776F',
    claw: '#F6D3CC',
    clawDeep: '#C6776F',
    eye: '#140E0C',
    cloak: '#5B4535',
    cloakDeep: '#35271D',
    cloakLit: '#7A604B',
    rope: '#B79A68',
    ropeDeep: '#7B6440',
    brass: '#D2A546',
    brassDeep: '#86621F',
  };

  const SIL = [
    [-10, -24, 0],
    [-90, -36, 0],
    [-136, -92, 0],
    [-150, -172, 0],
    [-140, -250, 0.1],
    [-112, -312, 0.45],
    [-100, -372, 1],
    [-82, -452, 1],
    [-32, -518, 1],
    [40, -546, 1],
    [112, -532, 1],
    [166, -498, 1],
    [206, -462, 1],
    [250, -441, 1],
    [292, -428, 1],
    [316, -418, 1],
    [304, -398, 1],
    [260, -392, 1],
    [202, -382, 1],
    [150, -354, 0.8],
    [126, -300, 0.3],
    [130, -222, 0],
    [122, -132, 0],
    [94, -60, 0],
    [48, -30, 0],
  ];

  // a round ear; the near one has a torn V out of its rim
  function earPts(cx, cy, rx, ry, rot, torn) {
    const pts = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let r = 1;
      if (torn) {
        const da = Math.atan2(Math.sin(a - 5.35), Math.cos(a - 5.35));
        if (Math.abs(da) < 0.26) r = 1 - 0.28 * (1 - Math.abs(da) / 0.26);
      }
      const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return pts;
  }

  function cape(ctx, R, B) {
    const T = R.Mb;
    const pts = K.smooth(
      [
        [104, -318], [62, -354], [-10, -372], [-76, -366], [-128, -340], [-166, -282], [-180, -206],
        [-164, -150], [-146, -176], [-126, -144], [-104, -172], [-82, -148], [-62, -180],
        [-34, -232], [6, -276], [58, -300],
      ],
      5
    );
    const cp = M.all(T, pts);
    K.form(ctx, cp, {
      fill: C.cloak,
      deep: C.cloakDeep,
      width: 7,
      seed: sd('cape'),
      boil: B,
      spacing: 9,
      hatchAlpha: 0.7,
      after(c2) {
        // folds of the hood rolled round the neck, and two long folds down the back
        K.line(c2, M.all(T, [[-112, -344], [-60, -350], [0, -344], [52, -324]]), { width: 4, color: C.cloakDeep, seed: sd('fold1'), boil: B });
        K.line(c2, M.all(T, [[-96, -330], [-120, -260], [-128, -190]]), { width: 3.6, color: C.cloakDeep, seed: sd('fold2'), boil: B });
        K.line(c2, M.all(T, [[-50, -320], [-70, -250], [-90, -186]]), { width: 3.4, color: C.cloakDeep, seed: sd('fold3'), boil: B });
        K.line(c2, M.all(T, [[20, -354], [-40, -358]]), { width: 7, color: C.cloakLit, alpha: 0.9, seed: sd('capeHl'), boil: B, taper: [10, 10] });
        // a patch sewn on with big stitches
        const patch = M.all(T, [[-150, -250], [-112, -256], [-108, -218], [-146, -212]]);
        K.fill(c2, patch, '#7A6450');
        L.inkPath(c2, patch, { closed: true, width: 3.2, seed: sd('patch'), boil: B, smooth: false, wobble: 0.5, taper: 0 });
        for (let k = 0; k < 4; k++) K.line(c2, M.all(T, [[-150 + k * 11, -262], [-146 + k * 11, -246]]), { width: 2.4, seed: sd('st', k), boil: B, smooth: false, taper: 0 });
      },
    });
    K.plate(ctx, M.all(T, L.ellipsePts(104, -318, 13, 13, 16)), { seed: sd('clasp'), boil: B, fill: C.brass, deep: C.brassDeep });
  }

  function belt(ctx, R, B, bodyPts) {
    const line = [];
    for (let x = -170; x <= 170; x += 20) line.push([x, -112 + 10 * (1 - (x / 150) ** 2)]);
    K.band(ctx, M.all(R.Mb, line), 15, { fill: C.rope, deep: C.ropeDeep, seed: sd('rope'), boil: B, clip: bodyPts, width: 4 });
    // twists of the rope
    K.clip(ctx, bodyPts, () => {
      for (let x = -140; x <= 130; x += 18) {
        const y = -112 + 10 * (1 - (x / 150) ** 2);
        K.line(ctx, M.all(R.Mb, [[x - 5, y - 7], [x + 5, y + 7]]), { width: 2.4, color: C.ropeDeep, seed: sd('tw', x), boil: B, smooth: false, taper: 0 });
      }
    });
    const knot = M.all(R.Mb, K.smooth([[92, -118], [110, -122], [116, -104], [100, -94]], 4));
    K.form(ctx, knot, { fill: C.rope, deep: C.ropeDeep, width: 4, seed: sd('knot'), boil: B, shade: 0.6, spacing: 5, hatchW: 1.8 });
    for (const [x0, y0, x1, y1] of [[104, -100, 98, -58], [110, -100, 122, -62]]) {
      const end = M.all(R.Mb, K.ribbonPts([[x0, y0], [(x0 + x1) / 2 + 3, (y0 + y1) / 2], [x1, y1]], 10, 7));
      K.form(ctx, end, { fill: C.rope, width: 3.6, seed: sd('ropeEnd', x1), boil: B, shade: 0 });
    }
  }

  const token = (ctx, x, y, r, B, turn = 0) => K.fx.token(ctx, x, y, r, turn, B, sd('token'));

  function hand(ctx, R, B, PT) {
    const pose = R.pose;
    if (!pose.held) return;
    const h = M.ap(PT, [36, 4]);
    if (pose.fx && pose.fx.up) {
      token(ctx, h[0] + 6, h[1] - 18, 30, B, 0);
      if (pose.fx.star) K.fx.star(ctx, h[0] + 40, h[1] - 52, 26 * pose.fx.star, B, sd('glint'), '#FFF6D2');
      return;
    }
    const sway = pose.fx && pose.fx.sway != null ? pose.fx.sway : 0;
    const end = [h[0] + sway * 20, h[1] + 58];
    K.chain(ctx, [h, [h[0] + sway * 8, h[1] + 30], end], 13, { width: 5.5, color: C.brass, seed: sd('chain'), boil: B });
    token(ctx, end[0], end[1] + 26, 26, B, sway * 0.3);
  }

  const base = K.kits.biped;
  base.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [90, -340],
    bodyC: [0, -200],
    bodyR: 200,
    legh: 40,
    shoulders: { n: [70, -285], f: [40, -300] },
    hips: { n: [30, -44], f: [-30, -48] },
    arm: {
      len: 60,
      r: 22,
      paw: 'hand',
      pawScale: 1.05,
      rest: { n: { a1: 1.05, a2: 0.35 }, f: { a1: 0.95, a2: 0.2 } },
      up: { n: { a1: -0.9, a2: -1.3 }, f: { a1: -1.55, a2: -1.9 } },
      windup: [-2.1, -2.5],
    },
    leg: { r: 21 },
    foot: { len: 46, h: 15, toes: 3, rest: { n: { x: 40 }, f: { x: -30 } }, stride: 54 },
    tail: { base: [-128, -70], len: 290, lift: -0.35, curl: -1.7, rise: 0, w0: 17, w1: 5 },
    chest: [72, -170, 66, 118, -0.1],
    ears: {
      n: { at: [-20, -520], flop: 0.12, fill: '#A69F97', deep: C.furDeep, innerFill: C.skin, pts: earPts(-22, -598, 74, 84, -0.25, true), inner: earPts(-18, -594, 48, 58, -0.25, false) },
      f: { at: [80, -530], flop: 0.1, fill: '#A69F97', deep: C.furDeep, innerFill: C.skin, pts: earPts(88, -606, 64, 74, 0.15, false), inner: earPts(90, -604, 40, 50, 0.15, false) },
    },
    tuftMaxX: 60,
    tuftBelow: -200,
    face: {
      eye: { x: 176, y: -468, r: 19, lid: 0.58, lidColor: '#A69F97' },
      nose: { x: 318, y: -415, rx: 15, ry: 12 },
      mouth: [[298, -398], [278, -392], [256, -392]],
      whiskers: [294, -410, 108],
      blush: [214, -440],
    },
    hooks: { front: cape, bodyAfter: belt, hand },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { sway: Math.sin((Math.PI * 2 * d) / n) } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { sway: Math.cos((Math.PI * 2 * d) / n) } });
      },
      // sniff, snatch the token, hold it up gleaming, pocket it
      work(d) {
        const T = [
          { head: -0.14, nose: 1, lean: 0.02, a: [1.05, 0.35], held: 0 },
          { head: -0.1, nose: 0.4, lean: 0.06, a: [1.0, 0.4], held: 0 },
          { head: 0.08, nose: 0, lean: 0.3, x: 40, a: [0.55, 0.95], held: 0 },
          { head: 0.02, nose: 0, lean: 0.1, x: 20, a: [0.25, -0.2], held: 1, sway: 0.6 },
          { head: -0.1, lean: -0.05, a: [-1.0, -1.35], held: 1, up: 1, star: 0.7, mouth: 0.6 },
          { head: -0.12, lean: -0.06, a: [-1.05, -1.4], held: 1, up: 1, star: 1.1, mouth: 0.6 },
          { head: 0.06, lean: 0.04, a: [1.55, 1.3], held: 1, sway: -0.4 },
          { head: 0.04, lean: 0.02, a: [1.6, 1.35], held: 0, mouth: 0.4 },
        ][d];
        return {
          x: T.x || 0,
          head: T.head,
          nose: T.nose || 0,
          lean: T.lean,
          mouth: T.mouth || 0,
          held: T.held,
          armN: { a1: T.a[0], a2: T.a[1] },
          fx: { up: T.up, star: T.star, sway: T.sway || 0 },
        };
      },
    },
  });
})();
