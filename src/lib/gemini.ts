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
                days: { type: 'ARRAY', items: { type: 'STRING', enum: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] } },
                start_time: { type: 'STRING', description: '24h HH:MM or empty if async/unknown' },
                end_time: { type: 'STRING' },
                biweekly: { type: 'BOOLEAN' },
                first_date: { type: 'STRING', description: 'YYYY-MM-DD first meeting if stated, else empty' },
                notes: { type: 'STRING' },
              },
              required: ['kind', 'is_async', 'days', 'start_time', 'end_time', 'biweekly'],
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
            description: 'ONLY for explicit repeating patterns like "quiz every Monday"',
            properties: {
              freq: { type: 'STRING', enum: ['WEEKLY', 'BIWEEKLY'] },
              day: { type: 'STRING', enum: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] },
              first_date: { type: 'STRING' },
              until: { type: 'STRING', description: 'YYYY-MM-DD, empty = semester end' },
            },
            required: ['freq', 'day'],
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
7. SYLLABUS MODE: if this is a syllabus, also fill classes[] with meeting components (lecture/recitation/lab days, times as 24h HH:MM, locations, async flags, biweekly flags) and the complete grading[] breakdown (weights must be the stated percentages; include drop policies).
8. COVERAGE AUDIT (critical): in coverage_notes, reconcile counts — e.g. "syllabus says 10 problem sets; I extracted 8 with explicit dates, 2 undated", "grading table sums to 95% — possible missing bucket", "async course: no meetings expected". Flag every ambiguity. An empty coverage_notes is only acceptable for trivial single-item pastes.
9. detected_class_code: the known class this content most likely belongs to (match loosely: "orgo" → chemistry class). "" if unclear or multiple.
10. Screenshots: read ALL text including tables, calendars, sidebars, Moodle/LMS interfaces. Moodle due dates often look like "Due: Friday, 30 August 2026, 11:59 PM".

11. ATTACHMENTS: PDFs and images may be attached alongside the text. Read every page of every attachment — syllabi frequently put the schedule table on a later page than the policies. Text extracted from Word/PowerPoint/Excel files arrives inline below, each block headed by "--- FILE: <name> ---".

${pastedText ? `CONTENT:\n${pastedText}` : 'CONTENT: see the attached document(s) / image(s).'}`;
}

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
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
