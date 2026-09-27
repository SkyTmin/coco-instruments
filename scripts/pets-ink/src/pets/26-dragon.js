// pets/26-dragon.js : Угольный дракон (legendary, loot + sell). Front kit, sits with wings out.
// A little coal dragon sitting up: charcoal scales cracked with glowing lava, a pale ochre belly in
// plates, big golden eyes with slit pupils, a broad snout with two smoking nostrils and two little
// fangs, bone horns curving up (a small gold crown hung on the left one — his hoard), webbed
// frills for ears, a crest of spikes on top, bat wings behind his shoulders, a spade-tipped tail
// curled on the floor, embers drifting off him. Work: a deep breath (the cracks blaze), fire on a
// stone until it glows and melts into a gold nugget, and he beams.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp;
  const F = () => K.front;
  const ID = 'dragon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#3E3736',
    furDeep: '#171313',
    furLit: '#6E625E',
    belly: '#C9955E',
    bellyDeep: '#8A5E34',
    muzzle: '#524947',
    leg: '#3E3736',
    paw: '#3E3736',
    hindPaw: '#3E3736',
    claw: '#E8DCC2',
    pad: '#8A5A44',
    lava: '#FF8A2A',
    lavaHot: '#FFD166',
    lavaDeep: '#C0391E',
    nose: '#1E1A1A',
    blush: '#E0704E',
    mouth: '#5E1A10',
    tongue: '#E0574A',
    eyeLine: '#F2E0C4',
    horn: '#E2D4B6',
    hornDeep: '#9C8C6A',
    membrane: '#8A3A2C',
    membraneDeep: '#4A1A12',
    gold: '#F2C14E',
    goldDeep: '#A0741E',
    ruby: '#D0304A',
    stone: '#8A857E',
    stoneTop: '#A9A49B',
    stoneDeep: '#55504A',
  };

  const glowOf = (R) => (R.pose.fx && R.pose.fx.glow) || 1;

  /** A glowing crack: a dark-red groove with an orange line and a hot core, brighter with g. */
  function crack(c2, pts, g, B, seed) {
    K.line(c2, pts, { width: 9, color: C.lavaDeep, seed, boil: B, smooth: false, taper: [3, 6] });
    K.line(c2, pts, { width: 5, color: C.lava, alpha: clamp(0.5 + 0.3 * g), seed, boil: B, smooth: false, taper: [3, 6] });
    if (g > 1.3) K.line(c2, pts, { width: 2.4, color: C.lavaHot, seed, boil: B, smooth: false, taper: [3, 6] });
  }

  function headCracks(c2, R, B) {
    const T = R.Mh, g = glowOf(R);
    const cr = (pts, k) => crack(c2, M.all(T, pts.map(([x, y]) => R.hl(x, y, 0.7))), g, B, sd('hc', k));
    cr([[-40, -130], [-30, -96], [-44, -70], [-34, -48]], 0);
    cr([[120, -90], [100, -70], [112, -44]], 1);
    cr([[-150, 20], [-126, 34], [-132, 58]], 2);
    // scale texture: small arcs over the crown
    for (let i = 0; i < 9; i++) {
      const x = -120 + (i % 5) * 60 + (i > 4 ? 30 : 0), y = -110 + (i > 4 ? 36 : 0);
      K.line(c2, M.all(T, K.curve([R.hl(x - 16, y, 0.6), R.hl(x, y + 10, 0.6), R.hl(x + 16, y, 0.6)], 3)), { width: 3, color: C.furLit, alpha: 0.7, seed: sd('sc', i), boil: B });
    }
  }

  function bodyCracks(c2, R, B) {
    const T = R.Mb, g = glowOf(R);
    // the belly plates
    for (let k = 0; k < 6; k++) {
      const y = -300 + k * 44;
      K.line(c2, M.all(T, K.curve([[-100 + k * 4, y - 6], [0, y + 8], [100 - k * 4, y - 6]], 5)), { width: 4, color: C.bellyDeep, seed: sd('plate', k), boil: B, taper: [3, 3] });
    }
    for (const [pts, k] of [[[[150, -300], [170, -250], [156, -210], [176, -170]], 0], [[[-160, -260], [-176, -214], [-160, -180]], 1], [[[-120, -120], [-150, -90], [-140, -60]], 2]])
      crack(c2, M.all(T, pts), g, B, sd('bc', k));
  }

  // ---- the horns, the crown, the crest
  function horn(ctx, R, B, side) {
    const T = R.Mh;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const x = side * (84 + 50 * u + 80 * u * u), y = -96 - 176 * u + 70 * u * u * u;
      pts.push(R.hl(x, y, 0.3));
    }
    const c = M.all(T, K.curve(pts, 5));
    const rib = K.ribbonPts(c, (u) => 56 * (1 - u * 0.86));
    F().form(ctx, rib, C.horn, B, sd('horn', side), {
      width: 5,
      off: 0.1,
      hatch: 0.5,
      dark: C.hornDeep,
      inside(c2) {
        for (let k = 1; k <= 4; k++) {
          const i = Math.floor((k / 6) * (c.length - 1));
          const q = c[i], nb = c[i + 1] || q;
          const a = Math.atan2(nb[1] - q[1], nb[0] - q[0]) + Math.PI / 2;
          const w = 28 * (1 - (k / 6) * 0.86);
          K.line(c2, [[q[0] - Math.cos(a) * w, q[1] - Math.sin(a) * w], [q[0] + Math.cos(a) * w, q[1] + Math.sin(a) * w]], { width: 3, color: C.hornDeep, seed: sd('hr', side, k), boil: B, taper: 0 });
        }
      },
    });
    return c;
  }

  function crown(ctx, c, a, B) {
    const T = M.chain(M.tr(c[0], c[1]), M.rot(a), M.sc(0.85, 0.85));
    const pts = M.all(T, [[-40, 18], [-44, -22], [-24, -4], [0, -34], [24, -4], [44, -22], [40, 18]]);
    F().form(ctx, pts, C.gold, B, sd('crown'), { width: 4.5, off: 0.12, shine: 1, hatch: 0.3, dark: C.goldDeep, smooth: false });
    K.fill(ctx, M.all(T, L.ellipsePts(0, 6, 8, 7, 10)), C.ruby);
    for (const x of [-44, 0, 44]) K.fill(ctx, M.all(T, L.ellipsePts(x, x ? -24 : -36, 5, 5, 8)), C.gold);
  }

  function hornsAndCrest(ctx, R, B) {
    const T = R.Mh;
    const hl = horn(ctx, R, B, -1);
    horn(ctx, R, B, 1);
    crown(ctx, hl[Math.floor(hl.length * 0.3)], -0.35 + R.pose.head, B);
    // three spikes along the top of the head
    for (const [x, h] of [[-36, 44], [0, 58], [36, 44]]) {
      const b = R.hl(x, -130, 0.4);
      const sp = M.all(T, [[b[0] - 16, b[1] + 10], [b[0] + 4, b[1] - h], [b[0] + 18, b[1] + 10]]);
      F().form(ctx, sp, C.membrane, B, sd('crest', x), { width: 4.5, off: 0.1, hatch: 0.4, rim: false, smooth: false });
    }
  }

  // ---- wings (behind), the tail with its spade (behind)
  function wings(ctx, R, B) {
    const T = R.Mb;
    const up = (R.pose.fx && R.pose.fx.wing) || 0;
    for (const s of [-1, 1]) {
      const sh = [s * 110, -320];
      const el = [s * (230 + 20 * up), -430 - 70 * up];
      const tips = [[s * (380 + 30 * up), -470 - 90 * up], [s * (400 + 20 * up), -330 - 50 * up], [s * (330 + 10 * up), -210 - 10 * up]];
      // the membrane scalloped between the finger tips
      const mem = [sh, el, tips[0]];
      for (let i = 0; i < tips.length; i++) {
        const a = tips[i], b = tips[i + 1] || [s * 150, -220];
        const mid = [(a[0] + b[0]) / 2 - s * 26, (a[1] + b[1]) / 2 + 10];
        mem.push(mid, b);
      }
      const pts = M.all(T, K.smooth(mem, 4));
      F().form(ctx, pts, C.membrane, B, sd('wing', s), {
        width: 6,
        off: 0.08,
        hatch: 0.6,
        dark: C.membraneDeep,
        inside(c2) {
          for (const t of tips) K.line(c2, M.all(T, [el, t]), { width: 5, color: C.membraneDeep, seed: sd('fing', s, t[1]), boil: B, taper: [4, 2] });
        },
      });
      // the arm of the wing with a claw at the elbow
      const arm = M.all(T, [sh, el]);
      K.line(ctx, arm, { width: 22, color: P.ink, seed: sd('warm', s), boil: B, taper: [8, 4] });
      K.line(ctx, arm, { width: 15, color: C.fur, seed: sd('warm', s), boil: B, taper: [8, 4] });
      const e = M.ap(T, el);
      const cl = [[e[0] - 8, e[1] + 4], [e[0] + s * 4, e[1] - 30], [e[0] + 10, e[1] + 2]];
      K.fill(ctx, cl, C.claw);
      L.inkPath(ctx, cl, { closed: true, width: 3, seed: sd('wcl', s), boil: B, smooth: false, taper: 0 });
    }
  }

  function tailBehind(ctx, R, B) {
    const T = R.Mr;
    const sw = R.pose.tail * 40;
    const c = M.all(T, K.curve([[120, -60], [230, -40], [310, -16], [370 + sw * 0.3, -40], [400 + sw, -96]], 6));
    const rib = K.ribbonPts(c, (u) => lerp(40, 14, u));
    // spikes along the top edge
    for (let k = 1; k < 6; k++) {
      const i = Math.floor((k / 7) * (c.length - 1));
      const q = c[i], nb = c[i + 1] || q;
      const a = Math.atan2(nb[1] - q[1], nb[0] - q[0]) - Math.PI / 2;
      const w = lerp(40, 14, i / (c.length - 1)) * 0.5;
      const sp = [[q[0] - Math.cos(a + Math.PI / 2) * 12, q[1] - Math.sin(a + Math.PI / 2) * 12], [q[0] + Math.cos(a) * (w + 30), q[1] + Math.sin(a) * (w + 30)], [q[0] + Math.cos(a + Math.PI / 2) * 12, q[1] + Math.sin(a + Math.PI / 2) * 12]];
      F().form(ctx, sp, C.membrane, B, sd('tsp', k), { width: 4, off: 0.1, hatch: 0.3, rim: false, smooth: false });
    }
    F().form(ctx, rib, C.fur, B, sd('tail'), { width: 7, off: 0.06, hatch: 0.6 });
    // the spade at the tip
    const e = c[c.length - 1], p = c[c.length - 4];
    const a = Math.atan2(e[1] - p[1], e[0] - p[0]);
    const TS = M.chain(M.tr(e[0], e[1]), M.rot(a));
    F().form(ctx, M.all(TS, K.smooth([[-8, 0], [10, -30], [60, 0], [10, 30]], 3)), C.membrane, B, sd('spade'), { width: 5, off: 0.1, hatch: 0.4, rim: false });
  }

  // ---- fire, the stone, the nugget, embers
  function fx(ctx, R, B) {
    const f = R.pose.fx || {};
    const g = K.GROUND, sx = K.CXF + 300;
    if (f.stone) {
      const heat = f.stone;
      if (heat < 2) {
        const pts = L.ellipsePts(sx, g - 50, 76, 54, 9, 0.3);
        F().form(ctx, pts, heat > 0.6 ? L.mix(C.stone, C.lava, (heat - 0.6) * 1.5) : C.stone, B, sd('stone'), {
          width: 6,
          off: 0.1,
          hatch: 0.5,
          smooth: false,
          inside(c2) {
            L.stipple(c2, pts, { spacing: 14, r: [1.6, 3], color: C.stoneDeep, alpha: 0.6, seed: sd('st'), boil: B });
            if (heat > 0.3) crack(c2, [[sx - 40, g - 70], [sx - 6, g - 48], [sx + 30, g - 64]], heat * 2, B, sd('stc'));
          },
        });
      } else {
        const pts = K.smooth([[sx - 50, g - 6], [sx - 56, g - 44], [sx - 16, g - 80], [sx + 36, g - 70], [sx + 58, g - 30], [sx + 40, g - 4]], 3);
        F().form(ctx, pts, C.gold, B, sd('nug'), { width: 6, off: 0.12, shine: 1, hatch: 0.3, dark: C.goldDeep });
        if (f.star) K.fx.star(ctx, sx + 50, g - 110, 44 * f.star, B, sd('ns'), '#FFF1C4');
      }
    }
    if (f.smoke) {
      for (let k = 0; k < 4; k++) {
        const p = f.smoke;
        const c = [sx - 20 + k * 20, g - 110 - p * 90 - k * 26];
        const r = 22 + p * 18 + k * 6;
        const pf = L.ellipsePts(c[0], c[1], r, r * 0.85, 16);
        K.fill(ctx, pf, '#B8B2AA', 0.8 * (1 - p * 0.6));
        L.inkPath(ctx, pf, { closed: true, width: 3.4, alpha: 1 - p * 0.6, color: P.inkSoft, seed: sd('smk', k), boil: B, wobble: 0.6 });
      }
    }
    if (f.breath) {
      // the flame: blobs growing from his mouth to the stone, dark rim, orange, a hot core
      const m = R.hp(0, 110, 1);
      const tg = [sx - 10, g - 60];
      const n = 9;
      const reach = f.breath;
      const blobs = [];
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1)) * reach;
        const x = lerp(m[0], tg[0], u) + 16 * L.noise1(i * 1.3 + R.d, 3);
        const y = lerp(m[1], tg[1], u) - 40 * Math.sin(Math.PI * u) + 12 * L.noise1(i * 1.7 + R.d, 5);
        blobs.push([x, y, 24 + 58 * u]);
      }
      for (const [col, k, ink] of [[C.lavaDeep, 1, true], [C.lava, 0.72, false], [C.lavaHot, 0.42, false]])
        for (const [x, y, r] of blobs) {
          const pts = L.ellipsePts(x, y, r * k, r * k * 0.9, 16);
          K.fill(ctx, pts, col);
          if (ink) L.inkPath(ctx, pts, { closed: true, width: 4, seed: sd('fl', x | 0), boil: B, wobble: 0.8 });
        }
      for (const [x, y, r] of blobs) K.fill(ctx, L.ellipsePts(x, y, r * 0.72, r * 0.64, 14), C.lava);
      for (const [x, y, r] of blobs) K.fill(ctx, L.ellipsePts(x, y, r * 0.4, r * 0.36, 12), C.lavaHot);
    }
    if (f.nostril || glowOf(R) > 1.4) {
      for (const s of [-1, 1]) {
        const n = R.hp(s * 22, 44, 1);
        K.fill(ctx, L.ellipsePts(n[0], n[1], 10, 7, 10), C.lava);
        K.fill(ctx, L.ellipsePts(n[0], n[1], 5, 3.5, 8), C.lavaHot);
      }
    }
    // embers always drifting off him
    if (R.anim !== 'sleep') K.fx.embers(ctx, M.ap(R.Mb, [0, -360]), 360, (R.d || 0) / (R.n || 12), B, sd('emb'), [C.lava, C.lavaHot, '#FFB060']);
    // smoke curling from the nostrils in his sleep
    if (f.kind === 'zzz') {
      for (let k = 0; k < 3; k++) {
        const n = R.hp(-22, 44, 1);
        const p = ((f.u || 0) + k / 3) % 1;
        const c = [n[0] - 20 - p * 40, n[1] - 30 - p * 120];
        const r = 10 + p * 20;
        L.inkPath(ctx, L.ellipsePts(c[0], c[1], r, r * 0.8, 14), { closed: true, width: 3.4, alpha: 1 - p, color: P.inkSoft, seed: sd('zs', k), boil: B, wobble: 0.7 });
      }
    }
  }

  const WORK = [
    { turn: 0.45, look: [0.8, 0.5], fx: { stone: 0.01, glow: 1 } },
    { sq: 1.06, y: -10, turn: 0.3, eye: 'closed', fx: { stone: 0.01, glow: 2, wing: 0.7, nostril: 1 } },
    { turn: 0.55, head: 0.14, eye: 'angry', mouth: 1, fx: { stone: 0.3, glow: 1.6, breath: 0.6, wing: 0.4 } },
    { turn: 0.6, head: 0.16, eye: 'angry', mouth: 1, fx: { stone: 0.8, glow: 1.6, breath: 1, wing: 0.3 } },
    { turn: 0.55, head: 0.12, mouth: 0.6, fx: { stone: 1.4, glow: 1.3, breath: 0.45 } },
    { turn: 0.4, look: [0.7, 0.6], fx: { stone: 2, smoke: 0.4, star: 1, glow: 1.1 } },
    { turn: 0.2, eye: 'happy', mouth: 0.7, fx: { stone: 2, smoke: 0.9, star: 0.7, glow: 1.2, wing: 0.5 } },
    { look: [0.3, 0.3], fx: { stone: 2, glow: 1 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'sit',
    bodyC: [0, -190],
    bodyR: 260,
    body: { half: [[0, -350], [92, -342], [150, -300], [182, -214], [196, -120], [188, -44], [146, -14], [0, -10]] },
    belly: { half: [[0, -330], [70, -324], [104, -270], [112, -180], [96, -90], [54, -44], [0, -36]] },
    fur: false,
    sit: {
      thigh: [150, -84, 76, 74],
      hind: [184, 0, 48, 24],
      front: { at: [104, -250], len: 238, r: 34, paw: [42, 25], splay: 0.05 },
      claws: 18,
    },
    head: { c: [0, -500], rx: 180, ry: 150, half: [[0, -140], [90, -134], [146, -100], [176, -40], [180, 20], [164, 70], [124, 112], [70, 140], [0, 150]] },
    ears: {
      at: [170, -20],
      pts: [[-10, 40], [20, -20], [66, -74], [72, -34], [108, -40], [98, 0], [124, 16], [70, 40]],
      fill: C.membrane,
      tilt: 0,
      flop: 0.4,
    },
    face: {
      eyes: { x: 72, y: -20, rx: 36, ry: 38, white: '#FFF6DE', iris: '#F2B830', irisR: 0.88, slit: true, lid: 0.06, lidColor: C.fur, lash: true },
      muzzle: { half: [[0, 18], [60, 20], [112, 46], [124, 86], [100, 124], [52, 142], [0, 146]] },
      nose: null,
      mouth: { y: 104, w: 44, drop: 8, h: 40, style: 'smile', fangs: 16 },
      blush: [132, 44, 24],
    },
    shadowW: 280,
    attack: 'bite',
    hooks: {
      behind(ctx, R, B) {
        wings(ctx, R, B);
        tailBehind(ctx, R, B);
      },
      skin: headCracks,
      body: bodyCracks,
      front: hornsAndCrest,
      ear(c2, R, B, side, T) {
        for (const tip of [[66, -74], [108, -40], [124, 16]]) K.line(c2, M.all(T, [[20 * side, 20], [tip[0] * side * 0.94, tip[1] * 0.94]]), { width: 4, color: C.membraneDeep, seed: sd('fr', side, tip[0]), boil: B, taper: [3, 2] });
      },
      face(ctx, R, B) {
        const T = R.Mh;
        // two big nostrils on top of the snout, and two fangs when the mouth is shut
        for (const s of [-1, 1]) {
          const n = M.all(T, L.ellipsePts(...R.hl(s * 22, 44, 1), 11, 8, 12, s * 0.4));
          K.fill(ctx, n, '#120E0E');
          L.inkPath(ctx, n, { closed: true, width: 3, seed: sd('nos', s), boil: B, wobble: 0.3 });
        }
        if (R.pose.mouth <= 0.25)
          for (const s of [-1, 1]) {
            const c = R.hl(s * 26, 112, 1);
            const f = M.all(T, [[c[0] - 7, c[1] - 2], [c[0] + 7, c[1] - 2], [c[0], c[1] + 16]]);
            K.fill(ctx, f, '#FFFBF0');
            L.inkPath(ctx, f, { closed: true, width: 2.6, seed: sd('fang', s), boil: B, smooth: false, taper: 0 });
          }
      },
      fx,
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { turn: T.turn || 0, look: T.look || null, head: T.head || 0, sq: T.sq || 1, y: T.y || 0, eyeMode: T.eye || 'open', mouth: T.mouth || 0, fx: T.fx };
      },
    },
  });
})();
