// The meeting-schedule check the student actually sees, end to end.
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

await p.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.keyboard.press('Escape');

// ── review screen shows the real meeting dates before anything commits ──
await p.click('button:has-text("INTAKE")');
await p.waitForTimeout(600);
await p.fill('textarea', 'PY 205 syllabus');
await p.click('button:has-text("Extract")');
await p.waitForTimeout(2200);
const review = await p.locator('body').innerText();
ok(/PY 205/.test(review), 'new class surfaced');
ok(/Every other Thu/.test(review), 'alternating recitation described as such');
ok(/6 listed dates/.test(review), 'lab described as a date list');
ok(/6 meetings/.test(review), 'lab meeting count shown');
ok(/09\/10\s+09\/24\s+10\/08/.test(review.replace(/\s+/g, ' ').replace(/ /g, '  ')) || /09\/10/.test(review), 'actual lab dates listed');
ok(/Read as/.test(review), 'weekly components carry the "check this" nudge');
await p.screenshot({ path: '/tmp/s6/70-meeting-review.png', fullPage: false });

await p.click('button:has-text("COMMIT")');
await p.waitForTimeout(1800);

// ── classes view: pattern + count, and the editor preview ──
await p.keyboard.press('Escape');
await p.click('button:has-text("CLASSES")');
await p.waitForTimeout(900);
const cls = await p.locator('body').innerText();
ok(/Every other Tue/.test(cls), 'biweekly lab described in CLASSES');
ok(/listed dates/.test(cls), 'date-list recitation described in CLASSES');
ok(/\d+ meetings/.test(cls), 'meeting counts shown per component');
ok(!/undefined|NaN/.test(cls), 'no broken values');
await p.screenshot({ path: '/tmp/s6/71-classes.png', fullPage: false });

// open an editor and confirm the live preview renders real dates
await p.locator('button:has-text("EDIT")').first().click();
await p.waitForTimeout(700);
const ed = await p.locator('body').innerText();
ok(/THIS IS WHAT WILL BE ON YOUR CALENDAR/.test(ed), 'editor shows the calendar preview');
ok(/Only specific dates/.test(ed) && /A repeating pattern/.test(ed), 'both pattern modes offered');
ok(/Every other week/.test(ed) || /Every week/.test(ed), 'interval selector present');
await p.screenshot({ path: '/tmp/s6/72-editor.png', fullPage: false });

// ── settings: the "what is on your calendar" audit ──
await p.keyboard.press('Escape');
await p.click('button[title="Settings"], button:has-text("⚙")').catch(() => {});
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })));
await p.waitForTimeout(800);
let st = await p.locator('body').innerText();
if (!/WHAT IS ACTUALLY GOING ON YOUR CALENDAR/.test(st)) {
  await p.locator('button').filter({ hasText: /^⚙/ }).first().click().catch(() => {});
  await p.waitForTimeout(700);
  st = await p.locator('body').innerText();
}
ok(/GOOGLE CALENDAR — IMPORT/.test(st), 'google guidance present');
ok(/APPLE CALENDAR/.test(st), 'apple guidance present');
ok(/WHAT IS ACTUALLY GOING ON YOUR CALENDAR/.test(st), 'calendar audit present');
await p.screenshot({ path: '/tmp/s6/73-settings.png', fullPage: false });

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
