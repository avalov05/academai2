// The intake failure panel and the key checker.
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
await p.click('button:has-text("INTAKE")');
await p.waitForTimeout(600);

const runWith = async kind => {
  await p.evaluate(k => { window.__simulate = k; }, kind);
  await p.fill('textarea', 'anything');
  await p.click('button:has-text("Extract")');
  await p.waitForTimeout(1400);
  return p.locator('body').innerText();
};

// ── a bad key ────────────────────────────────────────────────────────────
let t = await runWith('key');
ok(/EXTRACTION FAILED/.test(t), 'the failure is shown in the page, not a toast that vanishes');
ok(/that api key was rejected/i.test(t), 'the headline names the actual cause');
ok(/API key not valid/.test(t), "Google's own message is visible");
ok(/aistudio\.google\.com|AIza/.test(t), 'it says where to get a real key');
ok(/Open settings/.test(t) && /Get a free key/.test(t), 'both fixes are one click away');
await p.screenshot({ path: '/tmp/s6/A0-fail-key.png' });

// the attempt list is there for when the headline is not enough
await p.click('button:has-text("What was tried")');
await p.waitForTimeout(400);
t = await p.locator('body').innerText();
ok(/gemini-2\.5-flash/.test(t), 'each model tried is listed');
ok(/RETRY WITHOUT STRICT FORMAT/.test(t), 'the schema-free retry is visible');
ok(/404|400/.test(t), 'with the status Google returned');
await p.screenshot({ path: '/tmp/s6/A1-fail-detail.png' });

// ── it clears, and other kinds read differently ──────────────────────────
await p.click('button:has-text("Dismiss")');
await p.waitForTimeout(300);
ok(!/EXTRACTION FAILED/.test(await p.locator('body').innerText()), 'dismiss clears it');

t = await runWith('quota');
ok(/out of free quota/i.test(t), 'quota reads as quota');
ok(/free-tier limit|Wait a minute/.test(t), 'and says what to do');

t = await runWith('missing-model');
ok(/no usable model/i.test(t), 'a missing model reads as a missing model');
ok(/Check key/.test(t), 'and points at the button that resolves it');

// ── a successful run clears the panel ────────────────────────────────────
await p.evaluate(() => { window.__simulate = undefined; });
await p.fill('textarea', 'PY 205 syllabus');
await p.click('button:has-text("Extract")');
await p.waitForTimeout(1800);
t = await p.locator('body').innerText();
ok(!/EXTRACTION FAILED/.test(t), 'a good run clears the failure');
ok(/REVIEW BEFORE COMMIT/.test(t), 'and reaches review');

// ── the key checker ──────────────────────────────────────────────────────
await p.keyboard.press('Escape');
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })));
await p.waitForTimeout(800);
let st = await p.locator('body').innerText();
if (!/EXTRACTION ENGINE/.test(st)) {
  await p.locator('button').filter({ hasText: /^⚙/ }).first().click().catch(() => {});
  await p.waitForTimeout(700);
}
await p.click('button:has-text("Check key")');
await p.waitForTimeout(1200);
st = await p.locator('body').innerText();
ok(/KEY WORKS/.test(st), 'the checker reports back');
ok(/MODELS AVAILABLE/.test(st), 'and says how many models the key can use');
ok(/gemini-2\.5-flash/.test(st), 'listing them by name');
const opts = await p.locator('select').first().locator('option').allInnerTexts();
ok(opts.some(o => /gemini/.test(o)), `the model picker is populated: ${opts.slice(0, 3).join(', ')}`);
await p.screenshot({ path: '/tmp/s6/A2-keycheck.png' });

// a key that is obviously not a Gemini key is called out before saving
await p.fill('input[placeholder="Paste your Gemini API key"]', 'AQ.Ab8RN6J1uecko_r87O2');
await p.waitForTimeout(350);
ok(/do not look like a Gemini API key|does not look like a Gemini API key/.test(await p.locator('body').innerText()),
   'a wrong-shaped key is flagged as you type');
await p.screenshot({ path: '/tmp/s6/A3-keyshape.png' });

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
