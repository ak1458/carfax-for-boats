import { describe, it, expect } from "vitest";
import { generateShareToken } from "@/lib/share/token";

describe("generateShareToken", () => {
  it("is at least 32 chars and URL-safe", () => {
    const t = generateShareToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique across calls", () => {
    expect(new Set(Array.from({ length: 100 }, generateShareToken)).size).toBe(100);
  });
});
