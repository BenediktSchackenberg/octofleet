"""
Octofleet API - Services Routes
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from dependencies import db_pool, get_db, verify_api_key
import asyncpg
from typing import Optional, Dict, List, Any
import uuid
import json
import secrets

router = APIRouter(tags=["Services"])


@router.get("/api/v1/service-classes", dependencies=[Depends(verify_api_key)])
async def list_service_classes(db: asyncpg.Pool = Depends(get_db)):
    """List all service class templates"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sc.*, 
                   (SELECT COUNT(*) FROM services s WHERE s.class_id = sc.id) as service_count
            FROM service_classes sc
            ORDER BY sc.name
        """)
        return {"serviceClasses": [dict(r) for r in rows]}


@router.post("/api/v1/service-classes", dependencies=[Depends(verify_api_key)])
async def create_service_class(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new service class template"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO service_classes (
                name, description, service_type, min_nodes, max_nodes,
                roles, required_packages, config_template, health_check,
                drift_policy, update_strategy, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        """,
            data.get("name"),
            data.get("description"),
            data.get("serviceType", "single"),
            data.get("minNodes", 1),
            data.get("maxNodes", 1),
            json.dumps(data.get("roles", ["primary"])),
            json.dumps(data.get("requiredPackages", [])),
            data.get("configTemplate"),
            json.dumps(data.get("healthCheck", {"type": "tcp", "port": 80})),
            data.get("driftPolicy", "strict"),
            data.get("updateStrategy", "rolling"),
            data.get("createdBy")
        )
        return dict(row)


@router.get("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
async def get_service_class(class_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a service class by ID"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM service_classes WHERE id = $1
        """, class_id)
        if not row:
            raise not_found("Service class", class_id)
        return dict(row)


@router.put("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
async def update_service_class(class_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a service class"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE service_classes SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                service_type = COALESCE($4, service_type),
                min_nodes = COALESCE($5, min_nodes),
                max_nodes = COALESCE($6, max_nodes),
                roles = COALESCE($7, roles),
                required_packages = COALESCE($8, required_packages),
                config_template = COALESCE($9, config_template),
                health_check = COALESCE($10, health_check),
                drift_policy = COALESCE($11, drift_policy),
                update_strategy = COALESCE($12, update_strategy),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        """,
            class_id,
            data.get("name"),
            data.get("description"),
            data.get("serviceType"),
            data.get("minNodes"),
            data.get("maxNodes"),
            json.dumps(data["roles"]) if "roles" in data else None,
            json.dumps(data["requiredPackages"]) if "requiredPackages" in data else None,
            data.get("configTemplate"),
            json.dumps(data["healthCheck"]) if "healthCheck" in data else None,
            data.get("driftPolicy"),
            data.get("updateStrategy")
        )
        if not row:
            raise not_found("Service class", class_id)
        return dict(row)


@router.delete("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
async def delete_service_class(class_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a service class (only if no services use it)"""
    async with db.acquire() as conn:
        # Check for existing services
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM services WHERE class_id = $1", class_id
        )
        if count > 0:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete: {count} service(s) still using this class"
            )
        
        result = await conn.execute(
            "DELETE FROM service_classes WHERE id = $1", class_id
        )
        if result == "DELETE 0":
            raise not_found("Service class", class_id)
        return {"status": "deleted", "id": class_id}


@router.get("/api/v1/services", dependencies=[Depends(verify_api_key)])
async def list_services(
    status: str = None,
    class_id: str = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """List all services with optional filters"""
    async with db.acquire() as conn:
        query = """
            SELECT s.*, sc.name as class_name,
                   (SELECT COUNT(*) FROM service_node_assignments sna 
                    WHERE sna.service_id = s.id AND sna.status = 'active') as active_nodes
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if status:
            query += f" AND s.status = ${param_idx}"
            params.append(status)
            param_idx += 1
        
        if class_id:
            query += f" AND s.class_id = ${param_idx}"
            params.append(class_id)
            param_idx += 1
        
        query += " ORDER BY s.name"
        
        rows = await conn.fetch(query, *params)
        return {"services": [dict(r) for r in rows]}


@router.post("/api/v1/services", dependencies=[Depends(verify_api_key)])
async def create_service(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new service instance"""
    class_id = data.get("classId")
    if not class_id:
        raise HTTPException(status_code=400, detail="classId required")
    
    async with db.acquire() as conn:
        # Verify class exists
        class_row = await conn.fetchrow(
            "SELECT * FROM service_classes WHERE id = $1", class_id
        )
        if not class_row:
            raise not_found("Service class", class_id)
        
        row = await conn.fetchrow("""
            INSERT INTO services (
                class_id, name, description, config_values, secrets_ref, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        """,
            class_id,
            data.get("name"),
            data.get("description"),
            json.dumps(data.get("configValues", {})),
            data.get("secretsRef"),
            data.get("createdBy")
        )
        return dict(row)


@router.get("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
async def get_service(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a service with its node assignments"""
    async with db.acquire() as conn:
        service = await conn.fetchrow("""
            SELECT s.*, sc.name as class_name, sc.roles as available_roles,
                   sc.health_check, sc.drift_policy, sc.update_strategy
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE s.id = $1
        """, service_id)
        
        if not service:
            raise not_found("Service", service_id)
        
        # Get node assignments
        assignments = await conn.fetch("""
            SELECT sna.*, n.hostname, n.os_name, n.agent_version
            FROM service_node_assignments sna
            JOIN nodes n ON sna.node_id = n.id
            WHERE sna.service_id = $1
            ORDER BY sna.role, n.hostname
        """, service_id)
        
        result = dict(service)
        result["nodes"] = [dict(a) for a in assignments]
        return result


@router.put("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
async def update_service(service_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a service"""
    async with db.acquire() as conn:
        # Increment desired_state_version if config changes
        version_increment = 1 if "configValues" in data else 0
        
        row = await conn.fetchrow("""
            UPDATE services SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                status = COALESCE($4, status),
                config_values = COALESCE($5, config_values),
                secrets_ref = COALESCE($6, secrets_ref),
                desired_state_version = desired_state_version + $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        """,
            service_id,
            data.get("name"),
            data.get("description"),
            data.get("status"),
            json.dumps(data["configValues"]) if "configValues" in data else None,
            data.get("secretsRef"),
            version_increment
        )
        if not row:
            raise not_found("Service", service_id)
        return dict(row)


@router.delete("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
async def delete_service(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a service and all its assignments"""
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM services WHERE id = $1", service_id
        )
        if result == "DELETE 0":
            raise not_found("Service", service_id)
        return {"status": "deleted", "id": service_id}


@router.post("/api/v1/services/{service_id}/nodes", dependencies=[Depends(verify_api_key)])
async def assign_node_to_service(
    service_id: str, 
    data: Dict[str, Any], 
    db: asyncpg.Pool = Depends(get_db)
):
    """Assign a node to a service with a role"""
    node_id = data.get("nodeId")
    role = data.get("role", "primary")
    
    if not node_id:
        raise bad_request("nodeId is required", "nodeId")
    
    async with db.acquire() as conn:
        # Verify service and node exist
        service = await conn.fetchrow("SELECT * FROM services WHERE id = $1", service_id)
        if not service:
            raise not_found("Service", service_id)
        
        node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        # Create assignment
        try:
            row = await conn.fetchrow("""
                INSERT INTO service_node_assignments (service_id, node_id, role)
                VALUES ($1, $2, $3)
                RETURNING *
            """, service_id, node_id, role)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=400, detail="Node already assigned to this service")
        
        # Log the assignment
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message)
            VALUES ($1, $2, 'assign', 'success', $3)
        """, service_id, node_id, f"Node assigned with role: {role}")
        
        return dict(row)


@router.delete("/api/v1/services/{service_id}/nodes/{node_id}", dependencies=[Depends(verify_api_key)])
async def remove_node_from_service(
    service_id: str, 
    node_id: str, 
    db: asyncpg.Pool = Depends(get_db)
):
    """Remove a node from a service"""
    async with db.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM service_node_assignments 
            WHERE service_id = $1 AND node_id = $2
        """, service_id, node_id)
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Assignment not found")
        
        # Log removal
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message)
            VALUES ($1, $2, 'remove', 'success', 'Node removed from service')
        """, service_id, node_id)
        
        return {"status": "removed", "serviceId": service_id, "nodeId": node_id}


@router.get("/api/v1/services/{service_id}/logs", dependencies=[Depends(verify_api_key)])
async def get_service_logs(
    service_id: str,
    limit: int = 50,
    db: asyncpg.Pool = Depends(get_db)
):
    """Get reconciliation logs for a service"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT srl.*, n.hostname
            FROM service_reconciliation_log srl
            LEFT JOIN nodes n ON srl.node_id = n.id
            WHERE srl.service_id = $1
            ORDER BY srl.started_at DESC
            LIMIT $2
        """, service_id, limit)
        return {"logs": [dict(r) for r in rows]}


@router.post("/api/v1/services/{service_id}/reconcile", dependencies=[Depends(verify_api_key)])
async def trigger_reconciliation(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Trigger reconciliation for a service - creates jobs for all assigned nodes"""
    async with db.acquire() as conn:
        # Get service with class details
        service = await conn.fetchrow("""
            SELECT s.*, sc.name as class_name, sc.service_type, sc.roles,
                   sc.required_packages, sc.config_template, sc.health_check
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE s.id = $1
        """, service_id)
        
        if not service:
            raise not_found("Service", service_id)
        
        # Get all node assignments
        assignments = await conn.fetch("""
            SELECT sna.*, n.id as node_uuid, n.hostname, n.os_name
            FROM service_node_assignments sna
            JOIN nodes n ON sna.node_id = n.id
            WHERE sna.service_id = $1
        """, service_id)
        
        if not assignments:
            raise HTTPException(status_code=400, detail="No nodes assigned to service")
        
        # Build service definition
        service_def = {
            "serviceId": service_id,
            "serviceName": service["name"],
            "className": service["class_name"],
            "serviceType": service["service_type"],
            "requiredPackages": json.loads(service["required_packages"]) if service["required_packages"] else [],
            "configTemplate": service["config_template"],
            "configValues": json.loads(service["config_values"]) if service["config_values"] else {},
            "healthCheck": json.loads(service["health_check"]) if service["health_check"] else {},
            "desiredStateVersion": service["desired_state_version"]
        }
        
        # Create reconciliation jobs for each node
        jobs_created = []
        for assignment in assignments:
            # Create job with service definition
            job_data = {
                "type": "service_reconcile",
                "serviceDefinition": service_def,
                "role": assignment["role"],
                "assignmentId": str(assignment["id"])
            }
            
            job = await conn.fetchrow("""
                INSERT INTO jobs (name, command_type, command_data, target_type, target_id, created_by)
                VALUES ($1, 'service_reconcile', $2, 'node', $3, 'system')
                RETURNING id, name
            """, f"Reconcile: {service['name']} on {assignment['hostname']}", json.dumps(job_data), assignment['node_uuid'])
            
            # Create job instance for this node
            instance = await conn.fetchrow("""
                INSERT INTO job_instances (job_id, node_id)
                VALUES ($1, $2)
                RETURNING id
            """, job["id"], assignment["hostname"])
            
            # Log reconciliation start
            await conn.execute("""
                INSERT INTO service_reconciliation_log 
                    (service_id, node_id, action, status, message)
                VALUES ($1, $2, 'reconcile', 'started', $3)
            """, service_id, assignment["node_uuid"], f"Reconciliation triggered for role: {assignment['role']}")
            
            jobs_created.append({
                "jobId": str(job["id"]),
                "instanceId": str(instance["id"]),
                "nodeId": assignment["hostname"],
                "role": assignment["role"]
            })
        
        # Update service status
        await conn.execute("""
            UPDATE services SET status = 'reconciling', updated_at = NOW()
            WHERE id = $1
        """, service_id)
        
        return {
            "status": "reconciliation_triggered",
            "serviceId": service_id,
            "jobsCreated": len(jobs_created),
            "jobs": jobs_created
        }


@router.get("/api/v1/nodes/{node_id}/service-assignments", dependencies=[Depends(verify_api_key)])
async def get_node_service_assignments(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get all services assigned to a node - for agent polling.
    node_id can be the database ID or the hostname (case-insensitive).
    """
    async with db.acquire() as conn:
        # If node_id is not numeric, treat it as hostname and look up the actual ID
        actual_node_id = node_id
        if not node_id.isdigit():
            node = await conn.fetchrow(
                "SELECT id FROM nodes WHERE UPPER(hostname) = UPPER($1)",
                node_id
            )
            if not node:
                # No services for unknown node - return empty list (not an error)
                return {"nodeId": node_id, "services": []}
            actual_node_id = str(node["id"])
        
        assignments = await conn.fetch("""
            SELECT 
                sna.id as assignment_id,
                sna.role,
                sna.status as assignment_status,
                sna.last_reconciled_version,
                s.id as service_id,
                s.name as service_name,
                s.status as service_status,
                s.config_values,
                s.desired_state_version,
                sc.name as class_name,
                sc.service_type,
                sc.required_packages,
                sc.config_template,
                sc.health_check,
                sc.drift_policy
            FROM service_node_assignments sna
            JOIN services s ON sna.service_id = s.id
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE sna.node_id = $1
            ORDER BY s.name
        """, actual_node_id)
        
        services = []
        for a in assignments:
            services.append({
                "assignmentId": str(a["assignment_id"]),
                "serviceId": str(a["service_id"]),
                "serviceName": a["service_name"],
                "className": a["class_name"],
                "role": a["role"],
                "status": a["assignment_status"],
                "serviceType": a["service_type"],
                "requiredPackages": json.loads(a["required_packages"]) if a["required_packages"] else [],
                "configTemplate": a["config_template"],
                "configValues": json.loads(a["config_values"]) if a["config_values"] else {},
                "healthCheck": json.loads(a["health_check"]) if a["health_check"] else {},
                "driftPolicy": a["drift_policy"],
                "currentVersion": a["last_reconciled_version"],
                "desiredVersion": a["desired_state_version"],
                "needsReconcile": (a["last_reconciled_version"] or 0) < (a["desired_state_version"] or 0)
            })
        
        return {"nodeId": node_id, "services": services}


@router.post("/api/v1/services/{service_id}/nodes/{node_id}/status", dependencies=[Depends(verify_api_key)])
async def update_node_service_status(
    service_id: str,
    node_id: str,
    data: Dict[str, Any],
    db: asyncpg.Pool = Depends(get_db)
):
    """Agent reports service status after reconciliation"""
    async with db.acquire() as conn:
        # Update assignment status
        result = await conn.execute("""
            UPDATE service_node_assignments SET
                status = $3,
                health_status = $4,
                last_reconciled_version = COALESCE($5, last_reconciled_version),
                last_reconciled_at = NOW(),
                updated_at = NOW()
            WHERE service_id = $1 AND node_id = $2
        """,
            service_id,
            node_id,
            data.get("status", "active"),
            data.get("healthStatus", "unknown"),
            data.get("stateVersion")
        )
        
        # Log the status update
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        """,
            service_id,
            node_id,
            data.get("action", "status_update"),
            data.get("result", "success"),
            data.get("message", "Status updated"),
            json.dumps(data.get("details", {}))
        )
        
        # Check overall service health
        health_counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE health_status = 'healthy') as healthy,
                COUNT(*) FILTER (WHERE health_status = 'unhealthy') as unhealthy
            FROM service_node_assignments
            WHERE service_id = $1
        """, service_id)
        
        # Determine service status
        if health_counts["total"] == health_counts["healthy"]:
            new_status = "healthy"
        elif health_counts["unhealthy"] > 0:
            new_status = "degraded" if health_counts["healthy"] > 0 else "failed"
        else:
            new_status = "provisioning"
        
        await conn.execute("""
            UPDATE services SET status = $2, updated_at = NOW()
            WHERE id = $1
        """, service_id, new_status)
        
        return {
            "status": "updated",
            "serviceStatus": new_status,
            "healthyNodes": health_counts["healthy"],
            "totalNodes": health_counts["total"]
        }
