import { describe, it, expect } from "vitest";
import { receiptSchema, enginePlateSchema, hourMeterSchema, schemaForDocType, overallConfidence } from "@/lib/extraction/schemas";

const cf = (value: unknown, confidence = 0.95) => ({ value, confidence });

describe("receiptSchema", () => {
  it("parses a clean receipt", () => {
    const parsed = receiptSchema.parse({
      vendor: cf("West Marine"), date: cf("2026-05-01"),
      total_cents: cf(12999), currency: cf("USD"),
      line_items: [{ description: cf("Oil filter"), part_number: cf("35-866340Q03"), quantity: cf(2), price_cents: cf(2599) }],
      engine_hours: cf(412),
    });
    expect(parsed.vendor.value).toBe("West Marine");
    expect(parsed.line_items[0].quantity?.value).toBe(2);
  });

  it("rejects out-of-range confidence", () => {
    expect(() => receiptSchema.parse({ vendor: cf("X", 1.5), date: cf("2026-05-01"), total_cents: cf(1), currency: cf("USD"), line_items: [] })).toThrow();
  });

  it("allows missing optional fields", () => {
    const parsed = receiptSchema.parse({ vendor: cf("Y"), date: cf("2026-05-01"), total_cents: cf(500), currency: cf("USD"), line_items: [] });
    expect(parsed.engine_hours).toBeUndefined();
  });
});

describe("enginePlateSchema", () => {
  it("parses plate", () => {
    const parsed = enginePlateSchema.parse({ make: cf("Yanmar"), model: cf("4JH57"), serial: cf("E12345"), horsepower: cf(57), year: cf(2019) });
    expect(parsed.make.value).toBe("Yanmar");
  });
});

describe("hourMeterSchema", () => {
  it("parses hours", () => {
    expect(hourMeterSchema.parse({ hours: cf(412.5) }).hours.value).toBe(412.5);
  });
});

describe("schemaForDocType", () => {
  it("maps doc types", () => {
    expect(schemaForDocType("receipt")).toBe(receiptSchema);
    expect(schemaForDocType("engine_plate")).toBe(enginePlateSchema);
    expect(schemaForDocType("hour_meter")).toBe(hourMeterSchema);
    expect(() => schemaForDocType("other")).toThrow();
  });
});

describe("overallConfidence", () => {
  it("returns min confidence across fields, recursing into arrays", () => {
    const parsed = receiptSchema.parse({
      vendor: cf("X", 0.9), date: cf("2026-05-01", 0.8), total_cents: cf(1, 0.95), currency: cf("USD", 1),
      line_items: [{ description: cf("filter", 0.4) }],
    });
    expect(overallConfidence(parsed)).toBe(0.4);
  });
});
