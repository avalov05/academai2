import pw from 'playwright';
const { chromium, devices } = pw;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text().slice(0, 160)); });
await page.goto('http://localhost:3777', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const diag = await page.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity, dis: getComputedStyle(e).display }; };
  return {
    scrollY: window.scrollY, innerH: window.innerHeight, bodyH: document.body.scrollHeight,
    topbar: q('.topbar'), brand: q('.brand'), nav: q('.nav'), main: q('.main'),
    canvas: q('.radar-wrap canvas'), shell: q('.shell'),
    text: (document.querySelector('.topbar')?.innerText || 'NO TOPBAR').slice(0, 80),
  };
});
console.log(JSON.stringify(diag, null, 1));
console.log('errors:', errs.slice(0, 4));
await page.screenshot({ path: '/tmp/shots/22-mobile-debug.png' });
await browser.close();
