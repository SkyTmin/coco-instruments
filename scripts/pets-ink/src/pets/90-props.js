// pets/90-props.js : props in the pets' ink style (v2.74) — the chests and the eggs.
//
// CHESTS are drawn from a 3D model: the box, the half-barrel lid, iron bands, corner caps, the
// lock. Every face is projected with the same camera as the old 3D render (turned -0.55, tipped
// 0.42, a 22° lens), so the keyhole lands exactly where the game's CSS expects it (38.5% · 61.7%
// of the square) and the spinning strip of the dark chest is a real turn, not a flat card. Faces
// are sorted back to front and filled flat by their light (from the upper left), hatched in the
// shade and outlined in ink; bands, planks, rivets and the lock are drawn on their face, clipped.
//
// EGGS are drawn flat: an egg shape lit like the pets (K.cel) with its pattern inside — moss and a
// sprout, stone with amethysts, crystal facets, dragon scales with glowing seams.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const clamp = L.clamp, lerp = L.lerp;
  const TAU = Math.PI * 2;
  const sd = (...k) => L.hash('props', ...k) & 0x7fffffff;

  // ---------------------------------------------------------------- chests
  const TIERS = {
    common: { wood: '#9A6A3E', band: '#70757B', corner: '#62666C', lock: '#C08A48', gem: null, glow: '#FFCF7A', grain: 1 },
    rare: { wood: '#5E3B22', band: '#6E8EB8', corner: '#D6DEE8', lock: '#D8E0EA', gem: '#3F7BFF', glow: '#8CC4FF', grain: 0.8 },
    epic: { wood: '#4E2280', band: '#E3B44A', corner: '#E3B44A', lock: '#EABD52', gem: '#B35CFF', glow: '#D49CFF', grain: 0.3, lacquer: 1 },
    legend: { wood: '#8E1626', band: '#FFC53D', corner: '#FFC53D', lock: '#FFCF4A', gem: '#FF2E4A', glow: '#FFD978', grain: 0.25, lacquer: 1, vyaz: '#FFD98A', wideBand: 1 },
    mystery: { wood: '#3E3A46', band: '#58555F', corner: '#64606C', lock: '#716D7A', gem: null, glow: '#C9B8FF', grain: 0.6, hole: '#D9CCFF' },
  };
  const W = 1.22, H = 0.6, D = 0.78, R = D / 2;
  const LIGHT = (() => {
    const l = [-0.55, 0.75, 0.62];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
  })();

  function camera(S, yaw) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(0.42), sp = Math.sin(0.42);
    const tf = Math.tan((11 * Math.PI) / 180);
    const dist = 1.1 / tf;
    const rot = ([x, y, z]) => {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
    const view = (p) => {
      const r = rot(p);
      return [r[0], r[1] - 0.5, r[2] - dist];
    };
    const proj = (v) => [((v[0] / -v[2] / tf + 1) / 2) * S, ((1 - v[1] / -v[2] / tf) / 2) * S];
    return { rot, view, proj, P: (p) => proj(view(p)), S };
  }

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const shade = (hex, k) => (k >= 0 ? L.mix(hex, '#FFF4E0', k) : L.mix(hex, '#1C1018', -k));

  /** A flat face: origin o, axes U (width w) and V (height h), normal n; deco(ctx, at) paints on it. */
  function plane(o, U, V, w, h, n, fill, deco) {
    const at = (u, v) => add(add(o, mul(U, u)), mul(V, v));
    return { pts: [at(0, 0), at(w, 0), at(w, h), at(0, h)], n, fill, at, w, h, deco };
  }

  function lightOf(C, n) {
    return clamp(dot(C.rot(n), LIGHT));
  }

  function drawFace(ctx, C, f, B, seed, o = {}) {
    const pp = f.pts.map(C.P);
    const lit = o.lit != null ? o.lit : lightOf(C, f.n);
    const fill = shade(f.fill, (lit - 0.45) * 0.7);
    K.fill(ctx, pp, fill);
    K.clip(ctx, pp, () => {
      if (f.deco) f.deco(ctx, (u, v) => C.P(f.at(u, v)), lit);
      if (lit < 0.5 && o.hatch !== 0)
        L.hatch(ctx, pp, { angle: -Math.PI / 4, spacing: 9, width: 2, color: '#1A1016', alpha: 0.35, density: (0.5 - lit) * 1.6, length: [14, 34], gap: [4, 10], clip: true, seed, boil: B });
    });
    L.inkPath(ctx, pp, { closed: true, width: o.ink || 7, seed, boil: B, wobble: 0.6, taper: [3, 6], smooth: false });
  }

  /** A strip of metal on a face between (u0, v0) and (u1, v1) of its plane, with rivets. */
  function metal(ctx, at, u0, v0, u1, v1, col, lit, B, seed, rivets = 0) {
    const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    K.fill(ctx, pts, shade(col, (lit - 0.4) * 0.8));
    // a bright edge along the top of the strip
    K.line(ctx, [at(u0, v1), at(u1, v1)], { width: 3, color: shade(col, 0.55), seed: seed + 2, boil: B, smooth: false, taper: 0 });
    L.inkPath(ctx, pts, { closed: true, width: 3.6, seed, boil: B, wobble: 0.4, smooth: false, taper: 0 });
    for (let k = 0; k < rivets; k++) {
      const c = at(lerp(u0, u1, 0.5), lerp(v0, v1, (k + 0.5) / rivets));
      K.fill(ctx, L.ellipsePts(c[0], c[1], 6, 6, 10), shade(col, 0.4));
      K.fill(ctx, L.ellipsePts(c[0] - 1.5, c[1] - 2, 2.4, 2, 6), '#FFFFFF', 0.8);
      L.inkPath(ctx, L.ellipsePts(c[0], c[1], 6, 6, 10), { closed: true, width: 2.2, seed: seed + 5 + k, boil: B, wobble: 0.2 });
    }
  }

  function gemAt(ctx, c, r, col, B, seed) {
    const g = [[c[0], c[1] - r * 1.2], [c[0] + r, c[1]], [c[0], c[1] + r * 1.2], [c[0] - r, c[1]]];
    K.fill(ctx, g, col);
    K.fill(ctx, [g[0], g[1], [c[0], c[1]]], L.mix(col, '#FFFFFF', 0.45));
    K.fill(ctx, [g[2], g[3], [c[0], c[1]]], L.mix(col, '#000000', 0.3));
    K.fill(ctx, L.ellipsePts(c[0] - r * 0.3, c[1] - r * 0.4, r * 0.22, r * 0.16, 8), '#FFFFFF', 0.9);
    L.inkPath(ctx, g, { closed: true, width: 3, seed, boil: B, smooth: false, taper: 0 });
  }

  /** Planks and grain on a wooden face: n planks along u (horizontal boards). */
  function planks(ctx, at, w, h, n, T, lit, B, seed) {
    for (let k = 1; k < n; k++) K.line(ctx, [at(0, (k / n) * h), at(w, (k / n) * h)], { width: 4, color: shade(T.wood, -0.55), seed: seed + k, boil: B, smooth: false, taper: 0 });
    const grain = Math.round(18 * T.grain);
    for (let i = 0; i < grain; i++) {
      const v = (L.h3(i, 1, seed) * n | 0) / n * h + (0.2 + 0.6 * L.h3(i, 2, seed)) * (h / n);
      const u0 = L.h3(i, 3, seed) * w * 0.8;
      K.line(ctx, [at(u0, v), at(u0 + w * (0.1 + 0.2 * L.h3(i, 4, seed)), v)], { width: 2, color: shade(T.wood, -0.35), alpha: 0.7, seed: seed + 20 + i, boil: B, smooth: false, taper: [2, 2] });
    }
  }

  function bodyFaces(T, open) {
    const faces = [];
    const woodDeco = (w, isFront, isSide) => (ctx, at, lit) => {
      planks(ctx, at, w, H, 4, T, lit, 0, sd('pl', w, isFront ? 1 : 0));
      const bw = T.wideBand ? 0.12 : 0.09;
      if (!isSide) for (const x of [-0.36, 0.36]) metal(ctx, at, w / 2 + x - bw / 2, 0, w / 2 + x + bw / 2, H, T.band, lit, 0, sd('vb', x, isFront ? 1 : 0), 3);
      metal(ctx, at, 0, 0, w, 0.07, T.band, lit, 0, sd('belt', w));
      metal(ctx, at, 0, H - 0.05, w, H, T.band, lit, 0, sd('rim', w));
      metal(ctx, at, 0, 0, 0.06, H, T.corner, lit, 0, sd('c0', w));
      metal(ctx, at, w - 0.06, 0, w, H, T.corner, lit, 0, sd('c1', w));
      if (T.gem && isFront) for (const u of [0.03, w - 0.03]) gemAt(ctx, at(u, H * 0.5), 9, T.gem, 0, sd('cg', u));
    };
    faces.push(plane([-W / 2, 0, D / 2], [1, 0, 0], [0, 1, 0], W, H, [0, 0, 1], T.wood, woodDeco(W, true, false)));
    faces.push(plane([W / 2, 0, D / 2], [0, 0, -1], [0, 1, 0], D, H, [1, 0, 0], T.wood, woodDeco(D, false, true)));
    faces.push(plane([W / 2, 0, -D / 2], [-1, 0, 0], [0, 1, 0], W, H, [0, 0, -1], T.wood, woodDeco(W, false, false)));
    faces.push(plane([-W / 2, 0, -D / 2], [0, 0, 1], [0, 1, 0], D, H, [-1, 0, 0], T.wood, woodDeco(D, false, true)));
    void open;
    return faces;
  }

  // the lid: strips of the half barrel, t from 0 (front edge) to π (back edge), hinged at the back
  function lidPoint(t, x, a) {
    const y = R * Math.sin(t), z = R * Math.cos(t) + R; // relative to the hinge (y = H, z = -R)
    const ca = Math.cos(a), sa = Math.sin(a);
    return [x, H + y * ca + z * sa, -R + -y * sa + z * ca];
  }
  function lidNormal(t, a) {
    const y = Math.sin(t), z = Math.cos(t);
    const ca = Math.cos(a), sa = Math.sin(a);
    return [0, y * ca + z * sa, -y * sa + z * ca];
  }

  function lidFaces(T, a) {
    const faces = [];
    const N = 8;
    const bw = T.wideBand ? 0.12 : 0.09;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI, t1 = ((i + 1) / N) * Math.PI;
      const tm = (t0 + t1) / 2;
      const at = (u, v) => lidPoint(lerp(t0, t1, v), -W / 2 + u, a);
      const f = { pts: [at(0, 0), at(W, 0), at(W, 1), at(0, 1)], n: lidNormal(tm, a), fill: T.wood, at, strip: i, lid: true };
      f.deco = (ctx, at2, lit) => {
        const grain = Math.round(3 * T.grain);
        for (let g = 0; g < grain; g++) {
          const v = 0.25 + 0.5 * L.h3(i, g, 7);
          const u0 = W * L.h3(i, g, 8) * 0.8;
          K.line(ctx, [at2(u0, v), at2(u0 + 0.2, v)], { width: 2, color: shade(T.wood, -0.35), alpha: 0.7, seed: sd('lg', i, g), boil: 0, smooth: false, taper: [2, 2] });
        }
        for (const x of [-0.36, 0.36]) metal(ctx, at2, W / 2 + x - bw / 2, 0, W / 2 + x + bw / 2, 1, T.band, lit, 0, sd('lb', i, x), i % 2 ? 1 : 0);
        metal(ctx, at2, 0, 0, 0.06, 1, T.corner, lit, 0, sd('lc0', i));
        metal(ctx, at2, W - 0.06, 0, W, 1, T.corner, lit, 0, sd('lc1', i));
        if (i === 0) metal(ctx, at2, 0, 0, W, 0.35, T.band, lit, 0, sd('lrim'));
        if (T.vyaz && (i === 2 || i === 5)) {
          // a gold filigree wave along the lid, set with diamond studs
          const wave = [];
          for (let k = 0; k <= 24; k++) wave.push(at2(0.08 + (k / 24) * (W - 0.16), 0.5 + 0.28 * Math.sin(k * 1.3)));
          K.line(ctx, wave, { width: 3.4, color: T.vyaz, seed: sd('vz', i), boil: 0, taper: [2, 2] });
        }
        if (T.vyaz && (i === 3 || i === 4)) for (const cu of [0.18, W / 2, W - 0.18]) gemAt(ctx, at2(cu, 0.5), 7, T.vyaz, 0, sd('vs', i, cu));
      };
      faces.push(f);
    }
    // the end caps of the barrel
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 12; k++) pts.push(lidPoint((k / 12) * Math.PI, (s * W) / 2, a));
      const n = [s, 0, 0];
      faces.push({ pts, n, fill: T.wood, cap: true, deco: null, arc: pts });
    }
    return faces;
  }

  function drawChest(ctx, S, tier, o = {}) {
    const T = TIERS[tier];
    const yaw = o.yaw == null ? -0.55 : o.yaw;
    const open = !!o.open;
    const C = camera(S, yaw);
    const a = open ? 1.95 : 0;
    const B = o.boil || 0;
    const eye = [0, 0, 0];
    const facing = (f) => {
      const cen = f.pts.reduce((s, p) => add(s, p), [0, 0, 0]).map((v) => v / f.pts.length);
      const v = C.view(cen);
      const n = C.rot(f.n);
      return { z: v[2], vis: dot(n, mul(v, -1)) > 0, cen };
    };
    void eye;
    const body = bodyFaces(T, open);
    const lid = lidFaces(T, a);
    // no floor shadow: the game's scenes lay their own floor under the chest
    const draw = (f, i) => {
      const inf = facing(f);
      if (f.lid && !inf.vis) {
        // the inside of the open lid: dark wood, no bands
        const pp = f.pts.map(C.P);
        K.fill(ctx, pp, shade(T.wood, -0.5));
        L.inkPath(ctx, pp, { closed: true, width: 4, seed: sd('li', i), boil: B, smooth: false, taper: 0, wobble: 0.4 });
        return;
      }
      if (!inf.vis) return;
      if (f.cap) {
        const pp = f.pts.map(C.P);
        const lit = lightOf(C, f.n);
        K.fill(ctx, pp, shade(T.wood, (lit - 0.45) * 0.7));
        K.line(ctx, pp, { width: 16, color: shade(T.corner, (lit - 0.4) * 0.8), seed: sd('capb', i), boil: B, taper: 0, smooth: false });
        L.inkPath(ctx, pp, { closed: true, width: 7, seed: sd('cap', i), boil: B, wobble: 0.5, smooth: false, taper: [3, 6] });
        return;
      }
      drawFace(ctx, C, f, B, sd('face', i, tier));
    };
    const zOf = (f) => facing(f).z;
    if (open) {
      [...lid].sort((p, q) => zOf(p) - zOf(q)).forEach((f, i) => draw(f, 100 + i));
      interior(ctx, C, T, B);
      [...body].sort((p, q) => zOf(p) - zOf(q)).forEach((f, i) => draw(f, i));
      // the hasp hangs off the open lid's front edge, out of sight; the plate stays on the box
    } else {
      [...body, ...lid].sort((p, q) => zOf(p) - zOf(q)).forEach((f, i) => draw(f, i));
    }
    lock(ctx, C, T, B, open, yaw);
    return C;
  }

  function interior(ctx, C, T, B) {
    const t = 0.05;
    const x0 = -W / 2 + t, x1 = W / 2 - t, z0 = -D / 2 + t, z1 = D / 2 - t;
    const top = [C.P([x0, H, z0]), C.P([x1, H, z0]), C.P([x1, H, z1]), C.P([x0, H, z1])];
    K.fill(ctx, top, shade(T.wood, -0.75));
    // the far walls inside
    const back = [C.P([x0, H, z0]), C.P([x1, H, z0]), C.P([x1, H - 0.3, z0]), C.P([x0, H - 0.3, z0])];
    K.fill(ctx, back, shade(T.wood, -0.45));
    const left = [C.P([x0, H, z0]), C.P([x0, H, z1]), C.P([x0, H - 0.3, z1]), C.P([x0, H - 0.3, z0])];
    K.fill(ctx, left, shade(T.wood, -0.6));
    // the treasure: a glowing heap of coins
    const pile = [C.P([x0 + 0.04, H - 0.1, z0 + 0.1]), C.P([x1 - 0.04, H - 0.1, z0 + 0.1]), C.P([x1 - 0.04, H - 0.1, z1]), C.P([x0 + 0.04, H - 0.1, z1])];
    const c = C.P([0, H - 0.05, 0]);
    const g = ctx.createRadialGradient(c[0], c[1], 10, c[0], c[1], C.S * 0.32);
    g.addColorStop(0, L.mix(T.glow, '#FFFFFF', 0.5));
    g.addColorStop(0.5, T.glow);
    g.addColorStop(1, L.mix(T.glow, '#000000', 0.55));
    K.clip(ctx, top, () => {
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(...pile[0]);
      for (const p of pile.slice(1)) ctx.lineTo(...p);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      for (let i = 0; i < 16; i++) {
        const p = C.P([lerp(x0 + 0.1, x1 - 0.1, L.h3(i, 1, 3)), H - 0.08 + 0.05 * L.h3(i, 4, 3), lerp(z0 + 0.14, z1 - 0.04, L.h3(i, 2, 3))]);
        K.fx.coin(ctx, p[0], p[1], C.S * 0.022, 0.55 + 0.3 * L.h3(i, 3, 3), B, sd('pc', i));
      }
      if (T.gem) gemAt(ctx, C.P([0.1, H - 0.02, 0.02]), C.S * 0.022, T.gem, B, sd('pg'));
    });
    L.inkPath(ctx, top, { closed: true, width: 6, seed: sd('open'), boil: B, smooth: false, taper: 0, wobble: 0.4 });
  }

  function lock(ctx, C, T, B, open, yaw) {
    // the plate sits on the front face; skip it when the front turns away (the spin)
    if (dot(C.rot([0, 0, 1]), [0, 0, 1]) < 0.3) return;
    const z = D / 2 + 0.03;
    const at = (x, y) => C.P([x, y, z]);
    const pts = [];
    const rr = 0.03;
    const box = [[-0.11, H - 0.29], [0.11, H - 0.29], [0.11, H - 0.03], [-0.11, H - 0.03]];
    void rr;
    for (const p of box) pts.push(at(...p));
    const lit = lightOf(C, [0, 0, 1]);
    F().form(ctx, pts, shade(T.lock, (lit - 0.4) * 0.6), B, sd('lock'), { width: 5, off: 0.1, shine: 0.9, hatch: 0.3, smooth: false });
    // the hasp coming down from the lid over the plate
    if (!open) {
      const hp = [at(-0.05, H + 0.06), at(0.05, H + 0.06), at(0.05, H - 0.08), at(-0.05, H - 0.08)];
      F().form(ctx, hp, shade(T.lock, (lit - 0.5) * 0.6), B, sd('hasp'), { width: 4, off: 0.1, hatch: 0.3, rim: false, smooth: false });
    }
    // the keyhole
    const k = at(0, H - 0.15);
    const s = C.S / 512;
    const hole = T.hole || '#140C08';
    if (T.hole) {
      const g = ctx.createRadialGradient(k[0], k[1], 2, k[0], k[1], 40 * s);
      g.addColorStop(0, L.rgba(T.hole, 0.9));
      g.addColorStop(1, L.rgba(T.hole, 0));
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(k[0], k[1], 40 * s, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    K.fill(ctx, L.ellipsePts(k[0], k[1], 9 * s, 9 * s, 12), hole);
    K.fill(ctx, [[k[0] - 4 * s, k[1]], [k[0] + 4 * s, k[1]], [k[0] + 2.5 * s, k[1] + 20 * s], [k[0] - 2.5 * s, k[1] + 20 * s]], hole);
    if (T.gem) gemAt(ctx, at(0, H - 0.245), 10 * s, T.gem, B, sd('lg'));
    void yaw;
  }
  const F = () => K.front;

  // ---------------------------------------------------------------- eggs
  function eggPts(cx, cy, w, h) {
    // an egg: rounder at the bottom, narrower at the top
    const out = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * TAU;
      const s = Math.sin(t), c = Math.cos(t);
      const k = s < 0 ? 0.82 + 0.18 * (1 + s) : 1;
      out.push([cx + c * w * k, cy + s * h]);
    }
    return out;
  }

  const EGGS = {
    moss: { fill: '#EFE5C8', deep: '#B8A57A' },
    stone: { fill: '#9C968E', deep: '#5E5850' },
    crystal: { fill: '#B8D8F4', deep: '#6A7EC8' },
    dragon: { fill: '#7A1C24', deep: '#3A0A10' },
  };

  function drawEgg(ctx, S, kind) {
    const E = EGGS[kind];
    const cx = S / 2, cy = S * 0.53, w = S * 0.3, h = S * 0.4;
    const pts = eggPts(cx, cy, w, h);
    const B = 0;
    const inside = {
      moss(c2) {
        // moss grows in soft cushions: a thick band round the bottom and a few islands, each a
        // bumpy outline filled green, lighter bumps on top, darker in its folds
        const cushion = (x, y, rx, ry, n, seed, band) => {
          const out = [];
          for (let i = 0; i < n; i++) {
            const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
            for (let k = 0; k < 5; k++) {
              const t = lerp(a0, a1, k / 5);
              const bump = 1 + 0.14 * Math.sin(Math.PI * (k / 5)) * (0.7 + 0.6 * L.h3(i, 1, seed));
              out.push([x + Math.cos(t) * rx * bump, y + Math.sin(t) * ry * bump * (band && Math.sin(t) > 0 ? 1.6 : 1)]);
            }
          }
          K.fill(c2, out, '#6E9A3E');
          K.clip(c2, out, () => {
            K.fill(c2, out.map(([px, py]) => [px - rx * 0.12, py - ry * 0.18]), '#86B24C');
            for (let i = 0; i < n * 3; i++) {
              const a = L.h3(i, 2, seed) * TAU, d = Math.sqrt(L.h3(i, 3, seed));
              const px = x + Math.cos(a) * rx * d, py = y + Math.sin(a) * ry * d;
              const rr = S * (0.008 + 0.01 * L.h3(i, 4, seed));
              K.fill(c2, L.ellipsePts(px, py, rr, rr * 0.8, 8), i % 3 ? '#A8CC66' : '#4E7A2E');
            }
          });
          L.inkPath(c2, out, { closed: true, width: 4, color: '#2E4A1A', seed: seed + 50, boil: B, wobble: 0.5, taper: 0 });
        };
        cushion(cx, cy + h * 0.95, w * 1.15, h * 0.34, 16, 11, true);
        cushion(cx - w * 0.45, cy - h * 0.12, w * 0.3, h * 0.2, 9, 12);
        cushion(cx + w * 0.55, cy + h * 0.2, w * 0.24, h * 0.16, 8, 13);
        cushion(cx + w * 0.1, cy - h * 0.6, w * 0.18, h * 0.12, 7, 14);
        L.stipple(c2, pts, { spacing: S * 0.035, r: [1.2, 2.4], color: E.deep, alpha: 0.5, seed: sd('msp'), boil: B });
      },
      stone(c2) {
        L.stipple(c2, pts, { spacing: S * 0.02, r: [1.4, 3.2], color: E.deep, alpha: 0.7, seed: sd('ssp'), boil: B });
        L.stipple(c2, pts, { spacing: S * 0.035, r: [1.4, 2.6], color: '#D2CCC2', alpha: 0.7, seed: sd('ssl'), boil: B });
        // lichen spots
        for (const [x, y, r] of [[-0.5, -0.2, 0.12], [0.4, 0.4, 0.1], [0.2, -0.6, 0.07]]) K.fill(c2, L.ellipsePts(cx + x * w, cy + y * h, r * S * 0.5, r * S * 0.4, 16), '#A8B070', 0.8);
        // cracks
        for (const [pts2, k] of [[[[-0.2, -0.9], [-0.1, -0.6], [-0.25, -0.35], [-0.12, -0.1]], 0], [[[0.6, 0.2], [0.35, 0.35], [0.4, 0.6]], 1]])
          K.line(c2, pts2.map(([x, y]) => [cx + x * w, cy + y * h]), { width: 4, color: '#3E3A34', seed: sd('scr', k), boil: B, smooth: false, taper: [2, 6] });
      },
      crystal(c2) {
        // facets: a jittered grid of points over the egg, triangles filled by their light
        const cols = ['#DCEEFF', '#B8D8F4', '#9CC0EE', '#C8B8F0', '#A898E0', '#EEF6FF'];
        const grid = [];
        const nx = 6, ny = 8;
        for (let j = 0; j <= ny; j++) {
          const row = [];
          for (let i = 0; i <= nx; i++) {
            const jx = i > 0 && i < nx ? (L.h3(i, j, 5) - 0.5) * 0.5 : 0;
            const jy = j > 0 && j < ny ? (L.h3(i, j, 6) - 0.5) * 0.5 : 0;
            row.push([cx - w * 1.1 + ((i + jx) / nx) * w * 2.2, cy - h * 1.05 + ((j + jy) / ny) * h * 2.1]);
          }
          grid.push(row);
        }
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
            for (const [tri, k] of [[[a, b, c], 0], [[a, c, d], 1]]) {
              const m = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
              const l = clamp(0.6 - ((m[0] - cx) / w) * 0.35 - ((m[1] - cy) / h) * 0.35 + (L.h3(i, j, k + 9) - 0.5) * 0.5);
              K.fill(c2, tri, cols[Math.min(cols.length - 1, Math.floor(l * cols.length))]);
              L.inkPath(c2, tri, { closed: true, width: 2, color: '#F6FAFF', alpha: 0.8, seed: sd('fc', i, j, k), boil: B, smooth: false, taper: 0 });
            }
          }
        for (const [x, y, r] of [[-0.4, -0.5, 0.06], [0.3, -0.1, 0.04], [-0.1, 0.5, 0.035]]) K.fx.star(c2, cx + x * w, cy + y * h, r * S, B, sd('cs', x), '#FFFFFF');
      },
      dragon(c2) {
        // rows of scales with gold rims, and glowing seams
        const rows = 11;
        for (let j = 0; j < rows; j++) {
          const y = cy - h * 1.05 + (j / (rows - 1)) * h * 2.1;
          const n = 9;
          for (let i = -1; i <= n; i++) {
            const x = cx - w * 1.2 + ((i + (j % 2) * 0.5) / n) * w * 2.4;
            const sc = [];
            for (let k = 0; k <= 10; k++) {
              const t = Math.PI * (k / 10);
              sc.push([x + Math.cos(t) * w * 0.13, y + Math.sin(t) * h * 0.1]);
            }
            K.fill(c2, sc, L.mix(E.fill, '#FFFFFF', 0.06 * ((i + j) % 3)));
            K.line(c2, sc, { width: 3, color: '#D8A040', seed: sd('ds', i, j), boil: B, smooth: false, taper: [2, 2] });
          }
        }
        for (const [pts2, k] of [[[[-0.1, -0.95], [0.05, -0.6], [-0.08, -0.3], [0.1, 0.05], [0.0, 0.3]], 0], [[[0.1, 0.05], [0.45, 0.25], [0.55, 0.55]], 1], [[[-0.08, -0.3], [-0.45, -0.1], [-0.6, 0.2]], 2]]) {
          const p = pts2.map(([x, y]) => [cx + x * w, cy + y * h]);
          K.line(c2, p, { width: 12, color: '#FF8A2A', seed: sd('dv', k), boil: B, smooth: false, taper: [4, 8] });
          K.line(c2, p, { width: 5, color: '#FFE08A', seed: sd('dv', k), boil: B, smooth: false, taper: [4, 8] });
        }
      },
    };
    K.cel(ctx, pts, { fill: E.fill, seed: sd('egg', kind), boil: B, width: 9, off: kind === 'crystal' ? 0.02 : 0.1, shine: kind === 'dragon' || kind === 'crystal' ? 1 : 0.6, hatch: kind === 'crystal' ? 0 : 0.6, inside: inside[kind] });
    if (kind === 'moss') {
      // a sprout with two leaves on top
      const t = [cx + w * 0.05, cy - h * 0.98];
      K.line(ctx, [t, [t[0] + S * 0.01, t[1] - S * 0.08]], { width: 7, color: P.ink, seed: sd('stem'), boil: B, taper: [3, 3] });
      K.line(ctx, [t, [t[0] + S * 0.01, t[1] - S * 0.08]], { width: 4, color: '#5E8A2E', seed: sd('stem'), boil: B, taper: [3, 3] });
      for (const s of [-1, 1]) {
        const b = [t[0] + S * 0.01, t[1] - S * 0.07];
        const leaf = K.smooth([b, [b[0] + s * S * 0.04, b[1] - S * 0.04], [b[0] + s * S * 0.09, b[1] - S * 0.02], [b[0] + s * S * 0.05, b[1] + S * 0.005]], 3);
        F().form(ctx, leaf, '#7AB048', B, sd('leaf', s), { width: 4.5, off: 0.1, hatch: 0.2, rim: false });
      }
    }
    if (kind === 'stone') {
      // an amethyst cluster breaking out of the side
      const base = [cx + w * 0.72, cy - h * 0.25];
      for (const [a, l, wd] of [[-1.0, 0.16, 0.045], [-0.45, 0.21, 0.055], [0.15, 0.14, 0.04]]) {
        const tip = [base[0] + Math.cos(a) * S * l, base[1] + Math.sin(a) * S * l];
        const nx = -Math.sin(a) * S * wd, ny = Math.cos(a) * S * wd;
        const pr = [[base[0] - nx, base[1] - ny], [tip[0] - nx * 0.8 - Math.cos(a) * S * 0.02, tip[1] - ny * 0.8 - Math.sin(a) * S * 0.02], tip, [tip[0] + nx * 0.8 - Math.cos(a) * S * 0.02, tip[1] + ny * 0.8 - Math.sin(a) * S * 0.02], [base[0] + nx, base[1] + ny]];
        F().form(ctx, pr, '#A070D8', B, sd('am', a), { width: 4.5, off: 0.1, shine: 0.8, hatch: 0.3, smooth: false, dark: '#6A3AA8' });
        K.line(ctx, [[base[0], base[1]], tip], { width: 2.4, color: '#D8C0F8', seed: sd('amr', a), boil: B, smooth: false, taper: 0 });
      }
    }
  }

  K.props = { drawChest, drawEgg, TIERS, EGGS };
})();
