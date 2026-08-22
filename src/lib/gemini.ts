// ── Gemini extraction: prompt, strict schema, fallback chain ─────────────
// Server-side only (called from /api/extract).

// Ordered by "most likely to exist and be fast". Anything unknown 404s cheaply
// and we move on, so speculative newer names cost nothing but are not first.
export const MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-3-flash',
  'gemini-3-pro',
];

/** Models whose output ceiling is 8192, not 65536. */
const SMALL_OUTPUT = /2\.0-flash|1\.5-flash|flash-8b|flash-lite/;
const maxTokensFor = (model: string) => (SMALL_OUTPUT.test(model) ? 8192 : 16384);

export interface ExtractContext {
  todayEt: string;                    // YYYY-MM-DD
  semester: { name: string; start_date: string; end_date: string } | null;
  knownClasses: Array<{ code: string; name: string }>;
}

// Gemini structured-output schema (OpenAPI subset)
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    detected_class_code: { type: 'STRING', description: 'Course code this content belongs to, e.g. "CH 221", or "" if none/multiple' },
    classes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          code: { type: 'STRING' }, name: { type: 'STRING' },
          components: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                kind: { type: 'STRING', enum: ['LEC', 'REC', 'LAB', 'SEM', 'STU', 'OTH'] },
                title: { type: 'STRING' },
                location: { type: 'STRING' },
                is_async: { type: 'BOOLEAN' },
                days: {
                  type: 'ARRAY',
                  description: 'ONLY for a real repeating weekday pattern. Leave EMPTY when the syllabus lists specific meeting dates — put those in meeting_dates instead.',
                  items: { type: 'STRING', enum: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] },
                },
                start_time: { type: 'STRING', description: '24h HH:MM or empty if async/unknown' },
                end_time: { type: 'STRING' },
                every_n_weeks: { type: 'NUMBER', description: '1 = every week (default). 2 = every other week / alternating / biweekly. 3 or 4 if stated. Use with days.' },
                first_date: { type: 'STRING', description: 'YYYY-MM-DD of the FIRST actual meeting. Required whenever every_n_weeks > 1 — it sets which weeks are the "on" weeks.' },
                meeting_dates: {
                  type: 'ARRAY',
                  description: 'Every meeting date, YYYY-MM-DD, when the syllabus lists them explicitly or the pattern is irregular. When this is used, days MUST be empty. This is the correct choice for most lab and recitation schedules.',
                  items: { type: 'STRING' },
                },
                skip_dates: {
                  type: 'ARRAY',
                  description: 'Dates this component does NOT meet even though the pattern says it would ("no lab this week", exam week, field trip).',
                  items: { type: 'STRING' },
                },
                start_date: { type: 'STRING', description: 'YYYY-MM-DD if this component starts later than the semester (e.g. labs begin week 2), else empty' },
                end_date: { type: 'STRING', description: 'YYYY-MM-DD if it ends before the semester does, else empty' },
                meeting_count_stated: { type: 'NUMBER', description: 'If the syllabus states how many of these there are ("10 labs"), put that number here. 0 if not stated.' },
                notes: { type: 'STRING', description: 'The exact sentence in the source that describes when this meets — quoted, so the student can check it.' },
              },
              required: ['kind', 'is_async', 'days', 'start_time', 'end_time'],
            },
          },
          grading: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' }, weight_pct: { type: 'NUMBER' },
                drops: { type: 'NUMBER', description: 'lowest N dropped, 0 if none' },
              },
              required: ['name', 'weight_pct'],
            },
          },
        },
        required: ['code', 'name'],
      },
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          class_code: { type: 'STRING', description: 'course code or "" for personal/life items' },
          type: { type: 'STRING', enum: ['assignment', 'quiz', 'exam', 'project', 'reading', 'task', 'social', 'admin'] },
          title: { type: 'STRING' },
          due_date: { type: 'STRING', description: 'YYYY-MM-DD, or "" ONLY if truly unstated' },
          due_time: { type: 'STRING', description: '24h HH:MM, "" if only a date is given' },
          at_home: { type: 'BOOLEAN', description: 'true = take-home/submitted work; false = happens in class (in-class quiz/exam)' },
          bucket: { type: 'STRING', description: 'grading bucket name if known, else ""' },
          weight_pct: { type: 'NUMBER', description: 'this item\'s % of final grade if stated, else 0' },
          effort_min_guess: { type: 'NUMBER', description: 'realistic minutes of work, 0 for in-class exams' },
          details: { type: 'STRING', description: 'chapters/topics/submission info, short' },
          recurrence: {
            type: 'OBJECT',
            description: 'ONLY for explicit repeating patterns like "quiz every Monday". If the dates are listed or irregular, use dates[] instead of freq/day.',
            properties: {
              freq: { type: 'STRING', enum: ['WEEKLY', 'BIWEEKLY'] },
              day: { type: 'STRING', enum: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] },
              first_date: { type: 'STRING' },
              until: { type: 'STRING', description: 'YYYY-MM-DD, empty = semester end' },
              dates: { type: 'ARRAY', description: 'Explicit list of YYYY-MM-DD due dates. Preferred over freq/day whenever the source lists them.', items: { type: 'STRING' } },
              skip_dates: { type: 'ARRAY', description: 'Dates the pattern skips.', items: { type: 'STRING' } },
            },
          },
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        required: ['class_code', 'type', 'title', 'due_date', 'due_time', 'at_home', 'confidence'],
      },
    },
    holidays: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { date: { type: 'STRING' }, name: { type: 'STRING' } },
        required: ['date', 'name'],
      },
    },
    coverage_notes: {
      type: 'ARRAY', items: { type: 'STRING' },
      description: 'Audit: counts promised vs found, ambiguities, anything a perfectionist should double-check',
    },
  },
  required: ['detected_class_code', 'classes', 'items', 'coverage_notes'],
} as const;

export function buildPrompt(ctx: ExtractContext, pastedText: string): string {
  return `You are the extraction engine of AcademAI, a mission-critical academic tracker for a pre-MD/PhD student who needs a 4.0. A single missed assignment permanently damages their grade. Your job: extract EVERY schedulable obligation from the provided content (text and/or screenshots) with zero omissions.

TODAY (America/New_York): ${ctx.todayEt}
SEMESTER: ${ctx.semester ? `${ctx.semester.name}, ${ctx.semester.start_date} → ${ctx.semester.end_date}` : 'not configured'}
KNOWN CLASSES: ${ctx.knownClasses.length ? ctx.knownClasses.map(c => `${c.code} (${c.name})`).join('; ') : 'none yet'}

RULES — read carefully:
1. EXHAUSTIVE: every assignment, homework, problem set, quiz, exam, midterm, final, project, milestone, lab report, reading, pre-lab, discussion post, and any deadline-bearing thing. Also personal/life obligations if present (type "task", "social" for people-related, "admin" for bureaucracy).
2. NEVER INVENT a date. If a date is not stated, set due_date "" and confidence "low", and add a coverage note. If the content says "Week 5" style dates, compute the real date from the semester start (Week 1 = week containing ${ctx.semester?.start_date ?? 'semester start'}); note the assumption in coverage_notes.
3. Dates like "Friday" or "next Tuesday" resolve relative to TODAY. Dates without a year: choose the date that falls inside the semester window.
4. due_time: use stated time ("11:59 pm" → "23:59"). If only a date is stated, leave due_time "".
5. In-class quizzes/exams: at_home=false, due_time = class start time ONLY if stated in this content; otherwise "".
6. RECURRENCE: for explicit patterns ("quiz every Friday", "problem set due each Monday"), emit ONE item with the recurrence object instead of many copies. First_date = first occurrence if stated.
7. SYLLABUS MODE: if this is a syllabus, also fill classes[] with meeting components (lecture / recitation / lab) and the complete grading[] breakdown (weights must be the stated percentages; include drop policies).

MEETING SCHEDULE — read this twice. The single most damaging mistake you can make is turning an occasional meeting into a weekly one: it hides the weeks that actually matter and fills the student's calendar with meetings that do not exist.
S1. Extract the pattern the document states. "Weekly" is not a safe default — it is a guess, and a guess here is a failure.
S2. If the document lists specific meeting dates anywhere — a lab schedule table, a recitation calendar, a week-by-week outline — those dates ARE the schedule. Put every one of them in meeting_dates and leave days EMPTY. Do not also emit a weekday pattern.
S3. "alternating weeks", "every other week", "biweekly", "odd weeks", "even weeks" → every_n_weeks 2, and first_date = the first real meeting. Without first_date the parity is unknowable, so it is mandatory.
S4. "Weeks 2, 4, 6, 9" style → convert each week number to its real date using the semester start (week 1 is the week containing ${ctx.semester?.start_date ?? 'the semester start'}) and list them in meeting_dates. Note the conversion in coverage_notes.
S5. Labs and recitations frequently do not meet every week and frequently do not meet in week 1. If the document says when labs begin, set start_date. If it says there is no lab during exam week or a break, add those to skip_dates.
S6. meeting_count_stated: if the document says how many there are ("10 labs", "seven recitations"), record the number. If your meeting_dates count does not match it, say so in coverage_notes — that mismatch is exactly what the student needs to catch.
S7. Multiple sections of the same component: if the student's section is identifiable, extract only that one. Otherwise extract each as a separate component with its section in title, and flag it in coverage_notes.
S8. notes: quote the sentence you took the pattern from, verbatim and short. The student checks your work against it.
8. COVERAGE AUDIT (critical): in coverage_notes, state the meeting count you produced for every component ("CH 221 LAB: 7 meetings, Sep 3 → Nov 19, every other Wednesday"), then reconcile item counts — e.g. "syllabus says 10 problem sets; I extracted 8 with explicit dates, 2 undated", "grading table sums to 95% — possible missing bucket", "async course: no meetings expected". Flag every ambiguity. An empty coverage_notes is only acceptable for trivial single-item pastes.
9. detected_class_code: the known class this content most likely belongs to (match loosely: "orgo" → chemistry class). "" if unclear or multiple.
10. Screenshots: read ALL text including tables, calendars, sidebars, Moodle/LMS interfaces. Moodle due dates often look like "Due: Friday, 30 August 2026, 11:59 PM".

11. ATTACHMENTS: PDFs and images may be attached alongside the text. Read every page of every attachment — syllabi frequently put the schedule table on a later page than the policies. Text extracted from Word/PowerPoint/Excel files arrives inline below, each block headed by "--- FILE: <name> ---".

${pastedText ? `CONTENT:\n${pastedText}` : 'CONTENT: see the attached document(s) / image(s).'}`;
}

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

/**
 * Second-pass audit. The model re-reads the same source with its own first
 * answer in front of it and is asked to produce the corrected, complete
 * version. One read of a syllabus misses things; a read with a draft to
 * attack does not miss the same things.
 */
export function buildAuditPrompt(first: unknown): string {
  return `You already extracted the content above. Here is that first draft:

${JSON.stringify(first).slice(0, 60000)}

Now audit it against the source, adversarially. You are looking for your own mistakes.

A1. Anything schedulable that the draft missed entirely — a deadline in a paragraph rather than a table, a row further down a schedule table, a second page, a footnote, an assignment mentioned only in the grading section.
A2. Meeting patterns that were guessed rather than read. For every component ask: does the source actually say this meets every week? If it lists dates, are ALL of them in meeting_dates, and is days empty? If it alternates, is first_date set? If labs start in week 2, is start_date set?
A3. Dates that were invented, misread, or landed in the wrong year or outside the semester window.
A4. Counts: the source says N problem sets / N labs / N exams — does the draft contain N?
A5. Grading weights that do not sum to 100, or buckets that exist in the schedule but not in the grading table.

Return the COMPLETE corrected extraction in the same schema — not a diff. Keep everything from the draft that was right, fix what was wrong, add what was missing. In coverage_notes, start each correction you made with "FIXED:" and each remaining uncertainty with "CHECK:".`;
}

const keyOf = (i: { title?: string; due_date?: string; class_code?: string }) =>
  `${(i.class_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')}|${(i.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${i.due_date ?? ''}`;

interface Extraction {
  detected_class_code?: string;
  classes?: unknown[];
  items?: Array<{ title?: string; due_date?: string; class_code?: string }>;
  holidays?: Array<{ date?: string; name?: string }>;
  coverage_notes?: string[];
}

/**
 * Merge the audit over the draft. The audit is the base — it saw both the
 * source and the draft — but anything the draft found and the audit dropped
 * is added back rather than lost. Never silently lose a deadline.
 */
export function mergeExtractions(draft: unknown, audit: unknown): unknown {
  const a = (draft ?? {}) as Extraction;
  const b = (audit ?? {}) as Extraction;
  if (!b.items && !b.classes) return draft;

  const items = [...(b.items ?? [])];
  const seen = new Set(items.map(keyOf));
  const restored: string[] = [];
  for (const it of a.items ?? []) {
    if (seen.has(keyOf(it))) continue;
    seen.add(keyOf(it));
    items.push(it);
    restored.push(it.title ?? '(untitled)');
  }

  const holidays = [...(b.holidays ?? [])];
  const hseen = new Set(holidays.map(h => h.date));
  for (const h of a.holidays ?? []) if (h.date && !hseen.has(h.date)) { hseen.add(h.date); holidays.push(h); }

  const notes = [...(b.coverage_notes ?? [])];
  if (restored.length) {
    notes.unshift(`CHECK: the second read dropped ${restored.length} item(s) the first read found — kept both. Verify: ${restored.slice(0, 6).join('; ')}${restored.length > 6 ? '…' : ''}`);
  }
  return {
    detected_class_code: b.detected_class_code || a.detected_class_code || '',
    classes: (b.classes?.length ? b.classes : a.classes) ?? [],
    items, holidays, coverage_notes: notes,
  };
}

export type FailureKind = 'key' | 'quota' | 'missing-model' | 'bad-request' | 'blocked' | 'network' | 'empty';

export interface Attempt {
  model: string;
  status: number;
  kind: FailureKind | 'ok';
  detail: string;
  schemaless?: boolean;
}

export class GeminiError extends Error {
  kind: FailureKind;
  attempts: Attempt[];
  hint: string;
  constructor(kind: FailureKind, message: string, hint: string, attempts: Attempt[]) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.hint = hint;
    this.attempts = attempts;
  }
}

interface ApiError { error?: { code?: number; message?: string; status?: string } }

/**
 * Work out what actually went wrong. This matters more than it looks: the old
 * version treated every 400 as "try the next model", so a bad API key burned
 * through the whole chain and surfaced as a bare status code with Google's
 * actual explanation thrown away.
 */
export function classifyFailure(status: number, bodyText: string): { kind: FailureKind; detail: string; hint: string } {
  let detail = bodyText.slice(0, 600);
  let apiStatus = '';
  try {
    const j = JSON.parse(bodyText) as ApiError;
    if (j.error?.message) detail = j.error.message;
    apiStatus = j.error?.status ?? '';
  } catch { /* not JSON — keep the raw text */ }
  const d = detail.toLowerCase();

  if (status === 401 || status === 403 || apiStatus === 'PERMISSION_DENIED'
    || d.includes('api key not valid') || d.includes('api_key_invalid') || d.includes('invalid api key')) {
    return {
      kind: 'key',
      detail,
      hint: 'The Gemini API key is not valid. Get one at aistudio.google.com/apikey — it starts with "AIza" — and paste it into SETTINGS. Keys from anywhere else in Google will not work here.',
    };
  }
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED' || d.includes('quota')) {
    return { kind: 'quota', detail, hint: 'The free tier limit for this model is used up. Wait a minute, or pick a different model in SETTINGS.' };
  }
  if (status === 404 || d.includes('not found') || d.includes('is not supported')
    || d.includes('does not exist') || d.includes('not supported for generatecontent')) {
    return { kind: 'missing-model', detail, hint: 'That model is not available to this key.' };
  }
  if (status === 400) {
    return { kind: 'bad-request', detail, hint: 'Google rejected the request itself. Usually the response format the app asked for; it will retry without it.' };
  }
  return { kind: 'network', detail: detail || `HTTP ${status}`, hint: 'Google returned an unexpected error. Trying the next model.' };
}

function extractText(body: unknown): string {
  const b = body as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  return b?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
}

function parseLoose(text: string): unknown | null {
  try { return JSON.parse(text); } catch { /* try harder */ }
  // models sometimes wrap JSON in a code fence or add a sentence around it
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* keep going */ } }
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(text.slice(first, last + 1)); } catch { /* give up */ } }
  return null;
}

const SHAPE_HINT = `\n\nReturn ONLY a JSON object, no prose and no code fence, with exactly these keys:
{"detected_class_code":string,"classes":[{"code":string,"name":string,"components":[{"kind":"LEC"|"REC"|"LAB"|"SEM"|"STU"|"OTH","title":string,"location":string,"is_async":boolean,"days":["MO"...],"start_time":"HH:MM","end_time":"HH:MM","every_n_weeks":number,"first_date":"YYYY-MM-DD","meeting_dates":["YYYY-MM-DD"],"skip_dates":["YYYY-MM-DD"],"start_date":string,"end_date":string,"meeting_count_stated":number,"notes":string}],"grading":[{"name":string,"weight_pct":number,"drops":number}]}],"items":[{"class_code":string,"type":"assignment"|"quiz"|"exam"|"project"|"reading"|"task"|"social"|"admin","title":string,"due_date":"YYYY-MM-DD","due_time":"HH:MM","at_home":boolean,"bucket":string,"weight_pct":number,"effort_min_guess":number,"details":string,"recurrence":{"freq":"WEEKLY"|"BIWEEKLY","day":"MO","first_date":string,"until":string,"dates":["YYYY-MM-DD"],"skip_dates":["YYYY-MM-DD"]},"confidence":"high"|"medium"|"low"}],"holidays":[{"date":"YYYY-MM-DD","name":string}],"coverage_notes":[string]}`;

async function oneCall(
  apiKey: string, model: string, parts: GeminiPart[], useSchema: boolean,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; body: string }> {
  const sendParts = useSchema
    ? parts
    : parts.map((p, i) => (i === 0 && p.text ? { text: p.text + SHAPE_HINT } : p));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: sendParts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          ...(useSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
          maxOutputTokens: maxTokensFor(model),
        },
      }),
    },
  );
  if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  const body = await res.json().catch(() => null);
  const text = extractText(body);
  if (!text) {
    const blocked = (body as { promptFeedback?: { blockReason?: string } })?.promptFeedback?.blockReason;
    return { ok: false, status: 200, body: JSON.stringify({ error: { message: blocked ? `Blocked: ${blocked}` : 'The model returned nothing.' } }) };
  }
  const json = parseLoose(text);
  if (json === null) {
    return { ok: false, status: 200, body: JSON.stringify({ error: { message: `Could not parse the model's reply as JSON: ${text.slice(0, 200)}` } }) };
  }
  return { ok: true, json };
}

export async function callGemini(
  apiKey: string,
  preferredModel: string,
  parts: GeminiPart[],
): Promise<{ json: unknown; model: string; attempts: Attempt[] }> {
  const chain = [preferredModel, ...MODEL_CHAIN.filter(m => m !== preferredModel)].filter(Boolean);
  const attempts: Attempt[] = [];
  let worst: { kind: FailureKind; message: string; hint: string } | null = null;

  for (const model of chain) {
    for (const useSchema of [true, false]) {
      let r: Awaited<ReturnType<typeof oneCall>>;
      try {
        r = await oneCall(apiKey, model, parts, useSchema);
      } catch (e) {
        attempts.push({ model, status: 0, kind: 'network', detail: (e as Error).message, schemaless: !useSchema });
        worst ??= { kind: 'network', message: (e as Error).message, hint: 'Could not reach Google at all.' };
        break;
      }
      if (r.ok) {
        attempts.push({ model, status: 200, kind: 'ok', detail: useSchema ? 'ok' : 'ok (without the strict response format)', schemaless: !useSchema });
        return { json: r.json, model, attempts };
      }
      const c = classifyFailure(r.status, r.body);
      attempts.push({ model, status: r.status, kind: c.kind, detail: c.detail, schemaless: !useSchema });

      // A bad key is a bad key on every model — stop rather than making five
      // more failing calls and reporting the last one.
      if (c.kind === 'key') throw new GeminiError('key', c.detail, c.hint, attempts);
      // The strict response format is the only thing worth retrying on the
      // same model; everything else means move on.
      if (c.kind !== 'bad-request') { worst ??= { kind: c.kind, message: c.detail, hint: c.hint }; break; }
      if (!useSchema) { worst ??= { kind: c.kind, message: c.detail, hint: c.hint }; }
    }
  }

  const allMissing = attempts.every(a => a.kind === 'missing-model');
  const allQuota = attempts.some(a => a.kind === 'quota') && attempts.every(a => a.kind === 'quota' || a.kind === 'missing-model');
  if (allMissing) {
    throw new GeminiError('missing-model',
      `None of these models are available to your key: ${chain.join(', ')}`,
      'Open SETTINGS and press "Check key" — it will list the models this key can actually use, and let you pick one.',
      attempts);
  }
  if (allQuota) {
    throw new GeminiError('quota', worst?.message ?? 'Out of quota',
      'You have hit the free-tier limit. Wait a minute and try again, or pick another model in SETTINGS.', attempts);
  }
  throw new GeminiError(worst?.kind ?? 'network',
    worst?.message ?? 'Every model failed.',
    worst?.hint ?? 'Open SETTINGS and press "Check key" to see what this key can do.',
    attempts);
}

/** Ask Google what this key can actually use. The whole diagnostic in one call. */
export async function listModels(apiKey: string): Promise<{ ok: boolean; models: string[]; error?: string; hint?: string }> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      const c = classifyFailure(res.status, text);
      return { ok: false, models: [], error: c.detail, hint: c.hint };
    }
    const j = JSON.parse(text) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const models = (j.models ?? [])
      .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map(m => (m.name ?? '').replace(/^models\//, ''))
      .filter(n => n && !/embedding|aqa|imagen|veo|tts|image-generation/i.test(n));
    // flash first — free tier is generous with it and extraction does not need a pro model
    models.sort((a, b) => Number(b.includes('flash')) - Number(a.includes('flash')) || b.localeCompare(a));
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message, hint: 'Could not reach Google from the server.' };
  }
}
