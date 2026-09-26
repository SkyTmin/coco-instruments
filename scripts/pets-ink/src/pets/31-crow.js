// pets/31-crow.js : Ворона-барахольщица (uncommon, token). Bird kit, hops.
// A hooded crow: an ash-grey body with a black hood, bib, wings and tail; a heavy black beak with
// bristles at its base, a shrewd white eye under a low lid, a scruffy crown. Round her neck, a
// string of shiny junk: a hex nut, a red bottle cap, a brass button; a rusty ring on her leg.
// Work: cocks her head at a glint on the ground, hops over, pecks up a camp token, tosses it and
// catches it — mine.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'crow';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#A9A7A2',
    furDeep: '#6C6A65',
    furLit: '#CBC9C4',
    hood: '#30333B',
    hoodDeep: '#15161B',
    wing: '#353840',
    wingDeep: '#17181D',
    primary: '#2B2E35',
    covert: '#454953',
    wingLine: '#6F7480',
    secondary: '#30333B',
    tail: '#30333B',
    beak: '#26272C',
    beakDeep: '#0E0E10',
    eye: '#1A110E',
    eyeLine: '#C9CEDC',
    leg: '#2E2F35',
    legDeep: '#101014',
    rust: '#B4602E',
    rustDeep: '#6E3416',
    string: '#C9B48A',
    nut: '#9EA3AA',
    nutDeep: '#5C6168',
    cap: '#C0392B',
    capDeep: '#7A1E16',
    brass: '#D2A546',
    brassDeep: '#86621F',
  };

  const SIL = [
    [-140, -160, 0],
    [-176, -204, 0],
    [-156, -266, 0],
    [-84, -322, 0],
    [0, -360, 0.2],
    [34, -404, 0.7],
    [58, -448, 1],
    [102, -476, 1],
    [152, -472, 1],
    [184, -444, 1],
    [190, -412, 1],
    [172, -386, 1],
    [142, -364, 0.6],
    [124, -316, 0.2],
    [114, -244, 0],
    [84, -184, 0],
    [0, -148, 0],
    [-80, -150, 0],
  ];

  // the black hood: head, throat and a bib down the chest (skinned like the outline)
  const HOOD = [
    [16, -360, 0.2],
    [34, -404, 0.7],
    [58, -448, 1],
    [102, -476, 1],
    [152, -472, 1],
    [184, -444, 1],
    [190, -412, 1],
    [172, -386, 1],
    [142, -364, 0.6],
    [126, -316, 0.2],
    [116, -272, 0],
    [84, -262, 0],
    [66, -296, 0],
    [40, -334, 0.1],
  ];

  const WING = {
    fold: [[50, -336], [0, -336], [-80, -306], [-146, -264], [-186, -236], [-204, -220], [-176, -206], [-120, -198], [-40, -214], [20, -250], [60, -296]],
    spread: [[50, -336], [36, -420], [-6, -520], [-70, -580], [-150, -594], [-210, -566], [-190, -520], [-150, -462], [-90, -400], [-24, -356], [54, -318]],
    covert: [[50, -336], [0, -336], [-84, -306], [-70, -270], [-4, -270], [54, -300]],
    covertSpread: [[50, -336], [36, -420], [-6, -520], [-30, -470], [-4, -400], [44, -338]],
    wrist: [-60, -300],
    wristSpread: [-50, -520],
    tips: [3, 4, 5],
    feather: 74,
    trail: [7, 8, 9],
    secLen: 30,
    scallops: [[-150, -252], [-110, -238], [-70, -234], [-30, -246]],
    scallopsSpread: [[-150, -520], [-110, -470], [-70, -420], [-30, -376]],
  };

  const BEAK_TIP = [268, -420];

  function hood(ctx, R, B) {
    const pts = K.smooth(HOOD.map(R.skin), 5);
    K.form(ctx, pts, { fill: C.hood, deep: C.hoodDeep, width: 0, seed: sd('hood'), boil: B, spacing: 8, hatchAlpha: 0.5, c: R.center });
    // the soft edge of the hood: a few ragged strokes where black meets grey
    const edge = [[16, -360, 0.2], [40, -334, 0.1], [66, -296, 0], [84, -262, 0], [116, -272, 0]].map(R.skin);
    K.line(ctx, K.curve(edge, 5), { width: 3, color: C.hoodDeep, alpha: 0.6, seed: sd('hoodEdge'), boil: B });
    for (let k = 0; k < 5; k++) {
      const p = edge[Math.min(edge.length - 1, 1 + Math.floor(k * 0.8))];
      K.line(ctx, [[p[0] - 6 + k * 3, p[1] - 4], [p[0] - 14 + k * 3, p[1] + 16]], { width: 3.4, color: C.hood, seed: sd('fleck', k), boil: B, taper: [2, 6] });
    }
  }

  function face(ctx, R, B) {
    const H = R.Mh;
    // bristles over the base of the beak
    for (let k = 0; k < 4; k++) {
      K.line(ctx, M.all(H, [[172 + k * 5, -446 + k * 4], [196 + k * 6, -448 + k * 5]]), { width: 3, color: C.hoodDeep, seed: sd('bristle', k), boil: B, taper: [2, 5] });
    }
  }

  // a scruffy crown: three feathers that never lie flat
  function crown(ctx, R, B) {
    const H = R.Mh;
    const up = R.pose.fx && R.pose.fx.ruffle ? 1.3 : 1;
    [[92, -470, -0.5, 34], [110, -476, -0.25, 40], [128, -474, 0.05, 30]].forEach(([x, y, a, l], k) => {
      const tip = [x + Math.sin(a) * l * up, y - Math.cos(a) * l * up];
      const f = M.all(H, K.smooth([[x - 9, y + 6], [x - 4, y - l * 0.5], tip, [x + 6, y - l * 0.4], [x + 9, y + 6]], 4));
      K.form(ctx, f, { fill: C.hood, deep: C.hoodDeep, width: 4.5, seed: sd('crown', k), boil: B, shade: 0.3, spacing: 5 });
    });
  }

  function necklace(ctx, R, B) {
    const S = R.skin;
    const str = K.curve([[34, -390, 0.6], [70, -352, 0.4], [106, -328, 0.3], [134, -334, 0.4]].map(S), 5);
    K.line(ctx, str, { width: 6, color: P.ink, seed: sd('string'), boil: B, taper: [2, 2] });
    K.line(ctx, str, { width: 3, color: C.string, seed: sd('string'), boil: B, taper: [2, 2] });
    const sway = R.pose.fx && R.pose.fx.sway != null ? R.pose.fx.sway : 0;
    const hang = (u, len) => {
      const i = Math.floor(u * (str.length - 1));
      const a = str[i];
      return [a, [a[0] + sway * 8, a[1] + len]];
    };
    // the hex nut
    {
      const [a, c] = hang(0.55, 26);
      K.line(ctx, [a, c], { width: 2.4, color: C.string, seed: sd('n1'), boil: B, smooth: false, taper: 0 });
      const hex = [];
      for (let i = 0; i < 6; i++) hex.push([c[0] + Math.cos((i / 6) * K.TAU + 0.3) * 19, c[1] + 15 + Math.sin((i / 6) * K.TAU + 0.3) * 19]);
      K.form(ctx, hex, { fill: C.nut, deep: C.nutDeep, width: 4, seed: sd('nut'), boil: B, shade: 0.7, spacing: 4, hatchW: 1.6 });
      K.fill(ctx, L.ellipsePts(c[0], c[1] + 15, 7, 7, 10), C.hood);
    }
    // the bottle cap
    {
      const [a, c] = hang(0.78, 22);
      K.line(ctx, [a, c], { width: 2.4, color: C.string, seed: sd('n2'), boil: B, smooth: false, taper: 0 });
      const cap = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 16 : 20;
        cap.push([c[0] + Math.cos((i / 16) * K.TAU) * r, c[1] + 18 + Math.sin((i / 16) * K.TAU) * r * 0.9]);
      }
      K.form(ctx, cap, { fill: C.cap, deep: C.capDeep, width: 3.6, seed: sd('cap'), boil: B, shade: 0.6, spacing: 4, hatchW: 1.6 });
      K.fill(ctx, L.ellipsePts(c[0] - 4, c[1] + 9, 4, 3, 8), '#FFD9CF', 0.9);
    }
    // the brass button
    {
      const [a, c] = hang(0.97, 18);
      K.line(ctx, [a, c], { width: 2.4, color: C.string, seed: sd('n3'), boil: B, smooth: false, taper: 0 });
      K.plate(ctx, L.ellipsePts(c[0], c[1] + 14, 14, 14, 14), { fill: C.brass, deep: C.brassDeep, width: 3.4, seed: sd('btn'), boil: B });
      K.fill(ctx, L.ellipsePts(c[0] - 3, c[1] + 9, 2.4, 2.4, 6), C.brassDeep);
      K.fill(ctx, L.ellipsePts(c[0] + 3, c[1] + 13, 2.4, 2.4, 6), C.brassDeep);
    }
  }

  // where the beak tip lands in the peck of the work loop: the token lies there
  let peckAt = null;
  function tokenSpot(R) {
    if (!peckAt) {
      const pose = K.pose(K.kits.bird.REST, WORK[2]);
      const R2 = K.kits.bird.rig(R.S, pose);
      const tip = M.ap(R2.Mh, BEAK_TIP);
      peckAt = [tip[0] + 6, K.GROUND - 18];
    }
    return peckAt;
  }

  const WORK = [
    { head: 0.5, hx: -6, eyeMode: 'open', fx: { glint: 1, ground: 1 } },
    { x: 40, y: -60, sq: 1.05, wing: 0.3, head: 0.2, tail: -0.15, fx: { glint: 0.6, ground: 1, sway: 1 } },
    { x: 90, lean: 0.34, head: 0.72, hy: 16, beak: 0.5, sq: 0.94, fx: { ground: 1, sway: 1 } },
    { x: 90, head: -0.2, beak: 0.25, fx: { item: 'beak', sway: 0.6 } },
    { x: 90, head: -0.5, beak: 0.7, sq: 1.04, fx: { item: 'air', h: 150, spin: 0.25, sway: -0.6 } },
    { x: 90, head: -0.42, beak: 0.7, fx: { item: 'air', h: 70, spin: 0.7 } },
    { x: 90, head: -0.1, beak: 0.2, sq: 1.06, eyeMode: 'happy', fx: { item: 'beak', star: 1, ruffle: 1 } },
    { x: 90, head: -0.06, beak: 0.2, sq: 1.04, fx: { item: 'beak', ruffle: 1 } },
  ];

  K.kits.bird.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [70, -400],
    headScale: 1.3,
    bodyC: [-10, -250],
    bodyR: 180,
    gait: 'hop',
    feet: { n: 36, f: 0 },
    wing: WING,
    tailFan: { base: [-160, -196], angle: Math.PI + 0.35, spread: 0.3, n: 5, len: 132, width: 18, taper: 0.08, fill: () => C.tail },
    sit: 30,
    leg: { hipN: [30, -150], hipF: [0, -154], l1: 38, l2: 82, r: 8, toe: 40, thighR: 2.6 },
    tufts: false,
    fur: true,
    beak: { hinge: [184, -432], tip: BEAK_TIP, upper: [[178, -452], [214, -454], [250, -440], [272, -418], [250, -421], [182, -420]], lower: [[180, -422], [226, -419], [252, -416], [224, -408], [182, -408]], nostril: [204, -440] },
    face: { eye: { x: 146, y: -440, r: 15, style: 'iris', white: '#E6E3DC', iris: '#3B2A22', lid: 0.34, lidColor: C.hood } },
    hooks: {
      body: hood,
      face,
      front: necklace,
      head: crown,
      legAfter(ctx, R, B, side, knee, f) {
        if (side !== 'n') return;
        const c = [knee[0] + (f[0] - knee[0]) * 0.45, knee[1] + (f[1] - knee[1]) * 0.45];
        const ring = L.rrectPts(c[0] - 13, c[1] - 9, 26, 18, 5, 4);
        K.form(ctx, ring, { fill: C.rust, deep: C.rustDeep, width: 3.6, seed: sd('ring'), boil: B, shade: 0.6, spacing: 4, hatchW: 1.6 });
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx) return;
        const spot = tokenSpot(R);
        if (fx.ground) K.fx.token(ctx, spot[0], spot[1] - 6, 24, 0.12, B, sd('tokG'));
        if (fx.glint) K.fx.star(ctx, spot[0] + 18, spot[1] - 26, 30 * fx.glint, B, sd('glint'), '#FFF1C4');
        const tip = M.ap(R.Mh, BEAK_TIP);
        if (fx.item === 'beak') K.fx.token(ctx, tip[0] - 2, tip[1] + 14, 24, 0.1, B, sd('tokB'));
        if (fx.item === 'air') K.fx.token(ctx, tip[0] + 10, tip[1] - fx.h, 26, fx.spin, B, sd('tokA'));
        if (fx.star) {
          K.fx.star(ctx, tip[0] + 40, tip[1] - 34, 28 * fx.star, B, sd('s1'), '#FFF1C4');
          K.fx.star(ctx, tip[0] - 20, tip[1] - 60, 18 * fx.star, B, sd('s2'), '#FFF1C4');
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
      // a glint, a hop, a peck, the toss, the catch
      work(d, n, P0) {
        return Object.assign({ feet: P0.idle(0, 12).feet }, WORK[d], d === 1 ? { feet: { n: { x: 46, lift: 18 }, f: { x: 10, lift: 18 } } } : {});
      },
    },
  });
})();
