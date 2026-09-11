# Provisioning configuration

Open **Settings → Provisioning** (`/settings/provisioning`) to configure boot services and storage. Reading requires `settings:read`; saving and exporting require `settings:write`. Settings are stored in the existing `system_settings` table under `provisioning`, with the modifying username. No schema migration is needed.

## Addresses and paths

- **PXE base URL:** reachable from the machines being installed, including the port. An optional base path requires a reverse proxy which strips that prefix before forwarding to the PXE container.
- **Public API URL:** reachable from deployed agents and installation callbacks, without `/api/v1`.
- **PXE API upstream:** optional internal API address used by nginx. Empty uses the public API URL. HTTPS upstreams must have a trusted certificate.
- **NFS server / export path:** the existing server and export containing Ubuntu's live filesystem. `{version}` expands to the image version, e.g. `/exports/ubuntu-{version}` becomes `/exports/ubuntu-24.04`.
- **DNS defaults:** optional IP addresses for new provisioning tasks. Per-task values take precedence; an explicit empty list opts out.
- **ISO, image, answer, boot, driver, script and TFTP directories:** absolute Linux paths visible to the component accessing them. The ISO manager runs on the backend host. Its configured script must be installed and have the necessary sudo permissions.
- **ISO mount base:** Ubuntu ISOs are mounted at `<base>/ubuntu-<version>`. Windows and VirtIO mounts use `<base>/winiso` and `<base>/virtio`.
- **Hyper-V / KVM storage:** default paths on the chosen hypervisor. A task's explicit `storage_path` overrides the default. Hyper-V accepts drive and UNC paths; KVM uses a Linux directory.
- **SMB image / installation shares:** optional UNC paths for the bundled legacy Windows scripts. These settings do not create shares or store credentials.
- **Listener, interface and ProxyDHCP:** the container's HTTP port, optional interface, and optional IPv4 network address for ProxyDHCP. Empty network address disables ProxyDHCP. Configure boot options on the existing DHCP server in that case.

Host addresses deliberately have no private-network defaults. Missing required values produce a configuration error rather than booting against a guessed server. Linux paths reject whitespace and shell metacharacters because they are also used in nginx, boot and shell configuration. System paths inside an installed operating system are unchanged.

## Apply a configuration

1. Enter the paths and addresses for your installation and save. New backend-generated scripts and new tasks read the settings immediately, including after a backend restart.
2. Prepare the corresponding directories and ISO/NFS mounts. On separate API and PXE hosts, make the same storage available at the configured paths on both hosts. Saving does not move existing files, install tools, create NFS exports or move active mounts.
3. Export **PXE configuration**, save it as `provisioning/pxe.env` in a checkout on the Linux PXE host, then run:

   ```bash
   ./provisioning/setup-pxe.sh
   # Equivalent, from provisioning/:
   docker compose --env-file pxe.env up -d --build --force-recreate
   ```

   Install Docker Engine and its Compose plugin first. The launcher uses the maintained Compose stack; it no longer generates a separate stack, edits system NFS exports, or registers duplicate templates. Manage ISO imports in **Provisioning → Administration**. Ensure `ipxe.efi` and `undionly.kpxe` are present in the configured TFTP directory before booting clients. The image does not bundle these bootloaders.
4. The container renders nginx, dnsmasq, iPXE and GRUB configuration from the export. It regenerates the bundled boot menus in the TFTP directory. HTTP routes such as `/images/` and `/drivers/` stay stable while their filesystem locations change. ISO mounts must exist before the container is created; recreate it after adding a mount.
5. For a custom WinPE image using the bundled `.cmd` scripts, export **WinPE configuration** and embed `octofleet-config.cmd` next to `startnet.cmd` (normally `X:\Windows\System32`). Rebuild that image after changing the export. The scripts stop before installation if the required URL/share is missing. `SetupComplete.cmd` no longer contains a site-specific domain account; domain joining belongs in the task's answer file. DNS is taken from that answer file.

Already generated, per-device scripts and answer files keep their content. Regenerate them when changing infrastructure addresses. Existing image records and custom templates may contain literal URLs: replace those in **Provisioning → Administration** with `${PXE_SERVER}` or `${API_SERVER}` as appropriate. Windows template rendering resolves these placeholders at boot time. Archived test configurations in the repository are not migrated automatically.

## Environment compatibility

Before the first save, environment variables provide defaults. Saved values take precedence, including deliberately empty fields. The exported `.env` uses the canonical names below and can also bootstrap a backend which receives these variables. It contains no API keys or domain passwords.

| Setting | Environment variable |
| --- | --- |
| PXE URL | `PXE_SERVER_URL` (legacy `PXE_SERVER`, or explicit `PXE_SERVER_IP` plus `PXE_HTTP_PORT`) |
| Public API | `API_SERVER` (legacy `OCTOFLEET_INVENTORY_URL`, `OCTOFLEET_API_URL`) |
| API upstream | `OCTOFLEET_API` |
| NFS | `NFS_SERVER`, `NFS_EXPORT_PATH` |
| DNS | `PROVISIONING_DNS_SERVERS` (comma-separated) |
| ISO directory | `PROVISIONING_ISO_PATH` (legacy `ISO_PATH`) |
| Storage | `PROVISIONING_IMAGES_PATH`, `PROVISIONING_ANSWERS_PATH`, `PROVISIONING_BOOT_PATH`, `PROVISIONING_DRIVERS_PATH`, `PROVISIONING_SCRIPTS_PATH` |
| TFTP / Windows source | `TFTP_ROOT`, `PROVISIONING_WINDOWS_INSTALL_PATH` |
| Mounts / ISO helper | `PROVISIONING_MOUNT_BASE`, `ISO_MANAGER_SCRIPT` |
| VM storage | `PROVISIONING_HYPERV_STORAGE_PATH`, `PROVISIONING_KVM_STORAGE_PATH` |
| SMB shares | `PROVISIONING_SMB_IMAGES_SHARE`, `PROVISIONING_SMB_INSTALL_SHARE` |
| PXE service | `PXE_HTTP_PORT`, `PXE_INTERFACE`, `PXE_PROXY_DHCP_SUBNET` |

The Compose export mounts each configured storage directory at the same absolute path inside the PXE container. For an existing installation previously using relative mounts like `./images:/srv/images`, enter its actual host path in the menu and expose that path to the API host as well. Retain a backup of the previous deployment configuration when switching.

`generate-boot.sh`, `setup-grub-pxe.sh` and `test-pxe.sh` read `provisioning/pxe.env`; `PXE_CONFIG_FILE` can select another export. Only source administrator-created exports.

## API and validation

- `GET /api/v1/provisioning/config`: effective settings.
- `PUT /api/v1/provisioning/config`: validate and replace the configuration atomically.
- `GET /api/v1/provisioning/config/export`: `{filename, content}` for Compose.
- `GET /api/v1/provisioning/config/export/winpe`: `{filename, content}` for Windows.

The generic settings endpoints reserve this key, so they cannot bypass validation or permissions. Unknown fields, invalid protocols, embedded credentials, malformed ports, path traversal and command separators are rejected before persistence. Missing configuration does not advance a task to `booting`.

Backend regression tests run with `python -m pytest tests/test_provisioning_config.py -q`. The PXE image supports `--check` to generate files and validate nginx/dnsmasq without starting those services. This checks configuration syntax; real PXE, NFS and Windows installation still require a test machine on the target network.
