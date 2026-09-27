// pets/40-roach.js : Таракан-бегун (common, rate). Front kit, stands on its hind legs (the cartoon
// cockroach). A chestnut racer from the camp's cockroach races: a round head with huge glossy eyes
// and a racing stripe, two long antennae (one bent), flying goggles, a glossy shield behind the head
// and wing cases behind the back, a pale segmented belly with the race number 7 pinned on, four
// thin arms and two spiny legs. Work: goggles down, a sprint start, off out of the picture and back
// in from the other side, a skid, a thumbs-up.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'roach';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9A5530',
    furDeep: '#4A220E',
    furLit: '#D08A58',
    shell: '#7E4020',
    shellDeep: '#3E1C0A',
    belly: '#D9B98A',
    bellyDeep: '#A88658',
    leg: '#6A3418',
    foot: '#5A2C14',
    arm: '#6A3418',
    paw: '#7A3E1E',
    white: '#F4ECDF',
    red: '#C0392B',
    mouth: '#5A1E14',
    tongue: '#E88A7A',
    blush: '#E08070',
    antenna: '#4A2410',
  };

  function wingCases(ctx, R, B) {
    // the back layer is drawn even while he is off the picture: no wings hanging in the air
    if (R.pose.hide) return;
    const T = R.Mb;
    for (const s of [-1, 1]) {
      const w = M.all(T, K.smooth([[s * 60, -340], [s * 170, -330], [s * 238, -230], [s * 236, -90], [s * 190, -20], [s * 120, -40], [s * 80, -200]], 4));
      F().form(ctx, w, C.shell, B, sd('wing', s), {
        width: 7,
        off: 0.1,
        shine: 1,
        inside(c2) {
          K.line(c2, M.all(T, K.curve([[s * 140, -310], [s * 200, -200], [s * 200, -70]], 5)), { width: 3, color: C.shellDeep, alpha: 0.7, seed: sd('vein', s), boil: B });
        },
      });
    }
  }

  function belly(c2, R, B) {
    const T = R.Mb;
    // segments of the belly
    for (let k = 0; k < 6; k++) {
      const y = -280 + k * 42;
      K.line(c2, M.all(T, K.curve([[-110, y - 8], [0, y + 8], [110, y - 8]], 5)), { width: 3.4, color: C.bellyDeep, alpha: 0.9, seed: sd('seg', k), boil: B });
    }
    // the race number: a cloth bib pinned at the corners
    const bib = M.all(T, L.rrectPts(-58, -250, 116, 104, 10, 5));
    K.fill(c2, bib, C.white);
    L.hatch(c2, bib, { angle: 0.4, spacing: 7, width: 1.4, color: '#C8BCA6', alpha: 0.6, density: 0.5, clip: true, seed: sd('cloth'), boil: B });
    L.inkPath(c2, bib, { closed: true, width: 4, seed: sd('bib'), boil: B, wobble: 0.5 });
    K.line(c2, M.all(T, [[-24, -226], [26, -226], [-8, -164]]), { width: 13, color: C.red, seed: sd('seven'), boil: B, smooth: false, taper: [3, 5] });
    for (const [x, y] of [[-46, -238], [46, -238]]) {
      const p = M.ap(T, [x, y]);
      K.line(c2, [[p[0] - 8, p[1] + 6], [p[0] + 8, p[1] - 6]], { width: 5, color: '#B8BEC3', seed: sd('pin', x), boil: B, taper: 0 });
      K.fill(c2, L.ellipsePts(p[0] + 8, p[1] - 6, 4, 4, 8), '#E8C040');
    }
  }

  function shield(ctx, R, B) {
    // the pronotum: a glossy shield behind the head, its rim round the head's lower half
    const T = R.Mb;
    const pts = M.all(T, K.smooth([[-230, -360], [-200, -440], [-120, -500], [0, -520], [120, -500], [200, -440], [230, -360], [160, -320], [0, -310], [-160, -320]], 5));
    F().form(ctx, pts, C.shell, B, sd('shield'), {
      width: 8,
      off: 0.1,
      shine: 1,
      inside(c2) {
        K.line(c2, M.all(T, K.curve([[-200, -380], [0, -350], [200, -380]], 6)), { width: 4, color: C.furLit, alpha: 0.5, seed: sd('rim'), boil: B });
      },
    });
  }

  function antennae(ctx, R, B) {
    const T = R.Mh;
    const wav = R.pose.fx && R.pose.fx.ant != null ? R.pose.fx.ant : Math.sin(R.pose.tail * 4) * 0.5;
    for (const s of [-1, 1]) {
      const base = R.hl(s * 50, -150, 0.6);
      const pts = [base, [base[0] + s * 40, base[1] - 90], [base[0] + s * (110 + wav * 20), base[1] - 170], [base[0] + s * (200 + wav * 30), base[1] - 200]];
      // the left one is bent near its tip
      if (s < 0) pts.push([pts[3][0] - 20, pts[3][1] + 50]);
      else pts.push([pts[3][0] + 70, pts[3][1] - 14]);
      const c = M.all(T, s < 0 ? pts : K.curve(pts, 6));
      K.line(ctx, c, { width: 13, color: P.ink, seed: sd('ant', s), boil: B, taper: [3, 10], smooth: s > 0 });
      K.line(ctx, c, { width: 7, color: C.antenna, seed: sd('ant', s), boil: B, taper: [3, 10], smooth: s > 0 });
    }
  }

  function stripe(c2, R, B) {
    const T = R.Mh;
    const band = [R.hl(-18, -164, 0.4), R.hl(18, -164, 0.4), R.hl(22, -60, 0.8), R.hl(-22, -60, 0.8)];
    K.fill(c2, M.all(T, band), C.white);
    for (const s of [-1, 1]) K.line(c2, M.all(T, [R.hl(s * 22, -164, 0.4), R.hl(s * 26, -60, 0.8)]), { width: 7, color: C.red, seed: sd('str', s), boil: B, taper: 0 });
  }

  function mandibles(ctx, R, B) {
    if (R.pose.mouth > 0.25) return;
    const T = R.Mh;
    for (const s of [-1, 1]) {
      const b0 = R.hl(s * 30, 78, 1);
      const pts = M.all(T, K.smooth([[b0[0], b0[1]], [b0[0] + s * 14, b0[1] + 18], [b0[0] + s * 4, b0[1] + 32], [b0[0] - s * 4, b0[1] + 20]], 4));
      F().form(ctx, pts, C.shell, B, sd('mand', s), { width: 3.6, off: 0.1, hatch: 0, rim: false });
    }
  }

  const WORK = [
    { sq: 0.86, lean: -0.08, arm: { l: -0.3, r: -0.3 }, gog: 1, fx: { ant: -0.6 } },
    { x: 280, lean: 0.12, arm: { l: 0.9, r: -0.6 }, leg: { l: 40, r: 0 }, gog: 1, fx: { speed: 1 } },
    { hide: true, fx: { whoosh: 1 } },
    { hide: true, fx: { whoosh: 2 } },
    { x: -300, lean: 0.12, arm: { l: -0.6, r: 0.9 }, leg: { l: 0, r: 40 }, gog: 1, fx: { speed: 1 } },
    { x: -40, lean: -0.14, sq: 0.94, arm: { l: 0.5, r: 0.5 }, gog: 1, fx: { skid: 1 } },
    { arm: { l: 0.1, r: 1.7 }, eye: 'happy', mouth: 0.5, fx: { thumb: 1 } },
    { arm: { l: 0.05, r: 0.2 }, fx: {} },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    plan: 'stand',
    bodyC: [0, -190],
    bodyR: 250,
    body: { half: [[0, -340], [90, -330], [140, -280], [158, -190], [150, -100], [118, -46], [60, -30], [0, -28]], fill: C.belly },
    legs: { hip: [62, -50], r: 16, foot: [40, 22], splay: 16, toes: false },
    arms: [
      { at: [118, -300], len: 150, r: 17, pr: 26, rest: 0.5, pads: false, toes: 0 },
      { at: [142, -196], len: 140, r: 16, pr: 24, rest: 0.95, pads: false, toes: 0, offset: 0.25 },
    ],
    head: { c: [0, -468], rx: 170, ry: 156 },
    face: {
      eyes: { x: 70, y: -2, rx: 44, ry: 50, beadLit: '#5A3A30' },
      muzzle: [0, 70, 50, 34],
      mouth: { y: 74, w: 22, drop: 8, h: 30, style: 'smile' },
      blush: [118, 50, 24],
    },
    shadowW: 220,
    hooks: {
      behind: wingCases,
      body: belly,
      front: shield,
      skin: stripe,
      face: mandibles,
      head(ctx, R, B) {
        antennae(ctx, R, B);
        const down = R.pose.gog;
        F().goggles(ctx, R, B, down ? { y: -4, w: 166, r: 50, lens: '#8FC0CF' } : { y: -112, w: 150, r: 30 }, sd('gog'));
      },
      leg(ctx) {
        void ctx;
      },
      hand(ctx, R, B, side, end, a, i) {
        const fx = R.pose.fx || {};
        if (fx.thumb && side > 0 && i === 0) {
          // a thumbs-up: a little claw pointing up from the paw
          K.line(ctx, [end, [end[0] + 2, end[1] - 34]], { width: 13, color: P.ink, seed: sd('thumb'), boil: B, taper: [2, 4] });
          K.line(ctx, [end, [end[0] + 2, end[1] - 34]], { width: 8, color: C.paw, seed: sd('thumb'), boil: B, taper: [2, 4] });
          K.fx.star(ctx, end[0] + 40, end[1] - 50, 30, B, sd('thstar'), '#FFF1C4');
        }
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.speed) K.fx.speed(ctx, M.ap(R.Mr, [-(R.pose.x > 0 ? 240 : -240), -260]), 240, 0.9, B, sd('speed'));
        if (fx.whoosh) {
          const x = fx.whoosh === 1 ? K.CXF + 520 : K.CXF - 200;
          K.fx.speed(ctx, [x, K.GROUND - 260], 360, fx.whoosh === 1 ? 0.6 : 0.9, B, sd('whoosh', fx.whoosh));
          K.fx.dust(ctx, [K.CXF + (fx.whoosh === 1 ? 200 : -200), K.GROUND], 90, 0.5, B, sd('wd', fx.whoosh));
        }
        if (fx.skid) {
          K.fx.dust(ctx, M.ap(R.Mr, [200, 0]), 90, 0.45, B, sd('skid'));
          for (let k = 0; k < 3; k++) K.line(ctx, [M.ap(R.Mr, [-60 - k * 60, 4]), M.ap(R.Mr, [-170 - k * 60, 4])], { width: 4, color: P.inkSoft, alpha: 0.7, seed: sd('skidL', k), boil: B, smooth: false, taper: [2, 10] });
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { x: T.x || 0, lean: T.lean || 0, sq: T.sq || 1, arm: T.arm || { l: 0, r: 0 }, leg: T.leg || { l: 0, r: 0 }, hide: !!T.hide, gog: T.gog, eyeMode: T.eye || 'open', mouth: T.mouth || 0, fx: T.fx };
      },
    },
  });
})();
