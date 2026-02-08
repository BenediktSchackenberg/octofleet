# Frontend Testing

Automated E2E tests using Playwright.

## Quick Start

```bash
cd frontend

# Install dependencies
npm install

# Run all tests
npm test

# Run tests with UI
npm run test:ui

# View test report
npm run test:report
```

## Test Structure

```
tests/
├── navigation.spec.ts     # Basic navigation between pages
├── dashboard.spec.ts      # Dashboard display + API integration
├── nodes.spec.ts          # Node list + detail views
├── jobs.spec.ts           # Job creation + listing
└── groups-packages.spec.ts # Groups and Packages CRUD
```

## Test Categories

### UI Tests
- Navigation between all pages
- Page loading and content display
- Dialog/modal interactions
- Form submissions

### API Integration Tests
- Backend reachability
- CRUD operations (Create, Read, Update, Delete)
- Data validation

## Requirements

- Backend running at `http://192.168.0.5:8080`
- Frontend running at `http://localhost:3000` (auto-started by Playwright)
- At least one connected node for full test coverage

## Running Specific Tests

```bash
# Run only navigation tests
npx playwright test navigation

# Run only API tests
npx playwright test --grep "API"

# Run in headed mode (see browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

## Test Results

Results are saved to:
- `test-results/html-report/` - HTML report
- `test-results/results.json` - JSON results
- Screenshots on failure in `test-results/`

## CI Integration

Tests can run in CI with:

```yaml
- name: Run Playwright Tests
  run: |
    cd frontend
    npm ci
    npx playwright install chromium
    npm test
```

## Coverage Summary

| Area | Tests | Coverage |
|------|-------|----------|
| Navigation | 5 | All main routes |
| Dashboard | 6 | Stats, API health |
| Nodes | 8 | List, detail, tabs |
| Jobs | 7 | CRUD, creation flow |
| Groups/Packages | 6 | CRUD operations |
| **Total** | **32** | Core functionality |

## Extending Tests

Add new test files in `tests/` with the `.spec.ts` extension.

Example:

```typescript
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/my-page');
    await expect(page.locator('text=Expected')).toBeVisible();
  });
});
```
