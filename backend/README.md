# Octofleet Backend

FastAPI server that receives and stores inventory data from Windows Agents.

## Quick Start

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
uvicorn main:app --host 0.0.0.0 --port 8080
```

## Configuration

Environment variables:
- `DATABASE_URL` - PostgreSQL connection string (default: `postgresql://octofleet:octofleet_2026@127.0.0.1:5432/inventory`)
- `INVENTORY_API_KEY` - API key for authentication (default: `octofleet-dev-key`)

## API Endpoints

All POST endpoints require `X-API-Key` header.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/v1/nodes` | List all nodes |
| `POST /api/v1/inventory/hardware` | Submit hardware data |
| `POST /api/v1/inventory/software` | Submit software list |
| `POST /api/v1/inventory/hotfixes` | Submit Windows updates |
| `POST /api/v1/inventory/system` | Submit OS/services/users |
| `POST /api/v1/inventory/security` | Submit security status |
| `POST /api/v1/inventory/network` | Submit network config |
| `POST /api/v1/inventory/browser` | Submit browser profiles |
| `POST /api/v1/inventory/full` | Submit all types at once |

## Example

```bash
curl -X POST http://localhost:8080/api/v1/inventory/hardware \
  -H "Content-Type: application/json" \
  -H "X-API-Key: octofleet-dev-key" \
  -d '{
    "nodeId": "my-pc",
    "hostname": "DESKTOP-ABC",
    "cpu": {"name": "AMD Ryzen 7 9800X3D", "cores": 8, "threads": 16},
    "memory": {"totalGb": 32},
    "disks": [{"model": "Samsung 990 EVO", "sizeGb": 2000}],
    "gpus": [{"name": "RTX 5080"}]
  }'
```

## Database

Requires PostgreSQL with TimescaleDB extension. Schema in `../PLANNING.md`.
