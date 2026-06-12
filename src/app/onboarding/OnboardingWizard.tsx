"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction, { type FieldDef } from "@/components/ConfirmExtraction";
import { createBoatWithEngine, createFirstService } from "./actions";

type CfField = { value: string | number; confidence: number } | undefined;
const fd = (name: string, label: string, type: FieldDef["type"], f: CfField): FieldDef =>
  ({ name, label, type, value: f?.value ?? "", confidence: f?.confidence ?? 1 });

type Stage =
  | { step: "plate" }
  | { step: "confirm-plate"; path: string; extraction: Record<string, CfField> }
  | { step: "receipt"; boatId: string; systemId: string }
  | { step: "confirm-receipt"; boatId: string; systemId: string; path: string; documentId: string | null; extraction: Record<string, CfField> };

export default function OnboardingWizard() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "plate" });

  if (stage.step === "plate") return (
    <section>
      <h1>Step 1 of 2 — Your engine</h1>
      <PhotoCapture boatId={null} docType="engine_plate" label="📷 Snap your engine plate"
        onExtracted={({ storagePath, extraction }) =>
          setStage({ step: "confirm-plate", path: storagePath, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setStage({ step: "confirm-plate", path: "", extraction: {} })}
      />
    </section>
  );

  if (stage.step === "confirm-plate") return (
    <ConfirmExtraction key="confirm-plate" title="Your engine" submitLabel="Looks right — create my boat"
      fields={[
        { name: "boatName", label: "Boat name", type: "text", value: "", confidence: 1 },
        fd("make", "Engine make", "text", stage.extraction.make),
        fd("model", "Engine model", "text", stage.extraction.model),
        fd("serial", "Serial number", "text", stage.extraction.serial),
      ]}
      onSubmit={async (v) => {
        const { boatId, systemId } = await createBoatWithEngine({
          boatName: v.boatName || "My boat", make: v.make, model: v.model, serial: v.serial, platePhotoPath: stage.path,
        });
        setStage({ step: "receipt", boatId, systemId });
      }}
    />
  );

  if (stage.step === "receipt") return (
    <section>
      <h1>Step 2 of 2 — Your last service</h1>
      <PhotoCapture boatId={stage.boatId} docType="receipt" label="📷 Snap one service receipt"
        onExtracted={({ documentId, storagePath, extraction }) =>
          setStage({ step: "confirm-receipt", boatId: stage.boatId, systemId: stage.systemId, path: storagePath, documentId, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setStage({ step: "confirm-receipt", boatId: stage.boatId, systemId: stage.systemId, path: "", documentId: null, extraction: {} })}
      />
      <button onClick={() => router.push(`/boats/${stage.boatId}`)}>Skip for now</button>
    </section>
  );

  return (
    <ConfirmExtraction key="confirm-receipt" title="Your last service" submitLabel="Save & finish"
      fields={[
        fd("event_date", "Date", "date", stage.extraction.date),
        fd("vendor", "Vendor", "text", stage.extraction.vendor),
        { name: "description", label: "What was done", type: "text", value: "", confidence: 1 },
        fd("cost_cents", "Total (cents)", "number", stage.extraction.total_cents),
        fd("engine_hours", "Engine hours at service", "number", stage.extraction.engine_hours),
      ]}
      onSubmit={async (v) => {
        await createFirstService({
          boatId: stage.boatId, systemId: stage.systemId,
          receiptPhotoPath: stage.path, documentId: stage.documentId,
          values: { event_date: v.event_date, vendor: v.vendor, description: v.description,
            cost_cents: v.cost_cents, engine_hours: v.engine_hours },
        });
        router.push(`/boats/${stage.boatId}`);
      }}
    />
  );
}
