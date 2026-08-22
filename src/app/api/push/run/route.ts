// ── /api/push/run — the worker that actually sends the reminders ─────────
//
// Safe to call as often as you like. It sends everything whose moment fell in
// (last run, now], and every notification carries a dedupe key that is claimed
// in the database before it is sent — so two overlapping runs, a retried cron,
// or a manual trigger can never double-notify.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { planPushes } from '@/lib/push';
import { loadUserData } from '@/lib/server/userdata';
import { configureVapid, sendToUser, type SubRow } from '@/lib/server/send';
import type { Settings } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** never look further back than this, so a long outage cannot spam the phone */
const MAX_LOOKBACK_MIN = 180;

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  // Always require the secret — no header-only bypass. Vercel's own cron sends
  // `Authorization: Bearer $CRON_SECRET`, so setting CRON_SECRET to the same
  // value as PUSH_CRON_SECRET lets the built-in schedule through this door too.
  const secret = process.env.PUSH_CRON_SECRET;
  const given = req.nextUrl.searchParams.get('key')
    ?? (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || given !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!configureVapid()) {
    return NextResponse.json({ error: 'VAPID keys are not configured' }, { status: 500 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const appUrl = req.nextUrl.origin;
  const now = new Date();
  const dry = req.nextUrl.searchParams.get('dry') === '1';

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth, fail_count');
  if (!subs?.length) return NextResponse.json({ ok: true, users: 0, sent: 0 });

  const byUser = new Map<string, SubRow[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s as SubRow]);

  let sent = 0, planned = 0, skipped = 0, dropped = 0;
  const preview: string[] = [];

  for (const [uid, userSubs] of byUser) {
    const { data: settings } = await admin
      .from('user_settings').select('*').eq('user_id', uid).maybeSingle();
    if (settings?.push_enabled === false) continue;

    const lastRun = settings?.push_last_run_at ? new Date(settings.push_last_run_at) : null;
    const floor = new Date(now.getTime() - MAX_LOOKBACK_MIN * 60000);
    const from = lastRun && lastRun > floor ? lastRun : floor;

    const data = await loadUserData(admin, uid, (settings ?? {}) as Settings);
    const due = planPushes(data, from, now, appUrl);
    planned += due.length;

    for (const p of due) {
      if (dry) { preview.push(`${p.at.toISOString()} ${p.key} — ${p.title}`); continue; }
      // claim the key first: if the insert conflicts, someone already sent it
      const { error } = await admin.from('push_log').insert({ user_id: uid, dedupe_key: p.key });
      if (error) { skipped++; continue; }
      const r = await sendToUser(admin, userSubs, p);
      sent += r.sent; dropped += r.dropped;
    }
    if (!dry) {
      await admin.from('user_settings')
        .update({ push_last_run_at: now.toISOString() }).eq('user_id', uid);
    }
  }

  return NextResponse.json({
    ok: true, users: byUser.size, planned, sent, skipped, dropped,
    ...(dry ? { preview } : {}),
  });
}
