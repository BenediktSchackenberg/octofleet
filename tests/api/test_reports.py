"""Tests for PDF Report endpoints."""
import os
import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")

HEADERS = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def test_fleet_pdf_report():
    """Test Fleet Summary PDF generation."""
    response = requests.get(f"{API_URL}/api/v1/reports/fleet/pdf", headers=HEADERS)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 1000  # Not empty


def test_security_pdf_report():
    """Test Security Report PDF generation."""
    response = requests.get(f"{API_URL}/api/v1/reports/security/pdf", headers=HEADERS)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 1000


def test_inventory_pdf_report():
    """Test Inventory Report PDF generation."""
    response = requests.get(f"{API_URL}/api/v1/reports/inventory/pdf", headers=HEADERS)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 1000


def test_nodes_excel_export():
    """Test Nodes Excel export."""
    response = requests.get(f"{API_URL}/api/v1/export/nodes/excel", headers=HEADERS)
    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]


def test_software_excel_export():
    """Test Software Excel export."""
    response = requests.get(f"{API_URL}/api/v1/export/software/excel", headers=HEADERS)
    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]


def test_vulnerabilities_excel_export():
    """Test Vulnerabilities Excel export."""
    response = requests.get(f"{API_URL}/api/v1/export/vulnerabilities/excel", headers=HEADERS)
    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]


def test_jobs_excel_export():
    """Test Jobs Excel export."""
    response = requests.get(f"{API_URL}/api/v1/export/jobs/excel", headers=HEADERS)
    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]
