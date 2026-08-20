// E2E: extract → review → commit → verify manifest & radar state
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

await page.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

// intake → extract → commit
await page.keyboard.press('v');
await page.fill('textarea', 'CH221: PS3 extended to Sep 11 11:59pm; weekly reading quizzes Fridays from Sep 4; Labor Day no class.');
await page.click('button:has-text("EXTRACT")');
await page.waitForSelector('button:has-text("COMMIT")', { timeout: 8000 });
await page.click('button:has-text("COMMIT")');
await page.waitForTimeout(1200);
const toast = await page.textContent('body');
console.log('commit toast present:', /Committed:/.test(toast));

// manifest shows the new quizzes
await page.keyboard.press('t');
await page.waitForTimeout(600);
await page.fill('input[placeholder="SEARCH…"]', 'reading quiz');
await page.waitForTimeout(400);
const rows = await page.locator('table.swiss tbody tr').count();
console.log('reading quiz rows:', rows);
await page.screenshot({ path: '/tmp/shots/13-after-commit-table.png' });

// mark one done via checkbox → integrity
await page.fill('input[placeholder="SEARCH…"]', '');
await page.waitForTimeout(300);

// keyboard nav: j j x (toggle done)
await page.click('table.swiss tbody tr:first-child');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// quick add via palette
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.type('+ email advisor about thesis tomorrow');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const body2 = await page.textContent('body');
console.log('quick-add worked:', /email advisor/i.test(body2));
await page.keyboard.press('Escape');

// radar after commit
await page.keyboard.press('r');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shots/14-radar-after.png' });

// undated flow: quick add with no date lands in detail panel
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
