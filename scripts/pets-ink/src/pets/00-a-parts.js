// pets/00-a-parts.js : parts shared by every rig kit: the fur body with its outline and tufts, the
// face (eye, mouth, whiskers, nose), ears, a tail, and the shared effects of happy, attack and
// sleep. A rig passes R = { S (the spec), pose, Mb (body), Mh (head), body (skinned outline),
// center }, and the spec's hooks draw the pet's own kit at the right layers.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const clamp = L.clamp, lerp = L.lerp;

  const sdOf = (S) => (...k) => L.hash(S.id, ...k) & 0x7fffffff;

  function tail(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), T = S.tail;
    if (!T) return;
    const pts = [];
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const a = Math.PI + T.lift - R.pose.tail * u - T.curl * u * u;
      pts.push([T.base[0] + Math.cos(a) * T.len * u, T.base[1] + Math.sin(a) * T.len * u - T.rise * u * u]);
    }
    const w0 = T.width || ((u) => lerp(T.w0, T.w1, u) * (T.bushy ? Math.sin(Math.PI * clamp(0.15 + u * 0.85)) + 0.3 : 1));
    // a round tip: the last stretch closes on a quarter circle instead of a sawn-off end
    const w = (u) => w0(u) * (u > 0.86 ? Math.sqrt(Math.max(0.02, 1 - ((u - 0.86) / 0.14) ** 2)) : 1);
    const cpts = K.curve(pts, 5);
    const rib = M.all(R.Mb, K.ribbonPts(cpts, w));
    K.form(ctx, rib, {
      fill: T.fill || C.skin,
      deep: T.deep || C.skinDeep,
      width: T.ink || 5.5,
      seed: sd('tail'),
      boil: B,
      shade: 0.6,
      spacing: 8,
      hatchW: 2.2,
      after: T.tip
        ? (c2, pp) =>
            K.clip(c2, pp, () => {
              // a coloured tip (the fox's white brush): the last stretch of the tail, overdrawn
              const k0 = Math.floor(cpts.length * (1 - T.tipLen));
              const sub = cpts.slice(k0);
              const tipRib = M.all(R.Mb, K.ribbonPts(sub, (u) => w(1 - T.tipLen + u * T.tipLen) * 1.2));
              K.fill(c2, tipRib, T.tip);
              const edge = [];
              for (let i = 0; i <= 8; i++) {
                const q = sub[0], nb = sub[1];
                const tx = nb[0] - q[0], ty = nb[1] - q[1], tl = Math.hypot(tx, ty) || 1;
                const ww = w(1 - T.tipLen) * 0.5;
                const v = (i / 8) * 2 - 1;
                edge.push([q[0] - (ty / tl) * ww * v + (tx / tl) * 10 * Math.sin(v * 3.1), q[1] + (tx / tl) * ww * v + (ty / tl) * 10 * Math.sin(v * 3.1)]);
              }
              K.line(c2, M.all(R.Mb, edge), { width: 3.6, color: P.inkSoft, seed: sd('tipEdge'), boil: B });
            })
        : null,
      inside: T.rings
        ? (c2, pp) =>
            K.clip(c2, pp, () => {
              for (let k = 1; k <= T.rings; k++) {
                const u = k / (T.rings + 1);
                const a = Math.PI + T.lift - R.pose.tail * u - T.curl * u * u;
                const c = M.ap(R.Mb, [T.base[0] + Math.cos(a) * T.len * u, T.base[1] + Math.sin(a) * T.len * u - T.rise * u * u]);
                K.fill(c2, L.ellipsePts(c[0], c[1], 13, 60, 16, a + R.pose.lean), T.ringCol);
              }
            })
        : null,
    });
  }

  function ear(ctx, R, e, far, B) {
    const S = R.S, sd = sdOf(S);
    const T = M.mul(R.Mh, M.about(e.flop * R.pose.ear, e.at[0], e.at[1]));
    const outer = M.all(T, K.smooth(e.pts, 5));
    K.form(ctx, outer, {
      fill: K.far(e.fill, far),
      deep: e.deep,
      width: far ? 6 : 7,
      seed: sd('ear', far ? 'f' : 'n'),
      boil: B,
      shade: 0.6,
      spacing: 9,
      after: e.inner
        ? (c2) => {
            const inner = M.all(T, K.smooth(e.inner, 5));
            K.fill(c2, inner, K.far(e.innerFill, far));
            L.inkPath(c2, inner, { closed: true, width: 3.5, color: P.inkSoft, seed: sd('eari', far ? 'f' : 'n'), boil: B, wobble: 0.3 });
          }
        : null,
    });
  }

  function body(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S);
    const pts = R.body;
    const c = R.center;
    const shade = K.shadeOf(c);
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
        K.clip(c2, pts, () => {
          if (S.chest) K.fill(c2, M.all(R.Mb, L.ellipsePts(S.chest[0], S.chest[1], S.chest[2], S.chest[3], 32, S.chest[4] || 0)), C.chest);
          if (S.hooks.body) S.hooks.body(c2, R, B, pts);
        });
        if (S.fur !== false) {
          L.hatch(c2, pts, { angle: -1.2, spacing: 17, length: [9, 18], gap: [10, 24], width: 2.6, color: C.furLit, alpha: 0.7, density: (x, y) => 1 - shade(x, y), clip: true, inset: 12, overshoot: 0, seed: sd('flk1'), boil: B });
          L.stipple(c2, pts, { spacing: 15, r: [1.4, 2.6], color: C.furDeep, alpha: 0.7, density: (x, y) => 0.3 + 0.7 * shade(x, y), seed: sd('stp'), boil: B });
        }
      },
      after(c2) {
        if (S.hooks.bodyAfter) S.hooks.bodyAfter(c2, R, B, pts);
      },
    });
    if (S.tufts !== false) tufts(ctx, R, pts, B);
  }

  // short fur tufts that break the back and crown outline
  function tufts(ctx, R, pts0, B) {
    const S = R.S, sd = sdOf(S);
    // a fixed stretch of the outline (control points a..b) when the spec names one: tufts then stay
    // on the mane however the head turns; otherwise wherever the outline faces up or back
    const ranged = !!S.tuftRange;
    const pts = ranged ? K.curve(R.ctrl.slice(S.tuftRange[0], S.tuftRange[1] + 1), 5) : pts0;
    const n = pts.length;
    let acc = 0;
    const maxX = M.ap(R.Mh, [S.tuftMaxX == null ? 150 : S.tuftMaxX, 0])[0];
    // tufts only above this body-space height (a ragged hem at the feet reads as a torn skirt)
    const minY = S.tuftBelow == null ? Infinity : M.ap(R.Mb, [0, S.tuftBelow])[1];
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc < 30) continue;
      acc = 0;
      const tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      if (!ranged && !(ny < -0.25 || nx < -0.55)) continue;
      if (!ranged && (b[0] > maxX || b[1] > minY)) continue;
      const h = L.h3(i, 7, sd('tuft'));
      const len = 13 + 9 * h;
      const back = [b[0] - (tx / tl) * 12, b[1] - (ty / tl) * 12];
      const tip = [b[0] + nx * len - (tx / tl) * 7, b[1] + ny * len - (ty / tl) * 7];
      const fwd = [b[0] + (tx / tl) * 4, b[1] + (ty / tl) * 4];
      K.fill(ctx, [back, tip, fwd, [b[0] - nx * 6, b[1] - ny * 6]], S.colors.fur);
      L.inkPath(ctx, [back, tip, fwd], { width: 5, seed: sd('tuft', i), boil: B, wobble: 0.4, tremble: 0.2, taper: [4, 6], smooth: false });
    }
  }

  function face(ctx, R, B) {
    const S = R.S, C = S.colors, sd = sdOf(S), pose = R.pose, F = S.face;
    const H = R.Mh;
    if (F.blush) L.stipple(ctx, M.all(H, L.ellipsePts(F.blush[0], F.blush[1], 28, 17, 24)), { spacing: 7, r: [1.6, 2.8], color: C.blush || C.skinDeep, alpha: 0.75, seed: sd('blush'), boil: B });
    if (S.hooks.face) S.hooks.face(ctx, R, B);
    const E = F.eye;
    K.eye(ctx, H, E.x, E.y, { r: E.r, style: E.style, iris: E.iris, slit: E.slit, look: E.look, lid: pose.eyeMode === 'happy' ? 0 : E.lid, lidColor: E.lidColor || C.fur, mode: pose.eyeMode, open: pose.eye, color: C.eye, lineColor: C.eyeLine }, B, sd('eye'));
    // mouth
    const m = F.mouth;
    if (pose.mouth > 0.3) {
      const o = pose.mouth;
      const mouth = M.all(H, K.smooth([m[0], [m[1][0], m[1][1] + 6 * o], [m[2][0], m[2][1] + 8 * o], [m[2][0] - 12, m[2][1] - 2]], 4));
      K.fill(ctx, mouth, C.mouth || '#6E2A26');
      K.fill(ctx, M.all(H, L.ellipsePts((m[1][0] + m[2][0]) / 2, m[2][1] + 3 + 5 * o, 12, 6, 16)), C.tongue || '#E88E86');
      L.inkPath(ctx, mouth, { closed: true, width: 4.2, seed: sd('mouthO'), boil: B, wobble: 0.3 });
      if (F.tongue && o > 0.5 && pose.tongue !== 0) {
        // a dog's tongue lolling out of the side of the mouth
        const tx = lerp(m[1][0], m[2][0], 0.4), ty = lerp(m[1][1], m[2][1], 0.4) + 8 * o;
        const tl = F.tongue * o;
        const tongue = M.all(H, K.smooth([[tx - 16, ty - 4], [tx + 14, ty - 4], [tx + 16, ty + tl * 0.7], [tx + 2, ty + tl], [tx - 14, ty + tl * 0.8]], 4));
        K.form(ctx, tongue, { fill: C.tongue || '#E88E86', deep: C.skinDeep || '#C27466', width: 4.5, seed: sd('tongue'), boil: B, shade: 0.7, spacing: 5, hatchW: 1.8 });
        K.line(ctx, M.all(H, [[tx, ty + 2], [tx + 1, ty + tl * 0.6]]), { width: 2.6, color: C.skinDeep || '#C27466', seed: sd('tongueL'), boil: B, taper: [2, 4] });
      }
    } else if (pose.mouth < 0 && F.fangs) {
      // bared fangs: a dark gape under the snout with two long canines
      const o = -pose.mouth;
      const gape = M.all(H, K.smooth([m[0], [m[1][0], m[1][1] + 10 * o], [m[2][0], m[2][1] + 12 * o], [m[2][0] - 14, m[2][1] - 2]], 4));
      K.fill(ctx, gape, C.mouth || '#5E2220');
      for (const t of [0.22, 0.62]) {
        const tx = lerp(m[0][0], m[2][0], t), ty = lerp(m[0][1], m[2][1], t);
        const fang = M.all(H, [[tx - 7, ty - 2], [tx + 7, ty - 2], [tx + 1, ty + 22 * F.fangs]]);
        K.fill(ctx, fang, P.white);
        L.inkPath(ctx, fang, { closed: true, width: 2.8, seed: sd('fang', t), boil: B, wobble: 0.2, smooth: false, taper: 0 });
      }
      L.inkPath(ctx, gape, { closed: true, width: 4.4, seed: sd('gape'), boil: B, wobble: 0.3 });
    } else if (pose.mouth < 0) {
      for (let k = 0; k < 2; k++) {
        const tx = lerp(m[0][0], m[2][0], 0.3 + k * 0.2), ty = lerp(m[0][1], m[2][1], 0.3 + k * 0.2);
        const tooth = M.all(H, [[tx - 5, ty], [tx + 5, ty], [tx + 3, ty + 15], [tx - 4, ty + 15]]);
        K.fill(ctx, tooth, P.white);
        L.inkPath(ctx, tooth, { closed: true, width: 2.6, seed: sd('tooth', k), boil: B, wobble: 0.2, smooth: false, taper: 0 });
      }
      K.line(ctx, M.all(H, m), { width: 4.4, seed: sd('mouthT'), boil: B });
    } else {
      K.line(ctx, M.all(H, m), { width: 4.2, color: P.inkSoft, seed: sd('mouth'), boil: B });
    }
    if (F.whiskers) {
      const w = F.whiskers;
      for (let k = 0; k < 3; k++) {
        const a = -0.55 + k * 0.42;
        const tip = [w[0] + Math.cos(a) * w[2], w[1] + Math.sin(a) * w[2] - 6];
        K.line(ctx, M.all(H, [[w[0], w[1]], [lerp(w[0], tip[0], 0.5), lerp(w[1], tip[1], 0.5) - 4], tip]), { width: 2.4, alpha: 0.85, seed: sd('wh', k), boil: B, taper: [2, 18] });
      }
    }
    // nose (twitches up)
    const N0 = F.nose;
    const nz = pose.nose;
    const N = M.chain(H, M.tr(0, -7 * nz), M.about(-0.25 * nz, N0.x - 10, N0.y));
    const nose = M.all(N, L.ellipsePts(N0.x, N0.y, N0.rx, N0.ry, 28, -0.2));
    K.form(ctx, nose, { fill: C.nose || C.skin, deep: C.noseDeep || C.skinDeep, width: 6, seed: sd('nose'), boil: B, shade: 1, spacing: 6, hatchW: 2.2, hatchAlpha: 0.8 });
    K.fill(ctx, M.all(N, L.ellipsePts(N0.x + N0.rx * 0.5, N0.y + N0.ry * 0.3, 4.5, 3.5, 12, -0.2)), P.ink);
    K.fill(ctx, M.all(N, L.ellipsePts(N0.x - N0.rx * 0.3, N0.y - N0.ry * 0.45, N0.rx * 0.24, N0.ry * 0.2, 12, -0.3)), P.white, 0.8);
  }

  function effects(ctx, R, B) {
    const S = R.S, sd = sdOf(S), fx = R.pose.fx;
    if (!fx) return;
    if (fx.kind === 'burst') {
      if (fx.k >= 2 && fx.k <= 6) K.fx.burst(ctx, M.ap(R.Mh, [S.neck[0] - 50, S.neck[1] - 70]), (fx.k - 2) / 4, B, sd('burst'));
    } else if (fx.kind === 'slash') {
      const p = fx.p;
      K.fx.slash(ctx, M.ap(R.Mr, S.slashAt || [200, -270]), clamp(p), p <= 1 ? 1 : clamp(1 - (p - 1) / 1.2), B, sd('slash'));
    } else if (fx.kind === 'chomp') {
      K.fx.chomp(ctx, M.ap(R.Mh, [S.face.nose.x + 70, S.face.nose.y + 30]), fx.p, B, sd('chomp'));
    } else if (fx.kind === 'zzz') {
      K.fx.zzz(ctx, M.ap(R.Mh, [S.face.nose.x - 60, S.face.nose.y - 60]), fx.u, B, sd('z'));
    }
    if (S.hooks.fx) S.hooks.fx(ctx, R, B);
  }

  K.parts = { sdOf, tail, ear, body, tufts, face, effects };
})();
