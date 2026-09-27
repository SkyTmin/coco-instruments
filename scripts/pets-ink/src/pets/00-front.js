// pets/00-front.js : the front kit (v2.74). The pet faces the player.
//
// Chibi build: a big head (about half the height) over a small body, the face low on the head,
// big glossy eyes. The head can turn a little: features ride on a sphere, so at depth d they slide
// by turn·R·0.24·d while the silhouette stays — the pet looks around without being redrawn from
// another angle. Every form is lit (K.cel): a shadow crescent on the lower right, a rim of
// reflected light, hatching in the shadow, the ink outline.
//
// Plans (S.plan): 'stand' (two legs and two arms: mole, mouse, badger, raccoon, the cockroach with
// four arms), 'sit' (a quadruped sitting up: front legs, hind thighs and feet), 'bird' (folded
// wings for arms, bird feet, a tail fan behind), 'spider' (legs arching out on both sides).
// Shapes are given for the right half and mirrored (sym), the left side is side = -1.
//
// Layers, back to front:
//   shadow > hooks.behind > tail > wings behind (bird spread) > spider legs > legs (stand) >
//   body (hooks.body clipped) > hooks.bodyAfter > thighs, hind feet, front legs (sit) > arms or
//   wings > hooks.front > ears > head (hooks.skin clipped) > muzzle > eyes > nose/beak > mouth >
//   whiskers > hooks.face > hooks.head > hands' items (hooks.hand) > effects (hooks.fx)
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp;
  const TAU = Math.PI * 2;
  const sdOf = (S) => (...k) => L.hash(S.id, ...k) & 0x7fffffff;
  const CX = 540;
  K.CXF = CX;

  /** A symmetric outline from its right half (top centre, round the right side, bottom centre). */
  const sym = (half) => half.concat(half.slice(1, -1).reverse().map(([x, y]) => [-x, y]));
  K.sym = sym;
  const mir = (pts, side) => (side > 0 ? pts : pts.map(([x, y]) => [-x, y]));
  K.mir = mir;

  const REST = {
    x: 0, y: 0, sq: 1, lean: 0, scale: 1, low: 0,
    head: 0, turn: 0, nod: 0, hx: 0, hy: 0,
    eye: 1, eyeMode: 'open', eyeL: null, eyeR: null, lid: null, look: null,
    mouth: 0, tongue: 1,
    arm: { l: 0, r: 0 },
    leg: { l: 0, r: 0 },
    tail: 0, ear: 0, wing: 0,
    hide: false,
    fx: null,
  };

  // ---------------------------------------------------------------- shared animations
  function poses(S) {
    const bird = S.plan === 'bird';
    return {
      idle(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 1 + 0.018 * b,
          hy: 4 * b,
          head: 0.035 * K.wave(u + 0.25),
          turn: 0.2 * K.wave(u + 0.1),
          eye: d === 7 ? 0.1 : 1,
          ear: d === 3 || d === 4 ? 1 : 0,
          tail: 0.16 * K.wave(u),
          arm: { l: 0.05 * K.wave(u + 0.5), r: 0.05 * b },
          wing: bird ? 0.02 + 0.02 * b : 0,
        };
      },
      walk(d, n) {
        const ph = (TAU * d) / n;
        const s = Math.sin(ph);
        return {
          y: -12 * Math.abs(s),
          lean: 0.035 * s,
          head: -0.03 * s,
          turn: 0.08 * s,
          leg: { l: Math.max(0, -s) * 42, r: Math.max(0, s) * 42 },
          arm: bird ? { l: 0.1 * Math.abs(s), r: 0.1 * Math.abs(s) } : { l: 0.28 * s, r: -0.28 * s },
          tail: 0.3 * s,
          ear: 0.3 * Math.abs(s),
          wing: bird ? 0.08 : 0,
        };
      },
      happy(d) {
        const T = [
          // arms up to the height of the cheeks, not over the face
          { sq: 0.86, y: 0, arm: 0.2 },
          { sq: 1.1, y: -60, arm: 1.7 },
          { sq: 1.04, y: -150, arm: 2.0 },
          { sq: 1.0, y: -180, arm: 2.1 },
          { sq: 1.02, y: -150, arm: 2.0 },
          { sq: 1.04, y: -60, arm: 1.6 },
          { sq: 0.85, y: 0, arm: 0.6 },
          { sq: 0.97, y: 0, arm: 0.2 },
        ][d];
        const air = clamp(-T.y / 120);
        return {
          sq: T.sq,
          y: T.y,
          head: -0.05,
          arm: { l: T.arm, r: T.arm },
          leg: { l: 22 * air, r: 22 * air },
          wing: bird ? clamp(T.arm / 2.0) : 0,
          eyeMode: 'happy',
          mouth: 0.75,
          ear: -0.6 * air,
          tail: 0.4 * air,
          fx: { kind: 'burst', k: d },
        };
      },
      attack(d) {
        const T = [
          { scale: 1, lean: 0, arm: 0, p: 0, sq: 1 },
          { scale: 0.95, lean: -0.1, arm: 2.1, p: 0, sq: 0.92, y: 0 },
          { scale: 1.12, lean: 0.06, arm: -0.3, p: 0.5, sq: 1.04, y: 18 },
          { scale: 1.15, lean: 0.07, arm: -0.5, p: 1, sq: 1.02, y: 22 },
          { scale: 1.06, lean: 0.02, arm: 0.1, p: 1.4, sq: 1, y: 8 },
          { scale: 1, lean: 0, arm: 0, p: 2, sq: 1, y: 0 },
        ][d];
        return {
          scale: T.scale,
          lean: T.lean,
          sq: T.sq,
          y: T.y || 0,
          arm: { l: d === 1 ? 0.4 : 0, r: T.arm },
          wing: bird ? (d === 1 ? 0.7 : d === 2 || d === 3 ? 0.3 : 0) : 0,
          eyeMode: d >= 1 && d <= 4 ? 'angry' : 'open',
          mouth: d >= 2 && d <= 3 ? 0.9 : 0,
          ear: d === 1 ? -1 : 0,
          fx: { kind: S.attack || 'slash', p: T.p },
        };
      },
      sleep(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 0.9 + 0.02 * b,
          low: S.sleepLow == null ? 40 : S.sleepLow,
          head: 0.16,
          turn: 0.12,
          hy: 36 + 3 * b,
          eyeMode: 'closed',
          ear: -1,
          tail: 0.1,
          arm: { l: -0.05, r: -0.05 },
          wing: 0,
          fx: { kind: 'zzz', u },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the rig
  function rig(S, pose) {
    const sx = (1 + (1 - pose.sq) * 0.6) * pose.scale;
    const Mr = M.chain(M.tr(CX + pose.x, K.GROUND + pose.y), M.rot(pose.lean), M.sc(sx, pose.sq * pose.scale));
    const Mb = M.mul(Mr, M.tr(0, pose.low));
    const H = S.head;
    const hs = H.scale || 1;
    const Mh = M.chain(Mb, M.tr(H.c[0] + pose.hx, H.c[1] + pose.hy), M.rot(pose.head), M.sc(hs, hs));
    const t = clamp(pose.turn, -1, 1);
    const Rh = H.rx;
    // a point of the face at depth d (1 = the front of the face, 0 = the silhouette)
    // nod < 0: the face tips up (features slide up), > 0 down
    const nd = clamp(pose.nod || 0, -1, 1);
    const Ry = H.ry || Rh;
    const hl = (x, y, d = 1) => [x + t * Rh * 0.24 * d * (1 - (0.35 * Math.abs(y)) / Ry), y + nd * Ry * 0.26 * d * (1 - (0.35 * Math.abs(x)) / Rh)];
    const hp = (x, y, d = 1) => M.ap(Mh, hl(x, y, d));
    const c = M.ap(Mb, S.bodyC || [0, -250]);
    return { S, pose, Mr, Mb, Mh, hl, hp, turn: t, center: { x: c[0], y: c[1], r: S.bodyR || 260 } };
  }

  // ---------------------------------------------------------------- parts
  const tone = (C, key, fb) => C[key] || C[fb] || C.fur;

  /** A lit form in screen space. */
  function form(ctx, pts, fill, B, seed, o = {}) {
    K.cel(ctx, pts, Object.assign({ fill, seed, boil: B }, o));
  }
  K.front = { form };

  /** Short fur strokes over a form, lighter on the lit side, darker in the shadow. */
  function fur(ctx, pts, R, B, seed, lit, deep, k = 1) {
    const f = K.shadeOf(R.center);
    L.hatch(ctx, pts, { angle: -1.25, spacing: 16 / k, length: [8, 16], gap: [10, 22], width: 2.4, color: lit, alpha: 0.75, density: (x, y) => 0.9 - f(x, y), clip: true, inset: 10, overshoot: 0, seed, boil: B });
    L.hatch(ctx, pts, { angle: -1.9, spacing: 18 / k, length: [7, 14], gap: [10, 22], width: 2.2, color: deep, alpha: 0.6, density: (x, y) => 0.15 + 0.8 * f(x, y), clip: true, inset: 10, overshoot: 0, seed: seed + 5, boil: B });
  }
  K.front.fur = fur;

  /** Tufts sticking out of an outline between fractions a..b of its length (fur ruffs). */
  function tufts(ctx, pts, a, b, fill, B, seed, len = 18) {
    const n = pts.length;
    const i0 = Math.floor(a * n), i1 = Math.floor(b * n);
    let acc = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[(i - 1 + n) % n], q = pts[i % n];
      acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (acc < 26) continue;
      acc = 0;
      const tx = q[0] - p[0], ty = q[1] - p[1], tl = Math.hypot(tx, ty) || 1;
      const nx = ty / tl, ny = -tx / tl;
      const l = len * (0.7 + 0.6 * L.h3(i, 3, seed));
      const back = [q[0] - (tx / tl) * 11, q[1] - (ty / tl) * 11];
      const tip = [q[0] + nx * l - (tx / tl) * 4, q[1] + ny * l - (ty / tl) * 4];
      const fwd = [q[0] + (tx / tl) * 5, q[1] + (ty / tl) * 5];
      K.fill(ctx, [back, tip, fwd, [q[0] - nx * 7, q[1] - ny * 7]], fill);
      L.inkPath(ctx, [back, tip, fwd], { width: 5, seed: seed + i, boil: B, wobble: 0.4, tremble: 0.2, taper: [4, 6], smooth: false });
    }
  }
  K.front.tufts = tufts;

  /** A round paw: toe lines, and the pads when it faces us (palm). */
  function paw(ctx, c, rx, ry, rot, fill, B, seed, o = {}) {
    const T = M.chain(M.tr(c[0], c[1]), M.rot(rot));
    const pts = M.all(T, L.ellipsePts(0, 0, rx, ry, 22));
    form(ctx, pts, fill, B, seed, { width: 6, off: 0.1, hatch: 0.5 });
    if (o.palm) {
      K.fill(ctx, M.all(T, L.ellipsePts(0, ry * 0.2, rx * 0.42, ry * 0.36, 16)), o.pad || '#E7A2A0');
      for (const k of [-1, 0, 1]) K.fill(ctx, M.all(T, L.ellipsePts(k * rx * 0.46, -ry * 0.42 + Math.abs(k) * ry * 0.1, rx * 0.16, ry * 0.18, 10)), o.pad || '#E7A2A0');
    } else if (o.toes !== 0) {
      for (const k of [-0.33, 0.33]) K.line(ctx, M.all(T, [[k * rx, ry * 0.2], [k * rx * 1.05, ry * 0.95]]), { width: 3.4, seed: seed + (k > 0 ? 1 : 2), boil: B, taper: [3, 2] });
    }
    if (o.claws) {
      // claws: little curved horns out of the toes, ivory with an ink edge
      const up = o.palm ? -1 : 1;
      for (const k of [-0.55, 0, 0.55]) {
        const b0 = [k * rx, up * ry * 0.8];
        const w = Math.max(6, rx * 0.16);
        const tip = [b0[0] + k * 10, b0[1] + up * o.claws];
        const cl = M.all(T, K.smooth([[b0[0] - w, b0[1]], [lerp(b0[0], tip[0], 0.55) - w * 0.7, lerp(b0[1], tip[1], 0.55)], tip, [lerp(b0[0], tip[0], 0.5) + w * 0.9, lerp(b0[1], tip[1], 0.5)], [b0[0] + w, b0[1]]], 4));
        K.fill(ctx, cl, o.clawColor || '#EDE3CF');
        L.inkPath(ctx, cl, { closed: true, width: 3.2, seed: seed + 9 + Math.round(k * 10), boil: B, wobble: 0.3, taper: [2, 4] });
      }
    }
  }
  K.front.paw = paw;

  // the tail: control points from the base (behind the body) to the tip, swinging round the base
  function tail(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), T = S.tail;
    if (!T) return;
    const base = T.pts[0];
    const n = T.pts.length;
    const pts = T.pts.map(([x, y], i) => {
      const a = R.pose.tail * (i / (n - 1)) * (T.swing || 1);
      const dx = x - base[0], dy = y - base[1];
      return [base[0] + dx * Math.cos(a) - dy * Math.sin(a), base[1] + dx * Math.sin(a) + dy * Math.cos(a)];
    });
    const c = M.all(R.Mb, K.curve(pts, 6));
    const w = (u) => {
      const b = T.bushy ? Math.sin(Math.PI * clamp(0.12 + u * 0.88)) * 0.75 + 0.35 : 1;
      const base = lerp(T.w0, T.w1, u) * b;
      return u > 0.88 ? base * Math.sqrt(Math.max(0.03, 1 - ((u - 0.88) / 0.12) ** 2)) : base;
    };
    const rib = K.ribbonPts(c, w);
    form(ctx, rib, T.fill || C.fur, B, sd('tail'), {
      width: 7,
      off: 0.06,
      inside(c2) {
        if (T.rings) {
          for (let k = 1; k <= T.rings; k++) {
            const i = Math.floor((k / (T.rings + 1)) * (c.length - 1));
            const q = c[i], nb = c[Math.min(c.length - 1, i + 1)];
            const a = Math.atan2(nb[1] - q[1], nb[0] - q[0]);
            K.fill(c2, L.ellipsePts(q[0], q[1], 14, 80, 16, a), T.ringColor);
          }
        }
        if (T.tip) {
          const k0 = Math.floor(c.length * (1 - T.tipLen));
          K.fill(c2, K.ribbonPts(c.slice(k0), (u) => w(1 - T.tipLen + u * T.tipLen) * 1.25), T.tip);
        }
        if (T.bushy) fur(c2, rib, R, B, sd('tailFur'), T.lit || C.furLit || '#FFF', T.deep || C.furDeep || '#333', 1.2);
      },
    });
  }

  function body(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const pts = M.all(R.Mb, K.smooth(sym(S.body.half), 5));
    form(ctx, pts, S.body.fill || C.fur, B, sd('body'), {
      width: 10,
      c: R.center,
      inside(c2) {
        if (S.belly) {
          const bp = S.belly.half ? K.smooth(sym(S.belly.half), 5) : L.ellipsePts(S.belly[0], S.belly[1], S.belly[2], S.belly[3], 32);
          K.fill(c2, M.all(R.Mb, bp), C.belly || C.chest);
        }
        if (S.hooks.body) S.hooks.body(c2, R, B, pts);
        if (S.fur !== false) fur(c2, pts, R, B, sd('fur'), C.furLit || '#FFFFFF', C.furDeep || '#333333');
      },
    });
    if (S.body.tufts) for (const [a, b] of S.body.tufts) tufts(ctx, pts, a, b, S.body.fill || C.fur, B, sd('bt', a));
    if (S.hooks.bodyAfter) S.hooks.bodyAfter(ctx, R, B, pts);
  }

  // ---- stand: legs, feet, arms
  function legs(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), G = S.legs;
    if (!G) return;
    for (const side of [-1, 1]) {
      const lift = side > 0 ? R.pose.leg.r : R.pose.leg.l;
      const hip = M.ap(R.Mb, [G.hip[0] * side, G.hip[1]]);
      const ank = M.ap(R.Mr, [G.hip[0] * side + side * (G.splay || 6), -G.foot[1] * 0.55 - lift]);
      form(ctx, K.limbPts(hip, ank, G.r, G.r * 0.9, 8), tone(C, 'leg', 'fur'), B, sd('leg', side), { width: 7, off: 0.1, hatch: 0.5 });
      const fc = M.ap(R.Mr, [G.hip[0] * side + side * (G.splay || 6) + side * 8, -G.foot[1] * 0.5 - lift]);
      const fp = M.all(M.chain(M.tr(fc[0], fc[1]), M.rot(side * 0.12)), K.smooth([[-G.foot[0], 4], [-G.foot[0] * 0.9, -G.foot[1] * 0.6], [0, -G.foot[1]], [G.foot[0] * 0.9, -G.foot[1] * 0.6], [G.foot[0], 4], [0, G.foot[1] * 0.55]], 4));
      form(ctx, fp, tone(C, 'foot', 'leg'), B, sd('foot', side), { width: 7, off: 0.12, hatch: 0.5 });
      if (G.toes !== false) for (const k of [-0.35, 0.35]) K.line(ctx, M.all(M.chain(M.tr(fc[0], fc[1]), M.rot(side * 0.12)), [[k * G.foot[0], -G.foot[1] * 0.05], [k * G.foot[0] * 1.05, G.foot[1] * 0.45]]), { width: 3.4, seed: sd('toe', side, k), boil: B, taper: [3, 2] });
      if (S.hooks.foot) S.hooks.foot(ctx, R, B, side, fc);
    }
  }

  /** Where an arm's paw is: shoulder, direction, length. */
  function armEnd(R, A, side, extra = 0) {
    const a = (A.rest || 0.25) + (side > 0 ? R.pose.arm.r : R.pose.arm.l) + extra;
    const sh = M.ap(R.Mb, [A.at[0] * side, A.at[1]]);
    const s = R.pose.sq * R.pose.scale;
    const dir = [Math.sin(a) * side, Math.cos(a)];
    const len = A.len * s;
    return { sh, a, end: [sh[0] + dir[0] * len, sh[1] + dir[1] * len], dir };
  }
  K.front.armEnd = armEnd;

  // raised arms (past RAISE) are drawn after the head: a paw holding something up is in front
  const RAISE = 1.9;
  function arms(ctx, R, B, raised) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    if (!S.arms) return;
    S.arms.forEach((A, i) => {
      for (const side of [-1, 1]) {
        const { sh, a, end } = armEnd(R, A, side, (A.offset || 0) * (i ? 1 : 0));
        if (!!raised !== a > RAISE) continue;
        form(ctx, K.limbPts(sh, end, A.r, A.r * 0.85, 8), tone(C, A.fill || 'arm', 'fur'), B, sd('arm', i, side), { width: 7, off: 0.1, hatch: 0.5 });
        const up = a > 1.6;
        if (A.paw !== false) paw(ctx, end, A.pr || A.r * 1.25, (A.pr || A.r * 1.25) * 0.92, side * (a - 0.2) * 0.4, tone(C, A.pawFill || 'paw', 'fur'), B, sd('paw', i, side), { palm: up && A.pads !== false, pad: C.pad, claws: A.claws, clawColor: C.claw, toes: A.toes });
      }
    });
  }
  function hands(ctx, R, B) {
    const S = R.S;
    if (S.sit && S.hooks.hand) {
      for (const side of [-1, 1]) {
        const { a, end } = sitPaw(R, side);
        S.hooks.hand(ctx, R, B, side, end, a, 0);
      }
      return;
    }
    if (!S.arms || !S.hooks.hand) return;
    S.arms.forEach((A, i) => {
      for (const side of [-1, 1]) {
        const { a, end } = armEnd(R, A, side, (A.offset || 0) * (i ? 1 : 0));
        S.hooks.hand(ctx, R, B, side, end, a, i);
      }
    });
  }

  // ---- sit: hind thighs and feet, front legs
  function sit(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), G = S.sit;
    if (!G) return;
    for (const side of [-1, 1]) {
      const th = G.thigh;
      form(ctx, M.all(R.Mb, L.ellipsePts(th[0] * side, th[1], th[2], th[3], 28, -side * 0.25)), tone(C, 'thigh', 'fur'), B, sd('thigh', side), {
        width: 8,
        off: 0.12,
        hatch: 0.6,
        inside(c2, pts) {
          if (G.thighStripes)
            for (let k = 0; k < G.thighStripes; k++) {
              const y = th[1] - th[3] * 0.6 + k * th[3] * 0.42;
              K.line(c2, M.all(R.Mb, K.curve([[th[0] * side - side * th[2] * 0.9, y + 10], [th[0] * side, y - 8], [th[0] * side + side * th[2] * 0.2, y + 6]], 4)), { width: 11, color: C.stripe, seed: sd('ts', side, k), boil: B, taper: [4, 8] });
            }
          fur(c2, pts, R, B, sd('thighFur', side), C.furLit || '#fff', C.furDeep || '#333');
        },
      });
      const hf = G.hind;
      paw(ctx, M.ap(R.Mr, [hf[0] * side, -hf[3]]), hf[2], hf[3], 0, tone(C, 'hindPaw', 'paw'), B, sd('hind', side), { claws: G.claws });
    }
    for (const side of [-1, 1]) {
      const F = G.front;
      const { sh, a, end } = sitPaw(R, side);
      form(ctx, K.limbPts(sh, end, F.r, F.r * 0.82, 8), tone(C, 'leg', 'fur'), B, sd('front', side), {
        width: 7,
        off: 0.1,
        hatch: 0.5,
        inside(c2, pts) {
          if (C.sock) K.clip(c2, pts, () => K.fill(c2, K.limbPts([lerp(sh[0], end[0], F.sock || 0.55), lerp(sh[1], end[1], F.sock || 0.55)], end, F.r * 1.3, F.r * 1.3, 8), C.sock));
          if (F.stripes) {
            // bands across the leg
            const dx = end[0] - sh[0], dy = end[1] - sh[1], dl = Math.hypot(dx, dy) || 1;
            const nx = -dy / dl, ny = dx / dl;
            for (let k = 1; k <= F.stripes; k++) {
              const u = k / (F.stripes + 1);
              const c = [lerp(sh[0], end[0], u), lerp(sh[1], end[1], u)];
              K.line(c2, [[c[0] - nx * F.r * 1.1, c[1] - ny * F.r * 1.1 - 6], [c[0] + nx * F.r * 0.2, c[1] + ny * F.r * 0.2 + 4]], { width: 10, color: C.stripe, seed: sd('ls', side, k), boil: B, taper: [3, 8] });
            }
          }
        },
      });
      paw(ctx, [end[0], end[1] + 4], F.paw[0], F.paw[1], side * a * 0.5, tone(C, 'paw', 'fur'), B, sd('fpaw', side), { palm: a > 1.2, pad: C.pad, claws: G.claws, clawColor: C.claw });
    }
  }
  /** A sitting pet's front paw: shoulder, angle, where the paw is (arm raises, leg lift bends). */
  function sitPaw(R, side) {
    const F = R.S.sit.front;
    const lift = side > 0 ? R.pose.leg.r : R.pose.leg.l;
    const armA = side > 0 ? R.pose.arm.r : R.pose.arm.l;
    const sh = M.ap(R.Mb, [F.at[0] * side, F.at[1]]);
    // pose.reach { l, r }: the paw goes to a point on the ground frame (holding something up)
    const tg = R.pose.reach && R.pose.reach[side > 0 ? 'r' : 'l'];
    if (tg) {
      const end = M.ap(R.Mr, tg);
      return { sh, a: Math.atan2(Math.abs(end[0] - sh[0]), end[1] - sh[1]), end };
    }
    const a = armA * 0.62 + (F.splay || 0.04);
    // a raised foreleg bends: the paw comes up to the chest (begging), it doesn't stick out
    const bend = clamp((armA - 0.5) / 1.4) * F.len * 0.5;
    const len = Math.max(F.len * 0.35, F.len - lift * 0.6 - bend) * R.pose.sq * R.pose.scale;
    return { sh, a, end: [sh[0] + Math.sin(a) * side * len, sh[1] + Math.cos(a) * len] };
  }
  K.front.sitPaw = sitPaw;

  // ---- bird: wings, feet, tail fan
  function feather(ctx, base, end, wf, fill, deep, B, seed) {
    const dx = end[0] - base[0], dy = end[1] - base[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const m1 = [lerp(base[0], end[0], 0.45), lerp(base[1], end[1], 0.45)];
    const m2 = [lerp(base[0], end[0], 0.85), lerp(base[1], end[1], 0.85)];
    const f = K.smooth([base, [m1[0] + nx * wf, m1[1] + ny * wf], [m2[0] + nx * wf * 0.8, m2[1] + ny * wf * 0.8], end, [m2[0] - nx * wf * 0.7, m2[1] - ny * wf * 0.7], [m1[0] - nx * wf * 0.8, m1[1] - ny * wf * 0.8]], 4);
    form(ctx, f, fill, B, seed, { width: 4.5, off: 0.08, hatch: 0.5, rim: false });
    K.line(ctx, [[lerp(base[0], end[0], 0.25), lerp(base[1], end[1], 0.25)], [lerp(base[0], end[0], 0.9), lerp(base[1], end[1], 0.9)]], { width: 2.2, color: deep, alpha: 0.8, seed: seed + 1, boil: B, taper: [2, 6] });
  }
  K.front.feather = feather;

  function wings(ctx, R, B, behind) {
    const S = R.S, C = S.colors, sd = sdOf(S), W = S.wings;
    if (!W) return;
    for (const side of [-1, 1]) {
      const t = clamp(R.pose.wing + Math.max(0, (side > 0 ? R.pose.arm.r : R.pose.arm.l) / 2.6) * (W.armLift == null ? 1 : W.armLift));
      if (behind !== t > 0.5) continue;
      // pose.hold: the wings curl forward to hold something in front of the chest (W.hold)
      const rest = (R.pose.hold && W.hold) || W.fold;
      const pts = rest.map((p, i) => mir([[lerp(p[0], W.spread[i][0], t), lerp(p[1], W.spread[i][1], t)]], side)[0]);
      const wp = M.all(R.Mb, K.smooth(pts, 5));
      // flight feathers along the trailing edge (tip round to the root): the primaries at the tip
      // longest and darkest, the secondaries shorter toward the body; drawn root first so the
      // tip lies on top, the coverts (the wing shape) over all their bases
      const tip = M.ap(R.Mb, pts[W.tip]);
      const root = M.ap(R.Mb, mir([R.pose.hold && W.holdRoot ? W.holdRoot : W.root], side)[0]);
      R.wingTip = R.wingTip || {};
      R.wingTip[side] = tip;
      const tl = Math.hypot(tip[0] - root[0], tip[1] - root[1]) || 1;
      const td = [(tip[0] - root[0]) / tl, (tip[1] - root[1]) / tl];
      const trail = L.smoothPts(M.all(R.Mb, pts.slice(W.tip).concat([pts[0]])), false, 6);
      const N = W.n || 6;
      for (let k = N - 1; k >= 0; k--) {
        const u = k / (N - 1);
        const p = trail[Math.min(trail.length - 1, Math.floor(u * 0.8 * (trail.length - 1)))];
        const dd = [lerp(td[0], 0, 0.25 + 0.6 * u), lerp(td[1], 1, 0.25 + 0.6 * u)];
        const dl = Math.hypot(dd[0], dd[1]) || 1;
        const d = [dd[0] / dl, dd[1] / dl];
        const len = (W.feather || 90) * (1 - 0.45 * u) * (0.85 + 0.3 * t);
        const col = u < 0.4 ? C.primary || C.wing || C.fur : C.secondary || C.wing || C.fur;
        feather(ctx, [p[0] - d[0] * len * 0.3, p[1] - d[1] * len * 0.3], [p[0] + d[0] * len * 0.8, p[1] + d[1] * len * 0.8], (W.fw || 18) * (1 - 0.2 * u), col, C.wingLine || C.furDeep, B, sd('prim', side, k));
      }
      form(ctx, wp, C.wing || C.fur, B, sd('wing', side), {
        width: 7,
        off: 0.1,
        inside(c2) {
          if (C.covert) {
            const cv = W.covert.map((p, i) => mir([[lerp(p[0], W.covertSpread[i][0], t), lerp(p[1], W.covertSpread[i][1], t)]], side)[0]);
            K.fill(c2, M.all(R.Mb, K.smooth(cv, 5)), C.covert);
          }
          // rows of scalloped feather tips
          for (const row of W.rows || []) {
            const rp = row.map((p, i) => mir([[lerp(p[0], (W.rowsSpread ? W.rowsSpread[W.rows.indexOf(row)][i] : p)[0], t), lerp(p[1], (W.rowsSpread ? W.rowsSpread[W.rows.indexOf(row)][i] : p)[1], t)]], side)[0]);
            for (let i = 0; i + 1 < rp.length; i++) {
              const a0 = M.ap(R.Mb, rp[i]), b0 = M.ap(R.Mb, rp[i + 1]);
              const mx = (a0[0] + b0[0]) / 2, my = (a0[1] + b0[1]) / 2;
              const ddx = b0[0] - a0[0], ddy = b0[1] - a0[1];
              K.line(c2, K.curve([a0, [mx - ddy * 0.4 * side, my + ddx * 0.4 * side], b0], 5), { width: 3.2, color: C.wingLine || C.furDeep, alpha: 0.85, seed: sd('row', side, i), boil: B, taper: [3, 3] });
            }
          }
          if (S.hooks.wing) S.hooks.wing(c2, R, B, side, t);
        },
      });
    }
  }

  function birdFeet(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), F = S.feet;
    if (!F) return;
    for (const side of [-1, 1]) {
      const lift = side > 0 ? R.pose.leg.r : R.pose.leg.l;
      const top = M.ap(R.Mb, [F.at[0] * side, F.at[1]]);
      const f = M.ap(R.Mr, [F.at[0] * side + side * 6, -10 - lift]);
      form(ctx, K.limbPts(top, f, F.r, F.r * 0.85, 6), C.leg, B, sd('shank', side), { width: 5, off: 0.1, hatch: 0.4, rim: false });
      for (const a of [-0.9, -0.3, 0.3, 0.9]) {
        const ang = Math.PI / 2 + a * 0.9 * side * (a > 0 ? 1 : 1);
        const e = [f[0] + Math.cos(ang) * F.toe * side, f[1] + Math.sin(ang) * F.toe * 0.45 + 4];
        K.line(ctx, [f, e], { width: F.r * 1.4 + 4, color: P.ink, seed: sd('toeI', side, a), boil: B, taper: [2, 5], smooth: false });
        K.line(ctx, [f, e], { width: F.r * 1.4 - 1, color: C.leg, seed: sd('toeI', side, a), boil: B, taper: [2, 5], smooth: false });
        if (F.claw) K.line(ctx, [e, [e[0] + (e[0] - f[0]) * 0.18, e[1] + 6]], { width: 4.5, color: F.claw, seed: sd('claw', side, a), boil: B, taper: [4, 1] });
      }
      if (S.hooks.foot) S.hooks.foot(ctx, R, B, side, f);
    }
  }

  function fan(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), T = S.fan;
    if (!T) return;
    const base = M.ap(R.Mb, T.base);
    const sway = R.pose.tail * 0.3;
    for (let i = 0; i < T.n; i++) {
      const u = T.n === 1 ? 0.5 : i / (T.n - 1);
      const a = Math.PI / 2 + (u - 0.5) * T.spread + sway;
      const len = T.len * (1 - (T.taper || 0) * Math.abs(u - 0.5) * 2);
      const e = [base[0] + Math.cos(a) * len, base[1] + Math.sin(a) * len * 0.55];
      const bb = [base[0] + Math.cos(a) * len * 0.1, base[1]];
      feather(ctx, bb, e, T.width, T.fill ? T.fill(i) : C.tail || C.fur, C.wingLine || C.furDeep, B, sd('fan', i));
    }
  }

  // ---- spider legs: hip, knee, foot on each side; lift raises the foot
  function spiderLegs(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    if (!S.spiderLegs) return;
    for (const side of [-1, 1]) {
      S.spiderLegs.forEach((g, i) => {
        const lift = (R.pose.lifts && R.pose.lifts[side > 0 ? 'r' : 'l'] && R.pose.lifts[side > 0 ? 'r' : 'l'][i]) || 0;
        const hip = M.ap(R.Mb, [g.hip[0] * side, g.hip[1]]);
        const knee = M.ap(R.Mb, [g.knee[0] * side, g.knee[1] - lift * 0.4]);
        // a raised foot also comes in toward the middle (reaching up, not out)
        const foot = M.ap(R.Mr, [g.foot[0] * side - side * lift * 0.2, -lift]);
        const col = i % 2 ? L.mix(C.leg, '#000', 0.08) : C.leg;
        form(ctx, K.limbPts(hip, knee, g.r, g.r * 0.85, 8), col, B, sd('sl1', side, i), { width: 6, off: 0.1, hatch: 0.4, rim: false });
        form(ctx, K.limbPts(knee, foot, g.r * 0.8, g.r * 0.45, 8), col, B, sd('sl2', side, i), { width: 6, off: 0.1, hatch: 0.4, rim: false });
        if (S.hooks.leg) S.hooks.leg(ctx, R, B, side, i, hip, knee, foot);
      });
    }
  }

  // ---- the head
  function ears(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), E = S.ears;
    if (!E) return;
    for (const side of [-1, 1]) {
      const perk = R.pose.ear;
      const a = side * ((E.tilt || 0) + (perk < 0 ? -perk * (E.flop || 0.35) : -perk * 0.12));
      const at = R.hl(E.at[0] * side, E.at[1], 0.3);
      const T = M.chain(R.Mh, M.tr(at[0], at[1]), M.rot(a));
      // the left ear can have its own shape (a torn ear on one side only)
      const outer = M.all(T, K.smooth(side < 0 && E.ptsL ? E.ptsL : mir(E.pts, side), 5));
      form(ctx, outer, E.fill || C.fur, B, sd('ear', side), {
        width: 7,
        off: 0.1,
        hatch: 0.5,
        inside(c2) {
          if (E.inner) {
            const inner = M.all(T, K.smooth(side < 0 && E.innerL ? E.innerL : mir(E.inner, side), 5));
            F2().form(c2, inner, E.innerFill || C.skin || '#E8A8A0', B, sd('earIn', side), { width: 0, off: 0.16, hatch: 0.3, rim: false });
          }
          if (S.hooks.ear) S.hooks.ear(c2, R, B, side, T);
        },
      });
      if (E.tuft) tufts(ctx, outer, 0.05, 0.45, E.fill || C.fur, B, sd('eart', side), 14);
    }
  }

  function head(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), H = S.head;
    const half = H.half || null;
    const outline = half ? K.smooth(sym(half), 5) : L.ellipsePts(0, 0, H.rx, H.ry, 40);
    const pts = M.all(R.Mh, outline);
    form(ctx, pts, H.fill || C.fur, B, sd('head'), {
      width: 10,
      c: { x: M.ap(R.Mh, [0, 0])[0], y: M.ap(R.Mh, [0, 0])[1], r: H.rx * 1.1 },
      inside(c2) {
        if (S.hooks.skin) S.hooks.skin(c2, R, B, pts);
        if (S.fur !== false) fur(c2, pts, R, B, sd('headFur'), C.furLit || '#fff', C.furDeep || '#333', 1.1);
      },
    });
    if (H.tufts) for (const [a, b, len] of H.tufts) tufts(ctx, pts, a, b, H.fill || C.fur, B, sd('ht', a), len || 18);
    face(ctx, R, B);
    if (S.hooks.head) S.hooks.head(ctx, R, B, pts);
  }

  function face(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), F = S.face, pose = R.pose;
    const T = R.Mh;
    // the muzzle: a lighter shape low on the face
    if (F.muzzle) {
      const mz = F.muzzle.half ? K.smooth(sym(F.muzzle.half), 5) : L.ellipsePts(0, F.muzzle[1], F.muzzle[2], F.muzzle[3], 28);
      const pts = mz.map(([x, y]) => M.ap(T, R.hl(x, y, 0.9)));
      form(ctx, pts, C.muzzle || C.belly || '#F4ECDF', B, sd('muzzle'), { width: F.muzzleInk == null ? 5 : F.muzzleInk, off: 0.14, hatch: 0.4, rim: false });
    }
    if (F.blush)
      for (const side of [-1, 1]) {
        // a soft oval and three little strokes: the blush of a cartoon cheek
        const c = R.hp(F.blush[0] * side, F.blush[1], 0.8);
        const r = F.blush[2];
        K.fill(ctx, L.ellipsePts(c[0], c[1], r, r * 0.58, 24), C.blush || '#E88A8A', 0.45);
        for (let k = -1; k <= 1; k++) K.line(ctx, [[c[0] + k * r * 0.42 - r * 0.12, c[1] + r * 0.18], [c[0] + k * r * 0.42 + r * 0.12, c[1] - r * 0.2]], { width: 3, color: L.mix(C.blush || '#E88A8A', '#6E2A2A', 0.35), alpha: 0.8, seed: sd('bl', side, k), boil: B, smooth: false, taper: [2, 2] });
      }
    const E = F.eyes;
    for (const side of [-1, 1]) {
      const c = R.hl(E.x * side, E.y, 0.85);
      const near = side * R.turn > 0;
      const k = 1 - Math.abs(R.turn) * (near ? 0.22 : 0.08);
      const look = pose.look || E.look || [-0.08 * side + R.turn * 0.25, 0.06];
      // each eye can be told apart (a wink): pose.eyeL / pose.eyeR over pose.eyeMode
      const mode = (side > 0 ? pose.eyeR : pose.eyeL) || pose.eyeMode;
      const lid = mode === 'happy' ? 0 : pose.lid != null ? pose.lid : E.lid;
      K.eyeBig(ctx, T, c[0], c[1], { rx: E.rx * k, ry: E.ry, iris: E.iris, irisR: E.irisR, white: E.white, slit: E.slit, lid, lidColor: E.lidColor || H0(C), tilt: (E.tilt || 0) * side, lash: E.lash ? side : 0, mode, open: pose.eye, look, lineColor: C.eyeLine, beadLit: E.beadLit }, B, sd('eye', side));
    }
    if (S.beak) beak(ctx, R, B);
    if (F.nose) {
      const n = F.nose;
      const c = R.hl(0, n.y, 1);
      const pts = M.all(T, K.smooth([[c[0] - n.w, c[1] - n.h * 0.45], [c[0], c[1] - n.h * 0.6], [c[0] + n.w, c[1] - n.h * 0.45], [c[0] + n.w * 0.35, c[1] + n.h * 0.4], [c[0], c[1] + n.h * 0.5], [c[0] - n.w * 0.35, c[1] + n.h * 0.4]], 4));
      form(ctx, pts, C.nose || '#2A2320', B, sd('nose'), { width: 5, off: 0.1, hatch: 0, rim: false, shine: 1 });
    }
    if (F.mouth) mouth(ctx, R, B);
    if (F.whiskers) {
      const W = F.whiskers;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const a = R.hl(W.x * side, W.y + k * 10, 0.9);
          const b = [a[0] + side * W.len, a[1] - 14 + k * 16];
          K.line(ctx, M.all(T, [a, [lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5) - 4], b]), { width: 2.6, color: C.whisker || P.ink, alpha: 0.85, seed: sd('wh', side, k), boil: B, taper: [2, 8] });
        }
      }
    }
    if (S.hooks.face) S.hooks.face(ctx, R, B);
  }
  const H0 = (C) => C.fur;
  const F2 = () => K.front;

  function mouth(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), Mo = S.face.mouth, pose = R.pose;
    const T = R.Mh;
    const c = R.hl(0, Mo.y, 1);
    const w = Mo.w;
    const o = pose.mouth;
    if (o > 0.25) {
      // an open mouth: a rounded D with the tongue, fangs on top
      const h = Mo.h * (0.5 + 0.7 * o);
      const shape = M.all(T, K.smooth([[c[0] - w, c[1]], [c[0] - w * 0.5, c[1] - 4], [c[0], c[1] - 2], [c[0] + w * 0.5, c[1] - 4], [c[0] + w, c[1]], [c[0] + w * 0.6, c[1] + h * 0.8], [c[0], c[1] + h], [c[0] - w * 0.6, c[1] + h * 0.8]], 4));
      K.fill(ctx, shape, C.mouth || '#6E2A26');
      K.clip(ctx, shape, () => {
        if (pose.tongue !== 0) K.fill(ctx, M.all(T, L.ellipsePts(c[0], c[1] + h * 0.95, w * 0.62, h * 0.55, 20)), C.tongue || '#E88E86');
      });
      if (Mo.fangs) for (const s of [-1, 1]) {
        const f = M.all(T, [[c[0] + s * w * 0.62, c[1] - 1], [c[0] + s * w * 0.3, c[1] - 2], [c[0] + s * w * 0.46, c[1] + Mo.fangs]]);
        K.fill(ctx, f, '#FFFDF6');
        L.inkPath(ctx, f, { closed: true, width: 2.6, seed: sd('fang', s), boil: B, smooth: false, taper: 0, wobble: 0.2 });
      }
      L.inkPath(ctx, shape, { closed: true, width: 5, seed: sd('mouthO'), boil: B, wobble: 0.3 });
      return;
    }
    const style = Mo.style || 'cat';
    if (style === 'cat') {
      // ω: a line down from the nose, two cheeks
      K.line(ctx, M.all(T, [[c[0], c[1] - Mo.drop], [c[0], c[1]]]), { width: 4, seed: sd('m0'), boil: B, taper: [2, 2] });
      for (const s of [-1, 1]) K.line(ctx, M.all(T, K.curve([[c[0], c[1]], [c[0] + s * w * 0.45, c[1] + w * 0.35], [c[0] + s * w, c[1] - w * 0.05]], 5)), { width: 4.5, seed: sd('m', s), boil: B, taper: [2, 4] });
    } else if (style === 'smile') {
      K.line(ctx, M.all(T, K.curve([[c[0] - w, c[1] - w * 0.2], [c[0], c[1] + w * 0.35], [c[0] + w, c[1] - w * 0.2]], 5)), { width: 4.5, seed: sd('ms'), boil: B, taper: [3, 3] });
    } else if (style === 'grin') {
      // a toothy tough grin: lips with teeth showing under (the bulldog)
      const g = M.all(T, K.smooth([[c[0] - w, c[1] - 6], [c[0], c[1] + 4], [c[0] + w, c[1] - 6], [c[0] + w * 0.8, c[1] + Mo.h * 0.5], [c[0], c[1] + Mo.h * 0.7], [c[0] - w * 0.8, c[1] + Mo.h * 0.5]], 4));
      K.fill(ctx, g, C.mouth || '#6E2A26');
      for (const s of [-1, 1]) {
        const f = M.all(T, [[c[0] + s * w * 0.72, c[1] + Mo.h * 0.5], [c[0] + s * w * 0.42, c[1] + Mo.h * 0.58], [c[0] + s * w * 0.58, c[1] - (Mo.fangs || 20)]]);
        K.fill(ctx, f, '#FFFDF6');
        L.inkPath(ctx, f, { closed: true, width: 2.6, seed: sd('tusk', s), boil: B, smooth: false, taper: 0, wobble: 0.2 });
      }
      L.inkPath(ctx, g, { closed: true, width: 5, seed: sd('grin'), boil: B, wobble: 0.3 });
    }
  }

  // a beak seen from the front: the upper mandible as a rounded diamond pointing at us, the lower
  // one under it, opening with pose.mouth
  function beak(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), K2 = S.beak, pose = R.pose;
    const T = R.Mh;
    const c = R.hl(0, K2.y, 1.1);
    const o = pose.mouth;
    const w = K2.w, h = K2.h, down = K2.down || 0;
    const lower = M.all(T, K.smooth([[c[0] - w * 0.7, c[1] + h * 0.1], [c[0] + w * 0.7, c[1] + h * 0.1], [c[0] + w * 0.3, c[1] + h * (0.55 + 0.5 * o)], [c[0], c[1] + h * (0.7 + 0.6 * o)], [c[0] - w * 0.3, c[1] + h * (0.55 + 0.5 * o)]], 4));
    form(ctx, lower, C.beakLow || C.beak, B, sd('beakL'), { width: 5, off: 0.1, hatch: 0.4, rim: false });
    if (o > 0.2) K.fill(ctx, M.all(T, L.ellipsePts(c[0], c[1] + h * (0.28 + 0.2 * o), w * 0.5, h * 0.18 * (1 + o), 16)), C.mouth || '#6E2A26');
    const upper = M.all(T, K.smooth([[c[0] - w, c[1] - h * 0.15], [c[0], c[1] - h * 0.6], [c[0] + w, c[1] - h * 0.15], [c[0] + w * 0.35, c[1] + h * 0.35 + down * 0.5], [c[0], c[1] + h * 0.55 + down], [c[0] - w * 0.35, c[1] + h * 0.35 + down * 0.5]], 4));
    form(ctx, upper, C.beak, B, sd('beakU'), {
      width: 5.5,
      off: 0.1,
      hatch: 0.4,
      rim: false,
      shine: 0.8,
      after(c2) {
        for (const s of [-1, 1]) K.fill(c2, M.all(T, L.ellipsePts(c[0] + s * w * 0.3, c[1] - h * 0.18, 4.5, 3, 8)), P.ink);
        if (K2.cere) K.fill(c2, M.all(T, L.ellipsePts(c[0], c[1] - h * 0.4, w * 0.5, h * 0.14, 14)), C.cere);
        K.line(c2, M.all(T, [[c[0], c[1] - h * 0.5], [c[0], c[1] + h * 0.4 + down]]), { width: 2.4, color: C.beakDeep || P.inkSoft, alpha: 0.6, seed: sd('ridge'), boil: B });
      },
    });
  }

  /**
   * A miner's helmet seen from the front, on the head (head-local coordinates): a dome from y = cy
   * up, a brim, a band with rivets, the lamp in the middle of the front (o.lamp 0..1 its glow).
   *   o.cy, o.rx, o.ry, o.col { hat, hatDeep, hatLit, brass, brassDeep, glass }, o.tilt
   */
  function helmet(ctx, R, B, o, seed) {
    const T = M.mul(R.Mh, M.about(o.tilt || 0, 0, o.cy));
    const c = o.col;
    const dome = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (i / 24) * Math.PI;
      dome.push(R.hl(Math.cos(a) * o.rx, o.cy + Math.sin(a) * o.ry, 0.25));
    }
    const domePts = M.all(T, K.smooth(dome.concat([R.hl(o.rx * 1.02, o.cy + 6, 0.25), R.hl(-o.rx * 1.02, o.cy + 6, 0.25)]), 5));
    form(ctx, domePts, c.hat, B, seed, {
      width: 9,
      off: 0.12,
      shine: 0.9,
      inside(c2) {
        // a ridge down the middle and a dent
        K.line(c2, M.all(T, [R.hl(0, o.cy - o.ry * 0.98, 0.6), R.hl(0, o.cy - o.ry * 0.3, 0.9)]), { width: 12, color: c.hatDeep, alpha: 0.55, seed: seed + 3, boil: B });
        K.line(c2, M.all(T, [R.hl(-o.rx * 0.55, o.cy - o.ry * 0.62, 0.5), R.hl(-o.rx * 0.42, o.cy - o.ry * 0.52, 0.5), R.hl(-o.rx * 0.3, o.cy - o.ry * 0.6, 0.5)]), { width: 3.6, color: c.hatDeep, seed: seed + 4, boil: B });
        const band = [];
        for (let i = 0; i <= 12; i++) {
          const x = -o.rx + (i / 12) * o.rx * 2;
          band.push(R.hl(x, o.cy - o.ry * 0.22 - 10 * (1 - (x / o.rx) ** 2), 0.5));
        }
        K.line(c2, M.all(T, band), { width: 20, color: c.hatDeep, alpha: 0.9, seed: seed + 5, boil: B });
        for (const k of [-0.75, -0.45, 0.45, 0.75]) K.fill(c2, M.all(T, L.ellipsePts(...R.hl(k * o.rx, o.cy - o.ry * 0.22 - 10 * (1 - k * k), 0.5), 6, 6, 10)), c.hatLit);
      },
    });
    const brim = M.all(T, L.ellipsePts(...R.hl(0, o.cy + 6, 0.3), o.rx * 1.14, 20, 40));
    form(ctx, brim, c.hatDeep, B, seed + 7, { width: 7, off: 0.2, hatch: 0.5, rim: false });
    if (o.lamp != null) {
      const lc = R.hl(0, o.cy - o.ry * 0.5, 1.05);
      if (o.lamp > 0) {
        const g = M.ap(T, lc);
        const glow = ctx.createRadialGradient(g[0], g[1], 6, g[0], g[1], 130);
        glow.addColorStop(0, L.rgba(c.glass, 0.6 * o.lamp));
        glow.addColorStop(1, L.rgba(c.glass, 0));
        ctx.save();
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(g[0], g[1], 130, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      form(ctx, M.all(T, L.rrectPts(lc[0] - 36, lc[1] - 30, 72, 60, 14, 6)), c.brass, B, seed + 8, { width: 6, off: 0.12, shine: 0.8, hatch: 0.5 });
      const glass = M.all(T, L.ellipsePts(lc[0], lc[1], 22, 22, 22));
      K.fill(ctx, glass, o.lamp > 0 ? c.glass : L.mix(c.glass, c.brassDeep, 0.45));
      K.fill(ctx, M.all(T, L.ellipsePts(lc[0] - 7, lc[1] - 8, 7, 5, 10)), '#FFFFFF', 0.9);
      L.inkPath(ctx, glass, { closed: true, width: 5, seed: seed + 9, boil: B, wobble: 0.3 });
      L.inkPath(ctx, M.all(T, L.ellipsePts(lc[0], lc[1], 29, 29, 22)), { closed: true, width: 3.4, color: c.brassDeep, seed: seed + 10, boil: B, wobble: 0.3 });
    }
  }
  K.front.helmet = helmet;

  /** Goggles seen from the front (head-local): two lenses in brass rims on a strap round the head. */
  function goggles(ctx, R, B, o, seed) {
    const T = R.Mh;
    const r = o.r;
    const strap = [];
    for (let i = 0; i <= 12; i++) {
      const x = -o.w + (i / 12) * o.w * 2;
      strap.push(R.hl(x, o.y - 6 * (1 - (x / o.w) ** 2), 0.4));
    }
    K.line(ctx, M.all(T, strap), { width: r * 0.62 + 6, color: P.ink, seed, boil: B, taper: 0 });
    K.line(ctx, M.all(T, strap), { width: r * 0.62, color: o.strap || '#3B2A20', seed, boil: B, taper: 0 });
    for (const s of [-1, 1]) {
      const c = R.hl(s * r * 1.05, o.y, 0.95);
      F2().form(ctx, M.all(T, L.ellipsePts(c[0], c[1], r, r * 0.94, 24)), o.brass || '#C39A55', B, seed + (s > 0 ? 1 : 2), { width: 5, off: 0.12, shine: 0.8, hatch: 0.4 });
      const lens = M.all(T, L.ellipsePts(c[0], c[1], r * 0.68, r * 0.64, 22));
      K.fill(ctx, lens, o.lens || '#7FA3B3');
      K.fill(ctx, M.all(T, L.ellipsePts(c[0] - r * 0.2, c[1] - r * 0.24, r * 0.24, r * 0.15, 10, -0.5)), '#FFFFFF', 0.85);
      K.fill(ctx, M.all(T, L.ellipsePts(c[0] + r * 0.26, c[1] + r * 0.24, r * 0.08, r * 0.06, 8)), '#FFFFFF', 0.7);
      L.inkPath(ctx, lens, { closed: true, width: 3.4, seed: seed + 3 + s, boil: B, wobble: 0.3 });
    }
    // the bridge between the lenses
    K.line(ctx, M.all(T, [R.hl(-r * 0.4, o.y - 2, 0.95), R.hl(r * 0.4, o.y - 2, 0.95)]), { width: 7, color: o.brass || '#C39A55', seed: seed + 9, boil: B, taper: 0 });
  }
  K.front.goggles = goggles;

  // ---- shared effects, placed from the face
  function effects(ctx, R, B) {
    const S = R.S, sd = sdOf(S), fx = R.pose.fx;
    if (!fx) return;
    const top = R.hp(0, -S.head.ry * 1.05, 0);
    if (fx.kind === 'burst' && fx.k >= 1 && fx.k <= 5) K.fx.burst(ctx, [top[0], top[1] + S.head.ry * 0.9], (fx.k - 1) / 5, B, sd('burst'));
    if (fx.kind === 'zzz') K.fx.zzz(ctx, [top[0] + S.head.rx * 0.5, top[1] + 40], fx.u, B, sd('zzz'));
    if (fx.kind === 'slash' && fx.p > 0.3 && fx.p < 1.8) {
      const O = M.ap(R.Mb, [30, (S.head.c[1] + S.body.half[S.body.half.length - 1][1]) / 2]);
      K.fx.slash(ctx, O, clamp(fx.p), fx.p <= 1 ? 1 : 1 - (fx.p - 1) / 0.8, B, sd('slash'));
    }
    if (fx.kind === 'bite') {
      const m = R.hp(0, (S.face.mouth ? S.face.mouth.y : S.beak ? S.beak.y : 60) + 40, 1);
      K.fx.chomp(ctx, m, fx.p, B, sd('chomp'));
    }
    if (fx.kind === 'peck' && fx.p > 0.4 && fx.p < 1.8) {
      const tip = R.hp(0, (S.beak ? S.beak.y + S.beak.h : 80) + 20, 1);
      const a = fx.p <= 1 ? 1 : 1 - (fx.p - 1) / 0.8;
      // the burst fans out below and to the sides of the beak, never across the eyes
      for (let k = 0; k < 6; k++) {
        const ang = -0.25 + (k / 5) * (Math.PI + 0.5);
        const r0 = 44, r1 = 44 + 60 * Math.min(1, fx.p);
        K.line(ctx, [[tip[0] + Math.cos(ang) * r0, tip[1] + Math.sin(ang) * r0], [tip[0] + Math.cos(ang) * r1, tip[1] + Math.sin(ang) * r1]], { width: 7, alpha: a, seed: sd('peck', k), boil: B, smooth: false, taper: [3, 8] });
      }
      K.fx.star(ctx, tip[0], tip[1], 34 * a, B, sd('peckStar'), P.white, a);
    }
  }

  // ---------------------------------------------------------------- in-betweens
  // happy, work and attack are written as KEY poses (8, 8 and 6 of them); the loop has more
  // drawings than keys (K.ANIMS), and the drawings between two keys are tweened: numbers glide
  // (position, limbs, turn, the progress of an effect), everything else holds the earlier key
  // until the middle. Stage numbers that must not glide (which cup is up, the block's stage) are
  // listed in DISCRETE.
  const KEYS = { happy: 8, work: 8, attack: 6 };
  const DISCRETE = new Set(['kind', 'item', 'hide', 'hold', 'eyeMode', 'eyeL', 'eyeR', 'block', 'up', 'lock', 'watch', 'whoosh', 'boulder', 'gog']);
  function tween(a, b, u, key) {
    const pick = u <= 0.5 ? a : b;
    if (a === undefined || b === undefined || a === null || b === null || DISCRETE.has(key)) return pick;
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length ? a.map((v, i) => tween(v, b[i], u, key)) : pick;
    if (typeof a === 'object' && typeof b === 'object') {
      const out = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const v = tween(a[k], b[k], u, k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return pick;
  }
  K.front.tween = tween;

  // ---------------------------------------------------------------- draw
  function make(S) {
    S.hooks = S.hooks || {};
    const base = poses(S);
    const table = Object.assign({}, base, S.poses || {});
    function poseAt(anim, d, A) {
      const keys = KEYS[anim];
      if (!keys || keys === A.n) return table[anim](d, A.n, base, S);
      const k = (d * keys) / A.n, k0 = Math.floor(k + 1e-9), u = k - k0;
      const a = table[anim](k0 % keys, keys, base, S);
      // these play once in the game: the last key is held, not tweened back into the first
      if (u < 1e-6 || k0 >= keys - 1) return a;
      return tween(a, table[anim](k0 + 1, keys, base, S), u);
    }
    function draw(ctx, anim, d, A) {
      const pose = K.pose(REST, poseAt(anim, d, A));
      const B = d % A.boil;
      const R = rig(S, pose);
      // the drawing's place in its loop, for effects that run on their own clock (embers)
      R.d = d;
      R.n = A.n;
      R.anim = anim;
      const sd = sdOf(S);
      K.shadow(ctx, CX + pose.x + (S.shadowDx || 0), -pose.y, (S.shadowW || 230) * pose.scale, B, sd('shadow'));
      if (S.hooks.behind) S.hooks.behind(ctx, R, B);
      if (pose.hide) {
        if (S.hooks.fx) S.hooks.fx(ctx, R, B);
        return;
      }
      tail(ctx, R, B);
      fan(ctx, R, B);
      wings(ctx, R, B, true);
      spiderLegs(ctx, R, B);
      legs(ctx, R, B);
      birdFeet(ctx, R, B);
      body(ctx, R, B);
      sit(ctx, R, B);
      arms(ctx, R, B);
      wings(ctx, R, B, false);
      if (S.hooks.front) S.hooks.front(ctx, R, B);
      ears(ctx, R, B);
      head(ctx, R, B);
      arms(ctx, R, B, true);
      hands(ctx, R, B);
      if (S.hooks.top) S.hooks.top(ctx, R, B);
      effects(ctx, R, B);
      if (S.hooks.fx) S.hooks.fx(ctx, R, B);
    }
    K.define(S.id, { draw, stripe: S.stripe, colors: S.colors, kit: 'front' });
  }

  K.kits.front = { make, rig, REST, poses };
})();
