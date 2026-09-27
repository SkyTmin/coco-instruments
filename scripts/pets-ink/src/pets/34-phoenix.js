// pets/34-phoenix.js : Феникс свободы (mythic, every role). Front kit, a firebird facing us.
// A crimson firebird with an orange-gold breast, gold coverts and orange flight feathers, a small
// gold hooked beak, proud gold eyes with a gold stroke trailing from each, a crest of gold feathers
// with little flames on their tips, three long tail plumes that end in fire, a warm glow round him
// and embers always drifting off. On one leg the iron cuff of a shackle he broke. Work: bursts into
// flame, burns down to a glowing ember, is reborn out of it with his wings wide — and the ember
// rains down as coins and tokens.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'phoenix';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;
  const FIRE = ['#D8402A', '#F28A2C', '#FFE08A'];

  const C = {
    fur: '#C8302A',
    furDeep: '#7A1614',
    furLit: '#EE6A4A',
    belly: '#F2A640',
    wing: '#B82A26',
    covert: '#E8B84A',
    primary: '#F07A2A',
    secondary: '#D8502A',
    wingLine: '#7A1614',
    tail: '#C8302A',
    leg: '#E0B040',
    beak: '#F0C040',
    beakLow: '#D09A28',
    beakDeep: '#8A5A10',
    gold: '#F2C14E',
    goldDeep: '#A0741E',
    blush: '#F08A6A',
    mouth: '#6A1A14',
    eyeLine: '#FFE6B0',
    iron: '#6E747A',
    ironDeep: '#3C4044',
  };

  function glow(ctx, R) {
    const c = M.ap(R.Mb, [0, -330]);
    const g = ctx.createRadialGradient(c[0], c[1], 60, c[0], c[1], 420);
    g.addColorStop(0, L.rgba('#FFB050', 0.35));
    g.addColorStop(1, L.rgba('#FFB050', 0));
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c[0], c[1], 420, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A plume: a thin shaft opening into a flame-shaped vane with a gold eye, base to tip. */
  function plume(ctx, base, tip, w, B, seed) {
    const dx = tip[0] - base[0], dy = tip[1] - base[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const at = (u, v) => [base[0] + ux * l * u + nx * v, base[1] + uy * l * u + ny * v];
    // the vane: widest at 70%, three flame licks at the end
    const vane = K.smooth([at(0.28, 0), at(0.55, w * 0.62), at(0.78, w), at(0.94, w * 0.7), at(1.06, w * 0.3), at(1.16, w * 0.32), at(1.08, -w * 0.2), at(0.94, -w * 0.72), at(0.78, -w), at(0.55, -w * 0.62)], 4);
    K.line(ctx, [base, at(0.4, 0)], { width: 9, color: P.ink, seed: seed + 1, boil: B, taper: [2, 2] });
    K.line(ctx, [base, at(0.4, 0)], { width: 5, color: C.gold, seed: seed + 1, boil: B, taper: [2, 2] });
    F().form(ctx, vane, C.primary, B, seed, {
      width: 5,
      off: 0.06,
      hatch: 0.3,
      inside(c2) {
        // fire colours toward the tip, an eye in the middle, barbs
        K.fill(c2, K.smooth([at(0.86, w * 0.62), at(1.1, w * 0.22), at(0.9, -w * 0.5), at(0.94, 0)], 4), '#FFD166');
        K.fill(c2, L.ellipsePts(...at(0.7, 0), w * 0.42, w * 0.34, 16, Math.atan2(uy, ux)), C.fur);
        K.fill(c2, L.ellipsePts(...at(0.7, 0), w * 0.22, w * 0.18, 12, Math.atan2(uy, ux)), C.gold);
        for (let k = 0; k < 6; k++) {
          const u = 0.45 + k * 0.08;
          for (const s of [-1, 1]) K.line(c2, [at(u, 0), at(u + 0.06, s * w)], { width: 2, color: C.furDeep, alpha: 0.5, seed: seed + 10 + k * 2 + (s > 0 ? 1 : 0), boil: B, taper: 0 });
        }
      },
    });
  }

  function plumes(ctx, R, B) {
    // a fan of long plumes spread behind him like a halo of fire
    const base = M.ap(R.Mb, [0, -230]);
    const sw = R.pose.tail * 0.12;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5;
      const a = -Math.PI / 2 + u * 2.5 + sw;
      const len = 560 - Math.abs(u) * 150;
      plume(ctx, base, [base[0] + Math.cos(a) * len, base[1] + Math.sin(a) * len * 0.9], 44, B, sd('plume', i));
    }
  }

  function crest(ctx, R, B) {
    // five gold feathers fanning up from the crown, a small flame on each tip
    const T = R.Mh;
    for (let i = 0; i < 5; i++) {
      const u = i / 4 - 0.5;
      const b = R.hl(u * 70, -120, 0.4);
      const tip = R.hl(u * 200, -250 + Math.abs(u) * 70, 0.3);
      const bp = M.ap(T, b), tp = M.ap(T, tip);
      F().feather(ctx, bp, tp, 20, C.gold, C.goldDeep, B, sd('crest', i));
      // the tip burns orange
      K.fill(ctx, L.ellipsePts(lerp(bp[0], tp[0], 0.86), lerp(bp[1], tp[1], 0.86), 12, 12, 10), C.primary);
    }
  }

  function eyeStrokes(ctx, R, B) {
    const T = R.Mh;
    for (const s of [-1, 1]) {
      const st = M.all(T, K.curve([R.hl(s * 100, -6, 0.8), R.hl(s * 136, -16, 0.6), R.hl(s * 170, -40, 0.4)], 4));
      K.line(ctx, st, { width: 13, color: P.ink, seed: sd('es', s), boil: B, taper: [6, 10] });
      K.line(ctx, st, { width: 7, color: C.gold, seed: sd('es', s), boil: B, taper: [6, 10] });
    }
  }

  function breastRows(c2, R, B) {
    const T = R.Mb;
    for (let row = 0; row < 4; row++)
      for (let i = -3; i <= 3; i++) {
        const x = i * 36 + (row % 2) * 18, y = -300 + row * 50;
        if (Math.abs(x) > 120 - row * 8) continue;
        K.line(c2, M.all(T, K.curve([[x - 16, y], [x, y + 12], [x + 16, y]], 3)), { width: 3.2, color: '#C87424', seed: sd('br', row, i), boil: B, taper: [2, 2] });
      }
  }

  const WORK = [
    { wing: 1, sq: 1.05, eye: 'closed', fx: { lick: 0.5 } },
    { wing: 1, sq: 1.02, eye: 'closed', fx: { lick: 1, pillar: 0.6 } },
    { hide: true, fx: { pillar: 1 } },
    { hide: true, fx: { ember: 1, pillar: 0.35 } },
    { hide: true, fx: { ember: 1, rays: 1 } },
    { y: -60, wing: 1, scale: 1.08, mouth: 0.6, fx: { rain: 0.3, rays: 0.6 } },
    { y: -20, wing: 0.7, eye: 'happy', mouth: 0.5, fx: { rain: 0.7 } },
    { fx: { rain: 1 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'bird',
    bodyC: [0, -210],
    bodyR: 250,
    body: { half: [[0, -390], [96, -380], [156, -330], [182, -236], [178, -140], [144, -74], [72, -46], [0, -40]] },
    belly: { half: [[0, -350], [74, -340], [118, -290], [126, -200], [106, -116], [56, -70], [0, -62]] },
    wings: {
      fold: [[96, -340], [158, -330], [194, -250], [196, -160], [168, -100], [130, -126], [104, -226]],
      hold: [[96, -340], [160, -326], [194, -266], [178, -206], [120, -196], [104, -232], [98, -284]],
      spread: [[96, -340], [200, -410], [320, -460], [380, -410], [366, -330], [266, -296], [134, -270]],
      root: [100, -300],
      tip: 4,
      n: 8,
      feather: 150,
      fw: 22,
      covert: [[100, -334], [156, -324], [186, -266], [176, -220], [120, -236]],
      covertSpread: [[100, -334], [200, -400], [310, -440], [300, -380], [150, -300]],
      rows: [[[110, -270], [150, -258], [186, -236]]],
      rowsSpread: [[[150, -330], [236, -360], [322, -384]]],
    },
    feet: { at: [54, -50], r: 9, toe: 36, claw: '#6A4A20' },
    head: { c: [0, -530], rx: 150, ry: 138 },
    beak: { y: 34, w: 24, h: 44, down: 14 },
    face: {
      eyes: { x: 64, y: -10, rx: 32, ry: 34, white: '#FFF6E0', iris: '#E8A020', irisR: 0.82, lid: 0.18, lidColor: C.fur, lash: true },
      blush: [104, 42, 20],
    },
    fur: false,
    shadowW: 220,
    attack: 'peck',
    hooks: {
      behind(ctx, R, B) {
        glow(ctx, R);
        if (R.pose.hide) return;
        plumes(ctx, R, B);
      },
      body: breastRows,
      face: eyeStrokes,
      head: crest,
      foot(ctx, R, B, side, f) {
        if (side > 0) return;
        // the broken shackle: an iron cuff, two links, the last one split
        const c = [f[0], f[1] - 40];
        F().form(ctx, L.rrectPts(c[0] - 20, c[1] - 12, 40, 24, 6, 4), C.iron, B, sd('cuff'), { width: 4, off: 0.1, hatch: 0.3, rim: false, dark: C.ironDeep });
        K.chain(ctx, [[c[0] - 18, c[1] + 8], [c[0] - 40, c[1] + 26]], 18, { width: 6, color: C.iron, seed: sd('ch'), boil: B });
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        const g = K.GROUND, cx = K.CXF;
        if (fx.lick) for (let i = 0; i < 5; i++) K.fx.flame(ctx, cx - 160 + i * 80, g - 20 - 60 * Math.sin((i / 4) * Math.PI), 70, 120 * fx.lick, (R.d || 0) + i, B, sd('lk', i), { colors: FIRE });
        if (fx.pillar) K.fx.flame(ctx, cx, g, 420 * fx.pillar, 700 * fx.pillar, (R.d || 0) * 1.3, B, sd('pil'), { colors: FIRE, tongues: 5, width: 7 });
        if (fx.ember) {
          const e = L.ellipsePts(cx, g - 70, 64, 76, 26);
          const gl = ctx.createRadialGradient(cx, g - 70, 20, cx, g - 70, 200);
          gl.addColorStop(0, L.rgba('#FFB050', 0.6));
          gl.addColorStop(1, L.rgba('#FFB050', 0));
          ctx.save();
          ctx.fillStyle = gl;
          ctx.beginPath();
          ctx.arc(cx, g - 70, 200, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          F().form(ctx, e, '#5A1A12', B, sd('ember'), { width: 6, off: 0.1, hatch: 0.5, rim: false, inside: (c2) => {
            for (const [pts, k] of [[[[cx - 30, g - 130], [cx - 6, g - 90], [cx - 20, g - 50]], 0], [[[cx + 30, g - 120], [cx + 10, g - 70], [cx + 34, g - 30]], 1], [[[cx - 50, g - 60], [cx - 10, g - 30]], 2]]) {
              K.line(c2, pts, { width: 9, color: '#FF8A2A', seed: sd('ec', k), boil: B, smooth: false, taper: [3, 6] });
              K.line(c2, pts, { width: 3.4, color: '#FFE08A', seed: sd('ec', k), boil: B, smooth: false, taper: [3, 6] });
            }
          } });
        }
        if (fx.rays) {
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            const o = [cx, g - 200];
            K.line(ctx, [[o[0] + Math.cos(a) * 120, o[1] + Math.sin(a) * 120], [o[0] + Math.cos(a) * (220 + 60 * fx.rays), o[1] + Math.sin(a) * (220 + 60 * fx.rays)]], { width: 8, color: '#FFD166', alpha: fx.rays, seed: sd('ray', k), boil: B, smooth: false, taper: [3, 10] });
          }
        }
        if (fx.rain) {
          for (let i = 0; i < 10; i++) {
            const x = cx - 330 + i * 72 + 20 * L.h3(i, 1, 9);
            const p = Math.min(1, fx.rain * (0.8 + 0.4 * L.h3(i, 2, 9)));
            const y = g - 600 + p * p * 580;
            if (i % 2) K.fx.coin(ctx, x, Math.min(g - 16, y), 22, p * 3 + i, B, sd('rc', i));
            else K.fx.token(ctx, x, Math.min(g - 16, y), 22, p * 2 + i, B, sd('rt', i));
          }
        }
        if (!R.pose.hide && R.anim !== 'sleep') K.fx.embers(ctx, M.ap(R.Mb, [0, -380]), 320, (R.d || 0) / (R.n || 12), B, sd('emb'), FIRE);
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { y: T.y || 0, wing: T.wing || 0, sq: T.sq || 1, scale: T.scale || 1, hide: !!T.hide, eyeMode: T.eye || 'open', mouth: T.mouth || 0, fx: T.fx };
      },
    },
  });
})();
