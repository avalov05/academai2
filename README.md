# AcademAI — Mission Control for the 4.0

Approach radar for everything you owe anyone. Paste a syllabus, a Moodle screenshot, or an
announcement — Gemini extracts every obligation, a dedupe engine classifies NEW / UPDATE / KNOWN,
a coverage audit flags gaps, and nothing commits without your review.

Stack: Next.js · Supabase (Postgres + auth) · Gemini API · Vercel.

## Environment variables

| var | what |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (ICS feed) |

Gemini key is stored per-user in `user_settings` (Settings view), not in env.

## Setup

1. Create a Supabase project → SQL editor → run `supabase/migration.sql`.
2. Authentication → create your user (email + password, auto-confirm) → then disable public sign-ups.
3. Deploy to Vercel with the env vars above.
4. In the app: SETTINGS → paste Gemini API key → INTAKE → paste your first syllabus.
5. SETTINGS → copy the ICS URL → subscribe in Google/Apple Calendar for phone alarms.

Local dev without any services: `NEXT_PUBLIC_DEMO=1 npm run dev` (seeded demo data, canned extraction).
