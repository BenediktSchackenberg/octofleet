"""
E7: Alerting & Notifications Module
Handles alert rules, notification channels, and webhook delivery
"""
import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import json
import logging

logger = logging.getLogger(__name__)


class AlertManager:
    """Manages alert rules and notification delivery"""
    
    def __init__(self, db_pool):
        self.db_pool = db_pool
        self._webhook_session: Optional[aiohttp.ClientSession] = None
    
    async def get_session(self) -> aiohttp.ClientSession:
        if self._webhook_session is None or self._webhook_session.closed:
            self._webhook_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
        return self._webhook_session
    
    async def close(self):
        if self._webhook_session and not self._webhook_session.closed:
            await self._webhook_session.close()
    
    async def fire_alert(
        self,
        event_type: str,
        title: str,
        message: str,
        severity: str = "warning",
        node_id: Optional[str] = None,
        node_name: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Optional[str]:
        """
        Fire an alert and send notifications to all configured channels.
        Returns the alert ID if created, None if suppressed by cooldown.
        """
        async with self.db_pool.acquire() as conn:
            # Find matching enabled rule
            rule = await conn.fetchrow("""
                SELECT id, name, cooldown_minutes, severity
                FROM alert_rules 
                WHERE event_type = $1 AND is_enabled = true
                LIMIT 1
            """, event_type)
            
            if not rule:
                # No rule configured for this event type, still create alert but no notifications
                logger.debug(f"No alert rule for event_type={event_type}")
            
            rule_id = rule["id"] if rule else None
            rule_name = rule["name"] if rule else event_type
            cooldown = rule["cooldown_minutes"] if rule else 60
            alert_severity = rule["severity"] if rule else severity
            
            # Check cooldown - don't fire same alert too often for same node
            if node_id and rule_id:
                recent = await conn.fetchval("""
                    SELECT id FROM alerts 
                    WHERE rule_id = $1 AND node_id = $2::uuid 
                    AND fired_at > NOW() - INTERVAL '1 minute' * $3
                    AND status != 'resolved'
                    LIMIT 1
                """, rule_id, node_id, cooldown)
                
                if recent:
                    logger.debug(f"Alert suppressed by cooldown: {title}")
                    return None
            
            # Create alert record
            node_uuid = None
            if node_id:
                # Resolve node_id to UUID if needed
                node_row = await conn.fetchrow(
                    "SELECT id, hostname FROM nodes WHERE id::text = $1 OR node_id = $1 LIMIT 1",
                    node_id
                )
                if node_row:
                    node_uuid = node_row["id"]
                    node_name = node_name or node_row["hostname"]
            
            alert_id = await conn.fetchval("""
                INSERT INTO alerts (rule_id, rule_name, event_type, severity, title, message, node_id, node_name, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            """, rule_id, rule_name, event_type, alert_severity, title, message, 
                node_uuid, node_name, json.dumps(metadata or {}))
            
            logger.info(f"Alert fired: {title} (severity={alert_severity}, id={alert_id})")
            
            # Get notification channels for this rule
            if rule_id:
                channels = await conn.fetch("""
                    SELECT nc.id, nc.name, nc.channel_type, nc.config
                    FROM notification_channels nc
                    JOIN alert_rule_channels arc ON nc.id = arc.channel_id
                    WHERE arc.rule_id = $1 AND nc.is_enabled = true
                """, rule_id)
            else:
                # No rule, send to all enabled channels
                channels = await conn.fetch("""
                    SELECT id, name, channel_type, config
                    FROM notification_channels
                    WHERE is_enabled = true
                """)
            
            # Send notifications
            for channel in channels:
                try:
                    await self._send_notification(
                        channel_type=channel["channel_type"],
                        config=json.loads(channel["config"]) if isinstance(channel["config"], str) else channel["config"],
                        title=title,
                        message=message,
                        severity=alert_severity,
                        node_name=node_name,
                        metadata=metadata
                    )
                except Exception as e:
                    logger.error(f"Failed to send notification to {channel['name']}: {e}")
            
            return str(alert_id)
    
    async def _send_notification(
        self,
        channel_type: str,
        config: Dict,
        title: str,
        message: str,
        severity: str,
        node_name: Optional[str] = None,
        metadata: Optional[Dict] = None
    ):
        """Send notification to a specific channel"""
        
        if channel_type == "discord":
            await self._send_discord(config, title, message, severity, node_name, metadata)
        elif channel_type == "slack":
            await self._send_slack(config, title, message, severity, node_name, metadata)
        elif channel_type == "teams":
            await self._send_teams(config, title, message, severity, node_name, metadata)
        elif channel_type == "webhook":
            await self._send_generic_webhook(config, title, message, severity, node_name, metadata)
        else:
            logger.warning(f"Unknown channel type: {channel_type}")
    
    async def _send_discord(
        self,
        config: Dict,
        title: str,
        message: str,
        severity: str,
        node_name: Optional[str],
        metadata: Optional[Dict]
    ):
        """Send Discord webhook notification"""
        webhook_url = config.get("webhook_url")
        if not webhook_url:
            raise ValueError("Discord webhook_url not configured")
        
        # Severity colors
        colors = {
            "critical": 0xFF0000,  # Red
            "warning": 0xFFA500,   # Orange
            "info": 0x0099FF       # Blue
        }
        
        # Severity emojis
        emojis = {
            "critical": "🚨",
            "warning": "⚠️",
            "info": "ℹ️"
        }
        
        embed = {
            "title": f"{emojis.get(severity, '📢')} {title}",
            "description": message,
            "color": colors.get(severity, 0x808080),
            "timestamp": datetime.utcnow().isoformat(),
            "footer": {"text": "Octofleet Inventory"},
            "fields": []
        }
        
        if node_name:
            embed["fields"].append({"name": "Node", "value": node_name, "inline": True})
        
        embed["fields"].append({"name": "Severity", "value": severity.upper(), "inline": True})
        
        if metadata:
            for key, value in list(metadata.items())[:3]:  # Max 3 extra fields
                if value is not None:
                    embed["fields"].append({"name": key, "value": str(value)[:100], "inline": True})
        
        payload = {"embeds": [embed]}
        
        session = await self.get_session()
        async with session.post(webhook_url, json=payload) as resp:
            if resp.status not in (200, 204):
                text = await resp.text()
                raise Exception(f"Discord webhook failed: {resp.status} - {text[:200]}")
    
    async def _send_slack(
        self,
        config: Dict,
        title: str,
        message: str,
        severity: str,
        node_name: Optional[str],
        metadata: Optional[Dict]
    ):
        """Send Slack webhook notification"""
        webhook_url = config.get("webhook_url")
        if not webhook_url:
            raise ValueError("Slack webhook_url not configured")
        
        colors = {"critical": "danger", "warning": "warning", "info": "good"}
        emojis = {"critical": ":rotating_light:", "warning": ":warning:", "info": ":information_source:"}
        
        attachment = {
            "color": colors.get(severity, ""),
            "title": f"{emojis.get(severity, '')} {title}",
            "text": message,
            "fields": [],
            "ts": int(datetime.utcnow().timestamp())
        }
        
        if node_name:
            attachment["fields"].append({"title": "Node", "value": node_name, "short": True})
        
        attachment["fields"].append({"title": "Severity", "value": severity.upper(), "short": True})
        
        payload = {"attachments": [attachment]}
        
        session = await self.get_session()
        async with session.post(webhook_url, json=payload) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise Exception(f"Slack webhook failed: {resp.status} - {text[:200]}")
    
    async def _send_teams(
        self,
        config: Dict,
        title: str,
        message: str,
        severity: str,
        node_name: Optional[str],
        metadata: Optional[Dict]
    ):
        """Send Microsoft Teams webhook notification"""
        webhook_url = config.get("webhook_url")
        if not webhook_url:
            raise ValueError("Teams webhook_url not configured")
        
        colors = {"critical": "FF0000", "warning": "FFA500", "info": "0099FF"}
        
        payload = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": colors.get(severity, "808080"),
            "summary": title,
            "sections": [{
                "activityTitle": title,
                "facts": [
                    {"name": "Severity", "value": severity.upper()},
                    {"name": "Message", "value": message}
                ],
                "markdown": True
            }]
        }
        
        if node_name:
            payload["sections"][0]["facts"].insert(0, {"name": "Node", "value": node_name})
        
        session = await self.get_session()
        async with session.post(webhook_url, json=payload) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise Exception(f"Teams webhook failed: {resp.status} - {text[:200]}")
    
    async def _send_generic_webhook(
        self,
        config: Dict,
        title: str,
        message: str,
        severity: str,
        node_name: Optional[str],
        metadata: Optional[Dict]
    ):
        """Send generic webhook POST with JSON payload"""
        webhook_url = config.get("webhook_url")
        if not webhook_url:
            raise ValueError("webhook_url not configured")
        
        payload = {
            "event": "alert",
            "title": title,
            "message": message,
            "severity": severity,
            "node": node_name,
            "metadata": metadata or {},
            "timestamp": datetime.utcnow().isoformat()
        }
        
        headers = config.get("headers", {})
        
        session = await self.get_session()
        async with session.post(webhook_url, json=payload, headers=headers) as resp:
            if resp.status >= 400:
                text = await resp.text()
                raise Exception(f"Webhook failed: {resp.status} - {text[:200]}")


# Singleton instance
_alert_manager: Optional[AlertManager] = None


def get_alert_manager(db_pool) -> AlertManager:
    global _alert_manager
    if _alert_manager is None:
        _alert_manager = AlertManager(db_pool)
    return _alert_manager


async def check_node_health(db_pool, offline_threshold_minutes: int = 5):
    """
    Background task to check for offline nodes.
    Should be run periodically (e.g., every minute).
    """
    alert_manager = get_alert_manager(db_pool)
    
    async with db_pool.acquire() as conn:
        # Find nodes that haven't been seen recently
        offline_nodes = await conn.fetch("""
            SELECT n.id, n.node_id, n.hostname, nh.last_seen_at, nh.is_online
            FROM nodes n
            LEFT JOIN node_health nh ON n.id = nh.node_id
            WHERE (
                nh.last_seen_at < NOW() - INTERVAL '1 minute' * $1
                OR nh.last_seen_at IS NULL
            )
            AND (nh.is_online = true OR nh.is_online IS NULL)
        """, offline_threshold_minutes)
        
        for node in offline_nodes:
            # Mark as offline
            await conn.execute("""
                INSERT INTO node_health (node_id, is_online, last_seen_at)
                VALUES ($1, false, COALESCE($2, NOW() - INTERVAL '1 hour'))
                ON CONFLICT (node_id) DO UPDATE SET is_online = false
            """, node["id"], node["last_seen_at"])
            
            # Fire alert
            last_seen = node["last_seen_at"]
            if last_seen:
                time_ago = datetime.utcnow() - last_seen.replace(tzinfo=None)
                minutes_ago = int(time_ago.total_seconds() / 60)
                message = f"Node has been offline for {minutes_ago} minutes (last seen: {last_seen.strftime('%Y-%m-%d %H:%M:%S')} UTC)"
            else:
                message = "Node has never reported health data"
            
            await alert_manager.fire_alert(
                event_type="node_offline",
                title=f"Node Offline: {node['hostname']}",
                message=message,
                severity="critical",
                node_id=str(node["id"]),
                node_name=node["hostname"],
                metadata={"node_id": node["node_id"]}
            )


async def update_node_health(db_pool, node_id: str):
    """Update last_seen timestamp for a node when it pushes data"""
    async with db_pool.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow(
            "SELECT id, hostname FROM nodes WHERE id::text = $1 OR node_id = $1 LIMIT 1",
            node_id
        )
        if not node:
            return
        
        # Check if node was offline and is now back online
        was_offline = await conn.fetchval(
            "SELECT is_online = false FROM node_health WHERE node_id = $1",
            node["id"]
        )
        
        # Update health record
        await conn.execute("""
            INSERT INTO node_health (node_id, last_seen_at, is_online, consecutive_failures)
            VALUES ($1, NOW(), true, 0)
            ON CONFLICT (node_id) DO UPDATE SET 
                last_seen_at = NOW(),
                is_online = true,
                consecutive_failures = 0
        """, node["id"])
        
        # If node came back online, resolve any open offline alerts
        if was_offline:
            await conn.execute("""
                UPDATE alerts 
                SET status = 'resolved', resolved_at = NOW()
                WHERE node_id = $1 AND event_type = 'node_offline' AND status = 'fired'
            """, node["id"])
            
            # Fire "back online" info alert
            alert_manager = get_alert_manager(db_pool)
            await alert_manager.fire_alert(
                event_type="node_online",
                title=f"Node Back Online: {node['hostname']}",
                message="Node has reconnected and is reporting data again.",
                severity="info",
                node_id=str(node["id"]),
                node_name=node["hostname"]
            )
