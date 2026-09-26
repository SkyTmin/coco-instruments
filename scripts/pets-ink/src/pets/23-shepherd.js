// pets/23-shepherd.js : Конвойная овчарка (epic, dmg). Quad kit.
// A black-and-tan German shepherd: the black saddle and muzzle, tan legs and cheeks, tall ears, a
// sloping back. A leather guard harness with a brass shield badge, a wire basket muzzle hanging
// loose under the throat, a short chain leash from the collar. Bites. Work: crouches with the ears
// back, leaps, lands on a stone with both forepaws and cracks it, stands proud.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'shepherd';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#C98F53',
    furDeep: '#8A5A2E',
    furLit: '#E6B67E',
    chest: '#E8D2AA',
    black: '#2A2320',
    skin: '#D9968C',
    skinDeep: '#A8605A',
    nose: '#2A2320',
    noseDeep: '#141010',
    eye: '#1A110E',
    mouth: '#5E2220',
    tongue: '#E88E86',
    leather: '#6E4A2C',
    leatherDeep: '#43291A',
    brass: '#D2B25C',
    brassDeep: '#8A6C28',
    steel: '#AEB5BA',
    stone: '#8A857E',
    stoneDeep: '#55504A',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
  };

  const SIL = [
    [-196, -170, 0],
    [-228, -224, 0],
    [-222, -278, 0],
    [-170, -300, 0],
    [-60, -318, 0],
    [60, -340, 0.1],
    [116, -380, 0.5],
    [150, -436, 1],
    [196, -466, 1],
    [252, -470, 1],
    [292, -444, 1],
    [346, -424, 1],
    [390, -410, 1],
    [404, -392, 1],
    [390, -374, 1],
    [340, -366, 1],
    [292, -352, 1],
    [248, -330, 0.9],
    [196, -300, 0.5],
    [190, -240, 0],
    [170, -186, 0],
    [100, -170, 0],
    [0, -174, 0],
    [-110, -180, 0],
  ];

  function markings(ctx, R) {
    const T = R.Mb, H = R.Mh;
    // the black saddle over the back
    K.fill(ctx, M.all(T, K.smooth([[-240, -240], [-200, -310], [-60, -334], [80, -350], [120, -320], [60, -262], [-80, -242], [-180, -220]], 5)), C.black);
    // the black muzzle and the mask up to the eye, tan brow spot
    K.fill(ctx, M.all(H, K.smooth([[268, -430], [340, -430], [400, -410], [408, -380], [360, -360], [300, -350], [262, -372]], 5)), C.black);
    K.fill(ctx, M.all(H, K.smooth([[176, -470], [240, -478], [262, -446], [230, -430], [190, -440]], 5)), C.black);
    K.fill(ctx, M.all(T, K.smooth([[150, -300], [196, -290], [190, -210], [150, -200], [140, -250]], 5)), C.chest);
  }

  function harness(ctx, R, B, bodyPts) {
    const T = R.Mb;
    // girth strap behind the forelegs and the strap across the chest
    const girth = M.all(T, K.curve([[50, -352], [62, -260], [70, -170]], 8));
    const chest = M.all(T, K.curve([[40, -330], [120, -300], [196, -262]], 8));
    K.band(ctx, girth, 30, { fill: C.leather, deep: C.leatherDeep, stitch: C.leatherDeep, seed: sd('girth'), boil: B, clip: bodyPts, width: 4.5 });
    K.band(ctx, chest, 26, { fill: C.leather, deep: C.leatherDeep, seed: sd('chestS'), boil: B, clip: bodyPts, width: 4.5 });
    // the brass shield badge on the girth
    const c = [62, -262];
    const shield = M.all(T, K.smooth([[c[0] - 22, c[1] - 26], [c[0] + 22, c[1] - 26], [c[0] + 22, c[1] + 4], [c[0], c[1] + 28], [c[0] - 22, c[1] + 4]], 3));
    K.plate(ctx, shield, { fill: C.brass, deep: C.brassDeep, width: 4.5, seed: sd('badge'), boil: B });
    const star = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 5 : 12, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      star.push([c[0] + Math.cos(a) * r, c[1] - 2 + Math.sin(a) * r]);
    }
    K.fill(ctx, M.all(T, star), C.brassDeep);
  }

  function collarKit(ctx, R, B) {
    const T = R.Mf;
    const line = M.all(T, K.curve([[118, -392], [170, -360], [226, -326]], 8));
    K.band(ctx, line, 22, { fill: C.leather, deep: C.leatherDeep, seed: sd('collar'), boil: B, width: 4.5 });
    // the basket muzzle hanging loose under the throat: a wire cage on its strap
    const cage = M.ap(T, [226, -290]);
    const cx = cage[0], cy = cage[1];
    for (let k = 0; k < 4; k++) K.line(ctx, [[cx - 30 + k * 18, cy - 20], [cx - 26 + k * 16, cy + 30]], { width: 4, color: C.steel, seed: sd('wire', k), boil: B, taper: 0 });
    for (const y of [-20, 6, 30]) K.line(ctx, [[cx - 34, cy + y], [cx + 26, cy + y + 4]], { width: 4, color: C.steel, seed: sd('wireH', y), boil: B, taper: 0 });
    L.inkPath(ctx, K.smooth([[cx - 36, cy - 24], [cx + 30, cy - 22], [cx + 26, cy + 34], [cx - 30, cy + 34]], 5), { closed: true, width: 4.5, seed: sd('cage'), boil: B, wobble: 0.5 });
    // the chain leash from the collar ring, hanging and swinging
    const ring = M.ap(T, [200, -334]);
    const sw = R.pose.fx && R.pose.fx.swing != null ? R.pose.fx.swing : 0;
    K.chain(ctx, [ring, [ring[0] + 18 + 20 * sw, ring[1] + 70], [ring[0] + 10 + 40 * sw, ring[1] + 140]], 16, { width: 6, color: C.steel, seed: sd('leash'), boil: B });
  }

  function stone(ctx, R, B) {
    const fx = R.pose.fx;
    if (!fx || fx.stone == null) return;
    const g = K.GROUND, x = K.CX + 360;
    if (fx.stone < 1) {
      K.form(ctx, K.smooth([[x - 70, g + 2], [x - 74, g - 40], [x - 30, g - 72], [x + 34, g - 68], [x + 72, g - 30], [x + 68, g + 2]], 5), { fill: C.stone, deep: C.stoneDeep, width: 7, seed: sd('stone'), boil: B, spacing: 8 });
    } else {
      for (const s of [-1, 1]) {
        const o = 30 * s;
        K.form(ctx, K.smooth(s < 0 ? [[x - 80 + o, g + 2], [x - 80 + o, g - 30], [x - 30 + o, g - 50], [x + o * 0.3, g - 20], [x + o * 0.3, g + 2]] : [[x + o * 0.3, g + 2], [x + o * 0.3, g - 24], [x + 34 + o, g - 46], [x + 76 + o, g - 22], [x + 72 + o, g + 2]], 5), { fill: C.stone, deep: C.stoneDeep, width: 6, seed: sd('stoneS', s), boil: B, spacing: 7 });
      }
      for (let i = 0; i < 4; i++) {
        const t = fx.debris || 0;
        const px = x + (i - 1.5) * 50 * t, py = g - 60 - 110 * t + 80 * t * t;
        K.form(ctx, L.ellipsePts(px, py, 9, 7, 8, i), { fill: C.stone, deep: C.stoneDeep, width: 3.6, seed: sd('deb', i), boil: B, shade: 0.5 });
      }
    }
  }

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [170, -380],
    headScale: 1.1,
    spine: [20, -300],
    bodyC: [-20, -250],
    bodyR: 240,
    front: { atN: [124, -210], atF: [100, -218], l1: 100, l2: 92, r1: 30, rj: 22, r2: 19, paw: [32, 15] },
    hind: { atN: [-160, -220], atF: [-136, -228], l1: 116, l2: 92, r1: 46, rj: 22, r2: 18, paw: [32, 15] },
    feet: { fn: 140, ff: 112, hn: -150, hf: -126 },
    stride: 64,
    lift: 40,
    legFill: () => C.fur,
    lie: 150,
    tail: { base: [-222, -272], len: 240, lift: -0.95, curl: -0.75, rise: 0, w0: 40, w1: 30, bushy: true, fill: C.fur, deep: C.furDeep, ink: 6.5, rings: 1, ringCol: C.black },
    ears: {
      n: { at: [196, -462], flop: 0.12, fill: C.black, deep: P.ink, innerFill: C.fur, pts: [[168, -452], [180, -540], [196, -586], [230, -540], [238, -466]], inner: [[184, -462], [192, -530], [200, -560], [220, -528], [224, -470]] },
      f: { at: [240, -470], flop: 0.1, fill: C.black, deep: P.ink, innerFill: C.fur, pts: [[222, -462], [238, -546], [256, -584], [282, -534], [280, -460]], inner: null },
    },
    tufts: false,
    face: {
      eye: { x: 262, y: -426, r: 16, style: 'iris', iris: '#7A4A22', lid: 0.2, lidColor: C.black },
      nose: { x: 398, y: -398, rx: 17, ry: 13 },
      mouth: [[392, -376], [350, -366], [300, -354]],
      whiskers: null,
      blush: null,
      tongue: 46,
      fangs: 1.1,
    },
    hooks: { body: markings, bodyAfter: harness, front: collarKit, behind: stone },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { swing: Math.sin((Math.PI * 2 * d) / n) * 0.3 } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { swing: Math.cos((Math.PI * 2 * d) / n) } });
      },
      // ears back in a crouch, the leap, both forepaws on the stone, it cracks, proud
      work(d, n, P0) {
        const st = P0.idle(0, 12).legs;
        const reach = { fn: { x: 240, lift: 20 }, ff: { x: 214, lift: 30 }, hn: { x: -110, lift: 40 }, hf: { x: -90, lift: 40 } };
        const onStone = { fn: { x: 250, lift: 64 }, ff: { x: 226, lift: 60 }, hn: { x: -130, lift: 0 }, hf: { x: -106, lift: 0 } };
        const T = [
          { bow: 0.2, sq: 0.9, ear: -1, eye: 'angry', legs: st, stone: 0 },
          { bow: 0.24, sq: 0.86, ear: -1, eye: 'angry', legs: st, stone: 0, x: -20 },
          { x: 70, y: -80, bow: -0.14, legs: reach, stone: 0, ear: -1 },
          { x: 100, y: -40, bow: 0.06, legs: onStone, stone: 0 },
          { x: 100, y: -30, bow: 0.16, legs: onStone, stone: 1, debris: 0.3, mouth: -1, eye: 'angry' },
          { x: 90, y: -10, bow: 0.08, legs: onStone, stone: 1, debris: 0.7 },
          { x: 60, bow: -0.04, legs: st, stone: 1, debris: 1.1, head: -0.1 },
          { x: 40, bow: -0.06, legs: st, stone: 1, head: -0.16, mouth: 0.7, eye: 'happy' },
        ][d];
        return { x: T.x || 0, y: T.y || 0, bow: T.bow, sq: T.sq || 1, head: T.head || 0, mouth: T.mouth || 0, eyeMode: T.eye || 'open', ear: T.ear || 0, tail: d >= 6 ? 0.5 : 0, legs: T.legs, fx: { stone: T.stone, debris: T.debris || 0, swing: d % 2 ? 0.6 : -0.6 } };
      },
    },
  });
})();
