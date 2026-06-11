# Carfax for Boats MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boats-first transferable maintenance record app: photo → AI extraction → confirmed service history → reminders → public share-link record page.

**Architecture:** Next.js 16 App Router (TypeScript) PWA talking to Supabase (Postgres + magic-link auth + Storage). A single `/api/extract` route calls Claude vision with tool-use JSON schemas per document type; extraction is advisory and every write is gated by a user confirm form. Pure-function libs (`extraction/schemas`, `reminders/due`, `share/token`) carry the logic and the tests; pages are thin.

**Tech Stack:** Next.js 16, TypeScript, Supabase JS v2, `@anthropic-ai/sdk`, Zod, Vitest, Playwright, Resend (optional).

**Spec:** `docs/superpowers/specs/2026-06-11-carfax-for-boats-design.md`

---

## File Structure

```text
package.json / tsconfig.json / next.config.ts / vitest.config.ts / playwright.config.ts
.env.example
supabase/migrations/0001_init.sql      — enums, tables, RLS, storage bucket
src/lib/types.ts                       — domain row types (mirror of schema)
src/lib/supabase/server.ts             — cookie-bound server client (per-request)
src/lib/supabase/admin.ts              — service-role client (share page, cron)
src/lib/extraction/schemas.ts          — Zod schemas per doc_type, confidence-wrapped fields
src/lib/extraction/extract.ts          — Claude vision call, injectable client
src/lib/reminders/due.ts               — isDue / rollForward pure functions
src/lib/share/token.ts                 — share-token generation
src/app/api/extract/route.ts           — POST {document_id} → extraction_json
src/app/api/cron/reminders/route.ts    — daily digest email (Resend optional)
src/app/login/page.tsx                 — magic-link sign-in
src/app/auth/callback/route.ts         — OTP code exchange
src/app/page.tsx                       — boat list / redirect to onboarding
src/app/onboarding/page.tsx            — plate photo → receipt photo → done
src/app/boats/[id]/page.tsx            — boat dashboard (timeline, systems, due reminders)
src/app/boats/[id]/log-service/page.tsx
src/app/boats/[id]/log-hours/page.tsx
src/components/PhotoCapture.tsx        — camera input + upload + extract, shared by all flows
src/components/ConfirmExtraction.tsx   — editable form pre-filled from extraction, flags conf < 0.7
src/app/r/[token]/page.tsx             — public read-only record page
tests/unit/schemas.test.ts
tests/unit/due.test.ts
tests/unit/token.test.ts
tests/unit/extract.test.ts             — mocked Anthropic client + fixtures
tests/fixtures/extraction/*.json       — recorded tool-use outputs (clean/messy receipt, plate, meter, unreadable)
e2e/smoke.spec.ts
public/manifest.json
```

Conventions locked for all tasks: money in integer cents, dates as ISO `YYYY-MM-DD` strings in app code, every confidence is a number 0–1, threshold for "low confidence" is `< 0.7`.

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder)

- [ ] **Step 1: Scaffold Next.js**

```bash
npx create-next-app@latest . --ts --app --src-dir --no-tailwind --eslint --no-turbopack --import-alias "@/*" --yes
npm i @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod resend
npm i -D vitest @vitest/coverage-v8 @playwright/test
```

Expected: project scaffolds; `npm run dev` would boot. (Don't leave dev server running.)

- [ ] **Step 2: Add vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 3: Add `.env.example`**

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
EXTRACTION_MODEL=claude-sonnet-4-6
RESEND_API_KEY=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 4: Verify and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest and deps"
```

---

### Task 2: Database schema + domain types

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `src/lib/types.ts`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/0001_init.sql`:

```sql
create type system_kind as enum ('engine','generator','other');
create type doc_type as enum ('receipt','engine_plate','hour_meter','other');
create type reminder_rule as enum ('calendar','hours');
create type reminder_status as enum ('active','done','dismissed');

create table boats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  make text, model text, year int, hin text,
  hero_photo_path text,
  created_at timestamptz not null default now()
);

create table systems (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind system_kind not null default 'engine',
  make text, model text, serial text,
  tracks_hours boolean not null default false,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  doc_type doc_type not null default 'other',
  extraction_json jsonb,
  extraction_model text,
  extraction_confidence numeric,
  created_at timestamptz not null default now()
);

create table service_events (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  system_id uuid references systems(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  event_date date not null,
  vendor text, description text,
  cost_cents int, currency text not null default 'USD',
  engine_hours numeric,
  parts jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table hour_readings (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references systems(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  hours numeric not null,
  reading_date date not null,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  system_id uuid references systems(id) on delete set null,
  title text not null,
  rule_type reminder_rule not null,
  interval_months int, interval_hours int,
  next_due_date date, next_due_hours numeric,
  last_done_event_id uuid references service_events(id) on delete set null,
  status reminder_status not null default 'active',
  created_at timestamptz not null default now()
);

create table share_links (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS: owner-only on everything. Share page bypasses via service role.
alter table boats enable row level security;
alter table systems enable row level security;
alter table documents enable row level security;
alter table service_events enable row level security;
alter table hour_readings enable row level security;
alter table reminders enable row level security;
alter table share_links enable row level security;

create policy boats_owner on boats for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy systems_owner on systems for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy documents_owner on documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy service_events_owner on service_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy hour_readings_owner on hour_readings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy reminders_owner on reminders for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy share_links_owner on share_links for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Private photo bucket; paths are {owner_id}/...
insert into storage.buckets (id, name, public) values ('photos','photos',false)
  on conflict (id) do nothing;

create policy photos_owner_rw on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

Note: every child table carries a denormalized `owner_id` so RLS never needs joins.

- [ ] **Step 2: Apply migration to Supabase project**

Use the Supabase MCP `apply_migration` tool (or `supabase db push` if CLI is linked) with the SQL above, migration name `init`.
Expected: success; `list_tables` shows the 7 tables.

- [ ] **Step 3: Write domain types**

Create `src/lib/types.ts`:

```ts
export type SystemKind = "engine" | "generator" | "other";
export type DocType = "receipt" | "engine_plate" | "hour_meter" | "other";
export type ReminderRule = "calendar" | "hours";
export type ReminderStatus = "active" | "done" | "dismissed";

export interface Boat {
  id: string; owner_id: string; name: string;
  make: string | null; model: string | null; year: number | null;
  hin: string | null; hero_photo_path: string | null; created_at: string;
}

export interface System {
  id: string; boat_id: string; owner_id: string; kind: SystemKind;
  make: string | null; model: string | null; serial: string | null;
  tracks_hours: boolean; created_at: string;
}

export interface DocumentRow {
  id: string; boat_id: string; owner_id: string; storage_path: string;
  doc_type: DocType; extraction_json: unknown | null;
  extraction_model: string | null; extraction_confidence: number | null;
  created_at: string;
}

export interface Part { name: string; part_number?: string; quantity?: number; unit_cost_cents?: number; }

export interface ServiceEvent {
  id: string; boat_id: string; owner_id: string;
  system_id: string | null; document_id: string | null;
  event_date: string; vendor: string | null; description: string | null;
  cost_cents: number | null; currency: string; engine_hours: number | null;
  parts: Part[]; created_at: string;
}

export interface HourReading {
  id: string; system_id: string; owner_id: string;
  hours: number; reading_date: string; document_id: string | null; created_at: string;
}

export interface Reminder {
  id: string; boat_id: string; owner_id: string; system_id: string | null;
  title: string; rule_type: ReminderRule;
  interval_months: number | null; interval_hours: number | null;
  next_due_date: string | null; next_due_hours: number | null;
  last_done_event_id: string | null; status: ReminderStatus; created_at: string;
}

export interface ShareLink {
  id: string; boat_id: string; owner_id: string;
  token: string; revoked: boolean; created_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase src/lib/types.ts && git commit -m "feat: database schema with RLS and domain types"
```

---

### Task 3: Supabase clients + magic-link auth

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/middleware.ts`

- [ ] **Step 1: Server client (cookie-bound, per request)**

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try { all.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* called from Server Component — middleware refreshes instead */ }
        },
      },
    }
  );
}

export async function requireUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}
```

- [ ] **Step 2: Admin client (service role — share page + cron only)**

Create `src/lib/supabase/admin.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

- [ ] **Step 3: Login page (magic link)**

Create `src/app/login/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    });
    if (error) setError(error.message); else setSent(true);
  }

  if (sent) return <main><h1>Check your email</h1><p>Magic link sent to {email}.</p></main>;
  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={sendLink}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button type="submit">Send magic link</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 4: Auth callback route**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => all.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      } }
    );
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
```

- [ ] **Step 5: Middleware — session refresh + route guard**

Create `src/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        all.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/auth") ||
    pathname.startsWith("/r/") || pathname.startsWith("/api/cron");
  if (!user && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)"] };
```

- [ ] **Step 6: Verify and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/lib/supabase src/app/login src/app/auth src/middleware.ts
git commit -m "feat: supabase clients, magic-link auth, route guard"
```

---

### Task 4: Extraction Zod schemas (TDD)

**Files:**
- Create: `tests/unit/schemas.test.ts`, `src/lib/extraction/schemas.ts`

Confidence-wrapped field convention: every extracted field is `{ value, confidence }` with confidence 0–1. `overallConfidence` = min of present field confidences.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { receiptSchema, enginePlateSchema, hourMeterSchema, schemaForDocType, overallConfidence } from "@/lib/extraction/schemas";

const cf = (value: unknown, confidence = 0.95) => ({ value, confidence });

describe("receiptSchema", () => {
  it("parses a clean receipt", () => {
    const parsed = receiptSchema.parse({
      vendor: cf("West Marine"), date: cf("2026-05-01"),
      total_cents: cf(12999), currency: cf("USD"),
      line_items: [{ description: cf("Oil filter"), part_number: cf("35-866340Q03"), quantity: cf(2), price_cents: cf(2599) }],
      engine_hours: cf(412),
    });
    expect(parsed.vendor.value).toBe("West Marine");
    expect(parsed.line_items[0].quantity?.value).toBe(2);
  });

  it("rejects out-of-range confidence", () => {
    expect(() => receiptSchema.parse({ vendor: cf("X", 1.5), date: cf("2026-05-01"), total_cents: cf(1), currency: cf("USD"), line_items: [] })).toThrow();
  });

  it("allows missing optional fields", () => {
    const parsed = receiptSchema.parse({ vendor: cf("Y"), date: cf("2026-05-01"), total_cents: cf(500), currency: cf("USD"), line_items: [] });
    expect(parsed.engine_hours).toBeUndefined();
  });
});

describe("enginePlateSchema", () => {
  it("parses plate", () => {
    const parsed = enginePlateSchema.parse({ make: cf("Yanmar"), model: cf("4JH57"), serial: cf("E12345"), horsepower: cf(57), year: cf(2019) });
    expect(parsed.make.value).toBe("Yanmar");
  });
});

describe("hourMeterSchema", () => {
  it("parses hours", () => {
    expect(hourMeterSchema.parse({ hours: cf(412.5) }).hours.value).toBe(412.5);
  });
});

describe("schemaForDocType", () => {
  it("maps doc types", () => {
    expect(schemaForDocType("receipt")).toBe(receiptSchema);
    expect(schemaForDocType("engine_plate")).toBe(enginePlateSchema);
    expect(schemaForDocType("hour_meter")).toBe(hourMeterSchema);
    expect(() => schemaForDocType("other")).toThrow();
  });
});

describe("overallConfidence", () => {
  it("returns min confidence across fields, recursing into arrays", () => {
    const parsed = receiptSchema.parse({
      vendor: cf("X", 0.9), date: cf("2026-05-01", 0.8), total_cents: cf(1, 0.95), currency: cf("USD", 1),
      line_items: [{ description: cf("filter", 0.4) }],
    });
    expect(overallConfidence(parsed)).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/extraction/schemas`.

- [ ] **Step 3: Implement schemas**

Create `src/lib/extraction/schemas.ts`:

```ts
import { z } from "zod";

const conf = z.number().min(0).max(1);
const cf = <T extends z.ZodTypeAny>(inner: T) => z.object({ value: inner, confidence: conf });

export const receiptSchema = z.object({
  vendor: cf(z.string()),
  date: cf(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  total_cents: cf(z.number().int()),
  currency: cf(z.string().length(3)),
  line_items: z.array(z.object({
    description: cf(z.string()),
    part_number: cf(z.string()).optional(),
    quantity: cf(z.number()).optional(),
    price_cents: cf(z.number().int()).optional(),
  })),
  engine_hours: cf(z.number()).optional(),
});

export const enginePlateSchema = z.object({
  make: cf(z.string()),
  model: cf(z.string()),
  serial: cf(z.string()),
  horsepower: cf(z.number()).optional(),
  year: cf(z.number().int()).optional(),
});

export const hourMeterSchema = z.object({ hours: cf(z.number()) });

export type ReceiptExtraction = z.infer<typeof receiptSchema>;
export type EnginePlateExtraction = z.infer<typeof enginePlateSchema>;
export type HourMeterExtraction = z.infer<typeof hourMeterSchema>;

export function schemaForDocType(docType: string) {
  switch (docType) {
    case "receipt": return receiptSchema;
    case "engine_plate": return enginePlateSchema;
    case "hour_meter": return hourMeterSchema;
    default: throw new Error(`No extraction schema for doc_type "${docType}"`);
  }
}

export const LOW_CONFIDENCE = 0.7;

export function overallConfidence(extraction: unknown): number {
  let min = 1;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.confidence === "number" && "value" in rec) min = Math.min(min, rec.confidence);
      else Object.values(rec).forEach(walk);
    }
  };
  walk(extraction);
  return min;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: all schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/schemas.test.ts src/lib/extraction/schemas.ts
git commit -m "feat: confidence-wrapped extraction schemas with TDD"
```


---

### Task 5: Extraction engine — fixtures, lib, API route (TDD)

**Files:**
- Create: `tests/fixtures/extraction/receipt-clean.json`, `receipt-messy.json`, `engine-plate.json`, `hour-meter.json`, `unreadable.json`
- Create: `tests/unit/extract.test.ts`, `src/lib/extraction/extract.ts`, `src/app/api/extract/route.ts`

- [ ] **Step 1: Create fixtures**

Each fixture is the `input` object of a recorded Claude tool-use block. `tests/fixtures/extraction/receipt-clean.json`:

```json
{
  "vendor": { "value": "West Marine", "confidence": 0.98 },
  "date": { "value": "2026-05-01", "confidence": 0.95 },
  "total_cents": { "value": 12999, "confidence": 0.97 },
  "currency": { "value": "USD", "confidence": 0.99 },
  "line_items": [
    { "description": { "value": "Quicksilver oil filter", "confidence": 0.96 },
      "part_number": { "value": "35-866340Q03", "confidence": 0.9 },
      "quantity": { "value": 2, "confidence": 0.95 },
      "price_cents": { "value": 2599, "confidence": 0.94 } }
  ],
  "engine_hours": { "value": 412, "confidence": 0.85 }
}
```

`receipt-messy.json` — same shape, low confidences (vendor 0.55, date 0.6, no line_items, total 0.65). `engine-plate.json`:

```json
{
  "make": { "value": "Yanmar", "confidence": 0.97 },
  "model": { "value": "4JH57", "confidence": 0.93 },
  "serial": { "value": "E12345", "confidence": 0.88 },
  "horsepower": { "value": 57, "confidence": 0.9 }
}
```

`hour-meter.json`: `{ "hours": { "value": 412.5, "confidence": 0.92 } }`. `unreadable.json`: `{ "unreadable": true, "reason": "image too blurry" }`.

- [ ] **Step 2: Write failing tests**

Create `tests/unit/extract.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { extractDocument, ExtractionError } from "@/lib/extraction/extract";
import receiptClean from "../fixtures/extraction/receipt-clean.json";
import plateFix from "../fixtures/extraction/engine-plate.json";
import unreadable from "../fixtures/extraction/unreadable.json";

function mockClient(toolInput: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_extraction", input: toolInput }],
      }),
    },
  } as never;
}

const img = { base64: "aGVsbG8=", mediaType: "image/jpeg" as const };

describe("extractDocument", () => {
  it("returns validated receipt extraction with overall confidence", async () => {
    const result = await extractDocument(img, "receipt", mockClient(receiptClean));
    expect(result.extraction).toMatchObject({ vendor: { value: "West Marine" } });
    expect(result.confidence).toBeCloseTo(0.85);
  });

  it("returns validated plate extraction", async () => {
    const result = await extractDocument(img, "engine_plate", mockClient(plateFix));
    expect((result.extraction as { make: { value: string } }).make.value).toBe("Yanmar");
  });

  it("throws UNREADABLE when model reports unreadable", async () => {
    await expect(extractDocument(img, "receipt", mockClient(unreadable)))
      .rejects.toMatchObject({ code: "UNREADABLE" } satisfies Partial<ExtractionError>);
  });

  it("throws INVALID_OUTPUT when tool output fails schema", async () => {
    await expect(extractDocument(img, "receipt", mockClient({ vendor: "no-confidence-wrapper" })))
      .rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("throws NO_TOOL_USE when model returns plain text", async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }) } } as never;
    await expect(extractDocument(img, "receipt", client)).rejects.toMatchObject({ code: "NO_TOOL_USE" });
  });
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `npm test -- extract`
Expected: FAIL — cannot resolve `@/lib/extraction/extract`.

- [ ] **Step 4: Implement extraction lib**

Create `src/lib/extraction/extract.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { schemaForDocType, overallConfidence } from "./schemas";

export class ExtractionError extends Error {
  constructor(public code: "UNREADABLE" | "INVALID_OUTPUT" | "NO_TOOL_USE" | "API_ERROR", message: string) {
    super(message);
  }
}

export interface ImageInput { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; }
export interface ExtractionResult { extraction: unknown; confidence: number; model: string; }

const PROMPTS: Record<string, string> = {
  receipt: "Extract structured data from this marine service receipt. Amounts in integer cents. Dates as YYYY-MM-DD. If a field is absent, omit it. Set per-field confidence 0-1 honestly — use low values when unsure.",
  engine_plate: "Extract make, model, and serial number from this engine identification plate photo. Set per-field confidence 0-1 honestly.",
  hour_meter: "Read the hours value from this engine hour meter photo. Set confidence 0-1 honestly.",
};

function toolSchemaFor(docType: string): Record<string, unknown> {
  // JSON Schema mirror of the Zod schemas. The model may alternatively report {unreadable: true, reason}.
  const cf = (type: string) => ({
    type: "object",
    properties: { value: { type }, confidence: { type: "number", minimum: 0, maximum: 1 } },
    required: ["value", "confidence"],
  });
  const shapes: Record<string, Record<string, unknown>> = {
    receipt: {
      type: "object",
      properties: {
        unreadable: { type: "boolean" }, reason: { type: "string" },
        vendor: cf("string"), date: cf("string"), total_cents: cf("integer"), currency: cf("string"),
        line_items: { type: "array", items: { type: "object", properties: {
          description: cf("string"), part_number: cf("string"), quantity: cf("number"), price_cents: cf("integer") } } },
        engine_hours: cf("number"),
      },
    },
    engine_plate: {
      type: "object",
      properties: { unreadable: { type: "boolean" }, reason: { type: "string" },
        make: cf("string"), model: cf("string"), serial: cf("string"), horsepower: cf("number"), year: cf("integer") },
    },
    hour_meter: {
      type: "object",
      properties: { unreadable: { type: "boolean" }, reason: { type: "string" }, hours: cf("number") },
    },
  };
  return shapes[docType];
}

export async function extractDocument(
  image: ImageInput,
  docType: "receipt" | "engine_plate" | "hour_meter",
  client: Anthropic = new Anthropic()
): Promise<ExtractionResult> {
  const model = process.env.EXTRACTION_MODEL ?? "claude-sonnet-4-6";
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 2048,
      tools: [{ name: "record_extraction", description: "Record the extracted document data", input_schema: toolSchemaFor(docType) as never }],
      tool_choice: { type: "tool", name: "record_extraction" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: PROMPTS[docType] },
        ],
      }],
    });
  } catch (err) {
    throw new ExtractionError("API_ERROR", err instanceof Error ? err.message : "Claude API call failed");
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new ExtractionError("NO_TOOL_USE", "Model returned no tool_use block");

  const input = toolUse.input as Record<string, unknown>;
  if (input.unreadable) throw new ExtractionError("UNREADABLE", String(input.reason ?? "Image unreadable"));

  const parsed = schemaForDocType(docType).safeParse(input);
  if (!parsed.success) throw new ExtractionError("INVALID_OUTPUT", z.prettifyError(parsed.error));

  return { extraction: parsed.data, confidence: overallConfidence(parsed.data), model };
}
```

Note: if the installed Zod is v3, replace `z.prettifyError(parsed.error)` with `parsed.error.message`.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- extract`
Expected: all 5 PASS.

- [ ] **Step 6: API route**

Create `src/app/api/extract/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { extractDocument, ExtractionError, type ImageInput } from "@/lib/extraction/extract";

export const maxDuration = 60;

export async function POST(request: Request) {
  let user, supabase;
  try { ({ user, supabase } = await requireUser()); }
  catch { return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); }

  const { document_id } = await request.json().catch(() => ({}));
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("*").eq("id", document_id).single();
  if (!doc || doc.owner_id !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["receipt", "engine_plate", "hour_meter"].includes(doc.doc_type))
    return NextResponse.json({ error: `doc_type ${doc.doc_type} not extractable` }, { status: 400 });

  const { data: blob, error: dlErr } = await supabase.storage.from("photos").download(doc.storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: "photo download failed" }, { status: 500 });

  const image: ImageInput = {
    base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    mediaType: (blob.type || "image/jpeg") as ImageInput["mediaType"],
  };

  try {
    const result = await extractDocument(image, doc.doc_type);
    await supabase.from("documents").update({
      extraction_json: result.extraction,
      extraction_model: result.model,
      extraction_confidence: result.confidence,
    }).eq("id", document_id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExtractionError)
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "API_ERROR" ? 502 : 422 });
    throw err;
  }
}
```

- [ ] **Step 7: Verify build + commit**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

```bash
git add tests/fixtures tests/unit/extract.test.ts src/lib/extraction/extract.ts src/app/api/extract
git commit -m "feat: Claude vision extraction lib and API route with fixture tests"
```

---

### Task 6: Photo capture + confirm components

**Files:**
- Create: `src/components/PhotoCapture.tsx`, `src/components/ConfirmExtraction.tsx`, `src/lib/photos.ts`

- [ ] **Step 1: Client photo helper**

Create `src/lib/photos.ts`:

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Upload photo to photos/{userId}/{timestamp}-{name}; returns storage path. */
export async function uploadPhoto(file: File, userId: string): Promise<string> {
  const supabase = supabaseBrowser();
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const { error } = await supabase.storage.from("photos").upload(path, file);
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}
```

- [ ] **Step 2: PhotoCapture component**

Create `src/components/PhotoCapture.tsx`:

```tsx
"use client";
import { useState } from "react";
import { uploadPhoto, supabaseBrowser } from "@/lib/photos";
import type { DocType } from "@/lib/types";

interface Props {
  boatId: string | null; // null during onboarding before boat exists — document row created later by server action
  docType: DocType;
  label: string;
  onExtracted: (args: { documentId: string | null; storagePath: string; extraction: unknown; confidence: number }) => void;
  onManualEntry: () => void;
}

export default function PhotoCapture({ boatId, docType, label, onExtracted, onManualEntry }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setBusy("Uploading photo…");
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const storagePath = await uploadPhoto(file, user.id);

      let documentId: string | null = null;
      if (boatId) {
        const { data, error } = await supabase.from("documents")
          .insert({ boat_id: boatId, owner_id: user.id, storage_path: storagePath, doc_type: docType })
          .select("id").single();
        if (error) throw new Error(error.message);
        documentId = data.id;
      }

      setBusy("Reading photo with AI…");
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentId ? { document_id: documentId } : { storage_path: storagePath, doc_type: docType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Extraction failed");
      onExtracted({ documentId, storagePath, extraction: body.extraction, confidence: body.confidence });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="photo-capture">
      <label className="photo-button">
        {busy ?? label}
        <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={handleFile} />
      </label>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={onManualEntry}>Enter manually instead</button>
        </div>
      )}
    </div>
  );
}
```

Note for Task 6 follow-up: `/api/extract` (Task 5) accepts `document_id`. Extend it to also accept `{storage_path, doc_type}` for the onboarding pre-boat case: same flow, but skip the document lookup/update and just return the extraction. Add this branch in this task:

In `src/app/api/extract/route.ts`, replace the `document_id` guard with:

```ts
  const body = await request.json().catch(() => ({}));
  const { document_id, storage_path, doc_type } = body;
  let docType: string, storagePath: string, docId: string | null = null;
  if (document_id) {
    const { data: doc } = await supabase.from("documents").select("*").eq("id", document_id).single();
    if (!doc || doc.owner_id !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
    docType = doc.doc_type; storagePath = doc.storage_path; docId = doc.id;
  } else if (storage_path && doc_type) {
    if (!storage_path.startsWith(`${user.id}/`)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    docType = doc_type; storagePath = storage_path;
  } else {
    return NextResponse.json({ error: "document_id or storage_path+doc_type required" }, { status: 400 });
  }
```

…and only run the `documents.update` when `docId` is set. Keep the rest identical.

- [ ] **Step 3: ConfirmExtraction component (generic editable form)**

Create `src/components/ConfirmExtraction.tsx`:

```tsx
"use client";
import { useState } from "react";
import { LOW_CONFIDENCE } from "@/lib/extraction/schemas";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "date";
  value: string | number | "";
  confidence: number; // 1 for manually-added fields
}

interface Props {
  title: string;
  fields: FieldDef[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

export default function ConfirmExtraction({ title, fields, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, String(f.value ?? "")]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(values); }
    catch (err) { setError(err instanceof Error ? err.message : "Save failed"); setBusy(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="confirm-extraction">
      <h2>{title}</h2>
      <p>Check what the AI read. Fix anything that looks wrong.</p>
      {fields.map((f) => (
        <label key={f.name} className={f.confidence < LOW_CONFIDENCE ? "low-confidence" : ""}>
          {f.label}{f.confidence < LOW_CONFIDENCE && <span className="flag" title="AI was unsure — double-check"> ⚠ check this</span>}
          <input
            type={f.type} name={f.name} value={values[f.name]}
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
```

Add to `src/app/globals.css`:

```css
.low-confidence input { border: 2px solid #d97706; background: #fffbeb; }
.flag { color: #d97706; font-size: 0.85em; }
.photo-button { display: inline-block; padding: 1rem 1.5rem; background: #0c4a6e; color: white; border-radius: 8px; cursor: pointer; }
```

- [ ] **Step 4: Verify build + commit**

Run: `npm run build && npm test`
Expected: success.

```bash
git add src/components src/lib/photos.ts src/app/api/extract src/app/globals.css
git commit -m "feat: photo capture and extraction confirm components"
```


---

### Task 7: Onboarding flow

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/OnboardingWizard.tsx`, `src/app/onboarding/actions.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Server actions**

Create `src/app/onboarding/actions.ts`:

```ts
"use server";
import { requireUser } from "@/lib/supabase/server";

/** Step 1 result: boat + engine system from confirmed plate values. */
export async function createBoatWithEngine(values: {
  boatName: string; make: string; model: string; serial: string; platePhotoPath: string;
}) {
  const { supabase, user } = await requireUser();
  const { data: boat, error: boatErr } = await supabase.from("boats")
    .insert({ owner_id: user.id, name: values.boatName, make: values.make || null, model: values.model || null })
    .select("id").single();
  if (boatErr) throw new Error(boatErr.message);

  const { data: system, error: sysErr } = await supabase.from("systems")
    .insert({ boat_id: boat.id, owner_id: user.id, kind: "engine", make: values.make || null,
      model: values.model || null, serial: values.serial || null, tracks_hours: true })
    .select("id").single();
  if (sysErr) throw new Error(sysErr.message);

  // Attach the plate photo as a document now that the boat exists
  await supabase.from("documents").insert({
    boat_id: boat.id, owner_id: user.id, storage_path: values.platePhotoPath, doc_type: "engine_plate",
  });

  return { boatId: boat.id, systemId: system.id };
}

/** Step 2 result: first service event from confirmed receipt values + starter reminder. */
export async function createFirstService(args: {
  boatId: string; systemId: string; receiptPhotoPath: string;
  values: { event_date: string; vendor: string; description: string; cost_cents: string; engine_hours: string };
}) {
  const { supabase, user } = await requireUser();

  const { data: doc, error: docErr } = await supabase.from("documents")
    .insert({ boat_id: args.boatId, owner_id: user.id, storage_path: args.receiptPhotoPath, doc_type: "receipt" })
    .select("id").single();
  if (docErr) throw new Error(docErr.message);

  const { error: evErr } = await supabase.from("service_events").insert({
    boat_id: args.boatId, owner_id: user.id, system_id: args.systemId, document_id: doc.id,
    event_date: args.values.event_date,
    vendor: args.values.vendor || null,
    description: args.values.description || null,
    cost_cents: args.values.cost_cents ? Math.round(Number(args.values.cost_cents)) : null,
    engine_hours: args.values.engine_hours ? Number(args.values.engine_hours) : null,
  });
  if (evErr) throw new Error(evErr.message);

  // Starter reminder: oil change every 100 hours or 12 months
  const nextDue = new Date(); nextDue.setMonth(nextDue.getMonth() + 12);
  const hours = args.values.engine_hours ? Number(args.values.engine_hours) : null;
  await supabase.from("reminders").insert({
    boat_id: args.boatId, owner_id: user.id, system_id: args.systemId,
    title: "Engine oil & filter change",
    rule_type: hours !== null ? "hours" : "calendar",
    interval_hours: hours !== null ? 100 : null,
    interval_months: hours !== null ? null : 12,
    next_due_hours: hours !== null ? hours + 100 : null,
    next_due_date: hours !== null ? null : nextDue.toISOString().slice(0, 10),
  });

  return { boatId: args.boatId };
}
```

- [ ] **Step 2: Wizard client component**

Create `src/app/onboarding/OnboardingWizard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction, { type FieldDef } from "@/components/ConfirmExtraction";
import { createBoatWithEngine, createFirstService } from "./actions";

type CfField = { value: string | number; confidence: number } | undefined;
const fd = (name: string, label: string, type: FieldDef["type"], f: CfField): FieldDef =>
  ({ name, label, type, value: f?.value ?? "", confidence: f?.confidence ?? 1 });

type Stage =
  | { step: "plate" }
  | { step: "confirm-plate"; path: string; extraction: Record<string, CfField> }
  | { step: "receipt"; boatId: string; systemId: string }
  | { step: "confirm-receipt"; boatId: string; systemId: string; path: string; extraction: Record<string, CfField> };

export default function OnboardingWizard() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "plate" });

  if (stage.step === "plate") return (
    <section>
      <h1>Step 1 of 2 — Your engine</h1>
      <PhotoCapture boatId={null} docType="engine_plate" label="📷 Snap your engine plate"
        onExtracted={({ storagePath, extraction }) =>
          setStage({ step: "confirm-plate", path: storagePath, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setStage({ step: "confirm-plate", path: "", extraction: {} })}
      />
    </section>
  );

  if (stage.step === "confirm-plate") return (
    <ConfirmExtraction title="Your engine" submitLabel="Looks right — create my boat"
      fields={[
        { name: "boatName", label: "Boat name", type: "text", value: "", confidence: 1 },
        fd("make", "Engine make", "text", stage.extraction.make),
        fd("model", "Engine model", "text", stage.extraction.model),
        fd("serial", "Serial number", "text", stage.extraction.serial),
      ]}
      onSubmit={async (v) => {
        const { boatId, systemId } = await createBoatWithEngine({
          boatName: v.boatName || "My boat", make: v.make, model: v.model, serial: v.serial, platePhotoPath: stage.path,
        });
        setStage({ step: "receipt", boatId, systemId });
      }}
    />
  );

  if (stage.step === "receipt") return (
    <section>
      <h1>Step 2 of 2 — Your last service</h1>
      <PhotoCapture boatId={stage.boatId} docType="receipt" label="📷 Snap one service receipt"
        onExtracted={({ storagePath, extraction }) =>
          setStage({ step: "confirm-receipt", ...stage, path: storagePath, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setStage({ step: "confirm-receipt", ...stage, path: "", extraction: {} })}
      />
      <button onClick={() => router.push(`/boats/${stage.boatId}`)}>Skip for now</button>
    </section>
  );

  return (
    <ConfirmExtraction title="Your last service" submitLabel="Save & finish"
      fields={[
        fd("event_date", "Date", "date", stage.extraction.date),
        fd("vendor", "Vendor", "text", stage.extraction.vendor),
        { name: "description", label: "What was done", type: "text", value: "", confidence: 1 },
        fd("cost_cents", "Total (cents)", "number", stage.extraction.total_cents),
        fd("engine_hours", "Engine hours at service", "number", stage.extraction.engine_hours),
      ]}
      onSubmit={async (v) => {
        await createFirstService({
          boatId: stage.boatId, systemId: stage.systemId, receiptPhotoPath: stage.path,
          values: { event_date: v.event_date, vendor: v.vendor, description: v.description,
            cost_cents: v.cost_cents, engine_hours: v.engine_hours },
        });
        router.push(`/boats/${stage.boatId}`);
      }}
    />
  );
}
```

- [ ] **Step 3: Onboarding page + home redirect**

Create `src/app/onboarding/page.tsx`:

```tsx
import OnboardingWizard from "./OnboardingWizard";
export default function OnboardingPage() {
  return <main><OnboardingWizard /></main>;
}
```

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

export default async function Home() {
  const { supabase } = await requireUser();
  const { data: boats } = await supabase.from("boats").select("id").limit(1);
  redirect(boats?.length ? `/boats/${boats[0].id}` : "/onboarding");
}
```

- [ ] **Step 4: Verify build + commit**

Run: `npm run build && npm test`
Expected: success.

```bash
git add src/app/onboarding src/app/page.tsx
git commit -m "feat: two-step photo onboarding wizard"
```

---

### Task 8: Boat dashboard + log service + log hours

**Files:**
- Create: `src/app/boats/[id]/page.tsx`, `src/app/boats/[id]/actions.ts`, `src/app/boats/[id]/log-service/page.tsx`, `src/app/boats/[id]/log-service/LogServiceFlow.tsx`, `src/app/boats/[id]/log-hours/page.tsx`, `src/app/boats/[id]/log-hours/LogHoursFlow.tsx`

- [ ] **Step 1: Dashboard server actions**

Create `src/app/boats/[id]/actions.ts`:

```ts
"use server";
import { requireUser } from "@/lib/supabase/server";

export async function createServiceEvent(args: {
  boatId: string; receiptPhotoPath: string | null; documentId: string | null;
  values: { event_date: string; vendor: string; description: string; cost_cents: string; engine_hours: string; system_id: string };
}) {
  const { supabase, user } = await requireUser();
  let documentId = args.documentId;
  if (!documentId && args.receiptPhotoPath) {
    const { data: doc } = await supabase.from("documents")
      .insert({ boat_id: args.boatId, owner_id: user.id, storage_path: args.receiptPhotoPath, doc_type: "receipt" })
      .select("id").single();
    documentId = doc?.id ?? null;
  }
  const { error } = await supabase.from("service_events").insert({
    boat_id: args.boatId, owner_id: user.id,
    system_id: args.values.system_id || null, document_id: documentId,
    event_date: args.values.event_date,
    vendor: args.values.vendor || null, description: args.values.description || null,
    cost_cents: args.values.cost_cents ? Math.round(Number(args.values.cost_cents)) : null,
    engine_hours: args.values.engine_hours ? Number(args.values.engine_hours) : null,
  });
  if (error) throw new Error(error.message);
}

export async function createHourReading(args: {
  systemId: string; documentId: string | null; values: { hours: string; reading_date: string };
}) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("hour_readings").insert({
    system_id: args.systemId, owner_id: user.id, document_id: args.documentId,
    hours: Number(args.values.hours), reading_date: args.values.reading_date,
  });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Dashboard page**

Create `src/app/boats/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { isDue } from "@/lib/reminders/due";
import type { Reminder, ServiceEvent, System } from "@/lib/types";

export default async function BoatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();

  const { data: boat } = await supabase.from("boats").select("*").eq("id", id).single();
  if (!boat) notFound();

  const [{ data: systems }, { data: events }, { data: reminders }, { data: readings }] = await Promise.all([
    supabase.from("systems").select("*").eq("boat_id", id),
    supabase.from("service_events").select("*").eq("boat_id", id).order("event_date", { ascending: false }),
    supabase.from("reminders").select("*").eq("boat_id", id).eq("status", "active"),
    supabase.from("hour_readings").select("*").order("reading_date", { ascending: false }),
  ]);

  const latestHoursBySystem = new Map<string, number>();
  for (const r of readings ?? []) if (!latestHoursBySystem.has(r.system_id)) latestHoursBySystem.set(r.system_id, Number(r.hours));
  const today = new Date().toISOString().slice(0, 10);
  const due = (reminders ?? []).filter((rem: Reminder) =>
    isDue(rem, rem.system_id ? latestHoursBySystem.get(rem.system_id) ?? null : null, today));

  return (
    <main>
      <h1>{boat.name}</h1>
      <p>{[boat.make, boat.model, boat.year].filter(Boolean).join(" ")}</p>
      <nav>
        <Link href={`/boats/${id}/log-service`}>+ Log service</Link>{" · "}
        <Link href={`/boats/${id}/log-hours`}>+ Log hours</Link>{" · "}
        <Link href={`/boats/${id}/share`}>Share record</Link>
      </nav>

      {due.length > 0 && (
        <section>
          <h2>Due now</h2>
          <ul>{due.map((r: Reminder) => <li key={r.id}>⚠ {r.title}</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Systems</h2>
        <ul>{(systems ?? []).map((s: System) => (
          <li key={s.id}>{s.kind}: {[s.make, s.model].filter(Boolean).join(" ")}
            {s.tracks_hours && latestHoursBySystem.has(s.id) && ` — ${latestHoursBySystem.get(s.id)} hrs`}</li>
        ))}</ul>
      </section>

      <section>
        <h2>Service history</h2>
        <ul>{(events ?? []).map((e: ServiceEvent) => (
          <li key={e.id}>
            <strong>{e.event_date}</strong> {e.vendor && `— ${e.vendor}`} {e.description && `— ${e.description}`}
            {e.cost_cents != null && ` — $${(e.cost_cents / 100).toFixed(2)}`}
            {e.engine_hours != null && ` — ${e.engine_hours} hrs`}
            {e.document_id && " 📎"}
          </li>
        ))}</ul>
      </section>
    </main>
  );
}
```

Note: `isDue` comes from Task 9. If executing tasks in order, add a temporary stub `export const isDue = () => false;` in `src/lib/reminders/due.ts` now and replace it in Task 9 — or execute Task 9 before this step's build check.

- [ ] **Step 3: Log service flow**

Create `src/app/boats/[id]/log-service/LogServiceFlow.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction, { type FieldDef } from "@/components/ConfirmExtraction";
import { createServiceEvent } from "../actions";

type CfField = { value: string | number; confidence: number } | undefined;
const fd = (name: string, label: string, type: FieldDef["type"], f: CfField): FieldDef =>
  ({ name, label, type, value: f?.value ?? "", confidence: f?.confidence ?? 1 });

export default function LogServiceFlow({ boatId, systems }: { boatId: string; systems: { id: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { step: "capture" }
    | { step: "confirm"; documentId: string | null; path: string | null; extraction: Record<string, CfField> }
  >({ step: "capture" });

  if (state.step === "capture") return (
    <section>
      <h1>Log service</h1>
      <PhotoCapture boatId={boatId} docType="receipt" label="📷 Snap the receipt"
        onExtracted={({ documentId, storagePath, extraction }) =>
          setState({ step: "confirm", documentId, path: storagePath, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setState({ step: "confirm", documentId: null, path: null, extraction: {} })}
      />
      <button onClick={() => setState({ step: "confirm", documentId: null, path: null, extraction: {} })}>
        Enter manually
      </button>
    </section>
  );

  return (
    <ConfirmExtraction title="Service details" submitLabel="Save service"
      fields={[
        fd("event_date", "Date", "date", state.extraction.date),
        fd("vendor", "Vendor", "text", state.extraction.vendor),
        { name: "description", label: "What was done", type: "text", value: "", confidence: 1 },
        fd("cost_cents", "Total (cents)", "number", state.extraction.total_cents),
        fd("engine_hours", "Engine hours", "number", state.extraction.engine_hours),
        { name: "system_id", label: `System ID (${systems.map((s) => `${s.label}=${s.id}`).join(", ") || "none"})`, type: "text", value: systems[0]?.id ?? "", confidence: 1 },
      ]}
      onSubmit={async (v) => {
        await createServiceEvent({
          boatId, receiptPhotoPath: state.path, documentId: state.documentId,
          values: { event_date: v.event_date, vendor: v.vendor, description: v.description,
            cost_cents: v.cost_cents, engine_hours: v.engine_hours, system_id: v.system_id },
        });
        router.push(`/boats/${boatId}`);
      }}
    />
  );
}
```

(System picker as raw ID text field is deliberate MVP crudeness; a `<select>` upgrade rides with PWA polish in Task 11.)

Create `src/app/boats/[id]/log-service/page.tsx`:

```tsx
import { requireUser } from "@/lib/supabase/server";
import LogServiceFlow from "./LogServiceFlow";

export default async function LogServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: systems } = await supabase.from("systems").select("id, kind, make, model").eq("boat_id", id);
  return <main><LogServiceFlow boatId={id} systems={(systems ?? []).map((s) => ({ id: s.id, label: [s.kind, s.make, s.model].filter(Boolean).join(" ") }))} /></main>;
}
```

- [ ] **Step 4: Log hours flow**

Create `src/app/boats/[id]/log-hours/LogHoursFlow.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction from "@/components/ConfirmExtraction";
import { createHourReading } from "../actions";

type CfField = { value: string | number; confidence: number } | undefined;

export default function LogHoursFlow({ boatId, systemId }: { boatId: string; systemId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { step: "capture" }
    | { step: "confirm"; documentId: string | null; extraction: Record<string, CfField> }
  >({ step: "capture" });

  if (state.step === "capture") return (
    <section>
      <h1>Log engine hours</h1>
      <PhotoCapture boatId={boatId} docType="hour_meter" label="📷 Snap the hour meter"
        onExtracted={({ documentId, extraction }) =>
          setState({ step: "confirm", documentId, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setState({ step: "confirm", documentId: null, extraction: {} })}
      />
    </section>
  );

  return (
    <ConfirmExtraction title="Hour reading" submitLabel="Save reading"
      fields={[
        { name: "hours", label: "Hours", type: "number", value: state.extraction.hours?.value ?? "", confidence: state.extraction.hours?.confidence ?? 1 },
        { name: "reading_date", label: "Date", type: "date", value: new Date().toISOString().slice(0, 10), confidence: 1 },
      ]}
      onSubmit={async (v) => {
        await createHourReading({ systemId, documentId: state.documentId, values: { hours: v.hours, reading_date: v.reading_date } });
        router.push(`/boats/${boatId}`);
      }}
    />
  );
}
```

Create `src/app/boats/[id]/log-hours/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import LogHoursFlow from "./LogHoursFlow";

export default async function LogHoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: system } = await supabase.from("systems").select("id").eq("boat_id", id).eq("tracks_hours", true).limit(1).single();
  if (!system) notFound();
  return <main><LogHoursFlow boatId={id} systemId={system.id} /></main>;
}
```

- [ ] **Step 5: Verify build + commit**

Run: `npm run build && npm test`
Expected: success.

```bash
git add src/app/boats
git commit -m "feat: boat dashboard, log-service and log-hours flows"
```


---

### Task 9: Reminders engine (TDD) + mark done + cron digest

**Files:**
- Create: `tests/unit/due.test.ts`, `src/lib/reminders/due.ts`, `src/app/api/cron/reminders/route.ts`
- Modify: `src/app/boats/[id]/actions.ts` (add `markReminderDone`)
- Modify: `src/app/boats/[id]/page.tsx` (add mark-done button via form action)

- [ ] **Step 1: Write failing tests**

Create `tests/unit/due.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isDue, rollForward } from "@/lib/reminders/due";
import type { Reminder } from "@/lib/types";

const base: Reminder = {
  id: "r1", boat_id: "b1", owner_id: "u1", system_id: "s1",
  title: "Oil change", rule_type: "hours",
  interval_months: null, interval_hours: 100,
  next_due_date: null, next_due_hours: 500,
  last_done_event_id: null, status: "active", created_at: "",
};

describe("isDue", () => {
  it("hours rule: due when latest reading >= next_due_hours", () => {
    expect(isDue(base, 500, "2026-06-11")).toBe(true);
    expect(isDue(base, 510, "2026-06-11")).toBe(true);
    expect(isDue(base, 499, "2026-06-11")).toBe(false);
  });

  it("hours rule: not due when no reading exists", () => {
    expect(isDue(base, null, "2026-06-11")).toBe(false);
  });

  it("calendar rule: due when today >= next_due_date", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 12, next_due_date: "2026-06-11" };
    expect(isDue(cal, null, "2026-06-11")).toBe(true);
    expect(isDue(cal, null, "2026-06-12")).toBe(true);
    expect(isDue(cal, null, "2026-06-10")).toBe(false);
  });

  it("non-active reminders are never due", () => {
    expect(isDue({ ...base, status: "dismissed" }, 600, "2026-06-11")).toBe(false);
  });
});

describe("rollForward", () => {
  it("hours rule: next due = done hours + interval", () => {
    expect(rollForward(base, { doneDate: "2026-06-11", doneHours: 512 }))
      .toEqual({ next_due_hours: 612, next_due_date: null });
  });

  it("hours rule without done hours: rolls from previous due", () => {
    expect(rollForward(base, { doneDate: "2026-06-11", doneHours: null }))
      .toEqual({ next_due_hours: 600, next_due_date: null });
  });

  it("calendar rule: next due = done date + interval months", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 6, next_due_date: "2026-06-01" };
    expect(rollForward(cal, { doneDate: "2026-06-11", doneHours: null }))
      .toEqual({ next_due_hours: null, next_due_date: "2026-12-11" });
  });

  it("calendar rule clamps month-end overflow (Jan 31 + 1mo = Feb 28)", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 1, next_due_date: "2026-01-31" };
    expect(rollForward(cal, { doneDate: "2026-01-31", doneHours: null }))
      .toEqual({ next_due_hours: null, next_due_date: "2026-02-28" });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test -- due`
Expected: FAIL — cannot resolve `@/lib/reminders/due` (or stub from Task 8 fails assertions).

- [ ] **Step 3: Implement**

Create (or replace stub in) `src/lib/reminders/due.ts`:

```ts
import type { Reminder } from "@/lib/types";

/** today is ISO YYYY-MM-DD; latestHours is the newest reading for the reminder's system, or null. */
export function isDue(reminder: Reminder, latestHours: number | null, today: string): boolean {
  if (reminder.status !== "active") return false;
  if (reminder.rule_type === "hours")
    return reminder.next_due_hours != null && latestHours != null && latestHours >= Number(reminder.next_due_hours);
  return reminder.next_due_date != null && today >= reminder.next_due_date;
}

/** Add months in pure date math, clamping to the target month's last day. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function rollForward(
  reminder: Reminder,
  done: { doneDate: string; doneHours: number | null }
): { next_due_hours: number | null; next_due_date: string | null } {
  if (reminder.rule_type === "hours") {
    const baseHours = done.doneHours ?? Number(reminder.next_due_hours ?? 0);
    return { next_due_hours: baseHours + Number(reminder.interval_hours ?? 0), next_due_date: null };
  }
  return { next_due_hours: null, next_due_date: addMonthsClamped(done.doneDate, reminder.interval_months ?? 0) };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- due`
Expected: all PASS (including month-end clamp).

- [ ] **Step 5: Mark-done server action**

Append to `src/app/boats/[id]/actions.ts`:

```ts
export async function markReminderDone(reminderId: string, boatId: string) {
  "use server";
  const { requireUser } = await import("@/lib/supabase/server");
  const { rollForward } = await import("@/lib/reminders/due");
  const { supabase, user } = await requireUser();

  const { data: reminder } = await supabase.from("reminders").select("*").eq("id", reminderId).single();
  if (!reminder) throw new Error("Reminder not found");

  const today = new Date().toISOString().slice(0, 10);
  const { data: event } = await supabase.from("service_events")
    .insert({ boat_id: boatId, owner_id: user.id, system_id: reminder.system_id,
      event_date: today, description: `${reminder.title} (marked done from reminder)` })
    .select("id").single();

  const next = rollForward(reminder, { doneDate: today, doneHours: null });
  await supabase.from("reminders").update({ ...next, last_done_event_id: event?.id ?? null }).eq("id", reminderId);
}
```

(Top-level `"use server"` already covers the file; the inline directive is harmless — drop it if the linter complains. Use plain top-level imports instead of dynamic ones.)

In `src/app/boats/[id]/page.tsx`, render each due reminder with a mark-done form:

```tsx
{due.map((r: Reminder) => (
  <li key={r.id}>⚠ {r.title}{" "}
    <form action={async () => { "use server"; const { markReminderDone } = await import("./actions"); await markReminderDone(r.id, id); }} style={{ display: "inline" }}>
      <button type="submit">Mark done</button>
    </form>
  </li>
))}
```

- [ ] **Step 6: Cron digest route**

Create `src/app/api/cron/reminders/route.ts`:

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDue } from "@/lib/reminders/due";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: reminders } = await supabase.from("reminders").select("*").eq("status", "active");
  const { data: readings } = await supabase.from("hour_readings").select("system_id, hours, reading_date").order("reading_date", { ascending: false });
  const latest = new Map<string, number>();
  for (const r of readings ?? []) if (!latest.has(r.system_id)) latest.set(r.system_id, Number(r.hours));

  const due = (reminders ?? []).filter((rem) => isDue(rem, rem.system_id ? latest.get(rem.system_id) ?? null : null, today));
  if (due.length === 0 || !process.env.RESEND_API_KEY)
    return NextResponse.json({ due: due.length, emailed: false });

  // One digest per owner
  const byOwner = new Map<string, typeof due>();
  for (const d of due) byOwner.set(d.owner_id, [...(byOwner.get(d.owner_id) ?? []), d]);

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  let emailed = 0;
  for (const [ownerId, items] of byOwner) {
    const { data: userData } = await supabase.auth.admin.getUserById(ownerId);
    const email = userData?.user?.email;
    if (!email) continue;
    await resend.emails.send({
      from: "reminders@yourdomain.example",
      to: email,
      subject: `${items.length} maintenance item${items.length > 1 ? "s" : ""} due`,
      text: items.map((i) => `• ${i.title}`).join("\n") + `\n\nOpen the app: ${process.env.NEXT_PUBLIC_APP_URL}`,
    });
    emailed++;
  }
  return NextResponse.json({ due: due.length, emailed });
}
```

Create `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 13 * * *" }] }
```

- [ ] **Step 7: Verify build + commit**

Run: `npm run build && npm test`
Expected: success, all tests pass.

```bash
git add tests/unit/due.test.ts src/lib/reminders src/app/api/cron src/app/boats vercel.json
git commit -m "feat: reminder due engine, mark-done roll-forward, cron digest"
```


---

### Task 10: Share links + public record page (TDD on token)

**Files:**
- Create: `tests/unit/token.test.ts`, `src/lib/share/token.ts`, `src/app/boats/[id]/share/page.tsx`, `src/app/boats/[id]/share/actions.ts`, `src/app/r/[token]/page.tsx`

- [ ] **Step 1: Write failing token tests**

Create `tests/unit/token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateShareToken } from "@/lib/share/token";

describe("generateShareToken", () => {
  it("is at least 32 chars and URL-safe", () => {
    const t = generateShareToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique across calls", () => {
    expect(new Set(Array.from({ length: 100 }, generateShareToken)).size).toBe(100);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- token`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

Create `src/lib/share/token.ts`:

```ts
import { randomBytes } from "node:crypto";

/** 24 random bytes → 32-char base64url token. */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- token`
Expected: PASS.

- [ ] **Step 5: Share management page + actions**

Create `src/app/boats/[id]/share/actions.ts`:

```ts
"use server";
import { requireUser } from "@/lib/supabase/server";
import { generateShareToken } from "@/lib/share/token";
import { revalidatePath } from "next/cache";

export async function createShareLink(boatId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("share_links")
    .insert({ boat_id: boatId, owner_id: user.id, token: generateShareToken() });
  if (error) throw new Error(error.message);
  revalidatePath(`/boats/${boatId}/share`);
}

export async function revokeShareLink(linkId: string, boatId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("share_links").update({ revoked: true }).eq("id", linkId);
  if (error) throw new Error(error.message);
  revalidatePath(`/boats/${boatId}/share`);
}
```

Create `src/app/boats/[id]/share/page.tsx`:

```tsx
import { requireUser } from "@/lib/supabase/server";
import { createShareLink, revokeShareLink } from "./actions";
import type { ShareLink } from "@/lib/types";

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: links } = await supabase.from("share_links").select("*")
    .eq("boat_id", id).eq("revoked", false).order("created_at", { ascending: false });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  return (
    <main>
      <h1>Share your boat&apos;s record</h1>
      <p>Anyone with the link sees a read-only, photo-backed service history. Revoke anytime.</p>
      <form action={createShareLink.bind(null, id)}><button type="submit">Create share link</button></form>
      <ul>
        {(links ?? []).map((l: ShareLink) => (
          <li key={l.id}>
            <code>{appUrl}/r/{l.token}</code>{" "}
            <form action={revokeShareLink.bind(null, l.id, id)} style={{ display: "inline" }}>
              <button type="submit">Revoke</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Public record page (service role, token-gated)**

Create `src/app/r/[token]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ServiceEvent, System, HourReading } from "@/lib/types";

export default async function PublicRecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) notFound();

  const supabase = supabaseAdmin();
  const { data: link } = await supabase.from("share_links").select("boat_id, revoked").eq("token", token).single();
  if (!link || link.revoked) notFound();

  const { data: boat } = await supabase.from("boats").select("name, make, model, year").eq("id", link.boat_id).single();
  if (!boat) notFound();

  const [{ data: systems }, { data: events }] = await Promise.all([
    supabase.from("systems").select("*").eq("boat_id", link.boat_id),
    supabase.from("service_events").select("*").eq("boat_id", link.boat_id).order("event_date", { ascending: false }),
  ]);

  const systemIds = (systems ?? []).map((s: System) => s.id);
  const { data: readings } = systemIds.length
    ? await supabase.from("hour_readings").select("*").in("system_id", systemIds).order("reading_date")
    : { data: [] as HourReading[] };

  // Signed thumbnail URLs for photo-backed entries (1 hour expiry)
  const docIds = (events ?? []).map((e: ServiceEvent) => e.document_id).filter(Boolean) as string[];
  const thumbs = new Map<string, string>();
  if (docIds.length) {
    const { data: docs } = await supabase.from("documents").select("id, storage_path").in("id", docIds);
    for (const d of docs ?? []) {
      const { data: signed } = await supabase.storage.from("photos").createSignedUrl(d.storage_path, 3600);
      if (signed) thumbs.set(d.id, signed.signedUrl);
    }
  }

  const verifiedCount = (events ?? []).filter((e: ServiceEvent) => e.document_id).length;

  return (
    <main>
      <h1>{boat.name}</h1>
      <p>{[boat.make, boat.model, boat.year].filter(Boolean).join(" ")}</p>
      <p><strong>✓ Verified record</strong> — {verifiedCount} of {(events ?? []).length} entries photo-backed</p>

      <section>
        <h2>Systems</h2>
        <ul>{(systems ?? []).map((s: System) => (
          <li key={s.id}>{s.kind}: {[s.make, s.model, s.serial && `s/n ${s.serial}`].filter(Boolean).join(" ")}</li>
        ))}</ul>
      </section>

      {(readings ?? []).length > 0 && (
        <section>
          <h2>Engine hours</h2>
          <ul>{(readings ?? []).map((r: HourReading) => <li key={r.id}>{r.reading_date}: {r.hours} hrs</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Service history</h2>
        <ul>
          {(events ?? []).map((e: ServiceEvent) => (
            <li key={e.id}>
              <strong>{e.event_date}</strong> {e.vendor && `— ${e.vendor}`} {e.description && `— ${e.description}`}
              {e.cost_cents != null && ` — $${(e.cost_cents / 100).toFixed(2)}`}
              {e.engine_hours != null && ` — ${e.engine_hours} hrs`}
              {e.document_id && thumbs.has(e.document_id) && (
                <div><img src={thumbs.get(e.document_id)} alt="Source receipt" width={120} loading="lazy" /></div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Verify build + commit**

Run: `npm run build && npm test`
Expected: success.

```bash
git add tests/unit/token.test.ts src/lib/share src/app/boats src/app/r
git commit -m "feat: share links and public verified record page"
```

---

### Task 11: PWA manifest + Playwright smoke

**Files:**
- Create: `public/manifest.json`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Manifest + layout metadata**

Create `public/manifest.json`:

```json
{
  "name": "Boat Record",
  "short_name": "BoatRecord",
  "description": "Transferable maintenance record for your boat",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0c4a6e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Generate two solid-color placeholder PNGs at `public/icons/icon-192.png` and `public/icons/icon-512.png` (any tool; a 1-color square is fine for MVP).

In `src/app/layout.tsx` metadata export, add:

```ts
export const metadata: Metadata = {
  title: "Boat Record",
  description: "Transferable maintenance record for your boat",
  manifest: "/manifest.json",
};
export const viewport: Viewport = { themeColor: "#0c4a6e" };
```

(Import `Viewport` from `next` alongside `Metadata`.)

- [ ] **Step 2: Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
  },
});
```

Add script to `package.json`: `"e2e": "playwright test"`.

- [ ] **Step 3: Smoke test**

Auth via magic link can't run headless without an inbox; smoke covers public surfaces and auth gating. Create `e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("unknown share token 404s", async ({ page }) => {
  const response = await page.goto("/r/" + "x".repeat(40));
  expect(response?.status()).toBe(404);
});

test("manifest is served", async ({ request }) => {
  const res = await request.get("/manifest.json");
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).name).toBe("Boat Record");
});
```

- [ ] **Step 4: Run smoke**

Run: `npx playwright install chromium` (first time), then `npm run e2e`
Expected: 4 PASS (requires `.env.local` with Supabase keys so the dev server boots).

- [ ] **Step 5: Final verification + commit**

Run: `npm run build && npm test && npm run e2e`
Expected: everything green.

```bash
git add public playwright.config.ts e2e src/app/layout.tsx package.json
git commit -m "feat: PWA manifest and Playwright smoke tests"
```

---

## Verification checklist (manual, after all tasks)

1. `npm run dev` + phone on same network (or deployed preview): complete onboarding with a real engine plate photo and a real receipt — under 2 minutes.
2. Log a service and an hour reading; confirm low-confidence fields show the ⚠ flag.
3. Create a share link in an incognito window — record renders without login, photos visible, revoke kills it.
4. Hit `/api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` — returns due count.
5. Deploy to Vercel with env vars set; confirm cron is registered.

## Out of scope (per spec §3)

Parts inventory, buyer transfer flow, payments, native app, non-boat asset templates, offline support.

