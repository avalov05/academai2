// ── GET /api/ics/[token] — private calendar feed for Google/Apple ────────
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildIcs } from '@/lib/ics';
import type { AppData, Settings } from '@/lib/types';

export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token || token.length < 24) return new NextResponse('not found', { status: 404 });
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: settings } = await admin.from('user_settings').select('*').eq('ics_token', token).maybeSingle();
    if (!settings) return new NextResponse('not found', { status: 404 });
    const uid = settings.user_id as string;
    const [sem, hol, cls, cmp, itm] = await Promise.all([
      admin.from('semesters').select('*').eq('user_id', uid).order('start_date', { ascending: false }).limit(1),
      admin.from('holidays').select('*').eq('user_id', uid),
      admin.from('classes').select('*').eq('user_id', uid),
      admin.from('components').select('*').eq('user_id', uid),
      admin.from('items').select('*').eq('user_id', uid),
    ]);
    const data: AppData = {
      semester: sem.data?.[0] ?? null,
      holidays: hol.data ?? [], classes: cls.data ?? [], components: cmp.data ?? [],
      items: itm.data ?? [], sources: [], scores: [],
      settings: settings as Settings,
    };
    const origin = req.nextUrl.origin;
    const ics = buildIcs(data, { appUrl: origin });
    // ?download=1 hands back a file to import — Google does not fire alarms on
    // subscribed calendars, but it does on imported events
    const download = req.nextUrl.searchParams.get('download') === '1';
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="academai.ics"`,
        'Cache-Control': download ? 'no-store' : 'public, max-age=900',
      },
    });
  } catch (e) {
    return new NextResponse(`error: ${(e as Error).message}`, { status: 500 });
  }
}
