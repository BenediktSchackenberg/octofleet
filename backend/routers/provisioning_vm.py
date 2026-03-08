"""
Octofleet Provisioning API Router - VM Creation Extension
Handles automatic VM creation on Hyper-V and KVM hypervisors
"""

import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

vm_router = APIRouter(prefix="/api/v1/provisioning/vm", tags=["provisioning-vm"])

# ============================================
# Models for VM Creation
# ============================================

class DiskConfig(BaseModel):
    size_gb: int = Field(..., ge=10, le=10000, description="Disk size in GB")
    purpose: str = Field("os", description="Disk purpose: os, data, log, tempdb")
    type: str = Field("dynamic", description="Disk type: dynamic or fixed")

class NetworkConfig(BaseModel):
    vswitch: str = Field(..., description="Virtual switch name")
    vlan: Optional[int] = Field(None, ge=0, le=4095)

class VMCreateRequest(BaseModel):
    """Request to create a VM and start provisioning"""
    # VM Settings
    hostname: str = Field(..., min_length=1, max_length=63)
    hypervisor_node_id: str = Field(..., description="Node ID of the Hyper-V or KVM host")
    
    # VM Specs
    cpu: int = Field(4, ge=1, le=128)
    memory_gb: int = Field(8, ge=1, le=1024)
    generation: int = Field(2, ge=1, le=2, description="Hyper-V generation (1 or 2)")
    disks: List[DiskConfig] = Field(default_factory=lambda: [DiskConfig(size_gb=100, purpose="os")])
    network: NetworkConfig
    storage_path: Optional[str] = Field(None, description="Path for VM files")
    
    # OS Settings
    image_name: str = Field(..., description="Image name from provisioning_images")
    
    # Network Config
    use_dhcp: bool = True
    static_ip: Optional[str] = None
    subnet_mask: str = "255.255.255.0"
    gateway: Optional[str] = None
    dns_servers: List[str] = ["192.168.0.8"]
    
    # Domain Join
    domain_name: Optional[str] = None
    domain_ou: Optional[str] = None
    domain_user: Optional[str] = None
    domain_password: Optional[str] = None  # Will be encrypted
    
    # Post-Install
    install_agent: bool = True
    add_to_groups: List[int] = []
    install_packages: List[Dict[str, Any]] = []

class VMCreateResponse(BaseModel):
    task_id: str
    job_id: str
    hostname: str
    mac_address: Optional[str]
    status: str
    message: str

# PowerShell script template for Hyper-V VM creation
HYPERV_CREATE_SCRIPT = '''
param(
    [string]$VMName = "{hostname}",
    [int]$CPU = {cpu},
    [int]$MemoryGB = {memory_gb},
    [int]$Generation = {generation},
    [string]$VSwitch = "{vswitch}",
    [int]$VLAN = {vlan},
    [string]$StoragePath = "{storage_path}"
)

$ErrorActionPreference = "Stop"

# Create VM
Write-Host "Creating VM: $VMName"
$vm = New-VM -Name $VMName `
    -Generation $Generation `
    -MemoryStartupBytes ($MemoryGB * 1GB) `
    -Path $StoragePath `
    -NoVHD

# Configure CPU
Set-VMProcessor -VM $vm -Count $CPU

# Create and attach disks
$disks = @'
{disks_json}
'@ | ConvertFrom-Json

foreach ($disk in $disks) {{
    $vhdPath = Join-Path $StoragePath "$VMName-$($disk.purpose).vhdx"
    Write-Host "Creating disk: $vhdPath ($($disk.size_gb) GB)"
    
    if ($disk.type -eq 'fixed') {{
        New-VHD -Path $vhdPath -SizeBytes ($disk.size_gb * 1GB) -Fixed | Out-Null
    }} else {{
        New-VHD -Path $vhdPath -SizeBytes ($disk.size_gb * 1GB) -Dynamic | Out-Null
    }}
    
    Add-VMHardDiskDrive -VM $vm -Path $vhdPath
}}

# Configure network
$nic = Get-VMNetworkAdapter -VM $vm
Connect-VMNetworkAdapter -VMNetworkAdapter $nic -SwitchName $VSwitch

if ($VLAN -gt 0) {{
    Set-VMNetworkAdapterVlan -VMNetworkAdapter $nic -Access -VlanId $VLAN
}}

# Configure boot order (Network first for PXE)
$bootOrder = @()
$bootOrder += Get-VMNetworkAdapter -VM $vm
$bootOrder += Get-VMHardDiskDrive -VM $vm | Select-Object -First 1
Set-VMFirmware -VM $vm -BootOrder $bootOrder

# Enable Secure Boot for Gen2
if ($Generation -eq 2) {{
    Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate "MicrosoftUEFICertificateAuthority"
}}

# Start VM (triggers PXE boot)
Start-VM -VM $vm
Write-Host "VM started, waiting for MAC..."

Start-Sleep -Seconds 5

# Get MAC address
$mac = (Get-VMNetworkAdapter -VM $vm).MacAddress
$macFormatted = $mac -replace '(..)(?=.)', '$1:'

Write-Host "VM Created Successfully!"
Write-Host "VMName: $VMName"
Write-Host "MAC: $macFormatted"

# Return JSON result
@{{
    success = $true
    vmName = $VMName
    macAddress = $macFormatted
    status = "Started"
}} | ConvertTo-Json
'''

# Bash script template for KVM VM creation
KVM_CREATE_SCRIPT = '''#!/bin/bash
set -e

VM_NAME="{hostname}"
CPU={cpu}
MEMORY_MB={memory_mb}
STORAGE_POOL="{storage_pool}"
NETWORK="{network}"

echo "Creating KVM VM: $VM_NAME"

# Create disk(s)
{disk_commands}

# Create VM with PXE boot
virt-install \\
  --name "$VM_NAME" \\
  --vcpus $CPU \\
  --memory $MEMORY_MB \\
  --disk {disk_paths} \\
  --network network=$NETWORK,model=virtio \\
  --boot network,hd \\
  --os-variant win2k22 \\
  --graphics vnc \\
  --noautoconsole

# Get MAC address
sleep 3
MAC=$(virsh domiflist "$VM_NAME" | grep -oE '([0-9A-Fa-f]{{2}}:){{5}}[0-9A-Fa-f]{{2}}')

echo '{{"success": true, "vmName": "'"$VM_NAME"'", "macAddress": "'"$MAC"'", "status": "Started"}}'
'''

async def create_vm_on_hypervisor(
    request: VMCreateRequest,
    conn,
    job_service  # Injected job service
) -> dict:
    """
    Create a VM on the specified hypervisor using the job system
    Returns job_id and expected MAC address
    """
    
    # Get hypervisor info
    hypervisor = await conn.fetchrow("""
        SELECT node_id, hostname, os_name FROM nodes WHERE node_id = $1
    """, request.hypervisor_node_id)
    
    if not hypervisor:
        raise HTTPException(status_code=404, detail=f"Hypervisor node not found: {request.hypervisor_node_id}")
    
    # Determine platform type based on OS
    is_windows = hypervisor['os_name'] and 'Windows' in hypervisor['os_name']
    
    if is_windows:
        # Generate Hyper-V script
        disks_json = json.dumps([d.dict() for d in request.disks])
        
        script = HYPERV_CREATE_SCRIPT.format(
            hostname=request.hostname,
            cpu=request.cpu,
            memory_gb=request.memory_gb,
            generation=request.generation,
            vswitch=request.network.vswitch,
            vlan=request.network.vlan or 0,
            storage_path=request.storage_path or "D:\\Hyper-V\\Virtual Hard Disks",
            disks_json=disks_json
        )
        
        platform = f"hyperv-gen{request.generation}"
        command_type = "powershell"
        
    else:
        # Generate KVM script
        memory_mb = request.memory_gb * 1024
        
        disk_commands = []
        disk_paths = []
        for disk in request.disks:
            path = f"/var/lib/libvirt/images/{request.hostname}-{disk.purpose}.qcow2"
            disk_commands.append(f'qemu-img create -f qcow2 "{path}" {disk.size_gb}G')
            disk_paths.append(path)
        
        script = KVM_CREATE_SCRIPT.format(
            hostname=request.hostname,
            cpu=request.cpu,
            memory_mb=memory_mb,
            storage_pool=request.storage_path or "default",
            network=request.network.vswitch,
            disk_commands="\n".join(disk_commands),
            disk_paths=",".join([f'path={p},format=qcow2' for p in disk_paths])
        )
        
        platform = "kvm-libvirt"
        command_type = "bash"
    
    # Create job to execute script on hypervisor
    job_id = str(uuid.uuid4())
    
    await conn.execute("""
        INSERT INTO jobs (id, name, command_type, command, target_type, targets, status, created_by)
        VALUES ($1, $2, $3, $4, 'nodes', $5, 'pending', 'system')
    """, job_id, f"Create VM: {request.hostname}", command_type, script, [request.hypervisor_node_id])
    
    # Create job instance
    await conn.execute("""
        INSERT INTO job_instances (id, job_id, node_id, status)
        VALUES ($1, $2, $3, 'pending')
    """, str(uuid.uuid4()), job_id, request.hypervisor_node_id)
    
    return {
        "job_id": job_id,
        "platform": platform,
        "script": script
    }


# Database dependency
async def get_db():
    """Get database connection from pool"""
    from dependencies import db_pool
    if db_pool is None:
        raise RuntimeError("Database pool not initialized")
    async with db_pool.acquire() as conn:
        yield conn


@vm_router.post("/create", response_model=VMCreateResponse)
async def create_vm_and_provision(
    request: VMCreateRequest,
    conn = Depends(get_db)
):
    """
    Create a VM on a hypervisor and automatically start provisioning.
    
    Flow:
    1. Create job to execute VM creation script on hypervisor
    2. Job runs, creates VM, returns MAC address
    3. When job completes (via callback), provisioning task is created
    4. VM boots via PXE and installs Windows
    """
    
    # Verify image exists
    image = await conn.fetchrow("""
        SELECT name, display_name FROM provisioning_images WHERE name = $1 AND is_active = true
    """, request.image_name)
    
    if not image:
        raise HTTPException(status_code=400, detail=f"Image not found: {request.image_name}")
    
    # Get hypervisor info
    hypervisor = await conn.fetchrow("""
        SELECT id, node_id, hostname, os_name FROM nodes WHERE node_id = $1
    """, request.hypervisor_node_id)
    
    if not hypervisor:
        raise HTTPException(status_code=404, detail=f"Hypervisor node not found: {request.hypervisor_node_id}")
    
    # Determine platform type based on OS
    is_windows = hypervisor['os_name'] and 'Windows' in hypervisor['os_name']
    
    if is_windows:
        # Generate Hyper-V script
        disks_json = json.dumps([d.dict() for d in request.disks])
        
        script = HYPERV_CREATE_SCRIPT.format(
            hostname=request.hostname,
            cpu=request.cpu,
            memory_gb=request.memory_gb,
            generation=request.generation,
            vswitch=request.network.vswitch,
            vlan=request.network.vlan or 0,
            storage_path=request.storage_path or "D:\\\\Hyper-V\\\\Virtual Hard Disks",
            disks_json=disks_json
        )
        
        platform = f"hyperv-gen{request.generation}"
        command_type = "powershell"
        
    else:
        # Generate KVM script
        memory_mb = request.memory_gb * 1024
        
        disk_commands = []
        disk_paths = []
        for disk in request.disks:
            path = f"/var/lib/libvirt/images/{request.hostname}-{disk.purpose}.qcow2"
            disk_commands.append(f'qemu-img create -f qcow2 "{path}" {disk.size_gb}G')
            disk_paths.append(path)
        
        script = KVM_CREATE_SCRIPT.format(
            hostname=request.hostname,
            cpu=request.cpu,
            memory_mb=memory_mb,
            storage_pool=request.storage_path or "default",
            network=request.network.vswitch,
            disk_commands="\n".join(disk_commands),
            disk_paths=",".join([f'path={p},format=qcow2' for p in disk_paths])
        )
        
        platform = "kvm-libvirt"
        command_type = "bash"
    
    # Create job to execute script on hypervisor
    job_id = str(uuid.uuid4())
    
    await conn.execute("""
        INSERT INTO jobs (id, name, command_type, command, target_type, targets, status, created_by)
        VALUES ($1, $2, $3, $4, 'nodes', $5, 'pending', 'system')
    """, job_id, f"Create VM: {request.hostname}", command_type, script, [request.hypervisor_node_id])
    
    # Create job instance
    instance_id = str(uuid.uuid4())
    await conn.execute("""
        INSERT INTO job_instances (id, job_id, node_id, status)
        VALUES ($1, $2, $3, 'pending')
    """, instance_id, job_id, request.hypervisor_node_id)
    
    # Create a pending provisioning task (MAC will be filled when job completes)
    task_id = str(uuid.uuid4())
    await conn.execute("""
        INSERT INTO provisioning_tasks (
            id, hostname, platform, image_name, status, status_message,
            network_config, created_by
        ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'system')
    """, task_id, request.hostname, platform, request.image_name,
        f"Waiting for VM creation job {job_id}",
        json.dumps({
            "use_dhcp": request.use_dhcp,
            "static_ip": request.static_ip,
            "subnet_mask": request.subnet_mask,
            "gateway": request.gateway,
            "dns_servers": request.dns_servers,
            "domain_name": request.domain_name,
            "domain_ou": request.domain_ou,
            "install_agent": request.install_agent,
            "add_to_groups": request.add_to_groups,
            "install_packages": request.install_packages,
            "vm_job_id": job_id  # Link to VM creation job
        })
    )
    
    return VMCreateResponse(
        task_id=task_id,
        job_id=job_id,
        hostname=request.hostname,
        mac_address=None,  # Will be set when job completes
        status="pending",
        message=f"VM creation job queued on {hypervisor['hostname']}. Task will activate when MAC is returned."
    )
