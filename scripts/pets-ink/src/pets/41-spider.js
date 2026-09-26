// pets/41-spider.js : Паук-отмычка (epic, rate). Bug kit, eight legs in two alternating sets.
// A round, hairy little tarantula: a dark body, orange bands at every knee and an orange tuft on
// its back, two big shiny eyes with four small ones above, two fuzzy fangs. Its feelers hold a
// lockpick and a tension wrench; a leather strap round its belly carries a brass ring of keys.
// Work: raises its back legs and spins a web in a blur, and a token flying past sticks in it.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'spider';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    body: '#3E322C',
    bodyDeep: '#1A1412',
    abd: '#4A3A32',
    tuft: '#D9772E',
    head: '#3E322C',
    leg: '#342A25',
    legDeep: '#120E0C',
    joint: '#E07A2E',
    eye: '#1A110E',
    eyeLine: '#E8D9C4',
    fang: '#EDE3CF',
    steel: '#B8BEC6',
    steelDeep: '#6A7078',
    leather: '#7B4E2F',
    leatherDeep: '#4A2C18',
    gold: '#E2B54A',
    goldDeep: '#96701E',
    iron: '#6A6E75',
    ironDeep: '#3A3D42',
    silk: '#F4F1EA',
  };

  const ABD = L.ellipsePts(-160, -226, 132, 114, 26);
  const CEPH = L.ellipsePts(70, -200, 102, 84, 24);

  function tuft(c2, R, B, id, T) {
    if (id !== 'abd') return;
    K.fill(c2, M.all(T, L.ellipsePts(-196, -306, 74, 40, 20, -0.25)), C.tuft);
    for (let k = 0; k < 9; k++) {
      const x = -250 + k * 13, y = -318 + (k % 3) * 12;
      K.line(c2, M.all(T, [[x, y], [x - 8, y + 22]]), { width: 3, color: '#F2A052', seed: sd('tuftL', k), boil: B, taper: [2, 4] });
    }
  }

  // hair on the legs and the orange band at each knee
  function legHair(ctx, R, B, side, i, hip, knee, foot, far) {
    for (const [a, b] of [[hip, knee], [knee, foot]]) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl, ny = dx / dl;
      for (const u of [0.25, 0.5, 0.75]) {
        const p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
        for (const s of [-1, 1]) K.line(ctx, [[p[0] + s * nx * 8, p[1] + s * ny * 8], [p[0] + s * nx * 20 - (dx / dl) * 6, p[1] + s * ny * 20 - (dy / dl) * 6]], { width: far ? 2.4 : 3, seed: sd('lh', side, i, u, s), boil: B, smooth: false, taper: [2, 3] });
      }
    }
    const band = [lerp(knee[0], foot[0], 0.12), lerp(knee[1], foot[1], 0.12)];
    K.fill(ctx, L.ellipsePts(band[0], band[1], 13, 13, 12), K.far(C.joint, far));
  }

  function harness(ctx, R, B) {
    const T = R.Ma;
    const strap = M.all(T, K.curve([[-118, -334], [-108, -226], [-128, -116]], 6));
    K.clip(ctx, M.all(T, ABD), () => {
      K.line(ctx, strap, { width: 22, color: P.ink, seed: sd('strap'), boil: B, taper: 0 });
      K.line(ctx, strap, { width: 15, color: C.leather, seed: sd('strap'), boil: B, taper: 0 });
    });
    // the key ring on top, keys swinging behind
    const ring = M.ap(T, [-118, -344]);
    const sw = R.pose.fx && R.pose.fx.sway != null ? R.pose.fx.sway : 0;
    K.key(ctx, ring[0] - 4, ring[1] + 6, 2.4 + sw * 0.2, 0.62, C.iron, C.ironDeep, B, sd('k1'));
    K.key(ctx, ring[0] - 2, ring[1] + 8, 2.0 + sw * 0.25, 0.7, C.gold, C.goldDeep, B, sd('k2'));
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 16, 16, 18), { closed: true, width: 9, color: P.ink, seed: sd('ring'), boil: B });
    L.inkPath(ctx, L.ellipsePts(ring[0], ring[1], 16, 16, 18), { closed: true, width: 4.5, color: C.gold, seed: sd('ring'), boil: B });
  }

  function fangs(ctx, R, B) {
    const H = R.Mh;
    const o = R.pose.mouth || 0;
    for (const far of [true, false]) {
      const dx = far ? 26 : 0;
      const T = M.mul(H, M.about((far ? 1 : -1) * 0.25 * o, 150 + dx, -166));
      const f = M.all(T, K.smooth([[136 + dx, -176], [168 + dx, -178], [176 + dx, -146], [166 + dx, -128], [150 + dx, -142], [138 + dx, -156]], 4));
      K.form(ctx, f, { fill: K.far(C.body, far), deep: C.bodyDeep, width: 4.5, seed: sd('fang', far ? 1 : 0), boil: B, shade: 0.5, spacing: 5 });
      const tip = M.all(T, [[160 + dx, -140], [170 + dx, -136], [158 + dx, -114]]);
      K.fill(ctx, tip, C.fang);
      L.inkPath(ctx, tip, { closed: true, width: 3, seed: sd('fangT', far ? 1 : 0), boil: B, smooth: false, taper: 0 });
    }
  }

  // the feelers: short two-part limbs; the near one holds the hook pick, the far one the wrench
  function feelers(ctx, R, B) {
    const H = R.Mh;
    const fx = R.pose.fx || {};
    const lift = fx.pick || 0;
    for (const far of [true, false]) {
      const dx = far ? 30 : 0;
      const a = M.ap(H, [150 + dx, -186]);
      const b = M.ap(H, [206 + dx, -206 - lift * 30]);
      const c = M.ap(H, [236 + dx, -170 - lift * 50]);
      const col = K.far(C.leg, far);
      for (const [p, q, r1, r2] of [[a, b, 9, 8], [b, c, 8, 7]]) K.form(ctx, K.limbPts(p, q, r1, r2, 6), { fill: col, deep: C.legDeep, width: 4.5, seed: sd('palp', far ? 1 : 0, r1), boil: B, shade: 0.5, spacing: 5 });
      K.fill(ctx, L.ellipsePts(c[0], c[1], 10, 10, 10), K.far(C.joint, far));
      // the tools
      const tool = far
        ? [[c[0] + 4, c[1] - 4], [c[0] + 40, c[1] - 26], [c[0] + 52, c[1] - 10]]
        : [[c[0] + 4, c[1] - 6], [c[0] + 56, c[1] - 40], [c[0] + 64, c[1] - 52], [c[0] + 72, c[1] - 46]];
      L.inkPath(ctx, tool, { width: 9, color: P.ink, seed: sd('tool', far ? 1 : 0), boil: B, smooth: false, taper: [2, 2] });
      L.inkPath(ctx, tool, { width: 4, color: K.far(C.steel, far), seed: sd('tool', far ? 1 : 0), boil: B, smooth: false, taper: [2, 2] });
    }
  }

  // the web: radials out from the hub, then the spiral laid ring by ring (w 0..2)
  const HUB = [K.CX - 150, K.GROUND - 520];
  function web(ctx, B, w) {
    const n = 8, rMax = 230;
    const ang = (k) => -0.3 + (k / n) * Math.PI * 2;
    const rad = Math.min(1, w);
    for (let k = 0; k < n; k++) {
      const a = ang(k);
      const e = [HUB[0] + Math.cos(a) * rMax * rad, HUB[1] + Math.sin(a) * rMax * rad];
      K.line(ctx, [HUB, e], { width: 3, color: C.silk, seed: sd('rad', k), boil: B, smooth: false, taper: [2, 2] });
      K.line(ctx, [HUB, e], { width: 1.4, color: P.inkSoft, alpha: 0.6, seed: sd('radI', k), boil: B, smooth: false, taper: 0 });
    }
    const sp = Math.max(0, w - 1);
    const rings = 6;
    for (let r = 0; r < Math.floor(sp * rings + 1e-6); r++) {
      const rr = 50 + r * 32;
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const a0 = ang(k), a1 = ang(k + 1);
        pts.push([HUB[0] + Math.cos(a0) * rr, HUB[1] + Math.sin(a0) * rr]);
        const am = (a0 + a1) / 2;
        if (k < n) pts.push([HUB[0] + Math.cos(am) * rr * 0.9, HUB[1] + Math.sin(am) * rr * 0.9]);
      }
      K.line(ctx, K.curve(pts, 4), { width: 2.6, color: C.silk, seed: sd('ring', r), boil: B, taper: 0 });
      K.line(ctx, K.curve(pts, 4), { width: 1.2, color: P.inkSoft, alpha: 0.5, seed: sd('ringI', r), boil: B, taper: 0 });
    }
    // the anchor threads up to the top and back to the left
    if (w > 0.2) {
      K.line(ctx, [HUB, [HUB[0] - 40, HUB[1] - 330]], { width: 2.4, color: C.silk, seed: sd('anchor1'), boil: B, smooth: false });
      K.line(ctx, [[HUB[0] + Math.cos(ang(2)) * rMax * rad, HUB[1] + Math.sin(ang(2)) * rMax * rad], [HUB[0] + 260, HUB[1] + 330]], { width: 2.4, color: C.silk, seed: sd('anchor2'), boil: B, smooth: false });
    }
  }

  const WORK = [
    { abd: 0.2, lean: -0.04, fx: { web: 0.3, spin: 0 } },
    { abd: 0.26, lean: -0.05, fx: { web: 0.8, spin: 1 } },
    { abd: 0.22, lean: -0.04, fx: { web: 1.25, spin: 0 } },
    { abd: 0.26, lean: -0.05, fx: { web: 1.6, spin: 1 } },
    { abd: 0.2, lean: -0.04, fx: { web: 2, spin: 0 } },
    { abd: 0.08, head: -0.06, fx: { web: 2, tok: 1 } },
    { abd: 0.06, head: -0.1, eyeMode: 'happy', fx: { web: 2, tok: 2, star: 1 } },
    { abd: 0.04, fx: { web: 2, tok: 2 } },
  ];

  K.kits.bug.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    neck: [20, -190],
    waist: [-30, -196],
    headScale: 1.06,
    bodyC: [-40, -220],
    bodyR: 240,
    parts: [
      { id: 'abd', T: 'a', pts: ABD, smooth: false, fill: C.abd, deep: C.bodyDeep, hair: 1 },
      // in front of the near legs: they arch out from behind the head and never cross the face
      { id: 'ceph', T: 'h', z: 'front', pts: CEPH, smooth: false, fill: C.body, deep: C.bodyDeep, hair: 0.7 },
    ],
    legs: [
      // splayed wide at about 45 degrees: knees up above the back, feet far out, body low
      { hip: [110, -176], foot: 440, l1: 242, l2: 360, phase: 0, r1: 14, r2: 10 },
      { hip: [78, -184], foot: 300, l1: 235, l2: 345, phase: 0.5, r1: 14, r2: 10 },
      { hip: [40, -188], foot: -220, l1: 234, l2: 358, phase: 0, r1: 14, r2: 10, under: true },
      { hip: [6, -184], foot: -380, l1: 256, l2: 358, phase: 0.5, r1: 14, r2: 10, under: true },
    ],
    legR: 14,
    sit: 80,
    farHip: [-12, -10],
    farFoot: -26,
    stride: 58,
    lift: 42,
    sleepLow: 30,
    eyes: [
      { x: 84, y: -252, r: 7 },
      { x: 158, y: -276, r: 8 },
      { x: 128, y: -280, r: 10 },
      { x: 100, y: -272, r: 9 },
      { x: 172, y: -234, r: 18 },
      { x: 130, y: -230, r: 27 },
    ],
    mouthAt: [176, -150],
    shadowW: 300,
    hooks: {
      part: tuft,
      leg: legHair,
      body: harness,
      face: fangs,
      head: feelers,
      behind(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.web) web(ctx, B, fx.web);
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.spin) {
          // the blur of legs at work: arcs behind the raised back legs
          for (let k = 0; k < 3; k++) {
            const c = M.ap(R.Mb, [-210, -400 + k * 40]);
            const arc = [];
            for (let i = 0; i <= 8; i++) arc.push([c[0] + Math.cos(-2.6 + i * 0.22) * (70 + k * 16), c[1] + Math.sin(-2.6 + i * 0.22) * (70 + k * 16)]);
            K.line(ctx, arc, { width: 4, color: P.inkSoft, alpha: 0.7, seed: sd('blur', k), boil: B, taper: [6, 6] });
          }
        }
        if (fx.tok === 1) {
          K.fx.token(ctx, HUB[0] + 330, HUB[1] - 60, 26, 0.35, B, sd('tokF'));
          K.fx.speed(ctx, [HUB[0] + 470, HUB[1] - 60], 120, 0.7, B, sd('tokS'));
        }
        if (fx.tok === 2) K.fx.token(ctx, HUB[0] + 70, HUB[1] + 40, 26, 0.1, B, sd('tokW'));
        if (fx.star) {
          K.fx.star(ctx, HUB[0] + 120, HUB[1] - 10, 30, B, sd('s1'), '#FFF1C4');
          K.fx.star(ctx, HUB[0] + 20, HUB[1] + 90, 20, B, sd('s2'), '#FFF1C4');
        }
      },
    },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { sway: Math.sin((Math.PI * 2 * d) / n) * 0.6 } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { sway: Math.sin((Math.PI * 2 * d) / n) } });
      },
      // tucked in a little, not folded up: long legs folded all the way stand up like sticks
      sleep(d, n, P0) {
        return Object.assign(P0.sleep(d, n), { fold: 0.3 });
      },
      work(d, n, P0, S) {
        const T = WORK[d];
        const legs = K.kits.bug.stand(S);
        if (d <= 4) {
          // the back legs up at the web, taking turns
          const up = d % 2;
          legs.n[3] = { x: -330, lift: up ? 300 : 220 };
          legs.n[2] = { x: -250, lift: up ? 140 : 220 };
          legs.f[3] = { x: -350, lift: up ? 220 : 300 };
        }
        return Object.assign({}, T, { legs, fx: T.fx });
      },
    },
  });
})();
