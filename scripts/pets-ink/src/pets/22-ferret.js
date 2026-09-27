// pets/22-ferret.js : Хорёк-контрабандист (uncommon, rate). Front kit, stands up like a sentry.
// A cream polecat-ferret standing tall on its dark hind legs: a dark mask round bead eyes, a white
// muzzle and white rims on its little round ears, a pink nose. It wears a flat cap tilted over one
// ear, a thin red scarf and a long shabby coat whose lining is full of contraband: pocket watches
// on chains, a key, a gold token. A dark bushy tail curls out at the side. Work: a glance left, a
// glance right, the coat flung open ("psst"), a stopwatch pulled from it and clicked — speed.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'ferret';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#E9D9B8',
    furDeep: '#A88F66',
    furLit: '#F8EFDA',
    belly: '#F6EFDF',
    muzzle: '#FBF6EC',
    mask: '#6A4E3C',
    dark: '#4F3A2A',
    leg: '#4F3A2A',
    foot: '#4F3A2A',
    paw: '#4F3A2A',
    pad: '#C98A86',
    arm: '#6F6C5A',
    skin: '#E3A195',
    nose: '#E59A92',
    blush: '#E88C88',
    mouth: '#5E2220',
    tongue: '#E88E86',
    eyeLine: '#F1E6D0',
    coat: '#6F6C5A',
    coatDeep: '#46443A',
    coatLit: '#8F8C78',
    lining: '#8C2F2C',
    liningDeep: '#5C1A18',
    button: '#3A2A1E',
    cap: '#7A6A52',
    capDeep: '#4E4332',
    scarf: '#BE3A2E',
    scarfDeep: '#7A2019',
    gold: '#E2B650',
    goldDeep: '#9A7424',
    steel: '#D3D8DB',
    steelDeep: '#7D858A',
  };

  // ---- the mask: a dark patch round each eye, joined over the bridge of the nose, out to the cheeks
  function mask(c2, R) {
    const T = R.Mh;
    for (const s of [-1, 1]) {
      const pts = [R.hl(s * 22, -40, 0.9), R.hl(s * 58, -58, 0.85), R.hl(s * 104, -46, 0.6), R.hl(s * 140, -8, 0.35), R.hl(s * 142, 40, 0.3), R.hl(s * 118, 50, 0.45), R.hl(s * 90, 22, 0.7), R.hl(s * 56, 20, 0.85), R.hl(s * 28, 2, 0.95)];
      K.fill(c2, M.all(T, K.smooth(pts, 4)), C.mask);
    }
    // a pale stripe up the forehead between the patches
    K.fill(c2, M.all(T, K.smooth([R.hl(-14, -30, 0.95), R.hl(0, -140, 0.6), R.hl(14, -30, 0.95), R.hl(0, -6, 1)], 4)), C.furLit);
  }

  // ---- the coat
  const SHOULDER = 112;
  function flapPts(side, open) {
    // the right front flap (side 1), swung out about the shoulder when open
    const pts = [[30, -404], [SHOULDER, -392], [136, -300], [150, -180], [176, -52], [44, -44], [38, -200], [42, -300]];
    const a = -side * open * 0.95;
    const p0 = [side * SHOULDER, -392];
    return pts.map(([x, y]) => {
      const X = x * side - p0[0], Y = y - p0[1];
      return [p0[0] + X * Math.cos(a) - Y * Math.sin(a), p0[1] + X * Math.sin(a) + Y * Math.cos(a)];
    });
  }

  function coatBack(ctx, R, B) {
    const T = R.Mb;
    const pts = K.smooth([[-SHOULDER, -396], [SHOULDER, -396], [150, -300], [176, -170], [196, -46], [120, -30], [0, -26], [-120, -30], [-196, -46], [-176, -170], [-150, -300]], 4);
    F().form(ctx, M.all(T, pts), C.coatDeep, B, sd('coatB'), { width: 7, off: 0.1, hatch: 0.7 });
  }

  function watch(ctx, c, r, B, seed, turn = 0) {
    K.line(ctx, [[c[0], c[1] - r], [c[0] + 6, c[1] - r - 12]], { width: 4, color: C.goldDeep, seed: seed + 3, boil: B, taper: 0 });
    const w = L.ellipsePts(c[0], c[1], r * (1 - 0.3 * Math.abs(turn)), r, 18);
    F().form(ctx, w, C.gold, B, seed, { width: 3.6, off: 0.14, shine: 0.9, hatch: 0.2, rim: false, dark: C.goldDeep });
    K.fill(ctx, L.ellipsePts(c[0], c[1], r * 0.66 * (1 - 0.3 * Math.abs(turn)), r * 0.66, 14), '#FBF4E2');
    K.line(ctx, [[c[0], c[1]], [c[0], c[1] - r * 0.5], [c[0], c[1]], [c[0] + r * 0.36, c[1] + r * 0.1]], { width: 2.4, seed: seed + 5, boil: B, smooth: false, taper: 0 });
  }

  function coatFront(ctx, R, B) {
    const T = R.Mb;
    const open = (R.pose.fx && R.pose.fx.open) || 0;
    for (const s of [-1, 1]) {
      const pts = M.all(T, K.smooth(flapPts(s, open), 4));
      const inside = open > 0.3;
      F().form(ctx, pts, inside ? C.lining : C.coat, B, sd('flap', s), {
        width: 7,
        off: 0.1,
        hatch: 0.6,
        inside(c2) {
          if (inside) {
            // the lining: quilted, and the contraband pinned to it in rows
            L.hatch(c2, pts, { angle: 0.8, spacing: 22, width: 2, color: C.liningDeep, alpha: 0.6, clip: true, seed: sd('q1', s), boil: B });
            L.hatch(c2, pts, { angle: -0.8, spacing: 22, width: 2, color: C.liningDeep, alpha: 0.6, clip: true, seed: sd('q2', s), boil: B });
            return;
          }
          // a pocket with its flap and a patch on the hem
          const pk = M.all(T, L.rrectPts(s * 70 - 30, -170, 60, 44, 6, 4));
          L.inkPath(c2, pk, { closed: true, width: 3.4, seed: sd('pk', s), boil: B, wobble: 0.4 });
          K.line(c2, M.all(T, [[s * 70 - 34, -170], [s * 70 + 34, -170]]), { width: 7, color: C.coatDeep, seed: sd('pkf', s), boil: B, taper: 0 });
          fold(c2, T, s, B);
        },
      });
      if (inside) {
        // watches, a key and a token on the open lining
        const ro = (x, y) => {
          const p = flapPts(s, open);
          // place in the flap's own frame: interpolate between the inner edge and the outer side
          const inner = [lerp(p[6][0], p[5][0], y), lerp(p[6][1], p[5][1], y)];
          const outer = [lerp(p[2][0], p[4][0], y), lerp(p[2][1], p[4][1], y)];
          return M.ap(T, [lerp(inner[0], outer[0], x), lerp(inner[1], outer[1], x)]);
        };
        watch(ctx, ro(0.3, 0.05), 20, B, sd('w1', s), 0.2);
        watch(ctx, ro(0.7, 0.25), 18, B, sd('w2', s), -0.3);
        if (s > 0) K.key(ctx, ...ro(0.35, 0.62), 1.1, 0.8, C.gold, C.goldDeep, B, sd('key'));
        else K.fx.token(ctx, ...ro(0.4, 0.6), 22, 0.2, B, sd('tok'));
        watch(ctx, ro(0.65, 0.85), 16, B, sd('w3', s), 0.1);
        if (R.pose.fx.glint) K.fx.star(ctx, ...ro(0.5, 0.35), 34 * R.pose.fx.glint, B, sd('lg', s), '#FFF1C4');
      } else {
        // lapels folded back, buttons down the right flap
        const lap = M.all(T, [[s * 30, -404], [s * 84, -334], [s * 42, -300]]);
        F().form(ctx, lap, C.coatLit, B, sd('lap', s), { width: 5, off: 0.1, hatch: 0.3, rim: false, smooth: false });
        if (s > 0) for (let k = 0; k < 3; k++) {
          const b = M.ap(T, [56, -250 + k * 62]);
          K.fill(ctx, L.ellipsePts(b[0], b[1], 9, 9, 10), C.button);
          L.inkPath(ctx, L.ellipsePts(b[0], b[1], 9, 9, 10), { closed: true, width: 2.6, seed: sd('btn', k), boil: B, wobble: 0.2 });
        }
      }
    }
  }
  function fold(c2, T, s, B) {
    K.line(c2, M.all(T, K.curve([[s * 100, -330], [s * 108, -220], [s * 130, -90]], 4)), { width: 3, color: C.coatDeep, alpha: 0.8, seed: sd('fold', s), boil: B });
  }

  function scarf(ctx, R, B) {
    const T = R.Mb;
    const band = M.all(T, K.smooth([[-104, -414], [0, -396], [104, -414], [100, -386], [0, -368], [-100, -386]], 4));
    F().form(ctx, band, C.scarf, B, sd('scarf'), { width: 5, off: 0.12, hatch: 0.4 });
    const sw = Math.sin(R.pose.tail * 3) * 8;
    for (const [k, len] of [[0, 150], [1, 118]]) {
      const x0 = -60 + k * 26;
      const tl = M.all(T, K.smooth([[x0 - 18, -384], [x0 + 18, -384], [x0 + 22 + sw, -384 + len], [x0 - 14 + sw, -384 + len + 10]], 3));
      F().form(ctx, tl, C.scarf, B, sd('stail', k), {
        width: 4.5,
        off: 0.1,
        hatch: 0.4,
        rim: false,
        inside: (c2) => K.line(c2, M.all(T, [[x0 - 20 + sw, -384 + len - 16], [x0 + 24 + sw, -384 + len - 20]]), { width: 7, color: C.scarfDeep, seed: sd('sfr', k), boil: B, taper: 0 }),
      });
    }
  }

  function cap(ctx, R, B) {
    const T = M.mul(R.Mh, M.about(-0.16, 0, -110));
    const c = R.hl(10, -118, 0.3);
    // the crown of a flat eight-panel cap, a button on top, the brim toward us
    const crown = M.all(T, K.smooth([[c[0] - 128, c[1] + 20], [c[0] - 110, c[1] - 30], [c[0] - 40, c[1] - 66], [c[0] + 50, c[1] - 66], [c[0] + 124, c[1] - 30], [c[0] + 138, c[1] + 18], [c[0], c[1] + 34]], 4));
    F().form(ctx, crown, C.cap, B, sd('cap'), {
      width: 7,
      off: 0.12,
      hatch: 0.6,
      inside(c2) {
        for (const x of [-90, -36, 26, 84]) K.line(c2, M.all(T, K.curve([[c[0] + 4, c[1] - 58], [c[0] + x * 0.8, c[1] - 20], [c[0] + x, c[1] + 22]], 4)), { width: 3, color: C.capDeep, seed: sd('seam', x), boil: B });
        L.hatch(c2, crown, { angle: 0.3, spacing: 9, width: 1.6, color: C.capDeep, alpha: 0.35, clip: true, seed: sd('tweed'), boil: B });
      },
    });
    const bt = M.all(T, L.ellipsePts(c[0] + 4, c[1] - 62, 12, 7, 10));
    F().form(ctx, bt, C.capDeep, B, sd('capb'), { width: 3.4, off: 0.1, hatch: 0, rim: false });
    const brim = M.all(T, K.smooth([[c[0] - 110, c[1] + 18], [c[0] + 118, c[1] + 16], [c[0] + 96, c[1] + 44], [c[0], c[1] + 56], [c[0] - 92, c[1] + 44]], 4));
    F().form(ctx, brim, C.capDeep, B, sd('brim'), { width: 6, off: 0.14, hatch: 0.5, rim: false });
  }

  function stopwatch(ctx, c, pressed, B) {
    const r = 34;
    K.line(ctx, [[c[0], c[1] - r - 2], [c[0], c[1] - r - (pressed ? 8 : 18)]], { width: 16, color: P.ink, seed: sd('swb'), boil: B, taper: 0 });
    K.line(ctx, [[c[0], c[1] - r - 2], [c[0], c[1] - r - (pressed ? 8 : 18)]], { width: 10, color: C.steelDeep, seed: sd('swb'), boil: B, taper: 0 });
    const face = L.ellipsePts(c[0], c[1], r, r, 22);
    F().form(ctx, face, C.steel, B, sd('sw'), { width: 5, off: 0.12, shine: 1, hatch: 0.3 });
    K.fill(ctx, L.ellipsePts(c[0], c[1], r * 0.72, r * 0.72, 18), '#FFFBEF');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      K.line(ctx, [[c[0] + Math.cos(a) * r * 0.56, c[1] + Math.sin(a) * r * 0.56], [c[0] + Math.cos(a) * r * 0.68, c[1] + Math.sin(a) * r * 0.68]], { width: 2.2, seed: sd('tick', k), boil: B, smooth: false, taper: 0 });
    }
    const ha = pressed ? 0.4 : -0.9;
    K.line(ctx, [[c[0], c[1]], [c[0] + Math.sin(ha) * r * 0.6, c[1] - Math.cos(ha) * r * 0.6]], { width: 3.4, color: C.scarf, seed: sd('hand'), boil: B, smooth: false, taper: [1, 3] });
    if (pressed)
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k - 1) * 0.5;
        K.line(ctx, [[c[0] + Math.cos(a) * (r + 30), c[1] + Math.sin(a) * (r + 30)], [c[0] + Math.cos(a) * (r + 52), c[1] + Math.sin(a) * (r + 52)]], { width: 5, seed: sd('clk', k), boil: B, smooth: false, taper: [2, 4] });
      }
  }

  const WORK = [
    { turn: -0.6, look: [-0.8, 0.1], lid: 0.3, hx: -10, arm: { l: 0.05, r: 0.05 }, fx: {} },
    { turn: 0.6, look: [0.8, 0.1], lid: 0.3, hx: 10, arm: { l: 0.05, r: 0.05 }, fx: {} },
    { arm: { l: 1.15, r: 1.15 }, sq: 1.04, mouth: 0.5, fx: { open: 1, glint: 1 } },
    { arm: { l: 1.1, r: 1.1 }, eyeR: 'happy', fx: { open: 1, glint: 0.6 } },
    { arm: { l: 0.3, r: 1.7 }, look: [0.4, -0.3], fx: { open: 0.35, watch: 1 } },
    { arm: { l: 0.1, r: 1.8 }, sq: 0.97, look: [0.4, -0.4], mouth: 0.4, fx: { watch: 2, speed: 1 } },
    { arm: { l: 0.1, r: 1.8 }, eye: 'happy', mouth: 0.7, fx: { watch: 2, speed: 0.6 } },
    { arm: { l: 0.05, r: 0.05 }, lid: 0.3, fx: {} },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'stand',
    bodyC: [0, -230],
    bodyR: 250,
    body: { half: [[0, -410], [70, -402], [106, -364], [120, -270], [124, -160], [114, -80], [80, -42], [0, -36]] },
    belly: [0, -220, 56, 150],
    legs: { hip: [54, -50], r: 24, foot: [42, 24], splay: 10 },
    arms: [{ at: [106, -366], len: 176, r: 24, pr: 26, rest: 0.22, pads: true }],
    tail: { pts: [[90, -70], [200, -52], [266, -120], [262, -226], [226, -276]], w0: 36, w1: 30, fill: C.dark, bushy: true, lit: '#6E5642', deep: '#2E2118', swing: 0.8 },
    head: { c: [0, -556], rx: 152, ry: 140, half: [[0, -128], [80, -122], [130, -90], [152, -36], [148, 18], [128, 60], [92, 96], [52, 126], [0, 142]] },
    ears: {
      at: [128, -82],
      pts: [[-34, 16], [-38, -26], [-10, -54], [28, -50], [46, -18], [36, 18]],
      inner: [[-20, 10], [-22, -20], [-4, -38], [20, -34], [30, -12], [22, 12]],
      fill: C.furLit,
      innerFill: C.skin,
      tilt: 0.2,
      flop: 0.3,
    },
    face: {
      eyes: { x: 62, y: -16, rx: 27, ry: 29, beadLit: '#5A4636' },
      muzzle: { half: [[0, 20], [40, 22], [70, 44], [80, 76], [66, 112], [34, 132], [0, 138]] },
      nose: { y: 50, w: 22, h: 16 },
      mouth: { y: 78, w: 18, drop: 12, h: 26, style: 'cat' },
      whiskers: { x: 50, y: 62, len: 96 },
      blush: [100, 66, 20],
    },
    shadowW: 220,
    attack: 'bite',
    hooks: {
      behind: coatBack,
      skin: mask,
      bodyAfter: coatFront,
      front: scarf,
      head: cap,
      hand(ctx, R, B, side, end) {
        const fx = R.pose.fx || {};
        if (side > 0 && fx.watch) stopwatch(ctx, [end[0] + 2, end[1] - 40], fx.watch === 2, B);
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.speed) {
          K.fx.speed(ctx, M.ap(R.Mr, [-200, -300]), 200, fx.speed, B, sd('sp1'));
          K.fx.speed(ctx, M.ap(R.Mr, [-230, -160]), 170, fx.speed * 0.8, B, sd('sp2'));
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { turn: T.turn || 0, hx: T.hx || 0, look: T.look || null, lid: T.lid == null ? null : T.lid, sq: T.sq || 1, eyeMode: T.eye || 'open', eyeR: T.eyeR || null, mouth: T.mouth || 0, arm: T.arm, fx: T.fx };
      },
    },
  });
})();
