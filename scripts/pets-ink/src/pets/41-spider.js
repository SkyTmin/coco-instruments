// pets/41-spider.js : Паук-отмычка (epic, rate). Front kit, a tarantula facing us on eight legs.
// A round, hairy little tarantula: the big furry ball of the abdomen behind with an orange tuft on
// top, the head in front with two big glossy eyes and four small ones above, fuzzy fangs, orange
// bands at every knee, eight legs arching out to both sides. Its feelers hold a lockpick and a
// tension wrench. Work: raises its front legs and spins a web between them; a token flying past
// sticks in it, and it dances.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'spider';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;
  const TAU = Math.PI * 2;

  const C = {
    fur: '#4A3A32',
    furDeep: '#1E1614',
    furLit: '#7A6456',
    leg: '#3E322C',
    joint: '#E07A2E',
    tuft: '#D9772E',
    fang: '#EDE3CF',
    eyeLine: '#E8D9C4',
    blush: '#E08A70',
    steel: '#B8BEC6',
    steelDeep: '#6A7078',
    silk: '#F4F1EA',
  };

  function tuft(c2, R, B) {
    const T = R.Mb;
    K.fill(c2, M.all(T, L.ellipsePts(0, -470, 110, 50, 22)), C.tuft);
    L.hatch(c2, M.all(T, L.ellipsePts(0, -470, 110, 50, 22)), { angle: -1.4, spacing: 10, length: [8, 14], gap: [8, 16], width: 2.2, color: '#F2A860', alpha: 0.8, clip: true, seed: sd('tf'), boil: B });
  }

  function knee(ctx, R, B, side, i, hip, kn, foot) {
    // an orange band at each knee and a lighter one at the ankle
    for (const [p, q, w] of [[kn, hip, 1], [foot, kn, 0.7]]) {
      const dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.hypot(dx, dy) || 1;
      const u = [dx / dl, dy / dl];
      const c = [p[0] + u[0] * 26 * w, p[1] + u[1] * 26 * w];
      const r = 20 * w;
      const band = [[c[0] - u[1] * r - u[0] * 8, c[1] + u[0] * r - u[1] * 8], [c[0] + u[1] * r - u[0] * 8, c[1] - u[0] * r - u[1] * 8], [c[0] + u[1] * r + u[0] * 8, c[1] - u[0] * r + u[1] * 8], [c[0] - u[1] * r + u[0] * 8, c[1] + u[0] * r + u[1] * 8]];
      K.fill(ctx, band, C.joint);
    }
    // hairs sticking out of the leg
    for (let k = 1; k < 4; k++) {
      const p = [lerp(kn[0], foot[0], k / 4), lerp(kn[1], foot[1], k / 4)];
      K.line(ctx, [p, [p[0] + side * 14, p[1] - 6]], { width: 2.4, seed: sd('lh', side, i, k), boil: B, taper: [2, 4] });
    }
  }

  function faceBits(ctx, R, B) {
    const T = R.Mh;
    // four small eyes over the two big ones
    for (const [x, y, r] of [[-96, -84, 13], [-40, -104, 15], [40, -104, 15], [96, -84, 13]]) {
      const c = R.hl(x, y, 0.8);
      K.fill(ctx, M.all(T, L.ellipsePts(c[0], c[1], r, r, 14)), '#140E0C');
      K.fill(ctx, M.all(T, L.ellipsePts(c[0] - r * 0.3, c[1] - r * 0.35, r * 0.35, r * 0.28, 8)), '#FFFFFF', 0.9);
      L.inkPath(ctx, M.all(T, L.ellipsePts(c[0], c[1], r, r, 14)), { closed: true, width: 3, seed: sd('se', x), boil: B, wobble: 0.2 });
    }
    // the chelicerae: two fuzzy lumps with ivory fangs
    const open = R.pose.mouth || 0;
    for (const s of [-1, 1]) {
      const c = R.hl(s * 36, 86, 1);
      const lump = M.all(T, L.ellipsePts(c[0], c[1], 34, 40, 18, s * 0.2));
      F().form(ctx, lump, C.fur, B, sd('chel', s), { width: 5, off: 0.1, hatch: 0.4, inside: (c2) => F().fur(c2, lump, R, B, sd('cf', s), C.furLit, C.furDeep, 1.6) });
      const f0 = R.hl(s * 30, 118, 1);
      const fang = M.all(T, K.smooth([[f0[0] - 10, f0[1] - 6], [f0[0] + 10, f0[1] - 6], [f0[0] - s * (6 + open * 12), f0[1] + 34]], 3));
      K.fill(ctx, fang, C.fang);
      L.inkPath(ctx, fang, { closed: true, width: 3, seed: sd('fang', s), boil: B, wobble: 0.2 });
    }
  }

  function tools(ctx, R, B) {
    // the feelers hold a lockpick (right) and a tension wrench (left)
    const T = R.Mh;
    const lift = (R.pose.fx && R.pose.fx.palps) || 0;
    for (const s of [-1, 1]) {
      const b = R.hl(s * 96, 70, 0.8);
      const e = R.hl(s * 130, 150 - lift * 60, 0.9);
      const palp = M.all(T, [b, [lerp(b[0], e[0], 0.5) + s * 20, lerp(b[1], e[1], 0.5)], e]);
      K.line(ctx, palp, { width: 24, color: P.ink, seed: sd('palp', s), boil: B, taper: [4, 4] });
      K.line(ctx, palp, { width: 16, color: C.leg, seed: sd('palp', s), boil: B, taper: [4, 4] });
      const tip = palp[palp.length - 1];
      K.fill(ctx, L.ellipsePts(tip[0], tip[1], 14, 12, 12), C.joint);
      L.inkPath(ctx, L.ellipsePts(tip[0], tip[1], 14, 12, 12), { closed: true, width: 3, seed: sd('pt', s), boil: B, wobble: 0.2 });
      const tool = s > 0 ? [[tip[0] + 4, tip[1] - 6], [tip[0] + 40, tip[1] - 60], [tip[0] + 36, tip[1] - 70], [tip[0] + 46, tip[1] - 74]] : [[tip[0] - 4, tip[1] - 6], [tip[0] - 20, tip[1] - 70], [tip[0] - 40, tip[1] - 74]];
      K.line(ctx, tool, { width: 9, color: P.ink, seed: sd('tool', s), boil: B, smooth: false, taper: 0 });
      K.line(ctx, tool, { width: 5, color: C.steel, seed: sd('tool', s), boil: B, smooth: false, taper: 0 });
    }
  }

  function web(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (!fx.web) return;
    const c = M.ap(R.Mb, [0, -640]);
    const w = fx.web;
    const r = 260;
    // spokes, then the spiral, drawn as far as the web has got
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      K.line(ctx, [c, [c[0] + Math.cos(a) * r * Math.min(1, w * 1.6), c[1] + Math.sin(a) * r * 0.8 * Math.min(1, w * 1.6)]], { width: 2.6, color: C.silk, alpha: 0.95, seed: sd('sp', k), boil: B, smooth: false, taper: 0 });
    }
    const turns = Math.floor(w * 7);
    for (let t = 1; t <= turns; t++) {
      const rr = (t / 7) * r;
      const ring = [];
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * TAU;
        ring.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 0.8 + 6 * Math.sin(k * 2)]);
      }
      K.line(ctx, ring, { width: 2.2, color: C.silk, alpha: 0.9, seed: sd('ring', t), boil: B, smooth: false, taper: 0 });
    }
    if (fx.token) {
      const p = fx.token;
      const x = lerp(c[0] + 520, c[0] + 60, Math.min(1, p)), y = lerp(c[1] - 60, c[1] + 30, Math.min(1, p));
      K.fx.token(ctx, x, y, 26, p < 1 ? 0.3 + p : 0.1, B, sd('tok'));
      if (p < 1) K.fx.speed(ctx, [x + 60, y], 200, 0.8, B, sd('tsp'));
      else K.fx.star(ctx, x + 40, y - 40, 38, B, sd('tst'), '#FFF1C4');
    }
  }

  const up = (a) => ({ l: [a, 0, 0, 0], r: [a, 0, 0, 0] });
  const WEB = 540;
  const WORK = [
    { look: [0, -0.8], lifts: up(300), fx: { palps: 0.5 } },
    { look: [0, -0.9], lifts: { l: [WEB, 60, 0, 0], r: [WEB - 60, 0, 0, 0] }, fx: { web: 0.3, palps: 1 } },
    { look: [0, -0.9], lifts: { l: [WEB - 60, 0, 0, 0], r: [WEB, 60, 0, 0] }, fx: { web: 0.65, palps: 1 } },
    { look: [0, -0.9], lifts: up(WEB), fx: { web: 1, palps: 0.6 } },
    { look: [0.6, -0.8], turn: 0.3, lifts: up(WEB - 30), fx: { web: 1, token: 0.5 } },
    { look: [0.2, -0.9], lifts: up(WEB - 30), lid: 0, fx: { web: 1, token: 1 } },
    { eye: 'happy', mouth: 0.5, y: -30, lifts: { l: [120, 60, 0, 60], r: [60, 0, 60, 0] }, fx: { web: 1, token: 1 } },
    { lifts: up(0), fx: {} },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'spider',
    bodyC: [0, -300],
    bodyR: 250,
    body: { half: [[0, -520], [110, -508], [180, -450], [206, -360], [190, -270], [130, -220], [0, -210]] },
    spiderLegs: [
      { hip: [140, -200], knee: [262, -310], foot: [370, 0], r: 26 },
      { hip: [160, -240], knee: [316, -360], foot: [450, -6], r: 25 },
      { hip: [164, -280], knee: [340, -400], foot: [505, -14], r: 23 },
      { hip: [140, -320], knee: [300, -440], foot: [430, -26], r: 21 },
    ],
    head: { c: [0, -250], rx: 176, ry: 148, tufts: [[0.55, 0.95, 22]] },
    face: {
      eyes: { x: 62, y: -14, rx: 42, ry: 46, beadLit: '#5A4A60' },
      blush: [124, 40, 22],
    },
    shadowW: 330,
    sleepLow: 30,
    attack: 'bite',
    hooks: {
      behind: web,
      body(c2, R, B) {
        tuft(c2, R, B);
      },
      leg: knee,
      face: faceBits,
      head: tools,
    },
    poses: {
      walk(d, n) {
        const s = Math.sin((TAU * d) / n);
        const a = Math.max(0, s) * 50, b = Math.max(0, -s) * 50;
        return { y: -6 * Math.abs(s), lean: 0.02 * s, turn: 0.06 * s, lifts: { l: [a, b, a, b], r: [b, a, b, a] } };
      },
      happy(d, n, base) {
        const p = base.happy(d, n);
        p.lifts = up(Math.max(0, p.arm.l) * 100);
        return p;
      },
      work(d) {
        const T = WORK[d];
        return { look: T.look || null, turn: T.turn || 0, lifts: T.lifts, lid: T.lid == null ? null : T.lid, eyeMode: T.eye || 'open', mouth: T.mouth || 0, y: T.y || 0, fx: T.fx };
      },
    },
  });
})();
