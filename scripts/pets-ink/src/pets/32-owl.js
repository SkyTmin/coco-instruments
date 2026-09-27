// pets/32-owl.js : Сова-фонарщица (rare, luck). Front kit, a round owl facing us.
// A round little eagle-owl: a big head sitting straight on the body, long feather ear tufts, a pale
// facial disc in two rings with a dark rim and a pale V of brows, two huge orange eyes, a small
// hooked beak, a cream breast streaked with dark chevrons, spotted and barred wings, fluffy
// feathered legs with dark talons. A brass lamp strapped to her forehead. Work: clicks the lamp on,
// sweeps the beam over the floor, finds a hidden crystal, hops to it and holds it up.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'owl';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#9C7250',
    furDeep: '#5E4128',
    furLit: '#C49A70',
    belly: '#E6D2AC',
    streak: '#6B4A2E',
    disc: '#EEDFC2',
    rim: '#5E4128',
    wing: '#8E6646',
    primary: '#6E4E34',
    secondary: '#7E5A3C',
    wingLine: '#4A3220',
    spot: '#E6D0A6',
    tail: '#7E5A3C',
    beak: '#4A3E36',
    beakLow: '#3A302A',
    leg: '#E2CCA4',
    blush: '#E89A7A',
    mouth: '#5E2A2A',
    eyeLine: '#3A2A20',
    brass: '#D2A546',
    brassDeep: '#86621F',
    glass: '#FFF3B8',
    strap: '#5A3A24',
    strapDeep: '#35210F',
    gem: '#6FC3E8',
    gemDeep: '#2C7FA6',
    beam: '#FFF3B8',
  };

  function disc(c2, R, B) {
    const T = R.Mh;
    // the facial disc: two rings joined, a dark rim round the outside, a pale V of brows
    const ring = (s, r) => {
      const out = [];
      for (let i = 0; i <= 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        out.push(R.hl(s * 68 + Math.cos(a) * r, 4 + Math.sin(a) * r * 1.02, 0.85));
      }
      return M.all(T, out);
    };
    for (const s of [-1, 1]) K.fill(c2, ring(s, 104), C.rim);
    for (const s of [-1, 1]) K.fill(c2, ring(s, 92), C.disc);
    // fine radiating feathers round each eye
    for (const s of [-1, 1])
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const c = R.hl(s * 68, 4, 0.85);
        K.line(c2, M.all(T, [[c[0] + Math.cos(a) * 58, c[1] + Math.sin(a) * 58], [c[0] + Math.cos(a) * 84, c[1] + Math.sin(a) * 86]]), { width: 2.4, color: '#CDB894', seed: sd('rad', s, k), boil: B, taper: [2, 2] });
      }
    // the brows: a pale V over the beak
    for (const s of [-1, 1]) K.line(c2, M.all(T, K.curve([R.hl(s * 10, 20, 1), R.hl(s * 40, -66, 0.9), R.hl(s * 110, -92, 0.7)], 4)), { width: 14, color: '#F6ECD6', seed: sd('brow', s), boil: B, taper: [6, 8] });
  }

  function breast(c2, R, B) {
    const T = R.Mb;
    // dark chevrons in rows down the cream breast
    for (let row = 0; row < 5; row++)
      for (let i = -2; i <= 2; i++) {
        const x = i * 44 + (row % 2) * 22, y = -290 + row * 44;
        if (Math.abs(x) > 110 - row * 6) continue;
        K.line(c2, M.all(T, [[x - 12, y - 6], [x, y + 6], [x + 12, y - 6]]), { width: 5, color: C.streak, seed: sd('chev', row, i), boil: B, smooth: false, taper: [2, 2] });
      }
  }

  function wingSpots(c2, R, B, side) {
    const T = R.Mb;
    for (let k = 0; k < 7; k++) {
      const p = K.mir([[118 + (k % 3) * 22, -290 + Math.floor(k / 3) * 46 + (k % 3) * 10]], side)[0];
      K.fill(c2, M.all(T, L.ellipsePts(p[0], p[1], 8, 6, 10)), C.spot);
    }
  }

  function lamp(ctx, R, B) {
    const T = R.Mh;
    const on = (R.pose.fx && R.pose.fx.lamp) || 0;
    // a leather strap round the head above the disc
    const strap = [];
    for (let i = 0; i <= 10; i++) {
      const x = -176 + (i / 10) * 352;
      strap.push(R.hl(x, -108 + 26 * (x / 176) ** 2, 0.5));
    }
    K.band(ctx, M.all(T, strap), 22, { fill: C.strap, deep: C.strapDeep, seed: sd('strap'), boil: B, width: 4 });
    const lc = R.hl(0, -116, 1);
    if (on) {
      const g = M.ap(T, lc);
      const glow = ctx.createRadialGradient(g[0], g[1], 6, g[0], g[1], 120);
      glow.addColorStop(0, L.rgba(C.glass, 0.7 * on));
      glow.addColorStop(1, L.rgba(C.glass, 0));
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(g[0], g[1], 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    F().form(ctx, M.all(T, L.rrectPts(lc[0] - 38, lc[1] - 32, 76, 62, 14, 6)), C.brass, B, sd('lamp'), { width: 6, off: 0.12, shine: 0.8, hatch: 0.5, dark: C.brassDeep });
    const glass = M.all(T, L.ellipsePts(lc[0], lc[1], 24, 24, 20));
    K.fill(ctx, glass, on ? C.glass : '#9DB3B8');
    K.fill(ctx, M.all(T, L.ellipsePts(lc[0] - 8, lc[1] - 8, 8, 5, 10)), '#FFFFFF', 0.9);
    L.inkPath(ctx, glass, { closed: true, width: 5, seed: sd('glass'), boil: B, wobble: 0.3 });
  }

  function crystal(ctx, c, s, B) {
    const T = M.chain(M.tr(c[0], c[1]), M.sc(s, s));
    const body = M.all(T, [[-22, 0], [-26, -40], [0, -70], [26, -40], [22, 0]]);
    F().form(ctx, body, C.gem, B, sd('gem'), { width: 4.5, off: 0.1, shine: 1, hatch: 0.3, dark: C.gemDeep, smooth: false });
    K.line(ctx, M.all(T, [[0, -70], [0, 0]]), { width: 2.6, color: C.gemDeep, seed: sd('gf'), boil: B, smooth: false, taper: 0 });
    K.line(ctx, M.all(T, [[-26, -40], [26, -40]]), { width: 2.6, color: '#BFE8F8', seed: sd('gf2'), boil: B, smooth: false, taper: 0 });
  }

  function beam(ctx, R, B) {
    const fx = R.pose.fx || {};
    if (!fx.beam) return;
    const src = R.hp(0, -116, 1);
    const tx = K.CXF + fx.beam * 280, ty = K.GROUND - 10;
    const w = 110;
    const cone = [[src[0] - 20, src[1]], [src[0] + 20, src[1]], [tx + w, ty], [tx - w, ty]];
    K.fill(ctx, cone, C.beam, 0.28);
    K.fill(ctx, L.ellipsePts(tx, ty, w, 26, 24), C.beam, 0.45);
  }

  const WORK = [
    { look: [0, -0.8], ear: 0.6, fx: { lamp: 0, click: 1 } },
    { look: [0, 0.8], nod: 0.3, fx: { lamp: 1, beam: 0.01 } },
    { turn: -0.5, look: [-0.8, 0.8], nod: 0.3, fx: { lamp: 1, beam: -0.9 } },
    { turn: 0.5, look: [0.8, 0.8], nod: 0.3, fx: { lamp: 1, beam: 0.9, gem: 1, glint: 1 } },
    { turn: 0.5, look: [0.8, 0.8], lid: 0, ear: 1, sq: 1.05, fx: { lamp: 1, beam: 0.9, gem: 1, glint: 1.4 } },
    { x: 90, y: -50, wing: 0.5, turn: 0.3, look: [0.5, 0.7], fx: { lamp: 1, gem: 1 } },
    { x: 60, hold: 1, eye: 'happy', mouth: 0.4, fx: { lamp: 1, held: 1, glint: 1 } },
    { x: 20, fx: { lamp: 0.3 } },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSage,
    plan: 'bird',
    bodyC: [0, -200],
    bodyR: 260,
    body: { half: [[0, -370], [124, -360], [184, -300], [204, -196], [192, -104], [146, -46], [72, -26], [0, -22]] },
    belly: { half: [[0, -330], [80, -322], [124, -270], [134, -180], [116, -100], [62, -56], [0, -48]] },
    wings: {
      fold: [[118, -340], [176, -330], [210, -250], [212, -150], [182, -80], [148, -110], [124, -230]],
      hold: [[118, -340], [180, -326], [214, -260], [196, -196], [132, -186], [118, -226], [114, -280]],
      spread: [[118, -340], [210, -400], [310, -440], [362, -390], [350, -320], [260, -290], [150, -270]],
      root: [124, -300],
      holdRoot: [166, -300],
      tip: 4,
      n: 7,
      feather: 110,
      fw: 20,
      rows: [[[130, -310], [168, -300], [196, -276]]],
      rowsSpread: [[[166, -360], [246, -392], [320, -410]]],
    },
    feet: { at: [60, -40], r: 16, toe: 34, claw: '#2A2220' },
    fan: { base: [0, -100], n: 5, spread: 1.0, len: 130, width: 24 },
    head: { c: [0, -484], rx: 186, ry: 152 },
    ears: {
      at: [128, -118],
      pts: [[-24, 24], [-22, -40], [-18, -96], [-10, -126], [-2, -104], [8, -140], [14, -104], [24, -40], [26, 20]],
      fill: C.fur,
      tilt: 0.5,
      flop: 0.5,
    },
    beak: { y: 40, w: 20, h: 38, down: 10 },
    face: {
      eyes: { x: 68, y: 4, rx: 46, ry: 48, white: '#FFF4DC', iris: '#F08A24', irisR: 0.9 },
      blush: [138, 70, 20],
    },
    fur: false,
    shadowW: 240,
    attack: 'peck',
    hooks: {
      skin: disc,
      body: breast,
      wing: wingSpots,
      head: lamp,
      ear(c2, R, B, side, T) {
        // feather lines up each tuft, dark down the middle
        K.line(c2, M.all(T, [[0, 16], [side * 2, -80], [side * 6, -118]]), { width: 7, color: C.furDeep, seed: sd('et', side), boil: B, taper: [3, 6] });
        for (const k of [-1, 1]) K.line(c2, M.all(T, [[k * 12, 10], [k * 12 + side * 2, -60]]), { width: 2.6, color: C.furLit, seed: sd('el', side, k), boil: B, taper: [2, 5] });
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        beam(ctx, R, B);
        const gp = [K.CXF + 250, K.GROUND - 4];
        if (fx.gem) crystal(ctx, gp, 1, B);
        if (fx.glint && fx.gem) K.fx.star(ctx, gp[0] + 36, gp[1] - 90, 34 * fx.glint, B, sd('gg'), '#FFF1C4');
        if (fx.held) {
          const a = R.wingTip ? R.wingTip[-1] : M.ap(R.Mb, [-120, -190]);
          const b = R.wingTip ? R.wingTip[1] : M.ap(R.Mb, [120, -190]);
          const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10];
          crystal(ctx, c, 1.2, B);
          if (fx.glint) K.fx.star(ctx, c[0] + 44, c[1] - 90, 34, B, sd('hg'), '#FFF1C4');
        }
        if (fx.click) {
          const l = R.hp(0, -116, 1);
          for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + (k - 1) * 0.6;
            K.line(ctx, [[l[0] + Math.cos(a) * 50, l[1] + Math.sin(a) * 50], [l[0] + Math.cos(a) * 74, l[1] + Math.sin(a) * 74]], { width: 5, seed: sd('clk', k), boil: B, smooth: false, taper: [2, 4] });
          }
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { x: T.x || 0, y: T.y || 0, sq: T.sq || 1, turn: T.turn || 0, look: T.look || null, nod: T.nod || 0, lid: T.lid == null ? null : T.lid, ear: T.ear || 0, wing: T.wing || 0, hold: !!T.hold, eyeMode: T.eye || 'open', mouth: T.mouth || 0, fx: T.fx };
      },
    },
  });
})();
