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

  const { data: doc } = await supabase.from("documents").select("*").eq("id", document_id).single();
  if (!doc || doc.owner_id !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["receipt", "engine_plate", "hour_meter"].includes(doc.doc_type))
    return NextResponse.json({ error: `doc_type ${doc.doc_type} not extractable` }, { status: 400 });

  const { data: blob, error: dlErr } = await supabase.storage.from("photos").download(doc.storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: "photo download failed" }, { status: 500 });

  const image: ImageInput = {
    base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    mediaType: (blob.type || "image/jpeg") as ImageInput["mediaType"],
  };

  try {
    const result = await extractDocument(image, doc.doc_type);
    await supabase.from("documents").update({
      extraction_json: result.extraction,
      extraction_model: result.model,
      extraction_confidence: result.confidence,
    }).eq("id", document_id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExtractionError)
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "API_ERROR" ? 502 : 422 });
    throw err;
  }
}
