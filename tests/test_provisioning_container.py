"""Optional real nginx/dnsmasq integration checks. Build the image locally first.

RUN_PXE_CONTAINER_TESTS=1 python -m pytest tests/test_provisioning_container.py
The containers have no external network, published ports or host mounts.
"""
import os
import subprocess
import uuid

import pytest

pytestmark = pytest.mark.skipif(os.getenv("RUN_PXE_CONTAINER_TESTS") != "1", reason="Opt-in Docker integration checks")


def run_container(environment, script):
    command = ["docker"]
    if os.getenv("PXE_TEST_DOCKER_CONFIG"):
        command += ["--config", os.environ["PXE_TEST_DOCKER_CONFIG"]]
    docker = command.copy()
    name = "octofleet-config-test-" + uuid.uuid4().hex
    command += ["run", "--rm", "--name", name, "--network", "none", "-i", "--entrypoint", "/bin/bash"]
    for key, value in environment.items():
        command += ["-e", f"{key}={value}"]
    command += [os.getenv("PXE_TEST_IMAGE", "octofleet-pxe-config-test:local"), "-s"]
    try:
        result = subprocess.run(command, input=script.encode("utf-8"), capture_output=True, timeout=45)
    except subprocess.TimeoutExpired:
        subprocess.run(docker + ["rm", "-f", name], capture_output=True, timeout=15)
        raise
    result.stdout = result.stdout.decode("utf-8")
    result.stderr = result.stderr.decode("utf-8")
    return result


@pytest.mark.parametrize("subnet", ["", "10.42.0.0"])
def test_exported_paths_render_and_services_validate(subnet):
    env = {"PXE_SERVER_URL": "https://pxe.example.test:9443/branch", "API_SERVER": "http://127.0.0.1:8080",
           "PXE_HTTP_PORT": "19080", "NFS_SERVER": "10.42.0.5", "NFS_EXPORT_PATH": "/exports/linux-{version}",
           "PXE_PROXY_DHCP_SUBNET": subnet}
    paths = {"TFTP_ROOT": "/custom/tftp", "PROVISIONING_IMAGES_PATH": "/custom/images",
             "PROVISIONING_ANSWERS_PATH": "/custom/answers", "PROVISIONING_BOOT_PATH": "/custom/boot",
             "PROVISIONING_DRIVERS_PATH": "/custom/drivers", "PROVISIONING_SCRIPTS_PATH": "/custom/scripts",
             "PROVISIONING_WINDOWS_INSTALL_PATH": "/custom/windows", "PROVISIONING_MOUNT_BASE": "/custom/mounts"}
    result = run_container({**env, **paths}, """set -eu
/entrypoint.sh --check
cat /etc/nginx/nginx.conf /etc/dnsmasq.conf /custom/tftp/autoexec.ipxe /custom/tftp/boot.ipxe /custom/tftp/ubuntu-nfs-v2.ipxe /custom/tftp/grub/grub.cfg
""")
    assert result.returncode == 0, result.stderr
    output = result.stdout
    for path in paths.values():
        assert path in output
    assert "listen 19080;" in output
    assert "set nfs-path /exports/linux-24.04" in output
    assert "(https,pxe.example.test:9443)/branch/ubuntu-live/24.04" in output
    assert "chain https://pxe.example.test:9443/branch/boot.ipxe" in output
    assert "${mac:hexhyp}" in output and "$proxy_host" in output and "$1" in output
    assert "192.168.0." not in output
    assert ("dhcp-range=" in output) == bool(subnet)


def test_default_nfs_path_renders_without_literal_braces():
    result = run_container({"PXE_SERVER_URL": "http://pxe.test:9080", "API_SERVER": "http://127.0.0.1:8080"},
        "/entrypoint.sh --check && cat /tftpboot/ubuntu-nfs-v2.ipxe")
    assert result.returncode == 0, result.stderr
    assert "set nfs-path /mnt/ubuntu-24.04\n" in result.stdout


def test_missing_address_fails_before_startup():
    result = run_container({}, "/entrypoint.sh --check")
    assert result.returncode != 0
    assert "Set PXE_SERVER_URL" in result.stderr
