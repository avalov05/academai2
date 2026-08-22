// ── Server-side: deliver one batch of notifications ──────────────────────
import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import type { PlannedPush } from '../push';

export interface SubRow { endpoint: string; p256dh: string; auth: string; fail_count: number }

let configured = false;
export function configureVapid(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@academai.app';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/**
 * Send one notification to every device a user has registered.
 * A 404/410 means the phone threw the subscription away — delete it rather
 * than retrying forever. Anything else is counted, and a subscription that
 * fails repeatedly is dropped so one dead device cannot slow every run.
 */
export async function sendToUser(
  admin: SupabaseClient, subs: SubRow[], p: PlannedPush,
): Promise<{ sent: number; dropped: number }> {
  let sent = 0, dropped = 0;
  const payload = JSON.stringify({
    title: p.title, body: p.body, tag: p.tag, url: p.url, urgent: p.urgent,
  });
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 6 * 3600, urgency: p.urgent ? 'high' : 'normal' },
      );
      sent++;
      await admin.from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), fail_count: 0 })
        .eq('endpoint', s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode ?? 0;
      if (code === 404 || code === 410 || s.fail_count >= 4) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        dropped++;
      } else {
        await admin.from('push_subscriptions')
          .update({ fail_count: s.fail_count + 1 })
          .eq('endpoint', s.endpoint);
      }
    }
  }));
  return { sent, dropped };
}
