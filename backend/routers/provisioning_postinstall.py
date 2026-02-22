"""
Post-Install Orchestration for Octofleet Provisioning
Handles automatic package installation, group assignment, and configuration after OS deployment
"""

from typing import List, Dict, Any, Optional
import json

async def execute_post_install(
    node_id: str,
    config: Dict[str, Any],
    conn
) -> Dict[str, Any]:
    """
    Execute post-install tasks on a newly provisioned node.
    
    Args:
        node_id: The ID of the newly provisioned node
        config: Post-install configuration containing:
            - add_to_groups: List of group IDs
            - install_packages: List of packages to install
            - run_scripts: List of custom scripts
            - wait_for_agent: Whether to wait for agent to connect
    
    Returns:
        Summary of executed tasks
    """
    
    results = {
        "node_id": node_id,
        "tasks_completed": [],
        "tasks_failed": [],
        "jobs_created": []
    }
    
    # 1. Add node to groups
    if config.get("add_to_groups"):
        for group_id in config["add_to_groups"]:
            try:
                await conn.execute("""
                    INSERT INTO device_groups (node_id, group_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                """, node_id, group_id)
                results["tasks_completed"].append(f"Added to group {group_id}")
            except Exception as e:
                results["tasks_failed"].append(f"Failed to add to group {group_id}: {str(e)}")
    
    # 2. Install packages
    if config.get("install_packages"):
        for package in config["install_packages"]:
            package_id = package.get("package_id")
            parameters = package.get("parameters", {})
            
            try:
                # Create deployment job for this package
                job_id = await create_package_deployment_job(
                    conn, node_id, package_id, parameters
                )
                results["jobs_created"].append({
                    "job_id": job_id,
                    "package_id": package_id,
                    "type": "package_install"
                })
                results["tasks_completed"].append(f"Queued package {package_id}")
            except Exception as e:
                results["tasks_failed"].append(f"Failed to queue package {package_id}: {str(e)}")
    
    # 3. Run custom scripts
    if config.get("run_scripts"):
        for script in config["run_scripts"]:
            try:
                job_id = await create_script_job(
                    conn, node_id, script
                )
                results["jobs_created"].append({
                    "job_id": job_id,
                    "script_name": script.get("name", "custom"),
                    "type": "script"
                })
                results["tasks_completed"].append(f"Queued script {script.get('name', 'custom')}")
            except Exception as e:
                results["tasks_failed"].append(f"Failed to queue script: {str(e)}")
    
    return results


async def create_package_deployment_job(
    conn,
    node_id: str,
    package_id: int,
    parameters: Dict[str, Any] = None
) -> str:
    """Create a job to install a package on a node"""
    import uuid
    
    # Get package details
    package = await conn.fetchrow("""
        SELECT name, install_command, install_args
        FROM packages
        WHERE id = $1
    """, package_id)
    
    if not package:
        raise ValueError(f"Package {package_id} not found")
    
    # Build command with parameters
    command = package["install_command"]
    if package["install_args"]:
        command += " " + package["install_args"]
    
    # Replace parameter placeholders
    if parameters:
        for key, value in parameters.items():
            command = command.replace(f"{{{key}}}", str(value))
    
    job_id = str(uuid.uuid4())
    
    await conn.execute("""
        INSERT INTO jobs (id, name, command_type, command, target_type, targets, status, created_by)
        VALUES ($1, $2, 'powershell', $3, 'nodes', $4, 'pending', 'system')
    """, job_id, f"Install {package['name']}", command, [node_id])
    
    await conn.execute("""
        INSERT INTO job_instances (id, job_id, node_id, status)
        VALUES ($1, $2, $3, 'pending')
    """, str(uuid.uuid4()), job_id, node_id)
    
    return job_id


async def create_script_job(
    conn,
    node_id: str,
    script: Dict[str, Any]
) -> str:
    """Create a job to run a script on a node"""
    import uuid
    
    job_id = str(uuid.uuid4())
    
    command_type = script.get("type", "powershell")
    command = script.get("content") or script.get("command", "")
    name = script.get("name", "Custom Script")
    
    await conn.execute("""
        INSERT INTO jobs (id, name, command_type, command, target_type, targets, status, created_by)
        VALUES ($1, $2, $3, $4, 'nodes', $5, 'pending', 'system')
    """, job_id, name, command_type, command, [node_id])
    
    await conn.execute("""
        INSERT INTO job_instances (id, job_id, node_id, status)
        VALUES ($1, $2, $3, 'pending')
    """, str(uuid.uuid4()), job_id, node_id)
    
    return job_id


# Pre-defined post-install task templates
POST_INSTALL_TEMPLATES = {
    "sql_server_standard": {
        "name": "SQL Server Standard Setup",
        "install_packages": [
            {"package_id": "sql-server-2025", "parameters": {"instanceName": "YOURDBSERVER"}},
            {"package_id": "ssms", "parameters": {}}
        ],
        "run_scripts": [
            {
                "name": "Configure SQL Server",
                "type": "powershell",
                "content": """
# Configure SQL Server
Import-Module SQLPS -DisableNameChecking

# Enable TCP/IP
$smo = 'Microsoft.SqlServer.Management.Smo.'
$wmi = new-object ($smo + 'Wmi.ManagedComputer')
$tcp = $wmi.GetSmoObject("ManagedComputer[@Name='$env:COMPUTERNAME']/ServerInstance[@Name='MSSQLSERVER']/ServerProtocol[@Name='Tcp']")
$tcp.IsEnabled = $true
$tcp.Alter()

# Set max memory
Invoke-Sqlcmd -Query "EXEC sp_configure 'max server memory', 8192; RECONFIGURE"

Write-Host "SQL Server configured"
"""
            }
        ]
    },
    
    "web_server": {
        "name": "Web Server Setup",
        "run_scripts": [
            {
                "name": "Install IIS",
                "type": "powershell",
                "content": """
# Install IIS with common features
Install-WindowsFeature -Name Web-Server, Web-Asp-Net45, Web-Mgmt-Console -IncludeManagementTools

# Configure basic hardening
Set-WebConfigurationProperty -Filter /system.webServer/security/requestFiltering -Name allowDoubleEscaping -Value $false
Set-WebConfigurationProperty -Filter /system.webServer/security/requestFiltering -Name allowHighBitCharacters -Value $false

Write-Host "IIS installed and configured"
"""
            }
        ]
    },
    
    "domain_controller": {
        "name": "Domain Controller Promotion",
        "run_scripts": [
            {
                "name": "Promote to DC",
                "type": "powershell",
                "content": """
# This is a placeholder - DC promotion requires additional parameters
# and should be done via the GUI or with specific forest/domain settings

Write-Host "DC promotion requires manual configuration or additional parameters"
Write-Host "Use Install-ADDSForest or Install-ADDSDomainController"
"""
            }
        ]
    }
}


async def apply_post_install_template(
    conn,
    node_id: str,
    template_name: str,
    parameter_overrides: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Apply a pre-defined post-install template to a node
    """
    
    if template_name not in POST_INSTALL_TEMPLATES:
        raise ValueError(f"Unknown template: {template_name}. Available: {list(POST_INSTALL_TEMPLATES.keys())}")
    
    template = POST_INSTALL_TEMPLATES[template_name].copy()
    
    # Apply parameter overrides
    if parameter_overrides:
        if "install_packages" in template:
            for pkg in template["install_packages"]:
                if pkg.get("parameters"):
                    pkg["parameters"].update(parameter_overrides.get("package_params", {}))
    
    return await execute_post_install(node_id, template, conn)


# Callback handler for provisioning completion
async def handle_provisioning_complete(
    conn,
    task_id: str,
    node_id: str
) -> Dict[str, Any]:
    """
    Called when a provisioning task completes successfully.
    Triggers post-install orchestration based on task configuration.
    """
    
    # Get task config
    task = await conn.fetchrow("""
        SELECT post_install_config FROM provisioning_tasks WHERE id = $1
    """, task_id)
    
    if not task or not task["post_install_config"]:
        return {"status": "skipped", "message": "No post-install config"}
    
    config = json.loads(task["post_install_config"]) if isinstance(task["post_install_config"], str) else task["post_install_config"]
    
    # Update task status
    await conn.execute("""
        UPDATE provisioning_tasks 
        SET status = 'post_install', 
            current_step = 'Running post-install tasks',
            updated_at = NOW()
        WHERE id = $1
    """, task_id)
    
    # Execute post-install tasks
    results = await execute_post_install(node_id, config, conn)
    
    # Update task to completed
    await conn.execute("""
        UPDATE provisioning_tasks 
        SET status = 'completed', 
            completed_at = NOW(),
            progress_percent = 100,
            result_node_id = $2,
            updated_at = NOW()
        WHERE id = $1
    """, task_id, node_id)
    
    # Log completion
    await conn.execute("""
        INSERT INTO provisioning_events (task_id, event_type, message, details)
        VALUES ($1, 'completed', 'Provisioning and post-install completed', $2)
    """, task_id, json.dumps(results))
    
    return results
