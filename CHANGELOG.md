# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-06-12

First complete MVP. Boats-first vertical.

### Added

- **Two-step photo onboarding** — engine plate photo → AI-built boat profile + engine system; receipt photo → first service entry + starter oil-change reminder. Target: under 2 minutes.
- **AI extraction engine** — Claude vision with forced tool-use, per-field confidence scores, typed error taxonomy (unreadable / truncated / invalid output / API error), recorded-fixture tests. Extraction is advisory: users confirm/edit before anything is saved; fields under 0.7 confidence are flagged.
- **Boat dashboard** — systems inventory, photo-backed service timeline, due reminders with one-tap mark-done (rolls recurring rules forward).
- **Service & hour logging** — photo → extract → confirm flows with manual-entry fallback everywhere; client-side image downscaling (EXIF-aware) keeps phone photos within Claude vision limits.
- **Reminders engine** — engine-hours and calendar rules, month-end-clamped date math (TDD), daily email digest via Vercel cron + Resend (optional).
- **Transferable record** — revocable share links (`/r/{token}`, 192-bit tokens) rendering a public, read-only, photo-backed service history with a verified badge.
- **Database schema** — 7 tables with owner-only RLS, denormalized owner ids, FK indexes, private photo storage bucket with size/MIME limits (`supabase/migrations/0001_init.sql`).
- **PWA** — manifest, icons, phone-camera capture via the browser; no app store required.
- 31 unit tests (Vitest) + 4 Playwright smoke tests; CI builds with zero env vars.

### Security

- Path-traversal guard on storage paths; ownership re-verification in all server actions; magic-link auth with route-guard proxy; service-role usage confined to the public record page and cron.

[0.1.0]: https://github.com/ak1458/carfax-for-boats/releases/tag/v0.1.0
