import { z } from "zod";

const conf = z.number().min(0).max(1);
// zod v4 uses ZodType (not ZodTypeAny); using z.ZodType as the generic bound
const cf = <T extends z.ZodType>(inner: T) => z.object({ value: inner, confidence: conf });

export const receiptSchema = z.object({
  vendor: cf(z.string()),
  date: cf(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  total_cents: cf(z.number().int()),
  currency: cf(z.string().length(3)),
  line_items: z.array(z.object({
    description: cf(z.string()),
    part_number: cf(z.string()).optional(),
    quantity: cf(z.number()).optional(),
    price_cents: cf(z.number().int()).optional(),
  })),
  engine_hours: cf(z.number()).optional(),
});

export const enginePlateSchema = z.object({
  make: cf(z.string()),
  model: cf(z.string()),
  serial: cf(z.string()),
  horsepower: cf(z.number()).optional(),
  year: cf(z.number().int()).optional(),
});

export const hourMeterSchema = z.object({ hours: cf(z.number()) });

export type ReceiptExtraction = z.infer<typeof receiptSchema>;
export type EnginePlateExtraction = z.infer<typeof enginePlateSchema>;
export type HourMeterExtraction = z.infer<typeof hourMeterSchema>;

export function schemaForDocType(docType: string) {
  switch (docType) {
    case "receipt": return receiptSchema;
    case "engine_plate": return enginePlateSchema;
    case "hour_meter": return hourMeterSchema;
    default: throw new Error(`No extraction schema for doc_type "${docType}"`);
  }
}

export const LOW_CONFIDENCE = 0.7;

export function overallConfidence(extraction: unknown): number {
  let min = 1;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.confidence === "number" && "value" in rec) min = Math.min(min, rec.confidence);
      else Object.values(rec).forEach(walk);
    }
  };
  walk(extraction);
  return min;
}
