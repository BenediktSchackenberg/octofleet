# === API Endpoints ===

# === Job Execution Backend APIs ===

@app.get("/api/v1/agent/jobs")
async def get_assigned_jobs(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Fetch jobs assigned to a node"""
    async with db.acquire() as conn:
        jobs = await conn.fetch("""
            SELECT job_id, status, updated_at
            FROM job_assignments WHERE node_id = $1
        """, node_id)
        return {"jobs": [dict(job) for job in jobs]}


@app.post("/api/v1/agent/jobs/{id}/start")
async def start_job(id: str, node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Mark a job as started"""
    async with db.acquire() as conn:
        await conn.execute("""
            UPDATE job_assignments
            SET status = 'running', updated_at = NOW()
            WHERE job_id = $1 AND node_id = $2 AND status = 'assigned'
        """, id, node_id)
    return {"status": "started", "job_id": id, "node_id": node_id}


@app.post("/api/v1/agent/jobs/{id}/progress")
async def report_progress(id: str, node_id: str, progress: int, db: asyncpg.Pool = Depends(get_db)):
    """Report job progress"""
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO job_results (job_id, node_id, logs, success) VALUES ($1, $2, $3, $4)
            ON CONFLICT (node_id) DO UPDATE SET updated_at = NOW();
        """, id, node_id, json.dumps({"progress": progress}), false);


@app.post("/api/v1/agent/jobs/{id}/complete")
async def report_job_completion(id: str, node_id: str, success: bool, logs: str, db: asyncpg.Pool = Depends(get_db)):
    """Report job completion"""
    async with db.acquire() as conn:
        await conn.execute("""
            UPDATE job_assignments SET status = CASE success WHEN true THEN 'completed' ELSE 'failed' END);