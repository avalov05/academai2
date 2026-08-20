// Verify document extraction against real files, including a restricted DOCX.
import { readFileSync, writeFileSync } from 'fs';

// minimal File polyfill over Node buffers
class NodeFile {
  name: string; type: string; private buf: Buffer;
  constructor(path: string, name: string, type = '') { this.buf = readFileSync(path); this.name = name; this.type = type; }
  get size() { return this.buf.length; }
  async arrayBuffer() { return this.buf.buffer.slice(this.buf.byteOffset, this.buf.byteOffset + this.buf.byteLength); }
  async text() { return this.buf.toString('utf8'); }
}
// btoa for the base64 path
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

const { readDocument, buildDocText } = await import('../src/lib/docs');

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('  ✗', m); } };

// ── restricted DOCX ──
const docx = await readDocument(new NodeFile('/tmp/docs/restricted-syllabus.docx', 'restricted-syllabus.docx') as unknown as File);
ok(!docx.failed, 'restricted docx did not fail');
ok(!!docx.text && docx.text.includes('CH 221'), 'docx: heading read');
ok(!!docx.text?.includes('Dabney 210'), 'docx: lecture location read');
ok(!!docx.text?.includes('Problem Set 4'), 'docx: table cell read');
ok(!!docx.text?.includes('18 September 2026'), 'docx: table due date read');
ok(/edit-restricted/i.test(docx.note ?? ''), `docx: restriction detected and reported (note: ${docx.note})`);

// ── PPTX ──
const pptx = await readDocument(new NodeFile('/tmp/docs/deck.pptx', 'deck.pptx') as unknown as File);
ok(!pptx.failed && !!pptx.text, 'pptx read');
ok(!!pptx.text?.includes('BIO 183'), 'pptx: title read');
ok(!!pptx.text?.includes('25 September 2026'), 'pptx: body date read');
ok(!!pptx.text?.includes('Slide 1'), 'pptx: slide markers present');

// ── PDF passes through as base64 for the model ──
const pdf = await readDocument(new NodeFile('/tmp/docs/syllabus.pdf', 'syllabus.pdf', 'application/pdf') as unknown as File);
ok(!pdf.failed, 'pdf accepted');
ok(!!pdf.pdf && pdf.pdf.mime === 'application/pdf', 'pdf: handed over as inline data');
ok(!!pdf.pdf && pdf.pdf.data.length > 100, 'pdf: base64 payload non-trivial');
ok(!pdf.text, 'pdf: not text-parsed (the model reads it)');

// ── a password-to-open file is detected, not silently empty ──
const fakeEnc = Buffer.from('\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1 encrypted office container', 'binary');
writeFileSync('/tmp/docs/locked.docx', fakeEnc);
const locked = await readDocument(new NodeFile('/tmp/docs/locked.docx', 'locked.docx') as unknown as File);
ok(locked.failed === true, 'password-protected docx flagged as failed');
ok(/password/i.test(locked.note ?? ''), 'password-protected docx explains why');

// ── spreadsheet: shared strings + a date table ──
const xlsx = await readDocument(new NodeFile('/tmp/docs/schedule.xlsx', 'schedule.xlsx') as unknown as File);
ok(!xlsx.failed && !!xlsx.text, 'xlsx read');
ok(!!xlsx.text?.includes('Problem Set 1'), 'xlsx: shared-string cell read');
ok(!!xlsx.text?.includes('2026-09-18'), 'xlsx: date cell read');
ok(!!xlsx.text?.includes('\t'), 'xlsx: rows keep column separation');

// ── plain text + html ──
const txt = await readDocument(new NodeFile('/tmp/docs/note.txt', 'note.txt', 'text/plain') as unknown as File);
ok(!!txt.text?.includes('Problem Set 5'), 'txt path reads');
const html = await readDocument(new NodeFile('/tmp/docs/page.html', 'page.html') as unknown as File);
ok(!!html.text?.includes('BIO 183') && !/</.test(html.text ?? ''), 'html path strips tags');

// ── legacy binary formats explain themselves instead of failing silently ──
const legacy = await readDocument(new NodeFile('/tmp/docs/note.txt', 'old-syllabus.doc') as unknown as File);
ok(legacy.failed === true && /Save As/i.test(legacy.note ?? ''), 'legacy .doc gives a fix, not an error');

// ── the picker must not grey out the formats we have messages for ──
const { ACCEPT } = await import('../src/lib/docs');
for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.doc', '.txt', '.rtf', '.csv'])
  ok(ACCEPT.includes(ext), `ACCEPT offers ${ext}`);

// ── the character budget truncates the tail, never the head ──
const big = { name: 'huge.txt', bytes: 0, text: 'x'.repeat(70000) };
const cut = buildDocText([big, { name: 'after.txt', bytes: 0, text: 'SHOULD NOT FIT' }]);
ok(cut.truncated.includes('huge.txt'), 'oversize file reported as truncated');
ok(!cut.text.includes('SHOULD NOT FIT'), 'budget stops before the next file');
ok(cut.text.startsWith('--- FILE: huge.txt ---'), 'truncated file still labelled');

const joined = buildDocText([docx, pptx]);
ok(joined.text.includes('--- FILE: restricted-syllabus.docx ---'), 'buildDocText labels each file');
ok(joined.text.includes('--- FILE: deck.pptx ---'), 'buildDocText includes every file');
ok(joined.truncated.length === 0, 'nothing truncated at this size');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
