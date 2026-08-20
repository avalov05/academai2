// Paste the SAME content twice → second pass must be all KNOWN, zero new rows.
import { chromium } from 'playwright';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const TEXT = 'CH221: PS3 extended to Sep 11 11:59pm; weekly reading quizzes Fridays from Sep 4; Labor Day no class.';

await page.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

const countRows = async () => {
  await page.keyboard.press('t'); await page.waitForTimeout(500);
  await page.fill('input[placeholder="SEARCH…"]', 'reading quiz'); await page.waitForTimeout(400);
  const n = await page.locator('table.swiss tbody tr').count();
  await page.fill('input[placeholder="SEARCH…"]', '');
  await page.keyboard.press('Escape'); // blur search so global shortcuts work again
  await page.waitForTimeout(200);
  return n;
};

const pasteAndRead = async () => {
  await page.keyboard.press('v'); await page.waitForTimeout(600);
  await page.fill('textarea', TEXT);
  await page.click('button:has-text("EXTRACT")');
  await page.waitForSelector('button:has-text("COMMIT")', { timeout: 10000 });
  const head = await page.textContent('h2.display');
  return head.replace(/\s+/g, ' ').trim();
};

// pass 1
const v1 = await pasteAndRead();
await page.click('button:has-text("COMMIT")');
await page.waitForTimeout(1200);
const after1 = await countRows();

// pass 2 — identical content
const v2 = await pasteAndRead();
await page.screenshot({ path: '/tmp/shots/15-idempotent.png' });
const commitBtn = await page.textContent('button:has-text("COMMIT")').catch(() => 'COMMIT 0');
// commit again anyway — must not create duplicates
const disabled = await page.locator('button:has-text("COMMIT")').isDisabled();
if (!disabled) { await page.click('button:has-text("COMMIT")'); await page.waitForTimeout(1200); }
else { await page.click('button:has-text("BACK")'); }
const after2 = await countRows();

console.log('pass1 verdicts:', v1);
console.log('pass2 verdicts:', v2);
console.log('commit button pass2:', commitBtn.trim(), '| disabled:', disabled);
console.log('quiz rows after pass1:', after1, '→ after pass2:', after2);
console.log(after1 === after2 ? '✓ IDEMPOTENT — no duplicates' : '✗ DUPLICATES CREATED');
console.log('page errors:', errs.length ? errs.slice(0, 2) : 'none');
await browser.close();
