// pets/34-phoenix.js : Феникс свободы (mythic, every role). Bird kit, struts.
// A crimson firebird with an orange-gold chest, gold coverts and orange primaries, a small gold
// hooked beak, a gold stroke behind a proud gold eye. A crest of gold feathers tipped with flame,
// three long tail plumes that end in fire, embers always drifting off him. On one leg, the iron
// cuff of a shackle he broke, its chain snapped. Work: bursts into flame, burns down to a glowing
// ember, hatches out of it again with his wings wide — and the ember rains down as coins and tokens.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'phoenix';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#C23A2C',
    furDeep: '#6E1812',
    furLit: '#F07A50',
    chest: '#F39A3A',
    chestDeep: '#B8601A',
    gold: '#F6C94A',
    goldDeep: '#A8741A',
    wing: '#B22E26',
    wingDeep: '#5E120E',
    primary: '#F28A2C',
    covert: '#E8662A',
    wingLine: '#7A1A16',
    secondary: '#D84A2A',
    tail: '#B22E26',
    beak: '#F2C04A',
    beakDeep: '#9A6A14',
    eye: '#1A110E',
    leg: '#E8A23A',
    legDeep: '#9A5A16',
    iron: '#6A6E75',
    ironDeep: '#3A3D42',
    ironLit: '#9CA1A8',
  };
  const FIRE = ['#D8402A', '#F28A2C', '#FFE08A'];

  const SIL = [
    [-140, -170, 0],
    [-180, -222, 0],
    [-160, -288, 0],
    [-90, -338, 0],
    [-10, -382, 0.2],
    [22, -432, 0.7],
    [46, -478, 1],
    [92, -506, 1],
    [140, -500, 1],
    [170, -474, 1],
    [174, -446, 1],
    [158, -422, 1],
    [134, -402, 0.7],
    [124, -352, 0.3],
    [128, -292, 0.1],
    [116, -232, 0],
    [84, -182, 0],
    [0, -158, 0],
    [-80, -160, 0],
  ];

  const WING = {
    fold: [[46, -340], [0, -340], [-80, -310], [-146, -266], [-190, -236], [-210, -220], [-180, -206], [-122, -200], [-40, -216], [18, -254], [56, -300]],
    spread: [[46, -340], [34, -430], [-6, -540], [-72, -610], [-156, -630], [-226, -600], [-206, -548], [-160, -486], [-96, -420], [-26, -370], [50, -322]],
    covert: [[46, -340], [0, -340], [-84, -310], [-70, -272], [-4, -272], [50, -304]],
    covertSpread: [[46, -340], [34, -430], [-6, -540], [-30, -484], [-4, -408], [42, -342]],
    wrist: [-60, -300],
    wristSpread: [-50, -540],
    tips: [3, 4, 5],
    feather: 84,
    trail: [7, 8, 9],
    secLen: 30,
    scallops: [[-150, -250], [-110, -236], [-70, -232], [-30, -244]],
    scallopsSpread: [[-150, -540], [-110, -486], [-70, -432], [-30, -382]],
  };

  const BEAK_TIP = [216, -442];

  const flick = (R) => (R.pose.fx && R.pose.fx.ph) || 0;

  function markings(ctx, R, B) {
    const T = R.Mb, H = R.Mh;
    // the orange-gold chest with scalloped feathers
    const chest = M.all(T, K.smooth([[70, -330], [126, -300], [124, -220], [84, -176], [30, -190], [30, -270]], 5));
    K.fill(ctx, chest, C.chest);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const x = 50 + k * 24 + (r % 2) * 12, y = -300 + r * 36;
        K.line(ctx, M.all(T, K.curve([[x - 12, y], [x, y + 10], [x + 12, y]], 4)), { width: 3, color: C.chestDeep, alpha: 0.85, seed: sd('scal', r, k), boil: B, taper: [3, 3] });
      }
    }
    // the gold stroke behind the eye
    K.line(ctx, M.all(H, K.curve([[112, -470], [86, -474], [58, -484]], 4)), { width: 9, color: C.gold, seed: sd('liner'), boil: B, taper: [3, 10] });
  }

  /**
   * A fire feather along the centre line c (screen points): red at the tip, orange, gold at the
   * root (fire is palest where it burns hottest), one ink outline round the whole.
   */
  function fireFeather(ctx, c, w, B, seed, bands) {
    const rib = K.ribbonPts(c, w);
    K.fill(ctx, rib, bands[0][1]);
    for (let i = 1; i < bands.length; i++) {
      const k = bands[i][0];
      const n = Math.max(2, Math.round(c.length * k));
      const sub = c.slice(0, n);
      K.clip(ctx, rib, () => K.fill(ctx, K.ribbonPts(sub, (u) => w(u * k) * 1.3), bands[i][1]));
    }
    L.hatch(ctx, rib, { angle: -Math.PI / 4, spacing: 7, width: 2, color: C.furDeep, alpha: 0.45, density: 0.35, clip: true, seed: seed + 3, boil: B });
    L.inkPath(ctx, rib, { closed: true, width: 5, seed, boil: B, wobble: 0.8, taper: [4, 10] });
  }

  // three long plumes sweeping up and back, burning at their ends
  function plumes(ctx, R, B) {
    const T = R.Mb;
    const sw = R.pose.fx && R.pose.fx.sway != null ? R.pose.fx.sway : 0;
    const ph = flick(R);
    const lines = [
      [[-150, -214], [-214, -302], [-300, -356], [-384, -352]],
      [[-150, -206], [-238, -262], [-340, -276], [-428, -240]],
      [[-150, -198], [-236, -212], [-318, -194], [-384, -146]],
    ];
    const w = (u) => (u < 0.68 ? 10 + 30 * (u / 0.68) : 40 * Math.pow(Math.max(0, 1 - (u - 0.68) / 0.32), 0.6) + 2);
    lines.forEach((pts, k) => {
      const moved = pts.map(([x, y], i) => [x + sw * 6 * i, y + Math.sin(sw * 1.4 + k * 1.3 + i * 0.6) * 9 * i]);
      const c = M.all(T, K.curve(moved, 6));
      fireFeather(ctx, c, w, B, sd('plume', k), [[1, '#C8352B'], [0.84, '#F28A2C'], [0.5, C.wing]]);
      K.line(ctx, c.slice(1, Math.floor(c.length * 0.8)), { width: 3, color: C.gold, alpha: 0.9, seed: sd('plumeLine', k), boil: B, taper: [4, 6] });
      const tip = c[c.length - 1];
      K.fx.flame(ctx, tip[0] + 4, tip[1] + 8, 34, 52, ph + k * 2, B, sd('plumeFire', k), { colors: FIRE, width: 3.6, tongues: 2 });
    });
  }

  // a crest of fire feathers fanned back from the crown, flickering
  function crest(ctx, R, B) {
    const H = R.Mh;
    const ph = flick(R);
    const flare = R.pose.fx && R.pose.fx.flare ? 1.3 : 1;
    const w = (u) => 4 + 20 * Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.95));
    [[-2.05, 96], [-2.35, 110], [-2.62, 100], [-2.88, 82]].forEach(([a0, l], k) => {
      const a = a0 + 0.1 * L.noise1(ph * 0.8 + k * 2.3, sd('crestA'));
      const len = l * flare;
      const base = [96 - k * 10, -498];
      const mid = [base[0] + Math.cos(a + 0.25) * len * 0.5, base[1] + Math.sin(a + 0.25) * len * 0.5];
      const tip = [base[0] + Math.cos(a) * len, base[1] + Math.sin(a) * len];
      const c = M.all(H, K.curve([base, mid, tip], 6));
      fireFeather(ctx, c, w, B, sd('crest', k), [[1, '#D8402A'], [0.62, '#F28A2C'], [0.3, C.gold]]);
    });
  }

  function shackle(ctx, R, B, knee, f) {
    const c = [lerp(knee[0], f[0], 0.45), lerp(knee[1], f[1], 0.45)];
    K.plate(ctx, L.rrectPts(c[0] - 16, c[1] - 11, 32, 22, 5, 4), { fill: C.iron, deep: C.ironDeep, width: 4, seed: sd('cuff'), boil: B });
    K.fill(ctx, L.ellipsePts(c[0] + 8, c[1], 3, 3, 6), C.ironLit);
    const sw = R.pose.fx && R.pose.fx.sway != null ? R.pose.fx.sway : 0;
    const a = [c[0] - 12, c[1] + 10];
    const b = [a[0] - 16 - sw * 8, a[1] + 34];
    K.chain(ctx, [a, b], 16, { width: 5, color: C.iron, seed: sd('chain'), boil: B });
    // the snapped link
    const e = [b[0] - 2, b[1] + 16];
    L.inkPath(ctx, L.ellipsePts(e[0], e[1], 8, 12, 14, 0.4).slice(3, 13), { width: 7, color: P.ink, seed: sd('snap'), boil: B, taper: [2, 2] });
    L.inkPath(ctx, L.ellipsePts(e[0], e[1], 8, 12, 14, 0.4).slice(3, 13), { width: 3, color: C.ironLit, seed: sd('snap'), boil: B, taper: [2, 2] });
  }

  function orb(ctx, B, crack, ph) {
    const c = [K.CX - 10, K.GROUND - 110];
    const z = 1.3;
    K.fill(ctx, L.ellipsePts(c[0], c[1], 150 * z, 150 * z, 40), P.annYellow, 0.22);
    K.fx.flame(ctx, c[0], c[1] - 20 * z, 160 * z, 190 * z, ph, B, sd('orbFire'), { colors: FIRE, alpha: 0.9, tongues: 4 });
    const body = L.ellipsePts(c[0], c[1], 74 * z, 84 * z, 36);
    K.form(ctx, body, { fill: '#F6B23A', deep: '#C8551E', width: 6, seed: sd('orb'), boil: B, spacing: 6, hatchAlpha: 0.6 });
    K.fill(ctx, L.ellipsePts(c[0] - 22 * z, c[1] - 30 * z, 22 * z, 16 * z, 16, -0.5), '#FFF1C4', 0.9);
    if (crack) {
      const q = (x, y) => [c[0] + x * z, c[1] + y * z];
      const lines = [[q(-10, -84), q(6, -40), q(-14, -10), q(10, 20)], [q(6, -40), q(40, -30)]];
      for (const [i, ln] of lines.entries()) {
        K.line(ctx, ln, { width: 10, color: '#FFF6D8', seed: sd('crackG', i), boil: B, smooth: false, taper: [3, 3] });
        K.line(ctx, ln, { width: 3.4, seed: sd('crack', i), boil: B, smooth: false, taper: [3, 3] });
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * K.TAU + 0.2;
        K.line(ctx, [q(Math.cos(a) * 100, Math.sin(a) * 110), q(Math.cos(a) * 150, Math.sin(a) * 165)], { width: 7, color: P.annYellow, seed: sd('ray', k), boil: B, smooth: false, taper: [3, 8] });
      }
    }
  }

  function rain(ctx, B, u) {
    const drops = [
      ['coin', -170, 0.1], ['token', -80, 0.35], ['coin', 60, 0.6], ['token', 170, 0.2], ['coin', 250, 0.8],
    ];
    drops.forEach(([kind, dx, turn], k) => {
      const y = u === 1 ? K.GROUND - 320 + k * 30 + (k % 2) * 60 : K.GROUND - 20 - (k % 2) * 6;
      const x = K.CX + dx;
      const t = u === 1 ? turn : 0.1;
      if (kind === 'coin') K.fx.coin(ctx, x, y, 24, t, B, sd('rc', k));
      else K.fx.token(ctx, x, y, 26, t, B, sd('rt', k));
    });
  }

  const WORK = [
    { wing: 0.3, head: -0.2, fx: { flare: 1, sway: 0.5 } },
    { wing: 0.6, wingF: 0.6, sq: 1.04, head: -0.25, beak: 0.4, fx: { flare: 1, wreath: 1 } },
    { wing: 0.9, wingF: 0.9, sq: 1.05, head: -0.3, beak: 0.6, eyeMode: 'closed', fx: { flare: 1, wreath: 1, cover: 1 } },
    { hide: true, fx: { orb: 1 } },
    { hide: true, fx: { orb: 1, crack: 1 } },
    { y: -60, wing: 1, wingF: 1, sq: 1.08, head: -0.25, beak: 0.6, eyeMode: 'happy', fx: { flare: 1, rebirth: 1 } },
    { y: -30, wing: 0.6, wingF: 0.6, head: -0.15, beak: 0.3, eyeMode: 'happy', fx: { flare: 1, rain: 1 } },
    { wing: 0.15, wingF: 0.15, head: -0.08, sq: 1.03, fx: { rain: 2, sway: -0.4 } },
  ];

  const withFx = (p, extra) => Object.assign(p, { fx: Object.assign({}, p.fx, extra) });

  K.kits.bird.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [60, -420],
    headScale: 1.26,
    bodyC: [-10, -270],
    bodyR: 190,
    gait: 'strut',
    stride: 40,
    feet: { n: 36, f: 2 },
    wing: WING,
    tailFan: { base: [-150, -196], angle: Math.PI + 0.25, spread: 0.4, n: 5, len: 110, width: 17, taper: 0.1, fill: (i) => (i % 2 ? C.wing : C.fur) },
    sit: 30,
    leg: { hipN: [30, -160], hipF: [0, -164], l1: 40, l2: 80, r: 8, toe: 38, thighR: 2.4, thigh: C.fur, claw: '#3A2A20' },
    tufts: false,
    fur: true,
    shadowW: 230,
    beak: { hinge: [168, -460], tip: BEAK_TIP, upper: [[160, -476], [190, -480], [212, -464], [218, -440], [206, -448], [186, -454], [164, -452]], lower: [[166, -454], [190, -452], [204, -446], [190, -438], [168, -442]] },
    face: { eye: { x: 126, y: -468, r: 15, style: 'iris', white: '#FFF4DE', iris: '#F6C94A', lid: 0.26, lidColor: C.fur } },
    hooks: {
      behind(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.wreath || fx.rebirth) {
          const c = M.ap(R.Mr, [-10, 0]);
          K.fx.flame(ctx, c[0], c[1] + 10, fx.rebirth ? 620 : 420, fx.rebirth ? 700 : 560, flick(R), B, sd('wreath'), { colors: FIRE, tongues: 5, alpha: 0.95 });
        }
        if (!R.pose.hide) plumes(ctx, R, B);
      },
      body: markings,
      head: crest,
      legAfter(ctx, R, B, side, knee, f) {
        if (side === 'n') shackle(ctx, R, B, knee, f);
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.orb) orb(ctx, B, !!fx.crack, flick(R));
        if (fx.cover) {
          const c = M.ap(R.Mr, [0, 0]);
          K.fx.flame(ctx, c[0] - 10, c[1] + 6, 360, 520, flick(R) + 5, B, sd('cover'), { colors: FIRE, tongues: 4, alpha: 0.92 });
        }
        if (fx.rebirth) K.fx.burst(ctx, M.ap(R.Mb, [0, -300]), 0.3, B, sd('reburst'), '#F28A2C');
        if (fx.rain) rain(ctx, B, fx.rain);
        if (fx.ember != null && !R.pose.hide) K.fx.embers(ctx, M.ap(R.Mb, [-200, -200]), 260, fx.ember, B, sd('embers'), FIRE);
      },
    },
    poses: {
      idle(d, n, P0) {
        return withFx(P0.idle(d, n), { ember: d / n, ph: d, sway: Math.sin((Math.PI * 2 * d) / n) * 0.5 });
      },
      walk(d, n, P0) {
        return withFx(P0.walk(d, n), { ember: d / n, ph: d, sway: Math.sin((Math.PI * 2 * d) / n) });
      },
      happy(d, n, P0) {
        return withFx(P0.happy(d, n), { ember: d / n, ph: d, flare: 1 });
      },
      attack(d, n, P0) {
        return withFx(P0.attack(d, n), { ember: d / n, ph: d, flare: d >= 1 && d <= 3 ? 1 : 0 });
      },
      sleep(d, n, P0) {
        return withFx(P0.sleep(d, n), { ph: d * 0.5 });
      },
      work(d, n, P0) {
        const p = Object.assign({ feet: P0.idle(0, 12).feet }, WORK[d]);
        return withFx(p, { ph: d, ember: d >= 5 ? d / n : null });
      },
    },
  });
})();
