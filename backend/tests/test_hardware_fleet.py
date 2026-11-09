"""Hardware fleet overview: disks of virtual machines, bus/interface type, structured issues."""
import unittest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user
from dependencies import get_db
from main import app


def _row(hostname, virtual, disks):
    return {"node_id": uuid4(), "hostname": hostname, "cpu": {"name": "CPU"}, "ram": {}, "disks": disks,
            "gpu": [], "mainboard": {}, "bios": {}, "virtualization": {"isVirtual": virtual}, "updated_at": None}


class HardwareFleetTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _fleet(self, rows):
        conn = AsyncMock()
        conn.fetch.return_value = rows
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        app.dependency_overrides[get_db] = lambda: pool
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ["hardware:read"])
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            response = client.get("/api/v1/hardware/fleet")
        finally:
            client.close()
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_disks_of_virtual_machines_count_as_virtual(self):
        vm_disk = {"model": "Virtual Disk", "sizeGB": 127, "isSsd": False, "busType": None, "interfaceType": "SCSI"}
        ssd = {"model": "Samsung SSD", "sizeGB": 512, "isSsd": True, "busType": "NVMe", "healthStatus": "Healthy"}
        data = self._fleet([_row("vm", True, {"physical": [vm_disk]}), _row("pc", False, {"physical": [ssd]})])
        self.assertEqual(data["diskTypes"], {"ssd": 1, "hdd": 0, "virtual": 1, "unknown": 0})
        disks = {d["hostname"]: d for d in data["physicalDisks"]}
        self.assertTrue(disks["vm"]["isVirtual"])
        self.assertEqual(disks["vm"]["interfaceType"], "SCSI")
        self.assertFalse(disks["pc"]["isVirtual"])
        self.assertEqual(data["physicalDiskHealth"]["unknown"], 1)

    def test_full_volume_is_reported_in_english_with_structured_fields(self):
        volume = {"driveLetter": "C:", "sizeGB": 100, "freeGB": 4, "usedPercent": 96}
        data = self._fleet([_row("pc", False, {"volumes": [volume]})])
        issue = data["issues"][0]
        self.assertEqual(issue["kind"], "volumeUsage")
        self.assertEqual((issue["drive"], issue["usedPercent"], issue["severity"]), ("C:", 96, "critical"))
        self.assertEqual(issue["issue"], "Drive C: is 96% full")


if __name__ == "__main__":
    unittest.main()
