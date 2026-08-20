import pw from 'playwright';
const { chromium, devices } = pw;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
await page.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/shots/20-mobile-radar.png' });
// nav to today by tapping
await page.click('button:has-text("TODAY")');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots/21-mobile-today.png', fullPage: false });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('horizontal overflow px:', overflow);
await browser.close();
