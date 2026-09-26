// cast.js : the pet kit, shared by every rig kit (src/pets/00-*.js) and every pet (src/pets/10-*.js).
//
// A pet is drawn with FILM.lib (ink lines, hatching, stipple) in pet space: the origin is the point
// between the feet on the ground, x toward the face (every pet faces right), y down, so the body
// lives at negative y. A pose moves a rig; an animation is a pose per drawing. Scenes are one line
// each (FILM.pets.scene('mole', 'walk')), so contact sheets and sprite export draw the same thing.
//
// Motion is held drawings (art bible 5): the drawing index is floor(t * fps) and the line boil is
// that index modulo a period that divides the loop, so every animation loops without a seam.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const TAU = Math.PI * 2;
  const clamp = L.clamp, lerp = L.lerp, sst = L.smoothstep;

  const K = (FILM.pets = {});
  K.GROUND = 880;
  K.CX = 520;
  K.W = 1080;
  K.H = 1080;
  K.defs = {};
  K.kits = {};
  K.TAU = TAU;

  // drawings per loop, drawings per second and the boil period (a divisor of the drawings).
  // Slow loops (idle, sleep) are held on fours: half the drawings, the same two seconds.
  K.ANIMS = {
    idle: { n: 12, fps: 6, boil: 3 },
    walk: { n: 8, fps: 12, boil: 4 },
    happy: { n: 8, fps: 12, boil: 4 },
    work: { n: 8, fps: 12, boil: 4 },
    attack: { n: 6, fps: 12, boil: 3 },
    sleep: { n: 12, fps: 6, boil: 3 },
  };
  K.ANIM_IDS = Object.keys(K.ANIMS);

  K.define = (id, def) => (K.defs[id] = def);

  /** Drawing index at local time t, wrapped into the loop. */
  K.drawing = (t, A) => ((Math.floor(t * A.fps + 1e-6) % A.n) + A.n) % A.n;

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
    /** product of any number of transforms, left to right */
    chain: (...Ts) => Ts.reduce((a, b) => M.mul(a, b)),
    tr: (x, y) => [1, 0, 0, 1, x, y],
    rot: (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0],
    sc: (sx, sy) => [sx, 0, 0, sy == null ? sx : sy, 0, 0],
    /** rotate by a about the point (x, y) */
    about: (a, x, y) => M.mul(M.tr(x, y), M.mul(M.rot(a), M.tr(-x, -y))),
    /** scale about the point (x, y) */
    scAbout: (sx, sy, x, y) => M.mul(M.tr(x, y), M.mul(M.sc(sx, sy), M.tr(-x, -y))),
    ap: (T, p) => [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]],
    /** a direction (no translation) */
    dir: (T, v) => [T[0] * v[0] + T[2] * v[1], T[1] * v[0] + T[3] * v[1]],
    all: (T, pts) => pts.map((p) => M.ap(T, p)),
    /** mean scale of a transform (for line widths that should follow a squashed part) */
    scale: (T) => Math.sqrt(Math.abs(T[0] * T[3] - T[1] * T[2])),
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
  /** Pick from a table of keyed drawings: key(d) -> row, rows merged over the defaults. */
  K.table = (rows, d) => rows[((d % rows.length) + rows.length) % rows.length];
  K.wave = (u) => Math.sin(TAU * u);

  // ---------------------------------------------------------------- shapes
  /** A closed smooth shape from control points. */
  K.smooth = (pts, step = 5) => L.smoothPts(pts, true, step);
  /** An open smooth polyline. */
  K.curve = (pts, step = 5) => L.smoothPts(pts, false, step);
  K.ellipse = (T, cx, cy, rx, ry, rot = 0, n = 40) => M.all(T, L.ellipsePts(cx, cy, rx, ry, n, rot));

  /**
   * A tapered ribbon along a polyline: width w0 at the start to w1 at the end, or a function of u.
   * Returns the closed outline points.
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
      const u = i / Math.max(1, n - 1);
      const w = (typeof w0 === 'function' ? w0(u) : w0 + (w1 - w0) * u) / 2;
      left.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      right.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    return left.concat(right.reverse());
  };

  /** A limb segment from a to b, radius ra at a and rb at b, rounded at both ends. */
  K.limbPts = (a, b, ra, rb, n = 10) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = -Math.PI / 2 + (i / n) * Math.PI; // round the b end
      out.push([b[0] + (ux * Math.cos(t) + nx * Math.sin(t)) * rb, b[1] + (uy * Math.cos(t) + ny * Math.sin(t)) * rb]);
    }
    for (let i = 0; i <= n; i++) {
      const t = Math.PI / 2 + (i / n) * Math.PI; // round the a end
      out.push([a[0] + (ux * Math.cos(t) + nx * Math.sin(t)) * ra, a[1] + (uy * Math.cos(t) + ny * Math.sin(t)) * ra]);
    }
    return out;
  };

  /**
   * A limb segment that melts into the body at a: the closed outline, and the open path that
   * skips the a end (ink it, so no line crosses the body where the limb joins).
   */
  K.limbOpen = (a, b, ra, rb, n = 10) => {
    const poly = K.limbPts(a, b, ra, rb, n);
    const bcap = poly.slice(0, n + 1);
    const acap = poly.slice(n + 1);
    return { poly, open: [acap[acap.length - 1]].concat(bcap, [acap[0]]) };
  };

  /** 2-bone IK: from root a to target t with bone lengths l1, l2; bend = +1 or -1 picks the knee side. */
  K.ik = (a, t, l1, l2, bend) => {
    const dx = t[0] - a[0], dy = t[1] - a[1];
    let d = Math.hypot(dx, dy);
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const ang = Math.atan2(dy, dx);
    const c = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const k = ang + bend * Math.acos(c);
    const knee = [a[0] + Math.cos(k) * l1, a[1] + Math.sin(k) * l1];
    const dd = Math.hypot(t[0] - knee[0], t[1] - knee[1]) || 1;
    const foot = [knee[0] + ((t[0] - knee[0]) / dd) * l2, knee[1] + ((t[1] - knee[1]) / dd) * l2];
    return { knee, foot };
  };

  // ---------------------------------------------------------------- painting
  /** Fill a polygon with a flat colour. */
  K.fill = (ctx, pts, color, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    L.tracePath(ctx, pts, true);
    ctx.fill();
    ctx.restore();
  };
  /** Run fn with the canvas clipped to a polygon. */
  K.clip = (ctx, pts, fn) => {
    ctx.save();
    ctx.beginPath();
    L.tracePath(ctx, pts, true);
    ctx.clip();
    fn();
    ctx.restore();
  };

  /** Shade ramp: 0 on the lit upper-left of a form, 1 on its lower-right. */
  K.shadeOf = (c) => (x, y) => sst(-0.05, 0.75, ((x - c.x) * 0.55 + (y - c.y) * 0.85) / c.r);
  K.centreOf = (pts) => {
    const b = L.bounds(pts);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2 };
  };

  /**
   * A form: flat fill, optional inside decoration, shade hatching on the side away from the
   * upper-left light, optional after-decoration, then the ink outline.
   *   o.fill, o.deep (hatch colour), o.width (outline, 0 = none), o.shade 0..1, o.spacing,
   *   o.c { x, y, r } shade centre, o.seed, o.boil, o.inside(ctx, pts), o.after(ctx, pts),
   *   o.open: ink an open path instead (for parts whose one end melts into another part)
   */
  K.form = (ctx, pts, o) => {
    K.fill(ctx, pts, o.fill, o.alpha == null ? 1 : o.alpha);
    if (o.inside) o.inside(ctx, pts);
    if (o.shade !== 0) {
      const c = o.c || K.centreOf(pts);
      const sh = o.shade == null ? 1 : o.shade;
      const f = K.shadeOf(c);
      L.hatch(ctx, pts, {
        angle: o.angle != null ? o.angle : -Math.PI / 4,
        spacing: o.spacing || 11,
        width: o.hatchW || 3,
        color: o.deep || P.ink,
        alpha: o.hatchAlpha || 0.6,
        density: (x, y) => sh * f(x, y),
        length: o.len || [18, 48],
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
      L.inkPath(ctx, o.open || pts, {
        closed: !o.open,
        width: o.width || 7,
        seed: o.seed,
        boil: o.boil,
        wobble: o.wobble != null ? o.wobble : 1.4,
        tremble: 0.35,
        taper: o.open ? o.taper || [22, 22] : [6, 14],
        smooth: o.smooth,
        color: o.ink || P.ink,
        alpha: o.inkAlpha == null ? 1 : o.inkAlpha,
      });
  };

  /** An ink line (open), the kit's default look for details. */
  K.line = (ctx, pts, o) =>
    L.inkPath(ctx, pts, Object.assign({ width: 4, wobble: 0.5, tremble: 0.2, taper: [4, 8] }, o));

  /** Darken a colour toward a shade (for the far legs and arms). */
  K.far = (c, far, deep) => (far ? L.mix(c, deep || '#2a2320', 0.32) : c);

  // ---------------------------------------------------------------- eyes
  /**
   * An eye at (x, y) in transform T. o.r radius, o.mode 'open' | 'closed' | 'happy' | 'angry',
   * o.open 0..1 (a blink), o.style 'bead' (a black bead) or 'iris' (white, coloured iris, pupil),
   * o.iris colour, o.look [dx, dy] pupil offset (units of r), o.lid 0..1 how far an upper lid
   * comes down (o.lidColor), o.slit a cat's slit pupil.
   */
  K.eye = (ctx, T, x, y, o, B, seed) => {
    const r = o.r || 16;
    const mode = o.mode || 'open';
    const open = o.open == null ? 1 : o.open;
    // on a dark head an ink line vanishes: o.lineColor draws the shut eye light
    const shut = (pts, w) => {
      if (o.lineColor) K.line(ctx, pts, { width: w + 4, color: P.ink, seed, boil: B, taper: [4, 4] });
      K.line(ctx, pts, Object.assign({ width: w, seed, boil: B, taper: [4, 4] }, o.lineColor ? { color: o.lineColor } : {}));
    };
    if (mode === 'happy') {
      shut(M.all(T, [[x - r, y + r * 0.35], [x, y - r * 0.55], [x + r, y + r * 0.35]]), Math.max(4, r * 0.38));
      return;
    }
    if (mode === 'closed' || open < 0.2) {
      shut(M.all(T, [[x - r, y - r * 0.1], [x, y + r * 0.45], [x + r, y - r * 0.1]]), Math.max(3.6, r * 0.34));
      return;
    }
    const ry = r * 1.15 * open;
    if (o.style === 'iris') {
      const white = K.ellipse(T, x, y, r, ry, 0, 28);
      K.fill(ctx, white, o.white || P.white);
      K.clip(ctx, white, () => {
        const lx = (o.look ? o.look[0] : 0.15) * r, ly = (o.look ? o.look[1] : 0) * r;
        K.fill(ctx, K.ellipse(T, x + lx, y + ly, r * 0.72, r * 0.8, 0, 24), o.iris || '#C98A2A');
        K.fill(ctx, K.ellipse(T, x + lx, y + ly, r * (o.slit ? 0.18 : 0.38), r * (o.slit ? 0.72 : 0.42), 0, 20), P.ink);
        K.fill(ctx, K.ellipse(T, x + lx - r * 0.25, y + ly - r * 0.3, r * 0.2, r * 0.2, 0, 12), P.white);
        if (o.lid) K.fill(ctx, K.ellipse(T, x, y - ry * (2 - o.lid * 1.2), r * 1.35, ry * 1.05, 0, 20), o.lidColor || '#6B615B');
      });
      L.inkPath(ctx, white, { closed: true, width: Math.max(3, r * 0.2), seed, boil: B, wobble: 0.4, taper: [3, 6] });
    } else {
      K.fill(ctx, K.ellipse(T, x, y, r, ry, 0, 20), o.color || '#1A110E');
      if (o.lid) {
        // a heavy upper lid: the sly, sleepy or tough look
        const lid = K.ellipse(T, x, y - ry * (2 - o.lid * 1.2), r * 1.35, ry * 1.05, 0, 20);
        K.clip(ctx, K.ellipse(T, x, y, r * 1.02, ry * 1.02, 0, 20), () => K.fill(ctx, lid, o.lidColor || '#6B615B'));
        const lx = r * 1.1, ly = y - ry + o.lid * ry * 0.9;
        K.line(ctx, M.all(T, [[x - lx, ly + r * 0.1], [x, ly - r * 0.12], [x + lx, ly + r * 0.18]]), { width: Math.max(3.5, r * 0.3), seed: seed + 9, boil: B, taper: [3, 5] });
      }
      if (open > 0.6) {
        K.fill(ctx, K.ellipse(T, x - r * 0.3, y - r * 0.42, r * 0.36, r * 0.36, 0, 12), P.white);
        K.fill(ctx, K.ellipse(T, x + r * 0.36, y + r * 0.46, r * 0.16, r * 0.16, 0, 8), P.white, 0.8);
      }
    }
    if (mode === 'angry') {
      K.line(ctx, M.all(T, [[x - r * 1.3, y - r * 1.9], [x + r * 1.1, y - r * 1.2]]), { width: Math.max(5, r * 0.42), seed: seed + 5, boil: B, taper: [3, 5], smooth: false });
    }
  };

  // ---------------------------------------------------------------- kit props
  /** A band (belt, strap, collar) along a centre line, clipped to a shape if given. */
  K.band = (ctx, pts, w, o) => {
    const rib = K.ribbonPts(pts, w, w);
    const draw = () => {
      K.fill(ctx, rib, o.fill);
      if (o.deep) L.hatch(ctx, rib, { spacing: 7, width: 2.2, color: o.deep, alpha: 0.6, density: o.density || 0.5, clip: true, seed: o.seed + 3, boil: o.boil });
      for (const s of [1, -1]) {
        const edge = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          edge.push([pts[i][0] - ((b[1] - a[1]) / tl) * (w / 2) * s, pts[i][1] + ((b[0] - a[0]) / tl) * (w / 2) * s]);
        }
        L.inkPath(ctx, edge, { width: o.width || 5, seed: o.seed + (s > 0 ? 1 : 2), boil: o.boil, wobble: 0.7, taper: [2, 2] });
      }
      if (o.stitch) {
        const st = L.smoothPts(pts, false, 22);
        for (let i = 0; i + 1 < st.length; i += 2) K.line(ctx, [st[i], st[i + 1]], { width: 2, color: o.stitch, seed: o.seed + 10 + i, boil: o.boil, smooth: false, taper: 0 });
      }
    };
    if (o.clip) K.clip(ctx, o.clip, draw);
    else draw();
  };

  /** A small metal plate (buckle, badge, tag, rivet). */
  K.plate = (ctx, pts, o) => K.form(ctx, pts, Object.assign({ fill: '#C39A55', deep: '#7E5E2E', width: 4.5, spacing: 6, hatchW: 2, shade: 0.8 }, o));

  /** A chain of oval links along a polyline (collars, leashes). */
  K.chain = (ctx, pts, link, o) => {
    const path = L.smoothPts(pts, false, link * 0.8);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const side = i % 2 === 0;
      const ring = L.ellipsePts(c[0], c[1], link * 0.62, side ? link * 0.36 : link * 0.14, 18, ang);
      L.inkPath(ctx, ring, { closed: true, width: o.width || 7, color: P.ink, seed: o.seed + i, boil: o.boil, wobble: 0.3, taper: [2, 3] });
      L.inkPath(ctx, ring, { closed: true, width: (o.width || 7) * 0.45, color: o.color || '#9AA0A4', seed: o.seed + i, boil: o.boil, wobble: 0.3, taper: [2, 3] });
    }
  };

  /**
   * A miner's helmet in transform T: dome centred (cx, cy) with radii rx, ry above the brim line
   * y = cy, a band, rivets, a dent, a brim, and a brass lamp (o.lamp 0..1 glow, null = none).
   *   o.col { hat, hatDeep, hatLit, brass, brassDeep, glass }, o.seed, o.boil
   */
  K.helmet = (ctx, T, o) => {
    const { cx, cy, rx, ry } = o;
    const c = o.col, B = o.boil, sd = (k) => (o.seed + L.hash(k)) & 0x7fffffff;
    const dome = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (i / 24) * Math.PI;
      dome.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    const domePts = M.all(T, K.smooth(dome.concat([[cx + rx * 1.02, cy + 4], [cx - rx * 1.02, cy + 4]]), 5));
    const dc = M.ap(T, [cx, cy - ry * 0.45]);
    K.form(ctx, domePts, {
      fill: c.hat,
      deep: c.hatDeep,
      c: { x: dc[0], y: dc[1], r: rx * 0.95 },
      width: 8,
      seed: sd('dome'),
      boil: B,
      spacing: 9,
      hatchW: 2.8,
      hatchAlpha: 0.75,
      inside(c2) {
        const hl = [];
        for (let i = 0; i <= 6; i++) {
          const a = Math.PI * 1.12 + (i / 6) * 0.55;
          hl.push([cx + Math.cos(a) * rx * 0.8, cy - 6 + Math.sin(a) * ry * 0.78]);
        }
        L.inkPath(c2, M.all(T, hl), { width: 13, color: c.hatLit, seed: sd('hl'), boil: B, taper: [10, 16], wobble: 0.6 });
      },
      after(c2) {
        const band = [];
        for (let x = cx - rx * 0.95; x <= cx + rx * 0.97; x += rx * 0.2) band.push([x, cy - ry * 0.26]);
        K.line(c2, M.all(T, band), { width: 4.2, color: P.inkSoft, seed: sd('band'), boil: B, wobble: 0.6 });
        K.line(c2, M.all(T, [[cx - rx * 0.45, cy - ry * 0.76], [cx - rx * 0.34, cy - ry * 0.66], [cx - rx * 0.22, cy - ry * 0.73]]), { width: 3.6, color: c.hatDeep, seed: sd('dent'), boil: B });
        for (const k of [-0.7, -0.33, 0.05]) K.fill(c2, M.all(T, L.ellipsePts(cx + rx * k, cy - ry * 0.13, 5, 5, 10)), c.hatDeep);
        if (o.ridge) K.line(c2, M.all(T, [[cx - rx * 0.1, cy - ry * 0.98], [cx + rx * 0.3, cy - ry * 0.92], [cx + rx * 0.62, cy - ry * 0.72]]), { width: 9, color: c.hatDeep, alpha: 0.7, seed: sd('ridge'), boil: B });
      },
    });
    const brim = M.all(T, L.ellipsePts(cx + 12, cy + 4, rx * 1.12, 17, 40));
    K.form(ctx, brim, { fill: c.hatDeep, deep: P.ink, width: 6.5, seed: sd('brim'), boil: B, shade: 0.6, spacing: 7, hatchW: 2.2 });
    if (o.lamp != null) {
      const lx = cx + rx * 0.78, ly = cy - ry * 0.56;
      const lampT = M.mul(T, M.about(-0.12, lx, ly));
      K.form(ctx, M.all(lampT, L.rrectPts(lx - 30, ly - 24, 58, 46, 12, 6)), { fill: c.brass, deep: c.brassDeep, width: 6, seed: sd('lamp'), boil: B, spacing: 6, hatchW: 2.2, hatchAlpha: 0.8 });
      const g = M.ap(lampT, [lx + 30, ly - 1]);
      if (o.lamp > 0) {
        const glow = ctx.createRadialGradient(g[0], g[1], 4, g[0], g[1], 90);
        glow.addColorStop(0, L.rgba(c.glass, 0.55 * o.lamp));
        glow.addColorStop(1, L.rgba(c.glass, 0));
        ctx.save();
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(g[0], g[1], 90, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      K.form(ctx, M.all(lampT, L.ellipsePts(lx + 30, ly - 1, 11, 21, 20)), { fill: o.lamp > 0 ? c.glass : L.mix(c.glass, c.brassDeep, 0.5), width: 4.5, seed: sd('glass'), boil: B, shade: 0 });
    }
  };

  /** Goggles resting on a hat: two round lenses in brass rims on a strap. */
  K.goggles = (ctx, T, x, y, r, o) => {
    const B = o.boil, sd = (k) => (o.seed + L.hash(k)) & 0x7fffffff;
    K.line(ctx, M.all(T, [[x - r * 3.4, y + r * 0.35], [x - r * 1.9, y + r * 0.1]]), { width: r * 0.55, color: o.strap || '#3B2A20', seed: sd('strap'), boil: B, taper: 0 });
    for (const k of [0, 1]) {
      const cx = x - r * 0.95 + k * r * 1.9;
      const rim = M.all(T, L.ellipsePts(cx, y, r, r * 0.92, 24));
      K.form(ctx, rim, { fill: o.brass || '#C39A55', deep: '#7E5E2E', width: 5, seed: sd('rim' + k), boil: B, shade: 0.7, spacing: 5, hatchW: 1.8 });
      const lens = M.all(T, L.ellipsePts(cx, y, r * 0.66, r * 0.6, 20));
      K.fill(ctx, lens, o.lens || '#7FA3B3');
      K.fill(ctx, M.all(T, L.ellipsePts(cx - r * 0.2, y - r * 0.22, r * 0.2, r * 0.14, 10)), P.white, 0.85);
      L.inkPath(ctx, lens, { closed: true, width: 3, seed: sd('lens' + k), boil: B, wobble: 0.3 });
    }
  };

  /** A key: bow (ring), shaft and bit; s scale, turn 0..1 for the twist in the lock. */
  K.key = (ctx, x, y, rot, s, fill, deep, B, seed, turn = 0, KEY_LEN = 70) => {
    const T = M.chain(M.tr(x, y), M.rot(rot), M.sc(s, s));
    const tw = Math.max(0.2, Math.abs(Math.cos(Math.PI * turn)));
    const bow = M.all(T, L.ellipsePts(0, 0, 16 * tw, 16, 18));
    K.form(ctx, bow, { fill, deep, width: 4, seed, boil: B, shade: 0.6, spacing: 4, hatchW: 1.6 });
    K.fill(ctx, M.all(T, L.ellipsePts(0, 0, 6 * tw, 6, 10)), P.ink);
    const shaft = M.all(T, [[14, -4], [KEY_LEN, -4], [KEY_LEN, 4], [14, 4]]);
    K.fill(ctx, shaft, fill);
    L.inkPath(ctx, shaft, { closed: true, width: 3.4, seed: seed + 1, boil: B, smooth: false, taper: 0, wobble: 0.3 });
    const bit = M.all(T, [[KEY_LEN - 22, 4], [KEY_LEN - 22, 4 + 16 * tw], [KEY_LEN - 12, 4 + 16 * tw], [KEY_LEN - 12, 10 * tw + 4], [KEY_LEN - 4, 10 * tw + 4], [KEY_LEN - 4, 4]]);
    K.fill(ctx, bit, fill);
    L.inkPath(ctx, bit, { closed: true, width: 3.2, seed: seed + 2, boil: B, smooth: false, taper: 0, wobble: 0.3 });
  };

  // ---------------------------------------------------------------- ground
  /** A hatched ground shadow; it shrinks and fades as the pet leaves the ground. */
  K.shadow = (ctx, x, lift, halfW, boil, seed) => {
    const k = clamp(1 - lift / 320, 0.35, 1);
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
    L.inkPath(ctx, [[80, K.GROUND + 8], [1000, K.GROUND + 8]], { width: 1.5, color: P.inkFaint, alpha: 0.3, seed: 3, boil: 0, smooth: false });
  };

  // ---------------------------------------------------------------- effects (screen space, after the pet)
  const FX = (K.fx = {});
  /** A dirt heap at x on the ground. */
  FX.heap = (ctx, hx, B, seed, col) => {
    const g = K.GROUND;
    const heap = K.smooth([[hx - 115, g + 4], [hx - 76, g - 34], [hx - 12, g - 52], [hx + 58, g - 30], [hx + 96, g + 4]], 5);
    K.form(ctx, heap, { fill: col.dirt, deep: col.dirtDeep, width: 7, seed, boil: B, spacing: 8, hatchAlpha: 0.7 });
    L.stipple(ctx, heap, { spacing: 12, r: [1.6, 3], color: col.dirtDeep, alpha: 0.8, seed: seed + 1, boil: B });
  };
  /** Clods flung from o toward the back, emitted on drawings `emits` of an n-drawing loop. */
  FX.clods = (ctx, o, d, n, emits, B, seed, col, spread = 1) => {
    for (const e0 of emits) {
      for (const e of [e0 - n, e0]) {
        const age = d - e;
        if (age < 0 || age > 5) continue;
        for (let k = 0; k < 4; k++) {
          const h1 = L.h3(k, e0, seed), h2 = L.h3(k, e0, seed + 1);
          const vx = -(34 + 18 * h1) * spread, vy = -(66 + 22 * h2);
          const tt = age + 0.6;
          const cx = o[0] + vx * tt, cy = o[1] + vy * tt + 13 * tt * tt;
          if (cy > K.GROUND) continue;
          const r = 10 + 8 * L.h3(k, 5, e0);
          const clod = L.ellipsePts(cx, cy, r, r * 0.8, 10, h1 * 3 + tt);
          K.form(ctx, clod, { fill: col.dirt, deep: col.dirtDeep, width: 4.5, seed: seed + k * 7 + e0, boil: B, shade: 0.6, spacing: 5, hatchW: 2 });
        }
      }
    }
  };
  /** A four-point star. */
  FX.star = (ctx, x, y, s, B, seed, color, alpha = 1) => {
    const star = [];
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? s * 0.34 : s;
      const aa = (i / 8) * TAU - Math.PI / 2;
      star.push([x + Math.cos(aa) * rr, y + Math.sin(aa) * rr]);
    }
    K.fill(ctx, star, color || P.annYellow, alpha);
    L.inkPath(ctx, star, { closed: true, width: 3.2, alpha, seed, boil: B, smooth: false, taper: 0, wobble: 0.3 });
  };
  /** The house attention ring (overlay yellow) expanding with outExpo, and stars around it. */
  FX.burst = (ctx, c, u, B, seed, color) => {
    const r = 150 + 170 * L.ease.outExpo(u);
    L.inkPath(ctx, L.ellipsePts(c[0], c[1], r, r, 64), { closed: true, width: 5, color: color || P.annYellow, alpha: 1 - u, seed, boil: B, wobble: 1.2 });
    for (let s = 0; s < 3; s++) {
      const a = -2.3 + s * 0.9;
      const rr = 230 + 60 * u;
      FX.star(ctx, c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, (18 + 8 * s) * (1 - 0.4 * u), B, seed + s, color, 1 - u * 0.6);
    }
  };
  /** Three claw-mark crescents at O, grown by draw (0..1) and faded by alpha. */
  FX.slash = (ctx, O, draw, alpha, B, seed) => {
    if (alpha <= 0 || draw <= 0) return;
    for (let k = 0; k < 3; k++) {
      const top = [], bot = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * draw;
        const x = O[0] - 50 + k * 46 + 150 * u, y = O[1] - 150 + k * 16 + 250 * u;
        const bulge = 34 * Math.sin(Math.PI * u);
        const w = 20 * Math.sin(Math.PI * Math.min(1, u / Math.max(draw, 0.01))) * alpha;
        top.push([x + bulge + w * 0.8, y - w * 0.3]);
        bot.push([x + bulge - w * 0.8, y + w * 0.3]);
      }
      const cr = top.concat(bot.reverse());
      K.fill(ctx, cr, P.white, alpha);
      L.inkPath(ctx, cr, { closed: true, width: 5, alpha, seed: seed + k, boil: B, wobble: 0.5, taper: [4, 8] });
    }
  };
  /**
   * A bite at O: two white jaw crescents snap shut (p 0..1), then impact lines flash and fade
   * (p 1..1.6).
   */
  FX.chomp = (ctx, O, p, B, seed) => {
    if (p <= 0 || p > 1.6) return;
    const a = p <= 1 ? 1 : 1 - (p - 1) / 0.6;
    const gap = 46 * (1 - Math.min(1, p));
    for (const s of [-1, 1]) {
      const top = [], bot = [];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const x = O[0] - 60 + 120 * u;
        const y = O[1] + s * (gap + 34 * Math.sin(Math.PI * u) * 0.35 + 6);
        const w = 14 * Math.sin(Math.PI * u);
        top.push([x, y - w * 0.5]);
        bot.push([x, y + w * 0.5]);
      }
      const cr = top.concat(bot.reverse());
      K.fill(ctx, cr, P.white, a);
      L.inkPath(ctx, cr, { closed: true, width: 5, alpha: a, seed: seed + (s > 0 ? 1 : 0), boil: B, wobble: 0.4, taper: [3, 6] });
    }
    if (p >= 0.9) {
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 + 0.3;
        const r0 = 70, r1 = 70 + 40 * Math.min(1, (p - 0.9) * 3);
        K.line(ctx, [[O[0] + Math.cos(ang) * r0, O[1] + Math.sin(ang) * r0 * 0.8], [O[0] + Math.cos(ang) * r1, O[1] + Math.sin(ang) * r1 * 0.8]], { width: 6, alpha: a, seed: seed + 10 + k, boil: B, smooth: false, taper: [3, 8] });
      }
    }
  };
  /** Rising Z's for sleep; u is the loop phase. */
  FX.zzz = (ctx, c, u, B, seed) => {
    for (let k = 0; k < 3; k++) {
      const p = (u + k / 3) % 1;
      const a = sst(0, 0.15, p) * (1 - sst(0.75, 1, p));
      if (a <= 0.02) continue;
      const sz = 22 + 26 * p;
      const x = c[0] + 40 + 90 * p + 14 * Math.sin(TAU * p * 1.5), y = c[1] - 40 - 240 * p;
      const z = [[x - sz / 2, y - sz / 2], [x + sz / 2, y - sz / 2], [x - sz / 2, y + sz / 2], [x + sz / 2, y + sz / 2]];
      L.inkPath(ctx, z, { width: 5 + 3 * p, alpha: a, seed: seed + k, boil: B, smooth: false, taper: [3, 6], wobble: 0.3 });
    }
  };
  /** A gold coin (face, edge-on turns with turn 0..1). */
  FX.coin = (ctx, x, y, r, turn, B, seed, alpha = 1) => {
    const w = r * Math.max(0.18, Math.abs(Math.cos(Math.PI * turn)));
    const pts = L.ellipsePts(x, y, w, r, 24);
    K.form(ctx, pts, { fill: '#E9BC45', deep: '#9E6F1C', width: 4.5, seed, boil: B, shade: 0.8, spacing: 5, hatchW: 1.8, alpha });
    if (w > r * 0.5) K.line(ctx, L.ellipsePts(x, y, w * 0.62, r * 0.62, 18), { closed: true, width: 2.6, color: '#9E6F1C', seed: seed + 1, boil: B, taper: 0 });
  };
  /** The camp token: a brass disc stamped with a pick (the game's token currency). */
  FX.token = (ctx, x, y, r, turn, B, seed, alpha = 1) => {
    const w = r * Math.max(0.2, Math.abs(Math.cos(Math.PI * turn)));
    const deep = '#86621F';
    K.form(ctx, L.ellipsePts(x, y, w, r, 28), { fill: '#D2A546', deep, width: 4.5, seed, boil: B, shade: 0.8, spacing: 5, hatchW: 1.8, alpha, inkAlpha: alpha });
    if (w > r * 0.5) {
      K.line(ctx, L.ellipsePts(x, y, w * 0.66, r * 0.66, 18), { closed: true, width: 2.6, color: deep, alpha, seed: seed + 1, boil: B, taper: 0 });
      K.line(ctx, [[x - w * 0.35, y + r * 0.3], [x + w * 0.3, y - r * 0.3]], { width: 3.4, color: deep, alpha, seed: seed + 2, boil: B, smooth: false, taper: 0 });
      K.line(ctx, [[x - w * 0.05, y - r * 0.42], [x + w * 0.4, y - r * 0.12], [x + w * 0.5, y + r * 0.1]], { width: 3.4, color: deep, alpha, seed: seed + 3, boil: B, taper: 0 });
    }
    K.fill(ctx, L.ellipsePts(x - w * 0.4, y - r * 0.45, w * 0.18, r * 0.14, 10), '#FFF1C4', 0.9 * alpha);
  };
  /** Coins popping up from o and falling, emitted on `emits`. */
  FX.coins = (ctx, o, d, n, emits, B, seed) => {
    for (const e0 of emits) {
      for (const e of [e0 - n, e0]) {
        const age = d - e;
        if (age < 0 || age > 5) continue;
        for (let k = 0; k < 3; k++) {
          const h1 = L.h3(k, e0, seed), h2 = L.h3(k, e0, seed + 1);
          const tt = age + 0.5;
          const x = o[0] + (k - 1) * 40 * tt * 0.5 + (h1 - 0.5) * 30, y = o[1] - (70 + 20 * h2) * tt + 12 * tt * tt;
          FX.coin(ctx, x, y, 22, (age + k) / 4, B, seed + k * 13 + e0, 1 - sst(4, 5.5, age));
        }
      }
    }
  };
  /** A small puff of dust (a ring of soft ink curls) at o with size s and phase u 0..1. */
  FX.dust = (ctx, o, s, u, B, seed) => {
    if (u <= 0 || u >= 1) return;
    const a = 1 - u;
    for (let k = 0; k < 5; k++) {
      const ang = Math.PI + (k - 2) * 0.45;
      const r = s * (0.5 + u);
      const cx = o[0] + Math.cos(ang) * r, cy = o[1] + Math.sin(ang) * r * 0.5 - 10 * u;
      const rr = s * 0.35 * (0.6 + u);
      L.inkPath(ctx, L.ellipsePts(cx, cy, rr, rr * 0.8, 16), { closed: true, width: 4, alpha: a * 0.8, color: P.inkSoft, seed: seed + k, boil: B, wobble: 0.6 });
    }
  };
  /** Speed lines behind a dashing pet. */
  FX.speed = (ctx, o, len, alpha, B, seed) => {
    for (let k = 0; k < 4; k++) {
      const y = o[1] - 60 + k * 42;
      const x = o[0] - (k % 2) * 40;
      K.line(ctx, [[x, y], [x - len * (0.7 + 0.3 * L.h3(k, 3, seed)), y]], { width: 5, alpha, color: P.inkSoft, seed: seed + k, boil: B, taper: [4, 30], smooth: false });
    }
  };
  /**
   * A flame standing on (x, y): a round base and n tongues licking up, in three layers (outer,
   * middle, core). ph shifts the tongues (pass the drawing number), so it flickers on twos.
   */
  FX.flame = (ctx, x, y, w, h, ph, B, seed, o = {}) => {
    const cols = o.colors || ['#D8402A', '#F28A2C', '#FFE08A'];
    const n = o.tongues || 3;
    const shape = (k) => {
      const ww = w * k, hh = h * k;
      const pts = [];
      // the round base, left to right under the flame
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI - (i / 6) * Math.PI;
        pts.push([x + Math.cos(a) * ww * 0.5, y - hh * 0.22 + Math.sin(a) * hh * 0.22]);
      }
      // tongues, right to left along the top
      for (let t = n - 1; t >= 0; t--) {
        const u = n === 1 ? 0.5 : t / (n - 1);
        const cx = x + (u - 0.5) * ww * 0.7;
        const tall = 0.72 + 0.28 * Math.sin(Math.PI * u) + 0.16 * L.noise1(ph * 0.9 + t * 3.1, seed);
        const lean = 0.18 * ww * L.noise1(ph * 0.7 + t * 1.7, seed + 7);
        pts.push([cx + ww * 0.16, y - hh * 0.42]);
        pts.push([cx + lean, y - hh * tall]);
        if (t > 0) pts.push([cx - ww * 0.12, y - hh * 0.5]);
      }
      pts.push([x - ww * 0.5, y - hh * 0.3]);
      return K.smooth(pts, 4);
    };
    const a = o.alpha == null ? 1 : o.alpha;
    const outer = shape(1);
    K.fill(ctx, outer, cols[0], a);
    K.fill(ctx, shape(0.72).map(([px, py]) => [px, py + h * 0.06]), cols[1], a);
    K.fill(ctx, shape(0.42).map(([px, py]) => [px, py + h * 0.14]), cols[2], a);
    if (o.ink !== false) L.inkPath(ctx, outer, { closed: true, width: o.width || 5, alpha: a, seed, boil: B, wobble: 0.8, taper: [4, 8] });
  };
  /** Embers drifting up from c (fire pets), phase u of the loop. */
  FX.embers = (ctx, c, spread, u, B, seed, colors) => {
    for (let k = 0; k < 7; k++) {
      const p = (u + L.h3(k, 1, seed)) % 1;
      const x = c[0] + (L.h3(k, 2, seed) - 0.5) * spread + 16 * Math.sin(TAU * (p + k * 0.2));
      const y = c[1] - 220 * p;
      const r = (5 + 5 * L.h3(k, 3, seed)) * (1 - p * 0.6);
      K.fill(ctx, L.ellipsePts(x, y, r * 1.8, r * 1.8, 12), colors[2], 0.35 * (1 - p));
      K.fill(ctx, L.ellipsePts(x, y, r, r, 10), colors[k % 2], 1 - p);
    }
  };

  // ---------------------------------------------------------------- scenes
  /** Register the scene '<pet>-<anim>' (call from the scene file, so it owns the registration). */
  K.scene = (petId, anim) =>
    FILM.scene({
      id: `${petId}-${anim}`,
      draw(ctx, t) {
        const A = K.ANIMS[anim];
        const d = K.drawing(t, A);
        const def = K.defs[petId];
        K.stage(ctx, def.stripe);
        def.draw(ctx, anim, d, A);
      },
    });
})();
