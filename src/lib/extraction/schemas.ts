import { z } from "zod";

const conf = z.number().min(0).max(1);
// zod v4 uses ZodType (not ZodTypeAny); using z.ZodType as the generic bound
const cf = <T extends z.ZodType>(inner: T) => z.object({ value: inner, confidence: conf });
// cfOpt handles Claude tool-use output where absent optionals arrive as null rather than undefined
const cfOpt = <T extends z.ZodType>(inner: T) => cf(inner).nullish().transform(v => v ?? undefined);

export const receiptSchema = z.object({
  vendor: cf(z.string()),
  date: cf(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")),
  total_cents: cf(z.number().int()),
  currency: cf(z.string().length(3)),
  line_items: z.array(z.object({
    description: cf(z.string()),
    part_number: cfOpt(z.string()),
    quantity: cfOpt(z.number()),
    price_cents: cfOpt(z.number().int()),
  })),
  engine_hours: cfOpt(z.number()),
});

export const enginePlateSchema = z.object({
  make: cf(z.string()),
  model: cf(z.string()),
  serial: cf(z.string()),
  horsepower: cfOpt(z.number()),
  year: cfOpt(z.number().int()),
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
  // NOTE: walk does not recurse into a cf node's `.value` — if a future schema
  // wraps an object in cf(), inner confidences will not be counted. Also: an
  // extraction with no cf nodes returns 1; callers only invoke this on parsed
  // output whose schemas all have required cf fields, so that case is unreachable today.
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
