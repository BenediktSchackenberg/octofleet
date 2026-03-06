import { test, expect } from "@playwright/test";
import { API_URL, getAuthHeaders } from "./helpers";

test.describe("Reports Page UI", () => {
  test.beforeEach(async ({ page }) => {
    // Uses global auth state from storageState — no manual login needed
    await page.goto("/reports", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  });

  test("should display reports page", async ({ page }) => {
    // Check page title
    await expect(page.locator("h1")).toContainText("Report Generator");

    // Check report cards are present
    await expect(page.getByText("Fleet Summary")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Security Report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inventory Report" })).toBeVisible();
  });

  test("should have date range picker", async ({ page }) => {
    // Check date inputs exist
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  test("should have download buttons for each report", async ({ page }) => {
    // Each report card should have a generate/download button
    const buttons = page.getByRole("button", { name: /generate|download|pdf/i });
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(3);
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
