// ── POST /api/extract — server-side Gemini call ───────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildPrompt, callGemini, type GeminiPart } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = (body.text ?? '').slice(0, 60000);
    const images: Array<{ mime: string; data: string }> = (body.images ?? []).slice(0, 8);

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
    for (const im of images) {
      if (!/^image\//.test(im.mime)) continue;
      parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
    }

    const { json, model } = await callGemini(key, settings?.gemini_model || 'gemini-3.7-flash', parts);
    return NextResponse.json({ extraction: json, model });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Canned demo output so the flow is testable without a key
function demoExtraction() {
  const y = new Date().getFullYear();
  return {
    detected_class_code: 'CH 221',
    classes: [],
    items: [
      { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 4', due_date: `${y}-09-18`, due_time: '23:59', at_home: true, bucket: 'Problem Sets', weight_pct: 0, effort_min_guess: 150, details: 'Ch. 5 — SN1/SN2', confidence: 'high' },
      { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 3', due_date: `${y}-09-11`, due_time: '23:59', at_home: true, bucket: 'Problem Sets', weight_pct: 0, effort_min_guess: 150, details: 'extended by 2 days per announcement', confidence: 'high' },
      { class_code: 'CH 221', type: 'quiz', title: 'Reading Quiz', due_date: '', due_time: '', at_home: false, bucket: 'Quizzes', weight_pct: 0, effort_min_guess: 30, details: '', confidence: 'medium', recurrence: { freq: 'WEEKLY', day: 'FR', first_date: `${y}-09-04`, until: `${y}-10-09` } },
    ],
    holidays: [{ date: `${y}-09-07`, name: 'Labor Day' }],
    coverage_notes: [
      'Announcement mentions "both problem sets" — extracted 2, verify none earlier.',
      'Weekly reading quiz: expanded Fridays Sep 4 → Oct 9 (6 instances) — confirm end date.',
    ],
  };
}
