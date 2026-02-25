import { test, expect } from "@playwright/test";
import { login, API_URL, getAuthHeaders } from "./helpers";

test.describe("Reports Page UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should display reports page", async ({ page }) => {
    await page.goto("/reports");
    
    // Check page title
    await expect(page.locator("h1")).toContainText("Report Generator");
    
    // Check report cards are present
    await expect(page.getByText("Fleet Summary")).toBeVisible();
    await expect(page.getByText("Security Report")).toBeVisible();
    await expect(page.getByText("Inventory Report")).toBeVisible();
  });

  test("should have date range picker", async ({ page }) => {
    await page.goto("/reports");
    
    // Check date inputs exist
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible();
    
    // Check quick date buttons
    await expect(page.getByText("Last 7 days")).toBeVisible();
    await expect(page.getByText("Last 30 days")).toBeVisible();
  });

  test("should have download buttons for each report", async ({ page }) => {
    await page.goto("/reports");
    
    // Each report card should have a download button
    const downloadButtons = page.getByRole("button", { name: /download pdf/i });
    await expect(downloadButtons).toHaveCount(3);
  });

  test("should have data export section", async ({ page }) => {
    await page.goto("/reports");
    
    // Check data exports section
    await expect(page.getByText("Data Exports")).toBeVisible();
  });
});

test.describe("Reports API", () => {
  // These tests don't need login - they use API key auth
  
  test("should generate fleet PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/reports/fleet/pdf`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    
    // Check file is not empty
    const body = await response.body();
    expect(body.length).toBeGreaterThan(1000);
  });

  test("should generate security PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/reports/security/pdf`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    
    const body = await response.body();
    expect(body.length).toBeGreaterThan(1000);
  });

  test("should generate inventory PDF report", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/reports/inventory/pdf`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    
    const body = await response.body();
    expect(body.length).toBeGreaterThan(1000);
  });

  test("should export nodes as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/export/nodes/excel`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
  });

  test("should export vulnerabilities as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/export/vulnerabilities/excel`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
  });

  test("should export software as Excel", async ({ request }) => {
    const headers = await getAuthHeaders();
    
    const response = await request.get(`${API_URL}/api/v1/export/software/excel`, {
      headers,
    });
    
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
  });
});
