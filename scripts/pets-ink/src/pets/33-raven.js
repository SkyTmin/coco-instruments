// pets/33-raven.js : Ворон-ключник (legendary, luck + token). Front kit, a big bird facing us.
// A big raven, glossy blue-black with a violet and blue sheen, shaggy hackles hanging from his
// throat, a heavy dark beak with bristles over its base, a scruffy crest, a gold eye behind a
// gold-rimmed monocle on a chain. A ring of keys on a cord across his chest (iron, brass, one of
// gold), gold rings on his leg, a long wedge of a tail. Work: a padlock on the floor; he raises a
// key, hops over, turns it — the shackle springs and a token and a coin jump out.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'raven';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#34303E',
    furDeep: '#15131A',
    furLit: '#5A5470',
    belly: '#2E2A38',
    sheenB: '#7A8CD0',
    sheenV: '#9A76C8',
    wing: '#2C2834',
    primary: '#1C1A22',
    secondary: '#24212C',
    wingLine: '#6A6488',
    tail: '#221F2A',
    leg: '#26232C',
    beak: '#57525E',
    beakLow: '#46424E',
    beakDeep: '#1E1C22',
    eyeLine: '#E6E0F0',
    blush: '#C87A9A',
    mouth: '#5E2A3A',
    gold: '#E8B830',
    goldDeep: '#9A7418',
    iron: '#8E949A',
    ironDeep: '#4E5458',
    brass: '#C89A4E',
    brassDeep: '#7E5E24',
    cord: '#7A2A2A',
    glass: '#DDEFF4',
  };

  function sheen(c2, pts, R, B, seed, k = 1) {
    // a glossy sheen: blue and violet strokes over the lit side of the black
    const f = K.shadeOf(R.center);
    L.hatch(c2, pts, { angle: -1.2, spacing: 13 / k, length: [12, 24], gap: [10, 20], width: 3, color: C.sheenB, alpha: 0.7, density: (x, y) => Math.max(0, 0.95 - 1.3 * f(x, y)), clip: true, inset: 8, overshoot: 0, seed, boil: B });
    L.hatch(c2, pts, { angle: -1.7, spacing: 16 / k, length: [10, 20], gap: [12, 24], width: 2.6, color: C.sheenV, alpha: 0.6, density: (x, y) => Math.max(0, 0.7 - 1.2 * f(x, y)), clip: true, inset: 8, overshoot: 0, seed: seed + 3, boil: B });
  }

  /** A pointed hackle feather hanging from base toward tip. */
  function hackle(ctx, base, tip, w, B, seed) {
    const dx = tip[0] - base[0], dy = tip[1] - base[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const pts = K.smooth([[base[0] - nx * w, base[1] - ny * w], [base[0] + dx * 0.6 - nx * w * 0.6, base[1] + dy * 0.6 - ny * w * 0.6], tip, [base[0] + dx * 0.6 + nx * w * 0.6, base[1] + dy * 0.6 + ny * w * 0.6], [base[0] + nx * w, base[1] + ny * w]], 4);
    F().form(ctx, pts, C.fur, B, seed, { width: 4, off: 0.1, hatch: 0.3, rim: false, inside: (c2) => K.line(c2, [[base[0] + dx * 0.2, base[1] + dy * 0.2], [base[0] + dx * 0.8, base[1] + dy * 0.8]], { width: 2.4, color: C.sheenB, alpha: 0.8, seed: seed + 1, boil: B, taper: [2, 4] }) });
  }

  function throat(ctx, R, B) {
    // shaggy hackles hanging from under the beak over the chest
    for (let i = 0; i < 7; i++) {
      const u = i / 6 - 0.5;
      const b = R.hp(u * 150, 118 - Math.abs(u) * 30, 0.8);
      hackle(ctx, b, [b[0] + u * 30, b[1] + 70 + 20 * (1 - Math.abs(u) * 2)], 16, B, sd('hk', i));
    }
    // bristles over the base of the beak
    const T = R.Mh;
    for (const s of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const a = R.hl(s * (14 + k * 7), 16 + k * 4, 1.08);
        K.line(ctx, M.all(T, [a, [a[0] + s * 8, a[1] + 22]]), { width: 4, color: C.furDeep, seed: sd('br', s, k), boil: B, taper: [3, 5] });
      }
  }

  function monocle(ctx, R, B) {
    const T = R.Mh;
    const c = R.hl(70, -8, 0.9);
    const ring = M.all(T, L.ellipsePts(c[0], c[1], 52, 54, 26));
    K.fill(ctx, ring, C.glass, 0.25);
    K.fill(ctx, M.all(T, L.ellipsePts(c[0] - 20, c[1] - 22, 14, 8, 12, -0.6)), '#FFFFFF', 0.55);
    L.inkPath(ctx, ring, { closed: true, width: 13, color: P.ink, seed: sd('mon'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, ring, { closed: true, width: 7, color: C.gold, seed: sd('mon'), boil: B, wobble: 0.3 });
    // its chain down to the key ring
    const a = M.ap(T, [c[0] + 30, c[1] + 44]);
    const b = M.ap(R.Mb, [40, -250]);
    K.chain(ctx, [a, [lerp(a[0], b[0], 0.5) + 30, lerp(a[1], b[1], 0.5)], b], 11, { width: 4.5, color: C.gold, seed: sd('mch'), boil: B });
  }

  function keyRing(ctx, R, B) {
    const T = R.Mb;
    const cord = M.all(T, K.curve([[-150, -370], [-70, -300], [0, -266], [70, -300], [150, -370]], 6));
    K.line(ctx, cord, { width: 9, color: P.ink, seed: sd('cord'), boil: B, taper: 0 });
    K.line(ctx, cord, { width: 5, color: C.cord, seed: sd('cord'), boil: B, taper: 0 });
    const c = M.ap(T, [0, -236]);
    const hide = R.pose.fx && R.pose.fx.keyOut;
    const keys = [[-0.5, C.iron, C.ironDeep], [-0.15, C.brass, C.brassDeep], [0.2, C.iron, C.ironDeep], [0.55, C.gold, C.goldDeep]];
    keys.forEach(([a, fill, deep], i) => {
      if (hide && i === 3) return;
      const sw = Math.sin(R.pose.tail * 3 + i) * 0.08;
      K.key(ctx, c[0] + Math.sin(a) * 34, c[1] + Math.cos(a) * 34, Math.PI / 2 - a * 1.2 + sw, 0.75, fill, deep, B, sd('key', i));
    });
    L.inkPath(ctx, L.ellipsePts(c[0], c[1], 34, 34, 24), { closed: true, width: 13, color: P.ink, seed: sd('ring'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, L.ellipsePts(c[0], c[1], 34, 34, 24), { closed: true, width: 7, color: C.iron, seed: sd('ring'), boil: B, wobble: 0.3 });
  }

  function padlock(ctx, c, open, B) {
    const w = 110, h = 96;
    // the shackle: a U over the body, springing up and turning when open
    const lift = open ? 44 : 0;
    const sh = [];
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + (i / 14) * Math.PI;
      sh.push([c[0] + Math.cos(a) * 34 + (open ? 14 : 0), c[1] - h / 2 - lift + Math.sin(a) * 50]);
    }
    const leg = [[c[0] - 34 + (open ? 14 : 0), c[1] - h / 2 - lift], [c[0] - 34 + (open ? 14 : 0), c[1] - h / 2 + 6 - (open ? lift : 0)]];
    const path = [leg[1], ...sh, [c[0] + 34 + (open ? 14 : 0), c[1] - h / 2 + 6 - lift * (open ? 1.4 : 0)]];
    K.line(ctx, path, { width: 26, color: P.ink, seed: sd('shk'), boil: B, taper: 0 });
    K.line(ctx, path, { width: 16, color: C.iron, seed: sd('shk'), boil: B, taper: 0 });
    const body = L.rrectPts(c[0] - w / 2, c[1] - h / 2, w, h, 18, 6);
    F().form(ctx, body, C.brass, B, sd('lockB'), { width: 6, off: 0.12, shine: 0.8, hatch: 0.5, dark: C.brassDeep });
    K.fill(ctx, L.ellipsePts(c[0], c[1] - 6, 11, 11, 12), '#1A1410');
    K.fill(ctx, [[c[0] - 6, c[1]], [c[0] + 6, c[1]], [c[0] + 3, c[1] + 26], [c[0] - 3, c[1] + 26]], '#1A1410');
  }

  const LOCK = () => [K.CXF + 310, K.GROUND - 50];
  const WORK = [
    { turn: 0.4, look: [0.8, 0.8], lid: 0.3, nod: 0.3, fx: { lock: 0 } },
    { turn: 0.3, arm: { l: 0, r: 1.3 }, look: [0.6, -0.4], fx: { lock: 0, keyUp: 1, keyOut: 1, glint: 1 } },
    { x: 70, y: -50, turn: 0.3, arm: { l: 0, r: 1.3 }, wing: 0.2, fx: { lock: 0, keyUp: 1, keyOut: 1 } },
    { x: 100, turn: 0.45, nod: 0.5, look: [0.8, 0.9], fx: { lock: 0, keyIn: 0, keyOut: 1 } },
    { x: 100, turn: 0.45, nod: 0.5, look: [0.8, 0.9], lid: 0.2, fx: { lock: 1, keyIn: 1, keyOut: 1, click: 1 } },
    { x: 94, turn: 0.3, look: [0.6, -0.3], lid: 0, fx: { lock: 1, keyIn: 1, keyOut: 1, jump: 0.5 } },
    { x: 80, eye: 'happy', mouth: 0.4, wing: 0.3, fx: { lock: 1, keyIn: 1, keyOut: 1, jump: 1 } },
    { x: 40, lid: 0.3, fx: { lock: 1 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'bird',
    bodyC: [0, -210],
    bodyR: 260,
    body: { half: [[0, -400], [104, -392], [166, -340], [194, -244], [190, -146], [154, -78], [76, -48], [0, -42]] },
    belly: null,
    wings: {
      fold: [[100, -350], [166, -340], [204, -256], [206, -160], [176, -100], [136, -126], [108, -236]],
      spread: [[100, -350], [200, -412], [310, -452], [366, -400], [352, -326], [258, -294], [136, -272]],
      root: [104, -310],
      tip: 4,
      n: 8,
      feather: 150,
      fw: 22,
      rows: [[[116, -316], [154, -306], [186, -280]], [[112, -276], [152, -262], [192, -238]]],
      rowsSpread: [[[156, -370], [236, -400], [314, -420]], [[156, -330], [240, -360], [322, -380]]],
    },
    feet: { at: [56, -50], r: 10, toe: 38, claw: '#15131A' },
    fan: { base: [0, -110], n: 7, spread: 0.9, len: 230, width: 22, taper: 0.4 },
    head: { c: [0, -540], rx: 156, ry: 142, tufts: [[0.66, 0.84, 40]] },
    beak: { y: 34, w: 46, h: 96, down: 22 },
    face: {
      eyes: { x: 70, y: -8, rx: 30, ry: 32, white: '#FFF4D8', iris: '#E8B830', irisR: 0.84, lid: 0.26, lidColor: C.fur },
      blush: [108, 40, 18],
    },
    fur: false,
    shadowW: 220,
    attack: 'peck',
    hooks: {
      body(c2, R, B, pts) {
        sheen(c2, pts, R, B, sd('bsh'));
      },
      skin(c2, R, B, pts) {
        sheen(c2, pts, R, B, sd('hsh'), 1.2);
      },
      wing(c2, R, B, side) {
        void side;
        sheen(c2, [[0, 0], [K.W, 0], [K.W, K.H], [0, K.H]], R, B, sd('wsh', side), 0.9);
      },
      front: keyRing,
      face: throat,
      head: monocle,
      foot(ctx, R, B, side, f) {
        if (side < 0) return;
        for (let k = 0; k < 2; k++) {
          const c = [f[0], f[1] - 36 - k * 18];
          K.fill(ctx, L.rrectPts(c[0] - 14, c[1] - 7, 28, 14, 5, 3), C.gold);
          L.inkPath(ctx, L.rrectPts(c[0] - 14, c[1] - 7, 28, 14, 5, 3), { closed: true, width: 2.8, seed: sd('lr', k), boil: B, taper: 0 });
        }
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.lock == null) return;
        const lc = LOCK();
        padlock(ctx, lc, fx.lock, B);
        if (fx.keyIn) K.key(ctx, lc[0] - 30, lc[1] - 6, Math.PI + (fx.lock ? -0.5 : 0), 0.9, C.gold, C.goldDeep, B, sd('kin'), fx.lock ? 0.35 : 0);
        if (fx.keyUp && R.wingTip && R.wingTip[1]) {
          const t = R.wingTip[1];
          K.key(ctx, t[0] + 10, t[1] - 20, -Math.PI / 2 - 0.3, 1, C.gold, C.goldDeep, B, sd('kup'));
          if (fx.glint) K.fx.star(ctx, t[0] + 40, t[1] - 100, 34, B, sd('kg'), '#FFF1C4');
        }
        if (fx.click) K.fx.star(ctx, lc[0] + 60, lc[1] - 70, 40, B, sd('clk'), '#FFF1C4');
        if (fx.jump) {
          const j = fx.jump;
          const hgt = 170 * Math.sin(Math.PI * Math.min(1, j * 0.9));
          K.fx.token(ctx, lc[0] - 40 - 60 * j, lc[1] - 60 - hgt, 26, 0.2 + j, B, sd('jt'));
          K.fx.coin(ctx, lc[0] + 40 + 60 * j, lc[1] - 70 - hgt * 0.9, 26, 0.3 + j, B, sd('jc'));
          if (j >= 1) K.fx.star(ctx, lc[0], lc[1] - 230, 44, B, sd('js'), '#FFF1C4');
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { x: T.x || 0, y: T.y || 0, turn: T.turn || 0, look: T.look || null, lid: T.lid == null ? null : T.lid, nod: T.nod || 0, arm: T.arm || { l: 0, r: 0 }, wing: T.wing || 0, eyeMode: T.eye || 'open', mouth: T.mouth || 0, fx: T.fx };
      },
    },
  });
})();
