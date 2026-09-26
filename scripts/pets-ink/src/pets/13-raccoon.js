// pets/13-raccoon.js : Енот-медвежатник (rare, dmg). Biped kit.
// A plump grey-brown raccoon: the black mask with white brows, a white muzzle, pointed ears, a
// thick ringed tail, dark hands in fingerless gloves. A safecracker's kit: a stethoscope round the
// neck and a leather tool roll with lockpicks on the belt. Work: taps a stone with a hammer until
// it splits.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'raccoon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8E857B',
    furDeep: '#5B534A',
    furLit: '#B7AD9F',
    chest: '#CFC4B4',
    mask: '#2A2320',
    white: '#EFEAE0',
    skin: '#3E3634',
    skinDeep: '#221C1A',
    palm: '#3E3634',
    palmDeep: '#1F1917',
    sole: '#3E3634',
    soleDeep: '#1F1917',
    claw: '#D9CFBF',
    clawDeep: '#9C9080',
    nose: '#2E2724',
    noseDeep: '#141010',
    eye: '#1A110E',
    glove: '#8A6242',
    gloveDeep: '#5A3C24',
    rubber: '#2F3033',
    steel: '#B8BEC3',
    steelDeep: '#6E767C',
    leather: '#7F4F2E',
    leatherDeep: '#4F2F19',
    stone: '#8A857E',
    stoneDeep: '#55504A',
  };

  const SIL = [
    [-20, -24, 0],
    [-110, -36, 0],
    [-168, -92, 0],
    [-188, -190, 0],
    [-182, -284, 0.05],
    [-154, -354, 0.35],
    [-128, -420, 0.8],
    [-84, -482, 1],
    [0, -514, 1],
    [84, -510, 1],
    [150, -480, 1],
    [198, -442, 1],
    [248, -422, 1],
    [298, -408, 1],
    [324, -398, 1],
    [312, -378, 1],
    [264, -372, 1],
    [214, -364, 1],
    [186, -350, 0.9],
    [194, -330, 0.9],
    [168, -316, 0.6],
    [170, -250, 0],
    [168, -140, 0],
    [130, -60, 0],
    [70, -30, 0],
  ];

  // mask, brows and the white muzzle (head space), the pale belly
  function markings(ctx, R) {
    const H = R.Mh;
    K.fill(ctx, M.all(H, K.smooth([[176, -372], [250, -392], [330, -402], [330, -366], [250, -360], [196, -342], [160, -340]], 5)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[112, -486], [178, -488], [236, -466], [270, -440], [248, -416], [196, -414], [150, -404], [118, -420], [96, -452]], 5)), C.mask);
    K.fill(ctx, M.all(H, K.smooth([[120, -500], [190, -506], [246, -484], [236, -474], [188, -494], [128, -490]], 4)), C.white);
    K.fill(ctx, M.all(H, K.smooth([[150, -372], [204, -372], [210, -330], [170, -318], [140, -340]], 4)), C.white);
  }

  // the stethoscope: the tubes round the back of the neck, down the chest to the bell on the belly
  function stethoscope(ctx, R, B) {
    const T = R.Mb;
    const tube = M.all(T, K.curve([[-20, -368], [40, -364], [92, -344], [104, -300], [86, -250], [70, -214]], 6));
    L.inkPath(ctx, tube, { width: 14, color: P.ink, seed: sd('tube'), boil: B, taper: [2, 2], wobble: 0.6 });
    L.inkPath(ctx, tube, { width: 7, color: '#4A4B50', seed: sd('tube'), boil: B, taper: [2, 2], wobble: 0.6 });
    // the ear tubes: two short steel arms with black tips at the neck
    for (const [x, y] of [[-24, -372], [96, -356]]) {
      K.line(ctx, M.all(T, [[x, y], [x + (x < 0 ? -14 : 14), y - 22]]), { width: 7, color: P.ink, seed: sd('ear', x), boil: B, taper: 0, smooth: false });
      K.line(ctx, M.all(T, [[x, y], [x + (x < 0 ? -14 : 14), y - 22]]), { width: 3, color: C.steel, seed: sd('ear', x), boil: B, taper: 0, smooth: false });
    }
    const piece = M.all(T, L.ellipsePts(66, -196, 24, 24, 24));
    K.form(ctx, piece, { fill: C.steel, deep: C.steelDeep, width: 5, seed: sd('bell'), boil: B, shade: 0.9, spacing: 5, hatchW: 1.8 });
    K.line(ctx, M.all(T, L.ellipsePts(66, -196, 13, 13, 16)), { closed: true, width: 2.6, color: C.steelDeep, seed: sd('bell2'), boil: B, taper: 0 });
  }

  function belt(ctx, R, B, bodyPts) {
    const line = [];
    for (let x = -220; x <= 220; x += 20) line.push([x, -132 + 12 * (1 - (x / 190) ** 2)]);
    K.band(ctx, M.all(R.Mb, line), 22, { fill: C.leather, deep: C.leatherDeep, stitch: C.leatherDeep, seed: sd('belt'), boil: B, clip: bodyPts, width: 4.5 });
  }

  // the tool roll on the hip, lockpick handles sticking out of its top
  function toolRoll(ctx, R, B) {
    const T = R.Mb;
    for (let k = 0; k < 4; k++) {
      const x = -128 + k * 17;
      const pick = M.all(T, [[x, -176], [x + 4, -214 - (k % 2) * 12]]);
      L.inkPath(ctx, pick, { width: 9, color: P.ink, seed: sd('pick', k), boil: B, smooth: false, taper: [2, 2] });
      L.inkPath(ctx, pick, { width: 4, color: k % 2 ? C.steel : '#C39A55', seed: sd('pick', k), boil: B, smooth: false, taper: [2, 2] });
    }
    const roll = M.all(T, L.rrectPts(-150, -184, 84, 70, 22, 6));
    K.form(ctx, roll, { fill: C.leather, deep: C.leatherDeep, width: 6, seed: sd('roll'), boil: B, spacing: 7, hatchW: 2.2 });
    K.line(ctx, M.all(T, [[-150, -150], [-66, -150]]), { width: 3.4, color: C.leatherDeep, seed: sd('rollTie'), boil: B, smooth: false });
    K.plate(ctx, M.all(T, L.rrectPts(-116, -158, 16, 16, 3, 4)), { width: 2.6, seed: sd('rollBuckle'), boil: B, shade: 0 });
  }

  // a stone on the ground in front; split > 0 opens it on a glint of ore
  function stone(ctx, R, B, split) {
    const g = K.GROUND;
    const x = K.CX + 290;
    const half = (s) => {
      const o = s * split * 30;
      return K.smooth(
        s < 0
          ? [[x - 90 + o, g + 2], [x - 94 + o, g - 50], [x - 60 + o, g - 90], [x - 6 + o * 0.6, g - 98], [x + 4 + o * 0.4, g - 50], [x - 4 + o * 0.4, g + 2]]
          : [[x + 4 + o * 0.4, g + 2], [x + 12 + o * 0.4, g - 50], [x + 2 + o * 0.6, g - 98], [x + 58 + o, g - 84], [x + 90 + o, g - 40], [x + 84 + o, g + 2]],
        5
      );
    };
    if (split > 0) {
      const glint = L.ellipsePts(x, g - 50, 26, 34, 16);
      K.fill(ctx, glint, '#8FD3EA');
      K.fx.star(ctx, x, g - 110 - 20 * split, 22 + 10 * split, B, sd('oreStar'), '#E9FBFF');
    }
    for (const s of [-1, 1]) {
      if (split <= 0 && s > 0) continue;
      const pts = split > 0 ? half(s) : K.smooth([[x - 90, g + 2], [x - 94, g - 50], [x - 60, g - 90], [x, g - 100], [x + 58, g - 84], [x + 90, g - 40], [x + 84, g + 2]], 5);
      K.form(ctx, pts, { fill: C.stone, deep: C.stoneDeep, width: 7, seed: sd('stone', s), boil: B, spacing: 8, hatchAlpha: 0.7 });
    }
  }

  function hammer(ctx, PT, B) {
    const handle = M.all(PT, K.ribbonPts([[30, 6], [70, -10], [120, -30]], 12, 10));
    K.form(ctx, handle, { fill: '#9A6A3F', deep: '#5C3B20', width: 4.5, seed: sd('hammerH'), boil: B, shade: 0.6, spacing: 5, hatchW: 1.8 });
    const head = M.all(PT, [[104, -56], [140, -70], [150, -40], [114, -24]]);
    K.form(ctx, head, { fill: C.steel, deep: C.steelDeep, width: 5, seed: sd('hammerHead'), boil: B, spacing: 5, hatchW: 1.8 });
  }

  K.kits.biped.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    sil: SIL,
    neck: [100, -380],
    bodyC: [0, -250],
    bodyR: 230,
    legh: 44,
    shoulders: { n: [104, -290], f: [74, -306] },
    hips: { n: [40, -58], f: [-40, -62] },
    arm: {
      len: 58,
      r: 24,
      paw: 'hand',
      pawScale: 1.18,
      sleeve: (far) => ({ fill: K.far(C.glove, far), deep: C.gloveDeep }),
      rest: { n: { a1: 1.0, a2: 0.3 }, f: { a1: 0.9, a2: 0.2 } },
      up: { n: { a1: -0.8, a2: -1.2 }, f: { a1: -1.7, a2: -2.0 } },
    },
    leg: { r: 27, fill: () => C.skin },
    foot: { len: 46, toes: 4, rest: { n: { x: 50 }, f: { x: -36 } } },
    tail: {
      base: [-170, -110],
      len: 230,
      lift: -0.25,
      curl: -0.9,
      rise: 0,
      w0: 58,
      w1: 40,
      bushy: true,
      fill: C.fur,
      deep: C.furDeep,
      ink: 6.5,
      rings: 5,
      ringCol: C.mask,
    },
    chest: [60, -180, 80, 120, -0.1],
    ears: {
      n: { at: [-40, -480], flop: 0.1, fill: C.fur, deep: C.furDeep, innerFill: C.mask, pts: [[-100, -470], [-80, -560], [-60, -600], [-24, -560], [-4, -484]], inner: [[-80, -482], [-66, -548], [-56, -572], [-34, -546], [-24, -490]] },
      f: { at: [40, -500], flop: 0.08, fill: C.fur, deep: C.furDeep, innerFill: C.mask, pts: [[-10, -498], [16, -588], [30, -620], [60, -582], [80, -504]], inner: null },
    },
    tuftBelow: -180,
    face: {
      eye: { x: 196, y: -448, r: 15, style: 'iris', iris: '#8A5A2B', lid: 0.2, lidColor: C.mask },
      nose: { x: 320, y: -392, rx: 17, ry: 14 },
      mouth: [[308, -374], [288, -368], [264, -366]],
      whiskers: [296, -384, 90],
      blush: null,
    },
    hooks: {
      body: markings,
      bodyAfter: belt,
      front(ctx, R, B) {
        stethoscope(ctx, R, B);
        toolRoll(ctx, R, B);
      },
      hand(ctx, R, B, PT) {
        if (R.pose.fx && R.pose.fx.hammer) hammer(ctx, PT, B);
      },
      behind(ctx, R, B) {
        const fx = R.pose.fx;
        if (fx && fx.stone != null) stone(ctx, R, B, fx.stone);
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx;
        if (fx && fx.spark) {
          const c = [K.CX + 290, K.GROUND - 110];
          for (let k = 0; k < 6; k++) {
            const a = -Math.PI / 2 + (k - 2.5) * 0.45;
            const r0 = 30, r1 = 30 + 60 * fx.spark;
            K.line(ctx, [[c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0], [c[0] + Math.cos(a) * r1, c[1] + Math.sin(a) * r1]], { width: 5, color: '#F2B83A', seed: sd('spark', k), boil: B, smooth: false, taper: [2, 8] });
          }
        }
      },
    },
    poses: {
      // raise the hammer, strike (sparks), again, the stone splits on a glint of ore
      work(d) {
        const T = [
          { a: [0.2, -0.3], stone: 0, lean: 0.08 },
          { a: [-2.2, -2.7], stone: 0, lean: -0.12, x: -10 },
          { a: [0.75, 0.55], stone: 0, lean: 0.26, x: 20, spark: 1 },
          { a: [0.2, -0.2], stone: 0, lean: 0.12, x: 10 },
          { a: [-2.3, -2.8], stone: 0, lean: -0.14, x: -10 },
          { a: [0.8, 0.6], stone: 0.2, lean: 0.28, x: 24, spark: 1.2 },
          { a: [0.4, 0.1], stone: 0.8, lean: 0.1, x: 10, mouth: 0.8 },
          { a: [0.3, 0.0], stone: 1, lean: 0.04, mouth: 0.8, eye: 'happy' },
        ][d];
        return {
          x: (T.x || 0) - 60,
          lean: T.lean,
          mouth: T.mouth || 0,
          eyeMode: T.eye || (d === 2 || d === 5 ? 'angry' : 'open'),
          armN: { a1: T.a[0], a2: T.a[1] },
          fx: { hammer: 1, stone: T.stone, spark: T.spark || 0 },
        };
      },
    },
  });
})();
