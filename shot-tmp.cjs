const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error') errs.push(t.slice(0, 300)); });
  p.on('pageerror', e => errs.push('PAGEERR ' + String(e).slice(0, 300)));
  await p.addInitScript(() => { window.__f = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => r((t) => { window.__f++; cb(t); }); });
  await p.goto('http://localhost:5179/labs/swarm/?webgl&enemy=robots&bigdeath=0.1&dt=0.05&flat&manual', { waitUntil: 'load' });
  const want = [[34, 'a'], [47, 'b']]; let k = 0;
  for (let i = 0; i < 2700 && k < want.length; i++) {
    await p.waitForTimeout(100);
    const f = await p.evaluate(() => window.__f).catch(() => -1);
    if (i % 200 === 0) console.log('t', i / 10, 'frames', f);
    if (f >= want[k][0]) { await p.screenshot({ path: `/tmp/claude-0/nova-${want[k][1]}.png` }); console.log('shot', want[k][1], f); k++; }
  }
  console.log(errs.slice(0, 15).join('\n'));
  await b.close();
})();
