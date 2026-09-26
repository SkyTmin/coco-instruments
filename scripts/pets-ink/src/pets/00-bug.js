// pets/00-bug.js : the bug (cockroach, spider).
//
// A bug is a few hard parts (head, thorax, abdomen: each its own inked form, stacked in the order
// the spec lists them) on many thin legs. Every leg is two segments solved to a foot on the ground,
// with the knee always up (the solver takes whichever bend lifts it). The near legs are drawn over
// the body, the far legs behind it and darker. A cockroach walks on alternating tripods, a spider
// in two alternating sets of four: each leg only needs a phase.
//
// Layers, back to front:
//   shadow > hooks.behind > far legs > far antenna > parts marked back (hooks.body after each) >
//   near legs > parts marked front > eyes and mouth (hooks.face) > near antenna > hooks.head >
//   effects (hooks.fx)
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

  const REST = {
    x: 0, y: 0, lean: 0, sq: 1, legh: 0,
    head: 0, hx: 0, hy: 0, abd: 0,
    eye: 1, eyeMode: 'open', mouth: 0,
    ant: 0, antF: null, fold: 0,
    legs: null,
    hide: false,
    fx: null,
  };

  // ---------------------------------------------------------------- legs
  // pose.legs = { n: [{ x, lift }], f: [...] } in ground space, one per spec leg
  function stand(S, k = 0) {
    const G = S.legs;
    const row = (far) => G.map((g) => ({ x: g.foot + (far ? S.farFoot || -16 : 0) + k * (g.foot - g.hip[0]) * 0.1, lift: 0 }));
    return { n: row(false), f: row(true) };
  }

  function gait(S, u) {
    const G = S.legs, st = S.stride || 40, lift = S.lift || 30;
    const row = (far) =>
      G.map((g, i) => {
        const p = (((u + g.phase + (far ? 0.5 : 0)) % 1) + 1) % 1;
        const swing = p < 0.5;
        const q = swing ? p / 0.5 : (p - 0.5) / 0.5;
        const x = swing ? lerp(-st / 2, st / 2, L.ease.inOutSine ? L.ease.inOutSine(q) : q) : lerp(st / 2, -st / 2, q);
        return { x: g.foot + (far ? S.farFoot || -16 : 0) + x, lift: swing ? Math.sin(Math.PI * q) * lift : 0 };
      });
    return { n: row(false), f: row(true) };
  }

  function poses(S) {
    return {
      idle(d, n) {
        const u = d / n;
        return {
          sq: 1 + 0.018 * K.wave(u),
          abd: 0.03 * K.wave(u + 0.2),
          head: 0.03 * K.wave(u + 0.5),
          ant: K.wave(u * 2) * 0.12 + (d === 5 || d === 6 ? 0.3 : 0),
          eye: d === 8 ? 0 : 1,
          legs: stand(S),
        };
      },
      walk(d, n) {
        const u = d / n;
        return {
          y: -6 * Math.abs(Math.sin(TAU * u)),
          lean: 0.02 * Math.sin(TAU * u),
          abd: 0.04 * Math.sin(TAU * u + 1),
          ant: 0.2 * Math.sin(TAU * u),
          legs: gait(S, u),
        };
      },
      happy(d) {
        const T = [
          { y: 0, sq: 0.88, wave: 0 },
          { y: -60, sq: 1.08, wave: 1 },
          { y: -130, sq: 1.04, wave: 1 },
          { y: -150, sq: 1.0, wave: 1 },
          { y: -120, sq: 1.02, wave: 1 },
          { y: -50, sq: 1.04, wave: 0.5 },
          { y: 0, sq: 0.86, wave: 0 },
          { y: 0, sq: 0.97, wave: 0 },
        ][d];
        const air = clamp(-T.y / 100);
        const legs = stand(S);
        for (const side of ['n', 'f']) legs[side].forEach((l, i) => ((l.lift = 30 * air + (i % 2 ? 20 : 0) * T.wave), (l.x += (i % 2 ? 14 : -14) * T.wave)));
        return { y: T.y, sq: T.sq, head: -0.08, ant: -0.4, eyeMode: 'happy', mouth: 0.3, legs, fx: { kind: 'burst', k: d } };
      },
      attack(d) {
        const T = [
          { x: 0, lean: 0, head: 0, mouth: 0, p: 0 },
          { x: -30, lean: -0.08, head: -0.12, mouth: 0.8, p: 0 },
          { x: 60, lean: 0.1, head: 0.12, mouth: 1, p: 0.5 },
          { x: 70, lean: 0.12, head: 0.14, mouth: 0, p: 1 },
          { x: 30, lean: 0.04, head: 0.04, mouth: 0.2, p: 1.4 },
          { x: 6, lean: 0, head: 0, mouth: 0, p: 2 },
        ][d];
        return { x: T.x, lean: T.lean, head: T.head, mouth: T.mouth, ant: -0.5 * (d > 0 && d < 5), eyeMode: d >= 1 && d <= 4 ? 'angry' : 'open', legs: stand(S, d === 1 ? 0.5 : 0), fx: { kind: 'bite', p: T.p } };
      },
      sleep(d, n) {
        const u = d / n;
        return {
          sq: 0.94 + 0.02 * K.wave(u),
          legh: S.sleepLow == null ? 60 : S.sleepLow,
          fold: 1,
          head: 0.12,
          abd: 0.02 * K.wave(u),
          ant: S.sleepAnt == null ? 0.45 : S.sleepAnt,
          eyeMode: 'closed',
          legs: stand(S, -0.4),
          fx: { kind: 'zzz', u },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the rig
  function rig(S, pose) {
    const sx = 1 + (1 - pose.sq) * 0.7;
    const Mr = M.chain(M.tr(K.CX + pose.x, K.GROUND + pose.y), M.rot(pose.lean), M.sc(sx, pose.sq));
    const Mb = M.mul(Mr, M.tr(0, pose.legh + (S.sit || 0)));
    const hs = S.headScale || 1;
    const Mh = M.chain(Mb, M.tr(pose.hx, pose.hy), M.about(pose.head, S.neck[0], S.neck[1]), M.scAbout(hs, hs, S.neck[0], S.neck[1]));
    const Ma = M.mul(Mb, M.about(pose.abd, S.waist[0], S.waist[1]));
    const c = M.ap(Mb, S.bodyC);
    return { S, pose, Mr, Mb, Mh, Ma, center: { x: c[0], y: c[1], r: S.bodyR || 200 } };
  }
  const Tof = (R, t) => (t === 'h' ? R.Mh : t === 'a' ? R.Ma : R.Mb);

  // ---------------------------------------------------------------- parts
  function part(ctx, R, B, p) {
    const S = R.S, sd = sdOf(S);
    const T = Tof(R, p.T);
    const pts = M.all(T, p.smooth === false ? p.pts : K.smooth(p.pts, 5));
    K.form(ctx, pts, {
      fill: p.fill,
      deep: p.deep,
      c: R.center,
      width: p.width || 9,
      seed: sd('part', p.id),
      boil: B,
      spacing: 9,
      hatchW: 2.8,
      hatchAlpha: 0.55,
      inside(c2) {
        K.clip(c2, pts, () => {
          // the shine of a hard shell: one bright streak along the upper-left
          if (p.lit) L.inkPath(c2, M.all(T, K.curve(p.lit, 5)), { width: p.litW || 14, color: p.litColor || S.colors.shine || '#FFF1D8', alpha: 0.7, seed: sd('lit', p.id), boil: B, taper: [10, 14], wobble: 0.5 });
          if (p.hair) L.stipple(c2, pts, { spacing: 12, r: [1.4, 2.4], color: p.deep, alpha: 0.6, seed: sd('hairS', p.id), boil: B });
          if (S.hooks.part) S.hooks.part(c2, R, B, p.id, T, pts);
        });
      },
    });
    // hair: short strokes out of the outline
    if (p.hair) {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc < 22) continue;
        acc = 0;
        const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl;
        const len = p.hair * (10 + 8 * L.h3(i, 3, sd('hair', p.id)));
        K.line(ctx, [[b[0] - nx * 3, b[1] - ny * 3], [b[0] + nx * len - (tx / tl) * 5, b[1] + ny * len - (ty / tl) * 5]], { width: 3.4, color: P.ink, seed: sd('hairL', p.id, i), boil: B, smooth: false, taper: [2, 4] });
      }
    }
  }

  function leg(ctx, R, B, side, i) {
    const S = R.S, C = S.colors, sd = sdOf(S), g = S.legs[i];
    const far = side === 'f';
    const pose = R.pose;
    const ft = pose.legs[side][i];
    const hip = M.ap(R.Mb, far ? [g.hip[0] + (S.farHip || [-8, -8])[0], g.hip[1] + (S.farHip || [-8, -8])[1]] : g.hip);
    const fold = pose.fold || 0;
    const tgt = M.ap(R.Mr, [lerp(ft.x, lerp(ft.x, g.hip[0], 0.45), fold), -ft.lift - 4]);
    // the knee goes up: take the bend that lifts it
    const a = K.ik(hip, tgt, g.l1, g.l2, 1), b = K.ik(hip, tgt, g.l1, g.l2, -1);
    const { knee, foot } = a.knee[1] < b.knee[1] ? a : b;
    const col = K.far(C.leg, far);
    const r1 = g.r1 || S.legR || 12, r2 = g.r2 || (S.legR || 12) * 0.7;
    const femur = K.limbPts(hip, knee, r1, r1 * 0.85, 8);
    const tibia = K.limbPts(knee, foot, r1 * 0.8, r2 * 0.6, 8);
    const opt = (k) => ({ fill: col, deep: C.legDeep, width: far ? 4.5 : 5.5, seed: sd('leg', side, i, k), boil: B, shade: 0.5, spacing: 5, hatchW: 1.6 });
    K.form(ctx, femur, opt(0));
    K.form(ctx, tibia, opt(1));
    if (S.hooks.leg) S.hooks.leg(ctx, R, B, side, i, hip, knee, foot, far);
    // the knee joint and a little claw at the foot
    K.fill(ctx, L.ellipsePts(knee[0], knee[1], r1 * 0.72, r1 * 0.72, 12), K.far(C.joint || C.leg, far));
    L.inkPath(ctx, L.ellipsePts(knee[0], knee[1], r1 * 0.72, r1 * 0.72, 12), { closed: true, width: far ? 3.4 : 4, seed: sd('knee', side, i), boil: B, wobble: 0.3 });
    const dx = foot[0] - knee[0], dy = foot[1] - knee[1], dl = Math.hypot(dx, dy) || 1;
    const dir = foot[0] >= hip[0] ? 1 : -1;
    K.line(ctx, [foot, [foot[0] + (dx / dl) * 8 + dir * 12, foot[1] + 4]], { width: 4.5, color: P.ink, seed: sd('claw', side, i), boil: B, taper: [3, 2], smooth: false });
  }

  function antenna(ctx, R, B, far) {
    const S = R.S, C = S.colors, sd = sdOf(S), A = S.antenna;
    if (!A) return;
    const a = far ? (R.pose.antF == null ? R.pose.ant * 0.8 + (A.farRot == null ? 0.1 : A.farRot) : R.pose.antF) : R.pose.ant;
    const base = far ? [A.base[0] - 16, A.base[1] - 4] : A.base;
    const pts = A.pts.map(([x, y], i) => {
      // each point swings round the base, more toward the tip
      const k = (i / (A.pts.length - 1)) * a;
      const dx = x - A.base[0], dy = y - A.base[1];
      return [base[0] + dx * Math.cos(k) - dy * Math.sin(k), base[1] + dx * Math.sin(k) + dy * Math.cos(k)];
    });
    const kinked = !far && A.kink ? pts.map((p, i) => (i >= A.kink ? [p[0] + (i - A.kink + 1) * 10, p[1] + (i - A.kink + 1) * 16] : p)) : pts;
    const c = M.all(R.Mh, A.kink && !far ? kinked : K.curve(pts, 5));
    L.inkPath(ctx, c, { width: (A.w || 7) + 5, color: P.ink, seed: sd('ant', far ? 1 : 0), boil: B, taper: [2, 10], smooth: !A.kink || far });
    L.inkPath(ctx, c, { width: A.w || 7, color: K.far(C.antenna || C.leg, far), seed: sd('ant', far ? 1 : 0), boil: B, taper: [2, 10], smooth: !A.kink || far });
  }

  function face(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), pose = R.pose;
    if (S.hooks.face) S.hooks.face(ctx, R, B);
    for (const [k, E] of S.eyes.entries()) {
      K.eye(ctx, R.Mh, E.x, E.y, { r: E.r, style: E.style || 'bead', iris: E.iris, lid: pose.eyeMode === 'happy' ? 0 : E.lid, lidColor: E.lidColor || C.head, mode: pose.eyeMode, open: pose.eye, color: C.eye, lineColor: C.eyeLine, look: (pose.fx && pose.fx.look) || E.look }, B, sd('eye', k));
    }
    // mandibles: two hooked pincers that open with pose.mouth
    const J = S.jaws;
    // a closed mouth can be a smile instead of pincers
    if (S.smile && (!J || pose.mouth < (J.minOpen || 0)) && pose.eyeMode !== 'angry') {
      K.line(ctx, M.all(R.Mh, K.curve(S.smile, 4)), { width: 4.5, seed: sd('smile'), boil: B, taper: [3, 3] });
    }
    if (J && pose.mouth >= (J.minOpen || 0)) {
      for (const s of [-1, 1]) {
        const o = clamp(pose.mouth) * 0.5;
        const T = M.mul(R.Mh, M.about(s * o, J.at[0], J.at[1]));
        const pts = M.all(T, K.smooth(J.pts.map(([x, y]) => [x, J.at[1] + (y - J.at[1]) * s]), 4));
        K.form(ctx, pts, { fill: s > 0 ? C.jaw || C.legDeep : K.far(C.jaw || C.legDeep, true), deep: P.ink, width: 4.5, seed: sd('jaw', s), boil: B, shade: 0.5, spacing: 4 });
      }
    }
  }

  function effects(ctx, R, B) {
    const S = R.S, sd = sdOf(S), fx = R.pose.fx;
    if (fx && fx.kind === 'bite') {
      const m = M.ap(R.Mh, S.mouthAt);
      K.fx.chomp(ctx, [m[0] + 50, m[1] + 10], fx.p, B, sd('chomp'));
    } else if (fx && fx.kind === 'zzz') {
      K.fx.zzz(ctx, M.ap(R.Mh, S.mouthAt), fx.u, B, sd('zzz'));
    } else if (fx && fx.kind === 'burst') {
      const k = fx.k;
      if (k >= 1 && k <= 5) K.fx.burst(ctx, M.ap(R.Mh, [S.mouthAt[0] - 60, S.mouthAt[1] - 60]), (k - 1) / 5, B, sd('burst'));
    }
  }

  // ---------------------------------------------------------------- draw
  function make(S) {
    S.hooks = S.hooks || {};
    const base = poses(S);
    const table = Object.assign({}, base, S.poses || {});
    function draw(ctx, anim, d, A) {
      const pose = K.pose(REST, table[anim](d, A.n, base, S));
      if (!pose.legs) pose.legs = stand(S);
      const B = d % A.boil;
      const R = rig(S, pose);
      const sd = sdOf(S);
      K.shadow(ctx, K.CX + pose.x + (S.shadowDx || 0), -pose.y, S.shadowW || 230, B, sd('shadow'));
      if (S.hooks.behind) S.hooks.behind(ctx, R, B);
      if (pose.hide) {
        if (S.hooks.fx) S.hooks.fx(ctx, R, B);
        return;
      }
      for (let i = S.legs.length - 1; i >= 0; i--) leg(ctx, R, B, 'f', i);
      // near legs marked under go behind the body (a spider's back legs behind its abdomen)
      for (let i = S.legs.length - 1; i >= 0; i--) if (S.legs[i].under) leg(ctx, R, B, 'n', i);
      antenna(ctx, R, B, true);
      for (const p of S.parts) if (p.z !== 'front') part(ctx, R, B, p);
      if (S.hooks.body) S.hooks.body(ctx, R, B);
      for (let i = S.legs.length - 1; i >= 0; i--) if (!S.legs[i].under) leg(ctx, R, B, 'n', i);
      for (const p of S.parts) if (p.z === 'front') part(ctx, R, B, p);
      face(ctx, R, B);
      antenna(ctx, R, B, false);
      if (S.hooks.head) S.hooks.head(ctx, R, B);
      effects(ctx, R, B);
      if (S.hooks.fx) S.hooks.fx(ctx, R, B);
    }
    K.define(S.id, { draw, stripe: S.stripe, colors: S.colors, kit: 'bug' });
  }

  K.kits.bug = { make, rig, REST, stand, gait };
})();
