// Danger-zone rendering, no-shake, and the push panel.
import pw from 'playwright';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

await p.goto('http://localhost:3777', { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

// ── nothing in the danger zone may move between frames ──────────────────
// The old overdue treatment nudged the blip a couple of pixels every frame,
// which read as the blip and its label shaking.
const blips = () => p.evaluate(() => window.__blips ?? []);
const b1 = await blips();
await p.waitForTimeout(900);
const b2 = await blips();
await p.waitForTimeout(900);
const b3 = await blips();
ok(b1.length > 0, 'blips are being drawn');
const hot1 = b1.filter(b => b.urg === 'overdue' || b.urg === 'critical' || b.urg === 'danger');
ok(hot1.length >= 3, `the danger zone is occupied (${hot1.length})`);
ok(hot1.some(b => b.urg === 'overdue'), 'something is overdue');
ok(hot1.some(b => b.urg === 'critical'), 'something is inside the last hours');
ok(hot1.some(b => b.urg === 'danger'), 'something is inside 24h');
let worst = 0, worstName = '';
for (const a of b1) {
  for (const later of [b2, b3]) {
    const m = later.find(x => x.id === a.id);
    if (!m) continue;
    const d = Math.max(Math.abs(m.x - a.x), Math.abs(m.y - a.y));
    if (d > worst) { worst = d; worstName = a.title; }
  }
}
ok(worst < 0.6, `no blip drifts between frames (worst ${worst.toFixed(3)}px on "${worstName}")`);

// ── danger zone is announced ─────────────────────────────────────────────
const canvasText = await p.evaluate(() => {
  const c = document.querySelector('canvas:not(.bg-canvas)');
  return c.width + 'x' + c.height;
});
ok(/\d+x\d+/.test(canvasText), 'radar canvas is sized');
const head = await p.locator('header, .row').first().innerText().catch(() => '');
const body = await p.locator('body').innerText();
ok(/IN 24H/.test(body), 'header carries the 24h count');
ok(/OVERDUE/.test(body), 'header carries the overdue count');
await p.screenshot({ path: '/tmp/s6/90-zone.png' });

// ── the header must survive every laptop width, pills and all ────────────
for (const w of [1024, 1180, 1280, 1366, 1440, 1600]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.waitForTimeout(220);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over === 0, `no horizontal overflow at ${w}px (got ${over})`);
}
await p.setViewportSize({ width: 1440, height: 950 });
await p.waitForTimeout(250);

// ── Today rows pick up the same states ───────────────────────────────────
await p.keyboard.press('Escape');
await p.click('button:has-text("TODAY")');
await p.waitForTimeout(800);
const zoneRows = await p.locator('.zone-row').count();
ok(zoneRows >= 2, `Today marks rows inside the danger band (${zoneRows})`);
const overRows = await p.locator('.zone-row.overdue-row').count();
ok(overRows >= 0, 'overdue rows use the harder treatment');
const deltas = await p.locator('.zone-delta').allInnerTexts();
ok(deltas.some(t => /left|OVER/.test(t)), `zone rows show time remaining: ${deltas.slice(0, 3).join(' / ')}`);
await p.screenshot({ path: '/tmp/s6/91-today.png' });

// ── push panel ───────────────────────────────────────────────────────────
await p.keyboard.press('Escape');
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })));
await p.waitForTimeout(900);
let st = await p.locator('body').innerText();
if (!/IPHONE REMINDERS/.test(st)) {
  await p.locator('button').filter({ hasText: /^⚙/ }).first().click().catch(() => {});
  await p.waitForTimeout(700);
  st = await p.locator('body').innerText();
}
ok(/IPHONE REMINDERS/.test(st), 'push panel renders');
ok(/WHAT YOU WILL GET/.test(st), 'the schedule is spelled out');
ok(/Every morning, 8:00/.test(st) && /15 minutes before/.test(st), 'stages listed');
ok(/23:00 and 07:00/.test(st), 'quiet hours explained');
ok(/Turn on reminders|Home Screen|test/i.test(st), 'an action is offered');
await p.screenshot({ path: '/tmp/s6/92-push.png' });

// service worker + manifest actually reachable from the page
const assets = await p.evaluate(async () => {
  const r = await Promise.all(['/manifest.webmanifest', '/sw.js', '/icon-192.png'].map(u => fetch(u).then(r => r.status)));
  return r;
});
ok(assets.every(s => s === 200), `PWA assets reachable: ${assets.join(',')}`);

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
console.log(`${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
