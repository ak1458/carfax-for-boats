"use client";
import { useState } from "react";
import { LOW_CONFIDENCE } from "@/lib/extraction/schemas";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "date";
  value: string | number | "";
  confidence: number; // 1 for manually-added fields
}

interface Props {
  title: string;
  fields: FieldDef[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

export default function ConfirmExtraction({ title, fields, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, String(f.value ?? "")]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(values); }
    catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="confirm-extraction">
      <h2>{title}</h2>
      <p>Check what the AI read. Fix anything that looks wrong.</p>
      {fields.map((f) => (
        <label key={f.name} className={f.confidence < LOW_CONFIDENCE ? "low-confidence" : ""}>
          {f.label}{f.confidence < LOW_CONFIDENCE && <span className="flag" title="AI was unsure — double-check"> ⚠ check this</span>}
          <input
            type={f.type} name={f.name} value={values[f.name]}
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            required={f.type === "date"}
          />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
