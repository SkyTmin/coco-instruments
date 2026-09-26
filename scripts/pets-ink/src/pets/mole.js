// pets/mole.js : Кротёнок-подкопщик — palette, rig and the six animations (art bible 10).
//
// Layers, back to front:
//   ground shadow > tail > far leg and sole > far arm and paw > both leg tubes > body (fur fill,
//   chest patch, fur flecks, shade hatching, belt, pouch, outline, back tufts) > near sole > face
//   (eye, blush, whiskers, mouth, nose) > helmet (dome, band, dent, rivets, brim, lamp, glow) >
//   near arm and paw > effects (dirt, slashes, sparkles, Z's).
// Body points are skinned between the body and the head transform (weight 0 body, 1 head), so the
// head tilts without a neck seam — moles have none.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const ID = 'mole';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;
  const clamp = L.clamp, lerp = L.lerp, sst = L.smoothstep;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- palette (by what it colours)
  const C = {
    fur: '#6B615B',
    furDeep: '#433A36',
    furLit: '#8C8078',
    chest: '#7E736C',
    skin: '#EDA898',
    skinDeep: '#C27466',
    claw: '#F3E7D1',
    clawDeep: '#B9A688',
    helmet: '#E8B53D',
    helmetDeep: '#AE7B25',
    helmetLit: '#FAE3A0',
    brass: '#C39A55',
    brassDeep: '#7E5E2E',
    glass: '#FFF6D2',
    leather: '#8C5A33',
    leatherDeep: '#5A361D',
    eye: '#1A110E',
    mouth: '#6E2A26',
    dirt: '#8B6848',
    dirtDeep: '#5B4330',
    spark: '#EAB530',
  };

  // ---------------------------------------------------------------- the silhouette [x, y, head weight]
  const SIL = [
    [-20, -22, 0],
    [-110, -32, 0],
    [-176, -88, 0],
    [-204, -186, 0],
    [-206, -290, 0],
    [-184, -382, 0.25],
    [-140, -450, 0.65],
    [-55, -494, 1],
    [40, -506, 1],
    [128, -484, 1],
    [192, -440, 1],
    [236, -402, 1],
    [298, -382, 1],
    [346, -370, 1],
    [364, -352, 1],
    [334, -334, 1],
    [272, -326, 1],
    [218, -312, 0.85],
    [202, -268, 0.3],
    [206, -200, 0],
    [193, -120, 0],
    [152, -56, 0],
    [80, -27, 0],
  ];
  const NECK = [110, -400]; // head pivot
  const BODY_C = [0, -270]; // shade ramp centre
  const SHOULDER_N = [122, -285], SHOULDER_F = [92, -305];
  const HIP_N = [40, -62], HIP_F = [-40, -66];
  const ARM_L = 46;

  // ---------------------------------------------------------------- poses
  const REST = {
    x: 0, y: 0, lean: 0, sq: 1, legh: 46,
    head: 0, hy: 0, helmet: 0,
    nose: 0, eye: 1, eyeMode: 'open', mouth: 0, brow: 0,
    armN: { a1: 0.78, a2: 0.12 },
    armF: { a1: 0.56, a2: 0.02 },
    footN: { x: 52, lift: 0, ang: 0 },
    footF: { x: -38, lift: 0, ang: 0 },
    tail: 0, lamp: 1,
    fx: null,
  };

  const W = (u) => Math.sin(TAU * u);

  const POSES = {
    idle(d, n) {
      const u = d / n;
      const b = W(u);
      const twitch = [5, 6, 7, 19].includes(d) ? [0, 1, 0.6, 0.8][[5, 6, 7, 19].indexOf(d) + 0] || 0 : 0;
      return {
        sq: 1 + 0.02 * b,
        y: 0,
        head: 0.035 * W(u + 0.15),
        nose: twitch,
        eye: d === 15 ? 0 : d === 16 ? 0.45 : 1,
        armN: { a1: 0.78 + 0.05 * b, a2: 0.12 + 0.04 * b },
        armF: { a1: 0.56 + 0.05 * b, a2: 0.02 },
        tail: 0.18 * W(2 * u),
      };
    },
    walk(d, n) {
      const ph = (TAU * d) / n;
      const c = Math.cos(ph), s = Math.sin(ph);
      const liftN = s < 0 ? -s * 40 : 0; // near foot swings in the second half
      const liftF = s > 0 ? s * 40 : 0;
      return {
        y: -20 * s * s,
        sq: 1.03 - 0.07 * c * c,
        lean: 0.07 + 0.02 * Math.cos(2 * ph),
        head: 0.05 * Math.sin(2 * ph + 0.9),
        armN: { a1: 0.78 + 0.5 * c, a2: 0.12 + 0.3 * c },
        armF: { a1: 0.56 - 0.5 * c, a2: 0.02 - 0.3 * c },
        footN: { x: 52 + 62 * c, lift: liftN, ang: -0.35 * (liftN / 40) },
        footF: { x: -38 - 62 * c, lift: liftF, ang: -0.35 * (liftF / 40) },
        tail: 0.35 * s,
      };
    },
    happy(d) {
      const T = [
        { sq: 0.82, y: 0, up: 0.1, mouth: 0.4, helmet: 0.05 },
        { sq: 1.14, y: -46, up: 0.55, mouth: 1, helmet: 0.02 },
        { sq: 1.07, y: -135, up: 1, mouth: 1, helmet: -0.1 },
        { sq: 1.0, y: -165, up: 1, mouth: 1, helmet: -0.16 },
        { sq: 1.02, y: -140, up: 0.9, mouth: 1, helmet: -0.1 },
        { sq: 1.06, y: -62, up: 0.55, mouth: 1, helmet: 0.02 },
        { sq: 0.8, y: 0, up: 0.2, mouth: 0.6, helmet: 0.12 },
        { sq: 0.95, y: 0, up: 0.1, mouth: 0.5, helmet: 0.04 },
      ][d];
      const air = clamp(-T.y / 120);
      return {
        sq: T.sq,
        y: T.y,
        eyeMode: 'happy',
        mouth: T.mouth,
        helmet: T.helmet,
        head: -0.06 * T.up,
        armN: { a1: lerp(0.78, -1.05, T.up), a2: lerp(0.12, -1.3, T.up) },
        armF: { a1: lerp(0.56, -1.25, T.up), a2: lerp(0.02, -1.45, T.up) },
        footN: { x: 52 + 10 * air, lift: 0, ang: 0.35 * air },
        footF: { x: -38 - 10 * air, lift: 0, ang: 0.35 * air },
        tail: 0.5 * air,
        fx: { kind: 'sparkle', k: d },
      };
    },
    dig(d, n) {
      // lying low over the heap, two scoops per loop: near paw on drawings 0-3, far paw on 4-7.
      // Each scoop: reach forward, dig in, rake back under the chest, fling.
      const S = [
        { a1: -0.25, a2: 0.25 },
        { a1: 0.55, a2: 1.0 },
        { a1: 1.3, a2: 1.75 },
        { a1: 2.0, a2: 2.5 },
      ];
      const rest = { a1: 1.0, a2: 1.3 };
      return {
        x: -170,
        y: d % 2 ? -5 : 0,
        lean: 0.52 + 0.04 * Math.cos((TAU * d) / 4),
        sq: 0.94,
        legh: 34,
        head: 0.04,
        armN: d < 4 ? S[d] : rest,
        armF: d >= 4 ? S[d - 4] : rest,
        footN: { x: 70, lift: 0, ang: 0 },
        footF: { x: -60, lift: 0, ang: 0 },
        tail: 0.35 * Math.sin((TAU * d) / 4),
        fx: { kind: 'dig', d, n },
      };
    },
    attack(d) {
      const T = [
        { x: 0, lean: 0.02, a1: 0.7, a2: 0.1, sq: 1.0, slash: 0, brow: 0.5 },
        { x: -26, lean: -0.17, a1: -1.55, a2: -1.2, sq: 1.04, slash: 0, brow: 1 },
        { x: 44, lean: 0.24, a1: 0.95, a2: 0.55, sq: 0.97, slash: 0.65, brow: 1 },
        { x: 52, lean: 0.27, a1: 1.25, a2: 0.8, sq: 0.95, slash: 1, brow: 1 },
        { x: 28, lean: 0.12, a1: 1.0, a2: 0.5, sq: 0.99, slash: 1.6, brow: 0.8 },
        { x: 8, lean: 0.04, a1: 0.8, a2: 0.2, sq: 1.0, slash: 2.2, brow: 0.5 },
      ][d];
      return {
        x: T.x,
        lean: T.lean,
        sq: T.sq,
        brow: T.brow,
        mouth: d === 2 || d === 3 ? -1 : 0, // -1: bared teeth
        armN: { a1: T.a1, a2: T.a2 },
        armF: { a1: 0.5 + 0.3 * T.lean, a2: 0.1 },
        footN: { x: 70, lift: 0, ang: 0 },
        footF: { x: -60, lift: 0, ang: 0 },
        fx: { kind: 'slash', p: T.slash },
      };
    },
    sleep(d, n) {
      const u = d / n;
      const b = W(u);
      return {
        sq: 0.66 + 0.022 * b,
        y: 0,
        head: 0.3,
        hy: 14,
        helmet: 0.24,
        eyeMode: 'closed',
        lamp: 0,
        armN: { a1: 1.15, a2: 0.35 },
        armF: { a1: 1.0, a2: 0.25 },
        footN: { x: 70, lift: 0, ang: 0 },
        footF: { x: -50, lift: 0, ang: 0 },
        tail: 0.6,
        legh: 0,
        fx: { kind: 'zzz', u },
      };
    },
  };

  // ---------------------------------------------------------------- rig
  function rig(pose) {
    const sx = 1 + (1 - pose.sq) * 0.75;
    // root: the feet on the ground; body: raised on the legs by legh
    const Mr = M.mul(M.tr(K.CX + pose.x, K.GROUND + pose.y), M.mul(M.rot(pose.lean), M.sc(sx, pose.sq)));
    const Mb = M.mul(Mr, M.tr(0, -pose.legh));
    const Mh = M.mul(Mb, M.mul(M.tr(0, pose.hy), M.about(pose.head, NECK[0], NECK[1])));
    const skin = (p) => {
      const a = M.ap(Mb, p), b = M.ap(Mh, p);
      return [lerp(a[0], b[0], p[2]), lerp(a[1], b[1], p[2])];
    };
    const body = K.smooth(SIL.map(skin), 5);
    return { Mr, Mb, Mh, body, center: M.ap(Mb, BODY_C) };
  }

  const mixC = (c, far) => (far ? L.mix(c, C.furDeep, 0.35) : c);

  // an arm: a short fur tube from the shoulder (its shoulder end melts into the body: no ink there),
  // then the spade paw with five hooked claws along its front edge
  function arm(ctx, R, S, a, far, B, tag) {
    const Mb = R.Mb;
    const dx = Math.cos(a.a1), dy = Math.sin(a.a1);
    const wrist = [S[0] + dx * ARM_L, S[1] + dy * ARM_L];
    const r = 28, nx = -dy, ny = dx;
    const sideA = [[S[0] + nx * r, S[1] + ny * r], [wrist[0] + nx * r, wrist[1] + ny * r]];
    const capPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI; // from +n round the wrist end to -n
      capPts.push([wrist[0] + nx * r * Math.cos(t) + dx * r * Math.sin(t), wrist[1] + ny * r * Math.cos(t) + dy * r * Math.sin(t)]);
    }
    const sideB = [[S[0] - nx * r, S[1] - ny * r]];
    const open = M.all(Mb, [sideA[0]].concat(capPts, sideB));
    K.fill(ctx, open, mixC(L.mix(C.fur, C.furLit, 0.35), far));
    L.hatch(ctx, open, { angle: a.a1 + 1.2, spacing: 16, length: [8, 16], gap: [10, 20], width: 2.4, color: C.furLit, alpha: 0.6, clip: true, inset: 8, overshoot: 0, seed: sd('armf', tag), boil: B });
    L.inkPath(ctx, open, { width: far ? 6 : 7, seed: sd('arm', tag), boil: B, taper: [26, 26], wobble: 1 });
    // the paw, in paw space: origin at the wrist, x along a2
    const PT = M.mul(Mb, M.mul(M.tr(wrist[0], wrist[1]), M.mul(M.rot(a.a2), M.sc(1.28))));
    const claws = [];
    for (let i = 0; i < 5; i++) {
      const by = -24 + i * 12.5;
      const bx = 62 + 10 * Math.sin(((i + 0.5) / 5) * Math.PI);
      const len = 30 + 6 * Math.sin(((i + 0.5) / 5) * Math.PI);
      claws.push(K.smooth([[bx - 6, by - 7], [bx + len * 0.55, by - 5], [bx + len, by + 9], [bx + len * 0.5, by + 7], [bx - 6, by + 7]], 4));
    }
    for (let i = 0; i < 5; i++) {
      const cl = M.all(PT, claws[i]);
      K.fill(ctx, cl, mixC(C.claw, far));
      L.hatch(ctx, cl, { angle: a.a2 + 0.6, spacing: 5, width: 1.8, color: C.clawDeep, alpha: 0.8, density: 0.7, clip: true, inset: 1, overshoot: 0, seed: sd('clawh', tag, i), boil: B });
      L.inkPath(ctx, cl, { closed: true, width: 4, seed: sd('claw', tag, i), boil: B, wobble: 0.4, tremble: 0.2, taper: [3, 6] });
    }
    const palm = M.all(PT, K.smooth([[-4, -24], [26, -38], [56, -34], [74, -14], [76, 12], [60, 34], [28, 38], [2, 26]], 5));
    K.form(ctx, palm, {
      fill: mixC(C.skin, far),
      deep: C.skinDeep,
      width: far ? 6 : 7,
      seed: sd('palm', tag),
      boil: B,
      shade: 0.9,
      spacing: 8,
      hatchW: 2.6,
      hatchAlpha: 0.75,
      after(c2) {
        // three finger grooves running to the claws
        for (let k = 0; k < 3; k++) {
          const y = -12 + k * 12;
          L.inkPath(c2, M.all(PT, [[38, y * 0.8], [54, y], [66, y * 1.05]]), { width: 3, color: C.skinDeep, alpha: 0.95, seed: sd('crease', tag, k), boil: B, wobble: 0.3, taper: [4, 4] });
        }
      },
    });
  }

  function legTube(ctx, R, hip, foot, far, B, tag) {
    const H = M.ap(R.Mb, hip);
    const A = M.ap(R.Mr, [foot.x + 4, -30 - foot.lift]);
    const mid = [(H[0] + A[0]) / 2, (H[1] + A[1]) / 2];
    const len = Math.hypot(A[0] - H[0], A[1] - H[1]) + 58;
    const ang = Math.atan2(A[1] - H[1], A[0] - H[0]);
    const tube = L.capsulePts(mid[0], mid[1], len, 29, ang, 32);
    K.form(ctx, tube, { fill: mixC(C.fur, far), width: far ? 6 : 7, seed: sd('leg', tag), boil: B, shade: 0.8, spacing: 10, hatchAlpha: 0.45 });
  }

  function sole(ctx, R, foot, far, B, tag) {
    const cx = foot.x + 16, cy = -17 - foot.lift;
    const T = M.mul(R.Mr, M.about(foot.ang, cx - 30, cy));
    // four short toe claws at the front
    for (let i = 0; i < 4; i++) {
      const bx = cx + 40, by = cy - 8 + i * 6;
      const pts = [[bx, by], [bx + 10, by + 1], [bx + 19, by + 4]];
      const rib = M.all(T, K.ribbonPts(pts, 9, 2));
      K.fill(ctx, rib, mixC(C.claw, far));
      L.inkPath(ctx, rib, { closed: true, width: 3, seed: sd('toe', tag, i), boil: B, wobble: 0.3, taper: [2, 4] });
    }
    const pts = M.all(T, L.ellipsePts(cx, cy, 48, 19, 32));
    K.form(ctx, pts, { fill: mixC(C.skin, far), deep: C.skinDeep, width: far ? 5.5 : 6.5, seed: sd('sole', tag), boil: B, shade: 0.8, spacing: 7, hatchW: 2.4, hatchAlpha: 0.7 });
  }

  function tail(ctx, R, pose, B) {
    const base = [-186, -74];
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      const a = Math.PI + 0.25 - pose.tail * u - 0.35 * u * u;
      pts.push([base[0] + Math.cos(a) * 80 * u, base[1] + Math.sin(a) * 80 * u - 6 * u]);
    }
    const rib = M.all(R.Mb, K.ribbonPts(pts, 26, 9));
    K.form(ctx, rib, { fill: C.skin, deep: C.skinDeep, width: 5.5, seed: sd('tail'), boil: B, shade: 0.6, spacing: 8, hatchW: 2.2 });
  }

  function body(ctx, R, pose, B) {
    const pts = R.body;
    const c = { x: R.center[0], y: R.center[1], r: 250 };
    K.form(ctx, pts, {
      fill: C.fur,
      c,
      seed: sd('body'),
      boil: B,
      width: 11,
      spacing: 11,
      hatchW: 3,
      hatchAlpha: 0.5,
      wobble: 1.8,
      inside(c2) {
        // a softer chest under the chin: flat colour, no gradient (art bible 4)
        const chest = M.all(R.Mb, L.ellipsePts(150, -210, 70, 120, 32, -0.15));
        c2.save();
        c2.beginPath();
        L.tracePath(c2, pts, true);
        c2.clip();
        K.fill(c2, chest, C.chest);
        c2.restore();
        // fur flecks: light on the lit side, dark on the shade side
        const shade = (x, y) => sst(-0.2, 0.7, ((x - c.x) * 0.55 + (y - c.y) * 0.85) / c.r);
        L.hatch(c2, pts, { angle: -1.2, spacing: 17, length: [9, 18], gap: [10, 24], width: 2.6, color: C.furLit, alpha: 0.7, density: (x, y) => 1 - shade(x, y), clip: true, inset: 12, overshoot: 0, seed: sd('flk1'), boil: B });
        L.stipple(c2, pts, { spacing: 15, r: [1.4, 2.6], color: C.furDeep, alpha: 0.7, density: (x, y) => 0.3 + 0.7 * shade(x, y), seed: sd('stp'), boil: B });
      },
      after(c2) {
        belt(c2, R, pose, B, pts);
      },
    });
    tufts(ctx, pts, B);
    pouch(ctx, R, B);
  }

  // short fur tufts that break the back and crown outline
  function tufts(ctx, pts, B) {
    const n = pts.length;
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc < 30) continue;
      acc = 0;
      const tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      // outward normal of a clockwise-in-screen outline
      const nx = -ty / tl, ny = tx / tl;
      // only where the fur faces up or back (not the snout, belly or chest)
      if (!(ny < -0.25 || nx < -0.55)) continue;
      if (b[0] > K.CX + 150) continue;
      const h = L.h3(i, 7, sd('tuft')) ;
      const len = 13 + 9 * h;
      const back = [b[0] - (tx / tl) * 12, b[1] - (ty / tl) * 12];
      const tip = [b[0] + nx * len - (tx / tl) * 7, b[1] + ny * len - (ty / tl) * 7];
      const fwd = [b[0] + (tx / tl) * 4, b[1] + (ty / tl) * 4];
      K.fill(ctx, [back, tip, fwd, [b[0] - nx * 6, b[1] - ny * 6]], C.fur);
      L.inkPath(ctx, [back, tip, fwd], { width: 5, seed: sd('tuft', i), boil: B, wobble: 0.4, tremble: 0.2, taper: [4, 6], smooth: false });
    }
  }

  function belt(ctx, R, pose, B, bodyPts) {
    const top = (x) => -186 + 16 * (1 - (x / 230) ** 2);
    const band = [];
    for (let x = -250; x <= 250; x += 20) band.push([x, top(x)]);
    for (let x = 250; x >= -250; x -= 20) band.push([x, top(x) + 38]);
    const T = R.Mb;
    ctx.save();
    ctx.beginPath();
    L.tracePath(ctx, bodyPts, true);
    ctx.clip();
    K.fill(ctx, M.all(T, band), C.leather);
    L.hatch(ctx, M.all(T, band), { spacing: 7, width: 2.2, color: C.leatherDeep, alpha: 0.7, density: (x, y) => sst(0, 0.8, (x - R.center[0]) / 220), clip: true, seed: sd('belth'), boil: B });
    for (const off of [0, 38]) {
      const line = [];
      for (let x = -250; x <= 250; x += 25) line.push([x, top(x) + off]);
      L.inkPath(ctx, M.all(T, line), { width: 5, seed: sd('beltl', off), boil: B, wobble: 0.8 });
    }
    // stitches
    const st = [];
    for (let x = -200; x <= 110; x += 22) st.push([[x, top(x) + 7], [x + 11, top(x + 11) + 7]]);
    for (const s of st) L.inkPath(ctx, M.all(T, s), { width: 2.2, color: C.leatherDeep, seed: sd('st', s[0][0]), boil: B, smooth: false, wobble: 0.2, taper: 0 });
    ctx.restore();
    // brass buckle on the front
    const bx = 158, by = top(158) - 5;
    const outer = M.all(T, L.rrectPts(bx - 20, by, 40, 48, 8, 6));
    const inner = M.all(T, L.rrectPts(bx - 9, by + 11, 18, 26, 4, 5));
    K.form(ctx, outer, { fill: C.brass, deep: C.brassDeep, width: 5, seed: sd('buckle'), boil: B, shade: 0.8, spacing: 6, hatchW: 2 });
    K.fill(ctx, inner, C.leatherDeep);
    L.inkPath(ctx, inner, { closed: true, width: 3, seed: sd('buckle2'), boil: B, wobble: 0.3 });
  }

  function pouch(ctx, R, B) {
    const T = R.Mb;
    const bag = M.all(T, K.smooth([[-196, -176], [-104, -180], [-98, -118], [-120, -92], [-178, -92], [-200, -120]], 5));
    K.form(ctx, bag, { fill: C.leather, deep: C.leatherDeep, width: 6, seed: sd('pouch'), boil: B, shade: 0.9, spacing: 7, hatchW: 2.4, hatchAlpha: 0.7 });
    const flap = M.all(T, K.smooth([[-200, -180], [-100, -184], [-104, -150], [-150, -136], [-196, -150]], 5));
    K.form(ctx, flap, { fill: C.leatherDeep, deep: P.ink, width: 5.5, seed: sd('flap'), boil: B, shade: 0.5, spacing: 7, hatchW: 2.2, hatchAlpha: 0.6 });
    const btn = M.all(T, L.ellipsePts(-150, -143, 8, 8, 16));
    K.form(ctx, btn, { fill: C.brass, width: 3, seed: sd('btn'), boil: B, shade: 0 });
  }

  function face(ctx, R, pose, B) {
    const H = R.Mh;
    // blush: pink stipple on the cheek
    L.stipple(ctx, M.all(H, L.ellipsePts(236, -368, 28, 17, 24)), { spacing: 7, r: [1.6, 2.8], color: C.skinDeep, alpha: 0.75, seed: sd('blush'), boil: B });
    // eye
    const E = [206, -414];
    if (pose.eyeMode === 'happy') {
      L.inkPath(ctx, M.all(H, [[E[0] - 16, E[1] + 6], [E[0], E[1] - 9], [E[0] + 16, E[1] + 6]]), { width: 6, seed: sd('eyeH'), boil: B, taper: [4, 4], wobble: 0.3 });
    } else if (pose.eyeMode === 'closed' || pose.eye < 0.2) {
      L.inkPath(ctx, M.all(H, [[E[0] - 16, E[1] - 2], [E[0], E[1] + 7], [E[0] + 16, E[1] - 2]]), { width: 5.5, seed: sd('eyeC'), boil: B, taper: [4, 4], wobble: 0.3 });
    } else {
      const ry = 21 * pose.eye;
      K.fill(ctx, M.all(H, L.ellipsePts(E[0], E[1], 17, ry, 20)), C.eye);
      if (pose.eye > 0.6) {
        K.fill(ctx, M.all(H, L.ellipsePts(E[0] - 5, E[1] - 7, 6, 6, 12)), P.white);
        K.fill(ctx, M.all(H, L.ellipsePts(E[0] + 6, E[1] + 8, 2.6, 2.6, 8)), P.white, 0.8);
      }
    }
    if (pose.brow > 0) {
      // an angry brow, slanting down toward the snout
      L.inkPath(ctx, M.all(H, [[E[0] - 20, E[1] - 30 + 4 * (1 - pose.brow)], [E[0] + 18, E[1] - 20]]), { width: 6.5, seed: sd('brow'), boil: B, taper: [3, 5], smooth: false });
    }
    // mouth
    if (pose.mouth > 0.3) {
      const o = pose.mouth;
      const mouth = M.all(H, K.smooth([[322, -333], [300, -322 + 6 * o], [276, -316 + 8 * o], [264, -324]], 4));
      K.fill(ctx, mouth, C.mouth);
      K.fill(ctx, M.all(H, L.ellipsePts(288, -318 + 5 * o, 12, 6, 16)), C.skin);
      L.inkPath(ctx, mouth, { closed: true, width: 4.2, seed: sd('mouthO'), boil: B, wobble: 0.3 });
    } else if (pose.mouth < 0) {
      // bared teeth: two incisors under the snout
      const m = M.all(H, [[324, -333], [300, -326], [270, -322]]);
      for (const tx of [306, 294]) {
        const tooth = M.all(H, [[tx - 5, -330 + (306 - tx) * 0.3], [tx + 5, -331 + (306 - tx) * 0.3], [tx + 3, -314], [tx - 4, -314]]);
        K.fill(ctx, tooth, P.white);
        L.inkPath(ctx, tooth, { closed: true, width: 2.6, seed: sd('tooth', tx), boil: B, wobble: 0.2, smooth: false, taper: 0 });
      }
      L.inkPath(ctx, m, { width: 4.4, seed: sd('mouthT'), boil: B, wobble: 0.3 });
    } else {
      L.inkPath(ctx, M.all(H, [[322, -334], [300, -326], [278, -324]]), { width: 4.2, color: P.inkSoft, seed: sd('mouth'), boil: B, wobble: 0.3 });
    }
    // whiskers
    const wr = [326, -346];
    for (let k = 0; k < 3; k++) {
      const a = -0.55 + k * 0.42;
      const tip = [wr[0] + Math.cos(a) * 92, wr[1] + Math.sin(a) * 92 - 6];
      L.inkPath(ctx, M.all(H, [wr, [lerp(wr[0], tip[0], 0.5), lerp(wr[1], tip[1], 0.5) - 4], tip]), { width: 2.4, alpha: 0.85, seed: sd('wh', k), boil: B, taper: [2, 18], wobble: 0.5 });
    }
    // nose, which twitches up
    const nz = pose.nose;
    const N = M.mul(H, M.mul(M.tr(0, -7 * nz), M.about(-0.25 * nz, 350, -356)));
    const nose = M.all(N, L.ellipsePts(360, -356, 25, 19, 28, -0.2));
    K.form(ctx, nose, { fill: C.skin, deep: C.skinDeep, width: 6, seed: sd('nose'), boil: B, shade: 1, spacing: 6, hatchW: 2.2, hatchAlpha: 0.8 });
    K.fill(ctx, M.all(N, L.ellipsePts(372, -350, 4.5, 3.5, 12, -0.2)), P.ink);
    K.fill(ctx, M.all(N, L.ellipsePts(352, -364, 6, 3.5, 12, -0.3)), P.white, 0.8);
  }

  function helmet(ctx, R, pose, B) {
    const Hm = M.mul(R.Mh, M.about(pose.helmet, 40, -470));
    // dome
    const dome = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (i / 24) * Math.PI;
      dome.push([32 + Math.cos(a) * 160, -470 + Math.sin(a) * 118]);
    }
    const domePts = M.all(Hm, K.smooth(dome.concat([[196, -466], [-132, -466]]), 5));
    const dc = M.ap(Hm, [32, -520]);
    K.form(ctx, domePts, {
      fill: C.helmet,
      deep: C.helmetDeep,
      c: { x: dc[0], y: dc[1], r: 150 },
      width: 8,
      seed: sd('dome'),
      boil: B,
      spacing: 9,
      hatchW: 2.8,
      hatchAlpha: 0.75,
      inside(c2) {
        // a hard, narrow highlight on the lit upper left
        const hl = [];
        for (let i = 0; i <= 6; i++) {
          const a = Math.PI * 1.12 + (i / 6) * 0.55;
          hl.push([32 + Math.cos(a) * 128, -476 + Math.sin(a) * 92]);
        }
        L.inkPath(c2, M.all(Hm, hl), { width: 13, color: C.helmetLit, seed: sd('hl'), boil: B, taper: [10, 16], wobble: 0.6 });
      },
      after(c2) {
        // band above the brim, a dent and three rivets
        const band = [];
        for (let x = -120; x <= 186; x += 34) band.push([x, -500 + 0.0008 * (x - 30) ** 2 * 0.2]);
        L.inkPath(c2, M.all(Hm, band), { width: 4.2, color: P.inkSoft, seed: sd('band'), boil: B, wobble: 0.6 });
        L.inkPath(c2, M.all(Hm, [[-40, -560], [-22, -548], [-4, -556]]), { width: 3.6, color: C.helmetDeep, seed: sd('dent'), boil: B, wobble: 0.3 });
        for (const rx of [-80, -20, 40]) K.fill(c2, M.all(Hm, L.ellipsePts(rx, -485, 5, 5, 10)), C.helmetDeep);
      },
    });
    // brim, a flat ellipse seen almost edge-on
    const brim = M.all(Hm, L.ellipsePts(44, -466, 180, 17, 40));
    K.form(ctx, brim, { fill: C.helmetDeep, deep: P.ink, width: 6.5, seed: sd('brim'), boil: B, shade: 0.6, spacing: 7, hatchW: 2.2 });
    // lamp: brass housing and glass, glowing when on
    const lampT = M.mul(Hm, M.about(-0.12, 156, -536));
    const house = M.all(lampT, L.rrectPts(126, -560, 58, 46, 12, 6));
    K.form(ctx, house, { fill: C.brass, deep: C.brassDeep, width: 6, seed: sd('lamp'), boil: B, spacing: 6, hatchW: 2.2, hatchAlpha: 0.8 });
    const g = M.ap(lampT, [186, -537]);
    if (pose.lamp > 0) {
      const glow = ctx.createRadialGradient(g[0], g[1], 4, g[0], g[1], 90);
      glow.addColorStop(0, L.rgba(C.glass, 0.55 * pose.lamp));
      glow.addColorStop(1, L.rgba(C.glass, 0));
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(g[0], g[1], 90, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const glass = M.all(lampT, L.ellipsePts(186, -537, 11, 21, 20));
    K.form(ctx, glass, { fill: pose.lamp > 0 ? C.glass : L.mix(C.glass, C.brassDeep, 0.5), width: 4.5, seed: sd('glass'), boil: B, shade: 0 });
  }

  // ---------------------------------------------------------------- effects
  function effects(ctx, R, pose, B) {
    const fx = pose.fx;
    if (!fx) return;
    if (fx.kind === 'dig') {
      // a heap of earth under the snout; clods flung up and back over the digger, two scoops a loop
      const H0 = M.ap(R.Mr, [330, 0]);
      const hx = H0[0], gy = K.GROUND;
      const heap = K.smooth([[hx - 120, gy + 4], [hx - 80, gy - 34], [hx - 12, gy - 52], [hx + 60, gy - 30], [hx + 100, gy + 4]], 5);
      K.form(ctx, heap, { fill: C.dirt, deep: C.dirtDeep, width: 7, seed: sd('heap'), boil: B, spacing: 8, hatchAlpha: 0.7 });
      L.stipple(ctx, heap, { spacing: 12, r: [1.6, 3], color: C.dirtDeep, alpha: 0.8, seed: sd('heaps'), boil: B });
      const ox = hx - 70, oy = gy - 50;
      for (const e of [-6, -2, 2, 6]) {
        const age = fx.d - e;
        if (age < 0 || age > 5) continue;
        for (let k = 0; k < 4; k++) {
          const h1 = L.h3(k, (e + 8) & 7, 77), h2 = L.h3(k, (e + 8) & 7, 91);
          const vx = -(34 + 18 * h1), vy = -(66 + 22 * h2);
          const tt = age + 0.6;
          const cx = ox + vx * tt, cy = oy + vy * tt + 13 * tt * tt;
          if (cy > gy) continue;
          const r = 10 + 8 * L.h3(k, 5, (e + 8) & 7);
          const clod = L.ellipsePts(cx, cy, r, r * 0.8, 10, h1 * 3 + tt);
          K.form(ctx, clod, { fill: C.dirt, deep: C.dirtDeep, width: 4.5, seed: sd('clod', k, (e + 8) & 7), boil: B, shade: 0.6, spacing: 5, hatchW: 2 });
        }
      }
    } else if (fx.kind === 'slash' && fx.p > 0) {
      // three claw marks, drawn on with the swipe, then fading
      const draw = clamp(fx.p);
      const alpha = fx.p <= 1 ? 1 : clamp(1 - (fx.p - 1) / 1.2);
      if (alpha <= 0) return;
      // crescents that grow along the swipe (draw) and then thin out (alpha)
      const O = M.ap(R.Mr, [200, -270]);
      for (let k = 0; k < 3; k++) {
        const top = [], bot = [];
        const n = 14;
        for (let i = 0; i <= n; i++) {
          const u = (i / n) * draw;
          const x = O[0] - 50 + k * 46 + 150 * u, y = O[1] - 150 + k * 16 + 250 * u;
          const bulge = 34 * Math.sin(Math.PI * u);
          const w = 20 * Math.sin(Math.PI * Math.min(1, u / Math.max(draw, 0.01))) * (fx.p > 1 ? alpha : 1);
          top.push([x + bulge + w * 0.8, y - w * 0.3]);
          bot.push([x + bulge - w * 0.8, y + w * 0.3]);
        }
        const cr = top.concat(bot.reverse());
        K.fill(ctx, cr, P.white, alpha);
        L.inkPath(ctx, cr, { closed: true, width: 5, alpha, seed: sd('slash', k), boil: B, wobble: 0.5, taper: [4, 8] });
      }
    } else if (fx.kind === 'sparkle') {
      // the house overlay: a yellow attention ring and two ink stars at the top of the jump
      const k = fx.k;
      if (k >= 2 && k <= 6) {
        const u = (k - 2) / 4;
        const c = M.ap(R.Mh, [60, -470]);
        L.inkPath(ctx, L.ellipsePts(c[0], c[1], 150 + 170 * L.ease.outExpo(u), 150 + 170 * L.ease.outExpo(u), 64), { closed: true, width: 5, color: P.annYellow, alpha: 1 - u, seed: sd('ring'), boil: B, wobble: 1.2 });
        for (let s = 0; s < 3; s++) {
          const a = -2.3 + s * 0.9;
          const r = 230 + 60 * u;
          const sx = c[0] + Math.cos(a) * r, sy = c[1] + Math.sin(a) * r;
          const sz = (18 + 8 * s) * (1 - 0.4 * u);
          const star = [];
          for (let i = 0; i < 8; i++) {
            const rr = i % 2 ? sz * 0.35 : sz;
            const aa = (i / 8) * TAU;
            star.push([sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr]);
          }
          K.fill(ctx, star, P.annYellow, 1 - u * 0.6);
          L.inkPath(ctx, star, { closed: true, width: 3.2, alpha: 1 - u * 0.6, seed: sd('star', s), boil: B, smooth: false, taper: 0 });
        }
      }
    } else if (fx.kind === 'zzz') {
      const c = M.ap(R.Mh, [300, -420]);
      for (let k = 0; k < 3; k++) {
        const p = (fx.u + k / 3) % 1;
        const a = sst(0, 0.15, p) * (1 - sst(0.75, 1, p));
        if (a <= 0.02) continue;
        const sz = 22 + 26 * p;
        const x = c[0] + 40 + 90 * p + 14 * Math.sin(TAU * p * 1.5), y = c[1] - 40 - 260 * p;
        const z = [[x - sz / 2, y - sz / 2], [x + sz / 2, y - sz / 2], [x - sz / 2, y + sz / 2], [x + sz / 2, y + sz / 2]];
        L.inkPath(ctx, z, { width: 5 + 3 * p, alpha: a, seed: sd('z', k), boil: B, smooth: false, taper: [3, 6], wobble: 0.3 });
      }
    }
  }

  // ---------------------------------------------------------------- draw
  function draw(ctx, anim, d, A) {
    const pose = K.pose(REST, POSES[anim](d, A.n));
    const B = d % A.boil;
    const R = rig(pose);
    const Mb = R.Mb;
    K.shadow(ctx, K.CX + pose.x + 20 + 180 * pose.lean, -pose.y, 250, B, sd('shadow'));
    tail(ctx, R, pose, B);
    legTube(ctx, R, HIP_F, pose.footF, true, B, 'f');
    sole(ctx, R, pose.footF, true, B, 'f');
    arm(ctx, R, SHOULDER_F, pose.armF, true, B, 'f');
    legTube(ctx, R, HIP_N, pose.footN, false, B, 'n');
    body(ctx, R, pose, B);
    sole(ctx, R, pose.footN, false, B, 'n');
    face(ctx, R, pose, B);
    helmet(ctx, R, pose, B);
    arm(ctx, R, SHOULDER_N, pose.armN, false, B, 'n');
    effects(ctx, R, pose, B);
    void Mb;
  }

  K.define(ID, { draw, stripe: P.stripeSage, colors: C });
})();
