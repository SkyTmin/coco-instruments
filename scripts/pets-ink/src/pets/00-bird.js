// pets/00-bird.js : the bird (pigeon, crow, owl, raven, phoenix).
//
// The body and head are one outline, skinned between the body and the head (a bird's neck is
// hidden in its feathers); the beak is two mandibles that open. The near wing lies folded along
// the side and spreads up and out (the folded and spread wings are tables of the same points, so
// every drawing in between is a real wing); the far wing shows only when spread. A fan of tail
// feathers, thin legs from under the belly with three toes forward and one back.
//
// Gaits: 'strut' (a pigeon: steps with the head bobbing), 'hop' (a crow: both feet together),
// 'waddle' (an owl: short steps, rocking side to side).
//
// Layers, back to front:
//   shadow > hooks.behind > tail > far wing > far leg > body (hooks.body clipped, feathers, shade,
//   outline) > hooks.bodyAfter > near leg > near wing > hooks.front > beak > face (hooks.face) >
//   hooks.head > effects (hooks.fx)
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp;
  const TAU = Math.PI * 2;
  const Pt = () => K.parts;
  const sdOf = (S) => (...k) => L.hash(S.id, ...k) & 0x7fffffff;

  const REST = {
    x: 0, y: 0, lean: 0, sq: 1, legh: 0,
    head: 0, hx: 0, hy: 0, hat: 0,
    eye: 1, eyeMode: 'open', mouth: 0, beak: 0,
    wing: 0, wingF: null, tail: 0, fluff: 0,
    feet: null,
    hide: false,
    fx: null,
  };

  // ---------------------------------------------------------------- shared animations
  function poses(S) {
    const F = S.feet; // rest { n, f } foot x
    const stand = () => ({ n: { x: F.n, lift: 0 }, f: { x: F.f, lift: 0 } });
    const gait = S.gait || 'strut';
    return {
      idle(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 1 + 0.02 * b,
          head: 0.06 * K.wave(u + 0.25) + (d === 4 || d === 5 ? -0.12 : 0),
          hx: d === 9 ? 10 : 0,
          eye: d === 7 ? 0 : 1,
          tail: 0.08 * K.wave(u * 2),
          wing: 0,
          feet: stand(),
        };
      },
      walk(d, n) {
        const ph = (TAU * d) / n;
        const c = Math.cos(ph), s = Math.sin(ph);
        if (gait === 'hop') {
          const h = [0, 40, 70, 40, 0, 0, 0, 0][d % 8];
          const sqz = [0.88, 1.06, 1.04, 1, 0.9, 0.96, 1, 1][d % 8];
          const tuck = h > 0 ? 18 : 0;
          return {
            y: -h,
            sq: sqz,
            lean: h > 0 ? 0.08 : 0,
            head: h > 30 ? -0.08 : 0.04,
            wing: h > 30 ? 0.18 : 0,
            tail: h > 0 ? -0.15 : 0.1,
            feet: { n: { x: F.n + (h ? 10 : 0), lift: tuck }, f: { x: F.f + (h ? 10 : 0), lift: tuck } },
          };
        }
        const st = S.stride || 44;
        const liftN = s < 0 ? -s * 34 : 0, liftF = s > 0 ? s * 34 : 0;
        const waddle = gait === 'waddle';
        return {
          y: -8 * s * s,
          sq: 1.02 - 0.04 * c * c,
          lean: waddle ? 0.06 * Math.sin(ph) : 0.04,
          // the pigeon's head bob: forward on each step, then held while the body catches up
          hx: waddle ? 0 : 22 * Math.max(0, Math.cos(2 * ph)),
          head: waddle ? 0.04 * Math.sin(ph) : 0.04 * Math.cos(2 * ph),
          tail: 0.12 * s,
          feet: { n: { x: F.n + st * c, lift: liftN }, f: { x: F.f - st * c, lift: liftF } },
        };
      },
      happy(d) {
        const T = [
          { sq: 0.86, y: 0, wing: 0.2, beak: 0.3 },
          { sq: 1.08, y: -46, wing: 1, beak: 0.6 },
          { sq: 1.04, y: -130, wing: 0.45, beak: 0.6 },
          { sq: 1.0, y: -160, wing: 1, beak: 0.6 },
          { sq: 1.02, y: -134, wing: 0.45, beak: 0.6 },
          { sq: 1.04, y: -60, wing: 1, beak: 0.5 },
          { sq: 0.84, y: 0, wing: 0.3, beak: 0.3 },
          { sq: 0.96, y: 0, wing: 0.05, beak: 0.2 },
        ][d];
        const air = clamp(-T.y / 120);
        return {
          sq: T.sq,
          y: T.y,
          wing: T.wing,
          wingF: T.wing,
          beak: T.beak,
          eyeMode: 'happy',
          head: -0.1,
          tail: -0.2 * air,
          feet: { n: { x: F.n + 6, lift: 20 * air }, f: { x: F.f + 6, lift: 20 * air } },
          fx: { kind: 'burst', k: d },
        };
      },
      attack(d) {
        const T = [
          { x: 0, lean: 0, head: 0, beak: 0, wing: 0, p: 0 },
          { x: -30, lean: -0.14, head: -0.3, beak: 0.5, wing: 0.55, p: 0 },
          { x: 50, lean: 0.3, head: 0.3, beak: 0.1, wing: 0.3, p: 0.6 },
          { x: 60, lean: 0.34, head: 0.34, beak: 0, wing: 0.25, p: 1 },
          { x: 30, lean: 0.12, head: 0.1, beak: 0.3, wing: 0.1, p: 1.5 },
          { x: 6, lean: 0.02, head: 0, beak: 0, wing: 0, p: 2 },
        ][d];
        return {
          x: T.x,
          lean: T.lean,
          head: T.head,
          beak: T.beak,
          wing: T.wing,
          wingF: T.wing,
          eyeMode: d >= 1 && d <= 4 ? 'angry' : 'open',
          feet: stand(),
          fx: { kind: 'peck', p: T.p },
        };
      },
      sleep(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 0.84 + 0.02 * b,
          legh: S.sleepLow == null ? 50 : S.sleepLow,
          fluff: 1,
          head: 0.35,
          hx: -40,
          hy: 46,
          eyeMode: 'closed',
          tail: 0.1,
          feet: { n: { x: F.n, lift: 0 }, f: { x: F.f, lift: 0 } },
          fx: { kind: 'zzz', u },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the rig
  function rig(S, pose) {
    const fl = 1 + 0.08 * pose.fluff;
    const sx = (1 + (1 - pose.sq) * 0.7) * fl;
    const Mr = M.chain(M.tr(K.CX + pose.x, K.GROUND + pose.y), M.rot(pose.lean), M.sc(sx, pose.sq * fl));
    const Mb = M.mul(Mr, M.tr(0, pose.legh + (S.sit || 0)));
    const hs = S.headScale || 1;
    const Mh = M.chain(Mb, M.tr(pose.hx, pose.hy), M.about(pose.head, S.neck[0], S.neck[1]), M.scAbout(hs, hs, S.neck[0], S.neck[1]));
    const skin = (p) => {
      const a = M.ap(Mb, p), b = M.ap(Mh, p);
      return [lerp(a[0], b[0], p[2]), lerp(a[1], b[1], p[2])];
    };
    const ctrl = S.sil.map(skin);
    const body = K.smooth(ctrl, 5);
    const c = M.ap(Mb, S.bodyC);
    return { S, pose, Mr, Mb, Mh, skin, ctrl, body, center: { x: c[0], y: c[1], r: S.bodyR || 200 } };
  }

  // ---------------------------------------------------------------- parts
  function wing(ctx, R, B, far) {
    const S = R.S, C = S.colors, sd = sdOf(S), W = S.wing;
    const t = far ? (R.pose.wingF == null ? 0 : R.pose.wingF) : R.pose.wing;
    if (far && t < 0.15) return;
    const T = far ? M.mul(R.Mb, M.tr(W.farDx || 30, W.farDy || -14)) : R.Mb;
    const pts = W.fold.map((p, i) => [lerp(p[0], W.spread[i][0], t), lerp(p[1], W.spread[i][1], t)]);
    const wp = M.all(T, K.smooth(pts, 5));
    const col = K.far(C.wing || C.fur, far);
    const wr0 = W.wrist.map((v, i) => lerp(v, W.wristSpread[i], t));
    const pcol = K.far(C.primary || C.wing || C.fur, far);
    const feather = (base, end, wf, fill, seed) => {
      const dx = end[0] - base[0], dy = end[1] - base[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const m1 = [lerp(base[0], end[0], 0.45), lerp(base[1], end[1], 0.45)];
      const m2 = [lerp(base[0], end[0], 0.85), lerp(base[1], end[1], 0.85)];
      const f = M.all(T, K.smooth([base, [m1[0] + nx * wf, m1[1] + ny * wf], [m2[0] + nx * wf * 0.8, m2[1] + ny * wf * 0.8], end, [m2[0] - nx * wf * 0.7, m2[1] - ny * wf * 0.7], [m1[0] - nx * wf * 0.8, m1[1] - ny * wf * 0.8]], 4));
      K.form(ctx, f, { fill, deep: C.wingDeep || C.furDeep, width: far ? 4.5 : 5, seed, boil: B, shade: 0.7, spacing: 6, hatchW: 2 });
      K.line(ctx, M.all(T, [[lerp(base[0], end[0], 0.3), lerp(base[1], end[1], 0.3)], [lerp(base[0], end[0], 0.9), lerp(base[1], end[1], 0.9)]]), { width: 2.2, color: C.wingLine || C.wingDeep || P.inkSoft, alpha: 0.8, seed: seed + 1, boil: B, taper: [2, 6] });
    };
    // the secondaries: rounded feather tips along the trailing edge, behind the wing, so the edge
    // reads as a row of feathers and not as a blade
    if (W.trail) {
      const cen = K.centreOf(pts);
      for (let j = W.trail.length - 1; j >= 0; j--) {
        const k = W.trail[j];
        const p = pts[k];
        // outward from the wing, swept back toward the tail: the tips overlap like shingles
        let dx = p[0] - cen.x, dy = p[1] - cen.y;
        let len = Math.hypot(dx, dy) || 1;
        dx = dx / len - 1.1 * (1 - 0.5 * t);
        dy = dy / len + 0.2;
        len = Math.hypot(dx, dy) || 1;
        // longer than wide past the edge, or the tips read as round lumps
        const out = (W.secLen || 26) * (1 + 0.7 * t);
        feather([p[0] - (dx / len) * out * 1.4, p[1] - (dy / len) * out * 1.4], [p[0] + (dx / len) * out, p[1] + (dy / len) * out], (W.secW || 13) + 2 * t, K.far(C.secondary || C.wing || C.fur, far), sd('sec', k, far ? 1 : 0));
      }
    }
    // the primaries: long separate feathers past each tip, fanning apart as the wing opens
    for (let j = W.tips.length - 1; j >= 0; j--) {
      const k = W.tips[j];
      const tip = pts[k];
      const dx = tip[0] - wr0[0], dy = tip[1] - wr0[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const ext = (W.feather || 46) * (1 - 0.1 * j);
      feather([tip[0] - ux * ext, tip[1] - uy * ext], [tip[0] + ux * ext * 0.7, tip[1] + uy * ext * 0.7], 14 + 4 * t, pcol, sd('feather', k, far ? 1 : 0));
    }
    K.form(ctx, wp, {
      fill: col,
      deep: C.wingDeep || C.furDeep,
      width: far ? 5.5 : 6.5,
      seed: sd('wing', far ? 1 : 0),
      boil: B,
      spacing: 9,
      hatchAlpha: 0.55,
      inside(c2) {
        // the coverts: a paler band across the top of the wing
        if (C.covert) {
          const cov = W.covert.map((p, i) => [lerp(p[0], W.covertSpread[i][0], t), lerp(p[1], W.covertSpread[i][1], t)]);
          K.clip(c2, wp, () => K.fill(c2, M.all(T, K.smooth(cov, 5)), K.far(C.covert, far)));
        }
        if (S.hooks.wingInside) S.hooks.wingInside(c2, R, B, T, t, far);
      },
      after(c2) {
        // a row of covert scallops across the middle of the wing
        if (W.scallops) {
          const sc = W.scallops.map((p, i) => [lerp(p[0], (W.scallopsSpread || W.scallops)[i][0], t), lerp(p[1], (W.scallopsSpread || W.scallops)[i][1], t)]);
          for (let i = 0; i + 1 < sc.length; i++) {
            const a = sc[i], b = sc[i + 1];
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            // bulging toward the tail: the feather tips point back
            const bulge = W.scallopBulge || 0.38;
            K.line(c2, M.all(T, K.curve([a, [mx - dy * bulge, my + dx * bulge], b], 5)), { width: 3, color: C.wingLine || C.wingDeep || P.inkSoft, alpha: 0.85, seed: sd('scal', i, far ? 1 : 0), boil: B, taper: [3, 3] });
          }
        }
      },
    });
  }

  function tailFan(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), Tl = S.tailFan;
    const base = Tl.base;
    const T = M.mul(R.Mb, M.about(R.pose.tail, base[0], base[1]));
    for (let i = Tl.n - 1; i >= 0; i--) {
      const u = Tl.n === 1 ? 0.5 : i / (Tl.n - 1);
      const a = Tl.angle + (u - 0.5) * Tl.spread;
      const len = Tl.len * (1 - Tl.taper * Math.abs(u - 0.5) * 2);
      const tip = [base[0] + Math.cos(a) * len, base[1] + Math.sin(a) * len];
      const mid = [base[0] + Math.cos(a) * len * 0.5, base[1] + Math.sin(a) * len * 0.5];
      const nx = -Math.sin(a), ny = Math.cos(a);
      const w = Tl.width;
      const f = M.all(T, K.smooth([base, [mid[0] + nx * w, mid[1] + ny * w], [tip[0] + nx * w * 0.7, tip[1] + ny * w * 0.7], [tip[0] + Math.cos(a) * w * 0.6, tip[1] + Math.sin(a) * w * 0.6], [tip[0] - nx * w * 0.7, tip[1] - ny * w * 0.7], [mid[0] - nx * w, mid[1] - ny * w]], 5));
      const fill = Tl.fill ? Tl.fill(i) : C.tail || C.fur;
      K.form(ctx, f, { fill, deep: C.furDeep, width: 5, seed: sd('tailF', i), boil: B, shade: 0.6, spacing: 8, hatchW: 2.4 });
      K.line(ctx, M.all(T, [[lerp(base[0], tip[0], 0.2), lerp(base[1], tip[1], 0.2)], [lerp(base[0], tip[0], 0.9), lerp(base[1], tip[1], 0.9)]]), { width: 2.4, color: P.inkSoft, alpha: 0.8, seed: sd('shaft', i), boil: B, taper: [2, 6] });
      if (Tl.band) {
        const bp = M.all(T, [[lerp(base[0], tip[0], 0.8) + nx * w * 0.8, lerp(base[1], tip[1], 0.8) + ny * w * 0.8], [lerp(base[0], tip[0], 0.8) - nx * w * 0.8, lerp(base[1], tip[1], 0.8) - ny * w * 0.8]]);
        K.line(ctx, bp, { width: 9, color: Tl.band, seed: sd('band', i), boil: B, taper: 0, smooth: false });
      }
    }
  }

  function leg(ctx, R, side, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), G = S.leg;
    const far = side === 'f';
    const foot = far ? R.pose.feet.f : R.pose.feet.n;
    const hip = M.ap(R.Mb, far ? G.hipF : G.hipN);
    const t = M.ap(R.Mr, [foot.x, -foot.lift - 8]);
    const { knee, foot: f } = K.ik(hip, t, G.l1, G.l2, 1);
    const col = K.far(C.leg, far);
    // the shank: a thin scaled leg; the thigh is inside the feathers
    const shank = K.limbPts(knee, f, G.r, G.r * 0.85, 6);
    K.form(ctx, shank, { fill: col, deep: C.legDeep, width: far ? 4.5 : 5, seed: sd('shank', side), boil: B, shade: 0.5, spacing: 5, hatchW: 1.6 });
    const thigh = K.limbPts(hip, knee, G.r * (G.thighR || 1.6), G.r * 1.1, 6);
    K.form(ctx, thigh, { fill: K.far(G.thigh || C.fur, far), deep: C.furDeep, width: far ? 4.5 : 5, seed: sd('thigh', side), boil: B, shade: 0.5, spacing: 6 });
    if (S.hooks.legAfter) S.hooks.legAfter(ctx, R, B, side, knee, f, far);
    // toes: three forward, one back, with claws
    const toe = (dx, dy, len) => {
      const end = [f[0] + dx * len, f[1] + dy * len];
      K.line(ctx, [f, end], { width: G.r * 1.5 + 3, color: P.ink, seed: sd('toeI', side, dx), boil: B, taper: [2, 5], smooth: false });
      K.line(ctx, [f, end], { width: G.r * 1.5 - 2, color: col, seed: sd('toeI', side, dx), boil: B, taper: [2, 5], smooth: false });
      // talons: a dark hooked tip on each toe
      if (G.claw) K.line(ctx, [end, [end[0] + dx * 12, end[1] + 4], [end[0] + dx * 14, end[1] + 12]], { width: 5, color: G.claw, seed: sd('claw', side, dx), boil: B, taper: [5, 2] });
    };
    toe(-0.8, 0.3, G.toe * 0.55);
    toe(1, 0.12, G.toe);
    toe(0.85, 0.36, G.toe * 0.85);
  }

  function beak(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), Bk = S.beak;
    const H = R.Mh;
    const o = clamp(R.pose.beak);
    const lower = M.all(M.mul(H, M.about(0.35 * o, Bk.hinge[0], Bk.hinge[1])), K.smooth(Bk.lower, 4));
    K.form(ctx, lower, { fill: C.beakLow || C.beak, deep: C.beakDeep, width: 4.5, seed: sd('beakL'), boil: B, shade: 0.7, spacing: 5, hatchW: 1.8 });
    if (o > 0.2) {
      K.fill(ctx, M.all(H, K.smooth([Bk.hinge, [lerp(Bk.hinge[0], Bk.tip[0], 0.6), Bk.hinge[1] + 10 * o], [lerp(Bk.hinge[0], Bk.tip[0], 0.3), Bk.hinge[1] + 4]], 3)), '#6E2A26');
    }
    const upper = M.all(H, K.smooth(Bk.upper, 4));
    K.form(ctx, upper, {
      fill: C.beak,
      deep: C.beakDeep,
      width: 5,
      seed: sd('beakU'),
      boil: B,
      shade: 0.8,
      spacing: 5,
      hatchW: 1.8,
      after(c2) {
        if (Bk.cere) K.fill(c2, M.all(H, L.ellipsePts(Bk.cere[0], Bk.cere[1], Bk.cere[2], Bk.cere[3], 14)), C.cere || P.white);
        if (Bk.nostril) K.fill(c2, M.all(H, L.ellipsePts(Bk.nostril[0], Bk.nostril[1], 5, 3, 10)), P.ink);
      },
    });
  }

  function face(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), pose = R.pose, F = S.face;
    if (S.hooks.face) S.hooks.face(ctx, R, B);
    const E = F.eye;
    K.eye(ctx, R.Mh, E.x, E.y, { r: E.r, style: E.style, iris: E.iris, look: (pose.fx && pose.fx.look) || E.look, lid: pose.eyeMode === 'happy' ? 0 : E.lid, lidColor: E.lidColor || C.fur, white: E.white, mode: pose.eyeMode, open: pose.eye, color: C.eye, lineColor: C.eyeLine }, B, sd('eye'));
    if (E.ring) L.inkPath(ctx, M.all(R.Mh, L.ellipsePts(E.x, E.y, E.r * 1.35, E.r * 1.45, 24)), { closed: true, width: 4, color: E.ring, seed: sd('eyeRing'), boil: B, wobble: 0.4 });
  }

  function effects(ctx, R, B) {
    const S = R.S, sd = sdOf(S), fx = R.pose.fx;
    if (fx && fx.kind === 'peck' && fx.p > 0.5 && fx.p < 1.8) {
      const tip = M.ap(R.Mh, [S.beak.tip[0] + 30, S.beak.tip[1] + 10]);
      const a = fx.p <= 1 ? 1 : 1 - (fx.p - 1) / 0.8;
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU;
        const r0 = 22, r1 = 22 + 50 * Math.min(1, fx.p);
        K.line(ctx, [[tip[0] + Math.cos(ang) * r0, tip[1] + Math.sin(ang) * r0], [tip[0] + Math.cos(ang) * r1, tip[1] + Math.sin(ang) * r1]], { width: 6, alpha: a, seed: sd('peck', k), boil: B, smooth: false, taper: [3, 8] });
      }
      K.fx.star(ctx, tip[0], tip[1], 26 * a, B, sd('peckStar'), P.white, a);
    } else {
      Pt().effects(ctx, R, B);
    }
  }

  // ---------------------------------------------------------------- draw
  function make(S) {
    S.hooks = S.hooks || {};
    // the shared effects place the sleeping Z's and the burst from the face
    if (!S.face.nose) S.face.nose = { x: S.beak.hinge[0], y: S.beak.hinge[1] };
    const base = poses(S);
    const table = Object.assign({}, base, S.poses || {});
    function draw(ctx, anim, d, A) {
      const pose = K.pose(REST, table[anim](d, A.n, base));
      if (!pose.feet) pose.feet = base.idle(0, 12).feet;
      const B = d % A.boil;
      const R = rig(S, pose);
      const sd = sdOf(S);
      K.shadow(ctx, K.CX + pose.x + (S.shadowDx || 0), -pose.y, S.shadowW || 200, B, sd('shadow'));
      if (S.hooks.behind) S.hooks.behind(ctx, R, B);
      // a drawing where the pet has turned into something else (the phoenix's ember): effects only
      if (pose.hide) {
        effects(ctx, R, B);
        return;
      }
      if (S.tailFan) tailFan(ctx, R, B);
      wing(ctx, R, B, true);
      leg(ctx, R, 'f', B);
      Pt().body(ctx, R, B);
      if (S.hooks.bodyAfter) S.hooks.bodyAfter(ctx, R, B);
      leg(ctx, R, 'n', B);
      wing(ctx, R, B, false);
      if (S.hooks.front) S.hooks.front(ctx, R, B);
      beak(ctx, R, B);
      face(ctx, R, B);
      if (S.hooks.head) S.hooks.head(ctx, R, B);
      effects(ctx, R, B);
    }
    K.define(S.id, { draw, stripe: S.stripe, colors: S.colors, kit: 'bird' });
  }

  K.kits.bird = { make, rig, REST };
})();
