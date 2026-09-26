// pets/32-owl.js : Сова-фонарщица (rare, luck). Bird kit, waddles.
// A round little eagle-owl: a big head with no neck, long ear tufts, a pale facial disc with a
// dark rim, two huge orange eyes (the head turns a three-quarter face to us), a small hooked beak,
// a streaked cream chest, barred wings, feathered legs with dark talons. A brass lamp strapped to
// her forehead. Work: switches the lamp on, sweeps the beam over the
// ground, finds a hidden crystal — the luck of the camp.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const ID = 'owl';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9C7250',
    furDeep: '#5E4128',
    furLit: '#C49A70',
    chest: '#E1CBA2',
    streak: '#6B4A2E',
    disc: '#EAD9B8',
    rim: '#5E4128',
    wing: '#8E6646',
    wingDeep: '#553A22',
    primary: '#7E5A3C',
    covert: '#A87E58',
    wingLine: '#553A22',
    secondary: '#8E6646',
    spot: '#E6D0A6',
    tail: '#8E6646',
    beak: '#3A302A',
    beakDeep: '#1C1612',
    leg: '#D9C09A',
    legDeep: '#9C7E5A',
    eye: '#1A110E',
    brass: '#D2A546',
    brassDeep: '#86621F',
    glass: '#FFF3B8',
    glassOff: '#9DB3B8',
    strap: '#5A3A24',
    strapDeep: '#35210F',
    gem: '#6FC3E8',
    gemDeep: '#2C7FA6',
  };

  const SIL = [
    [-120, -150, 0],
    [-160, -210, 0],
    [-168, -290, 0],
    [-146, -350, 0.3],
    [-112, -410, 0.8],
    [-62, -462, 1],
    [20, -492, 1],
    [104, -482, 1],
    [160, -450, 1],
    [180, -392, 1],
    [168, -338, 0.8],
    [146, -300, 0.4],
    [142, -240, 0],
    [122, -180, 0],
    [60, -140, 0],
    [-40, -130, 0],
  ];

  const WING = {
    fold: [[40, -320], [0, -330], [-70, -312], [-130, -270], [-160, -222], [-172, -192], [-150, -178], [-100, -172], [-30, -184], [20, -222], [48, -272]],
    spread: [[40, -320], [30, -400], [-4, -490], [-60, -550], [-130, -570], [-190, -540], [-180, -490], [-146, -430], [-90, -380], [-30, -340], [44, -300]],
    covert: [[40, -320], [0, -330], [-74, -312], [-60, -270], [0, -266], [46, -290]],
    covertSpread: [[40, -320], [30, -400], [-4, -490], [-24, -440], [0, -380], [40, -326]],
    wrist: [-50, -280],
    wristSpread: [-40, -490],
    tips: [3, 4, 5],
    feather: 54,
    trail: [7, 8, 9],
    secLen: 22,
  };

  const LAMP = [118, -466];
  const BEAK_TIP = [128, -362];

  function markings(ctx, R, B) {
    const T = R.Mb;
    // the pale streaked chest
    const chest = M.all(T, K.smooth([[60, -320], [130, -300], [146, -230], [120, -160], [40, -140], [20, -230]], 5));
    K.fill(ctx, chest, C.chest);
    for (let k = 0; k < 9; k++) {
      const x = 44 + (k % 3) * 30 + (Math.floor(k / 3) % 2) * 14, y = -290 + Math.floor(k / 3) * 44;
      K.line(ctx, M.all(T, [[x, y], [x - 2, y + 20]]), { width: 5, color: C.streak, seed: sd('streak', k), boil: B, taper: [3, 3] });
    }
    // pale mottling down the back
    for (let k = 0; k < 7; k++) {
      const x = -140 + (k % 3) * 24, y = -330 + k * 22;
      K.fill(ctx, M.all(T, L.ellipsePts(x, y, 6, 4, 8)), C.spot, 0.9);
    }
  }

  function barring(c2, R, B, T, t) {
    // rows of pale spots across the wing (an owl's barred feathers)
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 4; k++) {
        const u = (k + 0.5 + row * 0.3) / 4.4;
        const a = [lerp(20, -150, u), lerp(-300, -220, u) + row * 26];
        const b = [lerp(20, -150, u) + 6, lerp(-500, -560, u) + row * 40];
        const p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
        K.fill(c2, M.all(T, L.ellipsePts(p[0], p[1], 9, 5, 8, 0.4)), C.spot, 0.9);
      }
    }
  }

  // the ear tufts: long feathers swept back, each ending in two points (the far one behind the head)
  function tuft(ctx, R, B, near) {
    const H = R.Mh;
    const perk = R.pose.fx && R.pose.fx.perk ? 1 : 0;
    const base = near ? [4, -482] : [80, -482];
    const ang = (near ? -0.55 : -0.3) + 0.18 * perk;
    const len = (near ? 92 : 80) * (1 + 0.1 * perk);
    const T = M.chain(H, M.tr(base[0], base[1]), M.rot(ang));
    const pts = M.all(T, K.smooth([[-24, 6], [-18, -len * 0.5], [-10, -len], [-2, -len * 0.78], [8, -len * 0.92], [12, -len * 0.5], [22, 6]], 4));
    K.form(ctx, pts, { fill: K.far(C.fur, !near), deep: C.furDeep, width: near ? 6 : 5, seed: sd('tuft', near ? 1 : 0), boil: B, shade: 0.6, spacing: 6 });
    K.line(ctx, M.all(T, [[0, -8], [-4, -len * 0.7]]), { width: 3, color: C.furDeep, seed: sd('tuftLine', near ? 1 : 0), boil: B, taper: [2, 6] });
    K.line(ctx, M.all(T, [[-12, -len * 0.3], [-8, -len * 0.55]]), { width: 2.4, color: C.spot, seed: sd('tuftLit', near ? 1 : 0), boil: B, taper: [2, 4] });
  }

  // the three-quarter face: the pale disc with its dark rim and the far eye, before the beak
  function faceFront(ctx, R, B) {
    const H = R.Mh, pose = R.pose;
    const disc = M.all(H, K.smooth([[40, -452], [104, -474], [168, -448], [178, -392], [160, -340], [104, -326], [44, -348], [26, -404]], 5));
    K.fill(ctx, disc, C.disc);
    K.line(ctx, M.all(H, K.curve([[92, -472], [44, -450], [24, -404], [40, -352], [96, -326]], 5)), { width: 7, color: C.rim, seed: sd('rim'), boil: B, taper: [6, 6] });
    // feathery lines radiating from the eyes
    for (let k = 0; k < 5; k++) {
      const a = 2.2 + k * 0.45;
      K.line(ctx, M.all(H, [[80 + Math.cos(a) * 34, -414 + Math.sin(a) * 38], [80 + Math.cos(a) * 52, -414 + Math.sin(a) * 58]]), { width: 2.4, color: C.legDeep, alpha: 0.8, seed: sd('ray', k), boil: B, taper: [2, 4] });
    }
    K.eye(ctx, H, 144, -416, { r: 19, style: 'iris', iris: '#F29A2E', lid: pose.eyeMode === 'happy' ? 0 : 0.14, lidColor: C.disc, mode: pose.eyeMode, open: pose.eye, look: pose.fx && pose.fx.look }, B, sd('eyeFar'));
  }

  function lamp(ctx, R, B, on) {
    const H = R.Mh;
    const strap = M.all(H, K.curve([[-70, -440], [0, -476], [70, -484], [128, -470]], 6));
    // the strap lies on the head: clipped to the outline, so it never crosses a raised wing
    K.clip(ctx, R.body, () => {
      K.line(ctx, strap, { width: 16, color: P.ink, seed: sd('strap'), boil: B, taper: 0 });
      K.line(ctx, strap, { width: 10, color: C.strap, seed: sd('strap'), boil: B, taper: 0 });
    });
    const body = M.all(H, L.rrectPts(LAMP[0] - 30, LAMP[1] - 22, 42, 40, 8, 6));
    K.plate(ctx, body, { fill: C.brass, deep: C.brassDeep, width: 5, seed: sd('lamp'), boil: B });
    const glass = M.all(H, L.ellipsePts(LAMP[0] + 14, LAMP[1] - 2, 12, 18, 16));
    K.form(ctx, glass, { fill: on ? C.glass : C.glassOff, deep: C.brassDeep, width: 4.5, seed: sd('glass'), boil: B, shade: on ? 0 : 0.5, spacing: 4 });
    if (on) {
      const g = M.ap(H, [LAMP[0] + 14, LAMP[1] - 2]);
      K.fill(ctx, L.ellipsePts(g[0], g[1], 40, 40, 20), P.annYellow, 0.25);
    }
  }

  function crystal(ctx, x, y, s, B) {
    const pts = [[x, y - 34 * s], [x + 16 * s, y - 8 * s], [x + 8 * s, y + 8 * s], [x - 10 * s, y + 8 * s], [x - 16 * s, y - 10 * s]];
    K.form(ctx, pts, { fill: C.gem, deep: C.gemDeep, width: 4, seed: sd('gem'), boil: B, shade: 0.6, spacing: 4, hatchW: 1.6, smooth: false });
    K.line(ctx, [[x, y - 34 * s], [x - 2 * s, y + 8 * s]], { width: 2.4, color: '#E6F7FF', seed: sd('gemFacet'), boil: B, smooth: false, taper: 0 });
  }

  // the beam from the lamp to a spot on the ground
  function beam(ctx, R, B, u) {
    const g = M.ap(R.Mh, [LAMP[0] + 14, LAMP[1] - 2]);
    const x = K.CX + lerp(180, 420, u), y = K.GROUND - 8;
    const w = 70;
    const cone = [[g[0], g[1] - 12], [x + w, y], [x - w, y], [g[0], g[1] + 12]];
    K.fill(ctx, cone, P.annYellow, 0.28);
    K.fill(ctx, L.ellipsePts(x, y, w, 16, 24), P.annYellow, 0.4);
    L.inkPath(ctx, [cone[0], cone[1]], { width: 3, alpha: 0.35, seed: sd('beamA'), boil: B, smooth: false, taper: [2, 2] });
    L.inkPath(ctx, [cone[3], cone[2]], { width: 3, alpha: 0.35, seed: sd('beamB'), boil: B, smooth: false, taper: [2, 2] });
    return [x, y];
  }

  const SPOT = 0.86;
  const WORK = [
    { head: -0.08, fx: { look: [0.3, 0], lamp: 0 } },
    { head: 0.18, fx: { look: [0.3, 0.3], lamp: 1, beam: 0.1 } },
    { head: 0.24, fx: { look: [0.35, 0.35], lamp: 1, beam: 0.35, sway: 0.6 } },
    { head: 0.3, fx: { look: [0.4, 0.4], lamp: 1, beam: 0.6, sway: -0.4 } },
    { head: 0.32, fx: { look: [0.4, 0.45], lamp: 1, beam: SPOT, gem: 0.6 } },
    { head: 0.1, sq: 1.05, beak: 0.5, fx: { look: [0.3, 0.3], lamp: 1, beam: SPOT, gem: 1, star: 1, perk: 1 } },
    { head: 0.05, sq: 1.04, wing: 0.25, wingF: 0.25, eyeMode: 'happy', fx: { lamp: 1, beam: SPOT, gem: 1, star: 0.7, perk: 1 } },
    { head: 0.1, fx: { look: [0.3, 0.3], lamp: 1, beam: SPOT, gem: 1 } },
  ];

  K.kits.bird.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [20, -340],
    headScale: 1.12,
    bodyC: [-10, -290],
    bodyR: 200,
    gait: 'waddle',
    stride: 30,
    feet: { n: 40, f: 10 },
    wing: WING,
    tailFan: { base: [-150, -178], angle: Math.PI + 0.6, spread: 0.42, n: 5, len: 76, width: 19, taper: 0.1, band: C.spot, fill: () => C.tail },
    sit: 44,
    sleepLow: 16,
    leg: { hipN: [40, -140], hipF: [10, -144], l1: 26, l2: 40, r: 15, toe: 30, thighR: 1.5, thigh: C.leg, claw: '#2A2320' },
    tufts: false,
    fur: true,
    shadowW: 190,
    beak: { hinge: [114, -398], tip: BEAK_TIP, upper: [[102, -404], [126, -408], [138, -386], [130, -360], [118, -374], [104, -388]], lower: [[106, -384], [124, -382], [122, -368], [110, -372]] },
    face: { eye: { x: 80, y: -414, r: 26, style: 'iris', iris: '#F29A2E', lid: 0.14, lidColor: C.disc } },
    hooks: {
      behind(ctx, R, B) {
        tuft(ctx, R, B, false);
      },
      body: markings,
      wingInside: barring,
      front: faceFront,
      head(ctx, R, B) {
        tuft(ctx, R, B, true);
        lamp(ctx, R, B, !!(R.pose.fx && R.pose.fx.lamp));
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (!fx) return;
        if (fx.beam) {
          const at = beam(ctx, R, B, fx.beam);
          if (fx.gem) crystal(ctx, at[0], at[1] - 4, fx.gem * 1.4, B);
          if (fx.star) {
            K.fx.star(ctx, at[0] + 34, at[1] - 50, 30 * fx.star, B, sd('s1'), '#FFF1C4');
            K.fx.star(ctx, at[0] - 30, at[1] - 30, 20 * fx.star, B, sd('s2'), '#E6F7FF');
          }
        }
      },
    },
    poses: {
      idle(d, n, P0) {
        // an owl's slow head turn instead of the pigeon's glance
        const p = P0.idle(d, n);
        return Object.assign(p, { hx: 0, fx: { look: [0.15 + 0.25 * Math.sin((Math.PI * 2 * d) / n), 0], sway: Math.sin((Math.PI * 2 * d) / n) * 0.4 } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { sway: Math.sin((Math.PI * 2 * d) / n) } });
      },
      work(d, n, P0) {
        return Object.assign({ feet: P0.idle(0, 12).feet }, WORK[d]);
      },
    },
  });
})();
