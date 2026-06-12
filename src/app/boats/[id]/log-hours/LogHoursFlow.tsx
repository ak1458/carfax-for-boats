"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import ConfirmExtraction from "@/components/ConfirmExtraction";
import { createHourReading } from "../actions";

type CfField = { value: string | number; confidence: number } | undefined;

export default function LogHoursFlow({ boatId, systemId }: { boatId: string; systemId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { step: "capture" }
    | { step: "confirm"; documentId: string | null; extraction: Record<string, CfField> }
  >({ step: "capture" });

  if (state.step === "capture") return (
    <section>
      <h1>Log engine hours</h1>
      <PhotoCapture boatId={boatId} docType="hour_meter" label="📷 Snap the hour meter"
        onExtracted={({ documentId, extraction }) =>
          setState({ step: "confirm", documentId, extraction: extraction as Record<string, CfField> })}
        onManualEntry={() => setState({ step: "confirm", documentId: null, extraction: {} })}
      />
    </section>
  );

  return (
    <ConfirmExtraction key="confirm-hours" title="Hour reading" submitLabel="Save reading"
      fields={[
        { name: "hours", label: "Hours", type: "number", value: state.extraction.hours?.value ?? "", confidence: state.extraction.hours?.confidence ?? 1 },
        { name: "reading_date", label: "Date", type: "date", value: new Date().toISOString().slice(0, 10), confidence: 1 },
      ]}
      onSubmit={async (v) => {
        await createHourReading({ systemId, documentId: state.documentId, values: { hours: v.hours, reading_date: v.reading_date } });
        router.push(`/boats/${boatId}`);
      }}
    />
  );
}
