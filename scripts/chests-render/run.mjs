// Рендер сундуков: node scripts/chests-render/run.mjs [ярусы через запятую]
//
// Нужно то же, что для кирок и книг (scripts/picks-render/run.mjs): `npm i
// --no-save three@0.170.0` в корне репо, Playwright (PLAYWRIGHT= путь к его
// index.js, если он стоит глобально) и Chromium (CHROME=путь). Снимает
// out/raw_<ярус>-<closed|open>.png (1024 px); потом `python3 post.py out
// ../../public/ui/chests` делает WebP 512 px.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http
  .createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const base = u.startsWith('/node_modules/') ? root : here;
    const f = path.join(base, u);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(8767);

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const only = process.argv[2] ? process.argv[2].split(',') : ['common', 'rare', 'epic', 'legend'];
for (const t of only)
  for (const s of ['closed', 'open']) {
    const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
    p.on('pageerror', (e) => console.log('ошибка', e.message));
    await p.goto(`http://127.0.0.1:8767/index.html?t=${t}&s=${s}`);
    await p.waitForFunction('window.done === true', null, { timeout: 90000 });
    const { url, lock } = await p.evaluate(() => ({ url: window.chestPNG, lock: window.lock }));
    fs.writeFileSync(path.join(out, `raw_${t}-${s}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('сундук', t, s, 'замок', JSON.stringify(lock));
    await p.close();
  }
await b.close();
srv.close();
