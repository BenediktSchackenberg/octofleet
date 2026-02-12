#!/bin/bash
# OpenClaw Inventory - Full Test Suite Runner
# Runs both E2E (Playwright) and API (pytest) tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        OpenClaw Inventory - Full Test Suite                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Create reports directory
mkdir -p reports/playwright reports/api reports/screenshots

# Check if services are running
echo "🔍 Checking services..."
if ! curl -s http://192.168.0.5:8080/health > /dev/null 2>&1; then
    echo "❌ Backend not reachable at http://192.168.0.5:8080"
    exit 1
fi
echo "✅ Backend is healthy"

if ! curl -s http://192.168.0.5:3000 > /dev/null 2>&1; then
    echo "❌ Frontend not reachable at http://192.168.0.5:3000"
    exit 1
fi
echo "✅ Frontend is healthy"

# Run API Tests
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📡 Running API Tests (pytest)"
echo "═══════════════════════════════════════════════════════════════"
cd api
pip install -q -r requirements.txt
pytest -v --html=../reports/api/report.html --self-contained-html || API_FAILED=1
cd ..

# Run E2E Tests
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🎭 Running E2E Tests (Playwright)"
echo "═══════════════════════════════════════════════════════════════"
cd e2e
npm install --silent
npx playwright install chromium --with-deps
npm test || E2E_FAILED=1
cd ..

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📊 Test Results Summary"
echo "═══════════════════════════════════════════════════════════════"

if [ -z "$API_FAILED" ]; then
    echo "✅ API Tests: PASSED"
else
    echo "❌ API Tests: FAILED"
fi

if [ -z "$E2E_FAILED" ]; then
    echo "✅ E2E Tests: PASSED"
else
    echo "❌ E2E Tests: FAILED"
fi

echo ""
echo "📁 Reports saved to:"
echo "   - API:  tests/reports/api/report.html"
echo "   - E2E:  tests/reports/playwright/index.html"
echo ""

# Exit with error if any test failed
if [ -n "$API_FAILED" ] || [ -n "$E2E_FAILED" ]; then
    exit 1
fi

echo "🎉 All tests passed!"
