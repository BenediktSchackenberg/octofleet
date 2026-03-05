# 📊 Software Metering & License Tracking

> Introduced in **v0.6.0** (Epic E38)

Track software usage, manage licenses, identify reclamation candidates, and generate true-up reports for license compliance.

## Overview

The Software Metering system connects software inventory data with license entitlements to give you a clear picture of compliance across your fleet.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Software    │────►│  License     │────►│  Compliance   │
│  Catalog     │     │  Management  │     │  Reports      │
└──────────────┘     └──────────────┘     └──────────────┘
       ▲                                         │
       │                                         ▼
┌──────────────┐                         ┌──────────────┐
│ Normalization│                         │ Reclamation  │
│ Rules        │                         │ Candidates   │
└──────────────┘                         └──────────────┘
```

---

## Concepts

### Software Catalog

The catalog is your authoritative list of software titles. It can be built manually or via **auto-discovery**, which analyzes your fleet's installed software and creates catalog entries automatically.

Each catalog entry includes:
- Name, publisher, category
- Normalization pattern (regex to match variations)
- Whether it's tracked for licensing

### Normalization Rules

Software names vary wildly across installations — "Google Chrome", "Google Chrome (x64)", "Google LLC - Chrome". Normalization rules use regex patterns to map variations to a single catalog entry.

```json
{
  "pattern": "Google Chrome.*",
  "catalog_id": "...",
  "description": "Normalize all Chrome variants"
}
```

You can test rules before applying them:
```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"pattern": "Google Chrome.*"}' \
  http://localhost:8080/api/v1/metering/rules/test
```

### License Management

Create license records to track your entitlements:

- **License type** — Per-device, per-user, site, enterprise
- **Quantity** — Number of seats/devices purchased
- **Vendor & SKU** — For procurement tracking
- **Expiry date** — License expiration
- **Linked catalog entries** — Which software this license covers

### Compliance

The compliance engine compares license entitlements against actual software installations:

| Status | Meaning |
|--------|---------|
| ✅ **Compliant** | Installations ≤ Licensed quantity |
| ⚠️ **Over-deployed** | Installations > Licensed quantity |
| ❌ **Unlicensed** | No license record exists |

### Usage Tracking

Agents can submit usage data (`POST /api/v1/metering/usage/submit`) to track which software is actively used vs. just installed. This enables:

- **Reclamation candidates** — Software installed but unused for N days
- **True-up reports** — Accurate usage-based compliance data

### Reclamation

Identify software that's installed but not used, saving license costs:

```bash
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/metering/usage/reclaim
```

Returns a list of installations where the software hasn't been launched within a configurable threshold.

---

## API Reference

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/metering/catalog` | List catalog entries (with search, pagination) |
| POST | `/api/v1/metering/catalog` | Create catalog entry |
| PUT | `/api/v1/metering/catalog/{id}` | Update catalog entry |
| DELETE | `/api/v1/metering/catalog/{id}` | Delete catalog entry |
| POST | `/api/v1/metering/catalog/auto-discover` | Auto-discover software from fleet inventory |

### Normalization Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/metering/rules` | List normalization rules |
| POST | `/api/v1/metering/rules` | Create rule |
| DELETE | `/api/v1/metering/rules/{id}` | Delete rule |
| POST | `/api/v1/metering/rules/test` | Test a pattern against fleet data |

### Licenses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/metering/licenses` | List licenses |
| POST | `/api/v1/metering/licenses` | Create license |
| PUT | `/api/v1/metering/licenses/{id}` | Update license |
| DELETE | `/api/v1/metering/licenses/{id}` | Delete license |

### Compliance & Reporting

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/metering/compliance` | Fleet-wide compliance overview |
| GET | `/api/v1/metering/compliance/{catalog_id}` | Compliance for specific software |
| GET | `/api/v1/metering/dashboard` | Metering dashboard with charts |
| GET | `/api/v1/metering/reports/true-up` | True-up report for license reconciliation |

### Usage

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/metering/usage` | Usage data across fleet |
| POST | `/api/v1/metering/usage/submit` | Agent submits usage data |
| GET | `/api/v1/metering/usage/reclaim` | Reclamation candidates |

---

## Workflow Example

```bash
# 1. Auto-discover software from your fleet
curl -X POST -H "X-API-Key: $KEY" \
  http://localhost:8080/api/v1/metering/catalog/auto-discover

# 2. Create normalization rules for messy names
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"pattern": "Microsoft Office.*Professional.*", "catalog_id": "..."}' \
  http://localhost:8080/api/v1/metering/rules

# 3. Add license info
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"catalog_id": "...", "license_type": "per_device", "quantity": 100, "vendor": "Microsoft", "expires_at": "2027-03-01"}' \
  http://localhost:8080/api/v1/metering/licenses

# 4. Check compliance
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/metering/compliance

# 5. Generate true-up report
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/metering/reports/true-up

# 6. Find reclamation candidates
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/metering/usage/reclaim
```
