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
