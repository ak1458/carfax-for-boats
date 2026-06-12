"use client";
import { createBrowserClient } from "@supabase/ssr";

let _supabase: ReturnType<typeof createBrowserClient> | undefined;
export function supabaseBrowser() {
  return (_supabase ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));
}

const MAX_LONG_EDGE = 1568; // Claude vision sweet spot; bigger wastes tokens
const TARGET_BYTES = 4_000_000;

/** Downscale + re-encode to JPEG so uploads stay within Claude vision limits. */
export async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= TARGET_BYTES && file.type === "image/jpeg") return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not process the photo");
  return blob;
}

/** Upload photo to photos/{userId}/{timestamp}.jpg; returns storage path. */
export async function uploadPhoto(file: File, userId: string): Promise<string> {
  const supabase = supabaseBrowser();
  const jpeg = await downscaleImage(file);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("photos").upload(path, jpeg, { contentType: "image/jpeg" });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}
