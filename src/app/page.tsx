import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { supabase } = await requireUser();
  const { data: boats } = await supabase.from("boats").select("id").order("created_at", { ascending: false }).limit(1);
  redirect(boats?.length ? `/boats/${boats[0].id}` : "/onboarding");
}
