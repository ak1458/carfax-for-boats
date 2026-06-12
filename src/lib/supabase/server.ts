import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try { all.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* called from Server Component — middleware refreshes instead */ }
        },
      },
    }
  );
}

/**
 * Auth contract: middleware already redirects unauthenticated users for all
 * non-public routes, so this throw is a backstop, not a UX path. Callers
 * (pages, server actions, API routes) may rely on it without try/catch;
 * API routes that want a clean 401 should catch "UNAUTHENTICATED".
 */
export async function requireUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}
