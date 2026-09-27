// pets/31-crow.js : Ворона-барахольщица (uncommon, token). Front kit, a bird standing square.
// A hooded crow: an ash-grey body with a black hood, a black bib under the beak, black wings and
// tail, a heavy black beak with bristles at its base, a shrewd pale eye under a low lid, a scruffy
// crest. Round her neck, a string of shiny junk: a hex nut, a red bottle cap, a brass button and a
// shard of glass; a rusty ring on her leg. Work: spots a glint on the floor, hops over, pecks up a
// camp token, tosses it, catches it in her beak and hugs it — mine.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const F = () => K.front;
  const ID = 'crow';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#34302F',
    furDeep: '#141212',
    furLit: '#5E5856',
    grey: '#A09C96',
    greyLit: '#C4C0B8',
    belly: '#B6B2AA',
    wing: '#2E2A2A',
    primary: '#1E1B1B',
    secondary: '#282424',
    wingLine: '#6A6464',
    tail: '#2A2626',
    leg: '#2A2626',
    beak: '#5A5452',
    beakLow: '#46403E',
    beakDeep: '#2A2626',
    eyeLine: '#E6E0D8',
    blush: '#D88A8A',
    mouth: '#5E2A2A',
    string: '#B89A6A',
    steel: '#B8BEC3',
    steelDeep: '#6E767C',
    cap: '#C0392B',
    capDeep: '#7A2019',
    brass: '#D2A64E',
    brassDeep: '#8A6424',
    glass: '#9FD0DE',
    rust: '#A0582E',
  };

  function greyBody(c2, R, B) {
    const T = R.Mb;
    // the grey of the body under the black hood, and the black bib down the throat
    K.fill(c2, M.all(T, K.smooth(K.sym([[0, -390], [110, -392], [180, -340], [204, -200], [190, -90], [140, -40], [0, -30]]), 4)), C.grey);
    K.fill(c2, M.all(T, K.smooth([[-96, -410], [96, -410], [70, -330], [26, -240], [0, -216], [-26, -240], [-70, -330]], 4)), C.fur);
    L.hatch(c2, M.all(T, L.ellipsePts(0, -170, 150, 120, 24)), { angle: 0.4, spacing: 12, width: 2, color: C.greyLit, alpha: 0.5, clip: true, seed: sd('gf'), boil: B });
  }

  function necklace(ctx, R, B) {
    const T = R.Mb;
    const line = M.all(T, K.curve([[-150, -366], [-90, -318], [0, -296], [90, -318], [150, -366]], 6));
    K.line(ctx, line, { width: 6, color: P.ink, seed: sd('str'), boil: B, taper: 0 });
    K.line(ctx, line, { width: 3, color: C.string, seed: sd('str'), boil: B, taper: 0 });
    const at = (u) => line[Math.floor(u * (line.length - 1))];
    // a hex nut
    const n = at(0.24);
    const hex = [];
    for (let k = 0; k < 6; k++) hex.push([n[0] + Math.cos((k / 6) * Math.PI * 2) * 22, n[1] + 18 + Math.sin((k / 6) * Math.PI * 2) * 22]);
    F().form(ctx, hex, C.steel, B, sd('nut'), { width: 4, off: 0.12, shine: 0.8, hatch: 0.3, smooth: false });
    K.fill(ctx, L.ellipsePts(n[0], n[1] + 18, 9, 9, 12), '#2A2626');
    // a red bottle cap with a crimped edge
    const c = at(0.44);
    const cap = [];
    for (let k = 0; k < 20; k++) cap.push([c[0] + Math.cos((k / 20) * Math.PI * 2) * (k % 2 ? 22 : 26), c[1] + 26 + Math.sin((k / 20) * Math.PI * 2) * (k % 2 ? 22 : 26)]);
    F().form(ctx, cap, C.cap, B, sd('cap'), { width: 4, off: 0.12, shine: 0.9, hatch: 0.3, smooth: false, dark: C.capDeep });
    // a brass button with four holes
    const b = at(0.62);
    F().form(ctx, L.ellipsePts(b[0], b[1] + 20, 20, 20, 18), C.brass, B, sd('btn'), { width: 4, off: 0.12, shine: 0.9, hatch: 0.3, dark: C.brassDeep });
    for (const [x, y] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) K.fill(ctx, L.ellipsePts(b[0] + x, b[1] + 20 + y, 3, 3, 6), C.brassDeep);
    // a shard of glass
    const g = at(0.8);
    const sh = [[g[0] - 12, g[1] + 6], [g[0] + 16, g[1] + 2], [g[0] + 6, g[1] + 50]];
    K.fill(ctx, sh, C.glass, 0.85);
    K.fill(ctx, [[g[0] - 4, g[1] + 10], [g[0] + 6, g[1] + 9], [g[0] + 2, g[1] + 30]], '#FFFFFF', 0.8);
    L.inkPath(ctx, sh, { closed: true, width: 3.4, seed: sd('glass'), boil: B, smooth: false, taper: 0 });
    if (R.pose.fx && R.pose.fx.shine) K.fx.star(ctx, g[0] + 26, g[1] + 6, 26, B, sd('gs'), '#FFF1C4');
  }

  function bristles(ctx, R, B) {
    const T = R.Mh;
    for (const s of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const a = R.hl(s * (22 + k * 6), 18 + k * 5, 1.05);
        K.line(ctx, M.all(T, [a, [a[0] + s * 26, a[1] - 8 + k * 6]]), { width: 2.6, color: '#1A1616', seed: sd('br', s, k), boil: B, taper: [2, 5] });
      }
  }

  const WORK = [
    { turn: 0.45, look: [0.8, 0.9], nod: 0.4, lid: 0.3, fx: { ground: 1, glint: 1 } },
    { x: 70, y: -60, wing: 0.45, leg: { l: 30, r: 30 }, turn: 0.3, look: [0.6, 0.9], nod: 0.3, fx: { ground: 1 } },
    { x: 130, sq: 0.9, hy: 70, nod: 1, lean: 0.12, fx: { beak: 1 } },
    { x: 120, turn: 0.2, lid: 0.4, fx: { beak: 1 } },
    { x: 110, look: [0, -0.9], nod: -0.6, wing: 0.2, fx: { air: 1 } },
    { x: 100, nod: -0.2, lid: 0.3, fx: { beak: 1 } },
    { x: 80, hold: 1, eye: 'happy', fx: { chest: 1, shine: 1 } },
    { x: 30, lid: 0.35, fx: {} },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'bird',
    bodyC: [0, -200],
    bodyR: 250,
    body: { half: [[0, -390], [96, -380], [156, -330], [184, -236], [180, -140], [146, -74], [72, -46], [0, -40]], fill: C.fur },
    belly: { half: [[0, -250], [60, -240], [100, -196], [110, -140], [92, -90], [46, -62], [0, -56]] },
    wings: {
      fold: [[96, -330], [160, -320], [196, -240], [198, -150], [168, -100], [130, -126], [104, -220]],
      hold: [[96, -330], [162, -316], [196, -256], [180, -200], [120, -190], [104, -226], [98, -276]],
      spread: [[96, -330], [196, -392], [300, -430], [352, -380], [340, -310], [248, -280], [132, -260]],
      root: [100, -290],
      holdRoot: [150, -290],
      tip: 4,
      n: 7,
      feather: 130,
      fw: 20,
      rows: [[[112, -296], [148, -286], [178, -262]], [[108, -256], [146, -242], [184, -220]]],
      rowsSpread: [[[150, -350], [230, -380], [306, -402]], [[150, -310], [234, -340], [314, -360]]],
    },
    feet: { at: [54, -50], r: 9, toe: 36, claw: '#1A1616' },
    fan: { base: [0, -110], n: 5, spread: 1.2, len: 190, width: 24 },
    head: { c: [0, -522], rx: 152, ry: 136, fill: '#433E3D', tufts: [[0.67, 0.83, 40]] },
    beak: { y: 34, w: 36, h: 66 },
    face: {
      eyes: { x: 68, y: -14, rx: 30, ry: 32, white: '#F4F2EC', iris: '#9AB4C0', irisR: 0.7, lid: 0.34, lidColor: C.fur, lash: true },
      blush: [108, 40, 20],
    },
    fur: false,
    shadowW: 210,
    attack: 'peck',
    hooks: {
      body: greyBody,
      skin(c2, R, B, pts) {
        // feathers on the crown catching the light
        L.hatch(c2, pts, { angle: -1.3, spacing: 14, length: [10, 18], gap: [10, 22], width: 2.6, color: '#7A7270', alpha: 0.8, density: (x, y) => Math.max(0, 0.9 - K.shadeOf(R.center)(x, y) * 1.2), clip: true, inset: 8, overshoot: 0, seed: sd('hf'), boil: B });
      },
      front: necklace,
      face: bristles,
      foot(ctx, R, B, side, f) {
        if (side < 0) return;
        const c = [f[0], f[1] - 44];
        K.fill(ctx, L.rrectPts(c[0] - 14, c[1] - 8, 28, 16, 5, 3), C.rust);
        L.inkPath(ctx, L.rrectPts(c[0] - 14, c[1] - 8, 28, 16, 5, 3), { closed: true, width: 3, seed: sd('ring'), boil: B, taper: 0 });
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        const spot = [K.CXF + 180, K.GROUND - 16];
        if (fx.ground) K.fx.token(ctx, spot[0], spot[1] - 6, 22, 0.25, B, sd('tokG'));
        if (fx.glint) K.fx.star(ctx, spot[0] + 24, spot[1] - 40, 30, B, sd('gl'), '#FFF1C4');
        const tip = R.hp(0, R.S.beak.y + R.S.beak.h * 0.6, 1.1);
        if (fx.beak) K.fx.token(ctx, tip[0], tip[1] + 6, 22, 0.1, B, sd('tokB'));
        if (fx.air) {
          const t = R.hp(0, -R.S.head.ry, 0);
          K.fx.token(ctx, t[0] + 20, t[1] - 60, 24, 0.3, B, sd('tokA'));
          K.fx.star(ctx, t[0] + 70, t[1] - 90, 26, B, sd('as'), '#FFF1C4');
        }
        if (fx.chest) {
          const a = R.wingTip ? R.wingTip[-1] : M.ap(R.Mb, [-120, -190]);
          const b = R.wingTip ? R.wingTip[1] : M.ap(R.Mb, [120, -190]);
          K.fx.token(ctx, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 20, 30, 0.05, B, sd('tokC'));
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { x: T.x || 0, y: T.y || 0, sq: T.sq || 1, hy: T.hy || 0, lean: T.lean || 0, turn: T.turn || 0, look: T.look || null, nod: T.nod || 0, lid: T.lid == null ? null : T.lid, wing: T.wing || 0, leg: T.leg || { l: 0, r: 0 }, hold: !!T.hold, eyeMode: T.eye || 'open', fx: T.fx };
      },
    },
  });
})();
