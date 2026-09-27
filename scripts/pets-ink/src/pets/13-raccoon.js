// pets/13-raccoon.js : Енот-медвежатник (rare, dmg). Front kit, stands.
// A plump grey raccoon: the black bandit mask across the eyes with white brows and a white muzzle,
// rounded ears with dark backs and pale rims, cheek ruffs, a big ringed tail curling up at his side.
// A safecracker: soft leather gloves, a stethoscope round his neck, a tool roll across the belly
// with a screwdriver, a file and a pick. Work: puts the stethoscope to a boulder, listens, taps
// it with a little hammer — the boulder falls in halves and shows its ore.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'raccoon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9A9186',
    furDeep: '#5B534A',
    furLit: '#C3B9AB',
    belly: '#D2C7B6',
    mask: '#2A2320',
    eyeLine: '#F1ECE3',
    white: '#F1ECE3',
    muzzle: '#F1ECE3',
    skin: '#3E3634',
    nose: '#2A2320',
    leg: '#3E3634',
    foot: '#3E3634',
    arm: '#8E857B',
    paw: '#8A6242',
    pad: '#5A3C24',
    blush: '#E08C8C',
    mouth: '#6E2A26',
    tongue: '#EE8F8A',
    ring: '#3A332E',
    glove: '#8A6242',
    gloveDeep: '#5A3C24',
    rubber: '#2F3033',
    steel: '#B8BEC3',
    steelDeep: '#6E767C',
    leather: '#7F4F2E',
    leatherDeep: '#4F2F19',
    stone: '#8A857E',
    stoneDeep: '#55504A',
    ore: '#F0C040',
  };

  function mask(c2, R, B) {
    const T = R.Mh;
    // the bandit mask: one band across both eyes, dipping at the nose
    const band = [R.hl(-176, -30, 0.25), R.hl(-150, -76, 0.5), R.hl(-70, -70, 0.85), R.hl(0, -42, 1), R.hl(70, -70, 0.85), R.hl(150, -76, 0.5), R.hl(176, -30, 0.25), R.hl(140, 16, 0.5), R.hl(80, 30, 0.8), R.hl(0, 14, 1), R.hl(-80, 30, 0.8), R.hl(-140, 16, 0.5)];
    K.fill(c2, M.all(T, K.smooth(band, 5)), C.mask);
    // white brows over the mask and a dark stripe up the forehead
    for (const s of [-1, 1]) K.fill(c2, M.all(T, K.smooth([R.hl(s * 30, -86, 0.9), R.hl(s * 80, -112, 0.7), R.hl(s * 130, -98, 0.5), R.hl(s * 88, -84, 0.7)], 4)), C.white);
    K.fill(c2, M.all(T, K.smooth([R.hl(-14, -60, 1), R.hl(-18, -150, 0.6), R.hl(0, -168, 0.4), R.hl(18, -150, 0.6), R.hl(14, -60, 1)], 4)), '#5B534A');
  }

  function stethoscope(ctx, R, B) {
    const T = R.Mb;
    // the tubes hang round the neck on both sides and join in the chest piece
    const L1 = M.all(T, K.curve([[-96, -356], [-112, -300], [-70, -240], [-10, -214]], 6));
    const R1 = M.all(T, K.curve([[96, -356], [116, -296], [74, -236], [10, -214]], 6));
    for (const c of [L1, R1]) {
      K.line(ctx, c, { width: 16, color: P.ink, seed: sd('tube', c[0][0]), boil: B, taper: 0 });
      K.line(ctx, c, { width: 10, color: C.rubber, seed: sd('tube', c[0][0]), boil: B, taper: 0 });
    }
    const bell = M.ap(T, [0, -196]);
    F().form(ctx, L.ellipsePts(bell[0], bell[1], 26, 26, 20), C.steel, B, sd('bell'), { width: 5, off: 0.12, shine: 1, hatch: 0.3 });
    K.fill(ctx, L.ellipsePts(bell[0], bell[1], 14, 14, 16), C.steelDeep);
    L.inkPath(ctx, L.ellipsePts(bell[0], bell[1], 14, 14, 16), { closed: true, width: 2.6, seed: sd('bell2'), boil: B });
  }

  function toolRoll(ctx, R, B, bodyPts) {
    const T = R.Mb;
    const y0 = -136;
    const line = [];
    for (let x = -210; x <= 210; x += 20) line.push([x, y0 + 12 * (1 - (x / 200) ** 2)]);
    K.clip(ctx, bodyPts, () => K.band(ctx, M.all(T, line), 46, { fill: C.leather, deep: C.leatherDeep, seed: sd('roll'), boil: B, width: 5 }));
    // tools in the loops: a screwdriver, a file, a lock pick
    const tools = [
      [-96, '#C44A3A', 'driver'],
      [-60, C.steel, 'file'],
      [60, C.steel, 'pick'],
      [96, '#3F7FB0', 'driver'],
    ];
    for (const [x, col, kind] of tools) {
      const top = M.ap(T, [x, y0 - 50]);
      const bot = M.ap(T, [x, y0 + 14]);
      if (kind === 'driver') {
        F().form(ctx, L.rrectPts(top[0] - 10, top[1] + 10, 20, 36, 7, 4), col, B, sd('grip', x), { width: 4, off: 0.1, shine: 0.6, hatch: 0 });
        K.line(ctx, [[top[0], top[1] + 44], [bot[0], bot[1]]], { width: 6, color: C.steelDeep, seed: sd('shaft', x), boil: B, taper: 0 });
      } else {
        K.line(ctx, [top, bot], { width: kind === 'file' ? 12 : 6, color: P.ink, seed: sd('t', x), boil: B, taper: 0 });
        K.line(ctx, [top, bot], { width: kind === 'file' ? 7 : 3, color: col, seed: sd('t', x), boil: B, taper: 0 });
        if (kind === 'pick') K.line(ctx, [top, [top[0] + 10, top[1] - 8]], { width: 3, color: col, seed: sd('hook', x), boil: B, taper: 0 });
      }
      K.fill(ctx, L.rrectPts(bot[0] - 14, bot[1] - 26, 28, 14, 3, 3), C.leatherDeep);
    }
    // the buckle in the middle
    const bk = M.all(T, L.rrectPts(-22, y0 - 16, 44, 40, 6, 5));
    F().form(ctx, bk, '#C9A05A', B, sd('buckle'), { width: 4.5, off: 0.12, shine: 0.9, hatch: 0 });
  }

  function hammer(ctx, end, a, B) {
    const dir = [Math.sin(a), Math.cos(a)];
    const h1 = [end[0] + dir[0] * 80, end[1] + dir[1] * 80];
    K.line(ctx, [end, h1], { width: 14, color: P.ink, seed: sd('hh'), boil: B, taper: 0, smooth: false });
    K.line(ctx, [end, h1], { width: 8, color: '#9A6A3E', seed: sd('hh'), boil: B, taper: 0, smooth: false });
    const n = [-dir[1], dir[0]];
    const head = [[h1[0] + n[0] * 34, h1[1] + n[1] * 34], [h1[0] + n[0] * 34 + dir[0] * 26, h1[1] + n[1] * 34 + dir[1] * 26], [h1[0] - n[0] * 30 + dir[0] * 26, h1[1] - n[1] * 30 + dir[1] * 26], [h1[0] - n[0] * 30, h1[1] - n[1] * 30]];
    F().form(ctx, head, C.steel, B, sd('hhead'), { width: 5, off: 0.1, shine: 0.8, hatch: 0.3, smooth: false });
  }

  function boulder(ctx, split, B) {
    const g = K.GROUND, cx = K.CXF;
    const half = (s, dx) =>
      K.smooth([[cx + dx, g + 4], [cx + dx + s * 150, g + 4], [cx + dx + s * 158, g - 56], [cx + dx + s * 110, g - 104], [cx + dx + s * 30, g - 120], [cx + dx + s * 4, g - 100], [cx + dx - s * 8, g - 56]], 3);
    if (!split) {
      // whole: one boulder, a crack line where it will split
      const pts = K.smooth([[cx - 150, g + 4], [cx - 158, g - 50], [cx - 110, g - 104], [cx - 20, g - 120], [cx + 90, g - 108], [cx + 156, g - 52], [cx + 150, g + 4]], 3);
      F().form(ctx, pts, C.stone, B, sd('boulder'), { width: 7, off: 0.12, hatch: 0.8 });
      L.stipple(ctx, pts, { spacing: 14, r: [1.6, 3], color: C.stoneDeep, alpha: 0.7, seed: sd('bs'), boil: B });
      K.line(ctx, [[cx - 4, g - 118], [cx + 6, g - 90], [cx - 6, g - 70]], { width: 3, color: C.stoneDeep, seed: sd('hair'), boil: B, smooth: false });
      return;
    }
    const open = 26;
    for (const s of [-1, 1]) {
      const pts = half(s, s * open);
      F().form(ctx, pts, C.stone, B, sd('boulder', s), { width: 7, off: 0.12, hatch: 0.8 });
      L.stipple(ctx, pts, { spacing: 14, r: [1.6, 3], color: C.stoneDeep, alpha: 0.7, seed: sd('bs', s), boil: B });
    }
    if (split) {
      // the ore inside: gold veins glinting between the halves
      for (let k = 0; k < 5; k++) {
        const y = g - 20 - k * 22;
        K.fill(ctx, L.ellipsePts(cx + (k % 2 ? 6 : -6), y, 10, 7, 10, 0.6), C.ore);
      }
      K.fx.star(ctx, cx + 10, g - 150, 34, B, sd('orestar'), '#FFF1C4');
    }
  }

  const WORK = [
    { arm: { l: -0.7, r: 0.1 }, turn: 0.35, head: 0.18, look: [0.5, 0.4], fx: { boulder: 1, listen: 1 } },
    { arm: { l: -0.72, r: 0.1 }, turn: 0.4, head: 0.22, eye: 'closed', fx: { boulder: 1, listen: 1, note: 1 } },
    { arm: { l: -0.7, r: 0.1 }, turn: 0.4, head: 0.22, eye: 'closed', fx: { boulder: 1, listen: 1, note: 2 } },
    { arm: { l: 0.1, r: 2.1 }, turn: 0.1, look: [0.2, 0.5], fx: { boulder: 1, hammer: 1 } },
    { arm: { l: 0.1, r: -0.5 }, sq: 0.95, fx: { boulder: 1, hammer: 1, tap: 1 } },
    { arm: { l: 0.4, r: 0.5 }, y: -30, eye: 'happy', mouth: 0.7, fx: { boulder: 2 } },
    { arm: { l: 1.4, r: 1.4 }, y: -10, eye: 'happy', mouth: 0.6, fx: { boulder: 2 } },
    { arm: { l: -0.9, r: -0.9 }, lid: 0.35, fx: { boulder: 2 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'stand',
    bodyC: [0, -200],
    bodyR: 270,
    body: { half: [[0, -356], [106, -344], [172, -296], [206, -214], [212, -128], [190, -64], [136, -40], [60, -34], [0, -32]] },
    belly: [0, -168, 104, 128],
    legs: { hip: [76, -54], r: 32, foot: [54, 30], splay: 10 },
    arms: [{ at: [162, -294], len: 138, r: 32, pr: 44, rest: 0.4, fill: 'arm', pawFill: 'paw', pads: false }],
    tail: { pts: [[120, -80], [230, -90], [300, -180], [290, -300], [236, -360]], w0: 70, w1: 58, bushy: true, rings: 5, ringColor: C.ring, tip: C.ring, tipLen: 0.16, swing: 0.7 },
    head: { c: [0, -486], rx: 186, ry: 160, half: [[0, -160], [94, -148], [156, -110], [184, -40], [206, 10], [178, 36], [186, 70], [140, 100], [70, 132], [0, 140]], tufts: [[0.3, 0.42, 20], [0.58, 0.7, 20]] },
    ears: { at: [124, -122], pts: [[-46, 12], [-44, -40], [-8, -78], [30, -64], [46, -20], [46, 12]], inner: [[-28, 6], [-26, -32], [-4, -58], [22, -46], [30, -12], [30, 6]], fill: C.mask, innerFill: C.white, tilt: 0.28 },
    face: {
      eyes: { x: 70, y: -26, rx: 26, ry: 30, white: '#F6F2EA', iris: '#4A3426', irisR: 0.76 },
      muzzle: { half: [[0, -6], [40, 0], [74, 36], [70, 80], [36, 104], [0, 110]] },
      nose: { y: 34, w: 30, h: 22 },
      mouth: { y: 82, w: 22, drop: 16, h: 28, style: 'cat' },
      whiskers: { x: 52, y: 60, len: 70 },
      blush: [118, 40, 24],
    },
    shadowW: 270,
    hooks: {
      skin: mask,
      bodyAfter: toolRoll,
      front: stethoscope,
      hand(ctx, R, B, side, end, a) {
        const fx = R.pose.fx || {};
        if (fx.hammer && side > 0) hammer(ctx, end, a, B);
        if (fx.listen && side < 0) {
          // the chest piece pressed to the boulder by the left paw
          F().form(ctx, L.ellipsePts(end[0] + 10, end[1] + 28, 22, 22, 18), C.steel, B, sd('listen'), { width: 5, off: 0.12, shine: 1, hatch: 0.3 });
        }
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.boulder) boulder(ctx, fx.boulder === 2, B);
        if (fx.note) {
          const h = R.hp(-200, -60, 0.3);
          for (let k = 0; k < fx.note; k++) {
            const c = [h[0] - 20 - k * 40, h[1] - 30 - k * 30];
            K.line(ctx, [[c[0], c[1]], [c[0], c[1] - 40], [c[0] + 20, c[1] - 34]], { width: 5, seed: sd('note', k), boil: B, smooth: false, taper: 0 });
            K.fill(ctx, L.ellipsePts(c[0] - 8, c[1] + 2, 11, 8, 12, -0.4), P.ink);
          }
        }
        if (fx.tap) {
          const h = [K.CXF + 30, K.GROUND - 130];
          K.fx.star(ctx, h[0], h[1], 32, B, sd('tap'), P.white);
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { arm: T.arm, turn: T.turn || 0, head: T.head || 0, look: T.look || null, sq: T.sq || 1, y: T.y || 0, eyeMode: T.eye || 'open', mouth: T.mouth || 0, lid: T.lid == null ? null : T.lid, fx: T.fx };
      },
    },
  });
})();
