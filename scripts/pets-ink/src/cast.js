// cast.js : the pet kit, shared by every pet module in src/pets/.
//
// A pet is a rig drawn with FILM.lib (ink lines, hatching, stipple) in pet space: the origin is the
// point between the feet on the ground, x toward the face (the pet faces right), y down, so the
// body lives at negative y. A pose moves the rig; an animation is a pose per drawing. Scenes are
// one line each (FILM.pets.scene('mole', 'walk')), so the contact sheets and the sprite export
// draw exactly the same thing.
//
// Motion is on twos (art bible 5): the drawing index is floor(t * 12) and the line boil is that
// index modulo a period that divides the loop, so every animation loops without a seam.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const TAU = Math.PI * 2;

  const K = (FILM.pets = {});
  K.GROUND = 880;
  K.CX = 520;
  K.W = 1080;
  K.H = 1080;
  K.defs = {};

  // drawings per loop and the boil period (a divisor of the drawings) for every animation
  K.ANIMS = {
    idle: { n: 24, boil: 3 },
    walk: { n: 8, boil: 4 },
    happy: { n: 8, boil: 4 },
    dig: { n: 8, boil: 4 },
    attack: { n: 6, boil: 3 },
    sleep: { n: 24, boil: 3 },
  };

  K.define = (id, def) => (K.defs[id] = def);

  /** Drawing index at local time t, wrapped into the loop. */
  K.drawing = (t, n) => ((Math.floor(t * 12 + 1e-6) % n) + n) % n;

  // ---------------------------------------------------------------- 2D affine: [a b c d e f]
  // x' = a x + c y + e, y' = b x + d y + f
  const M = (K.M = {
    I: [1, 0, 0, 1, 0, 0],
    mul(A, B) {
      return [
        A[0] * B[0] + A[2] * B[1],
        A[1] * B[0] + A[3] * B[1],
        A[0] * B[2] + A[2] * B[3],
        A[1] * B[2] + A[3] * B[3],
        A[0] * B[4] + A[2] * B[5] + A[4],
        A[1] * B[4] + A[3] * B[5] + A[5],
      ];
    },
    tr: (x, y) => [1, 0, 0, 1, x, y],
    rot: (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0],
    sc: (sx, sy) => [sx, 0, 0, sy == null ? sx : sy, 0, 0],
    /** rotate by a about the point (x, y) */
    about: (a, x, y) => M.mul(M.tr(x, y), M.mul(M.rot(a), M.tr(-x, -y))),
    ap: (T, p) => [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]],
    /** a direction (no translation) */
    dir: (T, v) => [T[0] * v[0] + T[2] * v[1], T[1] * v[0] + T[3] * v[1]],
    all: (T, pts) => pts.map((p) => M.ap(T, p)),
  });

  // ---------------------------------------------------------------- pose helpers
  /** Deep-merge a partial pose over a full one (numbers and one level of objects). */
  K.pose = (base, over) => {
    const out = {};
    for (const k of Object.keys(base)) {
      const b = base[k];
      const o = over ? over[k] : undefined;
      out[k] = b && typeof b === 'object' && !Array.isArray(b) ? Object.assign({}, b, o || {}) : o !== undefined ? o : b;
    }
    if (over) for (const k of Object.keys(over)) if (!(k in out)) out[k] = over[k];
    return out;
  };
  /** Linear blend of two full poses. */
  K.mix = (a, b, t) => {
    const out = {};
    for (const k of Object.keys(a)) {
      const x = a[k], y = b[k];
      if (typeof x === 'number' && typeof y === 'number') out[k] = x + (y - x) * t;
      else if (x && typeof x === 'object' && !Array.isArray(x) && y) out[k] = K.mix(x, y, t);
      else out[k] = t < 0.5 ? x : y;
    }
    return out;
  };

  // ---------------------------------------------------------------- drawing helpers
  /**
   * A tapered filled ribbon along a polyline: widths w0 at the start to w1 at the end.
   * Returns the closed outline points (so a caller can ink it).
   */
  K.ribbonPts = (pts, w0, w1) => {
    const n = pts.length;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const w = (w0 + (w1 - w0) * (i / Math.max(1, n - 1))) / 2;
      left.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      right.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    return left.concat(right.reverse());
  };

  /** Fill a polygon (smoothed points) with a flat colour. */
  K.fill = (ctx, pts, color, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    L.tracePath(ctx, pts, true);
    ctx.fill();
    ctx.restore();
  };

  /**
   * A form: flat fill, shade hatching on the side away from the upper-left light, then the ink
   * outline. c = { x, y } is the form's centre in canvas space, r its radius for the shade ramp.
   *   o.fill, o.deep (hatch colour), o.width (outline), o.shade 0..1, o.spacing, o.seed, o.boil
   */
  K.form = (ctx, pts, o) => {
    K.fill(ctx, pts, o.fill);
    if (o.inside) o.inside(ctx, pts);
    if (o.shade !== 0) {
      const c = o.c || (() => {
        const b = L.bounds(pts);
        return { x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2 };
      })();
      const sh = o.shade == null ? 1 : o.shade;
      const dens = (x, y) => sh * L.smoothstep(-0.05, 0.75, ((x - c.x) * 0.55 + (y - c.y) * 0.85) / c.r);
      L.hatch(ctx, pts, {
        spacing: o.spacing || 11,
        width: o.hatchW || 3,
        color: o.deep || P.ink,
        alpha: o.hatchAlpha || 0.6,
        density: dens,
        length: [18, 48],
        gap: [3, 8],
        inset: 5,
        overshoot: 0,
        clip: true,
        seed: o.seed + 11,
        boil: o.boil,
      });
    }
    if (o.after) o.after(ctx, pts);
    if (o.width !== 0)
      L.inkPath(ctx, pts, {
        closed: true,
        width: o.width || 7,
        seed: o.seed,
        boil: o.boil,
        wobble: o.wobble != null ? o.wobble : 1.4,
        tremble: 0.35,
        taper: [6, 14],
        color: o.ink || P.ink,
      });
  };

  /** A closed smooth shape from control points. */
  K.smooth = (pts, step = 5) => L.smoothPts(pts, true, step);

  /** An ellipse in some transform. */
  K.ellipse = (T, cx, cy, rx, ry, rot = 0, n = 40) => M.all(T, L.ellipsePts(cx, cy, rx, ry, n, rot));

  /** A hatched ground shadow under the pet; it shrinks and fades as the pet leaves the ground. */
  K.shadow = (ctx, x, lift, halfW, boil, seed) => {
    const k = L.clamp(1 - lift / 320, 0.35, 1);
    const pts = L.ellipsePts(x, K.GROUND + 6, halfW * k, 24 * k, 40);
    L.hatch(ctx, pts, {
      angle: -0.08,
      spacing: 9,
      width: 2.6,
      color: P.ink,
      alpha: 0.42 * k,
      length: [20, 70],
      gap: [4, 12],
      inset: 2,
      overshoot: 0,
      clip: true,
      seed,
      boil,
    });
  };

  /** Preview plate: the house paper and stripes. Export frames (FILM.transparent) skip it. */
  K.stage = (ctx, stripeB) => {
    if (FILM.transparent) return;
    L.paper(ctx, { x: 0, y: 0, w: K.W, h: K.H, seed: 5 });
    L.stripes(ctx, { bounds: [0, 0, K.W, K.H], colors: [P.stripeCream, stripeB || P.stripeSage], seed: 21 });
    // a faint ground line, as a construction line (art bible 3.1 of the skill: inkFaint 30 %)
    L.inkPath(ctx, [[80, K.GROUND + 8], [1000, K.GROUND + 8]], { width: 1.5, color: P.inkFaint, alpha: 0.3, seed: 3, boil: 0, smooth: false });
  };

  /** Register the scene '<pet>-<anim>' (call from the scene file, so it owns the registration). */
  K.scene = (petId, anim) =>
    FILM.scene({
      id: `${petId}-${anim}`,
      draw(ctx, t) {
        const A = K.ANIMS[anim];
        const d = K.drawing(t, A.n);
        const def = K.defs[petId];
        K.stage(ctx, def.stripe);
        def.draw(ctx, anim, d, A);
      },
    });

  K.TAU = TAU;
})();
