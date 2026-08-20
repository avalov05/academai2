// ── E2E: real files through the real <input type=file> in a real browser ──
import pw from 'playwright';
const { chromium } = pw;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
const net = []; page.on('request', r => { if (r.url().includes('/api/extract')) net.push(r.postData() || ''); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗', m); } };

await page.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// go to intake
await page.keyboard.press('Escape');
await page.click('button:has-text("INTAKE")');
await page.waitForTimeout(700);

ok(await page.locator('text=PDF · DOCX · PPTX · XLSX').isVisible(), 'affordance hint visible before upload');

// upload all four fixtures at once
await page.setInputFiles('input[type=file]', [
  '/tmp/docs/restricted-syllabus.docx',
  '/tmp/docs/deck.pptx',
  '/tmp/docs/syllabus.pdf',
  '/tmp/docs/locked.docx',
]);
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/s6/40-upload-list.png' });

const listText = await page.locator('.panel.corner').first().innerText();
ok(/restricted-syllabus\.docx/.test(listText), 'docx row present');
ok(/deck\.pptx/.test(listText), 'pptx row present');
ok(/syllabus\.pdf/.test(listText), 'pdf row present');
ok(/locked\.docx/.test(listText), 'locked docx row present');
ok(/characters read/.test(listText), 'character counts shown');
ok(/sent to the reader as-is/.test(listText), 'pdf handed to model, not text-parsed');
ok(/edit-restricted/i.test(listText), 'restricted docx flagged but read');
ok(/password/i.test(listText), 'encrypted file explains itself');
ok(/4 attached/.test(listText), 'attachment counter correct');

// chips
const chips = await page.locator('.panel.corner .chip').allInnerTexts();
ok(chips.includes('PDF') && chips.includes('DOCX') && chips.includes('PPTX'), 'type chips: ' + chips.join(','));

// no overflow from long filenames
const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(of === 0, 'no horizontal overflow, got ' + of);

// remove one file — the pptx, so the docx/pdf/locked assertions below still mean something
await page.locator('.panel.corner button.danger').nth(1).click();
await page.waitForTimeout(400);
const afterRemove = await page.locator('.panel.corner').first().innerText();
ok(/3 attached/.test(afterRemove) && !/deck\.pptx/.test(afterRemove), 'remove button drops the right row');

// extract — verify the payload actually carries the pdf + the docx text
await page.click('button:has-text("Extract")');
await page.waitForTimeout(2500);
const body = net.length ? JSON.parse(net[net.length - 1]) : {};
ok(Array.isArray(body.pdfs) && body.pdfs.length === 1, 'payload carries 1 pdf, got ' + (body.pdfs?.length ?? 'none'));
ok((body.pdfs?.[0]?.mime) === 'application/pdf', 'pdf mime correct');
ok((body.pdfs?.[0]?.data || '').length > 500, 'pdf base64 non-trivial');
ok(/--- FILE: restricted-syllabus\.docx ---/.test(body.text || ''), 'docx text inlined with file header');
ok(/CH 221/.test(body.text || ''), 'restricted docx CONTENT reached the payload');
ok(!/locked\.docx/.test(body.text || ''), 'failed file excluded from payload');

await page.screenshot({ path: '/tmp/s6/41-upload-review.png' });
ok(await page.locator('text=REVIEW').first().isVisible().catch(() => false), 'review stage reached');

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
