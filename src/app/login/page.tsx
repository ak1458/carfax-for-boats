"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

// Lazy singleton: env vars are inlined at build time, but the client must not
// be constructed during prerender (no env in CI builds) — only on first use.
let _supabase: ReturnType<typeof createBrowserClient> | undefined;
const getSupabase = () =>
  (_supabase ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/auth/callback` },
      });
      if (error) setError(error.message); else setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) return <main><h1>Check your email</h1><p>Magic link sent to {email}.</p></main>;
  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={sendLink}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button type="submit" disabled={loading}>{loading ? "Sending…" : "Send magic link"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
