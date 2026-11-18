// Headless frame renderer: node render.cjs --out frames --start 0 --end 1500 [--w 1920 --h 1080 --q high --step 1]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const OUT = path.resolve(args.out || 'frames');
const FPS = +(args.fps || 30);
const START = +(args.start || 0), END = +(args.end || 1500), STEP = +(args.step || 1);
const Wd = +(args.w || 1920), Ht = +(args.h || 1080), Q = args.q || 'high';
const TIMES = args.times ? args.times.split(',').map(Number) : null;
fs.mkdirSync(OUT, { recursive: true });

const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: Wd, height: Ht } });
  page.on('console', m => { if (!m.text().includes('useProgram')) console.log('[page]', m.type(), m.text().slice(0, 1500)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/index.html?w=${Wd}&h=${Ht}&q=${Q}${args.msaa ? "&msaa=" + args.msaa : ""}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 600000 });
  console.log(`scene ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const list = TIMES ? TIMES.map(t => Math.round(t * FPS)) : [];
  if (!TIMES) for (let f = START; f < END; f += STEP) list.push(f);
  for (const f of list) {
    const file = path.join(OUT, `f${String(f).padStart(5, '0')}.jpg`);
    if (fs.existsSync(file) && !args.force) continue;
    const t1 = Date.now();
    const data = await page.evaluate(t => window.getFrame(t, 0.95), f / FPS);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`frame ${f} (t=${(f / FPS).toFixed(2)}) ${(Date.now() - t1)}ms`);
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
