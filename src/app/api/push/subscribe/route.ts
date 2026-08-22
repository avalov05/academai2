// ── POST /api/push/subscribe — store this phone's push endpoint ──────────
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function userClient(auth: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: 'Bad subscription' }, { status: 400 });
  }
  const supa = userClient(auth);
  const { data: me } = await supa.auth.getUser();
  if (!me?.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { error } = await supa.from('push_subscriptions').upsert({
    user_id: me.user.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    label: (body.label ?? '').slice(0, 60),
    fail_count: 0,
  }, { onConflict: 'endpoint' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({ endpoint: '' }));
  if (!endpoint) return NextResponse.json({ error: 'No endpoint' }, { status: 400 });
  const { error } = await userClient(auth).from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
