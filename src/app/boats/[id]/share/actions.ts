"use server";
import { requireUser } from "@/lib/supabase/server";
import { generateShareToken } from "@/lib/share/token";
import { revalidatePath } from "next/cache";

export async function createShareLink(boatId: string) {
  const { supabase, user } = await requireUser();
  const { data: boat } = await supabase.from("boats").select("id").eq("id", boatId).single();
  if (!boat) throw new Error("Boat not found");
  const { error } = await supabase.from("share_links")
    .insert({ boat_id: boatId, owner_id: user.id, token: generateShareToken() });
  if (error) throw new Error(error.message);
  revalidatePath(`/boats/${boatId}/share`);
}

export async function revokeShareLink(linkId: string, boatId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("share_links")
    .update({ revoked: true }).eq("id", linkId).eq("boat_id", boatId);
  if (error) throw new Error(error.message);
  revalidatePath(`/boats/${boatId}/share`);
}
