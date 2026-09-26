// pets/33-raven.js : Ворон-ключник (legendary, luck + token). Bird kit, hops.
// A big raven, glossy blue-black with a violet and blue sheen, a shaggy throat, a heavy hooked beak
// with bristles, a wedge tail, a gold eye behind a gold-rimmed monocle on a chain. A ring of keys
// hangs on his chest (iron, brass, one gold), gold rings on his leg. Work: a padlock on the ground;
// he takes a key from the ring, turns it in the lock, the shackle springs, a token and a coin
// jump out.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'raven';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#2C2F3A',
    furDeep: '#12131A',
    furLit: '#5B6178',
    sheenV: '#6A5AA0',
    sheenB: '#4A7AB0',
    wing: '#2A2D38',
    wingDeep: '#101118',
    primary: '#23252F',
    covert: '#3A3F52',
    wingLine: '#6E7696',
    secondary: '#2A2D38',
    tail: '#2A2D38',
    beak: '#1E1F25',
    beakDeep: '#0A0A0D',
    leg: '#26272E',
    legDeep: '#0E0E12',
    eye: '#1A110E',
    gold: '#E2B54A',
    goldDeep: '#96701E',
    iron: '#6A6E75',
    ironDeep: '#3A3D42',
    ironLit: '#9CA1A8',
    brass: '#C99A4A',
    brassDeep: '#7E5A22',
    glass: '#CFE6F0',
  };

  const SIL = [
    [-150, -160, 0],
    [-192, -210, 0],
    [-172, -282, 0],
    [-96, -338, 0],
    [-6, -378, 0.2],
    [28, -422, 0.7],
    [54, -468, 1],
    [100, -498, 1],
    [156, -496, 1],
    [192, -468, 1],
    [202, -432, 1],
    [186, -402, 1],
    [160, -376, 0.8],
    [138, -340, 0.4],
    [128, -290, 0.1],
    [118, -236, 0],
    [86, -180, 0],
    [0, -150, 0],
    [-86, -152, 0],
  ];

  const WING = {
    fold: [[50, -350], [0, -350], [-84, -318], [-152, -272], [-196, -240], [-216, -222], [-184, -208], [-124, -200], [-40, -218], [20, -258], [60, -306]],
    spread: [[50, -350], [36, -440], [-8, -546], [-76, -610], [-160, -626], [-226, -596], [-206, -546], [-162, -484], [-98, -420], [-26, -372], [54, -330]],
    covert: [[50, -350], [0, -350], [-88, -318], [-72, -280], [-4, -278], [54, -310]],
    covertSpread: [[50, -350], [36, -440], [-8, -546], [-32, -490], [-6, -414], [44, -352]],
    wrist: [-64, -310],
    wristSpread: [-54, -546],
    tips: [3, 4, 5],
    feather: 82,
    trail: [7, 8, 9],
    secLen: 30,
    scallops: [[-160, -256], [-118, -242], [-76, -238], [-34, -250]],
    scallopsSpread: [[-160, -546], [-118, -494], [-76, -440], [-34, -390]],
  };

  const BEAK_TIP = [272, -426];
  const KEY_LEN = 70;

  // the gloss: violet and blue strokes where the light catches the black
  function sheen(ctx, R, B) {
    const H = R.Mh, T = R.Mb;
    const stroke = (Tm, pts, col, k) => K.line(ctx, M.all(Tm, pts), { width: 9, color: col, alpha: 0.75, seed: sd('sheen', k), boil: B, taper: [8, 10] });
    stroke(H, [[62, -468], [100, -488], [150, -486]], C.sheenB, 1);
    stroke(H, [[40, -440], [66, -470]], C.sheenV, 2);
    stroke(T, [[-150, -290], [-96, -326], [-20, -360]], C.sheenV, 3);
    stroke(T, [[-170, -250], [-150, -286]], C.sheenB, 4);
  }

  function wingSheen(c2, R, B, T, t) {
    const a = [[-20, -326], [-80, -300], [-130, -270]];
    const b = [[20, -420], [-10, -500], [-50, -560]];
    const pts = a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]);
    K.line(c2, M.all(T, pts), { width: 8, color: C.sheenB, alpha: 0.7, seed: sd('wsheen'), boil: B, taper: [8, 10] });
    K.line(c2, M.all(T, pts.map(([x, y]) => [x - 6, y + 22])), { width: 6, color: C.sheenV, alpha: 0.6, seed: sd('wsheen2'), boil: B, taper: [8, 10] });
  }

  function bristles(ctx, R, B) {
    const H = R.Mh;
    for (let k = 0; k < 5; k++) {
      K.line(ctx, M.all(H, [[178 + k * 5, -472 + k * 5], [206 + k * 6, -474 + k * 6]]), { width: 3.2, color: C.furDeep, seed: sd('bristle', k), boil: B, taper: [2, 5] });
    }
  }

  /** A key: bow (ring), shaft and bit; s scale, turn 0..1 for the twist in the lock. */
  function key(ctx, x, y, rot, s, fill, deep, B, seed, turn = 0) {
    const T = M.chain(M.tr(x, y), M.rot(rot), M.sc(s, s));
    const tw = Math.max(0.2, Math.abs(Math.cos(Math.PI * turn)));
    const bow = M.all(T, L.ellipsePts(0, 0, 16 * tw, 16, 18));
    K.form(ctx, bow, { fill, deep, width: 4, seed, boil: B, shade: 0.6, spacing: 4, hatchW: 1.6 });
    K.fill(ctx, M.all(T, L.ellipsePts(0, 0, 6 * tw, 6, 10)), P.ink);
    const shaft = M.all(T, [[14, -4], [KEY_LEN, -4], [KEY_LEN, 4], [14, 4]]);
    K.fill(ctx, shaft, fill);
    L.inkPath(ctx, shaft, { closed: true, width: 3.4, seed: seed + 1, boil: B, smooth: false, taper: 0, wobble: 0.3 });
    const bit = M.all(T, [[KEY_LEN - 22, 4], [KEY_LEN - 22, 4 + 16 * tw], [KEY_LEN - 12, 4 + 16 * tw], [KEY_LEN - 12, 10 * tw + 4], [KEY_LEN - 4, 10 * tw + 4], [KEY_LEN - 4, 4]]);
    K.fill(ctx, bit, fill);
    L.inkPath(ctx, bit, { closed: true, width: 3.2, seed: seed + 2, boil: B, smooth: false, taper: 0, wobble: 0.3 });
  }

  function keyring(ctx, R, B) {
    const S = R.skin;
    const chain = K.curve([[20, -404, 0.6], [70, -350, 0.4], [112, -318, 0.2]].map(S), 5);
    K.chain(ctx, chain, 14, { width: 5, color: C.iron, seed: sd('chain'), boil: B });
    const c = S([118, -300, 0.1]);
    const sway = R.pose.fx && R.pose.fx.sway != null ? R.pose.fx.sway : 0;
    L.inkPath(ctx, L.ellipsePts(c[0], c[1], 20, 20, 22), { closed: true, width: 10, color: P.ink, seed: sd('ring'), boil: B });
    L.inkPath(ctx, L.ellipsePts(c[0], c[1], 20, 20, 22), { closed: true, width: 5, color: C.ironLit, seed: sd('ring'), boil: B });
    const keys = [
      [1.7 + sway * 0.2, 0.62, C.iron, C.ironDeep],
      [1.25 + sway * 0.25, 0.7, C.brass, C.brassDeep],
      [0.85 + sway * 0.3, 0.72, C.gold, C.goldDeep],
    ];
    const missing = R.pose.fx && R.pose.fx.keyOut;
    keys.forEach(([a, s, f, d], k) => {
      if (missing && k === 2) return;
      key(ctx, c[0] + Math.cos(a) * 20, c[1] + Math.sin(a) * 20, a - 0.12, s, f, d, B, sd('key', k));
    });
  }

  function monocle(ctx, R, B) {
    if (R.pose.eyeMode === 'happy' || R.pose.eyeMode === 'closed') return;
    const H = R.Mh;
    const rim = M.all(H, L.ellipsePts(150, -460, 27, 29, 26));
    K.fill(ctx, rim, C.glass, 0.25);
    const g = M.ap(H, [140, -472]);
    K.line(ctx, [[g[0] - 6, g[1] + 6], [g[0] + 6, g[1] - 8]], { width: 4, color: P.white, alpha: 0.8, seed: sd('glint'), boil: B, smooth: false, taper: [2, 2] });
    L.inkPath(ctx, rim, { closed: true, width: 10, color: P.ink, seed: sd('mono'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, rim, { closed: true, width: 5, color: C.gold, seed: sd('mono'), boil: B, wobble: 0.3 });
    const a = M.ap(H, [138, -434]);
    const b = M.ap(R.Mb, [96, -344]);
    const chain = K.curve([a, [lerp(a[0], b[0], 0.5) - 6, lerp(a[1], b[1], 0.5) + 16], b], 5);
    L.inkPath(ctx, chain, { width: 5, color: P.ink, seed: sd('monoChain'), boil: B, taper: [2, 2] });
    L.inkPath(ctx, chain, { width: 2.4, color: C.gold, seed: sd('monoChain'), boil: B, taper: [2, 2] });
  }

  // the padlock: its keyhole sits where the key tip lands in the lunge (drawing 2)
  let lockAt = null;
  function lockSpot(R) {
    if (!lockAt) {
      const R2 = K.kits.bird.rig(R.S, K.pose(K.kits.bird.REST, WORK[2]));
      const tip = M.ap(R2.Mh, BEAK_TIP);
      const ang = Math.atan2(tip[1] - M.ap(R2.Mh, [200, -440])[1], tip[0] - M.ap(R2.Mh, [200, -440])[0]);
      const kh = [tip[0] + Math.cos(ang) * KEY_LEN * 0.8, tip[1] + Math.sin(ang) * KEY_LEN * 0.8];
      lockAt = { x: kh[0] + 12, key: kh, h: Math.max(90, Math.min(150, (K.GROUND - kh[1]) / 0.5)) };
    }
    return lockAt;
  }

  function padlock(ctx, R, B, open) {
    const Lk = lockSpot(R);
    const g = K.GROUND;
    const w = 92, h = Lk.h;
    const top = g - h;
    // the shackle: an arc over the body, lifted and swung open when unlocked
    // with legs that go down into the body, so the lifted shackle still sits in the lock
    const sh = [[Lk.x - 30, top + 40]];
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + (i / 14) * Math.PI;
      sh.push([Lk.x + Math.cos(a) * 30, top + 6 + Math.sin(a) * 40]);
    }
    sh.push([Lk.x + 30, top + (open ? 20 : 40)]);
    const T = open ? M.chain(M.tr(0, -26), M.about(-0.55, Lk.x - 30, top + 30)) : M.I;
    const shp = M.all(T, sh);
    L.inkPath(ctx, shp, { width: 20, color: P.ink, seed: sd('shackle'), boil: B, taper: 0 });
    L.inkPath(ctx, shp, { width: 12, color: C.ironLit, seed: sd('shackle'), boil: B, taper: 0 });
    const body = L.rrectPts(Lk.x - w / 2, top, w, h, 14, 8);
    K.form(ctx, body, { fill: C.brass, deep: C.brassDeep, width: 6, seed: sd('lock'), boil: B, spacing: 7 });
    const kh = [Lk.x - 12, Lk.key[1]];
    K.fill(ctx, L.ellipsePts(kh[0], kh[1] - 6, 9, 9, 12), P.ink);
    K.fill(ctx, [[kh[0] - 5, kh[1]], [kh[0] + 5, kh[1]], [kh[0] + 7, kh[1] + 22], [kh[0] - 7, kh[1] + 22]], P.ink);
    return kh;
  }

  const WORK = [
    { x: -50, head: 0.3, fx: { lock: 1, sway: 0.4 } },
    { x: -50, head: -0.1, beak: 0.2, fx: { lock: 1, keyOut: 1, item: 'beak' } },
    { x: 10, lean: 0.36, head: 0.64, hy: 14, sq: 0.95, fx: { lock: 1, keyOut: 1, item: 'lock', turn: 0 } },
    { x: 10, lean: 0.36, head: 0.7, hy: 14, sq: 0.95, fx: { lock: 1, keyOut: 1, item: 'lock', turn: 0.5 } },
    { x: -20, lean: 0.1, head: -0.1, beak: 0.2, fx: { lock: 1, open: 1, keyOut: 1, item: 'beak', burst: 1 } },
    { x: -30, head: -0.3, sq: 1.05, wing: 0.35, wingF: 0.35, eyeMode: 'happy', fx: { lock: 1, open: 1, keyOut: 1, item: 'beak', pop: 1 } },
    { x: -30, head: -0.2, sq: 1.04, wing: 0.15, wingF: 0.15, eyeMode: 'happy', fx: { lock: 1, open: 1, keyOut: 1, item: 'beak', pop: 2 } },
    { x: -40, head: 0.1, fx: { lock: 1, open: 1, pop: 3, sway: -0.4 } },
  ];

  K.kits.bird.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [70, -410],
    headScale: 1.26,
    bodyC: [-10, -270],
    bodyR: 200,
    gait: 'hop',
    feet: { n: 40, f: 2 },
    wing: WING,
    tailFan: { base: [-170, -204], angle: Math.PI + 0.3, spread: 0.34, n: 5, len: 160, width: 19, taper: 0.3, fill: () => C.tail },
    sit: 30,
    leg: { hipN: [30, -160], hipF: [0, -164], l1: 40, l2: 86, r: 9, toe: 44, thighR: 2.5, claw: '#0E0E12' },
    tuftRange: [11, 14],
    fur: true,
    shadowW: 230,
    beak: { hinge: [190, -448], tip: BEAK_TIP, upper: [[182, -476], [222, -482], [258, -468], [280, -442], [274, -422], [260, -436], [226, -446], [186, -444]], lower: [[186, -444], [226, -442], [256, -434], [236, -424], [188, -428]], nostril: [208, -460] },
    face: { eye: { x: 150, y: -460, r: 16, style: 'iris', white: '#E6E3DC', iris: '#E8B53A', lid: 0.3, lidColor: C.fur } },
    hooks: {
      body: sheen,
      wingInside: wingSheen,
      face: bristles,
      front: keyring,
      head: monocle,
      legAfter(ctx, R, B, side, knee, f) {
        if (side !== 'n') return;
        for (const u of [0.4, 0.62]) {
          const c = [lerp(knee[0], f[0], u), lerp(knee[1], f[1], u)];
          K.plate(ctx, L.rrectPts(c[0] - 13, c[1] - 7, 26, 14, 5, 4), { fill: C.gold, deep: C.goldDeep, width: 3.4, seed: sd('lring', u), boil: B });
        }
      },
      behind(ctx, R, B) {
        const fx = R.pose.fx;
        if (fx && fx.lock) padlock(ctx, R, B, !!fx.open);
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx) return;
        const tip = M.ap(R.Mh, BEAK_TIP);
        const base = M.ap(R.Mh, [200, -440]);
        const ang = Math.atan2(tip[1] - base[1], tip[0] - base[0]);
        if (fx.item === 'beak') key(ctx, tip[0] - 18, tip[1] + 8, ang + 0.1, 0.9, C.gold, C.goldDeep, B, sd('keyB'));
        if (fx.item === 'lock') {
          // the key in the keyhole: its bow in the beak, the shaft in the lock
          const Lk = lockSpot(R);
          key(ctx, tip[0] - 18, tip[1] + 8, Math.atan2(Lk.key[1] - tip[1], Lk.key[0] - tip[0]), 0.9, C.gold, C.goldDeep, B, sd('keyL'), fx.turn);
        }
        const Lk = lockSpot(R);
        const top = [Lk.x, K.GROUND - Lk.h - 20];
        if (fx.burst) {
          K.fx.star(ctx, top[0] + 50, top[1] - 20, 34, B, sd('b1'), '#FFF1C4');
          K.fx.star(ctx, top[0] - 40, top[1] + 10, 22, B, sd('b2'), '#FFF1C4');
        }
        if (fx.pop) {
          const u = fx.pop;
          const h1 = [0, 120, 170, 60][u], h2 = [0, 80, 150, 20][u];
          K.fx.token(ctx, top[0] - 20 - 10 * u, top[1] - h1, 28, u * 0.3, B, sd('popT'));
          if (u < 3) K.fx.coin(ctx, top[0] + 30 + 16 * u, top[1] - h2, 24, u * 0.4, B, sd('popC'));
          else K.fx.coin(ctx, top[0] + 90, K.GROUND - 20, 22, 0.1, B, sd('popC'));
          if (u === 2) K.fx.burst(ctx, [top[0], top[1] - 120], 0.35, B, sd('popB'));
        }
      },
    },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { sway: Math.sin((Math.PI * 2 * d) / n) * 0.5 } });
      },
      walk(d, n, P0) {
        const p = P0.walk(d, n);
        return Object.assign(p, { fx: { sway: p.y < -30 ? -1 : 0.6 } });
      },
      work(d, n, P0) {
        return Object.assign({ feet: P0.idle(0, 12).feet }, WORK[d]);
      },
    },
  });
})();
