// Рендер кирок: node scripts/picks-render/run.mjs [номера через запятую]
//
// Нужно: `npm i --no-save three@0.170.0` в корне репо (в зависимости
// проекта three не входит — он нужен только здесь), Playwright (PLAYWRIGHT=
// путь к его index.js, если он стоит глобально) и Chromium (CHROME=путь).
// Скрипт сам поднимает статический сервер на порту 8765, снимает кирки в
// out/raw_N.png (1280 px), потом `python3 post.py out
// ../../public/ui/picks/v2` делает WebP 640 px.
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
    // three лежит в node_modules корня репо.
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
  .listen(8765);

const b = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : [...Array(17).keys()];
for (const i of only) {
  const p = await b.newPage({ viewport: { width: 1280, height: 1280 } });
  await p.goto(`http://127.0.0.1:8765/index.html?i=${i}`);
  await p.waitForFunction('window.done === true', null, { timeout: 60000 });
  const url = await p.evaluate(() => window.pickPNG);
  fs.writeFileSync(path.join(out, `raw_${i}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('кирка', i);
  await p.close();
}
await b.close();
srv.close();
