// pets/25-wolf.js : Волк-вожак (legendary, dmg + rate). Front kit, sits like a statue.
// A big grey pack leader: a thick mane of a ruff round his neck, fluffy cheeks, a pale face with a
// darker streak down the forehead, a grey snout and a big black nose, amber eyes under a heavy
// brow, three claw scars down his right cheek, a torn notch in his left ear. A heavy iron collar
// half buried in the ruff, a broken chain dangling from its ring, a tin number tag. Pale legs, a
// bushy tail with a dark tip. Work: the howl — a full moon rises behind him, the howl goes out in
// rings, then he lowers his head and looks straight at you.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'wolf';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8E8C87',
    furDeep: '#565450',
    furLit: '#C2BFB8',
    belly: '#DDD7CB',
    pale: '#E4DED2',
    ruff: '#B3AFA7',
    saddle: '#5E5C57',
    muzzle: '#C8C4BC',
    sock: '#D9D3C6',
    paw: '#D9D3C6',
    hindPaw: '#B3AFA7',
    pad: '#4A4442',
    earIn: '#E6DDD0',
    skin: '#D2958C',
    nose: '#221E1C',
    blush: '#D98A84',
    mouth: '#4E1E1C',
    tongue: '#E08880',
    scar: '#E6A89C',
    iron: '#5E6166',
    ironDeep: '#34373B',
    ironLit: '#8F949A',
    tin: '#C9CBC6',
    moon: '#F6EDCB',
    moonDeep: '#DCCFA4',
  };

  function faceMarks(c2, R) {
    const T = R.Mh;
    // the pale mask: cheeks, lips and chin, and pale spots over the eyes
    for (const s of [-1, 1]) {
      K.fill(c2, M.all(T, K.smooth([R.hl(s * 20, 40, 1), R.hl(s * 70, 16, 0.85), R.hl(s * 140, 26, 0.5), R.hl(s * 180, 60, 0.2), R.hl(s * 130, 110, 0.4), R.hl(s * 60, 140, 0.8), R.hl(s * 14, 150, 0.9)], 4)), C.pale);
      K.fill(c2, M.all(T, L.ellipsePts(...R.hl(s * 70, -70, 0.85), 26, 14, 14, -s * 0.25)), C.pale);
    }
    // a darker streak down the forehead and round the top of the head
    K.fill(c2, M.all(T, K.smooth([R.hl(-60, -150, 0.4), R.hl(60, -150, 0.4), R.hl(26, -60, 0.9), R.hl(12, -20, 1), R.hl(-12, -20, 1), R.hl(-26, -60, 0.9)], 4)), C.saddle, 0.8);
  }

  function scars(ctx, R, B) {
    const T = R.Mh;
    // three claw marks down his right cheek
    for (let k = 0; k < 3; k++) {
      const a = R.hl(-116 + k * 20, 0 + k * 6, 0.6), b = R.hl(-92 + k * 20, 86 + k * 4, 0.7);
      const s = M.all(T, [a, [lerp(a[0], b[0], 0.5) - 4, lerp(a[1], b[1], 0.5)], b]);
      K.line(ctx, s, { width: 10, color: P.ink, seed: sd('sc', k), boil: B, taper: [4, 6] });
      K.line(ctx, s, { width: 5, color: C.scar, seed: sd('sc', k), boil: B, taper: [4, 6] });
    }
    // a heavy brow over each eye
    for (const s of [-1, 1]) K.line(ctx, M.all(T, K.curve([R.hl(s * 36, -52, 0.9), R.hl(s * 76, -60, 0.85), R.hl(s * 116, -46, 0.7)], 4)), { width: 8, color: C.furDeep, seed: sd('brow', s), boil: B, taper: [4, 6] });
  }

  function cheekTufts(ctx, R, B, pts) {
    F().tufts(ctx, pts, 0.24, 0.3, C.pale, B, sd('chR'), 34);
    F().tufts(ctx, pts, 0.7, 0.76, C.pale, B, sd('chL'), 34);
  }

  function bodyMarks(c2, R) {
    const T = R.Mb;
    for (const s of [-1, 1]) K.fill(c2, M.all(T, K.smooth([[s * 70, -360], [s * 170, -340], [s * 220, -240], [s * 222, -150], [s * 186, -200], [s * 140, -276], [s * 96, -310]], 4)), C.saddle);
  }

  // ---- the ruff, the collar and the broken chain
  /** A lock of fur: a curved teardrop from a base (width w) to a tip. */
  function lock(ctx, base, tip, w, fill, B, seed) {
    const dx = tip[0] - base[0], dy = tip[1] - base[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, bend = 0.18 * l;
    const pts = K.smooth([[base[0] - nx * w, base[1] - ny * w], [base[0] + dx * 0.55 - nx * w * 0.7 + nx * bend * 0.3, base[1] + dy * 0.55 - ny * w * 0.7], tip, [base[0] + dx * 0.5 + nx * w * 0.8, base[1] + dy * 0.5 + ny * w * 0.8], [base[0] + nx * w, base[1] + ny * w]], 4);
    F().form(ctx, pts, fill, B, seed, { width: 4.5, off: 0.1, hatch: 0.4, rim: false });
  }

  /** A cloud of fur: an outline of outward arcs meeting in little points, round (cx, cy). */
  function cloud(cx, cy, rx, ry, n, bulge, seed, bottom = 1) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry * (Math.sin(a0) > 0 ? bottom : 1)];
      const p1 = [cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry * (Math.sin(a1) > 0 ? bottom : 1)];
      const am = (a0 + a1) / 2;
      const b = bulge * (0.75 + 0.5 * L.h3(seed, i, 9)) * (Math.sin(am) > 0.3 ? 1.4 : 1);
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        const bx = Math.cos(am) * b * Math.sin(Math.PI * t), by = Math.sin(am) * b * Math.sin(Math.PI * t);
        out.push([lerp(p0[0], p1[0], t) + bx, lerp(p0[1], p1[1], t) + by]);
      }
    }
    return out;
  }

  function ruff(ctx, R, B) {
    const T = R.Mb;
    // the throat under the head, so it never comes off his shoulders
    K.fill(ctx, M.all(T, L.ellipsePts(0, -392, 120, 64, 24)), C.pale);
    // fluffy cheeks behind the head, sticking out at the jaw
    for (const s of [-1, 1]) {
      const ck = cloud(s * 150, 56, 58, 62, 8, 14, 5 + s).map(([x, y]) => M.ap(R.Mh, R.hl(x, y, 0.2)));
      F().form(ctx, ck, C.pale, B, sd('cheek', s), { width: 6, off: 0.1, hatch: 0.4, smooth: false });
    }
    // the mane: a darker cloud over the shoulders, a pale one over the chest
    const back = M.all(T, cloud(0, -318, 226, 96, 16, 22, 1, 1.15));
    F().form(ctx, back, C.ruff, B, sd('mane'), { width: 7, off: 0.08, hatch: 0.5, smooth: false, inside: (c2) => F().fur(c2, back, R, B, sd('mfur'), C.furLit, C.furDeep, 1.2) });
    const front = M.all(T, cloud(0, -300, 150, 92, 12, 20, 2, 1.25));
    F().form(ctx, front, C.pale, B, sd('bib'), { width: 6, off: 0.08, hatch: 0.4, smooth: false, inside: (c2) => F().fur(c2, front, R, B, sd('bfur'), '#FFFFFF', C.ruff, 1.2) });
    // the iron collar, half sunk in the fur
    const line = M.all(T, K.curve([[-150, -370], [-80, -350], [0, -344], [80, -350], [150, -370]], 8));
    K.band(ctx, line, 30, { fill: C.iron, deep: C.ironDeep, seed: sd('collar'), boil: B, width: 5 });
    for (let k = 1; k < 8; k++) {
      const p = line[Math.floor((k / 8) * (line.length - 1))];
      K.fill(ctx, L.ellipsePts(p[0], p[1], 5, 5, 8), C.ironLit);
      L.inkPath(ctx, L.ellipsePts(p[0], p[1], 5, 5, 8), { closed: true, width: 2.2, seed: sd('rv', k), boil: B });
    }
    const ring = M.ap(T, [0, -326]);
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 20, 22, 20), { closed: true, width: 15, color: P.ink, seed: sd('ring'), boil: B, wobble: 0.3 });
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 20, 22, 20), { closed: true, width: 8, color: C.ironLit, seed: sd('ring'), boil: B, wobble: 0.3 });
    // three links and a broken one, swinging
    const sw = Math.sin(R.pose.tail * 3) * 12;
    K.chain(ctx, [[ring[0], ring[1] + 20], [ring[0] + sw * 0.4, ring[1] + 70], [ring[0] + sw, ring[1] + 120]], 26, { width: 8, color: C.ironLit, seed: sd('chain'), boil: B });
    const e = [ring[0] + sw, ring[1] + 128];
    for (const s of [-1, 1]) K.line(ctx, [[e[0] + s * 8, e[1] - 4], [e[0] + s * 14, e[1] + 14], [e[0] + s * 6, e[1] + 22]], { width: 7, color: C.ironLit, seed: sd('brk', s), boil: B, smooth: false, taper: [2, 4] });
    // the tin number tag hanging off the collar to the side
    const tg = M.ap(T, [70, -334]);
    const tag = L.rrectPts(tg[0] - 22, tg[1], 44, 52, 8, 4);
    K.line(ctx, [[tg[0], tg[1] - 12], [tg[0], tg[1] + 4]], { width: 5, color: C.ironDeep, seed: sd('tagw'), boil: B, taper: 0 });
    F().form(ctx, tag, C.tin, B, sd('tag'), { width: 4, off: 0.12, shine: 0.8, hatch: 0.3 });
    for (let k = 0; k < 3; k++) K.line(ctx, [[tg[0] - 12, tg[1] + 16 + k * 11], [tg[0] + 12, tg[1] + 16 + k * 11]], { width: 2.4, color: '#7E817C', seed: sd('tagl', k), boil: B, smooth: false, taper: 0 });
  }

  // ---- the moon and the howl
  function moon(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (!fx.moon) return;
    const c = [K.CXF + 200, K.GROUND - 700 + (1 - fx.moon) * 120];
    const a = fx.moon;
    const glow = ctx.createRadialGradient(c[0], c[1], 100, c[0], c[1], 240);
    glow.addColorStop(0, L.rgba(C.moon, 0.55 * a));
    glow.addColorStop(1, L.rgba(C.moon, 0));
    ctx.save();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c[0], c[1], 240, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const disc = L.ellipsePts(c[0], c[1], 130, 130, 48);
    K.fill(ctx, disc, C.moon, a);
    for (const [x, y, r] of [[-40, -30, 26], [30, 40, 18], [50, -50, 12], [-50, 50, 14], [0, 0, 8]]) K.fill(ctx, L.ellipsePts(c[0] + x, c[1] + y, r, r * 0.9, 14), C.moonDeep, a * 0.8);
    L.inkPath(ctx, disc, { closed: true, width: 6, alpha: a, seed: sd('moon'), boil: B, wobble: 0.6 });
  }

  function howl(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (fx.howl) {
      const o = R.hp(0, -R.S.head.ry * 0.7, 0.3);
      for (let k = 0; k < 3; k++) {
        const p = fx.howl - k * 0.4;
        if (p <= 0 || p > 1.4) continue;
        const r = 60 + p * 230, a = Math.max(0, 1 - p / 1.4);
        const arc = [];
        for (let i = 0; i <= 10; i++) {
          const t = -Math.PI / 2 - 0.6 + (i / 10) * 1.2;
          arc.push([o[0] + Math.cos(t) * r, o[1] + Math.sin(t) * r * 0.8]);
        }
        K.line(ctx, arc, { width: 11 - k * 2, alpha: a, seed: sd('howl', k), boil: B, taper: [8, 8] });
      }
    }
    if (fx.glint) {
      // the eyes light up
      for (const s of [-1, 1]) {
        const e = R.hp(s * 74, -24, 0.9);
        const g = ctx.createRadialGradient(e[0], e[1], 4, e[0], e[1], 70);
        g.addColorStop(0, L.rgba('#FFE070', 0.55 * fx.glint));
        g.addColorStop(1, L.rgba('#FFE070', 0));
        ctx.save();
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e[0], e[1], 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  const WORK = [
    { look: [0, -0.8], ear: 0.4, fx: {} },
    { hy: -14, nod: -0.6, eye: 'closed', mouth: 0.6, ear: -0.3, fx: { moon: 0.4 } },
    { hy: -22, nod: -1, sq: 1.04, eye: 'closed', mouth: 1, ear: -0.5, fx: { moon: 0.85, howl: 0.3 } },
    { hy: -24, nod: -1, sq: 1.05, eye: 'closed', mouth: 1, ear: -0.5, fx: { moon: 1, howl: 0.8 } },
    { hy: -20, nod: -0.9, sq: 1.03, eye: 'closed', mouth: 0.8, ear: -0.4, fx: { moon: 1, howl: 1.4 } },
    { hy: 10, nod: 0.3, lid: 0.3, eye: 'open', fx: { moon: 0.7, howl: 1.9 } },
    { hy: 10, nod: 0.3, lid: 0.3, look: [0, 0.1], fx: { moon: 0.4, glint: 1 } },
    { lid: 0.2, fx: { moon: 0.15 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'sit',
    bodyC: [0, -200],
    bodyR: 280,
    body: { half: [[0, -384], [112, -378], [192, -332], [224, -240], [230, -130], [214, -46], [164, -14], [0, -10]] },
    belly: [0, -120, 84, 90],
    sit: {
      thigh: [180, -86, 80, 78],
      hind: [222, 0, 46, 24],
      front: { at: [126, -262], len: 250, r: 38, paw: [46, 27], splay: 0.03, sock: 0.84 },
      claws: 14,
    },
    tail: { pts: [[150, -40], [256, -30], [320, -100], [326, -200], [300, -270]], w0: 46, w1: 40, bushy: true, tip: '#3E3C38', tipLen: 0.18, swing: 0.8 },
    head: { c: [0, -532], rx: 172, ry: 150, half: [[0, -144], [82, -140], [138, -108], [168, -46], [174, 18], [152, 70], [110, 112], [58, 142], [0, 152]] },
    ears: {
      at: [108, -110],
      pts: [[-60, 20], [-28, -88], [0, -124], [24, -90], [60, 18]],
      inner: [[-38, 12], [-16, -76], [0, -98], [12, -76], [36, 12]],
      ptsL: [[60, 20], [28, -88], [4, -124], [-10, -104], [-2, -88], [-26, -76], [-60, 18]],
      innerL: [[38, 12], [16, -76], [2, -96], [-4, -84], [-36, 12]],
      fill: C.fur,
      innerFill: C.earIn,
      tilt: 0.2,
      flop: 0.4,
    },
    face: {
      eyes: { x: 74, y: -24, rx: 29, ry: 28, white: '#FFF4D6', iris: '#E6AE22', irisR: 0.9, lid: 0.2, lidColor: C.furDeep, tilt: -0.12 },
      muzzle: { half: [[0, -6], [36, -2], [54, 30], [46, 64], [24, 84], [0, 88]] },
      nose: { y: 58, w: 28, h: 20 },
      mouth: { y: 92, w: 26, drop: 12, h: 38, style: 'cat', fangs: 16 },
      whiskers: null,
      blush: null,
    },
    shadowW: 300,
    attack: 'bite',
    hooks: {
      behind: moon,
      skin: faceMarks,
      body: bodyMarks,
      front: ruff,
      face: scars,
      fx: howl,
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { hy: T.hy || 0, nod: T.nod || 0, head: T.head || 0, sq: T.sq || 1, look: T.look || null, eyeMode: T.eye || 'open', lid: T.lid == null ? null : T.lid, mouth: T.mouth || 0, ear: T.ear || 0, fx: T.fx };
      },
    },
  });
})();
