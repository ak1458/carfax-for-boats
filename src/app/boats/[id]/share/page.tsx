import { requireUser } from "@/lib/supabase/server";
import { createShareLink, revokeShareLink } from "./actions";
import type { ShareLink } from "@/lib/types";

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: links } = await supabase.from("share_links").select("*")
    .eq("boat_id", id).eq("revoked", false).order("created_at", { ascending: false });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

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
