// ── POST /api/push/test — prove the whole chain works, right now ─────────
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { configureVapid, sendToUser, type SubRow } from '@/lib/server/send';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!configureVapid()) return NextResponse.json({ error: 'VAPID keys are not configured on the server' }, { status: 500 });

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: me } = await supa.auth.getUser();
  if (!me?.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: subs } = await admin
    .from('push_subscriptions').select('endpoint, p256dh, auth, fail_count')
    .eq('user_id', me.user.id);
  if (!subs?.length) return NextResponse.json({ error: 'No phone registered yet' }, { status: 400 });

  const r = await sendToUser(admin, subs as SubRow[], {
    key: 'test', at: new Date(),
    title: 'AcademAI is watching',
    body: 'Notifications are working. You will get these when something is due.',
    tag: 'test', url: req.nextUrl.origin, urgent: false,
  });
  return NextResponse.json({ ok: true, ...r, devices: subs.length });
}
