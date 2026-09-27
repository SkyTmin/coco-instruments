// pets/11-mouse.js : Мышь-воришка (common, token). Front kit, stands.
// A light grey mouse with a head as big as its body, huge round ears (the left one torn), big glossy
// eyes under a sly lid, a pink nose, long whiskers and buck teeth. A ragged brown capelet tied at
// the throat, a rope belt, a long pink tail curled up at the side, and the camp token on a chain in
// its paw. Work: sniffs, spots a token on the floor, snatches it, holds it up gleaming, pockets it
// under the cape — and winks.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'mouse';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#A7A098',
    furDeep: '#655E58',
    furLit: '#CFC8BF',
    belly: '#E4D8C6',
    muzzle: '#E9DFD2',
    skin: '#F0A9A2',
    nose: '#EE8E92',
    paw: '#F2B3AC',
    pad: '#DC8A86',
    foot: '#F2B3AC',
    leg: '#A7A098',
    arm: '#A7A098',
    blush: '#EC8C92',
    mouth: '#7A2C2C',
    tongue: '#F29A96',
    cape: '#5E4636',
    capeDeep: '#35271D',
    capeLit: '#7E6450',
    patch: '#8A6B45',
    rope: '#C2A46E',
    ropeDeep: '#7B6440',
  };

  // ears: a big round shape, the left one with a notch torn out of its rim
  const earPts = (notch) => {
    const out = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * 0.62 + (i / 16) * Math.PI * 1.76;
      let r = 96;
      if (notch && i >= 5 && i <= 7) r -= [18, 30, 16][i - 5];
      out.push([34 + Math.cos(a) * r * 0.95, -78 + Math.sin(a) * r]);
    }
    return out;
  };
  const RIGHT = earPts(false);
  const LEFT = earPts(true).map(([x, y]) => [-x, y]);
  const inner = (pts) => pts.map(([x, y]) => [x * 0.66 + (x > 0 ? 6 : -6), -78 + (y + 78) * 0.66 + 8]);

  function capeBack(ctx, R, B) {
    const T = R.Mb;
    // the capelet hangs behind: seen at the sides and below the arms, a ragged hem
    const hem = [];
    for (let i = 0; i <= 10; i++) {
      const x = -196 + i * 39.2;
      hem.push([x, -78 + (i % 2 ? -18 : 10) + 20 * Math.abs(x / 196) ** 2]);
    }
    const pts = [[-150, -300], [-190, -220], ...hem, [190, -220], [150, -300]];
    F().form(ctx, M.all(T, K.smooth(pts, 3)), C.cape, B, sd('capeB'), { width: 7, off: 0.1, hatch: 0.7 });
  }

  function capeFront(ctx, R, B) {
    const T = R.Mb;
    // the mantle over the shoulders: a wide band from shoulder to shoulder, tied at the throat
    const mantle = K.smooth([[-168, -290], [-110, -336], [0, -350], [110, -336], [168, -290], [150, -236], [80, -262], [0, -276], [-80, -262], [-150, -236]], 4);
    F().form(ctx, M.all(T, mantle), C.cape, B, sd('mantle'), {
      width: 7,
      off: 0.12,
      inside(c2) {
        // a patch sewn on the left shoulder
        const pt = M.all(T, L.rrectPts(-140, -304, 42, 34, 5, 4));
        K.fill(c2, pt, C.patch);
        L.inkPath(c2, pt, { closed: true, width: 3, seed: sd('patch'), boil: B, wobble: 0.4 });
        for (let k = 0; k < 4; k++) K.line(c2, M.all(T, [[-136 + k * 11, -308], [-133 + k * 11, -298]]), { width: 2.6, seed: sd('pst', k), boil: B, smooth: false, taper: 0 });
        L.hatch(c2, M.all(T, mantle), { angle: 1.2, spacing: 11, width: 2, color: C.capeLit, alpha: 0.5, density: 0.4, clip: true, seed: sd('weave'), boil: B });
      },
    });
    // the knot and two hanging strings
    const k0 = M.ap(T, [0, -272]);
    F().form(ctx, L.ellipsePts(k0[0], k0[1], 16, 13, 14), C.rope, B, sd('knot'), { width: 4, off: 0.12, hatch: 0.3, rim: false });
    for (const s of [-1, 1]) {
      const str = M.all(T, [[s * 6, -262], [s * 16, -226], [s * 10, -196]]);
      K.line(ctx, str, { width: 8, color: P.ink, seed: sd('str', s), boil: B, taper: [2, 4] });
      K.line(ctx, str, { width: 4.5, color: C.rope, seed: sd('str', s), boil: B, taper: [2, 4] });
    }
  }

  function belt(ctx, R, B, bodyPts) {
    const y0 = -168;
    const line = [];
    for (let x = -160; x <= 160; x += 16) line.push([x, y0 + 10 * (1 - (x / 150) ** 2)]);
    K.clip(ctx, bodyPts, () => {
      const L2 = M.all(R.Mb, line);
      K.line(ctx, L2, { width: 22, color: P.ink, seed: sd('rope'), boil: B, taper: 0 });
      K.line(ctx, L2, { width: 16, color: C.rope, seed: sd('rope'), boil: B, taper: 0 });
      // the twist of the rope
      for (let i = 0; i + 1 < line.length; i++) K.line(ctx, M.all(R.Mb, [[line[i][0] + 2, line[i][1] - 7], [line[i][0] + 10, line[i][1] + 7]]), { width: 2.4, color: C.ropeDeep, seed: sd('tw', i), boil: B, smooth: false, taper: 0 });
    });
    const kn = M.ap(R.Mb, [-96, y0 + 8]);
    F().form(ctx, L.ellipsePts(kn[0], kn[1], 15, 12, 14), C.rope, B, sd('bknot'), { width: 4, off: 0.12, hatch: 0.3, rim: false });
    for (const s of [0, 1]) {
      const e = M.all(R.Mb, [[-96, y0 + 14], [-104 + s * 18, y0 + 50], [-100 + s * 22, y0 + 76]]);
      K.line(ctx, e, { width: 9, color: P.ink, seed: sd('bend', s), boil: B, taper: [2, 5] });
      K.line(ctx, e, { width: 5.5, color: C.rope, seed: sd('bend', s), boil: B, taper: [2, 5] });
    }
  }

  function teeth(ctx, R, B) {
    if (R.pose.mouth > 0.25) return;
    const T = R.Mh;
    const c = R.hl(0, 82, 1);
    for (const s of [-1, 1]) {
      const t = M.all(T, L.rrectPts(c[0] + (s < 0 ? -12 : 0), c[1], 12, 14, 3, 4));
      K.fill(ctx, t, '#FFFBF0');
      L.inkPath(ctx, t, { closed: true, width: 2.8, seed: sd('tooth', s), boil: B, smooth: false, taper: 0, wobble: 0.3 });
    }
  }

  function chainToken(ctx, end, sway, B) {
    const a = [end[0] + 6, end[1] + 16];
    const b = [a[0] + 10 * sway, a[1] + 60];
    K.chain(ctx, [a, [lerp(a[0], b[0], 0.5) + 4, lerp(a[1], b[1], 0.5)], b], 13, { width: 5, color: '#C9A64E', seed: sd('chain'), boil: B });
    K.fx.token(ctx, b[0], b[1] + 26, 26, sway * 0.2, B, sd('token'));
  }

  const WORK = [
    { head: -0.12, hy: -8, turn: 0.1, look: [0.1, -0.35], fx: { ground: 1, glint: 0.6, noChain: 1 } },
    { head: 0.06, turn: 0.55, look: [0.6, 0.5], lid: 0.1, fx: { ground: 1, glint: 1, noChain: 1 } },
    { lean: 0.1, x: 30, arm: { l: 0, r: -0.5 }, turn: 0.4, look: [0.5, 0.6], fx: { inPaw: 1, noChain: 1 } },
    { arm: { l: 0.1, r: 1.55 }, turn: 0.25, look: [0.4, -0.2], mouth: 0.5, lid: 0.05, fx: { inPaw: 1, star: 1, noChain: 1 } },
    { arm: { l: 0.1, r: 1.45 }, turn: 0.3, look: [0.4, -0.2], lid: 0.45, fx: { inPaw: 1, noChain: 1 } },
    { arm: { l: 0.05, r: -0.95 }, turn: -0.1, eyeR: 'happy', fx: { noChain: 1 } },
    { arm: { l: 0.05, r: -0.9 }, turn: -0.15, eyeR: 'happy', mouth: 0.4, fx: { noChain: 1, star: 0.6 } },
    { arm: { l: -0.9, r: -0.9 }, lid: 0.45, fx: { noChain: 1 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'stand',
    bodyC: [0, -190],
    bodyR: 230,
    body: { half: [[0, -324], [80, -316], [132, -272], [152, -200], [150, -120], [128, -62], [80, -40], [0, -36]] },
    belly: [0, -150, 90, 104],
    legs: { hip: [56, -52], r: 22, foot: [44, 26], splay: 8 },
    arms: [{ at: [122, -268], len: 116, r: 22, pr: 32, rest: 0.34, pawFill: 'paw', pads: true }],
    tail: { pts: [[70, -70], [190, -64], [262, -140], [252, -248], [196, -300], [168, -270]], w0: 16, w1: 7, fill: C.skin, swing: 0.8 },
    head: { c: [0, -470], rx: 166, ry: 150, tufts: [[0.98, 1.0, 16], [0.0, 0.03, 16]] },
    ears: { at: [96, -98], pts: RIGHT, inner: inner(RIGHT), ptsL: LEFT, innerL: inner(LEFT), fill: C.fur, innerFill: C.skin, tilt: 0.12, flop: 0.4 },
    face: {
      eyes: { x: 64, y: -6, rx: 30, ry: 34, lid: 0.3, lidColor: C.fur, beadLit: '#4B3E48' },
      muzzle: [0, 52, 66, 46],
      nose: { y: 40, w: 20, h: 15 },
      mouth: { y: 70, w: 18, drop: 12, h: 28, style: 'cat' },
      whiskers: { x: 42, y: 44, len: 92 },
      blush: [100, 38, 26],
    },
    shadowW: 220,
    hooks: {
      behind: capeBack,
      bodyAfter: belt,
      front: capeFront,
      face: teeth,
      hand(ctx, R, B, side, end) {
        const fx = R.pose.fx || {};
        if (side < 0) return;
        if (!fx.noChain) chainToken(ctx, end, Math.sin(R.pose.tail * 3) * 0.8, B);
        if (fx.inPaw) K.fx.token(ctx, end[0] + 4, end[1] - 34, 28, 0.08, B, sd('tokP'));
        if (fx.star && fx.inPaw) K.fx.star(ctx, end[0] + 44, end[1] - 64, 30 * fx.star, B, sd('ts'), '#FFF1C4');
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        const spot = [K.CXF + 190, K.GROUND - 18];
        if (fx.ground) K.fx.token(ctx, spot[0], spot[1], 22, 0.55, B, sd('tokG'));
        if (fx.glint) K.fx.star(ctx, spot[0] + 22, spot[1] - 34, 28 * fx.glint, B, sd('glint'), '#FFF1C4');
        if (fx.star && !fx.inPaw) {
          const t = R.hp(120, -120, 0.5);
          K.fx.star(ctx, t[0], t[1], 26 * fx.star, B, sd('wink'), '#FFF1C4');
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return Object.assign({ arm: { l: 0.05, r: 0.05 } }, T);
      },
    },
  });
})();
