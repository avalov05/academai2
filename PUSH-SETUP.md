# Turning on iPhone reminders

Four steps. The first three are one-time setup; the fourth is on your phone.

## 1. Run the SQL

Supabase → SQL Editor → New query → paste **`supabase/migration-push.sql`** → Run.

Safe to run even if you already ran `migration.sql` — it only adds what is missing.

## 2. Add four environment variables in Vercel

Project → Settings → Environment Variables. Add all four to **Production**:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `BOTdQ4lEzQoIzq1q2R-mW7qdhAC4JkOHgNMxSOLcfblNxu-IXpR6l0TkEDZgIaXT5EYfdFIuJysr34bsNuSnjZE` |
| `VAPID_PRIVATE_KEY` | `bkU3TjHjFjjGZO1pxfNLV6ekLjdtFdeN6wimJNfSVTc` |
| `VAPID_SUBJECT` | `mailto:anton.valov05@gmail.com` |
| `PUSH_CRON_SECRET` | make up a long random string — anything, just keep it private |
| `CRON_SECRET` | **the same value** as `PUSH_CRON_SECRET` (this is how Vercel's own scheduler authenticates) |

These are yours alone. The private key is what proves to Apple and Google that a
notification really came from your app; do not put it anywhere public.

Redeploy after adding them (Deployments → ⋯ → Redeploy).

## 3. Make something call the worker

`/api/push/run` decides what is due and sends it. It is safe to call as often as
you like — every notification is claimed in the database before it is sent, so
nothing is ever sent twice.

`vercel.json` already schedules it **once a day**, which is all Vercel's free plan
allows. Once a day is not enough for "due in 3 hours" to be useful, so add a free
external trigger as well:

1. Go to **cron-job.org**, make an account.
2. Create a cronjob:
   - URL: `https://academai2.vercel.app/api/push/run?key=YOUR_PUSH_CRON_SECRET`
   - Schedule: **every 15 minutes**
3. Save and enable.

That is the whole thing. Any service that can hit a URL on a schedule works —
cron-job.org is just free and reliable.

## 4. On your iPhone

**Apple only allows notifications from a website once it is on your Home Screen.**
This is the step people miss.

1. Open `academai2.vercel.app` in **Safari** (not Chrome).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open AcademAI **from the new Home Screen icon**.
4. Go to Settings inside the app → **Turn on reminders** → Allow.
5. Tap **Send a test now**. Your phone should buzz within a few seconds.

If the button says *"Needs Home Screen"*, you are still in Safari — open the app
from the icon instead.

## What gets sent

| When | What |
| --- | --- |
| 08:00 daily | What is due today, anything overdue, next exam |
| 20:00 daily | Anything still open due within 24 hours |
| 24h and 3h before | Each assignment |
| 2 days, 1 day, 2h before | Each exam and in-class quiz |
| 15 min before | Study blocks you accepted |
| 15 min after | Anything that just went overdue |

Nothing is sent between 23:00 and 07:00. Anything that would have landed in that
window arrives at 07:00 instead.

## Checking it without waiting

- `GET /api/push/run?key=SECRET&dry=1` — lists what *would* be sent right now
  without sending anything. Good for confirming the cron URL works.
- **Send a test now** in Settings — proves the phone, the keys and the service
  worker are all wired up.
