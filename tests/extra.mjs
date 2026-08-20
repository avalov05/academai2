import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0,160)));
await p.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await p.waitForTimeout(2400);
// open the manifest, then the detail slide-over for the first row
await p.click('nav button:has-text("MANIFEST")');
await p.waitForTimeout(800);
await p.click('table.swiss tbody tr:nth-child(3)');
await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/s6/20-detail.png' });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
// toast: mark something done from the table
await p.click('table.swiss tbody tr:nth-child(2) input[type=checkbox]');
await p.waitForTimeout(700);
await p.screenshot({ path: '/tmp/s6/21-toast.png' });
console.log('errors:', errs.length ? errs.slice(0,3) : 'none');
await b.close();
