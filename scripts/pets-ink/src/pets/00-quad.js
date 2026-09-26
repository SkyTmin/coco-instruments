// pets/00-quad.js : the four-legged chibi animal (cat, bulldog, ferret, shepherd, fox, wolf, dragon).
//
// The torso, neck and head are ONE outline (points skinned between the body, a front half that can
// bow, and the head), so a turn of the head or a play bow never opens a seam. Legs are two bones
// solved by IK from the shoulder or hip to a foot target on the ground; the upper bone melts into
// the body (no ink where it joins), the paw sits on the ground. The far legs are drawn behind the
// body and darker.
//
// Layers, back to front:
//   shadow > hooks.behind > tail > far ear > far hind leg > far front leg > body (hooks.body clipped,
//   fur, shade, outline, tufts) > hooks.bodyAfter > near hind leg > near front leg > hooks.front >
//   near ear > face (hooks.face) > hooks.head > effects (hooks.fx)
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp, sst = L.smoothstep;
  const TAU = Math.PI * 2;
  const Pt = () => K.parts;
  const sdOf = (S) => (...k) => L.hash(S.id, ...k) & 0x7fffffff;

  const REST = {
    x: 0, y: 0, lean: 0, sq: 1, legh: 0, bow: 0, arch: 0,
    head: 0, hy: 0, hat: 0,
    nose: 0, eye: 1, eyeMode: 'open', mouth: 0, ear: 0,
    legs: null,
    tail: 0, fx: null,
  };

  // ---------------------------------------------------------------- shared animations
  function poses(S) {
    const F = S.feet; // rest foot x: { fn, ff, hn, hf }
    const foot = (k, dx = 0, lift = 0) => ({ x: F[k] + dx, lift });
    const stand = () => ({ fn: foot('fn'), ff: foot('ff'), hn: foot('hn'), hf: foot('hf') });
    const wag = S.wag == null ? 1 : S.wag;
    return {
      idle(d, n) {
        const u = d / n;
        const b = K.wave(u);
        return {
          sq: 1 + 0.02 * b,
          head: 0.05 * K.wave(u + 0.2),
          nose: d === 3 ? 1 : d === 9 ? 0.6 : 0,
          ear: d === 4 || d === 10 ? 1 : 0,
          eye: d === 7 ? 0 : 1,
          tail: 0.25 * wag * K.wave(u * 2),
          legs: stand(),
        };
      },
      walk(d, n) {
        const ph = (TAU * d) / n;
        const c = Math.cos(ph), s = Math.sin(ph);
        const st = S.stride || 56, lh = S.lift || 38;
        const A = { x: st * c, lift: s < 0 ? -s * lh : 0 };
        const Bp = { x: -st * c, lift: s > 0 ? s * lh : 0 };
        return {
          y: -12 * s * s,
          sq: 1.02 - 0.04 * c * c,
          lean: -0.02 + 0.015 * Math.cos(2 * ph),
          head: 0.05 * Math.sin(2 * ph + 1),
          ear: 0.5 * c,
          tail: 0.35 * wag * s,
          legs: {
            fn: foot('fn', A.x, A.lift),
            hf: foot('hf', A.x, A.lift),
            ff: foot('ff', Bp.x, Bp.lift),
            hn: foot('hn', Bp.x, Bp.lift),
          },
        };
      },
      happy(d) {
        const T = [
          { sq: 0.86, y: 0, bow: 0.14, tuck: 0, mouth: 0.6 },
          { sq: 1.1, y: -40, bow: -0.08, tuck: 0.2, mouth: 1 },
          { sq: 1.04, y: -128, bow: -0.06, tuck: 0.8, mouth: 1 },
          { sq: 1.0, y: -156, bow: 0, tuck: 1, mouth: 1 },
          { sq: 1.02, y: -130, bow: 0.04, tuck: 0.8, mouth: 1 },
          { sq: 1.04, y: -58, bow: 0.06, tuck: 0.3, mouth: 1 },
          { sq: 0.84, y: 0, bow: 0.12, tuck: 0, mouth: 0.8 },
          { sq: 0.96, y: 0, bow: 0.04, tuck: 0, mouth: 0.6 },
        ][d];
        const up = 60 * T.tuck;
        return {
          sq: T.sq,
          y: T.y,
          bow: T.bow,
          eyeMode: 'happy',
          mouth: T.mouth,
          ear: -1,
          head: -0.08,
          tail: (d % 2 ? 0.6 : -0.6) * wag,
          legs: { fn: foot('fn', 16 * T.tuck, up), ff: foot('ff', 20 * T.tuck, up), hn: foot('hn', -20 * T.tuck, up), hf: foot('hf', -16 * T.tuck, up) },
          fx: { kind: 'burst', k: d },
        };
      },
      attack(d) {
        const T = [
          { x: 0, bow: 0.02, sq: 1.0, mouth: 0, p: 0, fwd: 0 },
          { x: -34, bow: 0.2, sq: 0.9, mouth: -1, p: 0, fwd: -10 },
          { x: 50, bow: -0.14, sq: 1.04, mouth: 1, p: 0.3, fwd: 50 },
          { x: 66, bow: -0.04, sq: 1.0, mouth: 0.2, p: 1, fwd: 40 },
          { x: 46, bow: 0.02, sq: 1.0, mouth: -0.6, p: 1.3, fwd: 20 },
          { x: 10, bow: 0.02, sq: 1.0, mouth: 0, p: 2, fwd: 0 },
        ][d];
        const swipe = S.attack === 'swipe';
        const legs = stand();
        // the swipe: the near front paw comes up and forward, the others brace
        if (swipe && (d === 1 || d === 2 || d === 3)) legs.fn = { x: F.fn + [0, 20, 70, 60][d], lift: [0, 120, 70, 20][d] };
        else legs.fn = foot('fn', T.fwd * 0.4);
        legs.hn = foot('hn', -T.fwd * 0.3);
        return {
          x: T.x,
          bow: T.bow,
          sq: T.sq,
          eyeMode: d >= 1 && d <= 4 ? 'angry' : 'open',
          mouth: swipe ? (d >= 1 && d <= 3 ? -1 : 0) : T.mouth,
          ear: d >= 1 && d <= 4 ? -1 : 0,
          tail: d === 1 ? -0.4 : 0.2,
          legs,
          fx: swipe ? { kind: 'slash', p: [0, 0, 0.65, 1, 1.6, 2.2][d] } : { kind: 'chomp', p: T.p },
        };
      },
      sleep(d, n) {
        const u = d / n;
        const b = K.wave(u);
        const low = S.lie == null ? 100 : S.lie;
        return {
          legh: -low,
          sq: 0.9 + 0.02 * b,
          head: S.sleepHead == null ? 0.22 : S.sleepHead,
          hy: low * 0.35,
          eyeMode: 'closed',
          ear: 0.6,
          tail: S.sleepTail == null ? 1.2 : S.sleepTail,
          legs: { fn: foot('fn', 46, 0), ff: foot('ff', 30, 0), hn: foot('hn', 20, 0), hf: foot('hf', 10, 0) },
          fx: { kind: 'zzz', u },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the rig
  function rig(S, pose) {
    const sx = 1 + (1 - pose.sq) * 0.6;
    const Mr = M.chain(M.tr(K.CX + pose.x, K.GROUND + pose.y), M.rot(pose.lean), M.sc(sx, pose.sq));
    const Mb = M.mul(Mr, M.tr(0, -pose.legh));
    const Mf = M.mul(Mb, M.about(pose.bow, S.spine[0], S.spine[1]));
    const hs = S.headScale || 1;
    const Mh = M.chain(Mf, M.tr(0, pose.hy), M.about(pose.head, S.neck[0], S.neck[1]), M.scAbout(hs, hs, S.neck[0], S.neck[1]));
    const wf = (x) => sst(S.spine[0] - 60, S.spine[0] + 120, x);
    // arch: the middle of the back rises (a bounding ferret gathers its legs under a hump)
    const arch = (p) => (pose.arch ? [p[0], p[1] - pose.arch * Math.exp(-(((p[0] - (S.archX || 0)) / (S.archW || 150)) ** 2)) * (p[1] < (S.archY == null ? -140 : S.archY) ? 1 : 0.55)] : p);
    const place = (p0, w) => {
      const p = arch(p0);
      const b = M.ap(Mb, p), f = M.ap(Mf, p);
      const k = wf(p[0]);
      const bf = [lerp(b[0], f[0], k), lerp(b[1], f[1], k)];
      if (!w) return bf;
      const h = M.ap(Mh, p);
      return [lerp(bf[0], h[0], w), lerp(bf[1], h[1], w)];
    };
    const ctrl = S.sil.map((p) => place(p, p[2]));
    const body = K.smooth(ctrl, 5);
    const c = place(S.bodyC, 0);
    return { S, pose, Mr, Mb, Mf, Mh, place, ctrl, body, center: { x: c[0], y: c[1], r: S.bodyR || 230 } };
  }

  // ---------------------------------------------------------------- legs
  function leg(ctx, R, key, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const far = key[1] === 'f';
    const front = key[0] === 'f';
    const G = front ? S.front : S.hind;
    const at = far ? G.atF : G.atN;
    const foot = R.pose.legs[key];
    const a = R.place(at, 0);
    const t = M.ap(R.Mr, [foot.x, -foot.lift - (G.ankle || 16)]);
    const { knee, foot: f } = K.ik(a, t, G.l1, G.l2, G.bend == null ? 1 : G.bend);
    const col = K.far(S.legFill ? S.legFill(key) : C.fur, far);
    const ink = far ? 6 : 7;
    // One continuous leg: the lower bone is inked without its top cap, the upper bone only along its
    // two sides, so no line crosses the knee (capped bones read as a robot's segments).
    const lower = K.limbOpen(knee, f, G.rj, G.r2, 8);
    const upper = K.limbPts(a, knee, G.r1, G.rj, 10);
    K.fill(ctx, lower.poly, S.sock ? K.far(S.sock, far) : col);
    K.fill(ctx, upper, col);
    const shade = K.shadeOf(K.centreOf(upper.concat(lower.poly)));
    for (const pts of [lower.poly, upper]) L.hatch(ctx, pts, { spacing: 10, width: 3, color: C.furDeep, alpha: 0.45, density: (x, y) => 0.8 * shade(x, y), clip: true, inset: 5, overshoot: 0, seed: sd('legH', key, pts.length), boil: B });
    if (S.hooks.legAfter) S.hooks.legAfter(ctx, R, B, key, knee, f, far);
    // ink: the lower bone round its foot and up both sides to the knee, the upper along its sides
    const dx = knee[0] - a[0], dy = knee[1] - a[1], dl = Math.hypot(dx, dy) || 1;
    const nx = -dy / dl, ny = dx / dl;
    const sideL = [[a[0] + nx * G.r1, a[1] + ny * G.r1], [knee[0] + nx * G.rj, knee[1] + ny * G.rj]];
    const sideR = [[a[0] - nx * G.r1, a[1] - ny * G.r1], [knee[0] - nx * G.rj, knee[1] - ny * G.rj]];
    L.inkPath(ctx, lower.open, { width: ink, seed: sd('legL', key), boil: B, taper: [8, 8], wobble: 1 });
    for (const [i, sdd] of [[sideL, 1], [sideR, 2]]) L.inkPath(ctx, i, { width: ink, seed: sd('legU', key, sdd), boil: B, taper: [26, 6], wobble: 0.8, smooth: false });
    // the paw
    const pw = G.paw || [30, 15];
    const pc = [f[0] + pw[0] * 0.45, f[1] + (G.ankle || 16) - pw[1] + 2];
    const paw = L.ellipsePts(pc[0], pc[1], pw[0], pw[1], 24, R.pose.lean * 0.5);
    K.form(ctx, paw, {
      fill: K.far(S.pawFill ? S.pawFill(key) : col, far),
      deep: C.furDeep,
      width: ink - 0.5,
      seed: sd('paw', key),
      boil: B,
      shade: 0.6,
      spacing: 7,
      after(c2) {
        for (let k = 0; k < 2; k++) {
          const x = pc[0] + pw[0] * (0.25 + k * 0.32);
          K.line(c2, [[x, pc[1] + pw[1] * 0.1], [x + 2, pc[1] + pw[1] * 0.95]], { width: 3, color: P.inkSoft, seed: sd('toe', key, k), boil: B, taper: [2, 4] });
        }
        if (G.claws) {
          for (let k = 0; k < 3; k++) {
            const x = pc[0] + pw[0] * (0.62 + k * 0.14), y = pc[1] + pw[1] * (0.2 + k * 0.22);
            K.fill(c2, [[x, y - 5], [x + 16, y + 2], [x, y + 5]], G.clawCol || '#EDE2CB');
            L.inkPath(c2, [[x, y - 5], [x + 16, y + 2], [x, y + 5]], { closed: true, width: 2.4, seed: sd('claw', key, k), boil: B, smooth: false, taper: 0, wobble: 0.2 });
          }
        }
      },
    });
  }

  // ---------------------------------------------------------------- draw
  function make(S) {
    S.hooks = S.hooks || {};
    const base = poses(S);
    const table = Object.assign({}, base, S.poses || {});
    const rest = K.pose(REST, { legh: 0 });
    function draw(ctx, anim, d, A) {
      const raw = table[anim](d, A.n, base);
      const pose = K.pose(rest, raw);
      if (!pose.legs) pose.legs = base.idle(0, 12).legs;
      const B = d % A.boil;
      const R = rig(S, pose);
      const sd = sdOf(S);
      const cx = (M.ap(R.Mr, [S.feet.fn, 0])[0] + M.ap(R.Mr, [S.feet.hn, 0])[0]) / 2;
      K.shadow(ctx, cx, -pose.y, S.shadowW || 280, B, sd('shadow'));
      if (S.hooks.behind) S.hooks.behind(ctx, R, B);
      if (!S.tailFront) Pt().tail(ctx, R, B);
      if (S.ears) Pt().ear(ctx, R, S.ears.f, true, B);
      leg(ctx, R, 'hf', B);
      leg(ctx, R, 'ff', B);
      if (S.hooks.farWing) S.hooks.farWing(ctx, R, B);
      Pt().body(ctx, R, B);
      leg(ctx, R, 'hn', B);
      leg(ctx, R, 'fn', B);
      if (S.tailFront) Pt().tail(ctx, R, B);
      if (S.hooks.front) S.hooks.front(ctx, R, B);
      if (S.ears) Pt().ear(ctx, R, S.ears.n, false, B);
      Pt().face(ctx, R, B);
      if (S.hooks.head) S.hooks.head(ctx, R, B);
      Pt().effects(ctx, R, B);
    }
    K.define(S.id, { draw, stripe: S.stripe, colors: S.colors, kit: 'quad' });
  }

  K.kits.quad = { make, rig, REST };
})();
