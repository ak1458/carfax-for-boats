import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDue } from "@/lib/reminders/due";
import type { Reminder } from "@/lib/types";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const QUERY_CAP = 5000; // TODO: replace with per-system latest-reading query before beta scale
  const { data: reminders } = await supabase.from("reminders").select("*").eq("status", "active").limit(QUERY_CAP);
  if ((reminders?.length ?? 0) === QUERY_CAP) console.warn("cron: reminders hit query cap — results may be incomplete");
  const { data: readings } = await supabase.from("hour_readings").select("system_id, hours, reading_date").order("reading_date", { ascending: false }).limit(QUERY_CAP);
  if ((readings?.length ?? 0) === QUERY_CAP) console.warn("cron: readings hit query cap — latest-hours map may be incomplete");
  const latest = new Map<string, number>();
  for (const r of readings ?? []) if (!latest.has(r.system_id)) latest.set(r.system_id, Number(r.hours));

  const due = ((reminders ?? []) as Reminder[]).filter((rem) =>
    isDue(rem, rem.system_id ? latest.get(rem.system_id) ?? null : null, today));
  if (due.length === 0) return NextResponse.json({ due: 0, emailed: 0 });
  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ due: due.length, emailed: 0, note: "RESEND_API_KEY not configured" });

  // One digest per owner
  const byOwner = new Map<string, Reminder[]>();
  for (const d of due) byOwner.set(d.owner_id, [...(byOwner.get(d.owner_id) ?? []), d]);

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  let emailed = 0;
  // TODO: N+1 auth lookups — batch or parallelize beyond MVP scale.
  for (const [ownerId, items] of byOwner) {
    const { data: userData } = await supabase.auth.admin.getUserById(ownerId);
    const email = userData?.user?.email;
    if (!email) continue;
    const { error } = await resend.emails.send({
      from: "Boat Record <reminders@resend.dev>",
      to: email,
      subject: `${items.length} maintenance item${items.length > 1 ? "s" : ""} due`,
      text: items.map((i) => `• ${i.title}`).join("\n") + `\n\nOpen the app: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}`,
    });
    if (!error) emailed++;
  }
  return NextResponse.json({ due: due.length, emailed });
}
