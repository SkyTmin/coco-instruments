// pets/24-fox.js : Лис-картёжник (epic, sell). Front kit, sits with his brush round his paws.
// A red fox sitting up: tall ears with black backs and cream fluff inside, white cheeks flaring out
// below sly amber eyes (slit pupils, lids half down), a white chest, black socks, a big brush of a
// tail wrapped round his feet with a white tip. A burgundy waistcoat with brass buttons and a gold
// watch chain, the ace of hearts tucked behind his right ear. Work: the shell game — a crate, three
// cups, a coin under one; he shuffles, stops, lifts a cup: a pile of coins. And a wink.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'fox';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#D46A2E',
    furDeep: '#8C3D17',
    furLit: '#F19B5C',
    belly: '#F6EEE2',
    muzzle: '#E57C3E',
    white: '#F6EEE2',
    black: '#2E2420',
    sock: '#2E2420',
    paw: '#2E2420',
    hindPaw: '#2E2420',
    pad: '#6A4A44',
    earIn: '#F2E2CA',
    skin: '#E0A08E',
    nose: '#221C1A',
    blush: '#E8806A',
    mouth: '#5E2220',
    tongue: '#E88E86',
    vest: '#6B2A38',
    vestDeep: '#3E1520',
    vestLit: '#8E4252',
    gold: '#E2B54A',
    goldDeep: '#96701E',
    card: '#FBF6EA',
    red: '#C0392B',
    wood: '#A87A4C',
    woodDeep: '#6A4A2A',
    woodLit: '#C89A66',
    tin: '#C7C1B4',
    tinDeep: '#7E786C',
  };

  // ---- the face: white cheeks flaring out under the eyes
  function cheeks(c2, R) {
    const T = R.Mh;
    for (const s of [-1, 1]) K.fill(c2, M.all(T, K.smooth([R.hl(s * 26, 24, 1), R.hl(s * 90, 0, 0.8), R.hl(s * 150, 14, 0.5), R.hl(s * 200, 40, 0.2), R.hl(s * 150, 96, 0.4), R.hl(s * 80, 130, 0.7), R.hl(s * 20, 140, 0.9)], 4)), C.white);
    // a darker streak from the inner corner of each eye down the side of the muzzle
    for (const s of [-1, 1]) K.fill(c2, M.all(T, K.smooth([R.hl(s * 34, -8, 0.95), R.hl(s * 44, 6, 0.95), R.hl(s * 36, 36, 0.95), R.hl(s * 26, 30, 0.95)], 3)), C.furDeep, 0.7);
  }

  function ruff(ctx, R, B, pts) {
    // white tufts sticking out of the cheeks
    F().tufts(ctx, pts, 0.22, 0.34, C.white, B, sd('rufR'), 26);
    F().tufts(ctx, pts, 0.66, 0.78, C.white, B, sd('rufL'), 26);
  }

  // ---- the waistcoat (inside the body), the chain
  function vest(c2, R, B) {
    const T = R.Mb;
    for (const s of [-1, 1]) {
      const pts = M.all(T, K.smooth([[s * 60, -334], [s * 140, -316], [s * 190, -220], [s * 190, -90], [s * 110, -70], [s * 4, -52], [s * 10, -130], [s * 30, -220]], 3));
      K.fill(c2, pts, C.vest);
      L.hatch(c2, pts, { angle: 0.9, spacing: 9, width: 1.6, color: C.vestDeep, alpha: 0.45, clip: true, seed: sd('weave', s), boil: B });
      L.inkPath(c2, pts, { closed: true, width: 5, seed: sd('vest', s), boil: B, wobble: 0.5 });
      // a welt pocket
      K.line(c2, M.all(T, [[s * 80, -150], [s * 150, -156]]), { width: 7, color: C.vestDeep, seed: sd('pock', s), boil: B, taper: 0 });
      K.line(c2, M.all(T, K.curve([[s * 60, -330], [s * 40, -250], [s * 20, -200]], 4)), { width: 4, color: C.vestLit, alpha: 0.8, seed: sd('lap', s), boil: B });
    }
    for (let k = 0; k < 3; k++) {
      const b = M.ap(T, [16, -190 + k * 42]);
      F().form(c2, L.ellipsePts(b[0], b[1], 9, 9, 10), C.gold, B, sd('btn', k), { width: 2.8, off: 0.14, shine: 1, hatch: 0, rim: false });
    }
    // the gold watch chain from a buttonhole to the left pocket, and the fob hanging
    const ch = M.all(T, [[16, -148], [-40, -118], [-104, -150]]);
    K.chain(c2, ch, 12, { width: 5, color: C.gold, seed: sd('wch'), boil: B });
    const f = M.ap(T, [-60, -104]);
    F().form(c2, L.ellipsePts(f[0], f[1], 10, 12, 10), C.gold, B, sd('fob'), { width: 2.8, off: 0.14, shine: 1, hatch: 0, rim: false });
  }

  function card(ctx, c, a, s, B, seed) {
    const T = M.chain(M.tr(c[0], c[1]), M.rot(a), M.sc(s, s));
    const r = M.all(T, L.rrectPts(-28, -40, 56, 80, 7, 4));
    F().form(ctx, r, C.card, B, seed, { width: 4, off: 0.08, hatch: 0.2, rim: false });
    // an A in the corner and a heart in the middle
    K.line(ctx, M.all(T, [[-22, -18], [-16, -34], [-10, -18]]), { width: 3, color: C.red, seed: seed + 1, boil: B, smooth: false, taper: 0 });
    K.line(ctx, M.all(T, [[-19, -24], [-13, -24]]), { width: 2.4, color: C.red, seed: seed + 2, boil: B, smooth: false, taper: 0 });
    const h = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      h.push([16 * Math.sin(t) ** 3 * 0.9, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.9 + 4]);
    }
    K.fill(ctx, M.all(T, h), C.red);
  }

  function aceBehindEar(ctx, R, B) {
    const c = R.hp(168, -150, 0.3);
    card(ctx, c, 0.62 + R.pose.head, 1.3, B, sd('ace'));
  }

  // ---- the brush wrapped round his feet
  function tailWrap(ctx, R, B) {
    const T = R.Mr;
    const sway = R.pose.tail * 30;
    const c = M.all(T, K.curve([[196, -86], [214, -30], [160, 4], [40, 16], [-90, 12], [-190, -8], [-236 + sway * 0.4, -60], [-222 + sway, -104]], 6));
    const w = (u) => (70 + 30 * Math.sin(Math.PI * Math.min(1, u * 1.2))) * (u > 0.9 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.9) / 0.1) ** 2)) : 1);
    const rib = K.ribbonPts(c, w);
    F().form(ctx, rib, C.fur, B, sd('tail'), {
      width: 8,
      off: 0.05,
      inside(c2) {
        const k0 = Math.floor(c.length * 0.72);
        K.fill(c2, K.ribbonPts(c.slice(k0), (u) => w(0.72 + u * 0.28) * 1.3), C.white);
        F().fur(c2, rib, R, B, sd('tfur'), C.furLit, C.furDeep, 1.3);
      },
    });
    F().tufts(ctx, rib, 0.5, 0.6, C.white, B, sd('ttuft'), 20);
  }

  // ---- the shell game
  function crate(ctx, B) {
    const g = K.GROUND, x0 = K.CXF - 240, x1 = K.CXF + 240, top = g - 100;
    const lid = [[x0, top], [x0 + 24, top - 20], [x1 - 24, top - 20], [x1, top]];
    const front = [[x0, g], [x0, top], [x1, top], [x1, g]];
    F().form(ctx, lid, C.woodLit, B, sd('lid'), { width: 6, off: 0.1, hatch: 0.2, rim: false, smooth: false });
    F().form(ctx, front, C.wood, B, sd('crate'), {
      width: 7,
      off: 0.06,
      hatch: 0.5,
      smooth: false,
      inside(c2) {
        for (const y of [top + 50]) K.line(c2, [[x0, y], [x1, y]], { width: 4, color: C.woodDeep, seed: sd('pl', y), boil: B, smooth: false, taper: 0 });
        for (const x of [x0 + 22, x1 - 22]) K.line(c2, [[x, top + 4], [x, g - 4]], { width: 26, color: C.woodDeep, alpha: 0.45, seed: sd('post', x), boil: B, smooth: false, taper: 0 });
        L.hatch(c2, front, { angle: 0.02, spacing: 12, width: 1.6, color: C.woodDeep, alpha: 0.4, length: [30, 90], gap: [10, 30], clip: true, seed: sd('grain'), boil: B });
        for (const [x, y] of [[x0 + 22, top + 25], [x1 - 22, top + 25], [x0 + 22, top + 75], [x1 - 22, top + 75]]) K.fill(c2, L.ellipsePts(x, y, 4, 4, 8), '#3A2A1A');
      },
    });
    return top - 12;
  }

  function cup(ctx, x, base, up, B, seed) {
    const y = base - up;
    const pts = [[x - 38, y], [x - 27, y - 72], [x + 27, y - 72], [x + 38, y]];
    F().form(ctx, K.smooth(pts, 3), C.tin, B, seed, {
      width: 5,
      off: 0.1,
      shine: 0.8,
      hatch: 0.4,
      dark: C.tinDeep,
      inside(c2) {
        for (const h of [14, 58]) K.line(c2, [[x - 38 + h * 0.15, y - h], [x + 38 - h * 0.15, y - h]], { width: 3, color: C.tinDeep, seed: seed + h, boil: B, smooth: false, taper: 0 });
      },
    });
    K.fill(ctx, L.ellipsePts(x, y - 72, 27, 7, 14), C.tinDeep);
  }

  // cups: x of each cup (by rest place: 0 left, 1 middle, 2 right), up = which one is lifted, reach =
  // where the paws are (on the ground frame): on a cup top at y -186, on a lifted one at -236
  const T0 = -186, TU = -238;
  const WORK = [
    { cups: [-150, 0, 150], up: 2, coin: 1, reach: { l: [-150, T0], r: [150, TU] }, lid: 0.3, look: [0, 0.2] },
    { cups: [-96, -30, 150], blur: 1, reach: { l: [-96, T0], r: [150, T0] }, lid: 0.4, look: [-0.3, 0.5] },
    { cups: [-150, 140, 20], blur: -1, reach: { l: [-150, T0], r: [140, T0] }, lid: 0.4, look: [0.3, 0.5] },
    { cups: [140, -140, 0], blur: 1, reach: { l: [-140, T0], r: [140, T0] }, eye: 'closed' },
    { cups: [-150, 0, 150], reach: { l: [-176, -226], r: [176, -226] }, turn: 0.2, look: [0, 0], lid: 0.1, mouth: 0.35 },
    { cups: [-150, 0, 150], up: 0, pile: 1, reach: { l: [-150, TU], r: [150, T0] }, look: [-0.3, 0.6], mouth: 0.6 },
    { cups: [-150, 0, 150], up: 0, pile: 1, star: 1, reach: { l: [-150, TU], r: [150, T0] }, eyeR: 'happy', lid: 0.35, mouth: 0.5 },
    { cups: [-150, 0, 150], reach: { l: [-150, T0], r: [150, T0] }, lid: 0.35 },
  ];

  function shellGame(ctx, R, B, side, end) {
    const fx = R.pose.fx || {};
    if (!fx.cups) return;
    if (side < 0) {
      const base = K.GROUND - 110;
      fx.cups.forEach((x, i) => {
        const cx = K.CXF + x;
        const up = fx.up === (x < -60 ? 0 : x > 60 ? 2 : 1) ? 52 : 0;
        if (up && fx.coin) K.fx.coin(ctx, cx, base - 22, 22, 0.05, B, sd('coin'));
        if (up && fx.pile) {
          for (let k = 0; k < 6; k++) K.fx.coin(ctx, cx - 30 + (k % 3) * 30, base - 12 - Math.floor(k / 3) * 22, 20, 0.05 + k * 0.02, B, sd('pile', k));
          if (fx.star) K.fx.star(ctx, cx + 36, base - 70, 40, B, sd('pstar'), '#FFF1C4');
        }
        cup(ctx, cx, base, up, B, sd('cup', i));
        if (fx.blur && i !== 2) for (let k = 0; k < 3; k++) K.line(ctx, [[cx - fx.blur * (50 + k * 6), base - 20 - k * 24], [cx - fx.blur * (120 + k * 10), base - 20 - k * 24]], { width: 4, color: P.inkSoft, seed: sd('bl', i, k), boil: B, smooth: false, taper: [3, 12] });
      });
    }
    // the paw again, on top of the cups
    const G = R.S.sit.front;
    F().paw(ctx, [end[0], end[1] + 4], G.paw[0], G.paw[1], 0, C.paw, B, sd('fpaw2', side), {});
  }

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'sit',
    bodyC: [0, -190],
    bodyR: 250,
    body: { half: [[0, -340], [80, -332], [132, -290], [160, -210], [172, -120], [166, -44], [128, -14], [0, -10]] },
    belly: { half: [[0, -340], [56, -334], [84, -290], [90, -200], [74, -110], [40, -60], [0, -50]] },
    sit: {
      thigh: [140, -80, 70, 72],
      hind: [168, 0, 40, 22],
      front: { at: [88, -252], len: 238, r: 31, paw: [36, 23], splay: 0.04, sock: 0.6 },
    },
    head: { c: [0, -498], rx: 172, ry: 148, half: [[0, -140], [86, -134], [140, -100], [168, -40], [180, 20], [160, 66], [112, 104], [58, 134], [0, 148]] },
    ears: {
      at: [104, -110],
      pts: [[-58, 24], [-30, -100], [-6, -168], [14, -162], [36, -100], [58, 20]],
      inner: [[-36, 14], [-16, -90], [-4, -136], [8, -94], [34, 12]],
      fill: C.fur,
      innerFill: C.earIn,
      tilt: 0.26,
      flop: 0.45,
    },
    face: {
      eyes: { x: 72, y: -16, rx: 30, ry: 30, white: '#FFF8E6', iris: '#E09A2C', irisR: 0.86, slit: true, lid: 0.34, lidColor: C.fur, tilt: -0.14, lash: true },
      muzzle: { half: [[0, -30], [30, -26], [44, 12], [36, 50], [18, 70], [0, 74]] },
      nose: { y: 60, w: 24, h: 17 },
      mouth: { y: 88, w: 22, drop: 12, h: 30, style: 'cat', fangs: 12 },
      whiskers: { x: 40, y: 74, len: 100 },
      blush: [108, 44, 22],
    },
    shadowW: 280,
    attack: 'bite',
    hooks: {
      skin: cheeks,
      body: vest,
      front(ctx, R, B) {
        aceBehindEar(ctx, R, B);
        tailWrap(ctx, R, B);
        if (R.pose.fx && R.pose.fx.cups) crate(ctx, B);
      },
      head: ruff,
      ear(c2, R, B, side, T) {
        // black on the back of the ear shows as a dark tip
        K.fill(c2, M.all(T, K.smooth([[-30, -96], [-8, -176], [18, -170], [38, -96], [4, -118]], 3).map(([x, y]) => [x * side, y])), C.black);
      },
      hand(ctx, R, B, side, end) {
        shellGame(ctx, R, B, side, end);
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { reach: T.reach, lid: T.lid == null ? null : T.lid, look: T.look || null, eyeMode: T.eye || 'open', eyeR: T.eyeR || null, turn: T.turn || 0, mouth: T.mouth || 0, fx: { cups: T.cups, up: T.up, coin: T.coin, pile: T.pile, blur: T.blur, star: T.star } };
      },
    },
  });
})();
