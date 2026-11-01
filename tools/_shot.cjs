const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message.slice(0, 300)));
  await p.goto('http://localhost:5179/labs/walker/' + process.argv[2], { waitUntil: 'load' });
  await p.waitForTimeout(+process.argv[4] || 25000);
  await p.screenshot({ path: process.argv[3], timeout: 90000 });
  console.log(errs.slice(0, 12).join('\n'));
  await b.close();
})();
