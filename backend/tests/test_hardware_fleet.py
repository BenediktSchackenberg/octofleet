"""Hardware fleet overview: disks of virtual machines, bus/interface type, structured issues."""
import json
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

    def _fleet(self, rows, path="/api/v1/hardware/fleet"):
        conn = AsyncMock()
        conn.fetch.return_value = rows
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        app.dependency_overrides[get_db] = lambda: pool
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ["hardware:read", "inventory:read"])
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            response = client.get(path)
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
        # a VM disk without a health status is "virtual" (no SMART), not "unknown"
        self.assertEqual(data["physicalDiskHealth"]["virtual"], 1)
        self.assertEqual(data["physicalDiskHealth"]["unknown"], 0)
        self.assertEqual(disks["vm"]["health"], "virtual")
        self.assertEqual(disks["pc"]["health"], "healthy")

    def test_hyper_v_health_is_kept_and_physical_disk_without_status_is_unknown(self):
        hyperv = {"model": "Microsoft Virtual Disk", "deviceId": "\\\\.\\PHYSICALDRIVE0", "healthStatus": "Healthy"}
        hdd = {"model": "WDC", "deviceId": "/dev/sdb", "isSsd": False}
        data = self._fleet([_row("win", True, {"physical": [hyperv]}), _row("pc", False, {"physical": [hdd]})])
        self.assertEqual(data["physicalDiskHealth"],
                         {"healthy": 1, "warning": 0, "unhealthy": 0, "virtual": 0, "unknown": 1})
        self.assertEqual({d["deviceId"] for d in data["physicalDisks"]}, {"\\\\.\\PHYSICALDRIVE0", "/dev/sdb"})

    def test_zram_loop_and_ram_devices_are_not_disks(self):
        disks = {"physical": [
            {"model": "Virtual Disk", "deviceId": "/dev/sda", "sizeGB": 127},
            {"model": "zram0", "deviceId": "/dev/zram0", "sizeGB": 3.8},
            {"model": "loop3", "deviceId": "/dev/loop3", "sizeGB": 0.1},
            {"model": "zram1", "sizeGB": 1},  # old report without deviceId
        ]}
        data = self._fleet([_row("cachy", True, disks)])
        self.assertEqual([d["deviceId"] for d in data["physicalDisks"]], ["/dev/sda"])
        self.assertEqual(data["diskTypes"]["virtual"], 1)
        self.assertEqual(sum(data["physicalDiskHealth"].values()), 1)

    def test_a_device_mounted_several_times_counts_once(self):
        sub = {"volumeName": "/dev/sda2", "fileSystem": "btrfs", "sizeGB": 1024, "freeGB": 512, "usedPercent": 50}
        volumes = [dict(sub, driveLetter=m) for m in ("/", "/home", "/root", "/srv", "/var/log")]
        volumes.append({"volumeName": "/dev/sda1", "driveLetter": "/boot", "sizeGB": 1024, "freeGB": 1024,
                        "usedPercent": 0})
        windows = [{"volumeName": "data", "driveLetter": "D:", "sizeGB": 1024, "freeGB": 0, "usedPercent": 100},
                   {"volumeName": "data", "driveLetter": "E:", "sizeGB": 1024, "freeGB": 0, "usedPercent": 100}]
        data = self._fleet([_row("cachy", True, {"volumes": volumes}), _row("win", False, {"volumes": windows})])
        self.assertEqual(data["storage"], {"totalTB": 4.0, "usedTB": 2.5, "usedPercent": 62.5})
        self.assertEqual(sorted(i["drive"] for i in data["issues"]), ["D:", "E:"])

    def test_the_inventory_fleet_route_uses_the_same_rules(self):
        disks = {"physical": [{"model": "Virtual Disk", "deviceId": "/dev/sda"}, {"model": "zram0", "deviceId": "/dev/zram0"}],
                 "volumes": [{"volumeName": "/dev/sda2", "driveLetter": m, "sizeGB": 1024, "freeGB": 0, "usedPercent": 0}
                             for m in ("/", "/home")]}
        row = {"node_id": "n1", "hostname": "cachy", "cpu": None, "ram": None, "disks": json.dumps(disks), "updated_at": None}
        data = self._fleet([row], "/api/v1/inventory/hardware/fleet")
        self.assertEqual(len(data["physicalDisks"]), 1)
        self.assertEqual(data["storage"]["totalTB"], 1.0)

    def test_full_volume_is_reported_in_english_with_structured_fields(self):
        volume = {"driveLetter": "C:", "sizeGB": 100, "freeGB": 4, "usedPercent": 96}
        data = self._fleet([_row("pc", False, {"volumes": [volume]})])
        issue = data["issues"][0]
        self.assertEqual(issue["kind"], "volumeUsage")
        self.assertEqual((issue["drive"], issue["usedPercent"], issue["severity"]), ("C:", 96, "critical"))
        self.assertEqual(issue["issue"], "Drive C: is 96% full")


if __name__ == "__main__":
    unittest.main()
