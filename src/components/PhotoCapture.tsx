"use client";
import { useState } from "react";
import { uploadPhoto, supabaseBrowser } from "@/lib/photos";
import type { DocType } from "@/lib/types";

interface Props {
  boatId: string | null; // null during onboarding before boat exists — document row created later by server action
  docType: DocType;
  label: string;
  onExtracted: (args: { documentId: string | null; storagePath: string; extraction: unknown; confidence: number }) => void;
  onManualEntry: () => void;
}

export default function PhotoCapture({ boatId, docType, label, onExtracted, onManualEntry }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setBusy("Uploading photo…");
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const storagePath = await uploadPhoto(file, user.id);

      let documentId: string | null = null;
      if (boatId) {
        const { data, error } = await supabase.from("documents")
          .insert({ boat_id: boatId, owner_id: user.id, storage_path: storagePath, doc_type: docType })
          .select("id").single();
        if (error) throw new Error(error.message);
        documentId = data.id;
      }

      setBusy("Reading photo with AI…");
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentId ? { document_id: documentId } : { storage_path: storagePath, doc_type: docType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Extraction failed");
      onExtracted({ documentId, storagePath, extraction: body.extraction, confidence: body.confidence });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="photo-capture">
      <label className="photo-button">
        {busy ?? label}
        <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={handleFile} />
      </label>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={onManualEntry}>Enter manually instead</button>
        </div>
      )}
    </div>
  );
}
