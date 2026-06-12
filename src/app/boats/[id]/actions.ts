"use server";
import { requireUser } from "@/lib/supabase/server";

export async function createServiceEvent(args: {
  boatId: string; receiptPhotoPath: string | null; documentId: string | null;
  values: { event_date: string; vendor: string; description: string; cost_dollars: string; engine_hours: string; system_id: string };
}) {
  const { supabase, user } = await requireUser();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.values.event_date))
    throw new Error("Please enter a valid date");
  const hoursRaw = args.values.engine_hours;
  if (hoursRaw && (!Number.isFinite(Number(hoursRaw)) || Number(hoursRaw) < 0))
    throw new Error("Engine hours must be a positive number");
  const costRaw = args.values.cost_dollars;
  if (costRaw && (!Number.isFinite(Number(costRaw)) || Number(costRaw) < 0))
    throw new Error("Cost must be a positive amount");

  if (args.values.system_id) {
    const { data: sys } = await supabase.from("systems")
      .select("id").eq("id", args.values.system_id).eq("boat_id", args.boatId).single();
    if (!sys) throw new Error("System not found on this boat");
  }

  let documentId = args.documentId;
  if (!documentId && args.receiptPhotoPath) {
    const { data: doc, error: docErr } = await supabase.from("documents")
      .insert({ boat_id: args.boatId, owner_id: user.id, storage_path: args.receiptPhotoPath, doc_type: "receipt" })
      .select("id").single();
    if (docErr) throw new Error(docErr.message);
    documentId = doc.id;
  }

  const { error } = await supabase.from("service_events").insert({
    boat_id: args.boatId, owner_id: user.id,
    system_id: args.values.system_id || null, document_id: documentId,
    event_date: args.values.event_date,
    vendor: args.values.vendor || null, description: args.values.description || null,
    cost_cents: costRaw ? Math.round(Number(costRaw) * 100) : null,
    engine_hours: hoursRaw ? Number(hoursRaw) : null,
  });
  if (error) throw new Error(error.message);
}

export async function createHourReading(args: {
  systemId: string; documentId: string | null; values: { hours: string; reading_date: string };
}) {
  const { supabase, user } = await requireUser();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.values.reading_date))
    throw new Error("Please enter a valid date");
  const hours = Number(args.values.hours);
  if (!args.values.hours || !Number.isFinite(hours) || hours < 0)
    throw new Error("Hours must be a positive number");

  const { data: sys } = await supabase.from("systems")
    .select("id").eq("id", args.systemId).single();
  if (!sys) throw new Error("System not found");

  const { error } = await supabase.from("hour_readings").insert({
    system_id: args.systemId, owner_id: user.id, document_id: args.documentId,
    hours, reading_date: args.values.reading_date,
  });
  if (error) throw new Error(error.message);
}
