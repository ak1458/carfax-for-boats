import { randomBytes } from "node:crypto";

/** 24 random bytes → 32-char base64url token. */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}
