// ── GET /api/models — what can this key actually do? ─────────────────────
// One call that turns "extraction failed" into a fact.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { listModels, MODEL_CHAIN } from '@/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export async function GET(req: NextRequest) {
  if (DEMO) {
    return NextResponse.json({
      ok: true, demo: true,
      models: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-pro'],
    });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: settings } = await supa.from('user_settings').select('gemini_key').maybeSingle();
  const key = settings?.gemini_key?.trim();
  if (!key) {
    return NextResponse.json({
      ok: false,
      error: 'No key saved yet',
      hint: 'Paste a key from aistudio.google.com/apikey above and press SAVE first.',
    }, { status: 400 });
  }
  const r = await listModels(key);
  return NextResponse.json({ ...r, known: MODEL_CHAIN }, { status: r.ok ? 200 : 502 });
}
