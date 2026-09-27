// pets/30-pigeon.js : Голубь-почтальон (common, luck). Front kit, a bird standing square to us.
// A plump blue-grey city pigeon: a round head, orange eyes, a small dark beak with a white cere, a
// shimmering green-and-violet collar, a pale grey breast, two dark bars on each folded wing, pink
// feet. An old leather flying cap with ear flaps and goggles, a satchel on a strap with a letter
// sticking out, a rolled note tied to one leg. Work: the note pops off his leg, he unrolls it —
// "!" — a four-leaf clover jumps out of it: the luck of the camp.
(function () {
  'use strict';
  const FILM = window.FILM;
  const L = FILM.lib;
  const P = L.pal;
  const K = FILM.pets;
  const M = K.M;
  const lerp = L.lerp;
  const F = () => K.front;
  const ID = 'pigeon';
  const sd = (...k) => L.hash(ID, ...k) & 0x7fffffff;

  const C = {
    fur: '#8E9AAE',
    furDeep: '#58627A',
    furLit: '#B8C2D2',
    belly: '#B4BDCC',
    wing: '#7F8BA2',
    secondary: '#6A7690',
    primary: '#4E566A',
    tail: '#6E7890',
    wingLine: '#4A5266',
    bar: '#3E4458',
    green: '#4E9A7A',
    violet: '#8A5A9A',
    leg: '#E07A80',
    beak: '#4A4448',
    beakLow: '#3A3438',
    cere: '#F2EEE6',
    blush: '#E88A9A',
    mouth: '#5E2A2A',
    leather: '#7A5234',
    leatherDeep: '#4A3020',
    leatherLit: '#9A7050',
    satchel: '#8A6040',
    paper: '#F6EEDA',
    paperDeep: '#C8BA98',
    clover: '#5AAA4A',
    cloverDeep: '#2E6A2A',
  };

  function collar(c2, R, B) {
    const T = R.Mb;
    // the shimmering neck: green shading into violet
    // the lower edge in little scallops, like the tips of neck feathers
    const low = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x0 = 168 - (i / n) * 336, x1 = 168 - ((i + 1) / n) * 336;
      for (let k = 0; k < 5; k++) {
        const u = k / 5, x = lerp(x0, x1, u);
        low.push([x, -300 + 16 * (1 - (x / 170) ** 2) + 16 * Math.sin(Math.PI * u)]);
      }
    }
    const band = M.all(T, K.smooth([[-176, -372], [0, -394], [176, -372], ...low], 3));
    K.fill(c2, band, C.green);
    K.clip(c2, band, () => {
      for (const s of [-1, 1]) K.fill(c2, M.all(T, L.ellipsePts(s * 70, -310, 90, 40, 20, s * 0.3)), C.violet, 0.8);
      L.hatch(c2, band, { angle: 0.6, spacing: 8, width: 2, color: '#C8F0D8', alpha: 0.35, clip: true, seed: sd('sheen'), boil: B });
    });
  }

  function wingBars(c2, R, B, side, t) {
    // two dark bars across the folded wing
    if (t > 0.5) return;
    const T = R.Mb;
    for (const y of [-200, -160]) K.line(c2, M.all(T, K.mir([[118, y - 10], [150, y], [178, y + 10]], side)), { width: 11, color: C.bar, seed: sd('bar', side, y), boil: B, taper: [4, 4] });
  }

  function cap(ctx, R, B) {
    const T = R.Mh;
    // an aviator's cap: a leather dome over the crown, ear flaps down the sides
    const dome = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI + (i / 20) * Math.PI;
      dome.push(R.hl(Math.cos(a) * 156, -30 + Math.sin(a) * 120, 0.3));
    }
    const edge = [];
    for (let i = 0; i <= 8; i++) {
      const x = 150 - (i / 8) * 300;
      edge.push(R.hl(x, -46 - 22 * (1 - (x / 150) ** 2), 0.6));
    }
    const pts = M.all(T, K.smooth(dome.concat(edge), 4));
    F().form(ctx, pts, C.leather, B, sd('cap'), {
      width: 7,
      off: 0.12,
      shine: 0.7,
      hatch: 0.5,
      inside(c2) {
        K.line(c2, M.all(T, K.curve([R.hl(0, -150, 0.4), R.hl(0, -100, 0.7), R.hl(0, -60, 0.9)], 4)), { width: 4, color: C.leatherDeep, seed: sd('seam'), boil: B });
        const st = L.smoothPts(M.all(T, [R.hl(-6, -148, 0.4), R.hl(-6, -64, 0.9)]), false, 12);
        for (let i = 0; i + 1 < st.length; i += 2) K.line(c2, [st[i], st[i + 1]], { width: 2, color: C.leatherLit, seed: sd('stc', i), boil: B, smooth: false, taper: 0 });
      },
    });
    for (const s of [-1, 1]) {
      const flap = M.all(T, K.smooth([R.hl(s * 118, -40, 0.3), R.hl(s * 160, -30, 0.1), R.hl(s * 166, 40, 0.1), R.hl(s * 146, 82, 0.2), R.hl(s * 118, 60, 0.3)], 4));
      F().form(ctx, flap, C.leather, B, sd('flap', s), { width: 6, off: 0.12, hatch: 0.5, inside: (c2) => K.fill(c2, M.all(T, L.ellipsePts(...R.hl(s * 148, 30, 0.2), 16, 30, 14)), '#E8DCC6', 0.9) });
    }
    F().goggles(ctx, R, B, { y: -84, w: 150, r: 34, lens: '#8FC0CF' }, sd('gog'));
  }

  function satchel(ctx, R, B) {
    const T = R.Mb;
    const strap = M.all(T, K.curve([[120, -340], [40, -260], [-60, -170], [-120, -130]], 6));
    K.band(ctx, strap, 20, { fill: C.leather, deep: C.leatherDeep, seed: sd('strap'), boil: B, width: 4 });
    const bag = M.all(T, L.rrectPts(-196, -170, 116, 94, 16, 5));
    F().form(ctx, bag, C.satchel, B, sd('bag'), {
      width: 6,
      off: 0.1,
      hatch: 0.5,
      inside(c2) {
        // a letter sticking out of the top
        const env = M.all(T, [[-176, -186], [-110, -196], [-104, -160], [-172, -150]]);
        K.fill(c2, env, C.paper);
        L.inkPath(c2, env, { closed: true, width: 3, seed: sd('env'), boil: B, smooth: false, taper: 0 });
      },
    });
    const flap = M.all(T, K.smooth([[-196, -172], [-80, -172], [-84, -128], [-138, -116], [-192, -128]], 3));
    F().form(ctx, flap, C.leatherLit, B, sd('bflap'), { width: 5, off: 0.1, hatch: 0.4, rim: false });
    const bk = M.ap(T, [-138, -124]);
    K.fill(ctx, L.rrectPts(bk[0] - 10, bk[1] - 8, 20, 16, 4, 3), '#D8B25C');
    L.inkPath(ctx, L.rrectPts(bk[0] - 10, bk[1] - 8, 20, 16, 4, 3), { closed: true, width: 2.6, seed: sd('bk'), boil: B, taper: 0 });
  }

  function scroll(ctx, c, open, B, seed) {
    // a note: rolled (open 0) or unrolled between two rolls (open 1)
    const w = 30 + 120 * open, h = 70;
    if (open > 0.2) {
      const sh = [[c[0] - w, c[1] - h * 0.5], [c[0] + w, c[1] - h * 0.5], [c[0] + w, c[1] + h * 0.5], [c[0] - w, c[1] + h * 0.5]];
      F().form(ctx, sh, C.paper, B, seed, { width: 4, off: 0.06, hatch: 0.3, rim: false, smooth: false });
      for (let k = 0; k < 3; k++) K.line(ctx, [[c[0] - w * 0.7, c[1] - 18 + k * 16], [c[0] + w * (0.7 - k * 0.2), c[1] - 18 + k * 16]], { width: 3, color: C.paperDeep, seed: seed + 5 + k, boil: B, smooth: false, taper: 0 });
    }
    for (const s of [-1, 1]) {
      const rc = [c[0] + s * w, c[1]];
      F().form(ctx, L.rrectPts(rc[0] - 12, rc[1] - h * 0.6, 24, h * 1.2, 10, 4), C.paperDeep, B, seed + 20 + s, { width: 4, off: 0.12, hatch: 0.3, rim: false });
    }
  }

  function clover(ctx, c, s, B, seed) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const lc = [c[0] + Math.cos(a) * 26 * s, c[1] + Math.sin(a) * 26 * s];
      const leaf = [];
      for (let i = 0; i <= 20; i++) {
        const t = (i / 20) * Math.PI * 2;
        // a heart-shaped leaf pointing at the centre
        const hx = 16 * Math.sin(t) ** 3, hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        const r = a + Math.PI / 2;
        leaf.push([lc[0] + (hx * Math.cos(r) - hy * Math.sin(r)) * s * 1.3, lc[1] + (hx * Math.sin(r) + hy * Math.cos(r)) * s * 1.3]);
      }
      F().form(ctx, leaf, C.clover, B, seed + k, { width: 4, off: 0.1, shine: 0.6, hatch: 0.3, rim: false, dark: C.cloverDeep });
    }
    K.line(ctx, [c, [c[0] + 10 * s, c[1] + 50 * s]], { width: 6, color: C.cloverDeep, seed: seed + 9, boil: B, taper: [3, 2] });
  }

  const WORK = [
    { look: [0.3, 0.9], nod: 0.4, leg: { l: 0, r: 34 }, fx: { legNote: 1, glow: 1 } },
    { look: [0.2, -0.4], nod: -0.2, fx: { noteAir: 1 } },
    { hold: 1, look: [0, 0.8], nod: 0.3, fx: { scroll: 0.1 } },
    { hold: 1, look: [0, 0.8], nod: 0.3, lid: 0, fx: { scroll: 1 } },
    { hold: 1, look: [0, 0], lid: 0, mouth: 0.5, sq: 1.06, fx: { scroll: 1, bang: 1 } },
    { y: -70, wing: 0.9, eye: 'happy', mouth: 0.6, fx: { clover: 1 } },
    { y: -20, wing: 0.4, eye: 'happy', mouth: 0.4, fx: { clover: 0.7 } },
    { fx: {} },
  ];

  K.kits.front.make({
    id: ID,
    colors: C,
    stripe: P.stripeSky,
    plan: 'bird',
    bodyC: [0, -200],
    bodyR: 250,
    body: { half: [[0, -380], [96, -370], [152, -320], [180, -230], [178, -140], [144, -74], [72, -46], [0, -40]] },
    belly: { half: [[0, -300], [70, -290], [110, -240], [118, -160], [96, -96], [48, -64], [0, -58]] },
    wings: {
      fold: [[96, -320], [156, -312], [192, -240], [194, -160], [166, -110], [128, -130], [104, -220]],
      hold: [[96, -320], [158, -306], [190, -250], [176, -196], [120, -186], [104, -220], [98, -270]],
      spread: [[96, -320], [190, -380], [290, -420], [340, -370], [330, -300], [240, -270], [130, -250]],
      root: [100, -280],
      holdRoot: [150, -280],
      tip: 4,
      n: 7,
      feather: 120,
      fw: 20,
      rows: [[[112, -286], [146, -276], [174, -250]], [[108, -250], [144, -236], [178, -214]]],
      rowsSpread: [[[150, -340], [226, -370], [300, -392]], [[150, -300], [230, -330], [310, -350]]],
    },
    feet: { at: [56, -50], r: 9, toe: 34, claw: '#4A3A3A' },
    fan: { base: [0, -110], n: 5, spread: 1.4, len: 170, width: 22 },
    head: { c: [0, -520], rx: 154, ry: 142 },
    beak: { y: 40, w: 26, h: 38, cere: true },
    face: {
      eyes: { x: 70, y: -8, rx: 32, ry: 34, white: '#FFF4E2', iris: '#E8752A', irisR: 0.8 },
      blush: [112, 44, 22],
    },
    fur: false,
    shadowW: 210,
    attack: 'peck',
    hooks: {
      body: collar,
      wing: wingBars,
      front: satchel,
      head: cap,
      foot(ctx, R, B, side, f) {
        const fx = R.pose.fx || {};
        if (side > 0 && (fx.legNote || !Object.keys(fx).length || R.anim !== 'work')) {
          // the note rolled round his right leg, tied with string
          const c = [f[0], f[1] - 40];
          F().form(ctx, L.rrectPts(c[0] - 20, c[1] - 12, 40, 24, 8, 4), C.paper, B, sd('legN'), { width: 3.6, off: 0.1, hatch: 0.2, rim: false });
          K.line(ctx, [[c[0], c[1] - 12], [c[0], c[1] + 12]], { width: 3, color: '#B04030', seed: sd('str'), boil: B, taper: 0 });
          if (fx.glow) K.fx.star(ctx, c[0] + 34, c[1] - 30, 28, B, sd('lg'), '#FFF1C4');
        }
      },
      fx(ctx, R, B) {
        const fx = R.pose.fx || {};
        if (fx.noteAir) {
          const c = M.ap(R.Mb, [90, -200]);
          F().form(ctx, L.rrectPts(c[0] - 22, c[1] - 13, 44, 26, 8, 4), C.paper, B, sd('airN'), { width: 3.6, off: 0.1, hatch: 0.2, rim: false });
          K.fx.star(ctx, c[0] + 40, c[1] - 30, 30, B, sd('as'), '#FFF1C4');
        }
        if (fx.scroll) {
          const a = R.wingTip ? R.wingTip[-1] : M.ap(R.Mb, [-120, -190]);
          const b = R.wingTip ? R.wingTip[1] : M.ap(R.Mb, [120, -190]);
          scroll(ctx, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10], fx.scroll, B, sd('scroll'));
        }
        if (fx.bang) {
          const t = R.hp(0, -R.S.head.ry, 0);
          const c = [t[0] + 150, t[1] - 10];
          K.line(ctx, [[c[0], c[1] - 70], [c[0] - 4, c[1] - 10]], { width: 18, seed: sd('bang'), boil: B, taper: [8, 3], smooth: false });
          K.fill(ctx, L.ellipsePts(c[0] - 5, c[1] + 16, 9, 9, 10), P.ink);
          K.fx.burst(ctx, [c[0], c[1] - 20], 0.4, B, sd('bb'));
        }
        if (fx.clover) {
          const t = R.hp(0, -R.S.head.ry, 0);
          clover(ctx, [t[0], t[1] - 90], fx.clover, B, sd('clv'));
          K.fx.star(ctx, t[0] + 70, t[1] - 140, 40 * fx.clover, B, sd('cs'), '#FFF1C4');
        }
      },
    },
    poses: {
      work(d) {
        const T = WORK[d];
        return { look: T.look || null, nod: T.nod || 0, leg: T.leg || { l: 0, r: 0 }, hold: !!T.hold, lid: T.lid == null ? null : T.lid, mouth: T.mouth || 0, sq: T.sq || 1, y: T.y || 0, wing: T.wing || 0, eyeMode: T.eye || 'open', fx: T.fx };
      },
    },
  });
})();
