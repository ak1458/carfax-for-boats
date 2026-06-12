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
