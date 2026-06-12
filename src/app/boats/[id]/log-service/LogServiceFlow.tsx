"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction, { type FieldDef } from "@/components/ConfirmExtraction";
import { createServiceEvent } from "../actions";

type CfField = { value: string | number; confidence: number } | undefined;
const fd = (name: string, label: string, type: FieldDef["type"], f: CfField): FieldDef =>
  ({ name, label, type, value: f?.value ?? "", confidence: f?.confidence ?? 1 });

export default function LogServiceFlow({ boatId, systems }: { boatId: string; systems: { id: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { step: "capture" }
    | { step: "confirm"; documentId: string | null; path: string | null; extraction: Record<string, CfField> }
  >({ step: "capture" });

  if (state.step === "capture") return (
    <section>
      <h1>Log service</h1>
      <PhotoCapture boatId={boatId} docType="receipt" label="📷 Snap the receipt"
        onExtracted={({ documentId, storagePath, extraction }) =>
          setState({ step: "confirm", documentId, path: storagePath, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setState({ step: "confirm", documentId: null, path: null, extraction: {} })}
      />
      <button onClick={() => setState({ step: "confirm", documentId: null, path: null, extraction: {} })}>
        Enter manually
      </button>
    </section>
  );

  return (
    <ConfirmExtraction key="confirm-service" title="Service details" submitLabel="Save service"
      fields={[
        fd("event_date", "Date", "date", state.extraction.date),
        fd("vendor", "Vendor", "text", state.extraction.vendor),
        { name: "description", label: "What was done", type: "text", value: "", confidence: 1 },
        {
          name: "cost_dollars", label: "Total cost ($)", type: "number",
          value: state.extraction.total_cents ? (Number(state.extraction.total_cents.value) / 100).toFixed(2) : "",
          confidence: state.extraction.total_cents?.confidence ?? 1,
        },
        fd("engine_hours", "Engine hours", "number", state.extraction.engine_hours),
        { name: "system_id", label: `System ID (${systems.map((s) => `${s.label}=${s.id}`).join(", ") || "none"})`, type: "text", value: systems[0]?.id ?? "", confidence: 1 },
      ]}
      onSubmit={async (v) => {
        await createServiceEvent({
          boatId, receiptPhotoPath: state.path, documentId: state.documentId,
          values: { event_date: v.event_date, vendor: v.vendor, description: v.description,
            cost_dollars: v.cost_dollars, engine_hours: v.engine_hours, system_id: v.system_id },
        });
        router.push(`/boats/${boatId}`);
      }}
    />
  );
}
