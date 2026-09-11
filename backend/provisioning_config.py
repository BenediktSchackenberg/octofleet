"""Validated provisioning settings shared by API handlers and config exports."""

import ipaddress
import json
import os
import re
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

SETTINGS_KEY = "provisioning"


def safe_url(value: str) -> str:
    if not value:
        return ""
    url = urlsplit(value)
    try:
        port = url.port
    except ValueError as exc:
        raise ValueError("Invalid URL port") from exc
    if (url.scheme not in {"http", "https"} or not url.hostname or
            url.username or url.password or url.query or url.fragment or
            (port is not None and not 1 <= port <= 65535) or
            not re.fullmatch(r"[A-Za-z0-9:/._~%\[\]-]+", value) or
            not re.fullmatch(r"[A-Za-z0-9/._~-]*", unquote(url.path)) or
            ".." in unquote(url.path).split("/")):
        raise ValueError("Use an HTTP(S) base URL without credentials, query or fragment")
    return value.rstrip("/")


class ProvisioningConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True)

    pxe_server_url: str = ""
    api_server_url: str = ""
    api_upstream_url: str = ""
    nfs_server: str = ""
    nfs_export_path: str = "/mnt/ubuntu-{version}"
    dns_servers: list[str] = Field(default_factory=list)
    iso_path: str = "/mnt/isos"
    images_path: str = "/srv/images"
    answers_path: str = "/srv/answers"
    boot_path: str = "/srv/boot"
    drivers_path: str = "/srv/drivers"
    scripts_path: str = "/srv/scripts"
    tftp_root: str = "/tftpboot"
    windows_install_path: str = "/srv/wininstall"
    mount_base: str = "/mnt"
    iso_manager_script: str = "/opt/octofleet/scripts/iso-manager.sh"
    hyperv_storage_path: str = r"D:\Hyper-V\Virtual Hard Disks"
    kvm_storage_path: str = "/var/lib/libvirt/images"
    smb_images_share: str = ""
    smb_install_share: str = ""
    http_port: int = Field(default=9080, ge=1, le=65535)
    pxe_interface: str = ""
    proxy_dhcp_subnet: str = ""

    @field_validator("pxe_server_url", "api_server_url", "api_upstream_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return safe_url(value)

    @field_validator("iso_path", "images_path", "answers_path", "boot_path",
                     "drivers_path", "scripts_path", "tftp_root", "windows_install_path",
                     "mount_base", "iso_manager_script", "nfs_export_path", "kvm_storage_path")
    @classmethod
    def validate_path(cls, value: str, info) -> str:
        sample = value.replace("{version}", "24.04") if info.field_name == "nfs_export_path" else value
        if (not re.fullmatch(r"/[A-Za-z0-9_./-]+", sample) or
                ".." in sample.split("/") or "//" in sample or sample == "/"):
            raise ValueError("Use an absolute Linux path without spaces or '..'; NFS allows {version}")
        return value.rstrip("/")

    @field_validator("hyperv_storage_path")
    @classmethod
    def validate_windows_path(cls, value: str) -> str:
        if (not re.fullmatch(r"(?:[A-Za-z]:\\|\\\\[A-Za-z0-9_.-]+\\)[A-Za-z0-9_ .\\-]+", value)
                or ".." in value.split("\\")):
            raise ValueError("Use an absolute Windows drive or UNC path without shell characters or '..'")
        return value.rstrip("\\")

    @field_validator("smb_images_share", "smb_install_share")
    @classmethod
    def validate_share(cls, value: str) -> str:
        if value and (not re.fullmatch(r"\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9_ .\\-]+", value)
                      or ".." in value.split("\\")):
            raise ValueError("Use a UNC share path such as \\\\server\\images")
        return value.rstrip("\\")

    @field_validator("nfs_server")
    @classmethod
    def validate_host(cls, value: str) -> str:
        if not value:
            return ""
        try:
            ipaddress.ip_address(value)
        except ValueError:
            if len(value) > 253 or not all(
                re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", part)
                for part in value.split(".")
            ):
                raise ValueError("Use an IP address or DNS hostname without a port") from None
        return value

    @field_validator("dns_servers")
    @classmethod
    def validate_dns(cls, value: list[str]) -> list[str]:
        if len(value) > 6:
            raise ValueError("At most six DNS servers are supported")
        return list(dict.fromkeys(str(ipaddress.ip_address(item)) for item in value))

    @field_validator("pxe_interface")
    @classmethod
    def validate_interface(cls, value: str) -> str:
        if value and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", value):
            raise ValueError("Invalid network interface name")
        return value

    @field_validator("proxy_dhcp_subnet")
    @classmethod
    def validate_subnet(cls, value: str) -> str:
        return str(ipaddress.IPv4Address(value)) if value else ""

    def require(self, *fields: str):
        missing = [name for name in fields if not getattr(self, name)]
        if missing:
            raise HTTPException(503, "Configure Settings > Provisioning: " + ", ".join(missing))

    def nfs_path(self, version: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", version) or ".." in version:
            raise HTTPException(422, "Invalid OS version")
        return self.nfs_export_path.replace("{version}", version)

    @property
    def nfs_host(self) -> str:
        return f"[{self.nfs_server}]" if ":" in self.nfs_server else self.nfs_server


# The first name is also the name used in exported PXE environment files.
ENV_NAMES = {
    "pxe_server_url": ("PXE_SERVER_URL", "PXE_SERVER"),
    "api_server_url": ("API_SERVER", "OCTOFLEET_INVENTORY_URL", "OCTOFLEET_API_URL"),
    "api_upstream_url": ("OCTOFLEET_API",),
    "nfs_server": ("NFS_SERVER",),
    "nfs_export_path": ("NFS_EXPORT_PATH",),
    "dns_servers": ("PROVISIONING_DNS_SERVERS",),
    "iso_path": ("PROVISIONING_ISO_PATH", "ISO_PATH"),
    "images_path": ("PROVISIONING_IMAGES_PATH",),
    "answers_path": ("PROVISIONING_ANSWERS_PATH",),
    "boot_path": ("PROVISIONING_BOOT_PATH",),
    "drivers_path": ("PROVISIONING_DRIVERS_PATH",),
    "scripts_path": ("PROVISIONING_SCRIPTS_PATH",),
    "tftp_root": ("TFTP_ROOT",),
    "windows_install_path": ("PROVISIONING_WINDOWS_INSTALL_PATH",),
    "mount_base": ("PROVISIONING_MOUNT_BASE",),
    "iso_manager_script": ("ISO_MANAGER_SCRIPT",),
    "hyperv_storage_path": ("PROVISIONING_HYPERV_STORAGE_PATH",),
    "kvm_storage_path": ("PROVISIONING_KVM_STORAGE_PATH",),
    "smb_images_share": ("PROVISIONING_SMB_IMAGES_SHARE",),
    "smb_install_share": ("PROVISIONING_SMB_INSTALL_SHARE",),
    "http_port": ("PXE_HTTP_PORT",),
    "pxe_interface": ("PXE_INTERFACE",),
    "proxy_dhcp_subnet": ("PXE_PROXY_DHCP_SUBNET",),
}


def environment_values() -> dict:
    values = {}
    for field, names in ENV_NAMES.items():
        for name in names:
            if os.getenv(name):
                values[field] = os.environ[name]
                break
    if "dns_servers" in values:
        values["dns_servers"] = [x.strip() for x in values["dns_servers"].split(",") if x.strip()]
    if not values.get("pxe_server_url") and os.getenv("PXE_SERVER_IP"):
        values["pxe_server_url"] = f"http://{os.environ['PXE_SERVER_IP']}:{values.get('http_port', 9080)}"
    return values


async def load_config(conn) -> ProvisioningConfig:
    row = await conn.fetchrow("SELECT value FROM system_settings WHERE key = $1", SETTINGS_KEY)
    stored = json.loads(row["value"]) if row and row["value"] else {}
    # Persisted menu settings take precedence, including deliberately empty values.
    return ProvisioningConfig.model_validate({**environment_values(), **stored})


def export_environment(config: ProvisioningConfig) -> str:
    config.require("pxe_server_url", "api_server_url")
    lines = ["# Generated by Octofleet Settings > Provisioning.",
             "# Save as provisioning/pxe.env, then recreate the PXE container.",
             "# Paths are paths on the PXE host; mount the same storage on the API host."]
    for field, names in ENV_NAMES.items():
        value = getattr(config, field)
        if field == "api_upstream_url":
            value = value or config.api_server_url
        if isinstance(value, list):
            value = ",".join(value)
        lines.append(f"{names[0]}='{value}'")
    return "\n".join(lines) + "\n"


def export_winpe(config: ProvisioningConfig) -> str:
    config.require("pxe_server_url", "api_server_url")
    values = {"PXE_SERVER_URL": config.pxe_server_url, "API_SERVER": config.api_server_url,
              "SMB_IMAGES_SHARE": config.smb_images_share, "SMB_INSTALL_SHARE": config.smb_install_share,
              "PROVISIONING_DNS_SERVERS": ",".join(config.dns_servers)}
    lines = ["@echo off", "REM Generated by Octofleet Settings > Provisioning."]
    for key, value in values.items():
        lines.append(f'set "{key}={value.replace(chr(37), chr(37) * 2)}"')
    return "\r\n".join(lines) + "\r\n"
