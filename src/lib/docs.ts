// ── Document intake ───────────────────────────────────────────────────────
// Turns whatever the student drops in — syllabus PDF, Word doc, slide deck,
// plain text — into something the extractor can read.
//
// PDFs are handed to Gemini as-is: it reads them natively, including scanned
// ones, which no text parser would manage.
//
// Office files (.docx/.pptx/.xlsx) are just ZIP archives of XML, so we unzip
// them in the browser and pull the text out. This is also why "restricted"
// documents work: Word's Restrict Editing / read-only recommended / final
// flags are settings inside the archive, not encryption — the text sits in
// word/document.xml in the clear either way. The one case that genuinely
// cannot be read is a file with a password required to *open* it, which is
// AES-encrypted; we detect that and say so rather than failing silently.
import { unzipSync } from 'fflate';

// legacy .doc/.ppt/.xls are listed on purpose: the picker lets them through so
// the student gets the "Save As .docx" explanation instead of a greyed-out file
export const ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.docm,.pptm,.xlsm,.doc,.ppt,.xls,'
  + '.txt,.md,.markdown,.csv,.tsv,.json,.rtf,.html,.htm,image/*';

export const MAX_PDF_BYTES = 14 * 1024 * 1024;   // Gemini inline request ceiling
export const MAX_TEXT_CHARS = 60000;

export interface DocResult {
  name: string;
  bytes: number;
  /** text pulled out of the document, if any */
  text?: string;
  /** PDFs ride along to Gemini as inline data */
  pdf?: { mime: string; data: string };
  /** images ride along too */
  image?: { mime: string; data: string };
  /** something the student should know (truncation, partial read, failure) */
  note?: string;
  failed?: boolean;
}

const dec = new TextDecoder();

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Word: paragraphs → newlines, tabs → tabs, then strip the XML. */
function docxToText(files: Record<string, Uint8Array>): string {
  const parts: string[] = [];
  const order = Object.keys(files)
    .filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))
    .sort((a, b) => (a.startsWith('word/document') ? -1 : b.startsWith('word/document') ? 1 : a.localeCompare(b)));
  for (const name of order) {
    let xml = dec.decode(files[name]);
    xml = xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, ' · ')
      .replace(/<[^>]+>/g, '');
    parts.push(decodeEntities(xml));
  }
  return tidy(parts.join('\n'));
}

/** PowerPoint: every <a:t> run on every slide, slides in numeric order. */
function pptxToText(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)![1]);
      const nb = Number(b.match(/slide(\d+)/)![1]);
      return na - nb;
    });
  const out: string[] = [];
  slides.forEach((name, i) => {
    const xml = dec.decode(files[name]);
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeEntities(m[1]));
    if (runs.length) out.push(`--- Slide ${i + 1} ---\n${runs.join('\n')}`);
  });
  return tidy(out.join('\n\n'));
}

/** Excel: shared strings plus inline cell text — enough to read a date table. */
function xlsxToText(files: Record<string, Uint8Array>): string {
  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) {
    const xml = dec.decode(ss);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const runs = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]);
      shared.push(decodeEntities(runs.join('')));
    }
  }
  const out: string[] = [];
  const sheets = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  for (const name of sheets) {
    const xml = dec.decode(files[name]);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const isShared = /t="s"/.test(c[1]);
        const v = c[2].match(/<v>([\s\S]*?)<\/v>/);
        const inline = c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (inline) cells.push(decodeEntities(inline[1]));
        else if (v) cells.push(isShared ? (shared[Number(v[1])] ?? '') : v[1]);
      }
      if (cells.some(x => x.trim())) out.push(cells.join('\t'));
    }
  }
  return tidy(out.join('\n'));
}

/** RTF: drop control words and groups, keep the words. */
function rtfToText(raw: string): string {
  return tidy(
    raw
      .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\{\\\*[\s\S]*?\}/g, '')
      .replace(/\\[a-z]+-?\d*\s?/gi, '')
      .replace(/[{}]/g, ''),
  );
}

function htmlToText(raw: string): string {
  return tidy(
    decodeEntities(
      raw
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<br\b[^>]*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export async function readDocument(file: File): Promise<DocResult> {
  const name = file.name;
  const bytes = file.size;
  const lower = name.toLowerCase();
  const base: DocResult = { name, bytes };

  try {
    // ── images ──
    if (file.type.startsWith('image/')) {
      const b64 = toBase64(await file.arrayBuffer());
      return { ...base, image: { mime: file.type, data: b64 } };
    }

    // ── PDF: Gemini reads these natively, scans included ──
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      if (bytes > MAX_PDF_BYTES) {
        return { ...base, failed: true, note: `PDF is ${(bytes / 1048576).toFixed(1)} MB — over the ${MAX_PDF_BYTES / 1048576} MB limit. Split it or export the pages you need.` };
      }
      const buf = await file.arrayBuffer();
      const head = dec.decode(new Uint8Array(buf.slice(0, 1024)));
      const b64 = toBase64(buf);
      // an /Encrypt dictionary means a password is required to open it
      const note = /\/Encrypt\b/.test(head)
        ? 'This PDF looks password-protected. If extraction comes back empty, open it and re-save without the password.'
        : undefined;
      return { ...base, pdf: { mime: 'application/pdf', data: b64 }, note };
    }

    // ── plain text family ──
    if (/\.(txt|md|markdown|csv|tsv|json)$/.test(lower) || file.type.startsWith('text/plain')) {
      return { ...base, text: tidy(await file.text()) };
    }
    if (lower.endsWith('.rtf')) return { ...base, text: rtfToText(await file.text()) };
    if (/\.(html?|xhtml)$/.test(lower)) return { ...base, text: htmlToText(await file.text()) };

    // ── office open XML (zip) ──
    if (/\.(docx|pptx|xlsx|docm|pptm|xlsm)$/.test(lower)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isZip = ZIP_MAGIC.every((b, i) => buf[i] === b);
      if (!isZip) {
        return {
          ...base, failed: true,
          note: 'This file needs a password to open, so its contents are encrypted and cannot be read. Open it, remove the password, and re-save — or print it to PDF.',
        };
      }
      const files = unzipSync(buf);
      let text = '';
      if (/\.(docx|docm)$/.test(lower)) text = docxToText(files);
      else if (/\.(pptx|pptm)$/.test(lower)) text = pptxToText(files);
      else text = xlsxToText(files);

      if (!text.trim()) {
        return { ...base, failed: true, note: 'No readable text found — if it is a scan, export it as a PDF instead and the extractor will read the images.' };
      }
      // Restrict Editing / read-only recommended live in settings.xml and do
      // not touch the text, so this path already handles "restricted" files.
      const restricted = !!files['word/settings.xml']
        && /<w:documentProtection\b/.test(dec.decode(files['word/settings.xml']));
      return {
        ...base, text,
        note: restricted ? 'Document is edit-restricted — text read anyway.' : undefined,
      };
    }

    // ── legacy binary Word ──
    if (/\.(doc|ppt|xls)$/.test(lower)) {
      return {
        ...base, failed: true,
        note: 'Old Office format. Open it and "Save As" .docx or PDF, then drop it back in.',
      };
    }

    // ── last resort: try it as text ──
    const guess = tidy(await file.text());
    if (guess && /[a-z]{4}/i.test(guess)) return { ...base, text: guess };
    return { ...base, failed: true, note: 'Unsupported file type. PDF, DOCX, PPTX, XLSX, TXT, RTF, HTML and images all work.' };
  } catch (e) {
    return { ...base, failed: true, note: `Could not read this file: ${(e as Error).message}` };
  }
}

/** Join every document's text into one block for the extractor. */
export function buildDocText(docs: DocResult[]): { text: string; truncated: string[] } {
  const chunks: string[] = [];
  const truncated: string[] = [];
  let budget = MAX_TEXT_CHARS;
  for (const d of docs) {
    if (!d.text) continue;
    let t = d.text;
    if (t.length > budget) { t = t.slice(0, Math.max(0, budget)); truncated.push(d.name); }
    budget -= t.length;
    if (t) chunks.push(`--- FILE: ${d.name} ---\n${t}`);
    if (budget <= 0) break;
  }
  return { text: chunks.join('\n\n'), truncated };
}
