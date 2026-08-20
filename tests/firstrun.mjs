// Verify the cold-start screen renders when the DB is empty
import pw from 'playwright';
const { chromium } = pw;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })).newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await page.goto('http://localhost:3778', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/shots/30-firstrun.png' });
console.log('cold start visible:', await page.locator('text=INITIALIZE').isVisible());
// set semester
await page.click('button:has-text("SET ⟶")');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots/31-firstrun-step2.png' });
const s2 = await page.locator('text=ARM THE EXTRACTION ENGINE').isVisible();
console.log('step 2 reached:', s2);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
