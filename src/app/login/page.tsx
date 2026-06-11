"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    });
    if (error) setError(error.message); else setSent(true);
  }

  if (sent) return <main><h1>Check your email</h1><p>Magic link sent to {email}.</p></main>;
  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={sendLink}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button type="submit">Send magic link</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
