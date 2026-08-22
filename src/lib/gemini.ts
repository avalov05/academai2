// ── Gemini extraction: prompt, strict schema, fallback chain ─────────────
// Server-side only (called from /api/extract).

export const MODEL_CHAIN = [
  'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash',
];

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

export async function callGemini(
  apiKey: string,
  preferredModel: string,
  parts: GeminiPart[],
): Promise<{ json: unknown; model: string }> {
  const chain = [preferredModel, ...MODEL_CHAIN.filter(m => m !== preferredModel)];
  let lastErr = '';
  for (const model of chain) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 16384,
        },
      }),
    });
    if (res.status === 404 || res.status === 400) { lastErr = `${model}: ${res.status}`; continue; }
    if (res.status === 429) { lastErr = `${model}: rate-limited`; continue; }
    if (!res.ok) { lastErr = `${model}: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300); continue; }
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!text) { lastErr = `${model}: empty response`; continue; }
    try {
      return { json: JSON.parse(text), model };
    } catch {
      // try to salvage JSON inside
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return { json: JSON.parse(m[0]), model }; } catch { /* fall through */ } }
      lastErr = `${model}: unparseable JSON`;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastErr}`);
}
