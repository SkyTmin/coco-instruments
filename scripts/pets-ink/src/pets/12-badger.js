// pets/12-badger.js : Барсук-проходчик (rare, loot). Front kit, stands.
// A stocky grey badger with the badger's face: a white blaze down the middle, black bands over the
// eyes to the ears, white cheeks; small round ears rimmed white. An orange hard hat with goggles
// on it, an open canvas work vest with patch pockets and a pencil, black arms with long ivory claws.
// Work: swings a small pick into the rock in front of him twice, the rock cracks, a crystal pops
// out and he holds it up to the lamp.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'badger';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#908B85',
    furDeep: '#58534E',
    furLit: '#BBB5AD',
    belly: '#6E6964',
    black: '#2E2826',
    eyeLine: '#F1ECE3',
    white: '#F1ECE3',
    muzzle: '#F1ECE3',
    skin: '#5A4E49',
    nose: '#2A2320',
    leg: '#2E2826',
    foot: '#3A3230',
    arm: '#2E2826',
    paw: '#3A3230',
    pad: '#6A5A55',
    claw: '#EFE4CC',
    blush: '#D98A8A',
    mouth: '#6E2A26',
    tongue: '#EE8F8A',
    hat: '#E57B2E',
    hatDeep: '#A5501B',
    hatLit: '#F8BE84',
    vest: '#8E7C55',
    vestDeep: '#5B4E33',
    vestLit: '#B3A078',
    brass: '#C39A55',
    brassDeep: '#7E5E2E',
    rock: '#8F857A',
    rockDeep: '#5E554C',
    gem: '#B478E6',
    gemDeep: '#6B3AA0',
    wood: '#9A6A3E',
  };

  // the badger's face: black bands from the nose over the eyes to the ears, white between and below
  function mask(c2, R, B) {
    const T = R.Mh;
    for (const s of [-1, 1]) {
      const band = [R.hl(s * 28, 44, 0.9), R.hl(s * 36, -20, 0.85), R.hl(s * 60, -98, 0.6), R.hl(s * 104, -140, 0.4), R.hl(s * 150, -110, 0.25), R.hl(s * 128, -40, 0.5), R.hl(s * 98, 30, 0.7), R.hl(s * 62, 60, 0.8)];
      K.fill(c2, M.all(T, K.smooth(band, 5)), C.black);
    }
    // the white blaze up the middle to the crown
    K.fill(c2, M.all(T, K.smooth([R.hl(-26, 60, 0.9), R.hl(-30, -40, 0.85), R.hl(-40, -140, 0.5), R.hl(0, -176, 0.3), R.hl(40, -140, 0.5), R.hl(30, -40, 0.85), R.hl(26, 60, 0.9)], 5)), C.white);
  }

  function vest(ctx, R, B, bodyPts) {
    const T = R.Mb;
    K.clip(ctx, bodyPts, () => {
      for (const s of [-1, 1]) {
        // each half of the open vest, a patch pocket with a flap
        const half = M.all(T, K.smooth([[s * 34, -356], [s * 150, -330], [s * 214, -250], [s * 222, -110], [s * 196, -40], [s * 70, -40], [s * 56, -180], [s * 38, -300]], 4));
        F().form(ctx, half, C.vest, B, sd('vest', s), {
          width: 6,
          off: 0.1,
          hatch: 0.6,
          inside(c2) {
            L.hatch(c2, half, { angle: 1.1, spacing: 9, width: 1.8, color: C.vestDeep, alpha: 0.35, density: 0.5, clip: true, seed: sd('canvas', s), boil: B });
            for (let i = 0; i < 9; i++) K.line(c2, M.all(T, [[s * (44 + i * 1.4), -290 + i * 28], [s * (46 + i * 1.4), -278 + i * 28]]), { width: 2.4, color: C.vestLit, alpha: 0.9, seed: sd('st', s, i), boil: B, smooth: false, taper: 0 });
          },
        });
        const pk = M.all(T, L.rrectPts(s > 0 ? 88 : -168, -170, 80, 78, 10, 6));
        F().form(ctx, pk, C.vest, B, sd('pocket', s), { width: 5, off: 0.1, hatch: 0.5 });
        const fl = M.all(T, K.smooth([[s > 0 ? 86 : -170, -172], [s > 0 ? 170 : -86, -172], [s > 0 ? 166 : -90, -140], [s > 0 ? 128 : -128, -130], [s > 0 ? 90 : -166, -140]], 4));
        F().form(ctx, fl, C.vestDeep, B, sd('flap', s), { width: 4.5, off: 0.1, hatch: 0.2, rim: false });
        F().form(ctx, M.all(T, L.ellipsePts(s > 0 ? 128 : -128, -138, 6, 6, 10)), C.brass, B, sd('btn', s), { width: 3, shine: 1, hatch: 0 });
      }
      // a pencil in the left breast pocket
      const pen = M.all(T, [[-120, -258], [-110, -318], [-100, -316], [-110, -256]]);
      K.fill(ctx, pen, '#E8B83E');
      K.fill(ctx, M.all(T, [[-110, -318], [-100, -316], [-104, -334]]), '#F3D8A8');
      L.inkPath(ctx, pen, { closed: true, width: 3, seed: sd('pen'), boil: B, smooth: false, taper: 0 });
      const bp = M.all(T, L.rrectPts(-156, -268, 62, 54, 8, 5));
      F().form(ctx, bp, C.vest, B, sd('bpocket'), { width: 4.5, off: 0.1, hatch: 0.4 });
    });
  }

  function hat(ctx, R, B) {
    F().helmet(ctx, R, B, { cy: -96, rx: 170, ry: 104, col: { hat: C.hat, hatDeep: C.hatDeep, hatLit: C.hatLit, brass: C.brass, brassDeep: C.brassDeep, glass: '#FFF6D2' }, lamp: null, tilt: -0.06 }, sd('hat'));
    F().goggles(ctx, R, B, { y: -150, w: 168, r: 30, brass: C.brass, strap: '#3A2A20' }, sd('goggles'));
  }

  function pick(ctx, end, a, B) {
    // a small pick held in the right paw, swung by the arm's angle
    const dir = [Math.sin(a), Math.cos(a)];
    const h0 = [end[0] - dir[0] * 10, end[1] - dir[1] * 10];
    const h1 = [end[0] + dir[0] * 120, end[1] + dir[1] * 120];
    K.line(ctx, [h0, h1], { width: 18, color: P.ink, seed: sd('handle'), boil: B, taper: 0, smooth: false });
    K.line(ctx, [h0, h1], { width: 11, color: C.wood, seed: sd('handle'), boil: B, taper: 0, smooth: false });
    const n = [-dir[1], dir[0]];
    const head = [
      [h1[0] + n[0] * 70, h1[1] + n[1] * 70 + 10],
      [h1[0] + n[0] * 20 + dir[0] * 16, h1[1] + n[1] * 20 + dir[1] * 16],
      [h1[0] - n[0] * 20 + dir[0] * 16, h1[1] - n[1] * 20 + dir[1] * 16],
      [h1[0] - n[0] * 70, h1[1] - n[1] * 70 + 10],
      [h1[0] - n[0] * 20 - dir[0] * 12, h1[1] - n[1] * 20 - dir[1] * 12],
      [h1[0] + n[0] * 20 - dir[0] * 12, h1[1] + n[1] * 20 - dir[1] * 12],
    ];
    F().form(ctx, head, '#8E949A', B, sd('pickhead'), { width: 5, off: 0.1, shine: 0.7, hatch: 0.4, smooth: false });
  }

  function rock(ctx, crack, B) {
    const g = K.GROUND, cx = K.CXF;
    const r = [[cx - 150, g + 4], [cx - 136, g - 70], [cx - 70, g - 118], [cx + 20, g - 124], [cx + 110, g - 96], [cx + 152, g - 30], [cx + 150, g + 4]];
    F().form(ctx, K.smooth(r, 3), C.rock, B, sd('rock'), { width: 7, off: 0.12, hatch: 0.8 });
    L.stipple(ctx, K.smooth(r, 3), { spacing: 14, r: [1.6, 3], color: C.rockDeep, alpha: 0.7, seed: sd('rockS'), boil: B });
    if (crack) {
      const c = [[cx - 10, g - 120], [cx + 8, g - 84], [cx - 12, g - 52], [cx + 6, g - 14]];
      K.line(ctx, c, { width: 12, color: crack > 1 ? '#F4E3FF' : C.rockDeep, seed: sd('crackG'), boil: B, smooth: false, taper: [3, 3] });
      K.line(ctx, c, { width: 4, seed: sd('crack'), boil: B, smooth: false, taper: [3, 3] });
    }
  }

  function gem(ctx, c, s, B) {
    const pts = [[c[0], c[1] - 50 * s], [c[0] + 28 * s, c[1] - 12 * s], [c[0] + 18 * s, c[1] + 30 * s], [c[0] - 18 * s, c[1] + 30 * s], [c[0] - 28 * s, c[1] - 12 * s]];
    F().form(ctx, pts, C.gem, B, sd('gem'), { width: 5, off: 0.14, shine: 1, hatch: 0.3, smooth: false });
    K.line(ctx, [[c[0], c[1] - 50 * s], [c[0] - 4 * s, c[1] + 30 * s]], { width: 2.6, color: '#F0DDFF', seed: sd('facet'), boil: B, smooth: false, taper: 0 });
  }

  const WORK = [
    { arm: { l: 0.2, r: 2.3 }, rock: 1, fx: { pick: 1 } },
    { arm: { l: 0.1, r: -0.3 }, sq: 0.94, rock: 1, fx: { pick: 1, hit: 1 } },
    { arm: { l: 0.2, r: 2.3 }, rock: 1, crack: 1, fx: { pick: 1 } },
    { arm: { l: 0.1, r: -0.3 }, sq: 0.94, rock: 1, crack: 2, fx: { pick: 1, hit: 1 } },
    { arm: { l: -0.6, r: -0.6 }, rock: 1, crack: 2, fx: { gem: 'rock' } },
    { arm: { l: -1.0, r: -1.0 }, y: -40, rock: 1, crack: 2, eye: 'happy', mouth: 0.7, fx: { gem: 'hands', star: 1 } },
    { arm: { l: -1.0, r: -1.0 }, rock: 1, crack: 2, eye: 'happy', mouth: 0.5, fx: { gem: 'hands', star: 0.7 } },
    { arm: { l: -0.95, r: -0.95 }, rock: 1, crack: 2, fx: { gem: 'hands' } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'stand',
    bodyC: [0, -200],
    bodyR: 280,
    body: { half: [[0, -364], [110, -350], [180, -300], [214, -214], [222, -128], [198, -62], [140, -40], [60, -34], [0, -32]] },
    belly: [0, -170, 86, 130],
    legs: { hip: [80, -54], r: 34, foot: [56, 30], splay: 12 },
    arms: [{ at: [172, -300], len: 140, r: 36, pr: 54, rest: 0.4, claws: 38, pads: true }],
    head: { c: [0, -488], rx: 182, ry: 164, tufts: [[0.22, 0.3, 14], [0.7, 0.78, 14]] },
    ears: { at: [128, -118], pts: [[-40, 8], [-40, -34], [0, -56], [40, -34], [40, 8]], inner: [[-24, 4], [-24, -24], [0, -38], [24, -24], [24, 4]], fill: C.black, innerFill: C.white, tilt: 0.3 },
    face: {
      eyes: { x: 62, y: -30, rx: 25, ry: 28, white: '#F6F2EA', iris: '#6B4A2E', irisR: 0.74, lid: 0.12, lidColor: C.black },
      muzzle: [0, 58, 70, 48],
      nose: { y: 44, w: 32, h: 24 },
      mouth: { y: 88, w: 22, drop: 14, h: 30, style: 'cat' },
      blush: [104, 40, 24],
    },
    shadowW: 270,
    hooks: {
      skin: mask,
      bodyAfter: vest,
      head: hat,
      hand(ctx, R, B, side, end, a) {
        const fx = R.pose.fx || {};
        if (fx.pick && side > 0) pick(ctx, end, a, B);
        if (fx.gem === 'hands' && side > 0) {
          const l = K.front.armEnd(R, R.S.arms[0], -1).end;
          gem(ctx, [(end[0] + l[0]) / 2, (end[1] + l[1]) / 2 - 44], 1.2, B);
        }
      },
      behind(ctx, R, B) {
        // the tail: a short grey brush peeking out at his right hip
        const T = R.Mb;
        const sw = R.pose.tail * 40;
        const t = M.all(T, K.smooth([[150, -120], [220 + sw * 0.3, -150], [262 + sw, -110], [240 + sw * 0.6, -70], [170, -70]], 4));
        F().form(ctx, t, C.fur, B, sd('tail'), { width: 6, off: 0.1, hatch: 0.6 });
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (R.pose.rock) rock(ctx, R.pose.crack || 0, B);
        if (fx.hit) {
          const h = [K.CXF + 60, K.GROUND - 120];
          K.fx.star(ctx, h[0], h[1], 36, B, sd('hitS'), P.white);
          for (let k = 0; k < 6; k++) {
            const a = -Math.PI / 2 + (k - 2.5) * 0.4;
            K.line(ctx, [[h[0] + Math.cos(a) * 30, h[1] + Math.sin(a) * 30], [h[0] + Math.cos(a) * 70, h[1] + Math.sin(a) * 70]], { width: 6, seed: sd('hit', k), boil: B, smooth: false, taper: [3, 8] });
          }
        }
        if (fx.gem === 'rock') gem(ctx, [K.CXF, K.GROUND - 150], 1, B);
        if (fx.star) {
          const t = R.hp(0, -260, 0);
          K.fx.star(ctx, t[0] - 150, t[1] + 20, 34 * fx.star, B, sd('s1'), '#F4E3FF');
          K.fx.star(ctx, t[0] + 160, t[1] + 50, 24 * fx.star, B, sd('s2'), '#F4E3FF');
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { arm: T.arm, sq: T.sq || 1, y: T.y || 0, eyeMode: T.eye || 'open', mouth: T.mouth || 0, rock: T.rock, crack: T.crack, head: 0.05, fx: T.fx };
      },
    },
  });
})();
