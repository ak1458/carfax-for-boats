# Carfax for Boats — MVP Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorm session, option A: boats first, single vertical)
**Working title:** Carfax for Assets — Boats MVP

## 1. Overview

A transferable maintenance record app for boat owners. Owners photograph engine plates, receipts, and hour meters; AI extracts structured data into a systems inventory and service history. The app schedules maintenance reminders and produces a shareable, photo-backed ("verified") service record that boosts resale value.

Boats only for MVP. Horses, classic cars, and RVs come later as new asset templates — they are explicitly out of scope and the schema does not need to anticipate them beyond ordinary good modeling.

## 2. Goals

- Activation in under 2 minutes: one engine-plate photo + one receipt photo → working asset profile with first service entry and first reminder.
- Every record entry traceable to a source photo — this is the "verified" claim.
- A share link a seller can hand a buyer or broker: public, read-only, photo-backed service timeline.

## 3. Non-Goals (deferred to v2)

- Spare-parts inventory and storage location tracking
- Buyer transfer/claim flow (MVP ships a read-only share link only)
- Payments and subscriptions
- Native mobile app (PWA only)
- Horse / classic-car / RV asset templates
- Offline support

## 4. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend + API | Next.js 15 (App Router, TypeScript), PWA manifest | Phone camera via `<input capture>`, no app-store friction |
| Database + Auth + File storage | Supabase (Postgres, magic-link auth, Storage bucket for photos) | Already connected via MCP; RLS for owner isolation |
| AI extraction | Claude API (default `claude-sonnet-4-6`, configurable via env) | Multimodal vision → structured JSON via tool use |
| Email | Resend (optional; reminders degrade to in-app only without key) | Simple transactional email |
| Hosting | Vercel | Already connected via MCP; cron for reminder digests |
| Testing | Vitest (unit + route), Playwright (happy-path smoke) | TDD throughout |

Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL` (default `claude-sonnet-4-6`), `RESEND_API_KEY` (optional).

## 5. Data Model (Postgres via Supabase)

All tables have `id uuid pk default gen_random_uuid()` and `created_at timestamptz default now()`. All user tables carry `owner_id uuid references auth.users` with RLS: owner-only read/write.

- **boats** — `owner_id`, `name`, `make`, `model`, `year int`, `hin text` (hull ID, optional), `hero_photo_path text`
- **systems** — `boat_id fk`, `kind enum('engine','generator','other')`, `make`, `model`, `serial`, `tracks_hours bool default false`
- **documents** — `boat_id fk`, `storage_path text`, `doc_type enum('receipt','engine_plate','hour_meter','other')`, `extraction_json jsonb`, `extraction_model text`, `extraction_confidence numeric` (0–1 overall)
- **service_events** — `boat_id fk`, `system_id fk nullable`, `document_id fk nullable`, `event_date date`, `vendor text`, `description text`, `cost_cents int nullable`, `currency text default 'USD'`, `engine_hours numeric nullable`, `parts jsonb default '[]'` (array of `{name, part_number?, quantity?, unit_cost_cents?}`)
- **hour_readings** — `system_id fk`, `hours numeric`, `reading_date date`, `document_id fk nullable`
- **reminders** — `boat_id fk`, `system_id fk nullable`, `title text`, `rule_type enum('calendar','hours')`, `interval_months int nullable`, `interval_hours int nullable`, `next_due_date date nullable`, `next_due_hours numeric nullable`, `last_done_event_id fk nullable`, `status enum('active','done','dismissed') default 'active'`
- **share_links** — `boat_id fk`, `token text unique` (URL-safe random, ≥32 chars), `revoked bool default false`

Photos live in a private Supabase Storage bucket `photos/`, path-scoped per owner (`{owner_id}/...`). The public share page reads via a server route using the service-role key after validating the token — no public RLS policies needed.

## 6. AI Extraction Contract

Server route `POST /api/extract`: body `{document_id}`. Loads the photo from Storage, calls Claude with a tool-use JSON schema selected by `doc_type`:

- **receipt** → `{vendor, date, total_cents, currency, line_items: [{description, part_number?, quantity?, price_cents?}], engine_hours?}`
- **engine_plate** → `{make, model, serial, horsepower?, year?}`
- **hour_meter** → `{hours}`

Every field is paired with a `confidence` (0–1). The route stores raw output in `documents.extraction_json` and returns it. **Extraction output is never auto-saved as a record** — the UI always shows a confirm/edit form pre-filled from extraction; fields with confidence < 0.7 are visually flagged. The user's confirmed values become the `service_event` / `system` / `hour_reading` row.

Extraction failures (unreadable photo, API error) return a typed error; UI offers retake or manual entry. Manual entry is always available as a fallback for every flow.

## 7. Core Flows

1. **Onboarding** — magic-link sign-in → "Snap your engine plate" → extraction → confirm → boat + engine system created → "Snap one receipt" → extraction → confirm → first service event created → app suggests one starter reminder (e.g., oil change every 100 hours or 12 months) → done. Target: under 2 minutes.
2. **Log service** — from boat page: photo or upload receipt → extract → confirm/edit (date, vendor, cost, parts, hours, link to system) → saved with source photo.
3. **Log hours** — photo of hour meter → extract → confirm reading → saved; updates hour-based reminder due math.
4. **Reminders** — list view: due now / upcoming, sorted by urgency. Calendar rules use `next_due_date`; hour rules compare `next_due_hours` to the system's latest reading. "Mark done" links to a new service event and rolls the rule forward (recurring reminders stay `active` with new due values; `done` is for one-offs, `dismissed` silences a rule). Daily Vercel cron route emails a digest of due items via Resend when configured.
5. **Transferable record** — owner generates share link → `/r/{token}` public page: boat profile, systems inventory, full service timeline with thumbnails of source photos, engine-hours chart, "verified — every entry photo-backed" badge. Owner can revoke. No login required to view.

## 8. Error Handling

- Extraction is advisory only; user confirmation gates every write (see §6).
- Photo upload failures: retry prompt; nothing persisted until upload succeeds.
- Revoked/unknown share tokens → 404 page.
- API routes validate ownership via Supabase session; RLS is the backstop.

## 9. Testing Strategy

TDD throughout (superpowers:test-driven-development).

- **Unit (Vitest):** extraction schema validation (Zod parse of Claude tool output), reminder due-date/due-hours calculation, share-token generation, cents/currency formatting.
- **Route (Vitest):** API routes with Claude mocked via recorded fixture responses (one fixture per doc_type: clean receipt, messy receipt, engine plate, hour meter, unreadable) and Supabase mocked or pointed at a local stack.
- **E2E (Playwright):** one happy-path smoke — onboard → log service → create share link → view public page — run against a dev stack; skipped when env unavailable.

## 10. Build Order (input to implementation plan)

1. Scaffold: Next.js + Supabase schema/migrations + auth
2. Photo upload + documents table + storage
3. Extraction route + fixtures (TDD core)
4. Onboarding flow (plate + receipt → profile)
5. Service log + hours log flows
6. Reminders engine + cron digest
7. Share link + public record page
8. PWA polish + Playwright smoke
