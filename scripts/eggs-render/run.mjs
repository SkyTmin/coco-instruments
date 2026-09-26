// Рендер яиц: node scripts/eggs-render/run.mjs [виды через запятую]
//
// Нужно то же, что для кирок и книг (scripts/picks-render/run.mjs): `npm i
// --no-save three@0.170.0` в корне репо, Playwright (PLAYWRIGHT= путь к его
// index.js, если он стоит глобально) и Chromium (CHROME=путь). Снимает
// out/raw_<вид>.png (1024 px); потом `python3 post.py out
// ../../public/ui/eggs` делает WebP 512 px.
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
  .listen(8768);

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const only = process.argv[2] ? process.argv[2].split(',') : ['moss', 'stone', 'crystal', 'dragon'];
for (const t of only) {
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  p.on('pageerror', (e) => console.log('ошибка', e.message));
  await p.goto(`http://127.0.0.1:8768/index.html?t=${t}`);
  await p.waitForFunction('window.done === true', null, { timeout: 90000 });
  const { url, box } = await p.evaluate(() => ({ url: window.eggPNG, box: window.box }));
  fs.writeFileSync(path.join(out, `raw_${t}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('яйцо', t, 'рамка', JSON.stringify(box));
  await p.close();
}
await b.close();
srv.close();
