// Рендер обложек книг: node scripts/books-render/run.mjs
//
// Нужно то же, что для кирок (scripts/picks-render/run.mjs): `npm i
// --no-save three@0.170.0` в корне репо, Playwright (PLAYWRIGHT= путь к
// его index.js, если он стоит глобально) и Chromium (CHROME=путь). Снимает
// out/raw_<ярус>.png (1024 px) и печатает, где центр медальона; потом
// `python3 post.py out ../../public/ui/books` делает WebP 512 px.
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
  .listen(8766);

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const only = process.argv[2] ? process.argv[2].split(',') : ['simple', 'rare', 'epic', 'legend'];
for (const t of only) {
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  p.on('pageerror', (e) => console.log('ошибка', e.message));
  await p.goto(`http://127.0.0.1:8766/index.html?t=${t}`);
  await p.waitForFunction('window.done === true', null, { timeout: 90000 });
  const { url, medal } = await p.evaluate(() => ({ url: window.bookPNG, medal: window.medal }));
  fs.writeFileSync(path.join(out, `raw_${t}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('книга', t, 'медальон', JSON.stringify(medal));
  await p.close();
}
await b.close();
srv.close();
