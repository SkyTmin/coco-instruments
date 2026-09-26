// pets/40-roach.js : Таракан-бегун (common, rate). Bug kit, six legs on alternating tripods.
// A racer from the camp's cockroach races: a glossy chestnut shell with a white racing stripe
// edged in red and a painted number 7 on its side, a big round head with huge shiny eyes, one
// antenna bent at the tip, flying goggles on its forehead, spiny legs. Work: goggles down, a
// crouch, off like a shot — out of the picture and back round from the other side, a skid, a wave.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'roach';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    shell: '#8C4A24',
    shellDeep: '#4A220E',
    shine: '#F6D2A6',
    pro: '#A35A2A',
    head: '#A45E34',
    headDeep: '#5A2A12',
    leg: '#6A3418',
    legDeep: '#3A1A08',
    joint: '#7E4420',
    antenna: '#5A2E16',
    jaw: '#4A220E',
    eye: '#1A110E',
    white: '#F4ECDF',
    red: '#C0392B',
  };

  const ABD = [[-292, -168], [-262, -214], [-170, -240], [-50, -242], [40, -228], [82, -190], [62, -140], [-40, -112], [-180, -112], [-268, -132]];
  // the pronotum: a shield that overhangs the head, as on a real cockroach
  const PRO = [[18, -238], [90, -258], [172, -250], [226, -220], [234, -196], [200, -180], [120, -168], [40, -170], [14, -204]];
  const HEAD = L.ellipsePts(246, -142, 78, 70, 24);

  // the racing livery: a stripe down the back, a number on the side, the seam of the wing cases
  function livery(c2, R, B, id, T) {
    if (id === 'pro') {
      K.line(c2, M.all(T, K.curve([[40, -220], [120, -236], [200, -214]], 5)), { width: 4, color: C.shellDeep, alpha: 0.7, seed: sd('proRim'), boil: B });
      return;
    }
    if (id !== 'abd') return;
    const top = M.all(T, K.curve([[60, -226], [-40, -240], [-160, -238], [-264, -212]], 6));
    K.band(c2, top, 24, { fill: C.white, seed: sd('stripe'), boil: B, width: 0 });
    for (const s of [-1, 1]) {
      const edge = M.all(T, K.curve([[60, -226 + s * 15], [-40, -240 + s * 15], [-160, -238 + s * 15], [-264, -212 + s * 15]], 6));
      K.line(c2, edge, { width: 5, color: C.red, seed: sd('edge', s), boil: B, taper: 0 });
    }
    K.line(c2, M.all(T, K.curve([[50, -196], [-60, -200], [-180, -188], [-282, -158]], 6)), { width: 4, color: C.shellDeep, alpha: 0.9, seed: sd('seam'), boil: B });
    const c = M.ap(T, [-104, -164]);
    K.fill(c2, L.ellipsePts(c[0], c[1], 30, 28, 22), C.white);
    L.inkPath(c2, L.ellipsePts(c[0], c[1], 30, 28, 22), { closed: true, width: 4, seed: sd('bib'), boil: B, wobble: 0.4 });
    K.line(c2, [[c[0] - 11, c[1] - 14], [c[0] + 12, c[1] - 14], [c[0] - 4, c[1] + 16]], { width: 7, seed: sd('seven'), boil: B, smooth: false, taper: [2, 4] });
  }

  // spines on each shin
  function spines(ctx, R, B, side, i, hip, knee, foot, far) {
    for (const u of [0.35, 0.6, 0.82]) {
      const p = [lerp(knee[0], foot[0], u), lerp(knee[1], foot[1], u)];
      const dx = foot[0] - knee[0], dy = foot[1] - knee[1], dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl, ny = dx / dl;
      const s = nx < 0 ? 1 : -1;
      K.line(ctx, [p, [p[0] + s * nx * 14 - (dx / dl) * 6, p[1] + s * ny * 14 - (dy / dl) * 6]], { width: far ? 2.6 : 3.2, seed: sd('spine', side, i, u), boil: B, smooth: false, taper: [2, 3] });
    }
  }

  function goggles(ctx, R, B) {
    const down = R.pose.fx && R.pose.fx.gog;
    // pushed up on the shield like on a helmet, or pulled down over the eyes for the run
    if (down) K.goggles(ctx, R.Mh, 280, -150, 28, { seed: sd('gog'), boil: B, lens: '#8FC0CF' });
    else K.goggles(ctx, R.Mb, 170, -254, 22, { seed: sd('gog'), boil: B });
  }

  const WORK = [
    { sq: 0.88, lean: -0.05, legh: 16, ant: -0.7, fx: { gog: 1 } },
    { x: 150, lean: 0.06, ant: -0.9, run: 0.25, fx: { gog: 1, speed: 1, dust: 0.3 } },
    { hide: true, fx: { gog: 1, whoosh: 1, dustAt: 1 } },
    { hide: true, fx: { gog: 1, whoosh: 2 } },
    { x: -330, lean: 0.06, ant: -0.9, run: 0.75, fx: { gog: 1, speed: 1 } },
    { x: -50, lean: -0.14, sq: 0.94, ant: -0.4, fx: { gog: 1, skid: 1 } },
    { head: -0.1, ant: 0.3, eyeMode: 'happy', mouth: 0.3, wave: 1, fx: { star: 1 } },
    { head: -0.04, ant: 0.1, fx: {} },
  ];

  K.kits.bug.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    neck: [196, -160],
    waist: [30, -180],
    headScale: 1.08,
    bodyC: [-40, -190],
    bodyR: 230,
    parts: [
      { id: 'abd', T: 'a', pts: ABD, fill: C.shell, deep: C.shellDeep, lit: [[30, -222], [-60, -232], [-180, -224]], litW: 10 },
      { id: 'head', T: 'h', pts: HEAD, smooth: false, fill: C.head, deep: C.headDeep },
      { id: 'pro', T: 'b', z: 'front', pts: PRO, fill: C.pro, deep: C.shellDeep, lit: [[50, -238], [110, -248], [170, -236]], litW: 10 },
    ],
    legs: [
      { hip: [140, -138], foot: 214, l1: 70, l2: 86, phase: 0 },
      { hip: [60, -128], foot: 70, l1: 86, l2: 100, phase: 0.5 },
      { hip: [-30, -122], foot: -190, l1: 126, l2: 134, phase: 0 },
    ],
    legR: 12,
    farFoot: -20,
    stride: 56,
    lift: 34,
    antenna: { base: [270, -196], pts: [[270, -196], [312, -244], [366, -300], [410, -372], [424, -452]], kink: 3, w: 6, farRot: -0.35 },
    eyes: [
      { x: 306, y: -150, r: 19 },
      { x: 262, y: -146, r: 28 },
    ],
    jaws: { at: [296, -92], minOpen: 0.25, pts: [[278, -110], [306, -114], [320, -102], [304, -96], [282, -100]] },
    smile: [[270, -100], [288, -92], [306, -100]],
    mouthAt: [312, -100],
    shadowW: 280,
    sleepLow: 40,
    hooks: {
      part: livery,
      leg: spines,
      head: goggles,
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.speed) K.fx.speed(ctx, M.ap(R.Mr, [-300, -220]), 260, 0.9, B, sd('speed'));
        if (fx.dust) K.fx.dust(ctx, M.ap(R.Mr, [-220, 0]), 70, fx.dust, B, sd('dust'));
        if (fx.dustAt) K.fx.dust(ctx, [K.CX + 60, K.GROUND], 90, 0.5, B, sd('dust2'));
        if (fx.whoosh) {
          // only speed lines: the racer is out of the picture
          const x = fx.whoosh === 1 ? K.CX + 560 : K.CX - 180;
          K.fx.speed(ctx, [x, K.GROUND - 220], 340, fx.whoosh === 1 ? 0.7 : 0.9, B, sd('whoosh', fx.whoosh));
        }
        if (fx.skid) {
          K.fx.dust(ctx, M.ap(R.Mr, [280, 0]), 80, 0.45, B, sd('skid'));
          for (let k = 0; k < 3; k++) K.line(ctx, [M.ap(R.Mr, [-40 - k * 60, 4]), M.ap(R.Mr, [-150 - k * 60, 4])], { width: 4, color: P.inkSoft, alpha: 0.7, seed: sd('skidL', k), boil: B, smooth: false, taper: [2, 10] });
        }
        if (fx.star) K.fx.star(ctx, ...M.ap(R.Mh, [330, -360]), 30, B, sd('star'), '#FFF1C4');
      },
    },
    poses: {
      work(d, n, P0, S) {
        const T = WORK[d];
        const legs = T.run != null ? K.kits.bug.gait(S, T.run) : K.kits.bug.stand(S, d === 5 ? 0.6 : 0);
        if (T.wave) legs.n[0] = { x: legs.n[0].x + 30, lift: 150 };
        return Object.assign({}, T, { legs, fx: T.fx });
      },
    },
  });
})();
