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
                // eslint-disable-next-line @next/next/no-img-element
                <div><img src={thumbs.get(e.document_id)} alt="Source receipt" width={120} loading="lazy" /></div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
