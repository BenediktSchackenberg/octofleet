"""
Remote Shell Session Management

Handles WebSocket sessions for remote shell access to nodes.
"""

import asyncio
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional
from dataclasses import dataclass, field
from fastapi import WebSocket
import logging

logger = logging.getLogger(__name__)


class ShellSessionState(Enum):
    PENDING = "pending"      # Waiting for agent to connect
    ACTIVE = "active"        # Shell is running
    CLOSED = "closed"        # Session ended


@dataclass
class ShellSession:
    session_id: str
    node_id: str
    user_id: str
    shell_type: str = "powershell"  # powershell, cmd, bash
    created_at: datetime = field(default_factory=datetime.utcnow)
    state: ShellSessionState = ShellSessionState.PENDING
    viewer_ws: Optional[WebSocket] = None
    agent_ws: Optional[WebSocket] = None
    command_count: int = 0
    last_activity: datetime = field(default_factory=datetime.utcnow)


class ShellSessionManager:
    """Manages remote shell sessions between viewers and agents."""
    
    def __init__(self):
        self._sessions: dict[str, ShellSession] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the session manager background tasks."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("ShellSessionManager started")
    
    async def stop(self):
        """Stop the session manager."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        logger.info("ShellSessionManager stopped")
    
    async def create_session(
        self, 
        session_id: str, 
        node_id: str, 
        user_id: str,
        shell_type: str = "powershell"
    ) -> ShellSession:
        """Create a new shell session."""
        session = ShellSession(
            session_id=session_id,
            node_id=node_id,
            user_id=user_id,
            shell_type=shell_type
        )
        self._sessions[session_id] = session
        logger.info(f"Created shell session {session_id} for node {node_id} (type={shell_type})")
        return session
    
    def get_session(self, session_id: str) -> Optional[ShellSession]:
        """Get a session by ID."""
        return self._sessions.get(session_id)
    
    def get_pending_for_node(self, node_id: str) -> Optional[ShellSession]:
        """Get the pending shell session for a node."""
        for session in self._sessions.values():
            if session.node_id == node_id and session.state == ShellSessionState.PENDING:
                return session
        return None
    
    async def activate_session(self, session_id: str):
        """Mark session as active when agent connects."""
        session = self._sessions.get(session_id)
        if session:
            session.state = ShellSessionState.ACTIVE
            session.last_activity = datetime.utcnow()
            logger.info(f"Shell session {session_id} activated")
    
    async def close_session(self, session_id: str, reason: str = "closed"):
        """Close a shell session."""
        session = self._sessions.get(session_id)
        if not session:
            return
        
        session.state = ShellSessionState.CLOSED
        
        # Notify viewer
        if session.viewer_ws:
            try:
                await session.viewer_ws.send_json({
                    "type": "closed",
                    "reason": reason
                })
            except:
                pass
        
        # Notify agent
        if session.agent_ws:
            try:
                await session.agent_ws.send_json({
                    "type": "stop"
                })
            except:
                pass
        
        # Remove session
        del self._sessions[session_id]
        logger.info(f"Shell session {session_id} closed: {reason}")
    
    def record_command(self, session_id: str):
        """Record that a command was executed."""
        session = self._sessions.get(session_id)
        if session:
            session.command_count += 1
            session.last_activity = datetime.utcnow()
    
    async def _cleanup_loop(self):
        """Background task to clean up stale sessions."""
        while True:
            try:
                await asyncio.sleep(30)
                now = datetime.utcnow()
                
                for session_id, session in list(self._sessions.items()):
                    # Close pending sessions after 60 seconds
                    if session.state == ShellSessionState.PENDING:
                        if now - session.created_at > timedelta(seconds=60):
                            logger.warning(f"Closing stale pending shell session {session_id}")
                            await self.close_session(session_id, "timeout")
                    
                    # Close inactive sessions after 30 minutes
                    elif session.state == ShellSessionState.ACTIVE:
                        if now - session.last_activity > timedelta(minutes=30):
                            logger.warning(f"Closing inactive shell session {session_id}")
                            await self.close_session(session_id, "inactivity")
                            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in shell session cleanup: {e}")


# Global instance
shell_session_manager = ShellSessionManager()
