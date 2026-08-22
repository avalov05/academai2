// ── POST /api/extract — server-side Gemini call ───────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildPrompt, buildAuditPrompt, callGemini, mergeExtractions, type GeminiPart } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = (body.text ?? '').slice(0, 80000);
    const images: Array<{ mime: string; data: string }> = (body.images ?? []).slice(0, 8);
    const pdfs: Array<{ mime: string; data: string }> = (body.pdfs ?? []).slice(0, 4);
    const verify: boolean = body.verify !== false;   // second read unless turned off

    if (DEMO) return NextResponse.json({ extraction: demoExtraction(), model: 'demo' });

    // auth: forward the user's supabase JWT so RLS applies
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
    );
    const [{ data: settings }, { data: sems }, { data: classes }] = await Promise.all([
      supa.from('user_settings').select('gemini_key, gemini_model').maybeSingle(),
      supa.from('semesters').select('name,start_date,end_date').order('start_date', { ascending: false }).limit(1),
      supa.from('classes').select('code,name'),
    ]);
    const key = settings?.gemini_key?.trim();
    if (!key) return NextResponse.json({ error: 'No Gemini API key saved — add it in SETTINGS' }, { status: 400 });

    const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const prompt = buildPrompt({
      todayEt,
      semester: sems?.[0] ?? null,
      knownClasses: classes ?? [],
    }, text);

    const parts: GeminiPart[] = [{ text: prompt }];
    // PDFs are read natively by the model — scans included
    for (const d of pdfs) {
      if (d.mime !== 'application/pdf') continue;
      parts.push({ inline_data: { mime_type: 'application/pdf', data: d.data } });
    }
    for (const im of images) {
      if (!/^image\//.test(im.mime)) continue;
      parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
    }

    const preferred = settings?.gemini_model || 'gemini-3.7-flash';
    const { json, model } = await callGemini(key, preferred, parts);

    // Second read: same source, its own draft in front of it. Costs one extra
    // call and catches the omissions a single pass reliably makes.
    if (!verify) return NextResponse.json({ extraction: json, model, passes: 1 });
    try {
      const audit = await callGemini(key, model, [...parts, { text: buildAuditPrompt(json) }]);
      return NextResponse.json({
        extraction: mergeExtractions(json, audit.json),
        model, passes: 2,
      });
    } catch {
      // the draft is still good — never fail the whole extraction over the audit
      return NextResponse.json({ extraction: json, model, passes: 1, auditFailed: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Canned demo output so the flow is testable without a key
function demoExtraction() {
  const y = new Date().getFullYear();
  return {
    detected_class_code: 'CH 221',
    // one class carrying all three meeting shapes, so the review screen shows
    // what a real syllabus produces: weekly, every-other-week, and listed dates
    classes: [{
      code: 'PY 205', name: 'Physics for Engineers I',
      components: [
        { kind: 'LEC', days: ['MO', 'WE', 'FR'], start_time: '10:40', end_time: '11:30', location: 'Riddick 301', is_async: false, notes: '"Lecture meets MWF 10:40–11:30."' },
        { kind: 'REC', days: ['TH'], start_time: '08:30', end_time: '09:45', location: 'Riddick 461', is_async: false, every_n_weeks: 2, first_date: `${y}-09-03`, notes: '"Recitation meets on alternating weeks beginning the second week."' },
        {
          kind: 'LAB', days: [], start_time: '13:30', end_time: '16:15', location: 'Riddick 114', is_async: false,
          meeting_dates: [`${y}-09-10`, `${y}-09-24`, `${y}-10-08`, `${y}-10-22`, `${y}-11-05`, `${y}-11-19`],
          meeting_count_stated: 6,
          notes: '"Six labs, on the dates listed in the table above."',
        },
      ],
      grading: [
        { name: 'Homework', weight_pct: 20, drops: 2 }, { name: 'Labs', weight_pct: 15 },
        { name: 'Midterms', weight_pct: 40 }, { name: 'Final', weight_pct: 25 },
      ],
    }],
    items: [
      { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 4', due_date: `${y}-09-18`, due_time: '23:59', at_home: true, bucket: 'Problem Sets', weight_pct: 0, effort_min_guess: 150, details: 'Ch. 5 — SN1/SN2', confidence: 'high' },
      { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 3', due_date: `${y}-09-11`, due_time: '23:59', at_home: true, bucket: 'Problem Sets', weight_pct: 0, effort_min_guess: 150, details: 'extended by 2 days per announcement', confidence: 'high' },
      { class_code: 'CH 221', type: 'quiz', title: 'Reading Quiz', due_date: '', due_time: '', at_home: false, bucket: 'Quizzes', weight_pct: 0, effort_min_guess: 30, details: '', confidence: 'medium', recurrence: { freq: 'WEEKLY', day: 'FR', first_date: `${y}-09-04`, until: `${y}-10-09` } },
    ],
    holidays: [{ date: `${y}-09-07`, name: 'Labor Day' }],
    coverage_notes: [
      'Announcement mentions "both problem sets" — extracted 2, verify none earlier.',
      'Weekly reading quiz: expanded Fridays Sep 4 → Oct 9 (6 instances) — confirm end date.',
      'PY 205 LEC: 44 meetings, MWF. REC: 8 meetings, every other Thursday from Sep 3. LAB: 6 meetings on the listed dates — matches the stated "six labs".',
    ],
  };
}
