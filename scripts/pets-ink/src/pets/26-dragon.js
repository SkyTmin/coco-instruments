// pets/26-dragon.js : Угольный дракон (legendary, loot + sell). Quad kit with wings.
// A small coal dragon: black scales cracked with glowing lava, bone horns, a ridge of spikes down
// the back and tail, stubby bat wings, a heavy chain collar with a broken link, embers always
// drifting off him. Bites with a puff of flame. Work: breathes in (the cracks blaze), breathes
// fire on a stone until it glows, and the stone becomes a gold nugget.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const TAU = Math.PI * 2;
  const clamp = L.clamp, lerp = L.lerp;
  const ID = 'dragon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#3E3736',
    furDeep: '#171313',
    furLit: '#7A6C68',
    chest: '#9A6A44',
    plate: '#A87A4E',
    plateDeep: '#5E3E22',
    lava: '#FF8A2A',
    lavaHot: '#FFD166',
    skin: '#8C3A2A',
    skinDeep: '#4A1A12',
    nose: '#1E1A1A',
    noseDeep: '#0A0808',
    eye: '#1A110E',
    eyeLine: '#E8D9C4',
    mouth: '#5E1A10',
    tongue: '#E0574A',
    horn: '#DCCDB0',
    hornDeep: '#8E7E60',
    membrane: '#8A3A2C',
    membraneDeep: '#3E1812',
    steel: '#8F949A',
    stone: '#8A857E',
    stoneDeep: '#55504A',
    gold: '#F2C14E',
    goldDeep: '#A0741E',
  };

  // a round chubby body, a reptile head: flat skull, brow bump, a nostril knob, a long jaw
  const SIL = [
    [-176, -130, 0],
    [-206, -190, 0],
    [-190, -250, 0],
    [-130, -284, 0],
    [-40, -298, 0],
    [40, -306, 0.1],
    [92, -336, 0.5],
    [112, -386, 1],
    [150, -428, 1],
    [210, -440, 1],
    [256, -448, 1],
    [276, -432, 1],
    [326, -414, 1],
    [364, -410, 1],
    [384, -394, 1],
    [392, -374, 1],
    [384, -352, 1],
    [340, -340, 1],
    [292, -330, 1],
    [248, -318, 0.9],
    [200, -292, 0.5],
    [186, -230, 0],
    [158, -150, 0],
    [80, -118, 0],
    [0, -114, 0],
    [-100, -120, 0],
  ];

  // lava cracks: a fixed branching net inside the body, glowing with pose.glow
  const CRACKS = (() => {
    const r = L.rng(sd('cracks'));
    const out = [];
    const seeds = [[-150, -240], [-80, -210], [0, -250], [60, -200], [-120, -180], [30, -290], [100, -250]];
    for (const [x0, y0] of seeds) {
      let x = x0, y = y0, a = r.range(0, TAU);
      const pts = [[x, y]];
      for (let k = 0; k < 4; k++) {
        a += r.range(-0.9, 0.9);
        const l = r.range(18, 34);
        x += Math.cos(a) * l;
        y += Math.sin(a) * l * 0.8;
        pts.push([x, y]);
      }
      out.push(pts);
    }
    return out;
  })();

  function glowAt(ctx, x, y, rad, a) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, L.rgba(C.lava, a));
    g.addColorStop(1, L.rgba(C.lava, 0));
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function scales(ctx, R, B, pts) {
    const T = R.Mb, H = R.Mh;
    const glow = R.pose.fx && R.pose.fx.glow != null ? R.pose.fx.glow : 1;
    // belly plates
    for (let k = 0; k < 7; k++) {
      const x = -140 + k * 46;
      const yb = -118 - 10 * Math.abs(k - 3) ** 1.4;
      const plate = M.all(T, K.smooth([[x - 22, yb - 34], [x + 22, yb - 34], [x + 20, yb], [x - 20, yb]], 4));
      K.fill(ctx, plate, C.plate);
      L.inkPath(ctx, plate, { closed: true, width: 3, color: C.plateDeep, seed: sd('plate', k), boil: B, wobble: 0.3, taper: 0 });
    }
    K.fill(ctx, M.all(T, K.smooth([[150, -300], [190, -270], [180, -180], [150, -150], [124, -240]], 5)), C.chest);
    // scale scallops over the back
    L.stipple(ctx, pts, { spacing: 20, r: [2, 3.4], color: C.furLit, alpha: 0.7, seed: sd('scl'), boil: B });
    // the cracks: a glow under a bright line
    for (let i = 0; i < CRACKS.length; i++) {
      const c = M.all(T, CRACKS[i]);
      glowAt(ctx, c[1][0], c[1][1], 40 * glow, 0.35 * clamp(glow));
      K.line(ctx, c, { width: 7, color: C.lava, alpha: clamp(0.4 + 0.6 * glow), seed: sd('crack', i), boil: B, smooth: false, taper: [3, 6] });
      if (glow > 1.2) K.line(ctx, c, { width: 3, color: C.lavaHot, alpha: clamp(glow - 1.2), seed: sd('crackH', i), boil: B, smooth: false, taper: [3, 6] });
    }
    // a crack on the cheek
    const cc = M.all(H, [[220, -360], [240, -372], [256, -364], [272, -376]]);
    K.line(ctx, cc, { width: 6, color: C.lava, alpha: clamp(0.4 + 0.6 * glow), seed: sd('cheek'), boil: B, smooth: false, taper: [3, 5] });
  }

  function spikes(ctx, R, B) {
    const S = [[-170, -286], [-110, -304], [-50, -312], [10, -318], [66, -330]];
    for (let i = 0; i < S.length; i++) {
      const [x, y] = S[i];
      const h = 30 + (i === 2 ? 8 : 0);
      const tri = [R.place([x - 20, y + 10], 0), R.place([x + 4, y - h], 0), R.place([x + 22, y + 10], 0)];
      K.fill(ctx, tri, C.horn);
      L.inkPath(ctx, tri, { closed: true, width: 4.5, seed: sd('spike', i), boil: B, smooth: false, taper: 0, wobble: 0.3 });
    }
  }

  function horns(ctx, R, B, far) {
    const H = R.Mh;
    const base = far ? [236, -440] : [180, -432];
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      pts.push([base[0] - 70 * u - 10 * u * u, base[1] - 60 * u + 36 * u * u]);
    }
    const rib = M.all(H, K.ribbonPts(pts, 30, 4));
    K.form(ctx, rib, { fill: K.far(C.horn, far), deep: C.hornDeep, width: far ? 4.5 : 5.5, seed: sd('horn', far ? 1 : 0), boil: B, shade: 0.7, spacing: 5, hatchW: 1.8 });
    for (let k = 1; k < 4; k++) {
      const p = pts[k * 1.5 | 0];
      K.line(ctx, M.all(H, [[p[0] - 9, p[1] - 6], [p[0] + 9, p[1] + 6]]), { width: 2.2, color: C.hornDeep, seed: sd('hornR', k, far ? 1 : 0), boil: B, smooth: false, taper: 0 });
    }
  }

  function head(ctx, R, B) {
    const H = R.Mh;
    // the brow ridge over the eye
    K.line(ctx, M.all(H, [[214, -436], [250, -440], [284, -426]]), { width: 11, color: C.furDeep, seed: sd('brow'), boil: B, taper: [6, 8] });
    // the nostril knob
    K.fill(ctx, M.all(H, L.ellipsePts(372, -392, 9, 6, 12, -0.3)), C.furDeep);
    // cheek frill: three spikes back from the jaw hinge
    for (let k = 0; k < 3; k++) {
      const b0 = [236 - k * 10, -348 + k * 14];
      const tri = M.all(H, [[b0[0] + 10, b0[1] - 12], [b0[0] - 48 - k * 6, b0[1] - 18 + k * 8], [b0[0] + 6, b0[1] + 10]]);
      K.fill(ctx, tri, C.horn);
      L.inkPath(ctx, tri, { closed: true, width: 4, seed: sd('frill', k), boil: B, smooth: false, taper: 0, wobble: 0.3 });
    }
  }

  // a bat wing over the back: the arm runs up and back from the shoulder to the wrist, three
  // fingers fan back from the wrist, the membrane is scalloped between the tips and joins the back.
  // open 0 folded along the back, 1 spread high (tables of offsets, so the fan never folds over)
  function wing(ctx, R, B, far) {
    const t = R.pose.fx && R.pose.fx.wing != null ? R.pose.fx.wing : 0.35;
    const k = far ? 0.88 : 1;
    const W0 = R.place(far ? [60, -312] : [30, -300], 0);
    const mixv = (a, b) => [lerp(a[0], b[0], t) * k, lerp(a[1], b[1], t) * k];
    const W1 = ((v) => [W0[0] + v[0], W0[1] + v[1]])(mixv([-46, -92], [-6, -160]));
    const tips = [
      mixv([-190, -30], [-150, -120]),
      mixv([-176, 30], [-190, -20]),
      mixv([-130, 72], [-160, 72]),
    ].map((v) => [W1[0] + v[0], W1[1] + v[1]]);
    const back = R.place(far ? [-110, -300] : [-130, -290], 0);
    const scallop = (a, b) => [(a[0] + b[0]) / 2 * 0.78 + W1[0] * 0.22, (a[1] + b[1]) / 2 * 0.78 + W1[1] * 0.22];
    const mem = [W0, W1, tips[0], scallop(tips[0], tips[1]), tips[1], scallop(tips[1], tips[2]), tips[2], scallop(tips[2], back), back];
    K.form(ctx, mem, {
      fill: K.far(C.membrane, far),
      deep: C.membraneDeep,
      width: far ? 5 : 6,
      seed: sd('wing', far ? 1 : 0),
      boil: B,
      spacing: 8,
      hatchAlpha: 0.6,
      wobble: 0.6,
      after: (c2) => K.line(c2, [tips[0], mem[3], tips[1], mem[5], tips[2], mem[7]], { width: 4, color: C.lava, alpha: 0.6, seed: sd('wingGlow', far ? 1 : 0), boil: B }),
    });
    for (let i = 0; i < 3; i++) K.line(ctx, [W1, tips[i]], { width: far ? 6 : 7.5, color: K.far(C.fur, far), seed: sd('finger', i, far ? 1 : 0), boil: B, taper: [2, 6] });
    K.line(ctx, [W0, W1], { width: far ? 12 : 14, color: K.far(C.fur, far), seed: sd('warm', far ? 1 : 0), boil: B, taper: [2, 4] });
    const claw = [[W1[0] - 4, W1[1] - 4], [W1[0] + 14, W1[1] - 22], [W1[0] + 8, W1[1] + 2]];
    K.fill(ctx, claw, C.horn);
    L.inkPath(ctx, claw, { closed: true, width: 3, seed: sd('wclaw', far ? 1 : 0), boil: B, smooth: false, taper: 0 });
  }

  function collar(ctx, R, B) {
    const T = R.Mf;
    const ring = M.ap(T, [200, -300]);
    const line = M.all(T, K.curve([[106, -382], [160, -340], [214, -296]], 8));
    K.chain(ctx, line, 18, { width: 8, color: C.steel, seed: sd('collar'), boil: B });
    const sw = R.pose.fx && R.pose.fx.swing != null ? R.pose.fx.swing : 0;
    K.chain(ctx, [ring, [ring[0] + 12 + 16 * sw, ring[1] + 46]], 18, { width: 7, color: C.steel, seed: sd('hang'), boil: B });
    const end = [ring[0] + 12 + 16 * sw, ring[1] + 60];
    L.inkPath(ctx, L.ellipsePts(end[0], end[1], 9, 14, 16, 0.3).slice(3, 15), { width: 7, color: P.ink, seed: sd('open'), boil: B, taper: [2, 2] });
    L.inkPath(ctx, L.ellipsePts(end[0], end[1], 9, 14, 16, 0.3).slice(3, 15), { width: 3.2, color: C.steel, seed: sd('open'), boil: B, taper: [2, 2] });
  }

  // a cone of fire from the mouth to a target, strength f 0..1, flicker by drawing
  function fire(ctx, from, to, f, d, B) {
    if (f <= 0) return;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) * f, a = Math.atan2(dy, dx);
    const layer = (wmax, col, alpha, salt) => {
      const top = [], bot = [];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const w = wmax * (0.15 + 0.85 * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)) ** 0.8) * (u < 0.9 ? 1 : (1 - u) * 10);
        const n = 10 * L.noise1(u * 6 + d * 1.7 + salt, sd('fire'));
        const x = from[0] + Math.cos(a) * len * u, y = from[1] + Math.sin(a) * len * u;
        top.push([x - Math.sin(a) * (w + n), y + Math.cos(a) * (w + n)]);
        bot.push([x + Math.sin(a) * (w - n), y - Math.cos(a) * (w - n)]);
      }
      const pts = top.concat(bot.reverse());
      K.fill(ctx, pts, col, alpha);
      return pts;
    };
    const outer = layer(56, '#E0501E', 0.95, 0);
    layer(38, C.lava, 1, 3);
    layer(20, C.lavaHot, 1, 7);
    layer(8, '#FFF6D8', 0.9, 11);
    L.inkPath(ctx, outer, { closed: true, width: 4.5, color: '#7A2410', seed: sd('fireInk', d), boil: B, wobble: 1.2 });
  }

  function stone(ctx, R, B) {
    const fx = R.pose.fx;
    if (!fx || fx.stone == null) return;
    const g = K.GROUND, x = M.ap(R.Mr, [390, 0])[0];
    if (fx.stone < 2) {
      const heat = clamp(fx.stone);
      const pts = K.smooth([[x - 64, g + 2], [x - 68, g - 40], [x - 26, g - 70], [x + 30, g - 64], [x + 66, g - 28], [x + 62, g + 2]], 5);
      K.form(ctx, pts, { fill: L.mix(C.stone, '#E0501E', heat * 0.8), deep: heat > 0.5 ? '#7A2410' : C.stoneDeep, width: 7, seed: sd('stone'), boil: B, spacing: 8 });
      if (heat > 0.3) glowAt(ctx, x, g - 36, 90, 0.5 * heat);
    } else {
      const pts = K.smooth([[x - 44, g + 2], [x - 50, g - 30], [x - 14, g - 54], [x + 30, g - 44], [x + 46, g - 12], [x + 36, g + 2]], 5);
      K.form(ctx, pts, { fill: C.gold, deep: C.goldDeep, width: 6, seed: sd('nugget'), boil: B, spacing: 6 });
      K.fill(ctx, L.ellipsePts(x - 16, g - 32, 10, 6, 10, -0.4), '#FFF3C8', 0.9);
      K.fx.star(ctx, x + 40, g - 80, 26 * (fx.star || 1), B, sd('gst1'), '#FFF3C8');
      K.fx.star(ctx, x - 50, g - 70, 18 * (fx.star || 1), B, sd('gst2'), '#FFF3C8');
    }
  }

  function fx(ctx, R, B) {
    const f = R.pose.fx || {};
    if (f.breath) fire(ctx, M.ap(R.Mh, [388, -350]), [M.ap(R.Mr, [390, 0])[0], K.GROUND - 40], f.breath, f.d || 0, B);
    if (f.kind === 'chomp' && f.p > 0.2 && f.p < 1.4) {
      const m = M.ap(R.Mh, [396, -352]);
      fire(ctx, m, [m[0] + 140, m[1] + 10], 0.6 + 0.3 * Math.sin(f.p * 6), Math.round(f.p * 5), B);
    }
    if (f.embers !== 0) K.fx.embers(ctx, M.ap(R.Mb, [-20, -300]), 260, f.u || 0, B, sd('embers'), [C.lava, C.lavaHot, C.lava]);
    if (f.smoke) {
      const n = M.ap(R.Mh, [386, -372]);
      for (let k = 0; k < 3; k++) {
        const r = 12 + k * 8 + 10 * f.smoke;
        L.inkPath(ctx, L.ellipsePts(n[0] + 20 + k * 22, n[1] - 30 - k * 30 * f.smoke, r, r * 0.8, 14), { closed: true, width: 4, alpha: 0.8 - k * 0.2, color: P.inkSoft, seed: sd('smoke', k), boil: B, wobble: 0.8 });
      }
    }
  }

  // the tail with a spade and a spike ridge (the tail is the kit's; this adds the ridge on top)
  const TAIL = { base: [-190, -200], len: 280, lift: -0.3, curl: -0.9, rise: 0, w0: 80, w1: 14, fill: C.fur, deep: C.furDeep, ink: 7 };

  K.kits.quad.make({
    id: ID,
    colors: C,
    stripe: P.stripeApricot,
    sil: SIL,
    neck: [160, -360],
    headScale: 1.16,
    spine: [0, -250],
    bodyC: [-10, -220],
    bodyR: 230,
    front: { atN: [124, -150], atF: [100, -158], l1: 66, l2: 62, r1: 44, rj: 32, r2: 28, paw: [40, 19], claws: true, clawCol: C.horn },
    hind: { atN: [-130, -160], atF: [-108, -168], l1: 80, l2: 62, r1: 58, rj: 32, r2: 28, paw: [40, 19], claws: true, clawCol: C.horn },
    feet: { fn: 132, ff: 108, hn: -130, hf: -108 },
    stride: 48,
    lift: 34,
    wag: 0.6,
    lie: 110,
    tail: TAIL,
    tufts: false,
    ears: null,
    face: {
      eye: { x: 254, y: -410, r: 20, style: 'iris', iris: '#FF9F1C', slit: true, lid: 0.3, lidColor: C.fur },
      nose: { x: 390, y: -372, rx: 1, ry: 1 },
      mouth: [[386, -352], [340, -342], [290, -332]],
      whiskers: null,
      blush: null,
      tongue: 30,
      fangs: 1,
    },
    hooks: {
      behind(ctx, R, B) {
        horns(ctx, R, B, true);
        stone(ctx, R, B);
      },
      farWing: (ctx, R, B) => wing(ctx, R, B, true),
      body: (ctx, R, B, pts) => scales(ctx, R, B, pts),
      bodyAfter: (ctx, R, B) => spikes(ctx, R, B),
      face: head,
      front(ctx, R, B) {
        collar(ctx, R, B);
        wing(ctx, R, B, false);
        horns(ctx, R, B, false);
      },
      fx,
    },
    poses: {
      idle(d, n, P0) {
        return Object.assign(P0.idle(d, n), { fx: { glow: 1 + 0.2 * Math.sin((TAU * d) / n), u: d / n, wing: 0.33 + 0.05 * Math.sin((TAU * d) / n), swing: 0.3 * Math.sin((TAU * d) / n) } });
      },
      walk(d, n, P0) {
        return Object.assign(P0.walk(d, n), { fx: { glow: 1, u: d / n, wing: 0.3 + 0.08 * Math.sin((TAU * d) / n), swing: Math.cos((TAU * d) / n) } });
      },
      happy(d, n, P0) {
        const p = P0.happy(d, n);
        p.fx = { kind: 'burst', k: d, u: d / n, glow: 1.4, wing: d >= 1 && d <= 5 ? (d % 2 ? 1 : 0.55) : 0.2 };
        return p;
      },
      attack(d, n, P0) {
        const p = P0.attack(d, n);
        p.fx = Object.assign({}, p.fx, { glow: 1.3, u: d / n, wing: 0.3 });
        return p;
      },
      sleep(d, n, P0) {
        const p = P0.sleep(d, n);
        p.fx = Object.assign({}, p.fx, { glow: 0.45 + 0.1 * Math.sin((TAU * d) / n), embers: 0, wing: 0.05 });
        return p;
      },
      // breathe in (the cracks blaze), fire on the stone until it glows, a gold nugget
      work(d, n, P0) {
        const st = P0.idle(0, 12).legs;
        const T = [
          { head: -0.2, sq: 1.04, glow: 1.6, stone: 0 },
          { head: -0.24, sq: 1.07, glow: 2.2, stone: 0, wing: 0.4 },
          { head: 0.26, mouth: 1, breath: 0.7, glow: 1.8, stone: 0.3 },
          { head: 0.28, mouth: 1, breath: 1, glow: 1.6, stone: 0.7 },
          { head: 0.24, mouth: 0.6, breath: 0.5, glow: 1.2, stone: 1 },
          { head: 0.1, glow: 1, stone: 2, smoke: 0.5, star: 1.2 },
          { head: -0.06, glow: 1, stone: 2, smoke: 1, eye: 'happy', star: 0.8 },
          { head: -0.12, glow: 1.1, stone: 2, mouth: 0.6, eye: 'happy', star: 1 },
        ][d];
        return { head: T.head, sq: T.sq || 1, mouth: T.mouth || 0, eyeMode: T.eye || 'open', legs: st, fx: { glow: T.glow, stone: T.stone, breath: T.breath, smoke: T.smoke, star: T.star, wing: T.wing || 0, d, u: d / n } };
      },
    },
  });
})();
