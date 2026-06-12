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

  // Attach the plate photo as a document now that the boat exists (skip when manual entry had no photo)
  if (values.platePhotoPath) {
    const { error: docErr } = await supabase.from("documents").insert({
      boat_id: boat.id, owner_id: user.id, storage_path: values.platePhotoPath, doc_type: "engine_plate",
    });
    if (docErr) console.error("plate document insert failed:", docErr.message);
  }

  return { boatId: boat.id, systemId: system.id };
}

/** Step 2 result: first service event from confirmed receipt values + starter reminder.
 *  When documentId is provided, the documents row already exists (PhotoCapture created it);
 *  only insert a new row when there's a storagePath but no documentId.
 */
export async function createFirstService(args: {
  boatId: string; systemId: string; receiptPhotoPath: string; documentId: string | null;
  values: { event_date: string; vendor: string; description: string; cost_dollars: string; engine_hours: string };
}) {
  const { supabase, user } = await requireUser();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.values.event_date))
    throw new Error("Please enter a valid date");
  const hoursRaw = args.values.engine_hours;
  if (hoursRaw && (!Number.isFinite(Number(hoursRaw)) || Number(hoursRaw) < 0))
    throw new Error("Engine hours must be a positive number");
  if (args.values.cost_dollars && (!Number.isFinite(Number(args.values.cost_dollars)) || Number(args.values.cost_dollars) < 0))
    throw new Error("Cost must be a positive amount");

  let documentId: string | null = args.documentId;
  if (!documentId && args.receiptPhotoPath) {
    const { data: doc, error: docErr } = await supabase.from("documents")
      .insert({ boat_id: args.boatId, owner_id: user.id, storage_path: args.receiptPhotoPath, doc_type: "receipt" })
      .select("id").single();
    if (docErr) throw new Error(docErr.message);
    documentId = doc.id;
  }

  const { error: evErr } = await supabase.from("service_events").insert({
    boat_id: args.boatId, owner_id: user.id, system_id: args.systemId, document_id: documentId,
    event_date: args.values.event_date,
    vendor: args.values.vendor || null,
    description: args.values.description || null,
    cost_cents: args.values.cost_dollars ? Math.round(Number(args.values.cost_dollars) * 100) : null,
    engine_hours: hoursRaw ? Number(hoursRaw) : null,
  });
  if (evErr) throw new Error(evErr.message);

  // Best-effort starter reminder; failure must not block onboarding completion.
  // Starter reminder: oil change every 100 hours or 12 months
  const nextDue = new Date(); nextDue.setMonth(nextDue.getMonth() + 12);
  const hours = hoursRaw ? Number(hoursRaw) : null;
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
