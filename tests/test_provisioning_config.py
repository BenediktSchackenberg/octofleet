"""Offline regression tests: settings -> boot scripts and ISO operations."""

import asyncio
import ast
import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import Body, FastAPI, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("JWT_SECRET", "offline-provisioning-tests-only-not-a-deployment-secret")

from auth import CurrentUser, get_current_user
from provisioning_config import ENV_NAMES, ProvisioningConfig, export_environment, export_winpe, load_config
from routers import provisioning, provisioning_iso, provisioning_settings
from routers.provisioning_linux_boot import generate_grub_entry, generate_linux_boot_script
from routers import provisioning_vm


class Database:
    def __init__(self):
        self.value = None
        self.author = None
        self.statements = []
        self.task = {"id": "test-task", "os_type": "linux", "os_version": "24.04",
                     "hostname": "test-client", "wim_path": "/images/windows/install.wim",
                     "wim_index": 1, "ipxe_template": "#!ipxe\nset pxe ${PXE_SERVER}\nset api ${API_SERVER}\n${IMAGE_PATH}"}

    async def fetchrow(self, query, *args):
        if "system_settings" in query:
            return {"value": self.value} if self.value is not None else None
        if "FROM provisioning_tasks" in query:
            return self.task
        raise AssertionError(query)

    async def execute(self, query, *args):
        self.statements.append((query, args))
        if "INSERT INTO system_settings" in query:
            self.value, self.author = args[1:3]
        return "UPDATE 1"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for names in ENV_NAMES.values():
        for name in names:
            monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("PXE_SERVER_IP", raising=False)


@pytest.fixture
def config():
    return ProvisioningConfig(pxe_server_url="https://pxe.branch.test:9443/boot",
                              api_server_url="https://api.branch.test",
                              api_upstream_url="http://backend:8080",
                              nfs_server="nfs.branch.test", nfs_export_path="/exports/linux-{version}",
                              dns_servers=["10.42.0.10", "10.42.0.11"],
                              iso_path="/data/isos", images_path="/data/images", mount_base="/data/mounts",
                              iso_manager_script="/opt/site/bin/iso-manager.sh")


@pytest.fixture
def application():
    db = Database()
    app = FastAPI()
    app.include_router(provisioning_settings.router)
    app.dependency_overrides[provisioning.get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser("admin-id", "test-admin", ["*"])
    return app, db


def test_save_reload_and_boot_use_same_configuration(application, config):
    app, db = application
    with TestClient(app) as client:
        assert client.put("/api/v1/provisioning/config", json=config.model_dump()).status_code == 200
        assert db.author == "test-admin"
        assert client.get("/api/v1/provisioning/config").json() == config.model_dump()
        response = asyncio.run(provisioning.get_pxe_script("00:11:22:33:44:55", db))
        script = response.body.decode()
        assert "https://pxe.branch.test:9443/boot/" not in script  # iPXE uses the base variable
        assert "set pxe-server https://pxe.branch.test:9443/boot" in script
        assert "set nfs-server nfs.branch.test" in script
        assert "/exports/linux-24.04" in script
        assert "192.168.0." not in script
        # Simulate a fresh process/connection reading persisted DB state.
        fresh_db = Database()
        fresh_db.value = db.value
        assert asyncio.run(load_config(fresh_db)) == config


def test_saved_values_override_environment_including_empty_values(monkeypatch, config):
    monkeypatch.setenv("PXE_SERVER", "http://old.example.test:9080")
    monkeypatch.setenv("NFS_SERVER", "old.example.test")
    db = Database()
    assert asyncio.run(load_config(db)).pxe_server_url == "http://old.example.test:9080"
    db.value = config.model_copy(update={"nfs_server": ""}).model_dump_json()
    result = asyncio.run(load_config(db))
    assert result.pxe_server_url == config.pxe_server_url
    assert result.nfs_server == ""


def test_no_implicit_private_network_defaults():
    config = asyncio.run(load_config(Database()))
    assert config.pxe_server_url == config.api_server_url == config.nfs_server == ""
    assert config.dns_servers == []


@pytest.mark.parametrize("field,value", [
    ("pxe_server_url", "file:///etc/passwd"),
    ("api_server_url", "http://name:secret@host.test"),
    ("api_server_url", "https://host.test/?secret=1"),
    ("api_server_url", "https://host.test/#fragment"),
    ("api_server_url", "https://host.test:99999"),
    ("pxe_server_url", "https://host.test/%0aecho"),
    ("pxe_server_url", "https://host.test/../private"),
    ("nfs_server", "host.test; reboot"),
    ("nfs_export_path", "/exports/{unknown}"),
    ("images_path", "relative/path"),
    ("images_path", "/data/../etc"),
    ("images_path", "/data/$(command)"),
    ("iso_manager_script", "/bin/tool\nother-command"),
    ("dns_servers", ["not-an-ip"]),
    ("http_port", 0),
    ("http_port", 65536),
    ("pxe_interface", "eth0\nport=53"),
    ("proxy_dhcp_subnet", "not-a-network"),
    ("hyperv_storage_path", "C:\\VMs\\$(whoami)"),
    ("hyperv_storage_path", "relative\\path"),
    ("kvm_storage_path", "/images/../private"),
    ("smb_images_share", "not-a-share"),
    ("smb_install_share", "\\\\host\\share&command"),
])
def test_invalid_settings_are_rejected_without_writing(application, field, value):
    app, db = application
    with TestClient(app) as client:
        response = client.put("/api/v1/provisioning/config", json={field: value})
    assert response.status_code == 422
    assert db.statements == []


def test_unrecognized_fields_are_rejected(application):
    app, db = application
    assert TestClient(app).put("/api/v1/provisioning/config", json={"pxe_url": "http://host.test"}).status_code == 422
    assert db.value is None


def test_readonly_and_anonymous_users_cannot_save_or_export(application, config):
    app, db = application
    app.dependency_overrides[get_current_user] = lambda: CurrentUser("reader", "reader", ["settings:read"])
    client = TestClient(app)
    assert client.get("/api/v1/provisioning/config").status_code == 200
    assert client.put("/api/v1/provisioning/config", json=config.model_dump()).status_code == 403
    assert client.get("/api/v1/provisioning/config/export").status_code == 403
    assert client.get("/api/v1/provisioning/config/export/winpe").status_code == 403
    app.dependency_overrides[get_current_user] = lambda: None
    assert client.get("/api/v1/provisioning/config").status_code == 401
    assert client.put("/api/v1/provisioning/config", json=config.model_dump()).status_code == 401
    assert db.statements == []


def test_generic_settings_cannot_bypass_validation():
    # Load the real legacy handlers without starting main.py and its schedulers.
    source = ast.parse((ROOT / "backend/main.py").read_text(encoding="utf-8"))
    namespace = {"HTTPException": HTTPException, "Body": Body, "SETTINGS_KEY": "provisioning"}
    for name in ("get_setting", "update_setting", "delete_setting"):
        func = next(node for node in source.body if isinstance(node, ast.AsyncFunctionDef) and node.name == name)
        func.decorator_list = []
        exec(compile(ast.Module(body=[func], type_ignores=[]), "main.py", "exec"), namespace)
        with pytest.raises(HTTPException) as error:
            asyncio.run(namespace[name]("provisioning"))
        assert error.value.status_code == 400


def test_missing_boot_configuration_does_not_advance_task_state():
    db = Database()
    with pytest.raises(HTTPException) as error:
        asyncio.run(provisioning.get_pxe_script("00:11:22:33:44:55", db))
    assert error.value.status_code == 503
    assert db.statements == []


def test_windows_template_uses_saved_urls(config):
    db = Database()
    db.value = config.model_dump_json()
    db.task["os_type"] = "windows"
    script = asyncio.run(provisioning.get_pxe_script("00:11:22:33:44:55", db)).body.decode()
    assert "set pxe https://pxe.branch.test:9443/boot" in script
    assert "set api https://api.branch.test" in script


def test_invalid_image_version_does_not_advance_task(config):
    db = Database()
    db.value = config.model_dump_json()
    db.task["os_version"] = "../../etc"
    with pytest.raises(HTTPException):
        asyncio.run(provisioning.get_pxe_script("00:11:22:33:44:55", db))
    assert db.statements == []


def test_winpe_export_uses_configured_shares_and_escapes_batch_percent(application, config):
    app, db = application
    config = config.model_copy(update={"pxe_server_url": "https://pxe.test/branch%20one", "smb_install_share": r"\\files.test\install"})
    db.value = config.model_dump_json()
    # The export itself quotes safely; stored model validation rejects encoded spaces in URLs.
    text = export_winpe(config)
    assert 'set "PXE_SERVER_URL=https://pxe.test/branch%%20one"' in text
    assert r'set "SMB_INSTALL_SHARE=\\files.test\install"' in text
    db.value = config.model_copy(update={"pxe_server_url": "https://pxe.test"}).model_dump_json()
    response = TestClient(app).get("/api/v1/provisioning/config/export/winpe")
    assert response.status_code == 200
    assert response.json()["filename"] == "octofleet-config.cmd"


@pytest.mark.parametrize("windows", [True, False])
@pytest.mark.parametrize("explicit", [True, False])
def test_generated_vm_job_uses_configured_or_task_storage(config, windows, explicit):
    class VMDatabase(Database):
        async def fetchrow(self, query, *args):
            if "FROM nodes" in query:
                return {"os_name": "Windows Server" if windows else "Ubuntu"}
            return await super().fetchrow(query, *args)
    db = VMDatabase()
    config = config.model_copy(update={"hyperv_storage_path": r"E:\Fleet VMs", "kvm_storage_path": "/data/vms"})
    db.value = config.model_dump_json()
    override = (r"F:\Task VMs" if windows else "/task/vms") if explicit else None
    request = provisioning_vm.VMCreateRequest(hostname="test-vm", hypervisor_node_id="host", image_name="test",
        network=provisioning_vm.NetworkConfig(vswitch="test"), storage_path=override)
    script = asyncio.run(provisioning_vm.create_vm_on_hypervisor(request, db, None))["script"]
    expected = override or (config.hyperv_storage_path if windows else config.kvm_storage_path)
    assert expected in script
    assert ("D:\\Hyper-V" if windows else "/var/lib/libvirt/images") not in script


@pytest.mark.parametrize("variant", ["v2", "v3", "v4"])
def test_linux_template_variants(config, variant):
    script = generate_linux_boot_script("24.04", "test-client", "00:11:22:33:44:55", variant=variant, config=config)
    assert "set nfs-path /exports/linux-24.04" in script
    assert "set nfs-server nfs.branch.test" in script
    assert "set pxe-server https://pxe.branch.test:9443/boot" in script
    assert "${pxe-server}" in script  # retain runtime iPXE variables


def test_grub_uses_configured_scheme_port_and_base_path(config):
    script = generate_grub_entry("24.04", "test-client", "00:11:22:33:44:55", config=config)
    assert "(https,pxe.branch.test:9443)/boot/ubuntu-live/24.04" in script
    assert "nfsroot=nfs.branch.test:/exports/linux-24.04" in script
    assert "https://pxe.branch.test:9443/boot/autoinstall/" in script


def test_version_cannot_escape_the_nfs_root(config):
    with pytest.raises(HTTPException):
        config.nfs_path("../../etc")


def test_environment_export_uses_saved_values(application, config):
    app, db = application
    db.value = config.model_dump_json()
    response = TestClient(app).get("/api/v1/provisioning/config/export")
    assert response.status_code == 200
    text = response.json()["content"]
    assert "PXE_SERVER_URL='https://pxe.branch.test:9443/boot'" in text
    assert "OCTOFLEET_API='http://backend:8080'" in text
    assert "PROVISIONING_IMAGES_PATH='/data/images'" in text
    assert "NFS_EXPORT_PATH='/exports/linux-{version}'" in text


def test_unconfigured_export_fails():
    with pytest.raises(HTTPException):
        export_environment(ProvisioningConfig())


def test_iso_scan_uses_saved_directory(monkeypatch, config):
    # Mock the filesystem boundary to keep Linux configuration valid on Windows.
    monkeypatch.setattr(provisioning_iso, "current_config", AsyncMock(return_value=config))
    monkeypatch.setattr(provisioning_iso.os.path, "isdir", lambda path: path == "/data/isos")
    monkeypatch.setattr(provisioning_iso.os, "listdir", lambda path: ["ubuntu-24.04.iso"] if path == "/data/isos" else [])
    monkeypatch.setattr(provisioning_iso.os.path, "getsize", lambda path: 1024)
    monkeypatch.setattr(provisioning_iso, "get_current_mounts", lambda: {})
    result = asyncio.run(provisioning_iso.scan_isos())
    assert result.iso_path == "/data/isos"
    assert result.isos[0].name == "ubuntu-24.04.iso"


def test_iso_mount_and_script_use_saved_paths(monkeypatch, config):
    monkeypatch.setattr(provisioning_iso, "current_config", AsyncMock(return_value=config))
    monkeypatch.setattr(provisioning_iso.os.path, "isfile", lambda path: True)
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return type("Result", (), {"returncode": 0, "stderr": "", "stdout": '{"status":"mounted"}'})()

    monkeypatch.setattr(provisioning_iso.subprocess, "run", run)
    result = asyncio.run(provisioning_iso.mount_iso(provisioning_iso.ISOMountRequest(iso_path="/data/isos/ubuntu-24.04.iso")))
    assert result.mount_target == "/data/mounts/ubuntu-24.04"
    assert calls == [["sudo", "/opt/site/bin/iso-manager.sh", "mount", "/data/isos/ubuntu-24.04.iso", "/data/mounts/ubuntu-24.04"]]
