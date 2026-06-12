import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { extractDocument, ExtractionError, type ImageInput } from "@/lib/extraction/extract";

export const maxDuration = 60;

export async function POST(request: Request) {
  let user, supabase;
  try { ({ user, supabase } = await requireUser()); }
  catch { return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); }

  const { document_id } = await request.json().catch(() => ({}));
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("doc_type, storage_path, owner_id").eq("id", document_id).single();
  if (!doc || doc.owner_id !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["receipt", "engine_plate", "hour_meter"].includes(doc.doc_type))
    return NextResponse.json({ error: `doc_type ${doc.doc_type} not extractable` }, { status: 400 });

  const { data: blob, error: dlErr } = await supabase.storage.from("photos").download(doc.storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: "photo download failed" }, { status: 500 });

  const MAX_IMAGE_BYTES = 4_500_000; // Claude vision caps ~5MB; leave base64 headroom
  if (blob.size > MAX_IMAGE_BYTES)
    return NextResponse.json(
      { error: "IMAGE_TOO_LARGE", message: "Photo is too large — retake at lower resolution" },
      { status: 422 }
    );

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
  const extType: Record<string, ImageInput["mediaType"]> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  };
  const sniffed = extType[(doc.storage_path.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase()];
  const mediaType = (ALLOWED_TYPES as readonly string[]).includes(blob.type)
    ? (blob.type as ImageInput["mediaType"])
    : sniffed;
  if (!mediaType)
    return NextResponse.json(
      { error: "UNSUPPORTED_MEDIA_TYPE", message: "Only JPEG, PNG, or WebP photos are supported" },
      { status: 422 }
    );

  const image: ImageInput = {
    base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    mediaType,
  };

  try {
    const result = await extractDocument(image, doc.doc_type);
    const { error: updErr } = await supabase.from("documents").update({
      extraction_json: result.extraction,
      extraction_model: result.model,
      extraction_confidence: result.confidence,
    }).eq("id", document_id);
    if (updErr) {
      console.error("extraction persist failed:", updErr.message);
      return NextResponse.json({ error: "PERSIST_FAILED", message: "Extraction could not be saved — try again" }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExtractionError) {
      console.error(`extraction ${err.code}:`, err.message);
      const clientMessage = err.code === "INVALID_OUTPUT"
        ? "Could not read the document reliably — retake the photo or enter details manually"
        : err.message;
      return NextResponse.json({ error: err.code, message: clientMessage }, { status: err.code === "API_ERROR" ? 502 : 422 });
    }
    throw err;
  }
}
