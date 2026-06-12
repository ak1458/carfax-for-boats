import { test, expect } from "@playwright/test";

// These tests need a running Supabase-configured dev server (or E2E_BASE_URL
// pointing at a deployment). Without env they fail at server boot — see README.

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("unknown share token 404s", async ({ page }) => {
  const response = await page.goto("/r/" + "x".repeat(40));
  expect(response?.status()).toBe(404);
});

test("manifest is served", async ({ request }) => {
  const res = await request.get("/manifest.json");
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).name).toBe("Boat Record");
});
