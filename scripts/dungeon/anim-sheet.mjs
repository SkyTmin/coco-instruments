// Лист кадров босса (v2.85, библия §14): рисовальщик моба, его метки ударов
// и контакт — кадр за кадром, как их увидит игра, крупно.
//
//   PORT=5201 node scripts/dungeon/anim-sheet.mjs spec.json out.png
//
// Нужен запущенный Vite (библия §10). spec.json:
// {
//   "kind": "king",            // id моба из MOBS (радиус, рисовальщик)
//   "fps": 24, "scale": 4,     // кадров в секунду, во сколько раз крупнее
//   "cols": 12,                // кадров в строке листа
//   "rows": [
//     { "label": "рубка тесаком", "mode": "cleaveAim", "dur": 0.75,
//       "data": { "f1blade": 0 },          // m.data на этот ряд
//       "hit": 0.75,                       // когда урон — кадр в красной рамке
//       "left": false, "flash": false,
//       "next": { "mode": "recover", "dur": 0.7 },   // продолжение ряда
//       "strike": { "art": "f1_cleave", "shape": "cone", "r": 2.4,
//                   "ang": 0, "arc": 2.1, "warn": 0.75 }  // метка и контакт
//     }
//   ]
// }
// Поза берётся ТЕМ ЖЕ кодом, что в бою (`DungeonRenderer.mobPose`), поля
// движка анимаций (dx, dy, sx, sy, rot, lit, alpha) применяются так же, как
// в `drawMob`. Метка удара рисуется под мобом, пока идёт `warn`, контакт
// (`registerImpactPainter`) — после.
// Playwright в проект не входит: если его нет рядом, путь к модулю —
// в PLAYWRIGHT_MODULE (…/node_modules/playwright/index.mjs).
const { chromium } = await import('playwright').catch(() => {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('нет playwright: задайте PLAYWRIGHT_MODULE');
  return import(process.env.PLAYWRIGHT_MODULE);
});
import fs from 'node:fs';

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error('usage: PORT=… node scripts/dungeon/anim-sheet.mjs spec.json out.png');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const port = process.env.PORT ?? 5201;
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR ' + e.stack));
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:${port}/#/`, { timeout: 180000 });
await p.waitForTimeout(1500);
const url = await p.evaluate(async (spec) => {
  const R = await import('/src/lib/dungeon-render.ts');
  const P = await import('/src/lib/dungeon-paint.ts');
  const D = await import('/src/lib/dungeon.ts');
  const def = D.MOBS[spec.kind];
  if (!def || def.art?.kind !== 'paint') throw new Error('нет рисовальщика у ' + spec.kind);
  const paint = P.MOB_PAINTERS.get(def.art.id);
  const fps = spec.fps ?? 24;
  const S = spec.scale ?? 4;
  const cols = spec.cols ?? 12;
  const view = document.createElement('canvas');
  const rr = new R.DungeonRenderer(view);
  const TS = 16;
  // Кадры рядов.
  const rows = [];
  let cw = 0;
  let ch = 0;
  let above = 0;
  for (const row of spec.rows) {
    const parts = [row];
    for (let n = row.next; n; n = n.next) parts.push(n);
    const frames = [];
    let t0 = 0;
    for (const part of parts) {
      const count = Math.max(1, Math.round((part.dur ?? 1) * fps));
      for (let i = 0; i < count; i++) {
        const t = i / fps;
        const m = {
          id: 7,
          kind: spec.kind,
          x: 0,
          y: 0,
          vx: part.vx ?? 0,
          vy: part.vy ?? 0,
          kx: 0,
          ky: 0,
          r: def.radius ?? 0.5,
          hp: 100,
          maxHp: 100,
          mode: part.mode,
          t,
          face: (part.left ?? row.left) ? Math.PI : 0,
          dir: part.dir ?? 0,
          elite: false,
          albino: false,
          affixes: [],
          flash: (part.flash ?? row.flash) ? 0.1 : 0,
          data: { ...(row.data ?? {}), ...(part.data ?? {}) },
          tele: null,
          danger: 0,
        };
        rr.time = t0 + t;
        const pose = rr.mobPose(m);
        const fr = paint(m, pose);
        frames.push({ fr, t: t0 + t, mode: part.mode, tm: t, part });
        if (fr) {
          cw = Math.max(cw, fr.img.width + 8);
          ch = Math.max(ch, fr.img.height + 8);
          above = Math.max(above, fr.ay + 4 - Math.min(0, fr.dy ?? 0));
        }
      }
      t0 += count / fps;
    }
    rows.push({ row, frames });
  }
  // Место под метку удара: не меньше 4 клеток в каждую сторону.
  const strikeR = Math.max(0, ...spec.rows.map((r) => (r.strike ? r.strike.r + 0.6 : 0)));
  cw = Math.max(cw, Math.ceil(strikeR * TS * 2));
  const below = Math.max(ch - above, Math.ceil(strikeR * TS));
  ch = above + below;
  const LBL = 12;
  const totalLines = rows.reduce((a, r) => a + Math.ceil(r.frames.length / cols), 0);
  const out = document.createElement('canvas');
  out.width = cols * cw * S;
  out.height = totalLines * (ch * S + LBL) + rows.length * 18;
  const g = out.getContext('2d');
  g.fillStyle = '#16131c';
  g.fillRect(0, 0, out.width, out.height);
  const cell = document.createElement('canvas');
  cell.width = cw;
  cell.height = ch;
  const c = cell.getContext('2d');
  let y = 0;
  for (const { row, frames } of rows) {
    g.fillStyle = '#ffe9a8';
    g.font = 'bold 13px sans-serif';
    g.fillText(`${row.label ?? row.mode} — ${frames.length} кадров, ${fps} к/с`, 6, y + 14);
    y += 18;
    frames.forEach((f, i) => {
      const cx = i % cols;
      if (i && cx === 0) y += ch * S + LBL;
      c.clearRect(0, 0, cw, ch);
      c.fillStyle = '#2a2530';
      c.fillRect(0, 0, cw, ch);
      const px = Math.round(cw / 2);
      const py = above;
      // Пол и точка ног.
      c.fillStyle = '#3a3440';
      c.fillRect(0, py + 2, cw, 1);
      const st = row.strike;
      const hit = row.hit ?? (st ? st.warn : null);
      if (st) {
        const strike = { ...st, x: 0, y: 0, t: Math.min(f.t, st.warn), warn: st.warn, dmg: 1 };
        if (f.t < st.warn) {
          const zp = P.ZONE_PAINTERS.get(st.art);
          if (zp) zp(c, strike, px, py + 2, TS, f.t);
          else {
            // Своей метки нет — контур формы удара, как у движка.
            const R = st.r * TS;
            const k = Math.min(1, f.t / st.warn);
            c.strokeStyle = 'rgba(255,60,40,0.8)';
            c.fillStyle = `rgba(255,60,40,${0.1 + 0.25 * k})`;
            c.beginPath();
            if (st.shape === 'cone') {
              c.moveTo(px, py + 2);
              c.arc(
                px,
                py + 2,
                R,
                (st.ang ?? 0) - (st.arc ?? 1) / 2,
                (st.ang ?? 0) + (st.arc ?? 1) / 2,
              );
              c.closePath();
            } else if (st.shape === 'line') {
              c.save();
              c.translate(px, py + 2);
              c.rotate(st.ang ?? 0);
              c.rect(0, -(st.w ?? 0.5) * TS, R, (st.w ?? 0.5) * TS * 2);
              c.restore();
            } else c.arc(px, py + 2, R, 0, Math.PI * 2);
            c.fill();
            c.stroke();
          }
        } else {
          const imp = P.IMPACT_PAINTERS.get(st.art);
          const age = f.t - st.warn;
          if (imp && age < imp.life) {
            c.save();
            imp.paint(c, { ...st, x: 0, y: 0, seed: 1 }, px, py + 2, TS, age, f.t);
            c.restore();
          }
        }
      }
      const fr = f.fr;
      if (fr) {
        const sx = fr.sx ?? 1;
        const sy = fr.sy ?? 1;
        const rot = fr.rot ?? 0;
        const fx = px + (fr.dx ?? 0);
        const fy = py + 2 + (fr.dy ?? 0);
        const drawAt = (img) => {
          c.save();
          c.globalAlpha = fr.alpha ?? 1;
          c.translate(fx, fy);
          c.rotate(rot);
          c.scale(sx, sy);
          c.drawImage(img, -fr.ax, -fr.ay);
          c.restore();
        };
        if (fr.shadow !== 0) {
          c.fillStyle = 'rgba(0,0,0,0.35)';
          c.beginPath();
          const rx = fr.shadow ?? 0.36 * fr.img.width * 0.7;
          c.ellipse(px, py + 2, Math.max(2, rx), Math.max(1.5, rx * 0.28), 0, 0, Math.PI * 2);
          c.fill();
        }
        drawAt(fr.img);
        if (fr.lit) drawAt(fr.lit);
        if (fr.eye) {
          c.fillStyle = '#ff3a28';
          c.fillRect(Math.round(fx - fr.ax + fr.eye[0]), Math.round(fy - fr.ay + fr.eye[1]), 1, 1);
        }
      } else {
        c.fillStyle = '#ff4040';
        c.fillText('null', 4, 12);
      }
      g.imageSmoothingEnabled = false;
      const ox = cx * cw * S;
      g.drawImage(cell, ox, y, cw * S, ch * S);
      // Кадр удара — в красной рамке; подпись — время и режим.
      const isHit = hit !== null && hit !== undefined && Math.abs(f.t - hit) < 0.5 / fps;
      g.strokeStyle = isHit ? '#ff3030' : '#000';
      g.lineWidth = isHit ? 3 : 1;
      g.strokeRect(ox + 1, y + 1, cw * S - 2, ch * S - 2);
      g.fillStyle = isHit ? '#ff8080' : '#c8c0d8';
      g.font = '10px monospace';
      g.fillText(`${f.t.toFixed(3)} ${f.mode}`, ox + 3, y + ch * S + 10);
    });
    y += ch * S + LBL;
  }
  return out.toDataURL('image/png');
}, spec);
fs.writeFileSync(outPath, Buffer.from(url.split(',')[1], 'base64'));
console.log('лист:', outPath);
if (errs.length) console.log(errs.slice(0, 8).join('\n'));
await b.close();
