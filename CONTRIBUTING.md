# Contributing

Thanks for your interest in Boat Record. This is an early-stage MVP — issues and PRs welcome.

## Getting started

```bash
npm install
npm test        # 31 unit tests, no env needed
npm run build   # green without env vars
```

Running the app itself needs a Supabase project — see the [README provisioning steps](README.md#provisioning-one-time-setup).

## Project conventions

These are load-bearing; PRs that break them will be asked to change:

- **Extraction is advisory.** Claude vision output pre-fills forms; the user's confirmed values are what get written. Never auto-persist model output as a record.
- **Confidence-wrapped fields.** Every AI-extracted field is `{ value, confidence }` (0–1). UI flags anything below `LOW_CONFIDENCE` (0.7, exported from `src/lib/extraction/schemas.ts`).
- **Money:** integer cents (`bigint`) in the DB, dollars in the UI. Conversion happens in server actions.
- **Dates:** ISO `YYYY-MM-DD` strings in app code; comparisons are lexicographic.
- **Ownership:** every table carries denormalized `owner_id` with owner-only RLS. Server actions re-verify resource ownership (`boat_id` scoping) as defense in depth.
- **Service role** (`supabaseAdmin`) is used only by the public share page and the cron route. Everything else goes through the cookie-bound client.
- **No module-scope client construction** (Supabase or Anthropic) — the build must stay green with zero env vars. Lazy-init inside functions.

## Tests

- Pure logic (extraction schemas, reminder due math, tokens) is TDD'd in `tests/unit/`.
- Claude API calls are mocked with recorded fixtures in `tests/fixtures/extraction/` — never hit the real API in tests.
- E2E smoke lives in `e2e/` and needs a configured environment.

## Commits / PRs

- Conventional-ish prefixes: `feat:`, `fix:`, `docs:`, `chore:`.
- Small, focused PRs over large ones. Fill in the PR template — especially the "how tested" section.

## Roadmap context

Boats are the first vertical. Deferred by design (don't PR these without an issue discussion first): parts inventory, buyer transfer/claim flow, payments, native apps, other asset classes (RV/horse/classic car), offline support.
