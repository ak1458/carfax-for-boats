# Boat Record

A boat maintenance application that turns engine photos, receipts, and hour readings into owner-reviewed service records and shareable history.

[![Next.js: App Router](https://img.shields.io/badge/Next.js-App%20Router-111827?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript: Typed](https://img.shields.io/badge/TypeScript-Typed-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase: Backend](https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-64748B?style=flat-square)](LICENSE)

[Design](docs/superpowers/specs/2026-06-11-carfax-for-boats-design.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## What it does

- Captures engine plates, receipts, and hour-meter photos.
- Extracts proposed structured data for the owner to review before saving.
- Tracks service history and maintenance due by time or engine hours.
- Creates revocable, read-only share links for buyers and brokers.

## Run locally

```bash
git clone https://github.com/ak1458/carfax-for-boats.git
cd carfax-for-boats
npm ci
cp .env.example .env.local
npm run dev
```

Configure Supabase URL/keys, an Anthropic API key for image extraction, and optional email/cron settings from [.env.example](.env.example). Apply the [database migration](supabase/migrations/0001_init.sql) to a development Supabase project and configure authentication redirects and photo storage.

## Engineering notes

| Concern | Location |
| --- | --- |
| Extraction schema and provider | `src/lib/extraction/` |
| Due-date rules | `src/lib/reminders/` |
| Share-token generation | `src/lib/share/` |
| Ownership policies | `supabase/migrations/` |
| Unit and browser checks | `tests/`, `e2e/` |

Available checks: `npm test`, `npm run lint`, `npm run build`, and `npm run e2e`. Browser and integration flows require configured services.

Extraction is advisory. A photo-backed record is not an independent inspection or a guarantee of the underlying maintenance work.

## License

Copyright © 2026 Ashraf Kamal. Reuse is restricted by [LICENSE](LICENSE).
