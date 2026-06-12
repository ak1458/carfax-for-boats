# Boat Record — Carfax for Boats

[![CI](https://github.com/ak1458/carfax-for-boats/actions/workflows/ci.yml/badge.svg)](https://github.com/ak1458/carfax-for-boats/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth%20%2B%20Storage-3FCF8E?logo=supabase)](https://supabase.com)
[![Claude API](https://img.shields.io/badge/Claude-vision%20extraction-d97757)](https://docs.claude.com)

Transferable maintenance record for boat owners. Photograph your engine plate, receipts, and hour meters; Claude vision extracts structured data into a systems inventory and service history. Reminders run on engine hours or the calendar, and a share link gives buyers and brokers a read-only, photo-backed ("verified") service record.

- Spec: [docs/superpowers/specs/2026-06-11-carfax-for-boats-design.md](docs/superpowers/specs/2026-06-11-carfax-for-boats-design.md)
- Plan: [docs/superpowers/plans/2026-06-11-carfax-for-boats-mvp.md](docs/superpowers/plans/2026-06-11-carfax-for-boats-mvp.md)

## Stack

Next.js 16 (App Router, PWA) · Supabase (Postgres + magic-link auth + Storage) · Claude API (vision extraction via tool use) · Resend (optional email digests) · Vercel (hosting + cron).

## Local development

```bash
npm install
npm test        # 31 unit tests — no env needed
npm run build   # green without env vars
npm run dev     # needs .env.local (see below)
```

## Provisioning (one-time setup)

The app currently has **no live Supabase project** — this is the deferred setup.

1. **Create a Supabase project**, then apply the migration `supabase/migrations/0001_init.sql` (SQL editor, CLI `supabase db push`, or MCP `apply_migration`). It creates all 7 tables, RLS policies, and the private `photos` storage bucket — nothing in app code creates these.
2. **Configure auth redirect URLs** in Supabase → Authentication → URL Configuration: add `{your-app-url}/auth/callback` (and `http://localhost:3000/auth/callback` for dev). Magic-link login silently fails without this — most common first-deploy footgun.
3. **Copy `.env.example` to `.env.local`** and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from project API settings
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only; used by the public share page and cron. Never expose client-side.
   - `ANTHROPIC_API_KEY` — powers photo extraction (`EXTRACTION_MODEL` defaults to `claude-sonnet-4-6`)
   - `CRON_SECRET` — any long random string; Vercel cron sends it as a Bearer token
   - `NEXT_PUBLIC_APP_URL` — the deployed URL (used in magic links and emails)
   - `RESEND_API_KEY` — optional; without it reminders are in-app only. To send from your own domain, verify it in Resend and change the `from:` address in `src/app/api/cron/reminders/route.ts`.
4. **Deploy to Vercel** with the same env vars. `vercel.json` registers the daily reminder digest cron (13:00 UTC) automatically.

## Testing

- `npm test` — Vitest unit tests (extraction schemas, Claude extraction with recorded fixtures, reminder due math, share tokens). No network, no env.
- `npm run e2e` — Playwright smoke (login render, auth redirect, share-token 404, manifest). Requires a Supabase-configured dev server or `E2E_BASE_URL` pointing at a deployment — not runnable until provisioning is done.

## Architecture notes

- Extraction is **advisory**: Claude's output pre-fills a confirm form (low-confidence fields flagged ⚠ below 0.7); nothing is saved without user confirmation. Manual entry always works.
- Every saved record keeps its source photo — that's the "verified" in the share page's verified record.
- RLS is owner-only on all tables (denormalized `owner_id`, no policy joins). The public share page (`/r/[token]`) reads via the service role after validating the unguessable 192-bit token; revoking a link kills the page.
- Money is stored as integer cents (`bigint`), displayed as dollars. Fractional columns are `float8`, not `numeric` — PostgREST serializes `numeric` as strings.

## Contributing & policies

- [CONTRIBUTING.md](CONTRIBUTING.md) — conventions that PRs must follow (advisory extraction, cents/dollars, RLS ownership, env-free builds)
- [SECURITY.md](SECURITY.md) — private vulnerability reporting and researcher scope notes
- [CHANGELOG.md](CHANGELOG.md) — release history
- [LICENSE](LICENSE) — MIT
