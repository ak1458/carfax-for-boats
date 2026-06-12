"use client";
import { useFormStatus } from "react-dom";

export default function MarkDoneButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Saving…" : "Mark done"}</button>;
}
