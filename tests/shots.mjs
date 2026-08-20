// Screenshot every view
import pw from 'playwright';
const { chromium } = pw;
const BASE = 'http://localhost:3777';
const outDir = '/tmp/shots4';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
// sweep the cursor through the filament field so the disturbance shows
await page.mouse.move(300, 300);
for (let i = 0; i < 26; i++) { await page.mouse.move(300 + i * 22, 300 + Math.sin(i / 3) * 90); await page.waitForTimeout(16); }
await page.waitForTimeout(240);
await page.screenshot({ path: `${outDir}/01-radar.png` });

const views = [['d', '02-today'], ['t', '03-table'], ['v', '04-intake'], ['w', '05-plan'], ['c', '06-classes'], ['g', '07-grades'], ['s', '08-settings']];
for (const [key, name] of views) {
  await page.mouse.click(200, 120);
  await page.keyboard.press(key);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}
await page.keyboard.press('Escape');
await page.keyboard.press('p');
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/09-panic.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/10-palette.png` });
await page.keyboard.press('Escape');

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2400);
await page.click('nav button:has-text("INTAKE")');
await page.waitForTimeout(800);
await page.fill('textarea', 'CH221 announcement: PS3 extended to Sep 11 11:59pm. Weekly reading quizzes on Fridays start Sep 4. No class Labor Day.');
await page.click('button:has-text("EXTRACT")');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${outDir}/11-review.png` });

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${outDir}/12-login.png` });
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
