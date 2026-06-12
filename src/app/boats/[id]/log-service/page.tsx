import { requireUser } from "@/lib/supabase/server";
import LogServiceFlow from "./LogServiceFlow";

export default async function LogServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: systems } = await supabase.from("systems").select("id, kind, make, model").eq("boat_id", id);
  return <main><LogServiceFlow boatId={id} systems={(systems ?? []).map((s) => ({ id: s.id, label: [s.kind, s.make, s.model].filter(Boolean).join(" ") }))} /></main>;
}
