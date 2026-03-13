import { test, expect } from "@playwright/test";
import { API_URL, getAuthHeaders } from "./helpers";

test.describe("Reports Page UI", () => {
  test.beforeEach(async ({ page }) => {
    // Uses global auth state from storageState — no manual login needed
    await page.goto("/reports", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  });

  test("should display reports page", async ({ page }) => {
    // Check page title — new catalog-based reports page
    await expect(page.locator("h1")).toContainText("Report");

    // Check catalog or report list is visible
    await expect(page.locator("body")).toContainText(/catalog|report|fleet|security|inventory/i);
  });

  test("should have report catalog tabs or sections", async ({ page }) => {
    // New reports page has Catalog/History/Schedules tabs
    const body = page.locator("body");
    await expect(body).toContainText(/catalog|history|schedule|fleet|security/i);
  });

  test("should have action buttons for reports", async ({ page }) => {
    // Report cards should have run/generate/view buttons
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("should have export section or links", async ({ page }) => {
    // Check for data export section or export buttons
    const hasExports = await page.getByText(/export|excel|csv/i).first().isVisible().catch(() => false);
    const hasDownloads = await page.getByText(/download/i).first().isVisible().catch(() => false);
    expect(hasExports || hasDownloads).toBeTruthy();
  });
});

test.describe("Reports API", () => {
  test("should generate fleet PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/reports/fleet/pdf`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");

    const body = await response.body();
    expect(body.length).toBeGreaterThan(100);
  });

  test("should generate security PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/reports/security/pdf`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");

    const body = await response.body();
    expect(body.length).toBeGreaterThan(100);
  });

  test("should generate inventory PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/reports/inventory/pdf`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");

    const body = await response.body();
    expect(body.length).toBeGreaterThan(100);
  });

  test("should export nodes as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/export/nodes/excel`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheet");
  });

  test("should export vulnerabilities as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/export/vulnerabilities/excel`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheet");
  });

  test("should export software as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();

    const response = await request.get(`${API_URL}/api/v1/export/software/excel`, {
      headers,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheet");
  });
});
