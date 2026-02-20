"""
E17: Remote Screen Mirroring - Session Management

Handles screen viewing sessions between agents and browser clients.
Uses WebSocket for real-time frame delivery.
"""

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class ScreenSessionState(str, Enum):
    PENDING = "pending"      # Waiting for agent to connect
    ACTIVE = "active"        # Streaming
    PAUSED = "paused"        # Temporarily paused
    CLOSED = "closed"        # Session ended


@dataclass
class ScreenSession:
    id: str
    node_id: str
    user_id: str
    state: ScreenSessionState = ScreenSessionState.PENDING
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    
    # Settings
    quality: str = "medium"  # low, medium, high
    max_fps: int = 15
    resolution: str = "auto"  # auto, 720p, 1080p
    monitor_index: int = 0
    
    # Stats
    frames_sent: int = 0
    bytes_sent: int = 0
    
    # WebSocket connections
    agent_ws: Any = None
    viewer_ws: Any = None


class ScreenSessionManager:
    """Manages screen sharing sessions between agents and viewers."""
    
    def __init__(self):
        self.sessions: Dict[str, ScreenSession] = {}
        self.node_sessions: Dict[str, str] = {}  # node_id -> session_id (only one per node)
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the session manager."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("ScreenSessionManager started")
    
    async def stop(self):
        """Stop the session manager."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        # Close all sessions
        for session in list(self.sessions.values()):
            await self.close_session(session.id)
        logger.info("ScreenSessionManager stopped")
    
    async def create_session(
        self,
        node_id: str,
        user_id: str,
        quality: str = "medium",
        max_fps: int = 15,
        resolution: str = "auto",
        monitor_index: int = 0
    ) -> ScreenSession:
        """Create a new screen viewing session."""
        
        # Check if node already has an active session
        if node_id in self.node_sessions:
            existing_id = self.node_sessions[node_id]
            existing = self.sessions.get(existing_id)
            if existing and existing.state in (ScreenSessionState.PENDING, ScreenSessionState.ACTIVE):
                raise ValueError(f"Node {node_id} already has an active screen session")
        
        session = ScreenSession(
            id=str(uuid.uuid4()),
            node_id=node_id,
            user_id=user_id,
            quality=quality,
            max_fps=max_fps,
            resolution=resolution,
            monitor_index=monitor_index
        )
        
        self.sessions[session.id] = session
        self.node_sessions[node_id] = session.id
        
        logger.info(f"Screen session created: {session.id} for node {node_id} by user {user_id}")
        return session
    
    def get_session(self, session_id: str) -> Optional[ScreenSession]:
        """Get a session by ID."""
        return self.sessions.get(session_id)
    
    def get_session_for_node(self, node_id: str) -> Optional[ScreenSession]:
        """Get active session for a node."""
        session_id = self.node_sessions.get(node_id)
        if session_id:
            session = self.sessions.get(session_id)
            if session and session.state in (ScreenSessionState.PENDING, ScreenSessionState.ACTIVE):
                return session
        return None
    
    def get_pending_session_for_node(self, node_id: str) -> Optional[ScreenSession]:
        """Get pending session for a node (agent polling)."""
        session_id = self.node_sessions.get(node_id)
        if session_id:
            session = self.sessions.get(session_id)
            if session and session.state == ScreenSessionState.PENDING:
                return session
        return None
    
    async def activate_session(self, session_id: str) -> bool:
        """Mark session as active (agent connected)."""
        session = self.sessions.get(session_id)
        if not session:
            return False
        
        session.state = ScreenSessionState.ACTIVE
        session.started_at = datetime.utcnow()
        logger.info(f"Screen session activated: {session_id}")
        return True
    
    async def close_session(self, session_id: str, reason: str = "user_request") -> bool:
        """Close a screen session."""
        session = self.sessions.get(session_id)
        if not session:
            return False
        
        session.state = ScreenSessionState.CLOSED
        session.ended_at = datetime.utcnow()
        
        # Clean up WebSocket connections
        if session.agent_ws:
            try:
                await session.agent_ws.close()
            except:
                pass
        if session.viewer_ws:
            try:
                await session.viewer_ws.close()
            except:
                pass
        
        # Remove from node mapping
        if session.node_id in self.node_sessions:
            del self.node_sessions[session.node_id]
        
        logger.info(f"Screen session closed: {session_id}, reason: {reason}, frames: {session.frames_sent}")
        return True
    
    def list_sessions(self, include_closed: bool = False) -> list:
        """List all sessions."""
        sessions = []
        for session in self.sessions.values():
            if not include_closed and session.state == ScreenSessionState.CLOSED:
                continue
            sessions.append({
                "id": session.id,
                "node_id": session.node_id,
                "user_id": session.user_id,
                "state": session.state.value,
                "quality": session.quality,
                "max_fps": session.max_fps,
                "created_at": session.created_at.isoformat(),
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "frames_sent": session.frames_sent,
                "bytes_sent": session.bytes_sent
            })
        return sessions
    
    async def _cleanup_loop(self):
        """Periodically clean up stale sessions."""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                now = datetime.utcnow()
                
                for session_id, session in list(self.sessions.items()):
                    # Close pending sessions after 60 seconds (give agent time to connect)
                    if session.state == ScreenSessionState.PENDING:
                        if now - session.created_at > timedelta(seconds=60):
                            logger.warning(f"Closing stale pending session {session_id}")
                            await self.close_session(session_id, "timeout")
                    
                    # Remove closed sessions after 5 minutes
                    elif session.state == ScreenSessionState.CLOSED:
                        if session.ended_at and now - session.ended_at > timedelta(minutes=5):
                            del self.sessions[session_id]
                            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")


# Global instance
screen_session_manager = ScreenSessionManager()
