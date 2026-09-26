// pets/00-biped.js : the upright chibi animal (mole, mouse, badger, raccoon).
//
// A pet spec gives the silhouette (body points skinned between the body and the head transform, so
// the head tilts without a neck seam), limbs, face and palette; hooks draw the kit (helmets, hoods,
// belts) at fixed layers. The kit owns the rig and the five shared animations; a pet adds `work`.
//
// Layers, back to front:
//   ground shadow > tail > far ear > far leg, far sole, far arm > near leg > body (fill, hooks.body
//   clipped to it, fur flecks and stipple, shade hatch, outline, tufts) > hooks.front > near sole >
//   near ear > face (hooks.face) > hooks.head > near arm, hooks.hand > hooks.fx
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp, sst = L.smoothstep;
  const TAU = Math.PI * 2;

  const REST = {
    x: 0, y: 0, lean: 0, sq: 1, legh: null,
    head: 0, hy: 0, hat: 0,
    nose: 0, eye: 1, eyeMode: 'open', mouth: 0, ear: 0,
    armN: null, armF: null,
    footN: null, footF: null,
    tail: 0, lamp: 1, held: 1,
    fx: null,
  };

  // ---------------------------------------------------------------- shared animations
  // Poses are offsets from the spec's rest (arms, feet); every table is in drawings.
  function poses(S) {
    const rN = S.arm.rest.n, rF = S.arm.rest.f;
    const fN = S.foot.rest.n, fF = S.foot.rest.f;
    const arms = (n, f) => ({ armN: { a1: rN.a1 + (n ? n[0] : 0), a2: rN.a2 + (n ? n[1] : 0) }, armF: { a1: rF.a1 + (f ? f[0] : 0), a2: rF.a2 + (f ? f[1] : 0) } });
    return {
      idle(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return Object.assign(arms([0.05 * b, 0.04 * b], [0.05 * b, 0]), {
          sq: 1 + 0.022 * b,
          head: 0.04 * K.wave(u + 0.15),
          nose: d === 3 ? 1 : d === 4 ? 0.5 : d === 10 ? 0.8 : 0,
          ear: d === 3 || d === 10 ? 1 : 0,
          eye: d === 7 ? 0 : 1,
          tail: 0.2 * K.wave(u * 2),
        });
      },
      walk(d, n) {
        const ph = (TAU * d) / n;
        const c = Math.cos(ph), s = Math.sin(ph);
        const liftN = s < 0 ? -s * 40 : 0;
        const liftF = s > 0 ? s * 40 : 0;
        const stride = S.foot.stride || 62;
        return Object.assign(arms([0.5 * c, 0.3 * c], [-0.5 * c, -0.3 * c]), {
          y: -20 * s * s,
          sq: 1.03 - 0.07 * c * c,
          lean: 0.07 + 0.02 * Math.cos(2 * ph),
          head: 0.05 * Math.sin(2 * ph + 0.9),
          footN: { x: fN.x + stride * c, lift: liftN, ang: -0.35 * (liftN / 40) },
          footF: { x: fF.x - stride * c, lift: liftF, ang: -0.35 * (liftF / 40) },
          tail: 0.35 * s,
          ear: 0.5 * c,
        });
      },
      happy(d) {
        const T = [
          { sq: 0.82, y: 0, up: 0.15, mouth: 0.4, hat: 0.05 },
          { sq: 1.14, y: -46, up: 0.6, mouth: 1, hat: 0.02 },
          { sq: 1.07, y: -135, up: 1, mouth: 1, hat: -0.1 },
          { sq: 1.0, y: -165, up: 1, mouth: 1, hat: -0.16 },
          { sq: 1.02, y: -140, up: 0.9, mouth: 1, hat: -0.1 },
          { sq: 1.06, y: -62, up: 0.55, mouth: 1, hat: 0.02 },
          { sq: 0.8, y: 0, up: 0.25, mouth: 0.6, hat: 0.12 },
          { sq: 0.95, y: 0, up: 0.15, mouth: 0.5, hat: 0.04 },
        ][d];
        const air = clamp(-T.y / 120);
        const up = S.arm.up;
        return {
          sq: T.sq,
          y: T.y,
          eyeMode: 'happy',
          mouth: T.mouth,
          hat: T.hat,
          head: -0.08 * T.up,
          ear: -T.up,
          armN: { a1: lerp(rN.a1, up.n.a1, T.up), a2: lerp(rN.a2, up.n.a2, T.up) },
          armF: { a1: lerp(rF.a1, up.f.a1, T.up), a2: lerp(rF.a2, up.f.a2, T.up) },
          footN: { x: fN.x + 10 * air, lift: 0, ang: 0.35 * air },
          footF: { x: fF.x - 10 * air, lift: 0, ang: 0.35 * air },
          tail: 0.5 * air,
          fx: { kind: 'burst', k: d },
        };
      },
      attack(d) {
        const T = [
          { x: 0, lean: 0.02, a1: 0.7, a2: 0.1, sq: 1.0, slash: 0 },
          { x: -26, lean: -0.17, a1: S.arm.windup ? S.arm.windup[0] : -2.3, a2: S.arm.windup ? S.arm.windup[1] : -2.7, sq: 1.04, slash: 0 },
          { x: 44, lean: 0.24, a1: 0.95, a2: 0.55, sq: 0.97, slash: 0.65 },
          { x: 52, lean: 0.27, a1: 1.25, a2: 0.8, sq: 0.95, slash: 1 },
          { x: 28, lean: 0.12, a1: 1.0, a2: 0.5, sq: 0.99, slash: 1.6 },
          { x: 8, lean: 0.04, a1: 0.8, a2: 0.2, sq: 1.0, slash: 2.2 },
        ][d];
        return {
          x: T.x,
          lean: T.lean,
          sq: T.sq,
          eyeMode: d >= 1 && d <= 4 ? 'angry' : 'open',
          mouth: d === 2 || d === 3 ? -1 : 0,
          ear: d === 1 ? -1 : 0.5,
          armN: { a1: T.a1, a2: T.a2 },
          armF: { a1: rF.a1 + 0.3 * T.lean, a2: rF.a2 },
          footN: { x: fN.x + 18, lift: 0, ang: 0 },
          footF: { x: fF.x - 22, lift: 0, ang: 0 },
          fx: { kind: 'slash', p: T.slash },
        };
      },
      sleep(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 0.66 + 0.022 * b,
          legh: 0,
          head: 0.3,
          hy: 14,
          hat: 0.24,
          eyeMode: 'closed',
          lamp: 0,
          ear: 0.6,
          armN: { a1: 1.15, a2: 0.35 },
          armF: { a1: 1.0, a2: 0.25 },
          footN: { x: fN.x + 18, lift: 0, ang: 0 },
          footF: { x: fF.x - 12, lift: 0, ang: 0 },
          tail: 0.6,
          held: 0,
          fx: { kind: 'zzz', u },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the rig
  function rig(S, pose) {
    const sx = 1 + (1 - pose.sq) * 0.75;
    const Mr = M.chain(M.tr(K.CX + pose.x, K.GROUND + pose.y), M.rot(pose.lean), M.sc(sx, pose.sq));
    const Mb = M.mul(Mr, M.tr(0, -pose.legh));
    const hs = S.headScale || 1;
    const Mh = M.chain(Mb, M.tr(0, pose.hy), M.about(pose.head, S.neck[0], S.neck[1]), M.scAbout(hs, hs, S.neck[0], S.neck[1]));
    const skin = (p) => {
      const a = M.ap(Mb, p), b = M.ap(Mh, p);
      return [lerp(a[0], b[0], p[2]), lerp(a[1], b[1], p[2])];
    };
    const body = K.smooth(S.sil.map(skin), 5);
    const c = M.ap(Mb, S.bodyC);
    return { S, pose, Mr, Mb, Mh, body, center: { x: c[0], y: c[1], r: S.bodyR || 250 } };
  }

  // ---------------------------------------------------------------- parts
  const sdOf = (S) => (...k) => L.hash(S.id, ...k) & 0x7fffffff;
  const Pt = () => K.parts;

  function arm(ctx, R, side, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const far = side === 'f';
    const a = far ? R.pose.armF : R.pose.armN;
    const Sh = far ? S.shoulders.f : S.shoulders.n;
    const Mb = R.Mb;
    const len = S.arm.len, r = S.arm.r;
    const dx = Math.cos(a.a1), dy = Math.sin(a.a1), nx = -dy, ny = dx;
    const wrist = [Sh[0] + dx * len, Sh[1] + dy * len];
    const cap = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI;
      cap.push([wrist[0] + nx * r * Math.cos(t) + dx * r * Math.sin(t), wrist[1] + ny * r * Math.cos(t) + dy * r * Math.sin(t)]);
    }
    // the shoulder end melts into the body: no ink there
    const open = M.all(Mb, [[Sh[0] + nx * r, Sh[1] + ny * r]].concat(cap, [[Sh[0] - nx * r, Sh[1] - ny * r]]));
    const sleeve = S.arm.sleeve ? S.arm.sleeve(far) : null;
    const armCol = sleeve ? sleeve.fill : L.mix(C.fur, C.furLit, 0.35);
    K.fill(ctx, open, K.far(armCol, far));
    if (sleeve && sleeve.deep) {
      L.hatch(ctx, open, { angle: a.a1 + 1.2, spacing: 9, width: 2.4, color: sleeve.deep, alpha: 0.7, density: 0.6, clip: true, inset: 4, overshoot: 0, seed: sd('armh', side), boil: B });
    } else {
      L.hatch(ctx, open, { angle: a.a1 + 1.2, spacing: 16, length: [8, 16], gap: [10, 20], width: 2.4, color: C.furLit, alpha: 0.6, clip: true, inset: 8, overshoot: 0, seed: sd('armf', side), boil: B });
    }
    L.inkPath(ctx, open, { width: far ? 6 : 7, seed: sd('arm', side), boil: B, taper: [26, 26], wobble: 1 });
    // the paw in paw space: origin at the wrist, x along a2
    const PT = M.chain(Mb, M.tr(wrist[0], wrist[1]), M.rot(a.a2), M.sc(S.arm.pawScale || 1));
    (S.arm.paw === 'hand' ? handPaw : spadePaw)(ctx, S, PT, far, B, side);
    return PT;
  }

  // mole and badger: a broad pink (or dark) spade with five hooked claws along its front
  function spadePaw(ctx, S, PT, far, B, side) {
    const C = S.colors, sd = sdOf(S);
    for (let i = 0; i < 5; i++) {
      const by = -24 + i * 12.5;
      const bx = 62 + 10 * Math.sin(((i + 0.5) / 5) * Math.PI);
      const len = (S.arm.claw || 30) + 6 * Math.sin(((i + 0.5) / 5) * Math.PI);
      const cl = M.all(PT, K.smooth([[bx - 6, by - 7], [bx + len * 0.55, by - 5], [bx + len, by + 9], [bx + len * 0.5, by + 7], [bx - 6, by + 7]], 4));
      K.fill(ctx, cl, K.far(C.claw, far));
      L.hatch(ctx, cl, { angle: 0.6, spacing: 5, width: 1.8, color: C.clawDeep, alpha: 0.8, density: 0.7, clip: true, inset: 1, overshoot: 0, seed: sd('clawh', side, i), boil: B });
      L.inkPath(ctx, cl, { closed: true, width: 4, seed: sd('claw', side, i), boil: B, wobble: 0.4, tremble: 0.2, taper: [3, 6] });
    }
    const palm = M.all(PT, K.smooth([[-4, -24], [26, -38], [56, -34], [74, -14], [76, 12], [60, 34], [28, 38], [2, 26]], 5));
    K.form(ctx, palm, {
      fill: K.far(C.palm || C.skin, far),
      deep: C.palmDeep || C.skinDeep,
      width: far ? 6 : 7,
      seed: sd('palm', side),
      boil: B,
      shade: 0.9,
      spacing: 8,
      hatchW: 2.6,
      hatchAlpha: 0.75,
      after(c2) {
        for (let k = 0; k < 3; k++) {
          const y = -12 + k * 12;
          K.line(c2, M.all(PT, [[38, y * 0.8], [54, y], [66, y * 1.05]]), { width: 3, color: C.palmDeep || C.skinDeep, alpha: 0.95, seed: sd('crease', side, k), boil: B, taper: [4, 4] });
        }
      },
    });
  }

  // mouse and raccoon: a small hand with four round fingers
  function handPaw(ctx, S, PT, far, B, side) {
    const C = S.colors, sd = sdOf(S);
    const pal = K.far(C.palm || C.skin, far);
    for (let i = 0; i < 4; i++) {
      const y = -15 + i * 10;
      const f = M.all(PT, L.capsulePts(40 + (i === 0 || i === 3 ? -4 : 0), y, 30, 7.5, 0.15 * (i - 1.5), 16));
      K.fill(ctx, f, pal);
      L.inkPath(ctx, f, { closed: true, width: 3.6, seed: sd('fing', side, i), boil: B, wobble: 0.3, taper: [2, 4] });
    }
    const palm = M.all(PT, K.smooth([[-2, -20], [22, -24], [38, -14], [40, 10], [24, 24], [2, 20]], 5));
    K.form(ctx, palm, { fill: pal, deep: C.palmDeep || C.skinDeep, width: far ? 5.5 : 6, seed: sd('hand', side), boil: B, shade: 0.8, spacing: 6, hatchW: 2.2 });
  }

  function legTube(ctx, R, side, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const far = side === 'f';
    const hip = far ? S.hips.f : S.hips.n;
    const foot = far ? R.pose.footF : R.pose.footN;
    const H = M.ap(R.Mb, hip);
    const A = M.ap(R.Mr, [foot.x + 4, -30 - foot.lift]);
    const mid = [(H[0] + A[0]) / 2, (H[1] + A[1]) / 2];
    const len = Math.hypot(A[0] - H[0], A[1] - H[1]) + 58;
    const ang = Math.atan2(A[1] - H[1], A[0] - H[0]);
    const tube = L.capsulePts(mid[0], mid[1], len, S.leg.r || 29, ang, 32);
    const col = S.leg.fill ? S.leg.fill(far) : C.fur;
    K.form(ctx, tube, { fill: K.far(col, far), width: far ? 6 : 7, seed: sd('leg', side), boil: B, shade: 0.8, spacing: 10, hatchAlpha: 0.45 });
  }

  function sole(ctx, R, side, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const far = side === 'f';
    const foot = far ? R.pose.footF : R.pose.footN;
    const F = S.foot;
    const cx = foot.x + 16, cy = -17 - foot.lift;
    const T = M.mul(R.Mr, M.about(foot.ang, cx - 30, cy));
    const toes = F.toes == null ? 4 : F.toes;
    for (let i = 0; i < toes; i++) {
      const bx = cx + F.len * 0.83, by = cy - 8 + i * 6;
      const rib = M.all(T, K.ribbonPts([[bx, by], [bx + 10, by + 1], [bx + 19, by + 4]], 9, 2));
      K.fill(ctx, rib, K.far(C.claw, far));
      L.inkPath(ctx, rib, { closed: true, width: 3, seed: sd('toe', side, i), boil: B, wobble: 0.3, taper: [2, 4] });
    }
    const pts = M.all(T, L.ellipsePts(cx, cy, F.len, F.h || 19, 32));
    K.form(ctx, pts, { fill: K.far(C.sole || C.skin, far), deep: C.soleDeep || C.skinDeep, width: far ? 5.5 : 6.5, seed: sd('sole', side), boil: B, shade: 0.8, spacing: 7, hatchW: 2.4, hatchAlpha: 0.7 });
  }

  // ---------------------------------------------------------------- draw
  function make(S) {
    S.hooks = S.hooks || {};
    const base = poses(S);
    const table = Object.assign({}, base, S.poses || {});
    const rest = K.pose(REST, {
      legh: S.legh,
      armN: Object.assign({}, S.arm.rest.n),
      armF: Object.assign({}, S.arm.rest.f),
      footN: Object.assign({ lift: 0, ang: 0 }, S.foot.rest.n),
      footF: Object.assign({ lift: 0, ang: 0 }, S.foot.rest.f),
    });
    function draw(ctx, anim, d, A) {
      const pose = K.pose(rest, table[anim](d, A.n, base));
      if (pose.legh == null) pose.legh = S.legh;
      const B = d % A.boil;
      const R = rig(S, pose);
      const sd = sdOf(S);
      K.shadow(ctx, K.CX + pose.x + 20 + 180 * pose.lean, -pose.y, S.shadowW || 250, B, sd('shadow'));
      if (S.hooks.behind) S.hooks.behind(ctx, R, B);
      Pt().tail(ctx, R, B);
      if (S.ears) Pt().ear(ctx, R, S.ears.f, true, B);
      legTube(ctx, R, 'f', B);
      sole(ctx, R, 'f', B);
      arm(ctx, R, 'f', B);
      legTube(ctx, R, 'n', B);
      Pt().body(ctx, R, B);
      if (S.hooks.front) S.hooks.front(ctx, R, B);
      sole(ctx, R, 'n', B);
      if (S.ears) Pt().ear(ctx, R, S.ears.n, false, B);
      Pt().face(ctx, R, B);
      if (S.hooks.head) S.hooks.head(ctx, R, B);
      const PT = arm(ctx, R, 'n', B);
      if (S.hooks.hand) S.hooks.hand(ctx, R, B, PT);
      Pt().effects(ctx, R, B);
    }
    K.define(S.id, { draw, stripe: S.stripe, colors: S.colors, kit: 'biped' });
  }

  K.kits.biped = { make, rig, REST };
})();
