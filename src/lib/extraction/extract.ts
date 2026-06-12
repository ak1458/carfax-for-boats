import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { schemaForDocType, overallConfidence } from "./schemas";

export class ExtractionError extends Error {
  constructor(public code: "UNREADABLE" | "INVALID_OUTPUT" | "NO_TOOL_USE" | "API_ERROR", message: string) {
    super(message);
  }
}

export interface ImageInput { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; }
export interface ExtractionResult { extraction: unknown; confidence: number; model: string; }

const PROMPTS: Record<string, string> = {
  receipt: "Extract structured data from this marine service receipt. Amounts in integer cents. Dates as YYYY-MM-DD. If a field is absent, omit it. Set per-field confidence 0-1 honestly — use low values when unsure.",
  engine_plate: "Extract make, model, and serial number from this engine identification plate photo. Set per-field confidence 0-1 honestly.",
  hour_meter: "Read the hours value from this engine hour meter photo. Set confidence 0-1 honestly.",
};

function toolSchemaFor(docType: string): Record<string, unknown> {
  const cf = (type: string) => ({
    type: "object",
    properties: { value: { type }, confidence: { type: "number", minimum: 0, maximum: 1 } },
    required: ["value", "confidence"],
  });
  const shapes: Record<string, Record<string, unknown>> = {
    receipt: {
      type: "object",
      properties: {
        unreadable: { type: "boolean" }, reason: { type: "string" },
        vendor: cf("string"), date: cf("string"), total_cents: cf("integer"), currency: cf("string"),
        line_items: { type: "array", items: { type: "object", properties: {
          description: cf("string"), part_number: cf("string"), quantity: cf("number"), price_cents: cf("integer") } } },
        engine_hours: cf("number"),
      },
    },
    engine_plate: {
      type: "object",
      properties: { unreadable: { type: "boolean" }, reason: { type: "string" },
        make: cf("string"), model: cf("string"), serial: cf("string"), horsepower: cf("number"), year: cf("integer") },
    },
    hour_meter: {
      type: "object",
      properties: { unreadable: { type: "boolean" }, reason: { type: "string" }, hours: cf("number") },
    },
  };
  return shapes[docType];
}

export async function extractDocument(
  image: ImageInput,
  docType: "receipt" | "engine_plate" | "hour_meter",
  client: Anthropic = new Anthropic()
): Promise<ExtractionResult> {
  const model = process.env.EXTRACTION_MODEL ?? "claude-sonnet-4-6";
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 2048,
      tools: [{ name: "record_extraction", description: "Record the extracted document data", input_schema: toolSchemaFor(docType) as never }],
      tool_choice: { type: "tool", name: "record_extraction" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: PROMPTS[docType] },
        ],
      }],
    });
  } catch (err) {
    throw new ExtractionError("API_ERROR", err instanceof Error ? err.message : "Claude API call failed");
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new ExtractionError("NO_TOOL_USE", "Model returned no tool_use block");

  const input = toolUse.input as Record<string, unknown>;
  if (input.unreadable) throw new ExtractionError("UNREADABLE", String(input.reason ?? "Image unreadable"));

  const parsed = schemaForDocType(docType).safeParse(input);
  if (!parsed.success) throw new ExtractionError("INVALID_OUTPUT", z.prettifyError(parsed.error));

  return { extraction: parsed.data, confidence: overallConfidence(parsed.data), model };
}
