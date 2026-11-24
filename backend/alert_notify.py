"""E19 alert rules: notify the channels of the enabled rules for an event (node offline, job failed, ...).

Used by main.py (node status monitor) and routers/jobs.py (failed job results).
"""
import json
from datetime import datetime, timedelta

import aiohttp


async def send_discord_webhook(webhook_url: str, embed: dict) -> bool:
    """Send a Discord webhook message."""
    try:
        async with aiohttp.ClientSession() as session:
            payload = {"embeds": [embed]}
            async with session.post(webhook_url, json=payload) as resp:
                return resp.status in (200, 204)
    except Exception as e:
        print(f"Discord webhook error: {e}")
        return False

async def trigger_alert(pool, event_type: str, event_data: dict):
    """Check alert rules and send notifications."""
    async with pool.acquire() as conn:
        # Find matching enabled rules
        rules = await conn.fetch("""
            SELECT r.*, c.channel_type, c.config, c.name as channel_name
            FROM alert_rules r
            JOIN alert_channels c ON r.channel_id = c.id
            WHERE r.event_type = $1 
            AND r.enabled = true 
            AND c.enabled = true
        """, event_type)
        
        for rule in rules:
            # Check cooldown
            last_alert = await conn.fetchval("""
                SELECT created_at FROM alert_history
                WHERE rule_id = $1 AND status = 'sent'
                ORDER BY created_at DESC LIMIT 1
            """, rule['id'])
            
            if last_alert:
                cooldown = timedelta(minutes=rule['cooldown_minutes'])
                if datetime.utcnow().replace(tzinfo=None) - last_alert.replace(tzinfo=None) < cooldown:
                    # Throttled
                    await conn.execute("""
                        INSERT INTO alert_history (rule_id, channel_id, event_type, event_data, status)
                        VALUES ($1, $2, $3, $4, 'throttled')
                    """, rule['id'], rule['channel_id'], event_type, json.dumps(event_data))
                    continue
            
            # Send alert based on channel type
            success = False
            error_msg = None
            
            if rule['channel_type'] == 'discord':
                webhook_url = rule['config'].get('webhook_url')
                if webhook_url:
                    # Build Discord embed
                    color = {
                        'node_offline': 0xFF0000,  # Red
                        'node_online': 0x00FF00,   # Green
                        'job_failed': 0xFF6600,    # Orange
                        'job_success': 0x00FF00,   # Green
                        'disk_warning': 0xFFFF00,  # Yellow
                        'vulnerability_critical': 0xFF0000,  # Red
                    }.get(event_type, 0x0099FF)
                    
                    embed = {
                        "title": f"🔔 {event_type.replace('_', ' ').title()}",
                        "description": event_data.get('message', str(event_data)),
                        "color": color,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "footer": {"text": "Octofleet Inventory"},
                        "fields": []
                    }
                    
                    # Add fields from event_data
                    for key, value in event_data.items():
                        if key != 'message' and value:
                            embed["fields"].append({
                                "name": key.replace('_', ' ').title(),
                                "value": str(value)[:1024],
                                "inline": True
                            })
                    
                    success = await send_discord_webhook(webhook_url, embed)
                    if not success:
                        error_msg = "Webhook request failed"
            
            # Log alert
            await conn.execute("""
                INSERT INTO alert_history (rule_id, channel_id, event_type, event_data, status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, rule['id'], rule['channel_id'], event_type, json.dumps(event_data),
                'sent' if success else 'failed', error_msg)
