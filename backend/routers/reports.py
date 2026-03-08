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


@router.get("/api/v1/reports/fleet/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_fleet_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a comprehensive Fleet Summary PDF report."""
    async with db.acquire() as conn:
        # Get node counts
        node_counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as online,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '60 minutes' 
                                   AND last_seen <= NOW() - INTERVAL '5 minutes') as away,
                COUNT(*) FILTER (WHERE last_seen <= NOW() - INTERVAL '60 minutes' 
                                   OR last_seen IS NULL) as offline
            FROM nodes
        """)
        
        # Get OS distribution
        os_dist = await conn.fetch("""
            SELECT COALESCE(os_name, 'Unknown') as os_name, COUNT(*) as count
            FROM nodes
            GROUP BY os_name
            ORDER BY count DESC
            LIMIT 10
        """)
        
        # Get all nodes with details
        nodes = await conn.fetch("""
            SELECT n.hostname, n.os_name, n.os_version, n.agent_version,
                   n.last_seen, n.is_online,
                   h.cpu->>'Name' as cpu_name,
                   (h.ram->>'TotalGB')::numeric as ram_gb
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
        
        # Get job stats (last 7 days)
        job_stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'success') as success,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
            FROM job_instances
            WHERE created_at > NOW() - INTERVAL '7 days'
        """)
        
        # Get health distribution
        health_dist = await conn.fetch("""
            SELECT COALESCE(health_status, 'unknown') as status, COUNT(*) as count
            FROM nodes
            GROUP BY health_status
        """)
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#1e3a5f'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=16, spaceBefore=20, spaceAfter=10, textColor=colors.HexColor('#1e3a5f'))
    normal_style = styles['Normal']
    
    elements = []
    
    # Title
    elements.append(Paragraph("🐙 Octofleet Fleet Summary Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", normal_style))
    elements.append(Spacer(1, 20))
    
    # Executive Summary
    elements.append(Paragraph("Executive Summary", heading_style))
    summary_data = [
        ["Total Nodes", str(node_counts["total"])],
        ["Online", str(node_counts["online"])],
        ["Away", str(node_counts["away"])],
        ["Offline", str(node_counts["offline"])],
        ["Jobs (7 days)", str(job_stats["total"] if job_stats else 0)],
        ["Success Rate", f"{(job_stats['success'] / job_stats['total'] * 100):.1f}%" if job_stats and job_stats["total"] > 0 else "N/A"]
    ]
    summary_table = Table(summary_data, colWidths=[3*inch, 2*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f4f8')),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 20))
    
    # Status Chart
    try:
        status_chart = create_pie_chart(
            {"Online": node_counts["online"], "Away": node_counts["away"], "Offline": node_counts["offline"]},
            "Node Status Distribution",
            "fleet_status_chart.png"
        )
        elements.append(Image(status_chart, width=3*inch, height=3*inch))
        elements.append(Spacer(1, 20))
    except Exception as e:
        elements.append(Paragraph(f"Chart generation failed: {str(e)}", normal_style))
    
    # OS Distribution
    elements.append(Paragraph("Operating System Distribution", heading_style))
    os_data = [["Operating System", "Count"]]
    for row in os_dist:
        os_data.append([row["os_name"] or "Unknown", str(row["count"])])
    
    os_table = Table(os_data, colWidths=[4*inch, 1.5*inch])
    os_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(os_table)
    elements.append(Spacer(1, 20))
    
    # Node Details Table
    elements.append(PageBreak())
    elements.append(Paragraph("Node Inventory", heading_style))
    
    node_data = [["Hostname", "OS", "Version", "Agent", "Status", "Last Seen"]]
    for node in nodes[:50]:  # Limit to 50 for PDF size
        status = "🟢" if node["is_online"] else "🔴"
        last_seen = node["last_seen"].strftime("%Y-%m-%d %H:%M") if node["last_seen"] else "Never"
        node_data.append([
            node["hostname"] or "N/A",
            (node["os_name"] or "Unknown")[:30],
            (node["os_version"] or "-")[:15],
            node["agent_version"] or "-",
            status,
            last_seen
        ])
    
    node_table = Table(node_data, colWidths=[1.3*inch, 1.8*inch, 0.9*inch, 0.6*inch, 0.5*inch, 1.2*inch])
    node_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('PADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('ALIGN', (4, 0), (4, -1), 'CENTER'),
    ]))
    elements.append(node_table)
    
    # Footer note
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"Report generated by Octofleet v0.5.0 • {len(nodes)} total nodes", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    # Cleanup temp files
    import os
    for f in ["/tmp/fleet_status_chart.png"]:
        try:
            os.remove(f)
        except:
            pass
    
    filename = f"octofleet_fleet_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/reports/security/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_security_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a Security & Compliance PDF report."""
    async with db.acquire() as conn:
        # Get vulnerability summary
        vuln_summary = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical,
                COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
                COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium,
                COUNT(*) FILTER (WHERE severity = 'LOW') as low
            FROM vulnerabilities
        """)
        
        # Get top CVEs by affected nodes
        top_cves = await conn.fetch("""
            SELECT v.cve_id, v.severity, v.cvss_score, v.software_name,
                   COUNT(DISTINCT na.node_id) as affected_nodes
            FROM vulnerabilities v
            LEFT JOIN node_vulnerabilities na ON na.vulnerability_id = v.id
            GROUP BY v.id, v.cve_id, v.severity, v.cvss_score, v.software_name
            ORDER BY 
                CASE v.severity 
                    WHEN 'CRITICAL' THEN 1 
                    WHEN 'HIGH' THEN 2 
                    WHEN 'MEDIUM' THEN 3 
                    ELSE 4 
                END,
                affected_nodes DESC
            LIMIT 20
        """)
        
        # Get nodes with most vulnerabilities
        vuln_by_node = await conn.fetch("""
            SELECT n.hostname, 
                   COUNT(*) FILTER (WHERE v.severity = 'CRITICAL') as critical,
                   COUNT(*) FILTER (WHERE v.severity = 'HIGH') as high,
                   COUNT(*) FILTER (WHERE v.severity = 'MEDIUM') as medium,
                   COUNT(*) as total
            FROM nodes n
            JOIN node_vulnerabilities nv ON nv.node_id = n.id
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            GROUP BY n.id, n.hostname
            ORDER BY critical DESC, high DESC, total DESC
            LIMIT 15
        """)
        
        # Get compliance status (security settings)
        security_stats = await conn.fetch("""
            SELECT 
                (s.data->>'firewallEnabled')::boolean as firewall_enabled,
                (s.data->>'antivirusEnabled')::boolean as antivirus_enabled,
                (s.data->>'autoUpdateEnabled')::boolean as auto_update,
                COUNT(*) as count
            FROM security_current s
            GROUP BY firewall_enabled, antivirus_enabled, auto_update
        """)
        
        # Calculate compliance metrics
        total_with_security = sum(r["count"] for r in security_stats) if security_stats else 0
        firewall_enabled = sum(r["count"] for r in security_stats if r["firewall_enabled"]) if security_stats else 0
        av_enabled = sum(r["count"] for r in security_stats if r["antivirus_enabled"]) if security_stats else 0
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#dc2626'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=16, spaceBefore=20, spaceAfter=10, textColor=colors.HexColor('#1e3a5f'))
    normal_style = styles['Normal']
    
    elements = []
    
    # Title
    elements.append(Paragraph("🛡️ Octofleet Security Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", normal_style))
    elements.append(Spacer(1, 20))
    
    # Risk Summary
    elements.append(Paragraph("Vulnerability Summary", heading_style))
    
    risk_data = [
        ["Severity", "Count", "Risk Level"],
        ["🔴 Critical", str(vuln_summary["critical"] if vuln_summary else 0), "Immediate Action Required"],
        ["🟠 High", str(vuln_summary["high"] if vuln_summary else 0), "Action Required"],
        ["🟡 Medium", str(vuln_summary["medium"] if vuln_summary else 0), "Plan Remediation"],
        ["🟢 Low", str(vuln_summary["low"] if vuln_summary else 0), "Monitor"],
        ["Total", str(vuln_summary["total"] if vuln_summary else 0), ""]
    ]
    
    risk_table = Table(risk_data, colWidths=[1.5*inch, 1*inch, 3*inch])
    risk_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#fef2f2')),  # Critical row
        ('BACKGROUND', (0, 2), (-1, 2), colors.HexColor('#fff7ed')),  # High row
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f0f4f8')),  # Total row
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(risk_table)
    elements.append(Spacer(1, 20))
    
    # Vulnerability Chart
    try:
        vuln_chart = create_pie_chart(
            {
                "Critical": vuln_summary["critical"] if vuln_summary else 0,
                "High": vuln_summary["high"] if vuln_summary else 0,
                "Medium": vuln_summary["medium"] if vuln_summary else 0,
                "Low": vuln_summary["low"] if vuln_summary else 0
            },
            "Vulnerabilities by Severity",
            "security_vuln_chart.png"
        )
        elements.append(Image(vuln_chart, width=3*inch, height=3*inch))
        elements.append(Spacer(1, 20))
    except Exception:
        pass
    
    # Top CVEs Table
    elements.append(Paragraph("Top Vulnerabilities", heading_style))
    cve_data = [["CVE ID", "Software", "Severity", "CVSS", "Affected"]]
    for cve in top_cves:
        severity_color = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(cve["severity"], "⚪")
        cve_data.append([
            cve["cve_id"],
            (cve["software_name"] or "-")[:25],
            f"{severity_color} {cve['severity']}",
            f"{cve['cvss_score']:.1f}" if cve["cvss_score"] else "-",
            str(cve["affected_nodes"])
        ])
    
    cve_table = Table(cve_data, colWidths=[1.5*inch, 1.8*inch, 1.2*inch, 0.6*inch, 0.8*inch])
    cve_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('PADDING', (0, 0), (-1, -1), 5),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(cve_table)
    
    # Nodes at Risk
    elements.append(PageBreak())
    elements.append(Paragraph("Nodes at Risk", heading_style))
    
    node_risk_data = [["Hostname", "Critical", "High", "Medium", "Total"]]
    for node in vuln_by_node:
        node_risk_data.append([
            node["hostname"],
            str(node["critical"]),
            str(node["high"]),
            str(node["medium"]),
            str(node["total"])
        ])
    
    node_risk_table = Table(node_risk_data, colWidths=[2*inch, 1*inch, 1*inch, 1*inch, 1*inch])
    node_risk_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ]))
    elements.append(node_risk_table)
    elements.append(Spacer(1, 20))
    
    # Compliance Overview
    elements.append(Paragraph("Compliance Overview", heading_style))
    compliance_data = [
        ["Security Control", "Compliant", "Percentage"],
        ["Firewall Enabled", str(firewall_enabled), f"{firewall_enabled/total_with_security*100:.1f}%" if total_with_security > 0 else "N/A"],
        ["Antivirus Active", str(av_enabled), f"{av_enabled/total_with_security*100:.1f}%" if total_with_security > 0 else "N/A"],
    ]
    
    compliance_table = Table(compliance_data, colWidths=[2.5*inch, 1.5*inch, 1.5*inch])
    compliance_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
    ]))
    elements.append(compliance_table)
    
    # Footer
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"Report generated by Octofleet v0.5.0 • Security assessment as of {datetime.utcnow().strftime('%Y-%m-%d')}", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    # Cleanup
    import os
    for f in ["/tmp/security_vuln_chart.png"]:
        try:
            os.remove(f)
        except:
            pass
    
    filename = f"octofleet_security_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/api/v1/reports/inventory/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_inventory_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a detailed Hardware Inventory PDF report."""
    async with db.acquire() as conn:
        # Get all nodes with hardware details
        nodes = await conn.fetch("""
            SELECT n.hostname, n.os_name, n.os_version, n.domain,
                   h.cpu->>'Name' as cpu_name,
                   (h.cpu->>'Cores')::int as cpu_cores,
                   (h.cpu->>'Threads')::int as cpu_threads,
                   (h.ram->>'TotalGB')::numeric as ram_gb,
                   h.mainboard->>'Manufacturer' as mb_manufacturer,
                   h.mainboard->>'Product' as mb_product,
                   h.bios->>'SerialNumber' as serial,
                   h.bios->>'Manufacturer' as bios_manufacturer,
                   h.bios->>'Version' as bios_version
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
        
        # Get disk summary
        disk_stats = await conn.fetch("""
            SELECT n.hostname,
                   d.model, d.media_type, 
                   (d.size_bytes / 1073741824.0)::numeric as size_gb
            FROM physical_disks d
            JOIN nodes n ON n.id = d.node_id
            ORDER BY n.hostname, d.model
        """)
        
        # CPU distribution
        cpu_dist = await conn.fetch("""
            SELECT h.cpu->>'Name' as cpu_name, COUNT(*) as count
            FROM hardware_current h
            WHERE h.cpu->>'Name' IS NOT NULL
            GROUP BY h.cpu->>'Name'
            ORDER BY count DESC
            LIMIT 10
        """)
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#1e3a5f'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=14, spaceBefore=15, spaceAfter=8, textColor=colors.HexColor('#1e3a5f'))
    
    elements = []
    
    # Title
    elements.append(Paragraph("📦 Octofleet Hardware Inventory Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} • {len(nodes)} systems", styles['Normal']))
    elements.append(Spacer(1, 15))
    
    # Hardware Summary Table
    elements.append(Paragraph("System Inventory", heading_style))
    
    hw_data = [["Hostname", "OS", "CPU", "Cores", "RAM (GB)", "Manufacturer", "Serial"]]
    for node in nodes[:40]:  # Limit for PDF
        hw_data.append([
            (node["hostname"] or "N/A")[:20],
            (node["os_name"] or "Unknown")[:25],
            (node["cpu_name"] or "-")[:35],
            str(node["cpu_cores"]) if node["cpu_cores"] else "-",
            f"{node['ram_gb']:.1f}" if node["ram_gb"] else "-",
            (node["mb_manufacturer"] or "-")[:20],
            (node["serial"] or "-")[:20]
        ])
    
    hw_table = Table(hw_data, colWidths=[1.2*inch, 1.6*inch, 2.2*inch, 0.5*inch, 0.7*inch, 1.3*inch, 1.3*inch])
    hw_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('PADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(hw_table)
    
    # CPU Distribution
    if cpu_dist:
        elements.append(PageBreak())
        elements.append(Paragraph("CPU Distribution", heading_style))
        cpu_data = [["CPU Model", "Count"]]
        for cpu in cpu_dist:
            cpu_data.append([(cpu["cpu_name"] or "Unknown")[:50], str(cpu["count"])])
        
        cpu_table = Table(cpu_data, colWidths=[6*inch, 1*inch])
        cpu_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('PADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ]))
        elements.append(cpu_table)
    
    # Footer
    elements.append(Spacer(1, 30))
    elements.append(Paragraph("Report generated by Octofleet v0.5.0", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    filename = f"octofleet_inventory_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
