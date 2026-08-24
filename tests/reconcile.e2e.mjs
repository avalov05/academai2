// Cross-check UI: misfiled items, duplicates, orphans, and the class picker.
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

await p.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await p.waitForTimeout(1400);
await p.keyboard.press('Escape');

// ── before: "Problem Set 4" is sitting on the wrong course ───────────────
const rowsFor = async q => {
  await p.keyboard.press('Escape');
  await p.click('button:has-text("MANIFEST")');
  await p.waitForTimeout(500);
  await p.fill('input[placeholder="SEARCH…"]', q);
  await p.waitForTimeout(450);
  const texts = await p.locator('table.swiss tbody tr').allInnerTexts();
  await p.fill('input[placeholder="SEARCH…"]', '');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  return texts;
};
const before = await rowsFor('Problem Set 4');
ok(before.length === 1, `one copy exists to start with (${before.length})`);
ok(/BIO 183/.test(before[0]), `and it is on the wrong course: ${before[0].replace(/\s+/g, ' ').slice(0, 70)}`);

// ── run the CH 221 syllabus through intake ───────────────────────────────
await p.click('button:has-text("INTAKE")');
await p.waitForTimeout(600);
await p.fill('textarea', 'CH 221 syllabus');
await p.click('button:has-text("Extract")');
await p.waitForTimeout(2200);
let t = await p.locator('body').innerText();

ok(/MISFILED/i.test(t), 'the header counts what is misfiled');
ok(/TO FIX/i.test(t), 'and what it proposes to fix');
ok(/CROSS-CHECK AGAINST WHAT YOU ALREADY TRACK/i.test(t), 'the cross-check panel is shown');
ok(/wrong course/i.test(t), 'the misfiled section is labelled');
await p.screenshot({ path: '/tmp/s6/B0-corrections.png' });

// ── the three kinds of finding ───────────────────────────────────────────
ok(/MOVE TO THE RIGHT COURSE/i.test(t), 'reassignments are grouped');
ok(/TRACKED TWICE/i.test(t), 'duplicates are grouped');
ok(/NOT IN THIS SYLLABUS/i.test(t), 'orphans are grouped');
ok(/BIO 183/.test(t) && /CH 221/.test(t), 'both courses are named in the reassignment');

// reassignments are ticked; orphans are not
const panel = p.locator('.panel.corner').filter({ hasText: 'CROSS-CHECK' });
const boxes = panel.locator('input[type=checkbox]');
const n = await boxes.count();
ok(n >= 3, `every finding has a checkbox (${n})`);
const checked = await panel.locator('input[type=checkbox]:checked').count();
ok(checked >= 1 && checked < n, `corrections are on and orphans are off by default (${checked}/${n})`);

// ── the class picker is on every row and actually re-files ───────────────
ok(await p.locator('select').count() > 0, 'rows carry a course picker');
// .panel.verdict-NEW also matches the new-class card, which has no picker
const firstRow = p.locator('.panel.verdict-NEW').filter({ has: p.locator('select') }).first();
const sel = firstRow.locator('select').first();
const optionCount = await sel.locator('option').count();
ok(optionCount >= 4, `the picker offers every class (${optionCount} options)`);
const beforePick = await sel.inputValue();
await sel.selectOption({ label: 'MA 242' });
await p.waitForTimeout(350);
ok(await sel.inputValue() !== beforePick, 'picking a different course sticks');
ok(/you set this course/i.test(await firstRow.innerText()), 'and the row says you chose it');
// put it back
await sel.selectOption({ label: 'CH 221' });
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/s6/B1-picker.png' });

// ── commit, and check the misfiled item MOVED rather than duplicating ────
await p.click('button:has-text("COMMIT")');
await p.waitForTimeout(2200);
const after = await rowsFor('Problem Set 4');
ok(after.length === 1, `still exactly one copy after committing, not two (${after.length})`);
ok(/CH 221/.test(after[0]), `and it is now on the right course: ${after[0].replace(/\s+/g, ' ').slice(0, 70)}`);
ok(!/BIO 183/.test(after.join(' ')), 'nothing is left behind on the old course');
await p.screenshot({ path: '/tmp/s6/B2-after.png' });

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
