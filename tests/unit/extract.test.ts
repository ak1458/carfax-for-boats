import { describe, it, expect, vi } from "vitest";
import { extractDocument } from "@/lib/extraction/extract";
import receiptClean from "../fixtures/extraction/receipt-clean.json";
import receiptMessy from "../fixtures/extraction/receipt-messy.json";
import plateFix from "../fixtures/extraction/engine-plate.json";
import unreadable from "../fixtures/extraction/unreadable.json";

function mockClient(toolInput: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_extraction", input: toolInput }],
      }),
    },
  } as never;
}

const img = { base64: "aGVsbG8=", mediaType: "image/jpeg" as const };

describe("extractDocument", () => {
  it("returns validated receipt extraction with overall confidence", async () => {
    const result = await extractDocument(img, "receipt", mockClient(receiptClean));
    expect(result.extraction).toMatchObject({ vendor: { value: "West Marine" } });
    expect(result.confidence).toBeCloseTo(0.85);
  });

  it("returns validated plate extraction", async () => {
    const result = await extractDocument(img, "engine_plate", mockClient(plateFix));
    expect((result.extraction as { make: { value: string } }).make.value).toBe("Yanmar");
  });

  it("throws UNREADABLE when model reports unreadable", async () => {
    await expect(extractDocument(img, "receipt", mockClient(unreadable)))
      .rejects.toMatchObject({ code: "UNREADABLE" });
  });

  it("throws INVALID_OUTPUT when tool output fails schema", async () => {
    await expect(extractDocument(img, "receipt", mockClient({ vendor: "no-confidence-wrapper" })))
      .rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("throws NO_TOOL_USE when model returns plain text", async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }) } } as never;
    await expect(extractDocument(img, "receipt", client)).rejects.toMatchObject({ code: "NO_TOOL_USE" });
  });

  it("throws API_ERROR when the SDK call rejects", async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error("rate limited")) } } as never;
    await expect(extractDocument(img, "receipt", client)).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("throws TRUNCATED when output hits max_tokens", async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "record_extraction", input: {} }] }) } } as never;
    await expect(extractDocument(img, "receipt", client)).rejects.toMatchObject({ code: "TRUNCATED" });
  });

  it("flows low-confidence messy receipt below the 0.7 threshold", async () => {
    const result = await extractDocument(img, "receipt", mockClient(receiptMessy));
    expect(result.confidence).toBeCloseTo(0.55);
    expect(result.confidence).toBeLessThan(0.7);
  });
});
