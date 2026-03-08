"""
Octofleet API - Reports Routes
"""
import csv
import io
from datetime import datetime
from io import BytesIO
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends
from openpyxl import Workbook
from openpyxl.styles import PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, inch
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from starlette.responses import StreamingResponse

from app.core.report_helpers import (
    auto_column_width,
    create_header_footer,
    create_pie_chart,
    create_status_table,
    style_excel_header,
)
from dependencies import get_db, verify_api_key
from routers.security import get_compliance_summary

router = APIRouter(tags=["Reports"])

def create_pdf_styles():
    """Create custom styles for PDF reports"""
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='ReportTitle',
        parent=styles['Heading1'],
        fontSize=24,
        spaceAfter=30,
        textColor=colors.HexColor('#1a1a2e')
    ))
    styles.add(ParagraphStyle(
        name='SectionTitle',
        parent=styles['Heading2'],
        fontSize=16,
        spaceAfter=12,
        spaceBefore=20,
        textColor=colors.HexColor('#16213e')
    ))
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading3'],
        fontSize=12,
        spaceAfter=8,
        textColor=colors.HexColor('#0f3460')
    ))
    return styles





@router.get("/api/v1/export/nodes", dependencies=[Depends(verify_api_key)])
async def export_nodes(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export all nodes as CSV or JSON"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                node_id, hostname, os_name, os_version, os_build,
                agent_version, first_seen, last_seen
            FROM nodes
            ORDER BY hostname
        """)
        
        data = [
            {
                "node_id": str(row["node_id"]),
                "hostname": row["hostname"],
                "os_name": row["os_name"],
                "os_version": row["os_version"],
                "os_build": row["os_build"],
                "agent_version": row["agent_version"],
                "first_seen": row["first_seen"].isoformat() if row["first_seen"] else None,
                "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
            }
            for row in rows
        ]
        
        if format == "csv":
            output = io.StringIO()
            if data:
                writer = csv.DictWriter(output, fieldnames=data[0].keys())
                writer.writeheader()
                writer.writerows(data)
            
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=nodes.csv"}
            )
        else:
            return data


@router.get("/api/v1/export/software", dependencies=[Depends(verify_api_key)])
async def export_software(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export all software as CSV or JSON"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.hostname,
                s.data->'installedPrograms' as programs
            FROM nodes n
            LEFT JOIN inventory_software s ON n.node_id = s.node_id
            WHERE s.data IS NOT NULL
        """)
        
        data = []
        for row in rows:
            programs = row["programs"] or []
            if isinstance(programs, str):
                import json
                programs = json.loads(programs)
            
            for prog in programs:
                data.append({
                    "hostname": row["hostname"],
                    "name": prog.get("name"),
                    "version": prog.get("version"),
                    "publisher": prog.get("publisher")
                })
        
        if format == "csv":
            output = io.StringIO()
            if data:
                writer = csv.DictWriter(output, fieldnames=["hostname", "name", "version", "publisher"])
                writer.writeheader()
                writer.writerows(data)
            
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=software.csv"}
            )
        else:
            return data


@router.get("/api/v1/export/compliance", dependencies=[Depends(verify_api_key)])
async def export_compliance(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export compliance data as CSV or JSON"""
    summary = await get_compliance_summary(db)
    data = summary["nodes"]
    
    if format == "csv":
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=compliance.csv"}
        )
    else:
        return data
    return {"status": "checked"}


@router.get("/api/v1/export/nodes/excel", dependencies=[Depends(verify_api_key)])
async def export_nodes_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all nodes to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, n.hostname, n.domain, n.os_name, n.os_version, n.agent_version,
                   n.last_seen, n.is_online,
                   h.cpu->>'Name' as cpu_name,
                   (h.cpu->>'Cores')::int as cpu_cores,
                   (h.ram->>'TotalGB')::numeric as ram_total_gb,
                   h.mainboard->>'Manufacturer' as manufacturer,
                   h.mainboard->>'Product' as model,
                   h.bios->>'SerialNumber' as serial_number
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Nodes"
    
    # Headers
    headers = ["ID", "Hostname", "Domain", "OS", "OS Version", "Agent Version", "Last Seen", 
               "Online", "CPU", "Cores", "RAM (GB)",
               "Manufacturer", "Model", "Serial Number"]
    ws.append(headers)
    style_excel_header(ws)
    
    # Data
    for row in rows:
        ws.append([
            str(row["id"]), row["hostname"], row["domain"], row["os_name"], row["os_version"],
            row["agent_version"], row["last_seen"].isoformat() if row["last_seen"] else None,
            "Yes" if row["is_online"] else "No",
            row["cpu_name"], row["cpu_cores"], 
            round(float(row["ram_total_gb"]), 1) if row["ram_total_gb"] else None,
            row["manufacturer"], row["model"], row["serial_number"]
        ])
    
    auto_column_width(ws)
    
    # Save to BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_nodes_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/export/software/excel", dependencies=[Depends(verify_api_key)])
async def export_software_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all installed software to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.hostname, s.name, s.version, s.publisher, s.install_date, s.install_path
            FROM software_current s
            JOIN nodes n ON n.id = s.node_id
            ORDER BY n.hostname, s.name
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Software"
    
    headers = ["Hostname", "Software Name", "Version", "Publisher", "Install Date", "Install Location"]
    ws.append(headers)
    style_excel_header(ws)
    
    for row in rows:
        ws.append([row["hostname"], row["name"], row["version"], row["publisher"],
                   row["install_date"].isoformat() if row["install_date"] else None, 
                   row["install_path"]])
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_software_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/export/vulnerabilities/excel", dependencies=[Depends(verify_api_key)])
async def export_vulnerabilities_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all vulnerabilities with affected nodes to Excel."""
    async with db.acquire() as conn:
        # Get vulnerabilities with affected node count
        rows = await conn.fetch("""
            SELECT v.cve_id, v.software_name, v.software_version,
                   v.severity, v.cvss_score, v.description, v.published_date,
                   (SELECT COUNT(DISTINCT s.node_id) 
                    FROM software_current s 
                    WHERE s.name ILIKE v.software_name 
                    AND s.version = v.software_version) as affected_nodes,
                   (SELECT STRING_AGG(DISTINCT n.hostname, ', ' ORDER BY n.hostname)
                    FROM software_current s 
                    JOIN nodes n ON n.id = s.node_id
                    WHERE s.name ILIKE v.software_name 
                    AND s.version = v.software_version
                    LIMIT 5) as node_list
            FROM vulnerabilities v
            ORDER BY v.cvss_score DESC NULLS LAST, v.software_name
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Vulnerabilities"
    
    headers = ["CVE ID", "Software", "Version", "Severity", "CVSS Score",
               "Affected Nodes", "Nodes (first 5)", "Published", "Description"]
    ws.append(headers)
    style_excel_header(ws)
    
    # Color coding for severity
    severity_colors = {
        "CRITICAL": "FF0000",
        "HIGH": "FF6600", 
        "MEDIUM": "FFCC00",
        "LOW": "00CC00"
    }
    
    for i, row in enumerate(rows, start=2):
        ws.append([row["cve_id"], row["software_name"], row["software_version"],
                   row["severity"], float(row["cvss_score"]) if row["cvss_score"] else None,
                   row["affected_nodes"], row["node_list"],
                   row["published_date"].isoformat() if row["published_date"] else None,
                   row["description"][:200] if row["description"] else None])
        
        # Color the severity cell
        if row["severity"] in severity_colors:
            ws.cell(row=i, column=4).fill = PatternFill(
                start_color=severity_colors[row["severity"]], 
                end_color=severity_colors[row["severity"]], 
                fill_type="solid"
            )
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_vulnerabilities_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/export/jobs/excel", dependencies=[Depends(verify_api_key)])
async def export_jobs_excel(
    days: int = 30,
    db: asyncpg.Pool = Depends(get_db)
):
    """Export job history to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT j.id, j.name, j.command_type, j.created_at, j.created_by,
                   ji.node_id as target_node, ji.status, ji.queued_at, ji.started_at, ji.completed_at,
                   ji.exit_code, ji.error_message, ji.duration_ms
            FROM jobs j
            LEFT JOIN job_instances ji ON ji.job_id = j.id
            WHERE j.created_at > NOW() - INTERVAL '1 day' * $1
            ORDER BY j.created_at DESC
        """, days)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Jobs"
    
    headers = ["Job ID", "Name", "Type", "Created By", "Target Node", "Status", 
               "Queued", "Started", "Completed", "Duration (ms)", "Exit Code", "Error"]
    ws.append(headers)
    style_excel_header(ws)
    
    status_colors = {
        "completed": "00CC00",
        "failed": "FF0000",
        "running": "0066FF",
        "pending": "CCCCCC"
    }
    
    for i, row in enumerate(rows, start=2):
        ws.append([
            str(row["id"])[:8], row["name"], row["command_type"], row["created_by"],
            row["target_node"], row["status"],
            row["queued_at"].isoformat() if row["queued_at"] else None,
            row["started_at"].isoformat() if row["started_at"] else None,
            row["completed_at"].isoformat() if row["completed_at"] else None,
            row["duration_ms"], row["exit_code"],
            row["error_message"][:100] if row["error_message"] else None
        ])
        
        if row["status"] in status_colors:
            ws.cell(row=i, column=6).fill = PatternFill(
                start_color=status_colors[row["status"]], 
                end_color=status_colors[row["status"]], 
                fill_type="solid"
            )
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_jobs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/reports/fleet/pdf", dependencies=[Depends(verify_api_key)])
async def generate_fleet_summary_pdf(db: asyncpg.Pool = Depends(get_db)):
    """E19-05: Generate Fleet Summary PDF Report"""
    
    # Fetch data - join nodes with v_nodes_overview for all columns
    nodes = await db.fetch("""
        SELECT n.hostname, n.os_name, n.agent_version, n.is_online, n.last_seen,
               v.cpu_name, v.ram_gb
        FROM nodes n
        LEFT JOIN v_nodes_overview v ON n.id = v.id
        ORDER BY n.hostname
    """)
    
    # Online/Offline stats (no health_status in schema, use online status)
    online_stats = await db.fetch("""
        SELECT is_online, COUNT(*) as count
        FROM nodes GROUP BY is_online
    """)
    
    # Performance summary (last 24h averages) from node_metrics
    perf_stats = await db.fetchrow("""
        SELECT 
            ROUND(AVG(cpu_percent)::numeric, 1) as avg_cpu,
            ROUND(AVG(ram_percent)::numeric, 1) as avg_memory,
            ROUND(AVG(disk_percent)::numeric, 1) as avg_disk
        FROM node_metrics
        WHERE time > NOW() - INTERVAL '24 hours'
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, 
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph("Fleet Summary Report", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Overview Section
    story.append(Paragraph("Fleet Overview", styles['SectionTitle']))
    
    total_nodes = len(nodes)
    online_nodes = sum(1 for n in nodes if n['is_online'])
    
    overview_data = [
        ["Metric", "Value"],
        ["Total Nodes", str(total_nodes)],
        ["Online Nodes", f"{online_nodes} ({round(online_nodes/total_nodes*100) if total_nodes else 0}%)"],
        ["Offline Nodes", f"{total_nodes - online_nodes}"],
        ["Agent Versions", ", ".join(set(n['agent_version'] for n in nodes if n['agent_version'])) or "-"],
    ]
    story.append(create_status_table(overview_data, [150, 300]))
    story.append(Spacer(1, 20))
    
    # Performance Section
    story.append(Paragraph("Performance Summary (24h Average)", styles['SectionTitle']))
    
    perf_data = [
        ["Metric", "Average"],
        ["CPU Usage", f"{perf_stats['avg_cpu'] or 0}%"],
        ["Memory Usage", f"{perf_stats['avg_memory'] or 0}%"],
        ["Disk Usage", f"{perf_stats['avg_disk'] or 0}%"],
    ]
    story.append(create_status_table(perf_data, [150, 150]))
    story.append(Spacer(1, 20))
    
    # Online Status Distribution
    story.append(Paragraph("Status Distribution", styles['SectionTitle']))
    
    status_data = [["Status", "Count"]]
    for s in online_stats:
        status_label = "Online" if s['is_online'] else "Offline"
        status_data.append([status_label, str(s['count'])])
    story.append(create_status_table(status_data, [150, 100]))
    story.append(Spacer(1, 20))
    
    # Node List
    story.append(Paragraph("Node Inventory", styles['SectionTitle']))
    
    node_data = [["Hostname", "OS", "Version", "Status", "CPU"]]
    for n in nodes:
        os_short = (n['os_name'] or '-')[:30]
        cpu_short = (n['cpu_name'] or '-')[:25] if n.get('cpu_name') else '-'
        node_data.append([
            n['hostname'],
            os_short,
            n['agent_version'] or '-',
            "Online" if n['is_online'] else "Offline",
            cpu_short
        ])
    story.append(create_status_table(node_data, [90, 140, 50, 55, 100]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Fleet Summary"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Fleet Summary"))
    
    buffer.seek(0)
    filename = f"octofleet_fleet_summary_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/reports/security/pdf", dependencies=[Depends(verify_api_key)])
async def generate_security_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """E19-06: Generate Security Report PDF (CVEs, Compliance)"""
    
    # Fetch vulnerability data
    vulns = await db.fetch("""
        SELECT v.cve_id, v.severity, v.cvss_score, v.description,
               v.software_name, v.software_version,
               (SELECT COUNT(DISTINCT s.node_id) FROM software_current s 
                WHERE s.name = v.software_name AND s.version = v.software_version) as affected_nodes
        FROM vulnerabilities v
        ORDER BY v.cvss_score DESC NULLS LAST
        LIMIT 50
    """)
    
    # Severity distribution
    severity_stats = await db.fetch("""
        SELECT severity, COUNT(*) as count
        FROM vulnerabilities
        GROUP BY severity
        ORDER BY CASE severity 
            WHEN 'critical' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            WHEN 'low' THEN 4 
            ELSE 5 END
    """)
    
    # Nodes with vulnerabilities (via software match)
    node_vulns = await db.fetch("""
        SELECT n.hostname,
               COUNT(DISTINCT v.id) as vuln_count,
               SUM(CASE WHEN v.severity = 'critical' THEN 1 ELSE 0 END) as critical_count
        FROM nodes n
        JOIN software_current s ON s.node_id = n.id
        JOIN vulnerabilities v ON v.software_name = s.name AND v.software_version = s.version
        GROUP BY n.id, n.hostname
        HAVING COUNT(DISTINCT v.id) > 0
        ORDER BY critical_count DESC, vuln_count DESC
        LIMIT 20
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph("Security Report", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Summary
    story.append(Paragraph("Vulnerability Summary", styles['SectionTitle']))
    
    total_vulns = sum(s['count'] for s in severity_stats)
    critical = next((s['count'] for s in severity_stats if s['severity'] == 'critical'), 0)
    high = next((s['count'] for s in severity_stats if s['severity'] == 'high'), 0)
    
    summary_data = [
        ["Metric", "Value"],
        ["Total Vulnerabilities", str(total_vulns)],
        ["Critical", str(critical)],
        ["High", str(high)],
        ["Affected Nodes", str(len(node_vulns))],
    ]
    story.append(create_status_table(summary_data, [150, 150]))
    story.append(Spacer(1, 20))
    
    # Severity Distribution
    story.append(Paragraph("Severity Distribution", styles['SectionTitle']))
    sev_data = [["Severity", "Count", "Percentage"]]
    for s in severity_stats:
        pct = round(s['count'] / total_vulns * 100, 1) if total_vulns else 0
        sev_data.append([s['severity'].title(), str(s['count']), f"{pct}%"])
    story.append(create_status_table(sev_data, [100, 80, 80]))
    story.append(Spacer(1, 20))
    
    # Most Affected Nodes
    story.append(Paragraph("Most Affected Nodes", styles['SectionTitle']))
    node_data = [["Hostname", "Total CVEs", "Critical"]]
    for n in node_vulns[:10]:
        node_data.append([n['hostname'], str(n['vuln_count']), str(n['critical_count'])])
    story.append(create_status_table(node_data, [150, 80, 80]))
    story.append(Spacer(1, 20))
    
    # Top Vulnerabilities
    story.append(Paragraph("Top Vulnerabilities by CVSS Score", styles['SectionTitle']))
    vuln_data = [["CVE ID", "Severity", "CVSS", "Affected"]]
    for v in vulns[:15]:
        vuln_data.append([
            v['cve_id'],
            (v['severity'] or '-').title(),
            str(v['cvss_score'] or '-'),
            str(v['affected_nodes'])
        ])
    story.append(create_status_table(vuln_data, [120, 80, 60, 60]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Security Report"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Security Report"))
    
    buffer.seek(0)
    filename = f"octofleet_security_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/reports/inventory/pdf", dependencies=[Depends(verify_api_key)])
async def generate_inventory_report_pdf(
    node_id: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """E19-07: Generate Inventory Report PDF (Hardware, Software)"""
    
    # Determine scope - join nodes with v_nodes_overview for cpu_name
    if node_id:
        nodes = await db.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.agent_version, n.is_online, 
                   v.cpu_name, v.ram_gb 
            FROM nodes n
            LEFT JOIN v_nodes_overview v ON n.id = v.id
            WHERE n.id::text = $1 OR n.node_id = $1
        """, node_id)
        title_suffix = f" - {nodes[0]['hostname']}" if nodes else ""
    else:
        nodes = await db.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.agent_version, n.is_online, 
                   v.cpu_name, v.ram_gb 
            FROM nodes n
            LEFT JOIN v_nodes_overview v ON n.id = v.id
            ORDER BY n.hostname
        """)
        title_suffix = " - All Nodes"
    
    # Software inventory
    if node_id:
        software = await db.fetch("""
            SELECT name, version, publisher, install_date,
                   COUNT(*) as install_count
            FROM software_current
            WHERE node_id = (SELECT id FROM nodes WHERE id::text = $1 OR node_id = $1 LIMIT 1)
            GROUP BY name, version, publisher, install_date
            ORDER BY name
            LIMIT 100
        """, node_id)
    else:
        software = await db.fetch("""
            SELECT name, version, publisher,
                   COUNT(DISTINCT node_id) as install_count
            FROM software_current
            GROUP BY name, version, publisher
            ORDER BY install_count DESC, name
            LIMIT 100
        """)
    
    # Hardware summary - use v_nodes_overview
    hw_summary = await db.fetch("""
        SELECT 
            cpu_name,
            COUNT(*) as count
        FROM v_nodes_overview
        WHERE cpu_name IS NOT NULL
        GROUP BY cpu_name
        ORDER BY count DESC
        LIMIT 10
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph(f"Inventory Report{title_suffix}", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Node Hardware
    story.append(Paragraph("Hardware Inventory", styles['SectionTitle']))
    
    node_data = [["Hostname", "OS", "CPU", "Agent"]]
    for n in nodes:
        os_short = (n['os_name'] or '-')[:25]
        cpu_short = (n['cpu_name'] or '-')[:30]
        node_data.append([
            n['hostname'],
            os_short,
            cpu_short,
            n['agent_version'] or '-'
        ])
    story.append(create_status_table(node_data, [90, 130, 180, 50]))
    story.append(Spacer(1, 20))
    
    # CPU Distribution
    if hw_summary:
        story.append(Paragraph("CPU Distribution", styles['SectionTitle']))
        cpu_data = [["CPU Model", "Count"]]
        for hw in hw_summary:
            cpu_short = (hw['cpu_name'] or '-')[:50]
            cpu_data.append([cpu_short, str(hw['count'])])
        story.append(create_status_table(cpu_data, [350, 60]))
        story.append(Spacer(1, 20))
    
    # Software Inventory
    story.append(Paragraph("Software Inventory", styles['SectionTitle']))
    
    sw_data = [["Software", "Version", "Publisher", "Installs"]]
    for s in software[:50]:
        sw_data.append([
            (s['name'] or '-')[:35],
            (s['version'] or '-')[:15],
            (s['publisher'] or '-')[:20],
            str(s['install_count'])
        ])
    story.append(create_status_table(sw_data, [180, 80, 120, 50]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Inventory Report"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Inventory Report"))
    
    buffer.seek(0)
    filename = f"octofleet_inventory_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


