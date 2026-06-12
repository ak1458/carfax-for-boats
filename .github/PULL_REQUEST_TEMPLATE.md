## What

<!-- One or two sentences: what does this PR do? -->

## Why

<!-- Link the issue, or explain the owner/buyer pain it addresses. -->

## How tested

- [ ] `npm test` passes (unit)
- [ ] `npm run build` passes
- [ ] Manually exercised the affected flow (which device/browser?)

## Checklist

- [ ] AI extraction stays advisory — no model output is persisted without user confirmation
- [ ] New DB columns exist in a migration under `supabase/migrations/`
- [ ] Money handled as integer cents in the DB, dollars in the UI
- [ ] No service-role key usage outside `src/lib/supabase/admin.ts` consumers (public record page, cron)
